import type { BuilderField } from "./builderStore.ts";

// 9.8단계 2.4·2.5: 빌더 소스 주소와 기계 필터 값을 이 파일 한 곳에 둔다. 소스나 공급사를 끄려면 아래 두 목록에 이름을 넣는다(4.1-2).
// 끈 소스는 호출하지 않고 실패로 세지 않으며, 쌓인 숫자 행은 그대로 둔다.

/** 끌 소스 id */
export const BUILDER_SOURCES_OFF: readonly string[] = [];
/** 끌 공급사(vendor) */
export const BUILDER_VENDORS_OFF: readonly string[] = [];

export type DocKind = "pricing" | "limits" | "deprecation";
export type FeedFilter = "coding" | "model" | "security" | "framework" | "platform";

interface SourceBase {
  /** DB와 실행 기록의 이름. 바꾸면 그 소스는 첫 실행이 된다 */
  id: string;
  label: string;
  vendor: string;
  field: BuilderField;
  url: string;
  /** 후보 주소가 있어야 하는 호스트(https만) */
  hosts: readonly string[];
  /** 한 번에 받는 항목 수나 피드 한도. 닿으면 기간 앞쪽을 놓쳤을 수 있다고 경고한다 */
  limit?: number;
}

export interface ReleaseSource extends SourceBase {
  kind: "release";
  /** npm 패키지가 있으면 키에 쓴다 */
  npm?: string;
}

export interface FeedSource extends SourceBase {
  kind: "feed";
  filter: FeedFilter;
}

export interface DocSource extends SourceBase {
  kind: "doc";
  doc: DocKind;
  /** 항목의 출처 주소: 받는 주소에서 `.md`, `.md.txt`를 뗀 페이지(2.4) */
  page: string;
  /** 문서 머리말이 표 날짜를 모두 잠정이라 밝힌다(B7, Gemini) */
  alwaysTentative?: boolean;
}

export interface KevSource extends SourceBase {
  kind: "kev";
  page: string;
}

export interface GhsaSource extends SourceBase {
  kind: "ghsa";
}

export interface EolSource extends SourceBase {
  kind: "eol";
  page: string;
}

export type BuilderSourceSpec = ReleaseSource | FeedSource | DocSource | KevSource | GhsaSource | EolSource;

export const GITHUB_API = "https://api.github.com";
export const GITHUB_JSON = "application/vnd.github+json";
const CLAUDE_DOCS = "https://platform.claude.com/docs/en";
const OPENAI_DOCS = "https://developers.openai.com/api/docs";
const GEMINI_DOCS = "https://ai.google.dev/gemini-api/docs";

/** GitHub REST 릴리스(토큰 없음). 많은 저장소가 하루 1건 이상이라 14일을 덮게 받는다 */
const RELEASES_PER_PAGE = 30;
export const GHSA_PER_PAGE = 100;

function release(id: string, label: string, vendor: string, repo: string, npm?: string): ReleaseSource {
  const base: ReleaseSource = { id, label, vendor, field: "코딩 도구", kind: "release", url: `${GITHUB_API}/repos/${repo}/releases?per_page=${RELEASES_PER_PAGE}`, hosts: ["github.com"], limit: RELEASES_PER_PAGE };
  return npm === undefined ? base : { ...base, npm };
}

function doc(id: string, label: string, vendor: string, kind: DocKind, url: string, hosts: readonly string[], extra: { alwaysTentative?: boolean } = {}): DocSource {
  return { id, label, vendor, field: "모델", kind: "doc", doc: kind, url, page: url.replace(/\.md(?:\.txt)?$/, ""), hosts, ...extra };
}

function feed(id: string, label: string, vendor: string, field: BuilderField, filter: FeedFilter, url: string, hosts: readonly string[], limit?: number): FeedSource {
  const base: FeedSource = { id, label, vendor, field, kind: "feed", filter, url, hosts };
  return limit === undefined ? base : { ...base, limit };
}

