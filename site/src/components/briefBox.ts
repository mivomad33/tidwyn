// 브리프 위 '이번 주 일정과 지표' 상자(6단계 4.7-1, X7. 2026-11-27 tone-split T7에서 탭을 없애고 두 구역을 함께 보인다).
// 접으면 배경 없는 한 줄 "이번 주 일정 N · 원/달러 <값> <변화> ▾"만 남는다. 펴면 같은 자리의 줄 '이번 주 일정과 지표 ▴' 아래에
// '이번 주 일정' 구역(최대 5줄)과 '지표' 구역(칸 격자)이 차례로 보인다. 없는 쪽 구역은 빠진다.
// 펼침 상태는 부르는 쪽이 갖고, 여기는 그리기와 키보드 처리만 한다. 테스트가 react-dom/server로 그려 보도록 JSX를 쓰지 않는다.
import { createElement as h, useEffect, useRef } from "react";
import { focusIn } from "../lib/dom.ts";
import { yearOf } from "../lib/format.ts";
import { BOX_LABEL, briefBoxModel, changeLabel, chipDateNote, collapsedParts, formatValue } from "../lib/indicators.ts";
import { indicatorPath, indicatorsPath } from "../lib/routes.ts";
import type { DayList } from "../lib/types.ts";
import { ChangeText } from "./indicatorView.ts";
import { WeekAllLink, WeekRows } from "./scheduleView.ts";
import { MoreMark } from "./moreMark.ts";
import type { LinkLike } from "./termView.ts";

export const BOX_BODY_ID = "brief-box-body";

export interface BriefBoxProps {
  day: Pick<DayList, "date" | "week" | "indicators">;
  collapsed: boolean;
  onToggle: () => void;
  today: string;
  Link: LinkLike;
}

/** 구역 머리: 작은 제목과 같은 줄 오른쪽 끝의 '… 전체 ›' */
function SectionHead({ id, title, more }: { id: string; title: string; more: ReturnType<typeof h> }) {
  return h("div", { className: "box-sec-h" }, h("h2", { id }, title), more);
}

/** 일정도 지표도 없으면 그리지 않는다(상자도 접은 줄도 없다) */
export function BriefBox({ day, collapsed, onToggle, today, Link }: BriefBoxProps) {
  const model = briefBoxModel(day);
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

  const refYear = yearOf(day.date);
  return h(
    "section",
    { ref, className: "week", "aria-label": model.label },
    h(
      "div",
      { className: "week-h" },
      h("button", { type: "button", className: "box-toggle week-toggle", "aria-expanded": true, "aria-controls": BOX_BODY_ID, onClick: toggle }, model.label, h("span", { "aria-hidden": true }, " ▴")),
    ),
    h(
      "div",
      { id: BOX_BODY_ID, className: "box-body" },
      day.week
        ? h(
            "section",
            { className: "box-sec", "aria-labelledby": "box-week-h" },
            h(SectionHead, { id: "box-week-h", title: `${BOX_LABEL.week} ${day.week.total}`, more: h(WeekAllLink, { Link }) }),
            h(WeekRows, { week: day.week, today, refYear, Link }),
          )
        : null,
      model.chips.length > 0
        ? h(
            "section",
            { className: "box-sec", "aria-labelledby": "box-ind-h" },
            h(SectionHead, { id: "box-ind-h", title: BOX_LABEL.indicators, more: h(Link, { to: indicatorsPath(), className: "text-link" }, "지표 전체", MoreMark()) }),
            h(
              "ul",
              { className: "ichips" },
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
                    h(ChangeText, { label: changeLabel({ change: c.kind, decimals: c.decimals }, c.value, c.change) }),
                    note ? h("small", null, `${note} 값`) : null,
                  ),
                );
              }),
            ),
          )
        : null,
    ),
  );
}
