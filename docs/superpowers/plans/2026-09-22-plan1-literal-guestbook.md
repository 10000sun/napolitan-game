# 계획 1: 말 그대로 방명록 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방명록에 적힌 것이 넓은 방·위치(입구/출구/벽)·주워 쓰는 도구·움직이는 물체·괴물 모습·가까이 가면 뜨는 문장으로 "말 그대로" 나타나게 한다.

**Architecture:** DSL(`effects.js`)에 `maze.layout`, `entity.monster_look` 을 더하고 `object.spawn` 에 `where/use/moves/desc` 를 붙인다. 판정 프롬프트를 "말 그대로" 원칙으로 바꾼다. `world.js` 는 기존 배치와 `rand()` 순서를 건드리지 않고 그 뒤에 새 배치를 한다. 클라이언트는 도구 줍기·물체 이동·벽 오브젝트(벽면 앞 스프라이트)·괴물 모습을 처리한다.

**Tech Stack:** Node 20 ESM, express, better-sqlite3 12, 브라우저 Canvas 2D. 새 의존성 없음. 테스트는 `node test/*.js` + `check()`.

**Spec:** `docs/superpowers/specs/2026-09-22-literal-guestbook-backrooms-design.md` §1(1.1·1.2·1.3·1.5), §2, §3, §4. (§1.4 surface.look·§5 렌더링은 계획 3, §9~15 는 계획 2.)

## Global Constraints

- 기존 DB 의 방이 바뀌지 않는다: 원작 방명록의 최종 월드는 새 필드를 빼면 변경 전과 **바이트 단위로 같다**.
- 새 배치는 전부 `demandedPart` 결정 **뒤에** 한다.
- 플레이 시점(`/api/run/start`) 외부 호출 0회.
- LLM 출력은 반드시 정규화를 통과한다. 모르는 값은 기본값.
- `object.spawn` 기본값: `where: 'anywhere'`, `use: 'none'`, `moves: 'still'`, `desc: ''` (120자). `where: 'wall'` 이면 `use: 'none'`, `moves: 'still'` 강제.
- 판정 규칙(duplicate/contradiction/swallowed)은 바꾸지 않는다.
- 주석·문구 한국어, 기존 말투.

## Review Focus

1. LLM 이 `where: "WALL"`, `use: "gun"` 처럼 대소문자·동의어를 낸다 → 모르는 값은 기본값, 대소문자는 무시. → Task 1 테스트.
2. 벽 오브젝트가 미로 바깥 테두리 벽에도 붙는다 → 테두리 벽도 벽이므로 허용, 단 `face` 방향 이웃은 반드시 맵 안의 바닥. → Task 3 테스트.
3. entrance/exit 오브젝트가 많아 가까운 칸이 모자람 → 멀어도 빈 칸이면 놓고, 빈 칸이 없으면 놓지 않는다(에러 없음). → Task 3 테스트.
4. `follow` 물체가 플레이어와 벽으로 완전히 막힘 → 제자리. 플레이어 칸에는 들어가지 않는다. → Task 5 테스트.
5. 이미 반영된 옛 `object.spawn`(필드 없음) → 전부 기본값으로 예전과 같은 자리. → Task 3 테스트(스냅샷 + 옛 규칙).

---

## File Structure

| 파일 | 역할 |
|---|---|
| `src/effects.js` | `maze.layout`, `entity.monster_look`, `object.spawn` 확장, `normalizeObject` 확장 |
| `src/compiler.js` | "말 그대로" 원칙·단서·예시 |
| `src/world.js` | room 레이아웃, entrance/exit/wall 배치, `monsterLook`·`layout` 반환 |
| `src/server.js` | `monster_look` 에셋 해석, `world.monsterLook.img` |
| `public/paths.js` (신규) | `nextStep(isFloor, from, to, avoid)` BFS 다음 칸, `wanderStep` — DOM 없는 순수 함수 |
| `public/game.js` | 도구 줍기·무기 이름, 물체 이동, 서술, 벽 오브젝트 스프라이트, 괴물 모습 |
| `test/fixtures/replay-final.json` (신규) | 변경 전 원작 방명록 최종 월드 스냅샷 |
| `test/compiler.js`, `test/replay.js`, `test/client.js`(신규), `package.json` | 테스트 |

---

### Task 1: DSL 확장

**Files:**
- Modify: `src/effects.js`
- Test: `test/compiler.js` (마지막 `console.log(fail === 0` 위)

**Interfaces:**
- Produces:
  - `normalizeObject(e)` → `{ key, name, tags, emoji, count, where, use, moves, desc } | null`
  - `state.layout: null | 'room' | 'maze'`
  - `state.monsterLook: null | { key, name, tags, emoji }`

- [ ] **Step 1: 실패하는 테스트**

