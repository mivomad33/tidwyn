import fs from "node:fs";
import path from "node:path";
import { kstStamp } from "./kst.ts";

// 실행 전 DB 사본(4.3-4, S5, D13)

export const SNAPSHOT_DIR = "snapshots";
export const SNAPSHOT_KEEP_DAYS = 14;
export const SNAPSHOT_NAME_RE = /^tidwyn-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

/** 사본 파일 이름의 시각(KST로 적혀 있다) */
function snapshotTime(name: string): number | null {
  const m = SNAPSHOT_NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`);
}

/** DB가 있으면 시각이 붙은 사본을 남긴다. 만든 사본 경로(DB가 없으면 null) */
export function takeSnapshot(dataDir: string, dbPath: string, now: Date): string | null {
  if (!fs.existsSync(dbPath)) return null;
  const dir = path.join(dataDir, SNAPSHOT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `tidwyn-${kstStamp(now)}.db`);
  for (let i = 1; fs.existsSync(file); i++) file = path.join(dir, `tidwyn-${kstStamp(new Date(now.getTime() + i * 1000))}.db`);
  fs.copyFileSync(dbPath, file, fs.constants.COPYFILE_EXCL);
  return file;
}

/** 14일보다 오래된 사본을 지운다. 지운 파일 이름 목록 */
export function pruneSnapshots(dataDir: string, now: Date): string[] {
  const dir = path.join(dataDir, SNAPSHOT_DIR);
  if (!fs.existsSync(dir)) return [];
  const limit = now.getTime() - SNAPSHOT_KEEP_DAYS * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    const t = snapshotTime(name);
    if (t !== null && t < limit) {
      fs.rmSync(path.join(dir, name));
      removed.push(name);
    }
  }
  return removed.sort();
}
