import type { Category, Source } from "./brief.ts";
import type { Confidence, Major, SectionName } from "./categories.ts";

// 사이트 데이터 형식(3단계 4.1). DB에서 만들고(siteData.ts) 사이트 화면(site/)이 읽는다.
// 파일은 결과물의 `site-data/` 아래에 둔다. 이름은 백업 파일 이름(`YYYY-MM.json`, `issues.json`, `meta.json`)과 겹치지 않는다.

export const SITE_DATA_VERSION = 1;
export const SITE_DATA_DIR = "site-data";
/** 이슈 상세는 식별자를 이 크기로 묶은 파일에 둔다(파일 수 한도, 4.1-3) */
export const ISSUE_CHUNK_SIZE = 100;

export const siteFiles = {
  dates: "dates.json",
  list: (month: string) => `list-${month}.json`,
  detail: (month: string) => `detail-${month}.json`,
  issueList: "issue-list.json",
  issueChunk: (chunk: number) => `issue-${chunk}.json`,
  /** 4단계: 대상 목록(거르기 하나와 쪽 번호마다), 대상 상세 묶음, 상세 묶음의 나머지 뉴스, 용어 색인과 첫 자음 묶음 */
  entityList: (filter: EntityFilter, page: number) => `entity-list-${filter}-${page}.json`,
  entityChunk: (chunk: number) => `entity-${chunk}.json`,
  entityNews: (chunk: number) => `entity-news-${chunk}.json`,
  termIndex: "term-index.json",
  termGroup: (group: number) => `term-group-${group}.json`,
  /** 5단계: 일정 색인(달 목록), 달별 일정, 식별자 묶음(식별자 → 달, 흡수된 것 → 남는 것) */
  scheduleIndex: "schedule-index.json",
  scheduleMonth: (month: string) => `schedule-month-${month}.json`,
  scheduleRef: (chunk: number) => `schedule-ref-${chunk}.json`,
  /** 6단계: 지표 목록(카드·관련 이슈), 지표마다의 최근 5년 값 */
  indicatorList: "indicator-list.json",
  indicatorSeries: (id: string) => `indicator-${id}.json`,
} as const;

export function issueChunkOf(id: number): number {
  return Math.floor(id / ISSUE_CHUNK_SIZE);
}

// ---- 4단계: 인물·기관·국가(대상)와 용어 ----

export const ENTITY_KINDS = ["인물", "기관", "국가"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/** 대상 목록 거르기: 전체와 종류 셋. 파일 이름에 쓴다 */
export const ENTITY_FILTERS = ["all", "person", "org", "country"] as const;
export type EntityFilter = (typeof ENTITY_FILTERS)[number];
export const ENTITY_FILTER_KIND: Record<Exclude<EntityFilter, "all">, EntityKind> = { person: "인물", org: "기관", country: "국가" };

/** 대상 상세는 식별자를 이 크기로 묶은 파일에 둔다(이슈와 같은 크기, 파일 수 한도 4.6-2) */
export const ENTITY_CHUNK_SIZE = 100;
/** 대상 목록 한 쪽의 줄 수. 거르기마다 첫 쪽만 처음에 받는다(4.6-2) */
export const ENTITY_LIST_PAGE_SIZE = 300;
/** 대상 상세 묶음에 넣는 등장 뉴스 수(최근 순). 나머지는 entity-news 묶음으로 "더 보기"에서 받는다 */
export const ENTITY_FIRST_NEWS = 20;

/** 이슈 페이지의 등장 대상 최대 수 */
export const ISSUE_ENTITY_LIMIT = 10;

export function entityChunkOf(id: number): number {
  return Math.floor(id / ENTITY_CHUNK_SIZE);
}

/**
 * 검색 레코드 주소(3단계 P6을 넓힘). 이슈처럼 묶어서 레코드 하나로 둔다:
 * 대상은 상세 묶음(entityChunkOf) 하나에 레코드 하나(meta kind "entities", chunk),
 * 용어는 첫 자음 묶음(termGroupOf) 하나에 레코드 하나(meta kind "terms", group). 흡수·지운 것은 넣지 않는다.
 */
export function entityRecordUrl(chunk: number): string {
  return `/entities/chunk/${chunk}`;
}

export function termRecordUrl(group: number): string {
  return `/terms/group/${group}`;
}

/** 용어 사전의 첫 자음 묶음. 된소리는 예사소리 묶음에 넣고, 한글이 아닌 첫 글자(영문·숫자 등)는 마지막 묶음이다 */
export const TERM_GROUPS = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "영문·숫자"] as const;

