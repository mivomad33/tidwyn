import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Source, StoredBrief } from "./brief.ts";
import { correctionsByStory, type CorrectionRecord } from "./corrections.ts";
import { briefIssues } from "./issueMarkdown.ts";
import { allIssues, developments, relatedIssues, resolveIssue, storyKey, type Issue } from "./issues.ts";
import { addDays } from "./kst.ts";
import type { BriefIssues } from "./markdown.ts";
import { listMerges } from "./merge.ts";
import { listRefMerges } from "./refMerge.ts";
import { allEntities, allTerms, isLive, resolveRef, storiesOfRef, type Entity, type RefItem, type Term } from "./refs.ts";
import {
  ENTITY_FILTERS,
  ENTITY_FIRST_NEWS,
  SITE_DATA_DIR,
  SITE_DATA_VERSION,
  buildTermFiles,
  byCount,
  compareTerms,
  dayStoryCount,
  entityChunkOf,
  entityListPages,
  issueEntityChips,
  entityRecordUrl,
  issueChunkOf,
  siteFiles,
  termGroupOf,
  termRecordUrl,
  type EntityChunk,
  type EntityDetail,
  type EntityListItem,
  type EntityNews,
  type EntityNewsChunk,
  type EntityRef,
  type IssueEntity,
  type MergedMap,
  type TermGroupFile,
  type TermItem,
  type TermRef,
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
import { buildScheduleData, type ScheduleSiteData } from "./scheduleSite.ts";
import { buildIndicatorSiteData, type IndicatorSiteData } from "./indicatorSite.ts";
import { INDICATORS, type IndicatorDef } from "./indicators.ts";
import { buildVideoSiteData, type VideoSiteData } from "./videoSite.ts";
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

/** 4단계: 뉴스(전역 키 `날짜/키`)별 대상·용어 칩. 흡수·지운 것은 연결이 없으므로 나오지 않는다 */
interface StoryRefs {
  entities: Map<string, EntityRef[]>;
  terms: Map<string, TermRef[]>;
}

function storyRefs(db: DatabaseSync, entities: Entity[], terms: Term[]): StoryRefs {
  const out: StoryRefs = { entities: new Map(), terms: new Map() };
  for (const e of entities.filter(isLive)) {
    for (const s of storiesOfRef(db, "entity", e.id)) {
      const k = `${s.date}/${s.key}`;
      const list = out.entities.get(k) ?? [];
      list.push({ id: e.id, name: e.name, kind: e.kind, description: e.description });
      out.entities.set(k, list);
    }
  }
  for (const t of terms.filter(isLive)) {
    for (const s of storiesOfRef(db, "term", t.id)) {
      const k = `${s.date}/${s.key}`;
      const list = out.terms.get(k) ?? [];
      const ref: TermRef = { id: t.id, name: t.name, description: t.description };
      if (s.surface !== null) ref.surface = s.surface;
      list.push(ref);
      out.terms.set(k, list);
    }
  }
  for (const m of [out.entities, out.terms]) for (const list of m.values()) list.sort((a, b) => a.id - b.id);
  return out;
}

function buildDay(db: DatabaseSync, day: DayData, prev: DayData | null, details: Record<string, StoryDetail>, refs: StoryRefs, schedules: ScheduleSiteData, indicators: IndicatorSiteData, videos: VideoSiteData, corrections: Map<string, CorrectionRecord[]>): DayList {
  const prevIssues = prev === null ? new Set<number>() : primaryIssuesOf(db, prev);
  const listStory = (key: string, base: Omit<ListStory, "issue" | "newIssue" | "continues">): ListStory => {
    const info = day.issues.get(key);
    let continues: Continues | null = null;
    if (info && prev !== null && prevIssues.has(resolveIssue(db, info.primary.id))) continues = { date: prev.date, label: continuesLabel(prev.date, day.date) };
    const out: ListStory = { ...base, issue: info ? { id: info.primary.id, name: info.primary.name } : null, newIssue: info !== undefined && info.previous.length === 0, continues };
    const fixes = corrections.get(`${day.date}/${key}`);
    if (fixes) out.corrections = fixes.map((f) => ({ on: f.on, reason: f.reason })).reverse();
    return out;
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
      const ents = refs.entities.get(`${day.date}/${key}`);
      if (ents) detail.entities = ents;
      const terms = refs.terms.get(`${day.date}/${key}`);
      if (terms) detail.terms = terms;
      const chips = schedules.chips.get(`${day.date}/${key}`);
      if (chips) detail.schedules = chips;
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
  const out: DayList = { date: day.date, headline: day.stored.brief.headline, keywords: day.stored.brief.keywords, sections };
  const week = schedules.weeks.get(day.date);
  if (week) out.week = week;
  const chips = indicators.chips.get(day.date);
  if (chips) out.indicators = chips;
  const dayVideos = videos.byDate.get(day.date);
  if (dayVideos) out.videos = dayVideos;
  return out;
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

/** 이슈 페이지의 등장 대상(4.6-1): 그 이슈 전개 뉴스에 나온 횟수 순, 같으면 식별자 순, 최대 ISSUE_ENTITY_LIMIT개 */
function issueEntities(devs: { date: string; key: string }[], refs: StoryRefs): IssueEntity[] {
  const counts = new Map<number, IssueEntity>();
  for (const d of devs) {
    for (const e of refs.entities.get(`${d.date}/${d.key}`) ?? []) {
      const c = counts.get(e.id) ?? { id: e.id, name: e.name, count: 0 };
      c.count++;
      counts.set(e.id, c);
    }
  }
  return issueEntityChips([...counts.values()]);
}

/** 이름이 둘 이상의 페이지에 쓰이는지 세는 값: 남은 이슈, 페이지가 있는 대상, 공개 지표 */
function nameCounts(live: Issue[], entities: Entity[], indicatorDefs: readonly IndicatorDef[]): Map<string, number> {
  const out = new Map<string, number>();
  const names = [...live.map((i) => i.name), ...entities.filter((e) => isLive(e) && e.count > 0).map((e) => e.name), ...indicatorDefs.filter((d) => d.public).map((d) => d.name)];
  for (const n of names) out.set(n, (out.get(n) ?? 0) + 1);
  return out;
}

function buildIssueDetail(db: DatabaseSync, i: Issue, names: Map<number, string>, refs: StoryRefs, schedules: ScheduleSiteData, indicators: IndicatorSiteData, videos: VideoSiteData, dup: boolean): IssueDetail {
  const devs = developments(db, i.id);
  const timeline = devs
    .slice()
    .reverse()
    .map((d) => ({ date: d.date, key: d.key, title: d.title }));
  const relatedIds = [...new Set(relatedIssues(db, i.id).map((r) => resolveIssue(db, r)))].filter((r) => r !== i.id).sort((a, b) => a - b);
  const related: IssueRef[] = relatedIds.map((id) => ({ id, name: names.get(id) ?? "" }));
  const detail: IssueDetail = { ...listItem(i), aliases: i.aliases, summary: i.summary, timeline, related };
  const ents = issueEntities(devs, refs);
  if (ents.length > 0) detail.entities = ents;
  const sched = schedules.byIssue.get(i.id);
  if (sched) detail.schedules = sched;
  const inds = indicators.byIssue.get(i.id);
  if (inds) detail.indicators = inds;
  const vids = videos.byIssue.get(i.id);
  if (vids) detail.videos = vids;
  if (dup) detail.dupName = true;
  return detail;
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
/** indicatorDefs는 지표 정의(테스트가 공개 끄기를 바꿔 넣는다, 6단계 4.7-8) */
export function buildSiteData(db: DatabaseSync, indicatorDefs: readonly IndicatorDef[] = INDICATORS): Map<string, string> {
  const out = new Map<string, string>();
  const days = loadDays(db);
  const entities = allEntities(db);
  const terms = allTerms(db);
  const refs = storyRefs(db, entities, terms);
  const schedules = buildScheduleData(db, days.map((d) => d.date));
  const indicators = buildIndicatorSiteData(db, days.map((d) => d.date), indicatorDefs);
  const videos = buildVideoSiteData(db);
  const corrections = correctionsByStory(db);
  const lists = new Map<string, MonthList>();
  const details = new Map<string, MonthDetail>();
  days.forEach((day, idx) => {
    const month = monthOf(day.date);
    let list = lists.get(month);
    if (!list) lists.set(month, (list = { month, days: [] }));
    let detail = details.get(month);
    if (!detail) details.set(month, (detail = { month, days: {} }));
    const dayDetails: Record<string, StoryDetail> = {};
    list.days.push(buildDay(db, day, idx > 0 ? days[idx - 1]! : null, dayDetails, refs, schedules, indicators, videos, corrections));
    detail.days[day.date] = dayDetails;
  });
  const counts = new Map<string, number>();
  for (const list of lists.values()) for (const d of list.days) counts.set(d.date, dayStoryCount(d));
  const datesDesc = days.map((d) => d.date).reverse();
  const dates: SiteDates = {
    version: SITE_DATA_VERSION,
    latestDate: days.at(-1)?.date ?? null,
    dates: datesDesc,
    months: [...new Set(days.map((d) => monthOf(d.date)))].reverse(),
    storyCounts: datesDesc.map((d) => counts.get(d) ?? 0),
  };
  out.set(file(siteFiles.dates), JSON.stringify(dates));
  for (const [month, list] of lists) out.set(file(siteFiles.list(month)), JSON.stringify(list));
  for (const [month, detail] of details) out.set(file(siteFiles.detail(month)), JSON.stringify(detail));

  const live = liveIssues(db);
  out.set(file(siteFiles.issueList), JSON.stringify(buildIssueList(db, live)));
  const names = new Map(allIssues(db).map((i) => [i.id, i.name]));
  const nameUses = nameCounts(live, entities, indicatorDefs);
  for (const [chunk, issues] of issueChunks(live)) {
    const data: IssueChunk = { issues: {} };
    for (const i of issues) data.issues[String(i.id)] = buildIssueDetail(db, i, names, refs, schedules, indicators, videos, (nameUses.get(i.name) ?? 0) > 1);
    out.set(file(siteFiles.issueChunk(chunk)), JSON.stringify(data));
  }
  for (const [name, content] of buildEntityFiles(db, entities, nameUses)) out.set(file(name), content);
  for (const [name, content] of termSiteFiles(db, terms)) out.set(file(name), content);
  for (const [name, content] of schedules.files) out.set(file(name), content);
  for (const [name, content] of indicators.files) out.set(file(name), content);
  return out;
}

/** 흡수된 식별자 → 최종 남는 것과 합친 날짜(되돌리지 않은 마지막 합치기). 남는 것이 지워졌으면 넣지 않는다(없는 페이지) */
function mergedMap(db: DatabaseSync, item: RefItem, list: (Entity | Term)[], wanted: (id: number) => boolean): MergedMap {
  const merges = listRefMerges(db).filter((m) => m.item === item);
  const live = new Set(list.filter(isLive).map((x) => x.id));
  const out: MergedMap = {};
  for (const x of list) {
    if (x.mergedInto === null || x.deleted || !wanted(x.id)) continue;
    const into = resolveRef(db, item, x.id);
    if (!live.has(into)) continue;
    const m = merges.filter((r) => r.absorbed === x.id && r.undoneOn === null).at(-1);
    out[String(x.id)] = { into, on: m?.mergedOn ?? null };
  }
  return out;
}

function entityListItem(e: Entity): EntityListItem {
  return { id: e.id, name: e.name, kind: e.kind, description: e.description, latestDate: e.latestDate ?? "", count: e.count };
}

/** 대상 목록 쪽 파일, 상세 묶음, 나머지 뉴스 묶음(4.6-1, 4.6-2) */
function buildEntityFiles(db: DatabaseSync, entities: Entity[], nameUses: Map<string, number>): Map<string, string> {
  const out = new Map<string, string>();
  const live = entities.filter((e) => isLive(e) && e.count > 0);
  const items = live.map(entityListItem);
  for (const filter of ENTITY_FILTERS) for (const data of entityListPages(items, filter)) out.set(siteFiles.entityList(filter, data.page), JSON.stringify(data));
  const issueName = new Map(allIssues(db).map((i) => [i.id, i.name]));
  const chunks = new Map<number, { detail: EntityChunk; more: EntityNewsChunk }>();
  const chunkOf = (id: number) => {
    const c = entityChunkOf(id);
    let x = chunks.get(c);
    if (!x) chunks.set(c, (x = { detail: { entities: {}, merged: {} }, more: { news: {} } }));
    return x;
  };
  for (const e of [...live].sort((a, b) => a.id - b.id)) {
    const stories = storiesOfRef(db, "entity", e.id);
    const issues = new Map<number, number>();
    const news: EntityNews[] = [];
    for (const s of stories.slice().reverse()) {
      const primary = db.prepare("SELECT issue_id FROM story_issues WHERE story_id = ? AND is_primary = 1").get(s.id) as { issue_id: number } | undefined;
      const issue = primary ? resolveIssue(db, primary.issue_id) : null;
      if (issue !== null) issues.set(issue, (issues.get(issue) ?? 0) + 1);
      news.push({ date: s.date, key: s.key, kind: s.kind, title: s.title, issue: issue === null ? null : (issueName.get(issue) ?? null) });
    }
    const detail: EntityDetail = {
      ...entityListItem(e),
      aliases: e.aliases,
      firstDate: e.firstDate ?? "",
      issues: byCount([...issues].map(([id, count]) => ({ id, name: issueName.get(id) ?? "", count }))),
      news: news.slice(0, ENTITY_FIRST_NEWS),
      moreNews: Math.max(0, news.length - ENTITY_FIRST_NEWS),
    };
    if ((nameUses.get(e.name) ?? 0) > 1) detail.dupName = true;
    const c = chunkOf(e.id);
    c.detail.entities[String(e.id)] = detail;
    if (news.length > ENTITY_FIRST_NEWS) c.more.news[String(e.id)] = news.slice(ENTITY_FIRST_NEWS);
  }
  const merged = mergedMap(db, "entity", entities, () => true);
  for (const [id, m] of Object.entries(merged)) chunkOf(Number(id)).detail.merged[id] = m;
  for (const [c, x] of [...chunks].sort((a, b) => a[0] - b[0])) {
    out.set(siteFiles.entityChunk(c), JSON.stringify(x.detail));
    if (Object.keys(x.more.news).length > 0) out.set(siteFiles.entityNews(c), JSON.stringify(x.more));
  }
  return out;
}

function termItem(db: DatabaseSync, t: Term): TermItem {
  const first = storiesOfRef(db, "term", t.id)[0];
  return { id: t.id, name: t.name, aliases: t.aliases, description: t.description, first: first ? { date: first.date, key: first.key, title: first.title } : null, count: t.count };
}

/** 용어 색인과 첫 자음 묶음 파일(4.6-1, 4.7-5) */
function termSiteFiles(db: DatabaseSync, terms: Term[]): Map<string, string> {
  const out = new Map<string, string>();
  const items = terms.filter((t) => isLive(t) && t.count > 0).map((t) => termItem(db, t));
  const { index, groups } = buildTermFiles(items, mergedMap(db, "term", terms, () => true));
  out.set(siteFiles.termIndex, JSON.stringify(index));
  for (const [group, list] of [...groups].sort((a, b) => a[0] - b[0])) {
    const data: TermGroupFile = { group, terms: list };
    out.set(siteFiles.termGroup(group), JSON.stringify(data));
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
  // 4단계 4.6-4: 대상은 상세 묶음마다, 용어는 첫 자음 묶음마다 레코드 하나(흡수·지운 것과 연결 없는 것은 넣지 않는다)
  const entityChunks = new Map<number, string[]>();
  for (const e of allEntities(db).filter((x) => isLive(x) && x.count > 0)) {
    const c = entityChunkOf(e.id);
    entityChunks.set(c, [...(entityChunks.get(c) ?? []), e.name, ...e.aliases, e.description]);
  }
  for (const [c, parts] of [...entityChunks].sort((a, b) => a[0] - b[0])) {
    records.push({ url: entityRecordUrl(c), content: parts.join("\n"), language: "ko", meta: { kind: "entities", chunk: String(c) } });
  }
  const termGroups = new Map<number, string[]>();
  for (const t of allTerms(db).filter((x) => isLive(x) && x.count > 0).sort(compareTerms)) {
    const g = termGroupOf(t.name);
    termGroups.set(g, [...(termGroups.get(g) ?? []), t.name, ...t.aliases, t.description]);
  }
  for (const [g, parts] of [...termGroups].sort((a, b) => a[0] - b[0])) {
    records.push({ url: termRecordUrl(g), content: parts.join("\n"), language: "ko", meta: { kind: "terms", group: String(g) } });
  }
  return records;
}
