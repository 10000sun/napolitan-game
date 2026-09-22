import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { q, loadAppliedRules } from './db.js';
import { currentUser, requireUser, setSession } from './auth.js';
import { verifyLink } from './link.js';
import { buildWorld, deathCell } from './world.js';
import { compileEntry, offlineFallback } from './compiler.js';
import { isConfigured, describeProvider } from './llm.js';
import { foldEffects, normalizeObject, normalizeSurface } from './effects.js';
import { canEnter, bodyOf, saveBodyOnClear, resetBody, isOpen, hasReadBook, markBookRead } from './runs.js';
import { resolveAsset, imgFor, ITEM_ASSETS, assetDir, LIBRARY_DIR } from './assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/obj', express.static(assetDir()));
app.use('/lib', express.static(LIBRARY_DIR));
app.use('/tex', express.static(path.join(__dirname, '..', 'assets', 'textures')));

// ── 인증 ────────────────────────────────────────────────────
// 디스코드에서 마리가 준 링크로만 들어온다. 서버 멤버만 마리 명령을 쓸 수 있으니 그게 곧 문지기다.
app.get('/enter', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');     // 표가 붙은 주소가 어디에도 새지 않게
  const who = verifyLink(String(req.query.u || ''), process.env.MARI_LINK_SECRET);
  if (!who) {
    return res.status(403).type('html').send(
      '<!doctype html><meta charset="utf-8"><title>문이 열리지 않는다</title>'
      + '<body style="background:#0b0a08;color:#d8cfb8;font-family:serif;display:grid;place-items:center;height:100vh;margin:0">'
      + '<p>링크가 낡았거나 잘못됐다. 디스코드에서 다시 받아 오자.</p></body>');
  }
  setSession(res, q.upsertUser.get(who.id, who.name, null, Date.now()));
  res.redirect('/');                              // 주소창에서 표를 지운다
});

app.post('/auth/logout', (_req, res) => { res.clearCookie('nps'); res.json({ ok: true }); });

app.get('/api/me', (req, res) => {
  const u = currentUser(req);
  res.json({
    user: u ? { id: u.id, username: u.username, avatar: u.avatar, discord_id: u.discord_id } : null,
    devMode: process.env.DEV_NO_AUTH === '1',
    canEnter: u ? canEnter(u.id) : false,
    readBook: u ? hasReadBook(u.id) : false,
    lostParts: u ? bodyOf(u.id) : [],
  });
});

// ── 방명록 ──────────────────────────────────────────────────
app.get('/api/guestbook', (req, res) => {
  const u = currentUser(req);
  if (u) markBookRead(u.id);
  // 글과 기입 권한 외에는 아무것도 내보내지 않는다. 몇 줄이 반영됐는지,
  // 몇 명이 살아 나왔는지 알 수 있으면 이 방은 더 이상 무섭지 않다.
  res.json({
    entries: q.allEntries.all(),
    pendingWrite: u ? (q.pendingWrite.get(u.id)?.id ?? null) : null,
  });
});

/**
 * 방명록 기입. 클리어한 런 하나당 한 번.
 * ("입구 쪽에서 쓴 내용은 반영 안 되는 것 같습니다.")
 */
app.post('/api/guestbook', requireUser, async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: '아무것도 적지 않았습니다.' });
  if (text.length > 500) return res.status(400).json({ error: '공책의 한 칸에 그만큼은 들어가지 않습니다.' });

  const run = q.pendingWrite.get(req.user.id);
  if (!run) return res.status(403).json({ error: '출구 쪽 공책은 이곳을 빠져나온 사람에게만 열립니다.' });

  const rules = loadAppliedRules();
  const state = foldEffects(rules.map((r) => r.effects));

  let verdict;
  try {
    verdict = isConfigured()
      ? await compileEntry(text, rules, state)
      : offlineFallback();
  } catch (e) {
    console.error('[compile]', e.message);
    // 판정에 실패해도 글은 남는다. 방명록은 append-only 다.
    verdict = offlineFallback();
  }

  const entry = q.insertEntry.get(
    req.user.id, run.id, text, verdict.verdict, verdict.reason,
    JSON.stringify(verdict.effects), Date.now(),
  );
  q.useRunEntry.run(run.id);

  // 물체와 괴물의 모습은 뒤에서 확보한다. 응답은 기다리지 않는다.
  for (const e of verdict.effects) {
    if (e.type === 'surface.look') {
      const sf = normalizeSurface(e);
      if (sf) resolveAsset({ ...sf, kind: 'texture' }).catch((err) => console.error('[asset]', err.message));
      continue;
    }
    if (e.type !== 'object.spawn' && e.type !== 'entity.monster_look') continue;
    const o = normalizeObject(e);
    if (o) resolveAsset(o).catch((err) => console.error('[asset]', err.message));
  }

  res.json({
    entry: { ...entry, username: req.user.username },
    verdict: verdict.verdict,
    reason: verdict.reason,
    changed: verdict.effects.length > 0,
  });
});

