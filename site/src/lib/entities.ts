// 인물·기관·국가(대상) 목록·페이지와 이슈 페이지의 등장 대상(4단계 4.7-3·4.7-4·4.7-7). 화면(DOM) 없이 테스트한다.
import { ENTITY_FILTERS } from "../../../src/siteTypes.ts";
import { dateText, yearOf } from "./format.ts";
import type { EntityChunk, EntityDetail, EntityFilter, EntityListItem, EntityListPage } from "./types.ts";

export const ENTITY_FILTER_LABEL: Record<EntityFilter, string> = { all: "전체", person: "인물", org: "기관", country: "국가" };

/** 주소 쿼리 `?kind=`의 값. 모르는 값이면 전체 */
export function parseEntityFilter(value: string | null | undefined): EntityFilter {
  return (ENTITY_FILTERS as readonly string[]).includes(value ?? "") ? (value as EntityFilter) : "all";
}

export { compareEntityItems, entityListPages, matchesEntityFilter } from "../../../src/siteTypes.ts";

/** 받은 쪽들을 이어 붙인다(겹치는 식별자는 앞의 것만) */
export function joinEntityPages(pages: EntityListPage[]): EntityListItem[] {
  const seen = new Set<number>();
  const out: EntityListItem[] = [];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    for (const item of p.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export type EntityResolution = { kind: "entity"; id: number } | { kind: "merged"; into: number; on: string | null } | null;

/**
 * 대상 주소의 식별자를 그 식별자의 상세 묶음에서 찾는다. 있으면 그 대상,
 * 흡수된 식별자면 남는 대상(남는 대상의 묶음에서 다시 확인한다), 지웠거나 없는 식별자면 null.
 */
export function resolveEntity(id: number, chunk: EntityChunk): EntityResolution {
  const key = String(id);
  if (Object.hasOwn(chunk.entities, key)) return { kind: "entity", id };
  const merged = chunk.merged[key];
  if (merged && merged.into !== id) return { kind: "merged", into: merged.into, on: merged.on };
  return null;
}

export { issueEntityChips } from "../../../src/siteTypes.ts";

/** 대상 페이지가 한 번에 더 보이는 뉴스·이슈 수 */
export const ENTITY_MORE_STEP = 100;
/** 대상 페이지가 처음 보이는 등장 이슈 수(나머지는 더 보기) */
export const ENTITY_FIRST_ISSUES = 20;

/** 대상 목록 줄의 머리: "인물 · 최근 10월 27일 · 뉴스 3건"(앱과 정적 HTML이 같이 쓴다, U1 4.3-1). 기준 해는 목록이 정한다 */
export function entityListLine(e: Pick<EntityListItem, "kind" | "latestDate" | "count">, refYear: string | undefined): string {
  return `${e.kind} · 최근 ${dateText(e.latestDate, refYear)} · 뉴스 ${e.count.toLocaleString("ko-KR")}건`;
}

/** 대상 페이지 제목 아래 줄: "별칭: … · 처음 10월 1일 · 최근 10월 27일 · 뉴스 3건". 기준 해는 최근 등장일의 해 */
export function entityMetaLine(e: Pick<EntityDetail, "aliases" | "firstDate" | "latestDate" | "count">): string {
  const ref = yearOf(e.latestDate);
  return [e.aliases.length ? `별칭: ${e.aliases.join(", ")}` : null, `처음 ${dateText(e.firstDate, ref)}`, `최근 ${dateText(e.latestDate, ref)}`, `뉴스 ${e.count.toLocaleString("ko-KR")}건`].filter(Boolean).join(" · ");
}
