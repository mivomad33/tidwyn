import type { DatabaseSync } from "node:sqlite";
import { checkEntityDescription, checkTermDescription } from "./extract.ts";
import { fullKey, inTransaction, storyByFullKey } from "./issues.ts";
import { similarPairs, type SimilarPair } from "./merge.ts";
import {
  addDeletedName,
  allEntities,
  allTerms,
  isLive,
  linkEntity,
  linkTerm,
  normalizeRefName,
  refState,
  resolveRef,
  storiesOfRef,
  unlinkAll,
  unlinkRef,
  updateRef,
  type Entity,
  type EntityKind,
  type NameKey,
  type RefItem,
  type Term,
} from "./refs.ts";
import type { Checker, Obj } from "./validate.ts";

// 4단계 4.3: 대상·용어의 합치기(2단계 7일 합치기에 함께 넣는다), 되돌리기, 지우기.
// 비슷한 쌍 찾기는 2단계 이슈 합치기와 같은 코드(similarPairs)를 쓰고, 되돌리기 규칙도 2단계 4.3-4와 같다.

export const REF_MERGE_CANDIDATE_LIMIT = 30;
const REF_PAIR_THRESHOLD = 0.5;
/** 후보 쌍마다 보이는 등장 뉴스 수 */
const PAIR_STORIES = 5;
/** 지운 것이 든 합치기 기록의 이유 자리에 남기는 글(E15) */
export const MASKED_REASON = "지운 항목이 든 합치기";

const LABEL: Record<RefItem, string> = { entity: "대상", term: "용어" };

export type RefPair = { item: "entity"; pair: SimilarPair<Entity> } | { item: "term"; pair: SimilarPair<Term> };

export function addRefNoMerge(db: DatabaseSync, item: RefItem, x: number, y: number): void {
  db.prepare("INSERT OR IGNORE INTO ref_no_merge (item, a, b) VALUES (?, ?, ?)").run(item, Math.min(x, y), Math.max(x, y));
}

export function isRefNoMerge(db: DatabaseSync, item: RefItem, x: number, y: number): boolean {
  return db.prepare("SELECT 1 FROM ref_no_merge WHERE item = ? AND a = ? AND b = ?").get(item, Math.min(x, y), Math.max(x, y)) !== undefined;
}

/** 비슷한 대상 쌍(같은 종류끼리)과 용어 쌍(4.3-1). 흡수·지운 것, 연결이 없는 것, "합치지 않음" 쌍은 뺀다 */
export function refMergeCandidates(db: DatabaseSync): RefPair[] {
  const names = (x: Entity | Term) => [x.name, ...x.aliases];
  const entities = allEntities(db).filter((e) => isLive(e) && e.count > 0);
  const terms = allTerms(db).filter((t) => isLive(t) && t.count > 0);
  const ep = similarPairs(entities, names, (a, b) => (a.kind === b.kind ? REF_PAIR_THRESHOLD : null), (x, y) => isRefNoMerge(db, "entity", x, y), REF_MERGE_CANDIDATE_LIMIT, normalizeRefName);
  const tp = similarPairs(terms, names, () => REF_PAIR_THRESHOLD, (x, y) => isRefNoMerge(db, "term", x, y), REF_MERGE_CANDIDATE_LIMIT, normalizeRefName);
  return [...ep.map((pair): RefPair => ({ item: "entity", pair })), ...tp.map((pair): RefPair => ({ item: "term", pair }))];
}

function describeForMerge(db: DatabaseSync, item: RefItem, x: Entity | Term): string[] {
  const stories = storiesOfRef(db, item, x.id).reverse();
  return [
    `- ${LABEL[item]} ${x.id}: ${x.name}${item === "entity" ? ` (${(x as Entity).kind})` : ""}`,
    `  - 별칭: ${x.aliases.length > 0 ? x.aliases.join(", ") : "없음"}`,
    `  - 설명: ${x.description.replace(/\n+/g, " ")}`,
    `  - 등장 뉴스 ${stories.length}건(최근 ${Math.min(PAIR_STORIES, stories.length)}건):`,
    ...stories.slice(0, PAIR_STORIES).map((s) => `    - ${s.date} ${s.title}`),
  ];
}

