// 용어 사전(4.7-5): 모든 용어를 가나다순 한 화면에, 첫 자음별로 묶어 보인다.
// 처음에는 색인(term-index.json)과 앞쪽 묶음 몇 개만 받고, 나머지 묶음은 화면에 가까워지면 받는다(4.6-2).
// `/terms/<id>`로 들어오면 그 용어의 묶음을 받아 그 위치로 가고 강조한다. 흡수된 용어는 남는 용어 주소로 바꾼다.
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { BackLink, Empty, ErrorState, Layout, Loading, NewsTitle, ReadCheck, useTitle } from "../components/common.tsx";
import { retry, useResource } from "../data.ts";
import { monthDay, shortDate } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { briefPath, termPath } from "../lib/routes.ts";
import { initialTermGroups, resolveTerm, termDomId, termGroupDomId } from "../lib/terms.ts";
import type { TermGroupFile, TermIndex, TermItem } from "../lib/types.ts";
import { Link, navigate, useLocation } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

/** 아직 받지 않은 묶음이 차지할 높이(용어 하나 대략). 받은 뒤 화면이 크게 밀리지 않게 한다 */
const TERM_ROW_ESTIMATE = 96;

interface MergedState {
  mergedFrom: { id: number; on: string | null };
}

function mergedFromState(state: unknown): MergedState["mergedFrom"] | null {
  if (state && typeof state === "object" && "mergedFrom" in state) return (state as MergedState).mergedFrom;
  return null;
}

export function GlossaryPage({ id }: { id: number | null }) {
  useTitle("용어 사전");
  const loc = useLocation();
  const indexUrl = dataUrl.termIndex();
  const indexRes = useResource<TermIndex>(indexUrl);
  const index = indexRes.status === "ok" ? indexRes.data : null;
  const target = index && id !== null ? resolveTerm(id, index) : null;

  useEffect(() => {
    if (target?.mergedFrom) navigate(termPath(target.id), { replace: true, state: { mergedFrom: target.mergedFrom } satisfies MergedState });
  }, [target?.id, target?.mergedFrom?.id]);

  const eager = useMemo(() => new Set(index ? [...initialTermGroups(index), ...(target ? [target.group] : [])] : []), [index, target?.group]);
  const back = <BackLink to="/" label="브리프" />;

  if (indexRes.status === "error") {
    return (
      <Layout left={back}>
        <h1 className="page-title pad">용어 사전</h1>
        <ErrorState onRetry={() => retry([indexUrl])} />
      </Layout>
    );
  }
  if (!index) {
    return (
      <Layout left={back}>
        <h1 className="page-title pad">용어 사전</h1>
        <Loading />
      </Layout>
    );
  }
  if (id !== null && !target) return <NotFoundPage />;
  const merged = target?.mergedFrom ?? (target ? mergedFromState(loc.state) : null);
  const groups = index.groups.filter((g) => g.count > 0);
  return (
    <Layout left={back}>
      <div className="iss">
        <h1 className="name">용어 사전</h1>
        <p className="meta">용어 {index.total.toLocaleString("ko-KR")}개 · 가나다순</p>
        {merged && target && <MergedNotice on={merged.on} survivorId={target.id} group={target.group} />}
        {groups.length === 0 ? (
          <Empty>아직 용어가 없다.</Empty>
        ) : (
          <>
            <nav aria-label="첫 자음으로 가기" className="rel">
              {groups.map((g) => (
                <a key={g.group} href={`#${termGroupDomId(g.group)}`} onClick={(e) => jumpTo(e, g.group)}>
                  {g.label}
                </a>
              ))}
            </nav>
            {groups.map((g) => (
              <GroupSection key={g.group} group={g.group} label={g.label} count={g.count} eager={eager.has(g.group)} targetId={target?.id ?? null} />
            ))}
          </>
        )}
      </div>
    </Layout>
  );
}

function jumpTo(e: MouseEvent<HTMLAnchorElement>, group: number) {
  e.preventDefault();
  const el = document.getElementById(termGroupDomId(group));
  el?.scrollIntoView({ block: "start" });
  el?.focus({ preventScroll: true });
}

/** 흡수된 용어 주소로 들어왔을 때의 한 줄. 남는 용어의 이름은 그 묶음에서 읽는다 */
function MergedNotice({ on, survivorId, group }: { on: string | null; survivorId: number; group: number }) {
  const res = useResource<TermGroupFile>(dataUrl.termGroup(group));
  const name = res.status === "ok" ? res.data.terms.find((t) => t.id === survivorId)?.name : undefined;
  if (!name) return null;
  return (
    <p className="notice" role="note">
      이 항목은 {on ? `${monthDay(on)}에 ` : ""}
      {name}에 합쳐졌다.
    </p>
  );
}

function GroupSection({ group, label, count, eager, targetId }: { group: number; label: string; count: number; eager: boolean; targetId: number | null }) {
  const ref = useRef<HTMLElement>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (eager) setNear(true);
  }, [eager]);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        setNear(true);
        io.disconnect();
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const url = near || eager ? dataUrl.termGroup(group) : null;
  const res = useResource<TermGroupFile>(url);
  const hId = termGroupDomId(group);
  return (
    <section ref={ref} aria-labelledby={hId}>
      <h2 id={hId} className="idx" tabIndex={-1}>
        {label}
      </h2>
      {res.status === "error" && <ErrorState onRetry={() => retry([url])} />}
      {(res.status === "idle" || res.status === "loading") && (
        <div className="gl-wait" style={{ minHeight: count * TERM_ROW_ESTIMATE }}>
          {res.status === "loading" && <Loading />}
        </div>
      )}
      {res.status === "ok" && <TermList terms={res.data.terms} targetId={targetId} />}
    </section>
  );
}

function TermList({ terms, targetId }: { terms: TermItem[]; targetId: number | null }) {
  // 용어 주소로 들어오면 그 용어로 가서 초점을 둔다(한 번만)
  const done = useRef<number | null>(null);
  useEffect(() => {
    if (targetId === null || done.current === targetId || !terms.some((t) => t.id === targetId)) return;
    const el = document.getElementById(termDomId(targetId));
    if (!el) return;
    done.current = targetId;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [terms, targetId]);
  return (
    <ul className="list">
      {terms.map((t) => (
        <TermRow key={t.id} term={t} target={t.id === targetId} />
      ))}
    </ul>
  );
}

/** 짧은 날짜의 기준 해(올해와 같으면 해를 빼고 보인다) */
const THIS_YEAR = String(new Date().getFullYear());

function TermRow({ term, target }: { term: TermItem; target: boolean }) {
  const year = THIS_YEAR;
  return (
    <li id={termDomId(term.id)} tabIndex={-1} className={target ? "gl target" : "gl"}>
      <h3>{term.name}</h3>
      {term.aliases.length > 0 && <p className="aliases">별칭: {term.aliases.join(", ")}</p>}
      <p>{term.description}</p>
      <small>
        {term.first && (
          <>
            처음 나온 뉴스:{" "}
            <Link to={briefPath(term.first.date, term.first.key)}>
              {shortDate(term.first.date, year)}{" "}
              <NewsTitle date={term.first.date} newsKey={term.first.key}>
                {term.first.title}
              </NewsTitle>
            </Link>
            {" · "}
          </>
        )}
        나온 뉴스 {term.count.toLocaleString("ko-KR")}건
        {term.first && <ReadCheck date={term.first.date} newsKey={term.first.key} />}
      </small>
    </li>
  );
}
