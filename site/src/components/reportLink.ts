// 제보 링크(`docs/design.md`). 앱과 정적 HTML이 같이 쓴다. 메일 앱이 없어도 주소를 볼 수 있게 글에 함께 쓴다.
import { createElement as h } from "react";
import { CONTACT_MAIL } from "../lib/policy.ts";

export function ReportLink({ href, label }: { href: string; label: string }) {
  return h("a", { className: "report", href }, h("span", { className: "report-l" }, label), " · ", h("span", { className: "addr-nb" }, CONTACT_MAIL));
}