/** 한글 음절의 초성 19개 → 묶음 번호(된소리 ㄲㄸㅃㅆㅉ는 예사소리) */
const CHOSEONG_GROUP = [0, 0, 1, 2, 2, 3, 4, 5, 5, 6, 6, 7, 8, 8, 9, 10, 11, 12, 13];
/** 낱자 자음(ㄱ~ㅎ) → 묶음 번호 */
const JAMO_GROUP: Record<string, number> = { ㄱ: 0, ㄲ: 0, ㄴ: 1, ㄷ: 2, ㄸ: 2, ㄹ: 3, ㅁ: 4, ㅂ: 5, ㅃ: 5, ㅅ: 6, ㅆ: 6, ㅇ: 7, ㅈ: 8, ㅉ: 8, ㅊ: 9, ㅋ: 10, ㅌ: 11, ㅍ: 12, ㅎ: 13 };

/** 용어 이름의 첫 자음 묶음 번호(TERM_GROUPS의 위치) */
export function termGroupOf(name: string): number {
  const ch = name.trim().normalize("NFC").charAt(0);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return CHOSEONG_GROUP[Math.floor((code - 0xac00) / 588)]!;
  return JAMO_GROUP[ch] ?? TERM_GROUPS.length - 1;
}

/** 용어 사전 순서: 묶음 순, 묶음 안에서는 한국어 가나다순(영문은 대소문자 무시, 숫자가 앞), 같으면 식별자 순 */
export function compareTerms(a: { id: number; name: string }, b: { id: number; name: string }): number {
  return termGroupOf(a.name) - termGroupOf(b.name) || a.name.localeCompare(b.name, "ko", { numeric: true, sensitivity: "base" }) || a.id - b.id;
}

/** 펼친 카드의 대상 칩 */
export interface EntityRef {
  id: number;
  name: string;
  kind: EntityKind;
  description: string;
}

/** 펼친 카드의 용어. surface는 본문에 나온 표기(없으면 항목이 없다, 칩으로만 연다) */
export interface TermRef {
  id: number;
  name: string;
  description: string;
  surface?: string;
}

/** 이슈 페이지의 등장 대상: 그 이슈 뉴스에 나온 횟수 */
export interface IssueEntity {
  id: number;
  name: string;
  count: number;
}

/** 흡수된 식별자 → 남는 것(사슬을 끝까지 따라간 값)과 합친 날짜 */
export type MergedMap = Record<string, { into: number; on: string | null }>;

export interface EntityListItem {
  id: number;
  name: string;
  kind: EntityKind;
  description: string;
  latestDate: string;
  /** 등장한 뉴스 수 */
  count: number;
}

/** `entity-list-<거르기>-<쪽>.json`: 최근 등장일 순(같으면 뉴스 수 많은 순, 식별자 순). 대상이 없어도 0쪽은 있다 */
export interface EntityListPage {
  filter: EntityFilter;
  page: number;
  pages: number;
  total: number;
  items: EntityListItem[];
}

/** 대상이 등장한 뉴스 한 건 */
export interface EntityNews {
  date: string;
  key: string;
  kind: "top" | "short";
  /** 주요 뉴스는 제목, 짧은 소식은 요약 */
  title: string;
  /** 주 이슈 이름(흡수된 이슈는 남는 이슈). 없으면 null */
  issue: string | null;
}