/** 합치기 후보 파일의 대상·용어 부분 */
export function renderRefMergeCandidates(db: DatabaseSync, pairs: RefPair[]): string[] {
  const lines: string[] = [];
  const ents = pairs.filter((p) => p.item === "entity");
  const terms = pairs.filter((p) => p.item === "term");
  lines.push(`## 인물·기관·국가 후보 (${ents.length}쌍)`, "", "같은 사람·기관·나라인 쌍만 entityMerges에 쓴다.", "");
  ents.forEach((p, n) => lines.push(`### 대상 후보 ${n + 1} (겹침 ${p.pair.score.toFixed(2)})`, "", ...describeForMerge(db, p.item, p.pair.a), ...describeForMerge(db, p.item, p.pair.b), ""));
  lines.push(`## 용어 후보 (${terms.length}쌍)`, "", "같은 뜻의 용어인 쌍만 termMerges에 쓴다.", "");
  terms.forEach((p, n) => lines.push(`### 용어 후보 ${n + 1} (겹침 ${p.pair.score.toFixed(2)})`, "", ...describeForMerge(db, p.item, p.pair.a), ...describeForMerge(db, p.item, p.pair.b), ""));
  return lines;
}

// ---- 합치기 파일의 대상·용어 부분 ----

export interface RefMergeEntry {
  item: RefItem;
  survivor: number;
  absorbed: number;
  reason: string;
  /** 남는 것의 새 설명. 없으면 남는 것의 설명 그대로 */
  description?: string;
}

/** 합치기 파일의 entityMerges·termMerges를 검사한다(4.3-2). 위반은 c에 더한다 */
export function checkRefMerges(c: Checker, db: DatabaseSync, root: Obj): RefMergeEntry[] {
  const out: RefMergeEntry[] = [];
  for (const [item, field] of [["entity", "entityMerges"], ["term", "termMerges"]] as const) {
    if (root[field] === undefined) continue;
    const label = LABEL[item];
    const entries: RefMergeEntry[] = [];
    const checkId = (v: unknown, where: string): (ReturnType<typeof refState> & object) | null => {
      if (typeof v !== "number" || !Number.isInteger(v)) {
        c.add(where, `${label} 식별자(숫자)여야 한다`);
        return null;
      }
      const x = refState(db, item, v);
      if (x === null) c.add(where, `${label} ${v}이(가) 없다`);
      else if (x.deleted) c.add(where, `${label} ${v}은(는) 지운 ${label}이다`);
      else if (x.mergedInto !== null) c.add(where, `${label} ${v}은(는) 이미 ${label} ${resolveRef(db, item, v)}에 흡수되었다`);
      else return x;
      return null;
    };
    c.arr(root, field, field, "합치기 파일").forEach((raw, idx) => {
      const w = `${field} ${idx + 1}`;
      const o = c.obj(raw, w);
      if (o === null) return;
      c.keys(o, ["survivor", "absorbed", "reason", "description"], w);
      const s = checkId(o.survivor, `${w} survivor`);
      const a = checkId(o.absorbed, `${w} absorbed`);
      const reason = c.text(o, "reason", "이유", w);
      const e: RefMergeEntry = { item, survivor: s?.id ?? -1, absorbed: a?.id ?? -1, reason };
      if (o.description !== undefined) e.description = item === "entity" ? checkEntityDescription(c, o.description, `${w} 한 줄 설명`) : checkTermDescription(c, o.description, `${w} 설명`);
      if (s === null || a === null) return;
      if (s.id === a.id) c.add(w, `같은 ${label}끼리 합칠 수 없다`);
      else {
        if (item === "entity" && s.kind !== a.kind) c.add(w, `종류가 다르다(${s.kind}, ${a.kind}). 같은 종류끼리만 합친다`);
        if (isRefNoMerge(db, item, s.id, a.id)) c.add(w, `${label} ${s.id}와 ${a.id}는 되돌려서 "합치지 않음"이 된 쌍이다`);
        entries.push(e);
      }
    });
    const absorbed = new Set<number>();
    entries.forEach((m, idx) => {
      if (absorbed.has(m.absorbed)) c.add(`${field} ${idx + 1}`, `${label} ${m.absorbed}이(가) 두 번 흡수된다`);
      absorbed.add(m.absorbed);
    });
    entries.forEach((m, idx) => {
      if (absorbed.has(m.survivor)) c.add(`${field} ${idx + 1}`, `남는 ${label} ${m.survivor}이(가) 같은 파일에서 흡수된다(연달아 합치기). 최종 남는 ${label}로 바로 합친다`);
    });
    out.push(...entries);
  }
  return out;
}

