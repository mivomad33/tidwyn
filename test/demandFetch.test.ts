import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { migrate, type Migration } from "../src/db.ts";
import { DEMAND_GAP_MS, DEMAND_REQUEST_TIMEOUT_MS, MASTODON_CAP, demandFetchText, dropAuthorFields } from "../src/demandFetch.ts";
import { GOOGLE_GEOS, MASTODON_INSTANCES, demandSources, googleTrendsUrl, type DemandSource } from "../src/demandSources.ts";
import { DEMAND_COPY_KEEP, DEMAND_MIGRATIONS, openDemandDb, setStatus, statusOf } from "../src/demandStore.ts";
import { FEED_USER_AGENT } from "../src/feeds.ts";
import { robotsBlocks } from "../src/robots.ts";
import { pruneSnapshots, SNAPSHOT_DIR } from "../src/snapshot.ts";
import { purgeDataDir } from "../src/videoPurge.ts";
import { DAY, FAKE_ACCOUNT, FAKE_AUTHOR, FAKE_LINK_TITLE, NOW, copyDir, defaultReply, demandEnv, fakeHttp, link, rows, rss, run, virtualTime, type Reply } from "./demandFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

// 9.95단계 4.1, 4.2: 받기·저장·끄기·robots·Google 막힘. 네트워크를 쓰지 않는다(가짜 응답과 가상 시계)

after(cleanupTemp);

const google = () => demandSources().filter((s) => s.group === "google");
const mastodon = () => demandSources().filter((s) => s.group === "mastodon");
const isGoogle = (url: string) => new URL(url).host === "trends.google.com";
const fakeMastodon = (host: string, group = "mastodon"): DemandSource => ({ id: `${group}:${host}`, group, kind: "mastodon-trends", label: host, host, paths: ["/api/v1/trends/tags", "/api/v1/trends/links"] });

function bodies(e: { db: ReturnType<typeof openDemandDb> }, source: string): { part: string; page: number; body: Buffer }[] {
  return (e.db.prepare("SELECT p.part, p.page, p.body FROM demand_parts p JOIN demand_snapshots s ON s.id = p.snapshot_id WHERE s.source = ? ORDER BY p.part, p.page").all(source) as { part: string; page: number; body: Uint8Array }[]).map((r) => ({ ...r, body: Buffer.from(r.body) }));
}

