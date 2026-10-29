import type { DatabaseSync } from "node:sqlite";
import { fullKey, getIssue, inTransaction, linksOfStory, resolveIssue, storiesOfDate, type StoryRef } from "./issues.ts";
import {
  ENTITY_KINDS,
  allEntities,
  allTerms,
  createEntity,
  createTerm,
  deletedNameScopes,
  entitiesOfStory,
  getEntity,
  getTerm,
  isDeletedName,
  isExtracted,
  isLive,
  linkEntity,
  linkTerm,
  markExtracted,
  normalizeRefName,
  resolveRef,
  storiesOfRef,
  storyTexts,
  termsOfStory,
  updateRef,
  type Entity,
  type EntityKind,
  type NameKey,
  type NameScope,
  type RefItem,
  type StoryText,
  type Term,
} from "./refs.ts";
import { Checker, checkQuotes, type Violation } from "./validate.ts";

// 뽑기 단계(4단계 4.2): 후보 목록, 검색, 뽑기 파일 검사와 적용.

/** 뉴스 한 건에 뽑는 대상·용어 수 상한(E1, E3, E11) */
export const LIMITS = { top: { entities: 6, terms: 3 }, short: { entities: 3, terms: 0 } } as const;
export const ENTITY_DESCRIPTION_MAX = 60;
export const TERM_DESCRIPTION_MAX = 250;
export const TERM_DESCRIPTION_SENTENCES = 3;
/** 후보 목록에서 이슈마다 넣는 대상 수 상한(많이 나온 순) */
export const ISSUE_CANDIDATE_LIMIT = 15;
export const REF_SEARCH_LIMIT = 30;
/** 이름이 본문에 나오는지 볼 때 이보다 짧은 이름(정규화 뒤 글자 수)은 보지 않는다 */
const MIN_MATCH_CHARS = 2;

/** 문장 수: 문장 끝 부호(. ! ? 。) 뒤가 공백이거나 글 끝인 것의 수. "3.5%"의 점은 세지 않는다 */
export function sentenceCount(text: string): number {
  return [...text.trim().matchAll(/[.!?。](?=\s|$)/g)].length;
}

function charCount(text: string): number {
  return [...text].length;
}

/** 한 줄 설명 규칙(4.2-3): 비어 있지 않고, 한 문장(문장 끝 부호 하나 이하), 60자 이하 */
export function checkEntityDescription(c: Checker, v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    c.add(where, "한 줄 설명이 비어 있으면 안 된다");
    return "";
  }
  if (sentenceCount(v) > 1) c.add(where, `한 줄 설명은 한 문장이어야 한다(문장 끝 부호가 ${sentenceCount(v)}개다)`);
  if (charCount(v) > ENTITY_DESCRIPTION_MAX) c.add(where, `한 줄 설명이 ${charCount(v)}자다(${ENTITY_DESCRIPTION_MAX}자 이하여야 한다)`);
  checkQuotes(c, v, where);
  return v;
}

/** 용어 설명 규칙(4.2-3): 비어 있지 않고, 세 문장 이하, 250자 이하 */
export function checkTermDescription(c: Checker, v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    c.add(where, "용어 설명이 비어 있으면 안 된다");
    return "";
  }
  const n = sentenceCount(v);
  if (n > TERM_DESCRIPTION_SENTENCES) c.add(where, `용어 설명이 ${n}문장이다(${TERM_DESCRIPTION_SENTENCES}문장 이하여야 한다)`);
  if (charCount(v) > TERM_DESCRIPTION_MAX) c.add(where, `용어 설명이 ${charCount(v)}자다(${TERM_DESCRIPTION_MAX}자 이하여야 한다)`);
  checkQuotes(c, v, where);
  return v;
}

// ---- 후보 목록과 검색(4.2-2) ----

function kindText(item: RefItem, x: Entity | Term): string {
  return item === "entity" ? (x as Entity).kind : "용어";
}

function head(text: string, n: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return charCount(one) > n ? `${[...one].slice(0, n).join("")}…` : one;
}

