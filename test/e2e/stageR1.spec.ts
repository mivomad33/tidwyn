// R1단계 화면(E2E): 영상·빌더·수요를 지운 뒤의 브리프 탭(4.3-1), 지운 화면의 옛 주소와 옛 탭 저장값(4.3-2, T7),
// 브라우저에 남은 지운 기능의 읽음 기록(4.3-5). 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts). 브라우저 시계는 base.ts가 끝 날짜에 고정한다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, info, storyItem, test } from "./base.ts";
import { E2E_OUT_DIR } from "./paths.ts";
import { DEFAULT_TAB } from "../../site/src/lib/brief.ts";
import { BRIEF_TAB_KEY, READ_MARKS_KEY } from "../../site/src/lib/browserKeys.ts";
import type { DayList, MonthList } from "../../src/siteTypes.ts";

const SITE_DATA = path.join(E2E_OUT_DIR, "site-data");
const LATEST = info.latest.date;
const latestDay: DayList = (JSON.parse(fs.readFileSync(path.join(SITE_DATA, `list-${LATEST.slice(0, 7)}.json`), "utf8")) as MonthList).days.find((d) => d.date === LATEST)!;
const SECTIONS = latestDay.sections.map((s) => s.name);
/** 고른 탭 기록이 없을 때 열리는 탭: 기본 탭('한국')이 그날 없으면 첫 섹션 */
const DEFAULT_SHOWN: string = SECTIONS.includes(DEFAULT_TAB as (typeof SECTIONS)[number]) ? DEFAULT_TAB : SECTIONS[0]!;
const allStories = latestDay.sections.flatMap((s) => s.stories);
/** 기본 탭이 아닌 섹션의 첫 주요 뉴스(뉴스 키 해시가 그 탭을 열고 펼치는지 본다) */
const otherTop = latestDay.sections.find((s) => s.name === info.latest.otherSection)!.stories.find((s) => s.kind === "top")!;

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const pressedTab = (page: Page) => tabs(page).locator("button[aria-pressed=true]");

/** 콘솔 오류를 모은다(잡히지 않은 오류는 base.ts의 pageErrors가 따로 본다) */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  return errors;
}

/** 로컬 스토리지 값을 미리 넣어 둔다(같은 출처의 다른 화면에서 넣는다) */
async function seedStorage(page: Page, values: Record<string, string>): Promise<void> {
  await page.goto("/about");
  await expect(page.getByRole("heading", { level: 1, name: "사이트 소개" })).toBeVisible();
  await page.evaluate((v) => {
    for (const [k, x] of Object.entries(v)) localStorage.setItem(k, x);
  }, values);
}

test.describe("4.3-1 브리프의 섹션 탭은 뉴스 탭만", () => {
  test("앱: 섹션 탭이 '전체'와 그날의 뉴스 섹션뿐이다", async ({ page }) => {
    for (const url of ["/", `/${LATEST}`]) {
      await page.goto(url);
      await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...SECTIONS]);
      await expect(pressedTab(page)).toHaveText(DEFAULT_SHOWN);
    }
  });

  test("정적 HTML: 구역 제목과 구역 이동 칩이 뉴스 섹션뿐이고 영상·빌더·수요 구역이 없다", async ({ request }) => {
    const res = await request.get(`/${LATEST}`);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const headings = [...html.matchAll(/<h2 class="h list-h" id="section-\d+">([^<]*)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(SECTIONS);
    if (SECTIONS.length > 1) {
      const jump = /<nav class="rel static-jump" aria-label="구역으로 가기">(.*?)<\/nav>/s.exec(html);
      expect(jump, "구역 이동 칩").not.toBeNull();
      expect([...jump![1]!.matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1])).toEqual(SECTIONS);
    }
    for (const id of ["videos", "builder", "demand"]) expect(html, `id="${id}"`).not.toContain(`id="${id}"`);
    expect(html).not.toContain("영상");
    expect(html).not.toContain("빌더");
    expect(html).not.toMatch(/수요(?!일)/);
  });

  test.describe("자바스크립트를 끈 방문자", () => {
    test.use({ javaScriptEnabled: false });
    test("정적 브리프의 구역 제목과 구역 이동 칩이 뉴스 섹션뿐이다", async ({ page }) => {
      await page.goto(`/${LATEST}`);
      await expect(page.locator(".static-brief h2.list-h")).toHaveText(SECTIONS);
      if (SECTIONS.length > 1) await expect(page.getByRole("navigation", { name: "구역으로 가기" }).getByRole("link")).toHaveText(SECTIONS);
    });
  });
});

