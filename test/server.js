// 런 규칙. HTTP 없이 함수만 본다.
delete process.env.DEV_NO_AUTH;

const { useStore } = await import('../src/db.js');
const { nodeStore } = await import('../src/store.js');
useStore(await nodeStore());
const { q } = await import('../src/db.js'); // useStore 뒤에 꺼내야 연결된 q
const { verifyLink } = await import('../src/link.js');
const { canEnter, SOLO_WAIT_MS, bodyOf, saveBodyOnClear, resetBody, isOpen, hasReadBook, markBookRead } = await import('../src/runs.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

const a = (await q.upsertUser.get('a', 'A', null, Date.now())).id;
const b = (await q.upsertUser.get('b', 'B', null, Date.now())).id;
check(await canEnter(a), '아무도 들어간 적 없으면 들어갈 수 있다');
(await q.insertRun.get(a, 1, 0, Date.now()));
check(!await canEnter(a), '방금 내가 들어갔으면 다시 못 들어간다');
check(await canEnter(b), '다른 사람은 들어갈 수 있다');
(await q.insertRun.get(b, 1, 0, Date.now()));
check(await canEnter(a), '다른 사람이 들어간 뒤에는 다시 들어갈 수 있다');
// 아무도 오지 않는 시간대에 방이 잠겨 버리면 곤란하다
const t = Date.now();
(await q.insertRun.get(b, 1, 0, t));
check(!await canEnter(b, t + SOLO_WAIT_MS - 1000), '5분이 되기 전에는 혼자 다시 못 들어간다');
check(await canEnter(b, t + SOLO_WAIT_MS), '5분이 지나면 혼자서도 들어갈 수 있다');
process.env.DEV_NO_AUTH = '1';
check(await canEnter(b), '혼자 테스트하는 모드에서는 막지 않는다');
delete process.env.DEV_NO_AUTH;

check(JSON.stringify(await bodyOf(a)) === '[]', '처음엔 온몸');
check(JSON.stringify(await saveBodyOnClear(a, ['혀', '혀', '날개', '오른쪽 팔'], false)) === '["혀","오른쪽 팔"]', '나오면 잃은 부위를 그대로 (모르는 이름·중복 제거)');
check(JSON.stringify(await bodyOf(a)) === '["혀","오른쪽 팔"]', '다음에 들어올 때 그대로');
check(JSON.stringify(await saveBodyOnClear(a, Array(5000).fill('혀'), false)) === '["혀","오른쪽 팔"]', '거대한 목록도 알려진 이름만 (이미 잃은 부위는 남는다)');
await saveBodyOnClear(a, ['혀'], true);
check(JSON.stringify(await bodyOf(a)) === '[]', '나오면 돌아온다는 규칙이 있으면 온몸으로');
await saveBodyOnClear(b, ['왼쪽 귀'], false);
await resetBody(b);
check(JSON.stringify(await bodyOf(b)) === '[]', '죽으면 몸은 초기화된다');

await saveBodyOnClear(a, ['혀'], false);
check(JSON.stringify(await saveBodyOnClear(a, [], false)) === '["혀"]', '빈 몸을 보내도 이미 잃은 부위는 돌아오지 않는다');
check(isOpen({ cleared_at: null, died_at: null }) && !isOpen({ cleared_at: 1, died_at: null }) && !isOpen({ cleared_at: null, died_at: 1 }), '끝난 판에는 죽음도 클리어도 다시 기록하지 않는다');

const c = (await q.upsertUser.get('c', 'C', null, Date.now())).id;
check(!await hasReadBook(c), '처음 온 사람은 공책을 읽지 않았다');
await markBookRead(c);
check(await hasReadBook(c) && !await hasReadBook(a), '공책을 열면 그 사람만 읽은 것으로 남는다');
(await q.upsertUser.get('c', 'C2', null, Date.now()));
check(await hasReadBook(c), '다시 로그인해도 읽은 기록은 남는다');

// ── 마리 링크 ────────────────────────────────────────────
// 마리의 make_token() 과 똑같은 계산으로 파이썬에서 만든 기준값. 한쪽만 바뀌면 여기서 깨진다.
const GOLDEN = 'eyJpZCI6IjEyMzQ1Njc4OTAxMjM0NTY3OCIsIm4iOiLrp4jrpqwg7YWM7Iqk7Yq4IiwiZSI6MjAwMDAwMDAwMH0.Nd31-9GN_dViZPQbr3_gLJIDZUXbRp5hunFdtquovgg';
const SEC = 'test-link-secret';
const ok = verifyLink(GOLDEN, SEC, 1999999999);
check(ok?.id === '123456789012345678' && ok.name === '마리 테스트', '마리가 만든 링크를 읽는다 (파이썬 기준값)');
check(verifyLink(GOLDEN, SEC, 2000000000) === null, '만료되면 거절');
check(verifyLink(GOLDEN, 'other-secret', 1) === null, '다른 비밀값이면 거절');
const [gb, gm] = GOLDEN.split('.');
check(verifyLink(`${gb}x.${gm}`, SEC, 1) === null && verifyLink(`${gb}.${gm.slice(0, -1)}A`, SEC, 1) === null, '변조되면 거절');
for (const bad of ['', 'abc', '.', 'a.b.c', null, undefined, 123]) check(verifyLink(bad, SEC, 1) === null, `이상한 모양은 거절 ${JSON.stringify(bad)}`);
check(verifyLink(GOLDEN, '', 1) === null, '비밀값이 없으면 아무 링크도 받지 않는다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
