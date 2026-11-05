import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { COMMAND_NAMES } from "../src/cli.ts";
import { FLOW_WORK_NAMES } from "../src/demandFlowTypes.ts";
import { PROJECT_ROOT } from "./helpers.ts";

// 9.97단계 4.3-1, 4.6-6: /brief 스킬 문서의 수요 흐름 단계와 금지 줄, 시험 전용 옵션이 문서에 없음

const SKILL = fs.readFileSync(path.join(PROJECT_ROOT, ".claude/skills/brief/SKILL.md"), "utf8");
const NAME = "demand-flow";

function chapter(heading: string): string {
  const start = SKILL.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, heading);
  const rest = SKILL.slice(start + heading.length + 2);
  const end = rest.search(/^#{1,3} /m);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("9.97단계 4.3-1 스킬 문서의 수요 흐름 단계", () => {
  const rows = SKILL.split("\n").filter((l) => /^\| \d+(-\d+)* \|/.test(l));
  const rowAt = (n: string) => rows.findIndex((r) => r.startsWith(`| ${n} |`));

  test("명령 이름이 실제 명령과 같고, 단계가 14-1 뒤·15 앞에 있다", () => {
    assert.ok(COMMAND_NAMES.includes(NAME));
    assert.ok(SKILL.includes(`node src/cli.ts ${NAME} --run <실행 기록>`));
    assert.ok(rows[rowAt("14-2")]!.includes(NAME));
    assert.ok(rowAt("14-1") < rowAt("14-2") && rowAt("14-2") < rowAt("15"));
    const at = (h: string) => SKILL.indexOf(`\n${h}\n`);
    assert.ok(at("### 14-1단계: 수요 스냅샷") < at("### 14-2단계: 수요 흐름") && at("### 14-2단계: 수요 흐름") < at("### 15단계: 백업과 커밋"));
  });

  test("단계는 시간 제한, 다시 부르는 조건, 실패 때 넘어갈 곳, 시험 모드를 적었고 14-1은 14-2로 넘어간다", () => {
    assert.ok(chapter("### 14-1단계: 수요 스냅샷").includes("다시 부르지 않고 14-1-1단계로 넘어간다"));
    const step = chapter("### 14-2단계: 수요 흐름");
    assert.ok(step.includes("Bash 도구 시간 제한을 10분으로 준다"));
    assert.ok(step.includes("출력에 '다시 부른다'가 있으면 같은 명령을 다시 부른다(이 단계에서 모두 3번까지)"));
    assert.ok(step.includes("다시 부르지 않고 15단계로 넘어간다"));
    assert.ok(step.includes("앞 단계가 실패해도 돈다"));
    assert.ok(step.includes("시험 모드(`/brief test`)에서는 돌지 않는다"));
    assert.ok(step.includes("데이터 폴더 지정 실행은 돈다"));
  });

  test("0장 금지 줄에 작업 파일 이름 셋과 사이트 결과물·DB의 흐름 글 금지가 있다", () => {
    const rules = chapter("### 실행 중에 하지 않는 것");
    const line = rules.split("\n").find((l) => l.includes("수요 흐름 작업 파일을 읽지 않는다"));
    assert.ok(line !== undefined);
    for (const name of Object.values(FLOW_WORK_NAMES)) assert.ok(line.includes(`\`${name}\``), name);
    assert.ok(line.includes("수요 흐름 항목의 글과 근거 줄의 단위 이름도 사이트 결과물이나 DB에서 읽지 않는다"));
    assert.ok(rules.includes("수요 데이터 전용 DB(`<데이터 폴더>/demand.db`)와 그 사본(`<데이터 폴더>/demand-copies/`)은 읽지 않는다."));
  });

  test("'10. 수요 흐름' 절이 지시·검사 코드를 가리키고, 요약 항목이 있다", () => {
    const c = chapter("## 10. 수요 흐름");
    assert.ok(c.includes("`src/demandFlowWrite.ts`") && c.includes("`src/demandFlowCheck.ts`"));
    for (const f of ["src/demandFlowWrite.ts", "src/demandFlowCheck.ts"]) assert.ok(fs.existsSync(path.join(PROJECT_ROOT, f)), f);
    assert.ok(SKILL.includes("  - 수요 흐름: 대상 날짜와 날짜 상태"));
  });
});

describe("9.97단계 4.6-6 시험 전용 옵션은 스킬 문서에 없다", () => {
  test("시작일·소스 끄기·대상 날짜·측정·창 길이 옵션 이름이 스킬 문서에 없다", () => {
    for (const opt of ["--start", "--skip", "--target", "--measure", "--recent-days", "--base-days"]) assert.ok(!SKILL.includes(opt), opt);
  });
});
