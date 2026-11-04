import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../src/db.ts";
import { OFFICIAL_START, WIKIMEDIA_WIKIS, officialSources } from "../src/demandSources.ts";
import { DEMAND_MIGRATIONS, failStreak, openDemandDb, requestCount, saveSnapshot, saveValueSnapshot, setMeta, statusOf, unpackBody } from "../src/demandStore.ts";
import { KEY_NAMES } from "../src/keys.ts";
import { BIGDATA_GAP_MS, OFFICIAL_DEADLINE_MS, OFFICIAL_MAX_BYTES, PUBLIC_USER_AGENT, dropFields, officialLines, pickFormD } from "../src/officialDemand.ts";
import { FEED_USER_AGENT } from "../src/feeds.ts";
import { DATES, DAY, DROPPED, FAKE, KEYS, LAST, NOW, TEXTS, bodies, defaultReply, fakeOfficial, officialEnv, pick, primaryDoc, runOff, savedDates, secIndex, virtualTime } from "./officialFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

// 9.96단계 4.1, 4.2, 4.3-2·3, 4.4-3: 공식 수요 받기. 네트워크를 쓰지 않는다(가짜 응답, 가짜 시계, 지어낸 키)

after(cleanupTemp);

const HOUR = 3600_000;
const DAY_MS = 24 * HOUR;
const LONG = 100 * HOUR;
const at = (iso: string) => new Date(iso);
const path = (u: string) => new URL(u).pathname;
const n = (db: DatabaseSync, sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;
const status = (db: DatabaseSync, id: string, day = DAY) => statusOf(db, id, day)?.status ?? null;
const reason = (db: DatabaseSync, id: string, day = DAY) => statusOf(db, id, day)?.reason ?? null;
const weekday = (d: string) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

describe("4.1-1 소스와 받는 것", () => {
  test("소스마다 여러 페이지를 모두 받아 값 날짜 하나로 저장한다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, undefined, { assembly: 150, perDay: (_k, d) => (d === "2026-10-01" ? 150 : 0), ftc: (ym) => (ym === "2026-10" ? 1500 : 0) });
    const r = await runOff(e, h.http, vt, { sources: pick("assembly:received", "acrc:qna", "acrc:proposal", "ftc1372:consult", "dart:list"), deadlineMs: LONG });
    const parts = (id: string, valueDate: string, part: string) => n(e.db, "SELECT COUNT(*) AS n FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id WHERE v.source = ? AND v.value_date = ? AND p.part = ?", id, valueDate, part);
    assert.equal(parts("assembly:received", DAY, "list"), 2);
    assert.equal(n(e.db, "SELECT items AS n FROM demand_values WHERE source = 'assembly:received'"), 150);
    assert.equal(parts("acrc:qna", "2026-10-01", "list"), 2);
    assert.equal(parts("acrc:qna", "2026-10-01", "item"), 150);
    assert.equal(parts("acrc:proposal", "2026-10-01", "item"), 150);
    assert.equal(parts("dart:list", "2026-10-01", "list"), 2);
    assert.equal(parts("ftc1372:consult", "2026-10", "list"), 2);
    assert.deepEqual(savedDates(e.db, "acrc:qna"), DATES, "0건 날짜도 받음(0건)으로 저장한다");
    assert.equal(r.sources["acrc:qna"]!.filled, DATES.length);
    for (const id of ["assembly:received", "acrc:qna", "acrc:proposal", "ftc1372:consult", "dart:list"]) assert.equal(status(e.db, id), "ok", id);
  });

  test("한 페이지나 상세 하나가 실패하면 그 값 날짜를 저장하지 않고 다음 실행에서 다시 받는다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const bad = (u: string) => (u.includes("PolicyQnaItem") && u.includes("2026-10-02-1")) || (u.includes("list.json") && u.includes("bgn_de=20261003") && u.includes("page_no=2"));
    const h = fakeOfficial(vt.clock, (u) => (bad(u) ? { status: 500, text: "" } : undefined), { perDay: (k, d) => (k === "dart" && d === "2026-10-03" ? 150 : 2) });
    await runOff(e, h.http, vt, { sources: pick("acrc:qna", "dart:list"), deadlineMs: LONG });
    assert.ok(!savedDates(e.db, "acrc:qna").includes("2026-10-02"));
    assert.ok(!savedDates(e.db, "dart:list").includes("2026-10-03"));
    assert.equal(savedDates(e.db, "acrc:qna").length, DATES.length - 1);
    assert.equal(status(e.db, "acrc:qna"), "failed");
    assert.equal(reason(e.db, "dart:list"), "HTTP 500");
    const h2 = fakeOfficial(vt.clock, undefined, { perDay: (k, d) => (k === "dart" && d === "2026-10-03" ? 150 : 2) });
    await runOff(e, h2.http, vt, { sources: pick("acrc:qna", "dart:list"), deadlineMs: LONG, now: () => new Date(NOW.getTime() + HOUR), runId: "run-2" });
    assert.ok(savedDates(e.db, "acrc:qna").includes("2026-10-02"));
    assert.ok(savedDates(e.db, "dart:list").includes("2026-10-03"));
    assert.deepEqual(
      h2.of((u) => u.pathname.endsWith("PolicyQnaList")).map((c) => new URL(c.url).searchParams.get("regFrom")),
      ["20261002"],
      "두 번째 실행은 남은 값 날짜만 요청한다",
    );
  });

  test("SEC는 인덱스에서 D·D/A 줄과 머리 줄만 저장하고, 다른 양식 줄의 개인 이름은 전용 DB에 없다", async () => {
    const picked = pickFormD(secIndex("2026-10-01"));
    assert.equal(picked.lines.length, 2);
    assert.ok(picked.lines.every((l) => /^(D|D\/A) /.test(l)));
    assert.ok(picked.text.startsWith("Description:") && picked.text.includes("-----"));
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    await runOff(e, h.http, vt, { sources: pick("sec:formd"), deadlineMs: LONG });
    const docs = h.of((u) => u.pathname.endsWith("primary_doc.xml")).map((c) => path(c.url));
    assert.ok(docs.every((p) => /\/edgar\/data\/(1234567\/000123456726000001|2345678\/000234567826000003)\/primary_doc\.xml$/.test(p)), "D·D/A 신고의 문서만 받는다");
    const raw = fs.readFileSync(e.file).toString("latin1") + bodies(e.db).join("");
    assert.ok(!raw.includes(FAKE.insider), "다른 양식 줄의 이름이 없다");
    assert.ok(bodies(e.db, "sec:formd").some((b) => b.includes(`D           ${FAKE.company} INC`)), "고른 줄은 그대로다");
  });

  test("상세 하나가 '자료 없음'이면 없음 표시로 두고 그 값 날짜를 저장하며 다시 요청하지 않는다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const absent = (u: string) => (u.includes("PolicyQnaItem") && u.includes("2026-10-05-0")) || (u.includes("primary_doc.xml") && u.includes("1234567/"));
    const reply = (u: string) => (!absent(u) ? undefined : u.includes("primary_doc") ? { status: 404, text: "" } : { status: 200, text: JSON.stringify({ resultCode: "E03", resultMsg: "자료 없음" }) });
    const h = fakeOfficial(vt.clock, reply);
    await runOff(e, h.http, vt, { sources: pick("acrc:qna", "sec:formd"), deadlineMs: LONG });
    assert.ok(savedDates(e.db, "acrc:qna").includes("2026-10-05"));
    assert.equal(n(e.db, "SELECT COUNT(*) AS n FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id WHERE v.source = 'acrc:qna' AND v.value_date = '2026-10-05' AND p.absent = 1"), 1);
    assert.ok(n(e.db, "SELECT COUNT(*) AS n FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id WHERE v.source = 'sec:formd' AND p.absent = 1") > 0);
    assert.deepEqual(savedDates(e.db, "sec:formd"), DATES);
    assert.equal(status(e.db, "acrc:qna"), "ok");
    const h2 = fakeOfficial(vt.clock, reply);
    await runOff(e, h2.http, vt, { sources: pick("acrc:qna", "sec:formd"), deadlineMs: LONG, runId: "run-2" });
    assert.equal(h2.of((u) => u.pathname.endsWith("PolicyQnaItem") || u.pathname.endsWith("primary_doc.xml")).length, 0);
  });
});

