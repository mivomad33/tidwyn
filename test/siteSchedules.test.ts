import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SCHEDULE_REF_CHUNK_SIZE, scheduleRefChunkOf, siteFiles } from "../src/siteTypes.ts";
import type { ScheduleIndex, ScheduleItem, ScheduleLine, ScheduleMonth, ScheduleOutcomeView, ScheduleRefChunk, WeekSchedules } from "../src/siteTypes.ts";
import { resolveStatic } from "../site/hosting.ts";
import { generateFixtures } from "../site/dev/fixtures.ts";
import { IssueSchedules, OutcomeBadges, ScheduleChips, ScheduleRow } from "../site/src/components/scheduleView.ts";
import { BriefBox } from "../site/src/components/briefBox.ts";
import type { LinkLikeProps } from "../site/src/components/termView.ts";
import { dataUrl } from "../site/src/lib/paths.ts";
import { focusTargetId, parseRoute, schedulePath, schedulesPath, selfScrolls } from "../site/src/lib/routes.ts";
import {
  LIST_BATCH,
  addMonths,
  calendarCells,
  calendarRange,
  chipDue,
  dayHeading,
  dayMarks,
  daySchedules,
  dueLabel,
  filterSchedules,
  firstLoadMonths,
  firstWeekday,
  groupSchedules,
  isUpcoming,
  issueRowDate,
  issueScheduleRows,
  monthBoxHeading,
  monthUnitSchedules,
  monthsToShow,
  moveDay,
  nameLink,
  outcomeParts,
  parseScheduleView,
  parseWeekCollapsed,
  resolveScheduleRef,
  selectionForMonth,
  sortForTab,
  stepsToInclude,
  tabOf,
  weekRowDate,
} from "../site/src/lib/schedules.ts";
import { createRemembered, readStored, writeStored } from "../site/src/lib/storage.ts";
import type { StorageLike } from "../site/src/lib/readMarks.ts";

// 5단계 일정 화면의 DOM 없는 로직(다가오는·지난 구분, 정렬, 묶기, 거르기, 결과 문구와 링크, 달력, 나눠 받기, 일정 주소, 보기 기억)과
// 일정 부분 그리기(react-dom/server). 값은 모두 지어낸 것이다. 오늘은 2026-10-28(수)로 둔다.

const TODAY = "2026-10-28";

const pending: ScheduleOutcomeView = { status: "pending" };

function item(id: number, due: string, over: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id,
    name: `가짜 일정 ${id}`,
    due,
    outcome: pending,
    major: "경제",
    issue: { id: 100 + id, name: `가짜 이슈 ${id}` },
    issues: [{ id: 100 + id, name: `가짜 이슈 ${id}` }],
    knownOn: "2026-10-20",
    first: { date: "2026-10-20", key: `한국-${id}` },
    ...over,
  };
}

const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);

