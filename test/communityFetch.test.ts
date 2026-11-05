import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { BLUESKY_GAP_MS, COMMUNITY_DEADLINE_MS, COMMUNITY_MAX_TERMS, TERM_KINDS, blueskySearchUrl, githubQuery, githubSearchUrl, normalizeTerm, pickTerms, termCandidates } from "../src/communityFetch.ts";
import { BLUESKY_HITS_CAP, COMMUNITY_RULES, CONCENTRATION_SHARE, communityStreak, judgeCommunity, readCommunityUnits, setCommunityStatus } from "../src/communityStore.ts";
import { communitySources, officialSources, type OfficialKind } from "../src/demandSources.ts";
import { UNIT_RULES, officialUnits, type RisingUnit, type SourceUnits } from "../src/demandUnits.ts";
import type { OfficialGroup } from "../src/demandFlowTypes.ts";
import type { FetchResult } from "../src/feeds.ts";
import { SEARCH_GAP_MS } from "../src/repoSnapshot.ts";
import { RESP_TEXTS, TERMS, TOPICS, blueskyReply, communityDump, fakeCommunity, githubReply, runOn, seedTopics, virtualTime, windowOf } from "./communityFixtures.ts";
import { ALL, END, FAKE, SECRET_TEXTS, TARGET, TODAY, flowEnv, isRecent, seedRising, series, wikiPart } from "./flowFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

// 9.98단계 4.1-1, 4.2-1~4.2-3: 커뮤니티 소스, 검색어 고르기, 건수 받기, 오름·쏠림. 가짜 응답과 가짜 시계만 쓴다

after(cleanupTemp);

const WIN = { recentFrom: "2026-10-27", recentTo: END, baseFrom: "2026-09-29", baseTo: "2026-10-26", recentDays: 7, baseDays: 28 };

function unit(source: string, name: string | null, recent: number): RisingUnit {
  return { key: `${source}:${name ?? "x"}`, source, group: source.split(":")[0] as OfficialGroup, name, recent, base: recent / 4, isNew: false, recentDaily: [], baseDailyMean: 1, material: [], window: WIN };
}

function su(kind: OfficialKind, source: string, units: [string | null, number][]): SourceUnits {
  return { source, group: source.split(":")[0] as OfficialGroup, kind, label: source, state: "ok", window: WIN, unitCount: units.length, rising: units.map(([n, r]) => unit(source, n, r)), risingAll: units.length };
}

const withTopics = (topics: readonly string[] = TOPICS) => {
  const e = flowEnv();
  const db = e.demand();
  seedTopics(db, topics);
  return db;
};

describe("4.1-1 커뮤니티 소스 목록과 끄기", () => {
  test("소스는 GitHub Issues와 Bluesky 둘이고 묶음과 표본 설명이 코드 한 곳의 값이다", () => {
    const s = communitySources();
    assert.deepEqual(s.map((x) => [x.id, x.group, x.host, x.path]), [
      ["github:issues", "github", "api.github.com", "/search/issues"],
      ["bluesky:posts", "bluesky", "api.bsky.app", "/xrpc/app.bsky.feed.searchPosts"],
    ]);
    assert.ok(!officialSources().some((x) => x.group === "github" || x.group === "bluesky"), "공식 묶음이 아니다");
  });

  for (const [name, off, silent] of [
    ["소스 끄기", { groups: [], sources: ["github:issues"] }, "api.github.com"],
    ["묶음 끄기", { groups: ["bluesky"], sources: [] }, "api.bsky.app"],
  ] as const) {
    test(`${name}: 그 소스는 호출하지 않고 상태는 꺼짐이며 다른 소스는 받는다`, async () => {
      const db = withTopics();
      const vt = virtualTime();
      const h = fakeCommunity(vt.clock);
      const r = await runOn(db, h.http, vt, { off });
      assert.equal(h.calls.filter((c) => c.host === silent).length, 0);
      const offId = silent === "api.github.com" ? "github:issues" : "bluesky:posts";
      const onId = offId === "github:issues" ? "bluesky:posts" : "github:issues";
      assert.equal(r.sources[offId]!.status, "off");
      assert.equal(r.sources[onId]!.status, "ok");
      assert.equal(readCommunityUnits(db, TARGET).statuses.find((x) => x.source === offId)!.status, "off");
    });
  }
});

