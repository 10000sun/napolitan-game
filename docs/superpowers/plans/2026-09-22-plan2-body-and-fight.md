# 계획 2: 몸과 싸움 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 신체 부위가 게임에 영향을 주고 다음 판으로 이어지며, 괴물·함정 앞에서 텍스트 어드벤처식 선택과 후속 이벤트가 벌어지고, 공격은 운(권총 80%·무기 50%·맨손 30%), 회피가 정답이 되게 한다. 연속 입장을 막고, 미니맵은 지도가 있을 때만, 배고픔은 없앤다.

**Architecture:** 규칙 데이터와 판정은 DOM 없는 순수 모듈 `public/body.js`·`public/encounters.js` 에 둔다 (서버도 `body.js` 를 import). 서버의 런 규칙(연속 입장·몸 저장)은 `src/runs.js` 함수로 떼어 테스트한다. `game.js` 는 이 모듈들을 불러 선택지·결과를 만든다.

**Tech Stack:** Node 20 ESM, express, better-sqlite3 12, Canvas 2D. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-22-literal-guestbook-backrooms-design.md` §9~§15, §16 의 `IMAGE_DAILY_LIMIT`.

## Global Constraints

- 부위 표 순서는 `src/world.js` 의 기존 `BODY_PARTS` 와 **같다** (`demandedPart` 결정론, 스냅샷 테스트).
- 공격 성공률: 권총 0.8, 그 밖의 무기 0.5, 맨손 0.3. `noGrab` 이면 근접 ×0.5, `blind` 이면 전부 ×0.5.
- 회피 기본 65%, `slow` 이면 35%. 특수 행동은 표대로.
- 괴물 턴당 이동 `max(1, round(2 × monsterSpeed))`. `slow` 이면 칸 이동이 3턴.
- 함정 알아채기: 지도에 함정 표시 → 항상, 아니면 5%.
- 연속 입장 금지는 `DEV_NO_AUTH=1` 에서 끈다.
- 몸 저장: 클리어 시 알려진 부위 이름만, `healOnExit` 이면 비움. 죽으면 비움.
- 문이 요구하는 부위를 이미 잃었으면 **나갈 수 없다.** 내려놓을 부위가 다 떨어져도 문은 열리지 않는다 (절망이 의도다).
- 텍스트는 게임 안의 목소리, 한국어.

## Review Focus

1. 이전 판에서 이미 잃은 부위만 남은 상태로 입장 → 선택지·효과가 처음부터 적용되고, 시작 체력은 100 (다시 깎지 않는다). → Task 5 (수동) + Task 1 테스트 (`effectsOf`).
2. 문이 요구하는 부위를 이미 잃음 → 몇 번을 잘라도 문은 열리지 않고, 다 잘리면 "더 내려놓을 것이 없다" 후 그대로. → Task 7 수동 확인.
3. 클라이언트가 모르는 부위 이름·중복·거대한 배열을 `/clear` 로 보냄 → 알려진 이름만, 중복 없이 저장. → Task 3 테스트.
4. 조건(`needs`)을 만족하는 특수 행동이 하나도 없음 → 특수 행동 없이 기본 선택지만. → Task 2 테스트.
5. 처음 입장자(런 0개), 다른 사람 1명 뒤, 연속 2회 → 허용/허용/거부. → Task 3 테스트.

---

## File Structure

| 파일 | 역할 |
|---|---|
| `public/body.js` (신규) | 부위 표, `pickPart`, `effectsOf`, `sanitizeParts` |
| `public/encounters.js` (신규) | `COMBAT`, `SPECIAL`, `EVENTS`, `resolve`, `available`, `pickSpecial`, `attackChance`, `dodgeChance`, `monsterSteps` |
| `src/runs.js` (신규) | `canEnter(userId)`, `saveBodyOnClear(userId, parts, healOnExit)`, `resetBody(userId)`, `bodyOf(userId)` |
| `src/db.js` | `users.lost_parts` 컬럼, 쿼리 |
| `src/world.js` | `BODY_PARTS` 를 `body.js` 에서 가져온다 |
| `src/effects.js` | `rule.hunger` 제거 |
| `src/server.js` | `/api/me` 에 `canEnter`·`lostParts`, `/run/start` 409·`body`, `/clear`·`/die` 몸 저장 |
| `public/game.js` | 몸 효과, 부위 잃기, 조우·이벤트, 전투, 회피, 괴물 2칸, 함정 알아채기, 배고픔 제거, 미니맵 |
| `public/ui.js`, `public/index.html` | 현관 몸 상태·입장 불가 문구, HUD, `/clear` 에 부위 전송 |
| `test/client.js`, `test/server.js`(신규), `test/replay.js`, `package.json` | 테스트 |
| `.env.example`, `src/assets.js`, `README.md` | `IMAGE_DAILY_LIMIT` 기본 5 |

---

### Task 1: 부위 표 (`public/body.js`)

**Files:** Create `public/body.js`; Modify `src/world.js`, `test/client.js`

**Interfaces — Produces:**
- `PARTS: Array<{ name, severity, effect: null | 'deaf'|'noTrigger'|'noGrab'|'slow'|'blind' }>` (기존 `BODY_PARTS` 순서)
- `BODY_PARTS: string[]` (= `PARTS.map(p => p.name)`)
- `pickPart(lost: string[], rng, effect?: string) → string | null` — 남은 것 중. `effect` 가 있으면 그 효과의 남은 부위 우선, 없으면 남은 아무 부위.
- `effectsOf(lost: string[]) → Set<string>`
- `severityOf(name) → number`
- `sanitizeParts(list) → string[]` — 배열 아니면 `[]`, 알려진 이름만, 중복 제거, 순서 유지.

- [ ] **Step 1: 실패하는 테스트** — `test/client.js` 의 `console.log(fail === 0` 위, 그리고 맨 위 import 에 추가:

```js
import { PARTS, BODY_PARTS, pickPart, effectsOf, severityOf, sanitizeParts } from '../public/body.js';
```

```js
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
```

- [ ] **Step 2: 실패 확인** — `node test/client.js` → `Cannot find module '../public/body.js'`

- [ ] **Step 3: 구현** — `public/body.js`

```js
// ─────────────────────────────────────────────────────────────
// 몸
//
// 잘려 나간 부위는 이곳에서의 몸을 바꾼다. 다음에 들어올 때도 그대로다.
// 서버(world.js)도 이 파일을 읽는다. 순서를 바꾸면 이미 굴러간 방의
// "문이 요구하는 부위" 가 바뀌니 순서는 건드리지 않는다.
// ─────────────────────────────────────────────────────────────

export const PARTS = [
  { name: '머리카락 한 움큼', severity: 0, effect: null },
  { name: '왼쪽 새끼손가락', severity: 5, effect: null },
  { name: '오른쪽 검지손가락', severity: 10, effect: 'noTrigger' },
  { name: '왼쪽 손목', severity: 20, effect: 'noGrab' },
  { name: '오른쪽 팔', severity: 35, effect: 'noGrab' },
  { name: '왼쪽 발목', severity: 20, effect: 'slow' },
  { name: '오른쪽 다리', severity: 35, effect: 'slow' },
  { name: '왼쪽 귀', severity: 10, effect: 'deaf' },
  { name: '앞니 두 개', severity: 5, effect: null },
  { name: '오른쪽 눈', severity: 30, effect: 'blind' },
  { name: '혀', severity: 50, effect: null },
  { name: '신장 하나', severity: 40, effect: null },
];

export const BODY_PARTS = PARTS.map((p) => p.name);
const BY_NAME = new Map(PARTS.map((p) => [p.name, p]));

export const severityOf = (name) => BY_NAME.get(name)?.severity ?? 0;

export function effectsOf(lost) {
  return new Set(lost.map((n) => BY_NAME.get(n)?.effect).filter(Boolean));
}

/** 남은 부위 중 하나. effect 를 주면 그 효과를 가진 부위를 먼저. 다 잃었으면 null. */
export function pickPart(lost, rng = Math.random, effect) {
  const left = PARTS.filter((p) => !lost.includes(p.name));
  if (!left.length) return null;
  const pool = effect ? left.filter((p) => p.effect === effect) : [];
  const from = pool.length ? pool : left;
  return from[Math.floor(rng() * from.length)].name;
}

/** 밖에서 들어온 목록을 믿을 수 있게. 알려진 이름만, 중복 없이. */
export function sanitizeParts(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((n) => BY_NAME.has(n)))];
}
```

`src/world.js`: `const BODY_PARTS = [ ... ];` 정의 블록(4줄)을 지우고 파일 위 import 에 추가:

```js
import { BODY_PARTS } from '../public/body.js';
```

파일 끝의 `export { BODY_PARTS };` 는 그대로 둔다 (re-export).

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 네 번 (스냅샷 테스트가 요구 부위 결정론을 지켜 준다)

- [ ] **Step 5: 커밋** — `git add public/body.js src/world.js test/client.js && git commit -m "신체 부위 표를 한 곳에 둔다"`

---

### Task 2: 조우·전투 규칙 (`public/encounters.js`)

**Files:** Create `public/encounters.js`; Modify `test/client.js`

**Interfaces — Produces:**
- `COMBAT = { pistol: 0.8, weapon: 0.5, bare: 0.3, counterDamage: 25, counterPartChance: 0.3, dodge: 0.65, dodgeSlow: 0.35, dodgeFailDamage: 15 }`
- `SPECIAL = { monster: [...], trap: [...] }`, `EVENTS = { grabbed_ankle, face_to_face }` (스펙 §12.3 그대로)
- `resolve(outcomes: Array<[p, result]>, rng) → result` — 누적 확률, `rng() < 누적` 인 첫 결과. 합이 1 미만이면 마지막.
- `available(list, ctx: { effects: Set, corpse: bool, weapon: bool }) → list` — `needs` 전부 만족하는 것. `'!x'` 는 효과 x 가 없어야, `'corpse'`·`'weapon'` 은 ctx 값.
- `pickSpecial(kind: 'monster'|'trap', ctx, rng) → special | null`
- `attackChance(weapon: 'pistol'|'weapon'|'bare', melee: bool, effects: Set) → number`
- `dodgeChance(effects) → number`
- `monsterSteps(speed) → number`

- [ ] **Step 1: 실패하는 테스트** — `test/client.js` 에 import 추가 + 본문

```js
import { COMBAT, SPECIAL, EVENTS, resolve, available, pickSpecial, attackChance, dodgeChance, monsterSteps } from '../public/encounters.js';
```

```js
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
```

- [ ] **Step 2: 실패 확인** — `node test/client.js` → `Cannot find module '../public/encounters.js'`

- [ ] **Step 3: 구현** — `public/encounters.js`

```js
// ─────────────────────────────────────────────────────────────
// 조우
//
// 괴물은 덩치가 크다. 성인 남자가 맞붙어도 열에 일곱은 진다.
// 그래서 정답은 대개 피하는 쪽이다. 권총만은 예외다
// ("권총 쓴 새끼 천사인가 진짜 고맙다 덕분에 살았다").
// 확률과 문구는 설계 문서 §12·§15 의 표가 기준이다.
// ─────────────────────────────────────────────────────────────

