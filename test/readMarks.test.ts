import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { kstDate } from "../src/kst.ts";
import { DARK, LIGHT, contrast, iconPairs, textPairs } from "../site/src/lib/theme.ts";
import { READ_MARKS_KEY, createReadStore, keepFrom, parseReadMarks, readProgress, serializeReadMarks, type ReadMarks, type StorageLike } from "../site/src/lib/readMarks.ts";

// 4.5단계 읽은 기록(4.1)의 DOM 없는 로직. 뉴스 키와 날짜는 모두 지어낸 것이다.

/** 메모리 저장소(브라우저 localStorage 대신). 다른 키 값도 넣어 둘 수 있다 */
class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

/** 모든 접근이 예외를 던지는 저장소(사생활 보호 모드, 막힌 설정) */
const throwing: StorageLike = {
  getItem() {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("SecurityError");
  },
};

/** 읽기는 되고 쓰기는 용량 초과인 저장소 */
class FullStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error("QuotaExceededError");
  }
}

const TODAY = "2026-10-27";

function marks(entries: Record<string, string[]>): ReadMarks {
  return new Map(Object.entries(entries).map(([d, keys]) => [d, new Set(keys)]));
}

describe("4.1-1 저장", () => {
  test("같은 뉴스를 두 번 더해도 하나만 남고, 빼면 사라진다", () => {
    const storage = new MemoryStorage();
    const store = createReadStore(storage, TODAY);
    store.setRead(TODAY, "한국-1", true);
    store.setRead(TODAY, "한국-1", true);
    assert.equal(store.readCount(TODAY), 1);
    assert.deepEqual(parseReadMarks(storage.getItem(READ_MARKS_KEY)), marks({ [TODAY]: ["한국-1"] }));
    store.setRead(TODAY, "한국-1", false);
    assert.equal(store.isRead(TODAY, "한국-1"), false);
    assert.deepEqual(parseReadMarks(storage.getItem(READ_MARKS_KEY)), new Map());
  });

  test("저장한 기록을 새 저장소가 다시 읽는다", () => {
    const storage = new MemoryStorage();
    const a = createReadStore(storage, TODAY);
    a.setRead(TODAY, "한국-s1", true);
    a.setRead("2026-10-26", "세계-2", true);
    const b = createReadStore(storage, TODAY);
    assert.equal(b.isRead(TODAY, "한국-s1"), true);
    assert.equal(b.isRead("2026-10-26", "세계-2"), true);
    assert.equal(b.isRead(TODAY, "세계-2"), false);
  });

  test("기록이 바뀔 때만 구독자를 부르고 판이 오른다", () => {
    const store = createReadStore(new MemoryStorage(), TODAY);
    let calls = 0;
    const off = store.subscribe(() => calls++);
    store.setRead(TODAY, "한국-1", true);
    store.setRead(TODAY, "한국-1", true);
    store.setRead(TODAY, "한국-2", false);
    assert.equal(calls, 1);
    assert.equal(store.version(), 1);
    off();
    store.setRead(TODAY, "한국-1", false);
    assert.equal(calls, 1);
  });

  test("같은 기록이면 같은 문자열로 저장한다", () => {
    assert.equal(serializeReadMarks(marks({ b: ["y", "x"], a: ["z"] })), serializeReadMarks(marks({ a: ["z"], b: ["x", "y"] })));
  });
});

