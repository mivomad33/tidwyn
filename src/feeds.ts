import { addDays, kstIso } from "./kst.ts";

// 대상일의 우선 출처 후보 목록(1.5단계 R1, 4.1). RSS의 제목·요약·발행 시각만 읽는다.
// 피드 응답은 데이터로만 다룬다(실행하거나 파일 경로로 쓰지 않는다).

export interface FeedSpec {
  /** 출력·실행 기록에 쓰는 이름. 같은 이름의 피드는 건수를 합쳐 보인다 */
  group: string;
  url: string;
  /** 구글 뉴스 검색이면 링크가 중간 주소이고 매체명을 제목 끝에서 정한다 */
  google: boolean;
  /** 직접 받는 피드의 매체명 */
  outlet?: string;
}

export interface Candidate {
  outlet: string;
  title: string;
  summary?: string;
  /** 발행 시각(KST ISO) */
  publishedAt: string;
  link: string;
  /** 링크가 구글 뉴스 같은 중간 주소인지. 그렇다면 원문 주소를 웹 검색으로 찾아야 한다 */
  redirectLink: boolean;
  feed: string;
}

export interface FeedFailure {
  feed: string;
  url: string;
  reason: string;
}

export interface FeedReport {
  window: { from: string; to: string };
  /** 피드 이름 → 받은 건수와 범위 안 건수 */
  counts: Record<string, { fetched: number; inWindow: number }>;
  failures: FeedFailure[];
  candidates: Candidate[];
}

export interface FetchResult {
  status: number;
  text: string;
}

export type FetchText = (url: string) => Promise<FetchResult>;

const USER_AGENT = "tidwyn/1.5 (personal RSS reader)";
const TIMEOUT_MS = 20_000;

/** 피드 하나를 받는다. 시간 제한을 넘기면 예외 */
export const fetchText: FetchText = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return { status: res.status, text: await res.text() };
};

// 피드 주소 목록(명세서 6장 준비물). 구글 뉴스는 도메인마다 날짜 범위로 좁혀 검색한다.
const GOOGLE_DOMAINS: { group: string; domain: string; korean: boolean; topics: string[] }[] = [
  { group: "구글 뉴스 Reuters", domain: "reuters.com", korean: false, topics: ["world", "business", "markets", "technology", "Asia", "Korea", "China", "Ukraine"] },
  { group: "구글 뉴스 AP", domain: "apnews.com", korean: false, topics: ["world", "politics", "business", "technology", "Asia", "Korea"] },
  { group: "구글 뉴스 연합뉴스", domain: "yna.co.kr", korean: true, topics: ["정치", "경제", "사회", "북한", "국제", "IT"] },
  { group: "구글 뉴스 BBC", domain: "bbc.com", korean: false, topics: [] },
  { group: "구글 뉴스 BBC", domain: "bbc.co.uk", korean: false, topics: [] },
];

const YONHAP_FEEDS = ["news", "politics", "economy", "society", "international", "industry", "northkorea"];
const BBC_WORLD = "https://feeds.bbci.co.uk/news/world/rss.xml";

export function googleNewsUrl(domain: string, after: string, before: string, korean: boolean, topic?: string): string {
  const q = [topic, `site:${domain}`, `after:${after}`, `before:${before}`].filter((x) => x !== undefined).join(" ");
  const locale = korean ? "hl=ko&gl=KR&ceid=KR:ko" : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q).replace(/%20/g, "+")}&${locale}`;
}

/**
 * 대상일의 피드 목록. 구글 뉴스는 한 번에 100건까지라 날짜 단위(전날~대상일, 대상일~다음 날)와 주제어로 나눠 받는다.
 * 시각 단위 after:는 동작하지 않는다(2026-10-28 확인).
 */
export function feedSpecs(date: string): FeedSpec[] {
  const specs: FeedSpec[] = [];
  for (const g of GOOGLE_DOMAINS) {
    specs.push({ group: g.group, url: googleNewsUrl(g.domain, addDays(date, -1), addDays(date, 1), g.korean), google: true });
    specs.push({ group: g.group, url: googleNewsUrl(g.domain, date, addDays(date, 2), g.korean), google: true });
    for (const t of g.topics) specs.push({ group: g.group, url: googleNewsUrl(g.domain, addDays(date, -1), addDays(date, 2), g.korean, t), google: true });
  }
  for (const f of YONHAP_FEEDS) specs.push({ group: "연합뉴스 RSS", url: `https://www.yna.co.kr/rss/${f}.xml`, google: false, outlet: "연합뉴스" });
  specs.push({ group: "BBC RSS", url: BBC_WORLD, google: false, outlet: "BBC" });
  return specs;
}

