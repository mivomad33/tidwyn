import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { runDemandFetch, type DemandRunOptions } from "../src/demandFetch.ts";
import { DEMAND_COPY_DIR, demandDbPath, openDemandDb } from "../src/demandStore.ts";
import type { FetchInit, FetchResult, FetchText } from "../src/feeds.ts";
import { tempDir } from "./helpers.ts";

// 9.95단계 테스트의 가짜 소스 응답. 글은 모두 지어낸 값이다.

export const DAY = "2026-11-04";
export const NOW = new Date(`${DAY}T15:00:00+09:00`);

/** 지어낸 급상승어와 트렌드 글. 출력·실행 기록·요약에 나오면 안 된다 */
export const FAKE_TERM = "가짜급상승어하나";
export const FAKE_TAG = "fakeTrendTagOne";
export const FAKE_LINK_TITLE = "가짜 링크 제목 하나";
export const FAKE_AUTHOR = "가짜작성자이름";
export const FAKE_ACCOUNT = "fakewriteraccount";

export function rss(geo: string, items = 2): string {
  const it = Array.from({ length: items }, (_, i) => `<item><title>${FAKE_TERM}${geo}${i}</title><ht:approx_traffic>1000+</ht:approx_traffic></item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:ht="https://trends.google.com/trending/rss"><channel><title>Daily Search Trends</title>${it}</channel></rss>\n`;
}

export function tag(i: number): Record<string, unknown> {
  return { name: `${FAKE_TAG}${i}`, url: `https://fake.example/tags/t${i}`, history: [{ day: "1762214400", uses: "12", accounts: "7" }], id: String(i) };
}

export function link(i: number): Record<string, unknown> {
  return {
    url: `https://news.example.com/a${i}`,
    title: `${FAKE_LINK_TITLE}${i}`,
    description: "지어낸 설명",
    type: "link",
    author_name: FAKE_AUTHOR,
    author_url: `https://fake.example/@${FAKE_ACCOUNT}`,
    authors: [{ name: FAKE_AUTHOR, url: `https://fake.example/@${FAKE_ACCOUNT}`, account: { acct: FAKE_ACCOUNT, display_name: FAKE_AUTHOR } }],
    provider_name: "Example News",
    history: [{ day: "1762214400", uses: "3", accounts: "3" }],
  };
}

export type Reply = FetchResult | "hang" | "throw";

export interface Call {
  url: string;
  at: number;
}

/** 소스 응답. 정하지 않은 주소는 기본 응답(robots 404, 피드, 트렌드 n건) */
export function fakeHttp(clock: () => number, route: (url: string, n: number) => Reply | undefined = () => undefined, counts: { tags?: number; links?: number } = {}) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const http: FetchText = async (url: string, init?: FetchInit) => {
    calls.push({ url, at: clock() });
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const r = route(url, n) ?? defaultReply(url, counts);
    if (r === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    if (r === "throw") throw new Error(`연결 실패 ${FAKE_TERM}`);
    return r;
  };
  return { http, calls, urls: () => calls.map((c) => c.url) };
}

export function defaultReply(url: string, counts: { tags?: number; links?: number } = {}): FetchResult {
  const u = new URL(url);
  if (u.pathname === "/robots.txt") return { status: 404, text: "" };
  if (u.pathname === "/trending/rss") return { status: 200, text: rss(u.searchParams.get("geo")!) };
  const m = /\/api\/v1\/trends\/(tags|links)$/.exec(u.pathname);
  if (m) {
    const total = (m[1] === "tags" ? counts.tags : counts.links) ?? 3;
    const offset = Number(u.searchParams.get("offset"));
    const limit = Number(u.searchParams.get("limit"));
    const n = Math.max(0, Math.min(limit, total - offset));
    const make = m[1] === "tags" ? tag : link;
    return { status: 200, text: JSON.stringify(Array.from({ length: n }, (_, i) => make(offset + i))) };
  }
  return { status: 404, text: "" };
}

/**
 * 가상 시계. sleep과 timer는 가상 시각에 맞춰 차례로 풀린다. 모든 작업이 기다림에 들어간 뒤(setImmediate) 가장 이른 기다림을 푼다.
 * 그래서 동시에 도는 호스트의 기다림이 합쳐지지 않는다
 */
export function virtualTime() {
  let now = 0;
  let seq = 0;
  let scheduled = false;
  const waits: { at: number; id: number; resolve: () => void }[] = [];
  const pump = () => {
    scheduled = false;
    if (waits.length === 0) return;
    waits.sort((a, b) => a.at - b.at || a.id - b.id);
    const w = waits.shift()!;
    now = Math.max(now, w.at);
    w.resolve();
    schedule();
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(pump);
  };
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      waits.push({ at: now + ms, id: seq++, resolve });
      schedule();
    });
  const timer = (ms: number, signal: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const w = { at: now + ms, id: seq++, resolve };
      waits.push(w);
      signal.addEventListener("abort", () => {
        const i = waits.indexOf(w);
        if (i >= 0) waits.splice(i, 1);
        reject(new Error("aborted"));
      });
      schedule();
    });
  return { clock: () => now, sleep, timer };
}

export interface Env {
  dataDir: string;
  file: string;
  db: DatabaseSync;
}

export function demandEnv(): Env {
  const dataDir = tempDir("tidwyn-demand-");
  const file = demandDbPath(dataDir);
  return { dataDir, file, db: openDemandDb(file) };
}

export function run(e: Env, http: FetchText, vt: ReturnType<typeof virtualTime>, extra: Partial<DemandRunOptions> = {}) {
  return runDemandFetch({ db: e.db, dataDir: e.dataDir, dbExisted: true, http, now: () => NOW, clock: vt.clock, sleep: vt.sleep, timer: vt.timer, ...extra });
}

export function rows(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM demand_snapshots").get() as { n: number }).n;
}

export function copyDir(dataDir: string): string {
  return path.join(dataDir, DEMAND_COPY_DIR);
}
