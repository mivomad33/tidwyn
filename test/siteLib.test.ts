import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ISSUE_CHUNK_SIZE, issueChunkOf, siteFiles } from "../src/siteTypes.ts";
import type { DayList, IssueChunk, IssueDetail, IssueListItem, ListStory, SiteIssueList, SiteSource, StoryDetail } from "../src/siteTypes.ts";
import { HOSTING_CONFIG_FILE, resolveStatic, vercelConfig } from "../site/hosting.ts";
import { analyticsEnabled, stripSearchQuery } from "../site/src/lib/analytics.ts";
import { daySections, findStoryTarget, orderSources, sectionView, stateForHash, storyImage, type BriefViewState } from "../site/src/lib/brief.ts";
import { groupDatesByMonth, monthDayWeekday, pageTitle, shortDate } from "../site/src/lib/format.ts";
import { filterIssues, sortIssues } from "../site/src/lib/issues.ts";
import { ISSUE_CHUNK, chunkOf, dataUrl } from "../site/src/lib/paths.ts";
import { adjacentDates, briefPath, focusTargetId, hashKey, isValidDate, parseRoute, resolveBriefDate, resolveIssueId } from "../site/src/lib/routes.ts";
import { countMatches, matchDayStories, matchIssues, parseHit, queryTerms } from "../site/src/lib/search.ts";
import { DARK, LIGHT, contrast, textPairs } from "../site/src/lib/theme.ts";

// 사이트 화면의 DOM 없는 로직(라우팅, 거르기, 카드 펼치기, 검색 되찾기, 통계, 대비). 값은 모두 지어낸 것이다.

function story(key: string, over: Partial<ListStory> = {}): ListStory {
  const short = key.includes("-s");
  const [section, pos] = key.split("-") as [ListStory["section"], string];
  return {
    key,
    section,
    kind: short ? "short" : "top",
    position: Number(pos.replace("s", "")),
    title: `가짜 제목 ${key}`,
    category: { major: "경제", minor: "거시·정책" },
    issue: null,
    newIssue: false,
    continues: null,
    ...over,
  };
}

const DAY: DayList = {
  date: "2026-10-27",
  headline: "가짜 헤드라인",
  keywords: ["가짜"],
  sections: [
    {
      name: "한국",
      flow: "흐름",
      stories: [
        story("한국-s2", { category: { major: "사회", minor: "교육" } }),
        story("한국-2", { category: { major: "정치", minor: "선거" }, title: "가짜당 선거 전략 발표" }),
        story("한국-1", { title: "가짜시 반도체가 수출을 끌어올렸다" }),
        story("한국-s1", { title: "가짜구 반도체 공장 화재" }),
      ],
    },
    { name: "세계", flow: "흐름", stories: [story("세계-1", { category: { major: "국제", minor: "중동" }, title: "가짜국 휴전 결렬" })] },
  ],
};

