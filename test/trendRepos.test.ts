import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { BACKUP_FORMAT_VERSION, buildBackup, exportBackup, restoreBackup } from "../src/backup.ts";
import { main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import type { FetchResult, FetchText } from "../src/feeds.ts";
import { precheck } from "../src/precheck.ts";
import type { SiteBuilder } from "../src/publish.ts";
import { readRun } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import type { MonthList } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import {
  COPY_WORDS,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  README_MAX,
  TREND_FEED_URL,
  allRepoDays,
  checkRepoItems,
  cleanReadme,
  copiesRun,
  repoWorkFile,
  saveRepoDay,
  splitDescription,
  type RepoCandidate,
  type RepoCandidatesFile,
} from "../src/trendRepos.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

after(cleanupTemp);

// B1단계 저장소 받기·검사·저장·백업(명세서 4.1, 4.2-2~4.2-4, 4.2-6, 4.3-1). 피드는 2.2의 칸 모양(채널 pubDate, 항목의 title·link·description,
// pubDate·guid 없음, description은 엔터티로 감싼 HTML)을 따른 가짜 응답이고, 저장소 이름과 README 글은 모두 지어낸 것이다.

const DATE = "2026-10-27";
/** NOW(KST 2026-10-28 09:00 = 2026-10-28T00:00Z)보다 하루쯤 앞선 채널 시각 */
const FRESH = "Tue, 27 Oct 2026 10:35:01 GMT";

// ---- 가짜 피드 ----

function xmlEscape(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

interface FakeItem {
  title?: string;
  link: string;
  html: string;
}

function feedXml(items: FakeItem[], pubDate: string | null = FRESH): string {
  const channelDate = pubDate === null ? "" : `    <pubDate>${pubDate}</pubDate>\n`;
  const body = items
    .map((i) => `    <item>\n      <title>${xmlEscape(i.title ?? i.link.replace("https://github.com/", ""))}</title>\n      <link>${i.link}</link>\n      <description>${xmlEscape(i.html)}</description>\n      <media:content url="https://example.org/fake.png" medium="image" />\n    </item>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">\n  <channel>\n    <title>Fake Weekly Trending</title>\n    <description>Fake weekly list</description>\n${channelDate}    <link>https://example.org/fake-trending</link>\n${body}\n  </channel>\n</rss>\n`;
}

const HOMEPAGE = `<p><img src="https://example.org/assets/icons/link.png" width="20" height="20" alt="link" /><a href="https://glimmer.example.com">https://glimmer.example.com</a></p>`;
const BODY_SENTENCE = "Glimmerbox folds imaginary weather notes into tidy morning reports for practice teams.";

/** 지어낸 README HTML. 본문 문장 하나와 정리할 것(배지 줄, 머리, 이미지) */
function readmeHtml(name: string): string {
  return `<div align="center"><h1>${name}</h1></div>\n<p align="center"><a href="https://fake.example.com/b"><img src="https://img.example.com/badge/fake-1-blue" alt="fake" /></a> <a href="https://fake.example.com/c"><img src="https://img.example.com/badge/fake-2-green" alt="fake" /></a></p>\n<h2>What is it</h2>\n<p>${BODY_SENTENCE}</p>\n<p><img src="https://img.example.com/shot.png" alt="shot" /></p>`;
}

function repoHtml(name: string, summary = `${name} is a made-up tool used only in tests.`): string {
  return `<p>${summary}</p>${HOMEPAGE}<hr>${readmeHtml(name)}`;
}

function item(name: string, html = repoHtml(name)): FakeItem {
  return { link: `https://github.com/${name}`, html };
}

const DEFAULT_ITEMS = ["fakeorg/alpha-kit", "fakeorg/beta-tool", "sample-lab/gamma", "sample-lab/delta-cli", "demo-co/epsilon", "demo-co/zeta-app", "mock-dev/eta"].map((n) => item(n));

interface FakeFetch extends FetchText {
  calls: string[];
}

function fakeFetch(answer: () => FetchResult | Error | Promise<FetchResult>): FakeFetch {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const a = await answer();
    if (a instanceof Error) throw a;
    return a;
  }) as FakeFetch;
  f.calls = calls;
  return f;
}

const okFeed = (items: FakeItem[] = DEFAULT_ITEMS, pubDate: string | null = FRESH) => fakeFetch(() => ({ status: 200, text: feedXml(items, pubDate) }));

// ---- 실행 준비 ----

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

interface Setup {
  repo: string;
  dataDir: string;
  dbPath: string;
  runFile: string;
  env: NodeJS.ProcessEnv;
}

/** 데이터 폴더 지정 실행: 브리프 날짜들을 DB에 저장한 뒤 start */
function setup(dates: string[] = [DATE], opts: { now?: Date; repo?: string; dataDir?: string } = {}): Setup {
  const repo = opts.repo ?? tempRepo();
  const dataDir = opts.dataDir ?? tempDir();
  const dbPath = path.join(dataDir, "tidwyn.db");
  if (dates.length > 0) {
    const db = openDb(dbPath);
    if (dates[0]) recordFirstCollectionDate(db, dates[0]);
    for (const d of dates) addBrief(db, d);
    db.close();
  }
  const env = { TIDWYN_DATA_DIR: dataDir };
  const ctx = makeCtx(repo, env, opts.now ?? NOW);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  return { repo, dataDir, dbPath, runFile: /실행 기록: (.+)/.exec(ctx.text())![1]!, env };
}

async function fetchStep(s: Setup, fetch: FetchText, now = NOW): Promise<{ code: number; text: string }> {
  const ctx = makeCtx(s.repo, s.env, now);
  ctx.fetchText = fetch;
  const code = await mainAsync(["repo-fetch", "--run", s.runFile], ctx);
  return { code, text: ctx.text() };
}

function cli(s: Setup, argv: string[]): { code: number; text: string } {
  const ctx = makeCtx(s.repo, s.env);
  const code = main([...argv, "--run", s.runFile], ctx);
  return { code, text: ctx.text() };
}

function withDb<T>(s: Setup, f: (db: DatabaseSync) => T): T {
  const db = openDb(s.dbPath);
  try {
    return f(db);
  } finally {
    db.close();
  }
}

function dayRows(s: Setup): { date: string; status: string }[] {
  return withDb(s, (db) => (db.prepare("SELECT date, status FROM trend_repo_days ORDER BY date").all() as { date: string; status: string }[]).map((r) => ({ ...r })));
}

function repoRows(s: Setup): Record<string, unknown>[] {
  return withDb(s, (db) => (db.prepare("SELECT * FROM trend_repos ORDER BY date, rank").all() as Record<string, unknown>[]).map((r) => ({ ...r })));
}

function candidates(s: Setup): RepoCandidatesFile {
  return JSON.parse(fs.readFileSync(repoWorkFile(s.dataDir, "candidates"), "utf8")) as RepoCandidatesFile;
}

function writeItems(s: Setup, data: unknown): void {
  const f = repoWorkFile(s.dataDir, "items");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data));
}

