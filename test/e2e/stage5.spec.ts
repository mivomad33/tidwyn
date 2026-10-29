// 5단계 화면(E2E): 일정 화면(목록·달력), 보기 기억, 일정 주소, 브리프 위 '이번 주 일정'과 접기, 펼친 카드의 일정 칩, 이슈 페이지의 일정,
// 빈 상태·불러오기 오류, 375px 폭, 새 주소 직접 요청. 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
// 기존 단계의 E2E는 일정이 없는 데이터 그대로 돌고, 여기서는 사이트 데이터 요청을 일정이 있는 지어낸 데이터(schedule-data/)로 바꿔 준다.
// 화면 파일은 같다. 브라우저 시계는 가장 최근 브리프의 다음 날(2026-10-28 수, KST)로 고정한다.
import fs from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect, expectNoHorizontalScroll, serverError, storyItem, storyUrl, test } from "./base.ts";
import { E2E_SCHEDULE_DATA_DIR, E2E_SCHEDULE_INFO_FILE } from "./paths.ts";
import { WEEK_BOX_KEY, SCHEDULE_VIEW_KEY, dayHeading, isUpcoming, outcomeParts } from "../../site/src/lib/schedules.ts";
import type { DayList, IssueChunk, MonthDetail, MonthList, ScheduleIndex, ScheduleItem, ScheduleMonth } from "../../src/siteTypes.ts";

const TODAY = "2026-10-28";
const SITE_DATA = path.join(E2E_SCHEDULE_DATA_DIR, "site-data");
const json = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(SITE_DATA, name), "utf8")) as T;
const files = fs.readdirSync(SITE_DATA);
const sinfo = JSON.parse(fs.readFileSync(E2E_SCHEDULE_INFO_FILE, "utf8")) as { dates: string[]; merged: { id: number; into: number }; deleted: number; total: number };

const index = json<ScheduleIndex>("schedule-index.json");
const items: ScheduleItem[] = index.months.flatMap((m) => json<ScheduleMonth>(`schedule-month-${m.month}.json`).items);
const days = new Map<string, DayList>();
for (const f of files.filter((f) => f.startsWith("list-"))) for (const d of json<MonthList>(f).days) days.set(d.date, d);
const LATEST = sinfo.dates[0]!;
const OLDEST = sinfo.dates.at(-1)!;
const latestWeek = days.get(LATEST)!.week!;
/** '이번 주 일정'이 있는 다른 날짜 */
const otherWeekDate = sinfo.dates.find((d) => d !== LATEST && days.get(d)!.week)!;
const pastItem = items.filter((x) => !isUpcoming(x.due, TODAY) && x.due.length === 10 && x.outcome.status === "result").at(-1)!;
/** 오늘 달의 오늘 뒤 일정 날(달력에서 고를 날) */
const thisMonthDays = [...new Set(items.filter((x) => x.due.length === 10 && x.due.startsWith(TODAY.slice(0, 7))).map((x) => x.due))].sort();