describe("4.1-2 개인 칸 버림", () => {
  test("버리는 칸의 지어낸 이름·전화·주소가 전용 DB(풀어 놓은 본문 포함)에 없고 다른 칸은 원문과 같다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, undefined, { perDay: (_k, d) => (d === "2026-10-01" ? 1 : 0) });
    await runOff(e, h.http, vt, { sources: pick("assembly", "acrc:qna", "acrc:proposal", "ftc1372:consult", "dart:list", "sec:formd", "wikimedia:ko"), deadlineMs: LONG });
    const file = fs.readFileSync(e.file).toString("latin1");
    const all = bodies(e.db).join("\n");
    for (const d of DROPPED) {
      assert.ok(!all.includes(d), `풀어 놓은 본문에 ${d}`);
      assert.ok(!file.includes(d), `DB 파일에 ${d}`);
    }
    const one = (id: string, part: string) => {
      const r = e.db.prepare("SELECT p.encoding, p.body, p.url FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id WHERE v.source = ? AND p.part = ? ORDER BY p.page LIMIT 1").get(id, part) as { encoding: string; body: Uint8Array; url: string };
      return { body: unpackBody(r.encoding, r.body).toString("utf8"), url: r.url };
    };
    const original = (u: string) => defaultReply(u, { perDay: (_k, d) => (d === "2026-10-01" ? 1 : 0) }).text;
    // 버리는 칸이 없는 소스는 원문 바이트 그대로다
    for (const [id, part] of [["acrc:qna", "list"], ["acrc:qna", "item"], ["ftc1372:consult", "list"], ["wikimedia:ko", "top"]] as const) {
      const r = one(id, part);
      assert.equal(r.body, original(r.url), id);
    }
    // 버리는 칸이 있는 소스는 그 칸만 빠지고 나머지 값은 같다
    for (const [id, part, names] of [["assembly:received", "list", ["PTTR_NM", "PROPOSER"]], ["acrc:proposal", "item", ["peterName"]], ["dart:list", "list", ["flr_nm"]]] as const) {
      const r = one(id, part);
      assert.deepEqual(JSON.parse(r.body), dropFields(JSON.parse(original(r.url)), names), id);
    }
    const doc = one("sec:formd", "doc").body;
    assert.equal(doc, primaryDoc().replace(/<street1>.*?<\/street1>/, "").replace(/<street2>.*?<\/street2>/, "").replace(/<zipCode>.*?<\/zipCode>/, "").replace(/<issuerPhoneNumber>.*?<\/issuerPhoneNumber>/, "").replace(/<relatedPersonsList>.*?<\/relatedPersonsList>/, "").replace(/<signatureName>.*?<\/signatureName>/, "").replace(/<nameOfSigner>.*?<\/nameOfSigner>/, "").replace(/<signatureTitle>.*?<\/signatureTitle>/, ""));
    assert.ok(doc.includes(`<entityName>${FAKE.company}</entityName>`) && doc.includes("<city>Springfield</city>"));
  });
});

