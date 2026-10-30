// 3단계 화면 회귀(E2E): 첫 화면, 날짜 이동, 섹션·분류 거르기, 펼친 카드와 카드 주소, 날짜·이슈 목록, 이슈 페이지,
// 검색, 머리 줄 메뉴, 사이트 소개, 없는 페이지, 불러오기 오류와 다시 시도, 빈 상태, 다크 모드, 주소 직접 열기, 375px 폭.
// 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import { dataFile, dateLinkName, expect, expectNoHorizontalScroll, failData, fulfillData, info, monthDay, serverError, storyItem, storyUrl, test } from "./base.ts";

const [latest, second, third] = info.dates as [string, string, string];

test.describe("첫 화면과 날짜 이동", () => {
  test("첫 화면은 가장 최근 날짜의 브리프를 한국 섹션으로 보인다", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible();
    await expect(page).toHaveTitle(`${dateLinkName(latest).split(",")[0]} 브리프 · Tidwyn`);
    const tabs = page.getByRole("navigation", { name: "섹션" });
    await expect(tabs.getByRole("button", { name: info.latest.firstSection })).toHaveAttribute("aria-pressed", "true");
    // 가장 최근 날짜라 다음 날짜 링크가 없다
    await expect(page.getByRole("link", { name: /^다음 날짜/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: `이전 날짜 ${monthDay(second)}` })).toBeVisible();
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
  });

  test("이전·다음 날짜로 옮겨 다니고, 가운데 날짜는 날짜 목록으로 간다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: `이전 날짜 ${monthDay(second)}` }).click();
    await expect(page).toHaveURL(`/${second}`);
    await expect(page.getByRole("link", { name: dateLinkName(second) })).toBeVisible();
    await page.getByRole("link", { name: `이전 날짜 ${monthDay(third)}` }).click();
    await expect(page).toHaveURL(`/${third}`);
    await page.getByRole("link", { name: `다음 날짜 ${monthDay(second)}` }).click();
    await expect(page).toHaveURL(`/${second}`);
    // 브라우저 뒤로 가기도 화면을 따라 바꾼다
    await page.goBack();
    await expect(page.getByRole("link", { name: dateLinkName(third) })).toBeVisible();
    await page.getByRole("link", { name: dateLinkName(third) }).click();
    await expect(page).toHaveURL("/dates");
    await expect(page.getByRole("heading", { level: 1, name: "날짜 목록" })).toBeVisible();
  });

  test("섹션 탭과 분류 칩으로 거른다", async ({ page }) => {
    await page.goto(`/${latest}`);
    const tabs = page.getByRole("navigation", { name: "섹션" });
    await tabs.getByRole("button", { name: info.latest.otherSection }).click();
    await expect(tabs.getByRole("button", { name: info.latest.otherSection })).toHaveAttribute("aria-pressed", "true");
    await expect(tabs.getByRole("button", { name: info.latest.firstSection })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: info.latest.otherTopTitle, expanded: false })).toBeVisible();

    // 분류 칩: 고른 대분류의 뉴스만 남는다(없으면 빈 상태 글)
    const chips = page.getByRole("group", { name: "카테고리" });
    await expect(chips.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    const firstCat = (await page.locator("ul.list > li.item .cat").first().innerText()).split(" · ")[0]!;
    await chips.getByRole("button", { name: firstCat, exact: true }).click();
    await expect(chips.getByRole("button", { name: firstCat, exact: true })).toHaveAttribute("aria-pressed", "true");
    const cats = await page.locator("ul.list > li.item .cat, li.short .cat-inline").allInnerTexts();
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) expect(c.startsWith(`${firstCat} · `), c).toBe(true);
    await chips.getByRole("button", { name: "전체" }).click();
    await expect(page.locator("ul.list > li.item .cat, li.short .cat-inline")).not.toHaveCount(cats.length);
  });
});

