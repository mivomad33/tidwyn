import { createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { storiesJoined, type StoryRef } from "./issues.ts";
import { ENTITY_KINDS, type EntityKind } from "./siteTypes.ts";
import { storedDates } from "./store.ts";

// 4단계 4.1: 대상(인물·기관·국가)과 용어, 뉴스와의 연결, 날짜별 뽑기 완료, 지운 이름.
// 처음·최근 등장일, 뉴스 수, 처음 나온 뉴스는 연결에서 계산한다(이슈와 같다).

export { ENTITY_KINDS, type EntityKind };

/** 대상과 용어를 함께 가리킬 때 쓰는 이름(합치기 기록, "합치지 않음" 쌍) */
export type RefItem = "entity" | "term";

/** 지운 이름 기록의 범위: 대상은 종류, 용어는 "용어"(4.2-3: 같은 범위 안에서만 겹침을 본다) */
export type NameScope = EntityKind | "용어";

export interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  /** 한 줄 설명을 마지막으로 쓴 날(실행 날짜)과 근거 뉴스(전역 뉴스 키 `날짜/키`) */
  describedOn: string | null;
  describedStory: string | null;
  mergedInto: number | null;
  deleted: boolean;
  firstDate: string | null;
  latestDate: string | null;
  count: number;
}

export interface Term {
  id: number;
  name: string;
  aliases: string[];
  description: string;
  mergedInto: number | null;
  deleted: boolean;
  firstDate: string | null;
  latestDate: string | null;
  count: number;
}

const TABLE = { entity: "entities", term: "terms" } as const;
const LINK = { entity: { table: "story_entities", col: "entity_id" }, term: { table: "story_terms", col: "term_id" } } as const;

/**
 * 이름·별칭 겹침 비교용 정규화(4.2-3, E15): 호환 문자를 펴고(NFKC) 소문자로 바꾼 뒤
 * 공백, 가운뎃점류(·・‧•∙ㆍ), 마침표, 하이픈·대시, 밑줄, 따옴표·작은따옴표를 뺀다.
 */
export function normalizeRefName(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s·・‧•∙ㆍ.\-‐‑‒–—_'’‘"“”]/gu, "");
}

const STATS = (item: RefItem) => `LEFT JOIN (
  SELECT l.${LINK[item].col} AS ref_id, min(se.target_date) AS first_date, max(se.target_date) AS latest_date, count(*) AS n
  FROM ${LINK[item].table} l JOIN stories st ON st.id = l.story_id JOIN sections se ON se.id = st.section_id GROUP BY l.${LINK[item].col}
) d ON d.ref_id = x.id`;

interface EntityRow {
  id: number;
  kind: EntityKind;
  name: string;
  aliases: string;
  description: string;
  described_on: string | null;
  described_story: string | null;
  merged_into: number | null;
  deleted: number;
  first_date: string | null;
  latest_date: string | null;
  n: number | null;
}

interface TermRow {
  id: number;
  name: string;
  aliases: string;
  description: string;
  merged_into: number | null;
  deleted: number;
  first_date: string | null;
  latest_date: string | null;
  n: number | null;
}

function toEntity(r: EntityRow): Entity {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    aliases: JSON.parse(r.aliases) as string[],
    description: r.description,
    describedOn: r.described_on,
    describedStory: r.described_story,
    mergedInto: r.merged_into,
    deleted: r.deleted === 1,
    firstDate: r.first_date,
    latestDate: r.latest_date,
    count: r.n ?? 0,
  };
}

function toTerm(r: TermRow): Term {
  return {
    id: r.id,
    name: r.name,
    aliases: JSON.parse(r.aliases) as string[],
    description: r.description,
    mergedInto: r.merged_into,
    deleted: r.deleted === 1,
    firstDate: r.first_date,
    latestDate: r.latest_date,
    count: r.n ?? 0,
  };
}

const ENTITY_SELECT = `SELECT x.*, d.first_date, d.latest_date, d.n FROM entities x ${STATS("entity")}`;
const TERM_SELECT = `SELECT x.*, d.first_date, d.latest_date, d.n FROM terms x ${STATS("term")}`;

export function getEntity(db: DatabaseSync, id: number): Entity | null {
  const r = db.prepare(`${ENTITY_SELECT} WHERE x.id = ?`).get(id) as unknown as EntityRow | undefined;
  return r ? toEntity(r) : null;
}

/** 모든 대상(지운 것·흡수된 것 포함, 식별자 순) */
export function allEntities(db: DatabaseSync): Entity[] {
  return (db.prepare(`${ENTITY_SELECT} ORDER BY x.id`).all() as unknown as EntityRow[]).map(toEntity);
}

