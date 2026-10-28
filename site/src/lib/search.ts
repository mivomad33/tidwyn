// 검색 결과 되찾기(4.3-3, P6, 4.1-3).
// 검색 레코드는 묶음이다: 뉴스는 날짜 하나가 레코드 하나(`/<날짜>`), 이슈는 식별자 100개 묶음이 레코드 하나(`/issues/chunk/<n>`).
// Pagefind가 고른 레코드마다 그 날짜·묶음의 사이트 데이터를 받아, 검색어에 맞는 뉴스·이슈를 하나씩 골라낸다.
// 맞춤 규칙은 Pagefind와 같게 낱말 앞부분 맞춤이다("반도체"가 "반도체가"에 맞는다).
import type { DayList, IssueChunk, IssueDetail, ListStory, StoryDetail } from "./types.ts";
import { SECTION_ORDER } from "./brief.ts";

export function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

/** 글을 낱말로 나눈다(글자·숫자·밑줄이 아닌 것에서 끊는다) */
export function words(text: string): string[] {
  return normalize(text)
    .split(/[^\p{L}\p{N}_]+/u)
    .filter(Boolean);
}

/** 검색어의 낱말(겹치면 하나) */
export function queryTerms(q: string): string[] {
  return [...new Set(words(q))];
}

/** 검색어 낱말 중 글의 어떤 낱말의 앞부분과 같은 것의 수 */
export function countMatches(text: string, terms: string[]): number {
  if (!terms.length) return 0;
  const ws = words(text);
  return terms.filter((t) => ws.some((w) => w.startsWith(t))).length;
}

/** 모든 낱말이 맞는 것만 남기고, 하나도 없으면 가장 많이 맞는 것(1개 이상)을 남긴다. 순서는 그대로 */
function pickBest<T>(items: T[], score: (item: T) => number, total: number): T[] {
  const scored = items.map((item) => ({ item, n: score(item) }));
  const all = scored.filter((s) => s.n === total);
  if (all.length) return all.map((s) => s.item);
  const max = Math.max(0, ...scored.map((s) => s.n));
  return max > 0 ? scored.filter((s) => s.n === max).map((s) => s.item) : [];
}

/** 뉴스의 검색 대상 글: 제목(짧은 소식은 요약), 한 줄 요약, 본문 */
export function storyText(story: ListStory, detail: StoryDetail | undefined): string {
  const parts = [story.title];
  if (detail) {
    parts.push(detail.summary, detail.whyItMatters, detail.background, ...detail.keyFacts, detail.analogy ?? "", detail.outlook);
  }
  return parts.join("\n");
}

/** 걸린 날짜 레코드에서 검색어에 맞는 뉴스(섹션 순, 주요 뉴스 다음 짧은 소식) */
export function matchDayStories(day: DayList, details: Record<string, StoryDetail> | undefined, terms: string[]): ListStory[] {
  const stories: ListStory[] = [];
  for (const name of SECTION_ORDER) {
    const sec = day.sections.find((s) => s.name === name);
    if (!sec) continue;
    const byPos = (a: ListStory, b: ListStory) => a.position - b.position;
    stories.push(...sec.stories.filter((s) => s.kind === "top").sort(byPos), ...sec.stories.filter((s) => s.kind === "short").sort(byPos));
  }
  return pickBest(stories, (s) => countMatches(storyText(s, details?.[s.key]), terms), terms.length);
}

export function issueText(issue: IssueDetail): string {
  return [issue.name, ...issue.aliases, issue.summary].join("\n");
}

/** 걸린 이슈 묶음에서 검색어에 맞는 이슈(흡수된 이슈 제외, 최근 업데이트 순) */
export function matchIssues(chunk: IssueChunk, terms: string[], merged: Record<string, unknown> = {}): IssueDetail[] {
  const issues = Object.values(chunk.issues)
    .filter((i) => !Object.hasOwn(merged, String(i.id)))
    .sort((a, b) => ((a.latestDate ?? "") < (b.latestDate ?? "") ? 1 : (a.latestDate ?? "") > (b.latestDate ?? "") ? -1 : b.id - a.id));
  return pickBest(issues, (i) => countMatches(issueText(i), terms), terms.length);
}

export type SearchHit = { kind: "news"; date: string } | { kind: "issues"; chunk: number };

/** Pagefind 결과의 레코드 정보(meta, 없으면 주소)를 읽는다. 모르는 모양이면 null */
export function parseHit(url: string, meta: Record<string, string> | undefined): SearchHit | null {
  if (meta?.kind === "news" && meta.date && /^\d{4}-\d{2}-\d{2}$/.test(meta.date)) return { kind: "news", date: meta.date };
  if (meta?.kind === "issues" && meta.chunk && /^\d+$/.test(meta.chunk)) return { kind: "issues", chunk: Number(meta.chunk) };
  const news = /^\/(\d{4}-\d{2}-\d{2})\/?$/.exec(url);
  if (news) return { kind: "news", date: news[1]! };
  const issues = /^\/issues\/chunk\/(\d+)\/?$/.exec(url);
  if (issues) return { kind: "issues", chunk: Number(issues[1]) };
  return null;
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}
