import type { DatabaseSync } from "node:sqlite";
import { MAJORS, type Major } from "./categories.ts";
import { allIssues, latestStoredDate, storyKey } from "./issues.ts";
import { addDays } from "./kst.ts";
import { allSchedules, isDayDue, isLiveSchedule, monthOfDue, scheduleStatus, type Schedule, type ScheduleRole } from "./schedules.ts";
import {
  WEEK_DAYS,
  WEEK_SCHEDULE_LIMIT,
  compareSchedules,
  scheduleRefChunkOf,
  siteFiles,
  type IssueRef,
  type ScheduleChip,
  type ScheduleIndex,
  type ScheduleItem,
  type ScheduleLine,
  type ScheduleMonth,
  type ScheduleNews,
  type ScheduleOutcomeView,
  type ScheduleRefChunk,
  type WeekSchedules,
} from "./siteTypes.ts";

// 5단계 4.6: 일정의 사이트 데이터. 같은 DB면 같은 결과다(결과 못 찾음은 DB의 가장 최근 저장 날짜로 계산한다, 4.6-3).
// 연결은 한 번의 질의로 모두 읽어 일정마다 묶는다(5년치에서도 빌드가 느려지지 않게).

interface LinkRow {
  schedule_id: number;
  role: ScheduleRole;
  date: string;
  section: string;
  kind: "top" | "short";
  position: number;
  title: string | null;
  summary: string;
  issue_id: number | null;
}

interface LinkedStory {
  date: string;
  key: string;
  title: string;
  issue: number | null;
}

export interface ScheduleSiteData {
  /** 사이트 데이터 파일 이름(`site-data/` 안) → 내용 */
  files: Map<string, string>;
  /** 전역 뉴스 키(`날짜/키`) → 그 뉴스를 근거로 한 일정 칩(예정일 순) */
  chips: Map<string, ScheduleChip[]>;
  /** 브리프 날짜 → '이번 주 일정'(없는 날짜는 빠진다) */
  weeks: Map<string, WeekSchedules>;
  /** 남는 이슈 식별자 → 관련 일정(예정일 순) */
  byIssue: Map<number, ScheduleLine[]>;
  /** 흡수·지운 것을 뺀 일정 수 */
  total: number;
}

