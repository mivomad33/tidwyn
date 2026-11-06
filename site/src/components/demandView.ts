// 수요 흐름 항목(9.97단계 4.4-1, `docs/design.md`의 '수요 항목'). 앱과 정적 HTML이 같은 문구와 순서를 쓴다.
// 줄, 칸, 정정 표시, 관련 이슈, 출처, 제보 링크는 빌더 항목과 같은 공통 코드다(builderView.ts). 읽음 버튼과 줄은 부르는 쪽이 그린다.
import { createElement as h, Fragment, type ReactNode } from "react";
import { COVERAGE_COLUMNS, FIELD_COVERAGE } from "../../../src/demandCoverage.ts";
import { COMMUNITY_GROUPS, COMMUNITY_INFO, COMMUNITY_LEVEL_MEANINGS, COMMUNITY_MISSING_MEANINGS, COMMUNITY_MISSING_NAMES, COMMUNITY_MISSING_REASONS, FLOW_AI_NOTE, FLOW_AI_NOTE_COMMUNITY, FLOW_CAVEAT, SOURCE_STATE_NAMES, type SourceState, FLOW_TURNING_TEXT, GROUP_INFO, LEVEL_LABELS, LEVEL_MEANINGS, OFFICIAL_GROUPS, AUX_GROUPS, FLOW_LEVELS, fieldLabel } from "../../../src/demandFlowTypes.ts";
import { Field, FoldField, IssueField, MutedCatLine, SourcesAndReport, zeroState } from "./builderView.ts";
import { FixNotes } from "./correctionView.ts";
import type { LinkLike } from "./termView.ts";
import { DEMAND_ABOUT_HASH, DEMAND_ABOUT_LINK, DEMAND_INTRO, DEMAND_MISSING_LABEL, TOP_LIST_NOTE, demandMissingText, demandZeroText, flowAuxText, flowCategoryText, flowCommunityHead, flowCommunityNumbers, flowContinuesText, flowLevelText, flowPeriod, flowUnitHead, flowUnitNumbers, flowUnitPeriod } from "../lib/demand.ts";
import { briefPath } from "../lib/routes.ts";
import type { DayDemand, SiteFlowItem } from "../lib/types.ts";

/** 탭 머리의 한 줄 안내(흐름 인정과 커뮤니티 표본, 9.98 S1·S5), 고정 문구(S7), 소개의 분야별 사각지대 표 링크(S6) */
export function DemandIntro({ Link }: { Link: LinkLike }) {
  return h("p", { className: "flow note" }, DEMAND_INTRO, " ", FLOW_CAVEAT, " ", h(Link, { to: `/about#${DEMAND_ABOUT_HASH}`, className: "text-link bintro-l" }, DEMAND_ABOUT_LINK));
}

/** 갈래·분야 줄과 정정 표시 */
export function DemandCategoryLine({ item }: { item: SiteFlowItem }) {
  return h(MutedCatLine, { text: flowCategoryText(item), fixes: item.corrections });
}

/** 수요 흐름의 접힌 줄 칸: 요지, 근거 수준(U2 4.2-2) */
export function DemandFolded({ item }: { item: SiteFlowItem }) {
  return h(Fragment, null, h(FoldField, { label: "요지" }, item.summary), h(FoldField, { label: "근거 수준" }, flowLevelText(item.level, item.communityConfirmed === true)));
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

/** 커뮤니티 근거 줄(9.98 4.5-1): 공식 근거 줄 뒤에 '커뮤니티'로 묶는다. 소스 · 표본 설명, 검색어였던 단위 이름, 숫자, 창 기간 */
function CommunityEvidence({ item }: { item: SiteFlowItem }) {
  const lines = item.community ?? [];
  if (lines.length === 0) return null;
  return h(
    Fragment,
    null,
    h("h4", { className: "h" }, "커뮤니티"),
    h(
      "ul",
      { className: "p dlines" },
      lines.map((c, i) =>
        h(
          "li",
          { key: i },
          h("span", { className: "dsrc" }, flowCommunityHead(c)),
          h("span", { className: "dhead" }, c.name),
          h("span", { className: "dnum" }, flowCommunityNumbers(c)),
          h("span", { className: "dwin" }, flowUnitPeriod(c)),
        ),
      ),
    ),
  );
}

/** 근거 수준 줄과 그 바로 아래 꺾임 표시(S7, 12px 흐린 글자) */
function LevelField({ item }: { item: SiteFlowItem }) {
  return h(Fragment, null, h(Field, { label: "근거 수준" }, flowLevelText(item.level, item.communityConfirmed === true)), item.turning ? h("p", { className: "dnote dturn" }, FLOW_TURNING_TEXT) : null);
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
    h("p", { className: "dnote" }, item.community?.length ? FLOW_AI_NOTE_COMMUNITY : FLOW_AI_NOTE),
    h(Evidence, { item }),
    h(CommunityEvidence, { item }),
    h(LevelField, { item }),
    item.aux.length > 0 ? h(Field, { label: "보조 근거" }, flowAuxText(item.aux)) : null,
    from ? h(Fragment, null, h("h4", { className: "h" }, "이어짐"), h("p", { className: "p" }, h(Link, { to: briefPath(from.date, from.key), className: "text-link dcont" }, flowContinuesText(from.date)))) : null,
    h(IssueField, { issue: item.issue, Link }),
    h(Field, { label: "비교 기간" }, flowPeriod(item.units)),
    h(SourcesAndReport, { sources: item.sources, reportTitle: item.title, date, itemKey: item.key }),
  );
}

