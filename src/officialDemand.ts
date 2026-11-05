import { setTimeout as delay } from "node:timers/promises";
import type { DatabaseSync } from "node:sqlite";
import { SourceFailure, fail as failWith } from "./builderFetch.ts";
import {
  ACRC_BIGDATA_PATH,
  ACRC_PROPOSAL_PATH,
  ACRC_QNA_PATH,
  DART_LIST_PATH,
  DATA_GO_KR_HOST,
  DEFAULT_DEMAND_OFF,
  DEMAND_GROUPS,
  FTC1372_PATH,
  FTC1372_START,
  OFFICIAL_START,
  SEC_DATA_PATH,
  SEC_HOST,
  SEC_INDEX_PATH,
  WIKIMEDIA_TOP_PATH,
  isDemandOff,
  officialSources,
  type DemandOff,
  type OfficialKind,
  type OfficialSource,
} from "./demandSources.ts";
import { REASON, STREAK_DAYS } from "./demandFetch.ts";
import { addCut, addRequest, copyDemandDb, failStreak, getMeta, lastElapsed, lastValue, requestCount, saveValueSnapshot, setMeta, setStatus, valueDates, type ValuePart } from "./demandStore.ts";
import { FEED_USER_AGENT, type FetchResult, type FetchText } from "./feeds.ts";
import type { KeyName } from "./keys.ts";
import { maskSecrets } from "./keys.ts";
import { addDays, dateRange, kstDate, kstIso, kstYesterday } from "./kst.ts";
import { CONTACT_MAIL, SITE_URL } from "./publicSite.ts";
import { robotsBlocks } from "./robots.ts";

// 9.96단계 4.1~4.4: 공식 기관·공개 데이터(국회, 권익위, 1372, DART, SEC Form D, Wikimedia)를 값 날짜마다 받아 전용 DB에 쌓는다.
// 지난 기간(S2의 시작일부터)의 빠진 값 날짜를 채우고, 9분 안에 끝낸다(S4). 받은 글은 출력하지 않는다(4.4-1).
// 호스트마다 차례로 받고(같은 호스트 요청 사이 1초, SEC 0.2초), 호스트끼리는 동시에 받는다. 민원빅데이터는 2분 간격이라 따로 돈다.
// 실패 사유는 정해진 종류만 쓴다. 오류 메시지나 응답 조각은 입력 일부를 담을 수 있어 넣지 않는다.

/** 같은 실행 기록으로 받는 호출 수(S4). 그 뒤 호출은 받지 않는다 */
export const OFFICIAL_MAX_CALLS = 2;
/** 명령 한 번의 상한(S4). 스킬은 Bash 시간 제한을 이보다 1분 길게 주고, 상한에 닿아 남은 것이 있으면 한 번 더 부른다 */
export const OFFICIAL_DEADLINE_MS = 9 * 60_000;
export const OFFICIAL_GAP_MS = 1000;
/** SEC는 초당 10회 이하를 요구한다. 그 절반으로 둔다(4.2-4) */
export const SEC_GAP_MS = 200;
/** 민원빅데이터는 같은 키의 요청 사이 약 2분을 요구한다(source-terms.md) */
export const BIGDATA_GAP_MS = 120_000;
export const OFFICIAL_REQUEST_TIMEOUT_MS = 60_000;
/** 응답 하나의 크기 상한. 1372 1000건 페이지(약 0.75MB)와 SEC 일별 인덱스(약 1.3MB)보다 크게 둔다 */
export const OFFICIAL_MAX_BYTES = 16 * 1024 * 1024;
/** 하루 한도의 이 비율에 닿으면 그날 그 소스를 더 부르지 않는다 */
export const QUOTA_RATIO = 0.9;
/** 한 소스에서 값 날짜가 이만큼 잇달아 실패하면 그 호출에서는 그 소스를 더 받지 않는다(일시 장애 때 시간을 아낀다) */
export const MAX_UNIT_FAILURES = 3;
/** 같은 값 날짜가 이만큼의 실행에서 상한에 끊기면 받지 못함(4.3-3) */
export const CUT_RUNS = 3;
/** 연락처가 든 User-Agent(S9). SEC와 Wikimedia가 요구한다 */
export const PUBLIC_USER_AGENT = `tidwyn/1.5 (+${SITE_URL}; ${CONTACT_MAIL})`;

/** 받을 때 버리는 칸(2.2, S11). JSON은 칸 이름으로 어느 깊이에서든, SEC는 XML 요소로 지운다 */
export const DROP_FIELDS: Record<OfficialKind, readonly string[]> = {
  assembly: ["PTTR_NM", "PROPOSER"],
  "acrc-qna": [],
  "acrc-proposal": ["peterName"],
  "acrc-bigdata": [],
  "ftc-1372": [],
  dart: ["flr_nm"],
  "sec-formd": ["relatedPersonsList", "signatureName", "nameOfSigner", "signatureTitle", "salesCompensationList", "issuerPhoneNumber", "street1", "street2", "zipCode"],
  wikimedia: [],
};

export const OFFICIAL_REASON = {
  ...REASON,
  noKey: "키 없음",
  keyRejected: "키 거부",
  limit: "한도",
  size: "크기 상한",
  unexpected: "처리 오류",
} as const;

/** 받는 쪽 요청. 리디렉션을 따라가지 않고, 크기 상한을 넘으면 읽기를 멈추고 예외를 낸다 */
export function makeOfficialFetch(userAgent: string): FetchText {
  return async (url, init) => {
    const timeout = AbortSignal.timeout(OFFICIAL_REQUEST_TIMEOUT_MS + 5000);
    const signal = init?.signal === undefined ? timeout : AbortSignal.any([timeout, init.signal]);
    const res = await fetch(url, { ...init, headers: { "user-agent": userAgent, ...init?.headers }, redirect: "manual", signal });
    const chunks: Uint8Array[] = [];
    let n = 0;
    if (res.body !== null) {
      for await (const c of res.body as AsyncIterable<Uint8Array>) {
        n += c.byteLength;
        if (n > OFFICIAL_MAX_BYTES) {
          await res.body.cancel().catch(() => undefined);
          throw new TooLarge();
        }
        chunks.push(c);
      }
    }
    return { status: res.status, text: Buffer.concat(chunks).toString("utf8"), headers: Object.fromEntries(res.headers) };
  };
}

/** User-Agent는 요청마다 headers로 정한다(S9). 여기 것은 기본값이다 */
export const officialFetchText: FetchText = makeOfficialFetch(FEED_USER_AGENT);

export class TooLarge extends Error {}
class OutOfTime extends Error {}
class QuotaReached extends Error {}
class RequestTimeout extends Error {}
/** 한도·간격 초과나 키 거부: 그 실행에서 그 소스(키 거부면 그 범위)를 멈춘다. 다시 시도하지 않는다 */
class Stop extends Error {
  readonly reason: string;
  readonly byKey: boolean;
  constructor(reason: string, byKey: boolean) {
    super(reason);
    this.reason = reason;
    this.byKey = byKey;
  }
}

