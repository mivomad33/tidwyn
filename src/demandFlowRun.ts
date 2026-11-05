import type { DatabaseSync } from "node:sqlite";
import { FLOW_MAX_ROUNDS, runFlowWriter } from "./demandFlowWrite.ts";
import { checkFlowFile, planFlows, type DropReason } from "./demandFlowCheck.ts";
import { flowDateOf, isFlowDateDone, recentFlows, saveFlows, allFlowDates, type FlowDate } from "./demandFlowStore.ts";
import { FLOW_LEVELS, FLOW_STATUS_NAMES, OFFICIAL_GROUPS, type FlowLevel, type OfficialGroup } from "./demandFlowTypes.ts";
import { officialSources } from "./demandSources.ts";
import { buildFlowCandidates, readFlowItems, readFlowWork, removeFlowWorkFiles, writeFlowWork, type FlowCandidates } from "./demandFlowWork.ts";
import { auxCandidates, officialUnits, openDemandReadOnly, type SourceState, type UnitsOptions } from "./demandUnits.ts";
import { demandDbPath } from "./demandStore.ts";
import { WRITE_TIMEOUT_MS, type ClaudeRunner } from "./isolatedWriter.ts";
import type { Violation } from "./validate.ts";

// 9.97단계 4.2-4, 4.3: 수요 흐름 단계 한 번. 한 번에 격리 프로세스를 하나까지 부르고, 끝나지 않았으면 '다시 부른다'로 끝난다(모두 3번까지).
// 단계 전체는 15분을 넘지 않는다. 출력과 실행 기록에는 수와 상태, 위반 종류, 단위 키만 쓴다(받은 글과 AI가 쓴 글은 쓰지 않는다).

/** 단계 전체 상한(4.3-1) */
export const FLOW_STAGE_MS = 15 * 60_000;
/** 남은 시간이 이보다 적으면 프로세스를 부르지 않는다 */
export const FLOW_MIN_PROCESS_MS = 2 * 60_000;
/** 받지 못함이 이만큼 이어지면 요약에 따로 적는다(4.3-3) */
export const FLOW_FAIL_ALERT_DAYS = 3;
/** 끄기 값(4.3-2). 1이면 꺼짐 */
export const FLOW_OFF_ENV = "TIDWYN_DEMAND_FLOW_OFF";

export type FlowStepStatus = "off" | "nothing" | "alreadyDone" | "short" | "failed" | "checked" | "again";

export interface DemandFlowState {
  target: string | null;
  status: FlowStepStatus;
  /** 이 실행에서 부른 프로세스 수와 각 걸린 시간 */
  rounds: number;
  processMs: number[];
  /** 단계를 처음 부른 시각(시계 밀리초) */
  startedMs: number;
  reason?: string;
  /** 마지막 검사의 위반 수 */
  violations?: number;
  shown?: number;
  recognized?: number;
  levels?: Partial<Record<FlowLevel, number>>;
  dropped?: Partial<Record<DropReason, number>>;
  /** 비교에 들어간 공식 묶음과 빠진 묶음(사유 종류) */
  compared?: OfficialGroup[];
  missing?: { group: OfficialGroup; reasons: SourceState[] }[];
  risingByGroup?: Partial<Record<OfficialGroup, number>>;
  copyBytes?: number;
  excluded?: string[];
  /** 받지 못함이 이어진 날 수(대상 날짜 포함) */
  failDays?: number;
}

export interface FlowStepInput {
  db: DatabaseSync;
  dataDir: string;
  target: string | null;
  /** KST 오늘 */
  today: string;
  prev: DemandFlowState | undefined;
  /** 시험 모드나 끄기 값 */
  off: boolean;
  env: NodeJS.ProcessEnv;
  run: ClaudeRunner;
  clock: () => number;
  home: string | null;
  secrets: readonly string[];
  /** 단위 세기 옵션(시험 전용 asOf 등). target은 여기서 채운다 */
  units?: Omit<UnitsOptions, "target">;
  stageMs?: number;
  processTimeoutMs?: number;
  /** 시험: 저장 도중 실패를 흉내 낸다 */
  failDuringSave?: () => void;
  tmpRoot?: string;
}

export interface FlowStepResult {
  state: DemandFlowState;
  lines: string[];
}

const missingOf = (groups: { group: OfficialGroup; compared: boolean }[]): OfficialGroup[] => OFFICIAL_GROUPS.filter((g) => !groups.some((x) => x.group === g && x.compared));

/** 대상 날짜까지 이어진 받지 못함 날 수 */
export function failDaysOf(db: DatabaseSync, target: string): number {
  const dates = allFlowDates(db).filter((d) => d.date <= target).reverse();
  let n = 0;
  for (const d of dates) {
    if (d.status === "failed") n++;
    else if (d.status !== "off") break;
  }
  return n;
}

