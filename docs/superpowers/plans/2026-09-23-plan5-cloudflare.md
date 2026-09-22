# 계획 5: Cloudflare 이전 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** express + better-sqlite3 + 파일 저장 서버를 Cloudflare Worker + D1 + KV + Static Assets 로 옮긴다. 게임 규칙·화면은 그대로.

**Architecture:** `db.js` 의 `q` 를 "요청 때 한 번 연결되는 저장소" 로 바꿔(D1 또는 테스트용 better-sqlite3), 호출부는 `await` 만 붙인다. 이미지 저장도 주입형(`useImages`)으로 바꾼다. 라우팅은 `src/app.js` 의 `handle(request)` 가 맡고, `src/worker.js` 가 D1·KV 를 연결한 뒤 `handle` 을 부르거나 정적 파일로 넘긴다.

**Tech Stack:** Cloudflare Workers (nodejs_compat), D1, KV, Static Assets, wrangler 4.136. 테스트는 node + better-sqlite3(개발 의존성).

**Spec:** `docs/superpowers/specs/2026-09-23-cloudflare-and-minigame-list-design.md` §1~§5, §7, §9

## Global Constraints

- 무료 플랜만. R2 쓰지 않는다.
- 환경변수는 `process.env` (nodejs_compat 의 `nodejs_compat_populate_process_env`, 호환성 날짜 2026-09-21 에서 기본 켜짐). 스펙 §1 의 "env 를 인자로" 는 이 방식으로 대신한다.
- 방명록 기입은 이미지 확보까지 끝낸 뒤 응답한다 (응답 뒤 작업 30초 제한).
- 플레이 시작(`/api/run/start`) 외부 호출 0회.
- 쿠키: `nps`, `HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`, https 면 `Secure`.
- JSON 본문 32KB 제한.
- 기존 테스트는 모두 통과해야 한다 (async 로 바뀐 곳만 `await`).

## Review Focus

1. D1 과 better-sqlite3 의 차이: `.first()` 가 없으면 `null`(better-sqlite3 는 `undefined`) → 호출부는 둘 다 falsy 로 다룬다. → Task 1 테스트.
2. 쿠키가 없거나 망가짐 → 로그인 안 된 것으로, 에러 없음. → Task 3 테스트.
3. 방명록 기입 중 이미지 생성 실패 → 글은 남고 응답은 정상. → Task 3 테스트.
4. `/obj/<없는 파일>`·`/obj/../x` → 404. → Task 3 테스트.
5. 모르는 경로 `/api/nope` → 404 JSON (정적 파일로 새지 않는다). → Task 3 테스트.

---

### Task 1: 저장소 (`store.js`·`queries.js`·마이그레이션)

**Files:** Create `migrations/0001_init.sql`, `src/store.js`, `src/queries.js`, `test/store.js`; Modify `src/db.js`, `package.json`

**Interfaces — Produces:**
- `nodeStore(file = ':memory:') → store` (마이그레이션 SQL 을 실행한 better-sqlite3)
- `d1Store(DB) → store`
- store: `{ get(sql, args) → Promise<row|null>, all(sql, args) → Promise<row[]>, run(sql, args) → Promise<void> }`
- `queries(store) → q` — 지금의 `q.*` 와 같은 이름, 각각 `{ get(...a), all(...a), run(...a) }` (Promise).
- `db.js`: `export let q; export function useStore(store)`, `export async function loadAppliedRules()`.

- [ ] Step 1: 실패하는 테스트 `test/store.js` — nodeStore 로 users·entries·runs·assets 를 넣고 읽기, `get` 이 없는 행에 `null`, `RETURNING` 이 행을 돌려주는지, `loadAppliedRules` 가 applied 만 id 순으로.
- [ ] Step 2: `node test/store.js` → 모듈 없음
- [ ] Step 3: 구현
  - `migrations/0001_init.sql`: 지금 `db.js` 의 `CREATE TABLE`·인덱스 전부 + 마이그레이션으로 붙인 컬럼(`runs.death_x/death_y`, `users.lost_parts/read_book`, `assets.kind`)을 처음부터 포함.
  - `src/store.js`: nodeStore 는 better-sqlite3 를 **동적 import** (워커 번들에 들어가지 않게). d1Store 는 `DB.prepare(sql).bind(...args).first()` / `.all()).results` / `.run()`.
  - `src/queries.js`: `db.js` 의 prepare 문 SQL 을 그대로 옮긴다.
  - `src/db.js`: 파일 전체를 `useStore`·`q`·`loadAppliedRules` 로 교체.
  - `package.json` test 스크립트에 `node test/store.js` 추가.
- [ ] Step 4: `node test/store.js` 통과
- [ ] Step 5: 커밋

### Task 2: 비동기로 (`runs.js`·`assets.js`·`auth.js`)

**Files:** Modify `src/runs.js`, `src/assets.js`, `src/auth.js`, `test/assets.js`, `test/server.js`

**Interfaces — Produces:**
- `runs.js` 함수 전부 async (`canEnter`, `bodyOf`, `saveBodyOnClear`, `resetBody`, `hasReadBook`, `markBookRead`; `isOpen` 은 그대로 동기).
- `assets.js`: `useImages({ put(file, bytes, type), get(file) → { bytes, type } | null })`, `resolveAsset` async (그대로), `imgFor` async, 파일 존재 확인 제거, `loadLibrary` 는 번들된 JSON (`import library from '../assets/library.json' with { type: 'json' }`), `assetDir`·`LIBRARY_DIR` 제거.
- `auth.js`: `sessionCookie(user) → string`, `clearCookie() → string`, `async currentUser(cookieHeader)`.

