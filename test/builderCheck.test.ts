import assert from "node:assert/strict";
import fs from "node:fs";
import { after, describe, test } from "node:test";
import { applyBuilderPlan, checkBuilderFile, markBuilderFailed } from "../src/builderCheck.ts";
import { allPending, allRows, builderItemsOfDate, builderStatusOf, emittedKeys, isBuilderDone, sourceState } from "../src/builderStore.ts";
import { buildWorkData, type BuilderWorkData } from "../src/builderWork.ts";
import { MIGRATIONS, openDb } from "../src/db.ts";
import { createIssue } from "../src/issues.ts";
import { HOUR, NOW, TARGET, apply, atom, env, fakeHttp, item, itemsFile, release, rss, run, type Env } from "./builderFixtures.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import path from "node:path";

after(cleanupTemp);

const iso = (h: number) => new Date(NOW.getTime() - h * HOUR).toISOString();
const MATERIAL = "Starting January 14, 2027 the fake default model changes for every workspace that has not opted out of the new behavior yet, and November 1st matters too";

async function work(e: Env, opts: { tentative?: boolean } = {}): Promise<BuilderWorkData> {
  const feed = rss([
    { title: "Fake model change", link: "https://platform.claude.com/docs/a", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: MATERIAL },
    { title: "Fake second change", link: "https://platform.claude.com/docs/b", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: "Second note about @modelcontextprotocol/sdk" },
  ]);
  const r = await run(e, fakeHttp({ "claude-notes": feed }));
  const w = buildWorkData(e.db, r);
  if (opts.tentative) w.candidates[0]!.tentative = true;
  return w;
}

const check = (e: Env, w: BuilderWorkData, items: Record<string, unknown>[]) => checkBuilderFile(e.db, itemsFile(w, items), w, { home: "/Users/fakehome", secrets: ["FAKESECRETVALUE123"] });

function rejects(e: Env, w: BuilderWorkData, items: Record<string, unknown>[], re: RegExp): void {
  const c = check(e, w, items);
  assert.equal(c.ok, false, `거부되어야 한다: ${JSON.stringify(items).slice(0, 120)}`);
  if (!c.ok) assert.ok(c.violations.some((v) => re.test(`${v.where} ${v.why}`)), JSON.stringify(c.violations));
}

function passes(e: Env, w: BuilderWorkData, items: Record<string, unknown>[]): void {
  const c = check(e, w, items);
  assert.ok(c.ok, c.ok ? "" : JSON.stringify(c.violations));
}

