// 인물·기관·국가 페이지(4.7-4). 그 식별자의 상세 묶음을 받고, 흡수된 식별자면 남는 대상의 묶음을 받아 남는 대상 주소로 바꾼다.
// 지웠거나 없는 식별자(묶음에 없거나 묶음 파일이 없음)는 없는 페이지다. 등장 뉴스의 나머지는 "더 보기"를 눌렀을 때 받는다.
import { useEffect, useState } from "react";
import { BackLink, ErrorState, Layout, Loading, NewsTitle, ReadCheck, useFocusNewRow, useTitle } from "../components/common.tsx";
import { retry, useResource, type Resource } from "../data.ts";
import { ENTITY_FIRST_ISSUES, ENTITY_MORE_STEP, resolveEntity } from "../lib/entities.ts";
import { entityLabel, monthDay, shortDate } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { briefPath, entitiesPath, entityPath, issuePath } from "../lib/routes.ts";
import type { EntityChunk, EntityDetail, EntityNews, EntityNewsChunk } from "../lib/types.ts";
import { entityChunkOf } from "../../../src/siteTypes.ts";
import { Link, navigate, useLocation } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

interface MergedState {
  mergedFrom: { id: number; on: string | null };
}

function mergedFromState(state: unknown): MergedState["mergedFrom"] | null {
  if (state && typeof state === "object" && "mergedFrom" in state) return (state as MergedState).mergedFrom;
  return null;
}

export function EntityPage({ id }: { id: number }) {
  const loc = useLocation();
  const firstUrl = dataUrl.entityChunk(entityChunkOf(id));
  const firstRes = useResource<EntityChunk>(firstUrl);
  const first = firstRes.status === "ok" ? resolveEntity(id, firstRes.data) : null;
  const targetId = first?.kind === "entity" ? id : first?.kind === "merged" ? first.into : null;
  const mergedFrom = first?.kind === "merged" ? { id, on: first.on } : null;
  const chunkUrl = targetId === null ? null : dataUrl.entityChunk(entityChunkOf(targetId));
  const chunkRes = useResource<EntityChunk>(chunkUrl);
  const entity = chunkRes.status === "ok" && targetId !== null ? (chunkRes.data.entities[String(targetId)] ?? null) : null;

  useEffect(() => {
    if (mergedFrom && entity) navigate(entityPath(entity.id), { replace: true, state: { mergedFrom } satisfies MergedState });
  }, [mergedFrom?.id, mergedFrom?.on, entity?.id]);

  useTitle(entity ? entityLabel(entity) : "인물·기관·국가");
  const back = <BackLink to={entitiesPath()} label="인물·기관·국가" />;

  // 묶음 파일이 없으면(404) 그 식별자는 없다
  if ((firstRes.status === "error" && firstRes.notFound) || (chunkRes.status === "error" && chunkRes.notFound)) return <NotFoundPage />;
  if (firstRes.status === "error" || chunkRes.status === "error") {
    return (
      <Layout left={back}>
        <ErrorState onRetry={() => retry([firstUrl, chunkUrl])} />
      </Layout>
    );
  }
  if (firstRes.status !== "ok" || (targetId !== null && chunkRes.status !== "ok")) {
    return (
      <Layout left={back}>
        <Loading />
      </Layout>
    );
  }
  if (!entity) return <NotFoundPage />;
  const merged = mergedFrom ?? mergedFromState(loc.state);
  return (
    <Layout left={back}>
      <EntityView key={entity.id} entity={entity} merged={merged} />
    </Layout>
  );
}

