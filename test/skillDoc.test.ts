import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { openDb } from "../src/db.ts";
import { createIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { checkLinkFile } from "../src/links.ts";
import { checkMergeFile } from "../src/merge.ts";
import { saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { PROJECT_ROOT, cleanupTemp, sampleBrief, tempDir } from "./helpers.ts";

after(cleanupTemp);

const SKILL = fs.readFileSync(path.join(PROJECT_ROOT, ".claude/skills/brief/SKILL.md"), "utf8");

/** 제목 뒤 첫 json 코드 블록 */
function exampleAfter(heading: string): unknown {
  const at = SKILL.indexOf(`\n${heading}\n`);
  assert.ok(at >= 0, `스킬 문서에 "${heading}"이 없다`);
  const m = /```json\n([\s\S]*?)\n```/.exec(SKILL.slice(at));
  assert.ok(m, `"${heading}" 뒤에 json 예시가 없다`);
  return JSON.parse(m[1]!);
}

/** 예시가 가리키는 이슈 12, 15가 있고, 예시에 없는 2026-10-27 뉴스는 이미 연결된 DB */
function exampleDb() {
  const db = openDb(path.join(tempDir(), "t.db"));
  for (const d of ["2026-10-26", "2026-10-27"]) {
    const r = validateBrief(sampleBrief(d), d);
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
  }
  const ids: number[] = [];
  for (let i = 1; i <= 15; i++) ids.push(createIssue(db, { name: `가짜 이슈 ${i}`, aliases: [], category: { major: "사회", minor: "교육" }, summary: "가짜 요약이다." }));
  const old = storiesOfDate(db, "2026-10-26");
  linkStory(db, old[0]!.id, 12, true);
  linkStory(db, old[1]!.id, 15, true);
  for (const s of storiesOfDate(db, "2026-10-27")) if (!["한국-1", "한국-2", "한국-s1"].includes(s.key)) linkStory(db, s.id, 1, true);
  return db;
}

describe("2단계 4.6-1 스킬 문서의 파일 형식 예시", () => {
  test("연결 파일 형식 예시가 검사를 통과한다", () => {
    const db = exampleDb();
    const r = checkLinkFile(db, exampleAfter("### 연결 파일 형식"), "2026-10-27");
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    db.close();
  });
  test("합치기 파일 형식 예시가 검사를 통과한다", () => {
    const db = exampleDb();
    const r = checkMergeFile(db, exampleAfter("### 합치기 파일 형식"));
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    db.close();
  });
  test("되돌리기 명령은 /brief가 실행하지 않는다고 적혀 있고, 연결·합치기는 메인이 한다", () => {
    assert.match(SKILL, /합치기 되돌리기 명령\(`unmerge`\)은 실행하지 않는다/);
    assert.match(SKILL, /이슈 연결\(7단계, 12단계\)과 합치기\(13단계\)는 서브에이전트에 맡기지 않고 메인이 한다/);
    assert.match(SKILL, /5줄 이하/);
  });
});
