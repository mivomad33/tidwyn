import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, mock, test } from "node:test";
import { buildBackup, restoreBackup } from "../src/backup.ts";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { createIssue, getIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { readKeys } from "../src/keys.ts";
import { applyMerges, unmerge } from "../src/merge.ts";
import { precheck } from "../src/precheck.ts";
import { createEntity, createTerm, linkEntity, linkTerm } from "../src/refs.ts";
import { readRun, writeRun, type RunState } from "../src/run.ts";
import { createSchedule } from "../src/schedules.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSiteData } from "../src/siteData.ts";
import type { DayList, IssueChunk, IssueDetail, MonthList } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { applyJudgment, upsertValues } from "../src/indicatorStore.ts";
import { VIDEO_WORK_FILES, buildCandidateFile, checkPickFile, renderCandidateDetails, renderCandidates, videoWorkFile, type CandidateFile } from "../src/videoPick.ts";
import { allVideos, applyVideoPick, isPicked, issueCandidates, purgeExpiredRows, recentVideoIds, type NewVideo } from "../src/videoStore.ts";
import {
  DEFAULT_LIMITS,
  SEARCH_FIELDS,
  SEARCH_TOPICS,
  YOUTUBE_BASE,
  YoutubeClient,
  fetchVideos,
  searchSpecs,
  type YoutubeHttp,
  type YoutubeResponse,
} from "../src/youtube.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

after(cleanupTemp);

// 7단계 추천 영상(4.1~4.6, 4.8). 영상 ID, 제목, 채널, 추천 이유, 이슈 이름, 키는 모두 지어낸 것이다. YouTube는 가짜 응답으로 바꾼다.

/** 가짜 키. Google API 키 모양(AIza…39자)이 아니게 한다(4.8-2) */
const FAKE_YT = "FAKE-YOUTUBE-KEY-0042";
const KEY_ENV = { YOUTUBE_API_KEY: FAKE_YT };
const TODAY = "2026-10-28"; // NOW의 KST 날짜

// ---- DB 준비 ----

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

function briefDb(dates: string[], file?: string): DatabaseSync {
  const f = file ?? path.join(tempDir(), "tidwyn.db");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const db = openDb(f);
  recordFirstCollectionDate(db, dates[0]!);
  for (const d of dates) addBrief(db, d);
  return db;
}

function issue(db: DatabaseSync, name: string, links: [string, string][] = []): number {
  const id = createIssue(db, { name, aliases: [], category: { major: "과학·건강", minor: "우주" }, summary: `${name}의 요약이다.` });
  for (const [date, key] of links) {
    const s = storiesOfDate(db, date).find((x) => x.key === key);
    assert.ok(s, `${date} ${key}`);
    linkStory(db, s.id, id, true);
  }
  return id;
}

function merge(db: DatabaseSync, survivor: number, absorbed: number): number {
  return applyMerges(db, [{ survivor, absorbed, reason: "같은 일", summary: "합친 가짜 요약이다." }], TODAY)[0]!;
}

function dumpDb(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));
}

function newVideo(videoId: string, bundle: NewVideo["bundle"], position: number, issues: number[] = []): NewVideo {
  return {
    videoId,
    bundle,
    sources: ["KR 차트 27"],
    title: `가짜 영상 제목 ${videoId}`,
    channel: `가짜 채널 ${videoId}`,
    seconds: 900,
    thumb: `https://i.example.com/vi/${videoId}/mqdefault.jpg`,
    publishedAt: "2026-10-27T01:00:00Z",
    reason: `가짜 추천 이유 ${videoId}`,
    position,
    issues,
  };
}

// ---- 가짜 YouTube ----

interface Item {
  id: string;
  seconds?: number;
  live?: "live" | "upcoming";
  liveRecord?: boolean;
  vertical?: boolean;
  title?: string;
  lang?: string;
}

function iso(seconds: number): string {
  return `PT${Math.floor(seconds / 3600)}H${Math.floor((seconds % 3600) / 60)}M${seconds % 60}S`;
}

function videoItem(x: Item): Record<string, unknown> {
  return {
    kind: "youtube#video",
    id: x.id,
    snippet: {
      title: x.title ?? `가짜 영상 ${x.id}`,
      channelTitle: `가짜 채널 ${x.id.slice(0, 4)}`,
      publishedAt: "2026-10-27T10:00:00Z",
      description: `지어낸 설명이다 ${x.id}. 이 영상은 실제로 없다.`,
      categoryId: "27",
      defaultAudioLanguage: x.lang ?? "ko",
      liveBroadcastContent: x.live ?? "none",
      thumbnails: { medium: { url: `https://i.example.com/vi/${x.id}/mqdefault.jpg`, width: 320, height: 180 } },
    },
    contentDetails: { duration: iso(x.seconds ?? 900) },
    ...(x.liveRecord || x.live ? { liveStreamingDetails: { actualStartTime: "2026-10-27T09:00:00Z" } } : {}),
    player: x.vertical ? { embedWidth: "562", embedHeight: "1000" } : { embedWidth: "1000", embedHeight: "563" },
  };
}

type Fail = YoutubeResponse | "timeout" | "network";

interface FakeConfig {
  /** 지역마다 카테고리 ID */
  categories?: Record<string, string[]>;
  /** `KR 1`, `KR all` → 페이지마다 영상 */
  charts?: Record<string, Item[][]>;
  /** 차트가 없다는 오류를 낼 차트 키 */
  notFound?: string[];
  /** 검색 결과(검색 주소의 파라미터로 고른다) */
  search?: (p: URLSearchParams) => Item[];
  /** 요청마다 실패를 정한다(n은 같은 주소의 몇 번째 요청인지) */
  fail?: (u: URL, n: number) => Fail | undefined;
}

interface FakeYoutube {
  http: YoutubeHttp;
  calls: { url: string; headers: Record<string, string> }[];
}

function apiError(status: number, reason: string): YoutubeResponse {
  return { status, body: JSON.stringify({ error: { code: status, message: "지어낸 오류 메시지", errors: [{ reason, domain: "youtube.parameter" }] } }) };
}

