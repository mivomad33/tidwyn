import fs from "node:fs";
import path from "node:path";
import type { KindReport } from "./builderDiscover.ts";
import type { DiscoverKind } from "./discoverStore.ts";
import type { DocReport, SourceReport } from "./builderFetch.ts";
import type { DemandReport } from "./demandFetch.ts";
import type { DemandFlowState } from "./demandFlowRun.ts";
import type { OfficialReport } from "./officialDemand.ts";
import type { FeedFailure } from "./feeds.ts";
import type { IndicatorFetchResult } from "./indicatorFetch.ts";
import type { VideoBundle } from "./siteTypes.ts";
import type { VideoPurgeResult } from "./videoPurge.ts";
import type { ChartReport, ExcludeReason, Usage } from "./youtube.ts";
import type { Violation } from "./validate.ts";

// 실행 기록 파일. start가 만들고, 날짜마다의 결과와 백업 결과를 모아 summary가 읽는다. 데이터 폴더 안에 둔다.

export const RUNS_DIR = "runs";
export const WORK_DIR = "work";

/** 작업 폴더에서 이름 목록의 파일을 지운다. 지운 수 */
export function removeWorkFiles(dataDir: string, names: readonly string[]): number {
  let n = 0;
  for (const name of names) {
    const f = path.join(dataDir, WORK_DIR, name);
    if (fs.existsSync(f)) {
      fs.rmSync(f, { recursive: true, force: true });
      n++;
    }
  }
  return n;
}

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

/** 스냅샷 명령(9.9단계 4.1-1). 호출 수와 시간은 이어 받기까지 더한 값이다 */
export interface RepoSnapshotState {
  status: "noBrief" | "off" | "complete" | "running" | "short" | "crashed";
  target: string | null;
  finished: boolean;
  repos: number;
  calls: number;
  elapsedMs: number;
  reason?: string;
}

/** 새 종류 받기(9.9단계). 수와 상태만 둔다. 이름과 글은 넣지 않는다 */
export interface BuilderKindsState {
  target: string;
  product: KindReport;
  repo: KindReport;
  /** 재료에 요구가 들어 뺀 후보의 키(후보 원본에 있고 공개 검사를 지난 것만, 4.3-3) */
  excluded?: string[];
  /** 그 밖의 제외 값 수 */
  excludedOther?: number;
}

/** 새 종류 쓰기 프로세스(9.9단계 N11). 수와 코드가 정한 문구만 둔다. rounds: 프로세스를 돌린 횟수 */
export interface BuilderWriteState {
  status: "nothing" | "written" | "passed" | "failed";
  target: string | null;
  rounds: number;
  kinds: DiscoverKind[];
  reason?: string;
}

/** 빌더 받기(9.8단계 4.1). 소스 글과 재료는 넣지 않는다. 실패 이유와 경고는 받기 명령이 정한 문구다. kindsOnly: 도구 변화는 끝나 새 종류만 받았다(N9) */
export interface BuilderFetchState {
  status: "noBrief" | "alreadyDone" | "kindsOnly" | "checked" | "partial" | "failed" | "crashed";
  target: string | null;
  sources?: SourceReport[];
  docs?: DocReport[];
  warnings?: string[];
  candidates?: number;
  cut?: number;
  reminders?: number;
  droppedByHost?: number;
  droppedByKey?: number;
  droppedByScan?: number;
  reason?: string;
}

/** 빌더 쓰기·적용(9.8단계 4.3). 글은 넣지 않고 수만 남긴다 */
export interface BuilderApplyState {
  status: "applied" | "alreadyDone" | "failed" | "gaveUp";
  target: string | null;
  attempts: number;
  reason?: string;
  violations?: Violation[];
  items?: number;
  reminders?: number;
  newSchedules?: number;
  linked?: number;
  postponed?: number;
  moved?: number;
  newsKept?: number[];
}