describe("4.2-1 검색어 고르기", () => {
  test("외부인 글 소스와 분류 이름 소스의 단위는 검색어가 아니다(이름이 있어도)", () => {
    const sources = [
      su("assembly", "assembly:received", [["가짜청원이름", 9000]]),
      su("acrc-qna", "acrc:qna", [["가짜질의", 90]]),
      su("acrc-proposal", "acrc:proposal", [["가짜제안", 90]]),
      su("dart", "dart:list", [["가짜공시종류", 90]]),
      su("sec-formd", "sec:formd", [["Fake Industry", 90]]),
      su("acrc-bigdata", "acrc:bigdata", [["가짜민원키워드", 9]]),
      su("ftc-1372", "ftc1372:consult", [["가짜대분류 > 가짜중분류", 90]]),
      su("wikimedia", "wikimedia:en", [["Fake Topic", 900_000]]),
    ];
    const terms = termCandidates(sources, TARGET).map((c) => c.term);
    assert.deepEqual(terms.sort(), ["Fake Topic", "가짜민원키워드", "가짜중분류"].sort());
    assert.deepEqual([...TERM_KINDS].sort(), ["acrc-bigdata", "ftc-1372", "wikimedia"]);
  });

  test("UNIT_RULES의 top 안 단위만 쓴다", () => {
    const n = UNIT_RULES.wikimedia.top;
    const s = su("wikimedia", "wikimedia:en", Array.from({ length: n + 3 }, (_, i): [string, number] => [`Fake Topic ${String.fromCharCode(65 + i)}`, 900_000 - i]));
    assert.equal(termCandidates([s], TARGET).length, n);
  });

  test("하루 20개 상한: 새로 고르기와 같은 날 다시 돌기의 합계", () => {
    const s = ["en", "de", "fr", "ja", "es", "it"].map((w) => su("wikimedia", `wikimedia:${w}`, Array.from({ length: 6 }, (_, i): [string, number] => [`Fake ${w} Topic ${String.fromCharCode(65 + i)}`, 900_000 - i])));
    const cands = termCandidates(s, TARGET);
    assert.equal(cands.length, 36);
    const first = pickTerms(cands, []);
    assert.equal(first.picked.length, COMMUNITY_MAX_TERMS);
    assert.equal(COMMUNITY_MAX_TERMS, 20);
    // 이미 고른 15개 중 5개만 오늘 후보에 있으면, 새 검색어는 5개까지다
    const previous = [...cands.slice(0, 5).map((c) => c.term), ...Array.from({ length: 10 }, (_, i) => `gone topic ${i}`)];
    const again = pickTerms(cands, previous);
    assert.equal(again.added.length, 5);
    assert.equal(again.picked.length, 10);
    assert.equal(pickTerms(cands, first.picked.map((c) => c.term)).added.length, 0, "같은 날 다시 돌면 새로 고르지 않는다");
  });

  test("같은 이름은 한 번만 쓰고 규모가 가장 큰 단위와 그 창에 묶는다", () => {
    const small = su("wikimedia", "wikimedia:de", [["Fake Same Topic", 200_000]]);
    const big = su("wikimedia", "wikimedia:en", [["fake same topic", 800_000]]);
    big.rising[0]!.window = { ...WIN, recentFrom: "2026-10-26", recentTo: "2026-11-01", baseFrom: "2026-09-28", baseTo: "2026-10-25" };
    const c = termCandidates([small, big], TARGET);
    assert.equal(c.length, 1);
    assert.equal(c[0]!.unit.key, big.rising[0]!.key);
    assert.deepEqual(c[0]!.window, { recentFrom: "2026-10-26", recentTo: "2026-11-01", baseFrom: "2026-09-28", baseTo: "2026-10-25" });
  });

  test("9.97이 뺀 위키 특수 문서·봇 급등 문서는 검색어가 아니다(실제 단위 세기)", () => {
    const e = flowEnv();
    const db = e.demand();
    series(db, "wikimedia:en", ALL, (d) => [
      wikiPart([
        ["Special:Search", isRecent(d) ? 500_000 : 10_000],
        // 최근 7일 합의 대부분이 하루에 몰린 문서
        ["Fake_Spike_Topic_QZP", d === END ? 900_000 : 10_000],
        [FAKE.wiki, isRecent(d) ? 50_000 : 10_000],
      ]),
    ]);
    const terms = termCandidates(officialUnits(db, TODAY, { target: TARGET, sources: officialSources().filter((s) => s.id === "wikimedia:en") }).sources, TARGET).map((c) => c.term);
    assert.deepEqual(terms, [FAKE.wiki.replaceAll("_", " ")]);
  });

  test("이름 다듬기: 1372 중분류, 위키 괄호 설명, 따옴표·한정어·연산자", () => {
    assert.equal(normalizeTerm("ftc-1372", "가짜대분류 > 가짜중분류"), "가짜중분류");
    assert.equal(normalizeTerm("wikimedia", "Fake Topic (2026 film)"), "Fake Topic");
    assert.equal(normalizeTerm("wikimedia", 'Fake "quoted" Topic'), null);
    assert.equal(normalizeTerm("wikimedia", "Fake\\Topic"), null);
    assert.equal(normalizeTerm("wikimedia", "Fake repo:evil user:someone Topic"), "Fake repo evil user someone Topic");
    assert.equal(normalizeTerm("wikimedia", "Fake OR Topic"), null);
    assert.equal(normalizeTerm("wikimedia", "2026"), null);
    assert.equal(normalizeTerm("acrc-bigdata", "가"), null);
  });
});

