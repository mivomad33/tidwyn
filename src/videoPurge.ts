import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WORK_DIR } from "./run.ts";
import { DB_FILE, TEST_DATA_ROOT } from "./settings.ts";
import { SNAPSHOT_DIR } from "./snapshot.ts";
import { SITE_INPUT_DIR, SITE_OUT_DIR } from "./publish.ts";
import { VIDEO_WORK_NAMES, removeVideoWorkFiles } from "./videoPick.ts";
import { hasVideoTables, isExpired, purgeExpiredRows } from "./videoStore.ts";

// 7단계 4.1-2: 30일 지우기. 모든 실행의 start가 한다. 데이터 폴더의 DB·실행 전 사본·영상 작업 파일·사이트 입력과 결과물,
// 그리고 시험 모드가 만든 `.test-data/<KST 시각>[-N]` 폴더(V17)에서 받은 지 30일 지난 YouTube 데이터를 지운다.
// 실행 전 사본과 시험 폴더의 DB는 마이그레이션하지 않고 연다(openDb는 열면서 마이그레이션한다). 영상 표가 없는 DB는 건드리지 않는다.

/** 시험 모드 폴더 이름 모양(settings.ts의 newTestDataDir: `<YYYYMMDD-HHMMSS>`, 겹치면 `-2`, `-3` …) */
export const TEST_DIR_RE = /^(\d{4})(\d{2})(\d{2})-\d{6}(?:-\d+)?$/;

export type OpenResult = { status: "purged"; rows: number } | { status: "noVideos" } | { status: "unreadable" };

/** 마이그레이션 없이 열어 30일 지난 영상 기록만 지운다. SQLite가 아니거나 열 수 없으면 unreadable */
export function purgeDbFileRaw(file: string, today: string): OpenResult {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file);
  } catch {
    return { status: "unreadable" };
  }
  try {
    try {
      db.prepare("SELECT name FROM sqlite_master LIMIT 1").all();
    } catch {
      return { status: "unreadable" };
    }
    if (!hasVideoTables(db)) return { status: "noVideos" };
    return { status: "purged", rows: purgeExpiredRows(db, today) };
  } finally {
    db.close();
  }
}

function walkJson(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(p, out);
    else if (e.isFile() && e.name.endsWith(".json")) out.push(p);
  }
}

/** 폴더 안 JSON 파일(사이트 데이터)에 받은 지 30일 지난 영상이 있는지(`"fetchedOn":"YYYY-MM-DD"`로 찾는다) */
export function dirHasExpiredVideos(dir: string, today: string): boolean {
  if (!fs.existsSync(dir)) return false;
  const files: string[] = [];
  walkJson(dir, files);
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/"fetchedOn":\s*"(\d{4}-\d{2}-\d{2})"/g)) if (isExpired(m[1]!, today)) return true;
  }
  return false;
}

/** 사이트 입력·결과물에 30일 지난 영상이 들어 있으면 두 폴더를 통째로 지운다(다시 빌드하면 생긴다). 지운 폴더 수 */
function purgeSiteDirs(dataDir: string, today: string): number {
  const dirs = [SITE_INPUT_DIR, SITE_OUT_DIR].map((d) => path.join(dataDir, d));
  if (!dirs.some((d) => dirHasExpiredVideos(d, today))) return 0;
  let n = 0;
  for (const d of dirs) {
    if (!fs.existsSync(d)) continue;
    fs.rmSync(d, { recursive: true, force: true });
    n++;
  }
  return n;
}

/** 영상 작업 파일의 받은 날: 후보 목록 JSON의 fetchedOn, 없으면 폴더 이름의 날짜(시험 폴더는 실행 하나만 쓴다) */
function workFetchedOn(dataDir: string, fallback: string | null): string | null {
  const f = path.join(dataDir, WORK_DIR, VIDEO_WORK_NAMES.candidates);
  try {
    const j = JSON.parse(fs.readFileSync(f, "utf8")) as { fetchedOn?: unknown };
    if (typeof j.fetchedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(j.fetchedOn)) return j.fetchedOn;
  } catch {
    // 없거나 읽지 못하면 폴더 날짜를 쓴다
  }
  return fallback;
}