```js
// ── 말 그대로: 새 필드 ──────────────────────────────────
o = normalizeObject({ name: '활', where: 'ENTRANCE', use: 'Ranged', moves: 'follow', desc: '  시위가 떨린다.  ' });
check(o.where === 'entrance' && o.use === 'ranged' && o.moves === 'follow', '대소문자 무시하고 받는다');
check(o.desc === '시위가 떨린다.', 'desc 는 다듬는다');
o = normalizeObject({ name: '활', where: 'ceiling', use: 'gun', moves: 'fly' });
check(o.where === 'anywhere' && o.use === 'none' && o.moves === 'still', '모르는 값은 기본값');
o = normalizeObject({ name: '가면', where: 'wall', use: 'melee', moves: 'wander' });
check(o.use === 'none' && o.moves === 'still', '벽에 붙은 건 줍지도 움직이지도 않는다');
check(normalizeObject({ name: 'x', desc: 'a'.repeat(300) }).desc.length === 120, 'desc 120자');
check(normalizeObject({ name: 'x' }).desc === '' && normalizeObject({ name: 'x' }).where === 'anywhere', '옛 규칙은 기본값');

st = foldEffects([[{ type: 'maze.layout', value: 'room' }]]);
check(st.layout === 'room', 'maze.layout room');
st = foldEffects([[{ type: 'maze.layout', value: 'cave' }]]);
check(st.layout === null, '모르는 레이아웃은 무시');
check(foldEffects([]).layout === null, '기본 레이아웃은 null (크기로 판단)');

st = foldEffects([[{ type: 'entity.monster_look', name: '거대한 거미', tags: 'spider, giant', emoji: '🕷️' }]]);
check(st.monsterLook?.key === '거대한 거미' && st.monsterLook.tags[0] === 'spider', '괴물 모습');
check(foldEffects([]).monsterLook === null, '기본 괴물 모습은 없음');
```

- [ ] **Step 2: 실패 확인** — Run: `node test/compiler.js` / Expected: `✗` 여러 개 (where 등 undefined)

- [ ] **Step 3: 구현** — `src/effects.js`

`'maze.size'` 항목의 desc 를 교체:

```js
    desc: '공간의 크기. 넓게·좁게는 이것. 5~41 사이의 홀수. 모양(방인지 미로인지)은 maze.layout 이 정한다.',
```

`'maze.traps'` 항목 **위**에 추가:

```js
  'maze.layout': {
    desc: "공간의 모양. 'room' 은 내부 벽 없이 탁 트인 공간, 'maze' 는 미로. 넓히기만 바라면 room.",
    params: { value: 'string' },
    apply: (s, e) => {
      const v = String(e.value ?? '').toLowerCase();
      if (v === 'room' || v === 'maze') s.layout = v;
    },
  },
```

`'entity.corpses'` 항목 **위**에 추가:

```js
  'entity.monster_look': {
    desc: '괴물의 생김새. 적대적인 생물이 적히면 entity.monster 와 함께 낸다. 행동은 바뀌지 않고 모습만 바뀐다.',
    params: { name: 'string', tags: 'string', emoji: 'string' },
    apply: (s, e) => {
      const o = normalizeObject(e);
      if (o) s.monsterLook = { key: o.key, name: o.name, tags: o.tags, emoji: o.emoji };
    },
  },
```

`'object.spawn'` 의 desc·params 교체:

```js
    desc: '물건·생물·현상이 방 안에 말 그대로 나타난다. 엔진 규칙이 모르는 것은 전부 이것으로 옮긴다. '
      + '위의 Effect 로 옮겨지는 것(권총·칼·지도·시체·괴물)은 여기 쓰지 않는다. '
      + "name: 적힌 그대로의 짧은 한국어 이름. tags: 생김새를 설명하는 영어 단어 3~6개(쉼표). emoji: 가장 가까운 이모지 1개. count: 1~5. "
      + "where: 'anywhere' | 'entrance'(앞에·입구에) | 'exit'(출구에·문 앞에) | 'wall'(벽에·걸려·붙어). "
      + "use: 'none' | 'ranged'(쏘거나 던지는 도구) | 'melee'(휘두르는 도구). "
      + "moves: 'still' | 'wander'(돌아다닌다) | 'follow'(따라온다). "
      + 'desc: 가까이 가면 보이는 한 문장. 현상·규칙은 여기에 말 그대로 쓴다.',
    params: { name: 'string', tags: 'string', emoji: 'string', count: 'number', where: 'string', use: 'string', moves: 'string', desc: 'string' },
```

`initialState()` 의 `objects: [],` 위에:

```js
    layout: null,
    monsterLook: null,
```

`normalizeObject` 교체:

```js
const pick = (v, allowed) => {
  const s = String(v ?? '').trim().toLowerCase();
  return allowed.includes(s) ? s : allowed[0];
};

/** LLM 이 낸 object.spawn 을 엔진이 믿을 수 있는 모양으로. 이름이 없으면 null. 모르는 값은 기본값. */
export function normalizeObject(e) {
  const name = String(e?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  let tags = normalizeTags(e.tags);
  if (!tags.length) tags = normalizeTags(name);   // 이름이 영어면 그대로 태그가 된다
  const first = [...segmenter.segment(String(e.emoji ?? '').trim())][0]?.segment || '';
  const emoji = /\p{Extended_Pictographic}/u.test(first) ? first : '❔';
  const where = pick(e.where, ['anywhere', 'entrance', 'exit', 'wall']);
  const wall = where === 'wall';
  return {
    key: objectKey(name), name, tags, emoji, count: clamp(e.count ?? 1, 1, 5),
    where,
    use: wall ? 'none' : pick(e.use, ['none', 'ranged', 'melee']),
    moves: wall ? 'still' : pick(e.moves, ['still', 'wander', 'follow']),
    desc: String(e.desc ?? '').trim().slice(0, 120),
  };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: `전부 통과` 세 번

- [ ] **Step 5: 커밋**

```bash
git add src/effects.js test/compiler.js
git commit -m "넓은 방·괴물 모습·물체의 위치/쓰임/움직임/문장을 받는다"
```

---

### Task 2: 판정 프롬프트 "말 그대로"

**Files:**
- Modify: `src/compiler.js` (SYSTEM 의 `# 효과로 옮기는 법` 절)
- Test: `test/compiler.js`

**Interfaces:**
- Consumes: Task 1 의 Effect 이름·필드

- [ ] **Step 1: 실패하는 테스트** — `test/compiler.js` 의 `// ── object.spawn` 위

```js
// ── 프롬프트에 "말 그대로" 원칙이 실린다 ─────────────────
say({ verdict: 'flavor_only', effects: [], reason: 'x' });
await compileEntry('아무거나', [], initialState());
const sys = lastReq.body.system_instruction?.parts[0].text ?? lastReq.body.messages[0].content;   // 이 시점 제공자는 openai
check(sys.includes('말 그대로') && sys.includes('"where": "wall"') && sys.includes('maze.layout'), '프롬프트에 말 그대로 원칙과 예시');
```

- [ ] **Step 2: 실패 확인** — Run: `node test/compiler.js` / Expected: `✗ 프롬프트에 말 그대로 원칙과 예시`

- [ ] **Step 3: 구현** — `src/compiler.js` SYSTEM 에서 `# 효과로 옮기는 법` 제목 줄부터 그 절의 카탈로그 앞 문단까지:

```
# 효과로 옮기는 법
반영되는 내용은 아래 Effect 로만 번역한다. 딱 맞는 Effect 가 없으면 flavor.text 로 보낸다 — 그러면 그
내용은 미로 안의 "묘사"로만 존재하게 된다.
```

를 다음으로 교체한다:

```
# 효과로 옮기는 법 — 말 그대로
이 방은 적힌 것을 **말 그대로** 일으킨다. 황당해도 기각하지 않는다. 다만 엔진이 아는 것은 아래
Effect 가 전부이므로, 이렇게 옮긴다.
1. 기존 Effect 로 되는 것은 그 Effect 로. (권총·칼·지도·시체·괴물 수·함정·미로 크기 등)
2. 물건·생물·현상은 object.spawn 으로. 위치·쓰임·움직임·문장 단서를 빠짐없이 옮긴다.
   - "벽에/걸려/붙어" → where: wall, "앞에/입구에/들어가자마자" → where: entrance, "출구에/문 앞에" → where: exit
   - 쏘거나 던지는 도구 → use: ranged, 휘두르는 도구 → use: melee
   - "따라온다" → moves: follow, "돌아다닌다" → moves: wander
3. 적대적인 생물은 entity.monster 로 수를, entity.monster_look 으로 생김새를.
4. 엔진이 흉내낼 수 없는 현상·세계 규칙은 그것을 보여 주는 물체 + desc 로 번역한다.
5. flavor.text 는 장소도 대상도 없는 순수한 분위기일 때만 쓴다.

예:
  "TV 에서 매드무비가 나왔으면"
    → { "type": "object.spawn", "name": "TV", "tags": "old crt tv, static", "emoji": "📺", "count": 1, "desc": "TV 에서 매드무비가 끝없이 반복된다." }
  "고양이가 따라다녔으면"
    → { "type": "object.spawn", "name": "고양이", "tags": "cat, black", "emoji": "🐈", "count": 1, "moves": "follow" }
  "중력이 거꾸로였으면"
    → { "type": "object.spawn", "name": "거꾸로 매달린 의자", "tags": "chair, upside down", "emoji": "🪑", "count": 4, "desc": "천장이 발밑처럼 느껴진다." }
  "벽에 거꾸로 웃는 노란 가면이 가득"
    → { "type": "object.spawn", "name": "거꾸로 웃는 노란 가면", "tags": "yellow mask, smiling, upside down", "emoji": "🙃", "count": 5, "where": "wall" }
  "앞에 활이 있으니 챙겨가세요"
    → { "type": "object.spawn", "name": "활", "tags": "bow, wooden", "emoji": "🏹", "count": 1, "where": "entrance", "use": "ranged" }
  "거대한 거미가 돌아다녔으면"
    → { "type": "entity.monster", "count": 3 }, { "type": "entity.monster_look", "name": "거대한 거미", "tags": "giant spider, hairy", "emoji": "🕷️" }
  "좀 더 넓었으면" (지금 미로가 아닐 때)
    → { "type": "maze.size", "value": 15 }, { "type": "maze.layout", "value": "room" }
```

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: `전부 통과` 세 번