describe("4.1-3 채우기와 하루 받기", () => {
  test("빈 DB에서 날짜로 받는 소스의 대상은 시작일부터 마지막 날짜까지이고, 국회 목록은 오늘 하나다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    const ids = ["assembly:pending", "acrc:qna", "acrc:proposal", "acrc:bigdata", "dart:list", "sec:formd", "wikimedia:en"];
    await runOff(e, h.http, vt, { sources: pick(...ids), deadlineMs: LONG });
    assert.equal(DATES[0], OFFICIAL_START);
    for (const id of ids.slice(1)) assert.deepEqual(savedDates(e.db, id), DATES, id);
    assert.deepEqual(savedDates(e.db, "assembly:pending"), [DAY]);
    const before = h.calls.length;
    const h2 = fakeOfficial(vt.clock);
    const r2 = await runOff(e, h2.http, vt, { sources: pick(...ids), deadlineMs: LONG, now: () => new Date(NOW.getTime() + HOUR), runId: "run-2" });
    assert.ok(before > 0);
    assert.deepEqual(
      h2.calls.filter((c) => path(c.url) !== "/robots.txt" && !path(c.url).endsWith("index.json")),
      [],
      "같은 날 두 번째 실행은 받을 것이 없다(국회 목록도 그날 한 번)",
    );
    assert.equal(r2.sources["acrc:qna"]!.remaining, 0);
  });

  test("Wikimedia의 아직 없음 404는 받지 못함과 연속 실패 일수에 들어가지 않는다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    for (let i = 0; i < 4; i++) {
      const now = new Date(NOW.getTime() + i * DAY_MS);
      const h = fakeOfficial(vt.clock, undefined, { wikiLatest: "2026-11-02" });
      await runOff(e, h.http, vt, { sources: pick("wikimedia:ja"), deadlineMs: LONG, now: () => now, runId: `run-${i}` });
    }
    assert.ok(!savedDates(e.db, "wikimedia:ja").includes(LAST));
    assert.equal(status(e.db, "wikimedia:ja"), "ok");
    assert.equal(failStreak(e.db, "wikimedia:ja", "2026-11-07"), 0);
  });

  test("Wikimedia가 7일 넘게 지난 날짜에 주는 404는 자료 없음으로 저장되어 다시 요청되지 않고, 최근 날짜의 404는 아직 없음이다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const gap = "2026-10-08";
    const reply = (u: string) => (u.includes("/2026/10/08") || u.includes("/2026/11/03") ? { status: 404, text: JSON.stringify({ type: "about:blank", title: "Not found." }), headers: { "content-type": "application/problem+json" } } : undefined);
    const h1 = fakeOfficial(vt.clock, reply);
    const r1 = await runOff(e, h1.http, vt, { sources: pick("wikimedia:ko"), deadlineMs: LONG });
    assert.ok(savedDates(e.db, "wikimedia:ko").includes(gap));
    assert.ok(!savedDates(e.db, "wikimedia:ko").includes(LAST));
    assert.equal(r1.sources["wikimedia:ko"]!.remaining, 0, "아직 없는 마지막 날짜는 남은 대상에 세지 않는다");
    const parts = e.db.prepare("SELECT p.absent FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id WHERE v.source = ? AND v.value_date = ?").all("wikimedia:ko", gap) as { absent: number }[];
    assert.deepEqual(parts.map((p) => p.absent), [1]);
    const h2 = fakeOfficial(vt.clock, reply);
    await runOff(e, h2.http, vt, { sources: pick("wikimedia:ko"), deadlineMs: LONG, runId: "run-2", now: () => new Date(NOW.getTime() + DAY_MS) });
    assert.ok(!h2.urls().some((u) => u.includes("/2026/10/08")));
    assert.equal(status(e.db, "wikimedia:ko"), "ok");
  });

  test("SEC 주말은 받음(0건)이 되어 다시 요청되지 않고, 분기 목록에 아직 없는 최신 날짜는 다음 실행에 다시 본다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, undefined, { secLatest: "2026-11-02" });
    await runOff(e, h.http, vt, { sources: pick("sec:formd"), deadlineMs: LONG });
    const saved = savedDates(e.db, "sec:formd");
    assert.ok(saved.includes("2026-10-31") && saved.includes("2026-11-01"), "주말");
    assert.equal(n(e.db, "SELECT items AS n FROM demand_values WHERE source = 'sec:formd' AND value_date = '2026-10-31'"), 0);
    assert.ok(!saved.includes(LAST));
    assert.equal(status(e.db, "sec:formd"), "ok");
    const idx = h.of((u) => u.pathname.endsWith(".idx")).map((c) => path(c.url));
    assert.ok(!idx.some((p) => p.includes("20261031") || p.includes("20261101")));
    const h2 = fakeOfficial(vt.clock);
    await runOff(e, h2.http, vt, { sources: pick("sec:formd"), deadlineMs: LONG, now: () => new Date(NOW.getTime() + HOUR), runId: "run-2" });
    assert.deepEqual(
      h2.of((u) => u.pathname.endsWith(".idx")).map((c) => path(c.url)),
      ["/Archives/edgar/daily-index/2026/QTR4/form.20261103.idx"],
    );
    assert.ok(savedDates(e.db, "sec:formd").includes(LAST));
  });

  test("새 분기 목록을 받지 못하면 그 분기 날짜는 아직 없음이고, 주말 판정은 분기와 상관없이 뒤 날짜를 본다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => (u.includes("/2026/QTR4/index.json") ? { status: 500, text: "" } : undefined));
    await runOff(e, h.http, vt, { sources: pick("sec:formd"), deadlineMs: LONG });
    assert.deepEqual(savedDates(e.db, "sec:formd"), ["2026-09-30"], "QTR4 날짜는 받지 않는다");
    assert.notEqual(status(e.db, "sec:formd"), "failed");
    // 2026-09-30(QTR3 마지막 날)이 없고 10-01(QTR4)이 있으면 09-30은 받음(0건)
    const e2 = officialEnv();
    const h2 = fakeOfficial(vt.clock, (u) => (u.includes("/2026/QTR3/index.json") ? { status: 200, text: JSON.stringify({ directory: { item: [] } }) } : undefined));
    await runOff(e2, h2.http, vt, { sources: pick("sec:formd"), deadlineMs: LONG });
    assert.equal(n(e2.db, "SELECT items AS n FROM demand_values WHERE source = 'sec:formd' AND value_date = '2026-09-30'"), 0);
  });

  test("23:59와 00:01 KST 실행은 받은 날짜가 다르다(국회 목록이 두 번 쌓인다)", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    for (const t of ["2026-11-04T23:59:00+09:00", "2026-11-05T00:01:00+09:00"]) await runOff(e, fakeOfficial(vt.clock).http, vt, { sources: pick("assembly:processed"), now: () => at(t), runId: t });
    assert.deepEqual(savedDates(e.db, "assembly:processed"), ["2026-11-04", "2026-11-05"]);
    assert.deepEqual((e.db.prepare("SELECT fetched_on FROM demand_values ORDER BY id").all() as { fetched_on: string }[]).map((r) => r.fetched_on), ["2026-11-04", "2026-11-05"]);
  });

  test("같은 호스트의 두 소스가 상한에 닿았을 때 둘 다 채운 날짜가 있다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, undefined, { perDay: () => 1 });
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:qna", "acrc:proposal"), deadlineMs: 70_000 + 12_000 });
    assert.ok(r.hitDeadline);
    assert.ok(savedDates(e.db, "acrc:qna").length > 0 && savedDates(e.db, "acrc:proposal").length > 0);
    assert.ok(r.sources["acrc:qna"]!.remaining > 0 && r.sources["acrc:proposal"]!.remaining > 0);
  });

  test("1372 달은 같은 호스트의 다른 소스보다 먼저 요청되고, 남은 시간이 잰 시간보다 짧으면 시작하지 않으며 잰 시간이 없으면 시작한다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    await runOff(e, h.http, vt, { sources: pick("acrc:qna", "ftc1372:consult"), deadlineMs: LONG });
    const data = h.calls.filter((c) => path(c.url) !== "/robots.txt");
    assert.ok(data[0]!.url.includes("getDscsnDetailSttus_2"), "잰 시간이 없어도 1372가 맨 앞이다");
    const firstQna = data.findIndex((c) => c.url.includes("PolicyQna"));
    assert.ok(data.slice(0, firstQna).every((c) => c.url.includes("getDscsnDetailSttus_2")));
    // 잰 시간(앞에 끝까지 받은 달의 시간)이 10분이면, 7일이 지나 다시 받을 차례인 진행 중인 달을 9분 상한의 호출에서 시작하지 않는다
    const e2 = officialEnv();
    for (const ym of ["2026-09", "2026-10", "2026-11"]) saveValueSnapshot(e2.db, { source: "ftc1372:consult", group: "ftc1372", label: "1372", valueDate: ym, fetchedOn: DAY, fetchedAt: "2026-11-04T15:00:00+09:00", items: 3, total: 3, elapsedMs: 600_000, parts: [] });
    const later = () => at("2026-11-12T15:00:00+09:00");
    const h3 = fakeOfficial(vt.clock);
    const r3 = await runOff(e2, h3.http, vt, { sources: pick("ftc1372:consult", "acrc:qna"), deadlineMs: OFFICIAL_DEADLINE_MS, now: later, runId: "run-3" });
    assert.equal(h3.of((u) => u.pathname.endsWith("getDscsnDetailSttus_2") && u.searchParams.get("numOfRows") === "1000").length, 0, "잰 시간(10분)이 상한(9분)보다 길다");
    assert.ok(r3.hitDeadline);
    assert.notEqual(status(e2.db, "ftc1372:consult", "2026-11-12"), "failed");
  });
});