function fakeYoutube(cfg: FakeConfig = {}): FakeYoutube {
  const calls: FakeYoutube["calls"] = [];
  const catalog = new Map<string, Item>();
  for (const pages of Object.values(cfg.charts ?? {})) for (const p of pages) for (const x of p) catalog.set(x.id, x);
  const seen = new Map<string, number>();
  const http: YoutubeHttp = async (url, headers) => {
    calls.push({ url, headers });
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const u = new URL(url);
    const f = cfg.fail?.(u, n);
    if (f === "timeout") {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    if (f === "network") throw new TypeError(`fetch failed ${url}`);
    if (f !== undefined) return f;
    const p = u.searchParams;
    const name = u.pathname.split("/").at(-1);
    if (name === "videoCategories") {
      const ids = (cfg.categories ?? { KR: ["24"], US: ["24"] })[p.get("regionCode")!] ?? [];
      return { status: 200, body: JSON.stringify({ items: ids.map((id) => ({ id, snippet: { title: `가짜 카테고리 ${id}`, assignable: id !== "2" } })) }) };
    }
    if (name === "search") {
      const items = cfg.search?.(p) ?? [];
      for (const x of items) catalog.set(x.id, x);
      return { status: 200, body: JSON.stringify({ items: items.map((x) => ({ id: { kind: "youtube#video", videoId: x.id }, snippet: { title: x.title ?? "검색 결과" } })) }) };
    }
    if (name === "videos" && p.get("chart") === "mostPopular") {
      const key = `${p.get("regionCode")} ${p.get("videoCategoryId") ?? "all"}`;
      if (cfg.notFound?.includes(key)) return apiError(404, "videoChartNotFound");
      const pages = cfg.charts?.[key] ?? [[]];
      const page = Number(p.get("pageToken") ?? "0");
      const body: Record<string, unknown> = { items: (pages[page] ?? []).map(videoItem) };
      if (page + 1 < pages.length) body.nextPageToken = String(page + 1);
      return { status: 200, body: JSON.stringify(body) };
    }
    if (name === "videos") {
      const ids = p.get("id")!.split(",");
      return { status: 200, body: JSON.stringify({ items: ids.flatMap((id) => (catalog.has(id) ? [videoItem(catalog.get(id)!)] : [])) }) };
    }
    return { status: 404, body: "{}" };
  };
  return { http, calls };
}

/** 검색 주소의 파라미터로 분야 이름을 찾는다(키워드 글자에 기대지 않는다) */
function topicOf(p: URLSearchParams): string | undefined {
  return searchSpecs().find((s) => s.q === p.get("q") && s.lang === p.get("relevanceLanguage"))?.topic;
}

function client(fake: FakeYoutube, limits = DEFAULT_LIMITS): YoutubeClient {
  return new YoutubeClient({ http: fake.http, key: FAKE_YT, limits, retryGapMs: 0 });
}

const kind = (url: string) => {
  const u = new URL(url);
  const name = u.pathname.split("/").at(-1);
  return name === "videos" ? (u.searchParams.get("chart") ? "chart" : "details") : name!;
};

// ---- 4.1 데이터와 저장 ----

describe("7단계 4.1 데이터와 저장", () => {
  test("4.1-1 같은 고르기를 두 번 적용해도 영상 기록이 한 번씩이고, 설명·통계 항목이 저장되지 않으며 고르기 끝남이 된다", () => {
    const db = briefDb(["2026-10-27"]);
    const a = issue(db, "가짜 탐사선 발사", [["2026-10-27", "한국-1"]]);
    const vids = [newVideo("VidAaaa0001", "kr", 1, [a]), newVideo("VidAaaa0002", "us", 1)];
    assert.equal(isPicked(db, "2026-10-27"), false);
    applyVideoPick(db, "2026-10-27", TODAY, vids);
    applyVideoPick(db, "2026-10-27", TODAY, vids);
    assert.deepEqual(allVideos(db).map((v) => v.videoId), ["VidAaaa0001", "VidAaaa0002"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM video_issues").get() as { n: number }).n, 1);
    assert.equal(isPicked(db, "2026-10-27"), true);
    const cols = (db.prepare("SELECT name FROM pragma_table_info('videos')").all() as { name: string }[]).map((c) => c.name);
    for (const c of cols) assert.ok(!/desc|view|like|comment|stat/i.test(c), `설명·통계 항목이 없다: ${c}`);
    assert.throws(() => db.prepare("INSERT INTO videos (video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position) VALUES ('VidAaaa0001','kr','[]','2026-10-27','2026-10-28','t','c',1,'u','p','r',9)").run(), "같은 날짜에 같은 영상은 하나다");
    db.close();
  });

  for (const v of [4, 5, 6]) {
    test(`4.1-3 버전 ${v} DB(브리프, 이슈, 대상, 용어${v >= 5 ? ", 일정" : ""}${v >= 6 ? ", 지표" : ""}, 합치기 기록)를 새 코드로 열면 버전 8이 되고, 데이터가 그대로이며 영상 기록이 없다`, () => {
      const file = path.join(tempDir(), "t.db");
      const old = openDb(file, MIGRATIONS.filter((m) => m.version <= v));
      assert.equal(schemaVersion(old), v);
      recordFirstCollectionDate(old, "2026-10-27");
      addBrief(old, "2026-10-27");
      const a = issue(old, "가짜 해저 케이블", [["2026-10-27", "한국-1"]]);
      const b = issue(old, "가짜 해저 케이블 수리", [["2026-10-27", "한국-2"]]);
      merge(old, a, b);
      const story = storiesOfDate(old, "2026-10-27").find((x) => x.key === "한국-1")!;
      linkEntity(old, story.id, createEntity(old, { kind: "기관", name: "가짜 해양연구소", aliases: [], description: "지어낸 기관이다.", describedOn: null, describedStory: null }));
      linkTerm(old, story.id, createTerm(old, { name: "가짜 수심계", aliases: [], description: "지어낸 용어다." }), null);
      if (v >= 5) createSchedule(old, { name: "가짜 해양 회의", due: "2026-11-05", major: "과학·건강" });
      if (v >= 6) {
        applyJudgment(old, a, ["usdkrw"]);
        upsertValues(old, "usdkrw", [{ date: "2026-10-27", value: 1400 }]);
      }
      const before = dumpDb(old);
      old.close();
      const db = openDb(file);
      assert.equal(schemaVersion(db), 9);
      const after = dumpDb(db);
      for (const [table, rows] of Object.entries(before)) assert.deepEqual(after[table], rows, table);
      for (const t of ["videos", "video_issues", "video_picked"]) assert.deepEqual(after[t], [], t);
      assert.equal(getIssue(db, b)?.mergedInto, a);
      assert.equal(isPicked(db, "2026-10-27"), false);
      db.close();
    });
  }

  test("4.1-2 DB의 30일 지우기: 받은 날이 29일 전인 기록만 남고, 지운 영상 ID가 DB 파일 바이트에 남지 않는다", () => {
    const file = path.join(tempDir(), "tidwyn.db");
    const db = briefDb(["2026-09-27", "2026-09-28", "2026-09-29"], file);
    applyVideoPick(db, "2026-09-27", "2026-09-27", [newVideo("Gone31dayAA", "kr", 1)]);
    applyVideoPick(db, "2026-09-28", "2026-09-28", [newVideo("Gone30dayBB", "kr", 1)]);
    applyVideoPick(db, "2026-09-29", "2026-09-29", [newVideo("Keep29dayCC", "kr", 1)]);
    assert.equal(purgeExpiredRows(db, TODAY), 2);
    assert.deepEqual(allVideos(db).map((v) => v.videoId), ["Keep29dayCC"]);
    assert.deepEqual([...recentVideoIds(db, TODAY)], ["Keep29dayCC"]);
    assert.ok(isPicked(db, "2026-09-27"), "고르기 끝남 상태는 남아도 된다");
    db.close();
    const bytes = fs.readFileSync(file);
    assert.ok(!bytes.includes("Gone31dayAA") && !bytes.includes("Gone30dayBB"));
    assert.ok(bytes.includes("Keep29dayCC"));
  });
});

// ---- 4.2 영상 받기 ----

describe("7단계 4.2 영상 받기", () => {
  test("4.2-3 카테고리 목록 중 정해 둔 카테고리(정보성 4개와 엔터테인먼트·코미디)의 차트만 끝 페이지까지 받고, 그 밖의 카테고리와 전체 차트는 받지 않으며, 차트 없음은 건너뛴 것으로만 남는다", async () => {
    const fake = fakeYoutube({
      categories: { KR: ["1", "23", "24", "27", "20"], US: ["10", "25"] },
      charts: {
        "KR 1": [[{ id: "KrMovie0001" }]],
        "KR 20": [[{ id: "KrGame00001" }]],
        "KR 23": [[{ id: "KrComedy001" }]],
        "KR 24": [[{ id: "KrEnt0p0aaa" }], [{ id: "KrEnt0p1bbb" }], [{ id: "KrComedy001" }]],
        "KR all": [[{ id: "KrAllp0eeee" }]],
        "US 10": [[{ id: "UsMusic0001", lang: "en" }]],
        "US 25": [[{ id: "UsCat25pfff", lang: "en" }]],
        "US all": [[{ id: "UsAllp0gggg", lang: "en" }]],
      },
      notFound: ["KR 27"],
    });
    const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set(), topics: [] });
    assert.equal(r.status, "ok", JSON.stringify(r.failures));
    assert.deepEqual(r.charts, [
      { region: "KR", fetched: 2, skipped: ["27"] },
      { region: "US", fetched: 1, skipped: [] },
    ]);
    const chartCalls = fake.calls.filter((c) => kind(c.url) === "chart").map((c) => new URL(c.url).searchParams);
    assert.deepEqual(chartCalls.map((p) => `${p.get("regionCode")} ${p.get("videoCategoryId") ?? "all"} ${p.get("pageToken") ?? "0"}`), [
      "KR 23 0",
      "KR 24 0",
      "KR 24 1",
      "KR 24 2",
      "KR 27 0",
      "US 25 0",
    ]);
    assert.deepEqual(r.failures, []);
    const ids = r.videos.map((v) => v.videoId).sort();
    assert.deepEqual(ids, ["KrComedy001", "KrEnt0p0aaa", "KrEnt0p1bbb", "UsCat25pfff"]);
    const dup = r.videos.find((v) => v.videoId === "KrComedy001")!;
    assert.deepEqual(dup.sources, ["KR 차트 23", "KR 차트 24"], "중복을 빼도 받은 곳은 모두 남는다");
    assert.deepEqual(r.videos.find((v) => v.videoId === "UsCat25pfff")!.bundles, ["us"]);
    assert.equal(fake.calls.filter((c) => kind(c.url) === "details").length, 0, "차트 영상은 상세를 다시 받지 않는다");
  });

  test("4.2-2 YouTube Data API v3만 부르고, 키는 x-goog-api-key 헤더로만 보낸다", async () => {
    const fake = fakeYoutube({ search: () => [{ id: "SearchOnly1" }] });
    await fetchVideos({ client: client(fake), now: NOW, recent: new Set() });
    assert.ok(fake.calls.length > 0);
    for (const c of fake.calls) {
      assert.ok(c.url.startsWith(YOUTUBE_BASE), c.url);
      assert.ok(!c.url.includes(FAKE_YT) && !/[?&]key=/.test(c.url), "키는 주소에 없다");
      assert.equal(c.headers["x-goog-api-key"], FAKE_YT);
    }
  });

  test("4.2-4 키워드 목록에 V4의 11개 분야와 AI가 한국어·영어로 모두 있고, 검색마다 조건이 들어가며 한 실행의 검색이 90번 이하다", async () => {
    assert.equal(SEARCH_FIELDS.length, 11);
    assert.deepEqual(SEARCH_TOPICS.map((t) => t.name), [...SEARCH_FIELDS, "AI"]);
    for (const t of SEARCH_TOPICS) for (const lang of ["ko", "en"] as const) assert.ok(t.keywords[lang].length > 0 && t.keywords[lang].every((k) => k.trim() !== ""), `${t.name} ${lang}`);
    assert.deepEqual(SEARCH_TOPICS.filter((t) => t.ai).map((t) => t.name), ["AI"]);
    const specs = searchSpecs();
    assert.ok(specs.length <= DEFAULT_LIMITS.searches);
    assert.equal(specs.length, SEARCH_TOPICS.length * 2 * 2);
    const fake = fakeYoutube();
    const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set() });
    const searches = fake.calls.filter((c) => kind(c.url) === "search").map((c) => new URL(c.url).searchParams);
    assert.equal(searches.length, specs.length);
    assert.equal(r.usage.searches, specs.length);
    const after48 = new Date(NOW.getTime() - 48 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const seen = new Set<string>();
    for (const p of searches) {
      assert.equal(p.get("type"), "video");
      assert.equal(p.get("order"), "relevance");
      assert.equal(p.get("publishedAfter"), after48);
      assert.ok(["medium", "long"].includes(p.get("videoDuration")!), "4분 이상(medium·long)");
      const lang = p.get("relevanceLanguage");
      assert.equal(p.get("regionCode"), lang === "ko" ? "KR" : lang === "en" ? "US" : "?");
      seen.add(`${p.get("q")} ${lang} ${p.get("videoDuration")}`);
    }
    assert.equal(seen.size, specs.length, "같은 검색을 두 번 하지 않는다");
    for (const t of SEARCH_TOPICS) for (const lang of ["ko", "en"]) assert.ok(`${t.name} ${lang}` in r.searchResults, `${t.name} ${lang} 검색 결과 수가 기록된다`);
  });

  test("4.2-5 생방송 중·예정, 4분 미만, 세로, 이미 추천한 영상만 빠지고 이유별 수가 맞으며, 생방송 기록이 있는 끝난 영상은 남아 표시된다", async () => {
    const fake = fakeYoutube({
      search: (p) =>
        p.get("relevanceLanguage") === "ko" && p.get("videoDuration") === "medium" && topicOf(p) === "경제·금융"
          ? [{ id: "KeepNormal1" }, { id: "IsLiveNow01", live: "live" }, { id: "IsUpcoming1", live: "upcoming" }, { id: "TooShort001", seconds: 239 }, { id: "Exactly240s", seconds: 240 }, { id: "Vertical001", vertical: true }, { id: "AlreadyRec1" }, { id: "LiveRecord1", liveRecord: true }]
          : [],
    });
    const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set(["AlreadyRec1"]) });
    assert.equal(r.status, "ok");
    assert.deepEqual(r.videos.map((v) => v.videoId).sort(), ["Exactly240s", "KeepNormal1", "LiveRecord1"]);
    assert.deepEqual(r.excluded, { already: 1, live: 2, short: 1, vertical: 1, unavailable: 0 });
    assert.equal(r.before, 8);
    assert.equal(r.videos.find((v) => v.videoId === "LiveRecord1")!.liveRecord, true);
    assert.equal(r.videos.find((v) => v.videoId === "KeepNormal1")!.liveRecord, false);
    const detailIds = fake.calls.filter((c) => kind(c.url) === "details").flatMap((c) => new URL(c.url).searchParams.get("id")!.split(","));
    assert.ok(!detailIds.includes("AlreadyRec1"), "이미 추천한 영상은 상세를 받지 않는다");
    const f = buildCandidateFile("2026-10-27", TODAY, r.videos, []);
    const md = renderCandidates(f, "/x/videos.pick.json", "/x/videos.details.md");
    assert.match(md, /- \d+ · kr · 15:00 · 카테고리 \S+ · [^·]+ · 생방송 기록 있음 · [^\n]*가짜 영상 LiveRecord1/);
    assert.equal(md.match(/· 생방송 기록 있음 ·/g)?.length, 1);
    const details = renderCandidateDetails(f);
    assert.match(details, /### 후보 \d+: 가짜 영상 LiveRecord1\n(?:- .*\n)*- 길이: 15:00 · 생방송 기록 있음/);
    assert.equal(details.match(/생방송 기록 있음/g)?.length, 1);
  });

  test("4.2-5 상세는 한 번에 50개씩 받는다", async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ id: `Many${String(i).padStart(7, "0")}` }));
    const fake = fakeYoutube({ search: (p) => (topicOf(p) === "경제·금융" && p.get("relevanceLanguage") === "ko" && p.get("videoDuration") === "long" ? many : []) });
    const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set() });
    const sizes = fake.calls.filter((c) => kind(c.url) === "details").map((c) => new URL(c.url).searchParams.get("id")!.split(",").length);
    assert.deepEqual(sizes, [50, 50, 20]);
    assert.equal(r.videos.length, 120);
  });

  test("4.2-2 가짜 응답(할당량 사유들·429, 인증 오류, 시간 초과, 일시 오류)에 대해 결과와 실패 기록이 맞고, 할당량·인증 오류는 다시 시도하지 않는다", async () => {
    for (const quota of [apiError(403, "quotaExceeded"), apiError(403, "dailyLimitExceeded"), apiError(403, "rateLimitExceeded"), { status: 429, body: "" }]) {
      const fake = fakeYoutube({ fail: (u) => (kind(u.href) === "search" && topicOf(u.searchParams) === "과학" ? quota : undefined) });
      const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set() });
      assert.equal(r.status, "failed", JSON.stringify(quota));
      assert.equal(r.quota, true);
      assert.match(r.failures.join("\n"), /할당량 초과/);
      assert.equal(fake.calls.filter((c) => topicOf(new URL(c.url).searchParams) === "과학").length, 1, "할당량 오류는 다시 시도하지 않는다");
      const at = fake.calls.findIndex((c) => topicOf(new URL(c.url).searchParams) === "과학");
      assert.equal(at, fake.calls.length - 1, "할당량 오류 뒤에는 더 부르지 않는다");
      assert.deepEqual(r.videos, []);
    }
    const auth = fakeYoutube({ fail: () => apiError(400, "keyInvalid") });
    const a = await fetchVideos({ client: client(auth), now: NOW, recent: new Set() });
    assert.ok(a.status === "failed" && a.keyProblem && !a.quota);
    assert.match(a.failures[0]!, /키 확인 필요/);
    assert.equal(auth.calls.length, 1, "인증 오류는 다시 시도하지 않고 멈춘다");

    const flaky = fakeYoutube({ categories: { KR: ["24"], US: [] }, charts: { "KR 24": [[{ id: "AfterRetry1" }]] }, fail: (u, n) => (u.searchParams.get("videoCategoryId") === "24" && n === 1 ? { status: 503, body: "{}" } : undefined) });
    const f = await fetchVideos({ client: client(flaky), now: NOW, recent: new Set(), topics: [] });
    assert.equal(f.status, "ok");
    assert.ok(f.videos.some((v) => v.videoId === "AfterRetry1"), "일시 오류는 다시 시도해 받는다");

    const timeout = fakeYoutube({ categories: { KR: ["24", "25"], US: [] }, charts: { "KR 25": [[{ id: "StillGot001" }]] }, fail: (u) => (u.searchParams.get("videoCategoryId") === "24" ? "timeout" : undefined) });
    const t = await fetchVideos({ client: client(timeout), now: NOW, recent: new Set(), topics: [] });
    assert.equal(t.status, "partial");
    assert.deepEqual(t.failures, ["KR 24 차트: 시간 초과"]);
    assert.equal(timeout.calls.filter((c) => new URL(c.url).searchParams.get("videoCategoryId") === "24").length, 3, "시간 초과는 두 번 더 시도한다");
    assert.deepEqual(t.videos.map((v) => v.videoId), ["StillGot001"]);

    const down = fakeYoutube({ fail: () => "network" });
    const d = await fetchVideos({ client: client(down), now: NOW, recent: new Set() });
    assert.equal(d.status, "failed", "모든 호출이 실패하면 받기 실패다");
    assert.ok(!d.failures.join("\n").includes("https://"), "오류 글에 주소(영상 ID가 들 수 있다)를 넣지 않는다");
  });

  test("4.2-2 상한을 낮춰 넣으면 상한을 넘겨 부르지 않고, 빠진 받기를 남기며 받은 것으로 끝난다", async () => {
    const fake = fakeYoutube({ categories: { KR: ["23", "24", "25", "27"], US: ["24"] }, charts: { "KR 23": [[{ id: "LimitKr0001" }]] }, search: () => [{ id: "SearchHit01" }] });
    const r = await fetchVideos({ client: client(fake, { searches: 3, units: 4 }), now: NOW, recent: new Set() });
    assert.equal(fake.calls.filter((c) => kind(c.url) === "search").length, 3);
    assert.equal(fake.calls.filter((c) => kind(c.url) !== "search").length, 4);
    assert.deepEqual(r.usage, { searches: 3, units: 4 });
    assert.equal(r.status, "partial");
    assert.ok(r.missed.includes("KR 27 차트"), JSON.stringify(r.missed));
    assert.ok(r.missed.some((m) => m.startsWith("US ")));
    assert.ok(r.missed.some((m) => /검색/.test(m)));
    assert.ok(r.missed.some((m) => m.startsWith("상세")), "상세도 상한에 걸리면 빠진 받기로 남는다");
  });

  test("4.2-6 후보 목록에 거른 뒤 남은 영상만 있고 묶음과 받은 곳이 맞으며, 관련 이슈 후보는 14일 안에 뉴스가 붙은 흡수되지 않은 이슈다", async () => {
    const dates = ["2026-10-10", "2026-10-13", "2026-10-14", "2026-10-27"];
    const db = briefDb(dates);
    const recent = issue(db, "가짜 혜성 관측", [["2026-10-27", "한국-1"]]);
    const edge = issue(db, "가짜 위성 고장", [["2026-10-14", "한국-1"]]);
    issue(db, "가짜 옛 소식", [["2026-10-13", "한국-1"], ["2026-10-10", "한국-2"]]);
    const absorbed = issue(db, "가짜 혜성 관측 후속", [["2026-10-27", "한국-2"]]);
    merge(db, recent, absorbed);
    assert.deepEqual(issueCandidates(db, "2026-10-27").map((i) => i.id), [recent, edge], "10-14(14일째)까지, 10-13은 빠지고 흡수된 이슈도 빠진다");
    const fake = fakeYoutube({
      categories: { KR: ["24"], US: [] },
      charts: { "KR 24": [[{ id: "BothKrChart" }, { id: "ShortOne001", seconds: 100 }]] },
      search: (p) => {
        const ko = p.get("relevanceLanguage") === "ko";
        if (p.get("videoDuration") !== "medium") return [];
        if (topicOf(p) === "AI" && !ko) return [{ id: "AiEnglish01", lang: "en" }, { id: "BothKrChart" }];
        if (topicOf(p) === "과학" && ko) return [{ id: "BothKrChart" }, { id: "KoScience01" }];
        return [];
      },
    });
    const r = await fetchVideos({ client: client(fake), now: NOW, recent: new Set() });
    const f = buildCandidateFile("2026-10-27", TODAY, r.videos, issueCandidates(db, "2026-10-27"));
    assert.deepEqual(
      f.candidates.map((c) => [c.n, c.videoId, c.bundles.join("+"), c.sources.join(" / ")]),
      [
        [1, "BothKrChart", "kr+ai-en", "KR 차트 24 / 한국어 검색 과학 / 영어 검색 AI"],
        [2, "KoScience01", "kr", "한국어 검색 과학"],
        [3, "AiEnglish01", "ai-en", "영어 검색 AI"],
      ],
    );
    const md = renderCandidates(f, "/x/videos.pick.json", "/x/videos.details.md");
    const details = renderCandidateDetails(f);
    assert.ok(!md.includes("ShortOne001") && !details.includes("ShortOne001"));
    assert.match(md, new RegExp(`- 이슈 ${recent}: 가짜 혜성 관측 \\(과학·건강 / 우주\\)`));
    assert.match(md, new RegExp(`- 이슈 ${edge}: 가짜 위성 고장`));
    assert.ok(!md.includes("가짜 옛 소식") && !md.includes("후속"));
    for (const field of ["고를 수 있는 묶음:", "받은 곳:", "채널:", "길이:", "카테고리:", "올린 시각:", "언어:", "설명 앞부분:"]) assert.ok(details.includes(field), field);
    assert.equal(md.match(/^- \d+ · /gm)?.length, f.candidates.length, "후보 목록은 후보마다 한 줄");
    assert.ok(md.includes("/x/videos.details.md"), "후보 목록이 상세 파일을 가리킨다");
    assert.ok(!/조회수|viewCount/.test(md + details), "조회수는 없다");
    db.close();
  });
});

