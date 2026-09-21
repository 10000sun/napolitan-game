// 브라우저 코드 중 DOM 없이 돌아가는 순수 함수들.
import { nextStep, wanderStep } from '../public/paths.js';

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

// 0 바닥 1 벽
const G = [
  [1, 1, 1, 1, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 0, 1],
  [1, 0, 0, 0, 1],
  [1, 1, 1, 1, 1],
];
const isFloor = (x, y) => G[y]?.[x] === 0;

check(JSON.stringify(nextStep(isFloor, { x: 1, y: 3 }, { x: 1, y: 1 })) === '{"x":2,"y":3}', 'follow: 벽을 돌아가는 최단 경로의 첫 칸');
check(nextStep(isFloor, { x: 2, y: 1 }, { x: 1, y: 1 }) === null, 'follow: 바로 옆이면 그 칸에 들어가지 않는다');
check(nextStep(isFloor, { x: 1, y: 3 }, { x: 1, y: 1 }, (x, y) => x === 3 && y === 2) === null, 'follow: 길이 막히면 제자리');
check(JSON.stringify(wanderStep(isFloor, { x: 2, y: 1 }, () => 0.1)) === '{"x":2,"y":1}', 'wander: 절반은 제자리');
const seq = [0.9, 0.99]; let i = 0;
const w = wanderStep(isFloor, { x: 2, y: 1 }, () => seq[i++]);
check(isFloor(w.x, w.y) && Math.abs(w.x - 2) + Math.abs(w.y - 1) === 1, 'wander: 나머지는 인접 바닥으로');
check(JSON.stringify(wanderStep(() => false, { x: 2, y: 1 }, () => 0.9)) === '{"x":2,"y":1}', 'wander: 갈 곳이 없으면 제자리');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
