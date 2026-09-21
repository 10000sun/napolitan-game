# 말 그대로 일어나는 방명록 + 백룸 테마 — 설계

선행 설계: `2026-09-21-guestbook-object-assets-design.md` (오브젝트·에셋 파이프라인). 이 문서는 그 위에 얹는다.

## 목적

1. 방명록에 적힌 것은 **황당해도 말 그대로** 방 안에서 마주친다. 모습·위치·행동·문장 중 무엇으로든.
2. 화면이 "물감통 부은" 단색이 아니라 **백룸**처럼 사실적으로 보인다. 누런 벽지, 눅눅한 카펫, 형광등 천장.

## 원칙

- 겹침(`duplicate`)·반대(`contradiction`)·저격/혐오(`swallowed`) 판정은 그대로다. "말 그대로"는 `applied` 된 글을 옮기는 방식에만 적용된다.
- 엔진이 시뮬레이션할 수 없는 세계 규칙("중력이 거꾸로")은 **보이는 것으로 번역**한다 (물체 + 가까이 가면 뜨는 문장).
- 플레이 시점 외부 호출 0회, 같은 방명록이면 같은 방 (기존 원칙 유지).
- 기존 DB 의 방이 바뀌지 않는다 (새 필드는 전부 기본값이 기존 동작).

---

## 1. DSL

### 1.1 `maze.layout` (신규)
`{ value: 'room' | 'maze' }`. `room` 은 내부 벽 없이 탁 트인 공간, `maze` 는 미로.
- `state.layout` 초기값 `null`. 월드는 `layout ?? (mazeSize <= 5 ? 'room' : 'maze')` — 기존 DB 호환.
- `maze.size` 설명문을 "공간의 크기. 넓게·좁게는 이것. 모양은 maze.layout" 으로 바꾼다.

### 1.2 `object.spawn` 확장
```js
{ type: 'object.spawn', name, tags, emoji, count,
  where: 'anywhere' | 'entrance' | 'exit' | 'wall',   // 기본 anywhere
  use:   'none' | 'ranged' | 'melee',                 // 기본 none
  moves: 'still' | 'wander' | 'follow',               // 기본 still
  desc:  string }                                     // 가까이 가면 뜨는 한 문장, 120자, 기본 ''
```
- 모르는 값은 기본값으로. `where: 'wall'` 이면 `use: none`, `moves: still` 로 강제.
- 같은 key 덮어쓰기·30종 상한은 기존대로.

### 1.3 `entity.monster_look` (신규)
`{ name, tags, emoji }`. 괴물의 **모습만** 적힌 대로 바꾼다 ("거대한 거미가 돌아다녔으면" → `entity.monster` + `entity.monster_look`). 행동은 기존 괴물 그대로. 마지막 것이 덮어쓴다.

### 1.4 `surface.look` (신규)
`{ surface: 'wall' | 'floor' | 'ceil' | 'door', name, tags, color }`. 표면의 질감을 바꾼다.
- `color`: `#rrggbb`. 이미지가 없을 때 쓰는 톤. 형식이 틀리면 버린다.
- 표면별로 마지막 것이 덮어쓴다. `state.surfaces = { wall?: {key,name,tags,color}, ... }`.

### 1.5 `flavor.text`
유지. 프롬프트에서 "장소도 대상도 없는 순수 분위기일 때만" 으로 좁힌다.

## 2. 판정 프롬프트 (`compiler.js`)

"효과로 옮기는 법" 절을 바꾼다.
- **말 그대로 원칙**: 황당해도 기각하지 않는다. 기존 Effect 로 되면 Effect, 물건·생물·현상은 `object.spawn`, 적대적 생물은 `entity.monster` + `entity.monster_look`, 표면은 `surface.look`.
- 위치 단서: "벽에/걸려/붙어" → `wall`, "앞에/입구에/들어가자마자" → `entrance`, "출구에/문 앞에" → `exit`.
- 도구 단서: 쏘거나 던지는 것 → `ranged`, 휘두르는 것 → `melee`.
- 행동 단서: "따라온다" → `follow`, "돌아다닌다" → `wander`.
- 현상·규칙은 물체 + `desc` 로. 예시 표를 프롬프트에 넣는다:
  - "TV 에서 매드무비" → 📺 `desc: "TV 에서 매드무비가 끝없이 반복된다"`
  - "고양이가 따라다녔으면" → 🐈 `moves: follow`
  - "중력이 거꾸로" → 거꾸로 매달린 의자 🪑 여러 개, `desc: "천장이 발밑처럼 느껴진다"`
  - "벽에 거꾸로 웃는 노란 가면" → 🙃 `where: wall, count: 5`
  - "넓었으면" (지금 방이면) → `maze.size` + `maze.layout: room`
  - "벽이 살점 같았으면" → `surface.look { surface: wall, tags: "raw flesh, wet, veins", color: "#8a3b3b" }`