/** 사이트 데이터 요청을 일정이 있는 지어낸 데이터로 바꾼다(뒤에 단 page.route가 먼저 걸리므로 오류 주입은 이 뒤에 단다) */
async function useScheduleData(page: Page): Promise<void> {
  await page.route("**/site-data/**", (route: Route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    const file = path.join(SITE_DATA, name);
    if (!fs.existsSync(file)) return route.fulfill({ status: 404, contentType: "text/plain", body: "Not Found" });
    return route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(file, "utf8") });
  });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00+09:00`));
  await useScheduleData(page);
});

function viewBtn(page: Page, name: "목록" | "달력") {
  return page.getByRole("group", { name: "보기" }).getByRole("button", { name });
}
function tabBtn(page: Page, name: "다가오는 일정" | "지난 일정") {
  return page.getByRole("group", { name: "일정 구분" }).getByRole("button", { name });
}
function row(page: Page, id: number) {
  return page.locator(`[id="schedule-${id}"]`);
}
async function loadAll(page: Page): Promise<void> {
  const more = page.getByRole("button", { name: "더 보기" });
  while (await more.count()) await more.click();
}

test.describe("일정 화면: 목록", () => {
  test("다가오는 일정이 기본이고, 날짜는 현지 기준을 밝히며, 대분류 칩과 날짜 머리가 있다", async ({ page }) => {
    await page.goto("/schedules");
    await expect(page.getByRole("heading", { level: 1, name: "일정" })).toBeVisible();
    await expect(page.getByText("날짜는 현지 기준")).toBeVisible();
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
    await expect(tabBtn(page, "다가오는 일정")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "대분류" }).getByRole("button")).toHaveText(["전체", ...index.majors]);
    const first = items.filter((x) => isUpcoming(x.due, TODAY) && x.due.length === 10).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : a.id - b.id))[0]!;
    await expect(page.locator(".dh").first()).toHaveText(dayHeading(first.due, TODAY));
    await expect(page.locator(".ev").first()).toHaveId(`schedule-${first.id}`);
    // 이름은 처음 근거 뉴스로 간다
    await row(page, first.id).getByRole("link", { name: first.name }).click();
    await expect(page).toHaveURL(storyUrl(first.first!.date, first.first!.key));
  });

  test("지난 일정 탭에 다섯 가지 결과 문구가 붙고, 결과·이슈·연기 링크가 맞는 곳으로 간다", async ({ page }) => {
    await page.goto("/schedules");
    await tabBtn(page, "지난 일정").click();
    await loadAll(page);
    const res = page.locator(".sch-body .res");
    for (const text of ["결과: ", "연기 → ", "연기(새 날짜 모름)", "취소", "결과 못 찾음"]) await expect(res.filter({ hasText: text }).first()).toBeVisible();
    // 연기(새 날짜 모름)는 링크가 아니다
    await expect(page.locator(".sch-body a.res", { hasText: "연기(새 날짜 모름)" })).toHaveCount(0);
    const r = row(page, pastItem.id);
    const outcome = pastItem.outcome.status === "result" ? pastItem.outcome.news[0]! : null;
    await expect(r.getByRole("link", { name: outcomeParts(pastItem.outcome, TODAY)[0]!.text })).toHaveAttribute("href", storyUrl(outcome!.date, outcome!.key));
    if (pastItem.issue) await expect(r.getByRole("link", { name: pastItem.issue.name })).toHaveAttribute("href", `/issues/${pastItem.issue.id}`);
    const postponed = items.find((x) => !isUpcoming(x.due, TODAY) && x.outcome.status === "postponed" && x.outcome.to)!;
    const link = row(page, postponed.id).locator("a.res");
    await link.click();
    await expect(page).toHaveURL(`/schedules/${postponed.outcome.status === "postponed" ? postponed.outcome.to!.id : 0}`);
  });

  test("대분류 칩으로 거르고, 거른 결과가 없으면 빈 상태를 보인다", async ({ page }) => {
    const major = index.majors[0]!;
    await page.goto("/schedules");
    await page.getByRole("group", { name: "대분류" }).getByRole("button", { name: major }).click();
    await loadAll(page);
    await expect(page.locator(".ev .cat").filter({ hasNotText: major })).toHaveCount(0);
    // 없는 대분류만 있는 색인으로 바꾸면 빈 상태
    await page.route("**/site-data/schedule-month-*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ month: "x", items: [] }) }));
    await page.goto("/schedules");
    await loadAll(page);
    await expect(page.getByText("다가오는 일정이 없다.")).toBeVisible();
    await page.getByRole("group", { name: "대분류" }).getByRole("button", { name: major }).click();
    await loadAll(page);
    await expect(page.getByText("이 분류의 다가오는 일정이 없다.")).toBeVisible();
  });

  test("키보드로 '더 보기'를 누르면 새로 보인 첫 일정으로 포커스가 가고, Tab이 그 줄의 링크로 이어진다", async ({ page }) => {
    // 지어낸 데이터는 한 번에 다 보일 만큼 작아서, 색인의 달별 개수만 키워 지난 일정이 두 번에 나눠 보이게 한다(달 파일은 그대로)
    await page.route("**/site-data/schedule-index.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...index, months: index.months.map((m) => ({ ...m, count: m.count * 10 })) }) }),
    );
    await page.goto("/schedules");
    await tabBtn(page, "지난 일정").click();
    const more = page.getByRole("button", { name: "더 보기" });
    await expect(more).toBeVisible();
    const ids = () => page.locator(".sch-body .ev").evaluateAll((els) => els.map((e) => (e as unknown as { id: string }).id));
    const before = await ids();
    await more.focus();
    await page.keyboard.press("Enter");
    const focused = page.locator(".sch-body .ev:focus");
    await expect(focused).toHaveCount(1);
    const firstNew = (await ids()).find((id) => !before.includes(id));
    await expect(focused).toHaveId(firstNew!);
    await page.keyboard.press("Tab");
    await expect(page.locator(`[id="${firstNew}"] a`).first()).toBeFocused();
  });

  test("대분류를 거른 채 '더 보기'를 눌러 새로 보인 일정이 없으면 다시 그린 '더 보기'로 포커스가 간다", async ({ page }) => {
    // 색인은 달마다 일정(그 대분류도)이 많다고 하고(한 번에 한 달씩 받아, 누를 때 아직 받지 않은 달을 받는다) 빈 달을 뒤에 더해 '더 보기'가 남게 한다.
    // 달 파일에서는 그 대분류를 빼서 받아도 새 줄이 없게 한다
    const major = index.majors[0]!;
    const months = [...index.months, ...["2027-01", "2027-02", "2027-03"].map((month) => ({ month, count: 0, majors: {} }))];
    await page.route("**/site-data/schedule-index.json", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...index, months: months.map((m) => ({ ...m, count: 100, majors: { ...m.majors, [major]: 100 } })) }) }),
    );
    await page.route("**/site-data/schedule-month-*.json", (route) => {
      const name = new URL(route.request().url()).pathname.split("/").pop()!;
      const data = files.includes(name) ? json<ScheduleMonth>(name) : { month: name.slice(15, 22), items: [] };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...data, items: data.items.filter((x) => x.major !== major) }) });
    });
    await page.goto("/schedules");
    await page.getByRole("group", { name: "대분류" }).getByRole("button", { name: major }).click();
    const more = page.getByRole("button", { name: "더 보기" });
    await expect(more).toBeVisible();
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toBeFocused();
    await expect(page.locator(".sch-body .ev")).toHaveCount(0);
  });

  test("일정이 하나도 없으면 빈 상태, 색인을 받지 못하면 오류와 다시 시도", async ({ page }) => {
    await page.route("**/site-data/schedule-index.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ total: 0, months: [], majors: [] }) }));
    await page.goto("/schedules");
    await expect(page.getByText("아직 모은 일정이 없다.")).toBeVisible();
    await page.unroute("**/site-data/schedule-index.json");
    await serverError(page, "schedule-index.json");
    await page.goto("/schedules");
    await expect(page.getByRole("alert")).toContainText("불러오지 못했다");
    await page.unroute("**/site-data/schedule-index.json");
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(page.locator(".ev").first()).toBeVisible();
  });
});

test.describe("일정 화면: 달력", () => {
  test("달력을 고르면 월 격자가 보이고, 오늘(또는 오늘 뒤 첫 일정 날)이 골라져 있으며, 날짜를 누르면 그날 일정이 나온다", async ({ page }) => {
    await page.goto("/schedules");
    await viewBtn(page, "달력").click();
    await expect(page.getByRole("heading", { level: 2, name: "2026년 10월" })).toBeVisible();
    const grid = page.getByRole("group", { name: "2026년 10월 날짜" });
    const expectSel = thisMonthDays.includes(TODAY) ? TODAY : (thisMonthDays.find((d) => d > TODAY) ?? TODAY);
    await expect(grid.locator('button[aria-pressed="true"]')).toHaveAttribute("data-date", expectSel);
    await expect(grid.locator(`[data-date="${TODAY}"]`)).toHaveClass(/tod/);
    // 지난 날 점은 회색
    const pastDay = thisMonthDays.find((d) => d < TODAY)!;
    await expect(grid.locator(`[data-date="${pastDay}"] i`)).toHaveClass("p");
    await grid.locator(`[data-date="${pastDay}"]`).click();
    await expect(grid.locator(`[data-date="${pastDay}"]`)).toHaveAttribute("aria-pressed", "true");
    const expected = items.filter((x) => x.due === pastDay).sort((a, b) => a.id - b.id);
    await expect(page.locator(".sch-body section .dh")).toHaveText(dayHeading(pastDay, TODAY));
    await expect(page.locator(".sch-body section").first().locator(".ev .t")).toHaveText(expected.map((x) => x.name));
    await expect(page.getByRole("status").filter({ hasText: "고름" })).toHaveText(`${dayHeading(pastDay, TODAY)} 고름, 일정 ${expected.length}개`);
  });

  test("키보드로 날짜를 고르고 고른 날을 알리며, ‹ ›로 범위 안의 달만 넘긴다", async ({ page }) => {
    await page.goto("/schedules");
    await viewBtn(page, "달력").click();
    const grid = page.getByRole("group", { name: "2026년 10월 날짜" });
    const sel = grid.locator('button[aria-pressed="true"]');
    const start = (await sel.getAttribute("data-date"))!;
    await sel.focus();
    await page.keyboard.press("ArrowLeft");
    const prev = `2026-10-${String(Number(start.slice(8)) - 1).padStart(2, "0")}`;
    await expect(grid.locator(`[data-date="${prev}"]`)).toBeFocused();
    await expect(grid.locator(`[data-date="${prev}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status").filter({ hasText: "고름" })).toContainText(dayHeading(prev, TODAY));
    // 격자 안에서 Tab으로 들어가는 날은 고른 날 하나다
    await expect(grid.locator('button[tabindex="0"]')).toHaveAttribute("data-date", prev);
    // 달 넘기기: 첫 달에서 ‹는 막힌다
    const first = index.months[0]!.month;
    const prevBtn = page.getByRole("button", { name: "이전 달" });
    for (let m = 10; `2026-${String(m).padStart(2, "0")}` > first; m--) await prevBtn.click();
    await expect(prevBtn).toBeDisabled();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(`2026년 ${Number(first.slice(5))}월`);
    const last = index.months.at(-1)!.month;
    const nextBtn = page.getByRole("button", { name: "다음 달" });
    while (await nextBtn.isEnabled()) await nextBtn.click();
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(`${last.slice(0, 4)}년 ${Number(last.slice(5))}월`);
  });

  test("대분류 칩은 점과 목록 모두에 적용된다", async ({ page }) => {
    await page.goto("/schedules");
    await viewBtn(page, "달력").click();
    const month = items.filter((x) => x.due.length === 10 && x.due.startsWith("2026-10"));
    const major = index.majors.find((m) => month.some((x) => x.major === m) && month.some((x) => x.major !== m))!;
    await page.getByRole("group", { name: "대분류" }).getByRole("button", { name: major }).click();
    const grid = page.getByRole("group", { name: "2026년 10월 날짜" });
    const dotted = [...new Set(month.filter((x) => x.major === major).map((x) => x.due))].sort();
    await expect(grid.locator("button:has(i)")).toHaveCount(dotted.length);
    await grid.locator(`[data-date="${dotted[0]}"]`).click();
    await expect(page.locator(".sch-body .ev .cat").filter({ hasNotText: major })).toHaveCount(0);
  });
});

