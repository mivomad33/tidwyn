import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { deprecationOf, keyedDeprecations, parseDocRows, readDates } from "../src/builderDocs.ts";
import { applyBuilderPlan } from "../src/builderCheck.ts";
import { BUILDER_RAW_DIR } from "../src/builderFetch.ts";
import { buildWorkData } from "../src/builderWork.ts";
import { allPending, allRows, deletePending, liveRows } from "../src/builderStore.ts";
import { apply, docSpec, env, fakeHttp, nextDay, run } from "./builderFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

after(cleanupTemp);

const table = (head: string, rows: string[]) => [`| ${head} |`, `|${head.split("|").map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r} |`)].join("\n");
const pricing = (rows: string[]) => `## Models\n\n${table("Model | Input", rows)}\n`;
const ID = "openai-pricing";

async function base(e: ReturnType<typeof env>, body: string, id = ID): Promise<void> {
  apply(e, await run(e, fakeHttp({ [id]: body })));
}

describe("4.2-1 행 비교", () => {
  test("숫자가 바뀐 행은 후보가 되고 후보에 제목이 나온다", async () => {
    const e = env();
    await base(e, pricing(["fake-1 | $1", "fake-2 | $2"]));
    const r = await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $3", "fake-2 | $2"]) }), nextDay(1));
    assert.equal(r.drafts.length, 1);
    assert.equal(r.drafts[0]!.kind, "number");
    assert.match(r.drafts[0]!.material, /바뀌기 전:\n- Models · Model \| Input · fake-1 \| \$1\n바뀐 뒤:\n- Models · Model \| Input · fake-1 \| \$3/);
    assert.equal(r.drafts[0]!.keys.length, 2);
    assert.ok(r.drafts[0]!.keys.every((k) => k.startsWith("num:openai:2026-10-29:")));
  });

  test("같은 행이 두 제목 아래 있을 때 하나만 바뀌어도 후보가 된다", async () => {
    const e = env();
    const doc = (a: string, b: string) => `## Opus\n\n${table("Tier | Input", [`Base | ${a}`])}\n\n## Sonnet\n\n${table("Tier | Input", [`Base | ${b}`])}\n`;
    await base(e, doc("$1", "$1"));
    const r = await run(e, fakeHttp({ [ID]: doc("$1", "$2") }), nextDay(1));
    assert.equal(r.drafts.length, 1);
    assert.match(r.drafts[0]!.material, /Sonnet/);
    assert.ok(!r.drafts[0]!.material.includes("Opus"));
    apply(e, r);
    const swapped = await run(e, fakeHttp({ [ID]: doc("$2", "$1") }), nextDay(2));
    assert.equal(swapped.drafts.length, 1, "행 글이 같아도 제목이 다르면 구별된다");
  });

  test("머리행 없는 표, 들여쓴 표, 칸 공백 줄이기, <Tab title>", () => {
    const noHead = parseDocRows("| fake-1 | $1 |\n| fake-2 | $2 |\n");
    assert.deepEqual(noHead.rows.map((r) => r.row), ["fake-1 | $1", "fake-2 | $2"]);
    const indented = parseDocRows(`    ${table("Model | Input", ["fake-1 | $1"]).replaceAll("\n", "\n    ")}\n`);
    assert.deepEqual(indented.rows.map((r) => [r.header, r.row]), [["Model | Input", "fake-1 | $1"]]);
    const spaced = parseDocRows(`| fake-1${" ".repeat(250)}| $1 |\n`);
    assert.equal(spaced.rows.length, 1);
    assert.equal(spaced.tooLong, 0);
    const tabs = parseDocRows(`## Pricing\n<Tabs>\n<Tab title="Batch">\n${table("Model | Input", ["fake-1 | $1"])}\n</Tab>\n</Tabs>\n`);
    assert.equal(tabs.rows[0]!.path, "Pricing > Batch");
  });

  test("탭이 먼저 닫힌 뒤의 </Tab>은 위 제목 경로를 지우지 않는다", () => {
    const parsed = parseDocRows(`# Models\n## Pricing\n<Tab title="Batch">\n## Limits\n</Tab>\n${table("Model | Input", ["fake-1 | $1"])}\n`);
    assert.equal(parsed.rows[0]!.path, "Models > Limits");
  });

  test("표가 될 수 없게 긴 줄은 정규식에 넣지 않고 긴 행으로 센다", () => {
    const started = Date.now();
    const parsed = parseDocRows(`| ${"<a".repeat(200_000)} |\n|${"-".repeat(200_000)}x\n# ${" ".repeat(200_000)}x\n| fake-1 | $1 |\n`);
    assert.equal(parsed.tooLong, 2);
    assert.deepEqual(parsed.rows.map((r) => r.row), ["fake-1 | $1"]);
    assert.ok(Date.now() - started < 10_000, "받은 글의 길이에 제곱으로 느려지지 않는다");
  });

  test("표 사이의 지나치게 긴 문단도 표를 나눈다", () => {
    const parsed = parseDocRows(`${table("Model | Input", ["fake-1 | $1"])}\n${"x".repeat(20_000)}\n${table("Name | Output", ["fake-2 | $2"])}\n`);
    assert.deepEqual(parsed.rows.map((r) => [r.header, r.row]), [["Model | Input", "fake-1 | $1"], ["Name | Output", "fake-2 | $2"]]);
  });

  test("행 순서만 바뀌거나 공백만 바뀐 문서는 후보도 숫자 행 저장도 없다", async () => {
    const e = env();
    await base(e, pricing(["fake-1 | $1", "fake-2 | $2"]));
    const before = allRows(e.db).length;
    const r = await run(e, fakeHttp({ [ID]: pricing(["fake-2   |   $2", "fake-1 | $1"]) }), nextDay(1));
    assert.equal(r.drafts.length, 0);
    assert.equal(allRows(e.db).length, before);
  });

  test("문서별 첫 실행은 저장하고 지원 종료의 미래 확정 행만 후보가 되며 가격·한도, 잠정, 지난 날짜는 후보가 없다", async () => {
    const e = env();
    const dep = table("Model | Shutdown date", ["future-1 | 2027-03-01", "past-1 | 2020-01-01", "maybe-1 | 2027-04-01 at earliest"]);
    const r = await run(e, fakeHttp({ "openai-deprecations": dep, [ID]: pricing(["fake-1 | $1"]) }));
    const list = r.drafts.filter((d) => d.source.startsWith("openai"));
    assert.deepEqual(list.map((d) => d.keys), [["deprecation:future-1:2027-03-01:확정"]]);
    assert.equal(liveRows(e.db, "openai-deprecations").length, 3);
    assert.equal(liveRows(e.db, ID).length, 1);
  });

  test("한 문서만 첫날 실패해도 다음 날 그 문서가 첫 실행이다", async () => {
    const e = env();
    apply(e, await run(e, fakeHttp({ [ID]: { status: 500, text: "x" } })));
    const r = await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $9"]) }), nextDay(1));
    assert.equal(r.drafts.length, 0);
    assert.equal(r.docs.find((d) => d.doc === ID)!.first, true);
  });

  test("같은 날짜의 행은 후보 하나로 묶이고, 고르지 않은 기한은 7번까지 나오며 실패한 실행은 세지 않는다", async () => {
    const e = env();
    const dep = table("Model | Shutdown date", ["future-1 | 2027-03-01", "future-2 | 2027-03-01"]);
    const reply = { "openai-deprecations": dep };
    const first = await run(e, fakeHttp(reply));
    assert.equal(first.drafts.length, 1);
    assert.equal(first.drafts[0]!.keys.length, 2);
    apply(e, first);
    let day = 1;
    // 실패한 실행(모든 소스 실패)은 세지 않는다
    const allFail = fakeHttp();
    allFail.http = async () => ({ status: 500, text: "x" });
    const failed = await run(e, allFail, nextDay(day));
    assert.equal(failed.status, "failed");
    assert.equal(failed.drafts.length, 1, "받지 못해도 미적용 변경은 후보다");
    apply(e, failed);
    assert.equal(allPending(e.db)[0]!.emits, 1);
    for (; day <= 5; day++) apply(e, await run(e, fakeHttp(reply), nextDay(day)));
    const seventh = await run(e, fakeHttp(reply), nextDay(day));
    assert.equal(seventh.drafts.length, 1, "일곱째 실행까지 나온다");
    apply(e, seventh);
    assert.equal((await run(e, fakeHttp(reply), nextDay(day + 1))).drafts.length, 0, "7번 낸 뒤에는 나오지 않는다");
  });

  test("잘린 지원 종료 후보는 횟수를 세지 않고, 고르지 않은 잠정 후보는 적용 뒤 나오지 않는다", async () => {
    const e = env();
    const id = "openai-deprecations";
    apply(e, await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["future-1 | 2027-03-01", "maybe-1 | 2020-01-01"]) })));
    assert.equal(allPending(e.db)[0]!.emits, 1);
    const r = await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["future-1 | 2027-03-01", "maybe-1 | 2027-04-01 at earliest"]) }), nextDay(1));
    assert.ok(r.drafts.some((d) => d.tentative));
    const work = buildWorkData(e.db, r);
    for (const c of work.candidates) if (!c.tentative) c.cut = true;
    applyBuilderPlan(e.db, { target: work.target, items: [] }, work, { home: null });
    assert.deepEqual(allPending(e.db).map((p) => [p.kind, p.emits]), [["deprecation", 1]]);
  });

  test("실리면 나오지 않고, 예정일이 대상 날짜 이하가 되면 나오지 않는다", async () => {
    const e = env();
    const dep = table("Model | Shutdown date", ["future-1 | 2026-10-30", "future-2 | 2027-03-01"]);
    const reply = { "openai-deprecations": dep };
    const r = await run(e, fakeHttp(reply));
    const n = r.drafts.findIndex((d) => d.due === "2027-03-01") + 1;
    apply(e, r, [{ field: "모델", title: "가짜 모델 종료", whatChanged: "가짜 모델이 종료된다", who: "가짜 모델 사용자", action: "옮긴다", why: "기한이 있다", due: { date: "2027-03-01", state: "confirmed", schedule: "future-2 종료" }, sources: [], candidates: [n] }]);
    const d = nextDay(5);
    const r2 = await run(e, fakeHttp(reply), d);
    assert.equal(r2.drafts.length, 0, "실린 기한도 지난 기한도 나오지 않는다");
  });

  test("실리기 전에 날짜가 바뀌면 옛 날짜 후보는 나오지 않고 새 날짜 후보만 나오며, 일부만 남으면 남은 행으로 낸다", async () => {
    const e = env();
    apply(e, await run(e, fakeHttp({ "openai-deprecations": table("Model | Shutdown date", ["a-1 | 2027-03-01", "b-1 | 2027-03-01"]) })));
    const r = await run(e, fakeHttp({ "openai-deprecations": table("Model | Shutdown date", ["a-1 | 2027-05-01", "b-1 | 2027-03-01"]) }), nextDay(1));
    const keys = r.drafts.flatMap((d) => d.keys).sort();
    assert.deepEqual(keys, ["deprecation:a-1:2027-05-01:확정", "deprecation:b-1:2027-03-01:확정"]);
  });

  test("숫자 없는 행과 200자 넘는 행은 저장되지 않고 빠진 수에 세어진다", async () => {
    const e = env();
    const r = await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $1", "fake-only | free", `long-1 | ${"x".repeat(210)}`]) }));
    const d = r.docs.find((x) => x.doc === ID)!;
    assert.deepEqual([d.rows, d.noNumber, d.tooLong], [1, 1, 1]);
    assert.equal(liveRows(e.db, ID).length, 1);
  });

  test("메일이나 토큰 모양이 든 행은 저장되지 않고 경고 수가 오르며 나머지는 계속되고, 링크를 벗긴 글로 검사한다", async () => {
    const e = env();
    const mail = ["fake-user", "corp.example"].join("@");
    const token = `ghp_${"a".repeat(36)}`;
    const r = await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $1", `${mail} | $2`, `tok | ${token} 3`, `[fake-3](https://x.test/${mail}) | $3`]) }));
    const d = r.docs.find((x) => x.doc === ID)!;
    assert.equal(d.rejected, 2);
    assert.deepEqual(liveRows(e.db, ID).map((x) => x.row).sort(), ["fake-1 | $1", "fake-3 | $3"]);
    assert.ok(r.warnings.some((w) => w.includes("2개")));
  });

  test("Gemini는 잠정, Anthropic 공지 이력은 확정, 같은 모델·날짜면 확정, at earliest는 잠정이다", () => {
    const gemini = keyedDeprecations(docSpec("gemini-deprecations"), parseDocRows(table("Model | Shutdown date", ["gem-1 | 2027-02-01"])).rows);
    assert.equal(gemini[0]!.tentative, true);
    const anth = docSpec("anthropic-deprecations");
    const status = `${table("API Model Name | Current State | Tentative Retirement Date", ["claude-x | Active | 2027-06-01"])}\n\n${table("Retirement Date | Deprecated Model | Replacement", ["2027-06-01 | claude-x | claude-y", "2027-07-01 | claude-z | claude-y"])}\n`;
    const rows = keyedDeprecations(anth, parseDocRows(status).rows);
    assert.deepEqual([...new Set(rows.map((r) => r.key))].sort(), ["deprecation:claude-x:2027-06-01:확정", "deprecation:claude-z:2027-07-01:확정"]);
    const only = keyedDeprecations(anth, parseDocRows(table("API Model Name | Current State | Tentative Retirement Date", ["claude-q | Active | Not sooner than 2027-06-01"])).rows);
    assert.equal(only[0]!.tentative, true);
    const r = parseDocRows(table("Shutdown date | Model", ["2027-02-01 at earliest | gpt-fake"])).rows[0]!;
    assert.deepEqual(deprecationOf({}, r), { models: ["gpt-fake"], due: "2027-02-01", tentative: true });
  });

  test("잠정 키가 실린 뒤 같은 날짜의 확정과 같은 모델의 종료일 변경은 후보로 남는다", async () => {
    const e = env();
    const id = "openai-deprecations";
    apply(e, await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["other-1 | 2027-01-01"]) })));
    const added = await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["other-1 | 2027-01-01", "m-1 | 2027-03-01 at earliest"]) }), nextDay(1));
    const draft = added.drafts.find((d) => d.tentative)!;
    const n = added.drafts.indexOf(draft) + 1;
    apply(e, added, [{ field: "모델", title: "잠정 종료 소식", whatChanged: "가짜 모델 종료가 잠정 공지됐다", who: "가짜 모델 사용자", action: "없음", why: "기한이 있다", due: { date: "2027-03-01", state: "tentative" }, sources: [], candidates: [n] }]);
    const conf = await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["other-1 | 2027-01-01", "m-1 | 2027-03-01"]) }), nextDay(2));
    assert.ok(conf.drafts.some((d) => d.keys.includes("deprecation:m-1:2027-03-01:확정")));
    const moved = await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["other-1 | 2027-01-01", "m-1 | 2027-04-01"]) }), nextDay(3));
    assert.ok(moved.drafts.some((d) => d.keys.includes("deprecation:m-1:2027-04-01:확정")));
  });

  test("같은 문서의 다음 가격 변경과 A→B→A로 되돌아간 가격은 후보로 남는다", async () => {
    const e = env();
    await base(e, pricing(["fake-1 | $1", "fake-2 | $2"]));
    let d = nextDay(1);
    apply(e, await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $3", "fake-2 | $2"]) }), d));
    d = nextDay(2);
    const back = await run(e, fakeHttp({ [ID]: pricing(["fake-1 | $1", "fake-2 | $2"]) }), d);
    assert.equal(back.drafts.length, 1, "되돌아간 가격도 후보다");
    assert.ok(back.drafts[0]!.keys.some((k) => k.includes(":2026-10-30:")));
  });

  test("다가오는 절에서 지난 절로 옮긴 지난 날짜 행은 후보가 없다", async () => {
    const e = env();
    const id = "openai-deprecations";
    const doc = (sec: string) => `## ${sec}\n\n${table("Model | Shutdown date", ["gone-1 | 2020-01-01"])}\n`;
    apply(e, await run(e, fakeHttp({ [id]: doc("Upcoming") })));
    const r = await run(e, fakeHttp({ [id]: doc("Past") }), nextDay(1));
    assert.equal(r.drafts.length, 0);
  });

  test("미래 확정 날짜 행이 대체 없이 사라지면 후보다", async () => {
    const e = env();
    const id = "openai-deprecations";
    apply(e, await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["keep-1 | 2020-01-01", "gone-2 | 2027-03-01", "keep-2 | 2020-01-02"]) })));
    for (const p of allPending(e.db)) deletePending(e.db, p.key);
    const r = await run(e, fakeHttp({ [id]: table("Model | Shutdown date", ["keep-1 | 2020-01-01", "keep-2 | 2020-01-02"]) }), nextDay(1));
    assert.equal(r.drafts.length, 1);
    assert.match(r.drafts[0]!.material, /바뀌기 전:\n.*gone-2/);
  });
});

