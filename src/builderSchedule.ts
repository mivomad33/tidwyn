import type { DatabaseSync } from "node:sqlite";
import { deprecationKeyModel } from "./builderDocs.ts";
import {
  builderScheduleIds,
  clearReminder,
  getBuilderItem,
  itemsOfSchedule,
  linkItemSchedule,
  reminderOf,
  setReminder,
  type BuilderDue,
  type BuilderItem,
} from "./builderStore.ts";
import { addDays } from "./kst.ts";
import { deletedTwin, liveTwin } from "./scheduleExtract.ts";
import {
  createSchedule,
  getSchedule,
  isDayDue,
  isMonthDue,
  schedulesInRange,
  updateSchedule,
  type Schedule,
} from "./schedules.ts";

// 9.8단계 4.4: 빌더 기한을 일정 달력에 올리기, 종료일 변경, D-7 다시 알림.

/** 확정 기한의 예정일 범위: 대상 날짜 다음 날부터(모델 종료는 1년을 넘는 일이 많아 뉴스의 365일과 다르다) */
export const BUILDER_DUE_MAX_DAYS = 730;
/** 예정일이 대상 날짜의 이 날 수 뒤 이내면 다시 알린다 */
export const REMINDER_DAYS = 7;

/** 새 항목의 지원 종료 모델 */
function modelsOfKeys(keys: string[]): Set<string> {
  return new Set(keys.map(deprecationKeyModel).filter((m): m is string => m !== null));
}

/** 일정에 이어진 항목(다시 알림 제외)의 모델. 지원 종료 키가 없는 항목이 있으면 null(모델로 판정하지 않는다) */
function modelsOfSchedule(db: DatabaseSync, scheduleId: number): Set<string> | null {
  const models = new Set<string>();
  for (const id of itemsOfSchedule(db, scheduleId)) {
    const item = getBuilderItem(db, id)!;
    if (item.reminderOf !== null) continue;
    const own = modelsOfKeys(item.keys);
    if (own.size === 0) return null;
    for (const m of own) models.add(m);
  }
  return models.size > 0 ? models : null;
}

export interface DueChange {
  /** 옛 날짜의 빌더 일정 */
  builder: Schedule[];
  /** 뉴스 근거가 붙어 건드리지 않는 일정 */
  news: Schedule[];
}

/**
 * 새 항목의 지원 종료 모델이 일정에 이어진 항목의 모델 전부를 덮고 예정일이 다른 일정을 찾는다(4.4-1).
 * 판정 대상은 살아 있고 결과가 없고 예정일이 지나지 않은 일정이다. 일부만 겹치거나 지원 종료 키가 없으면 대상이 아니다.
 */
export function dueChanges(db: DatabaseSync, keys: string[], due: BuilderDue | null, target: string): DueChange {
  const models = modelsOfKeys(keys);
  const out: DueChange = { builder: [], news: [] };
  if (models.size === 0 || due === null) return out;
  const builderOnly = builderScheduleIds(db);
  const linked = db
    .prepare(
      `SELECT DISTINCT s.id FROM schedules s JOIN builder_item_schedules l ON l.schedule_id = s.id
       WHERE s.merged_into IS NULL AND s.deleted = 0 AND s.outcome IS NULL AND length(s.due) = 10 AND s.due >= ? AND s.due <> ?
       ORDER BY s.id`,
    )
    .all(target, due.date) as { id: number }[];
  for (const { id } of linked) {
    const s = getSchedule(db, id)!;
    const own = modelsOfSchedule(db, id);
    if (own === null || ![...own].every((m) => models.has(m))) continue;
    (builderOnly.has(id) ? out.builder : out.news).push(s);
  }
  return out;
}

export interface Placement {
  /** 항목이 이어진 일정. 없으면 null(달력에 오르지 않음) */
  schedule: number | null;
  created: boolean;
  /** 연기로 둔 옛 빌더 일정 수 */
  postponed: number;
  /** 앞당겨 예정일을 고친 일정 수 */
  moved: number;
  /** 달 단위에서 일 단위로 올린 일정 수 */
  upgraded: number;
  /** 지운 일정과 같아 올리지 않았다 */
  deletedTwin: boolean;
  /** 종료일 변경인데 뉴스 근거가 있어 그대로 둔 일정 */
  newsKept: number[];
}

/** 등록하는 날 이미 7일 안이면 다시 알리지 않는다. 일 단위 일정만 다시 알린다 */
function registerReminder(db: DatabaseSync, s: Schedule, base: string): void {
  if (reminderOf(db, s.id) !== null || !isDayDue(s.due)) return;
  if (s.due <= addDays(base, REMINDER_DAYS)) setReminder(db, s.id, "skip", base);
}

