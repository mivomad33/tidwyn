import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement as h, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ENTITY_CHUNK_SIZE, entityChunkOf, siteFiles, termGroupOf } from "../src/siteTypes.ts";
import type { EntityChunk, EntityDetail, EntityListItem, IssueEntity, StoryDetail, TermGroupFile, TermIndex, TermItem, TermRef } from "../src/siteTypes.ts";
import { resolveStatic } from "../site/hosting.ts";
import { EntityChips, IssueEntityChips, TermBox, TermChips, TermText, type LinkLikeProps } from "../site/src/components/termView.ts";
import { entityListPages, issueEntityChips, joinEntityPages, parseEntityFilter, resolveEntity } from "../site/src/lib/entities.ts";
import { dataUrl } from "../site/src/lib/paths.ts";
import { entitiesPath, entityPath, focusTargetId, parseRoute, selfScrolls, termPath } from "../site/src/lib/routes.ts";
import { matchEntities, matchTerms, parseHit, queryTerms } from "../site/src/lib/search.ts";
import { buildTermFiles, initialTermGroups, placeTerms, resolveTerm, sortTerms, storyBodyParts, termBoxPlace, toggleTerm } from "../site/src/lib/terms.ts";
import { DARK, LIGHT, contrast, textPairs } from "../site/src/lib/theme.ts";

// 4단계 사이트 화면의 DOM 없는 로직(주소, 흡수·지운 대상·용어, 용어 밑줄·토글, 목록·사전 정렬, 검색 되찾기)과
// 펼친 카드의 용어 부분 그리기(react-dom/server). 값은 모두 지어낸 것이다.

const entityItem = (id: number, kind: EntityListItem["kind"], latestDate: string, count: number): EntityListItem => ({ id, name: `가짜 대상 ${id}`, kind, description: `가짜 설명 ${id}`, latestDate, count });

function entityDetail(id: number, over: Partial<EntityDetail> = {}): EntityDetail {
  return { ...entityItem(id, "기관", "2026-10-27", 1), aliases: [], firstDate: "2026-10-27", issues: [], news: [], moreNews: 0, ...over };
}

const termItem = (id: number, name: string, over: Partial<TermItem> = {}): TermItem => ({ id, name, aliases: [], description: `${name}의 가짜 설명`, first: null, count: 1, ...over });

describe("4.7-6 새 주소", () => {
  test("대상 목록·대상·용어 사전·용어 주소를 고른다", () => {
    assert.deepEqual(parseRoute("/entities"), { name: "entities", filter: "all" });
    assert.deepEqual(parseRoute("/entities/"), { name: "entities", filter: "all" });
    assert.deepEqual(parseRoute("/entities", "?kind=person"), { name: "entities", filter: "person" });
    assert.deepEqual(parseRoute("/entities", "?kind=nope"), { name: "entities", filter: "all" });
    assert.deepEqual(parseRoute("/entities/12"), { name: "entity", id: 12 });
    assert.deepEqual(parseRoute("/entities/0"), { name: "entity", id: 0 });
    assert.deepEqual(parseRoute("/terms"), { name: "terms", id: null });
    assert.deepEqual(parseRoute("/terms/7"), { name: "terms", id: 7 });
    assert.equal(entitiesPath(), "/entities");
    assert.equal(entitiesPath("country"), "/entities?kind=country");
    assert.equal(entityPath(12), "/entities/12");
    assert.equal(termPath(7), "/terms/7");
    assert.equal(parseEntityFilter("org"), "org");
    assert.equal(parseEntityFilter(null), "all");
  });
  test("틀린 식별자와 검색 레코드 주소는 없는 페이지다", () => {
    for (const p of ["/entities/abc", "/entities/012", "/entities/1/x", "/entities/-1", "/entities/1.5", "/entities/chunk/0", "/terms/abc", "/terms/007", "/terms/group/3", "/terms/1/2", "/entity", "/term"]) {
      assert.deepEqual(parseRoute(p), { name: "notFound" }, p);
    }
  });
  test("용어 주소만 화면이 스스로 그 용어로 스크롤하고, 앱 이동 뒤 초점은 본문이다", () => {
    assert.equal(selfScrolls(parseRoute("/terms/3")), true);
    for (const p of ["/terms", "/entities", "/entities/3", "/issues/3"]) assert.equal(selfScrolls(parseRoute(p)), false, p);
    for (const p of ["/terms", "/terms/3", "/entities", "/entities/3"]) assert.equal(focusTargetId(parseRoute(p)), "main", p);
  });
  test("새 화면 주소는 화면 틀로 가고, 없는 묶음 파일은 404다(호스팅 규칙)", () => {
    const files = new Set(["index.html", "site-data/entity-0.json", "site-data/term-index.json"]);
    const exists = (p: string) => files.has(p);
    for (const p of ["/entities", "/entities/3", "/terms", "/terms/3", "/entities/99999"]) assert.deepEqual(resolveStatic(p, exists), { kind: "fallback" }, p);
    assert.deepEqual(resolveStatic("/site-data/entity-0.json", exists), { kind: "file", path: "site-data/entity-0.json" });
    for (const p of ["/site-data/entity-999.json", "/site-data/term-group-3.json"]) assert.deepEqual(resolveStatic(p, exists), { kind: "notFound" }, p);
  });
  test("화면이 부르는 새 파일 이름이 사이트 데이터 약속(siteFiles)과 같다", () => {
    assert.equal(dataUrl.entityList("person", 2), `/site-data/${siteFiles.entityList("person", 2)}`);
    assert.equal(dataUrl.entityChunk(3), `/site-data/${siteFiles.entityChunk(3)}`);
    assert.equal(dataUrl.entityNews(3), `/site-data/${siteFiles.entityNews(3)}`);
    assert.equal(dataUrl.termIndex(), `/site-data/${siteFiles.termIndex}`);
    assert.equal(dataUrl.termGroup(14), `/site-data/${siteFiles.termGroup(14)}`);
  });
});

