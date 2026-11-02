// 9.9단계 사이트(4.5): 공개 칸만 내보내기, 묶음 상태, 항목 글자, 읽음, 검색. 데이터는 모두 지어낸 것이다.
import { discoveryItemText, type SiteDiscoveryItem } from "../src/siteTypes.ts";
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { BUILDER_GROUP_NAMES, builderGroups, builderItemLabel, builderItemTitle, discoverEndNotice, discoverZeroText, repoStarsText, repoUpkeepText } from "../site/src/lib/builder.ts";
import { BUILDER_TAB, stateForHash } from "../site/src/lib/brief.ts";
import { createReadStore } from "../site/src/lib/readMarks.ts";
import { matchBuilderItems } from "../site/src/lib/search.ts";
import { insertBuilderItem, setBuilderStatus } from "../src/builderStore.ts";
import { insertDiscovery, saveSnapshotRows, setKindStatus, type NewDiscovery } from "../src/discoverStore.ts";
import { createIssue, updateIssue } from "../src/issues.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { dayBuilderOf, siteFiles, type BuilderMonth, type DayList, type MonthList } from "../src/siteTypes.ts";
import { TARGET, env } from "./builderFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

after(cleanupTemp);

const MONTH = TARGET.slice(0, 7);
const dataFile = (name: string) => `site-data/${name}`;
const product: NewDiscovery = { date: TARGET, kind: "product", key: "ph:fake-key-qzk", name: "가짜제품QZN", url: "https://www.producthunt.com/products/fake", purpose: "용도QZP", difference: "차이QZD", reason: "이유QZR", issue: null, license: null, pushedOn: null, release: null, stars: null, growth: null };
const repo: NewDiscovery = { ...product, kind: "repo", key: "repo:fake/key-qzk", name: "fake/repo-qzn", url: "https://github.com/fake/repo-qzn", license: "없음", pushedOn: "2026-10-20", release: { state: "none" }, stars: 2500, growth: 12.5 };

function summary(files: Map<string, string>, date = TARGET) {
  return (JSON.parse(files.get(dataFile(siteFiles.list(date.slice(0, 7))))!) as MonthList).days.find((d) => d.date === date)!.builder;
}

const month = (files: Map<string, string>) => JSON.parse(files.get(dataFile(siteFiles.builderItems(MONTH)))!) as BuilderMonth;

