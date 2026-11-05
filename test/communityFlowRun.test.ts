import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main, mainAsync } from "../src/cli.ts";
import type { CommunityRunOptions } from "../src/communityFetch.ts";
import { openDb } from "../src/db.ts";
import { runFlowStep, type DemandFlowState, type FlowStepInput, type FlowStepResult } from "../src/demandFlowRun.ts";
import { flowDateOf, flowsOfDate, type Flow } from "../src/demandFlowStore.ts";
import { FLOW_RULES } from "../src/demandFlowWrite.ts";
import type { FlowCandidates } from "../src/demandFlowWork.ts";
import { DEMAND_DB_FILE, openDemandDb } from "../src/demandStore.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { RESP_TEXTS, TERMS, fakeCommunity, runOn, virtualTime, windowOf, type Reply } from "./communityFixtures.ts";
import { NOW, SECRET_TEXTS, TARGET, TODAY, candidatesOf, fakeWriter, firstOf, flowOf, goodFile, seedRising, seeded, type FakeWriter, type FlowEnv } from "./flowFixtures.ts";
import { cleanupTemp, makeCtx, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

// 9.98단계 4.3-2, 4.3-3(날짜 상태), 4.3-5, 4.4-2, 4.4-3: 커뮤니티 건수를 받은 전용 DB로 흐름 단계를 돈다. 가짜 응답·가짜 실행기만 쓴다

after(cleanupTemp);

type Route = (url: string, n: number) => Reply | undefined;

/** 지어낸 전용 DB에 커뮤니티 받기를 한 번 돈다(가짜 응답) */
async function withCommunity(e: FlowEnv, route?: Route, extra: Partial<CommunityRunOptions> = {}) {
  const d = e.demand();
  try {
    const vt = virtualTime();
    const h = fakeCommunity(vt.clock, route);
    await runOn(d, h.http, vt, extra);
    return h;
  } finally {
    d.close();
  }
}

function step(e: FlowEnv, fake: FakeWriter, prev?: DemandFlowState, o: Partial<FlowStepInput> = {}): FlowStepResult {
  return runFlowStep({ db: e.db, dataDir: e.dataDir, target: TARGET, today: TODAY, prev, off: false, env: { PATH: "/bin" }, run: fake.run, clock: () => 0, home: null, secrets: [], ...o });
}

function drive(e: FlowEnv, fake: FakeWriter): FlowStepResult[] {
  const out: FlowStepResult[] = [];
  let p: DemandFlowState | undefined;
  for (let i = 0; i < 4; i++) {
    const r = step(e, fake, p);
    out.push(r);
    p = r.state;
    if (r.state.status !== "again") break;
  }
  return out;
}

const comOf = (d: FlowCandidates, source: string) => {
  const c = (d.community ?? []).find((x) => x.source === source);
  if (c === undefined) throw new Error(`${source} 커뮤니티 단위가 없다`);
  return c.n;
};

/** 공식 Wikimedia 한 곳과 GitHub 커뮤니티 단위를 잇는 흐름 파일 */
const communityFile = (d: FlowCandidates) => ({ targetDate: d.target, flows: [flowOf([firstOf(d, "wikimedia"), comOf(d, "github:issues")])], excluded: [] });

const noLeak = (...texts: string[]) => {
  for (const t of texts) for (const f of [...RESP_TEXTS, ...TERMS, ...SECRET_TEXTS]) assert.ok(!t.includes(f), `"${f}"가 나왔다`);
};

const route = {
  robots: ((url) => (url.endsWith("robots.txt") ? { status: 200, text: "User-agent: ClaudeBot\nDisallow: /\n", headers: {} } : undefined)) as Route,
  rate: ((url) => (url.endsWith("robots.txt") ? undefined : { status: 429, text: "rate limited", headers: { "retry-after": "1" } })) as Route,
  forbidden: ((url) => (url.endsWith("robots.txt") ? undefined : { status: 403, text: "forbidden", headers: {} })) as Route,
  query: ((url) => (url.endsWith("robots.txt") ? undefined : url.includes("api.github.com") ? { status: 422, text: "{}", headers: {} } : { status: 400, text: "{}", headers: {} })) as Route,
  /** 두 소스 모두 오르지 않음(앞 창이 커서) */
  flat: ((url) => {
    if (url.endsWith("robots.txt")) return undefined;
    const w = windowOf(url);
    const json = url.includes("api.github.com") ? { total_count: w.recent ? 30 : 400, incomplete_results: false, items: [] } : { posts: [], hitsTotal: w.recent ? 30 : 400 };
    return { status: 200, text: JSON.stringify(json), headers: {} };
  }) as Route,
};
const ALL_OFF = { off: { groups: ["github", "bluesky"], sources: [] } };

describe("4.3-2 격리 지시", () => {
  test("지시문에 S1 인정 규칙과 S5 표본 성격 문구가 있다", () => {
    for (const t of [
      "공식 묶음이 하나 이상 꼭 있어야 한다",
      "다른 공식 묶음이 하나 더 있거나, 그 흐름의 공식 오른 단위를 검색어로 한 오른 커뮤니티 단위가 하나 이상 있어야 한다",
      "커뮤니티 단위만으로나 커뮤니티 단위끼리는 흐름이 아니다",
      "커뮤니티 단위는 그 검색어의 공식 단위와 함께만 쓴다",
      "오르지 않았거나 한 곳 쏠림인 커뮤니티 단위는 쓰지 않는다",
      "치우친 표본",
      "'사람들 전체'",
      "excluded는 재료에 요구가 들어 뺀 오른 단위 번호만 적는다(커뮤니티 단위는 재료가 없어 적지 않는다)",
    ])
      assert.ok(FLOW_RULES.includes(t), t);
  });
});

describe("4.3-3 공식 한 곳 + 커뮤니티", () => {
  test("공식 한 곳과 오른 커뮤니티 단위로 프로세스를 부르고, 커뮤니티 확인 흐름이 '중'으로 실린다. 출력에 검색어·응답 글이 없다", async () => {
    const e = seeded(["wikimedia"]);
    await withCommunity(e);
    const fake = fakeWriter(() => communityFile(candidatesOf(e.dataDir)));
    const r = drive(e, fake);
    assert.equal(r.at(-1)!.state.status, "checked", r.flatMap((x) => x.lines).join("\n"));
    assert.equal(fake.reqs.length, 1);
    assert.match(fake.copies[0]!, /## 커뮤니티 단위 \(2개\)/);
    for (const t of RESP_TEXTS) assert.ok(!fake.copies[0]!.includes(t), t);
    const [f] = flowsOfDate(e.db, TARGET);
    assert.equal(f!.level, "medium");
    assert.deepEqual(f!.units.map((u) => u.group), ["wikimedia"]);
    assert.deepEqual((f!.community ?? []).map((c) => [c.source, c.officialKey, c.unitName, c.recent, c.base]), [["github:issues", f!.units[0]!.unitKey, f!.units[0]!.unitName, 50, 10]]);
    const s = r.at(-1)!.state;
    assert.deepEqual([s.communityFlows, s.communityUnits, s.communityRising], [1, 2, 2]);
    assert.match(r.at(-1)!.lines.join("\n"), /커뮤니티 확인 흐름 1건/);
    noLeak(...r.flatMap((x) => x.lines), JSON.stringify(r.map((x) => x.state)));
  });

  test("공식 한 곳 + 커뮤니티 단위가 있으면(오르지 않아도) 기준 부족이 아니고 프로세스를 부른다", async () => {
    const e = seeded(["wikimedia"]);
    await withCommunity(e, route.flat);
    const fake = fakeWriter(() => ({ targetDate: TARGET, flows: [], excluded: [] }));
    const s = step(e, fake);
    assert.equal(s.state.status, "checked");
    assert.equal(fake.reqs.length, 1);
    assert.deepEqual([s.state.communityUnits, s.state.communityRising], [2, 0]);
  });

  const shortCases: { name: string; prep: (e: FlowEnv) => Promise<unknown> }[] = [
    { name: "커뮤니티 기록 없음", prep: async () => undefined },
    { name: "커뮤니티 모두 꺼짐", prep: (e) => withCommunity(e, undefined, ALL_OFF) },
    { name: "같은 날 받은 뒤 커뮤니티를 모두 끔(받은 건수는 쓰지 않는다)", prep: async (e) => (await withCommunity(e), await withCommunity(e, undefined, ALL_OFF)) },
    { name: "robots 막힘", prep: (e) => withCommunity(e, route.robots) },
    { name: "막힘(한도 표시 없는 403)", prep: (e) => withCommunity(e, route.forbidden) },
    { name: "질의 오류만(GitHub 422·Bluesky 400)", prep: (e) => withCommunity(e, route.query) },
  ];
  for (const c of shortCases) {
    test(`공식 한 곳 + ${c.name}: 기준 부족이고 프로세스를 부르지 않는다`, async () => {
      const e = seeded(["wikimedia"]);
      await c.prep(e);
      const fake = fakeWriter(() => null);
      const s = step(e, fake);
      assert.equal(s.state.status, "short", s.lines.join("\n"));
      assert.equal(fake.reqs.length, 0);
      assert.equal(flowDateOf(e.db, TARGET)?.status, "short");
      noLeak(...s.lines);
    });
  }

  test("공식 한 곳 + 검색어 0개(분류 이름 소스만): 기준 부족이다", async () => {
    const e = seeded(["dart"]);
    await withCommunity(e);
    const d = openDemandDb(e.demandFile);
    const st = d.prepare("SELECT DISTINCT status FROM community_status").all() as { status: string }[];
    d.close();
    assert.deepEqual(st.map((x) => x.status), ["noterms"]);
    const s = step(e, fakeWriter(() => null));
    assert.equal(s.state.status, "short");
  });

  test("공식 한 곳 + 커뮤니티 일시적 실패(429 두 번): 받지 못함이고, 같은 대상 날짜에 다시 돌면 다시 한다", async () => {
    const e = seeded(["wikimedia"]);
    await withCommunity(e, route.rate);
    const fake = fakeWriter(() => communityFile(candidatesOf(e.dataDir)));
    const s = step(e, fake);
    assert.equal(s.state.status, "failed");
    assert.equal(fake.reqs.length, 0);
    assert.equal(flowDateOf(e.db, TARGET)?.status, "failed");
    // 다음 실행: 커뮤니티를 다시 받으면 같은 날을 다시 해 실린다
    await withCommunity(e);
    const again = drive(e, fake);
    assert.equal(again.at(-1)!.state.status, "checked");
    assert.equal(flowsOfDate(e.db, TARGET).length, 1);
  });

  test("공식 0곳은 커뮤니티와 상관없이 기준 부족이다", async () => {
    const e = seeded([]);
    await withCommunity(e);
    const fake = fakeWriter(() => null);
    assert.equal(step(e, fake).state.status, "short");
    assert.equal(fake.reqs.length, 0);
  });
});

describe("4.3-5 커뮤니티가 없을 때(9.97 결과와 같다)", () => {
  const strip = (fs_: Flow[]) =>
    fs_.map((f) => {
      const { turning, community, ...rest } = f;
      void turning;
      assert.deepEqual(community, [], "커뮤니티 근거 줄이 없다");
      return rest;
    });

  async function outcome(groups: ("wikimedia" | "dart" | "sec")[], prep: (e: FlowEnv) => Promise<unknown>) {
    const e = seeded(groups);
    await prep(e);
    const fake = fakeWriter(() => goodFile(candidatesOf(e.dataDir)));
    const r = drive(e, fake);
    const date = flowDateOf(e.db, TARGET)!;
    return { status: date.status, missing: date.missing, flows: strip(flowsOfDate(e.db, TARGET)), calls: fake.reqs.length, recognized: r.at(-1)!.state.recognized, levels: r.at(-1)!.state.levels, copy: fake.copies[0] ?? null, communityMissing: date.communityMissing };
  }

  test("공식 둘 이상: 기록 없음·모두 꺼짐·일시적 실패에서 인정·수준·실린 항목·날짜 상태·후보 목록이 같다", async () => {
    const none = await outcome(["wikimedia", "dart", "sec"], async () => undefined);
    const off = await outcome(["wikimedia", "dart", "sec"], (e) => withCommunity(e, undefined, ALL_OFF));
    const rate = await outcome(["wikimedia", "dart", "sec"], (e) => withCommunity(e, route.rate));
    assert.equal(none.status, "checked");
    assert.equal(none.flows.length, 1);
    assert.deepEqual(none.communityMissing, [], "기록이 없으면 9.97과 같은 날짜 상태다");
    for (const x of [off, rate]) {
      const { communityMissing, ...a } = x;
      const { communityMissing: c0, ...b } = none;
      void c0;
      assert.deepEqual(a, b);
      assert.deepEqual(
        communityMissing!.map((m) => m.reason),
        x === off ? ["off", "off"] : ["failed", "failed"],
      );
    }
  });

  test("공식 한 곳: 기록 없음·꺼짐은 9.97처럼 기준 부족이고, 일시적 실패는 날짜 상태만 받지 못함이다", async () => {
    const none = await outcome(["wikimedia"], async () => undefined);
    const off = await outcome(["wikimedia"], (e) => withCommunity(e, undefined, ALL_OFF));
    const rate = await outcome(["wikimedia"], (e) => withCommunity(e, route.rate));
    assert.deepEqual([none.status, off.status, rate.status], ["short", "short", "failed"]);
    for (const x of [none, off, rate]) assert.deepEqual([x.flows, x.calls, x.missing], [[], 0, none.missing]);
  });
});

describe("4.4-2 커뮤니티 실패는 흐름 단계를 멈추지 않는다", () => {
  test("커뮤니티 표를 읽지 못하면 커뮤니티 없이 9.97 규칙으로 끝난다", async () => {
    const e = seeded(["wikimedia", "dart"]);
    await withCommunity(e);
    const d = openDemandDb(e.demandFile);
    d.exec("DROP TABLE community_counts; CREATE TABLE community_counts (broken TEXT)");
    d.close();
    const fake = fakeWriter(() => goodFile(candidatesOf(e.dataDir)));
    const r = drive(e, fake);
    assert.equal(r.at(-1)!.state.status, "checked");
    assert.ok(!fake.copies[0]!.includes("## 커뮤니티 단위"));
    assert.equal(flowsOfDate(e.db, TARGET).length, 1);
  });

  test("받지 못한 커뮤니티 소스는 비교에서 빠지고 날짜 상태와 실행 기록의 빠진 소스에 사유와 함께 든다", async () => {
    const e = seeded(["wikimedia", "dart"]);
    await withCommunity(e, (url) => (url.includes("api.bsky.app") ? route.robots(url, 1) : undefined));
    const fake = fakeWriter(() => goodFile(candidatesOf(e.dataDir)));
    const r = drive(e, fake);
    assert.equal(r.at(-1)!.state.status, "checked");
    assert.deepEqual(flowDateOf(e.db, TARGET)!.communityMissing, [{ source: "bluesky:posts", group: "bluesky", reason: "robots" }]);
    assert.deepEqual(r.at(-1)!.state.communityMissing, [{ source: "bluesky:posts", group: "bluesky", reason: "robots" }]);
    assert.ok(fake.copies[0]!.includes("github:issues"));
    assert.ok(!fake.copies[0]!.includes("bluesky:posts"), "빠진 소스의 단위는 후보에 없다");
  });
});

// ---- 명령(4.4-2, 4.4-3) ----

interface S {
  repo: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  runFile: string;
}

function setup(groups: ("wikimedia" | "dart" | "sec")[]): S {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, TARGET);
  addBrief(db, TARGET);
  db.close();
  const d = openDemandDb(path.join(dataDir, DEMAND_DB_FILE));
  seedRising(d, groups);
  d.close();
  const env: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home", PATH: process.env.PATH };
  const ctx = makeCtx(repo, env, NOW);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, dataDir: readRun(runFile).dataDir, env, runFile };
}