export interface EntityDetail extends EntityListItem {
  aliases: string[];
  firstDate: string;
  /** 등장한 이슈: 대상이 나온 뉴스의 주 이슈(흡수된 이슈는 남는 이슈로 묶는다)와 그 뉴스 수. 많은 순, 같으면 식별자 순 */
  issues: IssueEntity[];
  /** 최근 순 처음 ENTITY_FIRST_NEWS건 */
  news: EntityNews[];
  /** news 뒤에 더 있는 뉴스 수(entity-news 묶음에 있다) */
  moreNews: number;
  /** 9.5단계: 다른 이슈·대상·지표와 이름이 같으면 true(페이지 제목을 구분한다). 아니면 항목을 뺀다 */
  dupName?: true;
}

/** `entity-<묶음>.json`: 흡수·지운 것은 entities에 없다. 흡수된 식별자는 merged에만 있다 */
export interface EntityChunk {
  entities: Record<string, EntityDetail>;
  merged: MergedMap;
}

/** `entity-news-<묶음>.json`: 대상 식별자 → news 뒤의 나머지 뉴스(최근 순). 더 있는 대상만 넣는다 */
export interface EntityNewsChunk {
  news: Record<string, EntityNews[]>;
}

export interface TermItem {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  /** 처음 나온 뉴스(가장 이른 연결) */
  first: { date: string; key: string; title: string } | null;
  /** 나온 뉴스 수 */
  count: number;
}

/** `term-index.json`: 용어 사전 첫 화면. 용어가 없어도 있다 */
export interface TermIndex {
  total: number;
  /** TERM_GROUPS 순서 그대로, 용어 수가 0인 묶음 포함 */
  groups: { group: number; label: string; count: number }[];
  /** 용어 식별자 → 묶음 번호(흡수·지운 것 제외) */
  ids: Record<string, number>;
  merged: MergedMap;
}

/** `term-group-<묶음>.json`: 그 묶음의 용어, compareTerms 순. 용어가 있는 묶음만 파일이 있다 */
export interface TermGroupFile {
  group: number;
  terms: TermItem[];
}

export interface IssueRef {
  id: number;
  name: string;
}

// ---- 5단계: 일정 ----

/** 일정 식별자 묶음 크기(식별자 → 달을 찾는 파일, 파일 수 한도 4.6-2) */
export const SCHEDULE_REF_CHUNK_SIZE = 1000;
/** 브리프 위 '이번 주 일정'에 보이는 최대 수(4.7-4) */
export const WEEK_SCHEDULE_LIMIT = 5;
/** '이번 주 일정'의 범위: 브리프 날짜 다음 날부터 이 날수 안(C8) */
export const WEEK_DAYS = 7;
/** 이슈 페이지에 보이는 다가오는·지난 일정 최대 수(4.7-5) */
export const ISSUE_SCHEDULE_LIMIT = 5;

export function scheduleRefChunkOf(id: number): number {
  return Math.floor(id / SCHEDULE_REF_CHUNK_SIZE);
}

/** 결과 뉴스 한 건 */
export interface ScheduleNews {
  date: string;
  key: string;
  title: string;
}

/**
 * 결과 상태(4.1, 4.6-1): 결과 연결(결과 뉴스들), 연기(새 일정, 가리키던 일정을 지웠으면 to가 null = 연기(새 날짜 모름)),
 * 취소, 결과 기다림(표시 없음), 결과 못 찾음. 결과 기다림·결과 못 찾음은 빌드할 때의 기준일(DB의 가장 최근 저장 날짜)로 계산한다.
 */
export type ScheduleOutcomeView =
  | { status: "result"; news: ScheduleNews[] }
  | { status: "postponed"; to: { id: number; due: string } | null }
  | { status: "cancelled" }
  | { status: "pending" }
  | { status: "missing" };

/** 펼친 카드의 일정 칩. due는 일 단위 `YYYY-MM-DD`나 달 단위 `YYYY-MM` */
export interface ScheduleChip {
  id: number;
  name: string;
  due: string;
}

