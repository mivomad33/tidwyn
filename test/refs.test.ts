import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, exportBackup, readBackupDir, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { kstDate } from "../src/kst.ts";
import { applyRefPlan, checkRefFile, firstStoryOf, refCandidates, renderRefSearch, renderRefWork } from "../src/extract.ts";
import { applyMerges } from "../src/merge.ts";
import { FIRST_LINKED_KEY, MERGE_CHECKED_KEY, createIssue, getIssue, getMeta, inTransaction, linkStory, setMeta, storiesOfDate } from "../src/issues.ts";
import { addRefNoMerge, applyRefMerges, checkRefMerges, deleteRef, listRefMerges, refMergeCandidates, unmergeRef, type RefMergeEntry } from "../src/refMerge.ts";
import {
  NAME_KEY_FILE,
  createEntity,
  createTerm,
  ensureNameKey,
  entitiesOfStory,
  extractableDates,
  getEntity,
  getTerm,
  isExtracted,
  linkEntity,
  nameKeyPath,
  readNameKey,
  storiesOfRef,
  termsOfStory,
  type NameKey,
} from "../src/refs.ts";
import { mergeWorkFile, readRun, refWorkFile, workFile, writeRun } from "../src/run.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { Checker } from "../src/validate.ts";
import { loadBrief, recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 4단계 인물·기관·국가와 용어(4.1~4.5). 이름은 모두 지어낸 것이다.

const TODAY = "2026-10-29";
const OVERLAP = /같다|겹/;
const DATES = ["2026-10-26", "2026-10-27", "2026-10-28"];

/** 본문에 지어낸 대상·용어가 나오는 예시 브리프 */
function refBrief(date: string) {
  const b = sampleBrief(date);
  const kr = b.sections[0]!.topStories[0]!;
  kr.summary = "가짜국 재무장관이 기준금리를 동결했다.";
  kr.background = "가짜 중앙은행은 지난해 양적완화를 끝냈다.";
  const world = b.sections[1]!.topStories[0]!;
  world.summary = "가짜전자가 새 칩을 공개했다.";
  return b;
}

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(refBrief(date), date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

function refDb(dates = DATES, file?: string): { db: DatabaseSync; dir: string } {
  const dir = file ? path.dirname(file) : tempDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(file ?? path.join(dir, "tidwyn.db"));
  recordFirstCollectionDate(db, dates[0]!);
  for (const d of dates) addBrief(db, d);
  return { db, dir };
}

type StoryEntry = { entities?: (number | string)[]; terms?: { term: number | string; surface?: string | null }[] };

/** 그날 모든 뉴스가 든 뽑기 파일. stories에 준 뉴스만 채운다 */
function refFile(db: DatabaseSync, date: string, stories: Record<string, StoryEntry> = {}, extra: Record<string, unknown> = {}) {
  return {
    date,
    newEntities: [],
    newTerms: [],
    stories: storiesOfDate(db, date).map((s) => ({ story: s.key, entities: stories[s.key]?.entities ?? [], terms: stories[s.key]?.terms ?? [] })),
    ...extra,
  };
}

function applyFile(db: DatabaseSync, data: unknown, date: string, key: NameKey | null = null) {
  const r = checkRefFile(db, data, date, key);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  return applyRefPlan(db, r.plan, TODAY);
}

function rejects(db: DatabaseSync, data: unknown, date: string, why: RegExp, key: NameKey | null = null): void {
  const before = dumpDb(db);
  const r = checkRefFile(db, data, date, key);
  assert.equal(r.ok, false, `거부되어야 한다: ${why}`);
  assert.ok(
    !r.ok && r.violations.some((v) => why.test(`${v.where}: ${v.why}`)),
    `위반 ${why}이 없다: ${!r.ok ? JSON.stringify(r.violations) : ""}`,
  );
  assert.deepEqual(dumpDb(db), before, "DB가 바뀌지 않는다");
}

/** SQL로 읽은 모든 테이블의 모든 행 */
function dumpDb(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()]));
}

