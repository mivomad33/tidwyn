import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { StoredBrief } from "./brief.ts";
import { openDb } from "./db.ts";
import { git, gitTry } from "./git.ts";
import {
  FIRST_LINKED_KEY,
  MERGE_CHECKED_KEY,
  allIssues,
  developments,
  fullKey,
  getMeta,
  hasIssueData,
  setMeta,
  storyByFullKey,
  type IssueStatus,
} from "./issues.ts";
import type { Category } from "./brief.ts";
import type { Major } from "./categories.ts";
import { listScheduleMerges, type ScheduleMergeRow } from "./scheduleMerge.ts";
import { allSchedules, hasScheduleData, markScheduled, scheduledDates, storiesOfSchedule, type ScheduleOutcome, type ScheduleRole } from "./schedules.ts";
import { listMerges, type MergeRecord } from "./merge.ts";
import { buildIndicatorsBackup, hasIndicatorData, restoreIndicatorsBackup, type IndicatorsBackup } from "./indicatorStore.ts";
import { listRefMerges, type RefMergeRecord } from "./refMerge.ts";
import { allEntities, allTerms, extractedDates, hasRefData, markExtracted, storiesOfRef, type EntityKind, type RefItem } from "./refs.ts";
import { getFirstCollectionDate, loadBrief, recordFirstCollectionDate, saveBrief, storedDates } from "./store.ts";

// 월별 JSON 백업(4.5-1), data 브랜치 커밋(4.5-2), 복원(4.5-3).
// 형식 2(2단계): 이슈 데이터를 issues.json에 따로 둔다. 이슈 데이터가 없으면 이 파일과 meta의 이슈 키를 쓰지 않는다.
// 형식 3(4단계 4.4-1): 대상·용어 데이터를 refs.json에 따로 두고, 달 파일에 뽑기 완료 날짜(extracted)를 둔다.
// 대상·용어 데이터가 없으면 refs.json을 쓰지 않고, 뽑기 완료 날짜가 없는 달은 extracted를 쓰지 않는다.
// 형식 4(5단계 4.4-1): 일정 데이터를 schedules.json에 따로 두고, 달 파일에 일정 뽑기 완료 날짜(scheduled)를 둔다.
// 일정 데이터가 없으면 schedules.json을 쓰지 않고, 일정 뽑기 완료 날짜가 없는 달은 scheduled를 쓰지 않는다.
// 형식 5(6단계 4.4-1): 지표 값(백업하지 않는 코스피·코스닥 빼고, 지표마다 출처 표시와 함께), 이슈-지표 연결과 판단 여부,
// 합치기마다의 지표 기록을 indicators.json에 둔다. 지표 데이터가 없으면 이 파일을 쓰지 않는다.

export const BACKUP_FORMAT_VERSION = 5;
/**
 * 복원할 수 있는 형식 버전. 형식 1 백업은 이슈 없이, 형식 1·2 백업은 대상·용어 없이 모든 날짜가 뽑기 안 함으로,
 * 형식 1·2·3 백업은 일정 없이 모든 날짜가 일정 뽑기 안 함으로, 형식 1~4 백업은 지표 값 없이 모든 이슈가 지표 판단 안 함으로 복원된다
 */
const READABLE_VERSIONS = [1, 2, 3, 4, 5];
export const BACKUP_DIR = "backup";
export const DATA_REF = "refs/heads/data";
const META_FILE = "meta.json";
const ISSUES_FILE = "issues.json";
const REFS_FILE = "refs.json";
const SCHEDULES_FILE = "schedules.json";
const INDICATORS_FILE = "indicators.json";
const MONTH_RE = /^\d{4}-\d{2}\.json$/;

interface MetaFile {
  formatVersion: number;
  firstCollectionDate: string | null;
  /** 첫 연결 적용일과 마지막 합치기 점검일. 있을 때만 쓴다 */
  firstLinkedOn?: string;
  mergeCheckedOn?: string;
}

interface IssuesFile {
  formatVersion: number;
  issues: { id: number; name: string; aliases: string[]; category: Category; status: IssueStatus; summary: string; mergedInto: number | null }[];
  /** story는 전역 뉴스 키(`날짜/키`) */
  links: { story: string; issue: number; primary: boolean }[];
  relations: [number, number][];
  merges: { id: number; mergedOn: string; survivor: number; absorbed: number; reason: string; record: MergeRecord; undoneOn: string | null }[];
  noMerge: [number, number][];
}

