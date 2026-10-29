import type { DatabaseSync } from "node:sqlite";
import { allIssues } from "./issues.ts";
import { INDICATORS, MAX_ISSUE_INDICATORS, indicatorDef } from "./indicators.ts";

// 6단계 4.1: 지표 값, 이슈-지표 연결과 판단 여부, 합치기·되돌리기의 지표 처리(4.3-6), 백업 데이터(4.4-1).

export interface IndicatorValue {
  date: string;
  value: number;
}

export function indicatorValues(db: DatabaseSync, id: string): IndicatorValue[] {
  return db.prepare("SELECT date, value FROM indicator_values WHERE indicator = ? ORDER BY date").all(id) as unknown as IndicatorValue[];
}

export function valueCount(db: DatabaseSync, id: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM indicator_values WHERE indicator = ?").get(id) as { n: number }).n;
}

export function lastValueDate(db: DatabaseSync, id: string): string | null {
  return (db.prepare("SELECT MAX(date) AS d FROM indicator_values WHERE indicator = ?").get(id) as { d: string | null }).d;
}

export function firstValueDate(db: DatabaseSync, id: string): string | null {
  return (db.prepare("SELECT MIN(date) AS d FROM indicator_values WHERE indicator = ?").get(id) as { d: string | null }).d;
}

export interface StoreCount {
  added: number;
  changed: number;
  removed: number;
}

/** 받은 값을 더한다(4.1-2). 같은 날짜 값은 하나만 두고, 다르면 새 값으로 바꾼다 */
export function upsertValues(db: DatabaseSync, id: string, rows: IndicatorValue[]): StoreCount {
  const get = db.prepare("SELECT value FROM indicator_values WHERE indicator = ? AND date = ?");
  const put = db.prepare("INSERT INTO indicator_values (indicator, date, value) VALUES (?, ?, ?) ON CONFLICT (indicator, date) DO UPDATE SET value = excluded.value");
  const count: StoreCount = { added: 0, changed: 0, removed: 0 };
  inTx(db, () => {
    for (const r of rows) {
      const old = get.get(id, r.date) as { value: number } | undefined;
      if (old === undefined) count.added++;
      else if (old.value === r.value) continue;
      else count.changed++;
      put.run(id, r.date, r.value);
    }
  });
  return count;
}

/** 저장 값을 받은 값으로 통째로 바꾼다(월별 지표, X9-①) */
export function replaceValues(db: DatabaseSync, id: string, rows: IndicatorValue[]): StoreCount {
  const before = new Map(indicatorValues(db, id).map((v) => [v.date, v.value]));
  const after = new Map(rows.map((r) => [r.date, r.value]));
  const count: StoreCount = { added: 0, changed: 0, removed: 0 };
  for (const [d, v] of after) {
    const old = before.get(d);
    if (old === undefined) count.added++;
    else if (old !== v) count.changed++;
  }
  for (const d of before.keys()) if (!after.has(d)) count.removed++;
  inTx(db, () => {
    db.prepare("DELETE FROM indicator_values WHERE indicator = ?").run(id);
    const put = db.prepare("INSERT INTO indicator_values (indicator, date, value) VALUES (?, ?, ?)");
    for (const [d, v] of after) put.run(id, d, v);
  });
  return count;
}

// ---- 이슈-지표 연결과 판단 여부(4.1-3) ----

export function issueIndicators(db: DatabaseSync, issueId: number): string[] {
  const rows = db.prepare("SELECT indicator FROM issue_indicators WHERE issue_id = ?").all(issueId) as { indicator: string }[];
  return sortIndicators(rows.map((r) => r.indicator));
}

/** 정의 순서로 정렬한다(정의에 없는 식별자는 뒤에, 이름순) */
export function sortIndicators(ids: Iterable<string>): string[] {
  const order = new Map(INDICATORS.map((d, i) => [d.id, i]));
  return [...new Set(ids)].sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
}

export function isJudged(db: DatabaseSync, issueId: number): boolean {
  return db.prepare("SELECT 1 FROM indicator_judged WHERE issue_id = ?").get(issueId) !== undefined;
}

function setJudged(db: DatabaseSync, issueId: number, judged: boolean): void {
  if (judged) db.prepare("INSERT OR IGNORE INTO indicator_judged (issue_id) VALUES (?)").run(issueId);
  else db.prepare("DELETE FROM indicator_judged WHERE issue_id = ?").run(issueId);
}