- [ ] **Step 5: 커밋**

```bash
git add src/compiler.js test/compiler.js
git commit -m "판정이 적힌 것을 말 그대로 옮기게 한다"
```

---

### Task 3: 월드 배치 (room, entrance/exit/wall)

**Files:**
- Create: `test/fixtures/replay-final.json`
- Modify: `src/world.js`, `test/replay.js`

**Interfaces:**
- Consumes: `state.layout`, `state.monsterLook`, `normalizeObject` 필드 (Task 1)
- Produces: `buildWorld()` 반환에 `layout: 'room'|'maze'`, `monsterLook`, `objects[i] = { id, key, name, emoji, x, y, where, use, moves, desc, face? }`. 벽 오브젝트의 `x, y` 는 벽 칸, `face` 0 동 1 남 2 서 3 북 (벽 → 바닥 방향).

- [ ] **Step 1: 스냅샷 먼저 (변경 전 코드로)**

```bash
node -e "import('./src/world.js').then(async ({buildWorld})=>{const fs=await import('node:fs');const src=fs.readFileSync('test/replay.js','utf8');const m=src.match(/const SCRIPT = (\[[\s\S]*?\n\]);/);const SCRIPT=eval(m[1]);const rules=SCRIPT.map(([t,e],i)=>({id:i+1,raw_text:t,effects:e}));fs.mkdirSync('test/fixtures',{recursive:true});fs.writeFileSync('test/fixtures/replay-final.json',JSON.stringify(buildWorld(rules)))})"
```

Expected: `test/fixtures/replay-final.json` 생성. `git add` 해서 이 태스크 커밋에 포함.

- [ ] **Step 2: 실패하는 테스트** — `test/replay.js` 의 `console.log(fail === 0` 위

```js
// ── 말 그대로: 배치 ──────────────────────────────────────
const snap = JSON.parse(fs.readFileSync(new URL('./fixtures/replay-final.json', import.meta.url)));
const now = buildWorld(rules);
const { layout: _l, monsterLook: _m, objects: _o1, ...nowOld } = now;
const { objects: _o2, ...snapOld } = snap;
check(JSON.stringify(nowOld) === JSON.stringify(snapOld), '원작 방명록의 월드는 변경 전과 같다');
check(now.layout === 'maze', '크기 15 에 레이아웃이 없으면 미로');

const roomW = buildWorld([{ id: 1, effects: [{ type: 'maze.size', value: 15 }, { type: 'maze.layout', value: 'room' }] }]);
let inner = true;
for (let y = 1; y < 14; y++) for (let x = 1; x < 14; x++) if (roomW.grid[y][x] !== 0) inner = false;
check(roomW.layout === 'room' && inner, 'room + 15 은 내부가 전부 바닥');

const placeRules = [{ id: 1, effects: [
  { type: 'maze.size', value: 15 },
  { type: 'object.spawn', name: '활', where: 'entrance', count: 2 },
  { type: 'object.spawn', name: '종', where: 'exit', count: 2 },
  { type: 'object.spawn', name: '가면', where: 'wall', count: 5 },
  { type: 'object.spawn', name: '돌', count: 1 },
] }];
const pw = buildWorld(placeRules);
const bfs = (sx, sy) => { const d = {}; const q = [[sx, sy]]; d[`${sx},${sy}`] = 0;
  for (let i = 0; i < q.length; i++) { const [x, y] = q[i]; for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = x + dx, ny = y + dy, k = `${nx},${ny}`; if (pw.grid[ny]?.[nx] === 0 && d[k] === undefined) { d[k] = d[`${x},${y}`] + 1; q.push([nx, ny]); } } } return d; };
const fromStart = bfs(1, 1), fromExit = bfs(pw.exit.x, pw.exit.y);
const byKey = (k) => pw.objects.filter((o) => o.key === k);
check(byKey('활').length === 2 && byKey('활').every((o) => fromStart[`${o.x},${o.y}`] <= 3), '입구 물체는 시작 칸 가까이');
check(byKey('종').length === 2 && byKey('종').every((o) => fromExit[`${o.x},${o.y}`] <= 3), '출구 물체는 출구 가까이');
const DV = [[1, 0], [0, 1], [-1, 0], [0, -1]];
check(byKey('가면').length === 5 && byKey('가면').every((o) => pw.grid[o.y][o.x] === 1
  && pw.grid[o.y + DV[o.face][1]]?.[o.x + DV[o.face][0]] === 0), '벽 물체는 벽 칸에, 바라보는 쪽은 바닥');
check(new Set(byKey('가면').map((o) => `${o.x},${o.y},${o.face}`)).size === 5, '같은 벽면에 둘은 없다');
const floorCells = pw.objects.filter((o) => o.where !== 'wall').map((o) => `${o.x},${o.y}`);
check(new Set(floorCells).size === floorCells.length, '바닥 물체끼리 겹치지 않는다');
check(!floorCells.includes('1,1') && !floorCells.includes(`${pw.exit.x},${pw.exit.y}`), '시작 칸·출구 칸은 비운다');
check(JSON.stringify(buildWorld(placeRules)) === JSON.stringify(pw), '같은 방명록이면 새 배치도 같다');

const crowd = buildWorld([{ id: 1, effects: Array.from({ length: 30 }, (_, i) => ({ type: 'object.spawn', name: `e${i}`, where: 'entrance', count: 5 })) }]);
check(crowd.objects.length === 7, '빈 칸이 모자라면 놓을 수 있는 만큼만 (5×5 빈 방: 바닥 9 - 시작 - 출구)');

const old = buildWorld([{ id: 1, effects: [{ type: 'maze.size', value: 15 }, { type: 'object.spawn', name: '돌', count: 2 }] }]);
check(old.objects.every((o) => o.where === 'anywhere' && o.use === 'none' && o.moves === 'still'), '옛 규칙은 기본값으로');
```

