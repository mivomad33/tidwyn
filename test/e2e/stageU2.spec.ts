// U2단계 화면(E2E, 측정 데이터 E2E): 일정 상자의 처음 상태, 요약·키워드는 뉴스 탭에만, 빌더·수요 항목 접기와 펼칠 때 화면 튐 막기,
// 거르기 칩(있는 값만, 건수, 첫 칩 글, 사라진 값, 넘침), 누를 곳 44px, 일정 이름 링크의 도착, 섹션 탭 Tab 순서.
// 측정 데이터(명세서 용어: 감사의 정상 데이터, 2026-11-06까지 18일)로 따로 빌드한 사이트를 E2E_U1_PORT로 띄워 본다(test/e2e/prepare.ts). 데이터는 모두 지어낸 것이다.
// 브라우저 시계는 2026-11-06(KST 낮)에 고정한다. 일정의 '오늘'과 이번 주 일정이 측정과 같게 하기 위해서다.
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { expect, fulfillData, test } from "./base.ts";
import { E2E_U1_BASE_URL, E2E_U1_DATA_DIR } from "./paths.ts";
import type { BuilderMonth, DemandMonth, MonthList } from "../../src/siteTypes.ts";

/** 375는 측정 도구와 같게 터치(hasTouch)로 본다 */
const PHONE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 800 };
test.use({ baseURL: E2E_U1_BASE_URL, viewport: PHONE, hasTouch: true });

const NOW = new Date("2026-11-06T12:00:00+09:00");
const LATEST = "2026-11-06";
const PAST = "2026-11-03";
/** 11월 5일: 영상 묶음이 여럿인 날(측정 데이터) */
const VIDEO_DATE = "2026-11-05";

/** 화면 18곳(명세서 용어) */
const SCREENS = ["/", "/#videos", "/#builder", "/#demand", "/dates", "/issues", "/issues/28", "/entities", "/entities/1", "/terms", "/schedules", "/indicators", "/indicators/kospi", "/videos/2026-11-06/Fx000000008", "/search?q=가짜", "/about", "/privacy", "/no-such-page"];
/** 펼친 상태와 달력 보기(4.4-1). 이름은 openScreen이 알아본다 */
const OPEN_CARD = "/ (펼친 카드)";
const OPEN_BOX = "/ (펼친 상자)";
const OPEN_BUILDER = "/#builder (펼친 항목)";
const OPEN_DEMAND = "/#demand (펼친 항목)";
const CALENDAR = "/schedules (달력)";
const CALENDAR_PICKED = "/schedules (달력, 날짜 고름)";
const STATES = [OPEN_CARD, OPEN_BOX, OPEN_BUILDER, OPEN_DEMAND, CALENDAR, CALENDAR_PICKED];

/** 섹션 탭 이름(4.3-2: 어떤 칩 글도 이것과 같지 않다) */
const SECTION_NAMES = ["전체", "한국", "세계", "IT·AI", "영상", "빌더", "수요"];

const SITE_DATA = path.join(E2E_U1_DATA_DIR, "site-data");
const readData = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const listOf = (date: string) => readData<MonthList>(`list-${date.slice(0, 7)}.json`).days.find((d) => d.date === date)!;
const MONTHS = ["2026-10", "2026-11"];
const builderMonths = MONTHS.map((m) => readData<BuilderMonth>(`builder-items-${m}.json`));
const demandMonths = MONTHS.map((m) => readData<DemandMonth>(`demand-items-${m}.json`));
/** 날짜 → 도구 변화 / 새 제품·저장소 / 수요 흐름 */
const TOOLS = Object.assign({}, ...builderMonths.map((b) => b.days)) as BuilderMonth["days"];
const DISCOVERIES = Object.assign({}, ...builderMonths.map((b) => b.discoveries ?? {})) as NonNullable<BuilderMonth["discoveries"]>;
const FLOWS = Object.assign({}, ...demandMonths.map((d) => d.days)) as DemandMonth["days"];

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

/** 새 컨텍스트(새 브라우저 탭 기록·저장소)의 페이지. 기본 픽스처와 같게 바깥 네트워크는 막고 시계를 고정한다 */
async function freshPage(browser: Browser, opts: BrowserContextOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: E2E_U1_BASE_URL, viewport: PHONE, hasTouch: true, locale: "ko-KR", timezoneId: "Asia/Seoul", ...opts });
  await context.route("**/*", (route) => (new URL(route.request().url()).hostname === "127.0.0.1" ? route.fallback() : route.abort("blockedbyclient")));
  const page = await context.newPage();
  await page.clock.setFixedTime(NOW);
  return { context, page };
}

/** 데이터를 다 받고 불러오는 중 표시가 사라질 때까지 기다린다 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".state[role=status]")).toHaveCount(0);
}

/** 화면이 다 그려질 때까지(두 프레임) */
async function frames(page: Page): Promise<void> {
  await page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))");
}

const itemBtn = (page: Page, key: string) => page.locator(`[id="story-${key}"] .item-btn`);
const itemOf = (page: Page, key: string) => page.locator(`[id="story-${key}"]`);
const sectionTab = (page: Page, name: string) => page.locator("nav.tabs").getByRole("button", { name, exact: true });
const weekToggle = (page: Page) => page.locator(".week-toggle");
const boxFold = (page: Page) => page.locator(".box-fold");

async function openScreen(page: Page, url: string): Promise<void> {
  const openFirst = async (list: string, row: string) => {
    await page.goto(list);
    await settle(page);
    const btn = page.locator(row).first();
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await settle(page);
  };
  if (url === OPEN_CARD) return openFirst("/", ".list .item-btn");
  if (url === OPEN_BUILDER) return openFirst("/#builder", "main .item .item-btn");
  if (url === OPEN_DEMAND) return openFirst("/#demand", "main .item .item-btn");
  if (url === OPEN_BOX) {
    await page.goto("/");
    await settle(page);
    return openBox(page);
  }
  if (url === CALENDAR || url === CALENDAR_PICKED) {
    await page.goto("/schedules");
    await settle(page);
    await page.getByRole("group", { name: "보기" }).getByRole("button", { name: "달력" }).click();
    await settle(page);
    await expect(page.locator(".cal")).toBeVisible();
    if (url === CALENDAR_PICKED) {
      const day = page.locator('.cal button.d[aria-label*="일정"]').first();
      await day.click();
      await expect(day).toHaveAttribute("aria-pressed", "true");
    }
    return;
  }
  await page.goto(url);
  if (await page.evaluate(`document.querySelector("#root") !== null && document.scripts.length > 0`)) await settle(page);
}

/** 화면마다 새 컨텍스트로 연다(탭 기억이 다음 화면에 넘어가지 않게) */
async function eachScreen(browser: Browser, urls: string[], fn: (page: Page, url: string) => Promise<void>, opts: BrowserContextOptions = {}): Promise<void> {
  for (const url of urls) {
    const { context, page } = await freshPage(browser, opts);
    try {
      await openScreen(page, url);
      await fn(page, url);
    } finally {
      await context.close();
    }
  }
}

/** 요소를 받는 화면 안 함수. 이 저장소의 tsconfig에 DOM 타입이 없어 본문을 글로 쓴다(Playwright는 함수의 글을 화면에 보낸다) */
function inPage<R>(body: string): (el: unknown, arg?: unknown) => R {
  return new Function("e", "arg", body) as (el: unknown, arg?: unknown) => R;
}

/** 페이지 맨 위 기준 윗선(스크롤과 관계없이) */
const pageTop = (el: Locator): Promise<number> => el.evaluate(inPage<number>("return e.getBoundingClientRect().top + window.scrollY;"));
/** 화면 기준 윗선 */
const viewTop = (el: Locator): Promise<number> => el.evaluate(inPage<number>("return e.getBoundingClientRect().top;"));

/** 칩 글 'IT·AI 3' → 이름과 건수. 건수가 없으면 null */
function parseChip(text: string): { name: string; count: number } | null {
  const m = /^(.+) (\d[\d,]*)$/.exec(text.trim());
  return m ? { name: m[1]!, count: Number(m[2]!.replaceAll(",", "")) } : null;
}

/** 거르기 칩 줄의 칩('안 읽은 것만' 토글은 거르기 칩이 아니라 뺀다) */
const filterChips = (group: Locator) => group.locator("button").filter({ hasNotText: "안 읽은 것만" });

