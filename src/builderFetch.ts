import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import type { DatabaseSync } from "node:sqlite";
import { docHash, keyedDeprecations, mergedRowText, parseDocRows, rowHash, withinDays, type DocRow, type KeyedRow } from "./builderDocs.ts";
import { dueReminders, type DueReminder } from "./builderSchedule.ts";
import {
  BUILDER_SOURCES,
  CODING_LINE_RE,
  DEFAULT_OFF,
  EOL_WINDOW_DAYS,
  FRAMEWORK_LTS_RE,
  FRAMEWORK_MAJOR_RE,
  FRAMEWORK_PRERELEASE_RE,
  FRAMEWORK_SECURITY_RE,
  FRAMEWORK_STABLE_RE,
  GHSA_MIN_DOWNLOADS,
  KEV_TRACKED_RE,
  MAJOR_HEAD_CHARS,
  PLATFORM_TITLE_RE,
  PRERELEASE_RE,
  SOCKET_TITLE_RE,
  TRACKED_PACKAGES,
  ghsaUrl,
  isOff,
  npmDownloadsUrl,
  type BuilderOff,
  type BuilderSourceSpec,
  type DocSource,
  type EolSource,
  type FeedSource,
  type GhsaSource,
  type KevSource,
  type ReleaseSource,
} from "./builderSources.ts";
import {
  addPending,
  allPending,
  deletePending,
  emittedKeys,
  getBuilderDoc,
  liveRows,
  markSourceFailed,
  markSourceOk,
  publishedKeys,
  rowByHash,
  setBuilderDoc,
  sourceState,
  storeRowChanges,
  type BuilderField,
  type BuilderStatus,
  type PendingChange,
  type StoredRow,
} from "./builderStore.ts";
import { attr, decodeXmlText, makeFetchText, parseRss, stripTags, tag, type FetchText } from "./feeds.ts";
import { inTransaction } from "./issues.ts";
import { addDays, kstDate } from "./kst.ts";
import { failsPublicScan } from "./precheck.ts";
import { dueAfter } from "./schedules.ts";

// 9.8단계 4.1, 4.2: 빌더 소스 받기, 기계 필터, 숫자 행 비교와 원문 보관. 소스 글은 데이터로만 다룬다.
// 숫자 행은 되찾을 수 없어 받자마자 저장하고, 시각은 적용이 성공했을 때만 앞당긴다(B15).
// 실패 이유와 경고에는 소스 글을 넣지 않는다(실행 기록과 요약에 남는다).

/** 소스 하나의 시간 제한 */
const SOURCE_TIMEOUT_MS = 30_000;
/** 명령 전체 시간 상한(4.1-3). 스킬의 Bash 시간 제한은 이보다 길어야 한다 */
export const BUILDER_DEADLINE_MS = 300_000;
/** 받을 기간의 최대 날 수 */
export const MAX_WINDOW_DAYS = 14;
/** 하루. 받은 시각이 없는 소스의 첫 기간이기도 하다 */
const DAY_MS = 24 * 3600_000;
/** 응답 하나의 글자 수 상한. KEV 전체가 2MB 안팎이라 넉넉히 둔다 */
export const MAX_BODY_CHARS = 5_000_000;
/** 이보다 긴 피드 제목은 필터의 정규식에 넣지 않는다 */
const FEED_TITLE_MAX = 1000;
/** 후보 하나의 재료 글 상한(전체 파일) */
export const MATERIAL_MAX = 6000;
/** 원문 보관 폴더(데이터 폴더 안, 커밋·백업·사이트에 들어가지 않는다, B5) */
export const BUILDER_RAW_DIR = "builder-raw";
/** 피드 한도를 모르는 소스의 경고 기준 항목 수 */
const DEFAULT_LIMIT_WARN = 10;

const USER_AGENT = "tidwyn/9.8 (personal changelog reader)";

export const builderFetchText = makeFetchText(USER_AGENT, SOURCE_TIMEOUT_MS);

/** 후보 종류. 앞의 셋은 분량 상한에서 먼저 남는다(4.1-2) */
export type CandidateKind = "deprecation" | "number" | "security" | "update";

export interface Draft {
  kind: CandidateKind;
  field: BuilderField;
  source: string;
  sourceLabel: string;
  title: string;
  material: string;
  url: string;
  keys: string[];
  /** 필터 통과 이유 */
  reason: string;
  /** 재료의 발행일(`YYYY-MM-DD`). 연도 없는 날짜를 풀 때 쓴다 */
  publishedOn: string | null;
  /** 받기 명령이 잠정으로 표시한 후보(B7) */
  tentative?: boolean;
  /** 지원 종료 후보의 날짜 */
  due?: string;
}