describe("4.1-1 받기", () => {
  test("Google은 목록의 나라마다 피드 하나를 목록 순서로 받는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock);
    const r = await run(e, h.http, vt);
    const g = h.urls().filter(isGoogle).filter((u) => !u.endsWith("/robots.txt"));
    assert.equal(g.length, GOOGLE_GEOS.length);
    assert.deepEqual(g, GOOGLE_GEOS.map(googleTrendsUrl));
    assert.equal(r.groups.google!.ok, GOOGLE_GEOS.length);
    assert.equal(r.groups.mastodon!.ok, MASTODON_INSTANCES.length);
    assert.equal(r.groups.google!.requests, GOOGLE_GEOS.length + 1);
    assert.equal(r.groups.google!.robotsRequests, 1);
  });

  test("호스트끼리는 기다리지 않는다: 전체 시간이 가장 오래 걸리는 호스트의 시간과 같고 합보다 작다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const counts: Record<string, number> = { "a.example": 100, "b.example": 40, "c.example": 0 };
    const h = fakeHttp(vt.clock, (url) => {
      const u = new URL(url);
      return u.pathname.endsWith("/tags") ? defaultReply(url, { tags: counts[u.host]!, links: 0 }) : u.pathname.endsWith("/links") ? defaultReply(url, { links: 0 }) : undefined;
    });
    await run(e, h.http, vt, { sources: Object.keys(counts).map((x) => fakeMastodon(x)) });
    const perHost = Object.keys(counts).map((host) => h.calls.filter((c) => new URL(c.url).host === host).length);
    // robots, 태그 페이지, 링크 한 페이지. 요청 사이 2초
    assert.deepEqual(perHost, [1 + 5 + 1, 1 + 3 + 1, 1 + 1 + 1]);
    const times = perHost.map((n) => (n - 1) * DEMAND_GAP_MS);
    assert.equal(vt.clock(), Math.max(...times));
    assert.ok(vt.clock() < times.reduce((a, b) => a + b, 0));
  });

  test("같은 호스트의 요청 사이는 2초 이상이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, undefined, { tags: 60, links: 30 });
    await run(e, h.http, vt);
    const hosts = new Set(h.calls.map((c) => new URL(c.url).host));
    for (const host of hosts) {
      const at = h.calls.filter((c) => new URL(c.url).host === host).map((c) => c.at);
      for (let i = 1; i < at.length; i++) assert.ok(at[i]! - at[i - 1]! >= DEMAND_GAP_MS, `${host} ${i}`);
    }
  });

  test("Mastodon은 20건씩 넘기고 빈 응답이나 100건 상한에서 멈추며, 상한에 닿은 횟수를 센다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => {
      const u = new URL(url);
      if (u.host !== "x.example") return undefined;
      // 태그는 150건(상한), 링크는 정확히 40건(세 번째 페이지가 빈 응답)
      return defaultReply(url, { tags: 150, links: 40 });
    });
    const r = await run(e, h.http, vt, { sources: [fakeMastodon("x.example")] });
    const urls = h.urls().filter((u) => u.includes("/trends/"));
    assert.deepEqual(
      urls.filter((u) => u.includes("/tags")).map((u) => new URL(u).searchParams.get("offset")),
      ["0", "20", "40", "60", "80"],
    );
    assert.deepEqual(
      urls.filter((u) => u.includes("/links")).map((u) => new URL(u).searchParams.get("offset")),
      ["0", "20", "40"],
    );
    assert.equal(r.groups.mastodon!.capHits, 1);
    const parts = bodies(e, "mastodon:x.example");
    assert.equal(parts.filter((p) => p.part === "tags").reduce((n, p) => n + (JSON.parse(p.body.toString()) as unknown[]).length, 0), MASTODON_CAP);
    assert.deepEqual(JSON.parse(parts.find((p) => p.part === "links" && p.page === 3)!.body.toString()), []);
  });

  test("시간 상한에 닿으면 남은 소스를 시간 상한으로 받지 못함에 두고 끝낸다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock);
    // robots와 첫 나라 몇 개만 받을 시간
    const r = await run(e, h.http, vt, { deadlineMs: DEMAND_REQUEST_TIMEOUT_MS + 4 * DEMAND_GAP_MS });
    const g = r.groups.google!;
    assert.ok(g.okNow > 0 && g.okNow < GOOGLE_GEOS.length, String(g.okNow));
    assert.equal(g.failed.length, GOOGLE_GEOS.length - g.okNow);
    assert.ok(g.failed.every((f) => f.reason === "시간 상한"));
    assert.ok(vt.clock() <= DEMAND_REQUEST_TIMEOUT_MS + 4 * DEMAND_GAP_MS);
    assert.equal(statusOf(e.db, `google:${g.failed[0]!.label}`, DAY)?.reason, "시간 상한");
  });

  test("응답이 오지 않는 요청은 요청 상한에서 끊기고, 그 소스만 받지 못함이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => (url === googleTrendsUrl("JP") ? "hang" : undefined));
    const r = await run(e, h.http, vt);
    assert.deepEqual(r.groups.google!.failed, [{ label: "JP", reason: "시간 초과" }]);
    assert.equal(r.groups.google!.ok, GOOGLE_GEOS.length - 1);
    assert.equal(h.urls().filter((u) => u === googleTrendsUrl("JP")).length, 2, "한 번 다시 시도한다");
  });

  test("리디렉션을 따라가지 않는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => (new URL(url).host === "x.example" && url.includes("/tags") ? { status: 301, text: "", headers: { location: "https://elsewhere.example/api" } } : undefined));
    const r = await run(e, h.http, vt, { sources: [fakeMastodon("x.example")] });
    assert.deepEqual(r.groups.mastodon!.failed, [{ label: "x.example", reason: "HTTP 301" }]);
    assert.ok(!h.urls().some((u) => u.includes("elsewhere.example")));
  });

  test("실제 요청 함수는 리디렉션을 따라가지 않고 User-Agent가 고정 문자열이다", async () => {
    const real = globalThis.fetch;
    const seen: RequestInit[] = [];
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response("", { status: 302, headers: { location: "https://www.google.com/sorry/index" } });
    }) as typeof fetch;
    try {
      const res = await demandFetchText("https://trends.google.com/trending/rss?geo=KR");
      assert.equal(res.status, 302);
      assert.equal(res.headers?.location, "https://www.google.com/sorry/index");
    } finally {
      globalThis.fetch = real;
    }
    assert.equal(seen[0]!.redirect, "manual");
    assert.equal((seen[0]!.headers as Record<string, string>)["user-agent"], FEED_USER_AGENT);
    assert.match(FEED_USER_AGENT, /^tidwyn\//);
  });
});

