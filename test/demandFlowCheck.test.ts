import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, test } from "node:test";
import { openDb } from "../src/db.ts";
import { BANNED_WORDS, checkFlowFile, flowLevel, hasNumber, planFlows, type CheckedFlow } from "../src/demandFlowCheck.ts";
import { recentFlows, saveFlows, type Flow, type NewFlow } from "../src/demandFlowStore.ts";
import type { OfficialGroup } from "../src/demandFlowTypes.ts";
import type { FlowCandidates, FlowItems, NumberedUnit } from "../src/demandFlowWork.ts";
import { UNIT_RULES, type SourceUnits } from "../src/demandUnits.ts";
import { addDays } from "../src/kst.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import { FAKE, GOOD_TEXT, TARGET, flowOf, repeat } from "./flowFixtures.ts";

// 9.97단계 4.2-2~3(S6~S8, S12): 흐름 파일 검사, 근거 수준, 같은 흐름, 3건 자르기. 데이터는 모두 지어낸 값이다

after(cleanupTemp);

describe("4.2-2 글 칸의 수", () => {
  test("아라비아·한자 숫자, 퍼센트, 한글 수사로 된 수량(조사가 붙어도)을 잡는다", () => {
    for (const t of ["가격이 3배 올랐다", "２곳", "열에 아홉은 50%", "百 건", "세 배로 늘었다", "두 곳에서 함께", "열 건이 넘는", "세 배", "네 가지", "한 곳에서도", "수천 건이 들어왔다", "수십 년 만에", "두곳에서", "다섯명이", "삼 배로 늘었다", "이십 건이 넘는", "오십건", "백만 명", "만 원이 넘는", "이천만원"]) assert.ok(hasNumber(t), t);
  });

  test("수가 아닌 일반 낱말은 잡지 않는다", () => {
    for (const t of ["세계 경제", "두려움이 커졌다", "열다", "열어 둔 자리", "한국 사회", "이 개발 도구", "이 건물", "한때 많았다", "세대 차이", "세종 시", "사건 이후", "이건 좋다", "일명 별칭", "만원 버스", "조원 모집", "구명 조끼", "천천히 늘었다", "만들다", "일부 지역", "이번 주", "두개골", "네가 본 것", "한 주제를 다룬다", "억지로", "오만한 태도"]) assert.ok(!hasNumber(t), t);
  });
});

// ---- 지어낸 후보 ----

/** 지어낸 단위의 규모는 하한(UNIT_RULES)에 맞춰 둔다. 규칙 값이 바뀌어도 테스트의 뜻이 같게 */
const FLOORS: Record<string, number> = { wikimedia: UNIT_RULES.wikimedia.floor, dart: UNIT_RULES.dart.floor, sec: UNIT_RULES["sec-formd"].floor, ftc1372: UNIT_RULES["ftc-1372"].floor, acrc: UNIT_RULES["acrc-qna"].floor };
const DF = FLOORS.dart!;
const SOURCE: Record<string, string> = { wikimedia: "wikimedia:en", dart: "dart:list", sec: "sec:formd", ftc1372: "ftc1372:consult", acrc: "acrc:qna", assembly: "assembly:received" };
const WIN = { recentFrom: "2026-10-27", recentTo: "2026-11-02", baseFrom: "2026-09-29", baseTo: "2026-10-26", recentDays: 7, baseDays: 28 };

function unit(n: number, group: OfficialGroup, o: Partial<NumberedUnit> & { times?: number } = {}): NumberedUnit {
  const times = o.times ?? 3;
  const recent = o.recent ?? FLOORS[group]! * times;
  return { n, key: `${SOURCE[group]}:k${n}`, source: SOURCE[group]!, group, name: `가짜단위${n}`, recent, base: 1, isNew: false, recentDaily: repeat(7, Math.round(recent / 7)), baseDailyMean: recent / 70, material: [], window: WIN, ...o };
}

const LONG_MATERIAL = "주민들은 동네 놀이터 시설이 낡아서 아이들이 다치지 않을까 매일 걱정하며 빠른 보수를 요청한다";
const RECENT_ID = "2026-10-30-1";