export interface OfficialGroupReport {
  total: number;
  /** 그날 받음이거나 받을 것이 없던 소스 */
  ok: number;
  failed: { label: string; reason: string }[];
  robots: number;
  off: number;
  /** 키 없음(받지 못함에도 들어간다) */
  noKey: number;
  /** robots 요청을 포함한 요청 수 */
  requests: number;
  robotsRequests: number;
  /** 저장한 바이트(압축 뒤)와 압축 전 */
  bytes: number;
  rawBytes: number;
}

export interface OfficialSourceReport {
  label: string;
  group: string;
  /** 이번에 채운 값 날짜 수 */
  filled: number;
  /** 남은 채우기 대상 수 */
  remaining: number;
  requests: number;
  /** 하루 한도 90%에 닿아 멈췄는지 */
  quota: boolean;
  /** 이번에 끝까지 받은 1372 달의 시간(밀리초). 시험 실행의 보고서에 쓴다 */
  unitMs?: number[];
}

export interface OfficialReport {
  day: string;
  groups: Record<string, OfficialGroupReport>;
  sources: Record<string, OfficialSourceReport>;
  copied: boolean;
  elapsedMs: number;
  /** 상한(9분, 1372의 잰 시간) 때문에 남긴 대상이 있는지. 스킬이 한 번 더 부르는 조건이다 */
  hitDeadline: boolean;
  streaks: { source: string; days: number }[];
  /** 이 실행에서 받지 못함인 소스와 사유(뒤 호출이 덮지 않는다) */
  failed: Record<string, string>;
  /** 이 실행에서 멈춘 범위(소스 id나 키 범위)와 사유. 뒤 호출에도 이어진다 */
  stops: Record<string, string>;
  /** 이 실행에서 차례가 온 소스와 robots에 막힌 소스(상태를 남긴다) */
  attempted: string[];
  /** 이 실행에서 받지 못한 값 날짜. 같은 실행의 뒤 호출은 다시 받지 않는다(다음 실행이 받는다) */
  failedUnits: Record<string, string[]>;
  robotsBlocked: string[];
}

export interface OfficialRunOptions {
  db: DatabaseSync;
  dataDir: string;
  /** 실행 기록 이름. 상한에 끊긴 값 날짜를 실행마다 센다 */
  runId: string;
  /** 이 호출이 실행 전 사본을 만들어도 되는지(그 실행에서 아직 만들지 않았고 전용 DB가 있었는지) */
  mayCopy: boolean;
  /** 요청. User-Agent는 init.headers로 넘긴다(S9) */
  http: FetchText;
  now: () => Date;
  keys: Partial<Record<KeyName, string | null>>;
  /** 가릴 키 값 */
  secrets: readonly string[];
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timer?: (ms: number, signal: AbortSignal) => Promise<void>;
  deadlineMs?: number;
  sources?: readonly OfficialSource[];
  off?: DemandOff;
  /** 같은 실행 기록의 앞 호출 결과. 돌려주는 결과는 이것과 합친 것이다(4.3-2, 4.3-3) */
  prior?: Omit<OfficialReport, "day">;
  /** 시험 전용(9.97단계 4.6-6): 소스 id나 묶음마다 채우기 시작일(1372는 그 달). 없으면 S2·S6의 기본값 */
  starts?: Readonly<Record<string, string>>;
}

/** 소스의 채우기 시작일. 시험 전용 값이 있으면 그것(소스 id가 묶음보다 앞선다) */
export function startOf(s: OfficialSource, starts: OfficialRunOptions["starts"]): string {
  const v = starts?.[s.id] ?? starts?.[s.group];
  if (s.kind === "ftc-1372") return v === undefined ? FTC1372_START : v.slice(0, 7);
  return v ?? OFFICIAL_START;
}

/** 받은 JSON에서 이름이 같은 칸을 어느 깊이에서든 지운다. 다른 칸의 값은 그대로 둔다 */
export function dropFields(v: unknown, names: readonly string[]): unknown {
  if (Array.isArray(v)) return v.map((x) => dropFields(x, names));
  if (v === null || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v)
      .filter(([k]) => !names.includes(k))
      .map(([k, x]) => [k, dropFields(x, names)]),
  );
}

function hasField(v: unknown, names: readonly string[]): boolean {
  if (Array.isArray(v)) return v.some((x) => hasField(x, names));
  if (v === null || typeof v !== "object") return false;
  return Object.entries(v).some(([k, x]) => names.includes(k) || hasField(x, names));
}

