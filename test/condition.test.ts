import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { commitBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { parseArgs, resolveSettings } from "../src/settings.ts";
import { NOW, PROJECT_ROOT, cleanupTemp, commitCount, gitIn, listFiles, makeCtx, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const REAL = { test: false, startDate: null };

function assertRefusedWithoutWrites(repo: string, cwd = repo, env: NodeJS.ProcessEnv = {}): string {
  const ctx = makeCtx(cwd, env);
  const before = commitCount(repo);
  assert.equal(main(["start"], ctx), 3, ctx.text());
  assert.equal(fs.existsSync(path.join(repo, "data")), false, "데이터 폴더에 아무 파일도 생기지 않는다");
  assert.deepEqual(ctx.installs, [], "의존성 설치 전에 멈춘다");
  assert.equal(commitCount(repo), before);
  return ctx.text();
}

describe("4.1-2 실행 조건", () => {
  test("다른 브랜치면 거부된다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "-c", "feature");
    assert.match(assertRefusedWithoutWrites(repo), /main이 아니라 feature/);
  });
  test("추적 파일을 고쳤으면 거부된다", () => {
    const repo = tempRepo();
    fs.appendFileSync(path.join(repo, "README.md"), "edit\n");
    assert.match(assertRefusedWithoutWrites(repo), /변경 사항이 있다[\s\S]*README\.md/);
  });
  test("추적되지 않은 새 파일이 있으면 거부된다", () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, ".serena", "memories"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".serena", "memories", "note.md"), "x");
    assert.match(assertRefusedWithoutWrites(repo), /\.serena\/memories\/note\.md/);
  });
  test("연결된 worktree 안에서 실행하면 거부된다", () => {
    const repo = tempRepo();
    const wt = path.join(tempDir(), "wt");
    gitIn(repo, "worktree", "add", "-q", wt, "-b", "wt-branch");
    assert.match(assertRefusedWithoutWrites(repo, wt), /worktree 안에서 실행 중/);
    assert.equal(fs.existsSync(path.join(wt, "data")), false);
  });
  test("main이고 변경이 없으면(무시되는 data/와 node_modules/가 있어도) 통과한다", () => {
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, "node_modules", "x"), { recursive: true });
    fs.mkdirSync(path.join(repo, "data"));
    fs.writeFileSync(path.join(repo, "data", "keep.txt"), "x");
    const ctx = makeCtx(repo);
    assert.equal(main(["start"], ctx), 0, ctx.text());
    assert.deepEqual(ctx.installs, [repo], "조건을 통과한 뒤 의존성을 맞춘다");
    assert.ok(fs.existsSync(path.join(repo, "data", "tidwyn.db")));
  });
  test("환경 변수로 data/를 가리키면(상대 경로, 심볼릭 링크 포함) 실제 데이터 폴더로 판정된다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "-c", "feature");
    const link = path.join(tempDir(), "link-to-data");
    fs.mkdirSync(path.join(repo, "data"));
    fs.symlinkSync(path.join(repo, "data"), link);
    for (const value of ["data", "./data/", `../${path.basename(repo)}/data`, link, "DATA", "Data/"]) {
      const s = resolveSettings({ cwd: repo, env: { TIDWYN_DATA_DIR: value }, args: REAL, now: NOW });
      assert.equal(s.isRealDataDir, true, value);
      const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: value });
      assert.equal(main(["start"], ctx), 3, value);
    }
    assert.deepEqual(fs.readdirSync(path.join(repo, "data")), []);
  });
  test("data 브랜치에 백업이 있고 DB가 없으면 거부되고, 알려 준 명령대로 복원하면 다시 거부되지 않는다", () => {
    const repo = tempRepo();
    const work = tempDir();
    commitBackup(new Map([["meta.json", JSON.stringify({ formatVersion: 1, firstCollectionDate: "2026-10-20" }, null, 2) + "\n"]]), repo, "Backup briefs", path.join(work, "idx"));
    const text = assertRefusedWithoutWrites(repo);
    assert.match(text, /DB가 없는데[\s\S]*data 브랜치에 백업/);
    const cmd = text.split("\n").map((l) => l.trim()).find((l) => l.startsWith("node src/cli.ts restore"));
    assert.equal(cmd, "node src/cli.ts restore");
    const restoreCtx = makeCtx(repo);
    assert.equal(main(cmd!.split(" ").slice(2), restoreCtx), 0, restoreCtx.text());
    const again = makeCtx(repo);
    assert.equal(main(["check"], again), 0, again.text());
  });
  test("data/가 아직 없을 때 대소문자만 다른 경로도 실제 데이터 폴더로 판정된다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "-c", "feature");
    for (const value of ["DATA", "Data"]) {
      const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: value });
      assert.equal(main(["start"], ctx), 3, value);
    }
    assert.deepEqual(fs.readdirSync(repo).filter((n) => n.toLowerCase() === "data"), []);
  });
  test("data 브랜치가 없으면 첫 실행으로 진행한다", () => {
    const repo = tempRepo();
    const ctx = makeCtx(repo);
    assert.equal(main(["start"], ctx), 0, ctx.text());
    assert.match(ctx.text(), /대상 날짜: 2026-10-27/);
  });
  test("의존성 설치가 실패하면 아무것도 쓰지 않고 멈춘다", () => {
    const repo = tempRepo();
    const ctx = makeCtx(repo, {}, NOW, () => ({ ok: false, message: "설치 실패" }));
    assert.equal(main(["start"], ctx), 4);
    assert.match(ctx.text(), /설치 실패[\s\S]*아무것도 쓰지 않고 멈춘다/);
    assert.equal(fs.existsSync(path.join(repo, "data")), false);
  });
  test("node_modules가 없는 깨끗한 클론에서 조건 확인 명령이 거부 사유를 출력한다", () => {
    const repo = tempRepo();
    fs.cpSync(path.join(PROJECT_ROOT, "src"), path.join(repo, "src"), { recursive: true });
    fs.copyFileSync(path.join(PROJECT_ROOT, "package.json"), path.join(repo, "package.json"));
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-q", "-m", "code");
    const clone = path.join(tempDir(), "clone");
    gitIn(repo, "clone", "-q", repo, clone);
    gitIn(clone, "switch", "-q", "-c", "feature");
    assert.equal(fs.existsSync(path.join(clone, "node_modules")), false);
    const r = spawnSync(process.execPath, ["src/cli.ts", "check"], { cwd: clone, encoding: "utf8", env: { PATH: process.env.PATH } });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stdout, /main이 아니라 feature/);
    assert.equal(r.stderr, "");
  });
});

