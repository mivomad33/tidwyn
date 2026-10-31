// 7단계 바닥글과 개인정보 처리방침(V6, V16, 4.7-4). 정책 III.A(YouTube API Services Developer Policies,
// https://developers.google.com/youtube/terms/developer-policies, 2026-10-15 판을 2026-10-30에 다시 열어 확인)가 요구하는 것:
// 처리방침이 늘 쉽게 보이고(모든 화면 바닥글), YouTube API Services를 쓴다는 것, Google 개인정보처리방침 링크, 모으는·쓰는·나누는 정보,
// 제3자 콘텐츠·광고 여부, 기기에 두거나 읽는 정보(쿠키와 비슷한 기술), 자체 이용 조건과 YouTube 이용약관 동의 문구.
// 테스트가 react-dom/server로 그려 보도록 JSX와 화면 이동기(router.tsx)를 쓰지 않는다: 링크 컴포넌트는 부르는 쪽이 넘긴다.
import { createElement as h, Fragment } from "react";
import { PRODUCTION_HOST } from "../lib/analytics.ts";
import { BROWSER_KEYS } from "../lib/browserKeys.ts";
import { fullKoreanDate } from "../lib/format.ts";
import { CORRECTIONS_LABEL, CORRECTIONS_PATH } from "../lib/menu.ts";
import { CONSENT_TEXT, CONTACT_MAIL, PRIVACY_TITLE, PRIVACY_UPDATED, mailHref } from "../lib/policy.ts";
import { privacyPath } from "../lib/routes.ts";
import { GOOGLE_PRIVACY_LABEL, GOOGLE_PRIVACY_URL, VIDEO_KEEP_DAYS, YOUTUBE_TERMS_LABEL, YOUTUBE_TERMS_URL } from "../lib/videos.ts";
import type { LinkLike } from "./termView.ts";
import { ExternalLink } from "./videoView.ts";

/** 바닥 메뉴(주소, 글자). 끝의 개인정보 처리방침은 모든 화면에 있다(V6) */
export const FOOTER_LINKS: readonly [string, string][] = [
  ["/about", "사이트 소개"],
  [CORRECTIONS_PATH, CORRECTIONS_LABEL],
  ["/issues", "이슈 목록"],
  ["/schedules", "일정"],
  ["/indicators", "지표"],
  ["/entities", "인물·기관·국가"],
  ["/terms", "용어 사전"],
  ["/dates", "날짜 목록"],
  [privacyPath(), PRIVACY_TITLE],
];

export function FooterView({ Link }: { Link: LinkLike }) {
  return h(
    "footer",
    { className: "footer" },
    h("p", null, "Tidwyn · AI가 매일 모아 쉬운 말로 바꿔 쓴 뉴스 요약"),
    h("p", { className: "consent" }, CONSENT_TEXT),
    h("nav", { "aria-label": "바닥 메뉴" }, ...FOOTER_LINKS.map(([to, label]) => h(Link, { key: to, to }, label))),
  );
}

function P(...children: (string | ReturnType<typeof h>)[]) {
  return h("p", { className: "p" }, ...children);
}

