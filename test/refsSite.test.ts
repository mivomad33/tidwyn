import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { storiesOfDate } from "../src/issues.ts";
import { createEntity, linkEntity } from "../src/refs.ts";
import { unmergeRef } from "../src/refMerge.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import type { EntityChunk, EntityListPage, IssueChunk, MonthDetail, TermGroupFile, TermIndex } from "../src/siteTypes.ts";
import { cleanupTemp } from "./helpers.ts";
import { DELETED_TEXTS, REF_DATES, REF_TODAY, refSiteDb } from "./refsFixture.ts";

after(cleanupTemp);

// 4단계 4.6-1·4.6-3·4.6-4·4.7-4: DB에서 만든 사이트 데이터(실제 빌더 buildSiteData·buildSearchRecords)

function parse<T>(files: Map<string, string>, name: string): T {
  const v = files.get(`site-data/${name}`);
  assert.ok(v !== undefined, name);
  return JSON.parse(v) as T;
}

const [D1, D2, D3] = REF_DATES;

describe("4단계 4.6-1 DB에서 만든 사이트 데이터", () => {
  test("펼친 카드에 뉴스마다 대상·용어(본문 표기)가 붙고, 지운 대상은 없으며, 연결 없는 뉴스에는 항목이 없다", () => {
    const { db, ids } = refSiteDb();
    const detail = parse<MonthDetail>(buildSiteData(db), "detail-2026-10.json");
    const k1 = detail.days[D3]!["한국-1"]!;
    assert.deepEqual(k1.entities, [{ id: ids.kim, name: "김가짜", kind: "인물", description: "가짜국 재무장관" }]);
    assert.deepEqual(
      k1.terms?.map((t) => [t.id, t.name, t.surface ?? null]),
      [
        [ids.qe, "양적완화", "양적완화"],
        [ids.abc, "ABC지수", null],
      ].sort((a, b) => (a[0] as number) - (b[0] as number)),
    );
    // 흡수된 대상(10-26 한국-2)은 남는 대상으로, 흡수된 용어(10-28 한국-2)는 남는 용어로 보인다
    assert.deepEqual(detail.days[D1]!["한국-2"]!.entities?.map((e) => e.id), [ids.kim]);
    assert.deepEqual(detail.days[D3]!["한국-2"]!.terms?.map((t) => t.id), [ids.qe]);
    // 지운 대상만 붙었던 뉴스에는 항목이 없다
    assert.equal(detail.days[D2]!["한국-2"]!.entities, undefined);
    assert.equal(detail.days[D2]!["한국-3"]!.entities, undefined);
    assert.equal(detail.days[D1]!["한국-4"]!.terms, undefined);
    db.close();
  });

  test("대상 목록·상세: 최근 순, 별칭, 처음·최근 등장일, 이슈별 수(흡수된 이슈는 남는 이슈로), 최근 순 뉴스, 흡수 정보", () => {
    const { db, ids } = refSiteDb();
    const files = buildSiteData(db);
    const all = parse<EntityListPage>(files, "entity-list-all-0.json");
    assert.deepEqual(all.items.map((i) => [i.id, i.latestDate, i.count]), [
      [ids.kim, D3, 4],
      [ids.ge, D3, 1],
    ]);
    assert.deepEqual(parse<EntityListPage>(files, "entity-list-person-0.json").items.map((i) => i.id), [ids.kim]);
    assert.deepEqual(parse<EntityListPage>(files, "entity-list-org-0.json").items.map((i) => i.id), [ids.ge]);
    assert.equal(parse<EntityListPage>(files, "entity-list-country-0.json").total, 0);
    const chunk = parse<EntityChunk>(files, "entity-0.json");
    const kim = chunk.entities[String(ids.kim)]!;
    assert.deepEqual(kim.aliases, ["Kim Gajja", "김가짜 장관"]);
    assert.deepEqual([kim.firstDate, kim.latestDate, kim.count], [D1, D3, 4]);
    assert.deepEqual(kim.issues, [{ id: ids.i1, name: "가짜 금리 이야기", count: 3 }], "흡수된 이슈 i2의 뉴스도 i1로 센다");
    assert.deepEqual(kim.news.map((n) => n.date), [D3, D2, D1, D1]);
    assert.equal(kim.news[0]!.issue, "가짜 금리 이야기");
    assert.equal(kim.moreNews, 0);
    assert.deepEqual(chunk.merged, { [String(ids.dup)]: { into: ids.kim, on: REF_TODAY } });
    assert.ok(!(String(ids.del) in chunk.entities) && !(String(ids.del) in chunk.merged), "지운 대상");
    db.close();
  });

  test("용어 색인·묶음: 가나다순, 영문·숫자는 마지막 묶음, 처음 나온 뉴스, 뉴스 수, 흡수 정보", () => {
    const { db, ids } = refSiteDb();
    const files = buildSiteData(db);
    const index = parse<TermIndex>(files, "term-index.json");
    assert.equal(index.total, 3);
    assert.deepEqual(index.ids, { [String(ids.qe)]: 7, [String(ids.repo)]: 7, [String(ids.abc)]: 14 });
    assert.deepEqual(index.merged, { [String(ids.qe2)]: { into: ids.qe, on: REF_TODAY } });
    const g7 = parse<TermGroupFile>(files, "term-group-7.json");
    assert.deepEqual(g7.terms.map((t) => t.name), ["양적완화", "역레포"]);
    const qe = g7.terms[0]!;
    assert.equal(qe.first?.date, D1, "나중에 연결한 이른 날짜가 처음 나온 뉴스다");
    assert.equal(qe.first?.key, "한국-1");
    assert.equal(qe.count, 3, "흡수된 용어의 뉴스까지 센다");
    assert.deepEqual(qe.aliases, ["QE", "양적 완화 정책"]);
    assert.deepEqual(parse<TermGroupFile>(files, "term-group-14.json").terms.map((t) => t.name), ["ABC지수"]);
    db.close();
  });

  test("이슈 데이터의 등장 대상은 횟수 순이고 최대 10개이며, 흡수된 이슈의 뉴스도 남는 이슈로 센다", () => {
    const { db, ids } = refSiteDb();
    let issue = parse<IssueChunk>(buildSiteData(db), "issue-0.json").issues[String(ids.i1)]!;
    assert.deepEqual(issue.entities, [{ id: ids.kim, name: "김가짜", count: 3 }]);
    // 12개를 더 붙이면 10개만 남고, 횟수가 많은 김가짜가 맨 앞이다
    const story = storiesOfDate(db, D2).find((s) => s.key === "한국-1")!.id;
    for (let i = 0; i < 12; i++) linkEntity(db, story, createEntity(db, { kind: "기관", name: `가상기관${i}호`, aliases: [], description: "가상 기관", describedOn: null, describedStory: null }));
    issue = parse<IssueChunk>(buildSiteData(db), "issue-0.json").issues[String(ids.i1)]!;
    assert.equal(issue.entities?.length, 10);
    assert.equal(issue.entities?.[0]?.id, ids.kim);
    db.close();
  });

  test("지운 대상의 이름·별칭·설명과 합치기 이유는 사이트 데이터와 검색 레코드 어디에도 없다", () => {
    const { db } = refSiteDb();
    const text = [...buildSiteData(db).values()].join("\n") + JSON.stringify(buildSearchRecords(db));
    for (const s of DELETED_TEXTS) assert.ok(!text.includes(s), s);
    db.close();
  });
});

