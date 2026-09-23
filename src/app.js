// ─────────────────────────────────────────────────────────────
// 요청 처리. 워커(worker.js)가 저장소를 연결한 뒤 부른다.
// 맡지 않는 경로는 null → 정적 파일(public/)로 넘어간다.
// ─────────────────────────────────────────────────────────────

import { q, loadAppliedRules } from './db.js';
import { currentUser, guestUser, sessionCookie, clearCookie } from './auth.js';
import { verifyLink } from './link.js';
import { buildWorld, deathCell } from './world.js';
import { compileEntry, offlineFallback } from './compiler.js';
import { isConfigured } from './llm.js';
import { foldEffects, normalizeObject, normalizeSurface } from './effects.js';
import { canEnter, bodyOf, saveBodyOnClear, resetBody, isOpen, hasReadBook, markBookRead } from './runs.js';
import { resolveAsset, imgFor, getImage, ITEM_ASSETS } from './assets.js';

const MAX_BODY = 32 * 1024;
// 판정(LLM) 한 번이 넘지 않을 시간. 이보다 오래 잡혀 있으면 죽은 잠금으로 보고 다음 사람이 가져간다.
const LOCK_MS = 120_000;

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } });

class HttpError extends Error {
  constructor(status, error) { super(error); this.status = status; }
}

async function readJson(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new HttpError(413, '너무 깁니다.');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new HttpError(400, '읽을 수 없는 요청입니다.'); }
}

const DENIED = '<!doctype html><meta charset="utf-8"><title>문이 열리지 않는다</title>'
  + '<body style="background:#0b0a08;color:#d8cfb8;font-family:serif;display:grid;place-items:center;height:100vh;margin:0">'
  + '<p>링크가 낡았거나 잘못됐다. 디스코드에서 다시 받아 오자.</p></body>';

