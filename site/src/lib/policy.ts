// 7단계 개인정보 처리방침 문구(V6). 바닥글·사이트 소개·처리방침이 같은 문구를 쓴다.
import { CONTACT_MAIL, SITE_URL } from "../../../src/publicSite.ts";

/** 원본 저장소(사이트 소개의 링크) */
export const REPO_URL = "https://github.com/mivomad33/tidwyn";

export { CONTACT_MAIL, SITE_URL };

export function mailHref(subject?: string, body?: string): string {
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join("&");
  return `mailto:${CONTACT_MAIL}${q ? `?${q}` : ""}`;
}

/** 펼친 카드의 제보 링크: 날짜, 뉴스 제목, 뉴스 주소를 채운다 */
export function storyReportHref(dateLabel: string, title: string, url: string): string {
  return mailHref(`[정정 제보] ${title}`, `날짜: ${dateLabel}\n뉴스: ${title}\n주소: ${url}\n\n틀린 내용:\n`);
}

/** 짧은 소식의 제보 링크: 제목이 없으므로 날짜와 브리프 주소를 채운다 */
export function shortReportHref(dateLabel: string, url: string): string {
  return mailHref(`[정정 제보] ${dateLabel}`, `날짜: ${dateLabel}\n주소: ${url}\n\n틀린 뉴스:\n틀린 내용:\n`);
}

export const PRIVACY_TITLE = "개인정보 처리방침";
/** 처리방침을 마지막으로 바꾼 날 */
export const PRIVACY_UPDATED = "2026-11-24";
