// 4단계 화면(E2E): 펼친 카드의 용어 밑줄·칩과 대상 칩, 인물·기관·국가 목록·페이지, 용어 사전, 이슈 페이지의 등장 대상,
// 검색 결과 묶음, 새 주소 직접 열기·새로 고침, 375px 폭. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import type { Locator, Page } from "@playwright/test";
import { dataFile, expect, expectNoHorizontalScroll, failData, fulfillData, info, monthDay, serverError, storyItem, storyUrl, test } from "./base.ts";

const card = info.termCard;
const under = card.underlineTerm;
const chipOnly = card.chipOnlyTerm;
const latest = info.dates[0]!;

/** 용어 밑줄·칩이 있는 카드를 주소로 펼친다 */
async function openTermCard(page: Page): Promise<Locator> {
  await page.goto(storyUrl(card.date, card.key));
  const item = storyItem(page, card.key);
  await expect(item.getByRole("heading", { name: "용어" })).toBeVisible();
  return item;
}

function termBox(item: Locator, name: string): Locator {
  return item.getByRole("region", { name: `${name} 설명` });
}

test.describe("펼친 카드의 용어 밑줄과 칩", () => {
  test("밑줄 낱말을 누르면 설명이 열리고, 같은 것을 다시 누르면 닫힌다", async ({ page }) => {
    const item = await openTermCard(page);
    const word = item.locator("button.term", { hasText: under.surface! });
    await expect(word).toHaveCount(1);
    await expect(word).toHaveAttribute("aria-expanded", "false");
    await word.click();
    await expect(word).toHaveAttribute("aria-expanded", "true");
    await expect(word).toHaveClass(/open/);
    const box = termBox(item, under.name);
    await expect(box).toBeVisible();
    await expect(box).toContainText(under.description);
    await expect(word).toHaveAttribute("aria-controls", (await box.getAttribute("id"))!);
    // 같은 용어의 칩도 열린 것으로 보인다
    const chips = item.getByRole("group", { name: "용어" });
    await expect(chips.getByRole("button", { name: under.name })).toHaveAttribute("aria-expanded", "true");
    await word.click();
    await expect(word).toHaveAttribute("aria-expanded", "false");
    await expect(box).toHaveCount(0);
    await expect(chips.getByRole("button", { name: under.name })).toHaveAttribute("aria-expanded", "false");
  });

  test("다른 용어를 누르면 그 설명으로 바뀌고, 한 카드에 설명은 하나만 열린다", async ({ page }) => {
    const item = await openTermCard(page);
    const word = item.locator("button.term", { hasText: under.surface! });
    const chips = item.getByRole("group", { name: "용어" });
    // 칩 줄에는 본문 표기가 없는 용어도 있다
    await expect(chips.getByRole("button")).toHaveText([under, chipOnly].sort((a, b) => a.id - b.id).map((t) => t.name));
    await word.click();
    await expect(termBox(item, under.name)).toBeVisible();
    const other = chips.getByRole("button", { name: chipOnly.name });
    await other.click();
    await expect(other).toHaveAttribute("aria-expanded", "true");
    await expect(word).toHaveAttribute("aria-expanded", "false");
    await expect(termBox(item, chipOnly.name)).toBeVisible();
    await expect(termBox(item, chipOnly.name)).toContainText(chipOnly.description);
    await expect(termBox(item, under.name)).toHaveCount(0);
    await expect(item.locator(".tbox")).toHaveCount(1);
    await expect(item.locator("[aria-expanded='true']:is(button.term, .rel button)")).toHaveCount(1);
    // 칩을 다시 누르면 닫힌다
    await other.click();
    await expect(item.locator(".tbox")).toHaveCount(0);
    await expect(other).toHaveAttribute("aria-expanded", "false");
  });

  test("키보드(Enter·Space)로 밑줄과 칩을 열고 닫는다", async ({ page }) => {
    const item = await openTermCard(page);
    const word = item.locator("button.term", { hasText: under.surface! });
    await word.focus();
    await page.keyboard.press("Enter");
    await expect(word).toHaveAttribute("aria-expanded", "true");
    await expect(termBox(item, under.name)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(word).toHaveAttribute("aria-expanded", "false");
    await expect(item.locator(".tbox")).toHaveCount(0);
    const chip = item.getByRole("group", { name: "용어" }).getByRole("button", { name: chipOnly.name });
    await chip.focus();
    await page.keyboard.press("Space");
    await expect(chip).toHaveAttribute("aria-expanded", "true");
    await expect(termBox(item, chipOnly.name)).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(chip).toHaveAttribute("aria-expanded", "false");
  });

  test("설명 상자의 용어 사전 링크는 그 용어로 간다", async ({ page }) => {
    const item = await openTermCard(page);
    await item.locator("button.term", { hasText: under.surface! }).click();
    await termBox(item, under.name).getByRole("link", { name: /용어 사전에서 보기/ }).click();
    await expect(page).toHaveURL(`/terms/${under.id}`);
    const row = page.locator(`[id="term-${under.id}"]`);
    await expect(row).toHaveClass(/target/);
    await expect(row).toBeInViewport();
  });

  test("카드를 접었다 펴면 열었던 설명은 닫혀 있다", async ({ page }) => {
    const item = await openTermCard(page);
    await item.locator("button.term", { hasText: under.surface! }).click();
    await expect(item.locator(".tbox")).toHaveCount(1);
    const btn = item.locator("button.item-btn");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await btn.click();
    await expect(item.getByRole("heading", { name: "용어" })).toBeVisible();
    await expect(item.locator(".tbox")).toHaveCount(0);
  });
});

test.describe("펼친 카드의 대상 칩", () => {
  test("인물·기관·국가 칩은 그 대상 페이지로 간다", async ({ page }) => {
    const item = await openTermCard(page);
    await expect(item.getByRole("heading", { name: "인물·기관·국가" })).toBeVisible();
    for (const e of card.entities) await expect(item.locator(`.rel a[href="/entities/${e.id}"]`)).toBeVisible();
    // 인물은 한 줄 설명을 작게 붙인다
    const person = card.entities.find((e) => e.kind === "인물");
    if (person) await expect(item.locator(`.rel a[href="/entities/${person.id}"] small`)).toHaveText(person.description!);
    const target = card.entities[1] ?? card.entities[0]!;
    await item.locator(`.rel a[href="/entities/${target.id}"]`).click();
    await expect(page).toHaveURL(`/entities/${target.id}`);
    await expect(page.getByRole("heading", { level: 1, name: target.name })).toBeVisible();
  });
});

test.describe("인물·기관·국가 목록", () => {
  test("종류 칩으로 거르면 주소의 kind가 바뀌고 그 종류만 남는다", async ({ page }) => {
    await page.goto("/entities");
    const kinds = page.getByRole("group", { name: "종류" });
    await expect(kinds.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("ul.list > li.item").first()).toBeVisible();
    for (const [label, kind, value] of [
      ["인물", "인물", "person"],
      ["기관", "기관", "org"],
      ["국가", "국가", "country"],
    ] as const) {
      await kinds.getByRole("button", { name: label }).click();
      await expect(page).toHaveURL(`/entities?kind=${value}`);
      await expect(kinds.getByRole("button", { name: label })).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("ul.list > li.item").first()).toBeVisible();
      const cats = await page.locator("ul.list > li.item .cat").allInnerTexts();
      for (const c of cats) expect(c.startsWith(`${kind} · `), c).toBe(true);
    }
    await kinds.getByRole("button", { name: "전체" }).click();
    await expect(page).toHaveURL("/entities");
  });

  test("주소의 kind로 직접 열면 그 종류로 걸러져 있고, 모르는 값은 전체다", async ({ page }) => {
    await page.goto("/entities?kind=country");
    const kinds = page.getByRole("group", { name: "종류" });
    await expect(kinds.getByRole("button", { name: "국가" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("ul.list > li.item").first()).toContainText(info.entities.country.name);
    await page.goto("/entities?kind=unknown");
    await expect(kinds.getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: new RegExp(info.entities.org.name) }).first().click();
    await expect(page).toHaveURL(`/entities/${info.entities.org.id}`);
  });

  test("걸러진 결과가 없으면 빈 상태 글을 보인다", async ({ page }) => {
    await fulfillData(page, "entity-list-person-0.json", { filter: "person", page: 0, pages: 1, total: 0, items: [] });
    await page.goto("/entities?kind=person");
    await expect(page.getByText("이 종류에 해당하는 항목이 없다.")).toBeVisible();
  });

  test("대상이 하나도 없으면 전체 목록이 빈 상태 글을 보인다", async ({ page }) => {
    await fulfillData(page, "entity-list-all-0.json", { filter: "all", page: 0, pages: 1, total: 0, items: [] });
    await page.goto("/entities");
    await expect(page.getByText("아직 인물·기관·국가가 없다.")).toBeVisible();
  });

  test("목록 파일을 못 받으면 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    await failData(page, "entity-list-org-0.json");
    await page.goto("/entities?kind=org");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("entity-list-org-0.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator("ul.list > li.item").first()).toContainText(info.entities.org.name);
  });
});

test.describe("인물·기관·국가 페이지", () => {
  test("처음에는 앞쪽 뉴스만 보이고, 더 보기를 누르면 나머지 뉴스를 받아 보인다", async ({ page }) => {
    const { id, name, shown, moreNews, firstNews, nextNews } = info.entities.most;
    expect(moreNews, "지어낸 데이터에 더 보기가 있는 대상이 있다").toBeGreaterThan(0);
    const newsRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/site-data/entity-news-")) newsRequests.push(r.url());
    });
    await page.goto(`/entities/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page).toHaveTitle(`${name} · Tidwyn`);
    const rows = page.locator("ul.rows > li");
    await expect(rows).toHaveCount(shown);
    await expect(rows.first()).toContainText(firstNews);
    expect(newsRequests).toEqual([]);
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(rows).toHaveCount(shown + Math.min(moreNews, 100));
    await expect(rows.nth(shown)).toContainText(nextNews!);
    expect(newsRequests).toHaveLength(1);
    await expect(page.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
    // 등장 뉴스를 누르면 그 카드로 간다
    const href = (await rows.nth(shown).locator("a").getAttribute("href"))!;
    await rows.nth(shown).locator("a").click();
    await expect(page).toHaveURL(href);
  });

  test("나머지 뉴스 파일을 못 받으면 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    const { id, shown } = info.entities.most;
    await serverError(page, "entity-news-0.json");
    await page.goto(`/entities/${id}`);
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("entity-news-0.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator("ul.rows > li").nth(shown)).toBeVisible();
  });

  test("흡수된 대상 주소는 남는 대상 주소로 바뀌고 합쳐졌다는 줄을 보인다", async ({ page }) => {
    const { id, into, intoName } = info.entities.merged;
    await page.goto(`/entities/${id}`);
    await expect(page).toHaveURL(`/entities/${into}`);
    await expect(page.getByRole("heading", { level: 1, name: intoName })).toBeVisible();
    await expect(page.getByRole("note")).toHaveText(`이 항목은 ${monthDay(latest)}에 ${intoName}에 합쳐졌다.`);
  });

  for (const [label, id] of [
    ["지운 대상", info.entities.deleted.id],
    ["묶음에 없는 식별자", 99],
    ["묶음 파일이 없는 식별자", 12345],
  ] as const) {
    test(`${label}(/entities/${id})는 없는 페이지다`, async ({ page }) => {
      await page.goto(`/entities/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible();
    });
  }

  test("대상 묶음 파일이 서버 오류면 없는 페이지가 아니라 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    await serverError(page, "entity-0.json");
    await page.goto(`/entities/${info.entities.org.id}`);
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("entity-0.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("heading", { level: 1, name: info.entities.org.name })).toBeVisible();
  });
});