describe("4.7-4 흡수·지운 대상 주소", () => {
  const chunk: EntityChunk = { entities: { "1": entityDetail(1), "2": entityDetail(2) }, merged: { "3": { into: 1, on: "2026-10-26" }, "4": { into: 205, on: null } } };
  test("있는 대상은 그대로, 흡수된 대상은 남는 대상으로 간다(남는 대상이 다른 묶음이어도)", () => {
    assert.deepEqual(resolveEntity(2, chunk), { kind: "entity", id: 2 });
    assert.deepEqual(resolveEntity(3, chunk), { kind: "merged", into: 1, on: "2026-10-26" });
    assert.deepEqual(resolveEntity(4, chunk), { kind: "merged", into: 205, on: null });
    assert.equal(entityChunkOf(205), 2);
    assert.equal(ENTITY_CHUNK_SIZE, 100);
  });
  test("지운 대상과 없는 식별자는 null(없는 페이지)이다", () => {
    assert.equal(resolveEntity(5, chunk), null);
    assert.equal(resolveEntity(99, { entities: {}, merged: {} }), null);
  });
  test("합치기를 되돌린 데이터에서는 원래 대상을 보인다", () => {
    const undone: EntityChunk = { entities: { ...chunk.entities, "3": entityDetail(3) }, merged: {} };
    assert.deepEqual(resolveEntity(3, undone), { kind: "entity", id: 3 });
  });
});

describe("4.7-5 흡수·지운 용어 주소", () => {
  const index: Pick<TermIndex, "ids" | "merged"> = { ids: { "1": 0, "2": 14 }, merged: { "5": { into: 2, on: "2026-10-27" }, "6": { into: 9, on: null } } };
  test("용어 주소는 그 용어와 그 묶음을 가리키고, 흡수된 용어는 남는 용어로 간다", () => {
    assert.deepEqual(resolveTerm(1, index), { id: 1, group: 0, mergedFrom: null });
    assert.deepEqual(resolveTerm(5, index), { id: 2, group: 14, mergedFrom: { id: 5, on: "2026-10-27" } });
  });
  test("지운 용어, 없는 식별자, 남는 용어가 없는 흡수는 null이다", () => {
    assert.equal(resolveTerm(3, index), null);
    assert.equal(resolveTerm(6, index), null);
  });
});

