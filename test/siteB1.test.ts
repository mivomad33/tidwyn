import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { REPO_FEED_REPO_URL } from "../site/src/components/aboutView.ts";
import { REPO_FAILED_TEXT, REPO_HEADING, REPO_NONE_TEXT } from "../site/src/components/repoView.ts";
import { ALL_TAB, BUILDER_TAB, briefTabs, parseBriefTab, sectionView, stateForHash } from "../site/src/lib/brief.ts";
import { BROWSER_KEYS, BRIEF_TAB_KEY } from "../site/src/lib/browserKeys.ts";
import { fullKoreanDate } from "../site/src/lib/format.ts";
import { PRIVACY_UPDATED } from "../site/src/lib/policy.ts";
import { matchRepos, parseHit, queryTerms } from "../site/src/lib/search.ts";
import { pageFile } from "../src/publicSite.ts";
import type { DayList, MonthList } from "../src/siteTypes.ts";
import { cleanupTemp, searchOutput, tempDir } from "./helpers.ts";

// B1 4.4 사이트(빌더 탭): 탭 로직(4.4-1), 정적 HTML·RSS·사이트맵(4.4-3), 검색 색인(4.4-3), 소개·처리방침(4.4-4).
// 지어낸 데이터(site/dev/fixtures.ts의 repos)로 빌드한다. 값은 모두 지어낸 것이다.

after(cleanupTemp);

