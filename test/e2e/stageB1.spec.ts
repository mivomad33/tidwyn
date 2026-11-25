// B1단계 빌더 탭(E2E): 탭 목록·순서·기억·해시(4.4-1), 저장소 항목과 빈 상태(4.4-2), 검색 결과에서 빌더 탭으로(4.4-3).
// 저장소 기록이 있는 지어낸 데이터로 따로 빌드한 사이트(prepare.ts의 b1-out, 포트 E2E_B1_PORT)를 본다. 브라우저 시계는 base.ts가 끝 날짜에 고정한다.
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, test } from "./base.ts";
import { E2E_B1_BASE_URL, E2E_B1_INFO_FILE, E2E_B1_OUT_DIR } from "./paths.ts";
import { BRIEF_TAB_KEY, READ_MARKS_KEY } from "../../site/src/lib/browserKeys.ts";
import type { DayList, MonthList } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_B1_BASE_URL });

const b1 = JSON.parse(fs.readFileSync(E2E_B1_INFO_FILE, "utf8")) as { dates: string[]; shown: string; none: string; failed: string; absent: string };
const SITE_DATA = path.join(E2E_B1_OUT_DIR, "site-data");
const dayOf = (date: string): DayList => (JSON.parse(fs.readFileSync(path.join(SITE_DATA, `list-${date.slice(0, 7)}.json`), "utf8")) as MonthList).days.find((d) => d.date === date)!;
const SHOWN = dayOf(b1.shown);
const SECTIONS = SHOWN.sections.map((s) => s.name);
const ITEMS = [...SHOWN.repos!.items].sort((a, b) => a.rank - b.rank);
/** 화면의 저장소 이름은 GitHub 트렌딩처럼 'owner / name'으로 보인다 */
const shownName = (name: string) => name.replace("/", " / ");
const NONE_TEXT = "이 날에는 새로 실을 저장소가 없습니다.";
const FAILED_TEXT = "이 날에는 GitHub 주간 트렌딩 목록을 받지 못했습니다.";

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const tab = (page: Page, name: string) => tabs(page).getByRole("button", { name, exact: true });
const pressedTab = (page: Page) => tabs(page).locator("button[aria-pressed=true]");
const repoRows = (page: Page) => page.locator("main ol.repos > li");

async function openBuilder(page: Page, date: string): Promise<void> {
  await page.goto(`/${date}`);
  await tab(page, "빌더").click();
  await expect(pressedTab(page)).toHaveText("빌더");
}

