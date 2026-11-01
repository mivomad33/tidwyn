import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { checkBuilderFile } from "../src/builderCheck.ts";
import { dueReminders, placeOnCalendar } from "../src/builderSchedule.ts";
import { builderItemsOfDate, firstItemDate, insertBuilderItem, itemsOfSchedule, reminderOf, setReminder, type BuilderDue, type NewBuilderItem } from "../src/builderStore.ts";
import { buildWorkData, renderBuilderList } from "../src/builderWork.ts";
import { checkScheduleFile, scheduleCandidates } from "../src/scheduleExtract.ts";
import { applyScheduleMerges, deleteSchedule, renderScheduleMergeCandidates, scheduleMergeCandidates, unmergeSchedule } from "../src/scheduleMerge.ts";
import { buildScheduleData } from "../src/scheduleSite.ts";
import { allSchedules, createSchedule, getSchedule, knownOn, linkSchedule, updateSchedule } from "../src/schedules.ts";
import { storiesOfDate, inTransaction } from "../src/issues.ts";
import { siteFiles, type ScheduleMonth } from "../src/siteTypes.ts";
import { HOUR, NOW, TARGET, apply, env, fakeHttp, item, itemsFile, nextDay, rss, run, type Env } from "./builderFixtures.ts";
import { addDays } from "../src/kst.ts";
import { cleanupTemp } from "./helpers.ts";

after(cleanupTemp);

let serial = 0;
const dep = (model: string, due: string, state = "확정") => `deprecation:${model}:${due}:${state}`;

function newItem(keys: string[], due: BuilderDue | null): NewBuilderItem {
  return { field: "모델", title: "가짜 모델 종료", whatChanged: "가짜 모델이 종료된다", who: "가짜 모델 사용자", action: "옮긴다", why: "기한이 있다", due, sources: [{ name: "가짜", url: `https://platform.claude.com/docs/${++serial}` }], issue: null, reminderOf: null, keys };
}

function seed(e: Env, keys: string[], date: string, name: string, base = TARGET, state: BuilderDue["state"] = "confirmed") {
  const due = { date, state };
  const id = insertBuilderItem(e.db, base, newItem(keys, due));
  const placed = placeOnCalendar(e.db, id, { keys, due, scheduleName: state === "confirmed" ? name : null }, base);
  return { id, placed };
}

