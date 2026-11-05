import { createHash } from "node:crypto";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { officialSources, type OfficialKind, type OfficialSource } from "./demandSources.ts";
import { getMeta, unpackBody } from "./demandStore.ts";
import { BASE_DAYS, GROUP_INFO, RECENT_DAYS, type OfficialGroup } from "./demandFlowTypes.ts";
import { addDays, dateRange, daysBetween } from "./kst.ts";
import { ftcCheckKey, lastValueDate } from "./officialDemand.ts";
import { addMonths } from "./schedules.ts";

// 9.97단계 4.1-1(S5): 전용 DB의 스냅샷 원문을 풀어 소스마다 단위를 날마다 세고, 비교 창(최근 7일과 앞 28일)으로 오른 단위를 뽑는다.
// 전용 DB는 읽기 전용으로 연다(4.3-2). 받은 글은 단위 이름과 재료로만 돌려주고, 출력하지 않는다(부르는 쪽이 후보 복사본에만 쓴다).
// 규칙의 값(하한, 오름 기준, 상위 수, 오래됨 날 수)은 UNIT_RULES 한 곳에 두고 판정 문서의 "수요 흐름(9.97단계)" 절에 같은 값을 적는다.

/** 자료 없음 날이 이만큼이면 소스를 뺀다(S5) */
export const MAX_ABSENT_RECENT = 2;
export const MAX_ABSENT_BASE = 7;
/** 국회 목록은 그날 상태 스냅샷이 이만큼 쌓이기 전에는 근거로 세지 않는다(S5) */
export const ASSEMBLY_MIN_DAYS = 35;
/** 1372 끝난 달을 완성으로 보는, 말일 뒤 날 수(S5) */
export const FTC_COMPLETE_DAYS = 14;
/** Wikimedia 봇 급등: 7일 합의 이 비율 이상이 하루에 몰리면 뺀다(4.1-1) */
export const WIKI_SPIKE_RATIO = 0.8;

export interface UnitRule {
  /** 최근 7일 값의 규모 하한 */
  floor: number;
  /** 오름 기준: 최근 7일 값이 앞 28일 같은 길이 평균의 이 배 이상 */
  ratio: number;
  /** 후보 복사본에 넣는 상위 수(소스마다) */
  top: number;
  /** 창 끝이 대상 날짜보다 이 날 수를 넘어 오래되면 '오래됨' */
  staleDays: number;
}

/** 소스 종류마다의 규칙(4.1-1). 판정 문서의 표와 테스트가 대조한다 */
export const UNIT_RULES: Record<OfficialKind, UnitRule> = {
  assembly: { floor: 300, ratio: 2, top: 8, staleDays: 3 },
  "acrc-qna": { floor: 5, ratio: 2, top: 8, staleDays: 3 },
  "acrc-proposal": { floor: 5, ratio: 2, top: 8, staleDays: 3 },
  "acrc-bigdata": { floor: 3, ratio: 2, top: 8, staleDays: 3 },
  "ftc-1372": { floor: 15, ratio: 1.5, top: 12, staleDays: 35 },
  dart: { floor: 20, ratio: 2, top: 10, staleDays: 3 },
  "sec-formd": { floor: 10, ratio: 1.5, top: 8, staleDays: 4 },
  wikimedia: { floor: 100_000, ratio: 3, top: 6, staleDays: 4 },
};

/** 외부인이 쓴 글이 단위의 재료인 소스(S7: 사이트에 어떤 이름도 싣지 않는다) */
export const EXTERNAL_KINDS: readonly OfficialKind[] = ["assembly", "acrc-qna", "acrc-proposal"];
/** 값이 '목록에 든 날의 합'인 상위 목록 소스(4.1-1) */
export const TOP_LIST_KINDS: readonly OfficialKind[] = ["wikimedia", "acrc-bigdata"];

export type SourceState = "ok" | "unfetched" | "absent" | "stale" | "short" | "nodata" | "off";
export const SOURCE_STATE_NAMES: Record<SourceState, string> = { ok: "비교함", unfetched: "받지 못한 날 있음", absent: "자료 없음 날 많음", stale: "오래됨", short: "기록 부족", nodata: "기록 없음", off: "꺼짐" };

