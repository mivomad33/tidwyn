import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { gunzipSync, gzipSync } from "node:zlib";
import { openDb, type Migration } from "./db.ts";
import { inTransaction } from "./issues.ts";
import { kstStamp } from "./kst.ts";

// 9.95단계 S4, S5, 4.1-4: 수요 데이터 전용 DB. 본 DB(tidwyn.db)와 따로 두고, 백업·사이트·복원은 이 파일을 다루지 않는다.
// 스냅샷은 덧붙이기만 한다. 고치거나 지우는 문장은 트리거가 막는다(D16: 지우지 않는다).

export const DEMAND_DB_FILE = "demand.db";
/** 실행 전 사본 폴더. 본 DB 사본 폴더(snapshots/)와 그 이름 규칙(tidwyn-*.db) 밖에 둔다 */
export const DEMAND_COPY_DIR = "demand-copies";
export const DEMAND_COPY_KEEP = 3;
export const DEMAND_COPY_RE = /^demand-(\d{8}-\d{6})(?:-(\d+))?\.db$/;

export type DemandStatus = "ok" | "failed" | "robots" | "off";

export const DEMAND_MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE demand_snapshots (
          id INTEGER PRIMARY KEY,
          source TEXT NOT NULL,
          grp TEXT NOT NULL,
          label TEXT NOT NULL,
          fetched_on TEXT NOT NULL,
          value_date TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          bytes INTEGER NOT NULL,
          UNIQUE (source, fetched_on)
        );
        CREATE TABLE demand_parts (
          snapshot_id INTEGER NOT NULL REFERENCES demand_snapshots(id),
          part TEXT NOT NULL,
          page INTEGER NOT NULL,
          url TEXT NOT NULL,
          body BLOB NOT NULL,
          PRIMARY KEY (snapshot_id, part, page)
        );
        CREATE TABLE demand_status (
          source TEXT NOT NULL,
          day TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'robots', 'off')),
          reason TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (source, day)
        );
        CREATE TRIGGER demand_snapshots_no_update BEFORE UPDATE ON demand_snapshots BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 고치지 않는다'); END;
        CREATE TRIGGER demand_snapshots_no_delete BEFORE DELETE ON demand_snapshots BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 지우지 않는다'); END;
        CREATE TRIGGER demand_parts_no_update BEFORE UPDATE ON demand_parts BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 고치지 않는다'); END;
        CREATE TRIGGER demand_parts_no_delete BEFORE DELETE ON demand_parts BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 지우지 않는다'); END;
      `);
    },
  },
  {
    // 9.96단계 4.1-5: 값 날짜가 여럿인 공식 소스 스냅샷. 9.95 표는 고치지 않는다(UNIQUE (source, fetched_on) 때문에 새 표를 둔다)
    version: 2,
    up: (db) => {
      db.exec(`
        CREATE TABLE demand_values (
          id INTEGER PRIMARY KEY,
          source TEXT NOT NULL,
          grp TEXT NOT NULL,
          label TEXT NOT NULL,
          value_date TEXT NOT NULL,
          fetched_on TEXT NOT NULL,
          fetched_at TEXT NOT NULL,
          items INTEGER NOT NULL,
          total INTEGER,
          raw_bytes INTEGER NOT NULL,
          bytes INTEGER NOT NULL,
          elapsed_ms INTEGER NOT NULL
        );
        CREATE INDEX demand_values_source ON demand_values (source, value_date);
        CREATE TABLE demand_value_parts (
          value_id INTEGER NOT NULL REFERENCES demand_values(id),
          part TEXT NOT NULL,
          page INTEGER NOT NULL,
          url TEXT NOT NULL,
          absent INTEGER NOT NULL CHECK (absent IN (0, 1)),
          encoding TEXT NOT NULL CHECK (encoding IN ('gzip')),
          body BLOB NOT NULL,
          PRIMARY KEY (value_id, part, page)
        );
        CREATE TRIGGER demand_values_no_update BEFORE UPDATE ON demand_values BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 고치지 않는다'); END;
        CREATE TRIGGER demand_values_no_delete BEFORE DELETE ON demand_values BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 지우지 않는다'); END;
        CREATE TRIGGER demand_value_parts_no_update BEFORE UPDATE ON demand_value_parts BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 고치지 않는다'); END;
        CREATE TRIGGER demand_value_parts_no_delete BEFORE DELETE ON demand_value_parts BEGIN SELECT RAISE(ABORT, '수요 스냅샷은 지우지 않는다'); END;
        CREATE TABLE demand_requests (
          source TEXT NOT NULL,
          day TEXT NOT NULL,
          count INTEGER NOT NULL,
          PRIMARY KEY (source, day)
        );
        CREATE TABLE demand_cuts (
          source TEXT NOT NULL,
          value_date TEXT NOT NULL,
          run TEXT NOT NULL,
          PRIMARY KEY (source, value_date, run)
        );
        CREATE TABLE demand_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    },
  },
  {
    // 9.98단계 4.2-4(S8): 커뮤니티 건수. 글·제목·작성자·글 식별자·저장소 이름은 칸이 없다(받는 자리에서 버린다).
    // 검색어와 건수는 덧붙이기만 하고(고치기·지우기를 트리거가 막는다), 상태 표는 대상 날짜 × 소스마다 한 줄을 고쳐 쓴다(9.95 demand_status는 쓰지 않는다)
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE community_terms (
          target_date TEXT NOT NULL,
          term TEXT NOT NULL,
          unit_key TEXT NOT NULL,
          selected_at TEXT NOT NULL,
          PRIMARY KEY (target_date, term)
        );
        CREATE TABLE community_counts (
          id INTEGER PRIMARY KEY,
          target_date TEXT NOT NULL,
          source TEXT NOT NULL,
          term TEXT NOT NULL,
          unit_key TEXT NOT NULL,
          win_kind TEXT NOT NULL CHECK (win_kind IN ('recent', 'base')),
          win_from TEXT NOT NULL,
          win_to TEXT NOT NULL,
          count INTEGER NOT NULL,
          cap_hit INTEGER NOT NULL CHECK (cap_hit IN (0, 1)),
          top_share REAL,
          fetched_at TEXT NOT NULL,
          UNIQUE (target_date, source, term, win_from, win_to)
        );
        CREATE TABLE community_status (
          target_date TEXT NOT NULL,
          source TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('ok', 'partial', 'off', 'robots', 'blocked', 'failed', 'noterms')),
          reason TEXT,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (target_date, source)
        );
        CREATE TRIGGER community_terms_no_update BEFORE UPDATE ON community_terms BEGIN SELECT RAISE(ABORT, '커뮤니티 검색어는 고치지 않는다'); END;
        CREATE TRIGGER community_terms_no_delete BEFORE DELETE ON community_terms BEGIN SELECT RAISE(ABORT, '커뮤니티 검색어는 지우지 않는다'); END;
        CREATE TRIGGER community_counts_no_update BEFORE UPDATE ON community_counts BEGIN SELECT RAISE(ABORT, '커뮤니티 건수는 고치지 않는다'); END;
        CREATE TRIGGER community_counts_no_delete BEFORE DELETE ON community_counts BEGIN SELECT RAISE(ABORT, '커뮤니티 건수는 지우지 않는다'); END;
      `);
    },
  },
];

export const DEMAND_SCHEMA_VERSION = Math.max(...DEMAND_MIGRATIONS.map((m) => m.version));

export function demandDbPath(dataDir: string): string {
  return path.join(dataDir, DEMAND_DB_FILE);
}

export function openDemandDb(file: string): DatabaseSync {
  return openDb(file, DEMAND_MIGRATIONS);
}

/**
 * 실행의 전용 DB를 연다(9.96단계 4.1-6). 이미 있는 DB의 마이그레이션 번호가 오를 때는 사본을 마이그레이션 전에 만든다.
 * mayCopy가 false면(그 실행에서 이미 사본을 만들었으면) 만들지 않는다. copied는 이 함수가 사본을 만들었는지다
 */
export function openDemandDbForRun(file: string, dataDir: string, now: Date, mayCopy: boolean): { db: DatabaseSync; copied: boolean } {
  let copied = false;
  if (mayCopy && fs.existsSync(file)) {
    const raw = new DatabaseSync(file);
    try {
      const v = (raw.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      if (v < DEMAND_SCHEMA_VERSION) {
        copyDemandDb(raw, dataDir, now);
        copied = true;
      }
    } finally {
      raw.close();
    }
  }
  return { db: openDemandDb(file), copied };
}

/** 사본을 하나 만들고 최근 DEMAND_COPY_KEEP개만 남긴다. 만든 사본 경로 */
export function copyDemandDb(db: DatabaseSync, dataDir: string, now: Date): string {
  const dir = path.join(dataDir, DEMAND_COPY_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = kstStamp(now);
  let file = path.join(dir, `demand-${stamp}.db`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `demand-${stamp}-${i}.db`);
  db.prepare("VACUUM INTO ?").run(file);
  // 시각 순, 같은 시각이면 붙인 번호 순
  const order = (n: string) => {
    const m = DEMAND_COPY_RE.exec(n)!;
    return `${m[1]}-${(m[2] ?? "1").padStart(6, "0")}`;
  };
  const copies = fs
    .readdirSync(dir)
    .filter((n) => DEMAND_COPY_RE.test(n))
    .sort((a, b) => order(a).localeCompare(order(b)));
  for (const n of copies.slice(0, Math.max(0, copies.length - DEMAND_COPY_KEEP))) fs.rmSync(path.join(dir, n));
  return file;
}

export interface SnapshotPart {
  part: string;
  page: number;
  url: string;
  body: Uint8Array;
}

export interface NewSnapshot {
  source: string;
  group: string;
  label: string;
  fetchedOn: string;
  /** 값의 기준 날짜. 이 단계의 소스는 받은 날짜와 같다(4.1-5) */
  valueDate: string;
  fetchedAt: string;
  parts: SnapshotPart[];
}

/** 스냅샷 하나를 저장한다. 저장한 바이트 수 */
export function saveSnapshot(db: DatabaseSync, s: NewSnapshot): number {
  const bytes = s.parts.reduce((n, p) => n + p.body.byteLength, 0);
  inTransaction(db, () => {
    const r = db.prepare("INSERT INTO demand_snapshots (source, grp, label, fetched_on, value_date, fetched_at, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(s.source, s.group, s.label, s.fetchedOn, s.valueDate, s.fetchedAt, bytes);
    const ins = db.prepare("INSERT INTO demand_parts (snapshot_id, part, page, url, body) VALUES (?, ?, ?, ?, ?)");
    for (const p of s.parts) ins.run(r.lastInsertRowid, p.part, p.page, p.url, p.body);
  });
  return bytes;
}

export function hasSnapshot(db: DatabaseSync, source: string, day: string): boolean {
  return db.prepare("SELECT 1 FROM demand_snapshots WHERE source = ? AND fetched_on = ?").get(source, day) !== undefined;
}

export function setStatus(db: DatabaseSync, source: string, day: string, status: DemandStatus, reason: string | null, now: string): void {
  db.prepare("INSERT INTO demand_status (source, day, status, reason, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (source, day) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at").run(source, day, status, reason, now);
}

export function statusOf(db: DatabaseSync, source: string, day: string): { status: DemandStatus; reason: string | null } | null {
  return (db.prepare("SELECT status, reason FROM demand_status WHERE source = ? AND day = ?").get(source, day) as { status: DemandStatus; reason: string | null } | undefined) ?? null;
}

/**
 * 오늘까지 이어 온 받지 못한 일수(4.3-3). 받지 못함만 세고, robots 막힘·꺼짐인 날과 기록이 없는 날은 세지도 끊지도 않는다. 받음이 끊는다
 */
export function failStreak(db: DatabaseSync, source: string, today: string): number {
  const rows = db.prepare("SELECT status FROM demand_status WHERE source = ? AND day <= ? ORDER BY day DESC").all(source, today) as { status: DemandStatus }[];
  let n = 0;
  for (const r of rows) {
    if (r.status === "ok") break;
    if (r.status === "failed") n++;
  }
  return n;
}

// 9.96단계: 공식 소스의 값 날짜 스냅샷(4.1-5), 하루 요청 수(4.2-4), 상한에 끊긴 값 날짜(4.3-3), 민원빅데이터 마지막 요청 시각(4.2-4)

export interface ValuePart {
  part: string;
  page: number;
  /** 키를 뺀 주소 */
  url: string;
  /** 소스가 '자료 없음'으로 확정해 준 상세(4.1-1) */
  absent: boolean;
  /** 개인 칸을 버린 원문 바이트(압축 전) */
  body: Uint8Array;
}

export interface NewValueSnapshot {
  source: string;
  group: string;
  label: string;
  valueDate: string;
  fetchedOn: string;
  fetchedAt: string;
  items: number;
  total: number | null;
  elapsedMs: number;
  parts: ValuePart[];
}

/** 값 날짜 스냅샷 하나를 저장한다(S7: 본문은 gzip). 압축 전·뒤 바이트 */
export function saveValueSnapshot(db: DatabaseSync, s: NewValueSnapshot): { rawBytes: number; bytes: number } {
  const packed = s.parts.map((p) => ({ ...p, packed: gzipSync(p.body) }));
  const rawBytes = s.parts.reduce((n, p) => n + p.body.byteLength, 0);
  const bytes = packed.reduce((n, p) => n + p.packed.byteLength, 0);
  inTransaction(db, () => {
    const r = db.prepare("INSERT INTO demand_values (source, grp, label, value_date, fetched_on, fetched_at, items, total, raw_bytes, bytes, elapsed_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(s.source, s.group, s.label, s.valueDate, s.fetchedOn, s.fetchedAt, s.items, s.total, rawBytes, bytes, s.elapsedMs);
    const ins = db.prepare("INSERT INTO demand_value_parts (value_id, part, page, url, absent, encoding, body) VALUES (?, ?, ?, ?, ?, 'gzip', ?)");
    for (const p of packed) ins.run(r.lastInsertRowid, p.part, p.page, p.url, p.absent ? 1 : 0, p.packed);
  });
  return { rawBytes, bytes };
}

/** 저장한 본문을 푼다 */
export function unpackBody(encoding: string, body: Uint8Array): Buffer {
  if (encoding !== "gzip") throw new Error(`모르는 압축 ${encoding}`);
  return gunzipSync(body);
}

/** 소스의 스냅샷이 있는 값 날짜 */
export function valueDates(db: DatabaseSync, source: string): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT value_date FROM demand_values WHERE source = ?").all(source) as { value_date: string }[]).map((r) => r.value_date));
}

export interface LastValue {
  fetchedAt: string;
  fetchedOn: string;
  total: number | null;
  elapsedMs: number;
}

/** 값 날짜의 가장 최근 스냅샷 */
export function lastValue(db: DatabaseSync, source: string, valueDate: string): LastValue | null {
  const r = db.prepare("SELECT fetched_at, fetched_on, total, elapsed_ms FROM demand_values WHERE source = ? AND value_date = ? ORDER BY id DESC LIMIT 1").get(source, valueDate) as { fetched_at: string; fetched_on: string; total: number | null; elapsed_ms: number } | undefined;
  return r === undefined ? null : { fetchedAt: r.fetched_at, fetchedOn: r.fetched_on, total: r.total, elapsedMs: r.elapsed_ms };
}

/** 소스의 가장 최근 스냅샷이 받는 데 걸린 시간(1372의 잰 시간, 4.1-3). 없으면 null */
export function lastElapsed(db: DatabaseSync, source: string): number | null {
  const r = db.prepare("SELECT elapsed_ms FROM demand_values WHERE source = ? ORDER BY id DESC LIMIT 1").get(source) as { elapsed_ms: number } | undefined;
  return r?.elapsed_ms ?? null;
}

export function requestCount(db: DatabaseSync, source: string, day: string): number {
  return (db.prepare("SELECT count FROM demand_requests WHERE source = ? AND day = ?").get(source, day) as { count: number } | undefined)?.count ?? 0;
}

export function addRequest(db: DatabaseSync, source: string, day: string): void {
  db.prepare("INSERT INTO demand_requests (source, day, count) VALUES (?, ?, 1) ON CONFLICT (source, day) DO UPDATE SET count = count + 1").run(source, day);
}

/** 상한에 끊긴 값 날짜를 적고, 그 값 날짜가 끊긴 실행 수를 돌려준다 */
export function addCut(db: DatabaseSync, source: string, valueDate: string, run: string): number {
  db.prepare("INSERT OR IGNORE INTO demand_cuts (source, value_date, run) VALUES (?, ?, ?)").run(source, valueDate, run);
  return (db.prepare("SELECT COUNT(*) AS n FROM demand_cuts WHERE source = ? AND value_date = ?").get(source, valueDate) as { n: number }).n;
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  return (db.prepare("SELECT value FROM demand_meta WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO demand_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}