describe("4.4-1 달력에 올리기", () => {
  test("확정은 일정이 생기고 IT·AI이며, 잠정, 달 단위, 기한 없음은 안 생긴다", () => {
    const e = env();
    const { placed } = seed(e, [dep("m-1", "2027-01-14")], "2027-01-14", "m-1 종료");
    const s = getSchedule(e.db, placed.schedule!)!;
    assert.deepEqual([s.name, s.due, s.major], ["m-1 종료", "2027-01-14", "IT·AI"]);
    const before = allSchedules(e.db).length;
    seed(e, [dep("m-2", "2027-02-01", "잠정")], "2027-02-01", "m-2 종료", TARGET, "tentative");
    seed(e, [], "2027-03", "m-3 종료");
    placeOnCalendar(e.db, insertBuilderItem(e.db, "2026-10-26", newItem([], null)), { keys: [], due: null, scheduleName: null }, TARGET);
    assert.equal(allSchedules(e.db).length, before);
  });

  test("같은 일정은 이어지고, 같은 달의 달 단위 일정은 이어지며 일 단위가 되고, 뉴스 일정에도 잇는다", () => {
    const e = env();
    const news = createSchedule(e.db, { name: "가짜 모델 종료", due: "2027-01", major: "경제" });
    const a = seed(e, [dep("m-1", "2027-01-14")], "2027-01-14", "가짜 모델  종료");
    assert.equal(a.placed.schedule, news);
    assert.equal(a.placed.upgraded, 1);
    assert.equal(getSchedule(e.db, news)!.due, "2027-01-14");
    const b = seed(e, [dep("m-2", "2027-01-14")], "2027-01-14", "가짜 모델 종료", "2026-10-26");
    assert.equal(b.placed.schedule, news);
    assert.equal(allSchedules(e.db).length, 1);
  });

  test("지운 일정은 되살아나지 않는다", () => {
    const e = env();
    const a = seed(e, [dep("m-1", "2027-01-14")], "2027-01-14", "m-1 종료");
    assert.ok(deleteSchedule(e.db, a.placed.schedule!, TARGET).ok);
    const b = seed(e, [dep("m-1", "2027-01-14")], "2027-01-14", "m-1 종료", "2026-10-26");
    assert.equal(b.placed.schedule, null);
    assert.equal(b.placed.deletedTwin, true);
    assert.equal(allSchedules(e.db).length, 1);
  });

  test("종료일이 늦어지면 옛 빌더 일정이 연기가 되고 옛 날짜의 D-7이 나오지 않으며, 뉴스 근거 일정은 그대로다", () => {
    const e = env(TARGET);
    const a = seed(e, [dep("m-1", "2026-11-01")], "2026-11-01", "m-1 종료", "2026-10-20");
    const news = seed(e, [dep("m-2", "2026-11-02")], "2026-11-02", "m-2 종료", "2026-10-21");
    linkSchedule(e.db, storiesOfDate(e.db, TARGET)[0]!.id, news.placed.schedule!, "basis");
    const b = seed(e, [dep("m-1", "2027-01-14"), dep("m-2", "2027-01-14")], "2027-01-14", "m-1 m-2 종료", TARGET);
    const old = getSchedule(e.db, a.placed.schedule!)!;
    assert.deepEqual([old.outcome, old.postponedTo], ["postponed", b.placed.schedule]);
    assert.equal(getSchedule(e.db, news.placed.schedule!)!.outcome, null, "뉴스 근거 일정은 그대로다");
    assert.deepEqual(b.placed.newsKept, [news.placed.schedule]);
    assert.deepEqual(dueReminders(e.db, TARGET).map((r) => r.schedule), [news.placed.schedule]);
  });

  test("앞당겨지면 연기 표시가 없고 옛 날짜의 D-7이 나오지 않는다", () => {
    const e = env();
    const a = seed(e, [dep("m-1", "2026-11-02")], "2026-11-02", "m-1 종료", "2026-10-10");
    const b = seed(e, [dep("m-1", "2027-01-14")], "2027-01-14", "m-1 종료(늦은)", "2026-10-11");
    const later = getSchedule(e.db, b.placed.schedule!)!;
    const c = seed(e, [dep("m-1", "2026-12-01")], "2026-12-01", "m-1 앞당김", TARGET);
    assert.equal(c.placed.schedule, later.id, "지금 일정의 예정일을 고쳐 잇는다");
    assert.equal(c.placed.moved, 1);
    const s = getSchedule(e.db, later.id)!;
    assert.deepEqual([s.due, s.outcome], ["2026-12-01", null]);
    assert.equal(getSchedule(e.db, a.placed.schedule!)!.outcome, "postponed");
    assert.deepEqual(dueReminders(e.db, TARGET), []);
  });

  test("새 기한이 잠정이면 옛 빌더 일정이 새 날짜 모름 연기가 된다", () => {
    const e = env();
    const a = seed(e, [dep("m-1", "2026-12-01")], "2026-12-01", "m-1 종료", "2026-10-10");
    seed(e, [dep("m-1", "2027-02-01", "잠정")], "2027-02-01", "x", TARGET, "tentative");
    const s = getSchedule(e.db, a.placed.schedule!)!;
    assert.deepEqual([s.outcome, s.postponedTo], ["postponed", null]);
  });

  test("이름이 같아도 다른 모델의 일정은 연기되지 않고, 일부만 겹치면 옛 일정을 둔다", () => {
    const e = env();
    const a = seed(e, [dep("m-1", "2026-12-01")], "2026-12-01", "Claude 종료", "2026-10-10");
    seed(e, [dep("m-2", "2027-02-01")], "2027-02-01", "Claude 종료", TARGET);
    assert.equal(getSchedule(e.db, a.placed.schedule!)!.outcome, null);
    const past = seed(e, [dep("o-1", "2026-10-20")], "2026-10-20", "지난 종료", "2026-09-01");
    seed(e, [dep("o-1", "2027-04-01")], "2027-04-01", "새 종료", TARGET);
    assert.equal(getSchedule(e.db, past.placed.schedule!)!.outcome, null, "지난 일정은 연기로 두지 않는다");
    const both = seed(e, [dep("p-1", "2026-12-05"), dep("p-2", "2026-12-05")], "2026-12-05", "둘 종료", "2026-10-10");
    seed(e, [dep("p-1", "2027-03-01")], "2027-03-01", "하나 종료", TARGET);
    assert.equal(getSchedule(e.db, both.placed.schedule!)!.outcome, null);
  });
});

