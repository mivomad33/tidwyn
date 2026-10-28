import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { main } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import {
  FIRST_LINKED_KEY,
  MERGE_CHECKED_KEY,
  addNoMergePair,
  addRelation,
  createIssue,
  developments,
  fullKey,
  getIssue,
  getMeta,
  linkStory,
  linksOfStory,
  relatedIssues,
  setMeta,
  storiesOfDate,
  updateIssue,
} from "../src/issues.ts";
import { applyMerges, checkMergeFile, listMerges, mergeCandidates, mergeDue, unmerge, type MergeEntry } from "../src/merge.ts";
import { mergeWorkFile, readRun } from "../src/run.ts";
import { saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, gitIn, makeCtx, sampleBrief, tempDir, tempRepo } from "./helpers.ts";

after(cleanupTemp);

const TODAY = "2026-10-28";

function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T09:00:00+09:00`, late: false });
}

function dbWith(dates: string[], file = path.join(tempDir(), "tidwyn.db")): DatabaseSync {
  const db = openDb(file);
  for (const d of dates) addBrief(db, d);
  return db;
}

function storyId(db: DatabaseSync, date: string, key: string): number {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date}/${key}`);
  return s.id;
}

/** 이슈를 만들고 [날짜, 뉴스 키, 주 이슈 여부] 목록대로 붙인다 */
function issue(db: DatabaseSync, name: string, links: [string, string, boolean][], extra: { aliases?: string[]; status?: "진행 중" | "종료"; major?: "국제" | "경제" } = {}): number {
  const id = createIssue(db, {
    name,
    aliases: extra.aliases ?? [],
    category: { major: extra.major ?? "국제", minor: "기타 지역" },
    summary: `${name}의 지금까지 요약이다.\n현재 상황을 적었다.`,
    status: extra.status ?? "진행 중",
  });
  for (const [date, key, primary] of links) linkStory(db, storyId(db, date, key), id, primary);
  return id;
}

function entry(survivor: number, absorbed: number, reason = "같은 이어지는 이야기다"): MergeEntry {
  return { survivor, absorbed, reason, summary: "합친 뒤 고쳐 쓴 요약이다.\n두 이슈의 흐름을 함께 담았다." };
}

/** 이슈 상태 전체(이름, 별칭, 분류, 상태, 요약, 흡수, 연결, 관계) */
function state(db: DatabaseSync, id: number) {
  return {
    issue: getIssue(db, id),
    links: developments(db, id).map((d) => [fullKey(d), d.primary]),
    relations: relatedIssues(db, id),
  };
}

function dump(db: DatabaseSync): string {
  const t = (sql: string) => db.prepare(sql).all();
  return JSON.stringify({
    issues: t("SELECT * FROM issues ORDER BY id"),
    links: t("SELECT * FROM story_issues ORDER BY story_id, issue_id"),
    relations: t("SELECT * FROM issue_relations ORDER BY a, b"),
    merges: t("SELECT * FROM merges ORDER BY id"),
    noMerge: t("SELECT * FROM no_merge_pairs ORDER BY a, b"),
    meta: t("SELECT * FROM meta ORDER BY key"),
  });
}

/** 연결이 있는 모든 뉴스의 주 이슈 수가 정확히 1인지 */
function primaryCounts(db: DatabaseSync): number[] {
  return (db.prepare("SELECT sum(is_primary) AS n FROM story_issues GROUP BY story_id").all() as { n: number }[]).map((r) => r.n);
}

/** 데이터 폴더를 지정한 start → 실행 기록 경로 */
function startRun(repo: string, dataDir: string, now = new Date(`${TODAY}T09:00:00+09:00`)): string {
  const ctx = makeCtx(repo, { TIDWYN_DATA_DIR: dataDir }, now);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  const m = /실행 기록: (.+)/.exec(ctx.text());
  assert.ok(m);
  return m[1]!;
}

function run(repo: string, argv: string[], env: NodeJS.ProcessEnv = {}, now = new Date(`${TODAY}T09:00:00+09:00`)) {
  const ctx = makeCtx(repo, env, now);
  const code = main(argv, ctx);
  return { code, text: ctx.text() };
}

