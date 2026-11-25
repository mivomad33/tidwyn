import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { storiesOfDate } from "../src/issues.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

// R1(기능 줄이기) 4.2-1 DB 업그레이드, 4.2-2 백업, 4.2-3 옛 백업 복원. 임시 폴더와 임시 git 저장소만 쓴다. 값은 모두 가짜다.
// 업그레이드 전 DB는 지금 코드의 마이그레이션 1~14(지운 기능의 표를 만든 그대로)로 만든다.

after(cleanupTemp);

const DATE = "2026-10-27";
const RETIRED_PREFIXES = ["builder_", "repo_snapshot", "demand_flow", "video"];
const isRetired = (name: string) => RETIRED_PREFIXES.some((p) => name.startsWith(p));
/** T11이 행을 바꿀 수 있는 표. 나머지 남는 표의 행은 그대로여야 한다 */
const SCHEDULE_TABLES = ["schedules", "schedule_merges", "schedule_no_merge"];

function tables(db: DatabaseSync): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
}

/** 표마다 행(정렬한 JSON). 업그레이드 전후를 견준다 */
function dump(db: DatabaseSync): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tables(db)) out.set(t, (db.prepare(`SELECT * FROM "${t}"`).all() as object[]).map((r) => JSON.stringify(r)).sort());
  return out;
}

function addBrief(db: DatabaseSync, date = DATE): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

/** 빌더 일정(a)과 남아야 하는 닮은 일정들 */
interface Seeded {
  /** 빌더 항목만 근거 */
  a: number;
  /** 지운 일정(빌더 연결) */
  b: number;
  /** 흡수된 일정(빌더 연결) */
  c: number;
  /** 빌더와 뉴스 근거가 함께 */
  d: number;
  /** 다른 일정이 흡수되어 들어간 일정(빌더 연결만) */
  e: number;
  /** 뉴스만 근거 */
  f: number;
  /** 어디에도 이어지지 않은 일정(빌더 연결도 없다) */
  h: number;
  /** a로 미뤄진 뉴스 일정 */
  g: number;
  /** 빌더 항목과 이어진 일정 */
  builderLinked: number[];
}

/** 일정, 뉴스 연결, 합치기·합치지 않음 기록을 raw SQL로 넣는다(schedules 표 구조는 db.ts 마이그레이션 5) */
function seedSchedules(db: DatabaseSync): Seeded {
  const stories = storiesOfDate(db, DATE);
  const ins = db.prepare("INSERT INTO schedules (name, due, major, outcome, postponed_to, merged_into, deleted, deleted_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const add = (name: string, opts: { outcome?: string; postponedTo?: number; mergedInto?: number; deleted?: boolean } = {}) =>
    Number(ins.run(name, "2026-12-01", "IT·AI", opts.outcome ?? null, opts.postponedTo ?? null, opts.mergedInto ?? null, opts.deleted ? 1 : 0, opts.deleted ? "2026-10-20" : null).lastInsertRowid);
  const a = add("가짜 도구 지원 종료");
  const b = add("가짜 지운 일정", { deleted: true });
  const e = add("가짜 남는 일정");
  const c = add("가짜 흡수된 일정", { mergedInto: e });
  const d = add("가짜 함께 근거 일정");
  const f = add("가짜 뉴스 일정");
  const h = add("가짜 연결 없는 일정");
  const g = add("가짜 미뤄진 일정", { outcome: "postponed", postponedTo: a });
  const link = db.prepare("INSERT INTO story_schedules (story_id, schedule_id, role) VALUES (?, ?, ?)");
  link.run(stories[0]!.id, d, "basis");
  link.run(stories[1]!.id, f, "basis");
  link.run(stories[2]!.id, g, "basis");
  const merge = db.prepare("INSERT INTO schedule_merges (merged_on, survivor, absorbed, reason, record, undone_on) VALUES (?, ?, ?, ?, '{}', ?)");
  merge.run("2026-10-21", a, h, "가짜 합치기(되돌림)", "2026-10-22");
  merge.run("2026-10-23", f, a, "가짜 합치기(되돌림)", "2026-10-24");
  merge.run("2026-10-25", e, c, "가짜 합치기", null);
  const noMerge = db.prepare("INSERT INTO schedule_no_merge (a, b) VALUES (?, ?)");
  noMerge.run(Math.min(a, f), Math.max(a, f));
  noMerge.run(Math.min(d, f), Math.max(d, f));
  return { a, b, c, d, e, f, h, g, builderLinked: [a, b, c, d, e] };
}

function scheduleRow(db: DatabaseSync, id: number): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return row === undefined ? undefined : { ...row };
}

