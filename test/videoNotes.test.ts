import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, restoreBackup } from "../src/backup.ts";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import type { GeminiClock, GeminiHttp, GeminiLimits, GeminiResponse, NotesFile } from "../src/gemini.ts";
import { secretValues } from "../src/keys.ts";
import { precheck } from "../src/precheck.ts";
import { readRun, writeRun, type RunState } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSiteData } from "../src/siteData.ts";
import type { DayList } from "../src/siteTypes.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { checkPickFile, removeVideoWorkFiles, videoWorkFile, writeCandidateFiles, type Candidate, type CandidateFile } from "../src/videoPick.ts";
import { allVideos, applyVideoPick, type NewVideo } from "../src/videoStore.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

// 8단계 영상 내용 확인(4.1~4.5). 영상 ID, 제목, 메모, 요약, 키는 모두 지어낸 것이다. Gemini는 가짜 응답으로 바꾼다.

const FAKE_KEY = "FAKE-GEMINI-KEY-0042";
const KEY_ENV = { GEMINI_API_KEY: FAKE_KEY };
const TARGET = "2026-10-27";
const TODAY = "2026-10-28";
const NOTE = { language: "한국어", format: "해설", topic: "가짜 탐사선의 궤도 설계", points: ["가짜 주장 하나와 근거", "가짜 주장 둘과 근거"], titleMatch: "맞음", promoShare: "없음" };
const SUMMARY = "가짜 탐사선이 궤도를 바꾼 과정을 차근차근 설명한다. ".repeat(6);

const videoId = (n: number) => `NoteVid${String(n).padStart(4, "0")}`;

function candidate(n: number, bundles: Candidate["bundles"] = ["kr"], seconds = 1200): Candidate {
  return { n, videoId: videoId(n), bundles, sources: ["가짜 출처"], title: `가짜 영상 제목 ${n}`, channel: `가짜 채널 ${n}`, seconds, categoryId: "27", publishedAt: "2026-10-26T01:00:00Z", language: "ko", liveRecord: false, description: "가짜 설명", thumb: "https://i.ytimg.com/vi/x/mqdefault.jpg" };
}

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

interface Flow {
  repo: string;
  dataDir: string;
  runFile: string;
  env: NodeJS.ProcessEnv;
  file: CandidateFile;
}

/** 브리프 하나와 후보 목록이 있는 시험 폴더. check를 주면 확인 후보 파일도 쓴다 */
function flow(env: NodeJS.ProcessEnv = KEY_ENV, candidates: Candidate[] = [1, 2, 3].map((n) => candidate(n)), check: unknown = { videos: candidates.map((c) => ({ candidate: c.n, bundle: c.bundles[0] })) }): Flow {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, TARGET);
  addBrief(db, TARGET);
  db.close();
  const fullEnv = { ...env, TIDWYN_DATA_DIR: dataDir };
  const ctx = makeCtx(repo, fullEnv);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
  const file: CandidateFile = { targetDate: TARGET, fetchedOn: TODAY, candidates, issues: [] };
  writeCandidateFiles(dataDir, file);
  if (check !== null) writeCheck(dataDir, check);
  return { repo, dataDir, runFile, env: fullEnv, file };
}

const writeCheck = (dataDir: string, data: unknown) => fs.writeFileSync(videoWorkFile(dataDir, "check"), JSON.stringify(data));

function okBody(note: unknown = NOTE, input = 1000, output = 100, video = input): string {
  return JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(note) }] } }], usageMetadata: { promptTokenCount: input, candidatesTokenCount: output, thoughtsTokenCount: 10, promptTokensDetails: [{ modality: "TEXT", tokenCount: 10 }, { modality: "VIDEO", tokenCount: video }] } });
}

const OK: GeminiResponse = { status: 200, body: okBody() };
const err = (status: number, st: string, extra: object = {}): GeminiResponse => ({ status, body: JSON.stringify({ error: { code: status, status: st, message: `가짜 오류 https://www.youtube.com/watch?v=${videoId(1)} ${FAKE_KEY}`, ...extra } }) });

