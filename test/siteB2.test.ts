import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { VIDEO_FAILED_TEXT, VIDEO_HEADING, VIDEO_NONE_TEXT, byDailyViews, durationText, uploadText, viewsText } from "../site/src/components/videoView.ts";
import { ALL_TAB, BUILDER_TAB, VIDEO_TAB, briefTabs, parseBriefTab, sectionView, stateForHash } from "../site/src/lib/brief.ts";
import { BROWSER_KEYS, BRIEF_TAB_KEY } from "../site/src/lib/browserKeys.ts";
import { dateText, fullKoreanDate } from "../site/src/lib/format.ts";
import { PRIVACY_UPDATED } from "../site/src/lib/policy.ts";
import { matchVideos, parseHit, queryTerms } from "../site/src/lib/search.ts";
import { kstDate } from "../src/kst.ts";
import { pageFile } from "../src/publicSite.ts";
import { videoPartOf, type DayList, type DayVideos, type MonthList, type VideoPartFile } from "../src/siteTypes.ts";
import { cleanupTemp, searchOutput, tempDir } from "./helpers.ts";

// B2 4.3 사이트(영상 탭): 탭 로직(4.3-1), 표기와 썸네일 주소(4.3-2), 정적 HTML·RSS·사이트맵·검색(4.3-3), 소개·처리방침(4.3-4).
// 지어낸 데이터(site/dev/fixtures.ts의 videos)로 빌드한다. 값은 모두 지어낸 것이다.

after(cleanupTemp);

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

function textOf(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
}

/** 개발용으로 썸네일 주소를 바꿀 법한 환경 변수 이름(운영 코드에는 이런 선택지가 없다. 주어도 결과물이 같은지 본다) */
const DEV_THUMB_ENV = ["TIDWYN_THUMB_BASE", "VITE_THUMB_BASE", "THUMB_BASE"];

let dataDir: string;
let out: string;
let fx: Fixture;
let days: Map<string, DayList>;