function scheduleRows(db: DatabaseSync): Map<number, Record<string, unknown>> {
  return new Map((db.prepare("SELECT * FROM schedules").all() as Record<string, unknown>[]).map((r) => [r.id as number, { ...r }]));
}

/** T11대로 남아야 하는 일정과 지워져야 하는 일정, 그 기록을 본다 */
function assertPurged(db: DatabaseSync, s: Seeded, before?: Map<number, Record<string, unknown>>): void {
  assert.equal(scheduleRow(db, s.a), undefined, "빌더 항목만 근거인 일정은 행째 지운다");
  for (const id of [s.b, s.c, s.d, s.e, s.f, s.h, s.g]) {
    const row = scheduleRow(db, id);
    assert.ok(row, `일정 ${id}가 남아야 한다`);
    if (before) assert.deepEqual(id === s.g ? { ...row, postponed_to: s.a } : row, before.get(id), `일정 ${id}의 다른 칸은 그대로다`);
  }
  assert.equal(scheduleRow(db, s.g)!.postponed_to, null, "지운 일정을 가리키는 미룬 일정 연결은 비운다");
  assert.equal(scheduleRow(db, s.b)!.deleted, 1);
  assert.equal(scheduleRow(db, s.c)!.merged_into, s.e);
  const merges = db.prepare("SELECT survivor, absorbed FROM schedule_merges ORDER BY id").all() as { survivor: number; absorbed: number }[];
  assert.deepEqual(merges.map((m) => [m.survivor, m.absorbed]), [[s.e, s.c]], "지운 일정을 가리키는 합치기 기록만 지운다");
  const pairs = db.prepare("SELECT a, b FROM schedule_no_merge ORDER BY a, b").all() as { a: number; b: number }[];
  assert.deepEqual(pairs.map((p) => [p.a, p.b]), [[Math.min(s.d, s.f), Math.max(s.d, s.f)]], "지운 일정을 가리키는 합치지 않음 쌍만 지운다");
  assert.equal(tables(db).filter(isRetired).length, 0, `지운 기능의 표가 남았다: ${tables(db).filter(isRetired).join(", ")}`);
}

/** 업그레이드 전(버전 14) DB: 브리프, 일정, 지운 기능의 표와 그 행 */
function preR1Db(): { file: string; s: Seeded } {
  const file = path.join(tempDir(), "tidwyn.db");
  const db = openDb(file, MIGRATIONS.filter((m) => m.version <= 14));
  assert.equal(schemaVersion(db), 14);
  recordFirstCollectionDate(db, DATE);
  addBrief(db);
  const s = seedSchedules(db);
  const item = db.prepare("INSERT INTO builder_items (target_date, position, field, title, what_changed, who, action, why, due_date, due_state, sources) VALUES (?, ?, 'tools', ?, '바뀐 것', '누가', '할 일', '이유', '2026-12-01', 'confirmed', '[]')");
  const item1 = Number(item.run(DATE, 1, "가짜 도구 1").lastInsertRowid);
  const item2 = Number(item.run(DATE, 2, "가짜 도구 2").lastInsertRowid);
  const bl = db.prepare("INSERT INTO builder_item_schedules (item_id, schedule_id) VALUES (?, ?)");
  for (const id of s.builderLinked) bl.run(item1, id);
  bl.run(item2, s.a);
  db.prepare("INSERT INTO builder_item_keys (item_id, key) VALUES (?, 'builder-1')").run(item1);
  db.prepare("INSERT INTO videos (id, video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position) VALUES (1, 'fakevid0001', 'kr', '[]', ?, ?, '가짜 영상', '가짜 채널', 60, 'https://img.example.com/t.jpg', ?, '이유', 1)").run(DATE, DATE, DATE);
  db.prepare("INSERT INTO repo_snapshots (snapshot_date, repo, stars) VALUES (?, 'fake/repo', 2500)").run(DATE);
  db.prepare("INSERT INTO demand_flows (target_date, position, flow_id, category, field, title, summary, reason, level, aux) VALUES (?, 1, 'flow-1', 'interest', '분야', '가짜 흐름', '요지', '이유', 'weak', '[]')").run(DATE);
  db.close();
  return { file, s };
}