const buildSite = ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(inputDir, path.join(outDir, "site-data"), { recursive: true });
  writeFakePublicFiles(outDir);
  return { ok: true as const };
};

async function runAll(s: S, r: Route | undefined, write: (d: FlowCandidates) => unknown) {
  const vt = virtualTime();
  const h = fakeCommunity(vt.clock, r);
  const c = { ...makeCtx(s.repo, s.env, NOW), communityHttp: h.http, communityClock: vt.clock, communitySleep: vt.sleep, communityTimer: vt.timer };
  assert.equal(await mainAsync(["demand-community", "--run", s.runFile], c), 0, c.text());
  const fake = fakeWriter(() => write(candidatesOf(s.dataDir)));
  const out: string[] = [c.text()];
  for (let i = 0; i < 3; i++) {
    const f = { ...makeCtx(s.repo, s.env, NOW), claudeRun: fake.run, flowClock: () => 0 };
    assert.equal(main(["demand-flow", "--run", s.runFile], f), 0, f.text());
    out.push(f.text());
    if (readRun(s.runFile).demandFlow?.status !== "again") break;
  }
  const b = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["backup", "--run", s.runFile], b), 0, b.text());
  const site = { ...makeCtx(s.repo, s.env, NOW), buildSite };
  assert.equal(main(["site", "--run", s.runFile], site), 0, site.text());
  const sum = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["summary", "--run", s.runFile], sum), 0, sum.text());
  return { out: out.join("\n"), summary: sum.text() };
}

