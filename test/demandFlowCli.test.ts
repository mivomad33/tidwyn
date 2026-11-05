import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { FLOW_OFF_ENV } from "../src/demandFlowRun.ts";
import { flowDateOf, flowsOfDate, setFlowDate } from "../src/demandFlowStore.ts";
import { flowWorkFile } from "../src/demandFlowWork.ts";
import { FLOW_WORK_NAMES } from "../src/demandFlowTypes.ts";
import { DEMAND_DB_FILE } from "../src/demandStore.ts";
import { KEY_NAMES } from "../src/keys.ts";
import { addDays } from "../src/kst.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { cleanupTemp, makeCtx, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";
import { NOW, SECRET_TEXTS, TARGET, candidatesOf, fakeWriter, firstOf, flowOf, goodFile, seedAux, seedRising, type FakeWriter } from "./flowFixtures.ts";
import { openDemandDb } from "../src/demandStore.ts";
import { fakeOfficial, virtualTime } from "./officialFixtures.ts";

// 9.97단계 4.3-1~3, 4.5-3, 4.6-6: demand-flow 명령, 실패 격리, 실행 요약, 키, 시험 전용 옵션 거부. 가짜 실행기만 쓴다

after(cleanupTemp);

const NAME = "demand-flow";
const FAKE_KEYS = Object.fromEntries(KEY_NAMES.map((k) => [k, `FAKE-${k}-VALUE-QZ`]));

interface S {
  repo: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
  runFile: string;
  demandFile: string;
}

function setup(o: { demand?: "seeded" | "none" | "one"; mode?: "custom" | "test"; env?: NodeJS.ProcessEnv; briefs?: string[] } = {}): S {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  const briefs = o.briefs ?? [TARGET];
  recordFirstCollectionDate(db, briefs[0]!);
  for (const d of briefs) addBrief(db, d);
  db.close();
  const demandFile = path.join(dataDir, DEMAND_DB_FILE);
  if (o.demand !== "none") {
    const d = openDemandDb(demandFile);
    seedRising(d, o.demand === "one" ? ["wikimedia"] : undefined);
    seedAux(d);
    d.close();
  }
  const env: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home", PATH: process.env.PATH, ...o.env };
  const ctx = makeCtx(repo, env, NOW);
  assert.equal(main(o.mode === "test" ? ["start", "test", TARGET] : ["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, dataDir: readRun(runFile).dataDir, env, runFile, demandFile };
}

function flow(s: S, fake?: FakeWriter, extra: Record<string, unknown> = {}, args: string[] = []) {
  const ctx = { ...makeCtx(s.repo, s.env, NOW), ...(fake ? { claudeRun: fake.run } : {}), flowClock: () => 0, ...extra };
  const code = main([NAME, "--run", s.runFile, ...args], ctx);
  return { code, text: ctx.text() };
}

/** 스킬처럼 '다시 부른다'인 동안 세 번까지 부른다 */
function flowAll(s: S, fake?: FakeWriter, extra: Record<string, unknown> = {}) {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const r = flow(s, fake, extra);
    assert.equal(r.code, 0, r.text);
    out.push(r.text);
    if (readRun(s.runFile).demandFlow?.status !== "again") break;
  }
  return out.join("\n");
}

function summary(s: S): string {
  const c = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["summary", "--run", s.runFile], c), 0, c.text());
  return c.text();
}

const withDb = <T>(s: S, f: (db: ReturnType<typeof openDb>) => T): T => {
  const db = openDb(path.join(s.dataDir, "tidwyn.db"));
  try {
    return f(db);
  } finally {
    db.close();
  }
};

const sha = (file: string) => (fs.existsSync(file) ? createHash("sha256").update(fs.readFileSync(file)).digest("hex") : "없음");
const good = (s: S) => fakeWriter(() => goodFile(candidatesOf(s.dataDir)));

function noLeak(...texts: string[]): void {
  for (const t of texts) for (const f of [...SECRET_TEXTS, ...Object.values(FAKE_KEYS)]) assert.ok(!t.includes(f), `"${f}"가 나왔다`);
}

/** 사이트 빌더는 사이트 입력을 결과물에 그대로 옮기는 가짜다 */
const buildSite = ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
  fs.mkdirSync(outDir, { recursive: true });
  fs.cpSync(inputDir, path.join(outDir, "site-data"), { recursive: true });
  writeFakePublicFiles(outDir);
  return { ok: true as const };
};