export const COMBAT = {
  pistol: 0.8, weapon: 0.5, bare: 0.3,
  counterDamage: 25, counterPartChance: 0.3,
  dodge: 0.65, dodgeSlow: 0.35, dodgeFailDamage: 15,
};

export const SPECIAL = {
  monster: [
    { id: 'backstep', label: '뒷걸음질 친다', needs: ['!slow'],
      outcomes: [[0.6, { text: '한 걸음 물러났다. 그것의 손끝이 코앞을 스친다.', move: 'back' }],
                 [0.4, { text: '발이 걸려 넘어졌다.', damage: 15, next: 'grabbed_ankle' }]] },
    { id: 'roll', label: '옆으로 굴러서 피한다', needs: ['!slow'],
      outcomes: [[0.7, { text: '옆으로 굴렀다. 그것이 허공을 할퀸다.', move: 'side' }],
                 [0.3, { text: '구르다 벽에 부딪혔다. 그것이 팔을 물었다.', losePart: 'noGrab' }]] },
    { id: 'freeze', label: '숨을 죽이고 가만히 있는다', needs: [],
      outcomes: [[0.5, { text: '그것이 고개를 갸웃하더니 등을 돌린다.', monster: 'flee' }],
                 [0.5, { text: '그것이 얼굴을 바싹 들이댄다.', next: 'face_to_face' }]] },
    { id: 'scream', label: '소리를 질러 위협한다', needs: [],
      outcomes: [[0.4, { text: '그것이 움찔하며 어둠 속으로 물러난다.', monster: 'flee' }],
                 [0.6, { text: '그것이 더 크게 비명을 질렀다.', monster: 'enrage', damage: 20 }]] },
    { id: 'shield', label: '시체를 방패처럼 들이민다', needs: ['corpse'],
      outcomes: [[0.8, { text: '그것이 시체를 물고 늘어진다.', monster: 'stun', useCorpse: true }],
                 [0.2, { text: '시체째로 밀려 넘어졌다.', damage: 20 }]] },
  ],
  trap: [
    { id: 'wallkick', label: '벽을 박차고 뛰어넘는다', needs: ['!slow'],
      outcomes: [[0.7, { text: '벽을 차고 날아올라 틈 너머에 착지했다.', move: 'over' }],
                 [0.3, { text: '발이 미끄러졌다.', trap: 'spring' }]] },
    { id: 'crawl', label: '엎드려 기어서 지나간다', needs: [],
      outcomes: [[0.9, { text: '배를 바닥에 붙이고 틈 가장자리를 지났다.', move: 'over', turns: 2 }],
                 [0.1, { text: '손을 짚은 곳이 꺼졌다.', trap: 'spring' }]] },
    { id: 'throw', label: '시체를 던져 함정을 작동시킨다', needs: ['corpse'],
      outcomes: [[1.0, { text: '시체가 틈에 삼켜졌다. 바닥이 닫힌다.', trap: 'disarm', useCorpse: true }]] },
    { id: 'probe', label: '손으로 더듬어 틈을 살핀다', needs: ['!noGrab'],
      outcomes: [[0.6, { text: '틈의 모양을 알아냈다. 이제 밟지 않을 수 있다.', trap: 'disarm' }],
                 [0.4, { text: '틈이 손을 물었다.', losePart: 'noGrab' }]] },
  ],
};

