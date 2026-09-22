-- 공책 잠금. 판정은 한 번에 한 줄씩. 두 글이 서로를 모른 채 판정되지 않게.
-- until 이 지나면 누구든 가져갈 수 있다 (판정 도중 워커가 죽어도 영영 잠기지 않게).
CREATE TABLE IF NOT EXISTS locks (
  name   TEXT PRIMARY KEY,
  holder TEXT NOT NULL,
  until  INTEGER NOT NULL
);
