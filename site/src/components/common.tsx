// 여러 화면이 함께 쓰는 컴포넌트(시안 A의 머리 줄, 칩, 분류 줄, 대기·오류 상태, 4.5단계 읽음 표시)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode, type RefObject } from "react";
import { MAJORS } from "../../../src/categories.ts";
import { pageTitle } from "../lib/format.ts";
import { countLabel, keptChip, type ChipOption } from "../lib/chips.ts";
import { MENU, SKIP_LABEL } from "../lib/menu.ts";
import { resolveBriefBack } from "../lib/navState.ts";
import { observeWidth } from "../lib/dom.ts";
import { categoryVar } from "../lib/theme.ts";
import { FooterView } from "./policyView.ts";
import type { Major } from "../lib/types.ts";
import { readStore, useIsRead } from "../readMarks.ts";
import { goBack, isPlainClick, Link, navigate, useLocation } from "../router.tsx";
import { BackMark } from "./moreMark.ts";

export function useTitle(label: string | undefined): void {
  useFullTitle(pageTitle(label));
}

/** 제목 전체를 정한다(브리프처럼 이름이 앞에 오는 제목) */
export function useFullTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * "더 보기"를 누른 뒤 새로 보인 첫 줄로 포커스를 옮긴다(키보드 사용, 3단계 4.3-6). 버튼이 사라지거나 대기 표시로 바뀌면 포커스를 잃기 때문이다.
 * 누를 때 mark()를 부르면, 컨테이너(ref) 안에서 rowSelector로 찾은 줄 중 그때 없던 첫 줄이 나타날 때 그 줄로 옮긴다
 * (줄에 tabindex가 있으면 줄 자체, 아니면 줄이거나 줄 안의 첫 링크·버튼). 줄은 id가 있으면 id로, 없으면 요소로 가린다.
 * 새 줄 없이 누른 버튼이 사라졌다가 컨테이너 안에 버튼(다시 그린 '더 보기'나 오류의 '다시 시도')이 나타나면 그 버튼으로 옮긴다
 * (거른 결과가 새로 받은 쪽에 하나도 없을 때). 받는 동안 scope(탭·거르기 등)가 바뀌면 옮기지 않는다.
 */
