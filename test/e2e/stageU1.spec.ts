// U1단계 화면(E2E, 측정 데이터 E2E): 글자 크기 종류, 같은 역할 부품의 모양과 동작, 날짜 표기, 되돌아가기와 돌아올 때의 상태.
// 측정 데이터(명세서 용어: 감사의 정상 데이터, 2026-11-06까지 18일)로 따로 빌드한 사이트를 E2E_U1_PORT로 띄워 본다(test/e2e/prepare.ts). 데이터는 모두 지어낸 것이다.
// 브라우저 시계는 2026-11-06(KST 낮)에 고정한다. 영상이 30일 지나 숨지 않게, 일정의 '오늘'이 측정과 같게 하기 위해서다.
import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from "@playwright/test";
import { expect, fulfillData, test } from "./base.ts";
import { E2E_U1_BASE_URL, E2E_U1_DATA_DIR } from "./paths.ts";
import type { MonthList } from "../../src/siteTypes.ts";

test.use({ baseURL: E2E_U1_BASE_URL, viewport: { width: 375, height: 812 } });

const NOW = new Date("2026-11-06T12:00:00+09:00");
const LATEST = "2026-11-06";
const PAST = "2026-11-03";
const VIDEO_DATE = "2026-11-05";
/** 11월 5일 영상 중 구간 정리가 있는 AI 묶음 영상(측정 데이터) */
const VIDEO_ID = "Fx00000000c";

/** 화면 18곳(명세서 용어). 지어낸 데이터의 식별자는 측정 데이터 그대로다 */
const SCREENS = ["/", "/#videos", "/#builder", "/#demand", "/dates", "/issues", "/issues/28", "/entities", "/entities/1", "/terms", "/schedules", "/indicators", "/indicators/kospi", "/videos/2026-11-06/Fx000000008", "/search?q=가짜", "/about", "/privacy", "/no-such-page"];
/** 펼친 카드(첫 뉴스 줄을 누른 상태)를 나타내는 이름 */
const OPEN_CARD = "/ (펼친 카드)";

const SITE_DATA = path.join(E2E_U1_DATA_DIR, "site-data");
const listOf = (date: string) => (JSON.parse(fs.readFileSync(path.join(SITE_DATA, `list-${date.slice(0, 7)}.json`), "utf8")) as MonthList).days.find((d) => d.date === date)!;

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(NOW);
});

/** 새 컨텍스트(새 브라우저 탭 기록·저장소)의 페이지. 기본 픽스처와 같게 바깥 네트워크는 막고 시계를 고정한다 */
async function freshPage(browser: Browser, opts: BrowserContextOptions = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: E2E_U1_BASE_URL, viewport: { width: 375, height: 812 }, locale: "ko-KR", timezoneId: "Asia/Seoul", ...opts });
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

async function openScreen(page: Page, url: string): Promise<void> {
  if (url === OPEN_CARD) {
    await page.goto("/");
    await settle(page);
    await page.locator(".list .item-btn").first().click();
    await expect(page.locator(".list .item.open .detail .sum")).toBeVisible();
    await settle(page);
    return;
  }
  await page.goto(url);
  if (await page.evaluate(`document.querySelector("#root") !== null && document.scripts.length > 0`)) await settle(page);
}