export function getTerm(db: DatabaseSync, id: number): Term | null {
  const r = db.prepare(`${TERM_SELECT} WHERE x.id = ?`).get(id) as unknown as TermRow | undefined;
  return r ? toTerm(r) : null;
}

/** 모든 용어(지운 것·흡수된 것 포함, 식별자 순) */
export function allTerms(db: DatabaseSync): Term[] {
  return (db.prepare(`${TERM_SELECT} ORDER BY x.id`).all() as unknown as TermRow[]).map(toTerm);
}

/** 흡수되지도 지워지지도 않은 것 */
export function isLive(x: { mergedInto: number | null; deleted: boolean }): boolean {
  return x.mergedInto === null && !x.deleted;
}

export interface NewEntity {
  kind: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  describedOn: string | null;
  describedStory: string | null;
}

export function createEntity(db: DatabaseSync, x: NewEntity): number {
  const r = db
    .prepare("INSERT INTO entities (kind, name, aliases, description, described_on, described_story) VALUES (?, ?, ?, ?, ?, ?)")
    .run(x.kind, x.name, JSON.stringify(x.aliases), x.description, x.describedOn, x.describedStory);
  return Number(r.lastInsertRowid);
}

export function createTerm(db: DatabaseSync, x: { name: string; aliases: string[]; description: string }): number {
  const r = db.prepare("INSERT INTO terms (name, aliases, description) VALUES (?, ?, ?)").run(x.name, JSON.stringify(x.aliases), x.description);
  return Number(r.lastInsertRowid);
}

type RefChange = Partial<{
  name: string;
  aliases: string[];
  description: string;
  describedOn: string | null;
  describedStory: string | null;
  mergedInto: number | null;
  deleted: boolean;
}>;

/** 대상·용어의 값을 바꾼다. 용어에는 describedOn·describedStory가 없다 */
export function updateRef(db: DatabaseSync, item: RefItem, id: number, change: RefChange): void {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (change.name !== undefined) set("name", change.name);
  if (change.aliases !== undefined) set("aliases", JSON.stringify(change.aliases));
  if (change.description !== undefined) set("description", change.description);
  if (item === "entity" && change.describedOn !== undefined) set("described_on", change.describedOn);
  if (item === "entity" && change.describedStory !== undefined) set("described_story", change.describedStory);
  if (change.mergedInto !== undefined) set("merged_into", change.mergedInto);
  if (change.deleted !== undefined) set("deleted", change.deleted ? 1 : 0);
  if (sets.length === 0) return;
  db.prepare(`UPDATE ${TABLE[item]} SET ${sets.join(", ")} WHERE id = ?`).run(...args, id);
}

/** 이름·별칭·종류·설명(합치기 기록·되돌리기에 쓴다). 없으면 null */
export interface RefState {
  id: number;
  kind?: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  describedOn?: string | null;
  describedStory?: string | null;
}

export function refState(db: DatabaseSync, item: RefItem, id: number): (RefState & { mergedInto: number | null; deleted: boolean }) | null {
  if (item === "entity") {
    const e = getEntity(db, id);
    if (!e) return null;
    return { id, kind: e.kind, name: e.name, aliases: e.aliases, description: e.description, describedOn: e.describedOn, describedStory: e.describedStory, mergedInto: e.mergedInto, deleted: e.deleted };
  }
  const t = getTerm(db, id);
  if (!t) return null;
  return { id, name: t.name, aliases: t.aliases, description: t.description, mergedInto: t.mergedInto, deleted: t.deleted };
}

/** 흡수된 것이면 최종 남는 것까지 따라간다 */
export function resolveRef(db: DatabaseSync, item: RefItem, id: number): number {
  const seen = new Set<number>();
  let cur = id;
  for (;;) {
    const row = db.prepare(`SELECT merged_into FROM ${TABLE[item]} WHERE id = ?`).get(cur) as { merged_into: number | null } | undefined;
    if (!row || row.merged_into === null || seen.has(cur)) return cur;
    seen.add(cur);
    cur = row.merged_into;
  }
}

// ---- 연결 ----

/** 뉴스-대상 연결. 이미 있으면 그대로 둔다 */
export function linkEntity(db: DatabaseSync, storyId: number, entityId: number): boolean {
  return db.prepare("INSERT OR IGNORE INTO story_entities (story_id, entity_id) VALUES (?, ?)").run(storyId, entityId).changes > 0;
}

/** 뉴스-용어 연결(본문 표기 포함, 없으면 null). 이미 있으면 그대로 둔다 */
export function linkTerm(db: DatabaseSync, storyId: number, termId: number, surface: string | null): boolean {
  return db.prepare("INSERT OR IGNORE INTO story_terms (story_id, term_id, surface) VALUES (?, ?, ?)").run(storyId, termId, surface).changes > 0;
}