function EntityView({ entity, merged }: { entity: EntityDetail; merged: MergedState["mergedFrom"] | null }) {
  const year = entity.latestDate.slice(0, 4);
  const [issueLimit, setIssueLimit] = useState(ENTITY_FIRST_ISSUES);
  const moreIssues = useFocusNewRow<HTMLDivElement>("a");
  const moreNews = useFocusNewRow<HTMLDivElement>(".rows > li");
  // "더 보기"를 누른 뒤에만 나머지 뉴스 묶음을 받는다
  const [extra, setExtra] = useState(0);
  const newsUrl = extra > 0 && entity.moreNews > 0 ? dataUrl.entityNews(entityChunkOf(entity.id)) : null;
  const newsRes = useResource<EntityNewsChunk>(newsUrl);
  const meta = [entity.aliases.length ? `별칭: ${entity.aliases.join(", ")}` : null, `처음 ${shortDate(entity.firstDate, year)}`, `최근 ${shortDate(entity.latestDate, year)}`, `뉴스 ${entity.count.toLocaleString("ko-KR")}건`]
    .filter(Boolean)
    .join(" · ");
  return (
    <article className="iss">
      {merged && (
        <p className="notice" role="note">
          이 항목은 {merged.on ? `${monthDay(merged.on)}에 ` : ""}
          {entity.name}에 합쳐졌다.
        </p>
      )}
      <div className="cat muted-cat">{entity.kind}</div>
      <h1 className="name">{entity.name}</h1>
      <p className="meta">
        {entity.description && (
          <>
            {entity.description}
            <br />
          </>
        )}
        {meta}
      </p>
      {entity.issues.length > 0 && (
        <>
          <h2 className="h">등장한 이슈</h2>
          <div className="rel" ref={moreIssues.ref}>
            {entity.issues.slice(0, issueLimit).map((i) => (
              <Link key={i.id} to={issuePath(i.id)}>
                {i.name}
                <small>
                  {i.count.toLocaleString("ko-KR")}
                  <span className="sr-only">건</span>
                </small>
              </Link>
            ))}
          </div>
          {entity.issues.length > issueLimit && (
            <div className="more tight">
              <button type="button" className="retry" onClick={() => {
                  moreIssues.mark();
                  setIssueLimit((n) => n + ENTITY_MORE_STEP);
                }}>
                이슈 더 보기
              </button>
            </div>
          )}
        </>
      )}
      <h2 className="h">등장한 뉴스</h2>
      <div ref={moreNews.ref}>
        <NewsRows news={entity.news} year={year} />
        {entity.moreNews > 0 && (
          <MoreNews
            id={entity.id}
            res={newsRes}
            extra={extra}
            total={entity.moreNews}
            year={year}
            onMore={() => {
              moreNews.mark();
              setExtra((n) => n + ENTITY_MORE_STEP);
            }}
            onRetry={() => retry([newsUrl])}
          />
        )}
      </div>
    </article>
  );
}

function MoreNews({ id, res, extra, total, year, onMore, onRetry }: { id: number; res: Resource<EntityNewsChunk>; extra: number; total: number; year: string; onMore: () => void; onRetry: () => void }) {
  const rest = res.status === "ok" ? (res.data.news[String(id)] ?? []) : [];
  const shownCount = Math.min(extra, rest.length);
  return (
    <>
      {shownCount > 0 && <NewsRows news={rest.slice(0, shownCount)} year={year} />}
      {res.status === "error" && <ErrorState onRetry={onRetry} />}
      {res.status === "loading" && <Loading />}
      {(res.status === "idle" || (res.status === "ok" && shownCount < Math.min(total, rest.length))) && (
        <div className="more tight">
          <button type="button" className="retry" onClick={onMore}>
            더 보기
          </button>
        </div>
      )}
    </>
  );
}

function NewsRows({ news, year }: { news: EntityNews[]; year: string }) {
  if (!news.length) return <p className="p muted">아직 등장한 뉴스가 없다.</p>;
  return (
    <ul className="rows">
      {news.map((n) => (
        <li key={`${n.date}-${n.key}`}>
          <Link to={briefPath(n.date, n.key)} className="nrow">
            <div className="nrow-txt">
              <small>{[shortDate(n.date, year), n.issue].filter(Boolean).join(" · ")}</small>
              <NewsTitle date={n.date} newsKey={n.key} className={n.kind === "short" ? "small" : undefined}>
                {n.title}
              </NewsTitle>
            </div>
            <ReadCheck date={n.date} newsKey={n.key} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
