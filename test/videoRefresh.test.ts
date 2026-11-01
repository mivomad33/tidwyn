import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { createIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { addDays } from "../src/kst.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { REFRESH_UNITS, dueVideoIds, refreshBacklog } from "../src/videoRefresh.ts";
import { allVideos, applyVideoPick, isPicked, pickedVideoIds, type NewVideo } from "../src/videoStore.ts";
import type { YoutubeHttp } from "../src/youtube.ts";
import { NOW, cleanupTemp, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 9.6단계 4.1·4.2: 새로 받기와 30일 지우기. 영상 ID, 제목, 키는 모두 지어낸 것이다. YouTube는 가짜 응답으로 바꾼다.

const FAKE_YT = "FAKE-YOUTUBE-KEY-0042";
const TODAY = "2026-10-28"; // NOW의 KST 날짜
const daysAgo = (n: number) => addDays(TODAY, -n);

function video(videoId: string, position: number, issues: number[] = []): NewVideo {
  return { videoId, bundle: "kr", sources: ["KR 차트 27"], title: `옛 제목 ${videoId}`, channel: `옛 채널 ${videoId}`, seconds: 900, thumb: `https://i.example.com/old/${videoId}.jpg`, publishedAt: "2026-01-01T00:00:00Z", reason: `가짜 추천 이유 ${videoId}`, summary: `가짜 요약 ${videoId}`, position, issues };
}

/** 지어낸 브리프 날짜마다 영상을 넣는다. 받은 날은 영상별로 준다 */
function seed(db: DatabaseSync, date: string, fetchedOn: string, ids: string[], issues: number[] = []): void {
  applyVideoPick(db, date, fetchedOn, ids.map((id, i) => video(id, i + 1, issues)));
}

function flow(env: NodeJS.ProcessEnv = { YOUTUBE_API_KEY: FAKE_YT }, fill?: (db: DatabaseSync) => void) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, "2026-10-26");
  for (const d of ["2026-10-26", "2026-10-27"]) {
    const r = validateBrief(sampleBrief(d), d);
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
  }
  fill?.(db);
  db.close();
  const fullEnv = { ...env, TIDWYN_DATA_DIR: dataDir };
  const ctx = makeCtx(repo, fullEnv, NOW);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
  return { repo, dataDir, dbFile, env: fullEnv, runFile };
}

type F = ReturnType<typeof flow>;

async function refresh(f: F, http: YoutubeHttp, extra: Record<string, unknown> = {}): Promise<{ code: number; text: string }> {
  const ctx = { ...makeCtx(f.repo, f.env, NOW), youtubeHttp: http, youtubeRetryGapMs: 0, ...extra };
  const code = await mainAsync(["video-refresh", "--run", f.runFile], ctx);
  return { code, text: ctx.text() };
}

function record(f: F) {
  const db = openDb(f.dbFile);
  try {
    return allVideos(db);
  } finally {
    db.close();
  }
}

function item(id: string) {
  return {
    id,
    snippet: { title: `새 제목 ${id}`, channelTitle: `새 채널 ${id}`, publishedAt: "2026-02-02T00:00:00Z", description: `설명문자열 ${id}`, thumbnails: { medium: { url: `https://i.example.com/new/${id}.jpg` } } },
    contentDetails: { duration: "PT20M" },
    statistics: { viewCount: "987654321" },
  };
}

const idsOf = (url: string) => (new URL(url).searchParams.get("id") ?? "").split(",").filter((x) => x !== "");

