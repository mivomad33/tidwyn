import type { DatabaseSync } from "node:sqlite";
import { DISCOVER_KINDS, discoveryItemKey, isDiscoveryItemKey, type DiscoverKind, type KindStatus, type ReleaseInfo } from "./builderTypes.ts";
import { inTransaction } from "./issues.ts";
import { addDays } from "./kst.ts";

// 9.9단계: 새 제품과 뜨는 저장소의 저장. 종류별 상태(N9), 실린 키(N7), 별 수 스냅샷(N1, N6).
// 스냅샷과 메타데이터는 로컬에만 둔다. 항목과 상태는 도구 변화의 builder_items, builder_dates와 섞지 않는다(N4).

export { DISCOVER_KINDS };
export type { DiscoverKind, KindStatus, ReleaseInfo };

/** 종류별 하루 최대 항목 수(D15) */
export const MAX_DISCOVERIES_PER_KIND = 3;
/** 스냅샷을 두는 날 수: 대상 날짜 기준 8일째까지(N6) */
export const SNAPSHOT_KEEP_DAYS = 8;
/** 저장소 키를 다시 후보로 내지 않는 날 수: 90일째까지(N7) */
export const REPO_KEY_DAYS = 90;

// ---- 종류별 상태 ----

export function kindStatusOf(db: DatabaseSync, date: string, kind: DiscoverKind): KindStatus | null {
  const r = db.prepare("SELECT status FROM builder_kind_dates WHERE target_date = ? AND kind = ?").get(date, kind) as { status: KindStatus } | undefined;
  return r?.status ?? null;
}

export function setKindStatus(db: DatabaseSync, date: string, kind: DiscoverKind, status: KindStatus): void {
  db.prepare("INSERT INTO builder_kind_dates (target_date, kind, status) VALUES (?, ?, ?) ON CONFLICT(target_date, kind) DO UPDATE SET status = excluded.status").run(date, kind, status);
}

/** 끝남: 확인함, 기준값 쌓는 중, 꺼짐(N9) */
export function isKindDone(db: DatabaseSync, date: string, kind: DiscoverKind): boolean {
  const s = kindStatusOf(db, date, kind);
  return s !== null && s !== "failed";
}

export function undoneKinds(db: DatabaseSync, date: string): DiscoverKind[] {
  return DISCOVER_KINDS.filter((k) => !isKindDone(db, date, k));
}

export interface KindDate {
  date: string;
  kind: DiscoverKind;
  status: KindStatus;
}

/** 기록이 있는 날짜·종류와 상태(오래된 날부터). 사이트와 백업이 쓴다 */
export function allKindDates(db: DatabaseSync): KindDate[] {
  return (db.prepare("SELECT target_date, kind, status FROM builder_kind_dates ORDER BY target_date, kind").all() as { target_date: string; kind: DiscoverKind; status: KindStatus }[]).map((r) => ({ date: r.target_date, kind: r.kind, status: r.status }));
}

// ---- 항목과 실린 키 ----

export interface NewDiscovery {
  date: string;
  kind: DiscoverKind;
  key: string;
  name: string;
  url: string;
  purpose: string;
  difference: string;
  reason: string;
  issue: number | null;
  /** 저장소만 */
  license: string | null;
  pushedOn: string | null;
  release: ReleaseInfo | null;
  stars: number | null;
  growth: number | null;
}

export interface Discovery extends NewDiscovery {
  id: number;
  position: number;
  /** 날짜 안의 항목 키(`product-<순서>`, `repo-<순서>`). `key`는 중복을 막는 키다 */
  itemKey: string;
}

interface DiscoveryRow {
  id: number;
  target_date: string;
  kind: DiscoverKind;
  position: number;
  key: string;
  name: string;
  url: string;
  purpose: string;
  difference: string;
  reason: string;
  issue_id: number | null;
  license: string | null;
  pushed_on: string | null;
  release_state: ReleaseInfo["state"] | null;
  release_on: string | null;
  stars: number | null;
  growth: number | null;
}

function toRelease(r: DiscoveryRow): ReleaseInfo | null {
  if (r.release_state === null) return null;
  return r.release_state === "found" ? { state: "found", date: r.release_on ?? "" } : { state: r.release_state };
}