// 후속 이벤트. 이 동안은 일반 선택지가 사라지고 이벤트 선택지만 보인다.
export const EVENTS = {
  grabbed_ankle: { text: '차가운 손이 발목을 붙잡았다.', choices: [
    { label: '다른 발로 걷어찬다', needs: [],
      outcomes: [[0.5, { text: '손아귀가 풀렸다.', monster: 'stun' }], [0.5, { text: '발목이 꺾였다.', losePart: 'slow' }]] },
    { label: '무기로 내려친다', needs: ['weapon'],
      outcomes: [[0.8, { text: '손목이 잘려 나가며 발목이 풀렸다.', monster: 'stun' }], [0.2, { text: '빗나갔다.', losePart: 'slow' }]] },
    { label: '발목을 포기한다', needs: [],
      outcomes: [[1.0, { text: '발목을 두고 기어서 빠져나왔다.', losePart: 'slow', move: 'back' }]] },
  ] },
  face_to_face: { text: '숨결이 닿는다. 그것의 눈이 당신의 눈을 들여다본다.', choices: [
    { label: '눈을 감는다', needs: [],
      outcomes: [[0.6, { text: '한참 뒤, 기척이 사라졌다.', monster: 'flee' }], [0.4, { text: '눈꺼풀 위로 무언가 파고들었다.', losePart: 'blind' }]] },
    { label: '마주 본다', needs: [],
      outcomes: [[0.3, { text: '그것이 먼저 눈을 돌렸다.', monster: 'flee' }], [0.7, { text: '그것이 웃었다.', damage: 30 }]] },
  ] },
};

export function resolve(outcomes, rng = Math.random) {
  const r = rng();
  let acc = 0;
  for (const [p, result] of outcomes) {
    acc += p;
    if (r < acc) return result;
  }
  return outcomes[outcomes.length - 1][1];
}

export function available(list, ctx) {
  return list.filter((s) => (s.needs || []).every((n) => {
    if (n.startsWith('!')) return !ctx.effects.has(n.slice(1));
    return !!ctx[n];
  }));
}

export function pickSpecial(kind, ctx, rng = Math.random) {
  const list = available(SPECIAL[kind], ctx);
  return list.length ? list[Math.floor(rng() * list.length)] : null;
}

export function attackChance(weapon, melee, effects) {
  let p = COMBAT[weapon] ?? COMBAT.bare;
  if (melee && effects.has('noGrab')) p *= 0.5;
  if (effects.has('blind')) p *= 0.5;
  return p;
}