/** 이미 만들어진 Response 에 헤더 하나를 더 붙인다. 본문·상태는 그대로. */
function withHeader(res, name, value) {
  const headers = new Headers(res.headers);
  headers.append(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

// ── 인증 ────────────────────────────────────────────────────
// 마리 링크로 오면 그 디스코드 신분으로 들어온다. 그냥 온 사람은
// handle() 이 곧장 손님으로 들여보낸다 — 디스코드가 문지기였던 건 없앴다.
// 링크는 여전히 발급되고 여전히 통한다. 다만 그것만이 유일한 문이 아니다.
async function enter(url) {
  const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }; // 표가 붙은 주소가 어디에도 새지 않게
  const who = verifyLink(url.searchParams.get('u') || '', process.env.MARI_LINK_SECRET);
  if (!who) return new Response(DENIED, { status: 403, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  const user = await q.upsertUser.get(who.id, who.name, null, Date.now());
  // 주소창에서 표를 지운다
  return new Response(null, { status: 302, headers: { ...headers, Location: '/', 'Set-Cookie': sessionCookie(user, url.protocol === 'https:') } });
}

async function me(user) {
  return json({
    user: user ? { id: user.id, username: user.username, avatar: user.avatar, discord_id: user.discord_id } : null,
    devMode: process.env.DEV_NO_AUTH === '1',
    canEnter: user ? await canEnter(user.id) : false,
    readBook: user ? await hasReadBook(user.id) : false,
    lostParts: user ? await bodyOf(user.id) : [],
  });
}

// ── 방명록 ──────────────────────────────────────────────────
async function readBook(user) {
  if (user) await markBookRead(user.id);
  // 글과 기입 권한 외에는 아무것도 내보내지 않는다. 몇 줄이 반영됐는지,
  // 몇 명이 살아 나왔는지 알 수 있으면 이 방은 더 이상 무섭지 않다.
  return json({
    entries: await q.allEntries.all(),
    pendingWrite: user ? ((await q.pendingWrite.get(user.id))?.id ?? null) : null,
  });
}

/** 이번 판정으로 확보해야 할 모습들. 이미 있으면 resolveAsset 이 DB 조회로 끝낸다. */
function looksToResolve(effects, state) {
  const out = [];
  for (const e of effects) {
    if (e.type === 'surface.look') {
      const sf = normalizeSurface(e);
      if (sf) out.push({ ...sf, kind: 'texture' });
    } else if (e.type === 'object.spawn' || e.type === 'entity.monster_look') {
      const o = normalizeObject(e);
      if (o) out.push(o);
    }
  }
  for (const [kind, it] of Object.entries(ITEM_ASSETS)) if (state[kind]) out.push(it);
  return out;
}

/**
 * 방명록 기입. 클리어한 런 하나당 한 번.
 * ("입구 쪽에서 쓴 내용은 반영 안 되는 것 같습니다.")
 */
async function writeBook(request, user) {
  const text = String((await readJson(request)).text ?? '').trim();
  if (!text) return json({ error: '아무것도 적지 않았습니다.' }, 400);
  if (text.length > 500) return json({ error: '공책의 한 칸에 그만큼은 들어가지 않습니다.' }, 400);

  // 판정은 한 줄씩. 잠금 안에서 규칙을 읽고, 판정하고, 적는다.
  const holder = crypto.randomUUID();
  const now = Date.now();
  if (!(await q.lockBook.get(holder, now + LOCK_MS, now))) {
    return json({ error: '누군가 공책에 적고 있다. 잉크가 마르면 다시 적자.', busy: true }, 409);
  }
  let saved;
  try {
    saved = await judgeAndSave(text, user);
  } finally {
    await q.unlockBook.run(holder);
  }
  if (saved.error) return json({ error: saved.error }, saved.status);
  const { entry, verdict, next } = saved;

  // 모습은 응답 전에 확보한다. 워커는 응답 뒤의 일을 30초 안에 끊는다.
  // 규칙과는 상관없어서 잠금 밖에서 한다 (다음 사람을 기다리게 하지 않게).
  await Promise.all(looksToResolve(verdict.effects, next)
    .map((o) => resolveAsset(o).catch((err) => console.error('[asset]', err.message))));

  return json({
    entry: { ...entry, username: user.username },
    verdict: verdict.verdict,
    reason: verdict.reason,
    changed: verdict.effects.length > 0,
  });
}

/** 잠금 안에서: 쓸 자격 확인 → 판정 → 저장. 같은 사람이 두 번 눌러도 한 줄만 남는다. */
async function judgeAndSave(text, user) {
  const run = await q.pendingWrite.get(user.id);
  if (!run) return { error: '출구 쪽 공책은 이곳을 빠져나온 사람에게만 열립니다.', status: 403 };

  const rules = await loadAppliedRules();
  const state = foldEffects(rules.map((r) => r.effects));

  let verdict;
  try {
    verdict = isConfigured() ? await compileEntry(text, rules, state) : offlineFallback();
  } catch (e) {
    console.error('[compile]', e.message);
    // 판정에 실패해도 글은 남는다. 방명록은 append-only 다.
    verdict = offlineFallback();
  }

  const entry = await q.insertEntry.get(
    user.id, run.id, text, verdict.verdict, verdict.reason,
    JSON.stringify(verdict.effects), Date.now(),
  );
  await q.useRunEntry.run(run.id);

  // 방은 제 번호가 불리는 걸 싫어한다. 적히는 순간 한 번 섞는다.
  // (판을 만들 때가 아니라 여기서 한 번만 — 매번 섞이면 아무도 못 찾는다.)
  const next = foldEffects([...rules.map((r) => r.effects), verdict.effects]);
  if (next.lock && verdict.effects.some((e) => e.type === 'lock.shuffle')) {
    await shuffleLock(next.lock.digits);
  }
  return { entry, verdict, next };
}

// 사람이 3~6자리를 눌러 넣는 데 걸리는 시간보다 짧게 두면 사람에게는 안 걸리고,
// 스크립트로 찔러 미로를 걷지 않고 번호를 맞히는 것만 막는다. 3자리(729가지)를
// 이 간격으로 전부 시도하면 최소 18분이 걸린다 — 방을 뒤지는 것보다 느리다.
const UNLOCK_COOLDOWN_MS = 1500;

async function unlockRun(request, id, user) {
  const run = await q.runById.get(Number(id));
  if (!run || run.user_id !== user.id) return json({ error: '그런 기록이 없습니다.' }, 404);
  if (!isOpen(run)) return json({ error: '이미 끝난 기록입니다.' }, 409);

  const now = Date.now();
  if (run.last_unlock_at && now - run.last_unlock_at < UNLOCK_COOLDOWN_MS) {
    // 게임 안의 목소리로 거절한다. "너무 빠르다"는 말을 서버가 하지 않는다.
    return json({ ok: false, wait: true });
  }
  await q.touchUnlock.run(now, run.id);

  const { code } = await request.json().catch(() => ({}));
  const real = (await q.roomGet.get('lock'))?.value || '';
  // real 이 빈 문자열이면(자물쇠가 아예 없으면) 빈 code 도 길이가 맞아 통과해 버린다.
  // 실제로 닿을 일은 없다 — 클라이언트는 lock 이 있는 방에서만 번호판을 띄운다 —
  // 이건 API 를 직접 찌를 때를 막는 방어선이다.
  const ok = typeof code === 'string' && code.length > 0 && real.length > 0
    && code.length === real.length && (await constantTimeEqual(code, real));
  return json({ ok });
}

/** 타이밍으로 한 자리씩 새어 나가지 않게. 길이가 같다고 이미 확인한 뒤에 쓴다. */
async function constantTimeEqual(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const [xa, xb] = [new Uint8Array(ha), new Uint8Array(hb)];
  let diff = 0;
  for (let i = 0; i < xa.length; i++) diff |= xa[i] ^ xb[i];
  return diff === 0;
}

// ── 출구 자물쇠 ─────────────────────────────────────────────
// 번호는 시드가 아니라 방이 기억한다. 방명록이 바뀌어도 번호는 그대로고,
// 누가 방명록에서 번호를 입에 올렸을 때만 다시 섞인다.
function newCode(digits) {
  // 1~9 만 쓴다. 0 이 없어야 번호판이 3×3 으로 떨어지고, 앞자리가 0 인 번호도 없다.
  const n = crypto.getRandomValues(new Uint8Array(digits));
  return [...n].map((v) => (v % 9) + 1).join('');
}

async function lockCode(digits) {
  const cur = (await q.roomGet.get('lock'))?.value;
  if (typeof cur === 'string' && cur.length === digits) return cur;
  const code = newCode(digits);
  await q.roomSet.run('lock', code);
  return code;
}

async function shuffleLock(digits) {
  const code = newCode(digits);
  await q.roomSet.run('lock', code);
  return code;
}

// ── 런 ──────────────────────────────────────────────────────
async function startRun(user) {
  if (!(await hasReadBook(user.id))) return json({ error: '공책을 먼저 읽어야 문이 열린다.' }, 409);
  if (!(await canEnter(user.id))) return json({ error: '문이 열리지 않는다. 다른 누군가가 먼저 들어가야 한다.' }, 409);
  const rules = await loadAppliedRules();
  const st = foldEffects(rules.map((r) => r.effects));
  const code = st.lock ? await lockCode(st.lock.digits) : null;
  const world = buildWorld(rules, await q.recentDeaths.all(), code);
  // 모습은 DB 에서 꺼내기만 한다. 여기서는 아무것도 새로 만들지 않는다.
  world.objects = await Promise.all(world.objects.map(async (o) => ({ ...o, img: await imgFor(o.key) })));
  world.items = await Promise.all(world.items.map(async (it) => ({ ...it, img: ITEM_ASSETS[it.kind] ? await imgFor(ITEM_ASSETS[it.kind].key) : null })));
  world.surfaces = Object.fromEntries(await Promise.all(
    Object.entries(world.surfaces || {}).map(async ([s, l]) => [s, { ...l, img: await imgFor(l.key) }])));
  if (world.monsterLook) world.monsterLook = { ...world.monsterLook, img: await imgFor(world.monsterLook.key) };
  const run = await q.insertRun.get(user.id, world.seed, rules.length, Date.now());

  // 요구하는 신체 부위는 월드에 담아 그대로 내려보낸다. 엔진이 문을 열지 말지
  // 판단하려면 이 값이 있어야 한다. 규칙이 허락하지 않으면 화면에 이름을
  // 띄우지 않을 뿐이다 (public/game.js 의 checkExit).
  return json({ runId: run.id, world, body: { lostParts: await bodyOf(user.id) } });
}

async function ownRun(id, user) {
  const run = await q.runById.get(Number(id));
  if (!run || run.user_id !== user.id) throw new HttpError(404, '그런 기록이 없습니다.');
  if (!isOpen(run)) throw new HttpError(409, '이미 끝난 기록입니다.');
  return run;
}

async function clearRun(request, id, user) {
  const run = await ownRun(id, user);
  // 가벼운 상식 검사. 100명짜리 친목 서버라 엄밀한 안티치트는 두지 않았다.
  const elapsed = Date.now() - run.started_at;
  if (elapsed < 2000) return json({ error: '그렇게 빨리 나갈 수는 없습니다.' }, 400);

  const body = await readJson(request);
  await q.clearRun.run(Date.now(), run.id);
  const clearedRules = (await loadAppliedRules()).slice(0, run.rule_count);
  await saveBodyOnClear(user.id, body.lostParts, foldEffects(clearedRules.map((r) => r.effects)).healOnExit);
  return json({ ok: true, canWrite: true, elapsedMs: elapsed });
}

async function dieRun(request, id, user) {
  const run = await ownRun(id, user);
  const body = await readJson(request);
  // 그 런이 걷던 미로 크기 안의 칸만 믿는다.
  const size = foldEffects((await loadAppliedRules()).slice(0, run.rule_count).map((r) => r.effects)).mazeSize;
  const cell = deathCell(body, size);
  // 죽을 때의 몸을 함께 남긴다. 다리가 없던 사람은 다리 없는 시체로 남는다.
  const lost = await bodyOf(user.id);
  await q.dieRun.run(Date.now(), cell?.x ?? null, cell?.y ?? null, JSON.stringify(lost), run.id);
  await resetBody(user.id);
  return json({ ok: true });
}

// ── 방명록 초기화 (마리 관리자 명령) ────────────────────────
// 글·플레이 기록·몸 상태·"공책 읽음" 을 지운다. 사람 목록과 만든 이미지는 남긴다 (이미지는 다시 만들면 돈이 든다).
// 되돌릴 수 없다. 필요하면 D1 Time Travel 로 복구한다.
async function resetBook(request) {
  const { t } = await readJson(request);
  const who = verifyLink(String(t || ''), process.env.MARI_LINK_SECRET, undefined, 'reset');
  if (!who) return json({ error: '초기화 표가 아닙니다.' }, 403);
  // ponytail: 표는 1분 안에 몇 번이든 쓸 수 있다. 초기화는 여러 번 해도 결과가 같아서 막지 않는다.
  const before = await q.countForReset.get();
  await q.resetEntries.run();
  await q.resetRuns.run();
  await q.resetBodies.run();
  console.log(`[reset] ${who.name}(${who.id}) 방명록 ${before.entries}줄·기록 ${before.runs}판을 지웠다`);
  return json({ ok: true, entries: before.entries, runs: before.runs });
}

// ── 생성된 이미지 ───────────────────────────────────────────
async function objImage(file) {
  if (!/^[0-9a-f]{16}\.(png|jpg|webp)$/.test(file)) return new Response('없음', { status: 404 });
  const img = await getImage(file);
  if (!img) return new Response('없음', { status: 404 });
  // 파일명이 key 의 해시라 같은 이름이면 같은 그림이다.
  return new Response(img.bytes, { headers: { 'Content-Type': img.type, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}

// ── 길잡이 ──────────────────────────────────────────────────
export async function handle(request) {
  const url = new URL(request.url);
  const { pathname: p } = url;
  const method = request.method;
  try {
    if (p === '/healthz') return json({ ok: true });
    if (p === '/enter' && method === 'GET') return await enter(url);
    if (p.startsWith('/obj/') && method === 'GET') return await objImage(p.slice(5));
    if (p === '/auth/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
    if (!p.startsWith('/api/')) return null;
    if (p === '/api/admin/reset' && method === 'POST') return await resetBook(request);

    let user = await currentUser(request.headers.get('Cookie'));
    // 세션이 없으면(마리 링크로도, 이전 방문으로도) 곧장 손님으로 들여보낸다.
    // 응답에 쿠키를 함께 실어야 다음 요청부터 같은 사람으로 남는다.
    let guestCookie = null;
    if (!user) {
      user = await guestUser();
      guestCookie = sessionCookie(user, url.protocol === 'https:');
    }
    const attach = (res) => (guestCookie ? withHeader(res, 'Set-Cookie', guestCookie) : res);

    if (p === '/api/me' && method === 'GET') return attach(await me(user));
    if (p === '/api/guestbook' && method === 'GET') return attach(await readBook(user));

    if (p === '/api/guestbook' && method === 'POST') return attach(await writeBook(request, user));
    if (p === '/api/run/start' && method === 'POST') return attach(await startRun(user));
    const u = /^\/api\/run\/(\d+)\/unlock$/.exec(p);
    if (u && method === 'POST') return attach(await unlockRun(request, u[1], user));
    const m = /^\/api\/run\/(\d+)\/(clear|die)$/.exec(p);
    if (m && method === 'POST') return attach(await (m[2] === 'clear' ? clearRun(request, m[1], user) : dieRun(request, m[1], user)));
    return json({ error: '없는 길입니다.' }, 404);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[handle]', p, e);
    return json({ error: '무언가 잘못됐다.' }, 500);
  }
}
