// U2 4.3-1: 거르기 칩의 값과 건수(있는 값만, 첫 칩 건수, 이슈 목록 두 줄, 일정 화면의 탭 기준)
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALL_CHIP_TEXT, chipOptions, countChips, countLabel, keptChip } from "../site/src/lib/chips.ts";
import { tabMajorCounts } from "../site/src/lib/schedules.ts";
import type { Major, ScheduleIndex } from "../site/src/lib/types.ts";
import { MAJORS } from "../src/categories.ts";

const ORDER: readonly Major[] = MAJORS;

describe("거르기 칩", () => {
  test("있는 값만 정해진 순서로, 칩마다 건수를 붙인다", () => {
    const items = [{ m: "IT·AI" }, { m: "경제" }, { m: "IT·AI" }] as { m: Major }[];
    const chips = countChips(items, (x) => x.m, ORDER);
    assert.deepEqual(chips, [
      { value: "경제", count: 1, label: "경제 1" },
      { value: "IT·AI", count: 2, label: "IT·AI 2" },
    ]);
    assert.ok(!chips.some((c) => c.count === 0), "0건 값은 칩이 아니다");
    assert.equal(countLabel(ALL_CHIP_TEXT.major, items.length), "모든 분야 3");
    assert.equal(countLabel("경제", 1234), "경제 1,234");
  });

  test("첫 칩 글은 '전체'가 아니다", () => {
    for (const t of Object.values(ALL_CHIP_TEXT)) assert.ok(!t.startsWith("전체"), t);
    assert.deepEqual(Object.values(ALL_CHIP_TEXT), ["모든 분야", "모든 상태", "모든 영상", "모든 종류"]);
  });

  test("이슈 목록 두 줄은 전체 목록으로 세어 다른 줄 선택과 관계없다", () => {
    const issues = [
      { major: "경제", status: "진행 중" },
      { major: "경제", status: "종료" },
      { major: "정치", status: "종료" },
    ] as { major: Major; status: "진행 중" | "종료" }[];
    const statusChips = countChips(issues, (i) => i.status, ["진행 중", "종료"] as const);
    const majorChips = countChips(issues, (i) => i.major, ORDER);
    // '정치'를 골라도 상태 줄은 전체 목록 기준이라 '진행 중'이 사라지지 않는다
    assert.deepEqual(statusChips.map((c) => c.label), ["진행 중 1", "종료 2"]);
    assert.deepEqual(majorChips.map((c) => c.label), ["정치 1", "경제 2"]);
  });

  test("고른 값이 지금 칩에 없으면 첫 칩(null)이다", () => {
    const chips = chipOptions([["경제", 2]] as [Major, number][], ORDER);
    assert.equal(keptChip("경제", chips), "경제");
    assert.equal(keptChip("정치", chips), null);
    assert.equal(keptChip(null, chips), null);
  });

  test("일정 화면 목록 보기: 고른 탭 전체를 세고 이번 달은 그 달 파일로 나눈다", () => {
    const index: ScheduleIndex = {
      total: 6,
      months: [
        { month: "2026-10", count: 2, majors: { 경제: 2 } },
        { month: "2026-11", count: 2, majors: { 경제: 1, 국제: 1 } },
        { month: "2026-12", count: 2, majors: { 정치: 2 } },
      ],
      majors: ["정치", "경제", "국제"],
    };
    const now = [
      { due: "2026-11-02", major: "경제" as Major },
      { due: "2026-11", major: "국제" as Major },
    ];
    const up = tabMajorCounts(index, "2026-11-06", "upcoming", now)!;
    const past = tabMajorCounts(index, "2026-11-06", "past", now)!;
    assert.deepEqual(Object.fromEntries(up), { 국제: 1, 정치: 2 });
    assert.deepEqual(Object.fromEntries(past), { 경제: 3 });
    assert.equal(tabMajorCounts(index, "2026-11-06", "upcoming", null), null, "이번 달 파일 전에는 모른다");
  });
});
