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
  {
    // 2단계 4.1: 이슈, 뉴스-이슈 연결, 이슈 관계, 합치기 기록. 기존 뉴스는 모두 이슈 없음이 된다.
    // AUTOINCREMENT라 한 번 쓴 이슈 번호는 다시 쓰지 않는다(4.1-1). 흡수된 이슈는 지우지 않고 merged_into로 남는 이슈를 가리킨다.
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE issues (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          aliases TEXT NOT NULL,
          major TEXT NOT NULL,
          minor TEXT NOT NULL,
          is_new_minor INTEGER NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('진행 중', '종료')),
          summary TEXT NOT NULL,
          merged_into INTEGER REFERENCES issues(id)
        );
        CREATE TABLE story_issues (
          story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          issue_id INTEGER NOT NULL REFERENCES issues(id),
          is_primary INTEGER NOT NULL,
          PRIMARY KEY (story_id, issue_id)
        );
        CREATE INDEX story_issues_issue ON story_issues(issue_id);
        CREATE TABLE issue_relations (
          a INTEGER NOT NULL REFERENCES issues(id),
          b INTEGER NOT NULL REFERENCES issues(id),
          PRIMARY KEY (a, b),
          CHECK (a < b)
        );
        CREATE TABLE merges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merged_on TEXT NOT NULL,
          survivor INTEGER NOT NULL REFERENCES issues(id),
          absorbed INTEGER NOT NULL REFERENCES issues(id),
          reason TEXT NOT NULL,
          record TEXT NOT NULL,
          undone_on TEXT
        );
        CREATE TABLE no_merge_pairs (
          a INTEGER NOT NULL REFERENCES issues(id),
          b INTEGER NOT NULL REFERENCES issues(id),
          PRIMARY KEY (a, b),
          CHECK (a < b)
        );
      `);
    },
  },
  {
    // 4단계 4.1: 대상(인물·기관·국가)과 용어, 뉴스와의 연결, 날짜별 뽑기 완료, 대상·용어 합치기 기록, 지운 이름.
    // 기존 날짜는 모두 뽑기 안 함이 된다(extracted_dates에 없음). AUTOINCREMENT라 식별자를 다시 쓰지 않는다(4.1-1).
    // 지운 대상·용어는 행을 지우지 않고 이름·별칭·설명을 비운 채 deleted로 남긴다(식별자가 복원 뒤에도 다시 쓰이지 않게, E15).
    version: 4,
    up: (db) => {
      db.exec(`
        CREATE TABLE entities (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK (kind IN ('인물', '기관', '국가')),
          name TEXT NOT NULL,
          aliases TEXT NOT NULL,
          description TEXT NOT NULL,
          described_on TEXT,
          described_story TEXT,
          merged_into INTEGER REFERENCES entities(id),
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE terms (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          aliases TEXT NOT NULL,
          description TEXT NOT NULL,
          merged_into INTEGER REFERENCES terms(id),
          deleted INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE story_entities (
          story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          entity_id INTEGER NOT NULL REFERENCES entities(id),
          PRIMARY KEY (story_id, entity_id)
        );
        CREATE INDEX story_entities_entity ON story_entities(entity_id);
        CREATE TABLE story_terms (
          story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          term_id INTEGER NOT NULL REFERENCES terms(id),
          surface TEXT,
          PRIMARY KEY (story_id, term_id)
        );
        CREATE INDEX story_terms_term ON story_terms(term_id);
        CREATE TABLE extracted_dates (
          target_date TEXT PRIMARY KEY REFERENCES briefs(target_date) ON DELETE CASCADE
        );
        CREATE TABLE ref_merges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          item TEXT NOT NULL CHECK (item IN ('entity', 'term')),
          merged_on TEXT NOT NULL,
          survivor INTEGER NOT NULL,
          absorbed INTEGER NOT NULL,
          reason TEXT NOT NULL,
          record TEXT NOT NULL,
          undone_on TEXT,
          masked INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE ref_no_merge (
          item TEXT NOT NULL CHECK (item IN ('entity', 'term')),
          a INTEGER NOT NULL,
          b INTEGER NOT NULL,
          PRIMARY KEY (item, a, b),
          CHECK (a < b)
        );
        CREATE TABLE deleted_names (
          scope TEXT NOT NULL,
          hash TEXT NOT NULL,
          key_fp TEXT NOT NULL,
          deleted_on TEXT NOT NULL,
          PRIMARY KEY (scope, hash, key_fp)
        );
      `);
    },
  },
  {
    // 5단계 4.1: 일정, 뉴스-일정 연결(근거·결과·알림), 날짜별 일정 뽑기 완료, 일정 합치기 기록, "합치지 않음" 쌍.
    // 기존 날짜는 모두 일정 뽑기 안 함이 된다(schedule_dates에 없음). AUTOINCREMENT라 식별자를 다시 쓰지 않는다.
    // 예정일(due)은 일 단위 `YYYY-MM-DD`나 달 단위 `YYYY-MM`. 결과(outcome)는 없음(NULL), 결과 연결, 연기, 취소.
    // 지운 일정은 행을 지우지 않고 이름·예정일을 남긴 채 deleted로 둔다(같은 이름·예정일을 다시 뽑지 않게, C13).
    version: 5,
    up: (db) => {
      db.exec(`
        CREATE TABLE schedules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          due TEXT NOT NULL,
          major TEXT NOT NULL,
          outcome TEXT CHECK (outcome IN ('result', 'postponed', 'cancelled')),
          postponed_to INTEGER REFERENCES schedules(id),
          merged_into INTEGER REFERENCES schedules(id),
          deleted INTEGER NOT NULL DEFAULT 0,
          deleted_on TEXT
        );
        CREATE INDEX schedules_due ON schedules(due);
        CREATE TABLE story_schedules (
          story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
          schedule_id INTEGER NOT NULL REFERENCES schedules(id),
          role TEXT NOT NULL CHECK (role IN ('basis', 'result', 'notice')),
          PRIMARY KEY (story_id, schedule_id, role)
        );
        CREATE INDEX story_schedules_schedule ON story_schedules(schedule_id);
        CREATE TABLE schedule_dates (
          target_date TEXT PRIMARY KEY REFERENCES briefs(target_date) ON DELETE CASCADE
        );
        CREATE TABLE schedule_merges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          merged_on TEXT NOT NULL,
          survivor INTEGER NOT NULL,
          absorbed INTEGER NOT NULL,
          reason TEXT NOT NULL,
          record TEXT NOT NULL,
          undone_on TEXT
        );
        CREATE TABLE schedule_no_merge (
          a INTEGER NOT NULL,
          b INTEGER NOT NULL,
          PRIMARY KEY (a, b),
          CHECK (a < b)
        );
      `);
    },
  },
  {
    // 6단계 4.1: 지표 값(지표·날짜마다 하나), 이슈-지표 연결, 이슈별 지표 판단 완료, 합치기마다의 지표 기록(되돌리기용).
    // 기존 이슈는 모두 지표 판단 안 함이 된다(indicator_judged에 없음). 날짜는 일별 `YYYY-MM-DD`, 월별 `YYYY-MM`.
    version: 6,
    up: (db) => {
      db.exec(`
        CREATE TABLE indicator_values (
          indicator TEXT NOT NULL,
          date TEXT NOT NULL,
          value REAL NOT NULL,
          PRIMARY KEY (indicator, date)
        );
        CREATE TABLE issue_indicators (
          issue_id INTEGER NOT NULL REFERENCES issues(id),
          indicator TEXT NOT NULL,
          PRIMARY KEY (issue_id, indicator)
        );
        CREATE TABLE indicator_judged (
          issue_id INTEGER PRIMARY KEY REFERENCES issues(id)
        );
        CREATE TABLE indicator_merges (
          merge_id INTEGER PRIMARY KEY REFERENCES merges(id),
          record TEXT NOT NULL
        );
      `);
    },
  },
  {
    // 7단계 4.1: 영상 기록(YouTube 데이터, 받은 날부터 30일이 지나면 지운다), 영상-이슈 연결(이슈 식별자), 날짜별 영상 고르기 끝남.
    // 같은 브리프 날짜에 같은 영상은 하나다. 설명과 통계는 넣지 않는다. 고르기 끝남은 날짜만 있어 30일 지우기 대상이 아니다.
    version: 7,
    up: (db) => {
      db.exec(`
        CREATE TABLE videos (
          id INTEGER PRIMARY KEY,
          video_id TEXT NOT NULL,
          bundle TEXT NOT NULL CHECK (bundle IN ('kr', 'us', 'ai-ko', 'ai-en')),
          sources TEXT NOT NULL,
          brief_date TEXT NOT NULL,
          fetched_on TEXT NOT NULL,
          title TEXT NOT NULL,
          channel TEXT NOT NULL,
          seconds INTEGER NOT NULL,
          thumb TEXT NOT NULL,
          published_at TEXT NOT NULL,
          reason TEXT NOT NULL,
          position INTEGER NOT NULL,
          UNIQUE (brief_date, video_id)
        );
        CREATE INDEX videos_fetched ON videos(fetched_on);
        CREATE TABLE video_issues (
          video INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
          issue_id INTEGER NOT NULL REFERENCES issues(id),
          position INTEGER NOT NULL,
          PRIMARY KEY (video, issue_id)
        );
        CREATE INDEX video_issues_issue ON video_issues(issue_id);
        CREATE TABLE video_picked (
          target_date TEXT PRIMARY KEY
        );
      `);
    },
  },
  {
    // 8단계 4.3-3: 영상 요약. 영상 기록의 일부라 함께 지워진다. 없을 수 있다(T11)
    version: 8,
    up: (db) => {
      db.exec("ALTER TABLE videos ADD COLUMN video_summary TEXT");
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