/** 정확히 n자인 지어낸 한국어 설명(주소·인용 모양이 없다) */
function desc(n: number, seed = "가"): string {
  const base = `${seed} 저장소는 지어낸 도구로, 시험용 날씨 메모를 모아 아침 보고서로 정리해 준다. 명령 한 줄로 설치하고 설정 파일 하나로 쓴다. 작은 팀에게 쓸모 있다. `;
  let t = "";
  while (Array.from(t).length < n) t += base;
  const chars = Array.from(t).slice(0, n);
  if (/\s/.test(chars[n - 1] ?? "")) chars[n - 1] = "다";
  return chars.join("");
}

// ---- 4.1-1 받기와 대상 날짜 ----

describe("B1 4.1-1 받기 명령", () => {
  const failures: [string, () => FakeFetch, RegExp][] = [
    ["네트워크 오류", () => fakeFetch(() => new Error("getaddrinfo ENOTFOUND fake.example")), /받기 오류: getaddrinfo ENOTFOUND/],
    ["시간 초과", () => fakeFetch(() => Object.assign(new Error("aborted"), { name: "TimeoutError" })), /시간 초과/],
    ["200이 아닌 응답", () => fakeFetch(() => ({ status: 503, text: "" })), /HTTP 503/],
    ["RSS 형식 오류", () => fakeFetch(() => ({ status: 200, text: "<html><body>not a feed</body></html>" })), /RSS 형식이 아니다/],
    ["채널 pubDate 없음", () => okFeed(DEFAULT_ITEMS, null), /채널 pubDate가 없다/],
    ["항목 0개", () => okFeed([]), /항목이 0개다/],
    ["오래된 피드(3일 1초 전)", () => okFeed(DEFAULT_ITEMS, "Sat, 24 Oct 2026 23:59:59 GMT"), /피드가 오래됐다/],
  ];
  for (const [name, make, reason] of failures) {
    test(`실패(${name})는 그 날짜를 받지 못함으로 저장하고 이유를 실행 기록에 남기며 종료 코드 0이다`, async () => {
      const s = setup();
      const f = make();
      const r = await fetchStep(s, f);
      assert.equal(r.code, 0, r.text);
      assert.deepEqual(f.calls, [TREND_FEED_URL], "피드를 한 번 받는다");
      assert.deepEqual(dayRows(s), [{ date: DATE, status: "failed" }]);
      const st = readRun(s.runFile).repos;
      assert.equal(st?.status, "failed");
      assert.match(st?.status === "failed" ? st.reason : "", reason);
      assert.ok(!fs.existsSync(repoWorkFile(s.dataDir, "candidates")), "후보 파일을 쓰지 않는다");
      const sum = cli(s, ["summary"]);
      assert.match(sum.text, new RegExp(`- 저장소\\(${DATE}\\): 받지 못함\\(${reason.source}`));
    });
  }

  test("정확히 3일 전 채널 시각은 통과하고, 항목에 pubDate·guid가 없는 실제 모양의 피드로 후보를 쓴다", async () => {
    const s = setup();
    const r = await fetchStep(s, okFeed(DEFAULT_ITEMS, "Sun, 25 Oct 2026 00:00:00 GMT"));
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /후보 7개/);
    assert.equal(candidates(s).candidates.length, 7);
    assert.deepEqual(readRun(s.runFile).repos, { status: "fetched", date: DATE, candidates: 7 });
    assert.deepEqual(dayRows(s), [], "저장 전에는 기록이 없다");
  });

  for (const done of ["shown", "none"] as const) {
    test(`그 날짜가 이미 ${done}이면 피드를 받지 않고 이미 끝남을 출력한다`, async () => {
      const s = setup();
      withDb(s, (db) => saveRepoDay(db, DATE, done, done === "shown" ? [{ rank: 1, name: "fakeorg/old", url: "https://github.com/fakeorg/old", description: desc(150) }] : []));
      const f = okFeed();
      const r = await fetchStep(s, f);
      assert.equal(r.code, 0);
      assert.equal(f.calls.length, 0, "호출 0");
      assert.match(r.text, /이미 끝남/);
      assert.match(cli(s, ["summary"]).text, new RegExp(`- 저장소\\(${DATE}\\): 이미 끝남`));
    });
  }

  test("받지 못함인 날짜는 같은 날짜로 다시 돌리면 다시 받는다", async () => {
    const s = setup();
    await fetchStep(s, fakeFetch(() => ({ status: 500, text: "" })));
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "failed" }]);
    const s2 = setup([], { repo: s.repo, dataDir: s.dataDir });
    const f = okFeed();
    await fetchStep(s2, f);
    assert.equal(f.calls.length, 1);
    assert.equal(readRun(s2.runFile).repos?.status, "fetched");
  });

  test("저장된 브리프가 없으면 대상 없음이고 피드를 받지 않는다", async () => {
    const s = setup([]);
    const f = okFeed();
    const r = await fetchStep(s, f);
    assert.equal(r.code, 0);
    assert.equal(f.calls.length, 0);
    assert.match(r.text, /대상 없음/);
    assert.deepEqual(readRun(s.runFile).repos, { status: "noTarget" });
  });

  test("대상 날짜는 가장 늦은 저장된 브리프 날짜이고 앞 날짜에는 기록이 생기지 않는다", async () => {
    const s = setup(["2026-10-25", "2026-10-26", DATE]);
    await fetchStep(s, fakeFetch(() => ({ status: 500, text: "" })));
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "failed" }]);
  });
});

// ---- 4.1-2 후보 만들기와 정리 ----