// ---------------------------------------------------------------- 4.1 먼저 보일 것

async function expectBoxClosed(page: Page): Promise<void> {
  await expect(weekToggle(page)).toBeVisible();
  await expect(weekToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(boxFold(page)).toHaveCount(0);
}

async function expectBoxOpen(page: Page): Promise<void> {
  await expect(boxFold(page)).toBeVisible();
  await expect(boxFold(page)).toHaveAttribute("aria-expanded", "true");
  await expect(weekToggle(page)).toHaveCount(0);
}

/** 상자를 펼친다. 이미 펼쳐져 있으면(처음 상태를 보는 것이 아닌 테스트) 그대로 둔다 */
async function openBox(page: Page): Promise<void> {
  if ((await boxFold(page).count()) === 0) await weekToggle(page).click();
  await expectBoxOpen(page);
}

test.describe("4.1-1 일정 상자의 처음 상태(S6)", () => {
  test("(a) 빈 로컬 스토리지로 연 브리프에서 상자는 접힌 줄이고 aria-expanded=false다", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await openScreen(page, "/");
    await expectBoxClosed(page);
    await context.close();
  });

  test("(b) 펼친 뒤 날짜 화살표와 섹션 탭을 바꿔도 펼친 채다", async ({ page }) => {
    await openScreen(page, "/");
    await openBox(page);
    await page.locator('.bar .arrow[aria-label^="이전 날짜"]').click();
    await expect(page).toHaveURL(/\/2026-11-05$/);
    await settle(page);
    await expectBoxOpen(page);
    await sectionTab(page, "세계").click();
    await expect(sectionTab(page, "세계")).toHaveAttribute("aria-pressed", "true");
    await expectBoxOpen(page);
    await page.locator('.bar .arrow[aria-label^="다음 날짜"]').click();
    await expect(page).toHaveURL(/\/2026-11-06$/);
    await settle(page);
    await expectBoxOpen(page);
  });

  test("(c) 펼친 뒤 새로 고치거나 같은 컨텍스트의 새 탭에서 /를 열면 접힌 채다", async ({ page, context }) => {
    await openScreen(page, "/");
    await openBox(page);
    await page.reload();
    await settle(page);
    await expectBoxClosed(page);
    await openBox(page);
    const other = await context.newPage();
    await other.clock.setFixedTime(NOW);
    await openScreen(other, "/");
    await expectBoxClosed(other);
  });

  test("(d) 펼친 채 이슈 페이지로 갔다 브라우저 뒤로를 누르면 펼친 채다", async ({ page }) => {
    await openScreen(page, "/");
    await openBox(page);
    const story = listOf(LATEST).sections.flatMap((s) => s.stories).find((s) => s.kind === "top" && s.issue)!;
    if (!(await itemOf(page, story.key).isVisible())) await sectionTab(page, story.section).click();
    await itemBtn(page, story.key).click();
    await itemOf(page, story.key).locator(".detail .story a").first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await page.goBack();
    await settle(page);
    await expectBoxOpen(page);
  });

  test("(e) 펼친 채 메뉴의 '최근 브리프'를 누르면 접힌 채다", async ({ page }) => {
    await openScreen(page, "/");
    await openBox(page);
    await page.getByRole("button", { name: "메뉴" }).click();
    await page.locator("#site-menu").getByRole("link", { name: "최근 브리프" }).click();
    await settle(page);
    await expectBoxClosed(page);
  });
});

test.describe("4.1-2 저장 키 정리(S6·S7)", () => {
  test("로컬 스토리지에 tidwyn.weekBox=open을 넣고 열면 상자가 접힌 채이고 그 값이 지워진다", async ({ page }) => {
    await openScreen(page, "/about");
    await page.evaluate(`localStorage.setItem("tidwyn.weekBox", "open")`);
    await openScreen(page, "/");
    await expectBoxClosed(page);
    expect(await page.evaluate(`localStorage.getItem("tidwyn.weekBox")`)).toBeNull();
  });
});

test.describe("4.1-3 요약·키워드는 뉴스 탭에만", () => {
  test("/(기본 '한국')·'전체' 탭에는 요약·키워드가 있고 영상·빌더·수요 탭에는 없다. 상자는 모든 탭에 있다", async ({ browser }) => {
    const seen: Record<string, { headline: number; kw: number; box: number }> = {};
    const count = async (page: Page) => ({ headline: await page.locator("main .headline").count(), kw: await page.locator("main .kw").count(), box: await weekToggle(page).count() });
    await eachScreen(browser, ["/", "/#videos", "/#builder", "/#demand"], async (page, url) => {
      if (url === "/") {
        await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText("한국");
        seen["/"] = await count(page);
        await sectionTab(page, "전체").click();
        await expect(sectionTab(page, "전체")).toHaveAttribute("aria-pressed", "true");
        seen["전체"] = await count(page);
        return;
      }
      seen[url] = await count(page);
    });
    expect(seen).toEqual({
      "/": { headline: 1, kw: 1, box: 1 },
      전체: { headline: 1, kw: 1, box: 1 },
      "/#videos": { headline: 0, kw: 0, box: 1 },
      "/#builder": { headline: 0, kw: 0, box: 1 },
      "/#demand": { headline: 0, kw: 0, box: 1 },
    });
  });
});

test.describe("4.1-4 첫 화면의 위계(375)", () => {
  test("첫 뉴스 줄 윗선 ≤ 360, 빌더 탭 첫 항목 ≤ 240, 수요 탭 첫 항목 ≤ 270", async ({ browser }) => {
    const tops: Record<string, number> = {};
    const want: Record<string, [string, number]> = { "/": [".list .item", 360], "/#builder": ["main .item", 240], "/#demand": ["main .item", 270] };
    await eachScreen(browser, Object.keys(want), async (page, url) => {
      expect(await page.evaluate("window.scrollY")).toBe(0);
      tops[url] = Math.round(await pageTop(page.locator(want[url]![0]).first()));
    });
    for (const [url, [, max]] of Object.entries(want)) expect(tops[url], `${url} 첫 줄 윗선 ${JSON.stringify(tops)}`).toBeLessThanOrEqual(max);
  });
});

// ---------------------------------------------------------------- 4.2 빌더·수요 항목 접기

/** 키보드로 Tab을 눌러 그 항목의 줄 버튼에 닿는다 */
async function tabTo(page: Page, key: string, max = 80): Promise<void> {
  const here = `(() => { const a = document.activeElement; return !!a && a.matches(".item-btn") && a.closest("li")?.id === ${JSON.stringify(`story-${key}`)}; })()`;
  for (let i = 0; i < max; i++) {
    if (await page.evaluate(here)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab으로 ${key} 줄 버튼에 닿지 못했다`);
}

test.describe("4.2-1 줄 전체가 펼침 버튼", () => {
  test("빌더·수요 탭의 모든 항목이 처음에 접혀 있고, 누르면 펼쳐지며 다른 줄을 누르면 앞의 것이 접힌다", async ({ page }) => {
    const cases = [
      { url: `/${LATEST}#builder`, keys: TOOLS[LATEST]!.map((x) => x.key) },
      { url: "/2026-10-27#builder", keys: [...TOOLS["2026-10-27"]!, ...DISCOVERIES["2026-10-27"]!].map((x) => x.key) },
      { url: `/${LATEST}#demand`, keys: FLOWS[LATEST]!.map((x) => x.key) },
    ];
    for (const { url, keys } of cases) {
      await openScreen(page, url);
      expect(keys.length, url).toBeGreaterThan(1);
      await expect(page.locator("main .item")).toHaveCount(keys.length);
      for (const k of keys) {
        await expect(itemBtn(page, k), `${url} ${k}`).toHaveAttribute("aria-expanded", "false");
        await expect(itemOf(page, k).locator(".detail")).toHaveCount(0);
      }
      const [a, b] = keys as [string, string];
      await itemBtn(page, a).click();
      await expect(itemBtn(page, a)).toHaveAttribute("aria-expanded", "true");
      await expect(itemOf(page, a).locator(".detail h4.h").first()).toBeVisible();
      await itemBtn(page, b).click();
      await expect(itemBtn(page, b)).toHaveAttribute("aria-expanded", "true");
      await expect(itemOf(page, b).locator(".detail h4.h").first()).toBeVisible();
      await expect(itemBtn(page, a)).toHaveAttribute("aria-expanded", "false");
      await expect(itemOf(page, a).locator(".detail")).toHaveCount(0);
    }
  });

  test("키보드: Tab으로 줄 버튼에 닿아 Enter로 펼치고, 다음 줄에서 Space로 펼치면 앞의 것이 접힌다", async ({ page }) => {
    for (const { url, keys } of [
      { url: `/${LATEST}#builder`, keys: TOOLS[LATEST]!.map((x) => x.key) },
      { url: `/${LATEST}#demand`, keys: FLOWS[LATEST]!.map((x) => x.key) },
    ]) {
      await openScreen(page, url);
      const [a, b] = keys as [string, string];
      await page.locator("#main").focus();
      await tabTo(page, a);
      await page.keyboard.press("Enter");
      await expect(itemBtn(page, a)).toHaveAttribute("aria-expanded", "true");
      await tabTo(page, b);
      await page.keyboard.press("Space");
      await expect(itemBtn(page, b)).toHaveAttribute("aria-expanded", "true");
      await expect(itemBtn(page, a)).toHaveAttribute("aria-expanded", "false");
    }
  });
});