describe("E8·4.7-1 용어 밑줄과 토글", () => {
  const detail: StoryDetail = {
    key: "한국-1",
    summary: "가짜 중앙은행이 금리를 묶었다.",
    whyItMatters: "양적긴축 속도가 느려진다. 양적긴축은 다시 논의된다.",
    background: "기준금리는 3.0%다.",
    keyFacts: ["가짜 사실 하나", "기준금리 동결은 세 번째다"],
    outlook: "양적긴축이 끝날 수 있다.",
    confidence: "보도에 따르면",
    sources: [],
    extras: [],
    previous: [],
  };
  const terms: TermRef[] = [
    { id: 1, name: "양적긴축", description: "가짜 설명 1", surface: "양적긴축" },
    { id: 2, name: "기준금리", description: "가짜 설명 2", surface: "기준금리" },
    { id: 3, name: "테이퍼링", description: "가짜 설명 3" },
    { id: 4, name: "금리", description: "가짜 설명 4", surface: "금리" },
  ];
  const parts = storyBodyParts(detail);
  const placement = placeTerms(parts, terms);
  const underlined = (id: number) => Object.entries(placement.segments).flatMap(([part, segs]) => segs.filter((s) => s.termId === id).map((s) => ({ part, text: s.text })));

  test("본문 순서는 한 줄 요약 → 왜 중요한가 → 배경 → 핵심 → 비유 → 전망이다", () => {
    assert.deepEqual(parts.map((p) => p.id), ["summary", "why", "background", "fact-0", "fact-1", "outlook"]);
    assert.deepEqual(storyBodyParts({ ...detail, analogy: "가짜 비유" }).map((p) => p.id).slice(-2), ["analogy", "outlook"]);
  });
  test("표기가 본문에 여러 번 나와도 처음 나온 곳 하나에만 밑줄을 긋는다", () => {
    assert.deepEqual(underlined(1), [{ part: "why", text: "양적긴축" }]);
    assert.equal(placement.segments.why!.filter((s) => s.termId === 1).length, 1);
    assert.equal(placement.segments.why!.map((s) => s.text).join(""), detail.whyItMatters, "글은 그대로다");
    assert.deepEqual(underlined(2), [{ part: "background", text: "기준금리" }]);
  });
  test("짧은 표기는 긴 표기 안을 차지하지 않고 다음에 나온 곳을 쓴다", () => {
    // "금리"는 요약의 "금리를"이 처음이다. "기준금리" 안의 "금리"에는 긋지 않는다
    assert.deepEqual(underlined(4), [{ part: "summary", text: "금리" }]);
    const only = placeTerms(storyBodyParts({ ...detail, summary: "가짜 요약" }), terms);
    const at = Object.entries(only.segments).flatMap(([part, segs]) => segs.filter((s) => s.termId === 4).map(() => part));
    assert.deepEqual(at, ["fact-1"], "배경의 '기준금리'는 긴 표기가 차지해 핵심의 다음 '기준금리' 안의 '금리'로 간다");
  });
  test("본문 표기가 없는 용어는 밑줄 없이 칩 줄 아래에서 연다", () => {
    assert.equal(underlined(3).length, 0);
    assert.equal(placement.placed.has(3), false);
    assert.equal(termBoxPlace(3, placement), "chips");
    assert.equal(termBoxPlace(1, placement), "why");
    assert.equal(termBoxPlace(null, placement), null);
    const missing = placeTerms(parts, [{ id: 9, name: "없는말", description: "", surface: "본문에없는표기" }]);
    assert.equal(termBoxPlace(9, missing), "chips", "표기를 본문에서 찾지 못하면 칩 줄 아래");
  });
  test("토글: 열기, 같은 것 다시 눌러 닫기, 다른 것으로 바꾸기(한 카드에 하나)", () => {
    let open: number | null = null;
    open = toggleTerm(open, 1);
    assert.equal(open, 1);
    open = toggleTerm(open, 1);
    assert.equal(open, null);
    open = toggleTerm(toggleTerm(open, 1), 3);
    assert.equal(open, 3);
    open = toggleTerm(open, 3);
    assert.equal(open, null);
  });

  const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);
  function card(openId: number | null): string {
    const boxId = "story-한국-1-term";
    const onToggle = () => {};
    const open = terms.find((t) => t.id === openId) ?? null;
    const at = termBoxPlace(openId, placement);
    const nodes: ReactNode[] = parts.map((p) =>
      h(Fragment, { key: p.id }, h("p", null, h(TermText, { segments: placement.segments[p.id]!, openId, onToggle, boxId })), open && at === p.id ? h(TermBox, { term: open, id: boxId, Link }) : null),
    );
    nodes.push(h(TermChips, { key: "chips", terms, openId, onToggle, boxId }), open && at === "chips" ? h(TermBox, { key: "box", term: open, id: boxId, Link }) : null);
    return renderToStaticMarkup(h(Fragment, null, ...nodes));
  }
  const buttons = (html: string) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map((m) => ({ attrs: m[1]!, text: m[2]! }));

  test("닫힌 카드: 밑줄 낱말과 칩은 단추이고 aria-expanded가 false다", () => {
    const html = card(null);
    const bs = buttons(html);
    assert.deepEqual(bs.filter((b) => b.attrs.includes('class="term"')).map((b) => b.text).sort(), ["금리", "기준금리", "양적긴축"]);
    assert.deepEqual(bs.filter((b) => !b.attrs.includes("term")).map((b) => b.text), ["양적긴축", "기준금리", "테이퍼링", "금리"], "칩 줄에는 표기가 없는 용어도 있다");
    for (const b of bs) {
      assert.match(b.attrs, /type="button"/);
      assert.match(b.attrs, /aria-expanded="false"/);
      assert.doesNotMatch(b.attrs, /aria-controls/);
    }
    assert.doesNotMatch(html, /class="tbox"/);
  });
  test("밑줄 낱말을 연 카드: 그 낱말과 칩이 열림·강조, 설명 상자는 그 문단 바로 아래 하나", () => {
    const html = card(1);
    const open = buttons(html).filter((b) => b.attrs.includes('aria-expanded="true"'));
    assert.deepEqual(open.map((b) => [b.text, /class="(term open|on)"/.exec(b.attrs)?.[1]]), [["양적긴축", "term open"], ["양적긴축", "on"]]);
    for (const b of open) assert.match(b.attrs, /aria-controls="story-한국-1-term"/);
    assert.equal(html.match(/class="tbox"/g)?.length, 1);
    assert.match(html, /양적긴축은 다시 논의된다\.<\/p><div id="story-한국-1-term" class="tbox"[^>]*><b>양적긴축<\/b>가짜 설명 1<a href="\/terms\/1">용어 사전에서 보기/);
  });
  test("표기가 없는 용어를 칩으로 연 카드: 칩만 강조되고 설명 상자는 칩 줄 아래다", () => {
    const html = card(3);
    const open = buttons(html).filter((b) => b.attrs.includes('aria-expanded="true"'));
    assert.deepEqual(open.map((b) => b.text), ["테이퍼링"]);
    assert.match(html, /<\/button><\/div><div id="story-한국-1-term" class="tbox"[^>]*><b>테이퍼링<\/b>/);
  });
  test("용어가 없으면 칩 줄을 그리지 않는다", () => {
    assert.equal(renderToStaticMarkup(h(TermChips, { terms: [], openId: null, onToggle: () => {}, boxId: "x" })), "");
  });

  test("4.7-2 인물·기관·국가 칩은 대상 페이지로 가고, 인물만 한 줄 설명을 작게 붙인다", () => {
    const html = renderToStaticMarkup(
      h(EntityChips, {
        entities: [
          { id: 7, name: "김가짜", kind: "인물", description: "가짜 중앙은행 총재" },
          { id: 12, name: "가짜 중앙은행", kind: "기관", description: "가짜국의 중앙은행" },
          { id: 30, name: "가짜국", kind: "국가", description: "가짜 대륙의 나라" },
        ],
        Link,
      }),
    );
    assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]), ["/entities/7", "/entities/12", "/entities/30"]);
    assert.match(html, /김가짜<small>가짜 중앙은행 총재<\/small>/);
    assert.equal(html.match(/<small>/g)?.length, 1);
    assert.equal(renderToStaticMarkup(h(EntityChips, { entities: [], Link })), "");
  });
});