describe("4.1-4 1372 주기", () => {
  const run1372 = async (e: ReturnType<typeof officialEnv>, iso: string, ftc: (ym: string) => number = () => 3) => {
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, undefined, { ftc });
    await runOff(e, h.http, vt, { sources: pick("ftc1372:consult"), deadlineMs: LONG, now: () => at(iso), runId: iso });
    return h.of(() => true).map((c) => ({ ym: new URL(c.url).searchParams.get("rcptYm"), rows: new URL(c.url).searchParams.get("numOfRows") }));
  };

  test("진행 중인 달은 7일째에 다시 받고 6일째에는 받지 않는다. 다시 받은 달의 앞 스냅샷은 그대로다", async () => {
    const e = officialEnv();
    assert.deepEqual((await run1372(e, "2026-11-04T15:00:00+09:00")).map((c) => c.ym), ["202609", "202610", "202611"]);
    assert.deepEqual(await run1372(e, "2026-11-10T15:00:00+09:00"), []);
    const before = e.db.prepare("SELECT id, fetched_at, bytes FROM demand_values ORDER BY id").all();
    const c7 = await run1372(e, "2026-11-11T15:00:00+09:00");
    assert.ok(c7.some((c) => c.ym === "202611" && c.rows === "1000"));
    assert.deepEqual(savedDates(e.db, "ftc1372:consult").filter((d) => d === "2026-11"), ["2026-11", "2026-11"]);
    assert.deepEqual(e.db.prepare("SELECT id, fetched_at, bytes FROM demand_values ORDER BY id").all().slice(0, before.length), before);
  });

  test("끝난 달은 건수가 같으면 다시 받지 않고 다르면 다시 받는다. 건수 확인은 같은 달에 7일에 한 번이다", async () => {
    const e = officialEnv();
    await run1372(e, "2026-11-04T15:00:00+09:00");
    const same = await run1372(e, "2026-11-11T15:00:00+09:00");
    assert.deepEqual(same.filter((c) => c.ym === "202610"), [{ ym: "202610", rows: "1" }], "한 건짜리 첫 페이지로만 본다");
    assert.deepEqual((await run1372(e, "2026-11-12T15:00:00+09:00", (ym) => (ym === "2026-10" ? 4 : 3))).filter((c) => c.ym === "202610"), [], "7일 안에는 건수를 다시 보지 않는다");
    const diff = await run1372(e, "2026-11-18T15:00:00+09:00", (ym) => (ym === "2026-10" ? 4 : 3));
    assert.deepEqual(diff.filter((c) => c.ym === "202610").map((c) => c.rows), ["1", "1000"]);
    assert.equal(savedDates(e.db, "ftc1372:consult").filter((d) => d === "2026-10").length, 2);
  });

  test("끝난 뒤 2달이 지난 달은 건수가 달라도 요청하지 않고, 스냅샷이 없는 끝난 달은 받는다", async () => {
    const e = officialEnv();
    await run1372(e, "2026-11-04T15:00:00+09:00");
    // 2026-09는 2026-12-01부터 끝난 뒤 2달이 지났다
    const c = await run1372(e, "2026-12-05T15:00:00+09:00", () => 9);
    assert.ok(!c.some((x) => x.ym === "202609"));
    const e2 = officialEnv();
    const c2 = await run1372(e2, "2027-02-05T15:00:00+09:00");
    assert.deepEqual([...new Set(c2.map((x) => x.ym))], ["202609", "202610", "202611", "202612", "202701", "202702"]);
  });
});

