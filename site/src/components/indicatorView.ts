// 6단계 지표 화면의 그리기(4.7, 확정 시안 design/site.html): 변화 글자, 작은 그래프, 큰 그래프(누르기·끌기·키보드로 값 보기),
// 지표 카드, 출처 표시와 FRED 고지. 테스트가 react-dom/server로 그려 보도록 termView.ts처럼 JSX와 화면 이동기(router.tsx)를 쓰지 않는다:
// 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  FRED_NOTICE,
  FRED_TERMS_LABEL,
  FRED_TERMS_URL,
  axisDateText,
  changeLabel,
  changePrefix,
  chartGeometry,
  chartSummary,
  creditsOf,
  fmtNumber,
  formatValue,
  longDateText,
  moveIndex,
  nearestIndex,
  readingValueText,
  type ChangeLabel,
  type ChartBox,
} from "../lib/indicators.ts";
import { capturePointer, observeWidth, rectOf } from "../lib/dom.ts";
import { indicatorPath } from "../lib/routes.ts";
import type { IndicatorCard, IndicatorMetaInfo, IndicatorPoint } from "../lib/types.ts";
import type { LinkLike } from "./termView.ts";

/** 변화 글자(오름 빨강·내림 파랑·변동 없음 흐린 색). 화살표는 보조 기술에 "올라·내려"로 읽힌다 */
export function ChangeText({ label, prefix = "" }: { label: ChangeLabel | null; prefix?: string }) {
  if (!label) return null;
  return h(
    "span",
    { className: `chg ${label.dir}` },
    prefix ? h("span", { className: "chg-p" }, prefix) : null,
    h("span", { "aria-hidden": true }, label.text),
    h("span", { className: "sr-only" }, label.spoken),
  );
}

const SPARK_W = 150;
const SPARK_H = 34;

/** 카드의 1년 작은 그래프(그림일 뿐이라 보조 기술에서는 숨긴다. 카드 글자가 값을 알린다) */
export function Sparkline({ points }: { points: IndicatorPoint[] }) {
  const g = chartGeometry(points, { width: SPARK_W, height: SPARK_H, padX: 1, padTop: 3, padBottom: 3 });
  return h(
    "svg",
    { className: "spark", viewBox: `0 0 ${SPARK_W} ${SPARK_H}`, preserveAspectRatio: "none", "aria-hidden": true, focusable: "false" },
    g.path ? h("path", { d: g.path, fill: "none", stroke: "var(--plot)", strokeWidth: 1.3, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }) : null,
  );
}

/** 지표 페이지의 카드 하나: 이름, 마지막 값, 전날(월별은 전달) 대비, 1년 작은 그래프. 누르면 지표 하나의 페이지 */
export function IndicatorCardView({ card, Link }: { card: IndicatorCard; Link: LinkLike }) {
  const last = card.last!;
  return h(
    "li",
    null,
    h(
      Link,
      { to: indicatorPath(card.id), className: "icard" },
      h("span", { className: "n" }, card.name),
      h("b", { className: "v" }, readingValueText(card, last)),
      h("span", { className: "c" }, h(ChangeText, { label: changeLabel(card, last.value, last.change, false), prefix: changePrefix(card) })),
      h(Sparkline, { points: card.spark }),
    ),
  );
}

/** 출처 표시(4.7-6): 보이는 지표의 출처 문구. 여러 출처면 줄마다 그 출처의 지표 이름을 붙인다 */
export function SourceNote({ metas }: { metas: { name: string; credit: string }[] }) {
  const credits = creditsOf(metas);
  if (!credits.length) return null;
  if (credits.length === 1) return h("p", { className: "isrc" }, credits[0]!.credit);
  return h("ul", { className: "isrc" }, ...credits.map((c) => h("li", { key: c.credit }, `${c.credit}: ${c.names.join(", ")}`)));
}

/** FRED API 이용 약관이 요구하는 고지와 약관 링크(사이트 소개와 지표 페이지 바닥) */
export function FredNotice() {
  return h(
    "p",
    { className: "isrc fred", lang: "en" },
    FRED_NOTICE,
    " ",
    h("a", { href: FRED_TERMS_URL, className: "text-link", target: "_blank", rel: "noopener noreferrer", lang: "ko" }, FRED_TERMS_LABEL, h("span", { className: "sr-only" }, " (새 탭)")),
  );
}

export interface ChartProps {
  meta: Pick<IndicatorMetaInfo, "name" | "unit" | "decimals">;
  points: IndicatorPoint[];
  height: number;
  /** 가로 눈금선과 그 값 */
  grid?: boolean;
  /** 강조색 점을 찍을 값의 위치(이슈 뉴스가 있는 날) */
  dots?: number[];
}

/** 그래프의 그리기 영역 크기. 서버에서 그릴 때(테스트)와 너비를 재기 전의 너비 */
export const CHART_FALLBACK_WIDTH = 340;

function useWidth(fallback: number) {
  const ref = useRef(null);
  const [width, setWidth] = useState(fallback);
  useEffect(
    () =>
      observeWidth(ref.current, (w) => {
        if (w > 0) setWidth(w);
      }),
    [],
  );
  return { ref, width };
}

