import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { decodeXmlText, tag, type FetchText } from "./feeds.ts";
import { kstIso } from "./kst.ts";
import { ADDRESS_RE, EMAIL_RE, scanText } from "./precheck.ts";
import { longQuotes } from "./quotes.ts";
import { WORK_DIR } from "./run.ts";
import type { DayRepoItem, DayRepos } from "./siteTypes.ts";
import { storedDates } from "./store.ts";
import { Checker, type Violation } from "./validate.ts";

// B1단계: GitHub 주간 트렌딩 RSS에서 새로 오른 저장소를 골라 브리프 날짜에 싣는다(명세서 4.1~4.3).
// 피드 응답(README, 한 줄 설명)은 데이터로만 다루고 로컬 작업 파일(후보 파일)에만 둔다. 백업·사이트에는 이름, 주소, 순위, Claude가 쓴 설명만 간다.

export const TREND_FEED_URL = "https://mshibanami.github.io/GitHubTrendingRSS/weekly/all.xml";
/** 채널 pubDate가 받은 시각보다 이만큼 넘게 오래되면 받지 못함으로 본다(정확히 3일은 통과) */
export const FEED_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
/** 하루에 싣는 최대 수(G4) */
export const MAX_REPOS = 5;
/** 설명 길이(G5) */
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 400;
/** 후보 파일의 README 길이(정리한 뒤 자른다) */
export const README_MAX = 3000;
/** 재료와 이만큼 연속으로 같은 낱말이면 그대로 옮긴 것으로 본다(D6) */
export const COPY_WORDS = 15;

const REPO_CANDIDATES_FILE = "repo-candidates.json";
const REPO_ITEMS_FILE = "repo-items.json";

export function repoWorkFile(dataDir: string, kind: "candidates" | "items"): string {
  return path.join(dataDir, WORK_DIR, kind === "candidates" ? REPO_CANDIDATES_FILE : REPO_ITEMS_FILE);
}

export type RepoDayStatus = DayRepos["status"];

/** 상태 이름(출력용) */
export const REPO_STATUS_LABEL: Record<RepoDayStatus, string> = { shown: "실음", none: "새로 오른 것 없음", failed: "받지 못함" };

export type RepoItem = DayRepoItem;

export interface RepoDay {
  date: string;
  status: RepoDayStatus;
  /** 순위 순 */
  items: RepoItem[];
}

// ---- 피드 읽기 ----

export interface TrendFeed {
  updatedAt: Date;
  items: { link: string; html: string }[];
}

export class FeedFormatError extends Error {}

/** 주간 트렌딩 RSS를 읽는다. 항목에는 pubDate가 없고 시각은 채널 pubDate뿐이다(2.2). 형식이 틀리면 FeedFormatError */
export function parseTrendFeed(xml: string): TrendFeed {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new FeedFormatError("RSS 형식이 아니다");
  const first = xml.search(/<item[\s>]/i);
  const head = first === -1 ? xml : xml.slice(0, first);
  const pub = tag(head, "pubDate");
  if (pub === undefined) throw new FeedFormatError("채널 pubDate가 없다");
  const t = Date.parse(pub);
  if (Number.isNaN(t)) throw new FeedFormatError("채널 pubDate를 읽을 수 없다");
  const items: TrendFeed["items"] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const body = m[1]!;
    items.push({ link: tag(body, "link") ?? "", html: tag(body, "description") ?? "" });
  }
  return { updatedAt: new Date(t), items };
}

const REPO_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/?$/;

/** `https://github.com/<owner>/<name>` 모양이면 표시 이름(경로의 owner/name)과 주소. 아니면 null */
export function repoOfLink(link: string): { name: string; url: string } | null {
  const m = REPO_URL_RE.exec(link.trim());
  if (!m || m[2] === "." || m[2] === "..") return null;
  const name = `${m[1]}/${m[2]}`;
  return { name, url: `https://github.com/${name}` };
}

export function repoKey(name: string): string {
  return name.toLowerCase();
}

// ---- 재료 정리(G6, 4.1-2) ----

const NO_DESCRIPTION = "No description/README provided.";
/** 설명 문단 + (홈페이지 링크 문단) + <hr> 로 시작하는 경우(2.2의 첫 경우) */
const LEADING_SUMMARY_RE = /^\s*<p>((?:(?!<\/?p\b)[\s\S])*?)<\/p>\s*(?:<p>\s*<img\b[^>]*>\s*<a\b[^>]*>[\s\S]*?<\/a>\s*<\/p>\s*)?<hr\s*\/?>/i;
/** 설명 없이 홈페이지 링크 문단으로 시작하는 경우(2.2의 둘째 경우) */
const LEADING_HOMEPAGE_RE = /^\s*<p>\s*<img\b[^>]*>\s*<a\b[^>]*>[\s\S]*?<\/a>\s*<\/p>\s*(?:<hr\s*\/?>)?/i;

