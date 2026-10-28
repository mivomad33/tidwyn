import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Category } from "./brief.ts";
import { allIssues, developments, getIssue, linksOfStory, relatedIssues, storiesOfDate, type Issue } from "./issues.ts";
import { ISSUES_DIR, writeIfChanged, writeMarkdown, type BriefIssues } from "./markdown.ts";
import { listMerges } from "./merge.ts";
import { loadBrief, storedDates } from "./store.ts";

// 이슈 마크다운과 목록(2단계 4.4-2), 브리프의 이전 전개(4.4-1). DB만으로 만든다.

export const INDEX_FILE = "index.md";
export const PREVIOUS_LIMIT = 3;
export const INDEX_MERGES_LIMIT = 20;

export function issuesDir(dataDir: string): string {
  return path.join(dataDir, ISSUES_DIR);
}

export function issueIndexPath(dataDir: string): string {
  return path.join(issuesDir(dataDir), INDEX_FILE);
}

/** 한 날짜 브리프의 뉴스별 이슈 정보 */
export function briefIssues(db: DatabaseSync, date: string): BriefIssues {
  const out: BriefIssues = new Map();
  const devCache = new Map<number, ReturnType<typeof developments>>();
  const devs = (id: number) => {
    let d = devCache.get(id);
    if (!d) devCache.set(id, (d = developments(db, id)));
    return d;
  };
  const named = (id: number) => ({ id, name: getIssue(db, id)?.name ?? "" });
  for (const s of storiesOfDate(db, date)) {
    const links = linksOfStory(db, s.id);
    const primary = links.find((l) => l.primary);
    if (!primary) continue;
    const list = devs(primary.issueId);
    const idx = list.findIndex((d) => d.id === s.id);
    const previous = list
      .slice(Math.max(0, idx - PREVIOUS_LIMIT), Math.max(0, idx))
      .reverse()
      .map((d) => ({ date: d.date, key: d.key, title: d.title }));
    out.set(s.key, {
      primary: named(primary.issueId),
      extras: links.filter((l) => !l.primary).map((l) => named(l.issueId)),
      previous,
    });
  }
  return out;
}

function categoryText(c: Category): string {
  return `${c.major} / ${c.minor}${c.isNewMinor ? " (새 소분류)" : ""}`;
}

function period(i: Issue): string {
  return i.startDate === null ? "-" : `${i.startDate} ~ ${i.latestDate}`;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** 이슈 파일 내용 */
export function renderIssue(db: DatabaseSync, issue: Issue): string {
  if (issue.mergedInto !== null) {
    const to = getIssue(db, issue.mergedInto);
    const merge = listMerges(db).filter((m) => m.absorbed === issue.id && m.undoneOn === null).at(-1);
    return [`# ${issue.name}`, "", `이 이슈는 ${merge?.mergedOn ?? "-"}에 [${to?.name ?? issue.mergedInto}](${issue.mergedInto}.md)에 합쳐졌다.`, ""].join("\n");
  }
  const lines = [
    `# ${issue.name}`,
    "",
    `- **별칭:** ${issue.aliases.length > 0 ? issue.aliases.join(", ") : "없음"}`,
    `- **분류:** ${categoryText(issue.category)}`,
    `- **상태:** ${issue.status}`,
    `- **기간:** ${period(issue)} (전개 ${issue.count}건)`,
    "",
    "## 지금까지 요약",
    "",
    ...issue.summary.split("\n").filter((l) => l.trim() !== ""),
    "",
    "## 타임라인",
    "",
  ];
  const devs = developments(db, issue.id);
  if (devs.length === 0) lines.push("- 없음");
  for (const d of devs) {
    const src = d.source ? ` · [${d.source.name}](${d.source.url})` : "";
    lines.push(`- [${d.date}](../briefs/${d.date}.md) · ${d.section} · ${d.title}${src}`);
  }
  lines.push("", "## 관련 이슈", "");
  const related = relatedIssues(db, issue.id).map((id) => getIssue(db, id)!);
  if (related.length === 0) lines.push("- 없음");
  for (const r of related) lines.push(`- [${r.name}](${r.id}.md)`);
  return lines.join("\n") + "\n";
}

/** 목록 파일 내용 */
export function renderIndex(db: DatabaseSync): string {
  const live = allIssues(db).filter((i) => i.mergedInto === null);
  const byLatest = (a: Issue, b: Issue) => (b.latestDate ?? "").localeCompare(a.latestDate ?? "") || a.id - b.id;
  const open = live.filter((i) => i.status === "진행 중").sort(byLatest);
  const closed = live.filter((i) => i.status === "종료").sort(byLatest);
  const table = (list: Issue[]) =>
    list.length === 0
      ? ["없음"]
      : ["| 이슈 | 분류 | 전개 | 기간 |", "| --- | --- | --- | --- |", ...list.map((i) => `| [${cell(i.name)}](${i.id}.md) | ${cell(categoryText(i.category))} | ${i.count} | ${period(i)} |`)];
  const lines = ["# 이슈 목록", "", `진행 중 ${open.length}개, 종료 ${closed.length}개`, "", "## 진행 중", "", ...table(open), "", "## 종료", "", ...table(closed), "", "## 최근 합치기", ""];
  const merges = listMerges(db).slice(-INDEX_MERGES_LIMIT).reverse();
  if (merges.length === 0) lines.push("없음");
  for (const m of merges) {
    const s = getIssue(db, m.survivor);
    const head = `- 합치기 ${m.id} (${m.mergedOn}): [${m.record.before.absorbed.name}](${m.absorbed}.md) → [${s?.name ?? m.survivor}](${m.survivor}.md). 이유: ${m.reason}`;
    lines.push(m.undoneOn !== null ? `${head} · ${m.undoneOn}에 되돌림` : `${head} · 되돌리기: \`node src/cli.ts unmerge --id ${m.id}\``);
  }
  return lines.join("\n") + "\n";
}

/** 이슈 마크다운과 목록을 쓴다. DB에 없는 이슈 파일은 지운다 */
export function writeIssueMarkdown(db: DatabaseSync, dataDir: string): { issues: number; index: string } {
  const dir = issuesDir(dataDir);
  const issues = allIssues(db);
  const files = new Map<string, string>(issues.map((i) => [`${i.id}.md`, renderIssue(db, i)]));
  files.set(INDEX_FILE, renderIndex(db));
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) if (name.endsWith(".md") && !files.has(name)) fs.rmSync(path.join(dir, name));
  for (const [name, content] of files) writeIfChanged(path.join(dir, name), content);
  return { issues: issues.length, index: issueIndexPath(dataDir) };
}

/** 브리프 하나를 이슈 정보와 함께 쓴다 */
export function writeBriefMarkdown(db: DatabaseSync, dataDir: string, date: string): string | null {
  const stored = loadBrief(db, date);
  if (stored === null) return null;
  return writeMarkdown(dataDir, stored, briefIssues(db, date));
}

/** 모든 브리프와 이슈 마크다운을 DB에서 다시 만든다 */
export function renderAll(db: DatabaseSync, dataDir: string): { briefs: number; issues: number; index: string } {
  let briefs = 0;
  for (const d of storedDates(db)) if (writeBriefMarkdown(db, dataDir, d) !== null) briefs++;
  return { briefs, ...writeIssueMarkdown(db, dataDir) };
}
