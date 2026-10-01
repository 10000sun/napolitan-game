# 작업 규칙

## 브랜치 흐름

`작업 브랜치` → `develop` → `main`

- `main`: 배포 가능한 안정 버전. 직접 커밋·푸시 금지. `develop` 에서 테스트가 통과한 뒤에만 PR 로 올린다.
- `develop`: 통합 브랜치. 작업 브랜치의 PR 을 여기로 모아 테스트한다.
- 작업 브랜치: 항상 `develop` 에서 새로 따서 작업하고, 끝나면 `develop` 으로 PR 한다. `main` 으로 바로 PR 하지 않는다.

## 머지 전 확인

- `npm install && npm test` 전부 통과
- `wrangler.jsonc` 에 실제 계정 id 를 커밋하지 않는다 (`YOUR_*` 플레이스홀더 유지)
