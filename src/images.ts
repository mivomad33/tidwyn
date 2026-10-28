import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import type { Brief } from "./brief.ts";
import { officialFeedSpecs, parseRss, type FeedFailure, type FeedReport, type FetchText } from "./feeds.ts";
import { inTransaction } from "./issues.ts";

// 원문 이미지 주소(3단계 4.4, P3). 공식 RSS(연합뉴스, BBC)의 미디어 태그 이미지 주소만 쓴다.
// 출처의 원문 주소가 공식 RSS 항목의 링크와 같을 때만 넣는다. 구글 뉴스 중간 주소는 비교하지 않는다(1.5단계 주소 규칙).

/** 비교할 때 뺄 추적용 질의 값 */
const TRACKING_PARAMS = new Set(["input", "ref", "fbclid", "gclid", "ocid", "cmpid"]);
const TRACKING_PREFIXES = ["utm_", "at_"];
/** 같은 매체의 다른 주소 이름 */
const HOST_ALIASES: Record<string, string> = { "bbc.co.uk": "bbc.com" };

function isGoogleNews(host: string): boolean {
  return host === "news.google.com" || host.endsWith(".news.google.com");
}

/**
 * 원문 주소 비교용 정규화. http/https, `www.`·`m.`, 끝의 `/`, `#` 뒤, 추적용 질의 값(utm_*, at_* 등)을 무시하고
 * 남은 질의 값은 이름 순으로 둔다. http/https가 아니거나 구글 뉴스 주소면 null(비교하지 않는다).
 */
export function normalizeArticleUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  let host = u.hostname.toLowerCase();
  if (isGoogleNews(host)) return null;
  host = host.replace(/^(www|m)\./, "");
  host = HOST_ALIASES[host] ?? host;
  const params = [...u.searchParams.entries()]
    .filter(([k]) => {
      const key = k.toLowerCase();
      return !TRACKING_PARAMS.has(key) && !TRACKING_PREFIXES.some((p) => key.startsWith(p));
    })
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
  const pathname = u.pathname.replace(/\/+$/, "");
  return `${host}${pathname}${query}`;
}

/** 원문 주소(정규화) → 이미지 주소. 같은 주소가 여러 번 나오면 처음 것 */
export type ImageIndex = Map<string, string>;

function addToIndex(index: ImageIndex, link: string, imageUrl: string | undefined): void {
  if (!imageUrl) return;
  const key = normalizeArticleUrl(link);
  if (key !== null && !index.has(key)) index.set(key, imageUrl);
}

/** 후보 목록(JSON)에서 공식 피드 항목(중간 주소가 아닌 것)의 이미지 주소만 모은다 */
export function imageIndexFromCandidates(report: Pick<FeedReport, "candidates">): ImageIndex {
  const index: ImageIndex = new Map();
  for (const c of report.candidates) if (!c.redirectLink) addToIndex(index, c.link, c.imageUrl);
  return index;
}

/** 대상일의 후보 목록 파일을 읽어 이미지 색인을 만든다. 파일이 없거나 읽지 못하면 빈 색인 */
export function readCandidateImages(file: string): ImageIndex {
  if (!fs.existsSync(file)) return new Map();
  try {
    return imageIndexFromCandidates(JSON.parse(fs.readFileSync(file, "utf8")) as FeedReport);
  } catch {
    return new Map();
  }
}

/** 브리프 출처의 imageUrl을 모두 지운다(작업 파일의 값은 쓰지 않는다, 4.4-1) */
export function dropImages(brief: Brief): void {
  for (const sec of brief.sections) for (const x of [...sec.topStories, ...sec.shortNews]) for (const s of x.sources) delete s.imageUrl;
}

/** 원문 주소가 색인에 있는 출처에 이미지 주소를 넣는다. 넣은 출처 수 */
export function attachImages(brief: Brief, index: ImageIndex): number {
  let n = 0;
  for (const sec of brief.sections) {
    for (const x of [...sec.topStories, ...sec.shortNews]) {
      for (const s of x.sources) {
        const key = normalizeArticleUrl(s.url);
        const image = key === null ? undefined : index.get(key);
        if (image === undefined) continue;
        s.imageUrl = image;
        n++;
      }
    }
  }
  return n;
}

export interface FillResult {
  filled: number;
  failures: FeedFailure[];
}

/**
 * 지난 날짜 이미지 채우기(4.4-2). 공식 RSS를 다시 받아, 이미지 주소가 없는 저장된 출처 중 원문 주소가 지금 피드 항목과 같은 것만 채운다.
 * 이미지 주소 말고는 바꾸지 않고, 이미 있는 이미지 주소는 그대로 둔다. 받지 못한 피드는 failures에 남기고 나머지는 계속한다.
 */
export async function fillImages(db: DatabaseSync, fetchText: FetchText): Promise<FillResult> {
  const index: ImageIndex = new Map();
  const failures: FeedFailure[] = [];
  for (const spec of officialFeedSpecs()) {
    try {
      const res = await fetchText(spec.url);
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      for (const item of parseRss(res.text)) addToIndex(index, item.link, item.imageUrl);
    } catch (e) {
      const err = e as Error;
      failures.push({ feed: spec.group, url: spec.url, reason: err.name === "TimeoutError" ? "시간 초과" : err.message });
    }
  }
  if (index.size === 0) return { filled: 0, failures };
  const rows = db.prepare("SELECT id, url FROM sources WHERE image_url IS NULL ORDER BY id").all() as { id: number; url: string }[];
  const update = db.prepare("UPDATE sources SET image_url = ? WHERE id = ? AND image_url IS NULL");
  const filled = inTransaction(db, () => {
    let n = 0;
    for (const r of rows) {
      const key = normalizeArticleUrl(r.url);
      const image = key === null ? undefined : index.get(key);
      if (image !== undefined) n += Number(update.run(image, r.id).changes);
    }
    return n;
  });
  return { filled, failures };
}
