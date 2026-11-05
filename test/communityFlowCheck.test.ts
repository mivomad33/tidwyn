import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMUNITY_RULES, judgeCommunity, type CommunityUnit } from "../src/communityStore.ts";
import { openDb } from "../src/db.ts";
import { checkFlowFile, flowLevel, planFlows, turningOf, type CheckedFlow, type TurningUnit } from "../src/demandFlowCheck.ts";
import { recentFlows, saveFlows, type NewFlow } from "../src/demandFlowStore.ts";
import type { CommunityGroup, OfficialGroup } from "../src/demandFlowTypes.ts";
import { buildFlowCandidates, type FlowCandidates, type FlowItems, type NumberedCommunity, type NumberedUnit } from "../src/demandFlowWork.ts";
import { UNIT_RULES, type RisingUnit, type SourceUnits } from "../src/demandUnits.ts";
import { addDays, dateRange } from "../src/kst.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import { FAKE, GOOD_TEXT, TARGET, flowOf, repeat } from "./flowFixtures.ts";

// 9.98단계 4.3-1, 4.3-3, 4.3-4(S1, S7): 커뮤니티 단위가 든 후보 복사본, 흐름 인정 검사, 근거 수준, 다시 세기, 같은 흐름의 새 묶음, 꺾임. 데이터는 모두 지어낸 값이다

after(cleanupTemp);

const WIN = { recentFrom: "2026-10-27", recentTo: "2026-11-02", baseFrom: "2026-09-29", baseTo: "2026-10-26", recentDays: 7, baseDays: 28 };
const CWIN = { recentFrom: WIN.recentFrom, recentTo: WIN.recentTo, baseFrom: WIN.baseFrom, baseTo: WIN.baseTo };
const SOURCE: Record<string, string> = { wikimedia: "wikimedia:en", dart: "dart:list", sec: "sec:formd", github: "github:issues", bluesky: "bluesky:posts" };
const FLOORS: Record<string, number> = { wikimedia: UNIT_RULES.wikimedia.floor, dart: UNIT_RULES.dart.floor, sec: UNIT_RULES["sec-formd"].floor };
const CF = (g: CommunityGroup) => COMMUNITY_RULES[g]!.floor;

function unit(n: number, group: OfficialGroup, o: Partial<NumberedUnit> = {}): NumberedUnit {
  const recent = o.recent ?? FLOORS[group]! * 3;
  return { n, key: `${SOURCE[group]}:k${n}`, source: SOURCE[group]!, group, name: `가짜단위${n}`, recent, base: 1, isNew: false, recentDaily: repeat(7, Math.round(recent / 7)), baseDailyMean: recent / 70, material: [], window: WIN, ...o };
}

/** 공식 단위 of를 검색어로 한 커뮤니티 단위. 기본은 오름(하한의 세 배) */
function com(n: number, of: NumberedUnit, group: CommunityGroup, o: Partial<NumberedCommunity> = {}): NumberedCommunity {
  return { n, key: `${SOURCE[group]}:${of.key}`, source: SOURCE[group]!, group, officialKey: of.key, officialN: of.n, recent: CF(group) * 3, baseCount: 4, base: 1, isNew: false, window: CWIN, rising: true, concentrated: false, ...o };
}

/** 후보 복사본의 커뮤니티 단위와 같은 값의 전용 DB 다시 세기 결과 */
function recountCom(x: NumberedCommunity, o: Partial<CommunityUnit> = {}): CommunityUnit {
  const recentDays = 7;
  const baseDays = 28;
  return { key: x.key, source: x.source, group: x.group, officialKey: x.officialKey, term: "Fake Term QZT", recent: x.recent, baseCount: x.baseCount, window: x.window, share: x.concentrated ? 0.9 : 0.1, judgement: { ...judgeCommunity(x.group, x.recent, x.baseCount, recentDays, baseDays, x.concentrated ? 0.9 : 0.1), rising: x.rising }, ...o };
}