export const dodgeChance = (effects) => (effects.has('slow') ? COMBAT.dodgeSlow : COMBAT.dodge);
export const monsterSteps = (speed = 1) => Math.max(1, Math.round(2 * speed));
```

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 네 번
- [ ] **Step 5: 커밋** — `git add public/encounters.js test/client.js && git commit -m "조우·전투 규칙을 데이터로 둔다"`

---

### Task 3: 서버 — 연속 입장 금지·몸 저장

**Files:** Create `src/runs.js`, `test/server.js`; Modify `src/db.js`, `src/server.js`, `package.json`

**Interfaces:**
- Consumes: `sanitizeParts` (Task 1)
- Produces:
  - `canEnter(userId) → bool` (`DEV_NO_AUTH=1` 이면 항상 true)
  - `bodyOf(userId) → string[]`
  - `saveBodyOnClear(userId, parts, healOnExit) → string[]`
  - `resetBody(userId)`
  - API: `/api/me` → `{ ..., canEnter, lostParts }`; `/api/run/start` 거부 시 `409 { error }`, 성공 시 `{ runId, world, body: { lostParts } }`; `/clear` 본문 `{ lostParts }`; `/die` 는 몸을 비운다.

- [ ] **Step 1: DB** — `src/db.js` 의 death 컬럼 마이그레이션 블록 아래:

```js
// 잃은 부위. 다음에 들어올 때도 그대로다.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('lost_parts')) db.exec("ALTER TABLE users ADD COLUMN lost_parts TEXT NOT NULL DEFAULT '[]'");
```

`q` 에 추가:

```js
  lastRun: db.prepare('SELECT user_id FROM runs ORDER BY id DESC LIMIT 1'),
  bodyOf: db.prepare('SELECT lost_parts FROM users WHERE id = ?'),
  setBody: db.prepare('UPDATE users SET lost_parts = ? WHERE id = ?'),
```

- [ ] **Step 2: 실패하는 테스트** — `test/server.js`

```js
// 런 규칙. HTTP 없이 함수만 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napo-runs-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
delete process.env.DEV_NO_AUTH;

const { q } = await import('../src/db.js');
const { canEnter, bodyOf, saveBodyOnClear, resetBody } = await import('../src/runs.js');

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
check(JSON.stringify(saveBodyOnClear(a, Array(5000).fill('혀'), false)) === '["혀"]', '거대한 목록도 알려진 이름만');
saveBodyOnClear(a, ['혀'], true);
check(JSON.stringify(bodyOf(a)) === '[]', '나오면 돌아온다는 규칙이 있으면 온몸으로');
saveBodyOnClear(b, ['왼쪽 귀'], false);
resetBody(b);
check(JSON.stringify(bodyOf(b)) === '[]', '죽으면 몸은 초기화된다');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
```

`package.json` 의 `"test"` 끝에 ` && node test/server.js` 추가.

- [ ] **Step 3: 실패 확인** — `node test/server.js` → `Cannot find module '../src/runs.js'`

- [ ] **Step 4: 구현** — `src/runs.js`

```js
// 런 규칙. 연속 입장 금지와 몸 상태.
import { q } from './db.js';
import { sanitizeParts } from '../public/body.js';

/** 가장 최근에 시작된 런이 내 것이면 들어갈 수 없다. 방명록을 혼자 차지하지 못하게. */
export function canEnter(userId) {
  if (process.env.DEV_NO_AUTH === '1') return true;
  const last = q.lastRun.get();
  return !last || last.user_id !== userId;
}

export function bodyOf(userId) {
  try { return sanitizeParts(JSON.parse(q.bodyOf.get(userId)?.lost_parts || '[]')); } catch { return []; }
}

/** 나올 때의 몸을 남긴다. 나오면 돌아온다는 규칙이 있으면 온몸으로. */
export function saveBodyOnClear(userId, parts, healOnExit) {
  const body = healOnExit ? [] : sanitizeParts(parts);
  q.setBody.run(JSON.stringify(body), userId);
  return body;
}

/** 죽으면 몸은 그 자리에 남고, 다음에 들어오는 몸은 새것이다. */
export function resetBody(userId) {
  q.setBody.run('[]', userId);
}
```

`src/server.js`:
- import: `import { canEnter, bodyOf, saveBodyOnClear, resetBody } from './runs.js';`
- `/api/me` 응답에 `canEnter: u ? canEnter(u.id) : false, lostParts: u ? bodyOf(u.id) : [],` 추가.
- `/api/run/start` 핸들러 첫 줄:

```js
  if (!canEnter(req.user.id)) return res.status(409).json({ error: '문이 열리지 않는다. 다른 누군가가 먼저 들어가야 한다.' });
```

  응답을 `res.json({ runId: run.id, world, body: { lostParts: bodyOf(req.user.id) } });` 로.
- `/clear` 의 `q.clearRun.run(...)` 아래:

```js
  const rules = loadAppliedRules().slice(0, run.rule_count);
  const healOnExit = foldEffects(rules.map((r) => r.effects)).healOnExit;
  saveBodyOnClear(req.user.id, req.body?.lostParts, healOnExit);
```

- `/die` 의 `q.dieRun.run(...)` 아래: `resetBody(req.user.id);`

- [ ] **Step 5: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 6: 커밋** — `git add src/db.js src/runs.js src/server.js test/server.js package.json && git commit -m "연속 입장을 막고 잃은 부위를 다음 판으로 넘긴다"`

---

### Task 4: 배고픔 제거·이미지 한도 5

**Files:** Modify `src/effects.js`, `test/replay.js`, `.env.example`, `src/assets.js`, `README.md`

- [ ] **Step 1: 실패하는 테스트** — `test/replay.js` 의 `// ── 말 그대로: 배치` 위:

```js
check(!('hunger' in foldEffects([[{ type: 'rule.hunger', seconds: 60 }]])), '배고픔은 더 이상 없다 (옛 규칙은 버린다)');
```

같은 파일의 스냅샷 비교를 배고픔 필드만 빼고 비교하도록 바꾼다:

```js
const { objects: _o2, ...snapOld } = snap;
delete snapOld.state.hunger;
```

