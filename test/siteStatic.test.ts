import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { generateFixtures, writeFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { buildRss, buildSitemaps, robotsTxt, xmlEscape } from "../site/feeds.ts";
import { SHARE_IMAGE, esc, metaDescription } from "../site/head.ts";
import { resolveStatic, vercelConfig } from "../site/hosting.ts";
import { AboutView, ReadMarksText } from "../site/src/components/aboutView.ts";
import { briefTitle, latestTitle } from "../site/src/lib/format.ts";
import { CONTACT_MAIL, SITE_URL, mailHref, shortReportHref, storyReportHref } from "../site/src/lib/policy.ts";
import { briefPath } from "../site/src/lib/routes.ts";
import { applyCorrection, checkCorrection } from "../src/corrections.ts";
import { pageFile } from "../src/publicSite.ts";
import { checkBuiltSite, checkPublicPages } from "../src/siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { loadBrief } from "../src/store.ts";
import { openDb } from "../src/db.ts";
import type { DayList, IndicatorList, IssueChunk, IssueDetail, MonthDetail, MonthList, SiteDates } from "../src/siteTypes.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import { REF_DATES, refSiteDb } from "./refsFixture.ts";

// 페이지별 정적 HTML과 수집기용 파일(9.5단계 4.1~4.5, 4.7-5, 4.8-1). 지어낸 데이터만 쓴다.

after(cleanupTemp);

const FAKE_REASON = "금리 인상 폭을 0.5%포인트에서 0.25%포인트로 바로잡았다.";

function html(out: string, rel: string): string {
  return fs.readFileSync(path.join(out, rel), "utf8");
}
const titleOf = (page: string) => page.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const metaOf = (page: string, key: string) => page.match(new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`))?.[1] ?? null;
const canonicalOf = (page: string) => page.match(/<link rel="canonical" href="([^"]*)"/)?.[1] ?? null;
const hrefsOf = (page: string) => [...page.matchAll(/<a [^>]*href="([^"]*)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
const jsonLdOf = (page: string) => [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]!) as Record<string, unknown>);
const unescape = (s: string) => s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&#x27;", "'");

/** 태그 짝과 이스케이프만 보는 작은 XML 검사(의존성을 늘리지 않는다) */
function assertWellFormed(xml: string): void {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  assert.doesNotMatch(body.replace(/<[^>]*>/g, ""), /&(?!amp;|lt;|gt;|quot;|apos;)|</, "이스케이프되지 않은 글자");
  const stack: string[] = [];
  for (const m of body.matchAll(/<(\/?)([\w:.-]+)[^>]*?(\/?)>/g)) {
    if (m[3]) continue;
    if (m[1]) assert.equal(stack.pop(), m[2], `닫는 태그 ${m[2]}`);
    else stack.push(m[2]!);
  }
  assert.deepEqual(stack, []);
}
const locsOf = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!);

interface Built {
  out: string;
  dataDir: string;
  fx: Fixture;
  days: Map<string, DayList>;
  details: Map<string, MonthDetail["days"][string]>;
  dates: SiteDates;
  issues: IssueDetail[];
  indexed: string[];
}

async function build(opts: Parameters<typeof writeFixtures>[1], edit?: (dataDir: string) => void): Promise<Built> {
  const work = tempDir("tidwyn-static-");
  const dataDir = path.join(work, "data");
  const out = path.join(work, "out");
  const fx = writeFixtures(dataDir, opts);
  edit?.(dataDir);
  await buildSite({ dataDir, outDir: out });
  const data = path.join(out, "site-data");
  const read = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(data, name), "utf8")) as T;
  const days = new Map<string, DayList>();
  const details = new Map<string, MonthDetail["days"][string]>();
  for (const name of fs.readdirSync(data)) {
    if (/^list-\d{4}-\d{2}\.json$/.test(name)) for (const d of read<MonthList>(name).days) days.set(d.date, d);
    if (/^detail-\d{4}-\d{2}\.json$/.test(name)) for (const [d, stories] of Object.entries(read<MonthDetail>(name).days)) details.set(d, stories);
  }
  const issues = fs.readdirSync(data).filter((n) => /^issue-\d+\.json$/.test(n)).flatMap((n) => Object.values(read<IssueChunk>(n).issues));
  const dates = read<SiteDates>("dates.json");
  const indexed = locsOf(html(out, "sitemap.xml")).map((u) => u.slice(SITE_URL.length));
  return { out, dataDir, fx, days, details, dates, issues, indexed };
}

describe("정적 HTML", () => {
  let b: Built;
  before(async () => {
    b = await build({ days: 6, entities: 12, terms: 8, schedules: 24, indicators: 1, indicatorsAll: true, videos: true, corrections: true });
  });
  const allHtml = () => listFilesRecursive(b.out).filter((f) => f.endsWith(".html"));

  test("4.1-1 색인 페이지마다 파일이 있다", () => {
    const expected = ["/", ...b.dates.dates.map((d) => `/${d}`), "/dates", "/issues", "/entities", "/terms", "/schedules", "/indicators", "/about", "/privacy"];
    for (const p of expected) assert.ok(b.indexed.includes(p), p);
    assert.ok(b.indexed.some((p) => /^\/issues\/\d+$/.test(p)) && b.indexed.some((p) => /^\/entities\/\d+$/.test(p)) && b.indexed.some((p) => /^\/indicators\/[a-z0-9-]+$/.test(p)));
    for (const p of b.indexed) assert.ok(fs.existsSync(path.join(b.out, pageFile(p))), p);
  });

  test("4.1-2 브리프: 섹션, 뉴스 글, 출처, 이슈 링크, 앵커, 정정 표시", () => {
    const date = b.dates.latestDate!;
    const page = html(b.out, `${date}.html`);
    const day = b.days.get(date)!;
    const stories = day.sections.flatMap((s) => s.stories);
    assert.match(page, /<h1[^>]*>/);
    for (const sec of day.sections) assert.ok(page.includes(`>${sec.name}</h2>`), sec.name);
    for (const s of stories) assert.ok(page.includes(`id="${s.key}"`), s.key);
    const top = stories.find((s) => s.kind === "top" && s.issue)!;
    const detail = b.details.get(date)![top.key]!;
    const body = unescape(page);
    for (const text of [top.title, detail.summary, detail.whyItMatters, detail.background, detail.keyFacts[0]!, detail.sources[0]!.name]) assert.ok(body.includes(text), text);
    assert.ok(hrefsOf(page).includes(detail.sources[0]!.url), "원문 링크");
    assert.ok(hrefsOf(page).includes(`/issues/${top.issue!.id}`), "이슈 링크");
    const fixed = stories.find((s) => s.corrections?.length === 2)!;
    assert.ok(body.includes(`정정됨 · ${Number(fixed.corrections![0]!.on.slice(5, 7))}월 ${Number(fixed.corrections![0]!.on.slice(8))}일`));
    for (const c of fixed.corrections!) assert.ok(body.includes(c.reason), "바뀐 내용");
    const short = stories.find((s) => s.kind === "short" && s.corrections)!;
    assert.ok(body.includes(short.corrections![0]!.reason), "짧은 소식의 사유");
    assert.equal(html(b.out, "index.html").match(/<main[\s\S]*<\/main>/)?.[0], page.match(/<main[\s\S]*<\/main>/)?.[0], "/는 최신 브리프와 본문이 같다");
  });

  test("4.1-2 이슈·대상·지표·목록 페이지", () => {
    const issue = b.issues.find((i) => i.timeline.length > 0 && i.related.length > 0)!;
    const ip = unescape(html(b.out, `issues/${issue.id}.html`));
    for (const text of [issue.name, issue.status, issue.timeline[0]!.title, issue.related[0]!.name]) assert.ok(ip.includes(text), text);
    assert.ok(hrefsOf(ip).includes(briefPath(issue.timeline[0]!.date, issue.timeline[0]!.key)), "뉴스 링크");
    assert.ok(unescape(html(b.out, "issues.html")).includes(issue.name));
    assert.ok(hrefsOf(html(b.out, "issues.html")).includes(`/issues/${issue.id}`));

    const terms = html(b.out, "terms.html");
    assert.doesNotMatch(terms, /아직 용어가 없다/);
    assert.match(terms, /<dt>[^<]+<\/dt><dd>[^<]+/, "용어 설명까지 담는다");
    assert.match(html(b.out, "schedules.html"), /class="ev"/);
    assert.match(html(b.out, "dates.html"), new RegExp(`href="/${b.dates.latestDate}"`));
    const entity = html(b.out, `entities/1.html`);
    assert.match(entity, /<h1/);
    assert.match(entity, /href="\/\d{4}-\d{2}-\d{2}#/, "뉴스 링크");
  });

  test("4.1-2 R12: 코스피·코스닥 값은 어떤 HTML에도 없고, 다른 지표는 값과 출처가 있다", () => {
    const list = JSON.parse(html(b.out, "site-data/indicator-list.json")) as IndicatorList;
    const hidden = list.indicators.filter((c) => c.id === "kospi" || c.id === "kosdaq");
    assert.equal(hidden.length, 2);
    for (const card of hidden) {
      assert.ok(card.last);
      const page = html(b.out, `indicators/${card.id}.html`);
      assert.ok(page.includes(card.name));
      const number = card.last.value.toLocaleString("ko-KR");
      for (const f of allHtml()) assert.ok(!html(b.out, f).includes(`<b class="ind-v">${number}`), `${f}: ${card.id}`);
      assert.doesNotMatch(page.match(/<main[\s\S]*<\/main>/)![0], new RegExp(card.last.date), "날짜도 뺀다");
    }
    const shown = list.indicators.find((c) => c.id !== "kospi" && c.id !== "kosdaq" && c.last)!;
    const page = html(b.out, `indicators/${shown.id}.html`);
    assert.match(page, /class="ind-v"/);
    assert.ok(unescape(page).includes(shown.credit));
    assert.match(html(b.out, "indicators.html"), /FRED/);
  });

  test("4.1-2 R7: 영상 제목, 썸네일, 기사 이미지 주소가 어떤 HTML에도 없다", () => {
    const videos = [...b.days.values()].flatMap((d) => d.videos ?? []);
    assert.ok(videos.length > 0, "지어낸 영상이 있어야 한다");
    const images = [...b.details.values()].flatMap((stories) => Object.values(stories)).flatMap((s) => s.sources.flatMap((x) => x.imageUrl ?? []));
    for (const f of allHtml()) {
      const page = unescape(html(b.out, f));
      for (const v of videos) {
        assert.ok(!page.includes(v.title), `${f}: 영상 제목`);
        assert.ok(!page.includes(v.thumb), `${f}: 썸네일`);
      }
      for (const url of images) assert.ok(!page.includes(url), `${f}: 기사 이미지`);
      assert.doesNotMatch(page, /<img\b/, f);
    }
  });

  test("4.1-2 소개 문구는 화면과 같은 뷰로 만든다", () => {
    const Link = (({ to, children, ...rest }: { to: string; children?: ReactNode }) => h("a", { href: to, ...rest }, children)) as never;
    const view = renderToStaticMarkup(h(AboutView, { Link, readMarks: h(ReadMarksText) }));
    assert.ok(html(b.out, "about.html").includes(view));
    assert.match(fs.readFileSync(path.join(import.meta.dirname, "..", "site", "src", "pages", "AboutPage.tsx"), "utf8"), /<AboutView Link=\{Link\}/);
  });

  test("4.1-3 머리글과 바닥글 링크만 따라가 모든 색인 페이지에 닿는다", () => {
    const seen = new Set(["/"]);
    const queue = ["/"];
    while (queue.length > 0) {
      for (const href of hrefsOf(html(b.out, pageFile(queue.shift()!)))) {
        const target = href.split(/[?#]/)[0]!;
        if (!target.startsWith("/") || seen.has(target) || !fs.existsSync(path.join(b.out, pageFile(target)))) continue;
        seen.add(target);
        queue.push(target);
      }
    }
    for (const p of b.indexed) assert.ok(seen.has(p), p);
  });

  test("정적 브리프에 뉴스마다 제보 링크, 짧은 소식 끝 제보 링크, 구역 이동 링크가 있다", () => {
    const date = b.dates.latestDate!;
    const page = html(b.out, pageFile(`/${date}`));
    const reports = hrefsOf(page).filter((href) => href.startsWith("mailto:"));
    assert.ok(reports.length >= 2, "제보 링크 수");
    assert.ok(reports.every((href) => href.includes(encodeURIComponent(date.slice(5, 7).replace(/^0/, "")))), "제보 메일에 날짜가 들어간다");
    const jumps = hrefsOf(page).filter((href) => href.startsWith("#section-"));
    assert.ok(jumps.length > 0, "구역 이동 링크");
    for (const href of jumps) assert.match(page, new RegExp(`<h2[^>]* id="${href.slice(1)}"`));
  });

  test("정적 페이지에는 쓸 수 없는 검색 입구가 없고, 없는 페이지는 날짜 목록으로 안내한다", () => {
    for (const p of b.indexed) assert.ok(!hrefsOf(html(b.out, pageFile(p))).some((href) => href.startsWith("/search")), p);
    const page = html(b.out, "404.html");
    assert.ok(!hrefsOf(page).some((href) => href.startsWith("/search")));
    assert.match(page, /지난 뉴스는 날짜 목록에서 찾을 수 있다/);
  });

  test("앱 틀에도 정적 안내가 있어 앱을 못 받아도 빈 화면이 아니고, 쓸 수 없는 검색 대신 갈 곳을 보여 준다", () => {
    const page = html(b.out, "app.html");
    assert.match(page, /<div id="root"><div class="static-page">/);
    assert.match(page, /<h1 class="page-title">이 화면을 열지 못했다<\/h1>/);
    const hrefs = hrefsOf(page);
    for (const href of ["/", "/dates", "/issues"]) assert.ok(hrefs.includes(href), href);
    assert.ok(!hrefs.some((href) => href.startsWith("/search")));
  });

  test("4.1-5 어느 페이지에도 noscript 안내가 남지 않는다. 앱을 못 받으면 숨김이 풀린다", () => {
    for (const f of [...b.indexed.map(pageFile), "app.html", "404.html"]) assert.doesNotMatch(html(b.out, f), /<noscript/, f);
    const page = html(b.out, "index.html");
    assert.match(page, /html\.app #root>\.static-page\{display:none\}/);
    assert.match(page, /addEventListener\("error",function\(\)\{document\.documentElement\.classList\.remove\("app"\)\},true\)/);
  });

  test("4.2-1 제목이 겹치지 않고 앱과 같은 함수로 만들며, 설명은 상한 안이다", () => {
    const titles = b.indexed.map((p) => titleOf(html(b.out, pageFile(p))));
    assert.equal(new Set(titles).size, titles.length, "제목이 겹친다");
    assert.equal(titles[b.indexed.indexOf("/")], latestTitle());
    for (const d of b.dates.dates) assert.equal(titleOf(html(b.out, `${d}.html`)), briefTitle(d, b.dates.dates));
    assert.match(titleOf(html(b.out, `${b.dates.latestDate}.html`)), /^Tidwyn · \d+월 \d+일 브리프$/);
    for (const p of b.indexed) {
      const d = metaOf(html(b.out, pageFile(p)), "description");
      assert.ok(d && d.length <= 160, p);
      assert.doesNotMatch(unescape(d), /[\n\r]|<[a-z]/i, p);
    }
  });

  test("4.2-1 같은 월·일이 둘이면 연도를 넣는다", () => {
    const dates = ["2026-10-30", "2027-10-30", "2027-10-31"];
    assert.equal(briefTitle("2027-10-30", dates), "Tidwyn · 2027년 10월 30일 브리프");
    assert.equal(briefTitle("2026-10-30", dates), "Tidwyn · 2026년 10월 30일 브리프");
    assert.equal(briefTitle("2027-10-31", dates), "Tidwyn · 10월 31일 브리프");
  });

  test("4.2-1 설명은 태그와 줄바꿈을 없애고 상한으로 자른다", () => {
    assert.equal(metaDescription("가나<b>다</b>\n라"), "가나 다 라");
    const long = metaDescription("가".repeat(500));
    assert.ok(long.length <= 160 && long.endsWith("…"));
    assert.ok(metaDescription("").length > 0);
  });

  test("4.2-2 canonical은 공개 주소 절대 주소이고 쿼리가 없다. 앱 틀과 없는 페이지는 noindex다", () => {
    for (const p of b.indexed) {
      const page = html(b.out, pageFile(p));
      assert.equal(canonicalOf(page), `${SITE_URL}${p}`, p);
      assert.doesNotMatch(page, /name="robots"/, p);
    }
    for (const f of ["app.html", "404.html"]) {
      assert.match(html(b.out, f), /<meta name="robots" content="noindex"/, f);
      assert.equal(canonicalOf(html(b.out, f)), null, f);
    }
  });

  test("4.2-3 OG와 Twitter", () => {
    for (const p of b.indexed) {
      const page = html(b.out, pageFile(p));
      assert.equal(metaOf(page, "og:url"), `${SITE_URL}${p}`);
      assert.equal(metaOf(page, "og:title"), titleOf(page));
      assert.equal(metaOf(page, "og:description"), metaOf(page, "description"));
      assert.equal(metaOf(page, "og:image"), `${SITE_URL}${SHARE_IMAGE.path}`);
      assert.equal(metaOf(page, "og:image:width"), "1200");
      assert.equal(metaOf(page, "og:image:height"), "630");
      assert.ok(metaOf(page, "og:image:alt"));
      assert.ok(["website", "article"].includes(metaOf(page, "og:type")!));
      assert.equal(metaOf(page, "og:site_name"), "Tidwyn");
      assert.equal(metaOf(page, "og:locale"), "ko_KR");
      assert.equal(metaOf(page, "twitter:card"), "summary_large_image");
    }
  });

  test("4.2-4 구조화 데이터: 유형, 작성자 조직, ISO 8601, 정정일이 dateModified", () => {
    assert.equal(jsonLdOf(html(b.out, "index.html"))[0]!["@type"], "WebSite");
    const date = b.dates.latestDate!;
    const article = jsonLdOf(html(b.out, `${date}.html`))[0]!;
    assert.equal(article["@type"], "Article");
    assert.deepEqual((article.author as { "@type": string })["@type"], "Organization");
    assert.equal((article.author as { name: string }).name, "Tidwyn");
    assert.ok(article.headline);
    assert.equal(article.datePublished, `${date}T00:00:00+09:00`);
    const fixedOn = b.days.get(date)!.sections.flatMap((s) => s.stories).flatMap((s) => s.corrections ?? []).map((c) => c.on).sort().at(-1);
    assert.equal(article.dateModified, `${fixedOn}T00:00:00+09:00`);
    const other = jsonLdOf(html(b.out, `${b.dates.dates.at(-1)}.html`))[0]!;
    assert.equal(other.dateModified, other.datePublished);
    assert.equal(jsonLdOf(html(b.out, `issues/${b.issues[0]!.id}.html`))[0]!["@type"], "Article");
    assert.equal(jsonLdOf(html(b.out, "issues.html"))[0]!["@type"], "CollectionPage");
    assert.equal(jsonLdOf(html(b.out, "about.html"))[0]!["@type"], "AboutPage");
    for (const p of b.indexed) {
      const lds = jsonLdOf(html(b.out, pageFile(p)));
      assert.ok(lds.length > 0, p);
      for (const ld of lds) assert.ok(ld["@context"] && ld["@type"] && ld.name !== null, p);
    }
  });

  test("4.2-5 lang, theme-color, RSS 링크", () => {
    for (const p of b.indexed) {
      const page = html(b.out, pageFile(p));
      assert.match(page, /<html lang="ko"/, p);
      assert.match(page, /<meta name="theme-color"/, p);
      assert.match(page, /<link rel="alternate" type="application\/rss\+xml"[^>]*href="\/rss\.xml"/, p);
    }
  });

  test("4.3-1 robots.txt", () => {
    const txt = html(b.out, "robots.txt");
    assert.equal(txt, robotsTxt());
    assert.match(txt, /^User-agent: \*$/m);
    assert.match(txt, /^Disallow: \/search$/m);
    assert.match(txt, new RegExp(`^Sitemap: ${SITE_URL}/sitemap\\.xml$`, "m"));
    assert.equal([...txt.matchAll(/^Disallow:/gm)].length, 1, "assets, site-data, pagefind를 막지 않는다");
    assert.ok(robotsTxt(["#DaumWebMasterTool:abc"]).includes("#DaumWebMasterTool:abc"));
  });

  test("4.3-2 사이트맵: 파일 집합과 같고, lastmod는 정정 포함 내용 날짜이며, 흡수·지운 항목이 없다", () => {
    const xml = html(b.out, "sitemap.xml");
    assertWellFormed(xml);
    assert.equal(new Set(b.indexed).size, b.indexed.length);
    const pages = listFilesRecursive(b.out).filter((f) => f.endsWith(".html") && f !== "404.html" && f !== "app.html").filter((f) => !/^(issues|entities)\/(\d+)\.html$/.test(f) || canonicalOf(html(b.out, f)) === `${SITE_URL}/${f.slice(0, -5)}`);
    assert.deepEqual(new Set(pages), new Set(b.indexed.map(pageFile)));
    assert.ok(!b.indexed.includes(`/issues/${b.fx.info.merged!.id}`));
    assert.ok(!b.indexed.includes(`/entities/${b.fx.info.entities.merged!.id}`));
    assert.ok(!b.indexed.includes(`/entities/${b.fx.info.entities.deleted!.id}`));
    assert.ok(!b.indexed.some((p) => p === "/search" || p.startsWith("/terms/") || p.startsWith("/schedules/")));
    const date = b.dates.latestDate!;
    const fixedOn = b.days.get(date)!.sections.flatMap((s) => s.stories).flatMap((s) => s.corrections ?? []).map((c) => c.on).sort().at(-1);
    assert.ok(xml.includes(`<loc>${SITE_URL}/${date}</loc><lastmod>${fixedOn}</lastmod>`));
    const older = b.dates.dates.at(-1)!;
    assert.ok(xml.includes(`<loc>${SITE_URL}/${older}</loc><lastmod>${older}</lastmod>`));
  });

  test("4.3-3 없는 페이지는 정적 HTML만으로 읽힌다. 비공개 지표와 없는 번호는 파일이 없어 404다", () => {
    const page = html(b.out, "404.html");
    assert.match(page, /<h1[^>]*>이 주소에는 페이지가 없다<\/h1>/);
    assert.match(titleOf(page), /없는 페이지/);
    const exists = (p: string) => fs.existsSync(path.join(b.out, p));
    for (const p of ["/nope", "/2026-02-30", "/1999-01-01", "/issues/99999", "/entities/99999", "/indicators/none"]) assert.deepEqual(resolveStatic(p, exists), { kind: "notFound", path: "404.html" }, p);
    assert.deepEqual(resolveStatic(`/entities/${b.fx.info.entities.deleted!.id}`, exists), { kind: "notFound", path: "404.html" }, "지운 대상");
    assert.deepEqual(resolveStatic(`/${b.dates.latestDate}/`, exists), { kind: "file", path: `${b.dates.latestDate}.html` }, "끝의 /");
  });

  test("4.3-4 흡수된 주소는 200이고 canonical이 남는 주소다", () => {
    const m = b.fx.info.merged!;
    const e = b.fx.info.entities.merged!;
    for (const [rel, to] of [[`issues/${m.id}.html`, `/issues/${m.into}`], [`entities/${e.id}.html`, `/entities/${e.into}`]] as const) {
      assert.equal(canonicalOf(html(b.out, rel)), `${SITE_URL}${to}`);
      assert.ok(hrefsOf(html(b.out, rel)).includes(to));
    }
  });

  test("4.4-1 아이콘과 공유 이미지: 치수, 크기, 링크", () => {
    const png = (rel: string) => {
      const buf = fs.readFileSync(path.join(b.out, rel));
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
    };
    for (const [rel, size] of [["icon-16.png", 16], ["icon-32.png", 32], ["icon-48.png", 48], ["apple-touch-icon.png", 180], ["icon-512.png", 512]] as const) {
      assert.equal(png(rel).width, size, rel);
      assert.equal(png(rel).height, size, rel);
    }
    const share = png("share.png");
    assert.deepEqual([share.width, share.height], [1200, 630]);
    assert.ok(share.bytes <= 300 * 1024);
    assert.match(html(b.out, "icon.svg"), /<svg/);
    for (const f of allHtml()) {
      const page = html(b.out, f);
      assert.ok(!page.includes("data:,"), f);
      for (const href of ["/icon.svg", "/icon-16.png", "/icon-32.png", "/icon-48.png", "/apple-touch-icon.png"]) assert.ok(page.includes(`href="${href}"`), `${f} ${href}`);
    }
  });

  test("4.5-1 RSS: 소개의 링크, 최신순, 주요 뉴스 제목, 본문 글 없음", () => {
    const xml = html(b.out, "rss.xml");
    assertWellFormed(xml);
    assert.ok(hrefsOf(html(b.out, "about.html")).includes("/rss.xml"));
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]*)<\/link>/g)].map((m) => m[1]);
    assert.deepEqual(links, b.dates.dates.map((d) => `${SITE_URL}/${d}`));
    const date = b.dates.latestDate!;
    const stories = b.days.get(date)!.sections.flatMap((s) => s.stories);
    const decoded = unescape(xml.replaceAll("&apos;", "'"));
    for (const s of stories.filter((x) => x.kind === "top")) assert.ok(decoded.includes(s.title), s.title);
    assert.ok(!decoded.includes(b.details.get(date)![stories[0]!.key]!.summary), "본문 글이 없다");
    assert.equal(new Set([...xml.matchAll(/<guid[^>]*>([^<]*)<\/guid>/g)].map((m) => m[1])).size, b.dates.dates.length);
    assert.equal([...xml.matchAll(/<pubDate>/g)].length, b.dates.dates.length);
  });

  test("4.6-1 메일 안내가 있고 GitHub 이슈 주소가 어디에도 없다", () => {
    const about = html(b.out, "about.html");
    assert.match(about, /<section id="corrections">/);
    assert.ok(about.includes(mailHref()) && about.includes(CONTACT_MAIL));
    assert.ok(about.includes("github.com/mivomad33/tidwyn"), "원본 저장소 링크는 남는다");
    assert.ok(hrefsOf(html(b.out, "index.html")).includes("/about#corrections"), "바닥글에서 그 절로 간다");
    for (const f of allHtml()) assert.ok(!html(b.out, f).includes("github.com/mivomad33/tidwyn/issues"), f);
    for (const p of b.indexed) assert.ok(hrefsOf(html(b.out, pageFile(p))).some((x) => x.includes("/about#corrections")), p);
  });

  test("4.8-1 지어낸 결과물은 공개 페이지 검사를 통과한다", () => {
    assert.deepEqual(checkPublicPages(b.out), []);
    assert.deepEqual(checkBuiltSite(b.out, null).findings, []);
  });
});

describe("4.2 이스케이프", () => {
  test("글에 </script>와 따옴표가 있어도 HTML과 구조화 데이터, 사이트맵, RSS가 깨지지 않는다", async () => {
    const nasty = `가짜 </script><b>"이슈" & 'A'`;
    const b = await build({ days: 3 }, (dataDir) => {
      for (const name of fs.readdirSync(path.join(dataDir, "site-data"))) {
        if (!/^(issue-|list-|issue-list)/.test(name)) continue;
        const file = path.join(dataDir, "site-data", name);
        const raw = fs.readFileSync(file, "utf8");
        fs.writeFileSync(file, raw.replace(/"name":"[^"]*이슈[^"]*"|"headline":"[^"]*"/g, (m) => `"${m.slice(1, m.indexOf('"', 1))}":${JSON.stringify(nasty)}`).replace(/"title":"[^"]*"/, `"title":${JSON.stringify(nasty)}`));
      }
    });
    const date = b.dates.latestDate!;
    const page = html(b.out, `${date}.html`);
    const body = page.replace(/<script[\s\S]*?<\/script>/g, "");
    assert.ok(!/<b>"이슈"/.test(page), "태그로 나오지 않는다");
    assert.ok(!body.includes("</script>"), "닫는 태그가 글에서 나오지 않는다");
    assert.equal(metaOf(page, "description"), esc(metaDescription(nasty)));
    const lds = jsonLdOf(page);
    assert.equal(lds[0]!.description, metaDescription(nasty));
    assertWellFormed(html(b.out, "rss.xml"));
    assertWellFormed(html(b.out, "sitemap.xml"));
    assert.deepEqual(checkPublicPages(b.out), []);
  });
});

