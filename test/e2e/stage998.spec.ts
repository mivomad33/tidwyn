// 9.98단계 화면(E2E, 4.5-1·4.5-2): 커뮤니티 근거 줄, 커뮤니티 확인 흐름의 수준 문구, 꺾임 표시, 커뮤니티 받지 못함 안내, 긴 검색어,
// 탭 머리 문장과 소개의 사각지대 표 링크, 1440·375px의 칸 순서와 문구, 가로 스크롤 없음, 시각 회귀. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { UNSTICK_TABS, expect, expectNoHorizontalScroll, storyItem, test } from "./base.ts";
import { E2E_DEMAND_BASE_URL, E2E_DEMAND_DATA_DIR, E2E_DEMAND_INFO_FILE } from "./paths.ts";
import type { DemandFixtureInfo } from "../../site/dev/demandFixtures.ts";
import { DEMAND_ABOUT_HASH, DEMAND_ABOUT_LINK, DEMAND_INTRO, demandMissingText, flowCategoryText, flowCommunityHead, flowCommunityNumbers, flowLevelText, flowPeriod, flowUnitHead, flowUnitNumbers, flowUnitPeriod } from "../../site/src/lib/demand.ts";
import { FIELD_COVERAGE } from "../../src/demandCoverage.ts";
import { FLOW_CAVEAT, FLOW_TURNING_TEXT, fieldLabel } from "../../src/demandFlowTypes.ts";
import { siteFiles, type DemandMonth, type MonthList, type SiteFlowItem } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_DEMAND_BASE_URL });

