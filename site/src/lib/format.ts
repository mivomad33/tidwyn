// 날짜 글자와 페이지 제목. 날짜는 KST 대상일 그대로 쓴다(4.3-6): 문자열을 달력 날짜로만 다루고 시간대를 바꾸지 않는다.

import { monthDay } from "../../../src/publicSite.ts";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

export { monthDay };

// ---- 날짜 표기(U1 4.3-1, docs/design.md "날짜 표기") ----
// 앱과 정적 HTML이 같은 함수를 쓴다. 기준 해(refYear, "2026")는 그 화면이 정한다(최근 브리프 날짜의 해 등). 기준 해가 없으면 같은 해로 본다.
// 화면 글에는 'YYYY-MM-DD'를 쓰지 않는다.

/** 날짜의 해: "2026-10-27" → "2026" */
export function yearOf(date: string): string {
  return date.slice(0, 4);
}

function sameYear(date: string, refYear?: string): boolean {
  return !refYear || yearOf(date) === refYear;
}

/** 요일 글자: "화" */
export function weekdayOf(date: string): string {
  const [y, m, d] = parts(date);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/** 날짜 글: 기준 해와 같으면 "10월 27일", 다르면 "2025년 10월 27일" */
export function dateText(date: string, refYear?: string): string {
  return sameYear(date, refYear) ? monthDay(date) : fullKoreanDate(date);
}

/** 요일을 붙인 날짜 글: "10월 27일 (화)", 다르면 "2025년 10월 27일 (월)" */
export function dateTextWeekday(date: string, refYear?: string): string {
  return `${dateText(date, refYear)} (${weekdayOf(date)})`;
}

/** "2026-10-27" → "10월 27일 (화)"(기준 해 없이) */
export function monthDayWeekday(date: string): string {
  return dateTextWeekday(date);
}

/** "2026-10-27" → "2026년 10월 27일" */
export function fullKoreanDate(date: string): string {
  const [y, m, d] = parts(date);
  return `${y}년 ${m}월 ${d}일`;
}

/** "2026-10" → "2026년 10월" */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${y}년 ${m}월`;
}

/** 일 또는 달 단위 날짜 글: "10월 27일"·"9월", 기준 해와 다르면 "2025년 10월 27일"·"2025년 9월" */
export function dayOrMonthText(date: string, refYear?: string): string {
  if (date.length !== 7) return dateText(date, refYear);
  return sameYear(date, refYear) ? monthOnly(date) : monthLabel(date);
}

/** 해 없는 달 글: "9월" */
function monthOnly(month: string): string {
  return `${Number(month.slice(5, 7))}월`;
}

/** 날짜 목록의 기준 해: 가장 늦은 날짜의 해(없으면 undefined) */
export function latestYear(dates: readonly (string | null | undefined)[]): string | undefined {
  let last: string | undefined;
  for (const d of dates) if (d && (!last || d > last)) last = d;
  return last ? yearOf(last) : undefined;
}

/** 줄 앞 날짜 칸·칩 같은 좁은 자리: 기준 해와 같으면 "10-27", 다르면 "'25 10-27" */
export function shortDate(date: string, refYear?: string): string {
  return sameYear(date, refYear) ? date.slice(5) : `'${date.slice(2, 4)} ${date.slice(5)}`;
}

/** 그래프 축 글자(처음·끝 두 자리). 두 끝의 해가 같으면 "10-28"(월별 "10월"), 해를 넘으면 둘 다 해를 붙인다("'25 10-28", 월별 "'25 10월") */
export function axisDates(first: string, last: string): [string, string] {
  const cross = yearOf(first) !== yearOf(last);
  const one = (date: string) => {
    const body = date.length === 7 ? monthOnly(date) : date.slice(5);
    return cross ? `'${date.slice(2, 4)} ${body}` : body;
  };
  return [one(first), one(last)];
}

/** 날짜 목록(최근 순)을 달별로 묶는다. 순서는 그대로 */
export function groupDatesByMonth(dates: string[]): { month: string; dates: string[] }[] {
  const groups: { month: string; dates: string[] }[] = [];
  for (const date of dates) {
    const month = date.slice(0, 7);
    const last = groups.at(-1);
    if (last && last.month === month) last.dates.push(date);
    else groups.push({ month, dates: [date] });
  }
  return groups;
}

export const SITE_NAME = "Tidwyn";

/** 페이지 제목(`<title>`) */
export function pageTitle(label?: string): string {
  return label ? `${label} · ${SITE_NAME}` : SITE_NAME;
}

/** `/`의 제목. 브리프 쪽 제목은 탭이 좁아도 이름이 남게 이름부터 쓴다(`docs/design.md`) */
export function latestTitle(): string {
  return `${SITE_NAME} · 최신 뉴스 브리프`;
}

/** 날짜 브리프의 제목. 저장 날짜(`dates`)에 같은 월·일이 둘 이상이면 연도를 넣어 제목이 겹치지 않게 한다 */
export function briefTitle(date: string, dates: readonly string[]): string {
  const same = dates.filter((d) => d.slice(5) === date.slice(5)).length;
  return `${SITE_NAME} · ${same > 1 ? fullKoreanDate(date) : monthDay(date)} 브리프`;
}

/** 이슈 페이지의 제목 글자. 다른 페이지와 이름이 같으면 번호로 구분한다 */
export function issueLabel(issue: { id: number; name: string; dupName?: true }): string {
  return issue.dupName ? `${issue.name} (이슈 ${issue.id})` : issue.name;
}

/** 대상 페이지의 제목 글자. 다른 페이지와 이름이 같으면 번호로 구분한다 */
export function entityLabel(entity: { id: number; name: string; dupName?: true }): string {
  return entity.dupName ? `${entity.name} (대상 ${entity.id})` : entity.name;
}
