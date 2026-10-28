import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main, mainAsync } from "../src/cli.ts";
import { candidateWindow, collectCandidates, decodeXmlText, feedSpecs, parseRss, splitGoogleTitle, type FeedReport, type FetchText } from "../src/feeds.ts";
import { candidatesFile, readRun, updateRun, workFile } from "../src/run.ts";
import { cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 피드 예시는 모두 지어낸 제목·주소다(명세서 4장 머리말).
const DATE = "2026-10-27";

function rss(items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>예시 피드</title>${items.join("")}</channel></rss>`;
}

function googleItem(title: string, source: string, pubDate: string, n: number): string {
  return `<item><title>${title} - ${source}</title><link>https://news.google.com/rss/articles/FAKE${n}?oc=5</link><guid>FAKE${n}</guid><pubDate>${pubDate}</pubDate><description>&lt;a href="https://news.google.com/rss/articles/FAKE${n}"&gt;${title}&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;${source}&lt;/font&gt;</description><source url="https://www.example-wire.com">${source}</source></item>`;
}

const GOOGLE_XML = rss([
  googleItem("Fake summit ends with joint statement", "Example Wire", "Tue, 27 Oct 2026 03:00:00 GMT", 1),
  googleItem("Fake summit ends with joint statement", "Example Wire", "Tue, 27 Oct 2026 03:00:00 GMT", 1),
  googleItem("Too early fake story", "Example Wire", "Mon, 26 Oct 2026 14:59:59 GMT", 2),
  googleItem("Exactly at start fake story", "Example Wire", "Mon, 26 Oct 2026 15:00:00 GMT", 3),
  googleItem("Exactly at end fake story", "Example Wire", "Wed, 28 Oct 2026 07:00:00 GMT", 4),
  googleItem("Just before end fake story", "Example Wire", "Wed, 28 Oct 2026 06:59:59 GMT", 5),
  googleItem("Rates &amp; &quot;bonds&quot; &#8212; fake", "Example Wire", "Tue, 27 Oct 2026 05:00:00 GMT", 6),
]);

const YONHAP_XML = rss([
  `<item><title><![CDATA[가짜 정책 발표 <속보>]]></title><link>https://www.example-yonhap.test/view/FAKE1</link><pubDate>Tue, 27 Oct 2026 10:00:00 +0900</pubDate><description><![CDATA[지어낸 요약 문장이다. &amp; 기호도 있다]]></description></item>`,
]);

function fakeFetch(map: (url: string) => { status: number; text: string } | Error): FetchText {
  return (url) => {
    const r = map(url);
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
}

describe("1.5단계 4.1 후보 목록", () => {
  test("4.1-3 날짜 범위는 KST 0시부터 미국 서부(서머타임 반영)의 대상일 끝까지다", () => {
    const w = candidateWindow(DATE);
    assert.equal(w.from.toISOString(), "2026-10-26T15:00:00.000Z");
    assert.equal(w.to.toISOString(), "2026-10-28T07:00:00.000Z");
    // 서머타임이 끝난 뒤(태평양 표준시 UTC-8)
    assert.equal(candidateWindow("2026-12-01").to.toISOString(), "2026-12-02T08:00:00.000Z");
  });

  test("4.1-3 서머타임이 바뀌는 날도 태평양 시간 0시로 끝난다", () => {
    assert.equal(candidateWindow("2027-03-13").to.toISOString(), "2027-03-14T08:00:00.000Z");
    assert.equal(candidateWindow("2026-10-31").to.toISOString(), "2026-11-01T07:00:00.000Z");
  });

  test("4.1-4 같은 기사가 구글 뉴스와 공식 RSS에 다 있으면 원문 링크가 있는 항목을 남긴다", async () => {
    const specs = [
      { group: "구글 뉴스 BBC", url: "https://news.google.com/rss/search?q=bbc", google: true },
      { group: "BBC RSS", url: "https://feeds.bbci.co.uk/fake.xml", google: false, outlet: "BBC" },
    ];
    const google = rss([googleItem("Fake storm hits coast", "BBC", "Tue, 27 Oct 2026 03:00:00 GMT", 9)]);
    const direct = rss([`<item><title>Fake storm hits coast</title><link>https://www.example-bbc.test/news/FAKE9</link><pubDate>Tue, 27 Oct 2026 03:05:00 GMT</pubDate></item>`]);
    const r = await collectCandidates(DATE, specs, { fetch: fakeFetch((u) => ({ status: 200, text: u.includes("google") ? google : direct })), gapMs: 0 });
    assert.equal(r.candidates.length, 1);
    assert.equal(r.candidates[0]!.link, "https://www.example-bbc.test/news/FAKE9");
    assert.equal(r.candidates[0]!.redirectLink, false);
  });

  test("4.1-2 피드 목록에 구글 뉴스 4개 매체와 연합뉴스·BBC 공식 RSS가 있다", () => {
    const specs = feedSpecs(DATE);
    for (const d of ["reuters.com", "apnews.com", "yna.co.kr", "bbc.com"]) assert.ok(specs.some((s) => s.google && s.url.includes(`site%3A${d}`)), d);
    assert.ok(specs.some((s) => s.url === "https://www.yna.co.kr/rss/news.xml"));
    assert.ok(specs.some((s) => s.url === "https://www.yna.co.kr/rss/politics.xml"));
    assert.ok(specs.some((s) => s.url === "https://feeds.bbci.co.uk/news/world/rss.xml"));
    assert.ok(specs.every((s) => s.url.startsWith("https://news.google.com/rss/search?") || s.url.startsWith("https://www.yna.co.kr/rss/") || s.url.startsWith("https://feeds.bbci.co.uk/")));
  });

  test("4.1-6 CDATA와 HTML 엔터티가 글자로 풀린다", () => {
    assert.equal(decodeXmlText("<![CDATA[a <b> & c]]>"), "a <b> & c");
    assert.equal(decodeXmlText("Rates &amp; &quot;bonds&quot; &#8212; &#x2019;s"), 'Rates & "bonds" — ’s');
    assert.throws(() => parseRss("<html><body>not a feed</body></html>"), /RSS 형식이 아니다/);
  });

  test("4.1-4 구글 뉴스 제목 끝의 매체명을 떼어 낸다", () => {
    assert.deepEqual(splitGoogleTitle("Fake title - with dash - Example Wire", "Example Wire"), { title: "Fake title - with dash", outlet: "Example Wire" });
    assert.deepEqual(splitGoogleTitle("Fake title - AP News"), { title: "Fake title", outlet: "AP News" });
  });

  test("4.1-2·3·4 예시 피드에서 항목을 뽑아 범위 안만 남기고, 중복은 한 번만 둔다", async () => {
    const specs = [
      { group: "구글 뉴스 예시", url: "https://news.google.com/rss/search?q=fake", google: true },
      { group: "연합뉴스 RSS", url: "https://www.yna.co.kr/rss/fake.xml", google: false, outlet: "연합뉴스" },
    ];
    const r = await collectCandidates(DATE, specs, { fetch: fakeFetch((u) => ({ status: 200, text: u.includes("google") ? GOOGLE_XML : YONHAP_XML })), gapMs: 0 });
    const titles = r.candidates.map((c) => c.title);
    assert.deepEqual(titles.filter((t) => t.includes("Fake summit")), ["Fake summit ends with joint statement"]);
    assert.ok(titles.includes("Exactly at start fake story"));
    assert.ok(titles.includes("Just before end fake story"));
    assert.ok(!titles.includes("Too early fake story"));
    assert.ok(!titles.includes("Exactly at end fake story"));
    assert.ok(titles.includes('Rates & "bonds" — fake'));
    const g = r.candidates.find((c) => c.title.startsWith("Fake summit"))!;
    assert.equal(g.outlet, "Example Wire");
    assert.equal(g.redirectLink, true);
    assert.equal(g.publishedAt, "2026-10-27T12:00:00+09:00");
    assert.equal(g.summary, undefined);
    const y = r.candidates.find((c) => c.outlet === "연합뉴스")!;
    assert.deepEqual(y, {
      outlet: "연합뉴스",
      title: "가짜 정책 발표 <속보>",
      summary: "지어낸 요약 문장이다. & 기호도 있다",
      publishedAt: "2026-10-27T10:00:00+09:00",
      link: "https://www.example-yonhap.test/view/FAKE1",
      redirectLink: false,
      feed: "연합뉴스 RSS",
    });
    assert.deepEqual(r.counts["구글 뉴스 예시"], { fetched: 7, inWindow: 4 });
    assert.deepEqual(r.failures, []);
  });

  test("4.1-5 피드 하나가 실패해도 나머지는 받고, 실패를 남긴다", async () => {
    const specs = [
      { group: "끊긴 피드", url: "https://news.google.com/rss/search?q=down", google: true },
      { group: "오류 피드", url: "https://news.google.com/rss/search?q=500", google: true },
      { group: "이상한 피드", url: "https://news.google.com/rss/search?q=html", google: true },
      { group: "연합뉴스 RSS", url: "https://www.yna.co.kr/rss/fake.xml", google: false, outlet: "연합뉴스" },
    ];
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    const r = await collectCandidates(DATE, specs, {
      fetch: fakeFetch((u) => (u.endsWith("down") ? timeout : u.endsWith("500") ? { status: 500, text: "" } : u.endsWith("html") ? { status: 200, text: "<html></html>" } : { status: 200, text: YONHAP_XML })),
      gapMs: 0,
    });
    assert.equal(r.candidates.length, 1);
    assert.deepEqual(
      r.failures.map((f) => [f.feed, f.reason]),
      [
        ["끊긴 피드", "시간 초과"],
        ["오류 피드", "HTTP 500"],
        ["이상한 피드", "RSS 형식이 아니다"],
      ],
    );
  });

  test("4.1-1·5 feeds 명령이 후보 파일을 쓰고, 피드별 건수와 실패를 출력하고, 실행 기록에 남긴다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const startCtx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["start"], startCtx), 0, startCtx.text());
    const runFile = /실행 기록: (.+)/.exec(startCtx.text())![1]!;

    const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    ctx.feedGapMs = 0;
    ctx.fetchText = fakeFetch((u) => (u.includes("bbci") ? new Error("getaddrinfo ENOTFOUND") : { status: 200, text: u.includes("google") ? GOOGLE_XML : YONHAP_XML }));
    assert.equal(await mainAsync(["feeds", "--run", runFile, "--date", DATE], ctx), 0, ctx.text());

    const md = fs.readFileSync(candidatesFile(dataDir, DATE, "md"), "utf8");
    assert.match(ctx.text(), new RegExp(`후보 목록\\(${DATE}\\): .*\\.candidates\\.md`));
    assert.match(md, /## Example Wire\n[\s\S]*\n- 10-27 12:00 Fake summit ends with joint statement \(중간 주소\)/);
    assert.match(md, /- 10-27 10:00 가짜 정책 발표 <속보> — 지어낸 요약 문장이다\. & 기호도 있다 https:\/\/www\.example-yonhap\.test\/view\/FAKE1/);
    assert.match(md, /받지 못한 피드: BBC RSS/);
    assert.doesNotMatch(md, /news\.google\.com/);
    const file = candidatesFile(dataDir, DATE);
    const report = JSON.parse(fs.readFileSync(file, "utf8")) as FeedReport;
    assert.ok(report.candidates.length > 0);
    assert.match(ctx.text(), /구글 뉴스 Reuters: 받음 \d+건, 범위 안 \d+건/);
    assert.match(ctx.text(), /연합뉴스 RSS: 받음 \d+건/);
    assert.match(ctx.text(), /받지 못한 피드[\s\S]*BBC RSS: getaddrinfo ENOTFOUND/);
    const state = readRun(runFile);
    assert.deepEqual(state.feeds?.[DATE]?.failures.map((f) => f.feed), ["BBC RSS"]);
    assert.ok((state.feeds?.[DATE]?.counts["구글 뉴스 AP"]?.fetched ?? 0) > 0);
  });

  test("feeds 명령은 대상 날짜가 아니면 거부한다", async () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const startCtx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["start"], startCtx), 0);
    const runFile = /실행 기록: (.+)/.exec(startCtx.text())![1]!;
    const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    ctx.fetchText = () => Promise.reject(new Error("네트워크를 쓰면 안 된다"));
    assert.equal(await mainAsync(["feeds", "--run", runFile, "--date", "2026-10-01"], ctx), 2);
  });
});