describe("4.1-2 원문 그대로", () => {
  test("Google 스냅샷은 받은 피드 바이트와 같다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const feed = rss("KR", 3);
    const h = fakeHttp(vt.clock, (url) => (url === googleTrendsUrl("KR") ? { status: 200, text: feed } : undefined));
    await run(e, h.http, vt, { sources: google() });
    const parts = bodies(e, "google:KR");
    assert.equal(parts.length, 1);
    assert.ok(parts[0]!.body.equals(Buffer.from(feed, "utf8")));
  });

  test("Mastodon 스냅샷은 작성자 칸만 지우고 나머지 칸과 값은 그대로다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, undefined, { tags: 2, links: 2 });
    await run(e, h.http, vt, { sources: [fakeMastodon("x.example")] });
    const parts = bodies(e, "mastodon:x.example");
    const links = JSON.parse(parts.find((p) => p.part === "links")!.body.toString()) as Record<string, unknown>[];
    const expected = [link(0), link(1)].map((x) => Object.fromEntries(Object.entries(x).filter(([k]) => !["author_name", "author_url", "authors"].includes(k))));
    assert.deepEqual(links, expected);
    assert.equal(links[0]!.title, `${FAKE_LINK_TITLE}0`);
    const raw = fs.readFileSync(e.file);
    for (const text of [FAKE_AUTHOR, FAKE_ACCOUNT]) assert.ok(!raw.includes(Buffer.from(text)), `${text}가 전용 DB에 남았다`);
  });

  test("작성자 칸은 어느 깊이에서든 이름으로만 지운다", () => {
    assert.deepEqual(dropAuthorFields({ a: [{ authors: [1], b: { author_name: "x", c: "작성자 이름이 든 글" } }] }), { a: [{ b: { c: "작성자 이름이 든 글" } }] });
  });
});