export interface UnitCount {
  name: string | null;
  value: number;
  /** 격리 프로세스만 읽는 재료(받은 글) */
  material: string[];
}

/** 값 날짜 하나: 자료 없음이거나 단위마다의 값 */
type DayData = { absent: true } | { absent: false; units: Map<string, UnitCount> };

export interface WindowInfo {
  recentFrom: string;
  recentTo: string;
  baseFrom: string;
  baseTo: string;
  /** 자료 없음 날을 뺀 날 수 */
  recentDays: number;
  baseDays: number;
}

export interface RisingUnit {
  key: string;
  source: string;
  group: OfficialGroup;
  /** 사이트에 싣는 이름. 외부인 글 소스는 null(S7) */
  name: string | null;
  /** 최근 7일 값(자료 없음 날 뺌) */
  recent: number;
  /** 앞 28일을 최근 날 수에 맞춘 평균(소수 한 자리) */
  base: number;
  isNew: boolean;
  /** 최근 날마다 값(자료 없음 날은 null). 근거 수준의 4일 조건에 쓴다 */
  recentDaily: (number | null)[];
  /** 앞 28일의 일평균 */
  baseDailyMean: number;
  material: string[];
  window: WindowInfo;
}

export interface SourceUnits {
  source: string;
  group: OfficialGroup;
  kind: OfficialKind;
  label: string;
  state: SourceState;
  window: WindowInfo | null;
  /** 창에서 센 단위 수 */
  unitCount: number;
  /** 오른 단위(점수 순, 상위 수만큼) */
  rising: RisingUnit[];
  /** 상위 수로 자르기 전 오른 단위 수 */
  risingAll: number;
}

export interface UnitsOptions {
  target: string;
  sources?: readonly OfficialSource[];
  /** 꺼진 소스 id */
  off?: readonly string[];
  /**
   * 시험 전용(4.6-6): 이 날짜 07:00 KST의 운영 실행이 받았을 범위로 자른다. 날짜 소스는 그때의 마지막 값 날짜까지,
   * 1372는 입력일이 이 날짜보다 ftcLagDays 넘게 앞선 것만 있고 모든 달 스냅샷을 그날 받은 것으로 본다
   */
  asOf?: { date: string; ftcLagDays: number };
  /** 시험 전용(4.6-6): 비교 창 길이. 기본 7일과 28일. 자료 없음 날 기준은 같은 비율로 늘린다 */
  recentDays?: number;
  baseDays?: number;
}

export const hash16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const clip = (s: string, n = 200) => ([...s].length > n ? [...s].slice(0, n).join("") + "…" : s);

// ---- 전용 DB 열기 ----

export type DemandOpen = { state: "missing" } | { state: "broken" } | { state: "ok"; db: DatabaseSync };

/** 전용 DB를 읽기 전용으로 연다. 없으면 missing, 열거나 읽을 수 없으면 broken. 마이그레이션하지 않는다 */
export function openDemandReadOnly(file: string): DemandOpen {
  if (!fs.existsSync(file)) return { state: "missing" };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const v = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (v < 2) throw new Error("schema");
    db.prepare("SELECT COUNT(*) FROM demand_values").get();
    db.prepare("SELECT COUNT(*) FROM demand_snapshots").get();
    return { state: "ok", db };
  } catch {
    db?.close();
    return { state: "broken" };
  }
}

// ---- 원문 읽기 ----

interface ValueRow {
  id: number;
  value_date: string;
  fetched_on: string;
  fetched_at: string;
}

/** 값 날짜마다 가장 최근 스냅샷 */
function latestValues(db: DatabaseSync, source: string): Map<string, ValueRow> {
  const rows = db.prepare("SELECT id, value_date, fetched_on, fetched_at FROM demand_values WHERE source = ? ORDER BY id").all(source) as unknown as ValueRow[];
  const out = new Map<string, ValueRow>();
  for (const r of rows) out.set(r.value_date, r);
  return out;
}

