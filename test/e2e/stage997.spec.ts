// 9.97단계 화면(E2E, 4.4-1): 수요 탭, 상태마다 칸 순서와 문구, `#demand`·`#demand-2` 주소, 탭 없는 날, 일곱 탭 375·360·320px, 검색, 대기·오류, 소개, 화면 × 상태 × 폭의 시각 회귀.
// 수요 흐름이 있는 사이트를 따로 빌드해 다른 포트로 띄운다. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { READY_STATE, UNSTICK_TABS, expect, expectNoHorizontalScroll, failData, monthDay, storyItem, test } from "./base.ts";
import { E2E_DEMAND_BASE_URL, E2E_DEMAND_DATA_DIR, E2E_DEMAND_INFO_FILE } from "./paths.ts";
import type { DemandFixtureInfo } from "../../site/dev/demandFixtures.ts";
import { DEMAND_ABOUT_HASH, DEMAND_ABOUT_LINK, demandZeroText, flowCategoryText, flowContinuesText, flowLevelText, flowPeriod, flowUnitHead, flowUnitNumbers, flowUnitPeriod } from "../../site/src/lib/demand.ts";
import { BRIEF_TAB_KEY } from "../../site/src/lib/browserKeys.ts";
import { FLOW_AI_NOTE, FLOW_CAVEAT } from "../../src/demandFlowTypes.ts";
import { siteFiles, type DayList, type DemandMonth, type MonthList, type SiteFlowItem } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_DEMAND_BASE_URL });