/** 화면 18곳과 펼친 카드를 한 화면씩 새 컨텍스트로 연다(탭 기억이 다음 화면에 넘어가지 않게) */
async function eachScreen(browser: Browser, fn: (page: Page, url: string) => Promise<void>, opts: BrowserContextOptions = {}, urls: string[] = [...SCREENS, OPEN_CARD]): Promise<void> {
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

/** 화면에서 보이는 요소인지(측정 도구와 같은 기준: 보이고 넓이가 1px²보다 크다) */
const VISIBLE_FN = `(el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && (() => { const r = el.getBoundingClientRect(); return r.width * r.height > 1; })()`;
const DESCRIBE_FN = `(el) => el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "") + " '" + (el.textContent || "").trim().slice(0, 30) + "'"`;

/** 보이는 글자 요소(글 노드를 직접 가진 요소)의 계산된 font-size → 예시 요소 */
async function fontSizes(page: Page): Promise<Record<string, string>> {
  return page.evaluate(`(() => {
    const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
    const out = {};
    for (const el of document.body.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const hasText = el.matches("input:not([type=checkbox],[type=radio],[type=hidden]), textarea, select") || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const fs = getComputedStyle(el).fontSize;
      if (!(fs in out)) out[fs] = describe(el);
    }
    return out;
  })()`);
}

/** 토큰 색을 계산된 rgb로(prop은 color나 backgroundColor) */
async function tokenColor(page: Page, token: string, prop: "color" | "backgroundColor" = "color"): Promise<string> {
  return page.evaluate(`(() => {
    const s = document.createElement("span");
    s.style.${prop} = "var(${token})";
    document.body.append(s);
    const c = getComputedStyle(s).${prop};
    s.remove();
    return c;
  })()`);
}

/** 요소를 받는 화면 안 함수. 이 저장소의 tsconfig에 DOM 타입이 없어 본문을 글로 쓴다(Playwright는 함수의 글을 화면에 보낸다) */
function inPage<R>(body: string): (el: unknown, arg?: unknown) => R {
  return new Function("e", "arg", body) as (el: unknown, arg?: unknown) => R;
}

/** 요소의 계산된 스타일 값 */
async function css(el: Locator, prop: string): Promise<string> {
  return el.evaluate(inPage<string>("return getComputedStyle(e)[arg];"), prop);
}

/** 테두리가 있는지(네 변 중 하나라도 두께와 모양이 있다) */
async function hasBorder(el: Locator): Promise<boolean> {
  return el.evaluate(inPage<boolean>('const c = getComputedStyle(e); return ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(c["border" + s + "Width"]) > 0 && c["border" + s + "Style"] !== "none");'));
}

test.describe("4.1-2 글자 크기 종류 6종 이하(375)", () => {
  test("화면 18곳과 펼친 카드의 보이는 글자 요소의 font-size가 6종 이하다", async ({ browser }) => {
    const over: string[] = [];
    await eachScreen(browser, async (page, url) => {
      const sizes = await fontSizes(page);
      if (Object.keys(sizes).length > 6) over.push(`${url}: ${Object.keys(sizes).length}종 ${JSON.stringify(sizes)}`);
    });
    expect(over, "6종을 넘는 화면").toEqual([]);
  });

  test("정적 HTML(자바스크립트 끔): 같은 주소와 앱 전용 틀의 보이는 글자 요소의 font-size가 6종 이하다", async ({ browser }) => {
    const over: string[] = [];
    await eachScreen(
      browser,
      async (page, url) => {
        const sizes = await fontSizes(page);
        if (Object.keys(sizes).length > 6) over.push(`${url}: ${Object.keys(sizes).length}종 ${JSON.stringify(sizes)}`);
      },
      { javaScriptEnabled: false },
      [...SCREENS, "/app.html"],
    );
    expect(over, "6종을 넘는 정적 화면").toEqual([]);
  });
});

test.describe("4.2-1 알약 칩", () => {
  test("키워드는 테두리·바탕·둥근 모서리 없는 글자다", async ({ page }) => {
    await openScreen(page, "/");
    const kw = page.locator(".kw span");
    expect(await kw.count()).toBeGreaterThan(0);
    for (const s of await kw.all()) {
      expect(await hasBorder(s), "키워드 테두리").toBe(false);
      expect(await css(s, "backgroundColor"), "키워드 바탕").toBe("rgba(0, 0, 0, 0)");
      expect(await css(s, "borderTopLeftRadius"), "키워드 모서리").toBe("0px");
    }
  });

  test("용어 칩은 끝에 ▾가 있고 누르면 제자리에서 설명이 열린다. 다른 화면으로 가는 칩은 주소를 바꾼다", async ({ page }) => {
    await page.goto(`/${PAST}#${encodeURIComponent("세계-3")}`);
    await settle(page);
    const card = page.locator('[id="story-세계-3"]');
    await expect(card.locator(".detail .sum")).toBeVisible();
    const chip = card.getByRole("group", { name: "용어" }).getByRole("button").first();
    await expect(chip).toHaveText(/▾$/);
    const before = page.url();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(card.locator(".tbox")).toBeVisible();
    expect(page.url()).toBe(before);
    // 인물·기관·국가 칩(알약, 다른 화면으로 감)
    const entity = card.locator(".rel a").first();
    const href = await entity.getAttribute("href");
    await entity.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
  });

  test("거르기 칩(대분류 ChipFilter, '안 읽은 것만' ToggleChip)은 경로를 바꾸지 않고 aria-pressed만 바뀐다", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    const group = page.getByRole("group", { name: "카테고리" });
    const econ = group.getByRole("button", { name: "경제" });
    await expect(econ).toHaveAttribute("aria-pressed", "false");
    await econ.click();
    await expect(econ).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).pathname).toBe(`/${PAST}`);
    const unread = group.getByRole("button", { name: "안 읽은 것만" });
    await unread.click();
    await expect(unread).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).pathname).toBe(`/${PAST}`);
  });

  test("인물 목록 종류 칩은 경로 그대로 ?kind=만 바꾸고 aria-pressed가 바뀐다(S10)", async ({ page }) => {
    await openScreen(page, "/entities");
    const person = page.getByRole("group", { name: "종류" }).getByRole("button", { name: "인물" });
    await person.click();
    await expect(person).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(/\/entities\?kind=person$/);
  });

  test("일정 '목록|달력'은 경로 그대로 보기만 바뀐다", async ({ page }) => {
    await openScreen(page, "/schedules");
    const cal = page.getByRole("group", { name: "보기" }).getByRole("button", { name: "달력" });
    await cal.click();
    await expect(cal).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).pathname).toBe("/schedules");
  });
});

