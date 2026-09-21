// 브라우저 코드 중 DOM 없이 돌아가는 순수 함수들.
import { nextStep, wanderStep } from '../public/paths.js';
import { COMBAT, SPECIAL, EVENTS, resolve, available, pickSpecial, attackChance, dodgeChance, monsterSteps } from '../public/encounters.js';
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

// ── 조우·전투 ────────────────────────────────────────────
const two = [[0.6, 'a'], [0.4, 'b']];
check(resolve(two, () => 0.59) === 'a' && resolve(two, () => 0.6) === 'b', 'resolve: 누적 확률 경계');
check(resolve([[0.3, 'a']], () => 0.9) === 'a', 'resolve: 합이 모자라면 마지막');
const none = new Set();
check(attackChance('pistol', false, none) === 0.8 && attackChance('weapon', true, none) === 0.5 && attackChance('bare', true, none) === 0.3, '권총 80·무기 50·맨손 30');
check(attackChance('weapon', true, new Set(['noGrab'])) === 0.25, '팔이 없으면 근접 절반');
check(attackChance('pistol', false, new Set(['noGrab'])) === 0.8, '팔이 없어도 원거리는 그대로');
check(attackChance('bare', true, new Set(['noGrab', 'blind'])) === 0.075, '눈까지 없으면 또 절반');
check(dodgeChance(none) === 0.65 && dodgeChance(new Set(['slow'])) === 0.35, '회피 65, 다리가 없으면 35');
check(monsterSteps(1) === 2 && monsterSteps(0.3) === 1 && monsterSteps(1.5) === 3, '괴물은 두 칸씩, 속도 배율');
const ctx = (o = {}) => ({ effects: new Set(o.effects || []), corpse: !!o.corpse, weapon: !!o.weapon });
check(available(SPECIAL.monster, ctx({ effects: ['slow'] })).every((s) => !['backstep', 'roll'].includes(s.id)), '다리가 없으면 뒷걸음·구르기 없음');
check(available(SPECIAL.monster, ctx()).every((s) => s.id !== 'shield') && available(SPECIAL.monster, ctx({ corpse: true })).some((s) => s.id === 'shield'), '시체가 있어야 시체 방패');
check(pickSpecial('trap', ctx({ effects: ['slow', 'noGrab'] }), () => 0).id === 'crawl', '조건이 맞는 것 중에서 고른다');
check(pickSpecial('trap', { effects: new Set(), corpse: false, weapon: false, none: true }, () => 0) !== null, '조건 없는 행동은 늘 후보');
const allNext = [...SPECIAL.monster, ...SPECIAL.trap, ...Object.values(EVENTS).flatMap((e) => e.choices)]
  .flatMap((s) => s.outcomes.map(([, r]) => r));
check(allNext.every((r) => !r.next || EVENTS[r.next]), '모든 후속 이벤트가 존재한다');
check(allNext.every((r) => !r.losePart || r.losePart === 'random' || ['deaf', 'noTrigger', 'noGrab', 'slow', 'blind'].includes(r.losePart)), '모든 부위 효과가 존재한다');
check(COMBAT.dodge > COMBAT.bare && SPECIAL.monster.every((s) => s.outcomes[0][0] >= 0.4), '회피가 맨손 공격보다 낫다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