test.describe("보기 기억", () => {
  test("달력을 고른 뒤 새로 고쳐도 달력이고, 읽은 기록 지우기 뒤에도 남는다", async ({ page }) => {
    await page.goto("/schedules");
    await viewBtn(page, "달력").click();
    expect(await page.evaluate((k) => localStorage.getItem(k), SCHEDULE_VIEW_KEY)).toBe("calendar");
    await page.reload();
    await expect(viewBtn(page, "달력")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/about");
    await expect(page.getByText("일정 화면의 보기(목록·달력)")).toBeVisible();
    await expect(page.getByText("일정도 AI가 뉴스에서 뽑은 것이라")).toBeVisible();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "읽은 기록 지우기" }).click();
    await expect(page.getByText("읽은 기록을 지웠다.")).toBeVisible();
    await page.goto("/schedules");
    await expect(viewBtn(page, "달력")).toHaveAttribute("aria-pressed", "true");
    await viewBtn(page, "목록").click();
    await page.reload();
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
  });

  test("값이 깨졌거나 저장할 수 없으면 오류 없이 목록으로 시작한다", async ({ page }) => {
    await page.goto("/about");
    await page.evaluate((k) => localStorage.setItem(k, "{깨짐"), SCHEDULE_VIEW_KEY);
    await page.goto("/schedules");
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
    await page.addInitScript({
      content: `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("막힌 저장소", "SecurityError"); } });`,
    });
    await page.goto("/schedules");
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
    await viewBtn(page, "달력").click();
    await expect(page.getByRole("group", { name: /날짜$/ })).toBeVisible();
  });
});

