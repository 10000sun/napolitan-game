// 쿼리. SQL 은 D1 과 SQLite 에서 똑같이 돈다. 각 문은 get·all·run 을 비동기로 준다.
export function queries(store) {
  const stmt = (sql) => ({
    get: (...args) => store.get(sql, args),
    all: (...args) => store.all(sql, args),
    run: (...args) => store.run(sql, args),
  });
  return {
    // 공책 잠금. 비었거나 만료됐을 때만 내 것이 된다. 한 문장이라 둘이 동시에 가져가지 못한다.
    // 못 가져가면 RETURNING 이 아무 행도 돌려주지 않는다 → get() 이 null.
    lockBook: stmt(`INSERT INTO locks (name, holder, until) VALUES ('book', ?, ?)
      ON CONFLICT(name) DO UPDATE SET holder = excluded.holder, until = excluded.until WHERE locks.until < ?
      RETURNING holder`),
    unlockBook: stmt(`DELETE FROM locks WHERE name = 'book' AND holder = ?`),
    // 방명록 초기화. 글이 runs 를 가리키므로 글부터 지운다 (D1 은 외래키를 지킨다).
    resetEntries: stmt(`DELETE FROM entries`),
    resetRuns: stmt(`DELETE FROM runs`),
    resetBodies: stmt(`UPDATE users SET lost_parts = '[]', read_book = 0`),
    countForReset: stmt(`SELECT (SELECT COUNT(*) FROM entries) AS entries, (SELECT COUNT(*) FROM runs) AS runs`),
    upsertUser: stmt(`
    INSERT INTO users (discord_id, username, avatar, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, avatar = excluded.avatar
    RETURNING *`),
    userById: stmt('SELECT * FROM users WHERE id = ?'),
    // 방이 기억하는 값 (지금은 자물쇠 번호)
    roomGet: stmt('SELECT value FROM room WHERE key = ?'),
    roomSet: stmt(`INSERT INTO room (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
  // 공책에 남는 건 글뿐이다. 누가 썼는지도, 그 글이 먹혔는지도 밖으로 내보내지 않는다.
  // (판정과 작성자는 DB 에 그대로 남아 있으니 운영자는 언제든 들여다볼 수 있다.)
    allEntries: stmt('SELECT id, raw_text FROM entries ORDER BY id ASC'),
    appliedRules: stmt(`
    SELECT id, raw_text, effects FROM entries WHERE verdict = 'applied' ORDER BY id ASC`),
    insertEntry: stmt(`
    INSERT INTO entries (user_id, run_id, raw_text, verdict, reason, effects, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`),
    insertRun: stmt(`
    INSERT INTO runs (user_id, seed, rule_count, started_at) VALUES (?, ?, ?, ?) RETURNING *`),
    runById: stmt('SELECT * FROM runs WHERE id = ?'),
    clearRun: stmt('UPDATE runs SET cleared_at = ? WHERE id = ? AND cleared_at IS NULL'),
    dieRun: stmt(`
    UPDATE runs SET died_at = ?, death_x = ?, death_y = ?, death_parts = ?
    WHERE id = ? AND cleared_at IS NULL AND died_at IS NULL`),
  // 누가 죽었는지는 꺼내지 않는다. 자리만.
    recentDeaths: stmt(`
    SELECT death_x AS x, death_y AS y, death_parts AS parts FROM runs
    WHERE died_at IS NOT NULL AND death_x IS NOT NULL
    ORDER BY died_at DESC LIMIT 30`),
    useRunEntry: stmt('UPDATE runs SET entry_used = 1 WHERE id = ?'),
  // 클리어했고 아직 방명록을 쓰지 않은 가장 최근 런 (= 기입 권한)
    pendingWrite: stmt(`
    SELECT * FROM runs WHERE user_id = ? AND cleared_at IS NOT NULL AND entry_used = 0
    ORDER BY id DESC LIMIT 1`),
    activeRun: stmt(`
    SELECT * FROM runs WHERE user_id = ? AND cleared_at IS NULL AND died_at IS NULL
    ORDER BY id DESC LIMIT 1`),
    assetByKey: stmt('SELECT * FROM assets WHERE key = ?'),
    readyAssets: stmt("SELECT tags, file FROM assets WHERE status = 'ready' AND kind = ?"),
    insertAsset: stmt(`
    INSERT OR REPLACE INTO assets (key, tags, source, file, status, created_at, kind) VALUES (?, ?, ?, ?, ?, ?, ?)`),
    generatedSince: stmt('SELECT COUNT(*) AS n FROM assets WHERE source = ? AND created_at >= ?'),
    lastRun: stmt('SELECT user_id, started_at FROM runs ORDER BY id DESC LIMIT 1'),
    bodyOf: stmt('SELECT lost_parts FROM users WHERE id = ?'),
    setBody: stmt('UPDATE users SET lost_parts = ? WHERE id = ?'),
    readBook: stmt('SELECT read_book FROM users WHERE id = ?'),
    markRead: stmt('UPDATE users SET read_book = 1 WHERE id = ?'),
    stats: stmt(`
    SELECT
      (SELECT COUNT(*) FROM runs) AS attempts,
      (SELECT COUNT(*) FROM runs WHERE cleared_at IS NOT NULL) AS clears,
      (SELECT COUNT(*) FROM runs WHERE died_at IS NOT NULL) AS deaths,
      (SELECT COUNT(*) FROM entries) AS entries,
      (SELECT COUNT(*) FROM entries WHERE verdict = 'applied') AS applied`),
  };
}