function candidates(): FlowCandidates {
  return {
    target: TARGET,
    units: [unit(1, "wikimedia", { name: FAKE.wiki.replaceAll("_", " "), material: [FAKE.wiki] }), unit(2, "dart", { name: FAKE.dart, material: [FAKE.corp] }), unit(3, "sec", { name: FAKE.sec }), unit(4, "ftc1372", { name: FAKE.ftc }), unit(5, "acrc", { name: null, material: [LONG_MATERIAL] })],
    aux: [{ n: 1, source: "google:KR", group: "google", label: "Google Trends KR", names: [FAKE.term] }],
    recent: [{ flowId: RECENT_ID, date: "2026-10-30", field: "software", unitKeys: ["wikimedia:en:k1"] }],
    issues: [{ id: 7, name: "가짜이슈이름", major: "IT·AI", minor: "AI 모델·연구" }],
    groups: [],
    bytes: 0,
  };
}

const O = { home: "/Users/fake-home", secrets: ["fake-secret-value-123"] };
const read = (data: unknown): FlowItems => ({ state: "read", text: JSON.stringify(data), data });
const file = (flows: unknown[], o: Record<string, unknown> = {}) => ({ targetDate: TARGET, flows, excluded: [], ...o });
const check = (data: unknown) => checkFlowFile(candidates(), read(data), O);

/** 거부되고, 위반 문구가 기대와 맞고, 위반 출력에 받은 글과 넣은 글이 없다 */
function rejects(data: unknown, why: RegExp, planted: string[] = []): void {
  const r = check(data);
  assert.equal(r.ok, false, `통과했다: ${why}`);
  if (r.ok) return;
  const lines = r.violations.map((v) => `${v.where}: ${v.why}`);
  assert.ok(lines.some((l) => why.test(l)), `${why} 없음: ${lines.join(" / ")}`);
  const out = JSON.stringify(r.violations);
  for (const t of [...Object.values(FAKE), LONG_MATERIAL, ...planted]) assert.ok(!out.includes(t), `위반 출력에 글 "${t}"가 있다`);
}

const withText = (o: Record<string, unknown>) => file([flowOf([1, 2], o)]);