describe("4.7-1 다가오는·지난 구분과 정렬", () => {
  test("일 단위는 오늘 포함 뒤가 다가오는 일정, 달 단위는 이번 달 포함 뒤가 다가오는 일정이다", () => {
    assert.equal(isUpcoming("2026-10-28", TODAY), true);
    assert.equal(isUpcoming("2026-10-27", TODAY), false);
    assert.equal(isUpcoming("2026-10", TODAY), true, "이번 달은 다가오는 일정");
    assert.equal(isUpcoming("2026-09", TODAY), false);
    assert.equal(isUpcoming("2026-11", TODAY), true);
    assert.equal(tabOf("2026-10-27", TODAY), "past");
    // 해가 바뀌는 경계
    assert.equal(isUpcoming("2026-12", "2027-01-01"), false);
    assert.equal(isUpcoming("2027-01", "2027-01-31"), true);
  });

  test("다가오는 일정은 가까운 날부터(달 단위는 그 달 날짜 뒤), 지난 일정은 최근 날부터(달 단위는 그 달 날짜 앞)", () => {
    const xs = [item(1, "2026-11-03"), item(2, "2026-10"), item(3, "2026-10-30"), item(4, "2026-10-27"), item(5, "2026-09"), item(6, "2026-09-30"), item(7, "2026-10-30")];
    assert.deepEqual(
      filterSchedules(xs, "upcoming", null, TODAY).map((x) => x.id),
      [3, 7, 2, 1],
    );
    assert.deepEqual(
      filterSchedules(xs, "past", null, TODAY).map((x) => x.id),
      [4, 5, 6],
    );
    assert.deepEqual(
      sortForTab([item(9, "2026-10-01"), item(8, "2026-10-01")], "past").map((x) => x.id),
      [8, 9],
      "같은 날은 식별자 순",
    );
  });

  test("날짜별로 묶고 달 단위 일정은 그 달의 '날짜 미정' 상자 하나에 모인다", () => {
    const sorted = filterSchedules([item(1, "2026-11-03"), item(2, "2026-10"), item(3, "2026-10-30"), item(4, "2026-10"), item(5, "2026-11"), item(6, "2026-11-03")], "upcoming", null, TODAY);
    assert.deepEqual(
      groupSchedules(sorted).map((g) => (g.kind === "day" ? `${g.date}:${g.items.map((x) => x.id)}` : `${g.month}중:${g.items.map((x) => x.id)}`)),
      ["2026-10-30:3", "2026-10중:2,4", "2026-11-03:1,6", "2026-11중:5"],
    );
    assert.equal(monthBoxHeading("2026-11", TODAY), "11월 중 (날짜 미정)");
    assert.equal(monthBoxHeading("2027-01", TODAY), "2027년 1월 중 (날짜 미정)");
    assert.equal(dayHeading("2026-10-30", TODAY), "10월 30일 (금)");
    assert.equal(dayHeading("2025-10-30", TODAY), "2025년 10월 30일 (목)");
  });

  test("대분류로 거르면 그 대분류만 남고, 없으면 빈 결과다", () => {
    const xs = [item(1, "2026-11-03", { major: "정치" }), item(2, "2026-11-04"), item(3, "2026-11", { major: "정치" })];
    assert.deepEqual(
      filterSchedules(xs, "upcoming", "정치", TODAY).map((x) => x.id),
      [1, 3],
    );
    assert.deepEqual(filterSchedules(xs, "upcoming", "국제", TODAY), []);
  });
});