function writeMerges(runFile: string, data: unknown): void {
  const file = mergeWorkFile(readRun(runFile).dataDir, "json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

describe("2단계 4.3-1 합치기 주기", () => {
  test("점검일에서 6일 뒤에는 할 일 없음, 7일 뒤에는 할 일 있음(처음 점검일은 첫 연결 적용일)", () => {
    const db = dbWith(["2026-10-20"]);
    assert.deepEqual(mergeDue(db, "2026-10-28"), { due: false, nextOn: null }, "연결한 적이 없으면 할 일 없음");
    setMeta(db, FIRST_LINKED_KEY, "2026-10-20");
    assert.equal(mergeDue(db, "2026-10-26").due, false);
    assert.deepEqual(mergeDue(db, "2026-10-26"), { due: false, nextOn: "2026-10-27" });
    assert.deepEqual(mergeDue(db, "2026-10-27"), { due: true, checkedOn: "2026-10-20" });
    setMeta(db, MERGE_CHECKED_KEY, "2026-10-25");
    assert.equal(mergeDue(db, "2026-10-31").due, false);
    assert.equal(mergeDue(db, "2026-11-01").due, true);
    db.close();
  });
  test("명령: 6일 뒤 merge-list는 할 일 없음, 7일 뒤는 할 일 있음", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = dbWith(["2026-10-27"], path.join(dataDir, "tidwyn.db"));
    issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    issue(db, "가상 왕국 국경 분쟁 사태", [["2026-10-27", "세계-2", true]]);
    setMeta(db, FIRST_LINKED_KEY, "2026-10-22");
    db.close();
    const r1 = startRun(repo, dataDir);
    const out1 = run(repo, ["merge-list", "--run", r1]);
    assert.equal(out1.code, 0);
    assert.match(out1.text, /할 일 없음\(다음 점검 2026-10-29\)/);
    assert.equal(readRun(r1).merge?.status, "notDue");
    const now7 = new Date("2026-10-29T09:00:00+09:00");
    const r2 = startRun(repo, dataDir, now7);
    const out2 = run(repo, ["merge-list", "--run", r2], {}, now7);
    assert.equal(out2.code, 0);
    assert.match(out2.text, /할 일 있음\(마지막 점검 2026-10-22\)/);
    assert.ok(fs.existsSync(mergeWorkFile(dataDir, "candidates.md")));
    // 후보만 만들고 적용하지 않고 끝나면 요약은 "합친 것 없음"이 아니라 다음 실행이 다시 한다고 알린다
    const sum = run(repo, ["summary", "--run", r2], {}, now7);
    assert.match(sum.text, /- 합치기: 후보 1쌍을 만들었지만 적용하지 않았다\(점검일을 바꾸지 않았다, 다음 실행이 다시 한다\)/);
    assert.doesNotMatch(sum.text, /합친 것이 없다/);
  });
  test("합친 것이 없어도 점검일이 바뀌고, 검사 실패로 끝나면 바뀌지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = dbWith(["2026-10-27"], path.join(dataDir, "tidwyn.db"));
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    setMeta(db, FIRST_LINKED_KEY, "2026-10-20");
    db.close();
    const runFile = startRun(repo, dataDir);
    // 검사 실패: 없는 이슈
    writeMerges(runFile, { merges: [entry(a, 999)] });
    const bad = run(repo, ["merge-apply", "--run", runFile]);
    assert.equal(bad.code, 1);
    assert.match(bad.text, /이슈 999이\(가\) 없다/);
    assert.equal(readRun(runFile).merge?.status, "failed");
    let check = openDb(path.join(dataDir, "tidwyn.db"));
    assert.equal(getMeta(check, MERGE_CHECKED_KEY), null);
    assert.equal(mergeDue(check, TODAY).due, true, "다음 실행이 다시 한다");
    check.close();
    // 합친 것 없음
    writeMerges(runFile, { merges: [] });
    const none = run(repo, ["merge-apply", "--run", runFile]);
    assert.equal(none.code, 0, none.text);
    assert.equal(readRun(runFile).merge?.status, "none");
    check = openDb(path.join(dataDir, "tidwyn.db"));
    assert.equal(getMeta(check, MERGE_CHECKED_KEY), TODAY);
    assert.equal(mergeDue(check, TODAY).due, false);
    check.close();
  });
  test("후보가 하나도 없으면 merge-list가 점검일을 바꾼다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const db = dbWith(["2026-10-27"], path.join(dataDir, "tidwyn.db"));
    issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    issue(db, "유가 상승", [["2026-10-27", "세계-2", true]], { major: "경제" });
    setMeta(db, FIRST_LINKED_KEY, "2026-10-20");
    db.close();
    const runFile = startRun(repo, dataDir);
    const out = run(repo, ["merge-list", "--run", runFile]);
    assert.equal(out.code, 0);
    assert.match(out.text, /후보가 없어/);
    const check = openDb(path.join(dataDir, "tidwyn.db"));
    assert.equal(getMeta(check, MERGE_CHECKED_KEY), TODAY);
    check.close();
  });
});

