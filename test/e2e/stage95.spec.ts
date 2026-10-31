// 9.5단계: 정적 HTML과 앱의 연결, 자바스크립트 끈 방문자, 문서 제목, 상태 코드, 메일 통로, 정정 표시.
import { expect, expectNoHorizontalScroll, info, storyItem, storyUrl, test } from "./base.ts";

const latest = info.dates[0]!;
const section = info.latest.firstSection;
const staticTitle = (body: string) => body.match(/<title>([^<]*)<\/title>/)?.[1]?.replaceAll("&amp;", "&");

test.describe("4.1-4 자바스크립트를 켠 방문자", () => {
  test("앱 코드를 받는 동안 정적 본문이 보이지 않고, 그린 뒤에는 정적 본문이 없으며 콘솔 오류가 없다", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/assets/*.js", async (route) => {
      await held;
      await route.continue();
    });
    await page.goto(`/${latest}`, { waitUntil: "commit" });
    await expect(page.locator(".static-page")).toBeAttached();
    await expect(page.locator(".static-page")).toBeHidden();
    release();
    await expect(page.getByRole("button", { name: section })).toBeVisible();
    await expect(page.locator(".static-page")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("앱 코드를 받지 못하면 정적 본문이 보인다", async ({ page }) => {
    await page.route("**/assets/*.js", (route) => route.abort());
    await page.goto(`/${latest}`);
    await expect(page.locator(".static-page h1")).toBeVisible();
    await expect(page.locator(".static-page").getByRole("link", { name: "날짜 목록" }).first()).toBeVisible();
  });
});

test("4.1-4 앱 코드가 시작하다 오류가 나도 정적 본문이 보인다", async ({ page, pageErrors }) => {
  await page.route("**/assets/*.js", (route) => route.fulfill({ contentType: "text/javascript", body: 'throw new Error("시작 오류")' }));
  await page.goto(`/${latest}`);
  await expect(page.locator(".static-page h1")).toBeVisible();
  // 이 테스트가 일부러 낸 오류만 있어야 한다. 비워서 자동 픽스처의 검사를 통과시킨다
  expect(pageErrors).toEqual(["시작 오류"]);
  pageErrors.length = 0;
});

test.describe("4.1-5 자바스크립트를 끈 방문자", () => {
  test.use({ javaScriptEnabled: false, viewport: { width: 375, height: 812 } });
  for (const [name, url] of [["브리프", `/${latest}`], ["이슈", `/issues/${info.issues.first.id}`], ["대상", "/entities/1"]] as const) {
    test(`${name} 본문이 보이고 스타일이 입혀져 있으며 안내가 없고 가로 스크롤이 없다`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page.locator("main h1")).not.toHaveCSS("font-size", "32px");
      await expect(page.locator("noscript")).toHaveCount(0);
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expectNoHorizontalScroll(page, url);
    });
  }
  for (const url of ["/search", "/terms/1", "/schedules/1"]) {
    test(`앱 전용 주소 ${url}에는 안내와 갈 곳이 보인다`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1, name: "이 화면을 열지 못했다" })).toBeVisible();
      await expect(page.getByRole("link", { name: "최근 뉴스 브리프 보기" })).toBeVisible();
      await expectNoHorizontalScroll(page, url);
    });
  }
});

test("앱 코드를 받지 못해도 앱 전용 주소가 빈 화면이 아니다", async ({ page }) => {
  await page.route("**/assets/*.js", (route) => route.abort());
  await page.goto("/search");
  await expect(page.getByRole("heading", { level: 1, name: "이 화면을 열지 못했다" })).toBeVisible();
});

test("4.2-1 날짜 목록을 받지 못해도 브리프 제목이 남는다", async ({ page, request }) => {
  const title = staticTitle(await (await request.get(`/${latest}`)).text());
  await page.route("**/site-data/dates.json", (route) => route.abort());
  await page.goto(`/${latest}`);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page).toHaveTitle(title!);
});