test.describe("펼친 카드", () => {
  test("카드를 누르면 펼쳐지고 주소에 뉴스 키가 붙으며, 다시 누르면 접힌다", async ({ page }) => {
    await page.goto(`/${latest}`);
    const card = page.locator("ul.list > li.item").first();
    const btn = card.locator("button.item-btn");
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    const id = (await card.getAttribute("id"))!;
    const key = id.replace(/^story-/, "");
    await expect(page).toHaveURL(storyUrl(latest, key));
    await expect(card.getByRole("heading", { name: "왜 중요한가" })).toBeVisible();
    await expect(card.getByRole("heading", { name: "출처" })).toBeVisible();
    // 출처는 새 탭으로 연다
    await expect(card.locator(".src a").first()).toHaveAttribute("target", "_blank");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expect(page).toHaveURL(`/${latest}`);
  });

  test("카드 주소(#뉴스 키)로 직접 열면 그 섹션에서 그 카드가 펼쳐져 보인다", async ({ page }) => {
    const target = `${info.latest.otherSection}-2`;
    await page.goto(storyUrl(latest, target));
    const tabs = page.getByRole("navigation", { name: "섹션" });
    await expect(tabs.getByRole("button", { name: info.latest.otherSection })).toHaveAttribute("aria-pressed", "true");
    const card = storyItem(page, target);
    await expect(card.locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByRole("heading", { name: "왜 중요한가" })).toBeVisible();
    await expect(card).toBeInViewport();
    await expect(card).toBeFocused();
  });

  test("짧은 소식 주소로 열면 그 소식을 표시한다", async ({ page }) => {
    await page.goto(storyUrl(latest, `${info.latest.firstSection}-s3`));
    const item = storyItem(page, `${info.latest.firstSection}-s3`);
    await expect(item).toHaveClass(/target/);
    await expect(item).toBeInViewport();
  });
});

test.describe("날짜 목록·이슈 목록·이슈 페이지", () => {
  test("날짜 목록은 저장된 날짜를 달별로 보이고, 누르면 그 날짜 브리프로 간다", async ({ page }) => {
    await page.goto("/dates");
    await expect(page.getByRole("heading", { level: 2, name: "2026년 10월" })).toBeVisible();
    const links = page.locator("a.row-link");
    await expect(links).toHaveCount(info.dates.length);
    await page.getByRole("link", { name: dateLinkName(third).split(",")[0], exact: true }).click();
    await expect(page).toHaveURL(`/${third}`);
    await expect(page.getByRole("link", { name: dateLinkName(third) })).toBeVisible();
  });

  test("이슈 목록은 최근 순이고 대분류·상태로 거른다", async ({ page }) => {
    await page.goto("/issues");
    await expect(page.getByRole("heading", { level: 1, name: "이슈 목록" })).toBeVisible();
    await expect(page.locator("ul.list > li.item").first()).toContainText(info.issues.first.name);
    const status = page.getByRole("group", { name: "상태" });
    await status.getByRole("button", { name: "종료" }).click();
    await expect(status.getByRole("button", { name: "종료" })).toHaveAttribute("aria-pressed", "true");
    const conts = await page.locator("ul.list > li.item .cont").allInnerTexts();
    expect(conts.length).toBeGreaterThan(0);
    for (const c of conts) expect(c.startsWith("종료"), c).toBe(true);
    await status.getByRole("button", { name: "전체" }).click();
    await page.getByRole("link", { name: new RegExp(info.issues.first.name) }).click();
    await expect(page).toHaveURL(`/issues/${info.issues.first.id}`);
    await expect(page.getByRole("heading", { level: 1, name: info.issues.first.name })).toBeVisible();
  });

  test("이슈 페이지의 타임라인을 누르면 그 뉴스가 펼쳐진 브리프로 간다", async ({ page }) => {
    await page.goto(`/issues/${info.issues.first.id}`);
    await expect(page.getByRole("heading", { name: "타임라인" })).toBeVisible();
    const first = page.locator("ol.tl a").first();
    const href = (await first.getAttribute("href"))!;
    const [date, hash] = href.slice(1).split("#") as [string, string];
    await first.click();
    await expect(page).toHaveURL(href);
    const card = storyItem(page, decodeURIComponent(hash));
    await expect(card).toBeInViewport();
    await expect(page.getByRole("link", { name: dateLinkName(date) })).toBeVisible();
  });

  test("흡수된 이슈 주소는 남는 이슈 주소로 바뀌고 합쳐졌다는 줄을 보인다", async ({ page }) => {
    const { id, into, intoName } = info.issues.merged;
    await page.goto(`/issues/${id}`);
    await expect(page).toHaveURL(`/issues/${into}`);
    await expect(page.getByRole("heading", { level: 1, name: intoName })).toBeVisible();
    await expect(page.getByRole("note")).toHaveText(`이 이슈는 ${monthDay(latest)}에 ${intoName}에 합쳐졌다.`);
  });
});

