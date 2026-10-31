// 사이트 소개 본문(4.3-4, P9, P10). 4.5단계: 읽은 기록. 5단계: 일정 안내. 6단계: 지표 안내, FRED 고지. 7단계: '추천 영상' 절. 9.5단계: '오류 정정과 연락' 절.
// 앱과 정적 HTML이 같은 문구를 쓴다: 링크 컴포넌트와 읽은 기록 절은 부르는 쪽이 넘긴다(정적 HTML에는 지우기 버튼이 없다).
import { createElement as h, type ReactNode } from "react";
import { FRED_AGREEMENT } from "../lib/indicators.ts";
import { CONTACT_MAIL, REPO_URL, mailHref } from "../lib/policy.ts";
import { RSS_PATH } from "../lib/routes.ts";
import { FredNotice } from "./indicatorView.ts";
import type { LinkLike } from "./termView.ts";
import { AboutVideos, ExternalLink } from "./videoView.ts";

function P(...children: ReactNode[]) {
  return h("p", { className: "p" }, ...children);
}

export function ReadMarksText() {
  return [
    h("h2", { className: "h", key: "h" }, "읽은 기록"),
    h("p", { className: "p", key: "a" }, "읽은 뉴스 표시는 이 브라우저에만 저장된다. 어디로도 보내지 않고, 다른 기기나 브라우저와 맞춰지지 않는다."),
    h("p", { className: "p", key: "b" }, "뉴스 날짜로 1년이 지난 기록은 저절로 지워진다. 지운 기록은 되돌릴 수 없다."),
    h("p", { className: "p", key: "c" }, "마지막으로 고른 브리프 섹션 탭, 일정 화면의 보기(목록·달력), 브리프 위 '이번 주 일정 | 지표' 상자를 접었는지와 그 상자에서 고른 탭(일정·지표)도 이 브라우저에만 기억한다. 읽은 기록 지우기는 이것들을 지우지 않는다."),
  ];
}

function CorrectionsSection() {
  return h(
    "section",
    { id: "corrections" },
    h("h2", { className: "h" }, "오류 정정과 연락"),
    h("a", { className: "mailbar", href: mailHref() }, h("span", { className: "lbl" }, "틀린 내용은 날짜와 뉴스 제목을 적어 이 메일로 알려 주세요."), h("span", { className: "addr" }, CONTACT_MAIL)),
    P("뉴스 제목을 눌러 펼치면 맨 아래에 '틀린 내용 알리기'가 있다. 누르면 내용이 채워진 메일이 열린다. 짧은 소식은 목록 맨 끝의 링크를 쓴다."),
    P("제보를 확인해 틀린 것이 맞으면 내용을 고치고, 그 뉴스에 고친 날짜와 바뀐 내용을 한 줄로 남긴다. 조용히 고치지 않는다."),
    P("원문 기사 자체의 오류는 해당 언론사가 바로잡을 일이다. 언론사가 정정하면 그에 맞춰 고친다. 제보마다 답장하지는 못할 수 있다."),
  );
}

export function AboutView({ Link, readMarks }: { Link: LinkLike; readMarks: ReactNode }) {
  return h(
    "article",
    { className: "plain about" },
    h("h1", { className: "page-title" }, "사이트 소개"),
    h("h2", { className: "h" }, "Tidwyn은"),
    P("AI가 매일 한국·세계·IT·AI 뉴스를 모아 쉬운 말로 바꿔 쓴 요약이다. 뉴스는 이어지는 이슈로 묶어, 한 이야기가 어떻게 흘러왔는지 볼 수 있다."),
    P("AI가 쓴 글이라 틀리거나 빠진 내용이 있을 수 있다. 중요한 내용은 각 뉴스의 출처(원문)에서 확인해 주세요."),
    P("인물·기관·국가의 한 줄 설명과 용어 설명도 AI가 쓴 글이라 틀릴 수 있다."),
    P("일정도 AI가 뉴스에서 뽑은 것이라 틀리거나 바뀌었을 수 있다. 날짜는 그 일이 열리는 곳의 현지 날짜다."),
    P("지표는 공식 출처(한국은행 ECOS, FRED)에서 받은 값이지만 늦게 반영되거나 출처가 나중에 고칠 수 있다. 날짜는 출처 기준이다(한국 지표는 한국 날짜, 미국 지표는 미국 날짜)."),
    h(CorrectionsSection),
    h("h2", { className: "h" }, "구독"),
    P("매일의 브리프는 ", h("a", { href: RSS_PATH, className: "text-link" }, "RSS"), "로 받아 볼 수 있다. 날짜마다 항목 하나가 올라온다."),
    h("h2", { className: "h" }, "지표 출처"),
    P("한국 지표는 한국은행 ECOS(작성기관 포함), 미국·국제 지표는 FRED(St. Louis Fed, 원 기관 표시)의 자료이고 이용 조건은 각 출처를 따른다."),
    h(FredNotice),
    P(FRED_AGREEMENT),
    h(AboutVideos, { Link }),
    h("h2", { className: "h" }, "저작권"),
    P("원문 기사의 저작권은 각 매체에 있다. 이 사이트는 원문 링크와 원문 이미지 주소만 연결하고 기사를 옮겨 싣지 않는다."),
    P("브리프와 이슈 글의 저작권은 만든 사람(mivomad33)에게 있고, 다시 쓰거나 퍼 가는 것을 허락하지 않는다. 사이트의 코드는 MIT 라이선스다."),
    h("h2", { className: "h" }, "방문 통계"),
    P("Vercel Web Analytics로 페이지 보기 수만 센다. 쿠키를 쓰지 않고, 방문자를 알아볼 수 있는 정보를 모으지 않는다. 검색어는 통계로 보내지 않는다."),
    readMarks,
    h("h2", { className: "h" }, "원본 저장소"),
    P(h(ExternalLink, { href: REPO_URL, label: "github.com/mivomad33/tidwyn" })),
  );
}
