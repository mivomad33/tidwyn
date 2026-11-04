// 9.95단계 4.1-5, 4.2-1: 수요 소스 목록과 끄기 값을 이 파일 한 곳에 둔다. 판정 근거는 DEMAND_DOC이다.
// 소스를 끄려면 아래 두 목록에 넣고 판정 문서 표에 '끔'(날짜, 이유)을 적는다. 끈 소스는 목록에서 지우지 않는다.
// 끈 소스는 호출하지 않고 상태는 꺼짐이며, 쌓인 스냅샷은 그대로 둔다.

/** 소스 판정 문서(저장소 루트 기준). 9.96~9.98이 같은 문서에 소스를 더한다 */
export const DEMAND_DOC = "docs/demand-sources.md";

/** 끌 소스 묶음 */
export const DEMAND_GROUPS_OFF: readonly string[] = [];
/** 끌 소스 id(`google:KR`, `mastodon:uri.life` 꼴) */
export const DEMAND_SOURCES_OFF: readonly string[] = [];

/** 받는 방법. 9.96이 새 종류를 더하면 demandFetch.ts의 FETCHERS에도 더한다 */
export type DemandKind = "google-trends" | "mastodon-trends";

export interface DemandSource {
  /** DB와 실행 기록의 이름. 바꾸면 그 소스는 새 소스가 된다 */
  id: string;
  /** 묶음(끄기와 요약의 단위) */
  group: string;
  kind: DemandKind;
  /** 요약에 쓰는 이름(나라 코드, 인스턴스 이름) */
  label: string;
  host: string;
  /** robots로 판정할 경로(받는 주소의 경로와 쿼리) */
  paths: readonly string[];
}

export interface DemandGroup {
  id: string;
  label: string;
}

export const DEMAND_GROUPS: readonly DemandGroup[] = [
  { id: "google", label: "Google 급상승어" },
  { id: "mastodon", label: "Mastodon 트렌드" },
];

/** Google Trends 급상승 RSS의 나라(명세서 S2). 시험 실행에서 지원 안 함으로 뺀 나라는 판정 문서와 함께 고친다 */
export const GOOGLE_GEOS: readonly string[] = ["KR", "US", "JP", "TW", "HK", "IN", "ID", "VN", "TH", "PH", "MY", "SG", "AU", "CA", "GB", "DE", "FR", "IT", "ES", "NL", "PL", "TR", "RU", "UA", "BR", "MX", "AR", "SA", "NG", "ZA"];
export const GOOGLE_TRENDS_HOST = "trends.google.com";
export const GOOGLE_TRENDS_PATH = "/trending/rss";

/** Mastodon 인스턴스(2.2). 트렌드 태그와 링크를 받는다 */
export const MASTODON_INSTANCES: readonly string[] = [
  "uri.life",
  "qdon.space",
  "planet.moe",
  "mastodon.world",
  "fosstodon.org",
  "mastodon.uno",
  "troet.cafe",
  "piaille.fr",
  "mastodon.nl",
  "social.vivaldi.net",
  "sigmoid.social",
  "mastodon.gamedev.place",
];
export const MASTODON_TRENDS_PATH = "/api/v1/trends/";
export const MASTODON_PARTS = ["tags", "links"] as const;
/** Mastodon 트렌드 한 페이지와 종류마다의 상한 */
export const MASTODON_PAGE_SIZE = 20;
export const MASTODON_CAP = 100;

/** Mastodon 트렌드 한 페이지의 경로와 쿼리. 받는 주소와 robots 판정이 함께 쓴다 */
export function mastodonTrendsPath(part: (typeof MASTODON_PARTS)[number], offset: number): string {
  return `${MASTODON_TRENDS_PATH}${part}?limit=${MASTODON_PAGE_SIZE}&offset=${offset}`;
}

export function googleTrendsUrl(geo: string): string {
  return `https://${GOOGLE_TRENDS_HOST}${GOOGLE_TRENDS_PATH}?geo=${geo}`;
}

export function demandSources(): DemandSource[] {
  return [
    ...GOOGLE_GEOS.map((geo): DemandSource => ({ id: `google:${geo}`, group: "google", kind: "google-trends", label: geo, host: GOOGLE_TRENDS_HOST, paths: [`${GOOGLE_TRENDS_PATH}?geo=${geo}`] })),
    ...MASTODON_INSTANCES.map((host): DemandSource => ({ id: `mastodon:${host}`, group: "mastodon", kind: "mastodon-trends", label: host, host, paths: MASTODON_PARTS.flatMap((p) => Array.from({ length: MASTODON_CAP / MASTODON_PAGE_SIZE }, (_, i) => mastodonTrendsPath(p, i * MASTODON_PAGE_SIZE))) })),
  ];
}

export interface DemandOff {
  groups: readonly string[];
  sources: readonly string[];
}

export const DEFAULT_DEMAND_OFF: DemandOff = { groups: DEMAND_GROUPS_OFF, sources: DEMAND_SOURCES_OFF };

export function isDemandOff(s: DemandSource, off: DemandOff): boolean {
  return off.groups.includes(s.group) || off.sources.includes(s.id);
}
