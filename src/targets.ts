import type { DatabaseSync } from "node:sqlite";
import { addDays, dateRange, kstDate, kstYesterday } from "./kst.ts";
import { getFirstCollectionDate, storedDates } from "./store.ts";

// 대상 날짜 계산(S6, 4.1-3)

export interface TargetPlan {
  dates: string[];
  /** 이번에 처음 기록할 첫 수집일(이미 있으면 null) */
  firstDateToRecord: string | null;
}

/**
 * 첫 실행(첫 수집일 기록 없음)은 KST 어제 하루, 그 뒤에는 첫 수집일부터 어제까지 DB에 없는 날짜 전부를 오래된 날부터.
 * 시작일(시험 모드)이 있으면 그날부터 어제까지 DB에 없는 날짜.
 */
export function planTargets(db: DatabaseSync, now: Date, startDate: string | null = null): TargetPlan {
  const yesterday = kstYesterday(now);
  const recorded = getFirstCollectionDate(db);
  const have = new Set(storedDates(db));
  let from: string;
  let firstDateToRecord: string | null = null;
  if (startDate !== null) {
    from = startDate;
    if (recorded === null) firstDateToRecord = startDate;
  } else if (recorded === null) {
    from = yesterday;
    firstDateToRecord = yesterday;
  } else {
    from = recorded;
  }
  const dates = from <= yesterday ? dateRange(from, yesterday).filter((d) => !have.has(d)) : [];
  return { dates, firstDateToRecord: dates.length > 0 ? firstDateToRecord : null };
}

/** 대상일 다음 날(KST)보다 늦게 수집하면 "늦게 수집"(S6) */
export function isLate(targetDate: string, collectedAt: Date): boolean {
  return kstDate(collectedAt) > addDays(targetDate, 1);
}
