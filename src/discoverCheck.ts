import type { DatabaseSync } from "node:sqlite";
import type { BuilderDiscoverData, ProductCandidate, RepoCandidate } from "./builderDiscover.ts";
import { COPY_WORDS, checkPublicText, copied, copyGrams } from "./builderCheck.ts";
import { PRODUCT_SOURCE, REPO_SOURCE } from "./builderSources.ts";
import { advanceSource, markSourceFailed, markSourceOk, sourceState } from "./builderStore.ts";
import { DISCOVER_KINDS, MAX_DISCOVERIES_PER_KIND, completeSnapshotDates, discoveriesOfDate, insertDiscovery, isKindDone, setKindStatus, snapshotRun, type DiscoverKind, type KindStatus, type NewDiscovery } from "./discoverStore.ts";
import { kstDate } from "./kst.ts";
import type { DiscoverItems } from "./discoverWork.ts";
import { getIssue } from "./issues.ts";
import { failsPublicScan } from "./precheck.ts";
import { Checker, type Obj, type Violation } from "./validate.ts";

// 9.9단계 4.3-2~5: 새 종류 항목 파일 검사, 종류별 판정, 저장. 항목 파일은 재료를 읽은 프로세스가 썼으므로
// 검사 출력과 실행 기록에는 칸 이름과 위반 종류, 수만 쓴다(4.3-3). 이름, 출처 같은 후보 값은 후보 원본에서 저장한다.

export const DISCOVERY_LIMITS = { purpose: 200, difference: 200, reason: 100 } as const;
export type DiscoveryTextField = keyof typeof DISCOVERY_LIMITS;
export const DISCOVERY_LABELS: Record<DiscoveryTextField, string> = { purpose: "용도", difference: "기존 도구와의 차이", reason: "고른 이유" };
export const DISCOVERY_TEXT_FIELDS = Object.keys(DISCOVERY_LIMITS) as DiscoveryTextField[];
const ITEM_KEYS = ["candidate", ...DISCOVERY_TEXT_FIELDS, "issue"];
/** 항목 파일에 있으면 안 되는 후보 값 칸 */
const CANDIDATE_VALUE_KEYS = ["name", "url", "source", "sources", "license", "maintenance", "pushedOn", "release", "stars", "growth"];
const FILE_KEYS = ["targetDate", "products", "repos", "excluded"];

const KIND_NAMES: Record<DiscoverKind, string> = { product: "제품", repo: "저장소" };
const ARRAY_KEYS: Record<DiscoverKind, string> = { product: "products", repo: "repos" };
const SOURCE_IDS: Record<DiscoverKind, string> = { product: PRODUCT_SOURCE.id, repo: REPO_SOURCE.id };

/** 쓰지 못해 받지 못함이 된 이유 */
const NOT_WRITTEN = "항목을 쓰지 못했다";

const candidatesOf = (d: BuilderDiscoverData, kind: DiscoverKind): (ProductCandidate | RepoCandidate)[] => (kind === "product" ? d.products : d.repos);

/** 이번 실행의 쓰기 대상: 후보가 있고 끝나지 않은 종류(4.3-1) */
export function writeTargets(db: DatabaseSync, d: BuilderDiscoverData): DiscoverKind[] {
  return DISCOVER_KINDS.filter((k) => d.kinds[k].status === "checked" && candidatesOf(d, k).length > 0 && !isKindDone(db, d.target, k));
}

/** skip: 이미 끝났다. final: 저장한다. violated: 위반이 남아 저장하지 않는다 */
export type KindDecision = { state: "skip" } | { state: "final"; status: KindStatus; items: NewDiscovery[]; reason?: string } | { state: "violated"; violations: Violation[] };

export interface DiscoverJudgment {
  kinds: Record<DiscoverKind, KindDecision>;
  /** 이번 후보 원본에 있고 공개 검사를 지난 제외 키 */
  excludedKeys: string[];
  /** 그 밖의 제외 값 수 */
  excludedOther: number;
}

export interface JudgeOptions {
  home: string | null;
  secrets: readonly string[];
  /** 꺼진 종류. 받기 결과가 없을 때 쓴다 */
  offKinds?: readonly DiscoverKind[];
}

/** 받기 결과가 없어도 설정과 DB로 아는 상태(4.1-2, 4.3-1). 모르면 null */
function unfetchedStatus(db: DatabaseSync, target: string, kind: DiscoverKind, o: JudgeOptions): KindStatus | null {
  if (o.offKinds?.includes(kind) === true) return "off";
  return kind === "repo" && snapshotRun(db, target)?.state === "complete" && completeSnapshotDates(db, target).length === 0 ? "baseline" : null;
}

