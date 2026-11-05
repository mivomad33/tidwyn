import type { DatabaseSync } from "node:sqlite";
import { runCommunity, type CommunityRunOptions } from "../src/communityFetch.ts";
import type { FetchInit, FetchResult, FetchText } from "../src/feeds.ts";
import { daysBetween } from "../src/kst.ts";
import { virtualTime } from "./demandFixtures.ts";
import { ALL, FAKE, NOW, TARGET, TODAY, isRecent, series, wikiPart } from "./flowFixtures.ts";

// 9.98단계 테스트의 가짜 커뮤니티 응답. 글·작성자·저장소 이름은 모두 지어낸 값이다.

/** 응답에 심는 지어낸 글. 전용 DB·출력·실행 기록·요약 어디에도 나오면 안 된다 */
export const RESP = {
  title: "Fake Issue Title QZX",
  body: "fake issue body text QZW",
  login: "fake-author-login-qzv",
  owner: "fake-owner-qzu",
  repo: "fake-repo-qzt",
  postText: "fake bluesky post text QZS",
  handle: "fakehandle-qzr.example.com",
  did: "did:plc:fakedidqzq",
} as const;
export const RESP_TEXTS: readonly string[] = Object.values(RESP);

/** 지어낸 위키 문서(검색어가 된다) */
export const TOPICS = [FAKE.wiki, "Fake_Second_Topic_QZM", "Fake_Third_Topic_QZN"] as const;
export const TERMS = TOPICS.map((t) => t.replaceAll("_", " "));

/** Wikimedia en에 오른 문서 여럿(앞 28일 하루 1만, 최근 7일 하루 5만). 위키를 더 주면 그 위키에도 같은 꼴로 넣는다 */
export function seedTopics(db: DatabaseSync, topics: readonly string[] = TOPICS, wiki = "en"): void {
  series(db, `wikimedia:${wiki}`, ALL, (d) => [wikiPart([["Main_Page", 900_000], ...topics.map((t): [string, number] => [t, isRecent(d) ? 50_000 : 10_000])])]);
}

export interface Call {
  url: string;
  host: string;
  at: number;
  init?: FetchInit;
}

export type Reply = FetchResult | "hang" | "throw";

/** 질의 주소의 창(날짜)과 최근 창인지 */
export function windowOf(url: string): { from: string; to: string; recent: boolean; term: string } {
  const u = new URL(url);
  if (u.host === "api.github.com") {
    const q = u.searchParams.get("q")!;
    const m = /^"(.*)" is:issue created:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(q)!;
    return { term: m[1]!, from: m[2]!, to: m[3]!, recent: daysBetween(m[2]!, m[3]!) < 7 };
  }
  const from = u.searchParams.get("since")!;
  const until = u.searchParams.get("until")!;
  return { term: u.searchParams.get("q")!.slice(1, -1), from, to: until, recent: daysBetween(from, until) <= 7 };
}

const json = (v: unknown): FetchResult => ({ status: 200, text: JSON.stringify(v), headers: {} });

/** 기본 응답: 최근 창 50건, 앞 창 40건(같은 길이 평균 10). 첫 쪽은 저장소·계정 10곳이 고르게 */
export function githubReply(count: number, o: { items?: number; sameRepo?: boolean; incomplete?: boolean } = {}): FetchResult {
  const items = Array.from({ length: o.items ?? 10 }, (_, i) => ({
    title: `${RESP.title} ${i}`,
    body: RESP.body,
    user: { login: RESP.login },
    repository_url: `https://api.github.com/repos/${RESP.owner}/${RESP.repo}${o.sameRepo === true ? "" : i}`,
  }));
  return json({ total_count: count, incomplete_results: o.incomplete === true, items });
}

export function blueskyReply(hits: number | undefined, o: { posts?: number; sameAuthor?: boolean } = {}): FetchResult {
  const posts = Array.from({ length: o.posts ?? 10 }, (_, i) => ({ uri: `at://${RESP.did}${i}/app.bsky.feed.post/x`, author: { did: `${RESP.did}${o.sameAuthor === true ? "" : i}`, handle: RESP.handle }, record: { text: RESP.postText } }));
  return json(hits === undefined ? { posts } : { posts, hitsTotal: hits });
}

export function defaultReply(url: string): FetchResult {
  if (url.endsWith("/robots.txt")) return { status: 404, text: "Not Found", headers: {} };
  const w = windowOf(url);
  return url.includes("api.github.com") ? githubReply(w.recent ? 50 : 40) : blueskyReply(w.recent ? 60 : 40);
}

/** 가짜 커뮤니티 응답. route가 undefined를 돌려주면 기본 응답이다 */
export function fakeCommunity(clock: () => number, route: (url: string, n: number) => Reply | undefined = () => undefined) {
  const calls: Call[] = [];
  const http: FetchText = (url, init) => {
    calls.push({ url, host: new URL(url).host, at: clock(), init });
    const r = route(url, calls.filter((c) => c.url === url).length) ?? defaultReply(url);
    if (r === "hang") return new Promise<FetchResult>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    if (r === "throw") return Promise.reject(new Error("가짜 연결 실패"));
    return Promise.resolve(r);
  };
  const of = (host: string, search = true) => calls.filter((c) => c.host === host && c.url.endsWith("/robots.txt") !== search);
  return { http, calls, github: () => of("api.github.com"), bluesky: () => of("api.bsky.app"), robots: () => calls.filter((c) => c.url.endsWith("/robots.txt")) };
}

export function runOn(db: DatabaseSync, http: FetchText, vt: ReturnType<typeof virtualTime>, extra: Partial<CommunityRunOptions> = {}) {
  return runCommunity({ db, target: TARGET, today: TODAY, http, now: () => NOW, clock: vt.clock, sleep: vt.sleep, timer: vt.timer, ...extra });
}

/** 커뮤니티 표의 모든 행(문자열로) */
export function communityDump(db: DatabaseSync): string {
  return JSON.stringify(["community_terms", "community_counts", "community_status"].map((t) => db.prepare(`SELECT * FROM ${t}`).all()));
}

export { virtualTime };
