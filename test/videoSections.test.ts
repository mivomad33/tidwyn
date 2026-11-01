import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { parseChapters } from "../src/chapters.ts";
import { siteFiles, type DaySections, type DayVideos } from "../src/siteTypes.ts";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { MIGRATIONS, openDb } from "../src/db.ts";
import { GEMINI_MODEL, estimateUsd, type GeminiClock, type GeminiHttp, type GeminiLimits, type GeminiResponse } from "../src/gemini.ts";
import { buildBackup } from "../src/backup.ts";
import { readRun } from "../src/run.ts";
import { checkOutput, checkPublicPages } from "../src/siteCheck.ts";
import { buildSiteData } from "../src/siteData.ts";
import { precheck } from "../src/precheck.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { buildCandidateFile, checkPickFile, videoWorkFile, writeCandidateFiles, type Candidate, type CandidateFile, type SectionMaterial } from "../src/videoPick.ts";
import { purgeDataDir } from "../src/videoPurge.ts";
import { groupChapters, readSections, sectionsUsd, SECTION_MODEL, emptySections, estimateSectionUsd, writeSections } from "../src/videoSections.ts";
import { allVideos, applyVideoPick, purgeExpiredRows, type NewVideo } from "../src/videoStore.ts";
import type { FetchedVideo, YoutubeHttp } from "../src/youtube.ts";
import { NOW, cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

after(cleanupTemp);

// 9.7단계 구간 정리(4.1~4.3, 4.5-3). 영상 ID, 제목, 챕터, 구간 글, 키는 모두 지어낸 것이다. Gemini와 YouTube는 가짜 응답으로 바꾼다.

const FAKE_KEY = "FAKE-GEMINI-KEY-0097";
const KEY_ENV = { GEMINI_API_KEY: FAKE_KEY };
const TARGET = "2026-10-27";
const TODAY = "2026-10-28";
const NOTE = { language: "한국어", format: "해설", topic: "가짜 탐사선의 궤도 설계", points: ["가짜 주장과 근거"], titleMatch: "맞음", promoShare: "없음" };
const SUMMARY = "가짜 탐사선이 궤도를 바꾼 과정을 차근차근 설명한다. ".repeat(6);
const CHAPTERS = [
  { start: 0, title: "지어낸챕터제목 시작" },
  { start: 120, title: "지어낸챕터제목 가운데" },
  { start: 300, title: "지어낸챕터제목 끝" },
];
const ANSWER = { sections: [{ start: "0:10", title: "응답 제목 하나", gist: "응답 내용 하나" }, { start: "2:00", title: "응답 제목 둘", gist: "응답 내용 둘" }, { start: "1:05:00", title: "응답 제목 셋", gist: "응답 내용 셋" }] };

const id = (n: number) => `SecVid${String(n).padStart(5, "0")}`;

function candidate(n: number, chapters = false): Candidate {
  return { n, videoId: id(n), bundles: ["kr"], sources: ["가짜 출처"], title: `가짜 영상 제목 ${n}`, channel: `가짜 채널 ${n}`, seconds: 7200, categoryId: "27", publishedAt: "2026-10-26T01:00:00Z", language: "ko", liveRecord: false, description: "가짜 설명", thumb: "https://i.ytimg.com/vi/x/mqdefault.jpg", ...(chapters ? { chapters: CHAPTERS } : {}) };
}

function body(data: unknown, input = 1000, output = 100, video = input): string {
  return JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: { promptTokenCount: input, candidatesTokenCount: output, promptTokensDetails: [{ modality: "VIDEO", tokenCount: video }] } });
}

interface Call {
  id: string;
  url: string;
  raw: string;
  body: Record<string, unknown>;
}

const CHAPTER_ANSWER = { sections: CHAPTERS.map((_, i) => ({ detail: `메모의 구간 내용 ${i + 1}` })) };
const isChapterCall = (url: string) => url.includes(GEMINI_MODEL);
function fake(answer: (id: string, url: string) => GeminiResponse = (_, url) => ({ status: 200, body: body(isChapterCall(url) ? CHAPTER_ANSWER : ANSWER) })) {
  const calls: Call[] = [];
  const http: GeminiHttp = async (url, _headers, raw) => {
    const b = JSON.parse(raw) as { contents: { parts: { file_data?: { file_uri: string } }[] }[] };
    const vid = b.contents[0]!.parts[0]!.file_data!.file_uri.split("v=")[1]!;
    calls.push({ id: vid, url, raw, body: b as unknown as Record<string, unknown> });
    return answer(vid, url);
  };
  return { http, calls };
}

const clock: GeminiClock = {
  after(ms, fn) {
    if (ms > 60_000) return () => {};
    const t = setImmediate(fn);
    return () => clearImmediate(t);
  },
};

interface Flow {
  repo: string;
  dataDir: string;
  runFile: string;
  env: NodeJS.ProcessEnv;
}

