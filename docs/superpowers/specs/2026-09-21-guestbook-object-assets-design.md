# 방명록 오브젝트 에셋 — 설계

## 목적

지금은 엔진이 모르는 소원이 전부 `flavor.text`, 즉 글로만 남는다.
방명록에 적힌 **물체**를 미로 안에 눈에 보이게 놓는다. 게임 규칙에는 영향이 없는 구경거리다.
보이는 모습은 기괴하고 불쾌해야 한다 (공포 연출보다 "뭔가 틀린" 쪽).

## 지켜야 할 원칙

- LLM·이미지 생성 호출은 **방명록 기입 시점에만**. 플레이 시작 시 외부 호출 0회.
- 같은 방명록이면 같은 오브젝트가 같은 자리에 놓인다 (시드 결정론 유지).
- 기입 응답은 이미지 생성을 기다리지 않는다.
- LLM 출력은 반드시 `sanitize()` 를 통과한다.

## 토큰·비용 추정 (방명록 1줄 기준)

| 단계 | 추가분 |
|---|---|
| 판정 호출 (기존) | 입력 약 3~4천, 출력 약 150 토큰 |
| `object.spawn` 추가 | 프롬프트 +약 150, 출력 오브젝트당 +약 35 (name·tags·emoji). 기존 대비 약 5% |
| 태그 매칭 | 0 (로컬) |
| 이미지 생성 | 토큰이 아닌 장당 과금. 캐시·매칭 실패 시에만, 하루 `IMAGE_DAILY_LIMIT` 장까지 |

실제 비용은 이미지 생성 횟수가 좌우한다. 단가는 구현 시점에 제공자 문서로 확인해 README 에 적는다.

## 흐름

```
방명록 기입 → compileEntry → effects 에 object.spawn {name, tags, emoji, count}
           → entries 저장 → 응답 즉시 반환
           → (await 없이) 오브젝트마다 resolveAsset(obj)
                1) assets 테이블에 같은 key → 끝
                2) 태그 매칭: library.json + 이미 확보한 에셋 전체, Jaccard ≥ 0.5 → 그 파일 재사용
                3) Gemini 생성 (오늘 gemini 생성 수 < IMAGE_DAILY_LIMIT)
                4) 3 이 한도·실패면 Pollinations 생성
                5) 전부 실패 → status='failed', 클라이언트는 이모지

런 시작 → buildWorld 가 오브젝트 위치 결정 → server 가 assets 조회해 img URL 부착
        → 클라이언트가 이미지 프리로드, 로드 전·실패 시 이모지
```

## 구성 요소

### `src/effects.js`
- 새 Effect `object.spawn { name: string, tags: string, emoji: string, count: number }`.
  - `tags` 는 쉼표로 구분한 **영어** 단어 (라이브러리 파일명·생성 프롬프트가 영어라서).
  - 설명문에 "구체적인 물체·생물이 방 안에 **놓이거나 나타나기를** 바랄 때. 엔진 규칙에 영향 없음" 을 적는다.
    기존 Effect 로 옮겨지는 물체는 그 Effect 만 낸다 (예: "총" → `item.pistol` 만, 오브젝트 아님).
- `apply`: `s.objects` 에 `{ key, name, tags, emoji, count }` 추가. 같은 key 는 덮어쓴다. 최대 30종.
- `initialState()` 에 `objects: []`.
- 정규화 (`normalizeObject`, sanitize 경로에서 호출):
  - `name`: trim, 40자 자름, 비면 버림.
  - `key`: name 을 소문자·공백 축약한 값.
  - `tags`: 소문자, `[a-z0-9 -]` 외 제거, 중복 제거, 최대 6개. 비면 name 이 영어일 때 name 을 태그로.
  - `emoji`: 첫 grapheme 1개 (`Intl.Segmenter`), 없으면 `❔`.
  - `count`: 1~5 로 clamp.

### `src/compiler.js`
- 카탈로그는 자동 반영된다. 시스템 프롬프트 예시 줄에 `object.spawn` 예시 하나만 추가.

### `src/assets.js` (신규, 한 파일)
- `matchTags(tags, candidates)` → `{ entry, score }` (Jaccard). 순수 함수.
- `resolveAsset(obj, { generators, now })` — 위 흐름 1~5. `generators` 는 테스트에서 주입.
- 생성기 어댑터 (`llm.js` 와 같은 모양):
  - `gemini`: `GEMINI_API_KEY`, 모델 `IMAGE_MODEL` (기본 `gemini-2.5-flash-image`). 응답의 inline 이미지 데이터를 저장.
  - `pollinations`: 키 없음. `https://image.pollinations.ai/prompt/{prompt}?width=512&height=512&nologo=true`.
  - 두 기본값은 구현 첫 단계에서 공식 문서로 확인한다.
