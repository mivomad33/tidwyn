import fs from "node:fs";
import path from "node:path";
import type { FeedFailure } from "./feeds.ts";
import type { IndicatorFetchResult } from "./indicatorFetch.ts";
import type { VideoBundle } from "./siteTypes.ts";
import type { VideoPurgeResult } from "./videoPurge.ts";
import type { ChartReport, ExcludeReason, Usage } from "./youtube.ts";
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

/** 날짜별 뽑기 결과(4단계 4.2) */
export type ExtractResult =
  | { status: "applied"; entityLinks: number; termLinks: number; newEntities: number; newTerms: number; descriptions: number }
  | { status: "nothing" }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 날짜별 일정 뽑기 결과(5단계 4.2) */
export type ScheduleResult =
  | { status: "applied"; newSchedules: number; attached: number; results: number; postponed: number; cancelled: number; confirmed: number }
  | { status: "nothing" }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 합친 일정 하나(5단계 4.3) */
export interface ScheduleMergeDone {
  id: number;
  survivor: number;
  survivorName: string;
  absorbed: number;
  absorbedName: string;
  reason: string;
}

/** 합친 대상·용어 하나(4단계 4.3) */
export interface RefMergeDone {
  id: number;
  item: "entity" | "term";
  survivor: number;
  survivorName: string;
  absorbed: number;
  absorbedName: string;
  reason: string;
}

/** 합치기 단계 결과(2단계 4.3). 후보 수에는 4단계 대상·용어 쌍과 5단계 일정 쌍도 든다. refs는 4단계 대상·용어, schedules는 5단계 일정 합치기 */
export type MergeStepResult =
  | { status: "notDue"; nextOn: string | null }
  | { status: "pending"; candidates: number }
  | { status: "none"; candidates: number }
  | {
      status: "merged";
      merges: { id: number; survivor: number; survivorName: string; absorbed: number; absorbedName: string; reason: string }[];
      refs?: RefMergeDone[];
      schedules?: ScheduleMergeDone[];
    }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 지난 날짜 이미지 채우기 결과(3단계 4.4-2) */
export type ImagesResult = { status: "done"; filled: number; failures: FeedFailure[] } | { status: "failed"; reason: string };

/** 지표 판단 파일 하나의 결과(6단계 4.3) */
export type JudgeResult =
  | { status: "applied"; issues: number; chosen: number }
  | { status: "failed"; reason: string; violations?: Violation[] };

/** 지표 판단 단계(6단계 4.3): 나눈 파일과 파일마다의 결과 */
export interface IndicatorJudgeState {
  files: { n: number; issues: number[] }[];
  results: Record<string, JudgeResult>;
}

/**
 * 영상 받기 결과(7단계 4.2). 영상 ID·제목은 넣지 않고 수만 남긴다(4.8-3). 차트는 지역과 카테고리 ID 숫자로만 쓴다.
 * alreadyDone은 대상 날짜가 이미 고르기 끝남이라 부르지 않은 것, noBrief는 브리프가 없어 건너뛴 것이다
 */
export interface VideoFetchState {
  status: "ok" | "partial" | "failed" | "alreadyDone" | "noBrief";
  target: string | null;
  keyProblem?: boolean;
  quota?: boolean;
  failures?: string[];
  missed?: string[];
  charts?: ChartReport[];
  searchResults?: Record<string, number>;
  usage?: Usage;
  /** 거르기 전(중복을 뺀) 수, 이유별로 뺀 수, 후보 수, 관련 이슈 후보 수 */
  before?: number;
  excluded?: Record<ExcludeReason, number>;
  candidates?: number;
  issueCandidates?: number;
}

/** 영상 고르기 결과(7단계 4.3). attempts는 검사를 통과하지 못한 적용 횟수(처음 + 고쳐서 다시 검사 최대 2번) */
export interface VideoPickState {
  status: "applied" | "failed" | "alreadyDone";
  target: string | null;
  attempts: number;
  picked?: Record<VideoBundle, number>;
  /** 관련 이슈를 붙인 영상 수 */
  withIssues?: number;
  /** 적용 뒤 지운 영상 작업 파일 수 */
  cleaned?: number;
  reason?: string;
  violations?: Violation[];
}

/** 사이트 빌드 결과(3단계 4.1, 4.5) */
export type SiteResult =
  | { status: "built"; outDir: string; dates: number; issues: number; entities?: number; terms?: number; schedules?: number; upcoming?: number; indicators?: number; videoDates?: number; videos?: number; files: number; bytes: number }
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
  /** start 때 뽑기 안 한 저장된 날짜(4단계 4.2-1). 앞 단계 실행 기록에는 없다 */
  extractDates?: string[];
  extracts?: Record<string, ExtractResult>;
  /** start 때 일정 뽑기 안 한 저장된 날짜(5단계 4.2-1). 앞 단계 실행 기록에는 없다 */
  scheduleDates?: string[];
  schedules?: Record<string, ScheduleResult>;
  /** 지표 판단(6단계 4.3)과 지표 받기(4.2). 앞 단계 실행 기록에는 없다 */
  indicatorJudge?: IndicatorJudgeState;
  indicatorFetch?: IndicatorFetchResult;
  /** start 때 지표 판단 안 한 이슈 수(6단계 4.5-1) */
  unjudgedAtStart?: number;
  /** 7단계: start가 예정한 영상 대상 날짜, 30일 지우기, 영상 받기와 고르기. 앞 단계 실행 기록에는 없다 */
  videoPlanned?: { date: string | null; done: boolean };
  videoPurge?: VideoPurgeResult;
  videoFetch?: VideoFetchState;
  videoPick?: VideoPickState;
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

/** 날짜의 뽑기 작업 파일: 그날 뉴스와 후보 대상·용어(md), Claude가 쓰는 뽑기 파일(json). 4단계 4.2 */
export function refWorkFile(dataDir: string, date: string, kind: "refs.md" | "refs.json"): string {
  return path.join(dataDir, WORK_DIR, `${date}.${kind}`);
}

/** 날짜의 일정 뽑기 작업 파일: 그날 뉴스와 기존 일정·결과 후보(md), Claude가 쓰는 일정 파일(json). 5단계 4.2 */
export function scheduleWorkFile(dataDir: string, date: string, kind: "schedules.md" | "schedules.json"): string {
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
