import type { DatabaseSync } from "node:sqlite";
import { FLOW_TEXT_FIELDS, SAME_FLOW_DAYS, flowItemKey, flowKeyPosition, isFlowItemKey, type FlowCategory, type FlowDateStatus, type FlowLevel, type FlowTextField, type OfficialGroup } from "./demandFlowTypes.ts";
import { inTransaction } from "./issues.ts";
import { addDays } from "./kst.ts";

// 9.97단계 S8, S11: 본 DB의 수요 흐름 항목·근거 단위·날짜 상태·정정. 사이트와 공개 백업이 이 함수들로 읽는다.

export interface FlowUnit {
  group: OfficialGroup;
  source: string;
  unitKey: string;
  /** 외부인 글 소스는 null(S7) */
  unitName: string | null;
  recent: number;
  base: number;
  isNew: boolean;
  recentFrom: string;
  recentTo: string;
  baseFrom: string;
  baseTo: string;
  recentDays: number;
  baseDays: number;
}

export interface NewFlow {
  flowId: string;
  category: FlowCategory;
  field: string;
  title: string;
  summary: string;
  reason: string;
  level: FlowLevel;
  /** 보조 근거의 소스 이름(Google Trends 나라, Mastodon 인스턴스) */
  aux: string[];
  issue: number | null;
  /** 앞서 실은 같은 흐름 항목의 행 id */
  continues: number | null;
  units: FlowUnit[];
}

export interface Flow extends NewFlow {
  id: number;
  date: string;
  position: number;
  /** 날짜 안의 항목 키(`demand-<순서>`). 정정과 주소(`#demand-<순서>`)가 쓴다 */
  itemKey: string;
}

interface FlowRow {
  id: number;
  target_date: string;
  position: number;
  flow_id: string;
  category: FlowCategory;
  field: string;
  title: string;
  summary: string;
  reason: string;
  level: FlowLevel;
  aux: string;
  issue_id: number | null;
  continues_id: number | null;
}

interface UnitRow {
  item_id: number;
  position: number;
  grp: OfficialGroup;
  source: string;
  unit_key: string;
  unit_name: string | null;
  recent: number;
  base: number;
  is_new: number;
  recent_from: string;
  recent_to: string;
  base_from: string;
  base_to: string;
  recent_days: number;
  base_days: number;
}

const toUnit = (r: UnitRow): FlowUnit => ({ group: r.grp, source: r.source, unitKey: r.unit_key, unitName: r.unit_name, recent: r.recent, base: r.base, isNew: r.is_new === 1, recentFrom: r.recent_from, recentTo: r.recent_to, baseFrom: r.base_from, baseTo: r.base_to, recentDays: r.recent_days, baseDays: r.base_days });

function toFlows(db: DatabaseSync, rows: FlowRow[]): Flow[] {
  if (rows.length === 0) return [];
  const units = db.prepare(`SELECT * FROM demand_flow_units WHERE item_id IN (${rows.map(() => "?").join(",")}) ORDER BY item_id, position`).all(...rows.map((r) => r.id)) as unknown as UnitRow[];
  const byItem = new Map<number, UnitRow[]>();
  for (const u of units) byItem.set(u.item_id, [...(byItem.get(u.item_id) ?? []), u]);
  return rows.map((r) => ({
    id: r.id,
    date: r.target_date,
    position: r.position,
    itemKey: flowItemKey(r.position),
    flowId: r.flow_id,
    category: r.category,
    field: r.field,
    title: r.title,
    summary: r.summary,
    reason: r.reason,
    level: r.level,
    aux: JSON.parse(r.aux) as string[],
    issue: r.issue_id,
    continues: r.continues_id,
    units: (byItem.get(r.id) ?? []).map(toUnit),
  }));
}

export function flowsOfDate(db: DatabaseSync, date: string): Flow[] {
  return toFlows(db, db.prepare("SELECT * FROM demand_flows WHERE target_date = ? ORDER BY position").all(date) as unknown as FlowRow[]);
}

export function allFlows(db: DatabaseSync): Flow[] {
  return toFlows(db, db.prepare("SELECT * FROM demand_flows ORDER BY target_date, position").all() as unknown as FlowRow[]);
}