describe("4.3-2 검사 거부", () => {
  test("개수, 분야, 빈 칸, 칸별 상한", async () => {
    const e = env();
    const w = await work(e);
    const n = w.candidates[0]!.n;
    rejects(e, w, [1, 2, 3, 4, 5].map(() => item([n])), /5개다/);
    rejects(e, w, [item([n], { field: "기타" })], /분야/);
    for (const k of ["title", "whatChanged", "who", "action", "why"]) rejects(e, w, [item([n], { [k]: "" })], /비어/);
    const limits: [string, number][] = [["title", 60], ["whatChanged", 300], ["who", 100], ["action", 150], ["why", 100]];
    for (const [k, max] of limits) {
      rejects(e, w, [item([n], { [k]: "가".repeat(max + 1) })], /자다/);
      passes(e, w, [item([n], { [k]: "가".repeat(max) })]);
    }
  });

  test("경계값: 0개, 4개는 통과한다", async () => {
    const e = env();
    const w = await work(e);
    w.candidates.push(...[3, 4].map((n) => ({ ...w.candidates[0]!, n, keys: [`https://x/${n}`] })));
    passes(e, w, []);
    passes(e, w, [1, 2, 3, 4].map((n) => item([n])));
  });

  test("후보에 없는 번호, 후보 출처가 아닌 출처, 같은 후보 중복", async () => {
    const e = env();
    const w = await work(e);
    rejects(e, w, [item([99])], /99번 후보가 없다/);
    rejects(e, w, [item([1], { sources: ["https://platform.claude.com/docs/b"] })], /출처/);
    rejects(e, w, [item([1]), item([1])], /두 항목/);
  });

  test("기한: 재료에 없는 날짜, 잠정·달 단위의 확정, 일정 이름, 730일 범위", async () => {
    const e = env();
    const w = await work(e);
    const due = (d: Record<string, unknown>) => item([1], { due: d });
    rejects(e, w, [due({ date: "2027-02-02", state: "tentative" })], /재료 글에 없다/);
    rejects(e, w, [due({ date: "2027-01-14", state: "confirmed" })], /일정 이름/);
    rejects(e, w, [due({ date: "2027-01-14", state: "confirmed", schedule: "가".repeat(41) })], /일정 이름/);
    passes(e, w, [due({ date: "2027-01-14", state: "confirmed", schedule: "fake-model 종료" })]);
    passes(e, w, [due({ date: "2027-01-14", state: "tentative" })]);
    const tw = await work(env(), { tentative: true });
    rejects(e, tw, [due({ date: "2027-01-14", state: "confirmed", schedule: "fake-model 종료" })], /잠정/);
    const m = await work(env());
    m.candidates[0]!.material = "In July 2027 the fake model ends and on 2029-06-01 the other, and 2026-10-27";
    rejects(e, m, [due({ date: "2027-07", state: "confirmed", schedule: "x 종료" })], /달 단위/);
    passes(e, m, [due({ date: "2027-07", state: "tentative" })]);
    rejects(e, m, [due({ date: "2029-06-01", state: "confirmed", schedule: "x 종료" })], /까지여야/);
    rejects(e, m, [due({ date: "2026-10-27", state: "confirmed", schedule: "x 종료" })], /까지여야/);
  });

  test("서수 날짜와 연도 없는 날짜는 통과한다", async () => {
    const e = env();
    const w = await work(e);
    w.candidates[0]!.material = "Ends March 31st, 2027 and November 1st";
    w.candidates[0]!.publishedOn = "2026-10-27";
    passes(e, w, [item([1], { due: { date: "2027-03-31", state: "tentative" } })]);
    passes(e, w, [item([1], { due: { date: "2026-11-01", state: "tentative" } })]);
  });

  test("복사(12단어 이어짐, 문장 부호 무시)와 그 아래는 통과", async () => {
    const e = env();
    const w = await work(e);
    const words = MATERIAL.split(" ");
    rejects(e, w, [item([1], { whatChanged: `${words.slice(0, 12).join(" , ")}` })], /그대로 옮겼다/);
    passes(e, w, [item([1], { whatChanged: words.slice(0, 11).join(" ") })]);
  });

  test("빈 틀 문구, `지금 할 일`의 없음 허용, 15단어 이상 인용, 없는 이슈", async () => {
    const e = env();
    const w = await work(e);
    rejects(e, w, [item([1], { who: "해당 없음" })], /빈 틀/);
    rejects(e, w, [item([1], { why: "TBD" })], /빈 틀/);
    passes(e, w, [item([1], { action: "없음" })]);
    const quote = `"${Array.from({ length: 15 }, (_, i) => `단어${i}`).join(" ")}"`;
    rejects(e, w, [item([1], { whatChanged: quote })], /인용|단어/);
    rejects(e, w, [item([1], { issue: 999 })], /이슈 999/);
    const issue = createIssue(e.db, { name: "가짜 이슈", aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: "요약이다." });
    passes(e, w, [item([1], { issue })]);
  });

  test("칸 안의 주소, 메일, @계정, 결과물 거부 글, 공개 검사(글, 일정 이름, 출처, 키). 패키지 범위는 통과", async () => {
    const e = env();
    const w = await work(e);
    rejects(e, w, [item([1], { whatChanged: "자세한 내용은 https://x.test 를 본다" })], /주소/);
    rejects(e, w, [item([1], { whatChanged: `연락처 ${["fake", "corp.example"].join("@")}` })], /메일/);
    rejects(e, w, [item([1], { who: "@fakeuser 계정의 제보" })], /@계정/);
    rejects(e, w, [item([1], { whatChanged: "연락처 user@example.com" })], /메일/);
    passes(e, w, [item([1], { who: "@modelcontextprotocol/sdk 사용자" })]);
    rejects(e, w, [item([1], { whatChanged: "video-sections-1.json 파일" })], /결과물 검사/);
    rejects(e, w, [item([1], { whatChanged: `토큰 ghp_${"a".repeat(36)}` })], /토큰/);
    rejects(e, w, [item([1], { why: "FAKESECRETVALUE123 값" })], /키 값/);
    rejects(e, w, [item([1], { due: { date: "2027-01-14", state: "confirmed", schedule: `ghp_${"b".repeat(36)}` } })], /일정 이름/);
    w.candidates[0]!.url = `https://platform.claude.com/ghp_${"c".repeat(36)}`;
    rejects(e, w, [item([1])], /출처/);
    const w2 = await work(env());
    w2.candidates[0]!.keys = [`num:ghp_${"d".repeat(36)}`];
    rejects(e, w2, [item([1])], /키/);
    w2.candidates[0]!.keys = ["npm:user@example.com"];
    rejects(e, w2, [item([1])], /메일/);
  });

  test("이미 실린 항목을 더해 그날 4건을 넘으면 거부한다", async () => {
    const e = env();
    const w = await work(e);
    w.candidates.push(...[3, 4, 5].map((n) => ({ ...w.candidates[0]!, n, title: `다른${n}`, url: `https://platform.claude.com/docs/${n}`, keys: [`k:${n}`] })));
    const three = [1, 2, 3].map((n) => item([n]));
    const c = check(e, w, three);
    assert.ok(c.ok);
    applyBuilderPlan(e.db, c.plan, { ...w, status: "failed" }, { home: null });
    rejects(e, w, [item([4]), item([5])], /4건 이하/);
    passes(e, w, [item([4])]);
  });
});

