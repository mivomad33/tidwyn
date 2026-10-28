import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openExistingDb } from "./db.ts";
import { gitTry } from "./git.ts";
import { allIssues } from "./issues.ts";
import { commitsAhead, describeFindings, precheck } from "./precheck.ts";
import type { DeployResult, PostDeployCheck, PushResult, SiteResult } from "./run.ts";
import { checkOutput } from "./siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "./siteData.ts";
import { storedDates } from "./store.ts";

// 사이트 빌드(3단계 4.1), 배포와 배포 뒤 점검(4.6), data 브랜치 push(4.5-1).
// 바깥 도구(사이트 빌더, vercel, HTTP, 원격 git)는 함수로 받아 테스트가 가짜로 바꿀 수 있게 한다.

/** 결과물을 둘 곳(데이터 폴더 아래, 실제 데이터 폴더는 git이 무시한다) */
export const SITE_OUT_DIR = "site";
/** 빌더에 넘길 사이트 데이터와 검색 레코드를 두는 곳(실행마다 새로 만든다) */
export const SITE_INPUT_DIR = "site-input";
export const SEARCH_RECORDS_FILE = "search-records.json";

export const PRODUCTION_URL = "https://tidwyn.vercel.app";
export const VERCEL_SCOPE = "mivomad33";
export const VERCEL_PROJECT = "tidwyn";
/** Vercel 무료 한도(100MB, 15,000개)에 가깝다고 알리는 문턱 */
export const WARN_BYTES = 80_000_000;
export const WARN_FILES = 12_000;

export type StepOk = { ok: true } | { ok: false; message: string };

/** 사이트 빌더: inputDir의 사이트 데이터와 검색 레코드로 outDir을 비우고 채운다 */
export type SiteBuilder = (a: { repoDir: string; inputDir: string; outDir: string }) => StepOk;
export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}
/** vercel CLI 실행(인자만 받는다. 토큰은 넘기지 않는다) */
export type VercelRunner = (args: string[], repoDir: string) => ProcessResult;
export interface HttpResponse {
  status: number;
  contentType: string;
  body: string;
}
export type HttpGet = (url: string) => Promise<HttpResponse>;
/** 원격 저장소 작업. 실패하면 예외 대신 ok: false */
export interface RemoteGit {
  /** origin의 data 브랜치 커밋. 원격 브랜치가 없으면 null */
  remoteDataHead(repo: string): { ok: true; head: string | null } | { ok: false; message: string };
  /** origin의 data를 refs/remotes/origin/data로 받는다 */
  fetchData(repo: string): StepOk;
  /** 로컬 data를 origin의 data로 push한다(강제 push 아님) */
  pushData(repo: string): StepOk;
}

function tail(text: string, n = 10): string {
  return text.trim().split("\n").slice(-n).join("\n");
}