/** 물은 영상을 모두 돌려주는 가짜. only가 있으면 그 호출의 응답을 바꾼다 */
function fake(only: (ids: string[], call: number) => { status?: number; body: string } | null = () => null) {
  const calls: string[][] = [];
  const http: YoutubeHttp = async (url) => {
    const ids = idsOf(url);
    calls.push(ids);
    const r = only(ids, calls.length);
    if (r) return { status: r.status ?? 200, body: r.body };
    return { status: 200, body: JSON.stringify({ items: ids.map(item) }) };
  };
  return { http, calls };
}

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(4, "0")}`);
const body = (o: unknown) => JSON.stringify(o);

describe("9.6단계 4.1 새로 받기", () => {
  test("4.1-1 6일 전 기록은 부르지 않고 7일 전 기록은 부른다. 120개는 3번의 호출이다", async () => {
    const f = flow(undefined, (db) => {
      seed(db, "2026-10-26", daysAgo(6), ["Recent6dayA"]);
      seed(db, "2026-10-27", daysAgo(7), ids("Due", 120));
    });
    const y = fake();
    const r = await refresh(f, y.http);
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(y.calls.map((c) => c.length), [50, 50, 20]);
    assert.ok(!y.calls.flat().includes("Recent6dayA"));
    assert.match(r.text, /- 새로 받기: 대상 120, 바꿈 120, 응답에 없어 지움 0, 쓴 단위 3, 남음 0/);
    assert.equal(readRun(f.runFile).videoRefresh?.units, 3);
    assert.equal(REFRESH_UNITS, 500);
  });

  test("4.1-1 상한을 낮추면 가장 오래된 것부터 상한만큼만 부르고 나머지는 남는다. 같은 영상이 여러 날짜에 있으면 모두 바꾼다", async () => {
    const f = flow(undefined, (db) => {
      seed(db, "2026-10-26", daysAgo(20), [...ids("Old", 60), "SameTwoDays"]);
      seed(db, "2026-10-27", daysAgo(10), [...ids("New", 60), "SameTwoDays"]);
    });
    const y = fake();
    const r = await refresh(f, y.http, { youtubeRefreshUnits: 1 });
    assert.deepEqual(y.calls.length, 1);
    assert.ok(y.calls[0]!.every((id) => id.startsWith("Old")), "받은 날이 가장 앞선 것부터");
    assert.match(r.text, /대상 121, 바꿈 50, 응답에 없어 지움 0, 쓴 단위 1, 남음 71/);
    assert.match(r.text, /상한\(500단위\)에 닿아/);
    const g = flow(undefined, (db) => {
      seed(db, "2026-10-26", daysAgo(20), ["SameTwoDays"]);
      seed(db, "2026-10-27", daysAgo(10), ["SameTwoDays"]);
    });
    await refresh(g, fake().http);
    const rows = record(g);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((v) => v.fetchedOn === TODAY && v.title === "새 제목 SameTwoDays"));
  });

  test("4.1-2 YouTube 항목과 받은 날만 바뀌고 Tidwyn 글·연결은 그대로이며, 옛 값과 설명·조회수가 DB 파일 바이트에 없다", async () => {
    const f = flow(undefined, (db) => {
      const s = storiesOfDate(db, "2026-10-27")[0]!;
      const issue = createIssue(db, { name: "가짜 이슈", aliases: [], category: { major: "과학·건강", minor: "우주" }, summary: "가짜 요약이다." });
      linkStory(db, s.id, issue, true);
      seed(db, "2026-10-27", daysAgo(9), ids("Row", 110), [issue]);
    });
    const before = record(f);
    await refresh(f, fake().http);
    const rows = record(f);
    assert.equal(rows.length, 110);
    for (const [i, v] of rows.entries()) {
      const b = before[i]!;
      assert.deepEqual(
        { title: v.title, channel: v.channel, seconds: v.seconds, thumb: v.thumb, publishedAt: v.publishedAt, fetchedOn: v.fetchedOn },
        { title: `새 제목 ${b.videoId}`, channel: `새 채널 ${b.videoId}`, seconds: 1200, thumb: `https://i.example.com/new/${b.videoId}.jpg`, publishedAt: "2026-02-02T00:00:00Z", fetchedOn: TODAY },
      );
      assert.deepEqual({ reason: v.reason, summary: v.summary, bundle: v.bundle, sources: v.sources, issues: v.issues, briefDate: v.briefDate, position: v.position }, { reason: b.reason, summary: b.summary, bundle: b.bundle, sources: b.sources, issues: b.issues, briefDate: b.briefDate, position: b.position });
    }
    const bytes = fs.readFileSync(f.dbFile);
    for (const old of ["옛 제목 Row0000", "옛 채널 Row0050", "old/Row0109", "설명문자열", "987654321"]) assert.ok(!bytes.includes(old), old);
  });

  test("4.1-3 응답에 없는 영상은 기록과 이슈 연결을 지우고 ID가 파일 바이트에 없으며, 고르기 끝남은 남는다", async () => {
    let issue = 0;
    const f = flow(undefined, (db) => {
      const s = storiesOfDate(db, "2026-10-27")[0]!;
      issue = createIssue(db, { name: "가짜 이슈", aliases: [], category: { major: "과학·건강", minor: "우주" }, summary: "가짜 요약이다." });
      linkStory(db, s.id, issue, true);
      seed(db, "2026-10-27", daysAgo(9), [...ids("Row", 110), "GoneVideo01"], [issue]);
    });
    const r = await refresh(f, fake((asked) => ({ body: body({ items: asked.filter((id) => id !== "GoneVideo01").map(item) }) })).http);
    assert.match(r.text, /대상 111, 바꿈 110, 응답에 없어 지움 1/);
    const rows = record(f);
    assert.equal(rows.length, 110);
    assert.ok(!fs.readFileSync(f.dbFile).includes("GoneVideo01"));
    const db = openDb(f.dbFile);
    assert.equal(isPicked(db, "2026-10-27"), true);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM video_issues").get() as { n: number }).n, 110);
    db.close();
  });

  test("4.1-2 둘째 호출의 쓰기가 실패해도 앞 호출의 결과가 남고 옛 값을 다시 쓴다", async () => {
    const list = ids("Row", 120);
    const f = flow(undefined, (db) => {
      seed(db, "2026-10-27", daysAgo(9), list);
      db.exec(`CREATE TRIGGER stop_write BEFORE UPDATE ON videos WHEN OLD.video_id = '${list[60]}' BEGIN SELECT RAISE(ABORT, '가짜 쓰기 실패'); END`);
    });
    const r = await refresh(f, fake().http);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /대상 120, 바꿈 50, 응답에 없어 지움 0, 쓴 단위 2, 남음 70/);
    assert.match(r.text, /실패\(다음 실행이 다시 한다\): .*가짜 쓰기 실패/);
    assert.ok(!fs.readFileSync(f.dbFile).includes("옛 제목 Row0000"), "앞 호출의 옛 값");
  });

  test("4.1-2 지우기가 실패해 다시 실행하면 바꿀 것이 없어도 옛 값을 다시 쓴다", async () => {
    const f = flow(undefined, (db) => {
      seed(db, "2026-10-26", daysAgo(40), ["StuckVid001"]);
      seed(db, "2026-10-27", daysAgo(9), ids("Row", 110));
    });
    // 실행 전 사본에는 넣지 않으려고 start 뒤에 건다
    const locked = openDb(f.dbFile);
    locked.exec("CREATE TRIGGER stop_purge BEFORE DELETE ON videos WHEN OLD.video_id = 'StuckVid001' BEGIN SELECT RAISE(ABORT, '가짜 지우기 실패'); END");
    locked.close();
    const http = fake((asked) => (asked.includes("StuckVid001") ? { body: body({ items: asked.map((id) => (id === "StuckVid001" ? { ...item(id), contentDetails: {} } : item(id))) }) } : null)).http;
    const failed = await refresh(f, http);
    assert.notEqual(failed.code, 0, failed.text);
    assert.ok(fs.readFileSync(f.dbFile).includes("옛 제목 Row0000"), "아직 다시 쓰지 못했다");
    const db = openDb(f.dbFile);
    db.exec("DROP TRIGGER stop_purge");
    db.prepare("DELETE FROM videos WHERE video_id = 'StuckVid001'").run();
    db.close();
    const again = await refresh(f, fake().http);
    assert.equal(again.code, 0, again.text);
    assert.ok(!fs.readFileSync(f.dbFile).includes("옛 제목 Row0000"));
  });

  test("4.1-4 빈 응답 하나는 적용하지 않고 경고한다. 가운데 호출만 비면 그 50개만 그대로다", async () => {
    const one = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ids("Row", 10)));
    const r = await refresh(one, fake(() => ({ body: body({ items: [] }) })).http);
    assert.equal(r.code, 0);
    assert.match(r.text, /경고: 이상한 응답 1번, 영상 10개를 그대로 두었다/);
    assert.ok(record(one).every((v) => v.fetchedOn === daysAgo(9) && v.title.startsWith("옛 제목")));
    const three = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ids("Row", 120)));
    const y = fake((_, call) => (call === 2 ? { body: body({ items: [] }) } : null));
    await refresh(three, y.http);
    const middle = new Set(y.calls[1]!);
    for (const v of record(three)) assert.equal(v.fetchedOn, middle.has(v.videoId) ? daysAgo(9) : TODAY, v.videoId);
  });

  test("4.1-4 경계: 4개 없음과 10개 중 5개 없음은 지운다(9개 중 5개 없음은 이상), 같은 ID가 겹쳐도 하나로 센다", async () => {
    for (const [total, gone, removed] of [[50, 4, 4], [10, 5, 5], [9, 5, 0], [50, 25, 25], [50, 26, 0]] as const) {
      const all = ids("Row", total);
      const f = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), all));
      const r = await refresh(f, fake((asked) => ({ body: body({ items: asked.slice(gone).map(item) }) })).http);
      assert.equal(readRun(f.runFile).videoRefresh?.removed, removed, `${total}개 중 ${gone}개 없음: ${r.text}`);
      assert.equal(record(f).length, total - removed);
    }
    const f = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ids("Row", 10)));
    const dup = await refresh(f, fake((asked) => ({ body: body({ items: [...asked.slice(5), ...asked.slice(5)].map(item) }) })).http);
    assert.equal(readRun(f.runFile).videoRefresh?.changed, 5, dup.text);
  });

  test("4.1-4 읽을 수 없는 항목은 지우지도 바꾸지도 않고 세며, {}와 ID 없는 항목은 호출 실패다", async () => {
    const f = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ["GoodVideo01", "BadVideo001", "BadVideo002", "BadVideo003"]));
    const r = await refresh(
      f,
      fake(() => ({
        body: body({
          items: [item("GoodVideo01"), { id: "BadVideo001" }, { ...item("BadVideo002"), contentDetails: { duration: "모름" } }, { ...item("BadVideo003"), snippet: { ...item("BadVideo003").snippet, title: "" } }],
        }),
      })).http,
    );
    assert.match(r.text, /대상 4, 바꿈 1, 응답에 없어 지움 0/);
    assert.match(r.text, /읽을 수 없어 그대로 둔 영상: 3개/);
    const rows = record(f);
    assert.equal(rows.length, 4);
    assert.equal(rows.filter((v) => v.fetchedOn === TODAY).length, 1);
    for (const bad of [{}, { items: "없음" }, { items: [item("One0000"), { snippet: {} }] }, { items: [null] }]) {
      const g = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ["One0000", "Two0000"]));
      const x = await refresh(g, fake(() => ({ body: body(bad) })).http);
      assert.equal(x.code, 0);
      assert.match(x.text, /실패\(다음 실행이 다시 한다\)/);
      assert.deepEqual(record(g).map((v) => v.fetchedOn), [daysAgo(9), daysAgo(9)], body(bad));
    }
  });

  test("4.1-5 40일 전 기록은 호출이 성공하면 살아남고, 호출 실패·키 없음이면 지워진다. 대상이 없어도 지우기가 돈다", async () => {
    const fill = (db: DatabaseSync) => seed(db, "2026-10-27", daysAgo(40), ["FortyDaysAA"]);
    const ok = flow(undefined, fill);
    await refresh(ok, fake().http);
    assert.deepEqual(record(ok).map((v) => v.fetchedOn), [TODAY]);
    const failed = flow(undefined, fill);
    const down = await refresh(failed, fake(() => ({ status: 403, body: body({ error: { errors: [{ reason: "quotaExceeded" }] } }) })).http);
    assert.equal(down.code, 0);
    assert.match(down.text, /할당량 초과/);
    assert.deepEqual(record(failed), []);
    const noKey = flow({}, fill);
    const k = await refresh(noKey, fake().http);
    assert.equal(k.code, 0);
    assert.match(k.text, /키 확인 필요/);
    assert.deepEqual(record(noKey), []);
    const none = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(3), ["ThreeDaysAA"]));
    fs.mkdirSync(path.join(none.dataDir, "work"), { recursive: true });
    fs.writeFileSync(path.join(none.dataDir, "work", "videos.pick.json"), "{}");
    const y = fake();
    const n = await refresh(none, y.http);
    assert.equal(y.calls.length, 0);
    assert.match(n.text, /대상 0/);
    assert.match(n.text, /- 30일 지난 영상 지움: 0개 \(그 밖에 지난 실행의 영상 작업 파일 1개\)/);
  });

  test("4.1-5 같은 실행에서 다시 불러도 이번 실행의 작업 파일을 지우지 않는다", async () => {
    const f = flow(undefined);
    await refresh(f, fake().http);
    fs.mkdirSync(path.join(f.dataDir, "work"), { recursive: true });
    const pick = path.join(f.dataDir, "work", "videos.pick.json");
    fs.writeFileSync(pick, "{}");
    const r = await refresh(f, fake().http);
    assert.equal(r.code, 0);
    assert.ok(fs.existsSync(pick), r.text);
  });

  test("4.1-6 일부 호출이 실패하면 성공한 것만 바뀌고 종료 코드는 0, 가짜 키를 되풀이하는 오류는 어디에도 나오지 않는다. 지우기가 실패하면 0이 아니다", async () => {
    const f = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ids("Row", 120)));
    const y = fake((_, call) => (call === 2 ? { status: 400, body: body({ error: { message: `bad key ${FAKE_YT}` } }) } : null));
    const r = await refresh(f, y.http);
    assert.equal(r.code, 0, r.text);
    assert.equal(y.calls.length, 2, "실패하면 남은 호출을 하지 않는다");
    assert.equal(record(f).filter((v) => v.fetchedOn === TODAY).length, 50);
    const leak = await mainFailingNetwork(f);
    assert.ok(!leak.includes(FAKE_YT));
    for (const text of [r.text, fs.readFileSync(f.runFile, "utf8")]) {
      assert.ok(!text.includes(FAKE_YT));
      assert.ok(!text.includes("Row0000"), "영상 ID가 나오지 않는다");
    }
    const broken = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(3), ["ThreeDaysAA"]));
    fs.rmSync(broken.dbFile);
    fs.mkdirSync(broken.dbFile);
    const b = await refresh(broken, fake().http);
    assert.notEqual(b.code, 0, b.text);
  });

  test("4.1-7 거르기는 받은 날과 관계없이 모든 기록으로 한다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    recordFirstCollectionDate(db, "2026-07-20");
    for (const d of ["2026-07-20", "2026-10-27"]) {
      const r = validateBrief(sampleBrief(d), d);
      assert.ok(r.ok);
      saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
    }
    seed(db, "2026-07-20", daysAgo(5), ["HundredDays"]);
    seed(db, "2026-10-27", daysAgo(40), ["FortyDaysAA"]);
    assert.deepEqual([...pickedVideoIds(db)].sort(), ["FortyDaysAA", "HundredDays"]);
    db.close();
  });
});

