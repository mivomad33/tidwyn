// 시각 회귀(B2 4.3-5): 영상 탭의 세 상태(실음·새 영상 없음·받지 못함)를 폭마다 찍는다. 썸네일은 테스트용 로컬 이미지다.
// 영상 기록이 있는 지어낸 데이터로 따로 빌드한 사이트(prepare.ts의 b2-out)를 본다. 브라우저 시계는 base.ts가 끝 날짜 낮에 고정한다.
import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./base.ts";
import { E2E_B2_BASE_URL, E2E_B2_INFO_FILE } from "./paths.ts";
import { routeThumbs } from "./thumbs.ts";

test.use({ baseURL: E2E_B2_BASE_URL });

const b2 = JSON.parse(fs.readFileSync(E2E_B2_INFO_FILE, "utf8")) as { shown: string; none: string; failed: string };
const STATES: [string, string][] = [
  ["실음", b2.shown],
  ["새 영상 없음", b2.none],
  ["받지 못함", b2.failed],
];

async function open(page: Page, date: string): Promise<void> {
  await routeThumbs(page);
  await page.goto(`/${date}#videos`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText("영상");
  await expect(page.locator("main ol.videos, main p.state.empty")).toHaveCount(1);
  await expect(page.locator("main [role=status]")).toHaveCount(0);
  // 늦게 받는 썸네일을 모두 받은 뒤 찍는다
  await page.evaluate(async () => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ loading: string; decode(): Promise<void> }> } }).document;
    const imgs = Array.from(doc.querySelectorAll("main img"));
    for (const i of imgs) i.loading = "eager";
    await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
  });
}

for (const width of [375, 1280]) {
  test.describe(`B2 영상 탭 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const [name, date] of STATES) {
      test(name, async ({ page }) => {
        await open(page, date);
        await expect(page).toHaveScreenshot(`b2-영상-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
  });
}
