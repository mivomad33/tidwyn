// 9.97단계: 수요 흐름의 고정 목록(분야 S3, 갈래 S12, 근거 수준 S6, 날짜 상태 4.2-4)과 묶음의 출처 표시·공식 공개 페이지(S12).
// 사이트(site/)도 이 파일을 가져다 쓴다. 분야와 묶음 목록은 판정 문서(docs/demand-sources.md)의 표시 안 목록과 테스트가 대조한다.

/** 공식 묶음(9.96). '서로 다른 공식 소스'는 이 단위로 센다 */
export const OFFICIAL_GROUPS = ["assembly", "acrc", "ftc1372", "dart", "sec", "wikimedia"] as const;
export type OfficialGroup = (typeof OFFICIAL_GROUPS)[number];
/** 보조 묶음(9.95). 수준을 올리지 않고 '서로 다른 소스'에 세지 않는다 */
export const AUX_GROUPS = ["google", "mastodon"] as const;
export type AuxGroup = (typeof AUX_GROUPS)[number];

/** 묶음의 이름과 출처 표시(docs/demand-sources.md '뒤 단계가 지킬 조건') */
export const GROUP_INFO: Record<OfficialGroup | AuxGroup, { label: string; credit: string; url: string }> = {
  assembly: { label: "국회 청원", credit: "열린국회정보", url: "https://open.assembly.go.kr/portal/openapi/main.do" },
  acrc: { label: "권익위 민원", credit: "국민권익위원회", url: "https://www.data.go.kr/data/15074671/openapi.do" },
  ftc1372: { label: "1372 소비자상담", credit: "공정거래위원회", url: "https://www.data.go.kr/data/15127091/openapi.do" },
  dart: { label: "DART 공시", credit: "DART", url: "https://opendart.fss.or.kr/" },
  sec: { label: "SEC Form D", credit: "SEC EDGAR", url: "https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data" },
  wikimedia: { label: "Wikimedia 인기 문서", credit: "Wikimedia", url: "https://wikimedia.org/api/rest_v1/" },
  google: { label: "Google 급상승어", credit: "Google Trends", url: "https://trends.google.com/trending" },
  mastodon: { label: "Mastodon 트렌드", credit: "Mastodon", url: "https://joinmastodon.org/" },
};

/** 출처 칩 이름: 기관 이름과 소스 이름. 소스가 하나뿐인 묶음(소스 이름 없음)은 근거 줄이 묶음 이름이라, 묶음 이름이 기관 이름으로 시작하지 않으면 칩에도 붙여 둘을 잇는다 */
export function flowSourceName(group: OfficialGroup | AuxGroup, source: string): string {
  const { credit, label } = GROUP_INFO[group];
  const name = source || (label.startsWith(credit.split(" ")[0]!) ? "" : label);
  return name === "" ? credit : `${credit} ${name}`;
}

/** 소스마다의 공식 공개 페이지(S12). 외부인이 쓴 개별 글로는 걸지 않는다. 없으면 묶음의 주소 */
export const SOURCE_PAGES: Record<string, string> = {
  "acrc:qna": "https://www.data.go.kr/data/15074671/openapi.do",
  "acrc:proposal": "https://www.data.go.kr/data/15059423/openapi.do",
  "acrc:bigdata": "https://www.data.go.kr/data/15101903/openapi.do",
};

export function sourcePage(source: string, group: OfficialGroup): string {
  if (source.startsWith("wikimedia:")) return `https://${source.slice("wikimedia:".length)}.wikipedia.org/`;
  return SOURCE_PAGES[source] ?? GROUP_INFO[group].url;
}

/** 갈래(S12)와 갈래에 속하는 묶음 */
export const FLOW_CATEGORIES = ["interest", "complaint", "money"] as const;
export type FlowCategory = (typeof FLOW_CATEGORIES)[number];
export const CATEGORY_LABELS: Record<FlowCategory, string> = { interest: "관심", complaint: "불만·요구", money: "돈의 흐름" };
export const CATEGORY_GROUPS: Record<FlowCategory, readonly OfficialGroup[]> = {
  interest: ["wikimedia", "assembly"],
  complaint: ["ftc1372", "acrc", "assembly"],
  money: ["dart", "sec"],
};