describe("4.2-2 흐름 파일 검사", () => {
  test("맞는 파일은 통과하고 칸이 정리되며 제외 칸은 단위 키로만 남는다", () => {
    const r = check(file([flowOf([1, 2], { aux: [1], issue: 7, continues: RECENT_ID })], { excluded: [5] }));
    assert.ok(r.ok, JSON.stringify(!r.ok && r.violations));
    if (!r.ok) return;
    assert.equal(r.flows.length, 1);
    const f = r.flows[0]!;
    assert.deepEqual([f.category, f.field, f.texts, f.units.map((u) => u.n), f.aux, f.issue, f.continues], ["interest", "software", GOOD_TEXT, [1, 2], ["Google Trends KR"], 7, RECENT_ID]);
    assert.deepEqual(r.excludedKeys, ["acrc:qna:k5"]);
    assert.ok(check(file([])).ok, "0건도 통과한다");
  });

  test("파일 단위: 없음, JSON 아님, 형식, 알 수 없는 칸, 대상 날짜, 7건 이상, 제외 칸의 없는 번호", () => {
    const none = checkFlowFile(candidates(), { state: "none" }, O);
    assert.ok(!none.ok && none.violations.some((v) => v.why === "없다"));
    const broken = checkFlowFile(candidates(), { state: "broken", text: `{${FAKE.wiki}` }, O);
    assert.ok(!broken.ok && broken.violations.some((v) => v.why === "JSON이 아니다") && !JSON.stringify(broken.violations).includes(FAKE.wiki));
    rejects([], /흐름 파일/);
    rejects(file([], { extra: FAKE.term }), /흐름 파일: 알 수 없는 칸이다/);
    rejects(file([], { targetDate: "2026-11-01" }), /대상 날짜와 다르다/);
    rejects({ targetDate: TARGET, flows: "x" }, /flows/);
    rejects(file(Array.from({ length: 7 }, () => flowOf([1, 2]))), /7건이다\(6건 이하여야 한다\)/);
    assert.ok(check(file([flowOf([1, 2]), flowOf([3, 4], { category: "money" })])).ok);
    rejects(file([], { excluded: [99] }), /excluded: 없는 단위 번호다/);
    rejects(file([], { excluded: ["1"] }), /excluded: 없는 단위 번호다/);
  });

  test("흐름 단위: 형식·칸 이름, 기계 칸, 빈 칸, 칸별 상한", () => {
    rejects(file(["문자열 흐름"]), /흐름 1/);
    rejects(withText({ extra: "x" }), /흐름 1: 알 수 없는 칸이다/);
    rejects(withText({ level: "strong" }), /흐름 1 level: 기계가 채우는 칸은 쓰지 않는다/);
    rejects(withText({ values: [1] }), /기계가 채우는 칸/);
    for (const k of ["title", "summary", "reason"]) rejects(withText({ [k]: "  " }), /비어 있으면 안 된다/);
    rejects(withText({ title: "가".repeat(61) }), /제목: 61자다\(60자 이하여야 한다\)/);
    rejects(withText({ summary: "가".repeat(201) }), /요지: 201자다\(200자 이하여야 한다\)/);
    rejects(withText({ reason: "가".repeat(101) }), /잇는 이유: 101자다\(100자 이하여야 한다\)/);
    assert.ok(check(withText({ title: "가".repeat(60), summary: "가".repeat(200), reason: "가".repeat(100) })).ok, "상한 그대로는 된다");
  });

  test("글 칸의 수(이름 속 숫자 포함)·주소·메일·@계정·공개 검사", () => {
    for (const t of ["관심이 3배 올랐다", "모델5 문서에 대한 관심", "관심이 두 곳에서 함께 올랐다", "열 건이 넘게 늘었다", "관심이 百 배"]) rejects(withText({ title: t }), /제목: 글 칸에 수를 쓰지 않는다/, [t]);
    rejects(withText({ summary: "자세한 것은 fake-site.com 에서 본다" }), /요지: 주소를 넣지 않는다/);
    rejects(withText({ summary: "문의는 fake.person@example.com 로 한다" }), /요지: 메일 주소를 넣지 않는다/);
    rejects(withText({ reason: "가짜 계정 @fakeaccountqz 이 알렸다" }), /잇는 이유: `@계정` 모양을 넣지 않는다/);
    rejects(withText({ summary: "가짜 fake-secret-value-123 값이 보인다" }), /요지: 키 값이 들어 있음/, ["fake-secret-value-123"]);
    rejects(withText({ summary: "가짜 경로 /Users/fake-home/notes 가 보인다" }), /요지: 홈 폴더 절대 경로/, ["/Users/fake-home"]);
  });

  test("단위·묶음·분야·갈래·보조 근거·관련 이슈", () => {
    rejects(file([flowOf([1, 99])]), /흐름 1 units: 없는 단위 번호다/);
    rejects(file([flowOf([1], { units: [1, "2"] })]), /없는 단위 번호다/);
    rejects(file([flowOf([1, 1, 2])]), /같은 번호를 두 번 썼다/);
    rejects(file([flowOf([1, 2]), flowOf([2, 3], { category: "money" })]), /흐름 2 units: 다른 흐름이 쓴 번호다/);
    rejects(file([flowOf([1, 2])], { excluded: [2] }), /제외 칸에 적은 번호다/);
    rejects(file([flowOf([1])]), /흐름 1 units: 공식 묶음이 하나뿐인데 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 없다/);
    rejects(file([flowOf([2, 3], { category: "money" }), flowOf([1], { aux: [1] })]), /흐름 2 units: 공식 묶음이 하나뿐인데 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 없다/, ["보조 근거는 묶음 수에 세지 않는다"]);
    rejects(withText({ field: "없는분야" }), /흐름 1 field: 분야 목록 밖이다/);
    rejects(withText({ category: "other" }), /흐름 1 category: 갈래 목록 밖이다/);
    rejects(file([flowOf([1, 4], { category: "money" })]), /흐름 1 category: 근거 묶음과 맞지 않는 갈래다/);
    assert.ok(check(file([flowOf([1, 4], { category: "complaint" })])).ok, "1372는 불만·요구다");
    rejects(withText({ aux: [9] }), /흐름 1 aux: 없는 보조 근거 번호다/);
    rejects(withText({ issue: 99 }), /흐름 1 issue: 관련 이슈 후보에 없다/);
  });

  test("이어짐: 없는 흐름 id, 기계가 겹침을 찾지 못한 이어짐(분야 다름, 단위 겹침 없음)", () => {
    rejects(withText({ continues: "2026-10-01-9" }), /흐름 1 continues: 없는 흐름 id다/);
    rejects(file([flowOf([2, 3], { category: "money", continues: RECENT_ID })]), /흐름 1 continues: 기계가 겹침을 찾지 못한 이어짐이다/);
    rejects(withText({ field: "finance", continues: RECENT_ID }), /기계가 겹침을 찾지 못한 이어짐이다/);
  });

  test("재료 12단어 옮김, 금지어, 15단어 이상 인용 — 위반 출력에 글이 없다", () => {
    const copiedText = LONG_MATERIAL.split(" ").slice(0, 12).join(" ");
    rejects(withText({ summary: copiedText }), /요지: 재료 문장을 12단어 이상 그대로 옮겼다/, [copiedText]);
    assert.ok(check(withText({ summary: LONG_MATERIAL.split(" ").slice(0, 11).join(" ") })).ok, "11단어는 된다");
    for (const w of BANNED_WORDS) rejects(withText({ title: `관심이 ${w}` }), /제목: 단정·과장어를 쓰지 않는다/);
    rejects(withText({ summary: "여기에 사업기회가 보인다" }), /단정·과장어/);
    const quote = "\"하나의 말 그리고 다른 말 또 다른 말 계속 이어지는 말 끝없이 이어지는 긴 말이다\"";
    rejects(withText({ summary: `사람들은 ${quote} 고 했다` }), /요지: 직접 인용이 15단어 이상이다/, ["하나의 말 그리고", "끝없이"]);
  });
});