describe("4.7-1 결과 문구와 링크", () => {
  test("다섯 상태의 문구와 갈 곳", () => {
    assert.deepEqual(outcomeParts({ status: "result", news: [{ date: "2026-10-27", key: "세계-2", title: "가짜 결정 나왔다" }] }, TODAY), [{ text: "결과: 가짜 결정 나왔다", to: "/2026-10-27#%EC%84%B8%EA%B3%84-2", ok: true }]);
    assert.deepEqual(outcomeParts({ status: "postponed", to: { id: 42, due: "2026-11-10" } }, TODAY), [{ text: "연기 → 11월 10일", to: "/schedules/42", ok: false }]);
    assert.deepEqual(outcomeParts({ status: "postponed", to: { id: 43, due: "2026-12" } }, TODAY)[0]!.text, "연기 → 12월 중");
    assert.deepEqual(outcomeParts({ status: "postponed", to: { id: 44, due: "2027-01-05" } }, TODAY)[0]!.text, "연기 → 2027년 1월 5일");
    assert.deepEqual(outcomeParts({ status: "postponed", to: null }, TODAY), [{ text: "연기(새 날짜 모름)", to: null, ok: false }]);
    assert.deepEqual(outcomeParts({ status: "cancelled" }, TODAY), [{ text: "취소", to: null, ok: false }]);
    assert.deepEqual(outcomeParts({ status: "missing" }, TODAY), [{ text: "결과 못 찾음", to: null, ok: false }]);
    assert.deepEqual(outcomeParts(pending, TODAY), [], "결과 기다림은 표시 없음");
    assert.equal(dueLabel("2026-11", TODAY), "11월 중");
  });

  test("이름은 처음 근거 뉴스, 이슈는 이슈 페이지, 결과는 결과 뉴스, 연기는 새 일정으로 간다. 대표 이슈가 없으면 이슈 줄이 없다", () => {
    assert.equal(nameLink(item(1, "2026-11-03")), "/2026-10-20#%ED%95%9C%EA%B5%AD-1");
    assert.equal(nameLink(item(1, "2026-11-03", { first: null })), null);
    const html = renderToStaticMarkup(h(ScheduleRow, { item: item(7, "2026-10-27", { outcome: { status: "result", news: [{ date: "2026-10-27", key: "한국-s2", title: "가짜 결과" }] } }), today: TODAY, Link, highlight: false }));
    assert.match(html, /^<li id="schedule-7" tabindex="-1" class="ev">/);
    assert.match(html, /<a href="\/2026-10-20#%ED%95%9C%EA%B5%AD-7" class="t">가짜 일정 7<\/a>/);
    assert.match(html, /이슈: <a href="\/issues\/107">가짜 이슈 7<\/a>/);
    assert.match(html, /<a href="\/2026-10-27#%ED%95%9C%EA%B5%AD-s2" class="res ok">결과: 가짜 결과<span aria-hidden="true"> ›<\/span><\/a>/);
    const noIssue = renderToStaticMarkup(h(ScheduleRow, { item: item(8, "2026-11-01", { issue: null, outcome: { status: "postponed", to: { id: 9, due: "2026-11-20" } } }), today: TODAY, Link, highlight: true }));
    assert.doesNotMatch(noIssue, /이슈:/);
    assert.match(noIssue, /class="ev hl"/);
    assert.match(noIssue, /<a href="\/schedules\/9" class="res">연기 → 11월 20일/);
    const unknown = renderToStaticMarkup(h(OutcomeBadges, { outcome: { status: "postponed", to: null }, today: TODAY, Link }));
    assert.equal(unknown, '<span class="res-row"><span class="res">연기(새 날짜 모름)</span></span>', "새 날짜 모름은 링크가 아니다");
    assert.equal(renderToStaticMarkup(h(OutcomeBadges, { outcome: pending, today: TODAY, Link })), "");
    assert.doesNotMatch(html, /rd-btn|read-mk/, "일정 줄에는 읽음 표시가 없다");
  });
});

