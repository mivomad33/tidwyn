import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COVERAGE_COLUMNS, FIELD_COVERAGE } from "../src/demandCoverage.ts";
import { COMMUNITY_GROUPS, FLOW_FIELDS, OFFICIAL_GROUPS } from "../src/demandFlowTypes.ts";
import { communitySources, DEMAND_GROUPS } from "../src/demandSources.ts";

// 9.98단계 S6: 분야×소스 대응은 분야 목록의 분야마다 한 번이고, 묶음은 실제 묶음 id다

describe("9.98단계 S6 분야×소스 대응", () => {
  test("분야 목록의 분야가 모두 한 번씩, 분야 목록 순서로 있다", () => {
    assert.deepEqual(
      FIELD_COVERAGE.map((c) => c.field),
      FLOW_FIELDS.map((f) => f.id),
    );
  });

  test("칸은 공식 묶음과 커뮤니티 소스 묶음 전부이고, 커뮤니티 묶음은 소스 목록의 묶음과 같다", () => {
    assert.deepEqual(
      COVERAGE_COLUMNS.map((c) => c.id),
      [...OFFICIAL_GROUPS, ...COMMUNITY_GROUPS],
    );
    assert.deepEqual([...COMMUNITY_GROUPS], communitySources().map((s) => s.group));
    for (const c of COVERAGE_COLUMNS) assert.ok(DEMAND_GROUPS.some((g) => g.id === c.id), c.id);
    for (const c of COVERAGE_COLUMNS.filter((x) => x.kind === "community")) assert.equal(c.label, communitySources().find((s) => s.group === c.id)!.label);
  });

  test("분야마다의 묶음은 실제 묶음 id이고 겹치지 않으며 칸 순서다. 공식 묶음이 하나 이상 있다", () => {
    const order = COVERAGE_COLUMNS.map((c) => c.id as string);
    for (const { field, groups } of FIELD_COVERAGE) {
      for (const g of groups) assert.ok(order.includes(g), `${field} ${g}`);
      assert.equal(new Set(groups).size, groups.length, field);
      assert.deepEqual([...groups], [...groups].sort((a, b) => order.indexOf(a) - order.indexOf(b)), field);
      assert.ok(groups.some((g) => (OFFICIAL_GROUPS as readonly string[]).includes(g)), `${field}: 공식 묶음 없이는 흐름이 될 수 없다`);
    }
  });
});