describe("B1 4.1-2 후보 파일", () => {
  test("피드 순서대로 순위를 매기고, 주소 모양이 틀린 것·이미 실린 키(대소문자 무시)·같은 피드 안 중복을 빼며, 표시 이름은 link 경로에서 뽑는다", async () => {
    const s = setup(["2026-10-26", DATE]);
    withDb(s, (db) => saveRepoDay(db, "2026-10-26", "shown", [{ rank: 2, name: "FakeOrg/Beta-Tool", url: "https://github.com/FakeOrg/Beta-Tool", description: desc(150) }]));
    const items: FakeItem[] = [
      { ...item("fakeorg/alpha-kit"), title: "totally/different-title" },
      item("fakeorg/beta-tool"),
      { link: "https://gitlab.example.com/x/y", html: repoHtml("x/y") },
      { link: "https://github.com/onlyowner", html: repoHtml("onlyowner") },
      item("Sample-Lab/Gamma"),
      item("sample-lab/gamma"),
      item("brand-new/one"),
    ];
    const r = await fetchStep(s, okFeed(items));
    assert.equal(r.code, 0, r.text);
    const c = candidates(s);
    assert.deepEqual(
      c.candidates.map((x) => [x.candidate, x.rank, x.name, x.key, x.url]),
      [
        [1, 1, "fakeorg/alpha-kit", "fakeorg/alpha-kit", "https://github.com/fakeorg/alpha-kit"],
        [2, 5, "Sample-Lab/Gamma", "sample-lab/gamma", "https://github.com/Sample-Lab/Gamma"],
        [3, 7, "brand-new/one", "brand-new/one", "https://github.com/brand-new/one"],
      ],
    );
    assert.deepEqual(c.counts, { feedItems: 7, badUrl: 2, alreadyShown: 1, duplicate: 1 });
    assert.ok(!JSON.stringify(c).includes("totally/different-title"), "피드 title은 쓰지 않는다");
  });

  test("description의 네 경우: 한 줄 설명은 <hr> 앞 첫 <p>일 때만 쓰고, 설명이 없으면 비우되 README 본문은 남으며 받기가 실패하지 않는다", async () => {
    const s = setup();
    const readme = readmeHtml("Glimmerbox");
    const items: FakeItem[] = [
      item("case/one", `<p>Case one summary line.</p>${HOMEPAGE}<hr>${readme}`),
      item("case/one-b", `<p>Case one-b summary line.</p><hr>${readme}`),
      item("case/two", `${HOMEPAGE}${readme}`),
      item("case/three", `<h1>Three</h1>\n<p>${BODY_SENTENCE}</p><hr><p>After a rule.</p>`),
      item("case/four", `<p style="color:#586069;"><em>No description/README provided.</em></p>`),
    ];
    const r = await fetchStep(s, okFeed(items));
    assert.equal(r.code, 0, r.text);
    const byName = new Map(candidates(s).candidates.map((x) => [x.name, x]));
    assert.equal(byName.get("case/one")!.summary, "Case one summary line.");
    assert.match(byName.get("case/one")!.readme, /Glimmerbox folds imaginary weather notes/);
    assert.ok(!byName.get("case/one")!.readme.includes("glimmer.example.com"), "홈페이지 링크 문단은 README가 아니다");
    assert.equal(byName.get("case/one-b")!.summary, "Case one-b summary line.");
    assert.equal(byName.get("case/two")!.summary, "");
    assert.match(byName.get("case/two")!.readme, /Glimmerbox folds imaginary weather notes/);
    assert.ok(!byName.get("case/two")!.readme.includes("glimmer.example.com"));
    // 셋째 경우: README가 바로 시작한다. README 안의 <hr>는 설명으로 보지 않는다
    assert.equal(byName.get("case/three")!.summary, "");
    assert.match(byName.get("case/three")!.readme, /Glimmerbox folds imaginary weather notes[\s\S]*After a rule\./);
    assert.deepEqual([byName.get("case/four")!.summary, byName.get("case/four")!.readme], ["", ""]);
    assert.equal(readRun(s.runFile).repos?.status, "fetched");
  });

  test("정리 규칙: 닫히지 않은 주석, 배지만 있는 줄, 링크만 있는 줄, 이미지, 서식 문자, 제어 문자, `#` 머리는 남지 않고 본문 문장은 남는다", () => {
    const html = [
      "<h1>Glimmerbox</h1>",
      "# Raw hash heading line",
      '<p><a href="https://fake.example.com/b"><img src="https://img.example.com/badge/a" alt="badge" /></a></p>',
      "[![badge](https://img.example.com/b.svg)](https://fake.example.com/x)",
      '<p><a href="https://fake.example.com/docs">Docs</a> | <a href="https://fake.example.com/site">Site</a></p>',
      "https://fake.example.com/only-a-link",
      `<p>${BODY_SENTENCE}</p>`,
      "<p>Zero​width and bidi‮text\u0007bell.</p>",
      "<!-- closed hidden note -->",
      '<p>Inline <a href="https://fake.example.com/z">link text</a> stays.</p>',
      "<p>Last visible line.</p>",
      "<!-- unclosed hidden note to the end",
      "<p>Should not appear.</p>",
    ].join("\n");
    const t = cleanReadme(html);
    assert.match(t, /^Glimmerbox$/m, "머리 글은 남되 # 없이");
    assert.match(t, /^Raw hash heading line$/m);
    assert.ok(!/^#/m.test(t), "#으로 시작하는 줄이 없다");
    assert.ok(!/badge|img\.example|only-a-link|Docs|Site\b/.test(t), t);
    assert.ok(t.includes(BODY_SENTENCE));
    assert.match(t, /Zerowidth and biditextbell\./, "서식·제어 문자를 뺀다");
    assert.ok(!/\p{Cf}/u.test(t) && !/\p{Cc}/u.test(t.replaceAll("\n", "")));
    assert.match(t, /Inline link text stays\./);
    assert.match(t, /Last visible line\./);
    assert.ok(!/hidden note|Should not appear|<|>/.test(t), t);
    assert.ok(!/\n\n\n/.test(t), "연속 빈 줄을 줄인다");
  });

  test("README는 정리한 뒤 3,000자로 자른다", () => {
    const long = `<p>${"word ".repeat(2000)}</p>`;
    const t = cleanReadme(long);
    assert.equal(Array.from(t).length <= README_MAX, true);
    assert.ok(Array.from(t).length >= README_MAX - 5, String(Array.from(t).length));
    const { readme } = splitDescription(`<p>Short.</p><hr>${long}`);
    assert.ok(Array.from(readme).length <= README_MAX);
  });

  test("후보가 0개(모두 이미 실림)면 그 날짜를 새로 오른 것 없음으로 저장한다", async () => {
    const s = setup(["2026-10-26", DATE]);
    withDb(s, (db) => saveRepoDay(db, "2026-10-26", "shown", [{ rank: 1, name: "fakeorg/alpha-kit", url: "https://github.com/fakeorg/alpha-kit", description: desc(150) }]));
    const r = await fetchStep(s, okFeed([item("FAKEORG/alpha-kit")]));
    assert.equal(r.code, 0);
    assert.deepEqual(dayRows(s), [
      { date: "2026-10-26", status: "shown" },
      { date: DATE, status: "none" },
    ]);
    assert.match(cli(s, ["summary"]).text, new RegExp(`- 저장소\\(${DATE}\\): 새로 오른 것 없음`));
  });
});

// ---- 4.2-2 항목 파일 검사 ----

function cand(n: number, name: string, extra: Partial<RepoCandidate> = {}): RepoCandidate {
  return { candidate: n, key: name.toLowerCase(), name, url: `https://github.com/${name}`, rank: n, summary: `${name} is a made-up tool.`, readme: BODY_SENTENCE, ...extra };
}

function candFile(n = 7): RepoCandidatesFile {
  return {
    date: DATE,
    fetchedAt: "2026-10-28T09:00:00+09:00",
    feedUpdatedAt: "2026-10-27T19:35:01+09:00",
    counts: { feedItems: n, badUrl: 0, alreadyShown: 0, duplicate: 0 },
    candidates: Array.from({ length: n }, (_, i) => cand(i + 1, `fakeorg/tool-${i + 1}`)),
  };
}

function check(raw: unknown, cands = candFile(), home: string | null = null) {
  return checkRepoItems(raw, cands, new Set(), home);
}

const whys = (r: ReturnType<typeof check>) => r.violations.map((v) => `${v.where}: ${v.why}`);

describe("B1 4.2-2 항목 파일 검사", () => {
  test("개수 경계: 0개와 5개는 통과하고 6개는 위반이다", () => {
    assert.deepEqual(whys(check({ date: DATE, items: [] })), []);
    const five = [1, 2, 3, 4, 5].map((n) => ({ candidate: n, description: desc(150, String(n)) }));
    assert.deepEqual(whys(check({ date: DATE, items: five })), []);
    const six = [...five, { candidate: 6, description: desc(150, "6") }];
    assert.ok(whys(check({ date: DATE, items: six })).some((w) => /6개다\(5개 이하/.test(w)));
  });

  test(`설명 길이 경계: ${DESCRIPTION_MIN - 1}자와 ${DESCRIPTION_MAX + 1}자는 위반, ${DESCRIPTION_MIN}자와 ${DESCRIPTION_MAX}자는 통과`, () => {
    const one = (n: number) => whys(check({ date: DATE, items: [{ candidate: 1, description: desc(n) }] }));
    assert.ok(one(DESCRIPTION_MIN - 1).some((w) => /119자다/.test(w)));
    assert.deepEqual(one(DESCRIPTION_MIN), []);
    assert.deepEqual(one(DESCRIPTION_MAX), []);
    assert.ok(one(DESCRIPTION_MAX + 1).some((w) => /401자다/.test(w)));
  });

  test("형식 오류, 후보에 없는 번호, 같은 번호 두 번, 후보 값 칸, 다른 날짜, 뺀 번호 오류는 위반이다", () => {
    assert.ok(whys(check([])).some((w) => /항목 파일: 객체여야 한다/.test(w)));
    assert.ok(whys(check({ date: DATE, items: "x" })).some((w) => /목록이어야 한다/.test(w)));
    assert.ok(whys(check({ date: DATE, items: [], extra: 1 })).some((w) => /알 수 없는 항목 "extra"/.test(w)));
    assert.ok(whys(check({ date: "2026-10-26", items: [] })).some((w) => /date: 대상 날짜 2026-10-27/.test(w)));
    assert.ok(whys(check({ date: DATE, items: [{ candidate: 99, description: desc(150) }] })).some((w) => /후보 99은\(는\) 후보 파일에 없다/.test(w)));
    assert.ok(whys(check({ date: DATE, items: [{ candidate: "1", description: desc(150) }] })).some((w) => /후보 번호\(정수\)/.test(w)));
    const dup = check({ date: DATE, items: [{ candidate: 2, description: desc(150) }, { candidate: 2, description: desc(150, "나") }] });
    assert.ok(whys(dup).some((w) => /후보 2이\(가\) 두 번 나온다/.test(w)));
    for (const field of ["name", "url", "rank"]) {
      const r = check({ date: DATE, items: [{ candidate: 1, description: desc(150), [field]: field === "rank" ? 1 : "fakeorg/x" }] });
      assert.ok(whys(r).some((w) => new RegExp(`후보 값 칸 "${field}"`).test(w)), field);
    }
    assert.ok(whys(check({ date: DATE, items: [], excluded: [42] })).some((w) => /excluded 1: 후보 42/.test(w)));
    assert.ok(whys(check({ date: DATE, items: [{ candidate: 1, description: desc(150) }], excluded: [1] })).some((w) => /items에도 있다/.test(w)));
  });

  test("설명에 주소·메일 모양, 15단어 이상 인용, 결과물 검사가 거부하는 글이 있으면 위반이다", () => {
    const with_ = (extra: string, home: string | null = null) => whys(check({ date: DATE, items: [{ candidate: 1, description: `${desc(140)} ${extra}` }] }, candFile(), home));
    assert.ok(with_("자세한 것은 https://fake.example.com 에 있다.").some((w) => /주소 모양/.test(w)));
    assert.ok(with_("홈은 fakeproject.io 이다.").some((w) => /주소 모양/.test(w)));
    assert.ok(with_("문의는 someone@example.com 로 한다.").some((w) => /메일 주소 모양/.test(w)));
    const quote = `"${Array.from({ length: 15 }, (_, i) => `w${i}`).join(" ")}"`;
    assert.ok(with_(`소개 문구는 ${quote} 이다.`).some((w) => /따옴표 안 인용이 15단어다/.test(w)));
    assert.ok(with_("설정은 /home/faketester/conf 에 둔다.", "/home/faketester").some((w) => /공개할 수 없는 글: 홈 폴더 절대 경로/.test(w)));
  });

  test(`재료와 따옴표 없이 같은 ${COPY_WORDS}낱말은 위반이고 14낱말은 통과한다(대소문자·앞뒤 문장부호 무시)`, () => {
    const src = "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho.";
    const cands = candFile();
    cands.candidates[0] = cand(1, "fakeorg/tool-1", { readme: src, summary: "" });
    const words = src.replace(".", "").split(" ");
    const take = (n: number) => words.slice(0, n).join(" ").toUpperCase().replace("GAMMA", "(gamma,");
    const r15 = check({ date: DATE, items: [{ candidate: 1, description: `${desc(140)} ${take(15)}` }] }, cands);
    assert.ok(whys(r15).some((w) => /재료와 연속 15낱말/.test(w)), whys(r15).join("\n"));
    const r14 = check({ date: DATE, items: [{ candidate: 1, description: `${desc(140)} ${take(14)}` }] }, cands);
    assert.deepEqual(whys(r14), []);
    assert.equal(copiesRun("a b c", ["a b c"], 3), true);
    assert.equal(copiesRun("a b", ["a b c"], 3), false);
    // 한 줄 설명에서 옮긴 것도 잡는다
    cands.candidates[0] = cand(1, "fakeorg/tool-1", { summary: src, readme: "" });
    assert.ok(whys(check({ date: DATE, items: [{ candidate: 1, description: `${desc(140)} ${take(15)}` }] }, cands)).some((w) => /재료와 연속/.test(w)));
  });

  test("정상 글(owner/name, README.md, Node.js, 이름이 cal.com인 저장소가 제 이름을 쓴 설명)은 통과한다", () => {
    const cands = candFile();
    cands.candidates[0] = cand(1, "calfake/cal.com");
    const text = `${desc(150)} calfake/cal.com 저장소의 cal.com 앱은 README.md 안내대로 Node.js 22에서 돈다.`;
    assert.deepEqual(whys(check({ date: DATE, items: [{ candidate: 1, description: text }] }, cands)), []);
    const other = `${desc(150)} fakeorg/tool-2 저장소는 README.md 안내대로 Node.js 22에서 돈다.`;
    assert.deepEqual(whys(check({ date: DATE, items: [{ candidate: 2, description: other }] })), []);
    const end = `${desc(150)} 일정은 cal.com.`;
    assert.deepEqual(whys(check({ date: DATE, items: [{ candidate: 1, description: end }] }, cands)), []);
    const colon = `cal.com: ${desc(150)}`;
    assert.deepEqual(whys(check({ date: DATE, items: [{ candidate: 1, description: colon }] }, cands)), []);
  });

  test("이름과 같은 낱말은 낱말 전체가 같을 때만 빼므로, 이름이 흔한 낱말이어도 다른 도메인은 주소 모양으로 걸린다(보안 리뷰 지적)", () => {
    const cases: [string, string][] = [
      ["fakeorg/app", "자세한 것은 evil.app 에 있다."],
      ["c/com", "홈은 evil.com 이다."],
      ["dev/kit", "주소는 kit.dev 이다."],
      ["https/kit", "주소는 https://evil.example.xyz 이다."],
    ];
    for (const [name, extra] of cases) {
      const cands = candFile();
      cands.candidates[0] = cand(1, name);
      const r = check({ date: DATE, items: [{ candidate: 1, description: `${desc(140)} ${extra}` }] }, cands);
      assert.ok(whys(r).some((w) => /주소 모양/.test(w)), name);
    }
  });

  test("후보 파일의 이름·주소·순위가 받은 값의 모양이 아니면 위반이다(후보 파일이 바뀐 경우, 보안 리뷰 지적)", () => {
    const bad: Partial<RepoCandidate>[] = [
      { url: "https://evil.example.com/fakeorg/tool-1" },
      { url: "javascript:alert(1)" },
      { name: "fakeorg/other" },
      { key: "fakeorg/other" },
      { rank: 0 },
      { rank: 1.5 },
      // 타입이 틀린 값도 예외 없이 위반으로 끝난다
      { name: 42 as unknown as string },
      { name: undefined as unknown as string },
      { summary: null as unknown as string },
      { readme: 7 as unknown as string },
    ];
    for (const extra of bad) {
      const cands = candFile();
      cands.candidates[0] = cand(1, "fakeorg/tool-1", extra);
      const r = check({ date: DATE, items: [{ candidate: 1, description: desc(150) }] }, cands);
      assert.ok(whys(r).some((w) => /받은 값의 모양이 아니다/.test(w)), JSON.stringify(extra));
      // 뺀 후보(excluded) 쪽도 같은 확인을 한다(요약에 이름이 나가므로)
      const rx = check({ date: DATE, items: [], excluded: [1] }, cands);
      assert.ok(whys(rx).some((w) => /excluded 1: 후보 1의 이름·주소·순위가 받은 값의 모양이 아니다/.test(w)), `excluded ${JSON.stringify(extra)}`);
      assert.deepEqual(rx.excluded, []);
    }
  });

  test("repo-check 위반 출력에는 위치와 이유만 있고 README·설명 글이 실리지 않는다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    const secretish = "UNIQUEFAKEPHRASE";
    const quote = `"${Array.from({ length: 16 }, (_, i) => `${secretish}${i}`).join(" ")}"`;
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: `${desc(150)} ${quote} https://leak.example.com` }, { candidate: 2, description: `${BODY_SENTENCE} ${BODY_SENTENCE}` }, { candidate: 1, description: "짧다" }] });
    const r = cli(s, ["repo-check"]);
    assert.equal(r.code, 1);
    assert.match(r.text, /저장소 검사 실패\(2026-10-27\), 위반 \d+개/);
    assert.match(r.text, /항목 1\(후보 1\) description: 따옴표 안 인용/);
    assert.ok(!r.text.includes(secretish) && !r.text.includes("leak.example") && !r.text.includes("Glimmerbox") && !r.text.includes("짧다"), r.text);
    writeItems(s, "{not json UNIQUEFAKEPHRASE");
    const bad = cli(s, ["repo-check"]);
    assert.equal(bad.code, 1);
    assert.match(bad.text, /항목 파일이 올바른 JSON이 아니다/);
    assert.ok(!bad.text.includes(secretish));
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: desc(150) }] });
    assert.equal(cli(s, ["repo-check"]).code, 0);
  });
});

