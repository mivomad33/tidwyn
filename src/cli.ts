import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { BACKUP_DIR, backupMessage, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "./backup.ts";
import { openDb, openExistingDb } from "./db.ts";
import { gitTry } from "./git.ts";
import { collectCandidates, describeFeedReport, feedSpecs, fetchText as realFetch, renderCandidatesMarkdown, type FetchText } from "./feeds.ts";
import { attachImages, dropImages, fillImages, readCandidateImages } from "./images.ts";
import { issueIndexPath, renderAll, writeBriefMarkdown } from "./issueMarkdown.ts";
import { linkableDates, unlinkedCount, unlinkedStories } from "./issues.ts";
import { isValidDate, kstDate, kstIso, kstStamp } from "./kst.ts";
import { applyLinkPlan, checkLinkFile, renderLinkWork, renderSearch } from "./links.ts";
import { markdownPath, writeMarkdown } from "./markdown.ts";
import { applyRefPlan, checkRefFile, renderRefSearch, renderRefWork } from "./extract.ts";
import { applyMerges, checkMergeFile, describeMerges, markMergeChecked, mergeCandidates, mergeDue, renderMergeCandidates, unmerge } from "./merge.ts";
import { applyRefMerges, checkRefMerges, deleteRef, describeRefMerges, refMergeCandidates, renderRefMergeCandidates, unmergeRef, type RefMergeEntry } from "./refMerge.ts";
import { applySchedulePlan, checkScheduleFile, dueText, renderScheduleSearch, renderScheduleWork } from "./scheduleExtract.ts";
import {
  applyScheduleMerges,
  checkScheduleMerges,
  deleteSchedule,
  describeScheduleMerges,
  renderScheduleMergeCandidates,
  scheduleMergeCandidates,
  unmergeSchedule,
  type ScheduleMergeEntry,
} from "./scheduleMerge.ts";
import { getSchedule, isScheduled, schedulableDates } from "./schedules.ts";
import { deletedNameWarning, ensureNameKey, extractableDates, isExtracted, readNameKey, refState, type RefItem } from "./refs.ts";
import { priorityRatio } from "./outlets.ts";
import { repoInfo, requireRepo } from "./paths.ts";
import { indicatorDef } from "./indicators.ts";
import { fetchAllIndicators, fetchHttp, type HttpJson, type IndicatorFetchResult } from "./indicatorFetch.ts";
import { applyJudgeFile, checkJudgeFile, judgeBatches, judgeWorkFile, readJudgeFile, renderJudgeCandidates } from "./indicatorJudge.ts";
import { unjudgedIssues } from "./indicatorStore.ts";
import { readKeys, secretValues, maskSecrets } from "./keys.ts";
import { buildCandidateFile, checkPickFile, readCandidateFile, readJsonFile, removeVideoWorkFiles, restoreCandidateLists, videoWorkFile, writeCandidateFiles } from "./videoPick.ts";
import { purgeDataDir, purgeTestDirs, type VideoPurgeResult } from "./videoPurge.ts";
import { applyVideoPick, isPicked, issueCandidates, purgeExpiredRows, recentVideoIds, videoTargetDate } from "./videoStore.ts";
import { EXCLUDE_LABELS, YoutubeClient, fetchVideos, fetchYoutube, type ExcludeReason, type Usage, type YoutubeHttp } from "./youtube.ts";
import { VIDEO_BUNDLES, type VideoBundle } from "./siteTypes.ts";
import { commitsOfRefs, describeFindings, homeValue, localBranches, precheck } from "./precheck.ts";
import {
  DEFAULT_CHECK_RETRY,
  WARN_BYTES,
  WARN_FILES,
  buildSite,
  cliVercel,
  deployOutput,
  deployPreview,
  fetchGet,
  formatMb,
  gitRemote,
  nodeSiteBuilder,
  pushDataBranch,
  type CheckRetry,
  type HttpGet,
  type RemoteGit,
  type SiteBuilder,
  type VercelRunner,
} from "./publish.ts";
import {
  RUNS_DIR,
  candidatesFile,
  linkWorkFile,
  refWorkFile,
  scheduleWorkFile,
  mergeWorkFile,
  readRun,
  updateRun,
  workFile,
  writeRun,
  type BackupResult,
  type DeployResult,
  type ExtractResult,
  type ImagesResult,
  type JudgeResult,
  type LinkResult,
  type MergeStepResult,
  type PushResult,
  type RefMergeDone,
  type RunState,
  type ScheduleMergeDone,
  type ScheduleResult,
  type SiteResult,
  type VideoFetchState,
  type VideoPickState,
} from "./run.ts";
import { DB_FILE, ENV_DATA_DIR, checkRunCondition, describeSettings, parseArgs, resolveSettings, type Settings } from "./settings.ts";
import { pruneSnapshots, takeSnapshot } from "./snapshot.ts";
import { AlreadyStoredError, hasBrief, loadBrief, recordFirstCollectionDate, saveBrief } from "./store.ts";
import { isLate, planTargets } from "./targets.ts";
import { formatViolations, validateBrief, type Violation } from "./validate.ts";

// /brief 스킬이 부르는 명령들. 런타임 의존성 없이 Node 내장 기능과 git만 쓴다.

export const EXIT = { ok: 0, failed: 1, usage: 2, refused: 3, installFailed: 4 } as const;

export interface Installer {
  (projectDir: string): { ok: true } | { ok: false; message: string };
}

export interface Context {
  cwd: string;
  env: NodeJS.ProcessEnv;
  now: () => Date;
  out: (text: string) => void;
  /** 의존성 맞추기(4.1-2) */
  install: Installer;
  /** 피드 받기(1.5단계 4.1). 없으면 실제 네트워크를 쓴다 */
  fetchText?: FetchText;
  /** 구글 뉴스 요청 사이 간격(밀리초). 없으면 1초 */
  feedGapMs?: number;
  /** 사이트 빌더(3단계 4.1). 없으면 `node site/build.ts --data <입력> --out <결과물>` */
  buildSite?: SiteBuilder;
  /** vercel CLI 실행(3단계 4.6-1). 없으면 node_modules/.bin/vercel */
  runVercel?: VercelRunner;
  /** 배포 뒤 점검의 HTTP GET(3단계 4.6-3). 없으면 fetch */
  httpGet?: HttpGet;
  /** 배포 뒤 점검의 재시도. 없으면 6번, 5초 간격 */
  checkRetry?: CheckRetry;
  /** 원격 저장소 작업(3단계 4.5-1의 push). 없으면 git */
  remote?: RemoteGit;
  /** 지표 출처 요청(6단계 4.2). 없으면 fetch */
  indicatorHttp?: HttpJson;
  /** 지표 출처 요청 사이·다시 시도 간격(밀리초). 없으면 0.3초·2초 */
  indicatorGapMs?: number;
  /** YouTube 요청(7단계 4.2). 없으면 fetch */
  youtubeHttp?: YoutubeHttp;
  /** YouTube 한 실행 상한(검색 횟수, 그 밖의 단위). 없으면 90번, 2,000단위. 테스트가 낮춰 넣는다 */
  youtubeLimits?: Usage;
  /** YouTube 다시 시도 간격(밀리초). 없으면 2초 */
  youtubeRetryGapMs?: number;
}

/** 의존성 잠금 파일대로, 잠금 파일을 바꾸지 않고 대화형 확인 없이 설치한다 */
export const pnpmInstall: Installer = (projectDir) => {
  const r = spawnSync("pnpm", ["install", "--frozen-lockfile", "--config.confirmModulesPurge=false"], {
    cwd: projectDir,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status === 0) return { ok: true };
  const detail = (r.error?.message ?? `${r.stdout}\n${r.stderr}`).trim().split("\n").slice(-15).join("\n");
  return { ok: false, message: `의존성 설치(pnpm install --frozen-lockfile)가 실패했다:\n${detail}` };
};

const USAGE = `명령:
  check [test] [YYYY-MM-DD]     인자와 실행 조건만 확인(아무것도 쓰지 않음)
  start [test] [YYYY-MM-DD]     인자·실행 조건 확인 → 의존성 맞추기 → 설정 표시 → 실행 전 사본 → 대상 날짜
  feeds --run <파일> --date <날짜>      대상일의 우선 출처 후보 목록(work/<날짜>.candidates.md, 전체는 .json)
  validate --run <파일> --date <날짜>   작업 파일(work/<날짜>.json) 검사
  save --run <파일> --date <날짜>       검사 → 저장 → 마크다운
  fail --run <파일> --date <날짜> --reason <이유>   조사 실패 기록
  images --run <파일>            지난 날짜 이미지 채우기(공식 RSS를 다시 받아 이미지 주소가 없는 출처를 채운다)
  backup [--run <파일>]          월별 JSON 내보내기와 data 브랜치 커밋
  site --run <파일> | --data-dir <폴더>   사이트 빌드(<데이터 폴더>/site/)와 결과물 검사
  deploy --run <파일>            실제 실행이면 결과물 검사 → Vercel 운영 배포 → 배포 뒤 점검(시험·지정 모드는 건너뜀)
  deploy --dir <결과물> --db <DB>   손으로 하는 배포(실행 기록 없이, 모드와 상관없이 배포한다)
  deploy --dir <결과물> --preview  미리보기 배포(운영 주소는 바뀌지 않는다, 로그인해야 열린다)
  push --run <파일>              실제 실행이면 원격보다 앞선 data 커밋에 공개 전 점검 → git push origin data
  precheck [--refs main,data]    공개 전 점검(기본: 모든 로컬 브랜치의 이력 + 추적하는 지금 파일)
  summary --run <파일>           실행 끝 출력
  render --date <날짜> | --all [--run <파일>]   DB에서 마크다운 다시 만들기(--all: 모든 브리프와 이슈 마크다운)
  restore [--repo <저장소> | --from <폴더>] [--out <DB 경로>] [--force]   백업에서 DB 복원
이슈(2단계):
  issues --run <파일> --date <날짜>       연결할 뉴스와 후보 이슈 목록(work/<날짜>.issues.md)
  issue-search [--run <파일>] --q <낱말>  이름·별칭·요약으로 이슈 찾기
  link-check --run <파일> --date <날짜>   연결 파일(work/<날짜>.links.json) 검사
  link-apply --run <파일> --date <날짜>   검사 → 적용 → 마크다운(실패하면 실행 기록에 남긴다)
  merge-list --run <파일>                 합치기 주기 확인과 후보 목록(work/merges.candidates.md)
  merge-check --run <파일>                합치기 파일(work/merges.json) 검사
  merge-apply --run <파일>                검사 → 합치기 → 점검일 갱신 → 마크다운
  merges [--run <파일>]                   합치기 기록 목록(이슈, 대상·용어, 일정)
  unmerge --id <번호>                     합치기 하나 되돌리기(사용자가 직접 실행, /brief는 실행하지 않음)
인물·기관·국가와 용어(4단계):
  refs --run <파일> --date <날짜>         그날 뉴스와 후보 대상·용어 목록(work/<날짜>.refs.md)
  ref-search [--run <파일>] --q <낱말>    이름·별칭·설명으로 대상·용어 찾기(지운 이름과 같으면 알린다)
  ref-check --run <파일> --date <날짜>    뽑기 파일(work/<날짜>.refs.json) 검사
  ref-apply --run <파일> --date <날짜>    검사 → 적용 → 뽑기 완료(실패하면 실행 기록에 남긴다)
  ref-unmerge --id <번호>                 대상·용어 합치기 하나 되돌리기(사용자가 직접 실행, /brief는 실행하지 않음)
  ref-delete --entity <번호> | --term <번호>   대상이나 용어 하나 지우기(사용자가 직접 실행, /brief는 실행하지 않음)
일정(5단계):
  schedules --run <파일> --date <날짜>    그날 뉴스와 기존 일정·결과 후보 목록(work/<날짜>.schedules.md)
  schedule-search [--run <파일>] --q <낱말> [--from <날짜>] [--to <날짜>]   이름의 낱말과 예정일 범위로 일정 찾기(지운 일정과 같으면 알린다)
  schedule-check --run <파일> --date <날짜>   일정 파일(work/<날짜>.schedules.json) 검사
  schedule-apply --run <파일> --date <날짜>   검사 → 적용 → 일정 뽑기 완료(실패하면 실행 기록에 남긴다)
  schedule-unmerge --id <번호>            일정 합치기 하나 되돌리기(사용자가 직접 실행, /brief는 실행하지 않음)
  schedule-delete --id <번호>             일정 하나 지우기(사용자가 직접 실행, /brief는 실행하지 않음)
지표(6단계):
  indicator-list --run <파일>             지표 판단 안 한 이슈를 파일로 나눠 후보 목록(work/indicators.candidates-<번호>.md)
  indicator-check --run <파일> --file <번호>   판단 파일(work/indicators.judge-<번호>.json) 검사
  indicator-apply --run <파일> --file <번호>   검사 → 파일 단위로 적용(실패하면 실행 기록에 남긴다)
  indicator-fetch --run <파일>            12개 지표를 ECOS·FRED에서 받아 저장(지표 하나가 실패해도 계속한다)
영상(7단계):
  video-fetch --run <파일>                가장 늦은 브리프 날짜의 영상 받기(차트·검색·상세·거르기) → 후보 목록(work/videos.candidates.md). 이미 고르기 끝남이면 YouTube를 부르지 않는다
  video-check --run <파일>                고르기 파일(work/videos.pick.json) 검사
  video-apply --run <파일>                검사 → 한 번에 적용 → 고르기 끝남 → 영상 작업 파일 지우기(실패하면 실행 기록에 남기고 파일을 남긴다)`;

function opts(argv: string[], options: Record<string, { type: "string" | "boolean" }>) {
  return parseNodeArgs({ args: argv, options, allowPositionals: false, strict: true }).values as Record<string, string | boolean | undefined>;
}

function need(values: Record<string, string | boolean | undefined>, key: string): string {
  const v = values[key];
  if (typeof v !== "string" || v === "") throw new UsageError(`--${key}가 필요하다`);
  return v;
}

class UsageError extends Error {}

/** 인자 확인 + 설정 계산 + 실행 조건. 실패하면 메시지를 출력하고 종료 코드를 돌려준다 */
function checkStep(argv: string[], ctx: Context): { settings: Settings } | { exit: number } {
  const parsed = parseArgs(argv, ctx.now());
  if (!parsed.ok) {
    ctx.out(`인자가 맞지 않아 아무것도 쓰지 않고 멈춘다.\n${parsed.message}`);
    return { exit: EXIT.usage };
  }
  const settings = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: parsed.args, now: ctx.now() });
  const cond = checkRunCondition(settings);
  if (!cond.ok) {
    ctx.out(cond.message);
    return { exit: EXIT.refused };
  }
  return { settings };
}

