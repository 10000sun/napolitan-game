// 브라우저 코드 중 DOM 없이 돌아가는 순수 함수들.
import { nextStep, wanderStep } from '../public/paths.js';
import { RuleEngine } from '../public/rules.js';
import { faceOf, raySegment, wallU } from '../public/geometry.js';
import { TEX, noise, procedural, tintGrime, hexToRgb, wallpaper } from '../public/textures.js';
import { COMBAT, SPECIAL, EVENTS, resolve, available, pickSpecial, attackChance, dodgeChance, monsterSteps, turnCost, rollAttack } from '../public/encounters.js';
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

check(turnCost({ moved: true, slow: true }) === 3, '다리가 없으면 어떤 칸 이동이든 세 턴 (피하기·함정 넘기 포함)');
check(turnCost({ moved: false, slow: true }) === 1, '제자리 행동은 한 턴');
check(turnCost({ moved: true, slow: true, pending: 2 }) === 3 && turnCost({ moved: true, slow: false, pending: 2 }) === 2, '기어가기(2턴)와 다리 없음 중 큰 쪽');

// ── 기하 ────────────────────────────────────────────────
check(faceOf(0, 1, 0) === 2 && faceOf(0, -1, 0) === 0 && faceOf(1, 0, 1) === 3 && faceOf(1, 0, -1) === 1, '광선이 닿은 벽면의 방향');
const hit = raySegment(0, 0, 1, 0, 2, -1, 2, 1);
check(hit && Math.abs(hit.t - 2) < 1e-9 && Math.abs(hit.s - 0.5) < 1e-9, '광선-선분 교점');
check(raySegment(0, 0, 1, 0, 0, 1, 2, 1) === null, '평행이면 없음');
check(raySegment(0, 0, -1, 0, 2, -1, 2, 1) === null, '뒤쪽이면 없음');
check(raySegment(0, 0, 1, 0, 2, 0.5, 2, 1) === null, '끝점 밖이면 없음');

// ── 텍스처 ──────────────────────────────────────────────
check(Math.abs(noise(0, 3.3, 8, 1) - noise(8, 3.3, 8, 1)) < 1e-9, 'noise 는 주기마다 이어진다');
const fl = procedural('floor');
check(fl.length === TEX * TEX * 4, '256×256 RGBA');
let seam = 0;
for (let y = 0; y < TEX; y++) seam = Math.max(seam, Math.abs(fl[(y * TEX) * 4] - fl[(y * TEX + TEX - 1) * 4]));
check(seam < 40, '가로로 이어 붙여도 이음새가 튀지 않는다');
check(JSON.stringify([...procedural('floor')].slice(0, 400)) === JSON.stringify([...fl].slice(0, 400)), '같은 입력이면 같은 텍스처');
const red = procedural('wall', '#aa0000');
check(red[0] > red[1] * 3, '색을 주면 그 톤');
check(JSON.stringify(hexToRgb('#8a3b3b')) === '[138,59,59]' && hexToRgb('red') === null, 'hexToRgb');
const white = new Uint8ClampedArray(TEX * TEX * 4).fill(255);
tintGrime(white, [216, 199, 122], 0);
check(white[0] === 216 && white[1] === 199 && white[2] === 122, '톤을 곱한다');

const plain = wallpaper(new Uint8ClampedArray(TEX * TEX * 4).fill(200));
check(plain[(TEX * (TEX - 4)) * 4] < plain[(TEX * 10) * 4] * 0.7, '벽 사진 아래에 걸레받이');
let stripe = 0;
for (let x = 0; x < TEX; x++) stripe = Math.max(stripe, Math.abs(plain[(TEX * 10 + x) * 4] - plain[(TEX * 10) * 4]));
check(stripe > 5, '벽 사진에 세로 줄무늬');

// 동쪽을 보면 화면 왼쪽이 북쪽(y 작음) → wallX 가 작은 쪽이 왼쪽이라 그대로. 서·남은 뒤집는다.
check(wallU(0, 1, 0, 0.2) === 0.2 && Math.abs(wallU(0, -1, 0, 0.2) - 0.8) < 1e-9, '벽 그림이 거울상이 되지 않는다 (동·서)');
check(Math.abs(wallU(1, 0, 1, 0.2) - 0.8) < 1e-9 && wallU(1, 0, -1, 0.2) === 0.2, '벽 그림이 거울상이 되지 않는다 (남·북)');