export function flowByItemKey(db: DatabaseSync, date: string, itemKey: string): Flow | null {
  if (!isFlowItemKey(itemKey)) return null;
  const rows = db.prepare("SELECT * FROM demand_flows WHERE target_date = ? AND position = ?").all(date, flowKeyPosition(itemKey)) as unknown as FlowRow[];
  return toFlows(db, rows)[0] ?? null;
}

/** 같은 흐름 판정(S8)에 쓰는 앞 항목: 대상 날짜를 1일째로 셀 때 14일째까지(대상 날짜는 뺀다), 늦은 것부터 */
export function recentFlows(db: DatabaseSync, target: string): Flow[] {
  const rows = db.prepare("SELECT * FROM demand_flows WHERE target_date >= ? AND target_date < ? ORDER BY target_date DESC, position").all(addDays(target, -(SAME_FLOW_DAYS - 1)), target) as unknown as FlowRow[];
  return toFlows(db, rows);
}

/** 영구 id(S8): 처음 실린 날짜와 순서 */
export const newFlowId = (date: string, position: number) => `${date}-${position}`;

// ---- 날짜 상태 ----

export interface FlowDate {
  date: string;
  status: FlowDateStatus;
  /** 비교에 넣지 못한 공식 묶음 */
  missing: OfficialGroup[];
}

export function flowDateOf(db: DatabaseSync, date: string): FlowDate | null {
  const r = db.prepare("SELECT target_date, status, missing FROM demand_flow_dates WHERE target_date = ?").get(date) as { target_date: string; status: FlowDateStatus; missing: string } | undefined;
  return r === undefined ? null : { date: r.target_date, status: r.status, missing: JSON.parse(r.missing) as OfficialGroup[] };
}

export function allFlowDates(db: DatabaseSync): FlowDate[] {
  return (db.prepare("SELECT target_date, status, missing FROM demand_flow_dates ORDER BY target_date").all() as { target_date: string; status: FlowDateStatus; missing: string }[]).map((r) => ({ date: r.target_date, status: r.status, missing: JSON.parse(r.missing) as OfficialGroup[] }));
}

export function setFlowDate(db: DatabaseSync, d: FlowDate): void {
  db.prepare("INSERT INTO demand_flow_dates (target_date, status, missing) VALUES (?, ?, ?) ON CONFLICT(target_date) DO UPDATE SET status = excluded.status, missing = excluded.missing").run(d.date, d.status, JSON.stringify(d.missing));
}

/** 끝남: 확인함과 기준 부족(4.2-4). 받지 못함과 꺼짐은 다시 한다(4.3-2) */
export function isFlowDateDone(db: DatabaseSync, date: string): boolean {
  const s = flowDateOf(db, date)?.status;
  return s === "checked" || s === "short";
}