const W1 = unit(1, "wikimedia", { name: FAKE.wiki.replaceAll("_", " ") });
const D2 = unit(2, "dart", { name: FAKE.dart });
const W3 = unit(3, "wikimedia", { name: "가짜둘째문서" });
const C4 = com(4, W1, "github");
const C5 = com(5, W1, "bluesky", { recent: CF("bluesky"), baseCount: 40, base: 10, rising: false });
const C6 = com(6, W3, "github", { concentrated: true, rising: false });
const C7 = com(7, D2, "bluesky");

function candidates(): FlowCandidates {
  return { target: TARGET, units: [W1, D2, W3], community: [C4, C5, C6, C7], aux: [], recent: [], issues: [], groups: [], bytes: 0 };
}

const O = { home: "/Users/fake-home", secrets: [] };
const read = (data: unknown): FlowItems => ({ state: "read", text: JSON.stringify(data), data });
const file = (flows: unknown[], o: Record<string, unknown> = {}) => ({ targetDate: TARGET, flows, excluded: [], ...o });
const check = (data: unknown) => checkFlowFile(candidates(), read(data), O);

function rejects(data: unknown, why: RegExp): void {
  const r = check(data);
  assert.equal(r.ok, false, `통과했다: ${why}`);
  if (r.ok) return;
  const lines = r.violations.map((v) => `${v.where}: ${v.why}`);
  assert.ok(lines.some((l) => why.test(l)), `${why} 없음: ${lines.join(" / ")}`);
  for (const t of [FAKE.wiki, FAKE.dart, "가짜둘째문서"]) assert.ok(!JSON.stringify(r.violations).includes(t), t);
}

describe("4.3-3 흐름 인정 검사(S1)", () => {
  test("공식 하나 + 그 공식 단위를 검색어로 한 오른 커뮤니티 단위, 공식 둘 + 커뮤니티는 통과하고 커뮤니티 단위가 따로 정리된다", () => {
    const r = check(file([flowOf([1, 4]), flowOf([2, 3, 7], { category: "money" })]));
    assert.ok(r.ok, JSON.stringify(!r.ok && r.violations));
    if (!r.ok) return;
    assert.deepEqual(r.flows[0]!.units.map((u) => u.n), [1]);
    assert.deepEqual(r.flows[0]!.community!.map((c) => c.n), [4]);
    assert.deepEqual(r.flows[1]!.community!.map((c) => c.n), [7]);
  });

  test("공식 묶음이 없는 흐름(커뮤니티 단독, 커뮤니티끼리)은 거부한다", () => {
    rejects(file([flowOf([4])]), /흐름 1 units: 공식 묶음이 없다/);
    rejects(file([flowOf([4, 7])]), /흐름 1 units: 공식 묶음이 없다/);
  });

  test("공식 하나뿐인데 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 없으면 거부한다", () => {
    rejects(file([flowOf([1])]), /흐름 1 units: 공식 묶음이 하나뿐인데 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 없다/);
    rejects(file([flowOf([1, 5])]), /흐름 1 units: 공식 묶음이 하나뿐인데/);
    // 다른 공식 단위(D2)를 검색어로 한 커뮤니티 단위는 W1 흐름의 커뮤니티 근거가 아니다
    rejects(file([flowOf([1, 7])]), /흐름 1 units: 공식 묶음이 하나뿐인데/);
  });

  test("오르지 않았거나 한 곳 쏠림인 커뮤니티 단위를 근거로 쓰면 공식 둘이어도 거부한다", () => {
    rejects(file([flowOf([1, 2, 5])]), /흐름 1 units: 오르지 않은 커뮤니티 단위다/);
    rejects(file([flowOf([2, 3, 6], { category: "money" })]), /흐름 1 units: 한 곳 쏠림인 커뮤니티 단위다/);
    rejects(file([flowOf([3, 6])]), /흐름 1 units: 한 곳 쏠림인 커뮤니티 단위다/);
  });

  test("검색어의 공식 단위가 흐름 근거에 없는 커뮤니티 단위는 거부한다", () => {
    rejects(file([flowOf([2, 3, 4], { category: "money" })]), /흐름 1 units: 검색어의 공식 단위가 흐름 근거에 없는 커뮤니티 단위다/);
  });

  test("갈래는 공식 근거 묶음으로만 정한다(커뮤니티 소스는 갈래에 속하지 않는다)", () => {
    rejects(file([flowOf([1, 4], { category: "money" })]), /흐름 1 category: 근거 묶음과 맞지 않는 갈래다/);
    rejects(file([flowOf([1, 4], { category: "complaint" })]), /근거 묶음과 맞지 않는 갈래다/);
  });

  test("커뮤니티 번호의 중복·다른 흐름 사용과 제외 칸의 커뮤니티 번호를 거부한다", () => {
    rejects(file([flowOf([1, 4, 4])]), /같은 번호를 두 번 썼다/);
    rejects(file([flowOf([1, 4]), flowOf([1, 4])]), /다른 흐름이 쓴 번호다/);
    rejects(file([flowOf([1, 2])], { excluded: [4] }), /흐름 파일 excluded: 없는 단위 번호다/);
  });
});

