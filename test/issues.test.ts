import assert from "node:assert/strict";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { openDb } from "../src/db.ts";
import {
  addRelation,
  createIssue,
  developments,
  getIssue,
  linkStory,
  relatedIssues,
  storiesOfDate,
  unlinkedStories,
  type StoryRef,
} from "../src/issues.ts";
import { CANDIDATE_LIMIT, applyLinkPlan, candidateIssues, checkLinkFile, renderLinkWork, searchIssues } from "../src/links.ts";
import { applyMerges } from "../src/merge.ts";
import { saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, sampleBrief, tempDir } from "./helpers.ts";

after(cleanupTemp);

const TODAY = "2026-10-28";

function dbWith(dates: string[]): DatabaseSync {
  const db = openDb(path.join(tempDir(), "t.db"));
  for (const d of dates) {
    const r = validateBrief(sampleBrief(d), d);
    assert.ok(r.ok);
    saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
  }
  return db;
}

const SUMMARY = "가짜 기관의 정책 갈등이다.\n현재 협상이 이어진다.\n다음 주 발표를 본다.";

function issue(db: DatabaseSync, name: string, aliases: string[] = []): number {
  return createIssue(db, { name, aliases, category: { major: "경제", minor: "금융·증시" }, summary: SUMMARY });
}

/** 그 날짜의 모든 뉴스를 각자 새 이슈로 잇는 올바른 연결 파일 */
function oneIssuePerStory(db: DatabaseSync, date: string, prefix = "이슈") {
  const stories = unlinkedStories(db, date);
  return {
    date,
    newIssues: stories.map((s, i) => ({ key: `n${i}`, name: `${prefix} ${date} ${s.key}`, aliases: [], category: { major: "사회", minor: "교육" }, summary: SUMMARY })),
    links: stories.map((s, i): { story: string; primary: number | string; extra?: (number | string)[] } => ({ story: s.key, primary: `n${i}` })),
    summaries: [] as { issue: number; summary: string }[],
    statusChanges: [] as { issue: number | string; status: string }[],
    relations: [] as (number | string)[][],
  };
}

function violations(db: DatabaseSync, data: unknown, date: string): string {
  const r = checkLinkFile(db, data, date);
  assert.equal(r.ok, false, "거부되어야 한다");
  return r.ok ? "" : r.violations.map((v) => `${v.where}: ${v.why}`).join("\n");
}

function apply(db: DatabaseSync, data: unknown, date: string) {
  const r = checkLinkFile(db, data, date);
  assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
  return applyLinkPlan(db, r.plan, TODAY);
}

describe("2단계 4.1-1 이슈 항목", () => {
  test("이슈를 만들고 뉴스를 붙이면 항목이 나오고, 시작일·최근 업데이트일이 연결된 뉴스 날짜와 맞는다", () => {
    const db = dbWith(["2026-10-25", "2026-10-26", "2026-10-27"]);
    const id = createIssue(db, { name: "가짜 금리 갈등", aliases: ["Fake Rate Dispute"], category: { major: "경제", minor: "가상자산", isNewMinor: true }, summary: SUMMARY });
    linkStory(db, storiesOfDate(db, "2026-10-27")[0]!.id, id, true);
    linkStory(db, storiesOfDate(db, "2026-10-25")[2]!.id, id, false);
    const i = getIssue(db, id)!;
    assert.equal(i.name, "가짜 금리 갈등");
    assert.deepEqual(i.aliases, ["Fake Rate Dispute"]);
    assert.deepEqual(i.category, { major: "경제", minor: "가상자산", isNewMinor: true });
    assert.equal(i.status, "진행 중");
    assert.equal(i.summary, SUMMARY);
    assert.equal(i.startDate, "2026-10-25");
    assert.equal(i.latestDate, "2026-10-27");
    assert.equal(i.count, 2);
    db.close();
  });
  test("이슈를 합친 뒤 새로 만든 이슈의 식별자가 흡수된 이슈의 식별자와 다르다", () => {
    const db = dbWith(["2026-10-27"]);
    const [s1, s2] = storiesOfDate(db, "2026-10-27");
    const a = issue(db, "가짜 갈등 가");
    const b = issue(db, "가짜 갈등 나");
    linkStory(db, s1!.id, a, true);
    linkStory(db, s2!.id, b, true);
    applyMerges(db, [{ survivor: a, absorbed: b, reason: "같은 이야기", summary: SUMMARY }], TODAY);
    const c = issue(db, "가짜 갈등 다");
    assert.notEqual(c, b);
    assert.notEqual(c, a);
    db.close();
  });
});

