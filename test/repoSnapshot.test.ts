import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, mainAsync, main } from "../src/cli.ts";
import { completeSnapshotDates, snapshotDates, snapshotRowCount, snapshotRun, snapshotMeta } from "../src/discoverStore.ts";
import { addDays } from "../src/kst.ts";
import { runSnapshot, SEARCH_GAP_MS, SNAPSHOT_DEADLINE_MS } from "../src/repoSnapshot.ts";
import { readRun } from "../src/run.ts";
import { openDb } from "../src/db.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import path from "node:path";
import { TARGET, addBrief, env } from "./builderFixtures.ts";
import { cleanupTemp, makeCtx, tempDir, tempRepo } from "./helpers.ts";
import { discoverHttp, fakeClock, searchItem, searchReply, seedSnapshot, starRange, type DiscoverHttp, type FakeRepo } from "./discoverFixtures.ts";

after(cleanupTemp);

const many = (n: number, top = 9000): FakeRepo[] => Array.from({ length: n }, (_, i) => ({ name: `fake-owner/repo-${i}`, stars: top - i }));
const searchOf = (repos: FakeRepo[]) => discoverHttp({ search: (url) => searchReply(repos, url) });

function snap(e: ReturnType<typeof env>, h: DiscoverHttp, c = fakeClock(), over: { deadlineMs?: number; target?: string } = {}) {
  return runSnapshot({ db: e.db, http: h.http, target: over.target ?? TARGET, clock: c.clock, sleep: c.sleep, ...(over.deadlineMs === undefined ? {} : { deadlineMs: over.deadlineMs }) });
}

