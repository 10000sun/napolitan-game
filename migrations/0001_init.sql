-- 돌이킬 수 없는 — 첫 스키마. 로컬 SQLite 시절 ALTER 로 붙였던 칸까지 처음부터 담는다.

CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT UNIQUE NOT NULL,
  username    TEXT NOT NULL,
  avatar      TEXT,
  created_at  INTEGER NOT NULL,
  lost_parts  TEXT NOT NULL DEFAULT '[]',   -- 잃은 부위. 다음에 들어올 때도 그대로다
  read_book   INTEGER NOT NULL DEFAULT 0    -- 공책을 한 번이라도 열어 봤는가
);

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  seed        INTEGER NOT NULL,
  rule_count  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  cleared_at  INTEGER,
  died_at     INTEGER,
  entry_used  INTEGER NOT NULL DEFAULT 0,
  death_x     INTEGER,                      -- 죽은 자리
  death_y     INTEGER
);

-- 방명록. append-only. 한번 적힌 글은 지워지지 않는다.
-- ("이거 근데 찢거나 낙서 하면 어떻게 됨?" / "그대로임.")
CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  run_id      INTEGER REFERENCES runs(id),
  raw_text    TEXT NOT NULL,
  verdict     TEXT NOT NULL,        -- applied | duplicate | contradiction | swallowed | flavor_only
  reason      TEXT NOT NULL,
  effects     TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL
);

-- 방명록 물체의 모습. 한 번 확보하면 같은 물체에 계속 쓴다.
CREATE TABLE IF NOT EXISTS assets (
  key         TEXT PRIMARY KEY,
  tags        TEXT NOT NULL,        -- 쉼표 구분
  source      TEXT NOT NULL,        -- match | gemini | pollinations | none
  file        TEXT,                 -- /obj/... 또는 /lib/...
  status      TEXT NOT NULL,        -- ready | failed
  created_at  INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'object'   -- object | texture. 서로 매칭되지 않는다
);

CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
CREATE INDEX IF NOT EXISTS idx_runs_died ON runs(died_at) WHERE died_at IS NOT NULL;
