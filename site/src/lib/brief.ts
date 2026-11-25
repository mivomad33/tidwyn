// 브리프 화면의 섹션·카테고리 거르기와 `#<뉴스 키>` 처리(4.2-2, 4.2-4). 4.5단계: 세 섹션을 한 목록으로 보는 '전체' 탭. B1: 빌더 탭
import { SECTIONS } from "../../../src/categories.ts";
import type { DayList, ListSection, ListStory, Major, MonthList, SectionName, SourceLike } from "./types.ts";

export const SECTION_ORDER: readonly SectionName[] = SECTIONS;

/** 세 섹션을 한 목록으로 보는 탭(4.5단계, 사용자 결정 2026-10-29) */
export const ALL_TAB = "전체";
/** B1: 그날 GitHub 주간 트렌딩에 처음 오른 저장소 탭(G1). 뉴스 탭 뒤에 두고, 그날 저장소 기록이 있을 때만 보인다(G10) */
export const BUILDER_TAB = "빌더";
/** B1: 그날 빌더 탭을 여는 주소 해시(`#builder`, 3.4). 뉴스 키가 아니다 */
export const BUILDER_HASH = "builder";
export type BriefTab = SectionName | typeof ALL_TAB | typeof BUILDER_TAB;
/** 처음 들어왔을 때(고른 탭 기록이 없을 때)의 탭 */
export const DEFAULT_TAB: BriefTab = "한국";
/** 마지막으로 고른 탭을 기억하는 로컬 스토리지 키(읽은 기록 지우기 대상이 아니다, 정의는 browserKeys.ts) */
export { BRIEF_TAB_KEY } from "./browserKeys.ts";

/** 기억한 탭 값을 읽는다. 없거나 지금 있는 탭이 아니면(지운 탭 '영상'·'수요'의 옛 값 포함, R1 T7) 기본 탭 */
export function parseBriefTab(raw: string | null): BriefTab {
  return raw === ALL_TAB || raw === BUILDER_TAB || SECTION_ORDER.includes(raw as SectionName) ? (raw as BriefTab) : DEFAULT_TAB;
}

/** 그날 빌더 탭이 있는지(저장소 기록이 있는 날만, G10) */
export function hasBuilderTab(day: DayList): boolean {
  return day.repos !== undefined;
}

export interface SectionView {
  section: ListSection | null;
  top: ListStory[];
  short: ListStory[];
}

/**
 * 고른 섹션의 주요 뉴스(순위 순)와 짧은 소식(위치 순). major가 있으면 그 대분류만 남긴다.
 * '전체'면 주요 뉴스를 섹션 순서(한국 → 세계 → IT·AI)로 이어 붙이고 짧은 소식도 같은 순서로 붙인다(섹션 정보 section은 null).
 */
export function sectionView(day: DayList, section: BriefTab, major: Major | null): SectionView {
  // 빌더 탭에는 뉴스가 없다(G1. '전체' 탭에도 저장소를 섞지 않는다)
  if (section === BUILDER_TAB) return { section: null, top: [], short: [] };
  const byPos = (a: ListStory, b: ListStory) => a.position - b.position;
  const pick = (sec: ListSection | undefined) => (sec?.stories ?? []).filter((s) => major === null || s.category.major === major);
  if (section === ALL_TAB) {
    const ordered = SECTION_ORDER.map((name) => pick(day.sections.find((s) => s.name === name)));
    return {
      section: null,
      top: ordered.flatMap((st) => st.filter((s) => s.kind === "top").sort(byPos)),
      short: ordered.flatMap((st) => st.filter((s) => s.kind === "short").sort(byPos)),
    };
  }
  const sec = day.sections.find((s) => s.name === section) ?? null;
  const stories = pick(sec ?? undefined);
  return {
    section: sec,
    top: stories.filter((s) => s.kind === "top").sort(byPos),
    short: stories.filter((s) => s.kind === "short").sort(byPos),
  };
}

