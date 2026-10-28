import type { DatabaseSync } from "node:sqlite";
import type { Category } from "./brief.ts";
import { addDays } from "./kst.ts";
import {
  FIRST_LINKED_KEY,
  MERGE_CHECKED_KEY,
  addNoMergePair,
  addRelation,
  allIssues,
  developments,
  fullKey,
  getIssue,
  getMeta,
  inTransaction,
  isNoMergePair,
  linkStory,
  linksOfStory,
  normalizeName,
  relatedIssues,
  removeRelation,
  setMeta,
  storyByFullKey,
  updateIssue,
  type Issue,
  type IssueStatus,
} from "./issues.ts";
import { checkSummary } from "./links.ts";
import { Checker, type Violation } from "./validate.ts";

// 합치기와 되돌리기(2단계 4.3)

export const MERGE_INTERVAL_DAYS = 7;
export const MERGE_CANDIDATE_LIMIT = 30;

/** 마지막 합치기 점검일(처음에는 첫 연결 적용일). 연결한 적이 없으면 null */
export function mergeCheckedOn(db: DatabaseSync): string | null {
  return getMeta(db, MERGE_CHECKED_KEY) ?? getMeta(db, FIRST_LINKED_KEY);
}

export type MergeDue = { due: true; checkedOn: string } | { due: false; nextOn: string | null };

/** 점검일에서 7일이 지났으면 합치기를 한다(4.3-1) */
export function mergeDue(db: DatabaseSync, today: string): MergeDue {
  const checked = mergeCheckedOn(db);
  if (checked === null) return { due: false, nextOn: null };
  const next = addDays(checked, MERGE_INTERVAL_DAYS);
  return today >= next ? { due: true, checkedOn: checked } : { due: false, nextOn: next };
}

export function markMergeChecked(db: DatabaseSync, today: string): void {
  setMeta(db, MERGE_CHECKED_KEY, today);
}

/** 이름·별칭의 글자 두 개씩 묶음(공백 무시) */
function bigrams(names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    const s = normalizeName(n);
    if (s.length === 1) out.add(s);
    for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  }
  return out;
}

export interface MergePairCandidate {
  a: Issue;
  b: Issue;
  score: number;
}

/**
 * 비슷한 이슈 쌍 후보(4.3-2). 이름·별칭의 두 글자 묶음이 얼마나 겹치는지로 재고, 같은 대분류면 기준을 낮춘다.
 * 흡수된 이슈, 연결이 없는 이슈, "합치지 않음" 쌍은 뺀다.
 */
export function mergeCandidates(db: DatabaseSync): MergePairCandidate[] {
  const issues = allIssues(db).filter((i) => i.mergedInto === null && i.count > 0);
  const grams = new Map<number, Set<string>>();
  const index = new Map<string, number[]>();
  for (const i of issues) {
    const g = bigrams([i.name, ...i.aliases]);
    grams.set(i.id, g);
    for (const x of g) {
      const list = index.get(x) ?? [];
      list.push(i.id);
      index.set(x, list);
    }
  }
  const shared = new Map<string, number>();
  for (const list of index.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const k = `${list[x]}:${list[y]}`;
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
    }
  }
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out: MergePairCandidate[] = [];
  for (const [k, n] of shared) {
    const [x, y] = k.split(":").map(Number) as [number, number];
    const a = byId.get(x)!;
    const b = byId.get(y)!;
    if (isNoMergePair(db, x, y)) continue;
    const score = n / Math.min(grams.get(x)!.size, grams.get(y)!.size);
    const threshold = a.category.major === b.category.major ? 0.5 : 0.7;
    if (score >= threshold) out.push({ a, b, score });
  }
  return out.sort((p, q) => q.score - p.score || p.a.id - q.a.id || p.b.id - q.b.id).slice(0, MERGE_CANDIDATE_LIMIT);
}

function categoryText(c: Category): string {
  return `${c.major} / ${c.minor}${c.isNewMinor ? " (새 소분류)" : ""}`;
}