/** XML에서 그 이름의 요소를 통째로 지운다(이름공간 접두어 포함). 다른 요소는 그대로 둔다 */
export function dropXmlElements(xml: string, names: readonly string[]): string {
  const any = names.join("|");
  return xml
    .replace(new RegExp(`<((?:[\\w.-]+:)?(?:${any}))\\b[^>]*\\/>`, "g"), "")
    .replace(new RegExp(`<((?:[\\w.-]+:)?(?:${any}))\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "g"), "");
}

/** 저장할 바이트: 개인 칸을 버리고 키 값을 가린다(4.1-2, 4.4-3). 버릴 칸이 없으면 원문 그대로다 */
function storeBody(kind: OfficialKind, text: string, secrets: readonly string[]): Buffer {
  const names = DROP_FIELDS[kind];
  let t = text;
  if (names.length > 0) {
    if (kind === "sec-formd") t = dropXmlElements(t, names);
    else {
      try {
        const j = JSON.parse(t) as unknown;
        if (hasField(j, names)) t = JSON.stringify(dropFields(j, names));
      } catch {
        failWith(OFFICIAL_REASON.format);
      }
    }
  }
  return Buffer.from(maskSecrets(t, secrets), "utf8");
}

const KEY_PARAMS = ["serviceKey", "ServiceKey", "KEY", "crtfc_key"];

/** 저장하는 주소: 키 파라미터를 뺀다(4.4-3) */
export function stripKey(url: string): string {
  const u = new URL(url);
  for (const k of KEY_PARAMS) u.searchParams.delete(k);
  return u.toString();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    failWith(OFFICIAL_REASON.format);
  }
}

const obj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : failWith(OFFICIAL_REASON.format));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : failWith(OFFICIAL_REASON.format));

/**
 * 공공데이터포털 게이트웨이의 오류 XML(모든 서비스 공통). 20·30·31·32는 키 문제(서비스마다 활용신청이 따로라 그 서비스만 멈춘다),
 * 22는 하루 한도 초과다. 그 밖의 오류 XML은 형식 오류
 */
function dataGoKrGateway(text: string): void {
  if (!/<OpenAPI_ServiceResponse|<returnReasonCode>/.test(text)) return;
  dataGoKrStop(/<returnReasonCode>\s*(\d+)\s*</.exec(text)?.[1]);
  failWith(OFFICIAL_REASON.format);
}

/** 공공데이터포털 결과 코드 중 멈출 것: 22는 한도, 20·30·31·32는 키 거부 */
function dataGoKrStop(code: string | undefined): void {
  if (code === "22") throw new Stop(OFFICIAL_REASON.limit, false);
  if (code === "20" || code === "30" || code === "31" || code === "32") throw new Stop(OFFICIAL_REASON.keyRejected, true);
}

/** HTTP 상태의 공통 규칙. 401(키를 쓰는 소스)은 키 거부, 429는 한도. 403은 키 밖의 막힘(SEC의 User-Agent 등)도 있어 받지 못함이다 */
function httpRule(s: OfficialSource, res: FetchResult): void {
  if (res.status === 429) throw new Stop(OFFICIAL_REASON.limit, false);
  if (res.status === 401 && s.key !== null) throw new Stop(OFFICIAL_REASON.keyRejected, true);
  if (res.status >= 300 && res.status < 500) failWith(`HTTP ${res.status}`);
}

interface Lane {
  /** 요청 하나. 같은 호스트 간격, 하루 한도, 시간 상한, 크기 상한을 지킨다 */
  get(s: OfficialSource, url: string): Promise<FetchResult>;
}

/** 일시 오류(5xx, 시간 초과, 연결 실패)는 한 번 다시 시도한다. 한도·키 응답과 4xx는 다시 시도하지 않는다 */
async function getOk(lane: Lane, s: OfficialSource, url: string, accept: (res: FetchResult) => boolean = (r) => r.status === 200): Promise<FetchResult> {
  for (let attempt = 0; ; attempt++) {
    const last = attempt >= 1;
    let res: FetchResult;
    try {
      res = await lane.get(s, url);
    } catch (e) {
      if (e instanceof OutOfTime || e instanceof QuotaReached || e instanceof Stop || e instanceof SourceFailure) throw e;
      if (e instanceof TooLarge) failWith(OFFICIAL_REASON.size);
      if (last) failWith(e instanceof RequestTimeout || (e as Error).name === "TimeoutError" ? OFFICIAL_REASON.timeout : OFFICIAL_REASON.network);
      continue;
    }
    if (s.host === DATA_GO_KR_HOST && res.status === 200) dataGoKrGateway(res.text);
    if (accept(res)) return res;
    if (res.status >= 500) {
      if (last) failWith(`HTTP ${res.status}`);
      continue;
    }
    httpRule(s, res);
    failWith(`HTTP ${res.status}`);
  }
}

/** 받은 값 날짜 하나 */
type UnitResult = { kind: "saved"; parts: ValuePart[]; items: number; total: number | null } | { kind: "notyet" };

interface Unit {
  valueDate: string;
  /** 요청 없이 정해진 결과(SEC 주말의 받음(0건) 등) */
  fixed?: UnitResult;
}

interface FetchCtx {
  lane: Lane;
  key: string;
  secrets: readonly string[];
  /** 그 소스의 받을 수 있는 마지막 값 날짜 */
  lastDate: string;
}

const enc = encodeURIComponent;
const compact = (d: string) => d.replaceAll("-", "");
const part = (s: OfficialSource, name: string, page: number, url: string, text: string, secrets: readonly string[], absent = false): ValuePart => ({ part: name, page, url: stripKey(url), absent, body: storeBody(s.kind, text, secrets) });

async function fetchAssembly(s: OfficialSource, c: FetchCtx): Promise<UnitResult> {
  const parts: ValuePart[] = [];
  let total = 0;
  let items = 0;
  for (let page = 1; ; page++) {
    const q = new URLSearchParams({ Type: "json", pIndex: String(page), pSize: "100", ...s.query });
    const url = `https://${s.host}/portal/openapi/${s.service}?KEY=${enc(c.key)}&${q}`;
    const res = await getOk(c.lane, s, url);
    const j = obj(parseJson(res.text));
    // 자료가 있으면 {서비스: [{head: [건수, {RESULT}]}, {row}]}, 없거나 오류면 {RESULT}
    const block = j[s.service!];
    const code = String(block === undefined ? obj(j.RESULT).CODE : obj(obj(arr(obj(arr(block)[0]).head)[1]).RESULT).CODE);
    if (code === "INFO-300" || code === "ERROR-290") throw new Stop(OFFICIAL_REASON.keyRejected, true);
    if (code === "ERROR-337") throw new Stop(OFFICIAL_REASON.limit, false);
    if (code === "INFO-200") {
      if (page === 1) parts.push(part(s, "list", page, url, res.text, c.secrets));
      break;
    }
    if (code !== "INFO-000") failWith(OFFICIAL_REASON.format);
    const blocks = arr(j[s.service!]);
    total = Number(obj(arr(obj(blocks[0]).head)[0]).list_total_count);
    const rows = arr(obj(blocks[1]).row);
    if (!Number.isFinite(total)) failWith(OFFICIAL_REASON.format);
    parts.push(part(s, "list", page, url, res.text, c.secrets));
    items += rows.length;
    if (items >= total || rows.length === 0) break;
  }
  return { kind: "saved", parts, items, total };
}

/** 질의응답·공개제안 목록과 상세. E03은 0건(목록)이나 자료 없음(상세)이다 */
async function fetchAcrcList(s: OfficialSource, c: FetchCtx, day: string): Promise<UnitResult> {
  const qna = s.kind === "acrc-qna";
  const base = `https://${s.host}${qna ? ACRC_QNA_PATH : ACRC_PROPOSAL_PATH}`;
  // 질의응답의 regTo는 그날을 넣지 않는다(다음 날을 준다). 공개제안은 넣는다(2026-11-04 단발 호출로 확인)
  const regTo = qna ? compact(addDays(day, 1)) : compact(day);
  const parts: ValuePart[] = [];
  const rows: Record<string, unknown>[] = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const url = `${base}/${qna ? "PolicyQnaList" : "OpenProposalList"}?serviceKey=${enc(c.key)}&firstIndex=${page}&recordCountPerPage=100&regFrom=${compact(day)}&regTo=${regTo}`;
    const res = await getOk(c.lane, s, url);
    const j = obj(parseJson(res.text));
    parts.push(part(s, "list", page, url, res.text, c.secrets));
    if (j.resultCode === "E03") break;
    if (j.resultCode !== "S00") failWith(OFFICIAL_REASON.format);
    total = Number(j.resultCount);
    const list = arr(j.resultList).map(obj);
    rows.push(...list);
    if (!Number.isFinite(total)) failWith(OFFICIAL_REASON.format);
    if (rows.length >= total || list.length === 0) break;
  }
  let i = 0;
  for (const r of rows) {
    i++;
    const url = qna ? `${base}/PolicyQnaItem?serviceKey=${enc(c.key)}&faqNo=${enc(String(r.faqNo))}&dutySctnNm=${enc(String(r.dutySctnNm))}` : `${base}/OpenProposalItem?serviceKey=${enc(c.key)}&petiNo=${enc(String(r.petiNo))}`;
    const res = await getOk(c.lane, s, url);
    const j = obj(parseJson(res.text));
    if (j.resultCode === "E03") parts.push(part(s, "item", i, url, res.text, c.secrets, true));
    else if (j.resultCode === "S00") parts.push(part(s, "item", i, url, res.text, c.secrets));
    else failWith(OFFICIAL_REASON.format);
  }
  return { kind: "saved", parts, items: rows.length, total };
}