describe("4.2-2 질의 문자열", () => {
  test("GitHub: 검색어 한 구절 + is:issue + 창 날짜, 첫 쪽 100건", () => {
    assert.equal(githubQuery("Fake Topic", "2026-10-27", END), `"Fake Topic" is:issue created:2026-10-27..${END}`);
    const u = new URL(githubSearchUrl("Fake Topic", "2026-10-27", END));
    assert.equal(`${u.origin}${u.pathname}`, "https://api.github.com/search/issues");
    assert.equal(u.searchParams.get("q"), `"Fake Topic" is:issue created:2026-10-27..${END}`);
    assert.equal(u.searchParams.get("per_page"), "100");
  });

  test("Bluesky: api.bsky.app 표준 경로, 검색어 한 구절, since·until(끝 날짜 다음 날), 커서 없음", () => {
    const u = new URL(blueskySearchUrl("Fake Topic", "2026-10-27", END));
    assert.equal(`${u.origin}${u.pathname}`, "https://api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    assert.equal(u.searchParams.get("q"), '"Fake Topic"');
    assert.equal(u.searchParams.get("since"), "2026-10-27");
    assert.equal(u.searchParams.get("until"), "2026-11-03");
    assert.equal(u.searchParams.get("limit"), "100");
    assert.equal(u.searchParams.get("cursor"), null);
  });

  test("따옴표·검색 한정어가 든 지어낸 이름은 한 구절로 처리되거나 검색어에서 빠진다", async () => {
    const db = withTopics(["Fake_repo:evil_user:x_QZL", 'Fake_"quote"_QZK', "Fake_is:pr_OR_QZJ"]);
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock);
    await runOn(db, h.http, vt);
    const qs = h.github().map((c) => new URL(c.url).searchParams.get("q")!);
    assert.ok(qs.length > 0);
    for (const q of qs) {
      // 따옴표는 검색어를 감싼 두 개뿐이고, 구절 밖에는 is:issue와 created:만 있다
      assert.equal([...q].filter((ch) => ch === '"').length, 2, q);
      const outside = q.slice(q.lastIndexOf('"') + 1).trim();
      assert.match(outside, /^is:issue created:\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/);
      assert.ok(!q.slice(1, q.lastIndexOf('"')).includes(":"), q);
    }
    assert.deepEqual([...new Set(qs.map((q) => q.slice(1, q.lastIndexOf('"'))))], ["Fake repo evil user x QZL"]);
    for (const c of h.bluesky()) assert.equal(new URL(c.url).searchParams.get("q"), '"Fake repo evil user x QZL"');
  });
});

