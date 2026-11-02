// 9.9단계 화면(E2E): 빌더 탭의 세 묶음, 새 제품과 뜨는 저장소 항목, 빈 상태, 검색, 소개, 정정됨. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, monthDay, storyItem, test } from "./base.ts";
import { E2E_BUILDER_BASE_URL, E2E_BUILDER_DATA_DIR, E2E_BUILDER_INFO_FILE } from "./paths.ts";
import type { BuilderFixtureInfo } from "../../site/dev/builderFixtures.ts";
import { BUILDER_NONE, builderNotice, discoverEndNotice, discoverZeroText, repoStarsText, repoUpkeepText } from "../../site/src/lib/builder.ts";
import { READ_MARKS_KEY } from "../../site/src/lib/browserKeys.ts";
import { siteFiles, type BuilderMonth, type DayList, type MonthList, type SiteDiscoveryItem } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_BUILDER_BASE_URL });

const SITE_DATA = path.join(E2E_BUILDER_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const b = JSON.parse(fs.readFileSync(E2E_BUILDER_INFO_FILE, "utf8")) as { [K in keyof BuilderFixtureInfo]: NonNullable<BuilderFixtureInfo[K]> };
const found = (date: string): SiteDiscoveryItem[] => json<BuilderMonth>(siteFiles.builderItems(date.slice(0, 7))).discoveries![date]!;
const dayOf = (date: string): DayList => json<MonthList>(siteFiles.list(date.slice(0, 7))).days.find((d) => d.date === date)!;

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const builderTab = (page: Page, count: number) => tabs(page).getByRole("button", { name: `빌더 ${count}`, exact: true });
const groups = (page: Page) => page.locator("main .bgroup-h");
const group = (page: Page, name: string) => page.locator("main .bgroup").filter({ has: page.locator(".bgroup-h", { hasText: name }) });
const heads = (row: Locator) => row.locator(".detail h4.h");
const field = (row: Locator, label: string) => row.locator(".detail h4.h", { hasText: label }).locator("xpath=following-sibling::*[1]");
const pick = (date: string, key: string) => found(date).find((x) => x.key === key)!;

test.describe("4.5-1 묶음", () => {
  test("세 묶음이 정해진 순서이고 탭 건수는 합이며 묶음마다 항목이 3건이다", async ({ page }) => {
    await page.goto(`/${b.three}#builder`);
    await expect(groups(page)).toHaveText(["도구 변화", "새 제품", "뜨는 저장소"]);
    await expect(builderTab(page, 9)).toHaveAttribute("aria-pressed", "true");
    for (const name of ["도구 변화", "새 제품", "뜨는 저장소"]) await expect(group(page, name).locator(".item")).toHaveCount(3);
  });

  test("한 종류만 있는 날은 그 묶음만 보이고 꺼진 묶음과 거짓 '없다'가 없다", async ({ page }) => {
    await page.goto(`/${b.onlyProduct}#builder`);
    await expect(groups(page)).toHaveText(["새 제품"]);
    await expect(builderTab(page, 1)).toBeVisible();
    await expect(page.locator("main")).not.toContainText("뜨는 저장소를");
    await expect(page.locator("main")).not.toContainText(BUILDER_NONE);
    await expect(page.locator("main .state")).toHaveCount(0);
  });

  test("9.9 이전 날짜는 도구 변화 묶음만 보이고 새 종류의 '없다'를 쓰지 않는다", async ({ page }) => {
    await page.goto(`/${b.none}#builder`);
    await expect(groups(page)).toHaveText(["도구 변화"]);
    await expect(page.locator("main .state")).toHaveCount(1);
    await expect(page.locator("main")).toContainText(BUILDER_NONE);
    await expect(page.locator("main")).not.toContainText(discoverZeroText("product", "checked")!);
  });

  test("꺼짐만 있는 날은 빌더 탭이 없다", async ({ page }) => {
    await page.goto(`/${b.offOnly}`);
    await expect(tabs(page).getByRole("button").first()).toBeVisible();
    await expect(tabs(page).getByRole("button", { name: /^빌더/ })).toHaveCount(0);
  });

  test("'전체' 탭에는 새 항목이 없고 뉴스 건수가 그대로다", async ({ page }) => {
    await page.goto(`/${b.three}`);
    await tabs(page).getByRole("button", { name: "전체", exact: true }).click();
    const day = dayOf(b.three);
    await expect(page.locator("main")).toContainText(day.sections[0]!.stories[0]!.title);
    for (const x of found(b.three)) await expect(page.locator("main")).not.toContainText(x.name);
    await expect(page.locator(`main [id^="story-product-"], main [id^="story-repo-"]`)).toHaveCount(0);
    await expect(page.locator(`main [id^="story-"]`)).toHaveCount(day.sections.flatMap((s) => s.stories).length);
  });
});

test.describe("4.5-2 항목", () => {
  test("새 제품의 칸이 정해진 순서로 나오고 이슈와 출처가 링크로 간다", async ({ page }) => {
    const x = pick(b.three, "product-1");
    await page.goto(`/${b.three}#builder`);
    const row = storyItem(page, x.key);
    await expect(row.locator(".title")).toHaveText(`${x.name} (새 탭)`);
    await expect(heads(row)).toHaveText(["용도", "기존 도구와의 차이", "고른 이유", "관련 이슈", "출처"]);
    await expect(field(row, "용도")).toHaveText(x.purpose);
    await expect(field(row, "기존 도구와의 차이")).toHaveText(x.difference);
    await expect(field(row, "고른 이유")).toHaveText(x.reason);
    await expect(field(row, "관련 이슈").getByRole("link")).toHaveAttribute("href", `/issues/${x.issue!.id}`);
    const link = field(row, "출처").getByRole("link");
    await expect(link).toHaveAttribute("href", x.url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toContainText("Product Hunt");
  });

  test("뜨는 저장소는 라이선스, 관리 상태, 별 수와 증가량이 더해지고 값을 그대로 보인다", async ({ page }) => {
    const x = pick(b.three, "repo-1");
    await page.goto(`/${b.three}#builder`);
    const row = storyItem(page, x.key);
    await expect(heads(row)).toHaveText(["용도", "기존 도구와의 차이", "고른 이유", "라이선스", "관리 상태", "별 수와 증가량", "출처"]);
    await expect(field(row, "라이선스")).toHaveText(x.repo!.license);
    await expect(field(row, "관리 상태")).toHaveText(repoUpkeepText(x.repo!));
    await expect(field(row, "별 수와 증가량")).toHaveText(repoStarsText(x.repo!));
    const link = field(row, "출처").getByRole("link");
    await expect(link).toHaveAttribute("href", `https://github.com/${x.name}`);
    const name = row.getByRole("heading", { name: x.name }).getByRole("link");
    await expect(name).toHaveAttribute("href", x.url);
    await expect(name).toHaveAttribute("target", "_blank");
    await expect(link).toContainText("GitHub");
    await expect(link).toHaveAttribute("target", "_blank");
  });

  test("라이선스 없음과 판별되지 않음을 그렇게 쓰고 경고색으로 칠하지 않는다. 릴리스 없음과 확인 못 함을 구별한다", async ({ page }) => {
    await page.goto(`/${b.three}#builder`);
    const none = storyItem(page, "repo-2");
    const unknown = storyItem(page, "repo-3");
    await expect(field(none, "라이선스")).toHaveText("표시 없음");
    await expect(field(unknown, "라이선스")).toHaveText("파일은 있으나 종류가 판별되지 않음");
    await expect(field(none, "관리 상태")).toContainText("최근 릴리스 없음");
    await expect(field(unknown, "관리 상태")).toContainText("최근 릴리스 확인 못 함");
    const normal = await page.evaluate<string>(`getComputedStyle(document.querySelector('[id="story-repo-1"] .detail .p')).color`);
    await expect(field(none, "라이선스")).toHaveCSS("color", normal);
    await expect(field(unknown, "라이선스")).toHaveCSS("color", normal);
  });

  test("제보 링크는 항목을 가리키고, 읽음을 눌러도 날짜별 읽은 수는 그대로다", async ({ page }) => {
    const x = pick(b.three, "repo-1");
    await page.goto(`/${b.three}#builder`);
    const row = storyItem(page, x.key);
    const report = row.getByRole("link", { name: /틀린 내용 알리기/ });
    expect(decodeURIComponent((await report.getAttribute("href"))!)).toContain(x.name);
    const toggle = row.locator("button.rd-btn");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), READ_MARKS_KEY)).toContain(x.key);
    await page.goto("/dates");
    const line = page.locator("main").getByRole("link", { name: new RegExp(monthDay(b.three)) });
    await expect(line).toBeVisible();
    await expect(line.locator("xpath=ancestor::li[1]")).not.toContainText("읽음");
  });

  test("#repo-N 주소로 오면 탭이 열리고 그 항목이 보이며 읽음이 된다", async ({ page }) => {
    await page.goto(`/${b.three}#repo-3`);
    await expect(storyItem(page, "repo-3")).toBeInViewport();
    await expect(storyItem(page, "repo-3").locator("button.rd-btn")).toHaveAttribute("aria-pressed", "true");
    await expect(storyItem(page, "repo-2").locator("button.rd-btn")).toHaveAttribute("aria-pressed", "false");
  });

  test("정정한 항목에 '정정됨'과 사유가 있고 다른 항목에는 없다", async ({ page }) => {
    const x = pick(b.three, "product-2");
    await page.goto(`/${b.three}#builder`);
    const fix = x.corrections![0]!;
    await expect(storyItem(page, x.key).locator(".fix-mark")).toHaveText(`정정됨 · ${monthDay(fix.on)}`);
    await expect(storyItem(page, x.key).locator(".detail")).toContainText(fix.reason);
    await expect(storyItem(page, "repo-1").locator(".fix-mark")).toHaveCount(1);
    await expect(page.locator("main .fix-mark")).toHaveCount(2);
  });
});

