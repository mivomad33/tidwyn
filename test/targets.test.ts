import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, test } from "node:test";
import { openDb } from "../src/db.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { isLate, planTargets } from "../src/targets.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, sampleBrief, tempDir } from "./helpers.ts";

after(cleanupTemp);

function dbWith(dates: string[], first: string | null) {
  const db = openDb(path.join(tempDir(), "t.db"));
  if (first !== null) recordFirstCollectionDate(db, first);
  for (const d of dates) {
    const r = validateBrief(sampleBrief(d), d);
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
  }
  return db;
}

describe("4.1-3 대상 날짜", () => {
  test("첫 실행은 KST 어제 하루이고, 첫 수집일로 기록할 날짜를 알려 준다", () => {
    assert.deepEqual(planTargets(dbWith([], null), NOW), { dates: ["2026-10-27"], firstDateToRecord: "2026-10-27" });
  });
  test("빠진 날이 없으면 대상이 없다", () => {
    assert.deepEqual(planTargets(dbWith(["2026-10-26", "2026-10-27"], "2026-10-26"), NOW), { dates: [], firstDateToRecord: null });
  });
  test("중간에 빈 날이 있으면 그날만, 여러 날 빠지면 오래된 날부터 전부", () => {
    assert.deepEqual(planTargets(dbWith(["2026-10-23", "2026-10-25", "2026-10-27"], "2026-10-23"), NOW).dates, ["2026-10-24", "2026-10-26"]);
    assert.deepEqual(planTargets(dbWith(["2026-10-20"], "2026-10-20"), NOW).dates, ["2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });
  test("첫 실행의 하루가 실패해도 기록이 남아 다음 실행에 그날이 다시 나온다", () => {
    const db = dbWith([], null);
    const plan = planTargets(db, NOW);
    recordFirstCollectionDate(db, plan.firstDateToRecord!);
    // 2026-10-27 수집 실패(저장 안 함) → 이틀 뒤 실행
    const later = new Date("2026-10-30T08:00:00+09:00");
    assert.deepEqual(planTargets(db, later), { dates: ["2026-10-27", "2026-10-28", "2026-10-29"], firstDateToRecord: null });
  });
  test("시험 모드 시작일이 있으면 그날부터 어제까지", () => {
    assert.deepEqual(planTargets(dbWith([], null), NOW, "2026-10-25"), { dates: ["2026-10-25", "2026-10-26", "2026-10-27"], firstDateToRecord: "2026-10-25" });
  });
  test("늦게 수집: 대상일 다음 날(KST)보다 늦으면 표시", () => {
    assert.equal(isLate("2026-10-27", new Date("2026-10-28T23:59:59+09:00")), false);
    assert.equal(isLate("2026-10-27", new Date("2026-10-29T00:00:00+09:00")), true);
    assert.equal(isLate("2026-10-27", new Date("2026-10-28T15:30:00Z")), true, "UTC로는 28일이지만 KST로는 29일");
  });
});
