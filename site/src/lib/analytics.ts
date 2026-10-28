// 방문 통계(P10, 4.6-4): 운영 주소에서만 켜고, 검색어(`q`)는 보내지 않는다.

export const PRODUCTION_HOST = "tidwyn.vercel.app";

/** 빌드 모드가 아니라 실행 중인 접속 주소로 정한다 */
export function analyticsEnabled(hostname: string): boolean {
  return hostname === PRODUCTION_HOST;
}

/** 통계로 보낼 주소에서 검색어를 뺀다 */
export function stripSearchQuery(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (!u.searchParams.has("q")) return url;
  u.searchParams.delete("q");
  return u.toString();
}
