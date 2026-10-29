// 5단계: 지어낸 일정의 사이트 데이터(로컬 화면 확인·테스트용). 내용은 모두 가짜다. fixtures.ts가 부른다.
// 실제 빌드(src/scheduleSite.ts)와 같은 모양·규칙의 파일을 만든다: 달별 일정(예정일 순), 색인, 식별자 묶음(살아 있는 것 → 달,
// 흡수된 것 → 남는 것), 브리프 날짜마다 '이번 주 일정'(C8), 뉴스마다 일정 칩, 이슈마다 관련 일정.
// 기준일(결과 못 찾음 계산)은 가장 최근 날짜다. 일정이 20개 이상이면 마지막 것은 일정 1에 흡수되고, 그 앞의 것은 지운 것이다.
import { MAJORS, type Major } from "../../src/categories.ts";
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
  type ScheduleOutcomeView,
  type ScheduleRefChunk,
  type WeekSchedules,
} from "../../src/siteTypes.ts";
import { addDays, rng } from "./random.ts";

/** 일정의 근거·결과로 쓸 뉴스 한 건 */
export interface FixtureStory {
  date: string;
  key: string;
  kind: "top" | "short";
  major: Major;
  /** 주 이슈(흡수된 이슈일 수 있다) */
  issueId: number | null;
  /** 주요 뉴스는 제목, 짧은 소식은 요약 */
  title: string;
}

export interface ScheduleFixtureInfo {
  /** 흡수·지운 것을 뺀 일정 수 */
  total: number;
  /** 결과 못 찾음 계산의 기준일(가장 최근 날짜) */
  refDate: string;
  merged: { id: number; into: number } | null;
  deleted: number | null;
}

export interface ScheduleFixtures {
  /** `site-data/` 안 파일 이름 → 내용 */
  files: Map<string, string>;
  /** `날짜/뉴스 키` → 일정 칩 */
  chips: Map<string, ScheduleChip[]>;
  weeks: Map<string, WeekSchedules>;
  byIssue: Map<number, ScheduleLine[]>;
  info: ScheduleFixtureInfo | null;
}

const PLACES = ["가짜국", "가짜 중앙은행", "가짜당", "가짜시", "가짜전자", "모의국", "가짜 국회", "가짜연구소", "가짜항공", "가짜 법원"];
const TOPICS = ["기준금리", "예산안", "대통령 선거", "3분기 실적", "새 AI 모델", "버스 파업", "항소심", "정상회담", "수출 통계", "배터리 공장", "연금 개혁안", "우주 발사체", "백신 승인", "리그 개막", "관세 협상"];
const EVENTS = ["결정", "발표", "표결", "선고", "공개", "시행", "마감", "회의", "공청회", "출시"];
/** 이름 조합의 주기(이 수마다 뒤에 번호를 붙여 이름이 겹치지 않게 한다) */
const NAME_CYCLE = 30;

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function nextMonth(month: string): string {
  return addDays(monthEnd(month), 1).slice(0, 7);
}

/** 예정일의 첫날과 끝날(달 단위는 그 달 1일과 말일) */
function dueSpan(due: string): [string, string] {
  return due.length === 7 ? [`${due}-01`, monthEnd(due)] : [due, due];
}

interface Work {
  id: number;
  name: string;
  due: string;
  major: Major;
  basis: FixtureStory[];
  result: FixtureStory | null;
  status: "result" | "postponed" | "cancelled" | null;
  postponedTo: number | null;
}