describe("4.1-3 하루 한 번", () => {
  test("두 번 돌면 행 수가 같고 두 번째 요청은 robots까지 0이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock).http, vt);
    const n = rows(e.db);
    assert.equal(n, GOOGLE_GEOS.length + MASTODON_INSTANCES.length);
    const h2 = fakeHttp(vt.clock);
    const r2 = await run(e, h2.http, vt);
    assert.equal(h2.calls.length, 0);
    assert.equal(rows(e.db), n);
    assert.equal(r2.groups.google!.ok, GOOGLE_GEOS.length);
    assert.equal(r2.groups.google!.okNow, 0);
  });

  test("태그만 받고 링크가 실패한 인스턴스는 저장하지 않고, 다음 실행에서 둘 다 다시 받는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => (url.includes("x.example/api/v1/trends/links") ? { status: 500, text: "" } : undefined));
    const r = await run(e, h.http, vt, { sources: [fakeMastodon("x.example")] });
    assert.deepEqual(r.groups.mastodon!.failed, [{ label: "x.example", reason: "HTTP 500" }]);
    assert.equal(rows(e.db), 0);
    const h2 = fakeHttp(vt.clock);
    await run(e, h2.http, vt, { sources: [fakeMastodon("x.example")] });
    assert.ok(h2.urls().some((u) => u.includes("/tags")) && h2.urls().some((u) => u.includes("/links")));
    assert.equal(rows(e.db), 1);
  });

  test("첫 실행에서 받지 못한 소스만 두 번째에 요청한다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock, (url) => (url === googleTrendsUrl("DE") ? { status: 500, text: "" } : undefined)).http, vt);
    const h2 = fakeHttp(vt.clock);
    await run(e, h2.http, vt);
    assert.deepEqual(h2.urls(), ["https://trends.google.com/robots.txt", googleTrendsUrl("DE")]);
  });

  test("23:59와 00:01 KST 실행은 다른 날짜가 된다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const late = await run(e, fakeHttp(vt.clock).http, vt, { now: () => new Date("2026-11-04T23:59:00+09:00"), sources: [fakeMastodon("x.example")] });
    const early = await run(e, fakeHttp(vt.clock).http, vt, { now: () => new Date("2026-11-05T00:01:00+09:00"), sources: [fakeMastodon("x.example")] });
    assert.equal(late.day, "2026-11-04");
    assert.equal(early.day, "2026-11-05");
    assert.equal(rows(e.db), 2);
  });
});

describe("전용 DB 쓰기 실패", () => {
  test("한 호스트의 저장이 실패해도 다른 호스트를 끝까지 받은 뒤 실패를 낸다", async () => {
    const e = demandEnv();
    e.db.exec("CREATE TRIGGER fail_a BEFORE INSERT ON demand_snapshots WHEN NEW.source = 'mastodon:a.example' BEGIN SELECT RAISE(ABORT, 'disk'); END;");
    const vt = virtualTime();
    // b는 링크가 한 번 500이라 a보다 늦게 끝난다
    const h = fakeHttp(vt.clock, (url, n) => (url.startsWith("https://b.example/api/v1/trends/links") && n === 1 ? { status: 500, text: "" } : undefined));
    await assert.rejects(run(e, h.http, vt, { sources: [fakeMastodon("a.example"), fakeMastodon("b.example")] }));
    assert.equal(statusOf(e.db, "mastodon:b.example", DAY)?.status, "ok");
  });
});

