# 계획 3: 백룸 화면 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 단색 화면을 지저분하고 불쾌한 사실적 공간(백룸풍)으로 바꾼다. 벽·바닥·천장·문에 텍스처, 누런 안개, 형광등과 깜빡임, 높은 해상도. 벽 물체는 벽에 평평하게, 바닥에 놓인 것은 눕혀서, 서 있는 물건은 고정된 판으로, 생물과 괴물만 나를 쳐다본다. 방명록으로 표면 질감도 바꿀 수 있다.

**Architecture:** 텍스처 생성·가공과 기하 계산은 DOM 없는 순수 함수(`public/textures.js`, `public/geometry.js`)로 두고 node 로 테스트한다. 레이캐스터(`game.js render()`)는 벽 텍스처 샘플링 + 바닥/천장 floor casting 으로 바꾸고, 픽셀 단계에서 벽 decal·바닥 decal 을 합성한다. 서 있는 물건은 스프라이트 단계에서 광선-선분 교차로 열마다 그린다. 서버는 `surface.look` 을 `kind: texture` 에셋으로 확보한다.

**Tech Stack:** Node 20 ESM, express, better-sqlite3 12, Canvas 2D. 새 의존성 없음.

**Spec:** `docs/superpowers/specs/2026-09-22-literal-guestbook-backrooms-design.md` §1.4, §5, §6, §17, §18.

## Global Constraints

- 텍스처 크기 `TEX = 256`. 파일은 `/tex/{wall,floor,ceil,door}.jpg`.
- 우선순위: 방명록 `surface.look` 이미지 → (color 가 없을 때) 기본 사진 → 절차적. 천장은 기본 사진을 쓰지 않고 절차적 타일, `ceil.jpg` 는 형광등 칸 패널로만.
- 누런 톤: 벽 `[216,199,122]`, 바닥 `[184,163,106]`, 문 `[255,255,255]`(톤 없음). 안개색 `[58,52,34]`. 안개 거리 6.5 (blind 1.2).
- 형광등 칸: `(x*7 + y*13) % 5 === 0`. 깜빡임: 프레임마다 0.4% 확률로 100~300ms 동안 밝기 ×0.55.
- 벽 decal 영역: wallX ∈ [0.2, 0.8], 세로 v ∈ [0.22, 0.72]. 바닥 decal 영역: 칸 안 [0.15, 0.85]².
- `pose` 기본 `stand`, `where: wall` 이거나 `moves ≠ still` 이면 `stand`.
- 렌더 스케일 `[1, 0.75, 0.55]`, 30프레임 평균 28ms 초과 시 한 단계 내림. 올리지 않는다.
- 기존 월드 결정론 유지 (스냅샷 테스트).
- 새 의존성 없음. 문구 한국어.

## Review Focus

1. 텍스처 로드 전 첫 프레임들 → 예전 단색 렌더로 그려지고 에러 없음. → Task 5 (코드 경로가 `!this.tex` 분기 유지).
2. `surface.look` 에 이상한 surface·color(`"red"`, `"#12"`) → 무시·color 버림. → Task 1 테스트.
3. 광선이 선분과 평행·뒤쪽·끝점 밖 → 교차 없음. → Task 3 테스트.
4. 절차적 텍스처가 가로로 이어 붙을 때 이음새가 튄다 → 좌우 끝 픽셀 차이 작음. → Task 3 테스트.
5. 텍스처 에셋이 같은 태그의 물체 에셋과 섞여 매칭 → kind 가 다르면 매칭 안 됨. → Task 2 테스트.

---

## File Structure

| 파일 | 역할 |
|---|---|
| `src/effects.js` | `pose`, `surface.look`, `state.surfaces` |
| `src/compiler.js` | `pose`·`surface.look` 단서 |
| `src/world.js` | `objectOut` 에 `pose`, 반환에 `surfaces` |
| `src/db.js`, `src/assets.js` | `assets.kind`, 텍스처 프롬프트, kind 별 매칭 |
| `src/server.js` | `surface.look` 해석, `world.surfaces[s].img`, `/tex` 정적 |
| `public/geometry.js` (신규) | `faceOf`, `raySegment` |
| `public/textures.js` (신규) | `noise`, `procedural`, `tintGrime`, `hexToRgb`, `TONE`, `buildSurfaces`(브라우저) |
| `public/uncanny.js` | `emojiCanvas`, `decalPixels` |
| `public/game.js` | 텍스처 렌더, decal, 판, 문 텍스처, 형광등·깜빡임·안개, 해상도 |
| `public/style.css` | `image-rendering: pixelated` 제거 |
| `test/*.js` | 테스트 |

---

### Task 1: `pose` 와 `surface.look`

**Files:** `src/effects.js`, `src/compiler.js`, `src/world.js`, `test/compiler.js`, `test/replay.js`

**Interfaces — Produces:**
- `normalizeObject(e).pose: 'stand' | 'lie'`
- `normalizeSurface(e) → { surface, key, name, tags, color: '#rrggbb' | null } | null`
- `state.surfaces: { wall?, floor?, ceil?, door? }` (값은 `normalizeSurface` 결과에서 `surface` 뺀 것)
- `buildWorld()` 반환 `objects[i].pose`, `surfaces`