test.describe("일정 주소", () => {
  test("일정 주소로 들어오면 그 일정이 든 탭의 그 위치로 가서 강조하고, 기억한 보기가 달력이어도 목록이며 기억은 그대로다", async ({ page }) => {
    await page.goto("/about");
    await page.evaluate((k) => localStorage.setItem(k, "calendar"), SCHEDULE_VIEW_KEY);
    await page.goto(`/schedules/${pastItem.id}`);
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
    await expect(tabBtn(page, "지난 일정")).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, pastItem.id)).toHaveClass(/\bhl\b/);
    await expect(row(page, pastItem.id)).toBeInViewport();
    await expect(row(page, pastItem.id)).toBeFocused();
    expect(await page.evaluate((k) => localStorage.getItem(k), SCHEDULE_VIEW_KEY)).toBe("calendar");
    // 새로 고쳐도 같다
    await page.reload();
    await expect(row(page, pastItem.id)).toHaveClass(/\bhl\b/);
  });

  test("다가오는 먼 달 일정도 그 달까지 받아 보이고, 흡수된 일정은 남는 일정으로, 지운·없는 일정은 없는 페이지다", async ({ page }) => {
    const far = [...items].filter((x) => isUpcoming(x.due, TODAY)).sort((a, b) => (a.due < b.due ? 1 : -1))[0]!;
    await page.goto(`/schedules/${far.id}`);
    await expect(tabBtn(page, "다가오는 일정")).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, far.id)).toHaveClass(/\bhl\b/);
    await page.goto(`/schedules/${sinfo.merged.id}`);
    await expect(page).toHaveURL(`/schedules/${sinfo.merged.into}`);
    await expect(row(page, sinfo.merged.into)).toHaveClass(/\bhl\b/);
    for (const id of [sinfo.deleted, 99999]) {
      await page.goto(`/schedules/${id}`);
      await expect(page.getByRole("heading", { level: 1, name: "없는 페이지" })).toBeVisible();
    }
  });

  test("새 주소를 서버에 직접 요청하면 200과 화면 틀이 온다", async ({ request }) => {
    for (const p of ["/schedules", "/schedules/1", "/schedules?view=list"]) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(200);
      expect(await res.text()).toContain('<div id="root"></div>');
    }
  });
});