/** 결과가 붙은 일정 한 줄('이번 주 일정', 이슈 페이지) */
export interface ScheduleLine extends ScheduleChip {
  outcome: ScheduleOutcomeView;
}

/** 일정 화면의 일정 한 줄 */
export interface ScheduleItem extends ScheduleLine {
  major: Major;
  /** 대표 이슈: 처음 근거 뉴스의 주 이슈(흡수된 이슈는 남는 이슈). 없으면 null */
  issue: IssueRef | null;
  /** 관련 이슈: 근거 뉴스와 결과 뉴스의 주 이슈(흡수된 이슈는 남는 이슈), 식별자 순 */
  issues: IssueRef[];
  /** 알려진 날: 처음 근거 뉴스의 날짜 */
  knownOn: string;
  /** 처음 근거 뉴스. 없으면 null */
  first: { date: string; key: string } | null;
}

/** `schedule-index.json`: 일정 화면이 처음 받는 색인. 일정이 없어도 있다 */
export interface ScheduleIndex {
  /** 흡수·지운 것을 뺀 일정 수 */
  total: number;
  /** 일정이 있는 달(오래된 달부터). 달마다 일정 수와 대분류별 수 */
  months: { month: string; count: number; majors: Partial<Record<Major, number>> }[];
  /** 일정이 있는 대분류(plan D5 순서) */
  majors: Major[];
}

/** `schedule-month-YYYY-MM.json`: 예정일이 그 달인 일정(일 단위와 달 단위). 예정일 순(달 단위는 그 달 일 단위 뒤), 같으면 식별자 순 */
export interface ScheduleMonth {
  month: string;
  items: ScheduleItem[];
}

/** `schedule-ref-<묶음>.json`: 일정 주소(4.7-6)에서 그 일정이 든 달을 찾는다. 흡수된 식별자는 merged에만 있다(남는 것, 사슬 끝) */
export interface ScheduleRefChunk {
  months: Record<string, string>;
  merged: Record<string, number>;
}

/** 브리프 날짜의 '이번 주 일정'(C8): 그 날짜 다음 날부터 7일 안의 일 단위 일정 중 알려진 날이 그 날짜 이하인 것 */
export interface WeekSchedules {
  /** 그 주 일정 전체 수 */
  total: number;
  /** 예정일 순 처음 WEEK_SCHEDULE_LIMIT개 */
  items: ScheduleLine[];
}

/** 일정 정렬: 예정일 순(달 단위 `YYYY-MM`은 그 달 일 단위 뒤), 같으면 식별자 순 */
export function compareSchedules(a: ScheduleChip, b: ScheduleChip): number {
  const ka = a.due.length === 7 ? `${a.due}-99` : a.due;
  const kb = b.due.length === 7 ? `${b.due}-99` : b.due;
  return ka < kb ? -1 : ka > kb ? 1 : a.id - b.id;
}

/** `dates.json`: 저장된 날짜(최근 순)와 달 목록 */
export interface SiteDates {
  version: number;
  latestDate: string | null;
  /** 최근 순 */
  dates: string[];
  /** 최근 순, `YYYY-MM` */
  months: string[];
  /** 4.5단계: 날짜마다 그날 뉴스 수(모든 섹션의 주요 뉴스 + 짧은 소식). `dates`와 같은 순서 */
  storyCounts: number[];
}

/** 하루의 뉴스 수(모든 섹션의 주요 뉴스 + 짧은 소식) */
export function dayStoryCount(day: DayList): number {
  return day.sections.reduce((n, s) => n + s.stories.length, 0);
}

/** "어제에 이어" 표시(4.2-3). 앞 저장일이 하루 전이면 label은 "어제에 이어", 아니면 "<M월 D일>에 이어" */
export interface Continues {
  date: string;
  label: string;
}

