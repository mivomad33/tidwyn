// 펼친 카드의 용어 밑줄·설명 토글(E8, 4.7-1)과 용어 사전(4.7-5). 화면(DOM) 없이 테스트한다.
import type { StoryDetail, TermIndex, TermRef } from "./types.ts";

/** 본문 문단 하나. 순서는 한 줄 요약 → 왜 중요한가 → 배경 → 핵심 → 비유 → 전망(제목은 본문이 아니다) */
export interface BodyPart {
  id: string;
  text: string;
}

export function storyBodyParts(detail: Pick<StoryDetail, "summary" | "whyItMatters" | "background" | "keyFacts" | "analogy" | "outlook">): BodyPart[] {
  const parts: BodyPart[] = [
    { id: "summary", text: detail.summary },
    { id: "why", text: detail.whyItMatters },
    { id: "background", text: detail.background },
    ...detail.keyFacts.map((text, i) => ({ id: `fact-${i}`, text })),
  ];
  if (detail.analogy) parts.push({ id: "analogy", text: detail.analogy });
  parts.push({ id: "outlook", text: detail.outlook });
  return parts;
}

/** 문단 글의 한 조각. termId가 있으면 밑줄 낱말이다 */
export interface Segment {
  text: string;
  termId?: number;
}

export interface TermPlacement {
  /** 문단 id → 조각들(밑줄이 없으면 글 하나) */
  segments: Record<string, Segment[]>;
  /** 용어 식별자 → 밑줄을 그은 문단 id. 본문 표기가 없거나 본문에서 찾지 못한 용어는 없다 */
  placed: Map<number, string>;
}

/**
 * 용어마다 본문 표기가 본문 순서로 처음 나온 곳 하나에 밑줄을 둔다.
 * 긴 표기를 먼저 놓고(짧은 표기가 긴 표기 안을 차지하지 않게), 이미 밑줄이 있는 곳과 겹치면 다음에 나온 곳을 쓴다.
 */
export function placeTerms(parts: BodyPart[], terms: TermRef[]): TermPlacement {
  const ranges = new Map<string, { start: number; end: number; termId: number }[]>(parts.map((p) => [p.id, []]));
  const placed = new Map<number, string>();
  const withSurface = terms.filter((t) => t.surface && t.surface.length > 0).sort((a, b) => b.surface!.length - a.surface!.length || a.id - b.id);
  for (const t of withSurface) {
    if (placed.has(t.id)) continue;
    const surface = t.surface!;
    search: for (const p of parts) {
      const taken = ranges.get(p.id)!;
      for (let at = p.text.indexOf(surface); at >= 0; at = p.text.indexOf(surface, at + 1)) {
        const end = at + surface.length;
        if (taken.some((r) => at < r.end && r.start < end)) continue;
        taken.push({ start: at, end, termId: t.id });
        placed.set(t.id, p.id);
        break search;
      }
    }
  }
  const segments: Record<string, Segment[]> = {};
  for (const p of parts) {
    const rs = ranges.get(p.id)!.sort((a, b) => a.start - b.start);
    const out: Segment[] = [];
    let pos = 0;
    for (const r of rs) {
      if (r.start > pos) out.push({ text: p.text.slice(pos, r.start) });
      out.push({ text: p.text.slice(r.start, r.end), termId: r.termId });
      pos = r.end;
    }
    if (pos < p.text.length || out.length === 0) out.push({ text: p.text.slice(pos) });
    segments[p.id] = out;
  }
  return { segments, placed };
}

/** 설명 토글: 닫혀 있으면 열고, 같은 용어면 닫고, 다른 용어면 그것으로 바꾼다(한 카드에 하나) */
export function toggleTerm(open: number | null, id: number): number | null {
  return open === id ? null : id;
}

/** 열린 용어의 설명 상자 자리: 밑줄이 있으면 그 문단 아래, 없으면 칩 줄 아래 */
export function termBoxPlace(open: number | null, placement: TermPlacement): string | "chips" | null {
  if (open === null) return null;
  return placement.placed.get(open) ?? "chips";
}

// ---- 용어 사전 ----

export interface TermTarget {
  id: number;
  group: number;
  /** 흡수된 용어 주소로 들어왔으면 그 정보 */
  mergedFrom: { id: number; on: string | null } | null;
}

/** 용어 주소의 식별자 → 보일 용어와 그 묶음. 흡수된 용어는 남는 용어로, 지웠거나 없는 식별자는 null */
export function resolveTerm(id: number, index: Pick<TermIndex, "ids" | "merged">): TermTarget | null {
  const key = String(id);
  const merged = index.merged[key];
  if (merged) {
    const group = index.ids[String(merged.into)];
    return group === undefined ? null : { id: merged.into, group, mergedFrom: { id, on: merged.on } };
  }
  const group = index.ids[key];
  return group === undefined ? null : { id, group, mergedFrom: null };
}

/** 처음에 받는 묶음: 용어가 있는 앞쪽 묶음부터 용어 수가 이 값에 닿을 때까지(첫 화면을 채울 만큼) */
export const INITIAL_TERMS = 30;

export function initialTermGroups(index: Pick<TermIndex, "groups">, minTerms = INITIAL_TERMS): number[] {
  const out: number[] = [];
  let n = 0;
  for (const g of index.groups) {
    if (g.count === 0) continue;
    if (n >= minTerms) break;
    out.push(g.group);
    n += g.count;
  }
  return out;
}

export { buildTermFiles, sortTerms } from "../../../src/siteTypes.ts";

/** 검색 결과에 보일 설명 앞부분 */
export function excerpt(text: string, max = 60): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()}…`;
}

export function termDomId(id: number): string {
  return `term-${id}`;
}

export function termGroupDomId(group: number): string {
  return `g-${group}`;
}