/** 지운 것은 식별자와 지움 표시만 남는다(이름·별칭·설명 없음, E15) */
type RefsEntity = { id: number; deleted: true } | { id: number; kind: EntityKind; name: string; aliases: string[]; description: string; describedOn: string | null; describedStory: string | null; mergedInto: number | null };
type RefsTerm = { id: number; deleted: true } | { id: number; name: string; aliases: string[]; description: string; mergedInto: number | null };

interface RefsFile {
  formatVersion: number;
  entities: RefsEntity[];
  terms: RefsTerm[];
  /** story는 전역 뉴스 키(`날짜/키`) */
  entityLinks: { story: string; entity: number }[];
  termLinks: { story: string; term: number; surface: string | null }[];
  merges: { id: number; item: RefItem; mergedOn: string; survivor: number; absorbed: number; reason: string; record: RefMergeRecord | null; undoneOn: string | null; masked: boolean }[];
  noMerge: { item: RefItem; a: number; b: number }[];
  /** 지운 이름은 비밀 키 해시와 키 지문만(E15) */
  deletedNames: { scope: string; hash: string; keyFp: string; deletedOn: string }[];
}

function isBackupFile(name: string): boolean {
  return name === META_FILE || name === ISSUES_FILE || name === REFS_FILE || name === SCHEDULES_FILE || name === INDICATORS_FILE || MONTH_RE.test(name);
}

function buildRefsFile(db: DatabaseSync): RefsFile {
  const entities: RefsEntity[] = allEntities(db).map((e) =>
    e.deleted
      ? { id: e.id, deleted: true as const }
      : { id: e.id, kind: e.kind, name: e.name, aliases: e.aliases, description: e.description, describedOn: e.describedOn, describedStory: e.describedStory, mergedInto: e.mergedInto },
  );
  const terms: RefsTerm[] = allTerms(db).map((t) =>
    t.deleted ? { id: t.id, deleted: true as const } : { id: t.id, name: t.name, aliases: t.aliases, description: t.description, mergedInto: t.mergedInto },
  );
  const entityLinks: RefsFile["entityLinks"] = [];
  for (const e of allEntities(db)) for (const s of storiesOfRef(db, "entity", e.id)) entityLinks.push({ story: fullKey(s), entity: e.id });
  entityLinks.sort((a, b) => a.story.localeCompare(b.story) || a.entity - b.entity);
  const termLinks: RefsFile["termLinks"] = [];
  for (const t of allTerms(db)) for (const s of storiesOfRef(db, "term", t.id)) termLinks.push({ story: fullKey(s), term: t.id, surface: s.surface });
  termLinks.sort((a, b) => a.story.localeCompare(b.story) || a.term - b.term);
  const noMerge = (db.prepare("SELECT item, a, b FROM ref_no_merge ORDER BY item, a, b").all() as { item: RefItem; a: number; b: number }[]).map((r) => ({ item: r.item, a: r.a, b: r.b }));
  const deletedNames = (db.prepare("SELECT scope, hash, key_fp, deleted_on FROM deleted_names ORDER BY scope, hash, key_fp").all() as {
    scope: string;
    hash: string;
    key_fp: string;
    deleted_on: string;
  }[]).map((r) => ({ scope: r.scope, hash: r.hash, keyFp: r.key_fp, deletedOn: r.deleted_on }));
  return { formatVersion: BACKUP_FORMAT_VERSION, entities, terms, entityLinks, termLinks, merges: listRefMerges(db), noMerge, deletedNames };
}