test.describe("검색·메뉴·사이트 소개", () => {
  test("검색 화면은 입력란에 초점을 두고, 검색어를 넣으면 주소와 결과가 바뀐다", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByRole("searchbox", { name: "검색어" });
    await expect(input).toBeFocused();
    await input.fill(info.latest.otherTopTitle.split(",")[0]!);
    await input.press("Enter");
    await expect(page).toHaveURL(/\/search\?q=/);
    const news = page.getByRole("region", { name: "뉴스" });
    await expect(news.getByRole("link", { name: new RegExp(info.latest.otherTopTitle.slice(0, 10)) }).first()).toBeVisible();
    // 결과를 누르면 그 뉴스 카드로 간다
    await news.getByRole("link").first().click();
    await expect(page).toHaveURL(/\/\d{4}-\d{2}-\d{2}#/);
  });

  test("맞는 것이 없는 검색어는 빈 결과 글을 보인다", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent("없는낱말쿼크")}`);
    await expect(page.getByText(`"없는낱말쿼크"에 맞는 결과가 없다.`)).toBeVisible();
  });

  test("머리 줄 메뉴를 열고 닫고, 메뉴로 화면을 옮긴다", async ({ page }) => {
    await page.goto("/");
    const btn = page.getByRole("button", { name: "메뉴" });
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("navigation", { name: "사이트 메뉴" });
    await expect(menu.getByRole("link")).toHaveText(["최근 브리프", "날짜 목록", "이슈 목록", "일정", "지표", "인물·기관·국가", "용어 사전", "검색", "사이트 소개"]);
    // Esc로 닫으면 메뉴 단추로 초점이 돌아온다
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(btn).toBeFocused();
    // 바깥을 누르면 닫힌다
    await btn.click();
    await expect(menu).toBeVisible();
    await page.locator("main").click({ position: { x: 5, y: 5 } });
    await expect(menu).toHaveCount(0);
    // 메뉴 링크로 옮기면 닫힌다
    await btn.click();
    await menu.getByRole("link", { name: "이슈 목록" }).click();
    await expect(page).toHaveURL("/issues");
    await expect(page.getByRole("navigation", { name: "사이트 메뉴" })).toHaveCount(0);
    await expect(page.locator("#main")).toBeFocused();
    // 검색 아이콘
    await page.getByRole("link", { name: "검색" }).click();
    await expect(page).toHaveURL("/search");
  });

  test("사이트 소개를 보이고 바깥 링크는 새 탭으로 연다", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("contentinfo").getByRole("link", { name: "사이트 소개" }).click();
    await expect(page).toHaveURL("/about");
    await expect(page.getByRole("heading", { level: 1, name: "사이트 소개" })).toBeVisible();
    await expect(page).toHaveTitle("사이트 소개 · Tidwyn");
    for (const h of ["Tidwyn은", "저작권", "방문 통계", "원본 저장소"]) await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    const external = page.locator("article a[href^='https://']");
    // 6단계: FRED API 이용 약관 링크가 더해졌다(4.7-6). 7단계: '추천 영상' 절의 YouTube 이용약관 링크가 더해졌다(4.7-5)
    await expect(external).toHaveCount(4);
    for (const a of await external.all()) {
      await expect(a).toHaveAttribute("target", "_blank");
      await expect(a).toHaveAttribute("rel", /noopener/);
    }
  });
});

test.describe("없는 페이지", () => {
  for (const url of ["/no-such-page", "/2026-10-25", "/2026-02-30", "/issues/999", "/issues/abc"]) {
    test(`${url}은 없는 페이지를 보인다`, async ({ page }) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible();
      await expect(page).toHaveTitle("없는 페이지 · Tidwyn");
    });
  }

  test("없는 페이지의 첫 화면 링크로 돌아간다", async ({ page }) => {
    await page.goto("/no-such-page");
    await page.getByRole("link", { name: "첫 화면으로 가기" }).click();
    await expect(page).toHaveURL("/");
    await expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible();
  });

  test("site-data의 없는 파일은 화면 틀이 아니라 404다", async ({ request }) => {
    expect((await request.get("/site-data/list-1999-01.json")).status()).toBe(404);
    expect((await request.get("/pagefind/none.js")).status()).toBe(404);
    expect((await request.get("/vercel.json")).headers()["content-type"]).toContain("text/html");
  });
});

test.describe("불러오기 오류와 다시 시도", () => {
  test("날짜 목록 파일을 못 받으면 오류를 보이고, 다시 시도하면 첫 화면이 나온다", async ({ page }) => {
    await failData(page, "dates.json");
    await page.goto("/");
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("데이터를 불러오지 못했다");
    await page.unroute(dataFile("dates.json"));
    await alert.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });

  test("달 목록 파일이 서버 오류면 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    await serverError(page, `list-${latest.slice(0, 7)}.json`);
    await page.goto("/");
    await expect(page.getByRole("alert")).toBeVisible();
    // 날짜 이동 줄은 그대로 있다
    await expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible();
    await page.unroute(dataFile(`list-${latest.slice(0, 7)}.json`));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
  });

  test("펼친 카드의 본문 파일을 못 받으면 카드 안에 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    await failData(page, `detail-${latest.slice(0, 7)}.json`);
    await page.goto(`/${latest}`);
    const card = page.locator("ul.list > li.item").first();
    await card.locator("button.item-btn").click();
    await expect(card.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile(`detail-${latest.slice(0, 7)}.json`));
    await card.getByRole("button", { name: "다시 시도" }).click();
    await expect(card.getByRole("heading", { name: "왜 중요한가" })).toBeVisible();
  });

  test("이슈 목록 파일을 못 받으면 오류, 다시 시도로 회복한다", async ({ page }) => {
    await serverError(page, "issue-list.json");
    await page.goto("/issues");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("issue-list.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator("ul.list > li.item").first()).toContainText(info.issues.first.name);
  });

  test("이슈 묶음 파일을 못 받으면 이슈 페이지에 오류, 다시 시도로 회복한다", async ({ page }) => {
    await failData(page, "issue-0.json");
    await page.goto(`/issues/${info.issues.first.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("issue-0.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("heading", { level: 1, name: info.issues.first.name })).toBeVisible();
  });

  test("검색 색인을 못 받으면 오류를 보이고, 다시 시도하면 결과가 나온다", async ({ page }) => {
    await page.route("**/pagefind/pagefind.js", (route) => route.abort("failed"));
    await page.goto(`/search?q=${encodeURIComponent(info.issues.first.name)}`);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("검색 색인을 불러오지 못했다");
    await page.unroute("**/pagefind/pagefind.js");
    await alert.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("region", { name: "이슈" }).getByRole("link", { name: new RegExp(info.issues.first.name) })).toBeVisible();
  });
});

