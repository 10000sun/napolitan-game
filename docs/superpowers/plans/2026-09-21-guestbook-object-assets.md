# 방명록 오브젝트 에셋 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 방명록에 적힌 물체를 미로 안에 기괴하게 보이는 스프라이트로 놓고, 줍는 아이템도 에셋으로 그리며, 죽은 사람의 시체를 죽은 자리에 남긴다.

**Architecture:** 판정 LLM 이 `object.spawn {name, tags, emoji, count}` Effect 를 낸다. 기입 직후 서버가 백그라운드로 에셋을 확보한다 (캐시 → 태그 매칭 → Gemini → Pollinations → 실패). 런 시작 때는 DB 조회만 해서 이미지 URL 을 붙이고, 클라이언트가 배경 제거·기괴 보정을 해서 그린다. 이미지가 없으면 이모지(오브젝트) 또는 기존 도형(아이템).

**Tech Stack:** Node 20 (ESM), express, better-sqlite3, 브라우저 Canvas 2D. 새 의존성 없음. 테스트는 기존처럼 `node test/*.js` + `check()` 헬퍼.

**Spec:** `docs/superpowers/specs/2026-09-21-guestbook-object-assets-design.md`

## Global Constraints

- LLM·이미지 생성 호출은 방명록 기입 시점(과 서버 시작 시 아이템 3종)에만. `/api/run/start` 에서 외부 호출 0회.
- 같은 방명록이면 같은 오브젝트가 같은 자리에. 사망 시체는 다른 배치(괴물·함정·시체·오브젝트)를 바꾸지 않는다.
- 기입 응답은 이미지 생성을 기다리지 않는다.
- LLM 출력은 `sanitize()` / `normalizeObject()` 를 통과한다.
- 새 npm 의존성 금지.
- `IMAGE_PROVIDER=gemini` (기본) | `pollinations` | `none`, `IMAGE_MODEL=gemini-2.5-flash-image`, `IMAGE_DAILY_LIMIT=20`.
- 파일명에 사용자 입력을 쓰지 않는다: `data/assets/{sha1(key).slice(0,16)}.{png|jpg|webp}`.
- 오브젝트 최대 30종, count 1~5, tags 최대 6개, name 40자. 사망 시체 최근 30구.
- 누가 죽었는지 노출하지 않는다.
- 주석·로그·사용자 문구는 한국어, 기존 코드 말투를 따른다.

## Review Focus

1. 한국어 이름만 있고 영어 태그가 비는 오브젝트 → 어떤 에셋과도 매칭되지 않고(빈 집합끼리 1.0 이 되면 안 됨) 생성으로 간다. → Task 3 테스트.
2. 이미지 제공자가 200 과 함께 HTML·JSON 에러 본문을 돌려줌 → 저장하지 않고 다음 제공자로 넘어간다. → Task 4 테스트.
3. 같은 이름을 대소문자·공백만 다르게 적음 → 같은 key, 같은 에셋. → Task 1 테스트.
4. 조작된 사망 좌표 (문자열·음수·소수·범위 밖·누락) → 좌표 없이 사망만 기록. → Task 2 테스트 (`deathCell`).
5. DB 에는 ready 인데 `data/assets` 파일이 지워짐 → URL 을 내려보내지 않아 이모지로 떨어진다. → Task 3 테스트 (`imgFor`).

---

## File Structure

| 파일 | 역할 |
|---|---|
| `src/effects.js` (수정) | `object.spawn` Effect, `normalizeObject` / `normalizeTags` / `objectKey` |
| `src/compiler.js` (수정) | 프롬프트 예시 한 줄 |
| `src/world.js` (수정) | 오브젝트 배치, 사망 시체, `deathCell` |
| `src/db.js` (수정) | `assets` 테이블, `runs.death_x/y`, 관련 쿼리 |
| `src/assets.js` (신규) | 매칭·해석·생성기·파일 저장·`imgFor`·`ITEM_ASSETS` |
| `scripts/tag-assets.js` (신규) | 라이브러리 파일명 → 태그 초안 |
| `assets/library.json`, `assets/library/.gitkeep` (신규) | 빈 라이브러리 |
| `src/server.js` (수정) | 기입 후 해석 호출, 런 시작 시 URL 부착, 사망 좌표, 정적 서빙 |
| `public/uncanny.js` (신규) | 이미지 로드·배경 제거·기괴 보정 그리기 |
| `public/game.js` (수정) | 오브젝트 스프라이트, 아이템 이미지, 드리프트, 서술, 사망 좌표 |
| `public/ui.js` (수정) | `/die` 에 좌표 전송 |
| `test/compiler.js`, `test/replay.js` (수정), `test/assets.js` (신규) | 테스트 |
| `.env.example`, `.gitignore`, `package.json`, `README.md` (수정) | 설정·문서 |

---

### Task 1: `object.spawn` Effect

**Files:**
- Modify: `src/effects.js` (EFFECTS 에 항목 추가, `initialState`, 새 export 3개)
- Modify: `src/compiler.js` (SYSTEM 프롬프트 예시 목록 끝)
- Test: `test/compiler.js` (마지막 `console.log(fail === 0` 줄 바로 위)

**Interfaces:**
- Produces:
  - `objectKey(name: string): string` — trim, 소문자, 연속 공백 → 한 칸
  - `normalizeTags(tags: string | string[]): string[]` — 소문자, `[a-z0-9 -]` 외 제거, 중복 제거, 최대 6
  - `normalizeObject(e): { key, name, tags: string[], emoji, count } | null`
  - 월드 상태 `state.objects: Array<{ key, name, tags, emoji, count }>`

- [ ] **Step 1: 실패하는 테스트 작성** — `test/compiler.js` 의 `console.log(fail === 0 ...` 줄 바로 위에 추가

```js
// ── object.spawn ────────────────────────────────────────
const { normalizeObject, foldEffects } = await import('../src/effects.js');

let o = normalizeObject({ name: '  웃는   가면 ', tags: 'Mask, SMILING!, porcelain, mask', emoji: '🎭x', count: 9 });
check(o.key === '웃는 가면', 'key 는 공백을 줄이고 소문자로');
check(JSON.stringify(o.tags) === '["mask","smiling","porcelain"]', '태그 정규화·중복 제거');
check(o.emoji === '🎭', '이모지는 첫 글자 하나');
check(o.count === 5, 'count 는 5 로 잘린다');
check(normalizeObject({ name: '웃는 가면', tags: 'a,b' }).key === normalizeObject({ name: '웃는  가면 ' }).key,
  '공백만 다른 이름은 같은 key');
check(normalizeObject({ name: 'Slime' }).key === normalizeObject({ name: 'slime' }).key, '대소문자만 다른 이름은 같은 key');
check(normalizeObject({ name: '   ', tags: 'x' }) === null, '빈 이름은 버린다');
check(normalizeObject({ name: 'x'.repeat(80) }).name.length === 40, '이름은 40자');
check(normalizeObject({ name: 'a', tags: 'a,b,c,d,e,f,g,h' }).tags.length === 6, '태그는 6개까지');
check(normalizeObject({ name: '가면', emoji: 'mask' }).emoji === '❔', '이모지가 아니면 ❔');
check(normalizeObject({ name: '가면', count: 0 }).count === 1, 'count 최소 1');
check(normalizeObject({ name: 'Dark Slime' }).tags[0] === 'dark slime', '태그가 없고 이름이 영어면 이름이 태그');
check(normalizeObject({ name: '젤리' }).tags.length === 0, '태그가 없고 이름이 한국어면 빈 태그');

let st = foldEffects([
  [{ type: 'object.spawn', name: '가면', tags: 'mask', emoji: '🎭', count: 1 }],
  [{ type: 'object.spawn', name: '가면', tags: 'mask,cracked', emoji: '🎭', count: 3 }],
]);
check(st.objects.length === 1 && st.objects[0].count === 3, '같은 key 는 덮어쓴다');
st = foldEffects(Array.from({ length: 40 }, (_, i) => [{ type: 'object.spawn', name: `o${i}`, tags: 'x' }]));
check(st.objects.length === 30, '오브젝트는 30종까지');
```

