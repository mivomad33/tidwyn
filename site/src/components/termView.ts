// 펼친 카드의 용어 밑줄·칩·설명 상자와 대상 칩(E8, 4.7-1·4.7-2·4.7-7).
// 상태는 부르는 쪽(카드)이 갖고, 여기는 그리기만 한다. 테스트가 react-dom/server로 그려 보도록
// JSX와 화면 이동기(router.tsx)를 쓰지 않는다: 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, Fragment, type ComponentType, type ReactNode } from "react";
import { issueEntityChips } from "../lib/entities.ts";
import { entityPath, termPath } from "../lib/routes.ts";
import type { Segment } from "../lib/terms.ts";
import type { EntityRef, IssueEntity, TermRef } from "../lib/types.ts";

export interface LinkLikeProps {
  to: string;
  className?: string;
  children?: ReactNode;
}
export type LinkLike = ComponentType<LinkLikeProps>;

interface ToggleProps {
  openId: number | null;
  onToggle: (id: number) => void;
  /** 설명 상자의 id(aria-controls) */
  boxId: string;
}

/** 문단 글. 밑줄 낱말은 단추이고, 열린 용어면 강조한다 */
export function TermText({ segments, openId, onToggle, boxId }: ToggleProps & { segments: Segment[] }) {
  return h(
    Fragment,
    null,
    ...segments.map((s, i) => {
      if (s.termId === undefined) return h(Fragment, { key: i }, s.text);
      const id = s.termId;
      const open = openId === id;
      return h(
        "button",
        { key: i, type: "button", className: open ? "term open" : "term", "aria-expanded": open, "aria-controls": open ? boxId : undefined, onClick: () => onToggle(id) },
        s.text,
      );
    }),
  );
}

/** "용어" 칩 줄. 그 뉴스의 모든 용어(본문 표기가 없는 것 포함). 용어가 없으면 그리지 않는다 */
export function TermChips({ terms, openId, onToggle, boxId }: ToggleProps & { terms: TermRef[] }) {
  if (!terms.length) return null;
  return h(
    "div",
    { className: "rel", role: "group", "aria-label": "용어" },
    ...terms.map((t) => {
      const open = openId === t.id;
      return h(
        "button",
        { key: t.id, type: "button", className: open ? "on" : undefined, "aria-expanded": open, "aria-controls": open ? boxId : undefined, onClick: () => onToggle(t.id) },
        t.name,
      );
    }),
  );
}

/** 용어 설명 상자: 이름, 설명, 용어 사전 링크 */
export function TermBox({ term, id, Link }: { term: TermRef; id: string; Link: LinkLike }) {
  return h(
    "div",
    { id, className: "tbox", role: "region", "aria-label": `${term.name} 설명` },
    h("b", null, term.name),
    term.description,
    h(Link, { to: termPath(term.id) }, "용어 사전에서 보기 ", h("span", { "aria-hidden": true }, "›")),
  );
}

/** "인물·기관·국가" 칩 줄. 인물은 한 줄 설명을 작게 붙인다. 누르면 그 대상 페이지 */
export function EntityChips({ entities, Link }: { entities: EntityRef[]; Link: LinkLike }) {
  if (!entities.length) return null;
  return h(
    "div",
    { className: "rel" },
    ...entities.map((e) => h(Link, { key: e.id, to: entityPath(e.id) }, e.name, e.kind === "인물" && e.description ? h("small", null, e.description) : null)),
  );
}

/** 이슈 페이지의 "등장 인물·기관·국가" 칩: 이름과 횟수, 횟수 순 최대 10개 */
export function IssueEntityChips({ entities, Link }: { entities: IssueEntity[] | undefined; Link: LinkLike }) {
  const list = issueEntityChips(entities);
  if (!list.length) return null;
  return h(
    "div",
    { className: "rel" },
    ...list.map((e) => h(Link, { key: e.id, to: entityPath(e.id) }, e.name, h("small", null, String(e.count), h("span", { className: "sr-only" }, "회")))),
  );
}