function describeRef(item: RefItem, x: Entity | Term): string {
  const tag = item === "entity" ? `대상 ${x.id}` : `용어 ${x.id}`;
  const desc = item === "entity" ? x.description : head(x.description, 60);
  return `- ${tag} · ${kindText(item, x)} · ${x.name} · 별칭: ${x.aliases.length > 0 ? x.aliases.join(", ") : "없음"} · 최근 ${x.latestDate ?? "-"} · ${desc}`;
}

function namesOf(x: { name: string; aliases: string[] }): string[] {
  return [x.name, ...x.aliases].map(normalizeRefName).filter((n) => n.length >= MIN_MATCH_CHARS);
}

/** 그날 뉴스 글(제목과 본문)에 이름·별칭이 나오는 것 */
function mentioned<T extends { name: string; aliases: string[] }>(list: T[], text: string): T[] {
  return list.filter((x) => namesOf(x).some((n) => text.includes(n)));
}

/** 그날 뉴스의 주 이슈들에 이미 연결된 대상(이슈마다 많이 나온 순 최대 ISSUE_CANDIDATE_LIMIT개) */
function issueEntities(db: DatabaseSync, stories: StoryRef[]): number[] {
  const issues = new Set<number>();
  for (const s of stories) {
    const p = linksOfStory(db, s.id).find((l) => l.primary);
    if (p) issues.add(resolveIssue(db, p.issueId));
  }
  const out = new Set<number>();
  for (const issue of issues) {
    const rows = db
      .prepare(
        `SELECT se.entity_id AS id, count(*) AS n FROM story_entities se JOIN story_issues si ON si.story_id = se.story_id
         WHERE si.issue_id = ? GROUP BY se.entity_id ORDER BY n DESC, id LIMIT ?`,
      )
      .all(issue, ISSUE_CANDIDATE_LIMIT) as { id: number }[];
    for (const r of rows) out.add(resolveRef(db, "entity", r.id));
  }
  return [...out];
}

export interface RefCandidates {
  stories: StoryText[];
  entities: Entity[];
  terms: Term[];
}

/** 그날 뉴스와 후보 대상·용어. 목록은 그날 뉴스에 관계된 것만이라 전체 수에 비례해 커지지 않는다 */
export function refCandidates(db: DatabaseSync, date: string): RefCandidates {
  const stories = storyTexts(db, storiesOfDate(db, date));
  const text = normalizeRefName(stories.map((s) => [s.title, ...s.body].join("\n")).join("\n"));
  const liveEntities = allEntities(db).filter(isLive);
  const byId = new Map(liveEntities.map((e) => [e.id, e]));
  const picked = new Map<number, Entity>();
  for (const e of mentioned(liveEntities, text)) picked.set(e.id, e);
  for (const id of issueEntities(db, stories.map((s) => s.story))) {
    const e = byId.get(id);
    if (e) picked.set(id, e);
  }
  const entities = [...picked.values()].sort((a, b) => a.id - b.id);
  const terms = mentioned(allTerms(db).filter(isLive), text).sort((a, b) => a.id - b.id);
  return { stories, entities, terms };
}

