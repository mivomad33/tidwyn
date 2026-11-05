// 빌더 항목(9.8단계 4.6, 9.9단계 4.5, `docs/design.md`의 '빌더 항목'). 앱과 정적 HTML이 같은 문구와 순서를 쓴다.
// 읽음 버튼은 브라우저 기록을 보므로 앱이 넘기고, 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, Fragment, type ReactNode } from "react";
import { FixMark, FixNotes } from "./correctionView.ts";
import { ReportLink } from "./reportLink.ts";
import type { LinkLike } from "./termView.ts";
import { ExternalLink } from "./videoView.ts";
import { BUILDER_GROUP_NAMES, BUILDER_NONE, builderDueText, builderEndNotice, builderGroups, builderNotice, builderReminderText, discoverEndNotice, discoverySourceName, discoverZeroText, repoStarsText, repoLicenseText, repoUpkeepText, type BuilderGroup } from "../lib/builder.ts";
import { monthDay } from "../lib/format.ts";
import { SITE_URL, storyReportHref } from "../lib/policy.ts";
import { briefPath, issuePath, schedulePath } from "../lib/routes.ts";
import type { BuilderItemSource } from "../../../src/builderTypes.ts";
import type { DayBuilder, IssueRef, SiteBuilderItem, SiteDiscoveryItem, StoryCorrection } from "../lib/types.ts";

/** 칸 하나: 펼친 뉴스의 머리말과 문단. 빌더와 수요 흐름 항목이 함께 쓴다 */
export function Field({ label, children }: { label: string; children?: ReactNode }) {
  return h(Fragment, null, h("h4", { className: "h" }, label), h("p", { className: "p" }, children));
}

/** 흐린 대분류 줄과 정정 표시. 뉴스의 대분류 줄과 같은 자리다. 빌더와 수요 흐름 항목이 함께 쓴다 */
export function MutedCatLine({ text, fixes }: { text: string; fixes: StoryCorrection[] | undefined }) {
  const line = h("div", { className: "cat muted-cat" }, text);
  return fixes ? h("span", { className: "cat-row" }, line, h(FixMark, { fixes })) : line;
}

/** 분야와 정정 표시 */
export function BuilderFieldLine({ item }: { item: SiteBuilderItem }) {
  return h(MutedCatLine, { text: item.field, fixes: item.corrections });
}

/** 탭 머리의 한 줄 안내. 뜻은 소개의 빌더 절로 잇는다 */
export function BuilderIntro({ Link }: { Link: LinkLike }) {
  return h("p", { className: "flow note" }, "코딩 도구, 모델, 보안, 플랫폼의 바뀐 점을 모았다. 새 제품과 뜨는 저장소는 실린 날에 함께 나온다. ", h(Link, { to: "/about#builder", className: "bintro-l" }, "빌더 탭 소개"));
}