describe("4.7-7 이슈 페이지의 등장 대상", () => {
  const ents: IssueEntity[] = Array.from({ length: 13 }, (_, i) => ({ id: 13 - i, name: `가짜 대상 ${13 - i}`, count: (i % 4) + 1 }));
  test("횟수 순(같으면 식별자 순), 최대 10개", () => {
    const got = issueEntityChips(ents);
    assert.equal(got.length, 10);
    for (let i = 1; i < got.length; i++) assert.ok(got[i - 1]!.count > got[i]!.count || (got[i - 1]!.count === got[i]!.count && got[i - 1]!.id < got[i]!.id));
    assert.deepEqual(got.slice(0, 3).map((e) => [e.id, e.count]), [[2, 4], [6, 4], [10, 4]]);
    assert.deepEqual(issueEntityChips(undefined), []);
  });
  test("칩은 이름과 횟수이고 대상 페이지로 간다. 없으면 그리지 않는다", () => {
    const Link = ({ to, children }: LinkLikeProps) => h("a", { href: to }, children);
    const html = renderToStaticMarkup(h(IssueEntityChips, { entities: ents, Link }));
    assert.equal(html.match(/<a /g)?.length, 10);
    assert.match(html, /^<div class="rel"><a href="\/entities\/2">가짜 대상 2<small>4<span class="sr-only">회<\/span><\/small><\/a>/);
    assert.equal(renderToStaticMarkup(h(IssueEntityChips, { entities: [], Link })), "");
  });
});

