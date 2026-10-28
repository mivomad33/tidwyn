import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { readRun, workFile } from "../src/run.ts";
import { planTargets } from "../src/targets.ts";
import { NOW, cleanupTemp, commitCount, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

/** start를 돌리고 실행 기록 파일 경로를 돌려준다 */
function start(repo: string, args: string[], env: NodeJS.ProcessEnv = {}, now = NOW): string {
  const ctx = makeCtx(repo, env, now);
  assert.equal(main(["start", ...args], ctx), 0, ctx.text());
  const m = /실행 기록: (.+)/.exec(ctx.text());
  assert.ok(m);
  return m[1]!;
}

function writeWork(runFile: string, date: string, data: unknown): void {
  const file = workFile(readRun(runFile).dataDir, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function run(repo: string, argv: string[], env: NodeJS.ProcessEnv = {}): { code: number; text: string } {
  const ctx = makeCtx(repo, env);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

describe("4.1-6 실패한 날짜와 나머지 날짜", () => {
  test("가운데 날짜가 틀리면 나머지 두 날짜는 저장되고, 대상 날짜 계산에 가운데 날짜가 다시 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const runFile = start(repo, [], { TIDWYN_DATA_DIR: dataDir }, new Date("2026-10-25T09:00:00+09:00"));
    // 첫 실행은 10-24 하루. 사흘 뒤 실행으로 세 날짜를 만든다.
    writeWork(runFile, "2026-10-24", sampleBrief("2026-10-24"));
    assert.equal(run(repo, ["save", "--run", runFile, "--date", "2026-10-24"]).code, 0);
    const run2 = start(repo, [], { TIDWYN_DATA_DIR: dataDir }, new Date("2026-10-28T09:00:00+09:00"));
    assert.deepEqual(readRun(run2).targetDates, ["2026-10-25", "2026-10-26", "2026-10-27"]);
    const bad = sampleBrief("2026-10-26");
    bad.sections[0]!.topStories[0]!.keyFacts = ["하나"];
    writeWork(run2, "2026-10-25", sampleBrief("2026-10-25"));
    writeWork(run2, "2026-10-26", bad);
    writeWork(run2, "2026-10-27", sampleBrief("2026-10-27"));
    const v = run(repo, ["validate", "--run", run2, "--date", "2026-10-26"]);
    assert.equal(v.code, 1);
    assert.match(v.text, /한국 섹션 1위 핵심 사실: 1개 \(3~5개여야 한다\)/);
    assert.equal(run(repo, ["save", "--run", run2, "--date", "2026-10-25"]).code, 0);
    assert.equal(run(repo, ["save", "--run", run2, "--date", "2026-10-26"]).code, 1);
    assert.equal(run(repo, ["save", "--run", run2, "--date", "2026-10-27"]).code, 0);
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    assert.deepEqual(planTargets(db, NOW).dates, ["2026-10-26"]);
    db.close();
    assert.ok(fs.existsSync(path.join(dataDir, "briefs", "2026-10-25.md")));
    assert.equal(fs.existsSync(path.join(dataDir, "briefs", "2026-10-26.md")), false);
    const s = run(repo, ["summary", "--run", run2]);
    assert.match(s.text, /저장한 날짜: 2026-10-25, 2026-10-27/);
    assert.match(s.text, /2026-10-26: 검사를 통과하지 못했다\n\s+- 한국 섹션 1위 핵심 사실: 1개/);
    assert.match(s.text, /다른 날짜의 마크다운:\n\s+- .*2026-10-25\.md/);
    assert.match(s.text, /---\n\n# 2026-10-27 브리프/, "가장 최근 저장 날짜의 마크다운 전체를 보여 준다");
  });
  test("조사 실패를 기록하면 요약에 이유가 나오고, 결과가 없는 날짜도 실패로 나온다", () => {
    const repo = tempRepo();
    const runFile = start(repo, ["test", "2026-10-26"]);
    assert.equal(run(repo, ["fail", "--run", runFile, "--date", "2026-10-26", "--reason", "검색 결과가 없다"]).code, 0);
    const s = run(repo, ["summary", "--run", runFile]);
    assert.match(s.text, /2026-10-26: 검색 결과가 없다/);
    assert.match(s.text, /2026-10-27: 결과가 기록되지 않았다/);
    assert.doesNotMatch(s.text, /저장한 날짜/);
  });
  test("대상 날짜가 아닌 날짜는 저장하지 않는다", () => {
    const repo = tempRepo();
    const runFile = start(repo, ["test"]);
    const r = run(repo, ["save", "--run", runFile, "--date", "2026-10-20"]);
    assert.equal(r.code, 2);
    assert.match(r.text, /대상 날짜가 아니다/);
  });
  test("백업 커밋이 실패하면 종료 코드와 출력으로 알리고, 요약에 실패가 들어 있다", () => {
    const repo = tempRepo();
    const runFile = start(repo, []);
    writeWork(runFile, "2026-10-27", sampleBrief("2026-10-27"));
    assert.equal(run(repo, ["save", "--run", runFile, "--date", "2026-10-27"]).code, 0);
    fs.mkdirSync(path.join(repo, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".git", "refs", "heads", "data.lock"), "");
    const b = run(repo, ["backup", "--run", runFile]);
    assert.equal(b.code, 1);
    assert.match(b.text, /백업: 실패/);
    const s = run(repo, ["summary", "--run", runFile]);
    assert.match(s.text, /백업: 실패/);
    assert.match(s.text, /# 2026-10-27 브리프/, "백업이 실패해도 브리프 출력은 나온다");
  });
  test("처리할 날짜가 없어도 DB가 있으면 백업한다(밀린 백업 따라잡기)", () => {
    const repo = tempRepo();
    const first = start(repo, []);
    writeWork(first, "2026-10-27", sampleBrief("2026-10-27"));
    assert.equal(run(repo, ["save", "--run", first, "--date", "2026-10-27"]).code, 0);
    // 앞 실행이 백업 전에 끊겼다고 본다
    const second = start(repo, []);
    assert.deepEqual(readRun(second).targetDates, []);
    const b = run(repo, ["backup", "--run", second]);
    assert.equal(b.code, 0, b.text);
    assert.match(b.text, /data 브랜치에 커밋함/);
    assert.equal(gitIn(repo, "log", "-1", "--format=%s", "refs/heads/data").trim(), "Backup briefs");
    const again = run(repo, ["backup", "--run", second]);
    assert.match(again.text, /바뀐 것이 없어 커밋하지 않음/);
    assert.match(run(repo, ["summary", "--run", second]).text, /처리할 날짜가 없었다/);
  });
});

describe("4.3-4 start의 실행 전 사본", () => {
  test("DB가 있으면 start가 DB에 쓰기 전에 사본을 남기고, 14일보다 오래된 사본을 지운다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    start(repo, [], { TIDWYN_DATA_DIR: dataDir });
    const snaps = path.join(dataDir, "snapshots");
    assert.equal(fs.existsSync(snaps), false, "첫 실행(DB 없음)은 사본을 만들지 않는다");
    const dbBytes = fs.readFileSync(path.join(dataDir, "tidwyn.db"));
    fs.mkdirSync(snaps);
    fs.writeFileSync(path.join(snaps, "tidwyn-20261013-090000.db"), "old");
    fs.writeFileSync(path.join(snaps, "tidwyn-20261015-090000.db"), "recent");
    start(repo, [], { TIDWYN_DATA_DIR: dataDir });
    assert.deepEqual(fs.readdirSync(snaps).sort(), ["tidwyn-20261015-090000.db", "tidwyn-20261028-090000.db"]);
    assert.deepEqual(fs.readFileSync(path.join(snaps, "tidwyn-20261028-090000.db")), dbBytes, "사본은 쓰기 전 DB와 같다");
  });
});

describe("4.1-8 시험 모드는 커밋하지 않는다", () => {
  test("시험 모드로 수집·백업해도 저장소에 커밋이 생기지 않는다", () => {
    const repo = tempRepo();
    const before = commitCount(repo);
    const runFile = start(repo, ["test", "2026-10-27"]);
    writeWork(runFile, "2026-10-27", sampleBrief("2026-10-27"));
    assert.equal(run(repo, ["save", "--run", runFile, "--date", "2026-10-27"]).code, 0);
    const b = run(repo, ["backup", "--run", runFile]);
    assert.match(b.text, /내보내기만 함, 커밋 안 함 \(시험 모드는 커밋하지 않는다\)/);
    assert.equal(commitCount(repo), before);
    assert.equal(gitIn(repo, "status", "--porcelain"), "");
    assert.ok(fs.existsSync(path.join(readRun(runFile).dataDir, "backup", "2026-10.json")));
  });
  test("새로 저장한 날짜의 수집 정보: 다음 날 수집은 늦게 수집이 아니다", () => {
    const repo = tempRepo();
    const runFile = start(repo, ["test", "2026-10-26"]);
    for (const d of ["2026-10-26", "2026-10-27"]) {
      writeWork(runFile, d, sampleBrief(d));
      assert.equal(run(repo, ["save", "--run", runFile, "--date", d]).code, 0);
    }
    const md26 = fs.readFileSync(path.join(readRun(runFile).dataDir, "briefs", "2026-10-26.md"), "utf8");
    const md27 = fs.readFileSync(path.join(readRun(runFile).dataDir, "briefs", "2026-10-27.md"), "utf8");
    assert.match(md26, /늦게 수집/);
    assert.doesNotMatch(md27, /늦게 수집/);
  });
});
