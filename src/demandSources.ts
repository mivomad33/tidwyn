// 9.95단계 4.1-5, 4.2-1: 수요 소스 목록과 끄기 값을 이 파일 한 곳에 둔다. 판정 근거는 DEMAND_DOC이다.
// 소스를 끄려면 아래 두 목록에 넣고 판정 문서 표에 '끔'(날짜, 이유)을 적는다. 끈 소스는 목록에서 지우지 않는다.
// 끈 소스는 호출하지 않고 상태는 꺼짐이며, 쌓인 스냅샷은 그대로 둔다.
import { COMMUNITY_GROUPS, COMMUNITY_INFO, type CommunityGroup } from "./demandFlowTypes.ts";

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
  // 9.96단계 공식 소스 묶음(명세서 2.2). '서로 다른 공식 소스'는 이 묶음 단위로 센다
  { id: "assembly", label: "국회 청원" },
  { id: "acrc", label: "권익위 민원" },
  { id: "ftc1372", label: "1372 소비자상담" },
  { id: "dart", label: "DART 공시" },
  { id: "sec", label: "SEC Form D" },
  { id: "wikimedia", label: "Wikimedia 인기 문서" },
  // 9.98단계 커뮤니티 소스 묶음(명세서 S2). 공식 묶음이 아니고 갈래에 속하지 않는다
  ...COMMUNITY_GROUPS.map((id) => ({ id, label: COMMUNITY_INFO[id].label })),
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

export function isDemandOff(s: Pick<DemandSource, "id" | "group">, off: DemandOff): boolean {
  return off.groups.includes(s.group) || off.sources.includes(s.id);
}

// 9.96단계 4.1-1, 4.2: 공식 기관·공개 데이터 소스. 9.95의 demand-fetch(14-1)는 받지 않고 demand-official만 받는다.
// 끄기는 위의 같은 두 목록(DEMAND_GROUPS_OFF, DEMAND_SOURCES_OFF)으로 한다.

/** 9.96 공식 소스의 받는 방법. officialDemand.ts의 받는 함수와 짝이다 */
export type OfficialKind = "assembly" | "acrc-qna" | "acrc-proposal" | "acrc-bigdata" | "ftc-1372" | "dart" | "sec-formd" | "wikimedia";

/** 공식 소스가 쓰는 키 이름(src/keys.ts의 KEY_NAMES 안) */
export type OfficialKey = "ASSEMBLY_API_KEY" | "DATA_GO_KR_KEY" | "DART_API_KEY";

export interface OfficialSource {
  id: string;
  group: string;
  kind: OfficialKind;
  label: string;
  host: string;
  /** robots로 판정할 경로 */
  paths: readonly string[];
  key: OfficialKey | null;
  /** 키 거부가 멈추는 범위. 공공데이터포털은 활용신청이 서비스(데이터 번호)마다 따로다(4.2-4) */
  keyScope: string | null;
  /** 하루 호출 한도(4.2-4). 없으면 null */
  dailyLimit: number | null;
  /** 연락처가 든 User-Agent를 쓰는지(S9) */
  publicAgent: boolean;
  /** 국회: 목록 서비스 이름과 고정 쿼리 */
  service?: string;
  query?: Readonly<Record<string, string>>;
}

/** 지난 기간 채우기 시작일(S2) */
export const OFFICIAL_START = "2026-09-30";
/** 1372 시작 달(S6) */
export const FTC1372_START = "2026-09";
/** Wikimedia 위키(S5) */
export const WIKIMEDIA_WIKIS: readonly string[] = ["en", "ja", "de", "es", "fr", "ru", "zh", "it", "pt", "ko"];

export const ASSEMBLY_HOST = "open.assembly.go.kr";
export const DATA_GO_KR_HOST = "apis.data.go.kr";
export const DART_HOST = "opendart.fss.or.kr";
export const SEC_HOST = "www.sec.gov";
export const WIKIMEDIA_HOST = "wikimedia.org";

export const ACRC_QNA_PATH = "/1140100/CivilPolicyQnaService";
export const ACRC_PROPOSAL_PATH = "/1140100/OpenProposalService2";
export const ACRC_BIGDATA_PATH = "/1140100/minAnalsInfoView5/minTodayTopicInfo5";
export const FTC1372_PATH = "/1130000/CcnDscsnDetailSttus_2Service/getDscsnDetailSttus_2";
export const DART_LIST_PATH = "/api/list.json";
export const SEC_INDEX_PATH = "/Archives/edgar/daily-index/";
export const SEC_DATA_PATH = "/Archives/edgar/data/";
export const WIKIMEDIA_TOP_PATH = "/api/rest_v1/metrics/pageviews/top/";

const ASSEMBLY_LISTS: readonly { id: string; label: string; service: string; query: Record<string, string> }[] = [
  { id: "assembly:received", label: "국민동의청원 접수목록(22대)", service: "PTTRCP", query: { ERACO: "제22대" } },
  { id: "assembly:pending", label: "청원 계류현황", service: "nvqbafvaajdiqhehi", query: {} },
  { id: "assembly:processed", label: "청원 처리현황(22대)", service: "ncryefyuaflxnqbqo", query: { AGE: "22" } },
];