## 3. 월드 배치 (`world.js`)

기존 배치(괴물·함정·시체·anywhere 오브젝트, `demandedPart`)의 순서와 `rand()` 호출 순서를 **바꾸지 않는다**. 새 배치는 전부 `demandedPart` 결정 **뒤에** 한다.

- `grid`: `layout === 'room'` 이면 `emptyRoom(size)`.
- 점유 칸 집합 `used` (괴물·함정·시체·anywhere 오브젝트·출구·시작 칸).
- `entrance`: 시작 칸 BFS 거리 오름차순(동률은 y, x 순) 중 `used` 아닌 칸부터.
- `exit`: 출구 칸 BFS 거리 오름차순 중 `used` 아닌 칸부터. 출구가 없으면(`noExit`) anywhere 로.
- `anywhere`: 기존 `take()` 로 (현재와 동일, 기존 위치 불변).
- `wall`: 후보 = (바닥 칸, 방향) 중 그 방향 이웃이 벽. 후보를 `rand()` 로 섞어 앞에서부터. 같은 면에 둘 넣지 않는다.
  출력: `{ x, y }` = **벽 칸**, `face` = 0 동 / 1 남 / 2 서 / 3 북 (벽에서 바닥 쪽을 향하는 방향).
- 사망 시체는 여전히 맨 마지막.
- 반환: `objects[]` 에 `where, use, moves, desc, face?` 추가. `monsterLook`, `surfaces`, `layout` 추가.

## 4. 게임 로직 (`public/game.js`)

- **줍기**: 발밑에 `use !== 'none'` 오브젝트 → "`{name}`을(를) 줍는다". 주우면 사라진다.
  - `ranged`: 원거리 무기 목록에 추가, 탄약 +12. 기존 권총과 탄약을 공유한다. "쏜다" 선택지는 가진 원거리 무기 중 마지막 것의 이름으로 ("활을 쏜다").
  - `melee`: 근접 무기. "벤다" 선택지 문구를 "`{name}`(으)로 내려친다" 로.
  - 위력은 권총·칼과 같다.
- **움직임** (턴을 쓰는 선택 뒤, 괴물 이동과 같은 시점):
  - `wander`: 인접 바닥 칸 중 무작위 하나로 (50% 확률로 제자리).
  - `follow`: 플레이어까지 BFS 최단 경로의 다음 칸으로. 플레이어 칸에는 들어가지 않는다.
  - 해가 없고 길을 막지 않는다.
- **서술 (`describe`)**:
  - 발밑: "`{name}`이(가) 있다." + desc
  - 앞 칸: "앞에 `{name}` 같은 것이 있다." + desc
  - 바라보는 벽면에 벽 오브젝트: "벽에 `{name}`이(가) 걸려 있다." + desc
  - desc 가 있으면 문장 뒤에 그대로 붙인다.

## 5. 렌더링

### 5.1 텍스처 (`public/textures.js` 신규)
- 표면별 텍스처 256×256 을 **입장 시 한 번** 준비해 `Uint8ClampedArray` 픽셀로 보관.
- 우선순위: ① 방명록 `surface.look` 이미지 (`/obj/...`) → ② `assets/textures/{surface}.jpg` (ambientCG CC0) → ③ 절차적 생성.
  - ①② 가 없거나 로드 실패면 ③. ③ 에도 `surface.look.color` 가 있으면 그 톤으로.
- **백룸 톤**: 사진 텍스처에 누런 톤을 곱한다 (벽 `#d8c77a`, 바닥 `#b8a36a`, 천장 `#e6ddb0` 기준). `surface.look` 이미지는 톤을 곱하지 않고 기괴 보정만.
- 절차적 생성 (③):
  - 벽: 누런 바탕 + 세로 줄무늬 벽지 + 저주파 얼룩 + 아래 12% 걸레받이.
  - 바닥: 베이지 카펫 결(고주파 노이즈) + 큰 얼룩.
  - 천장: 2×2 타일 격자 + 틈새 선.
  - 문: 칠 벗겨진 회백색 판 + 손잡이.
  - 노이즈는 시드 고정 value noise (입장마다 같은 모습).