describe("4.1-1 빈 데이터", () => {
  test("데이터가 없는 DB로도 빌드가 통과하고 빈 목록 상태와 RSS가 유효하다", async () => {
    const dir = tempDir();
    const db = openDb(path.join(dir, "tidwyn.db"));
    const dataDir = path.join(dir, "input");
    for (const [rel, content] of buildSiteData(db)) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    fs.writeFileSync(path.join(dataDir, "search-records.json"), "[]");
    db.close();
    const out = path.join(dir, "out");
    await buildSite({ dataDir, outDir: out });
    assert.match(html(out, "index.html"), /아직 저장된 브리프가 없다/);
    assert.match(html(out, "issues.html"), /아직 이슈가 없다/);
    assert.match(html(out, "entities.html"), /아직 인물·기관·국가가 없다/);
    assert.match(html(out, "terms.html"), /아직 용어가 없다/);
    assert.match(html(out, "schedules.html"), /아직 일정이 없다/);
    const rss = html(out, "rss.xml");
    assertWellFormed(rss);
    assert.doesNotMatch(rss, /<item>/);
    assert.match(rss, /<channel>/);
    assert.deepEqual(checkPublicPages(out), []);
  });
});

describe("4.3-2·4.5-1 큰 입력", () => {
  test("주소가 5만 개를 넘으면 사이트맵을 나눈다", () => {
    const entries = Array.from({ length: 50_001 }, (_, i) => ({ path: `/issues/${i}`, lastmod: "2026-10-27" }));
    const files = buildSitemaps(entries);
    assert.deepEqual([...files.keys()].sort(), ["sitemap-1.xml", "sitemap-2.xml", "sitemap.xml"]);
    assert.match(files.get("sitemap.xml")!, /<sitemapindex/);
    assert.deepEqual(locsOf(files.get("sitemap.xml")!), [`${SITE_URL}/sitemap-1.xml`, `${SITE_URL}/sitemap-2.xml`]);
    assert.equal(locsOf(files.get("sitemap-1.xml")!).length, 50_000);
    assert.equal(locsOf(files.get("sitemap-2.xml")!).length, 1);
    assertWellFormed(files.get("sitemap-2.xml")!);
    assert.equal(buildSitemaps(entries.slice(0, 3)).size, 1);
  });
  test("크기 한도를 넘어도 나눈다", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ path: `/issues/${i}`, lastmod: null }));
    assert.ok(buildSitemaps(entries, 50_000, 400).size > 2);
  });
  test("날짜가 30개보다 많아도 30개만, 최신순으로 나오고 제목을 이스케이프한다", () => {
    const days = Array.from({ length: 35 }, (_, i) => ({ date: new Date(Date.parse("2026-10-27") - i * 86400000).toISOString().slice(0, 10), titles: [`제목 ${i} <A&B>`] }));
    const xml = buildRss(days);
    assertWellFormed(xml);
    const links = [...xml.matchAll(/<item>[\s\S]*?<link>([^<]*)<\/link>/g)];
    assert.equal(links.length, 30);
    assert.equal(links[0]![1], `${SITE_URL}/2026-10-27`);
    assert.equal(links[29]![1], `${SITE_URL}/${days[29]!.date}`);
    assert.ok(xml.includes(xmlEscape(xmlEscape("<A&B>"))), "HTML로 한 번, XML로 한 번");
    assert.equal(xml.includes("<A&B>"), false);
  });
});