describe("4.4-2 달력 표시", () => {
  test("지난 예정일의 빌더 일정은 결과 후보에 없고 결과 못 찾음이 아니며 사이트 값에 항목 링크가 있다", () => {
    const e = env("2026-11-20");
    const a = seed(e, [dep("m-1", "2026-11-01")], "2026-11-01", "m-1 종료", "2026-10-20");
    const date = "2026-11-10";
    assert.deepEqual(scheduleCandidates(e.db, date).results, []);
    const c = checkScheduleFile(e.db, { date, newSchedules: [], stories: [], outcomes: [{ schedule: a.placed.schedule, result: "x" }] }, date);
    assert.ok(!c.ok && c.violations.some((v) => v.why.includes("빌더 일정")), "결과 연결은 거부한다");
    const site = buildScheduleData(e.db, ["2026-11-20"]);
    const month = JSON.parse(site.files.get(siteFiles.scheduleMonth("2026-11"))!) as ScheduleMonth;
    assert.equal(month.items[0]!.outcome.status, "pending");
    assert.deepEqual(month.items[0]!.builder, { date: "2026-10-20", key: "builder-1" });
    assert.equal(month.items[0]!.knownOn, "2026-10-20");
    assert.equal(month.items[0]!.first, null);
    assert.equal(month.items[0]!.issue, null);
  });

  test("뉴스 근거가 붙으면 기존 결과 흐름을 따르고 알려진 날은 이른 쪽이다", () => {
    const e = env("2026-10-25", "2026-11-20");
    const a = seed(e, [dep("m-1", "2026-11-01")], "2026-11-01", "m-1 종료", "2026-10-26");
    const id = a.placed.schedule!;
    assert.equal(knownOn(e.db, id), "2026-10-26");
    linkSchedule(e.db, storiesOfDate(e.db, "2026-10-25")[0]!.id, id, "basis");
    assert.equal(knownOn(e.db, id), "2026-10-25");
    assert.equal(firstItemDate(e.db, id), "2026-10-26");
    assert.deepEqual(scheduleCandidates(e.db, "2026-11-10").results.map((s) => s.id), [id]);
    const month = JSON.parse(buildScheduleData(e.db, []).files.get(siteFiles.scheduleMonth("2026-11"))!) as ScheduleMonth;
    assert.equal(month.items[0]!.outcome.status, "missing");
  });

  test("항목 날짜 이후의 이번 주 일정에 나오고 그 전 날짜에는 없다", () => {
    const e = env();
    seed(e, [dep("m-1", "2026-11-01")], "2026-11-01", "m-1 종료", "2026-10-28");
    const weeks = buildScheduleData(e.db, ["2026-10-27", "2026-10-28"]).weeks;
    assert.equal(weeks.has("2026-10-27"), false);
    assert.equal(weeks.get("2026-10-28")!.items[0]!.name, "m-1 종료");
  });

  test("뉴스 일정과 빌더 일정이 합치기 후보에 나오고 합치기, 되돌리기, 지우기가 항목 연결을 맞게 다룬다", () => {
    const e = env(TARGET);
    const news = createSchedule(e.db, { name: "가짜 모델 종료 예정", due: "2026-12-01", major: "IT·AI" });
    linkSchedule(e.db, storiesOfDate(e.db, TARGET)[0]!.id, news, "basis");
    const b = seed(e, [dep("m-1", "2026-12-01")], "2026-12-01", "가짜 모델 종료", "2026-10-20");
    const bid = b.placed.schedule!;
    const pairs = scheduleMergeCandidates(e.db);
    assert.deepEqual(pairs.map((p) => [p.a.id, p.b.id]), [[news, bid]]);
    assert.match(renderScheduleMergeCandidates(e.db, pairs).join("\n"), /빌더 항목 1건/);
    const [mergeId] = inTransaction(e.db, () => applyScheduleMerges(e.db, [{ survivor: news, absorbed: bid, reason: "같은 일" }], TARGET));
    assert.deepEqual(itemsOfSchedule(e.db, news), [b.id]);
    assert.deepEqual(itemsOfSchedule(e.db, bid), []);
    assert.ok(unmergeSchedule(e.db, mergeId!, TARGET).ok);
    assert.deepEqual(itemsOfSchedule(e.db, bid), [b.id]);
    assert.deepEqual(itemsOfSchedule(e.db, news), []);
    assert.ok(deleteSchedule(e.db, bid, TARGET).ok);
    assert.deepEqual(itemsOfSchedule(e.db, bid), []);
    assert.deepEqual(builderItemsOfDate(e.db, "2026-10-20")[0]!.schedules, [], "항목은 남고 연결만 끊긴다");
  });

  test("남는 일정에도 기록이 있어 옮기지 않은 다시 알림 기록은 되돌리기가 복구한다", () => {
    const e = env(TARGET);
    const a = seed(e, [dep("m-1", "2026-12-01")], "2026-12-01", "가짜 모델 종료", "2026-10-20").placed.schedule!;
    const b = seed(e, [dep("m-2", "2026-12-01")], "2026-12-01", "가짜 모델 종료 예정", "2026-10-20").placed.schedule!;
    setReminder(e.db, a, "sent", "2026-11-24");
    setReminder(e.db, b, "skip", "2026-11-25");
    const [mergeId] = inTransaction(e.db, () => applyScheduleMerges(e.db, [{ survivor: a, absorbed: b, reason: "같은 일" }], TARGET));
    assert.equal(reminderOf(e.db, a)!.state, "sent");
    assert.equal(reminderOf(e.db, b), null);
    assert.ok(unmergeSchedule(e.db, mergeId!, TARGET).ok);
    assert.deepEqual([reminderOf(e.db, a)!.state, reminderOf(e.db, b)!.state], ["sent", "skip"]);
  });

  test("항목이 없는 합치기의 기록 모양은 그대로다", () => {
    const e = env(TARGET);
    const a = createSchedule(e.db, { name: "가짜 일정", due: "2026-12-01", major: "경제" });
    const b = createSchedule(e.db, { name: "가짜 일정!", due: "2026-12-01", major: "경제" });
    inTransaction(e.db, () => applyScheduleMerges(e.db, [{ survivor: a, absorbed: b, reason: "같은 일" }], TARGET));
    const row = e.db.prepare("SELECT record FROM schedule_merges").get() as { record: string };
    assert.ok(!row.record.includes("items"));
  });
});