test.describe("용어 사전", () => {
  test("용어 주소로 들어오면 그 용어로 스크롤하고 강조한다", async ({ page }) => {
    const { id, name } = info.terms.far;
    await page.goto(`/terms/${id}`);
    const row = page.locator(`[id="term-${id}"]`);
    await expect(row).toHaveClass(/target/);
    await expect(row.getByRole("heading", { level: 3 })).toHaveText(name);
    await expect(row).toBeInViewport();
    await expect(row).toBeFocused();
    expect(await page.evaluate("window.scrollY")).toBeGreaterThan(0);
    // 다른 용어는 강조하지 않는다
    await expect(page.locator("li.gl.target")).toHaveCount(1);
  });

  test("용어 사전은 첫 자음으로 묶어 보이고, 첫 자음 링크로 그 묶음에 간다", async ({ page }) => {
    await page.goto("/terms");
    await expect(page.getByRole("heading", { level: 1, name: "용어 사전" })).toBeVisible();
    await expect(page.locator("li.gl.target")).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "첫 자음으로 가기" });
    const last = nav.getByRole("link").last();
    const label = (await last.innerText()).trim();
    await last.click();
    const heading = page.getByRole("heading", { level: 2, name: label });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    // 화면에 가까워진 묶음은 받아서 그린다
    await expect(page.locator(`[id="term-${info.terms.far.id}"]`)).toBeVisible();
  });

  test("흡수된 용어 주소는 남는 용어 주소로 바뀌고 합쳐졌다는 줄을 보인다", async ({ page }) => {
    const { id, into } = info.terms.merged;
    await page.goto(`/terms/${id}`);
    await expect(page).toHaveURL(`/terms/${into}`);
    await expect(page.getByRole("note")).toHaveText(`이 항목은 ${monthDay(info.terms.merged.on)}에 ${under.name}에 합쳐졌다.`);
    await expect(page.locator(`[id="term-${into}"]`)).toHaveClass(/target/);
  });

  for (const [label, id] of [
    ["지운 용어", info.terms.deleted],
    ["없는 용어", 999],
  ] as const) {
    test(`${label}(/terms/${id})는 없는 페이지다`, async ({ page }) => {
      await page.goto(`/terms/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible();
    });
  }

  test("색인 파일을 못 받으면 오류를 보이고, 다시 시도로 회복한다", async ({ page }) => {
    await failData(page, "term-index.json");
    await page.goto("/terms");
    await expect(page.getByRole("alert")).toBeVisible();
    await page.unroute(dataFile("term-index.json"));
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.getByRole("navigation", { name: "첫 자음으로 가기" })).toBeVisible();
  });

  test("용어가 없으면 빈 상태 글을 보인다", async ({ page }) => {
    await fulfillData(page, "term-index.json", { total: 0, groups: [], ids: {}, merged: {} });
    await page.goto("/terms");
    await expect(page.getByText("아직 용어가 없다.")).toBeVisible();
  });
});

test.describe("이슈 페이지의 등장 대상", () => {
  test("등장 인물·기관·국가를 횟수와 함께 보이고, 누르면 그 대상 페이지로 간다", async ({ page }) => {
    const { id, name, entities } = info.issues.withEntities;
    await page.goto(`/issues/${id}`);
    await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "등장 인물·기관·국가" })).toBeVisible();
    const chips = page.locator(".rel a[href^='/entities/']");
    await expect(chips).toHaveCount(Math.min(entities.length, 10));
    for (const [i, e] of entities.slice(0, 10).entries()) {
      await expect(chips.nth(i)).toHaveAttribute("href", `/entities/${e.id}`);
      await expect(chips.nth(i)).toHaveText(`${e.name}${e.count}회`);
    }
    await chips.first().click();
    await expect(page).toHaveURL(`/entities/${entities[0]!.id}`);
    await expect(page.getByRole("heading", { level: 1, name: entities[0]!.name })).toBeVisible();
  });
});

test.describe("검색 결과 묶음", () => {
  test("결과를 인물·기관·국가, 용어, 이슈, 뉴스 순으로 나눠 보인다", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent("가짜국")}`);
    const groups = page.locator("section[aria-labelledby^='r-'] > h2");
    await expect(groups).toHaveText(["인물·기관·국가", "용어", "이슈", "뉴스"]);
    const entities = page.getByRole("region", { name: "인물·기관·국가" });
    await expect(entities.locator(`a[href="/entities/${info.entities.country.id}"]`)).toBeVisible();
    const terms = page.getByRole("region", { name: "용어" });
    const termLink = terms.getByRole("link").first();
    const href = (await termLink.getAttribute("href"))!;
    expect(href).toMatch(/^\/terms\/\d+$/);
    await termLink.click();
    await expect(page).toHaveURL(href);
    await expect(page.locator(`[id="term-${href.split("/").pop()}"]`)).toHaveClass(/target/);
  });

  test("용어 이름으로 찾으면 용어 묶음에 그 용어가 나온다", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(info.terms.far.name)}`);
    await expect(page.getByRole("region", { name: "용어" }).locator(`a[href="/terms/${info.terms.far.id}"]`)).toBeVisible();
  });

  test("대상 이름으로 찾으면 그 대상이 나오고 누르면 대상 페이지로 간다", async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(info.entities.person.name)}`);
    const link = page.getByRole("region", { name: "인물·기관·국가" }).locator(`a[href="/entities/${info.entities.person.id}"]`);
    await link.click();
    await expect(page.getByRole("heading", { level: 1, name: info.entities.person.name })).toBeVisible();
  });
});

