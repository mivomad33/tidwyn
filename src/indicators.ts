// 6단계 4.1-1: 지표 정의. 식별자는 주소와 DB에 쓰고 바꾸지 않는다. 출처 코드는 2026-10-29 출처의 코드 목록 API로 확인했다(명세서 6장).

export type IndicatorGroup = "한국" | "미국·국제";
export type IndicatorFreq = "day" | "month";
/** 전날 대비 표시: 값의 차이(단위 그대로), 퍼센트 변화, 퍼센트포인트 */
export type ChangeKind = "abs" | "pct" | "pp";

export type IndicatorSource = { kind: "ecos"; table: string; cycle: "D" | "M"; item: string } | { kind: "fred"; series: string };

export interface IndicatorDef {
  id: string;
  name: string;
  /** 지표 판단 후보 목록에 쓰는 한 줄 설명 */
  description: string;
  group: IndicatorGroup;
  /** 화면에 붙이는 단위(물가는 상승률이라 %) */
  unit: string;
  freq: IndicatorFreq;
  source: IndicatorSource;
  /** 소수 자리 */
  decimals: number;
  change: ChangeKind;
  /** 저장한 지수 대신 전년 동월 대비 상승률로 보인다(X9-③) */
  yoy: boolean;
  /** 출처 표시 문구(4.7-6) */
  credit: string;
  /** 공개 백업에 값을 넣는지(X3: 코스피·코스닥은 넣지 않는다) */
  backup: boolean;
  /** 사이트 공개(4.7-8). 끄면 다음 빌드부터 사이트 어디에도 없다 */
  public: boolean;
}

const ECOS = "자료: 한국은행 ECOS";

