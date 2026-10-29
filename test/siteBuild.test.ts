import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, describe, test } from "node:test";
import type { DayList, IssueChunk, MonthDetail, MonthList, SearchRecord, SiteDates, SiteIssueList } from "../src/siteTypes.ts";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { generateFixtures, writeFixtures } from "../site/dev/fixtures.ts";
import { FIRST_SCREEN_BUDGET, measureOutput } from "../site/size.ts";
import { matchDayStories, matchIssues, parseHit, queryTerms } from "../site/src/lib/search.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import type { EntityChunk, EntityListPage, EntityNewsChunk, IssueDetail, TermGroupFile, TermIndex } from "../src/siteTypes.ts";
import { measureScreens } from "../site/size.ts";
import { matchEntities, matchTerms } from "../site/src/lib/search.ts";
import { resolveStatic } from "../site/hosting.ts";
import { resolveEntity } from "../site/src/lib/entities.ts";
import { placeTerms, resolveTerm, storyBodyParts } from "../site/src/lib/terms.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { DELETED_TEXTS, refSiteDb } from "./refsFixture.ts";

// 사이트 빌드(4.1-2·4.1-4·4.3-3·4.3-7·4.6-1·4.6-2). 지어낸 데이터만 쓰고 네트워크를 쓰지 않는다.

after(cleanupTemp);

function hashTree(dir: string): Record<string, string> {
  return Object.fromEntries(listFilesRecursive(dir).map((f) => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(dir, f))).digest("hex")]));
}

interface PagefindHit {
  url: string;
  meta: Record<string, string>;
}