- [ ] **Step 2: 실패 확인**

Run: `node test/compiler.js`
Expected: FAIL — `normalizeObject is not a function` 류의 에러

- [ ] **Step 3: 구현** — `src/effects.js`

EFFECTS 의 `'flavor.text'` 항목 **바로 위**에 추가:

```js
  'object.spawn': {
    desc: '구체적인 물체·생물이 방 안에 놓이거나 나타나기를 바랄 때. 엔진 규칙에는 영향이 없고 눈에 보이기만 한다. '
      + '위의 Effect 로 옮겨지는 것(권총·칼·지도·시체·괴물)은 여기 쓰지 않는다. '
      + 'name 은 적힌 그대로의 짧은 한국어 이름, tags 는 생김새를 설명하는 영어 단어 3~6개를 쉼표로, '
      + 'emoji 는 가장 가까운 이모지 1개, count 는 1~5.',
    params: { name: 'string', tags: 'string', emoji: 'string', count: 'number' },
    apply: (s, e) => {
      const o = normalizeObject(e);
      if (!o) return;
      const i = s.objects.findIndex((x) => x.key === o.key);
      if (i >= 0) s.objects[i] = o;
      else if (s.objects.length < 30) s.objects.push(o);
    },
  },
```

`initialState()` 의 `flavor: [],` 위에 `objects: [],` 추가.

`clampOdd` 정의 아래에 추가:

```js
/** 같은 물건이면 같은 key. 대소문자·공백 차이는 무시한다. */
export function objectKey(name) {
  return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 영어 태그만 남긴다. 라이브러리 파일명과 이미지 생성 프롬프트가 영어라서. */
export function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags ?? '').split(',');
  const out = [];
  for (const t of list) {
    const v = String(t).toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/\s+/g, ' ').trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length === 6) break;
  }
  return out;
}

const segmenter = new Intl.Segmenter();

/** LLM 이 낸 object.spawn 을 엔진이 믿을 수 있는 모양으로. 이름이 없으면 null. */
export function normalizeObject(e) {
  const name = String(e?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  let tags = normalizeTags(e.tags);
  if (!tags.length) tags = normalizeTags(name);   // 이름이 영어면 그대로 태그가 된다
  const first = [...segmenter.segment(String(e.emoji ?? '').trim())][0]?.segment || '';
  const emoji = /\p{Extended_Pictographic}/u.test(first) ? first : '❔';
  return { key: objectKey(name), name, tags, emoji, count: clamp(e.count ?? 1, 1, 5) };
}
```

`src/compiler.js` SYSTEM 의 예시 목록 마지막 줄
`  { "type": "flavor.text", "text": "벽 어딘가에 눈금이 새겨져 있다." }` **위에** 한 줄 추가:

```
  { "type": "object.spawn", "name": "벽에 걸린 웃는 가면", "tags": "mask, smiling, porcelain, cracked", "emoji": "🎭", "count": 1 }
```

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `전부 통과` 두 번 (replay, compiler)

- [ ] **Step 5: 커밋**

```bash
git add src/effects.js src/compiler.js test/compiler.js
git commit -m "방명록 물체를 object.spawn Effect 로 받는다"
```

---

### Task 2: 오브젝트 배치와 죽은 자리 시체

**Files:**
- Modify: `src/world.js` (`buildWorld` 시그니처·배치, 새 함수 `nearestFloor`, `deathCell`)
- Test: `test/replay.js` (마지막 `console.log(fail === 0` 줄 바로 위)

**Interfaces:**
- Consumes: `state.objects` (Task 1)
- Produces:
  - `buildWorld(appliedRules, deaths = [])` → 반환에 `objects: Array<{ id: string, key, name, emoji, x: int, y: int }>` 추가, `corpses` 에 사망 시체가 뒤에 붙는다
  - `deathCell(body, size): { x, y } | null` — 정수이고 `0 <= x,y < size` 일 때만

- [ ] **Step 1: 실패하는 테스트 작성** — `test/replay.js` 의 `console.log(fail === 0` 줄 바로 위

```js
// ── 오브젝트 ────────────────────────────────────────────
const withObj = [...rules, { id: 99, raw_text: '웃는 가면이 있었으면',
  effects: [{ type: 'object.spawn', name: '웃는 가면', tags: 'mask', emoji: '🎭', count: 3 }] }];
const wo = buildWorld(withObj);
check(wo.objects.length === 3 && wo.objects.every((o) => o.key === '웃는 가면'), '오브젝트가 count 만큼 놓인다');
check(JSON.stringify(buildWorld(withObj).objects) === JSON.stringify(wo.objects), '같은 방명록이면 오브젝트도 같은 자리');
check(wo.objects.every((o) => wo.grid[o.y][o.x] === 0), '오브젝트는 바닥 칸에만');
check(new Set(wo.objects.map((o) => o.id)).size === 3, '오브젝트 id 는 서로 다르다');

// ── 죽은 자리 시체 ──────────────────────────────────────
const nearExit = (x, y) => Math.abs(x - wo.exit.x) + Math.abs(y - wo.exit.y) <= 1;
let wallCell = null;
for (let y = 2; y < wo.size - 1 && !wallCell; y++) {
  for (let x = 2; x < wo.size - 1 && !wallCell; x++) {
    const floorNb = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => wo.grid[y + dy][x + dx] === 0);
    if (wo.grid[y][x] === 1 && floorNb && !nearExit(x, y)) wallCell = { x, y };
  }
}
const m0 = { x: Math.floor(wo.monsters[0].x), y: Math.floor(wo.monsters[0].y) };
const wd = buildWorld(withObj, [m0, wallCell, { x: 1, y: 1 }, { x: wo.exit.x, y: wo.exit.y }]);
const strip = (w) => JSON.stringify({ m: w.monsters, t: w.traps, o: w.objects, c: w.corpses.slice(0, wo.corpses.length) });
check(strip(wd) === strip(wo), '사망 기록은 괴물·함정·시체·오브젝트 위치를 바꾸지 않는다');
const added = wd.corpses.slice(wo.corpses.length);
check(added.length === 2, '시작 칸·출구 칸 사망은 버린다');
check(added[0].x === m0.x && added[0].y === m0.y, '바닥 칸에서 죽으면 그 자리에');
check(wd.grid[added[1].y][added[1].x] === 0
  && Math.abs(added[1].x - wallCell.x) + Math.abs(added[1].y - wallCell.y) === 1, '벽 칸 좌표는 가장 가까운 바닥으로');
check(buildWorld(withObj, Array(40).fill(m0)).corpses.length === wo.corpses.length + 30, '사망 시체는 30구까지');

// ── 사망 좌표 검증 ──────────────────────────────────────
check(JSON.stringify(deathCell({ x: 3, y: 4 }, 15)) === '{"x":3,"y":4}', '정상 좌표는 받는다');
for (const bad of [{ x: '3', y: 4 }, { x: -1, y: 4 }, { x: 3.5, y: 4 }, { x: 15, y: 4 }, { y: 4 }, null, { x: 3, y: 1e9 }]) {
  check(deathCell(bad, 15) === null, `이상한 좌표는 버린다 ${JSON.stringify(bad)}`);
}
```

