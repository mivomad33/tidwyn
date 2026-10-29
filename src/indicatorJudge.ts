import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { INDICATORS, MAX_ISSUE_INDICATORS, isIndicatorId } from "./indicators.ts";
import { applyJudgment, unjudgedIssues } from "./indicatorStore.ts";
import { developments, getIssue, inTransaction } from "./issues.ts";
import { WORK_DIR } from "./run.ts";
import { Checker, type Violation } from "./validate.ts";

// 6단계 4.3: 이슈 지표 판단. 스크립트가 후보 목록을 쓰고, Claude가 판단 파일을 쓰고, 스크립트가 검사해 파일 단위로 적용한다.

/** 판단 파일 하나의 이슈 수 */
export const JUDGE_FILE_ISSUES = 40;
/** 후보 목록에 보이는 이슈마다의 최근 뉴스 제목 수 */
const RECENT_TITLES = 5;

/** 판단 후보 목록(md)과 Claude가 쓰는 판단 파일(json). 번호는 1부터 */
export function judgeWorkFile(dataDir: string, n: number, kind: "candidates.md" | "judge.json"): string {
  return path.join(dataDir, WORK_DIR, kind === "judge.json" ? `indicators.judge-${n}.json` : `indicators.candidates-${n}.md`);
}

/** 판단할 이슈를 파일마다 나눈다(식별자 순) */
export function judgeBatches(db: DatabaseSync, size = JUDGE_FILE_ISSUES): number[][] {
  const ids = unjudgedIssues(db);
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function renderJudgeCandidates(db: DatabaseSync, n: number, total: number, issueIds: number[], file: string): string {
  const lines: string[] = [
    `# 지표 판단 후보 ${n}/${total}`,
    "",
    `판단 파일: ${file}`,
    '형식: `{"issues": [{"id": <이슈 번호>, "indicators": ["<지표 식별자>", ...]}, ...]}`. 아래 이슈를 모두 넣는다. 이슈마다 0~3개.',
    "",
    "## 지표",
    "",
    ...INDICATORS.map((d) => `- \`${d.id}\` ${d.name} (${d.group}): ${d.description}`),
    "",
    "## 판단할 이슈",
  ];
  for (const id of issueIds) {
    const i = getIssue(db, id);
    if (i === null) continue;
    lines.push("", `### 이슈 ${i.id}: ${i.name}`, `- 분류: ${i.category.major} / ${i.category.minor}`, `- 지금까지: ${i.summary}`);
    const recent = developments(db, id).slice(-RECENT_TITLES).reverse();
    if (recent.length > 0) {
      lines.push("- 최근 뉴스:");
      for (const d of recent) lines.push(`  - ${d.date} ${d.title}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface JudgeEntry {
  id: number;
  indicators: string[];
}

export type JudgeCheck = { ok: true; entries: JudgeEntry[] } | { ok: false; violations: Violation[] };

/** 판단 파일을 검사한다(4.3-3). expected는 그 파일이 맡은 이슈 */
export function checkJudgeFile(data: unknown, expected: number[]): JudgeCheck {
  const c = new Checker();
  const root = c.obj(data, "판단 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["issues"], "판단 파일");
  const list = c.arr(root, "issues", "issues", "판단 파일");
  const want = new Set(expected);
  const seen = new Set<number>();
  const entries: JudgeEntry[] = [];
  list.forEach((raw, idx) => {
    const where = `issues[${idx}]`;
    const o = c.obj(raw, where);
    if (o === null) return;
    c.keys(o, ["id", "indicators"], where);
    const id = o.id;
    if (typeof id !== "number" || !Number.isInteger(id)) {
      c.add(`${where} id`, "이슈 번호(정수)여야 한다");
      return;
    }
    if (!want.has(id)) c.add(`${where} id`, `이슈 ${id}은(는) 이 후보 목록에 없다(없는 이슈이거나 다른 파일의 이슈다)`);
    if (seen.has(id)) c.add(`${where} id`, `이슈 ${id}이(가) 두 번 있다`);
    seen.add(id);
    const inds = c.arr(o, "indicators", "indicators", where);
    const ids: string[] = [];
    inds.forEach((x, j) => {
      if (typeof x !== "string" || !isIndicatorId(x)) c.add(`${where} indicators[${j}]`, `없는 지표 식별자다: ${JSON.stringify(x)}`);
      else if (ids.includes(x)) c.add(`${where} indicators[${j}]`, `같은 지표 ${x}가 두 번 있다`);
      else ids.push(x);
    });
    if (inds.length > MAX_ISSUE_INDICATORS) c.add(`${where} indicators`, `${inds.length}개 (0~${MAX_ISSUE_INDICATORS}개여야 한다)`);
    entries.push({ id, indicators: ids });
  });
  for (const id of expected) if (!seen.has(id)) c.add("issues", `이슈 ${id}이(가) 빠졌다(후보 목록의 이슈를 모두 넣는다. 고를 것이 없으면 indicators를 빈 목록으로)`);
  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, entries };
}

/** 검사를 통과한 파일을 한 번에 적용한다. 지표를 고른 이슈 수를 돌려준다 */
export function applyJudgeFile(db: DatabaseSync, entries: JudgeEntry[]): number {
  return inTransaction(db, () => {
    for (const e of entries) applyJudgment(db, e.id, e.indicators);
    return entries.filter((e) => e.indicators.length > 0).length;
  });
}

export function readJudgeFile(file: string): { ok: true; data: unknown } | { ok: false; reason: string } {
  if (!fs.existsSync(file)) return { ok: false, reason: `판단 파일이 없다: ${file}` };
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (e) {
    return { ok: false, reason: `판단 파일이 올바른 JSON이 아니다: ${(e as Error).message}` };
  }
}
