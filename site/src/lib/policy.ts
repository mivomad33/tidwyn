// 7단계 개인정보 처리방침 문구(V6). 바닥글·사이트 소개·처리방침이 같은 문구를 쓴다.
import { CONTACT_MAIL, SITE_URL } from "../../../src/publicSite.ts";

/** 원본 저장소(사이트 소개의 링크) */
export const REPO_URL = "https://github.com/mivomad33/tidwyn";

export { CONTACT_MAIL, SITE_URL };

export function mailHref(subject?: string, body?: string): string {
  const q = [subject && `subject=${encodeURIComponent(subject)}`, body && `body=${encodeURIComponent(body)}`].filter(Boolean).join("&");
  return `mailto:${CONTACT_MAIL}${q ? `?${q}` : ""}`;
}

/** 브리프 목록 맨 끝의 제보 링크(2026-11-27 T8: 뉴스마다 두던 링크를 하나로 합쳤다). 날짜와 브리프 주소를 채우고, 어느 뉴스인지는 제보하는 사람이 적는다 */
export function briefReportHref(dateLabel: string, url: string): string {
  return mailHref(`[정정 제보] ${dateLabel}`, `날짜: ${dateLabel}\n주소: ${url}\n\n틀린 뉴스(제목):\n틀린 내용:\n`);
}

export const PRIVACY_TITLE = "개인정보 처리방침";
/** 처리방침을 마지막으로 바꾼 날 */
export const PRIVACY_UPDATED = "2026-11-27";