// ---- 4.3 영상 고르기 ----

function pickSetup() {
  const db = briefDb(["2026-10-26", "2026-10-27"]);
  const a = issue(db, "가짜 화성 착륙", [["2026-10-27", "한국-1"]]);
  const b = issue(db, "가짜 달 기지", [["2026-10-26", "한국-2"]]);
  const c = issue(db, "가짜 소행성", [["2026-10-27", "세계-1"]]);
  const gone = issue(db, "가짜 화성 착륙 준비", [["2026-10-27", "세계-2"]]);
  merge(db, a, gone);
  const cand = (n: number, bundles: CandidateFile["candidates"][number]["bundles"]) => ({
    n,
    videoId: `PickVid${String(n).padStart(4, "0")}`,
    bundles,
    sources: ["가짜 받은 곳"],
    title: `가짜 후보 제목 ${n}`,
    channel: "가짜 채널",
    seconds: 600,
    categoryId: "27",
    publishedAt: "2026-10-27T00:00:00Z",
    language: "ko",
    liveRecord: false,
    description: "지어낸 설명",
    thumb: `https://i.example.com/vi/${n}/mqdefault.jpg`,
  });
  const file: CandidateFile = {
    targetDate: "2026-10-27",
    fetchedOn: TODAY,
    candidates: [
      ...[1, 2, 3, 4, 5, 6].map((n) => cand(n, ["kr"])),
      ...[7, 8, 9, 10, 11, 12].map((n) => cand(n, ["us"])),
      ...[13, 14, 15, 16].map((n) => cand(n, ["ai-ko"])),
      ...[17, 18, 19, 20].map((n) => cand(n, ["ai-en", "us"])),
    ],
    issues: [
      { id: a, name: "가짜 화성 착륙", major: "과학·건강", minor: "우주" },
      { id: c, name: "가짜 소행성", major: "과학·건강", minor: "우주" },
    ],
  };
  return { db, file, ids: { a, b, c, gone } };
}

