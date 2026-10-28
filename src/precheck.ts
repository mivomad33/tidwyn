import fs from "node:fs";
import path from "node:path";
import { git, gitBuffer } from "./git.ts";
import { SNAPSHOT_NAME_RE } from "./snapshot.ts";

// 공개 전 점검(3단계 4.7-3)과 결과물 검사(4.1-4)가 함께 쓰는 검사.
// 걸린 값은 출력하지 않는다(파일·커밋과 종류, 줄 번호만). 이 파일에는 걸리는 값을 그대로 적지 않는다(이 파일도 검사 대상이다).

/** 이 저장소의 GitHub noreply 주소(명세서 6장). 커밋 작성자·커미터 이메일은 이 주소여야 한다 */
export const REPO_NOREPLY = "344780894+mivomad33@users.noreply.github.com";
/** 커밋 메시지의 Co-Authored-By에 쓰는 주소 */
const ALLOWED_EMAILS = [REPO_NOREPLY, "noreply@anthropic.com"];
/** 예시용 도메인(하위 도메인 포함) */
const ALLOWED_DOMAINS = ["example.com", "example.org", "example.net"];
/**
 * 메일 주소 모양이지만 파일 이름인 것(`icon@2x.png` 같은 글)의 끝. 이 끝이면 메일 주소로 보지 않는다.
 * 실제 최상위 도메인과 겹치지 않는 파일 확장자만 둔다.
 */
const FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "js", "mjs", "cjs", "css", "json", "ts", "tsx", "jsx", "map", "html", "wasm", "woff", "woff2"]);

export type FindingKind =
  | "커밋 이메일이 noreply 주소가 아니다"
  | "홈 폴더 절대 경로"
  | "GitHub 토큰 모양"
  | "Vercel 토큰 모양"
  | "개인 키 머리"
  | ".env 파일"
  | "SQLite 파일"
  | "실행 전 사본"
  | "허용 목록 밖 메일 주소"
  | "백업 파일 이름"
  | "실행 기록·작업 파일"
  | "읽지 못한 파일";

export interface Finding {
  /** 커밋과 파일, 또는 결과물 기준 경로 */
  where: string;
  kind: FindingKind;
  /** 글자 모양 검사에서 걸린 줄(앞 몇 개만) */
  lines?: number[];
}

/** 값을 가린 한 줄 설명 */
export function describeFinding(f: Finding): string {
  const at = f.lines && f.lines.length > 0 ? ` (줄 ${f.lines.join(", ")})` : "";
  return `${f.where}${at}: ${f.kind}`;
}

/** 설명 목록. 너무 많으면 앞부분만 */
export function describeFindings(findings: Finding[], limit = 50): string[] {
  const lines = findings.slice(0, limit).map(describeFinding);
  if (findings.length > limit) lines.push(`… 외 ${findings.length - limit}개`);
  return lines;
}

const SECRET_PATTERNS: { kind: FindingKind; re: RegExp }[] = [
  // GitHub 토큰: ghp_/gho_/ghu_/ghs_/ghr_ 뒤 영숫자, 세분화 토큰은 github_pat_ 뒤 영숫자와 밑줄
  { kind: "GitHub 토큰 모양", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  { kind: "GitHub 토큰 모양", re: /\bgithub_pat_[A-Za-z0-9_]{30,}/ },
  // Vercel 토큰(2026-02-09 Vercel 변경 기록 "New token formats and secret scanning"): vcp_(개인), vci_(연동), vca_(앱 접근), vcr_(앱 갱신), vck_(API 키)
  { kind: "Vercel 토큰 모양", re: /\b(?:vcp|vci|vca|vcr|vck)_[A-Za-z0-9]{20,}/ },
  { kind: "개인 키 머리", re: /-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-{5}/ },
];
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;

function emailAllowed(email: string, domain: string): boolean {
  const e = email.toLowerCase();
  const d = domain.toLowerCase();
  if (ALLOWED_EMAILS.includes(e)) return true;
  if (ALLOWED_DOMAINS.some((a) => d === a || d.endsWith(`.${a}`))) return true;
  return FILE_EXTENSIONS.has(d.slice(d.lastIndexOf(".") + 1));
}

/** 글 속 걸리는 모양(홈 경로, 비밀 값, 허용 목록 밖 메일). 종류마다 걸린 줄 번호(앞 5개) */
export function scanText(text: string, home: string | null): Map<FindingKind, number[]> {
  const hits = new Map<FindingKind, number[]>();
  const add = (kind: FindingKind, line: number) => {
    const list = hits.get(kind) ?? [];
    if (list.length < 5 && list.at(-1) !== line) list.push(line);
    hits.set(kind, list);
  };
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const n = i + 1;
    if (home !== null && l.includes(home)) add("홈 폴더 절대 경로", n);
    for (const p of SECRET_PATTERNS) if (p.re.test(l)) add(p.kind, n);
    if (l.includes("@")) {
      for (const m of l.matchAll(EMAIL_RE)) {
        if (!emailAllowed(m[0], m[1]!)) {
          add("허용 목록 밖 메일 주소", n);
          break;
        }
      }
    }
  });
  return hits;
}

