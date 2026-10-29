// 사이트 소개(4.3-4, P9, P10)
import { BackLink, Layout, useTitle } from "../components/common.tsx";

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
        <h2 className="h">저작권</h2>
        <p className="p">원문 기사의 저작권은 각 매체에 있다. 이 사이트는 원문 링크와 원문 이미지 주소만 연결하고 기사를 옮겨 싣지 않는다.</p>
        <p className="p">브리프와 이슈 글의 저작권은 만든 사람(mivomad33)에게 있고, 다시 쓰거나 퍼 가는 것을 허락하지 않는다. 사이트의 코드는 MIT 라이선스다.</p>
        <h2 className="h">방문 통계</h2>
        <p className="p">Vercel Web Analytics로 페이지 보기 수만 센다. 쿠키를 쓰지 않고, 방문자를 알아볼 수 있는 정보를 모으지 않는다. 검색어는 통계로 보내지 않는다.</p>
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