describe("4단계 4.6-3 같은 DB, 같은 결과(대상·용어가 있는 DB)", () => {
  test("두 번 만들면 사이트 데이터와 검색 레코드가 바이트 단위로 같다", () => {
    const { db } = refSiteDb();
    const first = buildSiteData(db);
    const second = buildSiteData(db);
    assert.deepEqual([...second.keys()], [...first.keys()]);
    for (const [k, v] of first) assert.equal(second.get(k), v, k);
    assert.equal(JSON.stringify(buildSearchRecords(db)), JSON.stringify(buildSearchRecords(db)));
    db.close();
  });
});

describe("4단계 4.6-4 검색 레코드(DB에서)", () => {
  test("대상 레코드에 이름·별칭·설명이, 용어 레코드에 이름·별칭·설명이 있고, 흡수된 것은 따로 레코드가 없다", () => {
    const { db } = refSiteDb();
    const records = buildSearchRecords(db);
    const entities = records.filter((r) => r.meta?.kind === "entities");
    const terms = records.filter((r) => r.meta?.kind === "terms");
    assert.equal(entities.length, 1);
    for (const s of ["김가짜", "Kim Gajja", "가짜전자", "Gajja Electronics", "가짜국 전자 회사"]) assert.ok(entities[0]!.content.includes(s), s);
    assert.deepEqual(terms.map((r) => r.url), ["/terms/group/7", "/terms/group/14"]);
    assert.ok(terms[0]!.content.split("\n").includes("양적완화") && terms[0]!.content.includes("QE"));
    assert.equal(terms[0]!.content.split("\n").filter((l) => l === "양적 완화 정책").length, 1, "흡수된 용어 이름은 남는 용어의 별칭으로만 있다");
    db.close();
  });
});

describe("4단계 4.7-4 되돌린 DB로 다시 빌드", () => {
  test("대상 합치기를 되돌린 뒤 다시 만들면 흡수됐던 대상이 원래대로 목록·상세에 나오고 흡수 정보에서 빠진다", () => {
    const { db, ids } = refSiteDb();
    assert.ok(unmergeRef(db, ids.entityMerge, REF_TODAY).ok);
    const files = buildSiteData(db);
    const chunk = parse<EntityChunk>(files, "entity-0.json");
    assert.ok(!(String(ids.dup) in chunk.merged));
    const dup = chunk.entities[String(ids.dup)]!;
    assert.deepEqual([dup.name, dup.count, dup.firstDate], ["김가짜 장관", 1, D1]);
    assert.equal(chunk.entities[String(ids.kim)]!.count, 3);
    assert.ok(parse<EntityListPage>(files, "entity-list-person-0.json").items.some((i) => i.id === ids.dup));
    assert.deepEqual(parse<MonthDetail>(files, "detail-2026-10.json").days[D1]!["한국-2"]!.entities?.map((e) => e.id), [ids.dup]);
    db.close();
  });
});