파일 첫 줄 import 를 바꾼다:

```js
import { buildWorld, deathCell } from '../src/world.js';
```

- [ ] **Step 2: 실패 확인**

Run: `node test/replay.js`
Expected: FAIL — `deathCell` export 없음 (SyntaxError)

- [ ] **Step 3: 구현** — `src/world.js`

`bfsDistances` 아래에 추가:

```js
/** (x, y) 에서 가장 가까운 바닥 칸. 범위 밖 좌표는 가장자리로 당겨서 찾는다. */
function nearestFloor(grid, x, y) {
  const n = grid.length;
  const sx = Math.max(0, Math.min(n - 1, x)), sy = Math.max(0, Math.min(n - 1, y));
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
    if (grid[cy][cx] === 0) return { x: cx, y: cy };
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = cx + dx, ny = cy + dy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n || seen.has(k)) continue;
      seen.add(k);
      q.push([nx, ny]);
    }
  }
  return null;
}

/** 클라이언트가 보낸 사망 좌표. 믿을 수 있는 모양일 때만. */
export function deathCell(body, size) {
  const x = body?.x, y = body?.y;
  const ok = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < size && y < size;
  return ok ? { x, y } : null;
}
```

`buildWorld` 의 JSDoc 과 시그니처:

```js
/**
 * 반영된 규칙 목록 → 플레이 가능한 월드.
 * @param {Array<{id:number, effects:Array}>} appliedRules 시간순
 * @param {Array<{x:number, y:number}>} deaths 최근 사망 칸 (최신순). 미로 구조에는 영향 없음
 */
export function buildWorld(appliedRules, deaths = []) {
```

`const corpses = take(state.corpses);` 바로 아래에 추가:

```js
  const objects = [];
  for (const o of state.objects) {
    take(o.count).forEach((c, i) => {
      objects.push({ id: `o:${o.key}:${i}`, key: o.key, name: o.name, emoji: o.emoji, x: c.x, y: c.y });
    });
  }

  // 여기서 죽은 사람들. 모든 take() 가 끝난 뒤에 얹어야 사망 기록이 다른 배치를 흔들지 않는다.
  for (const d of deaths.slice(0, 30)) {
    const c = nearestFloor(grid, d.x, d.y);
    if (!c || (c.x === 1 && c.y === 1) || (exit && c.x === exit.x && c.y === exit.y)) continue;
    corpses.push(c);
  }
```

반환 객체의 `items,` 아래에 `objects,` 추가.

- [ ] **Step 4: 통과 확인**

Run: `npm test`
Expected: `전부 통과` 두 번

- [ ] **Step 5: 커밋**

```bash
git add src/world.js test/replay.js
git commit -m "오브젝트를 미로에 놓고 죽은 자리에 시체를 남긴다"
```

---

### Task 3: 에셋 해석기 (캐시·매칭·한도·폴백)

**Files:**
- Modify: `src/db.js` (`assets` 테이블 + 쿼리 4개)
- Create: `src/assets.js`
- Create: `assets/library.json` (`[]`), `assets/library/.gitkeep` (빈 파일)
- Create: `test/assets.js`
- Modify: `package.json` (`test` 스크립트)

**Interfaces:**
- Consumes: `normalizeObject` 결과 모양 `{ key, name, tags: string[] }` (Task 1)
- Produces:
  - `matchTags(tags: string[], candidates: Array<{tags: string[], file: string}>): { entry, score }`
  - `resolveAsset(obj, opts?) : Promise<assetRow>` — `opts = { generators, library, now, dir }`, 생성기 모양 `(prompt: string) => Promise<{ data: Buffer, ext: 'png'|'jpg'|'webp' }>`
  - `imgFor(key: string): string | null` — `'/obj/…'` 또는 `'/lib/…'`
  - `assetDir(): string`, `LIBRARY_DIR: string`
  - `ITEM_ASSETS: { pistol, knife, map }` 각각 `{ key, name, tags }`
  - `GENERATORS` 는 Task 4 에서 채운다. 이 태스크에서는 `export const GENERATORS = {};`
  - assetRow: `{ key, tags, source: 'match'|'gemini'|'pollinations'|'none', file: string|null, status: 'ready'|'failed', created_at }`

- [ ] **Step 1: DB** — `src/db.js` 의 `db.exec(` 블록 안 `CREATE INDEX IF NOT EXISTS idx_runs_user` 줄 아래에 추가

```sql
-- 방명록 물체의 모습. 한 번 확보하면 같은 물체에 계속 쓴다.
CREATE TABLE IF NOT EXISTS assets (
  key         TEXT PRIMARY KEY,
  tags        TEXT NOT NULL,        -- 쉼표 구분
  source      TEXT NOT NULL,        -- match | gemini | pollinations | none
  file        TEXT,                 -- /obj/... 또는 /lib/...
  status      TEXT NOT NULL,        -- ready | failed
  created_at  INTEGER NOT NULL
);
```

`q` 객체의 `stats:` 위에 추가:

