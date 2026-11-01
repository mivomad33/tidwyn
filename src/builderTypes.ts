// 9.8단계: 빌더 저장과 사이트 화면이 함께 쓰는 값. 화면 코드가 가져오므로 DB(node:sqlite)에 기대지 않는다.

/** 분야(4.3-1) */
export const BUILDER_FIELDS = ["코딩 도구", "모델", "보안", "프레임워크", "플랫폼"] as const;
export type BuilderField = (typeof BUILDER_FIELDS)[number];

/** 빌더 날짜 상태(B11): 확인함, 일부만 확인, 받지 못함 */
export type BuilderStatus = "checked" | "partial" | "failed";
export type BuilderDueState = "confirmed" | "tentative";

export interface BuilderDue {
  /** 일 단위 `YYYY-MM-DD`, 달 단위 `YYYY-MM` */
  date: string;
  state: BuilderDueState;
}

export interface BuilderItemSource {
  name: string;
  url: string;
}

export function builderItemKey(position: number): string {
  return `builder-${position}`;
}

export function isBuilderItemKey(key: unknown): key is string {
  return typeof key === "string" && /^builder-\d+$/.test(key);
}
