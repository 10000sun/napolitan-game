# 계획 4: 조합형 규칙 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방명록의 "~하면 ~된다" 소원을 `rule.when` (조건 + 행동) 조합으로 받아, 물체에 새 버튼을 만들거나 저절로 일어나게 한다.

**Architecture:** 서버는 `normalizeRule` 로 규칙을 정리해 `state.rules`(20개)에 쌓고, 월드는 대상이 있는 규칙만 내려보낸다. 클라이언트의 순수 모듈 `public/rules.js` 가 사건·상태를 받아 실행할 행동을 돌려주고, `game.js` 가 행동을 적용한다.

**Tech Stack:** Node 20 ESM, Canvas 2D. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-22-composable-rules-design.md`

## Global Constraints

- 규칙 20개 상한, 먼저 적힌 것 우선. 행동 4개 상한.
- 범위: hp −50~50(0 버림), spawn 1~3, dark 1~5, reveal 1~10, ammo 1~30(기본 6), every n 1~50(기본 5), hurt n 1~99(기본 30), chance 0.05~1(기본 1), verb 20자(기본 '만진다'), say 120자.
- 모르는 `on`/`act` 는 버린다. target 필요 조건(act·enter·near·pickup)에 target 이 없으면 규칙을 버린다.
- enter·near·see_monster·hurt·door 는 **새로 참이 될 때만** 발동. every 는 turn 이 n 의 배수가 될 때 turn 마다 한 번. start 는 한 번.
- 기존 월드 결정론 유지 (스냅샷 테스트에서 `rules` 만 뺀다).

## Review Focus

1. 괴물이 시야에 머무는 동안 `see_monster` 가 매 턴 반복 발동 → 한 번만 (시야를 벗어났다 다시 들어오면 다시). → Task 3 테스트.
2. 행동이 다른 규칙을 부르는 사슬(순간이동 → enter) → 한 번의 update 안에서 무한 반복하지 않는다 (다음 update 에서). → Task 3 테스트.
3. 대상이 줍거나 사라진(vanish) 물체인 act 규칙 → 버튼이 사라진다. → Task 4 (keys 에서 taken 제외).
4. chance 0 / 이상한 문자열 → 0.05 로. → Task 1 테스트.
5. 규칙 21번째 → 쌓이지 않는다. → Task 1 테스트.

---

### Task 1: `normalizeRule` 과 `rule.when`

**Files:** `src/effects.js`, `test/compiler.js`

**Interfaces — Produces:** `normalizeRule(e) → { on, target, verb, n, chance, once, do: action[] } | null`, `normalizeAction(a) → action | null`, `state.rules`.

- [ ] **Step 1: 실패하는 테스트** — `test/compiler.js` 의 `console.log(fail === 0` 위:

```js
// ── 조합형 규칙 ──────────────────────────────────────────
const { normalizeRule } = await import('../src/effects.js');
let ru = normalizeRule({ on: 'ACT', target: ' 고양이 ', verb: '쓰다듬는다', do: [{ act: 'hp', amount: 999 }, { act: 'say', text: '가르랑' }] });
check(ru.on === 'act' && ru.target === '고양이' && ru.verb === '쓰다듬는다' && ru.chance === 1 && ru.once === false, '버튼 규칙');
check(ru.do[0].amount === 50 && ru.do[1].text === '가르랑', '행동 범위를 자른다');
check(normalizeRule({ on: 'act', target: '고양이', do: [{ act: 'say', text: 'x' }] }).verb === '만진다', '동사가 없으면 만진다');
check(normalizeRule({ on: 'act', do: [{ act: 'say', text: 'x' }] }) === null, '대상이 필요한데 없으면 버린다');
check(normalizeRule({ on: 'fly', do: [{ act: 'say', text: 'x' }] }) === null, '모르는 조건은 버린다');
check(normalizeRule({ on: 'start', do: [{ act: 'explode' }, { act: 'hp', amount: 0 }] }) === null, '행동이 하나도 안 남으면 버린다');
check(normalizeRule({ on: 'start', do: Array(9).fill({ act: 'say', text: 'x' }) }).do.length === 4, '행동은 4개까지');
check(normalizeRule({ on: 'every', do: [{ act: 'dark', turns: 99 }] }).n === 5 && normalizeRule({ on: 'every', n: 99, do: [{ act: 'dark', turns: 99 }] }).do[0].turns === 5, 'every 기본 5, 암전 5턴까지');
check(normalizeRule({ on: 'every', n: 99, do: [{ act: 'say', text: 'x' }] }).n === 50, 'every 최대 50');
check(normalizeRule({ on: 'start', chance: 0, do: [{ act: 'say', text: 'x' }] }).chance === 0.05 && normalizeRule({ on: 'start', chance: 'abc', do: [{ act: 'say', text: 'x' }] }).chance === 0.05, '확률은 0.05 이상');
const m = normalizeRule({ on: 'start', do: [{ act: 'monster', do: 'spawn', count: 9 }, { act: 'give', item: 'ammo' }, { act: 'teleport', to: 'moon' }, { act: 'lose_part', effect: 'wings' }] }).do;
check(m[0].count === 3 && m[1].count === 6 && m[2].to === 'random' && m[3].effect === 'random', '소환 3·탄약 기본 6·모르는 값은 기본값');
st = foldEffects(Array.from({ length: 25 }, (_, i) => [{ type: 'rule.when', on: 'every', n: i + 1, do: [{ act: 'say', text: `${i}` }] }]));
check(st.rules.length === 20 && st.rules[0].n === 1, '규칙은 먼저 적힌 20개까지');
check(JSON.stringify(foldEffects([]).rules) === '[]', '기본 규칙은 없다');
```

- [ ] **Step 2: 실패 확인** — `node test/compiler.js` → `normalizeRule is not a function`
- [ ] **Step 3: 구현** — `src/effects.js`
  - `'flavor.text'` 위에:

```js
  'rule.when': {
    desc: '"~하면 ~된다" 형태의 소원. 조건(on)과 행동(do)의 조합. '
      + "on: 'act'(대상에 새 버튼, verb 는 버튼 동사) | 'enter'(대상 칸에 들어감) | 'near'(대상 1칸 안) | 'every'(n턴마다) "
      + "| 'see_monster' | 'pickup'(대상을 주움) | 'hurt'(체력 n 이하) | 'start'(들어오자마자) | 'door'(출구 앞). "
      + 'target: 대상 물체 이름(act·enter·near·pickup 에 필수, 권총·칼·지도도 된다). chance: 0.05~1. once: 한 판에 한 번. '
      + "do: 최대 4개 — { act:'say', text } | { act:'hp', amount:-50~50 } | { act:'lose_part', effect } "
      + "| { act:'teleport', to:'random'|'start'|'exit' } | { act:'monster', do:'flee'|'stun'|'enrage'|'spawn', count:1~3 } "
      + "| { act:'dark', turns:1~5 } | { act:'give', item:'ammo'|'pistol'|'knife'|'map', count } "
      + "| { act:'object', do:'vanish'|'follow'|'wander'|'come' } | { act:'sound', kind:'scream'|'whisper'|'knock' } "
      + "| { act:'reveal', turns:1~10 }. 방 전체에 규칙은 20개까지.",
    params: { on: 'string', target: 'string', verb: 'string', n: 'number', chance: 'number', once: 'boolean', do: 'array' },
    apply: (s, e) => {
      const r = normalizeRule(e);
      if (r && s.rules.length < 20) s.rules.push(r);
    },
  },
```

  - `initialState()` 의 `objects: [],` 위에 `rules: [],`.
  - `normalizeSurface` 아래에:

```js
const ONS = ['act', 'enter', 'near', 'every', 'see_monster', 'pickup', 'hurt', 'start', 'door'];
const NEEDS_TARGET = ['act', 'enter', 'near', 'pickup'];
const oneOf = (v, allowed) => {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : null;
};

/** 규칙의 행동 하나. 모르는 행동이면 null, 값은 범위로 자른다. */
export function normalizeAction(a) {
  switch (oneOf(a?.act, ['say', 'hp', 'lose_part', 'teleport', 'monster', 'dark', 'give', 'object', 'sound', 'reveal'])) {
    case 'say': { const text = String(a.text ?? '').trim().slice(0, 120); return text ? { act: 'say', text } : null; }
    case 'hp': { const amount = Math.max(-50, Math.min(50, Math.round(Number(a.amount) || 0))); return amount ? { act: 'hp', amount } : null; }
    case 'lose_part': return { act: 'lose_part', effect: pick(a.effect, ['random', 'deaf', 'noTrigger', 'noGrab', 'slow', 'blind'].map((x) => x.toLowerCase())) === 'random' ? 'random' : (['deaf', 'noTrigger', 'noGrab', 'slow', 'blind'].find((x) => x.toLowerCase() === String(a.effect ?? '').trim().toLowerCase()) || 'random') };
    case 'teleport': return { act: 'teleport', to: pick(a.to, ['random', 'start', 'exit']) };
    case 'monster': {
      const d = pick(a.do, ['flee', 'stun', 'enrage', 'spawn']);
      return d === 'spawn' ? { act: 'monster', do: d, count: clamp(a.count ?? 1, 1, 3) } : { act: 'monster', do: d };
    }
    case 'dark': return { act: 'dark', turns: clamp(a.turns ?? 2, 1, 5) };
    case 'give': {
      const item = pick(a.item, ['ammo', 'pistol', 'knife', 'map']);
      return item === 'ammo' ? { act: 'give', item, count: clamp(a.count ?? 6, 1, 30) } : { act: 'give', item };
    }
    case 'object': return { act: 'object', do: pick(a.do, ['vanish', 'follow', 'wander', 'come']) };
    case 'sound': return { act: 'sound', kind: pick(a.kind, ['scream', 'whisper', 'knock']) };
    case 'reveal': return { act: 'reveal', turns: clamp(a.turns ?? 3, 1, 10) };
    default: return null;
  }
}

/** "~하면 ~된다". 조건을 모르거나, 대상이 필요한데 없거나, 행동이 하나도 안 남으면 null. */
export function normalizeRule(e) {
  const on = oneOf(e?.on, ONS);
  if (!on) return null;
  const target = NEEDS_TARGET.includes(on) ? objectKey(e.target ?? '') : null;
  if (NEEDS_TARGET.includes(on) && !target) return null;
  const actions = (Array.isArray(e.do) ? e.do : []).map(normalizeAction).filter(Boolean).slice(0, 4);
  if (!actions.length) return null;
  const chance = Math.max(0.05, Math.min(1, Number(e.chance ?? 1) || 0));
  return {
    on,
    target,
    verb: on === 'act' ? (String(e.verb ?? '').trim().slice(0, 20) || '만진다') : null,
    n: on === 'every' ? clamp(e.n ?? 5, 1, 50) : on === 'hurt' ? clamp(e.n ?? 30, 1, 99) : null,
    chance,
    once: !!e.once,
    do: actions,
  };
}
```

  (`lose_part` 줄이 길면 헬퍼로 뺀다: `const EFFECT_KEYS = ['deaf', 'noTrigger', 'noGrab', 'slow', 'blind'];` 그리고 `effect: EFFECT_KEYS.find((x) => x.toLowerCase() === String(a.effect ?? '').trim().toLowerCase()) || 'random'`. 구현은 이 헬퍼 쪽으로 한다.)

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add src/effects.js test/compiler.js && git commit -m "조건과 행동을 조합한 규칙을 받는다"`

---

### Task 2: 월드·프롬프트

**Files:** `src/world.js`, `src/compiler.js`, `test/replay.js`, `test/compiler.js`

- [ ] **Step 1: 실패하는 테스트** — `test/replay.js` 스냅샷 비교 구조분해에 `rules: _r1,` 추가(now 쪽), `delete nowOld.state.rules;` 추가. `// ── 말 그대로: 배치` 블록 끝에:

```js
const rw = buildWorld([{ id: 1, effects: [
  { type: 'object.spawn', name: '고양이', emoji: '🐈' },
  { type: 'item.pistol', value: true },
  { type: 'rule.when', on: 'act', target: '고양이', verb: '쓰다듬는다', do: [{ act: 'hp', amount: 10 }] },
  { type: 'rule.when', on: 'act', target: '거울', verb: '본다', do: [{ act: 'say', text: 'x' }] },
  { type: 'rule.when', on: 'pickup', target: '권총', do: [{ act: 'say', text: 'x' }] },
  { type: 'rule.when', on: 'every', n: 3, do: [{ act: 'dark', turns: 1 }] },
] }]);
check(rw.rules.length === 3 && !rw.rules.some((r) => r.target === '거울'), '방에 없는 대상의 규칙은 빠진다 (권총은 아이템 이름으로 있다)');
```

  `test/compiler.js` 프롬프트 검사 줄 아래에:

```js
check(litSys.includes('rule.when') && litSys.includes('괴물이 사라지는 버튼'), '규칙형 소원 예시와 모순 예시');
```

- [ ] **Step 2: 실패 확인** — `npm test` → `✗`
- [ ] **Step 3: 구현**
  - `src/world.js` 반환 직전에:

```js
  // 방에 없는 것을 대상으로 한 규칙은 내려보내지 않는다.
  const ITEM_KEYS = { pistol: '권총', knife: '칼', map: '지도' };
  const present = new Set([...objects.map((o) => o.key), ...items.map((it) => ITEM_KEYS[it.kind])]);
  const rules = state.rules.filter((r) => !r.target || present.has(r.target));
```

    반환에 `rules,` 추가.
  - `src/compiler.js` 의 "5. flavor.text ..." 줄 아래에:

```
6. "~하면 ~된다" 형태는 rule.when 으로. 물체에 하는 행동이면 on: act 와 verb(버튼 동사).
   대상 물체가 아직 없으면 object.spawn 으로 함께 만든다. 방의 규칙이 이미 20개면 rule.when 을 쓰지 않는다.
   이미 반영된 규칙을 무력화하는 규칙은 contradiction 이다.
     예) 괴물이 있는데 "괴물이 사라지는 버튼" → contradiction
     예) 출구가 신체 부위를 요구하는데 "그냥 나가는 버튼" → contradiction
```

    예시 목록 끝에:

```
  "고양이를 쓰다듬으면 체력이 회복됐으면" (고양이가 있을 때)
    → { "type": "rule.when", "on": "act", "target": "고양이", "verb": "쓰다듬는다", "do": [{ "act": "hp", "amount": 20 }, { "act": "say", "text": "고양이가 목을 울린다." }] }
  "5턴마다 불이 꺼졌으면"
    → { "type": "rule.when", "on": "every", "n": 5, "do": [{ "act": "dark", "turns": 2 }] }
  "거울을 들여다보면 다른 곳으로 가 있었으면"
    → { "type": "object.spawn", "name": "거울", "tags": "mirror, cracked", "emoji": "🪞", "where": "wall" },
      { "type": "rule.when", "on": "act", "target": "거울", "verb": "들여다본다", "do": [{ "act": "teleport", "to": "random" }] }
  "시체 칸에 들어가면 비명이 들렸으면"
    → { "type": "object.spawn", "name": "시체", "tags": "corpse, rotten", "emoji": "💀", "pose": "lie", "count": 3 },
      { "type": "rule.when", "on": "enter", "target": "시체", "do": [{ "act": "sound", "kind": "scream" }, { "act": "say", "text": "발밑에서 비명이 터졌다." }] }
```

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add src/world.js src/compiler.js test/replay.js test/compiler.js && git commit -m "대상이 있는 규칙만 내려보내고, 판정에 규칙형 예시를 준다"`

---

### Task 3: `RuleEngine` (`public/rules.js`)

**Files:** Create `public/rules.js`; Modify `test/client.js`

**Interfaces — Produces:**

```js
new RuleEngine(rules, rng = Math.random)
.buttons(keys: Set<string>) → Array<{ i, rule }>
.act(i) → action[]            // chance·once 적용
.pickup(key) → action[]
.update(s) → action[]         // s = { turn, here: Set, near: Set, seeMonster, hp, atDoor }
```

- [ ] **Step 1: 실패하는 테스트** — `test/client.js` import 에 `import { RuleEngine } from '../public/rules.js';`, 본문:

```js
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
```

- [ ] **Step 2: 실패 확인** — `node test/client.js` → `Cannot find module '../public/rules.js'`
- [ ] **Step 3: 구현** — `public/rules.js`

```js
// ─────────────────────────────────────────────────────────────
// 방명록 규칙: "~하면 ~된다"
//
// 서버가 정리해 내려준 규칙을 한 판 동안 돌린다. 이 모듈은 무엇을 할지만
// 정하고, 실제로 하는 것은 game.js 다. DOM 을 쓰지 않아 node 에서 테스트한다.
// ─────────────────────────────────────────────────────────────

const EDGE = { enter: 1, near: 1, see_monster: 1, hurt: 1, door: 1 };

export class RuleEngine {
  constructor(rules = [], rng = Math.random) {
    this.rules = rules;
    this.rng = rng;
    this.spent = new Set();     // once 로 써 버린 규칙
    this.was = new Map();       // 새로 참이 될 때를 알기 위한 지난 값 (every 는 마지막으로 발동한 turn)
  }

  roll(i) {
    const r = this.rules[i];
    if (!r || this.spent.has(i)) return [];
    if (r.once) this.spent.add(i);
    return this.rng() < r.chance ? r.do : [];
  }

  /** 지금 누를 수 있는 버튼. keys: 발밑·바로 앞에 있는 물체 key */
  buttons(keys) {
    return this.rules.map((rule, i) => ({ rule, i }))
      .filter(({ rule, i }) => rule.on === 'act' && keys.has(rule.target) && !this.spent.has(i));
  }

  act(i) { return this.rules[i]?.on === 'act' ? this.roll(i) : []; }

  pickup(key) {
    return this.rules.flatMap((r, i) => (r.on === 'pickup' && r.target === key ? this.roll(i) : []));
  }

  /** 상태를 보고 새로 참이 된 조건의 행동을 모은다. */
  update(s) {
    const out = [];
    this.rules.forEach((r, i) => {
      if (r.on === 'every') {
        if (s.turn > 0 && s.turn % r.n === 0 && this.was.get(i) !== s.turn) {
          this.was.set(i, s.turn);
          out.push(...this.roll(i));
        }
        return;
      }
      if (r.on === 'start') {
        if (!this.was.get(i)) { this.was.set(i, true); out.push(...this.roll(i)); }
        return;
      }
      if (!EDGE[r.on]) return;
      const now = r.on === 'enter' ? s.here.has(r.target)
        : r.on === 'near' ? s.near.has(r.target)
        : r.on === 'see_monster' ? !!s.seeMonster
        : r.on === 'hurt' ? s.hp <= r.n
        : !!s.atDoor;
      if (now && !this.was.get(i)) out.push(...this.roll(i));
      this.was.set(i, now);
    });
    return out;
  }
}
```

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add public/rules.js test/client.js && git commit -m "규칙 엔진: 조건이 새로 참이 될 때 행동을 낸다"`

---

### Task 4: 게임 — 버튼과 행동

**Files:** `public/game.js`

**Interfaces — Consumes:** `RuleEngine` (Task 3), `world.rules` (Task 2).

- [ ] **Step 1: import·상태** — `import { RuleEngine } from '/rules.js';`. 생성자 `this.tex = null;` 위에:

```js
    this.rules = new RuleEngine(world.rules || []);
    this.darkTurns = 0;             // 규칙이 불을 끈 남은 턴
    this.revealTurns = 0;           // 규칙이 지도를 보여 주는 남은 턴
```

- [ ] **Step 2: 상태 수집·적용** — `encounterCtx()` 위에:

```js
  /** 규칙이 볼 지금 상태. */
  ruleState() {
    const live = this.objects.filter((o) => !o.taken);
    const here = new Set(live.filter((o) => o.where !== 'wall' && o.x === this.cx && o.y === this.cy).map((o) => o.key));
    const near = new Set(live.filter((o) => o.where !== 'wall' && Math.abs(o.x - this.cx) + Math.abs(o.y - this.cy) <= 1).map((o) => o.key));
    return { turn: this.turn, here, near, seeMonster: !!this.monsterInSight(), hp: this.hp, atDoor: this.atExit() };
  }

  /** 발밑·바로 앞(벽 물체는 마주 본 벽면)에 있는 물체 key. 규칙 버튼의 대상. */
  reachKeys() {
    const a = this.ahead();
    const face = (this.facing + 2) % 4;
    return new Set(this.objects.filter((o) => !o.taken && (
      (o.where !== 'wall' && ((o.x === this.cx && o.y === this.cy) || (o.x === a.x && o.y === a.y)))
      || (o.where === 'wall' && o.x === a.x && o.y === a.y && o.face === face))).map((o) => o.key));
  }

  runRules() {
    if (this.dead || this.won) return;
    const acts = this.rules.update(this.ruleState());
    if (acts.length) this.doActions(acts);
  }

  /** 규칙의 행동을 적용한다. */
  doActions(acts, target) {
    for (const a of acts) {
      if (this.dead || this.won) return;
      switch (a.act) {
        case 'say': this.log(a.text, 'sys'); break;
        case 'hp':
          if (a.amount > 0) { this.hp = Math.min(this.maxHp, this.hp + a.amount); this.log('몸이 조금 나아졌다.'); }
          else this.damage(this.s.noPain ? 0 : -a.amount, '어딘가가 욱신거린다.');
          break;
        case 'lose_part': this.losePart(a.effect); break;
        case 'teleport': this.teleport(a.to); break;
        case 'monster': this.ruleMonsters(a); break;
        case 'dark': this.darkTurns = Math.max(this.darkTurns, a.turns); this.log('불이 꺼졌다.', 'bad'); break;
        case 'give': this.ruleGive(a); break;
        case 'object': this.ruleObject(a.do, target); break;
        case 'sound':
          if (!this.fx.has('deaf')) {
            if (a.kind === 'scream') this.audio.blip(880, 0.5, 'sawtooth', 0.08);
            else if (a.kind === 'knock') { this.audio.blip(90, 0.08, 'square', 0.1); this.audio.blip(90, 0.08, 'square', 0.1); }
            else this.audio.noise(0.6, 0.05);
          }
          break;
        case 'reveal': this.revealTurns = Math.max(this.revealTurns, a.turns); this.mm.style.display = ''; this.log('머릿속에 이곳의 모양이 떠오른다.'); break;
      }
    }
    this.decalFrame = 0;
    if (!this.dead) this.describe();
  }

  teleport(to) {
    let c = null;
    if (to === 'start') c = { x: 1, y: 1 };
    else if (to === 'exit' && this.w.exit) c = { x: this.w.exit.x, y: this.w.exit.y };
    else {
      const cells = [];
      for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) if (!this.wall(x, y) && !this.monsterAt(x, y)) cells.push({ x, y });
      c = cells[Math.floor(Math.random() * cells.length)];
    }
    if (!c) return;
    this.cx = c.x; this.cy = c.y; this.px = c.x + 0.5; this.py = c.y + 0.5;
    this.log('눈을 깜빡이자 다른 곳에 서 있다.', 'bad');
    this.reveal();
    this.checkTrap();
  }

  ruleMonsters(a) {
    const live = this.monsters.filter((m) => m.alive);
    if (a.do === 'spawn') {
      const far = [];
      for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
        if (!this.wall(x, y) && !this.monsterAt(x, y) && Math.abs(x - this.cx) + Math.abs(y - this.cy) >= 4) far.push({ x, y });
      }
      for (let k = 0; k < a.count && far.length; k++) {
        const c = far.splice(Math.floor(Math.random() * far.length), 1)[0];
        this.monsters.push({ id: `rm${this.monsters.length}`, x: c.x, y: c.y, alive: true, stun: 0 });
      }
      this.log('어딘가에서 무언가 늘어났다.', 'bad');
    } else if (a.do === 'flee') { for (const m of live) this.fleeMonster(m); this.log('기척들이 멀어진다.'); }
    else if (a.do === 'stun') { for (const m of live) m.stun = 2; this.log('모든 소리가 멎었다.'); }
    else { for (const m of live) m.stun = -1; this.log('어둠 속이 술렁인다.', 'bad'); }
  }

  ruleGive(a) {
    if (a.item === 'pistol') { this.hasPistol = true; this.rangedName = '권총'; this.rangedIsPistol = true; this.ammo += 12; this.log(`손에 권총이 쥐어져 있다. 탄약 ${this.ammo}발.`); }
    else if (a.item === 'knife') { this.hasKnife = true; this.meleeName = '칼'; this.log('손에 칼이 쥐어져 있다.'); }
    else if (a.item === 'map') { this.mapKnown = true; this.mm.style.display = ''; this.log('주머니에 지도가 들어 있다.'); }
    else { this.ammo += a.count; this.log(`탄약이 ${a.count}발 늘었다.`); }
  }

  ruleObject(how, target) {
    const list = this.objects.filter((o) => !o.taken && o.key === target);
    for (const o of list) {
      if (how === 'vanish') o.taken = true;
      else if (how === 'follow' || how === 'wander') { if (o.where !== 'wall') { o.moves = how; o.pose = 'stand'; } }
      else if (how === 'come' && o.where !== 'wall') {
        const spot = DIRS.map(([dx, dy]) => ({ x: this.cx + dx, y: this.cy + dy })).find((c) => !this.wall(c.x, c.y) && !this.monsterAt(c.x, c.y));
        if (spot) { o.x = spot.x; o.y = spot.y; }
      }
    }
  }
```

  (`teleport` 는 카메라 좌표 `px/py` 를 바로 옮긴다. `stepCamera` 가 목표 칸으로 보간하는 구조면 `this.px/py` 대입은 순간이동 느낌을 위해 그대로 둔다.)

- [ ] **Step 3: 버튼·사건 연결**
  - `buildChoices()` 의 이벤트 분기 뒤(`const a = this.ahead();` 위)에:

```js
    const reach = this.reachKeys();
    for (const { rule, i } of this.rules.buttons(reach)) {
      const o = this.objects.find((x) => !x.taken && x.key === rule.target);
      if (o) out.push({ id: `rule:${i}`, label: `${o.name}을(를) ${rule.verb}`, kind: 'act' });
    }
```

  - `choose()` 의 default 에 `if (id.startsWith('rule:')) { const i = Number(id.slice(5)); const acts = this.rules.act(i); if (acts.length) this.doActions(acts, this.rules.rules[i].target); else this.log('아무 일도 일어나지 않았다.'); break; }`
  - `choose()` 끝의 `this.pushState();` 위에 `this.runRules();`. (`if (this.won || this.dead) { this.pushState(); return; }` 는 그대로.)
  - `_intro()` 끝 `this.describe();` 아래에 `this.runRules();`.
  - `takeItem()` 끝 `this.decalFrame = 0;` 위에 `const got = this.rules.pickup({ pistol: '권총', knife: '칼', map: '지도' }[it.kind]); if (got.length) this.doActions(got);`.
  - `takeTool()` 끝 `this.decalFrame = 0;` 위에 `const got = this.rules.pickup(o.key); if (got.length) this.doActions(got, o.key);`.
  - `endTurn()` 의 `this.turn++;` 아래에:

```js
    if (this.darkTurns > 0) this.darkTurns--;
    if (this.revealTurns > 0 && --this.revealTurns === 0 && !this.s.map) this.mm.style.display = 'none';
```

  - 게임 루프의 `if (this.s.map) this.drawMinimap();` → `if (this.s.map || this.revealTurns > 0 || this.mapKnown) this.drawMinimap();`
  - `drawMinimap()` 안의 `!this.mapKnown` 판정은 그대로 두되, 첫 줄에 `const known = this.mapKnown || this.revealTurns > 0;` 를 두고 그 함수 안의 `this.mapKnown` 을 `known` 으로 바꾼다.
  - `render()` 끝의 `this.drawSprites();` 아래에:

```js
    if (this.darkTurns > 0) { this.ctx.fillStyle = 'rgba(0,0,0,0.92)'; this.ctx.fillRect(0, 0, rw, rh); }
```

- [ ] **Step 4: 확인** — `node --check public/game.js`, `npm test`. 페이지 안에서 직접 호출해 확인 (서버·수신기는 계획 3 과 같은 방법):

```js
// 규칙: 고양이 act(쓰다듬는다 → hp+20, say), every 2 → dark 1, start → give map
// 1) g.buildChoices() 에 '고양이을(를) 쓰다듬는다' 가 고양이 곁에서만 뜨는지
// 2) g.choose('rule:0') 뒤 hp 가 오르고 로그에 문장이 찍히는지
// 3) g.choose('left') 두 번(턴 안 씀) 뒤 forward 로 턴 2 → darkTurns 1, 화면 캡처가 거의 검은지
// 4) 입장 직후 mapKnown === true, 미니맵이 보이는지
```

- [ ] **Step 5: 커밋** — `git add public/game.js && git commit -m "방명록 규칙: 물체에 새 버튼, 저절로 일어나는 일"`
