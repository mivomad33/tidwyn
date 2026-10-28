import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Source, StoredBrief } from "./brief.ts";
import { briefIssues } from "./issueMarkdown.ts";
import { allIssues, developments, relatedIssues, resolveIssue, storyKey, type Issue } from "./issues.ts";
import { addDays } from "./kst.ts";
import type { BriefIssues } from "./markdown.ts";
import { listMerges } from "./merge.ts";
import {
  SITE_DATA_DIR,
  SITE_DATA_VERSION,
  issueChunkOf,
  siteFiles,
  type Continues,
  type DayList,
  type IssueChunk,
  type IssueDetail,
  type IssueListItem,
  type IssueRef,
  type ListSection,
  type ListStory,
  type MonthDetail,
  type MonthList,
  type SearchRecord,
  type SiteDates,
  type SiteIssueList,
  type StoryDetail,
} from "./siteTypes.ts";
import { loadBrief, storedDates } from "./store.ts";

// 사이트 데이터(3단계 4.1-1)와 검색 레코드(4.1-3)를 DB에서 만든다. 같은 DB면 같은 결과다(시각 같은 값을 넣지 않는다, 4.1-2).
// 이전 전개, 전개 순서, 흡수 이슈 따라가기는 2단계 코드(briefIssues, developments, resolveIssue)를 그대로 쓴다.

/** 날짜 하나의 브리프와 그날의 뉴스별 이슈 정보(2단계 계산) */
interface DayData {
  date: string;
  stored: StoredBrief;
  issues: BriefIssues;
}