describe("1.5단계 4.4 실행 요약", () => {
  const PRIORITY_HOSTS = ["www.yna.co.kr", "www.reuters.com", "apnews.com", "www.bbc.com", "www.hani.co.kr", "www.kbs.co.kr", "www.nytimes.com", "www.theverge.com"];

  function savedRun(priorityCount: number): { runFile: string; repo: string; dataDir: string } {
    const repo = tempRepo();
    const dataDir = tempDir();
    const startCtx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["start"], startCtx), 0);
    const runFile = /실행 기록: (.+)/.exec(startCtx.text())![1]!;
    const b = sampleBrief(DATE);
    b.sections.flatMap((s) => s.topStories).forEach((t, i) => {
      if (i < priorityCount) t.sources.find((s) => s.primary)!.url = `https://${PRIORITY_HOSTS[i % PRIORITY_HOSTS.length]}/fake-${i}`;
    });
    const work = workFile(dataDir, DATE);
    fs.mkdirSync(path.dirname(work), { recursive: true });
    fs.writeFileSync(work, JSON.stringify(b));
    const save = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["save", "--run", runFile, "--date", DATE], save), 0, save.text());
    return { runFile, repo, dataDir };
  }

  test("4.4-1 저장한 날짜의 우선 출처 비율이 나오고, 절반 미만이면 경고가 붙는다", () => {
    const low = savedRun(7);
    const a = makeCtx(low.repo, { TIDWYN_DATA_DIR: low.dataDir });
    assert.equal(main(["summary", "--run", low.runFile], a), 0);
    assert.match(a.text(), new RegExp(`- ${DATE} 우선 출처 비율: 대표 출처 15건 중 7건\\n  - 경고: 우선 출처`));

    const high = savedRun(8);
    const b = makeCtx(high.repo, { TIDWYN_DATA_DIR: high.dataDir });
    assert.equal(main(["summary", "--run", high.runFile], b), 0);
    assert.match(b.text(), new RegExp(`- ${DATE} 우선 출처 비율: 대표 출처 15건 중 8건`));
    assert.doesNotMatch(b.text(), /경고: 우선 출처/);
    assert.match(b.text(), /- 저장한 날짜: 2026-10-27/);
    assert.match(b.text(), /# 2026-10-27 브리프/);
  });

  test("4.4-2 실행 기록에 피드 실패가 있으면 요약에 날짜·피드·이유가 나온다", () => {
    const r = savedRun(8);
    updateRun(r.runFile, (s) => (s.feeds = { [DATE]: { counts: {}, failures: [{ feed: "구글 뉴스 AP", url: "https://news.google.com/rss/search?q=fake", reason: "HTTP 503" }] } }));
    const ctx = makeCtx(r.repo, { TIDWYN_DATA_DIR: r.dataDir });
    assert.equal(main(["summary", "--run", r.runFile], ctx), 0);
    assert.match(ctx.text(), new RegExp(`- ${DATE} 받지 못한 피드\\(웹 검색으로 조사했다\\):\\n  - 구글 뉴스 AP: HTTP 503`));
  });
});
