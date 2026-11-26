// B2단계 영상 탭(E2E): 탭 목록·순서·기억·해시(4.3-1), 영상 항목·분야 칩·썸네일·빈 상태(4.3-2), 검색 결과에서 영상 탭으로(4.3-3).
// 영상·저장소 기록이 있는 지어낸 데이터로 따로 빌드한 사이트(prepare.ts의 b2-out, 포트 E2E_B2_PORT)를 본다. 브라우저 시계는 base.ts가 끝 날짜에 고정한다.
// 썸네일 요청은 밖으로 나가지 않게 가로채 테스트용 로컬 이미지로 답한다(base.ts는 밖으로 가는 요청을 모두 막는다).
import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, test } from "./base.ts";
import { E2E_B2_BASE_URL, E2E_B2_INFO_FILE, E2E_B2_OUT_DIR } from "./paths.ts";
import { durationText } from "../../site/src/components/videoView.ts";
import { BRIEF_TAB_KEY, READ_MARKS_KEY } from "../../site/src/lib/browserKeys.ts";
import { videoPartOf, type DayList, type MonthList, type VideoPartFile } from "../../src/siteTypes.ts";
import { TEST_MISSING_THUMB_PNG, TEST_THUMB_PNG, routeThumbs } from "./thumbs.ts";

test.use({ baseURL: E2E_B2_BASE_URL });

interface B2Info {
  dates: string[];
  /** 영상 실음 + 빌더 */
  shown: string;
  /** 영상 새 영상 없음 + 빌더 */
  none: string;
  /** 영상 받지 못함 + 빌더 */
  failed: string;
  /** 영상만(빌더 기록 없음) */
  only: string;
  /** 둘 다 없음 */
  absent: string;
  /** 지어낸 받지 못한 이유(결과물에 없어야 한다) */
  reason: string;
}
const b2 = JSON.parse(fs.readFileSync(E2E_B2_INFO_FILE, "utf8")) as B2Info;
const SITE_DATA = path.join(E2E_B2_OUT_DIR, "site-data");
const dayOf = (date: string): DayList => (JSON.parse(fs.readFileSync(path.join(SITE_DATA, `list-${date.slice(0, 7)}.json`), "utf8")) as MonthList).days.find((d) => d.date === date)!;
const videosOf = (date: string) => (JSON.parse(fs.readFileSync(path.join(SITE_DATA, `watch-${videoPartOf(date)}.json`), "utf8")) as VideoPartFile).days[date]!;
const SHOWN = videosOf(b2.shown).items;
const CATS = [...new Set(SHOWN.map((i) => i.category))];
/** '모든 분야'의 순서: 분야를 섞어 하루 평균 조회수 순(같으면 분야 순서·순위 그대로) */
const MIXED = [...SHOWN].sort((a, b) => b.dailyViews - a.dailyViews);
const sectionsOf = (date: string) => dayOf(date).sections.map((s) => s.name);
const NONE_TEXT = "이 날에는 새로 실을 영상이 없습니다.";
const FAILED_TEXT = "이 날에는 영상을 준비하지 못했습니다.";

const tabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });
const tab = (page: Page, name: string) => tabs(page).getByRole("button", { name, exact: true });
const pressedTab = (page: Page) => tabs(page).locator("button[aria-pressed=true]");
const rows = (page: Page) => page.locator("main ol.videos > li");
const chips = (page: Page) => page.getByRole("group", { name: "분야" });

test.beforeEach(async ({ page }) => {
  await routeThumbs(page);
});

async function openVideos(page: Page, date: string): Promise<void> {
  await page.goto(`/${date}`);
  await tab(page, "영상").click();
  await expect(pressedTab(page)).toHaveText("영상");
}