/** work/<날짜>.refs.md 내용 */
export function renderRefWork(db: DatabaseSync, date: string): { text: string; stories: number; entities: number; terms: number } {
  const { stories, entities, terms } = refCandidates(db, date);
  const lines = [`# ${date} 뽑기 작업`, "", `## 뉴스 (${stories.length}건)`, ""];
  for (const s of stories) {
    const p = linksOfStory(db, s.story.id).find((l) => l.primary);
    const issue = p ? getIssue(db, resolveIssue(db, p.issueId))?.name ?? "" : "";
    lines.push(`### \`${s.story.key}\` · ${s.story.section} · ${s.story.kind === "top" ? "주요 뉴스" : "짧은 소식"} · 주 이슈: ${issue || "없음"}`, "");
    if (s.story.kind === "top") lines.push(`- 제목: ${s.title}`);
    for (const b of s.body) lines.push(`- ${b.replace(/\n+/g, " ")}`);
    lines.push("");
  }
  lines.push(
    `## 후보 인물·기관·국가 (${entities.length}개)`,
    "",
    "그날 뉴스 글에 이름·별칭이 나오는 기존 대상과, 그날 뉴스의 주 이슈에 이미 연결된 대상이다. 여기 없는 대상은 ref-search 명령으로 찾는다.",
    "",
    ...entities.map((e) => describeRef("entity", e)),
    "",
    `## 후보 용어 (${terms.length}개)`,
    "",
    "그날 뉴스 글에 이름·별칭이 나오는 기존 용어다. 여기 없는 용어는 ref-search 명령으로 찾는다.",
    "",
    ...terms.map((t) => describeRef("term", t)),
  );
  return { text: lines.join("\n").trimEnd() + "\n", stories: stories.length, entities: entities.length, terms: terms.length };
}

/** 낱말로 이름·별칭·설명을 찾는다(흡수·지운 것 제외). 맞는 낱말이 많은 순 */
export function searchRefs(db: DatabaseSync, query: string): { entities: Entity[]; terms: Term[] } {
  const words = query.split(/\s+/).map(normalizeRefName).filter((w) => w.length > 0);
  const score = (x: Entity | Term): number => {
    const names = [x.name, ...x.aliases].map(normalizeRefName);
    const desc = normalizeRefName(x.description);
    let n = 0;
    for (const w of words) {
      if (names.some((m) => m.includes(w))) n += 2;
      else if (desc.includes(w)) n += 1;
    }
    return n;
  };
  const rank = <T extends Entity | Term>(list: T[]): T[] =>
    list
      .filter(isLive)
      .map((x) => ({ x, n: score(x) }))
      .filter((s) => s.n > 0)
      .sort((a, b) => b.n - a.n || (b.x.latestDate ?? "").localeCompare(a.x.latestDate ?? "") || a.x.id - b.x.id)
      .slice(0, REF_SEARCH_LIMIT)
      .map((s) => s.x);
  if (words.length === 0) return { entities: [], terms: [] };
  return { entities: rank(allEntities(db)), terms: rank(allTerms(db)) };
}

export function renderRefSearch(db: DatabaseSync, query: string, key: NameKey | null): string {
  const found = searchRefs(db, query);
  const lines: string[] = [];
  const deleted = new Set<NameScope>(deletedNameScopes(db, key, query));
  for (const w of query.split(/\s+/).filter((x) => x !== "")) for (const s of deletedNameScopes(db, key, w)) deleted.add(s);
  if (deleted.size > 0) lines.push(`지운 이름과 같음: "${query}"(${[...deleted].join(", ")}). 이 이름으로 새로 뽑으면 검사에서 거부된다.`, "");
  if (found.entities.length === 0 && found.terms.length === 0) lines.push(`"${query}"에 맞는 인물·기관·국가와 용어가 없다.`);
  else {
    lines.push(`"${query}" 검색 결과: 인물·기관·국가 ${found.entities.length}개, 용어 ${found.terms.length}개`, "");
    lines.push(...found.entities.map((e) => describeRef("entity", e)), ...found.terms.map((t) => describeRef("term", t)));
  }
  return lines.join("\n").trimEnd();
}

// ---- 뽑기 파일(4.2-3) ----

/** 기존 대상·용어는 식별자(숫자), 같은 파일의 새 것은 키(글)로 가리킨다 */
export type RefValue = number | string;

export interface RefPlan {
  date: string;
  newEntities: { key: string; kind: EntityKind; name: string; aliases: string[]; description: string }[];
  newTerms: { key: string; name: string; aliases: string[]; description: string }[];
  stories: { story: StoryRef; entities: RefValue[]; terms: { term: RefValue; surface: string | null }[] }[];
  entityUpdates: { entity: number; story: StoryRef; description?: string; name?: string; aliases: string[] }[];
  termUpdates: { term: number; story: StoryRef; aliases: string[] }[];
}