function cmdCheck(argv: string[], ctx: Context): number {
  const r = checkStep(argv, ctx);
  if ("exit" in r) return r.exit;
  ctx.out(`실행 조건 통과.\n${describeSettings(r.settings)}`);
  return EXIT.ok;
}

function cmdStart(argv: string[], ctx: Context): number {
  const r = checkStep(argv, ctx);
  if ("exit" in r) return r.exit;
  const s = r.settings;
  const installed = ctx.install(s.repo.toplevel);
  if (!installed.ok) {
    ctx.out(`${installed.message}\n아무것도 쓰지 않고 멈춘다.`);
    return EXIT.installFailed;
  }
  ctx.out(describeSettings(s));
  const now = ctx.now();
  fs.mkdirSync(s.dataDir, { recursive: true });
  const snapshot = takeSnapshot(s.dataDir, s.dbPath, now);
  const pruned = pruneSnapshots(s.dataDir, now);
  // 7단계 4.1-2: 30일 지우기(실행 전 사본은 마이그레이션 없이, 새로 만든 사본 포함)
  const today = kstDate(now);
  const purgeFiles = purgeDataDir(s.dataDir, today);
  const db = openDb(s.dbPath);
  let targets: string[];
  let linkDates: string[];
  let extractDates: string[];
  let scheduleDates: string[];
  let warning: string | null;
  let mergeLine: string;
  let unjudged: number;
  let purgedRows: number;
  let videoPlanned: { date: string | null; done: boolean };
  try {
    purgedRows = purgeExpiredRows(db, today);
    const plan = planTargets(db, now, s.startDate);
    if (plan.firstDateToRecord !== null) recordFirstCollectionDate(db, plan.firstDateToRecord);
    targets = plan.dates;
    linkDates = linkableDates(db);
    extractDates = extractableDates(db);
    scheduleDates = schedulableDates(db);
    warning = deletedNameWarning(db, readNameKey(s.dataDir));
    const due = mergeDue(db, kstDate(now));
    unjudged = unjudgedIssues(db).length;
    const planned = plan.dates.at(-1) ?? videoTargetDate(db);
    videoPlanned = { date: planned, done: planned !== null && isPicked(db, planned) };
    mergeLine = due.due ? `이번 실행 끝에 한다(마지막 점검 ${due.checkedOn})` : due.nextOn === null ? "아직 연결한 이슈가 없다" : `다음 점검 ${due.nextOn}`;
  } finally {
    db.close();
  }
  const testDirs = purgeTestDirs(s.repo.toplevel, today, s.dataDir);
  const purge: VideoPurgeResult = { rows: purgedRows, ...purgeFiles, testDirs };
  const runFile = path.join(s.dataDir, RUNS_DIR, `${kstStamp(now)}.json`);
  const state: RunState = {
    startedAt: kstIso(now),
    mode: s.mode,
    dataDir: s.dataDir,
    dbPath: s.dbPath,
    backupRepo: s.backupRepo,
    noCommitReason: s.noCommitReason,
    targetDates: targets,
    results: {},
    backup: null,
    linkDates,
    links: {},
    extractDates,
    extracts: {},
    scheduleDates,
    schedules: {},
    site: null,
    deploy: null,
    push: null,
    unjudgedAtStart: unjudged,
    videoPlanned,
    videoPurge: purge,
  };
  writeRun(runFile, state);
  ctx.out(
    [
      `- 실행 전 사본: ${snapshot ?? "DB가 없어 건너뜀(첫 실행)"}${pruned.length > 0 ? ` (오래된 사본 ${pruned.length}개 지움)` : ""}`,
      `- 실행 기록: ${runFile}`,
      `- 대상 날짜: ${targets.length > 0 ? targets.join(", ") : "없음(빠진 날짜가 없다)"}`,
      ...targets.map((d) => `  - ${d} 작업 파일: ${workFile(s.dataDir, d)}`),
      `- 이슈를 연결할 저장된 날짜(소급·재시도): ${linkDates.length > 0 ? linkDates.join(", ") : "없음"}`,
      `- 뽑기할 저장된 날짜(채우기·재시도): ${extractDates.length > 0 ? extractDates.join(", ") : "없음"}`,
      `- 일정 뽑기할 저장된 날짜(채우기·재시도): ${scheduleDates.length > 0 ? scheduleDates.join(", ") : "없음"}`,
      ...(warning === null ? [] : [`- 경고: ${warning}`]),
      `- 합치기: ${mergeLine}`,
      `- 지표 판단 안 한 이슈: ${unjudged}개`,
      keyLine(ctx),
      videoPlanned.date === null ? "- 영상: 브리프가 없어 받을 날짜가 없다" : `- 영상: ${videoPlanned.date} ${videoPlanned.done ? "이미 끝남" : "받기 할 것"}`,
      ...purgeLines(purge),
    ].join("\n"),
  );
  return EXIT.ok;
}

function readWork(state: RunState, date: string): { ok: true; data: unknown } | { ok: false; reason: string } {
  const file = workFile(state.dataDir, date);
  if (!fs.existsSync(file)) return { ok: false, reason: `작업 파일이 없다: ${file}` };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, reason: `작업 파일이 올바른 JSON이 아니다: ${(e as Error).message}` };
  }
}

function requireTarget(state: RunState, date: string): void {
  if (!state.targetDates.includes(date)) throw new UsageError(`${date}은(는) 이번 실행의 대상 날짜가 아니다(대상: ${state.targetDates.join(", ") || "없음"})`);
}