/** 합치기 전 상태(되돌리기에 쓴다). 연결은 전역 뉴스 키와 본문 표기(용어) */
export interface RefSnapshot {
  id: number;
  kind?: EntityKind;
  name: string;
  aliases: string[];
  description: string;
  describedOn?: string | null;
  describedStory?: string | null;
  links: { story: string; surface: string | null }[];
}

export interface RefMergeRecord {
  before: { survivor: RefSnapshot; absorbed: RefSnapshot };
  /** 합치기로 남는 것에 더해진 것 */
  added: { aliases: string[]; links: string[] };
}

export interface RefMergeRow {
  id: number;
  item: RefItem;
  mergedOn: string;
  survivor: number;
  absorbed: number;
  reason: string;
  /** 지운 것이 든 기록은 null(가림, E15) */
  record: RefMergeRecord | null;
  undoneOn: string | null;
  masked: boolean;
}

export function listRefMerges(db: DatabaseSync): RefMergeRow[] {
  const rows = db.prepare("SELECT * FROM ref_merges ORDER BY id").all() as {
    id: number;
    item: RefItem;
    merged_on: string;
    survivor: number;
    absorbed: number;
    reason: string;
    record: string;
    undone_on: string | null;
    masked: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    item: r.item,
    mergedOn: r.merged_on,
    survivor: r.survivor,
    absorbed: r.absorbed,
    reason: r.reason,
    record: r.masked === 1 ? null : (JSON.parse(r.record) as RefMergeRecord),
    undoneOn: r.undone_on,
    masked: r.masked === 1,
  }));
}

function snapshot(db: DatabaseSync, item: RefItem, id: number): RefSnapshot {
  const x = refState(db, item, id)!;
  const s: RefSnapshot = { id, name: x.name, aliases: x.aliases, description: x.description, links: storiesOfRef(db, item, id).map((st) => ({ story: fullKey(st), surface: st.surface })) };
  if (item === "entity") {
    s.kind = x.kind;
    s.describedOn = x.describedOn ?? null;
    s.describedStory = x.describedStory ?? null;
  }
  return s;
}

function link(db: DatabaseSync, item: RefItem, storyId: number, id: number, surface: string | null): void {
  if (item === "entity") linkEntity(db, storyId, id);
  else linkTerm(db, storyId, id, surface);
}

function mergeOne(db: DatabaseSync, m: RefMergeEntry, today: string): number {
  const before = { survivor: snapshot(db, m.item, m.survivor), absorbed: snapshot(db, m.item, m.absorbed) };
  const added: RefMergeRecord["added"] = { aliases: [], links: [] };
  const survivorLinks = new Set(before.survivor.links.map((l) => l.story));
  for (const l of before.absorbed.links) {
    if (survivorLinks.has(l.story)) continue;
    link(db, m.item, storyByFullKey(db, l.story)!.id, m.survivor, l.surface);
    added.links.push(l.story);
  }
  unlinkAll(db, m.item, m.absorbed);
  const known = new Set([before.survivor.name, ...before.survivor.aliases].map(normalizeRefName));
  const aliases = [...before.survivor.aliases];
  for (const n of [before.absorbed.name, ...before.absorbed.aliases]) {
    if (known.has(normalizeRefName(n))) continue;
    known.add(normalizeRefName(n));
    aliases.push(n);
    added.aliases.push(n);
  }
  updateRef(db, m.item, m.survivor, { aliases, ...(m.description !== undefined ? { description: m.description } : {}) });
  updateRef(db, m.item, m.absorbed, { mergedInto: m.survivor });
  const record: RefMergeRecord = { before, added };
  const r = db
    .prepare("INSERT INTO ref_merges (item, merged_on, survivor, absorbed, reason, record) VALUES (?, ?, ?, ?, ?, ?)")
    .run(m.item, today, m.survivor, m.absorbed, m.reason, JSON.stringify(record));
  return Number(r.lastInsertRowid);
}