describe("4.7-2 달력", () => {
  test("일요일 시작 격자: 1일의 요일만큼 앞 달 날이 오고, 마지막 주 토요일까지 채운다", () => {
    assert.equal(firstWeekday("2026-10"), 4, "2026-10-01은 목요일");
    assert.equal(firstWeekday("2026-11"), 0, "2026-11-01은 일요일");
    const oct = calendarCells("2026-10");
    assert.equal(oct.length, 35);
    assert.deepEqual(oct.slice(0, 5).map((c) => [c.date, c.inMonth]), [["2026-09-27", false], ["2026-09-28", false], ["2026-09-29", false], ["2026-09-30", false], ["2026-10-01", true]]);
    assert.deepEqual(oct.at(-1), { date: "2026-10-31", inMonth: true });
    const nov = calendarCells("2026-11");
    assert.equal(nov[0]!.date, "2026-11-01");
    assert.equal(nov.length, 35);
    assert.deepEqual(nov.slice(-5).map((c) => c.date), ["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04", "2026-12-05"]);
    assert.equal(calendarCells("2026-02").length, 28, "2026-02는 1일이 일요일이고 28일이라 4주");
    for (const m of ["2026-10", "2026-11", "2028-02"]) for (let i = 0; i < calendarCells(m).length; i += 7) assert.equal(new Date(`${calendarCells(m)[i]!.date}T00:00:00Z`).getUTCDay(), 0);
  });

  test("일정 있는 날에 점, 오늘 전 날은 회색 점(past). 달 단위는 점을 찍지 않고, 거르면 그 대분류만", () => {
    const xs = [item(1, "2026-10-27"), item(2, "2026-10-28", { major: "정치" }), item(3, "2026-10-30"), item(4, "2026-10")];
    assert.deepEqual([...dayMarks(xs, TODAY, null)].sort(), [["2026-10-27", "past"], ["2026-10-28", "upcoming"], ["2026-10-30", "upcoming"]]);
    assert.deepEqual([...dayMarks(xs, TODAY, "정치")], [["2026-10-28", "upcoming"]]);
  });

  test("처음 고르는 날: 오늘 일정이 있으면 오늘, 없으면 그 달 오늘 뒤 첫 일정 날, 그것도 없으면 오늘", () => {
    assert.equal(selectionForMonth("2026-10", [item(1, "2026-10-28"), item(2, "2026-10-30")], TODAY, null), "2026-10-28");
    assert.equal(selectionForMonth("2026-10", [item(1, "2026-10-20"), item(2, "2026-10-30"), item(3, "2026-10-29")], TODAY, null), "2026-10-29");
    assert.equal(selectionForMonth("2026-10", [item(1, "2026-10-20"), item(2, "2026-11-02")], TODAY, null), TODAY);
    assert.equal(selectionForMonth("2026-09", [item(1, "2026-09-20"), item(2, "2026-09-03")], TODAY, null), "2026-09-03", "다른 달은 첫 일정 날");
    assert.equal(selectionForMonth("2026-09", [], TODAY, null), null);
    assert.equal(selectionForMonth("2026-10", [item(1, "2026-10-29"), item(2, "2026-10-30", { major: "정치" })], TODAY, "정치"), "2026-10-30", "거른 대분류로 고른다");
  });

  test("달 넘기기 범위: 일정이 있는 첫 달부터 마지막 달까지, 오늘이 든 달이 밖이면 넣는다", () => {
    assert.deepEqual(calendarRange(["2026-08", "2026-12", "2026-10"], TODAY), { first: "2026-08", last: "2026-12" });
    assert.deepEqual(calendarRange(["2026-12", "2027-02"], TODAY), { first: "2026-10", last: "2027-02" });
    assert.deepEqual(calendarRange(["2026-03", "2026-05"], TODAY), { first: "2026-03", last: "2026-10" });
    assert.deepEqual(calendarRange([], TODAY), { first: "2026-10", last: "2026-10" });
    assert.equal(addMonths("2026-12", 1), "2027-01");
    assert.equal(addMonths("2027-01", -1), "2026-12");
  });

  test("고른 날의 줄과 그 달의 달 단위 상자도 거른다", () => {
    const xs = [item(2, "2026-10-30", { major: "정치" }), item(1, "2026-10-30"), item(3, "2026-10"), item(4, "2026-10", { major: "정치" }), item(5, "2026-11")];
    assert.deepEqual(daySchedules(xs, "2026-10-30", null).map((x) => x.id), [1, 2]);
    assert.deepEqual(daySchedules(xs, "2026-10-30", "정치").map((x) => x.id), [2]);
    assert.deepEqual(monthUnitSchedules(xs, "2026-10", null).map((x) => x.id), [3, 4]);
    assert.deepEqual(monthUnitSchedules(xs, "2026-10", "경제").map((x) => x.id), [3]);
  });

  test("키보드로 날짜를 옮긴다(그 달 밖으로 나가지 않는다)", () => {
    assert.equal(moveDay("2026-10-28", "ArrowRight"), "2026-10-29");
    assert.equal(moveDay("2026-10-28", "ArrowDown"), "2026-10-31");
    assert.equal(moveDay("2026-10-03", "ArrowUp"), "2026-10-01");
    assert.equal(moveDay("2026-10-15", "Home"), "2026-10-01");
    assert.equal(moveDay("2026-10-15", "End"), "2026-10-31");
    assert.equal(moveDay("2026-10-15", "a"), null);
  });
});