export function officialSources(): OfficialSource[] {
  const base = { publicAgent: false } as const;
  return [
    ...ASSEMBLY_LISTS.map((l): OfficialSource => ({ ...base, id: l.id, group: "assembly", kind: "assembly", label: l.label, host: ASSEMBLY_HOST, paths: [`/portal/openapi/${l.service}`], key: "ASSEMBLY_API_KEY", keyScope: "ASSEMBLY_API_KEY", dailyLimit: null, service: l.service, query: l.query })),
    { ...base, id: "acrc:qna", group: "acrc", kind: "acrc-qna", label: "민원정책 질의응답", host: DATA_GO_KR_HOST, paths: [`${ACRC_QNA_PATH}/PolicyQnaList`, `${ACRC_QNA_PATH}/PolicyQnaItem`], key: "DATA_GO_KR_KEY", keyScope: "DATA_GO_KR_KEY:15074671", dailyLimit: 10_000 },
    { ...base, id: "acrc:proposal", group: "acrc", kind: "acrc-proposal", label: "공개제안", host: DATA_GO_KR_HOST, paths: [`${ACRC_PROPOSAL_PATH}/OpenProposalList`, `${ACRC_PROPOSAL_PATH}/OpenProposalItem`], key: "DATA_GO_KR_KEY", keyScope: "DATA_GO_KR_KEY:15059423", dailyLimit: 10_000 },
    { ...base, id: "acrc:bigdata", group: "acrc", kind: "acrc-bigdata", label: "민원빅데이터 오늘의 이슈", host: DATA_GO_KR_HOST, paths: [ACRC_BIGDATA_PATH], key: "DATA_GO_KR_KEY", keyScope: "DATA_GO_KR_KEY:15101903", dailyLimit: 100 },
    { ...base, id: "ftc1372:consult", group: "ftc1372", kind: "ftc-1372", label: "1372 소비자상담 접수", host: DATA_GO_KR_HOST, paths: [FTC1372_PATH], key: "DATA_GO_KR_KEY", keyScope: "DATA_GO_KR_KEY:15127091", dailyLimit: 10_000 },
    { ...base, id: "dart:list", group: "dart", kind: "dart", label: "공시검색 목록", host: DART_HOST, paths: [DART_LIST_PATH], key: "DART_API_KEY", keyScope: "DART_API_KEY", dailyLimit: 20_000 },
    { id: "sec:formd", group: "sec", kind: "sec-formd", label: "EDGAR Form D", host: SEC_HOST, paths: [SEC_INDEX_PATH, SEC_DATA_PATH], key: null, keyScope: null, dailyLimit: null, publicAgent: true },
    ...WIKIMEDIA_WIKIS.map((w): OfficialSource => ({ id: `wikimedia:${w}`, group: "wikimedia", kind: "wikimedia", label: `${w}.wikipedia`, host: WIKIMEDIA_HOST, paths: [`${WIKIMEDIA_TOP_PATH}${w}.wikipedia/all-access/`], key: null, keyScope: null, dailyLimit: null, publicAgent: true })),
  ];
}

// 9.98단계 4.1-1(S2, S5): 커뮤니티 소스. 공식 소스에서 오른 단위의 이름을 검색어로 두 창의 건수만 센다(글은 받는 자리에서 버린다).
// 끄기는 위의 같은 두 목록(DEMAND_GROUPS_OFF, DEMAND_SOURCES_OFF)으로 한다. 판정 근거는 9.98 명세서 폴더의 source-terms.md다.

export type CommunityKind = "github-issues" | "bluesky-posts";

export interface CommunitySource {
  id: string;
  group: CommunityGroup;
  kind: CommunityKind;
  /** 요약과 근거 줄의 소스 이름 */
  label: string;
  host: string;
  /** 검색 경로. robots 판정도 이 경로로 한다 */
  path: string;
}

export const GITHUB_API_HOST = "api.github.com";
export const GITHUB_ISSUES_PATH = "/search/issues";
/** Bluesky는 이 호스트의 표준 경로만 쓴다(S2: 다른 주소·대소문자 바꾸기·둘째 쪽 우회를 하지 않는다) */
export const BLUESKY_API_HOST = "api.bsky.app";
export const BLUESKY_SEARCH_PATH = "/xrpc/app.bsky.feed.searchPosts";

export function communitySources(): CommunitySource[] {
  return [
    { id: "github:issues", group: "github", kind: "github-issues", label: COMMUNITY_INFO.github.label, host: GITHUB_API_HOST, path: GITHUB_ISSUES_PATH },
    { id: "bluesky:posts", group: "bluesky", kind: "bluesky-posts", label: COMMUNITY_INFO.bluesky.label, host: BLUESKY_API_HOST, path: BLUESKY_SEARCH_PATH },
  ];
}

/** 9.95, 9.96, 9.98 소스 전부(끄기 값 대조에 쓴다) */
export function allDemandSourceIds(): string[] {
  return [...demandSources().map((s) => s.id), ...officialSources().map((s) => s.id), ...communitySources().map((s) => s.id)];
}
