import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { BACKUP_FORMAT_VERSION, buildBackup, restoreBackup } from "../src/backup.ts";
import { main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import type { SiteBuilder } from "../src/publish.ts";
import { readRun } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import type { MonthList, VideoPartFile } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { DEFAULT_SOURCE_REL, allVideoDays, dailyAverage, pickVideos, readSource, saveVideoDay, type VideoItem } from "../src/weeklyVideos.ts";
import { NOW, PROJECT_ROOT, cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";
import { FAKE_REASON, FakeSource, sourceEnv } from "./videoSource.ts";

after(cleanupTemp);

// B2단계 영상 고르기·저장·백업(명세서 4.1, 4.2). 원천 DB는 youtube-insight 모양의 지어낸 SQLite 파일이다(test/videoSource.ts).
// 기준 시각은 NOW(2026-10-28T00:00Z)이고 업로드 경계는 그 7×24시간 전(2026-10-21T00:00Z)이다.

const DATE = "2026-10-27";
const EDU = "교양/지식";
const ECON = "경제";
const SOC = "사회";
const OBS = "2026-10-27T21:00:00+00:00";
const FROM = "2026-10-21T00:00:00.000Z";

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

interface Setup {
  repo: string;
  dataDir: string;
  dbPath: string;
  runFile: string;
  env: NodeJS.ProcessEnv;
  sourceFile: string;
}

/** 데이터 폴더 지정 실행: 브리프 날짜들을 저장하고 start. 원천 DB 경로는 지어낸 파일(없을 수도 있다) */
function setup(dates: string[] = [DATE], opts: { sourceFile?: string; repo?: string; dataDir?: string; env?: NodeJS.ProcessEnv } = {}): Setup {
  const repo = opts.repo ?? tempRepo();
  const dataDir = opts.dataDir ?? tempDir();
  const dbPath = path.join(dataDir, "tidwyn.db");
  if (dates.length > 0) {
    const db = openDb(dbPath);
    recordFirstCollectionDate(db, dates[0]!);
    for (const d of dates) addBrief(db, d);
    db.close();
  }
  const sourceFile = opts.sourceFile ?? path.join(tempDir(), "youtube.sqlite");
  const env = sourceEnv(sourceFile, { TIDWYN_DATA_DIR: dataDir, ...opts.env });
  const ctx = makeCtx(repo, env);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  return { repo, dataDir, dbPath, runFile: /실행 기록: (.+)/.exec(ctx.text())![1]!, env, sourceFile };
}

function pick(s: Setup, extra: string[] = [], env: NodeJS.ProcessEnv = s.env): { code: number; text: string } {
  const ctx = makeCtx(s.repo, env);
  const code = main(["video-pick", "--run", s.runFile, ...extra], ctx);
  return { code, text: ctx.text() };
}

function withDb<T>(s: Setup, f: (db: DatabaseSync) => T): T {
  const db = openDb(s.dbPath);
  try {
    return f(db);
  } finally {
    db.close();
  }
}

function dayRows(s: Setup): { date: string; status: string }[] {
  return withDb(s, (db) => (db.prepare("SELECT date, status FROM watch_days ORDER BY date").all() as { date: string; status: string }[]).map((r) => ({ ...r })));
}

function itemCount(s: Setup): number {
  return withDb(s, (db) => (db.prepare("SELECT COUNT(*) AS n FROM watch_items").get() as { n: number }).n);
}

/** 하루 평균이 정해진 값이 되게 영상을 만든다(업로드 = 관측 − 2일, 조회수 = avg × 2) */
function byAvg(src: FakeSource, id: string, avg: number, category: string, extra: { live?: boolean; title?: string; channel?: string } = {}): void {
  src.passed({ id, uploadAt: "2026-10-25T21:00:00+00:00", observedAt: OBS, views: avg * 2, category, ...extra });
}

function simpleSource(file: string, n = 3, category = EDU): FakeSource {
  const src = new FakeSource(file);
  for (let i = 1; i <= n; i++) byAvg(src, `v${String(i).padStart(2, "0")}`, 1000 - i, category);
  src.run(DATE);
  return src;
}

const sha = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

const ids = (items: VideoItem[], category?: string) => items.filter((i) => category === undefined || i.category === category).map((i) => i.id);

// ---- 4.1-1 영상 명령 ----

describe("B2 4.1-1 영상 명령", () => {
  test("정상 저장: 대상 날짜에 '실음'과 항목이 저장되고 다시 돌려도 행 수가 같다", () => {
    const s = setup();
    simpleSource(s.sourceFile).close();
    const r = pick(s);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /영상\(2026-10-27\): 실음 3개\(기준 시각 2026-10-28T09:00:00\+09:00, 교양\/지식 3\)/);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "shown" }]);
    assert.equal(itemCount(s), 3);
    const again = pick(s);
    assert.match(again.text, /이미 끝남\(실음\)/);
    assert.equal(itemCount(s), 3);
    assert.deepEqual(readRun(s.runFile).videos, { status: "done", date: DATE, recorded: "shown" });
  });

  for (const done of ["shown", "none"] as const) {
    test(`그 날짜가 이미 ${done === "shown" ? "실음" : "새 영상 없음"}이면 원천 DB를 열지 않고 이미 끝남을 출력한다`, () => {
      const s = setup();
      withDb(s, (db) => saveVideoDay(db, DATE, done, []));
      // 원천 DB가 없는 경로다. 열려고 했다면 받지 못함이 되었을 것이다
      const r = pick(s);
      assert.equal(r.code, 0);
      assert.match(r.text, /이미 끝남/);
      assert.ok(!fs.existsSync(s.sourceFile), "원천 DB 파일을 만들지 않았다");
      assert.deepEqual(dayRows(s), [{ date: DATE, status: done }]);
    });
  }

  test("저장된 브리프가 없으면 대상 없음이다", () => {
    const s = setup([]);
    simpleSource(s.sourceFile).close();
    const r = pick(s);
    assert.equal(r.code, 0);
    assert.match(r.text, /영상: 대상 없음/);
    assert.deepEqual(readRun(s.runFile).videos, { status: "noTarget" });
  });

  test("대상 날짜는 가장 늦은 저장된 브리프 날짜이고 앞 날짜에는 기록이 생기지 않는다", () => {
    const s = setup(["2026-10-25", "2026-10-26", DATE]);
    simpleSource(s.sourceFile).close();
    pick(s);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "shown" }]);
  });

  test("받지 못함인 날짜는 같은 날짜로 다시 돌리면 다시 고른다", () => {
    const s = setup();
    const r1 = pick(s);
    assert.match(r1.text, /받지 못함\(원천 DB가 없다/);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "failed" }]);
    simpleSource(s.sourceFile).close();
    const r2 = pick(s);
    assert.match(r2.text, /실음 3개/);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "shown" }]);
    assert.equal(itemCount(s), 3);
  });

  test("--at이 기준 시각을 바꾸고, 읽을 수 없는 값은 사용법 오류다", () => {
    const s = setup();
    simpleSource(s.sourceFile).close();
    // 영상 업로드(2026-10-25T21:00Z)가 기준 시각의 7일 전보다 앞서면 새 영상 없음
    const r = pick(s, ["--at", "2026-11-05T00:00:00Z"]);
    assert.match(r.text, /새 영상 없음\(기준 시각 2026-11-05T09:00:00\+09:00\)/);
    const s2 = setup();
    assert.equal(pick(s2, ["--at", "not-a-time"]).code, 2);
  });
});

