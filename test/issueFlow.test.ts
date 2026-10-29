import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, exportBackup, readBackupDir, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import {
  FIRST_LINKED_KEY,
  addNoMergePair,
  addRelation,
  createIssue,
  getIssue,
  linkStory,
  linkableDates,
  setMeta,
  storiesOfDate,
  unlinkedCount,
  unlinkedStories,
} from "../src/issues.ts";
import { applyMerges, listMerges, unmerge } from "../src/merge.ts";
import { linkWorkFile, mergeWorkFile, readRun, workFile, writeRun } from "../src/run.ts";
import { loadBrief, recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const DAY1 = new Date("2026-10-27T09:00:00+09:00");
const DAY3 = new Date("2026-10-29T09:00:00+09:00");

function run(repo: string, argv: string[], env: NodeJS.ProcessEnv, now = NOW): { code: number; text: string } {
  const ctx = makeCtx(repo, env, now);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

function start(repo: string, env: NodeJS.ProcessEnv, now: Date): { runFile: string; text: string } {
  const r = run(repo, ["start"], env, now);
  assert.equal(r.code, 0, r.text);
  const m = /실행 기록: (.+)/.exec(r.text);
  assert.ok(m);
  return { runFile: m[1]!, text: r.text };
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

function saveDate(repo: string, env: NodeJS.ProcessEnv, runFile: string, date: string, now: Date): void {
  writeJson(workFile(readRun(runFile).dataDir, date), sampleBrief(date));
  const r = run(repo, ["save", "--run", runFile, "--date", date], env, now);
  assert.equal(r.code, 0, r.text);
}

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

const KEYS = storyKeysOfSample();

function storyKeysOfSample(): string[] {
  const keys: string[] = [];
  for (const sec of sampleBrief().sections) {
    for (const t of sec.topStories) keys.push(`${sec.name}-${t.rank}`);
    sec.shortNews.forEach((_, i) => keys.push(`${sec.name}-s${i + 1}`));
  }
  return keys;
}

const SUMMARY = "가짜 항구에서 파업이 이어진다.\n노사 협상이 다음 주에 다시 열린다.";

describe("2단계 4.2-5·4.4-4 연결 실패와 실행 요약", () => {
  test("연결 실패는 기록되고 요약에 위반이 나오며, 그 날짜는 다음 실행의 연결 대상이다. 연결·합치기 결과와 이슈 목록 경로가 요약에 나온다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };

    // 1회차: 10-26 저장과 연결(새 이슈 3개)
    const r1 = start(repo, env, DAY1);
    saveDate(repo, env, r1.runFile, "2026-10-26", DAY1);
    const issues = run(repo, ["issues", "--run", r1.runFile, "--date", "2026-10-26"], env, DAY1);
    assert.equal(issues.code, 0, issues.text);
    assert.match(issues.text, /연결할 뉴스 18건/);
    writeJson(linkWorkFile(dataDir, "2026-10-26", "links.json"), {
      date: "2026-10-26",
      newIssues: [
        { key: "a", name: "가짜 항구 파업", aliases: [], category: { major: "경제", minor: "노동·일자리" }, summary: SUMMARY },
        { key: "b", name: "가짜 항구 파업 장기화", aliases: [], category: { major: "경제", minor: "노동·일자리" }, summary: SUMMARY },
        { key: "c", name: "이런저런 가짜 소식", aliases: [], category: { major: "사회", minor: "교육" }, summary: "여러 가짜 소식을 모았다." },
      ],
      links: KEYS.map((k) => ({ story: k, primary: k === "한국-1" ? "a" : k === "한국-2" ? "b" : "c" })),
    });
    const a1 = run(repo, ["link-apply", "--run", r1.runFile, "--date", "2026-10-26"], env, DAY1);
    assert.equal(a1.code, 0, a1.text);
    const s1 = run(repo, ["summary", "--run", r1.runFile], env, DAY1).text;
    assert.match(s1, /- 이슈 연결:\n\s+- 2026-10-26: 뉴스 18건 연결\(기존 이슈에 0건, 새 이슈 3개\)/);
    assert.match(s1, /아직 이슈가 없는 뉴스: 없음/);
    assert.match(s1, /합치기: 실행하지 않았다/);
    assert.match(s1, new RegExp(`이슈 목록: ${path.join(dataDir, "issues", "index.md").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

    // 2회차: 10-27 저장, 틀린 연결 파일 → 실패
    const r2 = start(repo, env, NOW);
    assert.deepEqual(readRun(r2.runFile).linkDates, []);
    saveDate(repo, env, r2.runFile, "2026-10-27", NOW);
    writeJson(linkWorkFile(dataDir, "2026-10-27", "links.json"), { date: "2026-10-27", newIssues: [], links: [] });
    const bad = run(repo, ["link-apply", "--run", r2.runFile, "--date", "2026-10-27"], env, NOW);
    assert.equal(bad.code, 1, bad.text);
    const rec = readRun(r2.runFile).links?.["2026-10-27"];
    assert.equal(rec?.status, "failed");
    // 합치기 실패
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [{ survivor: 999, absorbed: 2, reason: "같은 파업", summary: SUMMARY }] });
    assert.equal(run(repo, ["merge-apply", "--run", r2.runFile], env, NOW).code, 1);
    let s2 = run(repo, ["summary", "--run", r2.runFile], env, NOW).text;
    assert.match(s2, /2026-10-27: 연결 실패\(뉴스는 저장됨, 다음 실행이 다시 연결한다\)/);
    assert.match(s2, /- links: 연결할 뉴스 한국-1가 빠졌다/);
    assert.match(s2, /아직 이슈가 없는 뉴스: 18건/);
    assert.match(s2, /합치기 실패\(점검일을 바꾸지 않았다, 다음 실행이 다시 한다\)/);
    assert.match(s2, /- merges 1 survivor: 이슈 999이\(가\) 없다/);
    // 합치기 성공
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [{ survivor: 1, absorbed: 2, reason: "같은 파업 이야기다", summary: SUMMARY }] });
    const mg = run(repo, ["merge-apply", "--run", r2.runFile], env, NOW);
    assert.equal(mg.code, 0, mg.text);
    s2 = run(repo, ["summary", "--run", r2.runFile], env, NOW).text;
    assert.match(s2, /합치기: 1쌍을 합쳤다\n\s+- 이슈 2\(가짜 항구 파업 장기화\) → 이슈 1\(가짜 항구 파업\)\. 이유: 같은 파업 이야기다\. 되돌리기: node src\/cli\.ts unmerge --id 1/);

    const db = openDb(path.join(dataDir, "tidwyn.db"));
    assert.ok(loadBrief(db, "2026-10-27") !== null);
    assert.equal(unlinkedStories(db, "2026-10-27").length, 18);
    db.close();

    // 3회차: 10-27이 연결 대상으로 다시 나오고, 기존 이슈에 붙인다
    const r3 = start(repo, env, DAY3);
    assert.deepEqual(readRun(r3.runFile).linkDates, ["2026-10-27"]);
    assert.match(r3.text, /이슈를 연결할 저장된 날짜\(소급·재시도\): 2026-10-27/);
    writeJson(linkWorkFile(dataDir, "2026-10-27", "links.json"), {
      date: "2026-10-27",
      newIssues: [],
      links: KEYS.map((k) => ({ story: k, primary: 1 })),
      summaries: [{ issue: 1, summary: SUMMARY }],
    });
    assert.equal(run(repo, ["link-apply", "--run", r3.runFile, "--date", "2026-10-27"], env, DAY3).code, 0);
    writeJson(mergeWorkFile(dataDir, "json"), { merges: [] });
    assert.equal(run(repo, ["merge-apply", "--run", r3.runFile], env, DAY3).code, 0);
    const s3 = run(repo, ["summary", "--run", r3.runFile], env, DAY3).text;
    assert.match(s3, /2026-10-27: 뉴스 18건 연결\(기존 이슈에 18건, 새 이슈 0개\)/);
    assert.match(s3, /합치기: 점검했고 합친 것이 없다/);
    assert.match(s3, /아직 이슈가 없는 뉴스: 없음/);

    // 1·1.5단계 형식 실행 기록에는 이슈 줄을 붙이지 않는다
    const old = readRun(r1.runFile);
    delete old.linkDates;
    delete old.links;
    delete old.merge;
    writeRun(r1.runFile, old);
    const s0 = run(repo, ["summary", "--run", r1.runFile], env, DAY1).text;
    assert.doesNotMatch(s0, /이슈 연결|아직 이슈가 없는 뉴스|합치기|이슈 목록/);
  });
});

/** 이슈·연결·관계·합치기(되돌린 것 포함)·합치지 않음 쌍이 있는 DB */
function dbWithIssues(): { db: DatabaseSync; dir: string } {
  const dir = tempDir();
  const db = openDb(path.join(dir, "tidwyn.db"));
  recordFirstCollectionDate(db, "2026-10-26");
  addBrief(db, "2026-10-26");
  addBrief(db, "2026-10-27");
  const cat = { major: "경제" as const, minor: "노동·일자리" };
  const ids = ["가짜 항구 파업", "가짜 항구 파업 장기화", "가짜 소식 모음", "가짜 철도 파업"].map((name) => createIssue(db, { name, aliases: [`${name} 별칭`], category: cat, summary: SUMMARY }));
  const [i1, i2, i3, i4] = ids as [number, number, number, number];
  for (const s of storiesOfDate(db, "2026-10-26")) {
    if (s.key === "한국-1") linkStory(db, s.id, i1, true);
    else if (s.key === "한국-2") {
      linkStory(db, s.id, i2, true);
      linkStory(db, s.id, i1, false);
    } else linkStory(db, s.id, i3, true);
  }
  for (const s of storiesOfDate(db, "2026-10-27")) linkStory(db, s.id, i4, true);
  addRelation(db, i1, i3);
  addRelation(db, i4, i2);
  setMeta(db, FIRST_LINKED_KEY, "2026-10-27");
  const [m1] = applyMerges(db, [{ survivor: i1, absorbed: i2, reason: "같은 파업", summary: SUMMARY }], "2026-10-28");
  assert.equal(unmerge(db, m1!, "2026-10-29").ok, true);
  applyMerges(db, [{ survivor: i3, absorbed: i4, reason: "같은 묶음", summary: SUMMARY }], "2026-10-30");
  addNoMergePair(db, i1, i4);
  return { db, dir };
}

describe("2단계 4.5-1 백업에 이슈 데이터", () => {
  test("이슈 데이터가 있는 DB를 백업하고 빈 곳에 복원하면 같은 데이터가 나오고, 두 번 백업하면 내용이 같다", () => {
    const { db, dir } = dbWithIssues();
    const out = path.join(dir, "backup");
    const files = exportBackup(db, out);
    const first = Object.fromEntries(readBackupDir(out));
    exportBackup(db, out);
    assert.deepEqual(Object.fromEntries(readBackupDir(out)), first);
    assert.ok(files.has("issues.json"));
    const meta = JSON.parse(first["meta.json"]!);
    assert.equal(meta.firstLinkedOn, "2026-10-27");
    assert.equal(meta.mergeCheckedOn, "2026-10-30");
    db.close();

    const restored = path.join(tempDir(), "restored.db");
    assert.deepEqual(restoreBackup(readBackupDir(out), restored), { dates: 2 });
    const db2 = openDb(restored);
    assert.deepEqual(Object.fromEntries(buildBackup(db2)), first);
    const merges = listMerges(db2);
    assert.equal(merges.length, 2);
    assert.equal(merges[0]!.undoneOn, "2026-10-29");
    assert.equal(getIssue(db2, 4)?.mergedInto, 3);
    assert.equal(unlinkedCount(db2), 0);
    db2.close();
  });
  test("이슈 데이터가 없는 DB의 백업은 meta.json과 월별 파일만 내고, meta 키는 형식 버전과 첫 수집일뿐이다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "tidwyn.db"));
    recordFirstCollectionDate(db, "2026-09-30");
    addBrief(db, "2026-09-30");
    addBrief(db, "2026-10-01");
    const files = buildBackup(db);
    db.close();
    assert.deepEqual([...files.keys()].sort(), ["2026-09.json", "2026-10.json", "meta.json"]);
    assert.deepEqual(Object.keys(JSON.parse(files.get("meta.json")!)).sort(), ["firstCollectionDate", "formatVersion"]);
  });
});

describe("2단계 4.5-2 이전 형식 백업", () => {
  test("형식 버전 1 백업이 복원되고 모든 뉴스가 이슈 없음이다", () => {
    const r = validateBrief(sampleBrief(), "2026-10-27");
    assert.ok(r.ok);
    const files = new Map([
      ["meta.json", JSON.stringify({ formatVersion: 1, firstCollectionDate: "2026-10-27" })],
      ["2026-10.json", JSON.stringify({ formatVersion: 1, month: "2026-10", briefs: [{ brief: r.brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false }] })],
    ]);
    const restored = path.join(tempDir(), "restored.db");
    assert.deepEqual(restoreBackup(files, restored), { dates: 1 });
    const db = openDb(restored);
    assert.deepEqual(linkableDates(db), ["2026-10-27"]);
    assert.equal(unlinkedCount(db), KEYS.length);
    assert.equal(unlinkedStories(db, "2026-10-27").length, KEYS.length);
    db.close();
  });
});

describe("2단계 4.5-3 복원 뒤 마크다운", () => {
  test("복원한 데이터 폴더에서 render --all을 하면 이슈 마크다운과 목록이 생긴다", () => {
    const { db, dir } = dbWithIssues();
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    db.close();
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r = run(repo, ["restore", "--from", out], env);
    assert.equal(r.code, 0, r.text);
    assert.equal(fs.existsSync(path.join(dataDir, "issues")), false);
    const rr = run(repo, ["render", "--all"], env);
    assert.equal(rr.code, 0, rr.text);
    assert.ok(fs.existsSync(path.join(dataDir, "issues", "index.md")));
    for (const id of [1, 2, 3, 4]) assert.ok(fs.existsSync(path.join(dataDir, "issues", `${id}.md`)), `${id}.md`);
    assert.ok(fs.existsSync(path.join(dataDir, "briefs", "2026-10-27.md")));
    assert.match(fs.readFileSync(path.join(dataDir, "briefs", "2026-10-27.md"), "utf8"), /이어지는 이야기/);
  });
});

/** 버전 2 스키마의 DB에 브리프 하나 */
function v2Db(file: string): void {
  const db = openDb(file, MIGRATIONS.filter((m) => m.version <= 2));
  assert.equal(schemaVersion(db), 2);
  recordFirstCollectionDate(db, "2026-10-26");
  addBrief(db, "2026-10-26");
  db.close();
}

describe("2단계 4.1-3 마이그레이션", () => {
  test("버전 2 DB를 새 코드로 열면 버전 5가 되고, 브리프가 그대로이며 모든 뉴스가 이슈 없음이다", () => {
    const file = path.join(tempDir(), "t.db");
    v2Db(file);
    const r = validateBrief(sampleBrief("2026-10-26"), "2026-10-26");
    assert.ok(r.ok);
    const db = openDb(file);
    assert.equal(schemaVersion(db), 5);
    assert.deepEqual(loadBrief(db, "2026-10-26")?.brief, r.brief);
    assert.deepEqual(linkableDates(db), ["2026-10-26"]);
    assert.equal(unlinkedCount(db), KEYS.length);
    db.close();
  });
});

describe("2단계 4.8-4 머지 뒤 첫 실행의 실행 전 사본", () => {
  test("버전 2 DB가 있는 데이터 폴더에서 start를 하면 실행 전 사본은 버전 2, DB는 새 버전이다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    v2Db(path.join(dataDir, "tidwyn.db"));
    const r = start(repo, { TIDWYN_DATA_DIR: dataDir }, NOW);
    assert.match(r.text, /이슈를 연결할 저장된 날짜\(소급·재시도\): 2026-10-26/);
    const snaps = fs.readdirSync(path.join(dataDir, "snapshots")).filter((n) => n.endsWith(".db"));
    assert.equal(snaps.length, 1);
    const version = (file: string) => {
      const db = new DatabaseSync(file);
      const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
      db.close();
      return v;
    };
    assert.equal(version(path.join(dataDir, "snapshots", snaps[0]!)), 2);
    assert.equal(version(path.join(dataDir, "tidwyn.db")), 5);
  });
});

/** 모든 테이블의 모든 행 */
function dumpDb(file: string): Record<string, unknown[]> {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
    return Object.fromEntries(tables.map((t) => [t.name, db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all()]));
  } finally {
    db.close();
  }
}

describe("2단계 4.2-4 연결 적용 명령의 원자성과 반복 실행", () => {
  const links = (date: string) => ({
    date,
    newIssues: [
      { key: "a", name: "가짜 항구 파업", aliases: [], category: { major: "경제", minor: "노동·일자리" }, summary: SUMMARY },
      { key: "c", name: "이런저런 가짜 소식", aliases: [], category: { major: "사회", minor: "교육" }, summary: "여러 가짜 소식을 모았다." },
    ],
    links: KEYS.map((k) => ({ story: k, primary: k === "한국-1" ? "a" : "c" })),
  });

  test("새 이슈가 든 틀린 연결 파일은 DB를 하나도 바꾸지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r = start(repo, env, DAY1);
    saveDate(repo, env, r.runFile, "2026-10-26", DAY1);
    const dbFile = path.join(dataDir, "tidwyn.db");
    const before = dumpDb(dbFile);
    const bad = links("2026-10-26");
    bad.links = bad.links.slice(1);
    writeJson(linkWorkFile(dataDir, "2026-10-26", "links.json"), bad);
    const out = run(repo, ["link-apply", "--run", r.runFile, "--date", "2026-10-26"], env, DAY1);
    assert.equal(out.code, 1, out.text);
    assert.deepEqual(dumpDb(dbFile), before);
  });

  test("같은 연결 파일로 두 번 적용하면 두 번째는 DB를 바꾸지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const r = start(repo, env, DAY1);
    saveDate(repo, env, r.runFile, "2026-10-26", DAY1);
    writeJson(linkWorkFile(dataDir, "2026-10-26", "links.json"), links("2026-10-26"));
    const first = run(repo, ["link-apply", "--run", r.runFile, "--date", "2026-10-26"], env, DAY1);
    assert.equal(first.code, 0, first.text);
    const dbFile = path.join(dataDir, "tidwyn.db");
    const after1 = dumpDb(dbFile);
    const second = run(repo, ["link-apply", "--run", r.runFile, "--date", "2026-10-26"], env, DAY1);
    assert.deepEqual(dumpDb(dbFile), after1, second.text);
  });
});