const SITE_DATA = path.join(E2E_DEMAND_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const d = JSON.parse(fs.readFileSync(E2E_DEMAND_INFO_FILE, "utf8")) as { [K in keyof DemandFixtureInfo]: NonNullable<DemandFixtureInfo[K]> };
const itemsOf = (date: string): SiteFlowItem[] => json<DemandMonth>(siteFiles.demandItems(date.slice(0, 7))).days[date]!;
const demandOf = (date: string) => json<MonthList>(siteFiles.list(date.slice(0, 7))).days.find((x) => x.date === date)!.demand!;

/** 수요 항목 줄(U2 4.2-1: 처음에 접혀 있어 펼친 칸이 없다) */
const rows = (page: Page) => page.locator("main li.bitem");
/** 항목 줄을 펼친다(U2 4.2-1: 한 번에 하나) */
async function expand(page: Page, key: string): Promise<Locator> {
  const row = storyItem(page, key);
  const btn = row.locator("button.item-btn");
  await btn.click();
  await expect(btn).toHaveAttribute("aria-expanded", "true");
  return row;
}
const heads = (row: Locator) => row.locator(".detail h4.h");
const field = (row: Locator, label: string) => row.locator(".detail h4.h", { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::*[1]");

/** 항목의 칸 제목(`docs/design.md` 수요 항목의 고정 순서에서 있는 것만) */
const wantHeads = (x: SiteFlowItem) => ["요지", "잇는 이유", "근거", ...(x.community?.length ? ["커뮤니티"] : []), "근거 수준", ...(x.aux.length ? ["보조 근거"] : []), ...(x.continues ? ["이어짐"] : []), ...(x.issue ? ["관련 이슈"] : []), "비교 기간", "출처"];

async function expectItem(page: Page, x: SiteFlowItem): Promise<void> {
  const row = await expand(page, x.key);
  await expect(row.locator(".cat")).toHaveText(flowCategoryText(x));
  await expect(row.locator(".title")).toHaveText(x.title);
  await expect(heads(row)).toHaveText(wantHeads(x));
  const lines = field(row, "근거").locator("li");
  await expect(lines).toHaveCount(x.units.length);
  for (let i = 0; i < x.units.length; i++) {
    await expect(lines.nth(i).locator(".dhead")).toHaveText(flowUnitHead(x.units[i]!));
    await expect(lines.nth(i).locator(".dnum")).toHaveText(flowUnitNumbers(x.units[i]!));
  }
  if (x.community?.length) {
    const comm = field(row, "커뮤니티").locator("li");
    await expect(comm).toHaveCount(x.community.length);
    for (let i = 0; i < x.community.length; i++) {
      const c = x.community[i]!;
      await expect(comm.nth(i).locator("span")).toHaveText([flowCommunityHead(c), c.name, flowCommunityNumbers(c), flowUnitPeriod(c)]);
      // 길어도 칸 안에서 줄을 바꾼다(잘리거나 넘치지 않는다)
      for (const s of await comm.nth(i).locator("span").all()) expect(await s.evaluate((x) => { const e = x as unknown as { scrollWidth: number; clientWidth: number }; return e.scrollWidth <= e.clientWidth + 1; }), await s.innerText()).toBe(true);
    }
  }
  const level = field(row, "근거 수준");
  await expect(level).toHaveText(flowLevelText(x.level, x.communityConfirmed === true));
  const turn = level.locator("xpath=following-sibling::*[1]");
  if (x.turning) {
    await expect(turn).toHaveText(FLOW_TURNING_TEXT);
    await expect(turn).toHaveClass(/dnote/);
  } else await expect(row.getByText(FLOW_TURNING_TEXT)).toHaveCount(0);
  await expect(field(row, "비교 기간")).toHaveText(flowPeriod(x.units));
  const links = field(row, "출처").getByRole("link");
  await expect(links).toHaveCount(x.sources.length);
  for (let i = 0; i < x.sources.length; i++) {
    await expect(links.nth(i)).toContainText(x.sources[i]!.name);
    await expect(links.nth(i)).toHaveAttribute("href", x.sources[i]!.url);
  }
}

for (const width of [1440, 375]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 900 } });

    test("커뮤니티 확인·꺾임, 공식 둘 + 커뮤니티, 긴 검색어: 칸 순서와 문구, 탭 머리 문장, 가로 스크롤 없음", async ({ page }) => {
      await page.goto(`/${d.community}#demand`);
      const xs = itemsOf(d.community);
      await expect(rows(page)).toHaveCount(xs.length);
      const intro = page.locator("main .flow.note").first();
      await expect(intro).toHaveText(`${DEMAND_INTRO} ${FLOW_CAVEAT} ${DEMAND_ABOUT_LINK}`);
      await expect(intro.getByRole("link", { name: DEMAND_ABOUT_LINK })).toHaveAttribute("href", `/about#${DEMAND_ABOUT_HASH}`);
      // 펼침은 한 번에 하나라 항목마다 펴서 가로 스크롤을 본다
      for (const x of xs) {
        await expectItem(page, x);
        await expectNoHorizontalScroll(page, `커뮤니티 ${x.key}`);
      }
      await expect(page.locator("main")).not.toContainText("이 날 비교에 넣지 못한 소스");
    });

    test("커뮤니티를 받지 못한 날: 목록 끝 안내에 공식 묶음 다음 커뮤니티 소스와 사유가 있다", async ({ page }) => {
      await page.goto(`/${d.communityMissing}#demand`);
      const [x] = itemsOf(d.communityMissing) as [SiteFlowItem];
      await expectItem(page, x);
      const day = demandOf(d.communityMissing);
      await expect(page.locator("main .flow.note").last()).toHaveText(demandMissingText(day.missing, day.communityMissing)!);
      await expect(page.locator("main .flow.note").last()).toHaveText("이 날 비교에 넣지 못한 소스: 국회 청원, Bluesky(받지 못함), GitHub Issues(robots 막힘)");
      await expectNoHorizontalScroll(page, "커뮤니티 받지 못함");
    });

    test("탭 머리 링크는 소개의 사각지대 표로 가고, 표의 칸이 분야×소스 대응과 같으며 가로 스크롤이 없다", async ({ page }) => {
      await page.goto(`/${d.community}#demand`);
      await page.getByRole("link", { name: DEMAND_ABOUT_LINK }).click();
      await expect(page).toHaveURL(`/about#${DEMAND_ABOUT_HASH}`);
      const section = page.locator(`#${DEMAND_ABOUT_HASH}`);
      await expect(section).toBeFocused();
      const table = page.getByRole("table", { name: "분야별로 볼 수 있는 소스" });
      await expect(table.locator("thead th")).toHaveText(["분야", "공식 소스", "커뮤니티 검색"]);
      await expect(table.locator("tbody th")).toHaveText(FIELD_COVERAGE.map((r) => fieldLabel(r.field)));
      await expect(table.locator("tbody th").first()).toBeInViewport();
      const box = (await table.boundingBox())!;
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await expectNoHorizontalScroll(page, "사각지대 표");
    });
  });
}

// 디자인 점검의 화면 × 상태 × 폭(`docs/design.md`의 '수요 항목'). 9.98단계에 더한 상태만
for (const width of [375, 1280]) {
  test.describe(`커뮤니티 화면 ${width}`, () => {
    test.use({ viewport: { width, height: 900 } });
    for (const [name, date] of [["커뮤니티", d.community], ["커뮤니티 받지 못함", d.communityMissing]] as const) {
      test(name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${date}T09:00:00+09:00`));
        await page.goto(`/${date}#demand`);
        await expect(page.locator("main .item").first()).toBeVisible();
        await page.addStyleTag({ content: UNSTICK_TABS });
        await expect(page).toHaveScreenshot(`demand-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
    test("검색 커뮤니티 소스 이름", async ({ page }) => {
      await page.clock.setFixedTime(new Date(`${d.community}T09:00:00+09:00`));
      await page.goto(`/search?q=${encodeURIComponent("Bluesky")}`);
      const region = page.getByRole("region", { name: "수요" });
      await expect(region.getByRole("link").first()).toBeVisible();
      await expect(region).toHaveScreenshot(`demand-search-${width}.png`, { animations: "disabled" });
    });
  });
}