/** 홈 폴더 값. 너무 짧은 값(`/` 등)은 모든 경로에 걸리므로 쓰지 않는다 */
export function homeValue(home: string | undefined): string | null {
  if (home === undefined) return null;
  const h = home.replace(/\/+$/, "");
  return h.length >= 2 ? h : null;
}

const SQLITE_HEADER = Buffer.from("SQLite format 3\0", "latin1");

export function isSqlite(content: Buffer): boolean {
  return content.length >= SQLITE_HEADER.length && content.subarray(0, SQLITE_HEADER.length).equals(SQLITE_HEADER);
}

/** git grep -I처럼 앞부분에 NUL 바이트가 있으면 바이너리로 본다 */
export function isBinary(content: Buffer): boolean {
  return content.subarray(0, 8000).includes(0);
}

/** 이름으로 찾는 것: SQLite 파일, 실행 전 사본, .env 파일 */
export function nameKinds(file: string): FindingKind[] {
  const base = path.posix.basename(file.replaceAll("\\", "/"));
  const kinds: FindingKind[] = [];
  if (SNAPSHOT_NAME_RE.test(base)) kinds.push("실행 전 사본");
  else if (/\.(?:db|db-journal|db-wal|db-shm|sqlite|sqlite3)$/i.test(base)) kinds.push("SQLite 파일");
  if (/^\.env(?:\..+)?$/i.test(base)) kinds.push(".env 파일");
  return kinds;
}

/** 내용으로 찾는 것: SQLite 머리(이름으로 이미 걸리면 빼고), 텍스트 파일의 글자 모양. textScan이 false면 글자 모양 검사를 하지 않는다 */
export function contentFindings(where: string, name: string, content: Buffer, home: string | null, textScan = true): Finding[] {
  if (isSqlite(content)) return nameKinds(name).some((k) => k === "SQLite 파일" || k === "실행 전 사본") ? [] : [{ where, kind: "SQLite 파일" }];
  if (!textScan || isBinary(content)) return [];
  return [...scanText(content.toString("utf8"), home)].map(([kind, lines]) => ({ where, kind, lines }));
}

/** 파일 하나(이름과 내용)의 모든 검사 */
export function fileFindings(where: string, name: string, content: Buffer, home: string | null, textScan = true): Finding[] {
  return [...nameKinds(name).map((kind): Finding => ({ where, kind })), ...contentFindings(where, name, content, home, textScan)];
}

// ---- git 저장소 검사 ----

/** 로컬 브랜치 전체(refs/heads/*) */
export function localBranches(repo: string): string[] {
  return git(repo, ["for-each-ref", "--format=%(refname)", "refs/heads"])
    .split("\n")
    .filter((l) => l.length > 0);
}

/** 참조들의 이력 전체 커밋 */
export function commitsOfRefs(repo: string, refs: string[]): string[] {
  if (refs.length === 0) return [];
  return git(repo, ["rev-list", ...refs, "--"])
    .split("\n")
    .filter((l) => l.length > 0);
}

/** tip에는 있고 exclude에는 없는 커밋(exclude가 null이면 tip의 이력 전체) */
export function commitsAhead(repo: string, tip: string, exclude: string | null): string[] {
  const args = exclude === null ? ["rev-list", tip, "--"] : ["rev-list", tip, "--not", exclude, "--"];
  return git(repo, args)
    .split("\n")
    .filter((l) => l.length > 0);
}

interface CommitMeta {
  sha: string;
  authorEmail: string;
  committerEmail: string;
  message: string;
}

function commitMetas(repo: string, commits: string[]): CommitMeta[] {
  if (commits.length === 0) return [];
  const out = git(repo, ["log", "--no-walk=unsorted", "--stdin", "--format=%H%x1f%ae%x1f%ce%x1f%B%x1e"], { input: commits.join("\n") + "\n" });
  return out
    .split("\x1e")
    .map((r) => r.replace(/^\n/, ""))
    .filter((r) => r.length > 0)
    .map((r) => {
      const [sha, authorEmail, committerEmail, ...rest] = r.split("\x1f");
      return { sha: sha!, authorEmail: authorEmail!, committerEmail: committerEmail!, message: rest.join("\x1f") };
    });
}

/** `<mode> <type> <sha>\t<path>` 목록(-z) */
function treeEntries(repo: string, commit: string): { sha: string; path: string }[] {
  const out = git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const entries: { sha: string; path: string }[] = [];
  for (const rec of out.split("\0")) {
    if (rec.length === 0) continue;
    const tab = rec.indexOf("\t");
    const [, type, sha] = rec.slice(0, tab).split(" ");
    if (type === "blob") entries.push({ sha: sha!, path: rec.slice(tab + 1) });
  }
  return entries;
}

