// 7단계 추천 영상의 그리기(4.7, 확정 시안 design/site.html): 영상 줄, 영상 목록, 출처 줄, 사이트 소개의 '추천 영상' 절.
// 브리프의 영상 탭과 이슈 페이지의 '관련 영상'이 같은 영상 줄·출처 줄을 쓴다(4.7-3). 테스트가 react-dom/server로 그려 보도록
// termView.ts처럼 JSX와 화면 이동기(router.tsx)를 쓰지 않는다: 링크 컴포넌트는 부르는 쪽이 넘긴다.
// 제목·채널·길이·썸네일은 YouTube가 준 그대로 보이고(V8), 추천 이유는 Tidwyn이 쓴 글로 따로 표시한다.
import { createElement as h, Fragment, useId, useState } from "react";
import { CONSENT_TEXT, PRIVACY_TITLE } from "../lib/policy.ts";
import { privacyPath, briefVideosPath } from "../lib/routes.ts";
import { YOUTUBE_TERMS_LABEL, YOUTUBE_TERMS_URL, bundleLabel, durationClock, durationText, recommendedOnText, videoUrl } from "../lib/videos.ts";
import type { IssueVideo, SiteVideo } from "../../../src/siteTypes.ts";
import type { LinkLike } from "./termView.ts";

function newTab() {
  return h("span", { className: "sr-only" }, " (새 탭)");
}

/** 바깥 링크(새 탭). 보조 기술에는 "(새 탭)"을 붙여 알린다(원문 링크와 같은 방식) */
export function ExternalLink({ href, label, className = "text-link" }: { href: string; label: string; className?: string }) {
  return h("a", { href, className, target: "_blank", rel: "noopener noreferrer" }, label, newTab());
}

/** 썸네일. 불러오지 못하면 이미지를 빼고 같은 크기의 빈 상자와 길이만 남는다 */
function Thumb({ src, seconds }: { src: string; seconds: number }) {
  const [failed, setFailed] = useState(false);
  return h(
    "span",
    { className: failed ? "vthumb failed" : "vthumb" },
    failed ? null : h("img", { src, alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", onError: () => setFailed(true) }),
    // 길이는 정보 줄에도 있어 보조 기술에는 한 번만 읽힌다
    h("small", { className: "vdur", "aria-hidden": true }, durationClock(seconds)),
  );
}

/** 접어 둔 요약(8단계 T8). 새로 고치거나 칩을 바꾸면 닫힌다. 버튼은 영상 링크 밖에 있어 눌러도 YouTube로 가지 않는다 */
function VideoSummary({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  return h(
    "div",
    { className: "vsum" },
    h("button", { type: "button", className: "vsumbtn", "aria-expanded": open, "aria-controls": region, onClick: () => setOpen(!open) }, open ? "요약 접기" : "요약 보기"),
    h("p", { id: region, className: "vsumtext", hidden: !open }, text),
  );
}

export interface VideoRowProps {
  video: SiteVideo | IssueVideo;
  /** 브리프: 묶음 표시를 붙인다. 이슈 페이지: 붙인 브리프 날짜("M월 D일 추천", 그 날짜 브리프의 영상 탭)를 붙인다 */
  mode: "brief" | "issue";
  Link: LinkLike;
}

/**
 * 영상 줄 하나: 썸네일(길이 표시)과 제목이 한 링크로 YouTube 영상 페이지를 새 탭으로 연다(V8). 그 아래 묶음 표시·채널·길이 줄,
 * 그 아래 '추천 이유' 상자. 링크 이름은 제목이다(썸네일은 빈 대체 글).
 */
export function VideoRow({ video, mode, Link }: VideoRowProps) {
  const date = mode === "issue" && "date" in video ? video.date : null;
  return h(
    "li",
    { className: "vrow", "data-video": video.id },
    h("a", { href: videoUrl(video.id), className: "vlink", target: "_blank", rel: "noopener noreferrer" }, h(Thumb, { src: video.thumb, seconds: video.seconds }), h("span", { className: "vt" }, video.title), newTab()),
    h(
      "div",
      { className: "vm" },
      mode === "brief" ? h("span", { className: "tag" }, bundleLabel(video.bundle)) : null,
      `${video.channel} · ${durationText(video.seconds)}`,
      date ? h(Fragment, null, " · ", h(Link, { to: briefVideosPath(date), className: "vrec" }, recommendedOnText(date))) : null,
    ),
    h("p", { className: "why" }, h("b", null, "추천 이유"), video.reason),
    video.videoSummary ? h(VideoSummary, { text: video.videoSummary }) : null,
  );
}

/** 영상 목록(브리프 영상 탭과 이슈 페이지가 같이 쓴다). resetKey가 바뀌면 줄을 새로 그려 펼친 요약이 닫힌다(칩 전환, 8단계 4.6-2) */
export function VideoList({ videos, mode, Link, resetKey = "" }: { videos: readonly (SiteVideo | IssueVideo)[]; mode: VideoRowProps["mode"]; Link: LinkLike; resetKey?: string }) {
  return h("ul", { className: "vlist" }, ...videos.map((v) => h(VideoRow, { key: `${resetKey}:${v.id}`, video: v, mode, Link })));
}

/** 영상이 보이는 화면 아래 끝의 출처 줄(V8, T7): YouTube가 출처이고 추천 이유와 요약은 Tidwyn이 쓴 글이다(정책 III.F.2) */
export function VideoSource() {
  return h("p", { className: "vsrc" }, "영상 정보: YouTube · ", h(ExternalLink, { href: YOUTUBE_TERMS_URL, label: YOUTUBE_TERMS_LABEL }), " · 추천 이유와 요약은 Tidwyn이 썼습니다.");
}

/** 사이트 소개의 '추천 영상' 절(4.7-5) */
export function AboutVideos({ Link }: { Link: LinkLike }) {
  return h(
    Fragment,
    null,
    h("h2", { className: "h" }, "추천 영상"),
    h(
      "p",
      { className: "p" },
      "브리프의 '영상' 탭에는 그날 볼 만한 긴 영상을 추천한다. 매일 브리프를 만들 때 YouTube의 한국·미국 인기 차트와 분야별·AI 주제 검색에서 받은 영상 중, Claude가 제목과 설명으로 후보를 추린다. 확인할 수 있는 영상은 내용을 Google의 Gemini API로 확인해 정보와 통찰을 주는 영상을 고른다. 추천 이유와 요약은 Tidwyn이 쓴 글이다.",
    ),
    h("p", { className: "p" }, "요약은 AI가 영상 내용을 바탕으로 쓴 글이라 틀릴 수 있다. Gemini API에는 영상 주소만 보내고 방문자 정보는 보내지 않는다."),
    h("p", { className: "p" }, "영상 정보(제목, 채널, 길이, 썸네일)는 YouTube API Services로 받은 것이고 받은 날부터 30일 동안만 보인다. 영상을 누르면 YouTube에서 열린다(이 사이트 안에서 재생하지 않는다)."),
    h("p", { className: "p" }, "영상 정보는 ", h(ExternalLink, { href: YOUTUBE_TERMS_URL, label: YOUTUBE_TERMS_LABEL }), "을 따른다. ", CONSENT_TEXT),
    h("p", { className: "p" }, h(Link, { to: privacyPath(), className: "text-link" }, PRIVACY_TITLE), " 보기"),
  );
}