describe("2단계 4.3-2 합치기 후보", () => {
  test("이름이 거의 같은 두 이슈는 후보에 나오고, 관계없는 쌍과 합치지 않음 쌍은 나오지 않는다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 왕국 국경 분쟁 사태", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "유가 상승", [["2026-10-27", "세계-3", true]], { major: "경제" });
    const d = issue(db, "가짜시 지하철 파업", [["2026-10-27", "한국-1", true]]);
    const e = issue(db, "가짜시 지하철 파업 협상", [["2026-10-27", "한국-2", true]]);
    addNoMergePair(db, d, e);
    const pairs = mergeCandidates(db).map((p) => [p.a.id, p.b.id].sort((x, y) => x - y).join("-"));
    assert.ok(pairs.includes([a, b].join("-")), JSON.stringify(pairs));
    for (const p of pairs) assert.ok(!p.split("-").includes(String(c)), `관계없는 이슈 ${c}가 후보에 나왔다: ${p}`);
    assert.ok(!pairs.includes([d, e].join("-")), "합치지 않음 쌍은 빠진다");
    db.close();
  });
  test("흡수된 이슈는 후보에서 빠진다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 왕국 국경 분쟁 사태", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "가상 왕국 국경 분쟁 격화", [["2026-10-27", "세계-3", true]]);
    applyMerges(db, [entry(a, b)], TODAY);
    for (const p of mergeCandidates(db)) assert.ok(p.a.id !== b && p.b.id !== b);
    assert.ok(mergeCandidates(db).some((p) => [p.a.id, p.b.id].includes(c)));
    db.close();
  });
});