export interface SourceReport {
  id: string;
  label: string;
  status: "ok" | "failed" | "off";
  reason?: string;
  items?: number;
  candidates?: number;
  failDays?: number;
  /** 14일로 잘린 기간의 시작 */
  clampedFrom?: string;
}

export interface DocReport {
  doc: string;
  rows: number;
  added: number;
  removed: number;
  noNumber: number;
  tooLong: number;
  rejected: number;
  first: boolean;
  rawSaved: boolean;
}

export interface BuilderFetchReport {
  target: string;
  /** 받기를 시작한 시각(UTC ISO). 적용이 성공한 소스의 받은 시각이 된다 */
  fetchedAt: string;
  /** 소스로 본 날짜 상태 */
  status: BuilderStatus;
  sources: SourceReport[];
  docs: DocReport[];
  /** 소스 글이 들지 않은 경고 */
  warnings: string[];
  drafts: Draft[];
  reminders: DueReminder[];
  /** 호스트나 공개 검사로 뺀 후보 수, 실린 키나 낸 키로 뺀 후보 수 */
  droppedByHost: number;
  droppedByKey: number;
  droppedByScan: number;
}

export interface FetchOptions {
  db: DatabaseSync;
  http: FetchText;
  now: Date;
  target: string;
  dataDir: string;
  home: string | null;
  secrets?: readonly string[];
  off?: BuilderOff;
  /** 전체 상한을 재는 시계(밀리초). 없으면 Date.now */
  clock?: () => number;
  deadlineMs?: number;
}

class SourceFailure extends Error {}

function fail(reason: string): never {
  throw new SourceFailure(reason);
}

interface Window {
  from: number;
  to: number;
  /** 날짜만 있는 항목의 비교 범위(시작 날짜의 전날부터, B15) */
  dateFrom: string;
  dateTo: string;
  clampedFrom?: string;
}

function windowOf(fetchedAt: string | null, now: Date): Window {
  const to = now.getTime();
  const limit = to - MAX_WINDOW_DAYS * DAY_MS;
  const start = fetchedAt === null ? to - DAY_MS : Date.parse(fetchedAt);
  const from = Math.max(start, limit);
  const w: Window = { from, to, dateFrom: addDays(new Date(from).toISOString().slice(0, 10), -1), dateTo: kstDate(now) };
  if (start < limit) w.clampedFrom = new Date(from).toISOString();
  return w;
}

const HAS_TIME_RE = /\d{1,2}:\d{2}/;

/** 시각으로 비교한다 */
function atInstantIn(raw: string, w: Window): boolean {
  const t = Date.parse(raw);
  return !Number.isNaN(t) && t > w.from && t <= w.to;
}

/** 시각 칸이 없거나 값이 00:00:00인 항목은 날짜로 비교한다(B15) */
function inWindow(raw: string, w: Window): boolean {
  const trimmed = raw.trim();
  const noTime = !HAS_TIME_RE.test(trimmed);
  if (!noTime && !/\b00:00:00\b/.test(trimmed)) return atInstantIn(trimmed, w);
  const t = Date.parse(noTime && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed} UTC` : trimmed);
  if (Number.isNaN(t)) return false;
  const d = new Date(t).toISOString().slice(0, 10);
  return d >= w.dateFrom && d <= w.dateTo;
}

function dayOf(raw: string): string | null {
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/** 소스 형식 공통 검사: 200이어도 HTML 페이지면 실패 */
function checkBody(status: number, text: string): void {
  if (status !== 200) fail(`HTTP ${status}`);
  if (text.length > MAX_BODY_CHARS) fail("응답이 지나치게 크다");
  if (text.trim() === "") fail("빈 응답");
  if (/^\s*(?:<!doctype|<html)/i.test(text)) fail("HTML 페이지가 왔다");
}

function readJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return fail("JSON 형식이 아니다");
  }
}

export interface FeedEntry {
  title: string;
  link: string;
  date: string;
  text: string;
}

/** RSS나 Atom을 읽는다. 끝 태그가 없으면 깨진 응답이다 */
export function parseFeed(xml: string): FeedEntry[] {
  if (/<rss[\s>]/i.test(xml)) {
    if (!/<\/rss>\s*$/i.test(xml)) fail("피드가 깨졌다");
    let items;
    try {
      items = parseRss(xml);
    } catch {
      return fail("RSS 형식이 아니다");
    }
    return items.map((i) => ({ title: stripTags(i.title), link: i.link, date: i.pubDate, text: i.description ?? "" }));
  }
  if (!/<feed[\s>]/i.test(xml)) fail("피드 형식이 아니다");
  if (!/<\/feed>\s*$/i.test(xml)) fail("피드가 깨졌다");
  const out: FeedEntry[] = [];
  // 닫는 태그로 나눈다. 끝맺지 않은 <entry>가 많아도 받은 글의 길이에 비례한다
  for (const part of xml.split(/<\/entry>/i).slice(0, -1)) {
    const start = part.search(/<entry[\s>]/i);
    const open = start < 0 ? -1 : part.indexOf(">", start);
    if (open < 0) continue;
    const body = part.slice(open + 1);
    const links = [...body.matchAll(/<link\b[^>]*>/gi)].map((x) => x[0]);
    const link = links.find((l) => (attr(l, "rel") ?? "alternate") === "alternate");
    const href = link === undefined ? undefined : attr(link, "href");
    const title = tag(body, "title");
    const date = tag(body, "published") ?? tag(body, "updated");
    if (!title || !href || !date) continue;
    out.push({ title: stripTags(title), link: href, date, text: stripTags(decodeXmlText(tag(body, "summary") ?? tag(body, "content") ?? "")) });
  }
  return out;
}

export function capped(text: string, max = MATERIAL_MAX): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 키에 쓰는 주소: 소문자 호스트, 쿼리와 끝 슬래시를 뺀다. 메일 모양이 되지 않게 `@`를 바꾼다(B9) */
export function urlKey(url: string): string {
  const u = new URL(url);
  return safeKey(`${u.protocol}//${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.hash}`);
}

