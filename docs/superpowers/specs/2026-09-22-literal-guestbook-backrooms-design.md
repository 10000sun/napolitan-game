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

---

## 9. 배고픔 제거

- `rule.hunger` Effect 를 DSL 에서 뺀다. 기존 DB 의 `rule.hunger` 규칙은 `sanitize()` 가 모르는 타입으로 조용히 버린다.
- `state.hunger`, `turnsLeft`, HUD 배고픔 표시, 관련 서술을 제거한다.

## 10. 연속 입장 금지

- 서버 전체에서 **가장 최근에 시작된 런이 내 것이면** `/api/run/start` 가 `409` 와 함께 거부한다.
  문구: "문이 열리지 않는다. 다른 누군가가 먼저 들어가야 한다."
- 현관 화면(`/api/me` 또는 로비 데이터)에 `canEnter: false` 를 내려 버튼을 비활성화하고 같은 문구를 보인다.
- `DEV_NO_AUTH=1` 이면 적용하지 않는다 (혼자 테스트 불가).
- 처음 들어가는 사람(런이 하나도 없음)은 들어갈 수 있다.

## 11. 신체 부위

### 11.1 부위 표 (단일 출처: `public/body.js`, 서버도 이 파일을 import)

| 부위 | 치명도(체력 감소) | 효과 key |
|---|---|---|
| 머리카락 한 움큼 | 0 | — |
| 앞니 두 개 | 5 | — |
| 왼쪽 새끼손가락 | 5 | — |
| 왼쪽 귀 | 10 | `deaf` |
| 오른쪽 검지손가락 | 10 | `noTrigger` |
| 왼쪽 손목 | 20 | `noGrab` |
| 왼쪽 발목 | 20 | `slow` |
| 오른쪽 눈 | 30 | `blind` |
| 오른쪽 팔 | 35 | `noGrab` |
| 오른쪽 다리 | 35 | `slow` |
| 신장 하나 | 40 | — |
| 혀 | 50 | — |

- 부위를 잃으면 치명도만큼 체력이 깎인다 (`noPain` 이면 0). 체력 0 이면 죽는다. 기존 "눈·혀·신장 즉사" 는 없앤다.
- 이미 잃은 부위는 다시 잃지 않는다. 무작위로 고를 때 남은 부위 중에서 고른다. 다 잃었으면 체력 30 피해만.

### 11.2 효과
- `noGrab`: 도구(아이템·`use` 오브젝트)를 주울 수 없다. 선택지는 비활성으로 보이고 "팔이 없다" 힌트. 시체 챙기기도 불가.
- `noTrigger`: 원거리 무기를 쏠 수 없다 (선택지 비활성, "방아쇠를 당길 손가락이 없다").
- `slow`: 전진·뒷걸음 등 **칸 이동**이 3턴을 쓴다 (괴물·움직이는 오브젝트가 3번 움직인다). 돌기는 여전히 턴을 안 쓴다.
- `blind`: 렌더 안개 거리를 1.2칸으로 줄이고 화면 전체를 어둡게(×0.35), 스프라이트는 1칸 안에서만 보인다. 서술은 2칸 이상 떨어진 것을 말하지 않고, 앞 칸의 것은 이름 대신 "무언가" 로.
- `deaf`: 효과음 끔, "숨소리가 가깝다" 류의 소리 경고 서술을 내지 않는다.

### 11.3 잃는 경로
- 출구 문: 기존과 같이 문을 열 때마다 무작위 부위 (남은 것 중).
- 함정: 밟으면 기존 피해 대신 무작위 부위 하나 (치명도만큼 피해).
- 조우 이벤트의 결과 (12 절).

### 11.4 다음 판으로 이어짐
- `users` 에 `lost_parts TEXT NOT NULL DEFAULT '[]'` (ALTER 로 추가).
- 런 시작 응답에 `body: { lostParts }`. 게임은 이 부위를 잃은 채로 시작한다 (시작 체력은 100, 이미 잃은 부위로 다시 깎지 않는다).
- 클리어 (`/clear`): 본문 `{ lostParts }` 를 받아 **알려진 부위 이름만** 걸러 저장. 그 판의 규칙에 `healOnExit` 이 있으면 `[]` 로 저장.
- 죽음 (`/die`): `[]` 로 초기화 (몸은 그 자리에 시체로 남는다).
- 중간에 창을 닫은 판은 반영하지 않는다.
- 현관 화면에 잃은 부위를 한 줄로 보여 준다: "당신은 오른쪽 팔, 왼쪽 귀 없이 서 있다."