// ---- 4.2-3 저장 ----

describe("B1 4.2-3 저장", () => {
  test("이름·주소·순위는 후보 파일 값으로 저장하고, 다시 저장해도 행 수가 같으며 덮지 않는다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    const c = candidates(s);
    writeItems(s, { date: DATE, items: [{ candidate: 3, description: desc(150, "셋") }, { candidate: 1, description: desc(160, "하나") }] });
    const r = cli(s, ["repo-apply"]);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /실음 2개/);
    const rows = repoRows(s);
    assert.deepEqual(
      rows.map((x) => [x.date, x.rank, x.key, x.name, x.url]),
      [1, 3].map((n) => {
        const x = c.candidates.find((y) => y.candidate === n)!;
        return [DATE, x.rank, x.key, x.name, x.url];
      }),
    );
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "shown" }]);
    writeItems(s, { date: DATE, items: [{ candidate: 2, description: desc(150) }] });
    const again = cli(s, ["repo-apply"]);
    assert.equal(again.code, 0);
    assert.match(again.text, /이미 끝남/);
    assert.deepEqual(repoRows(s), rows, "다시 저장해도 같다");
  });

  test("후보를 모두 거른 0개 항목 파일은 새로 오른 것 없음으로 저장한다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    writeItems(s, { date: DATE, items: [] });
    assert.equal(cli(s, ["repo-apply"]).code, 0);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "none" }]);
  });

  test("후보 값 칸이 든 항목 파일은 저장되지 않고 받지 못함(검사 위반)이 되며, 같은 날짜로 다시 돌리면 다시 받는다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: desc(150), name: "someone/else", url: "https://github.com/someone/else" }] });
    const r = cli(s, ["repo-apply"]);
    assert.equal(r.code, 1);
    assert.deepEqual(repoRows(s), []);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "failed" }]);
    const st = readRun(s.runFile).repos;
    assert.equal(st?.status === "failed" && st.reason, "검사 위반");
    assert.match(cli(s, ["summary"]).text, /- 저장소\(2026-10-27\): 받지 못함\(검사 위반\)[\s\S]*후보 값 칸 "name"/);
    const s2 = setup([], { repo: s.repo, dataDir: s.dataDir });
    const f = okFeed();
    await fetchStep(s2, f);
    assert.equal(f.calls.length, 1, "다시 받는다");
  });

  test("저장한 저장소는 다음 날짜의 받기 후보에 없다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: desc(150) }, { candidate: 2, description: desc(150, "둘") }] });
    assert.equal(cli(s, ["repo-apply"]).code, 0);
    withDb(s, (db) => addBrief(db, "2026-10-28"));
    const s2 = setup([], { repo: s.repo, dataDir: s.dataDir, now: new Date("2026-10-29T09:00:00+09:00") });
    await fetchStep(s2, okFeed(), new Date("2026-10-29T09:00:00+09:00"));
    const c = candidates(s2);
    assert.equal(c.date, "2026-10-28");
    assert.deepEqual(c.candidates.map((x) => x.name), DEFAULT_ITEMS.slice(2).map((i) => i.link.replace("https://github.com/", "")));
    assert.equal(c.counts.alreadyShown, 2);
  });
});