// ---- 4.1-2 고르기 규칙 ----

function readAndPick(file: string, shown: Set<string> = new Set(), home: string | null = null, at = NOW): VideoItem[] {
  const r = readSource(file, at);
  assert.ok(r.ok, r.ok ? "" : r.reason);
  return pickVideos(r.rows, { at, shown, home }).items;
}

describe("B2 4.1-2 고르기 규칙", () => {
  test("분야마다 하루 평균 순 최대 10개: 11번째는 빠지고 10번째는 남는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    for (let i = 1; i <= 11; i++) byAvg(src, `e${String(i).padStart(2, "0")}`, 2000 - i * 10, EDU);
    src.close();
    const items = readAndPick(file);
    assert.deepEqual(ids(items), ["e01", "e02", "e03", "e04", "e05", "e06", "e07", "e08", "e09", "e10"]);
    assert.deepEqual(items.map((i) => i.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("라이브 다시보기는 빠지고 아닌 것은 남는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    byAvg(src, "live1", 9000, ECON, { live: true });
    byAvg(src, "vod1", 100, ECON);
    src.close();
    assert.deepEqual(ids(readAndPick(file)), ["vod1"]);
  });

  test("7일 경계: 경계 직전은 빠지고 경계 시각은 남으며, 기준 시각보다 늦은 업로드도 남는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    src.passed({ id: "edge", uploadAt: FROM, observedAt: OBS, views: 700, category: EDU });
    src.passed({ id: "before", uploadAt: "2026-10-20T23:59:59.000Z", observedAt: OBS, views: 9000, category: EDU });
    src.passed({ id: "future", uploadAt: "2026-10-28T03:00:00.000Z", observedAt: OBS, views: 500, category: EDU });
    src.close();
    assert.deepEqual(ids(readAndPick(file)).sort(), ["edge", "future"]);
  });

  test("7일 경계는 바꿔 넣은 기준 시각으로 잰다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    src.passed({ id: "old", uploadAt: "2026-10-10T00:00:00.000Z", observedAt: "2026-10-12T00:00:00.000Z", views: 700, category: EDU });
    src.close();
    assert.deepEqual(ids(readAndPick(file)), []);
    assert.deepEqual(ids(readAndPick(file, new Set(), null, new Date("2026-10-15T00:00:00Z"))), ["old"]);
  });

  test("전에 실린 영상 ID는 빠지고 처음 보는 ID는 남는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    byAvg(src, "seen1", 900, EDU);
    byAvg(src, "new1", 100, EDU);
    src.close();
    assert.deepEqual(ids(readAndPick(file, new Set(["seen1"]))), ["new1"]);
  });

  // youtube-insight v5에서는 영상 하나에 분야 하나라 원천에서 생길 수 없지만, 고르기 규칙(V8)은 남겨 두어 원천 행을 직접 늘려 시험한다
  const withSecond = (file: string, id: string, category: string) => {
    const r = readSource(file, NOW);
    assert.ok(r.ok, r.ok ? "" : r.reason);
    return [...r.rows, { ...r.rows.find((x) => x.videoId === id)!, category }];
  };

  test("두 분야에 통과한 영상은 순위가 높은 분야 하나에만 나오고, 다른 분야는 다음 영상으로 채운다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    // dual은 경제에서 1위, 교양/지식에서 2위 → 경제
    byAvg(src, "e-top", 5000, EDU);
    byAvg(src, "dual", 4000, EDU);
    byAvg(src, "e-3", 100, EDU);
    byAvg(src, "c-2", 50, ECON);
    src.close();
    const items = pickVideos(withSecond(file, "dual", ECON), { at: NOW, shown: new Set(), home: null }).items;
    assert.deepEqual(ids(items, EDU), ["e-top", "e-3"]);
    assert.deepEqual(ids(items, ECON), ["dual", "c-2"]);
    assert.equal(items.filter((i) => i.id === "dual").length, 1);
    assert.deepEqual(items.find((i) => i.id === "e-3")!.rank, 2, "다음 영상이 순위를 채운다");
  });

  test("두 분야의 순위가 같으면 분야 순서가 앞인 분야에 둔다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    byAvg(src, "tie", 4000, SOC);
    byAvg(src, "s-2", 10, SOC);
    src.close();
    const items = pickVideos(withSecond(file, "tie", ECON), { at: NOW, shown: new Set(), home: null }).items;
    assert.deepEqual(ids(items, ECON), ["tie"]);
    assert.deepEqual(ids(items, SOC), ["s-2"]);
  });

  test("분야는 판정이 아니라 영상의 분야(videos.category)로 본다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    byAvg(src, "v1", 100, ECON);
    // v5는 트리거로 둘을 늘 맞추지만, 읽는 쪽이 어느 칸을 보는지 가리려고 트리거를 걷고 영상의 분야만 바꾼다
    src.db.exec("DROP TRIGGER videos_category_update");
    src.db.prepare("UPDATE videos SET category = ? WHERE video_id = 'v1'").run(SOC);
    src.close();
    const items = readAndPick(file);
    assert.deepEqual(items.map((i) => [i.id, i.category]), [["v1", SOC]]);
  });

  test("제외·취소된 판정과 판정 안 된 영상은 고르지 않는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    src.video({ id: "rej", uploadAt: "2026-10-25T00:00:00Z" }).snap("rej", DATE, 9000, OBS).judge("rej", false);
    src.video({ id: "flip", uploadAt: "2026-10-25T00:00:00Z" }).snap("flip", DATE, 9000, OBS).judge("flip", true).judge("flip", false);
    src.video({ id: "canc", uploadAt: "2026-10-25T00:00:00Z" }).snap("canc", DATE, 9000, OBS).judge("canc", true, "added").judge("canc", false, "cancelled");
    src.video({ id: "none", uploadAt: "2026-10-25T00:00:00Z" }).snap("none", DATE, 9000, OBS);
    src.video({ id: "added", uploadAt: "2026-10-25T00:00:00Z" }).snap("added", DATE, 10, OBS).judge("added", true, "added");
    src.close();
    assert.deepEqual(ids(readAndPick(file)), ["added"]);
  });

  test("스냅샷이 여럿이면 수집일이 가장 늦은 것을 쓰고, 스냅샷이 없는 통과 영상은 빠진다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    src.video({ id: "multi", uploadAt: "2026-10-24T00:00:00Z" }).judge("multi", true);
    src.snap("multi", "2026-10-25", 100, "2026-10-25T20:00:00Z").snap("multi", "2026-10-27", 900, "2026-10-27T20:00:00Z").snap("multi", "2026-10-26", 500, "2026-10-26T20:00:00Z");
    src.video({ id: "nosnap", uploadAt: "2026-10-24T00:00:00Z" }).judge("nosnap", true);
    src.close();
    const items = readAndPick(file);
    assert.deepEqual(ids(items), ["multi"]);
    assert.equal(items[0]!.views, 900);
  });

  test("하루 평균은 1일 하한이 있고 날 수는 내림하지 않는다", () => {
    assert.equal(dailyAverage(1000, "2026-10-27T19:00:00Z", "2026-10-27T21:00:00Z"), 1000);
    assert.equal(dailyAverage(1500, "2026-10-26T09:00:00Z", "2026-10-27T21:00:00Z"), 1000);
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    // 2시간 전 업로드 1000회 → 1000(하한 1일). 1.5일 전 1400회 → 933.3. 날 수를 내림하면 1400이 되어 순서가 바뀐다
    src.passed({ id: "fresh", uploadAt: "2026-10-27T19:00:00Z", observedAt: OBS, views: 1000, category: EDU });
    src.passed({ id: "half", uploadAt: "2026-10-26T09:00:00Z", observedAt: OBS, views: 1400, category: EDU });
    src.close();
    const items = readAndPick(file);
    assert.deepEqual(ids(items), ["fresh", "half"]);
    // 고른 때의 하루 평균(반올림)을 항목에 담는다('모든 분야'의 순서)
    assert.deepEqual(items.map((i) => i.dailyViews), [1000, 933]);
  });

  test("결과물 검사에 걸리는 제목이나 채널 이름의 영상은 건너뛰고 다음 영상으로 채운다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    const home = "/home/faketester";
    byAvg(src, "badtitle", 900, EDU, { title: "설정 메모 /home/faketester/notes 정리" });
    byAvg(src, "badchan", 800, EDU, { channel: "채널 /home/faketester/ch" });
    byAvg(src, "ok1", 700, EDU);
    for (let i = 2; i <= 11; i++) byAvg(src, `ok${i}`, 700 - i, EDU);
    src.close();
    const r = readSource(file, NOW);
    assert.ok(r.ok);
    const p = pickVideos(r.rows, { at: NOW, shown: new Set(), home });
    assert.deepEqual(ids(p.items), ["ok1", "ok2", "ok3", "ok4", "ok5", "ok6", "ok7", "ok8", "ok9", "ok10"]);
    assert.equal(p.skipped, 2);
    // 검사에 걸리지 않으면(홈 경로를 모르면) 그대로 고른다
    assert.deepEqual(ids(pickVideos(r.rows, { at: NOW, shown: new Set(), home: null }).items).slice(0, 2), ["badtitle", "badchan"]);
  });

  test("분야 순서는 정해진 일곱이 앞이고 모르는 분야 이름은 뒤에 이름순이다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    const src = new FakeSource(file);
    byAvg(src, "x1", 10, "가짜분야");
    byAvg(src, "x2", 20, "Zfake");
    byAvg(src, "x3", 30, SOC);
    byAvg(src, "x4", 40, EDU);
    byAvg(src, "x5", 50, "AI/테크");
    src.close();
    assert.deepEqual([...new Set(readAndPick(file).map((i) => i.category))], [EDU, "AI/테크", SOC, "Zfake", "가짜분야"]);
  });

  test("CLI로 고른 결과도 같은 규칙이다(전에 실린 영상은 다음 날짜에 다시 오지 않는다)", () => {
    const s = setup(["2026-10-26"]);
    simpleSource(s.sourceFile, 12).close();
    pick(s);
    assert.equal(itemCount(s), 10);
    const s2 = setup([DATE], { repo: s.repo, dataDir: s.dataDir, sourceFile: s.sourceFile });
    pick(s2);
    const days = withDb(s2, (db) => allVideoDays(db));
    assert.deepEqual(ids(days.find((d) => d.date === DATE)!.items), ["v11", "v12"]);
  });
});