describe("4.6-1 제보 메일 링크", () => {
  const decode = (href: string) => {
    const url = new URL(href);
    assert.equal(url.protocol, "mailto:");
    assert.equal(url.pathname, CONTACT_MAIL);
    return { subject: url.searchParams.get("subject")!, body: decodeURIComponent(href.split("body=")[1]!) };
  };
  test("펼친 카드: 날짜, 뉴스 제목, 뉴스 주소가 채워진다", () => {
    const m = decode(storyReportHref("10월 27일", "가짜 & 제목?", `${SITE_URL}/2026-10-27#한국-1`));
    assert.ok(decodeURIComponent(storyReportHref("10월 27일", "가짜 & 제목?", "u").split("subject=")[1]!.split("&")[0]!).includes("가짜 & 제목?"));
    for (const text of ["10월 27일", "가짜 & 제목?", `${SITE_URL}/2026-10-27#한국-1`]) assert.ok(m.body.includes(text), text);
  });
  test("짧은 소식: 날짜와 브리프 주소가 채워진다", () => {
    const m = decode(shortReportHref("10월 27일", `${SITE_URL}/2026-10-27`));
    for (const text of ["10월 27일", `${SITE_URL}/2026-10-27`]) assert.ok(m.body.includes(text), text);
  });
});

