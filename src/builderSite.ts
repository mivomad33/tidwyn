import type { DatabaseSync } from "node:sqlite";
import { allBuilderDates, allBuilderItems, correctionsByItem, type BuilderItem } from "./builderStore.ts";
import { allDiscoveries, allKindDates, correctionsByDiscovery, type Discovery, type DiscoverKind, type KindStatus } from "./discoverStore.ts";
import { allIssues } from "./issues.ts";
import { dayBuilderOf, type BuilderMonth, type DayBuilder, type IssueRef, type SiteBuilderItem, type SiteDiscoveryItem } from "./siteTypes.ts";

// 9.8단계 4.6: 빌더 사이트 데이터. 항목은 달별 파일에 두고 달 목록에는 수와 상태만 둔다(첫 화면 크기, 4.6-5).
// 공개 칸만 옮긴다: 중복을 막는 키, 숫자 행, 후보 재료는 사이트에 나가지 않는다.

export interface BuilderSiteData {
  /** 빌더 기록이 있는 브리프 날짜 → 항목 수와 상태(B12). 꺼짐만 있는 날은 없다 */
  byDate: Map<string, DayBuilder>;
  /** 항목이 있는 달(오래된 달부터) */
  months: BuilderMonth[];
}

function siteItem(x: BuilderItem, placeOf: Map<number, BuilderItem>, issueOf: (id: number) => IssueRef, fixes: { on: string; reason: string }[] | undefined): SiteBuilderItem {
  const origin = x.reminderOf === null ? undefined : placeOf.get(x.reminderOf);
  const out: SiteBuilderItem = {
    key: x.key,
    field: x.field,
    title: x.title,
    whatChanged: x.whatChanged,
    who: x.who,
    action: x.action,
    why: x.why,
    due: x.due,
    // 흡수·지운 일정은 연결에서 정리되어 있다. 기한이 바뀌어 여럿이면 가장 나중 일정이다
    schedule: x.due?.state === "confirmed" ? (x.schedules.at(-1) ?? null) : null,
    issue: x.issue === null ? null : issueOf(x.issue),
    sources: x.sources,
    reminderOf: origin ? { date: origin.date, key: origin.key } : null,
  };
  if (fixes) out.corrections = publicFixes(fixes);
  return out;
}

/** 정정 기록의 공개 칸(최신순) */
const publicFixes = (fixes: { on: string; reason: string }[]) => fixes.map((f) => ({ on: f.on, reason: f.reason })).reverse();

/** 공개 칸만 옮긴다. 후보 값은 저장된 그대로다(N5) */
function siteDiscovery(x: Discovery, issueOf: (id: number) => IssueRef, fixes: { on: string; reason: string }[] | undefined): SiteDiscoveryItem {
  const out: SiteDiscoveryItem = { key: x.itemKey, kind: x.kind, name: x.name, url: x.url, purpose: x.purpose, difference: x.difference, reason: x.reason, issue: x.issue === null ? null : issueOf(x.issue) };
  if (x.kind === "repo") out.repo = { license: x.license ?? "없음", pushedOn: x.pushedOn, release: x.release, stars: x.stars, growth: x.growth };
  if (fixes) out.corrections = publicFixes(fixes);
  return out;
}

export function buildBuilderSiteData(db: DatabaseSync): BuilderSiteData {
  const items = allBuilderItems(db);
  const placeOf = new Map(items.map((x) => [x.id, x]));
  const fixes = correctionsByItem(db);
  const issues = new Map(allIssues(db).map((i) => [i.id, i]));
  // resolveIssue와 같은 규칙이다. 항목마다 DB를 읽지 않게 메모리에서 따라간다
  const issueOf = (id: number): IssueRef => {
    const seen = new Set<number>();
    let live = id;
    for (;;) {
      const into = issues.get(live)?.mergedInto ?? null;
      if (into === null || seen.has(live)) return { id: live, name: issues.get(live)?.name ?? "" };
      seen.add(live);
      live = into;
    }
  };
  const counts = new Map<string, number>();
  const months = new Map<string, BuilderMonth>();
  const monthFile = (date: string): BuilderMonth => {
    const month = date.slice(0, 7);
    let file = months.get(month);
    if (!file) months.set(month, (file = { month, days: {} }));
    return file;
  };
  for (const x of items) {
    counts.set(x.date, (counts.get(x.date) ?? 0) + 1);
    (monthFile(x.date).days[x.date] ??= []).push(siteItem(x, placeOf, issueOf, fixes.get(`${x.date}/${x.key}`)));
  }
  const discoveryFixes = correctionsByDiscovery(db);
  const kindCounts = new Map<string, number>();
  const discoveries = allDiscoveries(db);
  for (const x of discoveries) {
    kindCounts.set(`${x.date}/${x.kind}`, (kindCounts.get(`${x.date}/${x.kind}`) ?? 0) + 1);
    ((monthFile(x.date).discoveries ??= {})[x.date] ??= []).push(siteDiscovery(x, issueOf, discoveryFixes.get(`${x.date}/${x.itemKey}`)));
  }
  // 상태가 없는 종류는 9.9 이전 날짜라 묶음을 숨기고, 탭은 어느 종류든 보일 것이 있는 날에 나온다(4.5-1)
  const toolStatus = new Map(allBuilderDates(db).map((d) => [d.date, d.status]));
  const kindDates = allKindDates(db);
  const kindStatus = new Map<string, KindStatus>(kindDates.map((k) => [`${k.date}/${k.kind}`, k.status]));
  const dates = new Set([...toolStatus.keys(), ...counts.keys(), ...[...kindDates, ...discoveries].map((x) => x.date)]);
  const kind = (date: string, k: DiscoverKind) => ({ count: kindCounts.get(`${date}/${k}`) ?? 0, status: kindStatus.get(`${date}/${k}`) ?? null });
  const byDate = new Map<string, DayBuilder>();
  for (const date of dates) {
    const day = dayBuilderOf({ count: counts.get(date) ?? 0, status: toolStatus.get(date) ?? null }, { product: kind(date, "product"), repo: kind(date, "repo") });
    if (day) byDate.set(date, day);
  }
  return { byDate, months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)) };
}