test.describe("빈 상태", () => {
  const emptyDates = { version: 1, latestDate: null, dates: [], months: [] };

  test("저장된 브리프가 없으면 첫 화면과 날짜 목록이 빈 상태 글을 보인다", async ({ page }) => {
    await fulfillData(page, "dates.json", emptyDates);
    await page.goto("/");
    await expect(page.getByText("아직 저장된 브리프가 없다.")).toBeVisible();
    await page.goto("/dates");
    await expect(page.getByText("아직 저장된 브리프가 없다.")).toBeVisible();
  });

  test("이슈가 없으면 이슈 목록이 빈 상태 글을 보인다", async ({ page }) => {
    await fulfillData(page, "issue-list.json", { issues: [], merged: {} });
    await page.goto("/issues");
    await expect(page.getByText("아직 이슈가 없다.")).toBeVisible();
  });
});

test.describe("다크 모드", () => {
  test("기기 설정이 다크면 어두운 색을, 라이트면 밝은 색을 쓴다", async ({ page }) => {
    const bg = () => page.evaluate("getComputedStyle(document.body).backgroundColor");
    const fg = () => page.evaluate("getComputedStyle(document.body).color");
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible();
    expect(await bg()).toBe("rgb(255, 255, 255)");
    expect(await fg()).toBe("rgb(29, 29, 31)");
    await page.emulateMedia({ colorScheme: "dark" });
    expect(await bg()).toBe("rgb(22, 22, 24)");
    expect(await fg()).toBe("rgb(236, 236, 238)");
  });
});