// ---- 4.1-3 준비 확인 ----

describe("B2 4.1-3 준비 확인", () => {
  test("원천 DB가 없으면 받지 못함(원천 DB가 없다)", () => {
    const s = setup();
    pick(s);
    const v = readRun(s.runFile).videos;
    assert.ok(v?.status === "failed" && /원천 DB가 없다/.test(v.reason), JSON.stringify(v));
  });

  test("원천 DB가 잠겨 열 수 없으면 짧게 기다린 뒤 받지 못함이고 원천은 바뀌지 않는다", () => {
    const file = path.join(tempDir(), "s.sqlite");
    simpleSource(file).close();
    const before = sha(file);
    const writer = new DatabaseSync(file);
    writer.exec("BEGIN EXCLUSIVE");
    try {
      const t0 = Date.now();
      const r = readSource(file, NOW, 200);
      assert.ok(!r.ok && /원천 DB를 (열|읽을) 수 없다/.test(r.reason), JSON.stringify(r));
      assert.ok(Date.now() - t0 < 5000, "몇 초 안에 끝난다");
    } finally {
      writer.exec("ROLLBACK");
      writer.close();
    }
    assert.equal(sha(file), before);
  });

  test("필요한 칸이 없으면 받지 못함(구조가 다르다)이고, 쓰지 않는 칸을 더한 원천은 정상이다", () => {
    const missing = path.join(tempDir(), "m.sqlite");
    const m = new FakeSource(missing, { drop: "was_live" });
    m.close();
    const r = readSource(missing, NOW);
    assert.ok(!r.ok && /구조가 다르다\(없는 것: videos\.was_live\)/.test(r.reason), JSON.stringify(r));
    const extra = path.join(tempDir(), "e.sqlite");
    const e = simpleSource(extra);
    e.db.exec("ALTER TABLE videos ADD COLUMN made_up_extra TEXT");
    e.close();
    assert.equal(readAndPick(extra).length, 3);
  });

  test("보기 current_passed가 없으면 받지 못함이다", () => {
    const file = path.join(tempDir(), "v.sqlite");
    const src = simpleSource(file);
    src.db.exec("DROP VIEW current_passed");
    src.close();
    const r = readSource(file, NOW);
    assert.ok(!r.ok && /없는 것: current_passed/.test(r.reason), JSON.stringify(r));
  });

  test("CLI: 받지 못한 이유는 경우마다 다르게 실행 기록에 남는다", () => {
    const reasons: string[] = [];
    const none = setup();
    pick(none);
    const bad = setup();
    new FakeSource(bad.sourceFile, { drop: "upload_at" }).close();
    pick(bad);
    for (const s of [none, bad]) {
      const v = readRun(s.runFile).videos;
      assert.ok(v?.status === "failed");
      reasons.push(v.reason);
    }
    assert.match(reasons[0]!, /원천 DB가 없다/);
    assert.match(reasons[1]!, /구조가 다르다\(없는 것: videos\.upload_at\)/);
  });

  test("후보가 0개면 새 영상 없음이다", () => {
    const s = setup();
    const src = new FakeSource(s.sourceFile);
    byAvg(src, "live", 10, EDU, { live: true });
    src.close();
    assert.match(pick(s).text, /새 영상 없음/);
    assert.deepEqual(dayRows(s), [{ date: DATE, status: "none" }]);
  });

  test("runs가 비었거나 마지막 수집이 오래돼도 7일 안의 통과 영상이 있으면 실음이고, 판정이 일부만 있으면 통과한 것만 고른다", () => {
    const s = setup();
    const src = new FakeSource(s.sourceFile);
    byAvg(src, "p1", 100, EDU);
    src.video({ id: "unjudged", uploadAt: "2026-10-25T00:00:00Z" }).snap("unjudged", DATE, 99999, OBS);
    src.close();
    assert.match(pick(s).text, /실음 1개/);
    const s2 = setup();
    const src2 = new FakeSource(s2.sourceFile);
    byAvg(src2, "p2", 100, EDU);
    src2.run("2026-10-01");
    src2.close();
    assert.match(pick(s2).text, /실음 1개/);
  });

  test("실행 전후 원천 DB의 sha256이 같다(실음·새 영상 없음·구조가 다름)", () => {
    for (const make of [(f: string) => simpleSource(f), (f: string) => new FakeSource(f), (f: string) => new FakeSource(f, { drop: "duration" })]) {
      const s = setup();
      make(s.sourceFile).close();
      const before = sha(s.sourceFile);
      pick(s);
      assert.equal(sha(s.sourceFile), before);
      assert.ok(!fs.existsSync(`${s.sourceFile}-journal`) && !fs.existsSync(`${s.sourceFile}-wal`), "저널을 남기지 않는다");
    }
  });
});

