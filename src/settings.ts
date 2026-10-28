import fs from "node:fs";
import path from "node:path";
import { isValidDate, kstStamp, kstYesterday } from "./kst.ts";
import { currentBranch, headCommit, realPathLoose, repoInfo, requireRepo, samePath, statusLines, type RepoInfo } from "./paths.ts";
import { gitTry } from "./git.ts";

export const ENV_DATA_DIR = "TIDWYN_DATA_DIR";
export const ENV_BACKUP_REPO = "TIDWYN_BACKUP_REPO";
export const DB_FILE = "tidwyn.db";
export const TEST_DATA_ROOT = ".test-data";
export const USAGE = [
  "사용법:",
  "  /brief                 실제 실행(main 체크아웃, 변경 사항 없음일 때만)",
  "  /brief test            시험 모드(임시 데이터 폴더, 커밋 안 함)",
  "  /brief test YYYY-MM-DD 시험 모드, 그날부터 KST 어제까지 수집",
].join("\n");

export interface RunArgs {
  test: boolean;
  startDate: string | null;
}

export type ArgsResult = { ok: true; args: RunArgs } | { ok: false; message: string };

/** 스킬 인자를 확인한다(4.1-8). Node 내장 기능만 쓴다. */
export function parseArgs(argv: string[], now: Date): ArgsResult {
  let test = false;
  let startDate: string | null = null;
  const fail = (why: string): ArgsResult => ({ ok: false, message: `${why}\n${USAGE}` });
  for (const raw of argv) {
    const a = raw.trim();
    if (a === "") continue;
    if (a === "test") {
      if (test) return fail("`test`가 두 번 있다.");
      test = true;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(a)) {
      if (startDate !== null) return fail("시작일이 두 개 있다.");
      if (!isValidDate(a)) return fail(`시작일 ${a}은(는) 없는 날짜다.`);
      startDate = a;
    } else {
      return fail(`알 수 없는 인자: ${a}`);
    }
  }
  if (startDate !== null && !test) return fail("시작일은 시험 모드(`/brief test YYYY-MM-DD`)에서만 받는다.");
  if (startDate !== null && startDate > kstYesterday(now)) {
    return fail(`시작일 ${startDate}이(가) KST 어제(${kstYesterday(now)})보다 뒤다.`);
  }
  return { ok: true, args: { test, startDate } };
}

export type RunMode = "real" | "test" | "custom";

export interface Settings {
  mode: RunMode;
  repo: RepoInfo;
  dataDir: string;
  realDataDir: string;
  isRealDataDir: boolean;
  dbPath: string;
  /** 백업을 커밋할 저장소(메인 작업 폴더). 커밋하지 않으면 null */
  backupRepo: string | null;
  noCommitReason: string | null;
  startDate: string | null;
}

export interface ResolveInput {
  cwd: string;
  env: NodeJS.ProcessEnv;
  args: RunArgs;
  now: Date;
}

/** 새 시험 데이터 폴더 경로(지금 작업 트리 안, git이 무시하는 곳) */
function newTestDataDir(toplevel: string, now: Date): string {
  const base = path.join(toplevel, TEST_DATA_ROOT, kstStamp(now));
  let dir = base;
  for (let i = 2; fs.existsSync(dir); i++) dir = `${base}-${i}`;
  return dir;
}

/** 데이터 폴더와 백업 저장소를 정한다(4.1-8, 4.3-1, 4.5-4). 아무것도 쓰지 않는다. */
export function resolveSettings({ cwd, env, args, now }: ResolveInput): Settings {
  const repo = requireRepo(cwd);
  const realDataDir = path.join(repo.mainRoot, "data");
  let dataDir: string;
  if (args.test) dataDir = newTestDataDir(repo.toplevel, now);
  else if (env[ENV_DATA_DIR]) dataDir = realPathLoose(path.resolve(cwd, env[ENV_DATA_DIR]));
  else dataDir = realDataDir;
  const isRealDataDir = samePath(dataDir, realDataDir);
  const mode: RunMode = args.test ? "test" : isRealDataDir ? "real" : "custom";

  let backupRepo: string | null = null;
  let noCommitReason: string | null = null;
  if (args.test) {
    noCommitReason = "시험 모드는 커밋하지 않는다";
  } else {
    const envRepo = env[ENV_BACKUP_REPO];
    if (envRepo) {
      const info = repoInfo(path.resolve(cwd, envRepo));
      if (info === null) noCommitReason = `백업 저장소로 지정한 곳이 git 저장소가 아니다: ${envRepo}`;
      else backupRepo = info.mainRoot;
    } else if (isRealDataDir) {
      backupRepo = repo.mainRoot;
    } else {
      noCommitReason = "데이터 폴더를 바꿨는데 백업 저장소를 지정하지 않아 내보내기만 한다";
    }
    if (backupRepo !== null && !isRealDataDir && samePath(backupRepo, repo.mainRoot)) {
      backupRepo = null;
      noCommitReason = "실제 데이터 폴더가 아닌데 백업 저장소가 이 프로젝트 저장소라 커밋하지 않는다";
    }
  }
  return {
    mode,
    repo,
    dataDir,
    realDataDir,
    isRealDataDir,
    dbPath: path.join(dataDir, DB_FILE),
    backupRepo,
    noCommitReason,
    startDate: args.startDate,
  };
}