파일 맨 위 import 줄들 아래에 `import fs from 'node:fs';` 를 추가한다.

- [ ] **Step 3: 실패 확인** — Run: `node test/replay.js` / Expected: `✗` (layout 없음 등)

- [ ] **Step 4: 구현** — `src/world.js`

grid 결정 줄 교체:

```js
  const layout = state.layout ?? (size <= 5 ? 'room' : 'maze');
  // 크기 5 = 사실상 빈 방. 최초 상태의 "아무것도 없는 빈 공간".
  const grid = layout === 'room' ? emptyRoom(size) : generateMaze(size, rand);
```

(`generateMaze` 는 layout 이 maze 일 때만 rand 를 쓴다. 기존 DB 는 layout 이 null → 크기로 판단 → 기존과 같은 rand 순서.)

오브젝트 루프를 anywhere 만 처리하도록 바꾼다:

```js
  const objects = [];
  for (const o of state.objects) {
    if (o.where !== 'anywhere') continue;
    take(o.count).forEach((c, i) => objects.push(objectOut(o, c, i)));
  }
```

`demandedPart` 계산 **바로 아래**에 추가:

```js
  // ── 말 그대로 배치. 기존 배치와 rand 순서를 흔들지 않도록 전부 여기서 한다.
  const used = new Set(['1,1', ...(exit ? [`${exit.x},${exit.y}`] : []),
    ...monsters.map((m) => `${Math.floor(m.x)},${Math.floor(m.y)}`),
    ...traps.map((t) => `${t.x},${t.y}`), ...corpses.map((c) => `${c.x},${c.y}`),
    ...items.map((it) => `${Math.floor(it.x)},${Math.floor(it.y)}`),
    ...objects.map((o) => `${o.x},${o.y}`)]);
  const nearest = (sx, sy) => {
    const d = bfsDistances(grid, sx, sy);
    const list = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (d[y][x] > 0) list.push({ x, y, d: d[y][x] });
    return list.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  };
  const takeFrom = (list, n) => {
    const out = [];
    for (const c of list) {
      if (out.length === n) break;
      const k = `${c.x},${c.y}`;
      if (used.has(k)) continue;
      used.add(k);
      out.push({ x: c.x, y: c.y });
    }
    return out;
  };
  const nearStart = nearest(1, 1);
  const nearExit = exit ? nearest(exit.x, exit.y) : null;
  // 벽면 후보: (바닥 칸, 방향) 중 그 방향이 벽. face 는 벽에서 바닥을 향하는 방향.
  const faces = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (grid[y][x] !== 0) continue;
    WALL_DIRS.forEach(([dx, dy], d) => {
      const wx = x + dx, wy = y + dy;
      if (wx >= 0 && wy >= 0 && wx < size && wy < size && grid[wy][wx] === 1) faces.push({ x: wx, y: wy, face: (d + 2) % 4 });
    });
  }
  for (let i = faces.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [faces[i], faces[j]] = [faces[j], faces[i]];
  }
  let faceCursor = 0;
  for (const o of state.objects) {
    if (o.where === 'anywhere') continue;
    let cells;
    if (o.where === 'wall') cells = faces.slice(faceCursor, (faceCursor += o.count));
    else if (o.where === 'exit' && nearExit) cells = takeFrom(nearExit, o.count);
    else cells = takeFrom(nearStart, o.count);   // entrance, 또는 출구가 없는 방의 exit
    cells.forEach((c, i) => objects.push(objectOut(o, c, i)));
  }
```

파일 위쪽 `BODY_PARTS` 정의 아래에:

```js
const WALL_DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];   // 0 동 1 남 2 서 3 북 (game.js 의 DIRS 와 같다)

function objectOut(o, c, i) {
  const out = { id: `o:${o.key}:${i}`, key: o.key, name: o.name, emoji: o.emoji, x: c.x, y: c.y,
    where: o.where, use: o.use, moves: o.moves, desc: o.desc };
  if (c.face !== undefined) out.face = c.face;
  return out;
}
```

반환 객체의 `objects,` 아래에 `layout,` 과 `monsterLook: state.monsterLook,` 추가.