function eol(id: string, label: string, vendor: string, product: string): EolSource {
  return { id, label, vendor, field: "프레임워크", kind: "eol", url: `https://endoflife.date/api/v1/products/${product}`, page: `https://endoflife.date/${product}`, hosts: ["endoflife.date"] };
}

/** 2.4의 소스 표. 여기 없는 곳은 받지 않는다 */
export const BUILDER_SOURCES: readonly BuilderSourceSpec[] = [
  release("claude-code", "Claude Code 릴리스", "anthropic", "anthropics/claude-code", "@anthropic-ai/claude-code"),
  release("codex", "Codex 릴리스", "openai", "openai/codex", "@openai/codex"),
  release("gemini-cli", "Gemini CLI 릴리스", "google", "google-gemini/gemini-cli", "@google/gemini-cli"),
  release("mcp-spec", "MCP 명세 릴리스", "mcp", "modelcontextprotocol/modelcontextprotocol"),
  feed("copilot", "Copilot 변경 기록", "github", "코딩 도구", "coding", "https://github.blog/changelog/label/copilot/feed/", ["github.blog"], 10),
  feed("claude-notes", "Claude 릴리스 노트", "anthropic", "모델", "model", `${CLAUDE_DOCS}/release-notes/feed.xml`, ["platform.claude.com"]),
  doc("anthropic-deprecations", "Anthropic 지원 종료", "anthropic", "deprecation", `${CLAUDE_DOCS}/about-claude/model-deprecations.md`, ["platform.claude.com"]),
  doc("anthropic-pricing", "Anthropic 가격", "anthropic", "pricing", `${CLAUDE_DOCS}/about-claude/pricing.md`, ["platform.claude.com"]),
  doc("anthropic-limits", "Anthropic 한도", "anthropic", "limits", `${CLAUDE_DOCS}/api/rate-limits.md`, ["platform.claude.com"]),
  doc("openai-deprecations", "OpenAI 지원 종료", "openai", "deprecation", `${OPENAI_DOCS}/deprecations.md`, ["developers.openai.com"]),
  doc("openai-pricing", "OpenAI 가격", "openai", "pricing", `${OPENAI_DOCS}/pricing.md`, ["developers.openai.com"]),
  doc("gemini-deprecations", "Gemini 지원 종료", "google", "deprecation", `${GEMINI_DOCS}/deprecations.md.txt`, ["ai.google.dev"], { alwaysTentative: true }),
  doc("gemini-pricing", "Gemini 가격", "google", "pricing", `${GEMINI_DOCS}/pricing.md.txt`, ["ai.google.dev"]),
  { id: "kev", label: "CISA KEV", vendor: "cisa", field: "보안", kind: "kev", url: "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json", page: "https://www.cisa.gov/known-exploited-vulnerabilities-catalog", hosts: ["www.cisa.gov"] },
  { id: "ghsa", label: "GitHub 보안 공지", vendor: "github", field: "보안", kind: "ghsa", url: `${GITHUB_API}/advisories`, hosts: ["github.com"], limit: GHSA_PER_PAGE },
  feed("socket", "Socket 블로그", "socket", "보안", "security", "https://socket.dev/api/blog/feed.atom", ["socket.dev"]),
  feed("nextjs", "Next.js 블로그", "vercel", "프레임워크", "framework", "https://nextjs.org/feed.xml", ["nextjs.org"]),
  feed("react", "React 블로그", "meta", "프레임워크", "framework", "https://react.dev/rss.xml", ["react.dev"]),
  feed("nodejs", "Node.js 블로그", "nodejs", "프레임워크", "framework", "https://nodejs.org/en/feed/blog.xml", ["nodejs.org"]),
  feed("typescript", "TypeScript 블로그", "microsoft", "프레임워크", "framework", "https://devblogs.microsoft.com/typescript/feed/", ["devblogs.microsoft.com"]),
  feed("vite", "Vite 블로그", "vite", "프레임워크", "framework", "https://vite.dev/blog.rss", ["vite.dev"]),
  eol("eol-nodejs", "endoflife.date Node.js", "endoflife", "nodejs"),
  eol("eol-nextjs", "endoflife.date Next.js", "endoflife", "nextjs"),
  feed("vercel", "Vercel 변경 기록", "vercel", "플랫폼", "platform", "https://vercel.com/atom", ["vercel.com"]),
  feed("supabase", "Supabase 변경 기록", "supabase", "플랫폼", "platform", "https://supabase.com/changelog/rss.xml", ["supabase.com"]),
  feed("cloudflare", "Cloudflare 변경 기록", "cloudflare", "플랫폼", "platform", "https://developers.cloudflare.com/changelog/rss/index.xml", ["developers.cloudflare.com"]),
];