test.describe("4.2-2 사각 표시", () => {
  test("화면 18곳과 펼친 카드에서 강조 바탕이나 모서리 있는 면을 가진 줄 안 표시는 '어제에 이어' 배지뿐이다", async ({ browser }) => {
    const bad: string[] = [];
    let badges = 0;
    await eachScreen(browser, async (page, url) => {
      const accentbg = await tokenColor(page, "--accentbg", "backgroundColor");
      const found = (await page.evaluate(`(() => {
        const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
        const opaque = (c) => c && c !== "transparent" && !/rgba\\([^)]*,\\s*0\\)$/.test(c);
        const out = [];
        for (const el of document.querySelectorAll(".badge, .tag, .sec, .res, .kw span")) {
          if (!visible(el)) continue;
          const c = getComputedStyle(el);
          const border = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(c["border" + s + "Width"]) > 0 && c["border" + s + "Style"] !== "none");
          const radius = parseFloat(c.borderTopLeftRadius) > 0;
          const face = c.backgroundColor === ${JSON.stringify(accentbg)} || (radius && (border || opaque(c.backgroundColor)));
          if (face) out.push({ badge: el.matches(".badge") && /에 이어$/.test(el.textContent.trim()), what: describe(el) });
        }
        return out;
      })()`)) as { badge: boolean; what: string }[];
      for (const f of found) {
        if (f.badge) badges++;
        else bad.push(`${url}: ${f.what}`);
      }
    });
    expect(bad, "배지가 아닌 사각 면 표시").toEqual([]);
    expect(badges, "'어제에 이어' 배지는 면이 있다(S3)").toBeGreaterThan(0);
  });

  test("영상 묶음 표시, 섹션 표시, 누를 수 없는 일정 결과는 면·테두리 없는 글자다", async ({ page }) => {
    const noFace = async (sel: string) => {
      const list = page.locator(sel);
      expect(await list.count(), sel).toBeGreaterThan(0);
      for (const el of await list.all()) {
        expect({ bg: await css(el, "backgroundColor"), border: await hasBorder(el) }, sel).toEqual({ bg: "rgba(0, 0, 0, 0)", border: false });
      }
    };
    await openScreen(page, `/${VIDEO_DATE}#videos`);
    await noFace(".vm .tag");
    await openScreen(page, `/${PAST}`);
    await page.locator("nav.tabs").getByRole("button", { name: "전체" }).click();
    await noFace(".list .sec");
    await openScreen(page, "/schedules");
    await noFace(".res-row span.res");
  });
});