/** 예정일이 바뀐 일정의 다시 알림 자격을 새로 계산한다 */
export function recomputeReminder(db: DatabaseSync, scheduleId: number, base: string): void {
  clearReminder(db, scheduleId);
  registerReminder(db, getSchedule(db, scheduleId)!, base);
}

/** 같은 이름·예정일의 일정에 잇거나 새로 만든다(due는 일 단위다). 지운 일정과 같으면 null */
function findOrCreate(db: DatabaseSync, name: string, due: string, r: Pick<Placement, "created" | "upgraded" | "deletedTwin">): number | null {
  // 그날 일정과 그 달의 달 단위 일정만 같은 예정일이 될 수 있다. 지운 일정과 흡수된 일정도 함께 나온다
  const near = schedulesInRange(db, due, due);
  const same = liveTwin(near, name, due);
  if (same) {
    if (isMonthDue(same.due) && isDayDue(due)) {
      updateSchedule(db, same.id, { due });
      r.upgraded++;
    }
    return same.id;
  }
  if (deletedTwin(near, name, due) !== null) {
    r.deletedTwin = true;
    return null;
  }
  r.created = true;
  return createSchedule(db, { name, due, major: "IT·AI" });
}

/**
 * 새 항목의 기한을 달력에 올린다(호출하는 쪽의 트랜잭션 안에서). 일 단위 확정 기한만 올린다.
 * 잠정이면 일정을 만들지 않고, 지원 종료 키가 옛 빌더 일정의 모델을 모두 덮으면 그 일정을 새 날짜 모름 연기로 둔다.
 */
export function placeOnCalendar(db: DatabaseSync, itemId: number, x: { keys: string[]; due: BuilderDue | null; scheduleName: string | null }, target: string): Placement {
  const r: Placement = { schedule: null, created: false, postponed: 0, moved: 0, upgraded: 0, deletedTwin: false, newsKept: [] };
  if (x.due === null) return r;
  const change = dueChanges(db, x.keys, x.due, target);
  r.newsKept = change.news.map((s) => s.id);
  if (x.due.state === "tentative") {
    for (const s of change.builder) {
      updateSchedule(db, s.id, { outcome: "postponed", postponedTo: null });
      r.postponed++;
    }
    return r;
  }
  if (!isDayDue(x.due.date) || x.scheduleName === null) return r;
  const newDue = x.due.date;
  // 앞당겨진 일정이 있으면 그 일정의 예정일을 고쳐 잇는다(연기 규칙은 늦어진 경우만이다)
  const earlier = change.builder.filter((s) => newDue < s.due);
  for (const s of earlier) {
    updateSchedule(db, s.id, { due: newDue });
    recomputeReminder(db, s.id, target);
    r.moved++;
  }
  const later = change.builder.filter((s) => newDue > s.due);
  const id = earlier[0]?.id ?? findOrCreate(db, x.scheduleName, newDue, r);
  if (id === null) return r;
  for (const s of later) {
    updateSchedule(db, s.id, { outcome: "postponed", postponedTo: id });
    r.postponed++;
  }
  linkItemSchedule(db, itemId, id);
  registerReminder(db, getSchedule(db, id)!, target);
  r.schedule = id;
  return r;
}

export interface DueReminder {
  schedule: number;
  scheduleName: string;
  /** 일정의 지금 예정일 */
  due: string;
  /** 원래 항목: 일정에 이어진 가장 늦은 항목(다시 알림 제외) */
  item: BuilderItem;
}

/**
 * 다시 알릴 일정(4.4-3): 살아 있고 결과가 없는 일 단위 일정 중 이어진 항목이 있고 예정일이 대상 날짜부터 7일 뒤 이내이며 기록이 없는 것.
 * 예정일이 가까운 순서다. 지운 일정은 연결이 끊겨 나오지 않고, 합쳐진 일정은 연결이 남는 일정으로 옮겨 있다.
 */
export function dueReminders(db: DatabaseSync, target: string): DueReminder[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT s.id FROM schedules s JOIN builder_item_schedules l ON l.schedule_id = s.id
       WHERE s.merged_into IS NULL AND s.deleted = 0 AND s.outcome IS NULL AND length(s.due) = 10 AND s.due >= ? AND s.due <= ?
         AND s.id NOT IN (SELECT schedule_id FROM builder_reminders)`,
    )
    .all(target, addDays(target, REMINDER_DAYS)) as { id: number }[];
  const out: DueReminder[] = [];
  for (const { id } of rows) {
    const s = getSchedule(db, id)!;
    const items = itemsOfSchedule(db, id).map((x) => getBuilderItem(db, x)!).filter((x) => x.reminderOf === null);
    const item = items.at(-1);
    if (item !== undefined) out.push({ schedule: id, scheduleName: s.name, due: s.due, item });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.schedule - b.schedule);
}