interface Call {
  id: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fake(answer: (id: string, attempt: number, signal: AbortSignal) => GeminiResponse | Promise<GeminiResponse> = () => OK) {
  const calls: Call[] = [];
  const http: GeminiHttp = async (url, headers, body, signal) => {
    const b = JSON.parse(body) as { contents: { parts: { file_data?: { file_uri: string } }[] }[] };
    const id = b.contents[0]!.parts[0]!.file_data!.file_uri.split("v=")[1]!;
    const attempt = calls.filter((c) => c.id === id).length;
    calls.push({ id, url, headers, body: b as unknown as Record<string, unknown> });
    return answer(id, attempt, signal);
  };
  return { http, calls };
}

/** 곧바로 도는 시계: 다시 시도 대기는 바로 끝나고, 긴 제한은 울리지 않는다 */
const quickClock: GeminiClock = {
  after(ms, fn) {
    if (ms > 60_000) return () => {};
    const t = setImmediate(fn);
    return () => clearImmediate(t);
  },
};

class FakeClock implements GeminiClock {
  t = 0;
  private q: { at: number; fn: () => void }[] = [];
  after(ms: number, fn: () => void): () => void {
    const e = { at: this.t + ms, fn };
    this.q.push(e);
    return () => {
      this.q = this.q.filter((x) => x !== e);
    };
  }
  advance(ms: number): void {
    this.t += ms;
    const due = this.q.filter((e) => e.at <= this.t);
    this.q = this.q.filter((e) => e.at > this.t);
    for (const e of due) e.fn();
  }
}

const tick = () => new Promise((r) => setImmediate(r));

interface NotesOpts {
  clock?: GeminiClock;
  limits?: Partial<GeminiLimits>;
}

async function notesCli(f: Flow, http: GeminiHttp, o: NotesOpts = {}): Promise<{ code: number; text: string }> {
  const ctx = { ...makeCtx(f.repo, f.env), geminiHttp: http, geminiClock: o.clock ?? quickClock, ...(o.limits ? { geminiLimits: o.limits } : {}) };
  const code = await mainAsync(["video-notes", "--run", f.runFile], ctx);
  return { code, text: ctx.text() };
}

function cli(f: Flow, argv: string[]): { code: number; text: string } {
  const ctx = makeCtx(f.repo, f.env);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

const notesOf = (f: Flow) => JSON.parse(fs.readFileSync(videoWorkFile(f.dataDir, "notes"), "utf8")) as NotesFile;
const runOf = (f: Flow) => readRun(f.runFile);

const pickOf = (n: number, summary?: string) => ({ candidate: n, bundle: "kr", reason: "지어낸 탐사 과정을 알 수 있다.", issues: [], ...(summary === undefined ? {} : { summary }) });

/** 고르기 적용 → 백업 → 빌드 → 요약까지 돌린다(T11: 뒤 단계가 끝까지 돈다) */
function finishFlow(f: Flow, videos: unknown[]): { applied: string; summary: string } {
  fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), JSON.stringify({ videos }));
  const a = cli(f, ["video-apply", "--run", f.runFile]);
  assert.equal(a.code, 0, a.text);
  const b = cli(f, ["backup", "--run", f.runFile]);
  assert.equal(b.code, 0, b.text);
  const ctx = {
    ...makeCtx(f.repo, f.env),
    buildSite: ({ outDir }: { inputDir: string; outDir: string }) => {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, "index.html"), "<html></html>");
      return { ok: true as const };
    },
  };
  assert.equal(main(["site", "--run", f.runFile], ctx), 0, ctx.text());
  const s = cli(f, ["summary", "--run", f.runFile]);
  assert.equal(s.code, 0, s.text);
  return { applied: a.text, summary: s.text };
}