const pick = (candidate: number, bundle: string, issues: number[] = [], reason = "이 영상에서 지어낸 탐사 과정을 차근차근 알 수 있다.") => ({ candidate, bundle, reason, issues });

describe("7단계 4.3 영상 고르기", () => {
  test("4.3-3 거부 경우마다 거부되고 DB가 바뀌지 않는다", () => {
    const { db, file, ids } = pickSetup();
    const before = dumpDb(db);
    const cases: [string, unknown, RegExp][] = [
      ["후보 목록에 없는 번호", { videos: [pick(99, "kr")] }, /후보 99은\(는\) 후보 목록에 없다/],
      ["같은 영상을 두 번", { videos: [pick(1, "kr"), pick(1, "kr")] }, /두 번 골랐다/],
      ["고를 수 없는 묶음", { videos: [pick(1, "us")] }, /us 묶음으로 고를 수 없다/],
      ["없는 묶음", { videos: [pick(1, "jp")] }, /묶음은 kr, us, ai-ko, ai-en 중 하나/],
      ["kr 최대 초과", { videos: [1, 2, 3, 4, 5, 6].map((n) => pick(n, "kr")) }, /kr 묶음이 6개다\(최대 5개\)/],
      ["ai-ko 최대 초과", { videos: [13, 14, 15, 16].map((n) => pick(n, "ai-ko")) }, /ai-ko 묶음이 4개다\(최대 3개\)/],
      ["us 최대 초과(ai-en 후보를 us로)", { videos: [7, 8, 9, 10, 17, 18].map((n) => pick(n, "us")) }, /us 묶음이 6개다/],
      ["빈 추천 이유", { videos: [pick(1, "kr", [], " ")] }, /추천 이유가 비어 있으면 안 된다/],
      ["150자 넘는 추천 이유", { videos: [pick(1, "kr", [], "가".repeat(151))] }, /151자다/],
      ["주소 http", { videos: [pick(1, "kr", [], "자세한 것은 http 주소에서 본다.")] }, /주소/],
      ["주소 www.", { videos: [pick(1, "kr", [], "www.example.com에서 본다.")] }, /주소/],
      ["없는 이슈", { videos: [pick(1, "kr", [9999])] }, /이슈 9999은\(는\) 없다/],
      ["흡수된 이슈", { videos: [pick(1, "kr", [ids.gone])] }, /흡수되었다/],
      ["이슈 후보에 없는 이슈", { videos: [pick(1, "kr", [ids.b])] }, /관련 이슈 후보에 없다/],
      ["관련 이슈 3개", { videos: [pick(1, "kr", [ids.a, ids.c, ids.a])] }, /3개 \(0~2개여야 한다\)/],
      ["알 수 없는 항목", { videos: [{ ...pick(1, "kr"), title: "바꾼 제목" }] }, /알 수 없는 항목 "title"/],
      ["목록이 아님", { videos: {} }, /목록이어야 한다/],
    ];
    for (const [name, data, why] of cases) {
      const r = checkPickFile(db, data, file);
      assert.ok(!r.ok && r.violations.some((v) => why.test(`${v.where}: ${v.why}`)), `${name}: ${JSON.stringify(r)}`);
    }
    assert.deepEqual(dumpDb(db), before);
    db.close();
  });

  test("4.3-3 맞는 파일(0개, 묶음별 최대 개수, 관련 이슈 0·1·2개 섞임)이 적용되고, 묶음 안 순서는 파일 순서다", () => {
    const { db, file, ids } = pickSetup();
    const empty = checkPickFile(db, { videos: [] }, file);
    assert.ok(empty.ok && empty.videos.length === 0);
    const data = {
      videos: [
        ...[5, 4, 3, 2, 1].map((n, i) => pick(n, "kr", i === 0 ? [ids.a, ids.c] : i === 1 ? [ids.c] : [])),
        ...[7, 8, 9, 10, 17].map((n) => pick(n, "us")),
        ...[13, 14, 15].map((n) => pick(n, "ai-ko")),
        ...[18, 19, 20].map((n) => pick(n, "ai-en")),
      ],
    };
    const r = checkPickFile(db, data, file);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    applyVideoPick(db, file.targetDate, file.fetchedOn, r.videos);
    const vids = allVideos(db);
    assert.equal(vids.length, 16);
    assert.deepEqual(vids.filter((v) => v.bundle === "kr").map((v) => [v.videoId, v.position, v.issues]), [
      ["PickVid0005", 1, [ids.a, ids.c]],
      ["PickVid0004", 2, [ids.c]],
      ["PickVid0003", 3, []],
      ["PickVid0002", 4, []],
      ["PickVid0001", 5, []],
    ]);
    assert.equal(vids.find((v) => v.videoId === "PickVid0005")!.title, "가짜 후보 제목 5", "제목은 후보 목록(YouTube가 준 것) 그대로다");
    assert.ok(isPicked(db, "2026-10-27"));
    db.close();
  });

  test("4.3-6 합친 뒤 남는 이슈의 영상에 흡수된 이슈의 영상이 들어가고(겹치면 한 번), 되돌린 뒤 각자의 영상으로 돌아가며 영상 기록은 그대로다", () => {
    const db = briefDb(["2026-10-25", "2026-10-26", "2026-10-27"]);
    const s = issue(db, "가짜 로켓 엔진", [["2026-10-27", "한국-1"]]);
    const a = issue(db, "가짜 로켓 엔진 시험", [["2026-10-26", "한국-1"]]);
    applyVideoPick(db, "2026-10-25", "2026-10-25", [newVideo("MergeVid001", "kr", 1, [a])]);
    applyVideoPick(db, "2026-10-26", "2026-10-26", [newVideo("MergeVid002", "kr", 1, [s, a]), newVideo("MergeVid003", "us", 1, [a])]);
    applyVideoPick(db, "2026-10-27", "2026-10-27", [newVideo("MergeVid004", "ai-ko", 1, [s])]);
    const rows = () => db.prepare("SELECT * FROM videos ORDER BY id").all().map((r) => ({ ...r }));
    const links = () => db.prepare("SELECT * FROM video_issues ORDER BY video, issue_id").all().map((r) => ({ ...r }));
    const before = { rows: rows(), links: links() };
    const videosOf = (id: number) => (issueDetail(buildSiteData(db), id).videos ?? []).map((v) => `${v.date} ${v.id}`);
    assert.deepEqual(videosOf(s), ["2026-10-27 MergeVid004", "2026-10-26 MergeVid002"]);
    assert.deepEqual(videosOf(a), ["2026-10-26 MergeVid002", "2026-10-26 MergeVid003", "2026-10-25 MergeVid001"]);
    const m = merge(db, s, a);
    assert.deepEqual(videosOf(s), ["2026-10-27 MergeVid004", "2026-10-26 MergeVid002", "2026-10-26 MergeVid003", "2026-10-25 MergeVid001"]);
    assert.deepEqual({ rows: rows(), links: links() }, before, "합치기가 영상 기록을 바꾸지 않는다");
    assert.ok(unmerge(db, m, TODAY).ok);
    assert.deepEqual(videosOf(s), ["2026-10-27 MergeVid004", "2026-10-26 MergeVid002"]);
    assert.deepEqual(videosOf(a), ["2026-10-26 MergeVid002", "2026-10-26 MergeVid003", "2026-10-25 MergeVid001"]);
    assert.deepEqual({ rows: rows(), links: links() }, before, "되돌리기가 영상 기록을 바꾸지 않는다");
    db.close();
  });
});

// ---- 4.4 백업과 공개 데이터 검사 ----

describe("7단계 4.4 백업과 복원, 공개 데이터 검사", () => {
  test("4.4-1 영상 기록이 있는 DB를 백업하면 백업 어디에도 영상 ID·제목·추천 이유가 없고, 복원한 DB에 영상 기록과 고르기 끝남이 없으며 나머지는 같다", () => {
    const db = briefDb(["2026-10-26", "2026-10-27"]);
    const a = issue(db, "가짜 천문대 개관", [["2026-10-27", "한국-1"]]);
    applyVideoPick(db, "2026-10-27", TODAY, [newVideo("BackupVid01", "kr", 1, [a])]);
    const files = buildBackup(db);
    const all = [...files.values()].join("\n");
    for (const s of ["BackupVid01", "가짜 영상 제목 BackupVid01", "가짜 추천 이유 BackupVid01", "video_picked", "videos"]) assert.ok(!all.includes(s), s);
    const out = path.join(tempDir(), "restored.db");
    restoreBackup(files, out);
    const back = openDb(out);
    assert.deepEqual(allVideos(back), []);
    assert.equal(isPicked(back, "2026-10-27"), false);
    const strip = (d: Record<string, unknown[]>) => Object.fromEntries(Object.entries(d).filter(([t]) => !["videos", "video_issues", "video_picked"].includes(t)));
    assert.deepEqual(strip(dumpDb(back)), strip(dumpDb(db)));
    back.close();
    db.close();
  });

  test("4.4-2 영상 기록이 든 백업 파일을 넣은 커밋(data 브랜치)과 지금 파일에서 공개 전 점검이 실패하고, 백업 자리가 아닌 파일·영상이 없는 백업은 걸리지 않는다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "--orphan", "data");
    gitIn(repo, "rm", "-rq", "--cached", "--ignore-unmatch", ".");
    for (const f of fs.readdirSync(repo)) if (f !== ".git") fs.rmSync(path.join(repo, f), { recursive: true });
    fs.writeFileSync(path.join(repo, "meta.json"), JSON.stringify({ formatVersion: 5, firstCollectionDate: "2026-10-27" }, null, 2));
    fs.writeFileSync(path.join(repo, "2026-10.json"), JSON.stringify({ formatVersion: 5, month: "2026-10", briefs: [], videos: [{ videoId: "LeakVid0001" }] }, null, 2));
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "backup");
    const head = gitIn(repo, "rev-parse", "HEAD").trim();
    const r = precheck({ repo, commits: [head], trackedFiles: true, home: null });
    const videoFindings = (x: typeof r) => x.findings.filter((f) => f.kind === "백업 파일에 영상 기록");
    assert.deepEqual(videoFindings(r).map((f) => `${f.where} ${f.kind}`).sort(), [`지금 파일 2026-10.json 백업 파일에 영상 기록`, `커밋 ${head.slice(0, 7)} 2026-10.json 백업 파일에 영상 기록`]);
    // 백업 자리가 아닌 곳의 같은 글, 영상이 없는 백업은 걸리지 않는다
    fs.writeFileSync(path.join(repo, "2026-10.json"), JSON.stringify({ formatVersion: 5, month: "2026-10", briefs: [] }, null, 2));
    fs.mkdirSync(path.join(repo, "docs"));
    fs.writeFileSync(path.join(repo, "docs", "meta.json"), '{"videos": []}');
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "clean");
    const clean = precheck({ repo, commits: [gitIn(repo, "rev-parse", "HEAD").trim()], trackedFiles: true, home: null });
    assert.deepEqual(videoFindings(clean), []);
  });

  test("4.4-2 결과물에 영상 작업 파일 이름의 파일이 있으면 결과물 검사가 실패한다", () => {
    for (const name of VIDEO_WORK_FILES) {
      const out = tempDir();
      fs.mkdirSync(path.join(out, "assets"));
      fs.writeFileSync(path.join(out, "assets", name), "{}");
      assert.deepEqual(checkOutput(out, null).findings.map((f) => `${f.where} ${f.kind}`), [`assets/${name} 실행 기록·작업 파일`], name);
    }
  });
});

