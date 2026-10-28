// 검색(4.3-3, P6). Pagefind가 고른 묶음 레코드(날짜·이슈 묶음)에서 맞는 뉴스·이슈를 하나씩 되찾아 "이슈"와 "뉴스"로 나눠 보인다.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { BackLink, Empty, ErrorState, Layout, Loading, useTitle } from "../components/common.tsx";
import { loadJson } from "../data.ts";
import { monthDayWeekday } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { briefPath, issuePath, searchPath } from "../lib/routes.ts";
import { matchDayStories, matchIssues, monthOf, parseHit, queryTerms, type SearchHit } from "../lib/search.ts";
import { categoryVar } from "../lib/theme.ts";
import type { IssueChunk, IssueDetail, ListStory, MonthDetail, MonthList, SiteIssueList } from "../lib/types.ts";
import { searchRecords, type PagefindResult } from "../pagefind.ts";
import { Link, navigate } from "../router.tsx";

/** 한 번에 되찾는 레코드 수. 레코드마다 그 달의 사이트 데이터를 받으므로 나눠서 받는다 */
const BATCH = 10;

interface NewsResult {
  date: string;
  story: ListStory;
}

interface Found {
  news: NewsResult[];
  issues: IssueDetail[];
}

async function resolveRecords(records: PagefindResult[], terms: string[]): Promise<Found> {
  const hits = (await Promise.all(records.map((r) => r.data()))).map((d) => parseHit(d.url, d.meta)).filter((h): h is SearchHit => h !== null);
  const news: NewsResult[] = [];
  const issues: IssueDetail[] = [];
  const newsHits = hits.filter((h) => h.kind === "news");
  const issueHits = hits.filter((h) => h.kind === "issues");
  const [newsParts, issueParts] = await Promise.all([
    Promise.all(
      newsHits.map(async (h) => {
        const month = monthOf(h.date);
        const [list, detail] = await Promise.all([loadJson<MonthList>(dataUrl.list(month)), loadJson<MonthDetail>(dataUrl.detail(month))]);
        const day = list.days.find((d) => d.date === h.date);
        if (!day) return [];
        return matchDayStories(day, detail.days[h.date], terms).map((story) => ({ date: h.date, story }));
      }),
    ),
    issueHits.length
      ? loadJson<SiteIssueList>(dataUrl.issueList()).then((list) =>
          Promise.all(issueHits.map(async (h) => matchIssues(await loadJson<IssueChunk>(dataUrl.issueChunk(h.chunk)), terms, list.merged))),
        )
      : Promise.resolve([]),
  ]);
  for (const part of newsParts) news.push(...part);
  for (const part of issueParts) issues.push(...part);
  return { news, issues };
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error" }
  | { status: "ok"; records: PagefindResult[]; done: number; found: Found; more: "idle" | "loading" | "error" };

function sortNews(news: NewsResult[]): NewsResult[] {
  return [...news].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export function SearchPage({ q }: { q: string }) {
  useTitle(q ? `"${q}" 검색` : "검색");
  const [text, setText] = useState(q);
  const [state, setState] = useState<State>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const run = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (!q) inputRef.current?.focus();
  }, [q]);

  useEffect(() => {
    const terms = queryTerms(q);
    const id = ++run.current;
    if (!terms.length) {
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    (async () => {
      const records = await searchRecords(q);
      const first = records.slice(0, BATCH);
      const found = await resolveRecords(first, terms);
      if (run.current === id) setState({ status: "ok", records, done: first.length, found, more: "idle" });
    })().catch(() => {
      if (run.current === id) setState({ status: "error" });
    });
  }, [q, attempt]);

  async function loadMore() {
    if (state.status !== "ok") return;
    const id = run.current;
    const { records, done, found } = state;
    setState({ ...state, more: "loading" });
    try {
      const next = records.slice(done, done + BATCH);
      const more = await resolveRecords(next, queryTerms(q));
      if (run.current === id) setState({ status: "ok", records, done: done + next.length, found: { news: [...found.news, ...more.news], issues: [...found.issues, ...more.issues] }, more: "idle" });
    } catch {
      if (run.current === id) setState({ ...state, more: "error" });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (value !== q) navigate(searchPath(value), { replace: q !== "" });
  }

  return (
    <Layout left={<BackLink to="/" label="브리프" />}>
      <h1 className="page-title pad">검색</h1>
      <form role="search" className="search-form" onSubmit={submit}>
        <label htmlFor="q" className="sr-only">
          검색어
        </label>
        <input ref={inputRef} id="q" type="search" name="q" value={text} onChange={(e) => setText(e.target.value)} placeholder="뉴스 낱말이나 이슈 이름" autoComplete="off" enterKeyHint="search" />
        <button type="submit" className="retry">
          찾기
        </button>
      </form>
      {state.status === "idle" && q === "" && <p className="flow">뉴스(제목, 요약, 본문)와 이슈(이름, 다른 이름, 요약)를 찾는다.</p>}
      {state.status === "loading" && <Loading label="찾는 중…" />}
      {state.status === "error" && <ErrorState message="검색 색인을 불러오지 못했다. 네트워크를 확인하고 다시 시도해 주세요." onRetry={() => setAttempt((n) => n + 1)} />}
      {state.status === "ok" && <Results state={state} q={q} onMore={loadMore} />}
    </Layout>
  );
}

function Results({ state, q, onMore }: { state: Extract<State, { status: "ok" }>; q: string; onMore: () => void }) {
  const { found, records, done, more } = state;
  const hasMore = done < records.length;
  if (!found.issues.length && !found.news.length && !hasMore) return <Empty>"{q}"에 맞는 결과가 없다.</Empty>;
  return (
    <div aria-live="polite">
      {found.issues.length > 0 && (
        <section aria-labelledby="r-issues">
          <h2 id="r-issues" className="h list-h">
            이슈
          </h2>
          <ul className="list">
            {found.issues.map((i) => (
              <li key={i.id} className="item">
                <Link to={issuePath(i.id)} className="item-btn">
                  <span className="cat" style={{ color: categoryVar(i.category.major) }}>
                    {i.category.major} · {i.category.minor} · {i.status}
                  </span>
                  <span className="title">{i.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {found.news.length > 0 && (
        <section aria-labelledby="r-news">
          <h2 id="r-news" className="h list-h">
            뉴스
          </h2>
          <ul className="list">
            {sortNews(found.news).map((n) => (
              <li key={`${n.date}-${n.story.key}`} className="item">
                <Link to={briefPath(n.date, n.story.key)} className="item-btn">
                  <span className="cat muted-cat">{monthDayWeekday(n.date)}</span>
                  <span className={n.story.kind === "top" ? "title" : "title small"}>{n.story.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!found.issues.length && !found.news.length && <Empty>앞쪽 결과에서 맞는 것을 찾지 못했다. 더 보기로 이어서 찾는다.</Empty>}
      {hasMore && (
        <div className="more">
          {more === "loading" ? (
            <Loading label="더 찾는 중…" />
          ) : (
            <>
              {more === "error" && <p className="p">더 불러오지 못했다.</p>}
              <button type="button" className="retry" onClick={onMore}>
                {more === "error" ? "다시 시도" : "더 보기"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