// ---- 근거 수준(S6) ----

describe("4.2-3 근거 수준(S6)", () => {
  test("두 묶음이 각각 오르면 중, 한 곳이 하한의 두 배 미만이면 약", () => {
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart")]), "medium");
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart", { recent: DF * 2 - 1 })]), "weak");
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart", { recent: DF * 2 })]), "medium", "두 배 그대로는 약이 아니다");
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart", { recent: DF * 1.2 }), unit(3, "dart", { recent: DF * 1.2 })]), "medium", "두 배 미만은 소스마다 오른 단위 합계로 본다");
  });

  test("세 묶음이면 강이고, 약 조건이 함께 맞으면 약이다(약 → 강 → 중)", () => {
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart"), unit(3, "sec")]), "strong");
    assert.equal(flowLevel([unit(1, "wikimedia"), unit(2, "dart"), unit(3, "sec", { recent: FLOORS.sec! * 1.5 })]), "weak");
  });

  test("두 묶음이 각각 오른 단위 둘 이상이고 최근 7일 중 4일 이상 앞 28일 일평균보다 높으면 강(3일이면 중, 자료 없음 날은 세지 않는다)", () => {
    const w = (n: number) => unit(n, "wikimedia", { recentDaily: repeat(7, 50_000), baseDailyMean: 10_000, recent: 350_000 });
    const d = (n: number, daily: (number | null)[]) => unit(n, "dart", { recentDaily: daily, baseDailyMean: 1, recent: DF * 3 });
    const four = [5, 5, 5, 5, 1, 1, 1];
    const three = [5, 5, 5, 1, 1, 1, 1];
    assert.equal(flowLevel([w(1), w(2), d(3, four), d(4, four)]), "strong");
    assert.equal(flowLevel([w(1), w(2), d(3, three), d(4, three)]), "medium");
    assert.equal(flowLevel([w(1), d(3, four), d(4, four)]), "medium", "한 묶음의 오른 단위가 하나면 중");
    const gap = [null, null, 5, 5, 5, 1, 1];
    assert.equal(flowLevel([w(1), w(2), d(3, gap), d(4, gap)]), "medium", "값이 없는 날은 높은 날로 세지 않는다");
    assert.equal(flowLevel([w(1), w(2), d(3, [5, 5, 5, 5, 5, 1, 1]), d(4, [null, 5, 5, 5, 5, 1, 1])]), "strong", "값이 없는 날만 빼고 센다");
    assert.equal(flowLevel([w(1), w(2), d(3, four), d(4, [null, 5, 5, 5, 1, 1, 1])]), "medium", "묶음 안 한 단위라도 값이 없는 날은 그 날을 세지 않는다(0으로 채우지 않는다)");
  });
});

// ---- 적용 계획(4.2-3, S8) ----

