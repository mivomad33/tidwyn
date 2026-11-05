import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.ts";
import { officialSources, type OfficialSource } from "../src/demandSources.ts";
import { demandDbPath, openDemandDb, saveSnapshot, saveValueSnapshot } from "../src/demandStore.ts";
import type { ClaudeRequest, ClaudeResult, ClaudeRunner } from "../src/isolatedWriter.ts";
import { readFlowWork, type FlowCandidates } from "../src/demandFlowWork.ts";
import type { OfficialGroup } from "../src/demandFlowTypes.ts";
import { addDays, dateRange } from "../src/kst.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { addBrief } from "./builderFixtures.ts";
import { tempDir } from "./helpers.ts";

// 9.97단계 테스트의 지어낸 전용 DB와 가짜 격리 실행기. 글과 키는 모두 지어낸 값이다.

/** 대상 날짜(가장 늦은 브리프)와 KST 오늘. 날짜 소스의 창 끝은 대상 날짜 전날이다 */
export const TARGET = "2026-11-03";
export const TODAY = "2026-11-04";
export const NOW = new Date(`${TODAY}T07:00:00+09:00`);
export const END = "2026-11-02";
export const RECENT = dateRange("2026-10-27", END);
export const BASE = dateRange("2026-09-29", "2026-10-26");
/** 창보다 넉넉한 날짜 */
export const ALL = dateRange("2026-09-20", END);
export const isRecent = (d: string) => d >= RECENT[0]!;

/** 지어낸 글. 출력·실행 기록·요약에 나오면 안 된다(사이트에 싣는 단위 이름은 흐름 항목에만 있다) */
export const FAKE = {
  wiki: "Fake_Wiki_Topic_QZA",
  dart: "가짜공시종류QZB",
  sec: "Fake Industry QZC",
  corp: "가짜회사이름QZD",
  petition: "가짜청원제목QZE",
  qna: "가짜민원질문QZF",
  agency: "가짜기관이름QZK",
  ftc: "가짜품목이름QZG",
  term: "가짜급상승어QZH",
  tag: "fakeTrendTagQZI",
  keyword: "가짜민원키워드QZJ",
} as const;
/** 메인이 읽는 출력·실행 기록·요약에 나오면 안 되는 글 */
export const SECRET_TEXTS = [FAKE.wiki, FAKE.wiki.replaceAll("_", " "), FAKE.dart, FAKE.sec, FAKE.corp, FAKE.petition, FAKE.qna, FAKE.agency, FAKE.ftc, FAKE.term, FAKE.tag, FAKE.keyword];

export function src(id: string): OfficialSource {
  const s = officialSources().find((x) => x.id === id);
  if (s === undefined) throw new Error(id);
  return s;
}

export interface Part {
  part: string;
  page?: number;
  absent?: boolean;
  body: string;
}

/** 값 날짜 스냅샷 하나를 넣는다. 받은 날은 기본으로 값 날짜 다음 날 */
export function putValue(db: DatabaseSync, source: string, valueDate: string, parts: Part[], fetchedOn = valueDate.length === 7 ? `${valueDate}-28` : addDays(valueDate, 1)): void {
  const s = src(source);
  saveValueSnapshot(db, {
    source,
    group: s.group,
    label: s.label,
    valueDate,
    fetchedOn,
    fetchedAt: `${fetchedOn}T06:30:00+09:00`,
    items: parts.length,
    total: null,
    elapsedMs: 0,
    parts: parts.map((p) => ({ part: p.part, page: p.page ?? 1, url: `https://fake.example/${source}/${valueDate}/${p.part}/${p.page ?? 1}`, absent: p.absent === true, body: Buffer.from(p.body) })),
  });
}

/** 날짜마다 스냅샷 */
export function series(db: DatabaseSync, source: string, days: readonly string[], partsOf: (d: string) => Part[] | null): void {
  for (const d of days) {
    const p = partsOf(d);
    if (p !== null) putValue(db, source, d, p);
  }
}

