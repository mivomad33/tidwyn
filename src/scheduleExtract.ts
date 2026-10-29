import type { DatabaseSync } from "node:sqlite";
import { MAJORS, isMajor, type Major } from "./categories.ts";
import { getIssue, inTransaction, linksOfStory, resolveIssue, storiesOfDate, type StoryRef } from "./issues.ts";
import { addDays, isValidDate } from "./kst.ts";
import { storyTexts, type StoryText } from "./refs.ts";
import {
  addMonths,
  allSchedules,
  createSchedule,
  dueAfter,
  dueLater,
  dueOnOrAfter,
  dueReached,
  getSchedule,
  isDayDue,
  isLiveSchedule,
  isMonthDue,
  isScheduled,
  knownOn,
  linkSchedule,
  markScheduled,
  monthOfDue,
  normalizeScheduleName,
  postponeTarget,
  relatedIssuesOfSchedule,
  resolveSchedule,
  sameDue,
  schedulesInRange,
  storiesOfSchedule,
  updateSchedule,
  waitEnd,
  type Schedule,
} from "./schedules.ts";
import { Checker, type Violation } from "./validate.ts";

// 일정 뽑기 단계(5단계 4.2): 후보 목록, 검색, 일정 파일 검사와 적용.

/** 뉴스 한 건에 붙이는 일정 수 상한(C3). 기존 일정에 근거를 더하는 것과 날짜 확정도 센다 */
export const SCHEDULE_LIMITS = { top: 3, short: 1 } as const;
export const SCHEDULE_NAME_MAX = 40;
/** 예정일 범위(C3): 일 단위는 뉴스 날짜 다음 날부터 365일 안, 달 단위는 뉴스 날짜의 달부터 12달 뒤 달까지 */
export const DUE_MAX_DAYS = 365;
export const DUE_MAX_MONTHS = 12;
export const SCHEDULE_SEARCH_LIMIT = 30;
/** 이름 낱말 일치에서 빼는 흔한 낱말(정규화한 뒤 비교) */
const COMMON_WORDS = new Set(
  ["발표", "결정", "회의", "예정", "시행", "선고", "공개", "출시", "마감", "투표", "선거", "표결", "처리", "시한", "개최", "회담", "행사", "정상회담", "기준금리", "실적", "통계", "전망", "공식", "첫", "본회의", "법안", "판결", "회의록", "발효", "결과", "개표"].map(normalizeScheduleName),
);
/** 낱말 일치로 보는 가장 짧은 낱말(정규화 뒤 글자 수) */
const MIN_WORD_CHARS = 2;

function charCount(text: string): number {
  return [...text].length;
}

/** 이름의 구별되는 낱말(흔한 낱말과 짧은 낱말을 뺀다) */
function nameWords(name: string): string[] {
  return [...new Set(name.split(/\s+/).map(normalizeScheduleName).filter((w) => charCount(w) >= MIN_WORD_CHARS && !COMMON_WORDS.has(w)))];
}

/** 이름의 낱말이 글에 나오는지: 구별되는 낱말 중 2개 이상(하나뿐이면 그것)이 나오면 든다 */
function nameMentioned(name: string, text: string): boolean {
  const words = nameWords(name);
  if (words.length === 0) return false;
  const hit = words.filter((w) => text.includes(w)).length;
  return hit >= Math.min(2, words.length);
}

export function dueText(due: string): string {
  return isMonthDue(due) ? `${due}(${Number(due.slice(5, 7))}월 중)` : due;
}

/** 일정 결과 글(후보 목록·검색 결과에 쓴다). 결과가 없으면 null */
function outcomeText(db: DatabaseSync, s: Schedule): string | null {
  if (s.outcome === "result") return "결과 연결됨";
  if (s.outcome === "cancelled") return "취소";
  if (s.outcome === "postponed") {
    const t = postponeTarget(db, s);
    return t === null ? "연기(새 날짜 모름)" : `연기 → 일정 ${t.id}(${dueText(t.due)})`;
  }
  return null;
}

function issueNames(db: DatabaseSync, id: number): string {
  const names = relatedIssuesOfSchedule(db, id).map((i) => getIssue(db, i)?.name ?? "").filter((n) => n !== "");
  return names.length > 0 ? names.join(", ") : "없음";
}

