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

/** git 명령을 실행하고 표준 출력을 바이트 그대로 돌려준다(바이너리 파일 내용을 읽을 때). 실패하면 예외를 던진다. */
export function gitBuffer(cwd: string, args: string[], options: GitOptions = {}): Buffer {
  return execFileSync("git", args, {
    cwd,
    input: options.input,
    env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 1024,
  });
}