describe("4.1-5 저장 구조와 지우지 않음", () => {
  test("9.95 스냅샷이 든 전용 DB에 이 단계와 가짜(큰 번호) 마이그레이션을 적용해도 행과 바이트가 그대로다", () => {
    const e = officialEnv();
    const file = `${e.dataDir}/old.db`;
    const old = new DatabaseSync(file);
    migrate(old, DEMAND_MIGRATIONS.filter((m) => m.version === 1));
    assert.equal((old.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    saveSnapshot(old, { source: "google:KR", group: "google", label: "KR", fetchedOn: "2026-11-03", valueDate: "2026-11-03", fetchedAt: "2026-11-03T06:00:00+09:00", parts: [{ part: "feed", page: 1, url: "https://example.com/rss", body: Buffer.from("지어낸 피드 바이트") }] });
    const rowsBefore = old.prepare("SELECT * FROM demand_snapshots").all();
    const partsBefore = old.prepare("SELECT * FROM demand_parts").all();
    old.close();
    const db = openDemandDb(file);
    migrate(db, [...DEMAND_MIGRATIONS, { version: 1000, up: (d) => d.exec("CREATE TABLE fake_later (x INTEGER)") }]);
    assert.deepEqual(db.prepare("SELECT * FROM demand_snapshots").all(), rowsBefore);
    assert.deepEqual(db.prepare("SELECT * FROM demand_parts").all(), partsBefore);
    db.close();
  });

  test("새 스냅샷을 고치거나 지우는 문장은 실패하고, 압축을 푼 본문은 원래 바이트와 같다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    await runOff(e, fakeOfficial(vt.clock).http, vt, { sources: pick("wikimedia:de") });
    for (const sql of ["UPDATE demand_values SET items = 0", "DELETE FROM demand_values", "UPDATE demand_value_parts SET body = x'00'", "DELETE FROM demand_value_parts"]) assert.throws(() => e.db.exec(sql), /./, sql);
    const r = e.db.prepare("SELECT encoding, body, url FROM demand_value_parts LIMIT 1").get() as { encoding: string; body: Uint8Array; url: string };
    assert.equal(r.encoding, "gzip");
    assert.ok(Buffer.from(r.body).subarray(0, 2).equals(Buffer.from([0x1f, 0x8b])));
    assert.equal(unpackBody(r.encoding, r.body).toString("utf8"), defaultReply(r.url).text);
  });
});

describe("4.2-1 키", () => {
  test("키 이름 목록에 새 키가 있고, 키 하나가 없으면 그 키의 소스만 키 없음이고 요청이 0이다", async () => {
    for (const k of ["DATA_GO_KR_KEY", "ASSEMBLY_API_KEY", "DART_API_KEY"]) assert.ok((KEY_NAMES as readonly string[]).includes(k), k);
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    const r = await runOff(e, h.http, vt, { sources: pick("assembly:received", "dart:list", "wikimedia:it"), keys: { ...KEYS, DART_API_KEY: null }, deadlineMs: LONG });
    assert.equal(h.calls.filter((c) => new URL(c.url).host === "opendart.fss.or.kr").length, 0);
    assert.equal(status(e.db, "dart:list"), "failed");
    assert.equal(reason(e.db, "dart:list"), "키 없음");
    assert.equal(r.groups.dart!.noKey, 1);
    assert.equal(status(e.db, "assembly:received"), "ok");
    assert.equal(status(e.db, "wikimedia:it"), "ok");
  });
});

describe("4.2-2 끄기", () => {
  test("끈 소스와 묶음은 요청 0, 상태 꺼짐이고 쌓인 행은 그대로다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    await runOff(e, fakeOfficial(vt.clock).http, vt, { sources: pick("assembly", "wikimedia:fr") });
    const rows = n(e.db, "SELECT COUNT(*) AS n FROM demand_values");
    const h = fakeOfficial(vt.clock);
    const r = await runOff(e, h.http, vt, { sources: pick("assembly", "wikimedia:fr"), off: { groups: ["assembly"], sources: ["wikimedia:fr"] }, now: () => new Date(NOW.getTime() + DAY_MS), runId: "run-2" });
    assert.equal(h.calls.length, 0);
    assert.equal(n(e.db, "SELECT COUNT(*) AS n FROM demand_values"), rows);
    for (const id of ["assembly:received", "assembly:pending", "assembly:processed", "wikimedia:fr"]) assert.equal(status(e.db, id, "2026-11-05"), "off");
    assert.equal(r.groups.assembly!.off, 3);
  });
});

describe("4.2-3 robots", () => {
  const robotsCase = async (host: string, replies: Record<string, { status: number; text: string; headers?: Record<string, string> }>) => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => replies[new URL(u).href]);
    const id = host === "opendart.fss.or.kr" ? "dart:list" : host === "wikimedia.org" ? "wikimedia:pt" : "assembly:received";
    await runOff(e, h.http, vt, { sources: pick(id), deadlineMs: LONG });
    return { st: statusOf(e.db, id, DAY), data: h.of((u) => !u.pathname.includes("robots")).length };
  };
  const R = (host: string, p = "/robots.txt") => `https://${host}${p}`;

  test("400은 파일 없음(받음), 302 → 404와 302 → 다른 경로의 200 HTML은 파일 없음(받음)이다", async () => {
    assert.equal((await robotsCase("open.assembly.go.kr", { [R("open.assembly.go.kr")]: { status: 400, text: "<OpenAPI_ServiceResponse/>" } })).st?.status, "ok");
    assert.equal((await robotsCase("wikimedia.org", { [R("wikimedia.org")]: { status: 302, text: "", headers: { location: "https://www.wikimedia.org//robots.txt" } }, "https://www.wikimedia.org//robots.txt": { status: 404, text: "" } })).st?.status, "ok");
    assert.equal((await robotsCase("opendart.fss.or.kr", { [R("opendart.fss.or.kr")]: { status: 302, text: "", headers: { location: "/error.html" } }, [R("opendart.fss.or.kr", "/error.html")]: { status: 200, text: "<!DOCTYPE html><html><body>오류</body></html>" } })).st?.status, "ok");
  });

  test("리디렉션 없는 200 HTML, 다섯 번 넘는 리디렉션, 5xx는 받지 못함이다", async () => {
    const html = await robotsCase("open.assembly.go.kr", { [R("open.assembly.go.kr")]: { status: 200, text: "<html><body>x</body></html>" } });
    assert.equal(html.st?.status, "failed");
    assert.equal(html.st?.reason, "robots 형식 오류");
    assert.equal(html.data, 0);
    const loop: Record<string, { status: number; text: string; headers?: Record<string, string> }> = {};
    for (let i = 0; i < 7; i++) loop[R("open.assembly.go.kr", i === 0 ? "/robots.txt" : `/r${i}`)] = { status: 302, text: "", headers: { location: `/r${i + 1}` } };
    assert.equal((await robotsCase("open.assembly.go.kr", loop)).st?.status, "failed");
    assert.equal((await robotsCase("open.assembly.go.kr", { [R("open.assembly.go.kr")]: { status: 503, text: "" } })).st?.status, "failed");
  });

  test("302 → 막는 robots와 `*` Disallow가 받는 경로를 막으면 막힘이다", async () => {
    const block = "User-agent: *\nDisallow: /api/\n";
    const r1 = await robotsCase("opendart.fss.or.kr", { [R("opendart.fss.or.kr")]: { status: 302, text: "", headers: { location: "/robots2.txt" } }, [R("opendart.fss.or.kr", "/robots2.txt")]: { status: 200, text: block } });
    assert.equal(r1.st?.status, "robots");
    assert.equal(r1.data, 0);
    const r2 = await robotsCase("open.assembly.go.kr", { [R("open.assembly.go.kr")]: { status: 200, text: "User-agent: *\nDisallow: /portal/openapi/\n" } });
    assert.equal(r2.st?.status, "robots");
    const r3 = await robotsCase("open.assembly.go.kr", { [R("open.assembly.go.kr")]: { status: 200, text: "User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin/\n" } });
    assert.equal(r3.st?.status, "ok");
  });
});

