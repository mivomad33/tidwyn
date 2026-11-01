import type { DatabaseSync } from "node:sqlite";
import { BUILDER_FIELDS, builderItemKey, isBuilderItemKey, type BuilderDue, type BuilderDueState, type BuilderField, type BuilderItemSource, type BuilderStatus } from "./builderTypes.ts";
import { addDays } from "./kst.ts";

// 9.8단계: 빌더 저장. 항목과 실린 키, 날짜 상태, 숫자 행, 문서 해시, 소스별 시각, 미적용 변경, 낸 키, 다시 알림, 정정.
// 끝남은 따로 두지 않는다. 그 날짜의 상태가 확인함이나 일부만 확인이면 끝난 것이다(B15).

export { BUILDER_FIELDS, builderItemKey, isBuilderItemKey, type BuilderDue, type BuilderDueState, type BuilderField, type BuilderItemSource, type BuilderStatus };
/** 하루 최대 항목 수(D15) */
export const MAX_ITEMS_PER_DAY = 4;
/** 지원 종료 후보를 내는 최대 횟수(B16) */
export const MAX_EMITS = 7;
/** 후보 목록에 함께 보이는 실린 제목의 날 수(B9) */
export const RECENT_TITLE_DAYS = 30;

export interface NewBuilderItem {
  field: BuilderField;
  title: string;
  whatChanged: string;
  who: string;
  action: string;
  why: string;
  due: BuilderDue | null;
  sources: BuilderItemSource[];
  issue: number | null;
  /** 다시 알림이면 원래 항목 식별자 */
  reminderOf: number | null;
  keys: string[];
}

export interface BuilderItem extends NewBuilderItem {
  id: number;
  date: string;
  position: number;
  /** 날짜 안의 항목 키(`builder-<순서>`). 정정과 사이트가 쓴다 */
  key: string;
  /** 이어진 일정 식별자(흡수·지움은 연결에서 정리된다) */
  schedules: number[];
}

interface ItemRow {
  id: number;
  target_date: string;
  position: number;
  field: BuilderField;
  title: string;
  what_changed: string;
  who: string;
  action: string;
  why: string;
  due_date: string | null;
  due_state: BuilderDueState | null;
  sources: string;
  issue_id: number | null;
  reminder_of: number | null;
}

function toItem(r: ItemRow, keys: string[], schedules: number[]): BuilderItem {
  return {
    id: r.id,
    date: r.target_date,
    position: r.position,
    key: builderItemKey(r.position),
    field: r.field,
    title: r.title,
    whatChanged: r.what_changed,
    who: r.who,
    action: r.action,
    why: r.why,
    due: r.due_date === null || r.due_state === null ? null : { date: r.due_date, state: r.due_state },
    sources: JSON.parse(r.sources) as BuilderItemSource[],
    issue: r.issue_id,
    reminderOf: r.reminder_of,
    keys,
    schedules,
  };
}

/** 모든 빌더 항목(날짜 순, 날짜 안 순서). 키와 연결을 한 번의 질의로 읽는다(5년치 빌드가 느려지지 않게) */
export function allBuilderItems(db: DatabaseSync): BuilderItem[] {
  const keys = new Map<number, string[]>();
  for (const r of db.prepare("SELECT item_id, key FROM builder_item_keys ORDER BY item_id, key").all() as { item_id: number; key: string }[]) keys.set(r.item_id, [...(keys.get(r.item_id) ?? []), r.key]);
  const links = new Map<number, number[]>();
  for (const r of db.prepare("SELECT item_id, schedule_id FROM builder_item_schedules ORDER BY item_id, schedule_id").all() as { item_id: number; schedule_id: number }[]) links.set(r.item_id, [...(links.get(r.item_id) ?? []), r.schedule_id]);
  const rows = db.prepare("SELECT * FROM builder_items ORDER BY target_date, position").all() as unknown as ItemRow[];
  return rows.map((r) => toItem(r, keys.get(r.id) ?? [], links.get(r.id) ?? []));
}