describe("4.2-1 라우팅", () => {
  test("화면 주소를 고른다", () => {
    assert.deepEqual(parseRoute("/"), { name: "latest" });
    assert.deepEqual(parseRoute("/2026-10-27"), { name: "brief", date: "2026-10-27" });
    assert.deepEqual(parseRoute("/2026-10-27/"), { name: "brief", date: "2026-10-27" });
    assert.deepEqual(parseRoute("/dates"), { name: "dates" });
    assert.deepEqual(parseRoute("/issues"), { name: "issues" });
    assert.deepEqual(parseRoute("/issues/12"), { name: "issue", id: 12 });
    assert.deepEqual(parseRoute("/search", "?q=%EB%B0%98%EB%8F%84%EC%B2%B4"), { name: "search", q: "반도체" });
    assert.deepEqual(parseRoute("/search"), { name: "search", q: "" });
    assert.deepEqual(parseRoute("/about"), { name: "about" });
  });
  test("모르는 주소, 달력에 없는 날짜, 틀린 식별자는 없는 페이지다", () => {
    for (const p of ["/nope", "/2026-02-30", "/2026-13-01", "/26-10-27", "/issues/abc", "/issues/012", "/issues/1/x", "/site-data"]) {
      assert.deepEqual(parseRoute(p), { name: "notFound" }, p);
    }
    assert.equal(isValidDate("2028-02-29"), true);
    assert.equal(isValidDate("2027-02-29"), false);
  });
  test("저장되지 않은 날짜는 없는 페이지로 보내고, /는 가장 최근 날짜다", () => {
    const dates = { latestDate: "2026-10-27", dates: ["2026-10-27", "2026-10-26", "2026-10-24"] };
    assert.equal(resolveBriefDate({ name: "latest" }, dates), "2026-10-27");
    assert.equal(resolveBriefDate({ name: "brief", date: "2026-10-24" }, dates), "2026-10-24");
    assert.equal(resolveBriefDate({ name: "brief", date: "2026-10-25" }, dates), null);
    assert.equal(resolveBriefDate({ name: "latest" }, { latestDate: null, dates: [] }), null);
  });
  test("이전·다음 날짜", () => {
    const dates = ["2026-10-27", "2026-10-26", "2026-10-24"];
    assert.deepEqual(adjacentDates(dates, "2026-10-26"), { prev: "2026-10-24", next: "2026-10-27" });
    assert.deepEqual(adjacentDates(dates, "2026-10-27"), { prev: "2026-10-26", next: null });
    assert.deepEqual(adjacentDates(dates, "2026-10-24"), { prev: null, next: "2026-10-26" });
  });
  test("뉴스 키 주소", () => {
    assert.equal(briefPath("2026-10-27", "한국-1"), "/2026-10-27#%ED%95%9C%EA%B5%AD-1");
    assert.equal(hashKey("#%ED%95%9C%EA%B5%AD-1"), "한국-1");
    assert.equal(hashKey("#한국-s2"), "한국-s2");
    assert.equal(hashKey(""), null);
    assert.equal(hashKey("#%E0%A4%A"), null);
  });
  test("앱 안 이동 뒤 초점: 검색어 없는 검색 화면은 입력란, 나머지는 본문", () => {
    assert.equal(focusTargetId(parseRoute("/search")), "q");
    assert.equal(focusTargetId(parseRoute("/search", "?q=%EB%B0%98%EB%8F%84%EC%B2%B4")), "main");
    for (const p of ["/", "/2026-10-27", "/dates", "/issues", "/issues/1", "/about", "/nope"]) {
      assert.equal(focusTargetId(parseRoute(p)), "main", p);
    }
  });
});

describe("4.3-2 흡수된 이슈 주소", () => {
  const item = (id: number): IssueListItem => ({ id, name: `가짜 이슈 ${id}`, category: { major: "경제", minor: "거시·정책" }, status: "진행 중", startDate: null, latestDate: null, count: 0 });
  const list: SiteIssueList = { issues: [item(1), item(2)], merged: { "3": { into: 1, on: "2026-10-26" } } };
  test("흡수된 이슈는 남는 이슈로 가고, 없는 식별자는 null이다", () => {
    assert.deepEqual(resolveIssueId(3, list), { id: 1, mergedFrom: { id: 3, on: "2026-10-26" } });
    assert.deepEqual(resolveIssueId(2, list), { id: 2, mergedFrom: null });
    assert.equal(resolveIssueId(9, list), null);
  });
  test("합치기를 되돌린 데이터(merged에서 빠지고 목록에 다시 있음)에서는 원래 이슈를 보인다", () => {
    const undone: SiteIssueList = { issues: [item(1), item(2), item(3)], merged: {} };
    assert.deepEqual(resolveIssueId(3, undone), { id: 3, mergedFrom: null });
  });
});