function safeKey(key: string): string {
  return key.replace(/(?<=[\w.%+-])@/g, "%40");
}

/** https이고 소스의 호스트면 주소를 돌려준다 */
function allowedUrl(raw: string, base: string, hosts: readonly string[]): string | null {
  try {
    const u = new URL(raw, base);
    return u.protocol === "https:" && hosts.includes(u.hostname.toLowerCase()) ? u.toString() : null;
  } catch {
    return null;
  }
}

interface SourceOutput {
  drafts: Draft[];
  items: number;
  warnings: string[];
  droppedByHost: number;
  doc?: DocReport;
}

function emptyOutput(items = 0): SourceOutput {
  return { drafts: [], items, warnings: [], droppedByHost: 0 };
}

function limitWarning(spec: BuilderSourceSpec, dates: string[], w: Window): string | null {
  const limit = spec.limit ?? DEFAULT_LIMIT_WARN;
  if (dates.length < limit) return null;
  const times = dates.map((d) => Date.parse(d)).filter((t) => !Number.isNaN(t));
  if (times.length === 0 || Math.min(...times) <= w.from) return null;
  return `${spec.label}: 받은 항목이 ${limit}건 한도에 닿아 기간 앞쪽을 놓쳤을 수 있다`;
}

function base(spec: BuilderSourceSpec): Pick<Draft, "field" | "source" | "sourceLabel"> {
  return { field: spec.field, source: spec.id, sourceLabel: spec.label };
}

// ---- 코딩 도구 릴리스 ----

interface ReleaseRow {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  prerelease?: unknown;
  draft?: unknown;
}

const isMajorTag = (tagName: string) => {
  const m = /(?:^|[^\d.])(\d+)\.0\.0$/.exec(tagName);
  return m !== null && Number(m[1]) >= 1;
};

function fromReleases(spec: ReleaseSource, text: string, w: Window): SourceOutput {
  const data = readJson(text);
  if (!Array.isArray(data)) fail("릴리스 목록이 아니다");
  const list = data as ReleaseRow[];
  const out = emptyOutput(list.length);
  const warn = limitWarning(spec, list.map((r) => String(r.published_at ?? "")), w);
  if (warn !== null) out.warnings.push(warn);
  for (const r of list) {
    const tagName = typeof r.tag_name === "string" ? r.tag_name : "";
    const published = typeof r.published_at === "string" ? r.published_at : "";
    if (tagName === "" || r.draft === true || r.prerelease === true || PRERELEASE_RE.test(tagName)) continue;
    if (!inWindow(published, w)) continue;
    const body = typeof r.body === "string" ? r.body : "";
    const hits = body.split(/\r?\n/).filter((l) => CODING_LINE_RE.test(l)).map((l) => l.trim());
    const major = isMajorTag(tagName);
    if (!major && hits.length === 0) continue;
    const url = allowedUrl(typeof r.html_url === "string" ? r.html_url : "", spec.url, spec.hosts);
    if (url === null) {
      out.droppedByHost++;
      continue;
    }
    const version = tagName.replace(/^.*?v?(?=\d)/, "");
    const key = spec.npm !== undefined ? `npm:${spec.npm}:${version}` : `release:${spec.id}:${tagName}`;
    out.drafts.push({
      ...base(spec),
      kind: "update",
      title: `${spec.label} ${tagName}`,
      material: capped(hits.length > 0 ? hits.join("\n") : body.slice(0, MAJOR_HEAD_CHARS)),
      url,
      keys: [safeKey(key)],
      reason: major ? "메이저 버전" : "본문 낱말",
      publishedOn: dayOf(published),
    });
  }
  return out;
}