async function mainFailingNetwork(f: F): Promise<string> {
  const g = { ...f };
  const http: YoutubeHttp = async () => {
    throw new Error(`연결 실패 https://example.com/?key=${FAKE_YT}`);
  };
  const ctx = { ...makeCtx(g.repo, { ...g.env }, NOW), youtubeHttp: http, youtubeRetryGapMs: 0 };
  const start = makeCtx(g.repo, g.env, NOW);
  assert.equal(main(["start"], start), 0);
  const runFile = /실행 기록: (.+)/.exec(start.text())![1]!;
  await mainAsync(["video-refresh", "--run", runFile], ctx);
  return ctx.text() + fs.readFileSync(runFile, "utf8");
}

describe("9.6단계 4.2 지우기와 출력", () => {
  test("4.2-1 붙은 브리프 날짜가 3년 전이어도 받은 날이 5일 전이면 지우지 않는다", async () => {
    const f = flow(undefined, (db) => {
      const d = "2023-10-28";
      const r = validateBrief(sampleBrief(d), d);
      assert.ok(r.ok);
      saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
      seed(db, d, daysAgo(5), ["ThreeYearsA"]);
    });
    await refresh(f, fake().http);
    assert.deepEqual(record(f).map((v) => v.videoId), ["ThreeYearsA"]);
  });

  test("4.2-4 요약에 새로 받기 줄이 나오고 영상 ID가 없다", async () => {
    const f = flow(undefined, (db) => seed(db, "2026-10-27", daysAgo(9), ids("Row", 3)));
    await refresh(f, fake().http);
    const ctx = makeCtx(f.repo, f.env, NOW);
    assert.equal(main(["summary", "--run", f.runFile], ctx), 0);
    assert.match(ctx.text(), /- 새로 받기: 대상 3, 바꿈 3, 응답에 없어 지움 0, 쓴 단위 1, 남음 0/);
    assert.ok(!ctx.text().includes("Row0000"));
  });

  test("4.2-5 23일 전 기록이 남으면 요약에 경고하고 22일이면 내지 않는다", async () => {
    const summary = async (days: number) => {
      const f = flow({}, (db) => seed(db, "2026-10-27", daysAgo(days), ["BehindVideo"]));
      await refresh(f, fake().http);
      const ctx = makeCtx(f.repo, f.env, NOW);
      assert.equal(main(["summary", "--run", f.runFile], ctx), 0);
      return ctx.text();
    };
    assert.match(await summary(23), /- 새로 받기가 밀림: 1개, 가장 오래된 기록이 7일 뒤 지워짐/);
    assert.match(await summary(29), /가장 오래된 기록이 1일 뒤 지워짐/);
    assert.doesNotMatch(await summary(22), /새로 받기가 밀림/);
    const db = openDb(path.join(tempDir(), "t.db"));
    assert.equal(refreshBacklog(db, TODAY), null);
    db.close();
  });

  test("4.4-3 되돌리는 설정을 켜면 YouTube를 부르지 않고 30일 지우기대로 지우며 밀림 경고를 내지 않는다", async () => {
    const f = flow(undefined, (db) => {
      seed(db, "2026-10-26", daysAgo(40), ["FortyDaysAA"]);
      seed(db, "2026-10-27", daysAgo(25), ["TwentyFiveA"]);
    });
    const y = fake();
    const r = await refresh(f, y.http, { videoRefreshStopped: true });
    assert.equal(y.calls.length, 0);
    assert.match(r.text, /새로 받기: 멈춰 두었다/);
    assert.deepEqual(record(f).map((v) => v.videoId), ["TwentyFiveA"]);
    const ctx = { ...makeCtx(f.repo, f.env, NOW), videoRefreshStopped: true };
    assert.equal(main(["summary", "--run", f.runFile], ctx), 0);
    assert.doesNotMatch(ctx.text(), /새로 받기가 밀림/);
  });

  test("대상 목록은 받은 날이 가장 앞선 영상부터다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    recordFirstCollectionDate(db, "2026-10-26");
    for (const d of ["2026-10-26", "2026-10-27"]) {
      const r = validateBrief(sampleBrief(d), d);
      assert.ok(r.ok);
      saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
    }
    seed(db, "2026-10-26", daysAgo(8), ["Later000000"]);
    seed(db, "2026-10-27", daysAgo(12), ["Earlier0000"]);
    assert.deepEqual(dueVideoIds(db, TODAY), ["Earlier0000", "Later000000"]);
    db.close();
  });
});
