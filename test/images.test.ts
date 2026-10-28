import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { exportBackup, readBackupDir, restoreBackup } from "../src/backup.ts";
import { main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { collectCandidates, officialFeedSpecs, parseRss, type FeedReport, type FetchText } from "../src/feeds.ts";
import { fillImages, normalizeArticleUrl } from "../src/images.ts";
import { candidatesFile, readRun, workFile } from "../src/run.ts";
import { loadBrief, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 피드와 주소는 모두 지어낸 값이다(3단계 4.4).
const DATE = "2026-10-27";
const PUB = "Tue, 27 Oct 2026 10:00:00 +0900";

function rss(items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>예시 피드</title>${items.join("")}</channel></rss>`;
}

function item(title: string, link: string, media = ""): string {
  return `<item><title>${title}</title><link>${link}</link><pubDate>${PUB}</pubDate><description>${title} 요약이다.</description>${media}</item>`;
}

/** sampleBrief의 대표 출처 주소(helpers.ts) */
const KR1 = `https://news.example-kr-1.com/${DATE}/kr-1`;
const WORLD2 = `https://news.example-world-2.com/${DATE}/world-2`;
const IT3 = `https://news.example-it-3.com/${DATE}/it-3`;

// 연합뉴스: media:content. 주소는 www·추적용 질의 값·끝의 /가 붙어 있다
const YONHAP_XML = rss([
  item("가짜 한국 기사", `http://www.news.example-kr-1.com/${DATE}/kr-1/?input=1195m`, `<media:content url="https://img.example.com/yna/kr1.jpg?w=600&amp;h=400" type="image/jpeg" medium="image"/>`),
  item("가짜 동영상 기사", "https://www.example-yonhap.test/view/VIDEO1", `<media:content url="https://video.example.com/v1.mp4" type="video/mp4"/>`),
  item("가짜 저장 안 된 기사", "https://www.example-yonhap.test/view/OTHER1", `<media:content url="https://img.example.com/yna/other.jpg"/>`),
]);
// BBC: media:thumbnail
const BBC_XML = rss([item("Fake world story", `${WORLD2}?at_medium=RSS&amp;at_campaign=rss`, `<media:thumbnail width="240" height="135" url="https://img.example.com/bbc/world2.jpg"/>`)]);
// 이미지 형식 enclosure
const ENCLOSURE_XML = rss([item("가짜 IT 기사", `${IT3}#top`, `<enclosure url="https://img.example.com/it3.png" length="100" type="image/png"/>`)]);
// 구글 뉴스: 미디어 태그가 있어도 쓰지 않는다. 링크는 중간 주소다
const GOOGLE_XML = rss([
  `<item><title>Fake google story - Example Wire</title><link>https://news.google.com/rss/articles/FAKE1?oc=5</link><pubDate>${PUB}</pubDate><source url="https://www.example-wire.com">Example Wire</source><media:content url="https://img.example.com/google.jpg" type="image/jpeg"/></item>`,
]);

function fakeFetch(map: (url: string) => { status: number; text: string } | Error, calls: string[] = []): FetchText {
  return (url) => {
    calls.push(url);
    const r = map(url);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
}

/** 실제 피드 주소별 가짜 응답 */
function feedResponse(url: string): { status: number; text: string } {
  if (url.includes("news.google.com")) return { status: 200, text: GOOGLE_XML };
  if (url.endsWith("/news.xml")) return { status: 200, text: YONHAP_XML };
  if (url.endsWith("/industry.xml")) return { status: 200, text: ENCLOSURE_XML };
  if (url.includes("bbci")) return { status: 200, text: BBC_XML };
  return { status: 200, text: rss([]) };
}

describe("3단계 4.4-1 공식 RSS의 이미지 주소", () => {
  test("media:content, media:thumbnail, 이미지 enclosure를 읽고, 동영상과 http/https가 아닌 주소는 뺀다", () => {
    const items = parseRss(YONHAP_XML);
    assert.equal(items[0]!.imageUrl, "https://img.example.com/yna/kr1.jpg?w=600&h=400");
    assert.equal(items[1]!.imageUrl, undefined);
    assert.equal(items[2]!.imageUrl, "https://img.example.com/yna/other.jpg");
    assert.equal(parseRss(BBC_XML)[0]!.imageUrl, "https://img.example.com/bbc/world2.jpg");
    assert.equal(parseRss(ENCLOSURE_XML)[0]!.imageUrl, "https://img.example.com/it3.png");
    const bad = rss([item("가짜", "https://example.com/a", `<media:thumbnail url="javascript:alert(1)"/><enclosure url="https://img.example.com/a.mp3" type="audio/mpeg"/>`)]);
    assert.equal(parseRss(bad)[0]!.imageUrl, undefined);
    const google = rss([item("가짜", "https://example.com/b", `<media:content url="https://news.google.com/api/attachments/FAKE"/>`)]);
    assert.equal(parseRss(google)[0]!.imageUrl, undefined);
  });

  test("후보 목록에는 공식 피드 항목에만 imageUrl이 있고, 구글 뉴스 항목에는 없다", async () => {
    const specs = [
      { group: "구글 뉴스 예시", url: "https://news.google.com/rss/search?q=fake", google: true },
      { group: "연합뉴스 RSS", url: "https://www.yna.co.kr/rss/news.xml", google: false, outlet: "연합뉴스" },
      { group: "BBC RSS", url: "https://feeds.bbci.co.uk/news/world/rss.xml", google: false, outlet: "BBC" },
    ];
    const r = await collectCandidates(DATE, specs, { fetch: fakeFetch(feedResponse), gapMs: 0 });
    const g = r.candidates.find((c) => c.redirectLink)!;
    assert.equal(g.imageUrl, undefined);
    assert.equal("imageUrl" in g, false);
    assert.equal(r.candidates.find((c) => c.title === "가짜 한국 기사")!.imageUrl, "https://img.example.com/yna/kr1.jpg?w=600&h=400");
    assert.equal(r.candidates.find((c) => c.title === "Fake world story")!.imageUrl, "https://img.example.com/bbc/world2.jpg");
    assert.equal("imageUrl" in r.candidates.find((c) => c.title === "가짜 동영상 기사")!, false);
  });

  test("주소 비교: http/https, www, 끝의 /, # 뒤, 추적용 질의 값을 무시하고, 구글 뉴스 주소는 비교하지 않는다", () => {
    assert.equal(normalizeArticleUrl("http://www.Example.com/a/b/?utm_source=x&input=1&id=3#frag"), normalizeArticleUrl("https://example.com/a/b?id=3"));
    assert.equal(normalizeArticleUrl("https://www.bbc.co.uk/news/articles/fake1?at_medium=RSS"), normalizeArticleUrl("https://www.bbc.com/news/articles/fake1"));
    assert.notEqual(normalizeArticleUrl("https://example.com/a?id=3"), normalizeArticleUrl("https://example.com/a?id=4"));
    assert.equal(normalizeArticleUrl("https://news.google.com/rss/articles/FAKE1"), null);
    assert.equal(normalizeArticleUrl("ftp://example.com/a"), null);
    assert.equal(normalizeArticleUrl("주소 아님"), null);
  });

  test("save는 작업 파일의 imageUrl을 버리고, 그 날짜 후보 목록의 공식 RSS 항목과 주소가 같은 출처에만 이미지를 넣는다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const start = makeCtx(repo, env);
    assert.equal(main(["start"], start), 0, start.text());
    const runFile = /실행 기록: (.+)/.exec(start.text())![1]!;
    const feeds = makeCtx(repo, env);
    feeds.feedGapMs = 0;
    feeds.fetchText = fakeFetch(feedResponse);
    assert.equal(await mainAsync(["feeds", "--run", runFile, "--date", DATE], feeds), 0, feeds.text());
    const report = JSON.parse(fs.readFileSync(candidatesFile(dataDir, DATE), "utf8")) as FeedReport;
    assert.ok(report.candidates.some((c) => c.imageUrl !== undefined));
    assert.ok(report.candidates.filter((c) => c.redirectLink).every((c) => c.imageUrl === undefined));
    // 후보 목록 마크다운에는 이미지 주소를 넣지 않는다
    assert.doesNotMatch(fs.readFileSync(candidatesFile(dataDir, DATE, "md"), "utf8"), /img\.example\.com/);

    // 작업 파일: sampleBrief는 모든 주요 뉴스 대표 출처에 지어낸 imageUrl이 있다
    const work = workFile(dataDir, DATE);
    fs.mkdirSync(path.dirname(work), { recursive: true });
    fs.writeFileSync(work, JSON.stringify(sampleBrief(DATE)));
    const save = makeCtx(repo, env);
    assert.equal(main(["save", "--run", runFile, "--date", DATE], save), 0, save.text());
    assert.match(save.text(), /원문 이미지: 출처 3개/);

    const db = openDb(path.join(dataDir, "tidwyn.db"));
    const stored = loadBrief(db, DATE)!;
    db.close();
    const images = stored.brief.sections.flatMap((s) => [...s.topStories, ...s.shortNews]).flatMap((x) => x.sources).filter((s) => s.imageUrl !== undefined);
    assert.deepEqual(
      images.map((s) => [s.url, s.imageUrl]),
      [
        [KR1, "https://img.example.com/yna/kr1.jpg?w=600&h=400"],
        [WORLD2, "https://img.example.com/bbc/world2.jpg"],
        [IT3, "https://img.example.com/it3.png"],
      ],
    );
    const result = readRun(runFile).results[DATE];
    assert.ok(result?.status === "saved");
    assert.equal(result.images, 3);
    const summary = makeCtx(repo, env);
    assert.equal(main(["summary", "--run", runFile], summary), 0);
    assert.match(summary.text(), new RegExp(`- ${DATE} 원문 이미지: 출처 3개에 넣음`));
  });

  test("후보 목록 파일이 없으면 이미지 없이 저장한다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const start = makeCtx(repo, env);
    assert.equal(main(["start"], start), 0, start.text());
    const runFile = /실행 기록: (.+)/.exec(start.text())![1]!;
    const work = workFile(dataDir, DATE);
    fs.mkdirSync(path.dirname(work), { recursive: true });
    fs.writeFileSync(work, JSON.stringify(sampleBrief(DATE)));
    const save = makeCtx(repo, env);
    assert.equal(main(["save", "--run", runFile, "--date", DATE], save), 0, save.text());
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    const stored = loadBrief(db, DATE)!;
    db.close();
    assert.doesNotMatch(JSON.stringify(stored), /imageUrl/);
  });
});

/** 이미지 주소가 없는 브리프 하나와, 이미 이미지 주소가 있는 출처 하나(세계-2 대표 출처)가 있는 DB */
function dbWithoutImages(file: string) {
  const db = openDb(file);
  const b = sampleBrief(DATE);
  for (const sec of b.sections) for (const x of [...sec.topStories, ...sec.shortNews]) for (const s of x.sources) delete s.imageUrl;
  b.sections[1]!.topStories[1]!.sources[0]!.imageUrl = "https://img.example.com/kept.jpg";
  const r = validateBrief(b, DATE);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${DATE}T23:00:00+09:00`, late: false });
  return db;
}

describe("3단계 4.4-2 지난 날짜 이미지 채우기", () => {
  test("공식 RSS와 주소가 같고 이미지가 없는 출처만 채우고, 다른 값과 이미 있는 이미지는 그대로다. 다시 해도 바뀌지 않는다", async () => {
    const db = dbWithoutImages(path.join(tempDir(), "t.db"));
    const before = loadBrief(db, DATE)!;
    const calls: string[] = [];
    const r = await fillImages(db, fakeFetch(feedResponse, calls));
    assert.deepEqual(r, { filled: 2, failures: [] });
    // 공식 피드만 받는다(구글 뉴스는 받지 않는다)
    assert.deepEqual(calls, officialFeedSpecs().map((s) => s.url));
    assert.ok(calls.every((u) => !u.includes("news.google.com")));
    const afterFill = loadBrief(db, DATE)!;
    const expected = structuredClone(before);
    expected.brief.sections[0]!.topStories[0]!.sources[0]!.imageUrl = "https://img.example.com/yna/kr1.jpg?w=600&h=400";
    expected.brief.sections[2]!.topStories[2]!.sources[0]!.imageUrl = "https://img.example.com/it3.png";
    assert.deepEqual(afterFill, expected);
    assert.equal(afterFill.brief.sections[1]!.topStories[1]!.sources[0]!.imageUrl, "https://img.example.com/kept.jpg");

    const again = await fillImages(db, fakeFetch(feedResponse));
    assert.deepEqual(again, { filled: 0, failures: [] });
    assert.deepEqual(loadBrief(db, DATE), afterFill);
    db.close();
  });

  test("받지 못한 피드는 실패로 남기고 나머지는 채운다", async () => {
    const db = dbWithoutImages(path.join(tempDir(), "t.db"));
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const r = await fillImages(
      db,
      fakeFetch((u) => (u.includes("bbci") ? { status: 503, text: "" } : u.endsWith("/politics.xml") ? timeout : u.endsWith("/economy.xml") ? { status: 200, text: "<html></html>" } : feedResponse(u))),
    );
    assert.equal(r.filled, 2);
    assert.deepEqual(
      r.failures.map((f) => [f.feed, f.reason]),
      [
        ["연합뉴스 RSS", "시간 초과"],
        ["연합뉴스 RSS", "RSS 형식이 아니다"],
        ["BBC RSS", "HTTP 503"],
      ],
    );
    db.close();
  });

  test("images 명령이 결과를 실행 기록에 남기고, 피드 실패가 있어도 0으로 끝나며, 요약에 줄이 나온다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    dbWithoutImages(path.join(dataDir, "tidwyn.db")).close();
    const start = makeCtx(repo, env);
    assert.equal(main(["start"], start), 0, start.text());
    const runFile = /실행 기록: (.+)/.exec(start.text())![1]!;
    const ctx = makeCtx(repo, env);
    ctx.fetchText = fakeFetch((u) => (u.includes("bbci") ? new Error("getaddrinfo ENOTFOUND") : feedResponse(u)));
    assert.equal(await mainAsync(["images", "--run", runFile], ctx), 0, ctx.text());
    assert.match(ctx.text(), /지난 날짜 이미지 채우기: 출처 2개 채움/);
    const state = readRun(runFile);
    assert.ok(state.images?.status === "done");
    assert.equal(state.images.filled, 2);
    assert.deepEqual(state.images.failures.map((f) => f.feed), ["BBC RSS"]);
    const summary = makeCtx(repo, env);
    assert.equal(main(["summary", "--run", runFile], summary), 0);
    assert.match(summary.text(), /- 지난 날짜 이미지 채우기: 출처 2개 채움\n {2}- 받지 못한 피드\(다음 실행이 다시 받는다\):\n {4}- BBC RSS: getaddrinfo ENOTFOUND/);
  });

  test("images 명령은 DB를 열지 못하면 실패한다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const start = makeCtx(repo, env);
    assert.equal(main(["start"], start), 0, start.text());
    const runFile = /실행 기록: (.+)/.exec(start.text())![1]!;
    fs.rmSync(readRun(runFile).dbPath);
    const ctx = makeCtx(repo, env);
    ctx.fetchText = () => Promise.reject(new Error("네트워크를 쓰면 안 된다"));
    assert.equal(await mainAsync(["images", "--run", runFile], ctx), 1, ctx.text());
    assert.equal(readRun(runFile).images?.status, "failed");
  });

  test("채운 이미지 주소가 백업·복원 뒤에도 남는다", async () => {
    const dir = tempDir();
    const db = dbWithoutImages(path.join(dir, "t.db"));
    await fillImages(db, fakeFetch(feedResponse));
    const filled = loadBrief(db, DATE)!;
    exportBackup(db, path.join(dir, "backup"));
    db.close();
    const restoredPath = path.join(dir, "restored.db");
    restoreBackup(readBackupDir(path.join(dir, "backup")), restoredPath);
    const restored = openDb(restoredPath);
    assert.deepEqual(loadBrief(restored, DATE), filled);
    assert.equal(loadBrief(restored, DATE)!.brief.sections[0]!.topStories[0]!.sources[0]!.imageUrl, "https://img.example.com/yna/kr1.jpg?w=600&h=400");
    restored.close();
  });
});