function hashTree(dir: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  for (const rel of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const p = path.join(dir, rel);
    if (!fs.statSync(p).isFile() || skip(rel)) continue;
    if (/(^|\/)list-\d{4}-\d{2}\.json$/.test(rel)) {
      // 날짜 목록의 수요 칸('수요 N' 탭)은 이 단계가 바꾸는 값이라 빼고 비교한다
      const j = JSON.parse(fs.readFileSync(p, "utf8")) as { days: Record<string, unknown>[] };
      for (const d of j.days) delete d.demand;
      out[rel] = createHash("sha256").update(JSON.stringify(j)).digest("hex");
    } else out[rel] = sha(p);
  }
  return out;
}

/** 백업과 사이트 빌드를 돌리고, 수요 흐름 밖의 결과(백업 파일, 사이트 입력)를 해시로 돌려준다 */
function backupAndSite(s: S): { backup: Record<string, string>; site: Record<string, string> } {
  const b = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["backup", "--run", s.runFile], b), 0, b.text());
  const c = { ...makeCtx(s.repo, s.env, NOW), buildSite };
  assert.equal(main(["site", "--run", s.runFile], c), 0, c.text());
  const notDemand = (rel: string) => /demand/i.test(rel);
  return { backup: hashTree(path.join(s.dataDir, "backup"), notDemand), site: hashTree(path.join(s.dataDir, "site"), notDemand) };
}

describe("4.3-1 명령과 실행 모드", () => {
  test("명령이 등록되어 있고, 데이터 폴더 지정 실행에서 돌아 확인함으로 저장한다", () => {
    assert.ok(COMMAND_NAMES.includes(NAME));
    const s = setup();
    const fake = good(s);
    const out = flowAll(s, fake);
    assert.equal(fake.reqs.length, 1);
    assert.equal(readRun(s.runFile).demandFlow?.status, "checked");
    withDb(s, (db) => {
      assert.equal(flowDateOf(db, TARGET)?.status, "checked");
      assert.equal(flowsOfDate(db, TARGET).length, 1);
    });
    noLeak(out);
  });

  test("시험 모드(/brief test)에서는 꺼짐이고 프로세스를 부르지 않는다", () => {
    const s = setup({ mode: "test" });
    // 시험 모드의 데이터 폴더는 새 폴더라 브리프와 전용 DB를 그 폴더에 만든다
    const db = openDb(readRun(s.runFile).dbPath);
    addBrief(db, TARGET);
    db.close();
    const d = openDemandDb(path.join(s.dataDir, DEMAND_DB_FILE));
    seedRising(d);
    d.close();
    const fake = good(s);
    const r = flow(s, fake);
    assert.equal(r.code, 0, r.text);
    assert.equal(fake.reqs.length, 0);
    assert.equal(readRun(s.runFile).demandFlow?.status, "off");
    assert.match(r.text, /수요 흐름: 꺼짐/);
  });
});

