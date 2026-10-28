import fs from "node:fs";
import path from "node:path";
import type { Category, Source, StoredBrief } from "./brief.ts";

// 날짜별 마크다운 브리프(4.4-1). 내용 순서는 S1 형식을 따른다.

export const BRIEFS_DIR = "briefs";

function category(c: Category): string {
  return `${c.major} / ${c.minor}${c.isNewMinor ? " (새 소분류)" : ""}`;
}

function source(s: Source): string {
  const extra = [s.publishedAt, s.primary ? "대표" : null].filter((x) => x !== null).join(", ");
  const image = s.imageUrl ? ` · [이미지](${s.imageUrl})` : "";
  return `[${s.name}](${s.url}) (${extra})${image}`;
}

export function renderMarkdown(stored: StoredBrief): string {
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
      for (const n of sec.shortNews) lines.push(`- ${n.summary} — ${category(n.category)} · ${n.sources.map(source).join(", ")}`);
      lines.push("");
    }
    if (sec.unverified) lines.push(`> 확인되지 않은 내용: ${sec.unverified}`, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function markdownPath(dataDir: string, date: string): string {
  return path.join(dataDir, BRIEFS_DIR, `${date}.md`);
}

/** 마크다운 파일을 쓴다. 쓴 경로 */
export function writeMarkdown(dataDir: string, stored: StoredBrief): string {
  const file = markdownPath(dataDir, stored.brief.targetDate);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, renderMarkdown(stored));
  return file;
}