/** 민원빅데이터 오늘의 이슈. 배열이 아닌 JSON은 간격 요구 등 제한 응답이다. 마지막 날짜의 빈 배열은 아직 없음이다 */
async function fetchBigdata(s: OfficialSource, c: FetchCtx, day: string): Promise<UnitResult> {
  const url = `https://${s.host}${ACRC_BIGDATA_PATH}?serviceKey=${enc(c.key)}&searchDate=${compact(day)}&target=pttn,dfpt,saeol&dataType=json`;
  const res = await getOk(c.lane, s, url);
  const j = parseJson(res.text);
  if (!Array.isArray(j)) throw new Stop(OFFICIAL_REASON.limit, false);
  if (j.length === 0 && day >= c.lastDate) return { kind: "notyet" };
  return { kind: "saved", parts: [part(s, "list", 1, url, res.text, c.secrets)], items: j.length, total: j.length };
}

function ftcUrl(s: OfficialSource, key: string, ym: string, page: number, rows: number): string {
  return `https://${s.host}${FTC1372_PATH}?serviceKey=${enc(key)}&pageNo=${page}&numOfRows=${rows}&resultType=json&rcptYm=${ym.replace("-", "")}`;
}

/** 1372 응답의 결과 코드: 00 정상, 03 자료 없음(0건), 22 한도, 20·30·31·32 키 문제 */
function ftcBody(text: string): { total: number; items: unknown[] } {
  const j = obj(parseJson(text));
  const code = String(j.resultCode ?? obj(obj(j.response ?? {}).header ?? {}).resultCode ?? "");
  dataGoKrStop(code);
  if (code === "03") return { total: 0, items: [] };
  if (code !== "00") failWith(OFFICIAL_REASON.format);
  const total = Number(j.totalCount);
  if (!Number.isFinite(total)) failWith(OFFICIAL_REASON.format);
  return { total, items: arr(j.items ?? []) };
}

async function fetch1372(s: OfficialSource, c: FetchCtx, ym: string): Promise<UnitResult> {
  const parts: ValuePart[] = [];
  let total = 0;
  let items = 0;
  for (let page = 1; ; page++) {
    const url = ftcUrl(s, c.key, ym, page, 1000);
    const res = await getOk(c.lane, s, url);
    const b = ftcBody(res.text);
    parts.push(part(s, "list", page, url, res.text, c.secrets));
    if (page === 1) total = b.total;
    items += b.items.length;
    if (items >= total || b.items.length === 0) break;
  }
  return { kind: "saved", parts, items, total };
}

/** DART 공시검색: status 000 정상, 013 0건, 010·011·012·901 키 거부, 020 한도 */
async function fetchDart(s: OfficialSource, c: FetchCtx, day: string): Promise<UnitResult> {
  const parts: ValuePart[] = [];
  let total = 0;
  let items = 0;
  for (let page = 1; ; page++) {
    const url = `https://${s.host}${DART_LIST_PATH}?crtfc_key=${enc(c.key)}&bgn_de=${compact(day)}&end_de=${compact(day)}&page_no=${page}&page_count=100`;
    const res = await getOk(c.lane, s, url);
    const j = obj(parseJson(res.text));
    const st = String(j.status);
    if (["010", "011", "012", "901"].includes(st)) throw new Stop(OFFICIAL_REASON.keyRejected, true);
    if (st === "020") throw new Stop(OFFICIAL_REASON.limit, false);
    parts.push(part(s, "list", page, url, res.text, c.secrets));
    if (st === "013") break;
    if (st !== "000") failWith(OFFICIAL_REASON.format);
    total = Number(j.total_count);
    const list = arr(j.list);
    items += list.length;
    const pages = Number(j.total_page);
    if (!Number.isFinite(total) || !Number.isFinite(pages)) failWith(OFFICIAL_REASON.format);
    if (page >= pages || list.length === 0) break;
  }
  return { kind: "saved", parts, items, total };
}

const quarterOf = (d: string) => `${d.slice(0, 4)}/QTR${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;

/** SEC 일별 인덱스에서 머리 줄과 `D`·`D/A` 줄만 남긴다(4.1-1). 고른 줄 안은 고치지 않는다 */
export function pickFormD(idx: string): { text: string; lines: string[] } {
  const all = idx.split("\n");
  const head = all.findIndex((l) => /^-{20,}\s*$/.test(l));
  if (head < 0) failWith(OFFICIAL_REASON.format);
  const lines = all.slice(head + 1).filter((l) => /^(?:D|D\/A)\s{2,}\S/.test(l));
  return { text: [...all.slice(0, head + 1), ...lines].join("\n") + "\n", lines };
}

async function fetchSec(s: OfficialSource, c: FetchCtx, day: string): Promise<UnitResult> {
  const idxUrl = `https://${s.host}${SEC_INDEX_PATH}${quarterOf(day)}/form.${compact(day)}.idx`;
  const res = await getOk(c.lane, s, idxUrl);
  const picked = pickFormD(res.text);
  const parts: ValuePart[] = [{ part: "index", page: 1, url: idxUrl, absent: false, body: Buffer.from(maskSecrets(picked.text, c.secrets), "utf8") }];
  let i = 0;
  for (const line of picked.lines) {
    const m = /edgar\/data\/(\d+)\/(\d{10}-\d{2}-\d{6})\.txt/.exec(line);
    if (!m) failWith(OFFICIAL_REASON.format);
    i++;
    const url = `https://${s.host}${SEC_DATA_PATH}${m[1]}/${m[2]!.replaceAll("-", "")}/primary_doc.xml`;
    // 404는 그 신고에 primary_doc.xml이 없다는 확정이다(자료 없음)
    const doc = await getOk(c.lane, s, url, (r) => r.status === 200 || r.status === 404);
    if (doc.status === 404) parts.push({ part: "doc", page: i, url, absent: true, body: Buffer.alloc(0) });
    else {
      if (!/<edgarSubmission[\s>]/.test(doc.text)) failWith(OFFICIAL_REASON.format);
      parts.push(part(s, "doc", i, url, doc.text, c.secrets));
    }
  }
  return { kind: "saved", parts, items: picked.lines.length, total: picked.lines.length };
}

/** Wikimedia 404를 자료 없음으로 보는, 마지막 날짜에서 지난 일수 */
const WIKI_GAP_DAYS = 7;

