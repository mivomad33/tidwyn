// 시각 회귀(B1 4.4-5): 빌더 탭의 세 상태(실음·새로 오른 것 없음·받지 못함)를 폭마다 찍는다.
// 저장소 기록이 있는 지어낸 데이터로 따로 빌드한 사이트(prepare.ts의 b1-out)를 본다. 브라우저 시계는 base.ts가 끝 날짜 낮에 고정한다.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./base.ts";
import { E2E_B1_BASE_URL, E2E_B1_INFO_FILE } from "./paths.ts";

test.use({ baseURL: E2E_B1_BASE_URL });

const b1 = JSON.parse(fs.readFileSync(E2E_B1_INFO_FILE, "utf8")) as { shown: string; none: string; failed: string };
const STATES: [string, string][] = [
  ["실음", b1.shown],
  ["새로 오른 것 없음", b1.none],
  ["받지 못함", b1.failed],
];

async function open(page: Page, date: string): Promise<void> {
  await page.goto(`/${date}#builder`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText("빌더");
  await expect(page.locator("main ol.repos, main p.state.empty")).toHaveCount(1);
  await expect(page.locator("main [role=status]")).toHaveCount(0);
}

for (const width of [375, 1280]) {
  test.describe(`B1 빌더 탭 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const [name, date] of STATES) {
      test(name, async ({ page }) => {
        await open(page, date);
        await expect(page).toHaveScreenshot(`b1-빌더-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
  });
}