function loadDays(db: DatabaseSync): DayData[] {
  const days: DayData[] = [];
  for (const date of storedDates(db)) {
    const stored = loadBrief(db, date);
    if (stored !== null) days.push({ date, stored, issues: briefIssues(db, date) });
  }
  return days;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** "어제에 이어" 표시 글(4.2-3) */
export function continuesLabel(prevDate: string, date: string): string {
  if (addDays(prevDate, 1) === date) return "어제에 이어";
  return `${Number(prevDate.slice(5, 7))}월 ${Number(prevDate.slice(8, 10))}일에 이어`;
}

/** 그날 뉴스의 주 이슈(흡수 이슈는 남는 이슈로 따라간 값) */
function primaryIssuesOf(db: DatabaseSync, day: DayData): Set<number> {
  return new Set([...day.issues.values()].map((i) => resolveIssue(db, i.primary.id)));
}

/** 대표 출처가 앞, 나머지는 원래 순서 */
function orderSources(sources: Source[]): Source[] {
  return [...sources.filter((s) => s.primary === true), ...sources.filter((s) => s.primary !== true)];
}

function buildDay(db: DatabaseSync, day: DayData, prev: DayData | null, details: Record<string, StoryDetail>): DayList {
  const prevIssues = prev === null ? new Set<number>() : primaryIssuesOf(db, prev);
  const listStory = (key: string, base: Omit<ListStory, "issue" | "newIssue" | "continues">): ListStory => {
    const info = day.issues.get(key);
    let continues: Continues | null = null;
    if (info && prev !== null && prevIssues.has(resolveIssue(db, info.primary.id))) continues = { date: prev.date, label: continuesLabel(prev.date, day.date) };
    return { ...base, issue: info ? { id: info.primary.id, name: info.primary.name } : null, newIssue: info !== undefined && info.previous.length === 0, continues };
  };
  const sections: ListSection[] = day.stored.brief.sections.map((sec) => {
    const stories: ListStory[] = [];
    for (const t of sec.topStories) {
      const key = storyKey(sec.name, "top", t.rank);
      stories.push(listStory(key, { key, section: sec.name, kind: "top", position: t.rank, title: t.title, category: t.category }));
      const info = day.issues.get(key);
      const detail: StoryDetail = {
        key,
        summary: t.summary,
        whyItMatters: t.whyItMatters,
        background: t.background,
        keyFacts: t.keyFacts,
        outlook: t.outlook,
        confidence: t.confidence,
        sources: orderSources(t.sources),
        extras: info ? info.extras.map((e) => ({ id: e.id, name: e.name })) : [],
        previous: info ? info.previous.map((p) => ({ date: p.date, key: p.key, title: p.title })) : [],
      };
      if (t.analogy !== undefined) detail.analogy = t.analogy;
      details[key] = detail;
    }
    sec.shortNews.forEach((n, i) => {
      const key = storyKey(sec.name, "short", i + 1);
      stories.push(listStory(key, { key, section: sec.name, kind: "short", position: i + 1, title: n.summary, category: n.category }));
    });
    const out: ListSection = { name: sec.name, flow: sec.flow, stories };
    if (sec.unverified !== undefined) out.unverified = sec.unverified;
    return out;
  });
  return { date: day.date, headline: day.stored.brief.headline, keywords: day.stored.brief.keywords, sections };
}

function listItem(i: Issue): IssueListItem {
  return { id: i.id, name: i.name, category: i.category, status: i.status, startDate: i.startDate, latestDate: i.latestDate, count: i.count };
}

/** 흡수되지 않은 이슈, 최근 업데이트일 순(같으면 식별자 순). 2단계 이슈 목록과 같은 순서 */
function liveIssues(db: DatabaseSync): Issue[] {
  return allIssues(db)
    .filter((i) => i.mergedInto === null)
    .sort((a, b) => (b.latestDate ?? "").localeCompare(a.latestDate ?? "") || a.id - b.id);
}

function buildIssueList(db: DatabaseSync, live: Issue[]): SiteIssueList {
  const merges = listMerges(db);
  const merged: SiteIssueList["merged"] = {};
  for (const i of allIssues(db)) {
    if (i.mergedInto === null) continue;
    const m = merges.filter((x) => x.absorbed === i.id && x.undoneOn === null).at(-1);
    merged[String(i.id)] = { into: resolveIssue(db, i.id), on: m?.mergedOn ?? null };
  }
  return { issues: live.map(listItem), merged };
}

function buildIssueDetail(db: DatabaseSync, i: Issue, names: Map<number, string>): IssueDetail {
  const timeline = developments(db, i.id)
    .reverse()
    .map((d) => ({ date: d.date, key: d.key, title: d.title }));
  const relatedIds = [...new Set(relatedIssues(db, i.id).map((r) => resolveIssue(db, r)))].filter((r) => r !== i.id).sort((a, b) => a - b);
  const related: IssueRef[] = relatedIds.map((id) => ({ id, name: names.get(id) ?? "" }));
  return { ...listItem(i), aliases: i.aliases, summary: i.summary, timeline, related };
}

/** 이슈 묶음 번호 → 그 묶음의 흡수되지 않은 이슈(식별자 순) */
function issueChunks(live: Issue[]): Map<number, Issue[]> {
  const chunks = new Map<number, Issue[]>();
  for (const i of [...live].sort((a, b) => a.id - b.id)) {
    const c = issueChunkOf(i.id);
    let list = chunks.get(c);
    if (!list) chunks.set(c, (list = []));
    list.push(i);
  }
  return new Map([...chunks.entries()].sort((a, b) => a[0] - b[0]));
}

function file(name: string): string {
  return path.posix.join(SITE_DATA_DIR, name);
}

/** 사이트 데이터: 결과물 기준 상대 경로(`site-data/...`) → JSON 내용 */
export function buildSiteData(db: DatabaseSync): Map<string, string> {
  const out = new Map<string, string>();
  const days = loadDays(db);
  const dates: SiteDates = {
    version: SITE_DATA_VERSION,
    latestDate: days.at(-1)?.date ?? null,
    dates: days.map((d) => d.date).reverse(),
    months: [...new Set(days.map((d) => monthOf(d.date)))].reverse(),
  };
  out.set(file(siteFiles.dates), JSON.stringify(dates));

  const lists = new Map<string, MonthList>();
  const details = new Map<string, MonthDetail>();
  days.forEach((day, idx) => {
    const month = monthOf(day.date);
    let list = lists.get(month);
    if (!list) lists.set(month, (list = { month, days: [] }));
    let detail = details.get(month);
    if (!detail) details.set(month, (detail = { month, days: {} }));
    const dayDetails: Record<string, StoryDetail> = {};
    list.days.push(buildDay(db, day, idx > 0 ? days[idx - 1]! : null, dayDetails));
    detail.days[day.date] = dayDetails;
  });
  for (const [month, list] of lists) out.set(file(siteFiles.list(month)), JSON.stringify(list));
  for (const [month, detail] of details) out.set(file(siteFiles.detail(month)), JSON.stringify(detail));

  const live = liveIssues(db);
  out.set(file(siteFiles.issueList), JSON.stringify(buildIssueList(db, live)));
  const names = new Map(allIssues(db).map((i) => [i.id, i.name]));
  for (const [chunk, issues] of issueChunks(live)) {
    const data: IssueChunk = { issues: {} };
    for (const i of issues) data.issues[String(i.id)] = buildIssueDetail(db, i, names);
    out.set(file(siteFiles.issueChunk(chunk)), JSON.stringify(data));
  }
  return out;
}

/** 검색 레코드 주소: 날짜 하나 */
export function newsRecordUrl(date: string): string {
  return `/${date}`;
}

/** 검색 레코드 주소: 이슈 묶음 하나 */
export function issueRecordUrl(chunk: number): string {
  return `/issues/chunk/${chunk}`;
}

/**
 * 검색 레코드(4.1-3). 뉴스·이슈 하나마다 레코드를 두면 파일 수 한도를 넘으므로 묶는다:
 * 저장된 날짜 하나에 뉴스 레코드 하나, 이슈 묶음(issueChunkOf) 하나에 이슈 레코드 하나. 날짜 순, 그다음 묶음 순.
 * 걸린 레코드 안에서 개별 뉴스·이슈를 찾는 일은 사이트가 사이트 데이터로 다시 거른다.
 */
export function buildSearchRecords(db: DatabaseSync): SearchRecord[] {
  const records: SearchRecord[] = [];
  for (const date of storedDates(db)) {
    const stored = loadBrief(db, date);
    if (stored === null) continue;
    const parts: string[] = [];
    for (const sec of stored.brief.sections) {
      for (const t of sec.topStories) {
        parts.push(t.title, t.summary, t.whyItMatters, t.background, ...t.keyFacts);
        if (t.analogy !== undefined) parts.push(t.analogy);
        parts.push(t.outlook);
      }
      for (const n of sec.shortNews) parts.push(n.summary);
    }
    records.push({ url: newsRecordUrl(date), content: parts.join("\n"), language: "ko", meta: { kind: "news", date } });
  }
  for (const [chunk, issues] of issueChunks(liveIssues(db))) {
    const parts = issues.flatMap((i) => [i.name, ...i.aliases, i.summary]);
    records.push({ url: issueRecordUrl(chunk), content: parts.join("\n"), language: "ko", meta: { kind: "issues", chunk: String(chunk) } });
  }
  return records;
}
