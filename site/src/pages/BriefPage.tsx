// 날짜별 브리프와 펼친 뉴스 카드(4.2)
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ALL_MAJORS, CategoryLine, Layout as Shell, ChipFilter, Empty, ErrorState, Footer, Loading, TopBar, useTitle } from "../components/common.tsx";
import { EntityChips, TermBox, TermChips, TermText } from "../components/termView.ts";
import { retry, useResource, type Resource } from "../data.ts";
import { daySections, findDay, findStoryTarget, orderSources, sectionView, stateForHash, storyImage, type BriefViewState } from "../lib/brief.ts";
import { monthDay, monthDayWeekday, shortDate } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { placeTerms, storyBodyParts, termBoxPlace, toggleTerm } from "../lib/terms.ts";
import { categoryVar } from "../lib/theme.ts";
import { adjacentDates, briefPath, hashKey, issuePath, resolveBriefDate, type Route } from "../lib/routes.ts";
import type { ListStory, MonthDetail, MonthList, SectionName, SiteDates, StoryDetail } from "../lib/types.ts";
import { Link, lastNavigation, navigate, useLocation } from "../router.tsx";
import { NotFoundPage } from "./NotFoundPage.tsx";

export function storyDomId(key: string): string {
  return `story-${key}`;
}

export function BriefPage({ route }: { route: Route }) {
  const loc = useLocation();
  const datesUrl = dataUrl.dates();
  const datesRes = useResource<SiteDates>(datesUrl);
  const date = datesRes.status === "ok" ? resolveBriefDate(route, datesRes.data) : null;
  const month = date ? date.slice(0, 7) : null;
  const listUrl = month ? dataUrl.list(month) : null;
  const listRes = useResource<MonthList>(listUrl);
  const day = listRes.status === "ok" && date ? findDay(listRes.data, date) : null;
  const key = hashKey(loc.hash);

  const [view, setView] = useState<BriefViewState>({ section: "한국", major: null, expanded: null });
  useEffect(() => {
    if (day) setView((v) => stateForHash(day, key, v));
  }, [day, key]);

  // 펼친 카드가 있을 때만 그 달의 본문 파일을 받는다(4.3-7)
  const expanded = day && view.expanded && findStoryTarget(day, view.expanded) ? view.expanded : null;
  const detailUrl = month && expanded ? dataUrl.detail(month) : null;
  const detailRes = useResource<MonthDetail>(detailUrl);

  // `#<뉴스 키>`로 들어오면 그 카드 위치로 간다(4.2-4). 카드를 눌러 펼친 것은 스크롤하지 않는다.
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!day || !key || !date) return;
    const token = `${date}#${key}`;
    if (scrolledFor.current === token || lastNavigation().quiet) return;
    const target = findStoryTarget(day, key);
    if (!target) return;
    if (target.kind === "top" && (view.expanded !== key || detailRes.status === "loading" || detailRes.status === "idle")) return;
    if (view.section !== target.section) return;
    const el = document.getElementById(storyDomId(key));
    if (!el) return;
    scrolledFor.current = token;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [day, key, date, view, detailRes.status]);

  useTitle(date ? `${monthDayWeekday(date)} 브리프` : route.name === "latest" ? "최근 브리프" : undefined);

  if (datesRes.status === "error") return <Shell><ErrorState onRetry={() => retry([datesUrl])} /></Shell>;
  if (datesRes.status !== "ok") return <Shell><Loading /></Shell>;
  if (route.name === "latest" && !datesRes.data.latestDate) {
    return (
      <Shell>
        <Empty>아직 저장된 브리프가 없다.</Empty>
      </Shell>
    );
  }
  if (!date) return <NotFoundPage />;
  const { prev, next } = adjacentDates(datesRes.data.dates, date);
  const center = <DateNav date={date} prev={prev} next={next} />;
  if (listRes.status === "error") return <Shell center={center}><ErrorState onRetry={() => retry([listUrl])} /></Shell>;
  if (listRes.status !== "ok") return <Shell center={center}><Loading /></Shell>;
  if (!day) return <NotFoundPage />;

  const sections = daySections(day);
  const current = sections.includes(view.section) ? view.section : sections[0]!;
  const sv = sectionView(day, current, view.major);
  const hasStories = sv.top.length + sv.short.length > 0;

  function setHash(k: string | null) {
    navigate(briefPath(date!, k ?? undefined), { replace: true, quiet: true });
  }
  function toggle(k: string) {
    // 펼침 상태는 주소의 `#<뉴스 키>`를 따른다(stateForHash)
    setHash(expanded === k ? null : k);
  }
  function chooseSection(s: SectionName) {
    setView((v) => ({ ...v, section: s, expanded: null }));
    if (key) setHash(null);
    window.scrollTo({ top: 0 });
  }
  function chooseMajor(m: BriefViewState["major"]) {
    setView((v) => ({ ...v, major: m }));
  }

  return (
    <>
      <TopBar center={center} />
      <main id="main" tabIndex={-1} className="page has-tabs">
        <h1 className="sr-only">{monthDayWeekday(date)} 브리프</h1>
        <div className="headline">
          {day.headline}
          {day.keywords.length > 0 && (
            <div className="kw" aria-label="키워드">
              {day.keywords.map((k) => (
                <span key={k}>{k}</span>
              ))}
            </div>
          )}
        </div>
        <ChipFilter label="카테고리" options={ALL_MAJORS} value={view.major} onChange={chooseMajor} />
        <h2 className="sr-only">{current} 뉴스</h2>
        {sv.section?.flow && view.major === null && <p className="flow">{sv.section.flow}</p>}
        {!hasStories && <Empty>{view.major ? "이 분류의 뉴스가 없다." : "이 섹션의 뉴스가 없다."}</Empty>}
        {sv.top.length > 0 && (
          <ul className="list">
            {sv.top.map((s) => (
              <TopItem
                key={s.key}
                story={s}
                date={date}
                open={expanded === s.key}
                onToggle={() => toggle(s.key)}
                detail={detailRes}
                onRetry={() => retry([detailUrl])}
              />
            ))}
          </ul>
        )}
        {sv.short.length > 0 && (
          <section aria-labelledby="short-h">
            <h3 id="short-h" className="h list-h">
              짧은 소식
            </h3>
            <ul className="list">
              {sv.short.map((s) => (
                <ShortItem key={s.key} story={s} targeted={key === s.key} />
              ))}
            </ul>
          </section>
        )}
        {sv.section?.unverified && view.major === null && <p className="flow note">확인되지 않은 내용: {sv.section.unverified}</p>}
      </main>
      <Footer />
      <nav className="tabs" aria-label="섹션">
        {sections.map((s) => (
          <button key={s} type="button" className={s === current ? "on" : ""} aria-pressed={s === current} onClick={() => chooseSection(s)}>
            {s}
          </button>
        ))}
      </nav>
    </>
  );
}