/** 탭 본문: 항목 목록이나 상태 문구, 항목이 있는데 빠진 묶음이 있으면 목록 끝 안내. 줄은 앱과 정적 HTML이 달라 부르는 쪽이 넘긴다 */
export function DemandList({ demand, items, row }: { demand: DayDemand; items: SiteFlowItem[]; row: (x: SiteFlowItem) => ReactNode }) {
  if (items.length === 0) return demand.count === 0 ? zeroState(demandZeroText(demand.status), demand.status === "failed") : null;
  const missing = demandMissingText(demand.missing, demand.communityMissing);
  return h(Fragment, null, h("ul", { className: "list blist" }, items.map(row)), missing ? h("p", { className: "flow note" }, missing) : null);
}

/** 소개의 분야별 사각지대 표(9.98 S6). 칸은 코드 한 곳의 분야×소스 대응(FIELD_COVERAGE)으로 만든다. 좁은 폭에서도 가로로 넘치지 않게 소스는 칸 안에 이어 쓴다 */
export function DemandCoverage() {
  const names = (kind: "official" | "community", groups: readonly string[]) => {
    // 소스 이름은 한 덩어리로 줄을 바꾼다(이름 가운데서 끊지 않는다)
    const seen = COVERAGE_COLUMNS.filter((c) => c.kind === kind && groups.includes(c.id)).map((c) => c.label);
    return seen.length > 0 ? seen.flatMap((n, i) => [i > 0 ? ", " : null, h("span", { key: n, className: "dcover-n" }, n)]) : "없음";
  };
  const noCommunity = FIELD_COVERAGE.filter((r) => !COVERAGE_COLUMNS.some((c) => c.kind === "community" && r.groups.includes(c.id))).map((r) => fieldLabel(r.field));
  return h(
    "section",
    { id: DEMAND_ABOUT_HASH },
    h("h3", { className: "h dcover-h", id: `${DEMAND_ABOUT_HASH}-h` }, "분야별로 볼 수 있는 소스"),
    h("p", { className: "p" }, "소스마다 담을 수 있는 분야가 다르다. 칸에 없는 소스는 그 분야의 이야기를 거의 담지 못해, 그 분야의 흐름은 덜 보인다. 흐름이 어느 분야에 몰린 날에도 그것이 세상의 모습인지 소스의 치우침인지 이 표로 가늠할 수 있다.", noCommunity.length > 0 ? ` 커뮤니티 검색이 보지 못하는 분야: ${noCommunity.join(", ")}.` : null),
    h(
      "table",
      { className: "dcover", "aria-labelledby": `${DEMAND_ABOUT_HASH}-h` },
      h("thead", null, h("tr", null, h("th", { scope: "col" }, "분야"), h("th", { scope: "col" }, "공식 소스"), h("th", { scope: "col" }, "커뮤니티 검색"))),
      h(
        "tbody",
        null,
        FIELD_COVERAGE.map((r) => h("tr", { key: r.field }, h("th", { scope: "row" }, fieldLabel(r.field)), h("td", null, names("official", r.groups)), h("td", null, names("community", r.groups)))),
      ),
    ),
  );
}