describe("4.1-1 스냅샷", () => {
  test("범위 조건이 쿼리에 있고 토큰을 보내지 않는다", async () => {
    const e = env();
    const h = searchOf(many(3));
    await snap(e, h);
    const q = new URL(h.calls[0]!.url).searchParams.get("q")!;
    for (const w of ["stars:>=2000", `pushed:>=${addDays(TARGET, -7)}`, "fork:false", "archived:false"]) assert.ok(q.includes(w), w);
    assert.equal(new URL(h.calls[0]!.url).searchParams.get("sort"), "stars");
    assert.equal(JSON.stringify(h.calls[0]!.init?.headers ?? {}).toLowerCase().includes("authorization"), false);
  });

  test("1000건 넘는 구간을 별 수로 나눠 끝까지 받고 경계의 같은 저장소를 한 번만 센다", async () => {
    const e = env();
    const h = searchOf(many(1250));
    const r = await snap(e, h);
    assert.equal(r.status, "complete");
    assert.equal(snapshotRowCount(e.db, TARGET), 1250);
    assert.ok(h.calls.length <= 13, `호출 ${h.calls.length}`);
    assert.equal(starRange(h.calls[0]!.url).hi, null);
    assert.equal(starRange(h.calls[10]!.url).hi, 9000 - 999, "1000번째의 별 수가 다음 구간의 상한이다");
  });

  test("같은 별 수가 1000건을 넘으면 구간 실패다", async () => {
    const e = env();
    const same = Array.from({ length: 1200 }, (_, i) => ({ name: `fake-owner/same-${i}`, stars: 3000 }));
    const r = await snap(e, searchOf(same));
    assert.equal(r.status, "running");
    assert.match(r.reason ?? "", /구간/);
    assert.equal(snapshotRun(e.db, TARGET)?.state, "running");
  });

  test("끊긴 뒤 같은 날짜로 다시 부르면 이어 받고 앞 구간을 다시 받지 않는다", async () => {
    const e = env();
    const h = searchOf(many(350));
    const c = fakeClock();
    const first = await snap(e, h, c, { deadlineMs: 30_000 + SEARCH_GAP_MS + 1 });
    assert.equal(first.status, "running");
    assert.equal(first.reason, "시간 상한");
    const got = h.calls.length;
    assert.equal(got, 2);
    assert.equal(snapshotRowCount(e.db, TARGET), 200);
    const second = await snap(e, h, c);
    assert.equal(second.status, "complete");
    assert.equal(h.calls.length, got + 2);
    assert.equal(new URL(h.calls[got]!.url).searchParams.get("page"), "3");
    assert.equal(snapshotRowCount(e.db, TARGET), 350);
    assert.equal(snapshotRun(e.db, TARGET)?.calls, 4, "검색 호출 수는 이어 받기까지 더한 값이다");
  });

  test("이어 받기의 첫 호출도 간격을 지킨다", async () => {
    const e = env();
    const c = fakeClock();
    const at: number[] = [];
    const h = searchOf(many(350));
    const timed: DiscoverHttp = { ...h, http: (url, init) => (at.push(c.clock()), h.http(url, init)) };
    await snap(e, timed, c, { deadlineMs: 30_000 + SEARCH_GAP_MS + 1 });
    assert.equal(at.length, 2);
    await snap(e, timed, c);
    assert.ok(at[2]! - at[1]! >= SEARCH_GAP_MS, `간격 ${at[2]! - at[1]!}`);
  });

  test("끝난 날짜는 호출하지 않는다", async () => {
    const e = env();
    const h = searchOf(many(3));
    await snap(e, h);
    const n = h.calls.length;
    const again = await snap(e, h);
    assert.equal(again.status, "complete");
    assert.equal(h.calls.length, n);
  });

  test("호출 간격이 6.2초 이상이다", async () => {
    const e = env();
    const c = fakeClock();
    const at: number[] = [];
    const repos = many(350);
    const h = discoverHttp({
      search: (url) => {
        at.push(c.clock());
        c.tick(150);
        return searchReply(repos, url);
      },
    });
    await snap(e, h, c);
    assert.equal(at.length, 4);
    for (let i = 1; i < at.length; i++) assert.ok(at[i]! - at[i - 1]! >= 6200, `간격 ${at[i]! - at[i - 1]!}`);
    assert.ok(SEARCH_GAP_MS >= 6200);
  });

  test("403은 Retry-After를, 429는 reset 시각을 따른 뒤 다시 시도한다", async () => {
    const e = env();
    const c = fakeClock();
    const repos = many(3);
    let n = 0;
    const h = discoverHttp({
      search: (url) => {
        n++;
        if (n === 1) return { status: 403, text: "limited", headers: { "retry-after": "61" } };
        if (n === 2) return { status: 429, text: "limited", headers: { "x-ratelimit-reset": String(Math.ceil((c.clock() + 90_000) / 1000)) } };
        return searchReply(repos, url);
      },
    });
    const r = await snap(e, h, c);
    assert.equal(r.status, "complete");
    assert.ok(c.sleeps.includes(61_000), JSON.stringify(c.sleeps));
    assert.ok(c.sleeps.some((s) => s >= 89_000 && s <= 91_000), JSON.stringify(c.sleeps));
  });

  test("기다림이 시간 상한을 넘으면 기다리지 않고 멈춘다", async () => {
    const e = env();
    const c = fakeClock();
    const h = discoverHttp({ search: { status: 403, text: "x", headers: { "retry-after": "3600" } } });
    const r = await snap(e, h, c);
    assert.equal(r.status, "running");
    assert.equal(r.reason, "시간 상한");
    assert.ok(!c.sleeps.includes(3_600_000));
  });

  test("incomplete_results가 true면 그 구간만 다시 받는다", async () => {
    const e = env();
    const repos = many(150);
    let bad = 1;
    const seen: string[] = [];
    const h = discoverHttp({
      search: (url) => {
        const page = new URL(url).searchParams.get("page")!;
        seen.push(page);
        if (page === "2" && bad-- > 0) return searchReply(repos, url, { incomplete_results: true });
        return searchReply(repos, url);
      },
    });
    const r = await snap(e, h);
    assert.equal(r.status, "complete");
    assert.deepEqual(seen, ["1", "2", "2"]);
  });

  test("다시 받아도 incomplete_results면 구간 실패로 완성이 되지 않는다", async () => {
    const e = env();
    const repos = many(50);
    const r = await snap(e, discoverHttp({ search: (url) => searchReply(repos, url, { incomplete_results: true }) }));
    assert.equal(r.status, "running");
    assert.match(r.reason ?? "", /구간/);
    assert.deepEqual(completeSnapshotDates(e.db, TARGET), []);
  });

  test("재시도 상한을 넘기면 완성이 아니다", async () => {
    const e = env();
    const h = discoverHttp({ search: { status: 403, text: "x", headers: { "retry-after": "1" } } });
    const r = await snap(e, h);
    assert.equal(r.status, "running");
    assert.match(r.reason ?? "", /재시도/);
    assert.ok(h.calls.length <= 5);
    assert.deepEqual(completeSnapshotDates(e.db, TARGET), []);
  });

  test("형식이 틀리면 완성이 아니고 저장소 이름이 이상한 응답도 받지 않는다", async () => {
    for (const body of ["<html>", '{"items":"x"}', JSON.stringify({ total_count: 1, incomplete_results: false, items: [searchItem({ name: "../../etc", stars: 3000 })] })]) {
      const e = env();
      const r = await snap(e, discoverHttp({ search: { status: 200, text: body } }));
      assert.equal(r.status, "running", body);
      assert.match(r.reason ?? "", /형식|HTML|JSON/, body);
      assert.equal(snapshotRowCount(e.db, TARGET), 0);
    }
  });

  test("받은 행이 마지막 완성 스냅샷의 절반 미만이면 완성이 아니고 다시 호출해도 받지 않는다", async () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -1), many(21));
    const h = searchOf(many(10));
    const r = await snap(e, h);
    assert.equal(r.status, "short");
    assert.deepEqual(completeSnapshotDates(e.db, TARGET), [addDays(TARGET, -1)]);
    const n = h.calls.length;
    await snap(e, h);
    assert.equal(h.calls.length, n);
  });

  test("절반이면 완성이다, 빈 응답은 완성이 아니다", async () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -1), many(20));
    assert.equal((await snap(e, searchOf(many(10)))).status, "complete");
    const empty = env();
    assert.equal((await snap(empty, searchOf([]))).status, "short");
  });

  test("포크와 보관된 저장소는 쿼리와 상관없이 저장하지 않는다", async () => {
    const e = env();
    const repos: FakeRepo[] = [{ name: "fake-owner/keep", stars: 3000 }, { name: "fake-owner/forked", stars: 2900, fork: true }, { name: "fake-owner/old", stars: 2800, archived: true }];
    await snap(e, searchOf(repos));
    assert.equal(snapshotRowCount(e.db, TARGET), 1);
    assert.deepEqual([...snapshotMeta(e.db, TARGET).keys()], ["fake-owner/keep"]);
  });

  test("메타데이터는 최신 완성 스냅샷 것만 남는다", async () => {
    const e = env();
    await snap(e, searchOf(many(3)), fakeClock(), { target: addDays(TARGET, -1) });
    assert.equal(snapshotMeta(e.db, addDays(TARGET, -1)).size, 3);
    await snap(e, searchOf(many(4)));
    assert.equal(snapshotMeta(e.db, addDays(TARGET, -1)).size, 0);
    assert.equal(snapshotMeta(e.db, TARGET).size, 4);
    assert.equal(snapshotRowCount(e.db, addDays(TARGET, -1)), 3, "별 수는 8일 동안 남는다");
  });

  test("대상 날짜 기준 8일째까지 두고 그보다 오래된 스냅샷을 지운다", async () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -9), many(2));
    seedSnapshot(e.db, addDays(TARGET, -8), many(3));
    seedSnapshot(e.db, addDays(TARGET, -1), many(4));
    await snap(e, searchOf(many(5)));
    assert.deepEqual(snapshotDates(e.db), [addDays(TARGET, -8), addDays(TARGET, -1), TARGET]);
    assert.equal(snapshotRowCount(e.db, addDays(TARGET, -9)), 0);
    assert.equal(snapshotRowCount(e.db, addDays(TARGET, -8)), 3);
    assert.equal(snapshotRun(e.db, addDays(TARGET, -9)), null);
  });
});