- [ ] **Step 1: 실패하는 테스트** — `test/compiler.js` 의 `console.log(fail === 0` 위:

```js
// ── 자세·표면 ────────────────────────────────────────────
const { normalizeSurface } = await import('../src/effects.js');
check(normalizeObject({ name: '종이', pose: 'LIE' }).pose === 'lie', '바닥에 눕힌다');
check(normalizeObject({ name: '종이' }).pose === 'stand', '기본은 서 있다');
check(normalizeObject({ name: '가면', where: 'wall', pose: 'lie' }).pose === 'stand', '벽 물체는 눕지 않는다');
check(normalizeObject({ name: '고양이', moves: 'follow', pose: 'lie' }).pose === 'stand', '움직이는 것은 눕지 않는다');
let sf = normalizeSurface({ surface: 'WALL', name: '살점', tags: 'raw flesh, wet', color: '#8A3B3B' });
check(sf.surface === 'wall' && sf.key === 'tex:wall:살점' && sf.color === '#8a3b3b', '표면 질감');
check(normalizeSurface({ surface: 'sky', name: 'x' }) === null, '모르는 표면은 버린다');
check(normalizeSurface({ surface: 'floor', name: 'x', color: 'red' }).color === null && normalizeSurface({ surface: 'floor', name: 'x', color: '#12' }).color === null, '색 형식이 틀리면 색만 버린다');
st = foldEffects([[{ type: 'surface.look', surface: 'wall', name: '살점', color: '#8a3b3b' }], [{ type: 'surface.look', surface: 'wall', name: '곰팡이' }]]);
check(st.surfaces.wall.name === '곰팡이' && !('surface' in st.surfaces.wall), '표면은 마지막 것이 덮는다');
check(JSON.stringify(foldEffects([]).surfaces) === '{}', '기본 표면은 비어 있다');
```

`test/replay.js` 의 스냅샷 비교를 새 필드까지 빼도록:

```js
const { layout: _l, monsterLook: _m, objects: _o1, surfaces: _s1, ...nowOld } = now;
const { objects: _o2, ...snapOld } = snap;
delete snapOld.state.hunger;
delete nowOld.state.surfaces;
```

(기존 두 줄 `const { layout: _l, monsterLook: _m, objects: _o1, ...nowOld } = now;` 와 그 아래 두 줄을 이 네 줄로 교체.) 그리고 `// ── 말 그대로: 배치` 블록 끝에:

```js
check(buildWorld([{ id: 1, effects: [{ type: 'object.spawn', name: '종이', pose: 'lie' }] }]).objects[0].pose === 'lie', '월드에 자세가 실린다');
check(JSON.stringify(buildWorld([{ id: 1, effects: [{ type: 'surface.look', surface: 'floor', name: '피웅덩이', color: '#551111' }] }]).surfaces.floor.color) === '"#551111"', '월드에 표면이 실린다');
```

- [ ] **Step 2: 실패 확인** — `npm test` → `✗` 여러 개
- [ ] **Step 3: 구현**
  - `src/effects.js` `'flavor.text'` 위에:

```js
  'surface.look': {
    desc: "벽·바닥·천장·문의 질감이 바뀌기를 바랄 때. surface: 'wall' | 'floor' | 'ceil' | 'door'. "
      + 'name: 짧은 한국어 이름. tags: 질감을 설명하는 영어 단어 3~6개. color: 그 질감의 대표색 #rrggbb.',
    params: { surface: 'string', name: 'string', tags: 'string', color: 'string' },
    apply: (s, e) => {
      const sf = normalizeSurface(e);
      if (!sf) return;
      const { surface, ...look } = sf;
      s.surfaces[surface] = look;
    },
  },
```

  - `object.spawn` desc 끝 문자열에 `" pose: 'stand' | 'lie'(바닥에 놓인·떨어진·깔린·누운)."` 를 더하고 params 에 `pose: 'string'`.
  - `initialState()` 의 `objects: [],` 위에 `surfaces: {},`.
  - `normalizeObject` 반환에 `pose`:

```js
    pose: (wall || pick(e.moves, ['still', 'wander', 'follow']) !== 'still') ? 'stand' : pick(e.pose, ['stand', 'lie']),
```

  - `normalizeObject` 아래에:

```js
/** 표면 질감. 모르는 표면이면 null, 색 형식이 틀리면 색만 버린다. */
export function normalizeSurface(e) {
  const surface = String(e?.surface ?? '').trim().toLowerCase();
  if (!['wall', 'floor', 'ceil', 'door'].includes(surface)) return null;
  const name = String(e?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const color = /^#[0-9a-f]{6}$/i.test(String(e.color ?? '').trim()) ? String(e.color).trim().toLowerCase() : null;
  let tags = normalizeTags(e.tags);
  if (!tags.length) tags = normalizeTags(name);
  return { surface, key: `tex:${surface}:${objectKey(name)}`, name, tags, color };
}
```

  - `src/compiler.js` 위치 단서 줄 아래에 `   - "바닥에 놓인/떨어진/깔린/누운" → pose: lie` 추가, 3번 줄 아래에 `3-1. 벽·바닥·천장·문의 질감은 surface.look 으로.` 와 예시 `  "벽이 살점 같았으면" → { "type": "surface.look", "surface": "wall", "name": "살점", "tags": "raw flesh, wet, veins", "color": "#8a3b3b" }` 를 예시 목록 끝에 추가.
  - `src/world.js` `objectOut` 의 필드에 `pose: o.pose,` 추가, 반환에 `surfaces: state.surfaces,` 추가.

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add src/effects.js src/compiler.js src/world.js test/compiler.js test/replay.js && git commit -m "물체의 자세와 표면 질감을 받는다"`

---

### Task 2: 텍스처 에셋 (`kind`)

**Files:** `src/db.js`, `src/assets.js`, `src/server.js`, `test/assets.js`

**Interfaces — Produces:**
- `resolveAsset(obj)` 가 `obj.kind === 'texture'` 면 텍스처 프롬프트·텍스처끼리만 매칭, 행에 `kind` 저장.
- `TEXTURE_STYLE` export.
- 런 시작 응답 `world.surfaces[s] = { ...look, img: string|null }`.
- 정적 `/tex` → `assets/textures`.

- [ ] **Step 1: 실패하는 테스트** — `test/assets.js` 의 `// ── imgFor` 위:

