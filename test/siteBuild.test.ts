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
