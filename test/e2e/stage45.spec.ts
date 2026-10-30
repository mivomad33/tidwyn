// 4.5단계 화면(E2E): 읽은 뉴스 기록과 표시. 브리프의 읽음 버튼·펼치기·짧은 소식 글·링크로 읽음, 모든 뉴스 목록의 표시,
// '안 읽은 것만', 날짜 목록의 읽은 정도, 사이트 소개의 기록 지우기, 기록이 밖으로 나가지 않는지, 375px 폭.
// 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts). 브라우저 시계는 지어낸 데이터의 끝 날짜로 고정한다(1년 지난 기록 정리 때문에, 4.1-3).
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, info, storyItem, storyUrl, test } from "./base.ts";
import { E2E_OUT_DIR } from "./paths.ts";
import { READ_MARKS_KEY, serializeReadMarks, type ReadMarks } from "../../site/src/lib/readMarks.ts";
import { termDomId } from "../../site/src/lib/terms.ts";
import type { DayList, EntityChunk, IssueChunk, ListStory, MonthDetail, MonthList, SiteDates, SiteIssueList, TermGroupFile } from "../../src/siteTypes.ts";

// ---- 지어낸 결과물에서 기대값 뽑기(빌드는 prepare.ts가 webServer 전에 한다) ----

const SITE_DATA = path.join(E2E_OUT_DIR, "site-data");
function siteJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
}
function siteFilesMatching(re: RegExp): string[] {
  return fs.readdirSync(SITE_DATA).filter((f) => re.test(f)).sort();
}

const dates = siteJson<SiteDates>("dates.json");
const days = new Map<string, DayList>();
for (const f of siteFilesMatching(/^list-/)) for (const d of siteJson<MonthList>(f).days) days.set(d.date, d);
const details = new Map<string, MonthDetail["days"][string]>();
for (const f of siteFilesMatching(/^detail-/)) for (const [date, d] of Object.entries(siteJson<MonthDetail>(f).days)) details.set(date, d);
const issues = siteFilesMatching(/^issue-\d+\.json$/).flatMap((f) => Object.values(siteJson<IssueChunk>(f).issues));
const entities = siteFilesMatching(/^entity-\d+\.json$/).flatMap((f) => Object.values(siteJson<EntityChunk>(f).entities));
const terms = siteFilesMatching(/^term-group-/).flatMap((f) => siteJson<TermGroupFile>(f).terms);

interface NewsId {
  date: string;
  key: string;
}
const idOf = (date: string, s: ListStory): NewsId => ({ date, key: s.key });
const same = (a: NewsId, b: NewsId) => a.date === b.date && a.key === b.key;
const stories = (date: string) => days.get(date)!.sections.flatMap((s) => s.stories);

const LATEST = info.latest.date;
const latestDay = days.get(LATEST)!;
const firstSection = latestDay.sections[0]!;
const firstTops = firstSection.stories.filter((s) => s.kind === "top").sort((a, b) => a.position - b.position);
const firstShorts = firstSection.stories.filter((s) => s.kind === "short").sort((a, b) => a.position - b.position);
const shortWithIssue = firstShorts.find((s) => s.issue)!;
const shortsWithoutIssue = firstShorts.filter((s) => s !== shortWithIssue);

/** 여섯 목록(브리프, 이전 전개, 이슈 타임라인, 대상 페이지, 검색, 용어 사전)에 모두 나오는 주요 뉴스 */
const everywhere = (() => {
  for (const date of [...days.keys()].sort()) {
    for (const s of stories(date).filter((x) => x.kind === "top")) {
      const id = idOf(date, s);
      const prevCard = [...details.entries()].flatMap(([d, cards]) => Object.entries(cards).filter(([, c]) => c.previous.some((p) => same(p, id))).map(([k]) => ({ date: d, key: k })))[0];
      const issue = issues.find((i) => i.timeline.some((t) => same(t, id)));
      const entity = entities.find((e) => e.news.some((n) => same(n, id)));
      const term = terms.find((t) => t.first && same(t.first, id));
      if (prevCard && issue && entity && term) return { id, story: s, prevCard, issue, entity, term };
    }
  }
  throw new Error("여섯 목록에 모두 나오는 뉴스가 지어낸 데이터에 없다");
})();

/** 타임라인에 주요 뉴스와 짧은 소식이 함께 있는 이슈 */
const mixedIssue = issues.find((i) => i.timeline.some((t) => t.key.includes("-s")) && i.timeline.some((t) => !t.key.includes("-s")))!;

/** 이전 전개에 주요 뉴스가 있는 최근 날짜 첫 섹션의 주요 뉴스(그 이전 전개로 '#' 이동을 본다) */
const cardWithPrev = firstTops.find((s) => details.get(LATEST)![s.key]?.previous.some((p) => !p.key.includes("-s")))!;
const topPrev = details.get(LATEST)![cardWithPrev.key]!.previous.find((p) => !p.key.includes("-s"))!;

