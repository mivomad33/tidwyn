// 6단계 화면(E2E): 브리프 위 '이번 주 일정 | 지표' 상자(탭, 접기, 기억, 키보드), 지표 페이지, 지표 하나의 페이지(기간, 그래프 누르기·키보드,
// 관련 이슈 더 보기, 값 없음·없는 페이지), 이슈 페이지의 '관련 지표', 메뉴, 사이트 소개의 FRED 고지, 빈 상태·불러오기 오류·대기 표시, 375px 폭, 새 주소 직접 요청.
// 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts). 기존 단계의 E2E는 지표가 없는 데이터 그대로 돌고, 여기서는 사이트 데이터 요청을
// 일정과 지표가 있는 지어낸 데이터(indicator-data/)로 바꿔 준다. 브라우저 시계는 가장 최근 브리프의 다음 날(2026-10-28, KST)로 고정한다.
import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect, expectNoHorizontalScroll, fulfillData, serverError, test } from "./base.ts";
import { E2E_INDICATOR_DATA_DIR, E2E_INDICATOR_INFO_FILE } from "./paths.ts";
import { BOX_TAB_KEY, FRED_AGREEMENT, FRED_NOTICE, FRED_TERMS_URL, RELATED_FIRST, formatValue, visibleCards } from "../../site/src/lib/indicators.ts";
import { WEEK_BOX_KEY } from "../../site/src/lib/schedules.ts";
import type { DayList, IndicatorList, IssueChunk, IssueDetail, MonthList } from "../../src/siteTypes.ts";