// ── 런 ──────────────────────────────────────────────────────
app.post('/api/run/start', requireUser, (req, res) => {
  if (!hasReadBook(req.user.id)) return res.status(409).json({ error: '공책을 먼저 읽어야 문이 열린다.' });
  if (!canEnter(req.user.id)) return res.status(409).json({ error: '문이 열리지 않는다. 다른 누군가가 먼저 들어가야 한다.' });
  const rules = loadAppliedRules();
  const world = buildWorld(rules, q.recentDeaths.all());
  // 모습은 DB 에서 꺼내기만 한다. 여기서는 아무것도 새로 만들지 않는다.
  world.objects = world.objects.map((o) => ({ ...o, img: imgFor(o.key) }));
  world.items = world.items.map((it) => ({ ...it, img: ITEM_ASSETS[it.kind] ? imgFor(ITEM_ASSETS[it.kind].key) : null }));
  world.surfaces = Object.fromEntries(Object.entries(world.surfaces || {}).map(([s, l]) => [s, { ...l, img: imgFor(l.key) }]));
  if (world.monsterLook) world.monsterLook = { ...world.monsterLook, img: imgFor(world.monsterLook.key) };
  const run = q.insertRun.get(req.user.id, world.seed, rules.length, Date.now());

  // 요구하는 신체 부위는 월드에 담아 그대로 내려보낸다. 엔진이 문을 열지 말지
  // 판단하려면 이 값이 있어야 한다. 규칙이 허락하지 않으면 화면에 이름을
  // 띄우지 않을 뿐이다 (public/game.js 의 checkExit).
  res.json({ runId: run.id, world, body: { lostParts: bodyOf(req.user.id) } });
});

app.post('/api/run/:id/clear', requireUser, (req, res) => {
  const run = q.runById.get(Number(req.params.id));
  if (!run || run.user_id !== req.user.id) return res.status(404).json({ error: '그런 기록이 없습니다.' });
  if (run.cleared_at || run.died_at) return res.status(409).json({ error: '이미 끝난 기록입니다.' });

  // 가벼운 상식 검사. 100명짜리 친목 서버라 엄밀한 안티치트는 두지 않았다.
  const elapsed = Date.now() - run.started_at;
  if (elapsed < 2000) return res.status(400).json({ error: '그렇게 빨리 나갈 수는 없습니다.' });

  q.clearRun.run(Date.now(), run.id);
  const clearedRules = loadAppliedRules().slice(0, run.rule_count);
  saveBodyOnClear(req.user.id, req.body?.lostParts, foldEffects(clearedRules.map((r) => r.effects)).healOnExit);
  res.json({ ok: true, canWrite: true, elapsedMs: elapsed });
});

app.post('/api/run/:id/die', requireUser, (req, res) => {
  const run = q.runById.get(Number(req.params.id));
  if (!run || run.user_id !== req.user.id) return res.status(404).json({ error: '그런 기록이 없습니다.' });
  if (!isOpen(run)) return res.status(409).json({ error: '이미 끝난 기록입니다.' });
  // 그 런이 걷던 미로 크기 안의 칸만 믿는다.
  const size = foldEffects(loadAppliedRules().slice(0, run.rule_count).map((r) => r.effects)).mazeSize;
  const cell = deathCell(req.body, size);
  q.dieRun.run(Date.now(), cell?.x ?? null, cell?.y ?? null, run.id);
  resetBody(req.user.id);
  res.json({ ok: true });
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`\n  나폴리탄  →  http://localhost:${port}`);
  if (process.env.DEV_NO_AUTH === '1') console.log('  ⚠ DEV_NO_AUTH=1 — 디스코드 로그인 없이 누구나 입장합니다.');
  if (isConfigured()) console.log(`  판정: ${describeProvider()}`);
  else console.log('  ⚠ LLM 키 없음 — 방명록이 세계를 바꾸지 않습니다. (.env 를 보세요)');
  // 줍는 아이템의 바닥 모습. 이미 있으면 DB 조회로 끝난다.
  for (const it of Object.values(ITEM_ASSETS)) {
    resolveAsset(it).catch((err) => console.error('[asset]', err.message));
  }
  console.log('');
});