// ---- 도우미 ----

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${LATEST}T12:00:00+09:00`));
});

function marks(ids: NewsId[]): ReadMarks {
  const m: ReadMarks = new Map();
  for (const id of ids) {
    if (!m.has(id.date)) m.set(id.date, new Set());
    m.get(id.date)!.add(id.key);
  }
  return m;
}

/** 읽은 기록을 미리 넣어 두고(다른 키도 넣을 수 있다) 주소를 연다 */
async function seed(page: Page, ids: NewsId[], extra: Record<string, string> = {}): Promise<void> {
  await page.goto("/about");
  await page.evaluate(([k, v, more]) => {
    localStorage.setItem(k, v);
    for (const [a, b] of Object.entries(more)) localStorage.setItem(a, b);
  }, [READ_MARKS_KEY, serializeReadMarks(marks(ids)), extra] as const);
}

async function storedMarks(page: Page): Promise<string | null> {
  return page.evaluate((k) => localStorage.getItem(k), READ_MARKS_KEY);
}

/** 브리프의 읽음 버튼 */
function toggleOf(page: Page, key: string): Locator {
  return storyItem(page, key).locator("button.rd-btn");
}

/** 뉴스 링크 줄(브리프 밖 목록). `/<날짜>#<키>` 주소로 찾는다 */
function linkTo(scope: Page | Locator, id: NewsId): Locator {
  return scope.locator(`a[href="${storyUrl(id.date, id.key)}"]`);
}

/** 그 줄의 제목 굵기와 체크로 읽음 여부를 본다. withCheck면 줄 끝 체크(브리프 밖 목록)도 본다 */
async function expectReadRow(row: Locator, read: boolean, withCheck: boolean): Promise<void> {
  const title = row.locator(".nt");
  await expect(title).toHaveClass(read ? /\bread\b/ : /\bunread\b/);
  // 읽은 뉴스는 보통 굵기, 안 읽은 뉴스는 굵게(600 또는 700)
  await expect(title).toHaveCSS("font-weight", read ? "400" : /^(600|700)$/);
  if (withCheck) {
    const mark = row.locator("xpath=..").locator(".read-mk");
    await expect(mark).toHaveCount(read ? 1 : 0);
    if (read) await expect(mark).toContainText("읽음");
  }
}

async function expectBriefRead(page: Page, key: string, read: boolean): Promise<void> {
  await expect(toggleOf(page, key)).toHaveAttribute("aria-pressed", String(read));
  await expectReadRow(storyItem(page, key).locator(":scope > .item-row, :scope > .short-main > .short-text"), read, false);
}

// ---- 4.1 읽은 기록 ----

