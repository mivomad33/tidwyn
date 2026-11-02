// 9.8단계 빌더 탭의 화면 로직(4.6): 탭 이름, 기한 글자, 빈 상태와 끝 안내(B11). 화면(DOM) 없이 테스트한다.
// 9.9단계(4.5): 세 종류의 묶음, 종류별 상태 문구(N9), 저장소의 관리 상태와 별 수 글자(N5).
import { DISCOVER_LABELS, type BuilderDue, type BuilderStatus, type DiscoverKind, type KindStatus, type ReleaseInfo } from "../../../src/builderTypes.ts";
import { repoLicenseText, type DayBuilder, type SiteBuilderItem, type SiteDiscoveryItem, type SiteRepoFacts } from "../../../src/siteTypes.ts";
import { monthDay } from "./format.ts";
import { fmtNumber, longDateText } from "./indicators.ts";

/** 브리프 섹션 탭 끝의 빌더 탭 */
export const BUILDER_TAB = "빌더";

/** 빌더 탭 이름: "빌더 N" */
export function builderTabLabel(count: number): string {
  return `${BUILDER_TAB} ${count}`;
}

/** 다 확인했고 항목이 없는 날(B11). '없음'은 실제로 다 확인한 날에만 쓴다 */
export const BUILDER_NONE = "이날은 실을 만한 도구 변화가 없다.";

/** 다 확인하지 못한 날의 안내. 항목이 없으면 빈 상태로 쓴다. 확인함이면 null */
export function builderNotice(status: BuilderStatus): string | null {
  if (status === "partial") return "일부 소스를 받지 못해 이날의 도구 변화를 다 확인하지 못했다.";
  if (status === "failed") return "이날의 도구 변화를 받지 못했다.";
  return null;
}

/** 항목이 있는 날의 목록 끝 안내. 받지 못한 날에도 다시 알림은 실릴 수 있어 새 변화만 말한다 */
export function builderEndNotice(status: BuilderStatus): string | null {
  return status === "failed" ? "이날 새 변화는 받지 못했다." : builderNotice(status);
}

/** 묶음 소제목(N4) */
export const BUILDER_GROUP_NAMES = { tools: "도구 변화", ...DISCOVER_LABELS };

export type BuilderGroup = { kind: "tools"; count: number; status: BuilderStatus | null } | { kind: DiscoverKind; count: number; status: KindStatus };

/** 그날 보일 묶음(정해진 순서). 상태도 항목도 없는 도구 변화와, 요약에 없는 새 종류는 빠진다 */
export function builderGroups(day: DayBuilder): BuilderGroup[] {
  const tools = day.count - (day.product?.count ?? 0) - (day.repo?.count ?? 0);
  const out: BuilderGroup[] = day.status !== null || tools > 0 ? [{ kind: "tools", count: tools, status: day.status }] : [];
  if (day.product) out.push({ kind: "product", ...day.product });
  if (day.repo) out.push({ kind: "repo", ...day.repo });
  return out;
}

/** 새 종류의 0건 문구(N9). 꺼짐은 묶음을 보이지 않아 문구가 없다 */
export function discoverZeroText(kind: DiscoverKind, status: KindStatus): string | null {
  const repo = kind === "repo";
  if (status === "off") return null;
  if (status === "failed") return repo ? "이날의 뜨는 저장소를 받지 못했다." : "이날의 새 제품을 받지 못했다.";
  if (status === "baseline") return "별 수를 재기 시작한 날이다. 뜨는 저장소는 이다음 날부터 나온다.";
  return repo ? "이날은 실을 만한 뜨는 저장소가 없다." : "이날은 실을 만한 새 제품이 없다.";
}

/** 새 종류의 목록 끝 안내: 항목이 있는데 받지 못한 날만 */
export function discoverEndNotice(kind: DiscoverKind, status: KindStatus): string | null {
  return status === "failed" ? `이날 ${BUILDER_GROUP_NAMES[kind]}${kind === "repo" ? "는" : "은"} 다 받지 못했다.` : null;
}

export const isDiscovery = (x: SiteBuilderItem | SiteDiscoveryItem): x is SiteDiscoveryItem => "kind" in x;
/** 검색 결과의 제목과 앞 줄 */
export const builderItemTitle = (x: SiteBuilderItem | SiteDiscoveryItem) => (isDiscovery(x) ? x.name : x.title);
export const builderItemLabel = (x: SiteBuilderItem | SiteDiscoveryItem) => (isDiscovery(x) ? BUILDER_GROUP_NAMES[x.kind] : x.field);

/** 출처 링크의 이름(2.4 소스 표) */
export function discoverySourceName(kind: DiscoverKind): string {
  return kind === "repo" ? "GitHub" : "Product Hunt";
}

function releaseText(release: ReleaseInfo | null): string {
  if (release?.state === "found") return longDateText(release.date);
  return release?.state === "none" ? "없음" : "확인 못 함";
}

/** 관리 상태: 받은 값 그대로(N5) */
export function repoUpkeepText(repo: Pick<SiteRepoFacts, "pushedOn" | "release">): string {
  return `마지막 push ${repo.pushedOn ? longDateText(repo.pushedOn) : "확인 못 함"} · 최근 릴리스 ${releaseText(repo.release)}`;
}

/** 별 수와 증가량. 증가량은 소수 한 자리까지 저장된 하루 평균이다 */
export function repoStarsText(repo: Pick<SiteRepoFacts, "stars" | "growth">): string {
  const stars = repo.stars === null ? "별 수 확인 못 함" : `별 ${fmtNumber(repo.stars, 0)}개`;
  if (repo.growth === null) return stars;
  return `${stars} · 하루 평균 ${repo.growth >= 0 ? "+" : ""}${fmtNumber(repo.growth, Number.isInteger(repo.growth) ? 0 : 1)}개`;
}

/** 기한 글자: 일 단위는 날짜, 달 단위는 달, 뒤에 확정·잠정. 공급사 날짜를 그대로 두고 시간대를 바꾸지 않는다 */
export function builderDueText(due: BuilderDue): string {
  return `${longDateText(due.date)} · ${due.state === "confirmed" ? "확정" : "잠정"}`;
}

/** 다시 알림 표시: 원래 항목이 실린 날을 함께 쓴다 */
export function builderReminderText(date: string): string {
  return `다시 알림 · ${monthDay(date)}에 처음 실렸다`;
}

/** 라이선스 값. '없음'은 제한이 없다는 뜻으로 읽히기 쉬워 표시가 없다는 것을 그대로 쓴다 */
export { repoLicenseText };
