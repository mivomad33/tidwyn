import type { DatabaseSync } from "node:sqlite";
import { DAILY_START, INDICATORS, MONTHLY_START, REFETCH_DAYS, type IndicatorDef } from "./indicators.ts";
import { firstValueDate, lastValueDate, replaceValues, upsertValues, valueCount, type IndicatorValue } from "./indicatorStore.ts";
import { addDays } from "./kst.ts";
import { maskSecrets, type Keys } from "./keys.ts";

// 6단계 4.2: 지표 받기. 공식 API(ECOS, FRED)만 https로 부른다. Claude는 값을 찾거나 고치지 않는다.
// 지표 하나가 실패해도 그 값은 그대로 두고 나머지를 받는다(X9-②). 오류 글의 키 값은 가린다(4.8-1).
// ECOS는 한 요청 최대 100,000행(2026-10-29 ERROR-301 응답으로 확인), FRED는 최대 100,000개(series/observations 문서).

export interface HttpResponse {
  status: number;
  body: string;
}
export type HttpJson = (url: string) => Promise<HttpResponse>;

const TIMEOUT_MS = 30_000;

export const fetchHttp: HttpJson = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
  return { status: r.status, body: await r.text() };
};

export interface FetchOptions {
  http: HttpJson;
  keys: Keys;
  /** 오늘(KST 날짜). 받는 범위의 끝 */
  today: string;
  /** 다시 시도 사이 간격(밀리초) */
  retryGapMs?: number;
  /** 다시 시도 횟수(처음 빼고) */
  retries?: number;
}

export type IndicatorFetchOne =
  | { status: "ok"; from: string; to: string; received: number; added: number; changed: number; removed: number; total: number; last: string | null }
  | { status: "failed"; reason: string; keyProblem: boolean; total: number; last: string | null };

export interface IndicatorFetchResult {
  indicators: Record<string, IndicatorFetchOne>;
}

class SourceError extends Error {
  readonly keyProblem: boolean;
  readonly retry: boolean;
  constructor(message: string, keyProblem = false, retry = false) {
    super(message);
    this.keyProblem = keyProblem;
    this.retry = retry;
  }
}

/** 받는 범위(용어 정의). 일별: 값이 없으면 DAILY_START부터, 있으면 마지막 저장 날짜 60일 전부터 오늘까지. 월별: 늘 MONTHLY_START부터 이번 달까지 */
export function fetchRange(db: DatabaseSync, def: IndicatorDef, today: string): { from: string; to: string } {
  if (def.freq === "month") return { from: MONTHLY_START, to: today.slice(0, 7) };
  const last = lastValueDate(db, def.id);
  if (last === null) return { from: DAILY_START, to: today };
  const back = addDays(last, -REFETCH_DAYS);
  return { from: back < DAILY_START ? DAILY_START : back, to: today };
}

const compact = (d: string) => d.replaceAll("-", "");

function parseNumber(raw: unknown): number | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const t = String(raw).trim().replaceAll(",", "");
  if (t === "" || t === ".") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function jsonOf(r: HttpResponse): unknown {
  try {
    return JSON.parse(r.body);
  } catch {
    throw new SourceError(`응답이 JSON이 아니다(HTTP ${r.status})`, false, r.status >= 500 || r.status === 429);
  }
}