```js
// ── 텍스처는 텍스처끼리만 ────────────────────────────────
calls.length = 0;
r = await resolveAsset({ key: 'tex:wall:점액', name: '점액', tags: ['slime', 'green'], kind: 'texture' }, { generators: gens, library: [], now: Date.now() + 6 * 86_400_000 });
check(r.source === 'gemini' && r.kind === 'texture', '같은 태그의 물체 에셋이 있어도 텍스처는 따로 만든다');
check(calls[0].prompt.includes('seamless tileable texture'), '텍스처 프롬프트');
r = await resolveAsset(obj('초록 점액 덩어리', ['slime', 'green']), { generators: gens, library: [], now: Date.now() + 6 * 86_400_000 });
check(r.source === 'match' && r.file === q.assetByKey.get('slime').file, '물체는 물체끼리 매칭된다');
```

- [ ] **Step 2: 실패 확인** — `node test/assets.js` → `✗ 같은 태그의 물체 에셋이 있어도 ...`
- [ ] **Step 3: 구현**
  - `src/db.js`: runs death 마이그레이션 아래에

```js
const assetCols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
if (!assetCols.includes('kind')) db.exec("ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'object'");
```

    `readyAssets` → `db.prepare("SELECT tags, file FROM assets WHERE status = 'ready' AND kind = ?")`,
    `insertAsset` → `INSERT OR REPLACE INTO assets (key, tags, source, file, status, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)`.
  - `src/assets.js`: `STYLE` 아래 `export const TEXTURE_STYLE = 'seamless tileable texture, flat even lighting, top-down photo, no objects, no text, grimy, stained';`
    `doResolve` 에서 `const kind = obj.kind || 'object';`, `save` 의 `insertAsset.run(... , now, kind)`, `failed` 비저장 반환 객체에 `kind`,
    pool 은 `library.filter((l) => (l.kind || 'object') === kind)` + `q.readyAssets.all(kind)`,
    프롬프트는 `kind === 'texture' ? TEXTURE_STYLE : STYLE`.
  - `src/server.js`:
    - 정적: `app.use('/tex', express.static(path.join(__dirname, '..', 'assets', 'textures')));`
    - import 에 `normalizeSurface` 추가.
    - 기입 후 루프에:

```js
    if (e.type === 'surface.look') {
      const sf = normalizeSurface(e);
      if (sf) resolveAsset({ ...sf, kind: 'texture' }).catch((err) => console.error('[asset]', err.message));
      continue;
    }
```

      (기존 `if (e.type !== 'object.spawn' && e.type !== 'entity.monster_look') continue;` 줄 **위**에.)
    - 런 시작: `world.surfaces = Object.fromEntries(Object.entries(world.surfaces || {}).map(([s, l]) => [s, { ...l, img: imgFor(l.key) }]));`
- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add src/db.js src/assets.js src/server.js test/assets.js && git commit -m "표면 질감은 텍스처 에셋으로 따로 확보한다"`

---

### Task 3: 순수 함수 — 기하·텍스처

**Files:** Create `public/geometry.js`, `public/textures.js`; Modify `test/client.js`

**Interfaces — Produces:**
- `faceOf(side, stepX, stepY) → 0|1|2|3` — 광선이 닿은 벽면이 바라보는 방향(벽 → 바닥).
- `raySegment(px, py, rdx, rdy, ax, ay, bx, by) → { t, s } | null` — 광선 `P + t·R` (t > 0) 와 선분 `A + s·(B−A)` (0 ≤ s ≤ 1) 의 교점.
- `TEX`, `noise(x, y, period, seed)`, `procedural(surface, color?) → Uint8ClampedArray`, `tintGrime(px, rgb, amount) → px`, `hexToRgb(hex) → [r,g,b] | null`, `TONE`.

- [ ] **Step 1: 실패하는 테스트** — `test/client.js` import 추가:

```js
import { faceOf, raySegment } from '../public/geometry.js';
import { TEX, noise, procedural, tintGrime, hexToRgb } from '../public/textures.js';
```

본문:

```js
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
```

- [ ] **Step 2: 실패 확인** — `node test/client.js` → `Cannot find module '../public/geometry.js'`
- [ ] **Step 3: 구현** — `public/geometry.js`

```js
// 레이캐스터의 작은 기하. DOM 없이 테스트한다.