/** 항목이 없는 날의 상태 문구. 다 확인하지 못한 날은 확인하고 없는 날과 달리 글자색으로 보인다. 수요 탭도 쓴다 */
export function zeroState(text: string, error: boolean) {
  return error ? h("div", { className: "state error" }, h("p", null, text)) : h("p", { className: "state empty" }, text);
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

/** 관련 이슈 칩(있을 때). 빌더와 수요 흐름 항목이 같다 */
export function IssueField({ issue, Link }: { issue: IssueRef | null; Link: LinkLike }) {
  return issue ? h(Fragment, null, h("h4", { className: "h" }, "관련 이슈"), h("div", { className: "rel brel" }, h(Link, { to: issuePath(issue.id) }, issue.name))) : null;
}

/** 칸 끝의 출처와 제보 링크. 빌더 세 종류와 수요 흐름 항목이 같다 */
export function SourcesAndReport({ sources, reportTitle, date, itemKey }: { sources: BuilderItemSource[]; reportTitle: string; date: string; itemKey: string }) {
  return h(
    Fragment,
    null,
    h("h4", { className: "h" }, "출처"),
    h(
      "div",
      { className: "src" },
      sources.map((s) => h("a", { key: s.url, href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name, " ", h("span", { "aria-hidden": true }, "↗"), h("span", { className: "sr-only" }, " (새 탭)"))),
    ),
    h(ReportLink, { href: storyReportHref(monthDay(date), reportTitle, `${SITE_URL}${briefPath(date, itemKey)}`), label: "틀린 내용 알리기" }),
  );
}

/** 칸 끝의 관련 이슈, 출처, 제보 링크. 세 종류가 같다 */
function ItemEnd({ issue, sources, reportTitle, date, itemKey, Link }: { issue: IssueRef | null; sources: BuilderItemSource[]; reportTitle: string; date: string; itemKey: string; Link: LinkLike }) {
  return h(Fragment, null, h(IssueField, { issue, Link }), h(SourcesAndReport, { sources, reportTitle, date, itemKey }));
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
    h(ItemEnd, { issue: item.issue, sources: item.sources, reportTitle: item.title, date, itemKey: item.key, Link }),
  );
}

/** 새 제품·뜨는 저장소의 정정 표시 자리. 정정이 없으면 그리지 않는다 */
export function DiscoveryMark({ item }: { item: SiteDiscoveryItem }) {
  return item.corrections ? h("span", { className: "cat-row bmark" }, h(FixMark, { fixes: item.corrections })) : null;
}

/** 항목 이름. 칸에서 가장 큰 글자라 누르면 출처로 간다 */
export function DiscoveryName({ item }: { item: SiteDiscoveryItem }) {
  return h("a", { className: "bname-l", href: item.url, target: "_blank", rel: "noopener noreferrer" }, item.name, h("span", { className: "sr-only" }, " (새 탭)"));
}

/** 새 제품·뜨는 저장소의 칸(N5). 저장소는 고른 이유 뒤에 사실 칸이 더해지고, 출처와 제보는 도구 변화처럼 끝에 둔다 */
export function DiscoveryBody({ item, date, Link }: { item: SiteDiscoveryItem; date: string; Link: LinkLike }) {
  const repo = item.repo;
  return h(
    Fragment,
    null,
    h(Field, { label: "용도" }, item.purpose),
    h(FixNotes, { fixes: item.corrections, className: "fix" }),
    h(Field, { label: "기존 도구와의 차이" }, item.difference),
    h(Field, { label: "고른 이유" }, item.reason),
    repo ? h(Fragment, null, h(Field, { label: "라이선스" }, repoLicenseText(repo)), h(Field, { label: "관리 상태" }, repoUpkeepText(repo)), h(Field, { label: "별 수와 증가량" }, repoStarsText(repo))) : null,
    h(ItemEnd, { issue: item.issue, sources: [{ name: discoverySourceName(item.kind), url: item.url }], reportTitle: item.name, date, itemKey: item.key, Link }),
  );
}

/** 목록 끝 안내: 다 확인하지 못한 날에 항목이 있을 때만 */
function GroupEndNote({ group }: { group: BuilderGroup }) {
  if (group.count === 0 || group.status === null) return null;
  const text = group.kind === "tools" ? builderEndNotice(group.status) : discoverEndNotice(group.kind, group.status);
  return text ? h("p", { className: "flow note" }, text) : null;
}

/** 묶음의 0건 문구 */
function GroupZero({ group }: { group: BuilderGroup }) {
  if (group.status === null) return null;
  if (group.kind === "tools") {
    const notice = builderNotice(group.status);
    return zeroState(notice ?? BUILDER_NONE, notice !== null);
  }
  const text = discoverZeroText(group.kind, group.status);
  return text === null ? null : zeroState(text, group.status === "failed");
}

/** 묶음을 정해진 순서로 그린다. 줄은 앱과 정적 HTML이 달라 부르는 쪽이 넘긴다 */
export function BuilderGroups({ builder, tools, discoveries, toolRow, discoveryRow }: { builder: DayBuilder; tools: SiteBuilderItem[]; discoveries: SiteDiscoveryItem[]; toolRow: (x: SiteBuilderItem) => ReactNode; discoveryRow: (x: SiteDiscoveryItem) => ReactNode }) {
  return builderGroups(builder).map((group) => {
    const rows = group.kind === "tools" ? tools.map(toolRow) : discoveries.filter((x) => x.kind === group.kind).map(discoveryRow);
    return h(
      "section",
      { key: group.kind, className: "bgroup" },
      h("h2", { className: "bgroup-h" }, BUILDER_GROUP_NAMES[group.kind]),
      rows.length > 0 ? h("ul", { className: "list blist" }, rows) : group.count === 0 ? h(GroupZero, { group }) : null,
      h(GroupEndNote, { group }),
    );
  });
}

/** 사이트 소개의 '빌더 탭' 절(4.6-7) */
export function AboutBuilder() {
  const P = (...children: ReactNode[]) => h("p", { className: "p" }, ...children);
  const src = (href: string, label: string) => h(ExternalLink, { href, label });
  return h(
    "section",
    { id: "builder" },
    h("h2", { className: "h" }, "빌더 탭"),
    P("빌더 탭은 코딩 도구, 모델, 보안, 프레임워크, 플랫폼의 변화와 새 제품, 뜨는 저장소를 모은다. 도구 변화는 공식 릴리스와 변경 기록, 공식 문서, 공개 보안 공지에서 후보를 기계로 거르고, 그중 알아야 할 것을 AI가 고른다."),
    P("글은 AI가 쓴 것이라 틀리거나 빠질 수 있다. 도구 변화에는 항목마다 공식 출처 링크가 있으니 기한과 할 일은 출처에서 확인해 주세요. 건수를 채우지 않아 하루 0~4건이고, 다 확인했는데 실을 것이 없는 날은 없다고 쓴다."),
    P("기한의 확정은 공식 문서에 날짜가 정해진 것이고, 잠정은 아직 바뀔 수 있는 날짜다. 확정 기한은 7일 전에 한 번 다시 싣는다. 출처를 다 받지 못한 날은 그날 탭에 그렇게 적는다."),
    P("새 제품은 Product Hunt에 소개된 제품 중에서 고른다. 뜨는 저장소는 별이 2,000개 이상이고 최근 7일 안에 코드가 올라온 GitHub 저장소의 별 수를 매일 재서, 하루 증가량이 큰 저장소 중에서 고른다. GitHub Trending과는 기준이 달라 목록이 같지 않다."),
    P("두 묶음의 글도 AI가 쓴 것이고 추천이나 보증이 아니다. 쓰기 전에 출처에서 직접 확인해 주세요. 라이선스와 관리 상태, 별 수는 받은 값 그대로다. 종류마다 하루 0~3건이고 건수를 채우지 않는다. 새 제품은 ", src("https://api.producthunt.com/v2/docs", "Product Hunt API"), ", 뜨는 저장소는 ", src("https://docs.github.com/en/rest", "GitHub API"), "에서 받았다."),
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