function itemFrom(db: DatabaseSync, r: ItemRow): BuilderItem {
  const keys = (db.prepare("SELECT key FROM builder_item_keys WHERE item_id = ? ORDER BY key").all(r.id) as { key: string }[]).map((x) => x.key);
  const links = (db.prepare("SELECT schedule_id FROM builder_item_schedules WHERE item_id = ? ORDER BY schedule_id").all(r.id) as { schedule_id: number }[]).map((x) => x.schedule_id);
  return toItem(r, keys, links);
}

export function builderItemsOfDate(db: DatabaseSync, date: string): BuilderItem[] {
  const rows = db.prepare("SELECT * FROM builder_items WHERE target_date = ? ORDER BY position").all(date) as unknown as ItemRow[];
  return rows.map((r) => itemFrom(db, r));
}

export function getBuilderItem(db: DatabaseSync, id: number): BuilderItem | null {
  const r = db.prepare("SELECT * FROM builder_items WHERE id = ?").get(id) as unknown as ItemRow | undefined;
  return r ? itemFrom(db, r) : null;
}

/** 날짜와 항목 키로 찾는다 */
export function builderItemByKey(db: DatabaseSync, date: string, key: string): BuilderItem | null {
  if (!isBuilderItemKey(key)) return null;
  const r = db.prepare("SELECT * FROM builder_items WHERE target_date = ? AND position = ?").get(date, Number(key.slice("builder-".length))) as unknown as ItemRow | undefined;
  return r ? itemFrom(db, r) : null;
}