describe("4.2-4 한도와 간격", () => {
  test("같은 호스트 간격은 1초, SEC는 0.2초다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    await runOff(e, h.http, vt, { sources: pick("acrc:qna", "acrc:proposal", "sec:formd"), deadlineMs: LONG });
    const gaps = (host: string) => {
      const at = h.calls.filter((c) => new URL(c.url).host === host).map((c) => c.at);
      return at.slice(1).map((t, i) => t - at[i]!);
    };
    assert.ok(Math.min(...gaps("apis.data.go.kr")) >= 1000);
    assert.ok(Math.min(...gaps("www.sec.gov")) >= 200);
    assert.ok(Math.min(...gaps("www.sec.gov")) < 1000);
  });

  test("민원빅데이터의 2분 간격은 같은 호스트의 다른 소스를 막지 않고, 앞 호출의 마지막 요청에서 2분이 안 되면 기다리거나 미룬다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:bigdata", "acrc:qna"), deadlineMs: 5 * 60_000 });
    const big = h.of((u) => u.pathname.endsWith("minTodayTopicInfo5")).map((c) => c.at);
    assert.ok(big.length >= 2);
    for (let i = 1; i < big.length; i++) assert.ok(big[i]! - big[i - 1]! >= BIGDATA_GAP_MS);
    const qna = h.of((u) => u.pathname.includes("PolicyQna")).map((c) => c.at);
    assert.ok(qna.filter((t) => t < BIGDATA_GAP_MS).length > 10, "2분 사이에 질의응답은 계속 받는다");
    assert.ok(r.hitDeadline);
    // 두 번째 호출: 앞 호출의 마지막 요청 시각이 전용 DB에 있다. 지금이 그 1분 뒤면 1분 기다린다
    const last = NOW.getTime();
    setMeta(e.db, "acrc:bigdata:last-request", String(last));
    const vt2 = virtualTime();
    const h2 = fakeOfficial(vt2.clock);
    await runOff(e, h2.http, vt2, { sources: pick("acrc:bigdata"), deadlineMs: 5 * 60_000, now: () => new Date(last + 60_000), runId: "run-1" });
    assert.ok(h2.of((u) => u.pathname.endsWith("minTodayTopicInfo5"))[0]!.at >= 60_000);
    // 상한 안에 기다릴 수 없으면 미룬다(받지 못함이 아니다)
    const vt3 = virtualTime();
    const h3 = fakeOfficial(vt3.clock);
    const r3 = await runOff(e, h3.http, vt3, { sources: pick("acrc:bigdata"), deadlineMs: 90_000, now: () => new Date(last + 1000), runId: "run-1" });
    assert.equal(h3.of((u) => u.pathname.endsWith("minTodayTopicInfo5")).length, 0);
    assert.ok(r3.hitDeadline);
    assert.notEqual(status(e.db, "acrc:bigdata"), "failed");
  });

  test("민원빅데이터의 일시 오류 뒤 다시 시도도 앞 요청에서 2분 뒤에 보낸다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u, n) => (u.includes("minTodayTopicInfo5") && n === 1 ? { status: 503, text: "" } : undefined));
    await runOff(e, h.http, vt, { sources: pick("acrc:bigdata"), deadlineMs: 5 * 60_000 });
    const big = h.of((u) => u.pathname.endsWith("minTodayTopicInfo5")).map((c) => c.at);
    assert.ok(big.length >= 2);
    for (let i = 1; i < big.length; i++) assert.ok(big[i]! - big[i - 1]! >= BIGDATA_GAP_MS, `${big[i]! - big[i - 1]!}`);
    assert.ok(savedDates(e.db, "acrc:bigdata").includes(DATES[0]!), "다시 시도로 받았다");
  });

  test("같은 날 앞 실행 요청 수를 더해 하루 한도 90%에서 멈추고, 받지 못함이 아니라 남은 대상이다", async () => {
    const e = officialEnv();
    for (let i = 0; i < 88; i++) e.db.prepare("INSERT INTO demand_requests (source, day, count) VALUES ('acrc:bigdata', ?, 1) ON CONFLICT (source, day) DO UPDATE SET count = count + 1").run(DAY);
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:bigdata"), deadlineMs: LONG });
    assert.equal(h.of(() => true).length, 2, "88 + 2 = 90(100의 90%)");
    assert.equal(requestCount(e.db, "acrc:bigdata", DAY), 90);
    assert.ok(r.sources["acrc:bigdata"]!.quota);
    assert.equal(status(e.db, "acrc:bigdata"), "ok");
    assert.equal(r.sources["acrc:bigdata"]!.remaining, DATES.length - 2 - 1);
    assert.match(officialLines({ ...r, dbBytes: 1, calls: 1 }).join("\n"), /하루 한도로 멈춘 소스: 민원빅데이터 오늘의 이슈/);
  });

  test("간격 요구 응답 뒤 그 소스 요청이 없고, 뒤 호출에도 이어진다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => (u.includes("minTodayTopicInfo5") ? { status: 200, text: JSON.stringify({ code: "E99", msg: "요청 간격이 너무 짧습니다" }) } : undefined));
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:bigdata"), deadlineMs: LONG });
    assert.equal(h.of(() => true).length, 1);
    assert.equal(reason(e.db, "acrc:bigdata"), "한도");
    const h2 = fakeOfficial(vt.clock);
    await runOff(e, h2.http, vt, { sources: pick("acrc:bigdata"), deadlineMs: LONG, prior: r, now: () => new Date(NOW.getTime() + 10 * 60_000) });
    assert.equal(h2.of(() => true).length, 0);
    assert.equal(status(e.db, "acrc:bigdata"), "failed");
  });

  test("키 미등록 오류 XML 뒤 같은 서비스의 소스는 멈추고(키 거부), 같은 키의 다른 서비스는 계속 받는다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    const h = fakeOfficial(vt.clock, (u) => (u.includes("OpenProposal") ? { status: 200, text: xml } : undefined));
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:proposal", "acrc:qna"), deadlineMs: LONG });
    assert.equal(h.of((u) => u.pathname.includes("OpenProposal")).length, 1);
    assert.equal(reason(e.db, "acrc:proposal"), "키 거부");
    assert.deepEqual(savedDates(e.db, "acrc:qna"), DATES);
    assert.equal(r.stops["DATA_GO_KR_KEY:15059423"], "키 거부");
  });

  test("소스마다 인증 오류·한도 응답 뒤 그 소스 요청이 없고, DART 013은 0건 받음이다", async () => {
    const cases: [string, (u: string) => boolean, { status: number; text: string }, string][] = [
      ["dart:list", (u) => u.includes("list.json"), { status: 200, text: JSON.stringify({ status: "020", message: "요청 제한을 초과하였습니다." }) }, "한도"],
      ["dart:list", (u) => u.includes("list.json"), { status: 200, text: JSON.stringify({ status: "010", message: "등록되지 않은 키입니다." }) }, "키 거부"],
      ["assembly:received", (u) => u.includes("PTTRCP"), { status: 200, text: JSON.stringify({ RESULT: { CODE: "INFO-300", MESSAGE: "인증키가 유효하지 않습니다." } }) }, "키 거부"],
      ["assembly:received", (u) => u.includes("PTTRCP"), { status: 200, text: JSON.stringify({ RESULT: { CODE: "ERROR-337", MESSAGE: "일별 트래픽 제한을 넘은 호출입니다." } }) }, "한도"],
      ["ftc1372:consult", (u) => u.includes("getDscsn"), { status: 200, text: JSON.stringify({ resultCode: "22", resultMsg: "LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR" }) }, "한도"],
      ["acrc:qna", (u) => u.includes("PolicyQna"), { status: 401, text: "Unauthorized" }, "키 거부"],
      ["wikimedia:zh", (u) => u.includes("/top/"), { status: 429, text: "" }, "한도"],
      ["sec:formd", (u) => u.includes("index.json"), { status: 429, text: "" }, "한도"],
    ];
    for (const [id, match, reply, why] of cases) {
      const e = officialEnv();
      const vt = virtualTime();
      const h = fakeOfficial(vt.clock, (u) => (match(u) ? reply : undefined));
      await runOff(e, h.http, vt, { sources: pick(id), deadlineMs: LONG });
      assert.equal(h.of(() => true).length, 1, `${id} ${why}`);
      assert.equal(reason(e.db, id), why, id);
    }
    const e = officialEnv();
    const vt = virtualTime();
    await runOff(e, fakeOfficial(vt.clock, undefined, { perDay: () => 0 }).http, vt, { sources: pick("dart:list"), deadlineMs: LONG });
    assert.deepEqual(savedDates(e.db, "dart:list"), DATES);
    assert.equal(n(e.db, "SELECT SUM(items) AS n FROM demand_values"), 0);
    assert.equal(status(e.db, "dart:list"), "ok");
  });

  test("응답 크기 상한을 넘는 응답은 실패다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const big = "x".repeat(OFFICIAL_MAX_BYTES + 1);
    await runOff(e, fakeOfficial(vt.clock, (u) => (u.includes("/top/") && u.endsWith("/2026/10/01") ? { status: 200, text: big } : undefined)).http, vt, { sources: pick("wikimedia:es"), deadlineMs: LONG });
    assert.equal(reason(e.db, "wikimedia:es"), "크기 상한");
    assert.ok(!savedDates(e.db, "wikimedia:es").includes("2026-10-01"));
  });

  test("SEC·Wikimedia 요청(robots 포함)의 User-Agent에는 공개 메일이 있고 다른 소스는 기존 식별 문자열이다", async () => {
    assert.match(PUBLIC_USER_AGENT, /mivomad33@gmail\.com/);
    assert.match(PUBLIC_USER_AGENT, /tidwyn\.vercel\.app/);
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    await runOff(e, h.http, vt, { sources: pick("sec:formd", "wikimedia:ko", "dart:list", "assembly:received"), deadlineMs: LONG });
    for (const c of h.calls) {
      const host = new URL(c.url).host;
      assert.equal(c.agent, host === "www.sec.gov" || host === "wikimedia.org" ? PUBLIC_USER_AGENT : FEED_USER_AGENT, c.url);
    }
    assert.ok(h.calls.some((c) => c.url === "https://www.sec.gov/robots.txt" && c.agent === PUBLIC_USER_AGENT));
  });
});