before(async () => {
  const work = tempDir("tidwyn-b2site-");
  dataDir = path.join(work, "data");
  out = path.join(work, "out");
  fx = writeFixtures(dataDir, { days: 7, repos: true, videos: true });
  const saved = DEV_THUMB_ENV.map((k) => [k, process.env[k]] as const);
  for (const k of DEV_THUMB_ENV) process.env[k] = "http://127.0.0.1:9/thumbs";
  try {
    await buildSite({ dataDir, outDir: out });
  } finally {
    for (const [k, v] of saved) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  days = new Map();
  for (const name of fs.readdirSync(path.join(out, "site-data")).filter((n) => /^list-\d{4}-\d{2}\.json$/.test(n))) {
    for (const d of (JSON.parse(fs.readFileSync(path.join(out, "site-data", name), "utf8")) as MonthList).days) days.set(d.date, d);
  }
});

const info = () => fx.info.videos!;
const day = (date: string | null) => days.get(date!)!;
const videosOf = (date: string | null): DayVideos => (JSON.parse(fs.readFileSync(path.join(out, "site-data", `watch-${videoPartOf(date!)}.json`), "utf8")) as VideoPartFile).days[date!]!;
const html = (date: string | null) => fs.readFileSync(path.join(out, pageFile(`/${date}`)), "utf8");

describe("B2 4.3-1 탭 목록과 탭 값(DOM 없는 로직)", () => {
  test("탭 순서는 전체 → 뉴스 → 영상 → 빌더이고, 영상 탭은 기록이 있는 날에만 건수 없이 '영상'이다", () => {
    const i = info();
    for (const d of [i.shown, i.none, i.failed]) assert.deepEqual(briefTabs(day(d)), [ALL_TAB, "한국", "세계", "IT·AI", VIDEO_TAB, BUILDER_TAB], d!);
    assert.deepEqual(briefTabs(day(i.only)), [ALL_TAB, "한국", "세계", "IT·AI", VIDEO_TAB]);
    assert.deepEqual(briefTabs(day(i.absent)), [ALL_TAB, "한국", "세계", "IT·AI"]);
  });

  test("'전체' 탭에 영상이 섞이지 않고 영상 탭에는 뉴스가 없으며, 날짜 목록 뉴스 수에 영상이 섞이지 않는다", () => {
    const d = day(info().shown);
    const all = sectionView(d, ALL_TAB, null);
    assert.equal(all.top.length + all.short.length, d.sections.flatMap((s) => s.stories).length);
    assert.deepEqual(sectionView(d, VIDEO_TAB, null), { section: null, top: [], short: [] });
    const dates = JSON.parse(fs.readFileSync(path.join(out, "site-data", "dates.json"), "utf8")) as { dates: string[]; storyCounts: number[] };
    assert.equal(dates.storyCounts[dates.dates.indexOf(d.date)], d.sections.flatMap((s) => s.stories).length);
  });

  test("저장한 탭 값 '영상'을 읽고, #videos는 그날 영상 탭을 열며 기록이 없는 날은 첫 섹션 탭으로 간다", () => {
    assert.equal(parseBriefTab("영상"), VIDEO_TAB);
    const base = { section: "한국" as const, major: null, expanded: null };
    assert.equal(stateForHash(day(info().shown), "videos", base).section, VIDEO_TAB);
    assert.equal(stateForHash(day(info().absent), "videos", base).section, "한국");
    assert.equal(stateForHash(day(info().absent), null, { ...base, section: VIDEO_TAB }).section, "한국");
    assert.equal(stateForHash(day(info().only), null, { ...base, section: VIDEO_TAB }).section, VIDEO_TAB);
  });

  test("달 목록 파일에는 상태와 실은 수만 있고 항목은 반달 영상 파일에 있다", () => {
    const i = info();
    assert.deepEqual(day(i.shown).videos, { status: "shown", count: videosOf(i.shown).items.length });
    assert.deepEqual(day(i.none).videos, { status: "none", count: 0 });
    assert.deepEqual(day(i.failed).videos, { status: "failed", count: 0 });
    assert.equal(day(i.absent).videos, undefined);
    const list = fs.readFileSync(path.join(out, "site-data", `list-${i.shown!.slice(0, 7)}.json`), "utf8");
    for (const v of videosOf(i.shown).items) assert.ok(!list.includes(v.title), v.title);
  });
});

describe("B2 4.3-2 표기와 썸네일 주소", () => {
  test("조회수는 '조회수' 글 없이 그대로·만·억으로, 길이는 분:초·시:분:초로 쓴다", () => {
    assert.equal(viewsText(5432), "5,432회");
    assert.equal(viewsText(12_000), "1.2만회");
    assert.equal(viewsText(1_234_567), "123만회");
    assert.equal(viewsText(234_567_890), "2.3억회");
    assert.equal(durationText(754), "12:34");
    assert.equal(durationText(3725), "1:02:05");
    assert.equal(durationText(59), "0:59");
  });

  test("업로드 때는 보는 시각 기준 N분·N시간·N일 전이고, 원천 정밀도보다 잘게 쓰지 않으며, 7일을 넘으면 날짜다", () => {
    const now = Date.parse("2026-10-28T00:00:00Z");
    const ago = (ms: number) => new Date(now - ms).toISOString();
    const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
    assert.equal(uploadText(ago(5 * MIN), 60, now), "5분 전");
    assert.equal(uploadText(ago(10_000), 60, now), "1분 전");
    assert.equal(uploadText(ago(5 * MIN), 3600, now), "1시간 전");
    assert.equal(uploadText(ago(5 * HOUR), 3600, now), "5시간 전");
    assert.equal(uploadText(ago(5 * HOUR), 86400, now), "1일 전");
    assert.equal(uploadText(ago(3 * DAY + HOUR), 86400, now), "3일 전");
    assert.equal(uploadText(ago(7 * DAY), 86400, now), "7일 전");
    assert.equal(uploadText(ago(7 * DAY + HOUR), 86400, now), dateText(kstDate(new Date(now - 7 * DAY - HOUR))));
    // 보는 해와 다른 해에 올라온 영상은 해를 붙인다(C9)
    assert.equal(uploadText("2026-12-28T03:00:00Z", 86400, Date.parse("2027-01-10T00:00:00Z")), "2026년 12월 28일");
    assert.equal(uploadText("2026-10-01T03:00:00Z", 86400, now), "10월 1일");
  });

  test("'모든 분야'는 분야를 섞어 하루 평균 조회수 순이고, 같으면 받은 순서(분야 순서·순위) 그대로다", () => {
    const item = (id: string, category: string, rank: number, dailyViews: number) => ({ id, category, rank, dailyViews, title: id, channel: "c", duration: 1, views: 1, uploadAt: "2026-10-25T00:00:00.000Z", uploadPrecision: 86400 });
    const items = [item("a1", "교양/지식", 1, 500), item("a2", "교양/지식", 2, 100), item("b1", "경제", 1, 900), item("b2", "경제", 2, 100)];
    assert.deepEqual(byDailyViews(items).map((i) => i.id), ["b1", "a1", "a2", "b2"]);
  });

  test("개발용 썸네일 환경 변수를 준 채 운영 빌드를 해도 번들의 썸네일 주소는 고정 주소뿐이다", () => {
    const js = listFilesRecursive(out)
      .filter((f) => /^assets[\\/].*\.js$/.test(f))
      .map((f) => fs.readFileSync(path.join(out, f), "utf8"))
      .join("\n");
    assert.ok(js.includes("https://i.ytimg.com/vi/") && js.includes("/mqdefault.jpg"), "고정 썸네일 주소가 번들에 있다");
    assert.ok(!js.includes("127.0.0.1:9") && !/THUMB_BASE/.test(js), "개발용 주소나 선택지가 번들에 없다");
  });
});

describe("B2 4.3-3 정적 HTML, RSS, 사이트맵", () => {
  test("실음인 날의 정적 HTML에 영상 구역(분야별 제목, 링크, 채널, 조회수, 길이)과 구역 이동 칩(빌더 앞)이 있고 이미지는 없다", () => {
    const d = info().shown;
    const page = html(d);
    const text = textOf(page);
    assert.match(page, /<h2 class="h list-h" id="videos">영상<\/h2>/);
    const jump = /<nav class="rel static-jump" aria-label="구역으로 가기">(.*?)<\/nav>/s.exec(page);
    assert.deepEqual([...jump![1]!.matchAll(/<a href="([^"]*)">([^<]*)<\/a>/g)].map((m) => m[2]).slice(-2), [VIDEO_TAB, BUILDER_TAB]);
    assert.ok(page.includes(`<h3 class="repo-head">${VIDEO_HEADING}</h3>`));
    const items = videosOf(d).items;
    for (const cat of new Set(items.map((i) => i.category))) assert.ok(page.includes(`<h4 class="h list-h video-cat">${cat}</h4>`), cat);
    let at = 0;
    for (const item of items) {
      assert.ok(page.includes(`href="https://www.youtube.com/watch?v=${item.id}"`), item.id);
      const pos = text.indexOf(`${item.title} (새 탭) ${item.channel} · ${viewsText(item.views)} · ${durationText(item.duration)}`.replace(/\s+/g, " "));
      assert.ok(pos > at, `${item.id}이(가) 순서대로 제목·채널·조회수·길이를 보인다`);
      at = pos;
    }
    assert.ok(!/<img\b/.test(page.slice(page.indexOf('id="videos"'))), "정적 HTML 영상 구역에 이미지가 없다");
  });

  test("새 영상 없음·받지 못함인 날은 영상 구역에 빈 상태 문구가 있고, 기록이 없는 날은 구역과 칩이 없다", () => {
    for (const [date, want] of [[info().none, VIDEO_NONE_TEXT], [info().failed, VIDEO_FAILED_TEXT]] as const) {
      const page = html(date);
      assert.match(page, /id="videos"/, date!);
      assert.ok(page.includes(`<p class="state empty">${want}</p>`), date!);
    }
    const page = html(info().absent);
    assert.ok(!page.includes('id="videos"'));
    assert.ok(!textOf(page).includes(VIDEO_TAB));
  });

  test("RSS(rss.xml)와 사이트맵에는 영상 제목·채널·영상 구역이 없다", () => {
    const items = videosOf(info().shown).items;
    const feeds = listFilesRecursive(out).filter((f) => f === "rss.xml" || /^sitemap.*\.xml$/.test(f));
    assert.ok(feeds.includes("rss.xml") && feeds.some((f) => f.startsWith("sitemap")), feeds.join(", "));
    for (const f of feeds) {
      const text = decode(fs.readFileSync(path.join(out, f), "utf8"));
      for (const item of items) assert.ok(!text.includes(item.title) && !text.includes(item.channel), `${f}: ${item.id}`);
      assert.ok(!text.includes("/watch") && !text.includes("#videos"), f);
    }
  });
});

describe("B2 4.3-3 검색", () => {
  test("영상 제목 낱말과 채널 낱말로 찾고, 결과는 그 날짜의 영상으로 되찾는다(실음이 아닌 날은 레코드가 없다)", async () => {
    const i = info();
    const records = JSON.parse(fs.readFileSync(path.join(dataDir, "search-records.json"), "utf8")) as { meta?: { kind?: string; date?: string } }[];
    assert.deepEqual(records.filter((r) => r.meta?.kind === "videos").map((r) => r.meta?.date).sort(), [i.only, i.shown].sort(), "실음인 날만 레코드가 있다");
    const shown = videosOf(i.shown);
    const queries = ["가짜과학교실", "가짜경제학교"];
    const hits = await searchOutput(out, queries);
    for (const [q, want] of [["가짜과학교실", "fakeVid0001"], ["가짜경제학교", "fakeVid0006"]] as const) {
      const parsed = hits.get(q)!.map((h) => parseHit(h.url, h.meta)).filter((h) => h?.kind === "videos");
      assert.deepEqual(parsed, [{ kind: "videos", date: i.shown }], q);
      assert.deepEqual(matchVideos(shown, queryTerms(q)).map((v) => v.id), [want], q);
    }
  });
});

describe("B2 4.3-4 소개·처리방침", () => {
  const page = (name: string) => fs.readFileSync(path.join(out, name), "utf8");

  test("소개에 영상 탭 안내(최근 일주일 한국어 영상, AI 판정, 하루 평균 조회수, 분야별 최대 10개, 다시 싣지 않음, 라이브 다시보기 뺌, 추천·보증 아님)가 있다", () => {
    const text = textOf(page("about.html"));
    for (const want of ["영상 탭", "최근 일주일", "한국어 영상", "AI가 판정", "하루 평균 조회수", "최대 10개", "한 번 실린 영상은 다시 싣지 않습니다", "다시보기는 뺍니다", "추천하거나", "보증하는 것이 아닙니다"]) {
      assert.ok(text.includes(want), want);
    }
  });

  test("처리방침에 썸네일 문구, 탭 저장값의 '영상', 바뀐 날짜 2026-11-26이 있다", () => {
    assert.equal(PRIVACY_UPDATED, "2026-11-26");
    assert.equal(BROWSER_KEYS.find((k) => k.key === BRIEF_TAB_KEY)!.what, "브리프에서 마지막으로 고른 탭(전체·한국·세계·IT·AI·영상·빌더)");
    const text = textOf(page("privacy.html"));
    assert.ok(text.includes("브리프에서 마지막으로 고른 탭(전체·한국·세계·IT·AI·영상·빌더)"), "처리방침 목록");
    assert.match(text, /영상 탭의 썸네일 이미지는 YouTube\(Google\)의 이미지 서버에서 바로 불러옵니다/);
    assert.match(text, /IP 주소 등 요청 정보가 그 서버에 전달됩니다/);
    assert.ok(text.includes(`바뀐 날짜: ${fullKoreanDate("2026-11-26")}`), "바뀐 날짜");
  });

  test("소개와 처리방침에 youtube-insight 낱말이 없다", () => {
    for (const name of ["about.html", "privacy.html"]) assert.ok(!/youtube-insight/i.test(page(name)), name);
  });
});
