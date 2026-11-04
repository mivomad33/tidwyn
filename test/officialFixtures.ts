import type { DatabaseSync } from "node:sqlite";
import { officialSources, type OfficialKind, type OfficialSource } from "../src/demandSources.ts";
import { demandDbPath, openDemandDb, unpackBody } from "../src/demandStore.ts";
import type { FetchInit, FetchResult, FetchText } from "../src/feeds.ts";
import { runOfficialDemand, type OfficialRunOptions } from "../src/officialDemand.ts";
import { addDays, dateRange } from "../src/kst.ts";
import { virtualTime } from "./demandFixtures.ts";
import { tempDir } from "./helpers.ts";

// 9.96단계 테스트의 가짜 공식 소스 응답. 글과 키는 모두 지어낸 값이다.

export const DAY = "2026-11-04";
export const NOW = new Date(`${DAY}T15:00:00+09:00`);
/** KST 어제, UTC 어제(15:00 KST는 06:00 UTC라 같다) */
export const LAST = "2026-11-03";
export const DATES = dateRange("2026-09-30", LAST);

export const KEYS = { DATA_GO_KR_KEY: "FAKE-DATAGOKR-KEY-0001", ASSEMBLY_API_KEY: "FAKEASSEMBLYKEY0002", DART_API_KEY: "FAKEDARTAPIKEY0003" } as const;

/** 지어낸 글. 버리는 칸(PERSON, PHONE, STREET, INSIDER)은 전용 DB에도 없어야 하고, 나머지는 출력·실행 기록·요약에 없어야 한다 */
export const FAKE = {
  title: "가짜청원제목하나",
  person: "가짜신청인이름",
  phone: "555-0100-9876",
  street: "77 Fakestreet Road",
  zip: "99001",
  company: "가짜회사이름",
  keyword: "가짜민원키워드",
  insider: "FAKEINSIDER PERSONNAME",
  article: "Fake_Article_Title",
} as const;
export const DROPPED = [FAKE.person, FAKE.phone, FAKE.street, FAKE.zip, FAKE.insider];
export const TEXTS = [FAKE.title, FAKE.company, FAKE.keyword, FAKE.article, ...DROPPED];

export type Reply = FetchResult | "hang" | "throw";

export interface Call {
  url: string;
  at: number;
  agent: string | undefined;
}

export interface FakeOpts {
  /** 국회 목록 건수 */
  assembly?: number;
  /** 질의응답·공개제안·DART의 날짜마다 건수 */
  perDay?: (kind: "qna" | "proposal" | "dart", day: string) => number;
  /** 1372 달마다 건수 */
  ftc?: (ym: string) => number;
  /** 분기 목록에 있는 SEC 인덱스의 마지막 날짜 */
  secLatest?: string;
  /** Wikimedia가 주는 마지막 날짜 */
  wikiLatest?: string;
}

const compactToIso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const weekday = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w !== 0 && w !== 6;
};
const ok = (v: unknown): FetchResult => ({ status: 200, text: JSON.stringify(v) });

export function secIndex(day: string): string {
  const head = ["Description:           Daily Index of EDGAR Dissemination Feed by Form Type", `Last Data Received:    ${day}`, "Comments:              none", "", "Form Type   Company Name                                                  CIK         Date Filed  File Name"];
  const d = day.replaceAll("-", "");
  const lines = [
    `D           ${FAKE.company} INC                                         1234567     ${d}    edgar/data/1234567/0001234567-26-000001.txt`,
    `4           ${FAKE.insider}                                             7654321     ${d}    edgar/data/7654321/0007654321-26-000002.txt`,
    `D/A         ${FAKE.company} FUND LP                                     2345678     ${d}    edgar/data/2345678/0002345678-26-000003.txt`,
    `DEF 14A     ${FAKE.insider} HOLDINGS                                    3456789     ${d}    edgar/data/3456789/0003456789-26-000004.txt`,
  ];
  return [...head, "-".repeat(150), ...lines].join("\n") + "\n";
}

export function primaryDoc(): string {
  return `<?xml version="1.0"?><edgarSubmission><primaryIssuer><entityName>${FAKE.company}</entityName><issuerAddress><street1>${FAKE.street}</street1><street2>Suite 1</street2><city>Springfield</city><stateOrCountry>IL</stateOrCountry><zipCode>${FAKE.zip}</zipCode></issuerAddress><issuerPhoneNumber>${FAKE.phone}</issuerPhoneNumber></primaryIssuer><relatedPersonsList><relatedPersonInfo><relatedPersonName><firstName>${FAKE.person}</firstName></relatedPersonName></relatedPersonInfo></relatedPersonsList><offeringData><industryGroup><industryGroupType>Other</industryGroupType></industryGroup><signatureBlock><signature><issuerName>${FAKE.company}</issuerName><signatureName>${FAKE.person}</signatureName><nameOfSigner>${FAKE.person}</nameOfSigner><signatureTitle>CEO</signatureTitle></signature></signatureBlock></offeringData></edgarSubmission>`;
}

