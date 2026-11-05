import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { openDemandDb, setMeta } from "../src/demandStore.ts";
import { auxCandidates, dartKind, isFtcMonthComplete, isWikiSpecial, officialUnits, type SourceUnits, type UnitsOptions } from "../src/demandUnits.ts";
import { addDays, dateRange } from "../src/kst.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import { ALL, END, FAKE, TARGET, TODAY, assemblyPart, bigdataPart, dartPart, ftcPart, isRecent, putValue, qnaParts, repeat, secParts, seedAux, series, src, wikiAbsent, wikiPart, type FtcItem } from "./flowFixtures.ts";

// 9.97단계 4.1-1(S5): 소스마다 지어낸 스냅샷에서 7일·28일 값과 오른 단위. 전용 DB는 임시 폴더의 지어낸 것이다

after(cleanupTemp);

function demand(): DatabaseSync {
  return openDemandDb(`${tempDir("tidwyn-units-")}/demand.db`);
}

function one(db: DatabaseSync, source: string, o: Partial<UnitsOptions> = {}): SourceUnits {
  return officialUnits(db, TODAY, { target: TARGET, sources: [src(source)], ...o }).sources[0]!;
}

const byName = (s: SourceUnits) => Object.fromEntries(s.rising.map((u) => [u.name, { recent: u.recent, base: u.base, isNew: u.isNew }]));
const WINDOW = { recentFrom: "2026-10-27", recentTo: END, baseFrom: "2026-09-29", baseTo: "2026-10-26", recentDays: 7, baseDays: 28 };

describe("4.1-1 Wikimedia: 값과 오른 단위, 특수 문서·하루 몰림·하한", () => {
  test("최근 7일과 앞 28일 같은 길이 평균이 기대값이고, 대문·특수 문서와 하루 몰림 문서와 하한 미만이 빠진다", () => {
    const db = demand();
    series(db, "wikimedia:en", ALL, (d) => {
      const r = isRecent(d);
      return [
        wikiPart([
          ["Main_Page", r ? 2_000_000 : 0],
          ["Special:Search", r ? 500_000 : 0],
          [FAKE.wiki, r ? 50_000 : 10_000],
          ["Fake_Flat_QZ", 30_000],
          ["Fake_Spike_QZ", d === "2026-10-27" ? 500_000 : r ? 5_000 : 0],
          ["Fake_Spread_QZ", d === "2026-10-30" ? 70_000 : r ? 20_000 : 0],
          ["Fake_Small_QZ", r ? 14_000 : 0],
          ["Fake_Floor_QZ", r ? 14_286 : 0],
        ]),
      ];
    });
    const s = one(db, "wikimedia:en");
    assert.equal(s.state, "ok");
    assert.deepEqual(s.window, WINDOW);
    assert.deepEqual(byName(s), {
      [FAKE.wiki.replaceAll("_", " ")]: { recent: 350_000, base: 70_000, isNew: false },
      "Fake Spread QZ": { recent: 190_000, base: 0, isNew: true },
      "Fake Floor QZ": { recent: 100_002, base: 0, isNew: true },
    });
    assert.equal(s.unitCount, 6, "대문·특수 문서는 단위로도 세지 않는다");
    assert.equal(s.risingAll, 3);
    const top = s.rising[0]!;
    assert.equal(top.name, FAKE.wiki.replaceAll("_", " "), "점수 순이다");
    assert.deepEqual(top.recentDaily, repeat(7, 50_000));
    assert.equal(top.baseDailyMean, 10_000);
    for (const u of s.rising) assert.ok(u.key.startsWith("wikimedia:en:") && !/fake/i.test(u.key), "단위 키에 받은 글이 없다");
    db.close();
  });

  test("대문·특수 문서 판정", () => {
    for (const a of ["Main_Page", "Special:Search", "Spezial:Suche", "특수기능:검색", "위키백과:대문", "File:Fake.png", "-"]) assert.ok(isWikiSpecial(a), a);
    for (const a of [FAKE.wiki, "Fake:Colon_In_Title", "Mainland"]) assert.ok(!isWikiSpecial(a), a);
  });

  test("자료 없음 날: 최근 1일은 남은 날의 일평균으로 맞추고, 최근 2일 이상이나 앞 28일 7일 이상이면 뺀다", () => {
    const db = demand();
    const data = (absent: string[]) => (d: string) => (absent.includes(d) ? [wikiAbsent()] : [wikiPart([[FAKE.wiki, isRecent(d) ? 50_000 : 10_000]])]);
    series(db, "wikimedia:de", ALL, data(["2026-11-01"]));
    series(db, "wikimedia:fr", ALL, data(["2026-10-30", "2026-11-01"]));
    series(db, "wikimedia:ja", ALL, data(dateRange("2026-10-01", "2026-10-06")));
    series(db, "wikimedia:es", ALL, data(dateRange("2026-10-01", "2026-10-07")));
    const de = one(db, "wikimedia:de");
    assert.equal(de.state, "ok");
    assert.equal(de.window!.recentDays, 6);
    assert.equal(de.window!.baseDays, 28);
    assert.deepEqual(byName(de), { [FAKE.wiki.replaceAll("_", " ")]: { recent: 300_000, base: 60_000, isNew: false } });
    assert.equal(de.rising[0]!.recentDaily.filter((v) => v === null).length, 1, "자료 없음 날은 값이 없다(0이 아니다)");
    assert.equal(one(db, "wikimedia:fr").state, "absent");
    const ja = one(db, "wikimedia:ja");
    assert.equal(ja.state, "ok");
    assert.equal(ja.window!.baseDays, 22);
    assert.deepEqual(byName(ja), { [FAKE.wiki.replaceAll("_", " ")]: { recent: 350_000, base: 70_000, isNew: false } }, "자료 없음 날을 0으로 세면 평균이 내려간다");
    assert.equal(one(db, "wikimedia:es").state, "absent");
    db.close();
  });
});

