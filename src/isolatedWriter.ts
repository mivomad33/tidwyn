import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KEY_NAMES } from "./keys.ts";

// 9.9단계 N11, 9.97단계 4.2-1: 외부인이 쓴 재료를 읽는 별도 Claude 프로세스의 공통 실행 방식.
// 새 임시 폴더(상위에 git·CLAUDE.md 없음)에 재료 사본 하나를 두고, 고정 플래그로 `Read`·`Write`만 허락한다.
// 허용 경로는 재료 읽기와 결과 파일 쓰기 둘이고, 키와 유료 인증 값을 환경에서 빼며, 표준 출력과 오류는 버린다.

/** 프로세스 하나의 시간 상한 */
export const WRITE_TIMEOUT_MS = 8 * 60_000;

export interface ClaudeRequest {
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface ClaudeResult {
  status: number | null;
  timedOut: boolean;
}

export type ClaudeRunner = (r: ClaudeRequest) => ClaudeResult;

/** 표준 입력을 닫고 표준 출력과 오류를 버린다 */
export const claudeRunner: ClaudeRunner = ({ args, cwd, env, timeoutMs }) => {
  const r = spawnSync("claude", args, { cwd, env, stdio: "ignore", timeout: timeoutMs, killSignal: "SIGKILL" });
  return { status: r.status, timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT" };
};

/** 고정 플래그. 프롬프트는 값을 여러 개 받는 플래그 앞에 둔다 */
export function isolatedArgs(prompt: string, readName: string, writeName: string): string[] {
  return ["-p", prompt, "--permission-mode", "dontAsk", "--strict-mcp-config", "--setting-sources", "", "--disable-slash-commands", "--tools", "Read,Write", "--allowedTools", `Read(./${readName})`, `Edit(./${writeName})`];
}

const DROPPED_ENV: readonly string[] = [...KEY_NAMES, "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"];

/** 키를 뺀 환경. 유료 인증 값도 빼서 구독으로만 돌게 한다 */
export function isolatedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !DROPPED_ENV.includes(k)));
}

/** 상위에 git 저장소나 CLAUDE.md가 있으면 프로젝트 지침이 끼어들 수 있다 */
export function hasProjectAbove(dir: string): boolean {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git")) || fs.existsSync(path.join(d, "CLAUDE.md"))) return true;
    if (d === path.dirname(d)) return false;
  }
}

export type WriteFailure = "시간 초과" | "프로세스 실패" | "항목 파일 없음" | "임시 폴더가 프로젝트 안이다";

export interface IsolatedRun {
  /** 재료 사본의 내용과 이름 */
  copyText: string;
  copyName: string;
  /** 프로세스가 쓸 결과 파일 이름과, 꺼내 둘 곳 */
  outName: string;
  outFile: string;
  prompt: string;
  env: NodeJS.ProcessEnv;
  run: ClaudeRunner;
  timeoutMs: number;
  /** 임시 폴더를 둘 곳(시험용). 기본은 시스템 임시 폴더 */
  tmpRoot?: string;
}

/** 새 임시 폴더에서 프로세스를 한 번 돌리고 결과 파일을 꺼낸다. 실패면 이유. 끝나면 임시 폴더를 지운다 */
export function runIsolated(o: IsolatedRun): WriteFailure | null {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(o.tmpRoot ?? os.tmpdir()), "tidwyn-write-"));
  try {
    if (hasProjectAbove(dir)) return "임시 폴더가 프로젝트 안이다";
    fs.writeFileSync(path.join(dir, o.copyName), o.copyText);
    const r = o.run({ args: isolatedArgs(o.prompt, o.copyName, o.outName), cwd: dir, env: isolatedEnv(o.env), timeoutMs: o.timeoutMs });
    if (r.timedOut) return "시간 초과";
    if (r.status !== 0) return "프로세스 실패";
    const out = path.join(dir, o.outName);
    if (!fs.existsSync(out) || !fs.lstatSync(out).isFile()) return "항목 파일 없음";
    fs.copyFileSync(out, o.outFile);
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