/** 대상·용어 합치기를 적용한다(호출하는 쪽의 트랜잭션 안에서). 만든 기록 번호들 */
export function applyRefMerges(db: DatabaseSync, merges: RefMergeEntry[], today: string): number[] {
  return merges.map((m) => mergeOne(db, m, today));
}

export type RefUnmergeResult = { ok: true; merge: RefMergeRow } | { ok: false; reason: string };

/** 대상·용어 합치기 하나를 되돌린다(4.3-3, 규칙은 2단계 4.3-4와 같다) */
export function unmergeRef(db: DatabaseSync, mergeId: number, today: string): RefUnmergeResult {
  const all = listRefMerges(db);
  const m = all.find((x) => x.id === mergeId);
  if (!m) return { ok: false, reason: `대상·용어 합치기 기록 ${mergeId}이(가) 없다` };
  if (m.masked || m.record === null) return { ok: false, reason: `합치기 ${mergeId}은(는) ${MASKED_REASON}라 되돌리지 않는다(지운 것은 되살리지 않는다)` };
  if (m.undoneOn !== null) return { ok: false, reason: `합치기 ${mergeId}은(는) 이미 ${m.undoneOn}에 되돌렸다` };
  const label = LABEL[m.item];
  const later = all.filter((x) => x.item === m.item && x.id > m.id && x.undoneOn === null && x.record !== null);
  const reabsorbed = later.find((x) => x.absorbed === m.survivor);
  if (reabsorbed) {
    return {
      ok: false,
      reason: `남는 ${label} ${m.survivor}이(가) 그 뒤 합치기 ${reabsorbed.id}로 ${label} ${reabsorbed.survivor}에 흡수되었다. 먼저 합치기 ${reabsorbed.id}을(를) 되돌린다`,
    };
  }
  const { item } = m;
  const { before, added } = m.record;
  return inTransaction(db, () => {
    const S = m.survivor;
    const A = m.absorbed;
    const laterIntoS = later.filter((x) => x.survivor === S);
    const recOf = (x: RefMergeRow) => x.record!;
    const fromLater = {
      stories: new Set(laterIntoS.flatMap((x) => recOf(x).before.absorbed.links.map((l) => l.story))),
      names: new Set(laterIntoS.flatMap((x) => [recOf(x).before.absorbed.name, ...recOf(x).before.absorbed.aliases]).map(normalizeRefName)),
    };
    const postLinks = new Set([...before.survivor.links.map((l) => l.story), ...added.links]);
    const changedAfter = laterIntoS.length > 0 || storiesOfRef(db, item, S).some((s) => !postLinks.has(fullKey(s)));

    // 흡수된 것을 되살린다
    const a = before.absorbed;
    updateRef(db, item, A, { mergedInto: null, name: a.name, aliases: a.aliases, description: a.description, describedOn: a.describedOn ?? null, describedStory: a.describedStory ?? null });
    for (const l of a.links) {
      const story = storyByFullKey(db, l.story);
      if (story) link(db, item, story.id, A, l.surface);
    }
    const handOver = (has: (x: RefMergeRow) => boolean, put: (x: RefMergeRecord) => void) => {
      const x = laterIntoS.find(has);
      if (x) put(recOf(x));
    };
    // 남는 것에서 이 합치기로 더해진 연결을 뺀다(뒤의 다른 합치기로도 들어온 뉴스는 남기고 그 기록으로 옮긴다)
    for (const key of added.links) {
      if (fromLater.stories.has(key)) {
        handOver((x) => recOf(x).before.absorbed.links.some((l) => l.story === key), (r) => r.added.links.push(key));
        continue;
      }
      const story = storyByFullKey(db, key);
      if (story) unlinkRef(db, item, story.id, S);
    }
    for (const n of added.aliases) {
      if (!fromLater.names.has(normalizeRefName(n))) continue;
      handOver(
        (x) => [recOf(x).before.absorbed.name, ...recOf(x).before.absorbed.aliases].some((y) => normalizeRefName(y) === normalizeRefName(n)),
        (r) => r.added.aliases.push(n),
      );
    }
    const remove = new Set(added.aliases.map(normalizeRefName).filter((n) => !fromLater.names.has(n)));
    const s = refState(db, item, S)!;
    const aliases = s.aliases.filter((x) => !remove.has(normalizeRefName(x)));
    for (const x of laterIntoS) db.prepare("UPDATE ref_merges SET record = ? WHERE id = ?").run(JSON.stringify(x.record), x.id);
    updateRef(db, item, S, { aliases, ...(changedAfter ? {} : { description: before.survivor.description }) });
    addRefNoMerge(db, item, S, A);
    db.prepare("UPDATE ref_merges SET undone_on = ? WHERE id = ?").run(today, m.id);
    return { ok: true as const, merge: { ...m, undoneOn: today } };
  });
}

