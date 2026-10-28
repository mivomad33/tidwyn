import { useEffect, useRef } from "react";
import { parseRoute } from "./lib/routes.ts";
import { AboutPage } from "./pages/AboutPage.tsx";
import { BriefPage } from "./pages/BriefPage.tsx";
import { DatesPage } from "./pages/DatesPage.tsx";
import { IssuePage } from "./pages/IssuePage.tsx";
import { IssuesPage } from "./pages/IssuesPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { lastNavigation, useLocation } from "./router.tsx";

export function App() {
  const loc = useLocation();
  const route = parseRoute(loc.pathname, loc.search);
  const first = useRef(true);

  // 앱 안에서 다른 화면으로 가면 맨 위로 올리고 본문에 초점을 둔다(키보드·화면 읽기 프로그램).
  // `#<뉴스 키>`가 있으면 브리프 화면이 그 카드로 스크롤한다.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const nav = lastNavigation();
    if (nav.quiet || nav.kind === "pop") return;
    if (!loc.hash) window.scrollTo({ top: 0 });
    document.getElementById("main")?.focus({ preventScroll: true });
  }, [loc.pathname, loc.search, loc.hash]);

  switch (route.name) {
    case "latest":
    case "brief":
      return <BriefPage route={route} />;
    case "dates":
      return <DatesPage />;
    case "issues":
      return <IssuesPage />;
    case "issue":
      return <IssuePage key={route.id} id={route.id} />;
    case "search":
      return <SearchPage q={route.q} />;
    case "about":
      return <AboutPage />;
    case "notFound":
      return <NotFoundPage />;
  }
}