/** 소스마다의 기본 응답(robots 404) */
export function defaultReply(url: string, o: FakeOpts = {}): FetchResult {
  const u = new URL(url);
  const q = (k: string) => u.searchParams.get(k) ?? "";
  if (u.pathname === "/robots.txt") return { status: 404, text: "" };
  if (u.host === "open.assembly.go.kr") {
    const svc = u.pathname.split("/").at(-1)!;
    const total = o.assembly ?? 3;
    if (total === 0) return ok({ RESULT: { CODE: "INFO-200", MESSAGE: "해당하는 데이터가 없습니다." } });
    const size = Number(q("pSize"));
    const start = (Number(q("pIndex")) - 1) * size;
    const row = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ PTT_ID: String(start + i), PTT_NM: `${FAKE.title}${start + i}`, PTTR_NM: FAKE.person, PROPOSER: FAKE.person, CITZN_AGM_CNT: 10 }));
    return ok({ [svc]: [{ head: [{ list_total_count: total }, { RESULT: { CODE: "INFO-000", MESSAGE: "정상 처리되었습니다." } }] }, { row }] });
  }
  if (u.host === "apis.data.go.kr") {
    const p = u.pathname;
    if (p.endsWith("/PolicyQnaList") || p.endsWith("/OpenProposalList")) {
      const qna = p.endsWith("/PolicyQnaList");
      const day = compactToIso(q("regFrom"));
      const total = o.perDay?.(qna ? "qna" : "proposal", day) ?? 2;
      if (total === 0) return ok({ resultCode: "E03", resultMsg: "조회 결과가 없습니다." });
      const size = Number(q("recordCountPerPage"));
      const start = (Number(q("firstIndex")) - 1) * size;
      const resultList = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => (qna ? { faqNo: `${day}-${start + i}`, dutySctnNm: "A", title: FAKE.title, regDate: day } : { petiNo: `1AB-${day}-${start + i}`, title: FAKE.title, regDate: day, statusName: "접수" }));
      return ok({ resultCode: "S00", resultMsg: "정상", resultCount: total, resultList });
    }
    if (p.endsWith("/PolicyQnaItem")) return ok({ resultCode: "S00", resultData: { faqNo: q("faqNo"), qnaTitle: FAKE.title, answer: "지어낸 답변" } });
    if (p.endsWith("/OpenProposalItem")) return ok({ resultCode: "S00", resultData: { petiNo: q("petiNo"), peterName: FAKE.person, content: FAKE.title, answerList: [{ answer: "지어낸 답변" }] } });
    if (p.endsWith("/minTodayTopicInfo5")) return ok([{ topic: FAKE.keyword, rank: 1, count: 10 }]);
    if (p.endsWith("/getDscsnDetailSttus_2")) {
      const ym = `${q("rcptYm").slice(0, 4)}-${q("rcptYm").slice(4)}`;
      const total = o.ftc?.(ym) ?? 3;
      const size = Number(q("numOfRows"));
      const start = (Number(q("pageNo")) - 1) * size;
      const items = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ rcptNo: `${ym}-${start + i}`, itemCd: "A01", keyword: FAKE.keyword }));
      return ok({ resultCode: "00", resultMsg: "NORMAL SERVICE", totalCount: total, items });
    }
  }
  if (u.host === "opendart.fss.or.kr") {
    const day = compactToIso(q("bgn_de"));
    const total = o.perDay?.("dart", day) ?? 3;
    if (total === 0) return ok({ status: "013", message: "조회된 데이타가 없습니다." });
    const size = Number(q("page_count"));
    const page = Number(q("page_no"));
    const start = (page - 1) * size;
    const list = Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => ({ corp_name: FAKE.company, flr_nm: FAKE.person, report_nm: FAKE.title, rcept_no: `2026${start + i}`, rcept_dt: q("bgn_de") }));
    return ok({ status: "000", message: "정상", page_no: page, page_count: size, total_count: total, total_page: Math.ceil(total / size), list });
  }
  if (u.host === "www.sec.gov") {
    const qi = /^\/Archives\/edgar\/daily-index\/(\d{4})\/QTR(\d)\/index\.json$/.exec(u.pathname);
    const latest = o.secLatest ?? LAST;
    if (qi) {
      const y = Number(qi[1]);
      const qn = Number(qi[2]);
      const from = `${y}-${String((qn - 1) * 3 + 1).padStart(2, "0")}-01`;
      const to = addDays(qn === 4 ? `${y + 1}-01-01` : `${y}-${String(qn * 3 + 1).padStart(2, "0")}-01`, -1);
      const days = dateRange(from, to < latest ? to : latest).filter(weekday);
      return ok({ directory: { item: [{ name: "company.20261001.idx" }, ...days.map((d) => ({ name: `form.${d.replaceAll("-", "")}.idx` }))], name: "daily-index" } });
    }
    const fi = /\/form\.(\d{8})\.idx$/.exec(u.pathname);
    if (fi) return { status: 200, text: secIndex(compactToIso(fi[1]!)) };
    if (u.pathname.endsWith("/primary_doc.xml")) return { status: 200, text: primaryDoc() };
  }
  if (u.host === "wikimedia.org") {
    const m = /\/top\/([a-z]+)\.wikipedia\/all-access\/(\d{4})\/(\d{2})\/(\d{2})$/.exec(u.pathname);
    if (m) {
      const day = `${m[2]}-${m[3]}-${m[4]}`;
      if (day > (o.wikiLatest ?? LAST)) return { status: 404, text: JSON.stringify({ type: "about:blank", title: "Not found." }), headers: { "content-type": "application/problem+json" } };
      return ok({ items: [{ project: `${m[1]}.wikipedia`, access: "all-access", year: m[2], month: m[3], day: m[4], articles: [{ article: FAKE.article, views: 100, rank: 1 }] }] });
    }
  }
  return { status: 404, text: "" };
}

