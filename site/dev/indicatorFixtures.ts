// 6단계: 지어낸 지표의 사이트 데이터(로컬 화면 확인·테스트·크기 측정용). 값은 모두 난수로 지어낸 것이다. fixtures.ts가 부른다.
// 실제 빌드(src/indicatorSite.ts)와 같은 모양·규칙의 파일을 만든다: 지표 목록(카드·1년 작은 그래프·관련 이슈), 지표마다 최근 5년 값,
// 브리프 날짜마다 상자의 칩(그 날짜 이하의 가장 최근 값), 이슈마다 고른 지표와 그래프 기간. 지표 정의는 실제 정의(src/indicators.ts)를 쓴다.
// 휴장일(주말, 고정 공휴일, 가장 최근 날짜 앞 평일 브리프 날짜의 한국 휴장일)은 값을 비운다. 미국 지표는 하루 늦게, 달러 지수는 닷새 늦게 끝난다.
// all이 아니면 브렌트유는 공개를 끈 지표(어디에도 없다), 코스닥은 값이 하나도 없는 공개 지표(복원 직후처럼)다.
import { CHIP_ORDER, INDICATORS, type IndicatorDef } from "../../src/indicators.ts";
import { ISSUE_GRAPH_LEAD_DAYS, changeOf, displayPoints } from "../../src/indicatorSite.ts";
import { siteFiles, type IndicatorCard, type IndicatorChip, type IndicatorList, type IndicatorPoint, type IndicatorReading, type IndicatorSeries, type IssueIndicator, type IssueRef } from "../../src/siteTypes.ts";
import { addDays, rng } from "./random.ts";

export interface IndicatorFixtureIssue {
  id: number;
  name: string;
  startDate: string | null;
  latestDate: string | null;
}

export interface IndicatorFixtureInfo {
  /** 공개를 끈 지표(없으면 null) */
  off: string | null;
  /** 값이 하나도 없는 공개 지표(없으면 null) */
  empty: string | null;
  /** 관련 이슈가 가장 많은 지표와 그 수 */
  mostRelated: { id: string; count: number };
  /** 값이 있지만 관련 이슈가 없는 지표 */
  noRelated: string | null;
  /** 그래프가 1개, 3개인 이슈 */
  issueOne: number | null;
  issueThree: number | null;
  /** 한국 지표가 휴장이라 칩 날짜가 브리프 날짜와 다른 날짜 */
  krHoliday: string | null;
}

export interface IndicatorFixtures {
  files: Map<string, string>;
  chips: Map<string, IndicatorChip[]>;
  byIssue: Map<number, IssueIndicator[]>;
  info: IndicatorFixtureInfo;
}

const KR_HOLIDAYS = ["01-01", "03-01", "05-05", "06-06", "08-15", "10-03", "10-09", "12-25"];
const US_HOLIDAYS = ["01-01", "06-19", "07-04", "11-11", "12-25"];

/** 시작 값, 하루 움직임(비율 또는 더하기), 하한·상한 */
const WALK: Record<string, { base: number; vol: number; add?: boolean; min: number; max: number }> = {
  usdkrw: { base: 1185, vol: 0.006, min: 1050, max: 1500 },
  kospi: { base: 3010, vol: 0.012, min: 2000, max: 4200 },
  kosdaq: { base: 1000, vol: 0.015, min: 600, max: 1300 },
  kr3y: { base: 1.85, vol: 0.03, add: true, min: 0.8, max: 4.8 },
  us10y: { base: 1.62, vol: 0.045, add: true, min: 0.5, max: 5.2 },
  wti: { base: 82, vol: 0.024, min: 55, max: 125 },
  brent: { base: 84, vol: 0.023, min: 58, max: 128 },
  usdindex: { base: 114, vol: 0.004, min: 100, max: 132 },
};

function weekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

function monthBefore(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) - months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

