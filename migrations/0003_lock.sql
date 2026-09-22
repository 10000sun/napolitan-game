-- 방이 기억하는 것. 판이 바뀌어도 남는다.
-- 지금은 출구 자물쇠 번호 하나뿐이다. 시드에서 뽑지 않고 여기 두어야
-- 방명록이 그대로일 때 번호도 그대로다.
CREATE TABLE IF NOT EXISTS room (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