interface PartRow {
  part: string;
  page: number;
  absent: number;
  text: string;
}

function partsOf(db: DatabaseSync, valueId: number): PartRow[] {
  const rows = db.prepare("SELECT part, page, absent, encoding, body FROM demand_value_parts WHERE value_id = ? ORDER BY part, page").all(valueId) as { part: string; page: number; absent: number; encoding: string; body: Uint8Array }[];
  return rows.map((r) => ({ part: r.part, page: r.page, absent: r.absent, text: unpackBody(r.encoding, r.body).toString("utf8") }));
}

const asObj = (v: unknown): Record<string, unknown> => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

class Counter {
  readonly units = new Map<string, UnitCount>();
  add(key: string, name: string | null, value: number, material?: string): void {
    let u = this.units.get(key);
    if (u === undefined) this.units.set(key, (u = { name, value: 0, material: [] }));
    u.value += value;
    if (material !== undefined && material !== "" && u.material.length < 3 && !u.material.includes(clip(material))) u.material.push(clip(material));
  }
}

// ---- Wikimedia ----

const WIKI_MAIN_PAGES = new Set(["Main_Page", "メインページ", "Заглавная_страница", "Pagina_principale", "-"]);
const WIKI_NAMESPACES = new Set(
  ["special", "특수기능", "spezial", "spécial", "especial", "speciale", "служебная", "特別", "特殊", "wikipedia", "википедия", "ウィキペディア", "위키백과", "wikipédia", "file", "datei", "fichier", "archivo", "файл", "ファイル", "파일", "file", "portal", "portail", "help", "hilfe", "aide", "ayuda", "category", "kategorie", "catégorie", "categoría", "категория", "カテゴリ", "분류", "分类", "user", "benutzer", "utilisateur", "usuario", "utente", "участник", "利用者", "사용자", "template", "vorlage", "modèle", "plantilla", "шаблон", "テンプレート", "틀", "talk", "diskussion", "discussion", "discusión", "discussione", "обсуждение", "ノート", "토론", "特殊", "ヘルプ", "도움말", "포털", "ポータル", "portale", "портал"].map((s) => s.toLowerCase()),
);

/** 대문·특수 문서(4.1-1). 이름공간 접두어가 있거나 정해 둔 대문 이름이다 */
export function isWikiSpecial(article: string): boolean {
  if (WIKI_MAIN_PAGES.has(article)) return true;
  const i = article.indexOf(":");
  return i > 0 && WIKI_NAMESPACES.has(article.slice(0, i).toLowerCase());
}

function wikiDay(source: string, parts: PartRow[]): DayData {
  const top = parts.find((p) => p.part === "top");
  if (top === undefined || top.absent === 1) return { absent: true };
  const c = new Counter();
  for (const a of asArr(asObj(asArr(asObj(parse(top.text)).items)[0]).articles)) {
    const o = asObj(a);
    const article = str(o.article);
    const views = Number(o.views);
    if (article === "" || !Number.isFinite(views) || isWikiSpecial(article)) continue;
    const name = article.replaceAll("_", " ");
    c.add(`${source}:${hash16(article)}`, name, views, name);
  }
  return { absent: false, units: c.units };
}

// ---- SEC Form D ----

function xmlValue(xml: string, tag: string): string | null {
  const m = new RegExp(`<(?:[\\w.-]+:)?${tag}\\b[^>]*>([^<]*)<`).exec(xml);
  return m === null ? null : m[1]!.trim();
}

function secDay(source: string, parts: PartRow[]): DayData {
  const c = new Counter();
  for (const p of parts) {
    if (p.part !== "doc" || p.absent === 1) continue;
    const industry = xmlValue(p.text, "industryGroupType");
    if (industry === null || industry === "") continue;
    c.add(`${source}:${hash16(industry)}`, industry, 1, xmlValue(p.text, "entityName") ?? undefined);
  }
  return { absent: false, units: c.units };
}

// ---- DART ----