test.describe("4.2-3 닫힌 뉴스 줄", () => {
  test("닫힌 줄에는 이슈 이름이 없고, 펼친 카드의 이슈 링크는 이슈 페이지로 간다", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    await page.locator("nav.tabs").getByRole("button", { name: "세계" }).click();
    const tops = listOf(PAST).sections.find((s) => s.name === "세계")!.stories.filter((s) => s.kind === "top");
    const withIssue = tops.filter((s) => s.issue);
    expect(withIssue.length).toBeGreaterThan(0);
    for (const s of tops) {
      const btn = page.locator(`[id="story-${s.key}"] .item-btn`);
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(btn.locator("a")).toHaveCount(0);
      if (s.issue) await expect(btn).not.toContainText(s.issue.name);
    }
    const first = withIssue[0]!;
    await page.locator(`[id="story-${first.key}"] .item-btn`).click();
    const link = page.locator(`[id="story-${first.key}"] .detail .story a`, { hasText: first.issue!.name });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/issues/${first.issue!.id}$`));
  });
});

test.describe("4.2-4 고르기 부품", () => {
  test("일정 375 라이트에서 '목록|달력'과 '다가오는 일정|지난 일정'의 선택 버튼 바탕이 같다", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openScreen(page, "/schedules");
    const view = await css(page.locator(".view button[aria-pressed=true]"), "backgroundColor");
    const seg = await css(page.locator(".seg button[aria-pressed=true]"), "backgroundColor");
    expect(seg).toBe(view);
  });
});

test.describe("4.2-5·4.2-6 글 링크와 구역 제목의 한 모양", () => {
  test("다른 화면으로 가는 글 링크의 (굵기, 색, 밑줄) 조합이 사이트 전체에서 1종이고 색이 흐린 글자색이다", async ({ browser }) => {
    const combos = new Map<string, string>();
    let muted = "";
    await eachScreen(browser, async (page, url) => {
      muted ||= await tokenColor(page, "--muted");
      const found = (await page.evaluate(`(() => {
        const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
        const set = new Set(document.querySelectorAll(".text-link, .quiet, .bintro-l, .breminder, .vrec, .gl a, a.res"));
        // 끝 표시 ›로 끝나는 main의 링크(목록 행·칩·버튼·머리글·제목 자리 링크·일정 이름 제외)
        for (const a of document.querySelectorAll("main a")) {
          if (!a.textContent.trim().endsWith("›")) continue;
          if (a.closest(".nrow, .wrow, .item-btn, .ichip, .chips, .rel, .btn, .datebtn, .tabs, h1, .bname-l, .igh") || a.matches("a.t, .btn, .nrow, .wrow, .item-btn")) continue;
          set.add(a);
        }
        return [...set].filter(visible).map((a) => { const c = getComputedStyle(a); return { combo: c.fontWeight + " | " + c.color + " | " + c.textDecorationLine, what: describe(a) }; });
      })()`)) as { combo: string; what: string }[];
      for (const f of found) if (!combos.has(f.combo)) combos.set(f.combo, `${url}: ${f.what}`);
    });
    expect([...combos.entries()], "글 링크 조합").toHaveLength(1);
    const [combo] = [...combos.keys()];
    expect(combo!.split(" | ")[1], "글 링크 색 = --muted").toBe(muted);
    expect(combo!.split(" | ")[2]).toContain("underline");
  });

  // U2 S5: 일정 화면의 이름은 링크가 아닌 글자(span.t)이고, 처음 근거로 가는 출처 링크가 글 링크 모양(밑줄)으로 따로 있다
  test("일정 이름은 글자이고 출처 링크는 밑줄이 있다", async ({ page }) => {
    await openScreen(page, "/schedules");
    await expect(page.locator(".ev a.t")).toHaveCount(0);
    expect(await page.locator(".ev span.t").count()).toBeGreaterThan(0);
    const src = page.locator(".ev a.text-link").filter({ hasText: /^(출처 뉴스|빌더 항목)/ });
    expect(await src.count()).toBeGreaterThan(0);
    for (const a of await src.all()) expect(await css(a, "textDecorationLine")).toContain("underline");
  });

  test("구역 제목의 (크기, 굵기, 색) 조합이 앱 전체에서 1종이다", async ({ browser }) => {
    const combos = new Map<string, string>();
    await eachScreen(browser, async (page, url) => {
      const found = (await page.evaluate(`(() => {
        const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
        return [...document.querySelectorAll("h2.h, h3.h, h4.h, .h, .list-h, h3.dh, h2.idx, .bgroup-h")].filter(visible).map((e) => { const c = getComputedStyle(e); return { combo: c.fontSize + " | " + c.fontWeight + " | " + c.color, what: describe(e) }; });
      })()`)) as { combo: string; what: string }[];
      for (const f of found) if (!combos.has(f.combo)) combos.set(f.combo, `${url}: ${f.what}`);
    });
    expect([...combos.entries()], "구역 제목 조합").toHaveLength(1);
  });
});

test.describe("4.2-7 빈 상태", () => {
  const expectEmpty = async (page: Page) => {
    const empty = page.locator("main .state.empty");
    await expect(empty.first()).toBeVisible();
    expect(await page.locator("main").innerText()).not.toContain("이날");
  };

  test("브리프·일정·이슈 목록·검색의 빈 상태는 공통 Empty이고 '이날'이 없다", async ({ page }) => {
    await fulfillData(page, "dates.json", { version: 1, latestDate: null, dates: [], months: [] });
    await page.goto("/");
    await expect(page.getByText("아직 저장된 브리프가 없다.")).toBeVisible();
    await expectEmpty(page);
    await page.unroute("**/site-data/dates.json");

    await fulfillData(page, "schedule-index.json", { total: 0, months: [], majors: [] });
    await page.goto("/schedules");
    await expect(page.getByText("아직 모은 일정이 없다.")).toBeVisible();
    await expectEmpty(page);

    await fulfillData(page, "issue-list.json", { issues: [], merged: {} });
    await page.goto("/issues");
    await settle(page);
    await expectEmpty(page);

    await page.goto("/search?q=없는말없는말");
    await expect(page.getByText(/에 맞는 결과가 없다/)).toBeVisible();
    await expectEmpty(page);
  });

  test("빌더·수요 0건 날의 빈 상태는 공통 Empty(묶음 변형)이고 '이 날'로 띄어 쓴다", async ({ page }) => {
    // 측정 데이터에서 빌더는 11월 3일, 수요는 11월 5일이 받았고 0건인 날이다
    const cases = [
      { date: PAST, tab: "builder" as const },
      { date: VIDEO_DATE, tab: "demand" as const },
    ];
    for (const { date, tab } of cases) {
      expect(listOf(date)[tab]).toMatchObject({ count: 0, status: "checked" });
      await openScreen(page, `/${date}#${tab}`);
      await expectEmpty(page);
      await expect(page.locator("main .state.empty").first()).toContainText("이 날");
    }
  });
});

