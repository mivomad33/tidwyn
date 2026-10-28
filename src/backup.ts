import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { StoredBrief } from "./brief.ts";
import { openDb } from "./db.ts";
import { git, gitTry } from "./git.ts";
import { getFirstCollectionDate, loadBrief, recordFirstCollectionDate, saveBrief, storedDates } from "./store.ts";

// 월별 JSON 백업(4.5-1), data 브랜치 커밋(4.5-2), 복원(4.5-3)

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_DIR = "backup";
export const DATA_REF = "refs/heads/data";
const META_FILE = "meta.json";
const MONTH_RE = /^\d{4}-\d{2}\.json$/;

interface MetaFile {
  formatVersion: number;
  firstCollectionDate: string | null;
}

interface MonthFile {
  formatVersion: number;
  month: string;
  briefs: StoredBrief[];
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** 백업 파일 이름 → 내용 */
export function buildBackup(db: DatabaseSync): Map<string, string> {
  const files = new Map<string, string>();
  const meta: MetaFile = { formatVersion: BACKUP_FORMAT_VERSION, firstCollectionDate: getFirstCollectionDate(db) };
  files.set(META_FILE, toJson(meta));
  const byMonth = new Map<string, StoredBrief[]>();
  for (const date of storedDates(db)) {
    const stored = loadBrief(db, date);
    if (stored === null) continue;
    const month = date.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(stored);
    byMonth.set(month, list);
  }
  for (const [month, briefs] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    const file: MonthFile = { formatVersion: BACKUP_FORMAT_VERSION, month, briefs };
    files.set(`${month}.json`, toJson(file));
  }
  return files;
}

/** DB 전체를 내보내기 폴더에 쓴다. 내용이 같은 파일은 다시 쓰지 않고, DB에 없는 달의 파일은 지운다 */
export function exportBackup(db: DatabaseSync, exportDir: string): Map<string, string> {
  const files = buildBackup(db);
  fs.mkdirSync(exportDir, { recursive: true });
  for (const name of fs.readdirSync(exportDir)) {
    if (name.endsWith(".json") && !files.has(name)) fs.rmSync(path.join(exportDir, name));
  }
  for (const [name, content] of files) {
    const file = path.join(exportDir, name);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) continue;
    fs.writeFileSync(file, content);
  }
  return files;
}

export type CommitResult = { committed: true; commit: string } | { committed: false; reason: string };

/**
 * 백업 파일을 data 브랜치에 커밋한다. 작업 트리·HEAD·체크아웃된 브랜치는 건드리지 않는다(임시 인덱스와 git 저수준 명령만 쓴다).
 * data 브랜치의 트리는 백업 파일만으로 새로 만든다(코드 없음, 없는 달 파일은 빠진다). 바뀐 것이 없으면 커밋하지 않는다.
 */
export function commitBackup(files: Map<string, string>, repoDir: string, message: string, indexFile: string): CommitResult {
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    git(repoDir, ["read-tree", "--empty"], { env });
    for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const blob = git(repoDir, ["hash-object", "-w", "--stdin", "--no-filters"], { input: content }).trim();
      git(repoDir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${name}`], { env });
    }
    const tree = git(repoDir, ["write-tree"], { env }).trim();
    const parent = gitTry(repoDir, ["rev-parse", "--verify", "--quiet", `${DATA_REF}^{commit}`])?.trim() ?? null;
    if (parent !== null && git(repoDir, ["rev-parse", `${parent}^{tree}`]).trim() === tree) {
      return { committed: false, reason: "바뀐 것이 없다" };
    }
    const commitArgs = ["commit-tree", tree, "-m", message];
    if (parent !== null) commitArgs.push("-p", parent);
    const commit = git(repoDir, commitArgs).trim();
    git(repoDir, ["update-ref", "-m", "tidwyn backup", DATA_REF, commit, parent ?? "0".repeat(40)]);
    return { committed: true, commit };
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

export function backupMessage(dates: string[]): string {
  return dates.length > 0 ? `Backup briefs: ${dates.join(", ")}` : "Backup briefs";
}

/** 폴더의 백업 파일을 읽는다 */
export function readBackupDir(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === META_FILE || MONTH_RE.test(name)) files.set(name, fs.readFileSync(path.join(dir, name), "utf8"));
  }
  return files;
}

/** 저장소의 refs/heads/data에서 백업 파일을 바로 읽는다 */
export function readBackupRef(repoDir: string): Map<string, string> {
  if (gitTry(repoDir, ["rev-parse", "--verify", "--quiet", `${DATA_REF}^{commit}`]) === null) {
    throw new Error(`백업 저장소에 data 브랜치가 없다: ${repoDir}`);
  }
  const files = new Map<string, string>();
  const names = git(repoDir, ["ls-tree", "--name-only", DATA_REF]).split("\n").filter((n) => n.length > 0);
  for (const name of names) {
    if (name === META_FILE || MONTH_RE.test(name)) files.set(name, git(repoDir, ["cat-file", "blob", `${DATA_REF}:${name}`]));
  }
  return files;
}

function checkVersion(name: string, value: { formatVersion?: unknown }): void {
  if (value.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(`${name}의 형식 버전 ${String(value.formatVersion)}을(를) 알 수 없다(이 코드는 ${BACKUP_FORMAT_VERSION}만 읽는다)`);
  }
}

/**
 * 백업 파일로 DB를 새로 만든다. 이미 있는 경로는 force가 없으면 거부한다.
 * 임시 파일에 다 만든 뒤 옮기므로, 도중에 실패해도 기존 DB가 반쯤 바뀌지 않는다.
 */
export function restoreBackup(files: Map<string, string>, outPath: string, force = false): { dates: number } {
  if (fs.existsSync(outPath) && !force) throw new Error(`이미 DB가 있다: ${outPath} (덮어쓰려면 --force)`);
  const metaText = files.get(META_FILE);
  if (metaText === undefined) throw new Error(`백업에 ${META_FILE}이 없다`);
  const meta = JSON.parse(metaText) as MetaFile;
  checkVersion(META_FILE, meta);
  const months: MonthFile[] = [];
  for (const [name, text] of files) {
    if (!MONTH_RE.test(name)) continue;
    const m = JSON.parse(text) as MonthFile;
    checkVersion(name, m);
    months.push(m);
  }
  const tmp = `${outPath}.restoring`;
  fs.rmSync(tmp, { force: true });
  const db = openDb(tmp);
  let dates = 0;
  try {
    if (meta.firstCollectionDate !== null) recordFirstCollectionDate(db, meta.firstCollectionDate);
    for (const m of months) {
      for (const stored of m.briefs) {
        saveBrief(db, stored);
        dates++;
      }
    }
  } catch (e) {
    db.close();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  db.close();
  fs.renameSync(tmp, outPath);
  return { dates };
}
