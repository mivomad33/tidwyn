import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { COMMUNITY_RULES, CONCENTRATION_SHARE } from "../src/communityStore.ts";
import { FIELD_COVERAGE } from "../src/demandCoverage.ts";
import { COMMUNITY_INFO } from "../src/demandFlowTypes.ts";
import { DEMAND_DOC, DEMAND_GROUPS_OFF, DEMAND_SOURCES_OFF, communitySources } from "../src/demandSources.ts";
import { PROJECT_ROOT } from "./helpers.ts";

// 9.98단계 4.1-1, 4.7-1: 판정 문서의 표시 안 값(커뮤니티 소스 목록과 표본 설명, 커뮤니티 하한·오름·쏠림 기준, 분야×소스 대응)이 코드와 같다

const DOC = fs.readFileSync(path.join(PROJECT_ROOT, DEMAND_DOC), "utf8");

/** `<!-- demand:이름 -->` 꼴(소스 목록)과 `<!-- 이름:start -->` 꼴(흐름 규칙) 표시 안의 빈 줄이 아닌 줄 */
function region(open: string, close: string): string[] {
  const m = new RegExp(`${open}\\n([\\s\\S]*?)\\n?${close}`).exec(DOC);
  assert.ok(m !== null, open);
  return m[1]!.split("\n").filter((l) => l.trim() !== "");
}
const cells = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim());

describe("9.98단계 4.1-1, 4.7-1 판정 문서와 코드 대조", () => {
  test("커뮤니티 소스 id·묶음·이름·표본 설명이 코드와 같고, 끈 소스는 끈 표에도 있다", () => {
    const rows = region("<!-- demand:community -->", "<!-- /demand:community -->")
      .filter((l) => /^\| `/.test(l))
      .map(cells);
    assert.deepEqual(
      rows.map((r) => ({ id: /`([^`]+)`/.exec(r[0]!)![1], group: /`([^`]+)`/.exec(r[1]!)![1], label: r[2], sample: r[3] })),
      communitySources().map((s) => ({ id: s.id, group: s.group, label: s.label, sample: COMMUNITY_INFO[s.group].sample })),
    );
    const offRows = region("<!-- demand:off -->", "<!-- /demand:off -->")
      .filter((l) => /^\| `/.test(l))
      .map((l) => /^\| `([^`]+)`/.exec(l)![1]!);
    for (const r of rows) {
      const [id, group] = [/`([^`]+)`/.exec(r[0]!)![1]!, /`([^`]+)`/.exec(r[1]!)![1]!];
      const off = DEMAND_SOURCES_OFF.includes(id) || DEMAND_GROUPS_OFF.includes(group);
      assert.equal(r[4]!.includes("끔"), off, id);
      if (off) assert.ok(offRows.includes(id) || offRows.includes(group), id);
    }
  });

  test("커뮤니티 하한·오름 기준·쏠림 기준 표가 COMMUNITY_RULES, CONCENTRATION_SHARE와 같다", () => {
    const rows = region("<!-- community-rules:start -->", "<!-- community-rules:end -->").slice(2).map(cells);
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r[0], { floor: Number(r[1]), ratio: Number(r[2]) }])), COMMUNITY_RULES);
    for (const r of rows) assert.equal(Number(r[3]), CONCENTRATION_SHARE, r[0]);
  });

  test("분야와 소스 대응 목록이 FIELD_COVERAGE와 같다(순서 포함)", () => {
    const rows = region("<!-- field-coverage:start -->", "<!-- field-coverage:end -->").map((l) => /^- `([a-z]+)`: (.+)$/.exec(l)!);
    assert.deepEqual(
      rows.map((m) => ({ field: m[1], groups: m[2]!.split(", ") })),
      FIELD_COVERAGE.map((c) => ({ field: c.field, groups: [...c.groups] })),
    );
  });

  test("뒤 단계가 지킬 조건에 커뮤니티 출처 표시와 표본 설명이 있다", () => {
    const after = DOC.slice(DOC.indexOf("## 뒤 단계가 지킬 조건"));
    assert.ok(after.includes("GitHub Issues는 'GitHub', Bluesky는 'Bluesky'"));
    for (const s of Object.values(COMMUNITY_INFO).map((g) => g.sample)) assert.ok(after.includes(`'${s}'`), s);
  });
});
