// 저장소 계층. D1 과 같은 비동기 모양을 node(better-sqlite3)로 흉내 내 확인한다.
import { nodeStore } from '../src/store.js';
import { useStore, q, loadAppliedRules } from '../src/db.js';

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

useStore(await nodeStore());
const u = await q.upsertUser.get('111', '가', null, 1);
check(u?.id === 1 && u.username === '가', 'RETURNING 으로 넣은 행을 돌려준다');
const u2 = await q.upsertUser.get('111', '가2', null, 2);
check(u2.id === 1 && u2.username === '가2', '같은 디스코드 ID 는 이름만 갱신');
check((await q.userById.get(999)) === null, '없는 행은 null (D1 과 같게)');
check(u.lost_parts === '[]' && u.read_book === 0, '처음부터 몸·공책 칸이 있다');

const run = await q.insertRun.get(1, 42, 0, 10);
await q.insertEntry.get(1, run.id, '가', 'flavor_only', 'r', '[]', 11);
await q.insertEntry.get(1, run.id, '나', 'applied', 'r', '[{"type":"maze.size","value":9}]', 12);
await q.insertEntry.get(1, run.id, '다', 'applied', 'r', '[]', 13);
const rules = await loadAppliedRules();
check(rules.map((r) => r.raw_text).join() === '나,다' && rules[0].effects[0].value === 9, 'applied 만 id 순으로, effects 는 풀어서');
check((await q.allEntries.all()).length === 3, 'all 은 배열');
await q.dieRun.run(20, 3, 4, run.id);
check((await q.runById.get(run.id)).death_x === 3, '사망 좌표 칸이 처음부터 있다');
await q.insertAsset.run('k', 'a,b', 'gemini', '/obj/x.png', 'ready', 1, 'texture');
check((await q.readyAssets.all('texture')).length === 1 && (await q.readyAssets.all('object')).length === 0, '에셋 종류 칸이 처음부터 있다');
check((await q.generatedSince.get('gemini', 0)).n === 1, '집계도 된다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