describe("4.3-2 실패 격리(받기 함수)", () => {
  test("9분 상한에서 멈추고 남은 대상이 있다. 상한에 닿아 남은 소스와 차례가 오지 않은 소스는 받지 못함이 아니다", async () => {
    const e = officialEnv();
    // 1372는 잰 시간이 상한보다 길어 차례가 오지 않는다
    for (const ym of ["2026-09", "2026-10"]) saveValueSnapshot(e.db, { source: "ftc1372:consult", group: "ftc1372", label: "1372", valueDate: ym, fetchedOn: DAY, fetchedAt: "2026-11-04T15:00:00+09:00", items: 3, total: 3, elapsedMs: 600_000, parts: [] });
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => (u.includes("list.json") ? "hang" : undefined), { perDay: () => 20 });
    const r = await runOff(e, h.http, vt, { sources: pick("acrc:qna", "ftc1372:consult", "dart:list", "wikimedia:ru") });
    assert.ok(vt.clock() <= OFFICIAL_DEADLINE_MS);
    assert.ok(r.hitDeadline);
    assert.ok(r.sources["acrc:qna"]!.filled > 0 && r.sources["acrc:qna"]!.remaining > 0);
    assert.equal(status(e.db, "acrc:qna"), "ok");
    assert.equal(status(e.db, "ftc1372:consult"), null, "차례가 오지 않은 소스는 상태를 남기지 않는다");
    assert.equal(r.sources["ftc1372:consult"]!.remaining, 1);
    assert.deepEqual(savedDates(e.db, "wikimedia:ru"), DATES);
    for (const id of ["acrc:qna", "ftc1372:consult"]) assert.equal(failStreak(e.db, id, DAY), 0);
    // 요청 시간 상한(60초)에 두 번 걸린 DART는 시간 초과로 받지 못함이다
    assert.equal(reason(e.db, "dart:list"), "시간 초과");
  });

  test("앞 호출에서 받지 못함인 소스는 뒤 호출에서 받아도 그날 받지 못함이고, 결과가 합쳐진다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => (u.endsWith("/2026/10/01") ? { status: 500, text: "" } : undefined));
    const r1 = await runOff(e, h.http, vt, { sources: pick("wikimedia:ko"), deadlineMs: 75_000 });
    assert.equal(status(e.db, "wikimedia:ko"), "failed");
    const filled1 = r1.sources["wikimedia:ko"]!.filled;
    const h2 = fakeOfficial(vt.clock);
    const r2 = await runOff(e, h2.http, vt, { sources: pick("wikimedia:ko"), deadlineMs: LONG, prior: r1 });
    assert.equal(status(e.db, "wikimedia:ko"), "failed");
    assert.equal(r2.sources["wikimedia:ko"]!.filled, DATES.length - 1, "두 호출의 채운 수를 합친다(실패한 10-01은 다음 실행)");
    assert.ok(filled1 > 0);
    assert.equal(r2.groups.wikimedia!.requests, r1.groups.wikimedia!.requests + h2.calls.length);
    assert.ok(!h2.urls().some((u) => u.endsWith("/2026/10/01")), "앞 호출에서 실패한 값 날짜는 다음 실행이 받는다");
    assert.equal(r2.sources["wikimedia:ko"]!.remaining, 1);
  });

  test("같은 값 날짜가 서로 다른 실행 세 번 연속 상한에 끊기면 사유 '시간 상한'의 받지 못함이다", async () => {
    const e = officialEnv();
    // 1372 한 달이 100페이지라 75초 상한에 끊긴다
    for (let i = 1; i <= 3; i++) {
      const vt = virtualTime();
      const h = fakeOfficial(vt.clock, undefined, { ftc: (ym) => (ym === "2026-09" ? 100_000 : 3) });
      const now = new Date(NOW.getTime() + (i - 1) * DAY_MS);
      await runOff(e, h.http, vt, { sources: pick("ftc1372:consult"), deadlineMs: 75_000, now: () => now, runId: `run-${i}` });
      const day = now.toISOString().slice(0, 10);
      assert.equal(status(e.db, "ftc1372:consult", day) === "failed", i === 3, `실행 ${i}`);
    }
    assert.equal(reason(e.db, "ftc1372:consult", "2026-11-06"), "시간 상한");
  });

  test("잘린 JSON과 깨진 XML은 사유에 종류만 나오고, 받은 글과 키는 출력 줄에 없다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => {
      if (u.includes("list.json")) return { status: 200, text: `{"status":"000","list":[{"corp_name":"${FAKE.company}","report_nm":"${FAKE.title}"` };
      if (u.includes("primary_doc.xml")) return { status: 200, text: `<?xml version="1.0"?><broken><entityName>${FAKE.company}</entityName>` };
      if (u.includes("/top/")) return "throw";
      return undefined;
    });
    const r = await runOff(e, h.http, vt, { sources: pick("dart:list", "sec:formd", "wikimedia:en"), deadlineMs: LONG });
    assert.equal(reason(e.db, "dart:list"), "형식 오류");
    assert.equal(reason(e.db, "sec:formd"), "형식 오류");
    assert.equal(reason(e.db, "wikimedia:en"), "연결 실패");
    const out = officialLines({ ...r, dbBytes: 1, calls: 1 }).join("\n") + JSON.stringify(r);
    for (const t of [...TEXTS, ...Object.values(KEYS)]) assert.ok(!out.includes(t), t);
    assert.match(out, /DART 공시: 소스 1개 중 받음 0, 받지 못함 1\(공시검색 목록: 형식 오류\)/);
  });
});