function setIndicators(db: DatabaseSync, issueId: number, ids: string[]): void {
  db.prepare("DELETE FROM issue_indicators WHERE issue_id = ?").run(issueId);
  const put = db.prepare("INSERT INTO issue_indicators (issue_id, indicator) VALUES (?, ?)");
  for (const id of new Set(ids)) put.run(issueId, id);
}

/** 지표 판단 대상: 흡수되지 않았고 "판단 안 함"인 이슈(식별자 순, 4.3-1) */
export function unjudgedIssues(db: DatabaseSync): number[] {
  const judged = new Set((db.prepare("SELECT issue_id FROM indicator_judged").all() as { issue_id: number }[]).map((r) => r.issue_id));
  return allIssues(db)
    .filter((i) => i.mergedInto === null && !judged.has(i.id))
    .map((i) => i.id)
    .sort((a, b) => a - b);
}

/** 판단 결과를 적용한다: 연결을 바꾸고 "판단함"으로 둔다(4.3-3) */
export function applyJudgment(db: DatabaseSync, issueId: number, ids: string[]): void {
  setIndicators(db, issueId, ids);
  setJudged(db, issueId, true);
}

// ---- 합치기와 되돌리기(4.3-6) ----

interface IssueIndicatorState {
  judged: boolean;
  indicators: string[];
}

/** 합치기 하나의 지표 기록. added는 이 합치기로 남는 이슈에 더해진 지표 */
export interface IndicatorMergeRecord {
  survivor: IssueIndicatorState;
  absorbed: IssueIndicatorState;
  added: string[];
}

function stateOf(db: DatabaseSync, issueId: number): IssueIndicatorState {
  return { judged: isJudged(db, issueId), indicators: issueIndicators(db, issueId) };
}

/** 6단계 표가 있는 DB인지(테스트가 옛 버전 DB에서 지금 코드의 합치기를 부를 때 지표 처리를 건너뛰기 위해서다) */
function hasIndicatorTables(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'indicator_merges'").get() !== undefined;
}

/** 이슈 합치기 하나에 붙인다(merges 행을 넣은 뒤). 흡수된 이슈의 지표는 남는 이슈로 옮긴다 */
export function mergeIndicators(db: DatabaseSync, mergeId: number, survivor: number, absorbed: number): void {
  if (!hasIndicatorTables(db)) return;
  const s = stateOf(db, survivor);
  const a = stateOf(db, absorbed);
  const added = a.indicators.filter((x) => !s.indicators.includes(x));
  const all = sortIndicators([...s.indicators, ...added]);
  setIndicators(db, survivor, all);
  setJudged(db, survivor, s.judged && a.judged && all.length <= MAX_ISSUE_INDICATORS);
  setIndicators(db, absorbed, []);
  setJudged(db, absorbed, false);
  const record: IndicatorMergeRecord = { survivor: s, absorbed: a, added };
  db.prepare("INSERT INTO indicator_merges (merge_id, record) VALUES (?, ?)").run(mergeId, JSON.stringify(record));
}

function mergeRecord(db: DatabaseSync, mergeId: number): IndicatorMergeRecord | null {
  const row = db.prepare("SELECT record FROM indicator_merges WHERE merge_id = ?").get(mergeId) as { record: string } | undefined;
  return row === undefined ? null : (JSON.parse(row.record) as IndicatorMergeRecord);
}

/**
 * 합치기 되돌리기에 붙인다. 두 이슈를 합치기 전 상태로 되돌리되, 같은 남는 이슈에 나중에 한 합치기로 들어온 지표는 남긴다.
 * 이 합치기와 나중 합치기가 함께 더한 지표는 나중 합치기의 "더해진 것"으로 넘긴다(그 합치기를 되돌릴 때 빠지게).
 * 지표 기록이 없는 옛 합치기(6단계 전)는 두 이슈 모두 "판단 안 함"이 된다.
 */
