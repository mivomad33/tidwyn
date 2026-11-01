// 9.8단계 빌더 탭의 화면 로직(4.6): 탭 이름, 기한 글자, 빈 상태와 끝 안내(B11). 화면(DOM) 없이 테스트한다.
import type { BuilderDue, BuilderStatus } from "../../../src/builderTypes.ts";
import { monthDay } from "./format.ts";
import { longDateText } from "./indicators.ts";

/** 브리프 섹션 탭 끝의 빌더 탭 */
export const BUILDER_TAB = "빌더";

/** 빌더 탭 이름: "빌더 N" */
export function builderTabLabel(count: number): string {
  return `${BUILDER_TAB} ${count}`;
}

/** 다 확인했고 항목이 없는 날(B11). '없음'은 실제로 다 확인한 날에만 쓴다 */
export const BUILDER_NONE = "이날은 실을 만한 도구 변화가 없다.";

/** 다 확인하지 못한 날의 안내. 항목이 없으면 빈 상태로 쓴다. 확인함이면 null */
export function builderNotice(status: BuilderStatus): string | null {
  if (status === "partial") return "일부 소스를 받지 못해 이날의 도구 변화를 다 확인하지 못했다.";
  if (status === "failed") return "이날의 도구 변화를 받지 못했다.";
  return null;
}

/** 항목이 있는 날의 목록 끝 안내. 받지 못한 날에도 다시 알림은 실릴 수 있어 새 변화만 말한다 */
export function builderEndNotice(status: BuilderStatus): string | null {
  return status === "failed" ? "이날 새 변화는 받지 못했다." : builderNotice(status);
}

/** 기한 글자: 일 단위는 날짜, 달 단위는 달, 뒤에 확정·잠정. 공급사 날짜를 그대로 두고 시간대를 바꾸지 않는다 */
export function builderDueText(due: BuilderDue): string {
  return `${longDateText(due.date)} · ${due.state === "confirmed" ? "확정" : "잠정"}`;
}

/** 다시 알림 표시: 원래 항목이 실린 날을 함께 쓴다 */
export function builderReminderText(date: string): string {
  return `다시 알림 · ${monthDay(date)}에 처음 실렸다`;
}
