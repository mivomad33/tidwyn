import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { DEFAULT_DEMAND_OFF, DEMAND_GROUPS, MASTODON_CAP, MASTODON_PAGE_SIZE, MASTODON_PARTS, demandSources, googleTrendsUrl, isDemandOff, mastodonTrendsPath, type DemandKind, type DemandOff, type DemandSource } from "./demandSources.ts";
import { SourceFailure, fail as failWith } from "./builderFetch.ts";
import { copyDemandDb, failStreak, hasSnapshot, saveSnapshot, setStatus, statusOf, type SnapshotPart } from "./demandStore.ts";
import { FEED_USER_AGENT, makeFetchText, type FetchResult, type FetchText } from "./feeds.ts";
import { kstDate, kstIso } from "./kst.ts";
import { robotsBlocks } from "./robots.ts";
import type { DemandFetchState } from "./run.ts";

// 9.95단계 4.1~4.3: 수요 소스를 받아 그날(KST) 스냅샷으로 전용 DB에 쌓는다. 받은 글은 출력하지 않는다(4.3-3, 4.4-1).
// 호스트마다 차례로 받고(같은 호스트 요청 사이 2초 이상), 호스트끼리는 동시에 받는다. 리디렉션은 따라가지 않는다.
// 실패 사유는 정해진 종류만 쓴다. 오류 메시지나 응답 조각은 입력 일부를 담을 수 있어 넣지 않는다.

/** 명령 전체 상한(4.1-1). 스킬은 Bash 시간 제한을 이보다 1분 길게 준다 */
export const DEMAND_DEADLINE_MS = 5 * 60_000;
/** 같은 호스트의 요청 사이 간격 */
export const DEMAND_GAP_MS = 2000;
/** 요청 하나의 시간 상한 */
export const DEMAND_REQUEST_TIMEOUT_MS = 20_000;
export { MASTODON_CAP, MASTODON_PAGE_SIZE } from "./demandSources.ts";
/** 받은 칸 중 작성자 칸(S6, 4.1-2). 어느 깊이에서든 이 이름의 칸만 지운다 */
export const AUTHOR_FIELDS: readonly string[] = ["author_name", "author_url", "authors"];

/** 사유 종류 */
export const REASON = {
  googleBlocked: "Google 막힘",
  deadline: "시간 상한",
  timeout: "시간 초과",
  network: "연결 실패",
  format: "형식 오류",
  robotsFormat: "robots 형식 오류",
  robotsFetch: "robots 받지 못함",
} as const;

/** 수요 소스 요청. 시간 상한은 부르는 쪽이 signal로 끊는다. 리디렉션을 따라가지 않는다 */
export const demandFetchText: FetchText = makeFetchText(FEED_USER_AGENT, DEMAND_REQUEST_TIMEOUT_MS + 5000, "manual");

export interface DemandGroupReport {
  total: number;
  /** 그날 스냅샷이 있는 소스(이번 실행에 받은 것 포함) */
  ok: number;
  /** 이번 실행에 받은 소스 */
  okNow: number;
  failed: { label: string; reason: string }[];
  robots: number;
  off: number;
  /** robots 요청을 포함한 요청 수 */
  requests: number;
  robotsRequests: number;
  /** 100건 상한에 닿은 횟수(종류마다 센다) */
  capHits: number;
  /** 이번 실행에 저장한 바이트 */
  bytes: number;
}

export interface DemandReport {
  day: string;
  groups: Record<string, DemandGroupReport>;
  copied: boolean;
  elapsedMs: number;
  /** 연속으로 받지 못한 일수가 3일 이상인 소스 */
  streaks: { source: string; days: number }[];
}

export interface DemandRunOptions {
  db: DatabaseSync;
  dataDir: string;
  /** 명령 전에 전용 DB가 있었는지. 없었으면 사본을 만들지 않는다 */
  dbExisted: boolean;
  http: FetchText;
  now: () => Date;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** 요청 시간 상한의 타이머. signal로 끊기면 reject한다 */
  timer?: (ms: number, signal: AbortSignal) => Promise<void>;
  deadlineMs?: number;
  sources?: readonly DemandSource[];
  off?: DemandOff;
}

