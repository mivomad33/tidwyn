import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DayList, IssueChunk, IssueVideo, MonthList, SiteVideo, VideoBundle } from "../src/siteTypes.ts";
import { buildSite } from "../site/build.ts";
import { generateFixtures, writeFixtures } from "../site/dev/fixtures.ts";
import { BROKEN_THUMB } from "../site/dev/videoFixtures.ts";
import { resolveStatic } from "../site/hosting.ts";
import { FIRST_SCREEN_BUDGET, measureOutput } from "../site/size.ts";
import { FOOTER_LINKS, FooterView, PrivacyView } from "../site/src/components/policyView.ts";
import type { LinkLikeProps } from "../site/src/components/termView.ts";
import { AboutVideos, VideoList, VideoRow, VideoSource } from "../site/src/components/videoView.ts";
import { ALL_TAB, BRIEF_TAB_KEY, VIDEO_TAB, briefTabs, currentTab, parseBriefTab, stateForHash } from "../site/src/lib/brief.ts";
import { BOX_TAB_KEY as BOX_KEY_FROM_INDICATORS } from "../site/src/lib/indicators.ts";
import { BROWSER_KEYS, BOX_TAB_KEY, READ_MARKS_KEY, SCHEDULE_VIEW_KEY, WEEK_BOX_KEY } from "../site/src/lib/browserKeys.ts";
import { CONSENT_TEXT, PRIVACY_TITLE, REPO_ISSUES_URL } from "../site/src/lib/policy.ts";
import { READ_MARKS_KEY as READ_KEY_FROM_MARKS } from "../site/src/lib/readMarks.ts";
import { VIDEO_HASH, briefVideosPath, parseRoute, privacyPath } from "../site/src/lib/routes.ts";
import { SCHEDULE_VIEW_KEY as VIEW_KEY_FROM_SCHEDULES, WEEK_BOX_KEY as WEEK_KEY_FROM_SCHEDULES } from "../site/src/lib/schedules.ts";
import { DARK, LIGHT, contrast, textPairs } from "../site/src/lib/theme.ts";
import {
  GOOGLE_PRIVACY_URL,
  ISSUE_VIDEO_FIRST,
  YOUTUBE_TERMS_URL,
  durationClock,
  durationText,
  filterVideos,
  isVideoVisible,
  issueVideoRows,
  recommendedOnText,
  videoChips,
  videoTabLabel,
  videoUrl,
  visibleVideos,
} from "../site/src/lib/videos.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// 7단계 화면(4.7)과 지어낸 데이터·크기(4.6-3). 영상 제목·채널·추천 이유는 모두 지어낸 것이다.

after(cleanupTemp);

const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);
const TODAY = "2026-10-30";

let serial = 0;
function video(bundle: VideoBundle, fetchedOn = TODAY, extra: Partial<SiteVideo> = {}): SiteVideo {
  serial++;
  return { id: `vid${serial}`, bundle, title: `가짜 영상 ${serial}`, channel: "예시 채널", seconds: 2652, thumb: "/t.svg", reason: "가짜 추천 이유다.", fetchedOn, ...extra };
}

function day(videos?: SiteVideo[]): DayList {
  const d: DayList = { date: "2026-10-29", headline: "가짜", keywords: [], sections: [{ name: "한국", flow: "", stories: [] }, { name: "세계", flow: "", stories: [] }] };
  if (videos) d.videos = videos;
  return d;
}

