// 9.8단계 화면(E2E): 빌더 탭, 항목, 빈 상태, 검색, 대기·오류, 소개, 일정에서 항목으로 가기, 정정됨. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
// 빌더가 있는 사이트를 따로 빌드해 다른 포트로 띄운다.
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page, Route } from "@playwright/test";
import { READY_STATE, UNSTICK_TABS, dataFile, expect, expectNoHorizontalScroll, failData, monthDay, storyItem, test } from "./base.ts";
import { E2E_BUILDER_BASE_URL, E2E_BUILDER_DATA_DIR, E2E_BUILDER_INFO_FILE } from "./paths.ts";
import type { BuilderFixtureInfo } from "../../site/dev/builderFixtures.ts";
import { BUILDER_NONE, builderDueText, builderEndNotice, builderNotice } from "../../site/src/lib/builder.ts";
import { BRIEF_TAB_KEY, READ_MARKS_KEY } from "../../site/src/lib/browserKeys.ts";
import { yearOf } from "../../site/src/lib/format.ts";
import { siteFiles, type BuilderMonth, type DayList, type MonthList, type SiteBuilderItem } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_BUILDER_BASE_URL });

const SITE_DATA = path.join(E2E_BUILDER_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const b = JSON.parse(fs.readFileSync(E2E_BUILDER_INFO_FILE, "utf8")) as { [K in keyof BuilderFixtureInfo]: NonNullable<BuilderFixtureInfo[K]> };
const itemsOf = (date: string): SiteBuilderItem[] => json<BuilderMonth>(siteFiles.builderItems(date.slice(0, 7))).days[date]!;
const dayOf = (date: string): DayList => json<MonthList>(siteFiles.list(date.slice(0, 7))).days.find((d) => d.date === date)!;
const monthFile = (date: string) => siteFiles.builderItems(date.slice(0, 7));

const [first, second, third, fourth] = itemsOf(b.four) as [SiteBuilderItem, SiteBuilderItem, SiteBuilderItem, SiteBuilderItem];
const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const builderTab = (page: Page, count: number) => tabs(page).getByRole("button", { name: `빌더 ${count}`, exact: true });
const rows = (page: Page) => page.locator("main .item:has(.detail h4)");
const heads = (row: Locator) => row.locator(".detail h4.h");
const field = (row: Locator, label: string) => row.locator(".detail h4.h", { hasText: label }).locator("xpath=following-sibling::*[1]");

test.describe("4.6-1 탭", () => {
  test("영상 다음에 건수와 함께 있고, 눌러 고른 탭은 새로 고쳐도 그 탭이다", async ({ page }) => {
    await page.goto(`/${b.four}`);
    await expect(tabs(page).getByRole("button").last()).toHaveText("빌더 4");
    await builderTab(page, 4).click();
    await expect(rows(page)).toHaveCount(4);
    await page.reload();
    await expect(rows(page)).toHaveCount(4);
    await expect(builderTab(page, 4)).toHaveAttribute("aria-pressed", "true");
  });

  test("해시로 직접 들어가고 새로 고쳐도 그 탭이다", async ({ page }) => {
    await page.goto(`/${b.one}#builder`);
    await expect(rows(page)).toHaveCount(1);
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
  });

  test("고른 탭이 기억돼 다른 날에도 열린다", async ({ page }) => {
    await page.goto(`/${b.one}`);
    await builderTab(page, 1).click();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("빌더");
    await page.goto(`/${b.four}`);
    await expect(rows(page)).toHaveCount(4);
  });

  test("기록이 없는 날은 탭이 없고, 기억된 탭이 빌더면 기본 탭으로 간다", async ({ page }) => {
    await page.goto("/about");
    await page.evaluate((k) => localStorage.setItem(k, "빌더"), BRIEF_TAB_KEY);
    await page.goto(`/${b.noRecord}`);
    const day = dayOf(b.noRecord);
    await expect(tabs(page).getByRole("button", { name: /^빌더/ })).toHaveCount(0);
    await expect(page.locator("main")).toContainText(day.sections[0]!.stories[0]!.title);
    await expect(tabs(page).getByRole("button", { name: day.sections[0]!.name, exact: true })).toHaveAttribute("aria-pressed", "true");
  });

  test("'전체' 탭에는 빌더 제목이 없고 뉴스 건수가 그대로다", async ({ page }) => {
    await page.goto(`/${b.four}`);
    await tabs(page).getByRole("button", { name: "전체", exact: true }).click();
    const day = dayOf(b.four);
    await expect(page.locator("main")).toContainText(day.sections[0]!.stories[0]!.title);
    for (const x of itemsOf(b.four)) await expect(page.locator("main")).not.toContainText(x.title);
    const n = day.sections.flatMap((s) => s.stories).length;
    await expect(page.locator(`main [id^="story-"]:not([id^="story-builder-"])`)).toHaveCount(n);
    await expect(page.locator(`main [id^="story-builder-"]`)).toHaveCount(0);
  });
});

test.describe("4.6-2 항목", () => {
  test("칸이 정해진 순서로 나오고, 확정 기한은 일정으로, 이슈와 출처는 링크로 간다", async ({ page }) => {
    await page.goto(`/${b.four}#builder`);
    const row = storyItem(page, first.key);
    await expect(row.locator(".cat")).toHaveText(first.field);
    await expect(row.locator(".title")).toHaveText(first.title);
    await expect(heads(row)).toHaveText(["무엇이 바뀌었나", "누가 영향받나", "지금 할 일", "기한", "고른 이유", "관련 이슈", "출처"]);
    await expect(field(row, "무엇이 바뀌었나")).toHaveText(first.whatChanged);
    await expect(field(row, "누가 영향받나")).toHaveText(first.who);
    await expect(field(row, "지금 할 일")).toHaveText(first.action);
    await expect(field(row, "고른 이유")).toHaveText(first.why);
    const due = field(row, "기한").getByRole("link");
    await expect(due).toHaveText(builderDueText(first.due!, yearOf(b.four)));
    await expect(due).toContainText("확정");
    await expect(due).toHaveAttribute("href", `/schedules/${first.schedule}`);
    await expect(field(row, "관련 이슈").getByRole("link")).toHaveAttribute("href", `/issues/${first.issue!.id}`);
    const links = field(row, "출처").getByRole("link");
    await expect(links).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      await expect(links.nth(i)).toHaveAttribute("href", first.sources[i]!.url);
      await expect(links.nth(i)).toHaveAttribute("target", "_blank");
    }
  });

  test("잠정 기한은 글자만이고, 이슈가 없으면 그 칸이 없고, 기한이 없으면 '없음'이다", async ({ page }) => {
    await page.goto(`/${b.four}#builder`);
    const row = storyItem(page, second.key);
    await expect(field(row, "기한")).toHaveText(builderDueText(second.due!, yearOf(b.four)));
    await expect(field(row, "기한")).toContainText("잠정");
    await expect(field(row, "기한").getByRole("link")).toHaveCount(0);
    await expect(heads(row).filter({ hasText: "관련 이슈" })).toHaveCount(0);
    await expect(field(storyItem(page, third.key), "기한")).toHaveText("없음");
    await expect(field(storyItem(page, fourth.key), "기한")).toContainText("잠정");
  });

  test("다시 알림은 표시되고 원래 날짜를 보이며 원래 항목으로 간다", async ({ page }) => {
    await page.goto(`/${b.one}#builder`);
    const [x] = itemsOf(b.one) as [SiteBuilderItem];
    const mark = storyItem(page, x.key).locator(".breminder");
    await expect(mark).toHaveText(`다시 알림 · ${monthDay(x.reminderOf!.date)}에 처음 실렸다`);
    await mark.click();
    await expect(page).toHaveURL(`/${x.reminderOf!.date}#${x.reminderOf!.key}`);
    await expect(storyItem(page, x.reminderOf!.key)).toBeInViewport();
    await expect(storyItem(page, x.reminderOf!.key)).toBeFocused();
    await expect(storyItem(page, x.reminderOf!.key).locator(".breminder")).toHaveCount(0);
  });

  test("항목 제목은 h3이고 다 확인하지 못한 날의 문구는 글자색이다", async ({ page }) => {
    await page.goto(`/${b.four}#builder`);
    await expect(page.locator("main h3").first()).toHaveText((itemsOf(b.four)[0] as SiteBuilderItem).title);
    await page.goto(`/${b.none}#builder`);
    await expect(page.locator(".state.empty")).toHaveText(BUILDER_NONE);
    await page.goto(`/${b.failed}#builder`);
    await expect(page.locator(".state.error p")).toHaveText(builderNotice("failed")!);
    const fg = await page.evaluate<string>(`(() => {
      const probe = document.createElement("i");
      probe.style.color = "var(--fg)";
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    })()`);
    await expect(page.locator(".state.error p")).toHaveCSS("color", fg);
  });

  test("탭 위에 빌더가 무엇인지 한 줄로 보이고 소개의 빌더 절로 간다", async ({ page }) => {
    for (const date of [b.four, b.none]) {
      await page.goto(`/${date}#builder`);
      await expect(page.locator("main")).toContainText("바뀐 점을 모았다");
    }
    await page.locator("main").getByRole("link", { name: "빌더 탭 소개" }).click();
    await expect(page).toHaveURL("/about#builder");
    await expect(page.locator("#builder")).toBeFocused();
    const header = (await page.locator("header").first().boundingBox())!;
    const headerBottom = header.y + header.height;
    const title = page.locator("main").getByRole("heading", { name: "빌더 탭" });
    expect((await title.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom);
    await expect(page.locator("main")).toContainText("잠정은 아직 바뀔 수 있는 날짜");
  });

  test("제보 링크는 항목을 가리키고, 읽음을 눌러도 날짜별 읽은 수는 그대로다", async ({ page }) => {
    await page.goto(`/${b.four}#builder`);
    const row = storyItem(page, first.key);
    const report = row.getByRole("link", { name: /틀린 내용 알리기/ });
    await expect(report).toHaveAttribute("href", /^mailto:mivomad33@gmail\.com\?/);
    expect(decodeURIComponent((await report.getAttribute("href"))!)).toContain(first.title);
    const toggle = row.locator("button.rd-btn");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(row.locator(".title.read, .title .read")).toHaveCount(1);
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), READ_MARKS_KEY)).toContain(first.key);
    await page.reload();
    await expect(storyItem(page, first.key).locator("button.rd-btn")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/dates");
    const line = page.locator("main").getByRole("link", { name: new RegExp(monthDay(b.four)) });
    await expect(line).toBeVisible();
    await expect(line).not.toContainText("읽음");
    await expect(line.locator("xpath=ancestor::li[1]")).not.toContainText("읽음");
  });

  test("#builder-N 주소로 오면 탭이 열리고 그 항목이 보이며 읽음이 된다", async ({ page }) => {
    await page.goto(`/${b.four}#${fourth.key}`);
    await expect(storyItem(page, fourth.key)).toBeInViewport();
    await expect(storyItem(page, fourth.key).locator("button.rd-btn")).toHaveAttribute("aria-pressed", "true");
    await expect(storyItem(page, first.key).locator("button.rd-btn")).toHaveAttribute("aria-pressed", "false");
  });
});