```js
  assetByKey: db.prepare('SELECT * FROM assets WHERE key = ?'),
  readyAssets: db.prepare("SELECT tags, file FROM assets WHERE status = 'ready'"),
  insertAsset: db.prepare(`
    INSERT OR REPLACE INTO assets (key, tags, source, file, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`),
  generatedSince: db.prepare('SELECT COUNT(*) AS n FROM assets WHERE source = ? AND created_at >= ?'),
```

(스펙과 다른 점: 매칭 재사용 행은 원본 source 대신 `'match'` 로 적는다. 그래야 일일 Gemini 생성 수가 부풀지 않는다.)

- [ ] **Step 2: 실패하는 테스트 작성** — `test/assets.js`

```js
// 에셋 해석기. 네트워크 없이 가짜 생성기를 끼워서 흐름만 본다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'napo-assets-'));
process.env.DB_PATH = path.join(tmp, 'test.db');
process.env.ASSET_DIR = path.join(tmp, 'obj');
process.env.IMAGE_PROVIDER = 'gemini';
process.env.IMAGE_DAILY_LIMIT = '2';

const { matchTags, resolveAsset, imgFor } = await import('../src/assets.js');
const { q } = await import('../src/db.js');

let fail = 0;
const check = (c, label) => { console.log(`  ${c ? '✓' : '✗'} ${label}`); if (!c) fail++; };

const PNG = { data: Buffer.alloc(200, 1), ext: 'png' };
const calls = [];
const gen = (name, ok = true) => async (prompt) => {
  calls.push({ name, prompt });
  if (!ok) throw new Error(`${name} 실패`);
  return PNG;
};
const gens = { gemini: gen('gemini'), pollinations: gen('pollinations') };
const obj = (name, tags) => ({ key: name, name, tags });

// ── 매칭 ────────────────────────────────────────────────
const lib = [{ tags: ['slime', 'green'], file: '/lib/slime.png' }, { tags: ['mask'], file: '/lib/mask.png' }];
check(matchTags(['slime', 'green'], lib).entry.file === '/lib/slime.png', '태그가 같으면 그 에셋');
check(matchTags(['slime', 'water'], lib).score < 0.5, '반만 겹치면 0.5 미만 (1/3)');
check(matchTags(['mask', 'smiling'], lib).score === 0.5, '경계값 0.5');
check(matchTags([], lib).score === 0 && matchTags([], [{ tags: [], file: 'x' }]).score === 0,
  '빈 태그는 아무것과도 매칭되지 않는다');

// ── 흐름 ────────────────────────────────────────────────
let r = await resolveAsset(obj('웃는 가면', ['mask', 'smiling']), { generators: gens, library: lib });
check(r.status === 'ready' && r.file === '/lib/mask.png' && r.source === 'match', '라이브러리 매칭이면 생성하지 않는다');
check(calls.length === 0, '생성기 호출 0회');

r = await resolveAsset(obj('젤리', []), { generators: gens, library: lib });
check(r.source === 'gemini' && /^\/obj\/[0-9a-f]{16}\.png$/.test(r.file), '매칭이 없으면 gemini 로 생성, 파일명은 해시');
check(fs.existsSync(path.join(process.env.ASSET_DIR, path.basename(r.file))), '파일이 실제로 저장된다');
check(calls[0].prompt.startsWith('젤리, ') && calls[0].prompt.includes('uncanny'), '태그가 없으면 이름 + 고정 화풍');

calls.length = 0;
r = await resolveAsset(obj('젤리', []), { generators: gens, library: lib });
check(calls.length === 0 && r.source === 'gemini', '같은 key 는 캐시에서');

r = await resolveAsset(obj('slime', ['slime', 'green']), { generators: gens, library: [] });
check(r.source === 'gemini', '두 번째 gemini 생성');
r = await resolveAsset(obj('green slime', ['slime', 'green']), { generators: gens, library: [] });
check(r.source === 'match' && r.file === q.assetByKey.get('slime').file, '생성한 에셋도 다음 매칭 대상이 된다');

calls.length = 0;
r = await resolveAsset(obj('눈알', ['eyeball']), { generators: gens, library: [] });
check(r.source === 'pollinations' && calls.map((c) => c.name).join() === 'pollinations',
  '일일 한도(2)를 넘으면 pollinations 로');

r = await resolveAsset(obj('다음날 눈알', ['eyeball2']), { generators: gens, library: [], now: Date.now() + 86_400_000 });
check(r.source === 'gemini', '다음 날이면 다시 gemini');

calls.length = 0;
r = await resolveAsset(obj('손', ['hand']), {
  generators: { gemini: gen('gemini', false), pollinations: gen('pollinations', false) }, library: [],
  now: Date.now() + 2 * 86_400_000,
});
check(r.status === 'failed' && r.file === null, '전부 실패하면 failed');
check(calls.map((c) => c.name).join() === 'gemini,pollinations', 'gemini 실패 → pollinations 시도');

calls.length = 0;
const [a, b] = await Promise.all([
  resolveAsset(obj('동시', ['same']), { generators: gens, library: [], now: Date.now() + 3 * 86_400_000 }),
  resolveAsset(obj('동시', ['same']), { generators: gens, library: [], now: Date.now() + 3 * 86_400_000 }),
]);
check(calls.length === 1 && a.file === b.file, '같은 key 를 동시에 요청해도 생성은 한 번');

// ── imgFor ──────────────────────────────────────────────
check(imgFor('웃는 가면') === '/lib/mask.png', 'ready 면 URL');
check(imgFor('손') === null && imgFor('없는것') === null, 'failed·없음이면 null');
const jelly = q.assetByKey.get('젤리').file;
fs.rmSync(path.join(process.env.ASSET_DIR, path.basename(jelly)));
check(imgFor('젤리') === null, '파일이 지워졌으면 null');

console.log(fail === 0 ? '\n전부 통과\n' : `\n${fail}건 실패\n`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 3: 실패 확인**

Run: `node test/assets.js`
Expected: FAIL — `Cannot find module '../src/assets.js'`

- [ ] **Step 4: 구현** — `src/assets.js`

```js
// ─────────────────────────────────────────────────────────────
// 방명록 물체의 모습
//
// 물체가 적히는 순간 한 번만 모습을 정한다. 플레이 중에는 부르지 않는다.
//   1) 같은 물체를 이미 봤으면 그걸 쓴다
//   2) 가진 에셋(라이브러리 + 전에 만든 것) 중 태그가 충분히 겹치면 그걸 쓴다
//   3) 없으면 만든다. Gemini 가 하루 한도를 넘으면 그날은 Pollinations
//   4) 그래도 안 되면 포기한다. 화면에는 이모지가 대신 선다
// ─────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q } from './db.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LIBRARY_DIR = path.join(ROOT, 'assets', 'library');
const LIBRARY_JSON = path.join(ROOT, 'assets', 'library.json');
export const assetDir = () => process.env.ASSET_DIR || path.join(ROOT, 'data', 'assets');

const MATCH_MIN = 0.5;
export const STYLE = 'single object, centered, isolated on plain pure black background, uncanny, '
  + 'subtly wrong proportions, desaturated, grainy found photograph, unsettling, no text';

/** 줍는 아이템의 바닥 모습. 태그는 고정. */
export const ITEM_ASSETS = {
  pistol: { key: 'item:pistol', name: '권총', tags: ['pistol', 'handgun', 'rusty'] },
  knife: { key: 'item:knife', name: '칼', tags: ['knife', 'kitchen knife', 'bloody'] },
  map: { key: 'item:map', name: '지도', tags: ['map', 'paper', 'crumpled'] },
};

/** Task 4 에서 채운다. */
export const GENERATORS = {};

/** 태그 겹침(Jaccard)으로 가장 비슷한 것. 빈 태그는 아무것과도 맞지 않는다. */
export function matchTags(tags, candidates) {
  const a = new Set(tags);
  let best = { entry: null, score: 0 };
  if (!a.size) return best;
  for (const c of candidates) {
    const b = new Set(c.tags);
    let inter = 0;
    for (const t of a) if (b.has(t)) inter++;
    const score = inter / (a.size + b.size - inter);
    if (score > best.score) best = { entry: c, score };
  }
  return best;
}

export function loadLibrary() {
  try {
    return JSON.parse(fs.readFileSync(LIBRARY_JSON, 'utf8'))
      .map((e) => ({ tags: e.tags, file: `/lib/${e.file}` }));
  } catch {
    return [];
  }
}

const hashKey = (key) => crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);

/** 오늘 무엇으로 만들지. Gemini 가 한도를 넘었으면 Pollinations 만. */
function generatorOrder(now) {
  const provider = (process.env.IMAGE_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'none') return [];
  if (provider === 'pollinations') return ['pollinations'];
  const limit = Number(process.env.IMAGE_DAILY_LIMIT ?? 20);
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const used = q.generatedSince.get('gemini', midnight.getTime()).n;
  return used < limit ? ['gemini', 'pollinations'] : ['pollinations'];
}