describe("4.3-2 실패 격리", () => {
  type Case = { name: string; s: () => S; fake: (s: S) => FakeWriter; extra?: Record<string, unknown>; status: string; date: string };
  const cases: Case[] = [
    { name: "전용 DB 없음", s: () => setup({ demand: "none" }), fake: good, status: "short", date: "short" },
    {
      name: "깨진 전용 DB",
      s: () => {
        const s = setup({ demand: "none" });
        fs.writeFileSync(s.demandFile, "이것은 SQLite 파일이 아니다");
        return s;
      },
      fake: good,
      status: "failed",
      date: "failed",
    },
    {
      name: "단위 세기 예외(풀 수 없는 원문)",
      s: () => {
        const s = setup();
        const d = openDemandDb(s.demandFile);
        d.prepare("INSERT INTO demand_values (source, grp, label, value_date, fetched_on, fetched_at, items, total, raw_bytes, bytes, elapsed_ms) VALUES ('dart:list', 'dart', 'x', '2026-11-02', '2026-11-03', '2026-11-03T06:00:00+09:00', 1, NULL, 1, 1, 0)").run();
        const id = (d.prepare("SELECT MAX(id) AS id FROM demand_values").get() as { id: number }).id;
        d.prepare("INSERT INTO demand_value_parts (value_id, part, page, url, absent, encoding, body) VALUES (?, 'list', 1, 'https://fake.example/x', 0, 'gzip', ?)").run(id, Buffer.from("gzip이 아니다"));
        d.close();
        return s;
      },
      fake: good,
      status: "failed",
      date: "failed",
    },
    { name: "프로세스 시간 초과", s: () => setup(), fake: () => fakeWriter(() => null, { status: null, timedOut: true }), status: "failed", date: "failed" },
    { name: "프로세스 비정상 종료", s: () => setup(), fake: () => fakeWriter(() => null, { status: 1, timedOut: false }), status: "failed", date: "failed" },
    { name: "검사 실패", s: () => setup(), fake: (s) => fakeWriter(() => goodFile(candidatesOf(s.dataDir), ["wikimedia"], { flows: [flowOf([firstOf(candidatesOf(s.dataDir), "wikimedia")])] })), status: "failed", date: "failed" },
  ];

  for (const c of cases) {
    test(`${c.name}: 종료 코드 0이고 날짜 상태가 저장되며 백업·사이트 빌드가 끝나고 다른 데이터가 그대로다`, () => {
      const s = c.s();
      const before = backupAndSite(s);
      const demandBefore = sha(s.demandFile);
      const out = flowAll(s, c.fake(s), c.extra);
      assert.equal(readRun(s.runFile).demandFlow?.status, c.status, out);
      withDb(s, (db) => assert.equal(flowDateOf(db, TARGET)?.status, c.date));
      assert.equal(sha(s.demandFile), demandBefore, "전용 DB 바이트가 그대로다");
      assert.deepEqual(fs.readdirSync(s.dataDir).filter((f) => f.startsWith(DEMAND_DB_FILE)), fs.existsSync(s.demandFile) ? [DEMAND_DB_FILE] : [], "저널 파일도 만들지 않는다");
      const afterRun = backupAndSite(s);
      assert.deepEqual(afterRun, before, "수요 흐름 밖의 백업 파일과 사이트 입력이 같다");
      assert.ok(fs.existsSync(path.join(s.dataDir, "site", "index.html")), "사이트가 빌드되었다");
      for (const k of Object.keys(FLOW_WORK_NAMES)) assert.ok(!fs.existsSync(flowWorkFile(s.dataDir, k as keyof typeof FLOW_WORK_NAMES)), k);
      noLeak(out, summary(s), fs.readFileSync(s.runFile, "utf8"));
    });
  }

  test("성공한 실행 뒤에도 전용 DB의 바이트가 그대로다", () => {
    const s = setup();
    const before = sha(s.demandFile);
    flowAll(s, good(s));
    assert.equal(readRun(s.runFile).demandFlow?.status, "checked");
    assert.equal(sha(s.demandFile), before);
  });

  test("끄기 값이면 꺼짐이고, 켠 뒤 같은 날 다시 돌면 다시 한다", () => {
    const s = setup();
    const fake = good(s);
    const off = flow({ ...s, env: { ...s.env, [FLOW_OFF_ENV]: "1" } }, fake);
    assert.equal(off.code, 0);
    assert.equal(fake.reqs.length, 0);
    withDb(s, (db) => assert.equal(flowDateOf(db, TARGET)?.status, "off"));
    const s2 = { ...s, runFile: setupRun(s) };
    flowAll(s2, fake);
    assert.equal(fake.reqs.length, 1);
    withDb(s, (db) => assert.equal(flowDateOf(db, TARGET)?.status, "checked"));
  });
});

/** 같은 데이터 폴더로 새 실행 기록을 만든다 */
function setupRun(s: S): string {
  const ctx = makeCtx(s.repo, s.env, NOW);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  return /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
}