/** 블롭 내용을 한꺼번에 읽는다(git cat-file --batch) */
function readBlobs(repo: string, shas: string[]): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (let i = 0; i < shas.length; i += 500) {
    const batch = shas.slice(i, i + 500);
    const buf = gitBuffer(repo, ["cat-file", "--batch"], { input: batch.join("\n") + "\n" });
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      const header = buf.subarray(pos, nl).toString("latin1");
      const [sha, type, size] = header.split(" ");
      pos = nl + 1;
      if (type === "missing" || size === undefined) continue;
      const n = Number(size);
      out.set(sha!, buf.subarray(pos, pos + n));
      pos += n + 1;
    }
  }
  return out;
}

export interface PrecheckInput {
  repo: string;
  /** 검사할 커밋(작성자·커미터 이메일, 메시지, 트리의 모든 파일) */
  commits: string[];
  /** git이 추적하는 지금 파일(index와 작업 트리)도 검사할지 */
  trackedFiles: boolean;
  /** 실행하는 사람의 홈 폴더 값. null이면 홈 경로 검사를 하지 않는다 */
  home: string | null;
  noreply?: string;
}

export interface PrecheckResult {
  findings: Finding[];
  commits: number;
  blobs: number;
  files: number;
}

/** 공개 전 점검(4.7-3) */
export function precheck(input: PrecheckInput): PrecheckResult {
  const { repo, home } = input;
  const noreply = (input.noreply ?? REPO_NOREPLY).toLowerCase();
  const findings: Finding[] = [];
  const seen = new Set<string>();
  const push = (f: Finding) => {
    const key = `${f.where}\0${f.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(f);
  };

  // 커밋 이메일과 메시지
  for (const c of commitMetas(repo, input.commits)) {
    const short = c.sha.slice(0, 7);
    if (c.authorEmail.toLowerCase() !== noreply) push({ where: `커밋 ${short} 작성자`, kind: "커밋 이메일이 noreply 주소가 아니다" });
    if (c.committerEmail.toLowerCase() !== noreply) push({ where: `커밋 ${short} 커미터`, kind: "커밋 이메일이 noreply 주소가 아니다" });
    for (const [kind, lines] of scanText(c.message, home)) push({ where: `커밋 ${short} 메시지`, kind, lines });
  }

  // 커밋 트리의 파일: 이름은 경로마다, 내용은 블롭마다 한 번
  const blobWhere = new Map<string, { commit: string; path: string }>();
  const pathSeen = new Set<string>();
  for (const commit of input.commits) {
    const short = commit.slice(0, 7);
    for (const e of treeEntries(repo, commit)) {
      if (!pathSeen.has(e.path)) {
        pathSeen.add(e.path);
        for (const kind of nameKinds(e.path)) push({ where: `커밋 ${short} ${e.path}`, kind });
      }
      if (!blobWhere.has(e.sha)) blobWhere.set(e.sha, { commit: short, path: e.path });
    }
  }

  // 지금 파일: index의 블롭과 작업 트리의 파일
  const tracked: { sha: string; path: string }[] = [];
  if (input.trackedFiles) {
    for (const rec of git(repo, ["ls-files", "-s", "-z"]).split("\0")) {
      if (rec.length === 0) continue;
      const tab = rec.indexOf("\t");
      const [mode, sha] = rec.slice(0, tab).split(" ");
      if (mode === "160000") continue; // 하위 모듈
      tracked.push({ sha: sha!, path: rec.slice(tab + 1) });
    }
  }

  const blobs = readBlobs(repo, [...new Set([...blobWhere.keys(), ...tracked.map((t) => t.sha)])]);
  for (const [sha, w] of blobWhere) {
    const content = blobs.get(sha);
    const where = `커밋 ${w.commit} ${w.path}`;
    if (content === undefined) push({ where, kind: "읽지 못한 파일" });
    else for (const f of contentFindings(where, w.path, content, home)) push(f);
  }
  for (const t of tracked) {
    const where = `지금 파일 ${t.path}`;
    const indexContent = blobs.get(t.sha);
    if (indexContent !== undefined) for (const f of fileFindings(where, t.path, indexContent, home)) push(f);
    const file = path.join(repo, t.path);
    const stat = fs.lstatSync(file, { throwIfNoEntry: false }); // 작업 트리에서 지운 파일이면 없다
    if (stat?.isFile()) for (const f of fileFindings(where, t.path, fs.readFileSync(file), home)) push(f);
  }
  return { findings, commits: input.commits.length, blobs: blobWhere.size, files: tracked.length };
}
