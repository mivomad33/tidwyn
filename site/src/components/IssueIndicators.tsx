// 6단계 이슈 페이지의 '관련 지표'(4.7-4): 타임라인 아래·'일정' 위. 고른 공개 지표마다 그래프 하나(기간은 사이트 데이터의 from~to),
// 이 이슈 뉴스가 있는 날(흡수된 이슈의 뉴스 포함, 타임라인의 날짜)에 강조색 점. 그래프 제목을 누르면 지표 하나의 페이지. 그 아래 출처 표시.
// 값이 하나도 없는 지표는 빼고, 남는 것이 없으면 '관련 지표'를 보이지 않는다.
import { Fragment } from "react";
import { retry, useResource, useResources } from "../data.ts";
import { dotIndexes, graphFromText, issueGraphPoints, readingValueText } from "../lib/indicators.ts";
import { dataUrl } from "../lib/paths.ts";
import { indicatorPath } from "../lib/routes.ts";
import type { IndicatorList, IndicatorSeries, IssueIndicator } from "../lib/types.ts";
import { Link } from "../router.tsx";
import { ErrorState, Loading } from "./common.tsx";
import { LineChart, SourceNote } from "./indicatorView.ts";

export function IssueIndicators({ indicators, newsDates }: { indicators: IssueIndicator[] | undefined; newsDates: string[] }) {
  const chosen = indicators ?? [];
  const listUrl = chosen.length ? dataUrl.indicatorList() : null;
  const listRes = useResource<IndicatorList>(listUrl);
  const seriesUrls = chosen.map((i) => dataUrl.indicatorSeries(i.id));
  const seriesRes = useResources<IndicatorSeries>(seriesUrls);
  if (!chosen.length) return null;
  const heading = (
    <h2 className="h" id="iss-ind">
      관련 지표
    </h2>
  );
  if (listRes.status === "error" || seriesRes.some((r) => r.status === "error")) {
    return (
      <>
        {heading}
        <ErrorState onRetry={() => retry([listUrl, ...seriesUrls])} />
      </>
    );
  }
  if (listRes.status !== "ok" || seriesRes.some((r) => r.status !== "ok")) {
    return (
      <>
        {heading}
        <Loading />
      </>
    );
  }
  const graphs = chosen.flatMap((ii, k) => {
    const card = listRes.data.indicators.find((c) => c.id === ii.id);
    const s = seriesRes[k];
    if (!card?.last || s?.status !== "ok") return [];
    const points = issueGraphPoints(s.data.points, ii.from, ii.to);
    if (!points.length) return [];
    return [{ ii, card, points, dots: dotIndexes(points, newsDates) }];
  });
  if (!graphs.length) return null;
  return (
    <section aria-labelledby="iss-ind">
      {heading}
      {graphs.map(({ ii, card, points, dots }) => (
        <Fragment key={ii.id}>
          <div className="igraph">
            <div className="igh">
              <Link to={indicatorPath(card.id)}>
                {card.name}
                <span aria-hidden="true"> ›</span>
              </Link>
              <small>
                {readingValueText(card, card.last!)} · {graphFromText(ii.from)}
              </small>
            </div>
            <LineChart meta={card} points={points} height={130} dots={dots} />
            {dots.length > 0 && (
              <p className="legend">
                <i aria-hidden="true" />이 이슈 뉴스가 있는 날
              </p>
            )}
          </div>
        </Fragment>
      ))}
      <SourceNote metas={graphs.map((g) => g.card)} />
    </section>
  );
}