describe("4.7-7 30일 지난 영상 숨기기", () => {
  test("받은 날이 29일 전이면 보이고 30일·31일 전이면 숨는다(오늘을 넣어 준다)", () => {
    assert.equal(isVideoVisible({ fetchedOn: "2026-10-01" }, TODAY), true, "29일 전");
    assert.equal(isVideoVisible({ fetchedOn: "2026-09-30" }, TODAY), false, "30일 전");
    assert.equal(isVideoVisible({ fetchedOn: "2026-09-29" }, TODAY), false, "31일 전");
    assert.equal(isVideoVisible({ fetchedOn: TODAY }, TODAY), true, "오늘");
    assert.equal(isVideoVisible({ fetchedOn: "깨진 날짜" }, TODAY), false);
  });

  test("탭의 N·칩의 수는 보이는 영상으로 세고, 모두 숨으면 영상 탭이 없다", () => {
    const d = day([video("kr", "2026-10-01"), video("kr", "2026-09-30"), video("us", "2026-09-30"), video("ai-en", "2026-10-29")]);
    const { tabs, videos } = briefTabs(d, TODAY);
    assert.deepEqual(tabs, [ALL_TAB, "한국", "세계", VIDEO_TAB]);
    assert.equal(videos.length, 2);
    assert.equal(videoTabLabel(videos.length), "영상 2");
    assert.deepEqual(videoChips(videos).map((c) => c.label), ["한국 1", "AI 1"], "미국은 모두 숨어 칩이 없다");
    const allOld = day([video("kr", "2026-09-30"), video("ai-ko", "2026-09-01")]);
    assert.deepEqual(briefTabs(allOld, TODAY).tabs, [ALL_TAB, "한국", "세계"]);
  });

  test("이슈 페이지의 관련 영상도 30일 지난 것을 빼고, 모두 빠지면 비어 있다", () => {
    const iv = (v: SiteVideo, date: string): IssueVideo => ({ ...v, date });
    const rows = issueVideoRows([iv(video("kr", "2026-09-30"), "2026-09-29"), iv(video("us", "2026-10-02"), "2026-10-01")], TODAY);
    assert.deepEqual(rows.rows.map((r) => r.fetchedOn), ["2026-10-02"]);
    assert.deepEqual(issueVideoRows([iv(video("kr", "2026-09-30"), "2026-09-29")], TODAY), { rows: [], more: 0 });
    assert.deepEqual(issueVideoRows(undefined, TODAY), { rows: [], more: 0 });
  });
});