describe("2단계 4.1-2 연결과 관계", () => {
  test("같은 연결이나 관계를 두 번 적용해도 하나만 남고, (A, B)와 (B, A)가 같은 관계다", () => {
    const db = dbWith(["2026-10-27"]);
    const s = storiesOfDate(db, "2026-10-27")[0]!;
    const a = issue(db, "가");
    const b = issue(db, "나");
    linkStory(db, s.id, a, true);
    linkStory(db, s.id, a, true);
    assert.equal(developments(db, a).length, 1);
    assert.equal(addRelation(db, a, b), true);
    assert.equal(addRelation(db, b, a), false);
    assert.equal(addRelation(db, a, a), false, "자기 자신과는 관계가 없다");
    assert.deepEqual(relatedIssues(db, a), [b]);
    assert.deepEqual(relatedIssues(db, b), [a]);
    assert.equal((db.prepare("SELECT count(*) AS n FROM issue_relations").get() as { n: number }).n, 1);
    db.close();
  });
});

describe("2단계 4.2-2 후보 이슈 목록과 검색", () => {
  test("최근 이슈와 오래된 이슈 100개가 있는 DB에서 목록에 최근 이슈만 나오고, 오래된 이슈는 이름·별칭으로 검색된다", () => {
    const db = dbWith(["2026-07-01", "2026-10-27"]);
    const old = storiesOfDate(db, "2026-07-01");
    const recent = storiesOfDate(db, "2026-10-27");
    const oldIds: number[] = [];
    for (let i = 0; i < 100; i++) {
      const id = issue(db, `오래된 가짜 사건 ${i}`, [`Old Fake ${i}`]);
      linkStory(db, old[i % old.length]!.id, id, i < old.length);
      oldIds.push(id);
    }
    const recentId = issue(db, "최근 가짜 사건");
    linkStory(db, recent[0]!.id, recentId, true);
    const list = candidateIssues(db);
    assert.deepEqual(list.map((i) => i.id), [recentId]);
    const work = renderLinkWork(db, "2026-10-27");
    assert.match(work.text, /최근 가짜 사건/);
    assert.doesNotMatch(work.text, /오래된 가짜 사건/);
    assert.equal(searchIssues(db, "오래된 가짜 사건 42")[0]?.id, oldIds[42]);
    assert.ok(searchIssues(db, "Old Fake 7").some((i) => i.id === oldIds[7]), "별칭 낱말로 찾는다");
    assert.ok(searchIssues(db, "old fake 7").some((i) => i.id === oldIds[7]), "대소문자를 무시한다");
    db.close();
  });
  test("목록 길이는 상한을 넘지 않고, 대상일보다 뒤에 업데이트된 이슈도 나온다", () => {
    const db = dbWith(["2026-10-20", "2026-10-27"]);
    const late = storiesOfDate(db, "2026-10-27");
    for (let i = 0; i < CANDIDATE_LIMIT + 20; i++) linkStory(db, late[i % late.length]!.id, issue(db, `가짜 사건 ${i}`), false);
    assert.equal(candidateIssues(db).length, CANDIDATE_LIMIT);
    // 10-20을 연결할 때도 10-27에 업데이트된 이슈가 후보다
    assert.match(renderLinkWork(db, "2026-10-20").text, /가짜 사건 0/);
    db.close();
  });
  test("이슈가 없는 뉴스만 연결할 뉴스로 나온다", () => {
    const db = dbWith(["2026-10-27"]);
    const all = storiesOfDate(db, "2026-10-27");
    linkStory(db, all[0]!.id, issue(db, "가"), true);
    const work = renderLinkWork(db, "2026-10-27");
    assert.equal(work.stories, all.length - 1);
    assert.doesNotMatch(work.text, new RegExp(`\`${all[0]!.key}\``));
    assert.match(work.text, new RegExp(`\`${all[1]!.key}\``));
    db.close();
  });
});

