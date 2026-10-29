import { useEffect, useRef } from "react";
import { focusTargetId, parseRoute, selfScrolls } from "./lib/routes.ts";
import { AboutPage } from "./pages/AboutPage.tsx";
import { BriefPage } from "./pages/BriefPage.tsx";
import { DatesPage } from "./pages/DatesPage.tsx";
import { EntitiesPage } from "./pages/EntitiesPage.tsx";
import { EntityPage } from "./pages/EntityPage.tsx";
import { GlossaryPage } from "./pages/GlossaryPage.tsx";
import { IndicatorPage } from "./pages/IndicatorPage.tsx";
import { IndicatorsPage } from "./pages/IndicatorsPage.tsx";
import { IssuePage } from "./pages/IssuePage.tsx";
import { IssuesPage } from "./pages/IssuesPage.tsx";
import { NotFoundPage } from "./pages/NotFoundPage.tsx";
import { SchedulesPage } from "./pages/SchedulesPage.tsx";
import { SearchPage } from "./pages/SearchPage.tsx";
import { lastNavigation, useLocation } from "./router.tsx";

export function App() {
  const loc = useLocation();
  const route = parseRoute(loc.pathname, loc.search);
  const first = useRef(true);

  // 앱 안에서 다른 화면으로 가면 맨 위로 올리고 본문에 초점을 둔다(키보드·화면 읽기 프로그램).
  // 검색어 없는 검색 화면은 입력란에 둔다(화면 쪽 초점보다 이 효과가 나중에 돌아서 여기서 정한다).
  // `#<뉴스 키>`가 있으면 브리프 화면이 그 카드로, 용어 주소면 용어 사전이 그 용어로, 일정 주소면 일정 화면이 그 일정으로 스크롤한다.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const nav = lastNavigation();
    if (nav.quiet || nav.kind === "pop") return;
    if (selfScrolls(parseRoute(loc.pathname, loc.search))) return;
    if (!loc.hash) window.scrollTo({ top: 0 });
    document.getElementById(focusTargetId(parseRoute(loc.pathname, loc.search)))?.focus({ preventScroll: true });
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
    case "entities":
      return <EntitiesPage filter={route.filter} />;
    case "entity":
      return <EntityPage key={route.id} id={route.id} />;
    case "terms":
      return <GlossaryPage id={route.id} />;
    case "schedules":
      return <SchedulesPage key={route.id ?? "all"} id={route.id} list={route.list} />;
    case "indicators":
      return <IndicatorsPage />;
    case "indicator":
      return <IndicatorPage key={route.id} id={route.id} />;
    case "search":
      return <SearchPage q={route.q} />;
    case "about":
      return <AboutPage />;
    case "notFound":
      return <NotFoundPage />;
  }
}
