import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { DEMAND_DOC, DEMAND_GROUPS_OFF, DEMAND_SOURCES_OFF, GOOGLE_GEOS, MASTODON_INSTANCES, allDemandSourceIds, demandSources, googleTrendsUrl } from "../src/demandSources.ts";
import { DEMAND_COPY_DIR, DEMAND_DB_FILE, openDemandDb } from "../src/demandStore.ts";
import { commitsOfRefs, localBranches, precheck } from "../src/precheck.ts";
import { readRun } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { FAKE_ACCOUNT, FAKE_AUTHOR, FAKE_LINK_TITLE, FAKE_TAG, FAKE_TERM, NOW, defaultReply, fakeHttp, rss, virtualTime } from "./demandFixtures.ts";
import { PROJECT_ROOT, cleanupTemp, gitIn, makeCtx, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";
import { DROPPED, FAKE, KEYS, TEXTS as OFFICIAL_TEXTS, bodies, fakeOfficial } from "./officialFixtures.ts";

// 9.95단계 4.3, 4.4, 4.5-1: 명령, 실행 요약, 실패 격리, 비공개 보장, 스킬 문서와 판정 문서. 네트워크를 쓰지 않는다

after(cleanupTemp);

const FAKE_TEXTS = [FAKE_TERM, FAKE_TAG, FAKE_LINK_TITLE, FAKE_AUTHOR, FAKE_ACCOUNT, ...OFFICIAL_TEXTS, ...Object.values(KEYS)];
const NAME = "demand-fetch";

function setup(mode: "custom" | "test" = "custom") {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, "2026-11-03");
  addBrief(db, "2026-11-03");
  db.close();
  const environment: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home" };
  const ctx = makeCtx(repo, environment, NOW);
  assert.equal(main(mode === "test" ? ["start", "test", "2026-11-03"] : ["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  return { repo, environment, runFile, dataDir: readRun(runFile).dataDir, dbFile: readRun(runFile).dbPath };
}

function ctxOf(s: ReturnType<typeof setup>, http = fakeHttp(virtualTime().clock).http, vt = virtualTime()) {
  return { ...makeCtx(s.repo, s.environment, NOW), demandHttp: http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
}

function summary(s: ReturnType<typeof setup>): string {
  const c = makeCtx(s.repo, s.environment, NOW);
  assert.equal(main(["summary", "--run", s.runFile], c), 0);
  return c.text();
}

function noFakeText(...texts: string[]): void {
  for (const t of texts) for (const f of FAKE_TEXTS) assert.ok(!t.includes(f), `받은 글 "${f}"가 나왔다`);
}

function hashTree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fs.readdirSync(dir, { recursive: true }).map(String).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) out[f] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  }
  return out;
}

describe("4.3 명령과 실행 요약", () => {
  test("명령이 등록되어 있고, 묶음별 수·요청 수·상한·바이트·DB 크기·시간을 출력과 실행 기록과 요약에 쓴다. 받은 글은 어디에도 없다", async () => {
    assert.ok(COMMAND_NAMES.includes(NAME));
    const s = setup();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => (url === googleTrendsUrl("NG") ? { status: 500, text: "" } : new URL(url).host === "uri.life" && url.includes("/trends/") ? defaultReply(url, { tags: 120, links: 5 }) : undefined));
    const ctx = ctxOf(s, h.http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0, ctx.text());
    const out = ctx.text();
    assert.match(out, new RegExp(`수요 Google 급상승어: 소스 ${GOOGLE_GEOS.length}개 중 받음 ${GOOGLE_GEOS.length - 1}\\(이번 실행 ${GOOGLE_GEOS.length - 1}\\), 받지 못함 1\\(NG: HTTP 500\\), robots 막힘 0, 꺼짐 0\\. 요청 ${GOOGLE_GEOS.length + 2}번\\(robots 1번\\), 100건 상한 닿음 0번, 저장 \\d+바이트`));
    assert.match(out, new RegExp(`수요 Mastodon 트렌드: 소스 ${MASTODON_INSTANCES.length}개 중 받음 ${MASTODON_INSTANCES.length}\\(이번 실행 ${MASTODON_INSTANCES.length}\\), 받지 못함 0, robots 막힘 0, 꺼짐 0\\. 요청 \\d+번\\(robots ${MASTODON_INSTANCES.length}번\\), 100건 상한 닿음 1번, 저장 \\d+바이트`));
    assert.match(out, /수요 스냅샷\(2026-11-04\): 전용 DB \d+바이트, 걸린 시간 \d+초/);
    const st = readRun(s.runFile).demandFetch!;
    assert.equal(st.status, "done");
    assert.equal(st.groups.mastodon!.capHits, 1);
    assert.equal(st.dbBytes, fs.statSync(path.join(s.dataDir, DEMAND_DB_FILE)).size);
    const sum = summary(s);
    assert.match(sum, /수요 Google 급상승어: .*받지 못함 1\(NG: HTTP 500\)/);
    assert.match(sum, /100건 상한 닿음 1번/);
    noFakeText(out, sum, fs.readFileSync(s.runFile, "utf8"));
    // 같은 날 두 번째 실행은 받지 못한 소스만 부른다
    const h2 = fakeHttp(vt.clock);
    const c2 = ctxOf(s, h2.http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], c2), 0);
    assert.deepEqual(h2.urls(), ["https://trends.google.com/robots.txt", googleTrendsUrl("NG")]);
  });

  test("잘린 JSON과 깨진 피드는 사유에 종류만 나오고 그 글은 출력과 실행 기록에 없다", async () => {
    const s = setup();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock, (url) => {
      if (url === googleTrendsUrl("KR")) return { status: 200, text: rss("KR").slice(0, 150) };
      if (new URL(url).host === "qdon.space" && url.includes("/links")) return { status: 200, text: `[{"title":"${FAKE_LINK_TITLE}","author_name":"${FAKE_AUTHOR}"` };
      if (url === googleTrendsUrl("JP")) return "throw";
      return undefined;
    });
    const ctx = ctxOf(s, h.http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    const st = readRun(s.runFile).demandFetch!;
    assert.deepEqual(st.groups.google!.failed, [
      { label: "KR", reason: "형식 오류" },
      { label: "JP", reason: "연결 실패" },
    ]);
    assert.deepEqual(st.groups.mastodon!.failed, [{ label: "qdon.space", reason: "형식 오류" }]);
    noFakeText(ctx.text(), summary(s), fs.readFileSync(s.runFile, "utf8"));
  });

  test("모든 소스가 실패해도 종료 코드는 0이다", async () => {
    const s = setup();
    const vt = virtualTime();
    const ctx = ctxOf(s, fakeHttp(vt.clock, () => ({ status: 503, text: "" })).http, vt);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    const st = readRun(s.runFile).demandFetch!;
    assert.equal(st.groups.google!.failed.length, GOOGLE_GEOS.length);
    assert.equal(st.groups.mastodon!.failed.length, MASTODON_INSTANCES.length);
  });

  test("전용 DB를 쓸 수 없으면 0이 아닌 코드로 끝나고 본 DB의 바이트는 그대로다", async () => {
    const s = setup();
    fs.mkdirSync(path.join(s.dataDir, DEMAND_DB_FILE));
    const before = fs.readFileSync(s.dbFile);
    const vt = virtualTime();
    const h = fakeHttp(vt.clock);
    const ctx = ctxOf(s, h.http, vt);
    assert.notEqual(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    assert.equal(h.calls.length, 0);
    assert.ok(fs.readFileSync(s.dbFile).equals(before));
    assert.equal(readRun(s.runFile).demandFetch?.status, "crashed");
    assert.match(summary(s), /수요 스냅샷: 실패\(전용 DB를 열거나 쓰지 못했다\)/);
  });

  test("시험 모드는 돌지 않고(요청 0, 전용 DB 없음) 지정 모드는 돈다", async () => {
    const t = setup("test");
    const vt = virtualTime();
    const h = fakeHttp(vt.clock);
    const ctx = ctxOf(t, h.http, vt);
    assert.equal(await mainAsync([NAME, "--run", t.runFile], ctx), 0, ctx.text());
    assert.equal(h.calls.length, 0);
    assert.equal(readRun(t.runFile).demandFetch?.status, "off");
    assert.equal(readRun(t.runFile).demandFetch?.groups.google?.off, GOOGLE_GEOS.length);
    assert.ok(!fs.existsSync(path.join(t.dataDir, DEMAND_DB_FILE)));
    assert.match(ctx.text(), /꺼짐\(시험 모드\)/);
    const s = setup();
    const h2 = fakeHttp(vt.clock);
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, h2.http, vt)), 0);
    assert.ok(h2.calls.length > 0);
  });

  test("끄기 값을 주면 그 묶음을 부르지 않는다", async () => {
    const s = setup();
    const vt = virtualTime();
    const h = fakeHttp(vt.clock);
    const ctx = { ...ctxOf(s, h.http, vt), demandOff: { groups: ["mastodon"], sources: [] } };
    assert.equal(await mainAsync([NAME, "--run", s.runFile], ctx), 0);
    assert.ok(!h.urls().some((u) => u.includes("/api/v1/trends/")));
    assert.match(ctx.text(), new RegExp(`꺼짐 ${MASTODON_INSTANCES.length}`));
  });
});

