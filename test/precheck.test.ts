import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main } from "../src/cli.ts";
import { REPO_NOREPLY, commitsAhead, commitsOfRefs, describeFinding, localBranches, precheck, type Finding } from "../src/precheck.ts";
import { cleanupTemp, gitIn, makeCtx, tempDir } from "./helpers.ts";

after(cleanupTemp);

// 걸리는 값(허용 목록 밖 메일, 토큰 접두사, 개인 키 머리)은 이 파일도 검사 대상이라 실행할 때 조립한다(4.7-3).
const FAKE_HOME = "/Users/fake-owner-q7";
const TRIGGERS = {
  email: ["someone", "personal-mail.test"].join("@"),
  githubToken: ["gh", "p_"].join("") + "Ab1".repeat(12),
  githubPat: ["github", "_pat_"].join("") + "Zz9_".repeat(10),
  vercelToken: ["vc", "p_"].join("") + "Qw3".repeat(8),
  privateKey: `${"-".repeat(5)}BEGIN OPENSSH PRIVATE ${"KEY"}${"-".repeat(5)}`,
  home: `${FAKE_HOME}/projects/tidwyn/data`,
};
const SQLITE_BYTES = Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(84)]);

/** 작성자·커미터가 noreply 주소인 커밋 하나가 있는 깨끗한 저장소 */
function cleanRepo(): string {
  const dir = tempDir("tidwyn-pre-");
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "user.name", "Test");
  gitIn(dir, "config", "user.email", REPO_NOREPLY);
  gitIn(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), "/data/\n");
  fs.writeFileSync(
    path.join(dir, "README.md"),
    [
      "# temp",
      `문의: ${REPO_NOREPLY}`,
      "예시 주소: user@example.com, a@mail.example.org, b@example.net",
      "Co-Authored-By 주소: noreply@anthropic.com",
      "홈 폴더 모양 설명: /Users/... 아래",
      "이미지: logo@2x.png, 패키지: vercel@65.5.0, @types/node",
      "",
    ].join("\n"),
  );
  gitIn(dir, "add", ".");
  gitIn(dir, "commit", "-q", "-m", "init\n\nCo-Authored-By: Bot <noreply@anthropic.com>");
  return dir;
}