/** 그날 있는 섹션(정해진 순서). 비어 있으면 세 섹션 모두 */
export function daySections(day: DayList): SectionName[] {
  const present = SECTION_ORDER.filter((name) => day.sections.some((s) => s.name === name));
  return present.length ? present : [...SECTION_ORDER];
}

export function findDay(month: MonthList, date: string): DayList | null {
  return month.days.find((d) => d.date === date) ?? null;
}

export interface StoryTarget {
  section: SectionName;
  key: string;
  kind: ListStory["kind"];
}

/** `#<뉴스 키>`가 가리키는 뉴스. 없는 키면 null */
export function findStoryTarget(day: DayList, key: string | null): StoryTarget | null {
  if (!key) return null;
  for (const sec of day.sections) {
    const story = sec.stories.find((s) => s.key === key);
    if (story) return { section: sec.name, key: story.key, kind: story.kind };
  }
  return null;
}

export interface BriefViewState {
  section: BriefTab;
  major: Major | null;
  expanded: string | null;
}

/** `#builder`가 그날 빌더 탭을 여는지(기록이 없는 날은 열지 않고 기존 대체 동작을 따른다, G16) */
export function isBuilderTarget(day: DayList, key: string | null): boolean {
  return key === BUILDER_HASH && hasBuilderTab(day);
}

/**
 * 주소의 `#<뉴스 키>`로 들어왔을 때의 화면 상태. 그 뉴스의 섹션을 고르고('전체' 탭이면 전체에 머문다),
 * 카테고리 필터가 그 뉴스를 가리면 "전체"로 돌리고, 주요 뉴스면 펼친다. `#builder`면 그날 빌더 탭을 연다(B1).
 * 키가 없거나 틀리면(지운 탭의 옛 주소, 빌더 기록이 없는 날의 `#builder` 포함, R1 T7) 지금 상태를 그대로 둔다
 * (섹션은 그날 있는 탭으로 맞춘다: 빌더 탭이 그날 없으면 그날 첫 섹션 탭, G16).
 */
export function stateForHash(day: DayList, key: string | null, current: BriefViewState): BriefViewState {
  const sections = daySections(day);
  if (isBuilderTarget(day, key)) return { ...current, section: BUILDER_TAB, expanded: null };
  const keep = current.section === ALL_TAB || (current.section === BUILDER_TAB ? hasBuilderTab(day) : sections.includes(current.section));
  const base = keep ? current : { ...current, section: sections[0]! };
  const target = findStoryTarget(day, key);
  if (!target) return { ...base, expanded: null };
  const story = day.sections.find((s) => s.name === target.section)!.stories.find((s) => s.key === target.key)!;
  const major = base.major !== null && base.major !== story.category.major ? null : base.major;
  return { section: base.section === ALL_TAB ? ALL_TAB : target.section, major, expanded: target.kind === "top" ? target.key : null };
}

/** 대표 출처를 앞에 둔다(그 밖의 순서는 그대로) */
export function orderSources<T extends SourceLike>(sources: T[]): T[] {
  return [...sources.filter((s) => s.primary), ...sources.filter((s) => !s.primary)];
}

/** 펼친 카드에 보일 이미지: 대표 출처의 이미지, 없으면 처음 나오는 이미지 */
export function storyImage(sources: SourceLike[]): string | null {
  const ordered = orderSources(sources);
  return ordered.find((s) => s.imageUrl)?.imageUrl ?? null;
}

/** 그 날짜의 섹션 탭: 전체 → 그날 있는 섹션들 → 빌더(그날 저장소 기록이 있을 때만, G1·G10) */
export function briefTabs(day: DayList): BriefTab[] {
  const tabs: BriefTab[] = [ALL_TAB, ...daySections(day)];
  if (hasBuilderTab(day)) tabs.push(BUILDER_TAB);
  return tabs;
}
