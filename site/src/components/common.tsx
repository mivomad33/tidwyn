// 여러 화면이 함께 쓰는 컴포넌트(시안 A의 머리 줄, 칩, 분류 줄, 대기·오류 상태)
import { useEffect, useRef, useState, type ReactNode } from "react";
import { MAJORS } from "../../../src/categories.ts";
import { pageTitle } from "../lib/format.ts";
import { categoryVar } from "../lib/theme.ts";
import type { Major } from "../lib/types.ts";
import { Link, useLocation } from "../router.tsx";

export function useTitle(label: string | undefined): void {
  useEffect(() => {
    document.title = pageTitle(label);
  }, [label]);
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

export function Footer() {
  return (
    <footer className="footer">
      <p>Tidwyn · AI가 매일 모아 바꿔 쓴 뉴스 요약</p>
      <nav aria-label="바닥 메뉴">
        <Link to="/about">사이트 소개</Link>
        <Link to="/issues">이슈 목록</Link>
        <Link to="/dates">날짜 목록</Link>
      </nav>
    </footer>
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
      <button type="button" className="retry" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="state empty">{children}</p>;
}

export function CategoryLine({ major, minor, extra, isNewMinor }: { major: Major; minor: string; extra?: string; isNewMinor?: boolean }) {
  return (
    <div className="cat" style={{ color: categoryVar(major) }}>
      {major} · {minor}
      {isNewMinor ? " (새 소분류)" : ""}
      {extra ? ` · ${extra}` : ""}
    </div>
  );
}

/** 칩 고르기(카테고리·상태 필터). value가 null이면 "전체" */
export function ChipFilter<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T | null; onChange: (v: T | null) => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      <button type="button" className={value === null ? "on" : ""} aria-pressed={value === null} onClick={() => onChange(null)}>
        전체
      </button>
      {options.map((o) => (
        <button key={o} type="button" className={value === o ? "on" : ""} aria-pressed={value === o} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export const ALL_MAJORS: readonly Major[] = MAJORS;