const TODAY = "2026-10-28";
const SITE_DATA = path.join(E2E_INDICATOR_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const files = fs.readdirSync(SITE_DATA);
const iinfo = JSON.parse(fs.readFileSync(E2E_INDICATOR_INFO_FILE, "utf8")) as {
  dates: string[];
  merged: { id: number; into: number };
  off: string;
  empty: string;
  mostRelated: { id: string; count: number };
  noRelated: string;
  issueOne: number;
  issueThree: number;
  krHoliday: string;
};
const days = new Map<string, DayList>();
for (const f of files.filter((f) => f.startsWith("list-"))) for (const d of json<MonthList>(f).days) days.set(d.date, d);
const issues: IssueDetail[] = files.filter((f) => /^issue-\d+\.json$/.test(f)).flatMap((f) => Object.values(json<IssueChunk>(f).issues));
const list = json<IndicatorList>("indicator-list.json");
const cards = visibleCards(list);
const LATEST = iinfo.dates[0]!;
const latest = days.get(LATEST)!;
/** 일정이 없는(지표만 있는) 날짜 */
const noWeekDate = iinfo.dates.find((d) => !days.get(d)!.week && days.get(d)!.indicators)!;
const otherDate = iinfo.dates.find((d) => d !== LATEST && days.get(d)!.week && days.get(d)!.indicators)!;
const noIndicatorIssue = issues.find((i) => !i.indicators && i.schedules?.length)!;

/** 사이트 데이터 요청을 일정·지표가 있는 지어낸 데이터로 바꾼다(뒤에 단 page.route가 먼저 걸리므로 오류 주입은 이 뒤에 단다) */
async function useIndicatorData(page: Page): Promise<void> {
  await page.route("**/site-data/**", (route: Route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    const file = path.join(SITE_DATA, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
    return route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(file, "utf8") });
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00+09:00`));
  await useIndicatorData(page);
});

const box = (page: Page) => page.locator("main > section.week");
const tab = (page: Page, name: RegExp | string) => page.getByRole("tab", { name });
const toggle = (page: Page) => page.locator(".week .box-toggle");

test.describe("브리프 위 '이번 주 일정 | 지표' 상자", () => {
  test("탭을 바꾸면 지표 칩(브리프 날짜의 기준값)이 보이고, 칩·'지표 전체'를 누르면 지표 화면으로 간다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await expect(box(page)).toHaveAccessibleName("이번 주 일정과 지표");
    await expect(tab(page, `이번 주 일정 ${latest.week!.total}`)).toHaveAttribute("aria-selected", "true");
    await expect(box(page).locator(".wrow")).toHaveCount(Math.min(5, latest.week!.total));
    await tab(page, "지표").click();
    await expect(tab(page, "지표")).toHaveAttribute("aria-selected", "true");
    const chips = box(page).locator(".ichip");
    await expect(chips).toHaveCount(latest.indicators!.length);
    const first = latest.indicators![0]!;
    await expect(chips.first().locator("b")).toHaveText(formatValue(first, first.value));
    await expect(box(page).locator(".box-foot")).toContainText("10월 27일 값");
    // 섹션 탭과 관계없이 같다
    await page.getByRole("navigation", { name: "섹션" }).getByRole("button", { name: "세계" }).click();
    await expect(chips).toHaveCount(latest.indicators!.length);
    await chips.first().click();
    await expect(page).toHaveURL(`/indicators/${first.id}`);
    await expect(page.getByRole("heading", { level: 1, name: first.name })).toBeVisible();
    await page.goto(`/${LATEST}`);
    await box(page).getByRole("link", { name: "지표 전체" }).click();
    await expect(page).toHaveURL("/indicators");
  });

  test("휴장일의 칩에는 그 값의 날짜가 작게 붙는다", async ({ page }) => {
    await page.goto(`/${iinfo.krHoliday}`);
    await expect(tab(page, "지표")).toBeVisible();
    if (await tab(page, "지표").getAttribute("aria-selected") !== "true") await tab(page, "지표").click();
    const usd = box(page).locator('a.ichip[href="/indicators/usdkrw"]');
    const c = days.get(iinfo.krHoliday)!.indicators!.find((x) => x.id === "usdkrw")!;
    await expect(usd.locator("small")).toHaveText(`${c.date.slice(5)} 값`);
  });

  test("접고 펴며, 고른 탭과 접은 상태가 새로 고침·다른 날짜·읽은 기록 지우기 뒤에도 이어진다. 사이트 소개에 새 키 설명이 있다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await tab(page, "지표").click();
    expect(await page.evaluate((k) => localStorage.getItem(k), BOX_TAB_KEY)).toBe("indicators");
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    const c = latest.indicators![0]!;
    await expect(toggle(page)).toContainText(`이번 주 일정 ${latest.week!.total} · ${c.name} ${formatValue(c, c.value)}`);
    await expect(page.locator(".week.closed")).toHaveCount(1);
    expect(await page.evaluate((k) => localStorage.getItem(k), WEEK_BOX_KEY)).toBe("closed");
    await page.reload();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await page.goto("/about");
    await expect(page.getByText("그 상자에서 고른 탭(일정·지표)도 이 브라우저에만 기억한다")).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "읽은 기록 지우기" }).click();
    await page.goto(`/${otherDate}`);
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(tab(page, "지표")).toHaveAttribute("aria-selected", "true");
  });

  test("키보드: 화살표로 탭을 고르고(보조 기술에 고른 탭을 알린다) Enter·Space로 접고 편다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    const weekTab = tab(page, /^이번 주 일정/);
    await weekTab.focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "지표")).toBeFocused();
    await expect(tab(page, "지표")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", "brief-box-tab-indicators");
    await page.keyboard.press("ArrowLeft");
    await expect(weekTab).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Tab");
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(toggle(page)).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle(page)).toHaveAttribute("aria-expanded", "true");
  });

  test("일정이 없는 날짜에는 지표 탭만 보이고, 칩도 일정도 없으면 상자가 없다", async ({ page }) => {
    await page.goto(`/${noWeekDate}`);
    await expect(page.getByRole("tab")).toHaveCount(1);
    await expect(tab(page, "지표")).toHaveAttribute("aria-selected", "true");
    await expect(box(page)).toHaveAccessibleName("지표");
    const day = days.get(noWeekDate)!;
    await fulfillData(page, `list-${noWeekDate.slice(0, 7)}.json`, { month: noWeekDate.slice(0, 7), days: [{ ...day, indicators: undefined, week: undefined }] });
    await page.reload();
    await expect(page.locator(".headline")).toBeVisible();
    await expect(page.locator(".week")).toHaveCount(0);
  });
});

test.describe("지표 페이지", () => {
  test("묶음별 카드(값 없는 지표·공개 끈 지표 없음), 카드를 누르면 지표 하나의 페이지, 바닥에 출처와 FRED 고지", async ({ page }) => {
    await page.goto("/indicators");
    await expect(page.getByRole("heading", { level: 1, name: "지표" })).toBeVisible();
    await expect(page.getByText(/10월 27일까지의 값 · 공식 출처\(한국은행 ECOS, FRED\)/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(["한국", "미국·국제"]);
    await expect(page.locator(".icard")).toHaveCount(cards.length);
    await expect(page.locator(`a[href="/indicators/${iinfo.empty}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/indicators/${iinfo.off}"]`)).toHaveCount(0);
    for (const credit of new Set(cards.map((c) => c.credit))) await expect(page.locator(".isrc").getByText(credit)).toHaveCount(1);
    await expect(page.getByText(FRED_NOTICE)).toBeVisible();
    await expect(page.getByRole("link", { name: /FRED® API 이용 약관/ })).toHaveAttribute("href", FRED_TERMS_URL);
    await page.locator(".icard").first().click();
    await expect(page).toHaveURL(`/indicators/${cards[0]!.id}`);
  });

  test("공개 지표에 값이 하나도 없으면 빈 상태, 불러오지 못하면 오류와 다시 시도", async ({ page }) => {
    await fulfillData(page, "indicator-list.json", { asOf: null, indicators: list.indicators.map((c) => ({ ...c, last: null, spark: [] })) });
    await page.goto("/indicators");
    await expect(page.getByText("아직 지표 값이 없다.")).toBeVisible();
    await page.unroute("**/site-data/indicator-list.json");
    await serverError(page, "indicator-list.json");
    await page.reload();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute("**/site-data/indicator-list.json");
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator(".icard")).toHaveCount(cards.length);
  });
});

test.describe("지표 하나의 페이지", () => {
  const most = list.indicators.find((c) => c.id === iinfo.mostRelated.id)!;

  test("기간을 바꾸면 그래프가 바뀌고(처음 1년), 그래프를 누르면 날짜·값이 보이며 키보드로 옮긴다", async ({ page }) => {
    await page.goto(`/indicators/${most.id}`);
    const seg = page.getByRole("group", { name: "기간" });
    await expect(seg.getByRole("button", { name: "1년" })).toHaveAttribute("aria-pressed", "true");
    const slider = page.getByRole("slider");
    const yearMax = Number(await slider.getAttribute("aria-valuemax"));
    await seg.getByRole("button", { name: "5년" }).click();
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuemax"))).toBeGreaterThan(yearMax * 4);
    await seg.getByRole("button", { name: "1개월" }).click();
    await expect.poll(async () => Number(await slider.getAttribute("aria-valuemax"))).toBeLessThan(30);
    await expect(page.locator(".chart-read")).toHaveText("그래프를 누르거나 끌면 그날 값이 보인다.");
    const boxRect = (await slider.boundingBox())!;
    await page.mouse.click(boxRect.x + boxRect.width / 2, boxRect.y + boxRect.height / 2);
    await expect(page.locator(".chart-read.on")).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일 [\d,.]+원$/);
    const before = await slider.getAttribute("aria-valuetext");
    await slider.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(slider).not.toHaveAttribute("aria-valuetext", before!);
    await page.keyboard.press("End");
    await expect(page.locator(".chart-read.on")).toContainText(`${formatValue(most, most.last!.value)}`);
    await expect(page.locator("p.sr-only", { hasText: `${most.name}: ` })).toHaveCount(1);
  });

  test("관련 이슈는 처음 일부만, 더 보기로 나머지가 보이고, 누르면 그 이슈 페이지로 간다", async ({ page }) => {
    await page.goto(`/indicators/${most.id}`);
    const rows = page.locator(".evlist .ev-link");
    await expect(rows).toHaveCount(RELATED_FIRST);
    await page.getByRole("button", { name: /^더 보기/ }).click();
    await expect(rows).toHaveCount(most.issues.length);
    await expect(rows.nth(RELATED_FIRST)).toBeFocused();
    await rows.first().click();
    await expect(page).toHaveURL(`/issues/${most.issues[0]!.id}`);
  });

  test("관련 이슈가 없으면 그 절이 없고, 값 없는 지표는 '아직 값이 없다', 공개 끈 지표·없는 식별자는 없는 페이지", async ({ page }) => {
    await page.goto(`/indicators/${iinfo.noRelated}`);
    await expect(page.getByRole("slider")).toBeVisible();
    await expect(page.getByRole("heading", { name: "관련 이슈" })).toHaveCount(0);
    await page.goto(`/indicators/${iinfo.empty}`);
    await expect(page.getByText("아직 값이 없다.")).toBeVisible();
    await expect(page.getByRole("slider")).toHaveCount(0);
    for (const p of [`/indicators/${iinfo.off}`, "/indicators/nothing", "/indicators/BAD"]) {
      await page.goto(p);
      await expect(page.getByRole("heading", { level: 1, name: "이 주소에는 페이지가 없다" })).toBeVisible();
    }
  });

  test("값 파일을 기다리는 동안 대기 표시, 불러오지 못하면 오류와 다시 시도", async ({ page }) => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    await page.route(`**/site-data/indicator-${most.id}.json`, async (route) => {
      await gate;
      await route.fallback();
    });
    await page.goto(`/indicators/${most.id}`);
    await expect(page.getByRole("status")).toHaveText(/불러오는 중/);
    release();
    await expect(page.getByRole("slider")).toBeVisible();
    await page.unroute(`**/site-data/indicator-${most.id}.json`);
    await serverError(page, `indicator-${most.id}.json`);
    await page.goto(`/indicators/${most.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(`**/site-data/indicator-${most.id}.json`);
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("slider")).toBeVisible();
  });
});

