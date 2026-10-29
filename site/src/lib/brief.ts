// 브리프 화면의 섹션·카테고리 거르기와 `#<뉴스 키>` 처리(4.2-2, 4.2-4). 4.5단계: 세 섹션을 한 목록으로 보는 '전체' 탭
import { SECTIONS } from "../../../src/categories.ts";
import type { DayList, ListSection, ListStory, Major, MonthList, SectionName, SourceLike } from "./types.ts";

export const SECTION_ORDER: readonly SectionName[] = SECTIONS;

/** 세 섹션을 한 목록으로 보는 탭(4.5단계, 사용자 결정 2026-10-29) */
export const ALL_TAB = "전체";
export type BriefTab = SectionName | typeof ALL_TAB;
/** 처음 들어왔을 때(고른 탭 기록이 없을 때)의 탭 */
export const DEFAULT_TAB: BriefTab = "한국";
/** 마지막으로 고른 탭을 기억하는 로컬 스토리지 키(읽은 기록 지우기 대상이 아니다) */
export const BRIEF_TAB_KEY = "tidwyn.briefTab";

/** 기억한 탭 값을 읽는다. 없거나 모르는 값이면 기본 탭 */
export function parseBriefTab(raw: string | null): BriefTab {
  return raw === ALL_TAB || SECTION_ORDER.includes(raw as SectionName) ? (raw as BriefTab) : DEFAULT_TAB;
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

/**
 * 주소의 `#<뉴스 키>`로 들어왔을 때의 화면 상태. 그 뉴스의 섹션을 고르고('전체' 탭이면 전체에 머문다),
 * 카테고리 필터가 그 뉴스를 가리면 "전체"로 돌리고, 주요 뉴스면 펼친다.
 * 키가 없거나 틀리면 지금 상태를 그대로 둔다(섹션은 그날 있는 섹션으로 맞춘다).
 */
export function stateForHash(day: DayList, key: string | null, current: BriefViewState): BriefViewState {
  const sections = daySections(day);
  const base = current.section === ALL_TAB || sections.includes(current.section) ? current : { ...current, section: sections[0]! };
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