/** 공시 종류: 앞의 [정정] 표시와 끝의 (YYYY.MM) 같은 기간 괄호를 뺀 보고서 이름 */
export function dartKind(reportName: string): string {
  return reportName
    .replace(/^\s*(?:\[[^\]]*\]\s*)+/, "")
    .replace(/\s*\(\d{4}\.\d{2}\)\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dartDay(source: string, parts: PartRow[]): DayData {
  const c = new Counter();
  for (const p of parts) {
    if (p.part !== "list") continue;
    for (const r of asArr(asObj(parse(p.text)).list)) {
      const o = asObj(r);
      const kind = dartKind(str(o.report_nm));
      if (kind === "") continue;
      c.add(`${source}:${hash16(kind)}`, kind, 1, str(o.corp_name));
    }
  }
  return { absent: false, units: c.units };
}

// ---- 권익위 ----

function acrcListDay(source: string, parts: PartRow[], qna: boolean): DayData {
  const rows: Record<string, unknown>[] = [];
  for (const p of parts.filter((x) => x.part === "list").sort((a, b) => a.page - b.page)) for (const r of asArr(asObj(parse(p.text)).resultList)) rows.push(asObj(r));
  const absentItems = new Set(parts.filter((p) => p.part === "item" && p.absent === 1).map((p) => p.page));
  const c = new Counter();
  rows.forEach((o, i) => {
    // 상세가 자료 없음인 항목은 그 항목만 뺀다(S5)
    if (absentItems.has(i + 1)) return;
    const agency = str(o.ancName);
    const code = qna ? str(o.ancCode) : "";
    const id = code !== "" ? code : hash16(agency);
    c.add(`${source}:${id}`, null, 1, [agency, str(o.title)].filter((x) => x !== "").join(" · "));
  });
  return { absent: false, units: c.units };
}

/** 민원빅데이터 이슈 한 줄의 키워드 칸. 칸 이름을 실제 응답으로 확인하지 못해 이름 규칙으로 고른다 */
const BIGDATA_NAME_RE = /^(?:keyword|kwrd|topic|issue|title|word|name|kwd)/i;
function bigdataName(o: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(o)) if (BIGDATA_NAME_RE.test(k) && typeof v === "string" && v.trim() !== "") return v.trim();
  return "";
}

function bigdataDay(source: string, parts: PartRow[]): DayData {
  const c = new Counter();
  const seen = new Set<string>();
  for (const p of parts) {
    for (const r of asArr(parse(p.text))) {
      const name = bigdataName(asObj(r));
      if (name === "" || seen.has(name)) continue;
      seen.add(name);
      c.add(`${source}:${hash16(name)}`, name, 1, name);
    }
  }
  return { absent: false, units: c.units };
}

// ---- 국회(그날 상태 스냅샷의 차이) ----

interface AssemblyRow {
  id: string;
  unit: string;
  count: number;
  title: string;
}

function assemblyRows(s: OfficialSource, parts: PartRow[]): AssemblyRow[] {
  const out: AssemblyRow[] = [];
  for (const p of parts) {
    const j = asObj(parse(p.text));
    const blocks = asArr(j[s.service!]);
    for (const r of asArr(asObj(blocks[1]).row)) {
      const o = asObj(r);
      const id = str(o.PTT_ID) || str(o.BILL_ID) || str(o.BILL_NO) || str(o.PTT_NO);
      if (id === "") continue;
      const committee = str(o.CURR_COMMITTEE_ID) || (str(o.CURR_COMMITTEE) === "" ? "" : hash16(str(o.CURR_COMMITTEE)));
      out.push({ id, unit: s.id === "assembly:received" ? id : s.id === "assembly:pending" ? committee || "none" : "all", count: Number(o.CITZN_AGM_CNT) || 0, title: str(o.PTT_NM) || str(o.BILL_NAME) });
    }
  }
  return out;
}

