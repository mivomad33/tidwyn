// 일정 화면(5단계 4.7-1·4.7-2·4.7-3·4.7-6, 확정 시안 design/site.html). '목록'(기본)과 '달력'을 바꾸고, 마지막으로 고른 보기를 기억한다.
// 목록은 '다가오는 일정 / 지난 일정' 두 탭이고 달 파일을 나눠 받는다(처음과 "더 보기"마다 몇 달씩, 4.6-2).
// 일정 주소(`/schedules/<id>`)로 들어오면 기억한 보기와 관계없이 목록의 그 일정이 든 탭으로 가서 그 위치로 옮기고 잠깐 강조한다.
// 흡수된 일정 주소는 남는 일정 주소로 바꾸고, 지운 일정과 없는 식별자는 없는 페이지다.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { kstDate } from "../../../src/kst.ts";
import { scheduleRefChunkOf } from "../../../src/siteTypes.ts";
import { BackLink, ChipFilter, Empty, ErrorState, Layout, Loading, useFocusNewRow, useTitle } from "../components/common.tsx";
import { ScheduleRow } from "../components/scheduleView.ts";
import { retry, useResource, useResources } from "../data.ts";
import { monthLabel } from "../lib/format.ts";
import { dataUrl } from "../lib/paths.ts";
import { schedulePath, schedulesPath } from "../lib/routes.ts";
import {
  SCHEDULE_TAB_LABEL,
  calendarCells,
  calendarRange,
  addMonths,
  dayHeading,
  dayMarks,
  daySchedules,
  filterSchedules,
  groupSchedules,
  monthBoxHeading,
  monthOfDue,
  monthUnitSchedules,
  monthsToShow,
  moveDay,
  resolveScheduleRef,
  scheduleDomId,
  selectionForMonth,
  stepsToInclude,
  tabOf,
  type ScheduleTab,
  type ScheduleView,
} from "../lib/schedules.ts";
import type { Major, ScheduleIndex, ScheduleItem, ScheduleMonth, ScheduleRefChunk } from "../lib/types.ts";
import { Link, navigate } from "../router.tsx";
import { scheduleView, useRemembered } from "../storage.ts";
import { NotFoundPage } from "./NotFoundPage.tsx";

/** 일정 주소로 들어온 일정을 강조해 두는 시간 */
const HIGHLIGHT_MS = 4000;

const TABS: ScheduleTab[] = ["upcoming", "past"];

type Target = { status: "none" } | { status: "loading" } | { status: "error"; urls: string[] } | { status: "notFound" } | { status: "ok"; id: number; month: string };

/** 일정 주소의 식별자 → 보일 일정과 그 달. 흡수된 것은 남는 것의 묶음에서 다시 찾는다 */
function useTarget(id: number | null): Target {
  const firstUrl = id === null ? null : dataUrl.scheduleRef(scheduleRefChunkOf(id));
  const firstRes = useResource<ScheduleRefChunk>(firstUrl);
  const first = id !== null && firstRes.status === "ok" ? resolveScheduleRef(id, firstRes.data) : null;
  const intoUrl = first?.kind === "merged" ? dataUrl.scheduleRef(scheduleRefChunkOf(first.into)) : null;
  const intoRes = useResource<ScheduleRefChunk>(intoUrl);
  if (id === null) return { status: "none" };
  if (firstRes.status === "error") return firstRes.notFound ? { status: "notFound" } : { status: "error", urls: [firstUrl!] };
  if (firstRes.status !== "ok") return { status: "loading" };
  if (!first) return { status: "notFound" };
  if (first.kind === "live") return { status: "ok", id: first.id, month: first.month };
  if (intoRes.status === "error") return intoRes.notFound ? { status: "notFound" } : { status: "error", urls: [intoUrl!] };
  if (intoRes.status !== "ok") return { status: "loading" };
  const into = resolveScheduleRef(first.into, intoRes.data);
  return into?.kind === "live" ? { status: "ok", id: into.id, month: into.month } : { status: "notFound" };
}