describe("R1 4.2-1 DB 업그레이드", () => {
  test("지운 기능 표가 없어지고 빌더 일정만 행째 지워지며, 남는 일정·다른 표의 행과 sqlite_sequence는 지운 표의 줄만 빠진다", () => {
    const { file, s } = preR1Db();
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 14));
    const before = dump(old);
    const scheduleBefore = scheduleRows(old);
    const retiredBefore = tables(old).filter(isRetired);
    old.close();
    assert.ok(["builder_items", "builder_item_schedules", "repo_snapshots", "demand_flows", "videos"].every((t) => retiredBefore.includes(t)), retiredBefore.join(", "));
    assert.ok(before.get("sqlite_sequence")!.some((r) => r.includes('"builder_items"')) && before.get("sqlite_sequence")!.some((r) => r.includes('"demand_flows"')), "지운 표의 sqlite_sequence 줄이 있는 DB다");

    const db = openDb(file);
    assert.equal(schemaVersion(db), 16);
    assertPurged(db, s, scheduleBefore);
    const after1 = dump(db);
    db.close();
    for (const [t, rows] of before) {
      if (isRetired(t)) {
        assert.ok(!after1.has(t), `${t}가 남았다`);
        continue;
      }
      if (SCHEDULE_TABLES.includes(t)) continue;
      if (t === "sqlite_sequence") {
        assert.deepEqual(after1.get(t), rows.filter((r) => !isRetired(JSON.parse(r).name)), "sqlite_sequence는 지운 표의 줄만 빠진다");
        continue;
      }
      assert.deepEqual(after1.get(t), rows, `${t}의 행이 바뀌었다`);
    }
    // B1(버전 16)의 저장소 표만 새로 생긴다(빈 표)
    assert.deepEqual([...after1.keys()].sort(), [...before.keys()].filter((t) => !isRetired(t)).concat(["trend_repo_days", "trend_repos"]).sort(), "R1 업그레이드가 만든 새 표는 없다");
    assert.deepEqual([after1.get("trend_repo_days"), after1.get("trend_repos")], [[], []]);
    assert.equal(after1.get("schedules")!.length, before.get("schedules")!.length - 1);

    // 두 번 돌려도 같다
    const again = openDb(file);
    assert.equal(schemaVersion(again), 16);
    assert.deepEqual(dump(again), after1);
    again.close();
  });

  test("빌더 일정 고르기는 빌더 연결이 있는 일정만이다: 빌더 표가 없는 버전 14 DB의 연결 없는 일정은 그대로다", () => {
    const file = path.join(tempDir(), "tidwyn.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 14));
    recordFirstCollectionDate(old, DATE);
    addBrief(old);
    const s = seedSchedules(old);
    for (const t of tables(old).filter(isRetired)) old.exec(`DROP TABLE "${t}"`);
    old.close();
    const db = openDb(file);
    for (const id of [s.a, s.b, s.c, s.d, s.e, s.f, s.h, s.g]) assert.ok(scheduleRow(db, id), `일정 ${id}`);
    db.close();
  });
});

// ---- 백업(4.2-2) ----

/** 옛 형식(10) 백업 파일: 지금 DB의 백업을 형식 10으로 바꾸고 builder.json·demand.json을 더한다(모양은 옛 builderStore·demandFlowStore의 백업 칸) */
function oldFormatFiles(db: DatabaseSync, builderSchedules: number[]): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, text] of buildBackup(db)) {
    assert.match(text, /"formatVersion": 12/, name);
    files.set(name, text.replaceAll('"formatVersion": 12', '"formatVersion": 10'));
  }
  const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
  files.set("builder.json", json({
    formatVersion: 10,
    items: [
      { id: 1, date: DATE, position: 1, field: "tools", title: "가짜 도구 지원 종료", whatChanged: "바뀐 것", who: "누가", action: "할 일", why: "이유", due: { date: "2026-12-01", state: "confirmed" }, sources: [{ name: "가짜 문서", url: "https://docs.example.com/a" }], issue: null, reminderOf: null, keys: ["builder-1"], schedules: builderSchedules },
      { id: 2, date: DATE, position: 2, field: "tools", title: "가짜 도구 2", whatChanged: "바뀐 것", who: "누가", action: "할 일", why: "이유", due: null, sources: [], issue: null, reminderOf: null, keys: ["builder-2"], schedules: [] },
    ],
    dates: [{ date: DATE, status: "done" }],
    rows: [],
    docs: [],
    sources: [],
    pending: [],
    emitted: [{ key: "builder-1", on: DATE }],
    reminders: [],
    corrections: [],
    discoveries: [{ id: 1, kind: "product", date: DATE, position: 1, name: "가짜 제품" }],
  }));
  files.set("demand.json", json({
    formatVersion: 10,
    flows: [{ id: 1, date: DATE, position: 1, flowId: "flow-1", category: "interest", field: "분야", title: "가짜 흐름", summary: "요지", reason: "이유", level: "weak", aux: [], issue: null, continues: null, units: [], community: [], turning: false }],
    flowDates: [{ date: DATE, status: "done", communityMissing: [] }],
    flowCorrections: [],
  }));
  return files;
}