test.describe("4.1 읽은 기록", () => {
  test("4.1-1 읽음 버튼으로 읽은 짧은 소식은 '#' 없는 주소로 새로 고쳐도 읽음이고, 쿠키는 비어 있다", async ({ page }) => {
    const s = shortsWithoutIssue[0]!;
    await page.goto("/");
    await expectBriefRead(page, s.key, false);
    await toggleOf(page, s.key).click();
    await expectBriefRead(page, s.key, true);
    await page.goto("/");
    expect(new URL(page.url()).hash).toBe("");
    await page.reload();
    await expectBriefRead(page, s.key, true);
    expect(await page.evaluate("document.cookie")).toBe("");
    // 같은 뉴스를 여러 번 읽어도 기록은 하나다
    await storyItem(page, s.key).locator("button.short-text").click();
    expect(JSON.parse((await storedMarks(page))!)).toEqual({ v: 1, d: { [LATEST]: [s.key] } });
  });

  test("4.1-2 브리프에서 읽은 뉴스가 화면을 옮겨도(새로 고침 없이) 이슈 타임라인·검색 결과에서 바로 읽음이고, 뒤로 와도 그대로다", async ({ page }) => {
    const s = shortWithIssue;
    const id = idOf(LATEST, s);
    await page.goto("/");
    await toggleOf(page, s.key).click();
    await expectBriefRead(page, s.key, true);
    // 앱 안 이동(새로 읽지 않는다): 짧은 소식의 이슈 링크
    await page.evaluate("window.__noReload = true");
    await storyItem(page, s.key).getByRole("link", { name: s.issue!.name }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${s.issue!.id}$`));
    await expectReadRow(linkTo(page.locator(".tl"), id), true, true);
    await page.goBack();
    await expectBriefRead(page, s.key, true);
    // 검색(머리 줄의 검색 링크로 앱 안에서 간다)
    await page.getByRole("link", { name: "검색" }).first().click();
    await page.getByLabel("검색어").fill(s.title);
    await page.getByRole("button", { name: "찾기" }).click();
    await expectReadRow(linkTo(page, id), true, true);
    expect(await page.evaluate("window.__noReload"), "새로 읽지 않았다").toBe(true);
  });

  test("4.1-4 로컬 스토리지에 접근할 수 없어도 오류 없이 동작하고, 펼친 카드가 그 탭에서 읽음이다", async ({ page }) => {
    await page.addInitScript({
      content: `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("막힌 저장소", "SecurityError"); } });`,
    });
    const s = firstTops[0]!;
    await page.goto("/");
    await expectBriefRead(page, s.key, false);
    await storyItem(page, s.key).locator("button.item-btn").click();
    await expectBriefRead(page, s.key, true);
    // 다른 화면에 갔다 와도 그 탭 안에서는 기억한다
    await page.getByRole("link", { name: "검색" }).first().click();
    await page.goBack();
    await expectBriefRead(page, s.key, true);
    // pageErrors(자동 픽스처)가 비어 있는지는 테스트가 끝날 때 본다
  });
});

// ---- 4.2 브리프의 읽음 동작 ----

test.describe("4.2 브리프의 읽음 동작", () => {
  test("4.2-1 카드를 펼치면 읽음이 되고, 접어도 읽음이다", async ({ page }) => {
    const s = firstTops[1]!;
    await page.goto("/");
    const btn = storyItem(page, s.key).locator("button.item-btn");
    await expectBriefRead(page, s.key, false);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "true");
    await expectBriefRead(page, s.key, true);
    await btn.click();
    await expect(btn).toHaveAttribute("aria-expanded", "false");
    await expectBriefRead(page, s.key, true);
  });

  test("4.2-2 짧은 소식 글을 누르거나 Enter로 누르면 읽음이고, 이슈 링크를 누른 것은 읽음이 아니다", async ({ page }) => {
    const [a, b] = shortsWithoutIssue as [ListStory, ListStory];
    await page.goto("/");
    const text = storyItem(page, a.key).locator("button.short-text");
    await text.click();
    await expectBriefRead(page, a.key, true);
    await text.click();
    await expectBriefRead(page, a.key, true);
    await storyItem(page, b.key).locator("button.short-text").focus();
    await page.keyboard.press("Enter");
    await expectBriefRead(page, b.key, true);
    // 이슈 링크
    const c = shortWithIssue;
    await storyItem(page, c.key).getByRole("link", { name: c.issue!.name }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/${c.issue!.id}$`));
    await page.goBack();
    await expectBriefRead(page, c.key, false);
  });

  test("4.2-3 이슈 타임라인의 주요 뉴스·짧은 소식 링크로 브리프에 오면 읽음이고, 주소를 직접 열어도 같다", async ({ page }) => {
    const top = mixedIssue.timeline.find((t) => !t.key.includes("-s"))!;
    const short = mixedIssue.timeline.find((t) => t.key.includes("-s"))!;
    for (const t of [top, short]) {
      await page.goto(`/issues/${mixedIssue.id}`);
      await expectReadRow(linkTo(page.locator(".tl"), t), false, true);
      await linkTo(page.locator(".tl"), t).click();
      await expect(page).toHaveURL(new RegExp(`/${t.date}#`));
      await expectBriefRead(page, t.key, true);
      if (t === top) await expect(storyItem(page, t.key).locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
      else await expect(storyItem(page, t.key)).toHaveClass(/target/);
      // 브리프 밖 목록에도 바로 보인다
      await page.goBack();
      await expectReadRow(linkTo(page.locator(".tl"), t), true, true);
    }
    // 주소를 직접 연다(다른 뉴스)
    const other = firstTops[2]!;
    await page.goto(storyUrl(LATEST, other.key));
    await expectBriefRead(page, other.key, true);
  });

  test("4.2-4 읽음 버튼: 두 번 누르면 돌아오고 카드는 펼쳐지지 않으며, Tab·Space로 누를 수 있고, 이름·상태·크기가 맞다", async ({ page }) => {
    const s = firstTops[3]!;
    await page.goto("/");
    const toggle = toggleOf(page, s.key);
    const expand = storyItem(page, s.key).locator("button.item-btn");
    await expect(toggle).toHaveAccessibleName(`읽음: ${s.title}`);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    // 키보드: 펼치기 버튼에서 Tab 한 번이면 읽음 버튼이다
    await expand.focus();
    await page.keyboard.press("Tab");
    await expect(toggle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    // 누르는 자리 44×44 이상(주요 뉴스와 짧은 소식 모두)
    for (const k of [s.key, firstShorts[0]!.key]) {
      const box = (await toggleOf(page, k).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("4.2-5 펼친 카드의 버튼을 누르면 펼친 채 안 읽음이 되고, 다시 접었다 펼치면 읽음이다", async ({ page }) => {
    const s = firstTops[0]!;
    await page.goto("/");
    const expand = storyItem(page, s.key).locator("button.item-btn");
    await expand.click();
    await expectBriefRead(page, s.key, true);
    await toggleOf(page, s.key).click();
    await expectBriefRead(page, s.key, false);
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expand.click();
    await expand.click();
    await expectBriefRead(page, s.key, true);
  });
});

// ---- 4.3 뉴스 목록의 읽음 표시 ----

test.describe("4.3 뉴스 목록의 읽음 표시", () => {
  test("4.3-1 한 뉴스를 읽으면 여섯 목록 모두에서 그 줄이 읽음(보통 굵기·체크)이고 다른 줄은 안 읽음(굵게)이다", async ({ page }) => {
    const e = everywhere;
    const section = e.story.section;
    // 브리프에서 읽음 버튼으로 읽는다
    await page.goto(`/${e.id.date}`);
    await page.getByRole("navigation", { name: "섹션" }).getByRole("button", { name: section }).click();
    await toggleOf(page, e.id.key).click();
    await expectBriefRead(page, e.id.key, true);
    const otherBrief = stories(e.id.date).find((s) => s.section === section && s.key !== e.id.key)!;
    await expectBriefRead(page, otherBrief.key, false);

    // 펼친 카드의 이전 전개
    await page.goto(storyUrl(e.prevCard.date, e.prevCard.key));
    const prevList = storyItem(page, e.prevCard.key).getByRole("list", { name: "이전 전개" });
    await expectReadRow(linkTo(prevList, e.id), true, true);
    const prevOthers = details.get(e.prevCard.date)![e.prevCard.key]!.previous.filter((p) => !same(p, e.id));
    if (prevOthers.length) await expectReadRow(linkTo(prevList, prevOthers[0]!), false, true);

    // 이슈 타임라인
    await page.goto(`/issues/${e.issue.id}`);
    await expectReadRow(linkTo(page.locator(".tl"), e.id), true, true);
    const tlOther = e.issue.timeline.find((t) => !same(t, e.id) && !same(t, e.prevCard))!;
    await expectReadRow(linkTo(page.locator(".tl"), tlOther), false, true);

    // 대상 페이지의 등장 뉴스
    await page.goto(`/entities/${e.entity.id}`);
    await expectReadRow(linkTo(page.locator(".rows"), e.id), true, true);
    const entOther = e.entity.news.find((n) => !same(n, e.id) && !same(n, e.prevCard))!;
    await expectReadRow(linkTo(page.locator(".rows"), entOther), false, true);

    // 검색 결과의 뉴스
    await page.goto(`/search?q=${encodeURIComponent(e.story.title)}`);
    const news = page.getByRole("region", { name: "뉴스" }).or(page.locator("section[aria-labelledby=r-news]"));
    await expectReadRow(linkTo(news, e.id), true, true);
    const searchOthers = news.locator("a.item-btn");
    for (let i = 0; i < (await searchOthers.count()); i++) {
      const href = (await searchOthers.nth(i).getAttribute("href"))!;
      if (href !== storyUrl(e.id.date, e.id.key) && href !== storyUrl(e.prevCard.date, e.prevCard.key)) {
        await expectReadRow(searchOthers.nth(i), false, true);
        break;
      }
    }

    // 용어 사전의 처음 나온 뉴스
    await page.goto(`/terms/${e.term.id}`);
    await expectReadRow(linkTo(page.locator(`[id="${termDomId(e.term.id)}"]`), e.id), true, true);
    const termOther = terms.find((t) => t.first && !same(t.first, e.id) && !same(t.first, e.prevCard) && t.id !== e.term.id)!;
    await page.goto(`/terms/${termOther.id}`);
    await expectReadRow(linkTo(page.locator(`[id="${termDomId(termOther.id)}"]`), termOther.first!), false, true);
  });

  test("4.3-2 이슈·대상 페이지를 보고 스크롤만 해서는 기록이 바뀌지 않는다", async ({ page }) => {
    await seed(page, [idOf(LATEST, firstTops[0]!)]);
    const before = await storedMarks(page);
    await page.goto(`/issues/${everywhere.issue.id}`);
    await page.mouse.wheel(0, 2000);
    await page.goto(`/entities/${everywhere.entity.id}`);
    await page.mouse.wheel(0, 2000);
    await page.goto("/");
    await expect(page.locator("button.rd-btn").first()).toBeVisible();
    expect(await storedMarks(page)).toBe(before);
  });

  test("4.3-3 흡수된 이슈 주소로 연 타임라인에서도 읽은 뉴스가 읽음이다", async ({ page }) => {
    const survivor = issues.find((i) => i.id === info.issues.merged.into)!;
    const t = survivor.timeline[0]!;
    await seed(page, [t]);
    await page.goto(`/issues/${info.issues.merged.id}`);
    await expect(page).toHaveURL(new RegExp(`/issues/${survivor.id}$`));
    await expectReadRow(linkTo(page.locator(".tl"), t), true, true);
  });
});

// ---- 4.4 '안 읽은 것만' ----

function unreadChip(page: Page): Locator {
  return page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: "안 읽은 것만" });
}

test.describe("4.4 '안 읽은 것만'", () => {
  test("4.4-1 켜면 읽은 뉴스가 숨고 끄면 돌아오며, 카테고리와 함께 쓰면 둘 다 맞는 뉴스만 보인다", async ({ page }) => {
    const read = [firstTops[0]!, firstShorts[0]!];
    await seed(page, read.map((s) => idOf(LATEST, s)));
    await page.goto("/");
    for (const s of read) await expect(storyItem(page, s.key)).toBeVisible();
    await unreadChip(page).click();
    await expect(unreadChip(page)).toHaveAttribute("aria-pressed", "true");
    for (const s of read) await expect(storyItem(page, s.key)).toHaveCount(0);
    await expect(storyItem(page, firstTops[1]!.key)).toBeVisible();
    await unreadChip(page).click();
    for (const s of read) await expect(storyItem(page, s.key)).toBeVisible();

    // 카테고리 + 안 읽은 것만: 안 읽은 그 분류 뉴스만
    const major = firstSection.stories.find((s) => s.key === firstTops[0]!.key)!.category.major;
    await page.getByRole("group", { name: "카테고리" }).getByRole("button", { name: major, exact: true }).click();
    await unreadChip(page).click();
    const expected = firstSection.stories.filter((s) => s.category.major === major && !read.includes(s)).map((s) => `story-${s.key}`).sort();
    const rows = page.locator("main li[id^=story-]");
    const shown: string[] = [];
    for (let i = 0; i < (await rows.count()); i++) shown.push((await rows.nth(i).getAttribute("id"))!);
    shown.sort();
    expect(shown).toEqual(expected);
  });

  test("4.4-1 칩을 켠 채 이미 읽은 주요 뉴스의 '#' 주소로 들어오면(이전 전개 링크) 그 카드가 펼쳐져 보인다", async ({ page }) => {
    const prev = topPrev;
    await seed(page, [prev]);
    await page.goto("/");
    await unreadChip(page).click();
    await storyItem(page, cardWithPrev.key).locator("button.item-btn").click();
    await linkTo(storyItem(page, cardWithPrev.key), prev).click();
    await expect(page).toHaveURL(new RegExp(`/${prev.date}#`));
    await expect(unreadChip(page)).toHaveAttribute("aria-pressed", "true");
    const item = storyItem(page, prev.key);
    await expect(item.locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
    await expectBriefRead(page, prev.key, true);
    // 접으면 잠깐 남았다가 부드럽게 사라진다(사용자 결정 2026-10-29)
    await item.locator("button.item-btn").click();
    await expect(item.locator("button.item-btn")).toHaveAttribute("aria-expanded", "false");
    await expect(item).toBeVisible();
    await expect(item).toHaveCount(0);
  });

  test("4.4-2 켠 채 날짜를 바꾸면 그 날짜에서 읽은 뉴스가 빠진다", async ({ page }) => {
    const prevDate = dates.dates[1]!;
    const read = stories(prevDate).find((s) => s.section === info.latest.firstSection)!;
    await seed(page, [idOf(prevDate, read)]);
    await page.goto("/");
    await unreadChip(page).click();
    await page.getByRole("link", { name: /^이전 날짜/ }).click();
    await expect(page).toHaveURL(new RegExp(`/${prevDate}$`));
    await expect(unreadChip(page)).toHaveAttribute("aria-pressed", "true");
    await expect(storyItem(page, read.key)).toHaveCount(0);
    await expect(storyItem(page, stories(prevDate).find((s) => s.section === info.latest.firstSection && s !== read)!.key)).toBeVisible();
  });

  // 4.4-2는 사용자 결정(2026-10-29)으로 바뀌었다: 켠 동안 읽은 뉴스 중 펼치지 않은 것은 잠깐 뒤 부드럽게 사라지고, 펼친 카드는 접을 때 사라진다
  test("4.4-2 켠 동안 펼친 카드는 읽음이어도 펼친 채 남고, 접으면 사라진다", async ({ page }) => {
    const s = firstTops[1]!;
    await page.goto("/");
    await unreadChip(page).click();
    const item = storyItem(page, s.key);
    const expand = item.locator("button.item-btn");
    await expand.click();
    await expectBriefRead(page, s.key, true);
    await page.waitForTimeout(1500);
    await expect(expand).toHaveAttribute("aria-expanded", "true");
    await expect(item).toBeVisible();
    await expand.click();
    await expect(item).toBeVisible();
    await expect(item).toHaveCount(0);
  });

  test("4.4-2 켠 동안 읽음 버튼이나 짧은 소식 글로 읽으면 바로는 남아 있다가 사라지고, 칩을 끄면 돌아온다", async ({ page }) => {
    const [a, b] = shortsWithoutIssue;
    const top = firstTops[2]!;
    await page.goto("/");
    await unreadChip(page).click();
    await toggleOf(page, top.key).click();
    await storyItem(page, a!.key).locator("button.short-text").click();
    await expect(storyItem(page, top.key)).toBeVisible();
    await expect(storyItem(page, a!.key)).toBeVisible();
    await expect(storyItem(page, top.key)).toHaveCount(0);
    await expect(storyItem(page, a!.key)).toHaveCount(0);
    await expect(storyItem(page, b!.key)).toBeVisible();
    // 칩을 끄면 다시 보인다
    await unreadChip(page).click();
    await expect(storyItem(page, top.key)).toBeVisible();
    await expect(storyItem(page, a!.key)).toBeVisible();
  });

  test("4.4-2 잘못 눌러 곧바로 다시 누르면 사라지지 않는다", async ({ page }) => {
    const s = firstTops[2]!;
    await page.goto("/");
    await unreadChip(page).click();
    await toggleOf(page, s.key).click();
    // 사라지는 움직임(0.25초)보다 길고 기다리는 시간(0.8초)보다 짧게 둔 뒤 다시 누른다
    await page.waitForTimeout(500);
    await toggleOf(page, s.key).click({ timeout: 1000 });
    await page.waitForTimeout(1500);
    await expect(storyItem(page, s.key)).toBeVisible();
    await expectBriefRead(page, s.key, false);
  });

  test("4.4-2 키보드로 읽음 버튼을 누른 줄이 사라지면 키보드 위치가 다음 줄의 읽음 버튼으로 간다", async ({ page }) => {
    const [s, next] = [firstTops[0]!, firstTops[1]!];
    await page.goto("/");
    await unreadChip(page).click();
    await toggleOf(page, s.key).focus();
    await page.keyboard.press("Space");
    await expect(storyItem(page, s.key)).toHaveCount(0);
    await expect(toggleOf(page, next.key)).toBeFocused();
  });

  test("4.4-2 기기의 '동작 줄이기'를 켜면 움직임 없이 사라지고, 끄면 움직이며 사라진다", async ({ page }) => {
    await page.addInitScript({ content: `window.__anims = 0; const a = Element.prototype.animate; Element.prototype.animate = function (...x) { window.__anims++; return a.apply(this, x); };` });
    const anims = async () => Number(await page.evaluate("window.__anims"));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await unreadChip(page).click();
    await toggleOf(page, firstTops[0]!.key).click();
    await expect(storyItem(page, firstTops[0]!.key)).toHaveCount(0);
    expect(await anims()).toBe(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await toggleOf(page, firstTops[1]!.key).click();
    await expect(storyItem(page, firstTops[1]!.key)).toHaveCount(0);
    expect(await anims()).toBeGreaterThan(0);
  });

  test("4.4-2 켠 동안 마지막 안 읽은 뉴스를 읽으면 사라진 뒤 빈 상태 문구가 보인다", async ({ page }) => {
    const last = firstShorts.at(-1)!;
    await seed(page, firstSection.stories.filter((s) => s !== last).map((s) => idOf(LATEST, s)));
    await page.goto("/");
    await unreadChip(page).click();
    await expect(page.locator("main li[id^=story-]")).toHaveCount(1);
    await toggleOf(page, last.key).click();
    await expect(page.getByText("안 읽은 뉴스가 없다.")).toBeVisible();
    await expect(page.locator("main li[id^=story-]")).toHaveCount(0);
  });

  test("4.4-3 한 섹션을 모두 읽고 켜면 빈 상태 문구가 보인다", async ({ page }) => {
    await seed(page, firstSection.stories.map((s) => idOf(LATEST, s)));
    await page.goto("/");
    await unreadChip(page).click();
    await expect(page.locator("main li[id^=story-]")).toHaveCount(0);
    await expect(page.getByText("안 읽은 뉴스가 없다.")).toBeVisible();
  });

  test("4.4-4 키보드로 칩을 켜고 끌 수 있고 상태 속성이 바뀐다", async ({ page }) => {
    await page.goto("/");
    const chip = unreadChip(page);
    await chip.focus();
    await page.keyboard.press("Enter");
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Space");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
  });
});

// ---- 브리프 '전체' 탭(사용자 결정 2026-10-29) ----

const SECTION_ORDER = ["한국", "세계", "IT·AI"] as const;
const sectionTabs = (page: Page) => page.getByRole("navigation", { name: "섹션" });

/** 전체 탭에 보일 순서: 주요 뉴스(한국 → 세계 → IT·AI, 순위 순), 그 아래 짧은 소식(같은 순서) */
function allOrder(day: DayList): string[] {
  const byPos = (a: ListStory, b: ListStory) => a.position - b.position;
  const of = (kind: ListStory["kind"]) => SECTION_ORDER.flatMap((n) => (day.sections.find((s) => s.name === n)?.stories ?? []).filter((s) => s.kind === kind).sort(byPos));
  return [...of("top"), ...of("short")].map((s) => `story-${s.key}`);
}

async function shownIds(page: Page): Promise<string[]> {
  const rows = page.locator("main li[id^=story-]");
  const ids: string[] = [];
  for (let i = 0; i < (await rows.count()); i++) ids.push((await rows.nth(i).getAttribute("id"))!);
  return ids;
}

test.describe("브리프 '전체' 탭", () => {
  test("처음에는 한국 탭이고, 탭은 전체·한국·세계·IT·AI 순이며 섹션 탭에는 섹션 칩이 없다", async ({ page }) => {
    await page.goto("/");
    // 7단계: 그 날짜에 영상이 있으면 끝에 '영상 N' 탭이 붙는다(4.7-1)
    await expect(sectionTabs(page).getByRole("button")).toHaveText(["전체", ...latestDay.sections.map((s) => s.name), ...(latestDay.videos?.length ? [`영상 ${latestDay.videos.length}`] : [])]);
    await expect(sectionTabs(page).getByRole("button", { name: "한국" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("main .sec")).toHaveCount(0);
  });

  test("전체 탭은 모든 섹션 뉴스를 정해진 순서로 한 목록에 보이고, 줄마다 섹션 칩을 붙이며, 흐름 설명은 숨긴다", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main p.flow")).toHaveCount(1);
    await sectionTabs(page).getByRole("button", { name: "전체" }).click();
    await expect(sectionTabs(page).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    expect(await shownIds(page)).toEqual(allOrder(latestDay));
    for (const sec of latestDay.sections) {
      const st = sec.stories[0]!;
      await expect(storyItem(page, st.key).locator(".sec")).toHaveText(sec.name);
    }
    await expect(page.locator("main p.flow")).toHaveCount(0);
  });

  test("고른 탭을 기억해 새로 고치거나 다시 열어도 그 탭이다", async ({ page }) => {
    await page.goto("/");
    await sectionTabs(page).getByRole("button", { name: "전체" }).click();
    await page.reload();
    await expect(sectionTabs(page).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await sectionTabs(page).getByRole("button", { name: info.latest.otherSection }).click();
    await page.goto(`/${dates.dates[1]}`);
    await expect(sectionTabs(page).getByRole("button", { name: info.latest.otherSection })).toHaveAttribute("aria-pressed", "true");
  });

  test("전체 탭에서 다른 목록의 링크로 들어오면 전체에 머문 채 그 뉴스가 펼쳐지고 읽음이 된다", async ({ page }) => {
    const t = mixedIssue.timeline.find((x) => !x.key.includes("-s"))!;
    await page.goto("/");
    await sectionTabs(page).getByRole("button", { name: "전체" }).click();
    await page.goto(`/issues/${mixedIssue.id}`);
    await linkTo(page.locator(".tl"), t).click();
    await expect(page).toHaveURL(new RegExp(`/${t.date}#`));
    await expect(sectionTabs(page).getByRole("button", { name: "전체" })).toHaveAttribute("aria-pressed", "true");
    await expect(storyItem(page, t.key).locator("button.item-btn")).toHaveAttribute("aria-expanded", "true");
    await expect(storyItem(page, t.key)).toBeInViewport();
    await expectBriefRead(page, t.key, true);
  });

  test("전체 탭에서 '안 읽은 것만'을 켜면 모든 섹션의 읽은 뉴스가 숨는다", async ({ page }) => {
    const read = latestDay.sections.map((s) => s.stories[0]!);
    await seed(page, read.map((s) => idOf(LATEST, s)));
    await page.goto("/");
    await sectionTabs(page).getByRole("button", { name: "전체" }).click();
    await unreadChip(page).click();
    const hidden = new Set(read.map((s) => `story-${s.key}`));
    expect(await shownIds(page)).toEqual(allOrder(latestDay).filter((id) => !hidden.has(id)));
  });

  test("375px에서 전체 탭에 가로 스크롤이 없다", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await sectionTabs(page).getByRole("button", { name: "전체" }).click();
    await expectNoHorizontalScroll(page, "전체 탭");
  });
});

// ---- 4.5 날짜 목록의 읽은 정도 ----

test.describe("4.5 날짜 목록의 읽은 정도", () => {
  test("4.5-1 하나 읽으면 1/<전체> 읽음, 모두 읽으면 다 읽음, 읽지 않은 날짜는 비어 있다. 전체 수는 사이트 데이터의 뉴스 수다", async ({ page }) => {
    const [d1, d2, d3] = dates.dates as [string, string, string];
    const total1 = stories(d1).length;
    expect(dates.storyCounts[0]).toBe(total1);
    await seed(page, [{ date: d1, key: stories(d1)[0]!.key }, ...stories(d2).map((s) => idOf(d2, s))]);
    await page.goto("/dates");
    const row = (d: string) => page.locator(`a.row-link[href="/${d}"]`);
    await expect(row(d1).locator(".read-prog")).toHaveText(`1/${total1} 읽음`);
    await expect(row(d2).locator(".read-prog")).toHaveText("✓다 읽음");
    await expect(row(d3).locator(".read-prog")).toHaveCount(0);
    for (const [i, d] of dates.dates.entries()) expect(dates.storyCounts[i], d).toBe(stories(d).length);
    // 브리프에서 읽고 앱 안에서 날짜 목록으로 가면 새로 고침 없이 바로 반영된다
    await page.goto(`/${d3}`);
    await toggleOf(page, days.get(d3)!.sections[0]!.stories[0]!.key).click();
    await page.getByRole("link", { name: /날짜 목록 보기$/ }).click();
    await expect(row(d3).locator(".read-prog")).toHaveText(`1/${stories(d3).length} 읽음`);
  });
});

// ---- 4.6 사이트 소개와 기록 지우기 ----

test.describe("4.6 사이트 소개", () => {
  test("4.6-1 읽은 기록 절과 문장이 보인다", async ({ page }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { name: "읽은 기록" })).toBeVisible();
    for (const text of ["이 브라우저에만 저장된다", "어디로도 보내지 않고", "다른 기기나 브라우저와 맞춰지지 않는다", "1년이 지난 기록은 저절로 지워진다", "되돌릴 수 없다"]) {
      await expect(page.locator("article.plain")).toContainText(text);
    }
  });

  test("4.6-2 확인을 수락하면 모두 지우고 문구를 보이며 다른 키는 남고, 취소하면 그대로, 기록이 없어도 동작한다", async ({ page }) => {
    const ids = [idOf(LATEST, firstTops[0]!), idOf(LATEST, firstShorts[0]!)];
    await seed(page, ids, { "tidwyn.other": "그대로" });
    await page.goto("/about");
    const btn = page.getByRole("button", { name: "읽은 기록 지우기" });
    // 취소
    page.once("dialog", (d) => void d.dismiss());
    await btn.click();
    await expect(page.getByText("읽은 기록을 지웠다.")).toHaveCount(0);
    expect(await storedMarks(page)).toBe(serializeReadMarks(marks(ids)));
    // 수락
    let message = "";
    page.once("dialog", (d) => {
      message = d.message();
      void d.accept();
    });
    await btn.click();
    await expect(page.getByText("읽은 기록을 지웠다.")).toBeVisible();
    expect(message).toContain("되돌릴 수 없다");
    expect(await page.evaluate(() => localStorage.getItem("tidwyn.other"))).toBe("그대로");
    // 기록이 없을 때도 오류 없이 동작한다
    page.once("dialog", (d) => void d.accept());
    await btn.click();
    await expect(page.getByText("읽은 기록을 지웠다.")).toBeVisible();
    expect(JSON.parse((await storedMarks(page))!)).toEqual({ v: 1, d: {} });
    await page.goto("/");
    for (const sec of latestDay.sections) {
      await page.getByRole("navigation", { name: "섹션" }).getByRole("button", { name: sec.name }).click();
      for (const s of sec.stories) await expectBriefRead(page, s.key, false);
    }
  });
});

// ---- 4.7 기록이 밖으로 나가지 않게 ----

test.describe("4.7 기록이 밖으로 나가지 않는다", () => {
  test("4.7-1 뉴스를 읽는 동안 보낸 요청의 주소와 본문에 기록·저장 키가 없다", async ({ page }) => {
    const sent: string[] = [];
    page.on("request", (r) => sent.push(`${r.url()}\n${r.postData() ?? ""}`));
    await page.goto("/");
    await toggleOf(page, firstTops[0]!.key).click();
    await storyItem(page, firstShorts[0]!.key).locator("button.short-text").click();
    await storyItem(page, firstTops[1]!.key).locator("button.item-btn").click();
    await expectBriefRead(page, firstTops[1]!.key, true);
    await page.getByRole("link", { name: "검색" }).first().click();
    await page.getByLabel("검색어").fill(firstTops[0]!.title);
    await page.getByRole("button", { name: "찾기" }).click();
    await expect(page.getByText("찾는 중…")).toHaveCount(0);
    const stored = (await storedMarks(page))!;
    const keys = [firstTops[0]!.key, firstShorts[0]!.key, firstTops[1]!.key];
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) {
      expect(r).not.toContain(READ_MARKS_KEY);
      expect(r).not.toContain(stored);
      expect(r).not.toContain(encodeURIComponent(stored));
      expect(r).not.toContain(JSON.stringify(keys));
      expect(r).not.toContain(encodeURIComponent(JSON.stringify(keys)));
    }
  });
});

// ---- 4.8 375px 폭 ----

test.describe("4.8-1 375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("바뀐 화면에 가로 스크롤이 없고, 읽음 버튼이 제목과 겹치지 않는다", async ({ page }) => {
    await seed(page, [everywhere.id, idOf(LATEST, firstTops[0]!), idOf(LATEST, firstShorts[0]!)]);
    await page.goto("/");
    await expectNoHorizontalScroll(page, "브리프");
    for (const s of [firstTops[0]!, firstShorts[0]!]) {
      const toggle = (await toggleOf(page, s.key).boundingBox())!;
      const title = (await storyItem(page, s.key).locator(".nt").boundingBox())!;
      expect(title.x + title.width, `${s.key} 제목이 버튼 왼쪽에서 끝난다`).toBeLessThanOrEqual(toggle.x + 0.5);
      expect(toggle.x + toggle.width).toBeLessThanOrEqual(375);
    }
    await unreadChip(page).click();
    await expectNoHorizontalScroll(page, "안 읽은 것만");
    await page.goto(storyUrl(everywhere.prevCard.date, everywhere.prevCard.key));
    await expectNoHorizontalScroll(page, "펼친 카드");
    for (const [url, label] of [
      [`/issues/${everywhere.issue.id}`, "이슈"],
      [`/entities/${everywhere.entity.id}`, "대상"],
      [`/search?q=${encodeURIComponent(everywhere.story.title)}`, "검색"],
      [`/terms/${everywhere.term.id}`, "용어 사전"],
      ["/dates", "날짜 목록"],
      ["/about", "사이트 소개"],
    ] as const) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      if (label === "검색") await expect(linkTo(page, everywhere.id)).toBeVisible();
      await expectNoHorizontalScroll(page, label);
    }
  });
});

// 사이트 데이터 형식이 이 테스트의 기대와 맞는지(이슈 목록에 흡수 정보가 있다)
test("지어낸 데이터에 흡수된 이슈가 있다", () => {
  expect(siteJson<SiteIssueList>("issue-list.json").merged[String(info.issues.merged.id)]).toBeTruthy();
});
