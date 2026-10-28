import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// DB 구조는 버전이 붙은 마이그레이션으로 만들고 바꾼다(4.3-3). 버전은 PRAGMA user_version에 둔다.

export interface Migration {
  version: number;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE briefs (
          target_date TEXT PRIMARY KEY,
          headline TEXT NOT NULL,
          keywords TEXT NOT NULL,
          collected_at TEXT NOT NULL,
          late INTEGER NOT NULL
        );
        CREATE TABLE sections (
          id INTEGER PRIMARY KEY,
          target_date TEXT NOT NULL REFERENCES briefs(target_date) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          flow TEXT NOT NULL,
          unverified TEXT,
          UNIQUE (target_date, position)
        );
        CREATE TABLE stories (
          id INTEGER PRIMARY KEY,
          section_id INTEGER NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
          kind TEXT NOT NULL CHECK (kind IN ('top', 'short')),
          position INTEGER NOT NULL,
          title TEXT,
          summary TEXT NOT NULL,
          why_it_matters TEXT,
          background TEXT,
          key_facts TEXT,
          analogy TEXT,
          outlook TEXT,
          confidence TEXT,
          dev_checkpoint TEXT,
          major TEXT NOT NULL,
          minor TEXT NOT NULL,
          is_new_minor INTEGER NOT NULL,
          UNIQUE (section_id, kind, position)
        );
        CREATE TABLE sources (
          id INTEGER PRIMARY KEY,
          story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          published_at TEXT NOT NULL,
          image_url TEXT,
          is_primary INTEGER NOT NULL,
          UNIQUE (story_id, position)
        );
      `);
    },
  },
  {
    // 1.5단계 R3: 발행일을 추정한 출처 표시. 기존 출처는 추정 아님(0)이 된다
    version: 2,
    up: (db) => {
      db.exec("ALTER TABLE sources ADD COLUMN published_at_estimated INTEGER NOT NULL DEFAULT 0");
    },
  },
];

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row.user_version;
}

/** 밀린 마이그레이션을 차례로 적용한다. 각 마이그레이션은 트랜잭션 하나로 돈다. 적용한 버전 목록을 돌려준다. */
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): number[] {
  const applied: number[] = [];
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  for (const m of sorted) {
    if (m.version <= schemaVersion(db)) continue;
    db.exec("BEGIN");
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    applied.push(m.version);
  }
  return applied;
}

/** DB를 열고(없으면 만들고) 밀린 마이그레이션을 적용한다 */
export function openDb(dbPath: string, migrations: Migration[] = MIGRATIONS): DatabaseSync {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, migrations);
  return db;
}

/** 이미 있는 DB만 연다(없으면 예외) */
export function openExistingDb(dbPath: string): DatabaseSync {
  if (!fs.existsSync(dbPath)) throw new Error(`DB가 없다: ${dbPath}`);
  return openDb(dbPath);
}