/** 광선이 닿은 벽면이 바라보는 방향(벽 → 바닥). 0 동 1 남 2 서 3 북 */
export function faceOf(side, stepX, stepY) {
  if (side === 0) return stepX > 0 ? 2 : 0;
  return stepY > 0 ? 3 : 1;
}

/** 광선 P + t·R (t > 0) 과 선분 A→B 의 교점. 없으면 null. */
export function raySegment(px, py, rdx, rdy, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay;
  const den = rdx * ey - rdy * ex;
  if (Math.abs(den) < 1e-12) return null;
  const qx = ax - px, qy = ay - py;
  const t = (qx * ey - qy * ex) / den;
  const s = (qx * rdy - qy * rdx) / den;
  if (t <= 0 || s < 0 || s > 1) return null;
  return { t, s };
}
```

`public/textures.js`

```js
// ─────────────────────────────────────────────────────────────
// 표면
//
// 벽·바닥·천장·문. 방명록이 바꾼 질감 → 기본 사진(ambientCG) → 코드로 만든 것.
// 사진은 누렇게 뜨고 얼룩이 앉는다. 깨끗한 곳은 여기 없다.
// 순수 함수는 node 에서도 돈다. buildSurfaces 만 브라우저 전용이다.
// ─────────────────────────────────────────────────────────────

export const TEX = 256;
export const TONE = { wall: [216, 199, 122], floor: [184, 163, 106], ceil: [230, 221, 176], door: [255, 255, 255] };
const BASE = { wall: [196, 180, 112], floor: [150, 132, 88], ceil: [214, 206, 170], door: [120, 112, 100], light: [246, 244, 226] };

function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 144665)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 주기 period 로 이어지는 value noise. 0~1 */
export function noise(x, y, period, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const w = (i) => ((i % period) + period) % period;
  const v = (i, j) => hash2(w(i), w(j), seed);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

function fbm(u, v, base, seed) {
  let s = 0, amp = 0.5, f = base;
  for (let o = 0; o < 4; o++) { s += amp * noise(u * f, v * f, f, seed + o); amp /= 2; f *= 2; }
  return s / 0.9375;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/** 코드로 만든 표면. 파일이 없거나 방명록이 색만 정했을 때. */
export function procedural(surface, color) {
  const px = new Uint8ClampedArray(TEX * TEX * 4);
  const base = hexToRgb(color) || BASE[surface] || BASE.wall;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const u = x / TEX, v = y / TEX;
      const grime = fbm(u, v, 4, 7);
      const grain = fbm(u, v, 32, 3);
      let k = 0.75 + 0.35 * grain - 0.45 * Math.max(0, grime - 0.45);
      if (surface === 'wall') {
        k *= 0.93 + 0.07 * Math.sin(u * Math.PI * 2 * 12);   // 세로 줄무늬 (12줄이라 이음새가 맞는다)
        if (v > 0.88) k *= 0.55;                             // 걸레받이
      } else if (surface === 'ceil') {
        if ((u * 2) % 1 < 0.03 || (v * 2) % 1 < 0.03) k *= 0.45;   // 타일 틈
      } else if (surface === 'door') {
        if (Math.abs(u - 0.8) < 0.04 && Math.abs(v - 0.52) < 0.03) k = 1.6;   // 손잡이
      } else if (surface === 'light') {
        k = 0.92 + 0.08 * grain;
      }
      const i = (y * TEX + x) * 4;
      px[i] = base[0] * k; px[i + 1] = base[1] * k; px[i + 2] = base[2] * k; px[i + 3] = 255;
    }
  }
  return px;
}

/** 사진에 톤을 곱하고 얼룩을 입힌다. amount 0 이면 톤만. */
export function tintGrime(px, rgb, amount = 0.45) {
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const g = amount ? fbm(x / TEX, y / TEX, 4, 11) : 0;
      const k = 1 - amount * Math.max(0, g - 0.4);
      const i = (y * TEX + x) * 4;
      px[i] = px[i] * rgb[0] / 255 * k;
      px[i + 1] = px[i + 1] * rgb[1] / 255 * k;
      px[i + 2] = px[i + 2] * rgb[2] / 255 * k;
    }
  }
  return px;
}

/* ── 브라우저 전용 ─────────────────────────────────── */

const loadImg = (url) => new Promise((ok) => {
  if (!url) { ok(null); return; }
  const i = new Image();
  i.onload = () => ok(i);
  i.onerror = () => ok(null);
  i.src = url;
});

function pixelsOf(img, crop, filter) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const g = c.getContext('2d');
  if (filter) g.filter = filter;
  if (crop) g.drawImage(img, crop[0], crop[1], crop[2], crop[3], 0, 0, TEX, TEX);
  else g.drawImage(img, 0, 0, TEX, TEX);
  return g.getImageData(0, 0, TEX, TEX).data;
}

export function canvasOf(px) {
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), TEX, TEX), 0, 0);
  return c;
}

