// 이슈 목록(4.3-1): 흡수되지 않은 이슈를 최근 업데이트일 순으로, 대분류·상태로 거른다
import { useMemo, useState } from "react";
import { ALL_MAJORS, BackLink, CategoryLine, ChipFilter, Empty, ErrorState, Layout, Loading, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { ISSUE_PAGE_SIZE, filterIssues, type StatusFilter } from "../lib/issues.ts";
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
  const items = useMemo(() => (res.status === "ok" ? filterIssues(res.data.issues, major, status) : []), [res, major, status]);

  return (
    <Layout left={<BackLink to="/" label="브리프" />}>
      <h1 className="page-title pad">이슈 목록</h1>
      <ChipFilter
        label="대분류"
        options={ALL_MAJORS}
        value={major}
        onChange={(v) => {
          setMajor(v);
          setLimit(ISSUE_PAGE_SIZE);
        }}
      />
      <ChipFilter
        label="상태"
        options={STATUSES}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setLimit(ISSUE_PAGE_SIZE);
        }}
      />
      {res.status === "error" && <ErrorState onRetry={() => retry([url])} />}
      {(res.status === "loading" || res.status === "idle") && <Loading />}
      {res.status === "ok" && items.length === 0 && <Empty>{res.data.issues.length ? "이 조건의 이슈가 없다." : "아직 이슈가 없다."}</Empty>}
      {items.length > 0 && (
        <>
          <p className="count">{items.length.toLocaleString("ko-KR")}개</p>
          <ul className="list">
            {items.slice(0, limit).map((i) => (
              <li key={i.id} className="item">
                <Link to={issuePath(i.id)} className="item-btn">
                  <CategoryLine major={i.category.major} minor={i.category.minor} />
                  <span className="title">{i.name}</span>
                  <span className="cont">
                    {i.status}
                    {i.latestDate ? ` · 최근 ${i.latestDate}` : ""} · 전개 {i.count}건
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length > limit && (
            <div className="more">
              <button type="button" className="retry" onClick={() => setLimit((n) => n + ISSUE_PAGE_SIZE)}>
                더 보기
              </button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
}