export function unlinkRef(db: DatabaseSync, item: RefItem, storyId: number, id: number): void {
  db.prepare(`DELETE FROM ${LINK[item].table} WHERE story_id = ? AND ${LINK[item].col} = ?`).run(storyId, id);
}

/** 대상·용어의 모든 연결을 지운다. 지운 수 */
export function unlinkAll(db: DatabaseSync, item: RefItem, id: number): number {
  return Number(db.prepare(`DELETE FROM ${LINK[item].table} WHERE ${LINK[item].col} = ?`).run(id).changes);
}

/** 대상·용어가 나온 뉴스(전개 순서: 오래된 날부터). 용어는 본문 표기도 */
export function storiesOfRef(db: DatabaseSync, item: RefItem, id: number): (StoryRef & { surface: string | null })[] {
  const l = LINK[item];
  const surfaces = new Map<number, string | null>();
  if (item === "term") {
    for (const r of db.prepare("SELECT story_id, surface FROM story_terms WHERE term_id = ?").all(id) as { story_id: number; surface: string | null }[]) {
      surfaces.set(r.story_id, r.surface);
    }
  }
  return storiesJoined(db, `JOIN ${l.table} l ON l.story_id = st.id`, `l.${l.col} = ?`, id).map((s) => ({ ...s, surface: surfaces.get(s.id) ?? null }));
}

/** 뉴스의 대상 식별자(식별자 순) */
export function entitiesOfStory(db: DatabaseSync, storyId: number): number[] {
  return (db.prepare("SELECT entity_id FROM story_entities WHERE story_id = ? ORDER BY entity_id").all(storyId) as { entity_id: number }[]).map((r) => r.entity_id);
}

/** 뉴스의 용어(식별자 순)와 본문 표기 */
export function termsOfStory(db: DatabaseSync, storyId: number): { id: number; surface: string | null }[] {
  return (db.prepare("SELECT term_id, surface FROM story_terms WHERE story_id = ? ORDER BY term_id").all(storyId) as { term_id: number; surface: string | null }[]).map(
    (r) => ({ id: r.term_id, surface: r.surface }),
  );
}

/** 대상·용어 데이터(지운 이름 기록 포함)가 하나라도 있는지. 백업 파일을 낼지 정한다 */
export function hasRefData(db: DatabaseSync): boolean {
  return (
    db.prepare("SELECT 1 FROM entities UNION ALL SELECT 1 FROM terms UNION ALL SELECT 1 FROM deleted_names UNION ALL SELECT 1 FROM ref_merges LIMIT 1").get() !== undefined
  );
}

// ---- 날짜별 뽑기 완료(4.1-3) ----

export function isExtracted(db: DatabaseSync, date: string): boolean {
  return db.prepare("SELECT 1 FROM extracted_dates WHERE target_date = ?").get(date) !== undefined;
}

export function markExtracted(db: DatabaseSync, date: string): void {
  db.prepare("INSERT OR IGNORE INTO extracted_dates (target_date) VALUES (?)").run(date);
}

/** 뽑기 완료인 날짜(오래된 날부터) */
export function extractedDates(db: DatabaseSync): string[] {
  return (db.prepare("SELECT target_date AS d FROM extracted_dates ORDER BY d").all() as { d: string }[]).map((r) => r.d);
}

/** 뽑기 안 한 저장된 날짜(오래된 날부터). 채우기와 실패한 날짜의 재시도 대상(4.2-1) */
export function extractableDates(db: DatabaseSync): string[] {
  const done = new Set(extractedDates(db));
  return storedDates(db).filter((d) => !done.has(d));
}

// ---- 뉴스 본문(4.2-1, E8) ----

export interface StoryText {
  story: StoryRef;
  /** 주요 뉴스는 제목, 짧은 소식은 요약 */
  title: string;
  /** 본문: 주요 뉴스는 한 줄 요약, 왜 중요한가, 배경, 핵심 사실, 비유, 전망 순. 짧은 소식은 요약 하나 */
  body: string[];
}