describe("4.3-3 실행 요약", () => {
  test("요약 줄에 묶음별 수, 소스별 채움·남음, 요청 수, 바이트, 시간, 상한, 3일 연속 받지 못함이 나온다", async () => {
    const e = officialEnv();
    let r = null as Awaited<ReturnType<typeof runOff>> | null;
    for (let i = 0; i < 3; i++) {
      const vt = virtualTime();
      const now = new Date(NOW.getTime() + i * DAY_MS);
      r = await runOff(e, fakeOfficial(vt.clock, (u) => (u.includes("list.json") ? { status: 503, text: "" } : undefined), { wikiLatest: "2099-01-01" }).http, vt, { sources: pick("dart:list", "assembly:pending", "wikimedia:ko"), keys: { ...KEYS, ASSEMBLY_API_KEY: null }, deadlineMs: LONG, now: () => now, runId: `run-${i}` });
    }
    const lines = officialLines({ ...r!, dbBytes: 12345, calls: 2 });
    const text = lines.join("\n");
    assert.match(text, /- 공식 수요 국회 청원: 소스 1개 중 받음 0, 받지 못함 1\(청원 계류현황: 키 없음\), 키 없음 1, robots 막힘 0, 꺼짐 0\. 요청 0번\(robots 0번\)/);
    assert.match(text, /- 공식 수요 DART 공시: 소스 1개 중 받음 0, 받지 못함 1\(공시검색 목록: HTTP 503\), 키 없음 0, robots 막힘 0, 꺼짐 0\. 요청 \d+번\(robots 1번\), 저장 0바이트\(압축 전 0\)\. 공시검색 목록 채움 0·남음 \d+/);
    assert.match(text, /- 공식 수요 Wikimedia 인기 문서: 소스 1개 중 받음 1, .*저장 \d+바이트\(압축 전 \d+\)\. ko\.wikipedia 채움 1·남음 0/);
    assert.match(text, /- 공식 수요\(2026-11-06\): 전용 DB 12345바이트, 걸린 시간 \d+초\(2번 부름\), 남은 채우기 대상 \d+/);
    assert.match(text, /- 공식 수요 상한: 닿지 않음/);
    assert.match(text, /- 공식 수요 소스 연속 받지 못함\(3일 이상\): (assembly:pending 3일, dart:list 3일|dart:list 3일, assembly:pending 3일)/);
  });
});

describe("4.4-3 키가 새지 않음", () => {
  test("키를 되돌려 주는 응답과 키가 든 주소의 네트워크 오류 뒤에도 전용 DB(풀어 놓은 본문 포함)와 결과에 키가 없다", async () => {
    const e = officialEnv();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => {
      if (u.includes("list.json")) return { status: 200, text: JSON.stringify({ status: "000", total_count: 1, total_page: 1, list: [{ echo: KEYS.DART_API_KEY, corp_name: "x" }] }) };
      if (u.includes("PTTRCP")) return "throw";
      const url = new URL(u);
      if (url.pathname.endsWith("PolicyQnaList")) return { status: 200, text: JSON.stringify({ resultCode: "S00", resultCount: 0, resultList: [], echo: url.searchParams.get("serviceKey") }) };
      return undefined;
    });
    const r = await runOff(e, h.http, vt, { sources: pick("dart:list", "assembly:received", "acrc:qna"), deadlineMs: LONG });
    assert.ok(h.urls().some((u) => u.includes(KEYS.DART_API_KEY)), "요청에는 키를 쓴다");
    const file = fs.readFileSync(e.file).toString("latin1");
    const all = bodies(e.db).join("") + JSON.stringify(e.db.prepare("SELECT url FROM demand_value_parts").all()) + JSON.stringify(r) + officialLines({ ...r, dbBytes: 1, calls: 1 }).join("");
    for (const k of Object.values(KEYS)) {
      assert.ok(!file.includes(k), `DB 파일에 ${k}`);
      assert.ok(!all.includes(k), `본문·주소·결과에 ${k}`);
    }
    assert.ok(bodies(e.db, "dart:list").some((b) => b.includes('"echo":"***"')));
  });
});

describe("4.5-1 소스 목록", () => {
  test("위키는 S5의 10개이고 소스 id가 겹치지 않는다", () => {
    assert.deepEqual([...WIKIMEDIA_WIKIS], ["en", "ja", "de", "es", "fr", "ru", "zh", "it", "pt", "ko"]);
    const ids = officialSources().map((s) => s.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(DATES.every((d, i) => i === 0 || d > DATES[i - 1]!));
    assert.equal(DATES.filter(weekday).length > 0, true);
  });
});