describe("4.3-3 근거 수준(S1)", () => {
  test("공식 하나 + 커뮤니티는 '중'이 최고이고, 커뮤니티 단위가 하한의 두 배 미만이면 '약'이다(경계)", () => {
    for (const g of ["github", "bluesky"] as const) {
      assert.equal(flowLevel([W1], [{ group: g, recent: 2 * CF(g) }]), "medium", `${g} 두 배`);
      assert.equal(flowLevel([W1], [{ group: g, recent: 2 * CF(g) - 1 }]), "weak", `${g} 두 배 미만`);
      assert.equal(flowLevel([W1], [{ group: "github", recent: 10 * CF("github") }, { group: g, recent: 2 * CF(g) - 1 }]), "weak", `${g} 하나라도 두 배 미만`);
    }
    // 같은 묶음 단위가 여럿이고 날마다 이어 올라도 강이 되지 않는다
    assert.equal(flowLevel([W1, W3], [{ group: "github", recent: 100 * CF("github") }, { group: "bluesky", recent: 100 * CF("bluesky") }]), "medium");
  });

  test("공식 하나 + 커뮤니티에서 공식 묶음이 하한의 두 배 미만이면 '약'이다", () => {
    const small = unit(1, "wikimedia", { recent: 2 * FLOORS.wikimedia! - 1 });
    assert.equal(flowLevel([small], [{ group: "github", recent: 10 * CF("github") }]), "weak");
    const enough = unit(1, "wikimedia", { recent: 2 * FLOORS.wikimedia! });
    assert.equal(flowLevel([enough], [{ group: "github", recent: 10 * CF("github") }]), "medium");
  });

  test("공식 둘 이상 + 커뮤니티의 수준은 커뮤니티 없는 같은 흐름과 같다", () => {
    const smallC = [{ group: "github" as const, recent: CF("github") }];
    const bigC = [{ group: "bluesky" as const, recent: 100 * CF("bluesky") }];
    const sets: NumberedUnit[][] = [
      [W1, D2],
      [W1, D2, unit(8, "sec")],
      [W1, unit(9, "dart", { recent: FLOORS.dart! + 1 })],
      [W1, W3, D2, unit(10, "dart")],
    ];
    for (const s of sets) for (const c of [smallC, bigC]) assert.equal(flowLevel(s, c), flowLevel(s), JSON.stringify(s.map((u) => u.n)));
  });
});

const recount = (units: NumberedUnit[]): SourceUnits[] => [{ source: "all", group: "wikimedia", kind: "wikimedia", label: "x", state: "ok", window: WIN, unitCount: units.length, rising: units, risingAll: units.length }];
const checked = (units: NumberedUnit[], community: NumberedCommunity[], o: Partial<CheckedFlow> = {}): CheckedFlow => ({ category: "interest", field: "software", texts: { ...GOOD_TEXT }, units, community, aux: [], issue: null, continues: null, ...o });

