import type { DatabaseSync } from "node:sqlite";
import type { Category } from "./brief.ts";
import { addDays } from "./kst.ts";
import {
  FIRST_LINKED_KEY,
  ISSUE_STATUSES,
  addRelation,
  allIssues,
  createIssue,
  developments,
  getIssue,
  getMeta,
  inTransaction,
  latestStoredDate,
  linkStory,
  normalizeName,
  resolveIssue,
  setMeta,
  storiesOfDate,
  unlinkedStories,
  updateIssue,
  type Issue,
  type IssueStatus,
  type StoryRef,
} from "./issues.ts";
import { Checker, checkQuotes, parseCategory, type Violation } from "./validate.ts";

// 연결 단계(2단계 4.2): 후보 이슈 목록, 검색, 연결 파일 검사와 적용.

/** 후보 목록에 넣는 기간: DB의 가장 늦은 대상일에서 이만큼 앞까지 업데이트된 이슈 */
export const CANDIDATE_DAYS = 30;
/** 후보 목록 길이 상한. 이슈가 늘어도 목록이 커지지 않게 한다 */
export const CANDIDATE_LIMIT = 150;
export const SEARCH_LIMIT = 30;
export const SUMMARY_MAX_LINES = 5;

/** 최근에 업데이트된 이슈(흡수된 이슈 제외, 최근 업데이트일 늦은 순) */
export function candidateIssues(db: DatabaseSync): Issue[] {
  const latest = latestStoredDate(db);
  if (latest === null) return [];
  const since = addDays(latest, -CANDIDATE_DAYS);
  return allIssues(db)
    .filter((i) => i.mergedInto === null && i.latestDate !== null && i.latestDate >= since)
    .sort((a, b) => (b.latestDate ?? "").localeCompare(a.latestDate ?? "") || a.id - b.id)
    .slice(0, CANDIDATE_LIMIT);
}