/** 개인정보 처리방침 본문(쉬운 한국어). 브라우저에 두는 기록 목록은 browserKeys.ts의 정의로 만든다 */
export function PrivacyView({ Link }: { Link: LinkLike }) {
  return h(
    Fragment,
    null,
    h("h1", { className: "page-title" }, PRIVACY_TITLE),
    P(`바뀐 날짜: ${fullKoreanDate(PRIVACY_UPDATED)}`),
    h("h2", { className: "h" }, "모으는 정보"),
    P("Tidwyn은 회원 가입·로그인과 입력 양식이 없는 읽기 전용 사이트이고, 사이트 자체는 방문자의 개인정보를 모으거나 저장하거나 다른 곳에 넘기지 않는다. 예외는 방문자가 직접 메일을 보낸 경우뿐이다. 검색어는 이 브라우저 안에서만 찾는 데 쓰고 어디로도 보내지 않는다."),
    h("h2", { className: "h" }, "보내 주신 메일"),
    P("오류 제보나 문의 메일을 보내면 보낸 사람의 주소와 내용을 답장과 정정에만 쓰고 공개하지 않는다. 보관 기간을 따로 정하지 않고 메일함에 두며, 요청하면 지운다."),
    h("h2", { className: "h" }, "방문 통계"),
    P(
      `운영 주소(${PRODUCTION_HOST})에서만 Vercel Web Analytics로 페이지 보기 수를 센다. 쿠키를 쓰지 않고, 방문자를 알아볼 수 있는 정보를 모으지 않으며, 검색어는 통계로 보내지 않는다. 미리 보기 주소와 로컬 주소에서는 통계를 보내지 않는다.`,
    ),
    h("h2", { className: "h" }, "브라우저에만 두는 기록"),
    P("이 사이트는 쿠키를 쓰지 않는다. 화면을 편하게 쓰도록 아래 기록만 이 브라우저의 로컬 스토리지(쿠키와 비슷하게 기기에 두는 저장 공간)에 둔다. 어디로도 보내지 않고, 다른 기기나 브라우저와 맞춰지지 않는다."),
    h(
      "ul",
      { className: "p keys" },
      ...BROWSER_KEYS.map((k) => h("li", { key: k.key }, h("code", null, k.key), `: ${k.what}`)),
    ),
    P("읽은 뉴스 표시는 ", h(Link, { to: "/about", className: "text-link" }, "사이트 소개"), "의 '읽은 기록 지우기'로 지울 수 있다. 모든 기록은 브라우저 설정에서 이 사이트의 데이터(사이트 데이터·저장 공간)를 지우면 지워진다."),
    h("h2", { className: "h" }, "추천 영상과 YouTube"),
    P(
      `브리프의 '영상' 탭과 이슈 페이지의 '관련 영상'은 YouTube API Services를 쓴다. 영상 정보(제목, 채널, 길이, 썸네일)는 YouTube에서 받은 것이고 받은 날부터 ${VIDEO_KEEP_DAYS}일 동안만 보인다. 추천 이유와 요약은 Tidwyn이 쓴 글이다. 확인할 수 있는 영상은 내용을 Google의 Gemini API로 확인해 고르고, 요약은 AI가 영상 내용을 바탕으로 쓴 글이라 틀릴 수 있다. Gemini API에는 영상 주소만 보내고 방문자 정보는 보내지 않는다. Tidwyn은 YouTube API로 방문자의 정보나 YouTube 계정에 접근하지 않는다.`,
    ),
    P(
      "영상 썸네일은 YouTube(Google) 서버에서 바로 불러온다. 그래서 영상이 보이는 화면을 열면 방문자의 브라우저가 YouTube 서버에 접속하고, 그때 IP 주소 같은 접속 정보가 그 서버에 전달된다. 영상을 누르면 YouTube로 이동한다. 그 뒤의 처리는 Google이 정한다: ",
      h(ExternalLink, { href: GOOGLE_PRIVACY_URL, label: GOOGLE_PRIVACY_LABEL }),
      ", ",
      h(ExternalLink, { href: YOUTUBE_TERMS_URL, label: YOUTUBE_TERMS_LABEL }),
      ".",
    ),
    h("h2", { className: "h" }, "기사 이미지"),
    P("펼친 뉴스의 기사 이미지는 각 매체 서버에서 바로 불러온다. 그래서 이미지가 보일 때 방문자의 브라우저가 그 매체 서버에 접속하고, 접속 정보가 그 서버에 전달된다."),
    h("h2", { className: "h" }, "광고"),
    P("이 사이트는 제3자 광고를 싣지 않는다."),
    h("h2", { className: "h" }, "문의"),
    P("개인정보 처리방침에 대한 질문은 ", h("a", { href: mailHref(), className: "text-link" }, CONTACT_MAIL), "로 보내 주세요."),
    h("h2", { className: "h", id: "terms" }, "이용 조건"),
    P(CONSENT_TEXT, " ", h(ExternalLink, { href: YOUTUBE_TERMS_URL, label: YOUTUBE_TERMS_LABEL })),
    P("이 처리방침이 바뀌면 이 페이지의 바뀐 날짜를 고친다."),
  );
}