- [ ] **Step 2: 실패 확인** — `node test/replay.js` → `✗ 배고픔은 더 이상 없다`
- [ ] **Step 3: 구현**
  - `src/effects.js`: `'rule.hunger': { ... },` 항목 삭제, `initialState()` 의 `hunger: 0,` 삭제.
  - `src/assets.js`: `process.env.IMAGE_DAILY_LIMIT ?? 20` → `?? 5`.
  - `.env.example`: `IMAGE_DAILY_LIMIT=20` → `IMAGE_DAILY_LIMIT=5`, 그 위 주석 "하루 IMAGE_DAILY_LIMIT 장" 그대로.
  - `README.md`: "한도 20장이면 하루 최대 약 $0.7" → "한도 5장이면 하루 최대 약 $0.17 (약 230원)".
- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add src/effects.js src/assets.js test/replay.js .env.example README.md && git commit -m "배고픔을 없애고 이미지 생성은 하루 5장으로"`

---

### Task 5: 게임 — 몸

**Files:** Modify `public/game.js`, `test/client.js`

**Interfaces — Consumes:** `PARTS`, `pickPart`, `effectsOf`, `severityOf` (Task 1), `world` 와 함께 넘어오는 `body.lostParts` (Task 3). `Game` 생성자 시그니처는 `new Game(world, canvas, minimap, hooks, body = { lostParts: [] })`.

- [ ] **Step 1: import·상태**
  - 맨 위: `import { BODY_PARTS, pickPart, effectsOf, severityOf } from '/body.js';` 그리고 기존 `const BODY_PARTS = [ ... ];` 블록 삭제.
  - 생성자 시그니처를 `constructor(world, canvas, minimap, hooks = {}, body = { lostParts: [] })` 로.
  - `this.lostParts = [];` → 아래로 교체, `this.turnsLeft = ...` 줄 삭제:

```js
    // 이미 잃고 들어온 부위. 체력은 다시 깎지 않는다.
    this.lostBefore = [...(body.lostParts || [])];
    this.lostParts = [];            // 이번 판에 잃은 것
```

  - 아래 헬퍼를 `ahead()` 위에:

```js
  get allLost() { return [...this.lostBefore, ...this.lostParts]; }
  get fx() { return effectsOf(this.allLost); }
```

- [ ] **Step 2: 부위 잃기** — `damage()` 위에:

```js
  /** 부위 하나를 잃는다. effect 를 주면 그 효과의 부위를 먼저. 치명도만큼 체력이 깎인다. */
  losePart(effect, how) {
    const part = pickPart(this.allLost, Math.random, effect === 'random' ? undefined : effect);
    if (!part) { this.damage(30, `${how || ''} 더 내줄 것이 없다.`.trim()); return null; }
    this.lostParts.push(part);
    const line = `${how ? `${how} ` : ''}${part}을(를) 잃었다.`;
    if (this.s.noPain) this.log(`${line} 아프지 않다.`, 'sys');
    else this.damage(severityOf(part), line);
    return part;
  }
```

- [ ] **Step 3: 함정·출구** — `checkTrap()` 의 마지막 두 줄(`if (this.s.noPain) ... else this.damage(45, ...)`)을:

```js
    this.losePart('random', '함정이다. 바닥에서 솟은 것이 몸을 꿰뚫었다.');
```

  `tryExit()` 를 교체:

```js
  tryExit() {
    if (this.s.exitCost !== 'random_body_part') { this.escape(); return; }
    const part = pickPart(this.allLost);
    // 요구하는 부위를 이미 잃었으면 영영 열리지 않는다. 다 잘려도 마찬가지다.
    if (!part) { this.log('더 내려놓을 것이 없다. 문은 열리지 않는다.', 'bad'); return; }
    this.lostParts.push(part);
    if (part === this.w.demandedPart) {
      this.log(`${part}을(를) 내려놓았다. 문이 열린다.`);
      this.escape();
      return;
    }
    if (this.s.noPain) this.log(`${part}을(를) 잘라 내려놓았다. 아프지 않다. 문은 그대로다.`, 'sys');
    else this.damage(severityOf(part), `${part}을(를) 잘라 내려놓았다. 문은 열리지 않는다.`);
  }
```

  `escape()`·`die()` 의 `onEnd` 에 `lostParts: this.allLost` 를 넘긴다 (이번 판 것만이 아니라 전부).

- [ ] **Step 4: 효과**
  - `noGrab`: `buildChoices()` 의 줍기·도구·시체 선택지에 `disabled: this.fx.has('noGrab'), hint: this.fx.has('noGrab') ? '팔이 없다' : undefined` 를 붙인다.
  - `noTrigger`: `shoot` 선택지에 `disabled: this.fx.has('noTrigger'), hint: this.fx.has('noTrigger') ? '방아쇠를 당길 손가락이 없다' : `${this.ammo}발 남음``.
  - `slow`: `choose()` 의 `if (spendsTurn) this.endTurn();` 를

```js
    if (spendsTurn) {
      // 다리가 없으면 한 칸 옮기는 데 세 턴이 걸린다.
      const turns = (id === 'forward' && this.fx.has('slow')) ? 3 : (this.pendingTurns || 1);
      this.pendingTurns = 0;
      for (let i = 0; i < turns && !this.dead; i++) this.endTurn();
    }