/** 고정 분야 목록(S3). id는 바꾸지 않는다(같은 흐름 판정과 9.99가 쓴다) */
export const FLOW_FIELDS = [
  { id: "housing", label: "주거·부동산" },
  { id: "finance", label: "금융·결제" },
  { id: "health", label: "의료·건강" },
  { id: "education", label: "교육·육아" },
  { id: "transport", label: "교통·자동차" },
  { id: "food", label: "식품·외식" },
  { id: "travel", label: "여행·레저" },
  { id: "jobs", label: "일자리·노동" },
  { id: "software", label: "AI·소프트웨어" },
  { id: "devices", label: "전자기기·통신" },
  { id: "entertainment", label: "게임·엔터" },
  { id: "media", label: "문화·미디어" },
  { id: "sports", label: "스포츠" },
  { id: "retail", label: "쇼핑·유통" },
  { id: "energy", label: "에너지·환경" },
  { id: "welfare", label: "복지·생활" },
  { id: "safety", label: "안전·재난" },
  { id: "public", label: "행정·공공서비스" },
  { id: "industry", label: "산업·제조" },
  { id: "investment", label: "투자·창업" },
  { id: "science", label: "과학·우주" },
] as const;
export const FIELD_IDS: readonly string[] = FLOW_FIELDS.map((f) => f.id);
export const fieldLabel = (id: string): string => FLOW_FIELDS.find((f) => f.id === id)?.label ?? id;

/** 근거 수준(S6). 순서가 강한 순이다 */
export const FLOW_LEVELS = ["strong", "medium", "weak"] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];
export const LEVEL_LABELS: Record<FlowLevel, string> = { strong: "강", medium: "중", weak: "약" };
export const LEVEL_MEANINGS: Record<FlowLevel, string> = {
  strong: "서로 다른 공식 소스 세 곳 이상에서 함께 올랐거나, 두 곳에서 여러 단위가 며칠 이어 올랐다",
  medium: "서로 다른 공식 소스 두 곳에서 함께 올랐다",
  weak: "함께 올랐지만 한 곳의 규모가 작다",
};
export const levelRank = (l: FlowLevel): number => FLOW_LEVELS.indexOf(l);

/** 날짜 상태(용어 정의): 확인함(0건 포함), 받지 못함, 기준 부족, 꺼짐 */
export const FLOW_DATE_STATUSES = ["checked", "failed", "short", "off"] as const;
export type FlowDateStatus = (typeof FLOW_DATE_STATUSES)[number];
export const FLOW_STATUS_NAMES: Record<FlowDateStatus, string> = { checked: "확인함", failed: "받지 못함", short: "기준 부족", off: "꺼짐" };

/** 날짜 안의 항목 키(`demand-<순서>`). 정정, 읽음, 주소의 `#`가 쓴다. 사이트도 이 규칙을 쓴다 */
export const FLOW_KEY_PREFIX = "demand-";
export const flowItemKey = (position: number): string => `${FLOW_KEY_PREFIX}${position}`;
export const isFlowItemKey = (v: unknown): v is string => typeof v === "string" && /^demand-[1-9]\d*$/.test(v);
/** 항목 키의 순서. 키가 맞는지는 isFlowItemKey로 먼저 본다 */
export const flowKeyPosition = (key: string): number => Number(key.slice(FLOW_KEY_PREFIX.length));

/** 비교 창(S5): 최근 7일과 그 앞 28일 */
export const RECENT_DAYS = 7;
export const BASE_DAYS = 28;

/** 후보 복사본(candidates: 기계가 다시 읽는 원본, list: 격리 프로세스가 읽는 목록)과 흐름 파일(flows)의 이름. 작업 폴더에 둔다 */
export const FLOW_WORK_NAMES = { candidates: "demand.flow.json", list: "demand.flow.md", flows: "demand.flow.items.json" } as const;

/** 한 날에 싣는 최대 건수(D16)와 격리 프로세스가 쓸 수 있는 최대 건수(4.2-1) */
export const FLOW_MAX_SHOWN = 3;
export const FLOW_MAX_WRITTEN = 6;
/** 같은 흐름을 보는 날 수(S8): 대상 날짜를 1일째로 셀 때 14일째까지의 앞 날짜 */
export const SAME_FLOW_DAYS = 14;
/** 칸 상한(S12) */
export const FLOW_LIMITS = { title: 60, summary: 200, reason: 100 } as const;
export type FlowTextField = keyof typeof FLOW_LIMITS;
export const FLOW_TEXT_FIELDS = Object.keys(FLOW_LIMITS) as FlowTextField[];
export const FLOW_TEXT_LABELS: Record<FlowTextField, string> = { title: "제목", summary: "요지", reason: "잇는 이유" };