async function fetchWikimedia(s: OfficialSource, c: FetchCtx, day: string): Promise<UnitResult> {
  const url = `https://${s.host}${WIKIMEDIA_TOP_PATH}${s.label}/all-access/${day.replaceAll("-", "/")}`;
  const res = await getOk(c.lane, s, url, (r) => r.status === 200 || r.status === 404);
  if (res.status === 404) {
    // 집계가 늦는 날짜와 영영 빠진 날짜를 가른다: 마지막 날짜보다 WIKI_GAP_DAYS 넘게 지난 404는 자료 없음이다
    if (day > addDays(c.lastDate, -WIKI_GAP_DAYS)) return { kind: "notyet" };
    return { kind: "saved", parts: [part(s, "top", 1, url, "", c.secrets, true)], items: 0, total: 0 };
  }
  const j = obj(parseJson(res.text));
  const items = arr(j.items);
  const articles = items.length === 0 ? [] : arr(obj(items[0]).articles);
  return { kind: "saved", parts: [part(s, "top", 1, url, res.text, c.secrets)], items: articles.length, total: articles.length };
}

const UNIT_FETCHERS: Record<OfficialKind, (s: OfficialSource, c: FetchCtx, valueDate: string) => Promise<UnitResult>> = {
  assembly: fetchAssembly,
  "acrc-qna": fetchAcrcList,
  "acrc-proposal": fetchAcrcList,
  "acrc-bigdata": fetchBigdata,
  "ftc-1372": fetch1372,
  dart: fetchDart,
  "sec-formd": fetchSec,
  wikimedia: fetchWikimedia,
};

