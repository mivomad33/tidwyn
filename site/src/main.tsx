import { inject } from "@vercel/analytics";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { analyticsEnabled, stripSearchQuery } from "./lib/analytics.ts";
import "./styles.css";

// 방문 통계는 운영 주소에서만 켠다(4.6-4). 페이지 보기만 남고, pushState 화면 이동도 스크립트가 센다.
if (analyticsEnabled(location.hostname)) {
  inject({
    mode: "production",
    beforeSend: (event) => ({ ...event, url: stripSearchQuery(event.url) }),
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