test.describe("4.3-2 지운 화면의 옛 주소와 옛 탭 저장값(T7)", () => {
  for (const base of ["/", `/${LATEST}`]) {
    for (const hash of ["#videos", "#builder", "#builder-2", "#product-1", "#repo-1", "#demand", "#demand-3"]) {
      test(`${base}${hash}는 오류 없이 뉴스의 기본 탭으로 열린다`, async ({ page }) => {
        const errors = consoleErrors(page);
        await page.goto(`${base}${hash}`);
        await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...SECTIONS]);
        await expect(pressedTab(page)).toHaveText(DEFAULT_SHOWN);
        await expect(page.locator("main ul.list > li").first()).toBeVisible();
        await expect(page.locator("main .item-btn[aria-expanded=true]")).toHaveCount(0);
        await expect(page.getByRole("heading", { level: 1, name: "이 주소에는 페이지가 없다" })).toHaveCount(0);
        expect(errors, "콘솔 오류").toEqual([]);
      });
    }
  }

  for (const old of ["영상", "빌더", "수요"]) {
    test(`저장된 마지막 탭이 지운 탭('${old}')이면 오류 없이 뉴스의 기본 탭으로 열린다`, async ({ page }) => {
      await seedStorage(page, { [BRIEF_TAB_KEY]: old });
      const errors = consoleErrors(page);
      for (const url of ["/", `/${LATEST}`]) {
        await page.goto(url);
        await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...SECTIONS]);
        await expect(pressedTab(page)).toHaveText(DEFAULT_SHOWN);
        await expect(page.locator("main ul.list > li").first()).toBeVisible();
      }
      expect(errors, "콘솔 오류").toEqual([]);
    });
  }

  test("정상 값은 그대로다: 저장된 뉴스 탭은 그 탭으로 열린다", async ({ page }) => {
    const other = info.latest.otherSection;
    expect(other).not.toBe(DEFAULT_SHOWN);
    await seedStorage(page, { [BRIEF_TAB_KEY]: other });
    await page.goto(`/${LATEST}`);
    await expect(pressedTab(page)).toHaveText(other);
  });

  test("정상 값은 그대로다: 뉴스 키 해시는 그 뉴스의 탭을 열고 뉴스를 펼친다", async ({ page }) => {
    expect(otherTop.section).not.toBe(DEFAULT_SHOWN);
    await page.goto(`/${LATEST}#${encodeURIComponent(otherTop.key)}`);
    await expect(pressedTab(page)).toHaveText(otherTop.section);
    await expect(storyItem(page, otherTop.key).locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
  });

  test("영상 페이지 주소(/videos/<날짜>/<id>)는 404 상태와 사이트의 없는 페이지다", async ({ page, request }) => {
    const url = `/videos/${LATEST}/abc`;
    const res = await request.get(url);
    expect(res.status()).toBe(404);
    expect(await res.text()).toContain("이 주소에는 페이지가 없다");
    const nav = await page.goto(url);
    expect(nav!.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "이 주소에는 페이지가 없다" })).toBeVisible();
  });
});

test.describe("4.3-5 브라우저에 남은 지운 기능의 읽음 기록", () => {
  const OLD_KEYS = ["builder-1", "product-1", "repo-1", "demand-2"];
  const seedMarks = (page: Page, newsKeys: string[]) =>
    seedStorage(page, { [READ_MARKS_KEY]: JSON.stringify({ v: 1, d: { [LATEST]: [...newsKeys, ...OLD_KEYS].sort() } }) });
  const dateRow = (page: Page) => page.locator(`a.row-link[href="/${LATEST}"]`);

  test("날짜 목록의 읽은 정도는 뉴스 키만 센다", async ({ page }) => {
    const tops = allStories.filter((s) => s.kind === "top").slice(0, 2);
    expect(tops).toHaveLength(2);
    await seedMarks(page, tops.map((s) => s.key));
    await page.goto("/dates");
    await expect(dateRow(page).locator(".read-prog")).toHaveText(`2/${allStories.length} 읽음`);

    // 브리프('전체' 탭)에서도 읽음으로 보이는 뉴스는 그 둘뿐이다
    await page.goto(`/${LATEST}`);
    await tabs(page).getByRole("button", { name: "전체" }).click();
    await expect(pressedTab(page)).toHaveText("전체");
    await expect(page.locator("main li[id^=story-] .nt.read")).toHaveCount(2);
  });

  test("뉴스를 모두 읽었으면 옛 항목 기록이 있어도 '다 읽음'이고, 옛 항목만 있으면 읽은 정도가 없다", async ({ page }) => {
    await seedMarks(page, allStories.map((s) => s.key));
    await page.goto("/dates");
    await expect(dateRow(page).locator(".read-prog")).toHaveText("✓다 읽음");

    await seedMarks(page, []);
    await page.goto("/dates");
    await expect(dateRow(page)).toBeVisible();
    await expect(dateRow(page).locator(".read-prog")).toHaveCount(0);
  });
});
