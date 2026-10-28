// 주소 해석(4.2-1, 4.3, P4). 화면(DOM) 없이 테스트한다.
import type { SiteIssueList } from "./types.ts";

export type Route =
  | { name: "latest" }
  | { name: "brief"; date: string }
  | { name: "dates" }
  | { name: "issues" }
  | { name: "issue"; id: number }
  | { name: "search"; q: string }
  | { name: "about" }
  | { name: "notFound" };

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 달력에 있는 날짜인지(2026-02-30 같은 것은 아니다) */
export function isValidDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** 경로와 쿼리로 화면을 고른다. 날짜가 저장되었는지는 dates.json을 받은 뒤 `resolveBriefDate`가 본다 */
export function parseRoute(pathname: string, search = ""): Route {
  let p = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (p === "") p = "/";
  if (p === "/") return { name: "latest" };
  if (p === "/dates") return { name: "dates" };
  if (p === "/issues") return { name: "issues" };
  if (p === "/about") return { name: "about" };
  if (p === "/search") return { name: "search", q: new URLSearchParams(search).get("q") ?? "" };
  const issue = /^\/issues\/(0|[1-9]\d{0,15})$/.exec(p);
  if (issue) return { name: "issue", id: Number(issue[1]) };
  const date = /^\/(\d{4}-\d{2}-\d{2})$/.exec(p);
  if (date && isValidDate(date[1]!)) return { name: "brief", date: date[1]! };
  return { name: "notFound" };
}

/** 앱 안에서 화면을 옮긴 뒤 초점을 둘 요소의 id. 검색어 없는 검색 화면은 바로 입력하게 입력란, 나머지는 본문 */
export function focusTargetId(route: Route): "q" | "main" {
  return route.name === "search" && !route.q ? "q" : "main";
}

/** 브리프 주소의 날짜를 저장된 날짜와 맞춘다. `/`는 가장 최근 날짜, 저장되지 않은 날짜는 null(없는 페이지) */
export function resolveBriefDate(route: Route, dates: { latestDate: string | null; dates: string[] }): string | null {
  if (route.name === "latest") return dates.latestDate;
  if (route.name === "brief") return dates.dates.includes(route.date) ? route.date : null;
  return null;
}

/** 이전(더 오래된)·다음(더 최근) 저장일. `dates`는 최근 순 */
export function adjacentDates(dates: string[], date: string): { prev: string | null; next: string | null } {
  const i = dates.indexOf(date);
  if (i < 0) return { prev: null, next: null };
  return { prev: dates[i + 1] ?? null, next: i > 0 ? dates[i - 1]! : null };
}

export interface IssueTarget {
  id: number;
  /** 흡수된 이슈 주소로 들어왔으면 그 정보 */
  mergedFrom: { id: number; on: string | null } | null;
}

/** 이슈 주소의 식별자를 실제로 보일 이슈로 바꾼다. 흡수된 이슈는 남는 이슈로, 없는 식별자는 null */
export function resolveIssueId(id: number, list: SiteIssueList): IssueTarget | null {
  const merged = list.merged[String(id)];
  if (merged) {
    if (!list.issues.some((i) => i.id === merged.into)) return null;
    return { id: merged.into, mergedFrom: { id, on: merged.on } };
  }
  return list.issues.some((i) => i.id === id) ? { id, mergedFrom: null } : null;
}

/** `#<뉴스 키>`의 키. 비었거나 깨졌으면 null */
export function hashKey(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  return safeDecode(raw);
}

export function briefPath(date: string, key?: string): string {
  return key ? `/${date}#${encodeURIComponent(key)}` : `/${date}`;
}

export function issuePath(id: number): string {
  return `/issues/${id}`;
}

export function searchPath(q: string): string {
  return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
}
