import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { migrate, openDb } from "../src/db.ts";
import { DEMAND_DOC, WIKIMEDIA_WIKIS, officialSources } from "../src/demandSources.ts";
import { DEMAND_COPY_DIR, DEMAND_DB_FILE, DEMAND_MIGRATIONS, openDemandDb } from "../src/demandStore.ts";
import { OFFICIAL_DEADLINE_MS } from "../src/officialDemand.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { fakeHttp } from "./demandFixtures.ts";
import { KEYS, NOW, TEXTS, fakeOfficial, pick, savedDates, virtualTime } from "./officialFixtures.ts";
import { PROJECT_ROOT, cleanupTemp, makeCtx, tempDir, tempRepo } from "./helpers.ts";

// 9.96단계 4.1-6, 4.2-2, 4.3, 4.4-1·3, 4.5-1: 공식 수요 명령, 실행 기록 합치기, 사본, 스킬·판정 문서. 네트워크를 쓰지 않는다

after(cleanupTemp);

const NAME = "demand-official";

function setup(mode: "custom" | "test" = "custom", keys: Partial<Record<keyof typeof KEYS, string>> = KEYS) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, "2026-11-03");
  addBrief(db, "2026-11-03");
  db.close();
  const environment: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home", ...keys };
  const ctx = makeCtx(repo, environment, NOW);
  assert.equal(main(mode === "test" ? ["start", "test", "2026-11-03"] : ["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, environment, runFile, dataDir: readRun(runFile).dataDir, dbFile: readRun(runFile).dbPath };
}

type Setup = ReturnType<typeof setup>;

function ctxOf(s: Setup, http: ReturnType<typeof fakeOfficial>["http"], vt: ReturnType<typeof virtualTime>, extra: Record<string, unknown> = {}) {
  return { ...makeCtx(s.repo, s.environment, NOW), officialHttp: http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer, ...extra };
}

function summary(s: Setup): string {
  const c = makeCtx(s.repo, s.environment, NOW);
  assert.equal(main(["summary", "--run", s.runFile], c), 0);
  return c.text();
}

function noLeak(...texts: string[]): void {
  for (const t of texts) for (const f of [...TEXTS, ...Object.values(KEYS)]) assert.ok(!t.includes(f), `"${f}"가 나왔다`);
}

const copies = (s: Setup) => (fs.existsSync(path.join(s.dataDir, DEMAND_COPY_DIR)) ? fs.readdirSync(path.join(s.dataDir, DEMAND_COPY_DIR)).length : 0);

describe("4.3 명령과 실행 요약", () => {
  test("명령이 등록되어 있고, 출력·실행 기록·요약에 묶음별 수와 상한이 나온다. 받은 글과 키는 어디에도 없다", async () => {
    assert.ok(COMMAND_NAMES.includes(NAME));
    const s = setup();
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock, (u) => (u.includes("list.json") ? { status: 200, text: `{"status":"000","list":[{"corp_name":"${TEXTS[1]}"` } : u.includes("primary_doc.xml") ? { status: 200, text: `<broken>${TEXTS[1]}` } : undefined));
    const ctx = ctxOf(s, h.http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0, ctx.text());
    const out = ctx.text();
    for (const label of ["국회 청원", "권익위 민원", "1372 소비자상담", "DART 공시", "SEC Form D", "Wikimedia 인기 문서"]) assert.match(out, new RegExp(`- 공식 수요 ${label}: 소스 \\d+개 중 받음 \\d+`), label);
    assert.match(out, /공식 수요 DART 공시: 소스 1개 중 받음 0, 받지 못함 1\(공시검색 목록: 형식 오류\)/);
    assert.match(out, /공식 수요 SEC Form D: 소스 1개 중 받음 0, 받지 못함 1\(EDGAR Form D: 형식 오류\)/);
    assert.match(out, /- 공식 수요\(2026-11-04\): 전용 DB \d+바이트, 걸린 시간 \d+초\(1번 부름\), 남은 채우기 대상 \d+/);
    assert.match(out, /- 공식 수요 상한: 닿음, 남은 대상 있음/, "민원빅데이터의 2분 간격 때문에 첫 실행은 상한에 닿는다");
    const st = readRun(s.runFile).officialDemand!;
    assert.equal(st.status, "done");
    assert.equal(st.calls, 1);
    assert.equal(st.dbBytes, fs.statSync(path.join(s.dataDir, DEMAND_DB_FILE)).size);
    assert.match(summary(s), /- 공식 수요 Wikimedia 인기 문서: 소스 10개 중 받음 10/);
    noLeak(out, summary(s), fs.readFileSync(s.runFile, "utf8"));
  });

  test("모든 소스가 실패해도 종료 코드는 0이다", async () => {
    const s = setup();
    const vt = virtualTime();
    const ctx = ctxOf(s, fakeOfficial(vt.clock, () => ({ status: 503, text: "" })).http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    const st = readRun(s.runFile).officialDemand!;
    assert.equal(Object.keys(st.failed).length, officialSources().length);
  });

  test("같은 실행 기록의 두 번째 호출은 남은 대상만 요청하고 결과가 합쳐지며, 세 번째 호출은 요청하지 않는다", async () => {
    const s = setup();
    const vt = virtualTime();
    const sources = pick("acrc:qna", "dart:list");
    const h1 = fakeOfficial(vt.clock);
    const c1 = ctxOf(s, h1.http, vt, { officialSources: sources, officialDeadlineMs: 80_000 });
    assert.equal(await mainAsync([NAME, "--run", s.runFile], c1), 0);
    assert.match(c1.text(), /공식 수요 상한: 닿음, 남은 대상 있음/);
    const first = readRun(s.runFile).officialDemand!;
    const demandFile = path.join(s.dataDir, DEMAND_DB_FILE);
    const saved = (source: string) => {
      const d = new DatabaseSync(demandFile, { readOnly: true });
      const r = savedDates(d, source).map((x) => x.replaceAll("-", ""));
      d.close();
      return r;
    };
    const savedAfter1 = saved("acrc:qna");
    const dartAfter1 = saved("dart:list");
    assert.ok(savedAfter1.length > 0 && savedAfter1.length < 35, String(savedAfter1.length));
    const h2 = fakeOfficial(vt.clock);
    const c2 = ctxOf(s, h2.http, vt, { officialSources: sources, officialDeadlineMs: OFFICIAL_DEADLINE_MS });
    assert.equal(await mainAsync([NAME, "--run", s.runFile], c2), 0);
    const lists2 = h2.of((u) => u.pathname.endsWith("PolicyQnaList")).map((c) => new URL(c.url).searchParams.get("regFrom")!);
    assert.ok(lists2.length > 0 && lists2.every((d) => !savedAfter1.includes(d)), "앞 호출이 저장한 값 날짜는 다시 요청하지 않는다");
    const dart2 = h2.of((u) => u.pathname.endsWith("list.json")).map((c) => new URL(c.url).searchParams.get("bgn_de")!);
    assert.ok(dart2.every((d) => !dartAfter1.includes(d)), "다른 소스도 앞 호출이 저장한 값 날짜는 다시 요청하지 않는다");
    const merged = readRun(s.runFile).officialDemand!;
    assert.equal(merged.calls, 2);
    assert.equal(merged.sources["acrc:qna"]!.filled, 35);
    assert.equal(merged.groups.acrc!.requests, first.groups.acrc!.requests + h2.calls.filter((c) => new URL(c.url).host === "apis.data.go.kr").length);
    assert.match(c2.text(), /\(2번 부름\)/);
    assert.match(c2.text(), /공식 수요 상한: 닿지 않음/);
    const h3 = fakeOfficial(vt.clock);
    const c3 = ctxOf(s, h3.http, vt, { officialSources: sources });
    assert.equal(await mainAsync([NAME, "--run", s.runFile], c3), 0);
    assert.equal(h3.calls.length, 0);
    assert.match(c3.text(), /이미 2번 받았다/);
    assert.equal(readRun(s.runFile).officialDemand!.calls, 2);
  });

  test("앞 호출의 키 거부 뒤 같은 실행의 뒤 호출은 그 소스를 요청하지 않는다", async () => {
    const s = setup();
    const vt = virtualTime();
    const sources = pick("dart:list");
    const h1 = fakeOfficial(vt.clock, (u) => (u.includes("list.json") ? { status: 200, text: JSON.stringify({ status: "011", message: "사용할 수 없는 키입니다." }) } : undefined));
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h1.http, vt, { officialSources: sources })), 0);
    const h2 = fakeOfficial(vt.clock);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h2.http, vt, { officialSources: sources })), 0);
    assert.equal(h2.calls.length, 0);
    assert.match(summary(s), /공시검색 목록: 키 거부/);
  });

  test("전용 DB를 쓸 수 없으면 0이 아닌 코드로 끝나고 본 DB의 바이트는 그대로다", async () => {
    const s = setup();
    fs.mkdirSync(path.join(s.dataDir, DEMAND_DB_FILE));
    const before = fs.readFileSync(s.dbFile);
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    assert.notEqual(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h.http, vt)), 0);
    assert.equal(h.calls.length, 0);
    assert.ok(fs.readFileSync(s.dbFile).equals(before));
    assert.equal(readRun(s.runFile).officialDemand?.status, "crashed");
    assert.match(summary(s), /공식 수요: 실패\(전용 DB를 열거나 쓰지 못했다\)/);
  });

  test("같은 실행의 뒤 호출이 전용 DB를 쓰지 못해도 앞 호출의 결과는 실행 기록에 남는다", async () => {
    const s = setup();
    const vt = virtualTime();
    const sources = pick("wikimedia:ko");
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeOfficial(vt.clock).http, vt, { officialSources: sources })), 0);
    const first = readRun(s.runFile).officialDemand!;
    const file = path.join(s.dataDir, DEMAND_DB_FILE);
    fs.renameSync(file, `${file}.moved`);
    fs.mkdirSync(file);
    assert.notEqual(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeOfficial(vt.clock).http, vt, { officialSources: sources })), 0);
    const st = readRun(s.runFile).officialDemand!;
    assert.equal(st.status, "crashed");
    assert.equal(st.calls, 2);
    assert.equal(st.groups.wikimedia!.requests, first.groups.wikimedia!.requests);
    assert.equal(st.sources["wikimedia:ko"]!.filled, first.sources["wikimedia:ko"]!.filled);
    assert.equal(readRun(s.runFile).demandCopied, undefined, "앞 호출은 전용 DB가 없어 사본을 만들지 않았다");
  });

  test("시험 모드는 돌지 않고(요청 0, 전용 DB 없음) 지정 모드는 돈다", async () => {
    const t = setup("test");
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    const ctx = ctxOf(t, h.http, vt);
    assert.equal(await mainAsync([NAME, "--run", t.runFile], ctx), 0, ctx.text());
    assert.equal(h.calls.length, 0);
    assert.equal(readRun(t.runFile).officialDemand?.status, "off");
    assert.equal(readRun(t.runFile).officialDemand?.groups.wikimedia?.off, WIKIMEDIA_WIKIS.length);
    assert.ok(!fs.existsSync(path.join(t.dataDir, DEMAND_DB_FILE)));
    assert.match(ctx.text(), /공식 수요: 꺼짐\(시험 모드\)/);
    const s = setup();
    const h2 = fakeOfficial(vt.clock);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h2.http, vt, { officialSources: pick("wikimedia:ko") })), 0);
    assert.ok(h2.calls.length > 0);
  });

  test("키가 환경에 없으면 그 키의 소스만 키 없음이다", async () => {
    const s = setup("custom", { DATA_GO_KR_KEY: KEYS.DATA_GO_KR_KEY, DART_API_KEY: KEYS.DART_API_KEY });
    const vt = virtualTime();
    const h = fakeOfficial(vt.clock);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h.http, vt, { officialSources: pick("assembly", "dart:list") })), 0);
    assert.ok(!h.urls().some((u) => u.includes("open.assembly.go.kr")));
    const st = readRun(s.runFile).officialDemand!;
    assert.equal(st.groups.assembly!.noKey, 3);
    assert.equal(st.groups.dart!.ok, 1);
  });
});