const monthAdd = (ym: string, n: number) => {
  const d = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const monthRange = (from: string, to: string) => {
  const out: string[] = [];
  for (let m = from; m <= to; m = monthAdd(m, 1)) out.push(m);
  return out;
};
const DAY_MS = 86_400_000;
const daysSince = (iso: string, now: Date) => (now.getTime() - Date.parse(iso)) / DAY_MS;

/** 민원빅데이터의 마지막 요청 시각(밀리초) */
const bigdataKey = (s: OfficialSource) => `${s.id}:last-request`;
/** 1372 건수를 본 시각(S6의 7일에 한 번) */
export const ftcCheckKey = (source: string, ym: string) => `${source}:count-checked:${ym}`;

/** 날짜 단위 소스의 받을 수 있는 마지막 값 날짜. Wikimedia와 SEC는 UTC 날짜로 올라와 UTC 어제, 나머지는 KST 어제다 */
export function lastValueDate(s: OfficialSource, now: Date): string {
  return s.kind === "wikimedia" || s.kind === "sec-formd" ? addDays(now.toISOString().slice(0, 10), -1) : kstYesterday(now);
}

/**
 * 받을 값 날짜를 정한다(4.1-3, S6, S8). SEC와 1372는 요청이 필요해 lane을 쓴다.
 * 남은 채우기 대상은 이 목록에서 받음과 아직 없음을 뺀 것이다
 */
async function planUnits(db: DatabaseSync, s: OfficialSource, lane: Lane, key: string, now: Date, start: string): Promise<{ units: Unit[]; lastDate: string }> {
  const today = kstDate(now);
  const have = valueDates(db, s.id);
  if (s.kind === "assembly") return { units: have.has(today) ? [] : [{ valueDate: today }], lastDate: today };
  if (s.kind === "ftc-1372") {
    const cur = today.slice(0, 7);
    const units: Unit[] = [];
    for (const ym of monthRange(start, cur)) {
      const last = lastValue(db, s.id, ym);
      if (last === null) units.push({ valueDate: ym });
      else if (ym === cur) {
        if (daysSince(last.fetchedAt, now) >= 7) units.push({ valueDate: ym });
      } else if (cur < monthAdd(ym, 3) && daysSince(last.fetchedAt, now) >= 7) {
        const checked = getMeta(db, ftcCheckKey(s.id, ym));
        if (checked !== null && daysSince(checked, now) < 7) continue;
        const res = await getOk(lane, s, ftcUrl(s, key, ym, 1, 1));
        const b = ftcBody(res.text);
        setMeta(db, ftcCheckKey(s.id, ym), kstIso(now));
        if (b.total !== last.total) units.push({ valueDate: ym });
      }
    }
    return { units, lastDate: cur };
  }
  if (s.kind === "sec-formd") {
    const last = lastValueDate(s, now);
    const want = dateRange(start, last).filter((d) => !have.has(d));
    if (want.length === 0) return { units: [], lastDate: last };
    const quarters = [...new Set([...want.map(quarterOf), quarterOf(last)])].sort();
    const available = new Set<string>();
    const listed = new Set<string>();
    for (const q of quarters) {
      const url = `https://${s.host}${SEC_INDEX_PATH}${q}/index.json`;
      let res: FetchResult;
      try {
        res = await getOk(lane, s, url);
      } catch (e) {
        // 새 분기 목록을 받지 못하면 그 분기 날짜는 아직 없음이다(4.1-3)
        if (e instanceof SourceFailure) continue;
        throw e;
      }
      const items = arr(obj(obj(parseJson(res.text)).directory).item);
      listed.add(q);
      for (const it of items) {
        const m = /^form\.(\d{4})(\d{2})(\d{2})\.idx$/.exec(String(obj(it).name));
        if (m) available.add(`${m[1]}-${m[2]}-${m[3]}`);
      }
    }
    const latest = [...available].sort().at(-1) ?? "";
    const units: Unit[] = [];
    for (const d of want) {
      if (!listed.has(quarterOf(d))) continue;
      if (available.has(d)) units.push({ valueDate: d });
      // 인덱스가 없고 뒤 날짜의 인덱스는 있으면(주말·공휴일) 받음(0건). 그 밖에는 아직 없음
      else if (d < latest) units.push({ valueDate: d, fixed: { kind: "saved", parts: [], items: 0, total: 0 } });
    }
    return { units, lastDate: last };
  }
  const last = lastValueDate(s, now);
  return { units: dateRange(start, last).filter((d) => !have.has(d)).map((valueDate) => ({ valueDate })), lastDate: last };
}

function emptyGroup(): OfficialGroupReport {
  return { total: 0, ok: 0, failed: [], robots: 0, off: 0, noKey: 0, requests: 0, robotsRequests: 0, bytes: 0, rawBytes: 0 };
}

export function emptyOfficialGroups(sources: readonly OfficialSource[]): Record<string, OfficialGroupReport> {
  const groups: Record<string, OfficialGroupReport> = {};
  for (const s of sources) (groups[s.group] ??= emptyGroup()).total++;
  return groups;
}

/** 받기를 한 번 돈다. 소스마다 예외를 가두고, 전용 DB 쓰기 실패만 밖으로 낸다 */
export async function runOfficialDemand(o: OfficialRunOptions): Promise<OfficialReport> {
  const { db } = o;
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => delay(ms));
  const timer = o.timer ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const sources = o.sources ?? officialSources();
  const off = o.off ?? DEFAULT_DEMAND_OFF;
  const started = clock();
  const deadline = started + (o.deadlineMs ?? OFFICIAL_DEADLINE_MS);
  const now = o.now();
  const day = kstDate(now);
  const stamp = () => kstIso(o.now());
  const groups = emptyOfficialGroups(sources);
  const reports: Record<string, OfficialSourceReport> = {};
  for (const s of sources) {
    const p = o.prior?.sources[s.id];
    reports[s.id] = { label: s.label, group: s.group, filled: p?.filled ?? 0, remaining: 0, requests: p?.requests ?? 0, quota: p?.quota ?? false, ...(p?.unitMs === undefined ? {} : { unitMs: [...p.unitMs] }) };
  }
  // 앞 호출의 수를 더한다. 상태로 정하는 수(받음, 받지 못함 등)는 끝에서 합친 상태로 다시 센다
  for (const [id, g] of Object.entries(o.prior?.groups ?? {})) {
    const cur = groups[id];
    if (cur === undefined) continue;
    cur.requests += g.requests;
    cur.robotsRequests += g.robotsRequests;
    cur.bytes += g.bytes;
    cur.rawBytes += g.rawBytes;
  }
  const failed: Record<string, string> = { ...o.prior?.failed };
  const stops: Record<string, string> = { ...o.prior?.stops };
  /** 이 실행에서 차례가 왔는지(상태를 남길지). 앞 호출 것을 이어 받는다 */
  const attempted = new Set<string>(o.prior?.attempted);
  const robotsBlocked = new Set<string>(o.prior?.robotsBlocked);
  const failedUnits: Record<string, string[]> = Object.fromEntries(Object.entries(o.prior?.failedUnits ?? {}).map(([k, v]) => [k, [...v]]));
  let hitDeadline = false;
  const stoppedBy = (s: OfficialSource) => stops[s.id] ?? (s.keyScope === null ? undefined : stops[s.keyScope]);
  const markFailed = (s: OfficialSource, reason: string) => {
    failed[s.id] ??= reason;
  };

  const todo: OfficialSource[] = [];
  for (const s of sources) {
    if (isDemandOff(s, off)) continue;
    if (s.key !== null && !o.keys[s.key]) markFailed(s, OFFICIAL_REASON.noKey);
    else if (stoppedBy(s) !== undefined) markFailed(s, stoppedBy(s)!);
    else todo.push(s);
  }

  let copied = false;
  const copyOnce = () => {
    if (copied || !o.mayCopy) return;
    copyDemandDb(db, o.dataDir, o.now());
    copied = true;
  };

  // 같은 호스트의 요청 사이 간격. 여러 줄(민원빅데이터와 나머지)이 함께 쓰므로 시각을 예약한다
  const nextAt = new Map<string, number>();
  const reserve = async (host: string, gap: number) => {
    const at = Math.max(clock(), nextAt.get(host) ?? 0);
    nextAt.set(host, at + gap);
    if (at > clock()) await sleep(at - clock());
  };
  /** 이 호출에서 마지막 민원빅데이터 요청을 보낸 시각(clock). 다시 시도도 2분 뒤에 보낸다(4.2-4) */
  let bigdataAt: number | undefined;
  const request = async (s: OfficialSource, url: string, robots: boolean): Promise<FetchResult> => {
    const gap = s.host === SEC_HOST ? SEC_GAP_MS : OFFICIAL_GAP_MS;
    const bigdata = !robots && s.kind === "acrc-bigdata";
    const at = Math.max(clock(), nextAt.get(s.host) ?? 0, bigdata && bigdataAt !== undefined ? bigdataAt + BIGDATA_GAP_MS : 0);
    if (at + OFFICIAL_REQUEST_TIMEOUT_MS > deadline) throw new OutOfTime();
    if (!robots && s.dailyLimit !== null && requestCount(db, s.id, day) >= Math.floor(s.dailyLimit * QUOTA_RATIO)) throw new QuotaReached();
    if (at > clock()) await sleep(at - clock());
    await reserve(s.host, gap);
    const g = groups[s.group]!;
    g.requests++;
    if (robots) g.robotsRequests++;
    else {
      reports[s.id]!.requests++;
      if (s.dailyLimit !== null) addRequest(db, s.id, day);
      // 마지막 요청 시각을 전용 DB에 남겨 호출과 실행 사이에도 2분을 지킨다(4.2-4)
      if (bigdata) {
        bigdataAt = clock();
        setMeta(db, bigdataKey(s), String(o.now().getTime()));
      }
    }
    const ac = new AbortController();
    const timedOut = timer(OFFICIAL_REQUEST_TIMEOUT_MS, ac.signal).then((): never => {
      throw new RequestTimeout();
    });
    try {
      const res = await Promise.race([o.http(url, { signal: ac.signal, headers: { "user-agent": s.publicAgent ? PUBLIC_USER_AGENT : FEED_USER_AGENT } }), timedOut]);
      if (Buffer.byteLength(res.text, "utf8") > OFFICIAL_MAX_BYTES) throw new TooLarge();
      return res;
    } finally {
      ac.abort();
    }
  };
  const lane: Lane = { get: (s, url) => request(s, url, false) };

  /** 값 날짜 하나를 받아 저장한다. 끊기거나 멈추면 예외를 그대로 낸다 */
  const runUnit = async (s: OfficialSource, u: Unit, c: FetchCtx): Promise<UnitResult> => {
    const t0 = clock();
    const before = reports[s.id]!.requests;
    let r: UnitResult;
    try {
      r = u.fixed ?? (await UNIT_FETCHERS[s.kind](s, c, u.valueDate));
    } catch (e) {
      // 받기 시작한 값 날짜가 상한에 끊기면 남은 대상이다. 같은 값 날짜가 세 실행에서 끊기면 받지 못함(4.3-3)
      if (e instanceof OutOfTime && reports[s.id]!.requests > before && addCut(db, s.id, u.valueDate, o.runId) >= CUT_RUNS) markFailed(s, OFFICIAL_REASON.deadline);
      throw e;
    }
    if (r.kind === "saved") {
      copyOnce();
      const saved = saveValueSnapshot(db, { source: s.id, group: s.group, label: s.label, valueDate: u.valueDate, fetchedOn: day, fetchedAt: stamp(), items: r.items, total: r.total, elapsedMs: clock() - t0, parts: r.parts });
      const g = groups[s.group]!;
      g.bytes += saved.bytes;
      g.rawBytes += saved.rawBytes;
      reports[s.id]!.filled++;
      if (s.kind === "ftc-1372" && u.fixed === undefined) (reports[s.id]!.unitMs ??= []).push(clock() - t0);
    }
    return r;
  };

  interface Track {
    s: OfficialSource;
    units: Unit[];
    c: FetchCtx;
    failures: number;
    done: boolean;
  }
  const settle = (t: Track, e: unknown): "next" | "stopSource" | "stopAll" => {
    if (e instanceof OutOfTime) {
      hitDeadline = true;
      return "stopAll";
    }
    if (e instanceof QuotaReached) {
      reports[t.s.id]!.quota = true;
      return "stopSource";
    }
    if (e instanceof Stop) {
      const scope = e.byKey && t.s.keyScope !== null ? t.s.keyScope : t.s.id;
      stops[scope] ??= e.reason;
      markFailed(t.s, e.reason);
      return "stopSource";
    }
    // 전용 DB 쓰기 실패만 명령 실패다. 그 밖의 뜻밖의 예외도 그 소스에 가둔다(4.3-2)
    if (!(e instanceof SourceFailure) && /SQLITE/i.test(String((e as { code?: unknown }).code ?? ""))) throw e;
    markFailed(t.s, e instanceof SourceFailure ? e.message : OFFICIAL_REASON.unexpected);
    t.failures++;
    return t.failures >= MAX_UNIT_FAILURES ? "stopSource" : "next";
  };

  /** 받을 차례였는데 받지 않고 남긴 값 날짜(다시 받을 1372 달처럼 스냅샷이 있는 것도 든다) */
  const leftover = new Map<string, string[]>();

  /** 한 줄(호스트 하나, 또는 민원빅데이터)을 돈다. 1372 달을 맨 앞에 받고, 나머지는 값 날짜 단위로 번갈아 받는다 */
  const runLane = async (list: OfficialSource[]) => {
    const tracks: Track[] = [];
    for (const s of list) {
      let plan: { units: Unit[]; lastDate: string };
      try {
        plan = await planUnits(db, s, lane, s.key === null ? "" : o.keys[s.key]!, now, startOf(s, o.starts));
      } catch (e) {
        const t: Track = { s, units: [], c: { lane, key: "", secrets: o.secrets, lastDate: day }, failures: 0, done: true };
        if (settle(t, e) === "stopAll") return;
        attempted.add(s.id);
        continue;
      }
      const skip = new Set(failedUnits[s.id]);
      plan.units = plan.units.filter((u) => !skip.has(u.valueDate));
      if (plan.units.length === 0) attempted.add(s.id);
      tracks.push({ s, units: plan.units, c: { lane, key: s.key === null ? "" : o.keys[s.key]!, secrets: o.secrets, lastDate: plan.lastDate }, failures: 0, done: false });
    }
    const step = async (t: Track): Promise<boolean> => {
      const u = t.units[0];
      if (u === undefined || t.done) return true;
      if (t.s.kind === "ftc-1372") {
        const measured = lastElapsed(db, t.s.id);
        if (measured !== null && deadline - clock() < measured) {
          hitDeadline = true;
          t.done = true;
          return true;
        }
      }
      if (t.s.kind === "acrc-bigdata") {
        const wait = Math.max(0, Number(getMeta(db, bigdataKey(t.s)) ?? "0") + BIGDATA_GAP_MS - o.now().getTime());
        // 2분을 기다리면 상한을 넘으면 다음 호출로 미룬다
        if (clock() + wait + OFFICIAL_REQUEST_TIMEOUT_MS > deadline) {
          hitDeadline = true;
          t.done = true;
          return true;
        }
        if (wait > 0) await sleep(wait);
      }
      attempted.add(t.s.id);
      try {
        await runUnit(t.s, u, t.c);
        t.units.shift();
        t.failures = 0;
      } catch (e) {
        const what = settle(t, e);
        if (!(e instanceof OutOfTime || e instanceof QuotaReached || e instanceof Stop)) (failedUnits[t.s.id] ??= []).push(u.valueDate);
        if (what === "stopAll") return false;
        if (what === "stopSource") t.done = true;
        else t.units.shift();
      }
      return true;
    };
    try {
      // 1372는 차례 맨 앞
      for (const t of tracks.filter((x) => x.s.kind === "ftc-1372")) {
        while (t.units.length > 0 && !t.done) if (!(await step(t))) return;
      }
      const rest = tracks.filter((x) => x.s.kind !== "ftc-1372");
      for (;;) {
        const live = rest.filter((t) => !t.done && t.units.length > 0 && stoppedBy(t.s) === undefined);
        if (live.length === 0) return;
        for (const t of live) if (!(await step(t))) return;
      }
    } finally {
      for (const t of tracks) leftover.set(t.s.id, t.units.map((u) => u.valueDate));
    }
  };

  const lanes = new Map<string, OfficialSource[]>();
  for (const s of todo) {
    const laneKey = s.kind === "acrc-bigdata" ? `${s.host}#bigdata` : s.host;
    lanes.set(laneKey, [...(lanes.get(laneKey) ?? []), s]);
  }

  // robots(4.2-3): 받을 소스가 있는 호스트마다 그 호스트 소스의 User-Agent로 한 번 받는다
  const byHost = Map.groupBy(todo, (s) => s.host);
  const robotsOf = new Map<string, Promise<"ok" | "blocked" | { failed: string }>>();
  for (const [host, list] of byHost) {
    robotsOf.set(
      host,
      (async () => {
        let text: string | null;
        try {
          text = await getOfficialRobots((url) => request(list[0]!, url, true), host);
        } catch (e) {
          if (e instanceof OutOfTime) {
            hitDeadline = true;
            return { failed: OFFICIAL_REASON.deadline };
          }
          return { failed: e instanceof SourceFailure ? e.message : OFFICIAL_REASON.robotsFetch };
        }
        if (text === null) return "ok";
        try {
          return list.some((s) => robotsBlocks(text, s.paths)) ? "blocked" : "ok";
        } catch {
          return { failed: OFFICIAL_REASON.robotsFormat };
        }
      })(),
    );
  }

  const settled = await Promise.allSettled(
    [...lanes].map(async ([, list]) => {
      const host = list[0]!.host;
      const r = await robotsOf.get(host)!;
      if (r === "blocked") {
        for (const s of list) robotsBlocked.add(s.id);
        return;
      }
      if (r !== "ok") {
        // 상한 때문에 robots를 받지 못한 것은 받지 못함이 아니고 차례가 오지 않은 것이다
        if (r.failed !== OFFICIAL_REASON.deadline)
          for (const s of list) {
            attempted.add(s.id);
            markFailed(s, r.failed);
          }
        return;
      }
      await runLane(list);
    }),
  );
  const crashed = settled.find((x) => x.status === "rejected");
  if (crashed !== undefined) throw crashed.reason;

  // 남은 채우기 대상: 스냅샷이 없는 값 날짜와, 받을 차례였는데 남긴 다시 받기(1372)
  for (const s of sources) {
    if (isDemandOff(s, off)) continue;
    const have = valueDates(db, s.id);
    reports[s.id]!.remaining = countRemaining(db, s, now) + (leftover.get(s.id) ?? []).filter((d) => have.has(d)).length;
  }

  for (const s of sources) {
    const g = groups[s.group]!;
    if (isDemandOff(s, off)) {
      setStatus(db, s.id, day, "off", null, stamp());
      g.off++;
      continue;
    }
    if (robotsBlocked.has(s.id)) {
      setStatus(db, s.id, day, "robots", null, stamp());
      g.robots++;
      continue;
    }
    const reason = failed[s.id];
    if (reason !== undefined) {
      setStatus(db, s.id, day, "failed", reason, stamp());
      g.failed.push({ label: s.label, reason });
      if (reason === OFFICIAL_REASON.noKey) g.noKey++;
      continue;
    }
    if (!attempted.has(s.id)) continue;
    g.ok++;
    setStatus(db, s.id, day, "ok", null, stamp());
  }

  const streaks: OfficialReport["streaks"] = [];
  for (const s of sources) {
    if (isDemandOff(s, off)) continue;
    const days = failStreak(db, s.id, day);
    if (days >= STREAK_DAYS) streaks.push({ source: s.id, days });
  }
  const anyRemaining = Object.values(reports).some((r) => r.remaining > 0);
  return {
    day,
    groups,
    sources: reports,
    copied: copied || (o.prior?.copied ?? false),
    elapsedMs: clock() - started + (o.prior?.elapsedMs ?? 0),
    hitDeadline: hitDeadline && anyRemaining,
    streaks,
    failed,
    stops,
    attempted: [...attempted],
    robotsBlocked: [...robotsBlocked],
    failedUnits,
  };
}