// 제어 문자(줄바꿈 빼고)와 유니코드 서식 문자(Cf: 너비 없는 글자, 방향 바꾸기 등)
const CONTROL_RE = /(?!\n)\p{Cc}/gu;
const FORMAT_RE = /\p{Cf}/gu;
const PUNCT_ONLY_RE = /^[\s\p{P}\p{S}]*$/u;
const BLOCK_TAG_RE = /<\/?(?:p|div|h[1-6]|ul|ol|tr|table|thead|tbody|tfoot|pre|blockquote|hr|br|details|summary|section|article|header|footer|nav|dl|dt|dd|figure|figcaption|center|picture)\b[^>]*>/gi;

function dropComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/<!--[\s\S]*$/, "");
}

function cleanChars(text: string): string {
  return text.replace(/\t/g, " ").replace(CONTROL_RE, "").replace(FORMAT_RE, "");
}

/** HTML 링크·이미지만 있는 줄(배지 줄, 링크 모음 줄) */
function htmlLinkOnly(line: string): boolean {
  if (!/<a\b|<img\b/i.test(line)) return false;
  const rest = decodeXmlText(line.replace(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi, "").replace(/<[^>]*>/g, ""));
  return PUNCT_ONLY_RE.test(rest);
}

/** 글로 남은 마크다운 이미지·링크·주소만 있는 줄 */
function textLinkOnly(line: string): boolean {
  const rest = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "");
  return rest !== line && PUNCT_ONLY_RE.test(rest);
}

/** README HTML을 글로 정리한다: 주석·태그·이미지·배지·링크만 있는 줄·제어 문자·서식 문자를 없애고, `#` 머리를 떼고, 빈 줄을 줄이고, 앞부분만 자른다 */
export function cleanReadme(html: string, max = README_MAX): string {
  let t = dropComments(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "");
  t = t.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li\s*>/gi, "\n").replace(BLOCK_TAG_RE, "\n");
  const lines: string[] = [];
  for (const raw of t.split(/\r?\n/)) {
    if (htmlLinkOnly(raw)) continue;
    let line = raw.replace(/<[^>]*>/g, " ").replace(/<[a-zA-Z/!][^>]*$/, " ");
    line = dropComments(decodeXmlText(line));
    line = cleanChars(line).replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    if (textLinkOnly(line)) continue;
    line = line.replace(/\s+/g, " ").trim().replace(/^#+\s*/, "");
    lines.push(PUNCT_ONLY_RE.test(line) ? "" : line);
  }
  // 연속 빈 줄은 하나로 줄인다
  const kept: string[] = [];
  for (const l of lines) if (l !== "" || (kept.length > 0 && kept.at(-1) !== "")) kept.push(l);
  const text = kept.join("\n").trim();
  return Array.from(text).slice(0, max).join("").trim();
}

function cleanInline(html: string): string {
  return cleanChars(decodeXmlText(dropComments(html).replace(/<[^>]*>/g, " "))).replace(/\s+/g, " ").trim();
}

/** 항목 description을 한 줄 설명과 정리한 README로 나눈다(2.2의 네 경우). 한 줄 설명은 `<hr>` 앞의 첫 `<p>`일 때만 쓴다 */
export function splitDescription(html: string): { summary: string; readme: string } {
  if (cleanInline(html) === NO_DESCRIPTION) return { summary: "", readme: "" };
  const lead = LEADING_SUMMARY_RE.exec(html);
  if (lead && !/<img\b[^>]*\/icons\/link\.png/i.test(lead[1]!)) return { summary: cleanInline(lead[1]!), readme: cleanReadme(html.slice(lead[0].length)) };
  const home = LEADING_HOMEPAGE_RE.exec(html);
  if (home) return { summary: "", readme: cleanReadme(html.slice(home[0].length)) };
  return { summary: "", readme: cleanReadme(html) };
}

// ---- DB ----

export function repoDayStatus(db: DatabaseSync, date: string): RepoDayStatus | null {
  const row = db.prepare("SELECT status FROM trend_repo_days WHERE date = ?").get(date) as { status: RepoDayStatus } | undefined;
  return row?.status ?? null;
}

/** 이미 실린 저장소 키(모든 날짜, G3) */
export function shownRepoKeys(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT key FROM trend_repos").all() as { key: string }[]).map((r) => r.key));
}

