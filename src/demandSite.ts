import type { DatabaseSync } from "node:sqlite";
import { issueRefResolver, publicFixes } from "./builderSite.ts";
import { officialSources, type OfficialKind } from "./demandSources.ts";
import { allFlowDates, allFlows, flowCorrectionsByItem, type Flow, type FlowCommunityUnit, type FlowUnit } from "./demandFlowStore.ts";
import { AUX_GROUPS, COMMUNITY_GROUPS, COMMUNITY_INFO, GROUP_INFO, isCommunityConfirmed, flowSourceName, sourcePage, type OfficialGroup } from "./demandFlowTypes.ts";
import { TOP_LIST_KINDS } from "./demandUnits.ts";
import { dayDemandOf, type DayDemand, type DemandMonth, type SiteFlowCommunityUnit, type SiteFlowItem, type SiteFlowUnit } from "./siteTypes.ts";
import type { BuilderItemSource } from "./builderTypes.ts";

// 9.97단계 4.4(S1, S7, S10, S12): 수요 흐름 사이트 데이터. 빌더처럼 항목은 달별 파일에 두고 달 목록에는 수와 상태만 둔다.
// 공개 칸만 옮긴다: 단위 키, 영구 id, 후보 재료는 사이트에 나가지 않는다. 외부인 글 소스의 단위 이름은 저장 때부터 null이다(S7).

export interface DemandSiteData {
  /** 흐름 기록이 있는 브리프 날짜 → 항목 수와 상태. 꺼짐만 있는 날은 없다 */
  byDate: Map<string, DayDemand>;
  /** 항목이 있는 달(오래된 달부터) */
  months: DemandMonth[];
}

/** 값의 단위 글자. 국회 접수목록은 늘어난 동의 수, 위키는 조회수, 민원빅데이터는 목록에 든 날 수다(src/demandUnits.ts) */
function unitWord(kind: OfficialKind | undefined, source: string): string {
  if (kind === "wikimedia") return "회 조회";
  if (kind === "acrc-bigdata") return "일";
  if (source === "assembly:received") return "명 동의";
  return "건";
}

interface SourceInfo {
  kind: OfficialKind;
  label: string;
}

/** 소스 id → 종류와 이름. 묶음에 소스가 하나뿐이면 이름은 묶음 이름으로 충분해 비운다 */
function sourceInfos(): Map<string, SourceInfo> {
  const all = officialSources();
  const perGroup = new Map<string, number>();
  for (const s of all) perGroup.set(s.group, (perGroup.get(s.group) ?? 0) + 1);
  return new Map(all.map((s) => [s.id, { kind: s.kind, label: perGroup.get(s.group) === 1 ? "" : s.label }]));
}

function siteUnit(u: FlowUnit, infos: Map<string, SourceInfo>): SiteFlowUnit {
  const info = infos.get(u.source);
  const out: SiteFlowUnit = {
    group: u.group,
    source: info?.label ?? "",
    name: u.unitName,
    recent: u.recent,
    base: u.base,
    isNew: u.isNew,
    recentFrom: u.recentFrom,
    recentTo: u.recentTo,
    baseFrom: u.baseFrom,
    baseTo: u.baseTo,
    recentDays: u.recentDays,
    baseDays: u.baseDays,
    unit: unitWord(info?.kind, u.source),
  };
  if (info && TOP_LIST_KINDS.includes(info.kind)) out.topList = true;
  return out;
}

/** 커뮤니티 근거 줄(9.98). 공개 칸만 옮긴다(단위 키, 공식 단위 키는 나가지 않는다) */
function siteCommunity(c: FlowCommunityUnit): SiteFlowCommunityUnit {
  const info = COMMUNITY_INFO[c.group];
  return { group: c.group, source: info.label, sample: info.sample, name: c.unitName, recent: c.recent, base: c.base, isNew: c.isNew, recentFrom: c.recentFrom, recentTo: c.recentTo, baseFrom: c.baseFrom, baseTo: c.baseTo, unit: "건" };
}

/**
 * 출처: 근거 줄 소스의 공식 공개 페이지(S12), 처음 나온 순서로 겹치지 않게. 커뮤니티 근거가 있으면 그 소스의 고정 공식 주소(검색어 없음, 9.98 4.5-1)를,
 * 보조 근거가 있으면 그 묶음의 출처 표시도 더한다
 */
function flowSources(units: readonly FlowUnit[], aux: readonly string[], infos: Map<string, SourceInfo>, community: readonly FlowCommunityUnit[] = []): BuilderItemSource[] {
  const out: BuilderItemSource[] = [];
  const add = (name: string, url: string) => {
    if (!out.some((s) => s.url === url)) out.push({ name, url });
  };
  for (const u of units) add(flowSourceName(u.group, infos.get(u.source)?.label ?? ""), sourcePage(u.source, u.group));
  for (const g of COMMUNITY_GROUPS) if (community.some((c) => c.group === g)) add(COMMUNITY_INFO[g].credit, COMMUNITY_INFO[g].url);
  for (const g of AUX_GROUPS) if (aux.some((a) => a.startsWith(`${GROUP_INFO[g].credit} `))) add(GROUP_INFO[g].credit, GROUP_INFO[g].url);
  return out;
}

export function buildDemandSiteData(db: DatabaseSync): DemandSiteData {
  const flows = allFlows(db);
  const byId = new Map<number, Flow>(flows.map((f) => [f.id, f]));
  const issueOf = issueRefResolver(db);
  const infos = sourceInfos();
  const corrections = flowCorrectionsByItem(db);
  const counts = new Map<string, number>();
  const months = new Map<string, DemandMonth>();
  for (const f of flows) {
    counts.set(f.date, (counts.get(f.date) ?? 0) + 1);
    const origin = f.continues === null ? undefined : byId.get(f.continues);
    const fixes = corrections.get(f.id) ?? [];
    const item: SiteFlowItem = {
      key: f.itemKey,
      category: f.category,
      field: f.field,
      title: f.title,
      summary: f.summary,
      reason: f.reason,
      level: f.level,
      units: f.units.map((u) => siteUnit(u, infos)),
      aux: f.aux,
      continues: origin ? { date: origin.date, key: origin.itemKey } : null,
      issue: f.issue === null ? null : issueOf(f.issue),
      sources: flowSources(f.units, f.aux, infos, f.community),
    };
    const community = f.community ?? [];
    if (community.length > 0) {
      item.community = community.map(siteCommunity);
      if (isCommunityConfirmed(f.units, community)) item.communityConfirmed = true;
    }
    if (f.turning === true) item.turning = true;
    if (fixes.length > 0) item.corrections = publicFixes(fixes);
    const month = f.date.slice(0, 7);
    let file = months.get(month);
    if (!file) months.set(month, (file = { month, days: {} }));
    (file.days[f.date] ??= []).push(item);
  }
  const statuses = new Map(allFlowDates(db).map((d) => [d.date, d]));
  const byDate = new Map<string, DayDemand>();
  for (const date of new Set([...statuses.keys(), ...counts.keys()])) {
    const d = statuses.get(date);
    const day = dayDemandOf(d?.status ?? null, counts.get(date) ?? 0, (d?.missing ?? []) as OfficialGroup[], d?.communityMissing ?? []);
    if (day) byDate.set(date, day);
  }
  return { byDate, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}
