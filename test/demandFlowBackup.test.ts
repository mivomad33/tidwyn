import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { buildBackup, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "../src/backup.ts";
import { main, mainAsync } from "../src/cli.ts";
import { MAJORS } from "../src/categories.ts";
import { openDb } from "../src/db.ts";
import { allFlowDates, allFlows, flowCorrections, flowsOfDate, hasFlowData, isFlowDateDone, recentFlows, saveFlows, type NewFlow } from "../src/demandFlowStore.ts";
import { FIELD_IDS, FLOW_WORK_NAMES } from "../src/demandFlowTypes.ts";
import { flowWorkFile } from "../src/demandFlowWork.ts";
import { DEMAND_DB_FILE, openDemandDb } from "../src/demandStore.ts";
import { BACKUP_NAME_RE, REPO_NOREPLY, nameKinds, precheck } from "../src/precheck.ts";
import { readRun } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { FAKE_ACCOUNT, FAKE_AUTHOR, FAKE_LINK_TITLE, FAKE_TAG, FAKE_TERM, NOW, fakeHttp, virtualTime } from "./demandFixtures.ts";
import { cleanupTemp, gitIn, makeCtx, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";
import { FAKE, KEYS, TEXTS as OFFICIAL_TEXTS, bodies, fakeOfficial } from "./officialFixtures.ts";

// 9.97단계 4.4-4(정정의 저장·백업·검사), 4.4-3(작업 파일 이름의 공개 전 점검), 4.5-1~3(공개 백업과 복원, 원문이 나가지 않음, 키와 경로)

after(cleanupTemp);

const DAY = "2026-11-03";
const PREV = "2026-11-01";
const HOME = "/Users/fake-home";
const FAKE_KEY = "FAKE-GEMINI-KEY-FLOW-0099";
/** 후보 복사본·흐름 파일에만 넣는 지어낸 글 */
const COPY_TEXT = "가짜후보복사본문장하나";
const FLOWFILE_TEXT = "가짜흐름파일문장하나";
/** 사이트·백업에 나가지 않아야 하는 받은 글(외부인 글, 급상승어·태그, 공식 원문) */
const RAW_TEXTS = [FAKE_TERM, FAKE_TAG, FAKE_LINK_TITLE, FAKE_AUTHOR, FAKE_ACCOUNT, ...OFFICIAL_TEXTS];

const unit = (over: Partial<NewFlow["units"][number]> = {}): NewFlow["units"][number] => ({
  group: "wikimedia",
  source: "wikimedia:ko",
  unitKey: "wikimedia:ko:가짜문서",
  unitName: "가짜 문서 이름",
  recent: 1200,
  base: 300.5,
  isNew: false,
  recentFrom: "2026-10-27",
  recentTo: DAY,
  baseFrom: "2026-09-29",
  baseTo: "2026-10-26",
  recentDays: 7,
  baseDays: 28,
  ...over,
});

const flow = (over: Partial<NewFlow> = {}): NewFlow => ({
  flowId: "",
  category: "interest",
  field: FIELD_IDS[0]!,
  title: "가짜 흐름 제목",
  summary: "가짜 흐름 요지다.",
  reason: "가짜 잇는 이유다.",
  level: "medium",
  aux: ["KR"],
  issue: null,
  continues: null,
  units: [unit(), unit({ group: "assembly", source: "assembly:received", unitKey: "assembly:received:가짜분류", unitName: null, recent: 4, base: 1, isNew: true })],
  ...over,
});

/** 이슈 하나, 앞 날짜 흐름 하나(관련 이슈), 대상 날짜 흐름 둘(하나는 앞 흐름을 잇는다), 기준 부족 날짜, 정정 하나 */
function seedFlows(db: ReturnType<typeof openDb>): void {
  db.prepare("INSERT INTO issues (id, name, aliases, major, minor, is_new_minor, status, summary) VALUES (1, '가짜 이슈', '[]', ?, '가짜', 1, '진행 중', '가짜 요약')").run(MAJORS[0]!);
  saveFlows(db, PREV, [flow({ issue: 1 })], { date: PREV, status: "checked", missing: ["sec"] });
  const prev = flowsOfDate(db, PREV)[0]!;
  saveFlows(db, DAY, [flow({ flowId: prev.flowId, continues: prev.id, level: "strong" }), flow({ category: "money", field: FIELD_IDS[1]!, units: [unit({ group: "dart", source: "dart:list", unitKey: "dart:list:가짜업종", unitName: "가짜 업종" })] })], { date: DAY, status: "checked", missing: [] });
  saveFlows(db, "2026-11-02", [], { date: "2026-11-02", status: "short", missing: [] });
  db.prepare("INSERT INTO demand_flow_corrections (item_id, corrected_on, reason, fields) VALUES (?, '2026-11-04', '제목을 바로잡았다.', '[\"title\"]')").run(prev.id);
}

function restoredFrom(files: Map<string, string>) {
  const file = path.join(tempDir(), "r.db");
  restoreBackup(files, file);
  return openDb(file);
}

describe("4.5-1 백업과 복원", () => {
  test("흐름 데이터가 demand.json에 들어가고, 백업 → 빈 DB 복원 → 다시 백업의 내용이 같다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    seedFlows(db);
    const files = buildBackup(db);
    assert.ok(files.has("demand.json"));
    assert.ok(BACKUP_NAME_RE.test("demand.json"));
    const f = JSON.parse(files.get("demand.json")!) as { formatVersion: number; flows: unknown[]; flowDates: unknown[]; flowCorrections: unknown[] };
    assert.equal(f.formatVersion, 10);
    assert.equal(JSON.parse(files.get("meta.json")!).formatVersion, 10);
    assert.equal(f.flows.length, 3);
    assert.equal(f.flowDates.length, 3);
    assert.equal(f.flowCorrections.length, 1);
    const back = restoredFrom(files);
    const again = buildBackup(back);
    assert.deepEqual([...again.keys()].sort(), [...files.keys()].sort());
    for (const [name, text] of files) assert.equal(again.get(name), text, name);
    for (const t of ["demand_flows", "demand_flow_units", "demand_flow_dates", "demand_flow_corrections"]) {
      assert.deepEqual(back.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(), db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(), t);
    }
  });

  test("복원 뒤 같은 흐름 판정의 입력, 날짜 상태의 끝남, 정정 기록이 복원 전과 같다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    seedFlows(db);
    const back = restoredFrom(buildBackup(db));
    for (const target of ["2026-11-04", "2026-11-14", "2026-11-16"]) assert.deepEqual(recentFlows(back, target), recentFlows(db, target), target);
    assert.equal(recentFlows(back, "2026-11-04").length, 3);
    assert.deepEqual(allFlows(back), allFlows(db));
    assert.deepEqual(allFlowDates(back), allFlowDates(db));
    for (const d of [PREV, "2026-11-02", DAY, "2026-11-04"]) assert.equal(isFlowDateDone(back, d), isFlowDateDone(db, d), d);
    const prev = flowsOfDate(back, PREV)[0]!;
    assert.deepEqual(flowCorrections(back, prev.id), flowCorrections(db, prev.id));
    assert.equal(flowsOfDate(back, DAY)[0]!.continues, prev.id);
    assert.equal(prev.issue, 1);
  });

  test("흐름 데이터가 없으면 demand.json을 쓰지 않고, demand.json이 없는 옛 형식(8) 백업이 복원된다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    const files = buildBackup(db);
    assert.equal(files.has("demand.json"), false);
    const old = new Map([...files].map(([k, v]) => [k, v.replace('"formatVersion": 10', '"formatVersion": 8')]));
    assert.ok(old.get("meta.json")!.includes('"formatVersion": 8'));
    const back = restoredFrom(old);
    assert.equal(hasFlowData(back), false);
    assert.equal(back.prepare("SELECT count(*) AS n FROM stories").get()!.n, db.prepare("SELECT count(*) AS n FROM stories").get()!.n);
  });

  test("날짜 상태만 있는 백업(0건 확인함)도 demand.json에 들어가고 복원된다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    saveFlows(db, DAY, [], { date: DAY, status: "checked", missing: [] });
    const files = buildBackup(db);
    assert.ok(files.has("demand.json"));
    assert.equal(isFlowDateDone(restoredFrom(files), DAY), true);
  });

  test("폴더로 내보낸 백업과 data 브랜치에서도 demand.json을 읽는다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    seedFlows(db);
    const dir = tempDir();
    const files = exportBackup(db, dir);
    assert.ok(fs.existsSync(path.join(dir, "demand.json")));
    assert.equal(allFlows(restoredFrom(readBackupDir(dir))).length, 3);
    const repo = tempRepo();
    commitBackup(files, repo, "Backup briefs", path.join(tempDir(), "idx"));
    assert.equal(allFlows(restoredFrom(readBackupRef(repo))).length, 3);
  });
});