async function cmdFeeds(argv: string[], ctx: Context): Promise<number> {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const date = need(v, "date");
  requireTarget(state, date);
  const report = await collectCandidates(date, feedSpecs(date), { fetch: ctx.fetchText ?? realFetch, gapMs: ctx.feedGapMs ?? 1000 });
  const file = candidatesFile(state.dataDir, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
  const md = candidatesFile(state.dataDir, date, "md");
  fs.writeFileSync(md, renderCandidatesMarkdown(date, report));
  updateRun(runFile, (s) => ((s.feeds ??= {})[date] = { counts: report.counts, failures: report.failures }));
  ctx.out(describeFeedReport(date, md, report));
  return EXIT.ok;
}

function cmdValidate(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  requireTarget(state, date);
  const work = readWork(state, date);
  if (!work.ok) {
    ctx.out(`검사 실패(${date}):\n- 작업 파일: ${work.reason}`);
    return EXIT.failed;
  }
  const result = validateBrief(work.data, date);
  if (!result.ok) {
    ctx.out(`검사 실패(${date}), 위반 ${result.violations.length}개:\n${formatViolations(result.violations)}`);
    return EXIT.failed;
  }
  ctx.out(`검사 통과(${date}).`);
  return EXIT.ok;
}

function cmdSave(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const date = need(v, "date");
  requireTarget(state, date);
  const work = readWork(state, date);
  if (!work.ok) {
    updateRun(runFile, (s) => (s.results[date] = { status: "failed", reason: work.reason }));
    ctx.out(`저장하지 않음(${date}): ${work.reason}`);
    return EXIT.failed;
  }
  const result = validateBrief(work.data, date);
  if (!result.ok) {
    updateRun(runFile, (s) => (s.results[date] = { status: "failed", reason: "검사를 통과하지 못했다", violations: result.violations }));
    ctx.out(`저장하지 않음(${date}), 검사 위반 ${result.violations.length}개:\n${formatViolations(result.violations)}`);
    return EXIT.failed;
  }
  // 작업 파일의 이미지 주소는 쓰지 않고, 그 날짜 후보 목록의 공식 RSS 항목과 원문 주소가 같은 출처에만 스크립트가 넣는다(3단계 4.4-1)
  dropImages(result.brief);
  const images = attachImages(result.brief, readCandidateImages(candidatesFile(state.dataDir, date)));
  const now = ctx.now();
  const db = openExistingDb(state.dbPath);
  try {
    try {
      saveBrief(db, { brief: result.brief, collectedAt: kstIso(now), late: isLate(date, now) });
    } catch (e) {
      if (e instanceof AlreadyStoredError) {
        updateRun(runFile, (s) => (s.results[date] = { status: "skipped", reason: e.message }));
        ctx.out(`건너뜀(${date}): ${e.message}`);
        return EXIT.ok;
      }
      const reason = `저장 중 오류: ${(e as Error).message}`;
      updateRun(runFile, (s) => (s.results[date] = { status: "failed", reason }));
      ctx.out(`저장하지 않음(${date}): ${reason}`);
      return EXIT.failed;
    }
    const stored = loadBrief(db, date);
    try {
      if (stored === null) throw new Error("저장한 브리프를 다시 읽지 못했다");
      const md = writeMarkdown(state.dataDir, stored);
      updateRun(runFile, (s) => (s.results[date] = { status: "saved", markdownPath: md, images }));
      ctx.out(`저장함(${date}). 원문 이미지: 출처 ${images}개. 마크다운: ${md}`);
    } catch (e) {
      const markdownError = (e as Error).message;
      updateRun(runFile, (s) => (s.results[date] = { status: "saved", markdownPath: null, markdownError, images }));
      ctx.out(`저장함(${date}). 원문 이미지: 출처 ${images}개. 마크다운 만들기 실패: ${markdownError}`);
    }
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdFail(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" }, reason: { type: "string" } });
  const runFile = need(v, "run");
  const date = need(v, "date");
  const reason = need(v, "reason");
  requireTarget(readRun(runFile), date);
  updateRun(runFile, (s) => (s.results[date] = { status: "failed", reason }));
  ctx.out(`실패로 기록함(${date}): ${reason}`);
  return EXIT.ok;
}

/** 백업 설정: --run이 있으면 실행 기록의 설정, 없으면 환경 변수로 계산한다(4.5-4) */
function backupTarget(runFile: string | undefined, ctx: Context): { dataDir: string; dbPath: string; backupRepo: string | null; noCommitReason: string | null; dates: string[] } {
  if (runFile !== undefined) {
    const s = readRun(runFile);
    const dates = Object.entries(s.results).filter(([, r]) => r.status === "saved").map(([d]) => d).sort();
    return { dataDir: s.dataDir, dbPath: s.dbPath, backupRepo: s.backupRepo, noCommitReason: s.noCommitReason, dates };
  }
  const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
  return { dataDir: s.dataDir, dbPath: s.dbPath, backupRepo: s.backupRepo, noCommitReason: s.noCommitReason, dates: [] };
}

function cmdBackup(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = typeof v.run === "string" ? v.run : undefined;
  const t = backupTarget(runFile, ctx);
  let result: BackupResult;
  if (!fs.existsSync(t.dbPath)) {
    result = { status: "skipped", reason: "DB가 없다" };
  } else {
    const exportDir = path.join(t.dataDir, BACKUP_DIR);
    try {
      const db = openExistingDb(t.dbPath);
      let files: Map<string, string>;
      try {
        files = exportBackup(db, exportDir);
      } finally {
        db.close();
      }
      if (t.backupRepo === null) {
        result = { status: "exported", exportDir, reason: t.noCommitReason ?? "커밋하지 않는다" };
      } else {
        const c = commitBackup(files, t.backupRepo, backupMessage(t.dates), path.join(t.dataDir, "backup-index.tmp"));
        result = c.committed ? { status: "committed", commit: c.commit, exportDir } : { status: "unchanged", exportDir };
      }
    } catch (e) {
      result = { status: "failed", error: (e as Error).message.trim() };
    }
  }
  if (runFile !== undefined) updateRun(runFile, (s) => (s.backup = result));
  ctx.out(`백업: ${describeBackup(result)}`);
  return result.status === "failed" ? EXIT.failed : EXIT.ok;
}

function describeBackup(b: BackupResult | null): string {
  if (b === null) return "실행하지 않았다";
  switch (b.status) {
    case "committed":
      return `data 브랜치에 커밋함 (${b.commit.slice(0, 7)})`;
    case "unchanged":
      return "바뀐 것이 없어 커밋하지 않음";
    case "exported":
      return `내보내기만 함, 커밋 안 함 (${b.reason}): ${b.exportDir}`;
    case "skipped":
      return `건너뜀 (${b.reason})`;
    case "failed":
      return `실패: ${b.error}`;
  }
}

/** 실행 끝 대화창 출력(4.4-2) */
function cmdSummary(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const s = readRun(need(v, "run"));
  const saved = s.targetDates.filter((d) => s.results[d]?.status === "saved");
  const skipped = s.targetDates.filter((d) => s.results[d]?.status === "skipped");
  const failed = s.targetDates.filter((d) => {
    const r = s.results[d];
    return r === undefined || r.status === "failed";
  });
  const lines: string[] = ["## 실행 결과", ""];
  if (s.targetDates.length === 0) lines.push("- 처리할 날짜가 없었다(빠진 날짜 없음).");
  if (saved.length > 0) lines.push(`- 저장한 날짜: ${saved.join(", ")}`);
  if (skipped.length > 0) lines.push(`- 건너뛴 날짜(이미 저장됨): ${skipped.join(", ")}`);
  if (failed.length > 0) {
    lines.push("- 실패한 날짜(다음 실행에서 다시 수집한다):");
    for (const d of failed) {
      const r = s.results[d];
      if (r === undefined) lines.push(`  - ${d}: 결과가 기록되지 않았다(조사나 저장을 끝내지 못했다)`);
      else if (r.status === "failed") {
        lines.push(`  - ${d}: ${r.reason}`);
        if (r.violations) for (const vi of r.violations) lines.push(`    - ${vi.where}: ${vi.why}`);
      }
    }
  }
  for (const d of saved) {
    const r = s.results[d];
    if (r?.status === "saved" && r.markdownError) lines.push(`- ${d} 마크다운 만들기 실패: ${r.markdownError} (render 명령으로 다시 만들 수 있다)`);
  }
  lines.push(...priorityLines(s.dbPath, saved));
  for (const [d, f] of Object.entries(s.feeds ?? {})) {
    if (f.failures.length === 0) continue;
    lines.push(`- ${d} 받지 못한 피드(웹 검색으로 조사했다):`);
    for (const x of f.failures) lines.push(`  - ${x.feed}: ${x.reason}`);
  }
  lines.push(...issueSummaryLines(s));
  lines.push(...extractSummaryLines(s));
  lines.push(...scheduleSummaryLines(s));
  lines.push(...indicatorSummaryLines(s));
  lines.push(...videoSummaryLines(s));
  lines.push(...imageSummaryLines(s, saved));
  lines.push(`- 백업: ${describeBackup(s.backup)}`);
  lines.push(...siteSummaryLines(s));
  const latest = saved.at(-1);
  const others = saved.slice(0, -1);
  if (others.length > 0) {
    lines.push("- 다른 날짜의 마크다운:");
    for (const d of others) lines.push(`  - ${markdownPath(s.dataDir, d)}`);
  }
  if (latest !== undefined) {
    const file = markdownPath(s.dataDir, latest);
    lines.push(`- ${latest} 마크다운: ${file}`, "", "---", "");
    lines.push(fs.existsSync(file) ? fs.readFileSync(file, "utf8").trimEnd() : `(마크다운 파일이 없다: ${file})`);
  }
  ctx.out(lines.join("\n"));
  return EXIT.ok;
}

/** 요약의 이미지 줄(3단계 4.5-4): 새 날짜에 넣은 이미지 수, 지난 날짜 이미지 채우기 결과. 기록이 없는 앞 단계 실행 기록에는 붙이지 않는다 */
function imageSummaryLines(s: RunState, saved: string[]): string[] {
  const lines: string[] = [];
  for (const d of saved) {
    const r = s.results[d];
    if (r?.status === "saved" && r.images !== undefined) lines.push(`- ${d} 원문 이미지: 출처 ${r.images}개에 넣음`);
  }
  const im = s.images;
  if (im === undefined) return lines;
  if (im.status === "failed") lines.push(`- 지난 날짜 이미지 채우기: 실패(다음 실행이 다시 한다): ${im.reason}`);
  else {
    lines.push(`- 지난 날짜 이미지 채우기: 출처 ${im.filled}개 채움`);
    if (im.failures.length > 0) {
      lines.push("  - 받지 못한 피드(다음 실행이 다시 받는다):");
      for (const f of im.failures) lines.push(`    - ${f.feed}: ${f.reason} (${f.url})`);
    }
  }
  return lines;
}

/** 저장한 날짜마다 주요 뉴스 대표 출처의 우선 출처 비율(1.5단계 R6). 절반 미만이면 경고를 붙인다 */
function priorityLines(dbPath: string, dates: string[]): string[] {
  if (dates.length === 0 || !fs.existsSync(dbPath)) return [];
  const lines: string[] = [];
  const db = openExistingDb(dbPath);
  try {
    for (const d of dates) {
      const stored = loadBrief(db, d);
      if (stored === null) continue;
      const { priority, total } = priorityRatio(stored.brief);
      lines.push(`- ${d} 우선 출처 비율: 대표 출처 ${total}건 중 ${priority}건`);
      if (priority * 2 < total) lines.push(`  - 경고: 우선 출처(통신사, 주요 일간지·방송사, 공식 발표)가 절반 미만이다`);
    }
  } finally {
    db.close();
  }
  return lines;
}

function cmdRender(argv: string[], ctx: Context): number {
  const v = opts(argv, { date: { type: "string" }, run: { type: "string" }, all: { type: "boolean" } });
  const { dataDir, dbPath } = dataTarget(v.run, ctx);
  if (v.all === true) {
    if (typeof v.date === "string") throw new UsageError("--date와 --all은 함께 쓸 수 없다");
    const db = openExistingDb(dbPath);
    try {
      ctx.out(rerender(db, dataDir));
      return EXIT.ok;
    } finally {
      db.close();
    }
  }
  const date = need(v, "date");
  const db = openExistingDb(dbPath);
  try {
    const file = writeBriefMarkdown(db, dataDir, date);
    if (file === null) {
      ctx.out(`${date} 브리프가 DB에 없다.`);
      return EXIT.failed;
    }
    ctx.out(`마크다운을 다시 만들었다: ${file}`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdRestore(argv: string[], ctx: Context): number {
  const v = opts(argv, { repo: { type: "string" }, from: { type: "string" }, out: { type: "string" }, force: { type: "boolean" } });
  if (typeof v.repo === "string" && typeof v.from === "string") throw new UsageError("--repo와 --from은 함께 쓸 수 없다");
  let out: string;
  if (typeof v.out === "string") out = path.resolve(ctx.cwd, v.out);
  else if (ctx.env[ENV_DATA_DIR]) out = path.join(path.resolve(ctx.cwd, ctx.env[ENV_DATA_DIR]), DB_FILE);
  else out = path.join(requireRepo(ctx.cwd).mainRoot, "data", DB_FILE);
  let files: Map<string, string>;
  let source: string;
  if (typeof v.from === "string") {
    source = path.resolve(ctx.cwd, v.from);
    files = readBackupDir(source);
  } else {
    const repo = requireRepo(typeof v.repo === "string" ? path.resolve(ctx.cwd, v.repo) : ctx.cwd).mainRoot;
    source = `${repo} (refs/heads/data)`;
    files = readBackupRef(repo);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = restoreBackup(files, out, v.force === true);
  ctx.out(`복원함: ${source} → ${out} (날짜 ${r.dates}개)`);
  return EXIT.ok;
}

// ---- 이슈(2단계) ----

/** --run이 있으면 실행 기록의 데이터 폴더, 없으면 환경 변수로 계산한 데이터 폴더 */
function dataTarget(run: string | boolean | undefined, ctx: Context): { dataDir: string; dbPath: string } {
  if (typeof run === "string") {
    const s = readRun(run);
    return { dataDir: s.dataDir, dbPath: s.dbPath };
  }
  const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
  return { dataDir: s.dataDir, dbPath: s.dbPath };
}

function readJson(file: string, label: string): { ok: true; data: unknown } | { ok: false; reason: string } {
  if (!fs.existsSync(file)) return { ok: false, reason: `${label}이 없다: ${file}` };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, reason: `${label}이 올바른 JSON이 아니다: ${(e as Error).message}` };
  }
}

/** 마크다운을 모두 다시 만든다. 실패해도 데이터 변경은 그대로 두고 메시지만 돌려준다 */
function rerender(db: ReturnType<typeof openDb>, dataDir: string): string {
  try {
    const r = renderAll(db, dataDir);
    return `마크다운을 다시 만들었다(브리프 ${r.briefs}개, 이슈 ${r.issues}개). 이슈 목록: ${r.index}`;
  } catch (e) {
    return `마크다운 만들기 실패: ${(e as Error).message} (render --all로 다시 만들 수 있다)`;
  }
}

function requireStored(db: ReturnType<typeof openDb>, date: string): void {
  if (!hasBrief(db, date)) throw new UsageError(`${date} 브리프가 DB에 없다`);
}

function cmdIssues(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    const work = renderLinkWork(db, date);
    if (work.stories === 0) {
      ctx.out(`할 일 없음(${date}): 이슈가 없는 뉴스가 없다.`);
      return EXIT.ok;
    }
    const file = linkWorkFile(state.dataDir, date, "issues.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, work.text);
    ctx.out(`연결할 뉴스 ${work.stories}건, 후보 이슈 ${work.candidates}개: ${file}\n연결 파일을 쓸 곳: ${linkWorkFile(state.dataDir, date, "links.json")}`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdIssueSearch(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, q: { type: "string" } });
  const q = need(v, "q");
  const db = openExistingDb(dataTarget(v.run, ctx).dbPath);
  try {
    ctx.out(renderSearch(db, q));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdLinkCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const file = readJson(linkWorkFile(state.dataDir, date, "links.json"), "연결 파일");
  if (!file.ok) {
    ctx.out(`연결 검사 실패(${date}):\n- 연결 파일: ${file.reason}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    const r = checkLinkFile(db, file.data, date);
    if (!r.ok) {
      ctx.out(`연결 검사 실패(${date}), 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
      return EXIT.failed;
    }
    ctx.out(`연결 검사 통과(${date}): 뉴스 ${r.plan.links.length}건, 새 이슈 ${r.plan.newIssues.length}개.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdLinkApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const date = need(v, "date");
  const record = (r: LinkResult) => updateRun(runFile, (s) => ((s.links ??= {})[date] = r));
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    if (unlinkedStories(db, date).length === 0) {
      record({ status: "nothing" });
      ctx.out(`할 일 없음(${date}): 이슈가 없는 뉴스가 없다. 바꾼 것이 없다.`);
      return EXIT.ok;
    }
    const file = readJson(linkWorkFile(state.dataDir, date, "links.json"), "연결 파일");
    if (!file.ok) {
      record({ status: "failed", reason: file.reason });
      ctx.out(`연결하지 않음(${date}): ${file.reason}`);
      return EXIT.failed;
    }
    const checked = checkLinkFile(db, file.data, date);
    if (!checked.ok) {
      record({ status: "failed", reason: "연결 파일이 검사를 통과하지 못했다", violations: checked.violations });
      ctx.out(`연결하지 않음(${date}), 위반 ${checked.violations.length}개(뉴스는 저장된 채로 두고 다음 실행이 다시 연결한다):\n${formatViolations(checked.violations)}`);
      return EXIT.failed;
    }
    const applied = applyLinkPlan(db, checked.plan, kstDate(ctx.now()));
    record(applied);
    const head = applied.status === "applied" ? `연결함(${date}): 뉴스 ${applied.linked}건, 기존 이슈에 ${applied.attached}건, 새 이슈 ${applied.newIssues}개.` : `할 일 없음(${date}).`;
    ctx.out(`${head}\n${rerender(db, state.dataDir)}`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdMergeList(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const today = kstDate(ctx.now());
  const record = (r: MergeStepResult) => updateRun(runFile, (s) => (s.merge = r));
  const db = openExistingDb(state.dbPath);
  try {
    const due = mergeDue(db, today);
    if (!due.due) {
      record({ status: "notDue", nextOn: due.nextOn });
      ctx.out(`합치기: 할 일 없음(${due.nextOn === null ? "아직 연결한 이슈가 없다" : `다음 점검 ${due.nextOn}`}).`);
      return EXIT.ok;
    }
    const pairs = mergeCandidates(db);
    const refPairs = refMergeCandidates(db);
    const schedulePairs = scheduleMergeCandidates(db);
    const total = pairs.length + refPairs.length + schedulePairs.length;
    if (total === 0) {
      markMergeChecked(db, today);
      record({ status: "none", candidates: 0 });
      ctx.out(`합치기: 할 일 있음(마지막 점검 ${due.checkedOn}). 후보가 없어 합친 것 없이 점검일을 ${today}로 바꿨다.`);
      return EXIT.ok;
    }
    const file = mergeWorkFile(state.dataDir, "candidates.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const parts = [renderMergeCandidates(db, pairs).trimEnd(), renderRefMergeCandidates(db, refPairs).join("\n").trimEnd(), renderScheduleMergeCandidates(db, schedulePairs).join("\n").trimEnd()];
    fs.writeFileSync(file, `${parts.join("\n\n")}\n`);
    record({ status: "pending", candidates: total });
    const entityPairs = refPairs.filter((p) => p.item === "entity").length;
    ctx.out(
      `합치기: 할 일 있음(마지막 점검 ${due.checkedOn}). 후보 이슈 ${pairs.length}쌍, 대상 ${entityPairs}쌍, 용어 ${refPairs.length - entityPairs}쌍, 일정 ${schedulePairs.length}쌍: ${file}\n합치기 파일을 쓸 곳: ${mergeWorkFile(state.dataDir, "json")}`,
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdMergeCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const state = readRun(need(v, "run"));
  const file = readJson(mergeWorkFile(state.dataDir, "json"), "합치기 파일");
  if (!file.ok) {
    ctx.out(`합치기 검사 실패:\n- 합치기 파일: ${file.reason}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    let refs: RefMergeEntry[] = [];
    let schedules: ScheduleMergeEntry[] = [];
    const r = checkMergeFile(db, file.data, {
      keys: MORE_MERGE_KEYS,
      check: (c, root) => {
        refs = checkRefMerges(c, db, root);
        schedules = checkScheduleMerges(c, db, root);
      },
    });
    if (!r.ok) {
      ctx.out(`합치기 검사 실패, 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
      return EXIT.failed;
    }
    ctx.out(`합치기 검사 통과: 이슈 ${r.merges.length}쌍, 대상·용어 ${refs.length}쌍, 일정 ${schedules.length}쌍.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdMergeApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const record = (r: MergeStepResult) => updateRun(runFile, (s) => (s.merge = r));
  const fail = (reason: string, violations?: Violation[]) => {
    record(violations ? { status: "failed", reason, violations } : { status: "failed", reason });
    ctx.out(`합치지 않음: ${reason}${violations ? `\n${formatViolations(violations)}` : ""}\n점검일을 바꾸지 않았다. 다음 실행이 다시 한다.`);
    return EXIT.failed;
  };
  const file = readJson(mergeWorkFile(state.dataDir, "json"), "합치기 파일");
  if (!file.ok) return fail(file.reason);
  const db = openExistingDb(state.dbPath);
  try {
    let refEntries: RefMergeEntry[] = [];
    let scheduleEntries: ScheduleMergeEntry[] = [];
    const checked = checkMergeFile(db, file.data, {
      keys: MORE_MERGE_KEYS,
      check: (c, root) => {
        refEntries = checkRefMerges(c, db, root);
        scheduleEntries = checkScheduleMerges(c, db, root);
      },
    });
    if (!checked.ok) return fail("합치기 파일이 검사를 통과하지 못했다", checked.violations);
    const names = new Map<number, string>();
    for (const m of checked.merges) for (const id of [m.survivor, m.absorbed]) names.set(id, getIssueName(db, id));
    const refName = (item: RefItem, id: number) => refState(db, item, id)?.name ?? "";
    const refNames = refEntries.map((m) => ({ survivor: refName(m.item, m.survivor), absorbed: refName(m.item, m.absorbed) }));
    const scheduleName = (id: number) => getSchedule(db, id)?.name ?? "";
    const scheduleNames = scheduleEntries.map((m) => ({ survivor: scheduleName(m.survivor), absorbed: scheduleName(m.absorbed) }));
    const today = kstDate(ctx.now());
    let refIds: number[] = [];
    let scheduleIds: number[] = [];
    const ids = applyMerges(db, checked.merges, today, () => {
      refIds = applyRefMerges(db, refEntries, today);
      scheduleIds = applyScheduleMerges(db, scheduleEntries, today);
    });
    const refs: RefMergeDone[] = refEntries.map((m, i) => ({
      id: refIds[i]!,
      item: m.item,
      survivor: m.survivor,
      survivorName: refNames[i]!.survivor,
      absorbed: m.absorbed,
      absorbedName: refNames[i]!.absorbed,
      reason: m.reason,
    }));
    const schedules: ScheduleMergeDone[] = scheduleEntries.map((m, i) => ({
      id: scheduleIds[i]!,
      survivor: m.survivor,
      survivorName: scheduleNames[i]!.survivor,
      absorbed: m.absorbed,
      absorbedName: scheduleNames[i]!.absorbed,
      reason: m.reason,
    }));
    if (ids.length === 0 && refs.length === 0 && schedules.length === 0) {
      const prev = readRun(runFile).merge;
      record({ status: "none", candidates: prev?.status === "pending" || prev?.status === "none" ? prev.candidates : 0 });
      ctx.out(`합친 것 없음. 점검일을 ${kstDate(ctx.now())}로 바꿨다.`);
      return EXIT.ok;
    }
    const merges = checked.merges.map((m, i) => ({
      id: ids[i]!,
      survivor: m.survivor,
      survivorName: names.get(m.survivor) ?? "",
      absorbed: m.absorbed,
      absorbedName: names.get(m.absorbed) ?? "",
      reason: m.reason,
    }));
    record({ status: "merged", merges, ...(refs.length > 0 ? { refs } : {}), ...(schedules.length > 0 ? { schedules } : {}) });
    const lines = merges.map((m) => `- 합치기 ${m.id}: 이슈 ${m.absorbed}(${m.absorbedName}) → 이슈 ${m.survivor}(${m.survivorName}). 되돌리기: node src/cli.ts unmerge --id ${m.id}`);
    lines.push(...refs.map(refMergeLine), ...schedules.map(scheduleMergeLine));
    ctx.out([`합침: 이슈 ${merges.length}쌍, 대상·용어 ${refs.length}쌍, 일정 ${schedules.length}쌍. 점검일을 ${today}로 바꿨다.`, ...lines, rerender(db, state.dataDir)].join("\n"));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 합치기 파일에서 4단계 대상·용어 합치기와 5단계 일정 합치기를 적는 항목 */
const MORE_MERGE_KEYS = ["entityMerges", "termMerges", "scheduleMerges"];

function scheduleMergeLine(m: ScheduleMergeDone): string {
  return `- 일정 합치기 ${m.id}: 일정 ${m.absorbed}(${m.absorbedName}) → 일정 ${m.survivor}(${m.survivorName}). 이유: ${m.reason}. 되돌리기: node src/cli.ts schedule-unmerge --id ${m.id}`;
}

function refMergeLine(m: RefMergeDone): string {
  const label = m.item === "entity" ? "대상" : "용어";
  return `- 대상·용어 합치기 ${m.id}: ${label} ${m.absorbed}(${m.absorbedName}) → ${label} ${m.survivor}(${m.survivorName}). 이유: ${m.reason}. 되돌리기: node src/cli.ts ref-unmerge --id ${m.id}`;
}

function getIssueName(db: ReturnType<typeof openDb>, id: number): string {
  return (db.prepare("SELECT name FROM issues WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "";
}

function cmdMerges(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const db = openExistingDb(dataTarget(v.run, ctx).dbPath);
  try {
    const more = [...describeRefMerges(db), ...describeScheduleMerges(db)];
    ctx.out(more.length > 0 ? `${describeMerges(db)}\n${more.join("\n")}` : describeMerges(db));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 합치기 되돌리기(4.3-4). 실제 데이터 폴더면 실행 조건(S12)을 따른다. 바꾸기 전에 DB 사본을 남긴다 */
function cmdUnmerge(argv: string[], ctx: Context): number {
  const v = opts(argv, { id: { type: "string" } });
  const raw = need(v, "id");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`--id는 합치기 기록 번호여야 한다: ${raw}`);
  const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
  const cond = checkRunCondition(s);
  if (!cond.ok) {
    ctx.out(cond.message);
    return EXIT.refused;
  }
  if (!fs.existsSync(s.dbPath)) {
    ctx.out(`DB가 없다: ${s.dbPath}`);
    return EXIT.failed;
  }
  const now = ctx.now();
  const snapshot = takeSnapshot(s.dataDir, s.dbPath, now);
  pruneSnapshots(s.dataDir, now);
  const db = openExistingDb(s.dbPath);
  try {
    const r = unmerge(db, id, kstDate(now));
    if (!r.ok) {
      ctx.out(`되돌리지 않음: ${r.reason}`);
      return EXIT.failed;
    }
    ctx.out(
      [
        `되돌림: 합치기 ${id} (이슈 ${r.merge.absorbed}을(를) 이슈 ${r.merge.survivor}에서 되살렸다). 두 이슈는 다음 합치기 후보에서 빠진다.`,
        `- 실행 전 사본: ${snapshot}`,
        `- ${rerender(db, s.dataDir)}`,
        "- 백업은 다음 /brief 실행이 한다.",
      ].join("\n"),
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 실행 요약의 이슈 줄(2단계 4.4-4). 1·1.5단계 실행 기록(linkDates 없음)에는 붙이지 않는다 */
function issueSummaryLines(s: RunState): string[] {
  if (s.linkDates === undefined) return [];
  const lines: string[] = [];
  const results = s.links ?? {};
  const saved = s.targetDates.filter((d) => s.results[d]?.status === "saved");
  const dates = [...new Set([...s.linkDates, ...saved, ...Object.keys(results)])].sort();
  if (dates.length > 0) lines.push("- 이슈 연결:");
  for (const d of dates) {
    const r = results[d];
    if (r === undefined) lines.push(`  - ${d}: 연결 결과가 기록되지 않았다(다음 실행이 다시 연결한다)`);
    else if (r.status === "applied") lines.push(`  - ${d}: 뉴스 ${r.linked}건 연결(기존 이슈에 ${r.attached}건, 새 이슈 ${r.newIssues}개)`);
    else if (r.status === "nothing") lines.push(`  - ${d}: 할 일 없음(이미 연결됨)`);
    else {
      lines.push(`  - ${d}: 연결 실패(뉴스는 저장됨, 다음 실행이 다시 연결한다): ${r.reason}`);
      if (r.violations) for (const vi of r.violations) lines.push(`    - ${vi.where}: ${vi.why}`);
    }
  }
  if (fs.existsSync(s.dbPath)) {
    const db = openExistingDb(s.dbPath);
    try {
      const n = unlinkedCount(db);
      lines.push(n > 0 ? `- 아직 이슈가 없는 뉴스: ${n}건(다음 실행이 연결한다)` : "- 아직 이슈가 없는 뉴스: 없음");
    } finally {
      db.close();
    }
  }
  const m = s.merge;
  if (m === undefined) lines.push("- 합치기: 실행하지 않았다(다음 실행이 주기를 다시 본다)");
  else if (m.status === "notDue") lines.push(`- 합치기: 할 일 없음(${m.nextOn === null ? "아직 연결한 이슈가 없다" : `다음 점검 ${m.nextOn}`})`);
  else if (m.status === "pending") lines.push(`- 합치기: 후보 ${m.candidates}쌍을 만들었지만 적용하지 않았다(점검일을 바꾸지 않았다, 다음 실행이 다시 한다)`);
  else if (m.status === "none") lines.push(`- 합치기: 점검했고 합친 것이 없다(후보 ${m.candidates}쌍)`);
  else if (m.status === "merged") {
    if (m.refs === undefined && m.schedules === undefined) lines.push(`- 합치기: ${m.merges.length}쌍을 합쳤다`);
    else lines.push(`- 합치기: 이슈 ${m.merges.length}쌍, 대상·용어 ${m.refs?.length ?? 0}쌍${m.schedules === undefined ? "" : `, 일정 ${m.schedules.length}쌍`}을 합쳤다`);
    for (const x of m.merges) {
      lines.push(`  - 이슈 ${x.absorbed}(${x.absorbedName}) → 이슈 ${x.survivor}(${x.survivorName}). 이유: ${x.reason}. 되돌리기: node src/cli.ts unmerge --id ${x.id}`);
    }
    for (const x of m.refs ?? []) lines.push(`  ${refMergeLine(x)}`);
    for (const x of m.schedules ?? []) lines.push(`  ${scheduleMergeLine(x)}`);
  } else {
    lines.push(`- 합치기 실패(점검일을 바꾸지 않았다, 다음 실행이 다시 한다): ${m.reason}`);
    if (m.violations) for (const vi of m.violations) lines.push(`  - ${vi.where}: ${vi.why}`);
  }
  const index = issueIndexPath(s.dataDir);
  lines.push(`- 이슈 목록: ${fs.existsSync(index) ? index : `아직 없다(${index})`}`);
  return lines;
}

// ---- 인물·기관·국가와 용어(4단계) ----

function cmdRefs(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    if (isExtracted(db, date)) {
      ctx.out(`할 일 없음(${date}): 이미 뽑기를 마친 날짜다.`);
      return EXIT.ok;
    }
    const work = renderRefWork(db, date);
    const file = refWorkFile(state.dataDir, date, "refs.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, work.text);
    ctx.out(`뉴스 ${work.stories}건, 후보 대상 ${work.entities}개, 후보 용어 ${work.terms}개: ${file}\n뽑기 파일을 쓸 곳: ${refWorkFile(state.dataDir, date, "refs.json")}`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdRefSearch(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, q: { type: "string" } });
  const q = need(v, "q");
  const t = dataTarget(v.run, ctx);
  const db = openExistingDb(t.dbPath);
  try {
    ctx.out(renderRefSearch(db, q, readNameKey(t.dataDir)));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdRefCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const file = readJson(refWorkFile(state.dataDir, date, "refs.json"), "뽑기 파일");
  if (!file.ok) {
    ctx.out(`뽑기 검사 실패(${date}):\n- 뽑기 파일: ${file.reason}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    const r = checkRefFile(db, file.data, date, readNameKey(state.dataDir));
    if (!r.ok) {
      ctx.out(`뽑기 검사 실패(${date}), 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
      return EXIT.failed;
    }
    ctx.out(`뽑기 검사 통과(${date}): 뉴스 ${r.plan.stories.length}건, 새 대상 ${r.plan.newEntities.length}개, 새 용어 ${r.plan.newTerms.length}개, 고침 ${r.plan.entityUpdates.length + r.plan.termUpdates.length}개.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdRefApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const date = need(v, "date");
  const record = (r: ExtractResult) => updateRun(runFile, (s) => ((s.extracts ??= {})[date] = r));
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    if (isExtracted(db, date)) {
      record({ status: "nothing" });
      ctx.out(`할 일 없음(${date}): 이미 뽑기를 마친 날짜다. 바꾼 것이 없다.`);
      return EXIT.ok;
    }
    const file = readJson(refWorkFile(state.dataDir, date, "refs.json"), "뽑기 파일");
    if (!file.ok) {
      record({ status: "failed", reason: file.reason });
      ctx.out(`뽑기를 적용하지 않음(${date}): ${file.reason}`);
      return EXIT.failed;
    }
    const checked = checkRefFile(db, file.data, date, readNameKey(state.dataDir));
    if (!checked.ok) {
      record({ status: "failed", reason: "뽑기 파일이 검사를 통과하지 못했다", violations: checked.violations });
      ctx.out(`뽑기를 적용하지 않음(${date}), 위반 ${checked.violations.length}개(뉴스와 이슈 연결은 그대로 두고 다음 실행이 다시 뽑는다):\n${formatViolations(checked.violations)}`);
      return EXIT.failed;
    }
    const applied = applyRefPlan(db, checked.plan, kstDate(ctx.now()));
    record(applied);
    ctx.out(
      applied.status === "applied"
        ? `뽑기 적용함(${date}): 대상 연결 ${applied.entityLinks}개, 용어 연결 ${applied.termLinks}개, 새 대상 ${applied.newEntities}개, 새 용어 ${applied.newTerms}개, 고친 한 줄 설명 ${applied.descriptions}개.`
        : `할 일 없음(${date}).`,
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 사용자가 직접 실행하는 명령(되돌리기, 지우기)의 공통 준비: 실행 조건(S12), DB 확인, 바꾸기 전 사본 */
function userCommandDb(ctx: Context): { s: Settings; snapshot: string | null } | { exit: number } {
  const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
  const cond = checkRunCondition(s);
  if (!cond.ok) {
    ctx.out(cond.message);
    return { exit: EXIT.refused };
  }
  if (!fs.existsSync(s.dbPath)) {
    ctx.out(`DB가 없다: ${s.dbPath}`);
    return { exit: EXIT.failed };
  }
  const now = ctx.now();
  const snapshot = takeSnapshot(s.dataDir, s.dbPath, now);
  pruneSnapshots(s.dataDir, now);
  return { s, snapshot };
}

/** 대상·용어 합치기 되돌리기(4.3-3). 사용자가 직접 실행한다 */
function cmdRefUnmerge(argv: string[], ctx: Context): number {
  const v = opts(argv, { id: { type: "string" } });
  const raw = need(v, "id");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`--id는 대상·용어 합치기 기록 번호여야 한다: ${raw}`);
  const prep = userCommandDb(ctx);
  if ("exit" in prep) return prep.exit;
  const db = openExistingDb(prep.s.dbPath);
  try {
    const r = unmergeRef(db, id, kstDate(ctx.now()));
    if (!r.ok) {
      ctx.out(`되돌리지 않음: ${r.reason}`);
      return EXIT.failed;
    }
    const label = r.merge.item === "entity" ? "대상" : "용어";
    ctx.out(
      [
        `되돌림: 대상·용어 합치기 ${id} (${label} ${r.merge.absorbed}을(를) ${label} ${r.merge.survivor}에서 되살렸다). 두 ${label}는 다음 합치기 후보에서 빠진다.`,
        `- 실행 전 사본: ${prep.snapshot}`,
        "- 백업과 사이트 배포는 다음 /brief 실행이 한다.",
      ].join("\n"),
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 대상·용어 지우기(4.3-4, E13). 사용자가 직접 실행한다 */
function cmdRefDelete(argv: string[], ctx: Context): number {
  const v = opts(argv, { entity: { type: "string" }, term: { type: "string" } });
  if ((typeof v.entity === "string") === (typeof v.term === "string")) throw new UsageError("--entity와 --term 중 하나만 준다");
  const item: RefItem = typeof v.entity === "string" ? "entity" : "term";
  const raw = (v.entity ?? v.term) as string;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`식별자는 양의 정수여야 한다: ${raw}`);
  const prep = userCommandDb(ctx);
  if ("exit" in prep) return prep.exit;
  const db = openExistingDb(prep.s.dbPath);
  try {
    const label = item === "entity" ? "대상" : "용어";
    const pre = refState(db, item, id);
    if (pre === null || pre.deleted || pre.mergedInto !== null) {
      const r = deleteRef(db, item, id, { key: Buffer.alloc(0), fp: "" }, kstDate(ctx.now()));
      ctx.out(`지우지 않음: ${r.ok ? "" : r.reason}`);
      return EXIT.failed;
    }
    const key = ensureNameKey(prep.s.dataDir);
    const r = deleteRef(db, item, id, key, kstDate(ctx.now()));
    if (!r.ok) {
      ctx.out(`지우지 않음: ${r.reason}`);
      return EXIT.failed;
    }
    ctx.out(
      [
        `지움: ${label} ${id}${r.ids.length > 1 ? `(흡수되어 있던 ${label} ${r.ids.slice(1).join(", ")} 포함)` : ""}.`,
        `- 지운 이름(다음 뽑기에서 같은 이름을 거부한다): ${r.names.join(", ")}`,
        `- 끊은 연결: ${r.links}개${r.maskedMerges > 0 ? `, 가린 합치기 기록: ${r.maskedMerges}개(되돌리기를 거부한다)` : ""}`,
        `- 실행 전 사본: ${prep.snapshot}`,
        "- 다음 /brief 실행이 백업하고 사이트에 배포한다. 그때부터 사이트와 검색에서 빠지고 그 주소는 없는 페이지가 된다.",
        "- 남는 곳: 이미 push된 data 브랜치의 지난 백업 이력, 뉴스 본문(제목·요약·본문), 이슈 이름·별칭·요약(바꾸지 않는다).",
        "- 바로 내리려면 docs/operations.md의 손으로 하는 배포(main에서 site 빌드 뒤 deploy --dir --db)를 쓴다.",
        "- 지우기는 되돌리지 않는다. 되돌리려면 실행 전 사본으로 복원한다(docs/operations.md).",
      ].join("\n"),
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 실행 요약의 뽑기 줄(4.5-2). 앞 단계 실행 기록(extractDates 없음)에는 붙이지 않는다 */
function extractSummaryLines(s: RunState): string[] {
  if (s.extractDates === undefined) return [];
  const lines: string[] = [];
  const results = s.extracts ?? {};
  const saved = s.targetDates.filter((d) => s.results[d]?.status === "saved");
  const dates = [...new Set([...s.extractDates, ...saved, ...Object.keys(results)])].sort();
  if (dates.length > 0) lines.push("- 인물·기관·국가와 용어 뽑기:");
  for (const d of dates) {
    const r = results[d];
    if (r === undefined) lines.push(`  - ${d}: 뽑기 결과가 기록되지 않았다(다음 실행이 다시 뽑는다)`);
    else if (r.status === "applied") {
      lines.push(`  - ${d}: 대상 연결 ${r.entityLinks}개, 용어 연결 ${r.termLinks}개(새 대상 ${r.newEntities}개, 새 용어 ${r.newTerms}개, 고친 한 줄 설명 ${r.descriptions}개)`);
    } else if (r.status === "nothing") lines.push(`  - ${d}: 할 일 없음(이미 뽑음)`);
    else {
      lines.push(`  - ${d}: 뽑기 실패(뉴스와 이슈 연결은 그대로, 다음 실행이 다시 뽑는다): ${r.reason}`);
      if (r.violations) for (const vi of r.violations) lines.push(`    - ${vi.where}: ${vi.why}`);
    }
  }
  if (fs.existsSync(s.dbPath)) {
    const db = openExistingDb(s.dbPath);
    try {
      const n = extractableDates(db).length;
      lines.push(n > 0 ? `- 아직 뽑기 안 한 날짜: ${n}개(다음 실행이 뽑는다)` : "- 아직 뽑기 안 한 날짜: 없음");
      const warning = deletedNameWarning(db, readNameKey(s.dataDir));
      if (warning !== null) lines.push(`- 경고: ${warning}`);
    } finally {
      db.close();
    }
  }
  return lines;
}

// ---- 일정(5단계) ----

function cmdSchedules(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    if (isScheduled(db, date)) {
      ctx.out(`할 일 없음(${date}): 이미 일정 뽑기를 마친 날짜다.`);
      return EXIT.ok;
    }
    const work = renderScheduleWork(db, date);
    const file = scheduleWorkFile(state.dataDir, date, "schedules.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, work.text);
    ctx.out(`뉴스 ${work.stories}건, 기존 일정 후보 ${work.existing}개, 결과 후보 ${work.results}개: ${file}\n일정 파일을 쓸 곳: ${scheduleWorkFile(state.dataDir, date, "schedules.json")}`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function dateOpt(values: Record<string, string | boolean | undefined>, key: string): string | null {
  const v = values[key];
  if (v === undefined) return null;
  if (typeof v !== "string" || !isValidDate(v)) throw new UsageError(`--${key}는 YYYY-MM-DD 날짜여야 한다: ${String(v)}`);
  return v;
}

function cmdScheduleSearch(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, q: { type: "string" }, from: { type: "string" }, to: { type: "string" } });
  const q = typeof v.q === "string" ? v.q : "";
  const from = dateOpt(v, "from");
  const to = dateOpt(v, "to");
  if (q.trim() === "" && from === null && to === null) throw new UsageError("--q나 --from·--to가 필요하다");
  const db = openExistingDb(dataTarget(v.run, ctx).dbPath);
  try {
    ctx.out(renderScheduleSearch(db, q, from, to));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdScheduleCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const state = readRun(need(v, "run"));
  const date = need(v, "date");
  const file = readJson(scheduleWorkFile(state.dataDir, date, "schedules.json"), "일정 파일");
  if (!file.ok) {
    ctx.out(`일정 검사 실패(${date}):\n- 일정 파일: ${file.reason}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    const r = checkScheduleFile(db, file.data, date);
    if (!r.ok) {
      ctx.out(`일정 검사 실패(${date}), 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
      return EXIT.failed;
    }
    const p = r.plan;
    ctx.out(`일정 검사 통과(${date}): 뉴스 ${p.stories.length}건, 새 일정 ${p.newSchedules.length}개, 결과 ${p.outcomes.length}개, 날짜 확정 ${p.confirms.length}개.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function cmdScheduleApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, date: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const date = need(v, "date");
  const record = (r: ScheduleResult) => updateRun(runFile, (s) => ((s.schedules ??= {})[date] = r));
  const db = openExistingDb(state.dbPath);
  try {
    requireStored(db, date);
    if (isScheduled(db, date)) {
      record({ status: "nothing" });
      ctx.out(`할 일 없음(${date}): 이미 일정 뽑기를 마친 날짜다. 바꾼 것이 없다.`);
      return EXIT.ok;
    }
    const file = readJson(scheduleWorkFile(state.dataDir, date, "schedules.json"), "일정 파일");
    if (!file.ok) {
      record({ status: "failed", reason: file.reason });
      ctx.out(`일정을 적용하지 않음(${date}): ${file.reason}`);
      return EXIT.failed;
    }
    const checked = checkScheduleFile(db, file.data, date);
    if (!checked.ok) {
      record({ status: "failed", reason: "일정 파일이 검사를 통과하지 못했다", violations: checked.violations });
      ctx.out(`일정을 적용하지 않음(${date}), 위반 ${checked.violations.length}개(뉴스, 이슈 연결, 인물·용어 뽑기는 그대로 두고 다음 실행이 다시 뽑는다):\n${formatViolations(checked.violations)}`);
      return EXIT.failed;
    }
    const a = applySchedulePlan(db, checked.plan);
    record(a);
    ctx.out(
      a.status === "applied"
        ? `일정 적용함(${date}): 새 일정 ${a.newSchedules}개, 근거를 더한 기존 일정 ${a.attached}개, 결과 연결 ${a.results}개, 연기 ${a.postponed}개, 취소 ${a.cancelled}개, 날짜 확정 ${a.confirmed}개.`
        : `할 일 없음(${date}).`,
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function idArg(argv: string[], label: string): number {
  const v = opts(argv, { id: { type: "string" } });
  const raw = need(v, "id");
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new UsageError(`--id는 ${label}여야 한다: ${raw}`);
  return id;
}

/** 일정 합치기 되돌리기(4.3-3). 사용자가 직접 실행한다 */
function cmdScheduleUnmerge(argv: string[], ctx: Context): number {
  const id = idArg(argv, "일정 합치기 기록 번호");
  const prep = userCommandDb(ctx);
  if ("exit" in prep) return prep.exit;
  const db = openExistingDb(prep.s.dbPath);
  try {
    const r = unmergeSchedule(db, id, kstDate(ctx.now()));
    if (!r.ok) {
      ctx.out(`되돌리지 않음: ${r.reason}`);
      return EXIT.failed;
    }
    ctx.out(
      [
        `되돌림: 일정 합치기 ${id} (일정 ${r.merge.absorbed}을(를) 일정 ${r.merge.survivor}에서 되살렸다). 두 일정은 다음 합치기 후보에서 빠진다.`,
        `- 실행 전 사본: ${prep.snapshot}`,
        "- 백업과 사이트 배포는 다음 /brief 실행이 한다.",
      ].join("\n"),
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 일정 지우기(4.3-4, C13). 사용자가 직접 실행한다 */
function cmdScheduleDelete(argv: string[], ctx: Context): number {
  const id = idArg(argv, "일정 식별자(양의 정수)");
  const prep = userCommandDb(ctx);
  if ("exit" in prep) return prep.exit;
  const db = openExistingDb(prep.s.dbPath);
  try {
    const r = deleteSchedule(db, id, kstDate(ctx.now()));
    if (!r.ok) {
      ctx.out(`지우지 않음: ${r.reason}`);
      return EXIT.failed;
    }
    ctx.out(
      [
        `지움: 일정 ${id} (${r.name}, ${dueText(r.due)})${r.ids.length > 1 ? `, 흡수되어 있던 일정 ${r.ids.slice(1).join(", ")} 포함` : ""}.`,
        `- 끊은 연결: ${r.links}개`,
        ...(r.pointing.length > 0 ? [`- 이 일정을 연기 대상으로 가리키던 일정 ${r.pointing.join(", ")}은(는) "연기(새 날짜 모름)"로 보인다`] : []),
        "- 같은 이름·예정일의 새 일정은 다음 뽑기부터 거부한다.",
        `- 실행 전 사본: ${prep.snapshot}`,
        "- 다음 /brief 실행이 백업하고 사이트에 배포한다. 그때부터 사이트에서 빠지고 그 일정 주소는 없는 페이지가 된다.",
        "- 남는 곳: 이미 push된 data 브랜치의 지난 백업 이력, 뉴스 본문(제목·요약·본문)(바꾸지 않는다).",
        "- 바로 내리려면 docs/operations.md의 손으로 하는 배포(main에서 site 빌드 뒤 deploy --dir --db)를 쓴다.",
        "- 지우기는 되돌리지 않는다. 되돌리려면 실행 전 사본으로 복원한다(docs/operations.md).",
      ].join("\n"),
    );
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 실행 요약의 일정 줄(5단계 4.5-2). 앞 단계 실행 기록(scheduleDates 없음)에는 붙이지 않는다 */
function scheduleSummaryLines(s: RunState): string[] {
  if (s.scheduleDates === undefined) return [];
  const lines: string[] = [];
  const results = s.schedules ?? {};
  const saved = s.targetDates.filter((d) => s.results[d]?.status === "saved");
  const dates = [...new Set([...s.scheduleDates, ...saved, ...Object.keys(results)])].sort();
  if (dates.length > 0) lines.push("- 일정 뽑기:");
  for (const d of dates) {
    const r = results[d];
    if (r === undefined) lines.push(`  - ${d}: 일정 뽑기 결과가 기록되지 않았다(다음 실행이 다시 뽑는다)`);
    else if (r.status === "applied") {
      lines.push(`  - ${d}: 새 일정 ${r.newSchedules}개, 근거를 더한 기존 일정 ${r.attached}개, 결과 연결 ${r.results}개, 연기 ${r.postponed}개, 취소 ${r.cancelled}개${r.confirmed > 0 ? `, 날짜 확정 ${r.confirmed}개` : ""}`);
    } else if (r.status === "nothing") lines.push(`  - ${d}: 할 일 없음(이미 뽑음)`);
    else {
      lines.push(`  - ${d}: 일정 뽑기 실패(뉴스, 이슈 연결, 인물·용어 뽑기는 그대로, 다음 실행이 다시 뽑는다): ${r.reason}`);
      if (r.violations) for (const vi of r.violations) lines.push(`    - ${vi.where}: ${vi.why}`);
    }
  }
  if (fs.existsSync(s.dbPath)) {
    const db = openExistingDb(s.dbPath);
    try {
      const n = schedulableDates(db).length;
      lines.push(n > 0 ? `- 아직 일정 뽑기 안 한 날짜: ${n}개(다음 실행이 뽑는다)` : "- 아직 일정 뽑기 안 한 날짜: 없음");
    } finally {
      db.close();
    }
  }
  return lines;
}

// ---- 사이트·배포·push(3단계) ----

// ---- 지표(6단계) ----

/** 실제 데이터 폴더의 실행 기록이면 지금도 실행 조건(S12)을 따르는지 다시 본다(4.2-1). 맞지 않으면 메시지를 출력하고 종료 코드를 돌려준다 */
function indicatorCondition(state: RunState, ctx: Context): number | null {
  if (state.mode !== "real") return null;
  const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
  const cond = checkRunCondition(s);
  if (cond.ok) return null;
  ctx.out(cond.message);
  return EXIT.refused;
}

/** 키 읽는 곳: 메인 작업 폴더(데이터 폴더와 같은 기준, worktree에서도 같다) */
function keyDirOf(ctx: Context): string {
  return requireRepo(ctx.cwd).mainRoot;
}

function secretsOf(ctx: Context): string[] {
  const repo = repoInfo(ctx.cwd);
  return secretValues(ctx.env, repo === null ? ctx.cwd : repo.mainRoot);
}

function keyLine(ctx: Context): string {
  const k = readKeys(ctx.env, keyDirOf(ctx));
  const has = (v: string | null) => (v === null ? "없음" : "있음");
  return `- 키: ECOS ${has(k.ECOS_API_KEY)}, FRED ${has(k.FRED_API_KEY)}, YouTube ${has(k.YOUTUBE_API_KEY)}`;
}

/** 판단할 이슈를 파일로 나눠 후보 목록을 쓴다(4.3-2). 나눈 결과를 실행 기록에 남긴다 */
function cmdIndicatorList(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const db = openExistingDb(state.dbPath);
  try {
    const batches = judgeBatches(db);
    // 앞 목록에서 적용한 파일과 결과만 남기고, 새 파일은 그 뒤 번호로 매긴다(다른 이슈 묶음에 앞 결과가 붙지 않게)
    const prev = state.indicatorJudge;
    const kept = (prev?.files ?? []).filter((f) => prev!.results[String(f.n)]?.status === "applied");
    const start = Math.max(0, ...kept.map((f) => f.n));
    const files = batches.map((issues, i) => ({ n: start + i + 1, issues }));
    const results = Object.fromEntries(kept.map((f) => [String(f.n), prev!.results[String(f.n)]!]));
    updateRun(runFile, (s) => (s.indicatorJudge = { files: [...kept, ...files], results }));
    if (batches.length === 0) {
      ctx.out("지표 판단: 판단할 이슈가 없다.");
      return EXIT.ok;
    }
    const lines = [`지표 판단: 이슈 ${batches.flat().length}개, 파일 ${batches.length}개.`];
    for (const f of files) {
      const md = judgeWorkFile(state.dataDir, f.n, "candidates.md");
      const json = judgeWorkFile(state.dataDir, f.n, "judge.json");
      fs.mkdirSync(path.dirname(md), { recursive: true });
      fs.rmSync(json, { force: true });
      fs.writeFileSync(md, renderJudgeCandidates(db, f.n, files.at(-1)!.n, f.issues, json));
      lines.push(`- 파일 ${f.n}: 이슈 ${f.issues.length}개. 후보 목록: ${md} → 판단 파일: ${json}`);
    }
    ctx.out(lines.join("\n"));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function judgeFileArg(state: RunState, v: Record<string, string | boolean | undefined>): { n: number; issues: number[] } {
  const raw = need(v, "file");
  const n = Number(raw);
  const f = state.indicatorJudge?.files.find((x) => x.n === n);
  if (!f) throw new UsageError(`--file ${raw}은(는) 이번 실행의 지표 판단 파일 번호가 아니다(먼저 indicator-list)`);
  return f;
}

function cmdIndicatorCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, file: { type: "string" } });
  const state = readRun(need(v, "run"));
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const f = judgeFileArg(state, v);
  const file = readJudgeFile(judgeWorkFile(state.dataDir, f.n, "judge.json"));
  if (!file.ok) {
    ctx.out(`지표 판단 검사 실패(파일 ${f.n}):\n- ${file.reason}`);
    return EXIT.failed;
  }
  const r = checkJudgeFile(file.data, f.issues);
  if (!r.ok) {
    ctx.out(`지표 판단 검사 실패(파일 ${f.n}), 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
    return EXIT.failed;
  }
  ctx.out(`지표 판단 검사 통과(파일 ${f.n}): 이슈 ${r.entries.length}개, 지표를 고른 이슈 ${r.entries.filter((e) => e.indicators.length > 0).length}개.`);
  return EXIT.ok;
}

/** 검사 → 파일 단위로 적용(4.3-3). 실패하면 아무것도 적용하지 않고 실행 기록에 남긴다(4.3-5) */
function cmdIndicatorApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, file: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const f = judgeFileArg(state, v);
  const record = (r: JudgeResult) => updateRun(runFile, (s) => (s.indicatorJudge!.results[String(f.n)] = r));
  const file = readJudgeFile(judgeWorkFile(state.dataDir, f.n, "judge.json"));
  if (!file.ok) {
    record({ status: "failed", reason: file.reason });
    ctx.out(`적용하지 않음(파일 ${f.n}): ${file.reason}`);
    return EXIT.failed;
  }
  const r = checkJudgeFile(file.data, f.issues);
  if (!r.ok) {
    record({ status: "failed", reason: "판단 파일이 검사를 통과하지 못했다", violations: r.violations });
    ctx.out(`적용하지 않음(파일 ${f.n}), 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    const chosen = applyJudgeFile(db, r.entries);
    record({ status: "applied", issues: r.entries.length, chosen });
    ctx.out(`적용함(파일 ${f.n}): 이슈 ${r.entries.length}개를 판단함으로, 지표를 고른 이슈 ${chosen}개.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 12개 지표를 출처에서 받는다(4.2). 지표 하나가 실패해도 실패로 끝내지 않는다(X9-②) */
async function cmdIndicatorFetch(argv: string[], ctx: Context): Promise<number> {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const db = openExistingDb(state.dbPath);
  let result: IndicatorFetchResult;
  try {
    const gap = ctx.indicatorGapMs;
    result = await fetchAllIndicators(db, { http: ctx.indicatorHttp ?? fetchHttp, keys: readKeys(ctx.env, keyDirOf(ctx)), today: kstDate(ctx.now()), retryGapMs: gap ?? 2000 }, gap ?? 300);
  } finally {
    db.close();
  }
  updateRun(runFile, (s) => (s.indicatorFetch = result));
  ctx.out(["지표 받기:", ...indicatorFetchLines(result)].join("\n"));
  return EXIT.ok;
}

function indicatorFetchLines(r: IndicatorFetchResult): string[] {
  return Object.entries(r.indicators).map(([id, x]) => {
    const name = indicatorDef(id)?.name ?? id;
    if (x.status === "ok") return `  - ${name}: 받은 값 ${x.received}개(새 값 ${x.added}, 바뀐 값 ${x.changed}${x.removed > 0 ? `, 없어진 값 ${x.removed}` : ""}), 저장 ${x.total}개, 마지막 ${x.last ?? "없음"}`;
    return `  - ${name}: 실패(${x.reason}). 저장 값 ${x.total}개는 그대로, 다음 실행이 다시 받는다`;
  });
}

/** 실행 요약의 지표 줄(4.5-2). 앞 단계 실행 기록(지표 항목 없음)에는 붙이지 않는다 */
function indicatorSummaryLines(s: RunState): string[] {
  if (s.unjudgedAtStart === undefined && s.indicatorJudge === undefined && s.indicatorFetch === undefined) return [];
  const lines: string[] = [];
  const j = s.indicatorJudge;
  if (j !== undefined) {
    const applied = Object.values(j.results).filter((r): r is Extract<JudgeResult, { status: "applied" }> => r.status === "applied");
    lines.push(`- 지표 판단: 이슈 ${applied.reduce((n, r) => n + r.issues, 0)}개 판단, 지표를 고른 이슈 ${applied.reduce((n, r) => n + r.chosen, 0)}개`);
    for (const f of j.files) {
      const r = j.results[String(f.n)];
      if (r === undefined) lines.push(`  - 파일 ${f.n}: 적용하지 않았다(이슈 ${f.issues.length}개는 다음 실행이 다시 판단한다)`);
      else if (r.status === "failed") {
        lines.push(`  - 파일 ${f.n} 실패(이슈 ${f.issues.length}개는 다음 실행이 다시 판단한다): ${r.reason}`);
        for (const vi of r.violations ?? []) lines.push(`    - ${vi.where}: ${vi.why}`);
      }
    }
  }
  try {
    const db = openExistingDb(s.dbPath);
    try {
      lines.push(`- 아직 지표 판단 안 한 이슈: ${unjudgedIssues(db).length}개`);
    } finally {
      db.close();
    }
  } catch {
    // DB를 열 수 없으면 줄을 뺀다
  }
  if (s.indicatorFetch !== undefined) lines.push("- 지표 받기:", ...indicatorFetchLines(s.indicatorFetch));
  else lines.push("- 지표 받기: 하지 않았다");
  return lines;
}

// ---- 영상(7단계) ----

/** 30일 지우기 줄(4.5-1). 지운 수만 쓴다 */
function purgeLines(p: VideoPurgeResult): string[] {
  const extra: string[] = [];
  if (p.snapshotRows > 0) extra.push(`실행 전 사본의 기록 ${p.snapshotRows}개`);
  if (p.removedSnapshots.length > 0) extra.push(`열 수 없어 지운 실행 전 사본 ${p.removedSnapshots.length}개(${p.removedSnapshots.join(", ")})`);
  if (p.workFiles > 0) extra.push(`지난 실행의 영상 작업 파일 ${p.workFiles}개`);
  if (p.siteDirs > 0) extra.push(`사이트 입력·결과물 폴더 ${p.siteDirs}개`);
  const testRows = p.testDirs.reduce((n, t) => n + t.rows + t.snapshotRows, 0);
  const testOther = p.testDirs.reduce((n, t) => n + t.workFiles + t.siteDirs, 0);
  if (testRows + testOther > 0) extra.push(`시험 폴더의 기록 ${testRows}개·작업 파일과 사이트 폴더 ${testOther}개`);
  const lines = [`- 30일 지난 영상 지움: ${p.rows}개${extra.length > 0 ? ` (그 밖에 ${extra.join(", ")})` : ""}`];
  const unreadable = p.testDirs.flatMap((t) => t.unreadable.map((u) => `${t.dir}/${u}`));
  if (unreadable.length > 0) lines.push(`  - 경고: 시험 폴더의 열 수 없는 DB를 지우지 않고 두었다(사용자가 살펴본다): ${unreadable.join(", ")}`);
  return lines;
}

/** 영상 받기(4.2). 대상 날짜가 이미 고르기 끝남이면 YouTube를 부르지 않는다. 받기 실패는 종료 코드 1(뒤 단계는 계속한다) */
async function cmdVideoFetch(argv: string[], ctx: Context): Promise<number> {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const record = (r: VideoFetchState) => updateRun(runFile, (s) => (s.videoFetch = r));
  const now = ctx.now();
  const today = kstDate(now);
  const secrets = secretsOf(ctx);
  const db = openExistingDb(state.dbPath);
  try {
    const target = videoTargetDate(db);
    if (target === null) {
      record({ status: "noBrief", target });
      ctx.out("영상: 브리프가 없어 받지 않는다.");
      return EXIT.ok;
    }
    const prev = state.videoFetch;
    const fetchedInRun = prev?.target === target && (prev.status === "ok" || prev.status === "partial");
    if (isPicked(db, target)) {
      // 이 실행에서 받은 기록은 남긴다(요약의 받기 줄이 사라지지 않게)
      if (!fetchedInRun) record({ status: "alreadyDone", target });
      ctx.out(`영상: ${target} 이미 고르기 끝남. YouTube를 부르지 않는다(고르기를 건너뛴다).`);
      return EXIT.ok;
    }
    // 이 실행에서 이미 받아 후보가 남아 있으면 다시 부르지 않는다(하루 검색 할당량을 두 번 쓰지 않게). 목록은 남은 후보로 다시 쓴다
    const cand = fetchedInRun ? readCandidateFile(state.dataDir) : null;
    if (cand?.ok && cand.file.targetDate === target) {
      const md = restoreCandidateLists(state.dataDir, cand.file);
      ctx.out(`영상: 이 실행에서 이미 받았다. YouTube를 다시 부르지 않는다. 후보 목록 ${md}`);
      return EXIT.ok;
    }
    const key = readKeys(ctx.env, keyDirOf(ctx)).YOUTUBE_API_KEY;
    if (key === null) {
      removeVideoWorkFiles(state.dataDir);
      record({ status: "failed", target, keyProblem: true, failures: ["키 확인 필요: YOUTUBE_API_KEY가 없다"] });
      ctx.out(`영상 받기 실패(${target}): 키 확인 필요: YOUTUBE_API_KEY가 없다. 고르기를 건너뛴다. 다음 실행이 다시 받는다.`);
      return EXIT.failed;
    }
    const client = new YoutubeClient({ http: ctx.youtubeHttp ?? fetchYoutube, key, ...(ctx.youtubeLimits ? { limits: ctx.youtubeLimits } : {}), retryGapMs: ctx.youtubeRetryGapMs ?? 2000 });
    const report = await fetchVideos({ client, now, recent: recentVideoIds(db, today) });
    const base: VideoFetchState = {
      status: report.status,
      target,
      keyProblem: report.keyProblem,
      quota: report.quota,
      failures: report.failures.map((f) => maskSecrets(f, secrets)),
      missed: report.missed,
      charts: report.charts,
      searchResults: report.searchResults,
      usage: { ...report.usage },
      before: report.before,
      excluded: report.excluded,
    };
    if (report.status === "failed") {
      removeVideoWorkFiles(state.dataDir);
      record(base);
      ctx.out(maskSecrets(["영상 받기 실패. 고르기를 건너뛴다. 다음 실행이 다시 받는다.", ...videoFetchLines(base)].join("\n"), secrets));
      return EXIT.failed;
    }
    const file = buildCandidateFile(target, today, report.videos, issueCandidates(db, target));
    const paths = writeCandidateFiles(state.dataDir, file);
    const done: VideoFetchState = { ...base, candidates: file.candidates.length, issueCandidates: file.issues.length };
    record(done);
    ctx.out(maskSecrets([`영상 받기: 후보 목록 ${paths.md}`, `- 고르기 파일을 쓸 곳: ${paths.pick}`, ...videoFetchLines(done)].join("\n"), secrets));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 받기 결과 줄(받기 출력과 요약이 함께 쓴다). 수와 지역·카테고리 ID, 분야 이름만 쓴다 */
function videoFetchLines(r: VideoFetchState): string[] {
  const lines: string[] = [`- 영상 대상 날짜: ${r.target ?? "없음"}`];
  if (r.status === "alreadyDone") return [...lines, "- 영상 받기: 이미 고르기 끝남이라 YouTube를 부르지 않았다"];
  if (r.status === "noBrief") return [...lines, "- 영상 받기: 브리프가 없어 하지 않았다"];
  const head = { ok: "받음", partial: "일부만 받음(받은 것으로 후보 목록을 썼다)", failed: "실패(고르기 끝남이 되지 않아 다음 실행이 다시 받는다)" }[r.status];
  lines.push(`- 영상 받기: ${head}`);
  if (r.keyProblem) lines.push("  - 키 확인 필요(docs/operations.md의 영상 절)");
  if (r.quota) lines.push("  - 할당량 초과, 태평양 시간 자정에 풀림");
  for (const c of r.charts ?? []) lines.push(`  - ${c.region} 차트: 받은 차트 ${c.fetched}개, 건너뛴 카테고리 ${c.skipped.length}개${c.skipped.length > 0 ? `(${c.skipped.join(", ")})` : ""}`);
  if (r.usage) lines.push(`  - 쓴 양: 검색 ${r.usage.searches}번, 그 밖의 호출 ${r.usage.units}단위`);
  const sr = Object.entries(r.searchResults ?? {});
  if (sr.length > 0) lines.push(`  - 검색 결과 수: ${sr.map(([k, n]) => `${k} ${n}`).join(", ")}`);
  if (r.excluded && r.before !== undefined) {
    const ex = (Object.keys(EXCLUDE_LABELS) as ExcludeReason[]).map((k) => `${EXCLUDE_LABELS[k]} ${r.excluded![k]}`).join(", ");
    lines.push(`  - 후보: 거르기 전 ${r.before}개 → 거른 뒤 ${r.candidates ?? 0}개(뺀 것: ${ex})`);
  }
  if (r.issueCandidates !== undefined) lines.push(`  - 관련 이슈 후보: ${r.issueCandidates}개`);
  for (const m of r.missed ?? []) lines.push(`  - 상한에 닿아 받지 못함: ${m}`);
  for (const f of r.failures ?? []) lines.push(`  - 실패: ${f}`);
  return lines;
}

/** 고르기 검사·적용의 공통 준비: 후보 목록과 고르기 파일을 읽는다 */
function readPick(state: RunState): { ok: true; file: ReturnType<typeof buildCandidateFile>; data: unknown } | { ok: false; reason: string } {
  const cand = readCandidateFile(state.dataDir);
  if (!cand.ok) return { ok: false, reason: `${cand.reason}(먼저 video-fetch)` };
  const pick = readJsonFile(videoWorkFile(state.dataDir, "pick"), "고르기 파일");
  if (!pick.ok) return pick;
  return { ok: true, file: cand.file, data: pick.data };
}

/** 고르기 파일을 고쳐 다시 검사하는 최대 횟수(4.3-4). 처음 + 2번 */
const PICK_MAX_ATTEMPTS = 3;

function cmdVideoCheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const state = readRun(need(v, "run"));
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const r = readPick(state);
  if (!r.ok) {
    ctx.out(`영상 고르기 검사 실패:\n- ${r.reason}`);
    return EXIT.failed;
  }
  const db = openExistingDb(state.dbPath);
  try {
    const c = checkPickFile(db, r.data, r.file);
    if (!c.ok) {
      ctx.out(`영상 고르기 검사 실패, 위반 ${c.violations.length}개:\n${formatViolations(c.violations)}`);
      return EXIT.failed;
    }
    ctx.out(`영상 고르기 검사 통과: ${pickCounts(c.videos)}.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function countByBundle(videos: { bundle: VideoBundle }[]): Record<VideoBundle, number> {
  const out = { kr: 0, us: 0, "ai-ko": 0, "ai-en": 0 } as Record<VideoBundle, number>;
  for (const x of videos) out[x.bundle]++;
  return out;
}

const BUNDLE_NAMES: Record<VideoBundle, string> = { kr: "한국", us: "미국", "ai-ko": "AI 한국어", "ai-en": "AI 영어" };

function describeBundles(c: Record<VideoBundle, number>): string {
  return VIDEO_BUNDLES.map((b) => `${BUNDLE_NAMES[b]} ${c[b]}개`).join(", ");
}

function pickCounts(videos: { bundle: VideoBundle; issues: number[] }[]): string {
  return `${describeBundles(countByBundle(videos))}, 관련 이슈를 붙인 영상 ${videos.filter((x) => x.issues.length > 0).length}개`;
}

/** 검사 → 한 번에 적용 → 고르기 끝남 → 작업 파일 지우기(4.3-3~5). 실패하면 아무것도 적용하지 않고 파일을 남긴다 */
function cmdVideoApply(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const refused = indicatorCondition(state, ctx);
  if (refused !== null) return refused;
  const prev = state.videoPick;
  const attempts = prev?.status === "failed" ? prev.attempts : 0;
  const db = openExistingDb(state.dbPath);
  try {
    const target = videoTargetDate(db);
    if (target !== null && isPicked(db, target)) {
      // 이 실행에서 이미 적용했으면 그 기록(고른 수)을 남긴다
      if (prev?.status !== "applied" || prev.target !== target) updateRun(runFile, (s) => (s.videoPick = { status: "alreadyDone", target, attempts }));
      ctx.out(`영상: ${target} 이미 고르기 끝남. 바꾼 것이 없다.`);
      return EXIT.ok;
    }
    const fail = (reason: string, violations?: Violation[], count = true): number => {
      const n = count ? attempts + 1 : attempts;
      const st: VideoPickState = { status: "failed", target, attempts: n, reason };
      if (violations) st.violations = violations;
      updateRun(runFile, (s) => (s.videoPick = st));
      ctx.out(`영상 고르기를 적용하지 않음(${n}/${PICK_MAX_ATTEMPTS}번째 실패): ${reason}${violations ? `\n${formatViolations(violations)}` : ""}\n대상 날짜는 고르기 끝남이 되지 않아 다음 실행이 다시 받는다. 작업 파일은 남긴다.`);
      return EXIT.failed;
    };
    if (attempts >= PICK_MAX_ATTEMPTS) return fail(`고쳐서 다시 검사를 ${PICK_MAX_ATTEMPTS - 1}번 했는데도 위반이 남아 더 적용하지 않는다`, undefined, false);
    const r = readPick(state);
    if (!r.ok) return fail(r.reason);
    if (r.file.targetDate !== target) return fail(`후보 목록의 날짜(${r.file.targetDate})가 대상 날짜(${target ?? "없음"})와 다르다(video-fetch를 다시 한다)`);
    const c = checkPickFile(db, r.data, r.file);
    if (!c.ok) return fail("고르기 파일이 검사를 통과하지 못했다", c.violations);
    applyVideoPick(db, target, r.file.fetchedOn, c.videos);
    const cleaned = removeVideoWorkFiles(state.dataDir);
    updateRun(runFile, (s) => (s.videoPick = { status: "applied", target, attempts, picked: countByBundle(c.videos), withIssues: c.videos.filter((x) => x.issues.length > 0).length, cleaned }));
    ctx.out(`영상 고르기 적용함(${target}): ${pickCounts(c.videos)}. 고르기 끝남으로 두었다. 영상 작업 파일 ${cleaned}개를 지웠다.`);
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 실행 요약의 영상 줄(4.5-2). 앞 단계 실행 기록(영상 항목 없음)에는 붙이지 않는다. 영상 제목은 쓰지 않는다(4.8-3) */
function videoSummaryLines(s: RunState): string[] {
  if (s.videoPlanned === undefined && s.videoPurge === undefined && s.videoFetch === undefined && s.videoPick === undefined) return [];
  const lines: string[] = [];
  const f = s.videoFetch;
  if (f === undefined) lines.push("- 영상 받기: 하지 않았다(다음 실행이 다시 받는다)");
  else lines.push(...videoFetchLines(f));
  const p = s.videoPick;
  if (p === undefined) {
    if (f !== undefined && (f.status === "ok" || f.status === "partial")) lines.push("- 영상 고르기: 적용하지 않았다(작업 파일을 남겼다, 다음 실행이 다시 받는다)");
  } else if (p.status === "applied") {
    lines.push(`- 영상 고르기: ${describeBundles(p.picked!)}, 관련 이슈를 붙인 영상 ${p.withIssues ?? 0}개${p.attempts > 0 ? ` (고쳐서 다시 검사 ${p.attempts}번)` : ""}`);
  } else if (p.status === "alreadyDone") lines.push("- 영상 고르기: 이미 끝남");
  else {
    lines.push(`- 영상 고르기 실패(${p.attempts}번, 작업 파일을 남겼다, 다음 실행이 다시 받는다): ${p.reason ?? ""}`);
    for (const vi of p.violations ?? []) lines.push(`  - ${vi.where}: ${vi.why}`);
  }
  if (s.videoPurge !== undefined) lines.push(...purgeLines(s.videoPurge));
  return lines;
}

function homeOf(ctx: Context): string | null {
  return homeValue(ctx.env.HOME ?? os.homedir());
}

function describeSite(r: SiteResult | null): string[] {
  if (r === null) return ["실행하지 않았다"];
  if (r.status === "failed") return [`실패(배포하지 않는다, 다음 실행이 다시 빌드한다): ${r.reason}`, ...(r.findings ?? []).map((f) => `  - ${f}`)];
  const refs = r.entities === undefined ? "" : `, 인물·기관·국가 ${r.entities}개, 용어 ${r.terms ?? 0}개`;
  const schedules = r.schedules === undefined ? "" : `, 일정 ${r.schedules}개(다가오는 일정 ${r.upcoming ?? 0}개)`;
  const indicators = r.indicators === undefined ? "" : `, 공개 지표 ${r.indicators}개`;
  const videos = r.videos === undefined ? "" : `, 영상이 있는 브리프 날짜 ${r.videoDates ?? 0}개(영상 ${r.videos}개)`;
  const lines = [`브리프 날짜 ${r.dates}개, 이슈 ${r.issues}개, 결과물 ${formatMb(r.bytes)}, 파일 ${r.files}개${refs}${schedules}${indicators}${videos}`];
  if (r.bytes > WARN_BYTES || r.files > WARN_FILES) {
    lines.push(`  - 경고: Vercel 무료 한도(100MB, 파일 15,000개)에 가깝다(문턱 ${formatMb(WARN_BYTES)}, ${WARN_FILES.toLocaleString("en-US")}개). docs/operations.md의 한도 대응을 본다`);
  }
  return lines;
}

function describeDeploy(r: DeployResult | null): string[] {
  if (r === null) return ["실행하지 않았다"];
  if (r.status === "skipped") return [`건너뜀 (${r.reason})`];
  if (r.status === "failed") return [`실패(다음 실행이 다시 배포한다): ${r.reason}`, ...(r.findings ?? []).map((f) => `  - ${f}`)];
  const head = `${r.url}에 운영 배포함${r.deploymentUrl === null ? "" : ` (배포 주소 ${r.deploymentUrl})`}`;
  if (r.check.status === "passed") return [`${head}, 배포 뒤 점검 통과(최근 날짜 ${r.check.latestDate ?? "없음"})`];
  return [`${head}, 배포 뒤 점검 실패: ${r.check.reason} (자동으로 되돌리지 않았다. 다음 실행이 다시 배포한다)`];
}

function describePush(r: PushResult | null): string[] {
  if (r === null) return ["실행하지 않았다"];
  switch (r.status) {
    case "pushed":
      return [`커밋 ${r.commits}개를 origin에 push함`];
    case "upToDate":
      return ["원격과 같아 push할 것이 없다"];
    case "skipped":
      return [`건너뜀 (${r.reason})`];
    case "failed":
      return [`실패(다음 실행이 밀린 커밋을 다시 점검하고 push한다): ${r.reason}`, ...(r.findings ?? []).map((f) => `  - ${f}`)];
  }
}

/** 로컬에서 결과물을 열어 보는 명령(SPA 대체 경로를 지원한다) */
export function previewCommand(outDir: string): string {
  return `pnpm site:preview ${JSON.stringify(outDir)}`;
}

/** 요약의 사이트 줄(3단계 4.5-4). 앞 단계 실행 기록(필드 없음)에는 붙이지 않는다 */
function siteSummaryLines(s: RunState): string[] {
  if (s.site === undefined && s.deploy === undefined && s.push === undefined) return [];
  const block = (label: string, lines: string[]) => [`- ${label}: ${lines[0]}`, ...lines.slice(1)];
  const lines = block("사이트 빌드", describeSite(s.site ?? null));
  if (s.site && s.mode !== "real") {
    lines.push(`  - 결과물: ${s.site.outDir}`);
    if (s.site.status === "built") lines.push(`  - 로컬에서 보기: ${previewCommand(s.site.outDir)}`);
  }
  lines.push(...block("배포", describeDeploy(s.deploy ?? null)));
  lines.push(...block("data 브랜치 push", describePush(s.push ?? null)));
  return lines;
}

/** 사이트 빌드(4.1, 4.5). 실패해도 /brief는 다음 단계로 간다(종료 코드 1) */
function cmdSite(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" }, "data-dir": { type: "string" } });
  const runFile = typeof v.run === "string" ? v.run : undefined;
  const dirArg = typeof v["data-dir"] === "string" ? v["data-dir"] : undefined;
  if ((runFile === undefined) === (dirArg === undefined)) throw new UsageError("--run과 --data-dir 중 하나만 준다");
  let dataDir: string;
  let dbPath: string;
  if (runFile !== undefined) {
    const s = readRun(runFile);
    dataDir = s.dataDir;
    dbPath = s.dbPath;
  } else {
    dataDir = path.resolve(ctx.cwd, dirArg!);
    dbPath = path.join(dataDir, DB_FILE);
  }
  const secrets = secretsOf(ctx);
  const result = buildSite({ repoDir: requireRepo(ctx.cwd).toplevel, dataDir, dbPath, home: homeOf(ctx), secrets, builder: ctx.buildSite ?? nodeSiteBuilder, today: kstDate(ctx.now()) });
  if (runFile !== undefined) updateRun(runFile, (s) => (s.site = result));
  const lines = describeSite(result);
  lines[0] = `사이트 빌드: ${lines[0]}`;
  lines.push(`- 결과물: ${result.outDir}`);
  if (secrets.length === 0) lines.push("- 키 값 검사: 출처 API 키가 환경 변수와 .env.local 어디에도 없어 건너뛰었다");
  ctx.out(lines.join("\n"));
  return result.status === "built" ? EXIT.ok : EXIT.failed;
}

/** 배포(4.6). --run은 실제 실행에서만 배포한다. --dir/--db는 손으로 하는 배포다(4.9-2) */
async function cmdDeploy(argv: string[], ctx: Context): Promise<number> {
  const v = opts(argv, { run: { type: "string" }, dir: { type: "string" }, db: { type: "string" }, preview: { type: "boolean" } });
  if (v.preview === true) {
    if (typeof v.run === "string" || typeof v.db === "string") throw new UsageError("--preview는 --dir과만 쓴다");
    const p = deployPreview({ repoDir: requireRepo(ctx.cwd).toplevel, outDir: path.resolve(ctx.cwd, need(v, "dir")), home: homeOf(ctx), secrets: secretsOf(ctx), vercel: ctx.runVercel ?? cliVercel });
    if (p.status === "failed") {
      ctx.out([`미리보기 배포: 실패: ${p.reason}`, ...(p.findings ?? []).map((f) => `  - ${f}`)].join("\n"));
      return EXIT.failed;
    }
    ctx.out(`미리보기 배포함: ${p.url}\n- 운영 주소(${"https://tidwyn.vercel.app"})는 바뀌지 않았다.\n- Vercel 배포 보호로 로그인해야 열린다(보호가 꺼져 있으면 누구나 연다. docs/operations.md).`);
    return EXIT.ok;
  }
  const deps = { repoDir: requireRepo(ctx.cwd).toplevel, home: homeOf(ctx), secrets: secretsOf(ctx), vercel: ctx.runVercel ?? cliVercel, httpGet: ctx.httpGet ?? fetchGet, retry: ctx.checkRetry ?? DEFAULT_CHECK_RETRY };
  let result: DeployResult;
  if (typeof v.run === "string") {
    if (typeof v.dir === "string" || typeof v.db === "string") throw new UsageError("--run과 --dir/--db는 함께 쓸 수 없다");
    const runFile = v.run;
    const s = readRun(runFile);
    if (s.mode !== "real") result = { status: "skipped", reason: "시험 모드·데이터 폴더 지정 실행은 배포하지 않는다" };
    else if (s.site?.status !== "built") result = { status: "skipped", reason: s.site ? "사이트 빌드가 실패해 배포하지 않았다" : "사이트를 빌드하지 않아 배포하지 않았다" };
    else result = await deployOutput({ ...deps, outDir: s.site.outDir, dbPath: s.dbPath });
    updateRun(runFile, (st) => (st.deploy = result));
  } else {
    const dir = path.resolve(ctx.cwd, need(v, "dir"));
    const db = path.resolve(ctx.cwd, need(v, "db"));
    result = await deployOutput({ ...deps, outDir: dir, dbPath: db });
  }
  const lines = describeDeploy(result);
  lines[0] = `배포: ${lines[0]}`;
  ctx.out(lines.join("\n"));
  const failed = result.status === "failed" || (result.status === "deployed" && result.check.status === "failed");
  return failed ? EXIT.failed : EXIT.ok;
}

/** data 브랜치 push(4.5-1). 실제 실행에서만 한다 */
function cmdPush(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const s = readRun(runFile);
  let result: PushResult;
  if (s.mode !== "real") result = { status: "skipped", reason: "시험 모드·데이터 폴더 지정 실행은 push하지 않는다" };
  else if (s.backupRepo === null) result = { status: "skipped", reason: s.noCommitReason ?? "백업 저장소가 없다" };
  else result = pushDataBranch({ repo: s.backupRepo, home: homeOf(ctx), secrets: secretsOf(ctx), remote: ctx.remote ?? gitRemote });
  updateRun(runFile, (st) => (st.push = result));
  const lines = describePush(result);
  lines[0] = `data 브랜치 push: ${lines[0]}`;
  ctx.out(lines.join("\n"));
  return result.status === "failed" ? EXIT.failed : EXIT.ok;
}

/** 공개 전 점검(4.7-3): 참조들의 이력 전체와 git이 추적하는 지금 파일 */
function cmdPrecheck(argv: string[], ctx: Context): number {
  const v = opts(argv, { refs: { type: "string" } });
  const repo = requireRepo(ctx.cwd).toplevel;
  let refs: string[];
  if (typeof v.refs === "string") {
    refs = v.refs
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .map((r) => (r.startsWith("refs/") ? r : `refs/heads/${r}`));
    if (refs.length === 0) throw new UsageError("--refs에 브랜치가 없다");
    for (const r of refs) {
      if (gitTry(repo, ["rev-parse", "--verify", "--quiet", `${r}^{commit}`]) === null) throw new UsageError(`없는 참조다: ${r}`);
    }
  } else refs = localBranches(repo);
  const secrets = secretsOf(ctx);
  const r = precheck({ repo, commits: commitsOfRefs(repo, refs), trackedFiles: true, home: homeOf(ctx), secrets });
  const keyNote = secrets.length > 0 ? "출처 API 키 값도 찾았다." : "출처 API 키가 환경 변수와 .env.local 어디에도 없어 키 값 검사는 건너뛰었다.";
  const head = `공개 전 점검: 커밋 ${r.commits}개(${refs.map((x) => x.replace(/^refs\/heads\//, "")).join(", ") || "브랜치 없음"}), 커밋 속 파일 ${r.blobs}개, 지금 파일 ${r.files}개를 봤다. ${keyNote}`;
  if (r.findings.length === 0) {
    ctx.out(`${head}\n통과.`);
    return EXIT.ok;
  }
  ctx.out([head, `걸림 ${r.findings.length}건(값은 가렸다):`, ...describeFindings(r.findings, 200).map((l) => `- ${l}`)].join("\n"));
  return EXIT.failed;
}

const COMMANDS: Record<string, (argv: string[], ctx: Context) => number> = {
  check: cmdCheck,
  start: cmdStart,
  validate: cmdValidate,
  save: cmdSave,
  fail: cmdFail,
  backup: cmdBackup,
  summary: cmdSummary,
  render: cmdRender,
  restore: cmdRestore,
  issues: cmdIssues,
  "issue-search": cmdIssueSearch,
  "link-check": cmdLinkCheck,
  "link-apply": cmdLinkApply,
  "merge-list": cmdMergeList,
  "merge-check": cmdMergeCheck,
  "merge-apply": cmdMergeApply,
  merges: cmdMerges,
  unmerge: cmdUnmerge,
  refs: cmdRefs,
  "ref-search": cmdRefSearch,
  "ref-check": cmdRefCheck,
  "ref-apply": cmdRefApply,
  "ref-unmerge": cmdRefUnmerge,
  "ref-delete": cmdRefDelete,
  schedules: cmdSchedules,
  "schedule-search": cmdScheduleSearch,
  "schedule-check": cmdScheduleCheck,
  "schedule-apply": cmdScheduleApply,
  "schedule-unmerge": cmdScheduleUnmerge,
  "schedule-delete": cmdScheduleDelete,
  "indicator-list": cmdIndicatorList,
  "indicator-check": cmdIndicatorCheck,
  "indicator-apply": cmdIndicatorApply,
  "video-check": cmdVideoCheck,
  "video-apply": cmdVideoApply,
  site: cmdSite,
  push: cmdPush,
  precheck: cmdPrecheck,
};

function handleError(e: unknown, ctx: Context): number {
  if (e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
    ctx.out(`${(e as Error).message}\n${USAGE}`);
    return EXIT.usage;
  }
  ctx.out(`오류: ${(e as Error).message}`);
  return EXIT.failed;
}

/** 지난 날짜 이미지 채우기(3단계 4.4-2). 피드를 받지 못해도 실행은 계속한다(종료 코드 0). DB를 열지 못할 때만 실패다 */
async function cmdImages(argv: string[], ctx: Context): Promise<number> {
  const v = opts(argv, { run: { type: "string" } });
  const runFile = need(v, "run");
  const state = readRun(runFile);
  const record = (r: ImagesResult) => updateRun(runFile, (s) => (s.images = r));
  let db: ReturnType<typeof openDb>;
  try {
    db = openExistingDb(state.dbPath);
  } catch (e) {
    const reason = (e as Error).message;
    record({ status: "failed", reason });
    ctx.out(`지난 날짜 이미지 채우기 실패: ${reason}`);
    return EXIT.failed;
  }
  try {
    const r = await fillImages(db, ctx.fetchText ?? realFetch);
    record({ status: "done", filled: r.filled, failures: r.failures });
    const lines = [`지난 날짜 이미지 채우기: 출처 ${r.filled}개 채움`];
    for (const f of r.failures) lines.push(`- 받지 못한 피드: ${f.feed}: ${f.reason} (${f.url})`);
    ctx.out(lines.join("\n"));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

/** 네트워크를 쓰는 명령. mainAsync로만 실행한다 */
const ASYNC_COMMANDS: Record<string, (argv: string[], ctx: Context) => Promise<number>> = {
  feeds: cmdFeeds,
  images: cmdImages,
  deploy: cmdDeploy,
  "indicator-fetch": cmdIndicatorFetch,
  "video-fetch": cmdVideoFetch,
};

/** 모든 명령 이름(스킬 문서의 명령 이름 검사, 3단계 4.5-1) */
export const COMMAND_NAMES: readonly string[] = [...Object.keys(COMMANDS), ...Object.keys(ASYNC_COMMANDS)].sort();

/** 동기 명령을 실행한다 */
export function main(argv: string[], ctx: Context): number {
  const [name, ...rest] = argv;
  const cmd = name === undefined ? undefined : COMMANDS[name];
  if (cmd === undefined) {
    ctx.out(USAGE);
    return EXIT.usage;
  }
  try {
    return cmd(rest, ctx);
  } catch (e) {
    return handleError(e, ctx);
  }
}

/** 모든 명령을 실행한다(네트워크를 쓰는 명령 포함) */
export async function mainAsync(argv: string[], ctx: Context): Promise<number> {
  const [name, ...rest] = argv;
  const cmd = name === undefined ? undefined : ASYNC_COMMANDS[name];
  if (cmd === undefined) return main(argv, ctx);
  try {
    return await cmd(rest, ctx);
  } catch (e) {
    return handleError(e, ctx);
  }
}

if (import.meta.main) {
  process.exitCode = await mainAsync(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    now: () => new Date(),
    out: (text) => console.log(text),
    install: pnpmInstall,
  });
}
