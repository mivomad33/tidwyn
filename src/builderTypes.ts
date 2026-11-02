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

/** 9.9단계 새 종류(N4) */
export type DiscoverKind = "product" | "repo";
export const DISCOVER_KINDS: readonly DiscoverKind[] = ["product", "repo"];
export const DISCOVER_LABELS: Record<DiscoverKind, string> = { product: "새 제품", repo: "뜨는 저장소" };
/** checked: 확인함, failed: 받지 못함, off: 꺼짐, baseline: 기준값 쌓는 중(저장소만) */
export type KindStatus = "checked" | "failed" | "off" | "baseline";
export type ReleaseInfo = { state: "found"; date: string } | { state: "none" } | { state: "unknown" };

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

/** 날짜 안의 새 제품·뜨는 저장소 항목 키(`product-<순서>`, `repo-<순서>`). 정정과 사이트가 쓴다 */
export function discoveryItemKey(kind: DiscoverKind, position: number): string {
  return `${kind}-${position}`;
}

export function isDiscoveryItemKey(key: unknown): key is string {
  return typeof key === "string" && /^(?:product|repo)-\d+$/.test(key);
}

/** 빌더 탭의 항목 키(도구 변화, 새 제품, 뜨는 저장소). 뉴스 읽은 수에 세지 않고 주소의 `#`로 빌더 탭을 연다 */
export function isBuilderTabKey(key: unknown): key is string {
  return isBuilderItemKey(key) || isDiscoveryItemKey(key);
}
