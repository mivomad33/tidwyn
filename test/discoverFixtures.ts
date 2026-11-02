import type { DatabaseSync } from "node:sqlite";
import type { FetchResult, FetchText } from "../src/feeds.ts";
import { beginSnapshot, completeSnapshot, saveSnapshotRows, type SnapshotRow } from "../src/discoverStore.ts";
import { fakeHttp, type FakeHttp } from "./builderFixtures.ts";

// 새 제품과 뜨는 저장소 테스트 공통: 가짜 GitHub, 가짜 Product Hunt. 값은 모두 지어낸 것이고 네트워크를 쓰지 않는다.

export interface FakeRepo {
  name: string;
  stars: number;
  forks?: number;
  description?: string | null;
  language?: string | null;
  license?: string | null;
  pushed?: string;
  created?: string;
  fork?: boolean;
  archived?: boolean;
}

export function searchItem(r: FakeRepo): Record<string, unknown> {
  return {
    full_name: r.name,
    stargazers_count: r.stars,
    forks_count: r.forks ?? 10,
    description: r.description === undefined ? "Fake tool description" : r.description,
    language: r.language === undefined ? "TypeScript" : r.language,
    license: r.license === null ? null : { spdx_id: r.license ?? "MIT", name: r.license ?? "MIT License" },
    pushed_at: r.pushed ?? "2026-10-26T01:00:00Z",
    created_at: r.created ?? "2024-01-01T00:00:00Z",
    fork: r.fork ?? false,
    archived: r.archived ?? false,
  };
}

/** 검색 쿼리의 별 범위 */
export function starRange(url: string): { lo: number; hi: number | null } {
  const q = new URL(url).searchParams.get("q")!;
  const between = /stars:(\d+)\.\.(\d+)/.exec(q);
  if (between) return { lo: Number(between[1]), hi: Number(between[2]) };
  return { lo: Number(/stars:>=(\d+)/.exec(q)![1]), hi: null };
}

/** 쿼리의 별 범위 안 저장소를 별 많은 순으로 페이지를 나눠 준다 */
export function searchReply(repos: FakeRepo[], url: string, over: Record<string, unknown> = {}): FetchResult {
  const u = new URL(url);
  const { lo, hi } = starRange(url);
  const page = Number(u.searchParams.get("page"));
  const per = Number(u.searchParams.get("per_page"));
  const all = repos.filter((r) => r.stars >= lo && (hi === null || r.stars <= hi)).sort((a, b) => b.stars - a.stars);
  return { status: 200, text: JSON.stringify({ total_count: all.length, incomplete_results: false, items: all.slice((page - 1) * per, page * per).map(searchItem), ...over }) };
}

export interface Clock {
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
  tick: (ms: number) => void;
}

/** 재는 시계와 기다림. 기다림은 시계를 앞당긴다 */
export function fakeClock(start = Date.parse("2026-10-27T21:00:00Z")): Clock {
  let t = start;
  const sleeps: number[] = [];
  return {
    clock: () => t,
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    tick: (ms) => {
      t += ms;
    },
  };
}

export function seedSnapshot(db: DatabaseSync, date: string, rows: FakeRepo[], complete = true): void {
  beginSnapshot(db, date);
  saveSnapshotRows(db, date, rows.map(snapshotRow));
  if (complete) completeSnapshot(db, date);
}

export function snapshotRow(r: FakeRepo): SnapshotRow {
  return { repo: r.name.toLowerCase(), name: r.name, stars: r.stars, description: r.description === undefined ? "Fake tool description" : r.description, language: r.language === undefined ? "TypeScript" : r.language, license: r.license === undefined ? "MIT" : r.license, pushedAt: r.pushed ?? "2026-10-26T01:00:00Z", forks: r.forks ?? 10, createdAt: r.created ?? "2024-01-01T00:00:00Z" };
}

export interface Call {
  url: string;
  init?: Parameters<FetchText>[1];
}

export type Route = FetchResult | ((url: string, init?: Parameters<FetchText>[1]) => FetchResult | Promise<FetchResult>);

export interface DiscoverHttp {
  http: FetchText;
  calls: Call[];
  tools: FakeHttp;
  routes: Record<string, Route>;
}

const ok = (text: string): FetchResult => ({ status: 200, text });

/**
 * 가짜 응답. 경로 이름: `search`, `product`, `history:<저장소>`, `readme:<저장소>`, `release:<저장소>`.
 * 없는 저장소 상세는 정상 응답을 준다. 그 밖의 주소는 9.8 가짜 소스로 넘긴다.
 */
export function discoverHttp(routes: Record<string, Route> = {}, tools: FakeHttp = fakeHttp()): DiscoverHttp {
  const calls: Call[] = [];
  const reply = async (route: Route | undefined, fallback: FetchResult, url: string, init?: Parameters<FetchText>[1]) => {
    if (route === undefined) return fallback;
    return typeof route === "function" ? route(url, init) : route;
  };
  const http: FetchText = async (url, init) => {
    calls.push(init === undefined ? { url } : { url, init });
    if (url.startsWith("https://api.github.com/search/repositories")) return reply(routes.search, ok('{"total_count":0,"incomplete_results":false,"items":[]}'), url, init);
    if (url === "https://api.producthunt.com/v2/api/graphql") return reply(routes.product, ok('{"data":{"posts":{"edges":[]}}}'), url, init);
    const m = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/(stargazers\/history|readme|releases\/latest)$/.exec(url);
    if (m) {
      const repo = m[1]!;
      if (m[2] === "readme") return reply(routes[`readme:${repo}`], ok(`# ${repo}\n\nFake readme body explains the tool.`), url, init);
      if (m[2] === "releases/latest") return reply(routes[`release:${repo}`], ok('{"tag_name":"v1.0.0","published_at":"2026-10-20T00:00:00Z"}'), url, init);
      const weeks = Array.from({ length: 30 }, (_, i) => ({ week: 1793491200 - i * 604800, total: 70, days: [10, 10, 10, 10, 10, 10, 10] }));
      return reply(routes[`history:${repo}`], ok(JSON.stringify(weeks)), url, init);
    }
    return tools.http(url);
  };
  return { http, calls, tools, routes };
}

export interface FakePost {
  slug: string;
  name?: string;
  tagline?: string;
  description?: string | null;
  votes?: number;
  url?: string;
  topics?: string[];
}

export function postsReply(posts: FakePost[]): FetchResult {
  const edges = posts.map((p) => ({
    node: {
      slug: p.slug,
      name: p.name ?? `Fake ${p.slug}`,
      tagline: p.tagline ?? "Fake tagline",
      description: p.description === undefined ? "Fake product description" : p.description,
      votesCount: p.votes ?? 100,
      createdAt: "2026-10-27T08:00:00Z",
      url: p.url ?? `https://www.producthunt.com/products/${p.slug}?utm_campaign=producthunt-api&utm_source=Application`,
      topics: { edges: (p.topics ?? ["Developer Tools"]).map((name) => ({ node: { name } })) },
    },
  }));
  return ok(JSON.stringify({ data: { posts: { edges } } }));
}

/** 요청 본문의 GraphQL 변수 */
export function variablesOf(call: Call): Record<string, unknown> {
  return (JSON.parse(String(call.init?.body)) as { variables: Record<string, unknown> }).variables;
}

export function queryOf(call: Call): string {
  return (JSON.parse(String(call.init?.body)) as { query: string }).query;
}
