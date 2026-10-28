import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { buildBackup, commitBackup, exportBackup, readBackupDir, readBackupRef, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { loadBrief, recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { planTargets } from "../src/targets.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, cleanupTemp, commitCount, gitIn, listFiles, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

function addBrief(db: ReturnType<typeof openDb>, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

function dbWith(dates: string[]): { db: ReturnType<typeof openDb>; dir: string } {
  const dir = tempDir();
  const db = openDb(path.join(dir, "tidwyn.db"));
  recordFirstCollectionDate(db, dates[0] ?? "2026-09-30");
  for (const d of dates) addBrief(db, d);
  return { db, dir };
}

function snapshot(dir: string): Record<string, string> {
  return Object.fromEntries(readBackupDir(dir));
}

describe("4.5-1 월별 JSON 내보내기", () => {
  test("두 번 내보낸 결과가 바이트 단위로 같고, 첫 수집일과 형식 버전이 들어 있다", () => {
    const { db, dir } = dbWith(["2026-09-30", "2026-10-01", "2026-10-02"]);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const first = snapshot(out);
    exportBackup(db, out);
    assert.deepEqual(snapshot(out), first);
    assert.deepEqual(Object.keys(first), ["2026-09.json", "2026-10.json", "meta.json"]);
    assert.deepEqual(JSON.parse(first["meta.json"]!), { formatVersion: 1, firstCollectionDate: "2026-09-30" });
    assert.equal(JSON.parse(first["2026-10.json"]!).formatVersion, 1);
    db.close();
  });
  test("10월 날짜 하나를 더하면 10월 파일만 바뀐다", () => {
    const { db, dir } = dbWith(["2026-09-30", "2026-10-01"]);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const before = snapshot(out);
    addBrief(db, "2026-10-05");
    exportBackup(db, out);
    const afterExport = snapshot(out);
    assert.equal(afterExport["2026-09.json"], before["2026-09.json"]);
    assert.equal(afterExport["meta.json"], before["meta.json"]);
    assert.notEqual(afterExport["2026-10.json"], before["2026-10.json"]);
    db.close();
  });
  test("DB에 없는 달의 파일은 내보내기에서 지워지고, 커밋 뒤 data 브랜치에도 없다", () => {
    const repo = tempRepo();
    const { db, dir } = dbWith(["2026-10-01"]);
    const out = path.join(dir, "backup");
    fs.mkdirSync(out);
    fs.writeFileSync(path.join(out, "2026-08.json"), "{}");
    const files = exportBackup(db, out);
    assert.equal(fs.existsSync(path.join(out, "2026-08.json")), false);
    commitBackup(files, repo, "Backup briefs", path.join(dir, "idx"));
    assert.deepEqual(gitIn(repo, "ls-tree", "--name-only", "refs/heads/data").trim().split("\n"), ["2026-10.json", "meta.json"]);
    db.close();
  });
  test("실행 전 사본과 마크다운은 내보내지 않는다", () => {
    const { db } = dbWith(["2026-10-01"]);
    assert.deepEqual([...buildBackup(db).keys()], ["meta.json", "2026-10.json"]);
    db.close();
  });
});

describe("4.5-2 data 브랜치 커밋", () => {
  test("data 브랜치에 커밋하고, main·체크아웃된 브랜치·작업 트리는 그대로다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "-c", "feature");
    fs.mkdirSync(path.join(repo, "data"));
    fs.writeFileSync(path.join(repo, "data", "x.txt"), "작업 트리의 data 폴더");
    fs.writeFileSync(path.join(repo, "wip.txt"), "커밋하지 않은 작업");
    const mainHead = gitIn(repo, "rev-parse", "main");
    const status = gitIn(repo, "status", "--porcelain");
    const { db, dir } = dbWith(["2026-10-01", "2026-10-02"]);
    const files = exportBackup(db, path.join(dir, "backup"));
    const r = commitBackup(files, repo, "Backup briefs: 2026-10-01, 2026-10-02", path.join(dir, "idx"));
    assert.equal(r.committed, true);
    assert.equal(gitIn(repo, "rev-parse", "main"), mainHead);
    assert.equal(gitIn(repo, "symbolic-ref", "--short", "HEAD").trim(), "feature");
    assert.equal(gitIn(repo, "status", "--porcelain"), status);
    assert.equal(gitIn(repo, "log", "-1", "--format=%s", "refs/heads/data").trim(), "Backup briefs: 2026-10-01, 2026-10-02");
    assert.deepEqual(gitIn(repo, "ls-tree", "-r", "--name-only", "refs/heads/data").trim().split("\n"), ["2026-10.json", "meta.json"], "백업 파일만 있다");
    const again = commitBackup(files, repo, "Backup briefs", path.join(dir, "idx"));
    assert.deepEqual(again, { committed: false, reason: "바뀐 것이 없다" });
    assert.equal(commitCount(repo, "refs/heads/data"), 1);
    db.close();
  });
  test("이전 실행이 남긴 백업 작업 파일과 data 브랜치를 체크아웃한 worktree가 있어도 백업된다", () => {
    const repo = tempRepo();
    const { db, dir } = dbWith(["2026-10-01"]);
    const idx = path.join(dir, "idx");
    commitBackup(exportBackup(db, path.join(dir, "backup")), repo, "first", idx);
    fs.writeFileSync(idx, "끊긴 실행이 남긴 쓰레기");
    gitIn(repo, "worktree", "add", "-q", path.join(tempDir(), "stale-wt"), "data");
    addBrief(db, "2026-10-02");
    const r = commitBackup(exportBackup(db, path.join(dir, "backup")), repo, "second", idx);
    assert.equal(r.committed, true);
    assert.equal(commitCount(repo, "refs/heads/data"), 2);
    db.close();
  });
});

describe("4.5-3 복원", () => {
  test("내보내기 → 복원 → 다시 내보내기 결과가 같고, 대상 날짜 계산도 같다", () => {
    const { db, dir } = dbWith(["2026-10-20", "2026-10-22"]);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    const restored = path.join(tempDir(), "restored.db");
    assert.deepEqual(restoreBackup(readBackupDir(out), restored), { dates: 2 });
    const db2 = openDb(restored);
    const out2 = path.join(tempDir(), "backup2");
    exportBackup(db2, out2);
    assert.deepEqual(snapshot(out2), snapshot(out));
    assert.deepEqual(planTargets(db2, NOW), planTargets(db, NOW));
    db.close();
    db2.close();
  });
  test("이미 있는 경로로 옵션 없이 복원하면 거부되고, --force면 덮어쓴다", () => {
    const { db, dir } = dbWith(["2026-10-20"]);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    db.close();
    const target = path.join(dir, "tidwyn.db");
    const before = fs.readFileSync(target);
    assert.throws(() => restoreBackup(readBackupDir(out), target), /이미 DB가 있다/);
    assert.deepEqual(fs.readFileSync(target), before);
    assert.deepEqual(restoreBackup(readBackupDir(out), target, true), { dates: 1 });
  });
  test("모르는 형식 버전의 백업은 거부된다", () => {
    const { db, dir } = dbWith(["2026-10-20"]);
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    db.close();
    const files = readBackupDir(out);
    files.set("2026-10.json", files.get("2026-10.json")!.replace('"formatVersion": 1', '"formatVersion": 2'));
    const target = path.join(tempDir(), "r.db");
    assert.throws(() => restoreBackup(files, target), /형식 버전 2/);
    assert.equal(fs.existsSync(target), false);
  });
  test("임시 저장소: 백업 커밋 → DB 삭제 → 4.1-2가 알려 준 명령대로 복원 → 다시 내보내기 결과가 같다", () => {
    const repo = tempRepo();
    const ctx = makeCtx(repo);
    assert.equal(main(["start"], ctx), 0, ctx.text());
    const dataDir = path.join(repo, "data");
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    addBrief(db, "2026-10-27");
    db.close();
    const b = makeCtx(repo);
    assert.equal(main(["backup"], b), 0, b.text());
    const committed = Object.fromEntries(readBackupRef(repo));
    fs.rmSync(path.join(dataDir, "tidwyn.db"));
    const refused = makeCtx(repo);
    assert.equal(main(["check"], refused), 3);
    const cmd = refused.text().split("\n").map((l) => l.trim()).find((l) => l.startsWith("node src/cli.ts restore"))!;
    const r = makeCtx(repo);
    assert.equal(main(cmd.split(" ").slice(2), r), 0, r.text());
    const db2 = openDb(path.join(dataDir, "tidwyn.db"));
    const out = path.join(tempDir(), "re");
    exportBackup(db2, out);
    db2.close();
    assert.deepEqual(snapshot(out), committed);
    const again = makeCtx(repo);
    assert.equal(main(["check"], again), 0, again.text());
  });
});

describe("4.5-4 백업 저장소를 지정한 커밋", () => {
  test("백업 저장소를 임시 저장소로 지정하면 그 저장소에만 커밋된다", () => {
    const project = tempRepo();
    const backupRepo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    addBrief(db, "2026-10-27");
    db.close();
    const ctx = makeCtx(project, { TIDWYN_DATA_DIR: dataDir, TIDWYN_BACKUP_REPO: backupRepo });
    assert.equal(main(["backup"], ctx), 0, ctx.text());
    assert.match(ctx.text(), /data 브랜치에 커밋함/);
    assert.equal(commitCount(backupRepo, "refs/heads/data"), 1);
    assert.equal(gitIn(project, "branch", "--list", "data").trim(), "");
  });
  test("데이터 폴더만 바꾸거나 프로젝트 저장소를 직접 지정하면 커밋이 생기지 않는다", () => {
    const project = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    addBrief(db, "2026-10-27");
    db.close();
    for (const env of [{ TIDWYN_DATA_DIR: dataDir }, { TIDWYN_DATA_DIR: dataDir, TIDWYN_BACKUP_REPO: project }]) {
      const ctx = makeCtx(project, env);
      assert.equal(main(["backup"], ctx), 0, ctx.text());
      assert.match(ctx.text(), /내보내기만 함, 커밋 안 함/);
      assert.equal(gitIn(project, "branch", "--list", "data").trim(), "");
    }
    assert.ok(listFiles(path.join(dataDir, "backup")).includes("2026-10.json"));
  });
});

describe("4.6-3 백업에 로컬 정보 없음", () => {
  test("임시 백업 결과에 홈 경로, 데이터 폴더·백업 저장소 경로, 사용자 이름이 없다", () => {
    const project = tempRepo();
    const backupRepo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    addBrief(db, "2026-10-27");
    db.close();
    assert.equal(main(["backup"], makeCtx(project, { TIDWYN_DATA_DIR: dataDir, TIDWYN_BACKUP_REPO: backupRepo })), 0);
    const all = [...readBackupRef(backupRepo).values()].join("\n") + gitIn(backupRepo, "log", "--format=%B", "refs/heads/data");
    const forbidden = [os.homedir(), fs.realpathSync(os.homedir()), dataDir, backupRepo, project, os.tmpdir(), fs.realpathSync(os.tmpdir()), os.userInfo().username];
    for (const f of forbidden) assert.equal(all.includes(f), false, `백업에 ${f}가 들어 있다`);
  });
});

describe("1.5단계 4.3-2 발행일 추정 표시 백업", () => {
  test("추정 표시가 있는 DB를 백업→복원하면 같은 브리프가 나온다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "tidwyn.db"));
    recordFirstCollectionDate(db, "2026-10-27");
    const b = sampleBrief();
    b.sections[1]!.topStories[2]!.sources[0]!.publishedAtEstimated = true;
    const r = validateBrief(b, "2026-10-27");
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    const out = path.join(dir, "backup");
    exportBackup(db, out);
    db.close();
    assert.match(readBackupDir(out).get("2026-10.json")!, /"publishedAtEstimated": true/);
    const restored = path.join(dir, "restored.db");
    restoreBackup(readBackupDir(out), restored);
    const db2 = openDb(restored);
    assert.deepEqual(loadBrief(db2, "2026-10-27")?.brief, r.brief);
    db2.close();
  });
  test("추정 표시 항목이 없는 형식 버전 1 백업도 복원된다", () => {
    const dir = tempDir();
    const r = validateBrief(sampleBrief(), "2026-10-27");
    assert.ok(r.ok);
    const files = new Map([
      ["meta.json", JSON.stringify({ formatVersion: 1, firstCollectionDate: "2026-10-27" })],
      ["2026-10.json", JSON.stringify({ formatVersion: 1, month: "2026-10", briefs: [{ brief: r.brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false }] })],
    ]);
    assert.doesNotMatch(files.get("2026-10.json")!, /publishedAtEstimated/);
    const restored = path.join(dir, "restored.db");
    assert.deepEqual(restoreBackup(files, restored), { dates: 1 });
    const db = openDb(restored);
    assert.deepEqual(loadBrief(db, "2026-10-27")?.brief, r.brief);
    db.close();
  });
});
