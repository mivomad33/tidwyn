import type { DatabaseSync } from "node:sqlite";
import type { Category } from "./brief.ts";
import type { Major, SectionName } from "./categories.ts";

// 이슈 데이터(2단계 4.1). 이슈, 뉴스-이슈 연결, 이슈 관계, 메타 값. 전개 순서와 시작일·최근 업데이트일은 연결에서 계산한다.

export const ISSUE_STATUSES = ["진행 중", "종료"] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];

export const FIRST_LINKED_KEY = "first_linked_on";
export const MERGE_CHECKED_KEY = "merge_checked_on";

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

/** 저장된 뉴스 한 건(주요 뉴스나 짧은 소식) */
export interface StoryRef {
  id: number;
  date: string;
  section: SectionName;
  sectionPos: number;
  kind: "top" | "short";
  position: number;
  /** 날짜 안의 키: 주요 뉴스 `한국-1`, 짧은 소식 `한국-s1` */
  key: string;
  /** 주요 뉴스는 제목, 짧은 소식은 요약 */
  title: string;
  category: Category;
  /** 대표 출처(짧은 소식은 첫 출처)의 링크 */
  source: { name: string; url: string } | null;
}

export function storyKey(section: string, kind: "top" | "short", position: number): string {
  return kind === "top" ? `${section}-${position}` : `${section}-s${position}`;
}

/** 날짜를 붙인 전역 키(백업과 합치기 기록에 쓴다. DB 내부 번호에 기대지 않는다) */
export function fullKey(s: { date: string; key: string }): string {
  return `${s.date}/${s.key}`;
}

/** 전개 순서: 대상일, 섹션 순서, 주요 뉴스 → 짧은 소식, 순위(위치) */
const ORDER = "se.target_date, se.position, CASE st.kind WHEN 'top' THEN 0 ELSE 1 END, st.position";

const STORY_SELECT = `SELECT st.id, se.target_date AS date, se.name AS section, se.position AS section_pos, st.kind, st.position,
  st.title, st.summary, st.major, st.minor, st.is_new_minor,
  (SELECT name FROM sources so WHERE so.story_id = st.id ORDER BY so.is_primary DESC, so.position LIMIT 1) AS source_name,
  (SELECT url FROM sources so WHERE so.story_id = st.id ORDER BY so.is_primary DESC, so.position LIMIT 1) AS source_url
  FROM stories st JOIN sections se ON se.id = st.section_id`;

interface StoryRow {
  id: number;
  date: string;
  section: string;
  section_pos: number;
  kind: "top" | "short";
  position: number;
  title: string | null;
  summary: string;
  major: string;
  minor: string;
  is_new_minor: number;
  source_name: string | null;
  source_url: string | null;
}

function toStory(r: StoryRow): StoryRef {
  const category: Category = { major: r.major as Major, minor: r.minor };
  if (r.is_new_minor === 1) category.isNewMinor = true;
  return {
    id: r.id,
    date: r.date,
    section: r.section as SectionName,
    sectionPos: r.section_pos,
    kind: r.kind,
    position: r.position,
    key: storyKey(r.section, r.kind, r.position),
    title: r.kind === "top" ? (r.title ?? "") : r.summary,
    category,
    source: r.source_name !== null && r.source_url !== null ? { name: r.source_name, url: r.source_url } : null,
  };
}

/** 한 날짜의 뉴스(전개 순서) */
export function storiesOfDate(db: DatabaseSync, date: string): StoryRef[] {
  return (db.prepare(`${STORY_SELECT} WHERE se.target_date = ? ORDER BY ${ORDER}`).all(date) as unknown as StoryRow[]).map(toStory);
}

/** 다른 표와 이어 붙여 고른 뉴스(전개 순서). 4단계 대상·용어 연결이 쓴다 */
export function storiesJoined(db: DatabaseSync, join: string, where: string, ...args: (string | number)[]): StoryRef[] {
  return (db.prepare(`${STORY_SELECT} ${join} WHERE ${where} ORDER BY ${ORDER}`).all(...args) as unknown as StoryRow[]).map(toStory);
}

/** 한 날짜에서 이슈가 없는 뉴스 */
export function unlinkedStories(db: DatabaseSync, date: string): StoryRef[] {
  const sql = `${STORY_SELECT} WHERE se.target_date = ? AND NOT EXISTS (SELECT 1 FROM story_issues si WHERE si.story_id = st.id) ORDER BY ${ORDER}`;
  return (db.prepare(sql).all(date) as unknown as StoryRow[]).map(toStory);
}

