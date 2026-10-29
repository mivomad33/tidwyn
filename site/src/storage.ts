// 브라우저 기억의 화면 쪽. 읽은 기록(readMarks.ts)과 화면 기억(섹션 탭, 일정 보기, '이번 주 일정' 접기)이 같은 저장소를 쓴다.
// 각 기억은 로컬 스토리지 키 하나이고, 사이트 소개의 "읽은 기록 지우기"는 읽은 기록 키만 지운다(4.5단계 M8, 5단계 4.7-3·4.7-4).
import { useSyncExternalStore } from "react";
import type { StorageLike } from "./lib/readMarks.ts";
import { SCHEDULE_VIEW_KEY, WEEK_BOX_KEY, parseScheduleView, parseWeekCollapsed, type ScheduleView } from "./lib/schedules.ts";
import { createRemembered, type Remembered } from "./lib/storage.ts";

/** 로컬 스토리지. 접근만 해도 예외가 나는 브라우저(막힌 설정 등)면 null(메모리에만 둔다) */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 일정 화면에서 마지막으로 고른 보기(처음엔 목록) */
export const scheduleView: Remembered<ScheduleView> = createRemembered(browserStorage(), SCHEDULE_VIEW_KEY, parseScheduleView, (v) => v);

/** '이번 주 일정'을 접었는지(처음엔 펼침). 다른 날짜와 다음 방문에도 이어진다 */
export const weekCollapsed: Remembered<boolean> = createRemembered(browserStorage(), WEEK_BOX_KEY, parseWeekCollapsed, (v) => (v ? "closed" : "open"));

export function useRemembered<T>(store: Remembered<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
