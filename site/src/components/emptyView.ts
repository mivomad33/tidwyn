// 빈 상태(`docs/design.md`의 '빈 상태, 오류, 로딩', U1 4.2-7). 앱과 정적 HTML이 같은 부품을 쓴다.
// 기본은 가운데 정렬의 `.state`이고, 목록·묶음 안(빌더·수요 묶음, 달력의 날, 타임라인)은 왼쪽 정렬 변형 하나(inline)를 쓴다.
import { createElement as h, type ReactNode } from "react";

export const EMPTY_CLASS = "state empty";

export function Empty({ children, inline = false }: { children?: ReactNode; inline?: boolean }) {
  return h("p", { className: inline ? `${EMPTY_CLASS} inline` : EMPTY_CLASS }, children);
}