export const wikiPart = (articles: [string, number][]): Part => ({ part: "top", body: JSON.stringify({ items: [{ articles: articles.map(([article, views], i) => ({ article, views, rank: i + 1 })) }] }) });
export const wikiAbsent = (): Part => ({ part: "top", absent: true, body: JSON.stringify({ type: "about:blank", title: "Not found." }) });
export const dartPart = (kinds: string[]): Part => ({ part: "list", body: JSON.stringify({ status: "000", list: kinds.map((k, i) => ({ corp_name: FAKE.corp, report_nm: k, rcept_no: String(i) })) }) });
export const secParts = (industries: string[]): Part[] =>
  industries.map((x, i) => ({ part: "doc", page: i + 1, body: `<?xml version="1.0"?><edgarSubmission><primaryIssuer><entityName>${FAKE.corp}</entityName></primaryIssuer><offeringData><industryGroup><industryGroupType>${x}</industryGroupType></industryGroup></offeringData></edgarSubmission>` }));
export const qnaParts = (rows: { ancName: string; ancCode?: string }[], absentItems: number[] = []): Part[] => [
  { part: "list", page: 1, body: JSON.stringify({ resultCode: "S00", resultList: rows.map((r) => ({ ...r, title: FAKE.qna })) }) },
  ...absentItems.map((p) => ({ part: "item", page: p, absent: true, body: "" })),
];
export const bigdataPart = (names: string[]): Part => ({ part: "topics", body: JSON.stringify(names.map((n, i) => ({ topic: n, rank: i + 1 }))) });
export const assemblyPart = (service: string, rows: Record<string, unknown>[]): Part => ({ part: "list", body: JSON.stringify({ [service]: [{ head: [{ list_total_count: rows.length }] }, { row: rows }] }) });

export interface FtcItem {
  /** 입력일 YYYY-MM-DD */
  d: string;
  code: string;
}
export const ftcPart = (items: FtcItem[]): Part => ({
  part: "list",
  body: JSON.stringify({ resultCode: "00", items: items.map((x) => ({ inptDate: x.d.replaceAll("-", ""), prdlstLclasCd: "L1", prdlstLclasNm: "가짜대분류", prdlstMlsfcCd: x.code, prdlstMlsfcNm: `${FAKE.ftc}${x.code}`, prdlstSclasNm: "가짜소분류", sexdstn: "F", age: "30", area: "서울" })) }),
});
export const repeat = <T>(n: number, v: T): T[] => Array.from({ length: n }, () => v);

/**
 * 비교 창을 채운 공식 묶음 셋(Wikimedia en, DART, SEC)과 각각 오른 단위 하나. 나머지 소스는 기록이 없다.
 * wiki: 앞 28일 하루 1만, 최근 7일 하루 5만 → 최근 350,000, 같은 길이 평균 70,000
 * dart: 하루 1건 → 7건 → 49, 7 / sec: 하루 1건 → 3건 → 21, 7
 */
export function seedRising(db: DatabaseSync, groups: readonly ("wikimedia" | "dart" | "sec")[] = ["wikimedia", "dart", "sec"]): void {
  if (groups.includes("wikimedia")) series(db, "wikimedia:en", ALL, (d) => [wikiPart([["Main_Page", 900_000], [FAKE.wiki, isRecent(d) ? 50_000 : 10_000], ["Fake_Flat_QZ", 30_000]])]);
  if (groups.includes("dart")) series(db, "dart:list", ALL, (d) => [dartPart([...repeat(isRecent(d) ? 7 : 1, FAKE.dart), "가짜평범공시"])]);
  if (groups.includes("sec")) series(db, "sec:formd", ALL, (d) => secParts([...repeat(isRecent(d) ? 3 : 1, FAKE.sec), "Fake Flat Industry"]));
}