function describeSchedule(db: DatabaseSync, s: Schedule): string {
  const out = outcomeText(db, s);
  return `- 일정 ${s.id} · ${dueText(s.due)} · ${s.major} · ${s.name} · 관련 이슈: ${issueNames(db, s.id)} · 알려진 날 ${knownOn(db, s.id) ?? "-"}${out === null ? "" : ` · 결과: ${out}`}`;
}

/** 그날 뉴스의 주 이슈(흡수된 이슈는 남는 이슈) */
function dayIssues(db: DatabaseSync, stories: StoryRef[]): Set<number> {
  const out = new Set<number>();
  for (const s of stories) {
    const p = linksOfStory(db, s.id).find((l) => l.primary);
    if (p) out.add(resolveIssue(db, p.issueId));
  }
  return out;
}

/** 아직 다가오는(예정일이 그 날짜 이후, 달 단위는 그 날짜의 달 이후) 살아 있는 일정. 예정일 색인으로 고른다 */
function upcomingSchedules(db: DatabaseSync, date: string): Schedule[] {
  return db
    .prepare("SELECT id FROM schedules WHERE merged_into IS NULL AND deleted = 0 AND ((length(due) = 10 AND due >= ?) OR (length(due) = 7 AND due >= ?)) ORDER BY id")
    .all(date, monthOfDue(date))
    .map((r) => getSchedule(db, (r as { id: number }).id)!)
    .filter((s) => dueOnOrAfter(s.due, date));
}

/** 그날 뉴스의 주 이슈에 관련된 다가오는 일정의 식별자 */
function issueScheduleIds(db: DatabaseSync, issues: Set<number>, upcoming: Set<number>): Set<number> {
  const out = new Set<number>();
  if (issues.size === 0) return out;
  const rows = db
    .prepare("SELECT DISTINCT ss.schedule_id AS sid, si.issue_id AS iid FROM story_schedules ss JOIN story_issues si ON si.story_id = ss.story_id AND si.is_primary = 1 WHERE ss.role IN ('basis', 'result')")
    .all() as { sid: number; iid: number }[];
  for (const r of rows) if (upcoming.has(r.sid) && issues.has(resolveIssue(db, r.iid))) out.add(r.sid);
  return out;
}

export interface ScheduleCandidates {
  stories: StoryText[];
  /** 기존 일정 후보(중복 막기, 예정일 전 연기·취소): 식별자 순 */
  existing: Schedule[];
  /** 결과 후보(C5): 예정일 순 */
  results: Schedule[];
}

/**
 * 결과 후보인지(C5): 살아 있고, 예정일이 그 날짜이거나 지났고, 결과가 없으며(결과 기다림), 그 날짜가 기다리는 기간 안이다.
 */
export function isResultCandidate(s: Schedule, date: string): boolean {
  return isLiveSchedule(s) && s.outcome === null && dueReached(s.due, date) && date <= waitEnd(s.due);
}

/** 그날 일정 뽑기의 후보. 목록은 그날 뉴스에 관계된 것과 기다리는 기간 안의 것만이라 전체 일정 수에 비례해 커지지 않는다 */
export function scheduleCandidates(db: DatabaseSync, date: string): ScheduleCandidates {
  const stories = storyTexts(db, storiesOfDate(db, date));
  const text = normalizeScheduleName(stories.map((s) => [s.title, ...s.body].join("\n")).join("\n"));
  const upcoming = upcomingSchedules(db, date);
  const related = issueScheduleIds(db, dayIssues(db, stories.map((s) => s.story)), new Set(upcoming.map((s) => s.id)));
  const existing = upcoming.filter((s) => related.has(s.id) || nameMentioned(s.name, text));
  // 기다리는 기간 안일 수 있는 일정만 예정일 색인으로 고른다: 일 단위는 예정일이 그 날짜 - 14일부터 그 날짜까지,
  // 달 단위는 그 범위가 걸친 달(다음 달 14일까지 기다리므로 지난달 일정은 그 날짜가 14일 이하일 때만 후보다)
  const results = schedulesInRange(db, addDays(date, -14), date)
    .filter((s) => isResultCandidate(s, date))
    .sort((a, b) => a.due.localeCompare(b.due) || a.id - b.id);
  return { stories, existing, results };
}