describe("4.7-1·4.6-2 달 파일 나눠 받기", () => {
  const months = (spec: [string, number][]): ScheduleIndex => ({ total: spec.reduce((n, [, c]) => n + c, 0), months: spec.map(([month, count]) => ({ month, count, majors: { 경제: count } })), majors: ["경제"] });
  const idx = months([["2026-08", 30], ["2026-09", 30], ["2026-10", 50], ["2026-11", 25], ["2026-12", 25], ["2027-01", 25], ["2027-02", 10]]);

  test("다가오는 일정은 이번 달부터, 이번 달을 빼고 40개를 넘을 때까지 받고 더 보기마다 이어 받는다", () => {
    assert.ok(LIST_BATCH === 40);
    assert.deepEqual(monthsToShow(idx, TODAY, "upcoming", null, 1), { months: ["2026-10", "2026-11", "2026-12"], more: true });
    assert.deepEqual(monthsToShow(idx, TODAY, "upcoming", null, 2), { months: ["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"], more: false });
    assert.deepEqual(monthsToShow(idx, TODAY, "past", null, 1), { months: ["2026-10", "2026-09", "2026-08"], more: false });
    const long = months(Array.from({ length: 10 }, (_, i): [string, number] => [addMonths("2026-10", i), 30]));
    assert.deepEqual(monthsToShow(long, TODAY, "upcoming", "정치", 1), { months: long.months.slice(0, 6).map((m) => m.month), more: true }, "거른 대분류가 드물면 한 번에 최대 6달");
  });

  test("일정 주소의 달이 보일 때까지 받고, 처음 받는 파일은 목록 첫 묶음과 달력의 이번 달이다", () => {
    assert.equal(stepsToInclude(idx, TODAY, "upcoming", "2027-02"), 2);
    assert.equal(stepsToInclude(idx, TODAY, "upcoming", "2026-11"), 1);
    assert.deepEqual(firstLoadMonths(idx, TODAY), ["2026-10", "2026-11", "2026-12"]);
    assert.deepEqual(firstLoadMonths(months([["2026-12", 3]]), TODAY), ["2026-12"], "이번 달 파일이 없으면 받지 않는다");
  });
});

describe("4.7-4 '이번 주 일정' 상자", () => {
  const line = (id: number, due: string, outcome: ScheduleOutcomeView = pending): ScheduleLine => ({ id, name: `가짜 주간 일정 ${id}`, due, outcome });
  const week: WeekSchedules = { total: 7, items: [line(1, "2026-10-28"), line(2, "2026-10-29", { status: "cancelled" }), line(3, "2026-10-30", { status: "result", news: [{ date: "2026-10-30", key: "한국-1", title: "가짜 결과" }] }), line(4, "2026-11-01", { status: "missing" }), line(5, "2026-11-02")] };

  // 6단계 4.7-1: '이번 주 일정' 상자가 '이번 주 일정 | 지표' 상자(BriefBox)로 바뀌었다. 지표가 없는 날짜는 일정 탭 하나와 접기 버튼이다
  const box = (collapsed: boolean) => h(BriefBox, { day: { date: TODAY, week }, tab: null, collapsed, onTab: () => {}, onToggle: () => {}, today: TODAY, Link });
  test("펼침: 접기 버튼(aria-expanded), '일정 전체'(목록으로), 줄마다 날짜·이름·작은 결과 문구(링크 아님), 줄 전체가 일정 주소", () => {
    const html = renderToStaticMarkup(box(false));
    assert.match(html, /<button type="button" class="box-toggle box-fold" aria-expanded="true" aria-controls="brief-box-panel" aria-label="상자 접기"><span aria-hidden="true">▴<\/span><\/button>/);
    assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>이번 주 일정 7<\/button>/);
    assert.match(html, /<a href="\/schedules\?view=list">일정 전체/);
    assert.equal(html.match(/class="wrow"/g)?.length, 5);
    assert.match(html, /<a href="\/schedules\/1" class="wrow"><b>10-28 수<\/b><span>가짜 주간 일정 1<\/span><\/a>/);
    assert.match(html, /<a href="\/schedules\/2" class="wrow"><b>10-29 목<\/b><span>가짜 주간 일정 2<small>취소<\/small><\/span><\/a>/);
    assert.match(html, /<small>결과: 가짜 결과<\/small>/);
    assert.match(html, /<small>결과 못 찾음<\/small>/);
    for (const m of html.matchAll(/class="wrow">(.*?)<\/a>/g)) assert.doesNotMatch(m[1]!, /<a /, "링크 안에 링크가 없다");
  });

  test("접음: 배경 없는 한 줄 '이번 주 일정 N ▾'(N은 그 주 전체 수), 목록과 '일정 전체'는 없다", () => {
    const html = renderToStaticMarkup(box(true));
    assert.equal(html, '<section class="week closed" aria-label="이번 주 일정"><div class="week-h"><button type="button" class="box-toggle week-toggle" aria-expanded="false">이번 주 일정 7<span aria-hidden="true"> ▾</span></button></div></section>');
    assert.equal(weekRowDate("2026-11-02"), "11-02 월");
  });
});