// ---- 4.8 키 ----

/** 테스트 안에서 조립한 Google API 키 모양(AIza + 35자 = 39자). 저장소 파일에 그대로 쓰지 않는다 */
function googleShapedKey(): string {
  return ["AI", "za"].join("") + "Q".repeat(20) + "x_-9".repeat(3) + "abc";
}

describe("7단계 4.8-2 키 점검", () => {
  test("Google API 키 모양(39자)을 넣은 커밋에서 공개 전 점검이 키 모양으로 실패하고, 길이가 다르면 걸리지 않는다", () => {
    const key = googleShapedKey();
    assert.equal(key.length, 39);
    const repo = tempRepo();
    fs.writeFileSync(path.join(repo, "config.txt"), `youtube=${key}\n`);
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "add config");
    const r = precheck({ repo, commits: [gitIn(repo, "rev-parse", "HEAD").trim()], trackedFiles: true, home: null });
    assert.ok(r.findings.some((f) => f.kind === "Google API 키 모양" && f.where.includes("config.txt")), JSON.stringify(r.findings));
    const text = JSON.stringify(r.findings);
    assert.ok(!text.includes(key));
    fs.writeFileSync(path.join(repo, "config.txt"), `youtube=${key}Z\nother=${key.slice(0, 38)}\n`);
    gitIn(repo, "add", ".");
    assert.deepEqual(precheck({ repo, commits: [], trackedFiles: true, home: null }).findings, [], "40자·38자는 키 모양이 아니다");
  });

  test("가짜 YouTube 키가 든 결과물과 커밋에서 검사가 실패한다(환경 변수로 줄 때와 .env.local로 줄 때 모두)", () => {
    assert.deepEqual(readKeys({ YOUTUBE_API_KEY: FAKE_YT }, tempDir()).YOUTUBE_API_KEY, FAKE_YT);
    for (const how of ["env", "file"] as const) {
      const repo = tempRepo();
      const env = how === "env" ? KEY_ENV : {};
      if (how === "file") fs.writeFileSync(path.join(repo, ".env.local"), `YOUTUBE_API_KEY=${FAKE_YT}\n`);
      fs.writeFileSync(path.join(repo, "leak.md"), `키 ${FAKE_YT}\n`);
      gitIn(repo, "add", "leak.md");
      gitIn(repo, "commit", "-qm", "leak");
      const ctx = makeCtx(repo, env);
      assert.equal(main(["precheck"], ctx), 1, ctx.text());
      assert.match(ctx.text(), /leak\.md.*키 값이 들어 있음/);
      assert.ok(!ctx.text().includes(FAKE_YT));
      const out = tempDir();
      fs.writeFileSync(path.join(out, "app.js"), `const k="${FAKE_YT}";`);
      const dataDir = tempDir();
      briefDb(["2026-10-27"], path.join(dataDir, "tidwyn.db")).close();
      const builder = ({ outDir }: { outDir: string }) => {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "app.js"), `const k="${FAKE_YT}";`);
        return { ok: true as const };
      };
      const sctx = { ...makeCtx(repo, env), buildSite: builder };
      assert.equal(main(["site", "--data-dir", dataDir], sctx), 1, sctx.text());
      assert.match(sctx.text(), /키 값이 들어 있음/);
      assert.ok(!sctx.text().includes(FAKE_YT));
    }
  });
});

// ---- CLI 흐름(데이터 폴더 지정) ----

function cli(repo: string, argv: string[], env: NodeJS.ProcessEnv, now = NOW): { code: number; text: string } {
  const ctx = makeCtx(repo, env, now);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

async function fetchCli(f: { repo: string; runFile: string; env: NodeJS.ProcessEnv }, fake: FakeYoutube, limits?: { searches: number; units: number }, now = NOW): Promise<{ code: number; text: string }> {
  const ctx = { ...makeCtx(f.repo, f.env, now), youtubeHttp: fake.http, youtubeRetryGapMs: 0, ...(limits ? { youtubeLimits: limits } : {}) };
  const code = await mainAsync(["video-fetch", "--run", f.runFile], ctx);
  return { code, text: ctx.text() };
}

/** 받기가 정상인 가짜 YouTube: 한국 차트 영상 둘, 한국어 과학 검색 하나, AI 영어 검색 하나 */
function goodYoutube(): FakeYoutube {
  return fakeYoutube({
    categories: { KR: ["1", "27"], US: ["25"] },
    charts: { "KR 27": [[{ id: "FlowKrChrt1", title: "가짜 다큐 첫째 제목" }, { id: "FlowKrChrt2", title: "가짜 다큐 둘째 제목" }]] },
    notFound: ["US 25"],
    search: (p) => {
      if (p.get("videoDuration") !== "long") return [];
      if (topicOf(p) === "과학" && p.get("relevanceLanguage") === "ko") return [{ id: "FlowKoSci01", title: "가짜 과학 강연 제목" }];
      if (topicOf(p) === "AI" && p.get("relevanceLanguage") === "en") return [{ id: "FlowAiEng01", title: "Fake AI talk title", lang: "en" }];
      return [];
    },
  });
}

function startFlow(f: { repo: string; env: NodeJS.ProcessEnv }, now = NOW): { runFile: string; text: string } {
  const s = cli(f.repo, ["start"], f.env, now);
  assert.equal(s.code, 0, s.text);
  return { runFile: /실행 기록: (.+)/.exec(s.text)![1]!, text: s.text };
}

function flowDir(env: NodeJS.ProcessEnv = KEY_ENV, dates = ["2026-10-26", "2026-10-27"]) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = briefDb(dates, path.join(dataDir, "tidwyn.db"));
  const ids = [issue(db, "가짜 우주 망원경", [[dates.at(-1)!, "한국-1"]]), issue(db, "가짜 행성 탐사", [[dates[0]!, "세계-1"]])];
  db.close();
  const fullEnv = { ...env, TIDWYN_DATA_DIR: dataDir };
  const s = startFlow({ repo, env: fullEnv });
  return { repo, dataDir, env: fullEnv, runFile: s.runFile, start: s.text, ids };
}

/** 사이트 데이터를 결과물에 복사하는 가짜 빌더(실제 빌더처럼 site-data/를 결과물에 둔다) */
const copyBuilder = ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(path.join(inputDir, "site-data"), path.join(outDir, "site-data"), { recursive: true });
  writeFakePublicFiles(outDir);
  return { ok: true as const };
};

function backupSiteSummary(f: { repo: string; env: NodeJS.ProcessEnv; runFile: string }, now = NOW): { text: string; summary: string } {
  const b = cli(f.repo, ["backup", "--run", f.runFile], f.env, now);
  assert.equal(b.code, 0, b.text);
  const ctx = { ...makeCtx(f.repo, f.env, now), buildSite: copyBuilder };
  assert.equal(main(["site", "--run", f.runFile], ctx), 0, ctx.text());
  const s = cli(f.repo, ["summary", "--run", f.runFile], f.env, now);
  assert.equal(s.code, 0, s.text);
  return { text: `${b.text}\n${ctx.text()}`, summary: s.text };
}

function walkFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  if (fs.statSync(dir).isFile()) return [dir];
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .map((f) => path.join(dir, f))
    .filter((f) => fs.statSync(f).isFile());
}

function filesContaining(dir: string, needle: string): string[] {
  return walkFiles(dir).filter((f) => fs.readFileSync(f).includes(needle));
}

