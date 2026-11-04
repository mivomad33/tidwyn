import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
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
];

export function demandDbPath(dataDir: string): string {
  return path.join(dataDir, DEMAND_DB_FILE);
}

export function openDemandDb(file: string): DatabaseSync {
  return openDb(file, DEMAND_MIGRATIONS);
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
