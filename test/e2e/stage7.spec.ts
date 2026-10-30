// 7단계 화면(E2E): 브리프의 '영상' 탭(칩 거르기, 새로 고침·영상 없는 날짜, 링크, 썸네일 실패, 키보드), 이슈 페이지의 '관련 영상'
// ("M월 D일 추천", 더 보기, 흡수된 이슈), 바닥글의 개인정보 처리방침과 그 페이지(직접 열기·새로 고침), 30일 지난 영상 숨기기(시계 고정), 375px 폭.
// 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts, 영상의 받은 날은 끝 날짜 기준). 브라우저 시계는 base.ts가 끝 날짜에 고정한다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { FIXTURE_END, expect, expectNoHorizontalScroll, info, test } from "./base.ts";
import { E2E_DATA_DIR } from "./paths.ts";
import { BROKEN_THUMB } from "../../site/dev/videoFixtures.ts";
import { BRIEF_TAB_KEY } from "../../site/src/lib/browserKeys.ts";
import { CONSENT_TEXT } from "../../site/src/lib/policy.ts";
import { YOUTUBE_TERMS_URL } from "../../site/src/lib/videos.ts";
import type { DayList, IssueChunk, IssueDetail, MonthList, SiteVideo } from "../../src/siteTypes.ts";

