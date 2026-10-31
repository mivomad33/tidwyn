// 날짜별 브리프와 펼친 뉴스 카드(4.2). 4.5단계: 읽음 버튼, 펼침·글 누름·링크로 읽음, '안 읽은 것만' 거르기. 5단계: 카드의 일정 칩. 6단계: 브리프 위 '이번 주 일정 | 지표' 상자. 7단계: 섹션 탭 끝의 '영상' 탭(4.7-1)
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { kstDate } from "../../../src/kst.ts";
import { ALL_MAJORS, CategoryLine, Layout as Shell, ChipFilter, Empty, ErrorState, Footer, Loading, NewsTitle, ReadCheck, ReadToggle, SectionChip, ToggleChip, TopBar, useFullTitle } from "../components/common.tsx";
import { BriefBox } from "../components/briefBox.ts";
import { FixMark, FixNotes } from "../components/correctionView.ts";
import { ScheduleChips } from "../components/scheduleView.ts";
import { VideoList, VideoSource } from "../components/videoView.ts";
import { EntityChips, TermBox, TermChips, TermText } from "../components/termView.ts";
import { retry, useResource, type Resource } from "../data.ts";
import { ALL_TAB, BRIEF_TAB_KEY, VIDEO_TAB, briefTabs, currentTab, findDay, findStoryTarget, orderSources, parseBriefTab, sectionView, stateForHash, storyImage, type BriefTab, type BriefViewState } from "../lib/brief.ts";
import { briefTitle, latestTitle, monthDay, monthDayWeekday, pageTitle, shortDate } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { SITE_URL, shortReportHref, storyReportHref } from "../lib/policy.ts";
import { placeTerms, storyBodyParts, termBoxPlace, toggleTerm } from "../lib/terms.ts";
import { categoryVar } from "../lib/theme.ts";
import { adjacentDates, briefPath, hashKey, issuePath, resolveBriefDate, VIDEO_HASH, type Route } from "../lib/routes.ts";
import { VIDEO_CHIPS, filterVideos, videoChips, videoTabLabel, type VideoChip } from "../lib/videos.ts";
import type { DayList, ListStory, MonthDetail, MonthList, SiteDates, StoryDetail } from "../lib/types.ts";
import { readStored, writeStored } from "../lib/storage.ts";
import { markRead, readStore, useReadVersion } from "../readMarks.ts";
import { ReportLink } from "../components/reportLink.ts";
import { Link, lastNavigation, navigate, useLocation } from "../router.tsx";
import { boxTab, browserStorage, useRemembered, weekCollapsed } from "../storage.ts";
import { NotFoundPage } from "./NotFoundPage.tsx";

export function storyDomId(key: string): string {
  return `story-${key}`;
}

/** '안 읽은 것만'을 켠 동안 읽은 줄이 사라지기 전에 기다리는 시간(잘못 누른 것을 되돌릴 틈)과 사라지는 시간 */
const LEAVE_DELAY_MS = 800;
const LEAVE_MS = 250;

/**
 * leaving이 켜지면 기다렸다가 줄을 부드럽게 접고 onGone을 부른다. 그 사이 leaving이 꺼지면 그만둔다.
 * 기기의 '동작 줄이기'를 켰으면 기다린 뒤 바로 사라진다. 그 줄에 키보드 위치가 있었으면 다음(없으면 앞) 줄의 읽음 버튼으로 옮긴다.
 */
function useLeave(leaving: boolean, onGone: () => void) {
  const ref = useRef<HTMLLIElement>(null);
  const gone = useRef(onGone);
  useEffect(() => {
    gone.current = onGone;
  });
  useEffect(() => {
    const el = ref.current;
    if (!leaving || !el) return;
    let anim: Animation | null = null;
    const finish = () => {
      moveFocusFrom(el);
      gone.current();
    };
    const timer = window.setTimeout(() => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return finish();
      el.style.overflow = "hidden";
      anim = el.animate(
        [
          { height: `${el.offsetHeight}px`, opacity: 1 },
          { height: "0px", opacity: 0, paddingTop: "0px", paddingBottom: "0px", marginTop: "0px", marginBottom: "0px", borderWidth: "0px" },
        ],
        { duration: LEAVE_MS, easing: "ease-in", fill: "forwards" },
      );
      anim.onfinish = finish;
    }, LEAVE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      if (anim) {
        anim.onfinish = null;
        anim.cancel();
      }
      el.style.overflow = "";
    };
  }, [leaving]);
  return ref;
}