function toDiscovery(kind: DiscoverKind, target: string, c: ProductCandidate | RepoCandidate, texts: Record<DiscoveryTextField, string>, issue: number | null): NewDiscovery {
  const base = { date: target, kind, key: c.key, name: c.name, url: c.url, ...texts, issue };
  if (kind === "product") return { ...base, license: null, pushedOn: null, release: null, stars: null, growth: null };
  const r = c as RepoCandidate;
  return { ...base, license: r.license, pushedOn: r.pushedOn, release: r.release, stars: r.stars, growth: r.growth };
}

const materialOf = (c: ProductCandidate | RepoCandidate) => ("readme" in c ? `${c.name}\n${c.description}\n${c.readme}` : `${c.name}\n${c.tagline}\n${c.description}`);

/** 종류 하나의 항목을 검사한다. 저장할 새 항목을 돌려준다 */
function checkKind(c: Checker, db: DatabaseSync, d: BuilderDiscoverData, kind: DiscoverKind, raw: unknown[], o: JudgeOptions): NewDiscovery[] {
  const name = KIND_NAMES[kind];
  const own = new Map(candidatesOf(d, kind).map((x) => [x.n, x]));
  const other = new Set(candidatesOf(d, kind === "product" ? "repo" : "product").map((x) => x.n));
  const used = new Set<number>();
  const items: NewDiscovery[] = [];
  raw.forEach((value, i) => {
    const w = `${name} ${i + 1}`;
    const it = c.obj(value, w);
    if (it === null) return;
    for (const k of Object.keys(it)) {
      if (CANDIDATE_VALUE_KEYS.includes(k)) c.add(`${w} ${k}`, "후보 값 칸은 쓰지 않는다");
      else if (!ITEM_KEYS.includes(k)) c.add(w, "알 수 없는 칸이다");
    }
    const texts = {} as Record<DiscoveryTextField, string>;
    for (const f of DISCOVERY_TEXT_FIELDS) {
      texts[f] = c.text(it, f, DISCOVERY_LABELS[f], w);
      if (texts[f] !== "") checkPublicText(c, `${w} ${DISCOVERY_LABELS[f]}`, texts[f], DISCOVERY_LIMITS[f], o.home, o.secrets);
    }
    const n = it.candidate;
    const found = typeof n === "number" ? own.get(n) : undefined;
    if (found === undefined) c.add(`${w} 후보 번호`, typeof n === "number" && other.has(n) ? "다른 종류의 후보 번호다" : "없는 후보 번호다");
    else if (used.has(found.n)) c.add(`${w} 후보 번호`, "같은 번호를 두 항목이 쓴다");
    let issue: number | null = null;
    if (it.issue !== undefined && it.issue !== null) {
      if (typeof it.issue !== "number" || getIssue(db, it.issue) === null) c.add(`${w} 이슈`, "없는 이슈다");
      else issue = it.issue;
    }
    if (found === undefined) return;
    used.add(found.n);
    const grams = copyGrams([materialOf(found)]);
    for (const f of DISCOVERY_TEXT_FIELDS) if (copied(texts[f], grams)) c.add(`${w} ${DISCOVERY_LABELS[f]}`, `재료 문장을 ${COPY_WORDS}단어 이상 그대로 옮겼다`);
    items.push(toDiscovery(kind, d.target, found, texts, issue));
  });
  const stored = discoveriesOfDate(db, d.target, kind);
  const fresh = items.filter((x) => !stored.some((s) => s.key === x.key));
  if (stored.length + fresh.length > MAX_DISCOVERIES_PER_KIND) c.add(name, `그날 ${stored.length + fresh.length}건이다(이미 실린 ${stored.length}건 포함, ${MAX_DISCOVERIES_PER_KIND}건 이하여야 한다)`);
  return fresh;
}

/** 인용 위반 문구는 항목 글을 담는다. 메인이 읽는 출력에 글이 들어가지 않게 지운다(4.3-3) */
export const quiet = (v: Violation): Violation => (v.why.startsWith("직접 인용이") ? { where: v.where, why: "직접 인용이 15단어 이상이다" } : v);

interface FileParts {
  fileViolations: Violation[];
  file: Obj | null;
  excluded: unknown[];
}