주의: `objectOut` 은 옛 object.spawn(필드 없음)도 처리해야 한다. `state.objects` 는 `normalizeObject` 를 거쳐 들어오므로 기본값이 채워져 있다.

- [ ] **Step 5: 통과 확인** — Run: `npm test` / Expected: `전부 통과` 세 번

- [ ] **Step 6: 커밋**

```bash
git add src/world.js test/replay.js test/fixtures/replay-final.json
git commit -m "넓은 방과 입구·출구·벽에 놓이는 물체"
```

---

### Task 4: 서버 — 괴물 모습 에셋

**Files:**
- Modify: `src/server.js`

**Interfaces:**
- Consumes: `state.monsterLook` (Task 1), `world.monsterLook` (Task 3), `resolveAsset`, `imgFor`, `normalizeObject`
- Produces: 런 시작 응답 `world.monsterLook = { key, name, tags, emoji, img } | null`

- [ ] **Step 1: 구현** — 기입 후 루프를 교체:

```js
  // 물체와 괴물의 모습은 뒤에서 확보한다. 응답은 기다리지 않는다.
  for (const e of verdict.effects) {
    if (e.type !== 'object.spawn' && e.type !== 'entity.monster_look') continue;
    const o = normalizeObject(e);
    if (o) resolveAsset(o).catch((err) => console.error('[asset]', err.message));
  }
```

`/api/run/start` 의 `world.items = ...` 아래:

```js
  if (world.monsterLook) world.monsterLook = { ...world.monsterLook, img: imgFor(world.monsterLook.key) };
```

- [ ] **Step 2: 확인**

Run: `npm test` / Expected: `전부 통과` 세 번

스모크 (`.env` 는 건드리지 않고 환경변수로):

```bash
rm -f smoke.db*; DB_PATH=./smoke.db node -e "import('./src/db.js').then(({q})=>{const u=q.upsertUser.get('dev-local','t',null,Date.now());q.insertEntry.get(u.id,null,'x','applied','x',JSON.stringify([{type:'entity.monster',count:1},{type:'entity.monster_look',name:'거미',tags:'spider',emoji:'🕷️'}]),Date.now())})"
DEV_NO_AUTH=1 IMAGE_PROVIDER=none DB_PATH=./smoke.db PORT=3997 node src/server.js &
curl -s -X POST localhost:3997/api/run/start | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d).world.monsterLook)))"
```

Expected: `{"key":"거미","name":"거미","tags":["spider"],"emoji":"🕷️","img":null}`. 서버는 **포트 3997 로 떠 있는 프로세스만** 종료한다 (PowerShell `Get-NetTCPConnection -LocalPort 3997` → `Stop-Process`). `smoke.db*` 삭제.

- [ ] **Step 3: 커밋**

```bash
git add src/server.js
git commit -m "괴물의 모습도 적힌 대로 확보해 내려보낸다"
```

---

### Task 5: 클라이언트 순수 함수 — 물체 이동

**Files:**
- Create: `public/paths.js`, `test/client.js`
- Modify: `package.json` (`test` 에 `node test/client.js` 추가)

**Interfaces:**
- Produces:
  - `nextStep(isFloor: (x,y)=>bool, from: {x,y}, to: {x,y}, blocked: (x,y)=>bool = () => false) → {x,y} | null` — `to` 로 가는 BFS 최단 경로의 첫 칸. `to` 칸 자체에는 들어가지 않는다(바로 옆이면 null). 길이 없으면 null.
  - `wanderStep(isFloor, from, rng) → {x,y}` — `rng() < 0.5` 면 제자리, 아니면 인접 바닥 중 `Math.floor(rng() * n)` 번째. 인접 바닥이 없으면 제자리.

- [ ] **Step 1: 실패하는 테스트** — `test/client.js`

```js
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
```

- [ ] **Step 2: 실패 확인** — Run: `node test/client.js` / Expected: `Cannot find module '../public/paths.js'`

- [ ] **Step 3: 구현** — `public/paths.js`

```js
// 칸 단위 길찾기. DOM 을 쓰지 않아 node 에서도 테스트할 수 있다.
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** to 쪽으로 가는 최단 경로의 첫 칸. to 칸에는 들어가지 않는다. 길이 없으면 null. */
export function nextStep(isFloor, from, to, blocked = () => false) {
  const key = (x, y) => `${x},${y}`;
  const prev = new Map([[key(from.x, from.y), null]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const [dx, dy] of DIRS) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = key(n.x, n.y);
      if (prev.has(k) || !isFloor(n.x, n.y)) continue;
      if (n.x === to.x && n.y === to.y) {
        if (c === from) return null;                  // 이미 붙어 있다
        let step = c;
        while (prev.get(key(step.x, step.y)) !== from) step = prev.get(key(step.x, step.y));
        return { x: step.x, y: step.y };
      }
      if (blocked(n.x, n.y)) continue;
      prev.set(k, c);
      q.push(n);
    }
  }
  return null;
}

/** 절반은 제자리, 나머지는 인접한 바닥 중 하나. */
export function wanderStep(isFloor, from, rng = Math.random) {
  if (rng() < 0.5) return { x: from.x, y: from.y };
  const opts = DIRS.map(([dx, dy]) => ({ x: from.x + dx, y: from.y + dy })).filter((c) => isFloor(c.x, c.y));
  if (!opts.length) return { x: from.x, y: from.y };
  return opts[Math.floor(rng() * opts.length)];
}
```

