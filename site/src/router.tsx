// 작은 주소 처리기: History API로 깔끔한 경로를 쓴다(P4). 링크를 가로채 새로 읽지 않고 화면만 바꾼다.
// U1 4.4: 기록마다 history.state의 nav(식별자, 바로 앞 기록, 들어온 브리프, 떠날 때의 스크롤)를 붙인다(lib/navState.ts).
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";
import { adoptState, navOf, pushStateOf, replaceStateOf, withScroll } from "./lib/navState.ts";

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

let counter = 0;
/** 기록 식별자. 같은 브라우저 탭 안에서만 겹치지 않으면 된다 */
function newId(): string {
  counter++;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** nav가 없는 기록이면 붙인다. from은 그 직전에 보던 기록(첫 방문이면 null) */
function adopt(from: Loc | null): void {
  if (navOf(history.state)) return;
  history.replaceState(adoptState(history.state, newId(), from ? { state: from.state, path: from.pathname } : null), "", location.href);
}

adopt(null);
let snapshot = read();
/** 마지막 주소 변경이 앱 안에서 한 것인지(펼침처럼 스크롤하지 않을 변경을 가리기 위해) */
let lastChange: { kind: "push" | "replace" | "pop"; quiet: boolean } = { kind: "pop", quiet: false };

function notify(): void {
  const next = read();
  if (next.pathname === snapshot.pathname && next.search === snapshot.search && next.hash === snapshot.hash && next.state === snapshot.state) return;
  snapshot = next;
  for (const l of listeners) l();
}

/** 첫 문서 읽기 뒤로 주소가 바뀌었는지 */
let changed = false;

function onPop(): void {
  changed = true;
  adopt(snapshot);
  lastChange = { kind: "pop", quiet: false };
  notify();
}
window.addEventListener("popstate", onPop);
window.addEventListener("hashchange", onPop);
// 앱 밖으로 나가거나 새로 고칠 때도 스크롤을 남긴다
window.addEventListener("pagehide", () => updateEntry((s) => withScroll(s, window.scrollY)));

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
  /** 스크롤을 건드리지 않는다(카드 펼치기 등) */
  quiet?: boolean;
}

export function navigate(to: string, opts: NavigateOptions = {}): void {
  const url = new URL(to, location.href);
  if (opts.replace) {
    history.replaceState(replaceStateOf(history.state, url.pathname === location.pathname, opts.state), "", url);
  } else {
    // 떠나는 기록에 스크롤을 남겨 돌아올 때 되살린다(S12)
    history.replaceState(withScroll(history.state, window.scrollY), "", location.href);
    history.pushState(pushStateOf(history.state, location.pathname, newId(), opts.state), "", url);
  }
  changed = true;
  lastChange = { kind: opts.replace ? "replace" : "push", quiet: opts.quiet ?? false };
  notify();
}

/**
 * 지금 기록에 방문 기록을 따라 돌아왔는지(앱 안의 뒤로·앞으로, 다른 사이트에서 뒤로 와 문서를 다시 읽은 경우).
 * 새로 고침은 아니다(새로 고치면 고른 칩이 '전체'로 돌아가는 7단계 동작을 지킨다). 화면이 기록에 남긴 칩·스크롤을 되살릴지 정한다
 */
export function cameBackToEntry(): boolean {
  if (changed) return lastChange.kind === "pop";
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  return nav?.type === "back_forward";
}

/** 지금 기록의 state를 화면을 다시 그리지 않고 고친다(브리프의 탭·칩 기록 등) */
export function updateEntry(change: (state: unknown) => unknown): void {
  try {
    history.replaceState(change(history.state), "", location.href);
  } catch {
    // 짧은 시간에 너무 많이 부르면 브라우저가 막는다. 기록하지 못해도 화면은 그대로다
  }
}

/** 기록을 하나 되돌린다(화면 안 '‹ 브리프', S1) */
export function goBack(): void {
  history.back();
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

/** 새 탭·창으로 여는 누름이 아닌 보통 왼쪽 누름인지 */
export function isPlainClick(e: MouseEvent<HTMLAnchorElement>): boolean {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const target = e.currentTarget.getAttribute("target");
  return !target || target === "_self";
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string; replace?: boolean };

export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    onClick?.(e);
    // onClick이 이동을 맡았으면(preventDefault) 다시 옮기지 않는다(isPlainClick이 본다)
    if (!isPlainClick(e)) return;
    e.preventDefault();
    navigate(to, { replace });
  }
  return <a href={to} onClick={handle} {...rest} />;
}