test.describe("4.4-1 빌더 탭의 자리와 기억", () => {
  test("기록이 있는 날(세 상태)은 뉴스 탭 뒤 끝에 건수 없는 '빌더' 탭이 있고, 기록이 없는 날은 없다", async ({ page }) => {
    for (const date of [b1.shown, b1.none, b1.failed]) {
      await page.goto(`/${date}`);
      await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...SECTIONS, "빌더"]);
    }
    await page.goto(`/${b1.absent}`);
    await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...dayOf(b1.absent).sections.map((s) => s.name)]);
  });

  test("'전체' 탭에는 저장소가 섞이지 않는다", async ({ page }) => {
    await page.goto(`/${b1.shown}`);
    await tab(page, "전체").click();
    await expect(pressedTab(page)).toHaveText("전체");
    await expect(page.locator("main li[id^=story-]")).toHaveCount(SHOWN.sections.flatMap((s) => s.stories).length);
    await expect(page.locator("main ol.repos")).toHaveCount(0);
    for (const item of ITEMS) await expect(page.locator("main")).not.toContainText(shownName(item.name));
  });

  test("날짜 목록의 뉴스 읽은 수는 저장소를 세지 않는다", async ({ page }) => {
    const stories = SHOWN.sections.flatMap((s) => s.stories);
    await page.goto("/about");
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [READ_MARKS_KEY, JSON.stringify({ v: 1, d: { [b1.shown]: stories.slice(0, 2).map((s) => s.key).sort() } })]);
    await page.goto("/dates");
    await expect(page.locator(`a.row-link[href="/${b1.shown}"] .read-prog`)).toHaveText(`2/${stories.length} 읽음`);
  });

  test("빌더 탭에는 대분류 칩·'안 읽은 것만'·요약·키워드가 없고, 이번 주 일정|지표 상자는 뉴스 탭처럼 접힌 채 있다", async ({ page }) => {
    await page.goto(`/${b1.shown}`);
    await expect(page.locator("main .week-toggle")).toHaveAttribute("aria-expanded", "false");
    await tab(page, "빌더").click();
    await expect(repoRows(page)).toHaveCount(ITEMS.length);
    await expect(page.locator("main .week-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main .headline")).toHaveCount(0);
    await expect(page.locator("main .kw")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "카테고리" })).toHaveCount(0);
    await expect(page.locator("main .chips")).toHaveCount(0);
    await expect(page.getByText("안 읽은 것만")).toHaveCount(0);
  });

  test("빌더 탭을 고르면 주소 해시 없이 기억되고, 새로 고치면 빌더 탭이 다시 열린다", async ({ page }) => {
    await openBuilder(page, b1.shown);
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("빌더");
    await page.reload();
    await expect(pressedTab(page)).toHaveText("빌더");
    await expect(repoRows(page)).toHaveCount(ITEMS.length);
  });

  test("빌더 탭을 고른 뒤 날짜를 옮기면 기록이 있는 날은 빌더 탭, 없는 날은 그날 첫 섹션 탭('전체'가 아니다)이다", async ({ page }) => {
    await openBuilder(page, b1.shown);
    const order = [b1.none, b1.failed, b1.absent];
    expect(b1.dates.slice(1, 4)).toEqual(order);
    for (const date of order) {
      await page.getByRole("link", { name: /^이전 날짜/ }).click();
      await expect(page).toHaveURL(new RegExp(`/${date}$`));
      await expect(pressedTab(page)).toHaveText(date === b1.absent ? dayOf(b1.absent).sections[0]!.name : "빌더");
    }
    await expect(pressedTab(page)).not.toHaveText("전체");
    // 기록 없는 날에서 다른 진입(주소)으로 와도 같다
    await page.goto(`/${b1.absent}`);
    await expect(pressedTab(page)).toHaveText(dayOf(b1.absent).sections[0]!.name);
  });

  test("#builder로 들어오면 그날 빌더 탭이 열리고 고른 탭으로 기억된다. 기록이 없는 날의 #builder는 기본 탭이다", async ({ page }) => {
    for (const url of [`/${b1.shown}#builder`, "/#builder", `/${b1.failed}#builder`]) {
      await page.goto("/about");
      await page.evaluate(() => localStorage.clear());
      await page.goto(url);
      await expect(pressedTab(page)).toHaveText("빌더");
      await expect(page.locator("main h2.repo-head")).toHaveText("GitHub 주간 트렌딩");
      expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("빌더");
    }
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/${b1.absent}#builder`);
    await expect(pressedTab(page)).toHaveText("한국");
    await expect(page.locator("main li[id^=story-]").first()).toBeVisible();
  });

  test("키보드로 빌더 탭을 고를 수 있다", async ({ page }) => {
    await page.goto(`/${b1.shown}`);
    await tab(page, "빌더").focus();
    await page.keyboard.press("Enter");
    await expect(pressedTab(page)).toHaveText("빌더");
    await expect(repoRows(page)).toHaveCount(ITEMS.length);
  });
});

