// 사이트 데이터 불러오기. 같은 파일은 한 번만 받고, 실패하면 다시 시도할 수 있다(4.3-5).
import { useEffect, useSyncExternalStore } from "react";

type Entry = { status: "loading" } | { status: "ok"; data: unknown } | { status: "error"; error: string };

const entries = new Map<string, Entry>();
const pending = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version++;
  for (const l of listeners) l();
}

export function loadJson<T>(url: string): Promise<T> {
  const done = entries.get(url);
  if (done?.status === "ok") return Promise.resolve(done.data as T);
  const running = pending.get(url);
  if (running) return running as Promise<T>;
  entries.set(url, { status: "loading" });
  const p = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<unknown>;
    })
    .then(
      (data) => {
        entries.set(url, { status: "ok", data });
        return data;
      },
      (err: unknown) => {
        entries.set(url, { status: "error", error: err instanceof Error ? err.message : String(err) });
        throw err;
      },
    )
    .finally(() => {
      pending.delete(url);
      emit();
    });
  pending.set(url, p);
  emit();
  return p as Promise<T>;
}

/** 실패한 파일들을 지우고 다시 받는다 */
export function retry(urls: (string | null)[]): void {
  for (const url of urls) {
    if (url && entries.get(url)?.status === "error") {
      entries.delete(url);
      loadJson(url).catch(() => {});
    }
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export type Resource<T> = { status: "idle" } | { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

/** 주소가 null이면 받지 않는다(idle) */
export function useResource<T>(url: string | null): Resource<T> {
  useSyncExternalStore(subscribe, () => version);
  useEffect(() => {
    if (url && !entries.has(url)) loadJson(url).catch(() => {});
  }, [url]);
  if (!url) return { status: "idle" };
  const e = entries.get(url);
  if (!e || e.status === "loading") return { status: "loading" };
  if (e.status === "error") return e;
  return { status: "ok", data: e.data as T };
}