/** 9.95 보조 근거 스냅샷(Google 급상승어, Mastodon 태그) */
export function seedAux(db: DatabaseSync, day = TODAY): void {
  const rss = `<?xml version="1.0"?><rss><channel><title>Daily Search Trends</title><item><title>${FAKE.term}</title></item></channel></rss>`;
  saveSnapshot(db, { source: "google:KR", group: "google", label: "KR", fetchedOn: day, valueDate: day, fetchedAt: `${day}T06:00:00+09:00`, parts: [{ part: "rss", page: 1, url: "https://trends.google.com/trending/rss?geo=KR", body: Buffer.from(rss) }] });
  saveSnapshot(db, { source: "mastodon:fake.example", group: "mastodon", label: "fake.example", fetchedOn: day, valueDate: day, fetchedAt: `${day}T06:00:00+09:00`, parts: [{ part: "tags", page: 1, url: "https://fake.example/api/v1/trends/tags", body: Buffer.from(JSON.stringify([{ name: FAKE.tag }])) }] });
}

export interface FlowEnv {
  dataDir: string;
  db: DatabaseSync;
  demandFile: string;
  /** 전용 DB를 쓰기로 연다(지어낸 데이터를 넣을 때만) */
  demand(): DatabaseSync;
}

/** 본 DB(브리프가 있는)와 데이터 폴더. 전용 DB는 seed를 부를 때 만든다 */
export function flowEnv(briefs: readonly string[] = [TARGET]): FlowEnv {
  const dataDir = tempDir("tidwyn-flow-");
  const db = openDb(path.join(dataDir, "tidwyn.db"));
  if (briefs.length > 0) recordFirstCollectionDate(db, briefs[0]!);
  for (const d of briefs) addBrief(db, d);
  const demandFile = demandDbPath(dataDir);
  return { dataDir, db, demandFile, demand: () => openDemandDb(demandFile) };
}

export function seeded(groups?: readonly ("wikimedia" | "dart" | "sec")[], aux = false): FlowEnv {
  const e = flowEnv();
  const d = e.demand();
  seedRising(d, groups);
  if (aux) seedAux(d);
  d.close();
  return e;
}

// ---- 가짜 격리 실행기 ----

export interface FakeWriter {
  run: ClaudeRunner;
  reqs: ClaudeRequest[];
  copies: string[];
  listings: string[][];
}

/** write가 null이면 흐름 파일을 쓰지 않는다. 문자열이면 그대로, 아니면 JSON으로 쓴다 */
export function fakeWriter(write: (round: number, cwd: string) => unknown, result: ClaudeResult | ((round: number) => ClaudeResult) = { status: 0, timedOut: false }, onRun?: () => void): FakeWriter {
  const f: FakeWriter = {
    reqs: [],
    copies: [],
    listings: [],
    run: (r) => {
      f.reqs.push(r);
      f.listings.push(fs.readdirSync(r.cwd).sort());
      f.copies.push(fs.readFileSync(path.join(r.cwd, "candidates.md"), "utf8"));
      onRun?.();
      const v = write(f.reqs.length, r.cwd);
      if (v !== null) fs.writeFileSync(path.join(r.cwd, "flows.json"), typeof v === "string" ? v : JSON.stringify(v));
      return typeof result === "function" ? result(f.reqs.length) : result;
    },
  };
  return f;
}

/** 후보 복사본의 기계 원본(번호와 묶음만 쓴다) */
export function candidatesOf(dataDir: string): FlowCandidates {
  const r = readFlowWork(dataDir);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
}

export const firstOf = (d: FlowCandidates, g: OfficialGroup): number => {
  const u = d.units.find((x) => x.group === g);
  if (u === undefined) throw new Error(`${g} 단위가 없다`);
  return u.n;
};

export const GOOD_TEXT = { title: "인공지능 도구에 대한 관심이 함께 올랐다", summary: "위키 문서 조회와 기업 공시가 같은 시기에 함께 늘었다.", reason: "같은 주제의 관심과 자금 움직임이 겹친다" };

export function flowOf(units: number[], o: Record<string, unknown> = {}): Record<string, unknown> {
  return { category: "interest", field: "software", ...GOOD_TEXT, units, ...o };
}

/** 대상 날짜의 맞는 흐름 파일(묶음마다 첫 단위를 잇는다) */
export function goodFile(d: FlowCandidates, groups: OfficialGroup[] = ["wikimedia", "dart"], o: Record<string, unknown> = {}): Record<string, unknown> {
  return { targetDate: d.target, flows: [flowOf(groups.map((g) => firstOf(d, g)))], excluded: [], ...o };
}