/** 낱말로 이름·별칭·요약을 찾는다(흡수된 이슈 제외). 맞는 낱말이 많은 순 */
export function searchIssues(db: DatabaseSync, query: string): Issue[] {
  const words = query.split(/\s+/).map(normalizeName).filter((w) => w.length > 0);
  if (words.length === 0) return [];
  const scored: { issue: Issue; score: number }[] = [];
  for (const issue of allIssues(db)) {
    if (issue.mergedInto !== null) continue;
    const names = [issue.name, ...issue.aliases].map(normalizeName);
    const summary = normalizeName(issue.summary);
    let score = 0;
    for (const w of words) {
      if (names.some((n) => n.includes(w))) score += 2;
      else if (summary.includes(w)) score += 1;
    }
    if (score > 0) scored.push({ issue, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (b.issue.latestDate ?? "").localeCompare(a.issue.latestDate ?? "") || a.issue.id - b.issue.id)
    .slice(0, SEARCH_LIMIT)
    .map((s) => s.issue);
}

function categoryText(c: Category): string {
  return `${c.major} / ${c.minor}${c.isNewMinor ? " (새 소분류)" : ""}`;
}

/** 후보 목록·검색 결과의 이슈 한 개 */
export function describeIssue(db: DatabaseSync, issue: Issue): string {
  const recent = developments(db, issue.id).slice(-3).reverse();
  const head = issue.summary.split("\n").filter((l) => l.trim() !== "")[0] ?? "";
  const lines = [
    `### 이슈 ${issue.id}: ${issue.name}`,
    `- 별칭: ${issue.aliases.length > 0 ? issue.aliases.join(", ") : "없음"}`,
    `- 분류: ${categoryText(issue.category)} · 상태: ${issue.status} · 기간: ${issue.startDate ?? "-"} ~ ${issue.latestDate ?? "-"} · 전개 ${issue.count}건`,
    `- 최근 전개: ${recent.length > 0 ? recent.map((s) => `${s.date} ${s.title}`).join(" / ") : "없음"}`,
    `- 요약 앞부분: ${head.length > 120 ? `${head.slice(0, 120)}…` : head}`,
  ];
  return lines.join("\n");
}

/** work/<날짜>.issues.md 내용: 연결할 뉴스와 후보 이슈 */
export function renderLinkWork(db: DatabaseSync, date: string): { text: string; stories: number; candidates: number } {
  const stories = unlinkedStories(db, date);
  const candidates = candidateIssues(db);
  const lines = [`# ${date} 연결 작업`, "", `## 연결할 뉴스 (${stories.length}건)`, "", "키 · 종류 · 분류 · 제목(짧은 소식은 요약)", ""];
  for (const s of stories) lines.push(`- \`${s.key}\` · ${s.kind === "top" ? "주요" : "짧은"} · ${categoryText(s.category)} · ${s.title}`);
  lines.push(
    "",
    `## 후보 이슈 (${candidates.length}개)`,
    "",
    `DB의 가장 늦은 대상일에서 ${CANDIDATE_DAYS}일 안에 업데이트된 이슈, 최근 순 최대 ${CANDIDATE_LIMIT}개다. 여기 없는 오래된 이슈와 종료된 이슈는 issue-search 명령으로 찾는다.`,
    "",
  );
  for (const i of candidates) lines.push(describeIssue(db, i), "");
  return { text: lines.join("\n").trimEnd() + "\n", stories: stories.length, candidates: candidates.length };
}

export function renderSearch(db: DatabaseSync, query: string): string {
  const found = searchIssues(db, query);
  if (found.length === 0) return `"${query}"에 맞는 이슈가 없다.`;
  return [`"${query}" 검색 결과 ${found.length}개`, "", ...found.map((i) => describeIssue(db, i) + "\n")].join("\n").trimEnd();
}

// ---- 연결 파일 ----

/** 기존 이슈는 식별자(숫자), 같은 파일의 새 이슈는 키(글)로 가리킨다 */
export type IssueRefValue = number | string;

export interface LinkPlan {
  date: string;
  newIssues: { key: string; name: string; aliases: string[]; category: Category; summary: string }[];
  links: { story: StoryRef; primary: IssueRefValue; extra: IssueRefValue[] }[];
  summaries: Map<number, string>;
  statusChanges: { issue: IssueRefValue; status: IssueStatus }[];
  relations: [IssueRefValue, IssueRefValue][];
}

export type LinkCheck = { ok: true; plan: LinkPlan } | { ok: false; violations: Violation[] };

/** 요약 규칙(4.2-3): 비어 있지 않고, 빈 줄이 아닌 줄이 5줄 이하, 15단어 이상 직접 인용 없음 */
export function checkSummary(c: Checker, v: unknown, where: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    c.add(where, "요약이 비어 있으면 안 된다");
    return "";
  }
  const lines = v.split("\n").filter((l) => l.trim() !== "").length;
  if (lines > SUMMARY_MAX_LINES) c.add(where, `요약이 ${lines}줄이다(${SUMMARY_MAX_LINES}줄 이하여야 한다)`);
  checkQuotes(c, v, where);
  return v;
}

function absorbedWhy(db: DatabaseSync, id: number): string {
  const to = resolveIssue(db, id);
  const name = getIssue(db, to)?.name ?? "";
  return `이슈 ${id}은(는) 이슈 ${to}(${name})에 흡수되었다. ${to}을(를) 쓴다`;
}

/** 연결 파일을 검사한다(4.2-3). 위반마다 위치와 이유 */
export function checkLinkFile(db: DatabaseSync, data: unknown, date: string): LinkCheck {
  const c = new Checker();
  const root = c.obj(data, "연결 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["date", "newIssues", "links", "summaries", "statusChanges", "relations"], "연결 파일");
  if (root.date !== date) c.add("연결 파일 date", `대상일 ${date}와 같아야 한다(지금: ${String(root.date)})`);

  const live = allIssues(db).filter((i) => i.mergedInto === null);
  const existingNames = new Map<string, Issue>();
  for (const i of live) for (const n of [i.name, ...i.aliases]) if (!existingNames.has(normalizeName(n))) existingNames.set(normalizeName(n), i);

  // 새 이슈
  const plan: LinkPlan = { date, newIssues: [], links: [], summaries: new Map(), statusChanges: [], relations: [] };
  const newKeys = new Set<string>();
  const newNames = new Map<string, string>();
  c.arr(root, "newIssues", "newIssues", "연결 파일").forEach((raw, idx) => {
    const w = `newIssues ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["key", "name", "aliases", "category", "summary"], w);
    const key = c.text(o, "key", "key", w);
    if (key !== "" && newKeys.has(key)) c.add(`${w} key`, `"${key}"가 두 번 나온다`);
    if (key !== "") newKeys.add(key);
    const name = c.text(o, "name", "이름", w);
    checkQuotes(c, name, `${w} 이름`);
    const aliasesRaw = o.aliases === undefined ? [] : c.arr(o, "aliases", "별칭", w);
    const aliases: string[] = [];
    aliasesRaw.forEach((a, ai) => {
      if (typeof a !== "string" || a.trim() === "") c.add(`${w} 별칭 ${ai + 1}`, "비어 있지 않은 글이어야 한다");
      else aliases.push(a);
    });
    const category = parseCategory(c, o.category, w);
    const summary = checkSummary(c, o.summary, `${w} 요약`);
    for (const n of [name, ...aliases]) {
      if (n === "") continue;
      const nn = normalizeName(n);
      const hit = existingNames.get(nn);
      if (hit) c.add(`${w} 이름·별칭 "${n}"`, `기존 이슈 ${hit.id}(${hit.name})의 이름·별칭과 같다. 새로 만들지 말고 이슈 ${hit.id}에 붙인다`);
      const other = newNames.get(nn);
      if (other !== undefined && other !== key) c.add(`${w} 이름·별칭 "${n}"`, `같은 파일의 새 이슈 "${other}"의 이름·별칭과 같다`);
      else newNames.set(nn, key);
    }
    plan.newIssues.push({ key, name, aliases, category, summary });
  });

  const liveIds = new Set(live.map((i) => i.id));
  const allIds = new Set(allIssues(db).map((i) => i.id));
  const checkRef = (v: unknown, where: string): IssueRefValue | null => {
    if (typeof v === "number" && Number.isInteger(v)) {
      if (liveIds.has(v)) return v;
      c.add(where, allIds.has(v) ? absorbedWhy(db, v) : `이슈 ${v}이(가) 없다`);
      return null;
    }
    if (typeof v === "string" && v !== "") {
      if (newKeys.has(v)) return v;
      c.add(where, `새 이슈 키 "${v}"가 newIssues에 없다`);
      return null;
    }
    c.add(where, "기존 이슈 식별자(숫자)나 새 이슈 키(글)여야 한다");
    return null;
  };

  // 연결
  const unlinked = new Map(unlinkedStories(db, date).map((s) => [s.key, s]));
  const allOfDate = new Set(storiesOfDate(db, date).map((s) => s.key));
  const seenStories = new Set<string>();
  const used = new Set<IssueRefValue>();
  /** 기존 이슈 → 이번에 붙는 뉴스가 있다 */
  const receiving = new Set<number>();
  c.arr(root, "links", "links", "연결 파일").forEach((raw, idx) => {
    const w0 = `links ${idx + 1}`;
    const o = c.obj(raw, w0);
    if (o === null) return;
    c.keys(o, ["story", "primary", "extra"], w0);
    const key = typeof o.story === "string" ? o.story : "";
    const w = key !== "" ? `links ${idx + 1} (${key})` : w0;
    let story: StoryRef | undefined;
    if (key === "") c.add(`${w} story`, "뉴스 키가 필요하다");
    else if (seenStories.has(key)) c.add(`${w} story`, `뉴스 ${key}가 두 번 나온다`);
    else if (!allOfDate.has(key)) c.add(`${w} story`, `${date}에 뉴스 ${key}가 없다`);
    else if (!unlinked.has(key)) c.add(`${w} story`, `뉴스 ${key}는 이미 이슈에 연결되어 있다`);
    else story = unlinked.get(key);
    if (key !== "") seenStories.add(key);
    if (o.primary === undefined || o.primary === null) c.add(`${w} primary`, "주 이슈가 하나 있어야 한다");
    else if (Array.isArray(o.primary)) c.add(`${w} primary`, "주 이슈는 하나여야 한다");
    const primary = o.primary === undefined || o.primary === null || Array.isArray(o.primary) ? null : checkRef(o.primary, `${w} primary`);
    const extraRaw = o.extra === undefined ? [] : c.arr(o, "extra", "extra", w);
    const extra: IssueRefValue[] = [];
    extraRaw.forEach((e, ei) => {
      const r = checkRef(e, `${w} extra ${ei + 1}`);
      if (r !== null) extra.push(r);
    });
    const refs = [primary, ...extra].filter((r) => r !== null);
    if (new Set(refs).size !== refs.length) c.add(w, "같은 이슈가 두 번 나온다");
    for (const r of refs) {
      used.add(r);
      if (typeof r === "number") receiving.add(r);
    }
    if (story && primary !== null) plan.links.push({ story, primary, extra: [...new Set(extra)].filter((e) => e !== primary) });
  });
  for (const key of unlinked.keys()) if (!seenStories.has(key)) c.add(`links`, `연결할 뉴스 ${key}가 빠졌다`);
  for (const n of plan.newIssues) if (n.key !== "" && !used.has(n.key)) c.add(`newIssues "${n.key}"`, "어느 뉴스에도 연결되지 않았다");

  // 고쳐 쓴 요약
  const summaryRaw = root.summaries === undefined ? [] : c.arr(root, "summaries", "summaries", "연결 파일");
  summaryRaw.forEach((raw, idx) => {
    const w = `summaries ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["issue", "summary"], w);
    if (typeof o.issue !== "number") {
      c.add(`${w} issue`, "기존 이슈 식별자(숫자)여야 한다. 새 이슈의 요약은 newIssues에 쓴다");
      return;
    }
    const id = checkRef(o.issue, `${w} issue`);
    const summary = checkSummary(c, o.summary, `${w} 요약`);
    if (typeof id !== "number") return;
    if (plan.summaries.has(id)) c.add(`${w} issue`, `이슈 ${id}의 요약이 두 번 나온다`);
    else if (!receiving.has(id)) c.add(`${w} issue`, `이슈 ${id}에는 이번에 붙는 뉴스가 없다. 뉴스가 붙는 이슈의 요약만 고쳐 쓴다`);
    plan.summaries.set(id, summary);
  });
  for (const id of [...receiving].sort((a, b) => a - b)) {
    if (!plan.summaries.has(id)) c.add(`summaries`, `뉴스가 붙는 기존 이슈 ${id}(${getIssue(db, id)?.name ?? ""})의 고쳐 쓴 요약이 없다`);
  }

  // 상태 변경
  const statusRaw = root.statusChanges === undefined ? [] : c.arr(root, "statusChanges", "statusChanges", "연결 파일");
  statusRaw.forEach((raw, idx) => {
    const w = `statusChanges ${idx + 1}`;
    const o = c.obj(raw, w);
    if (o === null) return;
    c.keys(o, ["issue", "status"], w);
    const ref = checkRef(o.issue, `${w} issue`);
    const status = o.status;
    if (typeof status !== "string" || !(ISSUE_STATUSES as readonly string[]).includes(status)) {
      c.add(`${w} status`, `"${String(status)}"은(는) 상태 값(진행 중, 종료)이 아니다`);
      return;
    }
    if (ref === null) return;
    if (!used.has(ref)) {
      c.add(`${w} issue`, "이번에 뉴스가 붙는 이슈만 상태를 바꿀 수 있다(I7)");
      return;
    }
    if (typeof ref === "number") {
      const latest = getIssue(db, ref)?.latestDate ?? null;
      if (latest !== null && date < latest) c.add(`${w} issue`, `이슈 ${ref}의 최근 업데이트일(${latest})보다 앞선 뉴스만 붙어 상태를 바꿀 수 없다(I7)`);
    }
    plan.statusChanges.push({ issue: ref, status: status as IssueStatus });
  });

  // 관계
  const relRaw = root.relations === undefined ? [] : c.arr(root, "relations", "relations", "연결 파일");
  relRaw.forEach((raw, idx) => {
    const w = `relations ${idx + 1}`;
    if (!Array.isArray(raw) || raw.length !== 2) {
      c.add(w, "이슈 두 개의 목록([a, b])이어야 한다");
      return;
    }
    const a = checkRef(raw[0], `${w} 첫째`);
    const b = checkRef(raw[1], `${w} 둘째`);
    if (a !== null && a === b) c.add(w, "이슈 관계가 자기 자신을 가리킨다");
    else if (a !== null && b !== null) plan.relations.push([a, b]);
  });

  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, plan };
}