describe("4.2-2 섹션과 카테고리 필터", () => {
  test("고른 섹션의 주요 뉴스는 순위 순, 짧은 소식은 위치 순이다", () => {
    const v = sectionView(DAY, "한국", null);
    assert.deepEqual(v.top.map((s) => s.key), ["한국-1", "한국-2"]);
    assert.deepEqual(v.short.map((s) => s.key), ["한국-s1", "한국-s2"]);
    assert.deepEqual(sectionView(DAY, "세계", null).top.map((s) => s.key), ["세계-1"]);
  });
  test("필터는 주요 뉴스와 짧은 소식을 함께 거르고, 없으면 빈 결과다", () => {
    const v = sectionView(DAY, "한국", "경제");
    assert.deepEqual(v.top.map((s) => s.key), ["한국-1"]);
    assert.deepEqual(v.short.map((s) => s.key), ["한국-s1"]);
    assert.deepEqual(sectionView(DAY, "한국", "사회").short.map((s) => s.key), ["한국-s2"]);
    const none = sectionView(DAY, "세계", "IT·AI");
    assert.equal(none.top.length + none.short.length, 0);
    const missing = sectionView(DAY, "IT·AI", null);
    assert.equal(missing.top.length + missing.short.length, 0);
  });
  test("그날 있는 섹션만 탭에 둔다", () => {
    assert.deepEqual(daySections(DAY), ["한국", "세계"]);
  });
});

describe("4.2-4 #<뉴스 키>로 카드 펼치기", () => {
  const start: BriefViewState = { section: "한국", major: null, expanded: null };
  test("주요 뉴스 키는 그 섹션을 고르고 카드를 펼친다", () => {
    assert.deepEqual(stateForHash(DAY, "세계-1", start), { section: "세계", major: null, expanded: "세계-1" });
    assert.deepEqual(stateForHash(DAY, "한국-2", start), { section: "한국", major: null, expanded: "한국-2" });
  });
  test("필터가 그 뉴스를 가리면 전체로 돌리고, 맞으면 필터를 둔다", () => {
    assert.deepEqual(stateForHash(DAY, "한국-2", { ...start, major: "경제" }), { section: "한국", major: null, expanded: "한국-2" });
    assert.deepEqual(stateForHash(DAY, "한국-1", { ...start, major: "경제" }), { section: "한국", major: "경제", expanded: "한국-1" });
  });
  test("짧은 소식 키는 섹션만 고르고 펼치지 않는다. 없는 키와 빈 키는 접는다", () => {
    assert.deepEqual(stateForHash(DAY, "한국-s2", { ...start, section: "세계" }), { section: "한국", major: null, expanded: null });
    assert.deepEqual(stateForHash(DAY, "없는-9", { ...start, expanded: "한국-1" }), { ...start, expanded: null });
    assert.deepEqual(stateForHash(DAY, null, { ...start, expanded: "한국-1" }), { ...start, expanded: null });
    assert.equal(findStoryTarget(DAY, "한국-s1")?.kind, "short");
  });
  test("그날 없는 섹션을 고른 상태면 첫 섹션으로 맞춘다", () => {
    assert.equal(stateForHash(DAY, null, { ...start, section: "IT·AI" }).section, "한국");
  });
});

describe("4.2-4·4.4-3 출처와 이미지", () => {
  const src = (name: string, over: Partial<SiteSource> = {}): SiteSource => ({ name, url: `https://news.example.com/${name}`, publishedAt: "2026-10-27", ...over });
  test("대표 출처를 앞에 두고, 이미지는 대표 출처의 것을 먼저 쓴다", () => {
    const sources = [src("가"), src("나", { primary: true }), src("다", { imageUrl: "https://img.example.com/c.jpg" })];
    assert.deepEqual(orderSources(sources).map((s) => s.name), ["나", "가", "다"]);
    assert.equal(storyImage(sources), "https://img.example.com/c.jpg");
    assert.equal(storyImage([src("가", { imageUrl: "https://img.example.com/a.jpg" }), src("나", { primary: true, imageUrl: "https://img.example.com/b.jpg" })]), "https://img.example.com/b.jpg");
    assert.equal(storyImage([src("가")]), null);
  });
});

