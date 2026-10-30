import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, exportBackup, readBackupDir, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { FIRST_LINKED_KEY, MERGE_CHECKED_KEY, createIssue, getMeta, inTransaction, linkStory, setMeta, storiesOfDate } from "../src/issues.ts";
import { kstDate } from "../src/kst.ts";
import { applyMerges } from "../src/merge.ts";
import { createEntity, linkEntity } from "../src/refs.ts";
import { applySchedulePlan, checkScheduleFile, renderScheduleSearch, renderScheduleWork, scheduleCandidates } from "../src/scheduleExtract.ts";
import { addScheduleNoMerge, applyScheduleMerges, checkScheduleMerges, deleteSchedule, listScheduleMerges, scheduleMergeCandidates, unmergeSchedule, type ScheduleMergeEntry } from "../src/scheduleMerge.ts";
import {
  createSchedule,
  getSchedule,
  isScheduled,
  knownOn,
  linkSchedule,
  relatedIssuesOfSchedule,
  schedulableDates,
  schedulesOfStory,
  storiesOfSchedule,
  updateSchedule,
} from "../src/schedules.ts";
import { mergeWorkFile, readRun, scheduleWorkFile, workFile, writeRun } from "../src/run.ts";
import { buildSiteData } from "../src/siteData.ts";
import { checkOutput } from "../src/siteCheck.ts";
import type { DayList, IssueChunk, MonthDetail, MonthList, ScheduleIndex, ScheduleItem, ScheduleMonth, ScheduleRefChunk } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { Checker, validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 5단계 일정 달력(4.1~4.6). 일정·이슈 이름과 뉴스 글은 모두 지어낸 것이다.

const TODAY = "2026-10-29";
const DATES = ["2026-10-26", "2026-10-27", "2026-10-28"];

/** 본문에 지어낸 일정이 나오는 예시 브리프 */
function schedBrief(date: string) {
  const b = sampleBrief(date);
  const kr = b.sections[0]!.topStories[0]!;
  kr.summary = "가짜 중앙은행이 다음 달 기준금리를 결정한다.";
  kr.outlook = "가짜 중앙은행 회의는 11월 5일에 열린다.";
  b.sections[1]!.topStories[0]!.summary = "가짜국 총선이 다가온다.";
  return b;
}

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(schedBrief(date), date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

function schedDb(dates = DATES, file?: string): { db: DatabaseSync; dir: string } {
  const dir = file ? path.dirname(file) : tempDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(file ?? path.join(dir, "tidwyn.db"));
  recordFirstCollectionDate(db, dates[0]!);
  for (const d of dates) addBrief(db, d);
  return { db, dir };
}

/** 그날 모든 뉴스가 든 일정 파일. stories에 준 뉴스만 채운다 */
function schedFile(db: DatabaseSync, date: string, stories: Record<string, (number | string)[]> = {}, extra: Record<string, unknown> = {}) {
  return {
    date,
    newSchedules: [],
    stories: storiesOfDate(db, date).map((s) => ({ story: s.key, schedules: stories[s.key] ?? [] })),
    ...extra,
  };
}

function applyFile(db: DatabaseSync, data: unknown, date: string) {
  const r = checkScheduleFile(db, data, date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  return applySchedulePlan(db, r.plan);
}

/** SQL로 읽은 모든 테이블의 모든 행 */
function dumpDb(db: DatabaseSync): Record<string, unknown[]> {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
  return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}"`).all()]));
}

function rejects(db: DatabaseSync, data: unknown, date: string, why: RegExp): void {
  const before = dumpDb(db);
  const r = checkScheduleFile(db, data, date);
  assert.equal(r.ok, false, `거부되어야 한다: ${why}`);
  assert.ok(!r.ok && r.violations.some((v) => why.test(`${v.where}: ${v.why}`)), `위반 ${why}이 없다: ${!r.ok ? JSON.stringify(r.violations) : ""}`);
  assert.deepEqual(dumpDb(db), before, "DB가 바뀌지 않는다");
}

function storyId(db: DatabaseSync, date: string, key: string): number {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date} ${key}`);
  return s.id;
}

/** 근거 뉴스 하나를 붙인 일정(검사를 거치지 않는다. 지난 예정일 일정을 만들 때 쓴다) */
function sched(db: DatabaseSync, name: string, due: string, basis: [string, string][] = [["2026-10-26", "한국-2"]], major: "경제" | "정치" | "국제" = "경제"): number {
  const id = createSchedule(db, { name, due, major });
  for (const [d, k] of basis) linkSchedule(db, storyId(db, d, k), id, "basis");
  return id;
}

function issue(db: DatabaseSync, name: string): number {
  return createIssue(db, { name, aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: `${name}의 요약이다.` });
}

function mergeSchedules(db: DatabaseSync, merges: ScheduleMergeEntry[]): number[] {
  return inTransaction(db, () => applyScheduleMerges(db, merges, TODAY));
}

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
    writeJson(workFile(readRun(runFile).dataDir, date), schedBrief(date));
    const r = cli(repo, ["save", "--run", runFile, "--date", date], env, now);
    assert.equal(r.code, 0, r.text);
  }
}

const RATE = { key: "rate", name: "가짜 중앙은행 기준금리 결정", due: "2026-11-05", major: "경제" };

describe("5단계 4.1 데이터와 저장", () => {
  test("일정을 여러 날짜 뉴스에 연결하면 항목이 나오고, 알려진 날은 가장 이른 근거 뉴스의 날짜, 관련 이슈는 근거·결과 뉴스의 주 이슈이며, 합치거나 지운 뒤 새 식별자는 다르다", () => {
    const { db } = schedDb();
    const iA = issue(db, "가짜 금리 이야기");
    const iB = issue(db, "가짜 금리 논쟁");
    const iC = issue(db, "가짜 물가 이야기");
    linkStory(db, storyId(db, "2026-10-27", "한국-1"), iB, true);
    linkStory(db, storyId(db, "2026-10-28", "한국-1"), iA, true);
    linkStory(db, storyId(db, "2026-10-28", "한국-3"), iC, true);
    applyFile(db, schedFile(db, "2026-10-28", { "한국-1": ["rate"] }, { newSchedules: [RATE] }), "2026-10-28");
    const id = getSchedule(db, 1)!.id;
    applyFile(db, schedFile(db, "2026-10-27", { "한국-1": [id] }), "2026-10-27");
    assert.deepEqual(getSchedule(db, id), { id, name: RATE.name, due: "2026-11-05", major: "경제", outcome: null, postponedTo: null, mergedInto: null, deleted: false, deletedOn: null });
    assert.equal(knownOn(db, id), "2026-10-27", "더 이른 날짜를 나중에 뽑아도 알려진 날이 바뀐다");
    assert.deepEqual(storiesOfSchedule(db, id).map((s) => [s.date, s.key, s.role]), [["2026-10-27", "한국-1", "basis"], ["2026-10-28", "한국-1", "basis"]]);
    linkSchedule(db, storyId(db, "2026-10-28", "한국-3"), id, "result");
    assert.deepEqual(relatedIssuesOfSchedule(db, id), [iA, iB, iC]);
    applyMerges(db, [{ survivor: iA, absorbed: iB, reason: "같은 금리 이야기", summary: "합친 요약이다." }], TODAY);
    assert.deepEqual(relatedIssuesOfSchedule(db, id), [iA, iC], "흡수된 이슈는 남는 이슈로 본다");

    const b = sched(db, "가짜 물가 발표", "2026-11-10");
    const c = sched(db, "가짜 물가 지표 발표", "2026-11-10");
    mergeSchedules(db, [{ survivor: b, absorbed: c, reason: "같은 발표" }]);
    assert.ok(deleteSchedule(db, b, TODAY).ok);
    assert.ok(createSchedule(db, { name: "새 가짜 일정", due: "2026-12-01", major: "사회" as never }) > c);
    db.close();
  });

  test("같은 일정 파일을 두 번 적용해도 연결은 하나씩이고, 뽑은 것이 없는 날짜도 완료다", () => {
    const { db } = schedDb();
    const file = schedFile(db, "2026-10-28", { "한국-1": ["rate"], "한국-s1": ["rate"] }, { newSchedules: [RATE] });
    const checked = checkScheduleFile(db, file, "2026-10-28");
    assert.ok(checked.ok);
    assert.equal(applySchedulePlan(db, checked.plan).status, "applied");
    const once = dumpDb(db);
    assert.equal(applySchedulePlan(db, checked.plan).status, "nothing");
    assert.deepEqual(dumpDb(db), once);
    assert.equal((once.story_schedules as unknown[]).length, 2);
    assert.equal(applyFile(db, schedFile(db, "2026-10-26"), "2026-10-26").status, "applied");
    assert.ok(isScheduled(db, "2026-10-26"));
    assert.deepEqual(schedulableDates(db), ["2026-10-27"]);
    db.close();
  });

  test("버전 4 DB(브리프, 이슈, 대상, 용어, 합치기·지운 이름 기록)를 새 코드로 열면 버전 7이 되고, 기존 데이터를 그대로 읽으며 모든 날짜가 일정 뽑기 대상이다", () => {
    const file = path.join(tempDir(), "t.db");
    const v4 = MIGRATIONS.filter((m) => m.version <= 4);
    const old = openDb(file, v4);
    recordFirstCollectionDate(old, "2026-10-26");
    for (const d of DATES) addBrief(old, d);
    const i1 = issue(old, "가짜 금리 이야기");
    const i2 = issue(old, "가짜 금리 논쟁");
    linkStory(old, storyId(old, "2026-10-26", "한국-1"), i1, true);
    linkStory(old, storyId(old, "2026-10-27", "한국-1"), i2, true);
    applyMerges(old, [{ survivor: i1, absorbed: i2, reason: "같은 이야기", summary: "합친 요약이다." }], TODAY);
    const e = createEntity(old, { kind: "기관", name: "가짜 중앙은행", aliases: [], description: "가짜국 중앙은행", describedOn: null, describedStory: null });
    linkEntity(old, storyId(old, "2026-10-26", "한국-1"), e);
    old.prepare("INSERT INTO terms (name, aliases, description) VALUES ('양적완화', '[]', '지어낸 용어다.')").run();
    old.prepare("INSERT INTO extracted_dates (target_date) VALUES ('2026-10-26')").run();
    old.prepare("INSERT INTO deleted_names (scope, hash, key_fp, deleted_on) VALUES ('인물', 'aa', 'bb', ?)").run(TODAY);
    assert.equal(schemaVersion(old), 4);
    const before = dumpDb(old);
    old.close();

    const db = openDb(file);
    assert.equal(schemaVersion(db), 7);
    const after = dumpDb(db);
    for (const [table, rows] of Object.entries(before)) assert.deepEqual(after[table], rows, table);
    assert.deepEqual(schedulableDates(db), DATES);
    db.close();
  });
});

describe("5단계 4.2-2 후보 목록과 검색", () => {
  test("주 이슈에 관련된 다가오는 일정과 이름이 본문에 나온 일정이 기존 후보이고, 관계없는 것·지난 것은 아니며, 일정 5,000개를 넣어도 목록 길이가 그대로다", () => {
    const { db } = schedDb();
    const i = issue(db, "가짜 선거 이야기");
    linkStory(db, storyId(db, "2026-10-26", "세계-2"), i, true);
    linkStory(db, storyId(db, "2026-10-28", "세계-1"), i, true);
    const byIssue = sched(db, "가상 공화국 의회 표결", "2026-12-01", [["2026-10-26", "세계-2"]], "국제");
    const byName = sched(db, "가짜 중앙은행 기준금리 결정", "2026-11-05", [["2026-10-26", "IT·AI-2"]]);
    const monthByName = sched(db, "가짜 중앙은행 연례 보고", "2026-10", [["2026-10-26", "IT·AI-3"]]);
    const unrelated = sched(db, "가짜 철도 개통", "2026-11-20", [["2026-10-26", "IT·AI-4"]]);
    const past = sched(db, "가짜 중앙은행 지난 회의", "2026-10-20", [["2026-10-26", "IT·AI-5"]]);
    const c = scheduleCandidates(db, "2026-10-28");
    assert.deepEqual(c.existing.map((s) => s.id), [byIssue, byName, monthByName]);
    assert.ok(!c.existing.some((s) => s.id === unrelated || s.id === past));
    const lines = renderScheduleWork(db, "2026-10-28").text.split("\n").length;
    for (let n = 0; n < 5000; n++) createSchedule(db, { name: `무관 행사 ${n}`, due: `2027-0${(n % 9) + 1}-1${n % 10}`, major: "사회" as never });
    assert.equal(renderScheduleWork(db, "2026-10-28").text.split("\n").length, lines);
    const text = renderScheduleWork(db, "2026-10-28").text;
    assert.match(text, new RegExp(`- 일정 ${byName} · 2026-11-05 · 경제 · 가짜 중앙은행 기준금리 결정 · 관련 이슈: 없음 · 알려진 날 2026-10-26`));
    assert.match(text, /### `한국-1` · 한국 · 주요 뉴스 · 경제 · 주 이슈: 없음/);
    db.close();
  });

  test("결과 후보는 기다리는 기간 안의 결과 기다림 일정뿐이다(기간 밖, 결과 있음, 연기·취소된 것은 아니고, 달 단위는 다음 달 14일까지)", () => {
    const { db } = schedDb(["2026-10-12", "2026-10-28"]);
    const b: [string, string][] = [["2026-10-12", "한국-2"]];
    const inWindow = sched(db, "가짜 통계 발표", "2026-10-20", b);
    const boundary = sched(db, "가짜 고용 발표", "2026-10-14", b);
    const tooOld = sched(db, "가짜 물가 발표", "2026-10-13", b);
    const done = sched(db, "가짜 실적 발표", "2026-10-27", b);
    updateSchedule(db, done, { outcome: "result" });
    const postponed = sched(db, "가짜 회담", "2026-10-26", b);
    updateSchedule(db, postponed, { outcome: "postponed", postponedTo: done });
    const cancelled = sched(db, "가짜 행사", "2026-10-25", b);
    updateSchedule(db, cancelled, { outcome: "cancelled" });
    const future = sched(db, "가짜 미래 회의", "2026-10-29", b);
    const lastMonth = sched(db, "가짜 9월 보고", "2026-09", b);
    const thisMonth = sched(db, "가짜 10월 보고", "2026-10", b);
    assert.deepEqual(scheduleCandidates(db, "2026-10-28").results.map((s) => s.id), [thisMonth, boundary, inWindow]);
    assert.ok(![tooOld, done, postponed, cancelled, future, lastMonth].some((id) => scheduleCandidates(db, "2026-10-28").results.some((s) => s.id === id)));
    const early = scheduleCandidates(db, "2026-10-12").results.map((s) => s.id);
    assert.deepEqual(early, [lastMonth, thisMonth], "달 단위 9월은 10월 14일까지 기다린다");
    db.close();
  });

  test("검색은 낱말과 예정일 범위로 찾고, 지운 일정과 이름·날짜가 같으면 \"지운 일정과 같음\"이 나온다", () => {
    const { db } = schedDb();
    const a = sched(db, "가짜 중앙은행 기준금리 결정", "2026-11-05");
    const b = sched(db, "가짜 중앙은행 기준금리 결정", "2026-12-10");
    sched(db, "가짜 철도 개통", "2026-11-06");
    const del = sched(db, "가짜 철도 개통식", "2026-11-07");
    assert.ok(deleteSchedule(db, del, TODAY).ok);
    sched(db, "가짜 철도 개통식", "2026-11-07");
    const r = renderScheduleSearch(db, "중앙은행", "2026-11-01", "2026-11-30");
    assert.match(r, new RegExp(`- 일정 ${a} · 2026-11-05`));
    assert.doesNotMatch(r, new RegExp(`- 일정 ${b} `));
    const d = renderScheduleSearch(db, "개통식", null, null);
    assert.match(d, /· 지운 일정과 같음/);
    assert.match(d, new RegExp(`지운 일정과 같음\\(이 이름·예정일로 새 일정을 만들면 검사에서 거부된다\\):\\n- 지운 일정 ${del} · 2026-11-07 · 가짜 철도 개통식`));
    assert.match(renderScheduleSearch(db, "없는낱말", null, null), /맞는 일정이 없다/);
    db.close();
  });
});

describe("5단계 4.2-3 일정 파일 검사", () => {
  /** 검사용 DB: 10-27 기준으로 결과 후보, 다가오는 일정, 흡수·지운 일정 */
  function checkDb() {
    const { db } = schedDb();
    const ids = {
      past: sched(db, "가짜 통계 발표", "2026-10-25"),
      upcoming: sched(db, "가짜 정상회담", "2026-11-20"),
      month: sched(db, "가짜 법 시행", "2026-11"),
      done: sched(db, "가짜 실적 발표", "2026-11-30"),
      absorbed: sched(db, "가짜 실적 공개", "2026-11-30"),
      deleted: sched(db, "가짜 출시 행사", "2026-12-01"),
      later: sched(db, "가짜 정상회담 연기분", "2026-12-15"),
    };
    updateSchedule(db, ids.done, { outcome: "cancelled" });
    mergeSchedules(db, [{ survivor: ids.done, absorbed: ids.absorbed, reason: "같은 발표" }]);
    assert.ok(deleteSchedule(db, ids.deleted, TODAY).ok);
    return { db, ids };
  }
  const D = "2026-10-27";
  const fresh = (o: Record<string, unknown> = {}) => ({ ...RATE, ...o });

  test("거부 경우를 하나씩 넣은 파일이 거부되고 DB가 바뀌지 않는다", () => {
    const { db, ids } = checkDb();
    const f = (stories: Record<string, (number | string)[]>, extra: Record<string, unknown> = {}) => schedFile(db, D, stories, extra);
    const withNew = (n: Record<string, unknown>, story = "한국-1") => f({ [story]: ["rate"] }, { newSchedules: [fresh(n)] });
    rejects(db, { ...f({}), stories: [...f({}).stories, { story: "한국-9", schedules: [] }] }, D, /한국-9가 없다/);
    rejects(db, { ...f({}), stories: f({}).stories.slice(1) }, D, /한국-1가 빠졌다/);
    rejects(db, f({ "한국-1": ["a", "b", "c", ids.upcoming] }, { newSchedules: ["a", "b", "c"].map((k, i) => fresh({ key: k, name: `가짜 일정 ${k}`, due: `2026-11-0${i + 1}` })) }), D, /주요 뉴스의 일정이 4개다/);
    rejects(db, f({ "한국-s1": ["rate", ids.upcoming] }, { newSchedules: [fresh()] }), D, /짧은 소식의 일정이 2개다/);
    rejects(db, withNew({ due: "2026-Q4" }), D, /일 단위\(YYYY-MM-DD\)나 달 단위/);
    rejects(db, withNew({ due: "연내" }), D, /일 단위\(YYYY-MM-DD\)나 달 단위/);
    rejects(db, withNew({ due: "2026-10-27" }), D, /다음 날\(2026-10-28\)보다 이르다/);
    rejects(db, withNew({ due: "2027-10-28" }), D, /365일을 넘는다/);
    assert.ok(checkScheduleFile(db, withNew({ due: "2027-10-27" }), D).ok, "365일째는 된다");
    rejects(db, withNew({ due: "2026-09" }), D, /뉴스 날짜의 달\(2026-10\)보다 이르다/);
    rejects(db, withNew({ due: "2027-11" }), D, /12달 뒤\(2027-10\)를 넘는다/);
    rejects(db, withNew({ major: "날씨" }), D, /7개 대분류/);
    rejects(db, withNew({ name: "" }), D, /이름이 비어 있으면 안 된다/);
    rejects(db, withNew({ name: "가".repeat(41) }), D, /41자다/);
    assert.ok(checkScheduleFile(db, withNew({ name: "가".repeat(40) }), D).ok, "40자는 된다");
    rejects(db, withNew({ name: "가짜 중앙은행이 금리를 정한다." }), D, /문장 끝 부호/);
    rejects(db, f({ "한국-1": [999] }), D, /일정 999이\(가\) 없다/);
    rejects(db, f({ "한국-1": [ids.absorbed] }), D, new RegExp(`일정 ${ids.done}\\(가짜 실적 발표\\)에 흡수되었다. ${ids.done}을\\(를\\) 쓴다`));
    rejects(db, f({ "한국-1": [ids.deleted] }), D, /지운 일정이다/);
    rejects(db, withNew({ name: "가짜  정상·회담", due: "2026-11-20" }), D, new RegExp(`기존 일정 ${ids.upcoming}\\(가짜 정상회담, 2026-11-20\\)과 이름·예정일이 겹친다`));
    rejects(db, withNew({ name: "가짜 법 시행", due: "2026-11-03" }), D, /이름·예정일이 겹친다/);
    rejects(db, f({ "한국-1": ["rate", "rate2"] }, { newSchedules: [fresh(), fresh({ key: "rate2", name: "가짜 중앙은행  기준금리 결정" })] }), D, /같은 파일의 새 일정 "rate"/);
    rejects(db, withNew({ name: "가짜 출시행사", due: "2026-12-01" }), D, /지운 일정 \d+\(가짜 출시 행사, 2026-12-01\)과 이름·예정일이 같다/);
    rejects(db, f({ "한국-1": [ids.upcoming, ids.upcoming] }), D, /같은 일정\(\d+\)이 두 번/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, result: "한국-2" }] }), D, /결과 후보가 아니다\(아직 예정일 전이다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.past, result: "한국-9" }] }), D, /결과 뉴스 한국-9가 2026-10-27의 뉴스가 아니다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.past, cancel: { story: "없음-1" } }] }), D, /취소를 알린 뉴스 없음-1가/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.done, postpone: { story: "한국-2", due: "2026-12-20" } }] }), D, /연기·취소를 쓸 수 없다\(이미 결과/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.past, result: "한국-2" }, { schedule: ids.past, cancel: { story: "한국-2" } }] }), D, /결과를 두 번/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-2", due: "2026-11-20" } }] }), D, /원래 예정일 2026-11-20보다 늦지 않다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.month, postpone: { story: "한국-2", due: "2026-11-25" } }] }), D, /늦지 않다\(달 단위는 다른 달/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-2", to: ids.upcoming } }] }), D, /자기 자신으로 연기할 수 없다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-2", to: ids.absorbed } }] }), D, /흡수되었다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-2", to: ids.deleted } }] }), D, /지운 일정이다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-2", due: "2026-12-16", to: ids.later } }] }), D, /하나만 쓴다/);
    rejects(db, f({}, { outcomes: [{ schedule: ids.upcoming, postpone: { story: "한국-9", due: "2026-12-04" } }] }), D, /연기를 알린 뉴스 한국-9가/);
    const stale = sched(db, "가짜 지난 박람회", "2026-10-10");
    rejects(db, f({}, { outcomes: [{ schedule: stale, cancel: { story: "한국-2" } }] }), D, /연기·취소를 쓸 수 없다\(예정일이 지났고 기다리는 기간도 지났다\)/);
    rejects(db, f({}, { outcomes: [{ schedule: stale, postpone: { story: "한국-2", due: "2026-12-04" } }] }), D, /연기·취소를 쓸 수 없다\(예정일이 지났고/);
    const twin = sched(db, "가짜 통계 발표", "2026-11-25");
    rejects(db, f({}, { outcomes: [{ schedule: ids.past, postpone: { story: "한국-2", due: "2026-11-25" } }] }), D, new RegExp(`기존 일정 ${twin}\\(가짜 통계 발표, 2026-11-25\\)과 이름·예정일이 겹친다`));
    rejects(db, f({}, { outcomes: [{ schedule: ids.past, postpone: { story: "한국-2", due: "2026-10-26" } }] }), D, /다음 날\(2026-10-28\)보다 이르다/);
    rejects(db, f({}, { confirms: [{ schedule: ids.upcoming, due: "2026-11-21", story: "한국-2" }] }), D, /달 단위가 아니다/);
    rejects(db, f({}, { confirms: [{ schedule: ids.month, due: "2026-12-03", story: "한국-2" }] }), D, /달\(2026-11\) 안의 일 단위 날짜가 아니다/);
    rejects(db, f({}, { confirms: [{ schedule: ids.month, due: "2026-11-03", story: "세계-9" }] }), D, /근거 뉴스 세계-9가/);
    rejects(db, f({ "한국-1": ["rate"] }, { newSchedules: [fresh(), fresh({ key: "x", name: "가짜 다른 일정" })] }), D, /"x": 어느 뉴스에도 연결되지 않았다/);
    db.close();
  });

  test("맞는 파일(새 일정, 기존 일정에 근거 더하기, 결과 연결, 두 가지 연기, 취소, 날짜 확정, 예정일 전의 연기·취소)은 통과해 적용된다", () => {
    const { db, ids } = checkDb();
    const extra = sched(db, "가짜 의회 표결", "2026-11-12");
    const pre = sched(db, "가짜 박람회 개막", "2026-11-25");
    const r = applyFile(
      db,
      schedFile(db, D, { "한국-1": ["rate", ids.upcoming], "세계-1": [ids.month] }, {
        newSchedules: [RATE],
        outcomes: [
          { schedule: ids.past, result: ["한국-2", "한국-3"] },
          { schedule: ids.upcoming, postpone: { story: "세계-2", due: "2026-12-04" } },
          { schedule: extra, postpone: { story: "세계-3", to: ids.later } },
          { schedule: pre, cancel: { story: "세계-4" } },
        ],
        confirms: [{ schedule: ids.month, due: "2026-11-03", story: "세계-1" }],
      }),
      D,
    );
    assert.deepEqual(r, { status: "applied", newSchedules: 1, attached: 2, results: 1, postponed: 2, cancelled: 1, confirmed: 1 });
    assert.equal(getSchedule(db, ids.past)!.outcome, "result");
    assert.deepEqual(storiesOfSchedule(db, ids.past, "result").map((s) => s.key), ["한국-2", "한국-3"]);
    const up = getSchedule(db, ids.upcoming)!;
    assert.equal(up.outcome, "postponed");
    const moved = getSchedule(db, up.postponedTo!)!;
    assert.deepEqual([moved.name, moved.due, moved.major], ["가짜 정상회담", "2026-12-04", "경제"]);
    assert.deepEqual(storiesOfSchedule(db, moved.id).map((s) => [s.key, s.role]), [["세계-2", "basis"]], "알린 뉴스가 새 일정의 근거 뉴스다");
    assert.deepEqual(schedulesOfStory(db, storyId(db, D, "세계-2")).map((x) => x.role).sort(), ["basis", "notice"]);
    assert.deepEqual([getSchedule(db, extra)!.outcome, getSchedule(db, extra)!.postponedTo], ["postponed", ids.later]);
    assert.equal(getSchedule(db, pre)!.outcome, "cancelled");
    assert.equal(getSchedule(db, ids.month)!.due, "2026-11-03");
    db.close();
  });

  test("결과 후보(예정일이 지난, 기다리는 기간 안의 일정)에도 연기와 취소를 쓸 수 있다", () => {
    const { db, ids } = checkDb();
    const other = sched(db, "가짜 통계 재발표", "2026-10-22");
    const r = applyFile(db, schedFile(db, D, {}, { outcomes: [{ schedule: ids.past, postpone: { story: "세계-2", due: "2026-11-10" } }, { schedule: other, cancel: { story: "세계-3" } }] }), D);
    assert.deepEqual([r.status === "applied" && r.postponed, r.status === "applied" && r.cancelled], [1, 1]);
    const p = getSchedule(db, ids.past)!;
    assert.equal(p.outcome, "postponed");
    assert.deepEqual([getSchedule(db, p.postponedTo!)!.name, getSchedule(db, p.postponedTo!)!.due], ["가짜 통계 발표", "2026-11-10"]);
    assert.equal(getSchedule(db, other)!.outcome, "cancelled");
    db.close();
  });
});

describe("5단계 4.2-5·4.5 일정 명령, 실패, start와 요약", () => {
  test("실패한 날짜는 다음 실행의 일정 뽑기 날짜에 다시 나오고 뉴스·이슈 연결·대상 연결은 그대로이며, 성공하면 요약에 수가 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r1 = startRun(repo, env);
    assert.match(r1.text, /- 일정 뽑기할 저장된 날짜\(채우기·재시도\): 없음/);
    assert.deepEqual(readRun(r1.runFile).scheduleDates, []);
    saveAll(repo, env, r1.runFile);
    const D = "2026-10-27";
    const list = cli(repo, ["schedules", "--run", r1.runFile, "--date", D], env);
    assert.equal(list.code, 0, list.text);
    assert.match(fs.readFileSync(scheduleWorkFile(dataDir, D, "schedules.md"), "utf8"), /## 결과 후보 \(0개\)/);
    const dbFile = path.join(dataDir, "tidwyn.db");
    const keep = () => {
      const db = openDb(dbFile);
      const d = dumpDb(db);
      db.close();
      return { stories: d.stories, issues: d.story_issues, entities: d.story_entities, terms: d.story_terms, extracted: d.extracted_dates };
    };
    {
      const db = openDb(dbFile);
      linkStory(db, storyId(db, D, "한국-1"), issue(db, "가짜 금리 이야기"), true);
      linkEntity(db, storyId(db, D, "한국-1"), createEntity(db, { kind: "기관", name: "가짜 중앙은행", aliases: [], description: "가짜국 중앙은행", describedOn: null, describedStory: null }));
      const term = Number(db.prepare("INSERT INTO terms (name, aliases, description) VALUES ('양적완화', '[]', '지어낸 용어다.')").run().lastInsertRowid);
      db.prepare("INSERT INTO story_terms (story_id, term_id, surface) VALUES (?, ?, '양적완화')").run(storyId(db, D, "한국-1"), term);
      db.close();
    }
    const before = keep();
    writeJson(scheduleWorkFile(dataDir, D, "schedules.json"), { date: D, newSchedules: [], stories: [] });
    assert.equal(cli(repo, ["schedule-check", "--run", r1.runFile, "--date", D], env).code, 1);
    const bad = cli(repo, ["schedule-apply", "--run", r1.runFile, "--date", D], env);
    assert.equal(bad.code, 1, bad.text);
    assert.equal(readRun(r1.runFile).schedules?.[D]?.status, "failed");
    assert.deepEqual(keep(), before);
    const s1 = cli(repo, ["summary", "--run", r1.runFile], env).text;
    assert.match(s1, /- 일정 뽑기:\n\s+- 2026-10-27: 일정 뽑기 실패\(뉴스, 이슈 연결, 인물·용어 뽑기는 그대로, 다음 실행이 다시 뽑는다\)/);
    assert.match(s1, /- stories: 뉴스 한국-1가 빠졌다/);
    assert.match(s1, /아직 일정 뽑기 안 한 날짜: 1개/);

    const DAY3 = new Date("2026-10-29T09:00:00+09:00");
    const r2 = startRun(repo, env, [], DAY3);
    assert.match(r2.text, /- 일정 뽑기할 저장된 날짜\(채우기·재시도\): 2026-10-27/);
    assert.deepEqual(readRun(r2.runFile).scheduleDates, ["2026-10-27"]);
    const db = openDb(dbFile);
    writeJson(scheduleWorkFile(dataDir, D, "schedules.json"), schedFile(db, D, { "한국-1": ["rate"] }, { newSchedules: [RATE] }));
    db.close();
    assert.equal(cli(repo, ["schedule-check", "--run", r2.runFile, "--date", D], env, DAY3).code, 0);
    const ok = cli(repo, ["schedule-apply", "--run", r2.runFile, "--date", D], env, DAY3);
    assert.equal(ok.code, 0, ok.text);
    assert.match(cli(repo, ["schedules", "--run", r2.runFile, "--date", D], env, DAY3).text, /할 일 없음/);
    assert.match(cli(repo, ["schedule-search", "--q", "중앙은행"], env).text, /- 일정 1 · 2026-11-05 · 경제 · 가짜 중앙은행 기준금리 결정 · 관련 이슈: 가짜 금리 이야기/);
    const s2 = cli(repo, ["summary", "--run", r2.runFile], env, DAY3).text;
    assert.match(s2, /- 2026-10-27: 새 일정 1개, 근거를 더한 기존 일정 0개, 결과 연결 0개, 연기 0개, 취소 0개/);
    assert.match(s2, /아직 일정 뽑기 안 한 날짜: 없음/);
  });

  test("시험 모드에서 일정 뽑기 실패는 실행 기록과 요약에 남고 백업을 멈추지 않는다", () => {
    const repo = tempRepo();
    const r = startRun(repo, {}, ["test"]);
    saveAll(repo, {}, r.runFile);
    const state = readRun(r.runFile);
    const D = state.targetDates[0]!;
    writeJson(scheduleWorkFile(state.dataDir, D, "schedules.json"), { date: D });
    assert.equal(cli(repo, ["schedule-apply", "--run", r.runFile, "--date", D], {}).code, 1);
    const b = cli(repo, ["backup", "--run", r.runFile], {});
    assert.equal(b.code, 0, b.text);
    const s = cli(repo, ["summary", "--run", r.runFile], {}).text;
    assert.match(s, new RegExp(`- ${D}: 일정 뽑기 실패`));
    assert.match(s, /- 백업: /);
    assert.equal(readRun(r.runFile).schedules?.[D]?.status, "failed");
  });

  test("요약의 합치기 줄에 일정 합치기와 되돌리는 명령이, 사이트 빌드 줄에 일정 수와 다가오는 일정 수가 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r = startRun(repo, env);
    const s = readRun(r.runFile);
    s.merge = { status: "merged", merges: [], schedules: [{ id: 4, survivor: 1, survivorName: "가짜 총선", absorbed: 2, absorbedName: "가짜국 총선 투표", reason: "같은 선거" }] };
    s.site = { status: "built", outDir: path.join(dataDir, "site"), dates: 2, issues: 3, entities: 12, terms: 4, schedules: 9, upcoming: 5, files: 40, bytes: 1_000_000 };
    writeRun(r.runFile, s);
    const out = cli(repo, ["summary", "--run", r.runFile], env).text;
    assert.match(out, /합치기: 이슈 0쌍, 대상·용어 0쌍, 일정 1쌍을 합쳤다\n\s+- 일정 합치기 4: 일정 2\(가짜국 총선 투표\) → 일정 1\(가짜 총선\)\. 이유: 같은 선거\. 되돌리기: node src\/cli\.ts schedule-unmerge --id 4/);
    assert.match(out, /파일 40개, 인물·기관·국가 12개, 용어 4개, 일정 9개\(다가오는 일정 5개\)/);
  });

  test("site 명령의 다가오는 일정 수는 실행한 날의 KST 날짜 기준이다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const { db } = schedDb(DATES, path.join(dataDir, "tidwyn.db"));
    sched(db, "가짜 지난 일정", "2026-10-27");
    sched(db, "가짜 오늘 일정", "2026-10-28");
    sched(db, "가짜 이번 달 일정", "2026-10");
    sched(db, "가짜 다음 일정", "2026-11-02");
    db.close();
    const ctx = makeCtx(repo, {}, NOW);
    const built: string[] = [];
    ctx.buildSite = ({ outDir }) => {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "index.html"), "<!doctype html>");
      built.push(outDir);
      return { ok: true };
    };
    assert.equal(main(["site", "--data-dir", dataDir], ctx), 0, ctx.text());
    assert.match(ctx.text(), /일정 4개\(다가오는 일정 3개\)/, "KST 2026-10-28 기준: 오늘, 이번 달, 다음 일정");
  });
});

describe("5단계 4.3 합치기, 되돌리기, 지우기", () => {
  function mergeDb() {
    const { db, dir } = schedDb();
    const ids = {
      a: sched(db, "가짜국 총선", "2026-11-10", [["2026-10-26", "세계-1"]], "국제"),
      b: sched(db, "가짜국  총선 투표", "2026-11-10", [["2026-10-27", "세계-1"], ["2026-10-26", "세계-1"]], "국제"),
      m1: sched(db, "가짜 법 시행", "2026-12", [["2026-10-26", "한국-3"]]),
      m2: sched(db, "가짜 법 시행일", "2026-12-01", [["2026-10-27", "한국-3"]]),
      far1: sched(db, "가짜 박람회", "2026-11-01", [["2026-10-26", "한국-4"]]),
      far2: sched(db, "가짜 박람회", "2026-11-09", [["2026-10-27", "한국-4"]]),
      x: sched(db, "가짜 철도 개통", "2026-11-10", [["2026-10-26", "한국-5"]]),
      n1: sched(db, "가짜 회담", "2026-11-15", [["2026-10-26", "IT·AI-1"]]),
      n2: sched(db, "가짜 회담 개최", "2026-11-15", [["2026-10-27", "IT·AI-1"]]),
      p1: sched(db, "가짜 정상회의", "2026-11-20", [["2026-10-26", "IT·AI-2"]]),
      p2: sched(db, "가짜 정상회의", "2026-11-21", [["2026-10-27", "IT·AI-2"]]),
      d1: sched(db, "가짜 출시", "2026-11-25", [["2026-10-26", "IT·AI-3"]]),
      d2: sched(db, "가짜 출시 행사", "2026-11-25", [["2026-10-27", "IT·AI-3"]]),
    };
    addScheduleNoMerge(db, ids.n1, ids.n2);
    updateSchedule(db, ids.p1, { outcome: "postponed", postponedTo: ids.p2 });
    assert.ok(deleteSchedule(db, ids.d2, TODAY).ok);
    return { db, dir, ids };
  }
  const pairs = (db: DatabaseSync) => scheduleMergeCandidates(db).map((p) => `${p.a.id}:${p.b.id}`);

  test("같은 날짜의 이름이 거의 같은 일정과 같은 달의 달·일 단위 일정이 후보이고, 날짜가 먼 쌍·관계없는 쌍·합치지 않음 쌍·연기 관계 쌍·지운 것은 아니다", () => {
    const { db, ids } = mergeDb();
    const p = pairs(db);
    assert.ok(p.includes(`${ids.a}:${ids.b}`), p.join(" "));
    assert.ok(p.includes(`${ids.m1}:${ids.m2}`), p.join(" "));
    for (const bad of [`${ids.far1}:${ids.far2}`, `${ids.n1}:${ids.n2}`, `${ids.p1}:${ids.p2}`]) assert.ok(!p.includes(bad), bad);
    assert.ok(!p.some((x) => x.split(":").includes(String(ids.d2)) || x.split(":").includes(String(ids.x))));
    db.close();
  });

  test("적용하면 연결을 옮기고 중복을 줄이며, 예정일·결과·흡수 표시·연기 대상·기록이 맞고, 거부 경우는 DB를 바꾸지 않는다", () => {
    const { db, ids } = mergeDb();
    const rejectsMerge = (entries: unknown[], why: RegExp) => {
      const before = dumpDb(db);
      const c = new Checker();
      checkScheduleMerges(c, db, { scheduleMerges: entries });
      assert.ok(c.violations.some((v) => why.test(`${v.where}: ${v.why}`)), `${why}: ${JSON.stringify(c.violations)}`);
      assert.deepEqual(dumpDb(db), before);
    };
    rejectsMerge([{ survivor: 999, absorbed: ids.a, reason: "같다" }], /일정 999이\(가\) 없다/);
    rejectsMerge([{ survivor: ids.a, absorbed: ids.d2, reason: "같다" }], /지운 일정이다/);
    rejectsMerge([{ survivor: ids.a, absorbed: ids.a, reason: "같다" }], /같은 일정끼리/);
    rejectsMerge([{ survivor: ids.a, absorbed: ids.b, reason: "" }], /이유: 비어 있으면 안 된다/);
    rejectsMerge([{ survivor: ids.n1, absorbed: ids.n2, reason: "같다" }], /합치지 않음/);
    rejectsMerge([{ survivor: ids.p2, absorbed: ids.p1, reason: "같다" }], /연기 대상으로 가리킨다/);
    const r1 = sched(db, "가짜 결과 일정", "2026-11-11");
    const r2 = sched(db, "가짜 결과 일정 둘", "2026-11-11");
    updateSchedule(db, r1, { outcome: "result" });
    updateSchedule(db, r2, { outcome: "cancelled" });
    rejectsMerge([{ survivor: r1, absorbed: r2, reason: "같다" }], /결과가 다르다/);
    // 연기 대상이 지워진 일정과 새 날짜 모르는 연기는 화면처럼 같은 결과(연기(새 날짜 모름))로 본다
    const gone = sched(db, "가짜 지운 연기 대상", "2026-12-20");
    const q1 = sched(db, "가짜 연기 일정", "2026-11-12");
    const q2 = sched(db, "가짜 연기 일정 둘", "2026-11-12");
    updateSchedule(db, q1, { outcome: "postponed", postponedTo: gone });
    updateSchedule(db, q2, { outcome: "postponed" });
    assert.ok(deleteSchedule(db, gone, TODAY).ok);
    const sameCheck = new Checker();
    checkScheduleMerges(sameCheck, db, { scheduleMerges: [{ survivor: q1, absorbed: q2, reason: "같다" }] });
    assert.deepEqual(sameCheck.violations, []);
    rejectsMerge([{ survivor: ids.a, absorbed: ids.b, reason: "같다", due: "2026-11-11" }], /두 일정의 예정일/);

    // 연기 대상 갱신: b를 가리키는 일정
    const pointer = sched(db, "가짜 사전 투표", "2026-11-03");
    updateSchedule(db, pointer, { outcome: "postponed", postponedTo: ids.b });
    linkSchedule(db, storyId(db, "2026-10-28", "세계-1"), ids.b, "result");
    updateSchedule(db, ids.b, { outcome: "result" });
    const [mid] = mergeSchedules(db, [{ survivor: ids.a, absorbed: ids.b, reason: "같은 선거" }]);
    const a = getSchedule(db, ids.a)!;
    assert.deepEqual([a.due, a.outcome], ["2026-11-10", "result"], "남는 것에 결과가 없으면 흡수된 것의 결과");
    assert.deepEqual(storiesOfSchedule(db, ids.a).map((s) => [s.date, s.key, s.role]), [["2026-10-26", "세계-1", "basis"], ["2026-10-27", "세계-1", "basis"], ["2026-10-28", "세계-1", "result"]]);
    assert.deepEqual(storiesOfSchedule(db, ids.b), []);
    assert.equal(getSchedule(db, ids.b)!.mergedInto, ids.a);
    assert.equal(getSchedule(db, pointer)!.postponedTo, ids.a);
    const rec = listScheduleMerges(db).find((m) => m.id === mid)!;
    assert.deepEqual([rec.survivor, rec.absorbed, rec.reason, rec.mergedOn], [ids.a, ids.b, "같은 선거", TODAY]);
    assert.deepEqual(rec.record.repointed, [pointer]);
    // 달 단위 남는 것 + 일 단위 흡수 → 일 단위
    mergeSchedules(db, [{ survivor: ids.m1, absorbed: ids.m2, reason: "같은 시행" }]);
    assert.equal(getSchedule(db, ids.m1)!.due, "2026-12-01");
    rejectsMerge([{ survivor: ids.a, absorbed: ids.b, reason: "같다" }], /이미 일정 \d+에 흡수되었다/);
    db.close();
  });

  test("되돌리면 합치기 전과 같아지고, 합친 뒤 붙은 근거는 남는 것에 남으며, 그 쌍은 후보에서 빠지고, 연달아 합쳐졌거나 이미 되돌렸으면 거부한다", () => {
    const { db, ids } = mergeDb();
    const before = { a: getSchedule(db, ids.a), b: getSchedule(db, ids.b), la: storiesOfSchedule(db, ids.a), lb: storiesOfSchedule(db, ids.b) };
    const [m] = mergeSchedules(db, [{ survivor: ids.a, absorbed: ids.b, reason: "같은 선거" }]);
    linkSchedule(db, storyId(db, "2026-10-28", "세계-1"), ids.a, "basis");
    const r = unmergeSchedule(db, m!, TODAY);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    assert.deepEqual(getSchedule(db, ids.a), before.a);
    assert.deepEqual(getSchedule(db, ids.b), before.b);
    assert.deepEqual(storiesOfSchedule(db, ids.b), before.lb);
    assert.deepEqual(storiesOfSchedule(db, ids.a).map((s) => s.date), [...before.la.map((s) => s.date), "2026-10-28"], "합친 뒤 붙은 근거는 남는다");
    assert.ok(!pairs(db).includes(`${ids.a}:${ids.b}`));
    const again = unmergeSchedule(db, m!, TODAY);
    assert.ok(!again.ok && /이미/.test(again.reason));
    const [m2] = mergeSchedules(db, [{ survivor: ids.m1, absorbed: ids.m2, reason: "같은 시행" }]);
    mergeSchedules(db, [{ survivor: ids.x, absorbed: ids.m1, reason: "시험" }]);
    const chained = unmergeSchedule(db, m2!, TODAY);
    assert.ok(!chained.ok && /연달아/.test(chained.reason));
    db.close();
  });

  test("지우면 연결이 없고 사이트 데이터에 없으며, 같은 이름(띄어쓰기만 다른 표기)·같은 예정일의 새 일정은 거부되고(다른 날짜면 통과), 가리키던 일정은 연기(새 날짜 모름)가 된다", () => {
    const { db } = schedDb();
    const target = sched(db, "가짜 철도 개통", "2026-11-20", [["2026-10-26", "한국-2"], ["2026-10-27", "한국-2"]]);
    const absorbed = sched(db, "가짜 철도 개통식", "2026-11-20");
    mergeSchedules(db, [{ survivor: target, absorbed, reason: "같은 개통" }]);
    const pointer = sched(db, "가짜 시범 운행", "2026-11-10");
    updateSchedule(db, pointer, { outcome: "postponed", postponedTo: absorbed });
    const r = deleteSchedule(db, target, TODAY);
    assert.ok(r.ok);
    assert.deepEqual([r.links, r.ids, r.pointing], [2, [target, absorbed], [pointer]]);
    assert.deepEqual(storiesOfSchedule(db, target), []);
    const site = [...buildSiteData(db).values()].join("\n");
    assert.ok(!site.includes("가짜 철도 개통"), "사이트 데이터에 지운 일정이 없다");
    const month = JSON.parse(buildSiteData(db).get("site-data/schedule-month-2026-11.json")!) as ScheduleMonth;
    assert.deepEqual(month.items.find((x) => x.id === pointer)!.outcome, { status: "postponed", to: null });
    const file = (due: string) => schedFile(db, "2026-10-28", { "한국-1": ["x"] }, { newSchedules: [{ key: "x", name: "가짜철도 개통", due, major: "경제" }] });
    rejects(db, file("2026-11-20"), "2026-10-28", /지운 일정 \d+\(가짜 철도 개통, 2026-11-20\)과 이름·예정일이 같다/);
    assert.ok(checkScheduleFile(db, file("2026-11-21"), "2026-10-28").ok);
    const absorbedDel = deleteSchedule(db, absorbed, TODAY);
    assert.ok(!absorbedDel.ok && /이미 지웠다/.test(absorbedDel.reason), "흡수되어 있던 것도 지운 것으로 본다");
    db.close();
  });

  test("명령: 흡수된 식별자로 지우면 거부하고 남는 것을 알리며, 실제 데이터 폴더 조건을 어기면 지우기·되돌리기가 거부되고 DB가 바뀌지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const { db } = schedDb(["2026-10-27"], path.join(dataDir, "tidwyn.db"));
    const a = sched(db, "가짜 출시", "2026-11-10", [["2026-10-27", "한국-1"]]);
    const b = sched(db, "가짜 출시 행사", "2026-11-10", [["2026-10-27", "한국-2"]]);
    mergeSchedules(db, [{ survivor: a, absorbed: b, reason: "같은 출시" }]);
    db.close();
    const r = cli(repo, ["schedule-delete", "--id", String(b)], env);
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, new RegExp(`일정 ${b}은\\(는\\) 일정 ${a}\\(가짜 출시\\)에 흡수되었다. 남는 일정 ${a}을\\(를\\) 지운다`));
    assert.match(cli(repo, ["merges"], env).text, /일정 합치기 1 \(2026-10-29\): 일정 2\(가짜 출시 행사\) → 일정 1\(가짜 출시\)\. 이유: 같은 출시 · 되돌리기: node src\/cli\.ts schedule-unmerge --id 1/);
    const un = cli(repo, ["schedule-unmerge", "--id", "1"], env);
    assert.equal(un.code, 0, un.text);
    assert.match(un.text, /실행 전 사본: /);
    const ok = cli(repo, ["schedule-delete", "--id", String(a)], env);
    assert.equal(ok.code, 0, ok.text);
    for (const line of [/지움: 일정 1 \(가짜 출시, 2026-11-10\)/, /끊은 연결: 1개/, /다음 \/brief 실행이 백업하고 사이트에 배포한다/, /이미 push된 data 브랜치/, /뉴스 본문/, /deploy --dir --db/]) assert.match(ok.text, line);

    const realRepo = tempRepo();
    const dbFile = path.join(realRepo, "data", "tidwyn.db");
    const r2 = schedDb(["2026-10-27"], dbFile);
    const c = sched(r2.db, "가짜 출시", "2026-11-10", [["2026-10-27", "한국-1"]]);
    const d = sched(r2.db, "가짜 출시 행사", "2026-11-10", [["2026-10-27", "한국-2"]]);
    mergeSchedules(r2.db, [{ survivor: c, absorbed: d, reason: "같은 출시" }]);
    r2.db.close();
    gitIn(realRepo, "switch", "-q", "-c", "other");
    const before = fs.readFileSync(dbFile);
    for (const argv of [["schedule-delete", "--id", String(c)], ["schedule-unmerge", "--id", "1"]]) {
      const x = cli(realRepo, argv, {});
      assert.equal(x.code, 3, x.text);
      assert.match(x.text, /실행 조건이 맞지 않아/);
    }
    assert.deepEqual(fs.readFileSync(dbFile), before);
  });
});

describe("5단계 4.3-1 합치기 점검일(이슈·대상·용어·일정을 한 번으로 본다)", () => {
  function dueDir() {
    const repo = tempRepo();
    const dataDir = tempDir();
    const { db } = schedDb(DATES, path.join(dataDir, "tidwyn.db"));
    const a = sched(db, "가짜국 총선", "2026-11-10", [["2026-10-27", "세계-1"]]);
    const b = sched(db, "가짜국 총선 투표", "2026-11-10", [["2026-10-28", "세계-1"]]);
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

  test("일정 후보만 있어도 merge-list는 점검일을 바꾸지 않고 후보를 쓰며, 일정 부분이 검사에 걸리면 점검일을 바꾸지 않고, 고쳐서 통과하면 합치고 바꾼다", () => {
    const { repo, dataDir, env, a, b, runFile } = dueDir();
    const l = cli(repo, ["merge-list", "--run", runFile], env);
    assert.match(l.text, /후보 이슈 0쌍, 대상 0쌍, 용어 0쌍, 일정 1쌍/);
    assert.match(fs.readFileSync(mergeWorkFile(dataDir, "candidates.md"), "utf8"), /## 일정 후보 \(1쌍\)[\s\S]*- 일정 1: 가짜국 총선 \(2026-11-10, 경제\)/);
    assert.equal(checked(dataDir), null);
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [], scheduleMerges: [{ survivor: a, absorbed: b, reason: "" }] });
    assert.equal(cli(repo, ["merge-apply", "--run", runFile], env).code, 1);
    assert.equal(checked(dataDir), null);
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [], scheduleMerges: [{ survivor: a, absorbed: b, reason: "같은 선거" }] });
    assert.equal(cli(repo, ["merge-check", "--run", runFile], env).code, 0);
    const ok = cli(repo, ["merge-apply", "--run", runFile], env);
    assert.equal(ok.code, 0, ok.text);
    assert.match(ok.text, /일정 1쌍/);
    assert.equal(checked(dataDir), kstDate(NOW));
    const m = readRun(runFile).merge;
    assert.ok(m?.status === "merged" && m.schedules?.length === 1);
  });
});

describe("5단계 4.4-2 결과물 검사", () => {
  test("일정 백업 파일과 일정 작업 파일 이름은 결과물 검사에 걸리고, 일정 사이트 데이터 이름은 걸리지 않는다", () => {
    const out = tempDir();
    for (const f of ["schedules.json", "deep/schedules.json", "2026-10-27.schedules.md", "2026-10-27.schedules.json", "site-data/schedule-index.json", "site-data/schedule-month-2026-10.json", "site-data/schedule-ref-0.json"]) {
      fs.mkdirSync(path.dirname(path.join(out, f)), { recursive: true });
      fs.writeFileSync(path.join(out, f), "{}");
    }
    assert.deepEqual(checkOutput(out, null).findings.map((x) => `${x.where} ${x.kind}`).sort(), [
      "2026-10-27.schedules.json 실행 기록·작업 파일",
      "2026-10-27.schedules.md 실행 기록·작업 파일",
      "deep/schedules.json 백업 파일 이름",
      "schedules.json 백업 파일 이름",
    ]);
  });
});

describe("5단계 4.4-1 백업과 복원", () => {
  test("일정·연결·결과·합치기·지우기가 있는 DB를 백업하고 복원하면 같고, 가장 큰 식별자를 지운 뒤 복원해도 새 식별자는 다르다", () => {
    const { db, dir } = schedDb();
    const a = sched(db, "가짜국 총선", "2026-11-10");
    const b = sched(db, "가짜국 총선 투표", "2026-11-10");
    const c = sched(db, "가짜 회담", "2026-12");
    linkSchedule(db, storyId(db, "2026-10-28", "한국-1"), c, "result");
    updateSchedule(db, c, { outcome: "result" });
    const p = sched(db, "가짜 정상회의", "2026-11-20");
    updateSchedule(db, p, { outcome: "postponed", postponedTo: a });
    linkSchedule(db, storyId(db, "2026-10-28", "한국-2"), p, "notice");
    const [m] = mergeSchedules(db, [{ survivor: a, absorbed: b, reason: "같은 선거" }]);
    assert.ok(unmergeSchedule(db, m!, TODAY).ok);
    const last = sched(db, "가짜 마지막 일정", "2026-12-24");
    assert.ok(deleteSchedule(db, last, TODAY).ok);
    for (const d of ["2026-10-26", "2026-10-28"]) db.prepare("INSERT INTO schedule_dates (target_date) VALUES (?)").run(d);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const files = readBackupDir(out);
    assert.ok(files.has("schedules.json"));
    assert.deepEqual(JSON.parse(files.get("2026-10.json")!).scheduled, ["2026-10-26", "2026-10-28"]);
    const dump = dumpDb(db);
    db.close();
    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(files, restored);
    const db2 = openDb(restored);
    assert.deepEqual(Object.fromEntries(buildBackup(db2)), Object.fromEntries(files));
    const dump2 = dumpDb(db2);
    for (const t of ["schedules", "schedule_dates", "schedule_merges", "schedule_no_merge"]) assert.deepEqual(dump2[t], dump[t], t);
    assert.deepEqual(schedulableDates(db2), ["2026-10-27"]);
    assert.ok(createSchedule(db2, { name: "새 가짜 일정", due: "2026-12-30", major: "경제" }) > last);
    db2.close();
  });

  test("일정 데이터가 없는 DB의 백업은 형식 버전 말고는 앞 형식과 같은 파일·키를 내고, 형식 3 백업을 복원하면 모든 날짜가 일정 뽑기 대상이다", () => {
    const { db } = schedDb(["2026-10-26", "2026-10-27"]);
    const files = buildBackup(db);
    db.close();
    assert.deepEqual([...files.keys()].sort(), ["2026-10.json", "meta.json"]);
    assert.deepEqual(Object.keys(JSON.parse(files.get("2026-10.json")!)), ["formatVersion", "month", "briefs"]);
    const v3 = new Map([...files].map(([k, v]) => [k, JSON.stringify({ ...JSON.parse(v), formatVersion: 3 })]));
    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(v3, restored);
    const db2 = openDb(restored);
    assert.deepEqual(schedulableDates(db2), ["2026-10-26", "2026-10-27"]);
    db2.close();
  });
});

/** 사이트 데이터 테스트용 DB: 날짜 10개(10-20 ~ 10-29), 일·달 단위, 다섯 결과 상태, 합친 일정, 지운 일정, 합친 이슈 */
function siteDb() {
  const dates = Array.from({ length: 10 }, (_, i) => `2026-10-${String(20 + i).padStart(2, "0")}`);
  const { db, dir } = schedDb(dates);
  const iMain = issue(db, "가짜 금리 이야기");
  const iOld = issue(db, "가짜 금리 논쟁");
  linkStory(db, storyId(db, "2026-10-20", "한국-1"), iOld, true);
  linkStory(db, storyId(db, "2026-10-24", "한국-1"), iMain, true);
  linkStory(db, storyId(db, "2026-10-26", "한국-3"), iMain, true);
  applyMerges(db, [{ survivor: iMain, absorbed: iOld, reason: "같은 금리 이야기", summary: "합친 요약이다." }], TODAY);
  const ids = {
    rate: sched(db, "가짜 중앙은행 기준금리 결정", "2026-10-25", [["2026-10-20", "한국-1"], ["2026-10-22", "한국-1"]]),
    week: sched(db, "가짜 물가 발표", "2026-10-27", [["2026-10-21", "한국-2"]]),
    late: sched(db, "가짜 늦은 발표", "2026-10-26", [["2026-10-24", "한국-2"]]),
    cancelled: sched(db, "가짜 행사", "2026-10-28", [["2026-10-21", "세계-2"]], "국제"),
    postponed: sched(db, "가짜 정상회담", "2026-10-30", [["2026-10-22", "세계-3"]], "국제"),
    moved: sched(db, "가짜 정상회담", "2026-11-12", [["2026-10-25", "세계-3"]], "국제"),
    missing: sched(db, "가짜 지난 표결", "2026-10-10", [["2026-10-20", "IT·AI-1"]], "정치"),
    pending: sched(db, "가짜 법 시행", "2026-11", [["2026-10-23", "IT·AI-2"]], "정치"),
    survivor: sched(db, "가짜국 총선", "2026-11-04", [["2026-10-27", "세계-1"]], "국제"),
    absorbed: sched(db, "가짜국 총선 투표", "2026-11-04", [["2026-10-28", "세계-1"]], "국제"),
    deleted: sched(db, "가짜 지울 일정", "2026-10-29", [["2026-10-21", "IT·AI-3"]]),
  };
  linkSchedule(db, storyId(db, "2026-10-26", "한국-3"), ids.rate, "result");
  updateSchedule(db, ids.rate, { outcome: "result" });
  updateSchedule(db, ids.cancelled, { outcome: "cancelled" });
  updateSchedule(db, ids.postponed, { outcome: "postponed", postponedTo: ids.moved });
  mergeSchedules(db, [{ survivor: ids.survivor, absorbed: ids.absorbed, reason: "같은 선거" }]);
  assert.ok(deleteSchedule(db, ids.deleted, TODAY).ok);
  return { db, dir, ids, iMain, iOld };
}

const parse = <T>(files: Map<string, string>, name: string): T => JSON.parse(files.get(`site-data/${name}`)!) as T;

describe("5단계 4.6 사이트 데이터", () => {
  test("일정 목록·결과·이번 주 일정(브리프 날짜 기준, 알려진 날 조건)·카드 칩·이슈 일정이 맞고, 흡수된 이슈의 일정은 남는 이슈에 붙으며, 지운 것은 어디에도 없다", () => {
    const { db, ids, iMain, iOld } = siteDb();
    const files = buildSiteData(db);
    const index = parse<ScheduleIndex>(files, "schedule-index.json");
    assert.deepEqual(index.months.map((m) => [m.month, m.count]), [["2026-10", 6], ["2026-11", 3]]);
    assert.deepEqual(index.majors, ["정치", "경제", "국제"]);
    assert.equal(index.total, 9);
    const oct = parse<ScheduleMonth>(files, "schedule-month-2026-10.json").items;
    const nov = parse<ScheduleMonth>(files, "schedule-month-2026-11.json").items;
    assert.deepEqual(nov.map((x) => x.id), [ids.survivor, ids.moved, ids.pending], "달 단위는 그 달 일 단위 뒤");
    const by = (id: number) => [...oct, ...nov].find((x) => x.id === id)!;
    assert.deepEqual(by(ids.rate), {
      id: ids.rate,
      name: "가짜 중앙은행 기준금리 결정",
      due: "2026-10-25",
      outcome: { status: "result", news: [{ date: "2026-10-26", key: "한국-3", title: "한국 뉴스 3의 핵심을 담은 제목" }] },
      major: "경제",
      issue: { id: iMain, name: "가짜 금리 이야기" },
      issues: [{ id: iMain, name: "가짜 금리 이야기" }],
      knownOn: "2026-10-20",
      first: { date: "2026-10-20", key: "한국-1" },
    } satisfies ScheduleItem);
    assert.deepEqual(by(ids.postponed).outcome, { status: "postponed", to: { id: ids.moved, due: "2026-11-12" } });
    assert.deepEqual(by(ids.cancelled).outcome, { status: "cancelled" });
    assert.deepEqual(by(ids.missing).outcome, { status: "missing" }, "기준일 10-29에 기다리는 기간(10-24까지)이 지났다");
    assert.deepEqual(by(ids.week).outcome, { status: "pending" });
    assert.deepEqual(by(ids.pending).outcome, { status: "pending" });
    assert.equal(by(ids.week).issue, null, "처음 근거 뉴스에 주 이슈가 없으면 null");
    const refs = parse<ScheduleRefChunk>(files, "schedule-ref-0.json");
    assert.equal(refs.months[String(ids.pending)], "2026-11");
    assert.deepEqual(refs.merged, { [String(ids.absorbed)]: ids.survivor });
    assert.equal(refs.months[String(ids.deleted)], undefined);

    const day = (date: string): DayList => parse<MonthList>(files, "list-2026-10.json").days.find((d) => d.date === date)!;
    assert.deepEqual(day("2026-10-20").week?.items.map((x) => x.id), [ids.rate], "알려진 날 10-20 이하인 것만(10-21에 알려진 물가 발표는 아니다)");
    assert.deepEqual(day("2026-10-21").week?.items.map((x) => x.id), [ids.rate, ids.week, ids.cancelled]);
    assert.deepEqual(day("2026-10-21").week?.items[2]!.outcome, { status: "cancelled" });
    assert.deepEqual(day("2026-10-29").week?.items.map((x) => x.id), [ids.postponed, ids.survivor], "범위 10-30~11-05, 달 단위(11월 법 시행)와 범위 밖(11-12)은 빠진다");
    assert.equal(day("2026-10-23").week?.items.some((x) => x.id === ids.late), false, "10-26 늦은 발표는 10-24에 알려져 10-23에는 없다");
    assert.equal(day("2026-10-24").week?.items.some((x) => x.id === ids.late), true);
    assert.deepEqual(day("2026-10-28").week?.items.map((x) => x.id), [ids.postponed, ids.survivor]);

    const detail = parse<MonthDetail>(files, "detail-2026-10.json");
    assert.deepEqual(detail.days["2026-10-20"]!["한국-1"]!.schedules, [{ id: ids.rate, name: "가짜 중앙은행 기준금리 결정", due: "2026-10-25" }]);
    assert.deepEqual(detail.days["2026-10-28"]!["세계-1"]!.schedules, [{ id: ids.survivor, name: "가짜국 총선", due: "2026-11-04" }], "흡수된 일정의 근거는 남는 것으로 옮겨졌다");
    assert.equal(detail.days["2026-10-21"]!["IT·AI-3"]!.schedules, undefined, "지운 일정의 칩은 없다");
    const issues = parse<IssueChunk>(files, "issue-0.json").issues;
    assert.deepEqual(issues[String(iMain)]!.schedules?.map((x) => x.id), [ids.rate]);
    assert.equal(issues[String(iOld)], undefined);
    const all = [...files.values()].join("\n");
    assert.ok(!all.includes("가짜 지울 일정"));
    db.close();
  });

  test("같은 DB면 같은 결과이고, 백업을 복원해 다시 만들어도 같다", () => {
    const { db, dir } = siteDb();
    const a = Object.fromEntries(buildSiteData(db));
    assert.deepEqual(Object.fromEntries(buildSiteData(db)), a);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    db.close();
    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(readBackupDir(out), restored);
    const db2 = openDb(restored);
    assert.deepEqual(Object.fromEntries(buildSiteData(db2)), a);
    db2.close();
  });
});