test.describe("4.6-3 빈 상태", () => {
  const empty = (page: Page) => page.locator("main");

  test("확인함·0건은 없다는 문구다", async ({ page }) => {
    await page.goto(`/${b.none}#builder`);
    await expect(builderTab(page, 0)).toBeVisible();
    await expect(empty(page)).toContainText(BUILDER_NONE);
  });

  test("일부만 확인·0건은 일부 소스를 받지 못했다는 문구다", async ({ page }) => {
    await page.goto(`/${b.partial}#builder`);
    await expect(empty(page)).toContainText(builderNotice("partial")!);
    await expect(empty(page)).not.toContainText(BUILDER_NONE);
  });

  test("받지 못함·0건은 받지 못했다는 문구다", async ({ page }) => {
    await page.goto(`/${b.failed}#builder`);
    await expect(empty(page)).toContainText(builderNotice("failed")!);
    await expect(empty(page)).not.toContainText(BUILDER_NONE);
  });

  test("일부만 확인이고 항목이 있으면 목록 끝에 안내가 있다", async ({ page }) => {
    await page.goto(`/${b.partialItems}#builder`);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator("ul.list + p.note, .list ~ p.note")).toHaveText(builderNotice("partial")!);
  });

  test("받지 못함이고 항목이 있으면 목록 끝에 안내가 있다", async ({ page }) => {
    await page.goto(`/${b.failedItems}#builder`);
    await expect(rows(page)).toHaveCount(1);
    await expect(page.locator("ul.list + p.note, .list ~ p.note")).toHaveText(builderEndNotice("failed")!);
  });

  test("0건인 날은 항목 파일을 받지 않는다", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("builder-items-")) asked.push(r.url());
    });
    await page.goto(`/${b.none}#builder`);
    await expect(empty(page)).toContainText(BUILDER_NONE);
    expect(asked).toEqual([]);
  });
});

