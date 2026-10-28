import { execFileSync } from "node:child_process";

export interface GitOptions {
  input?: string | Buffer;
  env?: NodeJS.ProcessEnv;
}

/** git 명령을 실행하고 표준 출력을 돌려준다. 실패하면 예외를 던진다. */
export function git(cwd: string, args: string[], options: GitOptions = {}): string {
  return execFileSync("git", args, {
    cwd,
    input: options.input,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** 실패하면 null을 돌려준다 */
export function gitTry(cwd: string, args: string[], options: GitOptions = {}): string | null {
  try {
    return git(cwd, args, options);
  } catch {
    return null;
  }
}