`package.json` 의 `"test"` 끝에 ` && node test/client.js` 추가.

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: `전부 통과` 네 번

- [ ] **Step 5: 커밋**

```bash
git add public/paths.js test/client.js package.json
git commit -m "따라오고 돌아다니는 물체의 길찾기"
```

---

### Task 6: 게임 — 도구 줍기·물체 이동·서술·벽 물체·괴물 모습

**Files:**
- Modify: `public/game.js`

**Interfaces:**
- Consumes: `world.objects[i].{where,use,moves,desc,face}`, `world.monsterLook` (Task 3·4), `nextStep`, `wanderStep` (Task 5)

- [ ] **Step 1: import·상태** — 맨 위 import 아래:

```js
import { nextStep, wanderStep } from '/paths.js';
```

생성자의 `this.hasKnife = false;` 아래:

```js
    this.rangedName = null;       // 원거리 무기 이름 (권총, 활 ...)
    this.meleeName = null;        // 근접 무기 이름 (칼, 쇠파이프 ...)
```

생성자의 오브젝트 매핑에 `taken: false` 추가:

```js
      ...o, dx: 0, dy: 0, stretch: stretchFor(o.id), wasVisible: false, visible: false, taken: false,
```

`for (const it of this.items) sprite(it.img);` 아래:

```js
    if (this.w.monsterLook) sprite(this.w.monsterLook.img);
```

- [ ] **Step 2: 줍기·무기** — `corpseHere()` 아래에:

```js
  toolHere() {
    return this.objects.find((o) => !o.taken && o.use !== 'none' && o.x === this.cx && o.y === this.cy);
  }
```

`buildChoices()` 의 `const co = this.corpseHere();` 위에:

```js
    const tool = this.toolHere();
    if (tool) out.push({ id: 'tool', label: `${tool.name}을(를) 줍는다`, kind: 'act' });
```

shoot/melee 선택지 두 줄을 교체:

```js
      if (this.hasPistol && this.ammo > 0) {
        out.push({ id: 'shoot', label: `${this.rangedName || '총'}을(를) 쏜다`, hint: `${this.ammo}발 남음`, kind: 'fight' });
      }
      if (sight.dist === 1) {
        const label = this.meleeName && this.meleeName !== '칼' ? `${this.meleeName}(으)로 내려친다`
          : this.hasKnife ? '칼로 벤다' : '맨손으로 친다';
        out.push({ id: 'melee', label, kind: 'fight' });
      }
```

`choose()` 의 switch 에 `case 'take': this.takeItem(); break;` 아래:

```js
      case 'tool': this.takeTool(); break;
```

`takeItem()` 의 pistol·knife 분기에 이름을 넣는다:

```js
    if (it.kind === 'pistol') {
      this.hasPistol = true;
      this.rangedName = '권총';
      this.ammo += this.s.ammo || 12;
      this.log(`권총을 주웠다. 탄약 ${this.ammo}발.`);
    } else if (it.kind === 'knife') {
      this.hasKnife = true;
      this.meleeName = '칼';
      this.log('칼을 주웠다. 손에 익는다.');
```

`takeCorpse()` 위에:

```js
  takeTool() {
    const o = this.toolHere();
    if (!o) return;
    o.taken = true;
    this.audio.pickup();
    if (o.use === 'ranged') {
      this.hasPistol = true;
      this.rangedName = o.name;
      this.ammo += 12;
      this.log(`${o.name}을(를) 주웠다. 쏠 것이 ${this.ammo}번 남았다.`);
    } else {
      this.hasKnife = true;
      this.meleeName = o.name;
      this.log(`${o.name}을(를) 주웠다. 손에 쥐어 본다.`);
    }
  }
```

`shoot()` 의 `this.log('총성이 복도를 타고 ...` 는 그대로 둔다 (계획 2 에서 전투를 다시 쓴다).

- [ ] **Step 3: 물체 이동** — `endTurn()` 의 `this.moveMonsters();` 아래 `if (this.dead) return;` 뒤에:

```js
    this.moveObjects();
```

`moveMonsters()` 위에:

```js
  /** 따라오거나 돌아다니는 물체. 해가 없고 길을 막지 않는다. */
  moveObjects() {
    const isFloor = (x, y) => !this.wall(x, y);
    for (const o of this.objects) {
      if (o.taken || o.where === 'wall' || o.moves === 'still') continue;
      const n = o.moves === 'follow'
        ? nextStep(isFloor, o, { x: this.cx, y: this.cy })
        : wanderStep(isFloor, o);
      if (n) { o.x = n.x; o.y = n.y; }
    }
  }
```

- [ ] **Step 4: 서술** — `describe()` 에서 이전 계획이 넣은 오브젝트 서술 4줄

