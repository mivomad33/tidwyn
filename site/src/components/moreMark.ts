import { createElement as h } from "react";

/** 다른 페이지로 간다는 끝 표시. 보조 기술에는 숨긴다 */
export function MoreMark() {
  return h("span", { "aria-hidden": true }, " ›");
}