describe("4.3-3 실행 요약", () => {
  test("요약 줄에 상태·건수·수준·비교 묶음·빠진 묶음·오른 단위·복사본 크기·프로세스·제외 키가 나오고 글은 없다", () => {
    const s = setup();
    const fake = fakeWriter(() => {
      const d = candidatesOf(s.dataDir);
      return goodFile(d, ["wikimedia", "dart"], { excluded: [firstOf(d, "sec")] });
    });
    const out = flowAll(s, fake);
    const st = readRun(s.runFile).demandFlow!;
    const secKey = st.excluded![0]!;
    assert.match(secKey, /^sec:formd:[0-9a-f]{16}$/);
    const text = summary(s);
    const lines = text.split("\n");
    const want = [
      `- 수요 흐름(${TARGET}): 확인함, 실린 1건, 인정된 1건`,
      "  - 근거 수준: 강 0, 중 1, 약 0",
      "  - 비교한 공식 묶음: DART 공시, SEC Form D, Wikimedia 인기 문서",
      "  - 빠진 묶음: 국회 청원(기록 없음), 권익위 민원(기록 없음), 1372 소비자상담(기록 없음)",
      "  - 묶음별 오른 단위: 국회 청원 0, 권익위 민원 0, 1372 소비자상담 0, DART 공시 1, SEC Form D 1, Wikimedia 인기 문서 1",
      `  - 후보 복사본 ${st.copyBytes}바이트`,
      "  - 프로세스 1번, 0초",
      `  - 제외한 단위 키: ${secKey}`,
    ];
    for (const w of want) assert.ok(lines.includes(w), `${w}\n---\n${text}`);
    assert.ok(st.copyBytes! > 0);
    assert.equal(st.recognized, 1);
    assert.deepEqual(st.levels, { medium: 1 });
    noLeak(out, text, fs.readFileSync(s.runFile, "utf8"));
  });

  test("버린 사유별 수가 나온다", () => {
    const s = setup();
    // 첫 프로세스는 실패하고, 다음 호출 전에 후보 복사본의 기계 원본 숫자를 바꿔 다시 센 값과 다르게 만든다
    const fake = fakeWriter((round) => (round === 1 ? null : goodFile(candidatesOf(s.dataDir))), (round) => ({ status: round === 1 ? 1 : 0, timedOut: false }));
    assert.equal(flow(s, fake).code, 0);
    const json = flowWorkFile(s.dataDir, "candidates");
    const raw = JSON.parse(fs.readFileSync(json, "utf8")) as { units: { recent: number }[] };
    for (const u of raw.units) u.recent += 1;
    fs.writeFileSync(json, JSON.stringify(raw));
    flowAll(s, fake);
    const st = readRun(s.runFile).demandFlow!;
    assert.deepEqual([st.status, st.shown, st.recognized, st.dropped], ["checked", 0, 0, { "다시 센 값이 다름": 1 }]);
    assert.ok(summary(s).split("\n").includes("  - 버린 흐름: 다시 센 값이 다름 1"));
  });

  test("받지 못함이 3일 이어지면 따로 적는다(2일이면 적지 않는다)", () => {
    for (const [days, shown] of [[2, true], [1, false]] as const) {
      const s = setup();
      withDb(s, (db) => {
        for (let i = 1; i <= days; i++) setFlowDate(db, { date: addDays(TARGET, -i), status: "failed", missing: [] });
      });
      flowAll(s, fakeWriter(() => null, { status: 1, timedOut: false }));
      const st = readRun(s.runFile).demandFlow!;
      assert.equal(st.failDays, days + 1);
      const has = summary(s).includes(`  - 받지 못함이 ${days + 1}일 이어졌다`);
      assert.equal(has, shown, String(days + 1));
    }
  });
});

describe("4.5-3 키가 나가지 않음", () => {
  test("지어낸 키 값이 격리 환경·후보 복사본·흐름 항목·실행 기록·출력·요약에 없다", () => {
    const s = setup({ env: FAKE_KEYS });
    const fake = good(s);
    const out = flowAll(s, fake);
    assert.equal(readRun(s.runFile).demandFlow?.status, "checked");
    const envText = JSON.stringify(fake.reqs.map((r) => r.env));
    const items = withDb(s, (db) => JSON.stringify(flowsOfDate(db, TARGET)));
    for (const v of Object.values(FAKE_KEYS)) {
      for (const [where, t] of [["격리 환경", envText], ["후보 복사본", fake.copies.join("\n")], ["지시문", fake.reqs.map((r) => r.args.join(" ")).join("\n")], ["흐름 항목", items], ["실행 기록", fs.readFileSync(s.runFile, "utf8")], ["출력", out], ["요약", summary(s)]] as const) assert.ok(!t.includes(v), `${where}에 키 값`);
    }
  });
});

