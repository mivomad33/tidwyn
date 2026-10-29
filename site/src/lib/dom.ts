// react-dom/server로 테스트하는 그리기 코드(components/*.ts)가 쓰는 최소한의 DOM 접근.
// 저장소 맨 위 형식 검사(tsconfig.json)는 DOM 형식 없이 이 코드를 보므로, 쓰는 것만 좁은 형식으로 둔다. 브라우저 밖(서버 그리기)에서는 아무것도 하지 않는다.

interface FocusableLike {
  focus(): void;
}

interface ElementLike extends FocusableLike {
  clientWidth: number;
  querySelector(selector: string): FocusableLike | null;
  getBoundingClientRect(): { left: number; width: number };
  setPointerCapture?(pointerId: number): void;
}

type ResizeObserverCtor = new (cb: () => void) => { observe(el: unknown): void; disconnect(): void };

const g = globalThis as unknown as { document?: { getElementById(id: string): FocusableLike | null }; ResizeObserver?: ResizeObserverCtor };

/** id로 찾은 요소에 초점을 둔다 */
export function focusById(id: string): void {
  g.document?.getElementById(id)?.focus();
}

/** el 안에서 selector로 찾은 첫 요소에 초점을 둔다 */
export function focusIn(el: unknown, selector: string): void {
  (el as ElementLike | null)?.querySelector(selector)?.focus();
}

/** el의 너비가 바뀔 때마다 부른다. 그만두는 함수를 돌려준다 */
export function observeWidth(el: unknown, cb: (width: number) => void): () => void {
  if (!el || !g.ResizeObserver) return () => {};
  const target = el as ElementLike;
  const ro = new g.ResizeObserver(() => cb(Math.round(target.clientWidth)));
  ro.observe(el);
  return () => ro.disconnect();
}

/** 화면에서 el의 왼쪽 끝과 너비 */
export function rectOf(el: unknown): { left: number; width: number } {
  return (el as ElementLike).getBoundingClientRect();
}

/** 끌기(터치)를 이 요소가 계속 받게 한다 */
export function capturePointer(el: unknown, pointerId: number): void {
  (el as ElementLike).setPointerCapture?.(pointerId);
}