describe("4.2-2 건수 받기", () => {
  test("검색어 × 두 창을 받고, 소스마다 첫 검색 직전에 robots를 한 번 보며, 상태는 받음이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock);
    const r = await runOn(db, h.http, vt);
    assert.equal(r.terms, 3);
    for (const id of ["github:issues", "bluesky:posts"]) {
      const s = r.sources[id]!;
      assert.equal(s.status, "ok");
      assert.equal(s.calls, 7);
      assert.equal(s.robotsCalls, 1);
      assert.equal(s.received, 6);
      assert.equal(s.rising, 3);
    }
    assert.equal(h.calls[0]!.url, "https://api.github.com/robots.txt");
    assert.deepEqual(h.robots().map((c) => c.url).sort(), ["https://api.bsky.app/robots.txt", "https://api.github.com/robots.txt"]);
    const wins = h.github().map((c) => windowOf(c.url));
    assert.deepEqual(new Set(wins.map((w) => `${w.from}..${w.to}`)), new Set([`2026-10-27..${END}`, "2026-09-29..2026-10-26"]));
    const units = readCommunityUnits(db, TARGET).units;
    assert.equal(units.length, 6);
    const u = units.find((x) => x.source === "github:issues")!;
    assert.deepEqual([u.recent, u.baseCount, u.judgement.base, u.judgement.rising], [50, 40, 10, true]);
    assert.deepEqual(u.window, { recentFrom: "2026-10-27", recentTo: END, baseFrom: "2026-09-29", baseTo: "2026-10-26" });
  });

  test("GitHub 호출 간격은 SEARCH_GAP_MS 이상이고, Bluesky는 GitHub 간격 뒤에 밀리지 않는다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock);
    await runOn(db, h.http, vt);
    const g = h.github().map((c) => c.at);
    for (let i = 1; i < g.length; i++) assert.ok(g[i]! - g[i - 1]! >= SEARCH_GAP_MS, `${g[i]! - g[i - 1]!}`);
    const b = h.bluesky().map((c) => c.at);
    for (let i = 1; i < b.length; i++) assert.ok(b[i]! - b[i - 1]! >= BLUESKY_GAP_MS);
    assert.ok(b.at(-1)! < g[2]!, "Bluesky는 GitHub 셋째 호출 전에 끝난다");
  });

  test("같은 대상 날짜에 다시 돌리면 호출 0(robots 포함)이고 상태는 받음이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    await runOn(db, fakeCommunity(vt.clock).http, vt);
    const h = fakeCommunity(vt.clock);
    const r = await runOn(db, h.http, vt);
    assert.equal(h.calls.length, 0);
    assert.equal(r.sources["github:issues"]!.status, "ok");
    assert.equal(r.terms, 3);
  });

  test("같은 날 다시 돌 때 공식 창이 옮겨졌으면 새 창만 받고, 검색어 수는 늘지 않는다", async () => {
    const e = flowEnv();
    const db = e.demand();
    const days = ALL.filter((d) => d < END);
    series(db, "wikimedia:en", days, (d) => [wikiPart(TOPICS.map((t): [string, number] => [t, isRecent(d) ? 50_000 : 10_000]))]);
    const vt = virtualTime();
    await runOn(db, fakeCommunity(vt.clock).http, vt);
    // 그 사이 공식 값이 하루 더 들어와 창 끝이 하루 옮겨졌다
    series(db, "wikimedia:en", [END], () => [wikiPart(TOPICS.map((t): [string, number] => [t, 50_000]))]);
    const h = fakeCommunity(vt.clock);
    const r = await runOn(db, h.http, vt);
    assert.equal(h.github().length, 6);
    assert.deepEqual(new Set(h.github().map((c) => windowOf(c.url).to)), new Set([END, "2026-10-26"]));
    assert.equal(r.terms, 3);
    assert.equal(r.sources["github:issues"]!.status, "ok");
    assert.ok(readCommunityUnits(db, TARGET).units.every((u) => u.window.recentTo === END), "다시 세기는 가장 늦은 창을 쓴다");
  });

  test("같은 날 다시 돌 때 같은 이름이 다른 공식 단위에서 더 크게 올라도 처음 묶은 단위를 쓴다(호출 0)", async () => {
    const e = flowEnv();
    const db = e.demand();
    const name = "Fake_Rebound_Topic_QZR";
    series(db, "wikimedia:de", ALL, (d) => [wikiPart([[name, isRecent(d) ? 50_000 : 10_000]])]);
    const vt = virtualTime();
    await runOn(db, fakeCommunity(vt.clock).http, vt);
    // 그 사이 다른 위키에서 같은 이름이 더 크게 올랐다(같은 창)
    series(db, "wikimedia:en", ALL, (d) => [wikiPart([[name, isRecent(d) ? 500_000 : 100_000]])]);
    const h = fakeCommunity(vt.clock);
    const r = await runOn(db, h.http, vt);
    assert.equal(r.terms, 1);
    assert.equal(h.calls.length, 0);
    assert.equal(r.sources["github:issues"]!.status, "ok");
    assert.equal(r.sources["github:issues"]!.received, 2);
    // 실행 요약의 오른 수도 처음 묶은 단위로 센다
    assert.equal(r.sources["github:issues"]!.rising, 1);
    const keys = readCommunityUnits(db, TARGET).units.filter((u) => u.source === "github:issues").map((u) => u.officialKey);
    assert.ok(keys.length === 1 && keys[0]!.startsWith("wikimedia:de:"), keys.join(","));
  });

  test("robots가 막으면 그 소스는 검색을 부르지 않고 상태는 robots 막힘이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock, (url) => (url === "https://api.github.com/robots.txt" ? { status: 200, text: "User-agent: *\nDisallow: /search/\n" } : undefined));
    const r = await runOn(db, h.http, vt);
    assert.equal(h.github().length, 0);
    assert.equal(r.sources["github:issues"]!.status, "robots");
    assert.equal(r.sources["github:issues"]!.calls, 1);
    assert.equal(r.sources["bluesky:posts"]!.status, "ok");
  });

  test("429 한 번 뒤 성공하면 받음이고, retry-after만큼 기다린다", async () => {
    const db = withTopics([FAKE.wiki]);
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock, (url, n) => (url.includes("api.github.com/search") && windowOf(url).recent && n === 1 ? { status: 429, text: "", headers: { "retry-after": "30" } } : undefined));
    const r = await runOn(db, h.http, vt);
    assert.equal(r.sources["github:issues"]!.status, "ok");
    const g = h.github();
    assert.equal(g.length, 3);
    assert.ok(g[1]!.at - g[0]!.at >= 30_000);
  });

  test("429가 두 번이면 그 소스의 남은 검색어는 받지 못함이고, 앞서 받은 것이 있으면 일부 받음이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    let searches = 0;
    const h = fakeCommunity(vt.clock, (url) => (url.includes("api.github.com/search") && ++searches >= 3 ? { status: 429, text: "", headers: { "retry-after": "5" } } : undefined));
    const r = await runOn(db, h.http, vt);
    const s = r.sources["github:issues"]!;
    assert.equal(s.status, "partial");
    assert.equal(s.reason, "rate");
    assert.equal(h.github().length, 4, "2개 받고 셋째에서 한 번 다시 한 뒤 멈춘다");
    assert.equal(s.received, 2);
    assert.equal(r.sources["bluesky:posts"]!.status, "ok");
  });

  test("한도 헤더가 있는 403은 한 번 뒤 성공하고, 한도 헤더 없는 403과 인증 요구는 막힘이다", async () => {
    const cases: [FetchResult, string][] = [
      [{ status: 403, text: "", headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" } }, "ok"],
      [{ status: 403, text: "", headers: {} }, "blocked"],
      [{ status: 401, text: "", headers: {} }, "blocked"],
    ];
    for (const [reply, status] of cases) {
      const db = withTopics([FAKE.wiki]);
      const vt = virtualTime();
      const h = fakeCommunity(vt.clock, (url, n) => (url.includes("api.github.com/search") && n === 1 ? reply : undefined));
      const r = await runOn(db, h.http, vt);
      assert.equal(r.sources["github:issues"]!.status, status, JSON.stringify(reply));
      if (status === "blocked") assert.equal(h.github().length, 1, "막히면 더 부르지 않는다");
    }
  });

  test("GitHub 422·Bluesky 400은 그 검색어만, incomplete_results 참·hitsTotal 없음은 그 창만 받지 못함이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    const [t1, t2] = TERMS;
    const h = fakeCommunity(vt.clock, (url) => {
      if (url.endsWith("robots.txt")) return undefined;
      const w = windowOf(url);
      if (url.includes("api.github.com")) {
        if (w.term === t1) return { status: 422, text: "{}", headers: {} };
        if (w.term === t2 && !w.recent) return githubReply(40, { incomplete: true });
      } else {
        if (w.term === t1) return { status: 400, text: "{}", headers: {} };
        if (w.term === t2 && !w.recent) return blueskyReply(undefined);
      }
      return undefined;
    });
    const r = await runOn(db, h.http, vt);
    for (const id of ["github:issues", "bluesky:posts"]) {
      const s = r.sources[id]!;
      assert.equal(s.status, "partial", id);
      assert.equal(s.reason, "query");
      assert.equal(s.received, 3, "셋째 검색어 두 창과 둘째 검색어 최근 창");
      assert.equal(s.missing, 3);
    }
    assert.equal(h.github().filter((c) => windowOf(c.url).term === t1).length, 1, "422 뒤 그 검색어의 앞 창은 부르지 않는다");
    const units = readCommunityUnits(db, TARGET).units;
    assert.deepEqual(new Set(units.map((u) => u.term)), new Set([TERMS[2]]));
  });

  test("Bluesky 상한(hitsTotal 1만 이상)에 닿은 값은 저장하되 비교에서 빠진다", async () => {
    const db = withTopics([FAKE.wiki]);
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock, (url) => (url.includes("api.bsky.app/xrpc") && !windowOf(url).recent ? blueskyReply(BLUESKY_HITS_CAP) : undefined));
    const r = await runOn(db, h.http, vt);
    assert.equal(r.sources["bluesky:posts"]!.capHits, 1);
    assert.equal(r.sources["bluesky:posts"]!.rising, 0);
    const read = readCommunityUnits(db, TARGET);
    assert.ok(!read.units.some((u) => u.source === "bluesky:posts"));
    assert.equal(read.capped.length, 1);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM community_counts WHERE cap_hit = 1").get() as { n: number }).n, 1);
  });

  test("명령 전체 6분 상한(공식 단위 세기 포함): 남은 검색어는 받지 못함이고, 앞서 받은 것이 있으면 일부 받음이다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock);
    // 공식 단위 세기에 5분 30초가 걸린 것처럼 시작 시각을 앞에 둔다
    const r = await runOn(db, h.http, vt, { startedMs: vt.clock() - (COMMUNITY_DEADLINE_MS - 30_000) });
    const s = r.sources["github:issues"]!;
    assert.equal(s.status, "partial");
    assert.equal(s.reason, "deadline");
    assert.ok(r.hitDeadline);
    assert.ok(s.received > 0 && s.missing > 0);
    for (const c of [...h.github(), ...h.bluesky()]) assert.ok(c.at + 20_000 <= 30_000, "상한을 넘길 호출은 하지 않는다");
  });

  test("시간 초과·응답 형식 오류·연결 실패는 한 번 다시 하고, 또 실패하면 받지 못함(사유 종류)이다", async () => {
    for (const [reply, reason] of [
      ["hang", "timeout"],
      [{ status: 200, text: "<html>not json</html>", headers: {} }, "format"],
      ["throw", "network"],
      [{ status: 503, text: "", headers: {} }, "server"],
    ] as const) {
      const db = withTopics([FAKE.wiki]);
      const vt = virtualTime();
      const h = fakeCommunity(vt.clock, (url) => (url.includes("api.github.com/search") ? reply : undefined));
      const r = await runOn(db, h.http, vt);
      assert.equal(r.sources["github:issues"]!.status, "failed", reason);
      assert.equal(r.sources["github:issues"]!.reason, reason);
      assert.equal(h.github().length, 2, reason);
      assert.equal(r.sources["bluesky:posts"]!.status, "ok");
    }
  });

  test("오른 공식 단위가 없으면 호출 0(robots 포함)이고 상태는 검색어 없음이다", async () => {
    const e = flowEnv();
    const db = e.demand();
    seedRising(db, ["dart", "sec"]);
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock);
    const r = await runOn(db, h.http, vt);
    assert.equal(h.calls.length, 0);
    assert.equal(r.sources["github:issues"]!.status, "noterms");
    assert.equal(r.terms, 0);
  });

  test("저장된 행에 지어낸 응답의 글·제목·작성자·DID·저장소 이름이 없다", async () => {
    const db = withTopics();
    const vt = virtualTime();
    await runOn(db, fakeCommunity(vt.clock).http, vt);
    const dump = communityDump(db);
    for (const t of RESP_TEXTS) assert.ok(!dump.includes(t), t);
    const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
    assert.deepEqual(cols("community_counts"), ["id", "target_date", "source", "term", "unit_key", "win_kind", "win_from", "win_to", "count", "cap_hit", "top_share", "fetched_at"]);
    void SECRET_TEXTS;
  });
});