describe("4.3-5 호스팅 규칙과 serve의 일치", () => {
  test("rewrites의 앱 전용 주소는 resolveStatic과 같은 모양이다", () => {
    const cfg = vercelConfig() as { rewrites: { source: string }[] };
    const exists = (p: string) => p === "app.html";
    assert.deepEqual(resolveStatic("/terms/12", exists), { kind: "file", path: "app.html" });
    assert.ok(cfg.rewrites.some((r) => r.source === "/terms/:id(\\d+)"));
    assert.deepEqual(resolveStatic("/terms/abc", exists), { kind: "notFound", path: "404.html" });
  });
});

describe("4.8-1 결과물 검사", () => {
  async function fresh(): Promise<string> {
    const work = tempDir("tidwyn-check-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    writeFixtures(dataDir, { days: 2 });
    await buildSite({ dataDir, outDir: out });
    return out;
  }
  const kinds = (out: string) => checkPublicPages(out).map((f) => `${f.where} ${f.kind}`);
  const edit = (out: string, rel: string, change: (s: string) => string) => {
    const before = html(out, rel);
    const after = change(before);
    assert.notEqual(after, before, "일부러 깨뜨린 내용이 반영되어야 한다");
    fs.writeFileSync(path.join(out, rel), after);
    return () => fs.writeFileSync(path.join(out, rel), before);
  };

  test("일부러 깨뜨린 결과물마다 실패한다", async () => {
    const out = await fresh();
    const dated = locsOf(html(out, "sitemap.xml"))[1]!.slice(SITE_URL.length + 1);
    assert.deepEqual(kinds(out), []);
    const cases: [string, (s: string) => string, string][] = [
      ["about.html", (s) => s.replace(/<title>[^<]*<\/title>/, "<title></title>"), "about.html 제목 없음"],
      ["about.html", (s) => s.replace(/<meta name="description"[^>]*>/, ""), "about.html 설명 없음"],
      ["about.html", (s) => s.replace(/<link rel="canonical"[^>]*>/, ""), "about.html canonical이 주소와 다름"],
      ["about.html", (s) => s.replace("<title>", '<meta name="robots" content="noindex" /><title>'), "about.html 색인 페이지에 noindex"],
      ["robots.txt", (s) => s.replace("Disallow: /search", "Disallow: /"), "robots.txt robots.txt가 수집을 막음"],
      ["robots.txt", (s) => s.replace(/Sitemap:.*\n/, ""), "robots.txt robots.txt에 사이트맵 줄 없음"],
      ["sitemap.xml", (s) => s.replace(`${SITE_URL}/about`, `${SITE_URL}/about-x`), "sitemap.xml 사이트맵 주소에 파일이 없음"],
      ["sitemap.xml", (s) => s.replace(`<loc>${SITE_URL}/</loc>`, "<loc>https://example.com/</loc>"), "sitemap.xml 사이트맵 주소에 파일이 없음"],
      [`${dated}.html`, (s) => s.replace("</main>", `<p>{"thumb":"x"}</p></main>`), `${dated}.html HTML에 영상 데이터`],
      [`${dated}.html`, (s) => s.replace("</main>", "<p>videos.json</p></main>"), `${dated}.html HTML에 영상 데이터`],
      [`${dated}.html`, (s) => s.replace("</main>", "<p>https://i.ytimg.com/a.jpg</p></main>"), `${dated}.html HTML에 영상 데이터`],
    ];
    for (const [rel, change, expected] of cases) {
      const restore = edit(out, rel, change);
      assert.ok(kinds(out).includes(expected), `${expected}: ${kinds(out).join(", ")}`);
      restore();
    }
    assert.deepEqual(kinds(out), []);

    // 같은 파일로 풀리는 주소는 앞에 있어도 canonical을 본다
    const restoreDup = edit(out, "sitemap.xml", (s) => s.replace("<url>", `<url><loc>${SITE_URL}/index</loc></url>\n<url>`));
    assert.ok(kinds(out).includes("index.html canonical이 주소와 다름"));
    restoreDup();

    // 뉴스 출처가 YouTube인 것은 영상 데이터가 아니다
    const restoreSource = edit(out, `${dated}.html`, (s) => s.replace("</main>", '<div class="src"><a href="https://www.youtube.com/watch?v=abc">출처</a></div></main>'));
    assert.deepEqual(kinds(out), []);
    restoreSource();

    fs.writeFileSync(path.join(out, "stray.html"), "<!doctype html><title>x</title>");
    assert.deepEqual(kinds(out), ["stray.html 사이트맵 밖 페이지에 noindex나 canonical이 없음"]);
    fs.rmSync(path.join(out, "stray.html"));
    for (const [rel, kind] of [["robots.txt", "robots.txt robots.txt 없음"], ["sitemap.xml", "sitemap.xml 사이트맵 없음"]] as const) {
      const keep = html(out, rel);
      fs.rmSync(path.join(out, rel));
      assert.ok(kinds(out).includes(kind));
      fs.writeFileSync(path.join(out, rel), keep);
    }
    const restore = edit(out, "robots.txt", (s) => `${s}#DaumWebMasterTool:abcdef:gaga\n`);
    assert.deepEqual(kinds(out), [], "다음 소유 확인 주석 줄은 걸리지 않는다");
    restore();
  });

  test("4.6-3 공개 메일이 든 결과물은 통과하고 다른 주소는 실패하며, HTML도 기존 검사를 받는다", async () => {
    const out = await fresh();
    assert.deepEqual(checkBuiltSite(out, null).findings, []);
    const restore = edit(out, "about.html", (s) => s.replace("</main>", `<p>${["someone", "naver.com"].join("@")}</p></main>`));
    assert.deepEqual(checkBuiltSite(out, null).findings.map((f) => `${f.where} ${f.kind}`), ["about.html 허용 목록 밖 메일 주소"]);
    restore();
  });
});

describe("4.7-5 정정의 파생 반영", () => {
  test("정정한 뉴스의 새 글이 화면 데이터, HTML, 마크다운, 검색, RSS, 구조화 데이터, 사이트맵에 나오고 옛 글이 없다", async () => {
    const { db, dir } = refSiteDb();
    const date = REF_DATES[2];
    const key = "한국-1";
    const oldBrief = loadBrief(db, date)!;
    const story = oldBrief.brief.sections[0]!.topStories[0]!;
    const oldTitle = story.title;
    const oldSummary = story.summary;
    const newTitle = "가짜국 재무장관이 고친 제목으로 나왔다";
    const newSummary = "가짜국 재무장관이 금리를 고친 값으로 바꿨다.";
    const checked = checkCorrection(db, { date, key, reason: FAKE_REASON, fields: { title: newTitle, summary: newSummary } }, null);
    assert.ok(checked.ok, JSON.stringify(checked));
    applyCorrection(db, checked, "2026-10-30");

    const dataDir = path.join(dir, "input");
    for (const [rel, content] of buildSiteData(db)) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    const records = buildSearchRecords(db);
    fs.writeFileSync(path.join(dataDir, "search-records.json"), JSON.stringify(records));
    const md = renderMarkdown(loadBrief(db, date)!);
    db.close();
    const out = path.join(dir, "out");
    await buildSite({ dataDir, outDir: out });

    const texts: [string, string][] = [
      // 지어낸 날짜들의 제목이 같아서 그 날짜만 본다(지난 전개 줄은 다른 날짜의 뉴스다)
      ["화면 데이터", JSON.stringify((JSON.parse(html(out, `site-data/list-${date.slice(0, 7)}.json`)) as MonthList).days.find((d) => d.date === date)) + JSON.stringify({ ...(JSON.parse(html(out, `site-data/detail-${date.slice(0, 7)}.json`)) as MonthDetail).days[date]![key], previous: [] })],
      ["HTML", unescape(html(out, `${date}.html`))],
      ["검색", JSON.stringify(records.filter((r) => r.url.includes(date)))],
      ["RSS", unescape(html(out, "rss.xml").split("<item>").find((x) => x.includes(`/${date}<`))!.replaceAll("&apos;", "'"))],
    ];
    for (const [name, text] of texts) {
      assert.ok(text.includes(newTitle), `${name}: 새 제목`);
      assert.ok(!text.includes(oldTitle), `${name}: 옛 제목`);
    }
    for (const [name, text] of [texts[0]!, texts[1]!, texts[2]!]) {
      assert.ok(text.includes(newSummary), `${name}: 새 글`);
      assert.ok(!text.includes(oldSummary), `${name}: 옛 글`);
    }
    assert.ok(md.includes(newTitle) && !md.includes(oldTitle), "마크다운");
    assert.equal(jsonLdOf(html(out, `${date}.html`))[0]!.dateModified, "2026-10-30T00:00:00+09:00");
    assert.ok(html(out, "sitemap.xml").includes(`<loc>${SITE_URL}/${date}</loc><lastmod>2026-10-30</lastmod>`));
    assert.ok(texts[1]![1].includes(FAKE_REASON), "사유가 보인다");
  });
});

describe("4.10-1 파일 수 회귀 방지", () => {
  test("365일, 이슈·대상 각 3,000개에서 결과물이 15,000개 이하다", { timeout: 300_000 }, async () => {
    const work = tempDir("tidwyn-count-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    const fx = generateFixtures({ days: 365, contiguous: true, issues: 3000, entities: 3000 });
    for (const [rel, content] of fx.files) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    const res = await buildSite({ dataDir, outDir: out });
    console.log(`365일 이슈·대상 3,000개: 결과물 ${res.files.length}개, ${(res.bytes / 1024 / 1024).toFixed(1)}MB`);
    assert.ok(res.files.length <= 15_000, `결과물 ${res.files.length}개`);
  });
});