export const STREAK_DAYS = 3;

class OutOfTime extends Error {}
class HostBlocked extends Error {}
class RequestTimeout extends Error {}

/** 요청 예외의 사유 */
const requestReason = (e: unknown) => (e instanceof RequestTimeout || (e as Error).name === "TimeoutError" ? REASON.timeout : REASON.network);

/** 요청 하나를 받는 방법 */
interface HostCtx {
  /** 같은 호스트 간격과 시간 상한을 지켜 요청한다 */
  get(url: string): Promise<FetchResult>;
  capHit(): void;
}

type Fetcher = (s: DemandSource, h: HostCtx) => Promise<SnapshotPart[]>;

const encode = (text: string) => Buffer.from(text, "utf8");

/** Google 막힘(S8): 403, 429, 사람 확인 페이지(`/sorry`)로 가는 리디렉션 */
function isGoogleBlocked(res: FetchResult): boolean {
  if (res.status === 403 || res.status === 429) return true;
  return res.status >= 300 && res.status < 400 && /\/sorry(?:\/|\?|$)/.test(res.headers?.location ?? "");
}

/** 요청을 한 번 다시 시도하는 규칙(4.2-3). 막힘, 지원 안 함, 리디렉션, 4xx는 다시 시도하지 않는다 */
async function getChecked(h: HostCtx, url: string, kind: DemandKind, check: (text: string) => void): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 1;
    let res: FetchResult;
    try {
      res = await h.get(url);
    } catch (e) {
      if (e instanceof OutOfTime) throw e;
      if (last) failWith(requestReason(e));
      continue;
    }
    if (kind === "google-trends") {
      if (isGoogleBlocked(res)) throw new HostBlocked();
      if (res.status === 400 || res.status === 404 || (res.status >= 300 && res.status < 400)) failWith(`지원 안 함(HTTP ${res.status})`);
    }
    if (res.status >= 300 && res.status < 500 && res.status !== 429) failWith(`HTTP ${res.status}`);
    if (res.status !== 200) {
      if (last) failWith(`HTTP ${res.status}`);
      continue;
    }
    try {
      check(res.text);
      return res.text;
    } catch {
      if (last) failWith(REASON.format);
    }
  }
}

/** 받은 JSON에서 작성자 칸만 지운다(이름으로만, 어느 깊이에서든). 다른 칸의 값은 그대로 둔다 */
export function dropAuthorFields(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(dropAuthorFields);
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => !AUTHOR_FIELDS.includes(k))
      .map(([k, x]) => [k, dropAuthorFields(x)]),
  );
}

function checkRss(text: string): void {
  if (!/<rss[\s>]/i.test(text) || !/<\/rss>\s*$/i.test(text)) throw new Error("rss");
}

const FETCHERS: Record<DemandKind, Fetcher> = {
  "google-trends": async (s, h) => {
    const url = googleTrendsUrl(s.label);
    const text = await getChecked(h, url, s.kind, checkRss);
    return [{ part: "feed", page: 1, url, body: encode(text) }];
  },
  "mastodon-trends": async (s, h) => {
    const parts: SnapshotPart[] = [];
    for (const part of MASTODON_PARTS) {
      for (let page = 1, seen = 0; ; page++) {
        const url = `https://${s.host}${mastodonTrendsPath(part, seen)}`;
        let items: unknown[] = [];
        await getChecked(h, url, s.kind, (t) => {
          const j = JSON.parse(t) as unknown;
          if (!Array.isArray(j)) throw new Error("array");
          items = j;
        });
        parts.push({ part, page, url, body: encode(JSON.stringify(dropAuthorFields(items))) });
        seen += items.length;
        if (items.length < MASTODON_PAGE_SIZE) break;
        if (seen >= MASTODON_CAP) {
          h.capHit();
          break;
        }
      }
    }
    return parts;
  },
};

