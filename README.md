# 돌이킬 수 없는

**방명록에 적은 글이 다음 사람의 미궁 규칙이 되는 1인칭 레이캐스팅 웹게임.**
나폴리탄 괴담 [「돌이킬 수 없는」](https://gall.dcinside.com/mgallery/board/view/?id=napolitan&no=23461)을
게임으로 옮긴 2차 창작이다.

처음에는 아무것도 없는 빈 공간에 문 하나뿐이다. 방을 빠져나온 사람만 출구 쪽 공책(방명록)에
한 줄을 남길 수 있고, 그 글을 LLM 이 읽고 판정해서 **다음 사람의 방에 그대로 일어나게** 만든다.
"미로 같은 게 있으면 좋겠다"고 적으면 다음 사람부터 미로를 걷고, "벽에 웃는 가면이 가득"이라고
적으면 그 가면이 (이미지 생성까지 거쳐) 벽에 걸린다.

- Cloudflare Workers + D1 + KV 위에서 돈다 (서버 상시 구동 없음)
- LLM 공급자는 Gemini / OpenAI 호환(Groq·OpenRouter·Ollama 등) / Anthropic 중 환경변수로 선택
- 누구나 fork 해서 **자기 공동체용 방**을 따로 띄울 수 있다. 방명록은 배포한 쪽의 DB 에만 쌓인다
- 스크린샷·라이브 데모는 아직 없다. 로컬에서 `npm run dev` 로 바로 볼 수 있다 (아래 "실행")

---

## 핵심 아이디어

핵심은 **AI 를 플레이할 때가 아니라 방명록을 쓸 때 부른다**는 것이다.

```
방명록 기입 ──> [LLM 판정·컴파일] ──> Effect JSON 을 DB 에 누적
                                              │
플레이 시작 ──> 누적된 Effect 를 전부 접어서 월드 생성 (LLM 호출 0회, 즉시 입장)
```

플레이마다 LLM 을 부르면 입장이 느려지고, 무엇보다 같은 방명록인데 사람마다
다른 미로가 나와서 원작의 *"다행히도 미로 구조가 계속 바뀌는 건 아닌 거 같습니다"*
가 깨진다. 그래서 미로의 시드는 **반영된 규칙 목록에서만** 파생된다.
방명록이 그대로면 미로도 그대로고, 새 규칙이 반영되는 순간에만 바뀐다
(`world.js` 의 시드는 반영된 규칙 id 목록의 해시다. 단, `maze.shifting` 규칙이 반영되면 플레이 도중 구조가 바뀐다).

### 원작의 판정 규칙이 그대로 시스템 스펙이다

| 원작 | 구현 |
|---|---|
| "입구 쪽에서 쓴 내용은 반영 안 되는 것 같습니다" | 클리어한 런 하나당 한 번만 기입 가능 |
| "앞에 있는 내용과 겹치거나 반대되는 내용도 반영이 안 되는 거 같구요" | LLM 이 기존 규칙과 대조해 `duplicate` / `contradiction` 판정 |
| "지 꼴리는 대로 해석해서 적용하는 거 같네요" | 자유 텍스트 → Effect DSL 매핑 (해석 재량은 LLM 에게) |
| "찢거나 낙서 하면 어떻게 됨?" → "그대로임" | 방명록은 append-only. 수정·삭제 API 가 없다 |

### Effect DSL

LLM 이 아무 JSON 이나 뱉으면 엔진이 못 받는다. 그래서 엔진이 아는 효과를
`src/effects.js` 의 `EFFECTS` 표에 한정해 두고(미로 크기·괴물·함정·아이템·출구 조건·자물쇠,
"~하면 ~된다" 규칙 `rule.when`, 임의 물체 `object.spawn` 등 — 목록은 코드가 곧 명세),
이 표에서 설명문을 뽑아 LLM 시스템 프롬프트에 그대로 넣는다 (`catalogForPrompt()`).
표에 없는 현상은 프롬프트가 **물체 + 묘사**(`object.spawn` + `desc`)로 번역하라고 시키고,
장소도 대상도 없는 순수한 분위기만 `flavor.text` 로 보낸다.
원작의 "TV 에 매드무비가 틀어져 있다" 같은 것들이 여기로 간다.

```js
{ type: 'maze.size',      value: 21 }
{ type: 'entity.monster', count: 8 }
{ type: 'item.pistol',    value: true }
{ type: 'rule.exit_cost', cost: 'random_body_part' }
{ type: 'rule.no_pain',   value: true }
{ type: 'flavor.text',    text: '벽 어딘가에 누군가 칼로 눈금을 새겨 놓았다.' }
```

규칙은 시간순으로 `foldEffects()` 에 접힌다. 나중 규칙이 같은 항목을 덮어쓰는 단순한 구조라
(예: `entity.monster` 는 "현재 수"를 다시 정한다) 프롬프트에 현재 월드 상태를 같이 준다.
모델이 뱉은 JSON 은 항상 `sanitize()` 를 지난다 — 모르는 타입은 사라지고, 한 글에서 최대 8개만 받는다.
값 범위는 각 효과의 `apply` 가 자른다 (`maze.size: 9999` → `41`). 효과가 하나도 안 남으면
`applied` 는 `flavor_only` 로 내려간다.

### 판정 결과

`compileEntry()` 가 내는 판정은 다섯 가지다. 이 값은 DB 에 `entries.verdict` 로 남고,
세계에는 `applied` 만 반영된다 (`appliedRules` 쿼리).

| verdict | 의미 |
|---|---|
| `applied` | 규칙으로 반영 |
| `duplicate` / `contradiction` | 앞 글과 겹침 / 반대됨 → 반영 안 됨 |
| `flavor_only` | 요구가 없는 감상·잡담 (LLM 호출이 실패하거나 공급자가 미설정일 때도 이 값) |
| `swallowed` | 실명·신상·괴롭힘·혐오 표현으로 판정 → 반영 안 됨. 응답은 에러가 아니라 **게임 안의 목소리**로 돌려준다 |

> 쓰자마자 글자가 종이 속으로 가라앉아 사라졌다.

---

## 아키텍처

```
브라우저 (public/)                          Cloudflare Worker (src/worker.js)
 레이캐스팅 엔진 · UI  ── fetch /api/* ──>   app.js  요청 처리 (Request → Response)
                                               │  ├─ auth.js / link.js   세션 쿠키 · (선택) 디스코드 링크 표 검증
                                               │  ├─ compiler.js ──> llm.js ──> Gemini / OpenAI 호환 / Anthropic
                                               │  │      └─ effects.js   Effect DSL 검증·접기
                                               │  ├─ world.js    규칙 목록 → 결정론적 월드
                                               │  └─ assets.js   물체 모습: 캐시 → 태그 매칭 → 이미지 생성
                                               ▼
                                   D1 (SQL)  ·  KV (생성 이미지)  ·  Static Assets (public/)
```

| 위치 | 역할 |
|---|---|
| `src/effects.js` | Effect DSL 정의·검증·누적. 엔진이 아는 것의 전부이자 LLM 프롬프트의 카탈로그 원본 |
| `src/compiler.js` | 방명록 글 → 판정 + Effect. **여기서만 LLM 을 부른다** |
| `src/llm.js` | 공급자 어댑터 (gemini / openai / anthropic). 시스템 프롬프트 + 글을 주고 JSON 하나를 받는다 |
| `src/world.js` | 반영된 규칙 목록 → 미로·물체·아이템. 시드는 규칙 id 에서만 나온다 |
| `src/app.js` | HTTP 라우팅: 입장, 방명록 읽기/쓰기(잠금·판정·저장), 런 시작/클리어/사망, 자물쇠, 관리자 초기화, `/obj`, `/healthz` |
| `src/worker.js` | 워커 입구. D1·KV 를 저장소 인터페이스로 연결하고, API 가 아닌 경로는 정적 파일로 넘긴다 |
| `src/db.js` `queries.js` `store.js` | 쿼리 모음을 저장소에 연결. 운영은 `d1Store`(D1), 테스트는 `nodeStore`(better-sqlite3 메모리 DB, 같은 `migrations/` 실행) |
| `src/assets.js` | 방명록 물체의 모습 확보. 캐시 → 태그 매칭 → 이미지 생성(일일 한도) → 이모지 |
| `src/runs.js` | 연속 입장 제한(5분), 몸 상태 |
| `src/auth.js` `link.js` | HMAC 서명 세션 쿠키, (선택) 디스코드 봇 링크 표 검증 |
| `public/` | 의존성 없는 클라이언트. `game.js` 레이캐스팅 엔진·전투/조우, `ui.js` 화면 연결, `textures.js` `uncanny.js` 텍스처와 이미지 가공, `rules.js` 규칙 엔진, `body.js` 신체 부위 |
| `migrations/` | D1 스키마 (`users` `runs` `entries` `assets` `locks` `room`). 방명록(`entries`)은 append-only |
| `scripts/tag-assets.js` | 라이브러리 이미지 태그 초안 생성 (LLM 호출 없음) |
| `test/` | 외부 호출 없는 테스트 7개 묶음 |
| `docs/superpowers/` | 설계 문서와 구현 계획 (개발 과정 기록) |

**저장소 역할.** D1 에는 사람·플레이 기록·방명록(판정과 Effect 포함)·물체 모습 목록(`assets`)·
방명록 잠금·방이 기억하는 값(자물쇠 번호)이 들어간다. KV(`IMAGES`)에는 생성한 이미지 바이너리만 있고
`/obj/<해시>.<확장자>` 로 서빙된다. `public/` 은 Static Assets 다.

## LLM 공급자 설정

호출은 **방명록에 글이 적힐 때 한 번**뿐이다 (`compileEntry` → `judge`). 공급자는
`src/llm.js` 의 `PROVIDERS` 에 있고, 전환은 코드 수정 없이 환경변수만으로 한다.

| `LLM_PROVIDER` | 필요한 값 | 선택 값 (기본값) | 비고 |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | `GEMINI_MODEL` (`gemini-3.6-flash`), `GEMINI_BASE_URL` | [AI Studio](https://aistudio.google.com/apikey) 무료 한도. 기본값 |
| `openai` | `OPENAI_API_KEY` (키 없는 로컬 서버면 생략 가능) | `OPENAI_BASE_URL` (Groq), `OPENAI_MODEL` (`llama-3.3-70b-versatile`), `OPENAI_JSON_MODE` (`0` 이면 JSON 모드를 쓰지 않음) | OpenAI 호환 `/chat/completions` 면 전부 붙는다 |
| `anthropic` | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` (`claude-sonnet-5`) | 유료 |

- `LLM_PROVIDER` 를 비우면 위 순서(gemini → openai → anthropic)로 **키가 채워진 첫 공급자**를 쓴다.
  이름이 있는데 모르는 값이면 에러다.
- 키는 `npx wrangler secret put <이름>`, 비밀이 아닌 값(`LLM_PROVIDER`, `*_MODEL`, `OPENAI_BASE_URL`)은
  `wrangler.jsonc` 의 `vars` 에 넣는다. 로컬은 `.dev.vars`.
- 요청마다 30초 타임아웃이 있다. 공급자가 미설정이거나 호출이 실패하면 글은 그대로 남고
  `flavor_only`(세계는 안 바뀜)로 기록된다 — 나중에 다시 판정하는 기능은 없다.
- `openai` 에서 JSON 모드(`response_format`)를 모르는 엔드포인트가 400 을 주면 한 번 빼고 다시 보낸다.

`openai` 로 붙일 만한 곳:

```
Groq        OPENAI_BASE_URL=https://api.groq.com/openai/v1   OPENAI_MODEL=llama-3.3-70b-versatile
OpenRouter  OPENAI_BASE_URL=https://openrouter.ai/api/v1     OPENAI_MODEL=<...:free>
Ollama      OPENAI_BASE_URL=http://localhost:11434/v1        OPENAI_MODEL=llama3.1   (키 불필요)
```

모델 이름은 수시로 바뀐다. 구글은 옛 모델을 내리는데, 그때 돌아오는 404 가
후속 모델 이름을 직접 알려주므로 `GEMINI_MODEL` 에 그 이름을 넣으면 된다.
지금 쓸 수 있는 목록은 이렇게 확인한다.

```bash
curl -H "x-goog-api-key: $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models
```

모델이 작을수록 판정이 헐거워진다. 특히 **겹침·밀려남 판정과 저격·신상 차단은 모델 성능에 직접 걸린다**
("보안과 한계" 참고). 무료 모델로 바꿨다면 서버에 올리기 전에 실제로 몇 줄 적어 보고
판정을 눈으로 확인할 것 — `npm test` 는 실제 모델을 부르지 않는다.

### 그 밖의 환경변수

| 이름 | 종류 | 설명 |
|---|---|---|
| `SESSION_SECRET` | secret, **필수** | 세션 쿠키 서명 키. 비어 있거나 예시값(`change-me-to-something-random`)이면 서버가 에러를 낸다 (기본값으로 때우지 않는다). `openssl rand -hex 32` 등으로 만든다 |
| `MARI_LINK_SECRET` | secret, 선택 | 디스코드 봇 링크 표·관리자 초기화 표의 HMAC 키. 비어 있으면 그 표는 전부 거절된다 |
| `IMAGE_PROVIDER` | var | `gemini`(기본) / `pollinations` / `none`. 아래 "방명록 물체의 모습" |
| `IMAGE_MODEL`, `IMAGE_DAILY_LIMIT` | var | 이미지 모델, 하루 Gemini 생성 장수 (기본 5) |
| `POLLINATIONS_API_KEY` | secret, 선택 | Pollinations 폴백용 |
| `DEV_NO_AUTH` | 로컬 전용 | `1` 이면 모든 요청이 같은 "테스트 플레이어"가 되고 연속 입장 제한도 꺼진다. **배포 환경에는 설정하지 말 것** |

## 방명록 물체의 모습

"웃는 가면이 걸려 있었으면" 처럼 물체가 적히면, 판정이 `object.spawn` 으로 옮기고
서버가 그 모습을 확보한 뒤 응답한다 (워커는 응답 뒤의 일을 30초 안에 끊는다).

1. 같은 물체를 이미 봤으면 그대로 쓴다
2. `public/lib/`(저장소에는 비어 있음) 와 전에 만든 것들 중 태그가 절반 이상 겹치면 그걸 쓴다
3. 없으면 만든다 — Gemini (하루 `IMAGE_DAILY_LIMIT` 장) → 넘으면 Pollinations
4. 그래도 안 되면 화면에는 이모지가 대신 선다

토큰은 판정 한 번에 오브젝트당 30~40 토큰이 늘어나는 정도다 (기존 대비 약 5%).
실제 비용은 이미지 생성 횟수가 정한다.

| `IMAGE_PROVIDER` | 비용 | 비고 |
|---|---|---|
| `gemini` | 장당 약 $0.034 (`gemini-3.1-flash-lite-image`, 1K). **무료 한도 없음** | `GEMINI_API_KEY` 를 같이 쓴다. 한도 5장이면 하루 최대 약 $0.17 (약 230원) |
| `pollinations` | 키 필요 (`POLLINATIONS_API_KEY`) | 익명 사용이 막혔다. 키가 없으면 건너뛴다 |
| `none` | 0 | 만들지 않는다. 라이브러리 매칭과 이모지만 |

(2026-09 기준 가격. 바뀔 수 있으니 [Gemini 가격표](https://ai.google.dev/gemini-api/docs/pricing) 를 확인할 것.)

라이브러리에 에셋을 넣으려면 `public/lib/` 에 파일을 넣고 `npm run tag-assets`
후 `assets/library.json` 의 태그를 다듬고 다시 배포한다. 기괴하고 불쾌한 것 위주로 고를 것.
생성한 이미지는 KV(`IMAGES`)에 쌓인다. 어떤 물체의 모습을 다시 만들고 싶으면
`npx wrangler d1 execute napolitan --remote --command "DELETE FROM assets WHERE key='그 이름'"`
하면 다음에 그 물체가 적힐 때 다시 만든다.

---

## 로컬 실행

Node.js 20 이상이 필요하다. Cloudflare 계정·API 키 없이 돌아간다 (`wrangler dev` 가 D1·KV 를 로컬에서 흉내 낸다).
`wrangler.jsonc` 의 `YOUR_D1_DATABASE_ID` / `YOUR_KV_NAMESPACE_ID` 는 **로컬에서는 그대로 둬도 된다.**

```bash
npm install
cp .dev.vars.example .dev.vars   # 아래 최소 설정으로 채운다
npm run db:local    # 로컬 D1 에 표를 만든다 (처음 한 번)
npm run seed        # 원작 방명록 16줄 (선택, 이미 한 줄이라도 있으면 아무것도 안 넣는다)
npm run dev         # http://localhost:8787  (wrangler dev)
```

`.dev.vars` 는 git 에 안 올라간다. 최소한 이 정도면 된다.

```
SESSION_SECRET=local-dev-any-string   # 필수. 비우면 /api 가 500
DEV_NO_AUTH=1          # 다들 같은 계정("테스트 플레이어")으로. 마리 링크도 손님도 필요 없다
GEMINI_API_KEY=...     # 없으면 글은 적히지만 세계가 바뀌지 않는다
IMAGE_PROVIDER=none    # 로컬에서 이미지 과금을 막는다
```

`DEV_NO_AUTH` 를 안 켜도 아무나 그냥 들어온다 — 링크는 필수가 아니다.
차이는 이렇다: `DEV_NO_AUTH=1` 은 브라우저가 몇 개든 전부 **같은** 계정이
되고(연속 입장 금지 같은 걸 혼자 테스트할 때 편하다), 꺼두면 브라우저마다
**서로 다른** 손님이 된다(여러 사람이 동시에 테스트할 때 이쪽이 맞다).

## 배포 (내 방 만들기)

Cloudflare 계정만 있으면 된다 (무료 플랜, 카드 등록 불필요).
**저장소의 `wrangler.jsonc` 에는 실제 계정 값이 없고 `YOUR_*` 자리표시자만 있다.**
본인 계정에서 `wrangler` 로 만든 리소스 ID 를 직접 넣어야 배포된다.

```bash
# 1. fork / clone 후
npm install
npx wrangler login

# 2. 내 계정에 저장소를 만든다 — 출력되는 id 를 wrangler.jsonc 에 붙여 넣는다
npx wrangler d1 create napolitan                  # → database_id (npm 스크립트와 맞추려고 이름은 napolitan 유지)
npx wrangler kv namespace create IMAGES           # → id

# 3. wrangler.jsonc 의 YOUR_D1_DATABASE_ID / YOUR_KV_NAMESPACE_ID 를 위 값으로 교체
#    (fork 를 공개로 둘 거라면 실제 ID 를 커밋하지 않도록 주의)

# 4. 비밀값 등록
npx wrangler secret put SESSION_SECRET            # 아무 긴 랜덤 문자열 (필수)
npx wrangler secret put GEMINI_API_KEY            # 다른 공급자를 쓰면 위 "LLM 공급자 설정" 참고

# 5. 표 만들고 배포
npm run db:init                                   # 원격 D1 에 표를 만든다 (처음 한 번, 스키마가 바뀔 때마다)
npm run deploy                                    # https://napolitan.<내 계정>.workers.dev
```

공급자 선택·모델 등 비밀이 아닌 설정은 `wrangler.jsonc` 의 `vars` 에 있다
(기본값 `LLM_PROVIDER=gemini`, `IMAGE_PROVIDER=gemini`, `IMAGE_DAILY_LIMIT=5`).
`/healthz` 가 `{"ok":true}` 를 주면 워커가 떴다.
무료 플랜은 요청당 CPU 10ms 다. 월드 생성은 1~2ms 라 여유가 있다
(LLM·이미지 응답을 기다리는 시간은 CPU 에 들어가지 않는다).

## 접근 방식

**주소만 있으면 누구나 들어온다.** 처음 오면 곧장 손님으로 입장하고,
쿠키가 그 사람의 신분증이 된다 — 디스코드도, 링크도 필요 없다.
특정 공동체만 들이고 싶으면 주소를 그 안에서만 공유하거나, 아래 연동을 쓴다.

## 디스코드 연동 (선택)

이 게임은 원래 한 디스코드 서버의 봇 "마리"(`mari/cogs/minigame.py`)가 주는
링크로 들어오게 만들어졌다. **다른 사용자는 이걸 몰라도 된다.** 쓰고 싶다면:

1. 봇이 `{주소}/enter?u=<표>` 링크를 만든다. 표 형식은 `src/link.js` 맨 위 주석에 있다
   (`base64url(JSON) + "." + base64url(HMAC_SHA256(본문, 열쇠))`, JSON 은 `{id, n, e}`).
2. 봇의 열쇠와 같은 값을 `npx wrangler secret put MARI_LINK_SECRET` 으로 넣는다.
3. 이 링크로 들어온 사람은 손님이 아니라 그 디스코드 신분(이름)으로 입장한다.
   손님 입장도 그대로 되고, 방명록은 하나를 같이 쓴다.

마리를 쓰는 서버라면 `/미니게임 설정 게임:돌이킬 수 없는 주소:https://napolitan.<계정>.workers.dev`
하면 `/미니게임 목록` 이 링크를 준다. 서버 밖 사람을 막고 싶으면 `src/app.js` 의
`handle()` 에서 손님을 만드는 자리(`guestUser()` 호출)를 지우고 `enter()` 로만
들어오게 되돌린다.

무료 플랜은 요청당 CPU 10ms 다. 월드 생성은 1~2ms 라 여유가 있다
(LLM·이미지 응답을 기다리는 시간은 CPU 에 들어가지 않는다).

---

## 테스트

```bash
npm install && npm test
```

외부 네트워크·API 키·Cloudflare 계정 없이 돈다. D1 은 같은 `migrations/` 를 실행한 메모리
SQLite(better-sqlite3)로, LLM·이미지 API 는 `fetch` 가로채기로 대신한다. 7개 파일을 차례로 실행하고
하나라도 실패하면 종료 코드가 0 이 아니다 (GitHub Actions 가 PR·푸시마다 같은 명령을 돌린다).

| 파일 | 확인하는 것 |
|---|---|
| `test/store.js` | 저장소 계층: RETURNING, 없는 행은 null, 스키마의 몸·사망 좌표·에셋 종류 칸, 반영된 규칙만 id 순으로 |
| `test/replay.js` | 원작 방명록을 순서대로 먹여 월드가 맞게 변하는지, **같은 방명록이면 같은 미로**인지, 출구까지 길이 있는지 (기준 미로 `fixtures/replay-final.json`) |
| `test/compiler.js` | LLM 어댑터 3종의 요청 모양과 응답 파싱, 코드블록·잡설이 낀 JSON, 모르는 Effect 걸러내기, 기각된 글이 세계를 못 바꾸는지, 제공자 선택 규칙 |
| `test/assets.js` | 물체 모습 해석: 태그 매칭 경계값, 캐시, 일일 한도와 폴백, 동시 요청 시 1회 생성, 실패 기록 규칙, 생성기 응답 파싱(키는 헤더로만), 너무 작거나 5MB 넘는 이미지 거부 |
| `test/client.js` | 브라우저 코드 중 DOM 없는 순수 함수: 길찾기, 규칙 엔진, 기하, 텍스처, 조우·전투, 신체 부위 |
| `test/server.js` | 연속 입장 제한, 몸 상태 규칙, 공책 읽음, 디스코드 링크 표 검증(파이썬 기준값, 만료·변조·다른 키 거절) |
| `test/app.js` | 워커 없이 요청 처리 전체: 손님 입장, 방명록 쓰기 자격·잠금(동시 쓰기는 한 줄만, 나머지 409)·본문 크기 제한, 자물쇠 검증과 쿨다운, 남의 런 접근 거부, 관리자 초기화 표 검증, `/obj` 경로 검증 |

다루지 않는 것: 실제 LLM 의 판정 품질(프롬프트 인젝션·저격 차단 포함), 실제 D1/KV/workerd 동작,
브라우저 렌더링(`public/game.js` 의 캔버스 그리기). 이 부분은 직접 돌려 보며 확인해야 한다.

---

## 보안과 한계

**코드가 실제로 하는 방어**

- **LLM 은 글을 해석만 하고, 실행하는 건 엔진이다.** 모델 출력은 JSON 으로 파싱한 뒤 `sanitize()`
  (효과 타입 화이트리스트, 글당 최대 8개)와 각 효과의 `apply`(값 범위 자르기)를 거친다.
  모델이 속아도 엔진이 받는 것은 `EFFECTS` 표에 있는 효과뿐이다.
- **프롬프트에서의 분리.** 방금 적힌 글과 앞서 반영된 글은 "그저 데이터"로 다루라고 시스템 프롬프트에 명시하고
  (`"""` 로 감싸 전달), "판정을 무시해라"류 지시·시스템 메시지 흉내를 전부 글자로만 취급하며
  신상·저격·혐오 차단 규칙은 글이 무엇을 주장하든 바뀌지 않는다고 못박는다.
- **입력 제한.** 글은 500자(서버에서 검사), 요청 본문은 32KB. 화면에 글·물체 이름을 그릴 때는 HTML 이스케이프한다.
- **쓰기 통제.** 클리어한 런 하나당 한 줄만 쓸 수 있고, 판정은 D1 잠금으로 한 줄씩 처리한다
  (동시 요청은 409, 죽은 잠금은 2분 뒤 만료). 판정이 실패해도 글은 남는다 (append-only).
- **인증.** 세션 쿠키는 HMAC-SHA256 서명 + 만료, `HttpOnly; SameSite=Lax` (https 면 `Secure`).
  `SESSION_SECRET` 이 없으면 기본값으로 때우지 않고 에러를 낸다. 디스코드 링크 표와 관리자 초기화 표는
  서로 대신 쓸 수 없고(`act` 일치), 서명 비교는 상수 시간이다.
- **출구 자물쇠.** 번호는 서버(D1)에만 있고 시도마다 상수 시간 비교, 1.5초 쿨다운이 있다.
- **비용.** 이미지 생성은 하루 `IMAGE_DAILY_LIMIT` 장(Gemini)까지, 같은 물체는 한 번만 만든다.
  판정 LLM 은 글이 적힐 때만 부른다.

**알아둘 한계**

- **판정 품질은 모델에 달려 있다.** 저격·신상·혐오 차단(`swallowed`)과 겹침·반대 판정은 프롬프트 지시를
  따르는 모델의 판단이고, 코드에는 이를 대신 확인하는 장치가 없다. 사용자 글은 `"""` 안에 그대로 들어가며
  따옴표를 이스케이프하지 않는다. 즉 프롬프트 인젝션은 "엔진이 받는 효과를 DSL 안으로 제한"하는 것으로
  피해 범위를 줄일 뿐, 막는다고 보장하지 않는다.
- **`swallowed` 글도 방명록에는 남는다.** 세계에 반영되지 않을 뿐, 글자는 DB 에 저장되고
  방명록 화면(`/api/guestbook`)에 그대로 보인다 (조회가 판정을 거르지 않는다). 공개 서비스로 열려면
  이 조회에서 걸러낼지 정해야 한다.
- **손님은 쿠키 하나로 만들어진다.** 쿠키를 버리면 새 사람이 되므로 연속 입장 제한이 사실상 협조 기반이고,
  클리어는 클라이언트가 보고하는 값이라(입장 후 2초 미만만 거부) 직접 API 를 두드려 방명록 쓸 자격을 얻을 수 있다.
  친목 서버 규모를 전제로 했다. 불특정 다수에게 열려면 별도의 남용 방지(속도 제한, 계정 검증)가 필요하다.
- **되돌릴 수 없다.** 반영된 규칙을 취소하는 기능은 일부러 넣지 않았다. 원작이 그렇다. 정말 되돌려야 하면
  D1 에서 해당 `entries` 행의 `verdict` 를 `applied` 가 아닌 값으로 바꾸면 된다
  (`npx wrangler d1 execute napolitan --remote --command "UPDATE entries SET verdict='swallowed' WHERE id=…"`).
  전체 초기화는 관리자 표(`POST /api/admin/reset`, 글·기록·몸 상태·자물쇠 번호를 지우고 사람과 이미지는 남김)로 하거나 D1 Time Travel 로 복구한다.
- **판정에 실패한 글은 재판정되지 않는다** (`flavor_only` 로 남음). 공급자 장애가 길면 그 사이의 글은 세계에 반영되지 않는다.

---

## 조작

조작키는 없다. 화면에 뜨는 선택지를 고르면 한 턴이 지나간다.
숫자키 `1`~`9` 로도 고를 수 있다.

위쪽 1인칭 화면은 **지금 서 있는 자리에서 보이는 것**을 그린 배경이다.
조작하는 화면이 아니라 읽는 동안 보는 화면이다.

| 선택 | |
|---|---|
| 앞으로 나아간다 | 한 칸 이동. 함정이 있으면 여기서 밟는다 |
| 왼쪽 / 오른쪽으로 돈다, 뒤돌아선다 | **턴을 쓰지 않는다.** 둘러보는 데 대가를 물리면 아무도 둘러보지 않는다 |
| 줍는다 / 시체를 챙긴다 | 발밑에 있을 때만 뜬다 |
| 총을 쏜다 / 칼로 벤다 | 바라보는 방향에 그것이 있을 때만 뜬다 |
| 시체를 던진다 | 괴물이 그쪽으로 몰린다 |
| 문을 연다 | 출구 칸에서만 뜬다 |

턴을 쓰는 선택을 하면 괴물도 한 칸 움직인다. 돌아보기만 하는 동안에는
아무 일도 일어나지 않으니, 움직이기 전에 주위를 살피는 편이 낫다.

## 기여 / 브랜치 흐름

`작업 브랜치` → `develop` → `main`. 작업은 `develop` 에서 작업마다 새 브랜치를 따서 하고
`develop` 으로 PR 한다. 머지된 브랜치는 지운다. `develop` 에서 `npm test` 로 확인한 뒤 이상 없으면 `main` 으로 올린다.
`main` 에는 직접 푸시하지 않는다. 자세한 규칙은 [CLAUDE.md](CLAUDE.md).

## 라이선스와 출처

- 코드: [MIT](LICENSE)
- 원작 괴담 [「돌이킬 수 없는」](https://gall.dcinside.com/mgallery/board/view/?id=napolitan&no=23461)의
  저작권은 원작자에게 있다. 이 저장소는 그 설정을 게임으로 옮긴 2차 창작이며,
  `test/` 의 원작 방명록 예시는 테스트 용도다.
- `public/tex/` 텍스처: ambientCG CC0 ([출처 표](public/tex/LICENSE.md))
- `fresh-assets/` 의 이미지는 AI 이미지 생성(Gemini)으로 만든 물체 에셋이다.
  직접 쓰려면 사용 중인 생성 서비스의 약관을 확인할 것.
- 게임이 런타임에 만드는 이미지와 방명록 글은 각 배포자의 책임이다.
