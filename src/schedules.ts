import type { DatabaseSync } from "node:sqlite";
import type { Major } from "./categories.ts";
import { resolveIssue, storiesJoined, type StoryRef } from "./issues.ts";
import { addDays } from "./kst.ts";
import { normalizeRefName } from "./refs.ts";
import { storedDates } from "./store.ts";

// 5단계 4.1: 일정, 뉴스-일정 연결, 날짜별 일정 뽑기 완료.
// 근거 뉴스, 알려진 날(처음 근거 뉴스의 날짜), 관련 이슈는 연결에서 계산한다(이슈·대상과 같다).

/** 연결 종류: 근거(그 일정을 말한 뉴스), 결과(결과 뉴스), 알림(연기·취소를 알린 뉴스) */
export type ScheduleRole = "basis" | "result" | "notice";

/** 저장하는 결과. 없으면 null(결과 기다림이나 결과 못 찾음은 기준일로 계산한다) */
export type ScheduleOutcome = "result" | "postponed" | "cancelled";

export interface Schedule {
  id: number;
  name: string;
  /** 일 단위 `YYYY-MM-DD`, 달 단위 `YYYY-MM` */
  due: string;
  major: Major;
  outcome: ScheduleOutcome | null;
  /** 연기 대상 일정(outcome이 postponed일 때). 흡수된 것을 가리키면 남는 것으로 따라간다 */
  postponedTo: number | null;
  mergedInto: number | null;
  deleted: boolean;
  deletedOn: string | null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export function isMonthDue(due: string): boolean {
  return MONTH_RE.test(due);
}

export function isDayDue(due: string): boolean {
  return DAY_RE.test(due);
}

export function monthOfDue(due: string): string {
  return due.slice(0, 7);
}

/** 달에 n달을 더한다(`YYYY-MM`) */
export function addMonths(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, "0")}-${String(mm + 1).padStart(2, "0")}`;
}

/** 기다리는 기간의 끝(5단계 C5): 일 단위는 예정일 + 14일, 달 단위는 다음 달 14일 */
export function waitEnd(due: string): string {
  return isMonthDue(due) ? `${addMonths(due, 1)}-14` : addDays(due, 14);
}

/** 예정일이 그 날짜이거나 지났는지(달 단위는 그 달이 시작했는지) */
export function dueReached(due: string, date: string): boolean {
  return isMonthDue(due) ? monthOfDue(date) >= due : due <= date;
}

/** 예정일이 그 날짜 뒤인지(달 단위는 그 날짜의 달 뒤) */
export function dueAfter(due: string, date: string): boolean {
  return isMonthDue(due) ? due > monthOfDue(date) : due > date;
}

/** 예정일이 그 날짜 이후인지(그 날짜 포함, 달 단위는 그 날짜의 달 포함). 기존 일정 후보의 "아직 다가오는" */
export function dueOnOrAfter(due: string, date: string): boolean {
  return isMonthDue(due) ? due >= monthOfDue(date) : due >= date;
}

/** 같은 예정일인지(어느 한쪽이 달 단위면 같은 달) */
export function sameDue(a: string, b: string): boolean {
  if (a === b) return true;
  return (isMonthDue(a) || isMonthDue(b)) && monthOfDue(a) === monthOfDue(b);
}

/** 예정일 a가 b보다 늦은지(어느 한쪽이 달 단위면 달로 비교한다) */
export function dueLater(a: string, b: string): boolean {
  if (isMonthDue(a) || isMonthDue(b)) return monthOfDue(a) > monthOfDue(b);
  return a > b;
}

/** 이름 겹침 비교(띄어쓰기·대소문자·가운뎃점 같은 표기 차이 무시). 대상·용어와 같은 정규화를 쓴다 */
export function normalizeScheduleName(s: string): string {
  return normalizeRefName(s);
}

interface ScheduleRow {
  id: number;
  name: string;
  due: string;
  major: string;
  outcome: ScheduleOutcome | null;
  postponed_to: number | null;
  merged_into: number | null;
  deleted: number;
  deleted_on: string | null;
}

function toSchedule(r: ScheduleRow): Schedule {
  return {
    id: r.id,
    name: r.name,
    due: r.due,
    major: r.major as Major,
    outcome: r.outcome,
    postponedTo: r.postponed_to,
    mergedInto: r.merged_into,
    deleted: r.deleted === 1,
    deletedOn: r.deleted_on,
  };
}

export function getSchedule(db: DatabaseSync, id: number): Schedule | null {
  const r = db.prepare("SELECT * FROM schedules WHERE id = ?").get(id) as unknown as ScheduleRow | undefined;
  return r ? toSchedule(r) : null;
}

/** 모든 일정(지운 것·흡수된 것 포함, 식별자 순) */
export function allSchedules(db: DatabaseSync): Schedule[] {
  return (db.prepare("SELECT * FROM schedules ORDER BY id").all() as unknown as ScheduleRow[]).map(toSchedule);
}

/** 예정일 범위 안의 일정(지운 것·흡수된 것 포함). from·to는 `YYYY-MM-DD`이고 달 단위는 그 달이 범위에 걸치면 든다 */
export function schedulesInRange(db: DatabaseSync, from: string, to: string): Schedule[] {
  const rows = db
    .prepare("SELECT * FROM schedules WHERE (length(due) = 10 AND due BETWEEN ? AND ?) OR (length(due) = 7 AND due BETWEEN ? AND ?) ORDER BY id")
    .all(from, to, monthOfDue(from), monthOfDue(to)) as unknown as ScheduleRow[];
  return rows.map(toSchedule);
}

export function isLiveSchedule(x: { mergedInto: number | null; deleted: boolean }): boolean {
  return x.mergedInto === null && !x.deleted;
}

export function createSchedule(db: DatabaseSync, x: { name: string; due: string; major: Major }): number {
  const r = db.prepare("INSERT INTO schedules (name, due, major) VALUES (?, ?, ?)").run(x.name, x.due, x.major);
  return Number(r.lastInsertRowid);
}

export type ScheduleChange = Partial<{
  name: string;
  due: string;
  major: Major;
  outcome: ScheduleOutcome | null;
  postponedTo: number | null;
  mergedInto: number | null;
  deleted: boolean;
  deletedOn: string | null;
}>;

export function updateSchedule(db: DatabaseSync, id: number, change: ScheduleChange): void {
  const cols: [keyof ScheduleChange, string][] = [
    ["name", "name"],
    ["due", "due"],
    ["major", "major"],
    ["outcome", "outcome"],
    ["postponedTo", "postponed_to"],
    ["mergedInto", "merged_into"],
    ["deletedOn", "deleted_on"],
  ];
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  for (const [k, col] of cols) {
    if (change[k] === undefined) continue;
    sets.push(`${col} = ?`);
    args.push(change[k] as string | number | null);
  }
  if (change.deleted !== undefined) {
    sets.push("deleted = ?");
    args.push(change.deleted ? 1 : 0);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE schedules SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
}

/** 흡수된 것이면 최종 남는 것까지 따라간다 */
export function resolveSchedule(db: DatabaseSync, id: number): number {
  const seen = new Set<number>();
  let cur = id;
  for (;;) {
    const row = db.prepare("SELECT merged_into FROM schedules WHERE id = ?").get(cur) as { merged_into: number | null } | undefined;
    if (!row || row.merged_into === null || seen.has(cur)) return cur;
    seen.add(cur);
    cur = row.merged_into;
  }
}

// ---- 연결 ----

/** 뉴스-일정 연결. 같은 뉴스·일정·종류는 하나만 둔다. 새로 넣었으면 true */
export function linkSchedule(db: DatabaseSync, storyId: number, scheduleId: number, role: ScheduleRole): boolean {
  return db.prepare("INSERT OR IGNORE INTO story_schedules (story_id, schedule_id, role) VALUES (?, ?, ?)").run(storyId, scheduleId, role).changes > 0;
}

export function unlinkSchedule(db: DatabaseSync, storyId: number, scheduleId: number, role: ScheduleRole): void {
  db.prepare("DELETE FROM story_schedules WHERE story_id = ? AND schedule_id = ? AND role = ?").run(storyId, scheduleId, role);
}

/** 일정의 모든 연결을 지운다. 지운 수 */
export function unlinkAllSchedule(db: DatabaseSync, scheduleId: number): number {
  return Number(db.prepare("DELETE FROM story_schedules WHERE schedule_id = ?").run(scheduleId).changes);
}

/** 일정의 연결된 뉴스(전개 순서: 오래된 날부터). role이 없으면 모든 종류 */
export function storiesOfSchedule(db: DatabaseSync, scheduleId: number, role?: ScheduleRole): (StoryRef & { role: ScheduleRole })[] {
  const where = role === undefined ? "ss.schedule_id = ?" : "ss.schedule_id = ? AND ss.role = ?";
  const args: (string | number)[] = role === undefined ? [scheduleId] : [scheduleId, role];
  const roles = new Map<number, ScheduleRole[]>();
  for (const r of db.prepare(`SELECT story_id, role FROM story_schedules ss WHERE ${where}`).all(...args) as { story_id: number; role: ScheduleRole }[]) {
    roles.set(r.story_id, [...(roles.get(r.story_id) ?? []), r.role]);
  }
  const order: ScheduleRole[] = ["basis", "result", "notice"];
  const out: (StoryRef & { role: ScheduleRole })[] = [];
  const stories = storiesJoined(db, "JOIN (SELECT DISTINCT story_id, schedule_id FROM story_schedules) ss ON ss.story_id = st.id", "ss.schedule_id = ?", scheduleId);
  for (const s of stories) for (const r of order.filter((x) => roles.get(s.id)?.includes(x))) out.push({ ...s, role: r });
  return out;
}

/** 뉴스의 일정(식별자 순)과 종류 */
export function schedulesOfStory(db: DatabaseSync, storyId: number): { id: number; role: ScheduleRole }[] {
  return (db.prepare("SELECT schedule_id, role FROM story_schedules WHERE story_id = ? ORDER BY schedule_id, role").all(storyId) as { schedule_id: number; role: ScheduleRole }[]).map((r) => ({
    id: r.schedule_id,
    role: r.role,
  }));
}

/** 알려진 날: 처음 근거 뉴스의 날짜. 근거가 없으면 null */
export function knownOn(db: DatabaseSync, scheduleId: number): string | null {
  const r = db
    .prepare("SELECT min(se.target_date) AS d FROM story_schedules ss JOIN stories st ON st.id = ss.story_id JOIN sections se ON se.id = st.section_id WHERE ss.schedule_id = ? AND ss.role = 'basis'")
    .get(scheduleId) as { d: string | null };
  return r.d;
}

/** 관련 이슈: 근거 뉴스와 결과 뉴스의 주 이슈(흡수된 이슈는 남는 이슈로). 식별자 순 */
export function relatedIssuesOfSchedule(db: DatabaseSync, scheduleId: number): number[] {
  const rows = db
    .prepare("SELECT DISTINCT si.issue_id AS id FROM story_schedules ss JOIN story_issues si ON si.story_id = ss.story_id AND si.is_primary = 1 WHERE ss.schedule_id = ? AND ss.role IN ('basis', 'result')")
    .all(scheduleId) as { id: number }[];
  return [...new Set(rows.map((r) => resolveIssue(db, r.id)))].sort((a, b) => a - b);
}

/** 일정 데이터(일정, 합치기 기록)가 하나라도 있는지. 백업 파일을 낼지 정한다 */
export function hasScheduleData(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM schedules UNION ALL SELECT 1 FROM schedule_merges LIMIT 1").get() !== undefined;
}

// ---- 날짜별 일정 뽑기 완료(4.1-2) ----

export function isScheduled(db: DatabaseSync, date: string): boolean {
  return db.prepare("SELECT 1 FROM schedule_dates WHERE target_date = ?").get(date) !== undefined;
}

export function markScheduled(db: DatabaseSync, date: string): void {
  db.prepare("INSERT OR IGNORE INTO schedule_dates (target_date) VALUES (?)").run(date);
}

/** 일정 뽑기 완료인 날짜(오래된 날부터) */
export function scheduledDates(db: DatabaseSync): string[] {
  return (db.prepare("SELECT target_date AS d FROM schedule_dates ORDER BY d").all() as { d: string }[]).map((r) => r.d);
}

/** 일정 뽑기 안 한 저장된 날짜(오래된 날부터). 채우기와 실패한 날짜의 재시도 대상(4.2-1) */
export function schedulableDates(db: DatabaseSync): string[] {
  const done = new Set(scheduledDates(db));
  return storedDates(db).filter((d) => !done.has(d));
}

// ---- 화면·요약에 보이는 결과 상태 ----

/** 결과 상태: 결과 연결, 연기(새 일정 또는 새 날짜 모름), 취소, 결과 기다림, 결과 못 찾음 */
export type ScheduleStatus = "result" | "postponed" | "cancelled" | "pending" | "missing";

/**
 * 결과 상태를 계산한다. 결과 못 찾음은 결과가 없고 기다리는 기간의 끝이 기준일(DB의 가장 최근 저장 날짜)보다 앞인 것이다.
 * 기준일이 없으면(저장된 날짜가 없음) 결과 기다림이다.
 */
export function scheduleStatus(s: { due: string; outcome: ScheduleOutcome | null }, refDate: string | null): ScheduleStatus {
  if (s.outcome !== null) return s.outcome;
  if (refDate !== null && waitEnd(s.due) < refDate) return "missing";
  return "pending";
}

/** 연기 대상의 최종 일정. 연기가 아니거나, 대상이 지워졌으면(지운 일정에 흡수된 것 포함) null(연기(새 날짜 모름)) */
export function postponeTarget(db: DatabaseSync, s: Schedule): Schedule | null {
  if (s.outcome !== "postponed" || s.postponedTo === null) return null;
  const t = getSchedule(db, resolveSchedule(db, s.postponedTo));
  return t !== null && isLiveSchedule(t) ? t : null;
}