/** 지어낸 스냅샷이 든 전용 DB와 사본을 데이터 폴더에 둔다 */
async function seedDemand(s: ReturnType<typeof setup>): Promise<void> {
  const vt = virtualTime();
  assert.equal(await mainAsync([NAME, "--run", s.runFile], ctxOf(s, fakeHttp(vt.clock).http, vt)), 0);
  const tomorrow = new Date(NOW.getTime() + 24 * 3600_000);
  assert.equal(await mainAsync([NAME, "--run", s.runFile], { ...ctxOf(s, fakeHttp(vt.clock).http, vt), now: () => tomorrow }), 0);
  assert.ok(fs.readdirSync(path.join(s.dataDir, DEMAND_COPY_DIR)).length > 0);
  const db = openDemandDb(path.join(s.dataDir, DEMAND_DB_FILE));
  const raw = (db.prepare("SELECT body FROM demand_parts").all() as { body: Uint8Array }[]).map((r) => Buffer.from(r.body).toString()).join("");
  db.close();
  assert.ok(raw.includes(FAKE_TERM) && raw.includes(FAKE_TAG) && raw.includes(FAKE_LINK_TITLE), "지어낸 글이 전용 DB에 있다");
  // 9.96단계 공식 수요도 같은 전용 DB에 쌓는다(4.4-2)
  const ovt = virtualTime();
  const o = { ...makeCtx(s.repo, { ...s.environment, ...KEYS }, NOW), officialHttp: fakeOfficial(ovt.clock).http, demandClock: ovt.clock, demandSleep: ovt.sleep, demandTimer: ovt.timer };
  assert.equal(await mainAsync(["demand-official", "--run", s.runFile], o), 0, o.text());
  const odb = openDemandDb(path.join(s.dataDir, DEMAND_DB_FILE));
  const official = bodies(odb).join("");
  odb.close();
  for (const t of [FAKE.title, FAKE.company, FAKE.article]) assert.ok(official.includes(t), `지어낸 공식 글 "${t}"가 전용 DB에 있다`);
  for (const t of DROPPED) assert.ok(!official.includes(t), t);
}