export function buildScheduleData(db: DatabaseSync, briefDates: string[]): ScheduleSiteData {
  const refDate = latestStoredDate(db);
  const all = allSchedules(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  const resolve = (id: number): number => {
    const seen = new Set<number>();
    let cur = id;
    while (byId.get(cur)?.mergedInto != null && !seen.has(cur)) {
      seen.add(cur);
      cur = byId.get(cur)!.mergedInto!;
    }
    return cur;
  };
  const issues = allIssues(db);
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const resolveIssueId = (id: number): number => {
    const seen = new Set<number>();
    let cur = id;
    while (issueById.get(cur)?.mergedInto != null && !seen.has(cur)) {
      seen.add(cur);
      cur = issueById.get(cur)!.mergedInto!;
    }
    return cur;
  };
  const issueRef = (id: number): IssueRef => ({ id, name: issueById.get(id)?.name ?? "" });

  const rows = db
    .prepare(
      `SELECT ss.schedule_id, ss.role, se.target_date AS date, se.name AS section, st.kind, st.position, st.title, st.summary, si.issue_id
       FROM story_schedules ss JOIN stories st ON st.id = ss.story_id JOIN sections se ON se.id = st.section_id
       LEFT JOIN story_issues si ON si.story_id = st.id AND si.is_primary = 1
       ORDER BY se.target_date, se.position, CASE st.kind WHEN 'top' THEN 0 ELSE 1 END, st.position, ss.schedule_id, ss.role`,
    )
    .all() as unknown as LinkRow[];
  const links = new Map<number, Record<ScheduleRole, LinkedStory[]>>();
  for (const r of rows) {
    let l = links.get(r.schedule_id);
    if (!l) links.set(r.schedule_id, (l = { basis: [], result: [], notice: [] }));
    l[r.role].push({ date: r.date, key: storyKey(r.section, r.kind, r.position), title: r.kind === "top" ? (r.title ?? "") : r.summary, issue: r.issue_id === null ? null : resolveIssueId(r.issue_id) });
  }
  const linksOf = (id: number) => links.get(id) ?? { basis: [], result: [], notice: [] };

  const live = all.filter(isLiveSchedule);
  const isLive = (id: number) => {
    const s = byId.get(id);
    return s !== undefined && isLiveSchedule(s);
  };
  const outcomeOf = (s: Schedule): ScheduleOutcomeView => {
    const status = scheduleStatus(s, refDate);
    if (status === "result") return { status, news: linksOf(s.id).result.map((x): ScheduleNews => ({ date: x.date, key: x.key, title: x.title })) };
    if (status === "postponed") {
      const to = s.postponedTo === null ? null : resolve(s.postponedTo);
      return { status, to: to !== null && isLive(to) ? { id: to, due: byId.get(to)!.due } : null };
    }
    return { status };
  };

  const items: ScheduleItem[] = [];
  for (const s of live) {
    const l = linksOf(s.id);
    const first = l.basis[0] ?? null;
    const related = [...new Set([...l.basis, ...l.result].map((x) => x.issue).filter((x): x is number => x !== null))].sort((a, b) => a - b);
    items.push({
      id: s.id,
      name: s.name,
      due: s.due,
      outcome: outcomeOf(s),
      major: s.major,
      issue: first !== null && first.issue !== null ? issueRef(first.issue) : null,
      issues: related.map(issueRef),
      knownOn: first?.date ?? "",
      first: first === null ? null : { date: first.date, key: first.key },
    });
  }
  items.sort(compareSchedules);
  const line = (x: ScheduleItem): ScheduleLine => ({ id: x.id, name: x.name, due: x.due, outcome: x.outcome });

  // 달별 파일과 색인
  const files = new Map<string, string>();
  const months = new Map<string, ScheduleItem[]>();
  for (const x of items) {
    const m = monthOfDue(x.due);
    months.set(m, [...(months.get(m) ?? []), x]);
  }
  const index: ScheduleIndex = { total: items.length, months: [], majors: MAJORS.filter((m) => items.some((x) => x.major === m)) };
  for (const [month, list] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const majors: Partial<Record<Major, number>> = {};
    for (const m of MAJORS) {
      const n = list.filter((x) => x.major === m).length;
      if (n > 0) majors[m] = n;
    }
    index.months.push({ month, count: list.length, majors });
    const data: ScheduleMonth = { month, items: list };
    files.set(siteFiles.scheduleMonth(month), JSON.stringify(data));
  }
  files.set(siteFiles.scheduleIndex, JSON.stringify(index));

  // 식별자 묶음: 살아 있는 것은 달, 흡수된 것은 남는 것(남는 것이 지워졌으면 넣지 않는다 = 없는 페이지)
  const chunks = new Map<number, ScheduleRefChunk>();
  const chunkOf = (id: number) => {
    const c = scheduleRefChunkOf(id);
    let x = chunks.get(c);
    if (!x) chunks.set(c, (x = { months: {}, merged: {} }));
    return x;
  };
  for (const x of [...items].sort((a, b) => a.id - b.id)) chunkOf(x.id).months[String(x.id)] = monthOfDue(x.due);
  for (const s of all) {
    if (s.mergedInto === null || s.deleted) continue;
    const into = resolve(s.id);
    if (isLive(into)) chunkOf(s.id).merged[String(s.id)] = into;
  }
  for (const [c, data] of [...chunks].sort((a, b) => a[0] - b[0])) files.set(siteFiles.scheduleRef(c), JSON.stringify(data));

  // 펼친 카드 칩(근거 뉴스), 이슈별 일정
  const chips = new Map<string, ScheduleChip[]>();
  const byIssue = new Map<number, ScheduleLine[]>();
  for (const x of items) {
    for (const b of linksOf(x.id).basis) {
      const k = `${b.date}/${b.key}`;
      const list = chips.get(k) ?? [];
      if (!list.some((c) => c.id === x.id)) list.push({ id: x.id, name: x.name, due: x.due });
      chips.set(k, list);
    }
    for (const i of x.issues) byIssue.set(i.id, [...(byIssue.get(i.id) ?? []), line(x)]);
  }
  for (const list of chips.values()) list.sort(compareSchedules);

  // '이번 주 일정'(C8): 일 단위 일정을 예정일 순으로 두고 날짜마다 범위를 고른다
  const days = items.filter((x) => isDayDue(x.due));
  const weeks = new Map<string, WeekSchedules>();
  let lo = 0;
  for (const date of [...briefDates].sort()) {
    const from = addDays(date, 1);
    const to = addDays(date, WEEK_DAYS);
    while (lo < days.length && days[lo]!.due < from) lo++;
    const picked: ScheduleLine[] = [];
    for (let i = lo; i < days.length && days[i]!.due <= to; i++) if (days[i]!.knownOn !== "" && days[i]!.knownOn <= date) picked.push(line(days[i]!));
    if (picked.length > 0) weeks.set(date, { total: picked.length, items: picked.slice(0, WEEK_SCHEDULE_LIMIT) });
  }
  return { files, chips, weeks, byIssue, total: items.length };
}