function yearsBack(last: string, years: number): string {
  if (last.length === 7) return monthBefore(last, years * 12);
  return `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
}

const round = (n: number, d: number) => Number(n.toFixed(d));

/** 일별 값(오래된 날부터) */
function dailyValues(d: IndicatorDef, start: string, end: string, extraHolidays: Set<string>, seed: number): IndicatorPoint[] {
  const rand = rng(seed);
  const holidays = d.group === "한국" ? KR_HOLIDAYS : US_HOLIDAYS;
  const out: IndicatorPoint[] = [];
  const walk = WALK[d.id];
  // 기준금리는 계단: 여러 달마다 0.25씩 오르내린다
  let v = walk?.base ?? (d.id === "krbase" ? 0.75 : 0.25);
  let n = 0;
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const w = weekday(date);
    if (w === 0 || w === 6 || holidays.includes(date.slice(5)) || (d.group === "한국" && extraHolidays.has(date))) continue;
    n++;
    if (walk) {
      const r = rand() - 0.5;
      v = walk.add ? v + r * walk.vol * 2 : v * (1 + r * walk.vol * 2);
      // 너무 멀리 떠나지 않게 시작 값 쪽으로 조금씩 당긴다
      v += (walk.base * (1 + 0.15 * Math.sin(n / 180)) - v) * 0.01;
      v = Math.min(walk.max, Math.max(walk.min, v));
    } else if (n % 61 === 0) {
      // 금리 인상기 뒤 동결·인하(지어낸 계단)
      const steps = d.id === "krbase" ? [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, -1, 0, -1, 0, -1, 0, 0, 0, 0, 0] : [0, 1, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 0, -2, -1, -1, 0, 0, -1, 0, 0];
      v = Math.max(0.25, v + 0.25 * (steps[n / 61 - 1] ?? 0));
    }
    out.push([date, round(v, d.decimals)]);
  }
  return out;
}

/** 월별 상승률(오래된 달부터). 미국은 2025-10이 빈 달이다(출처가 지수를 내지 않은 달처럼) */
function monthlyValues(d: IndicatorDef, start: string, end: string, seed: number): IndicatorPoint[] {
  const rand = rng(seed);
  const out: IndicatorPoint[] = [];
  let v = d.id === "krcpi" ? 2.4 : 5.2;
  for (let m = start; m <= end; m = monthBefore(m, -1)) {
    v = Math.min(9, Math.max(-1, v + (rand() - 0.55) * 0.6));
    if (d.id === "uscpi" && m === "2025-10") continue;
    out.push([m, round(v, 2)]);
  }
  return out;
}

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

function readingAt(d: IndicatorDef, p: IndicatorPoint[], idx: number): IndicatorReading {
  const [date, value] = p[idx]!;
  return { date, value, change: changeOf(d.change, value, p[idx - 1]?.[1]) };
}

/** 이슈 식별자 5개 중 1개(2할)가 지표 1~3개를 고른다. 처음은 늘 원/달러(관련 이슈가 많은 지표) */
const POOL = ["wti", "us10y", "kospi", "krbase", "usfed", "krcpi", "uscpi", "kosdaq", "brent", "kr3y"];
export function chosenIndicators(issueIds: number[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  let c = 0;
  for (const id of [...issueIds].sort((a, b) => a - b)) {
    if (id % 5 !== 1) continue;
    const count = 1 + (c % 3);
    const ids = ["usdkrw"];
    for (let j = 0; ids.length < count && j < POOL.length; j++) {
      const x = POOL[(c * 2 + j) % POOL.length]!;
      if (!ids.includes(x)) ids.push(x);
    }
    out.set(id, ids);
    c++;
  }
  return out;
}

export function fixtureIndicators(opts: { dates: string[]; issues: IndicatorFixtureIssue[]; years: number; all?: boolean }): IndicatorFixtures {
  const end = opts.dates.at(-1)!;
  const defs = INDICATORS.map((d): IndicatorDef => (!opts.all && d.id === "brent" ? { ...d, public: false } : d));
  const off = opts.all ? null : "brent";
  const empty = opts.all ? null : "kosdaq";
  const pub = defs.filter((d) => d.public);
  // 가장 최근 날짜 앞의 평일 브리프 날짜 하나를 한국 휴장일로 둔다(칩에 앞 날짜 값이 날짜와 함께 보인다)
  const krHoliday = opts.dates.slice(0, -1).reverse().find((x) => weekday(x) >= 1 && weekday(x) <= 5) ?? null;
  const extra = new Set(krHoliday ? [krHoliday] : []);
  const dailyStart = addDays(yearsBack(end, opts.years), -10);
  const points = new Map<string, IndicatorPoint[]>();
  for (const [k, d] of defs.entries()) {
    if (d.id === empty) {
      points.set(d.id, []);
      continue;
    }
    if (d.freq === "month") {
      // 저장 값은 지수지만 사이트 데이터는 상승률이다. 지어낸 데이터는 상승률을 바로 만든다(displayPoints는 지수가 아닌 값에는 쓰지 않는다)
      points.set(d.id, monthlyValues(d, monthBefore(end.slice(0, 7), opts.years * 12), monthBefore(end.slice(0, 7), 1), 6100 + k));
    } else {
      const last = d.id === "usdindex" ? addDays(end, -5) : d.group === "한국" ? end : addDays(end, -1);
      points.set(d.id, displayPoints(d, dailyValues(d, dailyStart, last, extra, 6000 + k).map(([date, value]) => ({ date, value }))));
    }
  }

  const live = opts.issues;
  const choice = chosenIndicators(live.map((i) => i.id));
  const order = [...live].sort((a, b) => (b.latestDate ?? "").localeCompare(a.latestDate ?? "") || a.id - b.id);
  const files = new Map<string, string>();
  const cards: IndicatorCard[] = [];
  let asOf: string | null = null;
  for (const d of pub) {
    const p = points.get(d.id)!;
    const last = p.length ? readingAt(d, p, p.length - 1) : null;
    if (last && d.freq === "day" && (asOf === null || last.date > asOf)) asOf = last.date;
    const issues: IssueRef[] = order.filter((i) => choice.get(i.id)?.includes(d.id)).map((i) => ({ id: i.id, name: i.name }));
    const spark = last ? p.filter(([date]) => date > yearsBack(last.date, 1)) : [];
    cards.push({ id: d.id, name: d.name, group: d.group, unit: d.unit, freq: d.freq, decimals: d.decimals, change: d.change, yoy: d.yoy, credit: d.credit, last, spark, issues });
    const series: IndicatorSeries = { id: d.id, points: last ? p.filter(([date]) => date > yearsBack(last.date, 5)) : [] };
    files.set(siteFiles.indicatorSeries(d.id), JSON.stringify(series));
  }
  const list: IndicatorList = { asOf, indicators: cards };
  files.set(siteFiles.indicatorList, JSON.stringify(list));

  const rank = (id: string) => (CHIP_ORDER.includes(id) ? CHIP_ORDER.indexOf(id) : CHIP_ORDER.length + defs.findIndex((d) => d.id === id));
  const daily = pub.filter((d) => d.freq === "day").sort((a, b) => rank(a.id) - rank(b.id));
  const chips = new Map<string, IndicatorChip[]>();
  for (const date of opts.dates) {
    const row: IndicatorChip[] = [];
    for (const d of daily) {
      const p = points.get(d.id)!;
      const idx = lastIndexAtOrBefore(p, date);
      if (idx >= 0) row.push({ id: d.id, name: d.name, unit: d.unit, decimals: d.decimals, kind: d.change, ...readingAt(d, p, idx) });
    }
    if (row.length) chips.set(date, row);
  }

  const byIssue = new Map<number, IssueIndicator[]>();
  for (const i of live) {
    const mine = choice.get(i.id);
    if (!mine || i.startDate === null) continue;
    const out: IssueIndicator[] = [];
    for (const d of pub.filter((x) => mine.includes(x.id))) {
      const to = points.get(d.id)!.at(-1)?.[0];
      if (to === undefined) continue;
      const from = addDays(i.startDate, -ISSUE_GRAPH_LEAD_DAYS);
      out.push({ id: d.id, from: d.freq === "month" ? from.slice(0, 7) : from, to });
    }
    if (out.length) byIssue.set(i.id, out);
  }

  const withValues = cards.filter((c) => c.last);
  const most = withValues.reduce((m, c) => (c.issues.length > m.issues.length ? c : m), withValues[0]!);
  return {
    files,
    chips,
    byIssue,
    info: {
      off,
      empty,
      mostRelated: { id: most.id, count: most.issues.length },
      noRelated: withValues.find((c) => c.issues.length === 0)?.id ?? null,
      issueOne: [...byIssue].find(([, v]) => v.length === 1)?.[0] ?? null,
      issueThree: [...byIssue].find(([, v]) => v.length === 3)?.[0] ?? null,
      krHoliday: krHoliday && chips.get(krHoliday)?.some((c) => c.date !== krHoliday) ? krHoliday : null,
    },
  };
}