const toDiscovery = (r: DiscoveryRow): Discovery => ({
  id: r.id,
  date: r.target_date,
  kind: r.kind,
  position: r.position,
  itemKey: discoveryItemKey(r.kind, r.position),
  key: r.key,
  name: r.name,
  url: r.url,
  purpose: r.purpose,
  difference: r.difference,
  reason: r.reason,
  issue: r.issue_id,
  license: r.license,
  pushedOn: r.pushed_on,
  release: toRelease(r),
  stars: r.stars,
  growth: r.growth,
});

/** 모든 항목(날짜, 종류, 순서 순). 사이트와 백업이 쓴다 */
export function allDiscoveries(db: DatabaseSync): Discovery[] {
  return (db.prepare("SELECT * FROM builder_discoveries ORDER BY target_date, kind, position").all() as unknown as DiscoveryRow[]).map(toDiscovery);
}

export function discoveriesOfDate(db: DatabaseSync, date: string, kind: DiscoverKind): Discovery[] {
  return (db.prepare("SELECT * FROM builder_discoveries WHERE target_date = ? AND kind = ? ORDER BY position").all(date, kind) as unknown as DiscoveryRow[]).map(toDiscovery);
}

/** 날짜와 항목 키로 찾는다 */
export function discoveryByItemKey(db: DatabaseSync, date: string, itemKey: string): Discovery | null {
  if (!isDiscoveryItemKey(itemKey)) return null;
  const [kind, position] = itemKey.split("-");
  const r = db.prepare("SELECT * FROM builder_discoveries WHERE target_date = ? AND kind = ? AND position = ?").get(date, kind!, Number(position)) as unknown as DiscoveryRow | undefined;
  return r ? toDiscovery(r) : null;
}

