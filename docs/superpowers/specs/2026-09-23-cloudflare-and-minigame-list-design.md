# Cloudflare 이전 + 마리 `/미니게임 목록` — 설계

## 목적

- 게임 서버를 **카드 없이, 무료로, 켜 둘 PC 없이** 운영한다. Cloudflare Workers Free + D1 + KV + Workers Static Assets.
- 디스코드에서 마리의 `/미니게임 목록`으로 게임을 골라 링크를 받는다. `/미니게임 하기`는 없앤다.

## 원칙

- 게임 규칙·화면은 바꾸지 않는다. 판정·월드·규칙·클라이언트 코드는 그대로 쓴다.
- 무료 한도만 쓴다. R2(결제 수단 등록이 필요하다고 알려짐)는 쓰지 않는다.
- 테스트는 지금처럼 node 에서 돈다. 플랫폼에 기대는 부분(DB·이미지 저장)만 어댑터로 갈아 끼운다.
- 플레이 시점(`/api/run/start`) 외부 호출 0회는 그대로.

## 1. 구조

```
Worker (src/worker.js)
 ├─ /api/*, /enter, /obj/*, /healthz → src/app.js 의 핸들러 (플랫폼 독립)
 └─ 그 밖의 경로 → Workers Static Assets (public/)
바인딩: DB (D1), IMAGES (KV), ASSETS (정적 파일)
```

- `src/app.js`: `handle(request, ctx)` — `ctx = { store, images, env, now }`. 라우팅·쿠키·JSON 응답을 직접 처리한다 (express 제거).
- `src/worker.js`: `export default { fetch(req, env) }` 가 D1·KV 어댑터로 `ctx` 를 만들어 `handle` 을 부르고, 핸들러가 맡지 않은 경로는 `env.ASSETS.fetch(req)`.
- `wrangler.toml`: `compatibility_flags = ["nodejs_compat"]` (node:crypto·Buffer), `[assets] directory = "./public"`, 워커가 먼저 받을 경로 `/api/*`·`/enter`·`/obj/*`·`/healthz`. 정확한 키 이름은 구현 첫 단계에서 공식 문서로 확인한다.
- 환경변수: `process.env` 대신 `ctx.env` 를 명시적으로 넘긴다 (`llm.js`·`assets.js`·`runs.js`·`link.js` 가 `env` 인자를 받는다). node 테스트는 `process.env` 를 넘긴다.
- `src/server.js`(express)·`cookie-parser`·`express` 의존성은 지운다. 로컬 실행은 `wrangler dev` (로컬 D1·KV 흉내).
- 텍스처: `assets/textures/` → `public/tex/` 로 옮겨 정적 파일로 서빙한다. 라이브러리(`assets/library.json`)는 번들에 포함(import)하고, 라이브러리 이미지 파일은 `public/lib/` 로.

## 2. DB (D1)

- `migrations/0001_init.sql`: 지금의 최종 스키마 한 장 (users.lost_parts·read_book, runs.death_x·death_y, assets.kind 포함). 기존 ALTER 마이그레이션 코드는 없앤다 (새 DB 에서 시작).
- `src/store.js`: 비동기 인터페이스 `one(sql, ...args)`·`all(...)`·`run(...)`.
  - D1 어댑터: `env.DB.prepare(sql).bind(...args).first()` / `.all().results` / `.run()`.
  - node 어댑터 (테스트용): better-sqlite3 로 같은 SQL 파일을 실행해 만든 DB 를 Promise 로 감싼다. better-sqlite3 는 **개발 의존성**으로만 남는다.
- `src/queries.js`: 지금의 `q.*` 를 `queries(store)` 가 돌려주는 비동기 함수로. 이름은 그대로라 호출부는 `await` 만 붙는다.
- `runs.js`·`assets.js`·핸들러는 async.
- 기존 로컬 DB(`napolitan.db`, `test.db`, `fresh.db`)는 옮기지 않는다. 운영은 빈 D1 에서 시작한다.

## 3. 이미지 (KV)

- 저장: KV 키 `obj/<sha1(key)16>.<ext>`, 값은 바이너리, 메타데이터 `{ type }`. 하루 쓰기 1,000회 한도 안 (이미지 하루 최대 5장 + 텍스처 드묾).
- 서빙: `GET /obj/<file>` → KV 에서 읽어 `Content-Type`·`Cache-Control: public, max-age=31536000, immutable`. 없으면 404 (클라이언트는 이모지로).
- `imgFor(key)`: 파일 존재 확인(fs)을 없앤다. ready 행이면 URL.
- `resolveAsset` 의 파일 저장을 `images.put(file, data, type)` 주입으로 바꾼다 (node 테스트는 메모리 Map).
- **생성은 방명록 응답 전에 끝낸다.** Workers 는 응답 뒤 작업을 30초까지만 기다리므로, 기입 요청 안에서 `await Promise.all(...)` 로 오브젝트·괴물 모습·표면 질감을 병렬로 확보한 뒤 응답한다. 사용자는 연결을 유지하는 동안 제한 없이 기다릴 수 있다. 화면 문구 "공책이 글을 읽고 있다..." 가 그만큼 길어진다.
- 줍는 아이템(권총·칼·지도) 모습: 서버 시작 시점이 없으므로, 방명록 기입 때 **상태에 있는데 모습이 없는 아이템**을 같이 확보한다.