// ---- 4.1-4 요약과 다음 단계 ----

function fakeBuilder(): SiteBuilder {
  return ({ inputDir, outDir }) => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(path.join(inputDir, "site-data"), path.join(outDir, "site-data"), { recursive: true });
    writeFakePublicFiles(outDir);
    return { ok: true };
  };
}

async function laterSteps(s: Setup): Promise<string> {
  for (const cmd of ["backup", "site"]) {
    const ctx = { ...makeCtx(s.repo, s.env), buildSite: fakeBuilder() };
    const code = await mainAsync([cmd, "--run", s.runFile], ctx);
    assert.equal(code, 0, `${cmd}: ${ctx.text()}`);
  }
  const ctx = makeCtx(s.repo, s.env);
  main(["summary", "--run", s.runFile], ctx);
  return ctx.text();
}

describe("B2 4.1-4 요약과 다음 단계", () => {
  test("받지 못함인 실행에서도 backup·site가 성공하고 요약에 영상 줄이 나온다", async () => {
    const s = setup();
    pick(s);
    const sum = await laterSteps(s);
    assert.match(sum, /- 영상\(2026-10-27\): 받지 못함\(원천 DB가 없다\(.+\)\), 기준 시각 2026-10-28T09:00:00\+09:00\. 같은 날짜로 다시 돌리면 다시 고른다/);
    assert.match(sum, /- 백업: 내보내기만 함/);
    assert.match(sum, /- 사이트 빌드: 브리프 날짜 1개/);
  });

  test("실음인 실행의 요약에 분야별 실은 수가 나온다", async () => {
    const s = setup();
    const src = simpleSource(s.sourceFile, 2);
    byAvg(src, "c1", 5, ECON);
    src.close();
    pick(s);
    const sum = await laterSteps(s);
    assert.match(sum, /- 영상\(2026-10-27\): 실음 3개, 기준 시각 2026-10-28T09:00:00\+09:00\n {2}- 분야별: 교양\/지식 2, 경제 1/);
  });

  test("영상 단계를 부르지 않은 실행의 요약은 '이번 실행에서 하지 않음'이다", () => {
    const s = setup();
    const ctx = makeCtx(s.repo, s.env);
    main(["summary", "--run", s.runFile], ctx);
    assert.match(ctx.text(), /- 영상: 이번 실행에서 하지 않음/);
  });

  test("배포만 실행의 요약에도 영상 줄이 있다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = openDb(path.join(dataDir, "tidwyn.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db, DATE);
    db.close();
    const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    assert.equal(main(["start", "--deploy-only"], ctx), 0, ctx.text());
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
    const c2 = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir });
    main(["summary", "--run", runFile], c2);
    assert.match(c2.text(), /- 영상: 배포만 실행이라 하지 않음/);
  });
});