/** 탭 머리와 소개의 고정 문구(S7) */
export const FLOW_CAVEAT = "관심과 불만의 크기를 보인 것이며 원인이나 사업성을 뜻하지 않는다.";
/** 소스를 잇는 것이 AI 판단이라는 표시(S2) */
const FLOW_AI_NOTE_HEAD = "소스를 잇는 것은 AI 판단이다.";
export const FLOW_AI_NOTE = `${FLOW_AI_NOTE_HEAD} 숫자는 기계가 공식 소스에서 센 값이다.`;
/** 커뮤니티 근거가 있는 흐름의 같은 표시: 숫자에 커뮤니티 검색 건수도 든다 */
export const FLOW_AI_NOTE_COMMUNITY = `${FLOW_AI_NOTE_HEAD} 숫자는 기계가 공식 소스와 커뮤니티 검색에서 센 값이다.`;

// ---- 9.98단계: 커뮤니티 근거(S1, S5, S7) ----

/** 커뮤니티 묶음(9.98). 공식 묶음이 아니고 갈래(S12)에 속하지 않는다. 묶음마다 소스가 하나다 */
export const COMMUNITY_GROUPS = ["github", "bluesky"] as const;
export type CommunityGroup = (typeof COMMUNITY_GROUPS)[number];
export const isCommunityGroup = (g: unknown): g is CommunityGroup => (COMMUNITY_GROUPS as readonly unknown[]).includes(g);

/**
 * 커뮤니티 묶음의 소스 이름, 출처 표시, 고정 공식 주소(검색어를 넣지 않는다, 4.5-1), 표본 설명(S5).
 * 소스 이름과 표본 설명 문구는 이 한 곳에 두고, 소스 목록(src/demandSources.ts)과 사이트, 판정 문서가 이 값을 쓴다
 */
export const COMMUNITY_INFO: Record<CommunityGroup, { label: string; credit: string; url: string; sample: string }> = {
  github: { label: "GitHub Issues", credit: "GitHub", url: "https://docs.github.com/en/rest/search/search#search-issues-and-pull-requests", sample: "공개 저장소 이슈, 개발자·영어 중심" },
  bluesky: { label: "Bluesky", credit: "Bluesky", url: "https://docs.bsky.app/docs/api/app-bsky-feed-search-posts", sample: "검색 건수, 영어·초기 사용자 중심" },
};

/** 커뮤니티 확인 흐름(S1): 오른 공식 묶음이 정확히 하나이고 커뮤니티 근거가 있다 */
export const isCommunityConfirmed = (units: readonly { group: string }[], community: readonly { group: CommunityGroup }[]): boolean => new Set(units.map((u) => u.group)).size === 1 && community.length > 0;

/** 커뮤니티 확인 흐름(공식 묶음 하나 + 커뮤니티)의 근거 수준 뜻(S5). '중'이 최고다(S1) */
export const COMMUNITY_LEVEL_MEANINGS: Record<Exclude<FlowLevel, "strong">, string> = {
  medium: "공식 소스 한 곳에서 오르고 커뮤니티 검색에서도 늘었다",
  weak: "공식 소스 한 곳과 커뮤니티 검색에서 함께 늘었지만 한 곳의 규모가 작다",
};

/** 꺾임 표시(S7) */
export const FLOW_TURNING_TEXT = "최근 며칠은 줄고 있다";

/** 그날 비교에 넣지 못한 커뮤니티 소스의 사유(4.4-2). 그 대상 날짜의 기록이 없는 소스는 넣지 않는다(9.97과 같은 날짜 상태, 4.3-5) */
export const COMMUNITY_MISSING_REASONS = ["off", "robots", "blocked", "failed"] as const;
export type CommunityMissingReason = (typeof COMMUNITY_MISSING_REASONS)[number];
export const COMMUNITY_MISSING_NAMES: Record<CommunityMissingReason, string> = { off: "꺼짐", robots: "robots 막힘", blocked: "막힘", failed: "받지 못함" };
/** 소개에 쓰는 사유의 뜻 */
export const COMMUNITY_MISSING_MEANINGS: Record<CommunityMissingReason, string> = { off: "설정에서 끔", robots: "사이트가 자동 수집을 막음", blocked: "인증이나 권한 거절로 막힘", failed: "요청이 실패함" };

/** 공식 소스 하나의 비교 상태(9.97). 사이트의 소개도 이 이름을 쓴다 */
export type SourceState = "ok" | "unfetched" | "absent" | "stale" | "short" | "nodata" | "off";
export const SOURCE_STATE_NAMES: Record<SourceState, string> = { ok: "비교함", unfetched: "받지 못한 날 있음", absent: "자료 없음 날 많음", stale: "오래됨", short: "기록 부족", nodata: "기록 없음", off: "꺼짐" };
/** 비교에 넣지 못한 커뮤니티 소스 하나의 표시 글: '소스 이름(사유)' */
export const communityMissingText = (m: { group: CommunityGroup; reason: CommunityMissingReason }): string => `${COMMUNITY_INFO[m.group].label}(${COMMUNITY_MISSING_NAMES[m.reason]})`;
