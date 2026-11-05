// 9.97단계: 지어낸 수요 흐름 사이트 데이터(로컬 화면 확인·테스트용, 4.6-4). 글과 숫자는 모두 가짜다. fixtures.ts가 부른다.
// 실제 빌드(src/demandSite.ts)와 같은 모양의 파일을 만든다. 최근 날짜부터 화면 상태를 하나씩 둔다:
// 3건(관련 이슈·보조 근거·자료 없음 날·상위 목록 소스·외부인 글 소스 포함), 확인함 0건, 기준 부족, 받지 못함, 빠진 묶음 안내, 이어짐, 정정됨, 긴 글,
// 이어짐의 원래 항목, 기록 없는 날, 꺼짐만 있는 날. 빌더·영상과 함께 만들면 가장 최근 날짜(3건)가 탭 일곱 개인 날이다.
import { GROUP_INFO, flowItemKey, flowSourceName, sourcePage, type FlowCategory, type FlowLevel, type OfficialGroup } from "../../src/demandFlowTypes.ts";
import { dayDemandOf, siteFiles, type DayDemand, type DemandMonth, type IssueRef, type SiteFlowItem, type SiteFlowUnit } from "../../src/siteTypes.ts";
import { addDays } from "./random.ts";

/** 날짜마다 화면 상태 하나를 둔 자리. 지어낸 날짜 수가 모자라면 null이다 */
export interface DemandFixtureInfo {
  three: string | null;
  zero: string | null;
  short: string | null;
  failed: string | null;
  missing: string | null;
  continues: string | null;
  corrected: string | null;
  long: string | null;
  origin: string | null;
  /** 흐름 기록이 없는 날 */
  noRecord: string | null;
  /** 꺼짐만 있는 날(탭 없음) */
  offOnly: string | null;
  /** 빌더·영상과 함께 만들었을 때 탭이 일곱 개인 날(3건인 날) */
  sevenTabs: string | null;
}

export interface DemandFixtures {
  byDate: Map<string, DayDemand>;
  months: DemandMonth[];
  info: DemandFixtureInfo;
}

type UnitInput = Partial<SiteFlowUnit> & { group: OfficialGroup };

/** 근거 줄 하나. 창 끝은 대상 날짜 전날, 기본은 자료 없음 날이 없는 7일·28일이다 */
function unit(date: string, x: UnitInput): SiteFlowUnit {
  const to = addDays(date, -1);
  return {
    source: "",
    name: null,
    recent: 120,
    base: 40,
    isNew: false,
    recentFrom: addDays(to, -6),
    recentTo: to,
    baseFrom: addDays(to, -34),
    baseTo: addDays(to, -7),
    recentDays: 7,
    baseDays: 28,
    unit: "건",
    ...x,
  };
}

const sourcesOf = (units: readonly SiteFlowUnit[], aux: readonly string[]) => {
  const out: { name: string; url: string }[] = [];
  const add = (name: string, url: string) => {
    if (!out.some((s) => s.url === url)) out.push({ name, url });
  };
  for (const u of units) add(flowSourceName(u.group, u.source), sourcePage(u.source.endsWith(".wikipedia") ? `wikimedia:${u.source.slice(0, -".wikipedia".length)}` : u.group, u.group));
  if (aux.some((a) => a.startsWith("Google Trends "))) add("Google Trends", GROUP_INFO.google.url);
  if (aux.some((a) => a.startsWith("Mastodon "))) add("Mastodon", GROUP_INFO.mastodon.url);
  return out;
};

interface ItemInput {
  category: FlowCategory;
  field: string;
  title: string;
  level: FlowLevel;
  units: SiteFlowUnit[];
  summary?: string;
  reason?: string;
  aux?: string[];
  continues?: { date: string; key: string } | null;
  issue?: IssueRef | null;
  corrections?: SiteFlowItem["corrections"];
}