export function unmergeIndicators(db: DatabaseSync, mergeId: number, survivor: number, absorbed: number, laterIntoSurvivor: number[]): void {
  if (!hasIndicatorTables(db)) return;
  const rec = mergeRecord(db, mergeId);
  if (rec === null) {
    setJudged(db, survivor, false);
    setJudged(db, absorbed, false);
    return;
  }
  const later = laterIntoSurvivor.map((id) => ({ id, rec: mergeRecord(db, id) }));
  const kept = new Set(later.flatMap((x) => x.rec?.added ?? []));
  for (const x of rec.added) {
    const to = later.find((l) => l.rec !== null && l.rec.absorbed.indicators.includes(x) && !l.rec.added.includes(x));
    if (to?.rec) {
      to.rec.added.push(x);
      kept.add(x);
    }
  }
  // 이 합치기로 들어온 지표는 나중 합치기의 "합치기 전 남는 이슈" 기록에서도 뺀다(나중 합치기를 되돌릴 때 되살아나지 않게)
  for (const l of later) {
    if (!l.rec) continue;
    l.rec.survivor.indicators = l.rec.survivor.indicators.filter((x) => !rec.added.includes(x));
    db.prepare("UPDATE indicator_merges SET record = ? WHERE merge_id = ?").run(JSON.stringify(l.rec), l.id);
  }
  const survivorIds = sortIndicators([...rec.survivor.indicators, ...kept]);
  setIndicators(db, survivor, survivorIds);
  setJudged(db, survivor, rec.survivor.judged && survivorIds.length <= MAX_ISSUE_INDICATORS);
  setIndicators(db, absorbed, rec.absorbed.indicators);
  setJudged(db, absorbed, rec.absorbed.judged && rec.absorbed.indicators.length <= MAX_ISSUE_INDICATORS);
}

// ---- 백업(4.4-1) ----

export interface IndicatorsBackup {
  formatVersion: number;
  /** 백업하는 지표마다 출처 표시와 값([날짜, 값]) */
  indicators: { id: string; credit: string; values: [string, number][] }[];
  links: { issue: number; indicator: string }[];
  judged: number[];
  merges: { merge: number; record: IndicatorMergeRecord }[];
}

export function hasIndicatorData(db: DatabaseSync): boolean {
  return ["indicator_values", "issue_indicators", "indicator_judged", "indicator_merges"].some((t) => db.prepare(`SELECT 1 FROM ${t} LIMIT 1`).get() !== undefined);
}

export function buildIndicatorsBackup(db: DatabaseSync, formatVersion: number): IndicatorsBackup {
  const indicators = INDICATORS.filter((d) => d.backup).map((d) => ({
    id: d.id,
    credit: d.credit,
    values: indicatorValues(db, d.id).map((v): [string, number] => [v.date, v.value]),
  }));
  const links = db.prepare("SELECT issue_id AS issue, indicator FROM issue_indicators ORDER BY issue_id, indicator").all() as unknown as IndicatorsBackup["links"];
  const judged = (db.prepare("SELECT issue_id FROM indicator_judged ORDER BY issue_id").all() as { issue_id: number }[]).map((r) => r.issue_id);
  const merges = (db.prepare("SELECT merge_id, record FROM indicator_merges ORDER BY merge_id").all() as { merge_id: number; record: string }[]).map((r) => ({
    merge: r.merge_id,
    record: JSON.parse(r.record) as IndicatorMergeRecord,
  }));
  return { formatVersion, indicators, links, judged, merges };
}

/** 백업에서 되살린다(이슈와 합치기 기록을 되살린 뒤). 백업하지 않는 지표의 값은 백업에 없어 다음 받기가 처음부터 받는다 */
export function restoreIndicatorsBackup(db: DatabaseSync, f: IndicatorsBackup): void {
  const put = db.prepare("INSERT INTO indicator_values (indicator, date, value) VALUES (?, ?, ?)");
  for (const ind of f.indicators) {
    if (indicatorDef(ind.id)?.backup === false) continue;
    for (const [d, v] of ind.values) put.run(ind.id, d, v);
  }
  for (const l of f.links) db.prepare("INSERT INTO issue_indicators (issue_id, indicator) VALUES (?, ?)").run(l.issue, l.indicator);
  for (const id of f.judged) db.prepare("INSERT INTO indicator_judged (issue_id) VALUES (?)").run(id);
  for (const m of f.merges) db.prepare("INSERT INTO indicator_merges (merge_id, record) VALUES (?, ?)").run(m.merge, JSON.stringify(m.record));
}

function inTx(db: DatabaseSync, fn: () => void): void {
  if (db.isTransaction) {
    fn();
    return;
  }
  db.exec("BEGIN");
  try {
    fn();
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