test.describe("4.4-2 저장소 항목과 빈 상태", () => {
  test("항목은 순위 순이고 굵은 제목 아래 아이콘·이름 링크(새 탭, ↗ 없음)·'주간 N위' 배지·늘 보이는 설명이 있다", async ({ page }) => {
    await openBuilder(page, b1.shown);
    await expect(page.locator("main h2.repo-head")).toHaveText("GitHub 주간 트렌딩");
    await expect(repoRows(page).locator("h3")).toHaveText(ITEMS.map((i) => `${shownName(i.name)} (새 탭) 주간 ${i.rank}위`));
    for (const [k, item] of ITEMS.entries()) {
      const row = repoRows(page).nth(k);
      const link = row.getByRole("link", { name: `${shownName(item.name)} (새 탭)` });
      await expect(link).toHaveAttribute("href", item.url);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(row.locator(".repo-rank")).toHaveText(`주간 ${item.rank}위`);
      await expect(row.locator("p.p")).toHaveText(item.description);
      await expect(row.locator("p.p")).toBeVisible();
    }
  });

  test.describe("폰 폭(375px)", () => {
    test.use({ viewport: { width: 375, height: 812 } });
    test("39자 소유자/39자 이름도 가로 스크롤 없이 줄을 바꾸고, 이름 링크의 누를 곳이 44px 이상이다", async ({ page }) => {
      const long = ITEMS.find((i) => i.name.split("/").every((p) => p.length >= 39))!;
      expect(long, "긴 이름이 지어낸 데이터에 있다").toBeTruthy();
      await openBuilder(page, b1.shown);
      await expectNoHorizontalScroll(page, "빌더 탭");
      const box = (await page.getByRole("link", { name: `${shownName(long.name)} (새 탭)` }).boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
      for (const item of ITEMS) {
        const b = (await page.getByRole("link", { name: `${shownName(item.name)} (새 탭)` }).boundingBox())!;
        expect(b.height, item.name).toBeGreaterThanOrEqual(44);
      }
    });

    test("긴 이름도 아이콘이 혼자 한 줄에 남지 않고, 이름은 아이콘 오른쪽에서 시작한다(브라우저 점검 10번)", async ({ page }) => {
      await openBuilder(page, b1.shown);
      for (const item of ITEMS) {
        const heading = repoRows(page).locator(".repo-name").filter({ hasText: shownName(item.name) });
        const icon = (await heading.locator(".repo-icon").boundingBox())!;
        const first = await heading.locator(".repo-link").evaluate((a) => {
          // 테스트 tsconfig에는 DOM 타입이 없어 쓰는 모양만 적는다
          const r = (a as unknown as { getClientRects(): ArrayLike<{ left: number; top: number; bottom: number }> }).getClientRects()[0]!;
          return { left: r.left, top: r.top, bottom: r.bottom };
        });
        expect(first.left, `${item.name}: 이름 첫 줄이 아이콘 오른쪽`).toBeGreaterThanOrEqual(icon.x + icon.width);
        expect(icon.y, `${item.name}: 아이콘이 이름 첫 줄과 같은 줄`).toBeLessThan(first.bottom);
        expect(icon.y + icon.height, `${item.name}: 아이콘이 이름 첫 줄과 같은 줄`).toBeGreaterThan(first.top);
      }
    });
  });

  test("새로 오른 것 없음과 받지 못함은 빈 상태 문구다(이유는 싣지 않는다)", async ({ page }) => {
    for (const [date, text] of [[b1.none, NONE_TEXT], [b1.failed, FAILED_TEXT]] as const) {
      await page.goto(`/${date}#builder`);
      await expect(pressedTab(page)).toHaveText("빌더");
      await expect(page.locator("main p.state.empty")).toHaveText(text);
      await expect(repoRows(page)).toHaveCount(0);
    }
  });
});

test.describe("4.4-3 검색", () => {
  test("저장소 이름과 설명 낱말로 찾고, 결과를 누르면 그 날짜의 빌더 탭이 열린다", async ({ page }) => {
    for (const [q, name] of [["quillnote", "fakeorg/quillnote-desk"], ["가짜깃발도구", ITEMS.find((i) => i.description.startsWith("가짜깃발도구"))!.name]] as const) {
      await page.goto("/about");
      await page.evaluate(() => localStorage.clear());
      await page.goto(`/search?q=${encodeURIComponent(q)}`);
      const section = page.locator("section", { has: page.getByRole("heading", { name: "빌더", exact: true }) });
      const result = section.getByRole("link", { name: new RegExp(name.replace(/[/.]/g, "\\$&")) });
      await expect(result).toHaveCount(1);
      await expect(result).toHaveAttribute("href", `/${b1.shown}#builder`);
      await result.click();
      await expect(page).toHaveURL(new RegExp(`/${b1.shown}#builder$`));
      await expect(pressedTab(page)).toHaveText("빌더");
      await expect(repoRows(page).locator("h3", { hasText: shownName(name) })).toBeVisible();
    }
  });
});
