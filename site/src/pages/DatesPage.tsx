// 날짜 목록(4.2-1): 저장된 모든 날짜를 최근 순, 달별로 묶어 보인다
import { BackLink, Empty, ErrorState, Layout, Loading, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { groupDatesByMonth, monthDayWeekday, monthLabel } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { briefPath } from "../lib/routes.ts";
import type { SiteDates } from "../lib/types.ts";
import { Link } from "../router.tsx";

export function DatesPage() {
  useTitle("날짜 목록");
  const url = dataUrl.dates();
  const res = useResource<SiteDates>(url);
  return (
    <Layout left={<BackLink to="/" label="브리프" />}>
      <h1 className="page-title pad">날짜 목록</h1>
      {res.status === "error" && <ErrorState onRetry={() => retry([url])} />}
      {(res.status === "loading" || res.status === "idle") && <Loading />}
      {res.status === "ok" &&
        (res.data.dates.length === 0 ? (
          <Empty>아직 저장된 브리프가 없다.</Empty>
        ) : (
          groupDatesByMonth(res.data.dates).map((g) => (
            <section key={g.month} aria-labelledby={`m-${g.month}`}>
              <h2 id={`m-${g.month}`} className="h list-h">
                {monthLabel(g.month)}
              </h2>
              <ul className="list">
                {g.dates.map((d) => (
                  <li key={d} className="row">
                    <Link to={briefPath(d)} className="row-link">
                      {monthDayWeekday(d)}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        ))}
    </Layout>
  );
}