describe("4.4-2·4.4-3 명령과 요약", () => {
  test("커뮤니티 확인 흐름 수가 실행 기록과 요약에 나오고, 검색어·응답 글이 출력·실행 기록·요약·사이트 데이터·백업에 없다", async () => {
    const s = setup(["wikimedia"]);
    const r = await runAll(s, undefined, communityFile);
    const st = readRun(s.runFile).demandFlow!;
    assert.equal(st.status, "checked");
    assert.equal(st.communityFlows, 1);
    assert.match(r.summary, /- 수요 흐름\(2026-11-03\): 확인함, 실린 1건, 인정된 1건/);
    assert.match(r.summary, / {2}- 커뮤니티 단위 2개\(오른 것 2개\), 커뮤니티 확인 흐름 1건/);
    noLeak(r.out, r.summary, fs.readFileSync(s.runFile, "utf8"));
    for (const dir of ["site", "backup"])
      for (const rel of fs.readdirSync(path.join(s.dataDir, dir), { recursive: true }).map(String)) {
        const p = path.join(s.dataDir, dir, rel);
        if (!fs.statSync(p).isFile()) continue;
        const text = fs.readFileSync(p, "utf8");
        for (const t of RESP_TEXTS) assert.ok(!text.includes(t), `${dir}/${rel}: ${t}`);
      }
  });

  test("커뮤니티 robots 막힘: 흐름은 9.97 규칙으로 끝나고 요약의 빠진 소스에 커뮤니티 소스 이름과 사유가 나온다", async () => {
    const s = setup(["wikimedia", "dart", "sec"]);
    const r = await runAll(s, route.robots, (d) => goodFile(d));
    assert.equal(readRun(s.runFile).demandFlow?.status, "checked");
    assert.match(r.summary, /비교에 넣지 못한 커뮤니티 소스: GitHub Issues\(robots 막힘\), Bluesky\(robots 막힘\)/);
    assert.match(r.summary, /커뮤니티 확인 흐름 0건/);
    assert.ok(fs.existsSync(path.join(s.dataDir, "site", "index.html")));
    noLeak(r.out, r.summary, fs.readFileSync(s.runFile, "utf8"));
  });
});
