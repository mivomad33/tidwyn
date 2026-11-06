import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures } from "../site/dev/fixtures.ts";
import { EMPTY_CLASS, Empty } from "../site/src/components/emptyView.ts";
import { StorySources } from "../site/src/components/sourceView.ts";
import type { LinkLikeProps } from "../site/src/components/termView.ts";
import { ExternalLink, VideoDetail, VideoList } from "../site/src/components/videoView.ts";
import type { IssueVideo, SiteVideo } from "../src/siteTypes.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// U1 4.2(같은 역할 부품): 빈 상태 부품과 '이 날' 띄어쓰기(4.2-7), 앱 밖 링크의 ↗(4.2-8), '/'로 가는 링크의 이름(4.2-9). 지어낸 데이터만 쓴다.

after(cleanupTemp);

const ROOT = path.join(import.meta.dirname, "..");
const SITE_SRC = path.join(ROOT, "site", "src");

/** 주석을 뺀 코드. 줄 주석을 먼저 뺀다(줄 주석 안의 '/*'가 블록 주석으로 읽히지 않게). 주소의 // 는 앞이 콜론이라 남는다 */
function stripComments(code: string): string {
  return code.replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 눈에 보이는 글: 보조 기술 전용 글(.sr-only)을 빼고 태그를 지운다. 끝 표시(aria-hidden)는 눈에 보이므로 남긴다 */
function visibleText(inner: string): string {
  return inner
    .replace(/<span class="sr-only">[^<]*<\/span>/g, "")
    .replace(/<[^>]*>/g, "")
    .replaceAll("&amp;", "&")
    .trim();
}

/** 새 탭으로 여는 링크 중 보이는 글이 있는데 ↗가 없는 것. 보조 기술에서 숨긴 썸네일 링크(aria-hidden)는 뺀다 */
function blankLinksWithoutArrow(html: string): string[] {
  const bad: string[] = [];
  for (const m of html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)) {
    const attrs = m[1]!;
    if (!/target="_blank"/.test(attrs) || /aria-hidden="true"/.test(attrs)) continue;
    const text = visibleText(m[2]!);
    if (text && !text.includes("↗")) bad.push(text);
  }
  return bad;
}

const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);

const video: SiteVideo = {
  id: "vid1",
  title: "가짜 영상 제목",
  channel: "가짜 채널",
  seconds: 2652,
  thumb: "/t.svg",
  bundle: "kr",
  reason: "가짜 추천 이유다.",
  hasSections: true,
  videoSummary: "가짜 요약이다.",
} as SiteVideo;

describe("U1 4.2-7 빈 상태와 '이 날'", () => {
  test("site/src의 화면 문구에 '이날'이 없다('이 날'로 띄어 쓴다)", () => {
    const files = listFilesRecursive(SITE_SRC).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => path.join(SITE_SRC, f));
    assert.ok(files.length > 20);
    const found = files.filter((f) => stripComments(fs.readFileSync(f, "utf8")).includes("이날")).map((f) => path.relative(ROOT, f));
    assert.deepEqual(found, []);
  });

  test("정적 HTML은 앱과 같은 빈 상태 부품을 쓴다(따로 만든 빈 상태가 없다)", () => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, "site", "staticSite.ts"), "utf8"));
    assert.match(code, /import \{ Empty \} from "\.\/src\/components\/emptyView\.ts";/);
    assert.doesNotMatch(code, /function Empty\b/);
    assert.doesNotMatch(code, /"state empty"/, "빈 상태 클래스를 직접 쓰지 않는다");
    const app = stripComments(fs.readFileSync(path.join(SITE_SRC, "components", "common.tsx"), "utf8"));
    assert.match(app, /export \{ Empty \} from "\.\/emptyView\.ts";/, "앱의 Empty도 같은 부품이다");
    assert.doesNotMatch(app, /function Empty\b/);
  });

  test("빈 상태 부품: 기본과 묶음 안 변형 하나", () => {
    assert.equal(renderToStaticMarkup(h(Empty, null, "아직 이슈가 없다.")), `<p class="${EMPTY_CLASS}">아직 이슈가 없다.</p>`);
    assert.equal(renderToStaticMarkup(h(Empty, { inline: true }, "이 날에는 일정이 없다.")), `<p class="${EMPTY_CLASS} inline">이 날에는 일정이 없다.</p>`);
  });
});