test.describe("4.2-8 앱 밖 링크의 ↗", () => {
  test("화면 18곳에서 새 탭으로 여는 링크의 보이는 글에 ↗가 있다(글 없는 썸네일은 같은 곳의 글 링크로 본다)", async ({ browser }) => {
    const bad: string[] = [];
    let seen = 0;
    await eachScreen(
      browser,
      async (page, url) => {
        const found = (await page.evaluate(`(() => {
          const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
          const arrow = (a) => a.innerText.includes("↗") || [a, ...a.querySelectorAll("*")].some((e) => getComputedStyle(e, "::after").content.includes("↗") || getComputedStyle(e, "::before").content.includes("↗"));
          const links = [...document.querySelectorAll("a[target=_blank]")].filter(visible);
          return links.map((a) => {
            const text = a.innerText.replace(/\\s+/g, " ").trim();
            // 썸네일 링크(aria-hidden 포함)는 같은 곳으로 가는 글 링크로 본다
            const thumb = a.closest("[aria-hidden=true]") !== null || (a.querySelector("img") !== null && !a.querySelector(".vt"));
            if (text && !thumb) return { ok: arrow(a), what: describe(a) };
            const same = links.filter((b) => b !== a && b.getAttribute("href") === a.getAttribute("href") && b.innerText.trim());
            return { ok: same.length > 0 && same.some(arrow), what: "(썸네일) " + describe(a) };
          });
        })()`)) as { ok: boolean; what: string }[];
        seen += found.length;
        for (const f of found) if (!f.ok) bad.push(`${url}: ${f.what}`);
      },
      {},
      SCREENS,
    );
    expect(seen, "새 탭 링크가 있는 화면을 봤다").toBeGreaterThan(0);
    expect(bad, "↗ 없는 새 탭 링크").toEqual([]);
  });
});

test.describe("4.2-9 같은 도착의 이름", () => {
  const checkHome = async (browser: Browser, opts: BrowserContextOptions) => {
    const bad: string[] = [];
    await eachScreen(
      browser,
      async (page, url) => {
        const texts = await page.locator('a[href="/"]:not(.back):not(.brand)').allTextContents();
        for (const t of texts.map((x) => x.trim())) if (t !== "최근 브리프") bad.push(`${url}: '${t}'`);
      },
      opts,
      SCREENS,
    );
    expect(bad, "'/'로 가는 링크 글").toEqual([]);
  };

  test("앱: '/'로 가는 링크는 모두 '최근 브리프'다(되돌아가기·상표 제외)", async ({ browser }) => {
    await checkHome(browser, {});
  });

  test("정적 HTML(자바스크립트 끔): '/'로 가는 링크는 모두 '최근 브리프'다", async ({ browser }) => {
    await checkHome(browser, { javaScriptEnabled: false });
  });

  test("머리 날짜 링크는 접근 이름에 '날짜'가 있고 보이는 이동 표시(끝 › 또는 밑줄)가 있다", async ({ page }) => {
    await openScreen(page, "/");
    const link = page.locator(".bar .date-link");
    await expect(link).toHaveAttribute("aria-label", /날짜/);
    const mark = { text: (await link.textContent())!.trim(), deco: await css(link, "textDecorationLine") };
    expect(mark.text.endsWith("›") || mark.deco.includes("underline"), JSON.stringify(mark)).toBe(true);
  });

  test("이슈 영상의 추천 링크 글에 '브리프'가 있고 그 날짜의 영상 탭으로 간다", async ({ page }) => {
    await openScreen(page, "/issues/18");
    const links = page.locator(".vrec");
    expect(await links.count()).toBeGreaterThan(0);
    for (const a of await links.all()) {
      const text = (await a.textContent())!.trim();
      expect(text).toContain("브리프");
      const m = /^(\d+)월 (\d+)일/.exec(text);
      expect(m, text).not.toBeNull();
      const href = (await a.getAttribute("href"))!;
      const hm = /^\/(\d{4})-(\d{2})-(\d{2})#videos$/.exec(href);
      expect(hm, href).not.toBeNull();
      expect([Number(hm![2]), Number(hm![3])]).toEqual([Number(m![1]), Number(m![2])]);
    }
    const first = links.first();
    const href = (await first.getAttribute("href"))!;
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^영상/);
  });
});

test.describe("4.3-2 지표 변화", () => {
  test("상자 지표 칸에 값 변화와 %가 함께 보인다", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    // U2 S6: 상자는 접힌 채 시작한다
    await page.locator(".week-toggle").click();
    const tab = page.getByRole("tab", { name: "지표" });
    if ((await tab.getAttribute("aria-selected")) !== "true") await tab.click();
    const chg = await page.locator(".ichips .chg [aria-hidden=true]").allTextContents();
    expect(chg.length).toBeGreaterThan(0);
    for (const c of chg) expect(c, "값 변화와 %(또는 %p 지표·변동 없음·값 변화만)").toMatch(/^(변동 없음|[▲▼][\d,.]+(%p| \([\d,.]+%\))?)$/);
    expect(chg.some((c) => /^[▲▼][\d,.]+ \([\d,.]+%\)$/.test(c)), "값 변화와 %가 함께인 칸이 있다").toBe(true);
  });
});