describe("4.7-1 브리프의 '영상' 탭", () => {
  test("영상이 있는 날짜만 끝에 '영상' 탭이 있고, 기억한 '영상'이 없는 날짜는 첫 섹션 탭이다", () => {
    const none = day();
    assert.deepEqual(briefTabs(none, TODAY).tabs, [ALL_TAB, "한국", "세계"]);
    assert.equal(currentTab(none, briefTabs(none, TODAY).tabs, VIDEO_TAB), "한국");
    const some = day([video("us")]);
    assert.equal(currentTab(some, briefTabs(some, TODAY).tabs, VIDEO_TAB), VIDEO_TAB);
  });

  test("기억은 지금 키에 '영상'으로 남고, `#videos`는 영상 탭을 열며 뉴스 주소는 그 섹션으로 간다", () => {
    assert.equal(BRIEF_TAB_KEY, "tidwyn.briefTab");
    assert.equal(parseBriefTab("영상"), VIDEO_TAB);
    const d: DayList = { ...day(), sections: [{ name: "한국", flow: "", stories: [{ key: "한국-1", section: "한국", kind: "top", position: 1, title: "가짜", category: { major: "경제", minor: "가짜" }, issue: null, newIssue: false, continues: null }] }] };
    assert.deepEqual(stateForHash(d, VIDEO_HASH, { section: "한국", major: "정치", expanded: null }), { section: VIDEO_TAB, major: "정치", expanded: null });
    assert.deepEqual(stateForHash(d, null, { section: VIDEO_TAB, major: null, expanded: null }), { section: VIDEO_TAB, major: null, expanded: null }, "영상 탭은 날짜를 바꿔도 둔다");
    assert.deepEqual(stateForHash(d, "한국-1", { section: VIDEO_TAB, major: null, expanded: null }), { section: "한국", major: null, expanded: "한국-1" });
    assert.equal(briefVideosPath("2026-10-29"), "/2026-10-29#videos");
  });

  test("칩은 0개인 묶음을 빼고 한국 · 미국 · AI 순이며, AI 칩은 한국어·영어를 함께 거른다. 전체는 한국 → 미국 → AI 한국어 → AI 영어 순", () => {
    const vs = [video("ai-en"), video("kr"), video("ai-ko"), video("kr"), video("ai-en")];
    const shown = visibleVideos(vs, TODAY);
    assert.deepEqual(shown.map((v) => v.bundle), ["kr", "kr", "ai-ko", "ai-en", "ai-en"]);
    assert.deepEqual(shown.map((v) => v.id), [vs[1]!.id, vs[3]!.id, vs[2]!.id, vs[0]!.id, vs[4]!.id], "묶음 안은 받은 순서");
    assert.deepEqual(videoChips(shown), [
      { chip: "kr", label: "한국 2", count: 2 },
      { chip: "ai", label: "AI 3", count: 3 },
    ]);
    assert.deepEqual(filterVideos(shown, "ai").map((v) => v.bundle), ["ai-ko", "ai-en", "ai-en"]);
    assert.deepEqual(filterVideos(shown, null).length, 5);
    assert.deepEqual(videoChips([video("us")]).map((c) => c.label), ["미국 1"]);
  });

  test("영상 줄: 썸네일과 제목이 한 링크로 YouTube 주소를 새 탭으로 열고(보조 기술에 알림), 썸네일은 빈 대체 글, 묶음 표시·채널·길이와 추천 이유 상자", () => {
    const v = video("ai-en", TODAY, { id: "ab_C-12", title: "Example: a made-up talk", channel: "Example Lab", seconds: 3903 });
    const html = renderToStaticMarkup(h(VideoRow, { video: v, mode: "brief", Link }));
    const link = /<a href="([^"]+)" class="vlink" target="_blank" rel="([^"]+)">(.*?)<\/a>/.exec(html);
    assert.ok(link, html);
    assert.equal(link[1], "https://www.youtube.com/watch?v=ab_C-12");
    assert.match(link[2]!, /\bnoopener\b/);
    assert.match(link[3]!, /<img src="\/t.svg" alt=""/);
    assert.match(link[3]!, /<small class="vdur" aria-hidden="true">1:05:03<\/small>/);
    assert.match(link[3]!, /<span class="vt">Example: a made-up talk<\/span><span class="sr-only"> \(새 탭\)<\/span>$/);
    assert.match(html, /<div class="vm"><span class="tag">AI · 영어<\/span>Example Lab · 1시간 5분<\/div>/);
    assert.match(html, /<p class="why"><b>추천 이유<\/b>가짜 추천 이유다\.<\/p>/);
    assert.equal(videoUrl("a b"), "https://www.youtube.com/watch?v=a%20b");
  });

  test("묶음 표시와 길이 글자", () => {
    const tags = (["kr", "us", "ai-ko", "ai-en"] as const).map((b) => /<span class="tag">([^<]+)</.exec(renderToStaticMarkup(h(VideoRow, { video: video(b), mode: "brief", Link })))![1]);
    assert.deepEqual(tags, ["한국", "미국", "AI · 한국어", "AI · 영어"]);
    assert.equal(durationClock(2652), "44:12");
    assert.equal(durationClock(245), "4:05");
    assert.equal(durationText(2652), "44분");
    assert.equal(durationText(7200), "2시간");
  });

  test("출처 줄에 YouTube 이용약관 링크(새 탭)와 추천 이유를 Tidwyn이 썼다는 문구가 있다", () => {
    const html = renderToStaticMarkup(h(VideoSource));
    assert.equal(
      html,
      `<p class="vsrc">영상 정보: YouTube · <a href="${YOUTUBE_TERMS_URL}" class="text-link" target="_blank" rel="noopener noreferrer">YouTube 이용약관<span class="sr-only"> (새 탭)</span></a> · 추천 이유는 Tidwyn이 썼습니다.</p>`,
    );
  });
});