describe("4.3-1 이슈 목록", () => {
  const it = (id: number, latestDate: string | null, major: IssueListItem["category"]["major"], status: IssueListItem["status"]): IssueListItem => ({
    id,
    name: `가짜 이슈 ${id}`,
    category: { major, minor: "기타" },
    status,
    startDate: latestDate,
    latestDate,
    count: 1,
  });
  const issues = [it(1, "2026-10-20", "경제", "종료"), it(2, "2026-10-27", "정치", "진행 중"), it(3, "2026-10-27", "경제", "진행 중"), it(4, null, "경제", "진행 중")];
  test("최근 업데이트일 순(같으면 나중 식별자 먼저, 날짜 없으면 뒤)", () => {
    assert.deepEqual(sortIssues(issues).map((i) => i.id), [3, 2, 1, 4]);
  });
  test("대분류와 상태로 거른다", () => {
    assert.deepEqual(filterIssues(issues, "경제", null).map((i) => i.id), [3, 1, 4]);
    assert.deepEqual(filterIssues(issues, "경제", "종료").map((i) => i.id), [1]);
    assert.deepEqual(filterIssues(issues, null, "진행 중").map((i) => i.id), [3, 2, 4]);
    assert.deepEqual(filterIssues(issues, "IT·AI", null), []);
  });
});

describe("4.3-3 검색 결과 되찾기", () => {
  const detail = (key: string, body: string): StoryDetail => ({
    key,
    summary: "가짜 요약",
    whyItMatters: body,
    background: "가짜 배경",
    keyFacts: ["가짜 사실"],
    outlook: "가짜 전망",
    confidence: "보도에 따르면",
    sources: [],
    extras: [],
    previous: [],
  });
  test("검색어 낱말은 글 낱말의 앞부분과 맞는다(조사가 붙어도 찾는다)", () => {
    assert.deepEqual(queryTerms("반도체  수출 반도체"), ["반도체", "수출"]);
    assert.equal(countMatches("반도체가 수출을 끌어올렸다", ["반도체"]), 1);
    assert.equal(countMatches("반도체가 수출을 끌어올렸다", ["반도체", "수출"]), 2);
    assert.equal(countMatches("가짜반도체", ["반도체"]), 0, "낱말 중간은 맞지 않는다");
    assert.equal(countMatches("AI 모델", ["ai"]), 1, "대소문자를 가리지 않는다");
  });
  test("날짜 레코드에서 검색어에 맞는 뉴스만 고른다(본문 포함, 섹션·주요 뉴스 순)", () => {
    const got = matchDayStories(DAY, { "한국-2": detail("한국-2", "반도체에 기대는 공약이다") }, queryTerms("반도체"));
    assert.deepEqual(got.map((s) => s.key), ["한국-1", "한국-2", "한국-s1"]);
    assert.deepEqual(matchDayStories(DAY, undefined, queryTerms("휴전")).map((s) => s.key), ["세계-1"]);
  });
  test("모든 낱말이 맞는 뉴스가 있으면 그것만, 없으면 가장 많이 맞는 것", () => {
    assert.deepEqual(matchDayStories(DAY, undefined, queryTerms("반도체 수출")).map((s) => s.key), ["한국-1"]);
    assert.deepEqual(matchDayStories(DAY, undefined, queryTerms("휴전 선거")).map((s) => s.key), ["한국-2", "세계-1"]);
    assert.deepEqual(matchDayStories(DAY, undefined, queryTerms("없는낱말")), []);
  });
  test("이슈 묶음에서 이름·별칭·요약으로 고르고 흡수된 이슈는 뺀다", () => {
    const iss = (id: number, name: string, aliases: string[], summary: string, latestDate: string): IssueDetail => ({
      id,
      name,
      category: { major: "IT·AI", minor: "반도체·하드웨어" },
      status: "진행 중",
      startDate: latestDate,
      latestDate,
      count: 1,
      aliases,
      summary,
      timeline: [],
      related: [],
    });
    const chunk: IssueChunk = {
      issues: {
        "101": iss(101, "가짜전자 칩 경쟁", ["가짜칩전쟁"], "가짜 요약", "2026-10-20"),
        "102": iss(102, "가짜 금리 흐름", [], "반도체가 버팀목이다", "2026-10-27"),
        "103": iss(103, "옛 가짜칩전쟁", [], "흡수됨", "2026-10-01"),
      },
    };
    assert.deepEqual(matchIssues(chunk, queryTerms("가짜칩"), { "103": {} }).map((i) => i.id), [101]);
    assert.deepEqual(matchIssues(chunk, queryTerms("반도체")).map((i) => i.id), [102]);
  });
  test("레코드 정보(meta, 없으면 주소)를 읽는다", () => {
    assert.deepEqual(parseHit("/2026-10-27", { kind: "news", date: "2026-10-27" }), { kind: "news", date: "2026-10-27" });
    assert.deepEqual(parseHit("/issues/chunk/3", { kind: "issues", chunk: "3" }), { kind: "issues", chunk: 3 });
    assert.deepEqual(parseHit("/issues/chunk/0", {}), { kind: "issues", chunk: 0 });
    assert.deepEqual(parseHit("/2026-10-26", undefined), { kind: "news", date: "2026-10-26" });
    assert.equal(parseHit("/about", {}), null);
  });
});