describe("4.1-3 1년 지난 기록 지우기", () => {
  test("366일 전 기록은 지우고 365일 전과 그 뒤 기록은 남긴다", () => {
    const storage = new MemoryStorage();
    storage.setItem(READ_MARKS_KEY, serializeReadMarks(marks({ "2025-10-26": ["한국-1"], "2025-10-27": ["한국-2"], "2026-03-01": ["세계-1"], [TODAY]: ["IT·AI-s1"] })));
    assert.equal(keepFrom(TODAY), "2025-10-27");
    const store = createReadStore(storage, TODAY);
    assert.equal(store.isRead("2025-10-26", "한국-1"), false);
    assert.equal(store.isRead("2025-10-27", "한국-2"), true);
    assert.equal(store.isRead("2026-03-01", "세계-1"), true);
    assert.equal(store.isRead(TODAY, "IT·AI-s1"), true);
    // 지운 결과를 저장소에도 쓴다
    assert.equal(parseReadMarks(storage.getItem(READ_MARKS_KEY)).has("2025-10-26"), false);
  });

  test("윤년을 지나도 365일로 센다", () => {
    assert.equal(keepFrom("2028-03-01"), "2027-03-02");
  });

  test("오늘은 KST 날짜다(UTC 15:00 앞뒤)", () => {
    const before = kstDate(new Date("2026-10-26T14:59:59Z"));
    const after = kstDate(new Date("2026-10-26T15:00:00Z"));
    assert.equal(before, "2026-10-26");
    assert.equal(after, TODAY);
    const record = serializeReadMarks(marks({ "2025-10-26": ["한국-1"] }));
    const s1 = new MemoryStorage();
    s1.setItem(READ_MARKS_KEY, record);
    assert.equal(createReadStore(s1, before).isRead("2025-10-26", "한국-1"), true, "KST 10월 26일에는 정확히 365일 전이라 남는다");
    const s2 = new MemoryStorage();
    s2.setItem(READ_MARKS_KEY, record);
    assert.equal(createReadStore(s2, after).isRead("2025-10-26", "한국-1"), false, "KST 10월 27일에는 366일 전이라 지운다");
  });
});

describe("4.1-4 저장이 안 되거나 값이 깨졌을 때", () => {
  test("저장소가 예외를 던져도 예외 없이 빈 기록으로 시작하고 탭 안에서는 기억한다", () => {
    const store = createReadStore(throwing, TODAY);
    assert.equal(store.readCount(TODAY), 0);
    store.setRead(TODAY, "한국-1", true);
    assert.equal(store.isRead(TODAY, "한국-1"), true);
    store.clear();
    assert.equal(store.isRead(TODAY, "한국-1"), false);
  });

  test("저장소가 null(쓸 수 없음)이어도 동작한다", () => {
    const store = createReadStore(null, TODAY);
    store.setRead(TODAY, "한국-1", true);
    assert.equal(store.isRead(TODAY, "한국-1"), true);
  });

  test("용량 초과로 쓰지 못해도 탭 안에서는 기억한다", () => {
    const store = createReadStore(new FullStorage(), TODAY);
    store.setRead(TODAY, "한국-1", true);
    assert.equal(store.isRead(TODAY, "한국-1"), true);
  });

  for (const [name, raw] of [
    ["JSON이 아님", "{깨진 값"],
    ["배열", "[1,2]"],
    ["판 번호가 다름", JSON.stringify({ v: 99, d: { [TODAY]: ["한국-1"] } })],
    ["d가 배열", JSON.stringify({ v: 1, d: ["한국-1"] })],
    ["null", "null"],
  ] as const) {
    test(`깨진 값(${name})은 버리고 새로 시작하며 다른 키는 남긴다`, () => {
      const storage = new MemoryStorage();
      storage.setItem(READ_MARKS_KEY, raw);
      storage.setItem("other-key", "그대로");
      const store = createReadStore(storage, TODAY);
      assert.equal(store.readCount(TODAY), 0);
      store.setRead(TODAY, "한국-2", true);
      assert.deepEqual(parseReadMarks(storage.getItem(READ_MARKS_KEY)), marks({ [TODAY]: ["한국-2"] }));
      assert.equal(storage.getItem("other-key"), "그대로");
    });
  }

  test("형식이 맞지 않는 항목만 버린다", () => {
    const raw = JSON.stringify({ v: 1, d: { [TODAY]: ["한국-1", 3, ""], "2026-02-30": ["한국-2"], "2026-10-26": "한국-3", "2026-10-25": ["세계-1"] } });
    assert.deepEqual(parseReadMarks(raw), marks({ [TODAY]: ["한국-1"], "2026-10-25": ["세계-1"] }));
  });

  test("지우기는 이 키만 비우고 다른 키는 남긴다", () => {
    const storage = new MemoryStorage();
    storage.setItem("other-key", "그대로");
    const store = createReadStore(storage, TODAY);
    store.setRead(TODAY, "한국-1", true);
    store.clear();
    assert.equal(store.readCount(TODAY), 0);
    assert.deepEqual(parseReadMarks(storage.getItem(READ_MARKS_KEY)), new Map());
    assert.equal(storage.getItem("other-key"), "그대로");
  });
});