/** 접수목록은 청원마다 그날 늘어난 동의 수, 계류현황은 위원회마다 새로 든 청원 수, 처리현황은 새로 처리된 청원 수 */
function assemblyDiff(s: OfficialSource, today: AssemblyRow[], before: AssemblyRow[]): DayData {
  const c = new Counter();
  if (s.id === "assembly:received") {
    const prev = new Map(before.map((r) => [r.id, r.count]));
    for (const r of today) {
      const gain = r.count - (prev.get(r.id) ?? 0);
      if (gain > 0) c.add(`${s.id}:${r.unit}`, null, gain, r.title);
    }
  } else {
    const prev = new Set(before.map((r) => `${r.unit}\0${r.id}`));
    for (const r of today) if (!prev.has(`${r.unit}\0${r.id}`)) c.add(`${s.id}:${r.unit}`, null, 1, r.title);
  }
  return { absent: false, units: c.units };
}

// ---- 1372(접수 월 스냅샷을 입력일로 센다) ----

const monthEnd = (ym: string) => addDays(`${addMonths(ym, 1)}-01`, -1);
/**
 * 창에 들 수 있는 가장 이른 접수 월: 대상 날짜의 달보다 4달 앞. 창 끝은 '오래됨' 기준(35일) 안이라 창의 첫날은 대상 날짜의 3달 앞 달 안이고,
 * 그날 입력은 그 달과 앞 달 접수에 든다. 이보다 앞선 달은 끝난 지 3달이 넘어 완성된 달이다
 */
const FTC_MONTHS_BACK = 4;

interface FtcMonth {
  ym: string;
  fetchedOn: string;
  complete: boolean;
  /** 입력일 → 단위 → 값 */
  days: Map<string, Map<string, UnitCount>>;
  latestInput: string | null;
}

/**
 * 완성된 달(S5, 2026-11-04 사용자 결정): 끝난 달 중 마지막 스냅샷을 말일 14일 이상 뒤에 받았거나, 말일 14일 이상 뒤에 건수를 확인했고 그 뒤 새 스냅샷이 없거나,
 * 끝난 지 3달째부터인 달. now는 KST 날짜다
 */
export function isFtcMonthComplete(ym: string, today: string, lastFetchedOn: string, checkedOn: string | null): boolean {
  const end = monthEnd(ym);
  if (today <= end) return false;
  const threshold = addDays(end, FTC_COMPLETE_DAYS);
  if (lastFetchedOn >= threshold) return true;
  if (checkedOn !== null && checkedOn >= threshold && checkedOn >= lastFetchedOn) return true;
  return today.slice(0, 7) >= addMonths(ym, 3);
}

/** 접수 월 스냅샷을 푼다. from이 있으면 그보다 앞선 달은 풀지 않는다(skipped에 그런 달이 있었는지) */
function ftcMonths(db: DatabaseSync, s: OfficialSource, today: string, asOf: UnitsOptions["asOf"], from: string | null): { months: FtcMonth[]; skipped: boolean } {
  const out: FtcMonth[] = [];
  let skipped = false;
  const cut = asOf === undefined ? null : addDays(asOf.date, -asOf.ftcLagDays);
  for (const [ym, row] of [...latestValues(db, s.id)].sort(([a], [b]) => a.localeCompare(b))) {
    if (asOf !== undefined && ym > asOf.date.slice(0, 7)) continue;
    if (from !== null && ym < from) {
      skipped = true;
      continue;
    }
    const fetchedOn = asOf === undefined ? row.fetched_on : asOf.date;
    const checked = asOf === undefined ? (getMeta(db, ftcCheckKey(s.id, ym))?.slice(0, 10) ?? null) : null;
    const days = new Map<string, Map<string, UnitCount>>();
    let latest: string | null = null;
    for (const p of partsOf(db, row.id)) {
      for (const it of asArr(asObj(parse(p.text)).items)) {
        const o = asObj(it);
        const raw = str(o.inptDate).replace(/\D/g, "");
        if (raw.length < 8) continue;
        const d = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        if (cut !== null && d > cut) continue;
        const code = str(o.prdlstMlsfcCd) || str(o.prdlstLclasCd);
        if (code === "") continue;
        const name = [str(o.prdlstLclasNm), str(o.prdlstMlsfcNm)].filter((x) => x !== "").join(" > ") || null;
        let m = days.get(d);
        if (m === undefined) days.set(d, (m = new Map()));
        const key = `${s.id}:${code}`;
        const u = m.get(key);
        const small = str(o.prdlstSclasNm);
        if (u === undefined) m.set(key, { name, value: 1, material: small === "" ? [] : [small] });
        else {
          u.value++;
          if (small !== "" && u.material.length < 3 && !u.material.includes(small)) u.material.push(small);
        }
        if (latest === null || d > latest) latest = d;
      }
    }
    out.push({ ym, fetchedOn, complete: isFtcMonthComplete(ym, asOf?.date ?? today, fetchedOn, checked), days, latestInput: latest });
  }
  return { months: out, skipped };
}

