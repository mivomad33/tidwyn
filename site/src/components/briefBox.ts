// 브리프 위 '이번 주 일정 | 지표' 상자(6단계 4.7-1, X7. 5단계 '이번 주 일정' 상자를 바꿨다, 확정 시안 design/site.html).
// 위 줄에 탭('이번 주 일정 N', '지표')과 오른쪽 접기 버튼(▴). 접으면 배경 없는 한 줄 "이번 주 일정 N · 원/달러 <값> <변화> ▾"만 남는다.
// 상태(고른 탭, 접음)는 부르는 쪽이 갖고, 여기는 그리기와 키보드 처리만 한다. 테스트가 react-dom/server로 그려 보도록 JSX를 쓰지 않는다.
import { createElement as h, useEffect, useRef, type KeyboardEvent } from "react";
import { focusById, focusIn } from "../lib/dom.ts";
import { boxTabText, boxValuesDate, briefBoxModel, changeLabel, chipDateNote, collapsedParts, formatValue, type BoxTab } from "../lib/indicators.ts";
import { indicatorPath, indicatorsPath } from "../lib/routes.ts";
import type { DayList } from "../lib/types.ts";
import { ChangeText } from "./indicatorView.ts";
import { WeekAllLink, WeekRows } from "./scheduleView.ts";
import type { LinkLike } from "./termView.ts";

export const BOX_PANEL_ID = "brief-box-panel";

function tabId(tab: BoxTab): string {
  return `brief-box-tab-${tab}`;
}

function arrow() {
  return h("span", { "aria-hidden": true }, " ›");
}

export interface BriefBoxProps {
  day: Pick<DayList, "date" | "week" | "indicators">;
  /** 기억한 탭(없으면 null: 그 날짜의 처음 탭) */
  tab: BoxTab | null;
  collapsed: boolean;
  onTab: (tab: BoxTab) => void;
  onToggle: () => void;
  today: string;
  Link: LinkLike;
}

/** 일정도 지표도 없으면 그리지 않는다(상자도 접은 줄도 없다) */
export function BriefBox({ day, tab, collapsed, onTab, onToggle, today, Link }: BriefBoxProps) {
  const model = briefBoxModel(day, tab);
  const ref = useRef(null);
  const refocus = useRef(false);
  // 접고 펴면 버튼이 바뀌므로 키보드 위치를 새 버튼으로 옮긴다
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    focusIn(ref.current, ".box-toggle");
  }, [collapsed]);
  if (!model) return null;
  const toggle = () => {
    refocus.current = true;
    onToggle();
  };

  if (collapsed) {
    const p = collapsedParts(day);
    return h(
      "section",
      { ref, className: "week closed", "aria-label": model.label },
      h(
        "div",
        { className: "week-h" },
        h(
          "button",
          { type: "button", className: "box-toggle week-toggle", "aria-expanded": false, onClick: toggle },
          p.week,
          p.week && p.chip ? h("span", { className: "dot-sep", "aria-hidden": true }, " · ") : null,
          p.chip ? h("span", { className: "fold-chip" }, p.chip.text, " ", h(ChangeText, { label: p.chip.change })) : null,
          h("span", { "aria-hidden": true }, " ▾"),
        ),
      ),
    );
  }

  function onKey(e: KeyboardEvent) {
    const tabs = model!.tabs;
    const i = tabs.indexOf(model!.tab);
    let next: BoxTab | null = null;
    if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length]!;
    else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length]!;
    else if (e.key === "Home") next = tabs[0]!;
    else if (e.key === "End") next = tabs.at(-1)!;
    if (next === null) return;
    e.preventDefault();
    onTab(next);
    focusById(tabId(next));
  }

  const panel =
    model.tab === "week" && day.week
      ? [h(WeekRows, { key: "rows", week: day.week, today, Link }), h("p", { key: "foot", className: "box-foot" }, h(WeekAllLink, { Link }))]
      : [
          h(
            "ul",
            { key: "chips", className: "ichips", "aria-label": "지표 값" },
            ...model.chips.map((c) => {
              const note = chipDateNote(c, day.date);
              return h(
                "li",
                { key: c.id },
                h(
                  Link,
                  { to: indicatorPath(c.id), className: "ichip" },
                  h("span", { className: "n" }, c.name),
                  h("b", null, formatValue(c, c.value)),
                  h(ChangeText, { label: changeLabel({ change: c.kind, decimals: c.decimals }, c.value, c.change, true) }),
                  note ? h("small", null, note, h("span", { className: "sr-only" }, " 값")) : null,
                ),
              );
            }),
          ),
          h("p", { key: "foot", className: "box-foot" }, `${boxValuesDate(day.date)} · `, h(Link, { to: indicatorsPath() }, "지표 전체", arrow())),
        ];

  return h(
    "section",
    { ref, className: "week", "aria-label": model.label },
    h(
      "div",
      { className: "week-h" },
      h(
        "div",
        { role: "tablist", className: "box-tabs", "aria-label": model.label, onKeyDown: onKey },
        ...model.tabs.map((t) =>
          h(
            "button",
            {
              key: t,
              type: "button",
              role: "tab",
              id: tabId(t),
              className: t === model.tab ? "on" : undefined,
              "aria-selected": t === model.tab,
              "aria-controls": BOX_PANEL_ID,
              tabIndex: t === model.tab ? 0 : -1,
              onClick: () => onTab(t),
            },
            boxTabText(t, day),
          ),
        ),
      ),
      h("button", { type: "button", className: "box-toggle box-fold", "aria-expanded": true, "aria-controls": BOX_PANEL_ID, "aria-label": "상자 접기", onClick: toggle }, h("span", { "aria-hidden": true }, "▴")),
    ),
    h("div", { id: BOX_PANEL_ID, role: "tabpanel", "aria-labelledby": tabId(model.tab), className: `box-panel tab-${model.tab}` }, ...panel),
  );
}
