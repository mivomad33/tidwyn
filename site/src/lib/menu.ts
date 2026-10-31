// 머리글 메뉴. 앱의 메뉴와 정적 HTML의 메뉴가 같은 목록을 쓴다.

export const CORRECTIONS_PATH = "/about#corrections";
export const CORRECTIONS_LABEL = "오류 정정과 연락";

export const SKIP_LABEL = "본문으로 건너뛰기";

export const MENU: readonly [string, string][] = [
  ["/", "최근 브리프"],
  ["/dates", "날짜 목록"],
  ["/issues", "이슈 목록"],
  ["/schedules", "일정"],
  ["/indicators", "지표"],
  ["/entities", "인물·기관·국가"],
  ["/terms", "용어 사전"],
  ["/search", "검색"],
  ["/about", "사이트 소개"],
  [CORRECTIONS_PATH, CORRECTIONS_LABEL],
];
