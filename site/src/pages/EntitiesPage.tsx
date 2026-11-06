// 인물·기관·국가 목록(4.7-3): 최근 등장일 순, 종류로 거른다. 거르기마다 0쪽만 먼저 받고 나머지 쪽은 "더 보기"로 받는다(4.6-2).
import { useEffect, useState } from "react";
import { BriefBackLink, ChipFilter, Empty, ErrorState, Layout, Loading, useFocusNewRow, useTitle } from "../components/common.tsx";
import { ALL_CHIP_TEXT, countLabel, type ChipOption } from "../lib/chips.ts";
import { yearOf } from "../lib/format.ts";
import { retry, useResource, useResources } from "../data.ts";
import { ENTITY_FILTER_LABEL, entityListLine } from "../lib/entities.ts";
import { dataUrl } from "../lib/paths.ts";
import { entitiesPath, entityPath } from "../lib/routes.ts";
import type { EntityFilter, EntityListPage } from "../lib/types.ts";
import { ENTITY_FILTERS } from "../../../src/siteTypes.ts";
import { Link, navigate } from "../router.tsx";

export function EntitiesPage({ filter }: { filter: EntityFilter }) {
  useTitle("인물·기관·국가");
  return (
    <Layout left={<BriefBackLink />}>
      <h1 className="page-title pad">인물·기관·국가</h1>
      <p className="count">최근 등장 순</p>
      <KindChips filter={filter} />
      {/* 거르기를 바꾸면 쪽 상태를 새로 시작한다 */}
      <EntityPages key={filter} filter={filter} />
    </Layout>
  );
}

type Kind = Exclude<EntityFilter, "all">;
const KINDS = ENTITY_FILTERS.filter((f): f is Kind => f !== "all");

/**
 * 종류 칩(U2 4.3, S15): 종류마다 첫 쪽 파일의 total로 세어 있는 종류만 건수와 함께 보인다. 파일을 받지 못한 종류는 건수 없이 둔다.
 * 주소로 들어온 종류(`?kind=`)가 0건이면 첫 칩으로 돌아가고 주소도 바꾼다(S12). 칩은 지금처럼 주소를 바꾼다(U1 S10)
 */
function KindChips({ filter }: { filter: EntityFilter }) {
  const res = useResources<EntityListPage>(ENTITY_FILTERS.map((f) => dataUrl.entityList(f, 0)));
  const settled = res.every((r) => r.status === "ok" || r.status === "error");
  const totalOf = (f: EntityFilter) => {
    const r = res[ENTITY_FILTERS.indexOf(f)]!;
    return r.status === "ok" ? r.data.total : null;
  };
  const options: ChipOption<Kind>[] = KINDS.flatMap((k) => {
    const n = totalOf(k);
    if (n === 0) return [];
    return [{ value: k, count: n ?? 0, label: n === null ? ENTITY_FILTER_LABEL[k] : countLabel(ENTITY_FILTER_LABEL[k], n) }];
  });
  // 0건 확인은 고른 종류의 파일 하나면 되므로(목록과 같은 파일) 다른 종류를 기다리지 않는다
  const gone = filter !== "all" && totalOf(filter) === 0;
  useEffect(() => {
    if (gone) navigate(entitiesPath("all"), { replace: true, quiet: true });
  }, [gone, filter]);
  if (!settled) return null;
  const all = totalOf("all");
  return (
    <ChipFilter
      label="종류"
      allText={ALL_CHIP_TEXT.kind}
      total={all ?? 0}
      totalKnown={all !== null}
      options={options}
      value={filter === "all" ? null : filter}
      onChange={(k) => navigate(entitiesPath(k ?? "all"), { replace: true, quiet: true })}
    />
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
  const first = res.data.items[0];
  const year = first ? yearOf(first.latestDate) : undefined;
  return (
    <>
      <ul className="list">
        {res.data.items.map((e) => (
          <li key={e.id} className="item">
            <Link to={entityPath(e.id)} className="item-btn">
              <span className="cat muted-cat">
                {entityListLine(e, year)}
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