export const nodeSiteBuilder: SiteBuilder = ({ repoDir, inputDir, outDir }) => {
  const script = path.join(repoDir, "site", "build.ts");
  if (!fs.existsSync(script)) return { ok: false, message: `사이트 빌더가 없다: ${script}` };
  const r = spawnSync(process.execPath, [script, "--data", inputDir, "--out", outDir], { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  if (r.status === 0) return { ok: true };
  return { ok: false, message: `사이트 빌더가 실패했다(종료 코드 ${r.status ?? "없음"}):\n${tail(r.error?.message ?? `${r.stdout}\n${r.stderr}`)}` };
};

export const cliVercel: VercelRunner = (args, repoDir) => {
  const bin = path.join(repoDir, "node_modules", ".bin", "vercel");
  if (!fs.existsSync(bin)) return { status: null, stdout: "", stderr: "", error: `vercel CLI가 없다: ${bin} (pnpm install)` };
  const r = spawnSync(bin, args, { cwd: repoDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const out: ProcessResult = { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  if (r.error) out.error = r.error.message;
  return out;
};

export const fetchGet: HttpGet = async (url) => {
  const res = await fetch(url, { headers: { "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", body: await res.text() };
};

/** 원격 작업이 비밀번호를 묻고 멈추지 않게 한다 */
const REMOTE_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function runGit(repo: string, args: string[]): { ok: true; out: string } | { ok: false; message: string } {
  const r = spawnSync("git", args, { cwd: repo, env: REMOTE_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5 * 60 * 1000 });
  if (r.status === 0) return { ok: true, out: r.stdout };
  return { ok: false, message: tail(r.error?.message ?? `${r.stdout}\n${r.stderr}`, 5) || `git ${args[0]} 실패` };
}

export const gitRemote: RemoteGit = {
  remoteDataHead(repo) {
    const r = runGit(repo, ["ls-remote", "--heads", "origin", "refs/heads/data"]);
    if (!r.ok) return r;
    const line = r.out.split("\n").find((l) => l.endsWith("\trefs/heads/data"));
    return { ok: true, head: line === undefined ? null : line.split("\t")[0]! };
  },
  fetchData(repo) {
    const r = runGit(repo, ["fetch", "--no-tags", "origin", "+refs/heads/data:refs/remotes/origin/data"]);
    return r.ok ? { ok: true } : r;
  },
  pushData(repo) {
    const r = runGit(repo, ["push", "--no-verify", "origin", "refs/heads/data:refs/heads/data"]);
    return r.ok ? { ok: true } : r;
  },
};

// ---- 빌드 ----

export interface BuildInput {
  repoDir: string;
  dataDir: string;
  dbPath: string;
  home: string | null;
  builder: SiteBuilder;
}

/** DB → 사이트 데이터·검색 레코드(site-input/) → 빌더(site/) → 결과물 검사 */
export function buildSite(input: BuildInput): SiteResult {
  const outDir = path.join(input.dataDir, SITE_OUT_DIR);
  const inputDir = path.join(input.dataDir, SITE_INPUT_DIR);
  if (!fs.existsSync(input.dbPath)) return { status: "failed", outDir, reason: `DB가 없다: ${input.dbPath}` };
  let dates: number;
  let issues: number;
  try {
    const db = openExistingDb(input.dbPath);
    try {
      const files = buildSiteData(db);
      const records = buildSearchRecords(db);
      dates = storedDates(db).length;
      issues = allIssues(db).filter((i) => i.mergedInto === null).length;
      fs.rmSync(inputDir, { recursive: true, force: true });
      for (const [rel, content] of files) {
        const file = path.join(inputDir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
      }
      fs.writeFileSync(path.join(inputDir, SEARCH_RECORDS_FILE), JSON.stringify(records));
    } finally {
      db.close();
    }
  } catch (e) {
    return { status: "failed", outDir, reason: `사이트 데이터를 만들지 못했다: ${(e as Error).message}` };
  }
  let built: StepOk;
  try {
    built = input.builder({ repoDir: input.repoDir, inputDir, outDir });
  } catch (e) {
    built = { ok: false, message: (e as Error).message };
  }
  if (!built.ok) return { status: "failed", outDir, reason: built.message };
  if (!fs.existsSync(outDir)) return { status: "failed", outDir, reason: `빌더가 결과물 폴더를 만들지 않았다: ${outDir}` };
  const check = checkOutput(outDir, input.home);
  if (check.findings.length > 0) {
    return { status: "failed", outDir, reason: `결과물 검사에 걸렸다(${check.findings.length}건)`, findings: describeFindings(check.findings) };
  }
  return { status: "built", outDir, dates, issues, files: check.files, bytes: check.bytes };
}

// ---- 배포 ----

export interface DeployInput {
  repoDir: string;
  outDir: string;
  dbPath: string;
  home: string | null;
  vercel: VercelRunner;
  httpGet: HttpGet;
  /** 배포 뒤 점검의 재시도(운영 주소가 새 배포로 바뀌는 데 몇 초 걸린다). 없으면 6번, 5초 간격 */
  retry?: CheckRetry;
}

export interface CheckRetry {
  attempts: number;
  sleep: () => Promise<void>;
}

export const DEFAULT_CHECK_RETRY: CheckRetry = { attempts: 6, sleep: () => new Promise((r) => setTimeout(r, 5000)) };

/** vercel에 넘기는 인자. 결과물 폴더만 프로젝트 tidwyn에 운영 배포한다(--create-if-missing 없음, 토큰 없음) */
export function vercelDeployArgs(outDir: string): string[] {
  return ["deploy", outDir, "--scope", VERCEL_SCOPE, "--project", VERCEL_PROJECT, "--prod", "--yes"];
}

function latestStoredDate(dbPath: string): string | null {
  const db = openExistingDb(dbPath);
  try {
    return storedDates(db).at(-1) ?? null;
  } finally {
    db.close();
  }
}

/**
 * 배포 뒤 점검(4.6-3): 운영 주소의 첫 화면(200, HTML)과 dates.json의 최근 날짜가 DB의 최근 저장일과 같은지.
 * vercel deploy가 끝난 직후에는 운영 주소가 아직 이전 배포를 가리킬 수 있어서, 통과할 때까지 정해진 횟수만큼 다시 본다.
 */
export async function postDeployCheck(httpGet: HttpGet, expected: string | null, retry: CheckRetry = { attempts: 1, sleep: async () => {} }): Promise<PostDeployCheck> {
  let last: PostDeployCheck = { status: "failed", reason: "점검하지 않았다" };
  for (let i = 1; i <= retry.attempts; i++) {
    last = await checkOnce(httpGet, expected);
    if (last.status === "passed") return last;
    if (i < retry.attempts) await retry.sleep();
  }
  if (retry.attempts > 1 && last.status === "failed") last = { status: "failed", reason: `${last.reason} (${retry.attempts}번 확인)` };
  return last;
}

async function checkOnce(httpGet: HttpGet, expected: string | null): Promise<PostDeployCheck> {
  const home = `${PRODUCTION_URL}/`;
  const datesUrl = `${PRODUCTION_URL}/site-data/dates.json`;
  try {
    const r = await httpGet(home);
    if (r.status !== 200) return { status: "failed", reason: `첫 화면이 ${r.status}이다(${home})` };
    if (!/text\/html/i.test(r.contentType)) return { status: "failed", reason: `첫 화면이 HTML이 아니다(${r.contentType || "형식 없음"})` };
  } catch (e) {
    return { status: "failed", reason: `첫 화면을 받지 못했다: ${(e as Error).message}` };
  }
  let latest: unknown;
  try {
    const r = await httpGet(datesUrl);
    if (r.status !== 200) return { status: "failed", reason: `사이트 데이터(dates.json)가 ${r.status}이다` };
    latest = (JSON.parse(r.body) as { latestDate?: unknown }).latestDate;
  } catch (e) {
    return { status: "failed", reason: `사이트 데이터(dates.json)를 받지 못했다: ${(e as Error).message}` };
  }
  if (latest !== expected) return { status: "failed", reason: `운영 사이트의 최근 날짜(${String(latest)})가 DB의 최근 저장일(${String(expected)})과 다르다` };
  return { status: "passed", latestDate: expected };
}

/** 결과물 검사 → vercel 운영 배포 → 배포 뒤 점검. 자동으로 되돌리지 않는다 */
export async function deployOutput(input: DeployInput): Promise<DeployResult> {
  if (!fs.existsSync(input.outDir) || !fs.statSync(input.outDir).isDirectory()) return { status: "failed", reason: `결과물 폴더가 없다: ${input.outDir}` };
  if (!fs.existsSync(input.dbPath)) return { status: "failed", reason: `DB가 없다: ${input.dbPath}` };
  const check = checkOutput(input.outDir, input.home);
  if (check.findings.length > 0) {
    return { status: "failed", reason: `결과물 검사에 걸려 올리지 않았다(${check.findings.length}건)`, findings: describeFindings(check.findings) };
  }
  const r = input.vercel(vercelDeployArgs(input.outDir), input.repoDir);
  if (r.status !== 0) {
    return { status: "failed", reason: `vercel deploy가 실패했다(종료 코드 ${r.status ?? "없음"}): ${tail(r.error ?? `${r.stdout}\n${r.stderr}`, 8)}` };
  }
  const deploymentUrl = [...`${r.stdout}\n${r.stderr}`.matchAll(/https:\/\/[^\s"']+\.vercel\.app\b/g)].map((m) => m[0]).find((u) => u !== PRODUCTION_URL) ?? null;
  const check2 = await postDeployCheck(input.httpGet, latestStoredDate(input.dbPath), input.retry ?? DEFAULT_CHECK_RETRY);
  return { status: "deployed", url: PRODUCTION_URL, deploymentUrl, check: check2 };
}

// ---- push ----

export interface PushInput {
  repo: string;
  home: string | null;
  remote: RemoteGit;
}

/** 원격보다 앞선 data 커밋에 공개 전 점검을 하고, 통과하면 push한다(강제 push 아님) */
export function pushDataBranch(input: PushInput): PushResult {
  const { repo, remote } = input;
  if (gitTry(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/data^{commit}"]) === null) return { status: "skipped", reason: "data 브랜치가 없다" };
  if (gitTry(repo, ["remote", "get-url", "origin"]) === null) return { status: "failed", reason: "원격 저장소(origin)가 없다" };
  const head = remote.remoteDataHead(repo);
  if (!head.ok) return { status: "failed", reason: `원격을 읽지 못했다: ${head.message}` };
  let exclude: string | null = null;
  if (head.head !== null) {
    const f = remote.fetchData(repo);
    if (!f.ok) return { status: "failed", reason: `원격 data를 받지 못했다: ${f.message}` };
    exclude = "refs/remotes/origin/data";
  }
  let commits: string[];
  try {
    commits = commitsAhead(repo, "refs/heads/data", exclude);
  } catch (e) {
    return { status: "failed", reason: `push할 커밋을 계산하지 못했다: ${(e as Error).message}` };
  }
  if (commits.length === 0) return { status: "upToDate" };
  const pc = precheck({ repo, commits, trackedFiles: false, home: input.home });
  if (pc.findings.length > 0) {
    return { status: "failed", reason: `공개 전 점검에 걸려 push하지 않았다(커밋 ${commits.length}개, ${pc.findings.length}건)`, findings: describeFindings(pc.findings) };
  }
  const p = remote.pushData(repo);
  if (!p.ok) return { status: "failed", reason: `push하지 못했다: ${p.message}` };
  return { status: "pushed", commits: commits.length };
}

/** 바이트를 MB(1,000,000바이트)로 */
export function formatMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)}MB`;
}
