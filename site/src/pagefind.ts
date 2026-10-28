// Pagefind 브라우저 API. 색인은 결과물의 /pagefind/에 있고, 검색 화면을 열 때 처음 불러온다.
import { PAGEFIND_BASE } from "./lib/paths.ts";

export interface PagefindResultData {
  url: string;
  meta: Record<string, string>;
}

export interface PagefindResult {
  id: string;
  data: () => Promise<PagefindResultData>;
}

interface PagefindModule {
  options: (o: Record<string, unknown>) => Promise<void>;
  init: () => Promise<void>;
  search: (term: string) => Promise<{ results: PagefindResult[] } | null>;
}

let loading: Promise<PagefindModule> | null = null;

export function getPagefind(): Promise<PagefindModule> {
  if (!loading) {
    const url = new URL(`${PAGEFIND_BASE}pagefind.js`, location.origin).href;
    loading = (import(/* @vite-ignore */ url) as Promise<PagefindModule>)
      .then(async (pf) => {
        await pf.options({ basePath: PAGEFIND_BASE });
        await pf.init();
        return pf;
      })
      .catch((err: unknown) => {
        loading = null;
        throw err;
      });
  }
  return loading;
}

export async function searchRecords(q: string): Promise<PagefindResult[]> {
  const pf = await getPagefind();
  const res = await pf.search(q);
  return res?.results ?? [];
}
