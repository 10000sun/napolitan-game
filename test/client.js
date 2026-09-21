// 브라우저 코드 중 DOM 없이 돌아가는 순수 함수들.
import { nextStep, wanderStep } from '../public/paths.js';
import { PARTS, BODY_PARTS, pickPart, effectsOf, severityOf, sanitizeParts } from '../public/body.js';

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

// ── 몸 ──────────────────────────────────────────────────
check(BODY_PARTS.join() === '머리카락 한 움큼,왼쪽 새끼손가락,오른쪽 검지손가락,왼쪽 손목,오른쪽 팔,왼쪽 발목,오른쪽 다리,왼쪽 귀,앞니 두 개,오른쪽 눈,혀,신장 하나',
  '부위 순서는 예전 BODY_PARTS 와 같다 (요구 부위 결정론)');
check(severityOf('혀') === 50 && severityOf('머리카락 한 움큼') === 0, '치명도');
check([...effectsOf(['오른쪽 팔', '왼쪽 귀'])].sort().join() === 'deaf,noGrab', '잃은 부위의 효과');
check(pickPart(['오른쪽 팔'], () => 0, 'noGrab') === '왼쪽 손목', '효과로 고르면 그 효과의 남은 부위');
check(pickPart(['오른쪽 팔', '왼쪽 손목'], () => 0, 'noGrab') === '머리카락 한 움큼', '그 효과가 다 없으면 남은 아무 부위');
check(pickPart(BODY_PARTS, () => 0) === null, '다 잃었으면 null');
check(!['오른쪽 팔'].includes(pickPart(['오른쪽 팔'], () => 0.3)), '이미 잃은 부위는 다시 고르지 않는다');
check(JSON.stringify(sanitizeParts(['혀', '혀', '날개', 3, '오른쪽 눈'])) === '["혀","오른쪽 눈"]', '모르는 이름·중복은 버린다');
check(JSON.stringify(sanitizeParts('혀')) === '[]', '배열이 아니면 빈 몸');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
