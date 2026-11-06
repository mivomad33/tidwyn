// 이슈 목록(4.3-1): 흡수되지 않은 이슈를 최근 업데이트일 순으로, 대분류·상태로 거른다
import { useMemo, useState } from "react";
import { ALL_CHIP_TEXT, countChips } from "../lib/chips.ts";
import { ALL_MAJORS, BriefBackLink, CategoryLine, ChipFilter, Empty, ErrorState, Layout, Loading, useFocusNewRow, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { ISSUE_PAGE_SIZE, filterIssues, issueListLine, type StatusFilter } from "../lib/issues.ts";
import { latestYear } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { issuePath } from "../lib/routes.ts";
import type { Major, SiteIssueList } from "../lib/types.ts";
import { Link } from "../router.tsx";

const STATUSES = ["진행 중", "종료"] as const;

export function IssuesPage() {
  useTitle("이슈 목록");
  const url = dataUrl.issueList();
  const res = useResource<SiteIssueList>(url);
  const [major, setMajor] = useState<Major | null>(null);
  const [status, setStatus] = useState<StatusFilter>(null);
  const [limit, setLimit] = useState(ISSUE_PAGE_SIZE);
  const more = useFocusNewRow<HTMLUListElement>("li.item");
  const refYear = res.status === "ok" ? latestYear(res.data.issues.map((i) => i.latestDate)) : undefined;
  const items = useMemo(() => (res.status === "ok" ? filterIssues(res.data.issues, major, status) : []), [res, major, status]);
  // U2 4.3-1: 두 줄 모두 다른 줄의 선택과 관계없이 전체 목록으로 센다(다른 줄을 바꿔도 칩이 사라지거나 나타나지 않는다)
  const all = res.status === "ok" ? res.data.issues : [];
  const majorChips = useMemo(() => countChips(all, (i) => i.category.major, ALL_MAJORS), [all]);
  const statusChips = useMemo(() => countChips(all, (i) => i.status, STATUSES), [all]);

  return (
    <Layout left={<BriefBackLink />}>
      <h1 className="page-title pad">이슈 목록</h1>
      {all.length > 0 && (
        <>
      <ChipFilter
        label="대분류"
        allText={ALL_CHIP_TEXT.major}
        total={all.length}
        options={majorChips}
        value={major}
        onChange={(v) => {
          setMajor(v);
          setLimit(ISSUE_PAGE_SIZE);
        }}
      />
      <ChipFilter
        label="상태"
        allText={ALL_CHIP_TEXT.status}
        total={all.length}
        options={statusChips}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setLimit(ISSUE_PAGE_SIZE);
        }}
      />
        </>
      )}
      {res.status === "error" && <ErrorState onRetry={() => retry([url])} />}
      {(res.status === "loading" || res.status === "idle") && <Loading />}
      {res.status === "ok" && items.length === 0 && <Empty>{res.data.issues.length ? "이 조건의 이슈가 없다." : "아직 이슈가 없다."}</Empty>}
      {items.length > 0 && (
        <>
          <p className="count">{items.length.toLocaleString("ko-KR")}개</p>
          <ul className="list" ref={more.ref}>
            {items.slice(0, limit).map((i) => (
              <li key={i.id} className="item">
                <Link to={issuePath(i.id)} className="item-btn">
                  <CategoryLine major={i.category.major} minor={i.category.minor} />
                  <span className="title">{i.name}</span>
                  <span className="cont">{issueListLine(i, refYear)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length > limit && (
            <div className="more">
              <button type="button" className="retry" onClick={() => {
                  more.mark();
                  setLimit((n) => n + ISSUE_PAGE_SIZE);
                }}>
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