const PACIFIC_OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", timeZoneName: "shortOffset" });

/** 그 시각의 태평양 시간 UTC 오프셋(밀리초) */
function pacificOffsetAt(t: number): number {
  const name = PACIFIC_OFFSET.formatToParts(new Date(t)).find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-]\d+)/.exec(name ?? "");
  return (m ? Number(m[1]) : -8) * 3_600_000;
}

/** 미국 서부(태평양 시간)의 그날 0시가 UTC로 몇 시인지. 서머타임이 바뀌는 날도 0시 시점의 오프셋을 쓴다 */
function pacificMidnightUtc(date: string): number {
  const base = Date.parse(`${date}T00:00:00Z`);
  const guess = base - pacificOffsetAt(base);
  return base - pacificOffsetAt(guess);
}

/** 후보 날짜 범위: 대상일 KST 0시부터 미국 서부의 대상일이 끝날 때까지(4.1-3). [from, to) */
export function candidateWindow(date: string): { from: Date; to: Date } {
  return { from: new Date(Date.parse(`${date}T00:00:00+09:00`)), to: new Date(pacificMidnightUtc(addDays(date, 1))) };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** CDATA와 HTML 엔터티를 글자로 푼다 */
export function decodeXmlText(raw: string): string {
  const text = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function tag(item: string, name: string): string | undefined {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(item);
  return m ? decodeXmlText(m[1]!).trim() : undefined;
}

export interface RawItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
  source?: string;
}

/** RSS 2.0 항목을 뽑는다. RSS가 아니면 예외 */
export function parseRss(xml: string): RawItem[] {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) throw new Error("RSS 형식이 아니다");
  const items: RawItem[] = [];
  for (const m of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const body = m[1]!;
    const title = tag(body, "title");
    const link = tag(body, "link");
    const pubDate = tag(body, "pubDate");
    if (!title || !link || !pubDate) continue;
    const item: RawItem = { title, link, pubDate };
    const description = tag(body, "description");
    if (description) item.description = stripTags(decodeXmlText(description));
    const source = tag(body, "source");
    if (source) item.source = stripTags(source);
    items.push(item);
  }
  return items;
}

/** 구글 뉴스 제목 끝의 " - 매체명"을 떼어 낸다 */
export function splitGoogleTitle(title: string, source?: string): { title: string; outlet: string } {
  if (source && title.endsWith(` - ${source}`)) return { title: title.slice(0, -(source.length + 3)).trim(), outlet: source };
  const i = title.lastIndexOf(" - ");
  if (i > 0) return { title: title.slice(0, i).trim(), outlet: source ?? title.slice(i + 3).trim() };
  return { title, outlet: source ?? "알 수 없음" };
}

function toCandidate(spec: FeedSpec, item: RawItem, published: Date): Candidate {
  const split = spec.google ? splitGoogleTitle(item.title, item.source) : { title: item.title, outlet: spec.outlet ?? "알 수 없음" };
  const c: Candidate = { outlet: split.outlet, title: split.title, publishedAt: kstIso(published), link: item.link, redirectLink: spec.google, feed: spec.group };
  // 구글 뉴스의 설명은 제목과 매체명을 되풀이할 뿐이라 요약으로 쓰지 않는다
  if (!spec.google && item.description && item.description !== item.title) c.summary = item.description;
  return c;
}

