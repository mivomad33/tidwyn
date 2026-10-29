import type { DatabaseSync } from "node:sqlite";
import { CHIP_ORDER, INDICATORS, type IndicatorDef } from "./indicators.ts";
import { indicatorValues, sortIndicators, type IndicatorValue } from "./indicatorStore.ts";
import { allIssues } from "./issues.ts";
import { addDays } from "./kst.ts";
import {
  siteFiles,
  type IndicatorCard,
  type IndicatorChip,
  type IndicatorList,
  type IndicatorMetaInfo,
  type IndicatorPoint,
  type IndicatorReading,
  type IndicatorSeries,
  type IssueIndicator,
  type IssueRef,
} from "./siteTypes.ts";

// 6단계 4.6: 지표 사이트 데이터. 공개 지표만 넣는다(4.7-8). 같은 DB면 같은 결과다(빌드한 날의 시계를 쓰지 않는다, 4.6-3).

/** 이슈 그래프가 이슈 시작일보다 앞에서 시작하는 날 수(X4) */
export const ISSUE_GRAPH_LEAD_DAYS = 30;

export interface IndicatorSiteData {
  /** 사이트 데이터 폴더 기준 파일 이름 → 내용 */
  files: Map<string, string>;
  /** 브리프 날짜 → 상자의 칩 */
  chips: Map<string, IndicatorChip[]>;
  /** 이슈 → 고른 공개 지표와 그래프 기간 */
  byIssue: Map<number, IssueIndicator[]>;
  /** 공개 지표 수 */
  publicCount: number;
}

export function publicIndicators(defs: readonly IndicatorDef[] = INDICATORS): IndicatorDef[] {
  return defs.filter((d) => d.public);
}

function meta(d: IndicatorDef): IndicatorMetaInfo {
  return { id: d.id, name: d.name, group: d.group, unit: d.unit, freq: d.freq, decimals: d.decimals, change: d.change, yoy: d.yoy, credit: d.credit };
}

const round = (n: number, digits: number) => Number(n.toFixed(digits));

function monthBefore(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) - months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * 화면에 보일 값. 물가는 그 달과 1년 전 같은 달 지수가 모두 있을 때만 전년 동월 대비 상승률(%)을 계산하고,
 * 없으면 그 달은 빈 값이다(앞뒤 달로 메우지 않는다, X9-③)
 */
export function displayPoints(d: IndicatorDef, values: IndicatorValue[]): IndicatorPoint[] {
  if (!d.yoy) return values.map((v): IndicatorPoint => [v.date, v.value]);
  const byMonth = new Map(values.map((v) => [v.date, v.value]));
  const out: IndicatorPoint[] = [];
  for (const v of values) {
    const base = byMonth.get(monthBefore(v.date, 12));
    if (base === undefined || base === 0) continue;
    out.push([v.date, round((v.value / base - 1) * 100, 2)]);
  }
  return out;
}

/** 바로 앞 값 대비 변화(change 방식) */
export function changeOf(kind: IndicatorDef["change"], value: number, prev: number | undefined): number | null {
  if (prev === undefined) return null;
  if (kind === "pct") return prev === 0 ? null : round((value / prev - 1) * 100, 4);
  return round(value - prev, 6);
}

function readingAt(d: IndicatorDef, points: IndicatorPoint[], idx: number): IndicatorReading {
  const [date, value] = points[idx]!;
  return { date, value, change: changeOf(d.change, value, points[idx - 1]?.[1]) };
}

/** 마지막 값 기준 최근 n년의 시작(일별은 같은 달·날 n년 전, 월별은 같은 달 n년 전) */
function yearsBack(last: string, years: number): string {
  if (last.length === 7) return monthBefore(last, years * 12);
  const y = Number(last.slice(0, 4)) - years;
  return `${y}${last.slice(4)}`;
}

/** 이슈 그래프의 시작(이슈 시작일 30일 전. 월별 지표는 그 날의 달) */
function graphFrom(d: IndicatorDef, start: string): string {
  const from = addDays(start, -ISSUE_GRAPH_LEAD_DAYS);
  return d.freq === "month" ? from.slice(0, 7) : from;
}

