import type { DatabaseSync } from "node:sqlite";
import { COMMUNITY_MISSING_NAMES, type CommunityGroup } from "./demandFlowTypes.ts";
import { communitySources, type CommunitySource } from "./demandSources.ts";
import { round1 } from "./demandUnits.ts";
import { addDays, daysIn } from "./kst.ts";

// 9.98단계 4.2-3, 4.2-4(S1, S4, S8): 커뮤니티 건수의 전용 DB 표(마이그레이션 3)를 읽고 쓰고, 커뮤니티 단위의 오름·쏠림을 판정한다.
// 저장하는 것은 대상 날짜, 소스, 검색어, 공식 단위 키, 창, 건수, 상한 닿음, 쏠림 비율, 받은 시각뿐이다.
// 흐름 단계는 readCommunityUnits로 그 대상 날짜의 커뮤니티 단위와 소스 상태를 읽는다(전용 DB는 읽기 전용으로 열어 넘겨도 된다).

/**
 * 커뮤니티 단위의 하한·오름 기준(4.2-3). 시험 폴더 수 통계(4.7-6의 앞 단계 다섯 날)로 정해 측정 10일 전에 고정했다. 판정 문서의 "수요 흐름" 절에 같은 값을 적는다. 키는 커뮤니티 묶음 id다
 */
export const COMMUNITY_RULES: Record<CommunityGroup, { floor: number; ratio: number }> = {
  github: { floor: 10, ratio: 2 },
  bluesky: { floor: 50, ratio: 2 },
};
/** 한 곳 쏠림(S4): 첫 쪽에서 가장 많은 저장소·계정의 비율이 이 값을 넘으면 오름에 세지 않는다 */
export const CONCENTRATION_SHARE = 0.5;
/** Bluesky hitsTotal의 상한(S2). 이 값 이상이면 상한 닿음으로 비교에서 뺀다 */
export const BLUESKY_HITS_CAP = 10_000;

export type CommunityStatus = "ok" | "partial" | "off" | "robots" | "blocked" | "failed" | "noterms";
export const COMMUNITY_STATUS_NAMES: Record<CommunityStatus, string> = { ok: "받음", partial: "일부 받음", ...COMMUNITY_MISSING_NAMES, noterms: "검색어 없음" };

/** 사유 종류. 실행 기록과 상태 표에는 이 id만 쓴다(요청 주소나 응답 조각을 쓰지 않는다) */
export type CommunityReason = "rate" | "timeout" | "server" | "format" | "network" | "deadline" | "robotsFetch" | "units" | "query" | "http" | "forbidden" | "auth";
export const COMMUNITY_REASON_NAMES: Record<CommunityReason, string> = {
  rate: "한도",
  timeout: "시간 초과",
  server: "서버 오류",
  format: "응답 형식 오류",
  network: "연결 실패",
  deadline: "시간 상한",
  robotsFetch: "robots 받지 못함",
  units: "공식 단위 세기 실패",
  query: "질의 오류·불완전 응답",
  http: "예상 밖 응답",
  forbidden: "한도 표시 없는 거부",
  auth: "인증 요구",
};
/** 일시적 실패(S1): 같은 대상 날짜에 다시 돌면 다시 한다. 흐름 단계는 공식 한 곳인 날 이것만으로 0개면 '받지 못함'으로 둔다 */
export const TRANSIENT_REASONS: readonly CommunityReason[] = ["rate", "timeout", "server", "format", "network", "deadline", "robotsFetch", "units"];
export const isTransient = (reason: string | null): boolean => reason !== null && (TRANSIENT_REASONS as readonly string[]).includes(reason);

/** 커뮤니티 단위 키: 커뮤니티 소스 id와 검색어를 낸 공식 단위 키 */
export const communityUnitKey = (source: string, officialKey: string): string => `${source}:${officialKey}`;

export interface CommunityWindow {
  recentFrom: string;
  recentTo: string;
  baseFrom: string;
  baseTo: string;
}

export interface CommunityJudgement {
  /** 앞 창을 최근 창 날 수에 맞춘 평균(소수 한 자리) */
  base: number;
  isNew: boolean;
  /** 쏠림을 보기 전에 하한·오름 기준을 넘었는지 */
  passes: boolean;
  concentrated: boolean;
  rising: boolean;
}