/** 하루 42건의 뉴스 키(섹션마다 주요 뉴스 6건, 짧은 소식 8건) */
function dayKeys(): string[] {
  const keys: string[] = [];
  for (const sec of ["한국", "세계", "IT·AI"]) {
    for (let i = 1; i <= 6; i++) keys.push(`${sec}-${i}`);
    for (let i = 1; i <= 8; i++) keys.push(`${sec}-s${i}`);
  }
  return keys;
}

describe("4.1-5 용량", () => {
  test("하루 42건을 1년 동안 모두 읽은 기록이 1MB(UTF-16) 이하다", () => {
    const keys = dayKeys();
    assert.equal(keys.length, 42);
    const all: ReadMarks = new Map();
    for (let i = 0; i <= 364; i++) {
      const date = new Date(Date.parse(`${TODAY}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10);
      all.set(date, new Set(keys));
    }
    const value = serializeReadMarks(all);
    assert.equal(parseReadMarks(value).size, 365);
    // 로컬 스토리지는 키와 값을 UTF-16(글자당 2바이트)으로 센다
    const bytes = (READ_MARKS_KEY.length + value.length) * 2;
    console.log(`읽은 기록 365일 × 42건: ${value.length.toLocaleString("en-US")}자, ${bytes.toLocaleString("en-US")}바이트(UTF-16)`);
    assert.ok(bytes <= 1024 * 1024, `${bytes}바이트`);
  });
});

describe("4.8-2 대비", () => {
  test("읽음 체크와 동그라미 안 체크가 라이트·다크 모두 3:1 이상이다", () => {
    for (const [name, p] of [["라이트", LIGHT], ["다크", DARK]] as const) {
      for (const pair of iconPairs(p)) {
        const c = contrast(pair.fg, pair.bg);
        console.log(`${name} ${pair.name} ${pair.fg}/${pair.bg} = ${c.toFixed(2)}`);
        assert.ok(c >= 3, `${name} ${pair.name} ${pair.fg}/${pair.bg} = ${c.toFixed(2)}`);
      }
    }
  });
  test("시안의 색을 그대로 쓴다(체크 파랑, 동그라미 안 체크, 안 읽음 테두리)", () => {
    assert.deepEqual([LIGHT.check, LIGHT.checkInk, LIGHT.ring], ["#3b7fd0", "#ffffff", "#d1d1d6"]);
    assert.deepEqual([DARK.check, DARK.checkInk, DARK.ring], ["#6aa5ec", "#161618", "#3a3a3f"]);
    assert.equal(DARK.checkInk, DARK.bg);
  });
  test("날짜 목록·사이트 소개의 새 글자(흐린 글자, 본문)가 4.5:1 이상이다", () => {
    for (const [name, p] of [["라이트", LIGHT], ["다크", DARK]] as const) {
      for (const n of ["본문", "흐린 글자", "본문/상자"]) {
        const pair = textPairs(p).find((x) => x.name === n)!;
        const c = contrast(pair.fg, pair.bg);
        console.log(`${name} ${n} ${pair.fg}/${pair.bg} = ${c.toFixed(2)}`);
        assert.ok(c >= 4.5);
      }
    }
  });
});

describe("4.5-1 날짜 목록의 읽은 정도", () => {
  test("하나도 안 읽으면 비우고, 일부면 읽은 수/전체 수, 모두면 다 읽음", () => {
    assert.deepEqual(readProgress(0, 42), { kind: "none" });
    assert.deepEqual(readProgress(12, 42), { kind: "some", read: 12, total: 42 });
    assert.deepEqual(readProgress(42, 42), { kind: "all" });
    assert.deepEqual(readProgress(3, undefined), { kind: "none" }, "전체 수를 모르면(옛 사이트 데이터) 보이지 않는다");
  });
});
