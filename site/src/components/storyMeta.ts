// 펼친 뉴스 카드 끝의 '관련'·'출처' 두 줄(2026-11-27 reading-terms R5). 앱의 카드와 정적 HTML이 같은 부품을 쓴다.
// 테스트가 react-dom/server로 그려 보도록 JSX와 화면 이동기를 쓰지 않는다: 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, type ReactNode } from "react";
import { entityPath, issuePath, termPath } from "../lib/routes.ts";
import type { IssueRef, StoryDetail } from "../lib/types.ts";
import { StorySources } from "./sourceView.ts";
import type { LinkLike } from "./termView.ts";

/** 문단 첫머리의 굵은 머리말과 이어지는 글(R1: 소제목 줄 대신). 머리말도 문단의 일부로 읽힌다 */
export function LeadPara({ label, children }: { label: string; children?: ReactNode }) {
  return h("p", { className: "para" }, h("b", { className: "lead-in" }, label), children ? [" ", children] : null);
}

/**
 * '관련' 줄: 이슈(넘긴 때만), 함께 엮인 이슈, 인물·기관·국가(인물은 한 줄 설명을 작게), 용어 순의 알약 링크.
 * 앱은 지난 흐름 상자가 있으면 그 머리가 이슈 링크라 issue를 넘기지 않는다(R4).
 * '출처' 줄: 출처 칩. 확인 정도는 쓰지 않는다(R5, 출처가 몇 곳인지는 칩 수로 보인다).
 */
export function StoryMeta({ issue, detail, year, Link }: { issue: IssueRef | null; detail: StoryDetail; year: string; Link: LinkLike }) {
  const entities = detail.entities ?? [];
  const terms = detail.terms ?? [];
  const related = [
    ...(issue ? [h(Link, { key: `i${issue.id}`, to: issuePath(issue.id) }, issue.name)] : []),
    ...detail.extras.map((x) => h(Link, { key: `x${x.id}`, to: issuePath(x.id) }, x.name)),
    ...entities.map((e) => h(Link, { key: `e${e.id}`, to: entityPath(e.id) }, e.name, e.kind === "인물" && e.description ? h("small", null, e.description) : null)),
    ...terms.map((t) => h(Link, { key: `t${t.id}`, to: termPath(t.id) }, t.name)),
  ];
  return h(
    "div",
    { className: "meta" },
    related.length ? h("div", { className: "mrow" }, h("span", { className: "mrow-h" }, "관련"), h("div", { className: "rel" }, ...related)) : null,
    detail.sources.length ? h("div", { className: "mrow" }, h("span", { className: "mrow-h" }, "출처"), h(StorySources, { sources: detail.sources, year })) : null,
  );
}
