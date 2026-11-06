// 9.7단계 화면(E2E): 영상 줄의 '구간별로 보기', 영상별 페이지, 시각 링크, 없는 영상 안내, 대기·오류, 바뀐 문구. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Page, Route } from "@playwright/test";
import { READY_STATE, expect, expectNoHorizontalScroll, info, test } from "./base.ts";
import { E2E_DATA_DIR, E2E_VIDEO_DATA_DIR, E2E_VIDEO_INFO_FILE } from "./paths.ts";
import type { VideoFixtureInfo } from "../../site/dev/videoFixtures.ts";
import { videoPath } from "../../site/src/lib/routes.ts";
import { durationClock } from "../../site/src/lib/videos.ts";
import type { DaySections, DayVideos, IssueChunk, SiteVideo } from "../../src/siteTypes.ts";

const SITE_DATA = path.join(E2E_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const s = info.videos.sections!;
const dayVideos = (date: string) => json<DayVideos>(`videos-${date}.json`).videos;
const sectionsOf = (date: string, id: string) => json<DaySections>(`video-sections-${date}.json`).videoSections[id]!;
const byId = (id: string) => dayVideos(s.date).find((x) => x.id === id)!;
const eight = byId(s.eight);
const three = byId(s.three);
const none = byId(s.none);
const MISSING = "이 주소에는 영상이 없다";

const rowOf = (page: Page, v: SiteVideo) => page.locator("main li.vrow", { hasText: v.title });
const sectionLink = (page: Page) => page.getByRole("link", { name: /구간별로 보기/ });

async function expectPage(page: Page, v: SiteVideo): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: v.title })).toBeVisible();
  await expect(page.locator("main li.vsecrow")).toHaveCount(sectionsOf(s.date, v.id).length);
  await expect(page.locator("main")).toContainText(v.channel);
  await expect(page.locator("main")).toContainText(v.reason);
  await expect(page.locator("main")).toContainText("시각은 제작자 챕터나 AI가 찾은 위치라");
  await expect(page.locator("main")).toContainText("구간 정리는 Tidwyn이 썼습니다");
  await expect(page).toHaveTitle(new RegExp(v.title.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

test.describe("4.4-2 영상 줄의 링크", () => {
  test("브리프: 구간 있는 영상만 링크가 있고, 눌러 들어가면 페이지가 보이고 새로 고쳐도 보인다", async ({ page }) => {
    await page.goto(`/${s.date}#videos`);
    await expect(rowOf(page, none)).toBeVisible();
    await expect(sectionLink(page)).toHaveCount(dayVideos(s.date).filter((x) => x.hasSections).length);
    await expect(rowOf(page, none).getByRole("link", { name: /구간별로 보기/ })).toHaveCount(0);
    await rowOf(page, three).getByRole("link", { name: /구간별로 보기/ }).click();
    await expect(page).toHaveURL(videoPath(s.date, s.three));
    await expectPage(page, three);
    await page.reload();
    await expectPage(page, three);
  });

  test("하단 탭 바 바로 위의 요약을 펼치면 글이 탭 바 뒤에 가리지 않는다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto(`/${s.date}#videos`);
    const button = page.locator(".vsumbtn").first();
    const tabTop = await page.locator(".tabs").boundingBox().then((b) => b!.y);
    const bottom = await button.boundingBox().then((b) => b!.y + b!.height);
    await page.evaluate(`window.scrollBy(0, ${bottom - tabTop})`);
    await button.click();
    const text = page.locator(".vsumtext:visible").first();
    await expect.poll(() => text.boundingBox().then((b) => b!.y + b!.height)).toBeLessThanOrEqual(tabTop);
  });
  test("요약은 ▾▴, 구간 링크는 ›로 구분하고 표시는 보조 기술에 숨긴다. 영상 탭은 구간 파일을 받지 않는다", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (r) => asked.push(r.url()));
    await page.goto(`/${s.date}#videos`);
    const link = rowOf(page, three).getByRole("link", { name: /구간별로 보기/ });
    await expect(link.locator("[aria-hidden]")).toHaveText("›");
    await expect(link).toHaveAccessibleName(/^구간별로 보기 ?: [^›]+$/);
    const row = page.locator("li.vrow", { has: page.locator(".vsumbtn") }).first();
    const button = row.locator(".vsumbtn");
    await expect(button).toHaveText("요약 보기 ▾");
    await expect(button).toHaveAccessibleName("요약 보기");
    await button.click();
    await expect(button).toHaveText("요약 접기 ▴");
    await expect(button).toHaveAccessibleName("요약 접기");
    expect(asked.filter((u) => u.includes("video-sections-"))).toEqual([]);
  });

  test("이슈 '관련 영상': 구간 있는 영상에 링크가 있고 그 날짜의 페이지로 간다", async ({ page }) => {
    const issue = json<IssueChunk>("issue-0.json").issues[String(info.videos.many)]!;
    await page.goto(`/issues/${info.videos.many}`);
    const related = page.locator("section", { has: page.getByRole("heading", { name: "관련 영상" }) });
    await expect(related.locator("li.vrow").first()).toBeVisible();
    const link = related.getByRole("link", { name: /구간별로 보기/ }).first();
    await expect(link).toBeVisible();
    expect(issue.videoRefs).toBeTruthy();
    await link.click();
    await expect(page).toHaveURL(/\/videos\/\d{4}-\d{2}-\d{2}\//);
    await expect(page.locator("main li.vsecrow").first()).toBeVisible();
  });
});