export type RefCheck = { ok: true; plan: RefPlan } | { ok: false; violations: Violation[] };

function storyDate(full: string | null): string | null {
  return full === null ? null : full.slice(0, full.indexOf("/"));
}

/** 이름 목록 읽기: 비어 있지 않은 글의 목록 */
function nameList(c: Checker, o: Record<string, unknown>, key: string, label: string, where: string): string[] {
  if (o[key] === undefined) return [];
  const out: string[] = [];
  c.arr(o, key, label, where).forEach((a, i) => {
    if (typeof a !== "string" || a.trim() === "") c.add(`${where} ${label} ${i + 1}`, "비어 있지 않은 글이어야 한다");
    else out.push(a);
  });
  return out;
}

/**
 * 이름·별칭 겹침 검사기(4.2-3): 같은 범위(대상은 같은 종류, 용어는 용어끼리)의 기존 것, 같은 파일의 새 것, 지운 이름과 비교한다.
 * owner는 그 이름의 주인(기존 식별자나 새 키)이고, 자기 자신과의 겹침은 보지 않는다.
 */
class NameGuard {
  private existing = new Map<string, Map<string, { id: number; name: string }>>();
  private fresh = new Map<string, Map<string, RefValue>>();
  private db: DatabaseSync;
  private key: NameKey | null;
  constructor(db: DatabaseSync, key: NameKey | null, entities: Entity[], terms: Term[]) {
    this.db = db;
    this.key = key;
    for (const e of entities) for (const n of [e.name, ...e.aliases]) this.put(this.existing, e.kind, n, { id: e.id, name: e.name });
    for (const t of terms) for (const n of [t.name, ...t.aliases]) this.put(this.existing, "용어", n, { id: t.id, name: t.name });
  }
  private put<V>(m: Map<string, Map<string, V>>, scope: string, name: string, v: V): void {
    let s = m.get(scope);
    if (!s) m.set(scope, (s = new Map()));
    const k = normalizeRefName(name);
    if (k !== "" && !s.has(k)) s.set(k, v);
  }
  check(c: Checker, scope: NameScope, names: string[], owner: RefValue, where: string): void {
    const label = scope === "용어" ? "용어" : "대상";
    for (const n of names) {
      const k = normalizeRefName(n);
      if (k === "") {
        c.add(`${where} "${n}"`, "이름·별칭이 비어 있다");
        continue;
      }
      const hit = this.existing.get(scope)?.get(k);
      if (hit && hit.id !== owner) c.add(`${where} "${n}"`, `기존 ${label} ${hit.id}(${hit.name})의 이름·별칭과 같다. 새로 만들지 말고 ${label} ${hit.id}을(를) 쓴다`);
      const other = this.fresh.get(scope)?.get(k);
      if (other !== undefined && other !== owner) c.add(`${where} "${n}"`, `같은 파일의 새 ${label} "${String(other)}"의 이름·별칭과 같다`);
      if (isDeletedName(this.db, this.key, scope, n)) c.add(`${where} "${n}"`, `지운 이름과 같다(${scope}). 지운 ${label}은(는) 다시 뽑지 않는다`);
    }
    for (const n of names) this.put(this.fresh, scope, n, owner);
  }
}