/** 표면 텍스처 다섯 장 (wall, floor, ceil, door, light) + 문 캔버스. */
export async function buildSurfaces(surfaces = {}) {
  const out = {};
  for (const s of ['wall', 'floor', 'ceil', 'door']) {
    const look = surfaces[s];
    const custom = await loadImg(look?.img);
    if (custom) { out[s] = pixelsOf(custom, null, 'grayscale(.4) sepia(.35) contrast(1.15)'); continue; }
    const photo = (s === 'ceil' || look?.color) ? null : await loadImg(`/tex/${s}.jpg`);
    out[s] = photo ? tintGrime(pixelsOf(photo), TONE[s], s === 'door' ? 0.1 : 0.45) : procedural(s, look?.color);
  }
  const panel = await loadImg('/tex/ceil.jpg');
  out.light = panel ? pixelsOf(panel, [8, 8, 72, 72]) : procedural('light');
  out.doorCanvas = canvasOf(out.door);
  return out;
}
```

- [ ] **Step 4: 통과** — `npm test` → `전부 통과` 다섯 번
- [ ] **Step 5: 커밋** — `git add public/geometry.js public/textures.js test/client.js && git commit -m "표면 텍스처와 레이캐스터 기하"`

---

### Task 4: decal·판 재료 (`uncanny.js`)

**Files:** `public/uncanny.js`

**Interfaces — Produces:**
- `emojiCanvas(emoji) → HTMLCanvasElement` (128px, 캐시)
- `decalPixels(key, source: canvas|null, emoji) → { data: Uint8ClampedArray, size: 128 }` — 기괴 보정 필터를 입혀 128px 로. `key` 로 캐시.

- [ ] **Step 1: 구현** — `public/uncanny.js` 끝에:

```js
const emojiCache = new Map();

/** 이모지를 128px 캔버스에. 이미지가 없을 때 대신 쓴다. */
export function emojiCanvas(emoji) {
  if (emojiCache.has(emoji)) return emojiCache.get(emoji);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.font = '104px serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji || '❔', 64, 70);
  emojiCache.set(emoji, c);
  return c;
}

const decalCache = new Map();

/** 벽·바닥에 붙일 픽셀. 기괴 보정을 미리 입힌다. */
export function decalPixels(key, source, emoji) {
  if (decalCache.has(key)) return decalCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (FILTER_OK) g.filter = 'grayscale(.7) sepia(.45) contrast(1.3)';
  g.drawImage(source || emojiCanvas(emoji), 0, 0, 128, 128);
  const out = { data: g.getImageData(0, 0, 128, 128).data, size: 128 };
  decalCache.set(key, out);
  return out;
}
```

- [ ] **Step 2: 확인** — `node --check public/uncanny.js`, `npm test`
- [ ] **Step 3: 커밋** — `git add public/uncanny.js && git commit -m "벽과 바닥에 붙일 그림을 준비한다"`

---

### Task 5: 레이캐스터 — 텍스처·안개·형광등·decal·해상도

**Files:** `public/game.js`, `public/style.css`

**Interfaces — Consumes:** `buildSurfaces`, `TEX` (Task 3), `faceOf`, `raySegment` (Task 3), `decalPixels`, `sprite` (Task 4 / 기존).

- [ ] **Step 1: import·상태**
  - import 추가: `import { TEX, buildSurfaces } from '/textures.js';`, `import { faceOf, raySegment } from '/geometry.js';`, uncanny import 에 `emojiCanvas, decalPixels` 추가.
  - 파일 위 상수:

```js
const FOG = [58, 52, 34];                  // 누런 안개
const SCALES = [1, 0.75, 0.55];            // 느리면 한 단계씩 내린다
const ITEM_EMOJI = { pistol: '🔫', knife: '🔪', map: '🗺️' };
const isLight = (x, y) => ((x * 7 + y * 13) % 5 + 5) % 5 === 0;   // 형광등 칸
```

  - 생성자 `this._resize();` **위**에:

```js
    this.tex = null;                        // 텍스처가 오기 전에는 예전 단색으로 그린다
    buildSurfaces(world.surfaces).then((t) => { this.tex = t; }).catch(() => {});
    this.scaleIdx = 0;
    this.frameMs = [];
    this.flickerUntil = 0;
    this.decalFrame = 0;
    this.floorDecal = new Int16Array(this.size * this.size).fill(-1);
    this.floorDecals = [];
    this.wallDecals = new Map();
```

  - `_resize()` 첫 줄 `const scale = 0.55;` → `const scale = SCALES[this.scaleIdx || 0];`
  - `start()` 의 loop 에서 `this.render();` 앞에:

```js
      // 느리면 해상도를 한 단계 내린다. 올리지는 않는다.
      this.frameMs.push(dt * 1000);
      if (this.frameMs.length >= 30) {
        const avg = this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length;
        this.frameMs = [];
        if (avg > 28 && this.scaleIdx < SCALES.length - 1) { this.scaleIdx++; this._resize(); }
      }
