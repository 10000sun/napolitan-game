# 조합형 규칙 (`rule.when`) — 설계

선행 설계: `2026-09-22-literal-guestbook-backrooms-design.md`.

## 목적

"고양이를 쓰다듬으면 회복", "5턴마다 불이 꺼진다", "거울을 보면 다른 곳으로" 처럼 **조건 + 행동** 형태의 소원을
효과를 하나씩 추가하지 않고 조합으로 담는다. 물체에 새 버튼(동사)을 만들 수도, 저절로 일어나게 할 수도 있다.

## 원칙

- 강한 효과도 별도 제한 없이 받는다. 이미 반영된 규칙을 무력화하는 소원은 기존 `contradiction` 판정이 거른다
  (예: 괴물이 있는데 "괴물이 사라지는 버튼", 출구가 부위를 요구하는데 "그냥 나가는 버튼").
- 규칙은 방 전체에서 **먼저 적힌 20개까지**. 옛 규칙을 밀어내지 않는다 (되돌릴 수 없다).
- 규칙 실행은 클라이언트에서, 한 판 안에서만. 서버 호출 없음.
- LLM 출력은 `normalizeRule` 을 반드시 통과한다.

## DSL

```js
{ type: 'rule.when',
  on: 'act' | 'enter' | 'near' | 'every' | 'see_monster' | 'pickup' | 'hurt' | 'start' | 'door',
  target: '고양이',        // act·enter·near·pickup 에 필수. 물체 이름 (또는 권총·칼·지도)
  verb: '쓰다듬는다',       // act 의 버튼 동사. 20자, 기본 '만진다'
  n: 5,                    // every: 1~50 (기본 5) / hurt: 1~99 (기본 30)
  chance: 0.5,             // 0.05~1, 기본 1
  once: true,              // 한 판에 한 번
  do: [ ...최대 4개 ] }
```

| on | 발동 |
|---|---|
| act | 대상이 발밑·바로 앞(벽 물체는 마주 본 벽면)에 있을 때 뜨는 버튼을 누름. 한 턴을 쓴다 |
| enter | 대상이 있는 칸에 들어감 (새로 참이 될 때) |
| near | 대상이 1칸 안 (새로 참이 될 때) |
| every | turn 이 n 의 배수가 될 때마다 |
| see_monster | 괴물이 시야에 들어옴 (새로 참이 될 때) |
| pickup | 대상을 주움 |
| hurt | 체력이 n 이하가 됨 (새로 참이 될 때) |
| start | 들어오자마자 한 번 |
| door | 출구 칸에 섬 (새로 참이 될 때) |

| act (행동) | 파라미터 | 범위 |
|---|---|---|
| say | text | 120자 |
| hp | amount | −50~50, 0 이면 버림 |
| lose_part | effect | random·deaf·noTrigger·noGrab·slow·blind, 기본 random |
| teleport | to | random·start·exit, 기본 random |
| monster | do, count | flee·stun·enrage·spawn / spawn 이면 1~3 |
| dark | turns | 1~5 |
| give | item, count | ammo·pistol·knife·map / ammo 면 1~30 (기본 6) |
| object | do | vanish·follow·wander·come (대상은 규칙의 target) |
| sound | kind | scream·whisper·knock |
| reveal | turns | 1~10 |

모르는 `on`·`act` 는 버린다. 필요한 target 이 없거나 행동이 하나도 안 남으면 규칙 전체를 버린다.

## 엔진

- `src/effects.js`: `normalizeRule`, `normalizeAction`, `'rule.when'` Effect, `state.rules` (20개 상한).
- `src/world.js`: `rules` 반환. target 이 필요한 규칙 중 방에 그 물체(물체 key 또는 권총·칼·지도 이름)가 없는 것은 뺀다.
- `public/rules.js` `RuleEngine(rules, rng)`:
  - `buttons(keys)` → 지금 누를 수 있는 act 규칙 `[{ i, rule }]` (once 로 쓴 것 제외)
  - `act(i)`, `pickup(key)` → 실행할 행동 목록
  - `update(s)` → `s = { turn, here: Set, near: Set, seeMonster, hp, atDoor }` 를 보고 새로 참이 된 조건의 행동 목록
  - chance 는 rng, once 는 엔진이 기억.
- `public/game.js`:
  - 버튼 `rule:i` "`{대상 이름}`을(를) `{verb}`". 확률에 걸리지 않으면 "아무 일도 일어나지 않았다."
  - 모든 선택이 끝난 뒤, 그리고 입장 직후 `update` 를 돌려 행동을 적용한다.
  - `dark`: N턴 동안 화면 위를 거의 검게 덮는다. `reveal`: N턴 동안 미니맵을 켠다.
  - `monster spawn`: 플레이어에게서 4칸 이상 떨어진 빈 바닥에. `object come`: 플레이어 옆 빈 칸으로.
  - `teleport random`: 괴물이 없는 무작위 바닥 칸. 옮긴 칸의 함정은 밟는다.
  - `give pistol` 은 권총을 주운 것과 같고 탄약 +12. `give map` 은 지도를 펼친 것과 같다.
- `src/compiler.js`: 규칙형 소원 예시 4개, 모순 예시 2개, "규칙이 20개면 rule.when 을 쓰지 않는다".

## 테스트

- `test/compiler.js`: `normalizeRule` — 범위 자르기, 모르는 값 버리기, 행동 4개, target 필수, 20개 상한.
- `test/replay.js`: 대상이 없는 규칙 제외, 스냅샷은 `rules` 를 빼고 비교.
- `test/client.js`: `RuleEngine` — 조건별 발동, 새로 참이 될 때만, every, once, chance 경계, 버튼 목록.
- 게임 행동 처리는 페이지 안에서 직접 호출해 확인.
