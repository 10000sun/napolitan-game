// 요청 처리. 메모리 DB·메모리 이미지·가짜 fetch 로 워커 없이 돌린다.
delete process.env.DEV_NO_AUTH;
process.env.MARI_LINK_SECRET = 'test-link-secret';
process.env.LLM_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'k';
process.env.IMAGE_PROVIDER = 'gemini';

let say = null;          // 판정 모델이 뱉을 JSON
let imageOk = true;      // 이미지 생성이 되는가
let gate = null;         // 판정 응답을 붙잡아 둘 때 (동시 기입)
globalThis.fetch = async (url) => {
  if (String(url).includes(':generateContent')) {
    if (gate) await gate;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(say) }] } }] }), { status: 200 });
  }
  if (!imageOk) return new Response('boom', { status: 500 });
  const data = Buffer.alloc(300, 7).toString('base64');
  return new Response(JSON.stringify({ steps: [{ type: 'model_output', content: [{ type: 'image', data, mime_type: 'image/png' }] }] }), { status: 200 });
};

const { useStore } = await import('../src/db.js');
const { nodeStore } = await import('../src/store.js');
const store = await nodeStore();
useStore(store);
const { q } = await import('../src/db.js');
const { useImages } = await import('../src/assets.js');
const images = new Map();
useImages({ put: async (f, bytes, type) => { images.set(f, { bytes, type }); }, get: async (f) => images.get(f) ?? null });
const { handle } = await import('../src/app.js');
const { sessionCookie } = await import('../src/auth.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

const call = (path, { method = 'GET', cookie, body } = {}) => handle(new Request(`http://t${path}`, {
  method, headers: { ...(cookie ? { Cookie: cookie } : {}), 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
}));
const get = async (path, opts) => { const r = await call(path, opts); return { status: r.status, body: await r.json() }; };
const post = (path, opts = {}) => get(path, { ...opts, method: 'POST' });
const backdate = (runId) => store.run('UPDATE runs SET started_at = started_at - 5000 WHERE id = ?', [runId]);

// ── 로그인 ──────────────────────────────────────────────
// 디스코드가 문지기였던 건 없앴다. 쿠키가 없거나 망가졌어도 곧장 손님으로
// 들어오고, 응답에 새 쿠키가 실려 다음부터는 같은 손님으로 남는다.
const noCookie = await call('/api/me');
check((await noCookie.json()).user?.username?.startsWith('손님-'), '쿠키가 없으면 곧장 손님으로 들어온다');
check(!!noCookie.headers.get('Set-Cookie'), '그 자리에서 쿠키를 내려준다');
const brokenCookie = await call('/api/me', { cookie: 'nps=abc.def' });
check((await brokenCookie.json()).user?.username?.startsWith('손님-'), '망가진 쿠키도 에러 없이 손님으로 들어온다');
check(!!brokenCookie.headers.get('Set-Cookie'), '망가진 쿠키도 새 쿠키로 갈아 끼운다');
check((await call('/enter?u=nope')).status === 403, '잘못된 표는 403');

// 마리 링크를 한 번도 거치지 않고 끝까지 — 손님도 진짜로 플레이할 수 있어야 한다.
const guestCookie = (noCookie.headers.get('Set-Cookie') || '').split(';')[0];
check((await get('/api/guestbook', { cookie: guestCookie })).status === 200, '손님도 공책을 읽는다');
const gr = await post('/api/run/start', { cookie: guestCookie });
check(gr.status === 200 && !!gr.body.runId, '손님도 마리 링크 없이 곧장 들어간다');
await backdate(gr.body.runId);
check((await post(`/api/run/${gr.body.runId}/clear`, { cookie: guestCookie, body: { lostParts: [] } })).status === 200, '손님도 나올 수 있다');
say = { verdict: 'flavor_only', reason: '그저 받아 적었다.', effects: [] };
check((await post('/api/guestbook', { cookie: guestCookie, body: { text: '손님도 적어 본다' } })).status === 200, '손님도 방명록에 적을 수 있다');

const GOLDEN = 'eyJpZCI6IjEyMzQ1Njc4OTAxMjM0NTY3OCIsIm4iOiLrp4jrpqwg7YWM7Iqk7Yq4IiwiZSI6MjAwMDAwMDAwMH0.Nd31-9GN_dViZPQbr3_gLJIDZUXbRp5hunFdtquovgg';
const entered = await call(`/enter?u=${GOLDEN}`);
const setCookie = entered.headers.get('Set-Cookie') || '';
check(entered.status === 302 && entered.headers.get('Location') === '/', '마리 표로 들어오면 / 로 보낸다');
check(/HttpOnly/.test(setCookie) && /SameSite=Lax/.test(setCookie) && !/Secure/.test(setCookie), 'http 에서는 Secure 없이 쿠키');
check(/Secure/.test((await handle(new Request(`https://t/enter?u=${GOLDEN}`))).headers.get('Set-Cookie')), 'https 면 Secure');
const A = setCookie.split(';')[0];
const meA = (await get('/api/me', { cookie: A })).body;
check(meA.user?.username === '마리 테스트' && meA.canEnter && !meA.readBook, '그 쿠키로 내가 누군지 안다');

// ── 런 ──────────────────────────────────────────────────
check((await post('/api/run/start', { cookie: A })).status === 409, '공책을 안 읽으면 못 들어간다');
check((await get('/api/guestbook', { cookie: A })).status === 200, '공책을 읽는다');
let r = await post('/api/run/start', { cookie: A });
check(r.status === 200 && r.body.runId && Array.isArray(r.body.world.objects), '읽은 뒤에는 들어간다');
const run1 = r.body.runId;
check((await post(`/api/run/${run1}/clear`, { cookie: A, body: { lostParts: [] } })).status === 400, '2초 전에는 못 나간다');
await backdate(run1);
check((await post(`/api/run/${run1}/clear`, { cookie: A, body: { lostParts: ['혀'] } })).status === 200, '나간다');
check(JSON.stringify((await get('/api/me', { cookie: A })).body.lostParts) === '["혀"]', '잃은 부위가 남는다');
check((await post(`/api/run/${run1}/clear`, { cookie: A, body: {} })).status === 409, '끝난 판은 다시 못 끝낸다');

// ── 방명록 기입과 모습 ──────────────────────────────────
check((await get('/api/guestbook', { cookie: A })).body.pendingWrite === run1, '나온 사람은 적을 수 있다');
say = { verdict: 'applied', reason: '있다', effects: [{ type: 'object.spawn', name: '웃는 가면', tags: 'mask, smiling, pale', emoji: '🎭', count: 1 }] };
r = await post('/api/guestbook', { cookie: A, body: { text: '입구에 웃는 가면이 있다' } });
check(r.status === 200 && r.body.verdict === 'applied', '기입이 반영된다');
const mask = await q.assetByKey.get('웃는 가면');
check(mask?.status === 'ready' && /^\/obj\/[0-9a-f]{16}\.png$/.test(mask.file), '응답 전에 모습이 확보된다');
const img = await call(mask.file);
check(img.status === 200 && img.headers.get('Content-Type') === 'image/png' && (await img.arrayBuffer()).byteLength === 300, '/obj 가 그 이미지를 준다');
check((await post('/api/guestbook', { cookie: A, body: { text: '또' } })).status === 403, '한 판에 한 줄');

// 두 번째 사람. 이미지가 안 만들어져도 글은 남는다.
const b = await q.upsertUser.get('222', 'B', null, Date.now());
const B = sessionCookie(b).split(';')[0];
await get('/api/guestbook', { cookie: B });
const run2 = (await post('/api/run/start', { cookie: B })).body.runId;
check((await post('/api/run/start', { cookie: B })).status === 409, '연달아 두 번은 못 들어간다');
await backdate(run2);
await post(`/api/run/${run2}/clear`, { cookie: B, body: {} });
imageOk = false;
say = { verdict: 'applied', reason: '있다', effects: [{ type: 'object.spawn', name: '녹슨 손', tags: 'hand, rusty', emoji: '✋', count: 1 }] };
r = await post('/api/guestbook', { cookie: B, body: { text: '녹슨 손이 있다' } });
check(r.status === 200 && (await q.assetByKey.get('녹슨 손'))?.status === 'failed', '이미지 생성이 실패해도 기입은 200');
r = await post('/api/run/start', { cookie: A });
check(r.body.world.objects.some((o) => o.img === mask.file), '다음 판의 물체에 모습이 붙는다');

// ── 출구 자물쇠 ───────────────────────────────────────────
const run3 = r.body.runId;

// 자물쇠가 아예 없을 때(room 표에 값이 없을 때) 빈 코드로 우회할 수 없어야 한다.
// 이건 room 에 lock 값을 넣기 전인 지금만 확인할 수 있다.
// (A 는 run3 가 아직 열려 있어 연달아 입장이 막히니 B 로 확인한다.)
const bare = await post('/api/run/start', { cookie: B });
check((await post(`/api/run/${bare.body.runId}/unlock`, { cookie: B, body: { code: '' } })).body.ok !== true,
  '자물쇠가 없는 방에서 빈 코드로 우회할 수 없다');

await q.roomSet.run('lock', '714');
check((await post(`/api/run/${run3}/unlock`, { cookie: A, body: { code: '000' } })).body.ok === false, '틀린 번호는 거절');
check((await post(`/api/run/${run3}/unlock`, { cookie: B, body: { code: '714' } })).status === 404, '남의 런은 건드릴 수 없다');
// 위 시도들이 쿨다운을 이미 소모했으니, 이번 확인은 그 쿨다운이 끝난 뒤로 본다
await store.run('UPDATE runs SET last_unlock_at = 0 WHERE id = ?', [run3]);
const first = await post(`/api/run/${run3}/unlock`, { cookie: A, body: { code: '714' } });
check(first.body.ok === true, '맞는 번호는 통과');
// 곧바로 다시 두드리면(스크립트 브루트포스) 검증 자체를 하지 않고 물러선다
const again = await post(`/api/run/${run3}/unlock`, { cookie: A, body: { code: '714' } });
check(again.body.wait === true && again.body.ok !== true, '너무 빠르게 다시 두드리면 판정 없이 물러선다');
await store.run('UPDATE runs SET last_unlock_at = 0 WHERE id = ?', [run3]);
check((await post(`/api/run/${run3}/unlock`, { cookie: A, body: { code: '714' } })).body.ok === true, '간격이 지나면 다시 판정한다');
check((await post('/api/run/999999/unlock', { cookie: A, body: { code: '714' } })).status === 404, '없는 런은 404');

// ── 죽음 ────────────────────────────────────────────────
check((await post(`/api/run/${r.body.runId}/die`, { cookie: A, body: { x: 1.5, y: 1.5 } })).status === 200, '죽는다');
check(JSON.stringify((await get('/api/me', { cookie: A })).body.lostParts) === '[]', '죽으면 몸은 새것');
check((await post(`/api/run/${r.body.runId}/die`, { cookie: A, body: {} })).status === 409, '두 번 죽지 않는다');
check((await post(`/api/run/${run2}/die`, { cookie: A, body: {} })).status === 404, '남의 판은 없는 판');

// ── 방명록 초기화 (마리 관리자) ──────────────────────────
const { createHmac } = await import('node:crypto');
const mk = (p, sec = 'test-link-secret') => {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  return `${body}.${createHmac('sha256', sec).update(body).digest('base64url')}`;
};
const soon = Math.floor(Date.now() / 1000) + 60;
const RESET = mk({ id: '1', n: '관리자', e: soon, a: 'reset' });
await store.run(`UPDATE users SET lost_parts = '["혀"]' WHERE id = ?`, [meA.user.id]);
check((await post('/api/admin/reset', { body: { t: GOLDEN } })).status === 403, '⭐ 입장 링크로는 초기화하지 못한다');
check((await post('/api/admin/reset', { body: { t: mk({ id: '1', n: 'x', e: soon, a: 'reset' }, 'other') } })).status === 403, '다른 열쇠의 초기화 표는 거절');
check((await post('/api/admin/reset', { body: { t: mk({ id: '1', n: 'x', e: soon - 120, a: 'reset' }) } })).status === 403, '만료된 초기화 표는 거절');
check((await call(`/enter?u=${RESET}`)).status === 403, '초기화 표로는 입장하지 못한다');
r = await post('/api/admin/reset', { body: { t: RESET } });
check(r.status === 200 && r.body.entries === 3 && r.body.runs === 5, '초기화하면 지운 글·판 수를 알려준다');
const afterBook = await get('/api/guestbook', { cookie: B });
const afterMe = (await get('/api/me', { cookie: A })).body;
check(afterBook.body.entries.length === 0 && afterBook.body.pendingWrite === null, '방명록이 비고 쓸 자격도 사라진다');
check(afterMe.user && JSON.stringify(afterMe.lostParts) === '[]' && !afterMe.readBook && afterMe.canEnter, '사람은 남고 몸·공책 읽음·연속 입장은 처음으로');
check((await q.assetByKey.get('웃는 가면'))?.status === 'ready', '만든 이미지는 남는다');

// ── 공책은 한 줄씩 ──────────────────────────────────────
// 두 사람이 동시에 나와서 적으면, 한 사람은 기다렸다가 다시 적어야 한다.
const clearAs = async (cookie) => {
  await get('/api/guestbook', { cookie });
  const id = (await post('/api/run/start', { cookie })).body.runId;
  await backdate(id);
  await post(`/api/run/${id}/clear`, { cookie, body: {} });
};
await clearAs(A);
await clearAs(B);
imageOk = true;
say = { verdict: 'flavor_only', reason: '받아 적었다', effects: [] };
let release;
gate = new Promise((res) => { release = res; });
const both = Promise.all([
  post('/api/guestbook', { cookie: A, body: { text: '동시에 하나' } }),
  post('/api/guestbook', { cookie: B, body: { text: '동시에 둘' } }),
]);
await new Promise((res) => setTimeout(res, 20));
release();
gate = null;
const [wa, wb] = await both;
check([wa.status, wb.status].sort().join() === '200,409', `동시에 적으면 한 줄만 판정되고 나머지는 409 (${wa.status}, ${wb.status})`);
const loser = wa.status === 409 ? { res: wa, cookie: A } : { res: wb, cookie: B };
check(loser.res.body.busy === true && /누군가 공책에/.test(loser.res.body.error), '기다리라는 안내');
check((await get('/api/guestbook', { cookie: loser.cookie })).body.pendingWrite !== null, '밀려난 사람은 쓸 자격을 잃지 않는다');
check(!!(await q.lockBook.get('probe', Date.now() + 1000, Date.now())), '끝나면 잠금이 풀린다');
check((await post('/api/guestbook', { cookie: loser.cookie, body: { text: '다시' } })).status === 409, '누가 잡고 있으면 409');
await store.run('UPDATE locks SET until = 0');
check((await post('/api/guestbook', { cookie: loser.cookie, body: { text: '다시' } })).status === 200, '만료된 잠금은 다음 사람이 가져간다');
check((await get('/api/guestbook')).body.entries.length === 2, '결국 두 줄 다 남는다');

// ── 경계 ────────────────────────────────────────────────
// 쿠키 없이 와도 곧장 손님으로 들어오지만, 그 손님은 아직 아무것도 빠져나온 적이
// 없으니 기입 자격은 없다 — "로그인이 안 됐다" 가 아니라 "아직 자격이 없다" 다.
check((await post('/api/guestbook', { body: { text: 'x' } })).status === 403, '쿠키 없이 와도 손님으로 들어오지만 기입 자격은 없다');
check((await post('/api/guestbook', { cookie: A, body: JSON.stringify({ text: 'x'.repeat(40_000) }) })).status === 413, '32KB 넘는 본문은 413');
check((await post('/api/guestbook', { cookie: A, body: '{깨짐' })).status === 400, '읽을 수 없는 본문은 400');
check((await call('/obj/..%2Fx')).status === 404 && (await call('/obj/0000000000000000.png')).status === 404, '/obj 이상한 이름·없는 파일은 404');
const nope = await call('/api/nope');
check(nope.status === 404 && (await nope.json()).error, '모르는 /api 는 404 JSON');
check((await call('/index.html')) === null && (await call('/tex/a.png')) === null, '정적 파일은 넘긴다');
check((await get('/healthz')).body.ok === true, 'healthz');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