describe("4.4-2 사이트에 나가지 않음", () => {
  // 사이트 빌더는 사이트 입력(site-input)만 받으므로 그 폴더를 결과물에 그대로 옮기는 가짜 빌더로 본다
  const builder = ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(inputDir, path.join(outDir, "site-data"), { recursive: true });
    writeFakePublicFiles(outDir);
    return { ok: true as const };
  };

  test("전용 DB에 스냅샷이 있어도 결과물에 그 글이 없고, 전용 DB가 없을 때와 바이트가 같다", async () => {
    const s = setup();
    const site = () => {
      const c = { ...makeCtx(s.repo, s.environment, NOW), buildSite: builder };
      assert.equal(main(["site", "--run", s.runFile], c), 0, c.text());
      return hashTree(path.join(s.dataDir, "site"));
    };
    const without = site();
    await seedDemand(s);
    const withDemand = site();
    assert.deepEqual(withDemand, without);
    const out = path.join(s.dataDir, "site");
    for (const f of fs.readdirSync(out, { recursive: true }).map(String)) {
      const p = path.join(out, f);
      if (fs.statSync(p).isFile()) noFakeText(fs.readFileSync(p, "utf8"));
    }
  });

  test("결과물에 넣은 전용 DB와 사본은 결과물 검사에 걸린다", () => {
    const out = tempDir();
    writeFakePublicFiles(out);
    fs.writeFileSync(path.join(out, DEMAND_DB_FILE), "SQLite format 3\0");
    fs.mkdirSync(path.join(out, "x", DEMAND_COPY_DIR), { recursive: true });
    fs.writeFileSync(path.join(out, "x", DEMAND_COPY_DIR, "demand-20261104-060000.db"), "SQLite format 3\0");
    fs.writeFileSync(path.join(out, "x", DEMAND_COPY_DIR, "note.txt"), "사본 폴더의 다른 파일");
    const kinds = (where: string) => checkOutput(out, null).findings.filter((f) => f.where === where).map((f) => f.kind);
    assert.ok(kinds(DEMAND_DB_FILE).includes("수요 데이터 DB"));
    assert.ok(kinds(`x/${DEMAND_COPY_DIR}/demand-20261104-060000.db`).includes("수요 데이터 DB"));
    assert.ok(kinds(`x/${DEMAND_COPY_DIR}/note.txt`).includes("수요 데이터 DB"));
  });

  test("커밋에 넣은 전용 DB와 사본은 공개 전 점검에 걸린다", () => {
    const repo = tempRepo();
    for (const rel of [DEMAND_DB_FILE, `data/${DEMAND_COPY_DIR}/demand-20261104-060000-2.db`, "data/demand.db-journal"]) {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), "SQLite format 3\0");
      gitIn(repo, "add", "-f", rel);
    }
    gitIn(repo, "commit", "-q", "-m", "add demand db\n\nCo-Authored-By: Bot <noreply@anthropic.com>");
    const findings = precheck({ repo, commits: commitsOfRefs(repo, localBranches(repo)), trackedFiles: true, home: "/Users/fake-home" }).findings.filter((f) => f.kind === "수요 데이터 DB");
    for (const rel of [DEMAND_DB_FILE, `data/${DEMAND_COPY_DIR}/demand-20261104-060000-2.db`, "data/demand.db-journal"]) assert.ok(findings.some((f) => f.where.endsWith(rel)), rel);
  });
});