export function fixtureSchedules(opts: { count: number; dates: string[]; stories: FixtureStory[]; issueOf: (id: number) => number; issueName: (id: number) => string }): ScheduleFixtures {
  const files = new Map<string, string>();
  const chips = new Map<string, ScheduleChip[]>();
  const weeks = new Map<string, WeekSchedules>();
  const byIssue = new Map<number, ScheduleLine[]>();
  const n = Math.max(0, opts.count);
  if (n === 0 || opts.stories.length === 0) {
    const empty: ScheduleIndex = { total: 0, months: [], majors: [] };
    files.set(siteFiles.scheduleIndex, JSON.stringify(empty));
    return { files, chips, weeks, byIssue, info: null };
  }
  const rand = rng(20261031);
  const dates = opts.dates;
  const ref = dates.at(-1)!;
  const storiesByDate = new Map<string, FixtureStory[]>();
  for (const s of opts.stories) storiesByDate.set(s.date, [...(storiesByDate.get(s.date) ?? []), s]);
  /** from 날짜 이상 to 날짜 이하인 저장된 날짜의 뉴스 하나(없으면 null) */
  const storyBetween = (from: string, to: string): FixtureStory | null => {
    const inRange = dates.filter((d) => d >= from && d <= to);
    if (!inRange.length) return null;
    const day = storiesByDate.get(inRange[Math.floor(rand() * inRange.length)]!)!;
    return day[Math.floor(rand() * day.length)]!;
  };
  // 첫 날짜의 뉴스는 근거로 쓰지 않는다('이번 주 일정'이 없는 날짜를 만들기 위해)
  const cand = dates.length > 1 ? opts.stories.filter((s) => s.date !== dates[0]) : opts.stories;

  const work: Work[] = [];
  for (let id = 1; id <= n; id++) {
    const s = cand[Math.floor(((id - 1) * cand.length) / n)]!;
    const known = s.date;
    const monthUnit = rand() < 0.2;
    const due = monthUnit ? addDays(known, Math.floor(rand() * 60)).slice(0, 7) : addDays(known, rand() < 0.5 ? 1 + Math.floor(rand() * WEEK_DAYS) : 8 + Math.floor(rand() * 53));
    const round = Math.floor((id - 1) / NAME_CYCLE);
    const name = `${PLACES[id % PLACES.length]} ${TOPICS[(id * 7) % TOPICS.length]} ${EVENTS[(id * 3) % EVENTS.length]}${round ? ` ${round + 1}` : ""}`;
    // 근거 뉴스: 처음 근거 뉴스(알려진 날) 뒤, 예정일과 기준일까지의 날짜에서 0~2건 더(평균 2건)
    const basis = [s];
    const dueStart = monthUnit ? `${due}-01` : due;
    const dueLast = monthUnit ? monthEnd(due) : due;
    const extra = Math.floor(rand() * 3);
    for (let k = 0; k < extra; k++) {
      const more = storyBetween(addDays(known, 1), dueLast < ref ? dueLast : ref);
      if (more && !basis.some((b) => b.date === more.date && b.key === more.key)) basis.push(more);
    }
    basis.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // 결과: 예정일이 기준일이거나 지난 일정은 6할 남짓 결과 뉴스, 일부는 연기·취소. 다가오는 일정도 드물게 연기·취소(C15)
    const waitEnd = monthUnit ? `${nextMonth(due)}-14` : addDays(due, 14);
    const reached = dueStart <= ref;
    let status: Work["status"] = null;
    let result: FixtureStory | null = null;
    const r = rand();
    if (reached) {
      if (r < 0.62) {
        result = storyBetween(dueStart, waitEnd < ref ? waitEnd : ref);
        if (result) status = "result";
      } else if (r < 0.72) status = "postponed";
      else if (r < 0.78) status = "cancelled";
    } else if (r < 0.05) status = "cancelled";
    else if (r < 0.1) status = "postponed";
    work.push({ id, name, due, major: s.major, basis, result, status, postponedTo: null });
  }
  const mergedId = n >= 20 ? n : null;
  const deletedId = n >= 20 ? n - 1 : null;
  const live = (w: Work) => w.id !== mergedId && w.id !== deletedId;
  // 연기 대상: 뒤에 만든 일정 중 예정일이 원래 예정일(달 단위는 그 달)보다 늦은 첫 것. 지난 일정의 첫 연기는 지운 일정을 가리킨다(연기(새 날짜 모름))
  let pointedDeleted = false;
  for (const w of work) {
    if (w.status !== "postponed") continue;
    if (!pointedDeleted && deletedId !== null && dueSpan(w.due)[0] <= ref) {
      w.postponedTo = deletedId;
      pointedDeleted = true;
      continue;
    }
    w.postponedTo = work.find((x) => x.id > w.id && x.id <= w.id + 60 && live(x) && dueSpan(x.due)[0] > dueSpan(w.due)[1])?.id ?? null;
  }

  const byId = new Map(work.map((w) => [w.id, w]));
  const issueRef = (raw: number | null): IssueRef | null => {
    if (raw === null) return null;
    const id = opts.issueOf(raw);
    return { id, name: opts.issueName(id) };
  };
  const outcomeOf = (w: Work): ScheduleOutcomeView => {
    if (w.status === "result" && w.result) return { status: "result", news: [{ date: w.result.date, key: w.result.key, title: w.result.title }] };
    if (w.status === "postponed") {
      const to = w.postponedTo === null ? undefined : byId.get(w.postponedTo);
      return { status: "postponed", to: to && live(to) ? { id: to.id, due: to.due } : null };
    }
    if (w.status === "cancelled") return { status: "cancelled" };
    const waitEnd = w.due.length === 7 ? `${nextMonth(w.due)}-14` : addDays(w.due, 14);
    return { status: waitEnd < ref ? "missing" : "pending" };
  };

  const items: ScheduleItem[] = work.filter(live).map((w) => {
    const first = w.basis[0]!;
    const related = new Map<number, IssueRef>();
    for (const st of [...w.basis, ...(w.result ? [w.result] : [])]) {
      const ir = issueRef(st.issueId);
      if (ir) related.set(ir.id, ir);
    }
    return {
      id: w.id,
      name: w.name,
      due: w.due,
      outcome: outcomeOf(w),
      major: w.major,
      issue: issueRef(first.issueId),
      issues: [...related.values()].sort((a, b) => a.id - b.id),
      knownOn: first.date,
      first: { date: first.date, key: first.key },
    };
  });
  items.sort(compareSchedules);
  const line = (x: ScheduleItem): ScheduleLine => ({ id: x.id, name: x.name, due: x.due, outcome: x.outcome });

  // 달별 파일과 색인
  const months = new Map<string, ScheduleItem[]>();
  for (const x of items) months.set(x.due.slice(0, 7), [...(months.get(x.due.slice(0, 7)) ?? []), x]);
  const index: ScheduleIndex = { total: items.length, months: [], majors: MAJORS.filter((m) => items.some((x) => x.major === m)) };
  for (const [month, list] of [...months].sort(([a], [b]) => a.localeCompare(b))) {
    const majors: Partial<Record<Major, number>> = {};
    for (const m of MAJORS) {
      const c = list.filter((x) => x.major === m).length;
      if (c > 0) majors[m] = c;
    }
    index.months.push({ month, count: list.length, majors });
    files.set(siteFiles.scheduleMonth(month), JSON.stringify({ month, items: list } satisfies ScheduleMonth));
  }
  files.set(siteFiles.scheduleIndex, JSON.stringify(index));

  // 식별자 묶음
  const chunks = new Map<number, ScheduleRefChunk>();
  const chunkOf = (id: number) => {
    const c = scheduleRefChunkOf(id);
    if (!chunks.has(c)) chunks.set(c, { months: {}, merged: {} });
    return chunks.get(c)!;
  };
  for (const x of [...items].sort((a, b) => a.id - b.id)) chunkOf(x.id).months[String(x.id)] = x.due.slice(0, 7);
  if (mergedId !== null) chunkOf(mergedId).merged[String(mergedId)] = 1;
  for (const [c, data] of [...chunks].sort((a, b) => a[0] - b[0])) files.set(siteFiles.scheduleRef(c), JSON.stringify(data));

  // 뉴스마다 칩(근거 뉴스), 이슈마다 일정
  for (const x of items) {
    for (const b of byId.get(x.id)!.basis) {
      const k = `${b.date}/${b.key}`;
      const list = chips.get(k) ?? [];
      if (!list.some((c) => c.id === x.id)) list.push({ id: x.id, name: x.name, due: x.due });
      chips.set(k, list);
    }
    for (const i of x.issues) byIssue.set(i.id, [...(byIssue.get(i.id) ?? []), line(x)]);
  }
  for (const list of chips.values()) list.sort(compareSchedules);

  // '이번 주 일정'(C8): 브리프 날짜 다음 날부터 7일 안의 일 단위 일정 중 알려진 날이 그 날짜 이하인 것
  const days = items.filter((x) => x.due.length === 10);
  let lo = 0;
  for (const date of dates) {
    const from = addDays(date, 1);
    const to = addDays(date, WEEK_DAYS);
    while (lo < days.length && days[lo]!.due < from) lo++;
    const picked: ScheduleLine[] = [];
    for (let i = lo; i < days.length && days[i]!.due <= to; i++) if (days[i]!.knownOn <= date) picked.push(line(days[i]!));
    if (picked.length) weeks.set(date, { total: picked.length, items: picked.slice(0, WEEK_SCHEDULE_LIMIT) });
  }
  return { files, chips, weeks, byIssue, info: { total: items.length, refDate: ref, merged: mergedId === null ? null : { id: mergedId, into: 1 }, deleted: deletedId } };
}
