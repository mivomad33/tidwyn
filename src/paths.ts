import fs from "node:fs";
import path from "node:path";
import { git, gitTry } from "./git.ts";

/**
 * 실제 경로로 푼다. 아직 없는 경로는 가장 가까운 있는 상위 폴더를 풀고 나머지를 붙인다.
 * 상대 경로, 심볼릭 링크, macOS의 /var → /private/var, 대소문자 차이(native가 실제 이름으로 바꾼다)를 없애고 비교하기 위해서다.
 */
export function realPathLoose(p: string): string {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * 같은 곳을 가리키는지. 아직 없는 경로 부분은 대소문자를 바로잡을 수 없으므로 대소문자를 무시하고 비교한다.
 * 대소문자를 구분하는 파일 시스템에서는 다른 폴더도 같다고 볼 수 있지만, 실제 데이터 폴더를 지키는 쪽(더 엄격한 쪽)으로 틀린다.
 */
export function samePath(a: string, b: string): boolean {
  return realPathLoose(a).toLowerCase() === realPathLoose(b).toLowerCase();
}

export interface RepoInfo {
  /** 지금 폴더가 속한 작업 트리의 최상위 */
  toplevel: string;
  /** 메인 작업 폴더(git worktree가 아닌 원래 작업 폴더) */
  mainRoot: string;
  /** 연결된 worktree 안인지 */
  inLinkedWorktree: boolean;
}

/** git 저장소 정보. 저장소가 아니면 null */
export function repoInfo(cwd: string): RepoInfo | null {
  const out = gitTry(cwd, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"]);
  if (out === null) return null;
  const [toplevel, gitDir, commonDir] = out.trim().split("\n");
  if (!toplevel || !gitDir || !commonDir) return null;
  return {
    toplevel: realPathLoose(toplevel),
    mainRoot: realPathLoose(path.dirname(commonDir)),
    inLinkedWorktree: realPathLoose(gitDir) !== realPathLoose(commonDir),
  };
}

/** 저장소의 메인 작업 폴더. 저장소가 아니면 예외 */
export function requireRepo(cwd: string): RepoInfo {
  const info = repoInfo(cwd);
  if (info === null) throw new Error(`git 저장소가 아니다: ${cwd}`);
  return info;
}

/** 브랜치 이름(분리된 HEAD면 null) */
export function currentBranch(cwd: string): string | null {
  const out = gitTry(cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return out === null ? null : out.trim();
}

export function headCommit(cwd: string): string | null {
  const out = gitTry(cwd, ["rev-parse", "--short", "HEAD"]);
  return out === null ? null : out.trim();
}

/** git status에 나오는 변경(무시되는 파일 제외) */
export function statusLines(cwd: string): string[] {
  return git(cwd, ["status", "--porcelain=v1", "--untracked-files=all"])
    .split("\n")
    .filter((l) => l.length > 0);
}