// ---- 4.2-4 실패가 다른 단계를 막지 않음, 요약 ----

function fakeBuilder(): SiteBuilder {
  return ({ inputDir, outDir }) => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(path.join(inputDir, "site-data"), path.join(outDir, "site-data"), { recursive: true });
    writeFakePublicFiles(outDir);
    return { ok: true };
  };
}

async function laterSteps(s: Setup): Promise<string> {
  for (const cmd of ["backup", "site"]) {
    const ctx = { ...makeCtx(s.repo, s.env), buildSite: fakeBuilder() };
    const code = await mainAsync([cmd, "--run", s.runFile], ctx);
    assert.equal(code, 0, `${cmd}: ${ctx.text()}`);
  }
  return cli(s, ["summary"]).text;
}

describe("B1 4.2-4 요약과 다음 단계", () => {
  test("받기가 실패한 실행에서도 backup·site가 성공하고 요약에 저장소 줄이 나온다", async () => {
    const s = setup();
    await fetchStep(s, fakeFetch(() => new Error("fake outage")));
    const sum = await laterSteps(s);
    assert.match(sum, /- 저장소\(2026-10-27\): 받지 못함\(받기 오류: fake outage\)/);
    assert.match(sum, /- 백업: 내보내기만 함/);
    assert.match(sum, /- 사이트 빌드: 브리프 날짜 1개/);
  });

  test("검사 위반이 남은 실행에서도 backup·site가 성공하고 요약에 위반이 나온다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: "짧은 설명" }] });
    assert.equal(cli(s, ["repo-apply"]).code, 1);
    const sum = await laterSteps(s);
    assert.match(sum, /- 저장소\(2026-10-27\): 받지 못함\(검사 위반\)/);
    assert.match(sum, /항목 1\(후보 1\) description: 5자다/);
    assert.match(sum, /- 사이트 빌드: 브리프 날짜 1개/);
  });

  test("뺀 후보 번호의 이름은 요약에만 나오고 DB·백업 파일에는 없으며 실린 항목은 남는다(G17)", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    const c = candidates(s);
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: desc(150) }], excluded: [3, 5] });
    assert.equal(cli(s, ["repo-apply"]).code, 0);
    const sum = await laterSteps(s);
    const names = [3, 5].map((n) => c.candidates.find((x) => x.candidate === n)!.name);
    assert.match(sum, new RegExp(`- 저장소\\(2026-10-27\\): 실음 1개\\n  - 재료에 AI를 향한 요구가 보여 뺀 저장소: ${names.join(", ")}`));
    const dbText = JSON.stringify(repoRows(s));
    for (const n of names) assert.ok(!dbText.includes(n), n);
    const backupDir = path.join(s.dataDir, "backup");
    for (const f of fs.readdirSync(backupDir)) for (const n of names) assert.ok(!fs.readFileSync(path.join(backupDir, f), "utf8").includes(n), `${f} ${n}`);
    assert.ok(fs.readFileSync(path.join(backupDir, "repos.json"), "utf8").includes(c.candidates[0]!.name), "실린 항목은 백업에 있다");
  });

  test("저장소 단계를 부르지 않은 실행의 요약은 '이번 실행에서 하지 않음'이다", () => {
    const s = setup();
    assert.match(cli(s, ["summary"]).text, /- 저장소: 이번 실행에서 하지 않음/);
  });
});