describe("8단계 4.1 Gemini 호출", () => {
  test("4.1-1 실제 데이터 폴더 모드에서 실행 조건에 맞지 않으면 거부되고 호출이 없으며, 명령 이름이 CLI에 있다", async () => {
    assert.ok(COMMAND_NAMES.includes("video-notes"));
    const repo = tempRepo();
    const dataDir = path.join(repo, "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "tidwyn.db");
    const db = openDb(dbPath);
    recordFirstCollectionDate(db, TARGET);
    addBrief(db, TARGET);
    db.close();
    gitIn(repo, "switch", "-q", "-c", "other");
    const runFile = path.join(dataDir, "runs", "r.json");
    const s = { startedAt: "2026-10-28T09:00:00+09:00", mode: "real", dataDir, dbPath, backupRepo: null, noCommitReason: "x", targetDates: [], results: {}, backup: null } as unknown as RunState;
    writeRun(runFile, s);
    const g = fake();
    const r = await notesCli({ repo, dataDir, runFile, env: KEY_ENV, file: { targetDate: TARGET, fetchedOn: TODAY, candidates: [], issues: [] } }, g.http);
    assert.equal(r.code, 3, r.text);
    assert.match(r.text, /실행 조건이 맞지 않아/);
    assert.equal(g.calls.length, 0);
  });

  test("4.1-2 정상 호출: YouTube 주소를 파일 입력으로 보내고 키는 헤더로만 가며 store:false가 있고 메모가 파일에 쓰인다", async () => {
    const f = flow();
    const g = fake();
    const r = await notesCli(f, g.http);
    assert.equal(r.code, 0, r.text);
    assert.equal(g.calls.length, 3);
    for (const c of g.calls) {
      assert.equal(c.headers["x-goog-api-key"], FAKE_KEY);
      assert.ok(!c.url.includes(FAKE_KEY));
      assert.ok(!JSON.stringify(c.body).includes(FAKE_KEY));
      assert.equal(c.body.store, false);
      assert.match(JSON.stringify(c.body), /https:\/\/www\.youtube\.com\/watch\?v=NoteVid/);
    }
    const n = notesOf(f);
    assert.equal(n.finished, true);
    assert.deepEqual(n.videos.map((v) => v.n).sort(), [1, 2, 3]);
    assert.deepEqual(n.videos[0]!.note, NOTE);
  });

  test("4.1-2 시간 초과, 일시 오류 뒤 성공, 429 뒤 성공, 네트워크 오류 뒤 성공에서 메모와 실패가 맞다", async () => {
    const f = flow(KEY_ENV, [1, 2, 3, 4].map((n) => candidate(n)));
    const clock = new FakeClock();
    const g = fake((id, attempt, signal) => {
      if (id === videoId(1)) return new Promise(() => void signal);
      if (id === videoId(2) && attempt === 0) return err(503, "UNAVAILABLE");
      if (id === videoId(3) && attempt === 0) return err(429, "RESOURCE_EXHAUSTED", { details: [{ retryDelay: "2s" }] });
      if (id === videoId(4) && attempt === 0) throw new Error("가짜 네트워크 오류");
      return OK;
    });
    const p = notesCli(f, g.http, { clock, limits: { perVideoMs: 60_000 } });
    for (let i = 0; i < 80; i++) {
      await tick();
      clock.advance(2_000);
    }
    const r = await p;
    assert.equal(r.code, 0, r.text);
    const n = notesOf(f);
    assert.deepEqual(n.videos.map((v) => v.n).sort(), [2, 3, 4]);
    assert.deepEqual(n.failures, [{ n: 1, reason: "시간 초과" }]);
    assert.equal(n.timeLimit, false);
  });

  test("4.1-2 가짜 시계로 8분에 닿으면 진행 중 호출이 끊기고 남은 호출이 없으며 받은 메모가 남고, 재시도 대기가 있어도 9분 안에 끝난다", async () => {
    const f = flow(KEY_ENV, [1, 2, 3, 4, 5, 6, 7].map((n) => candidate(n)));
    const clock = new FakeClock();
    const g = fake((id) => (id === videoId(1) ? OK : new Promise(() => {})));
    let done = false;
    const p = notesCli(f, g.http, { clock, limits: { perVideoMs: 20 * 60_000 } }).then((r) => {
      done = true;
      return r;
    });
    for (let i = 0; i < 20; i++) await tick();
    const before = g.calls.length;
    clock.advance(8 * 60_000);
    for (let i = 0; i < 20; i++) await tick();
    assert.ok(done, "8분에 끝난다");
    const r = await p;
    assert.equal(g.calls.length, before, "남은 호출이 없다");
    const n = notesOf(f);
    assert.equal(n.finished, true);
    assert.equal(n.timeLimit, true);
    assert.deepEqual(n.videos.map((v) => v.n), [1]);
    assert.ok(n.failures.every((x) => x.reason === "시간 초과"));
    const s = cli(f, ["summary", "--run", f.runFile]);
    assert.match(s.text, /시간 제한 도달/, r.text);

    const f2 = flow(KEY_ENV, Array.from({ length: 24 }, (_, i) => candidate(i + 1, [(["kr", "us", "ai-ko", "ai-en"] as const)[i % 4]!])));
    const clock2 = new FakeClock();
    const g2 = fake(() => err(503, "UNAVAILABLE"));
    let done2 = false;
    const p2 = notesCli(f2, g2.http, { clock: clock2 }).then(() => (done2 = true));
    while (!done2 && clock2.t < 20 * 60_000) {
      for (let i = 0; i < 5; i++) await tick();
      clock2.advance(1_000);
    }
    await p2;
    assert.ok(clock2.t <= 9 * 60_000, `${clock2.t}ms에 끝났다`);
  });

  test("4.1-3 형식이 틀리거나 지나치게 긴 응답, 빈 응답, 안전 차단, 영상 토큰 없는 200은 실패로 남고 메모 파일에 들어가지 않는다", async () => {
    const cases: [number, string, string][] = [
      [1, okBody({ ...NOTE, format: "노래" }), "형식 오류"],
      [2, okBody({ ...NOTE, points: Array.from({ length: 30 }, () => "많은 항목") }), "형식 오류"],
      [3, okBody({ ...NOTE, points: ["긴 원문 ".repeat(200)] }), "형식 오류"],
      [4, JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [] } }] }), "빈 응답"],
      [5, JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }), "안전 차단"],
      [6, okBody(NOTE, 500, 100, 0), "영상 토큰 없음"],
      [7, "<html>가짜</html>", "형식 오류"],
    ];
    const f = flow(KEY_ENV, cases.map(([n]) => candidate(n)));
    const g = fake((id) => ({ status: 200, body: cases.find(([n]) => videoId(n) === id)![1] }));
    await notesCli(f, g.http);
    const n = notesOf(f);
    assert.deepEqual(n.videos, []);
    for (const [num, , reason] of cases) assert.deepEqual(n.failures.find((x) => x.n === num), { n: num, reason });
  });

  const stops: [string, () => GeminiResponse, RegExp, number][] = [
    ["키 거부(실제 모양)", () => err(400, "INVALID_ARGUMENT", { message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] }), /Gemini 키 확인 필요/, 1],
    ["잔액 없음 402", () => err(402, "PAYMENT_REQUIRED"), /Gemini 크레딧 확인 필요/, 1],
    ["결제 사유 400", () => err(400, "FAILED_PRECONDITION", { message: "enable billing on your project" }), /Gemini 크레딧 확인 필요/, 1],
    ["결제 사유 403", () => err(403, "PERMISSION_DENIED", { message: "billing is not enabled" }), /Gemini 크레딧 확인 필요/, 1],
    ["소비 한도 429", () => err(429, "RESOURCE_EXHAUSTED", { message: "spending cap reached" }), /Gemini 한도 초과/, 1],
    ["일일 할당량 429", () => err(429, "RESOURCE_EXHAUSTED", { details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel" }] }] }), /Gemini 한도 초과/, 1],
    ["계속되는 429", () => err(429, "RESOURCE_EXHAUSTED"), /Gemini 한도 초과/, 3],
    ["연속 분류 밖 오류", () => err(404, "NOT_FOUND"), /Gemini 오류 반복/, 3],
  ];
  for (const [name, res, line, perVideo] of stops) {
    test(`4.1-4 ${name}: 멈추고 영상이 요약 없이 적용되며 뒤 단계가 끝까지 돌고, 키와 응답 본문이 어디에도 없다`, async () => {
      const f = flow(KEY_ENV, [1, 2, 3, 4, 5, 6].map((n) => candidate(n)));
      const g = fake(res);
      const r = await notesCli(f, g.http, { limits: { concurrency: 1 } });
      assert.equal(r.code, 0, r.text);
      assert.match(r.text, line);
      assert.ok(g.calls.length <= 3 * perVideo, `${g.calls.length}번 불렀다`);
      assert.equal(notesOf(f).finished, true);
      const more = await notesCli(f, g.http, { limits: { concurrency: 1 } });
      assert.equal(more.code, 0);
      assert.ok(g.calls.length <= 3 * perVideo, "전체 멈춤 뒤 호출 0건");
      const run = fs.readFileSync(f.runFile, "utf8");
      const { summary } = finishFlow(f, [pickOf(1)]);
      assert.match(summary, line);
      for (const text of [run, summary, r.text, fs.readFileSync(f.runFile, "utf8")]) {
        assert.ok(!text.includes(FAKE_KEY), "키가 없다");
        assert.ok(!text.includes(videoId(1)), "영상 ID가 없다");
      }
      const db = openDb(path.join(f.dataDir, "tidwyn.db"));
      assert.equal(allVideos(db)[0]!.summary, null);
      db.close();
    });
  }

  test("4.1-4 키가 없으면 호출 없이 메모 파일을 쓰고, 키나 결제 사유 없는 403(없는 영상)은 그 영상만 실패하고 계속한다", async () => {
    const f = flow({});
    const g = fake();
    const r = await notesCli(f, g.http);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /Gemini 키 확인 필요/);
    assert.equal(g.calls.length, 0);
    assert.equal(notesOf(f).finished, true);
    assert.equal(notesOf(f).total, 3);

    const f2 = flow();
    const g2 = fake((id) => (id === videoId(2) ? { status: 403, body: JSON.stringify({ error: { code: 403, status: "PERMISSION_DENIED", message: "The caller does not have permission" } }) } : OK));
    await notesCli(f2, g2.http);
    const n = notesOf(f2);
    assert.equal(n.stop, null);
    assert.deepEqual(n.failures, [{ n: 2, reason: "볼 수 없음" }]);
    assert.equal(n.videos.length, 2);
  });

  test("4.1-4 모두 실패해도 메모 없이 적용되고 뒤 단계가 돈다", async () => {
    const f = flow();
    await notesCli(f, fake(() => err(503, "UNAVAILABLE")).http);
    assert.deepEqual(notesOf(f).videos, []);
    assert.equal(notesOf(f).failures.length, 3);
    const { summary } = finishFlow(f, [pickOf(1), pickOf(2)]);
    assert.match(summary, /메모 받음 0개, 실패 3개\(일시 오류 계속 3\)/);
    assert.match(summary, /요약을 붙인 영상: 0개/);
  });

  test("4.1-5 토큰을 생각 토큰까지 합해 예상 달러를 남기고, 실패한 응답의 사용량도 세며, 상한에 닿으면 그 뒤 호출이 없다", async () => {
    const f = flow(KEY_ENV, [1, 2, 3].map((n) => candidate(n)));
    const g = fake((id) => (id === videoId(3) ? { status: 200, body: okBody({ 틀린: 1 }, 500, 50) } : { status: 200, body: okBody(NOTE, 100_000, 1000) }));
    await notesCli(f, g.http, { limits: { concurrency: 1 } });
    const st = runOf(f).videoNotes!;
    assert.equal(st.input, 200_500);
    assert.equal(st.output, 2080);
    assert.ok(Math.abs(st.usd! - (200_500 * 0.3 + 2080 * 2.5) / 1e6) < 1e-9);
    const s = cli(f, ["summary", "--run", f.runFile]);
    assert.match(s.text, /Gemini 토큰: 입력 200500, 출력 2080, 예상 \$0\.065/);

    const capped = flow(KEY_ENV, [1, 2, 3, 4].map((n) => candidate(n)));
    const g2 = fake(() => ({ status: 200, body: okBody(NOTE, 100_000, 1000) }));
    const r = await notesCli(capped, g2.http, { limits: { concurrency: 1, costCapUsd: 0.05 } });
    assert.equal(g2.calls.length, 2);
    assert.match(r.text, /비용 상한 도달/);
    assert.match(r.text, /부르지 않음 2개/);
  });

  test("4.1-6 끝남 표시가 있으면 호출 0건, 끊긴 부분 파일에서는 메모도 실패도 없는 영상만 부르고 비용 누계가 이어지며, 고르기 끝남이면 부르지 않는다", async () => {
    const f = flow();
    const g = fake();
    await notesCli(f, g.http);
    const r = await notesCli(f, g.http);
    assert.match(r.text, /이미 끝남/);
    assert.equal(g.calls.length, 3);

    const cut = flow();
    const part = notesOf({ ...cut, dataDir: (await (async () => {
      await notesCli(cut, fake().http);
      return cut.dataDir;
    })()) });
    part.finished = false;
    part.failures = [{ n: 2, reason: "빈 응답" }];
    part.videos = part.videos.filter((v) => v.n === 1);
    part.usage = { input: 7000, output: 70 };
    fs.writeFileSync(videoWorkFile(cut.dataDir, "notes"), JSON.stringify(part));
    const g2 = fake();
    await notesCli(cut, g2.http);
    assert.deepEqual(g2.calls.map((c) => c.id), [videoId(3)]);
    const n = notesOf(cut);
    assert.equal(n.finished, true);
    assert.equal(n.usage.input, 8000);
    assert.equal(n.videos.length, 2);

    fs.writeFileSync(videoWorkFile(cut.dataDir, "pick"), JSON.stringify({ videos: [] }));
    assert.equal(cli(cut, ["video-apply", "--run", cut.runFile]).code, 0);
    const g3 = fake();
    const again = await notesCli(cut, g3.http);
    assert.match(again.text, /이미 고르기 끝남/);
    assert.equal(g3.calls.length, 0);
  });
});

