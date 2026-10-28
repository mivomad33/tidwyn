import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { markdownPath, renderMarkdown, writeMarkdown } from "../src/markdown.ts";
import { loadBrief, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { PROJECT_ROOT, cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

function fixtureBrief() {
  const b = sampleBrief();
  b.sections[1]!.topStories[0]!.category = { major: "경제", minor: "가상자산" };
  const r = validateBrief(b, "2026-10-27");
  assert.ok(r.ok);
  return { brief: r.brief, collectedAt: "2026-10-30T09:00:00+09:00", late: true };
}

describe("4.4-1 마크다운 브리프", () => {
  test("예시 브리프 데이터로 만든 마크다운이 기대 파일과 같다", () => {
    const expected = fs.readFileSync(path.join(PROJECT_ROOT, "test/fixtures/brief-2026-10-27.md"), "utf8");
    assert.equal(renderMarkdown(fixtureBrief()), expected);
  });
  test("메달 이모지가 없고, S1 순서대로 나온다", () => {
    const md = renderMarkdown(fixtureBrief());
    assert.doesNotMatch(md, /[\u{1F947}-\u{1F949}\u{1F3C5}\u{1F3C6}]/u);
    const order = ["늦게 수집", "오늘의 한 문장", "키워드", "## 한국", "**흐름**", "### 1.", "### 짧은 소식", "확인되지 않은 내용", "## 세계", "## IT·AI"];
    let at = -1;
    for (const part of order) {
      const i = md.indexOf(part, at + 1);
      assert.ok(i > at, `${part}가 순서대로 나와야 한다`);
      at = i;
    }
  });
  test("데이터 폴더 안에 날짜 이름으로 쓴다", () => {
    const dir = tempDir();
    const file = writeMarkdown(dir, fixtureBrief());
    assert.equal(file, path.join(dir, "briefs", "2026-10-27.md"));
  });
});

describe("4.4-3 마크다운 다시 만들기", () => {
  test("마크다운 파일을 지운 뒤 명령을 실행하면 같은 내용으로 다시 생긴다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    saveBrief(db, fixtureBrief());
    const stored = loadBrief(db, "2026-10-27")!;
    db.close();
    const file = writeMarkdown(dataDir, stored);
    const before = fs.readFileSync(file, "utf8");
    fs.rmSync(file);
    const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["render", "--date", "2026-10-27"], ctx), 0, ctx.text());
    assert.equal(fs.readFileSync(markdownPath(dataDir, "2026-10-27"), "utf8"), before);
  });
});

describe("1.5단계 4.3-3 발행일 추정 표시", () => {
  test("추정 표시가 있는 출처는 발행일 옆에 \"발행일 추정\"이 나온다", () => {
    const stored = fixtureBrief();
    stored.brief.sections[0]!.topStories[0]!.sources[1]!.publishedAtEstimated = true;
    const md = renderMarkdown(stored);
    assert.ok(md.includes("[예시일보](https://daily.example.org/kr-1) (2026-10-27, 발행일 추정)"));
    assert.equal(md.match(/발행일 추정/g)?.length, 1);
  });
});