test.describe("4.5-3 빈 상태", () => {
  test("확인함 0건은 묶음마다 없다는 문구다", async ({ page }) => {
    await page.goto(`/${b.allNone}#builder`);
    await expect(builderTab(page, 0)).toBeVisible();
    await expect(group(page, "도구 변화").locator(".state")).toHaveText(BUILDER_NONE);
    await expect(group(page, "새 제품").locator(".state")).toHaveText(discoverZeroText("product", "checked")!);
    await expect(group(page, "뜨는 저장소").locator(".state")).toHaveText(discoverZeroText("repo", "checked")!);
  });

  test("받지 못함 0건은 묶음마다 받지 못했다는 문구다", async ({ page }) => {
    await page.goto(`/${b.allFailed}#builder`);
    await expect(group(page, "도구 변화").locator(".state.error p")).toHaveText(builderNotice("failed")!);
    await expect(group(page, "새 제품").locator(".state.error p")).toHaveText(discoverZeroText("product", "failed")!);
    await expect(group(page, "뜨는 저장소").locator(".state.error p")).toHaveText(discoverZeroText("repo", "failed")!);
  });

  test("기준값 쌓는 중은 저장소 문구이고, 받지 못했는데 항목이 있으면 목록 끝에 안내가 있다", async ({ page }) => {
    await page.goto(`/${b.mixed}#builder`);
    await expect(group(page, "뜨는 저장소").locator(".state")).toHaveText(discoverZeroText("repo", "baseline")!);
    await expect(group(page, "새 제품").locator(".item")).toHaveCount(1);
    await expect(group(page, "새 제품").locator("p.note")).toHaveText(discoverEndNotice("product", "failed")!);
  });

  test("0건인 날은 항목 파일을 받지 않는다", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("builder-items-")) asked.push(r.url());
    });
    await page.goto(`/${b.allNone}#builder`);
    await expect(group(page, "새 제품").locator(".state")).toBeVisible();
    expect(asked).toEqual([]);
  });
});

