// 9.6단계 화면(E2E): 영상 파일을 나눈 뒤의 브리프와 이슈. 첫 화면은 영상 파일을 받지 않고, 영상 탭을 열 때 받으며, 대기·오류·다시 시도가 있고,
// 지난 달 브리프와 여러 달에 걸친 관련 영상이 그대로 보인다. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts의 video-data).
import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./base.ts";
import { E2E_VIDEO_DATA_DIR, E2E_VIDEO_INFO_FILE } from "./paths.ts";
import type { VideoFixtureInfo } from "../../site/dev/videoFixtures.ts";
import type { DayList, DayVideos, IssueChunk, MonthList } from "../../src/siteTypes.ts";

const SITE_DATA = path.join(E2E_VIDEO_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const v = JSON.parse(fs.readFileSync(E2E_VIDEO_INFO_FILE, "utf8")) as VideoFixtureInfo;
const days = new Map<string, DayList>();
for (const f of fs.readdirSync(SITE_DATA).filter((n) => n.startsWith("list-"))) for (const d of json<MonthList>(f).days) days.set(d.date, d);
const issues = Object.assign({}, ...fs.readdirSync(SITE_DATA).filter((n) => /^issue-\d+\.json$/.test(n)).map((n) => json<IssueChunk>(n).issues)) as IssueChunk["issues"];
const LATEST = v.dates[0]!;
const PAST = v.pastDate!;
const pastVideos = json<DayVideos>(`videos-${PAST}.json`).videos;
const latestVideos = json<DayVideos>(`videos-${LATEST}.json`).videos;
const spread = issues[String(v.spread)]!;
const noVideoIssue = Object.values(issues).find((i) => !i.videoRefs)!;

/** 사이트 데이터 요청을 지어낸 영상 데이터로 바꾸고, 받은 영상 파일 이름을 모은다(오류 주입은 이 뒤에 단다) */
async function useVideoData(page: Page): Promise<string[]> {
  const asked: string[] = [];
  await page.route("**/site-data/**", (route: Route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    if (name.startsWith("videos-")) asked.push(name);
    const file = path.join(SITE_DATA, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
    return route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(file, "utf8") });
  });
  return asked;
}

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const videoTab = (page: Page, n: number) => tabs(page).getByRole("button", { name: `영상 ${n}` });
const rows = (page: Page) => page.locator("main li.vrow");
const related = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "관련 영상" }) });

test.describe("4.3-1 영상 파일은 영상 탭을 열 때만 받는다", () => {
  test("첫 화면에서는 탭의 N이 맞는데 요청이 없고, 영상 탭을 열면 그 날짜 파일 하나를 받는다", async ({ page }) => {
    const asked = await useVideoData(page);
    await page.goto(`/${LATEST}`);
    await expect(videoTab(page, latestVideos.length)).toBeVisible();
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
    expect(asked).toEqual([]);
    await videoTab(page, latestVideos.length).click();
    await expect(rows(page)).toHaveCount(latestVideos.length);
    expect(asked).toEqual([`videos-${LATEST}.json`]);
  });
});

