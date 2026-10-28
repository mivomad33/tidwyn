// 색 토큰(확정 시안 A, P13). 라이트·다크 두 벌이고 기기 설정을 따른다.
// 대분류 색 중 경제·정치·사회·국제는 시안 그대로, 나머지는 같은 밝기대로 정했다. 대비는 테스트가 WCAG AA(4.5:1)로 본다.
import { MAJORS } from "../../../src/categories.ts";
import type { Major } from "./types.ts";

export interface Palette {
  bg: string;
  fg: string;
  muted: string;
  line: string;
  chip: string;
  accent: string;
  accentbg: string;
  categories: Record<Major, string>;
}

export const LIGHT: Palette = {
  bg: "#ffffff",
  fg: "#1d1d1f",
  muted: "#6b6b70",
  line: "#ececee",
  chip: "#f5f5f7",
  accent: "#c2410c",
  accentbg: "#fff1e8",
  categories: {
    "정치": "#7c3aed",
    "경제": "#c2410c",
    "사회": "#0f766e",
    "국제": "#b91c1c",
    "IT·AI": "#1d4ed8",
    "과학·건강": "#15803d",
    "문화·스포츠": "#be185d",
  },
};

export const DARK: Palette = {
  bg: "#161618",
  fg: "#ececee",
  muted: "#9a9aa0",
  line: "#2a2a2e",
  chip: "#222226",
  accent: "#fb923c",
  accentbg: "#3a2414",
  categories: {
    "정치": "#a78bfa",
    "경제": "#fb923c",
    "사회": "#2dd4bf",
    "국제": "#f87171",
    "IT·AI": "#60a5fa",
    "과학·건강": "#4ade80",
    "문화·스포츠": "#f472b6",
  },
};

export function categoryVar(major: Major): string {
  return `var(--cat-${Math.max(0, MAJORS.indexOf(major))})`;
}

function vars(p: Palette): string {
  const base = `--bg:${p.bg};--fg:${p.fg};--muted:${p.muted};--line:${p.line};--chip:${p.chip};--accent:${p.accent};--accentbg:${p.accentbg};`;
  return base + MAJORS.map((m, i) => `--cat-${i}:${p.categories[m]};`).join("");
}

/** 화면 틀에 넣을 색 변수 CSS */
export function themeCss(): string {
  return `:root{color-scheme:light dark;${vars(LIGHT)}}@media (prefers-color-scheme: dark){:root{${vars(DARK)}}}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

/** WCAG 대비(1~21) */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** 글자 색 × 바탕 색 조합(화면에 실제로 쓰는 것) */
export function textPairs(p: Palette): { name: string; fg: string; bg: string }[] {
  const pairs = [
    { name: "본문", fg: p.fg, bg: p.bg },
    { name: "본문/상자", fg: p.fg, bg: p.chip },
    { name: "흐린 글자", fg: p.muted, bg: p.bg },
    { name: "흐린 글자/상자", fg: p.muted, bg: p.chip },
    { name: "강조", fg: p.accent, bg: p.bg },
    { name: "강조/상자", fg: p.accent, bg: p.chip },
    { name: "표시", fg: p.accent, bg: p.accentbg },
    { name: "고른 칩", fg: p.bg, bg: p.fg },
  ];
  for (const m of MAJORS) pairs.push({ name: `분류 ${m}`, fg: p.categories[m], bg: p.bg });
  return pairs;
}
