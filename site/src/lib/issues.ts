// 이슈 목록 정렬·거르기(4.3-1)
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