describe("4.7-2 이슈 페이지의 '관련 영상'", () => {
  const iv = (date: string, bundle: VideoBundle = "kr", id?: string): IssueVideo => ({ ...video(bundle, date), ...(id ? { id } : {}), date });

  test("붙은 브리프 날짜 최근 순(같은 날짜는 받은 순서), 같은 영상은 한 번, 처음 5개와 나머지 수(더 보기)", () => {
    const list = [iv("2026-10-20"), iv("2026-10-28", "us"), iv("2026-10-28", "kr"), iv("2026-10-25"), iv("2026-10-21"), iv("2026-10-22"), iv("2026-10-27", "kr", "dup"), iv("2026-10-26", "kr", "dup")];
    const first = issueVideoRows(list, TODAY);
    assert.equal(ISSUE_VIDEO_FIRST, 5);
    assert.deepEqual(first.rows.map((r) => `${r.date}/${r.bundle}`), ["2026-10-28/us", "2026-10-28/kr", "2026-10-27/kr", "2026-10-25/kr", "2026-10-22/kr"]);
    assert.equal(first.more, 2);
    const all = issueVideoRows(list, TODAY, true);
    assert.equal(all.rows.length, 7);
    assert.equal(all.rows.filter((r) => r.id === "dup").length, 1);
    assert.equal(all.more, 0);
    assert.deepEqual(issueVideoRows(list.slice(0, 5), TODAY), { rows: issueVideoRows(list.slice(0, 5), TODAY, true).rows, more: 0 }, "5개면 더 보기가 없다");
  });

  test("같은 영상 줄 컴포넌트를 쓰고, 채널·길이 뒤에 'M월 D일 추천'(그 날짜 브리프의 영상 탭)이 붙는다", () => {
    const v = iv("2026-10-29", "us");
    const html = renderToStaticMarkup(h(VideoList, { videos: [v], mode: "issue", Link }));
    assert.match(html, /^<ul class="vlist"><li class="vrow"/);
    assert.match(html, /<div class="vm">예시 채널 · 44분 · <a href="\/2026-10-29#videos" class="vrec">10월 29일 추천<\/a><\/div>/);
    assert.ok(!html.includes('class="tag"'), "이슈 페이지에는 묶음 표시를 붙이지 않는다(확정 시안)");
    assert.equal(recommendedOnText("2026-01-05"), "1월 5일 추천");
  });

  test("지어낸 데이터: 흡수된 이슈의 영상은 남는 이슈에 들어가고, 6개 이상인 이슈와 영상 없는 이슈가 있다", () => {
    const fx = generateFixtures({ end: "2026-10-27", days: 7, videos: true });
    const v = fx.info.videos!;
    const issues = JSON.parse(fx.files.get("site-data/issue-0.json")!) as IssueChunk;
    const survivor = issues.issues[String(v.absorbed!.into)]!;
    assert.ok(survivor.videos!.some((x) => x.id === v.absorbed!.id));
    assert.equal(issues.issues[String(v.absorbed!.issue)], undefined, "흡수된 이슈는 따로 없다");
    assert.ok(issues.issues[String(v.many)]!.videos!.length > ISSUE_VIDEO_FIRST);
    assert.equal(issues.issues[String(v.one)]!.videos!.length, 1);
    assert.ok(Object.values(issues.issues).some((i) => !i.videos));
    for (const i of Object.values(issues.issues)) {
      const dates = (i.videos ?? []).map((x) => x.date);
      assert.deepEqual(dates, [...dates].sort().reverse(), `이슈 ${i.id}는 최근 순`);
      assert.equal(new Set((i.videos ?? []).map((x) => x.id)).size, (i.videos ?? []).length);
    }
  });
});