/** 남은 채우기 대상 수. SEC와 1372는 요청 없이 알 수 있는 만큼(SEC는 빠진 값 날짜, 1372는 스냅샷이 없는 달) */
function countRemaining(db: DatabaseSync, s: OfficialSource, now: Date): number {
  const have = valueDates(db, s.id);
  const today = kstDate(now);
  if (s.kind === "assembly") return have.has(today) ? 0 : 1;
  if (s.kind === "ftc-1372") return monthRange(FTC1372_START, today.slice(0, 7)).filter((m) => !have.has(m)).length;
  const last = lastValueDate(s, now);
  // 마지막 날짜는 아직 올라오지 않았을 수 있어 남은 대상에 세지 않는다
  return dateRange(OFFICIAL_START, addDays(last, -1)).filter((d) => !have.has(d)).length;
}

/**
 * 공식 소스의 robots.txt(4.2-3, RFC 9309). 리디렉션은 다섯 번까지 따라가고, 4xx는 파일 없음(null)이다.
 * 리디렉션 끝의 다른 경로가 준 200 HTML(오류 페이지)도 파일 없음이다. 5xx·시간 초과와 리디렉션 없는 HTML은 받지 못함이다
 */
export async function getOfficialRobots(get: (url: string) => Promise<FetchResult>, host: string): Promise<string | null> {
  let url = `https://${host}/robots.txt`;
  let redirected = false;
  for (let hop = 0, attempt = 0; ; ) {
    let res: FetchResult;
    try {
      res = await get(url);
    } catch (e) {
      if (e instanceof OutOfTime || e instanceof QuotaReached) throw e;
      if (attempt >= 1) failWith(`${OFFICIAL_REASON.robotsFetch}(${e instanceof RequestTimeout || (e as Error).name === "TimeoutError" ? OFFICIAL_REASON.timeout : OFFICIAL_REASON.network})`);
      attempt++;
      continue;
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers?.location;
      if (loc === undefined || hop >= 5) failWith(`${OFFICIAL_REASON.robotsFetch}(리디렉션)`);
      url = new URL(loc, url).toString();
      redirected = true;
      hop++;
      continue;
    }
    if (res.status >= 400 && res.status < 500) return null;
    if (res.status >= 500) {
      if (attempt >= 1) failWith(`${OFFICIAL_REASON.robotsFetch}(HTTP ${res.status})`);
      attempt++;
      continue;
    }
    const html = /^\s*(?:<!doctype|<html)/i.test(res.text);
    if (html && redirected && new URL(url).pathname !== "/robots.txt") return null;
    return res.text;
  }
}