test.describe("브리프 위 '이번 주 일정'", () => {
  test("한 문장 아래·칩 위에 최대 5줄, 줄을 누르면 그 일정으로 가고, '일정 전체'는 목록으로 간다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    const box = page.getByRole("region", { name: "이번 주 일정" });
    await expect(box.locator(".wrow")).toHaveCount(Math.min(5, latestWeek.total));
    expect(latestWeek.total).toBeGreaterThan(5);
    const order = (await page.evaluate(`[...document.querySelectorAll("main > .headline, main > .week, main > .chips")].map((e) => e.className)`)) as string[];
    expect(order).toEqual(["headline", "week", "chips"]);
    // 섹션 탭과 관계없이 같다
    await page.getByRole("navigation", { name: "섹션" }).getByRole("button", { name: "세계" }).click();
    await expect(box.locator(".wrow")).toHaveCount(5);
    await expect(box.locator(".wrow small a, .wrow a")).toHaveCount(0);
    await expect(box.locator(".rd-btn, .read-mk")).toHaveCount(0);
    const firstLine = latestWeek.items[0]!;
    await box.locator(".wrow").first().click();
    await expect(page).toHaveURL(`/schedules/${firstLine.id}`);
    await expect(row(page, firstLine.id)).toHaveClass(/\bhl\b/);
    await page.goto(`/schedules`);
    await viewBtn(page, "달력").click();
    await page.goto(`/${LATEST}`);
    await box.getByRole("link", { name: "일정 전체" }).click();
    await expect(page).toHaveURL("/schedules?view=list");
    await expect(viewBtn(page, "목록")).toHaveAttribute("aria-pressed", "true");
  });

  test("제목을 눌러 접고 펴고(Enter·Space 포함), 접은 상태가 새로 고침·다른 날짜·읽은 기록 지우기 뒤에도 이어진다", async ({ page }) => {
    await page.goto(`/${LATEST}`);
    const toggle = page.getByRole("button", { name: /^이번 주 일정/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveText(`이번 주 일정 ${latestWeek.total} ▾`);
    await expect(page.locator(".week.closed")).toHaveCount(1);
    await expect(page.locator(".wrow")).toHaveCount(0);
    expect(await page.evaluate((k) => localStorage.getItem(k), WEEK_BOX_KEY)).toBe("closed");
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.goto(`/${otherWeekDate}`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.goto("/about");
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "읽은 기록 지우기" }).click();
    await page.goto(`/${LATEST}`);
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toHaveText("이번 주 일정 ▴");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  test("그 주 일정이 없는 날짜에는 상자도 접은 줄도 없고, 저장할 수 없으면 펼친 채 오류가 없다", async ({ page }) => {
    expect(days.get(OLDEST)!.week).toBeUndefined();
    await page.goto(`/${OLDEST}`);
    await expect(page.locator(".headline")).toBeVisible();
    await expect(page.locator(".week")).toHaveCount(0);
    await page.addInitScript({
      content: `Object.defineProperty(window, "localStorage", { configurable: true, get() { throw new DOMException("막힌 저장소", "SecurityError"); } });`,
    });
    await page.goto(`/${LATEST}`);
    const toggle = page.getByRole("button", { name: /^이번 주 일정/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});

test.describe("펼친 카드와 이슈 페이지", () => {
  const card = (() => {
    for (const f of files.filter((x) => x.startsWith("detail-")))
      for (const [date, cards] of Object.entries(json<MonthDetail>(f).days)) for (const [key, c] of Object.entries(cards)) if ((c.schedules?.length ?? 0) > 1) return { date, key, schedules: c.schedules! };
    throw new Error("일정 칩이 둘 이상인 카드가 없다");
  })();

  test("카드의 '일정' 칩 줄이 '전망' 아래·'인물·기관·국가' 위에 있고, 칩을 누르면 그 일정이 강조된다", async ({ page }) => {
    await page.goto(storyUrl(card.date, card.key));
    const item = storyItem(page, card.key);
    await expect(item.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
    const heads = await item.locator("h4").allTextContents();
    const at = heads.indexOf("일정");
    expect(heads[at - 1]).toBe("전망");
    if (heads.includes("인물·기관·국가")) expect(heads.indexOf("인물·기관·국가")).toBe(at + 1);
    const chips = item.locator("a.evc");
    await expect(chips).toHaveCount(card.schedules.length);
    const s = card.schedules[0]!;
    await expect(chips.first()).toHaveText(`${s.due.length === 7 ? `${Number(s.due.slice(5))}월 중` : s.due.slice(5)}${s.name}`);
    await chips.first().click();
    await expect(page).toHaveURL(`/schedules/${s.id}`);
    await expect(row(page, s.id)).toHaveClass(/\bhl\b/);
  });

  test("이슈 페이지의 '일정'이 타임라인 아래에 다가오는 일정 다음 지난 일정으로 있다", async ({ page }) => {
    const issues = files.filter((f) => /^issue-\d+\.json$/.test(f)).flatMap((f) => Object.values(json<IssueChunk>(f).issues));
    const issue = issues.find((i) => i.schedules?.some((x) => isUpcoming(x.due, TODAY)) && i.schedules.some((x) => !isUpcoming(x.due, TODAY)))!;
    await page.goto(`/issues/${issue.id}`);
    // 이슈 데이터를 받아 그린 뒤에 제목들을 읽는다(allTextContents는 기다리지 않는다)
    await expect(page.getByRole("heading", { level: 2, name: "일정", exact: true })).toBeVisible();
    const heads = await page.locator("main h2").allTextContents();
    expect(heads.indexOf("일정")).toBe(heads.indexOf("타임라인") + 1);
    const labels = await page.locator(".evlist small").allTextContents();
    const kinds = labels.map((l) => (l.endsWith("다가오는 일정") ? "u" : "p")).join("");
    expect(kinds).toMatch(/^u+p+$/);
    await page.locator(".evlist a").first().click();
    await expect(page).toHaveURL(/\/schedules\/\d+$/);
  });
});

test.describe("375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("새 화면에 가로 스크롤이 없다", async ({ page }) => {
    await page.goto("/schedules");
    await expect(page.locator(".ev").first()).toBeVisible();
    await expectNoHorizontalScroll(page, "일정 목록");
    await tabBtn(page, "지난 일정").click();
    await loadAll(page);
    await expectNoHorizontalScroll(page, "지난 일정");
    await viewBtn(page, "달력").click();
    await expect(page.locator(".cal")).toBeVisible();
    await expectNoHorizontalScroll(page, "달력");
    await page.goto(`/schedules/${pastItem.id}`);
    await expect(row(page, pastItem.id)).toBeVisible();
    await expectNoHorizontalScroll(page, "일정 주소");
    await page.goto(`/${LATEST}`);
    await expect(page.locator(".week")).toBeVisible();
    await expectNoHorizontalScroll(page, "이번 주 일정");
    const issue = items.find((x) => x.issue)!.issue!;
    await page.goto(`/issues/${issue.id}`);
    await expect(page.getByRole("heading", { name: "일정", exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page, "이슈 페이지");
  });
});

test("머리 메뉴에 '일정'이 있다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "메뉴" }).click();
  await page.getByRole("navigation", { name: "사이트 메뉴" }).getByRole("link", { name: "일정", exact: true }).click();
  await expect(page).toHaveURL("/schedules");
  await expect(page.getByRole("heading", { level: 1, name: "일정" })).toBeVisible();
});