test.describe("4.3-1 영상 탭의 자리와 기억", () => {
  test("탭 순서는 전체 → 뉴스 섹션 → 영상 → 빌더이고, 기록이 있는 날에만 건수 없는 '영상' 탭이 있다", async ({ page }) => {
    for (const date of [b2.shown, b2.none, b2.failed]) {
      await page.goto(`/${date}`);
      await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...sectionsOf(date), "영상", "빌더"]);
    }
    await page.goto(`/${b2.only}`);
    await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...sectionsOf(b2.only), "영상"]);
    await page.goto(`/${b2.absent}`);
    await expect(tabs(page).getByRole("button")).toHaveText(["전체", ...sectionsOf(b2.absent)]);
  });

  test("'전체' 탭에는 영상이 섞이지 않고, 날짜 목록의 뉴스 읽은 수는 영상을 세지 않는다", async ({ page }) => {
    await page.goto(`/${b2.shown}`);
    await tab(page, "전체").click();
    await expect(page.locator("main li[id^=story-]")).toHaveCount(dayOf(b2.shown).sections.flatMap((s) => s.stories).length);
    await expect(page.locator("main ol.videos")).toHaveCount(0);
    for (const item of SHOWN.slice(0, 3)) await expect(page.locator("main")).not.toContainText(item.title);
    const stories = dayOf(b2.shown).sections.flatMap((s) => s.stories);
    await page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [READ_MARKS_KEY, JSON.stringify({ v: 1, d: { [b2.shown]: stories.slice(0, 2).map((s) => s.key).sort() } })]);
    await page.goto("/dates");
    await expect(page.locator(`a.row-link[href="/${b2.shown}"] .read-prog`)).toHaveText(`2/${stories.length} 읽음`);
  });

  test("영상 탭에는 대분류 칩·'안 읽은 것만'·요약·키워드가 없고, 이번 주 일정|지표 상자는 뉴스 탭처럼 접힌 채 있다", async ({ page }) => {
    await openVideos(page, b2.shown);
    await expect(rows(page)).toHaveCount(SHOWN.length);
    await expect(page.locator("main .week-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("main .headline")).toHaveCount(0);
    await expect(page.locator("main .kw")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "카테고리" })).toHaveCount(0);
    await expect(page.getByText("안 읽은 것만")).toHaveCount(0);
  });

  test("영상 탭을 고르면 해시 없이 기억되고 새로 고치면 다시 열리며, 기록 없는 날짜로 가면 그날 첫 섹션 탭이다", async ({ page }) => {
    await openVideos(page, b2.only);
    expect(new URL(page.url()).hash).toBe("");
    expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("영상");
    await page.reload();
    await expect(pressedTab(page)).toHaveText("영상");
    expect(b2.dates.indexOf(b2.absent)).toBe(b2.dates.indexOf(b2.only) + 1);
    await page.getByRole("link", { name: /^이전 날짜/ }).click();
    await expect(page).toHaveURL(new RegExp(`/${b2.absent}$`));
    await expect(pressedTab(page)).toHaveText(sectionsOf(b2.absent)[0]!);
  });

  test("#videos로 들어오면 그날 영상 탭이 열리고, 기록이 없는 날의 #videos는 기본 탭이다. /videos/<날짜>/abc는 404다", async ({ page }) => {
    for (const url of [`/${b2.shown}#videos`, "/#videos", `/${b2.failed}#videos`]) {
      await page.goto("/about");
      await page.evaluate(() => localStorage.clear());
      await page.goto(url);
      await expect(pressedTab(page)).toHaveText("영상");
      await expect(page.locator("main h2.repo-head")).toHaveText("이번 주 볼만한 영상");
      expect(await page.evaluate((k) => localStorage.getItem(k), BRIEF_TAB_KEY)).toBe("영상");
    }
    await page.evaluate(() => localStorage.clear());
    await page.goto(`/${b2.absent}#videos`);
    await expect(pressedTab(page)).toHaveText("한국");
    const res = await page.goto(`/videos/${b2.shown}/abc`);
    expect(res?.status()).toBe(404);
  });

  test("키보드로 영상 탭과 분야 칩을 고를 수 있다", async ({ page }) => {
    await page.goto(`/${b2.shown}`);
    await tab(page, "영상").focus();
    await page.keyboard.press("Enter");
    await expect(pressedTab(page)).toHaveText("영상");
    await chips(page).getByRole("button").nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(SHOWN.filter((i) => i.category === CATS[0]).length);
  });
});