describe("4.7-3 영상 줄 공통 코드", () => {
  test("브리프와 이슈 페이지가 같은 영상 목록·출처 줄 컴포넌트를 쓴다", () => {
    const src = (p: string) => fs.readFileSync(path.join(import.meta.dirname, "..", "site", "src", p), "utf8");
    for (const p of ["pages/BriefPage.tsx", "components/IssueVideos.tsx"]) {
      assert.match(src(p), /import \{[^}]*\bVideoList\b[^}]*\bVideoSource\b[^}]*\} from "\.\.\/components\/videoView\.ts"|import \{[^}]*\bVideoList\b[^}]*\bVideoSource\b[^}]*\} from "\.\/videoView\.ts"/, p);
    }
    assert.match(src("pages/IssuePage.tsx"), /<IssueVideos /);
  });
});

describe("4.7-4 개인정보 처리방침과 바닥글", () => {
  const html = renderToStaticMarkup(h(PrivacyView, { Link }));

  test("새 주소(/privacy)가 처리방침 화면이고, 대체 경로가 이미 덮는다", () => {
    assert.equal(privacyPath(), "/privacy");
    assert.deepEqual(parseRoute("/privacy"), { name: "privacy" });
    assert.deepEqual(parseRoute("/privacy/"), { name: "privacy" });
    assert.deepEqual(resolveStatic("/privacy", () => false), { kind: "fallback" });
  });

  test("처리방침에 정책 III.A와 4.7-4의 항목이 모두 있다", () => {
    assert.match(html, new RegExp(`<h1 class="page-title">${PRIVACY_TITLE}</h1>`));
    for (const text of [
      "로그인과 입력 양식이 없는",
      "개인정보를 모으거나 저장하거나 다른 곳에 넘기지 않는다",
      "Vercel Web Analytics",
      "tidwyn.vercel.app",
      "페이지 보기 수",
      "쿠키를 쓰지 않",
      "YouTube API Services",
      "30일 동안만 보인다",
      "YouTube(Google) 서버에서 바로 불러온다",
      "각 매체 서버에서 바로 불러온다",
      "제3자 광고를 싣지 않는다",
      "바뀐 날짜: 2026년 10월 30일",
      "브라우저 설정에서",
    ]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`href="${GOOGLE_PRIVACY_URL}"`), "Google 개인정보처리방침 링크");
    assert.equal(GOOGLE_PRIVACY_URL, "http://www.google.com/policies/privacy");
    assert.ok(html.includes(`href="${YOUTUBE_TERMS_URL}"`), "YouTube 이용약관 링크");
    assert.equal(YOUTUBE_TERMS_URL, "https://www.youtube.com/t/terms");
    assert.ok(html.includes(`href="${REPO_ISSUES_URL}"`), "문의처");
    assert.match(html, new RegExp(`<h2 class="h" id="terms">이용 조건</h2><p class="p">${CONSENT_TEXT}`), "'이용 조건' 절의 동의 문구");
    assert.ok(!/동의합니다|버튼/.test(html), "동의 배너·버튼이 없다");
  });

  test("브라우저에 두는 기록 목록은 키 정의(browserKeys.ts)로 만들고, 기존 키 상수도 거기서 온다", () => {
    const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("'", "&#x27;");
    for (const k of BROWSER_KEYS) assert.ok(html.includes(`<li><code>${k.key}</code>: ${esc(k.what)}</li>`), k.key);
    assert.deepEqual(BROWSER_KEYS.map((k) => k.key), ["tidwyn.read", "tidwyn.briefTab", "tidwyn.scheduleView", "tidwyn.weekBox", "tidwyn.briefBoxTab"]);
    assert.equal(READ_KEY_FROM_MARKS, READ_MARKS_KEY);
    assert.equal(VIEW_KEY_FROM_SCHEDULES, SCHEDULE_VIEW_KEY);
    assert.equal(WEEK_KEY_FROM_SCHEDULES, WEEK_BOX_KEY);
    assert.equal(BOX_KEY_FROM_INDICATORS, BOX_TAB_KEY);
    assert.ok(BROWSER_KEYS.some((k) => k.key === BRIEF_TAB_KEY));
    // 사이트 코드에서 "tidwyn." 키 글자를 쓰는 곳은 이 정의 하나뿐이다(새 키를 따로 만들면 실패한다)
    const root = path.join(import.meta.dirname, "..", "site", "src");
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    const defining = files.filter((f) => /"tidwyn\.[A-Za-z]+"/.test(fs.readFileSync(path.join(root, f), "utf8")));
    assert.deepEqual(defining, [path.join("lib", "browserKeys.ts")]);
  });

  test("바닥글에 동의 문구와 처리방침 링크가 있다(모든 화면이 같은 바닥글을 쓴다)", () => {
    const foot = renderToStaticMarkup(h(FooterView, { Link }));
    assert.ok(foot.includes(`<p class="consent">${CONSENT_TEXT}</p>`));
    assert.match(foot, /<a href="\/privacy">개인정보 처리방침<\/a><\/nav><\/footer>$/);
    assert.equal(FOOTER_LINKS.length, 8);
    assert.equal(CONSENT_TEXT, "이 사이트를 이용하면 개인정보 처리방침과 YouTube 이용약관에 동의하는 것으로 본다.");
  });
});