describe("R1 4.2-2 백업은 builder.json·demand.json을 쓰지 않는다", () => {
  test("그 파일이 든 data 브랜치에 새 백업을 커밋하면 끝 커밋에서 그 파일이 빠지고 다른 백업 파일은 남으며, 앞 커밋에는 남는다", () => {
    const project = tempRepo();
    const backupRepo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db);
    const old = oldFormatFiles(db, []);
    db.close();
    const prev = commitBackup(old, backupRepo, "Backup briefs: old format", path.join(tempDir(), "idx"));
    assert.ok(prev.committed);
    const ls = (ref: string) => gitIn(backupRepo, "ls-tree", "--name-only", ref).trim().split("\n").sort();
    assert.deepEqual(ls("refs/heads/data"), ["2026-10.json", "builder.json", "demand.json", "meta.json"]);

    const ctx = makeCtx(project, { TIDWYN_DATA_DIR: dataDir, TIDWYN_BACKUP_REPO: backupRepo });
    assert.equal(main(["backup"], ctx), 0, ctx.text());
    assert.match(ctx.text(), /data 브랜치에 커밋함/);
    assert.deepEqual(ls("refs/heads/data"), ["2026-10.json", "meta.json"], "끝 커밋에 지운 기능의 파일이 없고 다른 백업 파일은 남는다");
    assert.equal(gitIn(backupRepo, "rev-parse", "refs/heads/data~1").trim(), prev.commit, "앞 커밋 위에 쌓는다(이력을 고치지 않는다)");
    assert.deepEqual(ls("refs/heads/data~1"), ["2026-10.json", "builder.json", "demand.json", "meta.json"], "지난 커밋에는 남는다");
    const tip = readBackupRef(backupRepo);
    assert.ok(!tip.has("builder.json") && !tip.has("demand.json"));
    for (const [name, text] of tip) assert.match(text, /"formatVersion": 12/, `${name}는 새 형식이다`);
    assert.deepEqual([...fs.readdirSync(path.join(dataDir, "backup"))].sort(), ["2026-10.json", "meta.json"], "내보내기 폴더에도 없다");
  });

  test("내보내기 폴더에 남은 옛 builder.json·demand.json은 지운다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "tidwyn.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db);
    const out = path.join(dir, "backup");
    fs.mkdirSync(out);
    for (const [name, text] of oldFormatFiles(db, [])) fs.writeFileSync(path.join(out, name), text);
    const files = exportBackup(db, out);
    db.close();
    assert.deepEqual([...files.keys()].sort(), ["2026-10.json", "meta.json"]);
    assert.deepEqual(fs.readdirSync(out).sort(), ["2026-10.json", "meta.json"]);
  });
});

// ---- 옛 백업 복원(4.2-3) ----

describe("R1 4.2-3 형식 10 백업 복원", () => {
  test("builder.json·demand.json이 든 형식 10 백업을 복원하면 오류 없이 끝나고, 빌더 일정만 빠지며 닮은 일정은 남는다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "src.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db);
    const s = seedSchedules(db);
    const scheduleBefore = scheduleRows(db);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    for (const [name, text] of oldFormatFiles(db, s.builderLinked)) fs.writeFileSync(path.join(out, name), text);
    db.close();
    const files = readBackupDir(out);
    assert.ok(files.has("builder.json") && files.has("demand.json") && files.has("schedules.json"), [...files.keys()].join(", "));
    assert.match(files.get("meta.json")!, /"formatVersion": 10/);

    const restored = path.join(tempDir(), "restored.db");
    assert.deepEqual(restoreBackup(files, restored), { dates: 1 });
    const r = openDb(restored);
    assertPurged(r, s, scheduleBefore);
    // 뉴스 연결은 그대로 되살아난다
    const links = r.prepare("SELECT schedule_id FROM story_schedules ORDER BY schedule_id").all() as { schedule_id: number }[];
    assert.deepEqual(links.map((l) => l.schedule_id), [s.d, s.f, s.g].sort((x, y) => x - y));
    r.close();
  });

  test("builder.json이 없는 형식 10 백업(demand.json만)도 오류 없이 복원되고 일정이 모두 남는다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "src.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db);
    const s = seedSchedules(db);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const old = oldFormatFiles(db, s.builderLinked);
    db.close();
    for (const [name, text] of old) if (name !== "builder.json") fs.writeFileSync(path.join(out, name), text);
    const restored = path.join(tempDir(), "restored.db");
    restoreBackup(readBackupDir(out), restored);
    const r = openDb(restored);
    for (const id of [s.a, s.b, s.c, s.d, s.e, s.f, s.h, s.g]) assert.ok(scheduleRow(r, id), `일정 ${id}`);
    assert.equal(tables(r).filter(isRetired).length, 0);
    r.close();
  });
});
