import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, restoreBackup } from "../src/backup.ts";
import { main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { fetchIndicator, fetchRange, type HttpJson } from "../src/indicatorFetch.ts";
import { applyJudgeFile, checkJudgeFile, judgeBatches, judgeWorkFile, renderJudgeCandidates } from "../src/indicatorJudge.ts";
import { DAILY_START, INDICATORS, MONTHLY_START, indicatorDef, type IndicatorDef } from "../src/indicators.ts";
import { applyJudgment, indicatorValues, isJudged, issueIndicators, unjudgedIssues, upsertValues } from "../src/indicatorStore.ts";
import { createIssue, getIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { readKeys } from "../src/keys.ts";
import { createEntity, createTerm, linkEntity, linkTerm } from "../src/refs.ts";
import { createSchedule } from "../src/schedules.ts";
import { addDays } from "../src/kst.ts";
import { applyMerges, unmerge } from "../src/merge.ts";
import { precheck } from "../src/precheck.ts";
import { readRun, writeRun, type RunState } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSiteData } from "../src/siteData.ts";
import type { DayList, IndicatorList, IndicatorSeries, IssueChunk, IssueDetail, MonthList } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

after(cleanupTemp);

// 6단계 주요 지표(4.1~4.6, 4.8). 지표 값, 이슈 이름, 키는 모두 지어낸 것이다.

const FAKE_ECOS = "FAKE-ECOS-KEY-1234567";
const FAKE_FRED = "FAKE-FRED-KEY-7654321";
const KEY_ENV = { ECOS_API_KEY: FAKE_ECOS, FRED_API_KEY: FAKE_FRED };
const TODAY = "2026-10-28";
const def = (id: string): IndicatorDef => indicatorDef(id)!;

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

function dumpDb(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));
}

function issue(db: DatabaseSync, name: string, links: [string, string][] = []): number {
  const id = createIssue(db, { name, aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: `${name}의 요약이다.` });
  for (const [date, key] of links) {
    const s = storiesOfDate(db, date).find((x) => x.key === key);
    assert.ok(s, `${date} ${key}`);
    linkStory(db, s.id, id, true);
  }
  return id;
}

function merge(db: DatabaseSync, survivor: number, absorbed: number): number {
  return applyMerges(db, [{ survivor, absorbed, reason: "같은 일", summary: "합친 가짜 요약이다." }], "2026-10-28")[0]!;
}

/** node:sqlite의 행은 프로토타입이 없어 보통 객체로 바꿔 비교한다 */
function values(db: DatabaseSync, id: string): { date: string; value: number }[] {
  return indicatorValues(db, id).map((v) => ({ ...v }));
}

function state(db: DatabaseSync, id: number): { judged: boolean; indicators: string[] } {
  return { judged: isJudged(db, id), indicators: issueIndicators(db, id) };
}

// ---- 가짜 출처 ----

type Failure = "auth" | "timeout" | "limit-once" | "limit" | "network" | "format";

interface FakeSource {
  http: HttpJson;
  calls: string[];
}

/** 지표마다 [날짜, 값 글자] 목록을 주면 ECOS·FRED 응답을 흉내 낸다. 요청한 범위 안의 행만 돌려준다 */
function fakeSource(rows: Record<string, [string, string][]>, fail: Record<string, Failure> = {}): FakeSource {
  const calls: string[] = [];
  const seen = new Map<string, number>();
  const http: HttpJson = async (url) => {
    calls.push(url);
    const u = new URL(url);
    let d: IndicatorDef | undefined;
    let from: string;
    let to: string;
    if (u.hostname === "ecos.bok.or.kr") {
      const p = u.pathname.split("/");
      // /api/StatisticSearch/{key}/json/kr/{start}/{end}/{table}/{cycle}/{from}/{to}/{item}
      d = INDICATORS.find((x) => x.source.kind === "ecos" && x.source.table === p[8] && x.source.item === p[12]);
      from = p[10]!;
      to = p[11]!;
    } else {
      d = INDICATORS.find((x) => x.source.kind === "fred" && x.source.series === u.searchParams.get("series_id"));
      from = u.searchParams.get("observation_start")!.replaceAll("-", "");
      to = u.searchParams.get("observation_end")!.replaceAll("-", "");
    }
    assert.ok(d, `모르는 요청: ${url}`);
    const ecos = d.source.kind === "ecos";
    const n = (seen.get(d.id) ?? 0) + 1;
    seen.set(d.id, n);
    const f = fail[d.id];
    if (f === "timeout") {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }
    if (f === "network") throw new TypeError(`fetch failed: ${url}`);
    if (f === "limit" || (f === "limit-once" && n === 1)) return ecos ? { status: 200, body: JSON.stringify({ RESULT: { CODE: "ERROR-602", MESSAGE: "과도한 OpenAPI호출로 이용이 제한되었습니다." } }) } : { status: 429, body: "{}" };
    if (f === "auth") {
      return ecos
        ? { status: 200, body: JSON.stringify({ RESULT: { CODE: "INFO-100", MESSAGE: "인증키가 유효하지 않습니다." } }) }
        : { status: 400, body: JSON.stringify({ error_code: 400, error_message: "Bad Request.  The value for variable api_key is not registered." }) };
    }
    if (f === "format") return { status: 200, body: "<html>점검 중</html>" };
    const key = (date: string) => date.replaceAll("-", "").slice(0, from.length);
    const inRange = (rows[d.id] ?? []).filter(([date]) => key(date) >= from && key(date) <= to);
    if (ecos) {
      if (inRange.length === 0) return { status: 200, body: JSON.stringify({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } }) };
      return { status: 200, body: JSON.stringify({ StatisticSearch: { list_total_count: inRange.length, row: inRange.map(([date, v]) => ({ TIME: date.replaceAll("-", ""), DATA_VALUE: v })) } }) };
    }
    const fredDate = (date: string) => (date.length === 7 ? `${date}-01` : date);
    return { status: 200, body: JSON.stringify({ observations: inRange.map(([date, v]) => ({ date: fredDate(date), value: v })) }) };
  };
  return { http, calls };
}

/** from부터 to까지의 평일(휴장일 흉내로 주말을 뺀다) */
function weekdays(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (w !== 0 && w !== 6) out.push(d);
  }
  return out;
}