test.describe("4.6-4 검색", () => {
  test("검색 결과를 누르면 그 브리프의 빌더 탭의 항목으로 간다", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByRole("searchbox", { name: "검색어" });
    await input.fill("가짜호스팅이");
    await input.press("Enter");
    const result = page.getByRole("region", { name: "빌더" }).getByRole("link", { name: new RegExp(fourth.title) });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(`/${b.four}#${fourth.key}`);
    await expect(storyItem(page, fourth.key)).toBeInViewport();
    await expect(builderTab(page, 4)).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("4.6-6 대기와 오류", () => {
  test("응답이 늦으면 대기 표시가 나온 뒤 항목이 보인다", async ({ page }) => {
    let release = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route(dataFile(monthFile(b.four)), async (route: Route) => {
      await gate;
      await route.fallback();
    });
    await page.goto(`/${b.four}#builder`);
    await expect(page.locator("main").getByRole("status")).toBeVisible();
    await expect(page.locator("main")).toContainText("바뀐 점을 모았다");
    await expect(rows(page)).toHaveCount(0);
    release();
    await expect(rows(page)).toHaveCount(4);
  });

  test("받지 못하면 오류와 다시 시도가 나오고, 다시 시도로 항목이 보인다", async ({ page }) => {
    await failData(page, monthFile(b.four));
    await page.goto(`/${b.four}#builder`);
    const again = page.getByRole("button", { name: "다시 시도" });
    await expect(again).toBeVisible();
    await expect(page.locator("main")).toContainText("바뀐 점을 모았다");
    await page.unroute(dataFile(monthFile(b.four)));
    await again.click();
    await expect(rows(page)).toHaveCount(4);
  });
});

test.describe("4.6-7 소개", () => {
  test("빌더 탭 절의 문구와 출처 링크가 있고, 일정 출처가 '뉴스와 공식 문서'다", async ({ page }) => {
    await page.goto("/about#builder");
    await expect(page.getByRole("heading", { level: 2, name: "빌더 탭" })).toBeInViewport();
    const main = page.locator("main");
    await expect(main).toContainText("글은 AI가 쓴 것이라");
    await expect(main).toContainText("공식 출처 링크");
    await expect(main).toContainText("건수를 채우지 않아");
    await expect(main).toContainText("CISA가 이 사이트나 글을 보증하는 것은 아니다");
    await expect(main).toContainText("일정도 AI가 뉴스와 공식 문서에서 뽑은 것이라");
    for (const [name, href] of [
      ["GitHub Advisory Database", "https://github.com/advisories"],
      ["Gemini API 문서", "https://ai.google.dev/gemini-api/docs"],
      ["React", "https://react.dev/"],
      ["Node.js", "https://nodejs.org/"],
      ["Cloudflare 문서", "https://developers.cloudflare.com/"],
      ["CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"],
      ["Known Exploited Vulnerabilities Catalog", "https://www.cisa.gov/known-exploited-vulnerabilities-catalog"],
    ] as const) {
      await expect(main.getByRole("link", { name: new RegExp(`^${name.replace(".", "\\.")}`) })).toHaveAttribute("href", href);
    }
  });

  test("일정 화면의 출처 문구도 같다", async ({ page }) => {
    await page.goto("/schedules");
    await expect(page.locator("main")).toContainText("뉴스와 공식 문서에서 모은 예정 일정");
  });
});

test.describe("4.4-2 일정에서 항목으로", () => {
  test("이슈와 근거 뉴스가 없는 일정의 페이지에서 빌더 항목으로 간다", async ({ page }) => {
    await page.goto(`/schedules/${b.schedule.id}`);
    await expect(page.locator("main")).toContainText(b.schedule.name);
    await page.locator("main").getByRole("link", { name: b.schedule.name }).first().click();
    await expect(page).toHaveURL(`/${b.schedule.date}#${b.schedule.key}`);
    await expect(storyItem(page, b.schedule.key)).toBeInViewport();
    await expect(storyItem(page, b.schedule.key).locator(".title")).toHaveText(first.title);
  });
});

test.describe("4.5-2 정정 표시", () => {
  test("정정한 항목에 뉴스와 같은 '정정됨'과 사유가 있고, 다른 항목에는 없다", async ({ page }) => {
    await page.goto(`/${b.four}#builder`);
    const row = storyItem(page, third.key);
    const fix = third.corrections![0]!;
    await expect(row.locator(".fix-mark")).toHaveText(`정정됨 · ${monthDay(fix.on)}`);
    await expect(row.locator(".detail")).toContainText(fix.reason);
    await expect(page.locator("main .fix-mark")).toHaveCount(1);
  });
});

async function expectTabsOneLine(page: Page): Promise<void> {
  const buttons = tabs(page).getByRole("button");
  await expect(buttons).toHaveCount(6);
  const boxes = await Promise.all((await buttons.all()).map((x) => x.boundingBox()));
  const width = page.viewportSize()!.width;
  for (const box of boxes) {
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.height).toBeLessThanOrEqual(46);
  }
}

test.describe("375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("긴 글과 탭 여섯 개에서도 가로 스크롤이 없고 탭이 한 줄이며, 혼자 있는 링크는 44px이다", async ({ page }) => {
    await page.goto(`/${b.long}#builder`);
    await expect(rows(page)).toHaveCount(4);
    await expectNoHorizontalScroll(page, "긴 글");
    await expectTabsOneLine(page);
    await page.goto(`/${b.one}#builder`);
    const reminder = await storyItem(page, itemsOf(b.one)[0]!.key).locator(".breminder").boundingBox();
    expect(reminder!.height).toBeGreaterThanOrEqual(44);
    await page.goto(`/${b.four}#builder`);
    const due = await field(storyItem(page, first.key), "기한").getByRole("link").boundingBox();
    expect(due!.height).toBeGreaterThanOrEqual(44);
  });

  test("320px에서도 탭 여섯 개가 한 줄에 들어간다", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/${b.long}#builder`);
    await expect(rows(page)).toHaveCount(4);
    await expectNoHorizontalScroll(page, "320px");
    await expectTabsOneLine(page);
  });
});