describe("8단계 4.2 확인 후보", () => {
  const seven = (bundle: Candidate["bundles"][number], from: number, n: number) => Array.from({ length: n }, (_, i) => candidate(from + i, [bundle]));
  const all = (list: Candidate[]) => ({ videos: list.map((c) => ({ candidate: c.n, bundle: c.bundles[0] })) });
  const cases: [string, Candidate[], unknown, RegExp][] = [
    ["없는 번호", [candidate(1)], { videos: [{ candidate: 99, bundle: "kr" }] }, /후보 99은\(는\) 후보 목록에 없다/],
    ["같은 영상 두 번", [candidate(1)], { videos: [{ candidate: 1, bundle: "kr" }, { candidate: 1, bundle: "kr" }] }, /두 번 넣었다/],
    ["고를 수 없는 묶음", [candidate(1)], { videos: [{ candidate: 1, bundle: "us" }] }, /us 묶음으로 고를 수 없다/],
    ["묶음별 최대 초과", seven("kr", 1, 8), all(seven("kr", 1, 8)), /kr 묶음이 8개다\(최대 7개, 1개 줄인다\)/],
    ["합계 초과", [...seven("kr", 1, 8), ...seven("us", 9, 7), ...seven("ai-ko", 16, 5), ...seven("ai-en", 21, 5)], all([...seven("kr", 1, 8), ...seven("us", 9, 7), ...seven("ai-ko", 16, 5), ...seven("ai-en", 21, 5)]), /합계 25개다\(최대 24개, 1개 줄인다\)/],
    ["합계 길이 초과", [candidate(1, ["kr"], 10_000), candidate(2, ["kr"], 10_000), candidate(3, ["kr"], 10_000)], all([candidate(1, ["kr"]), candidate(2, ["kr"]), candidate(3, ["kr"])]), /합계 길이가 8:20:00이다\(최대 8시간, 20:00 줄인다\)/],
    ["3시간 넘는 영상", [candidate(1, ["kr"], 10_801)], { videos: [{ candidate: 1, bundle: "kr" }] }, /3시간 이하여야 한다/],
    ["파일 없음", [candidate(1)], null, /확인 후보 파일이 없다/],
  ];
  for (const [name, cands, check, line] of cases) {
    test(`4.2-1 ${name}: 거부되고 호출과 메모 파일이 없다`, async () => {
      const f = flow(KEY_ENV, cands, check);
      const g = fake();
      const r = await notesCli(f, g.http);
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, line);
      assert.equal(g.calls.length, 0);
      assert.ok(!fs.existsSync(videoWorkFile(f.dataDir, "notes")));
    });
  }

  test("4.2-1 최대까지 맞는 파일이 통과한다", async () => {
    const list = [...seven("kr", 1, 7), ...seven("us", 8, 7), ...seven("ai-ko", 15, 5), ...seven("ai-en", 20, 5)];
    const f = flow(KEY_ENV, list);
    const g = fake();
    const r = await notesCli(f, g.http);
    assert.equal(r.code, 0, r.text);
    assert.equal(g.calls.length, 24);
  });

  test("4.2-1 위반 파일로 세 번 부르면 호출 0건에 빈 메모 파일이 생기고, 이어서 메모 없는 고르기가 적용된다", async () => {
    const f = flow(KEY_ENV, [candidate(1)], { videos: [{ candidate: 99, bundle: "kr" }] });
    const g = fake();
    assert.equal((await notesCli(f, g.http)).code, 1);
    assert.equal((await notesCli(f, g.http)).code, 1);
    const third = await notesCli(f, g.http);
    assert.equal(third.code, 0, third.text);
    assert.match(third.text, /3번 통과하지 못해 메모 없이 넘어갔다/);
    assert.equal(g.calls.length, 0);
    assert.equal(notesOf(f).finished, true);
    const { applied } = finishFlow(f, [pickOf(1)]);
    assert.match(applied, /영상 고르기 적용함/);
  });

  test("4.2-2 확인 후보가 0개이면 호출 없이 끝남 표시가 있는 빈 메모 파일을 쓴다", async () => {
    const f = flow(KEY_ENV, [candidate(1)], { videos: [] });
    const g = fake();
    const r = await notesCli(f, g.http);
    assert.equal(r.code, 0, r.text);
    assert.equal(g.calls.length, 0);
    assert.equal(notesOf(f).finished, true);
  });
});

