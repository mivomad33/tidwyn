// 수요 흐름 항목(9.97단계 4.4-1, `docs/design.md`의 '수요 항목'). 앱과 정적 HTML이 같은 문구와 순서를 쓴다.
// 줄, 칸, 정정 표시, 관련 이슈, 출처, 제보 링크는 빌더 항목과 같은 공통 코드다(builderView.ts). 읽음 버튼과 줄은 부르는 쪽이 그린다.
import { createElement as h, Fragment, type ReactNode } from "react";
import { FLOW_AI_NOTE, FLOW_CAVEAT, GROUP_INFO, LEVEL_LABELS, LEVEL_MEANINGS, OFFICIAL_GROUPS, AUX_GROUPS, FLOW_LEVELS } from "../../../src/demandFlowTypes.ts";
import { Field, IssueField, MutedCatLine, SourcesAndReport, zeroState } from "./builderView.ts";
import { FixNotes } from "./correctionView.ts";
import type { LinkLike } from "./termView.ts";
import { TOP_LIST_NOTE, demandMissingText, demandZeroText, flowAuxText, flowCategoryText, flowContinuesText, flowLevelText, flowPeriod, flowUnitHead, flowUnitNumbers, flowUnitPeriod } from "../lib/demand.ts";
import { briefPath } from "../lib/routes.ts";
import type { DayDemand, SiteFlowItem } from "../lib/types.ts";

/** 탭 머리의 한 줄 안내, 고정 문구(S7), 소개의 수요 절 링크 */
export function DemandIntro({ Link }: { Link: LinkLike }) {
  return h("p", { className: "flow note" }, "서로 다른 공식 소스 두 곳 이상에서 함께 오른 관심, 불만·요구, 돈의 흐름을 모았다. ", FLOW_CAVEAT, " ", h(Link, { to: "/about#demand", className: "bintro-l" }, "수요 탭 소개"));
}

/** 갈래·분야 줄과 정정 표시 */
export function DemandCategoryLine({ item }: { item: SiteFlowItem }) {
  return h(MutedCatLine, { text: flowCategoryText(item), fixes: item.corrections });
}

/** 근거 줄: 소스마다 한 줄로 이름, 숫자, 창 기간 */
function Evidence({ item }: { item: SiteFlowItem }) {
  return h(
    Fragment,
    null,
    h("h4", { className: "h" }, "근거"),
    h(
      "ul",
      { className: "p dlines" },
      item.units.map((u, i) =>
        h(
          "li",
          { key: i },
          h("span", { className: "dhead" }, flowUnitHead(u)),
          h("span", { className: "dnum" }, flowUnitNumbers(u)),
          h("span", { className: "dwin" }, flowUnitPeriod(u)),
          u.topList ? h("span", { className: "dwin" }, TOP_LIST_NOTE) : null,
        ),
      ),
    ),
  );
}

/** 칸을 정해진 순서로 그린다(4.4-1). 갈래·분야 줄과 제목은 부르는 쪽이 그린다 */
export function DemandBody({ item, date, Link }: { item: SiteFlowItem; date: string; Link: LinkLike }) {
  const from = item.continues;
  return h(
    Fragment,
    null,
    h(Field, { label: "요지" }, item.summary),
    h(FixNotes, { fixes: item.corrections, className: "fix" }),
    h(Field, { label: "잇는 이유" }, item.reason),
    h("p", { className: "dnote" }, FLOW_AI_NOTE),
    h(Evidence, { item }),
    h(Field, { label: "근거 수준" }, flowLevelText(item.level)),
    item.aux.length > 0 ? h(Field, { label: "보조 근거" }, flowAuxText(item.aux)) : null,
    from ? h(Fragment, null, h("h4", { className: "h" }, "이어짐"), h("p", { className: "p" }, h(Link, { to: briefPath(from.date, from.key), className: "quiet dcont" }, flowContinuesText(from.date)))) : null,
    h(IssueField, { issue: item.issue, Link }),
    h(Field, { label: "비교 기간" }, flowPeriod(item.units)),
    h(SourcesAndReport, { sources: item.sources, reportTitle: item.title, date, itemKey: item.key }),
  );
}

