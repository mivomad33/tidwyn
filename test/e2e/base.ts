// E2E 공통 도우미: 바깥 네트워크 막기, 화면 오류 모으기, 가로 스크롤 확인, 사이트 데이터 요청 바꾸기.
import { test as base, expect, type Page, type Route } from "@playwright/test";
import { readInfo, type E2eInfo } from "./info.ts";

export { expect };

/** 지어낸 데이터에서 뽑은 기대값. 준비 스크립트가 서버를 띄우기 전에 쓴다 */
export const info: E2eInfo = readInfo();

/**
 * 모든 테스트: 127.0.0.1 밖으로 나가는 요청(가짜 이미지 주소 등)은 막고,
 * 화면에서 잡히지 않은 오류(pageerror)가 생기면 실패한다.
 */
export const test = base.extend<{ pageErrors: string[] }>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => errors.push(err.message));
      await page.context().route("**/*", (route) => {
        const host = new URL(route.request().url()).hostname;
        return host === "127.0.0.1" ? route.fallback() : route.abort("blockedbyclient");
      });
      await use(errors);
      expect(errors, "화면에서 잡히지 않은 오류").toEqual([]);
    },
    { auto: true },
  ],
});

/** 날짜 이동 줄의 가운데 링크(현재 날짜) 이름 */
export function dateLinkName(date: string): string {
  return `${monthDayWeekday(date)}, 날짜 목록 보기`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "2026-10-27" → "10월 27일 (화)" (화면 글자와 같은 형식) */
export function monthDayWeekday(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${m}월 ${d}일 (${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** "2026-10-27" → "10월 27일" */
export function monthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${m}월 ${d}일`;
}

/** 브리프 카드 주소(`/<날짜>#<뉴스 키>`) */
export function storyUrl(date: string, key: string): string {
  return `/${date}#${encodeURIComponent(key)}`;
}

/** 브리프 카드(li) */
export function storyItem(page: Page, key: string) {
  return page.locator(`[id="story-${key}"]`);
}

/** 문서에 가로 스크롤이 생기지 않았는지 */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const [scrollWidth, clientWidth] = (await page.evaluate("[document.scrollingElement.scrollWidth, document.scrollingElement.clientWidth]")) as [number, number];
  expect(scrollWidth, `${label}: 가로 스크롤(scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`).toBeLessThanOrEqual(clientWidth);
}

/** 사이트 데이터 파일 하나의 주소 패턴 */
export function dataFile(name: string): string {
  return `**/site-data/${name}`;
}

/** 그 파일 요청을 실패시킨다(네트워크 끊김) */
export async function failData(page: Page, name: string): Promise<void> {
  await page.route(dataFile(name), (route: Route) => route.abort("failed"));
}

/** 그 파일 요청에 서버 오류(500)를 준다 */
export async function serverError(page: Page, name: string): Promise<void> {
  await page.route(dataFile(name), (route: Route) => route.fulfill({ status: 500, contentType: "text/plain", body: "error" }));
}

/** 그 파일 요청에 주어진 JSON을 준다(빈 상태 확인용) */
export async function fulfillData(page: Page, name: string, json: unknown): Promise<void> {
  await page.route(dataFile(name), (route: Route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(json) }));
}