/** 목록 화면에 필요한 뉴스 한 줄(펼치지 않은 상태) */
export interface ListStory {
  key: string;
  section: SectionName;
  kind: "top" | "short";
  /** 주요 뉴스는 순위, 짧은 소식은 위치 */
  position: number;
  /** 주요 뉴스는 제목, 짧은 소식은 요약 */
  title: string;
  category: Category;
  /** 주 이슈. 없으면 null */
  issue: IssueRef | null;
  /** 주 이슈가 있고 그날 기준 이전 전개가 없으면 true("새 이슈") */
  newIssue: boolean;
  continues: Continues | null;
  /** 9.5단계: 정정 기록(최신순). 정정이 없으면 항목을 뺀다 */
  corrections?: StoryCorrection[];
}

/** 뉴스 정정 한 건: 고친 날(KST)과 사유 */
export interface StoryCorrection {
  on: string;
  reason: string;
}

export interface ListSection {
  name: SectionName;
  flow: string;
  stories: ListStory[];
  unverified?: string;
}

export interface DayList {
  date: string;
  headline: string;
  keywords: string[];
  sections: ListSection[];
  /** 5단계: '이번 주 일정'. 없으면 항목을 뺀다 */
  week?: WeekSchedules;
  /** 6단계: 브리프 위 상자의 지표 칩(그 브리프 날짜 이하의 가장 최근 값). 없으면 항목을 뺀다 */
  indicators?: IndicatorChip[];
  /** 7단계: 그 브리프 날짜에 붙은 추천 영상(묶음 순 kr → us → ai-ko → ai-en, 묶음 안은 고른 순서). 없으면 항목을 뺀다 */
  videos?: SiteVideo[];
}

/** `list-YYYY-MM.json` */
export interface MonthList {
  month: string;
  /** 오래된 날부터 */
  days: DayList[];
}

export type SiteSource = Source;

/** 펼친 카드(4.2-4)에만 필요한 값. 주요 뉴스만 있다 */
export interface StoryDetail {
  key: string;
  summary: string;
  whyItMatters: string;
  background: string;
  keyFacts: string[];
  analogy?: string;
  outlook: string;
  confidence: Confidence;
  /** 대표 출처가 앞에 온다 */
  sources: SiteSource[];
  extras: IssueRef[];
  /** 그날 기준 이전 전개(P5), 가까운 것부터 최대 3건 */
  previous: { date: string; key: string; title: string }[];
  /** 4단계: 이 뉴스의 대상(식별자 순)과 용어(식별자 순). 없으면 항목을 뺀다 */
  entities?: EntityRef[];
  terms?: TermRef[];
  /** 5단계: 이 뉴스를 근거로 한 일정(예정일 순). 없으면 항목을 뺀다 */
  schedules?: ScheduleChip[];
}

/** `detail-YYYY-MM.json` */
export interface MonthDetail {
  month: string;
  /** 날짜 → 뉴스 키 → 상세 */
  days: Record<string, Record<string, StoryDetail>>;
}

export interface IssueListItem {
  id: number;
  name: string;
  category: Category;
  status: "진행 중" | "종료";
  startDate: string | null;
  latestDate: string | null;
  count: number;
}

/** `issue-list.json` */
export interface SiteIssueList {
  /** 흡수되지 않은 이슈, 최근 업데이트일 순 */
  issues: IssueListItem[];
  /** 흡수된 이슈 식별자 → 남는 이슈(사슬을 끝까지 따라간 값)와 합친 날짜 */
  merged: Record<string, { into: number; on: string | null }>;
}