function insertFlowUnits(db: DatabaseSync, itemId: number, units: readonly FlowUnit[]): void {
  const u = db.prepare("INSERT INTO demand_flow_units (item_id, position, grp, source, unit_key, unit_name, recent, base, is_new, recent_from, recent_to, base_from, base_to, recent_days, base_days) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  units.forEach((x, i) => u.run(itemId, i + 1, x.group, x.source, x.unitKey, x.unitName, x.recent, x.base, x.isNew ? 1 : 0, x.recentFrom, x.recentTo, x.baseFrom, x.baseTo, x.recentDays, x.baseDays));
}

/** 항목과 근거 단위를 넣고 행 id를 돌려준다. id가 있으면 그 id로 넣는다(백업 되살리기) */
function insertFlow(db: DatabaseSync, date: string, position: number, f: NewFlow, id?: number): number {
  const r = db.prepare("INSERT INTO demand_flows (id, target_date, position, flow_id, category, field, title, summary, reason, level, aux, issue_id, continues_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(id ?? null, date, position, f.flowId, f.category, f.field, f.title, f.summary, f.reason, f.level, JSON.stringify(f.aux), f.issue, f.continues);
  const itemId = Number(r.lastInsertRowid);
  insertFlowUnits(db, itemId, f.units);
  return itemId;
}

/**
 * 그날의 항목과 날짜 상태를 한 거래로 저장한다(4.2-4). 영구 id가 비어 있는 항목은 그날 순서로 새 id를 받는다.
 * fail이 있으면 저장 도중 부른다(시험에서 중간 실패를 흉내 낸다)
 */
export function saveFlows(db: DatabaseSync, date: string, flows: NewFlow[], status: FlowDate, fail?: () => void): void {
  inTransaction(db, () => {
    flows.forEach((f, i) => {
      insertFlow(db, date, i + 1, { ...f, flowId: f.flowId === "" ? newFlowId(date, i + 1) : f.flowId });
      if (i === 0) fail?.();
    });
    setFlowDate(db, status);
  });
}

// ---- 정정 ----

export interface FlowCorrection {
  on: string;
  reason: string;
  fields: FlowTextField[];
}

export function flowCorrections(db: DatabaseSync, itemId: number): FlowCorrection[] {
  return (db.prepare("SELECT corrected_on, reason, fields FROM demand_flow_corrections WHERE item_id = ? ORDER BY id").all(itemId) as { corrected_on: string; reason: string; fields: string }[]).map((r) => ({ on: r.corrected_on, reason: r.reason, fields: JSON.parse(r.fields) as FlowTextField[] }));
}

/** 모든 정정을 항목 행 id마다 묶는다(사이트 빌드가 흐름마다 묻지 않게) */
export function flowCorrectionsByItem(db: DatabaseSync): Map<number, FlowCorrection[]> {
  const out = new Map<number, FlowCorrection[]>();
  const rows = db.prepare("SELECT item_id, corrected_on, reason, fields FROM demand_flow_corrections ORDER BY id").all() as { item_id: number; corrected_on: string; reason: string; fields: string }[];
  for (const r of rows) {
    let list = out.get(r.item_id);
    if (list === undefined) out.set(r.item_id, (list = []));
    list.push({ on: r.corrected_on, reason: r.reason, fields: JSON.parse(r.fields) as FlowTextField[] });
  }
  return out;
}

export function correctFlow(db: DatabaseSync, itemId: number, fields: Partial<Record<FlowTextField, string>>, changed: FlowTextField[], reason: string, today: string): void {
  inTransaction(db, () => {
    for (const f of changed) if ((FLOW_TEXT_FIELDS as string[]).includes(f)) db.prepare(`UPDATE demand_flows SET ${f} = ? WHERE id = ?`).run(fields[f]!, itemId);
    db.prepare("INSERT INTO demand_flow_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(itemId, today, reason, JSON.stringify(changed));
  });
}

// ---- 공개 백업(S11) ----

export interface DemandBackup {
  formatVersion: number;
  flows: Omit<Flow, "itemKey">[];
  flowDates: FlowDate[];
  flowCorrections: (FlowCorrection & { item: number })[];
}

export function hasFlowData(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM demand_flow_dates LIMIT 1").get() !== undefined || db.prepare("SELECT 1 FROM demand_flows LIMIT 1").get() !== undefined;
}

export function buildDemandBackup(db: DatabaseSync, formatVersion: number): DemandBackup {
  const corrections = db.prepare("SELECT item_id, corrected_on, reason, fields FROM demand_flow_corrections ORDER BY id").all() as { item_id: number; corrected_on: string; reason: string; fields: string }[];
  return {
    formatVersion,
    flows: allFlows(db).map((f) => {
      const { itemKey, ...rest } = f;
      void itemKey;
      return rest;
    }),
    flowDates: allFlowDates(db),
    flowCorrections: corrections.map((c) => ({ item: c.item_id, on: c.corrected_on, reason: c.reason, fields: JSON.parse(c.fields) as FlowTextField[] })),
  };
}

/** 호출하는 쪽의 트랜잭션 안에서, 이슈 뒤에 넣는다. 행 id를 그대로 둬 이어짐과 정정이 되살아난다 */
export function restoreDemandBackup(db: DatabaseSync, f: DemandBackup): void {
  for (const x of [...f.flows].sort((a, b) => a.id - b.id)) insertFlow(db, x.date, x.position, x, x.id);
  for (const d of f.flowDates) setFlowDate(db, d);
  const c = db.prepare("INSERT INTO demand_flow_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)");
  for (const x of f.flowCorrections) c.run(x.item, x.on, x.reason, JSON.stringify(x.fields));
}
