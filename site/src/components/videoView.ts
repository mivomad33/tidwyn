// B2 영상 탭의 영상 목록(4.3-2, 4.3-3). 앱의 영상 탭과 정적 HTML의 영상 구역이 같은 부품을 쓴다.
// 굵은 제목 '이번 주 볼만한 영상', 항목(썸네일과 그 오른쪽 아래 길이 · 제목 링크 · 분야·채널·조회수·업로드 때 줄), 또는 상태별 빈 상태 문구.
// 항목 전체가 제목 링크의 누를 자리다(마우스를 올려도 바탕은 바뀌지 않는다, 2026-11-27 사용자 결정).
// 썸네일은 앱에서만 그린다(정적 HTML에는 이미지를 넣지 않는다, R7). 썸네일을 받지 못하면 빈 자리만 남는다.
import { createElement as h, Fragment, type ReactNode, type SyntheticEvent } from "react";
import type { DayVideoItem, DayVideos } from "../lib/types.ts";
import { Empty } from "./emptyView.ts";
import { dateText } from "../lib/format.ts";
import { kstDate } from "../../../src/kst.ts";

/** 목록 머리 제목 */
export const VIDEO_HEADING = "이번 주 볼만한 영상";
/** '새 영상 없음' */
export const VIDEO_NONE_TEXT = "이 날에는 새로 실을 영상이 없습니다.";
/** '받지 못함' */
export const VIDEO_FAILED_TEXT = "이 날에는 영상을 준비하지 못했습니다.";

/** 영상 주소(새 탭으로 연다) */
export function videoUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
}