/** 뽑기 파일을 검사한다(4.2-3). 위반마다 위치와 이유 */
export function checkRefFile(db: DatabaseSync, data: unknown, date: string, key: NameKey | null): RefCheck {
  const c = new Checker();
  const root = c.obj(data, "뽑기 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["date", "newEntities", "newTerms", "stories", "entityUpdates", "termUpdates"], "뽑기 파일");
  if (root.date !== date) c.add("뽑기 파일 date", `대상일 ${date}와 같아야 한다(지금: ${String(root.date)})`);

  const entities = allEntities(db);
  const terms = allTerms(db);
  const guard = new NameGuard(db, key, entities.filter(isLive), terms.filter(isLive));
  const plan: RefPlan = { date, newEntities: [], newTerms: [], stories: [], entityUpdates: [], termUpdates: [] };

  const newEntityKeys = new Set<string>();
  c.arr(root, "newEntities", "newEntities", "뽑기 파일").forEach((raw, idx) => {
    const w = `newEntities ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["key", "kind", "name", "aliases", "description"], w);
    const k = c.text(o, "key", "key", w);
    if (k !== "" && newEntityKeys.has(k)) c.add(`${w} key`, `"${k}"가 두 번 나온다`);
    if (k !== "") newEntityKeys.add(k);
    const kind = o.kind;
    const kindOk = typeof kind === "string" && (ENTITY_KINDS as readonly string[]).includes(kind);
    if (!kindOk) c.add(`${w} 종류`, `"${String(kind)}"은(는) 종류(인물, 기관, 국가)가 아니다(도시·해협 같은 장소는 뽑지 않는다)`);
    const name = c.text(o, "name", "이름", w);
    const aliases = nameList(c, o, "aliases", "별칭", w);
    const description = checkEntityDescription(c, o.description, `${w} 한 줄 설명`);
    if (kindOk) guard.check(c, kind as EntityKind, [name, ...aliases].filter((n) => n !== ""), k, `${w} 이름·별칭`);
    plan.newEntities.push({ key: k, kind: (kindOk ? kind : "인물") as EntityKind, name, aliases, description });
  });

  const newTermKeys = new Set<string>();
  c.arr(root, "newTerms", "newTerms", "뽑기 파일").forEach((raw, idx) => {
    const w = `newTerms ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["key", "name", "aliases", "description"], w);
    const k = c.text(o, "key", "key", w);
    if (k !== "" && (newTermKeys.has(k) || newEntityKeys.has(k))) c.add(`${w} key`, `"${k}"가 두 번 나온다`);
    if (k !== "") newTermKeys.add(k);
    const name = c.text(o, "name", "이름", w);
    const aliases = nameList(c, o, "aliases", "별칭", w);
    const description = checkTermDescription(c, o.description, `${w} 설명`);
    guard.check(c, "용어", [name, ...aliases].filter((n) => n !== ""), k, `${w} 이름·별칭`);
    plan.newTerms.push({ key: k, name, aliases, description });
  });

  const entityById = new Map(entities.map((e) => [e.id, e]));
  const termById = new Map(terms.map((t) => [t.id, t]));
  const checkExisting = (item: RefItem, v: number, where: string): boolean => {
    const x = item === "entity" ? entityById.get(v) : termById.get(v);
    const label = item === "entity" ? "대상" : "용어";
    if (!x) c.add(where, `${label} ${v}이(가) 없다`);
    else if (x.deleted) c.add(where, `${label} ${v}은(는) 지운 ${label}이다`);
    else if (x.mergedInto !== null) {
      const to = resolveRef(db, item, v);
      const toName = (item === "entity" ? entityById.get(to) : termById.get(to))?.name ?? "";
      c.add(where, `${label} ${v}은(는) ${label} ${to}(${toName})에 흡수되었다. ${to}을(를) 쓴다`);
    } else return true;
    return false;
  };
  const checkRef = (item: RefItem, v: unknown, where: string): RefValue | null => {
    if (typeof v === "number" && Number.isInteger(v)) return checkExisting(item, v, where) ? v : null;
    const keys = item === "entity" ? newEntityKeys : newTermKeys;
    if (typeof v === "string" && v !== "") {
      if (keys.has(v)) return v;
      c.add(where, `새 ${item === "entity" ? "대상" : "용어"} 키 "${v}"가 ${item === "entity" ? "newEntities" : "newTerms"}에 없다`);
      return null;
    }
    c.add(where, "기존 식별자(숫자)나 새 키(글)여야 한다");
    return null;
  };

  // 뉴스별 대상·용어
  const texts = new Map(storyTexts(db, storiesOfDate(db, date)).map((s) => [s.story.key, s]));
  const seen = new Set<string>();
  const usedKeys = new Set<string>();
  /** 이 파일에서 뉴스에 붙는 기존 대상·용어(뉴스 키별) */
  const linkedInFile = { entity: new Map<string, Set<number>>(), term: new Map<string, Set<number>>() };
  c.arr(root, "stories", "stories", "뽑기 파일").forEach((raw, idx) => {
    const w0 = `stories ${idx + 1}`;
    const o = c.obj(raw, w0);
    if (o === null) return;
    c.keys(o, ["story", "entities", "terms"], w0);
    const sk = typeof o.story === "string" ? o.story : "";
    const w = sk !== "" ? `stories ${idx + 1} (${sk})` : w0;
    const text = texts.get(sk);
    if (sk === "") c.add(`${w} story`, "뉴스 키가 필요하다");
    else if (seen.has(sk)) c.add(`${w} story`, `뉴스 ${sk}가 두 번 나온다`);
    else if (!text) c.add(`${w} story`, `${date}에 뉴스 ${sk}가 없다`);
    if (sk !== "") seen.add(sk);
    const kind = text?.story.kind ?? "top";
    const ents: RefValue[] = [];
    c.arr(o, "entities", "entities", w).forEach((e, i) => {
      const r = checkRef("entity", e, `${w} entities ${i + 1}`);
      if (r === null) return;
      if (ents.includes(r)) c.add(`${w} entities ${i + 1}`, `같은 대상(${String(r)})이 두 번 나온다`);
      else ents.push(r);
    });
    const ts: { term: RefValue; surface: string | null }[] = [];
    c.arr(o, "terms", "terms", w).forEach((t, i) => {
      const wt = `${w} terms ${i + 1}`;
      const to = c.obj(t, wt);
      if (to === null) return;
      c.keys(to, ["term", "surface"], wt);
      const r = checkRef("term", to.term, `${wt} term`);
      let surface: string | null = null;
      if (to.surface !== undefined && to.surface !== null && to.surface !== "") {
        if (typeof to.surface !== "string") c.add(`${wt} surface`, "글이어야 한다(본문에 표기가 없으면 빼거나 null)");
        else {
          surface = to.surface;
          if (text && !text.body.some((b) => b.includes(surface!))) c.add(`${wt} surface`, `본문 표기 "${surface}"가 그 뉴스 본문에 글자 그대로 나오지 않는다(제목은 본문이 아니다)`);
        }
      }
      if (r === null) return;
      if (ts.some((x) => x.term === r)) c.add(wt, `같은 용어(${String(r)})가 두 번 나온다`);
      else ts.push({ term: r, surface });
    });
    const lim = LIMITS[kind];
    if (ents.length > lim.entities) c.add(`${w} entities`, `${kind === "top" ? "주요 뉴스" : "짧은 소식"}의 대상이 ${ents.length}개다(${lim.entities}개 이하여야 한다)`);
    if (ts.length > lim.terms) c.add(`${w} terms`, kind === "top" ? `주요 뉴스의 용어가 ${ts.length}개다(${lim.terms}개 이하여야 한다)` : "짧은 소식에서는 용어를 뽑지 않는다");
    for (const r of [...ents, ...ts.map((x) => x.term)]) if (typeof r === "string") usedKeys.add(r);
    if (text) {
      linkedInFile.entity.set(sk, new Set(ents.filter((r): r is number => typeof r === "number")));
      linkedInFile.term.set(sk, new Set(ts.map((x) => x.term).filter((r): r is number => typeof r === "number")));
      plan.stories.push({ story: text.story, entities: ents, terms: ts });
    }
  });
  for (const k of texts.keys()) if (!seen.has(k)) c.add("stories", `뉴스 ${k}가 빠졌다(뽑은 것이 없으면 빈 목록으로 적는다)`);
  for (const n of [...plan.newEntities, ...plan.newTerms]) if (n.key !== "" && !usedKeys.has(n.key)) c.add(`"${n.key}"`, "어느 뉴스에도 연결되지 않았다");

  // 고침(E4)
  const evidence = (item: RefItem, id: number, v: unknown, where: string): StoryRef | null => {
    const sk = typeof v === "string" ? v : "";
    const text = texts.get(sk);
    if (!text) {
      c.add(`${where} story`, sk === "" ? "근거 뉴스 키가 필요하다" : `근거 뉴스 ${sk}가 ${date}의 뉴스가 아니다`);
      return null;
    }
    const inDb = item === "entity" ? entitiesOfStory(db, text.story.id).includes(id) : termsOfStory(db, text.story.id).some((t) => t.id === id);
    if (!linkedInFile[item].get(sk)?.has(id) && !inDb) c.add(`${where} story`, `${item === "entity" ? "대상" : "용어"} ${id}이(가) 근거 뉴스 ${sk}에 연결되지 않았다`);
    return text.story;
  };
  const updatedEntities = new Set<number>();
  const euRaw = root.entityUpdates === undefined ? [] : c.arr(root, "entityUpdates", "entityUpdates", "뽑기 파일");
  euRaw.forEach((raw, idx) => {
    const w = `entityUpdates ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["entity", "story", "description", "name", "aliases"], w);
    if (typeof o.entity !== "number" || !Number.isInteger(o.entity)) {
      c.add(`${w} entity`, "기존 대상 식별자(숫자)여야 한다. 새 대상의 값은 newEntities에 쓴다");
      return;
    }
    const id = o.entity;
    if (!checkExisting("entity", id, `${w} entity`)) return;
    if (updatedEntities.has(id)) c.add(`${w} entity`, `대상 ${id}의 고침이 두 번 나온다`);
    updatedEntities.add(id);
    const e = entityById.get(id)!;
    const story = evidence("entity", id, o.story, w);
    const u: RefPlan["entityUpdates"][number] = { entity: id, story: story ?? ({} as StoryRef), aliases: nameList(c, o, "aliases", "더할 별칭", w) };
    if (o.description !== undefined) u.description = checkEntityDescription(c, o.description, `${w} 한 줄 설명`);
    if (o.name !== undefined) u.name = c.text(o, "name", "새 이름", w);
    if (u.description === undefined && u.name === undefined && u.aliases.length === 0) c.add(w, "고칠 것(description, name, aliases)이 없다");
    if (story && (u.description !== undefined || u.name !== undefined)) {
      const last = storyDate(e.describedStory);
      if (last !== null && story.date < last) c.add(`${w} story`, `근거 뉴스(${story.date})가 대상 ${id}의 한 줄 설명을 마지막으로 고친 근거 뉴스(${last})보다 이르다. 옛 직함으로 돌아가지 않게 고치지 않는다`);
    }
    const added = [...(u.name !== undefined && u.name !== "" ? [u.name] : []), ...u.aliases];
    guard.check(c, e.kind, added, id, `${w} 새 이름·별칭`);
    if (story) plan.entityUpdates.push(u);
  });
  const updatedTerms = new Set<number>();
  const tuRaw = root.termUpdates === undefined ? [] : c.arr(root, "termUpdates", "termUpdates", "뽑기 파일");
  tuRaw.forEach((raw, idx) => {
    const w = `termUpdates ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["term", "story", "aliases"], w);
    if (typeof o.term !== "number" || !Number.isInteger(o.term)) {
      c.add(`${w} term`, "기존 용어 식별자(숫자)여야 한다. 새 용어의 값은 newTerms에 쓴다");
      return;
    }
    const id = o.term;
    if (!checkExisting("term", id, `${w} term`)) return;
    if (updatedTerms.has(id)) c.add(`${w} term`, `용어 ${id}의 고침이 두 번 나온다`);
    updatedTerms.add(id);
    const story = evidence("term", id, o.story, w);
    const aliases = nameList(c, o, "aliases", "더할 별칭", w);
    if (aliases.length === 0) c.add(w, "더할 별칭이 없다");
    guard.check(c, "용어", aliases, id, `${w} 더할 별칭`);
    if (story) plan.termUpdates.push({ term: id, story, aliases });
  });

  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, plan };
}