function flow(candidates: Candidate[], env: NodeJS.ProcessEnv = KEY_ENV): Flow {
  const repo = tempRepo();
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  recordFirstCollectionDate(db, TARGET);
  const r = validateBrief(sampleBrief(TARGET), TARGET);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${TARGET}T23:00:00+09:00`, late: false });
  db.close();
  const fullEnv = { ...env, TIDWYN_DATA_DIR: dataDir };
  const ctx = makeCtx(repo, fullEnv);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!;
  writeCandidateFiles(dataDir, { targetDate: TARGET, fetchedOn: TODAY, candidates, issues: [] });
  fs.writeFileSync(videoWorkFile(dataDir, "check"), JSON.stringify({ videos: candidates.map((c) => ({ candidate: c.n, bundle: "kr" })) }));
  return { repo, dataDir, runFile, env: fullEnv };
}

function geminiCtx(f: Flow, http: GeminiHttp, extra: { limits?: Partial<GeminiLimits>; now?: Date; stopped?: boolean } = {}) {
  return { ...makeCtx(f.repo, f.env, extra.now ?? NOW), geminiHttp: http, geminiClock: clock, ...(extra.limits ? { geminiLimits: extra.limits } : {}), ...(extra.stopped === undefined ? {} : { videoSectionsStopped: extra.stopped }) };
}

async function notes(f: Flow) {
  const g = fake(() => ({ status: 200, body: body(NOTE) }));
  const ctx = geminiCtx(f, g.http);
  assert.equal(await mainAsync(["video-notes", "--run", f.runFile], ctx), 0, ctx.text());
  return g.calls;
}

const writePick = (f: Flow, videos: unknown[]) => fs.writeFileSync(videoWorkFile(f.dataDir, "pick"), JSON.stringify({ videos }));
const pickOf = (n: number, extra: object = {}) => ({ candidate: n, bundle: "kr", reason: "지어낸 탐사 과정을 알 수 있다.", issues: [], summary: SUMMARY, ...extra });

async function sections(f: Flow, g = fake(), extra: Parameters<typeof geminiCtx>[2] = {}) {
  const ctx = geminiCtx(f, g.http, extra);
  const code = await mainAsync(["video-sections", "--run", f.runFile], ctx);
  return { code, text: ctx.text(), calls: g.calls };
}

function cli(f: Flow, argv: string[]) {
  const ctx = makeCtx(f.repo, f.env);
  return { code: main(argv, ctx), text: ctx.text() };
}

const dbFile = (f: Flow) => path.join(f.dataDir, "tidwyn.db");

function records(f: Flow) {
  const db = openDb(dbFile(f));
  try {
    return allVideos(db);
  } finally {
    db.close();
  }
}

/** 검사를 통과하는 구간 글(요지와 불릿 합계 300~500자). 모두 지어낸 글이다 */
const written = (seed: string) => ({ gist: `${seed}의 핵심을 한 줄로 밝힌다`, points: [1, 2, 3].map((i) => `${seed} 대목의 ${i}번째 근거`.padEnd(100, "나")) });
const writtenChapter = [
  { start: 0, title: "처음에 볼 곳", ...written("탐사선 출발") },
  { start: 120, title: "궤도를 고른 까닭", ...written("궤도 선택") },
  { start: 300, title: "마지막 시험", ...written("마지막 시험") },
];
const writtenGemini = [
  { start: 10, title: "도입부 살피기", ...written("도입부") },
  { start: 120, title: "핵심 쟁점", ...written("쟁점") },
  { start: 3900, title: "뒷이야기", ...written("뒷이야기") },
];
const pad = (n: number) => "가".repeat(n);
const answerSections = writtenGemini.map(({ start, title, gist }) => ({ start, title, text: gist }));

describe("9.7단계 리뷰 고침: 챕터 시각의 경계", () => {
  test("시각 뒤에 숫자가 이어지는 줄은 시각이 아니다", () => {
    assert.equal(parseChapters("0:00 처음\n1:00 가운데\n2:00 끝\n1:234명이 왔다", 600).length, 3);
  });
});

describe("9.7단계 4.1 제작자 챕터와 메모", () => {
  const desc = (lines: string[]) => lines.join("\n");
  test("4.1-1 조건을 채운 설명은 챕터이고, 어긋나면 챕터가 없다", () => {
    const good = desc(["소개 글", "0:00 시작", "1:30 가운데", "12:05 끝"]);
    assert.deepEqual(parseChapters(good, 1000), [{ start: 0, title: "시작" }, { start: 90, title: "가운데" }, { start: 725, title: "끝" }]);
    assert.deepEqual(parseChapters(desc(["0:01 시작", "1:30 가운데", "12:05 끝"]), 1000), [], "첫 시각이 0:00이 아니다");
    assert.deepEqual(parseChapters(desc(["0:00 시작", "1:30 끝"]), 1000), [], "2개");
    assert.deepEqual(parseChapters(desc(["0:00 시작", "2:00 가운데", "1:00 끝"]), 1000), [], "순서");
    assert.deepEqual(parseChapters(desc(["0:00 시작", "0:05 가운데", "1:00 끝"]), 1000), [], "간격 10초 미만");
    assert.deepEqual(parseChapters(desc(["0:00 시작", "1:00 가운데", "20:00 끝"]), 1000), [], "영상 길이를 넘는다");
    assert.deepEqual(parseChapters(good, null), [], "길이 모름");
  });
  test("4.1-1 시:분:초와 줄 앞뒤의 괄호·구분 기호를 읽는다", () => {
    const list = parseChapters(desc(["[00:00] 시작", "(1:00) - 둘째", "- 02:00 | 셋째", "넷째 - 3:00", "다섯째 (1:04:05)"]), 7200);
    assert.deepEqual(list, [{ start: 0, title: "시작" }, { start: 60, title: "둘째" }, { start: 120, title: "셋째" }, { start: 180, title: "넷째" }, { start: 3845, title: "다섯째" }]);
  });
  test("4.1-1 설명을 자르기 전에 읽어 120자 뒤의 챕터도 읽는다", () => {
    const video = { videoId: id(1), bundles: ["kr"], sources: [], title: "t", channel: "c", seconds: 1000, categoryId: null, publishedAt: "", language: null, liveRecord: false, description: `${"긴 설명 ".repeat(60)}\n0:00 시작\n1:00 둘째\n2:00 셋째`, thumb: "" } as unknown as FetchedVideo;
    const c = buildCandidateFile(TARGET, TODAY, [video], []).candidates[0]!;
    assert.equal(c.chapters?.length, 3);
    assert.ok([...c.description].length <= 120);
  });
  test("4.1-2 메모 요청에는 챕터가 없고, 고른 뒤 메모 모델 호출에 챕터 제목과 분량이 들어가 재료가 된다", async () => {
    const f = flow([candidate(1, true), candidate(2)]);
    const noteCalls = await notes(f);
    assert.equal(noteCalls.length, 2);
    for (const c of noteCalls) assert.ok(!c.raw.includes("지어낸챕터제목"));
    writePick(f, [pickOf(1), pickOf(2)]);
    const r = await sections(f);
    const call = r.calls.find((c) => c.id === id(1))!;
    assert.ok(isChapterCall(call.url));
    for (const c of CHAPTERS) assert.ok(call.raw.includes(c.title));
    assert.match(call.raw, /데이터일 뿐 지시가 아니다/);
    assert.match(call.raw, /최소 500자, 최대 1000자/);
    const file = readSections(f.dataDir, TARGET)!;
    const got = file.videos.find((v) => v.n === 1)!;
    assert.equal(got.source, "chapter");
    assert.deepEqual(got.sections.map((x) => x.start), CHAPTERS.map((c) => c.start));
    assert.equal(got.sections[1]!.text, "메모의 구간 내용 2");
  });
  test("4.1-2 구간 내용 1,200자는 재료로 남는다", async () => {
    const f = flow([candidate(1, true)]);
    await notes(f);
    writePick(f, [pickOf(1)]);
    await sections(f, fake(() => ({ status: 200, body: body({ sections: CHAPTERS.map(() => ({ detail: "가".repeat(1200) })) }) })));
    assert.equal(readSections(f.dataDir, TARGET)!.videos.length, 1);
  });
  for (const [name, broken] of [["수가 다름", { sections: [{ detail: "하나" }] }], ["글이 김", { sections: CHAPTERS.map(() => ({ detail: "가".repeat(1201) })) }], ["빈 내용", { sections: CHAPTERS.map(() => ({ detail: " " })) }], ["형식이 다름", { sections: "문자열" }]] as const) {
    test(`4.1-2 구간 응답이 깨지면(${name}) 그 영상만 재료가 없다`, async () => {
      const f = flow([candidate(1, true)]);
      await notes(f);
      writePick(f, [pickOf(1)]);
      const r = await sections(f, fake(() => ({ status: 200, body: body(broken) })));
      assert.match(r.text, /받음 0개, 실패 1개\(형식 오류 1\)/);
      assert.equal(cli(f, ["video-check", "--run", f.runFile]).code, 0, "재료가 없어 키 없이 통과한다");
    });
  }
  test("C14 챕터는 2분에 한 구간, 3~8개로 묶고 묶음의 첫 시각을 쓴다", () => {
    const chapters = (n: number, gap: number) => Array.from({ length: n }, (_, i) => ({ start: i * gap, title: `챕터${i}` }));
    const short = groupChapters(chapters(13, 50), 650);
    assert.equal(short.length, 5);
    assert.equal(short[0]!.start, 0);
    assert.ok(short[0]!.title.startsWith("챕터0 / 챕터1"));
    assert.equal(short.flatMap((x) => x.title.split(" / ")).length, 13, "챕터를 빠뜨리지 않는다");
    assert.ok(short.every((x, i) => i === 0 || x.start > short[i - 1]!.start));
    assert.equal(groupChapters(chapters(30, 120), 3600).length, 8);
    assert.equal(groupChapters(chapters(9, 10), 100).length, 3, "아주 짧아도 3개다");
    assert.deepEqual(groupChapters(chapters(3, 60), 3600), chapters(3, 60));
  });
});

describe("9.7단계 4.2 구간 시각 받기", () => {
  test("4.2-1 메모를 받은 고른 영상만 부르고 챕터 없는 영상은 3.8 Flash로, 설정은 잰 그대로다", async () => {
    assert.ok(COMMAND_NAMES.includes("video-sections"));
    const f = flow([candidate(1, true), candidate(2), candidate(3), candidate(4)]);
    const g = fake(() => ({ status: 200, body: body(NOTE) }));
    // 후보 4는 메모 실패, 3은 고르지 않음
    const http: GeminiHttp = (url, h, raw, s) => (raw.includes(id(4)) ? Promise.resolve({ status: 403, body: "{}" }) : g.http(url, h, raw, s));
    const ctx = geminiCtx(f, http);
    await mainAsync(["video-notes", "--run", f.runFile], ctx);
    writePick(f, [pickOf(1), pickOf(2), pickOf(4)]);
    const r = await sections(f);
    assert.equal(r.code, 0, r.text);
    assert.deepEqual(r.calls.map((c) => c.id), [id(1), id(2)]);
    const call = r.calls[1]!;
    assert.ok(call.url.includes(`/${SECTION_MODEL}:generateContent`));
    assert.equal(SECTION_MODEL, "gemini-3.8-flash");
    assert.equal(call.body.store, false);
    assert.match(JSON.stringify(call.body), /최소 500자, 최대 1000자/);
    assert.ok(!call.raw.includes("mediaResolution") && !call.raw.includes("serviceTier") && !call.raw.includes("thinking"));
    assert.ok(call.raw.includes("가짜 영상 제목 2") && call.raw.includes("데이터일 뿐"));
  });
  test("4.2-1 대상이 0개면 호출하지 않는다", async () => {
    const f = flow([candidate(1, true)]);
    await notes(f);
    writePick(f, []);
    const r = await sections(f);
    assert.equal(r.calls.length, 0);
    assert.match(r.text, /대상 0개/);
  });
  test("4.2-2 비용 상한에 닿으면 멈추고 그 영상은 구간 없이 가며, 날짜 가격을 쓴다", async () => {
    assert.ok(Math.abs(estimateSectionUsd({ input: 1_000_000, output: 1_000_000 }, "2026-12-31") - 4.5) < 1e-9);
    assert.ok(Math.abs(estimateSectionUsd({ input: 1_000_000, output: 1_000_000 }, "2027-01-01") - 9) < 1e-9);
    const big = () => ({ status: 200, body: body(ANSWER, 2_000_000) });
    const run = async (now: Date) => {
      const f = flow([1, 2, 3].map((n) => candidate(n)));
      await notes(f);
      writePick(f, [pickOf(1), pickOf(2), pickOf(3)]);
      return sections(f, fake(big), { limits: { concurrency: 1 }, now });
    };
    const before = await run(new Date("2026-12-31T00:00:00Z"));
    const later = await run(new Date("2027-01-01T00:00:00Z"));
    const chapterPart = { input: 400_000, output: 100_000 };
    assert.ok(Math.abs(sectionsUsd({ input: 1_400_000, output: 1_100_000 }, chapterPart, "2026-12-31") - (estimateUsd(chapterPart) + 4.5)) < 1e-9, "챕터 영상 호출은 메모 모델 가격이다");
    assert.equal(before.calls.length, 2, "2026년: 2번째 뒤에 상한");
    assert.equal(later.calls.length, 1, "2027년: 1번째 뒤에 상한");
    assert.match(later.text, /비용 상한 도달/);
    assert.match(later.text, /부르지 않음 2개/);
  });
  test("4.2-2 상한은 챕터 영상 호출을 메모 모델 가격으로 더한다", async () => {
    const f = flow([candidate(1, true), candidate(2)]);
    await notes(f);
    writePick(f, [pickOf(1), pickOf(2)]);
    // 메모 모델 가격이면 약 $1.15, 3.8 가격이면 약 $2.63이라 상한 $2.50을 넘는다
    const r = await sections(f, fake((_, url) => ({ status: 200, body: isChapterCall(url) ? body(CHAPTER_ANSWER, 3_000_000, 100_000) : body(ANSWER) })), { limits: { concurrency: 1 } });
    assert.deepEqual(r.calls.map((c) => isChapterCall(c.url)), [true, false]);
  });
  test("4.2-2 키·크레딧 오류는 나머지를 부르지 않고, 재시도와 시간 초과는 메모와 같다", async () => {
    const f = flow([1, 2, 3].map((n) => candidate(n)));
    await notes(f);
    writePick(f, [pickOf(1), pickOf(2), pickOf(3)]);
    const r = await sections(f, fake(() => ({ status: 401, body: JSON.stringify({ error: { status: "UNAUTHENTICATED" } }) })), { limits: { concurrency: 1 } });
    assert.equal(r.calls.length, 1);
    assert.match(r.text, /Gemini 키 확인 필요/);
    const f2 = flow([candidate(1)]);
    await notes(f2);
    writePick(f2, [pickOf(1)]);
    let n = 0;
    const flaky = fake(() => (n++ === 0 ? { status: 503, body: "{}" } : { status: 200, body: body(ANSWER) }));
    const r2 = await sections(f2, flaky);
    assert.equal(r2.calls.length, 2);
    assert.match(r2.text, /받음 1개/);
  });
  const bad: [string, unknown][] = [
    ["범위 밖 시각", { sections: [{ start: "0:00", title: "a", gist: "b" }, { start: "1:00", title: "a", gist: "b" }, { start: "3:00:00", title: "a", gist: "b" }] }],
    ["순서가 어긋남", { sections: [{ start: "2:00", title: "a", gist: "b" }, { start: "1:00", title: "a", gist: "b" }, { start: "3:00", title: "a", gist: "b" }] }],
    ["2개", { sections: ANSWER.sections.slice(0, 2) }],
    ["9개", { sections: Array.from({ length: 9 }, (_, i) => ({ start: `${i + 1}:00`, title: "a", gist: "b" })) }],
    ["300자를 넘는 제목", { sections: ANSWER.sections.map((s) => ({ ...s, title: "가".repeat(301) })) }],
    ["1,200자를 넘는 내용", { sections: ANSWER.sections.map((s) => ({ ...s, gist: "가".repeat(1201) })) }],
    ["시각 형식", { sections: ANSWER.sections.map((s) => ({ ...s, start: "약 2분" })) }],
  ];
  test("4.2-3 내용 1,200자는 받는다", async () => {
    const f = flow([candidate(1)]);
    await notes(f);
    writePick(f, [pickOf(1)]);
    const long = { sections: ANSWER.sections.map((s) => ({ ...s, gist: "가".repeat(1200) })) };
    const r = await sections(f, fake(() => ({ status: 200, body: body(long) })));
    assert.match(r.text, /받음 1개, 실패 0개/);
  });
  for (const [name, data] of bad) {
    test(`4.2-3 ${name}이면 실패로 세고 다른 영상은 계속된다`, async () => {
      const f = flow([candidate(1), candidate(2)]);
      await notes(f);
      writePick(f, [pickOf(1), pickOf(2)]);
      const r = await sections(f, fake((v) => ({ status: 200, body: body(v === id(1) ? data : ANSWER) })));
      assert.match(r.text, /받음 1개, 실패 1개\(형식 오류 1\)/);
      assert.ok(!r.text.includes("가".repeat(50)));
    });
  }
  test("4.2-3 영상 토큰이 없으면 실패다", async () => {
    const f = flow([candidate(1)]);
    await notes(f);
    writePick(f, [pickOf(1)]);
    const r = await sections(f, fake(() => ({ status: 200, body: body(ANSWER, 100, 10, 0) })));
    assert.match(r.text, /영상 토큰 없음 1/);
  });
  test("4.2-3 이 파일이 적용, 새 후보 쓰기, 30일 지우기에서 지워지고, 날짜가 다른 파일은 재료로 쓰지 않고 호출하며, 결과물 검사가 거부한다", async () => {
    const f = flow([candidate(1)]);
    await notes(f);
    writePick(f, [pickOf(1)]);
    const stale = emptySections("2026-10-01", 1);
    stale.videos.push({ n: 1, videoId: id(1), source: "gemini", sections: answerSections });
    stale.finished = true;
    writeSections(f.dataDir, stale);
    const r = await sections(f);
    assert.equal(r.calls.length, 1, "날짜가 다른 파일은 끝남으로 보지 않는다");
    const file = videoWorkFile(f.dataDir, "sections");
    assert.ok(fs.existsSync(file));
    writeCandidateFiles(f.dataDir, { targetDate: TARGET, fetchedOn: TODAY, candidates: [candidate(1)], issues: [] });
    assert.ok(!fs.existsSync(file), "새 후보 쓰기");
    writeSections(f.dataDir, emptySections(TARGET, 0));
    purgeDataDir(f.dataDir, "2026-12-30");
    assert.ok(!fs.existsSync(file), "30일 지우기");
    const out = tempDir();
    writeFakePublicFiles(out);
    for (const name of ["videos.sections.json", "videos.sections.tmp.json"]) {
      fs.writeFileSync(path.join(out, name), "{}");
      assert.ok(checkOutput(out, null).findings.some((x) => x.kind === "실행 기록·작업 파일"), name);
      fs.rmSync(path.join(out, name));
    }
  });
  test("4.2-4 키 없음, 모든 호출 실패, 끊긴 뒤 다시 부르기에서 고르기가 적용되고 받은 영상을 다시 부르지 않는다", async () => {
    const noKey = flow([candidate(1)], { GEMINI_API_KEY: "" });
    fs.writeFileSync(videoWorkFile(noKey.dataDir, "notes"), JSON.stringify({ target: TARGET, finished: true, total: 1, videos: [{ n: 1, videoId: id(1), title: "t", channel: "c", bundle: "kr", note: NOTE }], failures: [], usage: { input: 0, output: 0 }, stop: null, timeLimit: false, costCap: false }));
    writePick(noKey, [pickOf(1)]);
    const k = await sections(noKey);
    assert.equal(k.code, 0);
    assert.equal(k.calls.length, 0);
    assert.equal(cli(noKey, ["video-apply", "--run", noKey.runFile]).code, 0);

    const f = flow([candidate(1), candidate(2)]);
    await notes(f);
    writePick(f, [pickOf(1), pickOf(2)]);
    const leak = JSON.stringify({ error: { status: "WEIRD", message: `가짜 ${FAKE_KEY}` } });
    const all = await sections(f, fake(() => ({ status: 400, body: leak })));
    assert.equal(all.code, 0);
    assert.ok(!all.text.includes(FAKE_KEY));
    assert.ok(!fs.readFileSync(f.runFile, "utf8").includes(FAKE_KEY));
    assert.equal(cli(f, ["video-apply", "--run", f.runFile]).code, 0);

    const f2 = flow([candidate(1), candidate(2)]);
    await notes(f2);
    writePick(f2, [pickOf(1), pickOf(2)]);
    const half = emptySections(TARGET, 9);
    half.videos.push({ n: 1, videoId: id(1), source: "gemini", sections: answerSections });
    writeSections(f2.dataDir, half);
    const again = await sections(f2);
    assert.deepEqual(again.calls.map((c) => c.id), [id(2)]);
    assert.equal(readSections(f2.dataDir, TARGET)?.total, 2, "대상 수는 지금 고르기로 다시 센다");
    const third = await sections(f2);
    assert.equal(third.calls.length, 0, "끝남 표시가 있으면 부르지 않는다");
  });
  test("4.2-5 요약에 수와 달러가 있고 영상 ID, 제목, 응답 본문, 구간 글이 없다", async () => {
    const f = flow([candidate(1, true), candidate(2)]);
    await notes(f);
    writePick(f, [pickOf(1, { sections: writtenChapter }), pickOf(2, { sections: writtenGemini.map((s, i) => ({ ...s, start: [10, 120, 3900][i] })) })]);
    await sections(f);
    assert.equal(cli(f, ["video-apply", "--run", f.runFile]).code, 0);
    const s = cli(f, ["summary", "--run", f.runFile]);
    assert.match(s.text, /구간 시각 받기: 대상 2개, 받음 2개, 실패 0개/);
    assert.match(s.text, /예상 \$0\.00/);
    assert.match(s.text, /구간 정리를 붙인 영상: 2개, 구간을 포기한 영상: 0개/);
    const run = fs.readFileSync(f.runFile, "utf8");
    for (const leak of [id(1), id(2), "가짜 영상 제목", "응답 제목", "응답 내용", "지어낸챕터제목", writtenChapter[0]!.gist]) {
      assert.ok(!s.text.includes(leak), leak);
      assert.ok(!run.includes(leak), leak);
    }
  });
  test("4.5-3 끄는 값을 켜면 3.8 호출이 없고 챕터 영상의 구간은 그대로다", async () => {
    const f = flow([candidate(1, true), candidate(2)]);
    await notes(f);
    writePick(f, [pickOf(1, { sections: writtenChapter }), pickOf(2)]);
    const r = await sections(f, fake(), { stopped: true });
    assert.deepEqual(r.calls.map((c) => c.id), [id(1)]);
    assert.ok(isChapterCall(r.calls[0]!.url));
    assert.match(r.text, /멈춰 두었다/);
    assert.equal(cli(f, ["video-apply", "--run", f.runFile]).code, 0);
    const list = records(f);
    assert.equal(list.find((v) => v.videoId === id(1))!.sections?.length, 3);
    assert.equal(list.find((v) => v.videoId === id(2))!.sections, undefined);
  });
});

describe("9.7단계 4.3 구간 글 검사와 저장", () => {
  const file: CandidateFile = { targetDate: TARGET, fetchedOn: TODAY, candidates: [candidate(1, true), candidate(2)], issues: [] };
  const material: SectionMaterial = { source: "chapter", times: CHAPTERS.map((c) => c.start), texts: [...CHAPTERS.map((c) => c.title), "메모의 구간 내용 1"] };
  const noted = new Set([id(1), id(2)]);
  const materials = new Map([[id(1), material]]);
  const db = () => openDb(path.join(tempDir(), "tidwyn.db"));
  const check = (videos: unknown[]) => {
    const d = db();
    try {
      return checkPickFile(d, { videos }, file, noted, materials);
    } finally {
      d.close();
    }
  };
  const why = (r: ReturnType<typeof check>) => (r.ok ? "" : r.violations.map((v) => `${v.where}: ${v.why}`).join("\n"));
  const withSections = (sections: unknown) => [pickOf(1, { sections }), pickOf(2)];

  test("4.3-1 재료 있는 영상에 키가 없으면 거부, 재료 없는 영상에 구간이나 null이 있으면 거부, 키가 없으면 통과한다", () => {
    assert.match(why(check([pickOf(1), pickOf(2)])), /구간 재료가 있어/);
    assert.match(why(check([pickOf(1, { sections: writtenChapter }), pickOf(2, { sections: writtenChapter })])), /구간 재료가 없어/);
    assert.match(why(check([pickOf(1, { sections: writtenChapter }), pickOf(2, { sections: null })])), /구간 재료가 없어/);
    assert.ok(check(withSections(writtenChapter)).ok);
  });
  test("4.3-1 sections: null이면 그 영상만 구간 없이 통과하고 구간 밖의 위반은 거부된다", () => {
    const r = check(withSections(null));
    assert.ok(r.ok);
    assert.equal(r.videos[0]!.sections, undefined);
    assert.equal(r.videos[0]!.summary, SUMMARY.trim());
    assert.ok(!check([pickOf(1, { sections: null, reason: "" }), pickOf(2)]).ok);
  });
  const rejected: [string, unknown[], RegExp][] = [
    ["2개", writtenChapter.slice(0, 2), /2개다/],
    ["9개", Array.from({ length: 9 }, () => writtenChapter[0]), /9개다/],
    ["빈 제목", [{ ...writtenChapter[0], title: " " }, ...writtenChapter.slice(1)], /비어 있으면/],
    ["31자 제목", [{ ...writtenChapter[0], title: "가".repeat(31) }, ...writtenChapter.slice(1)], /31자다/],
    ["빈 요지", [{ ...writtenChapter[0], gist: "" }, ...writtenChapter.slice(1)], /비어 있으면/],
    ["81자 요지", [{ ...writtenChapter[0], gist: pad(81) }, ...writtenChapter.slice(1)], /81자다/],
    ["불릿 2개", [{ ...writtenChapter[0], points: [pad(120), pad(120)] }, ...writtenChapter.slice(1)], /2개다\(3~5개/],
    ["불릿 6개", [{ ...writtenChapter[0], points: Array.from({ length: 6 }, () => pad(70)) }, ...writtenChapter.slice(1)], /6개다\(3~5개/],
    ["불릿이 배열이 아님", [{ ...writtenChapter[0], points: pad(300) }, ...writtenChapter.slice(1)], /0개다\(3~5개/],
    ["빈 불릿", [{ ...writtenChapter[0], points: [pad(120), pad(120), " "] }, ...writtenChapter.slice(1)], /비어 있으면/],
    ["121자 불릿", [{ ...writtenChapter[0], points: [pad(121), pad(100), pad(100)] }, ...writtenChapter.slice(1)], /121자다/],
    ["합계 299자", [{ ...writtenChapter[0], gist: pad(29), points: [pad(90), pad(90), pad(90)] }, ...writtenChapter.slice(1)], /합계 299자다/],
    ["합계 501자", [{ ...writtenChapter[0], gist: pad(21), points: [pad(120), pad(120), pad(120), pad(120)] }, ...writtenChapter.slice(1)], /합계 501자다/],
    ["주소", [{ ...writtenChapter[0], gist: "www.example.com 참고" }, ...writtenChapter.slice(1)], /주소/],
    ["메일 주소", [{ ...writtenChapter[0], points: ["someone@example.org 참고", ...writtenChapter[0]!.points.slice(1)] }, ...writtenChapter.slice(1)], /메일/],
    ["재료에 없는 시각", [{ ...writtenChapter[0] }, { ...writtenChapter[1], start: 121 }, writtenChapter[2]], /재료에 없는/],
    ["커지지 않는 순서", [writtenChapter[0], writtenChapter[2], writtenChapter[1]], /커지는 순서/],
    ["첫 구간이 첫 시각이 아님", [writtenChapter[1], writtenChapter[2], writtenChapter[2]], /첫 구간/],
    ["챕터 제목 그대로", [{ ...writtenChapter[0], title: "지어낸챕터제목, 시작!" }, ...writtenChapter.slice(1)], /그대로 쓰지/],
    ["메모 내용 그대로", [{ ...writtenChapter[0], gist: "메모의 구간내용 1." }, ...writtenChapter.slice(1)], /그대로 쓰지/],
  ];
  for (const [name, list, re] of rejected) test(`4.3-2 ${name}이면 거부한다`, () => assert.match(why(check(withSections(list))), re));
  test("4.3-2 경계값(3개, 8개, 제목 30자, 요지 80자, 불릿 3개·5개, 120자, 합계 300자·500자)은 통과한다", () => {
    const eight: SectionMaterial = { source: "gemini", times: [0, 1, 2, 3, 4, 5, 6, 7], texts: [] };
    const d = db();
    const list = eight.times.map((start) => ({ start, title: pad(30), gist: pad(80), points: [pad(120), pad(120), pad(120)] }));
    assert.ok(checkPickFile(d, { videos: [pickOf(1, { sections: list }), pickOf(2)] }, file, noted, new Map([[id(1), eight]])).ok);
    d.close();
    for (const body of [{ gist: pad(30), points: [pad(90), pad(90), pad(90)] }, { gist: pad(80), points: [pad(84), pad(84), pad(84), pad(84), pad(84)] }]) {
      assert.ok(check(withSections(writtenChapter.map((s) => ({ ...s, title: pad(30), ...body })))).ok);
    }
  });
  test("4.3-2 요지나 불릿이 재료 안에 그대로 들면 거부하고, 15자 미만은 우연으로 보아 통과한다", () => {
    const sentence = "가짜 탐사선은 궤도를 세 번 바꾼 뒤 돌아왔다";
    const long: SectionMaterial = { source: "gemini", times: writtenChapter.map((s) => s.start), texts: [`앞 문장이다. ${sentence}. 뒤 문장이다.`] };
    const d = db();
    const run = (section: object) => checkPickFile(d, { videos: [pickOf(1, { sections: [{ ...writtenChapter[0], ...section }, ...writtenChapter.slice(1)] }), pickOf(2)] }, file, noted, new Map([[id(1), long]]));
    assert.match(why(run({ gist: sentence })), /그대로 쓰지/);
    assert.match(why(run({ points: [sentence, ...writtenChapter[0]!.points.slice(1)] })), /그대로 쓰지/);
    assert.ok(run({ gist: "궤도를 세 번 바꾼" }).ok);
    d.close();
  });
  test("4.3-2 챕터를 묶어 묶음의 첫 시각을 쓰면 통과한다", () => {
    const many: SectionMaterial = { source: "chapter", times: [0, 60, 120, 180, 240], texts: [] };
    const d = db();
    assert.ok(checkPickFile(d, { videos: [pickOf(1, { sections: [{ ...writtenChapter[0] }, { ...writtenChapter[1], start: 120 }, { ...writtenChapter[2], start: 240 }] }), pickOf(2)] }, file, noted, new Map([[id(1), many]])).ok);
    d.close();
  });
  test("4.3-4 옛 버전 DB를 올려도 값이 그대로이고 구간이 비어 있으며, 저장한 구간과 출처를 돌려준다", () => {
    const dir = tempDir();
    const file8 = path.join(dir, "old.db");
    const old = openDb(file8, MIGRATIONS.filter((m) => m.version <= 9));
    applyVideoPickRaw(old);
    old.close();
    const db2 = openDb(file8);
    const [v] = allVideos(db2);
    assert.equal(v!.title, "옛 제목");
    assert.equal(v!.summary, null);
    assert.equal(v!.sections, undefined);
    applyVideoPick(db2, "2026-10-20", "2026-10-20", [{ ...plainVideo("NewVid0001"), sections: writtenChapter, sectionsSource: "chapter" }]);
    const n = allVideos(db2).find((x) => x.videoId === "NewVid0001");
    assert.deepEqual(n!.sections, writtenChapter);
    assert.equal(n!.sectionsSource, "chapter");
    db2.close();
  });
  test("4.3-4 적용이 실패하면 아무것도 바뀌지 않는다", () => {
    const d = db();
    applyVideoPick(d, TARGET, TODAY, [{ ...plainVideo("KeepVid001"), sections: writtenChapter, sectionsSource: "chapter" }]);
    assert.throws(() => applyVideoPick(d, TARGET, TODAY, [{ ...plainVideo("Broken0001"), issues: [999999] }]));
    assert.deepEqual(allVideos(d).map((v) => v.videoId), ["KeepVid001"]);
    assert.equal(allVideos(d)[0]!.sections?.length, 3);
    d.close();
  });
  function plainVideo(videoId: string): NewVideo {
    return { videoId, bundle: "kr", sources: ["가짜 출처"], title: "옛 제목", channel: "옛 채널", seconds: 900, thumb: "https://i.example.com/a.jpg", publishedAt: "2026-01-01T00:00:00Z", reason: "지어낸 이유", position: 1, issues: [] };
  }
  function applyVideoPickRaw(d: DatabaseSync): void {
    d.prepare("INSERT INTO videos (video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position) VALUES ('OldVid0001', 'kr', '[]', '2026-10-19', '2026-10-19', '옛 제목', '옛 채널', 900, 'x', 'y', '이유', 1)").run();
  }
  test("4.3-5 30일 지운 구간은 DB, 실행 전 사본, 시험 폴더 DB의 바이트에 없고, 이전 스키마 사본도 실패하지 않는다", () => {
    const repo = tempDir();
    const dataDir = path.join(repo, "d");
    const put = (file: string, migrations = MIGRATIONS) => {
      const d = openDb(file, migrations);
      const row = "INSERT INTO videos (video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position";
      if (migrations === MIGRATIONS) d.prepare(`${row}, video_sections, video_sections_source) VALUES ('GoneVid001', 'kr', '[]', '2026-09-01', '2026-09-01', 't', 'c', 1, 'x', 'y', 'r', 1, ?, 'chapter')`).run(JSON.stringify([{ start: 0, title: "지워질구간문자열", text: "지워질구간문자열" }]));
      else d.prepare(`${row}) VALUES ('GoneVid001', 'kr', '[]', '2026-09-01', '2026-09-01', 't', 'c', 1, 'x', 'y', 'r', 1)`).run();
      d.close();
    };
    fs.mkdirSync(path.join(dataDir, "snapshots"), { recursive: true });
    const main = path.join(dataDir, "tidwyn.db");
    const snap = path.join(dataDir, "snapshots", "20261001-060000.db");
    const oldSnap = path.join(dataDir, "snapshots", "20261001-060001.db");
    put(main);
    put(snap);
    put(oldSnap, MIGRATIONS.filter((m) => m.version <= 9));
    const d = openDb(main);
    assert.equal(purgeExpiredRows(d, TODAY), 1);
    d.close();
    assert.ok(!fs.readFileSync(main).includes("지워질구간문자열"));
    const r = purgeDataDir(dataDir, TODAY);
    assert.equal(r.removedSnapshots.length, 0);
    assert.ok(!fs.readFileSync(snap).includes("지워질구간문자열"));
    assert.ok(!fs.readFileSync(oldSnap).includes("GoneVid001"), "이전 스키마 사본도 지운다");
  });
  test("4.3-5 백업에 구간이 없고, 구간 필드를 넣은 백업과 HTML이 검사에 걸리며, 뉴스 sections는 걸리지 않는다", () => {
    const d = db();
    applyVideoPick(d, TARGET, TODAY, [{ ...plainVideo("BackVid001"), sections: writtenChapter, sectionsSource: "chapter" }]);
    const files = buildBackup(d);
    assert.ok(![...Object.values(files)].some((c) => JSON.stringify(c).includes(writtenChapter[0]!.gist)));
    d.close();
    const repo = tempRepo();
    fs.mkdirSync(path.join(repo, "backup"));
    for (const [field, hit] of [["videoSections", true], ["video_sections", true], ["sections", false]] as const) {
      fs.writeFileSync(path.join(repo, "backup", "2026-10.json"), JSON.stringify({ [field]: [] }));
      gitIn(repo, "add", ".");
      gitIn(repo, "commit", "-m", field);
      const head = gitIn(repo, "rev-parse", "HEAD").trim();
      const r = precheck({ repo, commits: [head], trackedFiles: true, home: null });
      assert.equal(r.findings.some((x) => x.kind === "백업 파일에 영상 기록"), hit, field);
    }
    const out = tempDir();
    fs.writeFileSync(path.join(out, "page.html"), '<!doctype html><title>t</title><p>{"videoSections":[]}</p>');
    assert.ok(checkPublicPages(out).some((x) => x.kind === "HTML에 영상 데이터"));
  });
  test("4.3-5·C7 사이트 영상 파일에는 구간이 있고 지난 영상에는 키가 없다", () => {
    const d = db();
    recordFirstCollectionDate(d, TARGET);
    const r = validateBrief(sampleBrief(TARGET), TARGET);
    assert.ok(r.ok);
    saveBrief(d, { brief: r.brief, collectedAt: `${TARGET}T23:00:00+09:00`, late: false });
    applyVideoPick(d, TARGET, TODAY, [{ ...plainVideo("SiteVid001"), sections: writtenChapter, sectionsSource: "chapter" }, { ...plainVideo("SiteVid002"), position: 2 }]);
    const site = buildSiteData(d);
    const text = [...site.entries()].find(([k]) => k.includes(`videos-${TARGET}`))![1];
    const day = JSON.parse(text) as DayVideos;
    assert.equal(day.videos[0]!.hasSections, true);
    assert.ok(!("hasSections" in day.videos[1]!));
    assert.ok(!text.includes(writtenChapter[0]!.gist), "구간 본문은 영상 파일에 없다(C12)");
    const sections = JSON.parse(site.get(`site-data/${siteFiles.videoSections(TARGET)}`)!) as DaySections;
    assert.deepEqual(Object.keys(sections.videoSections), ["SiteVid001"]);
    assert.equal(sections.videoSections["SiteVid001"]![1]!.gist, writtenChapter[1]!.gist);
    d.close();
  });
});

describe("9.7단계 4.3-6 새로 받기", () => {
  const chapterDesc = (mid: string) => `소개\n0:00 시작\n${mid} 가운데\n5:00 끝`;
  const item = (videoId: string, description: string) => ({ id: videoId, snippet: { title: `새 제목 ${videoId}`, channelTitle: "새 채널", publishedAt: "2026-02-02T00:00:00Z", description, thumbnails: { medium: { url: `https://i.example.com/${videoId}.jpg` } } }, contentDetails: { duration: "PT1H" }, liveStreamingDetails: undefined });
  function setup() {
    const f = flow([], { YOUTUBE_API_KEY: "FAKE-YOUTUBE-KEY-0097" });
    const db = openDb(dbFile(f));
    const base = { bundle: "kr" as const, sources: ["가짜"], title: "옛 제목", channel: "옛 채널", seconds: 3600, thumb: "https://i.example.com/old.jpg", publishedAt: "2026-01-01T00:00:00Z", reason: "지어낸 이유", issues: [] };
    const zap = [{ start: 0, title: "남으면안되는제목", gist: "남으면안되는구간글", points: ["남으면안되는불릿"] }, { start: 120, title: "둘", gist: "둘", points: [] }, { start: 300, title: "셋", gist: "셋", points: [] }];
    applyVideoPick(db, "2026-10-20", "2026-10-20", [
      { ...base, videoId: "KeepChap01", position: 1, sections: zap.map((s) => ({ ...s, title: `유지 ${s.start}`, gist: `유지 ${s.start}` })), sectionsSource: "chapter" },
      { ...base, videoId: "MoveChap01", position: 2, sections: zap, sectionsSource: "chapter" },
      { ...base, videoId: "GoneChap01", position: 3, sections: zap.map((s) => ({ ...s, title: `없어짐${s.start}`, gist: "없어짐" })), sectionsSource: "chapter" },
      { ...base, videoId: "MissingVd1", position: 5, sections: zap.map((s) => ({ ...s, title: `응답없음${s.start}`, gist: "응답에없어사라질구간글" })), sectionsSource: "gemini" },
      { ...base, videoId: "GeminiVid1", position: 4, sections: [{ start: 7, title: "g", gist: "g", points: [] }, { start: 8, title: "g", gist: "g", points: [] }, { start: 9, title: "g", gist: "g", points: [] }], sectionsSource: "gemini" },
    ]);
    db.close();
    return f;
  }
  const http: YoutubeHttp = async () => ({ status: 200, body: JSON.stringify({ items: [item("KeepChap01", chapterDesc("2:00")), item("MoveChap01", chapterDesc("2:10")), item("GoneChap01", "챕터 없는 설명"), item("GeminiVid1", "달라진 설명")] }) });

  test("챕터가 그대로면 유지, 시각이 바뀌거나 조건을 못 채우면 구간만 지워지고 바이트에 없으며, Gemini 출처는 유지한다", async () => {
    const f = setup();
    const ctx = { ...makeCtx(f.repo, f.env, NOW), youtubeHttp: http, youtubeRetryGapMs: 0 };
    assert.equal(await mainAsync(["video-refresh", "--run", f.runFile], ctx), 0, ctx.text());
    const list = records(f);
    const by = (x: string) => list.find((v) => v.videoId === x)!;
    assert.equal(list.length, 4, "영상 기록은 남는다");
    assert.equal(by("KeepChap01").sections?.length, 3);
    assert.equal(by("KeepChap01").sections![0]!.title, "유지 0", "글을 바꾸지 않는다");
    assert.equal(by("MoveChap01").sections, undefined);
    assert.equal(by("MoveChap01").sectionsSource, undefined);
    assert.equal(by("GoneChap01").sections, undefined);
    assert.equal(by("GeminiVid1").sections?.length, 3);
    assert.equal(by("MoveChap01").title, "새 제목 MoveChap01");
    const bytes = fs.readFileSync(dbFile(f));
    assert.ok(!bytes.includes("남으면안되는구간글"));
    assert.ok(!bytes.includes("응답에없어사라질구간글"), "응답에 없어 지운 영상의 구간도 바이트에 없다");
    assert.ok(!bytes.includes("달라진 설명"), "설명을 저장하지 않는다");
    assert.match(ctx.text(), /구간 정리를 지운 영상: 2개/);
    assert.equal(readRun(f.runFile).videoRefresh?.sectionsRemoved, 2);
  });
});

