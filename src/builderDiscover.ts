import type { DatabaseSync } from "node:sqlite";
import { BUILDER_DEADLINE_MS, allowedUrl, checkBody, fail, failureReason, rateRemainingOf, readJson, safeKey, windowOf } from "./builderFetch.ts";
import { DEFAULT_OFF, GITHUB_JSON, PRODUCT_API_URL, PRODUCT_FETCH_COUNT, PRODUCT_HOSTS, PRODUCT_QUERY, PRODUCT_SOURCE, REPO_SOURCE, isOff, repoApiUrl, repoPageUrl, type BuilderOff } from "./builderSources.ts";
import { markSourceFailed, sourceState } from "./builderStore.ts";
import { completeSnapshotDates, isKindDone, publishedProductKeys, recentRepoKeys, snapshotMeta, snapshotRun, snapshotStars, type DiscoverKind, type KindStatus, type ReleaseInfo, type SnapshotMeta } from "./discoverStore.ts";
import type { FetchResult, FetchText } from "./feeds.ts";
import { daysBetween, kstDate } from "./kst.ts";
import { failsPublicScan } from "./precheck.ts";
import { hasVideoData } from "./siteCheck.ts";
import { issueCandidates, type IssueCandidate } from "./videoStore.ts";

// 9.9단계 4.1-3, 4.2: 새 제품과 뜨는 저장소의 후보. 외부인이 쓴 글이 재료에 들어오므로 정리해 후보 파일에만 두고(N11),
// 상태, 실패 이유, 경고, 실행 기록에는 수와 코드가 정한 문구만 쓴다. 상태 저장, 연속 실패 끝내기, 시각 앞당기기는 적용이 한다(B15).

/** 상세를 받는 증가량 상위 수(N1) */
export const MAX_REPO_DETAILS = 15;
/** 한 실행의 제품 후보 수(4.2-1) */
export const MAX_PRODUCT_CANDIDATES = 20;
/** 재료 글 길이(4.1-3) */
export const MATERIAL_CHARS = 2000;
/** 정리하기 전에 다루는 길이. 정규식이 조작한 입력에 제곱 시간이 걸려 이 길이로 최악 0.6초쯤에 묶는다 */
export const RAW_MATERIAL_CHARS = MATERIAL_CHARS * 20;
/** 처음 든 저장소를 증가량으로 보는 생성 뒤 날 수(N2) */
const NEW_REPO_DAYS = 14;
/** 이 값 이하로 남으면 GitHub 호출을 멈춘다(4.1-3) */
const RATE_FLOOR = 5;
/** 별 이력에서 평균을 내는 날 수(N8) */
const HISTORY_DAYS = 28;

export interface KindReport {
  /** done: 이 날짜는 이미 끝나 받지 않았다. 적용이 저장하지 않는다 */
  status: KindStatus | "done";
  /** 코드가 정한 문구만 쓴다 */
  reason?: string;
  failDays?: number;
  candidates: number;
  /** 적용 뒤 그날 실린 항목 수 */
  items?: number;
  /** 저장소: 상세 대상 수 */
  details?: number;
  /** 저장소: README를 받지 못했거나 한도·시간으로 상세를 못 받아 빠진 후보 수(공개 검사와 키 제외는 세지 않는다) */
  missing: number;
  droppedByHost: number;
  droppedByKey: number;
  droppedByScan: number;
  warnings: string[];
}

export interface ProductCandidate {
  n: number;
  key: string;
  name: string;
  url: string;
  tagline: string;
  description: string;
  topics: string[];
  votes: number;
  createdAt: string;
}

export interface RepoCandidate {
  n: number;
  key: string;
  /** `owner/name` */
  name: string;
  url: string;
  description: string;
  language: string | null;
  /** SPDX 값, `없음`, `판별되지 않음` */
  license: string;
  pushedOn: string;
  release: ReleaseInfo;
  stars: number;
  /** 하루 평균 증가량 */
  growth: number;
  forks: number;
  createdOn: string;
  /** 28일 일평균 대비 배수. 별 이력을 받지 못하면 null */
  ratio: number | null;
  readme: string;
}

