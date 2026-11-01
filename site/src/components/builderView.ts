// 빌더 항목(9.8단계 4.6, `docs/design.md`의 '빌더 항목'). 앱과 정적 HTML이 같은 문구와 순서를 쓴다.
// 읽음 버튼은 브라우저 기록을 보므로 앱이 넘기고, 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, Fragment, type ReactNode } from "react";
import { FixMark, FixNotes } from "./correctionView.ts";
import { ReportLink } from "./reportLink.ts";
import type { LinkLike } from "./termView.ts";
import { ExternalLink } from "./videoView.ts";
import { BUILDER_NONE, builderDueText, builderEndNotice, builderNotice, builderReminderText } from "../lib/builder.ts";
import { monthDay } from "../lib/format.ts";
import { SITE_URL, storyReportHref } from "../lib/policy.ts";
import { briefPath, issuePath, schedulePath } from "../lib/routes.ts";
import type { DayBuilder, SiteBuilderItem } from "../lib/types.ts";

function Field({ label, children }: { label: string; children?: ReactNode }) {
  return h(Fragment, null, h("h4", { className: "h" }, label), h("p", { className: "p" }, children));
}

/** 분야와 정정 표시. 뉴스의 대분류 줄과 같은 자리다 */
export function BuilderFieldLine({ item }: { item: SiteBuilderItem }) {
  const line = h("div", { className: "cat muted-cat" }, item.field);
  return item.corrections ? h("span", { className: "cat-row" }, line, h(FixMark, { fixes: item.corrections })) : line;
}

/** 탭 머리의 한 줄 안내. 뜻은 소개의 빌더 절로 잇는다 */
export function BuilderIntro({ Link }: { Link: LinkLike }) {
  return h("p", { className: "flow note" }, "도구, 모델, 보안, 플랫폼의 바뀐 점을 모았다. ", h(Link, { to: "/about#builder", className: "bintro-l" }, "빌더 탭 소개"));
}

/** 항목이 없는 날의 상태 문구. 다 확인하지 못한 날은 확인하고 없는 날과 달리 글자색으로 보인다 */
export function BuilderZero({ status }: { status: DayBuilder["status"] }) {
  const notice = builderNotice(status);
  return notice ? h("div", { className: "state error" }, h("p", null, notice)) : h("p", { className: "state empty" }, BUILDER_NONE);
}

/** 다시 알림 표시. 누르면 원래 항목으로 간다. 아니면 그리지 않는다 */
export function BuilderReminder({ item, Link }: { item: SiteBuilderItem; Link: LinkLike }) {
  const from = item.reminderOf;
  return from ? h(Link, { to: briefPath(from.date, from.key), className: "cont breminder" }, builderReminderText(from.date)) : null;
}

/** 기한: 확정이고 일정이 있으면 일정으로 가고, 없으면 글자만이다 */
function Due({ item, Link }: { item: SiteBuilderItem; Link: LinkLike }) {
  if (!item.due) return "없음";
  const text = builderDueText(item.due);
  return item.schedule === null ? text : h(Link, { to: schedulePath(item.schedule), className: "text-link bdue" }, text);
}

/** 칸을 정해진 순서로 그린다. 제목 줄은 부르는 쪽이 그린다 */
export function BuilderBody({ item, date, Link }: { item: SiteBuilderItem; date: string; Link: LinkLike }) {
  return h(
    Fragment,
    null,
    h(Field, { label: "무엇이 바뀌었나" }, item.whatChanged),
    h(FixNotes, { fixes: item.corrections, className: "fix" }),
    h(Field, { label: "누가 영향받나" }, item.who),
    h(Field, { label: "지금 할 일" }, item.action),
    h(Field, { label: "기한" }, h(Due, { item, Link })),
    h(Field, { label: "고른 이유" }, item.why),
    item.issue ? h(Fragment, null, h("h4", { className: "h" }, "관련 이슈"), h("div", { className: "rel brel" }, h(Link, { to: issuePath(item.issue.id) }, item.issue.name))) : null,
    h("h4", { className: "h" }, "출처"),
    h(
      "div",
      { className: "src" },
      item.sources.map((s) => h("a", { key: s.url, href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name, " ", h("span", { "aria-hidden": true }, "↗"), h("span", { className: "sr-only" }, " (새 탭)"))),
    ),
    h(ReportLink, { href: storyReportHref(monthDay(date), item.title, `${SITE_URL}${briefPath(date, item.key)}`), label: "틀린 내용 알리기" }),
  );
}

/** 목록 끝 안내: 다 확인하지 못한 날에 항목이 있을 때만 */
export function BuilderEndNote({ builder }: { builder: DayBuilder }) {
  const text = builderEndNotice(builder.status);
  return text && builder.count > 0 ? h("p", { className: "flow note" }, text) : null;
}

/** 사이트 소개의 '빌더 탭' 절(4.6-7) */
export function AboutBuilder() {
  const P = (...children: ReactNode[]) => h("p", { className: "p" }, ...children);
  const src = (href: string, label: string) => h(ExternalLink, { href, label });
  return h(
    "section",
    { id: "builder" },
    h("h2", { className: "h" }, "빌더 탭"),
    P("빌더 탭은 코딩 도구, 모델, 보안, 프레임워크, 플랫폼의 변화를 모은다. 공식 릴리스와 변경 기록, 공식 문서, 공개 보안 공지에서 후보를 기계로 거르고, 그중 알아야 할 것을 AI가 고른다."),
    P("글은 AI가 쓴 것이라 틀리거나 빠질 수 있다. 항목마다 공식 출처 링크가 있으니 기한과 할 일은 출처에서 확인해 주세요. 건수를 채우지 않아 하루 0~4건이고, 다 확인했는데 실을 것이 없는 날은 없다고 쓴다."),
    P("기한의 확정은 공식 문서에 날짜가 정해진 것이고, 잠정은 아직 바뀔 수 있는 날짜다. 확정 기한은 7일 전에 한 번 다시 싣는다. 출처를 다 받지 못한 날은 그날 탭에 그렇게 적는다."),
    P(
      "출처 표기: ",
      src("https://github.com/advisories", "GitHub Advisory Database"),
      ", ",
      src("https://ai.google.dev/gemini-api/docs", "Gemini API 문서"),
      ", ",
      src("https://react.dev/", "React"),
      ", ",
      src("https://nodejs.org/", "Node.js"),
      ", ",
      src("https://developers.cloudflare.com/", "Cloudflare 문서"),
      "의 내용은 ",
      src("https://creativecommons.org/licenses/by/4.0/", "CC BY 4.0"),
      "에 따라 바꿔 썼다.",
    ),
    P("악용이 확인된 취약점 자료는 미국 CISA의 ", src("https://www.cisa.gov/known-exploited-vulnerabilities-catalog", "Known Exploited Vulnerabilities Catalog"), "에서 왔다. CISA가 이 사이트나 글을 보증하는 것은 아니다."),
  );
}