/** 이슈가 없는 뉴스가 있는 저장된 날짜(오래된 날부터) */
export function linkableDates(db: DatabaseSync): string[] {
  const sql = `SELECT DISTINCT se.target_date AS d FROM stories st JOIN sections se ON se.id = st.section_id
    WHERE NOT EXISTS (SELECT 1 FROM story_issues si WHERE si.story_id = st.id) ORDER BY d`;
  return (db.prepare(sql).all() as { d: string }[]).map((r) => r.d);
}

/** 이슈가 없는 뉴스 수(전체) */
export function unlinkedCount(db: DatabaseSync): number {
  const sql = "SELECT count(*) AS n FROM stories st WHERE NOT EXISTS (SELECT 1 FROM story_issues si WHERE si.story_id = st.id)";
  return (db.prepare(sql).get() as { n: number }).n;
}

/** 전역 키로 뉴스를 찾는다 */
export function storyByFullKey(db: DatabaseSync, key: string): StoryRef | null {
  const slash = key.indexOf("/");
  if (slash < 0) return null;
  const date = key.slice(0, slash);
  return storiesOfDate(db, date).find((s) => s.key === key.slice(slash + 1)) ?? null;
}

/** DB의 가장 늦은 대상일 */
export function latestStoredDate(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT max(target_date) AS d FROM briefs").get() as { d: string | null };
  return row.d;
}

export interface Issue {
  id: number;
  name: string;
  aliases: string[];
  category: Category;
  status: IssueStatus;
  summary: string;
  mergedInto: number | null;
  /** 연결된 뉴스의 가장 이른·늦은 대상일. 연결이 없으면 null */
  startDate: string | null;
  latestDate: string | null;
  /** 연결된 뉴스 수(전개 수) */
  count: number;
}

interface IssueRow {
  id: number;
  name: string;
  aliases: string;
  major: string;
  minor: string;
  is_new_minor: number;
  status: IssueStatus;
  summary: string;
  merged_into: number | null;
  start_date: string | null;
  latest_date: string | null;
  n: number;
}

const ISSUE_SELECT = `SELECT i.*, d.start_date, d.latest_date, coalesce(d.n, 0) AS n FROM issues i LEFT JOIN (
  SELECT si.issue_id, min(se.target_date) AS start_date, max(se.target_date) AS latest_date, count(*) AS n
  FROM story_issues si JOIN stories st ON st.id = si.story_id JOIN sections se ON se.id = st.section_id GROUP BY si.issue_id
) d ON d.issue_id = i.id`;

function toIssue(r: IssueRow): Issue {
  const category: Category = { major: r.major as Major, minor: r.minor };
  if (r.is_new_minor === 1) category.isNewMinor = true;
  return {
    id: r.id,
    name: r.name,
    aliases: JSON.parse(r.aliases) as string[],
    category,
    status: r.status,
    summary: r.summary,
    mergedInto: r.merged_into,
    startDate: r.start_date,
    latestDate: r.latest_date,
    count: r.n,
  };
}

export function getIssue(db: DatabaseSync, id: number): Issue | null {
  const r = db.prepare(`${ISSUE_SELECT} WHERE i.id = ?`).get(id) as unknown as IssueRow | undefined;
  return r ? toIssue(r) : null;
}

/** 모든 이슈(식별자 순) */
export function allIssues(db: DatabaseSync): Issue[] {
  return (db.prepare(`${ISSUE_SELECT} ORDER BY i.id`).all() as unknown as IssueRow[]).map(toIssue);
}

export function hasIssueData(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM issues UNION ALL SELECT 1 FROM no_merge_pairs LIMIT 1").get() !== undefined;
}

/** 흡수된 이슈면 최종 남는 이슈까지 따라간다 */
export function resolveIssue(db: DatabaseSync, id: number): number {
  const seen = new Set<number>();
  let cur = id;
  for (;;) {
    const row = db.prepare("SELECT merged_into FROM issues WHERE id = ?").get(cur) as { merged_into: number | null } | undefined;
    if (!row || row.merged_into === null || seen.has(cur)) return cur;
    seen.add(cur);
    cur = row.merged_into;
  }
}

export interface NewIssue {
  name: string;
  aliases: string[];
  category: Category;
  summary: string;
  status?: IssueStatus;
}

