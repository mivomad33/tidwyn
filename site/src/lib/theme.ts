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
  /** 4.5단계: 읽음 표시(채운 동그라미, 체크)의 파랑 */
  check: string;
  /** 4.5단계: 채운 동그라미 안 체크 글자 */
  checkInk: string;
  /** 4.5단계: 안 읽음 동그라미의 연한 테두리(대비 기준보다 연하다, M3에서 감수) */
  ring: string;
  /** 6단계: 지표가 오르면 빨강, 내리면 파랑(국내 관례, X8) */
  up: string;
  down: string;
  /** 6단계: 그래프 선. 이슈 그래프의 뉴스 점과 고른 값 표시는 강조색(accent)이다 */
  plot: string;
  /** 9.5단계: 강조색 면 위의 글자(없는 페이지의 주 버튼) */
  onAccent: string;
  /** 7단계: 썸네일 자리(이미지를 불러오지 못했을 때 보이는 빈 상자) */
  thumb: string;
  /** 7단계: 썸네일 위 길이 표시의 글자와 바탕(이미지 위에 놓여 이미지와 관계없이 읽히게 불투명하다) */
  durFg: string;
  durBg: string;
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
  check: "#3b7fd0",
  checkInk: "#ffffff",
  ring: "#d1d1d6",
  up: "#c62828",
  down: "#1d4ed8",
  plot: "#1d1d1f",
  onAccent: "#ffffff",
  thumb: "#d9d9de",
  durFg: "#ffffff",
  durBg: "#1d1d1f",
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
  check: "#6aa5ec",
  checkInk: "#161618",
  ring: "#3a3a3f",
  up: "#f87171",
  down: "#7aa7ff",
  plot: "#ececee",
  onAccent: "#161618",
  thumb: "#34343a",
  durFg: "#ffffff",
  durBg: "#000000",
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
  const base = `--bg:${p.bg};--fg:${p.fg};--muted:${p.muted};--line:${p.line};--chip:${p.chip};--accent:${p.accent};--accentbg:${p.accentbg};--check:${p.check};--check-ink:${p.checkInk};--ring:${p.ring};--up:${p.up};--down:${p.down};--plot:${p.plot};--on-accent:${p.onAccent};--thumb:${p.thumb};--dur-fg:${p.durFg};--dur-bg:${p.durBg};`;
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
    // 4단계: 펼친 카드에서 누른 용어 낱말(강조 바탕 위 본문 글자)
    { name: "강조된 낱말", fg: p.fg, bg: p.accentbg },
  ];
  for (const m of MAJORS) pairs.push({ name: `분류 ${m}`, fg: p.categories[m], bg: p.bg });
  // 5단계: 일정 주소로 강조된 일정 줄(강조 바탕), 달 단위 "날짜 미정" 상자(상자 바탕), 달력의 고른 날
  pairs.push({ name: "흐린 글자/강조된 일정", fg: p.muted, bg: p.accentbg }, { name: "고른 날짜", fg: p.bg, bg: p.fg });
  for (const m of MAJORS) pairs.push({ name: `분류 ${m}/강조된 일정`, fg: p.categories[m], bg: p.accentbg }, { name: `분류 ${m}/상자`, fg: p.categories[m], bg: p.chip });
  // 6단계: 지표의 오름·내림 글자(카드·페이지는 바탕, 브리프 위 상자의 칩은 상자 바탕)
  pairs.push({ name: "오름", fg: p.up, bg: p.bg }, { name: "오름/상자", fg: p.up, bg: p.chip }, { name: "내림", fg: p.down, bg: p.bg }, { name: "내림/상자", fg: p.down, bg: p.chip });
  // 7단계: 영상 줄의 묶음 표시, 정보 줄(채널·길이), 추천 이유 상자(글자와 '추천 이유' 머리), 썸네일 위 길이, 출처 줄
  pairs.push(
    { name: "영상 묶음 표시", fg: p.accent, bg: p.accentbg },
    { name: "영상 정보 줄", fg: p.muted, bg: p.bg },
    { name: "추천 이유", fg: p.fg, bg: p.chip },
    { name: "추천 이유 머리", fg: p.accent, bg: p.chip },
    { name: "영상 길이", fg: p.durFg, bg: p.durBg },
    { name: "영상 출처 줄", fg: p.muted, bg: p.bg },
    // 8단계: '요약 보기' 버튼과 펼친 요약
    { name: "요약 버튼", fg: p.accent, bg: p.bg },
    { name: "영상 요약", fg: p.fg, bg: p.chip },
    // 9.5단계: 정정 표시, 짧은 소식의 사유, 제보 링크, 메일 상자, 없는 페이지의 주 버튼
    { name: "정정 표시", fg: p.fg, bg: p.bg },
    { name: "짧은 소식 사유", fg: p.muted, bg: p.bg },
    { name: "제보 링크", fg: p.muted, bg: p.bg },
    { name: "메일 상자 주소", fg: p.accent, bg: p.chip },
    { name: "주 버튼", fg: p.onAccent, bg: p.accent },
  );
  return pairs;
}

/** 4.5단계: 아이콘(읽음 체크) 색 × 바탕 색. WCAG 1.4.11(3:1) 기준. 안 읽음 테두리(ring)는 M3에서 감수해 넣지 않는다 */
export function iconPairs(p: Palette): { name: string; fg: string; bg: string }[] {
  return [
    { name: "읽음 체크(목록)", fg: p.check, bg: p.bg },
    { name: "읽음 체크(상자)", fg: p.check, bg: p.chip },
    { name: "채운 동그라미/바탕", fg: p.check, bg: p.bg },
    { name: "동그라미 안 체크", fg: p.checkInk, bg: p.check },
    // 6단계: 그래프 선(카드의 작은 그래프 포함)과 이슈 뉴스 점·고른 값 점(강조색)
    { name: "그래프 선", fg: p.plot, bg: p.bg },
    { name: "그래프 점", fg: p.accent, bg: p.bg },
  ];
}