describe("4.1-8 시험 모드와 인자", () => {
  test("시험 모드는 실제 데이터 폴더가 아닌 새 폴더를 쓰고 커밋이 꺼져 있다", () => {
    const repo = tempRepo();
    const s = resolveSettings({ cwd: repo, env: { TIDWYN_DATA_DIR: "data", TIDWYN_BACKUP_REPO: repo }, args: { test: true, startDate: null }, now: NOW });
    assert.equal(s.mode, "test");
    assert.equal(s.isRealDataDir, false);
    assert.equal(s.backupRepo, null);
    assert.equal(path.dirname(s.dataDir), path.join(repo, ".test-data"));
    assert.equal(gitIn(repo, "check-ignore", path.join(s.dataDir, "x")).trim().length > 0, true);
  });
  test("다른 브랜치·변경 사항 있음에서도 시험 모드는 진행되고, 시작일부터 어제까지가 대상이다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "-c", "feature");
    fs.writeFileSync(path.join(repo, "new.txt"), "x");
    const ctx = makeCtx(repo);
    assert.equal(main(["start", "test", "2026-10-25"], ctx), 0, ctx.text());
    assert.match(ctx.text(), /모드: 시험 모드/);
    assert.match(ctx.text(), /코드: feature @ \w+ \(변경 사항 있음\)/);
    assert.match(ctx.text(), /백업 저장소: 커밋 안 함/);
    assert.match(ctx.text(), /대상 날짜: 2026-10-25, 2026-10-26, 2026-10-27/);
    assert.equal(fs.existsSync(path.join(repo, "data")), false);
  });
  test("알 수 없는 인자와 잘못된 시작일은 거부되고 아무것도 쓰지 않는다", () => {
    const repo = tempRepo();
    for (const args of [["tset"], ["test", "extra"], ["2026-10-25"], ["test", "2026-02-30"], ["test", "2026-10-28"], ["test", "20261025"], ["test", "test"]]) {
      const ctx = makeCtx(repo);
      assert.equal(main(["start", ...args], ctx), 2, args.join(" "));
      assert.match(ctx.text(), /사용법/);
    }
    assert.equal(fs.existsSync(path.join(repo, ".test-data")), false);
    assert.equal(fs.existsSync(path.join(repo, "data")), false);
  });
  test("시작일은 KST 어제까지 받는다", () => {
    assert.equal(parseArgs(["test", "2026-10-27"], NOW).ok, true);
    assert.equal(parseArgs(["test", "2026-10-28"], NOW).ok, false);
  });
  test("모든 실행은 시작할 때 데이터 폴더, 브랜치와 커밋, 백업 저장소를 보여 준다", () => {
    const repo = tempRepo();
    const ctx = makeCtx(repo);
    assert.equal(main(["start"], ctx), 0);
    const head = gitIn(repo, "rev-parse", "--short", "HEAD").trim();
    assert.match(ctx.text(), new RegExp(`데이터 폴더: ${path.join(repo, "data")}`));
    assert.match(ctx.text(), new RegExp(`코드: main @ ${head}\\n`));
    assert.match(ctx.text(), new RegExp(`백업 저장소: ${repo}`));
  });
});

