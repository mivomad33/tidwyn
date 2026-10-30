// 6단계 지표 화면(4.7)의 DOM 없는 로직: 값·변화 표기, 카드 묶기, 기간 거르기, 그래프 좌표, 요약 글, 이슈 그래프의 점,
// 브리프 위 '이번 주 일정 | 지표' 상자의 탭 규칙과 접은 줄. 화면(DOM) 없이 테스트한다.
// 지표 정의(src/indicators.ts)는 가져오지 않는다. 표시에 필요한 정보(단위, 소수 자리, 변화 방식, 출처 문구)는 사이트 데이터에 실려 온다.
import { fullKoreanDate, monthDay, monthLabel } from "./format.ts";
import type { DayList, IndicatorCard, IndicatorChip, IndicatorList, IndicatorMetaInfo, IndicatorPoint, IssueRef } from "./types.ts";

// ---- 값과 변화 표기 ----

type ChangeKind = IndicatorMetaInfo["change"];

/** 천 단위 쉼표와 고정 소수 자리 */
export function fmtNumber(n: number, decimals: number): string {
  return new Intl.NumberFormat("ko-KR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n);
}

/** 값과 단위: "1,392.5원", "4.21%", "2,614.20", "73.40달러" */
export function formatValue(meta: { unit: string; decimals: number }, value: number): string {
  return `${fmtNumber(value, meta.decimals)}${meta.unit}`;
}

/** 퍼센트 변화의 소수 자리 */
export const PCT_DECIMALS = 2;

export type Direction = "up" | "down" | "flat";

/** 변화 방향. 변화가 없으면(앞 값이 없음) null */
export function direction(change: number | null): Direction | null {
  if (change === null) return null;
  return change > 0 ? "up" : change < 0 ? "down" : "flat";
}

const ARROW: Record<Exclude<Direction, "flat">, string> = { up: "▲", down: "▼" };

/** 앞 값 대비 퍼센트 변화(abs 방식에서 계산). 앞 값이 0이면 null */
function pctFromAbs(value: number, change: number): number | null {
  const prev = value - change;
  return prev === 0 ? null : (change / prev) * 100;
}

/** 앞 값 대비 차이(pct 방식에서 계산) */
function absFromPct(value: number, pct: number): number {
  return value - value / (1 + pct / 100);
}

export interface ChangeLabel {
  dir: Direction;
  /** 화면 글자("▲3.1 (0.22%)", "▼0.80%", "▲0.03%p", "변동 없음") */
  text: string;
  /** 보조 기술용 글자("3.1 올라(0.22%)", "변동 없음") */
  spoken: string;
}

/**
 * 앞 값 대비 변화 글자. compact면 칩처럼 좁은 곳: abs·pct 방식은 퍼센트 변화, pp 방식은 %p.
 * 아니면 카드·지표 하나의 페이지: abs·pct 방식은 "차이 (퍼센트)", pp 방식은 %p.
 */
export function changeLabel(meta: { change: ChangeKind; decimals: number }, value: number, change: number | null, compact: boolean): ChangeLabel | null {
  const dir = direction(change);
  if (dir === null || change === null) return null;
  if (dir === "flat") return { dir, text: "변동 없음", spoken: "변동 없음" };
  const arrow = ARROW[dir];
  const verb = dir === "up" ? "올라" : "내려";
  if (meta.change === "pp") {
    const t = `${fmtNumber(Math.abs(change), meta.decimals)}%p`;
    return { dir, text: `${arrow}${t}`, spoken: `${t} ${verb}` };
  }
  const pct = meta.change === "pct" ? change : pctFromAbs(value, change);
  const abs = meta.change === "abs" ? change : absFromPct(value, change);
  const pctText = pct === null ? null : `${fmtNumber(Math.abs(pct), PCT_DECIMALS)}%`;
  const absText = fmtNumber(Math.abs(abs), meta.decimals);
  if (compact) {
    const t = pctText ?? absText;
    return { dir, text: `${arrow}${t}`, spoken: `${t} ${verb}` };
  }
  return { dir, text: pctText ? `${arrow}${absText} (${pctText})` : `${arrow}${absText}`, spoken: pctText ? `${absText} ${verb}(${pctText})` : `${absText} ${verb}` };
}

/** 월별 값의 달 이름: "2026-09" → "9월" */
export function monthName(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

/** 카드·제목 줄의 값 글자. 월별 물가는 "9월 2.1%"처럼 그 달과 상승률 */
export function readingValueText(meta: IndicatorMetaInfo, reading: { date: string; value: number }): string {
  const v = formatValue(meta, reading.value);
  return meta.freq === "month" ? `${monthName(reading.date)} ${v}` : v;
}

/** 변화 앞에 붙이는 말: 월별은 "전달 대비", 일별은 없음(카드의 자리가 좁다) */
export function changePrefix(meta: { freq: IndicatorMetaInfo["freq"] }): string {
  return meta.freq === "month" ? "전달 대비 " : "";
}

/** 값의 날짜 글자: 일별 "10월 27일", 월별 "2026년 9월" */
export function readingDateText(date: string): string {
  return date.length === 7 ? monthLabel(date) : monthDay(date);
}

/** 그래프·요약에 쓰는 긴 날짜 글자: "2026년 10월 27일", 월별 "2026년 9월" */
export function longDateText(date: string): string {
  return date.length === 7 ? monthLabel(date) : fullKoreanDate(date);
}

/** 축 글자: "2025.10.28", 월별 "2025.10" */
export function axisDateText(date: string): string {
  return date.replaceAll("-", ".");
}

// ---- 지표 페이지 ----

export const INDICATOR_GROUPS = ["한국", "미국·국제"] as const;

/** 카드로 보일 지표: 값이 하나도 없는 지표는 뺀다(4.7-2). 순서는 데이터 순서(지표 정의 순서) */
export function visibleCards(list: IndicatorList): IndicatorCard[] {
  return list.indicators.filter((c) => c.last !== null);
}

/** 한국 → 미국·국제 묶음. 카드가 없는 묶음은 뺀다 */
export function groupCards(cards: IndicatorCard[]): { group: (typeof INDICATOR_GROUPS)[number]; cards: IndicatorCard[] }[] {
  return INDICATOR_GROUPS.map((group) => ({ group, cards: cards.filter((c) => c.group === group) })).filter((g) => g.cards.length > 0);
}

export const OFFICIAL_SOURCES = "공식 출처(한국은행 ECOS, FRED)";

/** 지표 페이지 제목 아래 줄: "10월 28일까지의 값 · 공식 출처(한국은행 ECOS, FRED)" */
export function asOfLine(list: IndicatorList): string {
  return list.asOf ? `${monthDay(list.asOf)}까지의 값 · ${OFFICIAL_SOURCES}` : OFFICIAL_SOURCES;
}

/** 보이는 지표의 출처 문구(겹치지 않게, 처음 나온 순서)와 그 출처의 지표 이름 */
export function creditsOf(metas: { name: string; credit: string }[]): { credit: string; names: string[] }[] {
  const out: { credit: string; names: string[] }[] = [];
  for (const m of metas) {
    const found = out.find((c) => c.credit === m.credit);
    if (found) found.names.push(m.name);
    else out.push({ credit: m.credit, names: [m.name] });
  }
  return out;
}

/** FRED API 이용 약관(https://fred.stlouisfed.org/docs/api/terms_of_use.html, 2026-10-29 다시 열어 확인)이 요구하는 고지 */
export const FRED_NOTICE = "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.";
export const FRED_TERMS_URL = "https://fred.stlouisfed.org/docs/api/terms_of_use.html";
export const FRED_TERMS_LABEL = "FRED® API 이용 약관";
/** 약관의 "users agreeing" 조항(사이트 소개에 싣는다) */
export const FRED_AGREEMENT = "이 사이트를 이용하면 FRED® API 이용 약관을 따르는 것으로 본다.";

// ---- 지표 하나의 페이지: 기간과 관련 이슈 ----

export type Period = "month" | "year" | "five";
export const PERIODS: { id: Period; label: string; months: number }[] = [
  { id: "month", label: "1개월", months: 1 },
  { id: "year", label: "1년", months: 12 },
  { id: "five", label: "5년", months: 60 },
];
export const DEFAULT_PERIOD: Period = "year";

function monthsBefore(month: string, months: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const t = y * 12 + (m - 1) - months;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 마지막 값 날짜에서 기간만큼 앞(이 날짜보다 뒤의 값만 그 기간에 든다). 일별은 같은 날의 몇 달 전, 월별은 몇 달 전 */
export function periodStart(last: string, period: Period): string {
  const months = PERIODS.find((p) => p.id === period)!.months;
  if (last.length === 7) return monthsBefore(last, months);
  return `${monthsBefore(last.slice(0, 7), months)}${last.slice(7)}`;
}

/** 기간에 드는 값(마지막 값 기준). 사이트 데이터의 5년 값을 그대로 거른다 */
export function periodPoints(points: IndicatorPoint[], period: Period): IndicatorPoint[] {
  const last = points.at(-1);
  if (!last) return [];
  const start = periodStart(last[0], period);
  return points.filter(([d]) => d > start);
}

/** 관련 이슈는 처음에 이만큼 보이고 나머지는 '더 보기'로 연다 */
export const RELATED_FIRST = 5;

export function relatedShown(issues: IssueRef[], expanded: boolean): { shown: IssueRef[]; more: number } {
  if (expanded || issues.length <= RELATED_FIRST) return { shown: issues, more: 0 };
  return { shown: issues.slice(0, RELATED_FIRST), more: issues.length - RELATED_FIRST };
}

// ---- 그래프 ----

/** 보조 기술용 그래프 요약(기간, 처음·마지막 값, 최고·최저) */
export function chartSummary(meta: { name: string; unit: string; decimals: number }, points: IndicatorPoint[]): string {
  if (points.length === 0) return `${meta.name}: 이 기간에 값이 없다.`;
  const v = (p: IndicatorPoint) => formatValue(meta, p[1]);
  const first = points[0]!;
  const last = points.at(-1)!;
  if (points.length === 1) return `${meta.name}: ${longDateText(first[0])} 값 하나, ${v(first)}.`;
  let hi = first;
  let lo = first;
  for (const p of points) {
    if (p[1] > hi[1]) hi = p;
    if (p[1] < lo[1]) lo = p;
  }
  return `${meta.name}: ${longDateText(first[0])}부터 ${longDateText(last[0])}까지. 처음 ${v(first)}, 마지막 ${v(last)}, 최고 ${v(hi)}(${longDateText(hi[0])}), 최저 ${v(lo)}(${longDateText(lo[0])}).`;
}

export interface ChartBox {
  width: number;
  height: number;
  /** 왼쪽·오른쪽 여백 */
  padX: number;
  padTop: number;
  /** 아래 여백(축 글자 자리 포함) */
  padBottom: number;
}

export interface ChartGeometry {
  xs: number[];
  ys: number[];
  /** 선 경로(SVG path d). 값이 하나면 빈 글자(점만 그린다) */
  path: string;
  /** 가로 눈금선의 y와 그 값(값이 모두 같으면 그 값 하나) */
  grid: { y: number; value: number }[];
  min: number;
  max: number;
}

/** 가로 눈금선 수 */
export const GRID_LINES = 4;

/** 값의 x는 순서 간격(휴장일은 비우고 선은 이어 그린다), y는 기간 안 최저·최고로 맞춘다 */
export function chartGeometry(points: IndicatorPoint[], box: ChartBox): ChartGeometry {
  const n = points.length;
  const values = points.map((p) => p[1]);
  let min = n ? Math.min(...values) : 0;
  let max = n ? Math.max(...values) : 1;
  const flat = n > 0 && min === max;
  if (flat) {
    const d = Math.abs(min) * 0.01 || 1;
    min -= d;
    max += d;
  }
  const innerW = box.width - 2 * box.padX;
  const innerH = box.height - box.padTop - box.padBottom;
  const xs = points.map((_, i) => (n === 1 ? box.padX + innerW / 2 : box.padX + (i * innerW) / (n - 1)));
  const yOf = (v: number) => box.padTop + innerH * (1 - (v - min) / (max - min));
  const ys = values.map(yOf);
  const path = n < 2 ? "" : xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
  // 값이 모두 같으면(값 하나 포함) 눈금선은 그 값 높이에 하나만 둔다. 넓힌 범위로 네 줄을 그리면 같은 글자로 반올림돼 값과 다른 높이에 붙는다
  const grid = flat
    ? [{ y: yOf(values[0]!), value: values[0]! }]
    : Array.from({ length: GRID_LINES }, (_, k) => {
        const value = max - ((max - min) * k) / (GRID_LINES - 1);
        return { y: yOf(value), value };
      });
  return { xs, ys, path, grid, min, max };
}

/** 누른(끈) x에 가장 가까운 값의 위치 */
export function nearestIndex(x: number, n: number, box: ChartBox): number {
  if (n <= 1) return 0;
  const innerW = box.width - 2 * box.padX;
  const i = Math.round(((x - box.padX) / innerW) * (n - 1));
  return Math.min(n - 1, Math.max(0, i));
}

/** 키보드로 고른 위치 옮기기. 처음 누르면(고른 것이 없으면) 마지막 값부터 */
export function moveIndex(current: number | null, key: string, n: number): number | null {
  if (n === 0) return null;
  const step = Math.max(1, Math.round(n / 10));
  const cur = current ?? n - 1;
  switch (key) {
    case "ArrowLeft":
    case "ArrowDown":
      return current === null ? cur : Math.max(0, cur - 1);
    case "ArrowRight":
    case "ArrowUp":
      return current === null ? cur : Math.min(n - 1, cur + 1);
    case "PageDown":
      return Math.max(0, cur - step);
    case "PageUp":
      return Math.min(n - 1, cur + step);
    case "Home":
      return 0;
    case "End":
      return n - 1;
    default:
      return current;
  }
}

/** 날짜가 date 이하인 마지막 값의 위치(없으면 -1). 월별 값("YYYY-MM")은 그 달의 날짜("YYYY-MM-DD")보다 앞으로 본다 */
export function lastIndexAtOrBefore(points: IndicatorPoint[], date: string): number {
  let lo = 0;
  let hi = points.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]![0] <= date) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** 이슈 그래프의 값: 그래프 기간(from~to) 안 */
export function issueGraphPoints(points: IndicatorPoint[], from: string, to: string): IndicatorPoint[] {
  return points.filter(([d]) => d >= from && d <= to);
}

/**
 * 이슈 뉴스가 있는 날의 점 위치(4.7-4): 그날 값이 없으면(휴장일) 그 앞의 가장 가까운 값 위치. 그래프의 첫 값보다 앞의 날은 뺀다.
 * 같은 위치는 하나로, 위치 순
 */
export function dotIndexes(points: IndicatorPoint[], newsDates: string[]): number[] {
  const out = new Set<number>();
  for (const d of newsDates) {
    const i = lastIndexAtOrBefore(points, d);
    if (i >= 0) out.add(i);
  }
  return [...out].sort((a, b) => a - b);
}

/** 이슈 그래프 제목 줄의 시작: "9월 14일부터", 월별 "2026년 9월부터" */
export function graphFromText(from: string): string {
  return `${readingDateText(from)}부터`;
}

// ---- 브리프 위 '이번 주 일정 | 지표' 상자(4.7-1) ----

export type BoxTab = "week" | "indicators";
/** 고른 탭을 기억하는 로컬 스토리지 키(읽은 기록 지우기 대상이 아니다, 정의는 browserKeys.ts). 접은 상태는 5단계 키(tidwyn.weekBox)를 그대로 쓴다 */
export { BOX_TAB_KEY } from "./browserKeys.ts";

/** 기억한 탭. 없거나 모르는 값이면 null(그 날짜의 기본 탭) */
export function parseBoxTab(raw: string | null): BoxTab | null {
  return raw === "week" || raw === "indicators" ? raw : null;
}

export const BOX_TAB_LABEL: Record<BoxTab, string> = { week: "이번 주 일정", indicators: "지표" };

export interface BriefBoxModel {
  /** 보일 탭(일정이 없으면 일정 탭, 기준값이 있는 칩이 없으면 지표 탭이 빠진다) */
  tabs: BoxTab[];
  /** 고른 탭 */
  tab: BoxTab;
  /** 상자 이름(보조 기술) */
  label: string;
  chips: IndicatorChip[];
}

/** 상자 모양. 일정도 지표도 없으면 null(상자도 접은 줄도 없다). 기억한 탭이 그 날짜에 없으면 처음 탭(일정, 없으면 지표) */
export function briefBoxModel(day: Pick<DayList, "week" | "indicators">, remembered: BoxTab | null): BriefBoxModel | null {
  const chips = day.indicators ?? [];
  const tabs: BoxTab[] = [];
  if (day.week) tabs.push("week");
  if (chips.length > 0) tabs.push("indicators");
  if (tabs.length === 0) return null;
  const tab = remembered && tabs.includes(remembered) ? remembered : tabs[0]!;
  const label = tabs.length === 2 ? "이번 주 일정과 지표" : BOX_TAB_LABEL[tabs[0]!];
  return { tabs, tab, label, chips };
}

/** 탭 글자: '이번 주 일정 N', '지표' */
export function boxTabText(tab: BoxTab, day: Pick<DayList, "week">): string {
  return tab === "week" ? `${BOX_TAB_LABEL.week} ${day.week?.total ?? 0}` : BOX_TAB_LABEL.indicators;
}

/** 접은 줄의 지표: 칩 순서의 첫 칩(데이터가 원/달러부터 칩 순서로 싣는다. 원/달러 값이 없으면 기준값이 있는 첫 지표) */
export function collapsedChip(chips: IndicatorChip[]): IndicatorChip | null {
  return chips[0] ?? null;
}

/** 접은 줄의 글자 조각: ["이번 주 일정 3", "원/달러 환율 1,392.5원"]과 첫 칩의 변화. 없는 쪽은 빠진다 */
export function collapsedParts(day: Pick<DayList, "week" | "indicators">): { week: string | null; chip: { text: string; change: ChangeLabel | null } | null } {
  const c = collapsedChip(day.indicators ?? []);
  return {
    week: day.week ? boxTabText("week", day) : null,
    chip: c ? { text: `${c.name} ${formatValue(c, c.value)}`, change: changeLabel({ change: c.kind, decimals: c.decimals }, c.value, c.change, true) } : null,
  };
}

/** 칩의 날짜 표시: 기준값의 날짜가 브리프 날짜와 다르면 "10-26"(해가 다르면 그대로), 같으면 null */
export function chipDateNote(chip: { date: string }, briefDate: string): string | null {
  if (chip.date === briefDate) return null;
  return chip.date.slice(0, 4) === briefDate.slice(0, 4) ? chip.date.slice(5) : chip.date;
}

/** 지표 탭 아래 줄의 날짜 글자: "10월 27일 값" */
export function boxValuesDate(briefDate: string): string {
  return `${monthDay(briefDate)} 값`;
}

/** 지표 주소의 식별자(짧은 영어 소문자·숫자) */
export const INDICATOR_ID_RE = /^[a-z0-9]{1,32}$/;
