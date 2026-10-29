import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { createIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { checkLinkFile } from "../src/links.ts";
import { checkRefFile } from "../src/extract.ts";
import { checkMergeFile } from "../src/merge.ts";
import { checkRefMerges } from "../src/refMerge.ts";
import { createEntity, createTerm } from "../src/refs.ts";
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

describe("3단계 4.5-1 스킬 문서의 명령과 실행 순서", () => {
  test("문서에 적힌 `node src/cli.ts <명령>`이 모두 실제 명령이다", () => {
    const names = [...SKILL.matchAll(/node src\/cli\.ts ([a-z][a-z-]*)/g)].map((m) => m[1]!);
    assert.ok(names.length > 10);
    const unknown = [...new Set(names)].filter((n) => !COMMAND_NAMES.includes(n));
    assert.deepEqual(unknown, [], "문서에 있는데 CLI에 없는 명령");
    for (const n of ["images", "backup", "site", "deploy", "push", "summary"]) assert.ok(names.includes(n), `${n} 명령이 문서에 없다`);
  });
  test("실행 순서 표가 이미지 채우기 → 백업 → 사이트 빌드 → 배포 → push → 요약 순서다", () => {
    const rows = SKILL.split("\n").filter((l) => /^\| \d+ \|/.test(l));
    const stepOf = (cmd: string) => {
      const row = rows.find((r) => r.includes(`node src/cli.ts ${cmd} `) || r.includes(`\`${cmd}\``));
      assert.ok(row, `순서 표에 ${cmd}가 없다`);
      return Number(/^\| (\d+) \|/.exec(row)![1]);
    };
    const steps = ["images", "backup", "site", "deploy", "push", "summary"].map(stepOf);
    assert.deepEqual(steps, [...steps].sort((a, b) => a - b));
    assert.equal(steps.at(-1), Math.max(...rows.map((r) => Number(/^\| (\d+) \|/.exec(r)![1]))), "요약이 마지막 단계다");
    assert.ok(stepOf("merge-apply") < stepOf("images"), "이미지 채우기는 합치기 뒤, 백업 전이다");
  });
  test("실패해도 계속하고, 시험 모드는 빌드만 하며, Claude가 git·vercel을 직접 치지 않는다고 적혀 있다", () => {
    assert.match(SKILL, /Claude가 직접 실행하는 git·vercel 명령은 없다/);
    assert.match(SKILL, /앞 명령이 실패해도\(종료 코드 1\) 멈추지 않고 다음 명령과 19단계로 넘어간다/);
    assert.match(SKILL, /시험 모드와 데이터 폴더 지정 실행은 빌드만 한다/);
    assert.match(SKILL, /빌드가 실패했으면 배포하지 않는다/);
  });
});

describe("4단계 4.9-1 스킬 문서의 뽑기", () => {
  test("뽑기 파일 형식 예시가(빠진 뉴스를 빈 목록으로 채우면) 검사를 통과한다", () => {
    // 예시의 본문 표기가 본문에 나오고, 대상 3(가짜 중앙은행)이 있는 DB
    const brief = sampleBrief("2026-10-27");
    brief.sections[0]!.topStories[0]!.background = "가짜 중앙은행은 양적완화를 끝냈다.";
    const v = validateBrief(brief, "2026-10-27");
    assert.ok(v.ok);
    const db = openDb(path.join(tempDir(), "t.db"));
    saveBrief(db, { brief: v.brief, collectedAt: "2026-10-27T23:00:00+09:00", late: false });
    for (const name of ["가짜 협회", "가짜 연구소", "가짜 중앙은행"]) createEntity(db, { kind: "기관", name, aliases: [], description: "가짜 기관", describedOn: null, describedStory: null });
    const ex = exampleAfter("### 뽑기 파일 형식") as { stories: { story: string; entities: unknown[]; terms: unknown[] }[] };
    const seen = new Set(ex.stories.map((s) => s.story));
    for (const s of storiesOfDate(db, "2026-10-27")) if (!seen.has(s.key)) ex.stories.push({ story: s.key, entities: [], terms: [] });
    const r = checkRefFile(db, ex, "2026-10-27", null);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    db.close();
  });
  test("대상·용어 합치기 파일 형식 예시가 검사를 통과한다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    createEntity(db, { kind: "기관", name: "가짜 중앙은행", aliases: [], description: "가짜 기관", describedOn: null, describedStory: null });
    createEntity(db, { kind: "기관", name: "가짜중앙은행", aliases: [], description: "가짜 기관", describedOn: null, describedStory: null });
    createTerm(db, { name: "양적완화", aliases: [], description: "지어낸 설명이다." });
    createTerm(db, { name: "QE", aliases: [], description: "지어낸 설명이다." });
    const ex = exampleAfter("### 대상·용어 합치기 파일 형식");
    const r = checkMergeFile(db, ex, { keys: ["entityMerges", "termMerges"], check: (c, root) => checkRefMerges(c, db, root) });
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    db.close();
  });
  test("뽑기 순서·명령·기준과 하지 않는 것이 적혀 있다", () => {
    const rows = SKILL.split("\n").filter((l) => /^\| \d+(-\d+)? \|/.test(l));
    const at = (n: string) => rows.findIndex((r) => r.startsWith(`| ${n} |`));
    assert.ok(at("7") < at("7-1") && at("7-1") < at("8"), "채우기 뽑기는 소급 연결 뒤, 새 날짜 조사 전이다");
    assert.ok(at("12") < at("12-1") && at("12-1") < at("13"), "그 날짜 뽑기는 연결 직후다");
    for (const cmd of ["refs", "ref-search", "ref-check", "ref-apply"]) assert.match(SKILL, new RegExp(`node src/cli\\.ts ${cmd} `), cmd);
    assert.match(SKILL, /`ref-unmerge`\)와 대상·용어 지우기\(`ref-delete`\)도 실행하지 않는다/);
    assert.match(SKILL, /뽑기\(7-1단계, 12-1단계\)도 서브에이전트에 맡기지 않고 메인이 한다/);
    assert.match(SKILL, /뽑기 파일\(`<데이터 폴더>\/work\/<날짜>\.refs\.json`\)/);
    for (const rule of [/공인만/, /일반인은 이름이 기사에 나와도 뽑지 않는다/, /중립적 사실만/, /도시·해협 같은 장소는 뽑지 않는다/, /시점에 따라 바뀌지 않는 정의/, /최대 2번/, /웹 검색을 하거나 원문 페이지를 읽지 않는다/]) {
      assert.match(SKILL, rule);
    }
  });
});
