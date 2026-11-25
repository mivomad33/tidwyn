// B1 빌더 탭의 저장소 목록(4.4-2). 앱의 빌더 탭과 정적 HTML의 빌더 구역이 같은 부품을 쓴다.
// 굵은 제목 'GitHub 주간 트렌딩', 순위 순 항목(저장소 아이콘 · 파란 이름 링크 · 그 끝의 둥근 순위 배지 · 늘 보이는 설명, G15), 또는 상태별 빈 상태 문구.
import { createElement as h, Fragment } from "react";
import type { DayRepoItem, DayRepos } from "../lib/types.ts";
import { Empty } from "./emptyView.ts";

/** 목록 머리 제목(사용자 지적 2026-11-25: 안내 문장 대신 굵은 제목) */
export const REPO_HEADING = "GitHub 주간 트렌딩";
/** '새로 오른 것 없음'(모두 이미 실렸거나 걸러 실을 것이 없는 날도 같다) */
export const REPO_NONE_TEXT = "이 날에는 새로 실을 저장소가 없습니다.";
/** '받지 못함' */
export const REPO_FAILED_TEXT = "이 날에는 GitHub 주간 트렌딩 목록을 받지 못했습니다.";

export function repoRankText(rank: number): string {
  return `주간 ${rank}위`;
}

/** 'owner / name'을 GitHub 트렌딩처럼 소유자는 보통 굵기, 이름은 굵게 나눈다 */
function repoNameParts(name: string) {
  const at = name.indexOf("/");
  if (at < 0) return [h("span", { key: "n", className: "repo-n" }, name)];
  return [h("span", { key: "o", className: "repo-o" }, `${name.slice(0, at)} / `), h("span", { key: "n", className: "repo-n" }, name.slice(at + 1))];
}

/** 저장소 표시 아이콘(책 모양, 직접 그림). 머리글 아이콘과 같은 선 굵기·끝 모양이다. 글자 옆 장식이라 화면 읽기에서 숨긴다 */
function RepoIcon() {
  return h(
    "svg",
    { className: "repo-icon", width: 16, height: 16, viewBox: "0 0 24 24", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" },
    h("path", { d: "M5 19V5a2 2 0 0 1 2-2h12v14H7a2 2 0 0 0-2 2 2 2 0 0 0 2 2h3" }),
    h("path", { d: "M14 18v4l1.5-1.2L17 22v-4" }),
    h("path", { d: "M19 17v4h-1" }),
  );
}

function RepoItem({ item, level }: { item: DayRepoItem; level: "h3" | "h4" }) {
  return h(
    "li",
    { className: "repo" },
    // 이름 앞에 저장소 아이콘, 순위는 이름 끝의 둥근 작은 배지다. 새 탭 표시 ↗는 두지 않고 화면 읽기 글만 둔다(사용자 지적 2026-11-25)
    h(
      level,
      { className: "repo-name" },
      h(RepoIcon),
      // 아이콘은 왼쪽 칸에 두고 이름·배지는 오른쪽 칸에서 줄을 바꾼다(긴 이름에서 아이콘만 혼자 한 줄에 남지 않게)
      h(
        "span",
        { className: "repo-title" },
        h("a", { href: item.url, className: "repo-link", target: "_blank", rel: "noopener noreferrer" }, ...repoNameParts(item.name), h("span", { className: "sr-only" }, " (새 탭)")),
        " ",
        h("span", { className: "repo-rank" }, repoRankText(item.rank)),
      ),
    ),
    h("p", { className: "p repo-desc" }, item.description),
  );
}

/** 그날 저장소 기록. 항목은 순위 순으로 보인다 */
export function RepoList({ repos, headingLevel }: { repos: DayRepos; headingLevel: "h2" | "h3" }) {
  const items = [...repos.items].sort((a, b) => a.rank - b.rank);
  const body =
    repos.status === "failed"
      ? h(Empty, null, REPO_FAILED_TEXT)
      : repos.status === "none" || items.length === 0
        ? h(Empty, null, REPO_NONE_TEXT)
        : h("ol", { className: "list repos" }, items.map((item) => h(RepoItem, { key: item.name, item, level: headingLevel === "h2" ? "h3" : "h4" })));
  return h(Fragment, null, h(headingLevel, { className: "repo-head" }, REPO_HEADING), body);
}