describe("9.7단계 4.1-1·4.3 끝까지 흐름", () => {
  test("적용 뒤 지어낸 챕터 제목이 DB 바이트, 실행 기록, 사이트 입력, 백업에 없고 작업 파일이 지워진다", async () => {
    const f = flow([candidate(1, true), candidate(2)]);
    await notes(f);
    writePick(f, [pickOf(1, { sections: writtenChapter }), pickOf(2, { sections: writtenGemini })]);
    await sections(f);
    const c = cli(f, ["video-check", "--run", f.runFile]);
    assert.equal(c.code, 0, c.text);
    assert.equal(cli(f, ["video-apply", "--run", f.runFile]).code, 0);
    assert.ok(!fs.existsSync(videoWorkFile(f.dataDir, "sections")));
    assert.ok(!fs.existsSync(videoWorkFile(f.dataDir, "notes")));
    const db = openDb(dbFile(f));
    db.exec("VACUUM");
    const site = [...buildSiteData(db).values()].join("");
    const backup = JSON.stringify(buildBackup(db));
    db.close();
    const list = records(f);
    assert.equal(list.find((v) => v.videoId === id(1))!.sectionsSource, "chapter");
    assert.equal(list.find((v) => v.videoId === id(2))!.sectionsSource, "gemini");
    for (const place of [fs.readFileSync(dbFile(f)).toString("latin1"), Buffer.from(site).toString("latin1"), Buffer.from(backup).toString("latin1"), fs.readFileSync(f.runFile).toString("latin1")]) {
      assert.ok(!place.includes(Buffer.from("지어낸챕터제목").toString("latin1")));
      assert.ok(!place.includes(Buffer.from("응답 제목").toString("latin1")));
    }
  });
});
