// U2 4.3(C8): 거르기 칩 줄의 칩과 건수. 지금 목록에 있는 값만 칩이 되고 칩마다 건수가 붙는다. 첫 칩은 그 줄이 무엇의 전체인지 쓴다.
// 모든 거르기 칩 줄(브리프 대분류·영상 묶음, 이슈 목록 대분류·상태, 일정 화면 대분류, 인물 목록 종류)이 이 함수와 글을 쓴다(S1).

/** 칩 하나: 값, 건수, 보일 글('IT·AI 3') */
export interface ChipOption<T extends string> {
  value: T;
  count: number;
  label: string;
}

/** 첫 칩의 글(4.3-2). '전체'로 쓰지 않는다(섹션 탭 '전체'와 같은 글이 되지 않게) */
export const ALL_CHIP_TEXT = {
  major: "모든 분야",
  status: "모든 상태",
  video: "모든 영상",
  kind: "모든 종류",
} as const;

/** 건수를 붙인 칩 글 */
export function countLabel(text: string, count: number): string {
  return `${text} ${count.toLocaleString("ko-KR")}`;
}

/** 값과 건수(정해진 순서)를 칩으로. 0건인 값은 뺀다 */
export function chipOptions<T extends string>(counts: Iterable<readonly [T, number]>, order: readonly T[], textOf: (v: T) => string = (v) => v): ChipOption<T>[] {
  const map = new Map(counts);
  return order.flatMap((value) => {
    const count = map.get(value) ?? 0;
    return count > 0 ? [{ value, count, label: countLabel(textOf(value), count) }] : [];
  });
}

/** 목록을 값마다 세어 칩으로(정해진 순서, 0건 값은 뺀다) */
export function countChips<T extends string, X>(items: readonly X[], valueOf: (x: X) => T, order: readonly T[], textOf?: (v: T) => string): ChipOption<T>[] {
  const counts = new Map<T, number>();
  for (const x of items) {
    const v = valueOf(x);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return chipOptions(counts, order, textOf);
}

/** 고른 값이 지금 칩에 없으면(다른 탭·날짜·달, 0건인 주소 값) 첫 칩(null)으로 본다(S12) */
export function keptChip<T extends string>(value: T | null, options: readonly ChipOption<T>[]): T | null {
  return value !== null && options.some((o) => o.value === value) ? value : null;
}