// ---- 4.2-6 시험 모드와 데이터 폴더 지정 ----

describe("B1 4.2-6 시험 모드와 데이터 폴더 지정 실행도 피드를 받는다", () => {
  test("데이터 폴더 지정 실행(custom)", async () => {
    const s = setup();
    assert.equal(readRun(s.runFile).mode, "custom");
    const f = okFeed();
    await fetchStep(s, f);
    assert.deepEqual(f.calls, [TREND_FEED_URL]);
  });

  test("시험 모드(test)", async () => {
    const repo = tempRepo();
    const ctx = makeCtx(repo, {});
    assert.equal(main(["start", "test"], ctx), 0, ctx.text());
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
    const st = readRun(runFile);
    assert.equal(st.mode, "test");
    const db = openDb(st.dbPath);
    addBrief(db, DATE);
    db.close();
    const f = okFeed();
    const r = await fetchStep({ repo, dataDir: st.dataDir, dbPath: st.dbPath, runFile, env: {} }, f);
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(f.calls, [TREND_FEED_URL]);
    assert.equal(readRun(runFile).repos?.status, "fetched");
  });
});

// ---- 4.1-3 작업 파일은 로컬에만 ----

describe("B1 4.1-3 후보 파일과 피드 원문은 로컬 작업 파일에만 있다", () => {
  test("지어낸 README 문장과 한 줄 설명이 백업 파일, 사이트 데이터, 검색 레코드, 실행 요약 어디에도 없다", async () => {
    const s = setup();
    await fetchStep(s, okFeed());
    writeItems(s, { date: DATE, items: [{ candidate: 1, description: desc(150) }, { candidate: 2, description: desc(150, "둘") }] });
    assert.equal(cli(s, ["repo-apply"]).code, 0);
    const sum = await laterSteps(s);
    assert.ok(fs.readFileSync(repoWorkFile(s.dataDir, "candidates"), "utf8").includes(BODY_SENTENCE), "후보 파일에는 있다");
    const texts: [string, string][] = [["summary", sum]];
    for (const [name, text] of withDb(s, (db) => buildBackup(db))) texts.push([`backup ${name}`, text]);
    for (const [name, text] of withDb(s, (db) => buildSiteData(db))) texts.push([`site ${name}`, text]);
    texts.push(["search", JSON.stringify(withDb(s, (db) => buildSearchRecords(db)))]);
    const out = readRun(s.runFile).site!.outDir;
    for (const f of fs.readdirSync(path.join(out, "site-data"))) texts.push([`out ${f}`, fs.readFileSync(path.join(out, "site-data", f), "utf8")]);
    for (const [where, text] of texts) {
      assert.ok(!text.includes("Glimmerbox folds imaginary"), where);
      assert.ok(!text.includes("is a made-up tool used only in tests"), where);
    }
  });

  test("후보 파일·항목 파일을 실제 이름 그대로 결과물 맨 위에 넣으면 결과물 검사가 걸고, 닮은 .md는 통과한다", () => {
    for (const name of ["repo-candidates.json", "repo-items.json"]) {
      const out = tempDir();
      writeFakePublicFiles(out);
      fs.writeFileSync(path.join(out, name), "{}\n");
      assert.deepEqual(checkOutput(out, null).findings.map((f) => `${f.where} ${f.kind}`), [`${name} 실행 기록·작업 파일`]);
    }
    const ok = tempDir();
    writeFakePublicFiles(ok);
    fs.writeFileSync(path.join(ok, "repo-candidates.md"), "# 메모\n");
    fs.writeFileSync(path.join(ok, "repo-items.md"), "# 메모\n");
    assert.deepEqual(checkOutput(ok, null).findings, []);
  });

  test("저장소의 추적 파일(data/ 밖)로 넣으면 공개 전 점검이 걸고, 닮은 .md 문서는 통과한다", () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, "notes"));
    fs.writeFileSync(path.join(repo, "notes", "repo-candidates.json"), "{}\n");
    fs.writeFileSync(path.join(repo, "repo-items.json"), "{}\n");
    fs.writeFileSync(path.join(repo, "notes", "repo-candidates.md"), "# 메모\n");
    gitIn(repo, "add", ".");
    const r = precheck({ repo, commits: [], trackedFiles: true, home: null });
    assert.deepEqual(
      r.findings.map((f) => `${f.where} ${f.kind}`).sort(),
      ["지금 파일 notes/repo-candidates.json 실행 기록·작업 파일", "지금 파일 repo-items.json 실행 기록·작업 파일"],
    );
  });
});