test.describe("값이 하나뿐이거나 모두 같은 그래프", () => {
  /** 보이는 눈금 글자의 y가 값(점·선)의 y와 맞는지(한 줄 높이 안) */
  async function labelsAtValue(page: Page): Promise<void> {
    const svg = page.locator("main svg").first();
    await expect(svg.locator("text.ax").first()).toBeVisible();
    // 눈금 글자는 눈금선 바로 위(선의 y - 3)에 있다. 날짜 글자와는 이것으로 가른다
    const lineYs = new Set<number>();
    for (const l of await svg.locator("line").all()) lineYs.add(Number(await l.getAttribute("y1")));
    const gridLabelYs: number[] = [];
    for (const t of await svg.locator("text.ax").all()) {
      const y = Number(await t.getAttribute("y"));
      if (lineYs.has(y + 3)) gridLabelYs.push(y);
    }
    expect(gridLabelYs).toHaveLength(1);
    const labelY = gridLabelYs[0]!;
    const circles = svg.locator("circle");
    const valueY = (await circles.count())
      ? Number(await circles.first().getAttribute("cy"))
      : Number((await svg.locator("path").first().getAttribute("d"))!.split(",")[1]!.split(" ")[0]);
    expect(Math.abs(labelY + 3 - valueY)).toBeLessThan(8);
  }

  test("월별 지표의 1개월(값 하나)과 내내 같은 값의 지표는 눈금 글자가 값 높이에 하나만 있다", async ({ page }) => {
    const monthly = cards.find((c) => c.freq === "month")!;
    await page.goto(`/indicators/${monthly.id}`);
    await page.getByRole("group", { name: "기간" }).getByRole("button", { name: "1개월" }).click();
    await expect(page.getByText("이 기간에는 값이 하나뿐이다.")).toBeVisible();
    await labelsAtValue(page);
    const flat = cards.find((c) => c.freq === "day" && c.last && c.last.change === 0 && c.spark.every((p) => p[1] === c.spark[0]![1]));
    if (flat === undefined) throw new Error("테스트 데이터에 내내 같은 값의 일별 지표가 없다");
    await page.goto(`/indicators/${flat.id}`);
    await page.getByRole("group", { name: "기간" }).getByRole("button", { name: "1개월" }).click();
    await labelsAtValue(page);
  });
});

