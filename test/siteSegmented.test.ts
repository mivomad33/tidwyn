import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SEGMENTED_CLASS, Segmented, type SegmentedProps } from "../site/src/components/segmented.ts";

// U1 4.2-4 고르기 부품: 일정 '목록|달력', '다가오는 일정|지난 일정', 지표 기간, 브리프 위 상자 탭이 공통 Segmented 하나를 쓴다. 지어낸 값만 쓴다.

const ROOT = path.join(import.meta.dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** 주석을 뺀 코드(주석 속 설명 글이 검사에 걸리지 않게) */
const code = (rel: string) =>
  read(rel)
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");

/** CSS 규칙 하나의 본문(선택자가 정확히 같은 규칙) */
function cssRule(css: string, selector: string): string | null {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`);
  return css.match(re)?.[1] ?? null;
}

type Pick3 = "a" | "b" | "c";
const options = [
  { value: "a", label: "가" },
  { value: "b", label: "나" },
  { value: "c", label: "다" },
] as const;

describe("U1 4.2-4 고르기 부품 Segmented", () => {
  test("네 곳(일정 보기, 일정 구분, 지표 기간, 브리프 위 상자 탭)이 같은 공통 부품을 쓰고, 고르기 버튼 묶음을 따로 만들지 않는다", () => {
    const schedules = code("site/src/pages/SchedulesPage.tsx");
    const indicator = code("site/src/pages/IndicatorPage.tsx");
    const box = code("site/src/components/briefBox.ts");
    for (const [name, src] of [
      ["SchedulesPage", schedules],
      ["IndicatorPage", indicator],
      ["briefBox", box],
    ] as const) assert.match(src, /import \{ Segmented \} from "(\.\.\/components|\.)\/segmented\.ts";/, `${name}가 공통 부품을 가져온다`);
    for (const [name, src] of [
      ["IndicatorPage", indicator],
      ["briefBox", box],
    ] as const) assert.doesNotMatch(src, /aria-pressed|role: "tablist"|role="tablist"|role: "tab"|role="group"/, `${name}가 고르기 버튼을 직접 만들지 않는다`);
    // 일정 화면의 aria-pressed·role=group은 달력의 날짜 고르기(button.d, 구분이 아님)뿐이다
    assert.equal(schedules.match(/aria-pressed/g)?.length, 1, "일정 화면의 aria-pressed는 달력 날짜 하나");
    assert.equal(schedules.match(/role="group"/g)?.length, 1, "일정 화면의 role=group은 달력 하나");
    assert.match(schedules, /<div ref=\{gridRef\} className="cal" role="group"/);
    assert.match(schedules, /<Segmented<ScheduleView> label="보기" className="view"/, "일정 '목록|달력'");
    assert.match(schedules, /<Segmented<ScheduleTab> label="일정 구분" className="seg"/, "'다가오는 일정|지난 일정'");
    assert.match(indicator, /<Segmented<Period> label="기간"/, "지표 기간");
    assert.match(box, /h\(Segmented<BoxTab>, \{[\s\S]*?tabs: \{ idOf: tabId, panelId: BOX_PANEL_ID \}/, "브리프 위 상자 탭(탭 역할)");
  });

  test("모양: 테두리 묶음, 고른 것 = 상자 바탕 + 700 글자색. 자리 클래스는 모양을 덮지 않고, 달력의 고른 날도 같은 표시다(검은 면 없음)", () => {
    const css = read("site/src/styles.css");
    const base = cssRule(css, `.${SEGMENTED_CLASS}`)!;
    assert.match(base, /border: 1px solid var\(--line\);/);
    const on = cssRule(css, `.${SEGMENTED_CLASS} button.on`)!;
    assert.match(on, /background: var\(--segmented-on, var\(--chip\)\);/);
    assert.match(on, /color: var\(--fg\);/);
    assert.match(on, /font-weight: 700;/);
    for (const place of [".view", ".seg", ".box-tabs", ".ind-seg"]) {
      assert.equal(cssRule(css, `${place} button.on`), null, `${place}가 고른 모양을 따로 두지 않는다`);
      for (const prop of ["border", "background", "color", "font-weight", "border-radius"]) assert.doesNotMatch(cssRule(css, place) ?? "", new RegExp(`(^|\\s)${prop}:`), `${place}는 배치만 더한다(${prop})`);
    }
    const sel = cssRule(css, ".cal .d.sel")!;
    assert.match(sel, /background: var\(--chip\);/);
    assert.match(sel, /color: var\(--fg\);/);
    assert.match(sel, /font-weight: 700;/);
    assert.doesNotMatch(sel, /var\(--fg\);[\s\S]*background|background: var\(--fg\)/, "검은 면을 쓰지 않는다");
    // 바탕이 상자 바탕인 브리프 위 상자 안에서는 상자 바탕과 다른 바탕으로 구별한다
    assert.match(cssRule(css, ".week")!, /--segmented-on: var\(--bg\);/);
  });

  test("보기 고르기: role=group과 aria-pressed, 고른 것에 on", () => {
    const html = renderToStaticMarkup(h(Segmented<Pick3>, { options, value: "b", onChange: () => {}, label: "가짜 보기", className: "view" }));
    assert.equal(
      html,
      '<div role="group" class="segmented view" aria-label="가짜 보기"><button type="button" aria-pressed="false">가</button><button type="button" class="on" aria-pressed="true">나</button><button type="button" aria-pressed="false">다</button></div>',
    );
  });

  test("탭: role=tablist·tab, 고른 탭만 Tab으로 가고 aria-controls로 패널을 가리킨다", () => {
    const html = renderToStaticMarkup(h(Segmented<Pick3>, { options, value: "a", onChange: () => {}, label: "가짜 탭", tabs: { idOf: (v) => `t-${v}`, panelId: "p" } }));
    assert.match(html, /^<div role="tablist" class="segmented" aria-label="가짜 탭">/);
    assert.match(html, /<button type="button" role="tab" id="t-a" class="on" aria-selected="true" aria-controls="p" tabindex="0">가<\/button>/);
    assert.match(html, /<button type="button" role="tab" id="t-b" aria-selected="false" aria-controls="p" tabindex="-1">나<\/button>/);
  });

  test("탭의 키보드: ←→는 돌아가며 옮기고 Home·End는 처음·끝, 다른 키는 그대로", () => {
    const keyed = (value: Pick3, key: string) => {
      const picked: Pick3[] = [];
      let prevented = false;
      const props: SegmentedProps<Pick3> = { options, value, onChange: (v) => picked.push(v), label: "가짜 탭", tabs: { idOf: (v) => `t-${v}`, panelId: "p" } };
      const el = Segmented(props) as unknown as ReactElement<{ onKeyDown: (e: { key: string; preventDefault: () => void }) => void }>;
      el.props.onKeyDown({ key, preventDefault: () => (prevented = true) });
      return { picked, prevented };
    };
    assert.deepEqual(keyed("a", "ArrowRight"), { picked: ["b"], prevented: true });
    assert.deepEqual(keyed("c", "ArrowRight"), { picked: ["a"], prevented: true });
    assert.deepEqual(keyed("a", "ArrowLeft"), { picked: ["c"], prevented: true });
    assert.deepEqual(keyed("b", "Home"), { picked: ["a"], prevented: true });
    assert.deepEqual(keyed("a", "End"), { picked: ["c"], prevented: true });
    assert.deepEqual(keyed("a", "Enter"), { picked: [], prevented: false });
    const group = Segmented({ options, value: "a", onChange: () => {}, label: "가짜 보기" }) as unknown as ReactElement<Record<string, unknown>>;
    assert.equal(group.props.onKeyDown, undefined, "보기 고르기는 화살표를 가로채지 않는다");
  });
});