const checked = (units: NumberedUnit[], o: Partial<CheckedFlow> = {}): CheckedFlow => ({ category: "interest", field: "software", texts: { ...GOOD_TEXT }, units, aux: [], issue: null, continues: null, ...o });
const recount = (units: NumberedUnit[]): SourceUnits[] => [{ source: "all", group: "wikimedia", kind: "wikimedia", label: "x", state: "ok", window: WIN, unitCount: units.length, rising: units, risingAll: units.length }];

describe("4.2-3 기계가 채우는 칸과 3건 자르기", () => {
  test("다시 센 값이 다르면 그 흐름을 버리고, 같으면 기계 칸을 채운다", () => {
    const a = [unit(1, "wikimedia"), unit(2, "dart")];
    const p = planFlows([checked(a)], recount([a[0]!, { ...a[1]!, recent: a[1]!.recent + 1 }]), [], []);
    assert.deepEqual([p.flows.length, p.recognized, p.dropped], [0, 0, { "다시 센 값이 다름": 1 }]);
    const ok = planFlows([checked(a)], recount(a), [], []);
    assert.equal(ok.flows.length, 1);
    const f = ok.flows[0]!;
    assert.deepEqual([f.flowId, f.level, f.continues], ["", "medium", null]);
    assert.deepEqual(f.units.map((u) => [u.group, u.unitKey, u.unitName, u.recent, u.base, u.recentFrom, u.recentTo, u.baseFrom, u.baseTo]), [a[1]!, a[0]!].map((u) => [u.group, u.key, u.name, u.recent, u.base, WIN.recentFrom, WIN.recentTo, WIN.baseFrom, WIN.baseTo]));
    // 근거 줄은 묶음 목록 순서(국회, 권익위, 1372, DART, SEC, Wikimedia)다
    const moved = planFlows([checked(a)], recount([a[0]!, { ...a[1]!, window: { ...WIN, recentTo: "2026-11-01" } }]), [], []);
    assert.equal(moved.flows.length, 0, "창 끝이 달라도 버린다");
  });

  test("보조 근거는 수준을 올리지 않는다", () => {
    const a = [unit(1, "wikimedia"), unit(2, "dart")];
    const p = planFlows([checked(a, { aux: ["Google Trends KR", "Mastodon fake.example"] })], recount(a), [], []);
    assert.equal(p.flows[0]!.level, "medium");
    assert.deepEqual(p.flows[0]!.aux, ["Google Trends KR", "Mastodon fake.example"]);
  });

  test("5건이 인정되면 수준 순(같으면 쓴 순서)으로 3건만 남기고 인정된 건수는 자르기 전 수다", () => {
    const u = (n: number, g: OfficialGroup, o: Partial<NumberedUnit> = {}) => unit(n, g, o);
    const medium0 = [u(1, "wikimedia"), u(2, "dart")];
    const weak1 = [u(3, "wikimedia"), u(4, "dart", { recent: DF + 1 })];
    const strong2 = [u(5, "wikimedia"), u(6, "dart"), u(7, "sec")];
    const medium3 = [u(8, "wikimedia"), u(9, "sec")];
    const strong4 = [u(10, "dart"), u(11, "sec"), u(12, "ftc1372")];
    const all = [medium0, weak1, strong2, medium3, strong4];
    const p = planFlows(all.map((x, i) => checked(x, { texts: { ...GOOD_TEXT, title: `가짜제목${"가나다라마"[i]}` } })), recount(all.flat()), [], []);
    assert.equal(p.recognized, 5);
    assert.deepEqual(p.flows.map((f) => [f.title, f.level]), [["가짜제목다", "strong"], ["가짜제목마", "strong"], ["가짜제목가", "medium"]]);
    assert.deepEqual(p.dropped, { "3건 밖": 2 });
  });
});

