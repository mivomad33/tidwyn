// 6단계 지표 하나의 페이지(4.7-3): 마지막 값·전날 대비·날짜·출처, 기간 '1개월 | 1년 | 5년'(처음 1년), 큰 그래프, 관련 이슈(많으면 더 보기).
// 목록에 없는 식별자(없는 지표, 공개를 끈 지표)는 없는 페이지, 값이 하나도 없는 지표는 "아직 값이 없다"를 보인다(4.7-2, 4.7-7)
import { useState } from "react";
import { BackLink, Empty, ErrorState, Layout, Loading, useFocusNewRow, useTitle } from "../components/common.tsx";
import { ChangeText, LineChart, SourceNote } from "../components/indicatorView.ts";
import { retry, useResource } from "../data.ts";
import { DEFAULT_PERIOD, PERIODS, changeLabel, changePrefix, periodPoints, readingDateText, readingValueText, relatedShown, type Period } from "../lib/indicators.ts";
import { dataUrl } from "../lib/paths.ts";
import { issuePath } from "../lib/routes.ts";
import type { IndicatorCard, IndicatorList, IndicatorSeries } from "../lib/types.ts";
import { Link } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

export const NO_VALUES_TEXT = "아직 값이 없다.";

export function IndicatorPage({ id }: { id: string }) {
  const listUrl = dataUrl.indicatorList();
  const listRes = useResource<IndicatorList>(listUrl);
  const card = listRes.status === "ok" ? (listRes.data.indicators.find((c) => c.id === id) ?? null) : null;
  const seriesUrl = card?.last ? dataUrl.indicatorSeries(id) : null;
  const seriesRes = useResource<IndicatorSeries>(seriesUrl);
  useTitle(card?.name ?? "지표");
  const back = <BackLink to="/indicators" label="지표" />;

  if (listRes.status === "error") {
    return (
      <Layout left={back}>
        <ErrorState onRetry={() => retry([listUrl])} />
      </Layout>
    );
  }
  if (listRes.status !== "ok") {
    return (
      <Layout left={back}>
        <Loading />
      </Layout>
    );
  }
  if (!card) return <NotFoundPage />;
  return (
    <Layout left={back}>
      <article className="ind">
        <h1 className="page-title">{card.name}</h1>
        <Header card={card} />
        {card.last ? (
          seriesRes.status === "error" ? (
            <ErrorState onRetry={() => retry([seriesUrl])} />
          ) : seriesRes.status !== "ok" ? (
            <Loading />
          ) : (
            <Chart card={card} series={seriesRes.data} />
          )
        ) : (
          <Empty>{NO_VALUES_TEXT}</Empty>
        )}
        <RelatedIssues card={card} />
        <div className="ind-foot">
          <SourceNote metas={[card]} />
        </div>
      </article>
    </Layout>
  );
}

function Header({ card }: { card: IndicatorCard }) {
  const last = card.last;
  // 값이 없으면 출처는 아래 출처 줄에만 둔다(같은 줄을 두 번 쓰지 않는다)
  if (!last) return null;
  return (
    <p className="ind-meta">
      <b className="ind-v">{readingValueText(card, last)}</b> <ChangeText label={changeLabel(card, last.value, last.change, false)} prefix={changePrefix(card)} /> · {readingDateText(last.date)} · {card.credit}
    </p>
  );
}

function Chart({ card, series }: { card: IndicatorCard; series: IndicatorSeries }) {
  const [period, setPeriod] = useState<Period>(DEFAULT_PERIOD);
  const points = periodPoints(series.points, period);
  return (
    <>
      <div className="seg ind-seg" role="group" aria-label="기간">
        {PERIODS.map((p) => (
          <button key={p.id} type="button" className={p.id === period ? "on" : ""} aria-pressed={p.id === period} onClick={() => setPeriod(p.id)}>
            {p.label}
          </button>
        ))}
      </div>
      {points.length === 0 ? <Empty>이 기간에 값이 없다.</Empty> : <LineChart meta={card} points={points} height={220} grid />}
      {points.length === 1 && <p className="ind-note">이 기간에는 값이 하나뿐이다.</p>}
    </>
  );
}

function RelatedIssues({ card }: { card: IndicatorCard }) {
  const [expanded, setExpanded] = useState(false);
  const more = useFocusNewRow<HTMLDivElement>("li");
  if (card.issues.length === 0) return null;
  const { shown, more: rest } = relatedShown(card.issues, expanded);
  return (
    <section aria-labelledby="ind-rel">
      <h2 id="ind-rel" className="h">
        관련 이슈
      </h2>
      <div ref={more.ref}>
        <ul className="evlist">
          {shown.map((i) => (
            <li key={i.id}>
              <Link to={issuePath(i.id)} className="ev-link">
                <span className="t">{i.name}</span>
              </Link>
            </li>
          ))}
        </ul>
        {rest > 0 && (
          <div className="more tight">
            <button
              type="button"
              className="retry"
              onClick={() => {
                more.mark();
                setExpanded(true);
              }}
            >
              더 보기 ({rest})
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