function item(position: number, x: ItemInput): SiteFlowItem {
  const aux = x.aux ?? [];
  const out: SiteFlowItem = {
    key: flowItemKey(position),
    category: x.category,
    field: x.field,
    title: x.title,
    summary: x.summary ?? `${x.title}. 가짜 공식 소스 두 곳의 기록에서 같은 이야기가 함께 보였다.`,
    reason: x.reason ?? "두 소스가 같은 가짜 품목과 가짜 문서를 가리킨다.",
    level: x.level,
    units: x.units,
    aux,
    continues: x.continues ?? null,
    issue: x.issue ?? null,
    sources: sourcesOf(x.units, aux),
  };
  if (x.corrections) out.corrections = x.corrections;
  return out;
}

/** 정확히 n자의 지어낸 글 */
function fill(n: number, seed: string): string {
  let s = "";
  while (s.length < n) s += `${seed} 가짜 흐름의 지어낸 설명 문장이 길게 이어진다. `;
  return s.slice(0, n - 1).trimEnd().padEnd(n - 1, "다") + ".";
}

interface Day {
  status: "checked" | "failed" | "short" | "off";
  missing?: OfficialGroup[];
  items: SiteFlowItem[];
}

export function fixtureDemand(opts: { datesDesc: string[]; end: string; issue: IssueRef }): DemandFixtures {
  const { datesDesc, end, issue } = opts;
  const [three, zero, short, failed, missing, continues, corrected, long, origin, noRecord, offOnly] = datesDesc;
  const info: DemandFixtureInfo = { three: three ?? null, zero: zero ?? null, short: short ?? null, failed: failed ?? null, missing: missing ?? null, continues: continues ?? null, corrected: corrected ?? null, long: long ?? null, origin: origin ?? null, noRecord: noRecord ?? null, offOnly: offOnly ?? null, sevenTabs: three ?? null };
  const days = new Map<string, Day>();
  const wiki = (date: string, name: string, over: Partial<SiteFlowUnit> = {}) => unit(date, { group: "wikimedia", source: "ko.wikipedia", name, recent: 412345, base: 98765.4, unit: "회 조회", topList: true, ...over });
  const ftc = (date: string, name: string, over: Partial<SiteFlowUnit> = {}) => unit(date, { group: "ftc1372", name, recent: 238, base: 61.5, recentTo: addDays(date, -16), recentFrom: addDays(date, -22), baseTo: addDays(date, -23), baseFrom: addDays(date, -50), ...over });
  if (three) {
    days.set(three, {
      status: "checked",
      items: [
        item(1, { category: "complaint", field: "travel", title: "가짜항공 지연 보상 문의가 함께 늘었다", summary: "가짜보상지어낸요지는 가짜항공 지연 보상 문의가 소비자상담과 민원에서 함께 늘었다는 것이다.", level: "strong", issue, aux: ["Google Trends KR", "Mastodon mastodon.example"], units: [ftc(three, "여행 > 가짜항공권"), unit(three, { group: "acrc", source: "민원정책 질의응답", recent: 31, base: 8.3 }), wiki(three, "가짜항공 지연 사태")] }),
        item(2, { category: "money", field: "investment", title: "가짜 업종의 투자 공시가 함께 늘었다", level: "medium", units: [unit(three, { group: "dart", name: "가짜 유상증자결정", recent: 54, base: 21.2 }), unit(three, { group: "sec", name: "Fake Pooled Investment Fund", recent: 77, base: 30, recentTo: addDays(three, -2), recentFrom: addDays(three, -8), baseTo: addDays(three, -9), baseFrom: addDays(three, -36) })] }),
        item(3, { category: "interest", field: "science", title: "가짜 위성 발사에 관심이 함께 모였다", level: "weak", units: [wiki(three, "가짜 위성 1호", { recentDays: 6, baseDays: 26, recent: 150321, base: 20450.2 }), unit(three, { group: "assembly", source: "국민동의청원 접수목록(22대)", recent: 4123, base: 0, isNew: true, unit: "명 동의" })] }),
      ],
    });
  }
  if (zero) days.set(zero, { status: "checked", items: [] });
  if (short) days.set(short, { status: "short", items: [] });
  if (failed) days.set(failed, { status: "failed", items: [] });
  if (missing) days.set(missing, { status: "checked", missing: ["assembly", "sec"], items: [item(1, { category: "complaint", field: "retail", title: "가짜 택배 분실 상담이 함께 늘었다", level: "medium", units: [ftc(missing, "생활 > 가짜택배"), unit(missing, { group: "acrc", source: "민원빅데이터 오늘의 이슈", name: "가짜택배", recent: 5, base: 0.5, unit: "일", topList: true })] })] });
  if (continues) days.set(continues, { status: "checked", items: [item(1, { category: "interest", field: "health", title: "가짜 감기약 관심이 더 넓어졌다", level: "strong", continues: origin ? { date: origin, key: "demand-1" } : null, units: [wiki(continues, "가짜 감기약"), ftc(continues, "의약품 > 가짜감기약"), unit(continues, { group: "acrc", source: "공개제안", recent: 22, base: 6.4 })] })] });
  if (corrected) days.set(corrected, { status: "checked", items: [item(1, { category: "complaint", field: "housing", title: "가짜 전세 계약 상담이 함께 늘었다", level: "medium", corrections: [{ on: end, reason: "요지의 소스 이름을 바로잡았다." }], units: [ftc(corrected, "주거 > 가짜임대차"), unit(corrected, { group: "acrc", source: "민원정책 질의응답", recent: 40, base: 12 })] })] });
  if (long) {
    const longName = "가짜 아주 긴 문서 제목이 줄을 넘겨 이어지는 경우를 보기 위한 지어낸 위키 문서 이름 (가짜 동음이의 설명)";
    days.set(long, {
      status: "checked",
      items: [1, 2, 3].map((p) =>
        item(p, {
          category: "interest",
          field: "entertainment",
          title: fill(60, `가짜 긴 제목 ${p}`),
          summary: fill(200, "가짜 긴 요지"),
          reason: fill(100, "가짜 긴 이유"),
          level: "strong",
          issue,
          aux: ["Google Trends KR", "Google Trends JP", "Google Trends US", "Mastodon mastodon.example", "Mastodon fake.social"],
          units: [wiki(long, longName), unit(long, { group: "wikimedia", source: "ja.wikipedia", name: "偽の長い記事名の例", recent: 312000, base: 45000, unit: "회 조회", topList: true }), ftc(long, "문화·오락 > 가짜공연 > 가짜예매"), unit(long, { group: "dart", name: "가짜 주요사항보고서(가짜 공연사업 양수 결정)", recent: 12, base: 2.1 }), unit(long, { group: "acrc", source: "민원정책 질의응답", recent: 18, base: 3 })],
        }),
      ),
    });
  }
  if (origin) days.set(origin, { status: "checked", items: [item(1, { category: "interest", field: "health", title: "가짜 감기약에 관심이 함께 모였다", level: "medium", units: [wiki(origin, "가짜 감기약"), ftc(origin, "의약품 > 가짜감기약")] })] });
  if (offOnly) days.set(offOnly, { status: "off", items: [] });

  const byDate = new Map<string, DayDemand>();
  const months = new Map<string, DemandMonth>();
  for (const date of [...days.keys()].sort()) {
    const d = days.get(date)!;
    const summary = dayDemandOf(d.status, d.items.length, d.missing ?? []);
    if (summary) byDate.set(date, summary);
    if (d.items.length === 0) continue;
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, days: {} });
    months.get(month)!.days[date] = d.items;
  }
  return { byDate, months: [...months.values()], info };
}

/** 달 파일 이름(fixtures.ts가 쓴다) */
export const demandFile = (m: DemandMonth) => `site-data/${siteFiles.demandItems(m.month)}`;