describe("4.1-6 실행 전 사본", () => {
  test("같은 실행 기록으로 14-1과 공식 수요를 차례로 돌리면 사본이 하나 는다", async () => {
    const s = setup();
    const vt = virtualTime();
    // 전용 DB가 있는 상태를 만든다(앞 실행)
    openDemandDb(path.join(s.dataDir, DEMAND_DB_FILE)).close();
    const c1 = { ...makeCtx(s.repo, s.environment, NOW), demandHttp: fakeHttp(vt.clock).http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
    assert.equal(await mainAsync(["demand-fetch", "--run", s.runFile], c1), 0, c1.text());
    assert.equal(copies(s), 1);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeOfficial(vt.clock).http, vt, { officialSources: pick("wikimedia:ko") })), 0);
    assert.equal(copies(s), 1);
    assert.equal(readRun(s.runFile).demandCopied, true);
  });

  test("공식 수요 명령만 돌 때도 받을 것이 있으면 사본이 하나 생기고, 그 뒤 14-1은 만들지 않는다", async () => {
    const s = setup();
    const vt = virtualTime();
    openDemandDb(path.join(s.dataDir, DEMAND_DB_FILE)).close();
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeOfficial(vt.clock).http, vt, { officialSources: pick("wikimedia:ko") })), 0);
    assert.equal(copies(s), 1);
    const c1 = { ...makeCtx(s.repo, s.environment, NOW), demandHttp: fakeHttp(vt.clock).http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
    assert.equal(await mainAsync(["demand-fetch", "--run", s.runFile], c1), 0);
    assert.equal(copies(s), 1);
  });

  test("이전 마이그레이션 번호의 전용 DB로 시작한 실행의 사본은 이전 user_version이다", async () => {
    const s = setup();
    const file = path.join(s.dataDir, DEMAND_DB_FILE);
    const old = new DatabaseSync(file);
    migrate(old, DEMAND_MIGRATIONS.filter((m) => m.version === 1));
    old.close();
    const vt = virtualTime();
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeOfficial(vt.clock).http, vt, { officialSources: pick("wikimedia:ko") })), 0);
    const dir = path.join(s.dataDir, DEMAND_COPY_DIR);
    const names = fs.readdirSync(dir);
    assert.equal(names.length, 1);
    const copy = new DatabaseSync(path.join(dir, names[0]!), { readOnly: true });
    assert.equal((copy.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, 1);
    copy.close();
  });
});