```

- [ ] **Step 2: decal 목록** — `render()` 위에:

```js
  /** 벽·바닥에 붙은 그림 목록을 다시 만든다. 이미지가 늦게 도착해도 따라잡도록 가끔 부른다. */
  rebuildDecals() {
    const pix = (id, img, emoji) => {
      const cv = sprite(img);
      return decalPixels(cv ? `${img}` : `e:${emoji}`, cv, emoji);
    };
    this.wallDecals = new Map();
    for (const o of this.objects) {
      if (o.where !== 'wall') continue;
      const k = `${o.x},${o.y},${o.face}`;
      if (!this.wallDecals.has(k)) this.wallDecals.set(k, []);
      this.wallDecals.get(k).push(pix(o.id, o.img, o.emoji));
    }
    this.floorDecal.fill(-1);
    this.floorDecals = [];
    const lay = (x, y, p) => {
      if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
      this.floorDecal[y * this.size + x] = this.floorDecals.push(p) - 1;
    };
    for (const o of this.objects) if (!o.taken && o.where !== 'wall' && o.pose === 'lie') lay(o.x, o.y, pix(o.id, o.img, o.emoji));
    for (const it of this.items) if (!it.taken) lay(it.x, it.y, pix(it.id, it.img, ITEM_EMOJI[it.kind]));
  }

  /** 형광등 깜빡임. 가끔 0.1~0.3초 어두워진다. */
  flicker() {
    const now = performance.now();
    if (now > this.flickerUntil && Math.random() < 0.004) this.flickerUntil = now + 100 + Math.random() * 200;
    return now < this.flickerUntil ? 0.55 : 1;
  }
```

  `takeItem()`·`takeTool()` 끝에 `this.decalFrame = 0;` (다음 프레임에 다시 만든다).

- [ ] **Step 3: `render()` 교체** — 기존 `render()` 전체를:

```js
  render() {
    const { rw, rh, img } = this;
    const data = img.data;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;
    const T = this.tex;
    const blind = this.fx.has('blind');
    const half = rh / 2;
    const fogDist = blind ? 1.2 : 6.5;
    const dark = blind ? 0.35 : 1;
    const light = this.flicker() * dark;
    if (T && this.decalFrame-- <= 0) { this.rebuildDecals(); this.decalFrame = 30; }

    // 안개와 섞어 찍는다.
    const put = (i, r, g, b, fog, k) => {
      data[i] = r * k * (1 - fog) + FOG[0] * dark * fog;
      data[i + 1] = g * k * (1 - fog) + FOG[1] * dark * fog;
      data[i + 2] = b * k * (1 - fog) + FOG[2] * dark * fog;
      data[i + 3] = 255;
    };

    if (!T) {
      // 텍스처가 오기 전: 예전 단색
      for (let y = 0; y < rh; y++) {
        const top = y < half;
        const base = top ? COLORS.ceil : COLORS.floor;
        const k = top ? y / half : 1 - (y - half) / half;
        const f = (0.35 + k * 0.65) * dark;
        for (let x = 0; x < rw; x++) {
          const i = (y * rw + x) * 4;
          data[i] = base[0] * f; data[i + 1] = base[1] * f; data[i + 2] = base[2] * f; data[i + 3] = 255;
        }
      }
    } else {
      // 바닥·천장 (floor casting). 천장 줄은 바닥 줄과 대칭이다.
      const rdx0 = dirX - planeX, rdy0 = dirY - planeY, rdx1 = dirX + planeX, rdy1 = dirY + planeY;
      const size = this.size;
      for (let y = Math.floor(half); y < rh; y++) {
        const p = y - half + 0.5;
        const rowDist = half / p;
        const sx = rowDist * (rdx1 - rdx0) / rw, sy = rowDist * (rdy1 - rdy0) / rw;
        let fx = this.px + rowDist * rdx0, fy = this.py + rowDist * rdy0;
        const fog = Math.min(1, rowDist / fogDist);
        const yc = rh - 1 - y;
        for (let x = 0; x < rw; x++) {
          const cx = Math.floor(fx), cy = Math.floor(fy);
          const lu = fx - cx, lv = fy - cy;
          const ti = ((((lv * TEX) | 0) & (TEX - 1)) * TEX + (((lu * TEX) | 0) & (TEX - 1))) * 4;
          let r = T.floor[ti], g = T.floor[ti + 1], b = T.floor[ti + 2];
          const di = (cx >= 0 && cy >= 0 && cx < size && cy < size) ? this.floorDecal[cy * size + cx] : -1;
          if (di >= 0 && lu > 0.15 && lu < 0.85 && lv > 0.15 && lv < 0.85) {
            const dp = this.floorDecals[di];
            const j = ((((lv - 0.15) / 0.7 * dp.size) | 0) * dp.size + (((lu - 0.15) / 0.7 * dp.size) | 0)) * 4;
            const a = dp.data[j + 3] / 255;
            r = r * (1 - a) + dp.data[j] * a; g = g * (1 - a) + dp.data[j + 1] * a; b = b * (1 - a) + dp.data[j + 2] * a;
          }
          put((y * rw + x) * 4, r, g, b, fog, light);
          if (yc >= 0) {
            const lit = isLight(cx, cy);
            const src = lit ? T.light : T.ceil;
            put((yc * rw + x) * 4, src[ti], src[ti + 1], src[ti + 2], lit ? fog * 0.4 : fog, light);   // 형광등은 안개를 덜 탄다
          }
          fx += sx; fy += sy;
        }
      }
    }

    // 벽 (DDA)
    this.zBuf.length = rw;
    for (let x = 0; x < rw; x++) {
      const camX = (2 * x) / rw - 1;
      const rdx = dirX + planeX * camX;
      const rdy = dirY + planeY * camX;

      let mapX = Math.floor(this.px), mapY = Math.floor(this.py);
      const ddx = Math.abs(1 / (rdx || 1e-9));
      const ddy = Math.abs(1 / (rdy || 1e-9));
      let stepX, stepY, sdx, sdy;

      if (rdx < 0) { stepX = -1; sdx = (this.px - mapX) * ddx; }
      else { stepX = 1; sdx = (mapX + 1 - this.px) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (this.py - mapY) * ddy; }
      else { stepY = 1; sdy = (mapY + 1 - this.py) * ddy; }

      let side = 0, hit = false, guard = 0;
      while (!hit && guard++ < 256) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; }
        else { sdy += ddy; mapY += stepY; side = 1; }
        if (mapX < 0 || mapY < 0 || mapX >= this.size || mapY >= this.size) { hit = true; break; }
        if (this.grid[mapY][mapX] === 1) hit = true;
      }

      const dist = side === 0 ? sdx - ddx : sdy - ddy;
      const d = Math.max(0.05, dist);
      this.zBuf[x] = d;

      const lineH = rh / d;
      const yTop = half - lineH / 2;
      const y0 = Math.max(0, Math.floor(yTop));
      const y1 = Math.min(rh - 1, Math.floor(half + lineH / 2));

      if (!T) {
        const base = side === 1 ? COLORS.wallDark : COLORS.wallLight;
        const fog = Math.max(0.14, Math.min(1, (blind ? 1.2 : 5.0) / d));
        for (let y = y0; y <= y1; y++) {
          const i = (y * rw + x) * 4;
          data[i] = base[0] * fog; data[i + 1] = base[1] * fog; data[i + 2] = base[2] * fog; data[i + 3] = 255;
        }
        continue;
      }

      let wallX = side === 0 ? this.py + d * rdy : this.px + d * rdx;
      wallX -= Math.floor(wallX);
      if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) wallX = 1 - wallX;   // 어느 쪽에서 봐도 같은 방향
      const tu = (wallX * TEX) | 0;
      const fog = Math.min(1, d / fogDist);
      const k = light * (side ? 0.8 : 1);

      // 이 벽면에 걸린 것
      let decal = null, du = 0;
      const list = this.wallDecals.get(`${mapX},${mapY},${faceOf(side, stepX, stepY)}`);
      if (list && wallX >= 0.2 && wallX <= 0.8) {
        const sl = (wallX - 0.2) / 0.6 * list.length;
        const idx = Math.min(list.length - 1, Math.floor(sl));
        decal = list[idx]; du = sl - idx;
      }

      for (let y = y0; y <= y1; y++) {
        const v = (y - yTop) / lineH;
        const ti = ((((v * TEX) | 0) & (TEX - 1)) * TEX + tu) * 4;
        let r = T.wall[ti], g = T.wall[ti + 1], b = T.wall[ti + 2];
        if (decal && v >= 0.22 && v <= 0.72) {
          const j = ((((v - 0.22) / 0.5 * decal.size) | 0) * decal.size + ((du * decal.size) | 0)) * 4;
          const a = decal.data[j + 3] / 255;
          r = r * (1 - a) + decal.data[j] * a; g = g * (1 - a) + decal.data[j + 1] * a; b = b * (1 - a) + decal.data[j + 2] * a;
        }
        put((y * rw + x) * 4, r, g, b, fog, k);
      }
    }

    this.ctx.putImageData(img, 0, 0);
    this.drawSprites();
  }
