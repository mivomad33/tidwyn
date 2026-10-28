import fs from "node:fs";
import path from "node:path";
import type { FeedFailure } from "./feeds.ts";
import type { Violation } from "./validate.ts";

// 실행 기록 파일. start가 만들고, 날짜마다의 결과와 백업 결과를 모아 summary가 읽는다. 데이터 폴더 안에 둔다.

export const RUNS_DIR = "runs";
export const WORK_DIR = "work";

export type DateResult =
  | { status: "saved"; markdownPath: string | null; markdownError?: string; images?: number }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; violations?: Violation[] };

export type BackupResult =
  | { status: "committed"; commit: string; exportDir: string }
  | { status: "unchanged"; exportDir: string }
  | { status: "exported"; exportDir: string; reason: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; error: string };

/** 날짜별 연결 결과(2단계 4.2) */
export type LinkResult =
  | { status: "applied"; linked: number; attached: number; newIssues: number }
  | { status: "nothing" }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 합치기 단계 결과(2단계 4.3) */
export type MergeStepResult =
  | { status: "notDue"; nextOn: string | null }
  | { status: "pending"; candidates: number }
  | { status: "none"; candidates: number }
  | { status: "merged"; merges: { id: number; survivor: number; survivorName: string; absorbed: number; absorbedName: string; reason: string }[] }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 지난 날짜 이미지 채우기 결과(3단계 4.4-2) */
export type ImagesResult = { status: "done"; filled: number; failures: FeedFailure[] } | { status: "failed"; reason: string };

/** 사이트 빌드 결과(3단계 4.1, 4.5) */
export type SiteResult =
  | { status: "built"; outDir: string; dates: number; issues: number; files: number; bytes: number }
  | { status: "failed"; outDir: string; reason: string; findings?: string[] };

/** 배포 뒤 점검(3단계 4.6-3) */
export type PostDeployCheck = { status: "passed"; latestDate: string | null } | { status: "failed"; reason: string };

/** 배포 결과(3단계 4.6) */
export type DeployResult =
  | { status: "deployed"; url: string; deploymentUrl: string | null; check: PostDeployCheck }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; findings?: string[] };

/** data 브랜치 push 결과(3단계 4.5-1). findings는 값을 가린 공개 전 점검 결과 */
export type PushResult =
  | { status: "pushed"; commits: number }
  | { status: "upToDate" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string; findings?: string[] };

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
  /** 날짜별 후보 목록 결과(1.5단계 4.1-5). 1단계 실행 기록에는 없다 */
  feeds?: Record<string, { counts: Record<string, { fetched: number; inWindow: number }>; failures: FeedFailure[] }>;
  /** start 때 이슈가 없는 뉴스가 있던 저장된 날짜(2단계 4.2-1). 1·1.5단계 실행 기록에는 없다 */
  linkDates?: string[];
  links?: Record<string, LinkResult>;
  merge?: MergeStepResult;
  /** 지난 날짜 이미지 채우기(3단계). 1·1.5·2단계 실행 기록에는 없다 */
  images?: ImagesResult;
  /** 사이트 빌드·배포·push(3단계). start가 null로 두고 각 명령이 채운다. 앞 단계 실행 기록에는 없다 */
  site?: SiteResult | null;
  deploy?: DeployResult | null;
  push?: PushResult | null;
}

export function workFile(dataDir: string, date: string): string {
  return path.join(dataDir, WORK_DIR, `${date}.json`);
}

/** 날짜의 연결 작업 파일: 연결할 뉴스와 후보 이슈(md), Claude가 쓰는 연결 파일(links.json) */
export function linkWorkFile(dataDir: string, date: string, kind: "issues.md" | "links.json"): string {
  return path.join(dataDir, WORK_DIR, `${date}.${kind}`);
}

/** 합치기 후보(md)와 Claude가 쓰는 합치기 파일(json) */
export function mergeWorkFile(dataDir: string, kind: "candidates.md" | "json"): string {
  return path.join(dataDir, WORK_DIR, kind === "json" ? "merges.json" : "merges.candidates.md");
}

/** 대상일의 후보 목록 파일(1.5단계 4.1-1). JSON은 전체, md는 Claude가 읽는 짧은 목록이다 */
export function candidatesFile(dataDir: string, date: string, ext: "json" | "md" = "json"): string {
  return path.join(dataDir, WORK_DIR, `${date}.candidates.${ext}`);
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
