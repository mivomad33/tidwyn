// 펼친 뉴스의 출처 칩(원문 링크, 새 탭). 앱의 카드와 정적 HTML이 같은 부품을 쓴다(U1 4.2-8: 끝에 ↗).
import { createElement as h } from "react";
import { orderSources } from "../lib/brief.ts";
import { shortDate } from "../lib/format.ts";
import type { StoryDetail } from "../lib/types.ts";
import { NewTabMark } from "./moreMark.ts";

/** 출처 칩 줄. 대표 출처가 앞이고, 칩마다 매체 이름, 발행일(추정이면 '추정'), ↗ */
export function StorySources({ sources, year }: { sources: StoryDetail["sources"]; year: string }) {
  return h(
    "div",
    { className: "src" },
    ...orderSources(sources).map((s, i) => h("a", { key: `${s.url}-${i}`, href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name, h("small", null, ` · ${shortDate(s.publishedAt, year)}${s.publishedAtEstimated ? " 추정" : ""}`), h(NewTabMark))),
  );
}