/** 펼친 칸에서 칸 이름(h4) 바로 다음 문단의 글 */
async function detailField(item: Locator, label: string): Promise<string | null> {
  return item.evaluate(inPage<string | null>('const h = [...e.querySelectorAll(".detail h4.h")].find((x) => x.textContent.trim() === arg); return h ? h.nextElementSibling.textContent.trim() : null;'), label);
}

test.describe("4.2-2 접힌 줄의 칸", () => {
  test("빌더·수요 모든 항목의 접힌 줄 안에 a가 없고, 보이는 칸 제목이 정해진 것뿐이며, '없음' 칸은 빠지고, 정정은 '정정됨'이 남는다", async ({ page }) => {
    const bad: string[] = [];
    const check = async (date: string, key: string, want: string[], fixed: boolean) => {
      const btn = itemBtn(page, key);
      await expect(btn, `${date} ${key}`).toBeVisible();
      const got = {
        links: await btn.locator("a").count(),
        heads: await btn.locator("h4").count(),
        fields: (await btn.locator(".fold-k").allTextContents()).map((t) => t.trim()),
        fix: (await btn.innerText()).includes("정정됨"),
      };
      const exp = { links: 0, heads: 0, fields: want, fix: fixed };
      if (JSON.stringify(got) !== JSON.stringify(exp)) bad.push(`${date} ${key}: ${JSON.stringify(got)} ≠ ${JSON.stringify(exp)}`);
    };
    let noneAction = 0;
    let noneDue = 0;
    let fixes = 0;
    const builderDates = [...new Set([...Object.keys(TOOLS), ...Object.keys(DISCOVERIES)])].sort();
    for (const date of builderDates) {
      await openScreen(page, `/${date}#builder`);
      for (const t of TOOLS[date] ?? []) {
        await check(date, t.key, [...(t.action !== "없음" ? ["지금 할 일"] : []), ...(t.due ? ["기한"] : [])], !!t.corrections?.length);
        if (t.corrections?.length) fixes++;
        if (t.action === "없음" || !t.due) {
          // 펼친 칸에는 '없음' 칸이 그대로 있다
          await itemBtn(page, t.key).click();
          await expect(itemBtn(page, t.key)).toHaveAttribute("aria-expanded", "true");
          if (t.action === "없음") {
            noneAction++;
            expect(await detailField(itemOf(page, t.key), "지금 할 일"), `${date} ${t.key} 지금 할 일`).toBe("없음");
          }
          if (!t.due) {
            noneDue++;
            expect(await detailField(itemOf(page, t.key), "기한"), `${date} ${t.key} 기한`).toBe("없음");
          }
        }
      }
      for (const d of DISCOVERIES[date] ?? []) {
        await check(date, d.key, ["용도"], !!d.corrections?.length);
        if (d.corrections?.length) fixes++;
      }
    }
    for (const date of Object.keys(FLOWS).sort()) {
      await openScreen(page, `/${date}#demand`);
      for (const f of FLOWS[date]!) {
        await check(date, f.key, ["요지", "근거 수준"], !!f.corrections?.length);
        if (f.corrections?.length) fixes++;
      }
    }
    expect(bad, "접힌 줄").toEqual([]);
    expect({ noneAction: noneAction > 0, noneDue: noneDue > 0, fixes: fixes > 0 }, "측정 데이터에 '없음' 칸과 정정 항목이 있다").toEqual({ noneAction: true, noneDue: true, fixes: true });
  });

  test("새 제품·뜨는 저장소의 펼친 칸 출처 링크 주소가 원문 주소(옛 이름 링크의 주소)와 같다", async ({ page }) => {
    const dates = Object.keys(DISCOVERIES).sort();
    expect(dates.length).toBeGreaterThan(0);
    let seen = 0;
    for (const date of dates) {
      await openScreen(page, `/${date}#builder`);
      for (const d of DISCOVERIES[date]!) {
        await itemBtn(page, d.key).click();
        await expect(itemBtn(page, d.key)).toHaveAttribute("aria-expanded", "true");
        const hrefs = await itemOf(page, d.key).locator(".detail .src a").evaluateAll(inPage<string[]>('return e.map((a) => a.getAttribute("href"));'));
        expect(hrefs, `${date} ${d.key}`).toEqual([d.url]);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

test.describe("4.2-3 펼친 칸", () => {
  test("펼친 빌더·수요 항목에 출처 링크, 제보 링크, (커뮤니티 근거가 있으면) 표본 설명이 있다", async ({ page }) => {
    const cases: { url: string; items: { key: string; samples: string[] }[] }[] = [
      { url: `/${LATEST}#builder`, items: TOOLS[LATEST]!.map((x) => ({ key: x.key, samples: [] })) },
      { url: "/2026-10-27#builder", items: [...TOOLS["2026-10-27"]!, ...DISCOVERIES["2026-10-27"]!].map((x) => ({ key: x.key, samples: [] })) },
      { url: `/${LATEST}#demand`, items: FLOWS[LATEST]!.map((x) => ({ key: x.key, samples: (x.community ?? []).map((c) => c.sample) })) },
      { url: "/2026-10-26#demand", items: FLOWS["2026-10-26"]!.map((x) => ({ key: x.key, samples: (x.community ?? []).map((c) => c.sample) })) },
    ];
    expect(cases.some((c) => c.items.some((i) => i.samples.length > 0)), "커뮤니티 근거가 있는 흐름").toBe(true);
    for (const { url, items } of cases) {
      await openScreen(page, url);
      for (const { key, samples } of items) {
        await itemBtn(page, key).click();
        await expect(itemBtn(page, key), `${url} ${key}`).toHaveAttribute("aria-expanded", "true");
        const detail = itemOf(page, key).locator(".detail");
        expect(await detail.locator(".src a[href^='http']").count(), `${url} ${key} 출처`).toBeGreaterThan(0);
        await expect(detail.locator("a.report"), `${url} ${key} 제보`).toHaveCount(1);
        await expect(detail.locator("a.report")).toHaveAttribute("href", /^mailto:/);
        const heads = (await detail.locator(".dsrc").allTextContents()).join("\n");
        for (const s of samples) expect(heads, `${url} ${key} 표본 설명`).toContain(s);
      }
    }
  });
});

test.describe("4.2-4 링크로 들어온 항목은 펼쳐 연다", () => {
  const remind = Object.entries(TOOLS).flatMap(([date, xs]) => xs.filter((x) => x.reminderOf).map((x) => ({ date, x })))[0]!;
  const cont = Object.entries(FLOWS).flatMap(([date, xs]) => xs.filter((x) => x.continues).map((x) => ({ date, x })))[0]!;

  test("다시 알림 링크와 수요 이어짐 링크를 누르면 원래 항목이 펼쳐져 보인다", async ({ page }) => {
    for (const { tab, date, key, link, to } of [
      { tab: "builder", date: remind.date, key: remind.x.key, link: ".detail .breminder", to: remind.x.reminderOf! },
      { tab: "demand", date: cont.date, key: cont.x.key, link: ".detail .dcont", to: cont.x.continues! },
    ]) {
      await openScreen(page, `/${date}#${tab}`);
      await itemBtn(page, key).click();
      await expect(itemBtn(page, key)).toHaveAttribute("aria-expanded", "true");
      await itemOf(page, key).locator(link).click();
      await expect(page).toHaveURL(new RegExp(`/${to.date}#${encodeURIComponent(to.key)}$`));
      await settle(page);
      await expect(itemBtn(page, to.key)).toHaveAttribute("aria-expanded", "true");
      await expect(itemOf(page, to.key).locator(".detail h4.h").first()).toBeInViewport();
    }
  });

  test("펼친 항목에서 이슈 페이지로 간 뒤 브라우저 뒤로를 누르면 그 항목이 펼쳐진 채다", async ({ page }) => {
    for (const { tab, key } of [
      { tab: "builder", key: TOOLS[LATEST]!.find((x) => x.issue)!.key },
      { tab: "demand", key: FLOWS[LATEST]!.find((x) => x.issue)!.key },
    ]) {
      await openScreen(page, `/${LATEST}#${tab}`);
      await itemBtn(page, key).click();
      await expect(itemBtn(page, key)).toHaveAttribute("aria-expanded", "true");
      await itemOf(page, key).locator(".detail .brel a").click();
      await expect(page).toHaveURL(/\/issues\/\d+$/);
      await settle(page);
      await page.goBack();
      await settle(page);
      await expect(itemBtn(page, key), `${tab} ${key}`).toHaveAttribute("aria-expanded", "true");
    }
  });
});

test.describe("4.2-5 빌더·수요 탭 목표 값(375)", () => {
  test("빌더 탭 높이 ≤ 1600, 첫 도구 변화의 접힌 줄 기한 글 윗선 ≤ 420, 수요 탭 높이 ≤ 1800", async ({ browser }) => {
    const got: Record<string, number> = {};
    await eachScreen(browser, ["/#builder", "/#demand"], async (page, url) => {
      got[`${url} 높이`] = await page.evaluate("document.scrollingElement.scrollHeight");
      if (url === "/#builder") {
        const first = TOOLS[LATEST]![0]!;
        expect(first.due).not.toBeNull();
        const due = itemBtn(page, first.key).locator(".fold-f", { has: page.locator(".fold-k", { hasText: "기한" }) });
        await expect(due).toHaveCount(1);
        got["기한 윗선"] = Math.round(await pageTop(due));
      }
    });
    expect(got["/#builder 높이"], JSON.stringify(got)).toBeLessThanOrEqual(1600);
    expect(got["기한 윗선"], JSON.stringify(got)).toBeLessThanOrEqual(420);
    expect(got["/#demand 높이"], JSON.stringify(got)).toBeLessThanOrEqual(1800);
  });
});

test.describe("4.2-6 펼칠 때 화면 튐 막기(S10, overflow-anchor: none)", () => {
  /** 줄을 화면 y에 오게 스크롤한다. 페이지 끝이라 더 내려가지 못하면 그보다 아래(slack 안)에 둔다 */
  async function scrollRowTo(page: Page, row: Locator, y: number, slack = 0): Promise<void> {
    await row.evaluate(inPage<void>("window.scrollBy(0, e.getBoundingClientRect().top - arg);"), y);
    await frames(page);
    const top = await viewTop(row);
    expect(top - y, `스크롤한 자리 ${top}`).toBeGreaterThanOrEqual(-1);
    expect(top - y, `스크롤한 자리 ${top}`).toBeLessThanOrEqual(slack + 1);
  }
  /** 줄 버튼의 윗부분을 마우스로 누른다(Playwright가 다시 스크롤하지 않게) */
  async function pressRow(page: Page, row: Locator): Promise<void> {
    const box = (await row.locator(".item-btn").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(14, box.height / 2));
  }

  const cases = [
    { name: "뉴스 줄", url: "/", rows: (page: Page) => page.locator("main ul.list").first().locator(":scope > li") },
    { name: "수요 탭 첫·둘째 항목", url: "/#demand", rows: (page: Page) => page.locator("main ul.blist > li") },
  ];

  for (const c of cases) {
    async function start(page: Page): Promise<{ first: Locator; second: Locator }> {
      await openScreen(page, c.url);
      await page.addStyleTag({ content: "html, body, * { overflow-anchor: none !important; }" });
      const first = c.rows(page).nth(0);
      const second = c.rows(page).nth(1);
      await first.locator(".item-btn").click();
      await expect(first.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
      await settle(page);
      await expect(first.locator(".detail")).toBeVisible();
      await frames(page);
      return { first, second };
    }

    test(`${c.name} (a) 둘째 줄을 화면 y 150에 두고 누르면 그 윗선이 누르기 전과 ±2px 안이다`, async ({ page }) => {
      const { first, second } = await start(page);
      // 수요 탭은 페이지가 짧아 150까지 못 내려갈 수 있어 약 150(최대 270)으로 보고, 그 자리가 같은 y를 지킬 수 있는 자리인지 따로 확인한다
      await scrollRowTo(page, second, 150, 120);
      const before = await viewTop(second);
      const shrink = (await first.boundingBox())!.height - (await second.locator(".item-btn").boundingBox())!.height;
      expect(shrink, "첫 카드가 접히며 줄어드는 몫 ≤ 지금 스크롤(같은 y를 지킬 수 있는 자리)").toBeLessThanOrEqual(await page.evaluate("window.scrollY"));
      await pressRow(page, second);
      await expect(second.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
      await expect(first.locator(".item-btn")).toHaveAttribute("aria-expanded", "false");
      await settle(page);
      await frames(page);
      expect(Math.abs((await viewTop(second)) - before), `누르기 전 ${before}, 뒤 ${await viewTop(second)}`).toBeLessThanOrEqual(2);
    });

    test(`${c.name} (b) 첫 카드 끝을 읽은 자리(둘째 줄이 화면 아래쪽)에서 누르면 둘째 줄 윗선이 머리글 바로 아래다`, async ({ page }) => {
      const { first, second } = await start(page);
      // 둘째 줄 버튼이 아래 탭 바로 위에 오게 둔다(첫 카드의 끝을 읽은 자리)
      const tabsTop = await viewTop(page.locator("nav.tabs"));
      const btnH = (await second.locator(".item-btn").boundingBox())!.height;
      await scrollRowTo(page, second, Math.round(tabsTop - btnH - 8));
      const before = await viewTop(second);
      const firstH = (await first.boundingBox())!.height;
      // 같은 y를 지킬 수 없는 자리인지(첫 카드가 접혀 줄어드는 몫이 지금 스크롤보다 크다)
      expect(firstH - btnH, "첫 카드가 접히며 줄어드는 몫 > 지금 스크롤").toBeGreaterThan(await page.evaluate("window.scrollY"));
      await pressRow(page, second);
      await expect(second.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
      await expect(first.locator(".item-btn")).toHaveAttribute("aria-expanded", "false");
      await settle(page);
      await frames(page);
      const barBottom = await page.locator(".bar").evaluate(inPage<number>("return e.getBoundingClientRect().bottom;"));
      const after = await viewTop(second);
      expect(Math.abs(after - barBottom), `누르기 전 ${before}, 뒤 ${after}, 머리글 아랫선 ${barBottom}`).toBeLessThanOrEqual(2);
    });
  }
});

// ---------------------------------------------------------------- 4.3 거르기 칩

/** '더 보기'를 다 눌러 끝까지 펼친다 */
async function expandAll(page: Page): Promise<void> {
  const more = page.locator("main .more button");
  for (let i = 0; i < 40 && (await more.count()) > 0; i++) {
    await more.first().click();
    await settle(page);
  }
  await expect(more).toHaveCount(0);
}

/** 칩 줄의 칩마다 건수가 있고, 누르면 보이는 줄 수가 건수와 같다 */
async function checkChipCounts(page: Page, label: string, group: Locator, rows: () => Promise<number>): Promise<void> {
  const texts = (await filterChips(group).allTextContents()).map((t) => t.trim());
  expect(texts.length, `${label} 칩`).toBeGreaterThan(1);
  const bad: string[] = [];
  for (let i = 0; i < texts.length; i++) {
    const chip = parseChip(texts[i]!);
    if (!chip) {
      bad.push(`${label}: '${texts[i]}' 건수 없음`);
      continue;
    }
    const btn = filterChips(group).nth(i);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await settle(page);
    const n = await rows();
    if (n !== chip.count) bad.push(`${label}: '${texts[i]}' → 줄 ${n}`);
  }
  expect(bad, "칩 건수와 보이는 줄 수").toEqual([]);
}

test.describe("4.3-1 있는 값만, 건수", () => {
  const briefRows = (page: Page) => () => page.locator("main ul.list > li").count();

  test("브리프 '한국'·'IT·AI' 탭: 칩마다 건수가 있고 누르면 보이는 뉴스 줄 수가 건수와 같다('안 읽은 것만' 끔)", async ({ page }) => {
    for (const tab of ["한국", "IT·AI"]) {
      await openScreen(page, "/");
      await sectionTab(page, tab).click();
      await expect(sectionTab(page, tab)).toHaveAttribute("aria-pressed", "true");
      const group = page.getByRole("group", { name: "카테고리" });
      await expect(group.getByRole("button", { name: "안 읽은 것만" })).toHaveAttribute("aria-pressed", "false");
      // 있는 값만: 칩 이름이 그 탭의 분야와 같다
      const day = listOf(LATEST);
      const stories = day.sections.filter((s) => s.name === tab).flatMap((s) => s.stories);
      const majors = new Set(stories.map((s) => s.category.major));
      const names = (await filterChips(group).allTextContents()).slice(1).map((t) => parseChip(t)?.name ?? t.trim());
      expect(new Set(names), `${tab} 칩 이름`).toEqual(majors);
      await checkChipCounts(page, `브리프 ${tab}`, group, briefRows(page));
    }
  });

  test("영상 탭: 칩마다 건수가 있고 누르면 보이는 영상 줄 수가 건수와 같다", async ({ page }) => {
    await openScreen(page, `/${VIDEO_DATE}#videos`);
    await checkChipCounts(page, "영상", page.getByRole("group", { name: "영상 묶음" }), () => page.locator("main [data-video]").count());
  });

  test("이슈 목록: 두 줄의 칩마다 건수가 있고(다른 줄이 첫 칩일 때) 누르면 끝까지 펼친 줄 수가 건수와 같다. 다른 줄을 바꿔도 칩이 그대로다", async ({ page }) => {
    await openScreen(page, "/issues");
    const rows = async () => {
      await expandAll(page);
      return page.locator("main ul.list > li").count();
    };
    const major = page.getByRole("group", { name: "대분류" });
    const status = page.getByRole("group", { name: "상태" });
    const statusTexts = await filterChips(status).allTextContents();
    await checkChipCounts(page, "이슈 대분류", major, rows);
    // 대분류를 바꿔도 상태 칩 줄은 그대로다
    expect(await filterChips(status).allTextContents(), "대분류를 바꾼 뒤 상태 칩").toEqual(statusTexts);
    await filterChips(major).first().click();
    const majorTexts = await filterChips(major).allTextContents();
    await checkChipCounts(page, "이슈 상태", status, rows);
    expect(await filterChips(major).allTextContents(), "상태를 바꾼 뒤 대분류 칩").toEqual(majorTexts);
  });

  test("일정 목록 보기의 두 탭: 칩마다 건수가 있고 누르면 그 탭 전체(더 보기 끝까지) 줄 수가 건수와 같다", async ({ page }) => {
    for (const tab of ["다가오는 일정", "지난 일정"]) {
      await openScreen(page, "/schedules");
      const seg = page.getByRole("group", { name: "일정 구분" }).getByRole("button", { name: tab });
      await seg.click();
      await expect(seg).toHaveAttribute("aria-pressed", "true");
      await settle(page);
      await checkChipCounts(page, `일정 ${tab}`, page.getByRole("group", { name: "대분류" }), async () => {
        await expandAll(page);
        return page.locator("main .sch-body .ev").count();
      });
    }
  });

  test("일정 달력 보기: 칩마다 건수가 있고 누르면 그 달 날짜 칸의 '일정 N개' 합과 'N월 중' 줄 수의 합이 건수와 같다", async ({ page }) => {
    await openScreen(page, CALENDAR);
    await checkChipCounts(page, "일정 달력", page.getByRole("group", { name: "대분류" }), async () => {
      const labels = await page.locator(".cal button.d").evaluateAll(inPage<string[]>('return e.map((b) => b.getAttribute("aria-label"));'));
      const days = labels.reduce((n, l) => n + Number(/일정 (\d+)개/.exec(l)?.[1] ?? 0), 0);
      return days + (await page.locator("main .sch-body section.mon .ev").count());
    });
  });

  test("인물 목록: 칩마다 건수가 있고 누르면 끝까지 펼친 줄 수가 건수와 같다", async ({ page }) => {
    await openScreen(page, "/entities");
    await checkChipCounts(page, "인물 종류", page.getByRole("group", { name: "종류" }), async () => {
      await expandAll(page);
      return page.locator("main ul.list > li").count();
    });
  });
});

test.describe("4.3-2 첫 칩 글", () => {
  test("칩 줄의 첫 칩은 정해진 글로 시작하고, 모든 칩 글에 건수가 있으며 섹션 탭 이름과 같지 않다", async ({ page }) => {
    const groups = [
      { url: "/", label: "카테고리", first: "모든 분야" },
      { url: `/${VIDEO_DATE}#videos`, label: "영상 묶음", first: "모든 영상" },
      { url: "/issues", label: "대분류", first: "모든 분야" },
      { url: "/issues", label: "상태", first: "모든 상태" },
      { url: "/schedules", label: "대분류", first: "모든 분야" },
      { url: "/entities", label: "종류", first: "모든 종류" },
    ];
    const bad: string[] = [];
    for (const g of groups) {
      await openScreen(page, g.url);
      const texts = (await filterChips(page.getByRole("group", { name: g.label })).allTextContents()).map((t) => t.trim());
      expect(texts.length, `${g.url} ${g.label}`).toBeGreaterThan(1);
      if (!texts[0]!.startsWith(g.first) || texts[0]!.startsWith("전체")) bad.push(`${g.url} ${g.label}: 첫 칩 '${texts[0]}'`);
      for (const t of texts) {
        if (SECTION_NAMES.includes(t)) bad.push(`${g.url} ${g.label}: 섹션 탭 이름과 같은 칩 '${t}'`);
        if (!parseChip(t)) bad.push(`${g.url} ${g.label}: 건수 없는 칩 '${t}'`);
      }
    }
    expect(bad).toEqual([]);
  });
});

test.describe("4.3-3 고른 값이 사라지면 첫 칩(S12)", () => {
  test("'전체' 탭에서 '한국' 탭에 없는 분야 칩을 고르고 '한국' 탭으로 바꾸면 '모든 분야'가 골라져 있고 뉴스 줄이 보인다", async ({ page }) => {
    const day = listOf(LATEST);
    const korea = new Set(day.sections.filter((s) => s.name === "한국").flatMap((s) => s.stories.map((x) => x.category.major)));
    const missing = [...new Set(day.sections.flatMap((s) => s.stories.map((x) => x.category.major)))].find((m) => !korea.has(m));
    expect(missing, "'한국' 탭에 없는 분야").toBeDefined();
    await openScreen(page, "/");
    await sectionTab(page, "전체").click();
    const group = page.getByRole("group", { name: "카테고리" });
    const chip = filterChips(group).filter({ hasText: new RegExp(`^${missing!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`) });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await sectionTab(page, "한국").click();
    await expect(sectionTab(page, "한국")).toHaveAttribute("aria-pressed", "true");
    await expect(filterChips(group).first()).toHaveText(/^모든 분야/);
    await expect(filterChips(group).first()).toHaveAttribute("aria-pressed", "true");
    expect(await page.locator("main ul.list > li").count()).toBeGreaterThan(0);
    await expect(page.getByText("이 분류의 뉴스가 없다.")).toHaveCount(0);
  });

  test("대분류 칩이 없는 탭(영상)에 갔다 와도 고른 분야는 그대로다(그 탭의 빈 목록으로 첫 칩으로 돌리지 않는다)", async ({ page }) => {
    await openScreen(page, "/");
    const group = page.getByRole("group", { name: "카테고리" });
    const chip = filterChips(group).nth(1);
    const text = (await chip.textContent())!;
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await page.locator("nav.tabs button", { hasText: /^영상/ }).click();
    await expect(page.getByRole("group", { name: "영상 묶음" })).toBeVisible();
    await sectionTab(page, "한국").click();
    await expect(filterChips(group).filter({ hasText: text })).toHaveAttribute("aria-pressed", "true");
  });

  test("인물 목록에 0건인 종류(?kind=)로 들어오면 첫 칩으로 돌아가고 주소도 바뀐다", async ({ page }) => {
    // 측정 데이터에는 0건인 종류가 없어, 국가 첫 쪽 파일 요청에 0건 응답(지어낸 값)을 준다
    await fulfillData(page, "entity-list-country-0.json", { filter: "country", page: 0, pages: 0, total: 0, items: [] });
    await openScreen(page, "/entities?kind=country");
    await expect(page).toHaveURL(/\/entities$/);
    const group = page.getByRole("group", { name: "종류" });
    await expect(filterChips(group).first()).toHaveText(/^모든 종류/);
    await expect(filterChips(group).first()).toHaveAttribute("aria-pressed", "true");
    await expect(filterChips(group).filter({ hasText: /^국가/ })).toHaveCount(0);
    expect(await page.locator("main ul.list > li").count()).toBeGreaterThan(0);
  });
});

test.describe("4.3-4 칩 줄 넘침 표시(S11, 375)", () => {
  test("브리프 '전체' 탭과 이슈 목록에서 칩 줄이 넘치면 일부만 보이는 칩이 있고, 넘치지 않으면 모든 칩이 줄 안에 있다", async ({ page }) => {
    const bad: string[] = [];
    for (const url of ["/", "/issues"]) {
      await openScreen(page, url);
      if (url === "/") await sectionTab(page, "전체").click();
      for (const row of await page.locator("main .chips").all()) {
        const r = await row.evaluate(
          inPage<{ over: boolean; partial: boolean; inside: boolean; label: string }>(`
            const box = e.getBoundingClientRect();
            const right = box.right - (parseFloat(getComputedStyle(e).borderRightWidth) || 0);
            const chips = [...e.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
            return {
              label: e.getAttribute("aria-label"),
              over: e.scrollWidth > e.clientWidth,
              partial: chips.some((c) => c.right > right + 0.5 && c.left < right - 0.5),
              inside: chips.every((c) => c.right <= right + 0.5 && c.left >= box.left - 0.5),
            };`),
        );
        if (r.over ? !r.partial : !r.inside) bad.push(`${url} ${r.label}: ${JSON.stringify(r)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("칩 사이 틈이 줄 끝에 걸리는 폭(320)에서도 넘치는 동안 줄 오른쪽 끝이 흐려지고, 끝까지 밀면 흐림이 없어진다", async ({ browser }) => {
    const { context, page } = await freshPage(browser, { viewport: { width: 320, height: 700 } });
    await openScreen(page, "/");
    await sectionTab(page, "전체").click();
    const row = page.locator("main .chips").first();
    const state = () =>
      row.evaluate(
        inPage<{ over: boolean; more: boolean; mask: string }>(`
          const s = getComputedStyle(e);
          return { over: e.scrollWidth > e.clientWidth, more: e.hasAttribute("data-more"), mask: s.maskImage || s.webkitMaskImage || "none" };`),
      );
    await expect.poll(async () => (await state()).more).toBe(true);
    const start = await state();
    expect(start.over).toBe(true);
    expect(start.mask).not.toBe("none");
    await row.evaluate(inPage<void>(`e.scrollLeft = e.scrollWidth;`));
    await expect.poll(async () => (await state()).more).toBe(false);
    await context.close();
  });

  /** 줄의 표시가 '마지막 칩이 줄 오른쪽 끝에 잘리는가'와 같은지. 끝 padding만 넘치는 것은 더 있는 칩이 아니다 */
  const moreMatchesHidden = (row: Locator) =>
    row.evaluate(
      inPage<{ hidden: boolean; more: boolean }>(`
        const box = e.getBoundingClientRect();
        const last = [...e.querySelectorAll("button")].pop().getBoundingClientRect();
        return { hidden: last.right > box.right + 1, more: e.hasAttribute("data-more") };`),
    );

  test("흐림 표시는 마지막 칩이 줄 끝에 잘릴 때만 켜진다(끝 여백만 넘치면 켜지지 않는다), 320·375·1280", async ({ browser }) => {
    const bad: string[] = [];
    for (const width of [320, 375, 1280]) {
      const { context, page } = await freshPage(browser, { viewport: { width, height: 800 }, hasTouch: width < 768 });
      for (const url of ["/", "/issues", "/entities", "/schedules"]) {
        await openScreen(page, url);
        for (const row of await page.locator("main .chips").all()) {
          await frames(page);
          // 끝 여백 몇 px만 남기고 민 자리도 본다
          for (const left of [0, -10]) {
            await row.evaluate(inPage<void>(`e.scrollLeft = arg < 0 ? e.scrollWidth - e.clientWidth + arg : arg;`), left);
            await frames(page);
            const r = await moreMatchesHidden(row);
            if (r.more !== r.hidden) bad.push(`${width} ${url} scroll ${left}: ${JSON.stringify(r)}`);
          }
        }
      }
      await context.close();
    }
    expect(bad).toEqual([]);
  });

  test("키보드로 칩에 가면 그 칩이 흐린 끝 48px에 걸리지 않는다(320)", async ({ browser }) => {
    const { context, page } = await freshPage(browser, { viewport: { width: 320, height: 700 } });
    await openScreen(page, "/");
    await sectionTab(page, "전체").click();
    const row = page.locator("main .chips").first();
    const buttons = await row.locator("button").all();
    const bad: string[] = [];
    for (const [i, b] of buttons.entries()) {
      // 키를 한 번 눌러 키보드 조작으로 둔 뒤 첫 칩에 포커스를 두고, 그 뒤는 Tab으로 차례로 간다(:focus-visible)
      if (i === 0) {
        await page.keyboard.press("Shift");
        await b.focus();
      } else await page.keyboard.press("Tab");
      await expect(b).toBeFocused();
      await frames(page);
      const r = await b.evaluate(
        inPage<{ right: number; edge: number; more: boolean }>(`
          const row = e.closest(".chips"); const box = row.getBoundingClientRect();
          return { right: e.getBoundingClientRect().right, edge: box.right - 48, more: row.hasAttribute("data-more") };`),
      );
      if (r.more && r.right > r.edge + 0.5) bad.push(`${i}: ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
    await context.close();
  });

  test("흐린 끝에 걸린 칩을 마우스로 눌러도 줄이 밀리지 않고 그 칩이 골라진다(320, 마우스)", async ({ browser }) => {
    const { context, page } = await freshPage(browser, { viewport: { width: 320, height: 700 }, hasTouch: false });
    await openScreen(page, "/");
    await sectionTab(page, "전체").click();
    const row = page.locator("main .chips").first();
    await expect(row).toHaveAttribute("data-more", "");
    // 줄 오른쪽 끝(흐린 자리)에 걸린 칩의 보이는 부분 오른쪽을 누른다
    const hit = await row.evaluate(
      inPage<{ index: number; x: number; y: number }>(`
        const box = e.getBoundingClientRect(); const bs = [...e.querySelectorAll("button")];
        const index = bs.findIndex((b) => { const r = b.getBoundingClientRect(); return r.right > box.right - 48 && r.left < box.right - 8; });
        if (index < 0) return { index, x: 0, y: 0 };
        const r = bs[index].getBoundingClientRect();
        return { index, x: Math.min(r.right, box.right) - 6, y: r.top + r.height / 2 };`),
    );
    expect(hit.index, "흐린 끝에 걸린 칩이 없다(데이터나 폭이 바뀌었으면 고른 화면을 다시 본다)").toBeGreaterThan(0);
    const before = await row.evaluate(inPage<number>("return e.scrollLeft;"));
    await page.mouse.click(hit.x, hit.y);
    await expect(row.locator("button").nth(hit.index)).toHaveAttribute("aria-pressed", "true");
    expect(await row.evaluate(inPage<number>("return e.scrollLeft;"))).toBe(before);
    await context.close();
  });
});

test.describe("강제 색 모드의 알약 링크(design-check·결과 검토)", () => {
  /** 보통 모드와 강제 색 모드에서 같은 링크의 크기와 테두리 색, 바탕색 */
  const pill = (page: Page, sel: string) =>
    page.locator(sel).first().evaluate(
      inPage<{ w: number; h: number; border: string; borderWidth: number; canvas: string }>(`
        const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
        return { w: Math.round(r.width), h: Math.round(r.height), border: s.borderTopColor, borderWidth: parseFloat(s.borderTopWidth), canvas: getComputedStyle(document.body).backgroundColor };`),
    );

  for (const [name, url, sel, js] of [
    ["빌더 관련 이슈", "/2026-11-06#builder-1", "main .brel a", true],
    ["정적 이슈 페이지의 관련 알약", "/issues/28", ".static-page .rel a", false],
  ] as const) {
    test(`${name}: 강제 색 모드에서도 크기가 같고, 넓힌 칸의 테두리가 보이지 않는다(375)`, async ({ browser }) => {
      const { context, page } = await freshPage(browser, { javaScriptEnabled: js });
      await page.goto(url);
      if (js) await settle(page);
      const normal = await pill(page, sel);
      await page.emulateMedia({ forcedColors: "active" });
      // 크기와 색은 읽을 때 다시 계산된다(정적 페이지는 스크립트가 꺼져 있어 프레임을 기다리지 않는다)
      if (js) await frames(page);
      const forced = await pill(page, sel);
      expect({ w: forced.w, h: forced.h }).toEqual({ w: normal.w, h: normal.h });
      if (name === "빌더 관련 이슈") {
        expect(forced.border === forced.canvas || forced.borderWidth === 0).toBe(true);
        // 테두리를 칠하는 동안에는 링크의 칸이 위의 '관련 이슈' 제목 글자에 닿지 않는다(바탕색 테두리가 글자를 지우지 않게)
        const gap = await page.locator(sel).first().evaluate(inPage<number>(`const h = e.closest(".rel").previousElementSibling; return e.getBoundingClientRect().top - h.getBoundingClientRect().bottom;`));
        expect(forced.borderWidth === 0 || gap >= 0, `테두리 ${forced.borderWidth}px, 제목과 틈 ${gap}px`).toBe(true);
      }
      await context.close();
    });
  }
});

// ---------------------------------------------------------------- 4.4 누를 곳

/** 측정 도구(shoot.mjs의 smallTargets)와 같은 판정: 보이는 누를 곳 중 너비나 높이가 min보다 작은 것 */
async function smallTargets(page: Page, min: number): Promise<string[]> {
  return page.evaluate(`(() => {
    const visible = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0; };
    const sel = 'a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [tabindex]:not([tabindex="-1"])';
    return [...document.body.querySelectorAll("*")].filter(visible).filter((el) => el.matches(sel)).filter((el) => { const r = el.getBoundingClientRect(); return r.width < ${min} || r.height < ${min}; }).map((el) => {
      const r = el.getBoundingClientRect();
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "";
      return el.tagName.toLowerCase() + cls + " '" + (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30) + "' " + Math.round(r.width) + "x" + Math.round(r.height);
    });
  })()`);
}

test.describe("4.4-1 누를 곳 크기", () => {
  test("375: 화면 18곳과 펼친 카드·상자·빌더·수요 항목, 달력 보기(날짜 고름 포함)에서 44px 미만 누를 곳이 0개다", async ({ browser }) => {
    test.setTimeout(180_000);
    const bad: string[] = [];
    await eachScreen(browser, [...SCREENS, ...STATES], async (page, url) => {
      for (const t of await smallTargets(page, 44)) bad.push(`${url}: ${t}`);
    });
    expect(bad, "44px 미만").toEqual([]);
  });

  test("1280: 같은 화면에서 24px 미만 누를 곳이 0개다", async ({ browser }) => {
    test.setTimeout(180_000);
    const bad: string[] = [];
    await eachScreen(
      browser,
      [...SCREENS, ...STATES],
      async (page, url) => {
        for (const t of await smallTargets(page, 24)) bad.push(`${url}: ${t}`);
      },
      { viewport: DESKTOP, hasTouch: false },
    );
    expect(bad, "24px 미만").toEqual([]);
  });
});

test.describe("4.4-2 넓힌 누를 곳이 이웃과 겹치지 않음", () => {
  test("빌더 줄 끝의 펼침 표시: 읽음 버튼 칸에 겹친 자리는 읽음이 바뀌고, 겹치지 않은 표시를 누르면 줄이 펼쳐진다", async ({ page }) => {
    // 새 제품·저장소 줄은 짧아 펼침 표시(줄 끝, 읽음 버튼 아래)가 읽음 버튼의 누를 칸 안에 오고, 도구 변화 줄은 길어 칸 밖에 온다
    await openScreen(page, "/2026-10-27#builder");
    const rows = page.locator("main li.bitem");
    let over = 0;
    let outside = 0;
    for (let i = 0; i < (await rows.count()); i++) {
      const row = rows.nth(i);
      await row.scrollIntoViewIfNeeded();
      const rd = (await row.locator(".rd-btn").boundingBox())!;
      const mk = (await row.locator(".fold-mark").boundingBox())!;
      const x = mk.x + mk.width / 2;
      const y = mk.y + mk.height / 2;
      const inRd = x >= rd.x && x <= rd.x + rd.width && y >= rd.y && y <= rd.y + rd.height;
      if (inRd) {
        over++;
        const before = await row.locator(".rd-btn").getAttribute("aria-pressed");
        await page.mouse.click(x, y);
        await expect(row.locator(".rd-btn")).not.toHaveAttribute("aria-pressed", before!);
        await expect(row.locator(".item-btn")).toHaveAttribute("aria-expanded", "false");
      } else if (outside === 0) {
        outside++;
        await page.mouse.click(x, y);
        await expect(row.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
        await row.locator(".item-btn").click();
        await expect(row.locator(".item-btn")).toHaveAttribute("aria-expanded", "false");
      }
    }
    expect(over, "펼침 표시가 읽음 버튼 칸 안에 오는 줄").toBeGreaterThan(0);
    expect(outside, "펼침 표시가 읽음 버튼 칸 밖에 오는 줄").toBeGreaterThan(0);
  });

  /**
   * 보이는 모양의 가운데 점에서 맨 위에 있는 누를 곳이 그 요소인지. 넓힌 여백(padding)을 뺀 안쪽의 가운데이고,
   * 줄을 바꾼 글 링크는 첫 줄 조각의 가운데다. 아니면 그 점에 있는 것을 돌려준다
   */
  const hitsItself = (el: Locator) =>
    el.evaluate(
      inPage<string | true>(`
        const r = e.getClientRects()[0];
        const c = getComputedStyle(e);
        const [pt, pb, pl, pr] = [c.paddingTop, c.paddingBottom, c.paddingLeft, c.paddingRight].map(parseFloat);
        const top = document.elementFromPoint(r.left + pl + (r.width - pl - pr) / 2, r.top + pt + (r.height - pt - pb) / 2);
        const t = top && top.closest('a[href], button, [role=tab], [role=button]');
        return t === e ? true : (t ? t.tagName + " '" + t.textContent.trim().slice(0, 30) + "'" : "누를 곳 아님(" + (top ? top.tagName : "없음") + ")");`),
    );

  test("칩 줄의 이웃 칩 가운데를 누르면 그 칩이 골라진다", async ({ page }) => {
    await openScreen(page, "/");
    const chips = filterChips(page.getByRole("group", { name: "카테고리" }));
    const n = Math.min(await chips.count(), 3);
    expect(n).toBeGreaterThan(1);
    for (let i = n - 1; i >= 0; i--) {
      const chip = chips.nth(i);
      expect(await hitsItself(chip), `칩 ${i} 가운데`).toBe(true);
      const box = (await chip.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(chip).toHaveAttribute("aria-pressed", "true");
    }
  });

  test("상자 탭 둘의 가운데를 누르면 그 탭이 골라진다", async ({ page }) => {
    await openScreen(page, OPEN_BOX);
    const tabs = page.locator(".box-tabs [role=tab]");
    await expect(tabs).toHaveCount(2);
    for (const i of [1, 0, 1]) {
      const tab = tabs.nth(i);
      expect(await hitsItself(tab), `상자 탭 ${i} 가운데`).toBe(true);
      const box = (await tab.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("소개 문단의 글 링크마다 가운데가 그 링크다", async ({ page }) => {
    await openScreen(page, "/about");
    const links = page.locator("main p a[href]");
    const n = await links.count();
    expect(n).toBeGreaterThan(1);
    const bad: string[] = [];
    for (let i = 0; i < n; i++) {
      const a = links.nth(i);
      await a.scrollIntoViewIfNeeded();
      const hit = await hitsItself(a);
      if (hit !== true) bad.push(`${i}: '${(await a.textContent())!.trim()}' 가운데 → ${hit}`);
    }
    expect(bad, "가운데가 다른 누를 곳인 링크").toEqual([]);
  });
});

// ---------------------------------------------------------------- 4.5 일정 이름 링크

const highlighted = (page: Page) => page.locator(".ev.hl");

test.describe("4.5 일정 이름 링크(S5)", () => {
  test("일정 화면에서 이름은 링크가 아니고, '출처 뉴스 ›'는 그 뉴스가 펼쳐진 브리프로, '빌더 항목 ›'은 그 항목이 펼쳐진 빌더 탭으로 간다", async ({ page }) => {
    await openScreen(page, "/schedules");
    const names = page.locator(".ev .t");
    expect(await names.count()).toBeGreaterThan(0);
    expect(await names.evaluateAll(inPage<number>('return e.filter((t) => t.closest("a")).length;')), "링크인 일정 이름").toBe(0);

    // 출처 뉴스: 처음 근거가 주요 뉴스(카드)인 다가오는 일정(측정 데이터의 일정 2, 근거 2026-10-22 '세계-3')
    await openScreen(page, "/schedules/2");
    const news = highlighted(page).getByRole("link", { name: /^출처 뉴스/ });
    await expect(news).toHaveText(/^출처 뉴스\s*›$/);
    await news.click();
    await expect(page).toHaveURL(new RegExp(`/2026-10-22#${encodeURIComponent("세계-3")}$`));
    await settle(page);
    await expect(itemBtn(page, "세계-3")).toHaveAttribute("aria-expanded", "true");

    // 빌더 항목: 근거 뉴스 없이 빌더 항목에서 온 일정(측정 데이터의 일정 900000, 11월 6일 'builder-1')
    await openScreen(page, "/schedules/900000");
    await expect(highlighted(page).getByRole("link", { name: /^출처 뉴스/ })).toHaveCount(0);
    const builder = highlighted(page).getByRole("link", { name: /^빌더 항목/ });
    await expect(builder).toHaveText(/^빌더 항목\s*›$/);
    await builder.click();
    await expect(page).toHaveURL(new RegExp(`/${LATEST}#builder-1$`));
    await settle(page);
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^빌더/);
    await expect(itemBtn(page, "builder-1")).toHaveAttribute("aria-expanded", "true");
  });

  test("브리프 상자 일정 줄·펼친 카드의 일정 칩·이슈 페이지 일정 줄·결과 '연기 →'의 이름은 일정 화면의 그 일정(강조 줄)으로 간다", async ({ page }) => {
    const expectSchedule = async (name: string) => {
      await expect(page).toHaveURL(/\/schedules\/\d+$/);
      await settle(page);
      await expect(highlighted(page)).toHaveCount(1);
      await expect(highlighted(page).locator(".t")).toHaveText(name);
    };
    // 브리프 상자의 일정 줄
    await openScreen(page, OPEN_BOX);
    const weekTab = page.getByRole("tab", { name: /일정/ });
    if ((await weekTab.getAttribute("aria-selected")) !== "true") await weekTab.click();
    const first = listOf(LATEST).week!.items[0]!;
    await page.locator(".wrow").first().click();
    await expectSchedule(first.name);
    // 펼친 카드의 일정 칩(11월 3일 'IT·AI-5')
    await openScreen(page, `/${PAST}`);
    await sectionTab(page, "IT·AI").click();
    await itemBtn(page, "IT·AI-5").click();
    const chip = itemOf(page, "IT·AI-5").locator(".detail a.evc").first();
    const chipName = (await chip.evaluate(inPage<string>('return [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();'))) as string;
    await chip.click();
    await expectSchedule(chipName);
    // 이슈 페이지의 일정 줄(이슈 27: 일정 11)
    await openScreen(page, "/issues/27");
    const row = page.locator(".ev-link").first();
    const rowName = (await row.locator(".t").textContent())!.trim();
    await row.click();
    await expectSchedule(rowName);
    // 일정 화면의 결과 '연기 → …'(일정 7 → 8)
    await openScreen(page, "/schedules/7");
    await highlighted(page).locator('a[href="/schedules/8"]').click();
    await expect(page).toHaveURL(/\/schedules\/8$/);
    await settle(page);
    await expect(highlighted(page)).toHaveAttribute("id", "schedule-8");
  });
});

// ---------------------------------------------------------------- 4.6 섹션 탭 Tab 순서

test.describe("4.6 섹션 탭 Tab 순서(S4·S14)", () => {
  const region = `(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return "body";
    if (a.matches(".skip")) return "skip";
    if (a.closest("nav.tabs")) return "tabs";
    if (a.closest("header.bar")) return "header";
    if (a.closest("main")) return "main";
    if (a.closest(".footer")) return "footer";
    return "other:" + a.tagName;
  })()`;

  for (const viewport of [PHONE, DESKTOP]) {
    test(`${viewport.width}: Tab을 누르면 건너뛰기 → 머리글 → 섹션 탭 → 본문 순으로 포커스가 간다`, async ({ browser }) => {
      const { context, page } = await freshPage(browser, { viewport, hasTouch: viewport === PHONE });
      await openScreen(page, "/");
      expect(await page.evaluate(region), "처음 포커스").toBe("body");
      const seq: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const r = (await page.evaluate(region)) as string;
        if (seq.at(-1) !== r) seq.push(r);
        if (r === "main") break;
      }
      expect(seq).toEqual(["skip", "header", "tabs", "main"]);
      await context.close();
    });

    test(`${viewport.width}: 탭 아랫선이 뷰포트 아랫선에 붙어 있고, 끝까지 스크롤하면 바닥글 마지막 링크가 탭에 가리지 않는다`, async ({ browser }) => {
      const { context, page } = await freshPage(browser, { viewport, hasTouch: viewport === PHONE });
      await openScreen(page, "/");
      const tabs = page.locator("nav.tabs");
      const bottom = () => tabs.evaluate(inPage<number>("return e.getBoundingClientRect().bottom;"));
      expect(Math.abs((await bottom()) - viewport.height), "맨 위에서 탭 아랫선").toBeLessThanOrEqual(1);
      await page.evaluate("window.scrollTo(0, document.scrollingElement.scrollHeight)");
      await frames(page);
      expect(Math.abs((await bottom()) - viewport.height), "끝에서 탭 아랫선").toBeLessThanOrEqual(1);
      const lastLink = page.locator(".footer a").last();
      const linkBottom = await lastLink.evaluate(inPage<number>("return e.getBoundingClientRect().bottom;"));
      expect(linkBottom, "바닥글 마지막 링크 아랫선 ≤ 탭 윗선").toBeLessThanOrEqual(await viewTop(tabs));
      await context.close();
    });
  }
});

// 시각 회귀(U2 design-check): 측정 데이터의 브리프 상태 중 다른 스냅샷에 없는 것(상자 접힘·펼침, 빌더·수요 탭의 접힌 줄과 펼친 항목, 탭 일곱 개)을 폭마다 찍는다.
// 375는 점검 촬영과 같게 터치로 본다. 시계는 위 beforeEach가 고정한다.
const VISUAL_STATES: [string, string][] = [
  ["브리프", "/"],
  ["펼친 상자", OPEN_BOX],
  ["빌더 탭", "/#builder"],
  ["펼친 빌더 항목", OPEN_BUILDER],
  ["수요 탭", "/#demand"],
  ["펼친 수요 항목", OPEN_DEMAND],
];
for (const [width, opts] of [[375, { viewport: PHONE, hasTouch: true }], [1280, { viewport: DESKTOP, hasTouch: false }]] as const) {
  test.describe(`시각 회귀 U2 ${width}`, () => {
    for (const [name, url] of VISUAL_STATES) {
      test(name, async ({ browser }) => {
        await eachScreen(browser, [url], async (page) => {
          await frames(page);
          await expect(page).toHaveScreenshot(`u2-${name}-${width}.png`, { animations: "disabled" });
        }, opts);
      });
    }
  });
}