function describeForMerge(db: DatabaseSync, i: Issue): string[] {
  const devs = developments(db, i.id);
  return [
    `- 이슈 ${i.id}: ${i.name}`,
    `  - 별칭: ${i.aliases.length > 0 ? i.aliases.join(", ") : "없음"}`,
    `  - 분류: ${categoryText(i.category)} · 상태: ${i.status} · 기간: ${i.startDate ?? "-"} ~ ${i.latestDate ?? "-"}`,
    `  - 전개 ${devs.length}건:`,
    ...devs.map((s) => `    - ${s.date} ${s.title}`),
    `  - 요약: ${i.summary.replace(/\n+/g, " / ")}`,
  ];
}

/** work/merges.candidates.md 내용 */
export function renderMergeCandidates(db: DatabaseSync, pairs: MergePairCandidate[]): string {
  const lines = ["# 합치기 후보", "", `비슷한 이슈 쌍 ${pairs.length}개. 같은 이어지는 이야기인 쌍만 work/merges.json에 쓴다.`, ""];
  pairs.forEach((p, n) => {
    lines.push(`## 후보 ${n + 1} (겹침 ${p.score.toFixed(2)})`, "", ...describeForMerge(db, p.a), ...describeForMerge(db, p.b), "");
  });
  return lines.join("\n").trimEnd() + "\n";
}

// ---- 합치기 파일 ----

export interface MergeEntry {
  survivor: number;
  absorbed: number;
  reason: string;
  summary: string;
}

export type MergeCheck = { ok: true; merges: MergeEntry[] } | { ok: false; violations: Violation[] };

/**
 * 합치기 파일 검사(4.3-3). 한 파일 안에서 연달아 흡수되는 경우(흡수되는 이슈가 다른 항목의 남는 이슈이거나 두 번 흡수됨)는 거부한다.
 */