function commitFile(repo: string, rel: string, content: string | Buffer, message = "add file"): void {
  const file = path.join(repo, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  gitIn(repo, "add", "-f", rel);
  gitIn(repo, "commit", "-q", "-m", message);
}

function check(repo: string, trackedFiles = true): Finding[] {
  return precheck({ repo, commits: commitsOfRefs(repo, localBranches(repo)), trackedFiles, home: FAKE_HOME }).findings;
}

function kinds(findings: Finding[]): string[] {
  return [...new Set(findings.map((f) => f.kind))].sort();
}

describe("3단계 4.7-3 공개 전 점검", () => {
  test("깨끗한 저장소(허용 목록의 주소, 경로 모양 설명 포함)는 통과한다", () => {
    const repo = cleanRepo();
    assert.deepEqual(check(repo), []);
    const ctx = makeCtx(repo, { HOME: FAKE_HOME });
    assert.equal(main(["precheck"], ctx), 0, ctx.text());
    assert.match(ctx.text(), /통과/);
  });

  const textCases: [string, string, string][] = [
    ["허용 목록 밖 메일", `연락처 ${TRIGGERS.email}\n`, "허용 목록 밖 메일 주소"],
    ["GitHub 토큰", `token=${TRIGGERS.githubToken}\n`, "GitHub 토큰 모양"],
    ["GitHub 세분화 토큰", `token=${TRIGGERS.githubPat}\n`, "GitHub 토큰 모양"],
    ["Vercel 토큰", `VERCEL=${TRIGGERS.vercelToken}\n`, "Vercel 토큰 모양"],
    ["개인 키 머리", `${TRIGGERS.privateKey}\nabc\n`, "개인 키 머리"],
    ["홈 폴더 절대 경로", `db: ${TRIGGERS.home}/tidwyn.db\n`, "홈 폴더 절대 경로"],
  ];
  for (const [name, content, kind] of textCases) {
    test(`${name}가 든 커밋은 실패하고, 값은 출력에 나오지 않는다`, () => {
      const repo = cleanRepo();
      commitFile(repo, "test/fixture.txt", `첫 줄\n${content}`);
      const found = check(repo);
      assert.deepEqual(kinds(found), [kind]);
      assert.ok(found.some((f) => f.where.endsWith("test/fixture.txt") && f.lines?.includes(2)), JSON.stringify(found));
      const ctx = makeCtx(repo, { HOME: FAKE_HOME });
      assert.equal(main(["precheck", "--refs", "main"], ctx), 1);
      assert.match(ctx.text(), new RegExp(kind));
      for (const v of Object.values(TRIGGERS)) assert.ok(!ctx.text().includes(v), "걸린 값은 출력하지 않는다");
    });
  }

  test("커밋 메시지 속 허용 목록 밖 메일도 걸린다", () => {
    const repo = cleanRepo();
    commitFile(repo, "a.txt", "x\n", `fix\n\nReported-by: ${TRIGGERS.email}`);
    const found = check(repo);
    assert.deepEqual(kinds(found), ["허용 목록 밖 메일 주소"]);
    assert.match(found[0]!.where, /^커밋 [0-9a-f]{7} 메시지$/);
  });

  test("작성자나 커미터 이메일이 noreply 주소가 아니면 실패한다(예시 도메인이어도)", () => {
    const repo = cleanRepo();
    fs.writeFileSync(path.join(repo, "b.txt"), "x\n");
    gitIn(repo, "add", "b.txt");
    gitIn(repo, "-c", "user.email=writer@example.com", "commit", "-q", "-m", "other author");
    const found = check(repo);
    assert.deepEqual(kinds(found), ["커밋 이메일이 noreply 주소가 아니다"]);
    assert.deepEqual(found.map((f) => f.where.replace(/[0-9a-f]{7}/, "X")).sort(), ["커밋 X 작성자", "커밋 X 커미터"]);
  });

  const fileCases: [string, string, string | Buffer, string][] = [
    [".env 파일", ".env.local", "NAME=value\n", ".env 파일"],
    ["이름이 .db인 파일", "notes/tidwyn.db", "not really sqlite\n", "SQLite 파일"],
    ["SQLite 머리가 있는 파일", "assets/blob.bin", SQLITE_BYTES, "SQLite 파일"],
    ["실행 전 사본", "snapshots/tidwyn-20261027-090000.db", SQLITE_BYTES, "실행 전 사본"],
  ];
  for (const [name, rel, content, kind] of fileCases) {
    test(`${name}가 든 커밋은 실패한다`, () => {
      const repo = cleanRepo();
      commitFile(repo, rel, content);
      assert.deepEqual(kinds(check(repo)), [kind]);
    });
  }

  test("지운 파일도 이력에 있으면 걸린다(이력 전체 검사)", () => {
    const repo = cleanRepo();
    commitFile(repo, "old.txt", `${TRIGGERS.email}\n`);
    gitIn(repo, "rm", "-q", "old.txt");
    gitIn(repo, "commit", "-q", "-m", "remove");
    assert.deepEqual(kinds(check(repo)), ["허용 목록 밖 메일 주소"]);
    assert.deepEqual(precheck({ repo, commits: [], trackedFiles: true, home: FAKE_HOME }).findings, [], "지금 파일에는 없다");
  });

  test("지금 파일: index와 작업 트리의 추적 파일을 보고, 무시되는 파일과 추적하지 않는 파일은 보지 않는다", () => {
    const repo = cleanRepo();
    fs.mkdirSync(path.join(repo, "data"));
    fs.writeFileSync(path.join(repo, "data", "secret.txt"), `${TRIGGERS.githubToken}\n`);
    fs.writeFileSync(path.join(repo, "data", "tidwyn.db"), SQLITE_BYTES);
    fs.writeFileSync(path.join(repo, "untracked.txt"), `${TRIGGERS.email}\n`);
    assert.deepEqual(check(repo), [], "무시되는 data/와 추적하지 않는 파일은 검사하지 않는다");
    fs.appendFileSync(path.join(repo, "README.md"), `${TRIGGERS.vercelToken}\n`);
    assert.deepEqual(kinds(check(repo)), ["Vercel 토큰 모양"], "작업 트리에서 고친 추적 파일");
    assert.deepEqual(check(repo, false), [], "trackedFiles가 false면 커밋만 본다");
    fs.writeFileSync(path.join(repo, "staged.txt"), `${TRIGGERS.privateKey}\n`);
    gitIn(repo, "add", "staged.txt");
    fs.writeFileSync(path.join(repo, "staged.txt"), "clean now\n");
    assert.deepEqual(kinds(check(repo)), ["Vercel 토큰 모양", "개인 키 머리"], "index에만 있는 내용도 본다");
  });

  test("바이너리 파일은 글자 모양 검사를 건너뛴다", () => {
    const repo = cleanRepo();
    commitFile(repo, "docs/shot.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), Buffer.from(`${TRIGGERS.email} ${TRIGGERS.githubToken}`)]));
    assert.deepEqual(check(repo), []);
  });

  test("커밋 범위: 원격보다 앞선 커밋의 이메일·메시지와 그 트리를 본다", () => {
    const repo = cleanRepo();
    fs.writeFileSync(path.join(repo, "old.txt"), "x\n");
    gitIn(repo, "add", "old.txt");
    gitIn(repo, "-c", "user.email=writer@example.com", "commit", "-q", "-m", "already pushed");
    const base = gitIn(repo, "rev-parse", "HEAD").trim();
    commitFile(repo, "good.txt", "ok\n");
    const ahead = commitsAhead(repo, "HEAD", base);
    assert.equal(ahead.length, 1);
    assert.deepEqual(precheck({ repo, commits: ahead, trackedFiles: false, home: FAKE_HOME }).findings, [], "이미 원격에 있는 커밋의 작성자는 보지 않는다");
    assert.equal(commitsAhead(repo, "HEAD", null).length, 3);
    commitFile(repo, "bad.txt", `${TRIGGERS.email}\n`);
    commitFile(repo, "later.txt", "ok\n");
    const two = commitsAhead(repo, "HEAD", base);
    assert.equal(two.length, 3);
    assert.deepEqual(kinds(precheck({ repo, commits: two.slice(0, 1), trackedFiles: false, home: FAKE_HOME }).findings), ["허용 목록 밖 메일 주소"], "가장 앞선 커밋의 트리에 남은 파일도 본다");
  });

  test("걸린 내용 설명은 위치와 종류만 담는다", () => {
    assert.equal(describeFinding({ where: "커밋 abc1234 a.txt", kind: "허용 목록 밖 메일 주소", lines: [2, 5] }), "커밋 abc1234 a.txt (줄 2, 5): 허용 목록 밖 메일 주소");
  });
});