describe("4.2-2 이상 문서", () => {
  test("행 수가 절반 미만, 0행, 형식 오류면 저장하지 않고 실패로 센다", async () => {
    const e = env();
    await base(e, pricing(["a-1 | $1", "a-2 | $2", "a-3 | $3", "a-4 | $4", "a-5 | $5"]));
    const before = allRows(e.db).length;
    for (const body of [pricing(["a-1 | $1", "a-2 | $2"]), "no table here\n", "<!doctype html><html></html>"]) {
      const r = await run(e, fakeHttp({ [ID]: body }), nextDay(1));
      assert.equal(r.sources.find((s) => s.id === ID)!.status, "failed");
      assert.equal(r.drafts.length, 0);
      assert.equal(allRows(e.db).length, before);
    }
    const f = env();
    const first = await run(f, fakeHttp({ [ID]: "no table here\n" }));
    assert.equal(first.sources.find((s) => s.id === ID)!.reason, "표 행이 없다");
  });
});

describe("4.2-3 원문", () => {
  const rawFiles = (dataDir: string, doc: string) => {
    const dir = path.join(dataDir, BUILDER_RAW_DIR, doc);
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };

  test("첫 실행에 파일이 생기고, 긴 행만 바뀌면 원문만 저장되고, 같은 문서는 더 만들지 않는다", async () => {
    const e = env();
    const long = (x: string) => pricing(["fake-1 | $1", `long-1 | ${x.repeat(210)}`]);
    await base(e, long("x"));
    assert.equal(rawFiles(e.dataDir, ID).length, 1);
    assert.match(rawFiles(e.dataDir, ID)[0]!, /^2026-10-28-[0-9a-f]{8}\.md\.gz$/);
    const stored = path.join(e.dataDir, BUILDER_RAW_DIR, ID, rawFiles(e.dataDir, ID)[0]!);
    assert.equal(gunzipSync(fs.readFileSync(stored)).toString("utf8"), long("x"));
    const same = await run(e, fakeHttp({ [ID]: long("x") }), nextDay(1));
    assert.equal(same.docs.find((d) => d.doc === ID)!.rawSaved, false);
    assert.equal(rawFiles(e.dataDir, ID).length, 1);
    const before = allRows(e.db).length;
    const changed = await run(e, fakeHttp({ [ID]: long("y") }), nextDay(1));
    assert.equal(rawFiles(e.dataDir, ID).length, 2);
    assert.equal(changed.drafts.length, 0);
    assert.equal(allRows(e.db).length, before);
  });
});

describe("4.3-2의 날짜 읽기", () => {
  test("지정된 형식을 읽고 U+2011을 바꾸며 연도 없는 날짜는 발행일 뒤로 푼다", () => {
    const v = (s: string, p: string | null = null) => readDates(s, p).map((d) => d.value);
    assert.deepEqual(v("January 14, 2027"), ["2027-01-14"]);
    assert.deepEqual(v("Apr 1, 2027"), ["2027-04-01"]);
    assert.deepEqual(v("2026-10-14"), ["2026-10-14"]);
    assert.deepEqual(v("July 2026"), ["2026-07"]);
    assert.deepEqual(v("March 31st, 2026"), ["2026-03-31"]);
    assert.deepEqual(v("2026‑10‑14"), ["2026-10-14"]);
    assert.deepEqual(v("November 1st", "2026-10-20"), ["2026-11-01"]);
    assert.deepEqual(v("January 5th", "2026-10-20"), ["2027-01-05"]);
  });
});