/**
 * 커뮤니티 단위 하나의 판정(4.2-3): 최근 값이 하한 이상이고, 앞 창이 0이면 새로 나타남으로 오름, 아니면 같은 길이 평균의 ratio배 이상이면 오름.
 * 쏠림(share가 CONCENTRATION_SHARE 초과)이면 오름에 세지 않는다
 */
export function judgeCommunity(group: CommunityGroup, recent: number, baseCount: number, recentDays: number, baseDays: number, share: number | null): CommunityJudgement {
  const rule = COMMUNITY_RULES[group];
  const base = round1((baseCount / baseDays) * recentDays);
  const isNew = baseCount === 0;
  const concentrated = share !== null && share > CONCENTRATION_SHARE;
  const passes = recent >= rule.floor && (isNew || recent >= rule.ratio * base);
  return { base, isNew, passes, concentrated, rising: passes && !concentrated };
}

// ---- 쓰기 ----

export function selectedTerms(db: DatabaseSync, target: string): { term: string; unitKey: string }[] {
  return (db.prepare("SELECT term, unit_key FROM community_terms WHERE target_date = ? ORDER BY rowid").all(target) as { term: string; unit_key: string }[]).map((r) => ({ term: r.term, unitKey: r.unit_key }));
}

export function addTerm(db: DatabaseSync, target: string, term: string, unitKey: string, at: string): void {
  db.prepare("INSERT INTO community_terms (target_date, term, unit_key, selected_at) VALUES (?, ?, ?, ?)").run(target, term, unitKey, at);
}

export interface CountRow {
  target: string;
  source: string;
  term: string;
  unitKey: string;
  kind: "recent" | "base";
  from: string;
  to: string;
  count: number;
  capHit: boolean;
  /** 첫 쪽에서 가장 많은 저장소·계정의 비율(최근 창만). 없으면 null */
  share: number | null;
  fetchedAt: string;
}

export function hasCount(db: DatabaseSync, target: string, source: string, term: string, from: string, to: string): boolean {
  return db.prepare("SELECT 1 FROM community_counts WHERE target_date = ? AND source = ? AND term = ? AND win_from = ? AND win_to = ?").get(target, source, term, from, to) !== undefined;
}