- [ ] Step 1: `test/assets.js`·`test/server.js` 를 `useStore(await nodeStore())`·`useImages(메모리 Map)` 로 바꾸고 모든 호출에 `await`. 파일 존재 대신 메모리 이미지로 `imgFor` 검사 — "이미지가 지워졌으면 null" 테스트는 "KV 에서 못 읽으면 클라이언트가 이모지" 로 성격이 바뀌므로 **삭제**하고 `/obj` 404 테스트(Task 3)로 옮긴다.
- [ ] Step 2: 실패 확인
- [ ] Step 3: 구현 (위 인터페이스)
- [ ] Step 4: `npm test` (server.js 는 아직 옛 코드라 import 만 안 깨지면 된다 — express 서버는 Task 3 에서 지운다)
- [ ] Step 5: 커밋

### Task 3: 핸들러 (`app.js`)

**Files:** Create `src/app.js`, `test/app.js`; Delete `src/server.js`; Modify `package.json`

**Interfaces — Produces:** `handle(request: Request) → Promise<Response | null>` — 맡지 않는 경로는 `null` (워커가 정적 파일로).

라우트: `GET /healthz`, `GET /enter`, `POST /auth/logout`, `GET /api/me`, `GET /api/guestbook`, `POST /api/guestbook`, `POST /api/run/start`, `POST /api/run/:id/clear`, `POST /api/run/:id/die`, `GET /obj/:file` (`[0-9a-f]{16}\.(png|jpg|webp)` 만), 그 밖의 `/api/*` 는 404 JSON.

방명록 기입: 판정 → 글 저장 → **확보할 모습 목록**(object.spawn·monster_look·surface.look·상태에 있는데 모습 없는 권총·칼·지도)을 `Promise.all` 로 확보 (실패는 로그만) → 응답.

- [ ] Step 1: 실패하는 테스트 `test/app.js` — nodeStore(메모리) + 메모리 이미지 + fetch 가로채기(LLM·이미지)로:
  - 쿠키 없이 `/api/me` → user null; 망가진 쿠키도 null
  - `/enter?u=<유효 표>` → 302 + Set-Cookie, 그 쿠키로 `/api/me` 에 user
  - `/api/run/start` → 공책 안 읽으면 409, `/api/guestbook` 뒤 200
  - `/die`, 다시 start, `/clear` 2초 전 400
  - 기입: pendingWrite 가 있을 때 object.spawn 판정 → 응답 전에 assets 행 ready, `/obj/<file>` 이 이미지 바이트·Content-Type
  - 이미지 생성 실패해도 기입은 200
  - `/obj/../x`·`/obj/없음.png` 404, `/api/nope` 404 JSON, `/index.html` 은 `null`
- [ ] Step 2: 실패 확인
- [ ] Step 3: 구현 — `server.js` 의 로직을 그대로 옮기되 `req.body` → `await request.json()`(32KB 초과 413), `res.json` → `json(obj, status)`, 쿠키는 `auth.js`.
- [ ] Step 4: `npm test`
- [ ] Step 5: `src/server.js` 삭제, `express`·`cookie-parser`·`dotenv` 제거(`npm rm`), 커밋

### Task 4: 워커·정적 파일·스크립트

**Files:** Create `src/worker.js`; Move `assets/textures/*` → `public/tex/`, `assets/library/*` → `public/lib/`; Modify `package.json`, `test/seed.js`, `README.md`

- [ ] Step 1: `src/worker.js`

```js
import { useStore, d1Ready } from './db.js';
import { d1Store } from './store.js';
import { useImages } from './assets.js';
import { handle } from './app.js';

let bound = false;
export default {
  async fetch(request, env) {
    if (!bound) {
      useStore(d1Store(env.DB));
      useImages({
        put: (file, bytes, type) => env.IMAGES.put(`obj/${file}`, bytes, { metadata: { type } }),
        get: async (file) => {
          const r = await env.IMAGES.getWithMetadata(`obj/${file}`, 'arrayBuffer');
          return r.value ? { bytes: r.value, type: r.metadata?.type || 'image/png' } : null;
        },
      });
      bound = true;
    }
    return (await handle(request)) || env.ASSETS.fetch(request);
  },
};
```

- [ ] Step 2: `git mv assets/textures public/tex`, `git mv assets/library public/lib`, `assets/library.json` 은 그대로(번들 import).
- [ ] Step 3: `package.json` scripts: `"dev": "wrangler dev"`, `"deploy": "wrangler deploy"`, `"db:init": "wrangler d1 migrations apply napolitan --remote"`, `"seed": "node test/seed.js > seed.sql && wrangler d1 execute napolitan --local --file=seed.sql"`. `test/seed.js` 는 원작 방명록을 **SQL INSERT 문으로 출력**하게 바꾼다.
- [ ] Step 4: `npx wrangler deploy --dry-run --outdir .wrangler/dry` 로 번들 확인 (better-sqlite3·fs 가 번들에 없어야 한다).
- [ ] Step 5: README 의 실행·배포 절을 Cloudflare 기준으로 교체 (스펙 §7 절차). 커밋.

### Task 5: 배포 (사용자 확인 후)

- [ ] `npm run db:init` (원격 D1 에 표 생성)
- [ ] `npm run deploy`
- [ ] `https://napolitan.<계정>.workers.dev/healthz`, 링크 입장(테스트 표), 방명록·입장 스모크
- [ ] 대시보드 CPU 시간 확인 (사용자)