describe("4.3-3 다시 세기와 기계 칸", () => {
  test("커뮤니티 숫자가 전용 DB에서 다시 센 값과 다르면 그 흐름을 버린다(건수, 앞 창, 창, 오름 각각)", () => {
    const same = planFlows([checked([W1], [C4])], recount([W1]), [], [], [recountCom(C4)]);
    assert.equal(same.flows.length, 1);
    for (const diff of [{ recent: C4.recent + 1 }, { baseCount: C4.baseCount + 1 }, { window: { ...CWIN, recentTo: "2026-11-01" } }, { window: { ...CWIN, baseFrom: "2026-09-28" } }, { judgement: { ...recountCom(C4).judgement, rising: false } }] as Partial<CommunityUnit>[]) {
      const p = planFlows([checked([W1], [C4])], recount([W1]), [], [], [recountCom(C4, diff)]);
      assert.deepEqual([p.flows.length, p.dropped], [0, { "다시 센 값이 다름": 1 }], JSON.stringify(diff));
    }
    const missing = planFlows([checked([W1], [C4])], recount([W1]), [], [], []);
    assert.deepEqual(missing.dropped, { "다시 센 값이 다름": 1 }, "다시 세기에 없으면 버린다");
  });

  test("커뮤니티 근거 줄은 소스, 검색어였던 공식 단위 이름, 두 창 숫자, 창 기간을 기계가 채운다", () => {
    const p = planFlows([checked([W1, D2], [C7, C4])], recount([W1, D2]), [], [], [recountCom(C4), recountCom(C7)]);
    const f = p.flows[0]!;
    assert.equal(f.level, "medium");
    assert.deepEqual(f.community, [
      { group: "github", source: "github:issues", unitKey: C4.key, officialKey: W1.key, unitName: W1.name, recent: C4.recent, base: C4.base, isNew: false, recentFrom: CWIN.recentFrom, recentTo: CWIN.recentTo, baseFrom: CWIN.baseFrom, baseTo: CWIN.baseTo },
      { group: "bluesky", source: "bluesky:posts", unitKey: C7.key, officialKey: D2.key, unitName: D2.name, recent: C7.recent, base: C7.base, isNew: false, recentFrom: CWIN.recentFrom, recentTo: CWIN.recentTo, baseFrom: CWIN.baseFrom, baseTo: CWIN.baseTo },
    ]);
    assert.equal(f.turning, false);
  });
});