export function SchedulesPage({ id, list }: { id: number | null; list: boolean }) {
  useTitle("일정");
  const today = useMemo(() => kstDate(new Date()), []);
  const indexUrl = dataUrl.scheduleIndex();
  const indexRes = useResource<ScheduleIndex>(indexUrl);
  const remembered = useRemembered(scheduleView);
  const target = useTarget(id);
  const [major, setMajor] = useState<Major | null>(null);

  // 흡수된 일정 주소는 남는 일정 주소로 바꾼다
  useEffect(() => {
    if (id !== null && target.status === "ok" && target.id !== id) navigate(schedulePath(target.id), { replace: true });
  }, [id, target]);

  // 일정 주소와 '일정 전체'(목록으로)는 기억한 보기와 관계없이 목록이다. 보기를 고르면 기억하고 일정 화면 주소로 바꾼다
  const view: ScheduleView = id !== null || list ? "list" : remembered;
  function chooseView(v: ScheduleView) {
    scheduleView.set(v);
    if (id !== null || list) navigate(schedulesPath(), { replace: true, quiet: true });
  }

  const back = <BackLink to="/" label="브리프" />;
  if (target.status === "notFound") return <NotFoundPage />;
  const head = (
    <div className="sch-head">
      <div className="ptitle">
        <h1>일정</h1>
        <div className="view" role="group" aria-label="보기">
          {(["list", "calendar"] as const).map((v) => (
            <button key={v} type="button" className={view === v ? "on" : ""} aria-pressed={view === v} onClick={() => chooseView(v)}>
              {v === "list" ? "목록" : "달력"}
            </button>
          ))}
        </div>
      </div>
      <p className="meta">뉴스에서 모은 예정 일정 · 날짜는 현지 기준</p>
    </div>
  );
  if (indexRes.status === "error" || target.status === "error") {
    return (
      <Layout left={back}>
        {head}
        <ErrorState onRetry={() => retry([indexUrl, ...(target.status === "error" ? target.urls : [])])} />
      </Layout>
    );
  }
  if (indexRes.status !== "ok" || target.status === "loading") {
    return (
      <Layout left={back}>
        {head}
        <Loading />
      </Layout>
    );
  }
  const index = indexRes.data;
  const chips = <ChipFilter label="대분류" options={index.majors} value={major} onChange={setMajor} />;
  return (
    <Layout left={back}>
      {head}
      {index.total === 0 ? (
        <Empty>아직 모은 일정이 없다.</Empty>
      ) : view === "list" ? (
        <ListView index={index} today={today} major={major} chips={chips} target={target.status === "ok" && target.id === id ? target : null} />
      ) : (
        <CalendarView index={index} today={today} major={major} chips={chips} />
      )}
    </Layout>
  );
}

/** 달 파일들을 받아 이어 붙인다. 앞에서부터 받은 달까지만 쓴다(중간이 비지 않게) */
function useMonths(index: ScheduleIndex, months: string[]) {
  const known = months.filter((m) => index.months.some((x) => x.month === m));
  const urls = known.map((m) => dataUrl.scheduleMonth(m));
  const res = useResources<ScheduleMonth>(urls);
  const items: ScheduleItem[] = [];
  let state: "ok" | "loading" | "error" = "ok";
  for (const r of res) {
    if (r.status === "ok") items.push(...r.data.items);
    else {
      state = r.status === "error" ? "error" : "loading";
      break;
    }
  }
  return { items, state, urls };
}

