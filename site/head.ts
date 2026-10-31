// 정적 HTML의 <head>(4.2). 페이지마다 다른 제목·설명·canonical·OG·구조화 데이터를 한곳에서 만든다.
import { SITE_NAME } from "./src/lib/format.ts";
import { SITE_URL } from "./src/lib/policy.ts";
import { RSS_PATH } from "./src/lib/routes.ts";
import { DARK, LIGHT } from "./src/lib/theme.ts";

/** 공유 이미지 파일과 크기(사이트 전체에 한 장, `docs/design.md`) */
export const SHARE_IMAGE = { path: "/share.png", width: 1200, height: 630 } as const;
export const DEFAULT_DESCRIPTION = "AI가 매일 모아 쉬운 말로 바꿔 쓴 한국·세계·IT·AI 뉴스 요약";
const IMAGE_ALT = `${SITE_NAME}. ${DEFAULT_DESCRIPTION}`;
export const DESCRIPTION_MAX = 160;

/** 검색엔진 소유 확인 메타 태그를 더하는 곳(`/register-search`가 이 목록에 값을 넣는다). 모든 페이지의 head에 들어간다 */
export const OWNER_VERIFICATION_META: readonly { name: string; content: string }[] = [];

export interface HeadInfo {
  title: string;
  description: string;
  /** 공개 주소 기준 경로. 없으면 canonical과 OG 주소를 넣지 않는다 */
  canonical?: string;
  noindex?: boolean;
  ogType?: "website" | "article";
  jsonLd?: object[];
}

export function esc(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/** 글에서 메타 설명을 만든다: 태그와 줄바꿈을 없애고 상한 안으로 자른다. 비면 기본 설명이다 */
export function metaDescription(text: string): string {
  const plain = text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (plain === "") return DEFAULT_DESCRIPTION;
  return plain.length <= DESCRIPTION_MAX ? plain : `${plain.slice(0, DESCRIPTION_MAX - 1).trimEnd()}…`;
}

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

/** 스크립트 태그 안에 넣는 JSON. `<`를 이스케이프해 글이 태그를 닫지 못하게 한다 */
export function jsonLdScript(data: object): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`;
}

function meta(attr: "name" | "property", key: string, value: string): string {
  return `<meta ${attr}="${key}" content="${esc(value)}" />`;
}

const ICONS = [
  '<link rel="icon" href="/icon.svg" type="image/svg+xml" />',
  '<link rel="icon" href="/icon-16.png" type="image/png" sizes="16x16" />',
  '<link rel="icon" href="/icon-32.png" type="image/png" sizes="32x32" />',
  '<link rel="icon" href="/icon-48.png" type="image/png" sizes="48x48" />',
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />',
];

export function renderHead(info: HeadInfo): string {
  const image = absoluteUrl(SHARE_IMAGE.path);
  const lines = [
    `<title>${esc(info.title)}</title>`,
    meta("name", "description", info.description),
    info.noindex ? meta("name", "robots", "noindex") : "",
    info.canonical ? `<link rel="canonical" href="${esc(absoluteUrl(info.canonical))}" />` : "",
    `<meta name="theme-color" media="(prefers-color-scheme: light)" content="${LIGHT.bg}" />`,
    `<meta name="theme-color" media="(prefers-color-scheme: dark)" content="${DARK.bg}" />`,
    ...ICONS,
    meta("name", "apple-mobile-web-app-title", SITE_NAME),
    `<link rel="alternate" type="application/rss+xml" title="${SITE_NAME}" href="${RSS_PATH}" />`,
    meta("property", "og:site_name", SITE_NAME),
    meta("property", "og:locale", "ko_KR"),
    meta("property", "og:type", info.ogType ?? "website"),
    meta("property", "og:title", info.title),
    meta("property", "og:description", info.description),
    info.canonical ? meta("property", "og:url", absoluteUrl(info.canonical)) : "",
    meta("property", "og:image", image),
    meta("property", "og:image:width", String(SHARE_IMAGE.width)),
    meta("property", "og:image:height", String(SHARE_IMAGE.height)),
    meta("property", "og:image:alt", IMAGE_ALT),
    meta("name", "twitter:card", "summary_large_image"),
    meta("name", "twitter:image:alt", IMAGE_ALT),
    ...OWNER_VERIFICATION_META.map((m) => meta("name", m.name, m.content)),
    ...(info.jsonLd ?? []).map(jsonLdScript),
  ];
  return lines.filter(Boolean).join("\n    ");
}

/** 구조화 데이터의 작성자: 사람인 체하지 않는다 */
const ORGANIZATION = { "@type": "Organization", name: SITE_NAME, url: `${SITE_URL}/` };

/** 저장 날짜(KST)를 ISO 8601로. 시간을 모르면 그날 0시(KST)로 둔다 */
function isoDate(date: string): string {
  return date.length === 10 ? `${date}T00:00:00+09:00` : date;
}

export function articleLd(opts: { path: string; headline: string; description: string; published: string | null; modified: string | null }): object {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: opts.headline,
    description: opts.description,
    url: absoluteUrl(opts.path),
    mainEntityOfPage: absoluteUrl(opts.path),
    image: absoluteUrl(SHARE_IMAGE.path),
    inLanguage: "ko",
    author: ORGANIZATION,
    publisher: ORGANIZATION,
    ...(opts.published ? { datePublished: isoDate(opts.published) } : {}),
    ...(opts.modified ? { dateModified: isoDate(opts.modified) } : {}),
  };
}

export function pageLd(type: "WebSite" | "WebPage" | "CollectionPage" | "AboutPage", opts: { path: string; name: string; description: string }): object {
  return { "@context": "https://schema.org", "@type": type, name: opts.name, description: opts.description, url: absoluteUrl(opts.path), inLanguage: "ko", publisher: ORGANIZATION };
}