describe("8단계 4.3 최종 고르기와 저장", () => {
  const file: CandidateFile = { targetDate: TARGET, fetchedOn: TODAY, candidates: [candidate(1), candidate(2)], issues: [] };
  const noted = new Set([videoId(1)]);
  const violations = (videos: unknown[]) => {
    const db = openDb(path.join(tempDir(), "t.db"));
    const c = checkPickFile(db, { videos }, file, noted);
    db.close();
    return c.ok ? [] : c.violations.map((v) => v.why);
  };

  test("4.3-1 요약 검사: 메모 있는 영상에 없음, 메모 없는 영상에 있음, 길이, 주소, 메일 주소가 거부되고 150자와 350자는 통과한다", () => {
    assert.match(violations([pickOf(1)]).join(), /요약이 있어야 한다/);
    assert.match(violations([pickOf(2, SUMMARY)]).join(), /메모가 없어 요약을 쓸 수 없다/);
    assert.match(violations([pickOf(1, "가".repeat(149))]).join(), /149자다/);
    assert.match(violations([pickOf(1, "가".repeat(351))]).join(), /351자다/);
    assert.match(violations([pickOf(1, `${SUMMARY} www.example.com`)]).join(), /주소/);
    assert.match(violations([pickOf(1, `${SUMMARY} http://example.com`)]).join(), /주소/);
    assert.match(violations([pickOf(1, `${SUMMARY} someone@example.net`)]).join(), /메일 주소/);
    assert.deepEqual(violations([pickOf(1, "가".repeat(150))]), []);
    assert.deepEqual(violations([pickOf(1, "가".repeat(350)), pickOf(2)]), []);
  });

  test("4.3-1 위반이면 DB가 바뀌지 않고, 메모 있는 영상과 없는 영상이 섞인 파일이 적용되며 요약이 저장되고 사이트 데이터에 실린다", async () => {
    const f = flow();
    await notesCli(f, fake((id) => (id === videoId(2) ? err(503, "UNAVAILABLE") : OK)).http);
    fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), JSON.stringify({ videos: [pickOf(1)] }));
    assert.equal(cli(f, ["video-apply", "--run", f.runFile]).code, 1);
    const check = openDb(path.join(f.dataDir, "tidwyn.db"));
    assert.equal(allVideos(check).length, 0);
    check.close();
    const { summary } = finishFlow(f, [pickOf(1, SUMMARY), pickOf(2)]);
    assert.match(summary, /요약을 붙인 영상: 1개/);
    const db = openDb(path.join(f.dataDir, "tidwyn.db"));
    assert.deepEqual(allVideos(db).map((v) => v.summary), [SUMMARY.trim(), null]);
    const site = buildSiteData(db);
    db.close();
    const list = JSON.parse([...site].find(([k]) => k.includes(`list-${TARGET.slice(0, 7)}`))![1]) as { days: DayList[] };
    const vids = list.days[0]!.videos!;
    assert.equal(vids[0]!.videoSummary, SUMMARY.trim());
    assert.ok(!("videoSummary" in vids[1]!), "요약이 없는 영상은 항목이 없다");
  });

  test("4.3-3 버전 7(영상 기록 포함)과 4의 DB를 열면 새 버전이 되고 데이터가 남으며, 같은 고르기를 두 번 적용해도 한 번씩이다", () => {
    const file7 = path.join(tempDir(), "v7.db");
    const old = openDb(file7, MIGRATIONS.filter((m) => m.version <= 7));
    recordFirstCollectionDate(old, TARGET);
    addBrief(old, TARGET);
    old.prepare("INSERT INTO videos (video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position) VALUES ('OldVid00001','kr','[]',?,?,'옛 제목','옛 채널',100,'t','p','옛 이유',1)").run(TARGET, TODAY);
    old.close();
    const db = openDb(file7);
    assert.equal(schemaVersion(db), 8);
    assert.deepEqual(allVideos(db).map((v) => [v.videoId, v.summary]), [["OldVid00001", null]]);
    const v: NewVideo = { videoId: "NewVid00001", bundle: "kr", sources: [], title: "t", channel: "c", seconds: 1, thumb: "t", publishedAt: "p", reason: "r", summary: SUMMARY, position: 1, issues: [] };
    applyVideoPick(db, TARGET, TODAY, [v]);
    applyVideoPick(db, TARGET, TODAY, [v]);
    assert.deepEqual(allVideos(db).map((x) => x.videoId), ["NewVid00001"]);
    db.close();

    const file4 = path.join(tempDir(), "v4.db");
    const v4 = openDb(file4, MIGRATIONS.filter((m) => m.version <= 4));
    recordFirstCollectionDate(v4, TARGET);
    addBrief(v4, TARGET);
    v4.close();
    const db4 = openDb(file4);
    assert.equal(schemaVersion(db4), 8);
    assert.equal(allVideos(db4).length, 0);
    assert.equal((db4.prepare("SELECT COUNT(*) AS n FROM briefs").get() as { n: number }).n, 1);
    db4.close();
  });
});