export type ConditionResult = { ok: true } | { ok: false; message: string };

export function hasDataBranch(repoDir: string): boolean {
  return gitTry(repoDir, ["rev-parse", "--verify", "--quiet", "refs/heads/data^{commit}"]) !== null;
}

/** 실행 조건(S12)과 복원 필요(4.1-2)를 확인한다. 실제 데이터 폴더일 때만 본다. Node 내장 기능과 git만 쓴다. */
export function checkRunCondition(s: Settings): ConditionResult {
  if (!s.isRealDataDir) return { ok: true };
  const reasons: string[] = [];
  const todo: string[] = [];
  if (s.repo.inLinkedWorktree) {
    reasons.push("git worktree 안에서 실행 중이다.");
    todo.push("메인 작업 폴더에서 worktree 없이 Claude Code 세션을 열고 실행한다.");
  }
  const branch = currentBranch(s.repo.mainRoot);
  if (branch !== "main") {
    reasons.push(`메인 작업 폴더가 main이 아니라 ${branch ?? "분리된 HEAD"}를 체크아웃하고 있다.`);
    todo.push("작업을 커밋한 뒤 main으로 바꾼다(git switch main).");
  }
  const changes = statusLines(s.repo.mainRoot);
  if (changes.length > 0) {
    const shown = changes.slice(0, 10).map((l) => `    ${l}`);
    if (changes.length > 10) shown.push(`    … 외 ${changes.length - 10}개`);
    reasons.push(`메인 작업 폴더에 변경 사항이 있다:\n${shown.join("\n")}`);
    todo.push("변경을 작업 브랜치에 커밋하거나 되돌린다. 도구가 만든 추적되지 않은 파일(예: .serena/memories/)이 원인일 수 있다.");
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      message: [
        "실행 조건이 맞지 않아 아무것도 쓰지 않고 멈춘다(실제 실행은 main 체크아웃, 변경 사항 없음일 때만 돈다).",
        "이유:",
        ...reasons.map((r) => `  - ${r}`),
        "할 일:",
        ...todo.map((t) => `  - ${t}`),
        "시험 실행은 `/brief test`로 조건 없이 할 수 있다.",
      ].join("\n"),
    };
  }
  if (!fs.existsSync(s.dbPath) && s.backupRepo !== null && hasDataBranch(s.backupRepo)) {
    return {
      ok: false,
      message: [
        "실제 데이터 폴더에 DB가 없는데 백업 저장소의 data 브랜치에 백업이 있어 아무것도 쓰지 않고 멈춘다.",
        "이대로 첫 실행으로 처리하면 하루치 백업이 기존 백업을 덮는다. 먼저 백업에서 DB를 복원한다.",
        "복원 명령(프로젝트 폴더에서 실행, 의존성 설치 필요 없음):",
        `  ${restoreCommand(s)}`,
        "복원한 뒤 /brief를 다시 실행한다.",
      ].join("\n"),
    };
  }
  return { ok: true };
}

/** 4.1-2가 알려 주는 복원 명령 */
export function restoreCommand(s: Settings): string {
  const parts = ["node src/cli.ts restore"];
  if (s.backupRepo !== null && !samePath(s.backupRepo, s.repo.mainRoot)) parts.push(`--repo ${JSON.stringify(s.backupRepo)}`);
  if (!s.isRealDataDir) parts.push(`--out ${JSON.stringify(s.dbPath)}`);
  return parts.join(" ");
}

/** 실행 설정 표시(4.1-8) */
export function describeSettings(s: Settings): string {
  const modeName = { real: "실제 실행", test: "시험 모드", custom: "데이터 폴더 지정" }[s.mode];
  const branch = currentBranch(s.repo.toplevel) ?? "분리된 HEAD";
  const commit = headCommit(s.repo.toplevel) ?? "커밋 없음";
  const dirty = statusLines(s.repo.toplevel).length > 0 ? " (변경 사항 있음)" : "";
  return [
    "실행 설정",
    `- 모드: ${modeName}`,
    `- 데이터 폴더: ${s.dataDir}`,
    `- 코드: ${branch} @ ${commit}${dirty}`,
    `- 백업 저장소: ${s.backupRepo ?? `커밋 안 함 (${s.noCommitReason ?? ""})`}`,
  ].join("\n");
}
