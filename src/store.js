// ─────────────────────────────────────────────────────────────
// 저장소
//
// 운영은 Cloudflare D1, 테스트는 node 의 better-sqlite3. 둘 다 같은 모양으로 감싼다.
//   get(sql, args) → 행 하나 또는 null
//   all(sql, args) → 행 배열
//   run(sql, args) → 없음
// ─────────────────────────────────────────────────────────────

export function d1Store(DB) {
  const bind = (sql, args) => DB.prepare(sql).bind(...args);
  return {
    get: async (sql, args = []) => (await bind(sql, args).first()) ?? null,
    all: async (sql, args = []) => (await bind(sql, args).all()).results ?? [],
    run: async (sql, args = []) => { await bind(sql, args).run(); },
  };
}

/** 테스트용. migrations/ 의 SQL 을 차례로 실행한 SQLite. 워커 번들에 들어가지 않게 동적으로 불러온다. */
export async function nodeStore(file = ':memory:') {
  const { default: Database } = await import('better-sqlite3');
  const fs = await import('node:fs');
  const dir = new URL('../migrations/', import.meta.url);
  const db = new Database(file);
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(new URL(f, dir), 'utf8'));
  }
  return {
    get: async (sql, args = []) => db.prepare(sql).get(...args) ?? null,
    all: async (sql, args = []) => db.prepare(sql).all(...args),
    run: async (sql, args = []) => { db.prepare(sql).run(...args); },
    close: () => db.close(),
  };
}