describe("4.7-5 펼친 카드의 일정 칩과 이슈 페이지", () => {
  test("칩은 받은 순서(예정일 순)대로 'MM-DD' 또는 'N월 중'과 이름, 일정 주소로 간다. 없으면 그리지 않는다", () => {
    const html = renderToStaticMarkup(h(ScheduleChips, { schedules: [{ id: 3, name: "가짜 처리 시한", due: "2026-11-04" }, { id: 1, name: "가짜 추경 논의", due: "2026-12" }], Link }));
    assert.equal(html, '<div class="rel"><a href="/schedules/3" class="evc"><small>11-04</small>가짜 처리 시한</a><a href="/schedules/1" class="evc"><small>12월 중</small>가짜 추경 논의</a></div>');
    assert.equal(renderToStaticMarkup(h(ScheduleChips, { schedules: undefined, Link })), "");
    assert.equal(renderToStaticMarkup(h(ScheduleChips, { schedules: [], Link })), "");
    assert.equal(chipDue("2026-11"), "11월 중");
  });

  test("이슈 페이지: 다가오는 일정(가까운 순) 최대 5개 다음 지난 일정(최근 순) 최대 5개, 더 있으면 '일정 전체'", () => {
    const lines: ScheduleLine[] = [];
    for (let i = 1; i <= 7; i++) lines.push({ id: i, name: `다가오는 ${i}`, due: `2026-11-${String(10 - i).padStart(2, "0")}`, outcome: pending });
    for (let i = 11; i <= 17; i++) lines.push({ id: i, name: `지난 ${i}`, due: `2026-10-${String(i).padStart(2, "0")}`, outcome: { status: "missing" } });
    lines.push({ id: 20, name: "이번 달 날짜 미정", due: "2026-10", outcome: pending });
    const rows = issueScheduleRows(lines, TODAY);
    assert.deepEqual(rows.upcoming.map((x) => x.id), [20, 7, 6, 5, 4]);
    assert.deepEqual(rows.past.map((x) => x.id), [17, 16, 15, 14, 13]);
    assert.equal(rows.more, true);
    assert.equal(issueScheduleRows(lines.slice(0, 3), TODAY).more, false);
    const html = renderToStaticMarkup(h(IssueSchedules, { lines, today: TODAY, Link }));
    assert.equal(html.match(/class="ev-link"/g)?.length, 10);
    assert.match(html, /<a href="\/schedules\/20" class="ev-link"><small>10월 중 · 다가오는 일정<\/small><span class="t">이번 달 날짜 미정<\/span><\/a>/);
    assert.match(html, /<a href="\/schedules\/17" class="ev-link"><small>10-17 \(토\) · 지난 일정<\/small><span class="t">지난 17<\/span><span class="res-row"><span class="res">결과 못 찾음<\/span><\/span><\/a>/);
    assert.match(html, /<a href="\/schedules" class="text-link">일정 전체/);
    assert.ok(html.indexOf("/schedules/4") < html.indexOf("/schedules/17"), "다가오는 일정이 먼저");
    assert.equal(renderToStaticMarkup(h(IssueSchedules, { lines: undefined, today: TODAY, Link })), "");
    assert.equal(issueRowDate("2025-10-28", TODAY), "2025-10-28 (화)");
  });
});