describe("4.3-1 데이터 폴더", () => {
  test("환경 변수를 주면 그 폴더에 DB가 생긴다", () => {
    const repo = tempRepo();
    const dir = path.join(tempDir(), "custom");
    const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dir });
    assert.equal(main(["start"], ctx), 0, ctx.text());
    assert.ok(fs.existsSync(path.join(dir, "tidwyn.db")));
    assert.equal(fs.existsSync(path.join(repo, "data")), false);
  });
  test("연결된 worktree에서 기본 경로를 계산하면 메인 작업 폴더의 data/가 나온다", () => {
    const repo = tempRepo();
    const wt = path.join(tempDir(), "wt");
    gitIn(repo, "worktree", "add", "-q", wt, "-b", "wt-branch");
    const s = resolveSettings({ cwd: wt, env: {}, args: REAL, now: NOW });
    assert.equal(s.dataDir, path.join(repo, "data"));
    assert.equal(s.isRealDataDir, true);
  });
});

describe("4.5-4 백업 저장소 지정", () => {
  test("데이터 폴더만 바꾸면 커밋하지 않고, 프로젝트 저장소를 직접 지정해도 커밋하지 않는다", () => {
    const repo = tempRepo();
    const dir = tempDir();
    const a = resolveSettings({ cwd: repo, env: { TIDWYN_DATA_DIR: dir }, args: REAL, now: NOW });
    assert.equal(a.backupRepo, null);
    const b = resolveSettings({ cwd: repo, env: { TIDWYN_DATA_DIR: dir, TIDWYN_BACKUP_REPO: repo }, args: REAL, now: NOW });
    assert.equal(b.backupRepo, null);
    assert.match(b.noCommitReason ?? "", /이 프로젝트 저장소/);
    const other = tempRepo();
    const c = resolveSettings({ cwd: repo, env: { TIDWYN_DATA_DIR: dir, TIDWYN_BACKUP_REPO: other }, args: REAL, now: NOW });
    assert.equal(c.backupRepo, other);
  });
  test("깨끗한 클론의 package.json과 소스에는 의존성 없이 도는 진입점만 있다", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")) as Record<string, unknown>;
    assert.equal(pkg.dependencies, undefined, "런타임 의존성이 없어야 조건 확인과 복원이 설치 없이 돈다");
    for (const f of listFiles(path.join(PROJECT_ROOT, "src"))) {
      const text = fs.readFileSync(path.join(PROJECT_ROOT, "src", f), "utf8");
      for (const m of text.matchAll(/from "([^"]+)"/g)) assert.ok(m[1]!.startsWith("node:") || m[1]!.startsWith("./"), `${f}: ${m[1]}`);
    }
  });
});