function restoreRefs(db: DatabaseSync, f: RefsFile): void {
  const insE = db.prepare("INSERT INTO entities (id, kind, name, aliases, description, described_on, described_story, deleted) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const e of f.entities) {
    if ("deleted" in e) insE.run(e.id, "인물", "", "[]", "", null, null, 1);
    else insE.run(e.id, e.kind, e.name, JSON.stringify(e.aliases), e.description, e.describedOn, e.describedStory, 0);
  }
  for (const e of f.entities) if (!("deleted" in e) && e.mergedInto !== null) db.prepare("UPDATE entities SET merged_into = ? WHERE id = ?").run(e.mergedInto, e.id);
  const insT = db.prepare("INSERT INTO terms (id, name, aliases, description, deleted) VALUES (?, ?, ?, ?, ?)");
  for (const t of f.terms) {
    if ("deleted" in t) insT.run(t.id, "", "[]", "", 1);
    else insT.run(t.id, t.name, JSON.stringify(t.aliases), t.description, 0);
  }
  for (const t of f.terms) if (!("deleted" in t) && t.mergedInto !== null) db.prepare("UPDATE terms SET merged_into = ? WHERE id = ?").run(t.mergedInto, t.id);
  const story = (key: string) => {
    const s = storyByFullKey(db, key);
    if (s === null) throw new Error(`${REFS_FILE}의 연결이 가리키는 뉴스 ${key}가 없다`);
    return s.id;
  };
  for (const l of f.entityLinks) db.prepare("INSERT INTO story_entities (story_id, entity_id) VALUES (?, ?)").run(story(l.story), l.entity);
  for (const l of f.termLinks) db.prepare("INSERT INTO story_terms (story_id, term_id, surface) VALUES (?, ?, ?)").run(story(l.story), l.term, l.surface);
  for (const m of f.merges) {
    db.prepare("INSERT INTO ref_merges (id, item, merged_on, survivor, absorbed, reason, record, undone_on, masked) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      m.id, m.item, m.mergedOn, m.survivor, m.absorbed, m.reason, m.record === null ? "{}" : JSON.stringify(m.record), m.undoneOn, m.masked ? 1 : 0);
  }
  for (const p of f.noMerge) db.prepare("INSERT INTO ref_no_merge (item, a, b) VALUES (?, ?, ?)").run(p.item, p.a, p.b);
  for (const d of f.deletedNames) db.prepare("INSERT INTO deleted_names (scope, hash, key_fp, deleted_on) VALUES (?, ?, ?, ?)").run(d.scope, d.hash, d.keyFp, d.deletedOn);
}

/** 지운 일정도 이름·예정일을 남긴다(같은 이름·예정일을 다시 뽑지 않는 기록, C13. 일정은 개인정보가 아니다) */
interface SchedulesFile {
  formatVersion: number;
  schedules: { id: number; name: string; due: string; major: Major; outcome: ScheduleOutcome | null; postponedTo: number | null; mergedInto: number | null; deleted: boolean; deletedOn: string | null }[];
  /** story는 전역 뉴스 키(`날짜/키`) */
  links: { story: string; schedule: number; role: ScheduleRole }[];
  merges: ScheduleMergeRow[];
  noMerge: [number, number][];
}

function buildSchedulesFile(db: DatabaseSync): SchedulesFile {
  const schedules = allSchedules(db);
  const links: SchedulesFile["links"] = [];
  for (const s of schedules) for (const st of storiesOfSchedule(db, s.id)) links.push({ story: fullKey(st), schedule: s.id, role: st.role });
  links.sort((a, b) => a.story.localeCompare(b.story) || a.schedule - b.schedule || a.role.localeCompare(b.role));
  const noMerge = (db.prepare("SELECT a, b FROM schedule_no_merge ORDER BY a, b").all() as { a: number; b: number }[]).map((r): [number, number] => [r.a, r.b]);
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    schedules: schedules.map((s) => ({ id: s.id, name: s.name, due: s.due, major: s.major, outcome: s.outcome, postponedTo: s.postponedTo, mergedInto: s.mergedInto, deleted: s.deleted, deletedOn: s.deletedOn })),
    links,
    merges: listScheduleMerges(db),
    noMerge,
  };
}

