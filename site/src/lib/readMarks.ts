// 읽은 뉴스 기록(4.5단계 4.1). 뉴스 식별자(날짜 + 뉴스 키)만 로컬 스토리지 키 하나에 둔다. 화면(DOM) 없이 테스트한다.
// 저장할 수 없거나 값이 깨졌으면 빈 기록으로 시작하고, 그 탭 안에서만 기억한다(4.1-4).
import { addDays, isValidDate } from "../../../src/kst.ts";

/** 로컬 스토리지 키. 이 키만 읽고 쓰고 지운다(다른 키는 건드리지 않는다) */
export const READ_MARKS_KEY = "tidwyn.read";
const FORMAT_VERSION = 1;
/** 뉴스 날짜가 오늘(KST)로부터 이 날 수보다 오래된 기록은 지운다(M5). 정확히 365일 전은 남는다 */
export const KEEP_DAYS = 365;

/** 날짜 → 그날 읽은 뉴스 키 */
export type ReadMarks = Map<string, Set<string>>;

/** 저장소에서 쓰는 부분(브라우저의 localStorage와 같은 모양). 메서드가 예외를 던질 수 있다 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface Stored {
  v: number;
  d: Record<string, string[]>;
}

/** 저장된 값을 읽는다. 없거나 깨졌으면 빈 기록, 형식이 맞지 않는 항목은 버린다 */
export function parseReadMarks(raw: string | null): ReadMarks {
  const marks: ReadMarks = new Map();
  if (raw === null) return marks;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return marks;
  }
  if (!data || typeof data !== "object" || (data as Stored).v !== FORMAT_VERSION) return marks;
  const days = (data as Stored).d;
  if (!days || typeof days !== "object" || Array.isArray(days)) return marks;
  for (const [date, keys] of Object.entries(days)) {
    if (!isValidDate(date) || !Array.isArray(keys)) continue;
    const set = new Set(keys.filter((k): k is string => typeof k === "string" && k !== ""));
    if (set.size) marks.set(date, set);
  }
  return marks;
}

/** 저장할 문자열. 날짜와 키를 정렬해 같은 기록이면 같은 문자열이 된다 */
export function serializeReadMarks(marks: ReadMarks): string {
  const d: Record<string, string[]> = {};
  for (const date of [...marks.keys()].sort()) {
    const keys = [...marks.get(date)!].sort();
    if (keys.length) d[date] = keys;
  }
  return JSON.stringify({ v: FORMAT_VERSION, d } satisfies Stored);
}

/** 남길 가장 오래된 뉴스 날짜 */
export function keepFrom(today: string): string {
  return addDays(today, -KEEP_DAYS);
}

/** 오래된 기록을 지운다. 지운 것이 있으면 true */
export function pruneReadMarks(marks: ReadMarks, today: string): boolean {
  const from = keepFrom(today);
  let changed = false;
  for (const date of [...marks.keys()]) {
    if (date < from) {
      marks.delete(date);
      changed = true;
    }
  }
  return changed;
}

export interface ReadStore {
  isRead(date: string, key: string): boolean;
  setRead(date: string, key: string, read: boolean): void;
  /** 그날 읽은 뉴스 키(복사본) */
  readKeys(date: string): Set<string>;
  readCount(date: string): number;
  clear(): void;
  subscribe(listener: () => void): () => void;
  /** 기록이 바뀔 때마다 오르는 수(화면이 다시 그릴지 정한다) */
  version(): number;
}

/**
 * 기록 저장소. 만들 때 저장된 값을 읽고 오래된 기록을 지운다(지웠거나 값이 깨졌으면 다시 쓴다).
 * storage가 null이거나 예외를 던지면 메모리에만 둔다.
 */
export function createReadStore(storage: StorageLike | null, today: string): ReadStore {
  let raw: string | null;
  try {
    raw = storage?.getItem(READ_MARKS_KEY) ?? null;
  } catch {
    raw = null;
  }
  const marks = parseReadMarks(raw);
  const pruned = pruneReadMarks(marks, today);
  const listeners = new Set<() => void>();
  let ver = 0;

  function save(): void {
    try {
      storage?.setItem(READ_MARKS_KEY, serializeReadMarks(marks));
    } catch {
      // 저장하지 못해도(용량 초과, 막힌 설정) 이 탭의 기록은 메모리에 남는다
    }
  }
  function changed(): void {
    ver++;
    save();
    for (const l of listeners) l();
  }
  if (raw !== null && (pruned || serializeReadMarks(marks) !== raw)) save();

  return {
    isRead: (date, key) => marks.get(date)?.has(key) ?? false,
    setRead(date, key, read) {
      const set = marks.get(date);
      if (read === (set?.has(key) ?? false)) return;
      if (read) {
        if (set) set.add(key);
        else marks.set(date, new Set([key]));
      } else {
        set!.delete(key);
        if (!set!.size) marks.delete(date);
      }
      changed();
    },
    readKeys: (date) => new Set(marks.get(date) ?? []),
    readCount: (date) => marks.get(date)?.size ?? 0,
    clear() {
      marks.clear();
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => ver,
  };
}

export type ReadProgress = { kind: "none" } | { kind: "all" } | { kind: "some"; read: number; total: number };

/** 날짜 목록의 읽은 정도(4.5-1). 하나도 안 읽었거나 전체 수를 모르면 아무것도 보이지 않는다 */
export function readProgress(read: number, total: number | undefined): ReadProgress {
  if (read <= 0 || total === undefined || total <= 0) return { kind: "none" };
  if (read >= total) return { kind: "all" };
  return { kind: "some", read, total };
}
