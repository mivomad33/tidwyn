import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { buildBackup, exportBackup, readBackupDir, restoreBackup } from "../src/backup.ts";
import { main } from "../src/cli.ts";
import { correctionsByItem, allPending, allRows, builderItemsOfDate, emittedKeys, isBuilderDone, reminderOf, sourceState, hasBuilderData } from "../src/builderStore.ts";
import { placeOnCalendar } from "../src/builderSchedule.ts";
import { insertBuilderItem } from "../src/builderStore.ts";
import { openDb } from "../src/db.ts";
import { BACKUP_NAME_RE, nameKinds, precheck, REPO_NOREPLY } from "../src/precheck.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { getSchedule, linkSchedule } from "../src/schedules.ts";
import { storiesOfDate } from "../src/issues.ts";
import { TARGET, apply, env, fakeHttp, item, nextDay, rss, run, type Env, HOUR, NOW } from "./builderFixtures.ts";
import { cleanupTemp, gitIn, makeCtx, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const SECRET_MATERIAL = "지어낸재료문자열QZX";
const doc = (p: string) => `| Model | Price |\n|---|---|\n| fake-1 | ${p} |\n| fake-2 | $2 |\n`;
const dep = "| Model | Shutdown date |\n|---|---|\n| m-1 | 2027-03-01 |\n";

function restored(e: Env): Env {
  const dir = tempDir();
  const file = path.join(dir, "tidwyn.db");
  restoreBackup(buildBackup(e.db), file);
  return { db: openDb(file), dataDir: dir };
}

async function filled(): Promise<Env> {
  const e = env(TARGET);
  const feed = rss([{ title: "Fake notes", link: "https://platform.claude.com/docs/a", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: `${SECRET_MATERIAL} January 14, 2027` }]);
  const r = await run(e, fakeHttp({ "openai-pricing": doc("$1"), "openai-deprecations": dep, "claude-notes": feed, vite: { status: 500, text: "x" } }));
  const n = r.drafts.findIndex((d) => d.source === "claude-notes") + 1;
  apply(e, r, [item([n], { field: "모델", due: { date: "2027-01-14", state: "confirmed", schedule: "가짜 종료" } })]);
  return e;
}

describe("4.5-1 백업과 복원", () => {
  test("백업 → 복원 → 다시 백업의 바이트가 같고 재료는 없다", async () => {
    const e = await filled();
    const files = buildBackup(e.db);
    assert.ok(files.has("builder.json"));
    const again = buildBackup(restored(e).db);
    assert.deepEqual([...again.keys()].sort(), [...files.keys()].sort());
    for (const [name, text] of files) assert.equal(again.get(name), text, name);
    assert.ok(![...files.values()].some((t) => t.includes(SECRET_MATERIAL)), "재료 글은 백업에 없다");
    const f = JSON.parse(files.get("builder.json")!) as Record<string, unknown[]>;
    for (const k of ["items", "dates", "rows", "docs", "sources", "pending", "emitted", "reminders", "corrections"]) assert.ok(k in f, k);
    assert.ok(!files.get("builder.json")!.includes("HTTP 500"), "실패 이유는 넣지 않는다");
  });

  test("복원 뒤 숫자 행과 지원 종료 행이 첫 실행처럼 동작하지 않고 변경만 후보가 되며, 끝난 날짜는 다시 받지 않고 미적용 변경은 다시 나온다", async () => {
    const e = await filled();
    const r = restored(e);
    assert.equal(isBuilderDone(r.db, TARGET), true);
    assert.equal(sourceState(r.db, "vite").failDays, 1);
    assert.equal(sourceState(r.db, "openai-pricing").fetchedAt, NOW.toISOString());
    assert.deepEqual(allRows(r.db), allRows(e.db));
    const pendingBefore = allPending(r.db);
    assert.equal(pendingBefore.length, 1);
    assert.equal(pendingBefore[0]!.emits, 1);
    const next = await run(r, fakeHttp({ "openai-pricing": doc("$7"), "openai-deprecations": dep }), nextDay(1));
    assert.equal(next.docs.find((d) => d.doc === "openai-pricing")!.first, false);
    assert.deepEqual(next.drafts.map((d) => d.source).sort(), ["openai-deprecations", "openai-pricing"]);
  });

  test("다시 알림 기록, 항목과 일정의 연결, 낸 키가 복원된다", async () => {
    const e = await filled();
    const near = "2026-10-29";
    const id = insertBuilderItem(e.db, "2026-10-26", { field: "모델", title: "가까운", whatChanged: "x", who: "y", action: "없음", why: "z", due: { date: near, state: "confirmed" }, sources: [{ name: "a", url: "https://platform.claude.com/x" }], issue: null, reminderOf: null, keys: ["eol:nodejs:1"] });
    const p = placeOnCalendar(e.db, id, { keys: [], due: { date: near, state: "confirmed" }, scheduleName: "가까운 일정" }, "2026-10-26");
    e.db.prepare("INSERT INTO builder_emitted (key, emitted_on) VALUES ('eol:nodejs:2', '2026-10-27')").run();
    const r = restored(e);
    assert.equal(reminderOf(r.db, p.schedule!)!.state, "skip");
    assert.deepEqual(builderItemsOfDate(r.db, "2026-10-26")[0]!.schedules, [p.schedule]);
    assert.ok(emittedKeys(r.db).has("eol:nodejs:2"));
  });

  test("폴더로 내보낸 백업에서도 builder.json과 정정 기록이 복원된다", () => {
    const e = env();
    const id = insertBuilderItem(e.db, TARGET, { field: "모델", title: "가짜", whatChanged: "x", who: "y", action: "없음", why: "z", due: null, sources: [{ name: "a", url: "https://platform.claude.com/x" }], issue: null, reminderOf: null, keys: [] });
    e.db.prepare("INSERT INTO builder_corrections (item_id, corrected_on, reason, fields) VALUES (?, '2026-10-28', '바로잡았다', '[\"title\"]')").run(id);
    const dir = tempDir();
    exportBackup(e.db, dir);
    const file = path.join(tempDir(), "r.db");
    restoreBackup(readBackupDir(dir), file);
    const db = openDb(file);
    assert.equal(correctionsByItem(db).get(`${TARGET}/builder-1`)!.length, 1);
  });

  test("빌더 파일이 없는 옛 백업이 복원되고 빌더 데이터가 없으면 파일을 쓰지 않는다", () => {
    const e = env(TARGET);
    const files = buildBackup(e.db);
    assert.equal(files.has("builder.json"), false);
    const meta = JSON.parse(files.get("meta.json")!) as { formatVersion: number };
    files.set("meta.json", JSON.stringify({ ...meta, formatVersion: 6 }));
    const r = restored({ ...e });
    assert.equal(hasBuilderData(r.db), false);
    const target = path.join(tempDir(), "old.db");
    assert.ok(restoreBackup(files, target).dates >= 1);
  });
});

describe("4.5-2 정정", () => {
  function setup() {
    const repo = tempRepo();
    const dataDir = tempDir();
    const file = path.join(dataDir, "tidwyn.db");
    const db = openDb(file);
    return { repo, dataDir, db, env: { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home" } as NodeJS.ProcessEnv };
  }

  function correct(s: ReturnType<typeof setup>, input: unknown): { code: number; text: string } {
    const file = path.join(tempDir(), "fix.json");
    fs.writeFileSync(file, JSON.stringify(input));
    const ctx = makeCtx(s.repo, s.env);
    return { code: main(["correct", "--file", file], ctx), text: ctx.text() };
  }

  function seeded(s: ReturnType<typeof setup>, due = "2026-12-20", base = TARGET) {
    const keys = ["k:1"];
    const d = { date: due, state: "confirmed" as const };
    const id = insertBuilderItem(s.db, base, { field: "모델", title: "가짜 제목", whatChanged: "가짜 내용", who: "가짜 사용자", action: "없음", why: "가짜 이유", due: d, sources: [{ name: "a", url: "https://platform.claude.com/x" }], issue: null, reminderOf: null, keys });
    const p = placeOnCalendar(s.db, id, { keys, due: d, scheduleName: "가짜 일정" }, base);
    return { id, schedule: p.schedule! };
  }

  const ok = (over: Record<string, unknown> = {}) => ({ date: TARGET, key: "builder-1", reason: "기한을 바로잡았다.", fields: { title: "고친 제목" }, ...over });

  test("글 칸을 고치고 날짜와 사유를 남기며 재실행은 무변경이고 백업에 있다", () => {
    const s = setup();
    seeded(s);
    const r = correct(s, ok());
    assert.equal(r.code, 0, r.text);
    assert.equal(builderItemsOfDate(s.db, TARGET)[0]!.title, "고친 제목");
    assert.deepEqual(correctionsByItem(s.db).get(`${TARGET}/builder-1`), [{ on: "2026-10-28", reason: "기한을 바로잡았다.", fields: ["title"] }]);
    const again = correct(s, ok());
    assert.equal(again.code, 0);
    assert.match(again.text, /바뀐 것이 없다/);
    assert.equal(correctionsByItem(s.db).get(`${TARGET}/builder-1`)!.length, 1);
    assert.equal((JSON.parse(buildBackup(s.db).get("builder.json")!) as { corrections: unknown[] }).corrections.length, 1);
  });

  test("기한 정정은 빌더 일정 예정일과 다시 알림을 고치고 같은 일정의 다른 항목을 알린다", () => {
    const s = setup();
    const a = seeded(s);
    const other = insertBuilderItem(s.db, "2026-10-26", { field: "모델", title: "다른 항목", whatChanged: "x", who: "y", action: "없음", why: "z", due: null, sources: [{ name: "a", url: "https://platform.claude.com/y" }], issue: null, reminderOf: null, keys: [] });
    s.db.prepare("INSERT INTO builder_item_schedules (item_id, schedule_id) VALUES (?, ?)").run(other, a.schedule);
    const r = correct(s, ok({ fields: { dueDate: "2026-11-01" } }));
    assert.equal(r.code, 0, r.text);
    assert.equal(getSchedule(s.db, a.schedule)!.due, "2026-11-01");
    assert.equal(reminderOf(s.db, a.schedule)!.state, "skip", "오늘에서 7일 안이면 다시 알리지 않는다");
    assert.equal(builderItemsOfDate(s.db, TARGET)[0]!.due!.date, "2026-11-01");
    assert.equal(builderItemsOfDate(s.db, TARGET)[0]!.due!.state, "confirmed");
    assert.match(r.text, /다른 항목: 2026-10-26 builder-1/);
  });

  test("뉴스 근거 일정은 그대로이고 출력으로 알린다", async () => {
    const s = setup();
    const a = seeded(s);
    const { addBrief } = await import("./builderFixtures.ts");
    addBrief(s.db, TARGET);
    linkSchedule(s.db, storiesOfDate(s.db, TARGET)[0]!.id, a.schedule, "basis");
    const r = correct(s, ok({ fields: { dueDate: "2026-12-25" } }));
    assert.equal(r.code, 0, r.text);
    assert.equal(getSchedule(s.db, a.schedule)!.due, "2026-12-20");
    assert.match(r.text, /뉴스 근거가 있어 그대로 둔 일정/);
  });

  test("없는 키, 사유 위반, 공개 검사에 걸리는 새 글, 출처, 범위 밖 기한을 거부한다", () => {
    const s = setup();
    seeded(s);
    const bad: [unknown, RegExp][] = [
      [ok({ key: "builder-9" }), /항목이 없다/],
      [ok({ reason: "자세한 것은 https://x.test 참고" }), /주소/],
      [ok({ reason: "가".repeat(121) }), /121자/],
      [ok({ fields: { title: `토큰 ghp_${"a".repeat(36)}` } }), /토큰/],
      [ok({ fields: { title: "가".repeat(61) } }), /자다/],
      [ok({ fields: { sources: [] } }), /고칠 수 없다/],
      [ok({ fields: { dueDate: "2030-01-01" } }), /까지여야/],
    ];
    for (const [input, re] of bad) {
      const r = correct(s, input);
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, re);
    }
    assert.equal(builderItemsOfDate(s.db, TARGET)[0]!.title, "가짜 제목");
  });
});

describe("4.5-3 비공개 값 검사", () => {
  test("원문 파일, 후보 파일, 빌더 백업 파일이 결과물 검사에 걸리고 사이트 데이터 파일은 걸리지 않는다", () => {
    const out = tempDir();
    fs.mkdirSync(path.join(out, "builder-raw", "openai-pricing"), { recursive: true });
    fs.writeFileSync(path.join(out, "builder-raw", "openai-pricing", "2026-10-28-0123abcd.md.gz"), "x");
    fs.writeFileSync(path.join(out, "2026-10-28-0123abcd.md.gz"), "x");
    fs.writeFileSync(path.join(out, "builder.candidates.json"), "{}");
    fs.writeFileSync(path.join(out, "builder.candidates.md"), "x");
    fs.writeFileSync(path.join(out, "builder.items.json"), "{}");
    fs.writeFileSync(path.join(out, "builder.json"), "{}");
    fs.writeFileSync(path.join(out, "builder-items-2026.json"), "{}");
    const f = checkOutput(out, null).findings;
    const of = (name: string) => f.filter((x) => x.where === name).map((x) => x.kind);
    assert.ok(of("builder-raw/openai-pricing/2026-10-28-0123abcd.md.gz").includes("빌더 원문 파일"));
    assert.ok(of("2026-10-28-0123abcd.md.gz").includes("빌더 원문 파일"));
    for (const n of ["builder.candidates.json", "builder.candidates.md", "builder.items.json"]) assert.ok(of(n).includes("빌더 작업 파일"), n);
    assert.deepEqual(of("builder.json"), ["백업 파일 이름"]);
    assert.deepEqual(of("builder-items-2026.json"), []);
    assert.ok(BACKUP_NAME_RE.test("builder.json"));
  });

  test("공개 전 점검이 원문·후보 파일을 거부하고 data 브랜치의 builder.json을 통과시킨다", () => {
    assert.deepEqual(nameKinds("builder.items.json"), ["빌더 작업 파일"]);
    const repo = tempRepo();
    gitIn(repo, "config", "user.email", REPO_NOREPLY);
    fs.writeFileSync(path.join(repo, "builder.json"), '{"formatVersion":7}\n');
    gitIn(repo, "add", "builder.json");
    gitIn(repo, "commit", "-q", "-m", "data");
    const clean = precheck({ repo, commits: [], trackedFiles: true, home: null }).findings;
    assert.ok(!clean.some((x) => x.where.includes("builder.json")), JSON.stringify(clean));
    fs.mkdirSync(path.join(repo, "builder-raw"));
    fs.writeFileSync(path.join(repo, "builder-raw", "2026-10-28-0123abcd.md.gz"), "x");
    fs.writeFileSync(path.join(repo, "builder.candidates.json"), "{}");
    gitIn(repo, "add", "-f", ".");
    gitIn(repo, "commit", "-q", "-m", "oops");
    const bad = precheck({ repo, commits: [], trackedFiles: true, home: null }).findings.map((x) => x.kind);
    assert.ok(bad.includes("빌더 원문 파일"));
    assert.ok(bad.includes("빌더 작업 파일"));
  });
});
