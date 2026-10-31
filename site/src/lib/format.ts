// 날짜 글자와 페이지 제목. 날짜는 KST 대상일 그대로 쓴다(4.3-6): 문자열을 달력 날짜로만 다루고 시간대를 바꾸지 않는다.

import { monthDay } from "../../../src/publicSite.ts";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
}

export { monthDay };

/** "2026-10-27" → "10월 27일 (화)" */
export function monthDayWeekday(date: string): string {
  const [y, m, d] = parts(date);
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
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

/** 타임라인 같은 짧은 날짜: 기준 해와 같으면 "10-27", 다르면 "2025-10-27" */
export function shortDate(date: string, refYear?: string): string {
  return !refYear || date.startsWith(refYear + "-") ? date.slice(5) : date;
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