describe("4.1-4 지우지 않음과 실행 전 사본", () => {
  test("가짜 마이그레이션(큰 번호)을 적용해도 스냅샷이 그대로다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock).http, vt, { sources: [fakeMastodon("x.example")] });
    const before = e.db.prepare("SELECT * FROM demand_parts ORDER BY part, page").all();
    const fake: Migration = { version: 1000, up: (db) => db.exec("CREATE TABLE fake_later (id INTEGER PRIMARY KEY)") };
    assert.deepEqual(migrate(e.db, [...DEMAND_MIGRATIONS, fake]), [1000]);
    assert.deepEqual(e.db.prepare("SELECT * FROM demand_parts ORDER BY part, page").all(), before);
    assert.equal(rows(e.db), 1);
  });

  test("스냅샷을 고치거나 지우는 문장은 DB가 막는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock).http, vt, { sources: [fakeMastodon("x.example")] });
    assert.throws(() => e.db.exec("DELETE FROM demand_snapshots"), /지우지 않는다/);
    assert.throws(() => e.db.exec("UPDATE demand_parts SET page = 9"), /고치지 않는다/);
    assert.throws(() => e.db.exec("DELETE FROM demand_parts"), /지우지 않는다/);
    assert.equal(rows(e.db), 1);
  });

  test("사본은 받을 소스가 있을 때만 만들고, 4번째에 가장 오래된 것부터 지워 3개를 둔다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const src = [fakeMastodon("x.example")];
    const at = (d: string) => () => new Date(`${d}T10:00:00+09:00`);
    await run(e, fakeHttp(vt.clock).http, vt, { dbExisted: false, now: at("2026-11-01"), sources: src });
    assert.ok(!fs.existsSync(copyDir(e.dataDir)), "첫 실행(전용 DB가 없었다)에는 사본이 없다");
    for (const d of ["2026-11-02", "2026-11-03", "2026-11-04"]) await run(e, fakeHttp(vt.clock).http, vt, { now: at(d), sources: src });
    assert.deepEqual(fs.readdirSync(copyDir(e.dataDir)).sort(), ["demand-20261102-100000.db", "demand-20261103-100000.db", "demand-20261104-100000.db"]);
    await run(e, fakeHttp(vt.clock).http, vt, { now: at("2026-11-04"), sources: src });
    assert.equal(fs.readdirSync(copyDir(e.dataDir)).length, DEMAND_COPY_KEEP, "받을 소스가 없는 같은 날 두 번째 실행은 사본을 늘리지 않는다");
    await run(e, fakeHttp(vt.clock).http, vt, { now: at("2026-11-05"), sources: src });
    assert.deepEqual(fs.readdirSync(copyDir(e.dataDir)).sort(), ["demand-20261103-100000.db", "demand-20261104-100000.db", "demand-20261105-100000.db"]);
    const copy = openDemandDb(path.join(copyDir(e.dataDir), "demand-20261105-100000.db"));
    assert.equal(rows(copy), 4, "사본은 받기 직전 상태다");
    copy.close();
  });

  test("깨진 사본을 둔 채 영상 30일 지우기와 본 DB 사본 정리를 돌려도 전용 DB 사본은 그대로다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock).http, vt, { sources: [fakeMastodon("x.example")] });
    await run(e, fakeHttp(vt.clock).http, vt, { now: () => new Date("2026-11-05T10:00:00+09:00"), sources: [fakeMastodon("x.example")] });
    fs.writeFileSync(path.join(copyDir(e.dataDir), "demand-20261101-000000.db"), "깨진 사본");
    fs.mkdirSync(path.join(e.dataDir, SNAPSHOT_DIR), { recursive: true });
    fs.writeFileSync(path.join(e.dataDir, SNAPSHOT_DIR, "tidwyn-20200101-000000.db"), "깨진 본 DB 사본");
    const before = Object.fromEntries(fs.readdirSync(copyDir(e.dataDir)).map((n) => [n, fs.readFileSync(path.join(copyDir(e.dataDir), n))]));
    const fileBefore = fs.readFileSync(e.file);
    purgeDataDir(e.dataDir, "2026-11-05");
    pruneSnapshots(e.dataDir, new Date("2026-11-05T10:00:00+09:00"));
    const after = Object.fromEntries(fs.readdirSync(copyDir(e.dataDir)).map((n) => [n, fs.readFileSync(path.join(copyDir(e.dataDir), n))]));
    assert.deepEqual(after, before);
    assert.ok(fs.readFileSync(e.file).equals(fileBefore));
    assert.ok(!fs.existsSync(path.join(e.dataDir, SNAPSHOT_DIR, "tidwyn-20200101-000000.db")), "본 DB 사본 정리는 돌았다");
  });
});

