// 대분류(plan D5)와 소분류 목록(S3)
export const MINORS_BY_MAJOR = {
  "정치": ["행정부", "국회·정당", "선거", "사법·검찰", "북한"],
  "경제": ["거시·정책", "금융·증시", "부동산", "산업·기업", "무역·통상", "노동·일자리"],
  "사회": ["사건·사고", "법·재판", "교육", "복지·인구", "재난·안전"],
  "국제": ["미국", "동아시아", "유럽·러시아", "중동", "기타 지역", "국제기구·안보"],
  "IT·AI": ["AI 모델·연구", "AI 산업·기업", "반도체·하드웨어", "플랫폼·인터넷", "보안", "규제·정책", "개발 도구"],
  "과학·건강": ["우주", "과학 연구", "의료·건강", "기후·환경"],
  "문화·스포츠": ["대중문화", "문화·예술", "스포츠", "생활"],
} as const satisfies Record<string, readonly string[]>;

export type Major = keyof typeof MINORS_BY_MAJOR;
export const MAJORS = Object.keys(MINORS_BY_MAJOR) as Major[];

export function isMajor(value: string): value is Major {
  return Object.hasOwn(MINORS_BY_MAJOR, value);
}

/** 소분류가 그 대분류의 목록에 없으면 새 소분류다(다른 대분류의 소분류를 쓴 경우 포함) */
export function isNewMinor(major: Major, minor: string): boolean {
  return !(MINORS_BY_MAJOR[major] as readonly string[]).includes(minor);
}

/** 섹션은 이 순서로 고정(S1) */
export const SECTIONS = ["한국", "세계", "IT·AI"] as const;
export type SectionName = (typeof SECTIONS)[number];

export const CONFIDENCE_LEVELS = ["여러 출처 확인", "보도에 따르면"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];