test.describe("터치 화면", () => {
  test.use({ hasTouch: true, viewport: { width: 375, height: 812 } });
  test("그래프를 손가락으로 누르면 그 날짜와 값이 보인다", async ({ page }) => {
    await page.goto(`/indicators/${cards[0]!.id}`);
    const slider = page.getByRole("slider");
    await expect(slider).toBeVisible();
    const r = (await slider.boundingBox())!;
    await page.touchscreen.tap(r.x + r.width * 0.3, r.y + r.height / 2);
    await expect(page.locator(".chart-read.on")).toHaveText(/^\d{4}년 \d{1,2}월 \d{1,2}일 /);
    await expect(page.locator(".chart-plot svg line[stroke-dasharray]")).toHaveCount(1);
  });
});

test.describe("이슈 페이지의 '관련 지표'", () => {
  test("타임라인 아래·'일정' 위에 고른 지표마다 그래프와 뉴스 날의 점·범례, 제목을 누르면 지표 하나의 페이지", async ({ page }) => {
    const issue = issues.find((i) => i.id === iinfo.issueThree)!;
    await page.goto(`/issues/${issue.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "관련 지표" })).toBeVisible();
    const heads = await page.locator("main h2").allTextContents();
    expect(heads.indexOf("관련 지표")).toBe(heads.indexOf("타임라인") + 1);
    if (heads.includes("일정")) expect(heads.indexOf("일정")).toBe(heads.indexOf("관련 지표") + 1);
    await expect(page.locator(".igraph")).toHaveCount(3);
    await expect(page.locator(".igraph circle.dot").first()).toBeAttached();
    await expect(page.locator(".legend").first()).toHaveText("이 이슈 뉴스가 있는 날");
    await expect(page.locator(".igraph .igh small").first()).toContainText("부터");
    await expect(page.locator("section[aria-labelledby=iss-ind] .isrc")).toBeVisible();
    const first = issue.indicators![0]!;
    await page.locator(".igraph .igh a").first().click();
    await expect(page).toHaveURL(`/indicators/${first.id}`);
  });

  test("그래프 1개인 이슈, 고른 지표가 없는 이슈에는 '관련 지표'가 없다", async ({ page }) => {
    await page.goto(`/issues/${iinfo.issueOne}`);
    await expect(page.locator(".igraph")).toHaveCount(1);
    await page.goto(`/issues/${noIndicatorIssue.id}`);
    await expect(page.getByRole("heading", { level: 2, name: "일정" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "관련 지표" })).toHaveCount(0);
  });
});

test("머리 메뉴의 '지표'와 사이트 소개의 FRED 고지·약관 링크·동의 한 줄·지표 안내", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "메뉴" }).click();
  await page.getByRole("navigation", { name: "사이트 메뉴" }).getByRole("link", { name: "지표", exact: true }).click();
  await expect(page).toHaveURL("/indicators");
  await page.goto("/about");
  await expect(page.getByText(FRED_NOTICE)).toBeVisible();
  await expect(page.getByRole("link", { name: /FRED® API 이용 약관/ })).toHaveAttribute("href", FRED_TERMS_URL);
  await expect(page.getByText(FRED_AGREEMENT)).toBeVisible();
  await expect(page.getByText(/지표는 공식 출처\(한국은행 ECOS, FRED\)에서 받은 값이지만 늦게 반영되거나/)).toBeVisible();
});

test("새 주소를 직접 요청하면 화면 틀이 오고, 파일이 없는 지표는 404다", async ({ request }) => {
  const list = await request.get("/indicators");
  expect(list.status()).toBe(200);
  expect(await list.text()).toContain('<div id="root">');
  const missing = await request.get("/indicators/nothing");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain('<div id="root">');
});

test.describe("375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("새 화면에 가로 스크롤이 없다(넘기는 칩은 상자 안에서만 넘긴다)", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    await tab(page, "지표").click();
    await expect(page.locator(".ichip").first()).toBeVisible();
    const [sw, cw] = (await page.evaluate(`(() => { const el = document.querySelector(".ichips"); return [el.scrollWidth, el.clientWidth]; })()`)) as [number, number];
    expect(sw, "칩 줄이 상자 안에서 넘친다(넘겨 본다)").toBeGreaterThan(cw);
    await expectNoHorizontalScroll(page, "브리프 위 상자");
    await toggle(page).click();
    await expectNoHorizontalScroll(page, "접은 줄");
    await page.goto("/indicators");
    await expect(page.locator(".icard").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "지표 페이지");
    await page.goto(`/indicators/${cards[0]!.id}`);
    await expect(page.getByRole("slider")).toBeVisible();
    await page.getByRole("group", { name: "기간" }).getByRole("button", { name: "5년" }).click();
    await expectNoHorizontalScroll(page, "지표 하나의 페이지");
    await page.goto(`/issues/${iinfo.issueThree}`);
    await expect(page.locator(".igraph").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "이슈 페이지");
  });
});