```

- [ ] **Step 4: CSS** — `public/style.css` 의 `#view { ... image-rendering: pixelated; }` 에서 `image-rendering: pixelated;` 를 지운다.
- [ ] **Step 5: 확인** — `node --check public/game.js`, `npm test`
- [ ] **Step 6: 커밋** — `git add public/game.js public/style.css && git commit -m "벽·바닥·천장에 질감, 누런 안개, 형광등, 벽과 바닥에 붙은 그림"`

---

### Task 6: 스프라이트 — 고정된 판·문 텍스처

**Files:** `public/game.js`

- [ ] **Step 1: `collectSprites()`** — items 루프와 objects 루프를 교체:

```js
    // 줍는 아이템은 바닥에 눕혀 그린다 (rebuildDecals). 여기서는 빠진다.
    for (const o of this.objects) {
      if (o.taken || o.where === 'wall' || o.pose === 'lie') continue;   // 벽·바닥 그림은 render() 가 그린다
      if (o.moves === 'still') {
        out.push({ kind: 'plane', ref: o, x: o.x + 0.5, y: o.y + 0.5 });
      } else {
        out.push({ kind: 'object', ref: o, x: o.x + 0.5 + o.dx, y: o.y + 0.5 + o.dy, h: 0.7, w: 0.6, ground: true });
      }
    }
```

  단, 텍스처가 아직 없을 때(`!this.tex`)는 decal 이 그려지지 않으므로, 그동안은 벽·바닥 물체와 아이템을 예전처럼 billboard 로 넣는다: 루프 앞에 `const flat = !!this.tex;` 를 두고, `flat` 이 false 면 기존 코드(아이템 billboard, 벽 물체 lift billboard, 모든 바닥 물체 billboard)를 그대로 쓴다. (기존 코드를 `if (!flat) { ...기존... } else { ...새 코드... }` 로 감싼다.)

