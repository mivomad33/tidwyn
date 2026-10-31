// 공개 주소와 공개 메일(9.5단계 R1). 값은 여기 한 곳에 둔다: src/는 의존성 없이 돌아야 해서 site/를 가져오지 못하므로, 화면은 site/src/lib/policy.ts가 다시 내보낸 값을 쓴다.

/** 공개 주소. 정적 HTML의 canonical과 RSS, 배포 뒤 점검이 같은 값을 쓴다(미리보기 빌드도 이 주소다) */
export const SITE_URL = "https://tidwyn.vercel.app";

/** 오류 제보와 문의를 받는 공개 메일. 공개 전 점검의 허용 메일도 이 값이다 */
export const CONTACT_MAIL = "mivomad33@gmail.com";

export const ROBOTS_FILE = "robots.txt";
export const SITEMAP_FILE = "sitemap.xml";
/** robots.txt가 막는 유일한 주소(앱의 검색 화면) */
export const ROBOTS_DISALLOW = "/search";

/** "2026-10-27" → "10월 27일". 페이지 제목과 배포 뒤 점검이 같은 모양을 쓴다 */
export function monthDay(date: string): string {
  const [, m, d] = date.split("-").map(Number);
  return `${m}월 ${d}일`;
}

/** 공개 주소 기준 경로 → 결과물 파일 */
export function pageFile(pathname: string): string {
  return pathname === "/" ? "index.html" : `${pathname.slice(1)}.html`;
}