describe("7단계 4.5 start 출력과 요약, 4.2-7·4.3 흐름, 4.8 새지 않음", () => {
  test("4.5-1 start에 YouTube 키 있음/없음, 영상 대상 예정 날짜, 30일 지움 줄이 나오고 키 값은 출력에 없다", () => {
    const f = flowDir();
    assert.match(f.start, /- 키: ECOS 없음, FRED 없음, YouTube 있음/);
    assert.match(f.start, /- 영상: 2026-10-27 받기 할 것/, "모을 날짜가 없으면 DB의 가장 늦은 브리프 날짜");
    assert.match(f.start, /- 30일 지난 영상 지움: 0개/);
    assert.ok(!f.start.includes(FAKE_YT));
    const none = flowDir({});
    assert.match(none.start, /YouTube 없음/);
    // 모을 날짜가 있으면 그중 가장 늦은 날(NOW의 KST 어제 2026-10-27까지 수집)
    const later = flowDir(KEY_ENV, ["2026-10-24"]);
    assert.deepEqual(readRun(later.runFile).targetDates, ["2026-10-25", "2026-10-26", "2026-10-27"]);
    assert.match(later.start, /- 영상: 2026-10-27 받기 할 것/);
    const db = openDb(path.join(later.dataDir, "tidwyn.db"));
    applyVideoPick(db, "2026-10-24", TODAY, []);
    db.close();
    assert.match(startFlow({ repo: later.repo, env: later.env }).text, /- 영상: 2026-10-27 받기 할 것/);
    const done = flowDir();
    const ddb = openDb(path.join(done.dataDir, "tidwyn.db"));
    applyVideoPick(ddb, "2026-10-27", TODAY, []);
    ddb.close();
    assert.match(startFlow({ repo: done.repo, env: done.env }).text, /- 영상: 2026-10-27 이미 끝남/);
    // 첫 실행(DB 없음)은 이번 실행의 마지막 모을 날짜가 대상 예정이다
    const empty = tempRepo();
    const s = cli(empty, ["start"], { ...KEY_ENV, TIDWYN_DATA_DIR: tempDir() });
    assert.match(s.text, /- 영상: 2026-10-27 받기 할 것/);
  });

  test("4.2-1 브리프가 하나도 없으면 video-fetch가 YouTube를 부르지 않고 받지 않음으로 남는다", async () => {
    const repo = tempRepo();
    const env = { ...KEY_ENV, TIDWYN_DATA_DIR: tempDir() };
    const { runFile } = startFlow({ repo, env });
    const fake = goodYoutube();
    const r = await fetchCli({ repo, runFile, env }, fake);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /브리프가 없어 받지 않는다/);
    assert.equal(fake.calls.length, 0);
    assert.equal(readRun(runFile).videoFetch?.status, "noBrief");
  });

  test("받기·고르기 흐름: 후보 목록 → 고르기 실패 → 고쳐서 적용, 작업 파일 정리, 요약 줄, 실행 기록·요약·출력에 영상 ID·제목·추천 이유·키가 없다", async () => {
    const f = flowDir();
    const fake = goodYoutube();
    const fetched = await fetchCli(f, fake);
    assert.equal(fetched.code, 0, fetched.text);
    assert.match(fetched.text, /- KR 차트: 받은 차트 1개, 건너뛴 카테고리 0개/);
    assert.match(fetched.text, /- US 차트: 받은 차트 0개, 건너뛴 카테고리 1개\(25\)/);
    assert.match(fetched.text, /거르기 전 4개 → 거른 뒤 4개/);
    const cand = JSON.parse(fs.readFileSync(videoWorkFile(f.dataDir, "candidates"), "utf8")) as CandidateFile;
    assert.equal(cand.targetDate, "2026-10-27");
    assert.deepEqual(cand.issues.map((i) => i.id), [f.ids[0], f.ids[1]]);
    // 같은 실행에서 다시 받으면 YouTube를 부르지 않고 후보 목록을 그대로 둔다(하루 검색 할당량을 두 번 쓰지 않는다)
    const calls = fake.calls.length;
    const refetch = await fetchCli(f, fake);
    assert.equal(refetch.code, 0, refetch.text);
    assert.match(refetch.text, /이 실행에서 이미 받았다/);
    assert.equal(fake.calls.length, calls, "다시 받기는 호출 0번");
    assert.deepEqual(JSON.parse(fs.readFileSync(videoWorkFile(f.dataDir, "candidates"), "utf8")), cand);
    // 사람이 읽는 목록이 없어져도 YouTube를 다시 부르지 않고 받은 후보로 다시 쓴다
    fs.rmSync(videoWorkFile(f.dataDir, "candidatesMd"));
    fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), "쓰던 고르기");
    const rewrite = await fetchCli(f, fake);
    assert.equal(rewrite.code, 0, rewrite.text);
    assert.equal(fake.calls.length, calls, "목록 다시 쓰기는 호출 0번");
    assert.ok(fs.existsSync(videoWorkFile(f.dataDir, "candidatesMd")), "후보 목록을 다시 썼다");
    assert.equal(fs.readFileSync(videoWorkFile(f.dataDir, "pick"), "utf8"), "쓰던 고르기", "고르기 파일은 그대로다");
    const n = (id: string) => cand.candidates.find((c) => c.videoId === id)!.n;
    const pickFile = videoWorkFile(f.dataDir, "pick");
    fs.writeFileSync(pickFile, JSON.stringify({ videos: [pick(n("FlowKrChrt1"), "us")] }));
    const check = cli(f.repo, ["video-check", "--run", f.runFile], f.env);
    assert.equal(check.code, 1);
    const bad = cli(f.repo, ["video-apply", "--run", f.runFile], f.env);
    assert.equal(bad.code, 1, bad.text);
    assert.match(bad.text, /1\/3번째 실패/);
    assert.ok(fs.existsSync(pickFile), "실패하면 작업 파일을 남긴다");
    const reasonA = "지어낸 심해 생물의 생태를 처음부터 끝까지 정리해 알려 준다.";
    fs.writeFileSync(
      pickFile,
      JSON.stringify({ videos: [pick(n("FlowKrChrt1"), "kr", [f.ids[0]!], reasonA), pick(n("FlowKoSci01"), "kr"), pick(n("FlowAiEng01"), "ai-en", [f.ids[0]!, f.ids[1]!])] }),
    );
    assert.equal(cli(f.repo, ["video-check", "--run", f.runFile], f.env).code, 0);
    const ok = cli(f.repo, ["video-apply", "--run", f.runFile], f.env);
    assert.equal(ok.code, 0, ok.text);
    assert.match(ok.text, /한국 2개, 미국 0개, AI 한국어 0개, AI 영어 1개, 관련 이슈를 붙인 영상 2개/);
    for (const name of VIDEO_WORK_FILES) assert.ok(!fs.existsSync(path.join(f.dataDir, "work", name)), `적용 뒤 ${name}이 없다`);
    const again = cli(f.repo, ["video-apply", "--run", f.runFile], f.env);
    assert.match(again.text, /이미 고르기 끝남/);
    // 고르기 뒤 같은 실행에서 다시 받아도 이 실행의 받기 기록(요약의 받기 줄)은 남는다
    const late = await fetchCli(f, fake);
    assert.match(late.text, /이미 고르기 끝남/);
    assert.equal(fake.calls.length, calls);
    const after = backupSiteSummary(f);
    assert.match(after.text, /영상이 있는 브리프 날짜 1개\(영상 3개\)/);
    for (const line of [
      /- 영상 대상 날짜: 2026-10-27/,
      /- 영상 받기: 받음/,
      /- KR 차트: 받은 차트 1개, 건너뛴 카테고리 0개/,
      /- 쓴 양: 검색 48번, 그 밖의 호출 \d+단위/,
      /- 후보: 거르기 전 4개 → 거른 뒤 4개\(뺀 것: 이미 추천함\(최근 30일\) 0, 생방송 중·예정 0, 4분 미만 0, 세로 영상 0, 상세 없음 0\)/,
      /- 영상 고르기: 한국 2개, 미국 0개, AI 한국어 0개, AI 영어 1개, 관련 이슈를 붙인 영상 2개 \(고쳐서 다시 검사 1번\)/,
      /- 30일 지난 영상 지움: 0개/,
      /- 사이트 빌드: .*영상이 있는 브리프 날짜 1개\(영상 3개\)/,
    ])
      assert.match(after.summary, line);
    const runText = fs.readFileSync(f.runFile, "utf8");
    const secrets = [FAKE_YT, "FlowKrChrt1", "FlowKoSci01", "FlowAiEng01", "가짜 다큐 첫째 제목", "가짜 과학 강연 제목", "Fake AI talk title", reasonA];
    for (const s of secrets) {
      for (const [name, text] of [["실행 기록", runText], ["요약", after.summary], ["받기 출력", fetched.text], ["적용 출력", ok.text], ["실패 출력", bad.text]] as const) {
        assert.ok(!text.includes(s), `${name}에 ${s}이(가) 없다`);
      }
    }
    for (const file of walkFiles(f.dataDir)) assert.ok(!fs.readFileSync(file).includes(FAKE_YT), `${file}에 키가 없다`);
    // 두 번째 받기: 이미 고르기 끝남이면 가짜 API를 부르지 않는다
    const second = goodYoutube();
    const r2 = await fetchCli(f, second);
    assert.equal(r2.code, 0);
    assert.match(r2.text, /2026-10-27 이미 고르기 끝남/);
    assert.equal(second.calls.length, 0);
  });

  test("4.2-7 키가 없을 때·모든 호출이 실패할 때·검색 일부만 할당량 초과일 때 고르기 끝남이 아니고 다음 실행의 대상이며, 뒤 단계가 끝까지 돈다", async () => {
    const cases: [string, NodeJS.ProcessEnv, FakeYoutube, RegExp][] = [
      ["키 없음", {}, goodYoutube(), /키 확인 필요/],
      ["모든 호출 실패", KEY_ENV, fakeYoutube({ fail: () => "network" }), /영상 받기: 실패/],
      ["검색 일부 할당량", KEY_ENV, fakeYoutube({ ...{ categories: { KR: ["27"], US: [] }, charts: { "KR 27": [[{ id: "QuotaKrVid1" }]] } }, fail: (u) => (topicOf(u.searchParams) === "우주" ? apiError(403, "quotaExceeded") : undefined) }), /할당량 초과, 태평양 시간 자정에 풀림/],
      ["인증 오류", KEY_ENV, fakeYoutube({ fail: () => apiError(400, "keyInvalid") }), /키 확인 필요/],
    ];
    for (const [name, env, fake, why] of cases) {
      const f = flowDir(env);
      const r = await fetchCli(f, fake);
      assert.equal(r.code, 1, `${name}: ${r.text}`);
      assert.match(r.text, why, name);
      assert.ok(!fs.existsSync(videoWorkFile(f.dataDir, "candidates")), `${name}: 후보 목록을 쓰지 않는다`);
      const st = readRun(f.runFile).videoFetch!;
      assert.equal(st.status, "failed", name);
      const done = backupSiteSummary(f);
      assert.match(done.summary, why, name);
      assert.match(done.summary, /- 백업: /);
      assert.match(done.summary, /- 사이트 빌드: /);
      const db = openDb(path.join(f.dataDir, "tidwyn.db"));
      assert.equal(isPicked(db, "2026-10-27"), false, name);
      db.close();
      assert.match(startFlow(f).text, /- 영상: 2026-10-27 받기 할 것/, `${name}: 다음 실행의 대상이다`);
    }
  });

  test("4.8-1 가짜 키를 넣고 인증·네트워크·할당량 오류를 낸 실행에서 실행 기록·요약·출력·작업 파일에 가짜 키가 없다", async () => {
    // 오류 본문과 네트워크 오류 메시지가 키를 되풀이해도 가려져야 한다
    const echo = (status: number, reason: string): YoutubeResponse => ({ status, body: JSON.stringify({ error: { code: status, message: `API key ${FAKE_YT} rejected (key=${FAKE_YT})`, errors: [{ reason, domain: "youtube.parameter" }] } }) });
    const cases: [string, FakeYoutube][] = [
      ["인증 오류", fakeYoutube({ fail: () => echo(400, "keyInvalid") })],
      ["네트워크 오류", fakeYoutube({ fail: () => { throw new TypeError(`fetch failed (key ${FAKE_YT}) https://www.googleapis.com/youtube/v3/search?key=${FAKE_YT}`); } })],
      ["할당량 오류", fakeYoutube({ fail: () => echo(403, "quotaExceeded") })],
    ];
    for (const [name, fake] of cases) {
      const f = flowDir(KEY_ENV);
      const r = await fetchCli(f, fake);
      assert.equal(r.code, 1, `${name}: ${r.text}`);
      assert.equal(readRun(f.runFile).videoFetch!.status, "failed", name);
      const done = backupSiteSummary(f);
      for (const [where, text] of [["받기 출력", r.text], ["실행 기록", fs.readFileSync(f.runFile, "utf8")], ["요약", done.summary], ["뒤 단계 출력", done.text]] as const)
        assert.ok(!text.includes(FAKE_YT), `${name}: ${where}에 가짜 키가 없다`);
      for (const file of walkFiles(f.dataDir)) assert.ok(!fs.readFileSync(file).includes(FAKE_YT), `${name}: ${file}에 가짜 키가 없다`);
    }
  });

  test("4.2-7 할당량 밖의 일부 실패면 받은 것으로 후보 목록을 쓰고 실패한 부분을 남긴다", async () => {
    const f = flowDir();
    const fake = fakeYoutube({
      categories: { KR: ["27", "28"], US: [] },
      charts: { "KR 27": [[{ id: "PartialKr01" }]] },
      fail: (u) => (u.searchParams.get("videoCategoryId") === "28" ? apiError(400, "invalidCategoryId") : topicOf(u.searchParams) === "역사" ? "network" : undefined),
    });
    const r = await fetchCli(f, fake);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /- 영상 받기: 일부만 받음/);
    assert.match(r.text, /- 실패: KR 28 차트: HTTP 400 invalidCategoryId/);
    assert.match(r.text, /- 실패: 한국어 검색 역사\(medium\): 네트워크 오류\(fetch failed <주소>\)/);
    const cand = JSON.parse(fs.readFileSync(videoWorkFile(f.dataDir, "candidates"), "utf8")) as CandidateFile;
    assert.deepEqual(cand.candidates.map((c) => c.videoId), ["PartialKr01"]);
    assert.match(backupSiteSummary(f).summary, /- 실패: KR 28 차트/);
  });

  test("4.3-4·4.3-5 고르기가 2번 고쳐도 실패하면 더 적용하지 않고 실패로 남으며 작업 파일이 남고, 다음 실행의 start가 지우며 그 날짜가 다시 대상이다", async () => {
    const f = flowDir();
    assert.equal((await fetchCli(f, goodYoutube())).code, 0);
    fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), JSON.stringify({ videos: [pick(999, "kr")] }));
    for (let i = 1; i <= 3; i++) assert.match(cli(f.repo, ["video-apply", "--run", f.runFile], f.env).text, new RegExp(`${i}/3번째 실패`));
    fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), JSON.stringify({ videos: [] }));
    const fourth = cli(f.repo, ["video-apply", "--run", f.runFile], f.env);
    assert.equal(fourth.code, 1);
    assert.match(fourth.text, /고쳐서 다시 검사를 2번 했는데도/);
    const done = backupSiteSummary(f);
    assert.match(done.summary, /- 영상 고르기 실패\(3번, 작업 파일을 남겼다, 다음 실행이 다시 받는다\)/);
    assert.match(done.summary, /- 사이트 빌드: /);
    for (const name of VIDEO_WORK_FILES.filter((x) => !/check|notes/.test(x))) assert.ok(fs.existsSync(path.join(f.dataDir, "work", name)), `실패 뒤 ${name}이 남는다`);
    const next = startFlow(f);
    assert.match(next.text, /- 영상: 2026-10-27 받기 할 것/);
    assert.match(next.text, /지난 실행의 영상 작업 파일 4개/);
    for (const name of VIDEO_WORK_FILES) assert.ok(!fs.existsSync(path.join(f.dataDir, "work", name)), `다음 실행의 start 뒤 ${name}이 없다`);
    assert.equal(readRun(next.runFile).videoPurge!.workFiles, 4, "정리가 실행 기록에 남는다");
  });

  test("4.2-1 새 명령은 실제 데이터 폴더 모드에서 실행 조건에 맞지 않으면 거부되고, 스킬 문서와 맞출 명령 이름이 CLI에 있다", async () => {
    for (const n of ["video-fetch", "video-check", "video-apply"]) assert.ok(COMMAND_NAMES.includes(n), n);
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    briefDb(["2026-10-27"], path.join(dataDir, "tidwyn.db")).close();
    gitIn(repo, "switch", "-q", "-c", "other");
    const runFile = path.join(dataDir, "runs", "r.json");
    const s: RunState = { startedAt: "2026-10-28T09:00:00+09:00", mode: "real", dataDir, dbPath: path.join(dataDir, "tidwyn.db"), backupRepo: null, noCommitReason: "x", targetDates: [], results: {}, backup: null };
    writeRun(runFile, s);
    const before = fs.readFileSync(s.dbPath);
    for (const argv of [["video-check", "--run", runFile], ["video-apply", "--run", runFile]]) {
      const x = cli(repo, argv, KEY_ENV);
      assert.equal(x.code, 3, x.text);
      assert.match(x.text, /실행 조건이 맞지 않아/);
    }
    const fake = goodYoutube();
    const x = await fetchCli({ repo, runFile, env: KEY_ENV }, fake);
    assert.equal(x.code, 3, x.text);
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(fs.readFileSync(s.dbPath), before);
  });
});