/**
 * 선 그래프(4.7-3·4.7-4). 처음·끝 날짜 축, 가로 눈금선(grid), 그래프 위를 누르거나 끌면(마우스는 올리면) 그 날짜와 값이 위 줄에 보인다.
 * 키보드: 그래프에 초점을 두고 ←→(하루), PageUp·PageDown(10분의 1), Home·End, Esc(지우기). 보조 기술용 요약(기간, 처음·마지막, 최고·최저)이 있다.
 */
export function LineChart({ meta, points, height, grid = false, dots = [] }: ChartProps) {
  const { ref, width } = useWidth(CHART_FALLBACK_WIDTH);
  const [sel, setSel] = useState<number | null>(null);
  const pinned = useRef(false);
  const summaryId = useId();
  const n = points.length;
  // 기간이 바뀌어 값 수가 바뀌면 고른 값을 지운다
  useEffect(() => {
    setSel(null);
    pinned.current = false;
  }, [points]);
  const box: ChartBox = { width, height, padX: 4, padTop: grid ? 14 : 8, padBottom: 18 };
  const g = chartGeometry(points, box);
  const summary = chartSummary(meta, points);
  const cur = sel !== null && sel < n ? sel : null;
  const pointText = (i: number) => `${longDateText(points[i]![0])} ${formatValue(meta, points[i]![1])}`;
  const readout = cur !== null ? pointText(cur) : "그래프를 누르거나 끌면 그날 값이 보인다.";

  function pick(e: PointerEvent) {
    const rect = rectOf(e.currentTarget);
    if (rect.width === 0) return;
    setSel(nearestIndex(((e.clientX - rect.left) * width) / rect.width, n, box));
  }
  function onDown(e: PointerEvent) {
    if (!n) return;
    pinned.current = true;
    if (e.pointerType !== "mouse") capturePointer(e.currentTarget, e.pointerId);
    pick(e);
  }
  function onMove(e: PointerEvent) {
    if (!n) return;
    if (e.pointerType === "mouse" || e.buttons > 0) pick(e);
  }
  function onLeave(e: PointerEvent) {
    if (e.pointerType === "mouse" && !pinned.current) setSel(null);
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") {
      setSel(null);
      pinned.current = false;
      return;
    }
    const next = moveIndex(cur, e.key, n);
    if (next === cur && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) return;
    e.preventDefault();
    pinned.current = true;
    setSel(next);
  }

  const parts = [];
  if (grid) {
    // 값 폭이 좁아 눈금 글자가 위 눈금과 같아지면(예: 값이 하나뿐) 같은 숫자를 되풀이하지 않는다
    let prevLabel = "";
    for (const [k, line] of g.grid.entries()) {
      parts.push(h("line", { key: `g${k}`, x1: 0, x2: width, y1: line.y, y2: line.y, stroke: "var(--line)", strokeWidth: 1 }));
      const label = fmtNumber(line.value, meta.decimals);
      if (label !== prevLabel) parts.push(h("text", { key: `t${k}`, x: width - 2, y: line.y - 3, textAnchor: "end", className: "ax" }, label));
      prevLabel = label;
    }
  }
  if (g.path) parts.push(h("path", { key: "line", d: g.path, fill: "none", stroke: "var(--plot)", strokeWidth: 1.5, strokeLinejoin: "round" }));
  if (n === 1) parts.push(h("circle", { key: "one", cx: g.xs[0], cy: g.ys[0], r: 3, fill: "var(--plot)" }));
  for (const i of dots) if (i < n) parts.push(h("circle", { key: `d${i}`, className: "dot", cx: g.xs[i], cy: g.ys[i], r: 3.5, fill: "var(--accent)" }));
  if (cur !== null) {
    parts.push(h("line", { key: "sel-l", x1: g.xs[cur], x2: g.xs[cur], y1: box.padTop - 6, y2: height - box.padBottom, stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" }));
    parts.push(h("circle", { key: "sel-c", cx: g.xs[cur], cy: g.ys[cur], r: 4.5, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 }));
  }
  if (n > 0) {
    parts.push(h("text", { key: "a0", x: box.padX, y: height - 4, className: "ax" }, axisDateText(points[0]![0])));
    if (n > 1) parts.push(h("text", { key: "a1", x: width - box.padX, y: height - 4, textAnchor: "end", className: "ax" }, axisDateText(points[n - 1]![0])));
  }

  return h(
    "div",
    { className: "chart", ref },
    h("p", { className: cur !== null ? "chart-read on" : "chart-read", "aria-hidden": true }, readout),
    h(
      "div",
      {
        className: "chart-plot",
        role: "slider",
        tabIndex: n ? 0 : -1,
        "aria-label": `${meta.name} 그래프, 날짜 고르기`,
        "aria-valuemin": 0,
        "aria-valuemax": Math.max(0, n - 1),
        "aria-valuenow": n ? (cur ?? n - 1) : 0,
        "aria-valuetext": n ? pointText(cur ?? n - 1) : "값 없음",
        "aria-describedby": summaryId,
        onPointerDown: onDown,
        onPointerMove: onMove,
        onPointerLeave: onLeave,
        onKeyDown: onKey,
        onBlur: () => {
          pinned.current = false;
        },
      },
      h("svg", { width, height, viewBox: `0 0 ${width} ${height}`, "aria-hidden": true, focusable: "false" }, ...parts),
    ),
    h("p", { id: summaryId, className: "sr-only" }, summary),
  );
}