async function ecosRows(def: IndicatorDef & { source: { kind: "ecos" } }, range: { from: string; to: string }, o: FetchOptions): Promise<IndicatorValue[]> {
  const key = o.keys.ECOS_API_KEY;
  if (key === null) throw new SourceError("ECOS_API_KEY가 없다", true);
  const { table, cycle, item } = def.source;
  const from = cycle === "D" ? compact(range.from) : compact(range.from).slice(0, 6);
  const to = cycle === "D" ? compact(range.to) : compact(range.to).slice(0, 6);
  const out: IndicatorValue[] = [];
  const page = 100_000;
  for (let start = 1; ; start += page) {
    const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/${start}/${start + page - 1}/${table}/${cycle}/${from}/${to}/${item}`;
    const r = await o.http(url);
    if (r.status === 429 || r.status >= 500) throw new SourceError(`HTTP ${r.status}`, false, true);
    const j = jsonOf(r) as { RESULT?: { CODE?: string; MESSAGE?: string }; StatisticSearch?: { list_total_count?: number; row?: Record<string, unknown>[] } };
    const code = j.RESULT?.CODE;
    if (code === "INFO-200") return out; // 해당하는 데이터가 없다
    if (code !== undefined) {
      const keyProblem = code === "INFO-100" || code === "ERROR-100";
      throw new SourceError(`ECOS ${code}: ${j.RESULT?.MESSAGE ?? ""}`.trim(), keyProblem, code === "ERROR-602" || code.startsWith("ERROR-5"));
    }
    const s = j.StatisticSearch;
    if (s === undefined || !Array.isArray(s.row)) throw new SourceError("ECOS 응답 형식이 맞지 않다(StatisticSearch.row 없음)");
    for (const row of s.row) {
      const time = String(row.TIME ?? "");
      const value = parseNumber(row.DATA_VALUE);
      const date = cycle === "D" && /^\d{8}$/.test(time) ? `${time.slice(0, 4)}-${time.slice(4, 6)}-${time.slice(6, 8)}` : cycle === "M" && /^\d{6}$/.test(time) ? `${time.slice(0, 4)}-${time.slice(4, 6)}` : null;
      if (date === null) throw new SourceError(`ECOS 응답의 날짜 형식이 맞지 않다: ${time}`);
      if (value !== null) out.push({ date, value });
    }
    const total = Number(s.list_total_count ?? s.row.length);
    if (start + page - 1 >= total || s.row.length === 0) return out;
  }
}

async function fredRows(def: IndicatorDef & { source: { kind: "fred" } }, range: { from: string; to: string }, o: FetchOptions): Promise<IndicatorValue[]> {
  const key = o.keys.FRED_API_KEY;
  if (key === null) throw new SourceError("FRED_API_KEY가 없다", true);
  const monthly = def.freq === "month";
  const start = monthly ? `${range.from}-01` : range.from;
  const end = monthly ? `${range.to}-01` : range.to;
  const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${encodeURIComponent(def.source.series)}&api_key=${encodeURIComponent(key)}&file_type=json&observation_start=${start}&observation_end=${end}&limit=100000`;
  const r = await o.http(url);
  if (r.status === 429 || r.status >= 500) throw new SourceError(`HTTP ${r.status}`, false, true);
  const j = jsonOf(r) as { error_code?: number; error_message?: string; observations?: { date?: string; value?: string }[] };
  if (r.status !== 200 || j.error_code !== undefined) {
    const msg = `FRED HTTP ${r.status}: ${j.error_message ?? ""}`.trim();
    throw new SourceError(msg, /api_key/i.test(j.error_message ?? ""));
  }
  if (!Array.isArray(j.observations)) throw new SourceError("FRED 응답 형식이 맞지 않다(observations 없음)");
  const out: IndicatorValue[] = [];
  for (const ob of j.observations) {
    const d = String(ob.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new SourceError(`FRED 응답의 날짜 형식이 맞지 않다: ${d}`);
    const value = parseNumber(ob.value);
    if (value !== null) out.push({ date: monthly ? d.slice(0, 7) : d, value });
  }
  return out;
}

async function rowsOf(def: IndicatorDef, range: { from: string; to: string }, o: FetchOptions): Promise<IndicatorValue[]> {
  const retries = o.retries ?? 2;
  for (let attempt = 0; ; attempt++) {
    try {
      return def.source.kind === "ecos" ? await ecosRows(def as IndicatorDef & { source: { kind: "ecos" } }, range, o) : await fredRows(def as IndicatorDef & { source: { kind: "fred" } }, range, o);
    } catch (e) {
      const retryable = e instanceof SourceError ? e.retry : true; // 네트워크 오류·시간 초과는 다시 시도한다
      if (!retryable || attempt >= retries) throw e;
      await new Promise((res) => setTimeout(res, (o.retryGapMs ?? 2000) * (attempt + 1)));
    }
  }
}

/** 월별 통째 바꾸기 전에 응답이 저장 값을 대신할 만한지 본다. 비었거나, 첫 달이 늦거나, 행 수가 크게 적으면 실패(X9-①) */
function checkMonthly(db: DatabaseSync, def: IndicatorDef, rows: IndicatorValue[]): void {
  if (rows.length === 0) throw new SourceError("월별 응답이 비어 있어 저장 값을 그대로 둔다");
  const stored = valueCount(db, def.id);
  if (stored === 0) return;
  const firstStored = firstValueDate(db, def.id)!;
  const firstNew = rows.map((r) => r.date).sort()[0]!;
  if (firstNew > firstStored) throw new SourceError(`월별 응답의 첫 달(${firstNew})이 저장 값의 첫 달(${firstStored})보다 늦어 저장 값을 그대로 둔다`);
  if (rows.length < Math.floor(stored * 0.9)) throw new SourceError(`월별 응답의 행 수(${rows.length})가 저장 값(${stored})보다 크게 적어 저장 값을 그대로 둔다`);
}

/** 지표 하나를 받아 저장한다 */
export async function fetchIndicator(db: DatabaseSync, def: IndicatorDef, o: FetchOptions): Promise<IndicatorFetchOne> {
  const range = fetchRange(db, def, o.today);
  // 요청 주소에는 인코딩한 키가 들어가므로 그 모양도 가린다
  const secrets = Object.values(o.keys).flatMap((k) => (k === null ? [] : [k, encodeURIComponent(k)]));
  try {
    const rows = await rowsOf(def, range, o);
    const inRange = rows.filter((r) => r.date >= range.from && r.date <= range.to);
    if (def.freq === "month") checkMonthly(db, def, inRange);
    const c = def.freq === "month" ? replaceValues(db, def.id, inRange) : { ...upsertValues(db, def.id, inRange), removed: 0 };
    return { status: "ok", ...range, received: inRange.length, ...c, total: valueCount(db, def.id), last: lastValueDate(db, def.id) };
  } catch (e) {
    const err = e as Error;
    const why = err.name === "TimeoutError" ? "시간 초과" : err.message;
    const keyProblem = e instanceof SourceError && e.keyProblem;
    return { status: "failed", reason: maskSecrets(keyProblem ? `키 확인 필요: ${why}` : why, secrets), keyProblem, total: valueCount(db, def.id), last: lastValueDate(db, def.id) };
  }
}

/** 12개 지표를 차례로 받는다. 하나가 실패해도 계속한다 */
export async function fetchAllIndicators(db: DatabaseSync, o: FetchOptions, gapMs = 300): Promise<IndicatorFetchResult> {
  const result: IndicatorFetchResult = { indicators: {} };
  for (const def of INDICATORS) {
    result.indicators[def.id] = await fetchIndicator(db, def, o);
    if (gapMs > 0) await new Promise((res) => setTimeout(res, gapMs));
  }
  return result;
}
