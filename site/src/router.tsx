// 작은 주소 처리기: History API로 깔끔한 경로를 쓴다(P4). 링크를 가로채 새로 읽지 않고 화면만 바꾼다.
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

export interface Loc {
  pathname: string;
  search: string;
  hash: string;
  state: unknown;
}

const listeners = new Set<() => void>();

function read(): Loc {
  return { pathname: location.pathname, search: location.search, hash: location.hash, state: history.state as unknown };
}

let snapshot = read();
/** 마지막 주소 변경이 앱 안에서 한 것인지(펼침처럼 스크롤하지 않을 변경을 가리기 위해) */
let lastChange: { kind: "push" | "replace" | "pop"; quiet: boolean } = { kind: "pop", quiet: false };

function notify(): void {
  const next = read();
  if (next.pathname === snapshot.pathname && next.search === snapshot.search && next.hash === snapshot.hash && next.state === snapshot.state) return;
  snapshot = next;
  for (const l of listeners) l();
}

window.addEventListener("popstate", () => {
  lastChange = { kind: "pop", quiet: false };
  notify();
});
window.addEventListener("hashchange", () => {
  lastChange = { kind: "pop", quiet: false };
  notify();
});

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  /** 스크롤을 건드리지 않는다(카드 펼치기 등) */
  quiet?: boolean;
}

export function navigate(to: string, opts: NavigateOptions = {}): void {
  const url = new URL(to, location.href);
  const state = opts.state ?? null;
  if (opts.replace) history.replaceState(state, "", url);
  else history.pushState(state, "", url);
  lastChange = { kind: opts.replace ? "replace" : "push", quiet: opts.quiet ?? false };
  notify();
}

export function lastNavigation(): { kind: "push" | "replace" | "pop"; quiet: boolean } {
  return lastChange;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useLocation(): Loc {
  return useSyncExternalStore(subscribe, () => snapshot);
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; replace?: boolean };

export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (rest.target && rest.target !== "_self") return;
    e.preventDefault();
    navigate(to, { replace });
  }
  return <a href={to} onClick={handle} {...rest} />;
}