function months(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  for (;;) {
    const s = `${y}-${String(m).padStart(2, "0")}`;
    if (s > to) return out;
    out.push(s);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
}

/** 12개 지표 모두의 가짜 행(최근 몇 주의 일별 값과 2020-10부터의 월별 지수) */
function allRows(): Record<string, [string, string][]> {
  const out: Record<string, [string, string][]> = {};
  INDICATORS.forEach((d, i) => {
    out[d.id] = d.freq === "day" ? weekdays("2026-10-01", TODAY).map((date, j) => [date, String(100 + i + j / 10)]) : months(MONTHLY_START, "2026-09").map((m, j) => [m, String(100 + j / 4)]);
  });
  return out;
}

const opts = (http: HttpJson, keys = { ECOS_API_KEY: FAKE_ECOS, FRED_API_KEY: FAKE_FRED }) => ({ http, keys, today: TODAY, retryGapMs: 0 });

describe("6단계 4.1 데이터와 저장", () => {
  test("4.1-1 정의가 12개이고 식별자가 겹치지 않으며, 백업하지 않는 것은 코스피·코스닥 둘이다", () => {
    assert.equal(INDICATORS.length, 12);
    assert.equal(new Set(INDICATORS.map((d) => d.id)).size, 12);
    assert.deepEqual(INDICATORS.filter((d) => !d.backup).map((d) => d.id).sort(), ["kosdaq", "kospi"]);
    for (const d of INDICATORS) assert.ok(d.credit.length > 0 && d.name.length > 0 && d.description.length > 0, d.id);
  });

  test("4.1-2 같은 응답을 두 번 적용해도 값이 하나씩이고, 바뀐 값은 바뀌며, 빈 값은 저장되지 않는다", async () => {
    const db = briefDb(["2026-10-27"]);
    const rows: [string, string][] = [
      ["2026-10-26", "4.10"],
      ["2026-10-27", "."],
      ["2026-10-28", "4.20"],
    ];
    const src = fakeSource({ us10y: rows });
    const r1 = await fetchIndicator(db, def("us10y"), opts(src.http));
    const r2 = await fetchIndicator(db, def("us10y"), opts(src.http));
    assert.ok(r1.status === "ok" && r1.added === 2 && r2.status === "ok" && r2.added === 0 && r2.changed === 0, JSON.stringify([r1, r2]));
    assert.deepEqual(values(db, "us10y"), [
      { date: "2026-10-26", value: 4.1 },
      { date: "2026-10-28", value: 4.2 },
    ]);
    rows[2] = ["2026-10-28", "4.25"];
    const r3 = await fetchIndicator(db, def("us10y"), opts(src.http));
    assert.ok(r3.status === "ok" && r3.changed === 1);
    assert.deepEqual(values(db, "us10y").at(-1), { date: "2026-10-28", value: 4.25 });
    db.close();
  });

  test("4.1-3 판단한 이슈는 판단함이고, 0개를 고른 이슈도 판단함이다", () => {
    const db = briefDb(["2026-10-27"]);
    const a = issue(db, "가짜 금리 결정");
    const b = issue(db, "가짜 연예 소식");
    assert.deepEqual(unjudgedIssues(db), [a, b]);
    applyJudgment(db, a, ["krbase", "kr3y"]);
    applyJudgment(db, b, []);
    assert.deepEqual(state(db, a), { judged: true, indicators: ["krbase", "kr3y"] });
    assert.deepEqual(state(db, b), { judged: true, indicators: [] });
    assert.deepEqual(unjudgedIssues(db), []);
    db.close();
  });

  for (const v of [4, 5]) {
    test(`4.1-4 버전 ${v} DB(브리프, 이슈, 대상, 용어${v >= 5 ? ", 일정" : ""}, 합치기 기록)를 새 코드로 열면 버전 8이 되고, 데이터가 남으며 모든 이슈가 지표 판단 대상이다`, () => {
      const file = path.join(tempDir(), "t.db");
      const old = openDb(file, MIGRATIONS.filter((m) => m.version <= v));
      assert.equal(schemaVersion(old), v);
      recordFirstCollectionDate(old, "2026-10-27");
      addBrief(old, "2026-10-27");
      const a = issue(old, "가짜 항구 파업", [["2026-10-27", "한국-1"]]);
      const b = issue(old, "가짜 항구 파업 장기화", [["2026-10-27", "한국-2"]]);
      const c = issue(old, "가짜 선거", [["2026-10-27", "세계-1"]]);
      merge(old, a, b);
      const story = storiesOfDate(old, "2026-10-27").find((x) => x.key === "한국-1")!;
      linkEntity(old, story.id, createEntity(old, { kind: "기관", name: "가짜 항만공사", aliases: [], description: "지어낸 기관이다.", describedOn: null, describedStory: null }));
      linkTerm(old, story.id, createTerm(old, { name: "가짜 하역료", aliases: [], description: "지어낸 용어다." }), null);
      if (v >= 5) createSchedule(old, { name: "가짜 항만 노사 협상", due: "2026-11-05", major: "경제" });
      const before = dumpDb(old);
      old.close();
      const db = openDb(file);
      assert.equal(schemaVersion(db), 9);
      const after = dumpDb(db);
      for (const [table, rows] of Object.entries(before)) assert.deepEqual(after[table], rows, table);
      for (const table of ["entities", "terms", "story_entities", "story_terms", ...(v >= 5 ? ["schedules"] : [])]) assert.equal(before[table]?.length, 1, table);
      assert.equal(getIssue(db, b)?.mergedInto, a);
      assert.equal(getIssue(db, c)?.name, "가짜 선거");
      assert.deepEqual(unjudgedIssues(db), [a, c], "흡수된 이슈는 빼고 모두 대상이다");
      db.close();
    });
  }
});

describe("6단계 4.2 지표 받기", () => {
  test("4.2-4 받는 범위: 값이 없으면 처음부터, 마지막 값이 어제·90일 전이면 그 60일 전부터 오늘까지, 월별은 늘 처음부터", () => {
    const db = briefDb(["2026-10-27"]);
    assert.deepEqual(fetchRange(db, def("usdkrw"), TODAY), { from: DAILY_START, to: TODAY });
    upsertValues(db, "usdkrw", [{ date: "2026-10-27", value: 1400 }]);
    assert.deepEqual(fetchRange(db, def("usdkrw"), TODAY), { from: "2026-08-28", to: TODAY });
    upsertValues(db, "wti", [{ date: "2026-07-30", value: 70 }]);
    assert.deepEqual(fetchRange(db, def("wti"), TODAY), { from: "2026-05-31", to: TODAY }, "90일 전 값이면 빠진 날짜가 범위에 든다");
    upsertValues(db, "krcpi", [{ date: "2026-09", value: 118 }]);
    assert.deepEqual(fetchRange(db, def("krcpi"), TODAY), { from: MONTHLY_START, to: "2026-10" });
    db.close();
  });

  test("4.2-4 월별은 매번 처음부터 받아 통째로 바꾸고(기준년이 바뀐 응답), 빈 응답·앞부분이 빠진 응답은 실패로 두고 저장 값을 그대로 둔다", async () => {
    const db = briefDb(["2026-10-27"]);
    const ms = months(MONTHLY_START, "2026-09");
    const old = ms.map((m, j): [string, string] => [m, String(100 + j)]);
    const r1 = await fetchIndicator(db, def("krcpi"), opts(fakeSource({ krcpi: old }).http));
    assert.ok(r1.status === "ok" && r1.added === ms.length);
    // 기준년이 바뀐 응답(모든 값이 다르다). 출처가 뺀 달(2023-05)은 저장에서도 빠진다
    const rebased = ms.map((m, j): [string, string] => [m, String(80 + j / 2)]).filter(([m]) => m !== "2023-05");
    const src = fakeSource({ krcpi: rebased });
    const r2 = await fetchIndicator(db, def("krcpi"), opts(src.http));
    assert.ok(r2.status === "ok", JSON.stringify(r2));
    assert.match(src.calls[0]!, /\/901Y009\/M\/202010\/202610\/0$/, "처음 달부터 이번 달까지 받는다");
    assert.deepEqual(values(db, "krcpi"), ms.map((m, j) => ({ date: m, value: 80 + j / 2 })).filter((v) => v.date !== "2023-05"), "저장 값이 모두 새 값이다");
    assert.ok(r2.status === "ok" && r2.removed === 1 && r2.changed === ms.length - 1);
    const files = buildSiteData(db);
    const list = JSON.parse(files.get("site-data/indicator-list.json")!) as IndicatorList;
    const cpi = list.indicators.find((c) => c.id === "krcpi")!;
    const last = 80 + (ms.length - 1) / 2;
    const yearAgo = 80 + (ms.length - 13) / 2;
    assert.equal(cpi.last?.value, Number(((last / yearAgo - 1) * 100).toFixed(2)), "상승률은 새 값으로만 계산한다");

    const before = values(db, "krcpi");
    const empty = await fetchIndicator(db, def("krcpi"), opts(fakeSource({ krcpi: [] }).http));
    assert.equal(empty.status, "failed");
    const cut = await fetchIndicator(db, def("krcpi"), opts(fakeSource({ krcpi: rebased.slice(12) }).http));
    assert.ok(cut.status === "failed" && /첫 달/.test(cut.reason), JSON.stringify(cut));
    assert.deepEqual(values(db, "krcpi"), before, "저장 값이 그대로다");
    db.close();
  });

  test("4.2-4 월별 응답에 받는 범위 밖의 달이 많아도, 범위 안의 행으로 판단해 앞부분이 빠진 응답이면 저장 값을 그대로 둔다", async () => {
    const db = briefDb(["2026-10-27"]);
    const ms = months(MONTHLY_START, "2026-09");
    await fetchIndicator(db, def("krcpi"), opts(fakeSource({ krcpi: ms.map((m, j): [string, string] => [m, String(100 + j)]) }).http));
    const before = values(db, "krcpi");
    // 범위 앞의 달 70개 + 범위 안의 달 2개. 범위 밖을 세면 행 수·첫 달 검사를 통과해 저장 값이 2개로 줄어든다
    const outside = months("2010-01", "2015-10").map((m): [string, string] => [m, "1"]);
    const row = ([m, v]: [string, string]) => ({ TIME: m.replace("-", ""), DATA_VALUE: v });
    const all = [...outside, ["2026-08", "200"], ["2026-09", "201"]] as [string, string][];
    const http: HttpJson = async () => ({ status: 200, body: JSON.stringify({ StatisticSearch: { list_total_count: all.length, row: all.map(row) } }) });
    const r = await fetchIndicator(db, def("krcpi"), opts(http));
    assert.ok(r.status === "failed" && /첫 달/.test(r.reason), JSON.stringify(r));
    assert.deepEqual(values(db, "krcpi"), before, "저장 값이 그대로다");
    db.close();
  });

  test("실패 이유에 주소 인코딩된 키가 들어가도 가린다", async () => {
    const db = briefDb(["2026-10-27"]);
    const keys = { ECOS_API_KEY: "ECOS+KEY/0000=", FRED_API_KEY: "FRED+KEY/0000=" };
    for (const id of ["usdkrw", "wti"]) {
      const r = await fetchIndicator(db, def(id), opts(fakeSource({}, { [id]: "network" }).http, keys));
      assert.ok(r.status === "failed", JSON.stringify(r));
      for (const k of Object.values(keys)) {
        assert.ok(!r.reason.includes(k) && !r.reason.includes(encodeURIComponent(k)), r.reason);
      }
      assert.match(r.reason, /\*\*\*/);
    }
    db.close();
  });

  test("4.2-2 가짜 출처 응답(정상, 빈 값 섞임, 한도 오류, 시간 초과, 인증 오류)에 대해 저장 결과와 실패 기록이 맞다", async () => {
    const db = briefDb(["2026-10-27"]);
    const rows = { usdkrw: [["2026-10-27", "1,401.5"], ["2026-10-28", ""]] as [string, string][], wti: [["2026-10-27", "."], ["2026-10-28", "71.2"]] as [string, string][] };
    const ok = await fetchIndicator(db, def("usdkrw"), opts(fakeSource(rows).http));
    assert.ok(ok.status === "ok" && ok.received === 1 && ok.last === "2026-10-27", JSON.stringify(ok));
    assert.deepEqual(values(db, "usdkrw"), [{ date: "2026-10-27", value: 1401.5 }]);
    const fredOk = await fetchIndicator(db, def("wti"), opts(fakeSource(rows).http));
    assert.ok(fredOk.status === "ok" && fredOk.received === 1);

    const once = fakeSource(rows, { usdkrw: "limit-once", wti: "limit-once" });
    for (const id of ["usdkrw", "wti"]) {
      const r = await fetchIndicator(db, def(id), opts(once.http));
      assert.equal(r.status, "ok", `${id}: 한도 오류 한 번은 다시 시도해 받는다`);
    }
    const always = await fetchIndicator(db, def("usdkrw"), opts(fakeSource(rows, { usdkrw: "limit" }).http));
    assert.ok(always.status === "failed" && /ERROR-602/.test(always.reason) && !always.keyProblem);
    const timeout = await fetchIndicator(db, def("wti"), opts(fakeSource(rows, { wti: "timeout" }).http));
    assert.ok(timeout.status === "failed" && timeout.reason === "시간 초과");
    for (const id of ["usdkrw", "wti"]) {
      const r = await fetchIndicator(db, def(id), opts(fakeSource(rows, { [id]: "auth" }).http));
      assert.ok(r.status === "failed" && r.keyProblem && r.reason.startsWith("키 확인 필요"), `${id}: ${JSON.stringify(r)}`);
    }
    const format = await fetchIndicator(db, def("usdkrw"), opts(fakeSource(rows, { usdkrw: "format" }).http));
    assert.ok(format.status === "failed" && /JSON이 아니다/.test(format.reason));
    const network = await fetchIndicator(db, def("wti"), opts(fakeSource(rows, { wti: "network" }).http));
    assert.ok(network.status === "failed" && !network.reason.includes(FAKE_FRED) && network.reason.includes("***"), network.status === "failed" ? network.reason : "");
    const noKey = await fetchIndicator(db, def("usdkrw"), opts(fakeSource(rows).http, { ECOS_API_KEY: null, FRED_API_KEY: FAKE_FRED } as never));
    assert.ok(noKey.status === "failed" && noKey.keyProblem && /키 확인 필요: ECOS_API_KEY가 없다/.test(noKey.reason));
    assert.deepEqual(values(db, "usdkrw").map((v) => v.date), ["2026-10-27"], "실패한 받기는 저장 값을 바꾸지 않는다");
    db.close();
  });

  test("4.2-2 출처는 https 공식 API이고, ECOS는 한 요청 100,000행씩 나눠 받는다", async () => {
    const db = briefDb(["2026-10-27"]);
    const src = fakeSource(allRows());
    for (const d of INDICATORS) await fetchIndicator(db, d, opts(src.http));
    assert.equal(src.calls.length, 12);
    for (const url of src.calls) assert.match(url, /^https:\/\/(ecos\.bok\.or\.kr\/api\/StatisticSearch\/|api\.stlouisfed\.org\/fred\/series\/observations\?)/);
    for (const url of src.calls.filter((u) => u.includes("ecos"))) assert.match(url, /\/json\/kr\/1\/100000\//);
    db.close();
  });

  test("키: 환경 변수가 있으면 그것을, 없으면 .env.local을 읽고, 짧거나 빈 값은 없는 것으로 본다", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, ".env.local"), `ECOS_API_KEY="FILE-ECOS-KEY-000"\nFRED_API_KEY=short\n`);
    assert.deepEqual(readKeys({}, dir), { ECOS_API_KEY: "FILE-ECOS-KEY-000", FRED_API_KEY: null, YOUTUBE_API_KEY: null, GEMINI_API_KEY: null });
    assert.deepEqual(readKeys({ ECOS_API_KEY: "ENV-ECOS-KEY-000", FRED_API_KEY: "" }, dir), { ECOS_API_KEY: "ENV-ECOS-KEY-000", FRED_API_KEY: null, YOUTUBE_API_KEY: null, GEMINI_API_KEY: null });
    fs.writeFileSync(path.join(dir, ".env.local"), `ECOS_API_KEY=FILE-ECOS-KEY-000 # 한국은행\nFRED_API_KEY="FILE-FRED#KEY-000"  # FRED\n`);
    assert.deepEqual(readKeys({}, dir), { ECOS_API_KEY: "FILE-ECOS-KEY-000", FRED_API_KEY: "FILE-FRED#KEY-000", YOUTUBE_API_KEY: null, GEMINI_API_KEY: null }, "줄 끝 주석을 값에 넣지 않는다");
  });
});