test.describe("주소 직접 열기와 새로 고침", () => {
  const cases: [string, (p: import("@playwright/test").Page) => import("@playwright/test").Locator][] = [
    [`/${second}`, (p) => p.getByRole("link", { name: dateLinkName(second) })],
    ["/dates", (p) => p.getByRole("heading", { level: 1, name: "날짜 목록" })],
    ["/issues", (p) => p.getByRole("heading", { level: 1, name: "이슈 목록" })],
    [`/issues/${info.issues.first.id}`, (p) => p.getByRole("heading", { level: 1, name: info.issues.first.name })],
    ["/search?q=" + encodeURIComponent(info.issues.first.name), (p) => p.getByRole("region", { name: "이슈" })],
    ["/about", (p) => p.getByRole("heading", { level: 1, name: "사이트 소개" })],
    [`/${second}/`, (p) => p.getByRole("link", { name: dateLinkName(second) })],
  ];
  for (const [url, locate] of cases) {
    test(`${url}를 직접 열고 새로 고쳐도 같은 화면이다`, async ({ page }) => {
      const res = await page.goto(url);
      expect(res?.status()).toBe(200);
      await expect(locate(page)).toBeVisible();
      await page.reload();
      await expect(locate(page)).toBeVisible();
    });
  }
});

test.describe("375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("3단계 화면에 가로 스크롤이 생기지 않는다", async ({ page }) => {
    const screens: [string, () => Promise<void>][] = [
      ["/", () => expect(page.getByRole("link", { name: dateLinkName(latest) })).toBeVisible()],
      [storyUrl(latest, `${info.latest.firstSection}-1`), () => expect(page.getByRole("heading", { name: "왜 중요한가" })).toBeVisible()],
      ["/dates", () => expect(page.getByRole("heading", { level: 1, name: "날짜 목록" })).toBeVisible()],
      ["/issues", () => expect(page.locator("ul.list > li.item").first()).toBeVisible()],
      [`/issues/${info.issues.first.id}`, () => expect(page.getByRole("heading", { level: 1, name: info.issues.first.name })).toBeVisible()],
      ["/search?q=" + encodeURIComponent(info.issues.first.name), () => expect(page.getByRole("region", { name: "이슈" })).toBeVisible()],
      ["/about", () => expect(page.getByRole("heading", { level: 1, name: "사이트 소개" })).toBeVisible()],
      ["/no-such-page", () => expect(page.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible()],
    ];
    for (const [url, ready] of screens) {
      await page.goto(url);
      await ready();
      await expectNoHorizontalScroll(page, url);
    }
    // 메뉴를 연 상태
    await page.goto("/");
    await page.getByRole("button", { name: "메뉴" }).click();
    await expect(page.getByRole("navigation", { name: "사이트 메뉴" })).toBeVisible();
    await expectNoHorizontalScroll(page, "메뉴");
  });
});