function emptyGroup(): DemandGroupReport {
  return { total: 0, ok: 0, okNow: 0, failed: [], robots: 0, off: 0, requests: 0, robotsRequests: 0, capHits: 0, bytes: 0 };
}

/** 묶음 보고서. 목록의 소스 묶음을 모두 담는다(받을 것이 없어도) */
export function emptyGroups(sources: readonly DemandSource[]): Record<string, DemandGroupReport> {
  const groups: Record<string, DemandGroupReport> = {};
  for (const s of sources) (groups[s.group] ??= emptyGroup()).total++;
  return groups;
}

/** 받기를 한 번 돈다. 소스마다 예외를 가두고, 전용 DB 쓰기 실패만 밖으로 낸다 */
export async function runDemandFetch(o: DemandRunOptions): Promise<DemandReport> {
  const { db } = o;
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => delay(ms));
  const timer = o.timer ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const sources = o.sources ?? demandSources();
  const off = o.off ?? DEFAULT_DEMAND_OFF;
  const started = clock();
  const deadline = started + (o.deadlineMs ?? DEMAND_DEADLINE_MS);
  const day = kstDate(o.now());
  const stamp = () => kstIso(o.now());
  const groups = emptyGroups(sources);
  const fail = (s: DemandSource, reason: string) => {
    setStatus(db, s.id, day, "failed", reason, stamp());
    groups[s.group]!.failed.push({ label: s.label, reason });
  };

  // 같은 날 앞 실행에 막힌 호스트(S8): 그날은 그 호스트를 다시 부르지 않는다
  const blockedToday = new Set(sources.filter((s) => statusOf(db, s.id, day)?.reason === REASON.googleBlocked).map((s) => s.host));
  const todo: DemandSource[] = [];
  for (const s of sources) {
    const g = groups[s.group]!;
    if (isDemandOff(s, off)) {
      setStatus(db, s.id, day, "off", null, stamp());
      g.off++;
    } else if (hasSnapshot(db, s.id, day)) g.ok++;
    else if (blockedToday.has(s.host)) fail(s, REASON.googleBlocked);
    else todo.push(s);
  }
  const copied = todo.length > 0 && o.dbExisted;
  if (copied) copyDemandDb(db, o.dataDir, o.now());

  const byHost = Map.groupBy(todo, (s) => s.host);

  const runHost = async (host: string, list: DemandSource[]) => {
    let lastStart: number | null = null;
    let current: DemandGroupReport = groups[list[0]!.group]!;
    const get = async (url: string): Promise<FetchResult> => {
      const wait = lastStart === null ? 0 : Math.max(0, lastStart + DEMAND_GAP_MS - clock());
      if (clock() + wait + DEMAND_REQUEST_TIMEOUT_MS > deadline) throw new OutOfTime();
      if (wait > 0) await sleep(wait);
      lastStart = clock();
      current.requests++;
      const ac = new AbortController();
      const timedOut = timer(DEMAND_REQUEST_TIMEOUT_MS, ac.signal).then((): never => {
        throw new RequestTimeout();
      });
      try {
        return await Promise.race([o.http(url, { signal: ac.signal }), timedOut]);
      } finally {
        ac.abort();
      }
    };
    let stopped: string | null = null;
    const h: HostCtx = { get, capHit: () => current.capHits++ };

    // robots(S7, 4.2-2): 그 실행에서 받을 소스가 있는 호스트만 한 번 받는다
    let robotsText: string | null = null;
    try {
      current.robotsRequests++;
      robotsText = await getRobots(h, host, list[0]!.kind);
    } catch (e) {
      stopped = e instanceof OutOfTime ? REASON.deadline : e instanceof HostBlocked ? REASON.googleBlocked : e instanceof SourceFailure ? e.message : REASON.robotsFetch;
    }
    for (const s of list) {
      current = groups[s.group]!;
      if (stopped !== null) {
        fail(s, stopped);
        continue;
      }
      if (robotsText !== null) {
        let blocked: boolean;
        try {
          blocked = robotsBlocks(robotsText, s.paths);
        } catch {
          fail(s, REASON.robotsFormat);
          continue;
        }
        if (blocked) {
          setStatus(db, s.id, day, "robots", null, stamp());
          current.robots++;
          continue;
        }
      }
      let parts: SnapshotPart[];
      try {
        parts = await FETCHERS[s.kind](s, h);
      } catch (e) {
        if (e instanceof OutOfTime) stopped = REASON.deadline;
        else if (e instanceof HostBlocked) stopped = REASON.googleBlocked;
        fail(s, stopped ?? (e instanceof SourceFailure ? e.message : REASON.network));
        continue;
      }
      current.bytes += saveSnapshot(db, { source: s.id, group: s.group, label: s.label, fetchedOn: day, valueDate: day, fetchedAt: stamp(), parts });
      setStatus(db, s.id, day, "ok", null, stamp());
      current.ok++;
      current.okNow++;
    }
  };
  // 한 호스트가 DB 쓰기에서 실패해도 다른 호스트가 끝날 때까지 기다린 뒤 낸다(닫힌 DB에 쓰지 않게)
  const settled = await Promise.allSettled([...byHost].map(([host, list]) => runHost(host, list)));
  const crashed = settled.find((x) => x.status === "rejected");
  if (crashed !== undefined) throw crashed.reason;

  const streaks: DemandReport["streaks"] = [];
  for (const s of sources) {
    if (isDemandOff(s, off)) continue;
    const days = failStreak(db, s.id, day);
    if (days >= STREAK_DAYS) streaks.push({ source: s.id, days });
  }
  return { day, groups, copied, elapsedMs: clock() - started, streaks };
}

