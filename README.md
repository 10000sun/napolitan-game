# 돌이킬 수 없는

나폴리탄 괴담 [「이거 뭐임」](https://gall.dcinside.com/mgallery/board/view/?id=napolitan&no=23461)
을 게임으로 옮긴 것. 디스코드 서버 한 곳에서 돌려 쓰는 용도다.

방에서 빠져나온 사람만 방명록에 한 줄을 남길 수 있고,
**거기 적힌 것이 다음 사람의 방에 그대로 일어난다.**

처음에는 아무것도 없는 빈 공간에 문 하나뿐이다.
누군가 "미로 같은 게 있으면 좋겠다"고 적으면, 다음 사람부터는 미로를 걷는다.

---

## 어떻게 돌아가는가

핵심은 **AI 를 플레이할 때가 아니라 방명록을 쓸 때 부른다**는 것이다.

```
방명록 기입 ──> [LLM 판정·컴파일] ──> Effect JSON 을 DB 에 누적
                                              │
플레이 시작 ──> 누적된 Effect 를 전부 접어서 월드 생성 (LLM 호출 0회, 즉시 입장)
```

플레이마다 LLM 을 부르면 입장이 느려지고, 무엇보다 같은 방명록인데 사람마다
다른 미로가 나와서 원작의 *"다행히도 미로 구조가 계속 바뀌는 건 아닌 거 같습니다"*
가 깨진다. 그래서 미로의 시드는 **반영된 규칙 목록에서만** 파생된다.
방명록이 그대로면 미로도 그대로고, 새 규칙이 반영되는 순간에만 바뀐다.

### 원작의 판정 규칙이 그대로 시스템 스펙이다

| 원작 | 구현 |
|---|---|
| "입구 쪽에서 쓴 내용은 반영 안 되는 것 같습니다" | 클리어한 런 하나당 한 번만 기입 가능 |
| "앞에 있는 내용과 겹치거나 반대되는 내용도 반영이 안 되는 거 같구요" | LLM 이 기존 규칙과 대조해 `duplicate` / `contradiction` 판정 |
| "지 꼴리는 대로 해석해서 적용하는 거 같네요" | 자유 텍스트 → Effect DSL 매핑 (해석 재량은 LLM 에게) |
| "찢거나 낙서 하면 어떻게 됨?" → "그대로임" | 방명록은 append-only. 수정·삭제 API 가 없다 |

### Effect DSL

LLM 이 아무 JSON 이나 뱉으면 엔진이 못 받는다. 그래서 엔진이 아는 효과를
`src/effects.js` 에 한정해 두고, 거기 안 맞는 소원은 전부 `flavor.text` 로
떨어뜨린다 — 그러면 그 내용은 미로 안의 **묘사**로만 존재하게 된다.
원작의 "TV 에 매드무비가 틀어져 있다" 같은 것들이 여기로 간다.

```js
{ type: 'maze.size',      value: 21 }
{ type: 'entity.monster', count: 8 }
{ type: 'item.pistol',    value: true }
{ type: 'rule.exit_cost', cost: 'random_body_part' }
{ type: 'rule.no_pain',   value: true }
{ type: 'flavor.text',    text: '벽 어딘가에 누군가 칼로 눈금을 새겨 놓았다.' }
```

LLM 출력은 **반드시** `sanitize()` 를 통과한다. 모르는 타입은 조용히 사라지고,
범위를 벗어난 값은 잘린다 (`maze.size: 9999` → `41`).

### 서버원 100명짜리 서버를 위한 안전장치

원작에서는 "이병철 신상 책자"가 재미 포인트지만, 실제 디스코드에서는 특정
서버원 저격·신상·혐오 표현이 그대로 박제된다. 컴파일러가 이런 글을 `swallowed`
로 판정하되, 에러 메시지가 아니라 **게임 안의 목소리**로 돌려준다.

> 쓰자마자 글자가 종이 속으로 가라앉아 사라졌다.

---

## 실행

Node.js 20 이상이 필요하다. 없으면 <https://nodejs.org> 에서 LTS 를 설치하고
**터미널을 새로 연다** (기존 창은 PATH 가 갱신되지 않는다).

```bash
npm install
cp .env.example .env    # 윈도우: copy .env.example .env
npm start               # http://localhost:3000
```

설정은 전부 `.env` 파일로 읽는다. 셸에 환경변수를 붙이는 방식
(`DEV_NO_AUTH=1 npm start`) 은 리눅스·macOS 에서만 동작하니,
운영체제와 무관하게 `.env` 를 고치는 쪽을 쓰는 게 좋다.

`.env` 에 최소한 이것들이 필요하다.

| 변수 | 설명 |
|---|---|
| `LLM_PROVIDER` | `gemini` / `openai` / `anthropic`. 비워 두면 채워진 키를 보고 고른다 |
| (제공자별 키) | 아래 표 참고. 없으면 글은 적히지만 세계가 바뀌지 않는다 |
| `DISCORD_CLIENT_ID` / `_SECRET` | [디스코드 개발자 포털](https://discord.com/developers/applications) > OAuth2 |
| `DISCORD_GUILD_ID` | 이 서버의 멤버만 입장시킨다. 비우면 로그인한 아무나 들어온다 |
| `BASE_URL` | 배포 주소. OAuth2 Redirect 에 `{BASE_URL}/auth/callback` 을 등록할 것 |
| `SESSION_SECRET` | 세션 쿠키 서명용 랜덤 문자열 |

### 판정을 어디에 맡길지

호출은 **방명록에 글이 적힐 때 한 번**뿐이다. 하루 수십 줄이 적혀도 어지간한
무료 한도 안에 들어간다. `src/llm.js` 의 어댑터를 갈아끼우는 것으로 제공자를
바꾼다.

| `LLM_PROVIDER` | 키 | 어디서 | 비고 |
|---|---|---|---|
| `gemini` | `GEMINI_API_KEY` | [AI Studio](https://aistudio.google.com/apikey) | 무료 한도가 넉넉하다. 기본값 |
| `openai` | `OPENAI_API_KEY` + `OPENAI_BASE_URL` | Groq / OpenRouter / Ollama … | OpenAI 호환이면 전부 붙는다 |
| `anthropic` | `ANTHROPIC_API_KEY` | [console](https://console.anthropic.com) | 유료 |

`openai` 로 붙일 만한 곳:

```
Groq        OPENAI_BASE_URL=https://api.groq.com/openai/v1   OPENAI_MODEL=llama-3.3-70b-versatile
OpenRouter  OPENAI_BASE_URL=https://openrouter.ai/api/v1     OPENAI_MODEL=<...:free>
Ollama      OPENAI_BASE_URL=http://localhost:11434/v1        OPENAI_MODEL=llama3.1   (키 불필요)
```

모델이 작을수록 판정이 헐거워진다. 특히 **겹침·밀려남 판정과 저격·신상
차단은 모델 성능에 직접 걸린다.** 무료 모델로 바꿨다면 서버에 올리기 전에
`test/` 대신 실제로 몇 줄 적어 보고 판정을 눈으로 확인할 것.

어느 제공자를 쓰든 모델이 뱉은 JSON 은 `effects.js` 의 `sanitize()` 를 반드시
통과한다. 모르는 타입은 사라지고 범위를 벗어난 값은 잘리므로, 모델이 헛소리를
해도 엔진이 받는 것은 항상 정해진 Effect 뿐이다.

### 방명록 물체의 모습

"웃는 가면이 걸려 있었으면" 처럼 물체가 적히면, 판정이 `object.spawn` 으로 옮기고
서버가 **뒤에서** 그 모습을 확보한다. 기입 응답은 기다리지 않는다.

1. 같은 물체를 이미 봤으면 그대로 쓴다
2. `assets/library/` 와 전에 만든 것들 중 태그가 절반 이상 겹치면 그걸 쓴다
3. 없으면 만든다 — Gemini (하루 `IMAGE_DAILY_LIMIT` 장) → 넘으면 Pollinations
4. 그래도 안 되면 화면에는 이모지가 대신 선다

토큰은 판정 한 번에 오브젝트당 30~40 토큰이 늘어나는 정도다 (기존 대비 약 5%).
실제 비용은 이미지 생성 횟수가 정한다.

| `IMAGE_PROVIDER` | 비용 | 비고 |
|---|---|---|
| `gemini` | 장당 약 $0.034 (`gemini-3.1-flash-lite-image`, 1K). **무료 한도 없음** | `GEMINI_API_KEY` 를 같이 쓴다. 한도 20장이면 하루 최대 약 $0.7 |
| `pollinations` | 키 필요 (`POLLINATIONS_API_KEY`) | 익명 사용이 막혔다. 키가 없으면 건너뛴다 |
| `none` | 0 | 만들지 않는다. 라이브러리 매칭과 이모지만 |

(2026-09 기준 가격. 바뀔 수 있으니 [Gemini 가격표](https://ai.google.dev/gemini-api/docs/pricing) 를 확인할 것.)

라이브러리에 에셋을 넣으려면 `assets/library/` 에 파일을 넣고 `npm run tag-assets`
후 `assets/library.json` 의 태그를 다듬는다. 기괴하고 불쾌한 것 위주로 고를 것.
생성한 이미지는 `data/assets/` 에 쌓인다. 어떤 물체의 모습을 다시 만들고 싶으면
DB 의 `assets` 테이블에서 그 행을 지우면 다음에 그 물체가 적힐 때 다시 만든다.

### 로그인 없이 돌려보기

`.env` 에서 이 줄만 바꾼다.

```
DEV_NO_AUTH=1
```

그러면 디스코드 로그인 없이 누구나 입장한다. 이어서:

```bash
npm run seed    # 원작 방명록 16줄을 채운다
npm start
```

`npm run seed` 는 원작의 진행(미로 → 괴물 → 권총 → 함정 → 지도 → 신체 부위 →
무적)을 그대로 넣는다. API 키 없이도 "이미 굴러간 방"을 볼 수 있다.
시드와 서버는 `.env` 의 같은 `DB_PATH` 를 본다. 방명록을 비우려면 그 DB 파일을
지우고 다시 `npm run seed` 하면 된다.

### 테스트

```bash
npm test
```

- `test/replay.js` — 원작 방명록을 순서대로 먹여서 월드가 맞게 변하는지, 같은
  방명록이면 같은 미로가 나오는지, 출구까지 길이 있는지 확인한다.
- `test/compiler.js` — LLM 응답을 가로채서 파싱·검증 경로를 확인한다.
  모르는 Effect 가 걸러지는지, 기각된 글이 세계를 못 바꾸는지 등.

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

## 구조

```
src/
  effects.js   Effect DSL 정의·검증·누적. 엔진이 아는 것의 전부
  compiler.js  방명록 글 → 판정 + Effect. 여기서만 LLM 을 부른다
  world.js     규칙 목록 → 결정론적 미로. 시드는 규칙 id 에서만 나온다
  db.js        SQLite. entries 는 append-only
  assets.js    방명록 물체의 모습. 캐시 → 태그 매칭 → 이미지 생성
  auth.js      디스코드 OAuth2 + 길드 멤버십 확인
  server.js    HTTP
public/
  game.js      1인칭 레이캐스팅 엔진 (의존성 없음)
  ui.js        현관 · 방명록 · 게임 화면 연결
  uncanny.js   물체를 "뭔가 틀리게" 그린다. 배경 제거·색 빼기·늘이기
```

## 알아둘 것

- **되돌릴 수 없다.** 반영된 규칙을 취소하는 기능은 일부러 넣지 않았다.
  원작이 그렇다. 정말 되돌려야 하면 DB 에서 해당 `entries` 행의 `verdict` 를
  `applied` 가 아닌 값으로 바꾸면 된다.
- **안티치트는 거의 없다.** 클리어 판정을 클라이언트가 보낸다. 친목 서버용이라
  최소한의 상식 검사(입장 후 2초 이내 클리어 거부)만 둔다.
- **LLM 호출은 방명록 기입 때만** 일어난다. 하루 50줄이 적혀도 비용은 무시할 수준이다.