describe("6단계 4.3 이슈 지표 판단", () => {
  function judgeDb() {
    const db = briefDb(["2026-10-26", "2026-10-27"]);
    const ids = {
      rate: issue(db, "가짜 금리 결정", [["2026-10-26", "한국-1"], ["2026-10-27", "한국-1"]]),
      oil: issue(db, "가짜 산유국 분쟁", [["2026-10-27", "세계-1"]]),
      idol: issue(db, "가짜 연예 소식", [["2026-10-27", "한국-2"]]),
      dup: issue(db, "가짜 금리 결정 후속", [["2026-10-26", "한국-2"]]),
      done: issue(db, "가짜 이미 판단한 이슈", [["2026-10-26", "세계-1"]]),
    };
    merge(db, ids.rate, ids.dup);
    applyJudgment(db, ids.done, []);
    return { db, ids };
  }

  test("4.3-2 판단 안 한 이슈만 후보 목록에 들고(판단함·흡수된 것은 빠짐), 나눈 파일의 이슈를 합치면 대상 전체다", () => {
    const { db, ids } = judgeDb();
    assert.deepEqual(unjudgedIssues(db), [ids.rate, ids.oil, ids.idol]);
    const batches = judgeBatches(db, 2);
    assert.deepEqual(batches, [[ids.rate, ids.oil], [ids.idol]]);
    assert.deepEqual(batches.flat(), unjudgedIssues(db));
    const md = renderJudgeCandidates(db, 1, 2, batches[0]!, "/x/indicators.judge-1.json");
    for (const d of INDICATORS) assert.ok(md.includes(`\`${d.id}\` ${d.name}`), d.id);
    assert.match(md, /### 이슈 1: 가짜 금리 결정\n- 분류: 경제 \/ 금융·증시\n- 지금까지: 합친 가짜 요약이다\.\n- 최근 뉴스:\n {2}- 2026-10-27 /);
    assert.ok(!md.includes("가짜 연예 소식") && !md.includes("가짜 이미 판단한"), "다른 파일·판단한 이슈는 없다");
    db.close();
  });

  test("4.3-3 거부 경우마다 거부되고 DB가 바뀌지 않으며, 맞는 파일(0개, 1개, 3개 섞임)이 적용된다", () => {
    const { db, ids } = judgeDb();
    const expected = [ids.rate, ids.oil, ids.idol];
    const good = { issues: [{ id: ids.rate, indicators: ["krbase", "kr3y", "usdkrw"] }, { id: ids.oil, indicators: ["wti"] }, { id: ids.idol, indicators: [] }] };
    const bad: [string, unknown, RegExp][] = [
      ["빠진 이슈", { issues: good.issues.slice(0, 2) }, /이슈 3이\(가\) 빠졌다/],
      ["없는 이슈", { issues: [...good.issues, { id: 999, indicators: [] }] }, /이슈 999은\(는\) 이 후보 목록에 없다/],
      ["목록에 없는 이슈(판단함)", { issues: [...good.issues, { id: ids.done, indicators: [] }] }, /이 후보 목록에 없다/],
      ["없는 지표", { issues: [{ ...good.issues[0], indicators: ["sp500"] }, ...good.issues.slice(1)] }, /없는 지표 식별자다: "sp500"/],
      ["4개", { issues: [{ ...good.issues[0], indicators: ["krbase", "kr3y", "usdkrw", "kospi"] }, ...good.issues.slice(1)] }, /4개 \(0~3개여야 한다\)/],
      ["같은 지표 두 번", { issues: [{ ...good.issues[0], indicators: ["wti", "wti"] }, ...good.issues.slice(1)] }, /같은 지표 wti가 두 번/],
      ["같은 이슈 두 번", { issues: [...good.issues, good.issues[2]] }, /두 번 있다/],
      ["형식", { issue: [] }, /issues/],
    ];
    const snapshot = () => expected.map((id) => state(db, id));
    const before = snapshot();
    for (const [name, data, why] of bad) {
      const r = checkJudgeFile(data, expected);
      assert.ok(!r.ok && r.violations.some((v) => why.test(`${v.where}: ${v.why}`)), `${name}: ${JSON.stringify(r)}`);
      assert.deepEqual(snapshot(), before, `${name}: DB가 바뀌지 않는다`);
    }
    const r = checkJudgeFile(good, expected);
    assert.ok(r.ok);
    assert.equal(applyJudgeFile(db, r.entries), 2);
    assert.deepEqual(snapshot(), [
      { judged: true, indicators: ["usdkrw", "krbase", "kr3y"] },
      { judged: true, indicators: ["wti"] },
      { judged: true, indicators: [] },
    ]);
    db.close();
  });

  test("4.3-6 합치면 지표가 합쳐지고, 3개를 넘으면 판단 안 함이 되며, 되돌리면 합치기 전과 같다. 나중 합치기 지표는 남고, 옛 합치기를 되돌리면 둘 다 판단 안 함이다", () => {
    const db = briefDb(["2026-10-26", "2026-10-27"]);
    const s = issue(db, "가짜 남는 이슈", [["2026-10-26", "한국-1"]]);
    const a = issue(db, "가짜 흡수 이슈", [["2026-10-26", "한국-2"]]);
    const b = issue(db, "가짜 나중 흡수 이슈", [["2026-10-27", "한국-1"]]);
    const u = issue(db, "가짜 판단 안 한 이슈", [["2026-10-27", "한국-2"]]);
    applyJudgment(db, s, ["usdkrw", "kospi"]);
    applyJudgment(db, a, ["kospi", "krbase"]);
    applyJudgment(db, b, ["wti"]);
    const m1 = merge(db, s, a);
    assert.deepEqual(state(db, s), { judged: true, indicators: ["usdkrw", "kospi", "krbase"] }, "같은 지표는 하나로, 3개면 판단함 그대로");
    assert.deepEqual(state(db, a), { judged: false, indicators: [] });
    assert.ok(!unjudgedIssues(db).includes(a), "흡수된 이슈는 판단 대상이 아니다");
    const m2 = merge(db, s, b);
    assert.deepEqual(state(db, s), { judged: false, indicators: ["usdkrw", "kospi", "krbase", "wti"] }, "4개면 연결을 두고 판단 안 함");
    applyJudgment(db, s, ["usdkrw", "wti"]);

    assert.ok(unmerge(db, m1, "2026-10-28").ok);
    assert.deepEqual(state(db, a), { judged: true, indicators: ["kospi", "krbase"] }, "흡수됐던 이슈가 합치기 전과 같다");
    assert.deepEqual(state(db, s), { judged: true, indicators: ["usdkrw", "kospi", "wti"] }, "다시 판단한 뒤라도 합치기 전 상태에 나중 합치기 지표(wti)를 남긴다");
    assert.ok(unmerge(db, m2, "2026-10-28").ok);
    assert.deepEqual(state(db, s), { judged: true, indicators: ["usdkrw", "kospi"] }, "둘 다 되돌리면 처음과 같다");
    assert.deepEqual(state(db, b), { judged: true, indicators: ["wti"] });

    // 나중 합치기로 들어온 지표 때문에 되돌린 결과가 3개를 넘는 경우
    applyJudgment(db, a, ["krbase", "kr3y"]);
    applyJudgment(db, b, ["wti", "brent"]);
    const m3 = merge(db, s, a);
    const m4 = merge(db, s, b);
    applyJudgment(db, s, ["usdkrw", "kospi", "krbase"]);
    void m4;
    assert.ok(unmerge(db, m3, "2026-10-28").ok);
    assert.deepEqual(state(db, s), { judged: false, indicators: ["usdkrw", "kospi", "wti", "brent"] }, "나중 합치기 지표가 남아 3개를 넘으면 판단 안 함");

    // 둘 중 하나가 판단 안 함이면 남는 이슈도 판단 안 함
    const t = issue(db, "가짜 또 남는 이슈");
    applyJudgment(db, t, ["usfed"]);
    merge(db, t, u);
    assert.deepEqual(state(db, t), { judged: false, indicators: ["usfed"] });

    // 지표 기록이 없는 옛 합치기
    const x = issue(db, "가짜 옛 남는 이슈");
    const y = issue(db, "가짜 옛 흡수 이슈");
    const m5 = merge(db, x, y);
    applyJudgment(db, x, ["us10y"]);
    applyJudgment(db, y, []);
    db.prepare("DELETE FROM indicator_merges WHERE merge_id = ?").run(m5);
    assert.ok(unmerge(db, m5, "2026-10-28").ok);
    assert.deepEqual([isJudged(db, x), isJudged(db, y)], [false, false]);
    db.close();
  });
});

describe("6단계 4.4 백업과 복원", () => {
  function backupDb() {
    const db = briefDb(["2026-10-27"]);
    const a = issue(db, "가짜 금리 결정", [["2026-10-27", "한국-1"]]);
    const b = issue(db, "가짜 증시 소식", [["2026-10-27", "한국-2"]]);
    upsertValues(db, "usdkrw", [{ date: "2026-10-27", value: 1401.25 }]);
    upsertValues(db, "kospi", [{ date: "2026-10-27", value: 2634.77 }]);
    upsertValues(db, "kosdaq", [{ date: "2026-10-27", value: 777.31 }]);
    upsertValues(db, "krcpi", [{ date: "2026-09", value: 118.4 }]);
    applyJudgment(db, a, ["krbase"]);
    applyJudgment(db, b, ["kospi", "kosdaq"]);
    return { db, a, b };
  }

  test("왕복하면 같은 데이터이되 코스피·코스닥 값만 없고, 백업 어디에도 그 값이 없으며, 지표 파일에 출처 문구가 있고, 복원 뒤 코스피·코스닥은 처음부터 받는다", () => {
    const { db, a, b } = backupDb();
    const files = buildBackup(db);
    assert.ok(files.has("indicators.json"));
    for (const [name, text] of files) for (const v of ["2634.77", "777.31"]) assert.ok(!text.includes(v), `${name}에 ${v}`);
    const ind = JSON.parse(files.get("indicators.json")!) as { indicators: { id: string; credit: string }[] };
    assert.deepEqual(ind.indicators.map((x) => x.id).sort(), INDICATORS.filter((d) => d.backup).map((d) => d.id).sort());
    for (const x of ind.indicators) assert.equal(x.credit, def(x.id).credit);
    const out = path.join(tempDir(), "r.db");
    restoreBackup(files, out);
    const r = openDb(out);
    for (const id of ["usdkrw", "krcpi"]) assert.deepEqual(values(r, id), values(db, id), id);
    assert.deepEqual([values(r, "kospi"), values(r, "kosdaq")], [[], []]);
    assert.deepEqual([state(r, a), state(r, b)], [state(db, a), state(db, b)], "연결과 판단 여부(코스피·코스닥 연결 포함)가 같다");
    assert.deepEqual(fetchRange(r, def("kospi"), TODAY).from, DAILY_START);
    r.close();
    db.close();
  });

  test("형식 4 백업을 복원하면 모든 이슈가 지표 판단 대상이고 지표 값이 없다", () => {
    const { db, a, b } = backupDb();
    const files = buildBackup(db);
    files.delete("indicators.json");
    const v4 = new Map([...files].map(([k, v]) => [k, JSON.stringify({ ...JSON.parse(v), formatVersion: 4 })]));
    const out = path.join(tempDir(), "r.db");
    restoreBackup(v4, out);
    const r = openDb(out);
    assert.deepEqual(unjudgedIssues(r), [a, b]);
    for (const d of INDICATORS) assert.deepEqual(values(r, d.id), []);
    r.close();
    db.close();
  });

  test("4.4-2 결과물에 지표 백업 파일이나 판단·후보 목록 파일 이름이 있으면 결과물 검사에 걸리고, 지표 사이트 데이터 이름은 걸리지 않는다", () => {
    const out = tempDir();
    for (const f of ["indicators.json", "deep/indicators.json", "indicators.candidates-1.md", "indicators.judge-12.json", "site-data/indicator-list.json", "site-data/indicator-usdkrw.json"]) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.writeFileSync(path.join(out, f), "{}");
    }
    assert.deepEqual(checkOutput(out, null).findings.map((x) => `${x.where} ${x.kind}`).sort(), [
      "deep/indicators.json 백업 파일 이름",
      "indicators.candidates-1.md 실행 기록·작업 파일",
      "indicators.json 백업 파일 이름",
      "indicators.judge-12.json 실행 기록·작업 파일",
    ]);
  });
});