// ---- 4.1-5 시험 모드와 테스트 도우미 ----

describe("B2 4.1-5 시험 모드와 테스트 도우미", () => {
  test("시험 모드(test)에서도 영상 명령이 지정한 원천 DB를 읽는다", () => {
    const repo = tempRepo();
    const sourceFile = path.join(tempDir(), "y.sqlite");
    simpleSource(sourceFile).close();
    const env = sourceEnv(sourceFile);
    const ctx = makeCtx(repo, env);
    assert.equal(main(["start", "test"], ctx), 0, ctx.text());
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
    const st = readRun(runFile);
    assert.equal(st.mode, "test");
    const db = openDb(st.dbPath);
    addBrief(db, DATE);
    db.close();
    const c2 = makeCtx(repo, env);
    assert.equal(main(["video-pick", "--run", runFile], c2), 0, c2.text());
    assert.match(c2.text(), /실음 3개/);
  });

  test("데이터 폴더 지정 실행(custom)에서도 읽는다", () => {
    const s = setup();
    simpleSource(s.sourceFile).close();
    assert.equal(readRun(s.runFile).mode, "custom");
    assert.match(pick(s).text, /실음 3개/);
  });

  test("테스트 도우미는 기본 경로를 쓰지 않고, 기본 경로를 주면 실패한다(실제 파일을 열지 않는다)", () => {
    const s = setup();
    assert.ok(s.env.TIDWYN_YOUTUBE_DB && s.env.TIDWYN_YOUTUBE_DB !== path.resolve(PROJECT_ROOT, DEFAULT_SOURCE_REL));
    assert.throws(() => sourceEnv(path.resolve(PROJECT_ROOT, DEFAULT_SOURCE_REL)), /실제 원천 DB/);
    assert.throws(() => sourceEnv(path.join(PROJECT_ROOT, "..", "youtube-insight", "data", "youtube.sqlite")), /실제 원천 DB/);
  });
});