test.describe("4.3-3 'YYYY-MM-DD' 날짜가 화면 글에 없다", () => {
  test("화면 18곳(앱, 375)의 보이는 글에 YYYY-MM-DD가 없다(데이터에서 온 이름·제목 제외)", async ({ browser }) => {
    const bad: string[] = [];
    await eachScreen(
      browser,
      async (page, url) => {
        const found = (await page.evaluate(`(() => {
          const visible = ${VISIBLE_FN}; const describe = ${DESCRIBE_FN};
          // 데이터에서 온 이름·제목(뉴스·영상 제목, 빌더 저장소·제품 이름, 출처 이름, 검색어 입력). 측정 데이터 375의 18곳에서는 지금 이 제외 없이도 걸리는 글이 없다
          const DATA = ".nt, .vt, .bname, .bname-l, .src a, input";
          const out = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !/\\d{4}-\\d{2}-\\d{2}/.test(n.textContent)) continue;
            if (el.closest("script, style, noscript, " + DATA)) continue;
            if (!visible(el)) continue;
            out.push(describe(el) + " :: " + n.textContent.trim().slice(0, 60));
          }
          return out;
        })()`)) as string[];
        for (const f of found) bad.push(`${url}: ${f}`);
      },
      {},
      SCREENS,
    );
    expect(bad, "화면 글의 YYYY-MM-DD").toEqual([]);
  });
});

/** 되돌아가기 링크 */
const back = (page: Page) => page.locator(".bar .back");
const scrollY = (page: Page): Promise<number> => page.evaluate("window.scrollY");
/** 링크를 머리글 아래(위에서 200px 쯤, 페이지 끝이면 그보다 아래)에 오게 스크롤하고 그때의 스크롤을 준다. 누를 때 Playwright가 다시 스크롤하지 않게(아래 탭에 가리지 않게) 한다 */
async function scrollToMiddle(page: Page, link: Locator): Promise<number> {
  await link.evaluate(inPage<void>("window.scrollBy(0, e.getBoundingClientRect().top - 200);"));
  await expect.poll(() => link.evaluate(inPage<boolean>("const top = e.getBoundingClientRect().top; return top >= 150 && top <= 500;"))).toBe(true);
  return scrollY(page);
}
/** ±1줄 */
const LINE = 30;

async function openPastWorld(page: Page): Promise<void> {
  await page.goto("/dates");
  await settle(page);
  await page.locator(`main a[href="/${PAST}"]`).first().click();
  await expect(page).toHaveURL(new RegExp(`/${PAST}$`));
  await settle(page);
  await page.locator("nav.tabs").getByRole("button", { name: "세계" }).click();
  await expect(page.locator("nav.tabs").getByRole("button", { name: "세계" })).toHaveAttribute("aria-pressed", "true");
}