describe("4.6-6 시험 전용 옵션 거부", () => {
  /** 데이터 폴더를 지정하지 않은 실행(실제 데이터 폴더). 임시 저장소의 data/다 */
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
      // 기본 데이터 폴더를 가리키는 다른 경로(실제 경로로 비교한다)
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
    const label = link ? "기본 데이터 폴더를 가리키는 경로" : "데이터 폴더 지정 없음";
    test(`${label}: demand-flow의 --target·--measure·창 길이와 demand-official의 --start·--skip이 거부되고 아무것도 바뀌지 않는다`, async () => {
      const s = realSetup(link);
      const demandBefore = sha(s.demandFile);
      const fake = good(s);
      for (const args of [["--target", "2026-10-20"], ["--recent-days", "14"], ["--base-days", "56"]]) {
        const r = flow(s, fake, {}, args);
        assert.equal(r.code, 3, `${args.join(" ")}: ${r.text}`);
        assert.match(r.text, /시험 전용 옵션은 데이터 폴더를 지정한/);
      }
      const m = makeCtx(s.repo, s.env, NOW);
      assert.equal(main([NAME, "--measure", "--target", "2026-10-20"], m), 3, m.text());
      assert.equal(fake.reqs.length, 0);
      assert.equal(readRun(s.runFile).demandFlow, undefined);
      const vt = virtualTime();
      for (const args of [["--start", "acrc=2026-08-01"], ["--start", "acrc:qna=2026-08-25"], ["--skip", "acrc:bigdata"]]) {
        const h = fakeOfficial(vt.clock);
        const c = { ...makeCtx(s.repo, s.env, NOW), officialHttp: h.http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
        assert.equal(await mainAsync(["demand-official", "--run", s.runFile, ...args], c), 3, `${args.join(" ")}: ${c.text()}`);
        assert.equal(h.calls.length, 0);
      }
      assert.equal(readRun(s.runFile).officialDemand, undefined);
      withDb(s, (db) => assert.equal(flowDateOf(db, TARGET), null));
      assert.equal(sha(s.demandFile), demandBefore);
    });
  }

  test("데이터 폴더를 지정한(실제가 아닌) 실행에서는 시험 전용 옵션을 받는다", async () => {
    const s = setup();
    const m = makeCtx(s.repo, s.env, NOW);
    assert.equal(main([NAME, "--measure", "--target", TARGET], m), 0, m.text());
    const measured = JSON.parse(m.text()) as { target: string; compared: string[]; copyBytes: number };
    assert.equal(measured.target, TARGET);
    assert.deepEqual(measured.compared, ["dart", "sec", "wikimedia"]);
    withDb(s, (db) => assert.equal(flowDateOf(db, TARGET), null, "측정은 날짜 상태를 저장하지 않는다"));
    const r = flow(s, fakeWriter(() => null, { status: 1, timedOut: false }), {}, ["--target", addDays(TARGET, -1)]);
    assert.equal(r.code, 0, r.text);
    assert.notEqual(readRun(s.runFile).demandFlow?.status, undefined);
    const vt = virtualTime();
    const c = { ...makeCtx(s.repo, s.env, NOW), officialHttp: fakeOfficial(vt.clock).http, officialSources: [], demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
    assert.notEqual(await mainAsync(["demand-official", "--run", s.runFile, "--skip", "acrc:bigdata", "--start", "acrc=2026-08-01"], c), 3, c.text());
  });
});

describe("코드 리뷰 지적 재현(9.97 CLI)", () => {
  test("4.3-2 저장 중 예외가 나도 실행 기록에 대상 날짜가 남고 날짜 상태는 받지 못함이며 작업 파일이 없다", () => {
    const s = setup();
    const r = flow(s, good(s), { flowFailDuringSave: () => { throw new Error("가짜 저장 실패"); } });
    assert.equal(r.code, 0, r.text);
    assert.equal(readRun(s.runFile).demandFlow?.target, TARGET);
    assert.equal(readRun(s.runFile).demandFlow?.status, "failed");
    assert.equal(withDb(s, (db) => flowDateOf(db, TARGET)?.status), "failed");
    assert.equal(readRun(s.runFile).demandFlow?.failDays, 1, "받지 못함이 이어진 날 수도 남긴다");
    for (const k of Object.keys(FLOW_WORK_NAMES) as (keyof typeof FLOW_WORK_NAMES)[]) assert.ok(!fs.existsSync(flowWorkFile(s.dataDir, k)), k);
  });

  test("4.6-6 시험 옵션의 잘못된 값은 거부한다(--start 날짜 소스에 달만, 창 길이가 양의 정수가 아님)", async () => {
    const s = setup();
    for (const args of [["--recent-days", "abc"], ["--base-days", "0"], ["--recent-days=-3"]]) {
      const c = makeCtx(s.repo, s.env, NOW);
      assert.notEqual(main([NAME, "--measure", "--target", TARGET, ...args], c), 0, args.join(" "));
      assert.match(c.text(), /양의 정수/, args.join(" "));
    }
    const c = makeCtx(s.repo, s.env, NOW);
    assert.notEqual(await mainAsync(["demand-official", "--run", s.runFile, "--start", "dart=2026-08"], c), 0);
    assert.match(c.text(), /YYYY-MM-DD/);
    assert.equal(readRun(s.runFile).officialDemand, undefined, "받지 않는다");
  });
});
