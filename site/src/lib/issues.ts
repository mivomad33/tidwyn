// 이슈 목록 정렬·거르기(4.3-1)와 이슈 목록·페이지의 날짜 줄(앱과 정적 HTML이 같이 쓴다, U1 4.3-1)
import { dateText, yearOf } from "./format.ts";
import type { IssueListItem, Major } from "./types.ts";

export type StatusFilter = IssueListItem["status"] | null;

/** 최근 업데이트일이 늦은 것부터. 같으면 식별자가 큰 것(나중에 생긴 것)부터. 날짜가 없으면 뒤로 */
export function sortIssues(issues: IssueListItem[]): IssueListItem[] {
  return [...issues].sort((a, b) => {
    const da = a.latestDate ?? "";
    const db = b.latestDate ?? "";
    if (da !== db) return da < db ? 1 : -1;
    return b.id - a.id;
  });
}

export function filterIssues(issues: IssueListItem[], major: Major | null, status: StatusFilter): IssueListItem[] {
  return sortIssues(issues).filter((i) => (major === null || i.category.major === major) && (status === null || i.status === status));
}

export const ISSUE_PAGE_SIZE = 100;

/** 이슈 목록 줄: "진행 중 · 최근 11월 3일 · 전개 4건". 기준 해는 목록이 정한다(가장 최근 업데이트일의 해) */
export function issueListLine(issue: Pick<IssueListItem, "status" | "latestDate" | "count">, refYear: string | undefined): string {
  return [issue.status, issue.latestDate && `최근 ${dateText(issue.latestDate, refYear)}`, `전개 ${issue.count}건`].filter(Boolean).join(" · ");
}

/** 이슈 페이지 제목 아래 줄: "10월 1일 시작 · 최근 11월 3일 · 전개 4건". 기준 해는 최근 업데이트일의 해 */
export function issueMetaLine(issue: Pick<IssueListItem, "startDate" | "latestDate" | "count">): string {
  const ref = issue.latestDate ? yearOf(issue.latestDate) : undefined;
  return [issue.startDate && `${dateText(issue.startDate, ref)} 시작`, issue.latestDate && `최근 ${dateText(issue.latestDate, ref)}`, `전개 ${issue.count}건`].filter(Boolean).join(" · ");
}