/** 탭 본문: 항목 목록이나 상태 문구, 항목이 있는데 빠진 묶음이 있으면 목록 끝 안내. 줄은 앱과 정적 HTML이 달라 부르는 쪽이 넘긴다 */
export function DemandList({ demand, items, row }: { demand: DayDemand; items: SiteFlowItem[]; row: (x: SiteFlowItem) => ReactNode }) {
  if (items.length === 0) return demand.count === 0 ? zeroState(demandZeroText(demand.status), demand.status === "failed") : null;
  const missing = demandMissingText(demand.missing);
  return h(Fragment, null, h("ul", { className: "list blist" }, items.map(row)), missing ? h("p", { className: "flow note" }, missing) : null);
}

/** 사이트 소개의 '수요 탭' 절(4.4-2). 출처 이름은 묶음 목록(GROUP_INFO)에서 가져온다 */
export function AboutDemand() {
  const P = (...children: ReactNode[]) => h("p", { className: "p" }, ...children);
  // 출처 이름은 글로만 둔다(기관 페이지 링크는 항목마다의 출처 칸에 있다)
  const credits = (groups: readonly (keyof typeof GROUP_INFO)[]) => groups.flatMap((g, i) => [i > 0 ? ", " : null, h("span", { key: g, className: "credit" }, GROUP_INFO[g].credit)]);
  return h(
    "section",
    { id: "demand" },
    h("h2", { className: "h" }, "수요 탭"),
    P("수요 탭은 사람들이 요즘 무엇에 관심을 두고, 무엇을 불편해하며, 어디에 돈이 몰리는지를 공식 기관이 공개한 숫자로 모은다. 국회 청원, 권익위 민원, 1372 소비자상담, DART 공시, SEC Form D, Wikimedia 인기 문서를 날마다 받아 센다."),
    P(FLOW_CAVEAT),
    P("한 소스에서만 오른 것은 흐름이라 부르지 않는다. 서로 다른 공식 소스 두 곳 이상에서 같은 이야기가 함께 올랐을 때만 싣는다. 하루 0~3건이고 건수를 채우지 않아, 없는 날은 없다고 쓴다."),
    P("비교는 소스마다 최근 7일과 그 앞 28일이다. 앞 28일은 7일 길이로 맞춘 평균이라 두 숫자를 바로 견줄 수 있다. 배수나 %만 따로 쓰지 않고 원래 숫자를 함께 보인다. 자료가 없는 날이 있으면 그날을 빼고 맞춘 날 수를 적는다."),
    P(
      "근거 수준은 기계가 규칙으로 정한다. ",
      FLOW_LEVELS.map((l) => `근거 ${LEVEL_LABELS[l]}은 ${LEVEL_MEANINGS[l]}는 뜻이다. `),
      "Google Trends와 Mastodon 트렌드는 보조 근거라 함께 보였는지만 적고 수준을 올리지 않는다.",
    ),
    P("숫자는 모두 기계가 공식 소스에서 센 값이고 다시 셀 수 있다. 어느 소스들이 같은 흐름인지 잇고 제목과 요지를 쓴 것은 AI 판단이라 틀릴 수 있다."),
    P("공식 소스는 공개가 하루 이틀 늦고, 1372 소비자상담은 더 늦다. 민원과 청원은 목소리를 낸 일부 사람의 것이라 모두의 생각을 대표하지 않는다. 한 사람에게 쏠린 관심은 흐름으로 싣지 않는다."),
    P("받은 원본(청원 글, 민원 글, 순위표, 공시 원문)은 싣지 않는다. 청원, 민원 질의응답, 공개제안처럼 사람들이 직접 쓴 글은 제목도 싣지 않고 건수만 보인다. 출처 링크는 각 기관의 공식 공개 페이지다."),
    h("p", { className: "p demand-credits" }, "출처 표시: ", credits(OFFICIAL_GROUPS), ". 보조 근거: ", credits(AUX_GROUPS), "."),
    P("민원빅데이터 오늘의 이슈는 국민권익위원회가 공공누리 제2유형(출처표시, 상업적 이용금지)으로 개방한 자료를 이용했다."),
  );
}