export type LinkApplied = { status: "applied"; linked: number; attached: number; newIssues: number } | { status: "nothing" };

/**
 * 검사를 통과한 연결 계획을 한 트랜잭션으로 적용한다(4.2-4).
 * 이슈가 없는 뉴스가 없으면 아무것도 하지 않는다(같은 날짜 다시 적용).
 */
export function applyLinkPlan(db: DatabaseSync, plan: LinkPlan, today: string): LinkApplied {
  if (unlinkedStories(db, plan.date).length === 0) return { status: "nothing" };
  return inTransaction(db, () => {
    const ids = new Map<IssueRefValue, number>();
    const before = new Map<number, { latest: string | null; status: IssueStatus }>();
    for (const l of plan.links) {
      for (const r of [l.primary, ...l.extra]) {
        if (typeof r === "number" && !before.has(r)) {
          const i = getIssue(db, r);
          before.set(r, { latest: i?.latestDate ?? null, status: i?.status ?? "진행 중" });
        }
      }
    }
    for (const n of plan.newIssues) ids.set(n.key, createIssue(db, { name: n.name, aliases: n.aliases, category: n.category, summary: n.summary }));
    const id = (r: IssueRefValue): number => (typeof r === "number" ? r : ids.get(r)!);
    let attached = 0;
    for (const l of plan.links) {
      linkStory(db, l.story.id, id(l.primary), true);
      for (const e of l.extra) linkStory(db, l.story.id, id(e), false);
      if (typeof l.primary === "number") attached++;
    }
    for (const [issue, summary] of plan.summaries) updateIssue(db, issue, { summary });
    // 종료된 이슈에 후속 뉴스(대상일이 최근 업데이트일과 같거나 뒤)가 붙으면 진행 중으로(I7)
    for (const [issue, b] of before) {
      if (b.status === "종료" && (b.latest === null || plan.date >= b.latest)) updateIssue(db, issue, { status: "진행 중" });
    }
    for (const s of plan.statusChanges) updateIssue(db, id(s.issue), { status: s.status });
    for (const [a, b] of plan.relations) addRelation(db, id(a), id(b));
    if (getMeta(db, FIRST_LINKED_KEY) === null) setMeta(db, FIRST_LINKED_KEY, today);
    return { status: "applied", linked: plan.links.length, attached, newIssues: plan.newIssues.length };
  });
}