/** work/<날짜>.schedules.md 내용 */
export function renderScheduleWork(db: DatabaseSync, date: string): { text: string; stories: number; existing: number; results: number } {
  const { stories, existing, results } = scheduleCandidates(db, date);
  const lines = [`# ${date} 일정 뽑기 작업`, "", `## 뉴스 (${stories.length}건)`, ""];
  for (const s of stories) {
    const p = linksOfStory(db, s.story.id).find((l) => l.primary);
    const issue = p ? getIssue(db, resolveIssue(db, p.issueId))?.name ?? "" : "";
    lines.push(`### \`${s.story.key}\` · ${s.story.section} · ${s.story.kind === "top" ? "주요 뉴스" : "짧은 소식"} · ${s.story.category.major} · 주 이슈: ${issue || "없음"}`, "");
    if (s.story.kind === "top") lines.push(`- 제목: ${s.title}`);
    for (const b of s.body) lines.push(`- ${b.replace(/\n+/g, " ")}`);
    lines.push("");
  }
  lines.push(
    `## 기존 일정 후보 (${existing.length}개)`,
    "",
    "아직 다가오는 일정 중 그날 뉴스의 주 이슈에 관련된 것과 이름의 낱말이 그날 뉴스 글에 나오는 것이다. 같은 일정이면 새로 만들지 말고 식별자를 쓴다. 예정일 전에 연기·취소되었다고 보도되면 outcomes에 쓴다. 여기 없는 일정은 schedule-search 명령으로 찾는다.",
    "",
    ...existing.map((s) => describeSchedule(db, s)),
    "",
    `## 결과 후보 (${results.length}개)`,
    "",
    "예정일이 그날이거나 지났고 아직 결과가 없으며 기다리는 기간(일 단위는 예정일부터 14일, 달 단위는 다음 달 14일까지) 안인 일정이다. 그날 뉴스에 결과·연기·취소가 있으면 outcomes에 쓰고, 없으면 그대로 둔다.",
    "",
    ...results.map((s) => {
      const basis = storiesOfSchedule(db, s.id, "basis")[0];
      return `- 일정 ${s.id} · ${dueText(s.due)} · ${s.name} · 관련 이슈: ${issueNames(db, s.id)} · 근거 뉴스: ${basis ? `${basis.date} ${basis.title}` : "없음"}`;
    }),
  );
  return { text: lines.join("\n").trimEnd() + "\n", stories: stories.length, existing: existing.length, results: results.length };
}

// ---- 검색(4.2-2) ----

export interface ScheduleSearch {
  found: Schedule[];
  /** 낱말·날짜 범위에 맞는 지운 일정 */
  deleted: Schedule[];
}

/** 같은 이름(표기 차이 무시)·같은 예정일의 지운 일정이 있는지 */
export function deletedTwin(all: Schedule[], name: string, due: string): Schedule | null {
  const n = normalizeScheduleName(name);
  return all.find((x) => x.deleted && normalizeScheduleName(x.name) === n && sameDue(x.due, due)) ?? null;
}

function inDueRange(due: string, from: string | null, to: string | null): boolean {
  if (from !== null && (isMonthDue(due) ? due < monthOfDue(from) : due < from)) return false;
  if (to !== null && (isMonthDue(due) ? due > monthOfDue(to) : due > to)) return false;
  return true;
}

/** 이름의 낱말(하나라도 맞으면, 맞는 낱말이 많은 순)과 예정일 범위로 일정을 찾는다. 흡수된 것은 빼고, 지운 것은 따로 */
export function searchSchedules(db: DatabaseSync, query: string, from: string | null, to: string | null): ScheduleSearch {
  const words = query.split(/\s+/).map(normalizeScheduleName).filter((w) => w.length > 0);
  const all = allSchedules(db);
  const score = (s: Schedule) => {
    if (words.length === 0) return 1;
    const n = normalizeScheduleName(s.name);
    return words.filter((w) => n.includes(w)).length;
  };
  const hits = all.filter((s) => s.mergedInto === null && inDueRange(s.due, from, to)).map((s) => ({ s, n: score(s) })).filter((x) => x.n > 0);
  const rank = (list: typeof hits) => list.sort((a, b) => b.n - a.n || a.s.due.localeCompare(b.s.due) || a.s.id - b.s.id).map((x) => x.s);
  return { found: rank(hits.filter((x) => !x.s.deleted)).slice(0, SCHEDULE_SEARCH_LIMIT), deleted: rank(hits.filter((x) => x.s.deleted)).slice(0, SCHEDULE_SEARCH_LIMIT) };
}

