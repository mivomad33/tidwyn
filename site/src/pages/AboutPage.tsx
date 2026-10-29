// 사이트 소개(4.3-4, P9, P10). 4.5단계: 읽은 기록 설명과 지우기(4.6). 5단계: 일정 안내와 브라우저 기억 설명(4.7-3·4.7-7)
import { useState } from "react";
import { BackLink, Layout, useTitle } from "../components/common.tsx";
import { readStore } from "../readMarks.ts";

export const REPO_URL = "https://github.com/mivomad33/tidwyn";

export function AboutPage() {
  useTitle("사이트 소개");
  return (
    <Layout left={<BackLink to="/" label="브리프" />}>
      <article className="plain">
        <h1 className="page-title">사이트 소개</h1>
        <h2 className="h">Tidwyn은</h2>
        <p className="p">AI가 매일 한국·세계·IT·AI 뉴스를 모아 쉬운 말로 바꿔 쓴 요약이다. 뉴스는 이어지는 이슈로 묶어, 한 이야기가 어떻게 흘러왔는지 볼 수 있다.</p>
        <p className="p">AI가 쓴 글이라 틀리거나 빠진 내용이 있을 수 있다. 중요한 내용은 각 뉴스의 출처(원문)에서 확인해 주세요.</p>
        <p className="p">
          인물·기관·국가의 한 줄 설명과 용어 설명도 AI가 쓴 글이라 틀릴 수 있다. 잘못된 내용은{" "}
          <a href={`${REPO_URL}/issues`} className="text-link" target="_blank" rel="noopener noreferrer">
            원본 저장소의 GitHub 이슈
            <span className="sr-only"> (새 탭)</span>
          </a>
          로 알려 주세요.
        </p>
        <p className="p">일정도 AI가 뉴스에서 뽑은 것이라 틀리거나 바뀌었을 수 있다. 날짜는 그 일이 열리는 곳의 현지 날짜다.</p>
        <h2 className="h">저작권</h2>
        <p className="p">원문 기사의 저작권은 각 매체에 있다. 이 사이트는 원문 링크와 원문 이미지 주소만 연결하고 기사를 옮겨 싣지 않는다.</p>
        <p className="p">브리프와 이슈 글의 저작권은 만든 사람(mivomad33)에게 있고, 다시 쓰거나 퍼 가는 것을 허락하지 않는다. 사이트의 코드는 MIT 라이선스다.</p>
        <h2 className="h">방문 통계</h2>
        <p className="p">Vercel Web Analytics로 페이지 보기 수만 센다. 쿠키를 쓰지 않고, 방문자를 알아볼 수 있는 정보를 모으지 않는다. 검색어는 통계로 보내지 않는다.</p>
        <ReadMarksSection />
        <h2 className="h">원본 저장소</h2>
        <p className="p">
          <a href={REPO_URL} className="text-link" target="_blank" rel="noopener noreferrer">
            github.com/mivomad33/tidwyn
            <span className="sr-only"> (새 탭)</span>
          </a>
        </p>
      </article>
    </Layout>
  );
}

export const CLEAR_CONFIRM = "읽은 기록을 모두 지운다. 지운 기록은 되돌릴 수 없다.";

function ReadMarksSection() {
  const [cleared, setCleared] = useState(false);
  function clear() {
    if (!window.confirm(CLEAR_CONFIRM)) return;
    readStore.clear();
    setCleared(true);
  }
  return (
    <>
      <h2 className="h">읽은 기록</h2>
      <p className="p">읽은 뉴스 표시는 이 브라우저에만 저장된다. 어디로도 보내지 않고, 다른 기기나 브라우저와 맞춰지지 않는다.</p>
      <p className="p">뉴스 날짜로 1년이 지난 기록은 저절로 지워진다. 지운 기록은 되돌릴 수 없다.</p>
      <p className="p">마지막으로 고른 브리프 섹션 탭, 일정 화면의 보기(목록·달력), '이번 주 일정'을 접었는지도 이 브라우저에만 기억한다. 읽은 기록 지우기는 이것들을 지우지 않는다.</p>
      <div className="actions">
        <button type="button" className="retry" onClick={clear}>
          읽은 기록 지우기
        </button>
      </div>
      <p className="done" role="status">
        {cleared ? "읽은 기록을 지웠다." : ""}
      </p>
    </>
  );
}