// ---- 명령 흐름(데이터 폴더 지정) ----

function cli(repo: string, argv: string[], env: NodeJS.ProcessEnv): { code: number; text: string } {
  const ctx = makeCtx(repo, env);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

async function fetchCli(repo: string, runFile: string, env: NodeJS.ProcessEnv, http: HttpJson): Promise<{ code: number; text: string }> {
  const ctx = { ...makeCtx(repo, env), indicatorHttp: http, indicatorGapMs: 0 };
  const code = await mainAsync(["indicator-fetch", "--run", runFile], ctx);
  return { code, text: ctx.text() };
}

function flowDir(env: NodeJS.ProcessEnv = KEY_ENV) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = briefDb(["2026-10-26", "2026-10-27"], path.join(dataDir, "tidwyn.db"));
  const ids = [issue(db, "가짜 금리 결정", [["2026-10-26", "한국-1"]]), issue(db, "가짜 산유국 분쟁", [["2026-10-26", "세계-1"]]), issue(db, "가짜 연예 소식", [["2026-10-26", "한국-2"]])];
  db.close();
  const fullEnv = { ...env, TIDWYN_DATA_DIR: dataDir };
  const start = cli(repo, ["start"], fullEnv);
  assert.equal(start.code, 0, start.text);
  const runFile = /실행 기록: (.+)/.exec(start.text)![1]!;
  return { repo, dataDir, env: fullEnv, runFile, ids, start: start.text };
}

