// 호스팅 설정(4.6-2, P4). 호스팅에 따라 다른 것은 결과물의 `vercel.json` 한 파일에만 둔다.
// 화면 주소는 모두 화면 틀(index.html)로 보내고(SPA 대체 경로), 아래 폴더의 주소는 보내지 않는다(없는 파일은 404).

export const NO_FALLBACK_DIRS = ["site-data", "pagefind", "assets"] as const;

export const HOSTING_CONFIG_FILE = "vercel.json";

export function vercelConfig(): object {
  const exclude = NO_FALLBACK_DIRS.map((d) => `${d}/`).join("|");
  return {
    rewrites: [{ source: `/((?!${exclude}).*)`, destination: "/index.html" }],
  };
}

export type StaticResolution = { kind: "file"; path: string } | { kind: "fallback" } | { kind: "notFound" };

/**
 * 정적 서버가 주소를 어떻게 처리하는지(Vercel과 같은 규칙): 파일이 있으면 그 파일,
 * 없으면 대체 경로에서 뺀 폴더는 404, 그 밖은 화면 틀. 로컬 미리 보기(dev/serve.ts)가 쓴다.
 */
export function resolveStatic(pathname: string, exists: (relPath: string) => boolean): StaticResolution {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return { kind: "notFound" };
  }
  if (rel.split("/").some((part) => part === "..")) return { kind: "notFound" };
  if (rel !== "" && rel !== HOSTING_CONFIG_FILE && exists(rel)) return { kind: "file", path: rel };
  if (NO_FALLBACK_DIRS.some((d) => rel.startsWith(`${d}/`))) return { kind: "notFound" };
  return { kind: "fallback" };
}
