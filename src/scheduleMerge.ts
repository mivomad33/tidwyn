import type { DatabaseSync } from "node:sqlite";
import { addDays } from "./kst.ts";
import { fullKey, getIssue, inTransaction, storyByFullKey } from "./issues.ts";
import { similarPairs, type SimilarPair } from "./merge.ts";
import { dueText } from "./scheduleExtract.ts";
import {
  addMonths,
  allSchedules,
  getSchedule,
  isDayDue,
  isLiveSchedule,
  isMonthDue,
  linkSchedule,
  monthOfDue,
  normalizeScheduleName,
  postponeTarget,
  relatedIssuesOfSchedule,
  resolveSchedule,
  storiesOfSchedule,
  unlinkAllSchedule,
  unlinkSchedule,
  updateSchedule,
  type Schedule,
  type ScheduleOutcome,
  type ScheduleRole,
} from "./schedules.ts";
import type { Checker, Obj } from "./validate.ts";

// 5단계 4.3: 일정 합치기(2·4단계 7일 합치기에 함께 넣는다), 되돌리기, 지우기.
// 비슷한 쌍 찾기는 이슈·대상·용어와 같은 코드(similarPairs)를 쓰고, 되돌리기 규칙도 4단계 4.3-3과 같다.

export const SCHEDULE_MERGE_CANDIDATE_LIMIT = 30;
const SCHEDULE_PAIR_THRESHOLD = 0.5;
/** 예정일이 이만큼(일) 안이면 합치기 후보로 본다 */
const PAIR_DAYS = 2;
/** 후보 쌍마다 보이는 근거 뉴스 수 */
const PAIR_STORIES = 3;

export function addScheduleNoMerge(db: DatabaseSync, x: number, y: number): void {
  db.prepare("INSERT OR IGNORE INTO schedule_no_merge (a, b) VALUES (?, ?)").run(Math.min(x, y), Math.max(x, y));
}

export function isScheduleNoMerge(db: DatabaseSync, x: number, y: number): boolean {
  return db.prepare("SELECT 1 FROM schedule_no_merge WHERE a = ? AND b = ?").get(Math.min(x, y), Math.max(x, y)) !== undefined;
}

/** 예정일이 같거나(달 단위와 그 달 안의 일 단위 포함) 이틀 안인지 */
export function duesClose(a: string, b: string): boolean {
  if (isMonthDue(a) || isMonthDue(b)) return monthOfDue(a) === monthOfDue(b);
  return a <= addDays(b, PAIR_DAYS) && b <= addDays(a, PAIR_DAYS);
}

/** 한쪽이 다른 쪽을 연기 대상으로 가리키는지(흡수된 것은 남는 것으로 따라간다) */
function postponeRelated(db: DatabaseSync, a: Schedule, b: Schedule): boolean {
  const to = (s: Schedule) => (s.postponedTo === null ? null : resolveSchedule(db, s.postponedTo));
  return to(a) === b.id || to(b) === a.id;
}

/**
 * 비슷한 일정 쌍(4.3-1): 예정일이 가깝고 이름의 두 글자 묶음이 겹치는 쌍. 흡수·지운 것, 근거가 없는 것,
 * "합치지 않음" 쌍, 연기 관계인 쌍은 뺀다. 예정일이 가까운 것끼리만 비교하도록 달마다(그 달과 다음 달) 나눠 찾는다.
 */