/** 결과물의 Pagefind 브라우저 API를 Node에서 불러 검색한다(file: 주소는 디스크에서 읽는다) */
async function searchOutput(outDir: string, queries: string[]): Promise<Map<string, PagefindHit[]>> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("file:")) throw new Error(`네트워크 요청 금지: ${url}`);
    return new Response(fs.readFileSync(fileURLToPath(url.split("?")[0]!)));
  }) as typeof fetch;
  try {
    const pf = (await import(pathToFileURL(path.join(outDir, "pagefind", "pagefind.js")).href)) as {
      options: (o: object) => Promise<void>;
      init: () => Promise<void>;
      search: (q: string) => Promise<{ results: { data: () => Promise<PagefindHit> }[] }>;
      destroy?: () => Promise<void>;
    };
    await pf.options({});
    await pf.init();
    const out = new Map<string, PagefindHit[]>();
    for (const q of queries) {
      const res = await pf.search(q);
      out.set(q, await Promise.all(res.results.map((r) => r.data())));
    }
    await pf.destroy?.();
    return out;
  } finally {
    globalThis.fetch = realFetch;
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

describe("사이트 빌드", () => {
  const work = tempDir("tidwyn-site-");
  const dataDir = path.join(work, "data");
  const outA = path.join(work, "out-a");
  const outB = path.join(work, "out-b");
  const fx = writeFixtures(dataDir, { days: 6 });
  fs.writeFileSync(path.join(dataDir, "site-data", "notes.txt"), "json이 아닌 파일은 옮기지 않는다");
  fs.writeFileSync(path.join(dataDir, "tidwyn.db"), "SQLite format 3\0");

  test("결과물: 화면 틀·화면 파일·사이트 데이터·검색 색인·호스팅 설정만 있다(4.1-4, 4.6-1)", async () => {
    fs.mkdirSync(outA, { recursive: true });
    fs.writeFileSync(path.join(outA, "stale.txt"), "지난 빌드의 파일");
    const res = await buildSite({ dataDir, outDir: outA });
    const files = listFilesRecursive(outA);
    assert.deepEqual(res.files, files);
    assert.ok(!files.includes("stale.txt"), "빌드마다 결과물 폴더를 비운다");
    const top = [...new Set(files.map((f) => f.split("/")[0]!))].sort();
    assert.deepEqual(top, ["assets", "index.html", "pagefind", "site-data", "vercel.json"]);
    assert.ok(!files.some((f) => f.endsWith(".db") || f.includes("search-records") || f.endsWith(".txt")), files.join("\n"));
    const expectedData = [...fx.files.keys()].filter((f) => f.startsWith("site-data/")).sort();
    assert.deepEqual(files.filter((f) => f.startsWith("site-data/")), expectedData);
    assert.ok(files.includes("pagefind/pagefind.js") && files.includes("pagefind/pagefind-entry.json"));
    assert.ok(!files.some((f) => /pagefind-(ui|modular-ui|component-ui|highlight)\./.test(f)), "기본 검색 UI 파일은 뺀다");
    const html = fs.readFileSync(path.join(outA, "index.html"), "utf8");
    assert.match(html, /<html lang="ko">/);
    assert.match(html, /prefers-color-scheme: dark/);
    assert.doesNotMatch(html, /https?:\/\/(?!tidwyn)/, "외부 글꼴·스크립트를 부르지 않는다");
    const css = files.filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(outA, f), "utf8")).join("");
    assert.doesNotMatch(css, /@import|@font-face|url\(https?:/, "외부 글꼴을 부르지 않는다");
    const vercel = readJson<{ rewrites: { source: string }[] }>(path.join(outA, "vercel.json"));
    assert.equal(vercel.rewrites.length, 1);
  });

  test("같은 입력이면 같은 결과물이다(4.1-2)", async () => {
    await buildSite({ dataDir, outDir: outB });
    assert.deepEqual(hashTree(outB), hashTree(outA));
  });

  test("데이터 폴더나 그것을 품은 폴더는 결과물 폴더로 쓰지 않는다", async () => {
    await assert.rejects(buildSite({ dataDir, outDir: dataDir }), /데이터 폴더/);
    await assert.rejects(buildSite({ dataDir, outDir: work }), /데이터 폴더/);
    assert.ok(fs.existsSync(path.join(dataDir, "search-records.json")));
  });

  test("4.3-3 색인에서 본문 낱말·조사 붙은 낱말·이슈 별칭으로 찾고, 걸린 묶음에서 개별 뉴스·이슈를 되찾는다", async () => {
    const records = readJson<SearchRecord[]>(path.join(dataDir, "search-records.json"));
    const issueChunk = readJson<IssueChunk>(path.join(outA, "site-data", "issue-0.json"));
    const alias = Object.values(issueChunk.issues).find((i) => i.aliases.length)!.aliases[0]!;
    const hits = await searchOutput(outA, ["반도체", "끌어올렸다", alias]);

    // "반도체가"가 든 날짜 레코드를 "반도체"로 찾고, 그 날짜에서 그 뉴스를 되찾는다
    const semi = hits.get("반도체")!.map((h) => parseHit(h.url, h.meta));
    const firstDate = fx.dates.at(-1)!;
    assert.ok(semi.some((h) => h?.kind === "news" && h.date === firstDate), JSON.stringify(semi));
    const month = firstDate.slice(0, 7);
    const list = readJson<MonthList>(path.join(outA, "site-data", `list-${month}.json`));
    const detail = readJson<MonthDetail>(path.join(outA, "site-data", `detail-${month}.json`));
    const day = list.days.find((d) => d.date === firstDate) as DayList;
    const found = matchDayStories(day, detail.days[firstDate], queryTerms("반도체"));
    assert.ok(found.some((s) => s.title.includes("반도체가")), found.map((s) => s.title).join("\n"));
    for (const s of found) assert.ok([s.title, JSON.stringify(detail.days[firstDate]?.[s.key] ?? {})].join(" ").includes("반도체"));

    // 이슈 별칭으로 이슈 묶음 레코드를 찾고, 그 이슈를 되찾는다
    const aliasHits = hits.get(alias)!.map((h) => parseHit(h.url, h.meta));
    assert.deepEqual(aliasHits, [{ kind: "issues", chunk: 0 }]);
    const issueList = readJson<SiteIssueList>(path.join(outA, "site-data", "issue-list.json"));
    const issues = matchIssues(issueChunk, queryTerms(alias), issueList.merged);
    assert.equal(issues.length, 1);
    assert.ok(issues[0]!.aliases.includes(alias));
    assert.equal(records.filter((r) => r.meta?.kind === "news").length, fx.dates.length, "뉴스 레코드는 날짜마다 하나");
  });

  test("4.3-7 한 달이 가득 찬 데이터(하루 40건 넘게 × 31일)에서도 첫 화면이 gzip 300KB 이하다", async () => {
    const full = path.join(work, "full");
    const out = path.join(work, "full-out");
    const big = writeFixtures(full, { end: "2026-10-31", days: 31, top: 6, short: 8, issues: 400, contiguous: true });
    const dates = readJson<SiteDates>(path.join(full, "site-data", "dates.json"));
    assert.deepEqual(dates.months, ["2026-10"]);
    const perDay = readJson<MonthList>(path.join(full, "site-data", "list-2026-10.json")).days[0]!.sections.reduce((n, s) => n + s.stories.length, 0);
    assert.ok(perDay >= 40 && big.dates.length === 31, `하루 ${perDay}건`);
    await buildSite({ dataDir: full, outDir: out });
    const size = measureOutput(out);
    assert.ok(size.firstScreen.files.some((f) => f.path === "site-data/list-2026-10.json"));
    assert.ok(!size.firstScreen.files.some((f) => f.path.includes("detail-")), "본문 파일은 첫 화면에 받지 않는다");
    assert.ok(size.firstScreen.gzip <= FIRST_SCREEN_BUDGET, `첫 화면 gzip ${size.firstScreen.gzip}B`);
  });
});