describe("4.4-3 백업에 나가지 않음", () => {
  test("전용 DB에 스냅샷이 있어도 백업 파일에 그 글이 없고 백업이 같다. 본 DB를 복원해도 전용 DB는 그대로다", async () => {
    const s = setup();
    const backup = () => {
      const c = makeCtx(s.repo, s.environment, NOW);
      assert.equal(main(["backup", "--run", s.runFile], c), 0, c.text());
      return hashTree(path.join(s.dataDir, "backup"));
    };
    const without = backup();
    await seedDemand(s);
    const withDemand = backup();
    assert.deepEqual(withDemand, without);
    for (const f of Object.keys(withDemand)) noFakeText(fs.readFileSync(path.join(s.dataDir, "backup", f), "utf8"));
    const demandFile = path.join(s.dataDir, DEMAND_DB_FILE);
    const demandBefore = fs.readFileSync(demandFile);
    const copiesBefore = hashTree(path.join(s.dataDir, DEMAND_COPY_DIR));
    const r = makeCtx(s.repo, s.environment, NOW);
    assert.equal(main(["restore", "--from", path.join(s.dataDir, "backup"), "--force"], r), 0, r.text());
    assert.ok(fs.readFileSync(demandFile).equals(demandBefore));
    assert.deepEqual(hashTree(path.join(s.dataDir, DEMAND_COPY_DIR)), copiesBefore);
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

  test("명령 이름이 실제 명령과 같고, 새 단계가 뉴스 후보 단계 뒤·백업 단계 앞에 있다", () => {
    assert.ok(SKILL.includes(`node src/cli.ts ${NAME} --run <실행 기록>`));
    assert.ok(rows[rowAt("14-1")]!.includes(NAME));
    assert.ok(rows[rowAt("8")]!.includes("feeds"));
    assert.ok(rowAt("8") < rowAt("14-1") && rowAt("14") < rowAt("14-1") && rowAt("14-1") < rowAt("15"));
    assert.ok(rows[rowAt("15")]!.includes("backup"));
    assert.ok(SKILL.indexOf("### 14-1단계: 수요 스냅샷") > SKILL.indexOf("### 14단계:") && SKILL.indexOf("### 14-1단계: 수요 스냅샷") < SKILL.indexOf("### 15단계:"));
  });

  test("앞 단계의 건너뛰기 문장이 새 단계를 가리키고, 새 단계는 시간 제한·다시 부르지 않음·실패 격리를 적었다", () => {
    assert.ok(chapter("### 14단계: 지난 날짜 이미지 채우기").includes("멈추지 않고 14-1단계로 넘어간다"));
    const step = chapter("### 14-1단계: 수요 스냅샷");
    assert.ok(step.includes("Bash 도구 시간 제한을 6분으로 준다(명령 전체 상한이 5분"));
    assert.ok(step.includes("백그라운드로 돌리지 않는다"));
    assert.ok(step.includes("다시 부르지 않고 14-1-1단계로 넘어간다"));
    assert.ok(step.includes("앞 단계가 실패해도 돈다"));
    assert.ok(step.includes("시험 모드(`/brief test`)에서는 돌지 않는다"));
  });

  test("0장 금지 줄: 전용 DB와 사본을 읽지 않고, 수요 소스를 직접 받거나 찾지 않는다", () => {
    const rules = chapter("### 실행 중에 하지 않는 것");
    assert.ok(rules.includes("수요 소스(Google Trends 급상승어, Mastodon 트렌드)와 공식 수요 소스(국회 청원, 권익위 민원, 1372 소비자상담, DART 공시, SEC Form D, Wikimedia 인기 문서)를 직접 받거나 웹에서 찾지 않는다. 소스는 `demand-fetch`와 `demand-official`만 받는다."));
    assert.ok(rules.includes("수요 데이터 전용 DB(`<데이터 폴더>/demand.db`)와 그 사본(`<데이터 폴더>/demand-copies/`)은 읽지 않는다."));
    assert.ok(SKILL.includes("  - 수요 스냅샷: 묶음별"));
  });
});

describe("4.5-1 판정 문서와 코드 목록", () => {
  const doc = fs.readFileSync(path.join(PROJECT_ROOT, DEMAND_DOC), "utf8");
  const block = (name: string) => {
    const m = new RegExp(`<!-- demand:${name} -->\\n([\\s\\S]*?)<!-- /demand:${name} -->`).exec(doc);
    assert.ok(m, name);
    return m[1]!;
  };

  test("Google 나라 코드와 Mastodon 인스턴스가 문서와 같은 순서로 같다", () => {
    assert.deepEqual([...block("google-geos").matchAll(/`([A-Z]{2})`/g)].map((m) => m[1]), [...GOOGLE_GEOS]);
    const instances = block("mastodon")
      .split("\n")
      .filter((l) => /^\| [a-z]/.test(l))
      .map((l) => l.split("|")[1]!.trim());
    assert.deepEqual(instances, [...MASTODON_INSTANCES]);
    assert.equal(demandSources().length, GOOGLE_GEOS.length + MASTODON_INSTANCES.length);
  });

  test("끈 소스와 묶음이 문서 표의 '끔'과 같다", () => {
    const offRows = block("off")
      .split("\n")
      .filter((l) => /^\| `/.test(l))
      .map((l) => /^\| `([^`]+)`/.exec(l)![1]!);
    assert.deepEqual(offRows.sort(), [...DEMAND_GROUPS_OFF, ...DEMAND_SOURCES_OFF].sort());
    const markedInstances = block("mastodon")
      .split("\n")
      .filter((l) => /^\| [a-z]/.test(l) && l.split("|")[2]!.includes("끔"))
      .map((l) => `mastodon:${l.split("|")[1]!.trim()}`);
    assert.deepEqual(markedInstances, DEMAND_SOURCES_OFF.filter((x) => x.startsWith("mastodon:")));
    for (const id of DEMAND_SOURCES_OFF) assert.ok(allDemandSourceIds().includes(id), `끈 소스 ${id}가 목록에 남아 있다`);
  });

  test("소스 목록 코드가 판정 문서를 가리킨다", () => {
    assert.ok(fs.readFileSync(path.join(PROJECT_ROOT, "src/demandSources.ts"), "utf8").includes(`"${DEMAND_DOC}"`));
  });
});

describe("4.5-3 README", () => {
  test("두 파일의 작동 방식에 수요 신호 줄이 같은 자리에 있다", () => {
    const ko = fs.readFileSync(path.join(PROJECT_ROOT, "README.md"), "utf8").split("\n");
    const en = fs.readFileSync(path.join(PROJECT_ROOT, "README.en.md"), "utf8").split("\n");
    const k = ko.findIndex((l) => l.startsWith("3. 수요 신호(Google Trends 급상승어, Mastodon 트렌드)") && l.includes("별도 로컬 DB") && l.includes("공개하지 않습니다"));
    const e = en.findIndex((l) => l.startsWith("3. Demand signals (Google Trends trending searches, Mastodon trends)") && l.includes("separate local database") && l.includes("none of it is published"));
    assert.ok(k > 0 && k === e, `${k} ${e}`);
  });
});