/** HTML 숫자 참조와 엔터티를 글자로 되돌린다 */
function decode(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** 태그를 지운 보이는 글 */
function textOf(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

let work: string;
let dataDir: string;
let out: string;
let fx: Fixture;
let days: Map<string, DayList>;

before(async () => {
  work = tempDir("tidwyn-b1site-");
  dataDir = path.join(work, "data");
  out = path.join(work, "out");
  fx = writeFixtures(dataDir, { days: 7, repos: true });
  await buildSite({ dataDir, outDir: out });
  days = new Map();
  for (const name of fs.readdirSync(path.join(out, "site-data")).filter((n) => /^list-\d{4}-\d{2}\.json$/.test(n))) {
    for (const d of (JSON.parse(fs.readFileSync(path.join(out, "site-data", name), "utf8")) as MonthList).days) days.set(d.date, d);
  }
});

const info = () => fx.info.repos!;
const day = (date: string | null) => days.get(date!)!;
const html = (date: string | null) => fs.readFileSync(path.join(out, pageFile(`/${date}`)), "utf8");

describe("B1 4.4-1 탭 목록과 탭 값(DOM 없는 로직)", () => {
  test("지어낸 데이터: 실음·새로 오른 것 없음·받지 못함·기록 없는 날이 있다", () => {
    const i = info();
    assert.equal(day(i.shown).repos?.status, "shown");
    assert.ok(day(i.shown).repos!.items.length >= 2);
    assert.equal(day(i.none).repos?.status, "none");
    assert.equal(day(i.failed).repos?.status, "failed");
    assert.equal(day(i.absent).repos, undefined);
  });

  test("빌더 탭은 기록이 있는 날에만 뉴스 탭 뒤 끝에 있고, 건수 없이 '빌더'다", () => {
    const i = info();
    for (const d of [i.shown, i.none, i.failed]) assert.deepEqual(briefTabs(day(d)), [ALL_TAB, "한국", "세계", "IT·AI", BUILDER_TAB], d!);
    assert.deepEqual(briefTabs(day(i.absent)), [ALL_TAB, "한국", "세계", "IT·AI"]);
  });

  test("'전체' 탭에 저장소가 섞이지 않고 빌더 탭에는 뉴스가 없다", () => {
    const d = day(info().shown);
    const all = sectionView(d, ALL_TAB, null);
    const news = d.sections.flatMap((s) => s.stories).length;
    assert.equal(all.top.length + all.short.length, news);
    const b = sectionView(d, BUILDER_TAB, null);
    assert.equal(b.top.length + b.short.length, 0);
  });

  test("저장한 탭 값 '빌더'를 읽고, #builder는 그날 빌더 탭을 열며 기록이 없는 날은 첫 섹션 탭으로 간다", () => {
    const i = info();
    assert.equal(parseBriefTab(BUILDER_TAB), BUILDER_TAB);
    assert.equal(parseBriefTab("영상"), "한국", "지운 탭의 옛 값은 그대로 기본 탭");
    const base = { section: "세계" as const, major: null, expanded: null };
    assert.equal(stateForHash(day(i.shown), "builder", base).section, BUILDER_TAB);
    assert.equal(stateForHash(day(i.absent), "builder", base).section, "세계", "기록 없는 날의 #builder는 지금 탭 그대로");
    const onBuilder = { section: BUILDER_TAB, major: null, expanded: null } as const;
    assert.equal(stateForHash(day(i.none), null, onBuilder).section, BUILDER_TAB);
    assert.equal(stateForHash(day(i.absent), null, onBuilder).section, "한국", "빌더 기록 없는 날은 그날 첫 섹션 탭(전체가 아니다)");
    // 빌더 탭에서 뉴스 키 주소로 오면 그 뉴스의 탭으로 간다
    const story = day(i.shown).sections[1]!.stories.find((s) => s.kind === "top")!;
    assert.deepEqual(stateForHash(day(i.shown), story.key, onBuilder), { section: story.section, major: null, expanded: story.key });
  });

  test("날짜 목록의 뉴스 수(storyCounts)에 저장소가 섞이지 않는다", () => {
    const dates = JSON.parse(fs.readFileSync(path.join(out, "site-data", "dates.json"), "utf8")) as { dates: string[]; storyCounts: number[] };
    for (const [k, date] of dates.dates.entries()) assert.equal(dates.storyCounts[k], day(date).sections.flatMap((s) => s.stories).length, date);
  });
});

describe("B1 4.4-3 정적 HTML, RSS, 사이트맵", () => {
  test("실음인 날의 정적 HTML에 빌더 구역(이름·링크·순위·설명, 순위 순)과 구역 이동 칩이 있다", () => {
    const d = day(info().shown);
    const page = html(d.date);
    const text = textOf(page);
    assert.match(page, /<h2 class="h list-h" id="builder">빌더<\/h2>/);
    const jump = /<nav class="rel static-jump" aria-label="구역으로 가기">(.*?)<\/nav>/s.exec(page);
    assert.deepEqual([...jump![1]!.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]).at(-1), ["#builder", "빌더"]);
    assert.ok(page.includes(`<h3 class="repo-head">${REPO_HEADING}</h3>`));
    // 항목 이름은 목록 제목보다 한 단계 아래다(코드 리뷰 지적)
    assert.ok(page.includes(`<h4 class="repo-name">`) && !page.includes(`<h3 class="repo-name">`));
    const sorted = [...d.repos!.items].sort((a, b) => a.rank - b.rank);
    let at = 0;
    for (const item of sorted) {
      assert.ok(page.includes(`href="${item.url}" class="repo-link" target="_blank" rel="noopener noreferrer"`), item.name);
      const pos = text.indexOf(`${item.name.replace("/", " / ")} (새 탭) 주간 ${item.rank}위 ${item.description}`);
      assert.ok(pos > at, `${item.name}이(가) 순위 순서로 이름·순위·설명을 보인다`);
      at = pos;
    }
  });

  test("새로 오른 것 없음·받지 못함인 날은 빌더 구역에 빈 상태 문구가 있다", () => {
    for (const [date, want] of [[info().none, REPO_NONE_TEXT], [info().failed, REPO_FAILED_TEXT]] as const) {
      const page = html(date);
      assert.match(page, /id="builder"/, date!);
      assert.ok(page.includes(`<p class="state empty">${want}</p>`), date!);
    }
  });

  test("기록이 없는 날의 정적 HTML에는 빌더 구역과 '빌더' 칩이 없다", () => {
    const page = html(info().absent);
    assert.ok(!page.includes('id="builder"'));
    assert.ok(!textOf(page).includes(BUILDER_TAB));
  });

  test("RSS(rss.xml)와 사이트맵에는 저장소 이름·설명·빌더 구역이 없다", () => {
    const items = day(info().shown).repos!.items;
    const feeds = listFilesRecursive(out).filter((f) => f === "rss.xml" || /^sitemap.*\.xml$/.test(f));
    assert.ok(feeds.includes("rss.xml") && feeds.some((f) => f.startsWith("sitemap")), feeds.join(", "));
    for (const f of feeds) {
      const text = decode(fs.readFileSync(path.join(out, f), "utf8"));
      for (const item of items) {
        assert.ok(!text.includes(item.name) && !text.includes(item.description.slice(0, 20)), `${f}: ${item.name}`);
      }
      assert.ok(!text.includes(BUILDER_TAB) && !text.includes("/builder") && !text.includes("#builder"), f);
    }
  });
});

describe("B1 4.4-3 검색", () => {
  test("저장소 이름 낱말과 설명 낱말로 찾고, 결과는 그 날짜의 저장소로 되찾는다(실음이 아닌 날은 레코드가 없다)", async () => {
    const d = day(info().shown);
    const records = JSON.parse(fs.readFileSync(path.join(dataDir, "search-records.json"), "utf8")) as { meta?: { kind?: string; date?: string } }[];
    assert.deepEqual(records.filter((r) => r.meta?.kind === "repos").map((r) => r.meta?.date), [d.date], "실음인 날만 레코드가 있다");
    const queries = ["quillnote", "가짜깃발도구", "lanternkit"];
    const hits = await searchOutput(out, queries);
    for (const [q, want] of [["quillnote", "fakeorg/quillnote-desk"], ["가짜깃발도구", d.repos!.items.find((i) => i.description.startsWith("가짜깃발도구"))!.name], ["lanternkit", "demo-co/lanternkit"]] as const) {
      const parsed = hits.get(q)!.map((h) => parseHit(h.url, h.meta)).filter((h) => h?.kind === "repos");
      assert.deepEqual(parsed, [{ kind: "repos", date: d.date }], q);
      assert.deepEqual(matchRepos(d, queryTerms(q)).map((i) => i.name), [want], q);
    }
  });
});

describe("B1 4.4-4 소개·처리방침", () => {
  const page = (name: string) => fs.readFileSync(path.join(out, name), "utf8");

  test("소개에 빌더 탭 안내(출처 피드와 링크, 다시 싣지 않음, AI가 쓴 설명이라 추천·보증이 아님)가 있다", () => {
    const about = page("about.html");
    const text = textOf(about);
    assert.match(text, /빌더 탭 빌더 탭은 GitHub 주간 트렌딩에 새로 오른 저장소를/);
    assert.match(text, /GitHub 트렌딩 페이지를 옮긴 공개 피드\( mshibanami\/GitHubTrendingRSS ↗ \(새 탭\) \)에서 받습니다/);
    assert.ok(about.includes(`href="${REPO_FEED_REPO_URL}" class="text-link" target="_blank" rel="noopener noreferrer"`));
    assert.equal(REPO_FEED_REPO_URL, "https://github.com/mshibanami/GitHubTrendingRSS");
    assert.match(text, /한 번 실린 저장소는 다시 싣지 않습니다/);
    assert.match(text, /저장소 설명은 AI가 README를 읽고 쓴 글이라 틀릴 수 있습니다\. 저장소를 추천하거나 안전성·품질을 보증하는 것이 아니니/);
  });

  test("처리방침의 탭 저장값 설명에 '빌더'가 있고 바뀐 날짜가 2026-11-25다", () => {
    assert.equal(PRIVACY_UPDATED, "2026-11-25");
    assert.equal(BROWSER_KEYS.find((k) => k.key === BRIEF_TAB_KEY)!.what, "브리프에서 마지막으로 고른 탭(전체·한국·세계·IT·AI·빌더)");
    const text = textOf(page("privacy.html"));
    assert.ok(text.includes("브리프에서 마지막으로 고른 탭(전체·한국·세계·IT·AI·빌더)"), "처리방침 목록");
    assert.ok(text.includes(`바뀐 날짜: ${fullKoreanDate("2026-11-25")}`), "바뀐 날짜");
  });
});
