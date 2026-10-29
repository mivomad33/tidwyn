// 날짜 목록(4.2-1): 저장된 모든 날짜를 최근 순, 달별로 묶어 보인다. 4.5단계: 날짜마다 읽은 정도(4.5-1)
import { BackLink, Empty, ErrorState, Layout, Loading, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { groupDatesByMonth, monthDayWeekday, monthLabel } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { readProgress } from "../lib/readMarks.ts";
import { briefPath } from "../lib/routes.ts";
import type { SiteDates } from "../lib/types.ts";
import { readStore, useReadVersion } from "../readMarks.ts";
import { Link } from "../router.tsx";

export function DatesPage() {
  useTitle("날짜 목록");
  const url = dataUrl.dates();
  const res = useResource<SiteDates>(url);
  useReadVersion();
  const totals = new Map(res.status === "ok" ? res.data.dates.map((d, i) => [d, res.data.storyCounts?.[i]] as const) : []);
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
                    <Link to={briefPath(d)} className="row-link nrow">
                      <span>{monthDayWeekday(d)}</span>
                      <ReadProgress read={readStore.readCount(d)} total={totals.get(d)} />
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

function ReadProgress({ read, total }: { read: number; total: number | undefined }) {
  const p = readProgress(read, total);
  if (p.kind === "none") return null;
  if (p.kind === "all") {
    return (
      <small className="read-prog">
        <span className="read-mk" aria-hidden="true">
          ✓
        </span>
        다 읽음
      </small>
    );
  }
  return <small className="read-prog">{`${p.read}/${p.total} 읽음`}</small>;
}