describe("8단계 4.4 30일 지우기, 백업, 유출 막기", () => {
  const OLD_SUMMARY = "지워져야 하는 가짜 요약 문자열이다 XQZ".repeat(3);

  test("4.4-1 30·31일 전 기록의 요약이 DB, 사본, 작업 파일에서 나오지 않고 29일 전 것은 남는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const dbFile = path.join(dataDir, "tidwyn.db");
    const db = openDb(dbFile);
    recordFirstCollectionDate(db, "2026-09-01");
    for (const d of ["2026-09-27", "2026-09-28", "2026-09-29"]) addBrief(db, d);
    const mk = (id: string, summary: string): NewVideo => ({ videoId: id, bundle: "kr", sources: [], title: "t", channel: "c", seconds: 1, thumb: "t", publishedAt: "p", reason: "r", summary, position: 1, issues: [] });
    applyVideoPick(db, "2026-09-27", "2026-09-27", [mk("OldVid00031", `${OLD_SUMMARY}31`)]);
    applyVideoPick(db, "2026-09-28", "2026-09-28", [mk("OldVid00030", `${OLD_SUMMARY}30`)]);
    applyVideoPick(db, "2026-09-29", "2026-09-29", [mk("OldVid00029", "남는 가짜 요약 문자열 29일")]);
    db.close();
    fs.mkdirSync(path.join(dataDir, "work"), { recursive: true });
    fs.writeFileSync(videoWorkFile(dataDir, "notes"), JSON.stringify({ target: "2026-09-27", videos: [{ title: OLD_SUMMARY }] }));
    fs.writeFileSync(videoWorkFile(dataDir, "check"), JSON.stringify({ videos: [] }));
    const env = { TIDWYN_DATA_DIR: dataDir };
    const ctx = makeCtx(repo, env);
    assert.equal(main(["start"], ctx), 0, ctx.text());
    const leak = Buffer.from("XQZ");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const file of walk(dataDir)) assert.ok(!fs.readFileSync(file).includes(leak), `${file}에 요약이 남았다`);
    assert.ok(!fs.existsSync(videoWorkFile(dataDir, "notes")));
    assert.ok(!fs.existsSync(videoWorkFile(dataDir, "check")));
    const after = openDb(dbFile);
    assert.deepEqual(allVideos(after).map((v) => v.summary), ["남는 가짜 요약 문자열 29일"]);
    after.close();
    // 사이트 입력과 결과물까지 만들어 같은 바이트 검사를 한다
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
    const b = makeCtx(repo, env);
    assert.equal(main(["backup", "--run", runFile], b), 0, b.text());
    const site = {
      ...makeCtx(repo, env),
      buildSite: ({ inputDir, outDir }: { inputDir: string; outDir: string }) => {
        fs.cpSync(inputDir, outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, "index.html"), "<html></html>");
        return { ok: true as const };
      },
    };
    assert.equal(main(["site", "--run", runFile], site), 0, site.text());
    const files = walk(dataDir);
    for (const file of files) assert.ok(!fs.readFileSync(file).includes(leak), `${file}에 요약이 남았다`);
    const kept = Buffer.from("남는 가짜 요약 문자열 29일");
    assert.ok(files.some((file) => file.includes(`${path.sep}site${path.sep}`) && fs.readFileSync(file).includes(kept)), "29일 전 요약은 결과물에 남는다");
  });

  test("4.4-1 결과물에 메모·확인 후보 파일 이름이 있으면 검사가 실패한다", () => {
    for (const name of ["videos.notes.json", "videos.check.json"]) {
      const out = tempDir();
      fs.writeFileSync(path.join(out, name), "{}");
      assert.deepEqual(checkOutput(out, null).findings.map((f) => f.kind), ["실행 기록·작업 파일"], name);
    }
  });

  test("4.4-2 요약이 있는 DB를 백업하면 요약이 없고 복원한 DB에 영상 기록이 없으며, 요약 항목이 든 백업 파일을 넣은 커밋에서 점검이 실패한다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    recordFirstCollectionDate(db, TARGET);
    addBrief(db, TARGET);
    applyVideoPick(db, TARGET, TODAY, [{ videoId: "BakVid00001", bundle: "kr", sources: [], title: "t", channel: "c", seconds: 1, thumb: "t", publishedAt: "p", reason: "r", summary: SUMMARY, position: 1, issues: [] }]);
    const files = buildBackup(db);
    db.close();
    for (const [name, text] of files) assert.ok(!text.includes(SUMMARY.trim().slice(0, 20)), name);
    const out = path.join(tempDir(), "r.db");
    restoreBackup(files, out);
    const back = openDb(out);
    assert.equal(allVideos(back).length, 0);
    back.close();

    for (const field of ["videoSummary", "video_summary"]) {
      const repo = tempRepo();
      gitIn(repo, "switch", "-q", "--orphan", "data");
      gitIn(repo, "rm", "-rq", "--cached", "--ignore-unmatch", ".");
      for (const n of fs.readdirSync(repo)) if (n !== ".git") fs.rmSync(path.join(repo, n), { recursive: true });
      fs.writeFileSync(path.join(repo, "2026-10.json"), JSON.stringify({ month: "2026-10", [field]: "가짜" }, null, 2));
      gitIn(repo, "add", ".");
      gitIn(repo, "commit", "-qm", "backup");
      const head = gitIn(repo, "rev-parse", "HEAD").trim();
      const r = precheck({ repo, commits: [head], trackedFiles: true, home: null });
      assert.ok(r.findings.some((x) => x.kind === "백업 파일에 영상 기록"), field);
    }
  });

  test("4.4-3 GEMINI_API_KEY가 키 목록에 있어 결과물의 키 값을 찾는다", () => {
    const out = tempDir();
    fs.writeFileSync(path.join(out, "a.js"), `const k = "${FAKE_KEY}"`);
    assert.ok(checkOutput(out, null, [FAKE_KEY]).findings.length > 0);
    const f = flow();
    const s = cli(f, ["summary", "--run", f.runFile]);
    assert.ok(!s.text.includes(FAKE_KEY));

    const repo = tempRepo();
    fs.writeFileSync(path.join(repo, "note.txt"), `값 ${FAKE_KEY}\n`);
    gitIn(repo, "add", ".");
    gitIn(repo, "commit", "-qm", "note");
    const head = gitIn(repo, "rev-parse", "HEAD").trim();
    const r = precheck({ repo, commits: [head], trackedFiles: true, home: null, secrets: secretValues(KEY_ENV, tempDir()) });
    assert.ok(r.findings.some((f) => f.kind === "키 값이 들어 있음"));
  });

  test("4.4-4 실행 기록과 실행 요약에 영상 ID, 메모, 요약이 없고 수만 있다", async () => {
    const f = flow();
    const r = await notesCli(f, fake((id) => (id === videoId(3) ? err(500, "INTERNAL") : OK)).http);
    const { summary } = finishFlow(f, [pickOf(1, SUMMARY)]);
    for (const text of [fs.readFileSync(f.runFile, "utf8"), summary, r.text]) {
      assert.ok(!text.includes(videoId(1)));
      assert.ok(!text.includes(NOTE.topic));
      assert.ok(!text.includes(SUMMARY.trim().slice(0, 20)));
      assert.ok(!text.includes("가짜 영상 제목"));
    }
  });
});