function cli(mode: "custom" | "test" = "custom") {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, TARGET);
  addBrief(db, TARGET);
  db.close();
  const environment: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home" };
  const ctx = makeCtx(repo, environment);
  assert.equal(main(mode === "test" ? ["start", "test", TARGET] : ["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, environment, runFile, dbFile };
}

describe("4.1-1 스냅샷 명령", () => {
  const name = "builder-snapshot";

  test("명령이 등록되어 있고 끝남, 저장소 수, 호출 수, 시간을 출력과 요약에 쓴다", async () => {
    assert.ok(COMMAND_NAMES.includes(name));
    const s = cli();
    const c = fakeClock();
    const ctx = { ...makeCtx(s.repo, s.environment), builderHttp: searchOf(many(150)).http, builderClock: c.clock, builderSleep: c.sleep };
    assert.equal(await mainAsync([name, "--run", s.runFile], ctx), 0, ctx.text());
    assert.match(ctx.text(), /끝남 예/);
    assert.match(ctx.text(), /저장소 150개/);
    assert.match(ctx.text(), /검색 2회/);
    assert.match(ctx.text(), /걸린 시간 \d+초/);
    const st = readRun(s.runFile).repoSnapshot!;
    assert.equal(st.finished, true);
    assert.equal(st.repos, 150);
    assert.equal(st.calls, 2);
    const sum = makeCtx(s.repo, s.environment);
    main(["summary", "--run", s.runFile], sum);
    assert.match(sum.text(), /저장소 스냅샷\(2026-10-27\): 끝남 예, 저장소 150개, 검색 2회/);
  });

  test("시간 상한에 닿으면 멈추고 끝나지 않았다고 알리며 종료 코드는 0이다", async () => {
    const s = cli();
    const c = fakeClock();
    const ctx = { ...makeCtx(s.repo, s.environment), builderHttp: searchOf(many(350)).http, builderClock: c.clock, builderSleep: c.sleep, snapshotDeadlineMs: 30_000 + SEARCH_GAP_MS + 1 };
    assert.equal(await mainAsync([name, "--run", s.runFile], ctx), 0);
    assert.match(ctx.text(), /끝남 아니오\(시간 상한\)/);
    const st = readRun(s.runFile).repoSnapshot!;
    assert.equal(st.finished, false);
    assert.ok(st.calls < 4);
    assert.ok(SNAPSHOT_DEADLINE_MS <= 9 * 60_000);
  });

  test("시험 모드는 돌지 않고 지정 모드는 돈다", async () => {
    const t = cli("test");
    const h = searchOf(many(3));
    const ctx = { ...makeCtx(t.repo, t.environment), builderHttp: h.http };
    assert.equal(await mainAsync([name, "--run", t.runFile], ctx), 0, ctx.text());
    assert.equal(h.calls.length, 0);
    assert.equal(readRun(t.runFile).repoSnapshot?.status, "off");
    const s = cli();
    const h2 = searchOf(many(3));
    const c = fakeClock();
    await mainAsync([name, "--run", s.runFile], { ...makeCtx(s.repo, s.environment), builderHttp: h2.http, builderClock: c.clock, builderSleep: c.sleep });
    assert.ok(h2.calls.length > 0);
  });

  test("끈 소스는 호출하지 않고 스냅샷을 지우지 않는다", async () => {
    const s = cli();
    const db = openDb(s.dbFile);
    seedSnapshot(db, addDays(TARGET, -9), many(2));
    db.close();
    const h = searchOf(many(3));
    const ctx = { ...makeCtx(s.repo, s.environment), builderHttp: h.http, builderOff: { sources: ["github-repos"], vendors: [] } };
    assert.equal(await mainAsync([name, "--run", s.runFile], ctx), 0);
    assert.equal(h.calls.length, 0);
    const d = openDb(s.dbFile);
    assert.equal(snapshotRowCount(d, addDays(TARGET, -9)), 2);
    d.close();
  });
});
