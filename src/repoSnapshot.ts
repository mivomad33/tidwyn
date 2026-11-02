import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { checkBody, fail, failureReason, readJson } from "./builderFetch.ts";
import { GITHUB_JSON, REPO_MAX_PAGES, REPO_PER_PAGE, REPO_PUSHED_DAYS, repoSearchUrl } from "./builderSources.ts";
import { addSnapshotUsage, beginSnapshot, completeSnapshot, markSnapshotShort, pruneSnapshots, saveSnapshotRows, setSnapshotCursor, snapshotRowCount, snapshotRun, type SnapshotRow, type SnapshotState } from "./discoverStore.ts";
import type { FetchResult, FetchText } from "./feeds.ts";
import { inTransaction } from "./issues.ts";
import { addDays } from "./kst.ts";

// 9.9단계 4.1-1, 4.1-2: 범위의 저장소 별 수를 GitHub 검색으로 받는다. 토큰 없이 분당 10회라 간격을 두고, 페이지마다 저장해 다시 부르면 이어 받는다.
// 별 많은 순으로 받아 쿼리 하나의 1,000건 제한에 닿으면 마지막 별 수를 다음 쿼리의 상한으로 쓴다(경계의 같은 저장소는 저장에서 합쳐진다).

/** 한 번 호출의 시간 상한(4.1-1) */
export const SNAPSHOT_DEADLINE_MS = 9 * 60_000;
/** 호출 사이 간격 */
export const SEARCH_GAP_MS = 6200;
/** 호출 하나가 걸릴 수 있는 시간. 이만큼 남지 않으면 새 호출을 하지 않는다 */
const CALL_MARGIN_MS = 30_000;
/** 호출 하나의 재시도 상한(403, 429, 서버 오류, 시간 초과) */
const MAX_RETRIES = 3;
/** incomplete_results의 재시도 상한 */
const MAX_INCOMPLETE_RETRIES = 2;
/** 대기 시간을 알 수 없는 한도 응답의 대기 */
const DEFAULT_RATE_WAIT_MS = 60_000;
/** 설명은 재료로 다듬기 전에도 이 길이까지만 둔다 */
const DESCRIPTION_MAX = 1000;
const REPO_NAME_RE = /^[\w.-]+\/[\w.-]+$/;

export interface SnapshotOptions {
  db: DatabaseSync;
  http: FetchText;
  target: string;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  deadlineMs?: number;
}

export interface SnapshotResult {
  status: SnapshotState;
  repos: number;
  /** 이어 받기까지 더한 값 */
  calls: number;
  elapsedMs: number;
  /** 이번 호출에서 끝나지 않은 이유 */
  reason?: string;
}

/** 시간 상한에 닿았다. 받은 자리는 남아 있고 다시 부르면 이어 받는다 */
class OutOfTime extends Error {}

interface SearchItem {
  full_name?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  description?: unknown;
  language?: unknown;
  license?: { spdx_id?: unknown; name?: unknown } | null;
  pushed_at?: unknown;
  created_at?: unknown;
  fork?: unknown;
  archived?: unknown;
}

interface SearchPage {
  total: number;
  items: SearchItem[];
}

const text = (v: unknown) => (typeof v === "string" ? v : null);

function toRow(x: SearchItem): SnapshotRow {
  const name = x.full_name;
  if (typeof name !== "string" || !REPO_NAME_RE.test(name) || typeof x.stargazers_count !== "number" || typeof x.pushed_at !== "string" || typeof x.created_at !== "string") fail("검색 응답의 저장소 형식이 맞지 않다");
  return {
    repo: name.toLowerCase(),
    name,
    stars: x.stargazers_count,
    description: text(x.description)?.slice(0, DESCRIPTION_MAX) ?? null,
    language: text(x.language),
    license: text(x.license?.spdx_id) ?? text(x.license?.name),
    pushedAt: x.pushed_at,
    forks: typeof x.forks_count === "number" ? x.forks_count : 0,
    createdAt: x.created_at,
  };
}

function parsePage(res: FetchResult): SearchPage & { incomplete: boolean } {
  checkBody(res.status, res.text);
  const d = readJson(res.text) as { total_count?: unknown; incomplete_results?: unknown; items?: unknown } | null;
  if (typeof d?.total_count !== "number" || typeof d.incomplete_results !== "boolean" || !Array.isArray(d.items)) fail("검색 응답의 형식이 맞지 않다");
  return { total: d.total_count, incomplete: d.incomplete_results, items: d.items as SearchItem[] };
}

/** 한도 응답이 말하는 대기 시간 */
function rateWait(res: FetchResult, now: number): number {
  const after = Number(res.headers?.["retry-after"]);
  if (Number.isFinite(after) && after > 0) return after * 1000;
  const reset = Number(res.headers?.["x-ratelimit-reset"]);
  if (Number.isFinite(reset) && reset > 0) return Math.max(0, reset * 1000 - now);
  return DEFAULT_RATE_WAIT_MS;
}