// ---- 4.1-6 비공개 값 ----

function buildDataDir(s: Setup): string {
  const dataDir = path.join(tempDir(), "data");
  withDb(s, (db) => {
    for (const [rel, content] of buildSiteData(db)) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    fs.writeFileSync(path.join(dataDir, "search-records.json"), JSON.stringify(buildSearchRecords(db)));
  });
  return dataDir;
}

function allText(dir: string): string {
  const out: string[] = [];
  for (const f of fs.readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, String(f));
    if (fs.statSync(p).isFile()) out.push(fs.readFileSync(p, "utf8"));
  }
  return out.join("\n");
}

describe("B2 4.1-6 판정 이유·고르지 않은 영상·원천 경로는 공개 쪽에 없다", () => {
  test("지어낸 판정 이유와 고르지 않은 영상 제목이 백업 파일과 사이트 데이터·검색 레코드에 없다", async () => {
    const s = setup();
    const src = simpleSource(s.sourceFile, 2);
    src.passed({ id: "unpicked", title: "ZZ고르지않은영상제목", uploadAt: "2026-10-01T00:00:00Z", observedAt: OBS, views: 999999, category: EDU });
    src.close();
    pick(s);
    await laterSteps(s);
    const backup = allText(path.join(s.dataDir, "backup"));
    const site = allText(buildDataDir(s));
    for (const text of [backup, site]) {
      assert.ok(!text.includes(FAKE_REASON), "판정 이유가 없다");
      assert.ok(!text.includes("ZZ고르지않은영상제목"), "고르지 않은 영상이 없다");
      assert.ok(text.includes("지어낸 영상 v01"), "실린 영상은 있다");
    }
  });

  test("지어낸 원천 DB 경로(홈 경로 모양)는 받지 못한 이유로 실행 기록에만 있고 백업·사이트 데이터에는 없다", async () => {
    const s = setup([DATE], { sourceFile: "/home/faketester/secret-place/youtube.sqlite" });
    pick(s);
    const v = readRun(s.runFile).videos;
    assert.ok(v?.status === "failed" && v.reason.includes("faketester"), "이유는 실행 기록에 있다");
    await laterSteps(s);
    for (const text of [allText(path.join(s.dataDir, "backup")), allText(buildDataDir(s))]) assert.ok(!text.includes("faketester") && !text.includes("secret-place"));
  });
});