test("4.2-1 앱을 그린 뒤의 제목이 정적 제목과 같다", async ({ page, request }) => {
  for (const url of ["/", `/${latest}`, "/dates", "/issues", `/issues/${info.issues.first.id}`, "/entities", "/entities/1", "/terms", "/schedules", "/about", "/privacy"]) {
    const title = staticTitle(await (await request.get(url)).text());
    await page.goto(url);
    await expect(page.locator(".static-page")).toHaveCount(0);
    await expect(page, url).toHaveTitle(title!);
  }
  await page.goto("/");
  await expect(page).toHaveTitle("Tidwyn · 최신 뉴스 브리프");
});

test.describe("4.3 상태 코드와 앱 전용 주소", () => {
  test("없는 주소는 404이고 앱도 없는 페이지를 보이며, 정적 응답에 읽을 내용이 있다", async ({ page, request }) => {
    for (const url of ["/nope", "/2026-02-30", "/2026-10-25", "/issues/999", "/entities/99999"]) {
      const res = await request.get(url);
      expect(res.status(), url).toBe(404);
      expect(await res.text()).toContain("이 주소에는 페이지가 없다");
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1, name: "이 주소에는 페이지가 없다" })).toBeVisible();
      await expect(page.getByText(url)).toBeVisible();
    }
  });
  test("앱 전용 주소와 끝의 /는 200이다", async ({ request }) => {
    for (const url of ["/search", "/terms/1", "/schedules/1", `/${latest}/`, "/about/", `/issues/${info.issues.merged.id}`]) expect((await request.get(url)).status(), url).toBe(200);
    expect((await request.get("/site-data/none.json")).status()).toBe(404);
  });
  test("앱 전용 주소를 직접 열어도 지금처럼 움직인다", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(info.issues.first.name)}`);
    await expect(page.getByRole("region", { name: "이슈" })).toBeVisible();
    await expect(page.getByText("이 화면을 열지 못했다")).toHaveCount(0);
    await page.goto(`/issues/${info.issues.merged.id}`);
    await expect(page.getByRole("note")).toContainText("합쳐졌다");
  });
});

test.describe("4.6-1 메일 통로", () => {
  test("소개의 절과 바닥글 링크, GitHub 이슈 주소 없음", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "오류 정정과 연락" }).click();
    await expect(page).toHaveURL("/about#corrections");
    await expect(page.getByRole("heading", { level: 2, name: "오류 정정과 연락" })).toBeInViewport();
    await expect(page.locator('a[href="mailto:mivomad33@gmail.com"]')).toBeVisible();
    await expect(page.locator('a[href*="github.com/mivomad33/tidwyn/issues"]')).toHaveCount(0);
  });
  test("펼친 카드와 목록 끝의 제보 링크에 내용이 채워진다", async ({ page }) => {
    const key = `${section}-3`;
    await page.goto(storyUrl(latest, key));
    const card = storyItem(page, key);
    const href = await card.getByRole("link", { name: "틀린 내용 알리기" }).getAttribute("href");
    const mail = new URL(href!);
    expect(mail.pathname).toBe("mivomad33@gmail.com");
    const title = await card.locator(".title").first().innerText();
    expect(decodeURIComponent(href!)).toContain(title);
    expect(decodeURIComponent(href!)).toContain(`https://tidwyn.vercel.app/${latest}`);
    const short = await page.locator(".short-report a").getAttribute("href");
    expect(decodeURIComponent(short!)).toContain(`https://tidwyn.vercel.app/${latest}`);
  });
});

