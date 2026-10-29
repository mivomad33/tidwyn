// 일정 줄·결과 문구·펼친 카드의 일정 칩·'이번 주 일정' 상자·이슈 페이지의 일정(5단계 4.7, 확정 시안 design/site.html).
// 상태는 부르는 쪽이 갖고, 여기는 그리기만 한다. 테스트가 react-dom/server로 그려 보도록 termView.ts처럼
// JSX와 화면 이동기(router.tsx)를 쓰지 않는다: 링크 컴포넌트는 부르는 쪽이 넘긴다.
// 일정 줄은 뉴스가 아니라 읽음 표시를 하지 않는다(4.5단계 M3·M4).
import { createElement as h, Fragment } from "react";
import { categoryVar } from "../lib/theme.ts";
import { issuePath, schedulePath, schedulesPath } from "../lib/routes.ts";
import { SCHEDULE_TAB_LABEL, chipDue, isUpcoming, issueRowDate, issueScheduleRows, nameLink, outcomeParts, scheduleDomId, weekRowDate } from "../lib/schedules.ts";
import type { ScheduleChip, ScheduleItem, ScheduleLine, ScheduleOutcomeView, WeekSchedules } from "../lib/types.ts";
import type { LinkLike } from "./termView.ts";

function arrow() {
  return h("span", { "aria-hidden": true }, " ›");
}

/** 결과 문구. Link를 주면 갈 곳이 있는 문구는 링크이고, 없으면(줄 전체가 링크인 곳) 글자만 보인다. 결과 기다림은 그리지 않는다 */
export function OutcomeBadges({ outcome, today, Link }: { outcome: ScheduleOutcomeView; today: string; Link: LinkLike | null }) {
  const parts = outcomeParts(outcome, today);
  if (!parts.length) return null;
  return h(
    "span",
    { className: "res-row" },
    ...parts.map((p, i) => {
      const className = p.ok ? "res ok" : "res";
      return Link && p.to ? h(Link, { key: i, to: p.to, className }, p.text, arrow()) : h("span", { key: i, className }, p.text);
    }),
  );
}

/** 일정 화면의 일정 한 줄: 대분류(색 글자), 이름(처음 근거 뉴스로), "이슈: <대표 이슈>"(이슈 페이지로), 결과 문구 */
export function ScheduleRow({ item, today, Link, highlight }: { item: ScheduleItem; today: string; Link: LinkLike; highlight: boolean }) {
  const to = nameLink(item);
  return h(
    "li",
    { id: scheduleDomId(item.id), tabIndex: -1, className: highlight ? "ev hl" : "ev" },
    h("div", { className: "cat", style: { color: categoryVar(item.major) } }, item.major),
    to ? h(Link, { to, className: "t" }, item.name) : h("span", { className: "t" }, item.name),
    item.issue ? h("small", null, "이슈: ", h(Link, { to: issuePath(item.issue.id) }, item.issue.name)) : null,
    h(OutcomeBadges, { outcome: item.outcome, today, Link }),
  );
}

/** 펼친 카드의 '일정' 칩 줄(예정일 "MM-DD" 또는 "N월 중"과 이름). 누르면 일정 화면의 그 일정. 일정이 없으면 그리지 않는다 */
export function ScheduleChips({ schedules, Link }: { schedules: ScheduleChip[] | undefined; Link: LinkLike }) {
  if (!schedules?.length) return null;
  return h(
    "div",
    { className: "rel" },
    ...schedules.map((s) => h(Link, { key: s.id, to: schedulePath(s.id), className: "evc" }, h("small", null, chipDue(s.due)), s.name)),
  );
}

export const WEEK_LIST_ID = "week-list";

/**
 * 브리프 위 '이번 주 일정'(4.7-4, C10). 제목 '이번 주 일정 ▴'가 토글이고, 접으면 배경 없는 한 줄 '이번 주 일정 N ▾'만 남는다.
 * 줄마다 "MM-DD 요일"과 이름, 작은 결과 문구(링크 아님). 줄 전체가 일정 화면의 그 일정으로 가는 링크다(링크 안에 링크를 두지 않는다).
 */
export function WeekBox({ week, collapsed, onToggle, today, Link }: { week: WeekSchedules; collapsed: boolean; onToggle: () => void; today: string; Link: LinkLike }) {
  const toggle = h(
    "button",
    { type: "button", className: "week-toggle", "aria-expanded": !collapsed, "aria-controls": collapsed ? undefined : WEEK_LIST_ID, onClick: onToggle },
    collapsed ? `이번 주 일정 ${week.total}` : "이번 주 일정",
    h("span", { "aria-hidden": true }, collapsed ? " ▾" : " ▴"),
  );
  if (collapsed) return h("section", { className: "week closed", "aria-label": "이번 주 일정" }, h("div", { className: "week-h" }, toggle));
  return h(
    "section",
    { className: "week", "aria-label": "이번 주 일정" },
    h("div", { className: "week-h" }, toggle, h(Link, { to: schedulesPath({ list: true }) }, "일정 전체", arrow())),
    h(
      "ul",
      { id: WEEK_LIST_ID },
      ...week.items.map((x) => {
        const parts = outcomeParts(x.outcome, today);
        return h(
          "li",
          { key: x.id },
          h(
            Link,
            { to: schedulePath(x.id), className: "wrow" },
            h("b", null, weekRowDate(x.due)),
            h("span", null, x.name, parts.length ? h("small", null, parts.map((p) => p.text).join(" · ")) : null),
          ),
        );
      }),
    ),
  );
}

function IssueScheduleRow({ line, today, Link }: { line: ScheduleLine; today: string; Link: LinkLike }) {
  const tab = isUpcoming(line.due, today) ? "upcoming" : "past";
  return h(
    "li",
    null,
    h(
      Link,
      { to: schedulePath(line.id), className: "ev-link" },
      h("small", null, `${issueRowDate(line.due, today)} · ${SCHEDULE_TAB_LABEL[tab]}`),
      h("span", { className: "t" }, line.name),
      h(OutcomeBadges, { outcome: line.outcome, today, Link: null }),
    ),
  );
}

/**
 * 이슈 페이지의 '일정'(4.7-5): 다가오는 일정(가까운 순) 다음에 지난 일정(최근 순), 각각 최대 5개.
 * 줄을 누르면 일정 화면의 그 일정. 더 있으면 '일정 전체 ›'(그 이슈로 거르지 않는다). 일정이 없으면 그리지 않는다
 */
export function IssueSchedules({ lines, today, Link }: { lines: ScheduleLine[] | undefined; today: string; Link: LinkLike }) {
  const rows = issueScheduleRows(lines, today);
  if (!rows.upcoming.length && !rows.past.length) return null;
  return h(
    Fragment,
    null,
    h("h2", { className: "h" }, "일정"),
    h("ul", { className: "evlist" }, ...[...rows.upcoming, ...rows.past].map((line) => h(IssueScheduleRow, { key: line.id, line, today, Link }))),
    rows.more ? h("p", { className: "ev-more" }, h(Link, { to: schedulesPath(), className: "text-link" }, "일정 전체", arrow())) : null,
  );
}