describe("4.3-4 저장", () => {
  test("항목, 키, 상태가 저장되고 두 번 적용이 같으며 고르지 않은 후보는 저장되지 않는다", async () => {
    const e = env();
    const w = await work(e);
    const c = check(e, w, [item([1])]);
    assert.ok(c.ok);
    assert.equal(applyBuilderPlan(e.db, c.plan, w, { home: null }).status, "applied");
    const items = builderItemsOfDate(e.db, TARGET);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0]!.keys, ["https://platform.claude.com/docs/a"]);
    assert.equal(items[0]!.key, "builder-1");
    assert.equal(builderStatusOf(e.db, TARGET), "checked");
    assert.equal(applyBuilderPlan(e.db, c.plan, w, { home: null }).status, "nothing");
    assert.equal(builderItemsOfDate(e.db, TARGET).length, 1);
  });

  test("항목이 있는 날짜에 빈 목록을 적용해도 항목이 남는다", async () => {
    const e = env();
    const w = await work(e);
    const c = check(e, w, [item([1])]);
    assert.ok(c.ok);
    applyBuilderPlan(e.db, c.plan, { ...w, status: "failed" }, { home: null });
    const c2 = check(e, w, []);
    assert.ok(c2.ok);
    applyBuilderPlan(e.db, c2.plan, w, { home: null });
    assert.equal(builderItemsOfDate(e.db, TARGET).length, 1);
    assert.equal(isBuilderDone(e.db, TARGET), true);
  });

  test("적용이 실패하면 아무것도 바뀌지 않는다", async () => {
    const e = env();
    const w = await work(e);
    const c = check(e, w, [item([1])]);
    assert.ok(c.ok);
    const bad = structuredClone(c.plan);
    bad.items[0]!.issue = 12345; // 외래 키 위반으로 트랜잭션이 깨진다
    assert.throws(() => applyBuilderPlan(e.db, bad, w, { home: null }));
    assert.equal(builderItemsOfDate(e.db, TARGET).length, 0);
    assert.equal(builderStatusOf(e.db, TARGET), null);
    assert.equal(sourceState(e.db, "claude-notes").fetchedAt, null);
  });

  test("옛 버전 DB 모양을 올려도 기존 값이 그대로다", () => {
    const file = path.join(tempDir(), "old.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 10));
    old.prepare("INSERT INTO schedules (name, due, major) VALUES (?, ?, ?)").run("옛 일정", "2026-11-01", "경제");
    old.close();
    const db = openDb(file);
    assert.equal((db.prepare("SELECT name FROM schedules").get() as { name: string }).name, "옛 일정");
    assert.equal(db.prepare("SELECT count(*) AS n FROM builder_items").get()!.n, 0);
    db.close();
    assert.ok(fs.existsSync(file));
  });
});