/** 항목 하나를 날짜·종류 끝에 더한다. 식별자 */
export function insertDiscovery(db: DatabaseSync, x: NewDiscovery): number {
  const pos = (db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM builder_discoveries WHERE target_date = ? AND kind = ?").get(x.date, x.kind) as { p: number }).p + 1;
  const released = x.release?.state === "found" ? x.release.date : null;
  const r = db
    .prepare("INSERT INTO builder_discoveries (target_date, kind, position, key, name, url, purpose, difference, reason, issue_id, license, pushed_on, release_state, release_on, stars, growth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(x.date, x.kind, pos, x.key, x.name, x.url, x.purpose, x.difference, x.reason, x.issue, x.license, x.pushedOn, x.release?.state ?? null, released, x.stars, x.growth);
  return Number(r.lastInsertRowid);
}

/** 실린 제품 키 전체. 제품은 한 번 실리면 다시 후보가 아니다(N7) */
export function publishedProductKeys(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT key FROM builder_discoveries WHERE kind = 'product'").all() as { key: string }[]).map((r) => r.key));
}

/** 실린 지 90일 안(90일째까지)의 저장소 키 */
export function recentRepoKeys(db: DatabaseSync, target: string): Set<string> {
  return new Set((db.prepare("SELECT DISTINCT key FROM builder_discoveries WHERE kind = 'repo' AND target_date >= ?").all(addDays(target, -REPO_KEY_DAYS)) as { key: string }[]).map((r) => r.key));
}

// ---- 정정(4.4-2) ----

export interface DiscoveryCorrection {
  on: string;
  reason: string;
  fields: string[];
}

interface DiscoveryCorrectionRow {
  corrected_on: string;
  reason: string;
  fields: string;
}

const toCorrection = (r: DiscoveryCorrectionRow): DiscoveryCorrection => ({ on: r.corrected_on, reason: r.reason, fields: JSON.parse(r.fields) as string[] });

/** 전역 항목 키(`날짜/product-순서`) → 정정 기록(적용한 순서). 사이트가 쓴다 */
export function correctionsByDiscovery(db: DatabaseSync): Map<string, DiscoveryCorrection[]> {
  const rows = db
    .prepare("SELECT c.corrected_on, c.reason, c.fields, i.target_date, i.kind, i.position FROM builder_discovery_corrections c JOIN builder_discoveries i ON i.id = c.item_id ORDER BY i.target_date, i.kind, i.position, c.id")
    .all() as unknown as (DiscoveryCorrectionRow & { target_date: string; kind: DiscoverKind; position: number })[];
  const out = new Map<string, DiscoveryCorrection[]>();
  for (const r of rows) {
    const k = `${r.target_date}/${discoveryItemKey(r.kind, r.position)}`;
    out.set(k, [...(out.get(k) ?? []), toCorrection(r)]);
  }
  return out;
}

// ---- 백업(4.4-1). 스냅샷과 메타데이터는 넣지 않는다(N6) ----

export interface DiscoveriesBackup {
  discoveries: Omit<Discovery, "itemKey">[];
  kindDates: KindDate[];
  discoveryCorrections: (DiscoveryCorrection & { item: number })[];
}

export function buildDiscoveriesBackup(db: DatabaseSync): DiscoveriesBackup {
  const corrections = db.prepare("SELECT item_id, corrected_on, reason, fields FROM builder_discovery_corrections ORDER BY id").all() as unknown as (DiscoveryCorrectionRow & { item_id: number })[];
  return {
    discoveries: allDiscoveries(db).map((x) => {
      const { itemKey, ...rest } = x;
      void itemKey;
      return rest;
    }),
    kindDates: allKindDates(db),
    discoveryCorrections: corrections.map((c) => ({ item: c.item_id, ...toCorrection(c) })),
  };
}

/** 호출하는 쪽의 트랜잭션 안에서, 이슈 뒤에 넣는다. 형식 7까지의 백업은 빈 값으로 온다 */
export function restoreDiscoveriesBackup(db: DatabaseSync, f: Partial<DiscoveriesBackup>): void {
  const item = db.prepare("INSERT INTO builder_discoveries (id, target_date, kind, position, key, name, url, purpose, difference, reason, issue_id, license, pushed_on, release_state, release_on, stars, growth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const x of f.discoveries ?? []) {
    item.run(x.id, x.date, x.kind, x.position, x.key, x.name, x.url, x.purpose, x.difference, x.reason, x.issue, x.license, x.pushedOn, x.release?.state ?? null, x.release?.state === "found" ? x.release.date : null, x.stars, x.growth);
  }
  for (const k of f.kindDates ?? []) setKindStatus(db, k.date, k.kind, k.status);
  const correction = db.prepare("INSERT INTO builder_discovery_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)");
  for (const c of f.discoveryCorrections ?? []) correction.run(c.item, c.on, c.reason, JSON.stringify(c.fields));
}

// ---- 별 수 스냅샷 ----

export type SnapshotState = "running" | "complete" | "short";

export interface SnapshotRun {
  date: string;
  state: SnapshotState;
  /** 이어 받을 자리: 별 상한(null이면 상한 없음)과 페이지 */
  nextHi: number | null;
  nextPage: number;
  calls: number;
  elapsedMs: number;
  reason: string | null;
}

interface RunRow {
  snapshot_date: string;
  state: SnapshotState;
  next_hi: number | null;
  next_page: number;
  calls: number;
  elapsed_ms: number;
  reason: string | null;
}

export function snapshotRun(db: DatabaseSync, date: string): SnapshotRun | null {
  const r = db.prepare("SELECT * FROM repo_snapshot_runs WHERE snapshot_date = ?").get(date) as unknown as RunRow | undefined;
  return r ? { date: r.snapshot_date, state: r.state, nextHi: r.next_hi, nextPage: r.next_page, calls: r.calls, elapsedMs: r.elapsed_ms, reason: r.reason } : null;
}

export function beginSnapshot(db: DatabaseSync, date: string): SnapshotRun {
  db.prepare("INSERT OR IGNORE INTO repo_snapshot_runs (snapshot_date, state) VALUES (?, 'running')").run(date);
  return snapshotRun(db, date)!;
}

export interface SnapshotRow {
  /** 소문자 owner/name */
  repo: string;
  /** 응답의 표기 그대로 */
  name: string;
  stars: number;
  description: string | null;
  language: string | null;
  license: string | null;
  pushedAt: string;
  forks: number;
  createdAt: string;
}

export function saveSnapshotRows(db: DatabaseSync, date: string, rows: SnapshotRow[]): void {
  const stars = db.prepare("INSERT INTO repo_snapshots (snapshot_date, repo, stars) VALUES (?, ?, ?) ON CONFLICT(snapshot_date, repo) DO UPDATE SET stars = excluded.stars");
  const meta = db.prepare("INSERT OR REPLACE INTO repo_snapshot_meta (snapshot_date, repo, name, description, language, license, pushed_at, forks, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const r of rows) {
    stars.run(date, r.repo, r.stars);
    meta.run(date, r.repo, r.name, r.description, r.language, r.license, r.pushedAt, r.forks, r.createdAt);
  }
}

export function setSnapshotCursor(db: DatabaseSync, date: string, nextHi: number | null, nextPage: number): void {
  db.prepare("UPDATE repo_snapshot_runs SET next_hi = ?, next_page = ? WHERE snapshot_date = ?").run(nextHi, nextPage, date);
}

/** 이번 호출의 호출 수와 시간을 더하고 멈춘 이유를 남긴다 */
export function addSnapshotUsage(db: DatabaseSync, date: string, calls: number, elapsedMs: number, reason: string | null): void {
  db.prepare("UPDATE repo_snapshot_runs SET calls = calls + ?, elapsed_ms = elapsed_ms + ?, reason = ? WHERE snapshot_date = ?").run(calls, elapsedMs, reason, date);
}

/** 완성으로 표시하고 다른 날짜의 메타데이터를 지운다 */
export function completeSnapshot(db: DatabaseSync, date: string): void {
  inTransaction(db, () => {
    db.prepare("UPDATE repo_snapshot_runs SET state = 'complete', reason = NULL WHERE snapshot_date = ?").run(date);
    db.prepare("DELETE FROM repo_snapshot_meta WHERE snapshot_date <> ?").run(date);
  });
}

/** 받은 행이 모자라 완성으로 치지 않는다. 그날은 다시 받지 않는다 */
export function markSnapshotShort(db: DatabaseSync, date: string, reason: string): void {
  db.prepare("UPDATE repo_snapshot_runs SET state = 'short', reason = ? WHERE snapshot_date = ?").run(reason, date);
}

export function snapshotRowCount(db: DatabaseSync, date: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM repo_snapshots WHERE snapshot_date = ?").get(date) as { n: number }).n;
}

/** 대상 날짜 기준 8일째보다 오래된 스냅샷을 지운다 */
export function pruneSnapshots(db: DatabaseSync, target: string): void {
  const limit = addDays(target, -SNAPSHOT_KEEP_DAYS);
  inTransaction(db, () => {
    for (const t of ["repo_snapshots", "repo_snapshot_meta", "repo_snapshot_runs"]) db.prepare(`DELETE FROM ${t} WHERE snapshot_date < ?`).run(limit);
  });
}

/** 기록이 있는 날짜(오래된 날부터) */
export function snapshotDates(db: DatabaseSync): string[] {
  return (db.prepare("SELECT snapshot_date AS d FROM repo_snapshot_runs ORDER BY snapshot_date").all() as { d: string }[]).map((r) => r.d);
}

/** 비교에 쓸 수 있는 지난 완성 스냅샷 날짜(오래된 날부터). 대상 날짜 자신과 8일 넘은 값은 뺀다 */
export function completeSnapshotDates(db: DatabaseSync, target: string): string[] {
  const rows = db.prepare("SELECT snapshot_date AS d FROM repo_snapshot_runs WHERE state = 'complete' AND snapshot_date < ? AND snapshot_date >= ? ORDER BY snapshot_date").all(target, addDays(target, -SNAPSHOT_KEEP_DAYS)) as { d: string }[];
  return rows.map((r) => r.d);
}

/** 날짜의 저장소별 별 수 */
export function snapshotStars(db: DatabaseSync, date: string): Map<string, number> {
  const rows = db.prepare("SELECT repo, stars FROM repo_snapshots WHERE snapshot_date = ?").all(date) as { repo: string; stars: number }[];
  return new Map(rows.map((r) => [r.repo, r.stars]));
}

export type SnapshotMeta = Omit<SnapshotRow, "stars">;

/** 날짜의 메타데이터. 완성되면 최신 완성 스냅샷 것만 남는다 */
export function snapshotMeta(db: DatabaseSync, date: string): Map<string, SnapshotMeta> {
  const rows = db.prepare("SELECT repo, name, description, language, license, pushed_at, forks, created_at FROM repo_snapshot_meta WHERE snapshot_date = ?").all(date) as unknown as { repo: string; name: string; description: string | null; language: string | null; license: string | null; pushed_at: string; forks: number; created_at: string }[];
  return new Map(rows.map((r) => [r.repo, { repo: r.repo, name: r.name, description: r.description, language: r.language, license: r.license, pushedAt: r.pushed_at, forks: r.forks, createdAt: r.created_at }]));
}