describe("지어낸 데이터", () => {
  test("같은 인자면 같고, 흡수된 이슈·이미지·어제에 이어·M월 D일에 이어가 들어 있다", () => {
    const a = generateFixtures({ days: 7 });
    const b = generateFixtures({ days: 7 });
    assert.deepEqual([...a.files], [...b.files]);
    assert.ok(a.info.imageStory);
    const issueList = JSON.parse(a.files.get("site-data/issue-list.json")!) as SiteIssueList;
    assert.ok(Object.keys(issueList.merged).length === 1 && !issueList.issues.some((i) => issueList.merged[String(i.id)]));
    const labels = new Set<string>();
    for (const [name, content] of a.files) {
      if (!name.startsWith("site-data/list-")) continue;
      for (const d of (JSON.parse(content) as MonthList).days) for (const s of d.sections) for (const st of s.stories) if (st.continues) labels.add(st.continues.label === "어제에 이어" ? "어제" : "날짜");
    }
    assert.deepEqual([...labels].sort(), ["날짜", "어제"]);
  });
});

describe("4단계 사이트 빌드: 인물·기관·국가와 용어 사전", () => {
  const work = tempDir("tidwyn-site4-");
  const dataDir = path.join(work, "data");
  const out = path.join(work, "out");
  const fx = writeFixtures(dataDir, { days: 6 });
  const data = (name: string) => path.join(out, "site-data", name);

  test("새 파일이 결과물에 있고, 새 화면 주소는 화면 틀로 간다(4.6-1, 4.7-6)", async () => {
    await buildSite({ dataDir, outDir: out });
    const files = new Set(listFilesRecursive(out));
    for (const f of ["all", "person", "org", "country"]) assert.ok(files.has(`site-data/entity-list-${f}-0.json`), f);
    for (const f of ["site-data/entity-0.json", "site-data/entity-news-0.json", "site-data/term-index.json", "site-data/term-group-0.json"]) assert.ok(files.has(f), f);
    const exists = (p: string) => files.has(p);
    for (const p of ["/entities", "/entities/1", "/terms", "/terms/1"]) assert.deepEqual(resolveStatic(p, exists), { kind: "fallback" }, p);
    assert.deepEqual(resolveStatic("/site-data/entity-999.json", exists), { kind: "notFound" }, "없는 묶음은 404(화면은 없는 페이지)");
  });

  test("흡수된 대상·용어는 남는 것으로 가고, 지운 대상은 어디에도 없다(4.7-4, 4.7-5)", () => {
    const chunk = readJson<EntityChunk>(data("entity-0.json"));
    const { merged, deleted } = fx.info.entities;
    assert.ok(merged && deleted);
    assert.deepEqual(resolveEntity(merged.id, chunk), { kind: "merged", into: merged.into, on: merged.on });
    assert.equal(resolveEntity(merged.into, chunk)?.kind, "entity");
    assert.equal(resolveEntity(deleted.id, chunk), null);
    const all = readJson<EntityListPage>(data("entity-list-all-0.json"));
    assert.ok(!all.items.some((i) => i.id === deleted.id || i.id === merged.id));
    assert.ok(!fs.readFileSync(path.join(dataDir, "search-records.json"), "utf8").includes(deleted.name), "지운 대상은 검색 레코드에 없다");
    const index = readJson<TermIndex>(data("term-index.json"));
    const tm = fx.info.terms.merged!;
    assert.equal(resolveTerm(tm.id, index)?.id, tm.into);
    assert.equal(resolveTerm(fx.info.terms.deleted!, index), null);
    assert.equal(index.total, Object.keys(index.ids).length);
  });

  test("뉴스가 많은 대상은 처음 20건과 나머지 묶음, 거르기 쪽은 종류만 담는다(4.7-3, 4.7-4)", () => {
    const chunk = readJson<EntityChunk>(data("entity-0.json"));
    const many = Object.values(chunk.entities).find((e) => e.moreNews > 0)!;
    assert.ok(many, "더 보기가 있는 대상");
    assert.equal(many.news.length, 20);
    const rest = readJson<EntityNewsChunk>(data("entity-news-0.json")).news[String(many.id)]!;
    assert.equal(rest.length, many.moreNews);
    assert.equal(many.news.length + rest.length, many.count);
    const dates = [...many.news, ...rest].map((n) => n.date);
    assert.deepEqual(dates, [...dates].sort().reverse(), "최근 순");
    const person = readJson<EntityListPage>(data("entity-list-person-0.json"));
    assert.ok(person.items.length > 0 && person.items.every((i) => i.kind === "인물"));
  });

  test("본문 표기가 두 번 나오는 용어와 표기 없는 용어가 있고, 밑줄은 하나다(E8)", () => {
    const { twice, noSurface } = fx.info.terms;
    assert.ok(twice && noSurface !== null);
    const detail = readJson<MonthDetail>(data(`detail-${twice.date.slice(0, 7)}.json`)).days[twice.date]![twice.key]!;
    const term = detail.terms!.find((t) => t.id === twice.termId)!;
    const body = storyBodyParts(detail).map((p) => p.text).join("\n");
    assert.ok(body.split(term.surface!).length - 1 >= 2, "표기가 본문에 두 번 이상 나온다");
    const placement = placeTerms(storyBodyParts(detail), detail.terms!);
    assert.equal(Object.values(placement.segments).flat().filter((s) => s.termId === term.id).length, 1);
    assert.ok(detail.terms!.some((t) => t.id === noSurface && t.surface === undefined));
    const issue = Object.values(readJson<IssueChunk>(data("issue-0.json")).issues).find((i: IssueDetail) => i.entities?.length);
    assert.ok(issue && issue.entities!.length <= 10);
  });

  test("4.6-4 색인에서 대상 영어 별칭·용어 이름·별칭으로 찾고, 걸린 묶음에서 개별 대상·용어를 되찾는다. 지운 대상은 찾지 못한다", async () => {
    const hits = await searchOutput(out, ["Gajja Electronics", "양적긴축", "QT", fx.info.entities.deleted!.name]);
    const entityHits = hits.get("Gajja Electronics")!.map((h) => parseHit(h.url, h.meta)).filter((h) => h?.kind === "entities");
    assert.ok(entityHits.length > 0, JSON.stringify(hits.get("Gajja Electronics")));
    const found = entityHits.flatMap((h) => (h?.kind === "entities" ? matchEntities(readJson<EntityChunk>(data(`entity-${h.chunk}.json`)), queryTerms("Gajja Electronics")) : []));
    assert.ok(found.some((e) => e.name === "가짜전자"), found.map((e) => e.name).join(", "));
    assert.ok(found.every((e) => e.aliases.some((a) => a.startsWith("Gajja Electronics"))), "별칭이 맞는 대상만 되찾는다");
    for (const q of ["양적긴축", "QT"]) {
      const termHits = hits.get(q)!.map((h) => parseHit(h.url, h.meta)).filter((h) => h?.kind === "terms");
      const terms = termHits.flatMap((h) => (h?.kind === "terms" ? matchTerms(readJson<TermGroupFile>(data(`term-group-${h.group}.json`)), queryTerms(q)) : []));
      assert.ok(terms.some((t) => t.name === "양적긴축"), q);
    }
    const gone = hits.get(fx.info.entities.deleted!.name)!.map((h) => parseHit(h.url, h.meta));
    const goneFound = gone.flatMap((h) => (h?.kind === "entities" ? matchEntities(readJson<EntityChunk>(data(`entity-${h.chunk}.json`)), queryTerms(fx.info.entities.deleted!.name)) : []));
    assert.ok(!goneFound.some((e) => e.id === fx.info.entities.deleted!.id));
  });

  test("4.6-2 대상·용어가 많고 뉴스가 아주 많은 대상이 있어도 새 화면이 처음 받는 데이터가 각각 gzip 300KB 이하다", async () => {
    const big = path.join(work, "big");
    const bigOut = path.join(work, "big-out");
    const bfx = writeFixtures(big, { end: "2026-10-31", days: 60, top: 6, short: 8, issues: 600, entities: 3000, terms: 1500, hub: true, contiguous: true });
    await buildSite({ dataDir: big, outDir: bigOut });
    const screens = measureScreens(bigOut);
    assert.equal(screens.length, 6, screens.map((s) => s.name).join(", "));
    const hub = readJson<EntityChunk>(path.join(bigOut, "site-data", "entity-0.json")).entities["1"]!;
    assert.equal(bfx.info.entities.most, 1);
    assert.ok(hub.count >= 2500, `대상 1의 뉴스 ${hub.count}건`);
    const index = readJson<TermIndex>(path.join(bigOut, "site-data", "term-index.json"));
    assert.ok(index.total > 500, `용어 ${index.total}개`);
    for (const s of screens) assert.ok(s.gzip <= FIRST_SCREEN_BUDGET, `${s.name} gzip ${s.gzip}B`);
    assert.ok(screens.find((s) => s.name.startsWith("용어 사전"))!.files.length < index.groups.filter((g) => g.count > 0).length, "용어 사전은 묶음을 모두 받지 않는다");
    assert.ok(measureOutput(bigOut).firstScreen.gzip <= FIRST_SCREEN_BUDGET);
  });
});

