// 없는 페이지 본문(`docs/design.md`). 앱과 정적 404가 같이 쓴다. 정적 404에는 요청 주소가 없다(앱이 그릴 때 보인다, 4.3-3). 정적 화면에서는 검색을 쓸 수 없어 날짜 목록으로 안내한다.
import { createElement as h } from "react";
import { searchPath } from "../lib/routes.ts";
import type { LinkLike } from "./termView.ts";

export const NOT_FOUND_LABEL = "없는 페이지";

export function NotFoundView({ Link, requested, noSearch = false }: { Link: LinkLike; requested?: string; noSearch?: boolean }) {
  return h(
    "div",
    { className: "plain nf" },
    h("h1", { className: "page-title" }, "이 주소에는 페이지가 없다"),
    h("p", { className: "p" }, `주소가 바뀌었거나 잘못 입력했을 수 있다. 지난 뉴스는 ${noSearch ? "날짜 목록" : "검색"}에서 찾을 수 있다.`),
    requested ? h("p", { className: "req" }, "404 · 요청한 주소 ", h("span", null, requested)) : null,
    h(
      "div",
      { className: "nf-act" },
      h(Link, { to: "/", className: "btn" }, "최근 뉴스 브리프 보기"),
      h("div", { className: "more" }, h(Link, { to: "/issues", className: "quiet" }, "이슈 목록"), noSearch ? h(Link, { to: "/dates", className: "quiet" }, "날짜 목록") : h(Link, { to: searchPath(""), className: "quiet" }, "검색")),
    ),
  );
}