// ---- 피드 ----

/** 제목과 본문을 필터에 맞춘다. 통과 이유, 아니면 null. 코딩 도구는 맞은 줄만 재료에 넣는다 */
function passFeed(spec: FeedSource, e: FeedEntry): { reason: string; material: string } | null {
  const whole = e.text === "" ? e.title : `${e.title}\n${e.text}`;
  switch (spec.filter) {
    case "model":
      return { reason: "모델 소식", material: whole };
    case "coding": {
      const lines = [e.title, ...e.text.split(/(?<=[.!?])\s+/)].filter((l) => CODING_LINE_RE.test(l));
      return lines.length === 0 ? null : { reason: "본문 낱말", material: lines.join("\n") };
    }
    case "security":
      return SOCKET_TITLE_RE.test(e.title) ? { reason: "제목 낱말", material: whole } : null;
    case "platform":
      return PLATFORM_TITLE_RE.test(e.title) ? { reason: "제목 낱말", material: whole } : null;
    case "framework": {
      if (FRAMEWORK_SECURITY_RE.test(e.title)) return { reason: "보안 릴리스·사전 공지", material: whole };
      if (FRAMEWORK_LTS_RE.test(e.title)) return { reason: "LTS 전환", material: whole };
      if (FRAMEWORK_PRERELEASE_RE.test(e.title)) return null;
      if (FRAMEWORK_STABLE_RE.test(e.title)) return { reason: "베타→정식", material: whole };
      return FRAMEWORK_MAJOR_RE.test(e.title) ? { reason: "메이저 버전", material: whole } : null;
    }
  }
}

function fromFeed(spec: FeedSource, text: string, w: Window): SourceOutput {
  const entries = parseFeed(text);
  const out = emptyOutput(entries.length);
  const warn = limitWarning(spec, entries.map((e) => e.date), w);
  if (warn !== null) out.warnings.push(warn);
  for (const e of entries) {
    if (!inWindow(e.date, w) || e.title.length > FEED_TITLE_MAX) continue;
    const pass = passFeed(spec, e);
    if (pass === null) continue;
    const url = allowedUrl(e.link, spec.url, spec.hosts);
    if (url === null) {
      out.droppedByHost++;
      continue;
    }
    out.drafts.push({ ...base(spec), kind: spec.filter === "security" ? "security" : "update", title: e.title, material: capped(pass.material), url, keys: [urlKey(url)], reason: pass.reason, publishedOn: dayOf(e.date) });
  }
  return out;
}

// ---- KEV ----

interface KevRow {
  cveID?: unknown;
  vendorProject?: unknown;
  product?: unknown;
  vulnerabilityName?: unknown;
  dateAdded?: unknown;
  shortDescription?: unknown;
}

function fromKev(spec: KevSource, text: string, w: Window): SourceOutput {
  const data = readJson(text) as { vulnerabilities?: unknown } | null;
  if (!Array.isArray(data?.vulnerabilities)) fail("KEV 형식이 아니다");
  const list = data.vulnerabilities as KevRow[];
  const out = emptyOutput(list.length);
  for (const v of list) {
    const cve = String(v.cveID ?? "");
    const added = String(v.dateAdded ?? "");
    const who = `${String(v.vendorProject ?? "")} ${String(v.product ?? "")}`;
    if (cve === "" || !inWindow(added, w) || !KEV_TRACKED_RE.test(who)) continue;
    // 미국 연방 기관의 기한(dueDate)과 조치 글은 재료에 넣지 않는다(4.1-2)
    out.drafts.push({
      ...base(spec),
      kind: "security",
      title: `${cve} ${who}`,
      material: capped(`${String(v.vulnerabilityName ?? "")}\n${String(v.shortDescription ?? "")}\n등재일: ${added}`),
      url: spec.page,
      keys: [`kev:${cve}`],
      reason: "KEV 등재, 추적 대상",
      publishedOn: added,
    });
  }
  return out;
}

// ---- GHSA ----

interface GhsaVulnerability {
  package?: { ecosystem?: unknown; name?: unknown };
  vulnerable_version_range?: unknown;
  first_patched_version?: unknown;
}

interface GhsaRow {
  ghsa_id?: unknown;
  cve_id?: unknown;
  html_url?: unknown;
  summary?: unknown;
  severity?: unknown;
  github_reviewed_at?: unknown;
  withdrawn_at?: unknown;
  vulnerabilities?: unknown;
}

function patched(v: GhsaVulnerability): string {
  const p = v.first_patched_version;
  if (typeof p === "string") return p;
  const id = (p as { identifier?: unknown } | null)?.identifier;
  return typeof id === "string" ? id : "없음";
}

interface GhsaOptions {
  http: FetchText;
  checkDeadline: () => void;
}

