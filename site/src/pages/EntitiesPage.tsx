// 인물·기관·국가 목록(4.7-3): 최근 등장일 순, 종류로 거른다. 거르기마다 0쪽만 먼저 받고 나머지 쪽은 "더 보기"로 받는다(4.6-2).
import { useState } from "react";
import { BackLink, Empty, ErrorState, Layout, Loading, useFocusNewRow, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { ENTITY_FILTER_LABEL } from "../lib/entities.ts";
import { shortDate } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { entitiesPath, entityPath } from "../lib/routes.ts";
import type { EntityFilter, EntityListPage } from "../lib/types.ts";
import { ENTITY_FILTERS } from "../../../src/siteTypes.ts";
import { Link, navigate } from "../router.tsx";

export function EntitiesPage({ filter }: { filter: EntityFilter }) {
  useTitle("인물·기관·국가");
  return (
    <Layout left={<BackLink to="/" label="브리프" />}>
      <h1 className="page-title pad">인물·기관·국가</h1>
      <p className="count">최근 등장 순</p>
      <div className="chips" role="group" aria-label="종류">
        {ENTITY_FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? "on" : ""} aria-pressed={f === filter} onClick={() => navigate(entitiesPath(f), { replace: true, quiet: true })}>
            {ENTITY_FILTER_LABEL[f]}
          </button>
        ))}
      </div>
      {/* 거르기를 바꾸면 쪽 상태를 새로 시작한다 */}
      <EntityPages key={filter} filter={filter} />
    </Layout>
  );
}

function EntityPages({ filter }: { filter: EntityFilter }) {
  const [shown, setShown] = useState(1);
  const more = useFocusNewRow<HTMLDivElement>("li.item");
  const firstUrl = dataUrl.entityList(filter, 0);
  const first = useResource<EntityListPage>(firstUrl);
  if (first.status === "error") return <ErrorState onRetry={() => retry([firstUrl])} />;
  if (first.status !== "ok") return <Loading />;
  const { total, pages } = first.data;
  if (total === 0) return <Empty>{filter === "all" ? "아직 인물·기관·국가가 없다." : "이 종류에 해당하는 항목이 없다."}</Empty>;
  const pageNos = Array.from({ length: Math.min(shown, pages) }, (_, i) => i);
  return (
    <>
      <p className="count">{total.toLocaleString("ko-KR")}개</p>
      <div ref={more.ref}>
        {pageNos.map((page) => (
          <EntityPageRows
            key={page}
            filter={filter}
            page={page}
            last={page === pageNos.length - 1}
            hasNext={page + 1 < pages}
            onMore={() => {
              more.mark();
              setShown(page + 2);
            }}
          />
        ))}
      </div>
    </>
  );
}

function EntityPageRows({ filter, page, last, hasNext, onMore }: { filter: EntityFilter; page: number; last: boolean; hasNext: boolean; onMore: () => void }) {
  const url = dataUrl.entityList(filter, page);
  const res = useResource<EntityListPage>(url);
  if (res.status === "error") return <ErrorState onRetry={() => retry([url])} />;
  if (res.status !== "ok") return <Loading />;
  const year = res.data.items[0]?.latestDate.slice(0, 4);
  return (
    <>
      <ul className="list">
        {res.data.items.map((e) => (
          <li key={e.id} className="item">
            <Link to={entityPath(e.id)} className="item-btn">
              <span className="cat muted-cat">
                {e.kind} · 최근 {shortDate(e.latestDate, year)} · 뉴스 {e.count.toLocaleString("ko-KR")}건
              </span>
              <span className="title small">{e.name}</span>
              {e.description && <span className="cont">{e.description}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {last && hasNext && (
        <div className="more">
          <button type="button" className="retry" onClick={onMore}>
            더 보기
          </button>
        </div>
      )}
    </>
  );
}
