// 9.97단계 수요 탭의 화면 로직(4.4-1): 탭 이름, 날짜 상태 문구, 근거 줄과 근거 수준의 글자. 화면(DOM) 없이 테스트한다.
import { BASE_DAYS, CATEGORY_LABELS, GROUP_INFO, RECENT_DAYS, LEVEL_LABELS, LEVEL_MEANINGS, fieldLabel, type FlowLevel, type OfficialGroup } from "../../../src/demandFlowTypes.ts";
import { flowUnitSourceText, type DayDemand, type SiteFlowItem, type SiteFlowUnit } from "../../../src/siteTypes.ts";
import { monthDay } from "./format.ts";
import { fmtNumber } from "./indicators.ts";

/** 브리프 섹션 탭 끝(빌더 다음)의 수요 탭 */
export const DEMAND_TAB = "수요";

/** 수요 탭 이름: "수요 N" */
export function demandTabLabel(count: number): string {
  return `${DEMAND_TAB} ${count}`;
}

/** 항목이 없는 날의 상태 문구(4.4-1). 받지 못한 날은 오류 글자색으로 보인다 */
export function demandZeroText(status: DayDemand["status"]): string {
  if (status === "failed") return "이날의 수요 흐름을 정리하지 못했다.";
  if (status === "short") return "비교할 기록이 아직 모자라 흐름을 정리하지 않았다.";
  return "이날은 서로 다른 소스 두 곳 이상에서 함께 보인 흐름이 없다.";
}

/** 항목이 있는 날의 목록 끝 안내: 비교에 넣지 못한 공식 묶음 */
export function demandMissingText(missing: readonly OfficialGroup[] | undefined): string | null {
  return missing?.length ? `이날 비교에 넣지 못한 소스: ${missing.map((g) => GROUP_INFO[g].label).join(", ")}` : null;
}

/** 흐린 대분류 줄: 갈래 · 분야 */
export function flowCategoryText(x: Pick<SiteFlowItem, "category" | "field">): string {
  return `${CATEGORY_LABELS[x.category]} · ${fieldLabel(x.field)}`;
}

/** 근거 수준 줄: '근거 중 · 서로 다른 공식 소스 두 곳에서 함께 올랐다' */
export function flowLevelText(level: FlowLevel): string {
  return `근거 ${LEVEL_LABELS[level]} · ${LEVEL_MEANINGS[level]}`;
}

/** 기간 글자: 같은 달이면 '10월 25일~31일', 다르면 '9월 27일~10월 24일' */
export function periodText(from: string, to: string): string {
  if (from === to) return monthDay(from);
  const end = from.slice(0, 7) === to.slice(0, 7) ? `${Number(to.slice(8))}일` : monthDay(to);
  return `${monthDay(from)}~${end}`;
}

/** 숫자: 정수는 그대로, 평균은 소수 한 자리까지 */
const num = (n: number) => fmtNumber(n, Number.isInteger(n) ? 0 : 1);

/** 근거 줄의 이름 줄: 묶음·소스 이름과 단위 이름. 외부인 글 소스는 이름 없이 건수만이라 묶음 설명만 남는다(S7) */
export function flowUnitHead(u: SiteFlowUnit): string {
  return u.name === null ? flowUnitSourceText(u) : `${flowUnitSourceText(u)} · ${u.name}`;
}

/** 근거 줄의 숫자: 최근 7일 값과 앞 28일의 같은 길이 평균, 원래 숫자 그대로(S7). 자료 없음 날이 있으면 같은 날 수 기준과 그 날 수를 보인다 */
export function flowUnitNumbers(u: SiteFlowUnit): string {
  const full = u.recentDays === RECENT_DAYS && u.baseDays === BASE_DAYS;
  const recent = full ? `최근 ${RECENT_DAYS}일` : `최근 ${RECENT_DAYS}일 중 자료 있는 ${u.recentDays}일`;
  const base = full ? `앞 ${BASE_DAYS}일의 ${RECENT_DAYS}일 평균` : `앞 ${BASE_DAYS}일 중 자료 있는 ${u.baseDays}일의 ${u.recentDays}일 평균`;
  return `${recent} ${num(u.recent)}${u.unit} · ${base} ${num(u.base)}${u.unit}${u.isNew ? ` · 앞 ${BASE_DAYS}일에는 없었다` : ""}`;
}

/** 근거 줄의 창 기간 */
export function flowUnitPeriod(u: SiteFlowUnit): string {
  return `최근 ${periodText(u.recentFrom, u.recentTo)} · 앞 ${periodText(u.baseFrom, u.baseTo)}`;
}

/** 상위 목록 소스의 값 뜻(4.1-1) */
export const TOP_LIST_NOTE = "값은 목록에 든 날의 합이다. 목록에 들지 않은 날은 세지 않는다.";

/** 항목 끝의 창 기간: 근거 줄들의 가장 이른 시작~가장 늦은 끝 */
export function flowPeriod(units: readonly SiteFlowUnit[]): string {
  const from = units.map((u) => u.baseFrom).sort()[0]!;
  const to = units.map((u) => u.recentTo).sort().at(-1)!;
  return periodText(from, to);
}

/** 보조 근거 줄: 소스 이름만(S6). 급상승어·태그 글은 싣지 않는다 */
export function flowAuxText(aux: readonly string[]): string {
  return `${aux.join(", ")}에서도 보였다. 보조 근거라 근거 수준에 세지 않는다.`;
}

/** 이어짐 링크(S8) */
export function flowContinuesText(date: string): string {
  return `앞서 ${monthDay(date)}에 실은 흐름이 이어진다`;
}