- [ ] **Step 2: `drawSprites()` 에서 판을 처리** — 루프 맨 앞(`const sx = s.x - this.px` 위)에:

```js
      if (s.kind === 'plane') { this.drawPlane(s.ref); continue; }
```

  `drawSprites()` 아래에:

```js
  /** 방향이 고정된 판. 옆에서 보면 얇아지고, 나를 쳐다보지 않는다. */
  drawPlane(o) {
    const { rw, rh } = this;
    const c = this.ctx;
    const dirX = Math.cos(this.angle), dirY = Math.sin(this.angle);
    const planeX = -dirY * this.fov, planeY = dirX * this.fov;
    const th = (o.stretch - 1.15) / 0.2 * Math.PI;           // id 로 정해진 각도 (0 ~ π)
    const hw = 0.32;
    const ax = o.x + 0.5 - Math.cos(th) * hw, ay = o.y + 0.5 - Math.sin(th) * hw;
    const bx = o.x + 0.5 + Math.cos(th) * hw, by = o.y + 0.5 + Math.sin(th) * hw;
    const src = sprite(o.img) || emojiCanvas(o.emoji);
    const blind = this.fx.has('blind');
    c.save();
    let drawn = false;
    for (let x = 0; x < rw; x++) {
      const camX = (2 * x) / rw - 1;
      const hit = raySegment(this.px, this.py, dirX + planeX * camX, dirY + planeY * camX, ax, ay, bx, by);
      if (!hit || hit.t >= this.zBuf[x] || hit.t < 0.2 || (blind && hit.t > 1.5)) continue;
      if (!drawn) {
        const fog = Math.max(0.16, Math.min(1, 5.2 / hit.t));
        c.filter = `grayscale(.7) sepia(.45) contrast(1.3) brightness(${fog.toFixed(2)})`;
        drawn = true;
      }
      const unit = rh / hit.t;
      const bottom = rh / 2 + unit / 2;
      const top = bottom - unit * 0.7 * o.stretch;
      c.drawImage(src, Math.min(src.width - 1, (hit.s * src.width) | 0), 0, 1, src.height, x, top, 1, bottom - top);
    }
    c.restore();
    o.visible = drawn;
  }
```

- [ ] **Step 3: 문 텍스처** — `paintSprite()` 의 `if (kind === 'door') {` 블록 맨 앞에:

```js
      if (this.tex?.doorCanvas) {
        const x = cx - w / 2, y = bottom - h;
        c.save();
        c.filter = `brightness(${(fog * 0.9).toFixed(2)})`;
        c.drawImage(this.tex.doorCanvas, x, y, w, h);
        c.restore();
        c.fillStyle = `rgba(214,186,108,${0.4 + fog * 0.5})`;
        c.fillRect(x + w * 0.76, y + h * 0.52, Math.max(1.2, w * 0.05), Math.max(1.2, h * 0.04));   // 손잡이
        c.fillStyle = `rgba(230,210,140,${0.08 + fog * 0.12})`;
        c.fillRect(x, bottom - Math.max(1, h * 0.012), w, Math.max(1, h * 0.012));                   // 문틈 빛
        return;
      }
```

- [ ] **Step 4: 확인** — `node --check public/game.js`, `npm test`. 브라우저 확인 (창을 띄워 달라고 요청하거나 사용자 확인):

```bash
rm -f browser.db*; DB_PATH=./browser.db node -e "import('./src/db.js').then(({q})=>{const u=q.upsertUser.get('dev-local','테스트 플레이어',null,Date.now());q.insertEntry.get(u.id,null,'x','applied','x',JSON.stringify([{type:'maze.size',value:11},{type:'object.spawn',name:'가면',emoji:'🙃',where:'wall',count:6},{type:'object.spawn',name:'찢어진 종이',emoji:'📄',pose:'lie',count:3},{type:'object.spawn',name:'의자',emoji:'🪑',count:3},{type:'object.spawn',name:'고양이',emoji:'🐈',moves:'wander'},{type:'item.knife',value:true},{type:'entity.monster',count:1}]),Date.now())})"
DEV_NO_AUTH=1 IMAGE_PROVIDER=none DB_PATH=./browser.db PORT=3998 node src/server.js
```

  - [ ] 벽이 누렇게 찌든 벽지, 바닥이 얼룩진 카펫, 천장에 타일과 드문드문 형광등
  - [ ] 멀어질수록 누런 안개, 가끔 화면이 깜빡 어두워진다
  - [ ] 🙃 가 벽면에 평평하게 붙어 있다 (옆에서 보면 벽과 같이 기운다)
  - [ ] 📄 과 칼(🔪)이 바닥에 누워 있다
  - [ ] 🪑 가 방향이 고정된 판이라 돌아 보면 얇아진다
  - [ ] 🐈 와 괴물은 늘 나를 본다
  - [ ] 문이 긁힌 나무 질감
  - [ ] 화면이 예전보다 선명하다 (픽셀이 덜 뭉개진다), 버벅이지 않는다
  - [ ] 콘솔 에러 없음

  정리: 포트 3998 프로세스만 종료, `browser.db*` 삭제.
- [ ] **Step 5: 커밋** — `git add public/game.js && git commit -m "서 있는 물건은 고정된 판으로, 문은 나무 질감으로"`
