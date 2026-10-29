// 6단계 지표 페이지(4.7-2): 한국 / 미국·국제 묶음의 카드(값, 전날 대비, 1년 작은 그래프). 바닥에 출처 표시와 FRED 고지(4.7-6)
import { BackLink, Empty, ErrorState, Layout, Loading, useTitle } from "../components/common.tsx";
import { FredNotice, IndicatorCardView, SourceNote } from "../components/indicatorView.ts";
import { retry, useResource } from "../data.ts";
import { asOfLine, groupCards, visibleCards } from "../lib/indicators.ts";
import { dataUrl } from "../lib/paths.ts";
import type { IndicatorList } from "../lib/types.ts";
import { Link } from "../router.tsx";

export function IndicatorsPage() {
  useTitle("지표");
  const url = dataUrl.indicatorList();
  const res = useResource<IndicatorList>(url);
  const back = <BackLink to="/" label="브리프" />;
  if (res.status === "error") {
    return (
      <Layout left={back}>
        <ErrorState onRetry={() => retry([url])} />
      </Layout>
    );
  }
  if (res.status !== "ok") {
    return (
      <Layout left={back}>
        <Loading />
      </Layout>
    );
  }
  const cards = visibleCards(res.data);
  return (
    <Layout left={back}>
      <div className="ind">
        <h1 className="page-title">지표</h1>
        <p className="ind-meta">{asOfLine(res.data)}</p>
        {cards.length === 0 && <Empty>아직 지표 값이 없다.</Empty>}
        {groupCards(cards).map((g) => (
          <section key={g.group} aria-labelledby={`ind-${g.group}`}>
            <h2 id={`ind-${g.group}`} className="h">
              {g.group}
            </h2>
            <ul className="icards">
              {g.cards.map((c) => (
                <IndicatorCardView key={c.id} card={c} Link={Link} />
              ))}
            </ul>
          </section>
        ))}
        <div className="ind-foot">
          <SourceNote metas={cards} />
          <FredNotice />
        </div>
      </div>
    </Layout>
  );
}