describe("4.3-3 같은 흐름의 새 묶음(S1, S8)", () => {
  const day = (n: number) => addDays(TARGET, -n);
  const lineOf = (u: NumberedUnit) => ({ group: u.group, source: u.source, unitKey: u.key, unitName: u.name, recent: u.recent, base: u.base, isNew: false, recentFrom: WIN.recentFrom, recentTo: WIN.recentTo, baseFrom: WIN.baseFrom, baseTo: WIN.baseTo, recentDays: 7, baseDays: 28 });
  const comLine = (c: NumberedCommunity, of: NumberedUnit) => ({ group: c.group, source: c.source, unitKey: c.key, officialKey: of.key, unitName: of.name!, recent: c.recent, base: c.base, isNew: false, recentFrom: CWIN.recentFrom, recentTo: CWIN.recentTo, baseFrom: CWIN.baseFrom, baseTo: CWIN.baseTo });
  const item = (o: Partial<NewFlow>): NewFlow => ({ flowId: "", category: "interest", field: "software", ...GOOD_TEXT, level: "medium", aux: [], issue: null, continues: null, units: [lineOf(W1), lineOf(D2)], ...o });

  function db() {
    return openDb(path.join(tempDir(), "tidwyn.db"));
  }
  const refs = (d: ReturnType<typeof db>) => recentFlows(d, TARGET).map((f) => ({ flowId: f.flowId, date: f.date, field: f.field, unitKeys: f.units.map((u) => u.unitKey) }));

  test("14일 안 같은 흐름에 커뮤니티 소스가 새로 더해지면 같은 id로 다시 싣고 앞 항목을 가리킨다", () => {
    const d = db();
    saveFlows(d, day(5), [item({})], { date: day(5), status: "checked", missing: [] });
    const p = planFlows([checked([W1, D2], [C4])], recount([W1, D2]), recentFlows(d, TARGET), refs(d), [recountCom(C4)]);
    assert.equal(p.flows.length, 1);
    const prev = recentFlows(d, TARGET)[0]!;
    assert.deepEqual([p.flows[0]!.flowId, p.flows[0]!.continues], [prev.flowId, prev.id]);
    const without = planFlows([checked([W1, D2], [])], recount([W1, D2]), recentFlows(d, TARGET), refs(d));
    assert.deepEqual(without.dropped, { "같은 흐름이 강해지지 않음": 1 }, "커뮤니티 없이는 강해지지 않음");
  });

  test("그 흐름 id의 최근 14일 항목 어디엔가 이미 있던 커뮤니티 소스는 새 묶음으로 치지 않는다", () => {
    const d = db();
    saveFlows(d, day(10), [item({ community: [comLine(C4, W1)] })], { date: day(10), status: "checked", missing: [] });
    const first = recentFlows(d, TARGET)[0]!;
    // 앞 항목(커뮤니티 없음)이 같은 id를 잇고 수준이 올랐다
    saveFlows(d, day(5), [item({ flowId: first.flowId, continues: first.id, level: "strong", units: [lineOf(W1), lineOf(D2), lineOf(unit(8, "sec"))] })], { date: day(5), status: "checked", missing: [] });
    const p = planFlows([checked([W1, D2], [C4])], recount([W1, D2]), recentFlows(d, TARGET), refs(d), [recountCom(C4)]);
    assert.deepEqual([p.flows.length, p.dropped], [0, { "같은 흐름이 강해지지 않음": 1 }]);
    // 다른 커뮤니티 소스(Bluesky)는 새 묶음이다
    const c = com(9, W1, "bluesky");
    const q = planFlows([checked([W1, D2], [c])], recount([W1, D2]), recentFlows(d, TARGET), refs(d), [recountCom(c)]);
    assert.equal(q.flows[0]?.flowId, first.flowId);
  });
});

// ---- 꺾임(S7) ----

const BASE_DATES = dateRange(WIN.baseFrom, WIN.baseTo);
const RECENT_DATES = dateRange(WIN.recentFrom, WIN.recentTo);
const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
const isWeekend = (d: string) => weekday(d) === 0 || weekday(d) === 6;

/** 날마다 값 함수로 만든 꺾임 판정 단위 */
function tu(group: string, value: (d: string, recent: boolean) => number | null): TurningUnit {
  return { group, window: { recentFrom: WIN.recentFrom, baseFrom: WIN.baseFrom }, recentDaily: RECENT_DATES.map((d) => value(d, true)), baseDaily: BASE_DATES.map((d) => value(d, false)) };
}
/** 앞 창 하루 10, 최근 7일은 앞 4일 40, 마지막 3일 20(줄어드는 중) */
const falling = (d: string, recent: boolean) => (!recent ? 10 : RECENT_DATES.indexOf(d) < 4 ? 40 : 20);
const steady = (d: string, recent: boolean) => (recent ? 40 : 10);

