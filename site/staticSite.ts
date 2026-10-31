// 페이지별 정적 HTML(4.1). 사이트 데이터로 색인 페이지마다 파일을 만들어 자바스크립트를 돌리지 않는 수집기도 내용을 읽게 한다.
// 앱은 이 위에 지금과 같은 화면을 그린다: 정적 본문은 #root 안에 있어 앱의 첫 렌더가 지우고, 그 전에는 head의 html.app 규칙이 숨긴다.
// 앱 코드를 받지 못하거나 코드를 처음 실행하다 오류가 나면 head의 오류 처리가 html.app을 지워 정적 본문이 보인다.
// 본문은 공용 뷰(components/*.ts)를 그대로 그려 문구를 두 벌로 두지 않는다. 영상, 기사 이미지, 오늘에 따라 바뀌는 것은 넣지 않는다(R7).
import fs from "node:fs";
import path from "node:path";
import { createElement as h, type CSSProperties, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { indicatorDef } from "../src/indicators.ts";
import { ROBOTS_FILE, pageFile } from "../src/publicSite.ts";
import {
  SITE_DATA_DIR,
  TERM_GROUPS,
  siteFiles,
  type DayList,
  type EntityChunk,
  type EntityDetail,
  type EntityListPage,
  type EntityNews,
  type EntityNewsChunk,
  type IndicatorCard,
  type IndicatorList,
  type IssueChunk,
  type IssueDetail,
  type ListStory,
  type MergedMap,
  type MonthDetail,
  type MonthList,
  type ScheduleIndex,
  type ScheduleItem,
  type ScheduleMonth,
  type SiteDates,
  type SiteIssueList,
  type StoryDetail,
  type TermGroupFile,
  type TermIndex,
  type TermItem,
} from "../src/siteTypes.ts";
import { RSS_FILE, buildRss, buildSitemaps, robotsTxt, type RssDay, type SitemapEntry } from "./feeds.ts";
import { articleLd, metaDescription, pageLd, renderHead, type HeadInfo } from "./head.ts";
import { APP_FILE, NOT_FOUND_FILE } from "./hosting.ts";
import { AboutView, ReadMarksText } from "./src/components/aboutView.ts";
import { FixMark, FixNotes } from "./src/components/correctionView.ts";
import { FredNotice, SourceNote } from "./src/components/indicatorView.ts";
import { NOT_FOUND_LABEL, NotFoundView } from "./src/components/notFoundView.ts";
import { FooterView, PrivacyView } from "./src/components/policyView.ts";
import { ReportLink } from "./src/components/reportLink.ts";
import { EntityChips, IssueEntityChips, type LinkLike } from "./src/components/termView.ts";
import { orderSources } from "./src/lib/brief.ts";
import { joinEntityPages } from "./src/lib/entities.ts";
import { briefTitle, entityLabel, fullKoreanDate, groupDatesByMonth, issueLabel, latestTitle, monthDay, monthDayWeekday, monthLabel, pageTitle, shortDate } from "./src/lib/format.ts";
import { groupCards, readingDateText, readingValueText } from "./src/lib/indicators.ts";
import { MENU, SKIP_LABEL } from "./src/lib/menu.ts";
import { PRIVACY_TITLE, PRIVACY_UPDATED, SITE_URL, shortReportHref, storyReportHref } from "./src/lib/policy.ts";
import { adjacentDates, briefPath, entityPath, indicatorPath, issuePath, privacyPath } from "./src/lib/routes.ts";
import { chipDue, nameLink } from "./src/lib/schedules.ts";
import { categoryVar } from "./src/lib/theme.ts";

// ---- 사이트 데이터 읽기 ----

interface SiteInput {
  dates: SiteDates;
  days: Map<string, DayList>;
  details: Map<string, Record<string, StoryDetail>>;
  issues: IssueDetail[];
  issueMerged: SiteIssueList["merged"];
  entities: EntityDetail[];
  entityMerged: MergedMap;
  terms: TermIndex;
  termGroups: { group: number; terms: TermItem[] }[];
  scheduleMonths: ScheduleMonth[];
  indicators: IndicatorList;
}

function loadInput(dataDir: string): SiteInput {
  const read = <T>(name: string, fallback: T): T => {
    const file = path.join(dataDir, name);
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
  };
  const names = fs.readdirSync(dataDir).sort();
  const matching = <T>(re: RegExp): T[] => names.filter((n) => re.test(n)).map((n) => read<T>(n, undefined as T));

  const dates = read<SiteDates>(siteFiles.dates, { version: 1, latestDate: null, dates: [], months: [], storyCounts: [] });
  const days = new Map<string, DayList>();
  for (const list of matching<MonthList>(/^list-\d{4}-\d{2}\.json$/)) for (const d of list.days) days.set(d.date, d);
  const details = new Map<string, Record<string, StoryDetail>>();
  for (const m of matching<MonthDetail>(/^detail-\d{4}-\d{2}\.json$/)) for (const [date, stories] of Object.entries(m.days)) details.set(date, stories);

  const issueList = read<SiteIssueList>(siteFiles.issueList, { issues: [], merged: {} });
  const issueById = new Map<number, IssueDetail>();
  for (const c of matching<IssueChunk>(/^issue-\d+\.json$/)) for (const i of Object.values(c.issues)) issueById.set(i.id, i);
  const issues = issueList.issues.flatMap((i) => issueById.get(i.id) ?? []);

  const entityById = new Map<number, EntityDetail>();
  const entityMerged: MergedMap = {};
  for (const c of matching<EntityChunk>(/^entity-\d+\.json$/)) {
    for (const e of Object.values(c.entities)) entityById.set(e.id, e);
    Object.assign(entityMerged, c.merged);
  }
  const moreNews = new Map<number, EntityNews[]>();
  for (const c of matching<EntityNewsChunk>(/^entity-news-\d+\.json$/)) for (const [id, news] of Object.entries(c.news)) moreNews.set(Number(id), news);
  const listed = joinEntityPages(matching<EntityListPage>(/^entity-list-all-\d+\.json$/));
  const entities = listed.flatMap((item) => {
    const e = entityById.get(item.id);
    return e ? [{ ...e, news: [...e.news, ...(moreNews.get(e.id) ?? [])] }] : [];
  });

  const terms = read<TermIndex>(siteFiles.termIndex, { total: 0, groups: [], ids: {}, merged: {} });
  const termGroups = matching<TermGroupFile>(/^term-group-\d+\.json$/).sort((a, b) => a.group - b.group);
  const scheduleIndex = read<ScheduleIndex>(siteFiles.scheduleIndex, { total: 0, months: [], majors: [] });
  const scheduleMonths = scheduleIndex.months.map((m) => read<ScheduleMonth>(siteFiles.scheduleMonth(m.month), { month: m.month, items: [] }));
  const indicators = read<IndicatorList>(siteFiles.indicatorList, { asOf: null, indicators: [] });
  return { dates, days, details, issues, issueMerged: issueList.merged, entities, entityMerged, terms, termGroups, scheduleMonths, indicators };
}

function latest(values: readonly (string | null | undefined)[]): string | null {
  let out: string | null = null;
  for (const v of values) if (v && (out === null || v > out)) out = v;
  return out;
}

// ---- 공통 틀 ----

/** 정적 페이지의 링크: 화면 이동기 대신 보통 링크다 */
const A: LinkLike = (({ to, children, ...rest }: { to: string; children?: ReactNode }) => h("a", { href: to, ...rest }, children)) as LinkLike;

// 정적 메뉴는 앞 항목만 둔다. 뒤 항목은 바닥글에 있고, 검색은 정적 화면에서 쓸 수 없어 두지 않는다
const STATIC_MENU_ITEMS = 5;

function BackLink({ to, label }: { to: string; label: string }) {
  return h("a", { href: to, className: "datebtn back" }, h("span", { "aria-hidden": true }, "‹ "), label);
}

function Shell({ left, center, children }: { left?: ReactNode; center?: ReactNode; children?: ReactNode }) {
  return h(
    "div",
    { className: "static-page" },
    h("a", { href: "#main", className: "skip" }, SKIP_LABEL),
    h(
      "header",
      { className: "bar" },
      h(
        "div",
        { className: "bar-row" },
        h("div", { className: "bar-left" }, left ?? h("a", { href: "/", className: "brand" }, "Tidwyn")),
        center ? h("div", { className: "bar-center" }, center) : null,
      ),
    ),
    h("nav", { className: "static-menu", "aria-label": "사이트 메뉴" }, h("ul", null, ...MENU.slice(0, STATIC_MENU_ITEMS).map(([to, label]) => h("li", { key: to }, h("a", { href: to }, label))))),
    h("main", { id: "main", className: "page" }, children),
    h(FooterView, { Link: A }),
  );
}

function CategoryText({ major, children, as = "div" }: { major: ListStory["category"]["major"]; children?: ReactNode; as?: string }) {
  const style: CSSProperties = { color: categoryVar(major) };
  return h(as, { className: "cat", style }, children);
}

function Empty({ children }: { children?: ReactNode }) {
  return h("p", { className: "state empty" }, children);
}

// ---- 브리프 ----

function StoryLinks({ story, detail, year }: { story: ListStory; detail: StoryDetail; year: string }) {
  return [
    (detail.entities?.length ?? 0) > 0 ? [h("h4", { className: "h", key: "eh" }, "인물·기관·국가"), h(EntityChips, { key: "e", entities: detail.entities!, Link: A })] : null,
    h("h4", { className: "h", key: "ch" }, "확인 정도"),
    h("p", { className: "p", key: "c" }, detail.confidence),
    detail.extras.length > 0
      ? [h("h4", { className: "h", key: "xh" }, "함께 엮인 이슈"), h("div", { className: "rel", key: "x" }, detail.extras.map((x) => h("a", { key: x.id, href: issuePath(x.id) }, x.name)))]
      : null,
    detail.sources.length > 0
      ? [
          h("h4", { className: "h", key: "sh" }, "출처"),
          h(
            "div",
            { className: "src", key: "s" },
            orderSources(detail.sources).map((s, i) =>
              h("a", { key: `${story.key}-${i}`, href: s.url, target: "_blank", rel: "noopener noreferrer" }, s.name, h("small", null, ` · ${shortDate(s.publishedAt, year)}${s.publishedAtEstimated ? " 추정" : ""}`), h("span", { className: "sr-only" }, " (새 탭)")),
            ),
          ),
        ]
      : null,
  ];
}

function StoryBody({ story, detail, date }: { story: ListStory; detail: StoryDetail; date: string }) {
  const year = date.slice(0, 4);
  const section = (title: string, text: string | undefined) => (text ? [h("h4", { className: "h", key: `${title}-h` }, title), h("p", { className: "p", key: title }, text)] : null);
  return h(
    "div",
    { className: "detail" },
    story.issue ? h("div", { className: "story" }, h("b", null, h("a", { href: issuePath(story.issue.id) }, `이어지는 이야기 · ${story.issue.name}`))) : null,
    h("p", { className: "sum" }, detail.summary),
    h(FixNotes, { fixes: story.corrections, className: "fix" }),
    section("왜 중요한가", detail.whyItMatters),
    section("배경", detail.background),
    detail.keyFacts.length > 0 ? [h("h4", { className: "h", key: "fh" }, "핵심"), h("ul", { className: "p facts", key: "f" }, detail.keyFacts.map((f, i) => h("li", { key: i }, f)))] : null,
    section("비유", detail.analogy),
    section("전망", detail.outlook),
    h(StoryLinks, { story, detail, year }),
    h(ReportLink, { href: storyReportHref(monthDay(date), story.title, `${SITE_URL}${briefPath(date, story.key)}`), label: "틀린 내용 알리기" }),
  );
}

function TopStory({ story, detail, date }: { story: ListStory; detail: StoryDetail | undefined; date: string }) {
  const category = `${story.category.major} · ${story.category.minor}`;
  return h(
    "li",
    { id: story.key, className: "item open" },
    story.corrections ? h("span", { className: "cat-row" }, h(CategoryText, { major: story.category.major }, category), h(FixMark, { fixes: story.corrections })) : h(CategoryText, { major: story.category.major }, category),
    h("h3", { className: "title" }, story.title),
    detail ? h(StoryBody, { story, detail, date }) : null,
  );
}

function ShortStory({ story }: { story: ListStory }) {
  return h(
    "li",
    { id: story.key, className: "short" },
    h("p", { className: "short-text" }, story.title),
    h(
      "div",
      { className: "short-meta" },
      h("span", { className: "cat-inline", style: { color: categoryVar(story.category.major) } }, `${story.category.major} · ${story.category.minor}`),
      story.issue ? h("a", { href: issuePath(story.issue.id) }, story.issue.name) : null,
      h(FixMark, { fixes: story.corrections }),
    ),
    h(FixNotes, { fixes: story.corrections, className: "short-fix" }),
  );
}

function DateNav({ date, prev, next }: { date: string; prev: string | null; next: string | null }) {
  const arrow = (to: string | null, glyph: string, label: string) =>
    to ? h("a", { href: briefPath(to), className: "arrow", "aria-label": `${label} ${monthDay(to)}` }, glyph) : h("span", { className: "arrow off", "aria-hidden": true }, glyph);
  return h("span", { className: "datebtn" }, arrow(prev, "‹", "이전 날짜"), h("a", { href: "/dates", className: "date-link", "aria-label": `${monthDayWeekday(date)}, 날짜 목록 보기` }, monthDayWeekday(date)), arrow(next, "›", "다음 날짜"));
}

function BriefBody({ day, details, prev, next }: { day: DayList; details: Record<string, StoryDetail>; prev: string | null; next: string | null }) {
  const date = day.date;
  const sectionId = (i: number) => `section-${i + 1}`;
  return h(
    "div",
    { className: "static-brief" },
    h("h1", { className: "page-title pad" }, `${monthDayWeekday(day.date)} 브리프`),
    h("div", { className: "headline" }, day.headline, day.keywords.length > 0 ? h("div", { className: "kw", "aria-label": "키워드" }, day.keywords.map((k) => h("span", { key: k }, k))) : null),
    day.sections.length > 1 ? h("nav", { className: "rel static-jump", "aria-label": "구역으로 가기" }, day.sections.map((sec, i) => h("a", { key: sec.name, href: `#${sectionId(i)}` }, sec.name))) : null,
    day.sections.map((sec, i) => {
      const tops = sec.stories.filter((s) => s.kind === "top");
      const shorts = sec.stories.filter((s) => s.kind === "short");
      return h(
        "section",
        { key: sec.name, className: "brief-section" },
        h("h2", { className: "h list-h", id: sectionId(i) }, sec.name),
        sec.flow ? h("p", { className: "flow" }, sec.flow) : null,
        tops.length > 0 ? h("ul", { className: "list" }, tops.map((s) => h(TopStory, { key: s.key, story: s, detail: details[s.key], date }))) : null,
        shorts.length > 0 ? [h("h3", { className: "h list-h", key: "h" }, "짧은 소식"), h("ul", { className: "list", key: "l" }, shorts.map((s) => h(ShortStory, { key: s.key, story: s }))), h("p", { className: "short-report", key: "r" }, h(ReportLink, { href: shortReportHref(monthDay(date), `${SITE_URL}${briefPath(date)}`), label: "짧은 소식 틀린 내용 알리기" }))] : null,
        sec.unverified ? h("p", { className: "flow note" }, `확인되지 않은 내용: ${sec.unverified}`) : null,
      );
    }),
    h("nav", { className: "static-more", "aria-label": "다른 날짜" }, prev ? h("a", { href: briefPath(prev) }, `‹ ${monthDay(prev)}`) : h("span"), next ? h("a", { href: briefPath(next) }, `${monthDay(next)} ›`) : null),
  );
}

// ---- 이슈, 대상 ----

function NewsLinks({ news, year }: { news: { date: string; key: string; title: string }[]; year: string | undefined }) {
  return h(
    "ol",
    { className: "tl" },
    news.map((t) => h("li", { key: `${t.date}-${t.key}` }, h("a", { href: briefPath(t.date, t.key), className: "nrow" }, h("div", { className: "nrow-txt" }, h("small", null, shortDate(t.date, year)), h("span", { className: "nt" }, t.title))))),
  );
}

function IssueBody({ issue }: { issue: IssueDetail }) {
  const meta = [issue.startDate && `${issue.startDate} 시작`, issue.latestDate && `최근 ${shortDate(issue.latestDate, issue.startDate?.slice(0, 4))}`, `전개 ${issue.count}건`].filter(Boolean).join(" · ");
  return h(
    "article",
    { className: "iss" },
    h(CategoryText, { major: issue.category.major }, `${issue.category.major} · ${issue.category.minor} · ${issue.status}`),
    h("h1", { className: "name" }, issue.name),
    issue.aliases.length > 0 ? h("p", { className: "aliases" }, `다른 이름: ${issue.aliases.join(", ")}`) : null,
    h("p", { className: "meta" }, meta),
    issue.summary ? h("div", { className: "summary" }, issue.summary) : null,
    h("h2", { className: "h" }, "타임라인"),
    issue.timeline.length > 0 ? h(NewsLinks, { news: issue.timeline, year: issue.latestDate?.slice(0, 4) }) : h("p", { className: "p muted" }, "아직 전개가 없다."),
    (issue.entities?.length ?? 0) > 0 ? [h("h2", { className: "h", key: "eh" }, "등장 인물·기관·국가"), h(IssueEntityChips, { key: "e", entities: issue.entities, Link: A })] : null,
    issue.related.length > 0 ? [h("h2", { className: "h", key: "rh" }, "관련 이슈"), h("div", { className: "rel", key: "r" }, issue.related.map((r) => h("a", { key: r.id, href: issuePath(r.id) }, r.name)))] : null,
  );
}

function EntityBody({ entity }: { entity: EntityDetail }) {
  const year = entity.latestDate.slice(0, 4);
  const meta = [entity.aliases.length ? `별칭: ${entity.aliases.join(", ")}` : null, `처음 ${shortDate(entity.firstDate, year)}`, `최근 ${shortDate(entity.latestDate, year)}`, `뉴스 ${entity.count.toLocaleString("ko-KR")}건`].filter(Boolean).join(" · ");
  return h(
    "article",
    { className: "iss" },
    h("div", { className: "cat muted-cat" }, entity.kind),
    h("h1", { className: "name" }, entity.name),
    h("p", { className: "meta" }, entity.description ? [entity.description, h("br", { key: "br" })] : null, meta),
    entity.issues.length > 0 ? [h("h2", { className: "h", key: "ih" }, "등장한 이슈"), h("div", { className: "rel", key: "i" }, entity.issues.map((i) => h("a", { key: i.id, href: issuePath(i.id) }, i.name, h("small", null, i.count.toLocaleString("ko-KR")))))] : null,
    h("h2", { className: "h" }, "등장한 뉴스"),
    h(NewsLinks, { news: entity.news, year }),
  );
}

function MergedBody({ kindLabel, on, name, to }: { kindLabel: string; on: string | null; name: string; to: string }) {
  return h("div", { className: "plain" }, h("h1", { className: "page-title" }, name), h("p", { className: "notice", role: "note" }, `이 ${kindLabel}은 ${on ? `${monthDay(on)}에 ` : ""}${name}에 합쳐졌다.`), h("p", { className: "p" }, h("a", { href: to, className: "text-link" }, `${name} 보기`)));
}

// ---- 목록 ----

function DatesBody({ dates }: { dates: string[] }) {
  return [
    h("h1", { className: "page-title pad", key: "t" }, "날짜 목록"),
    dates.length === 0 ? h(Empty, { key: "e" }, "아직 저장된 브리프가 없다.") : null,
    ...groupDatesByMonth(dates).map((g) => h("section", { key: g.month }, h("h2", { className: "h list-h" }, monthLabel(g.month)), h("ul", { className: "list" }, g.dates.map((d) => h("li", { key: d, className: "row" }, h("a", { href: briefPath(d), className: "row-link nrow" }, h("span", null, monthDayWeekday(d)))))))),
  ];
}

function IssuesBody({ issues }: { issues: IssueDetail[] }) {
  return [
    h("h1", { className: "page-title pad", key: "t" }, "이슈 목록"),
    issues.length === 0 ? h(Empty, { key: "e" }, "아직 이슈가 없다.") : h("p", { className: "count", key: "c" }, `${issues.length.toLocaleString("ko-KR")}개`),
    h(
      "ul",
      { className: "list", key: "l" },
      issues.map((i) =>
        h("li", { key: i.id, className: "item" }, h("a", { href: issuePath(i.id), className: "item-btn" }, h(CategoryText, { major: i.category.major }, `${i.category.major} · ${i.category.minor}`), h("span", { className: "title" }, i.name), h("span", { className: "cont" }, `${i.status}${i.latestDate ? ` · 최근 ${i.latestDate}` : ""} · 전개 ${i.count}건`))),
      ),
    ),
  ];
}

function EntitiesBody({ entities }: { entities: EntityDetail[] }) {
  const year = entities[0]?.latestDate.slice(0, 4);
  return [
    h("h1", { className: "page-title pad", key: "t" }, "인물·기관·국가"),
    entities.length === 0 ? h(Empty, { key: "e" }, "아직 인물·기관·국가가 없다.") : h("p", { className: "count", key: "c" }, `${entities.length.toLocaleString("ko-KR")}개 · 최근 등장 순`),
    h(
      "ul",
      { className: "list", key: "l" },
      entities.map((e) =>
        h(
          "li",
          { key: e.id, className: "item" },
          h("a", { href: entityPath(e.id), className: "item-btn" }, h("span", { className: "cat muted-cat" }, `${e.kind} · 최근 ${shortDate(e.latestDate, year)} · 뉴스 ${e.count.toLocaleString("ko-KR")}건`), h("span", { className: "title small" }, e.name), e.description ? h("span", { className: "cont" }, e.description) : null),
        ),
      ),
    ),
  ];
}

function TermsBody({ input }: { input: SiteInput }) {
  const id = (group: number) => `term-group-${group}`;
  return h(
    "div",
    { className: "iss" },
    h("h1", { className: "name" }, "용어 사전"),
    h("p", { className: "meta" }, `용어 ${input.terms.total.toLocaleString("ko-KR")}개 · 가나다순`),
    input.termGroups.length === 0
      ? h(Empty, null, "아직 용어가 없다.")
      : [
          h("nav", { "aria-label": "첫 자음으로 가기", className: "rel term-jump", key: "n" }, input.termGroups.map((g) => h("a", { key: g.group, href: `#${id(g.group)}` }, TERM_GROUPS[g.group]))),
          ...input.termGroups.map((g) =>
            h(
              "section",
              { key: g.group },
              h("h2", { className: "h term-h", id: id(g.group) }, TERM_GROUPS[g.group]),
              h("dl", { className: "static-terms" }, g.terms.flatMap((t) => [h("dt", { key: `${t.id}-t` }, t.name), h("dd", { key: `${t.id}-d` }, t.description, t.aliases.length > 0 ? ` (다른 이름: ${t.aliases.join(", ")})` : "")])),
            ),
          ),
        ],
  );
}

function ScheduleRow({ item }: { item: ScheduleItem }) {
  const to = nameLink(item);
  return h(
    "li",
    { className: "ev" },
    h(CategoryText, { major: item.major }, `${item.major} · ${chipDue(item.due)}`),
    to ? h("a", { href: to, className: "t" }, item.name) : h("span", { className: "t" }, item.name),
    item.issue ? h("small", null, "이슈: ", h("a", { href: issuePath(item.issue.id) }, item.issue.name)) : null,
  );
}

function SchedulesBody({ months }: { months: ScheduleMonth[] }) {
  return h(
    "div",
    { className: "iss" },
    h("h1", { className: "name" }, "일정"),
    h("p", { className: "meta" }, "뉴스에서 모은 예정 일정 · 날짜는 현지 기준"),
    months.length === 0 ? h(Empty, null, "아직 일정이 없다.") : null,
    months.map((m) => h("section", { key: m.month }, h("h2", { className: "h" }, monthLabel(m.month)), h("ul", { className: "evlist" }, m.items.map((i) => h(ScheduleRow, { key: i.id, item: i }))))),
  );
}

/** 코스피·코스닥은 값과 날짜를 HTML에 싣지 않는다(R12, X3). 값은 앱의 그래프로 본다 */
function showsValue(card: IndicatorCard): boolean {
  return card.last !== null && (indicatorDef(card.id)?.backup ?? false);
}

function IndicatorValue({ card }: { card: IndicatorCard }) {
  return showsValue(card) ? h("p", { className: "ind-meta" }, h("b", { className: "ind-v" }, readingValueText(card, card.last!)), ` · ${readingDateText(card.last!.date)} · ${card.credit}`) : h("p", { className: "ind-meta" }, card.last ? `값은 이 화면에 싣지 않는다. 자바스크립트를 켜면 볼 수 있다. · ${card.credit}` : card.credit);
}

function IndicatorsBody({ indicators }: { indicators: IndicatorList }) {
  return h(
    "div",
    { className: "ind" },
    h("h1", { className: "page-title" }, "지표"),
    indicators.indicators.length === 0 ? h(Empty, null, "아직 지표 값이 없다.") : null,
    groupCards(indicators.indicators).map((g) => h("section", { key: g.group }, h("h2", { className: "h" }, g.group), h("ul", { className: "evlist" }, g.cards.map((c) => h("li", { key: c.id, className: "ev" }, h("a", { href: indicatorPath(c.id), className: "t" }, c.name), h(IndicatorValue, { card: c })))))),
    h("div", { className: "ind-foot" }, h(SourceNote, { metas: indicators.indicators }), h(FredNotice)),
  );
}

function IndicatorBody({ card }: { card: IndicatorCard }) {
  return h(
    "article",
    { className: "ind" },
    h("h1", { className: "page-title" }, card.name),
    h("p", { className: "p" }, indicatorDef(card.id)?.description ?? ""),
    h(IndicatorValue, { card }),
    card.issues.length > 0 ? [h("h2", { className: "h", key: "h" }, "관련 이슈"), h("div", { className: "rel", key: "r" }, card.issues.map((i) => h("a", { key: i.id, href: issuePath(i.id) }, i.name)))] : null,
    h("div", { className: "ind-foot" }, h(SourceNote, { metas: [card] })),
  );
}

function PlainBody({ children }: { children?: ReactNode }) {
  return h("article", { className: "plain" }, children);
}

// ---- 페이지 목록 ----

interface StaticPage {
  /** 공개 주소 기준 경로 */
  path: string;
  head: HeadInfo;
  body: ReactNode;
  /** 색인 페이지(sitemap에 넣는다). 흡수된 주소는 false */
  indexed: boolean;
  lastmod: string | null;
}

function buildPages(input: SiteInput): StaticPage[] {
  const pages: StaticPage[] = [];
  const add = (p: { path: string; title: string; description: string; body: ReactNode; lastmod: string | null; ld: (description: string) => object; ogType?: "website" | "article" }) => {
    const description = metaDescription(p.description);
    pages.push({ path: p.path, head: { title: p.title, description, canonical: p.path, ogType: p.ogType ?? "website", jsonLd: [p.ld(description)] }, body: p.body, indexed: true, lastmod: p.lastmod });
  };
  const fixOn = new Map<string, string>();
  for (const [date, day] of input.days) for (const s of day.sections.flatMap((x) => x.stories)) if (s.corrections) fixOn.set(`${date}/${s.key}`, s.corrections[0]!.on);
  const fixesOf = (news: { date: string; key: string }[]) => news.map((n) => fixOn.get(`${n.date}/${n.key}`));

  const dates = input.dates.dates;
  const briefMods = new Map(dates.map((d) => [d, latest([d, ...(input.days.get(d)?.sections ?? []).flatMap((s) => s.stories.map((x) => x.corrections?.[0]?.on))])]));
  const brief = (pathname: string, date: string, title: string, website: boolean) => {
    const day = input.days.get(date);
    if (!day) return;
    const { prev, next } = adjacentDates(dates, date);
    const headline = `${fullKoreanDate(date)} 브리프`;
    const description = day.headline || headline;
    const modified = briefMods.get(date) ?? date;
    add({
      path: pathname,
      title,
      description,
      lastmod: modified,
      ogType: website ? "website" : "article",
      ld: (d) => (website ? pageLd("WebSite", { path: pathname, name: "Tidwyn", description: d }) : articleLd({ path: pathname, headline, description: d, published: date, modified })),
      body: h(Shell, { center: h(DateNav, { date, prev, next }) }, h(BriefBody, { day, details: input.details.get(date) ?? {}, prev, next })),
    });
  };
  const home = input.dates.latestDate;
  if (home) brief("/", home, latestTitle(), true);
  else add({ path: "/", title: latestTitle(), description: "", lastmod: null, ld: (d) => pageLd("WebSite", { path: "/", name: "Tidwyn", description: d }), body: h(Shell, null, h(Empty, null, "아직 저장된 브리프가 없다.")) });
  for (const date of dates) brief(briefPath(date), date, briefTitle(date, dates), false);

  const back = (to: string, label: string) => h(BackLink, { to, label });
  const list = (p: { path: string; label: string; description: string; body: ReactNode; lastmod: string | null }) =>
    add({ path: p.path, title: pageTitle(p.label), description: p.description, lastmod: p.lastmod, ld: (d) => pageLd("CollectionPage", { path: p.path, name: p.label, description: d }), body: h(Shell, { left: back("/", "브리프") }, p.body) });

  list({ path: "/dates", label: "날짜 목록", description: "지금까지 저장된 날짜별 뉴스 브리프 목록", lastmod: home, body: h(DatesBody, { dates }) });

  const issueMods = new Map(input.issues.map((i) => [i.id, latest([i.latestDate, ...fixesOf(i.timeline)])]));
  list({ path: "/issues", label: "이슈 목록", description: "이어지는 뉴스를 묶은 이슈 목록. 이슈마다 흐름과 최근 전개를 볼 수 있다", lastmod: latest([...issueMods.values()]), body: h(IssuesBody, { issues: input.issues }) });
  const issueById = new Map(input.issues.map((i) => [i.id, i]));
  for (const issue of input.issues) {
    const pathname = issuePath(issue.id);
    add({
      path: pathname,
      title: pageTitle(issueLabel(issue)),
      description: issue.summary || `${issue.name} 이슈의 흐름과 전개`,
      lastmod: issueMods.get(issue.id) ?? null,
      ogType: "article",
      ld: (d) => articleLd({ path: pathname, headline: issue.name, description: d, published: issue.startDate, modified: issueMods.get(issue.id) ?? null }),
      body: h(Shell, { left: back("/issues", "이슈") }, h(IssueBody, { issue })),
    });
  }

  const entityMods = new Map(input.entities.map((e) => [e.id, latest([e.latestDate, ...fixesOf(e.news)])]));
  list({ path: "/entities", label: "인물·기관·국가", description: "뉴스에 나온 인물·기관·국가 목록. 항목마다 관련 이슈와 뉴스를 볼 수 있다", lastmod: latest([...entityMods.values()]), body: h(EntitiesBody, { entities: input.entities }) });
  const entityById = new Map(input.entities.map((e) => [e.id, e]));
  for (const entity of input.entities) {
    const pathname = entityPath(entity.id);
    add({
      path: pathname,
      title: pageTitle(entityLabel(entity)),
      description: entity.description || `${entity.name}이(가) 나온 뉴스와 이슈`,
      lastmod: entityMods.get(entity.id) ?? null,
      ld: (d) => pageLd("WebPage", { path: pathname, name: entity.name, description: d }),
      body: h(Shell, { left: back("/entities", "인물·기관·국가") }, h(EntityBody, { entity })),
    });
  }

  list({ path: "/terms", label: "용어 사전", description: "뉴스에 나온 어려운 말을 쉬운 말로 풀어 쓴 용어 사전", lastmod: latest(input.termGroups.flatMap((g) => g.terms.map((t) => t.first?.date))), body: h(TermsBody, { input }) });
  list({ path: "/schedules", label: "일정", description: "뉴스에서 모은 앞으로의 일정과 지난 일정", lastmod: latest(input.scheduleMonths.flatMap((m) => m.items.map((i) => i.knownOn))), body: h(SchedulesBody, { months: input.scheduleMonths }) });

  const indicatorMod = (c: IndicatorCard) => (showsValue(c) ? c.last!.date : null);
  list({ path: "/indicators", label: "지표", description: "환율, 금리, 물가, 유가 같은 주요 지표의 최근 값과 출처", lastmod: latest(input.indicators.indicators.map(indicatorMod)), body: h(IndicatorsBody, { indicators: input.indicators }) });
  for (const card of input.indicators.indicators) {
    const pathname = indicatorPath(card.id);
    add({
      path: pathname,
      title: pageTitle(card.name),
      description: indicatorDef(card.id)?.description ?? card.name,
      lastmod: indicatorMod(card),
      ld: (d) => pageLd("WebPage", { path: pathname, name: card.name, description: d }),
      body: h(Shell, { left: back("/indicators", "지표") }, h(IndicatorBody, { card })),
    });
  }

  const aboutDescription = "Tidwyn은 AI가 매일 한국·세계·IT·AI 뉴스를 모아 쉬운 말로 바꿔 쓴 요약이다. 오류 정정과 연락 방법을 적었다";
  add({ path: "/about", title: pageTitle("사이트 소개"), description: aboutDescription, lastmod: PRIVACY_UPDATED, ld: (d) => pageLd("AboutPage", { path: "/about", name: "사이트 소개", description: d }), body: h(Shell, { left: back("/", "브리프") }, h(AboutView, { Link: A, readMarks: h(ReadMarksText) })) });
  add({ path: privacyPath(), title: pageTitle(PRIVACY_TITLE), description: "Tidwyn이 다루는 정보와 브라우저에 두는 기록, YouTube 영상과 메일 처리 방침", lastmod: PRIVACY_UPDATED, ld: (d) => pageLd("WebPage", { path: privacyPath(), name: PRIVACY_TITLE, description: d }), body: h(Shell, { left: back("/", "브리프") }, h(PlainBody, null, h(PrivacyView, { Link: A }))) });

  // 흡수된 주소: 200이고 canonical이 남는 주소다. 앱은 지금처럼 남는 것을 보인다(4.3-4)
  const merged = <T extends { id: number; name: string }>(map: MergedMap, byId: Map<number, T>, base: (id: number) => string, kindLabel: string, label: (x: T) => string, backTo: [string, string]) => {
    for (const [id, m] of Object.entries(map)) {
      const survivor = byId.get(m.into);
      if (!survivor) continue;
      const to = base(survivor.id);
      pages.push({ path: base(Number(id)), head: { title: pageTitle(label(survivor)), description: metaDescription(`${survivor.name}에 합쳐진 주소다`), canonical: to }, body: h(Shell, { left: back(...backTo) }, h(MergedBody, { kindLabel, on: m.on, name: survivor.name, to })), indexed: false, lastmod: null });
    }
  };
  merged(input.issueMerged, issueById, issuePath, "이슈", issueLabel, ["/issues", "이슈"]);
  merged(input.entityMerged, entityById, entityPath, "항목", entityLabel, ["/entities", "인물·기관·국가"]);
  return pages;
}

/** 빌드 뒤 공개할 파일: 페이지마다의 HTML과 수집기용 파일. Vite가 만든 index.html을 틀로 쓴다 */
function renderTemplate(template: string, head: string, body: string | null): string {
  const withHead = fill(template, /<title>[\s\S]*?<\/title>/, head);
  if (body === null) return withHead;
  return fill(withHead, /<div id="root"><\/div>/, `<div id="root">${body}</div>`).replace(/\s*<noscript>[\s\S]*?<\/noscript>/, "");
}

/** 틀의 자리를 바꾼다. 빌드 결과 모양이 달라져 자리가 없으면 본문 없는 페이지를 내지 않고 멈춘다 */
function fill(template: string, slot: RegExp, value: string): string {
  if (!slot.test(template)) throw new Error(`화면 틀에 ${slot.source} 자리가 없다`);
  return template.replace(slot, () => value);
}

export function writeStaticSite(outDir: string): void {
  const template = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  const input = loadInput(path.join(outDir, SITE_DATA_DIR));
  const pages = buildPages(input);
  const write = (rel: string, content: string) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  for (const p of pages) write(pageFile(p.path), renderTemplate(template, renderHead(p.head), renderToStaticMarkup(p.body as never)));
  write(APP_FILE, renderTemplate(template, renderHead({ title: pageTitle(), description: metaDescription(""), noindex: true }), null));
  write(NOT_FOUND_FILE, renderTemplate(template, renderHead({ title: pageTitle(NOT_FOUND_LABEL), description: metaDescription(""), noindex: true }), renderToStaticMarkup(h(Shell, null, h(NotFoundView, { Link: A, noSearch: true })))));

  const entries: SitemapEntry[] = pages.filter((p) => p.indexed).map((p) => ({ path: p.path, lastmod: p.lastmod }));
  for (const [name, content] of buildSitemaps(entries)) write(name, content);
  write(ROBOTS_FILE, robotsTxt());
  const rssDays: RssDay[] = input.dates.dates.flatMap((date) => {
    const day = input.days.get(date);
    return day ? [{ date, titles: day.sections.flatMap((s) => s.stories.filter((x) => x.kind === "top").map((x) => x.title)) }] : [];
  });
  write(RSS_FILE, buildRss(rssDays));
}