export function checkMergeFile(db: DatabaseSync, data: unknown): MergeCheck {
  const c = new Checker();
  const root = c.obj(data, "합치기 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["merges"], "합치기 파일");
  const merges: MergeEntry[] = [];
  const list = c.arr(root, "merges", "merges", "합치기 파일");
  const checkId = (v: unknown, where: string): number | null => {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      c.add(where, "이슈 식별자(숫자)여야 한다");
      return null;
    }
    const i = getIssue(db, v);
    if (i === null) {
      c.add(where, `이슈 ${v}이(가) 없다`);
      return null;
    }
    if (i.mergedInto !== null) {
      c.add(where, `이슈 ${v}은(는) 이미 이슈 ${i.mergedInto}에 흡수되었다`);
      return null;
    }
    return v;
  };
  list.forEach((raw, idx) => {
    const w = `merges ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["survivor", "absorbed", "reason", "summary"], w);
    const survivor = checkId(o.survivor, `${w} survivor`);
    const absorbed = checkId(o.absorbed, `${w} absorbed`);
    const reason = c.text(o, "reason", "이유", w);
    const summary = checkSummary(c, o.summary, `${w} 요약`);
    if (survivor !== null && survivor === absorbed) c.add(w, "같은 이슈끼리 합칠 수 없다");
    else if (survivor !== null && absorbed !== null) {
      if (isNoMergePair(db, survivor, absorbed)) c.add(w, `이슈 ${survivor}와 ${absorbed}는 되돌려서 "합치지 않음"이 된 쌍이다`);
      merges.push({ survivor, absorbed, reason, summary });
    }
  });
  const absorbedSet = new Map<number, number>();
  merges.forEach((m, idx) => {
    if (absorbedSet.has(m.absorbed)) c.add(`merges ${idx + 1}`, `이슈 ${m.absorbed}이(가) 두 번 흡수된다`);
    absorbedSet.set(m.absorbed, idx);
  });
  merges.forEach((m, idx) => {
    if (absorbedSet.has(m.survivor)) {
      c.add(`merges ${idx + 1}`, `남는 이슈 ${m.survivor}이(가) 같은 파일에서 흡수된다(연달아 합치기). 최종 남는 이슈로 바로 합친다`);
    }
  });
  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, merges };
}

/** 합치기 전 이슈 상태(I6). 연결은 전역 뉴스 키로 남긴다 */
export interface IssueSnapshot {
  id: number;
  name: string;
  aliases: string[];
  category: Category;
  status: IssueStatus;
  summary: string;
  links: { story: string; primary: boolean }[];
  relations: number[];
}

export interface MergeRecord {
  before: { survivor: IssueSnapshot; absorbed: IssueSnapshot };
  /** 합치기로 남는 이슈에 더해진 것 */
  added: { aliases: string[]; links: string[]; primaryUpgraded: string[]; relations: number[] };
}

export interface MergeRow {
  id: number;
  mergedOn: string;
  survivor: number;
  absorbed: number;
  reason: string;
  record: MergeRecord;
  undoneOn: string | null;
}

function snapshot(db: DatabaseSync, id: number): IssueSnapshot {
  const i = getIssue(db, id)!;
  return {
    id,
    name: i.name,
    aliases: i.aliases,
    category: i.category,
    status: i.status,
    summary: i.summary,
    links: developments(db, id).map((s) => ({ story: fullKey(s), primary: s.primary })),
    relations: relatedIssues(db, id),
  };
}

export function listMerges(db: DatabaseSync): MergeRow[] {
  const rows = db.prepare("SELECT * FROM merges ORDER BY id").all() as {
    id: number;
    merged_on: string;
    survivor: number;
    absorbed: number;
    reason: string;
    record: string;
    undone_on: string | null;
  }[];
  return rows.map((r) => ({
    id: r.id,
    mergedOn: r.merged_on,
    survivor: r.survivor,
    absorbed: r.absorbed,
    reason: r.reason,
    record: JSON.parse(r.record) as MergeRecord,
    undoneOn: r.undone_on,
  }));
}

function mergeOne(db: DatabaseSync, m: MergeEntry, today: string): number {
  const before = { survivor: snapshot(db, m.survivor), absorbed: snapshot(db, m.absorbed) };
  const added: MergeRecord["added"] = { aliases: [], links: [], primaryUpgraded: [], relations: [] };
  const survivorLinks = new Map(before.survivor.links.map((l) => [l.story, l.primary]));
  for (const l of before.absorbed.links) {
    const story = storyByFullKey(db, l.story)!;
    if (survivorLinks.has(l.story)) {
      if (l.primary && survivorLinks.get(l.story) === false) {
        db.prepare("UPDATE story_issues SET is_primary = 1 WHERE story_id = ? AND issue_id = ?").run(story.id, m.survivor);
        added.primaryUpgraded.push(l.story);
      }
    } else {
      linkStory(db, story.id, m.survivor, l.primary);
      added.links.push(l.story);
    }
  }
  db.prepare("DELETE FROM story_issues WHERE issue_id = ?").run(m.absorbed);
  const known = new Set([before.survivor.name, ...before.survivor.aliases].map(normalizeName));
  const aliases = [...before.survivor.aliases];
  for (const n of [before.absorbed.name, ...before.absorbed.aliases]) {
    if (known.has(normalizeName(n))) continue;
    known.add(normalizeName(n));
    aliases.push(n);
    added.aliases.push(n);
  }
  const survivorRel = new Set(before.survivor.relations);
  for (const x of before.absorbed.relations) {
    removeRelation(db, m.absorbed, x);
    if (x === m.survivor || survivorRel.has(x)) continue;
    addRelation(db, m.survivor, x);
    added.relations.push(x);
  }
  const status: IssueStatus = before.survivor.status === "진행 중" || before.absorbed.status === "진행 중" ? "진행 중" : "종료";
  updateIssue(db, m.survivor, { aliases, status, summary: m.summary });
  updateIssue(db, m.absorbed, { mergedInto: m.survivor });
  const record: MergeRecord = { before, added };
  const r = db
    .prepare("INSERT INTO merges (merged_on, survivor, absorbed, reason, record) VALUES (?, ?, ?, ?, ?)")
    .run(today, m.survivor, m.absorbed, m.reason, JSON.stringify(record));
  return Number(r.lastInsertRowid);
}

/** 검사를 통과한 합치기를 한 트랜잭션으로 적용하고 점검일을 바꾼다. 만든 합치기 기록 번호들 */
export function applyMerges(db: DatabaseSync, merges: MergeEntry[], today: string): number[] {
  return inTransaction(db, () => {
    const ids = merges.map((m) => mergeOne(db, m, today));
    markMergeChecked(db, today);
    return ids;
  });
}

export type UnmergeResult = { ok: true; merge: MergeRow } | { ok: false; reason: string };

/** 합치기 하나를 되돌린다(4.3-4) */
export function unmerge(db: DatabaseSync, mergeId: number, today: string): UnmergeResult {
  const all = listMerges(db);
  const m = all.find((x) => x.id === mergeId);
  if (!m) return { ok: false, reason: `합치기 기록 ${mergeId}이(가) 없다` };
  if (m.undoneOn !== null) return { ok: false, reason: `합치기 ${mergeId}은(는) 이미 ${m.undoneOn}에 되돌렸다` };
  const later = all.filter((x) => x.id > m.id && x.undoneOn === null);
  const reabsorbed = later.find((x) => x.absorbed === m.survivor);
  if (reabsorbed) {
    return { ok: false, reason: `남는 이슈 ${m.survivor}이(가) 그 뒤 합치기 ${reabsorbed.id}로 이슈 ${reabsorbed.survivor}에 흡수되었다. 먼저 합치기 ${reabsorbed.id}을(를) 되돌린다` };
  }
  return inTransaction(db, () => {
    const { before, added } = m.record;
    const S = m.survivor;
    const A = m.absorbed;
    const laterIntoS = later.filter((x) => x.survivor === S);
    // 다른 합치기로 S에 들어온 것
    const fromLater = {
      stories: new Set(laterIntoS.flatMap((x) => x.record.before.absorbed.links.map((l) => l.story))),
      names: new Set(laterIntoS.flatMap((x) => [x.record.before.absorbed.name, ...x.record.before.absorbed.aliases]).map(normalizeName)),
      relations: new Set(laterIntoS.flatMap((x) => x.record.before.absorbed.relations)),
    };
    // 그 합치기 뒤 S에 더해진 것이 있는지(새 연결, 새 관계, 다른 합치기)
    const postLinks = new Set([...before.survivor.links.map((l) => l.story), ...added.links]);
    const postRel = new Set([...before.survivor.relations, ...added.relations]);
    const nowLinks = developments(db, S).map(fullKey);
    const nowRel = relatedIssues(db, S);
    const changedAfter = laterIntoS.length > 0 || nowLinks.some((k) => !postLinks.has(k)) || nowRel.some((x) => !postRel.has(x));

    // 흡수된 이슈를 되살린다
    const a = before.absorbed;
    updateIssue(db, A, { mergedInto: null, name: a.name, aliases: a.aliases, category: a.category, status: a.status, summary: a.summary });
    const touched: { storyId: number; primary: boolean }[] = [];
    for (const l of a.links) {
      const story = storyByFullKey(db, l.story);
      if (!story) continue;
      linkStory(db, story.id, A, l.primary);
      touched.push({ storyId: story.id, primary: l.primary });
    }
    // 다른 합치기로도 들어온 것은 남기고, 그 합치기의 "더해진 것"으로 옮겨 적는다(그 합치기를 되돌릴 때 빠지게)
    const handOver = (has: (x: MergeRow) => boolean, put: (x: MergeRow) => void) => {
      const x = laterIntoS.find(has);
      if (x) put(x);
    };
    // S에서 이 합치기로 더해진 연결을 뺀다(다른 합치기로도 들어온 뉴스는 남긴다)
    for (const key of added.links) {
      if (fromLater.stories.has(key)) {
        handOver((x) => x.record.before.absorbed.links.some((l) => l.story === key), (x) => x.record.added.links.push(key));
        continue;
      }
      const story = storyByFullKey(db, key);
      if (story) db.prepare("DELETE FROM story_issues WHERE story_id = ? AND issue_id = ?").run(story.id, S);
    }
    for (const key of added.primaryUpgraded) {
      const story = storyByFullKey(db, key);
      if (story) db.prepare("UPDATE story_issues SET is_primary = 0 WHERE story_id = ? AND issue_id = ?").run(story.id, S);
    }
    // 뉴스마다 주 이슈는 정확히 하나: 되살린 이슈의 합치기 전 주 이슈 연결이 이긴다
    for (const t of touched) {
      if (t.primary) db.prepare("UPDATE story_issues SET is_primary = 0 WHERE story_id = ? AND issue_id <> ?").run(t.storyId, A);
      const links = linksOfStory(db, t.storyId);
      if (links.length > 0 && !links.some((l) => l.primary)) {
        const pick = links.find((l) => l.issueId === A) ?? links[0]!;
        db.prepare("UPDATE story_issues SET is_primary = 1 WHERE story_id = ? AND issue_id = ?").run(t.storyId, pick.issueId);
      }
    }
    // S의 별칭과 관계
    for (const n of added.aliases) {
      if (!fromLater.names.has(normalizeName(n))) continue;
      handOver(
        (x) => [x.record.before.absorbed.name, ...x.record.before.absorbed.aliases].some((y) => normalizeName(y) === normalizeName(n)),
        (x) => x.record.added.aliases.push(n),
      );
    }
    const removeAliases = new Set(added.aliases.map(normalizeName).filter((n) => !fromLater.names.has(n)));
    const s = getIssue(db, S)!;
    const aliases = s.aliases.filter((x) => !removeAliases.has(normalizeName(x)));
    for (const r of added.relations) {
      if (!fromLater.relations.has(r)) removeRelation(db, S, r);
      else handOver((x) => x.record.before.absorbed.relations.includes(r), (x) => x.record.added.relations.push(r));
    }
    for (const x of laterIntoS) db.prepare("UPDATE merges SET record = ? WHERE id = ?").run(JSON.stringify(x.record), x.id);
    // 되살린 관계: 상대가 그사이 흡수됐으면 그 남는 이슈를 가리킨다
    for (const x of a.relations) {
      let to = x;
      const seen = new Set<number>();
      for (;;) {
        const i = getIssue(db, to);
        if (!i || i.mergedInto === null || seen.has(to)) break;
        seen.add(to);
        to = i.mergedInto;
      }
      if (to !== A) addRelation(db, A, to);
    }
    const restore = changedAfter ? {} : { summary: before.survivor.summary, status: before.survivor.status };
    updateIssue(db, S, { aliases, ...restore });
    addNoMergePair(db, S, A);
    db.prepare("UPDATE merges SET undone_on = ? WHERE id = ?").run(today, m.id);
    return { ok: true as const, merge: { ...m, undoneOn: today } };
  });
}

/** 합치기 기록 목록(명령 출력) */
export function describeMerges(db: DatabaseSync): string {
  const rows = listMerges(db);
  if (rows.length === 0) return "합치기 기록이 없다.";
  const name = (id: number) => getIssue(db, id)?.name ?? "";
  return rows
    .slice()
    .reverse()
    .map(
      (m) =>
        `- 합치기 ${m.id} (${m.mergedOn}): 이슈 ${m.absorbed}(${m.record.before.absorbed.name}) → 이슈 ${m.survivor}(${name(m.survivor)}). 이유: ${m.reason}` +
        (m.undoneOn !== null ? ` [${m.undoneOn}에 되돌림]` : ` · 되돌리기: node src/cli.ts unmerge --id ${m.id}`),
    )
    .join("\n");
}