// 디자인 점검의 화면 × 상태 × 폭(`docs/design.md`의 '빌더 항목')
for (const width of [375, 1440]) {
  test.describe(`빌더 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const shots: [string, string, string][] = [
      ["4건", b.four!, ".blist"],
      ["1건 다시 알림", b.one!, ".blist"],
      ["긴 글", b.long!, ".blist"],
      ["0건 확인함", b.none!, READY_STATE],
      ["0건 일부", b.partial!, READY_STATE],
      ["0건 못 받음", b.failed!, READY_STATE],
      ["항목과 끝 안내", b.partialItems!, ".blist"],
      ["다시 알림과 끝 안내", b.failedItems!, ".blist"],
    ];
    for (const [name, date, ready] of shots) {
      test(name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${date}T09:00:00+09:00`));
        await page.goto(`/${date}#builder`);
        await expect(page.locator(ready).first()).toBeVisible();
        await page.addStyleTag({ content: UNSTICK_TABS });
        await expect(page).toHaveScreenshot(`builder-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
  });
}

test.describe("JS 없는 빌더 절", () => {
  test.use({ javaScriptEnabled: false });
  test("앱과 같은 안내와 상태 문구를 보인다", async ({ page }) => {
    await page.goto(`/${b.failed}`);
    await expect(page.locator(".state.error p")).toHaveText(builderNotice("failed")!);
    await expect(page.getByRole("link", { name: "빌더 탭 소개" })).toHaveAttribute("href", /\/about#builder$/);
    await page.goto(`/${b.partial}`);
    await expect(page.locator(".state.error p")).toHaveText(builderNotice("partial")!);
    await page.goto(`/${b.none}`);
    await expect(page.locator(".state.empty")).toContainText(BUILDER_NONE);
  });
});

for (const width of [375, 1440]) {
  test.describe(`빌더 화면 다크 ${width}`, () => {
    test.use({ viewport: { width, height: 900 }, colorScheme: "dark" });
    const shots: [string, string, string][] = [
      ["4건", b.four!, ".blist"],
      ["다시 알림과 끝 안내", b.failedItems!, ".blist"],
      ["0건 확인함", b.none!, READY_STATE],
      ["0건 일부", b.partial!, READY_STATE],
      ["0건 못 받음", b.failed!, READY_STATE],
    ];
    for (const [name, date, ready] of shots) {
      test(name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${date}T09:00:00+09:00`));
        await page.goto(`/${date}#builder`);
        await expect(page.locator(ready).first()).toBeVisible();
        await page.addStyleTag({ content: UNSTICK_TABS });
        await expect(page).toHaveScreenshot(`builder-dark-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
  });
}