// ---- 4.3-1 백업과 복원 ----

function seedRepoDays(db: DatabaseSync): void {
  for (const d of ["2026-10-25", "2026-10-26", DATE]) addBrief(db, d);
  saveRepoDay(db, "2026-10-25", "failed", []);
  saveRepoDay(db, "2026-10-26", "none", []);
  saveRepoDay(db, DATE, "shown", [
    { rank: 2, name: "fakeorg/alpha-kit", url: "https://github.com/fakeorg/alpha-kit", description: desc(150) },
    { rank: 9, name: "Sample-Lab/Gamma", url: "https://github.com/Sample-Lab/Gamma", description: desc(200, "감") },
  ]);
}

describe("B1 4.3-1 백업과 복원", () => {
  test("백업 → 복원 → 다시 백업의 내용이 같고 세 상태와 항목이 남는다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "a.db"));
    recordFirstCollectionDate(db, "2026-10-25");
    seedRepoDays(db);
    const files = buildBackup(db);
    const before = allRepoDays(db);
    db.close();
    assert.ok(files.has("repos.json"));
    assert.equal(JSON.parse(files.get("repos.json")!).formatVersion, BACKUP_FORMAT_VERSION);
    assert.equal(BACKUP_FORMAT_VERSION, 12);
    const out = path.join(dir, "b.db");
    restoreBackup(files, out);
    const r = openDb(out);
    assert.deepEqual(allRepoDays(r), before);
    assert.deepEqual(before.map((d) => d.status), ["failed", "none", "shown"]);
    assert.deepEqual(buildBackup(r), files);
    r.close();
  });

  test("기록이 없으면 repos.json을 쓰지 않는다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    addBrief(db, DATE);
    assert.ok(!buildBackup(db).has("repos.json"));
    db.close();
  });

  test("지어낸 받지 못한 이유(홈 경로 모양)와 후보 재료는 백업 파일에 없다", async () => {
    const s = setup();
    const home = "/home/faketester/tidwyn-secret";
    await fetchStep(s, fakeFetch(() => new Error(`cannot open ${home}/feed`)));
    const st = readRun(s.runFile).repos;
    assert.ok(st?.status === "failed" && st.reason.includes(home), "이유는 실행 기록에 있다");
    const files = withDb(s, (db) => buildBackup(db));
    assert.ok(files.has("repos.json"));
    for (const [name, text] of files) assert.ok(!text.includes("faketester") && !text.includes("cannot open"), name);
    assert.match(files.get("repos.json")!, /"status": "failed"/);
    // 받은 뒤 저장한 날의 백업에도 후보 재료가 없다
    const s2 = setup([], { repo: s.repo, dataDir: s.dataDir });
    await fetchStep(s2, okFeed());
    writeItems(s2, { date: DATE, items: [{ candidate: 1, description: desc(150) }] });
    assert.equal(cli(s2, ["repo-apply"]).code, 0);
    for (const [name, text] of withDb(s2, (db) => buildBackup(db))) {
      assert.ok(!text.includes("Glimmerbox") && !text.includes("made-up tool used only"), name);
    }
  });

  test("새 백업 파일 이름(repos.json)을 결과물에 넣으면 결과물 검사가 건다", () => {
    const out = tempDir();
    writeFakePublicFiles(out);
    fs.mkdirSync(path.join(out, "deep"));
    fs.writeFileSync(path.join(out, "deep", "repos.json"), "{}\n");
    assert.deepEqual(checkOutput(out, null).findings.map((f) => `${f.where} ${f.kind}`), ["deep/repos.json 백업 파일 이름"]);
  });

  test("바로 앞 형식(11)의 지어낸 백업이 오류 없이 저장소 기록 없이 복원된다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "a.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db, DATE);
    const files = new Map<string, string>();
    for (const [name, text] of buildBackup(db)) files.set(name, text.replaceAll(`"formatVersion": ${BACKUP_FORMAT_VERSION}`, '"formatVersion": 11'));
    db.close();
    assert.match(files.get("meta.json")!, /"formatVersion": 11/);
    const out = path.join(dir, "b.db");
    assert.deepEqual(restoreBackup(files, out), { dates: 1 });
    const r = openDb(out);
    assert.deepEqual(allRepoDays(r), []);
    r.close();
  });

  test("내보내기 폴더에서 읽어 복원해도 저장소 기록이 남는다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "a.db"));
    recordFirstCollectionDate(db, "2026-10-25");
    seedRepoDays(db);
    exportBackup(db, path.join(dir, "backup"));
    const before = allRepoDays(db);
    db.close();
    assert.ok(fs.existsSync(path.join(dir, "backup", "repos.json")));
    const out = path.join(dir, "c.db");
    const ctx = makeCtx(tempRepo(), {});
    assert.equal(main(["restore", "--from", path.join(dir, "backup"), "--out", out], ctx), 0, ctx.text());
    const r = openDb(out);
    assert.deepEqual(allRepoDays(r), before);
    r.close();
  });

  test("옛 DB(버전 15)를 업그레이드하면 기존 값이 그대로이고 새 표는 비며, 두 번 업그레이드해도 같다", () => {
    const file = path.join(tempDir(), "old.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 15));
    recordFirstCollectionDate(old, DATE);
    addBrief(old, DATE);
    assert.equal(schemaVersion(old), 15);
    const dump = (db: DatabaseSync) => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
      return Object.fromEntries(tables.map((t) => [t.name, (db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all() as object[]).map((r) => ({ ...r }))]));
    };
    const before = dump(old);
    old.close();
    const db = openDb(file);
    assert.equal(schemaVersion(db), 16);
    const after1 = dump(db);
    assert.deepEqual(after1.trend_repo_days, []);
    assert.deepEqual(after1.trend_repos, []);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(after1[name], rows, name);
    db.close();
    const again = openDb(file);
    assert.equal(schemaVersion(again), 16);
    assert.deepEqual(dump(again), after1);
    again.close();
  });
});

