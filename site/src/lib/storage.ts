// 로컬 스토리지 키 하나에 두는 작은 화면 기억(4.5단계 섹션 탭, 5단계 일정 보기와 '이번 주 일정' 접기). 화면(DOM) 없이 테스트한다.
// 저장할 수 없거나(막힌 설정, 용량 초과) 값이 깨졌으면 기본값으로 시작하고, 그 탭 안에서만 기억한다.
import type { StorageLike } from "./readMarks.ts";

/** 저장된 글자. 저장소가 없거나 예외를 던지면 null */
export function readStored(storage: StorageLike | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 저장한다. 저장하지 못해도 예외를 내지 않는다(부르는 쪽은 메모리의 값을 그대로 쓴다) */
export function writeStored(storage: StorageLike | null, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // 기억하지 못해도 이 탭에서는 고른 값을 보인다
  }
}

export interface Remembered<T> {
  get(): T;
  set(value: T): void;
  subscribe(listener: () => void): () => void;
}

/** 키 하나의 기억. 만들 때 한 번 읽고, 바꾸면 메모리와 저장소에 함께 둔다(화면을 옮겨도 같은 값을 본다) */
export function createRemembered<T>(storage: StorageLike | null, key: string, parse: (raw: string | null) => T, serialize: (value: T) => string): Remembered<T> {
  let value = parse(readStored(storage, key));
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      writeStored(storage, key, serialize(next));
      for (const l of listeners) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