// ---- 4.2-1 백업과 복원 ----

function seedVideoDays(db: DatabaseSync): void {
  for (const d of ["2026-10-25", "2026-10-26", DATE]) addBrief(db, d);
  saveVideoDay(db, "2026-10-25", "failed", []);
  saveVideoDay(db, "2026-10-26", "none", []);
  saveVideoDay(db, DATE, "shown", [
    { id: "fakeAAAA001", category: EDU, rank: 1, title: "지어낸 강의 영상", channel: "지어낸 채널", duration: 3725, views: 123456, uploadAt: "2026-10-25T03:00:00.000Z", uploadPrecision: 86400, dailyViews: 41152 },
    { id: "fakeAAAA002", category: ECON, rank: 1, title: "지어낸 경제 해설", channel: "가짜 경제", duration: 612, views: 98000, uploadAt: "2026-10-25T03:00:00.000Z", uploadPrecision: 86400, dailyViews: 32667 },
  ]);
}

describe("B2 4.2-1 백업과 복원", () => {
  test("백업 → 복원 → 다시 백업의 내용이 같고 세 상태와 항목이 남는다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "a.db"));
    recordFirstCollectionDate(db, "2026-10-25");
    seedVideoDays(db);
    const files = buildBackup(db);
    const before = allVideoDays(db);
    db.close();
    assert.equal(BACKUP_FORMAT_VERSION, 13);
    assert.equal(JSON.parse(files.get("watch.json")!).formatVersion, 13);
    const out = path.join(dir, "b.db");
    restoreBackup(files, out);
    const r = openDb(out);
    assert.deepEqual(allVideoDays(r), before);
    assert.deepEqual(before.map((d) => d.status), ["failed", "none", "shown"]);
    assert.deepEqual(buildBackup(r), files);
    r.close();
  });

  test("기록이 없으면 watch.json을 쓰지 않는다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    addBrief(db, DATE);
    assert.ok(!buildBackup(db).has("watch.json"));
    db.close();
  });

  test("지어낸 받지 못한 이유는 백업에 없다", () => {
    const s = setup([DATE], { sourceFile: path.join(tempDir(), "ZZnoSuchSourceMarker", "y.sqlite") });
    pick(s);
    const files = withDb(s, (db) => buildBackup(db));
    assert.match(files.get("watch.json")!, /"status": "failed"/);
    for (const [name, text] of files) assert.ok(!text.includes("ZZnoSuchSourceMarker") && !text.includes("원천 DB가 없다"), name);
  });

  test("새 백업 파일 이름(watch.json)을 결과물에 넣으면 결과물 검사가 건다", () => {
    const out = tempDir();
    writeFakePublicFiles(out);
    fs.mkdirSync(path.join(out, "deep"));
    fs.writeFileSync(path.join(out, "deep", "watch.json"), "{}\n");
    assert.deepEqual(checkOutput(out, null).findings.map((f) => `${f.where} ${f.kind}`), ["deep/watch.json 백업 파일 이름"]);
  });

  test("바로 앞 형식(12)의 지어낸 백업이 오류 없이 영상 기록 없이 복원된다", () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "a.db"));
    recordFirstCollectionDate(db, DATE);
    addBrief(db, DATE);
    const files = new Map<string, string>();
    for (const [name, text] of buildBackup(db)) files.set(name, text.replaceAll(`"formatVersion": ${BACKUP_FORMAT_VERSION}`, '"formatVersion": 12'));
    db.close();
    assert.match(files.get("meta.json")!, /"formatVersion": 12/);
    const out = path.join(dir, "b.db");
    assert.deepEqual(restoreBackup(files, out), { dates: 1 });
    const r = openDb(out);
    assert.deepEqual(allVideoDays(r), []);
    r.close();
  });

  test("옛 DB(버전 16)를 업그레이드하면 기존 값이 그대로이고 새 표는 비며, 두 번 업그레이드해도 같다", () => {
    const file = path.join(tempDir(), "old.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 16));
    recordFirstCollectionDate(old, DATE);
    addBrief(old, DATE);
    old.prepare("INSERT INTO trend_repo_days (date, status) VALUES (?, 'none')").run(DATE);
    assert.equal(schemaVersion(old), 16);
    const dump = (db: DatabaseSync) => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[];
      return Object.fromEntries(tables.map((t) => [t.name, (db.prepare(`SELECT * FROM "${t.name}" ORDER BY rowid`).all() as object[]).map((r) => ({ ...r }))]));
    };
    const before = dump(old);
    old.close();
    const db = openDb(file);
    assert.equal(schemaVersion(db), 17);
    const after1 = dump(db);
    assert.deepEqual(after1.watch_days, []);
    assert.deepEqual(after1.watch_items, []);
    for (const [name, rows] of Object.entries(before)) assert.deepEqual(after1[name], rows, name);
    db.close();
    const again = openDb(file);
    assert.equal(schemaVersion(again), 17);
    assert.deepEqual(dump(again), after1);
    again.close();
  });
});