const inflight = new Map();

/** 물체의 모습을 확보한다. 같은 key 를 동시에 불러도 한 번만 만든다. */
export function resolveAsset(obj, opts = {}) {
  if (inflight.has(obj.key)) return inflight.get(obj.key);
  const p = doResolve(obj, opts).finally(() => inflight.delete(obj.key));
  inflight.set(obj.key, p);
  return p;
}

async function doResolve(obj, { generators = GENERATORS, library = loadLibrary(), now = Date.now(), dir = assetDir() } = {}) {
  const hit = q.assetByKey.get(obj.key);
  if (hit) return hit;

  const save = (source, file, status) => {
    q.insertAsset.run(obj.key, obj.tags.join(','), source, file, status, now);
    return q.assetByKey.get(obj.key);
  };

  const pool = [...library, ...q.readyAssets.all().map((r) => ({ tags: r.tags.split(','), file: r.file }))];
  const m = matchTags(obj.tags, pool);
  if (m.score >= MATCH_MIN) return save('match', m.entry.file, 'ready');

  const prompt = `${(obj.tags.length ? obj.tags : [obj.name]).join(', ')}, ${STYLE}`;
  for (const name of generatorOrder(now)) {
    try {
      if (!generators[name]) throw new Error('생성기가 없습니다');
      const img = await generators[name](prompt);
      const file = `${hashKey(obj.key)}.${img.ext}`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, file), img.data);
      return save(name, `/obj/${file}`, 'ready');
    } catch (e) {
      console.error(`[asset:${name}]`, obj.key, e.message);
    }
  }
  return save('none', null, 'failed');
}

/**
 * 런 시작 때 붙일 URL. 준비 안 됐거나 생성 파일이 사라졌으면 null → 화면에는 대체 표시.
 * 라이브러리 파일은 운영자가 직접 관리하므로 확인하지 않는다 (없으면 클라이언트 onerror 로 떨어진다).
 */
export function imgFor(key) {
  const a = q.assetByKey.get(key);
  if (a?.status !== 'ready' || !a.file) return null;
  if (a.file.startsWith('/obj/') && !fs.existsSync(path.join(assetDir(), path.basename(a.file)))) return null;
  return a.file;
}
```

`assets/library.json`:

```json
[]
```

`assets/library/.gitkeep`: 빈 파일.

`package.json` 의 `"test"` 를:

```json
    "test": "node test/replay.js && node test/compiler.js && node test/assets.js",