// ---- 4.1-2 30일 지우기(데이터 폴더 지정 흐름, 시험 폴더 V17) ----

const OLD = { d29: "2026-09-29", d30: "2026-09-28", d31: "2026-09-27" };
const IDS = { d29: "Keep29Video", d30: "Drop30Video", d31: "Drop31Video" };

/** 받은 날이 29·30·31일 전인 영상 기록이 든 DB */
function oldVideoDb(file: string, prefix = ""): void {
  const db = briefDb([OLD.d31, OLD.d30, OLD.d29], file);
  for (const k of ["d31", "d30", "d29"] as const) applyVideoPick(db, OLD[k], OLD[k], [newVideo(`${prefix}${IDS[k]}`, "kr", 1)]);
  db.close();
}

/** 지난 실행이 남긴 영상 작업 파일(받은 날 fetchedOn) */
function oldWorkFiles(dataDir: string, fetchedOn: string, prefix = ""): void {
  const work = path.join(dataDir, "work");
  fs.mkdirSync(work, { recursive: true });
  const f = buildCandidateFile(OLD.d30, fetchedOn, [], []);
  f.candidates.push({ n: 1, videoId: `${prefix}${IDS.d30}`, bundles: ["kr"], sources: [], title: "가짜", channel: "가짜", seconds: 600, categoryId: null, publishedAt: "", language: null, liveRecord: false, description: "", thumb: "" });
  fs.writeFileSync(path.join(work, "videos.candidates.json"), JSON.stringify(f));
  fs.writeFileSync(path.join(work, "videos.candidates.md"), renderCandidates(f, "x", "y"));
  fs.writeFileSync(path.join(work, "videos.details.md"), renderCandidateDetails(f));
  fs.writeFileSync(path.join(work, "videos.pick.json"), JSON.stringify({ videos: [pick(1, "kr")] }));
}

/** 30일 지난 영상이 든 사이트 입력·결과물 */
function oldSiteDirs(dataDir: string, prefix = ""): void {
  for (const d of ["site-input/site-data", "site/site-data"]) {
    fs.mkdirSync(path.join(dataDir, d), { recursive: true });
    fs.writeFileSync(path.join(dataDir, d, "list-2026-09.json"), JSON.stringify({ month: "2026-09", days: [{ date: OLD.d30, videos: [{ id: `${prefix}${IDS.d30}`, fetchedOn: OLD.d30 }] }] }));
  }
}

function snapshotOf(src: string, dataDir: string, name: string): string {
  const dir = path.join(dataDir, "snapshots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.copyFileSync(src, file);
  return file;
}

function versionOf(file: string): number {
  const db = openDb(file, []);
  try {
    return schemaVersion(db);
  } finally {
    db.close();
  }
}

function oldVersionDb(file: string, v: number): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = openDb(file, MIGRATIONS.filter((m) => m.version <= v));
  if (v >= 1) {
    recordFirstCollectionDate(db, OLD.d29);
    if (v >= 2) addBrief(db, OLD.d29);
  }
  db.close();
}