/** 후보 파일의 내용. 쓰기 명령과 적용이 읽는다 */
export interface BuilderDiscoverData {
  target: string;
  fetchedAt: string;
  kinds: Record<DiscoverKind, KindReport>;
  /** 적용이 성공하면 받은 시각을 앞당길 소스 */
  advance: string[];
  products: ProductCandidate[];
  repos: RepoCandidate[];
  issues: IssueCandidate[];
}

export interface DiscoverOptions {
  db: DatabaseSync;
  http: FetchText;
  now: Date;
  target: string;
  home: string | null;
  token: string | null;
  secrets?: readonly string[];
  off?: BuilderOff;
  /** 시험 모드: 저장소를 끈다(4.1-2) */
  repoTestMode?: boolean;
  clock?: () => number;
  /** 받기 명령 전체 상한의 시각(밀리초) */
  deadlineAt?: number;
  /** 앞 소스가 받은 GitHub 남은 한도 */
  rateRemaining?: number | null;
}

// ---- 재료 정리 ----

/** 제어 문자와 서식 문자(유니코드 Cf 범주). 줄바꿈과 탭은 둔다 */
const INVISIBLE_RE = /(?![\n\t])[\p{Cc}\p{Cf}]/gu;
const COMMENT_RE = /<!--[\s\S]*?(?:-->|$)/g;
const TAG_RE = /<\/?[a-zA-Z!][^<>]*>/g;
const IMAGE_RE = /!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g;
const EMPTY_LINK_RE = /\[\s*\]\([^)]*\)/g;
const LINK_RE = /\[[^\]]*\]\([^)]*\)/g;
const BARE_URL_RE = /https?:\/\/\S+/g;
const SEPARATORS_ONLY_RE = /^[\s|·•*-]*$/;
const LINK_DEFINITION_RE = /^\s*\[[^\]]+\]:\s*\S+/;

/** 제어·서식 문자만 지운다. 이름은 글자를 바꾸지 않는다(4.2-1) */
export function cleanName(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, "").trim();
}

function removeUntilStable(text: string, re: RegExp): string {
  let out = text;
  for (;;) {
    const next = out.replace(re, "");
    if (next === out) return out;
    out = next;
  }
}

function isLinkOnly(line: string): boolean {
  if (LINK_DEFINITION_RE.test(line)) return true;
  const rest = line.replace(LINK_RE, "").replace(BARE_URL_RE, "");
  return rest !== line && SEPARATORS_ONLY_RE.test(rest);
}