export const INDICATORS: readonly IndicatorDef[] = [
  {
    id: "usdkrw",
    name: "원/달러 환율",
    description: "1달러에 몇 원인지(서울 외환시장 종가 15:30). 오르면 원화 약세",
    group: "한국",
    unit: "원",
    freq: "day",
    source: { kind: "ecos", table: "731Y003", cycle: "D", item: "0000003" },
    decimals: 1,
    change: "abs",
    yoy: false,
    credit: `${ECOS}(작성기관: 한국은행)`,
    backup: true,
    public: true,
  },
  {
    id: "kospi",
    name: "코스피",
    description: "한국 유가증권시장 대표 주가지수",
    group: "한국",
    unit: "",
    freq: "day",
    source: { kind: "ecos", table: "802Y001", cycle: "D", item: "0001000" },
    decimals: 2,
    change: "pct",
    yoy: false,
    credit: `${ECOS}(작성기관: 한국거래소)`,
    backup: false,
    public: true,
  },
  {
    id: "kosdaq",
    name: "코스닥",
    description: "한국 코스닥시장 주가지수(기술·성장 기업 중심)",
    group: "한국",
    unit: "",
    freq: "day",
    source: { kind: "ecos", table: "802Y001", cycle: "D", item: "0089000" },
    decimals: 2,
    change: "pct",
    yoy: false,
    credit: `${ECOS}(작성기관: 한국거래소)`,
    backup: false,
    public: true,
  },
  {
    id: "krbase",
    name: "한국 기준금리",
    description: "한국은행 기준금리(금융통화위원회가 정한다)",
    group: "한국",
    unit: "%",
    freq: "day",
    source: { kind: "ecos", table: "722Y001", cycle: "D", item: "0101000" },
    decimals: 2,
    change: "pp",
    yoy: false,
    credit: `${ECOS}(작성기관: 한국은행)`,
    backup: true,
    public: true,
  },
  {
    id: "kr3y",
    name: "국고채 3년 금리",
    description: "한국 정부가 3년 만기로 빌리는 금리(시장금리)",
    group: "한국",
    unit: "%",
    freq: "day",
    source: { kind: "ecos", table: "817Y002", cycle: "D", item: "010200000" },
    decimals: 3,
    change: "pp",
    yoy: false,
    credit: `${ECOS}(작성기관: 한국은행)`,
    backup: true,
    public: true,
  },
  {
    id: "krcpi",
    name: "한국 소비자물가",
    description: "소비자물가지수의 전년 같은 달 대비 상승률(월)",
    group: "한국",
    unit: "%",
    freq: "month",
    source: { kind: "ecos", table: "901Y009", cycle: "M", item: "0" },
    decimals: 1,
    change: "pp",
    yoy: true,
    credit: `${ECOS}(작성기관: 국가데이터처)`,
    backup: true,
    public: true,
  },
  {
    id: "usfed",
    name: "미국 기준금리",
    description: "미국 연준의 기준금리 목표 범위 상단",
    group: "미국·국제",
    unit: "%",
    freq: "day",
    source: { kind: "fred", series: "DFEDTARU" },
    decimals: 2,
    change: "pp",
    yoy: false,
    credit: "미국 연방준비제도이사회 via FRED",
    backup: true,
    public: true,
  },
  {
    id: "us10y",
    name: "미국채 10년 금리",
    description: "미국 정부가 10년 만기로 빌리는 금리(시장금리)",
    group: "미국·국제",
    unit: "%",
    freq: "day",
    source: { kind: "fred", series: "DGS10" },
    decimals: 2,
    change: "pp",
    yoy: false,
    credit: "미국 연방준비제도이사회 via FRED",
    backup: true,
    public: true,
  },
  {
    id: "wti",
    name: "WTI 유가",
    description: "미국 서부텍사스산 원유 가격(달러/배럴)",
    group: "미국·국제",
    unit: "달러",
    freq: "day",
    source: { kind: "fred", series: "DCOILWTICO" },
    decimals: 2,
    change: "pct",
    yoy: false,
    credit: "미국 에너지정보청 via FRED",
    backup: true,
    public: true,
  },
  {
    id: "brent",
    name: "브렌트유",
    description: "북해산 브렌트 원유 가격(달러/배럴)",
    group: "미국·국제",
    unit: "달러",
    freq: "day",
    source: { kind: "fred", series: "DCOILBRENTEU" },
    decimals: 2,
    change: "pct",
    yoy: false,
    credit: "미국 에너지정보청 via FRED",
    backup: true,
    public: true,
  },
  {
    id: "uscpi",
    name: "미국 소비자물가",
    description: "미국 소비자물가지수(CPI-U)의 전년 같은 달 대비 상승률(월)",
    group: "미국·국제",
    unit: "%",
    freq: "month",
    source: { kind: "fred", series: "CPIAUCNS" },
    decimals: 1,
    change: "pp",
    yoy: true,
    credit: "미국 노동통계국 via FRED",
    backup: true,
    public: true,
  },
  {
    id: "usdindex",
    name: "달러 지수",
    description: "여러 나라 통화에 대한 달러 가치(넓은 범위 지수). 오르면 달러 강세",
    group: "미국·국제",
    unit: "",
    freq: "day",
    source: { kind: "fred", series: "DTWEXBGS" },
    decimals: 2,
    change: "pct",
    yoy: false,
    credit: "미국 연방준비제도이사회 via FRED",
    backup: true,
    public: true,
  },
];

/** 일별 지표의 첫 받기 시작일(X5), 월별 지표의 받기 시작 달(상승률 계산에 1년 더 앞) */
export const DAILY_START = "2021-10-27";
export const MONTHLY_START = "2020-10";
/** 일별 지표를 다시 받는 날 수(X9-①) */
export const REFETCH_DAYS = 60;
/** 이슈 하나에 고르는 지표 수 상한(X4) */
export const MAX_ISSUE_INDICATORS = 3;
/** 브리프 위 칩의 앞 순서(4.7-1). 나머지는 정의 순서 */
export const CHIP_ORDER = ["usdkrw", "kospi", "us10y", "wti"];

const byId = new Map(INDICATORS.map((d) => [d.id, d]));

export function indicatorDef(id: string): IndicatorDef | undefined {
  return byId.get(id);
}

export function isIndicatorId(id: string): boolean {
  return byId.has(id);
}