test.describe("4.3-2 영상 항목", () => {
  test("굵은 제목 아래 '모든 분야'는 분야를 섞어 하루 평균 조회수 순이고, 각 칸(분야·제목 링크·채널·조회수·업로드 때·길이·썸네일)이 있다", async ({ page }) => {
    await openVideos(page, b2.shown);
    await expect(page.locator("main h2.repo-head")).toHaveText("이번 주 볼만한 영상");
    await expect(chips(page).getByRole("button").first()).toHaveAttribute("aria-pressed", "true");
    expect(new Set(MIXED.slice(0, 3).map((i) => i.category)).size, "지어낸 데이터에서 분야가 섞인다").toBeGreaterThan(1);
    await expect(rows(page).locator(".video-title")).toHaveText(MIXED.map((i) => `${i.title} (새 탭)`));
    for (const [k, item] of MIXED.entries()) {
      const row = rows(page).nth(k);
      const link = row.getByRole("link");
      await expect(link).toHaveAttribute("href", `https://www.youtube.com/watch?v=${item.id}`);
      await expect(link).toHaveAttribute("target", "_blank");
      await expect(link).toHaveAttribute("rel", "noopener noreferrer");
      await expect(row.locator(".video-meta")).toContainText(item.category);
      await expect(row.locator(".video-meta")).toContainText(item.channel);
      const img = row.locator("img");
      await expect(img).toHaveAttribute("src", `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`);
      await expect(img).toHaveAttribute("loading", "lazy");
      await expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(img).toHaveAttribute("alt", "");
    }
    // 조회수 어림 표기('조회수' 글 없이)와 길이 표기(지어낸 데이터의 첫 항목들이 만·억·그대로와 시:분:초·분:초를 담는다).
    // 길이는 썸네일 위 상자에 보이고 정보 줄에는 화면 낭독용 글로만 있다. 업로드 때는 보는 시각 기준(7일을 넘으면 날짜)이다
    const metas = await rows(page).locator(".video-meta").allTextContents();
    expect(metas.some((m) => /조회수/.test(m))).toBe(false);
    expect(metas.some((m) => / · [\d.,]+만회 · /.test(m))).toBe(true);
    expect(metas.some((m) => / · [\d.,]+억회 · /.test(m))).toBe(true);
    expect(metas.some((m) => / · [\d,]+회 · /.test(m))).toBe(true);
    for (const m of metas) expect(m).toMatch(/회 · (\d+(분|시간|일) 전|\d+월 \d+일) · 길이 \d+(:\d{2}){1,2}$/);
    expect(metas.some((m) => /길이 \d+:\d{2}:\d{2}$/.test(m))).toBe(true);
    await expect(rows(page).locator(".video-thumb .video-dur")).toHaveText(MIXED.map((i) => durationText(i.duration)));
  });

  test("제목 링크는 밑줄과 ↗이 없고, 항목 어디를 눌러도 그 링크가 눌린다", async ({ page }) => {
    await openVideos(page, b2.shown);
    const first = rows(page).first();
    const link = first.getByRole("link");
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await link.hover();
    await expect(link).toHaveCSS("text-decoration-line", "none");
    await expect(first).not.toContainText("↗");
    // 썸네일 가운데와 정보 줄 위를 눌렀을 때 받는 요소가 그 영상의 제목 링크다(링크를 항목 전체로 넓힘)
    for (const sel of [".video-thumb", ".video-meta"]) {
      const b = (await first.locator(sel).boundingBox())!;
      const href = await page.evaluate(`document.elementFromPoint(${b.x + b.width / 2}, ${b.y + b.height / 2})?.closest("a")?.href ?? null`);
      expect(href, sel).toBe(`https://www.youtube.com/watch?v=${MIXED[0]!.id}`);
    }
  });

  test("분야 칩은 '모든 분야'와 그날 있는 분야만 건수와 함께 있고, 고르면 그 분야만 남으며 항목에 분야를 쓰지 않는다", async ({ page }) => {
    await openVideos(page, b2.shown);
    await expect(chips(page).getByRole("button")).toHaveText([`모든 분야 ${SHOWN.length}`, ...CATS.map((c) => `${c} ${SHOWN.filter((i) => i.category === c).length}`)]);
    const cat = CATS[1]!;
    await chips(page).getByRole("button", { name: new RegExp(`^${cat.replace(/[/.]/g, "\\$&")} `) }).click();
    const want = SHOWN.filter((i) => i.category === cat);
    await expect(rows(page)).toHaveCount(want.length);
    await expect(rows(page).locator(".video-title")).toHaveText(want.map((i) => `${i.title} (새 탭)`));
    for (const m of await rows(page).locator(".video-meta").allTextContents()) expect(m.startsWith(`${cat} · `)).toBe(false);
  });

  test("썸네일은 크기를 미리 잡고, 받지 못하면 깨진 이미지 없이 빈 자리만 남는다", async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 404, contentType: "text/plain", body: "no" }));
    await openVideos(page, b2.shown);
    const first = rows(page).first();
    await expect(first.locator("img")).toBeHidden();
    const box = (await first.locator(".video-thumb").boundingBox())!;
    expect(box.width).toBeGreaterThan(0);
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.05);
  });

  test("없는 영상이라 YouTube가 120×90 대체 그림을 돌려주어도 그림 없이 빈 자리만 남는다(browser-check 2026-11-27)", async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: TEST_MISSING_THUMB_PNG }));
    await openVideos(page, b2.shown);
    const first = rows(page).first();
    await expect(first.locator("img")).toBeHidden();
    const box = (await first.locator(".video-thumb").boundingBox())!;
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.05);
  });

  test("받은 썸네일은 칸 크기 그대로 보인다", async ({ page }) => {
    await openVideos(page, b2.shown);
    const first = rows(page).first();
    await expect(first.locator("img")).toBeVisible();
    await expect.poll(() => first.locator("img").evaluate((i) => (i as unknown as { naturalWidth: number }).naturalWidth)).toBeGreaterThan(0);
    expect(TEST_THUMB_PNG.length).toBeGreaterThan(0);
  });

  test.describe("폰 폭(375px)", () => {
    test.use({ viewport: { width: 375, height: 812 } });
    test("긴 제목(100자)과 긴 채널 이름도 가로 스크롤이 없고, 제목 링크와 칩의 누를 곳이 44px 이상이다", async ({ page }) => {
      expect(SHOWN.some((i) => Array.from(i.title).length >= 100), "100자 제목이 지어낸 데이터에 있다").toBe(true);
      await openVideos(page, b2.shown);
      await expectNoHorizontalScroll(page, "영상 탭");
      for (const k of [0, 1, 2]) {
        const b = (await rows(page).nth(k).getByRole("link").boundingBox())!;
        expect(b.height).toBeGreaterThanOrEqual(44);
      }
      const chip = (await chips(page).getByRole("button").first().boundingBox())!;
      expect(chip.height).toBeGreaterThanOrEqual(44);
    });
  });

  test("새 영상 없음과 받지 못함은 빈 상태 문구이고, 받지 못한 이유는 화면·결과물에 없다", async ({ page }) => {
    for (const [date, text] of [[b2.none, NONE_TEXT], [b2.failed, FAILED_TEXT]] as const) {
      await page.goto(`/${date}#videos`);
      await expect(pressedTab(page)).toHaveText("영상");
      await expect(page.locator("main p.state.empty")).toHaveText(text);
      await expect(rows(page)).toHaveCount(0);
      await expect(chips(page)).toHaveCount(0);
      await expect(page.locator("main")).not.toContainText(b2.reason);
    }
    const leak = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return leak(p);
        return /\.(json|html|js|txt|xml)$/.test(e.name) && fs.readFileSync(p, "utf8").includes(b2.reason) ? [p] : [];
      });
    expect(leak(E2E_B2_OUT_DIR)).toEqual([]);
  });
});

test.describe("4.3-3 검색", () => {
  test("영상 제목·채널 낱말로 찾고, 결과를 누르면 그 날짜의 영상 탭이 열린다", async ({ page }) => {
    const item = SHOWN[0]!;
    for (const q of [item.title.split(" ")[0]!, item.channel.split(" ")[0]!]) {
      await page.goto("/about");
      await page.evaluate(() => localStorage.clear());
      await page.goto(`/search?q=${encodeURIComponent(q)}`);
      const section = page.locator("section", { has: page.getByRole("heading", { name: "영상", exact: true }) });
      const result = section.getByRole("link").first();
      await expect(result).toHaveAttribute("href", `/${b2.shown}#videos`);
      await result.click();
      await expect(page).toHaveURL(new RegExp(`/${b2.shown}#videos$`));
      await expect(pressedTab(page)).toHaveText("영상");
      await expect(rows(page).first()).toBeVisible();
    }
  });
});