export interface BuilderOff {
  sources: readonly string[];
  vendors: readonly string[];
}

export const DEFAULT_OFF: BuilderOff = { sources: BUILDER_SOURCES_OFF, vendors: BUILDER_VENDORS_OFF };

export function isOff(s: Pick<BuilderSourceSpec, "id" | "vendor">, off: BuilderOff): boolean {
  return off.sources.includes(s.id) || off.vendors.includes(s.vendor);
}

/** GHSA 받기: `updated` 범위로 받아 코드에서 검토 시각으로 거른다(2.5). 악성코드 공지는 쓰지 않는다(B3) */
export function ghsaUrl(severity: "critical" | "high", fromDate: string): string {
  return `${GITHUB_API}/advisories?type=reviewed&ecosystem=npm&severity=${severity}&sort=updated&direction=desc&per_page=${GHSA_PER_PAGE}&updated=${encodeURIComponent(`>=${fromDate}`)}`;
}

/** npm 주간 다운로드 수. 숫자만 쓴다(2.4) */
export function npmDownloadsUrl(name: string): string {
  return `https://api.npmjs.org/downloads/point/last-week/${name.split("/").map(encodeURIComponent).join("/").replace(/^%40/, "@")}`;
}

// ---- 9.9단계 새 종류(2.4의 소스 표). 끄려면 위 BUILDER_SOURCES_OFF에 id를 넣는다 ----

export const REPO_SOURCE = { id: "github-repos", vendor: "github-search" } as const;
export const PRODUCT_SOURCE = { id: "product-hunt", vendor: "producthunt" } as const;

/** 스냅샷 범위(N1) */
export const REPO_MIN_STARS = 2000;
export const REPO_PUSHED_DAYS = 7;
export const REPO_PER_PAGE = 100;
/** 쿼리 하나로 받을 수 있는 페이지 수(1,000건 제한) */
export const REPO_MAX_PAGES = 10;

/** 저장소 검색. 별 많은 순으로 받아 페이지가 끝나면 마지막 별 수를 다음 쿼리의 상한으로 쓴다. hi가 null이면 상한이 없다 */
export function repoSearchUrl(hi: number | null, pushedSince: string, page: number): string {
  const stars = hi === null ? `stars:>=${REPO_MIN_STARS}` : `stars:${REPO_MIN_STARS}..${hi}`;
  const q = `${stars} pushed:>=${pushedSince} fork:false archived:false`;
  return `${GITHUB_API}/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${REPO_PER_PAGE}&page=${page}`;
}

/** 이름은 받은 값을 형식 검사한 뒤에만 넣는다 */
export const repoApiUrl = (name: string, tail: "stargazers/history" | "readme" | "releases/latest") => `${GITHUB_API}/repos/${name}/${tail}`;
export const repoPageUrl = (name: string) => `https://github.com/${name}`;