describe("2단계 4.3-3 합치기 적용과 검사", () => {
  test("연결 이동과 중복 정리, 주 이슈 유지, 별칭, 관계, 상태, 흡수 표시, 기록이 맞다", () => {
    const db = dbWith(["2026-10-26", "2026-10-27"]);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-26", "세계-1", true], ["2026-10-27", "세계-2", false]], { status: "종료", aliases: ["국경 분쟁"] });
    const b = issue(db, "가상 왕국 국경 충돌", [["2026-10-27", "세계-2", true], ["2026-10-27", "세계-3", true]], { aliases: ["Fake Border Clash", "국경 분쟁"] });
    const c = issue(db, "유가 상승", [["2026-10-27", "세계-4", true]], { major: "경제" });
    const d = issue(db, "가상 연합 제재", [["2026-10-27", "세계-5", true]]);
    addRelation(db, b, c);
    addRelation(db, a, b);
    addRelation(db, a, d);
    addRelation(db, b, d);
    const beforeB = state(db, b);
    const [mergeId] = applyMerges(db, [entry(a, b, "같은 국경 갈등이다")], TODAY);

    const sa = state(db, a);
    assert.deepEqual(sa.links, [
      ["2026-10-26/세계-1", true],
      ["2026-10-27/세계-2", true],
      ["2026-10-27/세계-3", true],
    ]);
    assert.deepEqual(linksOfStory(db, storyId(db, "2026-10-27", "세계-2")).length, 1, "한 뉴스가 두 이슈에 붙어 있으면 하나로 준다");
    assert.deepEqual(developments(db, b), []);
    assert.deepEqual(sa.issue!.aliases, ["국경 분쟁", "가상 왕국 국경 충돌", "Fake Border Clash"]);
    assert.deepEqual(sa.relations, [c, d].sort((x, y) => x - y), "자기 자신과 겹치는 관계는 없어진다");
    assert.deepEqual(relatedIssues(db, b), []);
    assert.equal(sa.issue!.status, "진행 중", "하나라도 진행 중이면 진행 중");
    assert.equal(sa.issue!.summary, entry(a, b).summary);
    assert.equal(getIssue(db, b)!.mergedInto, a, "흡수된 이슈는 지우지 않고 남는 이슈를 가리킨다");
    assert.equal(getIssue(db, b)!.name, "가상 왕국 국경 충돌");
    const rec = listMerges(db);
    assert.equal(rec.length, 1);
    assert.equal(rec[0]!.id, mergeId);
    assert.equal(rec[0]!.mergedOn, TODAY);
    assert.equal(rec[0]!.survivor, a);
    assert.equal(rec[0]!.absorbed, b);
    assert.equal(rec[0]!.reason, "같은 국경 갈등이다");
    assert.equal(rec[0]!.undoneOn, null);
    assert.deepEqual(rec[0]!.record.before.absorbed.links, beforeB.links.map(([story, primary]) => ({ story, primary })));
    assert.equal(rec[0]!.record.before.absorbed.summary, beforeB.issue!.summary);
    assert.equal(rec[0]!.record.before.survivor.status, "종료");
    // 합친 뒤 새 이슈의 식별자는 흡수된 이슈와 다르다(4.1-1)
    const fresh = createIssue(db, { name: "새 이슈", aliases: [], category: { major: "사회", minor: "교육" }, summary: "요약" });
    assert.ok(![a, b, c, d].includes(fresh));
    db.close();
  });
  test("둘 다 종료면 종료로 남는다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 재판", [["2026-10-27", "한국-1", true]], { status: "종료" });
    const b = issue(db, "가상 재판 선고", [["2026-10-27", "한국-2", true]], { status: "종료" });
    applyMerges(db, [entry(a, b)], TODAY);
    assert.equal(getIssue(db, a)!.status, "종료");
    db.close();
  });
  test("거부 경우마다 거부되고 이유가 나온다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 왕국 국경 충돌", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "가상 왕국 국경 협상", [["2026-10-27", "세계-3", true]]);
    const x = issue(db, "흡수될 이슈", [["2026-10-27", "세계-4", true]]);
    applyMerges(db, [entry(c, x)], TODAY);
    const reject = (data: unknown, re: RegExp) => {
      const r = checkMergeFile(db, data);
      assert.equal(r.ok, false, JSON.stringify(data));
      assert.ok(!r.ok && r.violations.some((v) => re.test(`${v.where}: ${v.why}`)), JSON.stringify(!r.ok && r.violations));
    };
    reject({ merges: [entry(a, 999)] }, /absorbed: 이슈 999이\(가\) 없다/);
    reject({ merges: [entry(999, a)] }, /survivor: 이슈 999이\(가\) 없다/);
    reject({ merges: [entry(a, x)] }, /이미 이슈 \d+에 흡수되었다/);
    reject({ merges: [entry(a, a)] }, /같은 이슈끼리/);
    reject({ merges: [{ survivor: a, absorbed: b, summary: "요약" }] }, /이유: 비어 있으면 안 된다/);
    reject({ merges: [{ survivor: a, absorbed: b, reason: "이유" }] }, /요약이 비어 있으면 안 된다/);
    reject({ merges: [{ ...entry(a, b), summary: "1\n2\n3\n4\n5\n6" }] }, /6줄이다/);
    const quote = `"${Array.from({ length: 15 }, (_, i) => `낱말${i}`).join(" ")}"`;
    reject({ merges: [{ ...entry(a, b), summary: `요약 ${quote}` }] }, /직접 인용이 15단어/);
    reject({ merges: [entry(b, a), entry(c, b)] }, /연달아 합치기/);
    reject({ merges: [entry(b, a), entry(c, a)] }, /두 번 흡수된다/);
    assert.equal(checkMergeFile(db, { merges: [entry(a, b), entry(a, c)] }).ok, true, "남는 이슈 하나에 여럿을 합치는 것은 된다");
    db.close();
  });
  test("거부된 합치기 파일은 merge-apply가 DB를 바꾸지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const dbFile = path.join(dataDir, "tidwyn.db");
    const db = dbWith(["2026-10-27"], dbFile);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 왕국 국경 충돌", [["2026-10-27", "세계-2", true]]);
    setMeta(db, FIRST_LINKED_KEY, "2026-10-20");
    db.close();
    const runFile = startRun(repo, dataDir);
    let check = openDb(dbFile);
    const before = dump(check);
    check.close();
    writeMerges(runFile, { merges: [entry(a, b), { ...entry(b, a), reason: "" }] });
    assert.equal(run(repo, ["merge-apply", "--run", runFile]).code, 1);
    check = openDb(dbFile);
    assert.equal(dump(check), before);
    check.close();
  });
});