describe("4.2-3 같은 흐름(S8)", () => {
  function prevFlow(units: NumberedUnit[], level: Flow["level"], o: Partial<Flow> = {}): Flow {
    return { id: 41, date: "2026-10-30", position: 1, itemKey: "demand-1", flowId: RECENT_ID, category: "interest", field: "software", ...GOOD_TEXT, level, aux: [], issue: null, continues: null, units: units.map((x) => ({ group: x.group, source: x.source, unitKey: x.key, unitName: x.name, recent: x.recent, base: x.base, isNew: false, recentFrom: WIN.recentFrom, recentTo: WIN.recentTo, baseFrom: WIN.baseFrom, baseTo: WIN.baseTo, recentDays: 7, baseDays: 28 })), ...o };
  }
  const refOf = (f: Flow) => ({ flowId: f.flowId, date: f.date, field: f.field, unitKeys: f.units.map((u) => u.unitKey) });

  test("14일 안 같은 흐름(분야 같고 단위 겹침)이 강해지지 않으면 싣지 않는다(AI가 이어짐을 적지 않아도)", () => {
    const a = [unit(1, "wikimedia"), unit(2, "dart")];
    const prev = prevFlow([a[0]!, unit(9, "dart")], "medium");
    const p = planFlows([checked(a)], recount(a), [prev], [refOf(prev)]);
    assert.deepEqual([p.flows.length, p.recognized, p.dropped], [0, 0, { "같은 흐름이 강해지지 않음": 1 }]);
    const other = planFlows([checked(a, { field: "finance" })], recount(a), [prev], [refOf(prev)]);
    assert.equal(other.flows[0]?.flowId, "", "분야가 다르면 새 흐름이다");
  });

  test("새 묶음이 더해지거나 수준이 오르면 같은 id로 싣고 앞 항목을 가리킨다", () => {
    const a = [unit(1, "wikimedia"), unit(2, "dart"), unit(3, "sec")];
    const prev = prevFlow([a[0]!, a[1]!], "medium");
    const added = planFlows([checked(a)], recount(a), [prev], [refOf(prev)]);
    assert.deepEqual(added.flows.map((f) => [f.flowId, f.continues, f.level]), [[RECENT_ID, 41, "strong"]]);
    const b = [unit(1, "wikimedia"), unit(2, "dart")];
    const weakPrev = prevFlow(b, "weak");
    const up = planFlows([checked(b)], recount(b), [weakPrev], [refOf(weakPrev)]);
    assert.deepEqual(up.flows.map((f) => [f.flowId, f.continues, f.level]), [[RECENT_ID, 41, "medium"]]);
  });

  test("여러 흐름과 겹치면 가장 최근에 실린 흐름을 잇는다", () => {
    const a = [unit(1, "wikimedia"), unit(2, "dart"), unit(3, "sec")];
    const older = prevFlow([a[0]!, unit(9, "dart")], "medium", { id: 30, date: "2026-10-25", flowId: "2026-10-25-1" });
    const newer = prevFlow([a[1]!, unit(8, "wikimedia")], "medium", { id: 40, date: "2026-11-01", flowId: "2026-11-01-2" });
    const p = planFlows([checked(a)], recount(a), [newer, older], [refOf(older), refOf(newer)]);
    assert.deepEqual(p.flows.map((f) => [f.flowId, f.continues]), [["2026-11-01-2", 40]]);
  });

  test("본 DB에 실린 흐름: 14일째까지는 같은 흐름이고 15일째에는 새 흐름이다", () => {
    const db = openDb(path.join(tempDir("tidwyn-same-"), "tidwyn.db"));
    const a = [unit(1, "wikimedia"), unit(2, "dart")];
    const stored = (): NewFlow => ({ flowId: "", category: "interest", field: "software", ...GOOD_TEXT, level: "medium", aux: [], issue: null, continues: null, units: prevFlow(a, "medium").units });
    const plan = () => {
      const items = recentFlows(db, TARGET);
      return planFlows([checked(a)], recount(a), items, items.map(refOf));
    };
    saveFlows(db, addDays(TARGET, -14), [stored()], { date: addDays(TARGET, -14), status: "checked", missing: [] });
    assert.equal(plan().flows[0]?.flowId, "", "15일째(대상 날짜를 1일째로)는 새 흐름");
    saveFlows(db, addDays(TARGET, -13), [stored()], { date: addDays(TARGET, -13), status: "checked", missing: [] });
    assert.deepEqual(plan().dropped, { "같은 흐름이 강해지지 않음": 1 }, "14일째는 같은 흐름");
    db.close();
  });
});