/** 한 날짜 뉴스의 제목과 본문(전개 순서) */
export function storyTexts(db: DatabaseSync, stories: StoryRef[]): StoryText[] {
  const q = db.prepare("SELECT kind, title, summary, why_it_matters, background, key_facts, analogy, outlook FROM stories WHERE id = ?");
  return stories.map((story) => {
    const r = q.get(story.id) as {
      kind: "top" | "short";
      title: string | null;
      summary: string;
      why_it_matters: string | null;
      background: string | null;
      key_facts: string | null;
      analogy: string | null;
      outlook: string | null;
    };
    if (r.kind === "short") return { story, title: r.summary, body: [r.summary] };
    const body = [r.summary, r.why_it_matters ?? "", r.background ?? "", ...(JSON.parse(r.key_facts ?? "[]") as string[])];
    if (r.analogy !== null) body.push(r.analogy);
    body.push(r.outlook ?? "");
    return { story, title: r.title ?? "", body: body.filter((x) => x !== "") };
  });
}

// ---- 지운 이름(E13, E15) ----

/** 지운 이름의 비밀 키 파일. 데이터 폴더 맨 위에 두고 백업·결과물·저장소에 넣지 않는다 */
export const NAME_KEY_FILE = "deleted-names.key";

export interface NameKey {
  key: Buffer;
  /** 키 지문: 해시마다 함께 남겨 지금 키로 만든 기록인지 가린다 */
  fp: string;
}

function fingerprint(key: Buffer): string {
  return createHash("sha256").update("tidwyn-deleted-names-fp\0").update(key).digest("hex").slice(0, 16);
}

export function nameKeyPath(dataDir: string): string {
  return path.join(dataDir, NAME_KEY_FILE);
}

/** 키 파일을 읽는다. 없거나 깨졌으면 null */
export function readNameKey(dataDir: string): NameKey | null {
  const file = nameKeyPath(dataDir);
  if (!fs.existsSync(file)) return null;
  const hex = fs.readFileSync(file, "utf8").trim();
  if (!/^[0-9a-f]{64}$/.test(hex)) return null;
  const key = Buffer.from(hex, "hex");
  return { key, fp: fingerprint(key) };
}

/** 키 파일이 없으면 새로 만든다(처음 지울 때). 내용은 출력하지 않는다 */
export function ensureNameKey(dataDir: string): NameKey {
  const have = readNameKey(dataDir);
  if (have) return have;
  fs.mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  fs.writeFileSync(nameKeyPath(dataDir), key.toString("hex") + "\n", { mode: 0o600 });
  return { key, fp: fingerprint(key) };
}

export function nameHash(key: NameKey, scope: NameScope, name: string): string {
  return createHmac("sha256", key.key).update(`${scope}\0${normalizeRefName(name)}`).digest("hex");
}

export function addDeletedName(db: DatabaseSync, key: NameKey, scope: NameScope, name: string, today: string): void {
  if (normalizeRefName(name) === "") return;
  db.prepare("INSERT OR IGNORE INTO deleted_names (scope, hash, key_fp, deleted_on) VALUES (?, ?, ?, ?)").run(scope, nameHash(key, scope, name), key.fp, today);
}

/** 이 이름이 지운 이름(같은 범위)과 같은지. 키가 없으면 비교할 수 없어 false */
export function isDeletedName(db: DatabaseSync, key: NameKey | null, scope: NameScope, name: string): boolean {
  if (key === null) return false;
  return db.prepare("SELECT 1 FROM deleted_names WHERE scope = ? AND hash = ? AND key_fp = ?").get(scope, nameHash(key, scope, name), key.fp) !== undefined;
}

/** 어느 범위에서든 지운 이름과 같은지(검색 명령의 "지운 이름과 같음") */
export function deletedNameScopes(db: DatabaseSync, key: NameKey | null, name: string): NameScope[] {
  if (key === null) return [];
  const scopes: NameScope[] = [...ENTITY_KINDS, "용어"];
  return scopes.filter((s) => isDeletedName(db, key, s, name));
}

/** 지금 키로 막지 못하는 지운 이름 기록 수(키가 없거나 다른 키로 만든 기록, E15) */
export function unblockedDeletedNames(db: DatabaseSync, key: NameKey | null): number {
  if (key === null) return (db.prepare("SELECT count(*) AS n FROM deleted_names").get() as { n: number }).n;
  return (db.prepare("SELECT count(*) AS n FROM deleted_names WHERE key_fp <> ?").get(key.fp) as { n: number }).n;
}

/** start 출력과 실행 요약의 경고 줄. 막지 못하는 기록이 없으면 null */
export function deletedNameWarning(db: DatabaseSync, key: NameKey | null): string | null {
  const n = unblockedDeletedNames(db, key);
  if (n === 0) return null;
  const why = key === null ? "지운 이름 키 파일이 없다" : "지금 키와 다른 키로 만든 기록이 있다";
  return `지운 이름 일부를 막지 못한다: 지운 이름 기록 ${n}개를 지금 키로 비교할 수 없다(${why}). 같은 이름이 다시 뽑히면 지우기 명령으로 다시 지운다`;
}