function moveFocusFrom(el: HTMLElement): void {
  if (!el.contains(document.activeElement)) return;
  const rows = [...document.querySelectorAll<HTMLElement>("main li[id^=story-]")].filter((r) => r === el || !r.dataset.leaving);
  const i = rows.indexOf(el);
  const to = rows[i + 1] ?? rows[i - 1];
  const target = to?.querySelector<HTMLElement>("button.rd-btn") ?? document.getElementById("main");
  target?.focus({ preventScroll: true });
}

/** 마지막으로 고른 탭(없거나 읽을 수 없으면 한국). 저장소를 쓸 수 없어도 오류 없이 기본 탭이다 */
function storedTab(): BriefTab {
  return parseBriefTab(readStored(browserStorage(), BRIEF_TAB_KEY));
}

function rememberTab(tab: BriefTab): void {
  // 기억하지 못해도 이 화면에서는 고른 탭을 보인다
  writeStored(browserStorage(), BRIEF_TAB_KEY, tab);
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

  // 읽음이 바뀌면 다시 그려 '안 읽은 것만'의 숨길 줄을 다시 정한다
  useReadVersion();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [view, setView] = useState<BriefViewState>(() => ({ section: storedTab(), major: null, expanded: null }));
  // 7단계: 영상 탭의 묶음 칩(기억하지 않는다. 날짜가 바뀌면 '전체'로 돌아간다)과 30일 숨기기의 오늘(방문자 브라우저, KST)
  const [videoChip, setVideoChip] = useState<{ date: string | null; chip: VideoChip | null }>({ date: null, chip: null });
  const today = useMemo(() => kstDate(new Date()), []);
  useEffect(() => {
    if (day) setView((v) => stateForHash(day, key, v));
  }, [day, key]);

  // `#<뉴스 키>`로 화면이 열리면(카드 펼치기, 다른 목록의 링크, 직접 연 주소, 새로 고침, 뒤로 가기) 그 뉴스는 읽음이다(M1, 4.2-3)
  useEffect(() => {
    if (day && date && key && findStoryTarget(day, key)) markRead(date, key);
  }, [day, date, key]);

  // '안 읽은 것만'(4.4). 읽었고 펼치지 않았고 `#` 대상이 아닌 뉴스를 숨긴다. 켤 때·섹션이나 날짜를 바꿀 때 이미 그런 뉴스는
  // 바로 숨기고(gone), 켠 동안 그렇게 된 뉴스는 잠깐 뒤 부드럽게 사라진 다음 gone에 든다(사용자 결정 2026-10-29).
  // round는 칩을 켤 때마다 올라 다시 잡게 한다.
  const [unread, setUnread] = useState({ on: false, round: 0 });
  const hidden = useRef<{ token: string; gone: Set<string> } | null>(null);

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
    if (key === VIDEO_HASH) {
      scrolledFor.current = token;
      window.scrollTo({ top: 0 });
      return;
    }
    const target = findStoryTarget(day, key);
    if (!target) return;
    if (target.kind === "top" && (view.expanded !== key || detailRes.status === "loading" || detailRes.status === "idle")) return;
    if (view.section !== ALL_TAB && view.section !== target.section) return;
    const el = document.getElementById(storyDomId(key));
    if (!el) return;
    scrolledFor.current = token;
    el.scrollIntoView({ block: "start" });
    el.focus({ preventScroll: true });
  }, [day, key, date, view, detailRes.status]);

  useFullTitle(route.name === "latest" ? latestTitle() : route.name === "brief" ? briefTitle(route.date, datesRes.status === "ok" ? datesRes.data.dates : [route.date]) : pageTitle());

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

  // 7단계: 그 날짜에 보이는(받은 지 30일 안의) 영상이 있으면 섹션 탭 끝에 '영상 N'. 기억한 탭이 없는 날짜면 첫 섹션 탭
  const { tabs, videos } = briefTabs(day, today);
  const current = currentTab(day, tabs, view.section);
  const all = current === ALL_TAB;
  const onVideos = current === VIDEO_TAB;
  const chips = videoChips(videos);
  const chip = videoChip.date === date && chips.some((c) => c.chip === videoChip.chip) ? videoChip.chip : null;
  const sv = sectionView(day, current, view.major);
  const hasStories = sv.top.length + sv.short.length > 0;
  const token = `${date}|${current}|${unread.round}`;
  if (unread.on && hidden.current?.token !== token) {
    const gone = readStore.readKeys(date);
    if (key) gone.delete(key);
    if (expanded) gone.delete(expanded);
    hidden.current = { token, gone };
  }
  const hide = unread.on ? hidden.current! : null;
  // 펼친 카드와 `#<뉴스 키>`로 들어온 뉴스는 읽었어도 보인다(4.4-1). 접으면 사라진다
  const leaving = (s: ListStory) => !!hide && s.key !== expanded && s.key !== key && readStore.isRead(date, s.key);
  const shown = (s: ListStory) => !leaving(s) || !hide!.gone.has(s.key);
  const onGone = (k: string) => {
    hidden.current?.gone.add(k);
    refresh();
  };
  const tops = sv.top.filter(shown);
  const shorts = sv.short.filter(shown);

  function setHash(k: string | null) {
    navigate(briefPath(date!, k ?? undefined), { replace: true, quiet: true });
  }
  function toggle(k: string) {
    // 펼침 상태는 주소의 `#<뉴스 키>`를 따른다(stateForHash)
    setHash(expanded === k ? null : k);
  }
  function chooseSection(s: BriefTab) {
    rememberTab(s);
    setView((v) => ({ ...v, section: s, expanded: null }));
    if (key) setHash(null);
    window.scrollTo({ top: 0 });
  }
  function chooseMajor(m: BriefViewState["major"]) {
    setView((v) => ({ ...v, major: m }));
  }
  function chooseUnread(on: boolean) {
    setUnread((u) => ({ on, round: on ? u.round + 1 : u.round }));
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
        <TopBox day={day} />
        {onVideos ? (
          <>
            <ChipFilter
              label="영상 묶음"
              options={VIDEO_CHIPS.filter((c) => chips.some((x) => x.chip === c))}
              value={chip}
              onChange={(c) => setVideoChip({ date, chip: c })}
              labelOf={(c) => chips.find((x) => x.chip === c)!.label}
            />
            <h2 className="sr-only">추천 영상</h2>
            <div className="vbox">
              <VideoList videos={filterVideos(videos, chip)} mode="brief" Link={Link} resetKey={String(chip)} />
              <VideoSource />
            </div>
          </>
        ) : (
          <>
        <ChipFilter
          label="카테고리"
          options={ALL_MAJORS}
          value={view.major}
          onChange={chooseMajor}
          after={
            <ToggleChip on={unread.on} onChange={chooseUnread}>
              안 읽은 것만
            </ToggleChip>
          }
        />
        <h2 className="sr-only">{current} 뉴스</h2>
        {sv.section?.flow && view.major === null && <p className="flow">{sv.section.flow}</p>}
        {!hasStories && <Empty>{view.major ? "이 분류의 뉴스가 없다." : "이 섹션의 뉴스가 없다."}</Empty>}
        {hasStories && tops.length + shorts.length === 0 && <Empty>안 읽은 뉴스가 없다.</Empty>}
        {tops.length > 0 && (
          <ul className="list">
            {tops.map((s) => (
              <TopItem
                showSection={all}
                key={s.key}
                story={s}
                date={date}
                open={expanded === s.key}
                onToggle={() => toggle(s.key)}
                detail={detailRes}
                onRetry={() => retry([detailUrl])}
                leaving={leaving(s)}
                onGone={() => onGone(s.key)}
              />
            ))}
          </ul>
        )}
        {shorts.length > 0 && (
          <section aria-labelledby="short-h">
            <h3 id="short-h" className="h list-h">
              짧은 소식
            </h3>
            <ul className="list">
              {shorts.map((s) => (
                <ShortItem key={s.key} story={s} date={date} targeted={key === s.key} showSection={all} leaving={leaving(s)} onGone={() => onGone(s.key)} />
              ))}
            </ul>
            <p className="short-report">
              <ReportLink href={shortReportHref(monthDay(date), `${SITE_URL}${briefPath(date)}`)} label="짧은 소식 틀린 내용 알리기" />
            </p>
          </section>
        )}
        {sv.section?.unverified && view.major === null && <p className="flow note">확인되지 않은 내용: {sv.section.unverified}</p>}
          </>
        )}
      </main>
      <Footer />
      <nav className="tabs" aria-label="섹션">
        {tabs.map((s) => (
          <button key={s} type="button" className={s === current ? "on" : ""} aria-pressed={s === current} onClick={() => chooseSection(s)}>
            {s === VIDEO_TAB ? videoTabLabel(videos.length) : s}
          </button>
        ))}
      </nav>
    </>
  );
}