test.describe("4.4-1·3 영상별 페이지", () => {
  test("주소를 바로 열면 8구간이 시각, 제목, 내용 순으로 보이고 시각이 YouTube 새 탭으로 간다", async ({ page }) => {
    await page.goto(videoPath(s.date, s.eight));
    await expectPage(page, eight);
    const items = page.locator("main li.vsecrow");
    for (const [i, sec] of sectionsOf(s.date, eight.id).entries()) {
      const a = items.nth(i).getByRole("link");
      await expect(a).toHaveText(`${durationClock(sec.start)} ↗`);
      await expect(a).toHaveAttribute("href", `https://www.youtube.com/watch?v=${eight.id}&t=${sec.start}s`);
      await expect(a).toHaveAttribute("target", "_blank");
      await expect(a).toHaveAccessibleName(new RegExp(`^${durationClock(sec.start)} `));
      await expect(items.nth(i).locator("h3")).toHaveText(sec.title);
      await expect(items.nth(i).locator("p")).toHaveText(sec.gist);
      await expect(items.nth(i).locator("ul li")).toHaveText(sec.points);
    }
  });

  test("한 시간 넘는 영상의 시각은 시:분:초이고, 썸네일과 제목은 YouTube로, 브리프 링크는 그 날짜로 간다", async ({ page }) => {
    const h = info.videos.sectionsHour!;
    const v = dayVideos(h.date).find((x) => x.id === h.id)!;
    await page.goto(videoPath(h.date, h.id));
    const late = sectionsOf(h.date, h.id).at(-1)!;
    expect(late.start).toBeGreaterThanOrEqual(3600);
    await expect(page.locator("main li.vsecrow").last().getByRole("link")).toHaveText(`${durationClock(late.start)} ↗`);
    await expect(page.locator("main a.vpagethumb")).toHaveAttribute("href", `https://www.youtube.com/watch?v=${v.id}`);
    await expect(page.getByRole("heading", { level: 1 }).getByRole("link")).toHaveAttribute("target", "_blank");
    await page.getByRole("link", { name: "브리프" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/${h.date}#videos$`));
  });

  test("375px에서 가로 스크롤이 없고 시각 링크가 44px 이상이다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(videoPath(s.date, s.eight));
    await expectPage(page, eight);
    await expectNoHorizontalScroll(page, "영상 페이지 375px");
    const box = await page.locator("main a.vsectime").first().boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe("4.4-4 없는 영상", () => {
  test("지어낸 ID, 파일 없는 날짜, 틀린 날짜, 구간 없는 영상은 안내와 브리프 링크를 보인다", async ({ page }) => {
    for (const p of [videoPath(s.date, "NoSuchVideo"), videoPath("2001-01-01", s.eight), videoPath("2026-99-99", s.eight), videoPath(s.date, s.none)]) {
      await page.goto(p);
      await expect(page.getByRole("heading", { level: 1, name: MISSING })).toBeVisible();
      await expect(page.getByRole("link", { name: "최근 브리프" })).toBeVisible();
    }
  });

  test("받은 날부터 30일 지난 영상도 없는 영상이다", async ({ page }) => {
    const v = JSON.parse(fs.readFileSync(E2E_VIDEO_INFO_FILE, "utf8")) as VideoFixtureInfo;
    const stale = v.sectionsStale!;
    await page.route("**/site-data/**", (route: Route) => {
      const file = path.join(E2E_VIDEO_DATA_DIR, "site-data", decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!));
      return fs.existsSync(file) ? route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(file, "utf8") }) : route.fulfill({ status: 404, body: "" });
    });
    await page.goto(videoPath(stale.date, stale.id));
    await expect(page.getByRole("heading", { level: 1, name: MISSING })).toBeVisible();
  });
});

test.describe("디자인 점검: 구간 줄", () => {
  test("제목을 눌러도 시각 링크가 눌리고 구간 글은 선택할 수 있으며 안내가 목록 앞에 있다", async ({ page }) => {
    await page.goto(videoPath(s.date, s.eight));
    await expect(page.locator(".vsecrow").first()).toBeVisible();
    const hit = (selector: string) =>
      page.evaluate(`(() => {
        const el = document.querySelector("${selector}");
        el.scrollIntoView({ block: "center" });
        const r = el.getBoundingClientRect();
        return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.className;
      })()`);
    const target = await hit(".vsectitle");
    expect(target).toBe("vsectime");
    expect(await hit(".vsecgist")).toBe("vsecgist");
    expect(await hit(".vsecpoints li")).toBe("");
    const noteBeforeList = await page.evaluate(`!!(document.querySelector(".vsecnote").compareDocumentPosition(document.querySelector(".vsecs")) & 4)`);
    expect(noteBeforeList).toBe(true);
  });

  test("썸네일 링크는 탭 순서에서 빠지고 제목 링크가 같은 곳으로 간다", async ({ page }) => {
    await page.goto(videoPath(s.date, s.eight));
    await expect(page.locator(".vpagethumb")).toHaveAttribute("tabindex", "-1");
    await expect(page.locator(".vpagethumb")).toHaveAttribute("aria-hidden", "true");
    const titleHref = await page.getByRole("heading", { level: 1 }).getByRole("link").getAttribute("href");
    await expect(page.locator(".vpagethumb")).toHaveAttribute("href", titleHref!);
  });
});

test.describe("4.4-5 대기와 오류", () => {
  test("늦으면 대기 표시, 실패하면 오류, 다시 시도하면 정상이다", async ({ page }) => {
    let fail = true;
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route(`**/site-data/videos-${s.date}.json`, async (route) => {
      await held;
      if (fail) return route.fulfill({ status: 500, body: "" });
      return route.continue();
    });
    await page.goto(videoPath(s.date, s.three));
    await expect(page.getByRole("status")).toBeVisible();
    release();
    await expect(page.getByText("영상을 불러오지 못했다")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expectPage(page, three);
  });

  test("구간 파일이 실패해도 오류와 다시 시도로 정상이 된다", async ({ page }) => {
    let fail = true;
    await page.route(`**/site-data/video-sections-${s.date}.json`, (route) => (fail ? route.fulfill({ status: 500, body: "" }) : route.continue()));
    await page.goto(videoPath(s.date, s.three));
    await expect(page.getByText("영상을 불러오지 못했다")).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expectPage(page, three);
  });

  test("다시 시도를 키보드로 누르면 포커스가 본문에 남는다", async ({ page }) => {
    await page.route(`**/site-data/videos-${s.date}.json`, (route) => route.fulfill({ status: 500, body: "" }));
    await page.goto(videoPath(s.date, s.three));
    const retry = page.getByRole("button", { name: "다시 시도" });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
  });

  test("다시 시도가 성공해도 포커스가 본문에 남는다", async ({ page }) => {
    let fail = true;
    await page.route(`**/site-data/videos-${s.date}.json`, (route) => (fail ? route.fulfill({ status: 500, body: "" }) : route.continue()));
    await page.goto(videoPath(s.date, s.three));
    const retry = page.getByRole("button", { name: "다시 시도" });
    await retry.focus();
    fail = false;
    await page.keyboard.press("Enter");
    await expectPage(page, three);
    await expect(page.locator("main")).toBeFocused();
  });

  test("영상 페이지에서 처음 받는 브리프로 가도 포커스가 본문에 남는다", async ({ page }) => {
    await page.goto(videoPath(s.date, s.three));
    await page.getByRole("link", { name: "브리프" }).click();
    await expect(page.getByRole("tab", { name: /영상/ }).or(page.locator(".vrow").first()).first()).toBeVisible();
    await expect(page.locator("main")).toBeFocused();
  });

  test("응답이 오지 않으면 대기에 머물지 않고 오류로 넘어간다", async ({ page }) => {
    await page.clock.install();
    await page.route(`**/site-data/videos-${s.date}.json`, () => {});
    await page.goto(videoPath(s.date, s.three));
    await expect(page.getByRole("status")).toBeVisible();
    await page.clock.fastForward(21_000);
    await expect(page.getByText("영상을 불러오지 못했다")).toBeVisible();
  });
});

test.describe("4.4-7 정적 결과물", () => {
  test("지어낸 구간 글이 site-data 밖의 HTML, sitemap, RSS, 검색 색인에 없다", () => {
    const out = path.join(E2E_DATA_DIR, "..", "out");
    const texts = sectionsOf(s.date, eight.id).flatMap((x) => [x.title, x.gist, ...x.points]).map((t) => Buffer.from(t));
    const files = fs.readdirSync(out, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
    const outside = files.filter((f) => !path.relative(out, f).startsWith("site-data"));
    expect(outside.length).toBeGreaterThan(10);
    // 검색 색인은 gzip이라 풀어서 본다
    const plain = (f: string) => {
      const raw = fs.readFileSync(f);
      return raw[0] === 0x1f && raw[1] === 0x8b ? zlib.gunzipSync(raw) : raw;
    };
    const index = files.filter((f) => f.endsWith(".pf_fragment")).map(plain);
    expect(index.length).toBeGreaterThan(0);
    expect(index.some((b) => b.includes(Buffer.from(json<IssueChunk>("issue-0.json").issues[String(info.videos.many)]!.name)))).toBe(true);
    expect(outside.filter((f) => texts.some((t) => plain(f).includes(t)))).toEqual([]);
  });
});

test.describe("4.5-2 바뀐 문구", () => {
  test("처리방침과 사이트 소개에 '영상 주소만'이 없고 챕터 제목을 보낸다는 뜻이 있다", async ({ page }) => {
    for (const p of ["/privacy", "/about"]) {
      await page.goto(p);
      await expect(page.locator("main")).toContainText("영상 설명의 챕터 제목");
      await expect(page.locator("main")).not.toContainText("영상 주소만");
    }
    await expect(page.locator("main")).toContainText("구간 정리");
  });
});

// 시각 회귀(design-check): 영상 페이지의 상태를 폭마다 찍는다
for (const width of [375, 1440]) {
  test.describe(`영상 페이지 ${width}`, () => {
    test.use({ viewport: { width, height: 800 } });
    const hour = info.videos.sectionsHour!;
    const shots: [string, string, string, (page: Page) => Promise<unknown>][] = [
      ["8구간", videoPath(s.date, s.eight), ".vsecrow", async () => {}],
      ["3구간", videoPath(s.date, s.three), ".vsecrow", async () => {}],
      ["1시간", videoPath(hour.date, hour.id), ".vsecrow", async () => {}],
      ["없는 영상", videoPath(s.date, none.id), ".nf", async () => {}],
      ["대기", videoPath(s.date, s.eight), "main .state", (page) => page.route("**/site-data/videos-*.json", () => undefined)],
      ["오류", videoPath(s.date, s.eight), READY_STATE, (page) => page.route("**/site-data/videos-*.json", (route) => route.fulfill({ status: 500, body: "" }))],
    ];
    for (const [name, url, ready, fault] of shots) {
      test(name, async ({ page }) => {
        await page.clock.setFixedTime(new Date(`${s.date}T09:00:00+09:00`));
        await fault(page);
        await page.goto(url);
        await expect(page.locator(ready).first()).toBeVisible();
        await expect(page).toHaveScreenshot(`video-page-${name}-${width}.png`, { animations: "disabled", fullPage: true });
      });
    }
  });
}
