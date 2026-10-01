# 작업 규칙

## 브랜치 흐름

`작업 브랜치` → `develop` → `main`

- `main`: 배포 가능한 안정 버전. 직접 커밋·푸시 금지. `develop` 에서 테스트가 통과한 뒤에만 PR 로 올린다.
- `develop`: 통합 브랜치. 작업 브랜치의 PR 을 여기로 모아 테스트한다.
- 작업 브랜치: **작업 하나마다 `develop` 에서 새로 딴다.** 미리 만들어 두거나 여러 작업에 재사용하지 않는다.
  끝나면 `develop` 으로 PR 하고, 머지된 뒤에는 브랜치를 지운다. `main` 으로 바로 PR 하지 않는다.
  이름은 작업 내용이 드러나게 짓는다 (예: `feat/maze-size`, `fix/guestbook-lock`).

## 머지 전 확인

- `npm install && npm test` 전부 통과
- `wrangler.jsonc` 에 실제 계정 id 를 커밋하지 않는다 (`YOUR_*` 플레이스홀더 유지)
