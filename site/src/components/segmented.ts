// 둘~셋 중 하나를 고르는 공통 고르기 부품 Segmented(U1 4.2-4, docs/design.md "고르기 부품"). 직접 구현한다(S7).
// 테두리 묶음 안의 버튼들이고, 고른 것은 상자 바탕 + 700 글자색(.segmented button.on). 검은 면은 거르기 칩에만 쓴다.
// 두 가지로 쓴다:
// - 보기·기간 고르기(일정 '목록|달력', '다가오는 일정|지난 일정', 지표 기간): role=group + aria-pressed.
// - 탭(브리프 위 상자 '이번 주 일정|지표'): tabs를 넘기면 role=tablist·tab + aria-selected·aria-controls, 고른 탭만 Tab으로 가고 화살표·Home·End로 옮긴다.
// 상태는 부르는 쪽이 갖는다. 테스트가 react-dom/server로 그려 보도록 JSX를 쓰지 않는다.
import { createElement as h, type KeyboardEvent, type ReactNode } from "react";
import { focusById } from "../lib/dom.ts";

export const SEGMENTED_CLASS = "segmented";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 묶음의 이름(보조 기술) */
  label: string;
  /** 자리마다 배치(여백·폭)만 더하는 클래스. 모양은 바꾸지 않는다 */
  className?: string;
  /** 탭으로 쓸 때: 버튼 id와 탭 패널 id */
  tabs?: { idOf: (value: T) => string; panelId: string };
}

export function Segmented<T extends string>({ options, value, onChange, label, className, tabs }: SegmentedProps<T>) {
  const cls = className ? `${SEGMENTED_CLASS} ${className}` : SEGMENTED_CLASS;

  function onKey(e: KeyboardEvent) {
    if (!tabs) return;
    const values = options.map((o) => o.value);
    const i = values.indexOf(value);
    let next: T | null = null;
    if (e.key === "ArrowRight") next = values[(i + 1) % values.length]!;
    else if (e.key === "ArrowLeft") next = values[(i - 1 + values.length) % values.length]!;
    else if (e.key === "Home") next = values[0]!;
    else if (e.key === "End") next = values.at(-1)!;
    if (next === null) return;
    e.preventDefault();
    onChange(next);
    focusById(tabs.idOf(next));
  }

  const button = (o: SegmentedOption<T>) => {
    const on = o.value === value;
    const common = { key: o.value, type: "button" as const };
    const attrs = tabs
      ? { ...common, role: "tab", id: tabs.idOf(o.value), className: on ? "on" : undefined, "aria-selected": on, "aria-controls": tabs.panelId, tabIndex: on ? 0 : -1 }
      : { ...common, className: on ? "on" : undefined, "aria-pressed": on };
    return h("button", { ...attrs, onClick: () => onChange(o.value) }, o.label);
  };

  return tabs
    ? h("div", { role: "tablist", className: cls, "aria-label": label, onKeyDown: onKey }, ...options.map(button))
    : h("div", { role: "group", className: cls, "aria-label": label }, ...options.map(button));
}