describe("U1 4.2 정적 HTML", () => {
  let out: string;
  let pages: string[];
  const read = (file: string) => fs.readFileSync(file, "utf8");
  before(async () => {
    const work = tempDir("tidwyn-cleanup-");
    const dataDir = path.join(work, "data");
    out = path.join(work, "out");
    writeFixtures(dataDir, { days: 12, entities: 12, terms: 8, schedules: 24, indicators: 1, indicatorsAll: true, videos: true, corrections: true, builder: true, demand: true });
    await buildSite({ dataDir, outDir: out });
    pages = listFilesRecursive(out).filter((f) => f.endsWith(".html")).map((f) => path.join(out, f));
  });

  test("4.2-7 어느 HTML에도 '이날'이 없고, 빌더·수요의 상태 문구는 '이 날'로 띄어 쓴다", () => {
    const found = pages.filter((f) => read(f).includes("이날")).map((f) => path.relative(out, f));
    assert.deepEqual(found, []);
    assert.ok(pages.some((f) => read(f).includes("이 날")), "띄어 쓴 문구가 실제로 나온다");
  });

  test("4.2-7 정적 HTML의 빈 상태는 앱과 같은 클래스·구조다", () => {
    const empties = pages.flatMap((f) => [...read(f).matchAll(/<p class="(state empty[^"]*)">/g)].map((m) => m[1]!));
    assert.ok(empties.length > 0, "빈 상태가 있는 페이지가 있다");
    for (const c of empties) assert.ok(c === EMPTY_CLASS || c === `${EMPTY_CLASS} inline`, c);
  });

  test("4.2-8 새 탭으로 여는 링크 중 보이는 글이 있는 것은 모두 ↗를 보인다", () => {
    let blank = 0;
    for (const f of pages) {
      const html = read(f);
      blank += (html.match(/target="_blank"/g) ?? []).length;
      assert.deepEqual(blankLinksWithoutArrow(html), [], path.relative(out, f));
    }
    assert.ok(blank > 10, "새 탭 링크가 있는 결과물을 본다");
  });

  test("4.2-8 메일 링크에는 ↗를 두지 않는다", () => {
    for (const f of pages) for (const m of read(f).matchAll(/<a [^>]*href="mailto:[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) assert.ok(!m[1]!.includes("↗"), path.relative(out, f));
  });

  test("4.2-9 '/'로 가는 링크의 보이는 글은 '최근 브리프'다(되돌아가기와 상표 제외)", () => {
    let seen = 0;
    for (const f of pages) {
      for (const m of read(f).matchAll(/<a ([^>]*href="\/"[^>]*)>([\s\S]*?)<\/a>/g)) {
        const cls = /class="([^"]*)"/.exec(m[1]!)?.[1] ?? "";
        if (/\b(brand|back)\b/.test(cls)) continue;
        seen++;
        assert.equal(visibleText(m[2]!), "최근 브리프", `${path.relative(out, f)}: ${m[0]}`);
      }
    }
    assert.ok(seen > 0);
    assert.match(read(path.join(out, "404.html")), /<a href="\/" class="btn">최근 브리프<\/a>/);
  });
});

describe("U1 4.2-8 앱의 앱 밖 링크", () => {
  test("영상 줄, 영상 페이지 제목과 구간 시각, 약관 링크, 출처 칩이 ↗를 보인다", () => {
    const issueVideo = { ...video, date: "2026-10-29" } as IssueVideo;
    const html = [
      renderToStaticMarkup(h(VideoList, { videos: [video], mode: "brief", Link, date: "2026-10-29" })),
      renderToStaticMarkup(h(VideoList, { videos: [issueVideo], mode: "issue", Link })),
      renderToStaticMarkup(h(VideoDetail, { video, sections: [{ start: 3725, title: "가짜 구간", gist: "가짜 요지", points: ["가짜 불릿"] }] })),
      renderToStaticMarkup(h(ExternalLink, { href: "https://example.com/terms", label: "가짜 약관" })),
      renderToStaticMarkup(h(StorySources, { sources: [{ name: "가짜 매체", url: "https://example.com/a", publishedAt: "2026-10-29T01:00:00Z", primary: true }] as never, year: "2026" })),
    ].join("");
    assert.equal((html.match(/target="_blank"/g) ?? []).length, 8, "새 탭 링크 여덟(영상 줄 둘, 영상 페이지의 썸네일·제목·시각·출처 줄 약관, 약관, 출처 칩)");
    assert.deepEqual(blankLinksWithoutArrow(html), []);
    assert.match(html, /<a href="https:\/\/www\.youtube\.com\/watch\?v=vid1" class="vpagethumb" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true">/, "썸네일만 있는 링크는 보조 기술에서 숨기고 ↗를 두지 않는다");
  });

  test("4.2-9 이슈 영상 줄의 날짜 링크는 그 날짜 브리프의 영상 탭으로 가고 '브리프'를 쓴다", () => {
    const html = renderToStaticMarkup(h(VideoList, { videos: [{ ...video, date: "2026-10-29" } as IssueVideo], mode: "issue", Link }));
    assert.match(html, /<a href="\/2026-10-29#videos" class="text-link vrec">10월 29일 브리프 영상<\/a>/);
  });
});