export function allRepoDays(db: DatabaseSync): RepoDay[] {
  const rows = db
    .prepare("SELECT d.date, d.status, r.rank, r.name, r.url, r.description FROM trend_repo_days d LEFT JOIN trend_repos r ON r.date = d.date ORDER BY d.date, r.rank")
    .all() as unknown as ({ date: string; status: RepoDayStatus } & ({ rank: number; name: string; url: string; description: string } | { rank: null }))[];
  const days: RepoDay[] = [];
  for (const r of rows) {
    let day = days.at(-1);
    if (day?.date !== r.date) days.push((day = { date: r.date, status: r.status, items: [] }));
    if (r.rank !== null) day.items.push({ rank: r.rank, name: r.name, url: r.url, description: r.description });
  }
  return days;
}

function insertRepoItems(db: DatabaseSync, date: string, items: readonly RepoItem[]): void {
  const ins = db.prepare("INSERT INTO trend_repos (date, rank, key, name, url, description) VALUES (?, ?, ?, ?, ?, ?)");
  for (const i of items) ins.run(date, i.rank, repoKey(i.name), i.name, i.url, i.description);
}

/** 그 날짜의 기록을 한 트랜잭션으로 쓴다. 이미 '실음'이나 '새로 오른 것 없음'이면 쓰지 않고 false */
export function saveRepoDay(db: DatabaseSync, date: string, status: RepoDayStatus, items: RepoItem[]): boolean {
  db.exec("BEGIN");
  try {
    const now = repoDayStatus(db, date);
    if (now === "shown" || now === "none") {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("INSERT INTO trend_repo_days (date, status) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET status = excluded.status").run(date, status);
    insertRepoItems(db, date, items);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 대상 날짜(G9): 가장 늦은 저장된 브리프 날짜 */
export function repoTargetDate(db: DatabaseSync): string | null {
  return storedDates(db).at(-1) ?? null;
}

// ---- 받기(4.1-1, 4.1-2) ----

export interface RepoCandidate {
  /** 후보 번호(1부터) */
  candidate: number;
  key: string;
  name: string;
  url: string;
  rank: number;
  /** 피드의 한 줄 설명. 없으면 빈 글 */
  summary: string;
  /** 정리한 README 앞부분. 없으면 빈 글 */
  readme: string;
}

export interface RepoCandidatesFile {
  date: string;
  fetchedAt: string;
  feedUpdatedAt: string;
  /** 피드 항목 수와 뺀 수 */
  counts: { feedItems: number; badUrl: number; alreadyShown: number; duplicate: number };
  candidates: RepoCandidate[];
}

export type RepoFetchOutcome = { ok: true; file: RepoCandidatesFile } | { ok: false; reason: string };

/** 피드를 한 번 받아 후보를 만든다. 실패는 이유와 함께 돌려준다(예외를 던지지 않는다) */
export async function fetchRepoCandidates(date: string, shown: Set<string>, fetch: FetchText, now: Date): Promise<RepoFetchOutcome> {
  let feed: TrendFeed;
  try {
    const res = await fetch(TREND_FEED_URL);
    if (res.status !== 200) return { ok: false, reason: `HTTP ${res.status}` };
    feed = parseTrendFeed(res.text);
  } catch (e) {
    const err = e as Error;
    return { ok: false, reason: err.name === "TimeoutError" ? "시간 초과" : err instanceof FeedFormatError ? err.message : `받기 오류: ${err.message}` };
  }
  if (feed.items.length === 0) return { ok: false, reason: "항목이 0개다" };
  if (now.getTime() - feed.updatedAt.getTime() > FEED_MAX_AGE_MS) return { ok: false, reason: `피드가 오래됐다(채널 pubDate ${kstIso(feed.updatedAt)}, 3일 넘게 지남)` };
  const counts = { feedItems: feed.items.length, badUrl: 0, alreadyShown: 0, duplicate: 0 };
  const seen = new Set<string>();
  const candidates: RepoCandidate[] = [];
  feed.items.forEach((item, i) => {
    const repo = repoOfLink(item.link);
    if (repo === null) return void counts.badUrl++;
    const key = repoKey(repo.name);
    if (shown.has(key)) return void counts.alreadyShown++;
    if (seen.has(key)) return void counts.duplicate++;
    seen.add(key);
    const { summary, readme } = splitDescription(item.html);
    candidates.push({ candidate: candidates.length + 1, key, name: repo.name, url: repo.url, rank: i + 1, summary, readme });
  });
  return { ok: true, file: { date, fetchedAt: kstIso(now), feedUpdatedAt: kstIso(feed.updatedAt), counts, candidates } };
}

export function readCandidatesFile(file: string): RepoCandidatesFile {
  return JSON.parse(fs.readFileSync(file, "utf8")) as RepoCandidatesFile;
}

// ---- 항목 파일 검사(4.2-2) ----

export interface RepoItemsCheck {
  violations: Violation[];
  items: RepoItem[];
  /** 지시가 보여 뺀 후보의 표시 이름(G17). 올바른 번호만 */
  excluded: string[];
}

/** 후보 값 칸: Claude가 쓰지 않고 후보 파일 값으로 저장한다 */
const CANDIDATE_VALUE_FIELDS = ["name", "url", "rank"];

function normalizeWord(w: string): string {
  return w.toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
}

function words(text: string): string[] {
  return text.split(/\s+/).map(normalizeWord).filter((w) => w.length > 0);
}

/** 재료와 공백 기준 연속 n낱말이 같은 구간이 있는지(대소문자, 낱말 앞뒤 문장부호 무시) */
export function copiesRun(text: string, sources: readonly string[], n = COPY_WORDS): boolean {
  const mine = words(text);
  if (mine.length < n) return false;
  const grams = new Set<string>();
  for (const s of sources) {
    const w = words(s);
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" "));
  }
  for (let i = 0; i + n <= mine.length; i++) if (grams.has(mine.slice(i, i + n).join(" "))) return true;
  return false;
}

/** 메일 주소 모양(공개 전 점검과 같은 규칙, g 없이) */
const EMAIL_SHAPE_RE = new RegExp(EMAIL_RE.source);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 후보 파일의 값이 받기 때 만든 모양(정규 주소, 주소에서 나온 이름·키, 1 이상 정수 순위, 글 재료)인지 본다 */
function candidateValuesValid(cand: RepoCandidate): boolean {
  const r = typeof cand.url === "string" ? repoOfLink(cand.url) : null;
  return (
    r !== null &&
    r.url === cand.url &&
    r.name === cand.name &&
    cand.key === repoKey(cand.name) &&
    Number.isInteger(cand.rank) &&
    cand.rank >= 1 &&
    typeof cand.summary === "string" &&
    typeof cand.readme === "string"
  );
}

/**
 * 주소 모양 검사. 그 후보의 이름(owner/name, owner, name)과 같은 낱말은 빼고 본다.
 * 낱말 전체가 같을 때만 뺀다(이름이 `app`일 때 `evil.app`의 `app`까지 지우면 주소가 검사를 빠져나간다).
 * 문장 끝 마침표와 `:`(`cal.com: …`)는 낱말 경계로 보고, 뒤에 `://`가 오면 빼지 않는다(이름이 `https`일 때 `https://`를 지우지 않게)
 */
function hasAddress(text: string, name: string): boolean {
  const [owner, repo] = name.split("/");
  let t = text;
  for (const part of [name, repo, owner]) if (part) t = t.replace(new RegExp(`(?<![A-Za-z0-9._/-])${escapeRe(part)}(?![A-Za-z0-9_/-]|:\\/\\/|\\.[A-Za-z0-9])`, "gi"), " ");
  return ADDRESS_RE.test(t);
}

/** 항목 파일을 검사한다. 위반에는 위치와 이유만 쓰고 글(설명, README)은 싣지 않는다 */
export function checkRepoItems(raw: unknown, cands: RepoCandidatesFile, shown: Set<string>, home: string | null, secrets: readonly string[] = []): RepoItemsCheck {
  const c = new Checker();
  const out: RepoItemsCheck = { violations: c.violations, items: [], excluded: [] };
  const o = c.obj(raw, "항목 파일");
  if (o === null) return out;
  c.keys(o, ["date", "items", "excluded"], "항목 파일");
  if (o.date !== cands.date) c.add("항목 파일 date", `대상 날짜 ${cands.date}와 같아야 한다`);
  const byNumber = new Map(cands.candidates.map((x) => [x.candidate, x]));
  const used = new Set<number>();
  const list = c.arr(o, "items", "items", "항목 파일");
  if (list.length > MAX_REPOS) c.add("항목 파일 items", `${list.length}개다(${MAX_REPOS}개 이하여야 한다)`);
  list.forEach((rawItem, i) => {
    const w = `항목 ${i + 1}`;
    const it = c.obj(rawItem, w);
    if (it === null) return;
    for (const f of CANDIDATE_VALUE_FIELDS) if (f in it) c.add(w, `후보 값 칸 "${f}"을(를) 쓰면 안 된다(이름, 주소, 순위는 후보 파일 값으로 저장한다)`);
    c.keys(it, ["candidate", "description", ...CANDIDATE_VALUE_FIELDS], w);
    const n = it.candidate;
    let cand: RepoCandidate | undefined;
    if (typeof n !== "number" || !Number.isInteger(n)) c.add(`${w} candidate`, "후보 번호(정수)여야 한다");
    else if ((cand = byNumber.get(n)) === undefined) c.add(`${w} candidate`, `후보 ${n}은(는) 후보 파일에 없다`);
    else if (used.has(n)) c.add(`${w} candidate`, `후보 ${n}이(가) 두 번 나온다`);
    else if (shown.has(cand.key)) c.add(`${w} candidate`, `후보 ${n}은(는) 이미 실린 저장소다`);
    // 후보 파일의 이름·주소·순위는 그대로 저장·공개되므로 받기 때와 같은 모양인지 다시 본다(후보 파일이 바뀐 경우)
    else if (!candidateValuesValid(cand)) c.add(`${w} candidate`, `후보 ${n}의 이름·주소·순위가 받은 값의 모양이 아니다(후보 파일을 고치지 않는다)`);
    // 모양이 틀린 후보 값으로는 뒤 검사(이름 빼기, 재료 대조)를 하지 않는다(타입이 틀리면 예외로 실행이 멈춘다)
    if (cand && !candidateValuesValid(cand)) cand = undefined;
    if (typeof n === "number") used.add(n);
    const where = cand ? `${w}(후보 ${cand.candidate})` : w;
    const d = typeof it.description === "string" ? it.description.trim() : "";
    if (d === "") {
      c.add(`${where} description`, "비어 있으면 안 된다");
      return;
    }
    const len = Array.from(d).length;
    if (len < DESCRIPTION_MIN || len > DESCRIPTION_MAX) c.add(`${where} description`, `${len}자다(${DESCRIPTION_MIN}~${DESCRIPTION_MAX}자여야 한다)`);
    if (cand && hasAddress(d, cand.name)) c.add(`${where} description`, "주소 모양을 쓰면 안 된다");
    if (EMAIL_SHAPE_RE.test(d)) c.add(`${where} description`, "메일 주소 모양을 쓰면 안 된다");
    for (const q of longQuotes(d)) c.add(`${where} description`, `따옴표 안 인용이 ${q.words}단어다(15단어 미만이어야 한다, D6)`);
    if (cand && copiesRun(d, [cand.summary, cand.readme])) c.add(`${where} description`, `재료와 연속 ${COPY_WORDS}낱말 이상이 같다(바꿔 써야 한다, D6)`);
    for (const kind of scanText(d, home, secrets).keys()) c.add(`${where} description`, `공개할 수 없는 글: ${kind}`);
    if (cand) out.items.push({ rank: cand.rank, name: cand.name, url: cand.url, description: d });
  });
  const ex = o.excluded;
  if (ex !== undefined) {
    if (!Array.isArray(ex)) c.add("항목 파일 excluded", "후보 번호 목록이어야 한다");
    else {
      const seen = new Set<number>();
      ex.forEach((n, i) => {
        const w = `excluded ${i + 1}`;
        if (typeof n !== "number" || !Number.isInteger(n)) return c.add(w, "후보 번호(정수)여야 한다");
        const cand = byNumber.get(n);
        if (cand === undefined) return c.add(w, `후보 ${n}은(는) 후보 파일에 없다`);
        if (seen.has(n)) return c.add(w, `후보 ${n}이(가) 두 번 나온다`);
        if (used.has(n)) return c.add(w, `후보 ${n}은(는) items에도 있다`);
        if (!candidateValuesValid(cand)) return c.add(w, `후보 ${n}의 이름·주소·순위가 받은 값의 모양이 아니다(후보 파일을 고치지 않는다)`);
        seen.add(n);
        out.excluded.push(cand.name);
      });
    }
  }
  out.items.sort((a, b) => a.rank - b.rank);
  return out;
}

// ---- 백업(4.3-1) ----

export interface ReposBackup {
  formatVersion: number;
  /** 날짜 순. 받지 못한 이유는 넣지 않는다 */
  days: RepoDay[];
}

export function hasRepoData(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM trend_repo_days LIMIT 1").get() !== undefined;
}

export function buildReposBackup(db: DatabaseSync, formatVersion: number): ReposBackup {
  return { formatVersion, days: allRepoDays(db) };
}

export function restoreReposBackup(db: DatabaseSync, f: ReposBackup): void {
  const day = db.prepare("INSERT INTO trend_repo_days (date, status) VALUES (?, ?)");
  for (const d of f.days) {
    day.run(d.date, d.status);
    insertRepoItems(db, d.date, d.items);
  }
}