describe("4.7-5 사이트 소개의 '추천 영상'", () => {
  test("고르는 방법, YouTube API Services와 30일, 이용약관 링크와 동의 문구, 처리방침 링크가 있다", () => {
    const html = renderToStaticMarkup(h(AboutVideos, { Link }));
    assert.match(html, /^<h2 class="h">추천 영상<\/h2>/);
    for (const text of ["인기 차트", "주제 검색", "Claude가 제목과 설명을 보고", "추천 이유는 Tidwyn이 쓴 글", "YouTube API Services", "30일 동안만 보인다", CONSENT_TEXT]) assert.ok(html.includes(text), text);
    assert.ok(html.includes(`<a href="${YOUTUBE_TERMS_URL}" class="text-link" target="_blank" rel="noopener noreferrer">`));
    assert.ok(html.includes('<a href="/privacy" class="text-link">개인정보 처리방침</a>'));
    assert.match(fs.readFileSync(path.join(import.meta.dirname, "..", "site", "src", "pages", "AboutPage.tsx"), "utf8"), /<AboutVideos Link=\{Link\} \/>/);
  });
});

describe("4.7-6 새 색의 대비", () => {
  for (const [name, p] of [
    ["라이트", LIGHT],
    ["다크", DARK],
  ] as const) {
    test(`${name}: 묶음 표시, 정보 줄, 추천 이유 상자, 썸네일 위 길이, 출처 줄이 4.5:1 이상`, () => {
      const names = ["영상 묶음 표시", "영상 정보 줄", "추천 이유", "추천 이유 머리", "영상 길이", "영상 출처 줄"];
      for (const n of names) {
        const pair = textPairs(p).find((x) => x.name === n);
        assert.ok(pair, n);
        assert.ok(contrast(pair.fg, pair.bg) >= 4.5, `${n} ${contrast(pair.fg, pair.bg).toFixed(2)}`);
      }
    });
  }
});