/** 받기 결과의 출력 줄. 받은 글은 넣지 않는다(4.3-3) */
export function officialLines(r: { day: string | null; groups: Record<string, OfficialGroupReport>; sources: Record<string, OfficialSourceReport>; elapsedMs: number; dbBytes: number | null; hitDeadline: boolean; streaks: { source: string; days: number }[]; calls: number }): string[] {
  const lines: string[] = [];
  const label = (id: string) => DEMAND_GROUPS.find((g) => g.id === id)?.label ?? id;
  for (const [id, g] of Object.entries(r.groups)) {
    const failedText = g.failed.length === 0 ? "" : `(${g.failed.map((f) => `${f.label}: ${f.reason}`).join(", ")})`;
    const per = Object.values(r.sources)
      .filter((x) => x.group === id)
      .map((x) => `${x.label} 채움 ${x.filled}·남음 ${x.remaining}${x.quota ? "·하루 한도로 멈춤" : ""}${x.unitMs?.length ? `·달마다 ${x.unitMs.map((ms) => Math.round(ms / 1000)).join("/")}초` : ""}`)
      .join(", ");
    lines.push(`- 공식 수요 ${label(id)}: 소스 ${g.total}개 중 받음 ${g.ok}, 받지 못함 ${g.failed.length}${failedText}, 키 없음 ${g.noKey}, robots 막힘 ${g.robots}, 꺼짐 ${g.off}. 요청 ${g.requests}번(robots ${g.robotsRequests}번), 저장 ${g.bytes}바이트(압축 전 ${g.rawBytes}). ${per}`);
  }
  const quota = Object.values(r.sources).filter((x) => x.quota).map((x) => x.label);
  if (quota.length > 0) lines.push(`- 공식 수요 하루 한도로 멈춘 소스: ${quota.join(", ")}`);
  const size = r.dbBytes === null ? "없음" : `${r.dbBytes}바이트`;
  const remaining = Object.values(r.sources).reduce((n, x) => n + x.remaining, 0);
  lines.push(`- 공식 수요(${r.day ?? "-"}): 전용 DB ${size}, 걸린 시간 ${Math.round(r.elapsedMs / 1000)}초(${r.calls}번 부름), 남은 채우기 대상 ${remaining}`);
  lines.push(r.hitDeadline ? "- 공식 수요 상한: 닿음, 남은 대상 있음" : "- 공식 수요 상한: 닿지 않음");
  if (r.streaks.length > 0) lines.push(`- 공식 수요 소스 연속 받지 못함(${STREAK_DAYS}일 이상): ${r.streaks.map((s) => `${s.source} ${s.days}일`).join(", ")}`);
  return lines;
}