const SKILL = fs.readFileSync(path.join(PROJECT_ROOT, ".claude/skills/brief/SKILL.md"), "utf8");
function chapter(heading: string): string {
  const start = SKILL.indexOf(`\n${heading}\n`);
  assert.ok(start >= 0, heading);
  const rest = SKILL.slice(start + heading.length + 2);
  const end = rest.search(/^#{1,3} /m);
  return end < 0 ? rest : rest.slice(0, end);
}

describe("4.3-1, 4.4-1 스킬 문서", () => {
  const rows = SKILL.split("\n").filter((l) => /^\| \d+(-\d+)* \|/.test(l));
  const rowAt = (n: string) => rows.findIndex((r) => r.startsWith(`| ${n} |`));

  test("명령 이름이 실제 명령과 같고, 새 단계가 push 단계 뒤·출력 단계 앞에 있다", () => {
    assert.ok(SKILL.includes(`node src/cli.ts ${NAME} --run <실행 기록>`));
    assert.ok(rows[rowAt("18-1")]!.includes(NAME));
    assert.ok(rows[rowAt("18")]!.includes("push"));
    assert.ok(rows[rowAt("19")]!.includes("summary"));
    assert.ok(rowAt("18") < rowAt("18-1") && rowAt("18-1") < rowAt("19"));
    assert.ok(SKILL.indexOf("### 18-1단계: 공식 수요") > SKILL.indexOf("### 16단계~18단계:") && SKILL.indexOf("### 18-1단계: 공식 수요") < SKILL.indexOf("### 19단계:"));
  });

  test("다시 부르는 조건과 횟수(두 번), 시간 제한, 앞 단계의 건너뛰기 문장이 적혀 있다", () => {
    const step = chapter("### 18-1단계: 공식 수요");
    assert.ok(step.includes("출력에 `공식 수요 상한: 닿음, 남은 대상 있음`이 있으면 같은 명령을 한 번 더 부른다. 모두 2번까지 부른다"));
    assert.ok(step.includes("Bash 도구 시간 제한을 10분으로 준다(명령 한 번의 상한이 9분이다)"));
    assert.ok(step.includes("백그라운드로 돌리지 않는다"));
    assert.ok(step.includes("다시 부르지 않고 19단계로 넘어간다"));
    assert.ok(step.includes("앞 단계가 실패해도 돈다"));
    assert.ok(chapter("### 16단계~18단계: 사이트 빌드, 배포, push").includes("다음 명령과 18-1단계로 넘어간다"));
  });

  test("0장 금지 줄에 새 소스 묶음 이름과 명령이 있다", () => {
    const rules = chapter("### 실행 중에 하지 않는 것");
    for (const g of ["국회 청원", "권익위 민원", "1372 소비자상담", "DART 공시", "SEC Form D", "Wikimedia 인기 문서"]) assert.ok(rules.includes(g), g);
    assert.ok(rules.includes("소스는 `demand-fetch`와 `demand-official`만 받는다"));
    assert.ok(SKILL.includes("  - 공식 수요: 묶음별"));
  });
});

describe("4.5-1 판정 문서와 코드 목록", () => {
  const doc = fs.readFileSync(path.join(PROJECT_ROOT, DEMAND_DOC), "utf8");
  const block = (name: string) => {
    const m = new RegExp(`<!-- demand:${name} -->\\n([\\s\\S]*?)<!-- /demand:${name} -->`).exec(doc);
    assert.ok(m, name);
    return m[1]!;
  };

  test("공식 소스 id·묶음·위키 코드와 끔 표시가 코드와 같다", () => {
    const rows = block("official")
      .split("\n")
      .filter((l) => /^\| `/.test(l))
      .map((l) => l.split("|").map((c) => c.trim()));
    const listed = rows.map((r) => [/`([^`]+)`/.exec(r[1]!)![1]!, /`([^`]+)`/.exec(r[2]!)![1]!, r[4]!.includes("끔")] as const);
    const wikis = [...block("wikis").matchAll(/`([a-z]+)`/g)].map((m) => m[1]);
    assert.deepEqual(wikis, [...WIKIMEDIA_WIKIS]);
    const expanded = listed.flatMap(([id, group, off]) => (id === "wikimedia:<위키>" ? wikis.map((w) => [`wikimedia:${w}`, group, off] as const) : [[id, group, off] as const]));
    assert.deepEqual(
      expanded.map(([id, group]) => [id, group]),
      officialSources().map((s) => [s.id, s.group]),
    );
    const offInDoc = expanded.filter(([, , off]) => off).map(([id]) => id);
    const offRows = block("off")
      .split("\n")
      .filter((l) => /^\| `/.test(l))
      .map((l) => /^\| `([^`]+)`/.exec(l)![1]!);
    for (const id of offInDoc) assert.ok(offRows.includes(id), id);
  });

  test("README 두 파일의 수요 신호 줄에 공식 데이터와 시작일이 같은 자리에 있다", () => {
    const ko = fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8").split("\n");
    const en = fs.readFileSync(path.join(PROJECT_ROOT, "README.en.md"), "utf8").split("\n");
    const k = ko.findIndex((l) => l.startsWith("3. 수요 신호") && l.includes("공식 기관·공개 데이터(청원, 민원, 소비자상담, 공시, 투자 신고, 인기 문서)") && l.includes("2026-09-30"));
    const e = en.findIndex((l) => l.startsWith("3. Demand signals") && l.includes("Official and open data (petitions, public complaints, consumer counseling, disclosures, investment filings, popular articles)") && l.includes("2026-09-30"));
    assert.ok(k > 0 && k === e, `${k} ${e}`);
  });
});
