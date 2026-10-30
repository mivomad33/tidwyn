// 7단계 추천 영상의 화면 로직(4.7, 확정 시안 design/site.html): 30일 숨기기(V14), 묶음 칩, 길이 글자, YouTube 주소, 이슈 페이지의 순서와 더 보기.
// 화면(DOM) 없이 테스트한다. "오늘"은 부르는 쪽이 넣는다(방문자 브라우저의 오늘, KST).
import { addDays } from "../../../src/kst.ts";
import { VIDEO_BUNDLES, VIDEO_KEEP_DAYS, type IssueVideo, type SiteVideo, type VideoBundle } from "../../../src/siteTypes.ts";
import { monthDay } from "./format.ts";

export { VIDEO_BUNDLES, VIDEO_KEEP_DAYS, type VideoBundle };

/** 브리프 섹션 탭 끝의 영상 탭 */
export const VIDEO_TAB = "영상";
/** 이슈 페이지의 '관련 영상'에 처음 보이는 수(나머지는 '더 보기') */
export const ISSUE_VIDEO_FIRST = 5;

export const YOUTUBE_TERMS_URL = "https://www.youtube.com/t/terms";
export const YOUTUBE_TERMS_LABEL = "YouTube 이용약관";
/** Google 개인정보처리방침(정책 III.A.2.c가 가리키는 주소 그대로) */
export const GOOGLE_PRIVACY_URL = "http://www.google.com/policies/privacy";
export const GOOGLE_PRIVACY_LABEL = "Google 개인정보처리방침";

/** 영상 탭 칩: 전체(null) · 한국 · 미국 · AI(AI 한국어와 영어를 함께) */
export type VideoChip = "kr" | "us" | "ai";
export const VIDEO_CHIPS: readonly VideoChip[] = ["kr", "us", "ai"];
const CHIP_LABEL: Record<VideoChip, string> = { kr: "한국", us: "미국", ai: "AI" };
const BUNDLE_LABEL: Record<VideoBundle, string> = { kr: "한국", us: "미국", "ai-ko": "AI · 한국어", "ai-en": "AI · 영어" };

export function chipOf(bundle: VideoBundle): VideoChip {
  return bundle === "ai-ko" || bundle === "ai-en" ? "ai" : bundle;
}

/** 영상 줄의 묶음 표시(AI는 언어를 붙인다) */
export function bundleLabel(bundle: VideoBundle): string {
  return BUNDLE_LABEL[bundle];
}

/** 받은 날(KST)부터 오늘까지 30일이 지나지 않았는지. 날짜가 깨졌으면 보이지 않는다 */
export function isVideoVisible(video: Pick<SiteVideo, "fetchedOn">, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(video.fetchedOn)) return false;
  return addDays(video.fetchedOn, VIDEO_KEEP_DAYS) > today;
}

/** 브리프 영상 탭에 보일 영상: 30일 안의 것만, 한국 → 미국 → AI 한국어 → AI 영어 순(묶음 안은 받은 순서 그대로) */
export function visibleVideos<T extends SiteVideo>(videos: readonly T[] | undefined, today: string): T[] {
  const shown = (videos ?? []).filter((v) => isVideoVisible(v, today));
  return shown.map((v, i) => ({ v, i })).sort((a, b) => VIDEO_BUNDLES.indexOf(a.v.bundle) - VIDEO_BUNDLES.indexOf(b.v.bundle) || a.i - b.i).map((x) => x.v);
}

export interface ChipCount {
  chip: VideoChip;
  label: string;
  count: number;
}

/** 보이는 영상의 칩(0개인 묶음은 빼고, 한국 · 미국 · AI 순). 칩 글자는 "한국 3"처럼 수를 붙인다 */
export function videoChips(videos: readonly SiteVideo[]): ChipCount[] {
  return VIDEO_CHIPS.map((chip) => {
    const count = videos.filter((v) => chipOf(v.bundle) === chip).length;
    return { chip, label: `${CHIP_LABEL[chip]} ${count}`, count };
  }).filter((c) => c.count > 0);
}

/** 고른 칩의 영상(null이면 전체) */
export function filterVideos<T extends SiteVideo>(videos: readonly T[], chip: VideoChip | null): T[] {
  return chip === null ? [...videos] : videos.filter((v) => chipOf(v.bundle) === chip);
}

/** 영상 탭 이름: "영상 N" */
export function videoTabLabel(count: number): string {
  return `${VIDEO_TAB} ${count}`;
}

/** YouTube 영상 페이지 주소(V8) */
export function videoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

/** 썸네일 위 길이: "44:12", 한 시간이 넘으면 "1:05:03" */
export function durationClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** 정보 줄의 길이: "44분", 한 시간이 넘으면 "1시간 5분"(정각이면 "2시간") */
export function durationText(seconds: number): string {
  const m = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(m / 60);
  if (!h) return `${m}분`;
  return m % 60 ? `${h}시간 ${m % 60}분` : `${h}시간`;
}

/** 이슈 페이지 줄의 "M월 D일 추천"(붙은 브리프 날짜) */
export function recommendedOnText(date: string): string {
  return `${monthDay(date)} 추천`;
}

/**
 * 이슈 페이지의 '관련 영상': 30일 안의 것만, 붙은 브리프 날짜 최근 순(같은 날짜는 받은 순서 그대로), 같은 영상은 한 번.
 * 처음에는 ISSUE_VIDEO_FIRST개만 보이고 나머지 수를 more로 준다
 */
export function issueVideoRows(videos: readonly IssueVideo[] | undefined, today: string, expanded = false): { rows: IssueVideo[]; more: number } {
  const seen = new Set<string>();
  const all = (videos ?? [])
    .filter((v) => isVideoVisible(v, today))
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (a.v.date !== b.v.date ? (a.v.date < b.v.date ? 1 : -1) : a.i - b.i))
    .map((x) => x.v)
    .filter((v) => (seen.has(v.id) ? false : (seen.add(v.id), true)));
  if (expanded || all.length <= ISSUE_VIDEO_FIRST) return { rows: all, more: 0 };
  return { rows: all.slice(0, ISSUE_VIDEO_FIRST), more: all.length - ISSUE_VIDEO_FIRST };
}