function DateNav({ date, prev, next }: { date: string; prev: string | null; next: string | null }) {
  return (
    <span className="datebtn">
      {prev ? (
        <Link to={briefPath(prev)} className="arrow" aria-label={`이전 날짜 ${monthDay(prev)}`}>
          ‹
        </Link>
      ) : (
        <span className="arrow off" aria-hidden="true">
          ‹
        </span>
      )}
      <Link to="/dates" className="date-link" aria-label={`${monthDayWeekday(date)}, 날짜 목록 보기`}>
        {monthDayWeekday(date)}
      </Link>
      {next ? (
        <Link to={briefPath(next)} className="arrow" aria-label={`다음 날짜 ${monthDay(next)}`}>
          ›
        </Link>
      ) : (
        <span className="arrow off" aria-hidden="true">
          ›
        </span>
      )}
    </span>
  );
}

function ContLine({ story }: { story: ListStory }) {
  if (!story.continues && !story.issue) return null;
  return (
    <span className="cont">
      {story.continues && <span className="badge">{story.continues.label}</span>}
      {story.issue && <span>{story.newIssue ? "새 이슈" : `이어지는 이야기: ${story.issue.name}`}</span>}
    </span>
  );
}

type DetailState = Resource<MonthDetail>;

function TopItem({ story, date, open, onToggle, detail, onRetry }: { story: ListStory; date: string; open: boolean; onToggle: () => void; detail: DetailState; onRetry: () => void }) {
  const id = storyDomId(story.key);
  const body = detail.status === "ok" ? detail.data.days[date]?.[story.key] : undefined;
  return (
    <li id={id} tabIndex={-1} className={open ? "item open" : "item"}>
      <button type="button" className="item-btn" aria-expanded={open} aria-controls={open ? `${id}-body` : undefined} onClick={onToggle}>
        <CategoryLine major={story.category.major} minor={story.category.minor} isNewMinor={open && story.category.isNewMinor} />
        <span className="title">{story.title}</span>
        {!open && <ContLine story={story} />}
      </button>
      {open && (
        <div id={`${id}-body`} className="detail">
          {detail.status === "error" && <ErrorState onRetry={onRetry} />}
          {(detail.status === "loading" || detail.status === "idle") && <Loading />}
          {detail.status === "ok" &&
            (body ? (
              <StoryBody story={story} detail={body} date={date} />
            ) : (
              <Empty>이 뉴스의 본문을 찾지 못했다.</Empty>
            ))}
        </div>
      )}
    </li>
  );
}

function StoryImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return <img className="hero" src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