describe("4.6-4 방문 통계", () => {
  test("운영 주소에서만 켠다", () => {
    assert.equal(analyticsEnabled("tidwyn.vercel.app"), true);
    for (const h of ["localhost", "127.0.0.1", "tidwyn-abc-mivomad33.vercel.app", "example.com"]) assert.equal(analyticsEnabled(h), false, h);
  });
  test("검색어(q)를 주소에서 뺀다", () => {
    assert.equal(stripSearchQuery("https://tidwyn.vercel.app/search?q=%EB%B0%98%EB%8F%84%EC%B2%B4"), "https://tidwyn.vercel.app/search");
    assert.equal(stripSearchQuery("https://tidwyn.vercel.app/search?x=1&q=a"), "https://tidwyn.vercel.app/search?x=1");
    assert.equal(stripSearchQuery("https://tidwyn.vercel.app/2026-10-27"), "https://tidwyn.vercel.app/2026-10-27");
  });
});

describe("4.3-6 화면 공통", () => {
  test("글자 색 대비가 라이트·다크 모두 WCAG AA(4.5:1) 이상이다", () => {
    for (const [name, p] of [["라이트", LIGHT], ["다크", DARK]] as const) {
      for (const pair of textPairs(p)) {
        const c = contrast(pair.fg, pair.bg);
        assert.ok(c >= 4.5, `${name} ${pair.name} ${pair.fg}/${pair.bg} = ${c.toFixed(2)}`);
      }
    }
  });
  test("날짜는 대상일 문자열 그대로 쓴다(시간대 영향 없음)", () => {
    assert.equal(monthDayWeekday("2026-10-27"), "10월 27일 (화)");
    assert.equal(monthDayWeekday("2026-11-01"), "11월 1일 (일)");
    assert.equal(shortDate("2026-10-21", "2026"), "10-21");
    assert.equal(shortDate("2025-12-30", "2026"), "2025-12-30");
    assert.deepEqual(groupDatesByMonth(["2026-11-01", "2026-10-27", "2026-10-26"]), [
      { month: "2026-11", dates: ["2026-11-01"] },
      { month: "2026-10", dates: ["2026-10-27", "2026-10-26"] },
    ]);
    assert.equal(pageTitle("날짜 목록"), "날짜 목록 · Tidwyn");
  });
});

