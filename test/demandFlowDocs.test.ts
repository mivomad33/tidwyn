import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { CATEGORY_GROUPS, CATEGORY_LABELS, FLOW_CATEGORIES, FLOW_FIELDS, OFFICIAL_GROUPS } from "../src/demandFlowTypes.ts";
import { UNIT_RULES } from "../src/demandUnits.ts";
import { PROJECT_ROOT } from "./helpers.ts";

// 9.97단계 4.6-1: 판정 문서의 표시 안 목록(분야, 갈래와 묶음, 소스마다의 규칙)이 코드와 같다

const DOC = fs.readFileSync(path.join(PROJECT_ROOT, "docs/demand-sources.md"), "utf8");

function marked(name: string): string[] {
  const m = new RegExp(`<!-- ${name}:start -->\\n([\\s\\S]*?)\\n<!-- ${name}:end -->`).exec(DOC);
  assert.ok(m !== null, name);
  return m[1]!.split("\n").filter((l) => l.trim() !== "");
}

describe("9.97단계 4.6-1 방법 문서와 코드 대조", () => {
  test("분야 목록이 코드의 FLOW_FIELDS와 같다(순서 포함)", () => {
    const rows = marked("flow-fields").map((l) => /^- `([a-z]+)`: (.+)$/.exec(l)!);
    assert.deepEqual(
      rows.map((m) => ({ id: m[1], label: m[2] })),
      FLOW_FIELDS.map((f) => ({ id: f.id, label: f.label })),
    );
  });

  test("갈래와 묶음이 코드와 같고, 갈래의 묶음을 모으면 공식 묶음 전체다", () => {
    const rows = marked("flow-categories").map((l) => /^- `([a-z]+)`\((.+)\): (.+)$/.exec(l)!);
    assert.deepEqual(
      rows.map((m) => ({ c: m[1], label: m[2], groups: m[3]!.split(", ") })),
      FLOW_CATEGORIES.map((c) => ({ c, label: CATEGORY_LABELS[c], groups: [...CATEGORY_GROUPS[c]] })),
    );
    assert.deepEqual(new Set(rows.flatMap((m) => m[3]!.split(", "))), new Set(OFFICIAL_GROUPS));
  });

  test("소스마다의 규칙 표가 UNIT_RULES와 같다", () => {
    const rows = marked("unit-rules").slice(2).map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
    const doc = Object.fromEntries(rows.map((r) => [r[0], { floor: Number(r[3]), ratio: Number(r[4]), top: Number(r[5]), staleDays: Number(r[6]) }]));
    assert.deepEqual(doc, UNIT_RULES);
  });
});

describe("9.97단계 4.6-3 README", () => {
  test("두 파일의 수요 신호 줄이 같은 자리에서 수요 탭과 원본은 로컬에만 둔다는 것을 말한다", () => {
    const ko = fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8").split("\n");
    const en = fs.readFileSync(path.join(PROJECT_ROOT, "README.en.md"), "utf8").split("\n");
    const k = ko.findIndex((l) => l.startsWith("3. 수요 신호") && l.includes("받은 원본은 사이트와 백업에 넣지 않고 로컬에만 두며") && l.includes("브리프의 '수요' 탭에는 서로 다른 공식 소스 두 곳 이상, 또는 공식 소스 한 곳과 커뮤니티 검색 건수(GitHub Issues, Bluesky)에서 함께 보인 흐름을 하루 0~3건 근거 숫자와 함께 싣습니다."));
    const e = en.findIndex((l) => l.startsWith("3. Demand signals") && l.includes("they stay local") && l.includes('The brief\'s "Demand" tab shows 0 to 3 flows a day that appear together in at least two different official sources, or in one official source and community search counts (GitHub Issues, Bluesky), with the evidence numbers.'));
    assert.ok(k >= 0 && k === e, `${k} ${e}`);
  });
});