const SITE_DATA = path.join(E2E_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const days = new Map<string, DayList>();
for (const f of fs.readdirSync(SITE_DATA).filter((n) => n.startsWith("list-"))) for (const d of json<MonthList>(f).days) days.set(d.date, d);
const issues = json<IssueChunk>("issue-0.json").issues;
const v = info.videos;
const LATEST = v.dates[0]!;
const latest = days.get(LATEST)!;
const vids = latest.videos!;
const count = (pred: (x: SiteVideo) => boolean) => vids.filter(pred).length;
const many: IssueDetail = issues[String(v.many)]!;
const one: IssueDetail = issues[String(v.one)]!;
const noVideoIssue = Object.values(issues).find((i) => !i.videos)!;

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const videoTab = (page: Page, n = vids.length) => tabs(page).getByRole("button", { name: `영상 ${n}` });
const chipGroup = (page: Page) => page.getByRole("group", { name: "영상 묶음" });
const rows = (page: Page) => page.locator("main li.vrow");

function addDaysIso(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function setToday(page: Page, date: string): Promise<void> {
  await page.clock.setFixedTime(new Date(`${date}T12:00:00+09:00`));
}

test.describe("4.7-1 브리프의 '영상' 탭", () => {
  test("섹션 탭 끝의 '영상 N'을 고르면 묶음 칩과 영상 줄, 출처 줄이 보이고, 칩으로 거르며 대분류 칩은 없다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await expect(tabs(page).getByRole("button").last()).toHaveText(`영상 ${vids.length}`);
    await videoTab(page).click();
    await expect(videoTab(page)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "카테고리" })).toHaveCount(0);
    const kr = count((x) => x.bundle === "kr");
    const us = count((x) => x.bundle === "us");
    const ai = count((x) => x.bundle.startsWith("ai"));
    await expect(chipGroup(page).getByRole("button")).toHaveText(["전체", `한국 ${kr}`, `미국 ${us}`, `AI ${ai}`]);
    await expect(chipGroup(page).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(vids.length);
    // 전체는 한국 → 미국 → AI 한국어 → AI 영어 순
    await expect(rows(page).locator(".tag")).toHaveText(vids.map((x) => ({ kr: "한국", us: "미국", "ai-ko": "AI · 한국어", "ai-en": "AI · 영어" })[x.bundle]));
    await expect(rows(page).first().locator(".why")).toContainText("추천 이유");
    const src = page.locator("main p.vsrc");
    await expect(src).toHaveText("영상 정보: YouTube · YouTube 이용약관 (새 탭) · 추천 이유는 Tidwyn이 썼습니다.");
    await expect(src.getByRole("link")).toHaveAttribute("href", YOUTUBE_TERMS_URL);

    await chipGroup(page).getByRole("button", { name: `AI ${ai}` }).click();
    await expect(chipGroup(page).getByRole("button", { name: `AI ${ai}` })).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(ai);
    for (const t of await rows(page).locator(".tag").allInnerTexts()) expect(t.startsWith("AI · ")).toBe(true);
    await chipGroup(page).getByRole("button", { name: `미국 ${us}` }).click();
    await expect(rows(page).locator(".tag")).toHaveText(Array(us).fill("미국"));

    // 다른 섹션 탭으로 가면 뉴스와 대분류 칩이 돌아온다
    await tabs(page).getByRole("button", { name: "한국" }).click();
    await expect(page.getByRole("group", { name: "카테고리" })).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
  });

  test("영상 탭은 새로 고쳐도 이어지고(칩은 '전체'로), 영상이 없는 날짜는 첫 섹션 탭을, 한 묶음 날짜는 그 칩만 보인다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    await chipGroup(page).getByRole("button", { name: /^한국/ }).click();
    expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("영상");
    await page.reload();
    await expect(videoTab(page)).toHaveAttribute("aria-pressed", "true");
    await expect(chipGroup(page).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(vids.length);

    const none = days.get(v.noVideoDate!)!;
    await page.goto(`/${v.noVideoDate}`);
    await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...none.sections.map((s) => s.name)]);
    await expect(tabs(page).getByRole("button", { name: none.sections[0]!.name })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY), "기억은 그대로").toBe("영상");

    const single = days.get(v.oneBundleDate!)!.videos!;
    await page.goto(`/${v.oneBundleDate}`);
    await expect(videoTab(page, single.length)).toHaveAttribute("aria-pressed", "true");
    await expect(chipGroup(page).getByRole("button")).toHaveText(["전체", `한국 ${single.length}`]);
    const zero = days.get(v.zeroBundleDate!)!.videos!;
    await page.goto(`/${v.zeroBundleDate}`);
    await expect(chipGroup(page).getByRole("button", { name: /^미국/ })).toHaveCount(0);
    await expect(rows(page)).toHaveCount(zero.length);
  });

  test("썸네일과 제목은 한 링크로 YouTube 영상 페이지를 새 탭으로 열고, 링크 이름은 제목이며 썸네일은 빈 대체 글이다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    for (const [i, x] of vids.entries()) {
      const link = rows(page).nth(i).locator("a.vlink");
      await expect(link).toHaveAttribute("href", `https://www.youtube.com/watch?v=${x.id}`);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", /(^|\s)noopener(\s|$)/);
      await expect(link).toHaveAccessibleName(`${x.title} (새 탭)`);
      await expect(link.locator(".vthumb")).toBeVisible();
      if (x.id !== v.broken!.id) await expect(link.locator("img")).toHaveAttribute("alt", "");
    }
  });

  test("썸네일을 불러오지 못하면 같은 크기의 빈 상자와 길이만 남고 줄 높이가 같다(120×70px 이상)", async ({ page }) => {
    const row = (p: Page) => p.locator(`main li.vrow[data-video="${v.broken!.id}"]`);
    // 같은 줄이 썸네일을 불러온 때의 높이
    await page.route(`**${BROKEN_THUMB}`, (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="#888"/></svg>' }));
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    await expect(row(page).locator("img")).toHaveJSProperty("complete", true);
    await expect.poll(() => row(page).locator("img").evaluate((el) => (el as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
    const okHeight = (await row(page).boundingBox())!.height;
    const okThumb = (await row(page).locator(".vthumb").boundingBox())!;
    expect(okThumb.width).toBeGreaterThanOrEqual(120);
    expect(okThumb.height).toBeGreaterThanOrEqual(70);
    await page.unroute(`**${BROKEN_THUMB}`);

    await page.reload();
    await expect(row(page).locator(".vthumb.failed")).toBeVisible();
    await expect(row(page).locator("img")).toHaveCount(0);
    await expect(row(page).locator(".vdur")).toBeVisible();
    const thumb = (await row(page).locator(".vthumb").boundingBox())!;
    expect([thumb.width, thumb.height]).toEqual([okThumb.width, okThumb.height]);
    expect((await row(page).boundingBox())!.height).toBe(okHeight);
  });

  test("키보드로 영상 탭을 고르고, 칩을 거르고, 영상 링크로 간다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).focus();
    await page.keyboard.press("Enter");
    await expect(videoTab(page)).toHaveAttribute("aria-pressed", "true");
    await chipGroup(page).getByRole("button", { name: "전체" }).focus();
    await page.keyboard.press("Tab");
    await expect(chipGroup(page).getByRole("button", { name: /^한국/ })).toBeFocused();
    await page.keyboard.press("Space");
    await expect(chipGroup(page).getByRole("button", { name: /^한국/ })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(rows(page).first().locator("a.vlink")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(rows(page).nth(1).locator("a.vlink")).toBeFocused();
  });
});

test.describe("4.7-2 이슈 페이지의 '관련 영상'", () => {
  test("'관련 영상'은 타임라인 아래에 최근 날짜 순으로 5개와 '더 보기', 출처 줄이 있고, 더 보기를 누르면 새 줄로 초점이 간다", async ({ page }) => {
    await page.goto(`/issues/${many.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "관련 영상" })).toBeVisible();
    const heads = await page.locator("main h2").allInnerTexts();
    expect(heads.indexOf("관련 영상")).toBe(heads.indexOf("타임라인") + 1);
    const section = page.locator("section", { has: page.getByRole("heading", { name: "관련 영상" }) });
    await expect(section.locator("li.vrow")).toHaveCount(5);
    await expect(section.locator(".tag")).toHaveCount(0);
    await expect(section.locator(".vrec").first()).toHaveText(`${Number(many.videos![0]!.date.slice(5, 7))}월 ${Number(many.videos![0]!.date.slice(8))}일 추천`);
    await expect(section.locator("p.vsrc").getByRole("link", { name: /YouTube 이용약관/ })).toHaveAttribute("href", YOUTUBE_TERMS_URL);
    const more = section.getByRole("button", { name: `더 보기 (${many.videos!.length - 5})` });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(section.locator("li.vrow")).toHaveCount(many.videos!.length);
    await expect(section.locator("li.vrow").nth(5).locator("a.vlink")).toBeFocused();
  });

  test("'M월 D일 추천'을 누르면 그 날짜 브리프의 영상 탭이 열린다", async ({ page }) => {
    await page.goto(`/issues/${one.id}`);
    const date = one.videos![0]!.date;
    await page.locator("main .vrec").first().click();
    await expect(page).toHaveURL(`/${date}#videos`);
    const n = days.get(date)!.videos!.length;
    await expect(videoTab(page, n)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`main li.vrow[data-video="${one.videos![0]!.id}"]`)).toBeVisible();
    expect(await page.evaluate("window.scrollY")).toBe(0);
    // 새로 고쳐도 영상 탭이고, 다른 탭을 고르면 주소의 #videos가 빠진다
    await page.reload();
    await expect(videoTab(page, n)).toHaveAttribute("aria-pressed", "true");
    await tabs(page).getByRole("button", { name: "전체" }).click();
    await expect(page).toHaveURL(`/${date}`);
  });

  test("흡수된 이슈의 영상은 남는 이슈에 보이고, 영상이 없는 이슈에는 '관련 영상'이 없다", async ({ page }) => {
    await page.goto(`/issues/${v.absorbed!.into}`);
    await expect(page.locator(`main li.vrow[data-video="${v.absorbed!.id}"]`)).toBeVisible();
    await page.goto(`/issues/${noVideoIssue.id}`);
    await expect(page.getByRole("heading", { level: 1, name: noVideoIssue.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "관련 영상" })).toHaveCount(0);
  });
});

test.describe("4.7-7 30일 지난 영상 숨기기", () => {
  test("받은 날부터 29일째에는 보이고 30일째에는 탭·칩·이슈 페이지에서 빠진다", async ({ page }) => {
    const fetched = vids[0]!.fetchedOn;
    await setToday(page, addDaysIso(fetched, 29));
    await page.goto(`/${LATEST}`);
    await expect(videoTab(page)).toBeVisible();
    await setToday(page, addDaysIso(fetched, 30));
    await page.goto(`/${LATEST}`);
    await expect(page.getByRole("link", { name: /날짜 목록 보기/ })).toBeVisible();
    await expect(tabs(page).getByRole("button", { name: /^영상/ })).toHaveCount(0);

    // 이슈: 1개뿐인 영상이 30일째에 빠지면 절이 없다
    const issueFetched = one.videos![0]!.fetchedOn;
    await setToday(page, addDaysIso(issueFetched, 29));
    await page.goto(`/issues/${one.id}`);
    await expect(page.getByRole("heading", { name: "관련 영상" })).toBeVisible();
    await setToday(page, addDaysIso(issueFetched, 30));
    await page.goto(`/issues/${one.id}`);
    await expect(page.getByRole("heading", { level: 1, name: one.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "관련 영상" })).toHaveCount(0);

    // 묶음 일부만 30일이 지난 날짜: 가장 최근 날짜는 끝 날짜에 받았으므로, 끝 날짜 + 29일에는 그 전 날짜의 영상은 빠지고 칩 수도 준다
    const older = v.dates.find((d) => d !== LATEST && addDaysIso(d, 30) <= addDaysIso(FIXTURE_END, 29))!;
    await setToday(page, addDaysIso(FIXTURE_END, 29));
    await page.goto(`/${older}`);
    await expect(page.getByRole("link", { name: /날짜 목록 보기/ })).toBeVisible();
    await expect(tabs(page).getByRole("button", { name: /^영상/ })).toHaveCount(0);
  });
});

test.describe("4.7-4 개인정보 처리방침", () => {
  const pages: [string, (p: Page) => Promise<void>][] = [
    ["/", (p) => expect(p.getByRole("link", { name: /날짜 목록 보기/ })).toBeVisible()],
    [`/issues/${many.id}`, (p) => expect(p.getByRole("heading", { level: 1, name: many.name })).toBeVisible()],
    [`/entities/${info.entities.person.id}`, (p) => expect(p.getByRole("heading", { level: 1, name: info.entities.person.name })).toBeVisible()],
    ["/terms", (p) => expect(p.getByRole("heading", { level: 1, name: "용어 사전" })).toBeVisible()],
    ["/schedules", (p) => expect(p.getByRole("heading", { level: 1, name: "일정" })).toBeVisible()],
    // 이 데이터에는 지표 파일이 없어 지표 화면은 불러오기 오류 상태다(바닥글은 같다)
    ["/indicators", (p) => expect(p.getByRole("button", { name: "다시 시도" })).toBeVisible()],
    ["/about", (p) => expect(p.getByRole("heading", { level: 1, name: "사이트 소개" })).toBeVisible()],
    ["/no-such-page", (p) => expect(p.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible()],
  ];
  for (const [url, ready] of pages) {
    test(`${url}의 바닥글에 동의 문구가 있고 '개인정보 처리방침'으로 간다`, async ({ page }) => {
      await page.goto(url);
      await ready(page);
      const footer = page.getByRole("contentinfo");
      await expect(footer).toContainText(CONSENT_TEXT);
      await footer.getByRole("link", { name: "개인정보 처리방침" }).click();
      await expect(page).toHaveURL("/privacy");
      await expect(page.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeVisible();
    });
  }

  test("새 주소를 직접 열고 새로 고쳐도 처리방침 제목과 '이용 조건' 절이 보인다", async ({ page }) => {
    const res = await page.goto("/privacy");
    expect(res!.status()).toBe(200);
    for (let i = 0; i < 2; i++) {
      await expect(page).toHaveTitle("개인정보 처리방침 · Tidwyn");
      await expect(page.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "이용 조건" })).toBeVisible();
      await expect(page.locator("article")).toContainText(CONSENT_TEXT);
      await expect(page.locator("article a[href='http://www.google.com/policies/privacy']")).toHaveAttribute("target", "_blank");
      await page.reload();
    }
  });
});

test.describe("4.7-5 사이트 소개의 '추천 영상'", () => {
  test("절이 있고 처리방침 링크로 간다", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 2, name: "추천 영상" })).toBeVisible();
    await page.locator("article").getByRole("link", { name: "개인정보 처리방침" }).click();
    await expect(page).toHaveURL("/privacy");
  });
});

test.describe("4.7-6 375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("영상 탭, 이슈의 '관련 영상', 처리방침, 사이트 소개에 가로 스크롤이 없고 썸네일이 120×70px 이상이다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    await expect(rows(page).first()).toBeVisible();
    await expectNoHorizontalScroll(page, "영상 탭");
    const thumb = (await rows(page).first().locator(".vthumb").boundingBox())!;
    expect(thumb.width).toBeGreaterThanOrEqual(120);
    expect(thumb.height).toBeGreaterThanOrEqual(70);
    for (const [url, label] of [
      [`/issues/${many.id}`, "이슈"],
      ["/privacy", "처리방침"],
      ["/about", "사이트 소개"],
    ] as const) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expectNoHorizontalScroll(page, label);
    }
  });
});
