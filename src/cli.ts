import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { BACKUP_DIR, backupMessage, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "./backup.ts";
import { openDb, openExistingDb } from "./db.ts";
import { collectCandidates, describeFeedReport, feedSpecs, fetchText as realFetch, renderCandidatesMarkdown, type FetchText } from "./feeds.ts";
import { issueIndexPath, renderAll, writeBriefMarkdown } from "./issueMarkdown.ts";
import { linkableDates, unlinkedCount, unlinkedStories } from "./issues.ts";
import { kstDate, kstIso, kstStamp } from "./kst.ts";
import { applyLinkPlan, checkLinkFile, renderLinkWork, renderSearch } from "./links.ts";
import { markdownPath, writeMarkdown } from "./markdown.ts";
import { applyMerges, checkMergeFile, describeMerges, markMergeChecked, mergeCandidates, mergeDue, renderMergeCandidates, unmerge } from "./merge.ts";
import { priorityRatio } from "./outlets.ts";
import { requireRepo } from "./paths.ts";
import {
  RUNS_DIR,
  candidatesFile,
  linkWorkFile,
  mergeWorkFile,
  readRun,
  updateRun,
  workFile,
  writeRun,
  type BackupResult,
  type LinkResult,
  type MergeStepResult,
  type RunState,
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
  backup [--run <파일>]          월별 JSON 내보내기와 data 브랜치 커밋
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
  merges [--run <파일>]                   합치기 기록 목록
  unmerge --id <번호>                     합치기 하나 되돌리기(사용자가 직접 실행, /brief는 실행하지 않음)`;

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
  const db = openDb(s.dbPath);
  let targets: string[];
  let linkDates: string[];
  let mergeLine: string;
  try {
    const plan = planTargets(db, now, s.startDate);
    if (plan.firstDateToRecord !== null) recordFirstCollectionDate(db, plan.firstDateToRecord);
    targets = plan.dates;
    linkDates = linkableDates(db);
    const due = mergeDue(db, kstDate(now));
    mergeLine = due.due ? `이번 실행 끝에 한다(마지막 점검 ${due.checkedOn})` : due.nextOn === null ? "아직 연결한 이슈가 없다" : `다음 점검 ${due.nextOn}`;
  } finally {
    db.close();
  }
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
  };
  writeRun(runFile, state);
  ctx.out(
    [
      `- 실행 전 사본: ${snapshot ?? "DB가 없어 건너뜀(첫 실행)"}${pruned.length > 0 ? ` (오래된 사본 ${pruned.length}개 지움)` : ""}`,
      `- 실행 기록: ${runFile}`,
      `- 대상 날짜: ${targets.length > 0 ? targets.join(", ") : "없음(빠진 날짜가 없다)"}`,
      ...targets.map((d) => `  - ${d} 작업 파일: ${workFile(s.dataDir, d)}`),
      `- 이슈를 연결할 저장된 날짜(소급·재시도): ${linkDates.length > 0 ? linkDates.join(", ") : "없음"}`,
      `- 합치기: ${mergeLine}`,
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
      updateRun(runFile, (s) => (s.results[date] = { status: "saved", markdownPath: md }));
      ctx.out(`저장함(${date}). 마크다운: ${md}`);
    } catch (e) {
      const markdownError = (e as Error).message;
      updateRun(runFile, (s) => (s.results[date] = { status: "saved", markdownPath: null, markdownError }));
      ctx.out(`저장함(${date}). 마크다운 만들기 실패: ${markdownError}`);
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
  lines.push(`- 백업: ${describeBackup(s.backup)}`);
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
    if (pairs.length === 0) {
      markMergeChecked(db, today);
      record({ status: "none", candidates: 0 });
      ctx.out(`합치기: 할 일 있음(마지막 점검 ${due.checkedOn}). 후보가 없어 합친 것 없이 점검일을 ${today}로 바꿨다.`);
      return EXIT.ok;
    }
    const file = mergeWorkFile(state.dataDir, "candidates.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, renderMergeCandidates(db, pairs));
    record({ status: "pending", candidates: pairs.length });
    ctx.out(`합치기: 할 일 있음(마지막 점검 ${due.checkedOn}). 후보 ${pairs.length}쌍: ${file}\n합치기 파일을 쓸 곳: ${mergeWorkFile(state.dataDir, "json")}`);
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
    const r = checkMergeFile(db, file.data);
    if (!r.ok) {
      ctx.out(`합치기 검사 실패, 위반 ${r.violations.length}개:\n${formatViolations(r.violations)}`);
      return EXIT.failed;
    }
    ctx.out(`합치기 검사 통과: ${r.merges.length}쌍.`);
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
    const checked = checkMergeFile(db, file.data);
    if (!checked.ok) return fail("합치기 파일이 검사를 통과하지 못했다", checked.violations);
    const names = new Map<number, string>();
    for (const m of checked.merges) for (const id of [m.survivor, m.absorbed]) names.set(id, getIssueName(db, id));
    const ids = applyMerges(db, checked.merges, kstDate(ctx.now()));
    if (ids.length === 0) {
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
    record({ status: "merged", merges });
    const lines = merges.map((m) => `- 합치기 ${m.id}: 이슈 ${m.absorbed}(${m.absorbedName}) → 이슈 ${m.survivor}(${m.survivorName}). 되돌리기: node src/cli.ts unmerge --id ${m.id}`);
    ctx.out([`합침: ${merges.length}쌍. 점검일을 ${kstDate(ctx.now())}로 바꿨다.`, ...lines, rerender(db, state.dataDir)].join("\n"));
    return EXIT.ok;
  } finally {
    db.close();
  }
}

function getIssueName(db: ReturnType<typeof openDb>, id: number): string {
  return (db.prepare("SELECT name FROM issues WHERE id = ?").get(id) as { name: string } | undefined)?.name ?? "";
}

function cmdMerges(argv: string[], ctx: Context): number {
  const v = opts(argv, { run: { type: "string" } });
  const db = openExistingDb(dataTarget(v.run, ctx).dbPath);
  try {
    ctx.out(describeMerges(db));
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
    lines.push(`- 합치기: ${m.merges.length}쌍을 합쳤다`);
    for (const x of m.merges) {
      lines.push(`  - 이슈 ${x.absorbed}(${x.absorbedName}) → 이슈 ${x.survivor}(${x.survivorName}). 이유: ${x.reason}. 되돌리기: node src/cli.ts unmerge --id ${x.id}`);
    }
  } else {
    lines.push(`- 합치기 실패(점검일을 바꾸지 않았다, 다음 실행이 다시 한다): ${m.reason}`);
    if (m.violations) for (const vi of m.violations) lines.push(`  - ${vi.where}: ${vi.why}`);
  }
  const index = issueIndexPath(s.dataDir);
  lines.push(`- 이슈 목록: ${fs.existsSync(index) ? index : `아직 없다(${index})`}`);
  return lines;
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
};

function handleError(e: unknown, ctx: Context): number {
  if (e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
    ctx.out(`${(e as Error).message}\n${USAGE}`);
    return EXIT.usage;
  }
  ctx.out(`오류: ${(e as Error).message}`);
  return EXIT.failed;
}

/** 네트워크를 쓰는 명령. mainAsync로만 실행한다 */
const ASYNC_COMMANDS: Record<string, (argv: string[], ctx: Context) => Promise<number>> = {
  feeds: cmdFeeds,
};

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
