// 정정 표시(`docs/design.md`의 '정정 표시', '바뀐 내용'). 앱과 정적 HTML이 같이 쓴다. 표시와 사유는 같은 정정 기록에서 만든다.
import { createElement as h, Fragment } from "react";
import { monthDay } from "../lib/format.ts";
import type { StoryCorrection } from "../../../src/siteTypes.ts";

/** '정정됨 · M월 D일'. 여러 번 고쳤으면 가장 최근 날짜다 */
export function FixMark({ fixes }: { fixes: StoryCorrection[] | undefined }) {
  if (!fixes?.length) return null;
  return h("span", { className: "fix-mark" }, `정정됨 · ${monthDay(fixes[0]!.on)}`);
}

function Head({ fix, many }: { fix: StoryCorrection; many: boolean }) {
  if (!many) return h("strong", null, "바뀐 내용:");
  return h("strong", null, h("span", { className: "addr-nb" }, monthDay(fix.on)), " 바뀐 내용:");
}

/** '바뀐 내용' 문단들(최신순). 펼친 카드는 fix, 짧은 소식은 short-fix */
export function FixNotes({ fixes, className }: { fixes: StoryCorrection[] | undefined; className: "fix" | "short-fix" }) {
  if (!fixes?.length) return null;
  return h(
    Fragment,
    null,
    fixes.map((f, i) => h("p", { className, key: `${f.on}-${i}` }, h(Head, { fix: f, many: fixes.length > 1 }), " ", f.reason)),
  );
}
