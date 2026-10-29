// 읽은 뉴스 기록의 화면 쪽(4.5단계 4.1). 사이트를 열 때(화면 틀을 처음 불러올 때) 한 번 만들며 오래된 기록을 지우고,
// 모든 화면이 같은 기록을 본다(화면을 옮겨도 새로 고침 없이 바로 반영된다).
import { useSyncExternalStore } from "react";
import { kstDate } from "../../src/kst.ts";
import { createReadStore } from "./lib/readMarks.ts";
import { browserStorage } from "./storage.ts";

export const readStore = createReadStore(browserStorage(), kstDate(new Date()));

/** 그 뉴스를 읽었는지. 기록이 바뀌면 다시 그린다 */
export function useIsRead(date: string, key: string): boolean {
  return useSyncExternalStore(readStore.subscribe, () => readStore.isRead(date, key));
}

/** 기록이 바뀔 때마다 오르는 수(여러 뉴스를 함께 보는 화면이 다시 그리게 한다) */
export function useReadVersion(): number {
  return useSyncExternalStore(readStore.subscribe, readStore.version);
}

export function markRead(date: string, key: string): void {
  readStore.setRead(date, key, true);
}