// ---- 사이트 데이터(화면은 사이트 쪽 테스트) ----

describe("B2 사이트 데이터의 날짜별 영상 기록", () => {
  test("달 목록에는 상태와 실은 수만, 항목은 반달 영상 파일에 있고 뉴스 수는 그대로다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    recordFirstCollectionDate(db, "2026-10-24");
    addBrief(db, "2026-10-24");
    const before = JSON.parse(buildSiteData(db).get("site-data/dates.json")!) as { storyCounts: number[] };
    seedVideoDays(db);
    const data = buildSiteData(db);
    db.close();
    const list = JSON.parse(data.get("site-data/list-2026-10.json")!) as MonthList;
    const by = new Map(list.days.map((d) => [d.date, d.videos]));
    assert.equal(by.get("2026-10-24"), undefined);
    assert.deepEqual(by.get("2026-10-25"), { status: "failed", count: 0 });
    assert.deepEqual(by.get("2026-10-26"), { status: "none", count: 0 });
    assert.deepEqual(by.get(DATE), { status: "shown", count: 2 });
    assert.ok(!data.get("site-data/list-2026-10.json")!.includes("지어낸 강의 영상"), "항목은 달 목록에 없다");
    const watch = JSON.parse(data.get("site-data/watch-2026-10-2.json")!) as VideoPartFile;
    assert.deepEqual(Object.keys(watch.days), ["2026-10-25", "2026-10-26", DATE]);
    assert.deepEqual(watch.days[DATE]!.items.map((i) => i.id), ["fakeAAAA001", "fakeAAAA002"]);
    const dates = JSON.parse(data.get("site-data/dates.json")!) as { storyCounts: number[] };
    assert.equal(dates.storyCounts.at(-1), before.storyCounts[0]);
  });

  test("검색 레코드: 실음인 날짜에만 영상 레코드(제목·채널)가 있고 결과 주소는 그 날짜의 영상 레코드다", () => {
    const db = openDb(path.join(tempDir(), "a.db"));
    recordFirstCollectionDate(db, "2026-10-25");
    seedVideoDays(db);
    const records = buildSearchRecords(db);
    db.close();
    const v = records.filter((r) => r.meta?.kind === "videos");
    assert.deepEqual(v.map((r) => [r.url, r.meta]), [[`/${DATE}/watch`, { kind: "videos", date: DATE }]]);
    for (const t of ["지어낸 강의 영상", "지어낸 채널", "지어낸 경제 해설", "가짜 경제"]) assert.ok(v[0]!.content.includes(t), t);
  });
});