describe("4.4-3 D-7", () => {
  const at = (d: number) => addDays(TARGET, d);
  const reminded = (e: Env, target = TARGET) => dueReminders(e.db, target).map((r) => r.due);

  test("D-8은 안 나오고 D-7, D-3, D-0은 나오며 등록 때 이미 7일 안이거나 지난 것은 안 나온다", () => {
    const e = env();
    for (const d of [8, 7, 3, 0, -1]) seed(e, [`k:${d}`], at(d), `일정 ${d}`, "2026-09-01");
    assert.deepEqual(reminded(e), [at(0), at(3), at(7)]);
    const f = env();
    const s = seed(f, ["k:near"], at(5), "가까운 일정", TARGET);
    assert.equal(reminderOf(f.db, s.placed.schedule!)!.state, "skip");
    assert.deepEqual(reminded(f), []);
  });

  async function fetched(e: Env) {
    const r = await run(e, fakeHttp());
    return { r, w: buildWorkData(e.db, r) };
  }

  const reminderItem = (n: number, due: string, over: Record<string, unknown> = {}) => item([n], { field: "모델", due: { date: due, state: "confirmed" }, ...over });

  test("다시 알림은 검사를 통과하고 기존 일정에 이으며 한 번 실으면 안 나오고, 빼면 검사가 거부하며, 키 중복과 복사 검사에 걸리지 않는다", async () => {
    const e = env();
    const copyText = "the fake model reaches end of life for every single workspace on the listed date";
    const key = dep("m-1", at(3));
    const id = insertBuilderItem(e.db, "2026-09-01", { ...newItem([key], { date: at(3), state: "confirmed" }), whatChanged: copyText });
    placeOnCalendar(e.db, id, { keys: [key], due: { date: at(3), state: "confirmed" }, scheduleName: "m-1 종료" }, "2026-09-01");
    const { r, w } = await fetched(e);
    assert.equal(w.reminders.length, 1);
    assert.match(renderBuilderList(w), /지금 예정일 2026-10-30/);
    const omitted = checkBuilderFile(e.db, itemsFile(w, []), w, { home: null });
    assert.ok(!omitted.ok && omitted.violations.some((v) => v.why.includes("다시 알림")));
    const noDue = checkBuilderFile(e.db, itemsFile(w, [item([1], { field: "모델", due: null })]), w, { home: null });
    assert.equal(noDue.ok, false);
    const wrong = checkBuilderFile(e.db, itemsFile(w, [reminderItem(1, at(4))]), w, { home: null });
    assert.ok(!wrong.ok);
    apply(e, r, [reminderItem(1, at(3), { whatChanged: copyText })]);
    const stored = builderItemsOfDate(e.db, TARGET)[0]!;
    assert.equal(stored.reminderOf, id);
    assert.equal(allSchedules(e.db).length, 1);
    assert.equal(itemsOfSchedule(e.db, allSchedules(e.db)[0]!.id).length, 2);
    assert.deepEqual(reminded(e, "2026-10-28"), []);
  });

  test("연기·취소·지움은 안 나오고, 합쳐진 일정은 남는 일정으로 나오며 지금 예정일을 쓴다", () => {
    const e = env();
    const a = seed(e, ["k:1"], at(3), "일정 하나", "2026-09-01");
    const b = seed(e, ["k:2"], at(4), "일정 둘", "2026-09-01");
    const c = seed(e, ["k:3"], at(5), "일정 셋", "2026-09-01");
    updateSchedule(e.db, a.placed.schedule!, { outcome: "postponed" });
    updateSchedule(e.db, b.placed.schedule!, { outcome: "cancelled" });
    assert.ok(deleteSchedule(e.db, c.placed.schedule!, TARGET).ok);
    assert.deepEqual(reminded(e), []);
    const f = env();
    const x = seed(f, ["k:1"], at(3), "일정 하나", "2026-09-01");
    const y = createSchedule(f.db, { name: "일정 하나!", due: at(5), major: "IT·AI" });
    inTransaction(f.db, () => applyScheduleMerges(f.db, [{ survivor: y, absorbed: x.placed.schedule!, reason: "같은 일" }], TARGET));
    const list = dueReminders(f.db, TARGET);
    assert.deepEqual(list.map((r) => [r.schedule, r.due]), [[y, at(5)]]);
  });

  test("다시 알림이 5건이면 넷째까지 필수이고 다섯째는 다음 날로 넘어간다", async () => {
    const e = env();
    for (let d = 1; d <= 5; d++) seed(e, [`k:${d}`], at(d), `일정 ${d}`, "2026-09-01");
    const { r, w } = await fetched(e);
    assert.equal(w.reminders.length, 5);
    const short = checkBuilderFile(e.db, itemsFile(w, [1, 2, 3].map((n) => reminderItem(n, at(n)))), w, { home: null });
    assert.ok(!short.ok && short.violations.some((v) => v.where === "다시 알림"));
    apply(e, r, [1, 2, 3, 4].map((n) => reminderItem(n, at(n))));
    assert.deepEqual(reminded(e, "2026-10-28"), [at(5)]);
  });

  test("같은 실행의 새 항목이 그 일정을 연기시키면 다시 알림을 빼도 통과한다", async () => {
    const e = env();
    const a = seed(e, [dep("m-1", at(3))], at(3), "m-1 종료", "2026-09-01");
    const feed = rss([{ title: "Fake model delay", link: "https://platform.claude.com/docs/z", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: "New shutdown date 2027-01-14 for the fake model" }]);
    const http = fakeHttp({ "claude-notes": feed });
    const r = await run(e, http);
    const w = buildWorkData(e.db, r);
    const n = w.candidates[0]!.n;
    w.candidates[0]!.keys = [dep("m-1", "2027-01-14")];
    const c = checkBuilderFile(e.db, itemsFile(w, [item([n], { due: { date: "2027-01-14", state: "confirmed", schedule: "m-1 종료(변경)" } })]), w, { home: null });
    assert.ok(c.ok, JSON.stringify(c));
    assert.ok(a.placed.schedule);
  });

  test("모든 소스가 실패해도 다시 알림이 나오고 저장되며 상태는 받지 못함이다", async () => {
    const e = env();
    seed(e, ["k:1"], at(2), "일정", "2026-09-01");
    const bad = fakeHttp();
    bad.http = async () => ({ status: 500, text: "x" });
    const r = await run(e, bad);
    assert.equal(r.reminders.length, 1);
    apply(e, r, [item([1], { due: { date: at(2), state: "confirmed" } })]);
    assert.equal(builderItemsOfDate(e.db, TARGET).length, 1);
  });

  test("다음 날 실행: 대상 날짜가 지나면 나오지 않는다", () => {
    const e = env();
    seed(e, ["k:1"], at(1), "일정", "2026-09-01");
    assert.deepEqual(reminded(e, nextDay(2).target), []);
  });
});