/** 영상 기록 새로 받기(9.6단계 4.2-4). 수와 정해진 이유만 쓴다 */
export interface VideoRefreshState {
  status: "none" | "stopped" | "ok" | "failed";
  targets: number;
  changed: number;
  removed: number;
  units: number;
  /** 이상으로 보고 적용하지 않은 호출 수와 그 호출이 물은 영상 수 */
  suspectCalls: number;
  suspectVideos: number;
  /** 챕터가 바뀌어 구간 정리를 지운 영상 기록 수(9.7단계 C6) */
  sectionsRemoved: number;
  /** 응답에 있지만 읽을 수 없어 그대로 둔 영상 수 */
  unreadable: number;
  /** 상한에 닿아 멈췄다 */
  limited: boolean;
  keyProblem: boolean;
  quota: boolean;
  /** 멈춘 이유(영상 정보 없음) */
  failure: string | null;
  /** DB를 다시 써야 한다. 지우기가 실패해 다시 실행해도 남는다 */
  rewrite?: boolean;
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
  /** 요약을 붙인 영상 수(8단계 4.5-2) */
  withSummary?: number;
  /** 구간 정리를 붙인 영상 수와 구간을 포기한 영상 수(9.7단계 4.3-1) */
  withSections?: number;
  sectionsGivenUp?: number;
  /** 적용 뒤 지운 영상 작업 파일 수 */
  cleaned?: number;
  reason?: string;
  violations?: Violation[];
}

/**
 * 영상 내용 확인 결과(8단계 4.1). 영상 ID·제목·메모는 쓰지 않고 수만 쓴다(4.4-4). attempts는 확인 후보 검사를 통과하지 못한 횟수,
 * rejected는 고쳐서 다시 검사할 차례, alreadyDone은 고르기 끝남이라 부르지 않은 것이다
 */
/** 9.7단계 구간 시각 받기(`video-sections`). 수와 정해진 이유만 남긴다 */
export interface VideoSectionsState {
  status: "done" | "alreadyDone" | "stopped" | "failed";
  target: string | null;
  targets?: number;
  received?: number;
  failures?: Record<string, number>;
  notCalled?: number;
  stop?: string;
  timeLimit?: boolean;
  costCap?: boolean;
  input?: number;
  output?: number;
  usd?: number;
  reason?: string;
}

export interface VideoNotesState {
  status: "rejected" | "done" | "alreadyDone";
  target: string | null;
  attempts: number;
  violations?: Violation[];
  /** 위반이 세 번 나와 그때까지 받은 메모만 남기고 넘어갔다(4.2-1) */
  gaveUp?: boolean;
  candidates?: number;
  noted?: number;
  failures?: Record<string, number>;
  notCalled?: number;
  stop?: string;
  timeLimit?: boolean;
  costCap?: boolean;
  input?: number;
  output?: number;
  usd?: number;
}

/** 9.95단계 수요 스냅샷(`demand-fetch`). 수와 사유 종류만 남긴다(받은 글은 남기지 않는다) */
export type DemandFetchState = Omit<DemandReport, "day"> & {
  status: "done" | "off" | "crashed";
  /** 받은 날짜(KST). 시험 모드는 null */
  day: string | null;
  dbBytes: number | null;
  reason?: string;
};

/** 9.96단계 공식 수요(`demand-official`). 같은 실행 기록의 호출을 합친 값이다. 수와 사유 종류만 남긴다 */
export type OfficialDemandState = Omit<OfficialReport, "day"> & {
  status: "done" | "off" | "crashed";
  day: string | null;
  dbBytes: number | null;
  /** 이 실행 기록으로 부른 횟수(4.3-2: 세 번째부터는 받지 않는다) */
  calls: number;
  reason?: string;
};

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
  /** 9.6단계: 영상 기록 새로 받기. 앞 단계 실행 기록에는 없다 */
  videoRefresh?: VideoRefreshState;
  videoPurge?: VideoPurgeResult;
  videoFetch?: VideoFetchState;
  /** 8단계: 영상 내용 확인. 앞 단계 실행 기록에는 없다 */
  videoNotes?: VideoNotesState;
  videoSections?: VideoSectionsState;
  videoPick?: VideoPickState;
  /** 9.8단계: start가 예정한 빌더 대상 날짜, 받기, 적용. 앞 단계 실행 기록에는 없다 */
  builderPlanned?: { date: string | null; done: boolean };
  builderFetch?: BuilderFetchState;
  builderApply?: BuilderApplyState;
  /** 9.9단계: 스냅샷 명령과 새 종류 받기. 앞 단계 실행 기록에는 없다 */
  repoSnapshot?: RepoSnapshotState;
  builderKinds?: BuilderKindsState;
  builderWrite?: BuilderWriteState;
  /** 9.95단계: 수요 스냅샷. 앞 단계 실행 기록에는 없다 */
  demandFetch?: DemandFetchState;
  /** 9.96단계: 공식 수요와, 그 실행에서 전용 DB 실행 전 사본을 이미 만들었는지(4.1-6). 앞 단계 실행 기록에는 없다 */
  officialDemand?: OfficialDemandState;
  /** 9.97단계: 수요 흐름. 앞 단계 실행 기록에는 없다 */
  demandFlow?: DemandFlowState;
  demandCopied?: boolean;
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