/** '이번 주 일정 | 지표' 상자(6단계 4.7-1). 섹션 탭·대분류 칩과 관계없이 같고, 접은 상태와 고른 탭은 다른 날짜와 다음 방문에도 이어진다 */
function TopBox({ day }: { day: DayList }) {
  const collapsed = useRemembered(weekCollapsed);
  const tab = useRemembered(boxTab);
  const today = useMemo(() => kstDate(new Date()), []);
  return <BriefBox day={day} tab={tab} collapsed={collapsed} onTab={(t) => boxTab.set(t)} onToggle={() => weekCollapsed.set(!collapsed)} today={today} Link={Link} />;
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

/** 대분류 줄. 정정이 있으면 뒤에 표시를 잇는다(펼쳐도 같은 자리다) */
function StoryCategory({ story, open, showSection }: { story: ListStory; open: boolean; showSection: boolean }) {
  const line = <CategoryLine major={story.category.major} minor={story.category.minor} isNewMinor={open && story.category.isNewMinor} section={showSection ? story.section : undefined} />;
  if (!story.corrections) return line;
  return (
    <span className="cat-row">
      {line}
      <FixMark fixes={story.corrections} />
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

interface LeaveProps {
  leaving: boolean;
  onGone: () => void;
}

function TopItem({ story, date, open, onToggle, detail, onRetry, showSection, leaving, onGone }: { story: ListStory; date: string; open: boolean; onToggle: () => void; detail: DetailState; onRetry: () => void; showSection: boolean } & LeaveProps) {
  const id = storyDomId(story.key);
  const ref = useLeave(leaving, onGone);
  const body = detail.status === "ok" ? detail.data.days[date]?.[story.key] : undefined;
  const hasBody = body !== undefined;
  const fixed = story.corrections !== undefined;
  // 정정이 있는 카드를 펼쳤는데 줄이나 '바뀐 내용'이 화면 밖으로 밀리면 줄 윗선을 머리글 아래에 둔다(`docs/design.md`의 '펼침 스크롤')
  useEffect(() => {
    const el = ref.current;
    if (!open || !hasBody || !fixed || !el) return;
    const bar = document.querySelector(".bar")?.getBoundingClientRect().bottom ?? 0;
    const lastFix = [...el.querySelectorAll(".fix")].at(-1);
    if (el.getBoundingClientRect().top < bar || (lastFix?.getBoundingClientRect().bottom ?? 0) > window.innerHeight) el.scrollIntoView({ block: "start" });
  }, [open, hasBody, fixed, ref]);
  return (
    <li ref={ref} id={id} tabIndex={-1} className={open ? "item open" : "item"} data-leaving={leaving || undefined}>
      <div className="item-row">
        <button type="button" className="item-btn" aria-expanded={open} aria-controls={open ? `${id}-body` : undefined} onClick={onToggle}>
          <StoryCategory story={story} open={open} showSection={showSection} />
          <NewsTitle date={date} newsKey={story.key} className="title">
            {story.title}
          </NewsTitle>
          {!open && <ContLine story={story} />}
        </button>
        <ReadToggle date={date} newsKey={story.key} title={story.title} />
      </div>
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
                  <Link to={briefPath(p.date, p.key)} className="nrow">
                    <div className="nrow-txt">
                      <em>{shortDate(p.date, year)}</em>
                      <NewsTitle date={p.date} newsKey={p.key}>
                        {p.title}
                      </NewsTitle>
                    </div>
                    <ReadCheck date={p.date} newsKey={p.key} />
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
      <FixNotes fixes={story.corrections} className="fix" />
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
      {(detail.schedules?.length ?? 0) > 0 && (
        <>
          <h4 className="h">일정</h4>
          <ScheduleChips schedules={detail.schedules} Link={Link} />
        </>
      )}
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
      <ReportLink href={storyReportHref(monthDay(date), story.title, `${SITE_URL}${briefPath(date, story.key)}`)} label="틀린 내용 알리기" />
    </>
  );
}

/** 짧은 소식 줄. 글을 누르면(키보드 Enter·Space 포함) 읽음이 되고, 이슈 링크는 읽음으로 바꾸지 않는다(4.2-2) */
function ShortItem({ story, date, targeted, showSection, leaving, onGone }: { story: ListStory; date: string; targeted: boolean; showSection: boolean } & LeaveProps) {
  const ref = useLeave(leaving, onGone);
  return (
    <li ref={ref} id={storyDomId(story.key)} tabIndex={-1} className={targeted ? "short has-toggle target" : "short has-toggle"} data-leaving={leaving || undefined}>
      <div className="short-main">
        <button type="button" className="short-text" onClick={() => markRead(date, story.key)}>
          <NewsTitle date={date} newsKey={story.key}>
            {story.title}
          </NewsTitle>
        </button>
        <div className="short-meta">
          {showSection && <SectionChip section={story.section} />}
          <span className="cat-inline" style={{ color: categoryVar(story.category.major) }}>
            {story.category.major} · {story.category.minor}
          </span>
          {story.continues && <span className="badge">{story.continues.label}</span>}
          {story.issue && <Link to={issuePath(story.issue.id)}>{story.issue.name}</Link>}
          <FixMark fixes={story.corrections} />
        </div>
        <FixNotes fixes={story.corrections} className="short-fix" />
      </div>
      <ReadToggle date={date} newsKey={story.key} title={story.title} />
    </li>
  );
}