/** 사이트 소개의 '수요 탭' 절(4.4-2, 9.98 4.5-2). 출처 이름은 묶음 목록(GROUP_INFO), 커뮤니티 소스와 표본 설명은 COMMUNITY_INFO에서 가져온다 */
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
    P("한 소스에서만 오른 것은 흐름이라 부르지 않는다. 서로 다른 공식 소스 두 곳 이상에서, 또는 공식 소스 한 곳과 커뮤니티 검색에서 같은 이야기가 함께 올랐을 때만 싣는다. 커뮤니티 검색끼리만 오른 것은 싣지 않는다. 하루 0~3건이고 건수를 채우지 않아, 없는 날은 없다고 쓴다."),
    P("비교는 소스마다 최근 7일과 그 앞 28일이다. 앞 28일은 7일 길이로 맞춘 평균이라 두 숫자를 바로 견줄 수 있다. 배수나 %만 따로 쓰지 않고 원래 숫자를 함께 보인다. 자료가 없는 날이 있으면 그날을 빼고 맞춘 날 수를 적는다."),
    P(
      "근거 수준은 기계가 규칙으로 정한다. ",
      FLOW_LEVELS.map((l) => `근거 ${LEVEL_LABELS[l]}은 ${LEVEL_MEANINGS[l]}는 뜻이다. `),
      `공식 소스 한 곳과 커뮤니티 검색으로 실린 흐름은 근거 중이 가장 높다. 이때 근거 중은 ${COMMUNITY_LEVEL_MEANINGS.medium}는 뜻이고, 근거 약은 ${COMMUNITY_LEVEL_MEANINGS.weak}는 뜻이다. `,
      "Google Trends와 Mastodon 트렌드는 보조 근거라 함께 보였는지만 적고 수준을 올리지 않는다.",
    ),
    P("커뮤니티 검색은 아래 두 곳이다. 그날 공식 소스에서 오른 이름(Wikimedia 문서 제목, 1372 품목 이름, 민원빅데이터 키워드)을 기계가 그대로 검색해, 최근 7일과 앞 28일에 그 이름이 든 글이 몇 건인지만 센다. 글 본문, 제목, 작성자는 받지 않고 저장하지 않는다. 사람들이 직접 쓴 청원·민원 글의 이름은 검색하지 않는다."),
    h("ul", { className: "p dlines demand-community" }, COMMUNITY_GROUPS.map((g) => h("li", { key: g }, flowCommunityHead({ source: COMMUNITY_INFO[g].label, sample: COMMUNITY_INFO[g].sample })))),
    P("커뮤니티는 치우친 표본이다. 적은 사람이 글 대부분을 쓰고 개발자와 영어 사용자가 많아, 커뮤니티 건수를 사람들 전체의 생각으로 읽지 않는다. 그래서 커뮤니티 검색만으로는 흐름이 되지 않고, 근거 줄마다 그 소스가 어떤 표본인지 함께 적는다."),
    P("최근 7일 검색 결과의 절반 넘게가 한 저장소나 한 계정에서 나왔으면 오른 것으로 세지 않는다. 한 저장소의 이슈 폭주나 한 계정의 반복 글, 봇이 흐름처럼 보이지 않게 하기 위해서다."),
    P(`'${FLOW_TURNING_TEXT}'는 흐름의 공식 소스 근거 모두에서 최근 7일 중 마지막 3일이 앞 4일보다 낮다는 뜻이다. 요일마다 양이 다른 소스가 있어 그날 값을 앞 28일의 같은 요일 평균과 견준 비로 본다. 늘어난 것은 맞지만 정점을 지났을 수 있다는 표시이고 근거 수준은 바꾸지 않는다.`),
    P("숫자는 모두 기계가 공식 소스와 커뮤니티 검색에서 센 값이고 다시 셀 수 있다. 어느 소스들이 같은 흐름인지 잇고 제목과 요지를 쓴 것은 AI 판단이라 틀릴 수 있다."),
    P("공식 소스는 공개가 하루 이틀 늦고, 1372 소비자상담은 더 늦다. 민원과 청원은 목소리를 낸 일부 사람의 것이라 모두의 생각을 대표하지 않는다. 한 사람에게 쏠린 관심은 흐름으로 싣지 않는다."),
    P("받은 원본(청원 글, 민원 글, 순위표, 공시 원문, 커뮤니티 글)은 싣지 않는다. 청원, 민원 질의응답, 공개제안처럼 사람들이 직접 쓴 글은 제목도 싣지 않고 건수만 보인다. 출처 링크는 각 기관의 공식 공개 페이지와 커뮤니티 검색의 공식 안내 페이지다."),
    h("p", { className: "p demand-credits" }, "출처 표시: ", credits(OFFICIAL_GROUPS), ". 보조 근거: ", credits(AUX_GROUPS), "."),
    P("민원빅데이터 오늘의 이슈는 국민권익위원회가 공공누리 제2유형(출처표시, 상업적 이용금지)으로 개방한 자료를 이용했다."),
    h(DemandCoverage),
    h(
      "p",
      { className: "p dcover-note" },
      `흐름 목록 끝의 '${DEMAND_MISSING_LABEL}'는 그날 비교에서 빠진 소스다. 공식 소스는 묶음의 소스가 모두 비교 창을 채우지 못한 묶음을 이름만 적는다. 소스가 빠지는 상태는 ${(Object.keys(SOURCE_STATE_NAMES) as SourceState[]).filter((k) => k !== "ok").map((k) => SOURCE_STATE_NAMES[k]).join(", ")}이다. 커뮤니티 검색은 이유를 괄호에 적는다. 괄호 안 낱말의 뜻은 이렇다. `,
      COMMUNITY_MISSING_REASONS.map((r) => `${COMMUNITY_MISSING_NAMES[r]}: ${COMMUNITY_MISSING_MEANINGS[r]}. `),
    ),
  );
}