test.describe("4.3-3 지난 날짜의 영상 탭", () => {
  test("30일보다 앞선 날짜도 새로 받았으면 탭이 보이고 N과 줄 수가 같으며, #videos로 바로 열린다", async ({ page }) => {
    await useVideoData(page);
    expect(PAST.slice(0, 7)).not.toBe(LATEST.slice(0, 7));
    await page.goto(`/${PAST}`);
    await videoTab(page, pastVideos.length).click();
    await expect(rows(page)).toHaveCount(pastVideos.length);
    await page.goto(`/${PAST}#videos`);
    await expect(videoTab(page, pastVideos.length)).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(pastVideos.length);
  });

  test("30일 지난 영상만 있는 날은 영상 탭이 없고 영상 파일을 받지 않는다", async ({ page }) => {
    const asked = await useVideoData(page);
    await page.goto(`/${v.stale}#videos`);
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
    await expect(tabs(page).getByRole("button", { name: /^영상/ })).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test.describe("4.3-4 대기와 오류", () => {
  test("받는 동안 대기, 실패하면 오류와 다시 시도, 다시 시도하면 정상이고 뉴스 탭은 동작한다", async ({ page }) => {
    await useVideoData(page);
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    let fail = true;
    await page.route(`**/site-data/videos-${LATEST}.json`, async (route) => {
      await gate;
      if (fail) return route.fulfill({ status: 500, contentType: "text/plain", body: "실패" });
      return route.fallback();
    });
    await page.goto(`/${LATEST}`);
    await videoTab(page, latestVideos.length).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    release();
    const retry = page.getByRole("button", { name: "다시 시도" });
    await expect(retry).toBeVisible();
    await tabs(page).getByRole("button", { name: "전체" }).click();
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
    await expect(retry).toHaveCount(0);
    await videoTab(page, latestVideos.length).click();
    fail = false;
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(rows(page)).toHaveCount(latestVideos.length);
  });
});

test.describe("4.3-5 이슈의 관련 영상", () => {
  test("여러 달에 걸친 관련 영상 7개가 최근 순으로 5개와 더 보기로 보이고, 더 보기 전에는 첫 5개의 날짜만 받는다", async ({ page }) => {
    const asked = await useVideoData(page);
    const refs = spread.videoRefs!;
    expect(refs).toHaveLength(7);
    expect(new Set(refs.map((r) => r.date.slice(0, 7))).size).toBeGreaterThan(1);
    await page.goto(`/issues/${spread.id}`);
    await expect(related(page).locator("li.vrow")).toHaveCount(5);
    await expect(related(page).locator("li.vrow").first()).toHaveAttribute("data-video", refs[0]!.id);
    expect(asked.toSorted()).toEqual([...new Set(refs.slice(0, 5).map((r) => `videos-${r.date}.json`))].toSorted());
    await related(page).getByRole("button", { name: "더 보기 (2)" }).click();
    await expect(related(page).locator("li.vrow")).toHaveCount(7);
    await expect(related(page).locator("li.vrow").last()).toHaveAttribute("data-video", refs[6]!.id);
  });

  test("이슈 뉴스는 영상을 기다리지 않고, 실패하면 오류와 다시 시도가 있다", async ({ page }) => {
    await useVideoData(page);
    let fail = true;
    await page.route("**/site-data/videos-*.json", (route) => (fail ? route.fulfill({ status: 500, contentType: "text/plain", body: "실패" }) : route.fallback()));
    await page.goto(`/issues/${spread.id}`);
    await expect(page.getByRole("heading", { level: 1, name: spread.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "타임라인" })).toBeVisible();
    const retry = related(page).getByRole("button", { name: "다시 시도" });
    await expect(retry).toBeVisible();
    fail = false;
    await retry.click();
    await expect(related(page).locator("li.vrow")).toHaveCount(5);
  });

  test("영상이 없는 이슈는 절이 없고 영상 파일을 받지 않는다", async ({ page }) => {
    const asked = await useVideoData(page);
    await page.goto(`/issues/${noVideoIssue.id}`);
    await expect(page.getByRole("heading", { level: 1, name: noVideoIssue.name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "관련 영상" })).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test.describe("4.4-1 처리방침의 새 문구", () => {
  test("주기적으로 새로 받는다는 문구가 있고 '30일 동안만'은 없다", async ({ page }) => {
    await useVideoData(page);
    await page.goto("/privacy");
    await expect(page.locator("main")).toContainText("주기적으로 새로 받는다");
    await expect(page.locator("main")).toContainText("YouTube에서 사라진 영상도 지운다");
    await expect(page.locator("main")).not.toContainText("30일 동안만");
  });
});

test.describe("추천 날짜 링크의 누를 곳", () => {
  const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

  test("마우스로 쓸 때는 24px 높이이고 아래 추천 이유를 덮지 않는다", async ({ page }) => {
    await useVideoData(page);
    await page.goto(`/issues/${v.spread}`);
    await expect(rows(page).first()).toBeVisible();
    const link = await box(page, "a.vrec");
    expect(link.height).toBeGreaterThanOrEqual(24);
    expect(link.y + link.height).toBeLessThanOrEqual((await box(page, "li.vrow .why")).y);
  });

  test.describe("터치 화면", () => {
    test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });

    test("44px 높이다", async ({ page }) => {
      await useVideoData(page);
      await page.goto(`/issues/${v.spread}`);
      await expect(rows(page).first()).toBeVisible();
      expect((await box(page, "a.vrec")).height).toBeGreaterThanOrEqual(44);
    });
  });
});

test.describe("4.3-8 디자인 점검에서 고친 것", () => {
  test("관련 영상이 도착해도 아래 내용이 한 줄 높이 넘게 밀리지 않는다", async ({ page }) => {
    await useVideoData(page);
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/site-data/videos-*.json", async (route) => {
      await held;
      await route.fallback();
    });
    await page.goto(`/issues/${v.spread}`);
    await expect(related(page).getByRole("status")).toBeVisible();
    const before = (await page.locator("html").boundingBox())!.height;
    release();
    await expect(rows(page).first()).toBeVisible();
    const after = (await page.locator("html").boundingBox())!.height;
    expect(Math.abs(after - before)).toBeLessThan(150);
  });

  test("건너뛰기로 본문에 가도 제목이 고정 머리글에 가리지 않는다", async ({ page }) => {
    await page.goto("/about");
    await page.keyboard.press("Tab");
    await expect(page.locator("a.skip")).toBeFocused();
    await page.keyboard.press("Enter");
    const top = (await page.locator("main h1").boundingBox())!.y;
    const bar = (await page.locator("header").first().boundingBox())!;
    expect(top).toBeGreaterThanOrEqual(bar.y + bar.height);
  });

  test("영상 파일 실패 문구가 영상을 말하고, 영상이 없으면 출처 줄이 없다", async ({ page }) => {
    await useVideoData(page);
    await page.route("**/site-data/videos-*.json", (route) => route.fulfill({ status: 500, body: "x" }));
    await page.goto(`/issues/${v.spread}`);
    await expect(related(page).getByRole("alert")).toContainText("영상을 불러오지 못했다");
    await expect(related(page).locator(".vsrc")).toHaveCount(0);
  });

  test("모바일의 하단 탭은 44px 높이이고, 추천 날짜 링크가 제목 링크를 덮지 않는다", async ({ page }) => {
    await useVideoData(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`/issues/${v.spread}`);
    await expect(rows(page).first()).toBeVisible();
    const vrec = page.locator("a.vrec").first();
    const title = await page.locator("li.vrow .vt").first().boundingBox();
    expect((await vrec.boundingBox())!.y).toBeGreaterThanOrEqual(title!.y + title!.height);
    await page.goto(`/${PAST}`);
    expect((await videoTab(page, pastVideos.length).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("하단 탭의 선택 밑줄이 강제 색 모드에서도 남는다", async ({ page }) => {
    await useVideoData(page);
    await page.emulateMedia({ forcedColors: "active" });
    await page.goto(`/${PAST}`);
    await expect(page.locator(".tabs button.on")).toBeVisible();
    expect(await page.evaluate(`getComputedStyle(document.querySelector(".tabs button.on"), "::after").borderBottomWidth`)).toBe("2px");
  });

  test("확대 200%에 해당하는 좁은 폭에서 영상 메타 줄이 가로 스크롤을 만들지 않는다", async ({ page }) => {
    await useVideoData(page);
    await page.setViewportSize({ width: 187, height: 800 });
    await page.goto(`/issues/${v.spread}`);
    await expect(rows(page).first()).toBeVisible();
    const box = (await page.locator("li.vrow .vm").first().boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(187);
    const rec = (await page.locator("a.vrec").first().boundingBox())!;
    expect(rec.x + rec.width).toBeLessThanOrEqual(187);
    expect(await page.evaluate("document.scrollingElement.scrollWidth")).toBeLessThanOrEqual(187);
  });
});

// 시각 회귀(design-check): 영상 탭과 관련 영상의 정상·대기·오류를 폭마다 찍는다
for (const width of [375, 1440]) {
  test.describe(`영상 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });
    const holdVideos = (page: Page) => page.route("**/site-data/videos-*.json", () => undefined);
    const failVideos = (page: Page) => page.route("**/site-data/videos-*.json", (route) => route.fulfill({ status: 500, body: "x" }));

    for (const [name, fault] of [["정상", null], ["대기", holdVideos], ["오류", failVideos]] as const) {
      test(`영상 탭 ${name}`, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${LATEST}T09:00:00+09:00`));
        await useVideoData(page);
        await fault?.(page);
        await page.goto(`/${PAST}#videos`);
        await expect(name === "정상" ? rows(page).first() : page.locator("main .state")).toBeVisible();
        await expect(page).toHaveScreenshot(`videos-tab-${name}-${width}.png`, { animations: "disabled" });
      });

      test(`관련 영상 ${name}`, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${LATEST}T09:00:00+09:00`));
        await useVideoData(page);
        await fault?.(page);
        await page.goto(`/issues/${v.spread}`);
        await expect(name === "정상" ? rows(page).first() : related(page).locator(".state")).toBeVisible();
        await expect(related(page)).toHaveScreenshot(`videos-related-${name}-${width}.png`, { animations: "disabled" });
      });
    }
  });
}