describe("2단계 4.2-3 연결 파일 검사", () => {
  const D = "2026-10-27";
  test("올바른 연결 파일은 통과한다", () => {
    const db = dbWith([D]);
    assert.ok(checkLinkFile(db, oneIssuePerStory(db, D), D).ok);
    db.close();
  });
  test("뉴스가 빠지거나 두 번 나오거나 그 날짜에 없는 뉴스를 가리키면 거부된다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D);
    const missing = { ...f, links: f.links.slice(1) };
    assert.match(violations(db, missing, D), /연결할 뉴스 한국-1가 빠졌다/);
    const twice = { ...f, links: [...f.links, { story: "한국-1", primary: "n1" }] };
    assert.match(violations(db, twice, D), /뉴스 한국-1가 두 번 나온다/);
    const none = { ...f, links: [...f.links, { story: "한국-9", primary: "n0" }] };
    assert.match(violations(db, none, D), /links \d+ \(한국-9\) story: 2026-10-27에 뉴스 한국-9가 없다/);
    db.close();
  });
  test("주 이슈가 없거나 둘 이상이거나 같은 뉴스에 같은 이슈가 두 번 나오면 거부된다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D);
    const noPrimary = structuredClone(f);
    delete (noPrimary.links[0] as { primary?: unknown }).primary;
    assert.match(violations(db, noPrimary, D), /links 1 \(한국-1\) primary: 주 이슈가 하나 있어야 한다/);
    const two = structuredClone(f) as unknown as { links: { primary: unknown }[] };
    two.links[0]!.primary = ["n0", "n1"];
    assert.match(violations(db, two, D), /links 1 \(한국-1\) primary: 주 이슈는 하나여야 한다/);
    const dup = structuredClone(f) as unknown as { links: { extra?: unknown }[] };
    dup.links[0]!.extra = ["n0"];
    assert.match(violations(db, dup, D), /links 1 \(한국-1\): 같은 이슈가 두 번 나온다/);
    db.close();
  });
  test("없는 이슈나 흡수된 이슈를 가리키면 거부되고, 흡수된 경우 남는 이슈를 알린다", () => {
    const db = dbWith(["2026-10-26", D]);
    const s = storiesOfDate(db, "2026-10-26");
    const a = issue(db, "가짜 남는 이슈");
    const b = issue(db, "가짜 흡수 이슈");
    linkStory(db, s[0]!.id, a, true);
    linkStory(db, s[1]!.id, b, true);
    applyMerges(db, [{ survivor: a, absorbed: b, reason: "같은 이야기", summary: SUMMARY }], TODAY);
    const f = oneIssuePerStory(db, D) as { links: { primary: unknown }[] };
    f.links[0]!.primary = 999;
    f.links[1]!.primary = b;
    const v = violations(db, f, D);
    assert.match(v, /links 1 \(한국-1\) primary: 이슈 999이\(가\) 없다/);
    assert.match(v, new RegExp(`links 2 \\(한국-2\\) primary: 이슈 ${b}은\\(는\\) 이슈 ${a}\\(가짜 남는 이슈\\)에 흡수되었다`));
    db.close();
  });
  test("새 이슈에 이름이나 요약이 없거나, 대분류가 7개 밖이거나, 관계가 자기 자신을 가리키면 거부된다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D) as unknown as {
      newIssues: { name?: string; summary?: string; category: { major: string } }[];
      relations: unknown[];
    };
    delete f.newIssues[0]!.name;
    delete f.newIssues[1]!.summary;
    f.newIssues[2]!.category.major = "연예";
    f.relations = [["n3", "n3"]];
    const v = violations(db, f, D);
    assert.match(v, /newIssues 1 이름: 비어 있으면 안 된다/);
    assert.match(v, /newIssues 2 요약: 요약이 비어 있으면 안 된다/);
    assert.match(v, /newIssues 3 분류 대분류: "연예"은\(는\) 7개 대분류/);
    assert.match(v, /relations 1: 이슈 관계가 자기 자신을 가리킨다/);
    db.close();
  });
  test("새 이슈의 이름·별칭이 기존 이슈나 같은 파일의 새 이슈와 같으면(대소문자·공백 무시) 거부되고 기존 이슈를 알린다", () => {
    const db = dbWith(["2026-10-26", D]);
    const existing = issue(db, "가짜 금리 갈등", ["Fake Rate"]);
    linkStory(db, storiesOfDate(db, "2026-10-26")[0]!.id, existing, true);
    const f = oneIssuePerStory(db, D);
    f.newIssues[0]!.name = "가짜금리 \t갈등";
    f.newIssues[1]!.aliases = ["fake rate"] as never;
    f.newIssues[3]!.name = f.newIssues[2]!.name.toUpperCase();
    const v = violations(db, f, D);
    assert.match(v, new RegExp(`newIssues 1 이름·별칭 "가짜금리 \\t갈등": 기존 이슈 ${existing}\\(가짜 금리 갈등\\)의 이름·별칭과 같다`));
    assert.match(v, new RegExp(`newIssues 2 이름·별칭 "fake rate": 기존 이슈 ${existing}`));
    assert.match(v, /newIssues 4 이름·별칭 ".*": 같은 파일의 새 이슈 "n2"의 이름·별칭과 같다/);
    db.close();
  });
  test("흡수된 이슈의 이름과 같은 것은 기존 이슈 비교에서 빼지만, 남는 이슈의 별칭으로 걸린다", () => {
    const db = dbWith(["2026-10-26", D]);
    const s = storiesOfDate(db, "2026-10-26");
    const a = issue(db, "가짜 남는 이슈");
    const b = issue(db, "가짜 흡수 이슈");
    linkStory(db, s[0]!.id, a, true);
    linkStory(db, s[1]!.id, b, true);
    applyMerges(db, [{ survivor: a, absorbed: b, reason: "같은 이야기", summary: SUMMARY }], TODAY);
    const f = oneIssuePerStory(db, D);
    f.newIssues[0]!.name = "가짜 흡수 이슈";
    assert.match(violations(db, f, D), new RegExp(`기존 이슈 ${a}\\(가짜 남는 이슈\\)`));
    db.close();
  });
  test("뉴스가 붙는 기존 이슈의 고쳐 쓴 요약이 없으면 거부된다", () => {
    const db = dbWith(["2026-10-26", D]);
    const a = issue(db, "가짜 기존 이슈");
    linkStory(db, storiesOfDate(db, "2026-10-26")[0]!.id, a, true);
    const f = oneIssuePerStory(db, D) as unknown as { links: { primary: unknown }[]; newIssues: unknown[] };
    f.links[0]!.primary = a;
    f.newIssues.splice(0, 1);
    assert.match(violations(db, f, D), new RegExp(`summaries: 뉴스가 붙는 기존 이슈 ${a}\\(가짜 기존 이슈\\)의 고쳐 쓴 요약이 없다`));
    db.close();
  });
  test("요약이 비었거나 6줄 이상이면 거부되고, 빈 줄은 세지 않는다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D);
    f.newIssues[0]!.summary = "   ";
    f.newIssues[1]!.summary = "하나\n둘\n셋\n넷\n다섯\n여섯";
    f.newIssues[2]!.summary = "하나\n\n둘\n\n셋\n넷\n다섯\n";
    const v = violations(db, f, D);
    assert.match(v, /newIssues 1 요약: 요약이 비어 있으면 안 된다/);
    assert.match(v, /newIssues 2 요약: 요약이 6줄이다\(5줄 이하여야 한다\)/);
    assert.doesNotMatch(v, /newIssues 3 요약/);
    db.close();
  });
  test("요약이나 이름에 15단어 이상의 직접 인용이 있으면 거부된다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D);
    const quote = `"${Array.from({ length: 15 }, (_, i) => `word${i}`).join(" ")}"`;
    f.newIssues[0]!.summary = `그는 ${quote}라고 말했다.`;
    f.newIssues[1]!.name = `가짜 ${quote}`;
    const v = violations(db, f, D);
    assert.match(v, /newIssues 1 요약: 직접 인용이 15단어다/);
    assert.match(v, /newIssues 2 이름: 직접 인용이 15단어다/);
    db.close();
  });
  test("상태 값이 진행 중·종료 밖이면 거부된다", () => {
    const db = dbWith([D]);
    const f = oneIssuePerStory(db, D);
    f.statusChanges = [{ issue: "n0", status: "보류" }];
    assert.match(violations(db, f, D), /statusChanges 1 status: "보류"은\(는\) 상태 값\(진행 중, 종료\)이 아니다/);
    db.close();
  });
});