describe("4.3-4 꺾임(S7)", () => {
  test("모든 날마다 값 묶음에서 마지막 3일의 요일 보정 비가 앞 4일보다 낮으면 표시한다", () => {
    assert.equal(turningOf([tu("wikimedia", falling)]), true);
    assert.equal(turningOf([tu("wikimedia", falling), tu("dart", falling)]), true);
    assert.equal(turningOf([tu("wikimedia", steady)]), false, "같으면 표시하지 않는다");
  });

  test("한 묶음만 낮으면 표시하지 않는다", () => {
    assert.equal(turningOf([tu("wikimedia", falling), tu("dart", steady)]), false);
  });

  test("날마다 값이 있는 묶음이 없으면 표시하지 않는다(지어낸 묶음)", () => {
    assert.equal(turningOf([tu("fakegroup", falling)]), false);
    assert.equal(turningOf([tu("wikimedia", falling)], () => false), false);
    assert.equal(turningOf([]), false);
  });

  test("평일에만 값이 있는 묶음에서 주말이 마지막 3일에 들어도 같은 요일 비로 표시하지 않는다", () => {
    const weekdayOnly = (d: string, recent: boolean) => (isWeekend(d) ? 0 : recent ? 30 : 10);
    const tail = RECENT_DATES.slice(4);
    assert.ok(tail.some(isWeekend), `지어낸 창의 마지막 3일(${tail.join(", ")})에 주말이 든다`);
    // 날 값 그대로 견주면 마지막 3일 평균이 앞 4일보다 낮다(요일 보정이 없으면 꺾임으로 보인다)
    const raw = RECENT_DATES.map((d) => weekdayOnly(d, true));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(avg(raw.slice(4)) < avg(raw.slice(0, 4)));
    assert.equal(turningOf([tu("dart", weekdayOnly)]), false);
  });

  test("자료 없음 날은 그날만 빼고, 비를 낼 날이 한쪽이라도 없는 묶음이 있으면 표시하지 않는다", () => {
    const absentOne = (d: string, recent: boolean) => (d === RECENT_DATES[5] ? null : falling(d, recent));
    assert.equal(turningOf([tu("wikimedia", absentOne)]), true);
    const noTail = (d: string, recent: boolean) => (RECENT_DATES.indexOf(d) >= 4 ? null : falling(d, recent));
    assert.equal(turningOf([tu("wikimedia", noTail)]), false);
    assert.equal(turningOf([tu("wikimedia", falling), tu("dart", noTail)]), false);
    const noBase = (d: string, recent: boolean) => (recent ? falling(d, recent) : 0);
    assert.equal(turningOf([tu("wikimedia", noBase)]), false, "같은 요일 평균이 0이면 그날을 뺀다");
  });

  test("기계가 계획에서 다시 센 공식 단위로 꺾임을 정해 항목에 둔다(수준은 그대로)", () => {
    const fall = tu("wikimedia", falling);
    const w = unit(1, "wikimedia", { recentDaily: fall.recentDaily as number[], baseDaily: fall.baseDaily as number[] });
    const d = unit(2, "dart", { ...tu("dart", falling), window: WIN } as Partial<NumberedUnit>);
    const p = planFlows([checked([w, d], [])], recount([w, d]), [], []);
    assert.deepEqual([p.flows[0]!.turning, p.flows[0]!.level], [true, flowLevel([w, d])]);
  });
});

