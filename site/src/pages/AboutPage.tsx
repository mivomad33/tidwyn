// 사이트 소개 화면. 본문은 components/aboutView.ts에 있고(정적 HTML과 같은 문구), 여기는 읽은 기록 지우기와 `#corrections`로 가는 스크롤만 맡는다
import { useEffect, useState } from "react";
import { ReadMarksText, AboutView } from "../components/aboutView.ts";
import { BriefBackLink, Layout, useTitle } from "../components/common.tsx";
import { readStore } from "../readMarks.ts";
import { Link, useLocation } from "../router.tsx";

export function AboutPage() {
  useTitle("사이트 소개");
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (!el) return;
    el.scrollIntoView({ block: "start" });
    el.tabIndex = -1;
    el.focus({ preventScroll: true });
  }, [hash]);
  return (
    <Layout left={<BriefBackLink />}>
      <AboutView Link={Link} readMarks={<ReadMarksSection />} />
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
      <ReadMarksText />
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