export interface IssueDetail extends IssueListItem {
  aliases: string[];
  summary: string;
  /** 모든 전개, 최근 순 */
  timeline: { date: string; key: string; title: string }[];
  related: IssueRef[];
  /** 4단계: 등장 대상(횟수 순, 같으면 식별자 순, 최대 10개). 없으면 항목을 뺀다 */
  entities?: IssueEntity[];
  /** 5단계: 관련 일정 전체(예정일 순). 다가오는·지난 구분과 개수 제한은 화면이 보는 사람의 오늘로 한다. 없으면 항목을 뺀다 */
  schedules?: ScheduleLine[];
  /** 6단계: 고른 공개 지표와 그래프 기간(이슈 시작일 30일 전부터 그 지표의 마지막 값 날짜까지). 없으면 항목을 뺀다 */
  indicators?: IssueIndicator[];
  /** 7단계: 이 이슈(와 흡수된 이슈)에 붙은 추천 영상, 붙은 브리프 날짜 최근 순(같은 영상은 한 번). 개수 제한과 30일 숨김은 화면이 한다. 없으면 항목을 뺀다 */
  videos?: IssueVideo[];
  /** 9.5단계: 다른 이슈·대상·지표와 이름이 같으면 true(페이지 제목을 구분한다). 아니면 항목을 뺀다 */
  dupName?: true;
}

/** `issue-<묶음>.json` */
export interface IssueChunk {
  issues: Record<string, IssueDetail>;
}

/** Pagefind `addCustomRecord`에 넣을 레코드(결과물에는 넣지 않는다) */
export interface SearchRecord {
  url: string;
  content: string;
  language: "ko";
  meta?: Record<string, string>;
  filters?: Record<string, string[]>;
}

// 4단계: 대상 목록 쪽과 용어 사전 파일을 만드는 순수 함수. 빌드(src/siteData.ts)와 지어낸 데이터·화면 쪽이 같이 쓴다.

export function matchesEntityFilter(item: { kind: EntityKind }, filter: EntityFilter): boolean {
  return filter === "all" || ENTITY_FILTER_KIND[filter] === item.kind;
}

/** 목록 순서: 최근 등장일이 늦은 것부터, 같으면 뉴스 수가 많은 것, 같으면 식별자 순 */
export function compareEntityItems(a: EntityListItem, b: EntityListItem): number {
  if (a.latestDate !== b.latestDate) return a.latestDate < b.latestDate ? 1 : -1;
  return b.count - a.count || a.id - b.id;
}

/** 거르기 하나의 목록 쪽들(정렬·거르기·쪽 나누기). 대상이 없어도 0쪽은 있다 */
export function entityListPages(items: EntityListItem[], filter: EntityFilter, pageSize = ENTITY_LIST_PAGE_SIZE): EntityListPage[] {
  const sorted = items.filter((i) => matchesEntityFilter(i, filter)).sort(compareEntityItems);
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  return Array.from({ length: pages }, (_, page) => ({ filter, page, pages, total: sorted.length, items: sorted.slice(page * pageSize, (page + 1) * pageSize) }));
}

/** 용어 사전 순서로 정렬한다(묶음 순, 가나다순, 영문·숫자는 마지막) */
export function sortTerms<T extends { id: number; name: string }>(items: T[]): T[] {
  return [...items].sort(compareTerms);
}

/** 용어 사전 색인(term-index.json)과 묶음 파일 내용 */
export function buildTermFiles(items: TermItem[], merged: MergedMap): { index: TermIndex; groups: Map<number, TermItem[]> } {
  const groups = new Map<number, TermItem[]>();
  for (const t of sortTerms(items)) {
    const g = termGroupOf(t.name);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }
  const ids: Record<string, number> = {};
  for (const t of [...items].sort((a, b) => a.id - b.id)) ids[String(t.id)] = termGroupOf(t.name);
  const index: TermIndex = {
    total: items.length,
    groups: TERM_GROUPS.map((label, group) => ({ group, label, count: groups.get(group)?.length ?? 0 })),
    ids,
    merged,
  };
  return { index, groups };
}

/** 등장 횟수 순, 같으면 식별자 순(이슈 페이지의 등장 대상, 대상 페이지의 등장 이슈) */
export function byCount<T extends { id: number; count: number }>(items: Iterable<T>): T[] {
  return [...items].sort((a, b) => b.count - a.count || a.id - b.id);
}

/** 이슈 페이지의 등장 대상: 횟수 순, 같으면 식별자 순, 최대 ISSUE_ENTITY_LIMIT개 */
export function issueEntityChips(entities: IssueEntity[] | undefined): IssueEntity[] {
  return byCount(entities ?? []).slice(0, ISSUE_ENTITY_LIMIT);
}