/** 9.95·9.96 받기로 전용 DB에 지어낸 글을 쌓은 실행 */
async function setupRun() {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, DAY);
  addBrief(db, DAY);
  db.close();
  const environment: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME, GEMINI_API_KEY: FAKE_KEY };
  const ctx = makeCtx(repo, environment, NOW);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
  const run = readRun(runFile);
  const vt = virtualTime();
  const d = { ...makeCtx(repo, environment, NOW), demandHttp: fakeHttp(vt.clock).http, demandClock: vt.clock, demandSleep: vt.sleep, demandTimer: vt.timer };
  assert.equal(await mainAsync(["demand-fetch", "--run", runFile], d), 0);
  const ovt = virtualTime();
  const o = { ...makeCtx(repo, { ...environment, ...KEYS }, NOW), officialHttp: fakeOfficial(ovt.clock).http, demandClock: ovt.clock, demandSleep: ovt.sleep, demandTimer: ovt.timer };
  assert.equal(await mainAsync(["demand-official", "--run", runFile], o), 0, o.text());
  const ddb = openDemandDb(path.join(run.dataDir, DEMAND_DB_FILE));
  const raw = bodies(ddb).join("") + (ddb.prepare("SELECT body FROM demand_parts").all() as { body: Uint8Array }[]).map((r) => Buffer.from(r.body).toString()).join("");
  ddb.close();
  for (const t of [FAKE_TERM, FAKE_TAG, FAKE.title, FAKE.keyword]) assert.ok(raw.includes(t), `지어낸 글 "${t}"가 전용 DB에 있다`);
  return { repo, environment, runFile, dataDir: run.dataDir, dbFile: run.dbPath };
}