describe("4.2-3 오름과 쏠림", () => {
  const g = COMMUNITY_RULES.github!;
  test("하한 미만은 오름이 아니다", () => {
    assert.equal(judgeCommunity("github", g.floor - 1, 0, 7, 28, null).rising, false);
    assert.equal(judgeCommunity("github", g.floor, 0, 7, 28, null).rising, true);
  });
  test("기준 미만은 오름이 아니다(같은 길이 평균의 ratio배 경계)", () => {
    // 앞 28일 120건 → 같은 길이 평균 30
    const at = g.ratio * 30;
    assert.equal(judgeCommunity("github", Math.max(at, g.floor), 120, 7, 28, null).rising, true);
    assert.equal(judgeCommunity("github", at - 1, 120, 7, 28, null).rising, false);
  });
  test("앞 창이 0이면 새로 나타남으로 오름이다", () => {
    const j = judgeCommunity("bluesky", COMMUNITY_RULES.bluesky!.floor, 0, 7, 28, null);
    assert.ok(j.isNew && j.rising);
  });
  test("쏠림은 절반 초과에서만 오름에서 뺀다(절반은 쏠림이 아니다)", () => {
    assert.equal(CONCENTRATION_SHARE, 0.5);
    const half = judgeCommunity("github", 50, 40, 7, 28, 0.5);
    assert.ok(half.rising && !half.concentrated);
    const over = judgeCommunity("github", 50, 40, 7, 28, 0.51);
    assert.ok(!over.rising && over.concentrated && over.passes);
  });
  test("한 저장소·한 계정 쏠림은 실행 요약의 쏠림 수에 들고 오른 수에 들지 않는다", async () => {
    const db = withTopics([FAKE.wiki]);
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock, (url) => {
      if (url.endsWith("robots.txt") || !windowOf(url).recent) return undefined;
      return url.includes("api.github.com") ? githubReply(50, { items: 4, sameRepo: true }) : blueskyReply(60, { posts: 4, sameAuthor: true });
    });
    const r = await runOn(db, h.http, vt);
    for (const id of ["github:issues", "bluesky:posts"]) {
      assert.equal(r.sources[id]!.concentrated, 1, id);
      assert.equal(r.sources[id]!.rising, 0, id);
    }
    assert.ok(readCommunityUnits(db, TARGET).units.every((u) => u.share === 1 && u.judgement.concentrated));
  });
});

describe("4.4-3 막힘·받지 못함 이어짐", () => {
  test("막힘·받지 못함만 세고, 일부 받음·받음이 끊으며, robots 막힘·꺼짐·검색어 없음은 세지도 끊지도 않는다", () => {
    const e = flowEnv();
    const db = e.demand();
    const put = (d: string, st: Parameters<typeof setCommunityStatus>[3]) => setCommunityStatus(db, d, "github:issues", st, null, `${d}T07:00:00+09:00`);
    put("2026-10-28", "failed");
    put("2026-10-29", "partial");
    put("2026-10-30", "blocked");
    put("2026-10-31", "robots");
    put("2026-11-01", "failed");
    put("2026-11-02", "noterms");
    put("2026-11-03", "failed");
    assert.equal(communityStreak(db, "github:issues", "2026-11-03"), 3);
    assert.equal(communityStreak(db, "github:issues", "2026-11-01"), 2);
    assert.equal(communityStreak(db, "bluesky:posts", "2026-11-03"), 0);
  });
});