describe("4.7-3 인물·기관·국가 목록", () => {
  const items = [
    entityItem(1, "기관", "2026-10-20", 9),
    entityItem(2, "인물", "2026-10-27", 3),
    entityItem(3, "국가", "2026-10-27", 21),
    entityItem(4, "인물", "2026-10-27", 3),
    entityItem(5, "기관", "2026-10-26", 1),
  ];
  test("최근 등장일 순, 같으면 뉴스 수 많은 순, 같으면 식별자 순", () => {
    assert.deepEqual(entityListPages(items, "all")[0]!.items.map((i) => i.id), [3, 2, 4, 5, 1]);
  });
  test("종류로 거른다", () => {
    assert.deepEqual(entityListPages(items, "person")[0]!.items.map((i) => i.id), [2, 4]);
    assert.deepEqual(entityListPages(items, "org")[0]!.items.map((i) => i.id), [5, 1]);
    assert.deepEqual(entityListPages(items, "country")[0]!.items.map((i) => i.id), [3]);
  });
  test("쪽으로 나누고, 거른 결과가 없어도 0쪽이 있다. 받은 쪽들을 순서대로 잇는다", () => {
    const pages = entityListPages(items, "all", 2);
    assert.deepEqual(pages.map((p) => [p.page, p.pages, p.total, p.items.length]), [[0, 3, 5, 2], [1, 3, 5, 2], [2, 3, 5, 1]]);
    assert.deepEqual(joinEntityPages([pages[1]!, pages[0]!]).map((i) => i.id), [3, 2, 4, 5]);
    assert.deepEqual(entityListPages([], "country"), [{ filter: "country", page: 0, pages: 1, total: 0, items: [] }]);
    assert.deepEqual(entityListPages(items.filter((i) => i.kind !== "국가"), "country")[0]!.items, []);
  });
});