describe("4.5-2 원문이 나가지 않음, 4.5-3 키와 경로", () => {
  test("전용 DB 원문, 후보 복사본·흐름 파일의 글, 외부인 글, 급상승어·태그, 키 값, 홈 경로가 백업 파일에 없다", async () => {
    const s = await setupRun();
    // 흐름이 외부인 글 소스(청원, 질의응답)와 보조 근거를 근거로 쓴 경우
    const db = openDb(s.dbFile);
    saveFlows(db, DAY, [flow({ units: [unit({ group: "assembly", source: "assembly:received", unitKey: "assembly:received:x", unitName: null }), unit({ group: "acrc", source: "acrc:qna", unitKey: "acrc:qna:y", unitName: null })], aux: ["KR", "mastodon.social"] })], { date: DAY, status: "checked", missing: [] });
    db.close();
    fs.mkdirSync(path.dirname(flowWorkFile(s.dataDir, "candidates")), { recursive: true });
    fs.writeFileSync(flowWorkFile(s.dataDir, "candidates"), JSON.stringify({ text: COPY_TEXT, raw: RAW_TEXTS }));
    fs.writeFileSync(flowWorkFile(s.dataDir, "list"), `${COPY_TEXT}\n${RAW_TEXTS.join("\n")}\n`);
    fs.writeFileSync(flowWorkFile(s.dataDir, "flows"), JSON.stringify({ text: FLOWFILE_TEXT }));
    const c = makeCtx(s.repo, s.environment, NOW);
    assert.equal(main(["backup", "--run", s.runFile], c), 0, c.text());
    const dir = path.join(s.dataDir, "backup");
    const names = fs.readdirSync(dir).sort();
    assert.ok(names.includes("demand.json"), names.join(","));
    for (const n of names) assert.ok(!n.startsWith("demand.flow") && n !== DEMAND_DB_FILE, n);
    for (const n of names) {
      const text = fs.readFileSync(path.join(dir, n), "utf8");
      for (const t of [COPY_TEXT, FLOWFILE_TEXT, ...RAW_TEXTS, FAKE_KEY, ...Object.values(KEYS), HOME]) assert.ok(!text.includes(t), `${n}에 "${t}"가 있다`);
    }
    for (const t of [COPY_TEXT, FLOWFILE_TEXT, FAKE_KEY, HOME]) assert.ok(!c.text().includes(t), t);
  });
});