describe("4.1-5 공통 장치", () => {
  test("소스 하나를 목록에 더하면 받기, 상태, 끄기가 그 소스에 적용된다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const extra = fakeMastodon("new.example", "fake");
    const h = fakeHttp(vt.clock);
    const r = await run(e, h.http, vt, { sources: [...mastodon(), extra] });
    assert.equal(r.groups.fake!.ok, 1);
    assert.equal(statusOf(e.db, extra.id, DAY)?.status, "ok");
    const row = e.db.prepare("SELECT fetched_on, value_date FROM demand_snapshots WHERE source = ?").get(extra.id) as { fetched_on: string; value_date: string };
    assert.deepEqual({ ...row }, { fetched_on: DAY, value_date: DAY });
    const e2 = demandEnv();
    const h2 = fakeHttp(vt.clock);
    const r2 = await run(e2, h2.http, vt, { sources: [extra], off: { groups: [], sources: [extra.id] } });
    assert.equal(h2.calls.length, 0);
    assert.equal(r2.groups.fake!.off, 1);
  });
});

describe("4.2-1 끄기", () => {
  test("끈 소스와 묶음은 요청하지 않고 상태는 꺼짐이며 행은 그대로다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock).http, vt, { now: () => new Date("2026-11-03T10:00:00+09:00") });
    const n = rows(e.db);
    const h = fakeHttp(vt.clock);
    const r = await run(e, h.http, vt, { off: { groups: ["google"], sources: ["mastodon:uri.life"] } });
    assert.ok(!h.urls().some(isGoogle));
    assert.ok(!h.urls().some((u) => new URL(u).host === "uri.life"));
    assert.equal(r.groups.google!.off, GOOGLE_GEOS.length);
    assert.equal(r.groups.mastodon!.off, 1);
    assert.equal(statusOf(e.db, "google:KR", DAY)?.status, "off");
    assert.equal(statusOf(e.db, "mastodon:uri.life", DAY)?.status, "off");
    assert.equal(rows(e.db), n + MASTODON_INSTANCES.length - 1);
  });
});

describe("4.2-2 robots", () => {
  const P = ["/api/v1/trends/tags", "/api/v1/trends/links"];
  test("판정 규칙", () => {
    assert.equal(robotsBlocks("User-agent: GPTBot\nDisallow: /\n", P), false, "다른 봇만 막음");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /api/\n", P), true);
    assert.equal(robotsBlocks("User-agent: Googlebot\nUser-agent: ClaudeBot\nUser-agent: Bingbot\nDisallow: /\n\nUser-agent: *\nAllow: /\n", P), true, "여러 User-agent 줄의 그룹");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /api/\nAllow: /api/v1/trends/\n", P), false, "더 긴 Allow가 이긴다");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /api/v1/trends/\nAllow: /api/v1/trends/\n", P), false, "길이가 같으면 Allow");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /*/trends/links$\n", P), true, "`*`와 `$`");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /*/trends/links$\n", ["/api/v1/trends/links?limit=20"]), false);
    assert.equal(robotsBlocks("User-agent: anthropic-ai\nDisallow: /api\n\nUser-agent: *\nDisallow: /admin\n", P), true, "봇 그룹이 * 그룹 대신 쓰인다");
    assert.equal(robotsBlocks("User-agent: ClaudeBot\nAllow: /\n\nUser-agent: *\nDisallow: /\n", P), true, "* 그룹 자체가 막는다");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /explore?\n", ["/trending/rss?geo=KR"]), false, "Google의 실제 모양: /explore?만 막는다");
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /trending/\n", ["/trending/rss?geo=KR"]), true);
    assert.equal(robotsBlocks("User-agent: *\nDisallow:\n", P), false, "빈 Disallow는 막지 않는다");
    assert.throws(() => robotsBlocks("<!doctype html><html></html>", P));
  });

  test("Mastodon 소스의 robots 판정 경로가 실제로 받는 주소의 경로와 쿼리를 모두 담는다", async () => {
    const s = mastodon()[0]!;
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, () => undefined, { tags: MASTODON_CAP + 5, links: MASTODON_CAP + 5 });
    await run(e, h.http, vt, { sources: [s] });
    const asked = h.urls().map((u) => new URL(u)).filter((u) => u.pathname !== "/robots.txt").map((u) => u.pathname + u.search);
    assert.equal(asked.length, 10);
    for (const a of asked) assert.ok(s.paths.includes(a), a);
    assert.equal(robotsBlocks("User-agent: *\nDisallow: /*?*offset=\n", s.paths), true, "쿼리를 막는 규칙");
  });

  test("막힘은 robots 막힘, 404는 받음, 5xx와 형식 오류는 받지 못함이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const robots: Record<string, Reply> = {
      "a.example": { status: 200, text: "User-agent: ClaudeBot\nDisallow: /\n" },
      "b.example": { status: 404, text: "" },
      "c.example": { status: 503, text: "" },
      "d.example": { status: 200, text: "<html><body>로그인</body></html>" },
      "e.example": { status: 200, text: "User-agent: GPTBot\nDisallow: /\n" },
    };
    const h = fakeHttp(vt.clock, (url) => (new URL(url).pathname === "/robots.txt" ? robots[new URL(url).host] : undefined));
    const r = await run(e, h.http, vt, { sources: Object.keys(robots).map((x) => fakeMastodon(x)) });
    const g = r.groups.mastodon!;
    assert.equal(g.robots, 1);
    assert.equal(statusOf(e.db, "mastodon:a.example", DAY)?.status, "robots");
    assert.ok(!h.urls().some((u) => u.startsWith("https://a.example/api")), "막힌 호스트의 소스는 받지 않는다");
    assert.deepEqual(g.failed.sort((x, y) => x.label.localeCompare(y.label)), [
      { label: "c.example", reason: "robots 받지 못함(HTTP 503)" },
      { label: "d.example", reason: "robots 형식 오류" },
    ]);
    assert.equal(g.ok, 2);
    assert.equal(h.urls().filter((u) => u === "https://c.example/robots.txt").length, 2, "5xx는 한 번 다시 시도한다");
  });
});