/** 지표 단계 뒤의 백업과 빌드(사이트 빌더는 가짜). 지표 판단·받기가 실패해도 둘 다 끝까지 돈다 */
function backupAndSite(f: { repo: string; env: NodeJS.ProcessEnv; runFile: string }): string {
  const b = cli(f.repo, ["backup", "--run", f.runFile], f.env);
  assert.equal(b.code, 0, b.text);
  assert.match(b.text, /백업: /);
  const builder = ({ outDir }: { outDir: string }) => {
    fs.mkdirSync(outDir, { recursive: true });
    writeFakePublicFiles(outDir);
    return { ok: true as const };
  };
  const ctx = { ...makeCtx(f.repo, f.env), buildSite: builder };
  assert.equal(main(["site", "--run", f.runFile], ctx), 0, ctx.text());
  assert.match(ctx.text(), /사이트 빌드: /);
  return `${b.text}\n${ctx.text()}`;
}

function allFilesText(dir: string): string {
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => fs.statSync(path.join(dir, f)).isFile() && !f.endsWith(".db"))
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n");
}

describe("6단계 4.5 start 출력과 요약, 4.2-3·4.3-5 실패 흐름, 4.8-1 키가 새지 않음", () => {
  test("4.5-1 start에 판단 안 한 이슈 수와 키 있음/없음 줄이 나오고, 키 값은 출력에 없다", () => {
    const f = flowDir();
    assert.match(f.start, /- 지표 판단 안 한 이슈: 3개/);
    assert.match(f.start, /- 키: ECOS 있음, FRED 있음/);
    assert.ok(!f.start.includes(FAKE_ECOS) && !f.start.includes(FAKE_FRED));
    const none = flowDir({});
    assert.match(none.start, /- 키: ECOS 없음, FRED 없음/);
    const fileKeys = tempRepo();
    fs.writeFileSync(path.join(fileKeys, ".env.local"), `FRED_API_KEY=${FAKE_FRED}\n`);
    const dataDir = tempDir();
    briefDb(["2026-10-27"], path.join(dataDir, "tidwyn.db")).close();
    const s = cli(fileKeys, ["start"], { TIDWYN_DATA_DIR: dataDir });
    assert.match(s.text, /- 키: ECOS 없음, FRED 있음/, ".env.local을 메인 작업 폴더에서 읽는다");
  });

  test("판단·받기 흐름: 실패한 판단 파일의 이슈는 다음 실행 대상에 다시 나오고, 한 지표만 실패해도 나머지가 저장되며, 요약에 모든 줄이 나오고 키 값은 어디에도 없다", async () => {
    const f = flowDir();
    const list = cli(f.repo, ["indicator-list", "--run", f.runFile], f.env);
    assert.equal(list.code, 0, list.text);
    assert.match(list.text, /지표 판단: 이슈 3개, 파일 1개/);
    const judge = judgeWorkFile(f.dataDir, 1, "judge.json");
    fs.writeFileSync(judge, JSON.stringify({ issues: [{ id: f.ids[0], indicators: ["krbase", "nope"] }] }));
    const check = cli(f.repo, ["indicator-check", "--run", f.runFile, "--file", "1"], f.env);
    assert.equal(check.code, 1);
    assert.match(check.text, /위반 3개/);
    const apply = cli(f.repo, ["indicator-apply", "--run", f.runFile, "--file", "1"], f.env);
    assert.equal(apply.code, 1, apply.text);

    const rows = allRows();
    const fetched = await fetchCli(f.repo, f.runFile, f.env, fakeSource(rows, { brent: "network", wti: "auth", kospi: "network", kr3y: "auth" }).http);
    assert.equal(fetched.code, 0, "지표 하나가 실패해도 명령은 실패로 끝나지 않는다");
    assert.match(fetched.text, /원\/달러 환율: 받은 값 \d+개\(새 값 \d+, 바뀐 값 0\), 저장 \d+개, 마지막 2026-10-28/);
    assert.match(fetched.text, /브렌트유: 실패\(fetch failed: https:\/\/api\.stlouisfed\.org\/fred\/series\/observations\?series_id=DCOILBRENTEU&api_key=\*\*\*/);
    assert.match(fetched.text, /서부텍사스유|WTI/);
    assert.match(fetched.text, /: 실패\(키 확인 필요: FRED HTTP 400/);
    assert.match(fetched.text, /코스피: 실패\(fetch failed: https:\/\/ecos\.bok\.or\.kr\/api\/StatisticSearch\/\*\*\*\//);
    assert.match(fetched.text, /: 실패\(키 확인 필요: ECOS INFO-100/);
    const after = backupAndSite(f);

    const summary = cli(f.repo, ["summary", "--run", f.runFile], f.env);
    assert.equal(summary.code, 0, summary.text);
    for (const line of [
      /- 지표 판단: 이슈 0개 판단, 지표를 고른 이슈 0개/,
      /- 파일 1 실패\(이슈 3개는 다음 실행이 다시 판단한다\): 판단 파일이 검사를 통과하지 못했다/,
      /- issues\[0\] indicators\[1\]: 없는 지표 식별자다: "nope"/,
      /- 아직 지표 판단 안 한 이슈: 3개/,
      /- 지표 받기:/,
      /코스피: 실패/,
      /브렌트유: 실패/,
      /- 백업: /,
      /- 사이트 빌드: /,
    ])
      assert.match(summary.text, line);
    const db = openDb(path.join(f.dataDir, "tidwyn.db"));
    assert.deepEqual(unjudgedIssues(db), f.ids, "다음 실행이 다시 판단한다");
    assert.equal(indicatorValues(db, "brent").length, 0);
    assert.equal(indicatorValues(db, "usdkrw").length, rows.usdkrw!.length);
    assert.equal(fetchRange(db, def("brent"), TODAY).from, DAILY_START, "다음 실행의 받는 범위에 실패한 지표의 빠진 날짜가 든다");
    db.close();
    for (const text of [list.text, check.text, apply.text, fetched.text, after, summary.text, allFilesText(f.dataDir)]) {
      assert.ok(!text.includes(FAKE_ECOS) && !text.includes(FAKE_FRED), "키 값이 출력·실행 기록·작업 파일에 없다");
    }

    // 다시 판단: 맞는 파일은 적용되고 요약 수가 바뀐다
    fs.writeFileSync(judge, JSON.stringify({ issues: [{ id: f.ids[0], indicators: ["krbase", "kr3y"] }, { id: f.ids[1], indicators: ["wti"] }, { id: f.ids[2], indicators: [] }] }));
    const ok = cli(f.repo, ["indicator-apply", "--run", f.runFile, "--file", "1"], f.env);
    assert.equal(ok.code, 0, ok.text);
    const s2 = cli(f.repo, ["summary", "--run", f.runFile], f.env).text;
    assert.match(s2, /- 지표 판단: 이슈 3개 판단, 지표를 고른 이슈 2개/);
    assert.match(s2, /- 아직 지표 판단 안 한 이슈: 0개/);
  });

  test("indicator-list를 다시 돌리면 앞 목록의 실패 결과가 새 파일에 붙지 않는다", () => {
    const f = flowDir();
    assert.equal(cli(f.repo, ["indicator-list", "--run", f.runFile], f.env).code, 0);
    fs.writeFileSync(judgeWorkFile(f.dataDir, 1, "judge.json"), JSON.stringify({ issues: [] }));
    assert.equal(cli(f.repo, ["indicator-apply", "--run", f.runFile, "--file", "1"], f.env).code, 1);
    const again = cli(f.repo, ["indicator-list", "--run", f.runFile], f.env);
    assert.equal(again.code, 0, again.text);
    const s = cli(f.repo, ["summary", "--run", f.runFile], f.env).text;
    assert.ok(!/파일 1 실패/.test(s), s);
    assert.match(s, /- 파일 1: 적용하지 않았다\(이슈 3개는 다음 실행이 다시 판단한다\)/);
  });

  test("indicator-list를 다시 돌리면 적용한 파일은 남고, 새 파일은 그 뒤 번호이며 후보 목록 제목도 그 번호다", () => {
    const f = flowDir();
    assert.equal(cli(f.repo, ["indicator-list", "--run", f.runFile], f.env).code, 0);
    fs.writeFileSync(judgeWorkFile(f.dataDir, 1, "judge.json"), JSON.stringify({ issues: f.ids.map((id) => ({ id, indicators: [] })) }));
    assert.equal(cli(f.repo, ["indicator-apply", "--run", f.runFile, "--file", "1"], f.env).code, 0);
    const db = openDb(path.join(f.dataDir, "tidwyn.db"));
    db.prepare("DELETE FROM indicator_judged WHERE issue_id = ?").run(f.ids[0]!);
    db.close();
    const again = cli(f.repo, ["indicator-list", "--run", f.runFile], f.env);
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /- 파일 2: 이슈 1개/);
    assert.match(fs.readFileSync(judgeWorkFile(f.dataDir, 2, "candidates.md"), "utf8"), /^# 지표 판단 후보 2\/2/);
    assert.deepEqual(readRun(f.runFile).indicatorJudge!.files.map((x) => x.n), [1, 2]);
    assert.match(cli(f.repo, ["summary", "--run", f.runFile], f.env).text, /- 지표 판단: 이슈 3개 판단/);
  });

  test("4.2-3 키가 없으면 모든 지표가 키 확인 필요로 실패하고, 요약까지 끝까지 돈다", async () => {
    const f = flowDir({});
    const r = await fetchCli(f.repo, f.runFile, f.env, fakeSource(allRows()).http);
    assert.equal(r.code, 0);
    assert.equal(r.text.match(/: 실패\(키 확인 필요: (ECOS|FRED)_API_KEY가 없다\)/g)?.length, 12, r.text);
    const fetch = readRun(f.runFile).indicatorFetch!;
    assert.ok(Object.values(fetch.indicators).every((x) => x.status === "failed" && x.keyProblem));
    backupAndSite(f);
    const s = cli(f.repo, ["summary", "--run", f.runFile], f.env);
    assert.equal(s.code, 0);
    assert.match(s.text, /- 지표 받기:/);
    assert.match(s.text, /- 백업: /);
    assert.match(s.text, /- 사이트 빌드: /);
  });

  test("4.2-1 새 명령은 실제 데이터 폴더 모드에서 실행 조건(main·변경 없음)에 맞지 않으면 거부되고 DB가 바뀌지 않는다", async () => {
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    briefDb(["2026-10-27"], path.join(dataDir, "tidwyn.db")).close();
    gitIn(repo, "switch", "-q", "-c", "other");
    const runFile = path.join(dataDir, "runs", "r.json");
    const s: RunState = { startedAt: "2026-10-28T09:00:00+09:00", mode: "real", dataDir, dbPath: path.join(dataDir, "tidwyn.db"), backupRepo: null, noCommitReason: "x", targetDates: [], results: {}, backup: null };
    writeRun(runFile, s);
    const before = fs.readFileSync(s.dbPath);
    for (const argv of [["indicator-list", "--run", runFile], ["indicator-check", "--run", runFile, "--file", "1"], ["indicator-apply", "--run", runFile, "--file", "1"]]) {
      const x = cli(repo, argv, KEY_ENV);
      assert.equal(x.code, 3, x.text);
      assert.match(x.text, /실행 조건이 맞지 않아/);
    }
    const x = await fetchCli(repo, runFile, KEY_ENV, fakeSource(allRows()).http);
    assert.equal(x.code, 3, x.text);
    assert.deepEqual(fs.readFileSync(s.dbPath), before);
  });
});

describe("6단계 4.8-2 키 값 점검", () => {
  test("precheck와 결과물 검사가 키 값을 찾아 실패하고(값은 보이지 않는다), 키가 없으면 건너뛰었다고 보인다", () => {
    const repo = tempRepo();
    fs.writeFileSync(path.join(repo, "notes.txt"), `설정 값 ${FAKE_FRED} 끝\n`);
    gitIn(repo, "add", "notes.txt");
    const found = precheck({ repo, commits: [], trackedFiles: true, home: null, secrets: [FAKE_FRED] }).findings;
    assert.deepEqual(found.map((x) => `${x.where} ${x.kind}`), ["지금 파일 notes.txt 키 값이 들어 있음"]);
    assert.deepEqual(precheck({ repo, commits: [], trackedFiles: true, home: null, secrets: [] }).findings, []);
    gitIn(repo, "commit", "-qm", "add notes");
    const inHistory = precheck({ repo, commits: [gitIn(repo, "rev-parse", "HEAD").trim()], trackedFiles: false, home: null, secrets: [FAKE_FRED] }).findings;
    assert.ok(inHistory.some((x) => x.kind === "키 값이 들어 있음"), JSON.stringify(inHistory));

    const r = cli(repo, ["precheck"], KEY_ENV);
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /키 값이 들어 있음/);
    assert.ok(!r.text.includes(FAKE_FRED));
    const skipped = cli(repo, ["precheck"], {});
    assert.match(skipped.text, /출처 API 키가 환경 변수와 \.env\.local 어디에도 없어 키 값 검사는 건너뛰었다/);

    const out = tempDir();
    fs.mkdirSync(path.join(out, "assets"));
    fs.writeFileSync(path.join(out, "assets", "app.js"), `const k="${FAKE_ECOS}";`);
    const o = checkOutput(out, null, [FAKE_ECOS]).findings;
    assert.deepEqual(o.map((x) => `${x.where} ${x.kind}`), ["assets/app.js 키 값이 들어 있음"]);
    fs.writeFileSync(path.join(out, "assets", "app.js"), "const k=1;");
    assert.deepEqual(checkOutput(out, null, [FAKE_ECOS]).findings, [], "키가 없는 결과물은 통과한다");
  });

  test("키를 .env.local로만 줘도, 작업 브랜치에만 있는 커밋에서도 precheck가 찾는다", () => {
    const repo = tempRepo();
    fs.writeFileSync(path.join(repo, ".env.local"), `ECOS_API_KEY=${FAKE_ECOS}\n`);
    gitIn(repo, "switch", "-q", "-c", "work");
    fs.writeFileSync(path.join(repo, "leak.md"), `키: ${FAKE_ECOS}\n`);
    gitIn(repo, "add", "leak.md");
    gitIn(repo, "commit", "-qm", "leak");
    gitIn(repo, "switch", "-q", "main");
    assert.ok(!fs.existsSync(path.join(repo, "leak.md")));
    const r = cli(repo, ["precheck"], {});
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /leak\.md.*키 값이 들어 있음/);
    assert.match(r.text, /출처 API 키 값도 찾았다/);
    assert.ok(!r.text.includes(FAKE_ECOS));
  });
});

// ---- 사이트 데이터(4.6) ----

function siteDb() {
  const dates = weekdays("2026-10-12", "2026-10-27").slice(0, 10).concat(["2026-10-25"]).sort();
  const db = briefDb(dates);
  const main = issue(db, "가짜 환율 급등", [["2026-10-14", "한국-1"], ["2026-10-20", "한국-1"]]);
  const absorbed = issue(db, "가짜 원화 약세", [["2026-10-13", "한국-2"]]);
  const other = issue(db, "가짜 유가 소식", [["2026-10-22", "세계-1"]]);
  const none = issue(db, "가짜 연예 소식", [["2026-10-21", "한국-2"]]);
  applyJudgment(db, main, ["usdkrw", "brent"]);
  applyJudgment(db, absorbed, ["wti"]);
  applyJudgment(db, other, ["usdkrw", "krcpi"]);
  applyJudgment(db, none, []);
  merge(db, main, absorbed);
  // 일별: 주말·10월 16일(휴장일 흉내)은 값이 없다
  const fx = weekdays("2021-06-01", "2026-10-26").filter((d) => d !== "2026-10-16");
  upsertValues(db, "usdkrw", fx.map((date, i) => ({ date, value: 1300 + (i % 50) })));
  upsertValues(db, "wti", fx.map((date) => ({ date, value: 77.123 })));
  // 월별: 2025-03 지수가 빠져 2025-03(1년 전 없음)과 2026-03 상승률이 빈다
  const cpi = months("2020-10", "2026-09").filter((m) => m !== "2025-03");
  upsertValues(db, "krcpi", cpi.map((date, i) => ({ date, value: 100 + i })));
  return { db, dates, ids: { main, absorbed, other, none }, fx, cpi };
}

const DEFS_WTI_OFF = INDICATORS.map((d) => (d.id === "wti" ? { ...d, public: false } : d));

function parse<T>(files: Map<string, string>, name: string): T {
  const text = files.get(`site-data/${name}`);
  assert.ok(text !== undefined, `site-data/${name}이 없다`);
  return JSON.parse(text) as T;
}

function issueDetail(files: Map<string, string>, id: number): IssueDetail {
  for (const [name, text] of files) {
    if (!/site-data\/issue-\d+\.json$/.test(name)) continue;
    const d = (JSON.parse(text) as IssueChunk).issues[String(id)];
    if (d) return d;
  }
  assert.fail(`이슈 ${id} 상세가 없다`);
}

function dayList(files: Map<string, string>, date: string): DayList {
  const day = parse<MonthList>(files, `list-${date.slice(0, 7)}.json`).days.find((d) => d.date === date);
  assert.ok(day, date);
  return day;
}

describe("6단계 4.6 사이트 데이터", () => {
  test("4.6-1 지표 목록·5년 값·브리프 날짜별 기준값·이슈의 지표와 그래프 기간이 나오고, 물가 상승률 계산이 맞으며, 공개 끈 지표는 어디에도 없다", () => {
    const { db, dates, ids, fx, cpi } = siteDb();
    const files = buildSiteData(db, DEFS_WTI_OFF);
    const list = parse<IndicatorList>(files, "indicator-list.json");
    assert.equal(list.asOf, "2026-10-26");
    assert.deepEqual(list.indicators.map((c) => c.id), INDICATORS.filter((d) => d.id !== "wti").map((d) => d.id), "정의 순서, 공개 지표만");
    const fxCard = list.indicators.find((c) => c.id === "usdkrw")!;
    const fxVal = (d: string) => 1300 + (fx.indexOf(d) % 50);
    assert.deepEqual(fxCard.last, { date: "2026-10-26", value: fxVal("2026-10-26"), change: fxVal("2026-10-26") - fxVal("2026-10-23") });
    assert.equal(fxCard.spark[0]![0] > "2025-10-26", true, "작은 그래프는 최근 1년");
    assert.equal(fxCard.spark.at(-1)![0], "2026-10-26");
    assert.deepEqual(fxCard.issues, [{ id: ids.other, name: "가짜 유가 소식" }, { id: ids.main, name: "가짜 환율 급등" }], "최근 업데이트 순, 흡수된 이슈는 남는 이슈로");
    assert.equal(fxCard.credit, def("usdkrw").credit);
    assert.equal(fxCard.name, "원/달러 환율");
    assert.equal(fxCard.group, "한국");

    const series = parse<IndicatorSeries>(files, "indicator-usdkrw.json");
    assert.equal(series.points[0]![0] > "2021-10-26", true, "5년보다 앞의 값은 넣지 않는다");
    assert.ok(series.points[0]![0] <= "2021-11-01");
    assert.equal(series.points.at(-1)![0], "2026-10-26");
    assert.ok(!series.points.some(([d]) => d === "2026-10-16"), "휴장일은 비워 둔다");

    // 물가: 지수 i → 상승률, 빠진 달은 빈 값
    const idx = (m: string) => 100 + cpi.indexOf(m);
    const yoy = (m: string, base: string) => Number(((idx(m) / idx(base) - 1) * 100).toFixed(2));
    const cpiSeries = parse<IndicatorSeries>(files, "indicator-krcpi.json").points;
    assert.equal(cpiSeries[0]![0], "2021-10", "1년 전 지수가 있는 첫 달부터");
    assert.ok(!cpiSeries.some(([m]) => m === "2025-03" || m === "2026-03"), "빠진 달과 그 1년 뒤는 빈 값");
    assert.deepEqual(cpiSeries.find(([m]) => m === "2026-04"), ["2026-04", yoy("2026-04", "2025-04")]);
    const cpiCard = list.indicators.find((c) => c.id === "krcpi")!;
    assert.deepEqual(cpiCard.last, { date: "2026-09", value: yoy("2026-09", "2025-09"), change: Number((yoy("2026-09", "2025-09") - yoy("2026-08", "2025-08")).toFixed(6)) });
    const apr = cpiSeries.findIndex(([m]) => m === "2026-04");
    assert.equal(cpiSeries[apr - 1]![0], "2026-02", "전달 대비는 상승률이 있는 바로 앞 달과 비교한다");

    // 값이 하나도 없는 공개 지표: 카드는 last null, 칩·이슈 그래프에 없다
    const brent = list.indicators.find((c) => c.id === "brent")!;
    assert.deepEqual([brent.last, brent.spark], [null, []]);

    // 브리프 날짜별 기준값: 그 날짜 이하의 가장 최근 값
    for (const date of dates) {
      const chips = dayList(files, date).indicators ?? [];
      assert.ok(!chips.some((c) => c.id === "brent" || c.id === "wti" || c.id === "krcpi"), "값 없는 지표·공개 끈 지표·월별 지표는 칩에 없다");
      const fxChip = chips.find((c) => c.id === "usdkrw")!;
      const base = fx.filter((d) => d <= date).at(-1)!;
      const prev = fx[fx.indexOf(base) - 1]!;
      assert.deepEqual(fxChip, { id: "usdkrw", name: "원/달러 환율", unit: "원", decimals: 1, kind: "abs", date: base, value: fxVal(base), change: fxVal(base) - fxVal(prev) }, date);
    }
    assert.equal(dayList(files, "2026-10-16").indicators![0]!.date, "2026-10-15", "휴장일 브리프는 앞 날의 값");
    assert.equal(dayList(files, "2026-10-25").indicators![0]!.date, "2026-10-23", "주말 브리프는 금요일 값");

    // 이슈의 지표: 공개·값 있는 것만, 기간은 시작일 30일 전부터 마지막 값까지(월별은 달)
    const mainDetail = issueDetail(files, ids.main);
    assert.deepEqual(mainDetail.indicators, [{ id: "usdkrw", from: addDays("2026-10-13", -30), to: "2026-10-26" }], "흡수된 이슈 뉴스로 시작일이 앞당겨지고, wti(공개 끔)·brent(값 없음)는 빠진다");
    assert.deepEqual(issueDetail(files, ids.other).indicators, [
      { id: "usdkrw", from: "2026-09-22", to: "2026-10-26" },
      { id: "krcpi", from: "2026-09", to: "2026-09" },
    ]);
    assert.equal(issueDetail(files, ids.none).indicators, undefined, "고른 지표가 없으면 항목이 없다");

    // 공개 끈 지표는 어디에도 없다
    for (const [name, text] of files) {
      assert.ok(!name.includes("wti"), name);
      assert.ok(!text.includes("77.123") && !text.includes('"wti"'), name);
    }
    db.close();
  });

  test("4.6-3 지표가 있는 DB로 두 번 만든 사이트 데이터가 같다", () => {
    const { db } = siteDb();
    assert.deepEqual(buildSiteData(db), buildSiteData(db));
    db.close();
  });
});


describe("6단계 4.9-1 스킬 문서", () => {
  test("지표 판단·받기 명령과 지표 식별자 목록이 실제와 같다", () => {
    const doc = fs.readFileSync(path.join(import.meta.dirname, "..", ".claude", "skills", "brief", "SKILL.md"), "utf8");
    for (const cmd of ["indicator-list", "indicator-check", "indicator-apply", "indicator-fetch"]) assert.ok(doc.includes(`node src/cli.ts ${cmd} --run`), cmd);
    const listed = [...doc.matchAll(/`([a-z0-9]+)`\(([^)]+)\)/g)].filter(([, id]) => indicatorDef(id!) !== undefined).map(([, id, name]) => [id, name]);
    assert.deepEqual(listed, INDICATORS.map((d) => [d.id, d.name]));
    assert.ok(doc.indexOf("| 12-3 |") < doc.indexOf("| 12-4 |") && doc.indexOf("| 12-4 |") < doc.indexOf("| 13 |"), "판단 → 받기 → 합치기 순서");
  });
});

describe("6단계 4.5-2 사이트 빌드 줄", () => {
  test("빌드 출력과 요약에 공개 지표 수가 나오고, 키가 없으면 키 값 검사를 건너뛰었다고 보인다", () => {
    for (const env of [KEY_ENV, {}]) {
      const f = flowDir(env);
      const builder = ({ outDir }: { outDir: string }) => {
        fs.mkdirSync(outDir, { recursive: true });
        writeFakePublicFiles(outDir);
        return { ok: true as const };
      };
      const ctx = { ...makeCtx(f.repo, f.env), buildSite: builder };
      assert.equal(main(["site", "--run", f.runFile], ctx), 0, ctx.text());
      assert.match(ctx.text(), new RegExp(`, 공개 지표 ${INDICATORS.filter((d) => d.public).length}개`));
      const skip = /- 키 값 검사: 출처 API 키가 환경 변수와 \.env\.local 어디에도 없어 건너뛰었다/;
      if (Object.keys(env).length === 0) assert.match(ctx.text(), skip);
      else assert.doesNotMatch(ctx.text(), skip);
      assert.match(cli(f.repo, ["summary", "--run", f.runFile], f.env).text, /- 사이트 빌드: .*공개 지표 12개/);
    }
  });
});