/** 항목 하나를 날짜 끝에 더한다. 식별자 */
export function insertBuilderItem(db: DatabaseSync, date: string, x: NewBuilderItem): number {
  const pos = (db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM builder_items WHERE target_date = ?").get(date) as { p: number }).p + 1;
  const r = db
    .prepare("INSERT INTO builder_items (target_date, position, field, title, what_changed, who, action, why, due_date, due_state, sources, issue_id, reminder_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(date, pos, x.field, x.title, x.whatChanged, x.who, x.action, x.why, x.due?.date ?? null, x.due?.state ?? null, JSON.stringify(x.sources), x.issue, x.reminderOf);
  const id = Number(r.lastInsertRowid);
  for (const k of new Set(x.keys)) db.prepare("INSERT INTO builder_item_keys (item_id, key) VALUES (?, ?)").run(id, k);
  return id;
}

/** 실린 키 전체 */
export function publishedKeys(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT key FROM builder_item_keys").all() as { key: string }[]).map((r) => r.key));
}

/** 최근 실린 제목(대상 날짜까지 30일, 최근 날부터). 다시 알림 항목은 뺀다 */
export function recentBuilderTitles(db: DatabaseSync, target: string): { date: string; title: string }[] {
  const rows = db.prepare("SELECT target_date, title FROM builder_items WHERE target_date > ? AND target_date <= ? AND reminder_of IS NULL ORDER BY target_date DESC, position").all(addDays(target, -RECENT_TITLE_DAYS), target) as { target_date: string; title: string }[];
  return rows.map((r) => ({ date: r.target_date, title: r.title }));
}

// ---- 날짜 상태(B11, B15) ----

export function builderStatusOf(db: DatabaseSync, date: string): BuilderStatus | null {
  const r = db.prepare("SELECT status FROM builder_dates WHERE target_date = ?").get(date) as { status: BuilderStatus } | undefined;
  return r?.status ?? null;
}

export function setBuilderStatus(db: DatabaseSync, date: string, status: BuilderStatus): void {
  db.prepare("INSERT INTO builder_dates (target_date, status) VALUES (?, ?) ON CONFLICT(target_date) DO UPDATE SET status = excluded.status").run(date, status);
}

/** 끝남: 상태가 확인함이나 일부만 확인이다 */
export function isBuilderDone(db: DatabaseSync, date: string): boolean {
  const s = builderStatusOf(db, date);
  return s === "checked" || s === "partial";
}

/** 빌더 기록이 있는 날짜와 상태(오래된 날부터) */
export function allBuilderDates(db: DatabaseSync): { date: string; status: BuilderStatus }[] {
  return (db.prepare("SELECT target_date, status FROM builder_dates ORDER BY target_date").all() as { target_date: string; status: BuilderStatus }[]).map((r) => ({ date: r.target_date, status: r.status }));
}

// ---- 숫자 행과 문서(B5, B10) ----

export interface StoredRow {
  doc: string;
  hash: string;
  addedOn: string;
  removedOn: string | null;
  path: string;
  header: string;
  row: string;
}

interface RowRow {
  doc: string;
  hash: string;
  added_on: string;
  removed_on: string | null;
  path: string;
  header: string;
  row: string;
}

const toStored = (r: RowRow): StoredRow => ({ doc: r.doc, hash: r.hash, addedOn: r.added_on, removedOn: r.removed_on, path: r.path, header: r.header, row: r.row });

/** 문서의 지금 숫자 행 */
export function liveRows(db: DatabaseSync, doc: string): StoredRow[] {
  return (db.prepare("SELECT * FROM builder_rows WHERE doc = ? AND removed_on IS NULL ORDER BY hash").all(doc) as unknown as RowRow[]).map(toStored);
}

/** 해시의 가장 늦게 저장된 행(지난 행도 찾는다) */
export function rowByHash(db: DatabaseSync, doc: string, hash: string): StoredRow | null {
  const r = db.prepare("SELECT * FROM builder_rows WHERE doc = ? AND hash = ? ORDER BY added_on DESC LIMIT 1").get(doc, hash) as unknown as RowRow | undefined;
  return r ? toStored(r) : null;
}

export function allRows(db: DatabaseSync): StoredRow[] {
  return (db.prepare("SELECT * FROM builder_rows ORDER BY doc, hash, added_on").all() as unknown as RowRow[]).map(toStored);
}

/** 바뀐 행만 쓴다. 같은 날 지웠다가 되돌아온 행은 지운 표시만 푼다 */
export function storeRowChanges(db: DatabaseSync, doc: string, added: Omit<StoredRow, "doc" | "addedOn" | "removedOn">[], removed: string[], today: string): void {
  const put = db.prepare("INSERT INTO builder_rows (doc, hash, added_on, removed_on, path, header, row) VALUES (?, ?, ?, NULL, ?, ?, ?) ON CONFLICT(doc, hash, added_on) DO UPDATE SET removed_on = NULL");
  for (const r of added) put.run(doc, r.hash, today, r.path, r.header, r.row);
  const end = db.prepare("UPDATE builder_rows SET removed_on = ? WHERE doc = ? AND hash = ? AND removed_on IS NULL");
  for (const h of removed) end.run(today, doc, h);
}

export interface StoredDoc {
  doc: string;
  hash: string;
  storedOn: string;
}

interface DocDbRow {
  doc: string;
  hash: string;
  stored_on: string;
}

const toDoc = (r: DocDbRow): StoredDoc => ({ doc: r.doc, hash: r.hash, storedOn: r.stored_on });

export function getBuilderDoc(db: DatabaseSync, doc: string): StoredDoc | null {
  const r = db.prepare("SELECT doc, hash, stored_on FROM builder_docs WHERE doc = ?").get(doc) as DocDbRow | undefined;
  return r ? toDoc(r) : null;
}

export function setBuilderDoc(db: DatabaseSync, doc: string, hash: string, today: string): void {
  db.prepare("INSERT INTO builder_docs (doc, hash, stored_on) VALUES (?, ?, ?) ON CONFLICT(doc) DO UPDATE SET hash = excluded.hash, stored_on = excluded.stored_on").run(doc, hash, today);
}

export function allBuilderDocs(db: DatabaseSync): StoredDoc[] {
  return (db.prepare("SELECT doc, hash, stored_on FROM builder_docs ORDER BY doc").all() as unknown as DocDbRow[]).map(toDoc);
}

// ---- 소스별 시각과 실패(B15, 4.1-3) ----

export interface SourceState {
  source: string;
  fetchedAt: string | null;
  failDays: number;
  failOn: string | null;
}

interface SourceDbRow {
  source: string;
  fetched_at: string | null;
  fail_days: number;
  fail_on: string | null;
}

const toSourceState = (r: SourceDbRow): SourceState => ({ source: r.source, fetchedAt: r.fetched_at, failDays: r.fail_days, failOn: r.fail_on });

export function sourceState(db: DatabaseSync, source: string): SourceState {
  const r = db.prepare("SELECT * FROM builder_sources WHERE source = ?").get(source) as SourceDbRow | undefined;
  return r ? toSourceState(r) : { source, fetchedAt: null, failDays: 0, failOn: null };
}

export function allSourceStates(db: DatabaseSync): SourceState[] {
  return (db.prepare("SELECT * FROM builder_sources ORDER BY source").all() as unknown as SourceDbRow[]).map(toSourceState);
}

function putSource(db: DatabaseSync, s: SourceState): void {
  db.prepare("INSERT INTO builder_sources (source, fetched_at, fail_days, fail_on) VALUES (?, ?, ?, ?) ON CONFLICT(source) DO UPDATE SET fetched_at = excluded.fetched_at, fail_days = excluded.fail_days, fail_on = excluded.fail_on").run(s.source, s.fetchedAt, s.failDays, s.failOn);
}

/** 받기가 성공하면 연속 실패를 지운다. 시각은 적용이 앞당긴다 */
export function markSourceOk(db: DatabaseSync, source: string): void {
  const s = sourceState(db, source);
  if (s.failDays !== 0 || s.failOn !== null) putSource(db, { ...s, failDays: 0, failOn: null });
}

/** 실패를 하루에 한 번 센다. 지금 연속 실패 일수 */
export function markSourceFailed(db: DatabaseSync, source: string, today: string): number {
  const s = sourceState(db, source);
  if (s.failOn === today) return s.failDays;
  putSource(db, { ...s, failDays: s.failDays + 1, failOn: today });
  return s.failDays + 1;
}

export function advanceSource(db: DatabaseSync, source: string, at: string): void {
  putSource(db, { ...sourceState(db, source), fetchedAt: at });
}

// ---- 미적용 변경과 낸 키(B15, B16) ----

/**
 * number: 다음 적용까지 다시 나오는 변경 표시. tentative: 지원 종료의 잠정 행(같은 수명).
 * deprecation: 지원 종료의 미래 확정 후보. 키별로 낸 횟수를 센다.
 */
export type PendingKind = "number" | "tentative" | "deprecation";

export interface PendingChange {
  key: string;
  kind: PendingKind;
  doc: string;
  changedOn: string;
  side: "added" | "removed";
  /** 숫자 행의 해시. 글은 숫자 행에서 읽는다 */
  hash: string;
  due: string | null;
  /** 바뀌기 전 행의 해시 */
  before: string[];
  emits: number;
}

interface PendingRow {
  key: string;
  kind: PendingKind;
  doc: string;
  changed_on: string;
  side: "added" | "removed";
  hash: string;
  due: string | null;
  before: string;
  emits: number;
}

const toPending = (r: PendingRow): PendingChange => ({ key: r.key, kind: r.kind, doc: r.doc, changedOn: r.changed_on, side: r.side, hash: r.hash, due: r.due, before: JSON.parse(r.before) as string[], emits: r.emits });

export function allPending(db: DatabaseSync): PendingChange[] {
  return (db.prepare("SELECT * FROM builder_pending ORDER BY doc, changed_on, key").all() as unknown as PendingRow[]).map(toPending);
}

export function getPending(db: DatabaseSync, key: string): PendingChange | null {
  const r = db.prepare("SELECT * FROM builder_pending WHERE key = ?").get(key) as unknown as PendingRow | undefined;
  return r ? toPending(r) : null;
}

/** 이미 있는 키는 그대로 둔다(낸 횟수를 지우지 않는다) */
export function addPending(db: DatabaseSync, p: Omit<PendingChange, "emits"> & { emits?: number }): void {
  db.prepare("INSERT OR IGNORE INTO builder_pending (key, kind, doc, changed_on, side, hash, due, before, emits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(p.key, p.kind, p.doc, p.changedOn, p.side, p.hash, p.due, JSON.stringify(p.before), p.emits ?? 0);
}

export function deletePending(db: DatabaseSync, key: string): void {
  db.prepare("DELETE FROM builder_pending WHERE key = ?").run(key);
}

export function bumpPending(db: DatabaseSync, key: string): void {
  db.prepare("UPDATE builder_pending SET emits = emits + 1 WHERE key = ?").run(key);
}

export function emittedKeys(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT key FROM builder_emitted").all() as { key: string }[]).map((r) => r.key));
}

export function allEmitted(db: DatabaseSync): { key: string; on: string }[] {
  return (db.prepare("SELECT key, emitted_on FROM builder_emitted ORDER BY key").all() as { key: string; emitted_on: string }[]).map((r) => ({ key: r.key, on: r.emitted_on }));
}

export function addEmitted(db: DatabaseSync, key: string, on: string): void {
  db.prepare("INSERT OR IGNORE INTO builder_emitted (key, emitted_on) VALUES (?, ?)").run(key, on);
}

// ---- 항목-일정 연결(4.4) ----

export function linkItemSchedule(db: DatabaseSync, itemId: number, scheduleId: number): boolean {
  return db.prepare("INSERT OR IGNORE INTO builder_item_schedules (item_id, schedule_id) VALUES (?, ?)").run(itemId, scheduleId).changes > 0;
}

export function unlinkItemSchedule(db: DatabaseSync, itemId: number, scheduleId: number): void {
  db.prepare("DELETE FROM builder_item_schedules WHERE item_id = ? AND schedule_id = ?").run(itemId, scheduleId);
}

/** 일정의 모든 항목 연결을 지운다. 지운 수 */
export function unlinkScheduleItems(db: DatabaseSync, scheduleId: number): number {
  return Number(db.prepare("DELETE FROM builder_item_schedules WHERE schedule_id = ?").run(scheduleId).changes);
}

/** 일정에 이어진 항목 식별자(오래된 날부터) */
export function itemsOfSchedule(db: DatabaseSync, scheduleId: number): number[] {
  const rows = db
    .prepare("SELECT l.item_id FROM builder_item_schedules l JOIN builder_items i ON i.id = l.item_id WHERE l.schedule_id = ? ORDER BY i.target_date, i.position")
    .all(scheduleId) as { item_id: number }[];
  return rows.map((r) => r.item_id);
}

/** 일정마다 처음 연결된 항목(날짜 순으로 가장 앞). 사이트와 알려진 날이 쓴다 */
export function firstItemOfSchedules(db: DatabaseSync): Map<number, { date: string; key: string }> {
  const rows = db
    .prepare("SELECT l.schedule_id, i.target_date, i.position FROM builder_item_schedules l JOIN builder_items i ON i.id = l.item_id ORDER BY i.target_date DESC, i.position DESC")
    .all() as { schedule_id: number; target_date: string; position: number }[];
  const out = new Map<number, { date: string; key: string }>();
  for (const r of rows) out.set(r.schedule_id, { date: r.target_date, key: builderItemKey(r.position) });
  return out;
}

/** 처음 연결된 항목의 날짜. 연결이 없으면 null */
export function firstItemDate(db: DatabaseSync, scheduleId: number): string | null {
  const r = db.prepare("SELECT min(i.target_date) AS d FROM builder_item_schedules l JOIN builder_items i ON i.id = l.item_id WHERE l.schedule_id = ?").get(scheduleId) as { d: string | null };
  return r.d;
}

/** 연결(`l`)의 일정에 뉴스 근거가 없다 */
const NO_NEWS_BASIS = "NOT EXISTS (SELECT 1 FROM story_schedules ss WHERE ss.schedule_id = l.schedule_id AND ss.role = 'basis')";

/** 빌더 일정 식별자: 빌더 항목이 이어져 있고 뉴스 근거가 없다(용어 정의, B13). 뉴스 연결이 하나라도 있으면 뉴스 흐름을 따른다 */
export function builderScheduleIds(db: DatabaseSync): Set<number> {
  const rows = db.prepare(`SELECT DISTINCT l.schedule_id AS id FROM builder_item_schedules l WHERE ${NO_NEWS_BASIS}`).all() as { id: number }[];
  return new Set(rows.map((r) => r.id));
}

export function isBuilderSchedule(db: DatabaseSync, scheduleId: number): boolean {
  return db.prepare(`SELECT 1 FROM builder_item_schedules l WHERE l.schedule_id = ? AND ${NO_NEWS_BASIS} LIMIT 1`).get(scheduleId) !== undefined;
}

// ---- 다시 알림 기록(4.4-3) ----

export type ReminderState = "sent" | "skip";

export interface ReminderRecord {
  schedule: number;
  state: ReminderState;
  on: string;
}

interface ReminderDbRow {
  schedule_id: number;
  state: ReminderState;
  on_date: string;
}

const toReminder = (r: ReminderDbRow): ReminderRecord => ({ schedule: r.schedule_id, state: r.state, on: r.on_date });

export function reminderOf(db: DatabaseSync, schedule: number): ReminderRecord | null {
  const r = db.prepare("SELECT schedule_id, state, on_date FROM builder_reminders WHERE schedule_id = ?").get(schedule) as ReminderDbRow | undefined;
  return r ? toReminder(r) : null;
}

export function allReminders(db: DatabaseSync): ReminderRecord[] {
  return (db.prepare("SELECT schedule_id, state, on_date FROM builder_reminders ORDER BY schedule_id").all() as unknown as ReminderDbRow[]).map(toReminder);
}

export function setReminder(db: DatabaseSync, schedule: number, state: ReminderState, on: string): void {
  db.prepare("INSERT INTO builder_reminders (schedule_id, state, on_date) VALUES (?, ?, ?) ON CONFLICT(schedule_id) DO UPDATE SET state = excluded.state, on_date = excluded.on_date").run(schedule, state, on);
}

export function clearReminder(db: DatabaseSync, schedule: number): void {
  db.prepare("DELETE FROM builder_reminders WHERE schedule_id = ?").run(schedule);
}

// ---- 정정(4.5-2) ----

export interface BuilderCorrectionRecord {
  on: string;
  reason: string;
  fields: string[];
}

interface CorrectionDbRow {
  corrected_on: string;
  reason: string;
  fields: string;
}

const toCorrection = (r: CorrectionDbRow): BuilderCorrectionRecord => ({ on: r.corrected_on, reason: r.reason, fields: JSON.parse(r.fields) as string[] });

/** 전역 항목 키(`날짜/builder-순서`) → 정정 기록(적용한 순서). 사이트와 백업이 쓴다 */
export function correctionsByItem(db: DatabaseSync): Map<string, BuilderCorrectionRecord[]> {
  const rows = db
    .prepare("SELECT c.corrected_on, c.reason, c.fields, i.target_date, i.position FROM builder_corrections c JOIN builder_items i ON i.id = c.item_id ORDER BY i.target_date, i.position, c.id")
    .all() as unknown as (CorrectionDbRow & { target_date: string; position: number })[];
  const out = new Map<string, BuilderCorrectionRecord[]>();
  for (const r of rows) {
    const k = `${r.target_date}/${builderItemKey(r.position)}`;
    out.set(k, [...(out.get(k) ?? []), toCorrection(r)]);
  }
  return out;
}

// ---- 백업(4.5-1) ----

/** 공개 백업의 빌더 파일. 식별자를 그대로 두어 일정 합치기 기록과 다시 알림이 가리키는 값이 맞는다. 후보 글과 재료는 없다 */
export interface BuilderBackup {
  formatVersion: number;
  items: Omit<BuilderItem, "key">[];
  dates: { date: string; status: BuilderStatus }[];
  rows: StoredRow[];
  docs: StoredDoc[];
  sources: SourceState[];
  pending: PendingChange[];
  emitted: { key: string; on: string }[];
  reminders: ReminderRecord[];
  corrections: (BuilderCorrectionRecord & { item: number })[];
}

export function buildBuilderBackup(db: DatabaseSync, formatVersion: number): BuilderBackup {
  const corrections = db.prepare("SELECT item_id, corrected_on, reason, fields FROM builder_corrections ORDER BY id").all() as unknown as (CorrectionDbRow & { item_id: number })[];
  return {
    formatVersion,
    items: allBuilderItems(db).map((x) => { const { key, ...rest } = x; void key; return rest; }),
    dates: allBuilderDates(db),
    rows: allRows(db),
    docs: allBuilderDocs(db),
    sources: allSourceStates(db),
    pending: allPending(db),
    emitted: allEmitted(db),
    reminders: allReminders(db),
    corrections: corrections.map((c) => ({ item: c.item_id, ...toCorrection(c) })),
  };
}

/** 빌더 백업을 넣는다(호출하는 쪽의 트랜잭션 안에서, 이슈와 일정 뒤에) */
export function restoreBuilderBackup(db: DatabaseSync, f: BuilderBackup): void {
  const item = db.prepare("INSERT INTO builder_items (id, target_date, position, field, title, what_changed, who, action, why, due_date, due_state, sources, issue_id, reminder_of) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const key = db.prepare("INSERT INTO builder_item_keys (item_id, key) VALUES (?, ?)");
  const link = db.prepare("INSERT INTO builder_item_schedules (item_id, schedule_id) VALUES (?, ?)");
  for (const x of [...f.items].sort((a, b) => a.id - b.id)) {
    item.run(x.id, x.date, x.position, x.field, x.title, x.whatChanged, x.who, x.action, x.why, x.due?.date ?? null, x.due?.state ?? null, JSON.stringify(x.sources), x.issue, x.reminderOf);
    for (const k of x.keys) key.run(x.id, k);
    for (const s of x.schedules) link.run(x.id, s);
  }
  for (const d of f.dates) setBuilderStatus(db, d.date, d.status);
  const row = db.prepare("INSERT INTO builder_rows (doc, hash, added_on, removed_on, path, header, row) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const r of f.rows) row.run(r.doc, r.hash, r.addedOn, r.removedOn, r.path, r.header, r.row);
  for (const d of f.docs) setBuilderDoc(db, d.doc, d.hash, d.storedOn);
  const source = db.prepare("INSERT INTO builder_sources (source, fetched_at, fail_days, fail_on) VALUES (?, ?, ?, ?)");
  for (const s of f.sources) source.run(s.source, s.fetchedAt, s.failDays, s.failOn);
  for (const p of f.pending) addPending(db, p);
  for (const e of f.emitted) addEmitted(db, e.key, e.on);
  for (const r of f.reminders) setReminder(db, r.schedule, r.state, r.on);
  const correction = db.prepare("INSERT INTO builder_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)");
  for (const c of f.corrections) correction.run(c.item, c.on, c.reason, JSON.stringify(c.fields));
}

/** 빌더 데이터가 하나라도 있는지. 백업 파일을 낼지 정한다 */
export function hasBuilderData(db: DatabaseSync): boolean {
  const tables = ["builder_dates", "builder_items", "builder_rows", "builder_docs", "builder_sources", "builder_pending", "builder_emitted"];
  return tables.some((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get() !== undefined);
}