describe("4.7-6 일정 주소", () => {
  test("일정 화면과 일정 하나의 주소. 일정 주소는 화면이 스스로 스크롤한다", () => {
    assert.deepEqual(parseRoute("/schedules"), { name: "schedules", id: null, list: false });
    assert.deepEqual(parseRoute("/schedules/", "?view=list"), { name: "schedules", id: null, list: true });
    assert.deepEqual(parseRoute("/schedules/12"), { name: "schedules", id: 12, list: true });
    assert.deepEqual(parseRoute("/schedules/012"), { name: "notFound" });
    assert.deepEqual(parseRoute("/schedules/x"), { name: "notFound" });
    assert.equal(selfScrolls(parseRoute("/schedules/12")), true);
    assert.equal(selfScrolls(parseRoute("/schedules")), false);
    assert.equal(focusTargetId(parseRoute("/schedules")), "main");
    assert.equal(schedulePath(12), "/schedules/12");
    assert.equal(schedulesPath(), "/schedules");
    assert.equal(schedulesPath({ list: true }), "/schedules?view=list");
  });

  test("살아 있는 일정은 그 달, 흡수된 것은 남는 것, 지운 것과 없는 식별자는 null", () => {
    const chunk: ScheduleRefChunk = { months: { "3": "2026-11", "5": "2026-10" }, merged: { "9": 3, "7": 7 } };
    assert.deepEqual(resolveScheduleRef(3, chunk), { kind: "live", id: 3, month: "2026-11" });
    assert.deepEqual(resolveScheduleRef(9, chunk), { kind: "merged", into: 3 });
    assert.equal(resolveScheduleRef(8, chunk), null, "지운 것은 묶음에 없다");
    assert.equal(resolveScheduleRef(7, chunk), null, "자기 자신을 가리키면 없는 것으로 본다");
    assert.equal(resolveScheduleRef(Number("1e3"), chunk), null);
  });

  test("지어낸 데이터에서 흡수된 일정은 남는 일정의 달로, 지운 일정은 어디에도 없다", () => {
    const fx = generateFixtures({ days: 20, schedules: 60 });
    const info = fx.info.schedules!;
    const json = <T>(name: string) => JSON.parse(fx.files.get(`site-data/${name}`)!) as T;
    const chunk = json<ScheduleRefChunk>(siteFiles.scheduleRef(scheduleRefChunkOf(info.merged!.id)));
    const into = resolveScheduleRef(info.merged!.id, chunk);
    assert.deepEqual(into, { kind: "merged", into: info.merged!.into });
    const live = resolveScheduleRef(info.merged!.into, chunk);
    assert.equal(live?.kind, "live");
    const month = json<ScheduleMonth>(siteFiles.scheduleMonth(live!.kind === "live" ? live.month : ""));
    assert.ok(month.items.some((x) => x.id === info.merged!.into));
    assert.equal(resolveScheduleRef(info.deleted!, json<ScheduleRefChunk>(siteFiles.scheduleRef(scheduleRefChunkOf(info.deleted!)))), null);
    const all = [...fx.files].filter(([k]) => k.startsWith("site-data/")).map(([, v]) => v).join("\n");
    assert.ok(!new RegExp(`"id":${info.deleted},`).test(all), "지운 일정은 어떤 파일에도 없다");
    assert.equal(SCHEDULE_REF_CHUNK_SIZE, 1000);
  });

  test("새 주소는 화면 틀로 가고, 화면이 부르는 파일 이름이 약속(siteFiles)과 같다", () => {
    const exists = (p: string) => p === "site-data/schedule-index.json";
    for (const p of ["/schedules", "/schedules/3"]) assert.deepEqual(resolveStatic(p, exists), { kind: "fallback" }, p);
    assert.deepEqual(resolveStatic("/site-data/schedule-ref-99.json", exists), { kind: "notFound" });
    assert.equal(dataUrl.scheduleIndex(), `/site-data/${siteFiles.scheduleIndex}`);
    assert.equal(dataUrl.scheduleMonth("2026-10"), `/site-data/${siteFiles.scheduleMonth("2026-10")}`);
    assert.equal(dataUrl.scheduleRef(2), `/site-data/${siteFiles.scheduleRef(2)}`);
  });
});

