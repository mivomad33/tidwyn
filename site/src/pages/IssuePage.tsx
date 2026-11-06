// 이슈 페이지(4.3-2). 흡수된 이슈 주소는 남는 이슈 주소로 바꾸고 합쳐졌다는 줄을 보인다. 5단계: 타임라인 아래 '일정'(4.7-5). 6단계: 타임라인과 '일정' 사이 '관련 지표'(4.7-4). 7단계: '관련 지표'와 '일정' 사이 '관련 영상'(4.7-2)
import { useEffect, useMemo } from "react";
import { kstDate } from "../../../src/kst.ts";
import { BackLink, BriefBackLink, CategoryLine, Empty, ErrorState, Layout, Loading, NewsTitle, ReadCheck, useTitle } from "../components/common.tsx";
import { IssueIndicators } from "../components/IssueIndicators.tsx";
import { IssueVideos } from "../components/IssueVideos.tsx";
import { IssueSchedules } from "../components/scheduleView.ts";
import { IssueEntityChips } from "../components/termView.ts";
import { retry, useResource } from "../data.ts";
import { issueEntityChips } from "../lib/entities.ts";
import { issueMetaLine } from "../lib/issues.ts";
import { issueLabel, monthDay, shortDate, yearOf } from "../lib/format.ts";
import { chunkOf, dataUrl } from "../lib/paths.ts";
import { prevPathOf } from "../lib/navState.ts";
import { briefPath, issuePath, parseRoute, resolveIssueId } from "../lib/routes.ts";
import type { IssueChunk, SiteIssueList } from "../lib/types.ts";
import { Link, navigate, useLocation } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

interface MergedState {
  mergedFrom: { id: number; on: string | null };
}

function mergedFromState(state: unknown): MergedState["mergedFrom"] | null {
  if (state && typeof state === "object" && "mergedFrom" in state) return (state as MergedState).mergedFrom;
  return null;
}

function cameFromBrief(state: unknown): boolean {
  const prev = prevPathOf(state);
  if (prev === null) return false;
  const name = parseRoute(prev).name;
  return name === "latest" || name === "brief";
}

export function IssuePage({ id }: { id: number }) {
  const loc = useLocation();
  const listUrl = dataUrl.issueList();
  const listRes = useResource<SiteIssueList>(listUrl);
  const target = listRes.status === "ok" ? resolveIssueId(id, listRes.data) : null;
  const chunkUrl = target ? dataUrl.issueChunk(chunkOf(target.id)) : null;
  const chunkRes = useResource<IssueChunk>(chunkUrl);
  const issue = chunkRes.status === "ok" && target ? (chunkRes.data.issues[String(target.id)] ?? null) : null;

  useEffect(() => {
    if (target?.mergedFrom) navigate(issuePath(target.id), { replace: true, state: { mergedFrom: target.mergedFrom } satisfies MergedState });
  }, [target?.id, target?.mergedFrom]);

  useTitle(issue ? issueLabel(issue) : "이슈");
  const today = useMemo(() => kstDate(new Date()), []);
  // 바로 앞 화면이 브리프면 '‹ 브리프' 계열, 그 밖(이슈 목록, 검색, 다른 이슈, 주소로 바로 연 경우 등)은 '‹ 이슈'다(U1 4.4-2, S5)
  const back = cameFromBrief(loc.state) ? <BriefBackLink /> : <BackLink to="/issues" label="이슈" />;
  const urls = [listUrl, chunkUrl];

  if (listRes.status === "error" || chunkRes.status === "error") {
    return (
      <Layout left={back}>
        <ErrorState onRetry={() => retry(urls)} />
      </Layout>
    );
  }
  if (listRes.status !== "ok" || (target && chunkRes.status !== "ok")) {
    return (
      <Layout left={back}>
        <Loading />
      </Layout>
    );
  }
  if (!target || !issue) return <NotFoundPage />;

  const merged = target.mergedFrom ?? mergedFromState(loc.state);
  const year = issue.latestDate ? yearOf(issue.latestDate) : undefined;
  return (
    <Layout left={back}>
      <article className="iss">
        {merged && (
          <p className="notice" role="note">
            이 이슈는 {merged.on ? `${monthDay(merged.on)}에 ` : ""}
            {issue.name}에 합쳐졌다.
          </p>
        )}
        <CategoryLine major={issue.category.major} minor={issue.category.minor} isNewMinor={issue.category.isNewMinor} extra={issue.status} />
        <h1 className="name">{issue.name}</h1>
        {issue.aliases.length > 0 && <p className="aliases">다른 이름: {issue.aliases.join(", ")}</p>}
        <p className="meta">
          {issueMetaLine(issue)}
        </p>
        {issue.summary && <div className="summary">{issue.summary}</div>}
        <h2 className="h">타임라인</h2>
        {issue.timeline.length > 0 ? (
          <ol className="tl">
            {issue.timeline.map((t) => (
              <li key={`${t.date}-${t.key}`}>
                <Link to={briefPath(t.date, t.key)} className="nrow">
                  <div className="nrow-txt">
                    <small>{shortDate(t.date, year)}</small>
                    <NewsTitle date={t.date} newsKey={t.key}>
                      {t.title}
                    </NewsTitle>
                  </div>
                  <ReadCheck date={t.date} newsKey={t.key} />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <Empty inline>아직 전개가 없다.</Empty>
        )}
        <IssueIndicators indicators={issue.indicators} newsDates={issue.timeline.map((t) => t.date)} />
        <IssueVideos refs={issue.videoRefs} today={today} />
        <IssueSchedules lines={issue.schedules} today={today} Link={Link} />
        {issueEntityChips(issue.entities).length > 0 && (
          <>
            <h2 className="h">등장 인물·기관·국가</h2>
            <IssueEntityChips entities={issue.entities} Link={Link} />
          </>
        )}
        {issue.related.length > 0 && (
          <>
            <h2 className="h">관련 이슈</h2>
            <div className="rel">
              {issue.related.map((r) => (
                <Link key={r.id} to={issuePath(r.id)}>
                  {r.name}
                </Link>
              ))}
            </div>
          </>
        )}
      </article>
    </Layout>
  );
}
