// 사이트 데이터·검색 색인 주소. 파일 이름은 src/siteTypes.ts의 `siteFiles`와 같다(테스트가 맞대어 본다).

export const DATA_BASE = "/site-data/";
export const PAGEFIND_BASE = "/pagefind/";

export const dataUrl = {
  dates: () => `${DATA_BASE}dates.json`,
  list: (month: string) => `${DATA_BASE}list-${month}.json`,
  detail: (month: string) => `${DATA_BASE}detail-${month}.json`,
  issueList: () => `${DATA_BASE}issue-list.json`,
  issueChunk: (chunk: number) => `${DATA_BASE}issue-${chunk}.json`,
  entityList: (filter: string, page: number) => `${DATA_BASE}entity-list-${filter}-${page}.json`,
  entityChunk: (chunk: number) => `${DATA_BASE}entity-${chunk}.json`,
  entityNews: (chunk: number) => `${DATA_BASE}entity-news-${chunk}.json`,
  termIndex: () => `${DATA_BASE}term-index.json`,
  termGroup: (group: number) => `${DATA_BASE}term-group-${group}.json`,
  scheduleIndex: () => `${DATA_BASE}schedule-index.json`,
  scheduleMonth: (month: string) => `${DATA_BASE}schedule-month-${month}.json`,
  scheduleRef: (chunk: number) => `${DATA_BASE}schedule-ref-${chunk}.json`,
  indicatorList: () => `${DATA_BASE}indicator-list.json`,
  indicatorSeries: (id: string) => `${DATA_BASE}indicator-${id}.json`,
};

/** 이슈 식별자 묶음 크기(siteTypes의 ISSUE_CHUNK_SIZE와 같다) */
export const ISSUE_CHUNK = 100;

export function chunkOf(id: number): number {
  return Math.floor(id / ISSUE_CHUNK);
}