test.describe("4.7-6 정정 표시", () => {
  test("목록과 펼친 카드에 표시가 있고, 사유가 최신순으로 쌓이며, 표시 없는 카드와 섞인다", async ({ page }) => {
    await page.goto(`/${latest}`);
    const fixed = storyItem(page, `${section}-1`);
    await expect(fixed.locator(".fix-mark")).toHaveText(/^정정됨 · \d+월 \d+일$/);
    await expect(storyItem(page, `${section}-3`).locator(".fix-mark")).toHaveCount(0);
    await fixed.getByRole("button").first().click();
    const notes = fixed.locator(".fix");
    await expect(notes).toHaveCount(2);
    await expect(notes.first()).toContainText("성장률을 1.2%에서 1.3%로");
    await expect(notes.nth(1)).toContainText("기관 이름을");
  });
  test("짧은 소식은 사유를 늘 보인다", async ({ page }) => {
    await page.goto(`/${latest}`);
    await expect(page.locator(".short-fix").first()).toContainText("수출액 단위를");
  });
  test("긴 사유도 375px에서 가로 스크롤이 없고, 펼치면 카드 윗선이 화면 안에 있다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 500 });
    await page.goto(storyUrl(latest, `${section}-2`));
    const fixed = storyItem(page, `${section}-1`);
    await fixed.getByRole("button").first().click();
    await expect(fixed.locator(".fix").first()).toBeVisible();
    await expect(fixed).toBeInViewport();
    await expectNoHorizontalScroll(page, "정정");
  });
});

test.describe("키보드", () => {
  test("첫 Tab이 본문 건너뛰기 링크이고, 누르면 포커스가 본문으로 간다", async ({ page }) => {
    await page.goto(`/${latest}`);
    await expect(page.getByRole("button", { name: section })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "본문으로 건너뛰기" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press("Enter");
    await expect(page.locator("main#main")).toBeFocused();
    expect(new URL(page.url()).hash).toBe("");
  });

  test("메뉴를 Tab으로 빠져나가면 메뉴가 닫힌다", async ({ page }) => {
    await page.goto(`/${latest}`);
    const button = page.getByRole("button", { name: "메뉴" });
    await button.click();
    const links = page.locator("#site-menu a");
    await expect(links.first()).toBeVisible();
    await button.focus();
    for (let i = 0; i < (await links.count()); i++) await page.keyboard.press("Tab");
    await expect(links.last()).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.locator("#site-menu")).toHaveCount(0);
  });

  test("Tab으로 내려가도 포커스가 하단 탭 막대에 가리지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`/${latest}`);
    await expect(page.getByRole("button", { name: section })).toBeVisible();
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Tab");
      const hidden = await page.evaluate(`(() => {
        const el = document.activeElement;
        const tabs = document.querySelector(".tabs");
        if (el === document.body || !tabs || el.closest(".tabs")) return false;
        return el.getBoundingClientRect().bottom > tabs.getBoundingClientRect().top;
      })()`);
      expect(hidden).toBe(false);
    }
  });

  test("앵커로 가도 대상이 고정 머리글에 가리지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto("/about#corrections");
    const clear = page.evaluate(`document.querySelector("#corrections").getBoundingClientRect().top >= document.querySelector(".bar").getBoundingClientRect().bottom`);
    await expect(page.locator("#corrections")).toBeVisible();
    expect(await clear).toBe(true);
  });

  test("고정 머리글과 하단 탭에 포커스가 가도 페이지가 튀지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 600 });
    await page.goto(`/${latest}`);
    await expect(page.getByRole("button", { name: section })).toBeVisible();
    await page.evaluate("window.scrollTo(0, 400)");
    await page.getByRole("button", { name: "메뉴" }).focus();
    expect(await page.evaluate("window.scrollY")).toBe(400);
    await page.locator(".tabs button").first().focus();
    expect(await page.evaluate("window.scrollY")).toBe(400);
  });

  test("뒤로 Tab해 고정 머리글 아래로 포커스가 들어가도 가리지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 500 });
    await page.goto(`/${latest}`);
    await expect(page.getByRole("button", { name: section })).toBeVisible();
    await page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)");
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press("Shift+Tab");
      const hidden = await page.evaluate(`(() => {
        const el = document.activeElement;
        if (el === document.body || el.closest(".bar")) return false;
        return el.getBoundingClientRect().top < document.querySelector(".bar").getBoundingClientRect().bottom;
      })()`);
      expect(hidden).toBe(false);
    }
  });
});