export function useFocusNewRow<T extends HTMLElement>(rowSelector: string, scope?: unknown): { ref: RefObject<T | null>; mark: () => void } {
  const ref = useRef<T>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const watch = useRef<MutationObserver | null>(null);
  const stop = useCallback(() => {
    watch.current?.disconnect();
    watch.current = null;
  }, []);
  useEffect(() => stop, [stop]);
  const mark = useCallback(() => {
    stop();
    const box = ref.current;
    if (!box) return;
    const rowKey = (el: HTMLElement) => el.id || el;
    const shown = new Set([...box.querySelectorAll<HTMLElement>(rowSelector)].map(rowKey));
    const from = scopeRef.current;
    const pressed = document.activeElement;
    const observer = new MutationObserver(() => {
      if (scopeRef.current !== from) return stop();
      const row = [...box.querySelectorAll<HTMLElement>(rowSelector)].find((el) => !shown.has(rowKey(el)));
      if (!row) {
        const again = pressed instanceof HTMLButtonElement && !pressed.isConnected ? box.querySelector<HTMLButtonElement>("button.retry") : null;
        if (again) {
          stop();
          again.focus();
        }
        return;
      }
      stop();
      const target = row.hasAttribute("tabindex") || row.matches("a[href], button") ? row : row.querySelector<HTMLElement>("a[href], button");
      (target ?? row).focus();
    });
    observer.observe(box, { childList: true, subtree: true });
    watch.current = observer;
  }, [rowSelector, stop]);
  return { ref, mark };
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/** 머리 줄. left가 없으면 상표(Tidwyn)를 보인다 */
export function TopBar({ left, center }: { left?: ReactNode; center?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <header
      className="bar"
      onBlur={(e) => {
        // Tab으로 메뉴 밖에 나가면 닫는다. 창 밖으로 나갈 때는 relatedTarget이 없어 그대로 둔다
        if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <a
        className="skip"
        href="#main"
        onClick={(e) => {
          // 라우터의 해시 처리를 거치지 않고 포커스만 옮긴다
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        {SKIP_LABEL}
      </a>
      <div className="bar-row">
        <div className="bar-left">
          {left ?? (
            <Link to="/" className="brand">
              Tidwyn
            </Link>
          )}
        </div>
        {center && <div className="bar-center">{center}</div>}
        <div className="icons">
          <Link to="/search" className="icon-btn" aria-label="검색">
            <SearchIcon />
          </Link>
          <button ref={btnRef} type="button" className="icon-btn" aria-label="메뉴" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((v) => !v)}>
            <MenuIcon />
          </button>
        </div>
      </div>
      {open && (
        <div ref={menuRef} id="site-menu" className="menu">
          <nav aria-label="사이트 메뉴">
            <ul>
              {MENU.map(([to, label]) => (
                <li key={to}>
                  <Link to={to}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
    </header>
  );
}

/** 되돌아가기 '‹ 이름'. onClick이 기본 이동을 막으면(preventDefault) 그쪽이 이동을 맡는다 */
export function BackLink({ to, label, onClick }: { to: string; label: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => void }) {
  return (
    <Link to={to} className="datebtn back" onClick={onClick}>
      <BackMark />
      {label}
    </Link>
  );
}

/**
 * 브리프가 아닌 화면의 되돌아가기 '‹ 브리프'(U1 4.4-1·3, S1·S2). 바로 앞 기록이 들어온 그 브리프면 기록을 되돌려 탭·펼친 카드·칩·스크롤을 되살리고,
 * 아니면 들어온 날짜·탭의 브리프로 간다(모르면 fallback, 그것도 없으면 최근 브리프). 들어온 브리프는 history.state에만 있다(S8)
 */
export function BriefBackLink({ fallback }: { fallback?: { date: string; latestDate: string | null } }) {
  const loc = useLocation();
  const r = resolveBriefBack({ state: loc.state, fallback });
  return (
    <BackLink
      to={r.to}
      label={r.label}
      onClick={(e) => {
        if (!isPlainClick(e)) return;
        e.preventDefault();
        if (r.back) goBack();
        else navigate(r.to, r.tab ? { state: { brief: { tab: r.tab } } } : {});
      }}
    />
  );
}

let carryMainFocus = false;

/** 본문 영역. 대기와 정상 화면이 서로 다른 main이어도 main에 있던 포커스를 새 main으로 넘긴다(앱 안 이동, 다시 시도) */
export function Main({ className, children }: { className: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (carryMainFocus) el?.focus({ preventScroll: true });
    carryMainFocus = false;
    return () => {
      carryMainFocus = document.activeElement === el;
    };
  }, []);
  return (
    <main ref={ref} id="main" tabIndex={-1} className={className}>
      {children}
    </main>
  );
}

/** 머리 줄 + 본문 + 바닥글. 대기·오류·빈 상태 화면과 단순한 화면이 쓴다 */
export function Layout({ left, center, children }: { left?: ReactNode; center?: ReactNode; children: ReactNode }) {
  return (
    <>
      <TopBar left={left} center={center} />
      <Main className="page">{children}</Main>
      <Footer />
    </>
  );
}

/** 바닥글(7단계: 동의 문구와 개인정보 처리방침 링크, components/policyView.ts) */
export function Footer() {
  return <FooterView Link={Link} />;
}

export const VIDEO_LOAD_ERROR = "영상을 불러오지 못했다. 네트워크를 확인하고 다시 시도해 주세요.";

/** 영상 파일을 기다리는 대기 표시. 올 줄 수만큼 자리를 잡는다 */
export function VideoLoading({ rows }: { rows: number }) {
  return (
    <div className="vwait" style={{ "--rows": rows } as CSSProperties}>
      <Loading />
    </div>
  );
}

export function Loading({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

export function ErrorState({ onRetry, message = "데이터를 불러오지 못했다. 네트워크를 확인하고 다시 시도해 주세요." }: { onRetry: () => void; message?: string }) {
  return (
    <div className="state error" role="alert">
      <p>{message}</p>
      <button
        type="button"
        className="retry"
        onClick={() => {
          // 버튼이 사라져도 포커스가 문서 처음으로 돌아가지 않게 본문에 둔다
          document.getElementById("main")?.focus({ preventScroll: true });
          onRetry();
        }}
      >
        다시 시도
      </button>
    </div>
  );
}

export { Empty } from "./emptyView.ts";

/** 4.5단계 '전체' 탭에서 줄마다 보이는 섹션 표시(한국·세계·IT·AI). 누를 수 없어 면 없이 글자로 쓴다(U1 4.2-2) */
export function SectionChip({ section }: { section: string }) {
  return <span className="sec">{section}</span>;
}

export function CategoryLine({ major, minor, extra, isNewMinor, section }: { major: Major; minor: string; extra?: string; isNewMinor?: boolean; section?: string }) {
  return (
    <div className="cat" style={{ color: categoryVar(major) }}>
      {section && <SectionChip section={section} />}
      {major} · {minor}
      {isNewMinor ? " (새 소분류)" : ""}
      {extra ? ` · ${extra}` : ""}
    </div>
  );
}

/**
 * 가로 스크롤 줄의 마지막 칩이 오른쪽 끝에 잘리는 동안 `data-more`를 둔다(U2 S11). 스타일이 줄 오른쪽 끝을 흐리게 해,
 * 칩 사이 틈이 줄 끝에 걸려 일부만 보이는 칩이 없는 폭에서도 다음 칩이 있다는 것이 보인다.
 * 끝 여백(padding)만 넘치는 것은 더 있는 칩이 아니므로, 넘침 폭이 아니라 마지막 칩의 자리로 잰다. 칩이 바뀔 수 있어 그릴 때마다 다시 잰다
 */
/** 키보드로 간 포커스인지. `:focus-visible`을 모르는 브라우저(iOS Safari 15.3 이하)에서는 거짓 */
function focusVisible(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return false;
  }
}

function useMoreMark(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const last = el.lastElementChild;
      el.toggleAttribute("data-more", !!last && last.getBoundingClientRect().right > el.getBoundingClientRect().right + 1);
    };
    update();
    const stop = observeWidth(el, update);
    // 키보드로 간 칩을 흐린 끝 앞으로 가져온다(브라우저의 포커스 스크롤은 scroll-padding을 따르지 않는다). 마우스로 누를 때는 줄을 밀지 않는다(누르는 동안 칩이 움직이면 눌리지 않는다)
    const reveal = (ev: Event) => {
      const target = ev.target as HTMLElement;
      if (focusVisible(target)) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    el.addEventListener("scroll", update, { passive: true });
    el.addEventListener("focusin", reveal);
    return () => {
      stop();
      el.removeEventListener("scroll", update);
      el.removeEventListener("focusin", reveal);
    };
  });
}

/**
 * 칩 고르기(카테고리·상태·종류 거르기). value가 null이면 첫 칩. after는 칩 줄 끝에 구분선 뒤로 붙는다(4.5단계 '안 읽은 것만').
 * U2 4.3: 칩은 지금 목록에 있는 값만(options, lib/chips.ts가 만든다) 건수와 함께 보이고, 첫 칩은 allText와 전체 건수다.
 * value가 options에 없으면 첫 칩이 골라진 것으로 보인다(부르는 쪽이 keptChip으로 상태도 돌린다)
 */
export function ChipFilter<T extends string>({ label, allText, total, totalKnown = true, options, value, onChange, after }: { label: string; allText: string; total: number; totalKnown?: boolean; options: readonly ChipOption<T>[]; value: T | null; onChange: (v: T | null) => void; after?: ReactNode }) {
  const picked = keptChip(value, options);
  const ref = useRef<HTMLDivElement>(null);
  useMoreMark(ref);
  return (
    <div ref={ref} className="chips" role="group" aria-label={label}>
      <button type="button" className={picked === null ? "on" : ""} aria-pressed={picked === null} onClick={() => onChange(null)}>
        {totalKnown ? countLabel(allText, total) : allText}
      </button>
      {options.map((o) => (
        <button key={o.value} type="button" className={picked === o.value ? "on" : ""} aria-pressed={picked === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
      {after && (
        <>
          <span className="chip-sep" aria-hidden="true" />
          {after}
        </>
      )}
    </div>
  );
}

/** 켬·끔 칩 하나(칩 줄 안에서 쓴다) */
export function ToggleChip({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: ReactNode }) {
  return (
    <button type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => onChange(!on)}>
      {children}
    </button>
  );
}

// 4.5단계 읽음 표시(M3, M4). 모든 뉴스 목록이 이 세 가지를 같이 쓴다.

/** 뉴스 제목. 안 읽었으면 굵게, 읽었으면 같은 색의 보통 굵기 */
export function NewsTitle({ date, newsKey, className, children }: { date: string; newsKey: string; className?: string; children: ReactNode }) {
  const read = useIsRead(date, newsKey);
  return <span className={`${className ? `${className} ` : ""}nt ${read ? "read" : "unread"}`}>{children}</span>;
}

/** 브리프 밖 목록의 줄 끝 체크. 읽은 뉴스에만 보이고 보조 기술에는 "읽음"으로 읽힌다 */
export function ReadCheck({ date, newsKey }: { date: string; newsKey: string }) {
  const read = useIsRead(date, newsKey);
  if (!read) return null;
  return (
    <span className="read-mk">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">읽음</span>
    </span>
  );
}

/** 브리프의 읽음 버튼(토글, M2). 보이는 동그라미 18px, 누르는 자리 44px */
export function ReadToggle({ date, newsKey, title }: { date: string; newsKey: string; title: string }) {
  const read = useIsRead(date, newsKey);
  return (
    <button type="button" className={read ? "rd-btn on" : "rd-btn"} aria-pressed={read} aria-label={`읽음: ${title}`} onClick={() => readStore.setRead(date, newsKey, !read)}>
      <i aria-hidden="true">✓</i>
    </button>
  );
}

export const ALL_MAJORS: readonly Major[] = MAJORS;