export function renderScheduleSearch(db: DatabaseSync, query: string, from: string | null, to: string | null): string {
  const r = searchSchedules(db, query, from, to);
  const all = allSchedules(db);
  const range = from !== null || to !== null ? ` 예정일 ${from ?? "처음"}~${to ?? "끝"}` : "";
  const lines: string[] = [];
  if (r.found.length === 0) lines.push(`"${query}"${range}에 맞는 일정이 없다.`);
  else {
    lines.push(`"${query}"${range} 검색 결과: 일정 ${r.found.length}개`, "");
    for (const s of r.found) {
      const twin = deletedTwin(all, s.name, s.due);
      lines.push(describeSchedule(db, s) + (twin === null ? "" : " · 지운 일정과 같음"));
    }
  }
  if (r.deleted.length > 0) {
    lines.push("", "지운 일정과 같음(이 이름·예정일로 새 일정을 만들면 검사에서 거부된다):");
    for (const s of r.deleted) lines.push(`- 지운 일정 ${s.id} · ${dueText(s.due)} · ${s.name} (${s.deletedOn ?? "-"}에 지움)`);
  }
  return lines.join("\n").trimEnd();
}

// ---- 일정 파일(4.2-3) ----

/** 기존 일정은 식별자(숫자), 같은 파일의 새 일정은 키(글)로 가리킨다 */
export type ScheduleValue = number | string;

export type PlannedOutcome =
  | { kind: "result"; schedule: number; stories: StoryRef[] }
  | { kind: "postpone"; schedule: number; story: StoryRef; due: string }
  | { kind: "postponeTo"; schedule: number; story: StoryRef; to: number }
  | { kind: "cancel"; schedule: number; story: StoryRef };

export interface SchedulePlan {
  date: string;
  newSchedules: { key: string; name: string; due: string; major: Major }[];
  stories: { story: StoryRef; schedules: ScheduleValue[] }[];
  outcomes: PlannedOutcome[];
  confirms: { schedule: number; due: string; story: StoryRef }[];
}

export type ScheduleCheck = { ok: true; plan: SchedulePlan } | { ok: false; violations: Violation[] };

/** 예정일 형식과 범위(C2, C3). 맞으면 예정일, 아니면 위반을 더하고 null */
function checkDue(c: Checker, v: unknown, date: string, where: string): string | null {
  if (typeof v !== "string" || !(isDayDue(v) ? isValidDate(v) : /^\d{4}-(0[1-9]|1[0-2])$/.test(v))) {
    c.add(where, `예정일 "${String(v)}"은(는) 일 단위(YYYY-MM-DD)나 달 단위(YYYY-MM)여야 한다("연내", "곧", 주·분기 단위는 뽑지 않는다)`);
    return null;
  }
  if (isDayDue(v)) {
    const min = addDays(date, 1);
    const max = addDays(date, DUE_MAX_DAYS);
    if (v < min) c.add(where, `예정일 ${v}이(가) 뉴스 날짜 ${date}의 다음 날(${min})보다 이르다`);
    else if (v > max) c.add(where, `예정일 ${v}이(가) 뉴스 날짜에서 ${DUE_MAX_DAYS}일을 넘는다(${max}까지)`);
  } else {
    const min = monthOfDue(date);
    const max = addMonths(min, DUE_MAX_MONTHS);
    if (v < min) c.add(where, `달 단위 예정일 ${v}이(가) 뉴스 날짜의 달(${min})보다 이르다`);
    else if (v > max) c.add(where, `달 단위 예정일 ${v}이(가) 뉴스 날짜의 달에서 ${DUE_MAX_MONTHS}달 뒤(${max})를 넘는다`);
  }
  return v;
}