```js
    const obj = this.objects.find((o) => o.x === this.cx && o.y === this.cy);
    if (obj) bits.push(`${obj.name}이(가) 있다.`);
    const front = !this.wall(a.x, a.y) && this.objects.find((o) => o.x === a.x && o.y === a.y);
    if (front) bits.push(`앞에 ${front.name} 같은 것이 서 있다.`);
```

을 교체:

```js
    const withDesc = (line, o) => (o.desc ? `${line} ${o.desc}` : line);
    const floorObj = (x, y) => this.objects.find((o) => !o.taken && o.where !== 'wall' && o.x === x && o.y === y);
    const here = floorObj(this.cx, this.cy);
    if (here) bits.push(withDesc(`${here.name}이(가) 있다.`, here));
    if (this.wall(a.x, a.y)) {
      const face = (this.facing + 2) % 4;
      const onWall = this.objects.filter((o) => o.where === 'wall' && o.x === a.x && o.y === a.y && o.face === face);
      if (onWall.length) bits.push(withDesc(`벽에 ${onWall[0].name}이(가) 걸려 있다.`, onWall[0]));
    } else {
      const front = floorObj(a.x, a.y);
      if (front) bits.push(withDesc(`앞에 ${front.name} 같은 것이 있다.`, front));
    }
```

- [ ] **Step 5: 그리기** — `collectSprites()` 의 오브젝트 루프 교체:

```js
    for (const o of this.objects) {
      if (o.taken) continue;
      if (o.where === 'wall') {
        // 벽면 바로 앞, 눈높이보다 조금 아래에 붙여 세운다.
        const [dx, dy] = DIRS[o.face];
        out.push({ kind: 'object', ref: o, x: o.x + 0.5 + dx * 0.55, y: o.y + 0.5 + dy * 0.55, h: 0.4, w: 0.45, lift: 0.28 });
      } else {
        out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.7, w: 0.6, ground: true });
      }
    }
```

`collectSprites()` 의 괴물 줄:

```js
      if (m.alive) out.push({ kind: 'monster', x: m.x + 0.5, y: m.y + 0.5, h: 1.05, w: 0.75 });
```

→

```js
      if (m.alive) out.push({ kind: 'monster', ref: this.w.monsterLook ? { ...this.w.monsterLook, id: 'monster' } : null, x: m.x + 0.5, y: m.y + 0.5, h: 1.05, w: 0.75 });
```

`drawSprites()` 의 `const bottom = s.ground ? floorY : floorY;` → `const bottom = floorY - unit * (s.lift || 0);`

드리프트 루프에서 벽 물체 제외: `if (o.wasVisible && !o.visible) {` → `if (o.where !== 'wall' && o.wasVisible && !o.visible) {`

`paintSprite()` 의 이미지 분기 조건을 괴물 모습까지 받도록:

```js
    const canvas = sprite(ref?.img);
    if (kind === 'object' || canvas || (kind === 'monster' && ref)) {
```

- [ ] **Step 6: 확인**

Run: `npm test` / Expected: `전부 통과` 네 번. `node --check public/game.js` 오류 없음.

브라우저 확인 (창이 보이는 상태여야 한다. 가려져 있으면 사용자에게 창을 띄워 달라고 요청한다):

```bash
rm -f browser.db*; DB_PATH=./browser.db node -e "import('./src/db.js').then(({q})=>{const u=q.upsertUser.get('dev-local','테스트 플레이어',null,Date.now());q.insertEntry.get(u.id,null,'x','applied','x',JSON.stringify([{type:'maze.size',value:9},{type:'maze.layout',value:'room'},{type:'object.spawn',name:'활',emoji:'🏹',where:'entrance',use:'ranged'},{type:'object.spawn',name:'가면',emoji:'🙃',where:'wall',count:5,desc:'웃음이 거꾸로다.'},{type:'object.spawn',name:'고양이',emoji:'🐈',moves:'follow'},{type:'entity.monster',count:1},{type:'entity.monster_look',name:'거미',emoji:'🕷️'}]),Date.now())})"
DEV_NO_AUTH=1 IMAGE_PROVIDER=none DB_PATH=./browser.db PORT=3998 node src/server.js
```

- [ ] 9×9 방에 내부 벽이 없다
- [ ] 시작 칸 가까이에 🏹, 올라서면 "활을(를) 줍는다", 주우면 "활을(를) 쏜다"
- [ ] 벽면에 🙃 가 눈높이 아래에 붙어 있고, 마주 보면 "벽에 가면이(가) 걸려 있다. 웃음이 거꾸로다."
- [ ] 🐈 가 한 턴마다 다가오고 플레이어 칸에는 들어오지 않는다
- [ ] 괴물이 실루엣 대신 🕷️
- [ ] 콘솔 에러 없음

정리: 포트 3998 프로세스만 종료, `browser.db*` 삭제.

- [ ] **Step 7: 커밋**

```bash
git add public/game.js
git commit -m "적힌 도구를 줍고, 물체가 따라오고, 벽에 걸리고, 괴물이 적힌 모습이 된다"
```