const SITE_DATA = path.join(E2E_DEMAND_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const d = JSON.parse(fs.readFileSync(E2E_DEMAND_INFO_FILE, "utf8")) as { [K in keyof DemandFixtureInfo]: NonNullable<DemandFixtureInfo[K]> };
const itemsOf = (date: string): SiteFlowItem[] => json<DemandMonth>(siteFiles.demandItems(date.slice(0, 7))).days[date]!;
const dayOf = (date: string): DayList => json<MonthList>(siteFiles.list(date.slice(0, 7))).days.find((x) => x.date === date)!;

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const demandTab = (page: Page, count: number) => tabs(page).getByRole("button", { name: `수요 ${count}`, exact: true });
/** 수요 항목 줄(U2 4.2-1: 처음에 접혀 있어 펼친 칸이 없다) */
const rows = (page: Page) => page.locator("main li.bitem");
/** 항목 줄을 펼친다(U2 4.2-1: 한 번에 하나). 이미 펼쳐져 있으면(링크로 들어온 항목, 4.2-4) 그대로 둔다 */
async function expand(page: Page, key: string): Promise<Locator> {
  const row = storyItem(page, key);
  const btn = row.locator("button.item-btn");
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  return row;
}
const heads = (row: Locator) => row.locator(".detail h4.h");
const field = (row: Locator, label: string) => row.locator(".detail h4.h", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::*[1]");

/** 항목의 칸 제목(4.4-1의 고정 순서에서 있는 것만) */
const wantHeads = (x: SiteFlowItem) => ["요지", "잇는 이유", "근거", "근거 수준", ...(x.aux.length ? ["보조 근거"] : []), ...(x.continues ? ["이어짐"] : []), ...(x.issue ? ["관련 이슈"] : []), "비교 기간", "출처"];

async function expectItem(page: Page, x: SiteFlowItem): Promise<void> {
  const row = await expand(page, x.key);
  await expect(row.locator(".cat")).toHaveText(flowCategoryText(x));
  await expect(row.locator(".title")).toHaveText(x.title);
  await expect(heads(row)).toHaveText(wantHeads(x));
  await expect(field(row, "요지")).toHaveText(x.summary);
  await expect(field(row, "잇는 이유")).toHaveText(x.reason);
  await expect(row.locator(".dnote")).toHaveText(FLOW_AI_NOTE);
  const lines = field(row, "근거").locator("li");
  await expect(lines).toHaveCount(x.units.length);
  for (let i = 0; i < x.units.length; i++) {
    const u = x.units[i]!;
    await expect(lines.nth(i).locator(".dhead")).toHaveText(flowUnitHead(u));
    await expect(lines.nth(i).locator(".dnum")).toHaveText(flowUnitNumbers(u));
    await expect(lines.nth(i).locator(".dwin").first()).toHaveText(flowUnitPeriod(u));
  }
  await expect(field(row, "근거 수준")).toHaveText(flowLevelText(x.level));
  await expect(field(row, "비교 기간")).toHaveText(flowPeriod(x.units));
  const links = field(row, "출처").getByRole("link");
  await expect(links).toHaveCount(x.sources.length);
  for (let i = 0; i < x.sources.length; i++) await expect(links.nth(i)).toHaveAttribute("href", x.sources[i]!.url);
  if (x.issue) await expect(field(row, "관련 이슈").getByRole("link")).toHaveAttribute("href", `/issues/${x.issue.id}`);
  await expect(row.getByRole("link", { name: /틀린 내용 알리기/ })).toHaveCount(1);
}

for (const width of [1440, 375]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    test("3건: 탭이 빌더 다음 끝에 있고, 머리 안내와 고정 문구, 항목의 칸이 정해진 순서와 문구다", async ({ page }) => {
      await page.goto(`/${d.three}`);
      const buttons = tabs(page).getByRole("button");
      await expect(buttons.last()).toHaveText("수요 3");
      await expect(buttons.nth(-2)).toHaveText(/^빌더 /);
      await demandTab(page, 3).click();
      await expect(rows(page)).toHaveCount(3);
      await expect(page.locator("main .flow.note").first()).toContainText(FLOW_CAVEAT);
      await expect(page.getByRole("link", { name: DEMAND_ABOUT_LINK })).toHaveAttribute("href", `/about#${DEMAND_ABOUT_HASH}`);
      for (const x of itemsOf(d.three)) {
        await expectItem(page, x);
        await expectNoHorizontalScroll(page, `3건 ${x.key}`);
      }
      await expect(page.locator("main")).not.toContainText("이 날 비교에 넣지 못한 소스");
    });

    test("0건, 기준 부족, 받지 못함은 상태 문구 하나이고 받지 못함만 오류 글자색이다", async ({ page }) => {
      for (const [date, status] of [[d.zero, "checked"], [d.short, "short"], [d.failed, "failed"]] as const) {
        await page.goto(`/${date}#demand`);
        await expect(demandTab(page, 0)).toHaveAttribute("aria-pressed", "true");
        await expect(rows(page)).toHaveCount(0);
        const state = page.locator("main .state");
        await expect(state).toHaveText(demandZeroText(status));
        await expect(state).toHaveClass(status === "failed" ? /error/ : /empty/);
        await expectNoHorizontalScroll(page, status);
      }
    });

    test("빠진 묶음이 있는 날은 목록 끝에 안내가 있다", async ({ page }) => {
      await page.goto(`/${d.missing}#demand`);
      await expect(rows(page)).toHaveCount(1);
      await expect(page.locator("main .flow.note").last()).toHaveText("이 날 비교에 넣지 못한 소스: 국회 청원, SEC Form D");
    });

    test("이어짐 링크는 앞 날짜를 보이고 앞 항목으로 간다", async ({ page }) => {
      await page.goto(`/${d.continues}#demand`);
      const [x] = itemsOf(d.continues) as [SiteFlowItem];
      await expectItem(page, x);
      const link = field(storyItem(page, x.key), "이어짐").getByRole("link");
      await expect(link).toHaveText(flowContinuesText(d.origin));
      await expect(link).toContainText(monthDay(d.origin));
      // U2 design-check: 이미 44px 칸인 링크라 글 링크의 아래 여백을 더하지 않아, 문단은 한 줄 높이 그대로다
      const para = (await link.evaluate(new Function("e", 'const p = e.closest("p"); return { h: p.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(p).lineHeight) };') as () => unknown)) as { h: number; lh: number };
      expect(para.h).toBeLessThanOrEqual(para.lh + 1);
      await link.click();
      await expect(page).toHaveURL(`/${d.origin}#demand-1`);
      await expect(storyItem(page, "demand-1")).toBeInViewport();
      await expect(storyItem(page, "demand-1")).toBeFocused();
      // U2 4.2-4: 링크로 들어온 앞 항목은 펼친 채다
      await expect(storyItem(page, "demand-1").locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
    });

    test("정정된 항목은 대분류 줄에 정정됨과 요지 아래 바뀐 내용이 있다", async ({ page }) => {
      await page.goto(`/${d.corrected}#demand`);
      const [x] = itemsOf(d.corrected) as [SiteFlowItem];
      const row = storyItem(page, x.key);
      // U2 4.2-2: '정정됨'은 접힌 줄에도 있고 바뀐 내용은 펼친 칸에 있다
      await expect(row.locator(".fix-mark")).toHaveText(`정정됨 · ${monthDay(x.corrections![0]!.on)}`);
      await expand(page, x.key);
      await expect(row.locator(".detail .fix")).toContainText(x.corrections![0]!.reason);
      await expectItem(page, x);
    });

    test("긴 글: 상한 길이의 글과 긴 이름이 잘리지 않고 가로 스크롤이 없다", async ({ page }) => {
      await page.goto(`/${d.long}#demand`);
      await expect(rows(page)).toHaveCount(3);
      // 펼침은 한 번에 하나라(U2 4.2-1) 항목마다 펴서 가로 스크롤을 본다
      for (const x of itemsOf(d.long)) {
        await expectItem(page, x);
        await expectNoHorizontalScroll(page, `긴 글 ${x.key}`);
      }
    });

    test("탭 일곱 개인 날: 한 줄에 들어가고 가로 스크롤이 없다", async ({ page }) => {
      await page.goto(`/${d.sevenTabs}`);
      const buttons = tabs(page).getByRole("button");
      await expect(buttons).toHaveCount(7);
      const boxes = await Promise.all((await buttons.all()).map(async (b) => (await b.boundingBox())!));
      expect(new Set(boxes.map((b) => Math.round(b.y))).size, "한 줄").toBe(1);
      expect(Math.max(...boxes.map((b) => b.x + b.width))).toBeLessThanOrEqual(width);
      await expectNoHorizontalScroll(page, "일곱 탭");
    });
  });
}

test.describe("주소와 탭 없음", () => {
  test("#demand와 #demand-2로 수요 탭이 열리고, #demand-2는 그 항목으로 가며 새로 고쳐도 그대로다", async ({ page }) => {
    await page.goto(`/${d.three}#demand`);
    await expect(demandTab(page, 3)).toHaveAttribute("aria-pressed", "true");
    await expect(rows(page)).toHaveCount(3);
    await page.goto(`/${d.three}#demand-2`);
    await expect(demandTab(page, 3)).toHaveAttribute("aria-pressed", "true");
    await expect(storyItem(page, "demand-2")).toBeInViewport();
    await expect(storyItem(page, "demand-2")).toBeFocused();
    await expect(storyItem(page, "demand-2").locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
    await page.reload();
    await expect(storyItem(page, "demand-2")).toBeInViewport();
    await expect(storyItem(page, "demand-2").locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
  });

  test("기록이 없는 날과 꺼짐만 있는 날은 탭이 없고, 기억된 탭이 수요면 기본 탭으로 간다", async ({ page }) => {
    await page.goto("/about");
    await page.evaluate((k) => localStorage.setItem(k, "수요"), BRIEF_TAB_KEY);
    for (const date of [d.noRecord, d.offOnly]) {
      await page.goto(`/${date}`);
      const day = dayOf(date);
      await expect(page.locator("main")).toContainText(day.sections[0]!.stories[0]!.title);
      await expect(tabs(page).getByRole("button", { name: /^수요/ })).toHaveCount(0);
      await expect(tabs(page).getByRole("button", { name: day.sections[0]!.name, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("고른 수요 탭이 기억돼 다른 날에도 열린다", async ({ page }) => {
    await page.goto(`/${d.missing}`);
    await demandTab(page, 1).click();
    await expect.poll(() => page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("수요");
    await page.goto(`/${d.three}`);
    await expect(rows(page)).toHaveCount(3);
  });

  test("달 파일을 받지 못하면 다시 시도할 수 있고, 다시 받으면 항목이 보인다", async ({ page }) => {
    await failData(page, siteFiles.demandItems(d.three.slice(0, 7)));
    await page.goto(`/${d.three}#demand`);
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
    await page.unroute(`**/site-data/${siteFiles.demandItems(d.three.slice(0, 7))}`);
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(rows(page)).toHaveCount(3);
  });
});

test.describe("검색과 소개", () => {
  test("검색 결과의 수요 묶음에서 항목을 누르면 그 항목으로 간다", async ({ page }) => {
    const [x] = itemsOf(d.three) as [SiteFlowItem];
    await page.goto(`/search?q=${encodeURIComponent("가짜보상지어낸요지는")}`);
    const section = page.getByRole("region", { name: "수요" });
    await expect(section.getByRole("link", { name: new RegExp(x.title) })).toBeVisible();
    await expect(section.locator(".cat").first()).toContainText(flowCategoryText(x));
    await section.getByRole("link", { name: new RegExp(x.title) }).click();
    await expect(page).toHaveURL(`/${d.three}#${x.key}`);
    await expect(storyItem(page, x.key)).toBeInViewport();
  });

  test("소개의 수요 절로 간다", async ({ page }) => {
    await page.goto(`/${d.three}#demand`);
    await page.getByRole("link", { name: DEMAND_ABOUT_LINK }).click();
    await expect(page).toHaveURL(`/about#${DEMAND_ABOUT_HASH}`);
    await expect(page.locator(`#${DEMAND_ABOUT_HASH}`)).toBeInViewport();
    await expect(page.locator("#demand")).toContainText("공공누리 제2유형");
  });
});

for (const width of [360, 320]) {
  test.describe(`탭 일곱 개, ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });
    test("탭 숫자가 두 자리여도 탭마다 폭 44px 이상이고 글자가 한 줄이다", async ({ page }) => {
      await page.goto(`/${d.sevenTabs}`);
      const buttons = tabs(page).getByRole("button");
      await expect(buttons).toHaveCount(7);
      // 지어낸 데이터의 탭 숫자는 한 자리라, 가장 넓은 흔한 경우인 두 자리로 바꿔 폭 하한을 본다
      for (const b of await buttons.all()) await b.evaluate((x) => { const e = x as unknown as { textContent: string | null }; e.textContent = (e.textContent ?? "").replace(/\d+/g, "12"); });
      for (const b of await buttons.all()) {
        const name = await b.innerText();
        const box = (await b.boundingBox())!;
        expect(box.width, name).toBeGreaterThanOrEqual(44);
        expect(box.height, name).toBeLessThanOrEqual(46);
        expect(await b.evaluate((x) => { const e = x as unknown as { scrollWidth: number; clientWidth: number }; return e.scrollWidth <= e.clientWidth; }), name).toBe(true);
      }
      await expectNoHorizontalScroll(page, `${width} 일곱 탭`);
    });
  });
}

// 디자인 점검의 화면 × 상태 × 폭(`docs/design.md`의 '수요 항목')
for (const width of [375, 1280]) {
  test.describe(`수요 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    const shots: [string, string, string][] = [
      ["3건", d.three, "main .item"],
      ["0건", d.zero, READY_STATE],
      ["기준 부족", d.short, READY_STATE],
      ["받지 못함", d.failed, READY_STATE],
      ["빠진 묶음", d.missing, "main .item"],
      ["이어짐", d.continues, "main .item"],
      ["정정됨", d.corrected, "main .item"],
      ["긴 글", d.long, "main .item"],
    ];
    for (const [name, date, ready] of shots) {
      test(name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${date}T09:00:00+09:00`));
        await page.goto(`/${date}#demand`);
        await expect(page.locator(ready).first()).toBeVisible();
        await page.addStyleTag({ content: UNSTICK_TABS });
        await expect(page).toHaveScreenshot(`demand-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
    test("소개 수요 절", async ({ page }) => {
      await page.clock.setFixedTime(new Date(`${d.three}T09:00:00+09:00`));
      await page.goto("/about#demand");
      await expect(page.locator("#demand")).toBeVisible();
      await expect(page.locator("#demand")).toHaveScreenshot(`demand-about-${width}.png`, { animations: "disabled" });
    });
  });
}