```

  - `deaf`: `moveMonsters()` 끝의 `if (near) { ... }` 를 `if (near && !this.fx.has('deaf')) { ... }` 로. `this.audio` 호출 전부를 감싸는 대신, 생성자에서 `if (effectsOf(this.lostBefore).has('deaf')) this.audio.muted = true;` 를 두고 `Audio2.blip` 첫 줄에 `if (this.muted) return;` 을 넣는다. 판 도중 귀를 잃으면 `losePart` 끝에서 `if (this.fx.has('deaf')) this.audio.muted = true;`.
  - `blind`:
    - `render()` 의 벽 안개 `5.0 / d` 를 `(this.fx.has('blind') ? 1.2 : 5.0) / d` 로, 천장·바닥 그라데이션 `f` 에 `* (this.fx.has('blind') ? 0.35 : 1)` 를 곱한다.
    - `drawSprites()` 에서 `if (ty <= 0.25) continue;` 아래 `if (this.fx.has('blind') && ty > 1.5) continue;`.
    - `describe()`: 맨 앞에 `const blind = this.fx.has('blind');`. 괴물 서술은 `blind` 이고 `sight.dist > 1` 이면 생략, `dist === 1` 이면 "바로 앞에 무언가 있다." 로. 앞 칸 물체 이름은 `blind` 이면 "무언가". 긴 복도 서술은 `blind` 이면 "앞이 잘 보이지 않는다." 하나로.
- `_intro()` 의 배고픔 줄 삭제, 대신 `if (this.lostBefore.length) this.log(`${this.lostBefore.join(', ')} 없이 들어왔다.`, 'sys');`.
- `endTurn()` 의 배고픔 블록(`if (this.turnsLeft > 0) { ... }`) 삭제. `hudState()` 의 `turnsLeft` 를 `lost: this.allLost` 로.

- [ ] **Step 5: 확인** — `npm test` → `전부 통과` 다섯 번, `node --check public/game.js`
- [ ] **Step 6: 커밋** — `git add public/game.js && git commit -m "잃은 부위가 몸을 바꾼다"`

---

### Task 6: 게임 — 조우·전투·괴물 2칸·함정 알아채기

**Files:** Modify `public/game.js`

**Interfaces — Consumes:** Task 2 전부.

- [ ] **Step 1: import·상태** — 맨 위에 `import { COMBAT, EVENTS, resolve, pickSpecial, attackChance, dodgeChance, monsterSteps } from '/encounters.js';`. 생성자에:

```js
    this.event = null;              // 진행 중인 후속 이벤트 { id, monster }
    this.specials = new Map();      // 조우 대상 id → 뽑힌 특수 행동 (한 번만 뽑는다)
    this.noticed = new Map();       // 함정 id → 알아챘는지 (한 번만 굴린다)
    this.rangedIsPistol = false;
```

  `takeItem()` 의 pistol 분기에 `this.rangedIsPistol = true;`, `takeTool()` 의 ranged 분기에 `this.rangedIsPistol = false;`. 괴물 객체에 `stun: 0` 추가 (`this.monsters = world.monsters.map(...)` 의 필드).

- [ ] **Step 2: 헬퍼**

```js
  encounterCtx() {
    return { effects: this.fx, corpse: this.carriedCorpse > 0, weapon: this.hasKnife || this.hasPistol };
  }

  specialFor(key, kind) {
    if (!this.specials.has(key)) this.specials.set(key, pickSpecial(kind, this.encounterCtx()));
    return this.specials.get(key);
  }

  /** 앞 칸 함정을 알아챘는가. 지도에 표시되면 항상, 아니면 5%. 함정마다 한 번만 굴린다. */
  trapAhead() {
    const a = this.ahead();
    const t = this.traps.find((t) => !t.sprung && t.x === a.x && t.y === a.y);
    if (!t) return null;
    if (!this.noticed.has(t.id)) this.noticed.set(t.id, this.s.mapTraps || Math.random() < 0.05);
    return this.noticed.get(t.id) ? t : null;
  }
```

- [ ] **Step 3: 선택지** — `buildChoices()` 맨 앞(`const out = [];` 다음):

```js
    if (this.event) {
      const ev = EVENTS[this.event.id];
      ev.choices.forEach((c, i) => {
        const ok = (c.needs || []).every((n) => (n.startsWith('!') ? !this.fx.has(n.slice(1)) : !!this.encounterCtx()[n]));
        if (ok) out.push({ id: `ev:${i}`, label: c.label, kind: 'fight' });
      });
      return out;
    }
```

  `if (sight) { ... }` 블록 끝(닫는 중괄호 직전)에:

```js
      if (sight.dist === 1) {
        const sideFree = [1, 3].some((t) => { const [dx, dy] = DIRS[(this.facing + t) % 4]; return !this.wall(this.cx + dx, this.cy + dy); });
        out.push({ id: 'dodge', label: sideFree ? '몸을 피한다' : '뒤로 물러선다', kind: 'move' });
        const sp = this.specialFor(sight.m.id, 'monster');
        if (sp) out.push({ id: `sp:${sight.m.id}`, label: sp.label, kind: 'move' });
      }