// ---- 4.4 사이트 데이터(화면은 사이트 쪽 테스트) ----

describe("B1 사이트 데이터의 날짜별 저장소 기록", () => {
  test("기록이 있는 날짜의 DayList에만 repos가 있고, 상태와 항목만 있으며 날짜 목록의 뉴스 수는 그대로다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    recordFirstCollectionDate(db, "2026-10-24");
    addBrief(db, "2026-10-24");
    const before = buildSiteData(db).get("site-data/dates.json");
    seedRepoDays(db);
    const data = buildSiteData(db);
    db.close();
    const list = JSON.parse(data.get("site-data/list-2026-10.json")!) as MonthList;
    const by = new Map(list.days.map((d) => [d.date, d.repos]));
    assert.equal(by.get("2026-10-24"), undefined);
    assert.deepEqual(by.get("2026-10-25"), { status: "failed", items: [] });
    assert.deepEqual(by.get("2026-10-26"), { status: "none", items: [] });
    assert.deepEqual(by.get(DATE), {
      status: "shown",
      items: [
        { rank: 2, name: "fakeorg/alpha-kit", url: "https://github.com/fakeorg/alpha-kit", description: desc(150) },
        { rank: 9, name: "Sample-Lab/Gamma", url: "https://github.com/Sample-Lab/Gamma", description: desc(200, "감") },
      ],
    });
    const dates = JSON.parse(data.get("site-data/dates.json")!) as { storyCounts: number[] };
    const counts = JSON.parse(before!) as { storyCounts: number[] };
    assert.equal(dates.storyCounts.at(-1), counts.storyCounts[0], "뉴스 수는 저장소 항목을 세지 않는다");
    assert.ok(new Set(dates.storyCounts).size === 1);
  });
});

describe("B1 4.4 사이트 쪽(DB에서 만든 데이터)", () => {
  test("4.4-3 검색 레코드: 실음인 날짜에만 저장소 레코드(이름·설명)가 있고, 결과 주소는 그 날짜의 빌더 레코드다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    recordFirstCollectionDate(db, "2026-10-24");
    addBrief(db, "2026-10-24");
    seedRepoDays(db);
    const records = buildSearchRecords(db);
    db.close();
    const repos = records.filter((r) => r.meta?.kind === "repos");
    assert.deepEqual(
      repos.map((r) => [r.url, r.meta]),
      [[`/${DATE}/builder`, { kind: "repos", date: DATE }]],
    );
    const content = repos[0]!.content;
    for (const t of ["fakeorg/alpha-kit", "fakeorg alpha kit", "Sample-Lab/Gamma", desc(150), desc(200, "감")]) assert.ok(content.includes(t), t);
    assert.ok(!records.some((r) => r.meta?.kind === "news" && r.content.includes("fakeorg/alpha-kit")), "뉴스 레코드에 섞이지 않는다");
  });

  test("4.4-2 받지 못한 이유(지어낸 문자열)는 사이트 데이터·검색 레코드·결과물 어디에도 없고 상태만 실린다", async () => {
    const s = setup();
    const marker = "ZZfakeReasonMarker-0427";
    await fetchStep(s, fakeFetch(() => new Error(`${marker} upstream refused`)));
    const st = readRun(s.runFile).repos;
    assert.ok(st?.status === "failed" && st.reason.includes(marker), "이유는 실행 기록에 있다");
    const work = tempDir();
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    withDb(s, (db) => {
      for (const [rel, content] of buildSiteData(db)) {
        fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dataDir, rel), content);
      }
      fs.writeFileSync(path.join(dataDir, "search-records.json"), JSON.stringify(buildSearchRecords(db)));
    });
    const list = JSON.parse(fs.readFileSync(path.join(dataDir, "site-data", "list-2026-10.json"), "utf8")) as MonthList;
    assert.deepEqual(list.days.find((d) => d.date === DATE)!.repos, { status: "failed", items: [] });
    await buildSite({ dataDir, outDir: out });
    const texts = [path.join(dataDir, "search-records.json"), ...listFilesRecursive(out).filter((f) => /\.(html|json|xml|js|txt)$/.test(f)).map((f) => path.join(out, f))];
    assert.ok(texts.some((f) => f.endsWith(".html")), "결과물을 읽었다");
    for (const f of texts) assert.ok(!fs.readFileSync(f, "utf8").includes(marker), f);
    assert.ok(fs.readFileSync(path.join(out, "2026-10-27.html"), "utf8").includes("목록을 받지 못했습니다"), "상태 문구만 실린다");
  });
});
