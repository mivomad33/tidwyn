import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseArgs as parseNodeArgs } from "node:util";
import { BACKUP_DIR, backupMessage, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "./backup.ts";
import { openDb, openExistingDb } from "./db.ts";
import { kstIso, kstStamp } from "./kst.ts";
import { markdownPath, writeMarkdown } from "./markdown.ts";
import { requireRepo } from "./paths.ts";
import { RUNS_DIR, readRun, updateRun, workFile, writeRun, type BackupResult, type RunState } from "./run.ts";
import { DB_FILE, ENV_DATA_DIR, checkRunCondition, describeSettings, parseArgs, resolveSettings, type Settings } from "./settings.ts";
import { pruneSnapshots, takeSnapshot } from "./snapshot.ts";
import { AlreadyStoredError, loadBrief, recordFirstCollectionDate, saveBrief } from "./store.ts";
import { isLate, planTargets } from "./targets.ts";
import { formatViolations, validateBrief } from "./validate.ts";

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
  validate --run <파일> --date <날짜>   작업 파일(work/<날짜>.json) 검사
  save --run <파일> --date <날짜>       검사 → 저장 → 마크다운
  fail --run <파일> --date <날짜> --reason <이유>   조사 실패 기록
  backup [--run <파일>]          월별 JSON 내보내기와 data 브랜치 커밋
  summary --run <파일>           실행 끝 출력
  render --date <날짜>           DB에서 마크다운 다시 만들기
  restore [--repo <저장소> | --from <폴더>] [--out <DB 경로>] [--force]   백업에서 DB 복원`;

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
  try {
    const plan = planTargets(db, now, s.startDate);
    if (plan.firstDateToRecord !== null) recordFirstCollectionDate(db, plan.firstDateToRecord);
    targets = plan.dates;
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
  };
  writeRun(runFile, state);
  ctx.out(
    [
      `- 실행 전 사본: ${snapshot ?? "DB가 없어 건너뜀(첫 실행)"}${pruned.length > 0 ? ` (오래된 사본 ${pruned.length}개 지움)` : ""}`,
      `- 실행 기록: ${runFile}`,
      `- 대상 날짜: ${targets.length > 0 ? targets.join(", ") : "없음(빠진 날짜가 없다)"}`,
      ...targets.map((d) => `  - ${d} 작업 파일: ${workFile(s.dataDir, d)}`),
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

function cmdRender(argv: string[], ctx: Context): number {
  const v = opts(argv, { date: { type: "string" }, run: { type: "string" } });
  const date = need(v, "date");
  let dataDir: string;
  let dbPath: string;
  if (typeof v.run === "string") {
    const s = readRun(v.run);
    dataDir = s.dataDir;
    dbPath = s.dbPath;
  } else {
    const s = resolveSettings({ cwd: ctx.cwd, env: ctx.env, args: { test: false, startDate: null }, now: ctx.now() });
    dataDir = s.dataDir;
    dbPath = s.dbPath;
  }
  const db = openExistingDb(dbPath);
  try {
    const stored = loadBrief(db, date);
    if (stored === null) {
      ctx.out(`${date} 브리프가 DB에 없다.`);
      return EXIT.failed;
    }
    ctx.out(`마크다운을 다시 만들었다: ${writeMarkdown(dataDir, stored)}`);
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
};

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
    if (e instanceof UsageError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS")) {
      ctx.out(`${(e as Error).message}\n${USAGE}`);
      return EXIT.usage;
    }
    ctx.out(`오류: ${(e as Error).message}`);
    return EXIT.failed;
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2), {
    cwd: process.cwd(),
    env: process.env,
    now: () => new Date(),
    out: (text) => console.log(text),
    install: pnpmInstall,
  });
}
