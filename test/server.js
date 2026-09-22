// 런 규칙. HTTP 없이 함수만 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napo-runs-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
delete process.env.DEV_NO_AUTH;

const { q } = await import('../src/db.js');
const { canEnter, bodyOf, saveBodyOnClear, resetBody, isOpen, hasReadBook, markBookRead } = await import('../src/runs.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

const a = q.upsertUser.get('a', 'A', null, Date.now()).id;
const b = q.upsertUser.get('b', 'B', null, Date.now()).id;
check(canEnter(a), '아무도 들어간 적 없으면 들어갈 수 있다');
q.insertRun.get(a, 1, 0, Date.now());
check(!canEnter(a), '방금 내가 들어갔으면 다시 못 들어간다');
check(canEnter(b), '다른 사람은 들어갈 수 있다');
q.insertRun.get(b, 1, 0, Date.now());
check(canEnter(a), '다른 사람이 들어간 뒤에는 다시 들어갈 수 있다');
process.env.DEV_NO_AUTH = '1';
check(canEnter(b), '혼자 테스트하는 모드에서는 막지 않는다');
delete process.env.DEV_NO_AUTH;

check(JSON.stringify(bodyOf(a)) === '[]', '처음엔 온몸');
check(JSON.stringify(saveBodyOnClear(a, ['혀', '혀', '날개', '오른쪽 팔'], false)) === '["혀","오른쪽 팔"]', '나오면 잃은 부위를 그대로 (모르는 이름·중복 제거)');
check(JSON.stringify(bodyOf(a)) === '["혀","오른쪽 팔"]', '다음에 들어올 때 그대로');
check(JSON.stringify(saveBodyOnClear(a, Array(5000).fill('혀'), false)) === '["혀","오른쪽 팔"]', '거대한 목록도 알려진 이름만 (이미 잃은 부위는 남는다)');
saveBodyOnClear(a, ['혀'], true);
check(JSON.stringify(bodyOf(a)) === '[]', '나오면 돌아온다는 규칙이 있으면 온몸으로');
saveBodyOnClear(b, ['왼쪽 귀'], false);
resetBody(b);
check(JSON.stringify(bodyOf(b)) === '[]', '죽으면 몸은 초기화된다');

saveBodyOnClear(a, ['혀'], false);
check(JSON.stringify(saveBodyOnClear(a, [], false)) === '["혀"]', '빈 몸을 보내도 이미 잃은 부위는 돌아오지 않는다');
check(isOpen({ cleared_at: null, died_at: null }) && !isOpen({ cleared_at: 1, died_at: null }) && !isOpen({ cleared_at: null, died_at: 1 }), '끝난 판에는 죽음도 클리어도 다시 기록하지 않는다');

const c = q.upsertUser.get('c', 'C', null, Date.now()).id;
check(!hasReadBook(c), '처음 온 사람은 공책을 읽지 않았다');
markBookRead(c);
check(hasReadBook(c) && !hasReadBook(a), '공책을 열면 그 사람만 읽은 것으로 남는다');
q.upsertUser.get('c', 'C2', null, Date.now());
check(hasReadBook(c), '다시 로그인해도 읽은 기록은 남는다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