describe("4.1-1 DART·SEC·권익위·국회", () => {
  test("DART: 공시 종류(정정 표시와 기간 괄호를 뺀 이름)마다 세고, 하한 미만은 빠진다", () => {
    assert.equal(dartKind(`[기재정정]${FAKE.dart} (2026.09)`), FAKE.dart);
    assert.equal(dartKind(`[첨부추가] [기재정정]  사업  보고서`), "사업 보고서");
    const db = demand();
    series(db, "dart:list", ALL, (d) => [dartPart([...repeat(isRecent(d) ? 5 : 1, FAKE.dart), ...(isRecent(d) ? [`[기재정정]${FAKE.dart} (2026.09)`, "가짜작은공시"] : []), "가짜평범공시", "가짜평범공시"])]);
    const s = one(db, "dart:list");
    assert.equal(s.state, "ok");
    assert.deepEqual(s.window, WINDOW);
    assert.deepEqual(byName(s), { [FAKE.dart]: { recent: 42, base: 7, isNew: false } });
    assert.equal(s.unitCount, 3);
    db.close();
  });

  test("SEC: 업종마다 세고, 자료 없음인 문서(primary_doc 404)는 그 문서만 뺀다", () => {
    const db = demand();
    series(db, "sec:formd", ALL, (d) => [...secParts([...repeat(isRecent(d) ? 3 : 1, FAKE.sec), "Fake Flat Industry"]), { ...secParts([FAKE.sec])[0]!, page: 99, absent: true }]);
    const s = one(db, "sec:formd");
    assert.equal(s.state, "ok");
    assert.deepEqual(byName(s), { [FAKE.sec]: { recent: 21, base: 7, isNew: false } });
    db.close();
  });

  test("권익위 질의응답: 기관 코드마다 세고 이름은 싣지 않으며(외부인 글), 상세가 자료 없음인 항목은 뺀다", () => {
    const db = demand();
    series(db, "acrc:qna", ALL, (d) => (isRecent(d) ? qnaParts(repeat(4, { ancName: FAKE.agency, ancCode: "A1" }), [4]) : qnaParts([{ ancName: FAKE.agency, ancCode: "A1" }])));
    const s = one(db, "acrc:qna");
    assert.equal(s.state, "ok");
    assert.equal(s.rising.length, 1);
    const u = s.rising[0]!;
    assert.equal(u.key, "acrc:qna:A1");
    assert.equal(u.name, null, "외부인 글 소스는 사이트에 실을 이름이 없다");
    assert.equal(u.recent, 21);
    assert.equal(u.base, 7);
    db.close();
  });

  test("민원빅데이터: 값은 목록에 든 날의 합이다(같은 날 두 번은 하루)", () => {
    const db = demand();
    series(db, "acrc:bigdata", ALL, (d) => [bigdataPart(isRecent(d) ? [FAKE.keyword, FAKE.keyword, "가짜늘있는키워드"] : ["가짜늘있는키워드"])]);
    const s = one(db, "acrc:bigdata");
    assert.deepEqual(byName(s), { [FAKE.keyword]: { recent: 7, base: 0, isNew: true } });
    db.close();
  });

  test("같은 묶음의 여러 소스(권익위 셋)는 한 묶음으로 센다", () => {
    const db = demand();
    series(db, "acrc:qna", ALL, (d) => qnaParts(repeat(isRecent(d) ? 3 : 1, { ancName: FAKE.agency, ancCode: "A1" })));
    series(db, "acrc:bigdata", ALL, (d) => [bigdataPart(isRecent(d) ? [FAKE.keyword] : ["가짜늘있는키워드"])]);
    const r = officialUnits(db, TODAY, { target: TARGET, sources: [src("acrc:qna"), src("acrc:proposal"), src("acrc:bigdata"), src("dart:list")] });
    assert.deepEqual(r.groups.find((g) => g.group === "acrc"), { group: "acrc", compared: true, reasons: ["nodata"], rising: 2 });
    assert.deepEqual(r.groups.find((g) => g.group === "dart"), { group: "dart", compared: false, reasons: ["nodata"], rising: 0 });
    db.close();
  });

  const cnt = (d: string, i: number) => 10 * i + 190 * Math.max(0, i - dateRange("2026-09-01", "2026-10-26").length + 1);
  function assembly(db: DatabaseSync, from: string): void {
    const days = dateRange(from, END);
    const idx = (d: string) => dateRange("2026-09-01", d).length - 1;
    for (const d of days) putValue(db, "assembly:received", d, [assemblyPart(src("assembly:received").service!, [{ PTT_ID: "P1", PTT_NM: FAKE.petition, CITZN_AGM_CNT: cnt(d, idx(d)) }, { PTT_ID: "P2", PTT_NM: FAKE.petition, CITZN_AGM_CNT: 10 * idx(d) }])], d);
  }

  test("국회 접수목록: 그날 늘어난 동의 수로 세고, 그날 상태 스냅샷이 35일 쌓이기 전에는 근거가 아니다", () => {
    const enough = demand();
    assembly(enough, "2026-09-28");
    const s = one(enough, "assembly:received");
    assert.equal(s.state, "ok");
    assert.deepEqual(s.rising.map((u) => ({ key: u.key, name: u.name, recent: u.recent, base: u.base })), [{ key: "assembly:received:P1", name: null, recent: 1400, base: 70 }]);
    const short = demand();
    assembly(short, "2026-09-30");
    assert.equal(one(short, "assembly:received").state, "short", "34일");
    const just = demand();
    assembly(just, "2026-09-29");
    assert.notEqual(one(just, "assembly:received").state, "short", "35일이면 기록 부족이 아니다");
    enough.close();
    short.close();
    just.close();
  });
});