```

  `if (sight) {` 블록 **뒤**에:

```js
    const trap = !sight && this.trapAhead();
    if (trap) {
      out.push({ id: 'avoid', label: '조심스럽게 피해 지나간다', kind: 'move' });
      const sp = this.specialFor(trap.id, 'trap');
      if (sp) out.push({ id: `sp:${trap.id}`, label: sp.label, kind: 'move' });
    }
```

- [ ] **Step 4: 진행** — `choose()` 의 `switch` `default: return;` 를:

```js
      default:
        if (id.startsWith('ev:')) { this.eventChoice(Number(id.slice(3))); break; }
        if (id.startsWith('sp:')) { this.special(id.slice(3)); break; }
        return;
```

  switch 에 추가: `case 'dodge': this.dodge(); break;`, `case 'avoid': this.avoidTrap(); break;`.

- [ ] **Step 5: 전투 교체** — `shoot()`·`melee()`·`hurtMonster()` 를 교체:

```js
  shoot() {
    const sight = this.monsterInSight();
    if (this.ammo <= 0) { this.log('남은 것이 없다.', 'bad'); return; }
    this.ammo--;
    this.audio.shot();
    const name = this.rangedName || '총';
    if (!sight) { this.log(`${name}이(가) 허공을 가른다. 아무것도 맞지 않았다.`); return; }
    const p = attackChance(this.rangedIsPistol ? 'pistol' : 'weapon', false, this.fx);
    if (Math.random() < p) this.killMonster(sight.m);
    else this.log('빗나갔다.', 'bad');     // 떨어져 있으니 반격은 없다
  }

  melee() {
    const sight = this.monsterInSight(1);
    this.audio.blip(200, 0.07, 'square', 0.06);
    if (!sight) { this.log('허공을 갈랐다.'); return; }
    const p = attackChance(this.hasKnife ? 'weapon' : 'bare', true, this.fx);
    if (Math.random() < p) { this.killMonster(sight.m); return; }
    this.log('맞았지만 그것은 꿈쩍도 하지 않는다. 그것이 반격한다.', 'bad');
    this.damage(this.s.noPain ? 0 : COMBAT.counterDamage);
    if (!this.dead && Math.random() < COMBAT.counterPartChance) this.losePart('random', '그것이 물어뜯었다.');
    sight.m.stun = 0;
  }

  killMonster(m) {
    m.alive = false;
    this.audio.blip(60, 0.4, 'sawtooth', 0.1);
    this.log('그것이 무너져 내렸다.');
    if (this.monsters.every((x) => !x.alive)) this.log('더 이상 아무 소리도 들리지 않는다.', 'sys');
  }

  /** 몸을 피한다. 성공하면 옆(없으면 뒤) 빈 칸으로, 그 턴에 괴물은 물지 못한다. */
  dodge() {
    const sight = this.monsterInSight(1);
    if (!sight) return;
    if (Math.random() < dodgeChance(this.fx)) {
      this.applyMove(this.sideCell() ? 'side' : 'back');
      sight.m.stun = 1;
      this.log('몸을 틀었다. 그것의 손이 어깨를 스친다.');
    } else {
      this.damage(this.s.noPain ? 0 : COMBAT.dodgeFailDamage, '피하지 못했다.');
    }
  }

  avoidTrap() {
    const t = this.trapAhead();
    if (!t) return;
    if (Math.random() < 0.75) { this.applyMove('over', t); this.log('틈을 피해 조심스럽게 지나갔다.'); }
    else this.springTrap(t);
  }

  special(key) {
    const sp = this.specials.get(key);
    if (!sp) return;
    const monster = this.monsters.find((m) => m.id === key);
    const trap = this.traps.find((t) => t.id === key);
    this.specials.delete(key);          // 한 번 쓴 특수 행동은 다시 뜨지 않는다 (다음 조우에 새로 뽑는다)
    this.applyOutcome(resolve(sp.outcomes), { monster, trap });
  }

  eventChoice(i) {
    const ev = EVENTS[this.event.id];
    const choice = ev.choices[i];
    const ctx = { monster: this.event.monster };
    this.event = null;
    if (choice) this.applyOutcome(resolve(choice.outcomes), ctx);
  }

  applyOutcome(r, { monster, trap } = {}) {
    if (r.text) this.log(r.text, r.damage || r.losePart || r.trap === 'spring' ? 'bad' : '');
    if (r.useCorpse && this.carriedCorpse > 0) this.carriedCorpse--;
    if (r.move) this.applyMove(r.move, trap);
    if (r.damage) this.damage(this.s.noPain ? 0 : r.damage);
    if (this.dead) return;
    if (r.losePart) this.losePart(r.losePart);
    if (monster && r.monster === 'stun') monster.stun = 2;
    if (monster && r.monster === 'enrage') monster.stun = -1;   // 다음 턴에 한 번 더
    if (monster && r.monster === 'flee') this.fleeMonster(monster);
    if (trap && r.trap === 'disarm') { trap.sprung = true; }
    if (trap && r.trap === 'spring') this.springTrap(trap);
    if (r.turns) this.pendingTurns = r.turns;
    if (r.next) this.event = { id: r.next, monster };
    if (!this.dead && !r.next) this.describe();
    else if (r.next) this.log(EVENTS[r.next].text, 'bad');
  }

  sideCell() {
    for (const t of [1, 3]) {
      const [dx, dy] = DIRS[(this.facing + t) % 4];
      const x = this.cx + dx, y = this.cy + dy;
      if (!this.wall(x, y) && !this.monsterAt(x, y)) return { x, y };
    }
    return null;
  }

  applyMove(kind, trap) {
    let c = null;
    if (kind === 'side') c = this.sideCell();
    if (kind === 'back' || (kind === 'side' && !c)) {
      const [dx, dy] = DIRS[(this.facing + 2) % 4];
      const b = { x: this.cx + dx, y: this.cy + dy };
      if (!this.wall(b.x, b.y) && !this.monsterAt(b.x, b.y)) c = b;
    }
    if (kind === 'over' && trap) {
      const [dx, dy] = DIRS[this.facing];
      const beyond = { x: trap.x + dx, y: trap.y + dy };
      c = (!this.wall(beyond.x, beyond.y) && !this.monsterAt(beyond.x, beyond.y)) ? beyond : null;
    }
    if (c) { this.cx = c.x; this.cy = c.y; this.reveal(); }
  }

  springTrap(t) {
    t.sprung = true;
    this.losePart('random', '함정이다. 바닥에서 솟은 것이 몸을 꿰뚫었다.');
  }

  /** 3칸 멀어지는 쪽으로 물러난다. */
  fleeMonster(m) {
    for (let i = 0; i < 3; i++) {
      const opts = DIRS.map(([dx, dy]) => ({ x: m.x + dx, y: m.y + dy }))
        .filter((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y) && !(c.x === this.cx && c.y === this.cy))
        .sort((a, b) => (Math.abs(b.x - this.cx) + Math.abs(b.y - this.cy)) - (Math.abs(a.x - this.cx) + Math.abs(a.y - this.cy)));
      if (!opts.length) break;
      m.x = opts[0].x; m.y = opts[0].y;
    }
    m.stun = 1;
  }
```

  `checkTrap()` 의 마지막 줄(Task 5 에서 바꾼 `this.losePart(...)`)과 `t.sprung = true;` 를 `this.springTrap(t);` 한 줄로 합친다.

- [ ] **Step 6: 괴물 두 칸** — `moveMonsters()` 의 앞부분(`const steps = ...` 부터 이중 루프 시작까지)을 아래처럼 바꾼다. 루프 **본문**(미끼·추적·이동 로직)은 그대로 두고, 루프 머리와 문 뒤 처리만 바뀐다.

```js
  moveMonsters() {
    const base = monsterSteps(this.s.monsterSpeed || 1);
    // 이번 턴에 괴물마다 움직일 칸 수. 기절이면 0, 격분이면 한 칸 더.
    for (const m of this.monsters) m.moves = m.stun > 0 ? 0 : base + (m.stun < 0 ? 1 : 0);
    for (let s = 0; s <= base; s++) {
      for (const m of this.monsters) {
        if (!m.alive || this.dead || m.moves <= 0) continue;
        m.moves--;
        // (기존 본문: 붙어 있으면 문다 / 미끼·추적 / 이동 / 덮친다)
      }
    }
    for (const m of this.monsters) { if (m.stun > 0) m.stun--; else if (m.stun < 0) m.stun = 0; }
    // (기존: 숨소리 경고)
  }
```

  기존 본문의 두 `this.damage(...)` 호출(물어뜯었다·덮쳤다) 뒤에 각각:

```js
          m.moves = 0;   // 물었으면 그 턴은 거기서 멈춘다
          if (!this.dead && Math.random() < COMBAT.counterPartChance) this.losePart('random', '그것이 물어뜯었다.');
```

  (첫 번째 호출 뒤의 `continue;` 는 그대로 둔다.)

- [ ] **Step 7: 확인** — `npm test` → `전부 통과` 다섯 번, `node --check public/game.js`
- [ ] **Step 8: 커밋** — `git add public/game.js && git commit -m "괴물 앞에서는 피하는 게 답이다: 조우·후속 이벤트·운에 맡기는 공격"`

---

### Task 7: 화면 — 현관·HUD·미니맵·클리어 전송

**Files:** Modify `public/ui.js`, `public/index.html`, `public/game.js`

- [ ] **Step 1: 현관** — `index.html` 의 `<div id="auth-box" ...>` 위에 `<p id="lobby-note" class="subtitle"></p>`. `ui.js` 의 `loadLobby()`:

```js
  const { user, canEnter, lostParts } = await api('/api/me');
  me = user;
  $('auth-box').innerHTML = me ? '' : '<a href="/auth/login">디스코드로 로그인</a>';
  $('btn-enter').disabled = !me || !canEnter;
  const notes = [];
  if (me && !canEnter) notes.push('문이 열리지 않는다. 다른 누군가가 먼저 들어가야 한다.');
  if (me && lostParts?.length) notes.push(`당신은 ${lostParts.join(', ')} 없이 서 있다.`);
  $('lobby-note').textContent = notes.join(' ');
```

- [ ] **Step 2: 입장·클리어** — `enterRoom()` 의 `const { runId: id, world } = ...` 를 `const { runId: id, world, body } = ...` 로, `new Game(world, $('view'), $('minimap'), {...})` 에 다섯 번째 인자 `body` 를 넘긴다. `endRun()` 의 클리어 API 호출(`/clear`)에 `body: JSON.stringify({ lostParts: result.lostParts })` 를 넣는다. 결말 문구의 `result.lostParts.join(', ')` 는 그대로(이제 전체 목록).
- [ ] **Step 3: HUD** — `renderHud()` 의 `hud-turns` 줄을 `$('hud-turns').innerHTML = h.lost?.length ? `없음 <b class="low">${h.lost.join(', ')}</b>` : '';` 로. `hasPistol` 표시를 `${h.rangedName || '권총'} <b>${h.ammo}</b>` 로 (hudState 에 `rangedName: this.rangedName` 추가).
- [ ] **Step 4: 미니맵** — `game.js` 생성자 끝에 `this.mm.style.display = this.s.map ? '' : 'none';`, `start()` 의 `this.drawMinimap();` 호출을 `if (this.s.map) this.drawMinimap();` 로 (루프 안 호출도 같게).
- [ ] **Step 5: 확인** — `npm test`, `node --check public/game.js public/ui.js`. 브라우저 확인 (창이 보여야 한다. 사용자에게 띄워 달라고 요청하거나 직접 확인을 부탁):

```bash
rm -f browser.db*; DB_PATH=./browser.db node -e "import('./src/db.js').then(({q})=>{const u=q.upsertUser.get('dev-local','테스트 플레이어',null,Date.now());q.setBody.run(JSON.stringify(['왼쪽 발목']),u.id);q.insertEntry.get(u.id,null,'x','applied','x',JSON.stringify([{type:'maze.size',value:9},{type:'maze.layout',value:'room'},{type:'entity.monster',count:2},{type:'maze.traps',count:4},{type:'item.pistol',value:true},{type:'rule.exit_cost',cost:'random_body_part'}]),Date.now())})"
DEV_NO_AUTH=1 IMAGE_PROVIDER=none DB_PATH=./browser.db PORT=3998 node src/server.js
```

  - [ ] 현관에 "당신은 왼쪽 발목 없이 서 있다."
  - [ ] 입장 로그 "왼쪽 발목 없이 들어왔다.", 미니맵 없음, 배고픔 없음, HUD 에 "없음 왼쪽 발목"
  - [ ] 한 칸 전진에 괴물이 여러 번 움직인다 (다리 없음 3턴 × 2칸)
  - [ ] 괴물이 바로 앞이면 "몸을 피한다" + 특수 행동 1개, 결과·후속 이벤트가 로그에 뜬다
  - [ ] 권총이 대체로 맞는다, 맨손은 대체로 반격당한다
  - [ ] 죽은 뒤 현관에서 몸 문구가 사라진다

  정리: 포트 3998 프로세스만 종료, `browser.db*` 삭제.
- [ ] **Step 6: 커밋** — `git add public/ui.js public/index.html public/game.js && git commit -m "현관에 몸 상태, 지도가 있을 때만 미니맵, 나올 때 몸을 남긴다"`
