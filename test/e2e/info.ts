// 준비 스크립트(prepare.ts)가 지어낸 데이터에서 뽑아 남기는 정보. 테스트는 이것으로 기대값을 정한다.
import fs from "node:fs";
import { E2E_INFO_FILE } from "./paths.ts";
import type { SectionName } from "../../src/categories.ts";
import type { EntityListItem, EntityRef, IssueEntity, IssueListItem, TermRef } from "../../src/siteTypes.ts";

export interface E2eInfo {
  /** 저장된 날짜(최근 순) */
  dates: string[];
  latest: { date: string; firstSection: SectionName; otherSection: SectionName; otherTopTitle: string };
  /** 본문에 용어 밑줄이 있고, 본문 표기가 없는 용어(칩만)도 있는 주요 뉴스 */
  termCard: { date: string; key: string; section: SectionName; title: string; underlineTerm: TermRef; chipOnlyTerm: TermRef; entities: EntityRef[] };
  entities: {
    person: EntityListItem;
    org: EntityListItem;
    country: EntityListItem;
    /** 뉴스가 가장 많은 대상(등장 뉴스 "더 보기") */
    most: { id: number; name: string; shown: number; moreNews: number; firstNews: string; nextNews: string | null };
    merged: { id: number; into: number; intoName: string };
    deleted: { id: number; name: string };
  };
  terms: {
    merged: { id: number; into: number; on: string };
    deleted: number;
    /** 용어 사전 맨 끝 묶음의 마지막 용어 */
    far: { id: number; name: string; group: number };
  };
  issues: {
    withEntities: { id: number; name: string; entities: IssueEntity[] };
    merged: { id: number; into: number; intoName: string };
    first: IssueListItem;
  };
}

export function readInfo(): E2eInfo {
  return JSON.parse(fs.readFileSync(E2E_INFO_FILE, "utf8")) as E2eInfo;
}
