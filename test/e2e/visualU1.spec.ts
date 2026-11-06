// 시각 회귀(U1 design-check): 사이트 전체 정리로 모양이 바뀐 화면 중 visual.spec.ts·단계별 스냅샷에 없던 것을 폭마다 찍는다.
// 일정·지표가 있는 지어낸 데이터(indicator-data/)로 사이트 데이터 요청을 바꾸고(base.ts의 useIndicatorData, stage6.spec.ts와 같다), 시계는 가장 최근 브리프의 다음 날 낮에 고정한다.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test, useIndicatorData } from "./base.ts";
import { E2E_INDICATOR_INFO_FILE } from "./paths.ts";

const iinfo = JSON.parse(fs.readFileSync(E2E_INDICATOR_INFO_FILE, "utf8")) as { dates: string[]; mostRelated: { id: string }; issueThree: number };
const LATEST = iinfo.dates[0]!;
const FIXED_NOW = new Date("2026-10-28T12:00:00+09:00");

/** [이름, 주소, 찍기 전 조작(카드 펼치기, 달력 보기)] */
type Act = "expand" | "calendar" | null;
const SCREENS: [string, string, Act][] = [
  ["펼친 카드", `/${LATEST}`, "expand"],
  ["일정 달력", "/schedules", "calendar"],
  ["일정 목록", "/schedules?view=list", null],
  ["이슈 목록", "/issues", null],
  ["이슈", `/issues/${iinfo.issueThree}`, null],
  ["용어", "/terms", null],
  ["인물 목록", "/entities", null],
  ["인물", "/entities/1", null],
  ["지표 목록", "/indicators", null],
  ["지표", `/indicators/${iinfo.mostRelated.id}`, null],
];

async function open(page: Page, url: string, act: Act): Promise<void> {
  await page.clock.setFixedTime(FIXED_NOW);
  await useIndicatorData(page);
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main#main")).toBeVisible();
  await expect(page.locator("main [role=status]")).toHaveCount(0);
  if (act === "expand") {
    // 뉴스 줄의 펼침 단추(상자 접기 단추가 아니다)
    const row = page.locator("main button.item-btn").first();
    await row.click();
    await expect(row).toHaveAttribute("aria-expanded", "true");
  }
  if (act === "calendar") {
    await page.getByRole("button", { name: "달력", exact: true }).click();
    await expect(page.locator("main .cal").first()).toBeVisible();
  }
}

for (const width of [375, 1280]) {
  test.describe(`U1 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const [name, url, act] of SCREENS) {
      test(name, async ({ page }) => {
        await open(page, url, act);
        await expect(page).toHaveScreenshot(`u1-${name}-${width}.png`, { animations: "disabled" });
      });
    }
  });

  test.describe(`U1 다크 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, colorScheme: "dark" });

    for (const [name, url, act] of SCREENS.filter(([n]) => n === "펼친 카드" || n === "일정 달력")) {
      test(name, async ({ page }) => {
        await open(page, url, act);
        await expect(page).toHaveScreenshot(`u1-dark-${name}-${width}.png`, { animations: "disabled" });
      });
    }
  });
}