export function addCount(db: DatabaseSync, r: CountRow): void {
  db.prepare("INSERT INTO community_counts (target_date, source, term, unit_key, win_kind, win_from, win_to, count, cap_hit, top_share, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(r.target, r.source, r.term, r.unitKey, r.kind, r.from, r.to, r.count, r.capHit ? 1 : 0, r.share, r.fetchedAt);
}

export function setCommunityStatus(db: DatabaseSync, target: string, source: string, status: CommunityStatus, reason: string | null, at: string): void {
  db.prepare("INSERT INTO community_status (target_date, source, status, reason, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (target_date, source) DO UPDATE SET status = excluded.status, reason = excluded.reason, updated_at = excluded.updated_at").run(target, source, status, reason, at);
}

/** 대상 날짜까지 이어진 막힘·받지 못함 날 수(4.4-3). 받음·일부 받음이 끊고, robots 막힘·꺼짐·검색어 없음과 기록 없는 날은 세지도 끊지도 않는다 */
export function communityStreak(db: DatabaseSync, source: string, target: string): number {
  const rows = db.prepare("SELECT status FROM community_status WHERE source = ? AND target_date <= ? ORDER BY target_date DESC").all(source, target) as { status: CommunityStatus }[];
  let n = 0;
  for (const r of rows) {
    if (r.status === "ok" || r.status === "partial") break;
    if (r.status === "blocked" || r.status === "failed") n++;
  }
  return n;
}

// ---- 읽기(흐름 단계가 쓴다) ----

export interface CommunityUnit {
  /** 커뮤니티 단위 키(communityUnitKey) */
  key: string;
  source: string;
  group: CommunityGroup;
  /** 검색어를 낸 공식 단위 키 */
  officialKey: string;
  /** 검색어(그 공식 단위 이름을 다듬은 것). 로컬 전용 DB에만 있고 출력하지 않는다 */
  term: string;
  /** 최근 창 건수 */
  recent: number;
  /** 앞 창 건수 */
  baseCount: number;
  window: CommunityWindow;
  share: number | null;
  judgement: CommunityJudgement;
}

export interface CommunitySourceStatus {
  source: string;
  group: CommunityGroup;
  /** 기록이 없으면 null(흐름 단계는 꺼짐과 같이 본다, S1) */
  status: CommunityStatus | null;
  reason: string | null;
  transient: boolean;
}

export interface CommunityRead {
  /** 두 창을 모두 받았고 상한에 닿지 않은 커뮤니티 단위(오르지 않은 것과 쏠림 포함) */
  units: CommunityUnit[];
  /** 상한에 닿아 없는 것으로 본 커뮤니티 단위 키 */
  capped: string[];
  statuses: CommunitySourceStatus[];
}

const hasTable = (db: DatabaseSync, name: string) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

interface Row {
  id: number;
  source: string;
  term: string;
  unit_key: string;
  win_kind: "recent" | "base";
  win_from: string;
  win_to: string;
  count: number;
  cap_hit: number;
  top_share: number | null;
}

/**
 * 대상 날짜의 커뮤니티 단위와 소스 상태(S1, S8). 같은 소스 × 공식 단위에 창이 여럿이면(같은 날 다시 돌아 창이 옮겨짐) 가장 늦게 받은 최근 창과
 * 그 바로 앞 창의 짝을 쓴다. 9.98 이전 버전의 전용 DB(표 없음)면 단위가 없고 상태는 모두 기록 없음이다
 */
export function readCommunityUnits(db: DatabaseSync, target: string, sources: readonly CommunitySource[] = communitySources()): CommunityRead {
  const known = hasTable(db, "community_counts") && hasTable(db, "community_status");
  const statuses: CommunitySourceStatus[] = sources.map((s) => {
    const r = known ? (db.prepare("SELECT status, reason FROM community_status WHERE target_date = ? AND source = ?").get(target, s.id) as { status: CommunityStatus; reason: string | null } | undefined) : undefined;
    return { source: s.id, group: s.group, status: r?.status ?? null, reason: r?.reason ?? null, transient: isTransient(r?.reason ?? null) };
  });
  if (!known) return { units: [], capped: [], statuses };
  const rows = db.prepare("SELECT id, source, term, unit_key, win_kind, win_from, win_to, count, cap_hit, top_share FROM community_counts WHERE target_date = ? ORDER BY id").all(target) as unknown as Row[];
  const byUnit = Map.groupBy(rows, (r) => `${r.source}\0${r.unit_key}`);
  const units: CommunityUnit[] = [];
  const capped: string[] = [];
  for (const list of byUnit.values()) {
    const first = list[0]!;
    const s = sources.find((x) => x.id === first.source);
    if (s === undefined) continue;
    const recents = list.filter((r) => r.win_kind === "recent").reverse();
    let pair: { recent: Row; base: Row } | null = null;
    for (const recent of recents) {
      const base = list.filter((r) => r.win_kind === "base" && r.term === recent.term && r.win_to === addDays(recent.win_from, -1)).at(-1);
      if (base !== undefined) {
        pair = { recent, base };
        break;
      }
    }
    if (pair === null) continue;
    const key = communityUnitKey(s.id, first.unit_key);
    if (pair.recent.cap_hit === 1 || pair.base.cap_hit === 1) {
      capped.push(key);
      continue;
    }
    const window: CommunityWindow = { recentFrom: pair.recent.win_from, recentTo: pair.recent.win_to, baseFrom: pair.base.win_from, baseTo: pair.base.win_to };
    const recentDays = daysIn(window.recentFrom, window.recentTo);
    const baseDays = daysIn(window.baseFrom, window.baseTo);
    units.push({
      key,
      source: s.id,
      group: s.group,
      officialKey: first.unit_key,
      term: pair.recent.term,
      recent: pair.recent.count,
      baseCount: pair.base.count,
      window,
      share: pair.recent.top_share,
      judgement: judgeCommunity(s.group, pair.recent.count, pair.base.count, recentDays, baseDays, pair.recent.top_share),
    });
  }
  units.sort((a, b) => a.key.localeCompare(b.key));
  return { units, capped: capped.sort(), statuses };
}