describe("4.7-3·4.7-4 화면 기억", () => {
  function memStorage(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
    const data = { ...init };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  }
  const throwing: StorageLike = {
    getItem() {
      throw new Error("막힌 저장소");
    },
    setItem() {
      throw new Error("막힌 저장소");
    },
  };

  test("보기: 처음과 깨진 값은 목록, 달력을 고르면 기억한다", () => {
    assert.equal(parseScheduleView(null), "list");
    assert.equal(parseScheduleView("grid"), "list");
    assert.equal(parseScheduleView("calendar"), "calendar");
    const s = memStorage();
    const v = createRemembered(s, "tidwyn.scheduleView", parseScheduleView, (x) => x);
    assert.equal(v.get(), "list");
    let calls = 0;
    v.subscribe(() => calls++);
    v.set("calendar");
    assert.equal(s.data["tidwyn.scheduleView"], "calendar");
    assert.equal(createRemembered(s, "tidwyn.scheduleView", parseScheduleView, (x) => x).get(), "calendar", "다시 열어도 달력");
    assert.equal(calls, 1);
  });

  test("접기: 처음·깨진 값·저장할 수 없음은 펼침이고, 저장할 수 없어도 그 탭 안에서는 접은 상태가 이어진다", () => {
    assert.equal(parseWeekCollapsed(null), false);
    assert.equal(parseWeekCollapsed("true"), false);
    assert.equal(parseWeekCollapsed("closed"), true);
    const w = createRemembered(throwing, "tidwyn.weekBox", parseWeekCollapsed, (x) => (x ? "closed" : "open"));
    assert.equal(w.get(), false);
    w.set(true);
    assert.equal(w.get(), true);
    assert.equal(readStored(throwing, "x"), null);
    assert.doesNotThrow(() => writeStored(throwing, "x", "y"));
    assert.equal(readStored(null, "x"), null);
  });
});

describe("지어낸 일정 데이터", () => {
  test("일정이 없으면 빈 색인만 더하고, 있으면 일·달 단위와 다섯 결과 상태, '이번 주 일정' 있는·없는 날짜, 칩, 이슈 일정이 있다", () => {
    const none = generateFixtures({ days: 7 });
    assert.deepEqual(JSON.parse(none.files.get("site-data/schedule-index.json")!), { total: 0, months: [], majors: [] });
    assert.ok(![...none.files.keys()].some((k) => /schedule-(month|ref)/.test(k)));
    assert.ok(![...none.files.values()].some((v) => v.includes('"week"') || v.includes('"schedules"')));

    const fx = generateFixtures({ end: "2026-10-27", days: 45, schedules: 120 });
    const index = JSON.parse(fx.files.get("site-data/schedule-index.json")!) as ScheduleIndex;
    const items = index.months.flatMap((m) => (JSON.parse(fx.files.get(`site-data/schedule-month-${m.month}.json`)!) as ScheduleMonth).items);
    assert.equal(items.length, index.total);
    assert.equal(index.total, 118);
    const states = new Set(items.map((x) => (x.outcome.status === "postponed" ? (x.outcome.to ? "postponed" : "postponed-unknown") : x.outcome.status)));
    assert.deepEqual([...states].sort(), ["cancelled", "missing", "pending", "postponed", "postponed-unknown", "result"]);
    assert.ok(items.some((x) => x.due.length === 7) && items.some((x) => x.due.length === 10));
    assert.ok(items.some((x) => isUpcoming(x.due, TODAY) && (x.outcome.status === "cancelled" || x.outcome.status === "postponed")), "다가오는 일정의 연기·취소(C15)");
    const lists = [...fx.files].filter(([k]) => k.startsWith("site-data/list-")).flatMap(([, v]) => JSON.parse(v).days as { date: string; week?: WeekSchedules }[]);
    assert.ok(lists.some((d) => !d.week) && lists.some((d) => (d.week?.total ?? 0) > 5));
    for (const d of lists) if (d.week) assert.ok(d.week.items.length <= 5 && d.week.items.length === Math.min(5, d.week.total));
    for (const d of lists) for (const x of d.week?.items ?? []) {
      const full = items.find((y) => y.id === x.id)!;
      assert.ok(full.knownOn <= d.date && x.due > d.date && tabOf(x.due, d.date) === "upcoming", "브리프 날짜 기준(C8)");
    }
    assert.ok([...fx.files].some(([k, v]) => k.startsWith("site-data/detail-") && v.includes('"schedules"')));
    assert.ok([...fx.files].some(([k, v]) => k.startsWith("site-data/issue-") && v.includes('"schedules"')));
  });
});