test.describe("4.4-1 '‹ 브리프'의 도착", () => {
  test("(a) 11월 3일 '세계'에서 펼친 카드의 이슈 → '‹ 11월 3일 브리프'면 탭·펼친 카드·스크롤이 돌아오고, 뒤로는 브리프 앞 화면이다", async ({ page }) => {
    await openPastWorld(page);
    const card = page.locator('[id="story-세계-3"]');
    await card.locator(".item-btn").click();
    await expect(card.locator(".detail .sum")).toBeVisible();
    const link = card.locator(".detail .story a").first();
    const y = await scrollToMiddle(page, link);
    expect(y, "스크롤한 상태에서 떠난다").toBeGreaterThan(0);
    await link.click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/${PAST}#${encodeURIComponent("세계-3")}$`));
    await expect(page.locator("nav.tabs").getByRole("button", { name: "세계" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => scrollY(page)).toBeGreaterThan(y - LINE);
    expect(Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(LINE);
    await page.goBack();
    await expect(page).toHaveURL(/\/dates$/);
  });

  test("(b) 11월 3일 '세계' → 메뉴 이슈 목록 → 이슈 페이지('‹ 이슈') → 이슈 목록의 '‹ 11월 3일 브리프'는 새 기록으로 11월 3일 '세계'로 간다", async ({ page }) => {
    await openPastWorld(page);
    await page.getByRole("button", { name: "메뉴" }).click();
    await page.locator("#site-menu").getByRole("link", { name: "이슈 목록" }).click();
    await expect(page).toHaveURL(/\/issues$/);
    await settle(page);
    await page.locator("main .list a").first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await expect(back(page)).toHaveText("‹ 이슈");
    await back(page).click();
    await expect(page).toHaveURL(/\/issues$/);
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/${PAST}$`));
    await settle(page);
    await expect(page.locator("nav.tabs").getByRole("button", { name: "세계" })).toHaveAttribute("aria-pressed", "true");
    // 새 기록: 뒤로 가면 방금 나온 이슈 목록이다
    await page.goBack();
    await expect(page).toHaveURL(/\/issues$/);
  });

  test("(c) 11월 5일 영상 탭에서 묶음 칩을 고르고 영상 페이지 → '‹ 11월 5일 브리프'면 영상 탭, 칩, 스크롤이 돌아온다", async ({ page }) => {
    await page.goto("/dates");
    await settle(page);
    await page.locator(`main a[href="/${VIDEO_DATE}"]`).first().click();
    await settle(page);
    await page.locator("nav.tabs").getByRole("button", { name: /^영상/ }).click();
    await settle(page);
    const chip = page.getByRole("group", { name: "영상 묶음" }).getByRole("button", { name: /^AI/ });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const link = page.locator(`[data-video="${VIDEO_ID}"] a[href="/videos/${VIDEO_DATE}/${VIDEO_ID}"]`);
    const y = await scrollToMiddle(page, link);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/videos/${VIDEO_DATE}/${VIDEO_ID}$`));
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 5일 브리프");
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/${VIDEO_DATE}`));
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^영상/);
    await expect(page.getByRole("group", { name: "영상 묶음" }).getByRole("button", { name: /^AI/ })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(LINE);
  });

  test("(c) 주소로 바로 연 지난 날짜 영상 페이지의 되돌아가기는 '‹ 11월 5일 브리프'이고 그 날짜의 영상 탭으로 간다", async ({ page }) => {
    await openScreen(page, `/videos/${VIDEO_DATE}/${VIDEO_ID}`);
    await expect(back(page)).toHaveText("‹ 11월 5일 브리프");
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/${VIDEO_DATE}#videos$`));
    await settle(page);
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^영상/);
  });

  test("(d) 새 브라우저 컨텍스트에서 주소로 바로 연 일정 화면의 '‹ 브리프'는 최근 날짜로 간다", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await openScreen(page, "/schedules");
    await expect(back(page)).toHaveText("‹ 브리프");
    await back(page).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/(#.*)?$/);
    await settle(page);
    await expect(page.locator(".bar .date-link")).toHaveText(/^11월 6일/);
    await context.close();
  });

  test("(e) 11월 3일 브리프를 본 뒤 소개 → 처리방침의 '‹ 11월 3일 브리프'는 11월 3일로 간다", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    await page.locator("footer").getByRole("link", { name: "사이트 소개" }).click();
    await expect(page).toHaveURL(/\/about$/);
    await settle(page);
    await page.locator("footer").getByRole("link", { name: "개인정보 처리방침" }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");
    await back(page).click();
    await expect(page).toHaveURL(new RegExp(`/${PAST}$`));
  });
});

test.describe("4.4-2·4.4-3 이슈 페이지의 되돌아가기", () => {
  test("브리프(지난 날짜)에서 온 이슈 페이지는 '‹ 11월 3일 브리프', 최근 날짜에서 오면 '‹ 브리프'", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    await page.locator("nav.tabs").getByRole("button", { name: "세계" }).click();
    await page.locator('[id="story-세계-1"] .item-btn').click();
    await page.locator('[id="story-세계-1"] .detail .story a').first().click();
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");

    await openScreen(page, "/");
    const tops = listOf(LATEST).sections.flatMap((s) => s.stories).filter((s) => s.kind === "top" && s.issue);
    const target = page.locator(`[id="story-${tops[0]!.key}"]`);
    if (!(await target.isVisible())) await page.locator("nav.tabs").getByRole("button", { name: tops[0]!.section }).click();
    await target.locator(".item-btn").click();
    await target.locator(".detail .story a").first().click();
    await settle(page);
    await expect(back(page)).toHaveText("‹ 브리프");
    await back(page).click();
    // U1 S1: 바로 앞 기록(최근 브리프)으로 되돌린다. 줄을 펼치면 주소가 '/<날짜>#키'로 바뀌는데, U2 4.1-1(d)로 그 기록에도 브리프 표시가 남아 그 주소로 돌아온다
    await expect(page).toHaveURL(new RegExp(`127\\.0\\.0\\.1:\\d+\\/(${LATEST})?(#.*)?$`));
    await expect(target.locator(".item-btn")).toHaveAttribute("aria-expanded", "true");
  });

  test("이슈 목록·검색에서 온 이슈 페이지와 주소로 바로 연 이슈 페이지는 '‹ 이슈'이고 이슈 목록으로 간다", async ({ page }) => {
    await openScreen(page, "/issues");
    await page.locator("main .list a").first().click();
    await settle(page);
    await expect(back(page)).toHaveText("‹ 이슈");
    await back(page).click();
    await expect(page).toHaveURL(/\/issues$/);

    await openScreen(page, "/search?q=가짜");
    const issueLink = page.locator('main a[href^="/issues/"]').first();
    await issueLink.click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await expect(back(page)).toHaveText("‹ 이슈");

    await openScreen(page, "/issues/28");
    await expect(back(page)).toHaveText("‹ 이슈");
    await back(page).click();
    await expect(page).toHaveURL(/\/issues$/);
  });
});

