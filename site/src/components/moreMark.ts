import { createElement as h, Fragment } from "react";

// 끝 표시는 클래스 mark로 공백을 지킨다(styles.css: 줄을 넓히려고 inline-flex로 둔 링크 안에서도 ' ›'·'‹ ' 공백이 사라지지 않게)

/** 다른 페이지로 간다는 끝 표시. 보조 기술에는 숨긴다 */
export function MoreMark() {
  return h("span", { className: "mark", "aria-hidden": true }, " ›");
}

/** 되돌아가기 링크 앞 표시 '‹ '. 보조 기술에는 숨긴다 */
export function BackMark() {
  return h("span", { className: "mark", "aria-hidden": true }, "‹ ");
}

/** 새 탭으로 여는 앱 밖 링크의 끝 표시(U1 4.2-8). 눈에는 ↗, 보조 기술에는 "(새 탭)"으로 알린다. 링크의 aria-label이 이미 "(새 탭)"을 말하면 spoken: false */
export function NewTabMark({ spoken = true }: { spoken?: boolean }) {
  const arrow = h("span", { className: "mark", "aria-hidden": true }, " ↗");
  return spoken ? h(Fragment, null, arrow, h("span", { className: "sr-only" }, " (새 탭)")) : arrow;
}