describe("8단계 4.5 start 출력과 실행 요약", () => {
  test("4.5-1 start의 키 줄에 Gemini 있음/없음이 있고 값은 보이지 않는다", () => {
    const repo = tempRepo();
    const dir = tempDir();
    const a = makeCtx(repo, { TIDWYN_DATA_DIR: dir, ...KEY_ENV });
    assert.equal(main(["start"], a), 0);
    assert.match(a.text(), /키: ECOS 없음, FRED 없음, YouTube 없음, Gemini 있음/);
    assert.ok(!a.text().includes(FAKE_KEY));
    const b = makeCtx(tempRepo(), { TIDWYN_DATA_DIR: tempDir() }, NOW);
    assert.equal(main(["start"], b), 0);
    assert.match(b.text(), /Gemini 없음/);
  });

  test("4.5-2 실행 요약에 확인 후보 수, 메모 수, 실패 수와 이유, 부르지 않은 수, 토큰과 달러, 요약 수가 나온다", async () => {
    const f = flow(KEY_ENV, [1, 2, 3, 4].map((n) => candidate(n)));
    await notesCli(f, fake((id) => (id === videoId(2) ? { status: 200, body: "{}" } : id === videoId(3) ? err(402, "PAYMENT_REQUIRED") : OK)).http, { limits: { concurrency: 1 } });
    const { summary } = finishFlow(f, [pickOf(1, SUMMARY)]);
    assert.match(summary, /- 영상 내용 확인: 확인 후보 4개, 메모 받음 1개, 실패 1개\(빈 응답 1\), 부르지 않음 2개/);
    assert.match(summary, /Gemini 크레딧 확인 필요/);
    assert.match(summary, /Gemini 토큰: 입력 1000, 출력 110, 예상 \$0\.001/);
    assert.match(summary, /요약을 붙인 영상: 1개/);
  });
});