export function scheduleMergeCandidates(db: DatabaseSync): SimilarPair<Schedule>[] {
  const live = allSchedules(db).filter((s) => isLiveSchedule(s) && storiesOfSchedule(db, s.id, "basis").length > 0);
  const byMonth = new Map<string, Schedule[]>();
  for (const s of live) {
    const m = monthOfDue(s.due);
    byMonth.set(m, [...(byMonth.get(m) ?? []), s]);
  }
  const seen = new Set<string>();
  const out: SimilarPair<Schedule>[] = [];
  for (const m of [...byMonth.keys()].sort()) {
    const items = [...byMonth.get(m)!, ...(byMonth.get(addMonths(m, 1)) ?? [])];
    const pairs = similarPairs(
      items,
      (s) => [s.name],
      (a, b) => (duesClose(a.due, b.due) && !postponeRelated(db, a, b) ? SCHEDULE_PAIR_THRESHOLD : null),
      (x, y) => isScheduleNoMerge(db, x, y),
      Number.MAX_SAFE_INTEGER,
      normalizeScheduleName,
    );
    for (const p of pairs) {
      const k = `${Math.min(p.a.id, p.b.id)}:${Math.max(p.a.id, p.b.id)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p.a.id < p.b.id ? p : { a: p.b, b: p.a, score: p.score });
    }
  }
  return out.sort((p, q) => q.score - p.score || p.a.id - q.a.id || p.b.id - q.b.id).slice(0, SCHEDULE_MERGE_CANDIDATE_LIMIT);
}

function outcomeLine(db: DatabaseSync, s: Schedule): string {
  if (s.outcome === "result") {
    const r = storiesOfSchedule(db, s.id, "result");
    return `결과 연결(${r.map((x) => `${x.date} ${x.title}`).join(" / ")})`;
  }
  if (s.outcome === "cancelled") return "취소";
  if (s.outcome === "postponed") {
    const t = postponeTarget(db, s);
    return t === null ? "연기(새 날짜 모름)" : `연기 → 일정 ${t.id}`;
  }
  return "없음";
}

function describeForMerge(db: DatabaseSync, s: Schedule): string[] {
  const basis = storiesOfSchedule(db, s.id, "basis").reverse();
  const issues = relatedIssuesOfSchedule(db, s.id).map((i) => getIssue(db, i)?.name ?? "");
  return [
    `- 일정 ${s.id}: ${s.name} (${dueText(s.due)}, ${s.major})`,
    `  - 관련 이슈: ${issues.length > 0 ? issues.join(", ") : "없음"}`,
    `  - 결과: ${outcomeLine(db, s)}`,
    `  - 근거 뉴스 ${basis.length}건(최근 ${Math.min(PAIR_STORIES, basis.length)}건):`,
    ...basis.slice(0, PAIR_STORIES).map((x) => `    - ${x.date} ${x.title}`),
  ];
}

/** 합치기 후보 파일의 일정 부분 */
export function renderScheduleMergeCandidates(db: DatabaseSync, pairs: SimilarPair<Schedule>[]): string[] {
  const lines = [`## 일정 후보 (${pairs.length}쌍)`, "", "같은 일정(같은 일이 같은 날 일어남)인 쌍만 scheduleMerges에 쓴다.", ""];
  pairs.forEach((p, n) => lines.push(`### 일정 후보 ${n + 1} (겹침 ${p.score.toFixed(2)})`, "", ...describeForMerge(db, p.a), ...describeForMerge(db, p.b), ""));
  return lines;
}

// ---- 합치기 파일의 일정 부분 ----

export interface ScheduleMergeEntry {
  survivor: number;
  absorbed: number;
  reason: string;
  /** 남는 것의 예정일(둘 중 하나). 없으면 남는 것 그대로, 남는 것이 달 단위이고 흡수되는 것이 일 단위면 일 단위 */
  due?: string;
}

/** 두 일정의 결과가 같은지(결과 종류와 연기 대상). 연기 대상이 지워졌으면 화면처럼 "연기(새 날짜 모름)"으로 본다 */
function sameOutcome(db: DatabaseSync, a: Schedule, b: Schedule): boolean {
  if (a.outcome !== b.outcome) return false;
  if (a.outcome !== "postponed") return true;
  return postponeTarget(db, a)?.id === postponeTarget(db, b)?.id;
}

/** 합치기 파일의 scheduleMerges를 검사한다(4.3-2). 위반은 c에 더한다 */
export function checkScheduleMerges(c: Checker, db: DatabaseSync, root: Obj): ScheduleMergeEntry[] {
  if (root.scheduleMerges === undefined) return [];
  const entries: ScheduleMergeEntry[] = [];
  const checkId = (v: unknown, where: string): Schedule | null => {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      c.add(where, "일정 식별자(숫자)여야 한다");
      return null;
    }
    const s = getSchedule(db, v);
    if (s === null) c.add(where, `일정 ${v}이(가) 없다`);
    else if (s.deleted) c.add(where, `일정 ${v}은(는) 지운 일정이다`);
    else if (s.mergedInto !== null) c.add(where, `일정 ${v}은(는) 이미 일정 ${resolveSchedule(db, v)}에 흡수되었다`);
    else return s;
    return null;
  };
  c.arr(root, "scheduleMerges", "scheduleMerges", "합치기 파일").forEach((raw, idx) => {
    const w = `scheduleMerges ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["survivor", "absorbed", "reason", "due"], w);
    const s = checkId(o.survivor, `${w} survivor`);
    const a = checkId(o.absorbed, `${w} absorbed`);
    const reason = c.text(o, "reason", "이유", w);
    if (s === null || a === null) return;
    if (s.id === a.id) {
      c.add(w, "같은 일정끼리 합칠 수 없다");
      return;
    }
    const e: ScheduleMergeEntry = { survivor: s.id, absorbed: a.id, reason };
    if (o.due !== undefined) {
      if (o.due !== s.due && o.due !== a.due) c.add(`${w} due`, `남는 일정의 예정일은 두 일정의 예정일(${s.due}, ${a.due}) 중 하나여야 한다`);
      else e.due = o.due as string;
    }
    if (isScheduleNoMerge(db, s.id, a.id)) c.add(w, `일정 ${s.id}와 ${a.id}는 되돌려서 "합치지 않음"이 된 쌍이다`);
    if (postponeRelated(db, s, a)) c.add(w, `일정 ${s.id}와 ${a.id}는 한쪽이 다른 쪽을 연기 대상으로 가리킨다(연기로 생긴 일정은 합치지 않는다)`);
    if (s.outcome !== null && a.outcome !== null && !sameOutcome(db, s, a)) c.add(w, `두 일정의 결과가 다르다(일정 ${s.id}: ${outcomeLine(db, s)}, 일정 ${a.id}: ${outcomeLine(db, a)})`);
    entries.push(e);
  });
  const absorbed = new Set<number>();
  entries.forEach((m, idx) => {
    if (absorbed.has(m.absorbed)) c.add(`scheduleMerges ${idx + 1}`, `일정 ${m.absorbed}이(가) 두 번 흡수된다`);
    absorbed.add(m.absorbed);
  });
  entries.forEach((m, idx) => {
    if (absorbed.has(m.survivor)) c.add(`scheduleMerges ${idx + 1}`, `남는 일정 ${m.survivor}이(가) 같은 파일에서 흡수된다(연달아 합치기). 최종 남는 일정으로 바로 합친다`);
  });
  return entries;
}

/** 합치기 전 상태(되돌리기에 쓴다). 연결은 전역 뉴스 키와 종류 */
export interface ScheduleSnapshot {
  id: number;
  name: string;
  due: string;
  outcome: ScheduleOutcome | null;
  postponedTo: number | null;
  links: { story: string; role: ScheduleRole }[];
}

export interface ScheduleMergeRecord {
  before: { survivor: ScheduleSnapshot; absorbed: ScheduleSnapshot };
  /** 합친 뒤 남는 것의 예정일·결과(되돌릴 때 그 뒤에 바뀌었는지 본다) */
  after: { due: string; outcome: ScheduleOutcome | null; postponedTo: number | null };
  /** 합치기로 남는 것에 더해진 연결 */
  added: { story: string; role: ScheduleRole }[];
  /** 흡수된 것을 연기 대상으로 가리키다 남는 것을 가리키게 된 일정 */
  repointed: number[];
}

export interface ScheduleMergeRow {
  id: number;
  mergedOn: string;
  survivor: number;
  absorbed: number;
  reason: string;
  record: ScheduleMergeRecord;
  undoneOn: string | null;
}

export function listScheduleMerges(db: DatabaseSync): ScheduleMergeRow[] {
  const rows = db.prepare("SELECT * FROM schedule_merges ORDER BY id").all() as {
    id: number;
    merged_on: string;
    survivor: number;
    absorbed: number;
    reason: string;
    record: string;
    undone_on: string | null;
  }[];
  return rows.map((r) => ({ id: r.id, mergedOn: r.merged_on, survivor: r.survivor, absorbed: r.absorbed, reason: r.reason, record: JSON.parse(r.record) as ScheduleMergeRecord, undoneOn: r.undone_on }));
}

function snapshot(db: DatabaseSync, id: number): ScheduleSnapshot {
  const s = getSchedule(db, id)!;
  return { id, name: s.name, due: s.due, outcome: s.outcome, postponedTo: s.postponedTo, links: storiesOfSchedule(db, id).map((st) => ({ story: fullKey(st), role: st.role })) };
}

const linkKey = (l: { story: string; role: ScheduleRole }) => `${l.story}|${l.role}`;

function mergeOne(db: DatabaseSync, m: ScheduleMergeEntry, today: string): number {
  const before = { survivor: snapshot(db, m.survivor), absorbed: snapshot(db, m.absorbed) };
  const added: ScheduleMergeRecord["added"] = [];
  const have = new Set(before.survivor.links.map(linkKey));
  for (const l of before.absorbed.links) {
    if (have.has(linkKey(l))) continue;
    linkSchedule(db, storyByFullKey(db, l.story)!.id, m.survivor, l.role);
    added.push(l);
  }
  unlinkAllSchedule(db, m.absorbed);
  const s = before.survivor;
  const a = before.absorbed;
  const due = m.due ?? (isMonthDue(s.due) && isDayDue(a.due) && monthOfDue(a.due) === s.due ? a.due : s.due);
  const takeOutcome = s.outcome === null && a.outcome !== null;
  const after = { due, outcome: takeOutcome ? a.outcome : s.outcome, postponedTo: takeOutcome ? a.postponedTo : s.postponedTo };
  updateSchedule(db, m.survivor, after);
  updateSchedule(db, m.absorbed, { mergedInto: m.survivor });
  const repointed = (db.prepare("SELECT id FROM schedules WHERE postponed_to = ? AND id <> ?").all(m.absorbed, m.survivor) as { id: number }[]).map((r) => r.id);
  for (const id of repointed) updateSchedule(db, id, { postponedTo: m.survivor });
  const record: ScheduleMergeRecord = { before, after, added, repointed };
  const r = db.prepare("INSERT INTO schedule_merges (merged_on, survivor, absorbed, reason, record) VALUES (?, ?, ?, ?, ?)").run(today, m.survivor, m.absorbed, m.reason, JSON.stringify(record));
  return Number(r.lastInsertRowid);
}

/** 일정 합치기를 적용한다(호출하는 쪽의 트랜잭션 안에서). 만든 기록 번호들 */
export function applyScheduleMerges(db: DatabaseSync, merges: ScheduleMergeEntry[], today: string): number[] {
  return merges.map((m) => mergeOne(db, m, today));
}

export type ScheduleUnmergeResult = { ok: true; merge: ScheduleMergeRow } | { ok: false; reason: string };

/**
 * 일정 합치기 하나를 되돌린다(4.3-3, 규칙은 4단계 4.3-3과 같다). 흡수된 일정을 합치기 전 상태로 되살리고,
 * 남는 것은 합치기로 더해진 연결을 빼고 합치기 전 예정일·결과로 되돌린다. 합친 뒤 예정일·결과가 바뀌었으면 지금 값을 두고,
 * 합친 뒤 더해진 연결은 둔다. 그 쌍은 "합치지 않음"이 된다.
 * 연달아 합쳐진 경우(남는 것이 그 뒤 다른 일정에 흡수되었거나, 그 뒤 다른 일정을 흡수함)와 지운 일정이 든 기록은 거부한다.
 */
export function unmergeSchedule(db: DatabaseSync, mergeId: number, today: string): ScheduleUnmergeResult {
  const all = listScheduleMerges(db);
  const m = all.find((x) => x.id === mergeId);
  if (!m) return { ok: false, reason: `일정 합치기 기록 ${mergeId}이(가) 없다` };
  if (m.undoneOn !== null) return { ok: false, reason: `일정 합치기 ${mergeId}은(는) 이미 ${m.undoneOn}에 되돌렸다` };
  const S = getSchedule(db, m.survivor);
  const A = getSchedule(db, m.absorbed);
  if (S === null || A === null || S.deleted || A.deleted) return { ok: false, reason: `일정 합치기 ${mergeId}에 지운 일정이 들어 있다(지운 일정은 되살리지 않는다)` };
  const later = all.filter((x) => x.id > m.id && x.undoneOn === null);
  const chained = later.find((x) => x.absorbed === m.survivor || x.survivor === m.survivor || x.survivor === m.absorbed);
  if (chained) {
    return {
      ok: false,
      reason: `일정 ${m.survivor}이(가) 그 뒤 일정 합치기 ${chained.id}(일정 ${chained.absorbed} → 일정 ${chained.survivor})에 들어 있다(연달아 합쳐짐). 먼저 합치기 ${chained.id}을(를) 되돌린다`,
    };
  }
  const { before, after, added, repointed } = m.record;
  return inTransaction(db, () => {
    const a = before.absorbed;
    updateSchedule(db, m.absorbed, { mergedInto: null, due: a.due, outcome: a.outcome, postponedTo: a.postponedTo });
    for (const l of a.links) {
      const story = storyByFullKey(db, l.story);
      if (story) linkSchedule(db, story.id, m.absorbed, l.role);
    }
    for (const l of added) {
      const story = storyByFullKey(db, l.story);
      if (story) unlinkSchedule(db, story.id, m.survivor, l.role);
    }
    const cur = getSchedule(db, m.survivor)!;
    const change: Parameters<typeof updateSchedule>[2] = {};
    if (cur.due === after.due) change.due = before.survivor.due;
    if (cur.outcome === after.outcome && cur.postponedTo === after.postponedTo) {
      change.outcome = before.survivor.outcome;
      change.postponedTo = before.survivor.postponedTo;
    }
    updateSchedule(db, m.survivor, change);
    for (const id of repointed) {
      const x = getSchedule(db, id);
      if (x !== null && x.postponedTo === m.survivor) updateSchedule(db, id, { postponedTo: m.absorbed });
    }
    addScheduleNoMerge(db, m.survivor, m.absorbed);
    db.prepare("UPDATE schedule_merges SET undone_on = ? WHERE id = ?").run(today, m.id);
    return { ok: true as const, merge: { ...m, undoneOn: today } };
  });
}

/** 합치기 기록 목록(merges 명령 출력)의 일정 부분 */
export function describeScheduleMerges(db: DatabaseSync): string[] {
  return listScheduleMerges(db)
    .slice()
    .reverse()
    .map((m) => {
      const head = `- 일정 합치기 ${m.id} (${m.mergedOn}): 일정 ${m.absorbed}(${m.record.before.absorbed.name}) → 일정 ${m.survivor}(${getSchedule(db, m.survivor)?.name ?? ""}). 이유: ${m.reason}`;
      return head + (m.undoneOn !== null ? ` [${m.undoneOn}에 되돌림]` : ` · 되돌리기: node src/cli.ts schedule-unmerge --id ${m.id}`);
    });
}

// ---- 지우기(4.3-4, C13) ----

export type ScheduleDeleteResult = { ok: true; id: number; name: string; due: string; links: number; ids: number[]; pointing: number[] } | { ok: false; reason: string };

/**
 * 일정 하나를 지운다. 그것에 흡수되어 있던 일정도 함께 지운 것으로 본다. 연결을 모두 지우고, 행은 이름·예정일을 남긴 채
 * 지움 표시만 한다(식별자를 다시 쓰지 않고, 같은 이름·예정일의 새 일정을 거부하는 기록이 된다).
 * 그 일정을 연기 대상으로 가리키던 일정은 "연기(새 날짜 모름)"로 보인다(가리키는 값은 두고 화면에서 계산한다).
 */
export function deleteSchedule(db: DatabaseSync, id: number, today: string): ScheduleDeleteResult {
  const s = getSchedule(db, id);
  if (s === null) return { ok: false, reason: `일정 ${id}이(가) 없다` };
  if (s.deleted) return { ok: false, reason: `일정 ${id}은(는) 이미 지웠다` };
  if (s.mergedInto !== null) {
    const to = resolveSchedule(db, id);
    return { ok: false, reason: `일정 ${id}은(는) 일정 ${to}(${getSchedule(db, to)?.name ?? ""})에 흡수되었다. 남는 일정 ${to}을(를) 지운다` };
  }
  const all = allSchedules(db);
  const ids = [id, ...all.filter((x) => x.mergedInto !== null && resolveSchedule(db, x.id) === id).map((x) => x.id)];
  return inTransaction(db, () => {
    let links = 0;
    for (const x of ids) {
      links += unlinkAllSchedule(db, x);
      updateSchedule(db, x, { deleted: true, deletedOn: today });
    }
    const pointing = all.filter((x) => !ids.includes(x.id) && isLiveSchedule(x) && x.outcome === "postponed" && x.postponedTo !== null && ids.includes(resolveSchedule(db, x.postponedTo))).map((x) => x.id);
    return { ok: true as const, id, name: s.name, due: s.due, links, ids, pointing };
  });
}
