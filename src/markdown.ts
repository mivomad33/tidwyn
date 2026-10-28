import fs from "node:fs";
import path from "node:path";
import type { Category, Source, StoredBrief } from "./brief.ts";

// 날짜별 마크다운 브리프(4.4-1). 내용 순서는 S1 형식을 따른다.

export const BRIEFS_DIR = "briefs";

function category(c: Category): string {
  return `${c.major} / ${c.minor}${c.isNewMinor ? " (새 소분류)" : ""}`;
}

function source(s: Source): string {
  const extra = [s.publishedAt, s.publishedAtEstimated ? "발행일 추정" : null, s.primary ? "대표" : null].filter((x) => x !== null).join(", ");
  const image = s.imageUrl ? ` · [이미지](${s.imageUrl})` : "";
  return `[${s.name}](${s.url}) (${extra})${image}`;
}

/** 뉴스의 이슈 정보(2단계 4.4-1). 이슈가 없는 뉴스는 넣지 않는다 */
export interface StoryIssueInfo {
  primary: { id: number; name: string };
  extras: { id: number; name: string }[];
  /** 주 이슈에서 이 뉴스보다 앞선 전개, 가까운 것부터 최대 3건. key는 그 날짜 안의 뉴스 키(사이트 링크에 쓴다) */
  previous: { date: string; key: string; title: string }[];
}

/** 뉴스 키(`한국-1`, `한국-s1`) → 이슈 정보 */
export type BriefIssues = Map<string, StoryIssueInfo>;

/** 이슈 마크다운 폴더(데이터 폴더 기준) */
export const ISSUES_DIR = "issues";

function issueLink(i: { id: number; name: string }): string {
  return `[${i.name}](../${ISSUES_DIR}/${i.id}.md)`;
}

function issueLines(info: StoryIssueInfo): string[] {
  const extras = info.extras.length > 0 ? ` · 함께 엮인 이슈: ${info.extras.map(issueLink).join(", ")}` : "";
  const lines = [`- **이어지는 이야기:** ${issueLink(info.primary)}${extras}`];
  if (info.previous.length === 0) lines.push("- **이전 전개:** 새 이슈");
  else {
    lines.push("- **이전 전개:**");
    for (const p of info.previous) lines.push(`  - [${p.date}](${p.date}.md) ${p.title}`);
  }
  return lines;
}

export function renderMarkdown(stored: StoredBrief, issues: BriefIssues = new Map()): string {
  const { brief } = stored;
  const lines: string[] = [];
  lines.push(`# ${brief.targetDate} 브리프`, "");
  if (stored.late) lines.push(`> 늦게 수집: ${stored.collectedAt.slice(0, 10)}에 수집했다. 그날 기사를 덜 잡았을 수 있다.`, "");
  lines.push(`**오늘의 한 문장** ${brief.headline}`, "");
  lines.push(`**키워드** ${brief.keywords.map((k) => `\`${k}\``).join(" ")}`, "");
  for (const sec of brief.sections) {
    lines.push(`## ${sec.name}`, "", `**흐름** ${sec.flow}`, "");
    for (const t of sec.topStories) {
      lines.push(`### ${t.rank}. ${t.title}`, "");
      const info = issues.get(`${sec.name}-${t.rank}`);
      if (info) lines.push(...issueLines(info));
      lines.push(`- **분류:** ${category(t.category)}`);
      lines.push(`- **한 줄 요약:** ${t.summary}`);
      lines.push(`- **왜 중요한가:** ${t.whyItMatters}`);
      lines.push(`- **배경:** ${t.background}`);
      lines.push("- **핵심 사실:**");
      for (const f of t.keyFacts) lines.push(`  - ${f}`);
      if (t.analogy) lines.push(`- **비유:** ${t.analogy}`);
      lines.push(`- **앞으로 볼 것:** ${t.outlook}`);
      if (t.devCheckpoint) lines.push(`- **개발자 체크 포인트:** ${t.devCheckpoint}`);
      lines.push(`- **확인 수준:** ${t.confidence}`);
      lines.push("- **출처:**");
      for (const s of t.sources) lines.push(`  - ${source(s)}`);
      lines.push("");
    }
    if (sec.shortNews.length > 0) {
      lines.push("### 짧은 소식", "");
      sec.shortNews.forEach((n, ni) => {
        const info = issues.get(`${sec.name}-s${ni + 1}`);
        const issue = info ? ` · 이슈: ${issueLink(info.primary)}` : "";
        lines.push(`- ${n.summary} — ${category(n.category)} · ${n.sources.map(source).join(", ")}${issue}`);
      });
      lines.push("");
    }
    if (sec.unverified) lines.push(`> 확인되지 않은 내용: ${sec.unverified}`, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function markdownPath(dataDir: string, date: string): string {
  return path.join(dataDir, BRIEFS_DIR, `${date}.md`);
}

/** 파일을 쓴다. 내용이 같으면 다시 쓰지 않는다 */
export function writeIfChanged(file: string, content: string): void {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === content) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** 마크다운 파일을 쓴다. 쓴 경로 */
export function writeMarkdown(dataDir: string, stored: StoredBrief, issues: BriefIssues = new Map()): string {
  const file = markdownPath(dataDir, stored.brief.targetDate);
  writeIfChanged(file, renderMarkdown(stored, issues));
  return file;
}
