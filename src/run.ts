import fs from "node:fs";
import path from "node:path";
import type { Violation } from "./validate.ts";

// 실행 기록 파일. start가 만들고, 날짜마다의 결과와 백업 결과를 모아 summary가 읽는다. 데이터 폴더 안에 둔다.

export const RUNS_DIR = "runs";
export const WORK_DIR = "work";

export type DateResult =
  | { status: "saved"; markdownPath: string | null; markdownError?: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; violations?: Violation[] };

export type BackupResult =
  | { status: "committed"; commit: string; exportDir: string }
  | { status: "unchanged"; exportDir: string }
  | { status: "exported"; exportDir: string; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

export interface RunState {
  startedAt: string;
  mode: "real" | "test" | "custom";
  dataDir: string;
  dbPath: string;
  backupRepo: string | null;
  noCommitReason: string | null;
  targetDates: string[];
  results: Record<string, DateResult>;
  backup: BackupResult | null;
}

export function workFile(dataDir: string, date: string): string {
  return path.join(dataDir, WORK_DIR, `${date}.json`);
}

export function writeRun(file: string, state: RunState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
}

export function readRun(file: string): RunState {
  return JSON.parse(fs.readFileSync(file, "utf8")) as RunState;
}

export function updateRun(file: string, change: (s: RunState) => void): RunState {
  const state = readRun(file);
  change(state);
  writeRun(file, state);
  return state;
}
