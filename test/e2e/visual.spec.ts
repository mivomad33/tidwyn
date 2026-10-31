// 시각 회귀(design-check): 9.5단계 화면을 폭마다 찍어 기준 이미지와 비교한다. 지어낸 데이터만 쓰고, 시각은 고정한다.
import { expect, info, test } from "./base.ts";

const latest = info.dates[0]!;
const FIXED_NOW = new Date(`${latest}T09:00:00+09:00`);

for (const width of [375, 1280]) {
  test.describe(`화면 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const [name, url] of [["브리프", `/${latest}`], ["소개", "/about"], ["처리방침", "/privacy"], ["없는 페이지", "/nope"]] as const) {
      test(`앱 ${name}`, async ({ page }) => {
        await page.clock.setFixedTime(FIXED_NOW);
        await page.goto(url);
        await expect(page.locator("main#main")).toBeVisible();
        await expect(page).toHaveScreenshot(`app-${name}-${width}.png`, { animations: "disabled" });
      });
    }
  });

  test.describe(`자바스크립트 끈 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 800 }, javaScriptEnabled: false });

    for (const [name, url] of [["브리프", `/${latest}`], ["날짜", "/dates"], ["용어", "/terms"], ["지표", "/indicators"], ["없는 페이지", "/nope"], ["앱 전용", "/search"]] as const) {
      test(`정적 ${name}`, async ({ page }) => {
        await page.goto(url);
        await expect(page).toHaveScreenshot(`static-${name}-${width}.png`, { animations: "disabled" });
      });
    }
  });
}
