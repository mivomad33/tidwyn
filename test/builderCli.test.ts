import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { builderItemsOfDate, builderStatusOf, sourceState } from "../src/builderStore.ts";
import { BUILDER_WORK_NAMES, builderWorkFile } from "../src/builderWork.ts";
import { openDb } from "../src/db.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { HOUR, NOW, TARGET, addBrief, fakeHttp, item, rss, type FakeHttp } from "./builderFixtures.ts";
import { cleanupTemp, makeCtx, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const MATERIAL = "지어낸후보글자열QZY";

function setup(brief = true) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  if (brief) {
    recordFirstCollectionDate(db, TARGET);
    addBrief(db, TARGET);
  }
  db.close();
  const env: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home" };
  return { repo, dataDir, dbFile, env };
}

type S = ReturnType<typeof setup>;

function start(s: S): string {
  const ctx = makeCtx(s.repo, s.env);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const line = /실행 기록: (.+)/.exec(ctx.text())![1]!;
  return line.trim();
}

async function fetchCmd(s: S, runFile: string, http: FakeHttp) {
  const ctx = { ...makeCtx(s.repo, s.env), builderHttp: http.http };
  const code = await mainAsync(["builder-fetch", "--run", runFile], ctx);
  return { code, text: ctx.text() };
}

function cmd(s: S, name: string, runFile: string) {
  const ctx = makeCtx(s.repo, s.env);
  const code = main([name, "--run", runFile], ctx);
  return { code, text: ctx.text() };
}

const writeItems = (s: S, data: unknown) => fs.writeFileSync(builderWorkFile(s.dataDir, "items"), JSON.stringify(data));
const db = (s: S) => openDb(s.dbFile);
const feed = () => rss([{ title: "Fake change", link: "https://platform.claude.com/docs/a", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: MATERIAL }]);
const good = () => ({ targetDate: TARGET, items: [item([1], { field: "모델", sources: ["https://platform.claude.com/docs/a"] })] });