function readFile(d: BuilderDiscoverData, items: DiscoverItems): FileParts {
  const c = new Checker();
  if (items.state !== "read") {
    c.add("항목 파일", "JSON이 아니다");
    return { fileViolations: c.violations, file: null, excluded: [] };
  }
  const file = c.obj(items.data, "항목 파일");
  if (file === null) return { fileViolations: c.violations, file: null, excluded: [] };
  if (Object.keys(file).some((k) => !FILE_KEYS.includes(k))) c.add("항목 파일", "알 수 없는 칸이 있다");
  if (file.targetDate !== d.target) c.add("항목 파일 targetDate", `대상 날짜 ${d.target}와 같아야 한다`);
  const excluded = c.arr(file, "excluded", "제외", "항목 파일");
  return { fileViolations: c.violations, file, excluded };
}

/**
 * 종류별로 판정한다(4.3-5). data가 없으면 받기가 멈춘 것이라 켜진 종류가 받지 못함이고(꺼짐과 기준값 쌓는 중은 그대로다), 항목 파일이 없으면 쓰기 대상 종류만 받지 못함이다.
 * 후보가 없이 확인이 끝난 종류는 0건이고, 일부가 빠진 날 항목이 0건이면 받지 못함이다(B11).
 */
export function judgeDiscoveries(db: DatabaseSync, target: string, data: BuilderDiscoverData | null, items: DiscoverItems, o: JudgeOptions): DiscoverJudgment {
  const parts = data === null || items.state === "none" ? null : readFile(data, items);
  const failedKind = (reason: string): KindDecision => ({ state: "final", status: "failed", items: [], reason });
  const decide = (kind: DiscoverKind): KindDecision => {
    if (isKindDone(db, target, kind)) return { state: "skip" };
    if (data === null) {
      const status = unfetchedStatus(db, target, kind, o);
      return status === null ? failedKind(NOT_WRITTEN) : { state: "final", status, items: [] };
    }
    const report = data.kinds[kind];
    if (report.status === "done") return { state: "skip" };
    if (report.status !== "checked") return { state: "final", status: report.status, items: [] };
    if (candidatesOf(data, kind).length === 0) return report.missing > 0 ? failedKind("일부 후보를 확인하지 못했다") : { state: "final", status: "checked", items: [] };
    if (parts === null) return failedKind(NOT_WRITTEN);
    const c = new Checker();
    c.violations.push(...parts.fileViolations);
    const planned = parts.file === null ? [] : checkKind(c, db, data, kind, c.arr(parts.file, ARRAY_KEYS[kind], "목록", "항목 파일"), o);
    if (c.violations.length > 0) return { state: "violated", violations: c.violations.map(quiet) };
    const none = planned.length + discoveriesOfDate(db, target, kind).length === 0;
    return none && report.missing > 0 ? failedKind("일부 후보를 확인하지 못했는데 실을 항목이 없다") : { state: "final", status: "checked", items: planned };
  };
  const keys = new Set(data === null ? [] : [...data.products, ...data.repos].map((x) => x.key));
  const safe = (parts?.excluded ?? []).filter((k): k is string => typeof k === "string" && keys.has(k) && !failsPublicScan(k, o.home, o.secrets));
  const excludedKeys = [...new Set(safe)];
  return { kinds: { product: decide("product"), repo: decide("repo") }, excludedKeys, excludedOther: (parts?.excluded.length ?? 0) - safe.length };
}

export function judgedViolations(j: DiscoverJudgment): Violation[] {
  return DISCOVER_KINDS.flatMap((k) => {
    const d = j.kinds[k];
    return d.state === "violated" ? d.violations : [];
  });
}

/** 지금 연속 실패 일수 */
export const kindFailDays = (db: DatabaseSync, kind: DiscoverKind): number => sourceState(db, SOURCE_IDS[kind]).failDays;

/** 판정을 저장한다. 호출하는 쪽의 트랜잭션 안에서 쓴다. advance가 false면 받은 시각을 그대로 둔다. 연속 실패는 받기가 아니라 저장한 상태로 세고, 날짜는 받은 날이다(4.2-2) */
export function applyDiscoveries(db: DatabaseSync, data: BuilderDiscoverData | null, target: string, j: DiscoverJudgment, advance: boolean, today: string): void {
  const failDay = data === null ? today : kstDate(new Date(data.fetchedAt));
  for (const kind of DISCOVER_KINDS) {
    const d = j.kinds[kind];
    if (d.state !== "final") continue;
    for (const x of d.items) insertDiscovery(db, x);
    setKindStatus(db, target, kind, d.status);
    const source = SOURCE_IDS[kind];
    if (d.status === "failed") markSourceFailed(db, source, failDay);
    else if (d.status !== "off") markSourceOk(db, source);
    if (advance && d.status === "checked" && data?.advance.includes(source)) advanceSource(db, source, data.fetchedAt);
  }
}