function StoryBody({ story, detail, date }: { story: ListStory; detail: StoryDetail; date: string }) {
  const image = storyImage(detail.sources);
  const year = date.slice(0, 4);
  const terms = useMemo(() => detail.terms ?? [], [detail]);
  const entities = detail.entities ?? [];
  const placement = useMemo(() => placeTerms(storyBodyParts(detail), terms), [detail, terms]);
  // 열린 용어 설명(한 카드에 하나, E8). 카드를 접으면 이 컴포넌트가 사라져 닫힌다
  const [openTerm, setOpenTerm] = useState<number | null>(null);
  const boxId = `${storyDomId(story.key)}-term`;
  const openRef = terms.find((t) => t.id === openTerm) ?? null;
  const boxAt = openRef ? termBoxPlace(openTerm, placement) : null;
  const onToggle = (id: number) => setOpenTerm((v) => toggleTerm(v, id));
  const text = (part: string) => <TermText segments={placement.segments[part] ?? []} openId={openTerm} onToggle={onToggle} boxId={boxId} />;
  const box = (part: string): ReactNode => (openRef && boxAt === part ? <TermBox term={openRef} id={boxId} Link={Link} /> : null);
  return (
    <>
      {image && <StoryImage src={image} />}
      {story.issue && (
        <div className="story">
          <b>
            <Link to={issuePath(story.issue.id)}>
              이어지는 이야기 · {story.issue.name} <span aria-hidden="true">›</span>
            </Link>
            {story.continues && <span className="badge">{story.continues.label}</span>}
          </b>
          {detail.previous.length > 0 ? (
            <ol aria-label="이전 전개">
              {detail.previous.map((p) => (
                <li key={`${p.date}-${p.key}`}>
                  <Link to={briefPath(p.date, p.key)}>
                    <em>{shortDate(p.date, year)}</em>
                    {p.title}
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <span className="new-issue">새 이슈</span>
          )}
        </div>
      )}
      <p className="sum">{text("summary")}</p>
      {box("summary")}
      <h4 className="h">왜 중요한가</h4>
      <p className="p">{text("why")}</p>
      {box("why")}
      <h4 className="h">배경</h4>
      <p className="p">{text("background")}</p>
      {box("background")}
      {detail.keyFacts.length > 0 && (
        <>
          <h4 className="h">핵심</h4>
          <ul className="p facts">
            {detail.keyFacts.map((_, i) => (
              <li key={i}>
                {text(`fact-${i}`)}
                {box(`fact-${i}`)}
              </li>
            ))}
          </ul>
        </>
      )}
      {detail.analogy && (
        <>
          <h4 className="h">비유</h4>
          <p className="p">{text("analogy")}</p>
          {box("analogy")}
        </>
      )}
      <h4 className="h">전망</h4>
      <p className="p">{text("outlook")}</p>
      {box("outlook")}
      {entities.length > 0 && (
        <>
          <h4 className="h">인물·기관·국가</h4>
          <EntityChips entities={entities} Link={Link} />
        </>
      )}
      {terms.length > 0 && (
        <>
          <h4 className="h">용어</h4>
          <TermChips terms={terms} openId={openTerm} onToggle={onToggle} boxId={boxId} />
          {box("chips")}
        </>
      )}
      <h4 className="h">확인 정도</h4>
      <p className="p">{detail.confidence}</p>
      {detail.extras.length > 0 && (
        <>
          <h4 className="h">함께 엮인 이슈</h4>
          <div className="rel">
            {detail.extras.map((x) => (
              <Link key={x.id} to={issuePath(x.id)}>
                {x.name}
              </Link>
            ))}
          </div>
        </>
      )}
      {detail.sources.length > 0 && (
        <>
          <h4 className="h">출처</h4>
          <div className="src">
            {orderSources(detail.sources).map((s, i) => (
              <a key={`${s.url}-${i}`} href={s.url} target="_blank" rel="noopener noreferrer">
                {s.name}
                <small>
                  {" "}
                  · {shortDate(s.publishedAt, year)}
                  {s.publishedAtEstimated ? " 추정" : ""}
                </small>{" "}
                <span aria-hidden="true">↗</span>
                <span className="sr-only"> (새 탭)</span>
              </a>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function ShortItem({ story, targeted }: { story: ListStory; targeted: boolean }) {
  return (
    <li id={storyDomId(story.key)} tabIndex={-1} className={targeted ? "short target" : "short"}>
      <p className="short-text">{story.title}</p>
      <div className="short-meta">
        <span className="cat-inline" style={{ color: categoryVar(story.category.major) }}>
          {story.category.major} · {story.category.minor}
        </span>
        {story.continues && <span className="badge">{story.continues.label}</span>}
        {story.issue && <Link to={issuePath(story.issue.id)}>{story.issue.name}</Link>}
      </div>
    </li>
  );
}