describe("4.2-3 Google 막힘", () => {
  const blockAt = (geo: string, reply: Reply) => (url: string) => (url === googleTrendsUrl(geo) ? reply : undefined);
  const third = GOOGLE_GEOS[2]!;
  for (const [name, reply] of [
    ["/sorry로 가는 302", { status: 302, text: "", headers: { location: "https://www.google.com/sorry/index?continue=x" } }],
    ["429", { status: 429, text: "" }],
    ["403", { status: 403, text: "" }],
  ] as [string, Reply][]) {
    test(`3번째 나라가 ${name}이면 4번째부터 요청하지 않고 Mastodon은 받는다`, async () => {
      const e = demandEnv();
      const vt = virtualTime();
      const h = fakeHttp(vt.clock, blockAt(third, reply));
      const r = await run(e, h.http, vt);
      const g = h.urls().filter(isGoogle).filter((u) => !u.endsWith("robots.txt"));
      assert.deepEqual(g, GOOGLE_GEOS.slice(0, 3).map(googleTrendsUrl), "막힌 요청을 다시 시도하지 않는다");
      assert.equal(r.groups.google!.failed.length, GOOGLE_GEOS.length - 2);
      assert.ok(r.groups.google!.failed.every((f) => f.reason === "Google 막힘"));
      assert.equal(r.groups.mastodon!.ok, MASTODON_INSTANCES.length);
    });
  }

  test("같은 날 앞 실행이 Google 막힘이면 두 번째 실행은 Google을 robots까지 부르지 않는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    await run(e, fakeHttp(vt.clock, blockAt(third, { status: 429, text: "" })).http, vt);
    const h2 = fakeHttp(vt.clock);
    const r2 = await run(e, h2.http, vt);
    assert.equal(h2.calls.filter((c) => isGoogle(c.url)).length, 0);
    assert.equal(r2.groups.google!.failed.length, GOOGLE_GEOS.length - 2);
    // 다음 날은 다시 받는다
    const h3 = fakeHttp(vt.clock);
    await run(e, h3.http, vt, { now: () => new Date(NOW.getTime() + 24 * 3600_000) });
    assert.equal(h3.urls().filter(isGoogle).length, GOOGLE_GEOS.length + 1);
  });

  test("robots가 막힘을 주어도 Google 전체가 막힘이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => (url === "https://trends.google.com/robots.txt" ? { status: 302, text: "", headers: { location: "https://www.google.com/sorry/index" } } : undefined));
    const r = await run(e, h.http, vt, { sources: google() });
    assert.equal(h.calls.length, 1);
    assert.equal(r.groups.google!.failed.length, GOOGLE_GEOS.length);
    assert.equal(statusOf(e.db, "google:KR", DAY)?.reason, "Google 막힘");
  });

  test("다른 곳으로 가는 302와 400은 그 나라만 지원 안 함이고 다음 나라를 받는다. 항목 0개인 피드는 받음이다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const replies: Record<string, Reply> = {
      KR: { status: 302, text: "", headers: { location: "https://trends.google.com/trending?geo=KR" } },
      US: { status: 400, text: "" },
      JP: { status: 404, text: "" },
      TW: { status: 200, text: rss("TW", 0) },
    };
    const h = fakeHttp(vt.clock, (url) => replies[new URL(url).searchParams.get("geo") ?? ""]);
    const r = await run(e, h.http, vt, { sources: google() });
    assert.deepEqual(r.groups.google!.failed, [
      { label: "KR", reason: "지원 안 함(HTTP 302)" },
      { label: "US", reason: "지원 안 함(HTTP 400)" },
      { label: "JP", reason: "지원 안 함(HTTP 404)" },
    ]);
    assert.equal(r.groups.google!.ok, GOOGLE_GEOS.length - 3);
    assert.equal(statusOf(e.db, "google:TW", DAY)?.status, "ok");
    assert.equal(h.urls().filter((u) => u === googleTrendsUrl("KR")).length, 1);
  });

  test("500 뒤에는 한 번 다시 시도한다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url, n) => (url === googleTrendsUrl("KR") && n === 1 ? { status: 500, text: "" } : undefined));
    const r = await run(e, h.http, vt, { sources: google() });
    assert.equal(h.urls().filter((u) => u === googleTrendsUrl("KR")).length, 2);
    assert.equal(r.groups.google!.failed.length, 0);
  });
});

