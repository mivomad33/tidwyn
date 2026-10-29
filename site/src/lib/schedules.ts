// 일정 화면(목록·달력), 브리프 위 '이번 주 일정', 펼친 카드의 일정 칩, 이슈 페이지의 일정(5단계 4.7). 화면(DOM) 없이 테스트한다.
// 다가오는·지난 일정의 구분은 보는 사람 브라우저의 오늘(KST)로 한다. 일 단위는 오늘 이후(오늘 포함), 달 단위는 이번 달 이후(이번 달 포함)가 다가오는 일정이다.
// 예정일은 현지 날짜 문자열 그대로 쓰고 시간대를 바꾸지 않는다(C4).
import { addDays } from "../../../src/kst.ts";
import { ISSUE_SCHEDULE_LIMIT } from "../../../src/siteTypes.ts";
import { briefPath, schedulePath } from "./routes.ts";
import type { Major, ScheduleIndex, ScheduleItem, ScheduleLine, ScheduleOutcomeView, ScheduleRefChunk } from "./types.ts";

export type ScheduleTab = "upcoming" | "past";
export type ScheduleView = "list" | "calendar";

export const SCHEDULE_TAB_LABEL: Record<ScheduleTab, string> = { upcoming: "다가오는 일정", past: "지난 일정" };

/** 일정 화면에서 마지막으로 고른 보기(목록·달력)를 기억하는 로컬 스토리지 키(읽은 기록 지우기 대상이 아니다, 4.7-3) */
export const SCHEDULE_VIEW_KEY = "tidwyn.scheduleView";
/** '이번 주 일정'을 접었는지 기억하는 로컬 스토리지 키(읽은 기록 지우기 대상이 아니다, 4.7-4) */
export const WEEK_BOX_KEY = "tidwyn.weekBox";

/** 기억한 보기. 없거나 모르는 값이면 목록 */
export function parseScheduleView(raw: string | null): ScheduleView {
  return raw === "calendar" ? "calendar" : "list";
}

/** 기억한 접기 상태. "closed"일 때만 접는다(없거나 깨졌으면 펼침) */
export function parseWeekCollapsed(raw: string | null): boolean {
  return raw === "closed";
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function isMonthDue(due: string): boolean {
  return due.length === 7;
}

export function monthOfDue(due: string): string {
  return due.slice(0, 7);
}

function weekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

function ymd(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 0, m ?? 0, d ?? 1];
}

/** 정렬 열쇠: 달 단위(`YYYY-MM`)는 그 달 일 단위 뒤(siteTypes의 compareSchedules와 같다) */
function dueKey(due: string): string {
  return isMonthDue(due) ? `${due}-99` : due;
}

export function isUpcoming(due: string, today: string): boolean {
  return isMonthDue(due) ? due >= monthOfDue(today) : due >= today;
}

export function tabOf(due: string, today: string): ScheduleTab {
  return isUpcoming(due, today) ? "upcoming" : "past";
}

/** 다가오는 일정은 가까운 날부터, 지난 일정은 최근 날부터. 같은 예정일이면 식별자 순 */
export function sortForTab<T extends { id: number; due: string }>(items: T[], tab: ScheduleTab): T[] {
  const dir = tab === "upcoming" ? 1 : -1;
  return [...items].sort((a, b) => {
    const ka = dueKey(a.due);
    const kb = dueKey(b.due);
    return ka !== kb ? (ka < kb ? -dir : dir) : a.id - b.id;
  });
}

/** 그 탭과 대분류(null이면 전체)에 드는 일정, 탭 순서대로 */
export function filterSchedules(items: ScheduleItem[], tab: ScheduleTab, major: Major | null, today: string): ScheduleItem[] {
  return sortForTab(
    items.filter((x) => tabOf(x.due, today) === tab && (major === null || x.major === major)),
    tab,
  );
}

export type ScheduleGroup<T = ScheduleItem> = { kind: "day"; date: string; items: T[] } | { kind: "month"; month: string; items: T[] };

/** 정렬된 일정을 날짜별로 묶는다. 달 단위 일정은 그 달의 "날짜 미정" 상자 하나에 모인다(정렬 순서상 그 달 날짜 일정들의 뒤, 지난 일정은 앞) */
export function groupSchedules<T extends { due: string }>(sorted: T[]): ScheduleGroup<T>[] {
  const groups: ScheduleGroup<T>[] = [];
  for (const x of sorted) {
    const last = groups.at(-1);
    if (isMonthDue(x.due)) {
      if (last?.kind === "month" && last.month === x.due) last.items.push(x);
      else groups.push({ kind: "month", month: x.due, items: [x] });
    } else if (last?.kind === "day" && last.date === x.due) last.items.push(x);
    else groups.push({ kind: "day", date: x.due, items: [x] });
  }
  return groups;
}

