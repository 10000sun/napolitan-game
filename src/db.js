import Database from 'better-sqlite3';

const db = new Database(process.env.DB_PATH || './napolitan.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id  TEXT UNIQUE NOT NULL,
  username    TEXT NOT NULL,
  avatar      TEXT,
  created_at  INTEGER NOT NULL
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

CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  seed        INTEGER NOT NULL,
  rule_count  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  cleared_at  INTEGER,
  died_at     INTEGER,
  entry_used  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_entries_created ON entries(created_at);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);

-- 방명록 물체의 모습. 한 번 확보하면 같은 물체에 계속 쓴다.
CREATE TABLE IF NOT EXISTS assets (
  key         TEXT PRIMARY KEY,
  tags        TEXT NOT NULL,        -- 쉼표 구분
  source      TEXT NOT NULL,        -- match | gemini | pollinations | none
  file        TEXT,                 -- /obj/... 또는 /lib/...
  status      TEXT NOT NULL,        -- ready | failed
  created_at  INTEGER NOT NULL
);
`);

// 죽은 자리. 기존 DB 에도 컬럼을 붙인다.
const runCols = db.prepare('PRAGMA table_info(runs)').all().map((c) => c.name);
if (!runCols.includes('death_x')) {
  db.exec('ALTER TABLE runs ADD COLUMN death_x INTEGER; ALTER TABLE runs ADD COLUMN death_y INTEGER;');
}

// 에셋 종류. 물체와 표면 질감은 서로 매칭되지 않는다.
const assetCols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
if (!assetCols.includes('kind')) db.exec("ALTER TABLE assets ADD COLUMN kind TEXT NOT NULL DEFAULT 'object'");

// 잃은 부위. 다음에 들어올 때도 그대로다.
const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!userCols.includes('lost_parts')) db.exec("ALTER TABLE users ADD COLUMN lost_parts TEXT NOT NULL DEFAULT '[]'");

export const q = {
  upsertUser: db.prepare(`
    INSERT INTO users (discord_id, username, avatar, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar
    RETURNING *`),
  userById: db.prepare('SELECT * FROM users WHERE id = ?'),

  // 공책에 남는 건 글뿐이다. 누가 썼는지도, 그 글이 먹혔는지도 밖으로 내보내지 않는다.
  // (판정과 작성자는 DB 에 그대로 남아 있으니 운영자는 언제든 들여다볼 수 있다.)
  allEntries: db.prepare('SELECT id, raw_text FROM entries ORDER BY id ASC'),
  appliedRules: db.prepare(`
    SELECT id, raw_text, effects FROM entries WHERE verdict = 'applied' ORDER BY id ASC`),
  insertEntry: db.prepare(`
    INSERT INTO entries (user_id, run_id, raw_text, verdict, reason, effects, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),

  insertRun: db.prepare(`
    INSERT INTO runs (user_id, seed, rule_count, started_at) VALUES (?, ?, ?, ?) RETURNING *`),
  runById: db.prepare('SELECT * FROM runs WHERE id = ?'),
  clearRun: db.prepare('UPDATE runs SET cleared_at = ? WHERE id = ? AND cleared_at IS NULL'),
  dieRun: db.prepare(`
    UPDATE runs SET died_at = ?, death_x = ?, death_y = ?
    WHERE id = ? AND cleared_at IS NULL AND died_at IS NULL`),
  // 누가 죽었는지는 꺼내지 않는다. 자리만.
  recentDeaths: db.prepare(`
    SELECT death_x AS x, death_y AS y FROM runs
    WHERE died_at IS NOT NULL AND death_x IS NOT NULL
    ORDER BY died_at DESC LIMIT 30`),
  useRunEntry: db.prepare('UPDATE runs SET entry_used = 1 WHERE id = ?'),
  // 클리어했고 아직 방명록을 쓰지 않은 가장 최근 런 (= 기입 권한)
  pendingWrite: db.prepare(`
    SELECT * FROM runs WHERE user_id = ? AND cleared_at IS NOT NULL AND entry_used = 0
    ORDER BY id DESC LIMIT 1`),
  activeRun: db.prepare(`
    SELECT * FROM runs WHERE user_id = ? AND cleared_at IS NULL AND died_at IS NULL
    ORDER BY id DESC LIMIT 1`),

  assetByKey: db.prepare('SELECT * FROM assets WHERE key = ?'),
  readyAssets: db.prepare("SELECT tags, file FROM assets WHERE status = 'ready' AND kind = ?"),
  insertAsset: db.prepare(`
    INSERT OR REPLACE INTO assets (key, tags, source, file, status, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)`),
  generatedSince: db.prepare('SELECT COUNT(*) AS n FROM assets WHERE source = ? AND created_at >= ?'),

  lastRun: db.prepare('SELECT user_id FROM runs ORDER BY id DESC LIMIT 1'),
  bodyOf: db.prepare('SELECT lost_parts FROM users WHERE id = ?'),
  setBody: db.prepare('UPDATE users SET lost_parts = ? WHERE id = ?'),

  stats: db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM runs) AS attempts,
      (SELECT COUNT(*) FROM runs WHERE cleared_at IS NOT NULL) AS clears,
      (SELECT COUNT(*) FROM runs WHERE died_at IS NOT NULL) AS deaths,
      (SELECT COUNT(*) FROM entries) AS entries,
      (SELECT COUNT(*) FROM entries WHERE verdict = 'applied') AS applied`),
};

/** 반영된 규칙을 world.js 가 먹는 형태로 꺼낸다. */
export function loadAppliedRules() {
  return q.appliedRules.all().map((r) => ({
    id: r.id,
    raw_text: r.raw_text,
    effects: JSON.parse(r.effects || '[]'),
  }));
}

export default db;