async function fromGhsa(spec: GhsaSource, w: Window, o: GhsaOptions): Promise<SourceOutput> {
  const rows: GhsaRow[] = [];
  const out = emptyOutput();
  for (const severity of ["critical", "high"] as const) {
    o.checkDeadline();
    const res = await o.http(ghsaUrl(severity, w.dateFrom));
    checkBody(res.status, res.text);
    const data = readJson(res.text);
    if (!Array.isArray(data)) fail("공지 목록이 아니다");
    rows.push(...(data as GhsaRow[]));
    if (data.length >= (spec.limit ?? 0)) out.warnings.push(`${spec.label}: ${severity} 공지가 ${data.length}건 한도에 닿아 기간 앞쪽을 놓쳤을 수 있다`);
  }
  out.items = rows.length;
  // 패키지별로 묶는다(2.5). 다운로드 수는 통과가 다운로드에 달린 패키지만 묻는다
  const byPackage = new Map<string, { a: GhsaRow; v: GhsaVulnerability }[]>();
  for (const a of rows) {
    const reviewed = typeof a.github_reviewed_at === "string" ? a.github_reviewed_at : "";
    if (reviewed === "" || (a.withdrawn_at !== null && a.withdrawn_at !== undefined) || !atInstantIn(reviewed, w)) continue;
    for (const v of (Array.isArray(a.vulnerabilities) ? a.vulnerabilities : []) as GhsaVulnerability[]) {
      if (v.package?.ecosystem !== "npm" || typeof v.package.name !== "string") continue;
      const list = byPackage.get(v.package.name) ?? [];
      list.push({ a, v });
      byPackage.set(v.package.name, list);
    }
  }
  for (const [name, list] of [...byPackage].sort(([a], [b]) => a.localeCompare(b))) {
    const tracked = TRACKED_PACKAGES.includes(name);
    const critical = list.some((x) => x.a.severity === "critical");
    let reason: string | null = tracked ? "추적 패키지 high 이상" : null;
    if (reason === null && critical) {
      o.checkDeadline();
      const res = await o.http(npmDownloadsUrl(name));
      // 다운로드 수를 받지 못한 패키지가 있으면 그날 GHSA를 실패로 센다. 404는 다운로드 0이다(2.5)
      if (res.status !== 404) {
        if (res.status !== 200) fail(`npm 다운로드 수를 받지 못했다(HTTP ${res.status})`);
        const n = (readJson(res.text) as { downloads?: unknown } | null)?.downloads;
        if (typeof n !== "number") fail("npm 다운로드 수 형식이 아니다");
        if (n >= GHSA_MIN_DOWNLOADS) reason = `npm critical, 주간 다운로드 ${GHSA_MIN_DOWNLOADS.toLocaleString("en-US")} 이상`;
      }
    }
    if (reason === null) continue;
    const seen = new Map<string, { a: GhsaRow; v: GhsaVulnerability }>();
    for (const x of list) if (!seen.has(String(x.a.ghsa_id))) seen.set(String(x.a.ghsa_id), x);
    const picked = [...seen.values()];
    const url = allowedUrl(String(picked[0]!.a.html_url ?? ""), spec.url, spec.hosts);
    if (url === null) {
      out.droppedByHost++;
      continue;
    }
    // 공지의 credits는 재료에 넣지 않는다(4.1-2). 넣는 칸만 골라 쓴다
    const lines = picked.map(({ a, v }) => `${String(a.ghsa_id)}${typeof a.cve_id === "string" ? ` (${a.cve_id})` : ""} ${String(a.severity)}: ${String(a.summary ?? "")} · 영향 범위 ${String(v.vulnerable_version_range ?? "모름")} · 고친 버전 ${patched(v)}`);
    out.drafts.push({
      ...base(spec),
      kind: "security",
      title: `npm ${name} 보안 공지 ${picked.length}건`,
      material: capped(lines.join("\n")),
      url,
      keys: picked.map(({ a }) => `ghsa:${String(a.ghsa_id)}`),
      reason,
      publishedOn: dayOf(String(picked[0]!.a.github_reviewed_at)),
    });
  }
  return out;
}

// ---- endoflife.date ----

interface EolRelease {
  name?: unknown;
  eolFrom?: unknown;
}