describe("4단계 4.6-4 DB에서 만든 검색 색인", () => {
  test("조사가 붙은 이름(가짜전자가)을 조사 없는 검색어로 찾고, 대상 별칭과 용어 이름으로 찾으며, 지운 대상은 찾지 못한다", async () => {
    const { db } = refSiteDb();
    const work = tempDir("tidwyn-site-refs-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    for (const [rel, content] of buildSiteData(db)) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    fs.writeFileSync(path.join(dataDir, "search-records.json"), JSON.stringify(buildSearchRecords(db)));
    db.close();
    await buildSite({ dataDir, outDir: out });
    const data = (name: string) => path.join(out, "site-data", name);
    const hits = await searchOutput(out, ["가짜전자", "Gajja Electronics", "양적완화", DELETED_TEXTS[0]!]);
    const parsed = (q: string) => hits.get(q)!.map((h) => parseHit(h.url, h.meta));
    // 뉴스 본문 "가짜전자가 새 칩을 공개했다."
    const news = parsed("가짜전자").filter((h) => h?.kind === "news");
    assert.ok(news.length > 0, JSON.stringify(hits.get("가짜전자")));
    const day = readJson<MonthList>(data("list-2026-10.json")).days.find((d) => d.date === "2026-10-28")!;
    const stories = matchDayStories(day, readJson<MonthDetail>(data("detail-2026-10.json")).days["2026-10-28"], queryTerms("가짜전자"));
    assert.ok(stories.some((s) => s.key === "세계-1"), stories.map((s) => s.key).join(", "));
    for (const q of ["가짜전자", "Gajja Electronics"]) {
      const found = parsed(q).flatMap((h) => (h?.kind === "entities" ? matchEntities(readJson<EntityChunk>(data(`entity-${h.chunk}.json`)), queryTerms(q)) : []));
      assert.ok(found.some((e) => e.name === "가짜전자"), q);
    }
    const terms = parsed("양적완화").flatMap((h) => (h?.kind === "terms" ? matchTerms(readJson<TermGroupFile>(data(`term-group-${h.group}.json`)), queryTerms("양적완화")) : []));
    assert.ok(terms.some((t) => t.name === "양적완화"));
    const gone = parsed(DELETED_TEXTS[0]!).flatMap((h) => (h?.kind === "entities" ? matchEntities(readJson<EntityChunk>(data(`entity-${h.chunk}.json`)), queryTerms(DELETED_TEXTS[0]!)) : []));
    assert.deepEqual(gone, []);
  });
});