function storyId(db: DatabaseSync, date: string, key: string): number {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date} ${key}`);
  return s.id;
}

function mergeRefs(db: DatabaseSync, merges: RefMergeEntry[]): number[] {
  return inTransaction(db, () => applyRefMerges(db, merges, TODAY));
}

const KIM = { key: "kim", kind: "인물", name: "김가짜", aliases: ["Kim Gajja"], description: "가짜국 재무장관" };
const QE = { key: "qe", name: "양적완화", aliases: ["QE"], description: "중앙은행이 시장에서 채권을 사들여 돈을 푸는 정책이다. 금리를 더 내리기 어려울 때 쓴다." };

describe("4단계 4.1 데이터와 저장", () => {
  test("대상을 여러 날짜 뉴스에 연결하면 항목과 처음·최근 등장일·뉴스 수가 연결과 맞고, 합치거나 지운 뒤 새 식별자는 앞의 것과 다르다", () => {
    const { db, dir } = refDb();
    applyFile(db, refFile(db, "2026-10-27", { "한국-1": { entities: ["kim"] } }, { newEntities: [KIM] }), "2026-10-27");
    applyFile(db, refFile(db, "2026-10-26", { "한국-1": { entities: [1] }, "한국-s1": { entities: [1] } }), "2026-10-26");
    const e = getEntity(db, 1)!;
    assert.equal(e.name, "김가짜");
    assert.deepEqual(e.aliases, ["Kim Gajja"]);
    assert.equal(e.kind, "인물");
    assert.equal(e.description, "가짜국 재무장관");
    assert.equal(e.describedOn, TODAY);
    assert.equal(e.describedStory, "2026-10-27/한국-1");
    assert.equal(e.firstDate, "2026-10-26");
    assert.equal(e.latestDate, "2026-10-27");
    assert.equal(e.count, 3);
    assert.equal(storiesOfRef(db, "entity", 1).length, 3);

    const a = createEntity(db, { kind: "기관", name: "가짜 연구소", aliases: [], description: "가짜국 연구 기관", describedOn: null, describedStory: null });
    const b = createEntity(db, { kind: "기관", name: "가짜연구원", aliases: [], description: "가짜국 연구 기관", describedOn: null, describedStory: null });
    mergeRefs(db, [{ item: "entity", survivor: a, absorbed: b, reason: "같은 기관" }]);
    assert.ok(deleteRef(db, "entity", a, ensureNameKey(dir), TODAY).ok);
    const c = createEntity(db, { kind: "국가", name: "가짜국", aliases: [], description: "가상의 나라", describedOn: null, describedStory: null });
    assert.ok(c > b, `새 식별자 ${c}는 지운·흡수된 ${a}, ${b}보다 크다`);
    const t1 = createTerm(db, { name: "가짜 용어", aliases: [], description: "지어낸 용어다." });
    assert.ok(deleteRef(db, "term", t1, ensureNameKey(dir), TODAY).ok);
    assert.ok(createTerm(db, { name: "다른 용어", aliases: [], description: "지어낸 용어다." }) > t1);
    db.close();
  });

  test("용어의 처음 나온 뉴스는 가장 이른 뉴스이고, 더 이른 날짜를 나중에 뽑아도 바뀐다", () => {
    const { db } = refDb();
    applyFile(db, refFile(db, "2026-10-28", { "한국-1": { terms: [{ term: "qe", surface: "양적완화" }] } }, { newTerms: [QE] }), "2026-10-28");
    assert.equal(firstStoryOf(db, "term", 1)?.date, "2026-10-28");
    applyFile(db, refFile(db, "2026-10-27", { "한국-1": { terms: [{ term: 1, surface: null }] } }), "2026-10-27");
    const first = firstStoryOf(db, "term", 1)!;
    assert.deepEqual([first.date, first.key], ["2026-10-27", "한국-1"]);
    const t = getTerm(db, 1)!;
    assert.deepEqual([t.name, t.aliases, t.description, t.firstDate, t.count], ["양적완화", ["QE"], QE.description, "2026-10-27", 2]);
    db.close();
  });

  test("같은 뽑기 파일을 두 번 적용해도 연결은 하나씩이고, 뽑은 것이 없는 날짜도 완료다", () => {
    const { db } = refDb();
    const file = refFile(db, "2026-10-27", { "한국-1": { entities: ["kim"], terms: [{ term: "qe", surface: "양적완화" }] } }, { newEntities: [KIM], newTerms: [QE] });
    const first = applyFile(db, file, "2026-10-27");
    assert.deepEqual(first, { status: "applied", entityLinks: 1, termLinks: 1, newEntities: 1, newTerms: 1, descriptions: 0 });
    const again = checkRefFile(db, file, "2026-10-27", null);
    // 이미 완료한 날짜는 새 이름이 기존 것과 겹쳐 검사가 거부하지만, 적용 단계도 아무것도 하지 않는다
    if (again.ok) assert.deepEqual(applyRefPlan(db, again.plan, TODAY), { status: "nothing" });
    assert.equal(linkEntity(db, storyId(db, "2026-10-27", "한국-1"), 1), false, "같은 연결은 하나만 둔다");
    assert.deepEqual(entitiesOfStory(db, storyId(db, "2026-10-27", "한국-1")), [1]);
    assert.equal(termsOfStory(db, storyId(db, "2026-10-27", "한국-1")).length, 1);
    applyFile(db, refFile(db, "2026-10-28"), "2026-10-28");
    assert.ok(isExtracted(db, "2026-10-28"));
    assert.deepEqual(extractableDates(db), ["2026-10-26"]);
    db.close();
  });

  test("버전 3 DB(브리프, 이슈, 합치기 기록)를 새 코드로 열면 버전 4가 되고, 기존 데이터를 그대로 읽으며 모든 날짜가 뽑기 대상이다", () => {
    const file = path.join(tempDir(), "t.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 3));
    assert.equal(schemaVersion(old), 3);
    recordFirstCollectionDate(old, "2026-10-26");
    addBrief(old, "2026-10-26");
    addBrief(old, "2026-10-27");
    const cat = { major: "경제" as const, minor: "노동·일자리" };
    const i1 = createIssue(old, { name: "가짜 항구 파업", aliases: [], category: cat, summary: "가짜 요약이다." });
    const i2 = createIssue(old, { name: "가짜 항구 파업 장기화", aliases: [], category: cat, summary: "가짜 요약이다." });
    for (const s of storiesOfDate(old, "2026-10-26")) linkStory(old, s.id, s.key === "한국-2" ? i2 : i1, true);
    applyMerges(old, [{ survivor: i1, absorbed: i2, reason: "같은 파업", summary: "가짜 요약이다." }], "2026-10-28");
    const brief = loadBrief(old, "2026-10-26")?.brief;
    old.close();

    const db = openDb(file);
    assert.equal(schemaVersion(db), 4);
    assert.deepEqual(loadBrief(db, "2026-10-26")?.brief, brief);
    assert.equal(getIssue(db, i2)?.mergedInto, i1);
    assert.deepEqual(extractableDates(db), ["2026-10-26", "2026-10-27"]);
    db.close();
  });
});

describe("4단계 4.2-2 후보 목록과 검색", () => {
  test("본문에 이름이 나온 대상과 별칭이 나온 용어가 후보이고, 관계없는 것은 아니며, 대상 3,000개를 넣어도 목록 길이가 그대로다", () => {
    const { db } = refDb();
    const kim = createEntity(db, { kind: "인물", name: "김가짜", aliases: [], description: "가짜국 재무장관", describedOn: null, describedStory: null });
    const ge = createEntity(db, { kind: "기관", name: "Gajja Electronics", aliases: ["가짜전자"], description: "가짜국 전자 회사", describedOn: null, describedStory: null });
    const far = createEntity(db, { kind: "인물", name: "박가상", aliases: [], description: "가상국 총리", describedOn: null, describedStory: null });
    const bank = createEntity(db, { kind: "기관", name: "가짜 중앙은행", aliases: [], description: "가짜국 중앙은행", describedOn: null, describedStory: null });
    const qe = createTerm(db, { name: "Quantitative Easing", aliases: ["양적완화"], description: QE.description });
    const other = createTerm(db, { name: "역레포", aliases: [], description: "지어낸 설명이다." });
    // 이슈를 통해 들어오는 대상: 주 이슈에 이미 연결된 대상
    const issue = createIssue(db, { name: "가짜 금리 이야기", aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: "가짜 요약이다." });
    linkStory(db, storyId(db, "2026-10-27", "한국-1"), issue, true);
    linkStory(db, storyId(db, "2026-10-28", "한국-1"), issue, true);
    linkEntity(db, storyId(db, "2026-10-27", "한국-1"), kim);
    const viaIssue = createEntity(db, { kind: "기관", name: "가짜 재무부", aliases: [], description: "가짜국 정부 부처", describedOn: null, describedStory: null });
    linkEntity(db, storyId(db, "2026-10-27", "한국-1"), viaIssue);

    const c = refCandidates(db, "2026-10-28");
    const ids = c.entities.map((e) => e.id);
    assert.ok(ids.includes(bank), "이름이 본문에 나온 대상");
    assert.ok(ids.includes(ge), "별칭이 본문에 나온 대상");
    assert.ok(ids.includes(viaIssue), "주 이슈에 연결된 대상");
    assert.ok(!ids.includes(far), "관계없는 대상");
    assert.deepEqual(c.terms.map((t) => t.id), [qe]);
    assert.ok(!c.terms.some((t) => t.id === other));
    const lines = renderRefWork(db, "2026-10-28").text.split("\n").length;
    for (let i = 0; i < 3000; i++) createEntity(db, { kind: "인물", name: `가상인물${i}호`, aliases: [], description: "가상 인물", describedOn: null, describedStory: null });
    assert.equal(renderRefWork(db, "2026-10-28").text.split("\n").length, lines);
    assert.match(renderRefWork(db, "2026-10-28").text, /`한국-1` · 한국 · 주요 뉴스 · 주 이슈: 가짜 금리 이야기/);
    db.close();
  });

  test("검색은 별칭으로 대상을 찾고, 지운 이름(띄어쓰기만 다른 표기 포함)으로 찾으면 \"지운 이름과 같음\"이 나온다", () => {
    const { db, dir } = refDb();
    createEntity(db, { kind: "기관", name: "가짜 중앙은행", aliases: ["Gajja Central Bank"], description: "가짜국 중앙은행", describedOn: null, describedStory: null });
    const del = createEntity(db, { kind: "인물", name: "이가짜", aliases: ["Lee Gajja"], description: "가짜 동네 주민", describedOn: null, describedStory: null });
    const key = ensureNameKey(dir);
    assert.match(renderRefSearch(db, "Central", key), /대상 1/);
    assert.ok(deleteRef(db, "entity", del, key, TODAY).ok);
    for (const q of ["이가짜", "이 가짜", "lee gajja"]) assert.match(renderRefSearch(db, q, key), /지운 이름과 같음/, q);
    assert.doesNotMatch(renderRefSearch(db, "가짜 중앙은행", key), /지운 이름과 같음/);
    db.close();
  });
});

/** 거부 경우를 위한 DB: 대상 1 김가짜(인물), 흡수된 대상, 지운 대상, 단체 7개, 용어 4개 */
function checkDb() {
  const { db, dir } = refDb();
  const key = ensureNameKey(dir);
  applyFile(db, refFile(db, "2026-10-27", { "한국-1": { entities: ["kim"], terms: [{ term: "qe", surface: "양적완화" }] } }, { newEntities: [KIM], newTerms: [QE] }), "2026-10-27", key);
  const org = (name: string) => createEntity(db, { kind: "기관", name, aliases: [], description: "가짜 단체", describedOn: null, describedStory: null });
  const survivor = org("가짜 협회");
  const absorbed = org("가짜협회 본부");
  mergeRefs(db, [{ item: "entity", survivor, absorbed, reason: "같은 단체" }]);
  const deleted = createEntity(db, { kind: "인물", name: "이가짜", aliases: ["Lee Gajja"], description: "가짜 동네 주민", describedOn: null, describedStory: null });
  assert.ok(deleteRef(db, "entity", deleted, key, TODAY).ok);
  const orgs = Array.from({ length: 7 }, (_, i) => org(`가짜단체${"가나다라마바사"[i]}`));
  const terms = Array.from({ length: 4 }, (_, i) => createTerm(db, { name: `가짜용어${i}`, aliases: [], description: "지어낸 용어다." }));
  const termSurvivor = createTerm(db, { name: "가짜지수", aliases: [], description: "지어낸 지수다." });
  const termAbsorbed = createTerm(db, { name: "가짜 지수 값", aliases: [], description: "지어낸 지수다." });
  mergeRefs(db, [{ item: "term", survivor: termSurvivor, absorbed: termAbsorbed, reason: "같은 지수" }]);
  const termDeleted = createTerm(db, { name: "가짜비율", aliases: [], description: "지어낸 비율이다." });
  assert.ok(deleteRef(db, "term", termDeleted, key, TODAY).ok);
  return { db, key, survivor, absorbed, deleted, orgs, terms, termSurvivor, termAbsorbed, termDeleted };
}

describe("4단계 4.2-3 뽑기 파일 검사", () => {
  test("거부 경우를 하나씩 넣은 파일이 거부되고 DB가 바뀌지 않는다", () => {
    const { db, key, survivor, absorbed, deleted, orgs, terms, termSurvivor, termAbsorbed, termDeleted } = checkDb();
    const D = "2026-10-28";
    const f = (stories: Record<string, StoryEntry> = {}, extra: Record<string, unknown> = {}) => refFile(db, D, stories, extra);
    const newEntity = (o: Record<string, unknown>) => f({ "한국-1": { entities: ["n"] } }, { newEntities: [{ key: "n", kind: "인물", name: "최가상", aliases: [], description: "가짜국 외교부 장관", ...o }] });
    const newTerm = (o: Record<string, unknown>) => f({ "한국-1": { terms: [{ term: "t", surface: null }] } }, { newTerms: [{ key: "t", name: "가짜지표", aliases: [], description: "지어낸 지표다.", ...o }] });

    // 뉴스 키
    const extraStory = f();
    extraStory.stories.push({ story: "한국-99", entities: [], terms: [] });
    rejects(db, extraStory, D, /한국-99/);
    const missing = f();
    missing.stories.pop();
    rejects(db, missing, D, /빠졌다/);
    // 수 한도
    rejects(db, f({ "한국-1": { entities: orgs } }), D, /대상이 7개다/);
    rejects(db, f({ "한국-s1": { entities: orgs.slice(0, 4) } }), D, /짧은 소식의 대상이 4개다/);
    rejects(db, f({ "한국-1": { terms: terms.map((t) => ({ term: t })) } }), D, /용어가 4개다/);
    rejects(db, f({ "한국-s1": { terms: [{ term: terms[0]! }] } }), D, /짧은 소식에서는 용어를 뽑지 않는다/);
    // 종류
    rejects(db, newEntity({ kind: "도시" }), D, /종류/);
    // 식별자
    rejects(db, f({ "한국-1": { entities: [999] } }), D, /999/);
    rejects(db, f({ "한국-1": { entities: [absorbed] } }), D, new RegExp(`흡수.*${survivor}`));
    rejects(db, f({ "한국-1": { entities: [deleted] } }), D, /지운/);
    rejects(db, f({ "한국-1": { terms: [{ term: 999 }] } }), D, /999/);
    rejects(db, f({ "한국-1": { terms: [{ term: termAbsorbed }] } }), D, new RegExp(`흡수.*${termSurvivor}`));
    rejects(db, f({ "한국-1": { terms: [{ term: termDeleted }] } }), D, /지운/);
    // 이름 겹침: 기존(띄어쓰기·대소문자만 다른 표기), 기존 별칭, 같은 파일의 새 것끼리, 지운 이름
    rejects(db, newEntity({ name: "김 가짜" }), D, OVERLAP);
    rejects(db, newEntity({ aliases: ["kim gajja"] }), D, OVERLAP);
    rejects(
      db,
      f({ "한국-1": { entities: ["a", "b"] } }, { newEntities: [{ key: "a", kind: "인물", name: "최가상", aliases: [], description: "가짜국 장관" }, { key: "b", kind: "인물", name: "최·가상", aliases: [], description: "가짜국 차관" }] }),
      D,
      OVERLAP,
    );
    rejects(db, newEntity({ name: "이 가짜" }), D, /지운 이름/, key);
    rejects(db, newEntity({ aliases: ["LEE GAJJA"] }), D, /지운 이름/, key);
    rejects(db, newTerm({ name: "양적 완화" }), D, OVERLAP);
    rejects(db, newTerm({ aliases: ["qe"] }), D, OVERLAP);
    // 설명
    rejects(db, newEntity({ description: "" }), D, /설명/);
    rejects(db, newEntity({ description: "가짜국 장관이다. 전 대사다." }), D, /한 문장/);
    rejects(db, newEntity({ description: "가".repeat(61) }), D, /60자/);
    rejects(db, newTerm({ description: "" }), D, /설명/);
    rejects(db, newTerm({ description: "하나다. 둘이다. 셋이다. 넷이다." }), D, /3문장 이하/);
    rejects(db, newTerm({ description: `${"가".repeat(250)}.` }), D, /250자/);
    // 본문 표기
    rejects(db, f({ "한국-1": { terms: [{ term: 1, surface: "양적긴축" }] } }), D, /본문/);
    // 고침: 근거 뉴스가 그 날짜 뉴스가 아님, 그 뉴스에 연결되지 않음, 61자, 새 이름 겹침, 근거 날짜가 이름
    rejects(db, f({ "한국-1": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-77", description: "가짜국 총리" }] }), D, /한국-77/);
    rejects(db, f({ "한국-2": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-1", description: "가짜국 총리" }] }), D, /연결되지 않았다/);
    rejects(db, f({ "한국-1": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-1", description: "가".repeat(61) }] }), D, /60자/);
    rejects(db, f({ "한국-1": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-1", description: "가짜국 총리다. 전 장관이다." }] }), D, /한 문장/);
    rejects(db, f({ "한국-1": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-1", name: "이 가짜" }] }), D, /지운 이름/, key);
    rejects(db, f({ "한국-1": { terms: [{ term: 1 }] } }, { termUpdates: [{ term: 1, story: "한국-1", aliases: ["가짜 용어0"] }] }), D, OVERLAP);
    rejects(db, f({ "한국-1": { terms: [{ term: 1 }] } }, { termUpdates: [{ term: 1, story: "한국-2", aliases: ["양적 완화 정책"] }] }), D, /연결되지 않았다/);
    // 같은 뉴스에 같은 대상·용어가 두 번
    rejects(db, f({ "한국-1": { entities: [1, 1] } }), D, /두 번/);
    rejects(db, f({ "한국-1": { terms: [{ term: 1 }, { term: 1, surface: "양적완화" }] } }), D, /두 번/);
    db.close();
  });

  test("대상 고침의 근거 뉴스 날짜가 마지막으로 고친 근거보다 이르면 거부한다(이름 바꾸기도)", () => {
    const { db } = checkDb();
    const D = "2026-10-26";
    const f = (u: Record<string, unknown>) => refFile(db, D, { "한국-1": { entities: [1] } }, { entityUpdates: [{ entity: 1, story: "한국-1", ...u }] });
    rejects(db, f({ description: "가짜국 전 재무장관" }), D, /이르/);
    rejects(db, f({ name: "김진짜" }), D, /이르/);
    db.close();
  });

  test("다른 종류의 같은 이름은 막지 않고(지운 이름도 같은 범위에서만), 맞는 파일(이름 바꾸기와 별칭 더하기)은 통과해 적용된다", () => {
    const { db, key } = checkDb();
    const D = "2026-10-28";
    const file = refFile(
      db,
      D,
      { "한국-1": { entities: [1, "org"], terms: [{ term: 1, surface: "양적완화" }] }, "세계-1": { entities: ["co"] } },
      {
        newEntities: [
          { key: "org", kind: "기관", name: "김가짜", aliases: [], description: "가짜국 재단" },
          { key: "co", kind: "기관", name: "이가짜", aliases: [], description: "가짜국 회사" },
        ],
        entityUpdates: [{ entity: 1, story: "한국-1", name: "김진짜", aliases: ["킴 진짜"], description: "가짜국 부총리 겸 재무장관" }],
        termUpdates: [{ term: 1, story: "한국-1", aliases: ["양적 완화 정책"] }],
      },
    );
    const r = applyFile(db, file, D, key);
    assert.equal(r.status, "applied");
    const e = getEntity(db, 1)!;
    assert.equal(e.name, "김진짜");
    assert.deepEqual(e.aliases, ["Kim Gajja", "김가짜", "킴 진짜"]);
    assert.equal(e.description, "가짜국 부총리 겸 재무장관");
    assert.equal(e.describedStory, "2026-10-28/한국-1");
    assert.deepEqual(getTerm(db, 1)!.aliases, ["QE", "양적 완화 정책"]);
    db.close();
  });
});

function cli(repo: string, argv: string[], env: NodeJS.ProcessEnv, now = NOW): { code: number; text: string } {
  const ctx = makeCtx(repo, env, now);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function startRun(repo: string, env: NodeJS.ProcessEnv, args: string[] = [], now = NOW): { runFile: string; text: string } {
  const r = cli(repo, ["start", ...args], env, now);
  assert.equal(r.code, 0, r.text);
  return { runFile: /실행 기록: (.+)/.exec(r.text)![1]!, text: r.text };
}

function saveAll(repo: string, env: NodeJS.ProcessEnv, runFile: string, now = NOW): void {
  for (const date of readRun(runFile).targetDates) {
    writeJson(workFile(readRun(runFile).dataDir, date), refBrief(date));
    const r = cli(repo, ["save", "--run", runFile, "--date", date], env, now);
    assert.equal(r.code, 0, r.text);
  }
}

describe("4단계 4.2-5·4.5 뽑기 명령, 실패, start와 요약", () => {
  test("실패한 날짜는 다음 실행의 뽑기 날짜에 다시 나오고 뉴스와 이슈 연결은 그대로이며, 성공하면 요약에 수가 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r1 = startRun(repo, env);
    assert.match(r1.text, /- 뽑기할 저장된 날짜\(채우기·재시도\): 없음/);
    saveAll(repo, env, r1.runFile);
    const D = "2026-10-27";
    const refs = cli(repo, ["refs", "--run", r1.runFile, "--date", D], env);
    assert.equal(refs.code, 0, refs.text);
    assert.match(fs.readFileSync(refWorkFile(dataDir, D, "refs.md"), "utf8"), /`한국-1` · 한국 · 주요 뉴스/);
    const dbFile = path.join(dataDir, "tidwyn.db");
    const linksBefore = (() => {
      const db = openDb(dbFile);
      const issue = createIssue(db, { name: "가짜 금리 이야기", aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: "가짜 요약이다." });
      linkStory(db, storyId(db, D, "한국-1"), issue, true);
      const d = dumpDb(db);
      db.close();
      return { stories: d.stories, links: d.story_issues };
    })();
    writeJson(refWorkFile(dataDir, D, "refs.json"), { date: D, newEntities: [], newTerms: [], stories: [] });
    assert.equal(cli(repo, ["ref-check", "--run", r1.runFile, "--date", D], env).code, 1);
    const bad = cli(repo, ["ref-apply", "--run", r1.runFile, "--date", D], env);
    assert.equal(bad.code, 1, bad.text);
    assert.equal(readRun(r1.runFile).extracts?.[D]?.status, "failed");
    const s1 = cli(repo, ["summary", "--run", r1.runFile], env).text;
    assert.match(s1, /- 인물·기관·국가와 용어 뽑기:\n\s+- 2026-10-27: 뽑기 실패\(뉴스와 이슈 연결은 그대로, 다음 실행이 다시 뽑는다\)/);
    assert.match(s1, /- stories: 뉴스 한국-1가 빠졌다/);
    assert.match(s1, /아직 뽑기 안 한 날짜: 1개/);
    {
      const db = openDb(dbFile);
      const d = dumpDb(db);
      assert.deepEqual({ stories: d.stories, links: d.story_issues }, linksBefore);
      db.close();
    }

    const DAY3 = new Date("2026-10-29T09:00:00+09:00");
    const r2 = startRun(repo, env, [], DAY3);
    assert.match(r2.text, /- 뽑기할 저장된 날짜\(채우기·재시도\): 2026-10-27/);
    assert.deepEqual(readRun(r2.runFile).extractDates, ["2026-10-27"]);
    const db = openDb(dbFile);
    writeJson(refWorkFile(dataDir, D, "refs.json"), refFile(db, D, { "한국-1": { entities: ["kim"], terms: [{ term: "qe", surface: "양적완화" }] } }, { newEntities: [KIM], newTerms: [QE] }));
    db.close();
    assert.equal(cli(repo, ["ref-check", "--run", r2.runFile, "--date", D], env, DAY3).code, 0);
    const ok = cli(repo, ["ref-apply", "--run", r2.runFile, "--date", D], env, DAY3);
    assert.equal(ok.code, 0, ok.text);
    assert.match(cli(repo, ["refs", "--run", r2.runFile, "--date", D], env, DAY3).text, /할 일 없음/);
    const s2 = cli(repo, ["summary", "--run", r2.runFile], env, DAY3).text;
    assert.match(s2, /- 2026-10-27: 대상 연결 1개, 용어 연결 1개\(새 대상 1개, 새 용어 1개, 고친 한 줄 설명 0개\)/);
    assert.match(s2, /아직 뽑기 안 한 날짜: 없음/);
    assert.doesNotMatch(s2, /경고: /);
  });

  test("시험 모드에서 뽑기 실패는 실행 기록과 요약에 남고 백업을 멈추지 않는다", () => {
    const repo = tempRepo();
    const r = startRun(repo, {}, ["test"]);
    saveAll(repo, {}, r.runFile);
    const state = readRun(r.runFile);
    const D = state.targetDates[0]!;
    writeJson(refWorkFile(state.dataDir, D, "refs.json"), { date: D });
    assert.equal(cli(repo, ["ref-apply", "--run", r.runFile, "--date", D], {}).code, 1);
    const b = cli(repo, ["backup", "--run", r.runFile], {});
    assert.equal(b.code, 0, b.text);
    const s = cli(repo, ["summary", "--run", r.runFile], {}).text;
    assert.match(s, new RegExp(`- ${D}: 뽑기 실패`));
    assert.equal(readRun(r.runFile).extracts?.[D]?.status, "failed");
  });

  test("요약의 합치기 줄에 대상·용어 합치기와 되돌리는 명령이, 사이트 빌드 줄에 대상·용어 수가 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r = startRun(repo, env);
    const s = readRun(r.runFile);
    s.merge = {
      status: "merged",
      merges: [],
      refs: [{ id: 3, item: "entity", survivor: 1, survivorName: "가짜 협회", absorbed: 2, absorbedName: "가짜협회 본부", reason: "같은 단체" }],
    };
    s.site = { status: "built", outDir: path.join(dataDir, "site"), dates: 2, issues: 3, entities: 12, terms: 4, files: 40, bytes: 1_000_000 };
    writeRun(r.runFile, s);
    const out = cli(repo, ["summary", "--run", r.runFile], env).text;
    assert.match(out, /합치기: 이슈 0쌍, 대상·용어 1쌍을 합쳤다\n\s+- 대상·용어 합치기 3: 대상 2\(가짜협회 본부\) → 대상 1\(가짜 협회\)\. 이유: 같은 단체\. 되돌리기: node src\/cli\.ts ref-unmerge --id 3/);
    assert.match(out, /파일 40개, 인물·기관·국가 12개, 용어 4개/);
  });

  test("지운 이름 기록이 있는데 키가 없거나, 그 뒤 새 키가 생기면 start와 요약에 경고가 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const { db } = refDb(["2026-10-26"], path.join(dataDir, "tidwyn.db"));
    const a = createEntity(db, { kind: "인물", name: "이가짜", aliases: [], description: "가짜 주민", describedOn: null, describedStory: null });
    assert.ok(deleteRef(db, "entity", a, ensureNameKey(dataDir), TODAY).ok);
    createEntity(db, { kind: "인물", name: "정가짜", aliases: [], description: "가짜 주민", describedOn: null, describedStory: null });
    db.close();
    assert.doesNotMatch(startRun(repo, env).text, /막지 못한다/);
    fs.rmSync(nameKeyPath(dataDir));
    const noKey = startRun(repo, env);
    assert.match(noKey.text, /- 경고: 지운 이름 일부를 막지 못한다/);
    assert.match(cli(repo, ["summary", "--run", noKey.runFile], env).text, /- 경고: 지운 이름 일부를 막지 못한다/);
    const del = cli(repo, ["ref-delete", "--entity", "2"], env);
    assert.equal(del.code, 0, del.text);
    assert.ok(readNameKey(dataDir) !== null, "새 키가 생겼다");
    const newKey = startRun(repo, env);
    assert.match(newKey.text, /- 경고: 지운 이름 일부를 막지 못한다/);
    assert.match(cli(repo, ["summary", "--run", newKey.runFile], env).text, /- 경고: 지운 이름 일부를 막지 못한다/);
  });
});

/** 합치기 후보와 적용·되돌리기용 DB */
function mergeDb() {
  const { db, dir } = refDb();
  const e = (kind: "인물" | "기관" | "국가", name: string, aliases: string[] = []) => createEntity(db, { kind, name, aliases, description: `가짜 ${kind}`, describedOn: null, describedStory: null });
  const t = (name: string, aliases: string[] = []) => createTerm(db, { name, aliases, description: "지어낸 용어다." });
  const ids = {
    a: e("기관", "가짜 중앙은행", ["Gajja Central Bank"]),
    b: e("기관", "가짜중앙은행", ["GCB"]),
    c: e("인물", "가짜 중앙은행"),
    d: e("기관", "가상 철도 공사"),
    n1: e("국가", "가짜 공화국"),
    n2: e("국가", "가짜공화국"),
    x1: e("인물", "최가짜"),
    x2: e("인물", "최 가짜"),
    t1: t("양적완화", ["QE"]),
    t2: t("양적 완화 정책", ["QE"]),
    t3: t("역레포"),
  };
  const link = (date: string, key: string, id: number) => linkEntity(db, storyId(db, date, key), id);
  link("2026-10-26", "한국-1", ids.a);
  link("2026-10-26", "한국-2", ids.b);
  link("2026-10-27", "한국-1", ids.a);
  link("2026-10-27", "한국-1", ids.b);
  link("2026-10-26", "세계-1", ids.c);
  link("2026-10-26", "세계-2", ids.d);
  link("2026-10-26", "세계-3", ids.n1);
  link("2026-10-27", "세계-3", ids.n2);
  link("2026-10-26", "한국-3", ids.x1);
  link("2026-10-27", "한국-3", ids.x2);
  db.prepare("INSERT INTO story_terms (story_id, term_id, surface) VALUES (?, ?, ?)").run(storyId(db, "2026-10-26", "한국-1"), ids.t1, "양적완화");
  db.prepare("INSERT INTO story_terms (story_id, term_id, surface) VALUES (?, ?, ?)").run(storyId(db, "2026-10-27", "한국-1"), ids.t2, null);
  db.prepare("INSERT INTO story_terms (story_id, term_id, surface) VALUES (?, ?, ?)").run(storyId(db, "2026-10-27", "한국-2"), ids.t3, null);
  addRefNoMerge(db, "entity", ids.n1, ids.n2);
  return { db, dir, ids };
}

const pairsOf = (db: DatabaseSync) => refMergeCandidates(db).map((p) => [p.item, p.pair.a.id, p.pair.b.id].join(":"));

describe("4단계 4.3 합치기, 되돌리기, 지우기", () => {
  test("이름이 거의 같은 같은 종류 대상과 별칭이 겹치는 용어가 후보이고, 종류가 다른 쌍·관계없는 쌍·합치지 않음 쌍·지운 것은 아니다", () => {
    const { db, dir, ids } = mergeDb();
    assert.ok(deleteRef(db, "entity", ids.x2, ensureNameKey(dir), TODAY).ok);
    const pairs = pairsOf(db);
    assert.ok(pairs.includes(`entity:${ids.a}:${ids.b}`), pairs.join(", "));
    assert.ok(pairs.includes(`term:${ids.t1}:${ids.t2}`), pairs.join(", "));
    for (const [x, y] of [[ids.a, ids.c], [ids.b, ids.c], [ids.n1, ids.n2], [ids.x1, ids.x2], [ids.a, ids.d]]) {
      assert.ok(!pairs.some((p) => p === `entity:${Math.min(x!, y!)}:${Math.max(x!, y!)}`), `${x}-${y}`);
    }
    assert.ok(!pairs.some((p) => p.startsWith("term:") && p.split(":").slice(1).includes(String(ids.t3))));
    db.close();
  });

  test("적용하면 연결을 옮기고 중복을 줄이며, 별칭·설명·흡수 표시·기록이 맞고, 거부 경우는 DB를 바꾸지 않는다", () => {
    const { db, dir, ids } = mergeDb();
    assert.ok(deleteRef(db, "entity", ids.x2, ensureNameKey(dir), TODAY).ok);
    const check = (data: unknown) => {
      const c = new Checker();
      const out = checkRefMerges(c, db, data as Record<string, unknown>);
      return { out, violations: c.violations };
    };
    const before = dumpDb(db);
    const bad: [unknown, RegExp][] = [
      [{ entityMerges: [{ survivor: 999, absorbed: ids.b, reason: "같다" }] }, /999/],
      [{ entityMerges: [{ survivor: ids.a, absorbed: ids.a, reason: "같다" }] }, /같은 대상끼리/],
      [{ entityMerges: [{ survivor: ids.a, absorbed: ids.c, reason: "같다" }] }, /종류가 다르다/],
      [{ entityMerges: [{ survivor: ids.a, absorbed: ids.b, reason: "" }] }, /이유/],
      [{ entityMerges: [{ survivor: ids.a, absorbed: ids.b, reason: "같다", description: "가".repeat(61) }] }, /60자/],
      [{ termMerges: [{ survivor: ids.t1, absorbed: ids.t2, reason: "같다", description: "하나. 둘. 셋. 넷." }] }, /3문장 이하/],
      [{ entityMerges: [{ survivor: ids.n1, absorbed: ids.n2, reason: "같다" }] }, /합치지 않음/],
      [{ entityMerges: [{ survivor: ids.a, absorbed: ids.x2, reason: "같다" }] }, /지운/],
    ];
    for (const [data, why] of bad) {
      const r = check(data);
      assert.ok(r.violations.some((v) => why.test(`${v.where}: ${v.why}`)), `${why}: ${JSON.stringify(r.violations)}`);
    }
    assert.deepEqual(dumpDb(db), before);

    const ok = check({ entityMerges: [{ survivor: ids.a, absorbed: ids.b, reason: "같은 중앙은행", description: "가짜국의 중앙은행" }], termMerges: [{ survivor: ids.t1, absorbed: ids.t2, reason: "같은 정책" }] });
    assert.deepEqual(ok.violations, []);
    const [m1] = mergeRefs(db, ok.out);
    const a = getEntity(db, ids.a)!;
    assert.deepEqual(a.aliases, ["Gajja Central Bank", "GCB"], "정규화하면 같은 이름(가짜중앙은행)은 별칭에 겹쳐 넣지 않는다");
    assert.equal(a.description, "가짜국의 중앙은행");
    assert.equal(a.count, 3, "같은 뉴스에 둘 다 연결된 곳은 하나로 줄인다");
    assert.equal(getEntity(db, ids.b)!.mergedInto, ids.a);
    assert.equal(storiesOfRef(db, "entity", ids.b).length, 0);
    assert.deepEqual(getTerm(db, ids.t1)!.aliases, ["QE", "양적 완화 정책"]);
    assert.equal(getTerm(db, ids.t1)!.count, 2);
    const rec = listRefMerges(db).find((m) => m.id === m1)!;
    assert.deepEqual([rec.item, rec.survivor, rec.absorbed, rec.reason, rec.mergedOn], ["entity", ids.a, ids.b, "같은 중앙은행", TODAY]);
    assert.ok(rec.record !== null);
    const again = check({ entityMerges: [{ survivor: ids.a, absorbed: ids.b, reason: "같다" }] });
    assert.ok(again.violations.some((v) => /이미/.test(v.why)));
    db.close();
  });

  test("되돌리면 합치기 전과 같아지고, 합친 뒤 붙은 연결은 남는 것에 남으며, 그 쌍은 후보에서 빠지고, 연달아 합쳐졌거나 이미 되돌렸으면 거부한다", () => {
    const { db, ids } = mergeDb();
    const snap = () => ({ a: getEntity(db, ids.a), b: getEntity(db, ids.b), la: storiesOfRef(db, "entity", ids.a).map((s) => s.id), lb: storiesOfRef(db, "entity", ids.b).map((s) => s.id) });
    const before = snap();
    const [m1] = mergeRefs(db, [{ item: "entity", survivor: ids.a, absorbed: ids.b, reason: "같은 은행" }]);
    const late = storyId(db, "2026-10-28", "한국-1");
    linkEntity(db, late, ids.a);
    // 연달아 합치기: a가 d에 흡수되면 m1은 거부
    const [m2] = mergeRefs(db, [{ item: "entity", survivor: ids.d, absorbed: ids.a, reason: "가짜 이유" }]);
    const chained = unmergeRef(db, m1!, TODAY);
    assert.equal(chained.ok, false);
    assert.match(!chained.ok ? chained.reason : "", new RegExp(`${m2}`));
    assert.ok(unmergeRef(db, m2!, TODAY).ok);
    assert.ok(unmergeRef(db, m1!, TODAY).ok);
    const after = snap();
    assert.deepEqual(after.b, before.b);
    assert.deepEqual(after.a?.aliases, before.a?.aliases);
    assert.deepEqual(after.lb, before.lb);
    assert.deepEqual(after.la, [...before.la, late].sort((x, y) => x - y));
    assert.ok(!pairsOf(db).includes(`entity:${ids.a}:${ids.b}`));
    const twice = unmergeRef(db, m1!, TODAY);
    assert.equal(twice.ok, false);
    db.close();
  });

  test("지우면 연결이 없고, 사이트 데이터·검색 색인·DB·백업 어디에도 이름·별칭·설명(합치기 이유, 흡수되어 있던 것 포함)이 없으며, 키 파일도 없다", () => {
    const { db, dir } = refDb();
    const key = ensureNameKey(dir);
    const NAMES = ["최가상", "Choi Gasang", "최가상 장관", "가짜국 외교부 장관", "가짜국 외교 수장"];
    const x = createEntity(db, { kind: "인물", name: "최가상", aliases: ["Choi Gasang"], description: "가짜국 외교부 장관", describedOn: TODAY, describedStory: "2026-10-27/한국-1" });
    const y = createEntity(db, { kind: "인물", name: "최가상 장관", aliases: [], description: "가짜국 외교 수장", describedOn: null, describedStory: null });
    const keep = createEntity(db, { kind: "국가", name: "가짜국", aliases: [], description: "가상의 나라", describedOn: null, describedStory: null });
    for (const k of ["한국-1", "한국-2"]) linkEntity(db, storyId(db, "2026-10-27", k), x);
    linkEntity(db, storyId(db, "2026-10-28", "한국-1"), y);
    linkEntity(db, storyId(db, "2026-10-28", "한국-1"), keep);
    const [m] = mergeRefs(db, [{ item: "entity", survivor: x, absorbed: y, reason: "최가상과 최가상 장관은 같은 사람이다" }]);
    const r = deleteRef(db, "entity", x, key, TODAY);
    assert.ok(r.ok);
    assert.deepEqual(r.ids, [x, y]);
    assert.equal(r.links, 3);
    assert.equal(storiesOfRef(db, "entity", x).length + storiesOfRef(db, "entity", y).length, 0);
    const unm = unmergeRef(db, m!, TODAY);
    assert.equal(unm.ok, false);

    const backupDir = path.join(dir, "backup");
    exportBackup(db, backupDir);
    const site = buildSiteData(db);
    const haystacks: [string, string][] = [
      ...[...site].map(([k, v]): [string, string] => [`site ${k}`, v]),
      ["search", JSON.stringify(buildSearchRecords(db))],
      ...[...readBackupDir(backupDir)].map(([k, v]): [string, string] => [`backup ${k}`, v]),
      ["db", JSON.stringify(dumpDb(db))],
    ];
    const keyText = fs.readFileSync(nameKeyPath(dir), "utf8").trim();
    for (const [where, text] of haystacks) {
      for (const n of [...NAMES, keyText]) assert.ok(!text.includes(n), `${where}에 "${n === keyText ? "키" : n}"가 있다`);
    }
    assert.ok(!fs.readdirSync(backupDir).includes(NAME_KEY_FILE));
    assert.ok(![...site.keys()].some((k) => k.includes(NAME_KEY_FILE)));
    assert.ok(site.has("site-data/entity-0.json"));
    assert.ok(site.get("site-data/entity-0.json")!.includes("가짜국"), "남는 대상은 그대로 있다");

    // 같은 이름(별칭 표기, 띄어쓰기만 다른 표기)을 새로 뽑으면 거부
    for (const name of ["최 가상", "choi gasang", "최가상장관"]) {
      rejects(db, refFile(db, "2026-10-26", { "한국-1": { entities: ["n"] } }, { newEntities: [{ key: "n", kind: "인물", name, aliases: [], description: "가짜국 장관" }] }), "2026-10-26", /지운 이름/, key);
    }
    db.close();
  });

  test("명령: 흡수된 식별자로 지우면 거부하고 남는 것을 알리며, 실제 데이터 폴더 조건을 어기면 지우기·되돌리기가 거부되고 DB가 바뀌지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const { db } = refDb(["2026-10-27"], path.join(dataDir, "tidwyn.db"));
    const a = createEntity(db, { kind: "기관", name: "가짜 협회", aliases: [], description: "가짜 단체", describedOn: null, describedStory: null });
    const b = createEntity(db, { kind: "기관", name: "가짜협회 본부", aliases: [], description: "가짜 단체", describedOn: null, describedStory: null });
    mergeRefs(db, [{ item: "entity", survivor: a, absorbed: b, reason: "같은 단체" }]);
    db.close();
    const r = cli(repo, ["ref-delete", "--entity", String(b)], env);
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, new RegExp(`대상 ${b}은\\(는\\) 대상 ${a}\\(가짜 협회\\)에 흡수되었다`));
    assert.equal(readNameKey(dataDir), null, "거부하면 키를 만들지 않는다");
    assert.match(cli(repo, ["merges"], env).text, /대상·용어 합치기 1.*ref-unmerge --id 1/);
    const ok = cli(repo, ["ref-delete", "--entity", String(a)], env);
    assert.equal(ok.code, 0, ok.text);
    for (const line of [/지운 이름\(다음 뽑기에서 같은 이름을 거부한다\): 가짜 협회, 가짜협회 본부/, /끊은 연결: 0개/, /다음 \/brief 실행이 백업하고 사이트에 배포한다/, /이미 push된 data 브랜치/, /뉴스 본문/, /이슈 이름·별칭·요약/, /deploy --dir --db/]) {
      assert.match(ok.text, line);
    }
    assert.match(cli(repo, ["ref-unmerge", "--id", "1"], env).text, /되돌리지 않음/);

    const realRepo = tempRepo();
    const dbFile = path.join(realRepo, "data", "tidwyn.db");
    const r2 = refDb(["2026-10-27"], dbFile);
    const c = createEntity(r2.db, { kind: "기관", name: "가짜 협회", aliases: [], description: "가짜 단체", describedOn: null, describedStory: null });
    const d = createEntity(r2.db, { kind: "기관", name: "가짜협회 본부", aliases: [], description: "가짜 단체", describedOn: null, describedStory: null });
    mergeRefs(r2.db, [{ item: "entity", survivor: c, absorbed: d, reason: "같은 단체" }]);
    r2.db.close();
    gitIn(realRepo, "switch", "-q", "-c", "other");
    const before = fs.readFileSync(dbFile);
    for (const argv of [["ref-delete", "--entity", String(c)], ["ref-unmerge", "--id", "1"]]) {
      const x = cli(realRepo, argv, {});
      assert.equal(x.code, 3, x.text);
      assert.match(x.text, /실행 조건이 맞지 않아/);
    }
    assert.deepEqual(fs.readFileSync(dbFile), before);
    assert.equal(fs.existsSync(path.join(realRepo, "data", "snapshots")), false);
  });
});

describe("4단계 4.4-1 백업과 복원", () => {
  test("대상·용어·연결·합치기·지우기가 있는 DB를 백업하고 복원하면 같고, 가장 큰 식별자를 지운 뒤 복원해도 새 식별자는 다르다", () => {
    const { db, dir, ids } = mergeDb();
    const key = ensureNameKey(dir);
    mergeRefs(db, [{ item: "entity", survivor: ids.a, absorbed: ids.b, reason: "같은 은행" }]);
    const [m2] = mergeRefs(db, [{ item: "term", survivor: ids.t1, absorbed: ids.t2, reason: "같은 정책" }]);
    assert.ok(unmergeRef(db, m2!, TODAY).ok);
    markAll(db);
    assert.ok(deleteRef(db, "term", ids.t3, key, TODAY).ok, "가장 큰 용어 식별자");
    assert.ok(deleteRef(db, "entity", ids.x2, key, TODAY).ok, "가장 큰 대상 식별자");
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const files = readBackupDir(out);
    assert.ok(files.has("refs.json"));
    db.close();

    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(files, restored);
    const db2 = openDb(restored);
    assert.deepEqual(Object.fromEntries(buildBackup(db2)), Object.fromEntries(files));
    assert.deepEqual(extractableDates(db2), []);
    assert.ok(createEntity(db2, { kind: "인물", name: "새가짜", aliases: [], description: "가짜", describedOn: null, describedStory: null }) > ids.x2);
    assert.ok(createTerm(db2, { name: "새 용어", aliases: [], description: "지어낸 용어다." }) > ids.t3);
    db2.close();
  });

  test("형식 2 백업을 복원하면 모든 날짜가 뽑기 대상이다", () => {
    const { db } = refDb(["2026-10-26", "2026-10-27"]);
    const files = buildBackup(db);
    db.close();
    const v2 = new Map([...files].map(([k, v]) => [k, JSON.stringify({ ...JSON.parse(v), formatVersion: 2 })]));
    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(v2, restored);
    const db2 = openDb(restored);
    assert.deepEqual(extractableDates(db2), ["2026-10-26", "2026-10-27"]);
    db2.close();
  });
});

function markAll(db: DatabaseSync): void {
  for (const d of extractableDates(db)) db.prepare("INSERT INTO extracted_dates (target_date) VALUES (?)").run(d);
}

describe("4단계 4.3-1 합치기 점검일(이슈·대상·용어를 한 번으로 본다)", () => {
  /** 합칠 때가 된 데이터 폴더: 이슈 후보는 없고, 이름이 거의 같은 대상 두 개가 있다 */
  function dueDir() {
    const repo = tempRepo();
    const dataDir = tempDir();
    const { db } = refDb(DATES, path.join(dataDir, "tidwyn.db"));
    const a = createEntity(db, { kind: "기관", name: "가짜 중앙은행", aliases: [], description: "가짜국 중앙은행", describedOn: null, describedStory: null });
    const b = createEntity(db, { kind: "기관", name: "가짜중앙은행 본점", aliases: [], description: "가짜국 중앙은행", describedOn: null, describedStory: null });
    linkEntity(db, storyId(db, "2026-10-27", "한국-1"), a);
    linkEntity(db, storyId(db, "2026-10-28", "한국-1"), b);
    setMeta(db, FIRST_LINKED_KEY, "2026-10-20");
    db.close();
    const env = { TIDWYN_DATA_DIR: dataDir };
    return { repo, dataDir, env, a, b, runFile: startRun(repo, env).runFile };
  }
  const checked = (dataDir: string) => {
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    const v = getMeta(db, MERGE_CHECKED_KEY);
    db.close();
    return v;
  };

  test("이슈 후보가 없어도 대상 후보가 있으면 merge-list는 점검일을 바꾸지 않고 후보를 쓴다", () => {
    const { repo, dataDir, env, runFile } = dueDir();
    const r = cli(repo, ["merge-list", "--run", runFile], env);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /후보 이슈 0쌍, 대상 1쌍, 용어 0쌍/);
    assert.equal(readRun(runFile).merge?.status, "pending");
    assert.equal(checked(dataDir), null);
  });

  test("대상 부분이 검사에 걸리면 이슈 부분이 맞아도 점검일을 바꾸지 않고, 고쳐서 통과하면 바꾼다", () => {
    const { repo, dataDir, env, a, b, runFile } = dueDir();
    assert.equal(cli(repo, ["merge-list", "--run", runFile], env).code, 0);
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [], entityMerges: [{ survivor: a, absorbed: b, reason: "" }] });
    const bad = cli(repo, ["merge-apply", "--run", runFile], env);
    assert.equal(bad.code, 1, bad.text);
    assert.equal(readRun(runFile).merge?.status, "failed");
    assert.equal(checked(dataDir), null);
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [], entityMerges: [{ survivor: a, absorbed: b, reason: "같은 중앙은행" }] });
    const ok = cli(repo, ["merge-apply", "--run", runFile], env);
    assert.equal(ok.code, 0, ok.text);
    assert.equal(checked(dataDir), kstDate(NOW), "실행한 날로 바뀐다");
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    assert.equal(getEntity(db, b)!.mergedInto, a);
    db.close();
  });
});