/** 칩 순서: CHIP_ORDER 앞, 나머지는 정의 순서 */
function chipRank(id: string): number {
  const i = CHIP_ORDER.indexOf(id);
  return i >= 0 ? i : CHIP_ORDER.length + INDICATORS.findIndex((d) => d.id === id);
}

/** all은 지표 정의(테스트가 공개 끄기를 바꿔 넣는다) */
export function buildIndicatorSiteData(db: DatabaseSync, briefDates: string[], all: readonly IndicatorDef[] = INDICATORS): IndicatorSiteData {
  const defs = publicIndicators(all);
  const ids = new Set(defs.map((d) => d.id));
  const points = new Map(defs.map((d) => [d.id, displayPoints(d, indicatorValues(db, d.id))]));
  const live = allIssues(db).filter((i) => i.mergedInto === null);
  const order = [...live].sort((a, b) => (b.latestDate ?? "").localeCompare(a.latestDate ?? "") || a.id - b.id);
  const links = db.prepare("SELECT issue_id, indicator FROM issue_indicators").all() as { issue_id: number; indicator: string }[];
  const chosen = new Map<number, string[]>();
  for (const l of links) if (ids.has(l.indicator)) chosen.set(l.issue_id, [...(chosen.get(l.issue_id) ?? []), l.indicator]);

  const files = new Map<string, string>();
  const cards: IndicatorCard[] = [];
  let asOf: string | null = null;
  for (const d of defs) {
    const p = points.get(d.id)!;
    const last = p.length > 0 ? readingAt(d, p, p.length - 1) : null;
    if (last !== null && d.freq === "day" && (asOf === null || last.date > asOf)) asOf = last.date;
    const issues: IssueRef[] = order.filter((i) => chosen.get(i.id)?.includes(d.id)).map((i) => ({ id: i.id, name: i.name }));
    const spark = last === null ? [] : p.filter(([date]) => date > yearsBack(last.date, 1));
    cards.push({ ...meta(d), last, spark, issues });
    const series: IndicatorSeries = { id: d.id, points: last === null ? [] : p.filter(([date]) => date > yearsBack(last.date, 5)) };
    files.set(siteFiles.indicatorSeries(d.id), JSON.stringify(series));
  }
  const list: IndicatorList = { asOf, indicators: cards };
  files.set(siteFiles.indicatorList, JSON.stringify(list));

  const chips = new Map<string, IndicatorChip[]>();
  const daily = defs.filter((d) => d.freq === "day").sort((a, b) => chipRank(a.id) - chipRank(b.id));
  for (const date of briefDates) {
    const row: IndicatorChip[] = [];
    for (const d of daily) {
      const p = points.get(d.id)!;
      const idx = lastIndexAtOrBefore(p, date);
      if (idx < 0) continue;
      row.push({ id: d.id, name: d.name, unit: d.unit, decimals: d.decimals, kind: d.change, ...readingAt(d, p, idx) });
    }
    if (row.length > 0) chips.set(date, row);
  }

  const byIssue = new Map<number, IssueIndicator[]>();
  for (const i of live) {
    const mine = chosen.get(i.id);
    if (!mine || i.startDate === null) continue;
    const out: IssueIndicator[] = [];
    for (const id of sortIndicators(mine)) {
      const d = defs.find((x) => x.id === id)!;
      const p = points.get(id)!;
      const to = p.at(-1)?.[0];
      if (to === undefined) continue; // 값이 하나도 없는 지표는 그래프를 뺀다(4.7-2)
      out.push({ id, from: graphFrom(d, i.startDate), to });
    }
    if (out.length > 0) byIssue.set(i.id, out);
  }
  return { files, chips, byIssue, publicCount: defs.length };
}

/** 날짜가 date 이하인 마지막 값의 위치(없으면 -1) */
function lastIndexAtOrBefore(p: IndicatorPoint[], date: string): number {
  let lo = 0;
  let hi = p.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid]![0] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
