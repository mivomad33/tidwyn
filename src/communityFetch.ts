import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { GITHUB_JSON } from "./builderSources.ts";
import { addCount, addTerm, communityStreak, communityUnitKey, COMMUNITY_REASON_NAMES, COMMUNITY_STATUS_NAMES, hasCount, readCommunityUnits, selectedTerms, setCommunityStatus, BLUESKY_HITS_CAP, type CommunityReason, type CommunityStatus, type CommunityWindow } from "./communityStore.ts";
import { BLUESKY_API_HOST, BLUESKY_SEARCH_PATH, communitySources, DEFAULT_DEMAND_OFF, GITHUB_API_HOST, GITHUB_ISSUES_PATH, isDemandOff, officialSources, type CommunitySource, type DemandOff, type OfficialKind } from "./demandSources.ts";
import { officialUnits, UNIT_RULES, type RisingUnit, type SourceUnits, type UnitsOptions } from "./demandUnits.ts";
import { makeFetchText, type FetchResult, type FetchText } from "./feeds.ts";
import { inTransaction } from "./issues.ts";
import { addDays, daysBetween, kstIso } from "./kst.ts";
import { rateWait, SEARCH_GAP_MS } from "./repoSnapshot.ts";
import { robotsBlocks } from "./robots.ts";

// 9.98단계 4.2-1, 4.2-2(S1~S4): 그날 공식 오른 단위에서 검색어를 골라 커뮤니티 소스마다 두 창의 건수를 받는다.
// 응답의 글·제목·작성자·글 식별자·저장소 이름은 메모리에서 쏠림 비율을 세는 데만 쓰고 저장하지 않는다.
// 출력과 실행 기록에는 수와 상태, 사유 종류만 쓴다(검색어, 요청 주소, 응답 조각을 쓰지 않는다).

/** 명령 전체 상한(공식 단위 세기 포함, S3). 스킬은 Bash 시간 제한을 8분으로 준다 */
export const COMMUNITY_DEADLINE_MS = 6 * 60_000;
/** 대상 날짜 하나의 서로 다른 검색어 상한(S3). 같은 날 다시 돌아도 합계다 */
export const COMMUNITY_MAX_TERMS = 20;
/** 요청 하나의 시간 상한 */
export const COMMUNITY_REQUEST_TIMEOUT_MS = 20_000;
/** Bluesky 요청 사이 간격. GitHub는 9.9의 SEARCH_GAP_MS를 쓴다 */
export const BLUESKY_GAP_MS = 1000;
/** 첫 쪽 크기(쏠림 계산, S4) */
export const COMMUNITY_PAGE_SIZE = 100;
/** 검색어로 쓰는 공식 소스 종류: 이름이 낱말인 것(S1). 외부인 글 소스와 분류 이름 소스는 쓰지 않는다(S3) */
export const TERM_KINDS: readonly OfficialKind[] = ["wikimedia", "ftc-1372", "acrc-bigdata"];
/** 검색어 길이(글자 수) 범위 */
const TERM_MIN = 2;
const TERM_MAX = 60;

const USER_AGENT = "tidwyn/9.98 (personal demand counts)";
/** 커뮤니티 요청. 리디렉션을 따라가지 않는다(3xx는 예상 밖 응답) */
export const communityFetchText: FetchText = makeFetchText(USER_AGENT, COMMUNITY_REQUEST_TIMEOUT_MS + 5000, "manual");

// ---- 검색어 ----

/**
 * 공식 단위 이름을 검색어로 다듬는다(S3). 질의를 바꿀 수 있는 글자는 검색어에서 없앤다:
 * 따옴표·역슬래시·제어 문자가 있으면 쓰지 않고, 콜론(검색 한정어 `repo:` 꼴)과 구분 기호는 빈칸으로 바꾸며, 홀로 선 AND·OR·NOT이 있으면 쓰지 않는다.
 * Wikimedia는 끝의 괄호 설명(동음이의 표시)을 빼고, 1372는 '대분류 > 중분류'의 중분류만 쓴다. 쓸 수 없으면 null
 */