/** robots.txt를 받는다. 404는 막지 않은 것(null), 받지 못하면 robots 받지 못함 */
async function getRobots(h: HostCtx, host: string, kind: DemandKind): Promise<string | null> {
  const url = `https://${host}/robots.txt`;
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 1;
    let res: FetchResult;
    try {
      res = await h.get(url);
    } catch (e) {
      if (e instanceof OutOfTime) throw e;
      if (last) failWith(`${REASON.robotsFetch}(${requestReason(e)})`);
      continue;
    }
    if (kind === "google-trends" && isGoogleBlocked(res)) throw new HostBlocked();
    if (res.status === 404) return null;
    if (res.status === 200) return res.text;
    if (last || (res.status < 500 && res.status !== 429)) failWith(`${REASON.robotsFetch}(HTTP ${res.status})`);
  }
}

/** 받기 결과의 출력 줄. 받은 글은 넣지 않는다(4.3-3) */
export function demandLines(r: Pick<DemandFetchState, "day" | "groups" | "elapsedMs" | "dbBytes" | "streaks">): string[] {
  const lines: string[] = [];
  const label = (id: string) => DEMAND_GROUPS.find((g) => g.id === id)?.label ?? id;
  for (const [id, g] of Object.entries(r.groups)) {
    const failed = g.failed.length === 0 ? "" : `(${g.failed.map((f) => `${f.label}: ${f.reason}`).join(", ")})`;
    lines.push(`- 수요 ${label(id)}: 소스 ${g.total}개 중 받음 ${g.ok}(이번 실행 ${g.okNow}), 받지 못함 ${g.failed.length}${failed}, robots 막힘 ${g.robots}, 꺼짐 ${g.off}. 요청 ${g.requests}번(robots ${g.robotsRequests}번), 100건 상한 닿음 ${g.capHits}번, 저장 ${g.bytes}바이트`);
  }
  const size = r.dbBytes === null ? "없음" : `${r.dbBytes}바이트`;
  lines.push(`- 수요 스냅샷(${r.day ?? "-"}): 전용 DB ${size}, 걸린 시간 ${Math.round(r.elapsedMs / 1000)}초`);
  if (r.streaks.length > 0) lines.push(`- 수요 소스 연속 받지 못함(${STREAK_DAYS}일 이상): ${r.streaks.map((s) => `${s.source} ${s.days}일`).join(", ")}`);
  return lines;
}