export function createIssue(db: DatabaseSync, x: NewIssue): number {
  const r = db
    .prepare("INSERT INTO issues (name, aliases, major, minor, is_new_minor, status, summary) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(x.name, JSON.stringify(x.aliases), x.category.major, x.category.minor, x.category.isNewMinor ? 1 : 0, x.status ?? "진행 중", x.summary);
  return Number(r.lastInsertRowid);
}

export function updateIssue(db: DatabaseSync, id: number, change: Partial<Pick<Issue, "name" | "aliases" | "category" | "status" | "summary" | "mergedInto">>): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (change.name !== undefined) set("name", change.name);
  if (change.aliases !== undefined) set("aliases", JSON.stringify(change.aliases));
  if (change.category !== undefined) {
    set("major", change.category.major);
    set("minor", change.category.minor);
    set("is_new_minor", change.category.isNewMinor ? 1 : 0);
  }
  if (change.status !== undefined) set("status", change.status);
  if (change.summary !== undefined) set("summary", change.summary);
  if (change.mergedInto !== undefined) set("merged_into", change.mergedInto);
  if (sets.length === 0) return;
  db.prepare(`UPDATE issues SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
}

/** 뉴스-이슈 연결. 같은 뉴스와 이슈의 연결이 이미 있으면 그대로 둔다 */
export function linkStory(db: DatabaseSync, storyId: number, issueId: number, primary: boolean): void {
  db.prepare("INSERT OR IGNORE INTO story_issues (story_id, issue_id, is_primary) VALUES (?, ?, ?)").run(storyId, issueId, primary ? 1 : 0);
}

export interface Link {
  storyId: number;
  issueId: number;
  primary: boolean;
}

export function linksOfStory(db: DatabaseSync, storyId: number): Link[] {
  return (db.prepare("SELECT issue_id, is_primary FROM story_issues WHERE story_id = ? ORDER BY is_primary DESC, issue_id").all(storyId) as {
    issue_id: number;
    is_primary: number;
  }[]).map((r) => ({ storyId, issueId: r.issue_id, primary: r.is_primary === 1 }));
}

/** 이슈의 전개(전개 순서), 각 뉴스가 이 이슈의 주 이슈 연결인지 포함 */
export function developments(db: DatabaseSync, issueId: number): (StoryRef & { primary: boolean })[] {
  const sql = `${STORY_SELECT.replace("SELECT st.id", "SELECT si.is_primary, st.id")} JOIN story_issues si ON si.story_id = st.id
    WHERE si.issue_id = ? ORDER BY ${ORDER}`;
  return (db.prepare(sql).all(issueId) as unknown as (StoryRow & { is_primary: number })[]).map((r) => ({ ...toStory(r), primary: r.is_primary === 1 }));
}

/** 관계는 (작은 식별자, 큰 식별자)로 하나만 저장한다. 자기 자신과의 관계는 두지 않는다 */
export function addRelation(db: DatabaseSync, x: number, y: number): boolean {
  if (x === y) return false;
  const r = db.prepare("INSERT OR IGNORE INTO issue_relations (a, b) VALUES (?, ?)").run(Math.min(x, y), Math.max(x, y));
  return r.changes > 0;
}

export function removeRelation(db: DatabaseSync, x: number, y: number): void {
  db.prepare("DELETE FROM issue_relations WHERE a = ? AND b = ?").run(Math.min(x, y), Math.max(x, y));
}

/** 이슈와 관계가 있는 이슈들(식별자 순) */
export function relatedIssues(db: DatabaseSync, id: number): number[] {
  const rows = db.prepare("SELECT CASE WHEN a = ? THEN b ELSE a END AS other FROM issue_relations WHERE a = ? OR b = ? ORDER BY other").all(id, id, id) as {
    other: number;
  }[];
  return rows.map((r) => r.other);
}

export function addNoMergePair(db: DatabaseSync, x: number, y: number): void {
  db.prepare("INSERT OR IGNORE INTO no_merge_pairs (a, b) VALUES (?, ?)").run(Math.min(x, y), Math.max(x, y));
}

export function isNoMergePair(db: DatabaseSync, x: number, y: number): boolean {
  return db.prepare("SELECT 1 FROM no_merge_pairs WHERE a = ? AND b = ?").get(Math.min(x, y), Math.max(x, y)) !== undefined;
}

/** 이름·별칭 비교용: 대소문자와 공백을 무시한다 */
export function normalizeName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "");
}

/** 트랜잭션 하나로 실행한다. 예외가 나면 되돌린다 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