/** 대상 날짜의 스냅샷을 받는다. 끝났거나 행이 모자랐던 날짜면 호출하지 않는다 */
export async function runSnapshot(o: SnapshotOptions): Promise<SnapshotResult> {
  const { db, http, target } = o;
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => delay(ms));
  const started = clock();
  const deadline = started + (o.deadlineMs ?? SNAPSHOT_DEADLINE_MS);
  pruneSnapshots(db, target);
  const before = lastCompleteRows(db, target);
  const run = beginSnapshot(db, target);
  const result = (reason?: string): SnapshotResult => {
    const r = snapshotRun(db, target)!;
    return { status: r.state, repos: snapshotRowCount(db, target), calls: r.calls, elapsedMs: r.elapsedMs, ...(reason === undefined ? {} : { reason }) };
  };
  if (run.state !== "running") return result(run.state === "short" ? (run.reason ?? undefined) : undefined);

  const pushedSince = addDays(target, -REPO_PUSHED_DAYS);
  let calls = 0;
  // 이어 받으면 앞 호출의 시각을 모르므로 첫 호출도 간격만큼 기다린다
  let lastCall: number | null = run.calls > 0 ? clock() : null;

  const waitFor = async (ms: number) => {
    if (clock() + ms + CALL_MARGIN_MS >= deadline) throw new OutOfTime();
    if (ms > 0) await sleep(ms);
  };

  const call = async (url: string): Promise<FetchResult> => {
    await waitFor(lastCall === null ? 0 : Math.max(0, lastCall + SEARCH_GAP_MS - clock()));
    lastCall = clock();
    calls++;
    return http(url, { headers: { accept: GITHUB_JSON } });
  };

  const fetchPage = async (hi: number | null, page: number): Promise<SearchPage> => {
    const url = repoSearchUrl(hi, pushedSince, page);
    let retries = 0;
    let incomplete = 0;
    const retry = (why: string) => {
      if (++retries > MAX_RETRIES) fail(`재시도 상한을 넘겼다(${why})`);
    };
    for (;;) {
      let res: FetchResult;
      try {
        res = await call(url);
      } catch (e) {
        if (e instanceof OutOfTime) throw e;
        retry(failureReason(e));
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        retry(`HTTP ${res.status}`);
        await waitFor(rateWait(res, clock()));
        continue;
      }
      if (res.status >= 500) {
        retry(`HTTP ${res.status}`);
        continue;
      }
      const parsed = parsePage(res);
      if (!parsed.incomplete) return parsed;
      if (++incomplete > MAX_INCOMPLETE_RETRIES) fail("구간 실패: incomplete_results가 계속 true다");
    }
  };

  const save = (reason: string | null) => {
    addSnapshotUsage(db, target, calls, clock() - started, reason);
    calls = 0;
  };

  let hi = run.nextHi;
  let page = run.nextPage;
  try {
    for (;;) {
      const got = await fetchPage(hi, page);
      const rows = got.items.map(toRow);
      const seen = (page - 1) * REPO_PER_PAGE + got.items.length;
      const ended = got.items.length < REPO_PER_PAGE || seen >= got.total;
      const low = Math.min(...rows.map((r) => r.stars));
      const nextBand = !ended && page === REPO_MAX_PAGES;
      if (nextBand && low === hi) fail("구간 실패: 같은 별 수가 1000건을 넘는다");
      const nextHi = nextBand ? low : hi;
      const nextPage = nextBand ? 1 : page + 1;
      inTransaction(db, () => {
        saveSnapshotRows(db, target, rows.filter((_, i) => got.items[i]!.fork !== true && got.items[i]!.archived !== true));
        setSnapshotCursor(db, target, nextHi, nextPage);
      });
      if (ended) break;
      hi = nextHi;
      page = nextPage;
    }
  } catch (e) {
    const reason = e instanceof OutOfTime ? "시간 상한" : failureReason(e);
    save(reason);
    return result(reason);
  }
  save(null);
  const repos = snapshotRowCount(db, target);
  if (repos === 0 || repos * 2 < before) {
    const reason = `받은 행이 모자란다(${repos}행, 마지막 완성 ${before}행)`;
    markSnapshotShort(db, target, reason);
    return result(reason);
  }
  completeSnapshot(db, target);
  return result();
}

/** 대상 날짜 앞 마지막 완성 스냅샷의 행 수 */
function lastCompleteRows(db: DatabaseSync, target: string): number {
  const r = db.prepare("SELECT snapshot_date AS d FROM repo_snapshot_runs WHERE state = 'complete' AND snapshot_date < ? ORDER BY snapshot_date DESC LIMIT 1").get(target) as { d: string } | undefined;
  return r === undefined ? 0 : snapshotRowCount(db, r.d);
}