// ---- 비교 창 ----

interface Series {
  /** 창 끝 후보(받은 마지막 값 날짜) */
  end: string | null;
  /** 값 날짜 → 그날 값. 없는 날짜는 받지 못함 */
  day: (d: string) => DayData | null;
  /** 받은 값 날짜 수(국회의 35일 조건) */
  fetchedDays: number;
}

function dateSeries(db: DatabaseSync, s: OfficialSource, cap: string): Series {
  const values = latestValues(db, s.id);
  const dates = [...values.keys()].filter((d) => d <= cap).sort();
  const cache = new Map<string, DayData>();
  const reader: Record<string, (src: string, p: PartRow[]) => DayData> = {
    wikimedia: wikiDay,
    "sec-formd": secDay,
    dart: dartDay,
    "acrc-qna": (src, p) => acrcListDay(src, p, true),
    "acrc-proposal": (src, p) => acrcListDay(src, p, false),
    "acrc-bigdata": bigdataDay,
  };
  return {
    end: dates.at(-1) ?? null,
    fetchedDays: dates.length,
    day: (d) => {
      if (d > cap) return null;
      const row = values.get(d);
      if (row === undefined) return null;
      let v = cache.get(d);
      if (v === undefined) cache.set(d, (v = reader[s.kind]!(s.id, partsOf(db, row.id))));
      return v;
    },
  };
}

function assemblySeries(db: DatabaseSync, s: OfficialSource, cap: string): Series {
  const values = latestValues(db, s.id);
  const dates = [...values.keys()].filter((d) => d <= cap).sort();
  const rows = new Map<string, AssemblyRow[]>();
  const rowsOf = (d: string) => {
    let r = rows.get(d);
    if (r === undefined) rows.set(d, (r = assemblyRows(s, partsOf(db, values.get(d)!.id))));
    return r;
  };
  return {
    end: dates.at(-1) ?? null,
    fetchedDays: dates.length,
    day: (d) => (d > cap || !values.has(d) || !values.has(addDays(d, -1)) ? null : assemblyDiff(s, rowsOf(d), rowsOf(addDays(d, -1)))),
  };
}