describe("4.5 사이트 데이터", () => {
  test("항목은 공개 칸만 있고, 중복 키와 숫자 행, 후보 재료는 결과물에 없다", () => {
    const e = env(TARGET);
    setKindStatus(e.db, TARGET, "product", "checked");
    setKindStatus(e.db, TARGET, "repo", "checked");
    insertDiscovery(e.db, product);
    insertDiscovery(e.db, repo);
    saveSnapshotRows(e.db, TARGET, [{ repo: "fake/repo-qzn", name: "fake/repo-qzn", stars: 2500, description: "지어낸설명QZM README 재료", language: "Rust", license: "MIT", pushedAt: "2026-10-20T00:00:00Z", forks: 3, createdAt: "2024-01-01T00:00:00Z" }]);
    const files = buildSiteData(e.db);
    const found = month(files).discoveries![TARGET]!;
    assert.deepEqual(found.map((x) => x.key), ["product-1", "repo-1"]);
    assert.deepEqual(Object.keys(found[0]!).sort(), ["difference", "issue", "key", "kind", "name", "purpose", "reason", "url"]);
    assert.deepEqual(found[1]!.repo, { license: "없음", pushedOn: "2026-10-20", release: { state: "none" }, stars: 2500, growth: 12.5 });
    const records = JSON.stringify(buildSearchRecords(e.db));
    for (const [name, content] of [...files, ["search-records", records] as const]) {
      for (const s of ["fake-key-qzk", "fake/key-qzk", "지어낸설명QZM"]) assert.ok(!content.includes(s), `${name}: ${s}`);
    }
    assert.ok(!files.get(dataFile(siteFiles.list(MONTH)))!.includes("가짜제품QZN"), "달 목록에 항목 글이 없다");
  });

  test("탭 건수는 세 종류의 합이고 달 목록에 종류별 수와 상태가 있다", () => {
    const e = env(TARGET);
    setBuilderStatus(e.db, TARGET, "partial");
    insertBuilderItem(e.db, TARGET, { field: "모델", title: "가짜", whatChanged: "x", who: "y", action: "없음", why: "z", due: null, sources: [{ name: "a", url: "https://builder.example.com/a" }], issue: null, reminderOf: null, keys: [] });
    setKindStatus(e.db, TARGET, "product", "failed");
    setKindStatus(e.db, TARGET, "repo", "baseline");
    insertDiscovery(e.db, product);
    assert.deepEqual(summary(buildSiteData(e.db)), { count: 2, status: "partial", product: { count: 1, status: "failed" }, repo: { count: 0, status: "baseline" } });
  });

  test("도구 변화 상태 없이 새 종류만 있어도 그날 탭이 있고 도구 변화 묶음은 없다", () => {
    const e = env(TARGET);
    setKindStatus(e.db, TARGET, "product", "checked");
    setKindStatus(e.db, TARGET, "repo", "off");
    const b = summary(buildSiteData(e.db))!;
    assert.deepEqual(b, { count: 0, status: null, product: { count: 0, status: "checked" } });
    assert.deepEqual(builderGroups(b).map((g) => g.kind), ["product"]);
  });

  test("꺼짐만 있는 날은 탭을 만들지 않고, 상태가 없는 종류(9.9 이전)는 묶음이 없다", () => {
    const e = env(TARGET);
    setKindStatus(e.db, TARGET, "product", "off");
    setKindStatus(e.db, TARGET, "repo", "off");
    assert.equal(summary(buildSiteData(e.db)), undefined);
    const old = env(TARGET);
    setBuilderStatus(old.db, TARGET, "checked");
    assert.deepEqual(summary(buildSiteData(old.db)), { count: 0, status: "checked" });
  });

  test("정정은 날짜와 사유만 최신순으로 나가고, 흡수된 이슈는 남는 이슈로 풀린다", () => {
    const e = env(TARGET);
    const issue = (name: string) => createIssue(e.db, { name, aliases: [], category: { major: "IT·AI", minor: "가짜", isNewMinor: false }, summary: "가짜 요약" });
    const into = issue("남는 이슈");
    const from = issue("흡수된 이슈");
    updateIssue(e.db, from, { mergedInto: into });
    setKindStatus(e.db, TARGET, "product", "checked");
    const id = insertDiscovery(e.db, { ...product, issue: from });
    e.db.prepare("INSERT INTO builder_discovery_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(id, "2026-10-28", "앞 사유", '["purpose"]');
    e.db.prepare("INSERT INTO builder_discovery_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(id, "2026-10-29", "뒤 사유", '["reason"]');
    const x = month(buildSiteData(e.db)).discoveries![TARGET]![0]!;
    assert.deepEqual(x.issue, { id: into, name: "남는 이슈" });
    assert.deepEqual(x.corrections, [{ on: "2026-10-29", reason: "뒤 사유" }, { on: "2026-10-28", reason: "앞 사유" }]);
  });

  test("도구 변화가 없는 달의 항목도 달 파일과 검색 레코드에 들어가 빌더 달 레코드로 찾아진다", () => {
    const e = env(TARGET);
    setKindStatus(e.db, TARGET, "repo", "checked");
    insertDiscovery(e.db, repo);
    const [r] = buildSearchRecords(e.db).filter((x) => x.meta?.kind === "builder");
    assert.equal(r!.meta!.month, MONTH);
    for (const s of ["fake/repo-qzn", "용도QZP", "차이QZD", "이유QZR"]) assert.ok(r!.content.includes(s), s);
  });
});

describe("4.5 화면 규칙", () => {
  test("묶음은 도구 변화, 새 제품, 뜨는 저장소 순서이고 도구 변화 항목 수는 합에서 뺀 값이다", () => {
    const b = dayBuilderOf({ count: 2, status: "checked" }, { repo: { count: 3, status: "checked" }, product: { count: 1, status: "failed" } })!;
    assert.equal(b.count, 6);
    assert.deepEqual(builderGroups(b).map((g) => [g.kind, g.count]), [["tools", 2], ["product", 1], ["repo", 3]]);
    assert.deepEqual(Object.values(BUILDER_GROUP_NAMES), ["도구 변화", "새 제품", "뜨는 저장소"]);
  });

  test("꺼짐이어도 이미 실린 항목은 묶음에 남고, 항목만 있고 상태가 없으면 확인함으로 본다", () => {
    assert.deepEqual(dayBuilderOf({ count: 0, status: null }, { product: { count: 1, status: "off" } }), { count: 1, status: null, product: { count: 1, status: "off" } });
    assert.deepEqual(dayBuilderOf({ count: 0, status: null }, { product: { count: 1, status: null } }), { count: 1, status: null, product: { count: 1, status: "checked" } });
    assert.equal(dayBuilderOf({ count: 0, status: null }, { product: { count: 0, status: "off" }, repo: { count: 0, status: null } }), null);
  });

  test("0건 문구는 상태마다 하나이고 꺼짐은 없다. 기준값은 저장소 문구다", () => {
    assert.equal(discoverZeroText("product", "checked"), "이날은 실을 만한 새 제품이 없다.");
    assert.equal(discoverZeroText("repo", "checked"), "이날은 실을 만한 뜨는 저장소가 없다.");
    assert.equal(discoverZeroText("product", "failed"), "이날의 새 제품을 받지 못했다.");
    assert.equal(discoverZeroText("repo", "failed"), "이날의 뜨는 저장소를 받지 못했다.");
    assert.match(discoverZeroText("repo", "baseline")!, /다음 날부터/);
    assert.equal(discoverZeroText("repo", "off"), null);
    assert.equal(discoverEndNotice("product", "failed"), "이날 새 제품은 다 받지 못했다.");
    assert.equal(discoverEndNotice("repo", "checked"), null);
  });

  test("관리 상태는 릴리스의 세 경우를 구별하고 별 수는 받은 값 그대로 쓴다", () => {
    assert.equal(repoUpkeepText({ pushedOn: "2026-10-20", release: { state: "found", date: "2026-09-01" } }), "마지막 push 2026년 10월 20일 · 최근 릴리스 2026년 9월 1일");
    assert.equal(repoUpkeepText({ pushedOn: "2026-10-20", release: { state: "none" } }), "마지막 push 2026년 10월 20일 · 최근 릴리스 없음");
    assert.equal(repoUpkeepText({ pushedOn: null, release: { state: "unknown" } }), "마지막 push 확인 못 함 · 최근 릴리스 확인 못 함");
    assert.equal(repoStarsText({ stars: 12345, growth: 678.5 }), "별 12,345개 · 하루 평균 +678.5개");
    assert.equal(repoStarsText({ stars: 2500, growth: 40 }), "별 2,500개 · 하루 평균 +40개");
    assert.equal(repoStarsText({ stars: null, growth: null }), "별 수 확인 못 함");
  });

  test("새 항목의 읽음은 날짜별 읽은 수에 세지 않는다", () => {
    const store = createReadStore(null, TARGET);
    store.setRead(TARGET, "product-1", true);
    store.setRead(TARGET, "repo-2", true);
    store.setRead(TARGET, "한국-top-1", true);
    assert.equal(store.isRead(TARGET, "repo-2"), true);
    assert.equal(store.readCount(TARGET), 1);
  });

  test("#product-N, #repo-N은 빌더 탭을 연다", () => {
    const day = { date: TARGET, sections: [{ name: "한국", stories: [] }], builder: { count: 1, status: null } } as unknown as DayList;
    const state = { section: "한국", major: null, expanded: null } as Parameters<typeof stateForHash>[2];
    assert.equal(stateForHash(day, "product-1", state).section, BUILDER_TAB);
    assert.equal(stateForHash(day, "repo-3", state).section, BUILDER_TAB);
  });

  test("검색: 묶음 이름과 라이선스 값으로도 찾아진다", () => {
    const text = discoveryItemText({ kind: "repo", name: "fake/one", purpose: "용도", difference: "차이", reason: "이유", repo: { license: "MIT" } as SiteDiscoveryItem["repo"] });
    assert.ok(text.includes("뜨는 저장소"));
    assert.ok(text.includes("MIT"));
    const unknown = discoveryItemText({ kind: "repo", name: "fake/two", purpose: "용도", difference: "차이", reason: "이유", repo: { license: "판별되지 않음" } as SiteDiscoveryItem["repo"] });
    assert.ok(unknown.includes("파일은 있으나"));
    assert.ok(discoveryItemText({ kind: "product", name: "가짜", purpose: "용도", difference: "차이", reason: "이유" }).includes("새 제품"));
  });

  test("검색: 달 파일에서 새 항목을 고르고 이름과 묶음 이름으로 보인다", () => {
    const item = { key: "repo-1", kind: "repo", name: "fake/needle", url: "u", purpose: "p", difference: "d", reason: "r", issue: null } as const;
    const file: BuilderMonth = { month: MONTH, days: {}, discoveries: { [TARGET]: [item, { ...item, key: "repo-2", name: "fake/other" }] } };
    const hit = matchBuilderItems(file, ["needle"]);
    assert.deepEqual(hit.map((x) => [x.date, x.item.key]), [[TARGET, "repo-1"]]);
    assert.equal(builderItemTitle(hit[0]!.item), "fake/needle");
    assert.equal(builderItemLabel(hit[0]!.item), "뜨는 저장소");
  });
});