### 5.2 레이캐스터 (`render()`)
- 벽: 광선이 닿은 지점의 가로 위치(wallX)로 텍스처 열 선택, 세로 샘플링.
- 바닥·천장: 행 단위 floor casting. 텍스처 1장 = 격자 1칸.
- **형광등**: 천장 칸 `(x*7 + y*13) % 5 === 0` 에 조명 패널 (천장 텍스처 위에 밝은 사각형). 패널은 안개 영향을 덜 받는다.
- **안개**: 거리에 따라 **누런 회색**(`[58, 52, 34]`)으로 섞인다 (현재는 검게 어두워짐).
- **깜빡임**: 매 프레임 0.4% 확률로 0.1~0.3초 동안 전체 밝기 ×0.55.
- 명암: 벽 `side === 1` 면은 ×0.8.
- **벽 오브젝트 (decal)**: 광선이 벽 칸 `(mapX, mapY)` 의 면 `face` 에 닿았고 그 면에 오브젝트가 있으면, wallX ∈ [0.2, 0.8], 높이 ∈ [0.22, 0.72] 구간에 decal 이미지를 알파 합성. decal 은 로드 시 기괴 보정 필터를 미리 적용한 캔버스에서 픽셀로 뽑아 둔다. 이미지가 없으면 이모지를 128px 캔버스에 그려 같은 방식으로.
  - 면 판정: `side===0 && stepX>0` → 광선이 서쪽 면에 닿음 → face 2. `side===0 && stepX<0` → face 0. `side===1 && stepY>0` → face 3. `side===1 && stepY<0` → face 1.
  - 같은 벽 칸·면에 count 가 여러 개면 가로로 나란히 (wallX 구간을 n 등분).
- **문**: 출구 스프라이트를 문 텍스처로 그린다 (텍스처 캔버스를 `drawImage`). 문 이미지가 절차적이어도 동일.
- **괴물 모습**: `monsterLook.img` 가 있으면 `drawUncanny`, 없고 emoji 만 있으면 이모지, 둘 다 없으면 기존 실루엣.

### 5.3 화면 효과
- 필름 그레인: 매 프레임 픽셀에 ±6 노이즈 (ImageData 단계).
- 비네트: `putImageData` 후 방사형 그라데이션 한 번.

### 5.4 해상도
- 렌더 스케일 기본 1.0 (× `devicePixelRatio` 는 곱하지 않는다). `image-rendering: pixelated` 제거.
- 최근 30프레임 평균이 28ms 를 넘으면 0.75, 다시 넘으면 0.55 로 내린다. 올리지는 않는다 (입장마다 1.0 에서 다시 시작).

## 6. 에셋·서버

- `assets` 테이블에 `kind TEXT NOT NULL DEFAULT 'object'` 추가 (`PRAGMA table_info` 확인 후 ALTER). 값: `object | texture`.
  - 매칭 후보는 같은 kind 끼리만. 라이브러리 JSON 항목도 `kind` (없으면 object).
  - 텍스처 key 는 `tex:{surface}:{objectKey(name)}`.
- 생성 프롬프트: 텍스처는 `"{tags}, seamless tileable texture, flat even lighting, top-down photo, no objects, no text"`. 오브젝트는 기존 STYLE.
- 일일 한도는 kind 구분 없이 합산.
- 기입 후 백그라운드 해석 대상: `object.spawn`, `entity.monster_look`(object), `surface.look`(texture).
- 런 시작 응답: `world.surfaces[s] = { img, color }`, `world.monsterLook = { name, emoji, img }`.
- 정적 경로 `/tex` → `assets/textures`.
- **ambientCG CC0 텍스처**: 벽지·카펫·사무실 천장 타일·문(또는 칠한 나무) 각 1장, 1K JPG 색상 맵만. 구현 시 후보 에셋 이름·URL·크기를 사용자에게 보여 주고 **다운로드 허락을 받은 뒤** `assets/textures/` 에 커밋. `assets/textures/LICENSE.md` 에 출처와 CC0 명시.

## 7. 범위 밖

- 괴물마다 다른 행동, 오브젝트와의 상호작용(대화·조사).
- 조명의 실제 광원 계산 (패널 근처만 밝게 하는 등).
- 텍스처 법선·반사 (색상 맵만).
- 모바일 성능 최적화 (자동 스케일 하향으로 대신).

## 8. 테스트

- `test/compiler.js`: 새 필드 정규화 (where/use/moves 기본값·강제, desc 길이, surface.look color 형식, monster_look).
- `test/replay.js`:
  - layout 없음 → 기존과 같은 grid·배치 (기존 스냅샷 비교: 원작 방명록의 최종 월드 JSON 이 변경 전과 같다).
  - `room` + 15 → 내부 전부 바닥.
  - entrance 오브젝트는 시작 칸 가까이, exit 은 출구 가까이, 서로 다른 칸.
  - wall 오브젝트의 칸은 벽이고 `face` 방향 이웃은 바닥, 같은 면 중복 없음.
  - 같은 방명록이면 새 배치도 같다.
- `test/assets.js`: kind 가 다르면 매칭되지 않는다, 텍스처 프롬프트 사용.
- 순수 함수로 뺄 수 있는 것은 뺀다: `public/textures.js` 의 value noise·톤 곱하기, 면 판정(`faceOf(side, stepX, stepY)`), follow 의 다음 칸 계산 → `node` 로 테스트 (`test/client.js`, DOM 없이 import 되게 작성).
- 브라우저 육안 확인 (창을 띄운 상태): 백룸 질감·형광등·안개·깜빡임, 벽 가면, 활 줍고 쏘기, 따라오는 고양이, 넓은 방, 문 질감, 프레임 하향.
