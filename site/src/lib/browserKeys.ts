// 브라우저(로컬 스토리지)에 두는 기록의 키와 하는 일을 한곳에 모은다(7단계 4.7-4). 키 상수는 모두 여기서 가져다 쓰고,
// 개인정보 처리방침의 "브라우저에만 두는 기록" 목록도 이 정의로 만든다. 키를 새로 쓰면 여기에 더한다.

/** 읽은 뉴스 기록(4.5단계). 사이트 소개의 '읽은 기록 지우기'가 지운다 */
export const READ_MARKS_KEY = "tidwyn.read";
/** 브리프에서 마지막으로 고른 섹션 탭(4.5단계, 7단계 '영상' 탭 포함) */
export const BRIEF_TAB_KEY = "tidwyn.briefTab";
/** 일정 화면에서 마지막으로 고른 보기(5단계) */
export const SCHEDULE_VIEW_KEY = "tidwyn.scheduleView";
/** 브리프 위 '이번 주 일정 | 지표' 상자를 접었는지(5단계 키를 6단계 상자가 그대로 쓴다) */
export const WEEK_BOX_KEY = "tidwyn.weekBox";
/** 브리프 위 상자에서 마지막으로 고른 탭(6단계) */
export const BOX_TAB_KEY = "tidwyn.briefBoxTab";

export interface BrowserKey {
  key: string;
  /** 처리방침에 보일 하는 일(쉬운 한국어) */
  what: string;
}

/** 이 사이트가 쓰는 로컬 스토리지 키 전부(처리방침에 이 순서로 보인다) */
export const BROWSER_KEYS: readonly BrowserKey[] = [
  { key: READ_MARKS_KEY, what: "읽은 뉴스 표시(뉴스 날짜와 뉴스 키만 둔다. 뉴스 날짜로 1년이 지난 기록은 저절로 지워진다)" },
  { key: BRIEF_TAB_KEY, what: "브리프에서 마지막으로 고른 섹션 탭(전체·한국·세계·IT·AI·영상)" },
  { key: SCHEDULE_VIEW_KEY, what: "일정 화면에서 마지막으로 고른 보기(목록·달력)" },
  { key: WEEK_BOX_KEY, what: "브리프 위 '이번 주 일정 | 지표' 상자를 접었는지" },
  { key: BOX_TAB_KEY, what: "브리프 위 상자에서 마지막으로 고른 탭(일정·지표)" },
];
