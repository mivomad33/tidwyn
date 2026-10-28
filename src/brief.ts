import type { Confidence, Major, SectionName } from "./categories.ts";

// 브리프 데이터(S1). 스킬이 이 구조의 JSON을 쓰고, 검사를 통과한 값이 저장된다.

export interface Source {
  name: string;
  url: string;
  /** 발행일 YYYY-MM-DD */
  publishedAt: string;
  imageUrl?: string;
  /** 대표 출처. 주요 뉴스는 정확히 하나 */
  primary?: boolean;
}

export interface Category {
  major: Major;
  minor: string;
  /** 소분류가 S3 목록 밖이면 true. 저장할 때 계산한다(입력 값은 무시) */
  isNewMinor?: boolean;
}

export interface TopStory {
  rank: number;
  title: string;
  summary: string;
  whyItMatters: string;
  background: string;
  keyFacts: string[];
  analogy?: string;
  outlook: string;
  confidence: Confidence;
  devCheckpoint?: string;
  category: Category;
  sources: Source[];
}

export interface ShortNews {
  summary: string;
  category: Category;
  sources: Source[];
}

export interface Section {
  name: SectionName;
  flow: string;
  topStories: TopStory[];
  shortNews: ShortNews[];
  unverified?: string;
}

export interface Brief {
  targetDate: string;
  headline: string;
  keywords: string[];
  sections: Section[];
}

/** 저장된 브리프: 브리프 데이터 + 수집 정보 */
export interface StoredBrief {
  brief: Brief;
  /** 수집 시각(KST ISO) */
  collectedAt: string;
  /** 대상일 다음 날(KST)보다 늦게 수집(S6) */
  late: boolean;
}