describe("2단계 4.3-4 되돌리기", () => {
  function setup() {
    const db = dbWith(["2026-10-26", "2026-10-27"]);
    const c = issue(db, "유가 상승", [["2026-10-27", "세계-4", true]], { major: "경제" });
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-26", "세계-1", true], ["2026-10-27", "세계-2", false]], { status: "종료", aliases: ["국경 분쟁"] });
    const b = issue(db, "가상 왕국 국경 충돌", [["2026-10-27", "세계-2", true], ["2026-10-27", "세계-3", true]], { aliases: ["Fake Border Clash"] });
    addRelation(db, b, c);
    addRelation(db, a, b);
    return { db, a, b, c };
  }

  test("합친 뒤 되돌리면 두 이슈가 합치기 전과 같아진다", () => {
    const { db, a, b, c } = setup();
    const before = [state(db, a), state(db, b), state(db, c)];
    const [id] = applyMerges(db, [entry(a, b)], TODAY);
    const r = unmerge(db, id!, "2026-10-29");
    assert.ok(r.ok, !r.ok ? r.reason : "");
    assert.deepEqual([state(db, a), state(db, b), state(db, c)], before);
    assert.deepEqual(primaryCounts(db).filter((n) => n !== 1), []);
    assert.equal(listMerges(db)[0]!.undoneOn, "2026-10-29");
    db.close();
  });
  test("합친 뒤 남는 이슈에 새 뉴스를 붙이고 되돌리면 새 연결은 남는 이슈에 남는다", () => {
    const { db, a, b } = setup();
    const before = state(db, b);
    const [id] = applyMerges(db, [entry(a, b)], TODAY);
    addBrief(db, "2026-10-28");
    linkStory(db, storyId(db, "2026-10-28", "세계-1"), a, true);
    updateIssue(db, a, { summary: "새 뉴스가 붙어 고쳐 쓴 요약이다." });
    assert.ok(unmerge(db, id!, "2026-10-29").ok);
    const links = state(db, a).links;
    assert.deepEqual(links, [
      ["2026-10-26/세계-1", true],
      ["2026-10-27/세계-2", false],
      ["2026-10-28/세계-1", true],
    ]);
    assert.equal(getIssue(db, a)!.summary, "새 뉴스가 붙어 고쳐 쓴 요약이다.", "더해진 것이 있으면 지금 요약을 둔다");
    assert.equal(getIssue(db, a)!.status, "진행 중", "더해진 것이 있으면 지금 상태를 둔다");
    assert.deepEqual(state(db, b), before);
    assert.deepEqual(primaryCounts(db).filter((n) => n !== 1), []);
    db.close();
  });
  test("A→B 뒤 C→B를 합치고 A→B만 되돌리면 C에서 온 별칭과 연결이 B에 남고, 주 이슈는 정확히 하나다", () => {
    const db = dbWith(["2026-10-27"]);
    // 뉴스 세계-1은 A의 주 이슈, C의 추가 이슈
    const a = issue(db, "가상 국경 분쟁 1차", [["2026-10-27", "세계-1", true]], { aliases: ["A별칭"] });
    const b = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "가상 국경 분쟁 2차", [["2026-10-27", "세계-1", false], ["2026-10-27", "세계-3", true]], { aliases: ["C별칭"] });
    const beforeA = state(db, a);
    const [m1] = applyMerges(db, [entry(b, a)], TODAY);
    applyMerges(db, [entry(b, c)], TODAY);
    const r = unmerge(db, m1!, "2026-10-29");
    assert.ok(r.ok, !r.ok ? r.reason : "");
    const sb = state(db, b);
    assert.ok(sb.issue!.aliases.includes("가상 국경 분쟁 2차"));
    assert.ok(sb.issue!.aliases.includes("C별칭"));
    assert.ok(!sb.issue!.aliases.includes("A별칭"));
    assert.ok(!sb.issue!.aliases.includes("가상 국경 분쟁 1차"));
    assert.deepEqual(sb.links, [
      ["2026-10-27/세계-1", false],
      ["2026-10-27/세계-2", true],
      ["2026-10-27/세계-3", true],
    ]);
    assert.deepEqual(state(db, a), beforeA);
    assert.deepEqual(primaryCounts(db).filter((n) => n !== 1), []);
    db.close();
  });
  test("A→B, C→B를 합친 뒤 합친 순서대로 둘 다 되돌리면 B가 처음과 같아진다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 국경 분쟁 1차", [["2026-10-27", "세계-1", true]], { aliases: ["A별칭"] });
    const b = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "가상 국경 분쟁 2차", [["2026-10-27", "세계-1", false], ["2026-10-27", "세계-3", true]], { aliases: ["A별칭", "C별칭"] });
    const before = [state(db, a), state(db, b), state(db, c)];
    const [m1] = applyMerges(db, [entry(b, a)], TODAY);
    const [m2] = applyMerges(db, [entry(b, c)], TODAY);
    assert.ok(unmerge(db, m1!, "2026-10-29").ok);
    assert.ok(unmerge(db, m2!, "2026-10-29").ok);
    // B의 요약은 명세대로 합치기 2 직전 값(합치기 1 뒤 요약)으로 돌아간다. 나머지는 처음과 같다
    const sb = state(db, b);
    assert.equal(sb.issue!.summary, listMerges(db).find((m) => m.id === m2)!.record.before.survivor.summary);
    sb.issue!.summary = before[1]!.issue!.summary;
    assert.deepEqual([state(db, a), sb, state(db, c)], before);
    assert.deepEqual(primaryCounts(db).filter((n) => n !== 1), []);
    db.close();
  });
  test("되살린 관계의 상대가 그사이 흡수됐으면 그 남는 이슈를 가리킨다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 국경 충돌", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "유가 상승", [["2026-10-27", "세계-3", true]], { major: "경제" });
    const d = issue(db, "국제 유가 급등", [["2026-10-27", "세계-4", true]], { major: "경제" });
    addRelation(db, b, c);
    const [m1] = applyMerges(db, [entry(a, b)], TODAY);
    applyMerges(db, [entry(d, c)], TODAY);
    assert.ok(unmerge(db, m1!, "2026-10-29").ok);
    assert.deepEqual(relatedIssues(db, b), [d]);
    db.close();
  });
  test("되돌린 쌍은 다음 후보에 나오지 않고, 다시 합치는 파일은 거부된다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 왕국 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 왕국 국경 분쟁 사태", [["2026-10-27", "세계-2", true]]);
    assert.ok(mergeCandidates(db).some((p) => [p.a.id, p.b.id].sort().join() === [a, b].sort().join()));
    const [id] = applyMerges(db, [entry(a, b)], TODAY);
    assert.ok(unmerge(db, id!, "2026-10-29").ok);
    assert.ok(!mergeCandidates(db).some((p) => [p.a.id, p.b.id].includes(a) && [p.a.id, p.b.id].includes(b)));
    assert.equal(checkMergeFile(db, { merges: [entry(a, b)] }).ok, false);
    db.close();
  });
  test("남는 이슈가 그 뒤 다시 흡수되었으면 거부하고 먼저 되돌릴 합치기를 알린다. 그것을 되돌리면 된다", () => {
    const db = dbWith(["2026-10-27"]);
    const a = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 국경 충돌", [["2026-10-27", "세계-2", true]]);
    const c = issue(db, "가상 국경 갈등", [["2026-10-27", "세계-3", true]]);
    const [m1] = applyMerges(db, [entry(b, a)], TODAY);
    const [m2] = applyMerges(db, [entry(c, b)], TODAY);
    const before = dump(db);
    const r = unmerge(db, m1!, "2026-10-29");
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.reason : "", new RegExp(`먼저 합치기 ${m2}`));
    assert.equal(dump(db), before);
    assert.ok(unmerge(db, m2!, "2026-10-29").ok);
    assert.ok(unmerge(db, m1!, "2026-10-29").ok, "되돌린 합치기는 다시 흡수됨으로 세지 않는다");
    assert.deepEqual(primaryCounts(db).filter((n) => n !== 1), []);
    db.close();
  });
  test("이미 되돌린 합치기와 없는 기록은 거부된다", () => {
    const { db, a, b } = setup();
    const [id] = applyMerges(db, [entry(a, b)], TODAY);
    assert.ok(unmerge(db, id!, "2026-10-29").ok);
    const again = unmerge(db, id!, "2026-10-30");
    assert.equal(again.ok, false);
    assert.match(!again.ok ? again.reason : "", /이미 2026-10-29에 되돌렸다/);
    assert.equal(unmerge(db, 99, "2026-10-30").ok, false);
    db.close();
  });
  test("명령: 실제 데이터 폴더 조건을 어기면(다른 브랜치) 거부되고 DB가 바뀌지 않는다", () => {
    const repo = tempRepo();
    const dbFile = path.join(repo, "data", "tidwyn.db");
    const db = dbWith(["2026-10-27"], dbFile);
    const a = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 국경 충돌", [["2026-10-27", "세계-2", true]]);
    applyMerges(db, [entry(a, b)], TODAY);
    db.close();
    gitIn(repo, "switch", "-q", "-c", "other");
    const before = fs.readFileSync(dbFile);
    const r = run(repo, ["unmerge", "--id", "1"]);
    assert.equal(r.code, 3, r.text);
    assert.match(r.text, /실행 조건이 맞지 않아/);
    assert.deepEqual(fs.readFileSync(dbFile), before);
    assert.equal(fs.existsSync(path.join(repo, "data", "snapshots")), false);
  });
  test("명령: 데이터 폴더를 지정하면 되돌리고, 바꾸기 전 사본과 마크다운을 남기며, merges가 되돌린 기록을 보인다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const dbFile = path.join(dataDir, "tidwyn.db");
    const db = dbWith(["2026-10-27"], dbFile);
    const a = issue(db, "가상 국경 분쟁", [["2026-10-27", "세계-1", true]]);
    const b = issue(db, "가상 국경 충돌", [["2026-10-27", "세계-2", true]]);
    applyMerges(db, [entry(a, b)], TODAY);
    db.close();
    const env = { TIDWYN_DATA_DIR: dataDir };
    const list1 = run(repo, ["merges"], env);
    assert.match(list1.text, /합치기 1 \(2026-10-28\).*unmerge --id 1/);
    const r = run(repo, ["unmerge", "--id", "1"], env);
    assert.equal(r.code, 0, r.text);
    const snaps = fs.readdirSync(path.join(dataDir, "snapshots"));
    assert.equal(snaps.length, 1);
    const snap = openDb(path.join(dataDir, "snapshots", snaps[0]!));
    assert.equal(getIssue(snap, b)!.mergedInto, a, "사본은 되돌리기 전 상태다");
    snap.close();
    const check = openDb(dbFile);
    assert.equal(getIssue(check, b)!.mergedInto, null);
    check.close();
    assert.ok(fs.existsSync(path.join(dataDir, "issues", "index.md")));
    assert.match(run(repo, ["merges"], env).text, /되돌림/);
    assert.equal(run(repo, ["unmerge", "--id", "1"], env).code, 1);
  });
});