describe("4.7-6 지어낸 데이터의 영상", () => {
  const fx = generateFixtures({ end: "2026-10-27", days: 40, contiguous: true, videos: true });
  const v = fx.info.videos!;
  const days = [...fx.files.keys()].filter((k) => k.startsWith("site-data/list-")).flatMap((k) => (JSON.parse(fx.files.get(k)!) as MonthList).days);
  const all = days.flatMap((d) => d.videos ?? []);

  test("끝 날짜 기준 30일(그리고 꼭 30일 전 날짜 하나)에만 영상이 있고, 받은 날은 브리프 날짜다", () => {
    for (const d of days) {
      const age = Math.round((Date.parse("2026-10-27T00:00:00Z") - Date.parse(`${d.date}T00:00:00Z`)) / 86400000);
      if (age > 30) assert.equal(d.videos, undefined, d.date);
      for (const x of d.videos ?? []) assert.equal(x.fetchedOn, d.date);
    }
    assert.equal(v.stale, "2026-09-27");
    assert.equal(briefTabs(days.find((d) => d.date === v.stale)!, "2026-10-27").tabs.includes(VIDEO_TAB), false, "끝 날짜를 오늘로 보면 숨는다");
  });

  test("날짜마다 묶음이 섞이고, 0개 묶음·한 묶음만·영상 없는 날짜, 썸네일 실패 영상이 있으며, 썸네일은 외부를 부르지 않는다", () => {
    const of = (date: string | null) => days.find((d) => d.date === date)!;
    assert.ok(new Set(of(v.dates[0]!).videos!.map((x) => x.bundle)).size === 4);
    assert.ok(!of(v.zeroBundleDate).videos!.some((x) => x.bundle === "us"));
    assert.deepEqual([...new Set(of(v.oneBundleDate).videos!.map((x) => x.bundle))], ["kr"]);
    assert.equal(of(v.noVideoDate).videos, undefined);
    assert.equal(all.find((x) => x.id === v.broken!.id)!.thumb, BROKEN_THUMB);
    for (const x of all) assert.ok(x.thumb === BROKEN_THUMB || x.thumb.startsWith("data:image/svg+xml,"), x.thumb);
    assert.ok(all.every((x) => x.title.includes("예시") || x.title.includes("Example") || /fictional|made-up|imaginary|가짜|가상/i.test(x.title)), "지어낸 제목");
  });

  test("영상을 켜지 않으면 사이트 데이터가 그대로다(영상 항목이 없다)", () => {
    const a = generateFixtures({ end: "2026-10-27", days: 7 });
    const b = generateFixtures({ end: "2026-10-27", days: 7, videos: true });
    assert.equal(a.info.videos, null);
    for (const [name, content] of a.files) assert.ok(!content.includes('"videos"'), name);
    assert.deepEqual([...a.files.keys()], [...b.files.keys()], "파일 목록은 같다");
  });
});

describe("4.6-3 영상을 더한 5년치", () => {
  test("30일 × 하루 16개 영상(추천 이유 150자, 관련 이슈 2개)을 더해도 결과물 10,000개 이하, 브리프 첫 화면 gzip 300KB 이하다", async () => {
    // 6단계 측정 조건(1,826일, 하루 42건, 이슈·대상 15,000개, 용어 5,000개, 일정 15,000개, 지표 12개 × 5년)에 영상 30일 × 16개
    const work = tempDir("tidwyn-site7y-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    writeFixtures(dataDir, { end: "2026-10-31", days: 1826, top: 6, short: 8, issues: 15000, contiguous: true, entities: 15000, terms: 5000, schedules: 15000, indicators: 5, indicatorsAll: true, videosFull: true });
    const res = await buildSite({ dataDir, outDir: out });
    assert.ok(res.files.length <= 10_000, `결과물 ${res.files.length}개`);
    const latest = (JSON.parse(fs.readFileSync(path.join(out, "site-data", "list-2026-10.json"), "utf8")) as MonthList).days.at(-1)!;
    assert.equal(latest.videos!.length, 16);
    assert.ok(latest.videos!.every((x) => x.reason.length === 150));
    const size = measureOutput(out);
    assert.ok(size.firstScreen.gzip <= FIRST_SCREEN_BUDGET, `브리프 첫 화면 gzip ${size.firstScreen.gzip}B`);
    console.log(`# 4.6-3 결과물 ${res.files.length}개, 전체 ${(res.bytes / 1024 / 1024).toFixed(2)}MB, 브리프 첫 화면 gzip ${(size.firstScreen.gzip / 1024).toFixed(1)}KB`);
  });
});