- 생성 프롬프트 (고정 화풍 + 태그):
  `"{tags}, single object, centered, isolated on plain pure black background, uncanny, subtly wrong proportions, desaturated, grainy found photograph, unsettling, no text"`
- 파일: `data/assets/{sha1(key).slice(0,16)}.png`. 파일명에 사용자 입력이 들어가지 않는다.
- 동시성: 같은 key 에 대한 진행 중 Promise 를 Map 에 두어 중복 생성 방지.

### `src/db.js`
```sql
CREATE TABLE IF NOT EXISTS assets (
  key        TEXT PRIMARY KEY,
  tags       TEXT NOT NULL,           -- 쉼표 구분
  source     TEXT NOT NULL,           -- library | gemini | pollinations | none
  file       TEXT,                    -- library/... 또는 data/assets/... 상대경로
  status     TEXT NOT NULL,           -- ready | failed
  created_at INTEGER NOT NULL
);
```
- 오늘 gemini 생성 수: `source='gemini' AND created_at >= 오늘 0시(로컬)`.
- 매칭 재사용(2번)도 행을 남긴다 (source 는 원본 것, file 동일). 같은 key 재조회가 즉시 끝난다.
- `failed` 는 자동 재시도하지 않는다. 운영자가 행을 지우면 다음에 그 key 가 나올 때 다시 시도.

### 라이브러리
- `assets/library/*.png` + `assets/library.json` (`[{ "file": "slime_green.png", "tags": ["slime","green"] }]`). 처음엔 비어 있음.
- `npm run tag-assets` (`scripts/tag-assets.js`): `library.json` 에 없는 파일을 찾아 파일명에서 태그 초안을 뽑아 추가한다 (`_`, `-`, 숫자 기준 분리). LLM 없음. 사람이 검토·수정.
- 권장: 불쾌·기괴한 에셋 위주로 선별해 넣는다.

### `src/world.js`
- 기존 몬스터·함정·시체 뒤에서 `take(count)` 로 오브젝트 위치 결정. `objects: [{ id, key, name, emoji, x, y }]`.

### `src/server.js`
- 기입 후 `effects` 의 `object.spawn` 마다 `resolveAsset(obj).catch(log)` (await 없음).
- 런 시작 응답에서 `world.objects` 각각에 `img` 부착 (`status='ready'` 면 `/obj/{파일명}`, 아니면 `null`).
- 정적 서빙: `/obj` → `data/assets`, `/lib` → `assets/library`.

### `public/game.js`
- `collectSprites()` 에 `kind: 'object'` (h 0.7, w 0.6, ground).
- 입장 시 `img` 프리로드. 로드 완료 시 오프스크린 캔버스에서 네 모서리 flood-fill 로 검은 배경 제거 (라이브러리 이미지는 `/lib` 이므로 건너뜀). 결과 캔버스를 스프라이트로 사용.
- 그리기: 이미지가 있으면 이미지, 없거나 실패하면 이모지 `fillText`.
- 기괴 보정 (이미지·이모지 공통):
  1. `ctx.filter = grayscale(.7) sepia(.45) contrast(1.3) brightness(fog)`. 미지원 브라우저는 `globalAlpha = fog` 로만.
  2. 세로 늘림: id 해시로 1.15~1.35 고정.
  3. 보이는 오브젝트마다 프레임당 1/400 확률로 한 프레임 좌우 반전.
  4. 시야에서 벗어났다 돌아오면 칸 안에서 ±0.15 위치 이동 (시각만, 칸은 그대로).
- `describe()`: 발밑이면 "`{name}`이(가) 있다.", 앞 칸이면 "앞에 `{name}` 같은 것이 서 있다."

### `.env.example`
```
IMAGE_PROVIDER=gemini        # gemini | pollinations | none
IMAGE_MODEL=gemini-2.5-flash-image
IMAGE_DAILY_LIMIT=20         # 넘으면 그날은 pollinations
```
`.gitignore` 에 `data/` 추가.

## 범위 밖

- 오브젝트 상호작용 (줍기·공격).
- 임베딩 매칭. 키워드 매칭이 부족하다는 게 확인되면 추가.
- 서버 쪽 이미지 가공 의존성 (sharp 등).
- 실패한 생성의 자동 재시도.

## 테스트

- `test/compiler.js`: `object.spawn` 정규화 (name 길이, 태그 정규화·상한, emoji, count clamp, 빈 name 제거).
- `test/assets.js` (신규): 매칭 임계값 경계, 캐시 hit 시 생성기 미호출, 일일 한도 초과 시 pollinations 전환, 전부 실패 시 `failed`, 같은 key 동시 호출 시 생성 1회. 생성기는 가짜 함수 주입, DB 는 임시 파일.
- `test/replay.js`: 같은 방명록 → 같은 오브젝트 위치.
- 배경 제거·기괴 보정은 브라우저로 육안 확인.