describe("빌더 명령", () => {
  test("명령이 등록되어 있고 start가 대상 날짜를 알린다", () => {
    for (const n of ["builder-fetch", "builder-check", "builder-apply", "builder-fail"]) assert.ok(COMMAND_NAMES.includes(n), n);
    const s = setup();
    const ctx = makeCtx(s.repo, s.env);
    assert.equal(main(["start"], ctx), 0);
    assert.match(ctx.text(), new RegExp(`- 빌더: ${TARGET} 받기 할 것`));
  });

  test("받기 → 검사 → 적용 흐름이 항목을 저장하고 작업 파일을 지우며 요약에 후보 글이 없다", async () => {
    const s = setup();
    const runFile = start(s);
    const http = fakeHttp({ "claude-notes": feed(), vite: { status: 500, text: "x" } });
    const f = await fetchCmd(s, runFile, http);
    assert.equal(f.code, 0, f.text);
    for (const n of ["candidates", "list"] as const) assert.ok(fs.existsSync(builderWorkFile(s.dataDir, n)));
    assert.ok(fs.readFileSync(builderWorkFile(s.dataDir, "list"), "utf8").includes(MATERIAL));
    assert.ok(!f.text.includes(MATERIAL), "대화창 출력에 후보 글이 없다");
    writeItems(s, good());
    assert.equal(cmd(s, "builder-check", runFile).code, 0);
    const a = cmd(s, "builder-apply", runFile);
    assert.equal(a.code, 0, a.text);
    for (const n of Object.keys(BUILDER_WORK_NAMES) as (keyof typeof BUILDER_WORK_NAMES)[]) assert.ok(!fs.existsSync(builderWorkFile(s.dataDir, n)), n);
    const d = db(s);
    assert.equal(builderItemsOfDate(d, TARGET).length, 1);
    assert.equal(builderStatusOf(d, TARGET), "partial");
    d.close();
    const state = readRun(runFile);
    assert.equal(state.builderApply?.status, "applied");
    assert.ok(!JSON.stringify(state).includes(MATERIAL), "실행 기록에 후보 글이 없다");
    const sum = makeCtx(s.repo, s.env);
    main(["summary", "--run", runFile], sum);
    assert.match(sum.text(), /Vite 블로그: 실패 1일째\(HTTP 500\)/);
    assert.match(sum.text(), /빌더 쓰기: 항목 1건/);
    assert.ok(!sum.text().includes(MATERIAL));
  });

  test("같은 실행에서 두 번 받으면 다시 부르지 않고, 끝난 날짜면 부르지 않는다", async () => {
    const s = setup();
    const runFile = start(s);
    const http = fakeHttp({ "claude-notes": feed() });
    await fetchCmd(s, runFile, http);
    const calls = http.calls.length;
    assert.ok(calls > 10);
    const again = await fetchCmd(s, runFile, http);
    assert.match(again.text, /이미 받았다/);
    assert.equal(http.calls.length, calls);
    writeItems(s, { targetDate: TARGET, items: [] });
    assert.equal(cmd(s, "builder-apply", runFile).code, 0);
    const next = start(s);
    const http2 = fakeHttp();
    const done = await fetchCmd(s, next, http2);
    assert.match(done.text, /이미 끝남/);
    assert.equal(http2.calls.length, 0);
  });

  test("새로 쓸 날짜가 없는 실행에서도 가장 늦은 브리프 날짜로 돌고, 브리프가 없으면 돌지 않는다", async () => {
    const s = setup();
    const runFile = start(s);
    assert.deepEqual(readRun(runFile).builderPlanned, { date: TARGET, done: false });
    const http = fakeHttp();
    assert.equal((await fetchCmd(s, runFile, http)).code, 0);
    assert.ok(http.calls.length > 0);
    const n = setup(false);
    const r = start(n);
    const http2 = fakeHttp();
    assert.equal((await fetchCmd(n, r, http2)).code, 0);
    assert.equal(http2.calls.length, 0);
    assert.equal(readRun(r).builderFetch?.status, "noBrief");
  });

  test("검사 실패는 시도를 세고 작업 파일을 남기며, 포기하면 받지 못함으로 두고 다음 실행이 다시 받는다", async () => {
    const s = setup();
    const runFile = start(s);
    await fetchCmd(s, runFile, fakeHttp({ "claude-notes": feed() }));
    writeItems(s, { targetDate: TARGET, items: [item([99])] });
    assert.equal(cmd(s, "builder-check", runFile).code, 1);
    for (let i = 1; i <= 3; i++) {
      const a = cmd(s, "builder-apply", runFile);
      assert.equal(a.code, 1);
    }
    assert.match(cmd(s, "builder-apply", runFile).text, /더 적용하지 않는다/);
    assert.ok(fs.existsSync(builderWorkFile(s.dataDir, "items")));
    const f = cmd(s, "builder-fail", runFile);
    assert.equal(f.code, 0, f.text);
    assert.ok(!fs.existsSync(builderWorkFile(s.dataDir, "candidates")));
    const d = db(s);
    assert.equal(builderStatusOf(d, TARGET), "failed");
    assert.equal(sourceState(d, "claude-notes").fetchedAt, null);
    d.close();
    assert.equal(readRun(runFile).builderApply?.status, "gaveUp");
    const next = start(s);
    const http = fakeHttp({ "claude-notes": feed() });
    const again = await fetchCmd(s, next, http);
    assert.equal(again.code, 0);
    assert.ok(fs.readFileSync(builderWorkFile(s.dataDir, "list"), "utf8").includes("Fake change"));
  });

  test("모든 소스가 실패해도 받기는 성공으로 끝나고 빈 목록을 적용할 수 있다", async () => {
    const s = setup();
    const runFile = start(s);
    const http = fakeHttp();
    http.http = async () => ({ status: 500, text: "x" });
    const f = await fetchCmd(s, runFile, http);
    assert.equal(f.code, 0);
    writeItems(s, { targetDate: TARGET, items: [] });
    assert.equal(cmd(s, "builder-apply", runFile).code, 0);
    const d = db(s);
    assert.equal(builderStatusOf(d, TARGET), "failed");
    d.close();
  });

  test("받기가 멈추면 종료 코드 1이고 builder-fail이 저장한다", async () => {
    const s = setup();
    const runFile = start(s);
    const ctx = { ...makeCtx(s.repo, s.env), builderHttp: fakeHttp().http, builderClock: () => { throw new Error("멈춤"); } };
    assert.equal(await mainAsync(["builder-fetch", "--run", runFile], ctx), 1);
    assert.equal(readRun(runFile).builderFetch?.status, "crashed");
    assert.equal(cmd(s, "builder-fail", runFile).code, 0);
    const d = db(s);
    assert.equal(builderStatusOf(d, TARGET), "failed");
    d.close();
  });

  test("요약 줄은 앞 단계 실행 기록에 붙지 않는다", () => {
    const s = setup();
    const runFile = start(s);
    const state = readRun(runFile);
    delete state.builderPlanned;
    fs.writeFileSync(runFile, JSON.stringify(state));
    const ctx = makeCtx(s.repo, s.env);
    main(["summary", "--run", runFile], ctx);
    assert.ok(!ctx.text().includes("빌더"));
  });
});