describe("8단계 코드 리뷰에서 나온 수정", () => {
  const RATE = "You exceeded your current quota, please check your plan and billing details.";

  test("속도 제한 429의 안내문에 billing이 있어도 크레딧 멈춤이 아니라 다시 시도한다", async () => {
    const f = flow();
    const g = fake((_id, attempt) => (attempt === 0 ? err(429, "RESOURCE_EXHAUSTED", { message: RATE }) : OK));
    const r = await notesCli(f, g.http);
    assert.doesNotMatch(r.text, /크레딧/);
    assert.equal(notesOf(f).videos.length, 3);
  });

  test("선불 잔액 소진 429와 사유 코드의 결제 429는 크레딧 멈춤이다", async () => {
    for (const extra of [{ message: "Your prepayment credits are depleted." }, { details: [{ reason: "BILLING_DISABLED" }] }]) {
      const f = flow();
      const g = fake(() => err(429, "RESOURCE_EXHAUSTED", extra));
      const r = await notesCli(f, g.http, { limits: { concurrency: 1 } });
      assert.match(r.text, /Gemini 크레딧 확인 필요/);
      assert.equal(g.calls.length, 1);
    }
  });

  test("결제 사유가 없는 400 FAILED_PRECONDITION은 그 영상의 실패이고 다음 영상을 부른다", async () => {
    const f = flow();
    const g = fake((id) => (id === videoId(1) ? err(400, "FAILED_PRECONDITION", { message: "precondition failed" }) : OK));
    const r = await notesCli(f, g.http, { limits: { concurrency: 1 } });
    assert.doesNotMatch(r.text, /크레딧/);
    assert.equal(notesOf(f).videos.length, 2);
    assert.deepEqual(notesOf(f).failures, [{ n: 1, reason: "분류 밖 오류" }]);
  });

  test("분류 밖 오류 사이에 다른 실패가 끼면 연속으로 세지 않는다", async () => {
    const list = [1, 2, 3, 4, 5, 6].map((n) => candidate(n));
    const f = flow(KEY_ENV, list);
    const g = fake((id) => (Number(id.slice(-1)) % 2 === 1 ? err(404, "NOT_FOUND") : err(403, "PERMISSION_DENIED")));
    const r = await notesCli(f, g.http, { limits: { concurrency: 1 } });
    assert.doesNotMatch(r.text, /Gemini 오류 반복/);
    assert.equal(g.calls.length, 6);
  });

  test("끊긴 뒤 확인 후보 위반으로 포기하거나 0개가 되어도 받은 메모와 사용량이 남는다", async () => {
    for (const bad of [{ videos: [{ candidate: 99, bundle: "kr" }] }, { videos: [] }]) {
      const f = flow();
      await notesCli(f, fake().http, { limits: { concurrency: 1 } });
      const part = notesOf(f);
      part.finished = false;
      part.videos = part.videos.slice(0, 2);
      fs.writeFileSync(videoWorkFile(f.dataDir, "notes"), JSON.stringify(part));
      writeCheck(f.dataDir, bad);
      const g = fake();
      let last = await notesCli(f, g.http);
      for (let i = 0; i < 2; i++) last = await notesCli(f, g.http);
      const n = notesOf(f);
      if (bad.videos.length > 0) assert.match(last.text, /3번 통과하지 못해 받은 메모만 남기고 넘어갔다/);
      assert.equal(g.calls.length, 0);
      assert.equal(n.finished, true);
      assert.equal(n.videos.length, 2);
      assert.equal(n.usage.input, 3000);
    }
  });

  test("메모는 임시 파일을 거쳐 쓰고, 끊겨 남은 임시 파일도 영상 작업 파일로 지운다", async () => {
    const f = flow();
    await notesCli(f, fake().http);
    const tmp = videoWorkFile(f.dataDir, "notesTmp");
    assert.ok(!fs.existsSync(tmp), "끝나면 임시 파일이 없다");
    fs.writeFileSync(tmp, '{"videos": [');
    assert.equal(notesOf(f).videos.length, 3);
    removeVideoWorkFiles(f.dataDir);
    assert.ok(!fs.existsSync(tmp));
    const out = tempDir();
    fs.writeFileSync(path.join(out, path.basename(tmp)), "{}");
    assert.ok(checkOutput(out, null, []).findings.length > 0);
  });

  test("마지막 영상에서 상한을 넘겨도 남은 호출이 없으면 비용 상한 도달이 아니다", async () => {
    const f = flow(KEY_ENV, [1, 2].map((n) => candidate(n)));
    const g = fake(() => ({ status: 200, body: okBody(NOTE, 100_000, 1000) }));
    const r = await notesCli(f, g.http, { limits: { concurrency: 1, costCapUsd: 0.05 } });
    assert.equal(g.calls.length, 2);
    assert.doesNotMatch(r.text, /비용 상한 도달/);
    assert.equal(notesOf(f).costCap, false);
  });

  test("서버가 45초를 기다리라고 하면 45초를 기다린 뒤 다시 부른다", async () => {
    const clock = new FakeClock();
    const f = flow(KEY_ENV, [candidate(1)]);
    const g = fake((_id, attempt) => (attempt === 0 ? err(429, "RESOURCE_EXHAUSTED", { details: [{ retryDelay: "45s" }] }) : OK));
    const done = notesCli(f, g.http, { clock });
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(g.calls.length, 1);
    clock.advance(44_000);
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(g.calls.length, 1, "44초에는 다시 부르지 않는다");
    clock.advance(1_000);
    await done;
    assert.equal(g.calls.length, 2);
  });
});