function ftcSeries(db: DatabaseSync, s: OfficialSource, target: string, today: string, asOf: UnitsOptions["asOf"]): Series {
  // 앞선 달은 창 끝과 값에 들지 않아 풀지 않는다. 다만 남은 달에 입력이 하나도 없으면 창 끝(오래됨 판정)이 앞선 달의 입력에 달려 모두 푼다
  const recentMonths = ftcMonths(db, s, today, asOf, addMonths(target.slice(0, 7), -FTC_MONTHS_BACK));
  const months = recentMonths.skipped && recentMonths.months.every((m) => m.latestInput === null) ? ftcMonths(db, s, today, asOf, null).months : recentMonths.months;
  if (months.length === 0) return { end: null, fetchedDays: 0, day: () => null };
  const open = months.filter((m) => !m.complete);
  const latestInput = months.map((m) => m.latestInput).filter((x): x is string => x !== null).sort().at(-1) ?? null;
  const ends = [addDays(target, -1), ...open.map((m) => addDays(m.fetchedOn, -1)), ...(latestInput === null ? [] : [addDays(latestInput, -1)])];
  const end = latestInput === null ? null : ends.sort()[0]!;
  const byYm = new Map(months.map((m) => [m.ym, m]));
  const first = months[0]!.ym;
  return {
    end,
    fetchedDays: months.length,
    day: (d) => {
      // 그날 입력일이 들 수 있는 접수 월: 그 달과 앞 달(받아 둔 범위 안). 그 달이 받아 둔 범위 밖이면 받지 못함
      const ym = d.slice(0, 7);
      if (ym < first || !byYm.has(ym)) return null;
      const units = new Map<string, UnitCount>();
      for (const m of [byYm.get(addMonths(ym, -1)), byYm.get(ym)]) {
        for (const [k, u] of m?.days.get(d) ?? []) {
          const x = units.get(k);
          if (x === undefined) units.set(k, { name: u.name, value: u.value, material: [...u.material] });
          else x.value += u.value;
        }
      }
      return { absent: false, units };
    },
  };
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 소스 하나의 창과 오른 단위(4.1-1, S5) */
export function sourceUnits(db: DatabaseSync, s: OfficialSource, target: string, today: string, o: UnitsOptions): SourceUnits {
  const rule = UNIT_RULES[s.kind];
  const base: SourceUnits = { source: s.id, group: s.group as OfficialGroup, kind: s.kind, label: s.label, state: "nodata", window: null, unitCount: 0, rising: [], risingAll: 0 };
  if (o.off?.includes(s.id) === true) return { ...base, state: "off" };
  // 시험 전용 asOf: 그날 07:00 KST 실행이 받을 수 있었던 마지막 값 날짜까지
  const dayBefore = addDays(target, -1);
  const asOfCap = o.asOf === undefined ? dayBefore : lastValueDate(s, new Date(`${o.asOf.date}T07:00:00+09:00`));
  const cap = asOfCap < dayBefore ? asOfCap : dayBefore;
  const series = s.kind === "ftc-1372" ? ftcSeries(db, s, target, today, o.asOf) : s.kind === "assembly" ? assemblySeries(db, s, cap) : dateSeries(db, s, cap);
  if (series.end === null) return base;
  if (s.kind === "assembly" && series.fetchedDays < ASSEMBLY_MIN_DAYS) return { ...base, state: "short" };
  const end = series.end;
  if (daysBetween(end, target) > rule.staleDays) return { ...base, state: "stale" };
  const R = o.recentDays ?? RECENT_DAYS;
  const B = o.baseDays ?? BASE_DAYS;
  const recentDates = dateRange(addDays(end, -(R - 1)), end);
  const baseDates = dateRange(addDays(end, -(R + B - 1)), addDays(end, -R));
  const data = [...baseDates, ...recentDates].map((d) => series.day(d));
  if (data.some((x) => x === null)) return { ...base, state: "unfetched" };
  const days = data as DayData[];
  const absentRecent = days.slice(B).filter((x) => x.absent).length;
  const absentBase = days.slice(0, B).filter((x) => x.absent).length;
  if (absentRecent >= Math.ceil((MAX_ABSENT_RECENT * R) / RECENT_DAYS) || absentBase >= Math.ceil((MAX_ABSENT_BASE * B) / BASE_DAYS)) return { ...base, state: "absent" };
  const window: WindowInfo = { recentFrom: recentDates[0]!, recentTo: end, baseFrom: baseDates[0]!, baseTo: baseDates.at(-1)!, recentDays: R - absentRecent, baseDays: B - absentBase };
  const keys = new Map<string, { name: string | null; material: string[] }>();
  for (const d of days) if (!d.absent) for (const [k, u] of d.units) if (!keys.has(k)) keys.set(k, { name: u.name, material: u.material });
  const external = EXTERNAL_KINDS.includes(s.kind);
  const rising: (RisingUnit & { score: number })[] = [];
  const recentData = days.slice(B);
  for (const [key, info] of keys) {
    // 하한 미만이면 35일 값을 만들기 전에 건너뛴다
    let recent = 0;
    for (const d of recentData) if (!d.absent) recent += d.units.get(key)?.value ?? 0;
    if (recent < rule.floor) continue;
    const daily = days.map((d) => (d.absent ? null : (d.units.get(key)?.value ?? 0)));
    const recentDaily = daily.slice(B);
    const baseSum = daily.slice(0, B).reduce<number>((n, v) => n + (v ?? 0), 0);
    const baseDailyMean = baseSum / window.baseDays;
    const baseAvg = round1(baseDailyMean * window.recentDays);
    if (baseSum > 0 && recent < rule.ratio * baseAvg) continue;
    if (s.kind === "wikimedia" && Math.max(...recentDaily.map((v) => v ?? 0)) >= WIKI_SPIKE_RATIO * recent) continue;
    rising.push({ key, source: s.id, group: s.group as OfficialGroup, name: external ? null : info.name, recent, base: baseAvg, isNew: baseSum === 0, recentDaily, baseDailyMean, material: info.material, window, score: (recent - baseAvg) / Math.sqrt(baseAvg + rule.floor) });
  }
  rising.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  const top = rising.slice(0, rule.top).map((u): RisingUnit => {
    const { score, ...unit } = u;
    void score;
    return unit;
  });
  return { ...base, state: "ok", window, unitCount: keys.size, rising: top, risingAll: rising.length };
}

export interface GroupUnits {
  group: OfficialGroup;
  /** 창을 채운 소스가 하나라도 있는지 */
  compared: boolean;
  /** 창을 채우지 못한 소스의 사유 종류 */
  reasons: SourceState[];
  rising: number;
}

/** 공식 소스 모두의 오른 단위(4.1-1). 같은 묶음의 여러 소스는 한 묶음으로 센다 */
export function officialUnits(db: DatabaseSync, today: string, o: UnitsOptions): { sources: SourceUnits[]; groups: GroupUnits[] } {
  const sources = (o.sources ?? officialSources()).map((s) => sourceUnits(db, s, o.target, today, o));
  const groups: GroupUnits[] = [];
  for (const s of sources) {
    let g = groups.find((x) => x.group === s.group);
    if (g === undefined) groups.push((g = { group: s.group, compared: false, reasons: [], rising: 0 }));
    if (s.state === "ok") g.compared = true;
    else if (!g.reasons.includes(s.state)) g.reasons.push(s.state);
    g.rising += s.rising.length;
  }
  return { sources, groups };
}

// ---- 보조 근거(9.95 스냅샷의 이름) ----

export interface AuxCandidate {
  source: string;
  group: "google" | "mastodon";
  /** 사이트에 싣는 이름(Google Trends 나라, Mastodon 인스턴스) */
  label: string;
  /** 격리 프로세스만 읽는 이름(급상승어, 태그) */
  names: string[];
}

const AUX_MAX_NAMES = 20;

/** 대상 날짜부터 오늘까지 받은 9.95 스냅샷 중 소스마다 가장 최근 것의 이름(4.1-1) */
export function auxCandidates(db: DatabaseSync, target: string, today: string): AuxCandidate[] {
  const rows = db.prepare("SELECT id, source, grp, label FROM demand_snapshots WHERE fetched_on >= ? AND fetched_on <= ? ORDER BY id").all(target, today) as { id: number; source: string; grp: string; label: string }[];
  const latest = new Map<string, { id: number; grp: string; label: string }>();
  for (const r of rows) if (r.grp === "google" || r.grp === "mastodon") latest.set(r.source, r);
  const out: AuxCandidate[] = [];
  for (const [source, r] of [...latest].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = db.prepare("SELECT part, body FROM demand_parts WHERE snapshot_id = ? ORDER BY part, page").all(r.id) as { part: string; body: Uint8Array }[];
    const names: string[] = [];
    for (const p of parts) {
      const text = Buffer.from(p.body).toString("utf8");
      if (r.grp === "google") for (const m of text.matchAll(/<item>[\s\S]*?<title>([^<]*)<\/title>/g)) names.push(m[1]!.trim());
      else if (p.part === "tags") for (const t of asArr(parse(text))) names.push(str(asObj(t).name));
    }
    const clean = [...new Set(names.filter((n) => n !== ""))].slice(0, AUX_MAX_NAMES).map((n) => clip(n, 80));
    if (clean.length > 0) out.push({ source, group: r.grp as AuxCandidate["group"], label: `${GROUP_INFO[r.grp as AuxCandidate["group"]].credit} ${r.label}`, names: clean });
  }
  return out;
}