function restoreSchedules(db: DatabaseSync, f: SchedulesFile): void {
  const ins = db.prepare("INSERT INTO schedules (id, name, due, major, outcome, deleted, deleted_on) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const s of f.schedules) ins.run(s.id, s.name, s.due, s.major, s.outcome, s.deleted ? 1 : 0, s.deletedOn);
  for (const s of f.schedules) {
    if (s.postponedTo !== null || s.mergedInto !== null) db.prepare("UPDATE schedules SET postponed_to = ?, merged_into = ? WHERE id = ?").run(s.postponedTo, s.mergedInto, s.id);
  }
  for (const l of f.links) {
    const story = storyByFullKey(db, l.story);
    if (story === null) throw new Error(`${SCHEDULES_FILE}의 연결이 가리키는 뉴스 ${l.story}가 없다`);
    db.prepare("INSERT INTO story_schedules (story_id, schedule_id, role) VALUES (?, ?, ?)").run(story.id, l.schedule, l.role);
  }
  for (const m of f.merges) {
    db.prepare("INSERT INTO schedule_merges (id, merged_on, survivor, absorbed, reason, record, undone_on) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      m.id, m.mergedOn, m.survivor, m.absorbed, m.reason, JSON.stringify(m.record), m.undoneOn);
  }
  for (const [a, b] of f.noMerge) db.prepare("INSERT INTO schedule_no_merge (a, b) VALUES (?, ?)").run(a, b);
}

function buildIssuesFile(db: DatabaseSync): IssuesFile {
  const issues = allIssues(db);
  const links: IssuesFile["links"] = [];
  for (const i of issues) for (const d of developments(db, i.id)) links.push({ story: fullKey(d), issue: i.id, primary: d.primary });
  links.sort((a, b) => a.story.localeCompare(b.story) || a.issue - b.issue);
  const pairs = (table: string) => (db.prepare(`SELECT a, b FROM ${table} ORDER BY a, b`).all() as { a: number; b: number }[]).map((r): [number, number] => [r.a, r.b]);
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    issues: issues.map((i) => ({ id: i.id, name: i.name, aliases: i.aliases, category: i.category, status: i.status, summary: i.summary, mergedInto: i.mergedInto })),
    links,
    relations: pairs("issue_relations"),
    merges: listMerges(db),
    noMerge: pairs("no_merge_pairs"),
  };
}

function restoreIssues(db: DatabaseSync, f: IssuesFile): void {
  const insIssue = db.prepare("INSERT INTO issues (id, name, aliases, major, minor, is_new_minor, status, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const i of f.issues) insIssue.run(i.id, i.name, JSON.stringify(i.aliases), i.category.major, i.category.minor, i.category.isNewMinor ? 1 : 0, i.status, i.summary);
  for (const i of f.issues) if (i.mergedInto !== null) db.prepare("UPDATE issues SET merged_into = ? WHERE id = ?").run(i.mergedInto, i.id);
  for (const l of f.links) {
    const story = storyByFullKey(db, l.story);
    if (story === null) throw new Error(`${ISSUES_FILE}의 연결이 가리키는 뉴스 ${l.story}가 없다`);
    db.prepare("INSERT INTO story_issues (story_id, issue_id, is_primary) VALUES (?, ?, ?)").run(story.id, l.issue, l.primary ? 1 : 0);
  }
  for (const [a, b] of f.relations) db.prepare("INSERT INTO issue_relations (a, b) VALUES (?, ?)").run(a, b);
  for (const m of f.merges) {
    db.prepare("INSERT INTO merges (id, merged_on, survivor, absorbed, reason, record, undone_on) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      m.id, m.mergedOn, m.survivor, m.absorbed, m.reason, JSON.stringify(m.record), m.undoneOn);
  }
  for (const [a, b] of f.noMerge) db.prepare("INSERT INTO no_merge_pairs (a, b) VALUES (?, ?)").run(a, b);
}

interface MonthFile {
  formatVersion: number;
  month: string;
  briefs: StoredBrief[];
  /** 그 달에서 뽑기 완료인 날짜(4단계). 없으면 항목을 뺀다 */
  extracted?: string[];
  /** 그 달에서 일정 뽑기 완료인 날짜(5단계). 없으면 항목을 뺀다 */
  scheduled?: string[];
}

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** 백업 파일 이름 → 내용 */
export function buildBackup(db: DatabaseSync): Map<string, string> {
  const files = new Map<string, string>();
  const meta: MetaFile = { formatVersion: BACKUP_FORMAT_VERSION, firstCollectionDate: getFirstCollectionDate(db) };
  const firstLinkedOn = getMeta(db, FIRST_LINKED_KEY);
  const mergeCheckedOn = getMeta(db, MERGE_CHECKED_KEY);
  if (firstLinkedOn !== null) meta.firstLinkedOn = firstLinkedOn;
  if (mergeCheckedOn !== null) meta.mergeCheckedOn = mergeCheckedOn;
  files.set(META_FILE, toJson(meta));
  if (hasIssueData(db)) files.set(ISSUES_FILE, toJson(buildIssuesFile(db)));
  if (hasRefData(db)) files.set(REFS_FILE, toJson(buildRefsFile(db)));
  if (hasScheduleData(db)) files.set(SCHEDULES_FILE, toJson(buildSchedulesFile(db)));
  if (hasIndicatorData(db)) files.set(INDICATORS_FILE, toJson(buildIndicatorsBackup(db, BACKUP_FORMAT_VERSION)));
  const extracted = extractedDates(db);
  const scheduled = scheduledDates(db);
  const byMonth = new Map<string, StoredBrief[]>();
  for (const date of storedDates(db)) {
    const stored = loadBrief(db, date);
    if (stored === null) continue;
    const month = date.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(stored);
    byMonth.set(month, list);
  }
  for (const [month, briefs] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) {
    const file: MonthFile = { formatVersion: BACKUP_FORMAT_VERSION, month, briefs };
    const done = extracted.filter((d) => d.slice(0, 7) === month);
    if (done.length > 0) file.extracted = done;
    const sched = scheduled.filter((d) => d.slice(0, 7) === month);
    if (sched.length > 0) file.scheduled = sched;
    files.set(`${month}.json`, toJson(file));
  }
  return files;
}

/** DB 전체를 내보내기 폴더에 쓴다. 내용이 같은 파일은 다시 쓰지 않고, DB에 없는 달의 파일은 지운다 */
export function exportBackup(db: DatabaseSync, exportDir: string): Map<string, string> {
  const files = buildBackup(db);
  fs.mkdirSync(exportDir, { recursive: true });
  for (const name of fs.readdirSync(exportDir)) {
    if (name.endsWith(".json") && !files.has(name)) fs.rmSync(path.join(exportDir, name));
  }
  for (const [name, content] of files) {
    const file = path.join(exportDir, name);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) continue;
    fs.writeFileSync(file, content);
  }
  return files;
}

export type CommitResult = { committed: true; commit: string } | { committed: false; reason: string };

/**
 * 백업 파일을 data 브랜치에 커밋한다. 작업 트리·HEAD·체크아웃된 브랜치는 건드리지 않는다(임시 인덱스와 git 저수준 명령만 쓴다).
 * data 브랜치의 트리는 백업 파일만으로 새로 만든다(코드 없음, 없는 달 파일은 빠진다). 바뀐 것이 없으면 커밋하지 않는다.
 */
export function commitBackup(files: Map<string, string>, repoDir: string, message: string, indexFile: string): CommitResult {
  fs.mkdirSync(path.dirname(indexFile), { recursive: true });
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    git(repoDir, ["read-tree", "--empty"], { env });
    for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
      const blob = git(repoDir, ["hash-object", "-w", "--stdin", "--no-filters"], { input: content }).trim();
      git(repoDir, ["update-index", "--add", "--cacheinfo", `100644,${blob},${name}`], { env });
    }
    const tree = git(repoDir, ["write-tree"], { env }).trim();
    const parent = gitTry(repoDir, ["rev-parse", "--verify", "--quiet", `${DATA_REF}^{commit}`])?.trim() ?? null;
    if (parent !== null && git(repoDir, ["rev-parse", `${parent}^{tree}`]).trim() === tree) {
      return { committed: false, reason: "바뀐 것이 없다" };
    }
    const commitArgs = ["commit-tree", tree, "-m", message];
    if (parent !== null) commitArgs.push("-p", parent);
    const commit = git(repoDir, commitArgs).trim();
    git(repoDir, ["update-ref", "-m", "tidwyn backup", DATA_REF, commit, parent ?? "0".repeat(40)]);
    return { committed: true, commit };
  } finally {
    fs.rmSync(indexFile, { force: true });
  }
}