```

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: `전부 통과` 세 번

- [ ] **Step 6: 커밋**

```bash
git add src/db.js src/assets.js assets/library.json assets/library/.gitkeep test/assets.js package.json
git commit -m "물체의 모습을 캐시·매칭·생성 순으로 확보한다"
```

---

### Task 4: 이미지 생성기와 라이브러리 태깅 스크립트

**Files:**
- Modify: `src/assets.js` (`GENERATORS`, `toImage`)
- Create: `scripts/tag-assets.js`
- Modify: `test/assets.js` (마지막 `console.log(fail === 0` 줄 바로 위)
- Modify: `package.json` (`tag-assets` 스크립트), `.env.example`, `.gitignore`

**Interfaces:**
- Consumes: `normalizeTags` (Task 1), 생성기 모양 (Task 3)
- Produces:
  - `GENERATORS.gemini(prompt)`, `GENERATORS.pollinations(prompt)` → `{ data: Buffer, ext }`
  - `toImage(data: Buffer, mime: string): { data, ext }` — 이미지가 아니면 throw
  - `tagsFromFilename(file: string): string[]`

- [ ] **Step 1: API 확인** — 구현 전에 두 기본값을 공식 문서로 확인한다.
  - Gemini 이미지 생성: <https://ai.google.dev/gemini-api/docs/image-generation> 에서 모델 이름(`gemini-2.5-flash-image` 인지), `generateContent` 요청 본문(특히 `generationConfig.responseModalities`), 응답의 `inlineData { mimeType, data }` 위치, 무료 한도와 장당 단가.
  - Pollinations: <https://github.com/pollinations/pollinations> 의 API 문서에서 이미지 URL 형식(`https://image.pollinations.ai/prompt/{prompt}`)과 파라미터(`width`, `height`, `nologo`).
  - 문서와 다르면 Step 3 코드의 해당 부분만 문서대로 바꾸고, 바꾼 내용을 커밋 메시지에 적는다. 단가는 Task 5 의 README 에 쓴다.

- [ ] **Step 2: 실패하는 테스트 작성** — `test/assets.js` 의 `console.log(fail === 0` 위

```js
// ── 생성기 어댑터 (fetch 가로채기) ───────────────────────
const { GENERATORS, toImage } = await import('../src/assets.js');
const { tagsFromFilename } = await import('../scripts/tag-assets.js');
const realFetch = globalThis.fetch;
let reply = null, lastUrl = '', lastBody = null;
globalThis.fetch = async (url, opts = {}) => { lastUrl = String(url); lastBody = opts.body ? JSON.parse(opts.body) : null; return reply(); };

const pngB64 = Buffer.alloc(300, 7).toString('base64');
process.env.GEMINI_API_KEY = 'k';
reply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'hi' }, { inlineData: { mimeType: 'image/png', data: pngB64 } }] } }] }), { status: 200 });
let img = await GENERATORS.gemini('mask, uncanny');
check(img.ext === 'png' && img.data.length === 300, 'gemini: inlineData 를 이미지로');
check(lastUrl.includes(':generateContent') && lastBody.contents[0].parts[0].text === 'mask, uncanny', 'gemini: 프롬프트가 본문에');

reply = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '거절' }] } }] }), { status: 200 });
check(await GENERATORS.gemini('x').then(() => false, () => true), 'gemini: 이미지가 없으면 실패');

delete process.env.GEMINI_API_KEY;
check(await GENERATORS.gemini('x').then(() => false, () => true), 'gemini: 키가 없으면 실패');

reply = () => new Response(Buffer.alloc(500, 1), { status: 200, headers: { 'content-type': 'image/jpeg' } });
img = await GENERATORS.pollinations('eye, uncanny');
check(img.ext === 'jpg' && lastUrl.startsWith('https://image.pollinations.ai/prompt/eye%2C%20uncanny'), 'pollinations: jpeg 를 받는다');

reply = () => new Response('<html>rate limited</html>', { status: 200, headers: { 'content-type': 'text/html' } });
check(await GENERATORS.pollinations('x').then(() => false, () => true), 'pollinations: 200 이어도 이미지가 아니면 실패');

check(await Promise.resolve().then(() => toImage(Buffer.alloc(10), 'image/png')).then(() => false, () => true), '너무 작은 이미지는 거부');
check(await Promise.resolve().then(() => toImage(Buffer.alloc(6e6), 'image/png')).then(() => false, () => true), '5MB 넘는 이미지는 거부');
globalThis.fetch = realFetch;

// ── 라이브러리 태깅 ──────────────────────────────────────
check(JSON.stringify(tagsFromFilename('slime_green-02.png')) === '["slime","green"]', '파일명에서 태그 초안');
```

- [ ] **Step 3: 실패 확인**

Run: `node test/assets.js`
Expected: FAIL — `Cannot find module '../scripts/tag-assets.js'`

- [ ] **Step 4: 구현**

`src/assets.js` 의 `export const GENERATORS = {};` 와 그 위 주석 줄을 아래로 교체:

```js
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

/** 받은 게 정말 이미지인지. 200 에 HTML 에러를 주는 곳이 있다. */
export function toImage(data, mime) {
  const ext = EXT[String(mime || '').split(';')[0].trim().toLowerCase()];
  if (!ext || data.length < 100 || data.length > 5_000_000) {
    throw new Error(`이미지가 아닌 응답 (${mime}, ${data.length}B)`);
  }
  return { data, ext };
}

/** 이미지 생성기. llm.js 와 같은 식으로 갈아끼운다. */
export const GENERATORS = {
  /* 판정과 같은 GEMINI_API_KEY 를 쓴다. */
  async gemini(prompt) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('GEMINI_API_KEY 가 없습니다');
    const model = process.env.IMAGE_MODEL || 'gemini-2.5-flash-image';
    const base = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
    const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new Error('gemini: 응답에 이미지가 없습니다');
    return toImage(Buffer.from(part.inlineData.data, 'base64'), part.inlineData.mimeType);
  },

  /* 키 없음. 품질이 들쭉날쭉하고 언제까지 무료일지 모른다. Gemini 한도를 넘었을 때만. */
  async pollinations(prompt) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(90_000) });
    if (!res.ok) throw new Error(`pollinations ${res.status}`);
    return toImage(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
  },
};
```

`scripts/tag-assets.js`:

```js
// 라이브러리에 넣은 이미지에 태그 초안을 단다. LLM 은 부르지 않는다.
//   assets/library/ 에 파일을 넣고 → npm run tag-assets → assets/library.json 을 손으로 다듬는다.
// Kenney 같은 팩은 파일명이 설명적이라 (slime_green.png) 대부분 이걸로 충분하다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalizeTags } from '../src/effects.js';

export function tagsFromFilename(file) {
  return normalizeTags(path.parse(file).name.split(/[_\-\d\s]+/));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets');
  const jsonPath = path.join(root, 'library.json');
  const list = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : [];
  const known = new Set(list.map((e) => e.file));
  const added = fs.readdirSync(path.join(root, 'library'))
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f) && !known.has(f))
    .map((file) => ({ file, tags: tagsFromFilename(file) }));
  fs.writeFileSync(jsonPath, JSON.stringify([...list, ...added], null, 2) + '\n');
  console.log(`${added.length}개 추가. assets/library.json 의 태그를 확인하세요.`);
  for (const e of added) console.log(`  ${e.file}  →  ${e.tags.join(', ')}`);
}
```

`package.json` scripts 에 추가:

```json
    "tag-assets": "node scripts/tag-assets.js",
```

`.env.example` 의 `# ── 디스코드` 블록 **위**에 추가:

```
# ── 방명록 물체의 모습 ─────────────────────────────────
# 물체가 적힐 때 한 번만 만든다. 같은 물체는 다시 만들지 않는다.
# gemini: 위의 GEMINI_API_KEY 를 쓴다. 하루 IMAGE_DAILY_LIMIT 장을 넘으면 그날은 pollinations.
# pollinations: 키 없음, 품질 들쭉날쭉. none: 만들지 않고 이모지만.
IMAGE_PROVIDER=gemini
IMAGE_MODEL=gemini-2.5-flash-image
IMAGE_DAILY_LIMIT=20

```

`.gitignore` 에 한 줄 추가: `data/`

- [ ] **Step 5: 통과 확인**

Run: `npm test`
Expected: `전부 통과` 세 번

- [ ] **Step 6: 실제 호출 한 번 (선택, 키가 있을 때)**

```bash
node -e "import('dotenv/config').then(()=>import('./src/assets.js')).then(async m=>{const r=await m.GENERATORS.pollinations('mask, '+m.STYLE);console.log(r.ext,r.data.length)})"
```

Expected: `jpg 12345` 같은 출력. 실패하면 Step 1 문서와 URL 을 다시 대조한다.

- [ ] **Step 7: 커밋**

```bash
git add src/assets.js scripts/tag-assets.js test/assets.js package.json .env.example .gitignore
git commit -m "Gemini·Pollinations 이미지 생성기와 라이브러리 태깅 스크립트"
```

---

### Task 5: 서버 연결 (기입 후 해석, 런 시작 URL, 사망 좌표)

**Files:**
- Modify: `src/db.js` (`runs.death_x/y` 마이그레이션, `dieRun`, `recentDeaths`)
- Modify: `src/server.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `normalizeObject` (Task 1), `buildWorld(rules, deaths)`, `deathCell` (Task 2), `resolveAsset`, `imgFor`, `ITEM_ASSETS`, `assetDir`, `LIBRARY_DIR` (Task 3)
- Produces:
  - `POST /api/run/start` 응답 `world.objects[i].img`, `world.items[i].img` (`string | null`)
  - `POST /api/run/:id/die` 가 본문 `{ x, y }` 를 받는다
  - 정적 경로 `/obj/*` → `data/assets`, `/lib/*` → `assets/library`

- [ ] **Step 1: DB** — `src/db.js`

`db.exec(...)` 호출 **바로 아래**에 추가:

```js
// 죽은 자리. 기존 DB 에도 컬럼을 붙인다.
const runCols = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
if (!runCols.includes('death_x')) {
  db.exec('ALTER TABLE runs ADD COLUMN death_x INTEGER; ALTER TABLE runs ADD COLUMN death_y INTEGER;');
}
```

`dieRun` 을 교체하고 `recentDeaths` 추가:

```js
  dieRun: db.prepare(`
    UPDATE runs SET died_at = ?, death_x = ?, death_y = ?
    WHERE id = ? AND cleared_at IS NULL AND died_at IS NULL`),
  // 누가 죽었는지는 꺼내지 않는다. 자리만.
  recentDeaths: db.prepare(`
    SELECT death_x AS x, death_y AS y FROM runs
    WHERE died_at IS NOT NULL AND death_x IS NOT NULL
    ORDER BY died_at DESC LIMIT 30`),
```

- [ ] **Step 2: 서버** — `src/server.js`

기존 `import { buildWorld } from './world.js';` 와 `import { foldEffects } from './effects.js';` 두 줄을 아래 세 줄로 **교체**한다 (중복 import 금지):

```js
import { buildWorld, deathCell } from './world.js';
import { foldEffects, normalizeObject } from './effects.js';
import { resolveAsset, imgFor, ITEM_ASSETS, assetDir, LIBRARY_DIR } from './assets.js';
```

`app.use(express.static(path.join(__dirname, '..', 'public')));` 아래:

```js
app.use('/obj', express.static(assetDir()));
app.use('/lib', express.static(LIBRARY_DIR));
```

방명록 POST 에서 `q.useRunEntry.run(run.id);` 아래:

```js
  // 물체의 모습은 뒤에서 확보한다. 응답은 기다리지 않는다.
  for (const e of verdict.effects) {
    if (e.type !== 'object.spawn') continue;
    const o = normalizeObject(e);
    if (o) resolveAsset(o).catch((err) => console.error('[asset]', err.message));
  }
```

`/api/run/start` 핸들러의 `const world = buildWorld(rules);` 를 교체:

```js
  const world = buildWorld(rules, q.recentDeaths.all());
  // 모습은 DB 에서 꺼내기만 한다. 여기서는 아무것도 새로 만들지 않는다.
  world.objects = world.objects.map((o) => ({ ...o, img: imgFor(o.key) }));
  world.items = world.items.map((it) => ({ ...it, img: ITEM_ASSETS[it.kind] ? imgFor(ITEM_ASSETS[it.kind].key) : null }));
```

`/api/run/:id/die` 핸들러의 `q.dieRun.run(Date.now(), run.id);` 를 교체:

```js
  // 그 런이 걷던 미로 크기 안의 칸만 믿는다.
  const size = foldEffects(loadAppliedRules().slice(0, run.rule_count).map((r) => r.effects)).mazeSize;
  const cell = deathCell(req.body, size);
  q.dieRun.run(Date.now(), cell?.x ?? null, cell?.y ?? null, run.id);
```

`app.listen` 콜백의 마지막 `console.log('');` 위:

```js
  // 줍는 아이템의 바닥 모습. 이미 있으면 DB 조회로 끝난다.
  for (const it of Object.values(ITEM_ASSETS)) {
    resolveAsset(it).catch((err) => console.error('[asset]', err.message));
  }
```

- [ ] **Step 3: 테스트 통과 확인**

Run: `npm test`
Expected: `전부 통과` 세 번

- [ ] **Step 4: 스모크 확인** — `.env` 를 `DEV_NO_AUTH=1`, `IMAGE_PROVIDER=none`, `DB_PATH=./smoke.db` 로 두고

```bash
npm start
```

다른 터미널에서:

```bash
curl -s -X POST localhost:3000/api/run/start -H "Content-Type: application/json" | node -e "process.stdin.on('data',d=>{const j=JSON.parse(d);console.log(j.runId, Array.isArray(j.world.objects), j.world.items.map(i=>i.img))})"
```

Expected: `1 true []` (아이템 없는 빈 방)

```bash
curl -s -X POST localhost:3000/api/run/1/die -H "Content-Type: application/json" -d "{\"x\":2,\"y\":2}"
curl -s -X POST localhost:3000/api/run/start -H "Content-Type: application/json" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).world.corpses))"
```

Expected: `[ { x: 2, y: 2 } ]` (5×5 빈 방의 바닥 칸). 서버 로그에 `[asset:` 에러가 없어야 한다 (`none` 이면 아이템 해석은 조용히 failed 로 남는다). 확인 후 서버를 끄고 `smoke.db*` 를 지우고 `.env` 를 되돌린다.

- [ ] **Step 5: README** — `README.md` 의 `### 로그인 없이 돌려보기` **위**에 섹션 추가. Task 4 Step 1 에서 확인한 단가·무료 한도를 `(확인한 값)` 자리에 채운다.

```markdown
### 방명록 물체의 모습

"웃는 가면이 걸려 있었으면" 처럼 물체가 적히면, 판정이 `object.spawn` 으로 옮기고
서버가 **뒤에서** 그 모습을 확보한다. 기입 응답은 기다리지 않는다.

1. 같은 물체를 이미 봤으면 그대로 쓴다
2. `assets/library/` 와 전에 만든 것들 중 태그가 절반 이상 겹치면 그걸 쓴다
3. 없으면 만든다 — Gemini (하루 `IMAGE_DAILY_LIMIT` 장) → 넘으면 Pollinations
4. 그래도 안 되면 화면에는 이모지가 대신 선다

토큰은 판정 한 번에 오브젝트당 30~40 토큰이 늘어나는 정도다 (기존 대비 약 5%).
실제 비용은 이미지 생성 횟수가 정한다. Gemini 이미지: (확인한 값).

라이브러리에 에셋을 넣으려면 `assets/library/` 에 파일을 넣고 `npm run tag-assets`
후 `assets/library.json` 의 태그를 다듬는다. 기괴하고 불쾌한 것 위주로 고를 것.
생성한 이미지는 `data/assets/` 에 쌓인다. 어떤 물체의 모습을 다시 만들고 싶으면
DB 의 `assets` 테이블에서 그 행을 지우면 다음에 그 물체가 적힐 때 다시 만든다.
```

`## 구조` 의 코드블록에서 `db.js` 줄 아래에 추가:

```
  assets.js    방명록 물체의 모습. 캐시 → 태그 매칭 → 이미지 생성
```

`public/` 쪽 `ui.js` 줄 아래에 추가:

```
  uncanny.js   물체를 "뭔가 틀리게" 그린다. 배경 제거·색 빼기·늘이기
```

- [ ] **Step 6: 커밋**

```bash
git add src/db.js src/server.js README.md
git commit -m "기입 후 물체 모습을 확보하고 죽은 자리를 기록한다"
```

---

### Task 6: 클라이언트 렌더링 (기괴 보정, 대체 표시, 서술, 사망 좌표)

**Files:**
- Create: `public/uncanny.js`
- Modify: `public/game.js` (import, 생성자, `describe`, `collectSprites`, `drawSprites`, `paintSprite`, `die`)
- Modify: `public/ui.js` (`endRun` 의 `/die` 호출)

**Interfaces:**
- Consumes: `world.objects[i] = { id, key, name, emoji, x, y, img }`, `world.items[i].img` (Task 5)
- Produces: `/die` 본문 `{ x, y }`

- [ ] **Step 1: `public/uncanny.js` 작성**

```js
// ─────────────────────────────────────────────────────────────
// 방명록 물체 그리기
//
// 무엇을 그리든 "뭔가 틀린" 쪽으로 비튼다. 색을 빼고, 누렇게 뜨게 하고,
// 조금 길게 늘이고, 가끔 한 프레임씩 거울에 비친 것처럼 뒤집는다.
// ─────────────────────────────────────────────────────────────

const cache = new Map();   // url → canvas | 'loading' | 'failed'

/** 그릴 수 있게 준비된 캔버스. 아직이거나 실패했으면 null (대체 표시를 쓴다). */
export function sprite(url) {
  if (!url) return null;
  const c = cache.get(url);
  if (c) return typeof c === 'object' ? c : null;
  cache.set(url, 'loading');
  const img = new Image();
  img.onload = () => cache.set(url, url.startsWith('/lib/') ? toCanvas(img) : stripBlack(img));
  img.onerror = () => cache.set(url, 'failed');
  img.src = url;
  return null;
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

/** 생성 이미지는 검은 배경 위에 나온다. 네 모서리에서 이어진 어두운 픽셀을 지운다. */
function stripBlack(img, thr = 40) {
  const c = toCanvas(img);
  const ctx = c.getContext('2d');
  const { width: w, height: h } = c;
  const d = ctx.getImageData(0, 0, w, h);
  const px = d.data;
  const seen = new Uint8Array(w * h);
  const stack = [0, w - 1, (h - 1) * w, h * w - 1];
  while (stack.length) {
    const i = stack.pop();
    if (seen[i]) continue;
    seen[i] = 1;
    const o = i * 4;
    if (Math.max(px[o], px[o + 1], px[o + 2]) > thr) continue;
    px[o + 3] = 0;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

/** 같은 물체는 언제나 같은 만큼 늘어나 있다. 1.15 ~ 1.35 */
export function stretchFor(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return 1.15 + ((h >>> 0) % 1000) / 1000 * 0.2;
}

const FILTER_OK = typeof CanvasRenderingContext2D !== 'undefined'
  && 'filter' in CanvasRenderingContext2D.prototype;

/**
 * 바닥(bottom) 중앙(cx)에 서 있게 그린다.
 * canvas 가 없으면 emoji 를 같은 보정으로 그린다.
 */
export function drawUncanny(c, { canvas, emoji }, cx, bottom, w, h, fog, stretch) {
  c.save();
  if (FILTER_OK) c.filter = `grayscale(.7) sepia(.45) contrast(1.3) brightness(${fog.toFixed(2)})`;
  else c.globalAlpha = fog;
  c.translate(cx, bottom);
  if (Math.random() < 1 / 400) c.scale(-1, 1);        // 한 프레임, 거울 속의 그것
  if (canvas) {
    const ww = Math.min(w * 1.5, h * canvas.width / canvas.height);
    c.drawImage(canvas, -ww / 2, -h * stretch, ww, h * stretch);
  } else if (emoji) {
    c.scale(1, stretch);
    c.font = `${Math.max(6, h * 0.8)}px serif`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillText(emoji, 0, 0);
  }
  c.restore();
}
```

- [ ] **Step 2: `public/game.js` 연결**

파일 맨 위 (첫 주석 블록 아래, `const TAU` 위)에:

```js
import { sprite, drawUncanny, stretchFor } from '/uncanny.js';
```

생성자의 `this.baits = [];` 아래에:

```js
    // 방명록 물체. 규칙에는 영향 없이 서 있기만 한다.
    this.objects = (world.objects || []).map((o) => ({
      ...o, dx: 0, dy: 0, stretch: stretchFor(o.id), wasVisible: false, visible: false,
    }));
    for (const o of this.objects) sprite(o.img);
    for (const it of this.items) sprite(it.img);
```

`describe()` 의 `this.log(bits.join(' '));` 바로 위에:

```js
    const obj = this.objects.find((o) => o.x === this.cx && o.y === this.cy);
    if (obj) bits.push(`${obj.name}이(가) 있다.`);
    const front = !this.wall(a.x, a.y) && this.objects.find((o) => o.x === a.x && o.y === a.y);
    if (front) bits.push(`앞에 ${front.name} 같은 것이 서 있다.`);
```

`collectSprites()` 의 items 루프를 교체하고 오브젝트 루프 추가:

```js
    for (const it of this.items) {
      if (it.taken) continue;
      out.push({ kind: it.kind, ref: it, x: it.x + 0.5, y: it.y + 0.5, h: 0.22, w: 0.4, ground: true });
    }
    for (const o of this.objects) {
      out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.7, w: 0.6, ground: true });
    }
```

`drawSprites()` 에서:
- `const sprites = this.collectSprites()` 줄 **위**에 `for (const o of this.objects) o.visible = false;`
- `this.paintSprite(s.kind, screenX, top, bottom, w, fog, ty);` 를 아래로 교체:

```js
      if (s.kind === 'object') s.ref.visible = true;
      this.paintSprite(s.kind, screenX, top, bottom, w, fog, ty, s.ref);
```

- `for (const s of sprites) { ... }` 루프가 끝난 **뒤** (함수 끝):

```js
    // 눈을 뗀 사이에 조금 옮겨 가 있다.
    for (const o of this.objects) {
      if (o.wasVisible && !o.visible) {
        o.dx = (Math.random() - 0.5) * 0.3;
        o.dy = (Math.random() - 0.5) * 0.3;
      }
      o.wasVisible = o.visible;
    }
```

`paintSprite` 시그니처와 첫 부분:

```js
  paintSprite(kind, cx, top, bottom, w, fog, dist, ref) {
    const c = this.ctx;
    const h = bottom - top;
    const dim = (rgb, k = 1) => `rgb(${rgb.map((v) => Math.round(Math.min(255, v * fog * k))).join(',')})`;

    // 방명록 물체, 또는 모습이 준비된 아이템. 아이템은 모습이 없으면 아래의 도형으로 떨어진다.
    const canvas = sprite(ref?.img);
    if (kind === 'object' || canvas) {
      drawUncanny(c, { canvas, emoji: ref.emoji }, cx, bottom, w, h, fog, ref.stretch ?? stretchFor(ref.id));
      return;
    }
```

(기존 `const c = ...; const h = ...; const dim = ...;` 세 줄을 위 코드로 대체한다.)

`die(reason)` 의 onEnd 호출을:

```js
    this.hooks.onEnd?.({ won: false, reason, lostParts: this.lostParts, x: this.cx, y: this.cy });
```

- [ ] **Step 3: `public/ui.js`** — `endRun` 의 `/die` 호출 교체

```js
    try {
      await api(`/api/run/${runId}/die`, { method: 'POST', body: JSON.stringify({ x: result.x, y: result.y }) });
    } catch (e) { console.warn(e); }
```

- [ ] **Step 4: 테스트 회귀 확인**

Run: `npm test`
Expected: `전부 통과` 세 번

- [ ] **Step 5: 브라우저 확인** — `.env` 에 `DEV_NO_AUTH=1`, `IMAGE_PROVIDER=pollinations`, `DB_PATH=./browser.db`. 이 DB 에 오브젝트를 직접 넣는다:

```bash
node -e "process.env.DB_PATH='./browser.db';import('./src/db.js').then(({q})=>{const u=q.upsertUser.get('dev','dev',null,Date.now());q.insertEntry.get(u.id,null,'웃는 가면',  'applied','x',JSON.stringify([{type:'maze.size',value:9},{type:'object.spawn',name:'웃는 가면',tags:'mask, smiling, porcelain',emoji:'🎭',count:3},{type:'item.knife',value:true}]),Date.now())})"
npm start
```

그다음 `node -e` 로 `resolveAsset({key:'웃는 가면',name:'웃는 가면',tags:['mask','smiling','porcelain']})` 를 한 번 돌리거나 1~2분 기다린다 (서버 시작 시 아이템 해석이 돈다). 브라우저에서 `http://localhost:3000` 입장 후 확인:
  - [ ] 이미지 준비 전 입장: 가면 자리에 **색이 빠진 🎭** 이 세로로 늘어나 서 있다
  - [ ] 이미지 준비 후 재입장: 검은 배경 없이 누렇게 뜬 가면 이미지
  - [ ] 칼이 이미지로 그려지거나, 이미지가 없으면 기존 칼 도형
  - [ ] 오래 보고 있으면 가끔 한 프레임 좌우가 뒤집힌다
  - [ ] 돌아섰다가 다시 보면 위치가 미세하게 바뀌어 있다
  - [ ] 가면 앞 칸에서 "앞에 웃는 가면 같은 것이 서 있다." 가 뜬다
  - [ ] `data/assets` 의 파일을 지우고 재입장하면 다시 이모지로 떨어진다
  - [ ] 죽은 뒤 재입장하면 죽은 칸에 시체가 있고, 주워도 다음 입장에 다시 있다
  - [ ] 콘솔 에러 없음

확인 후 서버를 끄고 `browser.db*` 를 지우고 `.env` 를 되돌린다.

- [ ] **Step 6: 커밋**

```bash
git add public/uncanny.js public/game.js public/ui.js
git commit -m "방명록 물체를 기괴하게 그리고 죽은 칸을 서버에 알린다"
```