/** 가짜 요청. 정하지 않은 주소는 기본 응답 */
export function fakeOfficial(clock: () => number, route: (url: string, n: number) => Reply | undefined = () => undefined, o: FakeOpts = {}) {
  const calls: Call[] = [];
  const seen = new Map<string, number>();
  const http: FetchText = async (url: string, init?: FetchInit) => {
    calls.push({ url, at: clock(), agent: init?.headers?.["user-agent"] });
    const n = (seen.get(url) ?? 0) + 1;
    seen.set(url, n);
    const r = route(url, n) ?? defaultReply(url, o);
    if (r === "hang") return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    if (r === "throw") throw new Error(`연결 실패 ${url} ${FAKE.title}`);
    return r;
  };
  const of = (pred: (u: URL) => boolean) => calls.filter((c) => new URL(c.url).pathname !== "/robots.txt" && pred(new URL(c.url)));
  return { http, calls, of, urls: () => calls.map((c) => c.url) };
}

/** 소스 id나 종류로 고른 소스 목록 */
export function pick(...which: (OfficialKind | string)[]): OfficialSource[] {
  return officialSources().filter((s) => which.includes(s.kind) || which.includes(s.id) || which.includes(s.group));
}

export interface Env {
  dataDir: string;
  file: string;
  db: DatabaseSync;
}

export function officialEnv(): Env {
  const dataDir = tempDir("tidwyn-official-");
  const file = demandDbPath(dataDir);
  return { dataDir, file, db: openDemandDb(file) };
}

export function runOff(e: Env, http: FetchText, vt: ReturnType<typeof virtualTime>, extra: Partial<OfficialRunOptions> = {}) {
  return runOfficialDemand({ db: e.db, dataDir: e.dataDir, runId: "run-1", mayCopy: true, http, now: () => NOW, keys: KEYS, secrets: Object.values(KEYS), clock: vt.clock, sleep: vt.sleep, timer: vt.timer, ...extra });
}

/** 소스의 값 날짜 목록(정렬) */
export function savedDates(db: DatabaseSync, source: string): string[] {
  return (db.prepare("SELECT value_date FROM demand_values WHERE source = ? ORDER BY value_date, id").all(source) as { value_date: string }[]).map((r) => r.value_date);
}

/** 풀어 놓은 모든 본문 */
export function bodies(db: DatabaseSync, source?: string): string[] {
  const sql = "SELECT p.encoding, p.body FROM demand_value_parts p JOIN demand_values v ON v.id = p.value_id" + (source === undefined ? "" : " WHERE v.source = ?");
  const rows = (source === undefined ? db.prepare(sql).all() : db.prepare(sql).all(source)) as { encoding: string; body: Uint8Array }[];
  return rows.map((r) => unpackBody(r.encoding, r.body).toString("utf8"));
}

export { virtualTime };
