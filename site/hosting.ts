// 호스팅 설정(4.6-2, P4, 9.5단계 4.3-5). 호스팅에 따라 다른 것은 결과물의 `vercel.json` 한 파일에만 둔다.
// 페이지마다 HTML 파일이 있어(staticSite.ts) 확장자 없는 주소는 그 파일로 가고, 앱 전용 주소만 화면 틀(app.html)로 보낸다. 그 밖은 404.html이 404로 나간다.

export const HOSTING_CONFIG_FILE = "vercel.json";

/** 사이트 데이터와 검색 색인은 파일 자체가 검색에 나오지 않게 한다 */
export const NOINDEX_DIRS = ["site-data", "pagefind"] as const;

export const NOT_FOUND_FILE = "404.html";
/** 앱 전용 주소가 받는 빈 화면 틀(noindex) */
export const APP_FILE = "app.html";
/** `/<이름>/<번호>` 모양의 앱 전용 주소 */
const APP_ID_ROUTES = ["terms", "schedules"];
const APP_ID_RE = new RegExp(`^(?:${APP_ID_ROUTES.join("|")})/\\d+$`);

export function vercelConfig(): object {
  return {
    cleanUrls: true,
    trailingSlash: false,
    rewrites: ["/search", ...APP_ID_ROUTES.map((r) => `/${r}/:id(\\d+)`)].map((source) => ({ source, destination: "/app" })),
    headers: NOINDEX_DIRS.map((d) => ({ source: `/${d}/(.*)`, headers: [{ key: "X-Robots-Tag", value: "noindex" }] })),
  };
}

/** 앱 전용 주소: 숫자 모양이면 파일 없이 앱이 처리한다(없는 번호는 앱이 없는 페이지를 보인다, 4.3-3의 예외) */
function isAppOnly(rel: string): boolean {
  return rel === "search" || APP_ID_RE.test(rel);
}

export type StaticResolution = { kind: "file"; path: string } | { kind: "notFound"; path: string };

/**
 * 정적 서버가 주소를 어떻게 처리하는지(Vercel과 같은 규칙): 끝의 `/`를 없애고, 파일이 있으면 그 파일,
 * `.html`을 붙인 파일이 있으면 그 파일, 앱 전용 주소면 화면 틀, 그 밖은 없는 페이지다. 로컬 미리 보기(dev/serve.ts)가 쓴다.
 */
export function resolveStatic(pathname: string, exists: (relPath: string) => boolean): StaticResolution {
  const notFound: StaticResolution = { kind: "notFound", path: NOT_FOUND_FILE };
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\/+$/, "");
  } catch {
    return notFound;
  }
  if (rel.split("/").some((part) => part === "..")) return notFound;
  if (rel === "") return { kind: "file", path: "index.html" };
  if (rel === HOSTING_CONFIG_FILE) return notFound;
  if (exists(rel)) return { kind: "file", path: rel };
  if (exists(`${rel}.html`)) return { kind: "file", path: `${rel}.html` };
  if (isAppOnly(rel)) return { kind: "file", path: APP_FILE };
  return notFound;
}