describe("4.1-1 받지 못한 날·오래됨·꺼짐", () => {
  test("창 안에 받지 못한 값 날짜가 하나라도 있으면 빠지고, 창 밖이면 그대로다", () => {
    const db = demand();
    series(db, "dart:list", ALL, (d) => (d === "2026-10-10" ? null : [dartPart(repeat(isRecent(d) ? 5 : 1, FAKE.dart))]));
    series(db, "sec:formd", ALL, (d) => (d === "2026-09-25" ? null : secParts(repeat(isRecent(d) ? 3 : 1, FAKE.sec))));
    const dart = one(db, "dart:list");
    assert.equal(dart.state, "unfetched");
    assert.deepEqual(dart.rising, []);
    assert.equal(one(db, "sec:formd").state, "ok");
    db.close();
  });

  test("창 끝이 소스마다 정한 날 수보다 오래되면 '오래됨'으로 빠진다(DART 3일, Wikimedia 4일)", () => {
    const db = demand();
    const dartTo = (end: string, source = "dart:list") => series(db, source, dateRange("2026-09-01", end), (d) => [dartPart(repeat(d >= addDays(end, -6) ? 5 : 1, FAKE.dart))]);
    dartTo("2026-10-31");
    assert.equal(one(db, "dart:list").state, "ok", "3일 전은 오래되지 않았다");
    const db2 = demand();
    series(db2, "dart:list", dateRange("2026-09-01", "2026-10-30"), () => [dartPart([FAKE.dart])]);
    assert.equal(one(db2, "dart:list").state, "stale", "4일 전");
    series(db2, "wikimedia:en", dateRange("2026-09-01", "2026-10-30"), () => [wikiPart([[FAKE.wiki, 10]])]);
    assert.equal(one(db2, "wikimedia:en").state, "ok", "Wikimedia는 4일까지 된다");
    series(db2, "wikimedia:de", dateRange("2026-09-01", "2026-10-29"), () => [wikiPart([[FAKE.wiki, 10]])]);
    assert.equal(one(db2, "wikimedia:de").state, "stale");
    db.close();
    db2.close();
  });

  test("대상 날짜와 그 뒤 값 날짜는 세지 않는다(창 끝은 대상 날짜 전날 이하)", () => {
    const db = demand();
    series(db, "dart:list", dateRange("2026-09-01", "2026-11-04"), (d) => [dartPart(repeat(d >= TARGET ? 50 : isRecent(d) ? 7 : 1, FAKE.dart))]);
    const s = one(db, "dart:list");
    assert.equal(s.window!.recentTo, END);
    assert.equal(s.rising[0]!.recent, 49);
    db.close();
  });

  test("꺼진 소스는 '꺼짐'이다", () => {
    const db = demand();
    series(db, "dart:list", ALL, () => [dartPart([FAKE.dart])]);
    assert.equal(one(db, "dart:list", { off: ["dart:list"] }).state, "off");
    assert.equal(one(db, "dart:list").state, "ok");
    db.close();
  });
});

