import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Brief, Section, ShortNews, TopStory } from "../src/brief.ts";
import type { Context, Installer } from "../src/cli.ts";
import type { SectionName } from "../src/categories.ts";

// 테스트는 임시 폴더와 임시 git 저장소만 쓴다(4.3-5). 값은 모두 가짜다.

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

/** 고정 시각: KST 2026-10-28 09:00 (KST 어제 = 2026-10-27) */
export const NOW = new Date("2026-10-28T09:00:00+09:00");

const created: string[] = [];

export function tempDir(prefix = "tidwyn-test-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  created.push(dir);
  return dir;
}

/** 공개 페이지 검사를 통과하는 가짜 결과물의 파일들(첫 화면, robots.txt, 사이트맵). 사이트를 빌드하지 않는 테스트의 가짜 빌더가 쓴다 */
export function writeFakePublicFiles(outDir: string): void {
  const site = "https://tidwyn.vercel.app";
  fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html><html lang="ko"><head><title>Tidwyn</title><meta name="description" content="설명" /><link rel="canonical" href="${site}/" /></head><body><div id="root"></div></body></html>\n`);
  fs.writeFileSync(path.join(outDir, "robots.txt"), `User-agent: *\nDisallow: /search\n\nSitemap: ${site}/sitemap.xml\n`);
  fs.writeFileSync(path.join(outDir, "sitemap.xml"), `<urlset><url><loc>${site}/</loc></url></urlset>\n`);
}

export function cleanupTemp(): void {
  for (const dir of created.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // 윈도우는 아직 열려 있는 SQLite 파일을 지우지 못한다. 시스템 임시 폴더라 남겨 둔다
      if (process.platform !== "win32" || !["EPERM", "EBUSY"].includes((e as NodeJS.ErrnoException).code ?? "")) throw e;
    }
  }
}

export function sh(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

export function gitIn(cwd: string, ...args: string[]): string {
  return sh(cwd, "git", args);
}

/** main 브랜치에 커밋이 하나 있는 임시 저장소. data/와 node_modules/는 무시된다 */
export function tempRepo(): string {
  const dir = tempDir("tidwyn-repo-");
  gitIn(dir, "init", "-q", "-b", "main");
  gitIn(dir, "config", "user.name", "Test");
  gitIn(dir, "config", "user.email", "test@example.com");
  gitIn(dir, "config", "commit.gpgsign", "false");
  fs.writeFileSync(path.join(dir, ".gitignore"), "/data/\nnode_modules/\n/.test-data/\n");
  fs.writeFileSync(path.join(dir, "README.md"), "temp\n");
  gitIn(dir, "add", ".");
  gitIn(dir, "commit", "-q", "-m", "init");
  return dir;
}

export function commitCount(repo: string, ref = "--all"): number {
  return Number(gitIn(repo, "rev-list", "--count", ref).trim());
}

export function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: false }).map((f) => String(f).replaceAll(path.sep, "/")).sort();
}

export interface TestCtx extends Context {
  output: string[];
  installs: string[];
  text(): string;
}

export function makeCtx(cwd: string, env: NodeJS.ProcessEnv = {}, now: Date = NOW, install?: Installer): TestCtx {
  const output: string[] = [];
  const installs: string[] = [];
  return {
    cwd,
    env,
    now: () => now,
    out: (t) => output.push(t),
    install:
      install ??
      ((dir) => {
        installs.push(dir);
        return { ok: true };
      }),
    output,
    installs,
    text: () => output.join("\n"),
  };
}

function topStory(section: SectionName, rank: number, date: string): TopStory {
  const slug = `${section === "IT·AI" ? "it" : section === "한국" ? "kr" : "world"}-${rank}`;
  const story: TopStory = {
    rank,
    title: `${section} 뉴스 ${rank}의 핵심을 담은 제목`,
    summary: `${section} 뉴스 ${rank}을 한 줄로 요약했다.`,
    whyItMatters: "많은 사람의 생활에 영향을 준다.",
    background: "처음 보는 사람도 이해할 수 있게 배경을 적었다.",
    keyFacts: ["숫자 1: 3.5%", "주체: 가짜 기관", `날짜: ${date}`],
    outlook: "다음 주 발표가 예정되어 있다.",
    confidence: "여러 출처 확인",
    category: section === "IT·AI" ? { major: "IT·AI", minor: "AI 모델·연구" } : section === "한국" ? { major: "경제", minor: "금융·증시" } : { major: "국제", minor: "미국" },
    sources: [
      { name: "가짜통신", url: `https://news.example-${slug}.com/${date}/${slug}`, publishedAt: date, primary: true, imageUrl: `https://img.example.com/${slug}.jpg` },
      { name: "예시일보", url: `https://daily.example.org/${slug}`, publishedAt: date },
    ],
  };
  if (section === "IT·AI" && rank === 2) story.devCheckpoint = "가짜 라이브러리 2.0 보안 패치를 확인한다.";
  return story;
}

function shortNews(section: SectionName, i: number, date: string): ShortNews {
  return {
    summary: `${section} 짧은 소식 ${i}을 한 줄로 적었다.`,
    category: { major: "사회", minor: "교육" },
    sources: [{ name: "가짜방송", url: `https://tv.example.net/${date}/${section.length}-${i}`, publishedAt: date }],
  };
}

/** 검사를 통과하는 예시 브리프 데이터 */
export function sampleBrief(date = "2026-10-27"): Brief {
  const section = (name: SectionName, shorts: number): Section => {
    const s: Section = {
      name,
      flow: `${name} 섹션의 그날 흐름을 한 줄로 적었다.`,
      topStories: [1, 2, 3, 4, 5].map((r) => topStory(name, r, date)),
      shortNews: Array.from({ length: shorts }, (_, i) => shortNews(name, i + 1, date)),
    };
    return s;
  };
  const korea = section("한국", 2);
  korea.unverified = "일부 수치는 한 매체만 보도해 확인되지 않았다.";
  return {
    targetDate: date,
    headline: "그날 흐름을 한 문장으로 정리했다.",
    keywords: ["금리", "AI", "선거"],
    sections: [korea, section("세계", 1), section("IT·AI", 0)],
  };
}

export function clone<T>(v: T): T {
  return structuredClone(v);
}

export interface PagefindHit {
  url: string;
  meta: Record<string, string>;
}

/** 결과물의 Pagefind 브라우저 API를 Node에서 불러 검색한다(file: 주소는 디스크에서 읽는다) */
export async function searchOutput(outDir: string, queries: string[]): Promise<Map<string, PagefindHit[]>> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("file:")) throw new Error(`네트워크 요청 금지: ${url}`);
    return new Response(fs.readFileSync(fileURLToPath(url.split("?")[0]!)));
  }) as typeof fetch;
  try {
    const pf = (await import(pathToFileURL(path.join(outDir, "pagefind", "pagefind.js")).href)) as {
      options: (o: object) => Promise<void>;
      init: () => Promise<void>;
      search: (q: string) => Promise<{ results: { data: () => Promise<PagefindHit> }[] }>;
      destroy?: () => Promise<void>;
    };
    await pf.options({});
    await pf.init();
    const out = new Map<string, PagefindHit[]>();
    for (const q of queries) {
      const res = await pf.search(q);
      out.set(q, await Promise.all(res.results.map((r) => r.data())));
    }
    await pf.destroy?.();
    return out;
  } finally {
    globalThis.fetch = realFetch;
  }
}