function ListView({ index, today, major, chips, target }: { index: ScheduleIndex; today: string; major: Major | null; chips: ReactNode; target: { id: number; month: string } | null }) {
  // 일정 주소로 들어온 일정의 탭을 알려면 그 달 파일이 있어야 한다
  const targetMonth = useResource<ScheduleMonth>(target ? dataUrl.scheduleMonth(target.month) : null);
  const targetItem = target && targetMonth.status === "ok" ? (targetMonth.data.items.find((x) => x.id === target.id) ?? null) : null;
  const targetTab = targetItem ? tabOf(targetItem.due, today) : null;
  const [tabState, setTab] = useState<ScheduleTab | null>(null);
  const tab = tabState ?? targetTab ?? "upcoming";
  // 탭마다 "더 보기"를 누른 횟수 + 1. 대분류를 바꾸면 처음으로 돌린다
  const [steps, setSteps] = useState<Record<ScheduleTab, number>>({ upcoming: 1, past: 1 });
  const [stepsMajor, setStepsMajor] = useState(major);
  if (stepsMajor !== major) {
    setStepsMajor(major);
    setSteps({ upcoming: 1, past: 1 });
  }
  const need = targetItem && tab === targetTab ? stepsToInclude(index, today, tab, monthOfDue(targetItem.due)) : 1;
  const shown = monthsToShow(index, today, tab, major, Math.max(steps[tab], major === null ? need : 1));
  const loaded = useMonths(index, shown.months);
  const items = filterSchedules(loaded.items, tab, major, today);
  const groups = groupSchedules(items);

  // "더 보기"를 누르면 버튼이 잠깐 대기 표시로 바뀌므로, 받은 뒤 새로 보인 첫 일정으로 포커스를 옮긴다
  const more = useFocusNewRow<HTMLDivElement>(".ev", `${tab}|${major}`);
  function showMore() {
    more.mark();
    setSteps((s) => ({ ...s, [tab]: Math.max(s[tab], major === null ? need : 1) + 1 }));
  }

  // 일정 주소: 그 일정이 보이면 그 위치로 옮기고 잠깐 강조한다(한 번만)
  const [hl, setHl] = useState<number | null>(null);
  const done = useRef<number | null>(null);
  const visible = targetItem !== null && items.some((x) => x.id === targetItem.id);
  useEffect(() => {
    if (!targetItem || !visible || done.current === targetItem.id) return;
    const el = document.getElementById(scheduleDomId(targetItem.id));
    if (!el) return;
    done.current = targetItem.id;
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
    setHl(targetItem.id);
  }, [targetItem, visible]);
  useEffect(() => {
    if (hl === null) return;
    const t = window.setTimeout(() => setHl(null), HIGHLIGHT_MS);
    return () => window.clearTimeout(t);
  }, [hl]);

  if (target && targetMonth.status === "error") return <ErrorState onRetry={() => retry([dataUrl.scheduleMonth(target.month)])} />;
  if (target && targetMonth.status === "ok" && !targetItem) return <Empty>이 일정을 찾지 못했다.</Empty>;
  if (target && !targetItem) return <Loading />;

  const label = SCHEDULE_TAB_LABEL[tab];
  return (
    <>
      <div className="seg" role="group" aria-label="일정 구분">
        {TABS.map((t) => (
          <button key={t} type="button" className={t === tab ? "on" : ""} aria-pressed={t === tab} onClick={() => setTab(t)}>
            {SCHEDULE_TAB_LABEL[t]}
          </button>
        ))}
      </div>
      {chips}
      <div className="sch-body" ref={more.ref}>
        <h2 className="sr-only">{label}</h2>
        {groups.map((g) =>
          g.kind === "day" ? (
            <section key={g.date} aria-label={dayHeading(g.date, today)}>
              <h3 className="dh">{dayHeading(g.date, today)}</h3>
              <ul className="evs">
                {g.items.map((x) => (
                  <ScheduleRow key={x.id} item={x} today={today} Link={Link} highlight={hl === x.id} />
                ))}
              </ul>
            </section>
          ) : (
            <section key={g.month} className="mon" aria-label={monthBoxHeading(g.month, today)}>
              <h3 className="mon-h">{monthBoxHeading(g.month, today)}</h3>
              <ul className="evs">
                {g.items.map((x) => (
                  <ScheduleRow key={x.id} item={x} today={today} Link={Link} highlight={hl === x.id} />
                ))}
              </ul>
            </section>
          ),
        )}
        {loaded.state === "error" && <ErrorState onRetry={() => retry(loaded.urls)} />}
        {loaded.state === "loading" && <Loading />}
        {loaded.state === "ok" && items.length === 0 && !shown.more && <Empty>{major ? `이 분류의 ${label}이 없다.` : `${label}이 없다.`}</Empty>}
        {loaded.state === "ok" && shown.more && (
          <div className="more">
            <button type="button" className="retry" onClick={showMore}>
              더 보기
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function CalendarView({ index, today, major, chips }: { index: ScheduleIndex; today: string; major: Major | null; chips: ReactNode }) {
  const range = calendarRange(
    index.months.map((m) => m.month),
    today,
  );
  const [month, setMonth] = useState(monthOfDue(today));
  const loaded = useMonths(index, [month]);
  const monthItems = loaded.state === "ok" ? loaded.items : [];
  const [picked, setPicked] = useState<{ month: string; day: string } | null>(null);
  const [announce, setAnnounce] = useState("");
  const [focusDay, setFocusDay] = useState<string | null>(null);
  const day = picked && picked.month === month ? picked.day : selectionForMonth(month, monthItems, today, major);
  const marks = dayMarks(monthItems, today, major);
  const dayItems = day ? daySchedules(monthItems, day, major) : [];
  const monthUnit = monthUnitSchedules(monthItems, month, major);
  const cells = calendarCells(month);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusDay) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDay}"]`)?.focus();
    setFocusDay(null);
  }, [focusDay]);

  function countOf(date: string): number {
    return daySchedules(monthItems, date, major).length;
  }
  function pick(date: string, focus = false) {
    setPicked({ month, day: date });
    const n = countOf(date);
    setAnnounce(`${dayHeading(date, today)} 고름, ${n ? `일정 ${n}개` : "일정 없음"}`);
    if (focus) setFocusDay(date);
  }
  function onKey(e: KeyboardEvent<HTMLButtonElement>, date: string) {
    const next = moveDay(date, e.key);
    if (!next) return;
    e.preventDefault();
    pick(next, true);
  }
  function go(n: number) {
    setMonth((m) => addMonths(m, n));
    setAnnounce("");
  }

  const focusable = day ?? `${month}-01`;
  const hasAny = marks.size > 0 || monthUnit.length > 0;
  return (
    <>
      {chips}
      <div className="sch-body">
        <div className="monthnav">
          <button type="button" aria-label="이전 달" disabled={month <= range.first} onClick={() => go(-1)}>
            ‹
          </button>
          <h2 aria-live="polite">{monthLabel(month)}</h2>
          <button type="button" aria-label="다음 달" disabled={month >= range.last} onClick={() => go(1)}>
            ›
          </button>
        </div>
        {loaded.state === "error" && <ErrorState onRetry={() => retry(loaded.urls)} />}
        {loaded.state === "loading" && <Loading />}
        {loaded.state === "ok" && (
          <>
            <div ref={gridRef} className="cal" role="group" aria-label={`${monthLabel(month)} 날짜`}>
              {["일", "월", "화", "수", "목", "금", "토"].map((w) => (
                <span key={w} className="w" aria-hidden="true">
                  {w}
                </span>
              ))}
              {cells.map((c) =>
                c.inMonth ? (
                  <button
                    key={c.date}
                    type="button"
                    data-date={c.date}
                    className={["d", c.date === day ? "sel" : "", c.date === today ? "tod" : ""].filter(Boolean).join(" ")}
                    aria-pressed={c.date === day}
                    aria-current={c.date === today ? "date" : undefined}
                    aria-label={`${dayHeading(c.date, today)}${c.date === today ? ", 오늘" : ""}${marks.has(c.date) ? `, 일정 ${countOf(c.date)}개` : ""}`}
                    tabIndex={c.date === focusable ? 0 : -1}
                    onClick={() => pick(c.date)}
                    onKeyDown={(e) => onKey(e, c.date)}
                  >
                    {Number(c.date.slice(8))}
                    {marks.has(c.date) && <i className={marks.get(c.date) === "past" ? "p" : undefined} />}
                  </button>
                ) : (
                  <span key={c.date} className="d o" aria-hidden="true">
                    {Number(c.date.slice(8))}
                  </span>
                ),
              )}
            </div>
            <p className="sr-only" role="status" aria-live="polite">
              {announce}
            </p>
            {!hasAny && <Empty>{major ? "이 달에는 이 분류의 일정이 없다." : "이 달에는 일정이 없다."}</Empty>}
            {hasAny && day && (
              <section aria-label={dayHeading(day, today)}>
                <h3 className="dh">{dayHeading(day, today)}</h3>
                {dayItems.length ? (
                  <ul className="evs">
                    {dayItems.map((x) => (
                      <ScheduleRow key={x.id} item={x} today={today} Link={Link} highlight={false} />
                    ))}
                  </ul>
                ) : (
                  <p className="p muted day-empty">이 날에는 일정이 없다.</p>
                )}
              </section>
            )}
            {monthUnit.length > 0 && (
              <section className="mon" aria-label={monthBoxHeading(month, today)}>
                <h3 className="mon-h">{monthBoxHeading(month, today)}</h3>
                <ul className="evs">
                  {monthUnit.map((x) => (
                    <ScheduleRow key={x.id} item={x} today={today} Link={Link} highlight={false} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
