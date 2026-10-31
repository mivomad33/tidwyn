// 8단계 화면(E2E): 영상 줄의 '요약 보기'(브리프 영상 탭과 이슈 '관련 영상'). 데이터는 모두 지어낸 것이다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, info, test } from "./base.ts";
import { E2E_DATA_DIR } from "./paths.ts";
import type { DayList, IssueChunk, MonthList } from "../../src/siteTypes.ts";

const SITE_DATA = path.join(E2E_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const days = new Map<string, DayList>();
for (const f of fs.readdirSync(SITE_DATA).filter((n) => n.startsWith("list-"))) for (const d of json<MonthList>(f).days) days.set(d.date, d);
const LATEST = info.videos.dates[0]!;
const vids = days.get(LATEST)!.videos!;
const many = json<IssueChunk>("issue-0.json").issues[String(info.videos.many)]!;

const videoTab = (page: Page) => page.getByRole("navigation", { name: "섹션" }).getByRole("button", { name: `영상 ${vids.length}` });
const chips = (page: Page) => page.getByRole("group", { name: "영상 묶음" });
const rows = (page: Page) => page.locator("main li.vrow");
const buttons = (page: Page) => page.locator("main .vsumbtn");

test.describe("8단계 4.6-2 '요약 보기'", () => {
  test("브리프 영상 탭: 열고 닫고, 요약 없는 줄에는 버튼이 없으며, 눌러도 페이지가 그대로다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    await expect(buttons(page)).toHaveCount(vids.filter((v) => v.videoSummary).length);
    const withSummary = vids.findIndex((v) => v.videoSummary);
    const without = vids.findIndex((v) => !v.videoSummary);
    await expect(rows(page).nth(without).locator(".vsumbtn")).toHaveCount(0);
    const row = rows(page).nth(withSummary);
    const btn = row.getByRole("button", { name: "요약 보기" });
    const text = row.locator(".vsumtext");
    await expect(text).toBeHidden();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(text).toBeVisible();
    await expect(text).toHaveText(vids[withSummary]!.videoSummary!);
    const open = row.getByRole("button", { name: "요약 접기" });
    await expect(open).toHaveAttribute("aria-expanded", "true");
    await expect(open).toHaveAttribute("aria-controls", (await text.getAttribute("id"))!);
    expect(new URL(page.url()).pathname).toBe(`/${LATEST}`);
    await open.click();
    await expect(text).toBeHidden();
  });

  test("넓은 화면에서 버튼이 추천 이유 바로 아래에 있다(썸네일 높이로 벌어지지 않는다)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    const button = buttons(page).first();
    const why = (await button.locator("xpath=ancestor::li").locator(".why").boundingBox())!;
    const box = (await button.boundingBox())!;
    expect(Math.abs(box.y - (why.y + why.height))).toBeLessThan(8);
  });

  test("넓은 화면에서 요약을 펼쳐도 링크가 왼쪽 빈칸과 추천 이유로 넓어지지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 620, height: 900 });
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    const button = buttons(page).first();
    await button.click();
    const row = button.locator("xpath=ancestor::li");
    const thumb = (await row.locator(".vthumb").boundingBox())!;
    const li = (await row.boundingBox())!;
    expect(li.y + li.height).toBeGreaterThan(thumb.y + thumb.height + 24);
    const point = `document.elementFromPoint(${thumb.x + 20}, ${thumb.y + thumb.height + 12})`;
    expect(await page.evaluate(`${point}.closest("a") !== null`)).toBe(false);
    const title = (await row.locator(".vt").boundingBox())!;
    for (const [x, y] of [[thumb.x + 20, thumb.y + 20], [title.x + 5, title.y + 5]]) {
      expect(await page.evaluate(`document.elementFromPoint(${x}, ${y}).closest("a") !== null`)).toBe(true);
    }
    await row.locator(".vlink").focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(row.locator(".vlink")).toHaveCSS("outline-style", "none");
    await expect(row.locator(".vthumb")).toHaveCSS("outline-style", "solid");
  });

  test("키보드로 열고 닫는다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    const btn = buttons(page).first();
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(btn).toHaveText("요약 접기");
    await page.keyboard.press("Space");
    await expect(btn).toHaveText("요약 보기");
  });

  test("칩을 바꾸면 남은 줄도 닫히고, 새로 고치면 닫혀 있다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await videoTab(page).click();
    const firstKr = vids.find((v) => v.bundle === "kr" && v.videoSummary) ?? vids.find((v) => v.videoSummary)!;
    const row = page.locator(`main li.vrow[data-video="${firstKr.id}"]`);
    await row.getByRole("button", { name: "요약 보기" }).click();
    await expect(row.locator(".vsumtext")).toBeVisible();
    const label = firstKr.bundle === "kr" ? "한국" : firstKr.bundle === "us" ? "미국" : "AI";
    await chips(page).getByRole("button", { name: new RegExp(`^${label} `) }).click();
    await expect(row.locator(".vsumtext")).toBeHidden();
    await row.getByRole("button", { name: "요약 보기" }).click();
    await page.reload();
    await expect(page.locator("main .vsumtext:visible")).toHaveCount(0);
  });

  test("이슈 '관련 영상'도 같게 동작하고 폰 폭에서 가로 스크롤이 없다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/issues/${many.id}`);
    const btn = buttons(page).first();
    await btn.click();
    await expect(btn).toHaveText("요약 접기");
    await expect(page.locator("main .vsumtext:visible")).toHaveCount(1);
    await expectNoHorizontalScroll(page, "이슈 관련 영상 요약 375px");
  });
});