export function runFlowStep(i: FlowStepInput): FlowStepResult {
  const now = i.clock();
  const sameRun = i.prev !== undefined && i.prev.target === i.target;
  const base: DemandFlowState = { target: i.target, status: "nothing", rounds: sameRun ? i.prev!.rounds : 0, processMs: sameRun ? [...i.prev!.processMs] : [], startedMs: sameRun ? i.prev!.startedMs : now };
  // 앞 실행이 남긴 작업 파일은 그 실행의 첫 호출에서 지운다(4.1-2)
  if (!sameRun) removeFlowWorkFiles(i.dataDir);
  if (i.target === null) return { state: base, lines: ["수요 흐름: 브리프가 없어 대상 날짜가 없다."] };
  const target = i.target;
  if (i.off) {
    if (!isFlowDateDone(i.db, target)) saveFlows(i.db, target, [], { date: target, status: "off", missing: [] });
    removeFlowWorkFiles(i.dataDir);
    return { state: { ...base, status: "off" }, lines: [`수요 흐름: 꺼짐(${target}).`] };
  }
  if (isFlowDateDone(i.db, target)) {
    removeFlowWorkFiles(i.dataDir);
    return { state: { ...base, status: "alreadyDone" }, lines: [`수요 흐름: ${target} 이미 끝남(${FLOW_STATUS_NAMES[flowDateOf(i.db, target)?.status === "short" ? "short" : "checked"]}). 바꾼 것이 없다.`] };
  }
  const unitOpts: UnitsOptions = { ...i.units, target };
  const saveEnd = (status: FlowDate["status"], missing: OfficialGroup[], extra: Partial<DemandFlowState>, line: string): FlowStepResult => {
    saveFlows(i.db, target, [], { date: target, status, missing });
    removeFlowWorkFiles(i.dataDir);
    const state: DemandFlowState = { ...base, ...extra, status: status === "short" ? "short" : "failed", failDays: failDaysOf(i.db, target) };
    return { state, lines: [line] };
  };

  // 기계 준비: 후보 복사본이 없으면 만든다
  let work = readFlowWork(i.dataDir);
  let prepared: Partial<DemandFlowState> = sameRun ? pickPrep(i.prev!) : {};
  if (!work.ok || work.data.target !== target) {
    const opened = openDemandReadOnly(demandDbPath(i.dataDir));
    if (opened.state === "missing") return saveEnd("short", [...OFFICIAL_GROUPS], { compared: [], missing: OFFICIAL_GROUPS.map((g) => ({ group: g, reasons: ["nodata"] })) }, `수요 흐름: 전용 DB가 없어 기준 부족으로 저장했다(${target}).`);
    if (opened.state === "broken") return saveEnd("failed", [...OFFICIAL_GROUPS], { reason: "전용 DB를 열 수 없다" }, `수요 흐름: 전용 DB를 열 수 없어 받지 못함으로 저장했다(${target}). 다음 실행이 다시 한다.`);
    let built: ReturnType<typeof buildFlowCandidates>;
    try {
      const u = officialUnits(opened.db, i.today, unitOpts);
      const aux = auxCandidates(opened.db, target, i.today);
      built = buildFlowCandidates({ db: i.db, target, sources: u.sources, groups: u.groups, aux });
    } catch {
      return saveEnd("failed", [...OFFICIAL_GROUPS], { reason: "단위 세기 예외" }, `수요 흐름: 단위를 세다 실패해 받지 못함으로 저장했다(${target}). 다음 실행이 다시 한다.`);
    } finally {
      opened.db.close();
    }
    prepared = prepOf(built.data);
    if (prepared.compared!.length < 2) return saveEnd("short", missingOf(built.data.groups), prepared, `수요 흐름: 비교 창을 채운 공식 묶음이 ${prepared.compared!.length}곳이라 기준 부족으로 저장했다(${target}).`);
    writeFlowWork(i.dataDir, built);
    work = { ok: true, data: built.data };
  }
  const data = work.data;
  const missing = missingOf(data.groups);
  const o = { home: i.home, secrets: i.secrets };
  let state: DemandFlowState = { ...base, ...prepared };

  const tryApply = (): FlowStepResult | { violations: Violation[] } => {
    const items = readFlowItems(i.dataDir);
    if (items.state === "none") return { violations: [] };
    const checked = checkFlowFile(data, items, o);
    if (!checked.ok) return { violations: checked.violations };
    // 다시 세기(4.2-3): 전용 DB에서 같은 규칙으로 다시 센다
    const opened = openDemandReadOnly(demandDbPath(i.dataDir));
    if (opened.state !== "ok") return saveEnd("failed", missing, { ...state, reason: "다시 세지 못했다" }, `수요 흐름: 다시 세려고 전용 DB를 열지 못해 받지 못함으로 저장했다(${target}).`);
    let plan: ReturnType<typeof planFlows>;
    try {
      // 상위 수 자르기는 소스마다라, 통과한 흐름이 쓰는 소스만 다시 세도 그 소스의 결과는 같다
      const used = new Set(checked.flows.flatMap((f) => f.units.map((u) => u.source)));
      const sources = (unitOpts.sources ?? officialSources()).filter((s) => used.has(s.id));
      plan = planFlows(checked.flows, officialUnits(opened.db, i.today, { ...unitOpts, sources }).sources, recentFlows(i.db, target), data.recent);
    } catch {
      return saveEnd("failed", missing, { ...state, reason: "단위 세기 예외" }, `수요 흐름: 다시 세다 실패해 받지 못함으로 저장했다(${target}).`);
    } finally {
      opened.db.close();
    }
    saveFlows(i.db, target, plan.flows, { date: target, status: "checked", missing }, i.failDuringSave);
    removeFlowWorkFiles(i.dataDir);
    const levels: Partial<Record<FlowLevel, number>> = {};
    for (const f of plan.flows) levels[f.level] = (levels[f.level] ?? 0) + 1;
    const s: DemandFlowState = { ...state, status: "checked", shown: plan.flows.length, recognized: plan.recognized, levels, dropped: plan.dropped, excluded: checked.excludedKeys, failDays: 0 };
    return { state: s, lines: [`수요 흐름: ${target} 확인함. 실린 ${plan.flows.length}건, 인정된 ${plan.recognized}건(${FLOW_LEVELS.map((l) => `${l} ${levels[l] ?? 0}`).join(", ")}). 작업 파일을 지웠다.`] };
  };

  let first = tryApply();
  if ("state" in first) return first;
  // 한 호출에 프로세스는 하나까지
  if (state.rounds >= FLOW_MAX_ROUNDS) return saveEnd("failed", missing, { ...state, violations: first.violations.length, reason: `${FLOW_MAX_ROUNDS}번 쓴 뒤에도 검사를 통과하지 못했다` }, `수요 흐름: ${FLOW_MAX_ROUNDS}번 쓴 뒤에도 통과하지 못해 받지 못함으로 저장했다(${target}). 위반 ${first.violations.length}개.`);
  const left = state.startedMs + (i.stageMs ?? FLOW_STAGE_MS) - i.clock();
  if (left < FLOW_MIN_PROCESS_MS) return saveEnd("failed", missing, { ...state, reason: "단계 시간 상한" }, `수요 흐름: 단계 시간 상한(15분)에 남은 시간이 모자라 받지 못함으로 저장했다(${target}).`);
  const items = readFlowItems(i.dataDir);
  const fix = items.state === "none" ? null : { previous: items.text, violations: first.violations };
  const t0 = i.clock();
  const failure = runFlowWriter({ dataDir: i.dataDir, target, fix, env: i.env, run: i.run, timeoutMs: Math.min(i.processTimeoutMs ?? WRITE_TIMEOUT_MS, left - 30_000), tmpRoot: i.tmpRoot });
  state = { ...state, rounds: state.rounds + 1, processMs: [...state.processMs, i.clock() - t0] };
  if (failure === null) {
    first = tryApply();
    if ("state" in first) return first;
  }
  const violations = failure === null ? first.violations.length : 0;
  const why = failure ?? `위반 ${violations}개`;
  if (state.rounds >= FLOW_MAX_ROUNDS) return saveEnd("failed", missing, { ...state, violations, reason: failure ?? `${FLOW_MAX_ROUNDS}번 쓴 뒤에도 검사를 통과하지 못했다` }, `수요 흐름: ${state.rounds}번째 프로세스도 끝내지 못해(${why}) 받지 못함으로 저장했다(${target}).`);
  const lines = [`수요 흐름: ${state.rounds}번째 프로세스가 끝나지 못했다(${why}). 다시 부른다.`];
  if (failure === null) lines.push(...first.violations.map((v) => `- ${v.where}: ${v.why}`));
  return { state: { ...state, status: "again", violations, ...(failure === null ? {} : { reason: failure }) }, lines };
}

function prepOf(d: FlowCandidates): Partial<DemandFlowState> {
  const risingByGroup: Partial<Record<OfficialGroup, number>> = {};
  for (const g of d.groups) risingByGroup[g.group] = d.units.filter((u) => u.group === g.group).length;
  return { compared: d.groups.filter((g) => g.compared).map((g) => g.group), missing: d.groups.filter((g) => !g.compared).map((g) => ({ group: g.group, reasons: g.reasons })), risingByGroup, copyBytes: d.bytes };
}

function pickPrep(s: DemandFlowState): Partial<DemandFlowState> {
  const out: Partial<DemandFlowState> = {};
  if (s.compared !== undefined) out.compared = s.compared;
  if (s.missing !== undefined) out.missing = s.missing;
  if (s.risingByGroup !== undefined) out.risingByGroup = s.risingByGroup;
  if (s.copyBytes !== undefined) out.copyBytes = s.copyBytes;
  return out;
}