describe("4.4-4 정정", () => {
  function setup() {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    addBrief(db, DAY);
    seedFlows(db);
    return { repo, db, env: { TIDWYN_DATA_DIR: dataDir, HOME, GEMINI_API_KEY: FAKE_KEY } as NodeJS.ProcessEnv };
  }

  function correct(s: ReturnType<typeof setup>, input: unknown): { code: number; text: string } {
    const file = path.join(tempDir(), "fix.json");
    fs.writeFileSync(file, JSON.stringify(input));
    const ctx = makeCtx(s.repo, s.env, NOW);
    return { code: main(["correct", "--file", file], ctx), text: ctx.text() };
  }

  const ok = (over: Record<string, unknown> = {}) => ({ date: DAY, key: "demand-2", reason: "제목을 바로잡았다.", fields: { title: "고친 흐름 제목", reason: "고친 잇는 이유다." }, ...over });

  test("글 칸을 고치고 날짜와 사유를 남기며, 다시 하면 무변경이고 정정 기록이 백업에 있다", () => {
    const s = setup();
    const before = flowsOfDate(s.db, DAY)[1]!;
    const r = correct(s, ok());
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /고침: 2026-11-03 demand-2 \(title, reason\)/);
    assert.ok(!r.text.includes("고친 흐름 제목"), "출력에 글을 내지 않는다");
    const after = flowsOfDate(s.db, DAY)[1]!;
    assert.equal(after.title, "고친 흐름 제목");
    assert.equal(after.reason, "고친 잇는 이유다.");
    assert.equal(after.summary, before.summary);
    assert.deepEqual({ ...after, title: before.title, reason: before.reason }, before, "글 칸 밖은 그대로다");
    assert.deepEqual(flowCorrections(s.db, after.id), [{ on: "2026-11-04", reason: "제목을 바로잡았다.", fields: ["title", "reason"] }]);
    const again = correct(s, ok());
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /바뀐 것이 없다/);
    assert.equal(flowCorrections(s.db, after.id).length, 1);
    const backup = JSON.parse(buildBackup(s.db).get("demand.json")!) as { flowCorrections: { item: number; fields: string[] }[]; flows: { id: number; title: string }[] };
    assert.ok(backup.flowCorrections.some((c) => c.item === after.id && c.fields.join() === "title,reason"));
    assert.equal(backup.flows.find((f) => f.id === after.id)!.title, "고친 흐름 제목");
  });

  test("갈래·분야·숫자·근거 수준·근거 단위·출처·보조 근거는 고칠 수 없다", () => {
    const s = setup();
    const before = allFlows(s.db);
    for (const name of ["category", "field", "level", "units", "unitName", "recent", "base", "source", "sources", "aux", "issue", "continues", "flowId"]) {
      const r = correct(s, ok({ fields: { [name]: "x" } }));
      assert.equal(r.code, 1, `${name}: ${r.text}`);
      assert.match(r.text, /고칠 수 없다/, name);
    }
    assert.deepEqual(allFlows(s.db), before);
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM demand_flow_corrections").get()!.n, 1);
  });

  test("글 검사(수, 단정·과장어, 주소, 메일, @계정, 키 값, 홈 경로, 길이)에 걸리는 정정을 거부하고 출력에 그 글을 내지 않는다", () => {
    const s = setup();
    const before = allFlows(s.db);
    const bad: [Record<string, string>, RegExp][] = [
      [{ title: "가짜정정글자일 3배" }, /수를 쓰지 않는다/],
      [{ summary: "가짜정정글자이 세 배 늘었다." }, /수를 쓰지 않는다/],
      [{ reason: "가짜정정글자삼 급증했다." }, /단정·과장어/],
      [{ title: "가짜정정글자사 https://x.test/a" }, /주소/],
      [{ title: "가짜정정글자오 fake@example.com" }, /메일/],
      [{ title: "가짜정정글자육 @someone" }, /@계정/],
      [{ title: `가짜정정글자칠 ${FAKE_KEY}` }, /키 값/],
      [{ title: `가짜정정글자팔 ${HOME}/x` }, /홈/],
      [{ title: "가".repeat(61) }, /자다/],
      [{ title: "" }, /비어|없다/],
    ];
    for (const [fields, re] of bad) {
      const r = correct(s, ok({ fields }));
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, re, JSON.stringify(fields));
      assert.ok(!r.text.includes("가짜정정글자"), `출력에 정정 글이 나왔다: ${r.text}`);
      assert.ok(!r.text.includes(FAKE_KEY) && !r.text.includes(HOME), "출력에 키 값·홈 경로가 없다");
    }
    assert.deepEqual(allFlows(s.db), before);
  });

  test("없는 항목, 사유 위반, 빈 고칠 항목을 거부한다", () => {
    const s = setup();
    const cases: [unknown, RegExp][] = [
      [ok({ key: "demand-9" }), /항목이 없다/],
      [ok({ date: "2026-11-02", key: "demand-1" }), /항목이 없다/],
      [ok({ reason: "자세한 것은 https://x.test 참고" }), /주소/],
      [ok({ reason: "가".repeat(121) }), /121자/],
      [ok({ fields: {} }), /하나 이상/],
    ];
    for (const [input, re] of cases) {
      const r = correct(s, input);
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, re);
    }
    assert.equal(s.db.prepare("SELECT count(*) AS n FROM demand_flow_corrections").get()!.n, 1);
  });
});