test.describe("4.5-4 검색", () => {
  test("검색 결과를 누르면 그 브리프의 빌더 탭의 항목으로 간다", async ({ page }) => {
    const x = pick(b.three, "product-1");
    await page.goto("/search");
    const input = page.getByRole("searchbox", { name: "검색어" });
    await input.fill("가짜회의록지어낸용도는");
    await input.press("Enter");
    const region = page.getByRole("region", { name: "빌더" });
    const result = region.getByRole("link", { name: new RegExp(x.name) });
    await expect(result).toBeVisible();
    await expect(result).toContainText("새 제품");
    await result.click();
    await expect(page).toHaveURL(`/${b.three}#${x.key}`);
    await expect(storyItem(page, x.key)).toBeInViewport();
    await expect(builderTab(page, 9)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("4.5-6 소개", () => {
  test("고르는 방법, 보증이 아니라는 것, 건수, 출처 표기가 있다", async ({ page }) => {
    await page.goto("/about#builder");
    const main = page.locator("main");
    for (const s of ["하루 증가량이 큰 저장소", "GitHub Trending과는 기준이 달라", "AI가 쓴 것이고 추천이나 보증이 아니다", "종류마다 하루 0~3건이고 건수를 채우지 않는다"]) await expect(main).toContainText(s);
    await expect(main.getByRole("link", { name: /^Product Hunt API/ })).toHaveAttribute("href", "https://api.producthunt.com/v2/docs");
    await expect(main.getByRole("link", { name: /^GitHub API/ })).toHaveAttribute("href", "https://docs.github.com/en/rest");
  });
});

test.describe("4.5-7 좁은 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("이름 링크는 누르는 높이가 44px 이상이다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/${b.three}#builder`);
    const box = await page.locator(".bname-l").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test("긴 글과 긴 owner/name에서도 가로 스크롤이 없고 이름이 줄바꿈된다", async ({ page }) => {
    await page.goto(`/${b.longKinds}#builder`);
    await expect(page.locator("main .item")).toHaveCount(10);
    await expect(builderTab(page, 10)).toBeVisible();
    await expectNoHorizontalScroll(page, "375px");
    const name = found(b.longKinds).find((x) => x.kind === "repo")!;
    const title = storyItem(page, name.key).locator(".title");
    await expect(title).toHaveText(`${name.name} (새 탭)`);
    const box = (await title.getByRole("link").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    expect(box.height).toBeGreaterThan(60);
    await page.setViewportSize({ width: 320, height: 640 });
    await expectNoHorizontalScroll(page, "320px");
  });
});

test.describe("JS 없는 묶음", () => {
  test.use({ javaScriptEnabled: false });
  test("앱과 같은 소제목과 상태 문구를 보이고 꺼진 묶음이 없다", async ({ page }) => {
    await page.goto(`/${b.allFailed}`);
    await expect(page.locator(".bgroup-h").first()).toHaveCSS("font-size", "15px");
    await expect(groups(page)).toHaveText(["도구 변화", "새 제품", "뜨는 저장소"]);
    await expect(page.locator(".state.error p").nth(2)).toHaveText(discoverZeroText("repo", "failed")!);
    await page.goto(`/${b.onlyProduct}`);
    await expect(groups(page)).toHaveText(["새 제품"]);
  });
});

// 아래 탭이 전체 페이지 사진을 가리지 않게 탭을 흐름에 둔다
const UNSTICK_TABS = ".tabs { position: static; }";

for (const scheme of ["light", "dark"] as const) {
  for (const width of [375, 1440]) {
    test.describe(`새 묶음 화면 ${scheme} ${width}`, () => {
      test.use({ viewport: { width, height: 900 }, colorScheme: scheme });
      const shots: [string, string, string][] = [
        ["세 종류", b.three, ".blist"],
        ["한 종류", b.onlyProduct, ".blist"],
        ["긴 글", b.longKinds, ".blist"],
        ["모두 0건", b.allNone, ".state"],
        ["모두 못 받음", b.allFailed, ".state"],
        ["섞인 상태", b.mixed, ".state"],
      ];
      for (const [name, date, ready] of shots) {
        test(name, async ({ page }) => {
          await page.clock.setFixedTime(new Date(`${date}T09:00:00+09:00`));
          await page.goto(`/${date}#builder`);
          await expect(page.locator(ready).first()).toBeVisible();
          await page.addStyleTag({ content: UNSTICK_TABS });
          await expect(page).toHaveScreenshot(`discover-${scheme}-${name}-${width}.png`, { animations: "disabled", fullPage: true });
        });
      }
    });
  }
}