check(rollAttack('pistol', false, none, () => 0.79) && !rollAttack('pistol', false, none, () => 0.8), '권총 경계 0.79 성공 / 0.80 실패');
check(rollAttack('bare', true, none, () => 0.29) && !rollAttack('bare', true, none, () => 0.3), '맨손 경계 0.29 성공 / 0.30 실패');
for (const surf of ['floor', 'ceil']) {
  const px = procedural(surf);
  let vs = 0;
  for (let x = 0; x < TEX; x++) vs = Math.max(vs, Math.abs(px[x * 4] - px[((TEX - 1) * TEX + x) * 4]));
  check(vs < 40, `${surf} 세로로 이어 붙여도 이음새가 튀지 않는다`);
}

// ── 규칙 엔진 ────────────────────────────────────────────
const S = (o = {}) => ({ turn: 0, here: new Set(), near: new Set(), seeMonster: false, hp: 100, atDoor: false, ...o });
const say = (t) => [{ act: 'say', text: t }];
let eng = new RuleEngine([
  { on: 'act', target: '고양이', verb: '쓰다듬는다', chance: 1, once: false, do: say('a') },
  { on: 'act', target: '거울', verb: '본다', chance: 1, once: true, do: say('b') },
], () => 0);
check(eng.buttons(new Set(['고양이'])).map((b) => b.i).join() === '0', '대상이 곁에 있을 때만 버튼');
check(eng.act(1)[0].text === 'b' && eng.act(1).length === 0 && eng.buttons(new Set(['거울'])).length === 0, 'once 는 한 번 쓰면 사라진다');
eng = new RuleEngine([{ on: 'start', chance: 0.5, once: false, do: say('s') }], () => 0.5);
check(eng.update(S()).length === 0, 'chance 0.5 에 rng 0.5 는 실패');
eng = new RuleEngine([{ on: 'start', chance: 0.5, once: false, do: say('s') }], () => 0.49);
check(eng.update(S()).length === 1 && eng.update(S()).length === 0, 'start 는 한 번');
eng = new RuleEngine([{ on: 'see_monster', chance: 1, once: false, do: say('m') }], () => 0);
check(eng.update(S({ seeMonster: true })).length === 1, '괴물이 보이면 발동');
check(eng.update(S({ seeMonster: true })).length === 0, '계속 보이는 동안은 다시 발동하지 않는다');
eng.update(S({ seeMonster: false }));
check(eng.update(S({ seeMonster: true })).length === 1, '사라졌다 다시 보이면 또 발동');
eng = new RuleEngine([{ on: 'every', n: 3, chance: 1, once: false, do: say('e') }], () => 0);
const fired = [1, 2, 3, 3, 4, 5, 6].map((turn) => eng.update(S({ turn })).length).join('');
check(fired === '0010001', 'every 3: 3·6턴에 한 번씩 (같은 턴 재평가는 무시)');
eng = new RuleEngine([{ on: 'enter', target: '시체', chance: 1, once: false, do: say('x') }, { on: 'hurt', n: 30, chance: 1, once: false, do: say('h') }], () => 0);
check(eng.update(S({ here: new Set(['시체']), hp: 20 })).length === 2 && eng.update(S({ here: new Set(['시체']), hp: 10 })).length === 0, 'enter·hurt 도 새로 참일 때만');
eng = new RuleEngine([{ on: 'pickup', target: '권총', chance: 1, once: false, do: say('p') }], () => 0);
check(eng.pickup('권총').length === 1 && eng.pickup('칼').length === 0, 'pickup 은 대상이 맞을 때');
eng = new RuleEngine([{ on: 'door', chance: 1, once: false, do: [{ act: 'teleport', to: 'start' }] }], () => 0);
check(eng.update(S({ atDoor: true })).length === 1 && eng.update(S({ atDoor: true })).length === 0, '행동이 부른 상태 변화는 다음 update 에서만 다시 본다 (사슬이 한 번에 돌지 않는다)');

eng = new RuleEngine([{ on: 'every', n: 3, chance: 1, once: false, do: say('e') }], () => 0);
check([1, 4, 7, 8].map((turn) => eng.update(S({ turn })).length).join('') === '0110', 'every: 턴이 3씩 뛰어도 배수를 넘으면 발동');
eng = new RuleEngine([{ on: 'enter', target: '시체', chance: 1, once: false, do: [{ act: 'object', do: 'vanish' }] }], () => 0);
check(eng.update(S({ here: new Set(['시체']) }))[0]?.target === '시체', '자동 발동한 행동도 자기 규칙의 대상을 안다');

eng = new RuleEngine([{ on: 'act', target: '거울', verb: '본다', chance: 0.5, once: true, do: say('b') }], () => 0.9);
check(eng.act(0).length === 0 && eng.buttons(new Set(['거울'])).length === 1, 'once 는 실제로 일어났을 때만 소모된다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
