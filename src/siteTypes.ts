import type { Category, Source } from "./brief.ts";
import type { Confidence, SectionName } from "./categories.ts";

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
} as const;

export function issueChunkOf(id: number): number {
  return Math.floor(id / ISSUE_CHUNK_SIZE);
}

export interface IssueRef {
  id: number;
  name: string;
}

/** `dates.json`: 저장된 날짜(최근 순)와 달 목록 */
export interface SiteDates {
  version: number;
  latestDate: string | null;
  /** 최근 순 */
  dates: string[];
  /** 최근 순, `YYYY-MM` */
  months: string[];
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
