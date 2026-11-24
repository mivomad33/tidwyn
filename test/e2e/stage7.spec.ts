// 7단계 화면(E2E): 바닥글의 개인정보 처리방침 링크와 그 페이지(직접 열기·새로 고침), 375px 폭.
// R1단계에서 추천 영상과 바닥글 동의 문구, 처리방침의 '이용 조건' 절을 지워(4.3-4) 처리방침 부분만 남겼다.
// 데이터는 모두 지어낸 것이다(test/e2e/prepare.ts).
import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalScroll, info, test } from "./base.ts";

const issue = info.issues.first;

test.describe("4.7-4 개인정보 처리방침", () => {
  const pages: [string, (p: Page) => Promise<void>][] = [
    ["/", (p) => expect(p.getByRole("link", { name: /날짜 목록 보기/ })).toBeVisible()],
    [`/issues/${issue.id}`, (p) => expect(p.getByRole("heading", { level: 1, name: issue.name })).toBeVisible()],
    [`/entities/${info.entities.person.id}`, (p) => expect(p.getByRole("heading", { level: 1, name: info.entities.person.name })).toBeVisible()],
    ["/terms", (p) => expect(p.getByRole("heading", { level: 1, name: "용어 사전" })).toBeVisible()],
    ["/schedules", (p) => expect(p.getByRole("heading", { level: 1, name: "일정" })).toBeVisible()],
    // 이 데이터에는 지표 파일이 없어 지표 화면은 불러오기 오류 상태다(바닥글은 같다)
    ["/indicators", (p) => expect(p.getByRole("button", { name: "다시 시도" })).toBeVisible()],
    ["/about", (p) => expect(p.getByRole("heading", { level: 1, name: "사이트 소개" })).toBeVisible()],
    ["/no-such-page", (p) => expect(p.getByRole("heading", { level: 1, name: "이 주소에는 페이지가 없다" })).toBeVisible()],
  ];
  for (const [url, ready] of pages) {
    test(`${url}의 바닥글에서 '개인정보 처리방침'으로 간다`, async ({ page }) => {
      await page.goto(url);
      await ready(page);
      await page.getByRole("contentinfo").getByRole("link", { name: "개인정보 처리방침" }).click();
      await expect(page).toHaveURL("/privacy");
      await expect(page.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeVisible();
    });
  }

  test("새 주소를 직접 열고 새로 고쳐도 처리방침 제목이 보인다", async ({ page }) => {
    const res = await page.goto("/privacy");
    expect(res!.status()).toBe(200);
    for (let i = 0; i < 2; i++) {
      await expect(page).toHaveTitle("개인정보 처리방침 · Tidwyn");
      await expect(page.getByRole("heading", { level: 1, name: "개인정보 처리방침" })).toBeVisible();
      await page.reload();
    }
  });
});

test.describe("4.7-6 375px 폭", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("이슈, 처리방침, 사이트 소개에 가로 스크롤이 없다", async ({ page }) => {
    for (const [url, label] of [
      [`/issues/${issue.id}`, "이슈"],
      ["/privacy", "처리방침"],
      ["/about", "사이트 소개"],
    ] as const) {
      await page.goto(url);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expectNoHorizontalScroll(page, label);
    }
  });
});
