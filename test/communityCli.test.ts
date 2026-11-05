import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { COMMUNITY_DEADLINE_MS } from "../src/communityFetch.ts";
import { setCommunityStatus } from "../src/communityStore.ts";
import { migrate, openDb } from "../src/db.ts";
import { FLOW_OFF_ENV } from "../src/demandFlowRun.ts";
import { DEMAND_COPY_DIR, DEMAND_DB_FILE, DEMAND_MIGRATIONS, openDemandDb, setStatus } from "../src/demandStore.ts";
import { addDays } from "../src/kst.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { RESP_TEXTS, communityDump, fakeCommunity, virtualTime, windowOf, type Reply } from "./communityFixtures.ts";
import { FAKE, NOW, SECRET_TEXTS, TARGET, candidatesOf, fakeWriter, goodFile, seedAux, seedRising } from "./flowFixtures.ts";
import { PROJECT_ROOT, cleanupTemp, makeCtx, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

// 9.98단계 4.2-4, 4.4-1~4.4-3: demand-community 명령, 전용 DB 마이그레이션, 실패 격리, 실행 요약, 스킬 문서. 가짜 응답과 가짜 시계만 쓴다

after(cleanupTemp);

const NAME = "demand-community";
const SKILL = fs.readFileSync(path.join(PROJECT_ROOT, ".claude/skills/brief/SKILL.md"), "utf8");

interface S {
  repo: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  runFile: string;
  demandFile: string;
}

function setup(o: { demand?: "seeded" | "none" | "old"; mode?: "test"; env?: NodeJS.ProcessEnv } = {}): S {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, TARGET);
  addBrief(db, TARGET);
  db.close();
  const demandFile = path.join(dataDir, DEMAND_DB_FILE);
  if (o.demand === "old") {
    // 9.97 버전 스키마(마이그레이션 1·2)에 지어낸 9.95·9.96 행
    const d = new DatabaseSync(demandFile);
    migrate(d, DEMAND_MIGRATIONS.filter((m) => m.version <= 2));
    seedRising(d);
    seedAux(d);
    setStatus(d, "google:KR", "2026-11-04", "ok", null, "2026-11-04T06:00:00+09:00");
    d.close();
  } else if (o.demand !== "none") {
    const d = openDemandDb(demandFile);
    seedRising(d);
    seedAux(d);
    d.close();
  }
  const env: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home", PATH: process.env.PATH, ...o.env };
  const ctx = makeCtx(repo, env, NOW);
  assert.equal(main(o.mode === "test" ? ["start", "test", TARGET] : ["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, dataDir: readRun(runFile).dataDir, env, runFile, demandFile };
}

async function community(s: S, route?: (url: string, n: number) => Reply | undefined, extra: Record<string, unknown> = {}, args: string[] = []) {
  const vt = virtualTime();
  const h = fakeCommunity(vt.clock, route);
  const ctx = { ...makeCtx(s.repo, s.env, NOW), communityHttp: h.http, communityClock: vt.clock, communitySleep: vt.sleep, communityTimer: vt.timer, ...extra };
  const code = await mainAsync([NAME, "--run", s.runFile, ...args], ctx);
  return { code, text: ctx.text(), h };
}

function summary(s: S): string {
  const c = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["summary", "--run", s.runFile], c), 0, c.text());
  return c.text();
}

const sha = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function noLeak(...texts: string[]): void {
  for (const t of texts) for (const f of [...SECRET_TEXTS, ...RESP_TEXTS, "api.github.com/search", "api.bsky.app/xrpc"]) assert.ok(!t.includes(f), `"${f}"가 나왔다`);
}

const withDemand = <T>(s: S, f: (db: DatabaseSync) => T): T => {
  const db = new DatabaseSync(s.demandFile, { readOnly: true });
  try {
    return f(db);
  } finally {
    db.close();
  }
};

describe("4.4-1 명령과 실행 모드", () => {
  test("명령이 등록되어 있고, 데이터 폴더 지정 실행에서 받아 실행 기록과 출력에 수만 남긴다", async () => {
    assert.ok(COMMAND_NAMES.includes(NAME));
    const s = setup();
    const r = await community(s);
    assert.equal(r.code, 0, r.text);
    const st = readRun(s.runFile).demandCommunity!;
    assert.equal(st.status, "done");
    assert.equal(st.target, TARGET);
    assert.equal(st.terms, 1);
    assert.deepEqual(Object.values(st.sources).map((x) => x.status), ["ok", "ok"]);
    assert.equal(r.h.calls.length, 6, "소스마다 robots 1 + 두 창");
    noLeak(r.text, fs.readFileSync(s.runFile, "utf8"), summary(s));
  });

  test("시험 모드(/brief test)에서는 꺼짐이고 호출하지 않으며 전용 DB를 열지 않는다", async () => {
    const s = setup({ mode: "test" });
    const db = openDb(readRun(s.runFile).dbPath);
    addBrief(db, TARGET);
    db.close();
    const r = await community(s);
    assert.equal(r.code, 0, r.text);
    assert.equal(r.h.calls.length, 0);
    assert.equal(readRun(s.runFile).demandCommunity?.status, "off");
    assert.match(r.text, /커뮤니티 신호: 꺼짐\(시험 모드\)/);
    assert.ok(!fs.existsSync(path.join(s.dataDir, DEMAND_DB_FILE)));
  });

  test("수요 흐름을 끈 날(끄기 값)에는 꺼짐이고 호출하지 않는다", async () => {
    const s = setup();
    const before = sha(s.demandFile);
    const r = await community({ ...s, env: { ...s.env, [FLOW_OFF_ENV]: "1" } });
    assert.equal(r.code, 0);
    assert.equal(r.h.calls.length, 0);
    assert.equal(readRun(s.runFile).demandCommunity?.status, "off");
    assert.match(r.text, /꺼짐\(수요 흐름 꺼짐\)/);
    assert.equal(sha(s.demandFile), before);
  });

  test("가짜 시계로 명령 전체 상한 6분: 공식 단위 세기에 걸린 시간도 든다", async () => {
    const s = setup();
    let first = true;
    const vt = virtualTime();
    // 시작 시각을 읽은 뒤에는 5분 36초가 지난 시계(공식 단위 세기가 오래 걸린 것)
    const clock = () => {
      if (first) {
        first = false;
        return vt.clock();
      }
      return vt.clock() + COMMUNITY_DEADLINE_MS - 24_000;
    };
    const h = fakeCommunity(clock);
    const ctx = { ...makeCtx(s.repo, s.env, NOW), communityHttp: h.http, communityClock: clock, communitySleep: vt.sleep, communityTimer: vt.timer };
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    const st = readRun(s.runFile).demandCommunity!;
    assert.ok(st.hitDeadline);
    assert.equal(st.sources["github:issues"]!.status, "partial");
    assert.equal(st.sources["github:issues"]!.reason, "deadline");
    assert.ok(st.elapsedMs <= COMMUNITY_DEADLINE_MS);
  });
});

describe("4.4-1 시험 전용 --target", () => {
  function realSetup(link: boolean): S {
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    recordFirstCollectionDate(db, TARGET);
    addBrief(db, TARGET);
    db.close();
    const d = openDemandDb(path.join(dataDir, DEMAND_DB_FILE));
    seedRising(d);
    d.close();
    const env: NodeJS.ProcessEnv = { HOME: "/Users/fake-home", PATH: process.env.PATH };
    if (link) {
      const l = path.join(tempDir(), "data-link");
      fs.symlinkSync(dataDir, l);
      env.TIDWYN_DATA_DIR = l;
    }
    const ctx = makeCtx(repo, env, NOW);
    assert.equal(main(["start"], ctx), 0, ctx.text());
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
    assert.equal(readRun(runFile).mode, "real");
    return { repo, dataDir, env, runFile, demandFile: path.join(dataDir, DEMAND_DB_FILE) };
  }

  for (const link of [false, true]) {
    test(`${link ? "기본 데이터 폴더를 가리키는 경로" : "데이터 폴더 지정 없음"}: --target이 거부되고 아무것도 바뀌지 않는다`, async () => {
      const s = realSetup(link);
      const before = sha(s.demandFile);
      const r = await community(s, undefined, {}, ["--target", "2026-11-02"]);
      assert.equal(r.code, 3, r.text);
      assert.match(r.text, /시험 전용 옵션은 데이터 폴더를 지정한/);
      assert.equal(r.h.calls.length, 0);
      assert.equal(readRun(s.runFile).demandCommunity, undefined);
      assert.equal(sha(s.demandFile), before);
    });
  }

  test("데이터 폴더 지정 실행에서는 받고, 대상 날짜와 공식 자르기가 demand-flow --target과 같다", async () => {
    const s = setup();
    const r = await community(s, undefined, {}, ["--target", "2026-11-02"]);
    assert.equal(r.code, 0, r.text);
    assert.equal(readRun(s.runFile).demandCommunity?.target, "2026-11-02");
    // 창 끝은 대상 날짜 전날을 넘지 않는다
    assert.ok(r.h.github().length > 0);
    assert.ok(r.h.github().every((c) => windowOf(c.url).to <= "2026-11-01"));
    assert.ok(!SKILL.includes("--target"), "시험 전용 옵션은 스킬 문서에 없다");
  });

  test("--target의 잘못된 값은 거부한다", async () => {
    const s = setup();
    const r = await community(s, undefined, {}, ["--target", "2026-13-40"]);
    assert.equal(r.code, 2);
  });
});

describe("4.2-4 전용 DB", () => {
  test("9.97 버전 스키마의 전용 DB를 열면 열기 전 사본이 생기고 새 표가 생기며 기존 행이 그대로다", async () => {
    const s = setup({ demand: "old" });
    const tables = ["demand_snapshots", "demand_parts", "demand_status", "demand_values", "demand_value_parts", "demand_requests", "demand_cuts", "demand_meta"];
    const before = withDemand(s, (db) => tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
    const r = await community(s);
    assert.equal(r.code, 0, r.text);
    const dir = path.join(s.dataDir, DEMAND_COPY_DIR);
    const names = fs.readdirSync(dir);
    assert.equal(names.length, 1);
    const copy = new DatabaseSync(path.join(dir, names[0]!), { readOnly: true });
    assert.equal((copy.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 2);
    copy.close();
    assert.ok(readRun(s.runFile).demandCopied);
    withDemand(s, (db) => {
      assert.equal((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 3);
      assert.deepEqual(
        tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()),
        before,
      );
      assert.ok((db.prepare("SELECT COUNT(*) AS n FROM community_counts").get() as { n: number }).n > 0);
    });
    // 같은 실행에서 공식 수요가 뒤에 열어도 사본을 다시 만들지 않는다(실행 기록의 demandCopied)
    const again = await community(s);
    assert.equal(again.code, 0);
    assert.equal(fs.readdirSync(dir).length, 1);
  });

  test("전용 DB가 없으면(복원 직후) 만들고, 오른 공식 단위가 없어 호출 0(robots 포함)으로 끝난다", async () => {
    const s = setup({ demand: "none" });
    const r = await community(s);
    assert.equal(r.code, 0, r.text);
    assert.equal(r.h.calls.length, 0);
    assert.ok(fs.existsSync(s.demandFile));
    const st = readRun(s.runFile).demandCommunity!;
    assert.deepEqual(Object.values(st.sources).map((x) => x.status), ["noterms", "noterms"]);
    assert.ok(!fs.existsSync(path.join(s.dataDir, DEMAND_COPY_DIR)), "없던 DB는 사본을 만들지 않는다");
  });

  test("새 표의 고치기·지우기는 막히고, 커뮤니티 받기 뒤 9.95·9.96 표의 행이 그대로다", async () => {
    const s = setup();
    const tables = ["demand_snapshots", "demand_parts", "demand_values", "demand_value_parts"];
    const before = withDemand(s, (db) => tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
    await community(s);
    const db = openDemandDb(s.demandFile);
    try {
      assert.deepEqual(tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all()), before);
      for (const t of ["community_terms", "community_counts"]) {
        assert.throws(() => db.prepare(`UPDATE ${t} SET target_date = '2000-01-01'`).run(), /고치지 않는다/, t);
        assert.throws(() => db.prepare(`DELETE FROM ${t}`).run(), /지우지 않는다/, t);
      }
    } finally {
      db.close();
    }
  });

  test("demand-flow는 커뮤니티 받기 뒤에도 전용 DB를 읽기 전용으로만 연다(바이트가 그대로다)", async () => {
    const s = setup();
    await community(s);
    const before = sha(s.demandFile);
    const ctx = { ...makeCtx(s.repo, s.env, NOW), claudeRun: fakeWriter(() => goodFile(candidatesOf(s.dataDir))).run, flowClock: () => 0 };
    assert.equal(main(["demand-flow", "--run", s.runFile], ctx), 0, ctx.text());
    assert.equal(readRun(s.runFile).demandFlow?.status, "checked");
    assert.equal(sha(s.demandFile), before);
  });
});

/** 사이트 빌더는 사이트 입력을 결과물에 그대로 옮기는 가짜다 */
const buildSite = ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(inputDir, path.join(outDir, "site-data"), { recursive: true });
  writeFakePublicFiles(outDir);
  return { ok: true as const };
};

describe("4.4-2 실패 격리(커뮤니티 명령 쪽)", () => {
  type Case = { name: string; route?: (url: string, n: number) => Reply | undefined; extra?: Record<string, unknown>; check: (st: NonNullable<ReturnType<typeof readRun>["demandCommunity"]>) => void };
  const cases: Case[] = [
    {
      name: "robots 막힘",
      route: (url) => (url.endsWith("robots.txt") ? { status: 200, text: "User-agent: ClaudeBot\nDisallow: /\n" } : undefined),
      check: (st) => assert.deepEqual(Object.values(st.sources).map((x) => x.status), ["robots", "robots"]),
    },
    {
      name: "429 두 번",
      route: (url) => (url.endsWith("robots.txt") ? undefined : { status: 429, text: `rate limited ${FAKE.wiki}`, headers: { "retry-after": "1" } }),
      check: (st) => assert.deepEqual(Object.values(st.sources).map((x) => [x.status, x.reason]), [["failed", "rate"], ["failed", "rate"]]),
    },
    {
      name: "시간 초과",
      route: (url) => (url.endsWith("robots.txt") ? undefined : "hang"),
      check: (st) => assert.deepEqual(Object.values(st.sources).map((x) => x.reason), ["timeout", "timeout"]),
    },
    {
      name: "응답 형식 오류",
      route: (url) => (url.endsWith("robots.txt") ? undefined : { status: 200, text: `<html>${RESP_TEXTS[0]} ${FAKE.wiki}</html>`, headers: {} }),
      check: (st) => assert.deepEqual(Object.values(st.sources).map((x) => x.reason), ["format", "format"]),
    },
    {
      name: "새 표 쓰기 실패",
      extra: {
        communityBeforeWrite: () => {
          throw new Error(`가짜 쓰기 실패 ${FAKE.wiki} https://api.github.com/search/issues?q=x`);
        },
      },
      check: (st) => {
        assert.equal(st.status, "crashed");
        assert.equal(st.reason, "커뮤니티 받기가 실패했다");
      },
    },
  ];

  for (const c of cases) {
    test(`${c.name}: 종료 코드 0이고, 수요 흐름·백업·사이트 빌드가 끝나며, 검색어·응답·주소가 출력·실행 기록·요약에 없다`, async () => {
      const s = setup();
      const r = await community(s, c.route, c.extra);
      assert.equal(r.code, 0, r.text);
      c.check(readRun(s.runFile).demandCommunity!);
      const flowCtx = { ...makeCtx(s.repo, s.env, NOW), claudeRun: fakeWriter(() => goodFile(candidatesOf(s.dataDir))).run, flowClock: () => 0 };
      assert.equal(main(["demand-flow", "--run", s.runFile], flowCtx), 0, flowCtx.text());
      assert.equal(readRun(s.runFile).demandFlow?.status, "checked", "9.97 규칙으로 흐름이 끝난다");
      const b = makeCtx(s.repo, s.env, NOW);
      assert.equal(main(["backup", "--run", s.runFile], b), 0, b.text());
      const site = { ...makeCtx(s.repo, s.env, NOW), buildSite };
      assert.equal(main(["site", "--run", s.runFile], site), 0, site.text());
      assert.ok(fs.existsSync(path.join(s.dataDir, "site", "index.html")));
      const text = summary(s);
      assert.match(text, /커뮤니티 신호/);
      noLeak(r.text, text, fs.readFileSync(s.runFile, "utf8"), flowCtx.text());
      const dump = withDemand(s, communityDump);
      for (const t of RESP_TEXTS) assert.ok(!dump.includes(t), t);
    });
  }
});

describe("4.4-3 실행 요약", () => {
  test("요약 줄에 소스마다 상태·검색어 수·호출 수·오른 단위·쏠림·상한 닿음·걸린 시간이 나오고 검색어는 없다", async () => {
    const s = setup();
    await community(s);
    const lines = summary(s).split("\n");
    const want = [
      `- 커뮤니티 신호(${TARGET}): 검색어 1개, 걸린 시간 6초`,
      "  - GitHub Issues: 받음. 검색어 1개, 호출 3번(robots 1번), 받은 창 2, 받지 못한 창 0, 오른 단위 1, 쏠림으로 뺌 0, 상한 닿음 0, 걸린 시간 6초",
      "  - Bluesky: 받음. 검색어 1개, 호출 3번(robots 1번), 받은 창 2, 받지 못한 창 0, 오른 단위 1, 쏠림으로 뺌 0, 상한 닿음 0, 걸린 시간 1초",
    ];
    for (const w of want) assert.ok(lines.includes(w), `${w}\n---\n${lines.join("\n")}`);
  });

  test("막힘·받지 못함이 3일 이어지면 따로 적는다(2일이면 적지 않는다)", async () => {
    for (const [days, shown] of [[2, true], [1, false]] as const) {
      const s = setup();
      const db = openDemandDb(s.demandFile);
      for (let i = 1; i <= days; i++) setCommunityStatus(db, addDays(TARGET, -i), "github:issues", i === 1 ? "blocked" : "failed", null, "2026-11-01T07:00:00+09:00");
      db.close();
      await community(s, (url) => (url.includes("api.github.com/search") ? { status: 403, text: "", headers: {} } : undefined));
      const text = summary(s);
      assert.equal(text.includes("커뮤니티 소스 막힘·받지 못함이 3일 이상 이어졌다: GitHub Issues 3일"), shown, text);
      assert.ok(!text.includes("Bluesky 3일"));
    }
  });

  test("일부 받음은 이어짐에 세지 않는다", async () => {
    const s = setup();
    const db = openDemandDb(s.demandFile);
    setCommunityStatus(db, addDays(TARGET, -2), "github:issues", "failed", "rate", "2026-11-01T07:00:00+09:00");
    setCommunityStatus(db, addDays(TARGET, -1), "github:issues", "partial", "rate", "2026-11-02T07:00:00+09:00");
    db.close();
    await community(s, (url) => (url.includes("api.github.com/search") ? { status: 403, text: "", headers: {} } : undefined));
    assert.ok(!summary(s).includes("3일 이상 이어졌다"));
  });
});

describe("4.4-1 스킬 문서", () => {
  const rows = SKILL.split("\n").filter((l) => /^\| \d+(-\d+)* \|/.test(l));
  const rowAt = (n: string) => rows.findIndex((r) => r.startsWith(`| ${n} |`));
  function chapter(heading: string): string {
    const start = SKILL.indexOf(`\n${heading}\n`);
    assert.ok(start >= 0, heading);
    const rest = SKILL.slice(start + heading.length + 2);
    const end = rest.search(/^#{1,3} /m);
    return end < 0 ? rest : rest.slice(0, end);
  }

  test("명령 이름이 실제 명령과 같고, 단계가 14-1 뒤·14-2 바로 앞에 있다", () => {
    assert.ok(SKILL.includes(`node src/cli.ts ${NAME} --run <실행 기록>`));
    assert.ok(rows[rowAt("14-1-1")]!.includes(NAME));
    assert.equal(rowAt("14-1-1"), rowAt("14-1") + 1);
    assert.equal(rowAt("14-2"), rowAt("14-1-1") + 1);
    const at = (h: string) => SKILL.indexOf(`\n${h}\n`);
    assert.ok(at("### 14-1단계: 수요 스냅샷") < at("### 14-1-1단계: 커뮤니티 신호") && at("### 14-1-1단계: 커뮤니티 신호") < at("### 14-2단계: 수요 흐름"));
  });

  test("Bash 시간 제한은 8분(10분 이하)이고, 실패해도 다시 부르지 않고 14-2로 넘어가며, 시험 모드는 꺼짐이다", () => {
    const step = chapter("### 14-1-1단계: 커뮤니티 신호");
    const m = /Bash 도구 시간 제한을 (\d+)분으로 준다/.exec(step);
    assert.ok(m !== null);
    assert.equal(Number(m[1]), 8);
    assert.ok(Number(m[1]) * 60_000 <= 10 * 60_000 && Number(m[1]) * 60_000 > COMMUNITY_DEADLINE_MS);
    assert.ok(step.includes("다시 부르지 않고 14-2단계로 넘어간다"));
    assert.ok(step.includes("앞 단계가 실패해도 돈다"));
    assert.ok(step.includes("시험 모드(`/brief test`)와 수요 흐름을 끈 날에는 돌지 않는다"));
    assert.ok(step.includes("데이터 폴더 지정 실행은 돈다"));
    assert.ok(rows[rowAt("14-1-1")]!.includes("Bash 도구 시간 제한 8분"));
    assert.ok(rows[rowAt("14-2")]!.includes("Bash 도구 시간 제한 10분"), "14-2는 그대로다");
  });

  test("0장 금지 줄: 메인은 커뮤니티 응답과 전용 DB의 커뮤니티 표를 읽지 않는다", () => {
    const rules = chapter("### 실행 중에 하지 않는 것");
    const line = rules.split("\n").find((l) => l.includes("커뮤니티 소스(GitHub Issues, Bluesky)"));
    assert.ok(line !== undefined);
    assert.ok(line.includes("메인은 커뮤니티 응답과 전용 DB의 커뮤니티 표(`community_terms`, `community_counts`, `community_status`)를 읽지 않고, 명령 출력의 수와 상태만 본다"));
    for (const t of ["community_terms", "community_counts", "community_status"]) {
      const db = openDemandDb(path.join(tempDir(), DEMAND_DB_FILE));
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(t), t);
      db.close();
    }
  });
});