describe("4.1-1 1372: 입력일로 날마다 세기와 창 끝(S5)", () => {
  /** 1372 C1: 앞 28일(09-28~10-25) 하루 1건, 최근 7일(10-26~11-01) 하루 6건. 입력일은 접수 달 또는 다음 달 */
  function ftcItems(): Map<string, FtcItem[]> {
    const byMonth = new Map<string, FtcItem[]>();
    const add = (ym: string, d: string, n: number, code = "C1") => byMonth.set(ym, [...(byMonth.get(ym) ?? []), ...repeat(n, { d, code })]);
    for (const d of dateRange("2026-08-01", "2026-11-02")) {
      const n = d >= "2026-10-26" ? 6 : 1;
      // 10-01·10-02 입력은 9월 접수, 11-01·11-02 입력은 10월 접수(앞 달 접수·창 안 입력)
      const ym = d === "2026-10-01" || d === "2026-10-02" ? "2026-09" : d >= "2026-11-01" ? "2026-10" : d.slice(0, 7);
      add(ym, d, n);
    }
    add("2026-11", "2026-11-02", 1, "C9");
    return byMonth;
  }

  function seedFtc(o: { sepFetched: string; checked?: string }): DatabaseSync {
    const db = demand();
    const items = ftcItems();
    const fetched: Record<string, string> = { "2026-08": "2026-09-20", "2026-09": o.sepFetched, "2026-10": "2026-11-03", "2026-11": "2026-11-03" };
    for (const [ym, list] of items) putValue(db, "ftc1372:consult", ym, [ftcPart(list)], fetched[ym]!);
    if (o.checked !== undefined) setMeta(db, `ftc1372:consult:count-checked:2026-09`, `${o.checked}T06:30:00+09:00`);
    return db;
  }

  test("입력일로 날마다 세고, 앞 달 접수의 창 안 입력이 세어지며, 창 끝은 가장 늦은 입력일 전날과 덜 찬 달 받은 날 전날 중 이른 쪽이다", () => {
    const db = seedFtc({ sepFetched: "2026-10-20" });
    const s = one(db, "ftc1372:consult");
    assert.equal(s.state, "ok");
    assert.deepEqual(s.window, { recentFrom: "2026-10-26", recentTo: "2026-11-01", baseFrom: "2026-09-28", baseTo: "2026-10-25", recentDays: 7, baseDays: 28 });
    assert.deepEqual(byName(s), { [`가짜대분류 > ${FAKE.ftc}C1`]: { recent: 42, base: 7, isNew: false } });
    assert.equal(s.rising[0]!.key, "ftc1372:consult:C1");
    db.close();
  });

  test("앞 달 스냅샷이 더 오래되면(끝난 달이 덜 찼으면) 창 끝이 그 받은 날 전날이다", () => {
    const db = seedFtc({ sepFetched: "2026-10-05" });
    assert.equal(one(db, "ftc1372:consult").window?.recentTo, "2026-10-04");
    db.close();
  });

  test("말일 14일 뒤에 받은 끝난 달은 창 끝을 막지 않는다(13일 뒤는 막는다)", () => {
    const late = seedFtc({ sepFetched: "2026-10-14" });
    assert.equal(one(late, "ftc1372:consult").window?.recentTo, "2026-11-01");
    const early = seedFtc({ sepFetched: "2026-10-13" });
    assert.equal(one(early, "ftc1372:consult").window?.recentTo, "2026-10-12");
    late.close();
    early.close();
  });

  test("말일 14일 뒤에 건수를 확인했고 그 뒤 새 스냅샷이 없는 달은 창 끝을 막지 않는다(14일 전 확인은 막는다)", () => {
    const checked = seedFtc({ sepFetched: "2026-10-05", checked: "2026-10-20" });
    assert.equal(one(checked, "ftc1372:consult").window?.recentTo, "2026-11-01");
    const tooEarly = seedFtc({ sepFetched: "2026-10-05", checked: "2026-10-10" });
    assert.equal(one(tooEarly, "ftc1372:consult").window?.recentTo, "2026-10-04");
    checked.close();
    tooEarly.close();
  });

  test("완성된 달 판정: 끝나지 않은 달, 말일 14일, 건수 확인, 끝난 지 3달째", () => {
    assert.equal(isFtcMonthComplete("2026-11", "2026-11-30", "2026-11-29", null), false, "끝나지 않은 달");
    assert.equal(isFtcMonthComplete("2026-09", "2026-11-04", "2026-10-14", null), true);
    assert.equal(isFtcMonthComplete("2026-09", "2026-11-04", "2026-10-13", null), false);
    assert.equal(isFtcMonthComplete("2026-09", "2026-11-04", "2026-10-05", "2026-10-14"), true);
    assert.equal(isFtcMonthComplete("2026-09", "2026-11-04", "2026-10-05", "2026-10-13"), false);
    assert.equal(isFtcMonthComplete("2026-09", "2026-12-01", "2026-10-05", null), true, "끝난 지 3달째부터는 확인하지 않는 달이다");
  });

  test("대상 날짜의 달보다 4달 앞선 접수 월까지 읽고(창 첫날의 입력이 든다), 그보다 앞선 달은 풀지 않으며, 남은 달에 입력이 없으면 앞선 달로 '오래됨'을 낸다", () => {
    // 창 끝 09-29(35일 전): 앞 28일 08-26~09-22 하루 1건, 최근 7일 09-23~09-29 하루 6건. 08-26~08-31 입력은 7월 접수(대상 11월의 4달 앞)에 든다
    const db = demand();
    const byMonth = new Map<string, FtcItem[]>();
    for (const d of dateRange("2026-08-26", "2026-09-30")) {
      const ym = d < "2026-09-01" ? "2026-07" : "2026-09";
      byMonth.set(ym, [...(byMonth.get(ym) ?? []), ...repeat(d >= "2026-09-23" && d <= "2026-09-29" ? 6 : 1, { d, code: "C1" })]);
    }
    putValue(db, "ftc1372:consult", "2026-07", [ftcPart(byMonth.get("2026-07")!)], "2026-08-20");
    putValue(db, "ftc1372:consult", "2026-08", [ftcPart([])], "2026-09-20");
    putValue(db, "ftc1372:consult", "2026-09", [ftcPart(byMonth.get("2026-09")!)], "2026-10-20");
    // 5달 앞선 6월 접수에는 풀 수 없는 원문(깨진 gzip)을 더한다. 풀면 예외가 난다
    putValue(db, "ftc1372:consult", "2026-06", [ftcPart([{ d: "2026-06-30", code: "C1" }])], "2026-07-20");
    db.prepare("INSERT INTO demand_value_parts (value_id, part, page, url, absent, encoding, body) SELECT id, 'list', 2, 'https://fake.example/broken', 0, 'gzip', x'00' FROM demand_values WHERE source = 'ftc1372:consult' AND value_date = '2026-06'").run();
    const s = one(db, "ftc1372:consult");
    assert.equal(s.state, "ok");
    assert.equal(s.window?.recentTo, "2026-09-29");
    assert.equal(s.window?.baseFrom, "2026-08-26");
    assert.deepEqual(byName(s), { [`가짜대분류 > ${FAKE.ftc}C1`]: { recent: 42, base: 7, isNew: false } });
    db.close();

    const old = demand();
    putValue(old, "ftc1372:consult", "2026-06", [ftcPart(dateRange("2026-06-01", "2026-06-30").map((d) => ({ d, code: "C1" })))], "2026-07-20");
    putValue(old, "ftc1372:consult", "2026-10", [ftcPart([])], "2026-11-03");
    assert.equal(one(old, "ftc1372:consult").state, "stale");
    old.close();
  });

  test("창 끝이 35일보다 오래되면 '오래됨'이다", () => {
    const db = demand();
    const list: FtcItem[] = dateRange("2026-08-01", "2026-08-31").map((d) => ({ d, code: "C1" }));
    putValue(db, "ftc1372:consult", "2026-08", [ftcPart(list)], "2026-09-20");
    putValue(db, "ftc1372:consult", "2026-07", [ftcPart(dateRange("2026-07-01", "2026-07-31").map((d) => ({ d, code: "C1" })))], "2026-08-20");
    assert.equal(one(db, "ftc1372:consult").state, "stale");
    db.close();
  });
});

describe("4.1-1 보조 근거", () => {
  test("보조 소스는 오른 단위를 뽑지 않고 그날 스냅샷의 이름만 보조 근거 후보로 넣는다", () => {
    const db = demand();
    seedAux(db);
    assert.deepEqual(auxCandidates(db, TARGET, TODAY), [
      { source: "google:KR", group: "google", label: "Google Trends KR", names: [FAKE.term] },
      { source: "mastodon:fake.example", group: "mastodon", label: "Mastodon fake.example", names: [FAKE.tag] },
    ]);
    assert.deepEqual(auxCandidates(db, "2026-11-05", "2026-11-05"), [], "대상 날짜 전에 받은 것은 넣지 않는다");
    db.close();
  });
});