## 12. 조우 이벤트 (텍스트 어드벤처)

### 12.1 언제
- **괴물**: 바로 앞 칸(거리 1)에 괴물이 있을 때.
- **함정**: 앞 칸에 함정이 있고 그 함정을 **알아챘을 때**. 지도에 함정이 표시되면 항상 알아채고, 아니면 처음 마주 볼 때 50% 확률로 알아챈다 (함정마다 한 번만 굴린다). 알아채면 서술: "앞 바닥에 이상한 틈이 보인다."
  알아채지 못하면 지금처럼 밟는다.

### 12.2 선택지
- 기본 선택지는 그대로 (쏜다·벤다·전진 등). 함정에는 기본 선택지 **"조심스럽게 피해 지나간다"** 가 추가된다 (성공 75%: 함정 칸을 건너 그 다음 칸으로, 다음 칸이 벽이면 함정 칸 옆을 스쳐 제자리. 실패: 함정을 밟는다).
- 여기에 **특수 행동 1개**를 무작위로 더한다. 조우 대상(괴물 id / 함정 id)마다 한 번 뽑아 고정한다 (다시 돌아봐도 같은 행동).

### 12.3 데이터 (`public/encounters.js`, 순수 모듈)
```js
// 결과 op: { damage: n } | { losePart: 'random' | '<효과key>' } | { move: 'back'|'side'|'over'|'none' }
//          | { monster: 'stun' | 'flee' | 'enrage' } | { trap: 'disarm' | 'spring' } | { next: '<eventId>' } | { text }
export const SPECIAL = {
  monster: [
    { id: 'backstep', label: '뒷걸음질 친다', needs: ['!slow'],
      outcomes: [ [0.6, { text: '한 걸음 물러났다. 그것의 손끝이 코앞을 스친다.', move: 'back' }],
                  [0.4, { text: '발이 걸려 넘어졌다.', damage: 15, next: 'grabbed_ankle' }] ] },
    { id: 'roll', label: '옆으로 굴러서 피한다', needs: ['!slow'],
      outcomes: [ [0.7, { text: '옆으로 굴렀다. 그것이 허공을 할퀸다.', move: 'side' }],
                  [0.3, { text: '구르다 벽에 부딪혔다. 그것이 팔을 물었다.', losePart: 'noGrab' }] ] },
    { id: 'freeze', label: '숨을 죽이고 가만히 있는다',
      outcomes: [ [0.5, { text: '그것이 고개를 갸웃하더니 등을 돌린다.', monster: 'flee' }],
                  [0.5, { text: '그것이 얼굴을 바싹 들이댄다.', next: 'face_to_face' }] ] },
    { id: 'scream', label: '소리를 질러 위협한다',
      outcomes: [ [0.4, { text: '그것이 움찔하며 어둠 속으로 물러난다.', monster: 'flee' }],
                  [0.6, { text: '그것이 더 크게 비명을 질렀다.', monster: 'enrage', damage: 20 }] ] },
    { id: 'shield', label: '시체를 방패처럼 들이민다', needs: ['corpse'],
      outcomes: [ [0.8, { text: '그것이 시체를 물고 늘어진다.', monster: 'stun', useCorpse: true }],
                  [0.2, { text: '시체째로 밀려 넘어졌다.', damage: 20 }] ] },
  ],
  trap: [
    { id: 'wallkick', label: '벽을 박차고 뛰어넘는다', needs: ['!slow'],
      outcomes: [ [0.7, { text: '벽을 차고 날아올라 틈 너머에 착지했다.', move: 'over' }],
                  [0.3, { text: '발이 미끄러졌다.', trap: 'spring' }] ] },
    { id: 'crawl', label: '엎드려 기어서 지나간다',
      outcomes: [ [0.9, { text: '배를 바닥에 붙이고 틈 가장자리를 지났다.', move: 'over', turns: 2 }],
                  [0.1, { text: '손을 짚은 곳이 꺼졌다.', trap: 'spring' }] ] },
    { id: 'throw', label: '시체를 던져 함정을 작동시킨다', needs: ['corpse'],
      outcomes: [ [1.0, { text: '시체가 틈에 삼켜졌다. 바닥이 닫힌다.', trap: 'disarm', useCorpse: true }] ] },
    { id: 'probe', label: '손으로 더듬어 틈을 살핀다', needs: ['!noGrab'],
      outcomes: [ [0.6, { text: '틈의 모양을 알아냈다. 이제 밟지 않을 수 있다.', trap: 'disarm' }],
                  [0.4, { text: '틈이 손을 물었다.', losePart: 'noGrab' }] ] },
  ],
};
// 후속 이벤트: 이 동안은 일반 선택지가 사라지고 이벤트 선택지만 보인다.
export const EVENTS = {
  grabbed_ankle: { text: '차가운 손이 발목을 붙잡았다.', choices: [
    { label: '다른 발로 걷어찬다', outcomes: [[0.5, { text: '손아귀가 풀렸다.', monster: 'stun' }], [0.5, { text: '발목이 꺾였다.', losePart: 'slow' }]] },
    { label: '무기로 내려친다', needs: ['weapon'], outcomes: [[0.8, { text: '손목이 잘려 나가며 발목이 풀렸다.', monster: 'stun' }], [0.2, { text: '빗나갔다.', losePart: 'slow' }]] },
    { label: '발목을 포기한다', outcomes: [[1.0, { text: '발목을 두고 기어서 빠져나왔다.', losePart: 'slow', move: 'back' }]] } ] },
  face_to_face: { text: '숨결이 닿는다. 그것의 눈이 당신의 눈을 들여다본다.', choices: [
    { label: '눈을 감는다', outcomes: [[0.6, { text: '한참 뒤, 기척이 사라졌다.', monster: 'flee' }], [0.4, { text: '눈꺼풀 위로 무언가 파고들었다.', losePart: 'blind' }]] },
    { label: '마주 본다', outcomes: [[0.3, { text: '그것이 먼저 눈을 돌렸다.', monster: 'flee' }], [0.7, { text: '그것이 웃었다.', damage: 30 }]] } ] },
};
```
- `needs`: `'!slow'` 등 부위 효과가 **없어야**, `'corpse'` 시체를 들고 있어야, `'weapon'` 무기가 있어야. 조건이 맞는 것 중에서 뽑는다.
- `losePart: '<효과key>'` 는 그 효과를 가진 남은 부위 중 하나, 없으면 무작위 부위.
- `monster`: `stun` 2턴 행동 불가, `flee` 3칸 멀어지는 방향으로 이동, `enrage` 다음 턴에 한 번 더 움직인다.
- `move`: `back` 뒤 칸 (벽이면 제자리), `side` 좌우 중 빈 칸, `over` 함정 칸 너머 (벽이면 함정 옆 제자리).
- 특수 행동과 후속 이벤트 선택은 턴을 쓴다 (`turns` 가 있으면 그만큼).
- 판정은 `resolve(outcomes, rng)` 순수 함수. 테스트에서 rng 를 주입한다.
- 문구는 한국어, 게임 안의 목소리. 확률·문구는 이 표가 기준이며 구현 중 조정하면 이 문서를 고친다.

## 13. 테스트 추가

- `test/client.js`:
  - `public/body.js`: 부위 선택이 남은 것 중에서, 효과 key 로 고르기, 치명도.
  - `public/encounters.js`: `needs` 필터, `resolve` 확률 경계 (rng 주입), 모든 `next` 가 `EVENTS` 에 존재, 모든 `losePart` 효과 key 가 `body.js` 에 존재.
- 서버: 연속 입장 거부 (`409`), 첫 입장 허용, 클리어 시 `lost_parts` 저장·`healOnExit` 초기화·모르는 부위 이름 제거, 죽음 시 초기화.
  서버 테스트는 `test/server.js` (신규): `DB_PATH` 임시 파일로 `server.js` 를 띄우지 않고, 핸들러 로직을 `src/runs.js` 로 빼서 함수 단위로 테스트한다.