// ---- 6단계: 지표 ----

export type IndicatorGroupName = "한국" | "미국·국제";

/** 지표의 표시 정보. change는 전날 대비 표시 방식(abs: 단위 그대로의 차이, pct: 퍼센트 변화, pp: 퍼센트포인트) */
export interface IndicatorMetaInfo {
  id: string;
  name: string;
  group: IndicatorGroupName;
  unit: string;
  freq: "day" | "month";
  decimals: number;
  change: "abs" | "pct" | "pp";
  /** 물가: 값이 전년 동월 대비 상승률(%)이다 */
  yoy: boolean;
  credit: string;
}

/** [날짜, 값]. 일별은 `YYYY-MM-DD`, 월별은 `YYYY-MM` */
export type IndicatorPoint = [string, number];

/** 값 하나와 바로 앞 값 대비 변화(change 방식, 앞 값이 없으면 null) */
export interface IndicatorReading {
  date: string;
  value: number;
  change: number | null;
}

export interface IndicatorCard extends IndicatorMetaInfo {
  /** 마지막 값. 값이 하나도 없으면 null(카드와 상자에서 뺀다) */
  last: IndicatorReading | null;
  /** 마지막 값 기준 최근 1년 값(작은 그래프) */
  spark: IndicatorPoint[];
  /** 그 지표를 고른 이슈(최근 업데이트 순) */
  issues: IssueRef[];
}

/** `indicator-list.json`. asOf는 공개 일별 지표의 마지막 값 날짜 중 가장 늦은 날 */
export interface IndicatorList {
  asOf: string | null;
  indicators: IndicatorCard[];
}

/** `indicator-<식별자>.json`: 마지막 값 기준 최근 5년 값 */
export interface IndicatorSeries {
  id: string;
  points: IndicatorPoint[];
}

/** 브리프 위 상자의 칩 하나 */
export interface IndicatorChip extends IndicatorReading {
  id: string;
  name: string;
  unit: string;
  decimals: number;
  kind: "abs" | "pct" | "pp";
}

export interface IssueIndicator {
  id: string;
  from: string;
  to: string;
}


/** 7단계: 추천 영상의 묶음(받은 곳으로 정한다). 화면 순서도 이 순서다 */
export const VIDEO_BUNDLES = ["kr", "us", "ai-ko", "ai-en"] as const;
/** 영상 정보를 받은 날부터 이 날 수가 지나면 지우고(DB·파일, V1) 화면에서 숨긴다(V14). 받은 날을 0일로 세어 29일째까지 남는다 */
export const VIDEO_KEEP_DAYS = 30;
export type VideoBundle = (typeof VIDEO_BUNDLES)[number];

/** 7단계: 사이트에 싣는 영상 하나. 제목·채널·길이·썸네일은 YouTube가 준 그대로다(V8). 설명·통계는 싣지 않는다 */
export interface SiteVideo {
  /** YouTube 영상 ID. 주소는 https://www.youtube.com/watch?v=<id> */
  id: string;
  bundle: VideoBundle;
  title: string;
  channel: string;
  /** 길이(초) */
  seconds: number;
  /** YouTube가 준 썸네일 주소 */
  thumb: string;
  /** Tidwyn(Claude)이 쓴 추천 이유 */
  reason: string;
  /** 8단계: Tidwyn(Claude)이 영상 내용 메모로 쓴 요약. 없으면 항목이 없다. 이슈의 summary와 구별되는 이름이다(공개 전 점검이 찾는다) */
  videoSummary?: string;
  /** 받은 날(KST, YYYY-MM-DD). 화면이 이 날부터 30일이 지나면 숨긴다(V14) */
  fetchedOn: string;
}

/** 7단계: 이슈 페이지의 관련 영상. date는 영상이 붙은 브리프 날짜다 */
export interface IssueVideo extends SiteVideo {
  date: string;
}
