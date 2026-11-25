import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures } from "../site/dev/fixtures.ts";
import { FRED_AGREEMENT, FRED_NOTICE } from "../site/src/lib/indicators.ts";
import { CONTACT_MAIL } from "../site/src/lib/policy.ts";
import { READ_MARKS_KEY } from "../site/src/lib/browserKeys.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// R1(기능 줄이기) 4.3-3 결과물에 지운 기능이 없음, 4.3-4 소개·처리방침. 지어낸 데이터(site/dev/fixtures.ts)로 빌드한다.

after(cleanupTemp);

/** 글로 읽는 결과물 파일 */
const TEXT_EXT = /\.(html|json|xml|js|css|txt|webmanifest|svg)$/;

/** \uXXXX 이스케이프와 HTML 숫자 참조를 글자로 되돌린다(JS 번들과 HTML이 한글을 이스케이프해도 낱말을 찾게) */
function decode(text: string): string {
  return text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/** 화면 글로 남으면 안 되는 지운 기능 낱말(4.3-3). '수요일'은 걸리지 않는다. '빌더'는 B1(3.4)이 탭 이름으로 다시 써서 뺐다 */
const SCREEN_WORDS: readonly [string, RegExp][] = [
  ["영상", /영상/],
  ["수요", /수요(?!일)/],
  ["새 제품", /새 제품/],
  ["뜨는 저장소", /뜨는 저장소/],
];

/** 지운 기능의 사이트 데이터 파일 이름 */
const REMOVED_FILES: readonly [string, RegExp][] = [
  ["videos-", /videos-/],
  ["video-sections-", /video-sections-/],
  ["builder-items-", /builder-items-/],
  ["demand-items-", /demand-items-/],
  ["builder.json", /builder\.json/],
  ["demand.json", /demand\.json/],
];

/** 결과물 폴더에서 지운 기능 낱말·파일 이름이 나온 자리("파일: 낱말 …앞뒤 글…") */
function scanOutput(dir: string): string[] {
  const hits: string[] = [];
  for (const rel of listFilesRecursive(dir)) {
    const name = rel.replaceAll(path.sep, "/");
    for (const [label, re] of REMOVED_FILES) if (re.test(name)) hits.push(`${name}: 파일 이름 ${label}`);
    if (!TEXT_EXT.test(name)) continue;
    const text = decode(fs.readFileSync(path.join(dir, rel), "utf8"));
    for (const [label, re] of [...SCREEN_WORDS, ...REMOVED_FILES]) {
      const m = re.exec(text);
      if (m) hits.push(`${name}: ${label} …${text.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ")}…`);
    }
  }
  return hits;
}

let out: string;
let dataDir: string;

before(async () => {
  const work = tempDir("tidwyn-r1site-");
  dataDir = path.join(work, "data");
  out = path.join(work, "out");
  writeFixtures(dataDir, { schedules: 25, entities: 30, terms: 24, corrections: true, indicators: 1 });
  await buildSite({ dataDir, outDir: out });
});

describe("R1 4.3-3 빌드 결과물에 지운 기능이 없다", () => {
  test("결과물 전체(HTML, 사이트 데이터, 사이트맵·RSS, JS·CSS)와 검색 레코드에 지운 기능의 화면 낱말과 파일 이름이 없다", () => {
    const files = listFilesRecursive(out).map((f) => f.replaceAll(path.sep, "/"));
    assert.ok(files.includes("index.html") && files.includes("sitemap.xml") && files.includes("rss.xml") && files.includes("schedules.html"), "결과물이 다 만들어졌다");
    assert.ok(files.some((f) => f.startsWith("issues/")) && files.some((f) => /^assets\/.*\.js$/.test(f)) && files.some((f) => /^site-data\/schedule/.test(f)), "이슈·번들·일정 데이터가 있다");
    assert.deepEqual(scanOutput(out), []);
    const records = decode(fs.readFileSync(path.join(dataDir, "search-records.json"), "utf8"));
    assert.deepEqual(SCREEN_WORDS.filter(([, re]) => re.test(records)).map(([w]) => w), [], "검색 레코드에 지운 기능 낱말이 없다");
  });

  test("검사는 일부러 넣은 낱말과 파일을 잡고, '수요일'은 잡지 않는다", () => {
    const planted = tempDir();
    fs.cpSync(out, planted, { recursive: true });
    const index = path.join(planted, "index.html");
    fs.appendFileSync(index, "<!-- 매주 수요일 -->");
    assert.deepEqual(scanOutput(planted), [], "수요일은 걸리지 않는다");
    fs.appendFileSync(index, "<p>오늘의 영상</p>");
    const js = listFilesRecursive(planted).find((f) => /^assets[\\/].*\.js$/.test(f))!;
    fs.appendFileSync(path.join(planted, js), `\nconst t="\\uc601\\uc0c1";`); // 이스케이프한 '영상'
    fs.writeFileSync(path.join(planted, "site-data", "demand-items-2026-10.json"), "{}");
    fs.appendFileSync(path.join(planted, "sitemap.xml"), "<!-- 뜨는 저장소 -->");
    const hits = scanOutput(planted);
    assert.ok(hits.some((h) => h.startsWith("index.html: 영상")), hits.join("\n"));
    assert.ok(hits.some((h) => h.includes(".js: 영상")), hits.join("\n"));
    assert.ok(hits.some((h) => h === "site-data/demand-items-2026-10.json: 파일 이름 demand-items-"), hits.join("\n"));
    assert.ok(hits.some((h) => h.startsWith("sitemap.xml: 뜨는 저장소")), hits.join("\n"));
  });
});

// ---- 소개·처리방침(4.3-4) ----

/** 태그를 지운 보이는 글(링크 주소는 따로 본다) */
function textOf(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " "))
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/\s+/g, " ");
}

