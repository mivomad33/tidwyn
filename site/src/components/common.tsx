// 여러 화면이 함께 쓰는 컴포넌트(시안 A의 머리 줄, 칩, 분류 줄, 대기·오류 상태, 4.5단계 읽음 표시)
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { MAJORS } from "../../../src/categories.ts";
import { pageTitle } from "../lib/format.ts";
import { categoryVar } from "../lib/theme.ts";
import { FooterView } from "./policyView.ts";
import type { Major } from "../lib/types.ts";
import { readStore, useIsRead } from "../readMarks.ts";
import { Link, useLocation } from "../router.tsx";

export function useTitle(label: string | undefined): void {
  useEffect(() => {
    document.title = pageTitle(label);
  }, [label]);
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

const MENU: [string, string][] = [
  ["/", "최근 브리프"],
  ["/dates", "날짜 목록"],
  ["/issues", "이슈 목록"],
  ["/schedules", "일정"],
  ["/indicators", "지표"],
  ["/entities", "인물·기관·국가"],
  ["/terms", "용어 사전"],
  ["/search", "검색"],
  ["/about", "사이트 소개"],
];

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
    <header className="bar">
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

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="datebtn back">
      <span aria-hidden="true">‹ </span>
      {label}
    </Link>
  );
}

/** 머리 줄 + 본문 + 바닥글. 대기·오류·빈 상태 화면과 단순한 화면이 쓴다 */
export function Layout({ left, center, children }: { left?: ReactNode; center?: ReactNode; children: ReactNode }) {
  return (
    <>
      <TopBar left={left} center={center} />
      <main id="main" tabIndex={-1} className="page">
        {children}
      </main>
      <Footer />
    </>
  );
}

/** 바닥글(7단계: 동의 문구와 개인정보 처리방침 링크, components/policyView.ts) */
export function Footer() {
  return <FooterView Link={Link} />;
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
      <button type="button" className="retry" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="state empty">{children}</p>;
}

/** 4.5단계 '전체' 탭에서 줄마다 보이는 섹션 칩(한국·세계·IT·AI) */
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
 * 칩 고르기(카테고리·상태 필터). value가 null이면 "전체". after는 칩 줄 끝에 구분선 뒤로 붙는다(4.5단계 '안 읽은 것만').
 * labelOf가 있으면 칩 글자를 그것으로 보인다(7단계 영상 묶음 칩의 "한국 3")
 */
export function ChipFilter<T extends string>({ label, options, value, onChange, after, labelOf }: { label: string; options: readonly T[]; value: T | null; onChange: (v: T | null) => void; after?: ReactNode; labelOf?: (v: T) => string }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      <button type="button" className={value === null ? "on" : ""} aria-pressed={value === null} onClick={() => onChange(null)}>
        전체
      </button>
      {options.map((o) => (
        <button key={o} type="button" className={value === o ? "on" : ""} aria-pressed={value === o} onClick={() => onChange(o)}>
          {labelOf ? labelOf(o) : o}
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
