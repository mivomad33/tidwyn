import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { openDb } from "../src/db.ts";
import { briefIssues, renderAll, renderIndex, renderIssue } from "../src/issueMarkdown.ts";
import { addRelation, createIssue, getIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { applyMerges } from "../src/merge.ts";
import { loadBrief, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { PROJECT_ROOT, cleanupTemp, listFiles, sampleBrief, tempDir } from "./helpers.ts";

after(cleanupTemp);

const SUMMARY = "가짜 기관 사이의 금리 갈등이다.\n지금은 협상이 이어진다.\n다음 주 발표를 본다.";

function dbWith(dates: string[]): DatabaseSync {
  const db = openDb(path.join(tempDir(), "t.db"));
  for (const d of dates) {
    const r = validateBrief(sampleBrief(d), d);
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
  }
  return db;
}

function story(db: DatabaseSync, date: string, key: string) {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date}/${key}`);
  return s;
}

function fixture(name: string): string {
  return fs.readFileSync(path.join(PROJECT_ROOT, "test/fixtures/issues", name), "utf8");
}

/** 이슈 둘과 뉴스 셋인 예시 DB */
function exampleDb() {
  const db = dbWith(["2026-10-26", "2026-10-27"]);
  const a = createIssue(db, { name: "가짜 금리 갈등", aliases: ["Fake Rate Dispute"], category: { major: "경제", minor: "금융·증시" }, summary: SUMMARY });
  const b = createIssue(db, { name: "가짜 학교 개편", aliases: [], category: { major: "사회", minor: "교육" }, summary: "가짜 학교 제도 개편 논의다.", status: "종료" });
  linkStory(db, story(db, "2026-10-26", "한국-1").id, a, true);
  linkStory(db, story(db, "2026-10-27", "한국-1").id, a, true);
  linkStory(db, story(db, "2026-10-27", "세계-s1").id, b, true);
  addRelation(db, a, b);
  return { db, a, b };
}

describe("2단계 4.4-1 브리프 마크다운의 이전 전개", () => {
  test("앞선 전개 4건이 있는 이슈의 뉴스에 가까운 3건이 나오고, 첫 전개에는 새 이슈가 나온다", () => {
    const dates = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
    const db = dbWith(dates);
    const a = createIssue(db, { name: "가짜 금리 갈등", aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: SUMMARY });
    const extra = createIssue(db, { name: "가짜 환율 흐름", aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: SUMMARY });
    for (const d of dates) linkStory(db, story(db, d, "한국-1").id, a, true);
    linkStory(db, story(db, "2026-10-27", "한국-1").id, extra, false);
    const md = renderMarkdown(loadBrief(db, "2026-10-27")!, briefIssues(db, "2026-10-27"));
    const block = md.slice(md.indexOf("### 1. 한국"), md.indexOf("- **분류:**"));
    assert.equal(
      block,
      [
        "### 1. 한국 뉴스 1의 핵심을 담은 제목",
        "",
        `- **이어지는 이야기:** [가짜 금리 갈등](../issues/${a}.md) · 함께 엮인 이슈: [가짜 환율 흐름](../issues/${extra}.md)`,
        "- **이전 전개:**",
        "  - [2026-10-26](2026-10-26.md) 한국 뉴스 1의 핵심을 담은 제목",
        "  - [2026-10-25](2026-10-25.md) 한국 뉴스 1의 핵심을 담은 제목",
        "  - [2026-10-24](2026-10-24.md) 한국 뉴스 1의 핵심을 담은 제목",
        "",
      ].join("\n"),
    );
    const first = renderMarkdown(loadBrief(db, "2026-10-23")!, briefIssues(db, "2026-10-23"));
    assert.match(first, /### 1\. 한국 뉴스 1의 핵심을 담은 제목\n\n- \*\*이어지는 이야기:\*\* \[가짜 금리 갈등\]\(\.\.\/issues\/\d+\.md\)\n- \*\*이전 전개:\*\* 새 이슈\n/);
    // 오래된 날짜의 브리프는 그 날짜 기준의 이전 전개를 보인다
    const mid = renderMarkdown(loadBrief(db, "2026-10-24")!, briefIssues(db, "2026-10-24"));
    assert.match(mid, /- \*\*이전 전개:\*\*\n {2}- \[2026-10-23\]\(2026-10-23\.md\) 한국 뉴스 1의 핵심을 담은 제목\n- \*\*분류/);
    db.close();
  });
  test("짧은 소식에는 이슈 이름만 나온다", () => {
    const { db, b } = exampleDb();
    const md = renderMarkdown(loadBrief(db, "2026-10-27")!, briefIssues(db, "2026-10-27"));
    const line = md.split("\n").find((l) => l.startsWith("- 세계 짧은 소식 1"))!;
    assert.ok(line.endsWith(` · 이슈: [가짜 학교 개편](../issues/${b}.md)`), line);
    assert.doesNotMatch(line, /이전 전개|새 이슈/);
    db.close();
  });
  test("이슈가 없는 브리프의 마크다운은 1단계 예시와 같다", () => {
    const b = sampleBrief();
    b.sections[1]!.topStories[0]!.category = { major: "경제", minor: "가상자산" };
    const r = validateBrief(b, "2026-10-27");
    assert.ok(r.ok);
    const db = openDb(path.join(tempDir(), "t.db"));
    saveBrief(db, { brief: r.brief, collectedAt: "2026-10-30T09:00:00+09:00", late: true });
    const expected = fs.readFileSync(path.join(PROJECT_ROOT, "test/fixtures/brief-2026-10-27.md"), "utf8");
    assert.equal(renderMarkdown(loadBrief(db, "2026-10-27")!, briefIssues(db, "2026-10-27")), expected);
    db.close();
  });
});

describe("2단계 4.4-2 이슈 마크다운과 목록", () => {
  test("이슈 둘과 뉴스 셋인 예시 DB에서 이슈 파일과 목록 파일이 기대 예시 파일과 같다", () => {
    const { db, a, b } = exampleDb();
    assert.equal(renderIssue(db, getIssue(db, a)!), fixture("issue-a.md"));
    assert.equal(renderIssue(db, getIssue(db, b)!), fixture("issue-b.md"));
    assert.equal(renderIndex(db), fixture("index.md"));
    db.close();
  });
  test("합친 뒤 흡수된 이슈 파일이 남는 이슈를 가리키고, 목록에 합치기 기록과 되돌리기 명령이 나온다", () => {
    const { db, a, b } = exampleDb();
    const [id] = applyMerges(db, [{ survivor: a, absorbed: b, reason: "같은 이야기다", summary: SUMMARY }], "2026-11-04");
    assert.equal(renderIssue(db, getIssue(db, b)!), `# 가짜 학교 개편\n\n이 이슈는 2026-11-04에 [가짜 금리 갈등](${a}.md)에 합쳐졌다.\n`);
    assert.match(renderIndex(db), new RegExp(`- 합치기 ${id} \\(2026-11-04\\): \\[가짜 학교 개편\\]\\(${b}\\.md\\) → \\[가짜 금리 갈등\\]\\(${a}\\.md\\)\\. 이유: 같은 이야기다 · 되돌리기: \`node src/cli\\.ts unmerge --id ${id}\``));
    db.close();
  });
  test("같은 DB로 두 번 만들면 내용이 같고, DB에 없는 이슈 파일은 지운다", () => {
    const { db } = exampleDb();
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "issues"), { recursive: true });
    fs.writeFileSync(path.join(dir, "issues", "999.md"), "옛 파일\n");
    renderAll(db, dir);
    const read = () => Object.fromEntries(listFiles(dir).filter((f) => f.endsWith(".md")).map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
    const first = read();
    renderAll(db, dir);
    assert.deepEqual(read(), first);
    assert.equal(fs.existsSync(path.join(dir, "issues", "999.md")), false);
    assert.ok(first[path.join("issues", "index.md")]);
    assert.match(first[path.join("briefs", "2026-10-27.md")]!, /이어지는 이야기/);
    db.close();
  });
});