// ---- 날짜 글자 ----

/** 날짜 머리: "10월 30일 (금)". 오늘과 해가 다르면 "2025년 10월 30일 (목)" */
export function dayHeading(date: string, today: string): string {
  const [y, m, d] = ymd(date);
  const head = `${m}월 ${d}일 (${weekday(date)})`;
  return date.slice(0, 4) === today.slice(0, 4) ? head : `${y}년 ${head}`;
}

/** 달 이름: "11월", 해가 다르면 "2027년 1월" */
function monthName(month: string, today: string): string {
  const [y, m] = ymd(month);
  return month.slice(0, 4) === today.slice(0, 4) ? `${m}월` : `${y}년 ${m}월`;
}

/** 달 단위 상자 머리: "11월 중 (날짜 미정)" */
export function monthBoxHeading(month: string, today: string): string {
  return `${monthName(month, today)} 중 (날짜 미정)`;
}

/** 새 예정일(연기): "11월 10일" 또는 "12월 중". 해가 다르면 해를 붙인다 */
export function dueLabel(due: string, today: string): string {
  if (isMonthDue(due)) return `${monthName(due, today)} 중`;
  const [y, m, d] = ymd(due);
  return due.slice(0, 4) === today.slice(0, 4) ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
}

/** '이번 주 일정' 줄의 날짜: "10-30 금" */
export function weekRowDate(date: string): string {
  return `${date.slice(5)} ${weekday(date)}`;
}

/** 펼친 카드의 일정 칩 날짜: "11-04" 또는 "11월 중" */
export function chipDue(due: string): string {
  return isMonthDue(due) ? `${ymd(due)[1]}월 중` : due.slice(5);
}

/** 이슈 페이지의 일정 줄 날짜: "11-26 (목)" 또는 "11월 중". 해가 다르면 "2025-10-28 (화)", "2025년 11월 중" */
export function issueRowDate(due: string, today: string): string {
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  if (isMonthDue(due)) return `${monthName(due, today)} 중`;
  return `${sameYear ? due.slice(5) : due} (${weekday(due)})`;
}

// ---- 결과 문구와 링크(4.7-1) ----

export interface OutcomePart {
  /** 보이는 글("›"는 링크로 그릴 때 화면이 붙인다) */
  text: string;
  /** 누르면 갈 주소. 없으면 링크가 아니다 */
  to: string | null;
  /** 결과 연결이면 true(강조 바탕) */
  ok: boolean;
}

/**
 * 결과 문구: "결과: <결과 뉴스 제목>"(결과 뉴스마다 하나, 그 뉴스로), "연기 → <새 예정일>"(새 일정으로),
 * "연기(새 날짜 모름)"(링크 없음), "취소", "결과 못 찾음". 결과 기다림은 표시 없음(빈 목록).
 */
export function outcomeParts(outcome: ScheduleOutcomeView, today: string): OutcomePart[] {
  switch (outcome.status) {
    case "result":
      return outcome.news.map((n) => ({ text: `결과: ${n.title}`, to: briefPath(n.date, n.key), ok: true }));
    case "postponed":
      return outcome.to ? [{ text: `연기 → ${dueLabel(outcome.to.due, today)}`, to: schedulePath(outcome.to.id), ok: false }] : [{ text: "연기(새 날짜 모름)", to: null, ok: false }];
    case "cancelled":
      return [{ text: "취소", to: null, ok: false }];
    case "missing":
      return [{ text: "결과 못 찾음", to: null, ok: false }];
    case "pending":
      return [];
  }
}

/** 이름을 누르면 갈 곳: 처음 근거 뉴스(그 날짜 브리프의 카드나 줄). 근거 뉴스가 없으면 null */
export function nameLink(item: Pick<ScheduleItem, "first">): string | null {
  return item.first ? briefPath(item.first.date, item.first.key) : null;
}

// ---- 이슈 페이지(4.7-5) ----

export interface IssueScheduleRows {
  /** 다가오는 일정, 가까운 순, 최대 ISSUE_SCHEDULE_LIMIT개 */
  upcoming: ScheduleLine[];
  /** 지난 일정, 최근 순, 최대 ISSUE_SCHEDULE_LIMIT개 */
  past: ScheduleLine[];
  /** 보이지 않은 일정이 있으면 true('일정 전체 ›') */
  more: boolean;
}