test.describe("새 주소 직접 열기와 새로 고침", () => {
  const cases: [string, (p: Page) => Locator][] = [
    ["/entities", (p) => p.getByRole("heading", { level: 1, name: "인물·기관·국가" })],
    ["/entities?kind=org", (p) => p.getByRole("group", { name: "종류" }).getByRole("button", { name: "기관" })],
    [`/entities/${info.entities.org.id}`, (p) => p.getByRole("heading", { level: 1, name: info.entities.org.name })],
    ["/terms", (p) => p.getByRole("heading", { level: 1, name: "용어 사전" })],
    [`/terms/${under.id}`, (p) => p.locator(`[id="term-${under.id}"].target`)],
    [storyUrl(card.date, card.key), (p) => storyItem(p, card.key).getByRole("group", { name: "용어" })],
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

  test("흡수된 대상 주소에서 바뀐 주소를 새로 고쳐도 남는 대상을 보인다", async ({ page }) => {
    await page.goto(`/entities/${info.entities.merged.id}`);
    await expect(page).toHaveURL(`/entities/${info.entities.merged.into}`);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: info.entities.merged.intoName })).toBeVisible();
  });
});

test.describe("375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("4단계 화면에 가로 스크롤이 생기지 않는다", async ({ page }) => {
    const screens: [string, () => Promise<void>][] = [
      ["/entities", () => expect(page.locator("ul.list > li.item").first()).toBeVisible()],
      ["/entities?kind=person", () => expect(page.locator("ul.list > li.item").first()).toBeVisible()],
      [`/entities/${info.entities.most.id}`, () => expect(page.getByRole("heading", { level: 1, name: info.entities.most.name })).toBeVisible()],
      ["/terms", () => expect(page.getByRole("navigation", { name: "첫 자음으로 가기" })).toBeVisible()],
      [`/terms/${info.terms.far.id}`, () => expect(page.locator(`[id="term-${info.terms.far.id}"]`)).toBeInViewport()],
      [`/issues/${info.issues.withEntities.id}`, () => expect(page.getByRole("heading", { level: 2, name: "등장 인물·기관·국가" })).toBeVisible()],
      [`/search?q=${encodeURIComponent("가짜국")}`, () => expect(page.getByRole("region", { name: "용어" })).toBeVisible()],
    ];
    for (const [url, ready] of screens) {
      await page.goto(url);
      await ready();
      await expectNoHorizontalScroll(page, url);
    }
    // 대상 페이지의 더 보기 뒤
    await page.goto(`/entities/${info.entities.most.id}`);
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.locator("ul.rows > li").nth(info.entities.most.shown)).toBeVisible();
    await expectNoHorizontalScroll(page, "대상 페이지 더 보기");
    // 용어 설명을 연 카드
    const item = await openTermCard(page);
    await item.locator("button.term", { hasText: under.surface! }).click();
    await expect(termBox(item, under.name)).toBeVisible();
    await expectNoHorizontalScroll(page, "용어 설명을 연 카드");
  });
});
