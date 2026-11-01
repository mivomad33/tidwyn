import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { applyBuilderPlan, checkBuilderFile, type BuilderApplied } from "../src/builderCheck.ts";
import { fetchBuilder, type BuilderFetchReport, type FetchOptions } from "../src/builderFetch.ts";
import { BUILDER_SOURCES, type DocSource } from "../src/builderSources.ts";
import { buildWorkData, type BuilderWorkData } from "../src/builderWork.ts";
import { openDb } from "../src/db.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { NOW, sampleBrief, tempDir } from "./helpers.ts";

// 빌더 테스트 공통: 가짜 소스 응답. 값은 모두 지어낸 것이고 네트워크를 쓰지 않는다.

export const TARGET = "2026-10-27";
/** 2026-10-28T00:00:00Z */
export { NOW };
export const HOUR = 3600_000;

type Reply = string | { status: number; text: string } | (() => Promise<{ status: number; text: string }>);

export const EMPTY_RSS = '<rss version="2.0"><channel></channel></rss>';
const PLAIN_DOC = "| Model | Price |\n|---|---|\n| fake-1 | $1 |\n| fake-2 | $2 |\n";
const DEPRECATION_DOC = "| Model | Shutdown date |\n|---|---|\n| old-1 | 2020-01-01 |\n";

function emptyBody(id: string): string {
  const spec = BUILDER_SOURCES.find((s) => s.id === id)!;
  switch (spec.kind) {
    case "release":
    case "ghsa":
      return "[]";
    case "feed":
      return EMPTY_RSS;
    case "kev":
      return '{"vulnerabilities":[]}';
    case "eol":
      return '{"result":{"releases":[]}}';
    case "doc":
      return spec.doc === "deprecation" ? DEPRECATION_DOC : PLAIN_DOC;
  }
}

export interface FakeHttp {
  http: FetchOptions["http"];
  calls: string[];
  /** 소스 id, `ghsa:critical`, `ghsa:high`, `npm:<이름>`별 응답 */
  replies: Record<string, Reply>;
}

export function fakeHttp(replies: Record<string, Reply> = {}): FakeHttp {
  const calls: string[] = [];
  const f: FakeHttp = {
    calls,
    replies,
    http: async (url) => {
      calls.push(url);
      let id: string;
      if (url.startsWith("https://api.npmjs.org/")) id = `npm:${decodeURIComponent(url.split("/last-week/")[1]!)}`;
      else if (url.startsWith("https://api.github.com/advisories")) id = `ghsa:${/severity=(\w+)/.exec(url)![1]}`;
      else id = BUILDER_SOURCES.find((s) => s.url === url)!.id;
      const r = f.replies[id];
      if (r === undefined) {
        if (id.startsWith("npm:")) return { status: 200, text: '{"downloads":0}' };
        return { status: 200, text: emptyBody(id.startsWith("ghsa") ? "ghsa" : id) };
      }
      if (typeof r === "function") return r();
      return typeof r === "string" ? { status: 200, text: r } : r;
    },
  };
  return f;
}

export function rss(items: { title: string; link: string; date: string; text?: string }[]): string {
  const body = items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate>${i.text === undefined ? "" : `<description>${i.text}</description>`}</item>`).join("");
  return `<rss version="2.0"><channel>${body}</channel></rss>`;
}

export function atom(items: { title: string; link: string; date: string; text?: string }[]): string {
  const body = items.map((i) => `<entry><title>${i.title}</title><link href="${i.link}"/><published>${i.date}</published>${i.text === undefined ? "" : `<summary>${i.text}</summary>`}</entry>`).join("");
  return `<feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

export function release(tag: string, published: string, body = "", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: tag, name: tag, body, html_url: `https://github.com/fake/repo/releases/tag/${tag}`, published_at: published, prerelease: false, draft: false, ...extra };
}

export function advisory(id: string, name: string, severity: string, reviewed: string | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ghsa_id: id,
    cve_id: null,
    html_url: `https://github.com/advisories/${id}`,
    summary: `Fake flaw in ${name}`,
    severity,
    github_reviewed_at: reviewed,
    withdrawn_at: null,
    vulnerabilities: [{ package: { ecosystem: "npm", name }, vulnerable_version_range: "< 2.0.0", first_patched_version: "2.0.0" }],
    ...extra,
  };
}

export interface Env {
  db: DatabaseSync;
  dataDir: string;
}

export function addBrief(db: DatabaseSync, date: string): void {
  const r = validateBrief(sampleBrief(date), date);
  if (!r.ok) throw new Error("가짜 브리프가 검사를 지나지 못했다");
  saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
}

export function env(...briefs: string[]): Env {
  const dataDir = tempDir();
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  if (briefs.length > 0) recordFirstCollectionDate(db, briefs[0]!);
  for (const d of briefs) addBrief(db, d);
  return { db, dataDir };
}

export async function run(e: Env, http: FakeHttp, o: { now?: Date; target?: string; off?: FetchOptions["off"]; clock?: () => number; deadlineMs?: number } = {}): Promise<BuilderFetchReport> {
  return fetchBuilder({ db: e.db, http: http.http, now: o.now ?? NOW, target: o.target ?? TARGET, dataDir: e.dataDir, home: null, ...(o.off ? { off: o.off } : {}), ...(o.clock ? { clock: o.clock } : {}), ...(o.deadlineMs !== undefined ? { deadlineMs: o.deadlineMs } : {}) });
}

export function item(n: number[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return { field: "코딩 도구", title: "가짜 도구의 기본 동작이 바뀌었다", whatChanged: "기본 설정이 달라져 동작이 바뀌었다", who: "가짜 도구를 쓰는 개발자", action: "없음", why: "기본 설정에서 영향이 있다", due: null, sources: [], candidates: n, ...over };
}

/** 항목의 출처를 후보에서 채워 항목 파일을 만든다 */
export function itemsFile(w: BuilderWorkData, items: Record<string, unknown>[]): unknown {
  const fill = (x: Record<string, unknown>) => {
    if ((x.sources as string[]).length > 0) return x;
    const urls = (x.candidates as number[]).flatMap((n) => {
      const c = w.candidates.find((y) => y.n === n);
      if (c) return [c.url];
      return w.reminders.find((y) => y.n === n)?.sources.map((s) => s.url) ?? [];
    });
    return { ...x, sources: urls };
  };
  return { targetDate: w.target, items: items.map(fill) };
}

/** 받은 결과를 항목과 함께 적용한다(검사를 지난 뒤) */
export function apply(e: Env, report: BuilderFetchReport, items: Record<string, unknown>[] = []): BuilderApplied {
  const work = buildWorkData(e.db, report);
  const checked = checkBuilderFile(e.db, itemsFile(work, items), work, { home: null });
  if (!checked.ok) throw new Error(JSON.stringify(checked.violations));
  return applyBuilderPlan(e.db, checked.plan, work, { home: null });
}

export const docSpec = (id: string) => BUILDER_SOURCES.find((s) => s.id === id) as DocSource;

/** 대상 날짜를 하루 넘기고 다음 실행을 흉내 낸다 */
export function nextDay(days: number): { now: Date; target: string } {
  const now = new Date(NOW.getTime() + days * 24 * HOUR);
  const t = new Date(Date.parse(TARGET) + days * 24 * HOUR).toISOString().slice(0, 10);
  return { now, target: t };
}