test.describe("4.4-4 탭 기억", () => {
  test("주소로 연 탭(/#builder)을 기억해, 같은 컨텍스트에서 주소로 연 /가 빌더 탭이다", async ({ page }) => {
    await openScreen(page, "/#builder");
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^빌더/);
    await page.goto("/");
    await settle(page);
    await expect(page.locator("nav.tabs button[aria-pressed=true]")).toHaveText(/^빌더/);
  });

  test("11월 3일을 본 탭과 같은 컨텍스트의 새 탭에서 주소로 연 일정 화면은 '‹ 브리프'이고 최근 날짜로 간다", async ({ page, context }) => {
    await openScreen(page, `/${PAST}`);
    const other = await context.newPage();
    await other.clock.setFixedTime(NOW);
    await openScreen(other, "/schedules");
    await expect(back(other)).toHaveText("‹ 브리프");
    await back(other).click();
    await settle(other);
    await expect(other.locator(".bar .date-link")).toHaveText(/^11월 6일/);
  });

  test("브리프에서 온 이슈 페이지는 새로고침한 뒤에도 '‹ 11월 3일 브리프'다", async ({ page }) => {
    await openScreen(page, `/${PAST}`);
    await page.locator("nav.tabs").getByRole("button", { name: "세계" }).click();
    await page.locator('[id="story-세계-1"] .item-btn').click();
    await page.locator('[id="story-세계-1"] .detail .story a').first().click();
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");
    await page.reload();
    await settle(page);
    await expect(back(page)).toHaveText("‹ 11월 3일 브리프");
  });
});

test.describe("4.4-5 브라우저 뒤로", () => {
  async function expectRestored(page: Page, key: string, y: number, tab = "세계") {
    await expect(page.locator("nav.tabs").getByRole("button", { name: tab, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[id="story-${key}"] .item-btn`)).toHaveAttribute("aria-expanded", "true");
    await expect.poll(async () => Math.abs((await scrollY(page)) - y)).toBeLessThanOrEqual(LINE);
  }

  test("이슈·용어 → 브라우저 뒤로: 날짜·탭·펼친 카드·스크롤이 남는다", async ({ page }) => {
    await openPastWorld(page);
    const card = page.locator('[id="story-세계-3"]');
    await card.locator(".item-btn").click();
    await expect(card.locator(".detail .sum")).toBeVisible();
    // 이슈
    const issue = card.locator(".detail .story a").first();
    let y = await scrollToMiddle(page, issue);
    await issue.click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await page.goBack();
    await expectRestored(page, "세계-3", y);
    // 용어(설명 상자의 '용어 사전에서 보기')
    const chip = card.getByRole("group", { name: "용어" }).getByRole("button").first();
    await chip.click();
    const more = card.locator(".tbox a");
    y = await scrollToMiddle(page, more);
    await more.click();
    await expect(page).toHaveURL(/\/terms/);
    await settle(page);
    await page.goBack();
    await expectRestored(page, "세계-3", y);
  });

  test("일정 → 브라우저 뒤로: 날짜·탭·펼친 카드·스크롤이 남는다", async ({ page }) => {
    const story = listOf(PAST).sections.flatMap((x) => x.stories).find((x) => x.key === "IT·AI-5")!;
    await openPastWorld(page);
    await page.locator("nav.tabs").getByRole("button", { name: story.section }).click();
    const card = page.locator(`[id="story-${story.key}"]`);
    await card.locator(".item-btn").click();
    await expect(card.locator(".detail .sum")).toBeVisible();
    const link = card.locator('.detail a[href^="/schedules"]').first();
    const y = await scrollToMiddle(page, link);
    await link.click();
    await expect(page).toHaveURL(/\/schedules/);
    await settle(page);
    await page.goBack();
    await expectRestored(page, story.key, y, story.section);
  });

  test("대분류 칩을 고른 뒤 이슈 → 브라우저 뒤로: 칩이 남는다", async ({ page }) => {
    await openPastWorld(page);
    const tops = listOf(PAST).sections.find((s) => s.name === "세계")!.stories.filter((s) => s.kind === "top" && s.issue);
    const major = tops[0]!.category.major;
    // U2 4.3: 칩 글에 건수가 붙는다
    const chip = page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: new RegExp(`^${major} \\d+$`) });
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    const card = page.locator(`[id="story-${tops[0]!.key}"]`);
    await card.locator(".item-btn").click();
    await card.locator(".detail .story a").first().click();
    await expect(page).toHaveURL(/\/issues\/\d+$/);
    await settle(page);
    await page.goBack();
    await expect(page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: new RegExp(`^${major} \\d+$`) })).toHaveAttribute("aria-pressed", "true");
  });
});
