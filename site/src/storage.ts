// 브라우저 기억의 화면 쪽. 읽은 기록(readMarks.ts)과 화면 기억(섹션 탭, 일정 보기)이 같은 저장소를 쓴다.
// 각 기억은 로컬 스토리지 키 하나이고, 사이트 소개의 "읽은 기록 지우기"는 읽은 기록 키만 지운다(4.5단계 M8, 5단계 4.7-3·4.7-4).
import { useSyncExternalStore } from "react";
import type { StorageLike } from "./lib/readMarks.ts";
import { OLD_BOX_TAB_KEY, OLD_WEEK_BOX_KEY } from "./lib/browserKeys.ts";
import { SCHEDULE_VIEW_KEY, parseScheduleView, type ScheduleView } from "./lib/schedules.ts";
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

/**
 * U2 S6: 브리프 위 상자의 펼침은 저장하지 않는다(방문 기록 history.state에만 둔다). 예전에 저장한 값(펼침, 2026-11-27에 없앤 상자 탭)이 남아 있으면 지운다.
 * 저장소를 쓸 수 없어도 오류 없이 넘어간다
 */
export function clearOldWeekBox(storage: Pick<Storage, "removeItem"> | null = browserStorage() as Storage | null): void {
  try {
    storage?.removeItem(OLD_WEEK_BOX_KEY);
    storage?.removeItem(OLD_BOX_TAB_KEY);
  } catch {
    // 지우지 못해도 앱은 그 값을 읽지 않는다
  }
}
clearOldWeekBox();

export function useRemembered<T>(store: Remembered<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}