describe("4.4-3 작업 파일 이름", () => {
  test("후보 복사본·흐름 파일 이름이 결과물 검사에 걸리고 demand.json은 백업 파일 이름으로 걸린다", () => {
    const out = tempDir();
    writeFakePublicFiles(out);
    for (const n of Object.values(FLOW_WORK_NAMES)) fs.writeFileSync(path.join(out, n), "{}");
    fs.mkdirSync(path.join(out, "x"));
    fs.writeFileSync(path.join(out, "x", FLOW_WORK_NAMES.candidates), "{}");
    fs.writeFileSync(path.join(out, "demand.json"), "{}");
    const f = checkOutput(out, null).findings;
    const of = (name: string) => f.filter((x) => x.where === name).map((x) => x.kind);
    for (const n of [...Object.values(FLOW_WORK_NAMES), `x/${FLOW_WORK_NAMES.candidates}`]) assert.ok(of(n).includes("수요 흐름 작업 파일"), n);
    assert.deepEqual(of("demand.json"), ["백업 파일 이름"]);
  });

  test("공개 전 점검이 커밋된 후보 복사본·흐름 파일을 거부하고 data 브랜치의 demand.json은 통과시킨다", () => {
    for (const n of Object.values(FLOW_WORK_NAMES)) assert.deepEqual(nameKinds(`data/work/${n}`), ["수요 흐름 작업 파일"], n);
    assert.deepEqual(nameKinds("demand.flow.items.json.bak"), []);
    const repo = tempRepo();
    gitIn(repo, "config", "user.email", REPO_NOREPLY);
    fs.writeFileSync(path.join(repo, "demand.json"), '{"formatVersion":9}\n');
    gitIn(repo, "add", "demand.json");
    gitIn(repo, "commit", "-q", "-m", "data");
    const clean = precheck({ repo, commits: [], trackedFiles: true, home: null }).findings;
    assert.ok(!clean.some((x) => x.where.includes("demand.json")), JSON.stringify(clean));
    fs.mkdirSync(path.join(repo, "work"));
    for (const n of Object.values(FLOW_WORK_NAMES)) fs.writeFileSync(path.join(repo, "work", n), "{}");
    gitIn(repo, "add", "-f", ".");
    gitIn(repo, "commit", "-q", "-m", "oops");
    const bad = precheck({ repo, commits: [], trackedFiles: true, home: null }).findings.filter((x) => x.kind === "수요 흐름 작업 파일");
    for (const n of Object.values(FLOW_WORK_NAMES)) assert.ok(bad.some((x) => x.where.endsWith(n)), n);
  });
});