describe("4.7-5 용어 사전 정렬과 묶음", () => {
  const items = [termItem(1, "테이퍼링"), termItem(2, "ETF"), termItem(3, "기준금리"), termItem(4, "5G"), termItem(5, "까치 효과"), termItem(6, "가짜 지수"), termItem(7, "hbm"), termItem(8, "양적긴축"), termItem(9, "ㅎ 약어")];
  test("가나다순이고 된소리는 예사소리 묶음, 영문·숫자는 마지막이다", () => {
    assert.deepEqual(sortTerms(items).map((t) => t.name), ["가짜 지수", "기준금리", "까치 효과", "양적긴축", "테이퍼링", "ㅎ 약어", "5G", "ETF", "hbm"]);
    assert.equal(termGroupOf("까치 효과"), 0);
    assert.equal(termGroupOf("ETF"), 14);
  });
  test("색인은 모든 묶음(0개 포함)과 식별자 → 묶음을 담고, 묶음 파일은 용어가 있는 묶음만이다", () => {
    const { index, groups } = buildTermFiles(items, { "10": { into: 3, on: "2026-10-27" } });
    assert.equal(index.total, items.length);
    assert.equal(index.groups.length, 15);
    assert.deepEqual(index.groups.at(-1), { group: 14, label: "영문·숫자", count: 3 });
    assert.equal(index.groups[1]!.count, 0);
    assert.deepEqual([...groups.keys()].sort((a, b) => a - b), [0, 7, 11, 13, 14]);
    assert.deepEqual(groups.get(0)!.map((t) => t.id), [6, 3, 5]);
    assert.equal(index.ids["4"], 14);
    assert.deepEqual(resolveTerm(10, index), { id: 3, group: 0, mergedFrom: { id: 10, on: "2026-10-27" } });
  });
  test("첫 화면은 용어가 있는 앞쪽 묶음부터 정해진 수에 닿을 때까지만 받는다", () => {
    const groups = [5, 0, 40, 10, 0, 7].map((count, group) => ({ group, label: String(group), count }));
    assert.deepEqual(initialTermGroups({ groups }, 30), [0, 2]);
    assert.deepEqual(initialTermGroups({ groups }, 3), [0]);
    assert.deepEqual(initialTermGroups({ groups: groups.map((g) => ({ ...g, count: 0 })) }), []);
  });
});

describe("4.6-4 대상·용어 검색 되찾기", () => {
  test("대상·용어 묶음 레코드 정보를 읽는다", () => {
    assert.deepEqual(parseHit("/entities/chunk/2", { kind: "entities", chunk: "2" }), { kind: "entities", chunk: 2 });
    assert.deepEqual(parseHit("/terms/group/14", { kind: "terms", group: "14" }), { kind: "terms", group: 14 });
    assert.deepEqual(parseHit("/entities/chunk/0", {}), { kind: "entities", chunk: 0 });
    assert.deepEqual(parseHit("/terms/group/3", undefined), { kind: "terms", group: 3 });
    assert.equal(parseHit("/entities/3", {}), null);
    assert.equal(parseHit("/terms/group/x", { kind: "terms", group: "x" }), null);
  });
  const chunk: EntityChunk = {
    entities: {
      "1": entityDetail(1, { name: "가짜전자", aliases: ["Gajja Electronics"], description: "가짜국의 반도체 기업", latestDate: "2026-10-20" }),
      "2": entityDetail(2, { name: "김가짜", kind: "인물", aliases: ["Kim Gajja"], description: "가짜전자 회장", latestDate: "2026-10-27" }),
    },
    // 흡수된 대상은 merged에만 있고, 지운 대상은 어디에도 없다
    merged: { "3": { into: 1, on: null } },
  };
  test("대상을 이름·별칭(영어)·한 줄 설명으로 찾는다", () => {
    assert.deepEqual(matchEntities(chunk, queryTerms("gajja electronics")).map((e) => e.id), [1]);
    assert.deepEqual(matchEntities(chunk, queryTerms("Kim")).map((e) => e.id), [2]);
    assert.deepEqual(matchEntities(chunk, queryTerms("가짜전자")).map((e) => e.id), [2, 1], "설명에 나온 것도 찾고, 최근 등장 순이다");
    assert.deepEqual(matchEntities(chunk, queryTerms("가짜지운대상")), []);
  });
  test("용어를 이름·별칭·설명으로 찾는다", () => {
    const group: TermGroupFile = { group: 7, terms: [termItem(8, "양적긴축", { aliases: ["QT"] }), termItem(11, "유상증자")] };
    assert.deepEqual(matchTerms(group, queryTerms("qt")).map((t) => t.id), [8]);
    assert.deepEqual(matchTerms(group, queryTerms("유상증자")).map((t) => t.id), [11]);
    assert.deepEqual(matchTerms(group, queryTerms("없는용어")), []);
  });
});

describe("4.7-9 새 화면의 대비", () => {
  test("강조된 낱말(강조 바탕 위 글자)이 라이트·다크 모두 4.5:1 이상이다", () => {
    for (const p of [LIGHT, DARK]) {
      const pair = textPairs(p).find((x) => x.name === "강조된 낱말");
      assert.ok(pair, "대비 검사 목록에 있다");
      assert.ok(contrast(pair.fg, pair.bg) >= 4.5);
    }
  });
});