describe("사이트 데이터 주소와 호스팅 설정", () => {
  test("화면이 부르는 파일 이름이 사이트 데이터 약속(siteFiles)과 같다", () => {
    assert.equal(dataUrl.dates(), `/site-data/${siteFiles.dates}`);
    assert.equal(dataUrl.list("2026-10"), `/site-data/${siteFiles.list("2026-10")}`);
    assert.equal(dataUrl.detail("2026-10"), `/site-data/${siteFiles.detail("2026-10")}`);
    assert.equal(dataUrl.issueList(), `/site-data/${siteFiles.issueList}`);
    assert.equal(dataUrl.issueChunk(3), `/site-data/${siteFiles.issueChunk(3)}`);
    assert.equal(ISSUE_CHUNK, ISSUE_CHUNK_SIZE);
    for (const id of [0, 99, 100, 12345]) assert.equal(chunkOf(id), issueChunkOf(id));
  });
  test("4.3-3 주소 규칙: 파일, 확장자 없는 주소, 앱 전용 주소, 그 밖은 404", () => {
    const files = new Set(["index.html", "2026-10-27.html", "dates.html", "issues.html", "issues/3.html", "about.html", "app.html", "404.html", "site-data/dates.json", "assets/index-abc.js", "pagefind/pagefind.js", HOSTING_CONFIG_FILE]);
    const exists = (p: string) => files.has(p);
    const file = (path: string) => ({ kind: "file", path });
    const missing = { kind: "notFound", path: "404.html" };
    assert.deepEqual(resolveStatic("/", exists), file("index.html"));
    for (const p of ["/2026-10-27", "/dates", "/issues", "/issues/3", "/about"]) assert.deepEqual(resolveStatic(p, exists), file(`${p.slice(1)}.html`), p);
    assert.deepEqual(resolveStatic("/about/", exists), file("about.html"), "끝의 /는 같은 페이지다");
    for (const p of ["/search", "/terms/7", "/schedules/7"]) assert.deepEqual(resolveStatic(p, exists), file("app.html"), p);
    assert.deepEqual(resolveStatic("/site-data/dates.json", exists), file("site-data/dates.json"));
    for (const p of ["/nope", "/2026-02-30", "/issues/99", "/terms/x", "/site-data/list-1999-01.json", "/pagefind/x.pf_fragment", "/assets/nope.js", "/../package.json", `/${HOSTING_CONFIG_FILE}`]) assert.deepEqual(resolveStatic(p, exists), missing, p);
  });
  test("4.3-5 vercel.json: 확장자 없는 주소, 앱 전용 주소, 수집 제외 헤더", () => {
    const cfg = vercelConfig() as { cleanUrls: boolean; trailingSlash: boolean; rewrites: { source: string; destination: string }[]; headers: { source: string; headers: { key: string; value: string }[] }[] };
    assert.equal(cfg.cleanUrls, true);
    assert.equal(cfg.trailingSlash, false);
    assert.deepEqual(cfg.rewrites.map((r) => r.destination), ["/app", "/app", "/app"]);
    assert.deepEqual(cfg.rewrites.map((r) => r.source), ["/search", "/terms/:id(\\d+)", "/schedules/:id(\\d+)"]);
    assert.equal(cfg.headers.length, 2);
    for (const rule of cfg.headers) {
      assert.deepEqual(rule.headers, [{ key: "X-Robots-Tag", value: "noindex" }]);
      // Vercel source는 path-to-regexp이고 괄호 안은 정규식이다. 같은 정규식으로 판정해 본다
      const re = new RegExp(`^${rule.source}$`);
      for (const p of ["/", "/2026-10-27", "/issues", "/issues/3", "/about", "/site-dataX", "/pagefindX/a"]) assert.ok(!re.test(p), `${rule.source}: ${p}`);
    }
    assert.ok(new RegExp(`^${cfg.headers[0]!.source}$`).test("/site-data/dates.json"));
    assert.ok(new RegExp(`^${cfg.headers[1]!.source}$`).test("/pagefind/pagefind.js"));
  });
});