function fromEol(spec: EolSource, text: string, target: string): SourceOutput {
  const data = readJson(text) as { result?: { releases?: unknown } } | null;
  const releases = data?.result?.releases;
  if (!Array.isArray(releases)) fail("endoflife.date 형식이 아니다");
  const out = emptyOutput(releases.length);
  const product = spec.id.replace(/^eol-/, "");
  for (const r of releases as EolRelease[]) {
    const eolFrom = typeof r.eolFrom === "string" ? r.eolFrom : "";
    const name = typeof r.name === "string" ? r.name : "";
    if (name === "" || !withinDays(eolFrom, target, EOL_WINDOW_DAYS)) continue;
    out.drafts.push({
      ...base(spec),
      kind: "deprecation",
      title: `${product} ${name} 지원 종료 예정`,
      material: `${product} ${name}: 지원 종료 ${eolFrom}(endoflife.date, 공급사 문서가 아니라 잠정이다)`,
      url: spec.page,
      keys: [safeKey(`eol:${product}:${name}`)],
      reason: `지원 종료까지 ${EOL_WINDOW_DAYS}일 안`,
      publishedOn: null,
      tentative: true,
      due: eolFrom,
    });
  }
  return out;
}

// ---- 문서 ----

/** 원문을 데이터 폴더에 압축해 둔다(4.2-3). 공개 백업, data 브랜치, 사이트 결과물에 들어가지 않는다 */
export function saveRaw(dataDir: string, doc: string, today: string, hash: string, text: string): string {
  const dir = path.join(dataDir, BUILDER_RAW_DIR, doc);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${today}-${hash.slice(0, 8)}.md.gz`);
  fs.writeFileSync(file, gzipSync(text));
  return file;
}

interface DocContext {
  db: DatabaseSync;
  target: string;
  today: string;
  dataDir: string;
  home: string | null;
  secrets: readonly string[];
}

const numKey = (spec: DocSource, today: string, hash: string) => `num:${spec.vendor}:${today}:${hash}`;

/** 행 비교 결과로 미적용 변경을 만든다. 지난 날짜 행은 저장만 한다(4.2-1) */
function addDocPending(c: DocContext, spec: DocSource, first: boolean, added: (DocRow & { hash: string })[], removed: StoredRow[], live: (DocRow & { hash: string })[]): void {
  const pending = (p: Omit<PendingChange, "doc" | "changedOn" | "emits">) => addPending(c.db, { ...p, doc: spec.id, changedOn: c.today });
  const numberPending = (side: PendingChange["side"], hash: string) => pending({ key: numKey(spec, c.today, hash), kind: "number", side, hash, due: null, before: [] });
  if (spec.doc !== "deprecation") {
    if (first) return;
    for (const r of added) numberPending("added", r.hash);
    for (const r of removed) numberPending("removed", r.hash);
    return;
  }
  const keyed = keyedDeprecations(spec, live);
  const removedKeyed = keyedDeprecations(spec, removed);
  const addedHashes = new Set(added.map((r) => r.hash));
  const fresh = first ? keyed : keyed.filter((k) => addedHashes.has(k.row.hash));
  for (const k of fresh) {
    if (!dueAfter(k.due, c.target) || (first && k.tentative)) continue;
    // 바뀌기 전 행: 같은 모델의 지워진 행
    const before = removedKeyed.filter((x) => x.model === k.model).map((x) => x.row.hash);
    pending({ key: k.key, kind: k.tentative ? "tentative" : "deprecation", side: "added", hash: k.row.hash, due: k.due, before: [...new Set(before)] });
  }
  if (first) return;
  // 날짜를 읽지 못한 새 행은 숫자 변경으로 낸다
  const dated = new Set(keyed.map((k) => k.row.hash));
  for (const r of added) if (!dated.has(r.hash)) numberPending("added", r.hash);
  // 미래 확정 날짜 행이 대체 없이 사라지면 후보다
  const liveModels = new Set(keyed.map((k) => k.model));
  for (const k of removedKeyed) {
    if (!k.tentative && dueAfter(k.due, c.target) && !liveModels.has(k.model)) numberPending("removed", k.row.hash);
  }
}

function fromDoc(c: DocContext, spec: DocSource, text: string): SourceOutput {
  const parsed = parseDocRows(text);
  if (parsed.rows.length === 0) fail("표 행이 없다");
  const stored = getBuilderDoc(c.db, spec.id);
  const prev = liveRows(c.db, spec.id);
  const prevHashes = new Set(prev.map((r) => r.hash));
  let rejected = 0;
  const rows: (DocRow & { hash: string })[] = [];
  for (const r of parsed.rows) {
    const merged = mergedRowText(r);
    if (failsPublicScan(merged, c.home, c.secrets)) rejected++;
    else rows.push({ ...r, hash: rowHash(spec.id, r) });
  }
  if (rows.length * 2 < prev.length) fail(`행 수가 지난 값의 절반 미만이다(${rows.length}행, 지난 값 ${prev.length}행)`);
  const nextHashes = new Set(rows.map((r) => r.hash));
  const added = rows.filter((r) => !prevHashes.has(r.hash));
  const removed = prev.filter((r) => !nextHashes.has(r.hash));
  const hash = docHash(text);
  const first = stored === null;
  const rawSaved = first || stored.hash !== hash;
  // 원문이 먼저다: 저장 뒤에 끊겨도 다음 실행이 같은 해시를 보고 다시 쓰지 않으면 원문을 잃는다
  if (rawSaved) saveRaw(c.dataDir, spec.id, c.today, hash, text);
  inTransaction(c.db, () => {
    storeRowChanges(c.db, spec.id, added, removed.map((r) => r.hash), c.today);
    setBuilderDoc(c.db, spec.id, hash, c.today);
    addDocPending(c, spec, first, added, removed, rows);
  });
  const out = emptyOutput(rows.length);
  out.doc = { doc: spec.id, rows: rows.length, added: first ? 0 : added.length, removed: removed.length, noNumber: parsed.noNumber, tooLong: parsed.tooLong, rejected, first, rawSaved };
  if (rejected > 0) out.warnings.push(`${spec.label}: 공개 검사에 걸린 행 ${rejected}개를 저장하지 않았다`);
  return out;
}

const rowLine = (r: DocRow) => `- ${mergedRowText(r)}`;

const rowLines = (label: string, rows: StoredRow[]) => (rows.length > 0 ? [label, ...rows.map(rowLine)] : []);

type RowsOf = (hashes: string[]) => StoredRow[];

/** 숫자 변경 묶음의 후보. 재료는 저장된 숫자 행이다 */
function numberDraft(spec: DocSource, list: PendingChange[], rowsOf: RowsOf): Draft {
  const head = list[0]!;
  const after = rowsOf(list.filter((p) => p.side === "added").map((p) => p.hash));
  const before = rowsOf(list.filter((p) => p.side === "removed").map((p) => p.hash));
  const deprecation = spec.doc === "deprecation";
  return {
    ...base(spec),
    kind: deprecation ? "deprecation" : "number",
    title: `${spec.label} 표 변경(${head.changedOn})`,
    material: capped([...rowLines("바뀌기 전:", before), ...rowLines("바뀐 뒤:", after)].join("\n")),
    url: spec.page,
    keys: list.map((p) => p.key),
    reason: deprecation ? "지원 종료 표 변경" : "숫자 행 변경",
    publishedOn: head.changedOn,
  };
}

/** 같은 종류·날짜의 지원 종료 묶음의 후보 */
function deprecationDraft(spec: DocSource, list: PendingChange[], liveByKey: Map<string, KeyedRow<StoredRow>[]>, rowsOf: RowsOf): Draft {
  const head = list[0]!;
  const seen = new Map<string, StoredRow>();
  for (const p of list) for (const k of liveByKey.get(p.key) ?? []) seen.set(k.row.hash, k.row);
  const before = rowsOf([...new Set(list.flatMap((p) => p.before))]);
  const tentative = head.kind === "tentative";
  return {
    ...base(spec),
    kind: "deprecation",
    title: `${spec.label} ${head.due}${tentative ? " (잠정)" : ""}`,
    material: capped([...rowLines("바뀌기 전:", before), ...rowLines("지금 행:", [...seen.values()])].join("\n")),
    url: spec.page,
    keys: list.map((p) => p.key),
    reason: tentative ? "지원 종료 새 항목(잠정)" : "지원 종료 미래 확정 날짜",
    publishedOn: head.changedOn,
    tentative,
    due: head.due!,
  };
}

/**
 * DB의 미적용 변경에서 후보를 만든다. 실린 키나 낸 키, 예정일이 대상 날짜 이하가 된 것, 최신 저장 행에서 사라진 지원 종료 키는 버린다.
 * 받기가 실패한 문서의 표시도 후보로 낸다(재료는 저장된 숫자 행이다).
 */
function pendingDrafts(db: DatabaseSync, target: string, active: DocSource[], published: Set<string>, emitted: Set<string>): Draft[] {
  const out: Draft[] = [];
  const pending = allPending(db);
  for (const spec of active) {
    const mine = pending.filter((p) => p.doc === spec.id);
    if (mine.length === 0) continue;
    const liveByKey = new Map<string, KeyedRow<StoredRow>[]>();
    // 숫자 문서의 미적용 변경은 number뿐이라 지원 종료 키를 풀 필요가 없다
    if (spec.doc === "deprecation") for (const k of keyedDeprecations(spec, liveRows(db, spec.id))) liveByKey.set(k.key, [...(liveByKey.get(k.key) ?? []), k]);
    const keep: PendingChange[] = [];
    for (const p of mine) {
      const gone = published.has(p.key) || emitted.has(p.key) || (p.kind !== "number" && (p.due === null || !dueAfter(p.due, target) || !liveByKey.has(p.key)));
      if (gone) deletePending(db, p.key);
      else keep.push(p);
    }
    const groups = new Map<string, PendingChange[]>();
    for (const p of keep) {
      const g = p.kind === "number" ? `number\n${p.changedOn}` : `${p.kind}\n${p.due}`;
      groups.set(g, [...(groups.get(g) ?? []), p]);
    }
    const rowsOf: RowsOf = (hashes) => hashes.map((h) => rowByHash(db, spec.id, h)).filter((r): r is StoredRow => r !== null);
    for (const list of groups.values()) out.push(list[0]!.kind === "number" ? numberDraft(spec, list, rowsOf) : deprecationDraft(spec, list, liveByKey, rowsOf));
  }
  return out.sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || a.source.localeCompare(b.source));
}

/** 소스를 받아 거르고 숫자 행을 저장한다. 소스 하나의 실패가 나머지를 막지 않는다 */
export async function fetchBuilder(o: FetchOptions): Promise<BuilderFetchReport> {
  const { db, http, now, target, dataDir, home } = o;
  const secrets = o.secrets ?? [];
  const off = o.off ?? DEFAULT_OFF;
  const clock = o.clock ?? Date.now;
  const started = clock();
  const deadline = started + (o.deadlineMs ?? BUILDER_DEADLINE_MS);
  const today = kstDate(now);
  const past = () => clock() >= deadline;
  const checkDeadline = () => {
    if (past()) fail("명령 전체 시간 상한을 넘었다");
  };
  const report: BuilderFetchReport = { target, fetchedAt: now.toISOString(), status: "checked", sources: [], docs: [], warnings: [], drafts: [], reminders: [], droppedByHost: 0, droppedByKey: 0, droppedByScan: 0 };
  const docContext: DocContext = { db, target, today, dataDir, home, secrets };
  for (const spec of BUILDER_SOURCES) {
    if (isOff(spec, off)) {
      report.sources.push({ id: spec.id, label: spec.label, status: "off" });
      continue;
    }
    const state = sourceState(db, spec.id);
    const w = windowOf(state.fetchedAt, now);
    const line: SourceReport = { id: spec.id, label: spec.label, status: "ok" };
    if (w.clampedFrom !== undefined) line.clampedFrom = w.clampedFrom;
    try {
      checkDeadline();
      const out = await one(spec, w, { http, checkDeadline, target, docContext });
      markSourceOk(db, spec.id);
      line.items = out.items;
      line.candidates = out.drafts.length;
      line.failDays = 0;
      report.drafts.push(...out.drafts);
      report.warnings.push(...out.warnings);
      report.droppedByHost += out.droppedByHost;
      if (out.doc) report.docs.push(out.doc);
    } catch (e) {
      const err = e as Error;
      line.status = "failed";
      line.reason = e instanceof SourceFailure ? err.message : err.name === "TimeoutError" || err.name === "AbortError" ? "시간 초과" : "받지 못했다";
      line.failDays = markSourceFailed(db, spec.id, today);
    }
    report.sources.push(line);
  }
  const published = publishedKeys(db);
  const emitted = emittedKeys(db);
  const docs = BUILDER_SOURCES.filter((s): s is DocSource => s.kind === "doc" && !isOff(s, off));
  const pending = pendingDrafts(db, target, docs, published, emitted);
  const all = [...pending, ...report.drafts];
  report.drafts = [];
  for (const d of all) {
    if (d.keys.every((k) => published.has(k) || emitted.has(k))) {
      report.droppedByKey++;
      continue;
    }
    // 키는 공개 백업에 들어간다. 걸리는 후보는 저장 전에 뺀다(4.5-1, B9)
    if (d.keys.some((k) => failsPublicScan(k, home, secrets))) {
      report.droppedByScan++;
      continue;
    }
    report.drafts.push(d);
  }
  if (report.droppedByScan > 0) report.warnings.push(`공개 검사에 걸린 후보 키 ${report.droppedByScan}개를 뺐다`);
  report.reminders = dueReminders(db, target);
  const active = report.sources.filter((s) => s.status !== "off");
  const failed = active.filter((s) => s.status === "failed").length;
  report.status = active.length > 0 && failed === active.length ? "failed" : failed > 0 ? "partial" : "checked";
  return report;
}

async function one(spec: BuilderSourceSpec, w: Window, o: { http: FetchText; checkDeadline: () => void; target: string; docContext: DocContext }): Promise<SourceOutput> {
  if (spec.kind === "ghsa") return fromGhsa(spec, w, o);
  const res = await o.http(spec.url);
  checkBody(res.status, res.text);
  switch (spec.kind) {
    case "release":
      return fromReleases(spec, res.text, w);
    case "feed":
      return fromFeed(spec, res.text, w);
    case "kev":
      return fromKev(spec, res.text, w);
    case "eol":
      return fromEol(spec, res.text, o.target);
    case "doc":
      return fromDoc(o.docContext, spec, res.text);
  }
}