/** README, 설명, 제품 소개를 재료로 정리한다(4.1-3). 지운 뒤에 자른다. 숨은 글자를 먼저 지워 주석이 가려지지 않게 한다 */
export function cleanMaterial(text: string, max = MATERIAL_CHARS): string {
  const plain = text.slice(0, RAW_MATERIAL_CHARS).replace(/\r\n?/g, "\n").replace(INVISIBLE_RE, "");
  const noMarkup = removeUntilStable(plain.replace(COMMENT_RE, ""), TAG_RE).replace(IMAGE_RE, "").replace(EMPTY_LINK_RE, "");
  const lines = noMarkup.split("\n").filter((l) => !isLinkOnly(l));
  const body = lines.join("\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return body.slice(0, max).replace(/[\uD800-\uDBFF]$/, "");
}

const rejected = (texts: string[], home: string | null, secrets: readonly string[]) => texts.some((t) => failsPublicScan(t, home, secrets) || hasVideoData(t));

// ---- 증가량 ----

export interface RepoGrowth {
  repo: string;
  stars: number;
  growth: number;
  meta: SnapshotMeta;
}

/**
 * 대상 날짜 완성 스냅샷의 증가량(N1, N2). 비교할 지난 완성 스냅샷이 없으면 null이다.
 * 저장소마다 가장 가까운 지난 값과 비교하고, 값이 없으면 생성 14일 이내만 지금 별 수를 날 수로 나눈다.
 */
export function repoGrowths(db: DatabaseSync, target: string): RepoGrowth[] | null {
  const past = completeSnapshotDates(db, target);
  if (past.length === 0) return null;
  const nearest = new Map<string, { date: string; stars: number }>();
  for (const date of past) for (const [repo, stars] of snapshotStars(db, date)) nearest.set(repo, { date, stars });
  const meta = snapshotMeta(db, target);
  const out: RepoGrowth[] = [];
  for (const [repo, stars] of snapshotStars(db, target)) {
    const m = meta.get(repo);
    if (m === undefined) continue;
    const base = nearest.get(repo);
    if (base !== undefined) {
      out.push({ repo, stars, growth: (stars - base.stars) / daysBetween(base.date, target), meta: m });
      continue;
    }
    const age = daysBetween(kstDate(new Date(m.createdAt)), target);
    if (age <= NEW_REPO_DAYS) out.push({ repo, stars, growth: stars / Math.max(1, age), meta: m });
  }
  return out.sort((a, b) => b.growth - a.growth || a.repo.localeCompare(b.repo));
}

// ---- 저장소 상세 ----

export function emptyReport(status: KindReport["status"]): KindReport {
  return { status, candidates: 0, missing: 0, droppedByHost: 0, droppedByKey: 0, droppedByScan: 0, warnings: [] };
}

const licenseOf = (spdx: string | null) => (spdx === null ? "없음" : spdx === "NOASSERTION" ? "판별되지 않음" : spdx);

/** 28일 일평균 대비 배수. 응답은 날짜별 증가량 목록이다. 받지 못하거나 읽지 못하면 null, 받았지만 이력이 짧거나 증가가 없으면 배수 없음 */
function historyRatio(res: FetchResult, growth: number): { ratio: number | null } | null {
  if (res.status !== 200) return null;
  let data: unknown;
  try {
    data = JSON.parse(res.text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  // 주 단위 배열이고 최신 주가 앞이다. 맨 앞은 아직 끝나지 않은 주라 뺀다
  const weeks = (data as { days?: unknown }[]).slice(1, 1 + HISTORY_DAYS / 7);
  const days = weeks.flatMap((w) => (Array.isArray(w?.days) ? (w.days as unknown[]) : [null]));
  if (days.some((c) => typeof c !== "number")) return null;
  const average = (days as number[]).reduce((a, b) => a + b, 0) / HISTORY_DAYS;
  return { ratio: days.length === HISTORY_DAYS && average > 0 ? Math.round((growth / average) * 10) / 10 : null };
}

function releaseOf(res: FetchResult | null): ReleaseInfo {
  if (res === null) return { state: "unknown" };
  if (res.status === 404) return { state: "none" };
  if (res.status !== 200) return { state: "unknown" };
  try {
    const published = (JSON.parse(res.text) as { published_at?: unknown } | null)?.published_at;
    return typeof published === "string" && /^\d{4}-\d{2}-\d{2}/.test(published) ? { state: "found", date: published.slice(0, 10) } : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

interface RepoContext {
  db: DatabaseSync;
  target: string;
  home: string | null;
  secrets: readonly string[];
  /** 더 호출하면 안 된다(한도나 시간) */
  stopped: () => boolean;
  get: (url: string, accept: string) => Promise<FetchResult | null>;
}

const GITHUB_RAW = "application/vnd.github.raw+json";

async function fetchRepos(c: RepoContext, report: KindReport): Promise<RepoCandidate[]> {
  const growths = repoGrowths(c.db, c.target);
  if (growths === null) {
    report.status = "baseline";
    return [];
  }
  const published = recentRepoKeys(c.db, c.target);
  const picked: RepoGrowth[] = [];
  for (const g of growths) {
    if (picked.length === MAX_REPO_DETAILS) break;
    if (published.has(safeKey(`repo:${g.repo}`))) {
      report.droppedByKey++;
      continue;
    }
    if (rejected([g.meta.name, g.meta.description ?? ""], c.home, c.secrets)) {
      report.droppedByScan++;
      continue;
    }
    picked.push(g);
  }
  report.details = picked.length;
  const out: RepoCandidate[] = [];
  let noReadme = 0;
  let emptyReadme = 0;
  let notReached = 0;
  let noHistory = 0;
  for (const g of picked) {
    const name = g.meta.name;
    if (c.stopped()) {
      notReached++;
      continue;
    }
    const history = await c.get(repoApiUrl(name, "stargazers/history"), GITHUB_JSON);
    const read = history === null ? null : historyRatio(history, g.growth);
    if (read === null) noHistory++;
    if (c.stopped()) {
      notReached++;
      continue;
    }
    const res = await c.get(repoApiUrl(name, "readme"), GITHUB_RAW);
    if (res?.status !== 200) {
      noReadme++;
      continue;
    }
    const readme = cleanMaterial(res.text);
    if (readme === "") {
      emptyReadme++;
      continue;
    }
    const release = c.stopped() ? null : await c.get(repoApiUrl(name, "releases/latest"), GITHUB_JSON);
    out.push({
      n: 0,
      key: safeKey(`repo:${g.repo}`),
      name,
      url: repoPageUrl(name),
      description: cleanMaterial(g.meta.description ?? ""),
      language: g.meta.language,
      license: licenseOf(g.meta.license),
      pushedOn: g.meta.pushedAt.slice(0, 10),
      release: releaseOf(release),
      stars: g.stars,
      growth: Math.round(g.growth * 10) / 10,
      forks: g.meta.forks,
      createdOn: g.meta.createdAt.slice(0, 10),
      ratio: read?.ratio ?? null,
      readme,
    });
  }
  report.missing = noReadme + notReached;
  if (noReadme > 0) report.warnings.push(`README를 받지 못한 후보 ${noReadme}개를 뺐다`);
  if (notReached > 0) report.warnings.push(`한도나 시간 상한으로 후보 ${notReached}개의 상세를 받지 못했다`);
  if (emptyReadme > 0) report.warnings.push(`정리하니 본문이 없는 README 후보 ${emptyReadme}개를 뺐다`);
  if (noHistory > 0) report.warnings.push(`별 이력을 받지 못한 후보 ${noHistory}개는 배수가 없다`);
  if (report.missing > 0 && out.length === 0) fail("재료를 갖춘 후보가 없다");
  return out;
}

// ---- 제품 ----

interface PostNode {
  slug?: unknown;
  name?: unknown;
  tagline?: unknown;
  description?: unknown;
  votesCount?: unknown;
  createdAt?: unknown;
  url?: unknown;
  topics?: { edges?: { node?: { name?: unknown } }[] };
}

type Post = PostNode & { slug: string; name: string; url: string };

function parsePosts(text: string): Post[] {
  const d = readJson(text) as { errors?: unknown; data?: { posts?: { edges?: unknown } } } | null;
  const edges = d?.data?.posts?.edges;
  if (d?.errors !== undefined || !Array.isArray(edges)) fail("Product Hunt 응답의 형식이 맞지 않다");
  return (edges as { node?: PostNode }[]).map((e) => {
    const n = e.node;
    if (typeof n?.slug !== "string" || typeof n.name !== "string" || typeof n.url !== "string") fail("Product Hunt 응답의 형식이 맞지 않다");
    return n as Post;
  });
}

/** 제품 페이지 주소: 호스트를 확인하고 쿼리와 조각을 뗀다 */
function productUrl(raw: string): string | null {
  const allowed = allowedUrl(raw, PRODUCT_API_URL, PRODUCT_HOSTS);
  if (allowed === null) return null;
  const u = new URL(allowed);
  return `${u.origin}${u.pathname}`;
}

interface ProductContext {
  db: DatabaseSync;
  http: FetchText;
  now: Date;
  home: string | null;
  secrets: readonly string[];
  token: string;
  past: () => boolean;
}

async function fetchProducts(c: ProductContext, report: KindReport): Promise<ProductCandidate[]> {
  if (c.past()) fail("시간 초과");
  const w = windowOf(sourceState(c.db, PRODUCT_SOURCE.id).fetchedAt, c.now);
  if (w.clampedFrom !== undefined) report.warnings.push(`기간을 14일로 잘랐다(${w.clampedFrom}부터)`);
  const res = await c.http(PRODUCT_API_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query: PRODUCT_QUERY, variables: { featured: true, postedAfter: new Date(w.from).toISOString(), first: PRODUCT_FETCH_COUNT } }),
  });
  if (res.status === 401) fail("HTTP 401: 키를 확인하라");
  checkBody(res.status, res.text);
  const published = publishedProductKeys(c.db);
  const out: ProductCandidate[] = [];
  for (const p of parsePosts(res.text)) {
    if (out.length === MAX_PRODUCT_CANDIDATES) break;
    const { slug, name: rawName } = p;
    const tagline = typeof p.tagline === "string" ? p.tagline : "";
    const description = typeof p.description === "string" ? p.description : "";
    const key = safeKey(`ph:${slug}`);
    if (published.has(key)) {
      report.droppedByKey++;
      continue;
    }
    const url = productUrl(p.url);
    if (url === null) {
      report.droppedByHost++;
      continue;
    }
    if (rejected([cleanName(rawName), tagline, description, slug], c.home, c.secrets)) {
      report.droppedByScan++;
      continue;
    }
    out.push({
      n: 0,
      key,
      name: cleanName(rawName),
      url,
      tagline: cleanMaterial(tagline),
      description: cleanMaterial(description),
      topics: (p.topics?.edges ?? []).map((e) => e.node?.name).filter((t): t is string => typeof t === "string").map(cleanName),
      votes: typeof p.votesCount === "number" ? p.votesCount : 0,
      createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
    });
  }
  return out;
}

// ---- 함께 받기 ----

/** 꺼진 종류: 끄기 값, 토큰 없는 제품, 시험 모드의 저장소(4.1-2, 4.2-2) */
export function offKinds(off: BuilderOff | undefined, token: string | null, repoTestMode: boolean): DiscoverKind[] {
  const o = off ?? DEFAULT_OFF;
  return [...(isOff(PRODUCT_SOURCE, o) || token === null ? (["product"] as const) : []), ...(isOff(REPO_SOURCE, o) || repoTestMode ? (["repo"] as const) : [])];
}

/** 종류별로 예외를 가둔다. 호출은 이 함수 밖의 9.8 소스 뒤에 한다(한도를 먼저 쓰지 않기 위해서다) */
export async function fetchDiscoveries(o: DiscoverOptions): Promise<BuilderDiscoverData> {
  const { db, target, now, home } = o;
  const secrets = o.secrets ?? [];
  const off = offKinds(o.off, o.token, o.repoTestMode === true);
  const clock = o.clock ?? Date.now;
  let deadlineAt = o.deadlineAt;
  const past = () => {
    deadlineAt ??= clock() + BUILDER_DEADLINE_MS;
    return clock() >= deadlineAt;
  };
  const today = kstDate(now);
  let remaining = o.rateRemaining ?? null;

  const get: RepoContext["get"] = async (url, accept) => {
    try {
      const res = await o.http(url, { headers: { accept } });
      remaining = rateRemainingOf(res) ?? remaining;
      return res;
    } catch {
      return null;
    }
  };
  const failed = (report: KindReport, source: string, reason: string) => {
    report.status = "failed";
    report.reason = reason;
    report.failDays = markSourceFailed(db, source, today);
  };

  const product = emptyReport("checked");
  const repo = emptyReport("checked");
  const data: BuilderDiscoverData = { target, fetchedAt: now.toISOString(), kinds: { product, repo }, advance: [], products: [], repos: [], issues: issueCandidates(db, target) };

  if (isKindDone(db, target, "product")) product.status = "done";
  else if (off.includes("product") || o.token === null) product.status = "off";
  else {
    try {
      data.products = await fetchProducts({ db, http: o.http, now, home, secrets, token: o.token, past }, product);
      data.advance.push(PRODUCT_SOURCE.id);
    } catch (e) {
      failed(product, PRODUCT_SOURCE.id, failureReason(e));
    }
  }

  if (isKindDone(db, target, "repo")) repo.status = "done";
  else if (off.includes("repo")) repo.status = "off";
  else if (snapshotRun(db, target)?.state !== "complete") failed(repo, REPO_SOURCE.id, "스냅샷이 완성되지 않았다");
  else {
    try {
      data.repos = await fetchRepos({ db, target, home, secrets, get, stopped: () => past() || (remaining !== null && remaining <= RATE_FLOOR) }, repo);
    } catch (e) {
      failed(repo, REPO_SOURCE.id, failureReason(e));
    }
  }

  let n = 0;
  for (const c of data.products) c.n = ++n;
  for (const c of data.repos) c.n = ++n;
  product.candidates = data.products.length;
  repo.candidates = data.repos.length;
  return data;
}