function snapshotFiles(dataDir: string): string[] {
  const dir = path.join(dataDir, SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".db"))
    .sort()
    .map((n) => path.join(dir, n));
}

export interface TestDirPurge {
  /** `.test-data/` 아래 폴더 이름 */
  dir: string;
  rows: number;
  snapshotRows: number;
  workFiles: number;
  siteDirs: number;
  /** 열 수 없어 그대로 둔 DB(폴더 기준 상대 경로) */
  unreadable: string[];
}

export interface VideoPurgeResult {
  /** DB에서 지운 영상 기록 수 */
  rows: number;
  /** 실행 전 사본에서 지운 영상 기록 수 */
  snapshotRows: number;
  /** 열 수 없어 지운 실행 전 사본 파일 이름 */
  removedSnapshots: string[];
  /** 지운 영상 작업 파일 수(지난 실행이 남긴 것) */
  workFiles: number;
  /** 30일 지난 영상이 들어 있어 지운 사이트 입력·결과물 폴더 수 */
  siteDirs: number;
  /** 시험 모드 폴더(V17). 지운 것이 있거나 열 수 없는 DB가 있는 폴더만 */
  testDirs: TestDirPurge[];
}

/** 데이터 폴더의 실행 전 사본·작업 파일·사이트 폴더를 지운다(DB는 부르는 쪽이 purgeExpiredRows로 지운다) */
export function purgeDataDir(dataDir: string, today: string): Omit<VideoPurgeResult, "rows" | "testDirs"> {
  let snapshotRows = 0;
  const removedSnapshots: string[] = [];
  for (const f of snapshotFiles(dataDir)) {
    const r = purgeDbFileRaw(f, today);
    if (r.status === "purged") snapshotRows += r.rows;
    else if (r.status === "unreadable") {
      fs.rmSync(f, { force: true });
      for (const ext of ["-journal", "-wal", "-shm"]) fs.rmSync(`${f}${ext}`, { force: true });
      removedSnapshots.push(path.basename(f));
    }
  }
  // 데이터 폴더의 영상 작업 파일은 지난 실행이 남긴 것이라 받은 날과 관계없이 지운다(4.3-5)
  const workFiles = removeVideoWorkFiles(dataDir);
  const siteDirs = purgeSiteDirs(dataDir, today);
  return { snapshotRows, removedSnapshots, workFiles, siteDirs };
}

/** 시험 모드 폴더들(V17). 지금 실행의 데이터 폴더는 뺀다. 그 밖의 데이터는 그대로 둔다 */
export function purgeTestDirs(toplevel: string, today: string, exclude: string): TestDirPurge[] {
  const root = path.join(toplevel, TEST_DATA_ROOT);
  if (!fs.existsSync(root)) return [];
  const out: TestDirPurge[] = [];
  for (const name of fs.readdirSync(root).sort()) {
    const m = TEST_DIR_RE.exec(name);
    const dir = path.join(root, name);
    if (!m || !fs.statSync(dir).isDirectory() || path.resolve(dir) === path.resolve(exclude)) continue;
    const r: TestDirPurge = { dir: name, rows: 0, snapshotRows: 0, workFiles: 0, siteDirs: 0, unreadable: [] };
    const db = path.join(dir, DB_FILE);
    if (fs.existsSync(db)) {
      const x = purgeDbFileRaw(db, today);
      if (x.status === "purged") r.rows = x.rows;
      else if (x.status === "unreadable") r.unreadable.push(DB_FILE);
    }
    for (const f of snapshotFiles(dir)) {
      const x = purgeDbFileRaw(f, today);
      if (x.status === "purged") r.snapshotRows += x.rows;
      else if (x.status === "unreadable") r.unreadable.push(path.relative(dir, f));
    }
    const fetchedOn = workFetchedOn(dir, `${m[1]}-${m[2]}-${m[3]}`);
    if (fetchedOn !== null && isExpired(fetchedOn, today)) r.workFiles = removeVideoWorkFiles(dir);
    r.siteDirs = purgeSiteDirs(dir, today);
    if (r.rows + r.snapshotRows + r.workFiles + r.siteDirs > 0 || r.unreadable.length > 0) out.push(r);
  }
  return out;
}
