// 수집기용 파일: robots.txt, sitemap.xml, rss.xml(4.3, 4.5). 사이트 빌드가 쓰고 테스트가 지어낸 입력으로 본다.
import { ROBOTS_DISALLOW, SITEMAP_FILE } from "../src/publicSite.ts";
import { DEFAULT_DESCRIPTION, absoluteUrl } from "./head.ts";
import { SITE_NAME, fullKoreanDate } from "./src/lib/format.ts";
import { RSS_PATH, briefPath } from "./src/lib/routes.ts";

export const RSS_FILE = RSS_PATH.slice(1);
/** RSS에 싣는 날짜 수(R6) */
export const RSS_DAYS = 30;
/** 사이트맵 프로토콜 한도: 파일 하나에 5만 개, 50MB */
export const SITEMAP_MAX_URLS = 50_000;
export const SITEMAP_MAX_BYTES = 50 * 1024 * 1024;

/** 다음 소유 확인 주석 줄(`#DaumWebMasterTool:...`)을 더하는 곳(`/register-search`) */
export const ROBOTS_EXTRA_LINES: readonly string[] = [];

export function robotsTxt(extra: readonly string[] = ROBOTS_EXTRA_LINES): string {
  return ["User-agent: *", "Allow: /", `Disallow: ${ROBOTS_DISALLOW}`, "", `Sitemap: ${absoluteUrl(`/${SITEMAP_FILE}`)}`, ...extra, ""].join("\n");
}

export function xmlEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export interface SitemapEntry {
  path: string;
  lastmod: string | null;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8"?>\n';
const SITEMAP_NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

function urlLine(e: SitemapEntry): string {
  const lastmod = e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : "";
  return `<url><loc>${xmlEscape(absoluteUrl(e.path))}</loc>${lastmod}</url>\n`;
}

function urlset(lines: string[]): string {
  return `${XML_HEAD}<urlset ${SITEMAP_NS}>\n${lines.join("")}</urlset>\n`;
}

/** 사이트맵 파일들: 파일 이름 → 내용. 한도를 넘으면 sitemap.xml을 색인으로 두고 sitemap-<번호>.xml로 나눈다 */
export function buildSitemaps(entries: readonly SitemapEntry[], maxUrls = SITEMAP_MAX_URLS, maxBytes = SITEMAP_MAX_BYTES): Map<string, string> {
  const room = maxBytes - Buffer.byteLength(urlset([]));
  const parts: string[][] = [[]];
  let bytes = 0;
  for (const e of entries) {
    const line = urlLine(e);
    const size = Buffer.byteLength(line);
    if (parts.at(-1)!.length >= maxUrls || bytes + size > room) {
      parts.push([]);
      bytes = 0;
    }
    parts.at(-1)!.push(line);
    bytes += size;
  }
  if (parts.length === 1) return new Map([[SITEMAP_FILE, urlset(parts[0]!)]]);
  const out = new Map<string, string>();
  parts.forEach((lines, i) => out.set(`sitemap-${i + 1}.xml`, urlset(lines)));
  const index = [...out.keys()].map((name) => `<sitemap><loc>${xmlEscape(absoluteUrl(`/${name}`))}</loc></sitemap>\n`).join("");
  out.set(SITEMAP_FILE, `${XML_HEAD}<sitemapindex ${SITEMAP_NS}>\n${index}</sitemapindex>\n`);
  return out;
}

export interface RssDay {
  date: string;
  /** 주요 뉴스 제목 */
  titles: string[];
}

function rssDate(date: string): string {
  return new Date(`${date}T00:00:00+09:00`).toUTCString();
}

function rssItem(day: RssDay): string {
  const url = xmlEscape(absoluteUrl(briefPath(day.date)));
  // description은 RSS 리더가 HTML로 읽으므로 제목을 한 번, XML에 넣으며 한 번 더 이스케이프한다
  const list = `<ul>${day.titles.map((t) => `<li>${xmlEscape(t)}</li>`).join("")}</ul>`;
  return [`<item>`, `<title>${fullKoreanDate(day.date)} 브리프</title>`, `<link>${url}</link>`, `<guid isPermaLink="true">${url}</guid>`, `<pubDate>${rssDate(day.date)}</pubDate>`, `<description>${xmlEscape(list)}</description>`, `</item>`].join("");
}

/** RSS 2.0(R6). days는 최근 순이다. 본문을 넣지 않고 날짜마다 항목 하나다 */
export function buildRss(days: readonly RssDay[]): string {
  const items = days.slice(0, RSS_DAYS);
  const channel = [
    `<title>${SITE_NAME}</title>`,
    `<link>${absoluteUrl("/")}</link>`,
    `<description>${DEFAULT_DESCRIPTION}</description>`,
    `<language>ko</language>`,
    `<atom:link href="${absoluteUrl(RSS_PATH)}" rel="self" type="application/rss+xml" />`,
    items.length > 0 ? `<lastBuildDate>${rssDate(items[0]!.date)}</lastBuildDate>` : "",
    ...items.map(rssItem),
  ].filter(Boolean);
  return `${XML_HEAD}<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n${channel.join("\n")}\n</channel>\n</rss>\n`;
}