/** 합치기 기록 목록(merges 명령 출력)의 대상·용어 부분 */
export function describeRefMerges(db: DatabaseSync): string[] {
  const rows = listRefMerges(db);
  const name = (item: RefItem, id: number) => refState(db, item, id)?.name ?? "";
  return rows
    .slice()
    .reverse()
    .map((m) => {
      const label = LABEL[m.item];
      if (m.record === null) return `- 대상·용어 합치기 ${m.id} (${m.mergedOn}): ${MASKED_REASON}${m.undoneOn !== null ? ` [${m.undoneOn}에 되돌림]` : ""}`;
      const head = `- 대상·용어 합치기 ${m.id} (${m.mergedOn}): ${label} ${m.absorbed}(${m.record.before.absorbed.name}) → ${label} ${m.survivor}(${name(m.item, m.survivor)}). 이유: ${m.reason}`;
      return head + (m.undoneOn !== null ? ` [${m.undoneOn}에 되돌림]` : ` · 되돌리기: node src/cli.ts ref-unmerge --id ${m.id}`);
    });
}

// ---- 지우기(4.3-4, E13, E15) ----

export type RefDeleteResult =
  | { ok: true; item: RefItem; id: number; names: string[]; links: number; ids: number[]; maskedMerges: number }
  | { ok: false; reason: string };

/**
 * 대상·용어 하나를 지운다. 그것에 흡수되어 있던 것도 함께 지운 것으로 본다.
 * 이름·별칭은 비밀 키 해시로만 지운 이름 기록에 남기고, 행은 이름·별칭·설명을 비운 채 남긴다(식별자를 다시 쓰지 않게).
 * 그것이 든 합치기 기록은 합치기 전 상태와 이유를 가린다.
 */
export function deleteRef(db: DatabaseSync, item: RefItem, id: number, key: NameKey, today: string): RefDeleteResult {
  const label = LABEL[item];
  const x = refState(db, item, id);
  if (x === null) return { ok: false, reason: `${label} ${id}이(가) 없다` };
  if (x.deleted) return { ok: false, reason: `${label} ${id}은(는) 이미 지웠다` };
  if (x.mergedInto !== null) {
    const to = resolveRef(db, item, id);
    return { ok: false, reason: `${label} ${id}은(는) ${label} ${to}(${refState(db, item, to)?.name ?? ""})에 흡수되었다. 남는 ${label} ${to}을(를) 지운다` };
  }
  const all: { id: number; mergedInto: number | null }[] = item === "entity" ? allEntities(db) : allTerms(db);
  const ids = [id, ...all.filter((y) => y.mergedInto !== null && resolveRef(db, item, y.id) === id).map((y) => y.id)];
  db.exec("PRAGMA secure_delete = ON");
  return inTransaction(db, () => {
    const names: string[] = [];
    let links = 0;
    for (const y of ids) {
      const st = refState(db, item, y)!;
      const scope = item === "entity" ? st.kind! : "용어";
      for (const n of [st.name, ...st.aliases]) {
        if (!names.some((m) => normalizeRefName(m) === normalizeRefName(n))) names.push(n);
        addDeletedName(db, key, scope, n, today);
      }
      links += unlinkAll(db, item, y);
      updateRef(db, item, y, { name: "", aliases: [], description: "", describedOn: null, describedStory: null, mergedInto: null, deleted: true });
    }
    const placeholders = ids.map(() => "?").join(", ");
    const masked = db
      .prepare(`UPDATE ref_merges SET reason = ?, record = '{}', masked = 1 WHERE item = ? AND (survivor IN (${placeholders}) OR absorbed IN (${placeholders}))`)
      .run(MASKED_REASON, item, ...ids, ...ids);
    return { ok: true as const, item, id, names, links, ids, maskedMerges: Number(masked.changes) };
  });
}
