import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { buildBackup, readBackupRef, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { allCorrections, correctionsByStory } from "../src/corrections.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { createIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { loadBrief, recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { BACKUP_NAME_RE } from "../src/precheck.ts";
import { cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const DATE = "2026-10-27";
const KEY = "한국-1";
const REASON = "금리 인상 폭을 0.5%포인트에서 0.25%포인트로 바로잡았다.";

type Db = ReturnType<typeof openDb>;

function addBrief(db: Db, date = DATE): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

function setup(): { repo: string; dataDir: string; dbFile: string; env: NodeJS.ProcessEnv } {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, DATE);
  addBrief(db);
  db.close();
  return { repo, dataDir, dbFile, env: { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home" } };
}

function correct(repo: string, env: NodeJS.ProcessEnv, input: unknown): { code: number; text: string } {
  const file = path.join(tempDir(), "fix.json");
  fs.writeFileSync(file, JSON.stringify(input));
  const ctx = makeCtx(repo, env);
  return { code: main(["correct", "--file", file], ctx), text: ctx.text() };
}

function dbBytes(file: string): string {
  const db = openDb(file);
  const out = JSON.stringify({ brief: loadBrief(db, DATE), fixes: allCorrections(db) });
  db.close();
  return out;
}

const ok = (over: Record<string, unknown> = {}) => ({ date: DATE, key: KEY, reason: REASON, fields: { summary: "고친 요약이다." }, ...over });

describe("4.7-1 정정 명령", () => {
  test("맞는 입력이 적용되고 안내와 이슈 번호를 출력한다", () => {
    const { repo, dbFile, env } = setup();
    const db = openDb(dbFile);
    const issue = createIssue(db, { name: "가짜 이슈", aliases: [], category: { major: "경제", minor: "금융" }, status: "진행 중", summary: "가짜 요약" });
    linkStory(db, storiesOfDate(db, DATE).find((s) => s.key === KEY)!.id, issue, true);
    db.close();
    const r = correct(repo, env, ok({ fields: { title: "고친 제목", keyFacts: ["고친 사실 하나", "고친 사실 둘", "고친 사실 셋"] } }));
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /제보자와 제보 내용은 쓰지 않는다/);
    assert.match(r.text, new RegExp(`같은 오류가 있는지 볼 이슈: ${issue}`));
    const after = openDb(dbFile);
    const story = loadBrief(after, DATE)!.brief.sections[0]!.topStories[0]!;
    assert.equal(story.title, "고친 제목");
    assert.deepEqual(story.keyFacts, ["고친 사실 하나", "고친 사실 둘", "고친 사실 셋"]);
    assert.deepEqual(allCorrections(after), [{ story: `${DATE}/${KEY}`, on: "2026-10-28", reason: REASON, fields: ["title", "keyFacts"] }]);
    after.close();
  });
  test("짧은 소식은 요약을 고칠 수 있다", () => {
    const { repo, dbFile, env } = setup();
    const r = correct(repo, env, ok({ key: "한국-s1", fields: { summary: "고친 짧은 소식이다." } }));
    assert.equal(r.code, 0, r.text);
    const db = openDb(dbFile);
    assert.equal(loadBrief(db, DATE)!.brief.sections[0]!.shortNews[0]!.summary, "고친 짧은 소식이다.");
    db.close();
  });
  const refused: [string, Record<string, unknown>, RegExp][] = [
    ["값 없는 사유", { reason: "" }, /사유/],
    ["빈칸 사유", { reason: "   " }, /사유/],
    ["없는 뉴스", { key: "한국-99" }, /뉴스가 없다/],
    ["없는 날짜", { date: "2026-01-01" }, /뉴스가 없다/],
    ["없는 항목", { fields: { nope: "글" } }, /고칠 수 없다/],
    ["분류는 고치지 않는다", { fields: { category: "글" } }, /고칠 수 없다/],
    ["출처는 고치지 않는다", { fields: { sources: [] } }, /고칠 수 없다/],
    ["고칠 항목 없음", { fields: {} }, /하나 이상/],
    ["빈 글", { fields: { summary: "  " } }, /비어 있으면 안 된다/],
    ["짧은 소식의 제목", { key: "한국-s1", fields: { title: "글" } }, /고칠 수 없다/],
    ["핵심 사실 수", { fields: { keyFacts: ["하나"] } }, /1개/],
    ["비어 있는 선택 항목", { key: "한국-2", fields: { analogy: "새로 쓴 비유" } }, /새로 채우지 않는다/],
    ["긴 인용", { fields: { summary: `"${Array.from({ length: 16 }, (_, i) => `낱말${i}`).join(" ")}"라고 말했다.` } }, /직접 인용/],
    ["글의 메일", { fields: { summary: `문의는 ${["person", "gmail.com"].join("@")} 으로 보낸다.` } }, /허용 목록 밖 메일/],
    ["글의 홈 경로", { fields: { summary: "파일은 /Users/fake-home/x 에 있다." } }, /홈 폴더/],
    ["글의 키 모양", { fields: { summary: `키는 ghp_${"a".repeat(36)} 이다.` } }, /GitHub 토큰/],
    ["사유의 메일", { reason: `${["person", "gmail.com"].join("@")} 제보로 고쳤다.` }, /메일 주소/],
    ["사유의 공개 메일", { reason: "mivomad33@gmail.com 으로 온 제보로 고쳤다." }, /메일 주소/],
    ["사유의 홈 경로", { reason: "/Users/fake-home/x 를 고쳤다." }, /홈 폴더/],
    ["사유의 키 모양", { reason: `ghp_${"a".repeat(36)} 를 고쳤다.` }, /GitHub 토큰/],
    ["사유의 주소", { reason: "https://example.com/a 기사로 고쳤다." }, /주소/],
    ["사유의 도메인", { reason: "fake-news.co.kr 기사로 고쳤다." }, /주소/],
    ["사유의 전화번호", { reason: "010-1234-5678 제보로 고쳤다." }, /전화번호/],
    ["사유의 붙인 전화번호", { reason: "01012345678 제보로 고쳤다." }, /전화번호/],
    ["긴 사유", { reason: "가".repeat(121) }, /120자/],
    ["여러 줄 사유", { reason: "첫 줄\n둘째 줄" }, /한 줄/],
  ];
  for (const [name, over, why] of refused) {
    test(`거부: ${name}. DB가 그대로다`, () => {
      const { repo, dbFile, env } = setup();
      const before = dbBytes(dbFile);
      const r = correct(repo, env, ok(over));
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, why);
      assert.equal(dbBytes(dbFile), before);
    });
  }
  test("숫자와 날짜가 든 평범한 사유는 주소·전화번호로 보지 않는다", () => {
    const { repo, env } = setup();
    const r = correct(repo, env, ok({ reason: "2026-10-30 발표 수치를 1,250조 원에서 1,520조 원으로 바로잡았다." }));
    assert.equal(r.code, 0, r.text);
  });
  test("읽지 못하는 파일은 거부한다", () => {
    const { repo, env } = setup();
    const ctx = makeCtx(repo, env);
    assert.equal(main(["correct", "--file", "/no/such/file.json"], ctx), 1);
    assert.equal(main(["correct"], makeCtx(repo, env)), 2);
  });
});

describe("4.7-2 실행 조건과 사본", () => {
  test("실행 조건을 어기면 거부되고 DB가 그대로이며 사본이 없다", () => {
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    const dbFile = path.join(dataDir, "tidwyn.db");
    const db = openDb(dbFile);
    addBrief(db);
    db.close();
    gitIn(repo, "switch", "-q", "-c", "feature");
    const before = dbBytes(dbFile);
    const r = correct(repo, {}, ok());
    assert.equal(r.code, 3, r.text);
    assert.match(r.text, /실행 조건이 맞지 않아/);
    assert.equal(dbBytes(dbFile), before);
    assert.equal(fs.existsSync(path.join(dataDir, "snapshots")), false);
  });
  test("마크다운을 다시 만들지 못하면 정정은 남고 실패를 알린다", () => {
    const { repo, dataDir, dbFile, env } = setup();
    fs.writeFileSync(path.join(dataDir, "briefs"), "폴더 자리를 막는 파일");
    const r = correct(repo, env, ok());
    assert.equal(r.code, 0, r.text);
    const db = openDb(dbFile);
    assert.equal(allCorrections(db).length, 1);
    db.close();
    assert.match(r.text, /마크다운 만들기 실패/);
    assert.doesNotMatch(r.text, /마크다운을 다시 만들었다/);
  });
  test("통과하면 snapshots/에 고치기 전 사본이 생기고 마크다운에 새 글이 나온다", () => {
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    const dbFile = path.join(dataDir, "tidwyn.db");
    const db = openDb(dbFile);
    addBrief(db);
    db.close();
    const r = correct(repo, {}, ok());
    assert.equal(r.code, 0, r.text);
    const snaps = fs.readdirSync(path.join(dataDir, "snapshots"));
    assert.equal(snaps.length, 1);
    const old = openDb(path.join(dataDir, "snapshots", snaps[0]!));
    assert.notEqual(loadBrief(old, DATE)!.brief.sections[0]!.topStories[0]!.summary, "고친 요약이다.");
    old.close();
    const md = fs.readdirSync(dataDir, { recursive: true }).map(String).filter((f) => f.endsWith(".md") && f.includes(DATE));
    assert.ok(md.length > 0);
    assert.ok(md.some((f) => fs.readFileSync(path.join(dataDir, f), "utf8").includes("고친 요약이다.")));
  });
});

describe("4.7-3 기록", () => {
  test("같은 입력을 다시 실행해도 한 건이고, 다른 정정은 쌓인다", () => {
    const { repo, dbFile, env } = setup();
    assert.equal(correct(repo, env, ok()).code, 0);
    const again = correct(repo, env, ok());
    assert.equal(again.code, 0, again.text);
    assert.match(again.text, /바뀐 것이 없다/);
    assert.equal(correct(repo, env, ok({ reason: "다시 고쳤다.", fields: { summary: "두 번째로 고친 요약이다.", outlook: loadOutlook(dbFile) } })).code, 0);
    const db = openDb(dbFile);
    const list = correctionsByStory(db).get(`${DATE}/${KEY}`)!;
    assert.deepEqual(list.map((c) => c.reason), [REASON, "다시 고쳤다."]);
    assert.deepEqual(list[1]!.fields, ["summary"], "바뀌지 않은 항목은 적지 않는다");
    db.close();
  });
});

function loadOutlook(dbFile: string): string {
  const db = openDb(dbFile);
  const v = loadBrief(db, DATE)!.brief.sections[0]!.topStories[0]!.outlook;
  db.close();
  return v;
}

describe("4.7-4 마이그레이션과 백업", () => {
  for (const from of [8, 4]) {
    test(`버전 ${from} DB가 새 버전으로 올라가고 데이터가 그대로다`, () => {
      const file = path.join(tempDir(), "old.db");
      const old = openDb(file, MIGRATIONS.filter((m) => m.version <= from));
      recordFirstCollectionDate(old, DATE);
      addBrief(old);
      const before = JSON.stringify(loadBrief(old, DATE));
      assert.equal(schemaVersion(old), from);
      old.close();
      const db = openDb(file);
      assert.equal(schemaVersion(db), 9);
      assert.equal(JSON.stringify(loadBrief(db, DATE)), before);
      assert.deepEqual(allCorrections(db), []);
      db.close();
    });
  }
  test("정정 기록이 백업과 복원을 왕복하고, 다시 만든 백업이 같다", () => {
    const { repo, dbFile, env } = setup();
    assert.equal(correct(repo, env, ok()).code, 0);
    assert.equal(correct(repo, env, ok({ key: "세계-s1", reason: "다른 뉴스를 고쳤다.", fields: { summary: "세계 소식을 고쳤다." } })).code, 0);
    const db = openDb(dbFile);
    const files = buildBackup(db);
    db.close();
    assert.ok(files.has("corrections.json"));
    assert.ok(BACKUP_NAME_RE.test("corrections.json"));
    assert.equal(JSON.parse(files.get("meta.json")!).formatVersion, 6);
    const out = path.join(tempDir(), "restored.db");
    restoreBackup(files, out);
    const back = openDb(out);
    assert.deepEqual([...buildBackup(back)], [...files]);
    back.close();
  });
  test("정정이 없으면 파일을 쓰지 않고, 옛 형식 백업도 복원된다", () => {
    const { dbFile } = setup();
    const db = openDb(dbFile);
    const files = buildBackup(db);
    db.close();
    assert.equal(files.has("corrections.json"), false);
    const oldFiles = new Map([...files].map(([k, v]) => [k, v.replace('"formatVersion": 6', '"formatVersion": 5')]));
    const out = path.join(tempDir(), "old-format.db");
    assert.deepEqual(restoreBackup(oldFiles, out), { dates: 1 });
    const back = openDb(out);
    assert.deepEqual(allCorrections(back), []);
    back.close();
  });
  test("data 브랜치에서 읽을 때도 corrections.json을 읽는다", () => {
    const repo = tempRepo();
    gitIn(repo, "switch", "-q", "--orphan", "data");
    gitIn(repo, "rm", "-rq", "--cached", "--ignore-unmatch", ".");
    fs.writeFileSync(path.join(repo, "corrections.json"), "{}");
    gitIn(repo, "add", "corrections.json");
    gitIn(repo, "commit", "-qm", "x");
    gitIn(repo, "switch", "-q", "main");
    assert.ok(readBackupRef(repo).has("corrections.json"));
  });
});