describe("코드 리뷰 지적 재현(9.97)", () => {
  test("4.2-2 '그 일 만으로도'처럼 수가 아닌 띄어 쓴 낱말은 잡지 않는다", () => {
    for (const t of ["그 일 만으로도", "이 일 만은"]) assert.ok(!hasNumber(t), t);
    assert.ok(hasNumber("삼 만 명"), "수사 뒤 만 다음 단위는 잡는다");
  });

  test("4.2-3 근거 수준의 4일 조건은 소스마다 창 끝이 달라도 같은 날끼리 센다", () => {
    const w = (n: number) => unit(n, "wikimedia", { recentDaily: repeat(7, 50_000), baseDailyMean: 10_000, recent: 350_000 });
    const shifted = { ...WIN, recentFrom: "2026-10-26", recentTo: "2026-11-01" };
    // 두 단위가 모두 5인 날만 일평균 합(6)보다 높다. 같은 날로 맞추면 10-27~10-30의 4일, 인덱스로만 맞추면 3일이다
    const a = unit(3, "acrc", { recentDaily: [5, 5, 5, 5, 1, 1, 1], baseDailyMean: 3, recent: 30 });
    const b = unit(4, "acrc", { source: "acrc:proposal", key: "acrc:proposal:k4", window: shifted, recentDaily: [1, 5, 5, 5, 5, 1, 1], baseDailyMean: 3, recent: 30 });
    assert.equal(flowLevel([w(1), w(2), a, b]), "strong");
  });

  test("4.2-3 같은 날 두 흐름이 같은 앞 흐름과 겹치면 앞선 하나만 그 흐름을 잇는다", () => {
    const x1 = unit(1, "wikimedia");
    const x2 = unit(2, "dart");
    const prev: Flow = { id: 41, date: "2026-10-30", position: 1, itemKey: "demand-1", flowId: RECENT_ID, category: "interest", field: "software", ...GOOD_TEXT, level: "medium", aux: [], issue: null, continues: null, units: [x1, x2].map((x) => ({ group: x.group, source: x.source, unitKey: x.key, unitName: x.name, recent: x.recent, base: x.base, isNew: false, ...WIN })) };
    const a = [x1, unit(3, "sec")];
    const b = [x2, unit(4, "ftc1372")];
    const p = planFlows([checked(a), checked(b)], recount([...a, ...b]), [prev], [{ flowId: RECENT_ID, date: prev.date, field: "software", unitKeys: [x1.key, x2.key] }]);
    assert.deepEqual(p.flows.map((f) => [f.flowId, f.continues]), [[RECENT_ID, 41]]);
    assert.equal(p.dropped["같은 날 같은 흐름"], 1);
  });

  test("4.2-3 같은 앞 흐름을 이을 흐름이 둘이면 근거 수준이 높은 쪽이 잇는다(흐름 파일 순서와 상관없이)", () => {
    const w = (n: number) => unit(n, "wikimedia", { recentDaily: repeat(7, 50_000), baseDailyMean: 10_000, recent: 350_000 });
    const shifted = { ...WIN, recentFrom: "2026-10-26", recentTo: "2026-11-01" };
    const strong = [w(1), w(2), unit(3, "acrc", { recentDaily: [5, 5, 5, 5, 1, 1, 1], baseDailyMean: 3, recent: 30 }), unit(4, "acrc", { source: "acrc:proposal", key: "acrc:proposal:k4", window: shifted, recentDaily: [1, 5, 5, 5, 5, 1, 1], baseDailyMean: 3, recent: 30 })];
    const medium = [unit(5, "dart"), unit(6, "sec")];
    assert.equal(flowLevel(strong), "strong");
    assert.notEqual(flowLevel(medium), "strong");
    const prevUnits = [strong[0]!, medium[0]!];
    const prev: Flow = { id: 42, date: "2026-10-30", position: 1, itemKey: "demand-1", flowId: RECENT_ID, category: "interest", field: "software", ...GOOD_TEXT, level: "weak", aux: [], issue: null, continues: null, units: prevUnits.map((x) => ({ group: x.group, source: x.source, unitKey: x.key, unitName: x.name, recent: x.recent, base: x.base, isNew: false, ...WIN })) };
    const p = planFlows([checked(medium), checked(strong)], recount([...medium, ...strong]), [prev], [{ flowId: RECENT_ID, date: prev.date, field: "software", unitKeys: prevUnits.map((x) => x.key) }]);
    assert.deepEqual(p.flows.map((f) => [f.level, f.flowId, f.continues]), [["strong", RECENT_ID, 42]]);
    assert.equal(p.dropped["같은 날 같은 흐름"], 1);
  });
});