describe("7단계 4.1-2 30일 지우기", () => {
  test("start부터 빌드까지 돌리면 29일 전 것만 남고, 30·31일 전 영상 ID가 DB·모든 사본·작업 파일·사이트 입력과 결과물 바이트에 없으며, 옛 버전·깨진 사본은 규칙대로다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const dbFile = path.join(dataDir, "tidwyn.db");
    oldVideoDb(dbFile);
    // 실행 전 사본: 영상 기록이 든 새 버전 사본, 버전 4·6 사본, SQLite가 아닌 깨진 사본
    const withVideos = snapshotOf(dbFile, dataDir, "tidwyn-20261020-090000.db");
    const v4 = path.join(dataDir, "snapshots", "tidwyn-20261021-090000.db");
    const v6 = path.join(dataDir, "snapshots", "tidwyn-20261022-090000.db");
    oldVersionDb(v4, 4);
    oldVersionDb(v6, 6);
    const broken = path.join(dataDir, "snapshots", "tidwyn-20261023-090000.db");
    fs.writeFileSync(broken, `깨진 사본 ${IDS.d30}`);
    const v4Bytes = fs.readFileSync(v4);
    const v6Bytes = fs.readFileSync(v6);
    oldWorkFiles(dataDir, OLD.d30);
    oldSiteDirs(dataDir);
    const env = { ...KEY_ENV, TIDWYN_DATA_DIR: dataDir };
    const s = startFlow({ repo, env });
    assert.match(s.text, /- 30일 지난 영상 지움: 2개 \(그 밖에 실행 전 사본의 기록 4개, 열 수 없어 지운 실행 전 사본 1개\(tidwyn-20261023-090000\.db\), 지난 실행의 영상 작업 파일 4개, 사이트 입력·결과물 폴더 2개\)/);
    const p = readRun(s.runFile).videoPurge!;
    assert.deepEqual(p.removedSnapshots, ["tidwyn-20261023-090000.db"], "깨진 사본은 지워지고 실행 기록에 남는다");
    assert.equal(p.rows, 2);
    // 새로 만든 사본(오늘 시각)도 30일 지난 기록만 빠진다
    const newSnap = path.join(dataDir, "snapshots", "tidwyn-20261028-090000.db");
    assert.ok(fs.existsSync(newSnap) && fs.existsSync(withVideos));
    assert.ok(!fs.existsSync(broken));
    assert.deepEqual(fs.readFileSync(v4), v4Bytes, "버전 4 사본은 바이트 그대로");
    assert.deepEqual(fs.readFileSync(v6), v6Bytes, "버전 6 사본은 바이트 그대로");
    assert.equal(versionOf(v4), 4);
    assert.equal(versionOf(v6), 6);
    assert.equal(versionOf(withVideos), 9, "영상 기록이 있는 사본은 user_version 그대로");
    for (const snap of [withVideos, newSnap]) {
      const db = openDb(snap, []);
      assert.deepEqual(allVideos(db).map((v) => v.videoId), [IDS.d29], snap);
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM briefs").get() as { n: number }).n, 3, "그 밖의 데이터는 그대로");
      db.close();
    }
    backupSiteSummary({ repo, env, runFile: s.runFile });
    for (const id of [IDS.d30, IDS.d31]) assert.deepEqual(filesContaining(dataDir, id), [], `${id}가 데이터 폴더 어디에도 없다`);
    assert.ok(filesContaining(dataDir, IDS.d29).some((f) => f.endsWith("tidwyn.db")), "29일 전 것은 DB에 남는다");
    assert.ok(filesContaining(path.join(dataDir, "site"), IDS.d29).length > 0, "29일 전 것은 사이트에 남는다");
  });

  test("V17 시험 모드 이름 모양 폴더(-N 꼬리 포함)만 영상 데이터가 지워지고, 다른 이름의 폴더와 옛 버전·깨진 DB는 바이트 그대로다", () => {
    const repo = tempRepo();
    const root = path.join(repo, ".test-data");
    const shaped = path.join(root, "20260920-090000");
    const tailed = path.join(root, "20261001-090000-2");
    const other = path.join(root, "keep-me");
    const v1Dir = path.join(root, "20260901-090000");
    const v4Dir = path.join(root, "20260902-090000");
    const brokenDir = path.join(root, "20260903-090000");
    const recentWork = path.join(root, "20261020-090000");
    for (const [dir, prefix] of [[shaped, "A"], [tailed, "B"], [other, "C"]] as const) {
      oldVideoDb(path.join(dir, "tidwyn.db"), prefix);
      snapshotOf(path.join(dir, "tidwyn.db"), dir, "tidwyn-20260920-090000.db");
      oldWorkFiles(dir, OLD.d30, prefix);
      oldSiteDirs(dir, prefix);
      fs.mkdirSync(path.join(dir, "briefs"), { recursive: true });
      fs.writeFileSync(path.join(dir, "briefs", "note.md"), "그 밖의 데이터");
    }
    oldVersionDb(path.join(v1Dir, "tidwyn.db"), 1);
    oldVersionDb(path.join(v4Dir, "tidwyn.db"), 4);
    fs.mkdirSync(brokenDir, { recursive: true });
    fs.writeFileSync(path.join(brokenDir, "tidwyn.db"), "SQLite가 아닌 깨진 파일");
    oldWorkFiles(recentWork, "2026-10-20", "D");
    const snapshotBytes = (dir: string) => new Map(walkFiles(dir).map((f) => [f, fs.readFileSync(f)]));
    const otherBefore = snapshotBytes(other);
    const keepBefore = [v1Dir, v4Dir, brokenDir, recentWork].map(snapshotBytes);
    // 시험 모드 실행(새 시험 폴더가 생긴다)
    const s = cli(repo, ["start", "test"], KEY_ENV);
    assert.equal(s.code, 0, s.text);
    for (const [dir, prefix] of [[shaped, "A"], [tailed, "B"]] as const) {
      for (const id of [IDS.d30, IDS.d31]) assert.deepEqual(filesContaining(dir, `${prefix}${id}`), [], `${dir}에 ${prefix}${id}가 없다`);
      assert.ok(filesContaining(path.join(dir, "tidwyn.db"), `${prefix}${IDS.d29}`).length === 1, "29일 전 것은 남는다");
      assert.ok(!fs.existsSync(path.join(dir, "site-input")) && !fs.existsSync(path.join(dir, "site")), "30일 지난 영상이 든 site-input·site는 통째로 지운다");
      assert.ok(fs.existsSync(path.join(dir, "briefs", "note.md")), "그 밖의 데이터는 남는다");
      assert.equal(versionOf(path.join(dir, "tidwyn.db")), 9);
    }
    assert.deepEqual(snapshotBytes(other), otherBefore, "다른 이름의 폴더는 바이트 그대로");
    assert.deepEqual([v1Dir, v4Dir, brokenDir, recentWork].map(snapshotBytes), keepBefore, "옛 버전 DB·깨진 DB·30일 안의 작업 파일은 그대로");
    const p = readRun(/실행 기록: (.+)/.exec(s.text)![1]!).videoPurge!;
    assert.deepEqual(
      p.testDirs.map((t) => [t.dir, t.rows, t.snapshotRows, t.workFiles, t.siteDirs, t.unreadable]),
      [
        ["20260903-090000", 0, 0, 0, 0, ["tidwyn.db"]],
        ["20260920-090000", 2, 2, 4, 2, []],
        ["20261001-090000-2", 2, 2, 4, 2, []],
      ],
    );
    assert.match(s.text, /경고: 시험 폴더의 열 수 없는 DB를 지우지 않고 두었다\(사용자가 살펴본다\): 20260903-090000\/tidwyn\.db/);
  });
});

// ---- 4.6 사이트 데이터 ----

function issueDetail(files: Map<string, string>, id: number): IssueDetail {
  for (const [name, text] of files) {
    if (!/site-data\/issue-\d+\.json$/.test(name)) continue;
    const d = (JSON.parse(text) as IssueChunk).issues[String(id)];
    if (d) return d;
  }
  assert.fail(`이슈 ${id} 상세가 없다`);
}

function dayList(files: Map<string, string>, date: string): DayList {
  const text = files.get(`site-data/list-${date.slice(0, 7)}.json`)!;
  const day = (JSON.parse(text) as MonthList).days.find((d) => d.date === date);
  assert.ok(day, date);
  return day;
}

describe("7단계 4.6 사이트 데이터", () => {
  function siteDb() {
    const db = briefDb(["2026-10-25", "2026-10-26", "2026-10-27"]);
    const main = issue(db, "가짜 중력파 발견", [["2026-10-27", "한국-1"]]);
    const absorbed = issue(db, "가짜 중력파 검출기", [["2026-10-25", "한국-1"]]);
    const plain = issue(db, "가짜 별 탄생", [["2026-10-25", "세계-1"]]);
    applyVideoPick(db, "2026-10-25", "2026-10-25", [newVideo("SiteVid0001", "kr", 1, [absorbed])]);
    applyVideoPick(db, "2026-10-27", "2026-10-27", [
      newVideo("SiteVid0004", "ai-en", 1, [main]),
      newVideo("SiteVid0003", "us", 1),
      newVideo("SiteVid0002", "kr", 1, [main, absorbed]),
      newVideo("SiteVid0005", "kr", 2),
      newVideo("SiteVid0006", "ai-ko", 1),
    ]);
    applyVideoPick(db, "2026-10-26", "2026-10-26", []);
    merge(db, main, absorbed);
    return { db, ids: { main, absorbed, plain } };
  }

  test("4.6-1 날짜마다 영상(묶음 순, 고른 순서)과 이슈마다 관련 영상(흡수된 이슈 포함, 날짜 최근 순, 한 번)이 나오고, 영상이 없는 날짜·이슈에는 항목이 없으며 설명·통계가 없다", () => {
    const { db, ids } = siteDb();
    const files = buildSiteData(db);
    const d27 = dayList(files, "2026-10-27");
    assert.deepEqual(d27.videos!.map((v) => `${v.bundle} ${v.id}`), ["kr SiteVid0002", "kr SiteVid0005", "us SiteVid0003", "ai-ko SiteVid0006", "ai-en SiteVid0004"]);
    assert.deepEqual(d27.videos![0], {
      id: "SiteVid0002",
      bundle: "kr",
      title: "가짜 영상 제목 SiteVid0002",
      channel: "가짜 채널 SiteVid0002",
      seconds: 900,
      thumb: "https://i.example.com/vi/SiteVid0002/mqdefault.jpg",
      reason: "가짜 추천 이유 SiteVid0002",
      fetchedOn: "2026-10-27",
    });
    assert.deepEqual(dayList(files, "2026-10-25").videos!.map((v) => v.id), ["SiteVid0001"]);
    assert.ok(!("videos" in dayList(files, "2026-10-26")), "0개를 고른 날짜에는 항목이 없다");
    const main = issueDetail(files, ids.main);
    assert.deepEqual(main.videos!.map((v) => `${v.date} ${v.id}`), ["2026-10-27 SiteVid0002", "2026-10-27 SiteVid0004", "2026-10-25 SiteVid0001"]);
    assert.ok(!("videos" in issueDetail(files, ids.plain)), "영상이 없는 이슈에는 항목이 없다");
    // 영상 항목에는 정해진 항목만 있다(설명·통계·받은 곳·올린 시각을 싣지 않는다)
    const keys = new Set<string>();
    for (const [name, text] of files) {
      if (/site-data\/list-/.test(name)) for (const d of (JSON.parse(text) as MonthList).days) for (const v of d.videos ?? []) Object.keys(v).forEach((k) => keys.add(k));
      if (/site-data\/issue-\d+\.json$/.test(name)) for (const d of Object.values((JSON.parse(text) as IssueChunk).issues)) for (const v of d.videos ?? []) Object.keys(v).forEach((k) => keys.add(`issue:${k}`));
    }
    assert.deepEqual([...keys].sort(), ["bundle", "channel", "fetchedOn", "id", "issue:bundle", "issue:channel", "issue:date", "issue:fetchedOn", "issue:id", "issue:reason", "issue:seconds", "issue:thumb", "issue:title", "reason", "seconds", "thumb", "title"]);
    db.close();
  });

  test("4.6-2 영상이 있는 DB로 다른 날 두 번 만든 사이트 데이터가 같다(빌드는 시계를 쓰지 않는다)", () => {
    const { db } = siteDb();
    // 시계를 받은 날 다음 날과 40일 뒤로 바꿔 두 번 만든다(30일 경계를 넘겨도 빌드 결과가 같아야 한다)
    mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-28T00:00:00Z") });
    try {
      const a = buildSiteData(db);
      mock.timers.setTime(Date.parse("2026-12-07T00:00:00Z"));
      const b = buildSiteData(db);
      assert.deepEqual([...a], [...b]);
    } finally {
      mock.timers.reset();
      db.close();
    }
  });
});