/** 일정 이름(D6, 4.1-1): 비어 있지 않고 40자 이하, 문장 끝 부호로 끝나지 않는 짧은 명사구 */
export function checkScheduleName(c: Checker, v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    c.add(where, "일정 이름이 비어 있으면 안 된다");
    return "";
  }
  if (charCount(v) > SCHEDULE_NAME_MAX) c.add(where, `일정 이름이 ${charCount(v)}자다(${SCHEDULE_NAME_MAX}자 이하여야 한다)`);
  if (/[.!?。]\s*$/.test(v)) c.add(where, "일정 이름은 문장이 아닌 짧은 명사구다(문장 끝 부호로 끝나면 안 된다)");
  return v;
}

function checkMajor(c: Checker, v: unknown, where: string): Major {
  if (typeof v === "string" && isMajor(v)) return v;
  c.add(where, `"${String(v)}"은(는) 7개 대분류(${MAJORS.join(", ")}) 중 하나가 아니다`);
  return "사회";
}

/**
 * 새 일정 이름 겹침 검사기: 같은 예정일(달 단위는 같은 달)의 살아 있는 기존 일정, 같은 파일의 새 일정, 지운 일정과 비교한다.
 */
class ScheduleNameGuard {
  private all: Schedule[];
  private fresh: { name: string; due: string; key: string }[] = [];
  constructor(all: Schedule[]) {
    this.all = all;
  }
  check(c: Checker, name: string, due: string, key: string, where: string, hint: string): void {
    const n = normalizeScheduleName(name);
    if (n === "") return;
    const hit = this.all.find((x) => isLiveSchedule(x) && normalizeScheduleName(x.name) === n && sameDue(x.due, due));
    if (hit) c.add(where, `기존 일정 ${hit.id}(${hit.name}, ${dueText(hit.due)})과 이름·예정일이 겹친다. ${hint.replace("{id}", String(hit.id))}`);
    const other = this.fresh.find((x) => normalizeScheduleName(x.name) === n && sameDue(x.due, due) && x.key !== key);
    if (other) c.add(where, `같은 파일의 새 일정 "${other.key}"와 이름·예정일이 겹친다`);
    const del = deletedTwin(this.all, name, due);
    if (del) c.add(where, `지운 일정 ${del.id}(${del.name}, ${dueText(del.due)})과 이름·예정일이 같다. 지운 일정은 다시 뽑지 않는다`);
    this.fresh.push({ name, due, key });
  }
}