describe("4.3-5 실패 격리", () => {
  test("모두 성공은 확인함, 일부 실패는 일부만 확인, 모두 실패는 받지 못함이고 시각은 그대로다", async () => {
    const a = env();
    apply(a, await run(a, fakeHttp()));
    assert.equal(builderStatusOf(a.db, TARGET), "checked");
    const b = env();
    apply(b, await run(b, fakeHttp({ vite: { status: 500, text: "x" } })));
    assert.equal(builderStatusOf(b.db, TARGET), "partial");
    assert.equal(isBuilderDone(b.db, TARGET), true);
    const c = env();
    const bad = fakeHttp();
    bad.http = async () => ({ status: 500, text: "x" });
    const r = await run(c, bad);
    assert.equal(r.status, "failed");
    apply(c, r);
    assert.equal(builderStatusOf(c.db, TARGET), "failed");
    assert.equal(isBuilderDone(c.db, TARGET), false);
    assert.equal(sourceState(c.db, "vite").fetchedAt, null);
  });

  test("받지 못함 저장은 끝난 날짜를 바꾸지 않고 항목을 지우지 않으며 시각을 두고, 미적용 변경도 둔다", async () => {
    const e = env();
    const doc = (p: string) => `| Model | Price |\n|---|---|\n| fake-1 | ${p} |\n| fake-2 | $2 |\n`;
    apply(e, await run(e, fakeHttp({ "openai-pricing": doc("$1") })));
    assert.equal(markBuilderFailed(e.db, TARGET), false);
    assert.equal(builderStatusOf(e.db, TARGET), "checked");
    await run(e, fakeHttp({ "openai-pricing": doc("$9") }), { target: "2026-10-28", now: new Date(NOW.getTime() + 24 * HOUR) });
    assert.equal(markBuilderFailed(e.db, "2026-10-28"), true);
    assert.equal(builderStatusOf(e.db, "2026-10-28"), "failed");
    assert.equal(allPending(e.db).length, 2);
    assert.equal(sourceState(e.db, "openai-pricing").fetchedAt, NOW.toISOString());
  });

  test("공개 검사에 걸리는 후보 키는 빼고 경고로 남긴다", async () => {
    const e = env();
    const r = await run(e, fakeHttp({ vercel: atom([{ title: `Fake pricing`, link: `https://vercel.com/ghp_${"e".repeat(36)}`, date: iso(1) }]) }));
    assert.equal(r.drafts.length, 0);
    assert.equal(r.droppedByScan, 1);
  });

  test("낸 키도 저장 전에 공개 검사를 지난다", async () => {
    const e = env();
    const r = await run(e, fakeHttp());
    r.drafts.push({ kind: "deprecation", field: "프레임워크", source: "eol-nodejs", sourceLabel: "x", title: "x", material: "x", url: "https://endoflife.date/nodejs", keys: [`eol:nodejs:ghp_${"f".repeat(36)}`], reason: "r", publishedOn: null, tentative: true });
    apply(e, r);
    assert.equal(emittedKeys(e.db).size, 0);
  });

  test("숫자 행은 적용 전에도 남는다", async () => {
    const e = env();
    await run(e, fakeHttp());
    assert.ok(allRows(e.db).length > 0);
  });
});

describe("코딩 도구 후보로 쓰기", () => {
  test("키가 그대로 실리고 다음 실행에 빠진다", async () => {
    const e = env();
    const body = JSON.stringify([release("v1.0.1", iso(1), "- breaking")]);
    apply(e, await run(e, fakeHttp({ "claude-code": body })), [item([1])]);
    const again = JSON.stringify([release("v1.0.1", iso(-1), "- breaking")]);
    const r2 = await run(e, fakeHttp({ "claude-code": again }), { target: "2026-10-28", now: new Date(NOW.getTime() + 2 * HOUR) });
    assert.equal(r2.drafts.length, 0);
    assert.equal(r2.droppedByKey, 1);
  });
});
