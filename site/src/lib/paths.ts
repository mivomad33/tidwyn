// 사이트 데이터·검색 색인 주소. 파일 이름은 src/siteTypes.ts의 `siteFiles`와 같다(테스트가 맞대어 본다).

export const DATA_BASE = "/site-data/";
export const PAGEFIND_BASE = "/pagefind/";

export const dataUrl = {
  dates: () => `${DATA_BASE}dates.json`,
  list: (month: string) => `${DATA_BASE}list-${month}.json`,
  detail: (month: string) => `${DATA_BASE}detail-${month}.json`,
  issueList: () => `${DATA_BASE}issue-list.json`,
  issueChunk: (chunk: number) => `${DATA_BASE}issue-${chunk}.json`,
};

/** 이슈 식별자 묶음 크기(siteTypes의 ISSUE_CHUNK_SIZE와 같다) */
export const ISSUE_CHUNK = 100;

export function chunkOf(id: number): number {
  return Math.floor(id / ISSUE_CHUNK);
}