describe("4.3-3 연속 실패 일수", () => {
  test("받지 못함만 세고 robots 막힘·꺼짐은 세지도 끊지도 않으며 받음이 끊는다", async () => {
    const e = demandEnv();
    const vt = virtualTime();
    const id = "mastodon:x.example";
    const days: [string, "ok" | "failed" | "robots" | "off"][] = [
      ["2026-10-28", "failed"],
      ["2026-10-29", "ok"],
      ["2026-10-30", "failed"],
      ["2026-10-31", "robots"],
      ["2026-11-01", "failed"],
      ["2026-11-02", "off"],
      ["2026-11-03", "failed"],
    ];
    for (const [d, st] of days) setStatus(e.db, id, d, st, st === "failed" ? "HTTP 500" : null, `${d}T06:00:00+09:00`);
    const failing = fakeHttp(vt.clock, (url) => (url.includes("/trends/") ? { status: 500, text: "" } : undefined));
    const r = await run(e, failing.http, vt, { sources: [fakeMastodon("x.example")] });
    assert.deepEqual(r.streaks, [{ source: id, days: 4 }]);
    const e2 = demandEnv();
    for (const [d, st] of days.slice(0, 2)) setStatus(e2.db, id, d, st, null, `${d}T06:00:00+09:00`);
    setStatus(e2.db, id, "2026-11-03", "failed", "HTTP 500", "2026-11-03T06:00:00+09:00");
    const r2 = await run(e2, failing.http, vt, { sources: [fakeMastodon("x.example")] });
    assert.deepEqual(r2.streaks, [], "받음이 끊어 2일이다");
  });
});