export interface CollectOptions {
  fetch: FetchText;
  /** 구글 뉴스에 연달아 보내는 요청 사이 간격(밀리초) */
  gapMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 피드를 모두 받아 후보 목록을 만든다. 피드 하나가 실패해도 나머지는 계속 받는다(4.1-5) */
export async function collectCandidates(date: string, specs: FeedSpec[], opts: CollectOptions): Promise<FeedReport> {
  const { from, to } = candidateWindow(date);
  const counts: FeedReport["counts"] = {};
  const failures: FeedFailure[] = [];
  // 같은 매체·제목은 한 번만 둔다. 중간 주소 항목보다 원문 링크가 있는 항목을 남긴다
  const seen = new Map<string, number>();
  const candidates: Candidate[] = [];
  let lastGoogle = false;
  for (const spec of specs) {
    if (spec.google && lastGoogle && opts.gapMs > 0) await sleep(opts.gapMs);
    lastGoogle = spec.google;
    const count = (counts[spec.group] ??= { fetched: 0, inWindow: 0 });
    let items: RawItem[];
    try {
      const res = await opts.fetch(spec.url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      items = parseRss(res.text);
    } catch (e) {
      const err = e as Error;
      failures.push({ feed: spec.group, url: spec.url, reason: err.name === "TimeoutError" ? "시간 초과" : err.message });
      continue;
    }
    count.fetched += items.length;
    for (const item of items) {
      const t = Date.parse(item.pubDate);
      if (Number.isNaN(t) || t < from.getTime() || t >= to.getTime()) continue;
      const c = toCandidate(spec, item, new Date(t));
      const key = `${c.outlet}\n${c.title}`;
      const at = seen.get(key);
      if (at !== undefined) {
        if (candidates[at]!.redirectLink && !c.redirectLink) candidates[at] = c;
        continue;
      }
      seen.set(key, candidates.length);
      count.inWindow++;
      candidates.push(c);
    }
  }
  candidates.sort((a, b) => a.outlet.localeCompare(b.outlet) || a.publishedAt.localeCompare(b.publishedAt));
  return { window: { from: kstIso(from), to: kstIso(to) }, counts, failures, candidates };
}

const SUMMARY_MAX = 120;

/**
 * Claude가 읽는 짧은 후보 목록. 매체별로 한 줄에 한 건(KST 시각, 제목, 짧은 요약).
 * 구글 뉴스 중간 주소는 길고 출처로 쓸 수 없어 빼고, 직접 받은 피드의 원문 링크만 적는다.
 */
export function renderCandidatesMarkdown(date: string, r: FeedReport): string {
  const lines = [`# ${date} 후보 목록`, "", `범위: ${r.window.from} ~ ${r.window.to} (KST). "(중간 주소)"인 항목은 원문 주소를 웹 검색으로 찾는다.`];
  if (r.failures.length > 0) lines.push("", `받지 못한 피드: ${[...new Set(r.failures.map((f) => f.feed))].join(", ")}`);
  let outlet: string | null = null;
  for (const c of r.candidates) {
    if (c.outlet !== outlet) {
      outlet = c.outlet;
      lines.push("", `## ${outlet}`, "");
    }
    const time = c.publishedAt.slice(5, 16).replace("T", " ");
    const summary = c.summary === undefined ? "" : ` — ${c.summary.length > SUMMARY_MAX ? `${c.summary.slice(0, SUMMARY_MAX)}…` : c.summary}`;
    lines.push(`- ${time} ${c.title}${summary} ${c.redirectLink ? "(중간 주소)" : c.link}`);
  }
  return lines.join("\n") + "\n";
}

/** 대화창에 보일 짧은 출력: 피드별 건수와 실패 */
export function describeFeedReport(date: string, file: string, r: FeedReport): string {
  const lines = [`후보 목록(${date}): ${file}`, `- 범위: ${r.window.from} ~ ${r.window.to} (KST)`, `- 후보 ${r.candidates.length}건`];
  for (const [group, c] of Object.entries(r.counts)) lines.push(`  - ${group}: 받음 ${c.fetched}건, 범위 안 ${c.inWindow}건`);
  if (r.failures.length > 0) {
    lines.push("- 받지 못한 피드(웹 검색으로 계속한다):");
    for (const f of r.failures) lines.push(`  - ${f.feed}: ${f.reason} (${f.url})`);
  }
  return lines.join("\n");
}