export function normalizeTerm(kind: OfficialKind, name: string): string | null {
  let t = name.normalize("NFKC").trim();
  if (kind === "ftc-1372") t = t.split(">").at(-1)!.trim();
  if (kind === "wikimedia") t = t.replace(/\s*\([^()]*\)\s*$/, "");
  // eslint-disable-next-line no-control-regex
  if (/["\\\u0000-\u001f\u007f]/.test(t)) return null;
  t = t.replace(/[:·/|]/g, " ").replace(/\s+/g, " ").trim();
  if (/(^|\s)(AND|OR|NOT)(\s|$)/.test(t)) return null;
  const n = [...t].length;
  if (n < TERM_MIN || n > TERM_MAX || !/\p{L}/u.test(t)) return null;
  return t;
}

export interface TermCandidate {
  term: string;
  /** 같은 검색어 판정 키(대소문자 무시) */
  same: string;
  unit: RisingUnit;
  kind: OfficialKind;
  window: CommunityWindow;
}

const sameKey = (t: string) => t.toLowerCase();

/** 커뮤니티 창(4.2-2): 공식 단위의 그날 창과 같게 하되 대상 날짜 전날을 넘으면 그만큼 앞으로 옮긴다 */
export function communityWindow(u: RisingUnit, target: string): CommunityWindow {
  const cap = addDays(target, -1);
  const shift = u.window.recentTo > cap ? daysBetween(cap, u.window.recentTo) : 0;
  return { recentFrom: addDays(u.window.recentFrom, -shift), recentTo: addDays(u.window.recentTo, -shift), baseFrom: addDays(u.window.baseFrom, -shift), baseTo: addDays(u.window.baseTo, -shift) };
}

/**
 * 그날 공식 오른 단위(소스마다 UNIT_RULES의 top 안, 9.97이 뺀 위키 문서 없음)에서 검색어 후보를 만든다(4.2-1).
 * 같은 이름은 규모(최근 값 ÷ 그 소스의 하한)가 가장 큰 단위 하나에 묶고, 후보는 규모 순이다.
 * pinned(같은 대상 날짜에 이미 고른 검색어의 공식 단위 키)가 있으면 그 이름은 그 단위에 묶는다(받은 건수가 그 단위로 저장되어 있다)
 */
export function termCandidates(sources: readonly SourceUnits[], target: string, pinned: ReadonlyMap<string, string> = new Map()): TermCandidate[] {
  const best = new Map<string, { c: TermCandidate; score: number }>();
  for (const s of sources) {
    if (!TERM_KINDS.includes(s.kind) || s.state !== "ok") continue;
    for (const u of s.rising.slice(0, UNIT_RULES[s.kind].top)) {
      if (u.name === null) continue;
      const term = normalizeTerm(s.kind, u.name);
      if (term === null) continue;
      const score = u.recent / UNIT_RULES[s.kind].floor;
      const same = sameKey(term);
      const prev = best.get(same);
      const pin = pinned.get(same);
      const better = prev === undefined || u.key === pin || (prev.c.unit.key !== pin && (score > prev.score || (score === prev.score && u.key < prev.c.unit.key)));
      if (better) best.set(same, { c: { term, same, unit: u, kind: s.kind, window: communityWindow(u, target) }, score });
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score || a.c.unit.key.localeCompare(b.c.unit.key)).map((x) => x.c);
}

/** 대상 날짜에 이미 고른 검색어는 그대로 쓰고, 새 검색어는 합계가 max를 넘지 않게 더한다(S3) */
export function pickTerms(cands: readonly TermCandidate[], previous: readonly string[], max = COMMUNITY_MAX_TERMS): { picked: TermCandidate[]; added: TermCandidate[] } {
  const prev = new Set(previous.map(sameKey));
  const picked: TermCandidate[] = [];
  const added: TermCandidate[] = [];
  for (const c of cands) {
    if (prev.has(c.same)) picked.push(c);
    else if (prev.size + added.length < max) {
      picked.push(c);
      added.push(c);
    }
  }
  return { picked, added };
}

// ---- 질의 ----

/** 검색어 하나를 한 구절로 묶는다. normalizeTerm을 거친 검색어에는 따옴표가 없다 */
const phrase = (term: string) => `"${term}"`;

export function githubQuery(term: string, from: string, to: string): string {
  return `${phrase(term)} is:issue created:${from}..${to}`;
}

export function githubSearchUrl(term: string, from: string, to: string): string {
  return `https://${GITHUB_API_HOST}${GITHUB_ISSUES_PATH}?q=${encodeURIComponent(githubQuery(term, from, to))}&per_page=${COMMUNITY_PAGE_SIZE}`;
}

/** Bluesky: since는 그날 0시(UTC)부터, until은 끝 날짜 다음 날 0시(UTC) 전까지. lang은 주지 않는다(검색어가 이미 언어를 가른다) */
export function blueskySearchUrl(term: string, from: string, to: string): string {
  return `https://${BLUESKY_API_HOST}${BLUESKY_SEARCH_PATH}?q=${encodeURIComponent(phrase(term))}&sort=latest&since=${from}&until=${addDays(to, 1)}&limit=${COMMUNITY_PAGE_SIZE}`;
}

// ---- 받기 ----

export interface CommunitySourceReport {
  status: CommunityStatus;
  reason: CommunityReason | null;
  /** 이 소스로 볼 검색어 수 */
  terms: number;
  /** robots를 포함한 요청 수 */
  calls: number;
  robotsCalls: number;
  /** 받은 검색어 × 창(앞 실행 포함)과 받지 못한 것 */
  received: number;
  missing: number;
  rising: number;
  /** 쏠림으로 오름에서 뺀 수 */
  concentrated: number;
  capHits: number;
  elapsedMs: number;
}

export interface CommunityReport {
  target: string;
  terms: number;
  sources: Record<string, CommunitySourceReport>;
  elapsedMs: number;
  /** 공식 단위 세기에 걸린 시간 */
  unitsMs: number;
  hitDeadline: boolean;
  /** 막힘·받지 못함이 3일 이상 이어진 소스 */
  streaks: { source: string; days: number }[];
}

export interface CommunityRunOptions {
  db: DatabaseSync;
  target: string;
  /** KST 오늘(공식 단위 세기) */
  today: string;
  units?: Omit<UnitsOptions, "target">;
  http: FetchText;
  now: () => Date;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timer?: (ms: number, signal: AbortSignal) => Promise<void>;
  deadlineMs?: number;
  /** 명령이 시작한 시계 값. 없으면 이 함수를 부른 때 */
  startedMs?: number;
  sources?: readonly CommunitySource[];
  off?: DemandOff;
  /** 시험: 건수를 저장하기 직전에 부른다(쓰기 실패 흉내) */
  beforeWrite?: () => void;
}

export const COMMUNITY_STREAK_DAYS = 3;

/** 소스를 그날 더 받지 않는다 */
class Stop extends Error {
  readonly status: "failed" | "blocked" | "robots";
  readonly reason: CommunityReason | null;
  constructor(status: "failed" | "blocked" | "robots", reason: CommunityReason | null) {
    super(status);
    this.status = status;
    this.reason = reason;
  }
}
class RequestTimeout extends Error {}

type Searched = { kind: "ok"; count: number; capHit: boolean; share: number | null } | { kind: "term" } | { kind: "task" };

const asObj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
function json(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** 첫 쪽에서 가장 많은 식별자의 비율. 식별자는 이 함수 안에서만 쓴다 */
function topShare(ids: unknown[]): number | null {
  if (ids.length === 0) return null;
  const n = new Map<string, number>();
  for (const id of ids) if (typeof id === "string" && id !== "") n.set(id, (n.get(id) ?? 0) + 1);
  return Math.max(0, ...n.values()) / ids.length;
}

function parseSearch(kind: CommunitySource["kind"], text: string, withShare: boolean): Searched | "format" {
  const d = asObj(json(text));
  if (kind === "github-issues") {
    if (d === null || typeof d.total_count !== "number" || typeof d.incomplete_results !== "boolean" || !Array.isArray(d.items)) return "format";
    if (d.incomplete_results) return { kind: "task" };
    return { kind: "ok", count: d.total_count, capHit: false, share: withShare ? topShare(d.items.map((x) => asObj(x)?.repository_url)) : null };
  }
  if (d === null || !Array.isArray(d.posts)) return "format";
  if (typeof d.hitsTotal !== "number") return { kind: "task" };
  return { kind: "ok", count: d.hitsTotal, capHit: d.hitsTotal >= BLUESKY_HITS_CAP, share: withShare ? topShare(d.posts.map((p) => asObj(asObj(p)?.author)?.did)) : null };
}

const hasRateHeaders = (res: FetchResult) => res.headers?.["x-ratelimit-remaining"] === "0" || res.headers?.["retry-after"] !== undefined;

export function emptyReport(status: CommunityStatus = "noterms"): CommunitySourceReport {
  return { status, reason: null, terms: 0, calls: 0, robotsCalls: 0, received: 0, missing: 0, rising: 0, concentrated: 0, capHits: 0, elapsedMs: 0 };
}

/** 커뮤니티 받기를 한 번 돈다. 소스의 실패는 상태로 남기고, 전용 DB 쓰기 실패만 밖으로 낸다(두 소스가 끝난 뒤) */
export async function runCommunity(o: CommunityRunOptions): Promise<CommunityReport> {
  const { db, target } = o;
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => delay(ms));
  const timer = o.timer ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const started = o.startedMs ?? clock();
  const deadline = started + (o.deadlineMs ?? COMMUNITY_DEADLINE_MS);
  const sources = o.sources ?? communitySources();
  const off = o.off ?? DEFAULT_DEMAND_OFF;
  const stamp = () => kstIso(o.now());
  const reports: Record<string, CommunitySourceReport> = {};
  const on: CommunitySource[] = [];
  for (const s of sources) {
    if (isDemandOff(s, off)) {
      reports[s.id] = emptyReport("off");
      setCommunityStatus(db, target, s.id, "off", null, stamp());
    } else on.push(s);
  }
  const finish = (picked: TermCandidate[], unitsMs: number, hitDeadline: boolean): CommunityReport => {
    const read = readCommunityUnits(db, target, sources);
    const wanted = new Set(picked.map((c) => c.unit.key));
    for (const s of on) {
      const r = reports[s.id]!;
      const units = read.units.filter((u) => u.source === s.id && wanted.has(u.officialKey));
      r.rising = units.filter((u) => u.judgement.rising).length;
      r.concentrated = units.filter((u) => u.judgement.passes && u.judgement.concentrated).length;
      r.capHits = read.capped.filter((k) => picked.some((c) => k === communityUnitKey(s.id, c.unit.key))).length;
    }
    const streaks: CommunityReport["streaks"] = [];
    for (const s of on) {
      const days = communityStreak(db, s.id, target);
      if (days >= COMMUNITY_STREAK_DAYS) streaks.push({ source: s.id, days });
    }
    return { target, terms: picked.length, sources: reports, elapsedMs: clock() - started, unitsMs, hitDeadline, streaks };
  };
  if (on.length === 0) return finish([], 0, false);

  // 공식 단위 세기(4.1-1과 같은 규칙). 실패하면 그날 받지 못함(일시적)으로 두고 다음 실행이 다시 한다
  // 같은 대상 날짜에 이미 고른 검색어(다시 돌 때 그대로 쓰고, 처음 묶은 단위에 묶는다)
  const previous = selectedTerms(db, target);
  let cands: TermCandidate[];
  try {
    // 검색어를 내는 종류의 소스만 센다(상위 자르기는 소스마다라 결과는 같다)
    const termSources = (o.units?.sources ?? officialSources()).filter((s) => TERM_KINDS.includes(s.kind));
    const pinned = new Map(previous.map((t) => [sameKey(t.term), t.unitKey] as const));
    cands = termCandidates(officialUnits(db, o.today, { ...o.units, target, sources: termSources }).sources, target, pinned);
  } catch {
    for (const s of on) {
      reports[s.id] = { ...emptyReport("failed"), reason: "units" };
      setCommunityStatus(db, target, s.id, "failed", "units", stamp());
    }
    return finish([], clock() - started, false);
  }
  const unitsMs = clock() - started;
  const { picked, added } = pickTerms(cands, previous.map((t) => t.term));
  if (added.length > 0) inTransaction(db, () => added.forEach((c) => addTerm(db, target, c.term, c.unit.key, stamp())));
  if (picked.length === 0) {
    for (const s of on) {
      reports[s.id] = emptyReport("noterms");
      setCommunityStatus(db, target, s.id, "noterms", null, stamp());
    }
    return finish(picked, unitsMs, false);
  }

  let hitDeadline = false;
  const runSource = async (s: CommunitySource) => {
    const t0 = clock();
    const r = (reports[s.id] = { ...emptyReport("ok"), terms: picked.length });
    const tasks = picked.flatMap((c) => [
      { c, kind: "recent" as const, from: c.window.recentFrom, to: c.window.recentTo },
      { c, kind: "base" as const, from: c.window.baseFrom, to: c.window.baseTo },
    ]);
    // 받은 창: 처음에 DB에 있던 것과 이번에 쓴 것(hasCount와 같은 키: 검색어와 창)
    const keyOf = (t: (typeof tasks)[number]) => `${t.c.term}\0${t.from}\0${t.to}`;
    const storedKeys = new Set(tasks.filter((t) => hasCount(db, target, s.id, t.c.term, t.from, t.to)).map(keyOf));
    const gapMs = s.kind === "github-issues" ? SEARCH_GAP_MS : BLUESKY_GAP_MS;
    let lastSearch: number | null = null;
    let rateDelay = 0;

    const get = async (url: string, search: boolean): Promise<FetchResult> => {
      const gap = search && lastSearch !== null ? Math.max(0, lastSearch + gapMs - clock()) : 0;
      const wait = Math.max(gap, rateDelay);
      if (clock() + wait + COMMUNITY_REQUEST_TIMEOUT_MS > deadline) {
        if (rateDelay > gap) throw new Stop("failed", "rate");
        hitDeadline = true;
        throw new Stop("failed", "deadline");
      }
      rateDelay = 0;
      if (wait > 0) await sleep(wait);
      if (search) lastSearch = clock();
      r.calls++;
      if (!search) r.robotsCalls++;
      const ac = new AbortController();
      const timedOut = timer(COMMUNITY_REQUEST_TIMEOUT_MS, ac.signal).then((): never => {
        throw new RequestTimeout();
      });
      try {
        return await Promise.race([o.http(url, { signal: ac.signal, headers: { accept: s.kind === "github-issues" ? GITHUB_JSON : "application/json" } }), timedOut]);
      } finally {
        ac.abort();
      }
    };

    const robots = async (): Promise<void> => {
      for (let attempt = 0; ; attempt++) {
        const last = attempt >= 1;
        let res: FetchResult;
        try {
          res = await get(`https://${s.host}/robots.txt`, false);
        } catch (e) {
          if (e instanceof Stop) throw e;
          if (last) throw new Stop("failed", "robotsFetch");
          continue;
        }
        if (res.status === 404) return;
        if (res.status === 200) {
          let blocked: boolean;
          try {
            blocked = robotsBlocks(res.text, [s.path]);
          } catch {
            throw new Stop("failed", "robotsFetch");
          }
          if (blocked) throw new Stop("robots", null);
          return;
        }
        if (last || (res.status < 500 && res.status !== 429)) throw new Stop("failed", "robotsFetch");
      }
    };

    /** 한 번 다시 하기(S3): 429·5xx·한도 헤더가 있는 403·연결 실패·시간 초과·형식 오류 */
    const search = async (url: string, withShare: boolean): Promise<Searched> => {
      for (let attempt = 0; ; attempt++) {
        const last = attempt >= 1;
        let res: FetchResult;
        try {
          res = await get(url, true);
        } catch (e) {
          if (e instanceof Stop) throw e;
          if (last) throw new Stop("failed", e instanceof RequestTimeout || (e as Error).name === "TimeoutError" ? "timeout" : "network");
          continue;
        }
        const st = res.status;
        if (st === 200) {
          const p = parseSearch(s.kind, res.text, withShare);
          if (p !== "format") return p;
          if (last) throw new Stop("failed", "format");
          continue;
        }
        if (st === 429 || st >= 500 || (st === 403 && hasRateHeaders(res))) {
          if (last) throw new Stop("failed", st >= 500 ? "server" : "rate");
          if (st < 500) rateDelay = rateWait(res, clock());
          continue;
        }
        if (st === 401) throw new Stop("blocked", "auth");
        if (st === 403) throw new Stop("blocked", "forbidden");
        if ((s.kind === "github-issues" && st === 422) || (s.kind === "bluesky-posts" && st === 400)) return { kind: "term" };
        throw new Stop("failed", "http");
      }
    };

    let stop: Stop | null = null;
    const todo = tasks.filter((t) => !storedKeys.has(keyOf(t)));
    if (todo.length > 0) {
      try {
        // robots는 그 소스의 첫 검색 직전에 본다(받을 것이 없으면 받지 않는다)
        await robots();
        const skipped = new Set<string>();
        for (const t of todo) {
          if (skipped.has(t.c.same)) continue;
          const url = s.kind === "github-issues" ? githubSearchUrl(t.c.term, t.from, t.to) : blueskySearchUrl(t.c.term, t.from, t.to);
          const got = await search(url, t.kind === "recent");
          if (got.kind !== "ok") {
            // 질의 오류는 그 검색어를, 불완전 응답은 그 창을 받지 못함으로 둔다. 최근 창이 없으면 앞 창도 쓸 데가 없다
            if (got.kind === "term" || t.kind === "recent") skipped.add(t.c.same);
            continue;
          }
          o.beforeWrite?.();
          addCount(db, { target, source: s.id, term: t.c.term, unitKey: t.c.unit.key, kind: t.kind, from: t.from, to: t.to, count: got.count, capHit: got.capHit, share: got.share, fetchedAt: stamp() });
          storedKeys.add(keyOf(t));
        }
      } catch (e) {
        if (!(e instanceof Stop)) throw e;
        stop = e;
      }
    }
    r.received = tasks.filter((t) => storedKeys.has(keyOf(t))).length;
    r.missing = tasks.length - r.received;
    if (stop !== null && stop.status !== "failed") {
      r.status = stop.status;
      r.reason = stop.reason;
    } else if (r.missing === 0) r.status = "ok";
    else {
      r.reason = stop?.reason ?? "query";
      r.status = r.received > 0 ? "partial" : "failed";
    }
    setCommunityStatus(db, target, s.id, r.status, r.reason, stamp());
    r.elapsedMs = clock() - t0;
  };
  // 두 소스는 서로를 기다리지 않는다(나란히 받는다). 한 소스가 DB 쓰기에서 실패해도 다른 소스가 끝난 뒤 낸다
  const settled = await Promise.allSettled(on.map(runSource));
  const crashed = settled.find((x) => x.status === "rejected");
  if (crashed !== undefined) throw crashed.reason;
  return finish(picked, unitsMs, hitDeadline);
}

// ---- 출력 ----

export type CommunityLineInput = Pick<CommunityReport, "terms" | "sources" | "elapsedMs" | "streaks"> & { target: string | null };

const LABELS = new Map(communitySources().map((s) => [s.id, s.label]));
const labelOf = (id: string) => LABELS.get(id) ?? id;

/** 커뮤니티 받기의 출력·요약 줄(4.4-3). 검색어와 응답은 넣지 않는다 */
export function communityLines(r: CommunityLineInput): string[] {
  const lines = [`- 커뮤니티 신호${r.target === null ? "" : `(${r.target})`}: 검색어 ${r.terms}개, 걸린 시간 ${Math.round(r.elapsedMs / 1000)}초`];
  for (const [id, s] of Object.entries(r.sources)) {
    const why = s.reason === null ? "" : `(${COMMUNITY_REASON_NAMES[s.reason]})`;
    lines.push(`  - ${labelOf(id)}: ${COMMUNITY_STATUS_NAMES[s.status]}${why}. 검색어 ${s.terms}개, 호출 ${s.calls}번(robots ${s.robotsCalls}번), 받은 창 ${s.received}, 받지 못한 창 ${s.missing}, 오른 단위 ${s.rising}, 쏠림으로 뺌 ${s.concentrated}, 상한 닿음 ${s.capHits}, 걸린 시간 ${Math.round(s.elapsedMs / 1000)}초`);
  }
  if (r.streaks.length > 0) lines.push(`  - 커뮤니티 소스 막힘·받지 못함이 ${COMMUNITY_STREAK_DAYS}일 이상 이어졌다: ${r.streaks.map((s) => `${labelOf(s.source)} ${s.days}일`).join(", ")}(운영 문서의 "수요 흐름"을 본다)`);
  return lines;
}