describe("4.3-1 후보 복사본", () => {
  const rising = (source: string, group: OfficialGroup, n: number, nameLen = 10): RisingUnit[] =>
    Array.from({ length: n }, (_, i) => ({ key: `${source}:k${i}`, source, group, name: `가짜이름${i}${"가".repeat(nameLen)}`, recent: 50, base: 7, isNew: false, recentDaily: repeat(7, 7), baseDailyMean: 1, material: [`가짜재료${i} ${"나".repeat(400)}`], window: WIN }));
  const cu = (source: string, group: CommunityGroup, officialKey: string, rising = true): CommunityUnit => ({ key: `${source}:${officialKey}`, source, group, officialKey, term: `Fake Term QZT ${officialKey}`, recent: 50, baseCount: 40, window: CWIN, share: 0.1, judgement: { base: 10, isNew: false, passes: rising, concentrated: false, rising } });

  test("커뮤니티 단위(번호, 소스, 검색어였던 공식 단위 번호, 두 창 숫자, 오름 여부)가 들고 검색어 문자열은 없다", () => {
    const d = openDb(path.join(tempDir(), "tidwyn.db"));
    const wiki = rising("wikimedia:en", "wikimedia", 2);
    const sources: SourceUnits[] = [{ source: "wikimedia:en", group: "wikimedia", kind: "wikimedia", label: "en", state: "ok", window: WIN, unitCount: 2, rising: wiki, risingAll: 2 }];
    const built = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [], community: [cu("github:issues", "github", wiki[1]!.key), cu("bluesky:posts", "bluesky", wiki[0]!.key, false), cu("github:issues", "github", "wikimedia:en:없는단위")] });
    assert.deepEqual(
      built.data.community!.map((c) => [c.n, c.source, c.officialN, c.recent, c.baseCount, c.base, c.rising]),
      [
        [3, "bluesky:posts", 1, 50, 40, 10, false],
        [4, "github:issues", 2, 50, 40, 10, true],
      ],
      "검색어의 공식 단위가 후보에 없는 커뮤니티 단위는 빠지고, 번호는 공식 단위 뒤에 잇는다",
    );
    assert.match(built.list, /## 커뮤니티 단위 \(2개\)/);
    assert.match(built.list, /### 번호 4 · 커뮤니티 · GitHub Issues · github:issues\n\n- 단위 키: github:issues:wikimedia:en:k1\n- 검색어: 번호 2의 단위 이름\n- 최근\(2026-10-27~2026-11-02\): 50건\n- 앞\(2026-09-29~2026-10-26\) 같은 길이 평균: 10건\n- 오름: 예/);
    assert.match(built.list, /번호 3 · 커뮤니티 · Bluesky[\s\S]*?- 오름: 아니오/);
    assert.ok(!built.list.includes("Fake Term QZT"), "검색어 문자열이 목록에 없다");
    assert.ok(!JSON.stringify(built.data).includes("Fake Term QZT"), "검색어 문자열이 기계 원본에 없다");
  });

  test("커뮤니티 단위가 없으면 목록에 커뮤니티 구역이 없다(9.97 목록과 같다)", () => {
    const d = openDb(path.join(tempDir(), "tidwyn.db"));
    const wiki = rising("wikimedia:en", "wikimedia", 2);
    const sources: SourceUnits[] = [{ source: "wikimedia:en", group: "wikimedia", kind: "wikimedia", label: "en", state: "ok", window: WIN, unitCount: 2, rising: wiki, risingAll: 2 }];
    const a = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [] });
    const b = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [], community: [] });
    assert.equal(a.list, b.list);
    assert.ok(!a.list.includes("커뮤니티"));
  });

  test("상한(160KB)을 지키고, 줄이기로 빠진 공식 단위를 검색어로 한 커뮤니티 단위도 뺀다", () => {
    const d = openDb(path.join(tempDir(), "tidwyn.db"));
    const wiki = rising("wikimedia:en", "wikimedia", 6, 200);
    const dart = rising("dart:list", "dart", 6, 200);
    const sources: SourceUnits[] = [
      { source: "wikimedia:en", group: "wikimedia", kind: "wikimedia", label: "en", state: "ok", window: WIN, unitCount: 6, rising: wiki, risingAll: 6 },
      { source: "dart:list", group: "dart", kind: "dart", label: "DART", state: "ok", window: WIN, unitCount: 6, rising: dart, risingAll: 6 },
    ];
    const community = [...wiki, ...dart].flatMap((u) => [cu("github:issues", "github", u.key), cu("bluesky:posts", "bluesky", u.key)]);
    const full = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [], community });
    const max = Math.floor(full.data.bytes * 0.6);
    const built = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [], community, maxBytes: max });
    assert.ok(built.data.bytes <= max, `${built.data.bytes} > ${max}`);
    assert.ok(built.data.units.length < 12, "공식 단위가 줄었다");
    const kept = new Set(built.data.units.map((u) => u.key));
    assert.ok(built.data.community!.length > 0);
    assert.equal(built.data.community!.length, built.data.units.length * 2, "남은 공식 단위마다 커뮤니티 단위가 남는다");
    for (const c of built.data.community!) assert.ok(kept.has(c.officialKey), c.key);
    for (const c of built.data.community!) assert.equal(built.data.units.find((u) => u.key === c.officialKey)!.n, c.officialN);
    const real = buildFlowCandidates({ db: d, target: TARGET, sources, groups: [], aux: [], community });
    assert.ok(real.data.bytes <= 160 * 1024);
  });
});