/** 썸네일 고정 주소(V6). 개발용으로 바꾸는 선택지는 두지 않는다 */
export function thumbUrl(id: string): string {
  return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/mqdefault.jpg`;
}

/** 조회수 어림 표기('조회수'를 앞에 붙이지 않는다, 2026-11-26 사용자 결정): 1만 아래는 그대로, 1억 아래는 만, 그 위는 억(10 아래면 소수 한 자리) */
export function viewsText(views: number): string {
  const unit = (n: number, u: string) => `${n < 10 ? (Math.floor(n * 10) / 10).toLocaleString("ko-KR") : Math.floor(n).toLocaleString("ko-KR")}${u}`;
  if (views < 10_000) return `${views.toLocaleString("ko-KR")}회`;
  if (views < 100_000_000) return `${unit(views / 10_000, "만")}회`;
  return `${unit(views / 100_000_000, "억")}회`;
}

/** 길이 표기: 한 시간 넘으면 시:분:초, 아니면 분:초 */
export function durationText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const two = (n: number) => String(n).padStart(2, "0");
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return hh > 0 ? `${hh}:${two(mm)}:${two(s % 60)}` : `${mm}:${two(s % 60)}`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 이보다 오래되면 상대 시간 대신 날짜로 쓴다 */
const RELATIVE_LIMIT_MS = 7 * DAY_MS;

/**
 * 업로드 때(2026-11-26 사용자 결정): 지금 보는 시각 기준 '20분 전'·'5시간 전'·'3일 전'(유튜브처럼), 7일을 넘으면 한국 시간 날짜 '11월 23일'(보는 해와 다르면 '2025년 11월 23일').
 * 업로드 시각은 원천의 추정값이라 정밀도보다 잘게 쓰지 않는다(날 단위면 'N일 전'만, 시간 단위면 'N시간 전'까지)
 */
export function uploadText(uploadAt: string, precisionSec: number, now: number): string {
  const up = Date.parse(uploadAt);
  const elapsed = now - up;
  // 보는 해와 다르면 해를 붙인다(C9)
  if (elapsed > RELATIVE_LIMIT_MS) return dateText(kstDate(new Date(up)), kstDate(new Date(now)).slice(0, 4));
  const n = (unit: number) => Math.max(1, Math.floor(elapsed / unit));
  if (precisionSec < 3600 && elapsed < HOUR_MS) return `${n(MINUTE_MS)}분 전`;
  if (precisionSec < 86400 && elapsed < DAY_MS) return `${n(HOUR_MS)}시간 전`;
  return `${n(DAY_MS)}일 전`;
}

/** 썸네일을 받지 못하면(대체 그림도 아래 hideMissing) 이미지를 숨긴다(빈 자리만 남고 깨진 이미지 표시가 없다) */
function hideImage(e: SyntheticEvent<HTMLImageElement>) {
  // 이 파일은 정적 HTML(DOM 타입 없는 tsconfig)에서도 읽혀 쓰는 모양만 적는다
  (e.currentTarget as unknown as { hidden: boolean }).hidden = true;
}

/** YouTube 대체 그림의 폭. 없는 영상(지워짐 등)이면 썸네일 주소가 실패 대신 120×90 회색 그림을 돌려준다(받은 mqdefault는 320×180) */
const MISSING_THUMB_WIDTH = 120;

/** 받은 그림이 대체 그림이면 받지 못한 것과 같게 숨긴다 */
function hideMissing(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget as unknown as { hidden: boolean; naturalWidth: number };
  if (img.naturalWidth <= MISSING_THUMB_WIDTH) img.hidden = true;
}

function VideoItem({ item, level, showCategory, thumbs, now }: { item: DayVideoItem; level: "h3" | "h4" | "h5"; showCategory: boolean; thumbs: boolean; now: number | null }) {
  const duration = durationText(item.duration);
  // 길이는 썸네일이 있으면 썸네일 오른쪽 아래 상자에(유튜브처럼, 2026-11-26 사용자 결정. 화면 낭독은 정보 줄의 숨은 글로), 없으면 정보 줄 끝에 쓴다
  const meta = [...(showCategory ? [item.category] : []), item.channel, viewsText(item.views), ...(now === null ? [] : [uploadText(item.uploadAt, item.uploadPrecision, now)]), ...(thumbs ? [] : [duration])];
  return h(
    "li",
    { className: thumbs ? "video" : "video no-thumb" },
    // 썸네일 칸은 크기를 미리 잡아(16:9) 받기 전후에 화면이 튀지 않는다. 제목 링크가 바로 옆에 있어 alt는 비운다
    thumbs
      ? h(
          "span",
          { className: "video-thumb" },
          h("img", { src: thumbUrl(item.id), alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", width: 320, height: 180, onError: hideImage, onLoad: hideMissing }),
          h("span", { className: "video-dur", "aria-hidden": true }, duration),
        )
      : null,
    h(
      "div",
      { className: "video-body" },
      h(level, { className: "video-title" }, h("a", { href: videoUrl(item.id), className: "video-link", target: "_blank", rel: "noopener noreferrer" }, item.title, h("span", { className: "sr-only" }, " (새 탭)"))),
      h("p", { className: "video-meta" }, meta.join(" · "), thumbs ? h("span", { className: "sr-only" }, ` · 길이 ${duration}`) : null),
    ),
  );
}

/** '모든 분야'의 순서: 분야를 섞어 하루 평균 조회수 순(같으면 분야 순서·분야 안 순위 순 그대로, 2026-11-27 사용자 결정) */
export function byDailyViews(items: readonly DayVideoItem[]): DayVideoItem[] {
  return [...items].sort((a, b) => b.dailyViews - a.dailyViews);
}

/** 항목에 나오는 분야의 순서(항목은 이미 분야 순서·분야 안 순위 순이다) */
export function videoCategoryOrder(items: readonly DayVideoItem[]): string[] {
  return [...new Set(items.map((i) => i.category))];
}

/**
 * 그날 영상 기록의 상태와 보일 항목(분야 순서·분야 안 순위 순). 실음인데 항목이 없으면 '새 영상 없음'과 같게 보인다.
 * '모든 분야'(showCategory)는 분야를 섞어 하루 평균 조회수 순이다. now(보는 시각)가 있으면 업로드 때를 쓴다(앱만. 정적 HTML은 보는 시각을 몰라 쓰지 않는다). grouped면 분야마다 제목을 두고(정적 HTML), 아니면 한 목록이며 showCategory면 항목에 분야를 쓴다('모든 분야').
 */
export function VideoList({ status, items, headingLevel, thumbs, grouped = false, showCategory = false, filter = null, now = null }: { status: DayVideos["status"]; items: readonly DayVideoItem[]; headingLevel: "h2" | "h3"; thumbs: boolean; grouped?: boolean; showCategory?: boolean; filter?: ReactNode; now?: number | null }) {
  const level = headingLevel === "h2" ? "h3" : "h4";
  // 분야 제목을 두면 항목 제목은 그 한 단계 아래다
  const itemLevel = grouped ? (level === "h3" ? "h4" : "h5") : level;
  const list = (xs: readonly DayVideoItem[], cat: boolean) => h("ol", { className: "list videos" }, xs.map((item) => h(VideoItem, { key: item.id, item, level: itemLevel, showCategory: cat, thumbs, now })));
  const shown = status === "shown" && items.length > 0;
  let body;
  if (status === "failed") body = h(Empty, null, VIDEO_FAILED_TEXT);
  else if (!shown) body = h(Empty, null, VIDEO_NONE_TEXT);
  else if (grouped) {
    const cats = videoCategoryOrder(items);
    body = cats.map((c) => h(Fragment, { key: c }, h(level, { className: "h list-h video-cat" }, c), list(items.filter((i) => i.category === c), false)));
  } else body = list(showCategory ? byDailyViews(items) : items, showCategory);
  return h(Fragment, null, h(headingLevel, { className: "repo-head" }, VIDEO_HEADING), shown ? filter : null, body);
}