export type RefApplied =
  | { status: "applied"; entityLinks: number; termLinks: number; newEntities: number; newTerms: number; descriptions: number }
  | { status: "nothing" };

/** 별칭에 더한다(이름과 이미 있는 별칭은 빼고, 정규화로 비교) */
function withAliases(name: string, aliases: string[], add: string[]): string[] {
  const known = new Set([name, ...aliases].map(normalizeRefName));
  const out = [...aliases];
  for (const a of add) {
    const k = normalizeRefName(a);
    if (known.has(k)) continue;
    known.add(k);
    out.push(a);
  }
  return out;
}

/**
 * 검사를 통과한 뽑기 계획을 한 트랜잭션으로 적용하고 그 날짜를 뽑기 완료로 둔다(4.2-1).
 * 이미 뽑기 완료인 날짜면 아무것도 하지 않는다(같은 파일을 다시 적용해도 연결이 늘지 않는다).
 */
export function applyRefPlan(db: DatabaseSync, plan: RefPlan, today: string): RefApplied {
  if (isExtracted(db, plan.date)) return { status: "nothing" };
  return inTransaction(db, () => {
    const firstStory = new Map<string, StoryRef>();
    for (const s of plan.stories) for (const r of s.entities) if (typeof r === "string" && !firstStory.has(r)) firstStory.set(r, s.story);
    const ids = new Map<string, number>();
    for (const n of plan.newEntities) {
      const st = firstStory.get(n.key);
      ids.set(n.key, createEntity(db, { kind: n.kind, name: n.name, aliases: withAliases(n.name, [], n.aliases), description: n.description, describedOn: today, describedStory: st ? fullKey(st) : null }));
    }
    const termIds = new Map<string, number>();
    for (const n of plan.newTerms) termIds.set(n.key, createTerm(db, { name: n.name, aliases: withAliases(n.name, [], n.aliases), description: n.description }));
    let entityLinks = 0;
    let termLinks = 0;
    for (const s of plan.stories) {
      for (const r of s.entities) if (linkEntity(db, s.story.id, typeof r === "number" ? r : ids.get(r)!)) entityLinks++;
      for (const t of s.terms) if (linkTerm(db, s.story.id, typeof t.term === "number" ? t.term : termIds.get(t.term)!, t.surface)) termLinks++;
    }
    let descriptions = 0;
    for (const u of plan.entityUpdates) {
      const e = getEntity(db, u.entity)!;
      let name = e.name;
      let aliases = e.aliases;
      if (u.name !== undefined && normalizeRefName(u.name) !== normalizeRefName(e.name)) {
        aliases = withAliases(u.name, aliases.filter((a) => normalizeRefName(a) !== normalizeRefName(u.name!)), [e.name]);
        name = u.name;
      }
      aliases = withAliases(name, aliases, u.aliases);
      const change: Parameters<typeof updateRef>[3] = { name, aliases };
      if (u.description !== undefined || u.name !== undefined) {
        if (u.description !== undefined) change.description = u.description;
        change.describedOn = today;
        change.describedStory = fullKey(u.story);
        descriptions++;
      }
      updateRef(db, "entity", u.entity, change);
    }
    for (const u of plan.termUpdates) {
      const t = getTerm(db, u.term)!;
      updateRef(db, "term", u.term, { aliases: withAliases(t.name, t.aliases, u.aliases) });
    }
    markExtracted(db, plan.date);
    return { status: "applied" as const, entityLinks, termLinks, newEntities: plan.newEntities.length, newTerms: plan.newTerms.length, descriptions };
  });
}

/** 대상·용어가 처음 나온 뉴스(가장 이른 연결). 없으면 null */
export function firstStoryOf(db: DatabaseSync, item: RefItem, id: number): StoryRef | null {
  return storiesOfRef(db, item, id)[0] ?? null;
}