function hrefsOf(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => decode(m[1]!.replaceAll("&amp;", "&")));
}

/** 소개·처리방침에 남으면 안 되는 지운 서비스·소스 문구. '빌더'는 B1(3.4, 4.4-4)이 빌더 탭 안내와 탭 저장값 문구로 다시 써서 뺐다 */
const POLICY_FORBIDDEN: readonly [string, RegExp][] = [
  ["YouTube", /youtube/i],
  ["Gemini", /gemini/i],
  ["Product Hunt", /product ?hunt/i],
  ["GitHub 검색·별", /GitHub (Search|API|Trending|Advisory)|stargazer|별 수|별이 [\d,]+|별 이력/i],
  ["뜨는 저장소·새 제품", /뜨는 저장소|새 제품/],
  ["수요 소스", /청원|권익위|민원|1372|DART|SEC Form|Wikimedia|Google Trends|Mastodon|Bluesky|커뮤니티/i],
  ["영상", /영상/],
  ["수요", /수요(?!일)/],
];

/** 소개·처리방침 한 페이지의 지운 기능 문구와 링크 */
function policyHits(html: string): string[] {
  const text = textOf(html);
  const hits: string[] = POLICY_FORBIDDEN.filter(([, re]) => re.test(text)).map(([w]) => `글: ${w}`);
  for (const href of hrefsOf(html)) if (/youtube\.com|youtu\.be|producthunt\.com|policies\.google\.com|ai\.google\.dev|docs\.github\.com/i.test(href)) hits.push(`링크: ${href}`);
  return hits;
}

describe("R1 4.3-4 소개·처리방침", () => {
  const page = (name: string) => fs.readFileSync(path.join(out, name), "utf8");

  test("소개와 처리방침에 지운 서비스 이름·소스 문구, YouTube 약관 링크가 없다", () => {
    for (const name of ["about.html", "privacy.html"]) assert.deepEqual(policyHits(page(name)), [], name);
  });

  test("소개에 FRED 고지, 방문 통계, 읽은 기록, 연락 메일이 그대로 있다", () => {
    const html = page("about.html");
    const text = textOf(html);
    assert.ok(text.includes(textOf(FRED_NOTICE)), "FRED 고지");
    assert.ok(text.includes(FRED_AGREEMENT), "FRED 이용 약관 문구");
    assert.match(text, /방문 통계 Vercel Web Analytics로 페이지 보기 수만 셉니다/);
    assert.match(text, /읽은 기록 읽은 뉴스 표시는 이 브라우저에만 저장됩니다/);
    assert.ok(text.includes(CONTACT_MAIL) && hrefsOf(html).some((h) => h.startsWith(`mailto:${CONTACT_MAIL}`)), "연락 메일");
    assert.ok(hrefsOf(html).includes("https://github.com/mivomad33/tidwyn"), "원본 저장소 링크는 남는다");
  });

  test("처리방침에 방문 통계, 브라우저에 두는 읽은 기록, 문의 메일이 그대로 있다", () => {
    const html = page("privacy.html");
    const text = textOf(html);
    assert.match(text, /방문 통계 운영 주소\([^)]+\)에서만 Vercel Web Analytics로 페이지 보기 수를 셉니다/);
    assert.match(text, /브라우저에만 두는 기록/);
    assert.ok(text.includes(READ_MARKS_KEY), "읽은 기록 키가 목록에 있다");
    assert.match(text, /브리프에서 마지막으로 고른 탭\(전체·한국·세계·IT·AI·빌더\)/, "탭 저장값 설명에 지운 탭이 없고 B1 빌더 탭이 있다");
    assert.ok(text.includes(CONTACT_MAIL) && hrefsOf(html).some((h) => h.startsWith(`mailto:${CONTACT_MAIL}`)), "문의 메일");
  });

  test("검사는 일부러 넣은 옛 문구와 YouTube 약관 링크를 잡는다", () => {
    const old = page("privacy.html").replace(
      "</main>",
      '<h2 class="h">추천 영상과 YouTube</h2><p class="p">영상 내용은 Google의 Gemini API로 확인한다. <a href="https://www.youtube.com/t/terms">YouTube 이용약관</a></p></main>',
    );
    assert.notEqual(old, page("privacy.html"), "심을 자리가 있다");
    assert.deepEqual(policyHits(old), ["글: YouTube", "글: Gemini", "글: 영상", "링크: https://www.youtube.com/t/terms"]);
    const about = page("about.html").replace("</main>", "<p>새 제품은 Product Hunt에서, 수요는 국회 청원과 Wikimedia에서 받는다.</p></main>");
    assert.deepEqual(policyHits(about), ["글: Product Hunt", "글: 뜨는 저장소·새 제품", "글: 수요 소스", "글: 수요"]);
  });
});