export function backupMessage(dates: string[]): string {
  return dates.length > 0 ? `Backup briefs: ${dates.join(", ")}` : "Backup briefs";
}

/** 폴더의 백업 파일을 읽는다 */
export function readBackupDir(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of fs.readdirSync(dir).sort()) {
    if (isBackupFile(name)) files.set(name, fs.readFileSync(path.join(dir, name), "utf8"));
  }
  return files;
}

/** 저장소의 refs/heads/data에서 백업 파일을 바로 읽는다 */
export function readBackupRef(repoDir: string): Map<string, string> {
  if (gitTry(repoDir, ["rev-parse", "--verify", "--quiet", `${DATA_REF}^{commit}`]) === null) {
    throw new Error(`백업 저장소에 data 브랜치가 없다: ${repoDir}`);
  }
  const files = new Map<string, string>();
  const names = git(repoDir, ["ls-tree", "--name-only", DATA_REF]).split("\n").filter((n) => n.length > 0);
  for (const name of names) {
    if (isBackupFile(name)) files.set(name, git(repoDir, ["cat-file", "blob", `${DATA_REF}:${name}`]));
  }
  return files;
}

function checkVersion(name: string, value: { formatVersion?: unknown }): void {
  if (!READABLE_VERSIONS.includes(value.formatVersion as number)) {
    throw new Error(`${name}의 형식 버전 ${String(value.formatVersion)}을(를) 알 수 없다(이 코드는 ${READABLE_VERSIONS.join(", ")}만 읽는다)`);
  }
}