export const PRODUCT_API_URL = "https://api.producthunt.com/v2/api/graphql";
/** 항목 출처가 있어야 하는 호스트(N3) */
export const PRODUCT_HOSTS: readonly string[] = ["www.producthunt.com"];
/** 한 번에 묻는 수. 실린 키와 호스트 밖 주소를 빼고도 후보 상한을 채우게 상한보다 크게 둔다 */
export const PRODUCT_FETCH_COUNT = 30;
/** 재료에 쓰는 칸만 묻는다. 메이커, 사용자, 댓글, 이미지, website는 묻지 않는다(4.2-1) */
export const PRODUCT_QUERY = `query Posts($featured: Boolean!, $postedAfter: DateTime!, $first: Int!) {
  posts(first: $first, featured: $featured, order: VOTES, postedAfter: $postedAfter) {
    edges { node { slug name tagline description votesCount createdAt url topics(first: 5) { edges { node { name } } } } }
  }
}`;

// ---- 2.5의 기계 필터 값 ----

/** 코딩 도구: 줄이 맞으면 후보에 그 줄만 넣는다 */
export const CODING_LINE_RE =
  /breaking|deprecat|\bremoved?\b|no longer|default model|by default|pric|billing|rate limit|usage limit|quota|credit|permission|sandbox|\b(?:opus|sonnet|haiku)\b|\bgpt-\d|\bgemini[- ]\d|\bo[1-9](?:-mini)?\b|auto[- ]?(?:run|approv|accept|execut|edit|mode)|yolo|dangerously|skip[- ]permissions/i;
/** 맞은 줄이 없는 메이저 릴리스의 재료 길이 */
export const MAJOR_HEAD_CHARS = 1500;
/** 프리릴리스 태그 */
export const PRERELEASE_RE = /(?:^|[-.+])(?:alpha|beta|rc|canary|nightly|preview|next|dev|pre)(?:[-.+\d]|$)/i;

export const GHSA_MIN_DOWNLOADS = 1_000_000;
/** 추적 프레임워크 패키지: high 이상이면 통과 */
export const TRACKED_PACKAGES: readonly string[] = ["next", "react", "react-dom", "vite", "typescript", "@modelcontextprotocol/sdk"];
/** KEV: 벤더·제품이 추적 대상이고 웹 스택 소프트웨어인 것 */
export const KEV_TRACKED_RE = /\b(?:vercel|next\.?js|react|node\.?js|vite|typescript|supabase|cloudflare|anthropic|claude|openai|gemini|copilot|model context protocol|\bmcp\b|npm)\b/i;

export const SOCKET_TITLE_RE = /compromis|malicious|malware|supply[- ]chain|backdoor|hijack|critical|\brce\b|\bCVE-\d/i;

/** 프레임워크: 이름 뒤 메이저 버전(`Next.js 16`, `Vite 8.0`, `TypeScript 6.0`, `Node.js 24.0.0`) */
export const FRAMEWORK_MAJOR_RE = /\b(?:next\.js|react|vite|typescript|node(?:\.js)?)\s+v?[1-9]\d?(?:\.0){0,2}(?![.\d])/i;
export const FRAMEWORK_PRERELEASE_RE = /\b(?:alpha|beta|rc|release candidate|canary|preview)\b/i;
export const FRAMEWORK_STABLE_RE = /general availability|\bGA\b|(?:now|is) stable|stable release/i;
export const FRAMEWORK_SECURITY_RE = /security|\bCVE-\d|vulnerabilit/i;
export const FRAMEWORK_LTS_RE = /(?:transition|mov|promot|enter|becom)\w*\b.*\bLTS\b|\bLTS\b.*(?:transition|begins?|codename)|long[- ]term support/i;

/** 플랫폼: 가격, 과금, 지원 종료, 제거, 호환성 파괴, 이전, 한도, 강제 시행 */
export const PLATFORM_TITLE_RE = /pric|billing|\bbilled\b|deprecat|sunset|end[- ]of[- ](?:life|support)|\beol\b|retir|remov|breaking|migrat|\blimits?\b|quota|enforc|mandatory/i;

/** 지원 종료까지 이 날 수 안에 처음 든 버전(endoflife.date) */
export const EOL_WINDOW_DAYS = 90;