## 4. 쿠키·입장

- `Cookie` 헤더를 직접 읽고 `Set-Cookie` 를 직접 만든다 (`HttpOnly; SameSite=Lax; Secure; Max-Age=2592000`).
- `/enter` 는 계획대로 (마리 링크, `MARI_LINK_SECRET`). `DEV_NO_AUTH` 는 로컬에서만.

## 5. 비용·한도 점검

| 한도 (무료) | 예상 사용 |
|---|---|
| Workers 요청 10만/일 | 플레이·방명록 수백~수천 |
| CPU 10ms/요청 | 최대 월드 생성 1.6ms, 이미지 응답 처리 2ms 안팎 (로컬 측정) |
| D1 읽기 500만·쓰기 10만/일, 5GB | 충분 |
| KV 읽기 10만·쓰기 1,000/일, 1GB | 이미지 하루 최대 5장, 읽기는 캐시로 줄어든다 |

배포 후 대시보드의 CPU 시간 지표로 한 번 더 확인한다.

## 6. 마리 `/미니게임 목록` (마리 레포)

- 브랜치: `develop` 에서 `feat/minigame-list`. `develop` 에 합친 뒤 `main` 은 사용자가 "배포하자" 할 때만.
- 게임 목록은 코드에 둔다 (게임마다 링크 모양·열쇠·유효기간이 달라서):

  | 키 | 이름 | 링크 | 열쇠 (.env) | 유효기간 |
  |---|---|---|---|---|
  | `avoid` | (지금 이름) | `{주소}?u=표` | `MARI_MINIGAME_SECRET` | 7일 |
  | `napolitan` | 돌이킬 수 없는 | `{주소}/enter?u=표` | `MARI_NAPOLITAN_SECRET` | 1시간 |

- `/미니게임 목록`: 나만 보이는 메시지에 게임별 설명과 선택 메뉴. 고르면 그 순간 표를 만들어 링크 버튼을 준다. 주소가 없는 게임은 "준비 중"으로 보이고 고를 수 없다. 열쇠가 없으면 링크 대신 관리자 안내.
- `/미니게임 하기`: **없앤다.** 도움말(`help.py`)도 목록으로 바꾼다.
- `/미니게임 설정`: `게임` 선택지(기본 `avoid`) 추가. `avoid` 는 지금 칸(`url`·`api`·`game`) 그대로, 새 게임 주소는 같은 칸의 `urls: { napolitan: … }`.
- `/미니게임 랭킹`·`기록삭제`: 그대로 (`avoid` 전용).
- `make_token(user_id, name, *, now=None, secret=MINIGAME_SECRET, ttl=TOKEN_TTL_SECONDS)`. 기본값이 지금 값이라 기존 호출 불변.
- `mari_config.NAPOLITAN_SECRET = MARI_NAPOLITAN_SECRET`.
- 테스트(pytest): 기존 피하기 표 불변, 나폴리탄 표의 열쇠·유효기간·경로, 주소 없는 게임 선택 불가, 열쇠 없으면 링크 없음, **게임 서버 테스트의 파이썬 기준값과 같은 표**.

## 7. 사용자가 할 일 (배포)

1. 개발 PC 에서 `npx wrangler login` (브라우저로 Cloudflare 로그인 — 직접).
2. `npx wrangler d1 create napolitan` → 나온 `database_id` 를 `wrangler.toml` 에.
3. `npx wrangler kv namespace create IMAGES` → 나온 `id` 를 `wrangler.toml` 에.
4. 비밀값: `npx wrangler secret put GEMINI_API_KEY` / `MARI_LINK_SECRET` / `SESSION_SECRET`.
5. `npx wrangler d1 migrations apply napolitan --remote`.
6. `npx wrangler deploy` → `https://napolitan.<계정>.workers.dev`.
7. 마리: 서버 PC `.env` 에 `MARI_NAPOLITAN_SECRET=<4의 MARI_LINK_SECRET 과 같은 값>`, 새 코드를 `main` 으로 배포(SourceTree pull), 봇 재시작, `/미니게임 설정 게임:돌이킬 수 없는 주소:https://napolitan.<계정>.workers.dev`.

## 8. 범위 밖

- 기존 로컬 DB 이관.
- 커스텀 도메인.
- 이미지 생성 Batch API.

## 9. 테스트

- 기존 테스트 전부 (async 로 바뀐 부분은 `await`).
- `store` node 어댑터로 핸들러 단위 테스트: `/enter`, `/api/run/start`, 방명록 기입이 이미지를 응답 전에 확보, `/obj/*` 가 KV 에서 서빙, 연속 입장 거부, 공책 읽기 문.
- `wrangler dev` 로 로컬 스모크 (방명록 → 입장 → 사망·클리어).
- 배포 후: `/healthz`, 링크 입장, CPU 시간 지표.