/**
 * 백업 파일로 DB를 새로 만든다. 이미 있는 경로는 force가 없으면 거부한다.
 * 임시 파일에 다 만든 뒤 옮기므로, 도중에 실패해도 기존 DB가 반쯤 바뀌지 않는다.
 */
export function restoreBackup(files: Map<string, string>, outPath: string, force = false): { dates: number } {
  if (fs.existsSync(outPath) && !force) throw new Error(`이미 DB가 있다: ${outPath} (덮어쓰려면 --force)`);
  const metaText = files.get(META_FILE);
  if (metaText === undefined) throw new Error(`백업에 ${META_FILE}이 없다`);
  const meta = JSON.parse(metaText) as MetaFile;
  checkVersion(META_FILE, meta);
  const months: MonthFile[] = [];
  for (const [name, text] of files) {
    if (!MONTH_RE.test(name)) continue;
    const m = JSON.parse(text) as MonthFile;
    checkVersion(name, m);
    months.push(m);
  }
  const issuesText = files.get(ISSUES_FILE);
  const issues = issuesText === undefined ? null : (JSON.parse(issuesText) as IssuesFile);
  if (issues !== null) checkVersion(ISSUES_FILE, issues);
  const refsText = files.get(REFS_FILE);
  const refs = refsText === undefined ? null : (JSON.parse(refsText) as RefsFile);
  if (refs !== null) checkVersion(REFS_FILE, refs);
  const schedulesText = files.get(SCHEDULES_FILE);
  const schedules = schedulesText === undefined ? null : (JSON.parse(schedulesText) as SchedulesFile);
  if (schedules !== null) checkVersion(SCHEDULES_FILE, schedules);
  const indicatorsText = files.get(INDICATORS_FILE);
  const indicators = indicatorsText === undefined ? null : (JSON.parse(indicatorsText) as IndicatorsBackup);
  if (indicators !== null) checkVersion(INDICATORS_FILE, indicators);
  const tmp = `${outPath}.restoring`;
  fs.rmSync(tmp, { force: true });
  const db = openDb(tmp);
  let dates = 0;
  try {
    if (meta.firstCollectionDate !== null) recordFirstCollectionDate(db, meta.firstCollectionDate);
    for (const m of months) {
      for (const stored of m.briefs) {
        saveBrief(db, stored);
        dates++;
      }
    }
    if (meta.firstLinkedOn !== undefined) setMeta(db, FIRST_LINKED_KEY, meta.firstLinkedOn);
    if (meta.mergeCheckedOn !== undefined) setMeta(db, MERGE_CHECKED_KEY, meta.mergeCheckedOn);
    if (issues !== null || refs !== null || schedules !== null || indicators !== null || months.some((m) => m.extracted !== undefined || m.scheduled !== undefined)) {
      db.exec("BEGIN");
      try {
        if (issues !== null) restoreIssues(db, issues);
        if (refs !== null) restoreRefs(db, refs);
        if (schedules !== null) restoreSchedules(db, schedules);
        if (indicators !== null) restoreIndicatorsBackup(db, indicators);
        for (const m of months) for (const d of m.extracted ?? []) markExtracted(db, d);
        for (const m of months) for (const d of m.scheduled ?? []) markScheduled(db, d);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    }
  } catch (e) {
    db.close();
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  db.close();
  fs.renameSync(tmp, outPath);
  return { dates };
}