describe("2단계 4.2-4 적용", () => {
  const D = "2026-10-27";
  function setup() {
    const db = dbWith(["2026-10-25", "2026-10-26", D]);
    const prev = storiesOfDate(db, "2026-10-26");
    const a = issue(db, "가짜 기존 이슈 가");
    const b = issue(db, "가짜 기존 이슈 나");
    linkStory(db, prev[0]!.id, a, true);
    linkStory(db, prev[1]!.id, b, true);
    return { db, a, b };
  }
  function attachFile(db: DatabaseSync, date: string, a: number, extra: Partial<ReturnType<typeof oneIssuePerStory>> = {}) {
    const f = oneIssuePerStory(db, date);
    f.links[0]!.primary = a;
    f.newIssues.splice(0, 1);
    f.links[1]!.extra = [a];
    f.summaries = [{ issue: a, summary: "고쳐 쓴 요약이다.\n새 전개가 붙었다." }];
    return { ...f, ...extra };
  }
  test("적용하면 뉴스 연결, 새 이슈, 요약, 관계, 상태가 저장된다", () => {
    const { db, a, b } = setup();
    const f = attachFile(db, D, a, { relations: [[a, b], ["n1", a]], statusChanges: [{ issue: "n2", status: "종료" }] });
    const r = apply(db, f, D);
    const stories = storiesOfDate(db, D);
    assert.deepEqual(r, { status: "applied", linked: stories.length, attached: 1, newIssues: stories.length - 1 });
    assert.equal(unlinkedStories(db, D).length, 0);
    const ia = getIssue(db, a)!;
    assert.equal(ia.summary, "고쳐 쓴 요약이다.\n새 전개가 붙었다.");
    assert.equal(ia.latestDate, D);
    assert.deepEqual(developments(db, a).map((d) => [d.key, d.date, d.primary]), [["한국-1", "2026-10-26", true], ["한국-1", D, true], ["한국-2", D, false]]);
    const n1: StoryRef = stories[1]!;
    const n1Issue = db.prepare("SELECT issue_id FROM story_issues WHERE story_id = ? AND is_primary = 1").get(n1.id) as { issue_id: number };
    assert.ok(relatedIssues(db, a).includes(b));
    assert.ok(relatedIssues(db, a).includes(n1Issue.issue_id));
    const n2Issue = (db.prepare("SELECT issue_id FROM story_issues WHERE story_id = ? AND is_primary = 1").get(stories[2]!.id) as { issue_id: number }).issue_id;
    assert.equal(getIssue(db, n2Issue)!.status, "종료");
    db.close();
  });
  test("종료 이슈에 후속 뉴스를 붙이면 진행 중이 되고, 같은 파일이 종료로 바꾸면 종료로 남는다", () => {
    const { db, a, b } = setup();
    db.prepare("UPDATE issues SET status = '종료' WHERE id IN (?, ?)").run(a, b);
    apply(db, attachFile(db, D, a), D);
    assert.equal(getIssue(db, a)!.status, "진행 중");
    const db2 = setup();
    db2.db.prepare("UPDATE issues SET status = '종료' WHERE id = ?").run(db2.a);
    apply(db2.db, attachFile(db2.db, D, db2.a, { statusChanges: [{ issue: db2.a, status: "종료" }] }), D);
    assert.equal(getIssue(db2.db, db2.a)!.status, "종료");
    db.close();
    db2.db.close();
  });
  test("앞선 날짜의 뉴스만 붙이면 종료로 남고, 앞선 뉴스로는 상태를 바꿀 수 없다", () => {
    const { db, a } = setup();
    db.prepare("UPDATE issues SET status = '종료' WHERE id = ?").run(a);
    apply(db, attachFile(db, "2026-10-25", a), "2026-10-25");
    assert.equal(getIssue(db, a)!.status, "종료");
    db.close();
    const s2 = setup();
    const v = violations(s2.db, attachFile(s2.db, "2026-10-25", s2.a, { statusChanges: [{ issue: s2.a, status: "종료" }] }), "2026-10-25");
    assert.match(v, /최근 업데이트일\(2026-10-26\)보다 앞선 뉴스만 붙어 상태를 바꿀 수 없다/);
    s2.db.close();
  });
  test("같은 파일을 두 번 적용하면 두 번째는 바뀌는 것이 없다", () => {
    const { db, a } = setup();
    const f = attachFile(db, D, a);
    apply(db, f, D);
    const dump = () => JSON.stringify(["issues", "story_issues", "issue_relations", "meta"].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all()));
    const before = dump();
    const r = checkLinkFile(db, f, D);
    // 이미 연결된 뉴스라 검사는 거부하고, 적용은 할 일 없음이다
    assert.equal(r.ok, false);
    assert.deepEqual(applyLinkPlan(db, { date: D, newIssues: [], links: [], summaries: new Map(), statusChanges: [], relations: [] }, TODAY), { status: "nothing" });
    assert.equal(dump(), before);
    db.close();
  });
  test("검사에 실패하는 파일은 DB를 바꾸지 않는다", () => {
    const { db, a } = setup();
    const f = attachFile(db, D, a, { summaries: [] });
    const count = () => (db.prepare("SELECT (SELECT count(*) FROM issues) + (SELECT count(*) FROM story_issues) AS n").get() as { n: number }).n;
    const before = count();
    assert.equal(checkLinkFile(db, f, D).ok, false);
    assert.equal(count(), before);
    db.close();
  });
  test("첫 적용일이 첫 연결 적용일로 남는다", () => {
    const db = dbWith([D]);
    apply(db, oneIssuePerStory(db, D), D);
    assert.equal((db.prepare("SELECT value FROM meta WHERE key = 'first_linked_on'").get() as { value: string }).value, TODAY);
    db.close();
  });
});