export function issueScheduleRows(lines: ScheduleLine[] | undefined, today: string, limit = ISSUE_SCHEDULE_LIMIT): IssueScheduleRows {
  const all = lines ?? [];
  const up = sortForTab(all.filter((x) => isUpcoming(x.due, today)), "upcoming");
  const past = sortForTab(all.filter((x) => !isUpcoming(x.due, today)), "past");
  return { upcoming: up.slice(0, limit), past: past.slice(0, limit), more: up.length > limit || past.length > limit };
}

// ---- 달력(4.7-2) ----

export function addMonths(month: string, n: number): string {
  const [y, m] = ymd(month);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/** 그 달 1일의 요일(0 = 일요일) */
export function firstWeekday(month: string): number {
  const [y, m] = ymd(month);
  return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
}

export function daysInMonth(month: string): number {
  const [y, m] = ymd(month);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface CalendarCell {
  date: string;
  /** 그 달의 날짜인지(앞뒤 달의 날은 흐리게, 고를 수 없다) */
  inMonth: boolean;
}

/** 일요일 시작 월 격자: 1일이 든 주의 일요일부터 말일이 든 주의 토요일까지 */
export function calendarCells(month: string): CalendarCell[] {
  const first = `${month}-01`;
  const start = addDays(first, -firstWeekday(month));
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const total = Math.ceil((firstWeekday(month) + daysInMonth(month)) / 7) * 7;
  const cells: CalendarCell[] = [];
  for (let i = 0; i < total; i++) {
    const date = addDays(start, i);
    cells.push({ date, inMonth: date >= first && date <= last });
  }
  return cells;
}

export type DayMark = "upcoming" | "past";

/** 일정 있는 날의 점. 오늘 전 날은 회색 점(past). 대분류를 고르면 그 대분류 일정만 센다 */
export function dayMarks(items: { due: string; major: Major }[], today: string, major: Major | null): Map<string, DayMark> {
  const marks = new Map<string, DayMark>();
  for (const x of items) {
    if (isMonthDue(x.due) || (major !== null && x.major !== major)) continue;
    marks.set(x.due, x.due < today ? "past" : "upcoming");
  }
  return marks;
}

/** ‹ ›로 넘길 수 있는 달: 일정이 있는 첫 달부터 마지막 달까지, 오늘이 든 달이 그 밖이면 넣는다 */
export function calendarRange(months: string[], today: string): { first: string; last: string } {
  const now = monthOfDue(today);
  const sorted = [...months].sort();
  const first = sorted[0] && sorted[0] < now ? sorted[0] : now;
  const last = sorted.at(-1) && sorted.at(-1)! > now ? sorted.at(-1)! : now;
  return { first, last };
}

function scheduleDays(items: { due: string; major: Major }[], month: string, major: Major | null): string[] {
  return [...new Set(items.filter((x) => !isMonthDue(x.due) && monthOfDue(x.due) === month && (major === null || x.major === major)).map((x) => x.due))].sort();
}

/**
 * 달을 열 때 고를 날. 오늘이 든 달이면 오늘(오늘 일정이 없으면 그 달에서 오늘 뒤 첫 일정 날, 그것도 없으면 오늘),
 * 다른 달이면 그 달의 첫 일정 날(없으면 고르지 않는다)
 */
export function selectionForMonth(month: string, items: { due: string; major: Major }[], today: string, major: Major | null): string | null {
  const days = scheduleDays(items, month, major);
  if (month === monthOfDue(today)) {
    if (days.includes(today)) return today;
    return days.find((d) => d > today) ?? today;
  }
  return days[0] ?? null;
}

/** 고른 날의 일 단위 일정(대분류 거르기 포함, 식별자 순) */
export function daySchedules(items: ScheduleItem[], date: string, major: Major | null): ScheduleItem[] {
  return sortForTab(items.filter((x) => x.due === date && (major === null || x.major === major)), "upcoming");
}

/** 그 달의 달 단위 일정(대분류 거르기 포함, 식별자 순) */
export function monthUnitSchedules(items: ScheduleItem[], month: string, major: Major | null): ScheduleItem[] {
  return sortForTab(items.filter((x) => x.due === month && (major === null || x.major === major)), "upcoming");
}

/** 키보드로 날짜를 옮긴다(화살표: 하루·한 주, Home·End: 그 달 처음·끝). 그 달 밖으로는 나가지 않는다 */
export function moveDay(date: string, key: string): string | null {
  const month = monthOfDue(date);
  const last = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  let next: string;
  if (key === "Home") next = `${month}-01`;
  else if (key === "End") next = last;
  else if (key in step) next = addDays(date, step[key]!);
  else return null;
  if (next < `${month}-01`) return `${month}-01`;
  if (next > last) return last;
  return next;
}

// ---- 목록의 달 나눠 받기(4.7-1, 4.6-2) ----

/** 처음과 "더 보기"마다 이만큼 넘게 보이도록 달 파일을 받는다 */
export const LIST_BATCH = 40;
/** 한 번에 받는 달 파일 최대 수(거른 대분류의 일정이 드문 달이 이어져도 첫 화면 크기 안에 머물게) */
export const LIST_MONTH_STEP = 6;

/** 그 탭이 쓰는 달(색인 순서). 다가오는 일정은 이번 달부터 오래된 달 먼저, 지난 일정은 이번 달부터 최근 달 먼저(이번 달에는 지난 날 일정이 있을 수 있다) */
export function tabMonths(index: ScheduleIndex, today: string, tab: ScheduleTab): ScheduleIndex["months"] {
  const now = monthOfDue(today);
  return tab === "upcoming" ? index.months.filter((m) => m.month >= now) : index.months.filter((m) => m.month <= now).reverse();
}

/**
 * 보일 달: steps번(처음 1) 받았을 때까지의 달. 대분류를 고르면 그 대분류의 수로 센다.
 * 이번 달은 두 탭의 일정이 섞여 있어 세지 않는다(이번 달이 지난 일정뿐이어도 다가오는 일정 첫 화면이 비지 않게)
 */
export function monthsToShow(index: ScheduleIndex, today: string, tab: ScheduleTab, major: Major | null, steps: number): { months: string[]; more: boolean } {
  const all = tabMonths(index, today, tab);
  const now = monthOfDue(today);
  const count = (m: ScheduleIndex["months"][number]) => (m.month === now ? 0 : major === null ? m.count : (m.majors[major] ?? 0));
  let i = 0;
  let total = 0;
  for (let step = 1; step <= steps && i < all.length; step++) {
    let added = 0;
    while (i < all.length && added < LIST_MONTH_STEP && (added === 0 || total < step * LIST_BATCH)) {
      total += count(all[i]!);
      i++;
      added++;
    }
  }
  return { months: all.slice(0, i).map((m) => m.month), more: i < all.length };
}

/** 그 달이 보일 때까지 필요한 받기 횟수(일정 주소로 들어와 먼 달의 일정을 보일 때). 그 탭에 없는 달이면 1 */
export function stepsToInclude(index: ScheduleIndex, today: string, tab: ScheduleTab, month: string): number {
  if (!tabMonths(index, today, tab).some((m) => m.month === month)) return 1;
  for (let steps = 1; ; steps++) if (monthsToShow(index, today, tab, null, steps).months.includes(month)) return steps;
}

/** 일정 화면을 처음 열 때 받는 달 파일: 목록의 다가오는 일정 첫 묶음과 달력의 이번 달(크기 측정 4.6-2와 같은 규칙) */
export function firstLoadMonths(index: ScheduleIndex, today: string): string[] {
  const months = new Set(monthsToShow(index, today, "upcoming", null, 1).months);
  if (index.months.some((m) => m.month === monthOfDue(today))) months.add(monthOfDue(today));
  return [...months].sort();
}

// ---- 일정 주소(4.7-6) ----

export type ScheduleRefResolution = { kind: "live"; id: number; month: string } | { kind: "merged"; into: number } | null;

/** 일정 주소의 식별자를 그 식별자 묶음에서 찾는다. 살아 있으면 그 달, 흡수된 것이면 남는 것, 지웠거나 없으면 null */
export function resolveScheduleRef(id: number, chunk: ScheduleRefChunk): ScheduleRefResolution {
  const key = String(id);
  const month = Object.hasOwn(chunk.months, key) ? chunk.months[key] : undefined;
  if (month) return { kind: "live", id, month };
  const into = Object.hasOwn(chunk.merged, key) ? chunk.merged[key] : undefined;
  if (into !== undefined && into !== id) return { kind: "merged", into };
  return null;
}

export function scheduleDomId(id: number): string {
  return `schedule-${id}`;
}