/** 일정 파일을 검사한다(4.2-3). 위반마다 위치와 이유 */
export function checkScheduleFile(db: DatabaseSync, data: unknown, date: string): ScheduleCheck {
  const c = new Checker();
  const root = c.obj(data, "일정 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["date", "newSchedules", "stories", "outcomes", "confirms"], "일정 파일");
  if (root.date !== date) c.add("일정 파일 date", `대상일 ${date}와 같아야 한다(지금: ${String(root.date)})`);
  const all = allSchedules(db);
  const byId = new Map(all.map((s) => [s.id, s]));
  const guard = new ScheduleNameGuard(all);
  const plan: SchedulePlan = { date, newSchedules: [], stories: [], outcomes: [], confirms: [] };

  const newKeys = new Set<string>();
  c.arr(root, "newSchedules", "newSchedules", "일정 파일").forEach((raw, idx) => {
    const w = `newSchedules ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["key", "name", "due", "major"], w);
    const k = c.text(o, "key", "key", w);
    if (k !== "" && newKeys.has(k)) c.add(`${w} key`, `"${k}"가 두 번 나온다`);
    if (k !== "") newKeys.add(k);
    const name = checkScheduleName(c, o.name, `${w} 이름`);
    const due = checkDue(c, o.due, date, `${w} 예정일`);
    const major = checkMajor(c, o.major, `${w} 대분류`);
    if (due !== null && name !== "") guard.check(c, name, due, k, `${w} 이름·예정일`, "새로 만들지 말고 일정 {id}을(를) 쓴다");
    plan.newSchedules.push({ key: k, name, due: due ?? "", major });
  });

  /** 기존 일정 식별자 검사: 없음, 지움, 흡수(남는 것을 알린다) */
  const checkExisting = (v: number, where: string): Schedule | null => {
    const s = byId.get(v);
    if (!s) c.add(where, `일정 ${v}이(가) 없다`);
    else if (s.deleted) c.add(where, `일정 ${v}은(는) 지운 일정이다`);
    else if (s.mergedInto !== null) {
      const to = resolveSchedule(db, v);
      c.add(where, `일정 ${v}은(는) 일정 ${to}(${byId.get(to)?.name ?? ""})에 흡수되었다. ${to}을(를) 쓴다`);
    } else return s;
    return null;
  };
  const idOf = (v: unknown, where: string): Schedule | null => {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      c.add(where, "기존 일정 식별자(숫자)여야 한다");
      return null;
    }
    return checkExisting(v, where);
  };

  const texts = new Map(storyTexts(db, storiesOfDate(db, date)).map((s) => [s.story.key, s]));
  const storyOf = (v: unknown, where: string, label: string): StoryRef | null => {
    const sk = typeof v === "string" ? v : "";
    const t = texts.get(sk);
    if (!t) c.add(where, sk === "" ? `${label} 키가 필요하다` : `${label} ${sk}가 ${date}의 뉴스가 아니다`);
    return t?.story ?? null;
  };

  // 뉴스별 일정
  const seen = new Set<string>();
  const usedKeys = new Set<string>();
  const counts = new Map<string, { kind: "top" | "short"; ids: Set<ScheduleValue> }>();
  c.arr(root, "stories", "stories", "일정 파일").forEach((raw, idx) => {
    const w0 = `stories ${idx + 1}`;
    const o = c.obj(raw, w0);
    if (o === null) return;
    c.keys(o, ["story", "schedules"], w0);
    const sk = typeof o.story === "string" ? o.story : "";
    const w = sk !== "" ? `stories ${idx + 1} (${sk})` : w0;
    const text = texts.get(sk);
    if (sk === "") c.add(`${w} story`, "뉴스 키가 필요하다");
    else if (seen.has(sk)) c.add(`${w} story`, `뉴스 ${sk}가 두 번 나온다`);
    else if (!text) c.add(`${w} story`, `${date}에 뉴스 ${sk}가 없다`);
    if (sk !== "") seen.add(sk);
    const list: ScheduleValue[] = [];
    c.arr(o, "schedules", "schedules", w).forEach((v, i) => {
      const wi = `${w} schedules ${i + 1}`;
      let r: ScheduleValue | null = null;
      if (typeof v === "number" && Number.isInteger(v)) r = checkExisting(v, wi) ? v : null;
      else if (typeof v === "string" && v !== "") {
        if (newKeys.has(v)) r = v;
        else c.add(wi, `새 일정 키 "${v}"가 newSchedules에 없다`);
      } else c.add(wi, "기존 일정 식별자(숫자)나 새 일정 키(글)여야 한다");
      if (r === null) return;
      if (list.includes(r)) c.add(wi, `같은 일정(${String(r)})이 두 번 나온다`);
      else list.push(r);
    });
    for (const r of list) if (typeof r === "string") usedKeys.add(r);
    if (text) {
      counts.set(sk, { kind: text.story.kind, ids: new Set(list) });
      plan.stories.push({ story: text.story, schedules: list });
    }
  });
  for (const k of texts.keys()) if (!seen.has(k)) c.add("stories", `뉴스 ${k}가 빠졌다(일정이 없으면 빈 목록으로 적는다)`);
  for (const n of plan.newSchedules) if (n.key !== "" && !usedKeys.has(n.key)) c.add(`"${n.key}"`, "어느 뉴스에도 연결되지 않았다");

  // 날짜 확정
  const confirmRaw = root.confirms === undefined ? [] : c.arr(root, "confirms", "confirms", "일정 파일");
  const confirmed = new Set<number>();
  confirmRaw.forEach((raw, idx) => {
    const w = `confirms ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["schedule", "due", "story"], w);
    const s = idOf(o.schedule, `${w} schedule`);
    const story = storyOf(o.story, `${w} story`, "근거 뉴스");
    const due = checkDue(c, o.due, date, `${w} 예정일`);
    if (s === null) return;
    if (confirmed.has(s.id)) c.add(`${w} schedule`, `일정 ${s.id}의 날짜 확정이 두 번 나온다`);
    confirmed.add(s.id);
    if (!isMonthDue(s.due)) c.add(`${w} schedule`, `일정 ${s.id}은(는) 달 단위가 아니다(날짜 확정은 달 단위 일정에만 쓴다)`);
    else if (due !== null && (!isDayDue(due) || monthOfDue(due) !== s.due)) c.add(`${w} 예정일`, `새 날짜 ${due}이(가) 일정 ${s.id}의 달(${s.due}) 안의 일 단위 날짜가 아니다(다른 달이면 연기다)`);
    if (story !== null) {
      const cnt = counts.get(story.key);
      if (cnt) cnt.ids.add(s.id);
    }
    if (story !== null && due !== null) plan.confirms.push({ schedule: s.id, due, story });
  });

  // 결과(결과 연결, 연기, 취소)
  const outRaw = root.outcomes === undefined ? [] : c.arr(root, "outcomes", "outcomes", "일정 파일");
  const withOutcome = new Set<number>();
  outRaw.forEach((raw, idx) => {
    const w = `outcomes ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["schedule", "result", "postpone", "cancel"], w);
    const kinds = (["result", "postpone", "cancel"] as const).filter((k) => o[k] !== undefined);
    if (kinds.length !== 1) {
      c.add(w, "result, postpone, cancel 중 하나만 쓴다");
      return;
    }
    const kind = kinds[0]!;
    const s = idOf(o.schedule, `${w} schedule`);
    if (s === null) return;
    if (withOutcome.has(s.id)) c.add(`${w} schedule`, `일정 ${s.id}에 결과를 두 번 쓴다`);
    withOutcome.add(s.id);
    const candidate = isResultCandidate(s, date);
    if (kind === "result") {
      if (!candidate) {
        const why = s.outcome !== null ? "이미 결과가 있다" : !dueReached(s.due, date) ? "아직 예정일 전이다(결과 연결은 예정일이 그날이거나 지난 일정에만 쓴다)" : "기다리는 기간이 지났다";
        c.add(`${w} schedule`, `일정 ${s.id}은(는) ${date}의 결과 후보가 아니다(${why})`);
      }
      const keys = Array.isArray(o.result) ? o.result : [o.result];
      const stories: StoryRef[] = [];
      if (keys.length === 0) c.add(`${w} result`, "결과 뉴스 키가 필요하다");
      keys.forEach((k, i) => {
        const st = storyOf(k, `${w} result ${i + 1}`, "결과 뉴스");
        if (st === null) return;
        if (stories.some((x) => x.key === st.key)) c.add(`${w} result ${i + 1}`, `결과 뉴스 ${st.key}가 두 번 나온다`);
        else stories.push(st);
      });
      if (candidate && stories.length === keys.length && stories.length > 0) plan.outcomes.push({ kind: "result", schedule: s.id, stories });
      return;
    }
    // 연기·취소: 결과 후보나, 결과가 없고 예정일이 그 날짜 뒤인 일정(C15)
    const eligible = candidate || (s.outcome === null && dueAfter(s.due, date));
    if (!eligible) {
      const why = s.outcome !== null ? "이미 결과(결과 연결·연기·취소)가 있다" : "예정일이 지났고 기다리는 기간도 지났다";
      c.add(`${w} schedule`, `일정 ${s.id}은(는) 연기·취소를 쓸 수 없다(${why})`);
    }
    const body = c.obj(o[kind], `${w} ${kind}`);
    if (body === null) return;
    if (kind === "cancel") {
      c.keys(body, ["story"], `${w} cancel`);
      const story = storyOf(body.story, `${w} cancel story`, "취소를 알린 뉴스");
      if (eligible && story !== null) plan.outcomes.push({ kind: "cancel", schedule: s.id, story });
      return;
    }
    c.keys(body, ["story", "due", "to"], `${w} postpone`);
    const story = storyOf(body.story, `${w} postpone story`, "연기를 알린 뉴스");
    if ((body.due === undefined) === (body.to === undefined)) {
      c.add(`${w} postpone`, "새 예정일(due)과 기존 일정 식별자(to) 중 하나만 쓴다");
      return;
    }
    if (body.due !== undefined) {
      const due = checkDue(c, body.due, date, `${w} postpone 새 예정일`);
      if (due === null) return;
      if (!dueLater(due, s.due)) c.add(`${w} postpone 새 예정일`, `새 예정일 ${due}이(가) 원래 예정일 ${s.due}보다 늦지 않다(달 단위는 다른 달이어야 한다). 앞당겨졌으면 새 일정을 만든다`);
      guard.check(c, s.name, due, `연기:${s.id}`, `${w} postpone 새 일정`, "새 예정일 대신 to에 일정 {id}을(를) 쓴다");
      if (eligible && story !== null) plan.outcomes.push({ kind: "postpone", schedule: s.id, story, due });
      return;
    }
    if (typeof body.to !== "number" || !Number.isInteger(body.to)) {
      c.add(`${w} postpone to`, "기존 일정 식별자(숫자)여야 한다");
      return;
    }
    if (body.to === s.id) {
      c.add(`${w} postpone to`, "자기 자신으로 연기할 수 없다");
      return;
    }
    const t = checkExisting(body.to, `${w} postpone to`);
    if (t === null) return;
    if (!dueLater(t.due, s.due)) c.add(`${w} postpone to`, `일정 ${t.id}의 예정일 ${t.due}이(가) 원래 예정일 ${s.due}보다 늦지 않다`);
    if (eligible && story !== null) plan.outcomes.push({ kind: "postponeTo", schedule: s.id, story, to: t.id });
  });

  // 뉴스 한 건의 일정 수(C3)
  for (const [sk, cnt] of counts) {
    const lim = SCHEDULE_LIMITS[cnt.kind];
    if (cnt.ids.size > lim) c.add(`stories (${sk})`, `${cnt.kind === "top" ? "주요 뉴스" : "짧은 소식"}의 일정이 ${cnt.ids.size}개다(${lim}개 이하여야 한다, 기존 일정에 근거를 더하는 것과 날짜 확정도 센다)`);
  }

  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, plan };
}

export type ScheduleApplied =
  | { status: "applied"; newSchedules: number; attached: number; results: number; postponed: number; cancelled: number; confirmed: number }
  | { status: "nothing" };

/**
 * 검사를 통과한 일정 계획을 한 트랜잭션으로 적용하고 그 날짜를 일정 뽑기 완료로 둔다(4.2-1).
 * 이미 완료인 날짜면 아무것도 하지 않는다(같은 파일을 다시 적용해도 연결이 늘지 않는다).
 */
export function applySchedulePlan(db: DatabaseSync, plan: SchedulePlan): ScheduleApplied {
  if (isScheduled(db, plan.date)) return { status: "nothing" };
  return inTransaction(db, () => {
    const ids = new Map<string, number>();
    for (const n of plan.newSchedules) ids.set(n.key, createSchedule(db, { name: n.name, due: n.due, major: n.major }));
    const attached = new Set<number>();
    for (const s of plan.stories) {
      for (const v of s.schedules) {
        const id = typeof v === "number" ? v : ids.get(v)!;
        if (linkSchedule(db, s.story.id, id, "basis") && typeof v === "number") attached.add(id);
      }
    }
    for (const cf of plan.confirms) {
      updateSchedule(db, cf.schedule, { due: cf.due });
      if (linkSchedule(db, cf.story.id, cf.schedule, "basis")) attached.add(cf.schedule);
    }
    let results = 0;
    let postponed = 0;
    let cancelled = 0;
    for (const o of plan.outcomes) {
      if (o.kind === "result") {
        updateSchedule(db, o.schedule, { outcome: "result" });
        for (const st of o.stories) linkSchedule(db, st.id, o.schedule, "result");
        results++;
      } else if (o.kind === "cancel") {
        updateSchedule(db, o.schedule, { outcome: "cancelled", postponedTo: null });
        linkSchedule(db, o.story.id, o.schedule, "notice");
        cancelled++;
      } else {
        const original = getSchedule(db, o.schedule)!;
        const to = o.kind === "postponeTo" ? o.to : createSchedule(db, { name: original.name, due: o.due, major: original.major });
        if (o.kind === "postpone") linkSchedule(db, o.story.id, to, "basis");
        updateSchedule(db, o.schedule, { outcome: "postponed", postponedTo: to });
        linkSchedule(db, o.story.id, o.schedule, "notice");
        postponed++;
      }
    }
    markScheduled(db, plan.date);
    return { status: "applied" as const, newSchedules: plan.newSchedules.length, attached: attached.size, results, postponed, cancelled, confirmed: plan.confirms.length };
  });
}
