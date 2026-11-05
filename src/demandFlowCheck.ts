import { COPY_WORDS, checkPublicText, copied, copyGrams } from "./builderCheck.ts";
import { CATEGORY_GROUPS, COMMUNITY_GROUPS, isCommunityConfirmed, FIELD_IDS, FLOW_CATEGORIES, FLOW_LIMITS, FLOW_MAX_SHOWN, FLOW_MAX_WRITTEN, FLOW_TEXT_FIELDS, FLOW_TEXT_LABELS, OFFICIAL_GROUPS, levelRank, type FlowCategory, type FlowLevel, type FlowTextField, type OfficialGroup } from "./demandFlowTypes.ts";
import type { Flow, FlowCommunityUnit, FlowUnit, NewFlow } from "./demandFlowStore.ts";
import type { FlowCandidates, FlowItems, NumberedCommunity, NumberedUnit } from "./demandFlowWork.ts";
import { COMMUNITY_RULES, type CommunityUnit } from "./communityStore.ts";
import { UNIT_RULES, type SourceUnits } from "./demandUnits.ts";
import { officialSources, type OfficialKind } from "./demandSources.ts";
import { quiet } from "./discoverCheck.ts";
import { Checker, type Violation } from "./validate.ts";
import { addDays } from "./kst.ts";

// 9.97단계 4.2-2~3: 흐름 파일 검사, 기계가 채우는 칸, 근거 수준(S6), 같은 흐름(S8), 3건 자르기.
// 9.98단계 4.3-3~4(S1, S7): 흐름 인정은 공식 묶음 둘, 또는 공식 묶음 하나와 그 공식 단위를 검색어로 한 오른 커뮤니티 단위다. 꺾임 표시를 기계가 정한다.
// 흐름 파일은 재료를 읽은 프로세스가 썼으므로 검사 출력에는 칸 이름, 위반 종류, 수만 쓴다(9.9 quiet와 같다).

const FILE_KEYS = ["targetDate", "flows", "excluded"];
const FLOW_KEYS = ["category", "field", ...FLOW_TEXT_FIELDS, "units", "aux", "issue", "continues"];
/** 흐름 파일에 있으면 안 되는 기계 칸 */
const MACHINE_KEYS = ["level", "numbers", "values", "window", "sources", "source", "id", "flowId"];

/** S7의 단정·과장어(공백을 빼고 비교한다) */
export const BANNED_WORDS = ["급증", "폭증", "급등", "폭등", "트렌드", "유행", "열풍", "대세", "폭발적", "수요가 있다", "수요가 많다", "사업 기회", "사업성이 있다", "돈이 된다", "기회가 있다"] as const;

const NUM_HAN = "〇一二三四五六七八九十百千万萬億兆";
/** 단위 뒤의 조사(0~2개). 그 뒤에는 한글이 오지 않는다('세 배로', '두 곳에서도') */
const AFTER_UNIT = "(?:이|가|은|는|을|를|의|에|에서|에게|로|으로|와|과|도|만|씩|째|쯤|나|이나|부터|까지|보다|이상|이하|가량|정도|여|뿐){0,2}(?![가-힣])";
const NATIVE = "한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른|마흔|쉰";
const NATIVE_UNITS = "배|곳|건|명|개|번|차례|달|주|해|가지|군데|종|층|대|분|시간|퍼센트|만|천|백";
/** 띄어 쓰지 않은 수사 뒤에는 일반 낱말과 겹치지 않는 단위만 본다('세대', '세종', '한번'은 수로 보지 않는다) */
const NATIVE_TIGHT_UNITS = "배|곳|건|명|개|가지|군데|퍼센트";
const SINO = "일|이|삼|사|오|육|칠|팔|구|십|백|천|만|억|조";
const SINO_UNITS = "퍼센트|프로|배|건|명|개|곳|원|달러|만|억|조";
/** 띄어 쓴 한자어 수사 뒤의 단위. '그 일 만으로도'처럼 낱말과 겹치는 만·억·조는 뺀다('삼 만 명'은 '만 명'에서 잡힌다) */
const SINO_SPACED_UNITS = "퍼센트|프로|배|건|명|개|곳|원|달러";
/** 한글 수사와 단위(셀 수 있는 말 앞의 수) */
const HANGUL_COUNT_RES = [
  new RegExp(`(?:^|[^가-힣])(?:${NATIVE})\\s(?:${NATIVE_UNITS})${AFTER_UNIT}`),
  new RegExp(`(?:^|[^가-힣])(?:${NATIVE})(?:${NATIVE_TIGHT_UNITS})${AFTER_UNIT}`),
  /(?:^|[^가-힣])(?:수|몇)(?:십|백|천|만)/,
  // 한자어 수사: 띄어 쓰면 '이 건'(지시어)만 빼고, 붙여 쓰면 두 글자 이상만 본다('사건', '일명', '만원'은 수로 보지 않는다)
  new RegExp(`(?:^|[^가-힣])(?!이\\s)(?:${SINO})+\\s(?:${SINO_SPACED_UNITS})${AFTER_UNIT}`),
  new RegExp(`(?:^|[^가-힣])(?:${SINO}){2,}(?:${SINO_UNITS})${AFTER_UNIT}`),
];

/** 글 칸의 수(4.2-2): 아라비아 숫자, 한자 수, 한글 수사로 된 수량, 퍼센트 기호. 이름 속 숫자도 막는다 */
export function hasNumber(text: string): boolean {
  if (/[0-9０-９%％]/.test(text)) return true;
  if (new RegExp(`[${NUM_HAN}]`).test(text)) return true;
  return HANGUL_COUNT_RES.some((re) => re.test(text));
}

const squash = (s: string) => s.replace(/\s+/g, "");
export function bannedWord(text: string): boolean {
  const t = squash(text);
  return BANNED_WORDS.some((w) => t.includes(squash(w).replace(/다$/, "")));
}

export interface CheckedFlow {
  category: FlowCategory;
  field: string;
  texts: Record<FlowTextField, string>;
  units: NumberedUnit[];
  /** 근거 커뮤니티 단위(9.98). 없으면 빈 목록 */
  community?: NumberedCommunity[];
  aux: string[];
  issue: number | null;
  continues: string | null;
}

export type FlowCheck = { ok: true; flows: CheckedFlow[]; excludedKeys: string[] } | { ok: false; violations: Violation[] };

export interface FlowCheckOptions {
  home: string | null;
  secrets: readonly string[];
}

/** 기계가 찾은 겹침(S8): 분야가 같고 근거 단위가 하나 이상 겹치는 최근 흐름. 가장 최근에 실린 것 */
export function overlapOf(field: string, unitKeys: readonly string[], recent: FlowCandidates["recent"]): FlowCandidates["recent"][number] | null {
  const sorted = [...recent].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.find((r) => r.field === field && r.unitKeys.some((k) => unitKeys.includes(k))) ?? null;
}

/** 흐름 파일 검사(4.2-2). 통과하면 칸을 정리해 돌려준다 */
export function checkFlowFile(d: FlowCandidates, items: FlowItems, o: FlowCheckOptions): FlowCheck {
  const c = new Checker();
  if (items.state === "none") return { ok: false, violations: [{ where: "흐름 파일", why: "없다" }] };
  if (items.state === "broken") return { ok: false, violations: [{ where: "흐름 파일", why: "JSON이 아니다" }] };
  const file = c.obj(items.data, "흐름 파일");
  if (file === null) return { ok: false, violations: c.violations };
  for (const k of Object.keys(file)) if (!FILE_KEYS.includes(k)) c.add("흐름 파일", "알 수 없는 칸이다");
  if (file.targetDate !== d.target) c.add("흐름 파일 targetDate", "대상 날짜와 다르다");
  const raw = c.arr(file, "flows", "flows", "흐름 파일");
  if (raw.length > FLOW_MAX_WRITTEN) c.add("흐름 파일 flows", `${raw.length}건이다(${FLOW_MAX_WRITTEN}건 이하여야 한다)`);
  const byN = new Map(d.units.map((u) => [u.n, u]));
  const comByN = new Map((d.community ?? []).map((x) => [x.n, x]));
  const auxByN = new Map(d.aux.map((a) => [a.n, a]));
  const excludedRaw = file.excluded === undefined ? [] : c.arr(file, "excluded", "excluded", "흐름 파일");
  const excluded = new Set<number>();
  for (const x of excludedRaw) {
    if (typeof x !== "number" || !byN.has(x)) c.add("흐름 파일 excluded", "없는 단위 번호다");
    else excluded.add(x);
  }
  const grams = copyGrams([...d.units.flatMap((u) => [u.name ?? "", ...u.material]), ...d.aux.flatMap((a) => a.names), ...d.issues.map((i) => i.name)]);
  const used = new Set<number>();
  const flows: CheckedFlow[] = [];
  raw.forEach((value, i) => {
    const w = `흐름 ${i + 1}`;
    const f = c.obj(value, w);
    if (f === null) return;
    for (const k of Object.keys(f)) {
      if (MACHINE_KEYS.includes(k)) c.add(`${w} ${k}`, "기계가 채우는 칸은 쓰지 않는다");
      else if (!FLOW_KEYS.includes(k)) c.add(w, "알 수 없는 칸이다");
    }
    const category = f.category as FlowCategory;
    if (!(FLOW_CATEGORIES as readonly unknown[]).includes(f.category)) c.add(`${w} category`, "갈래 목록 밖이다");
    const field = typeof f.field === "string" ? f.field : "";
    if (!FIELD_IDS.includes(field)) c.add(`${w} field`, "분야 목록 밖이다");
    const texts = {} as Record<FlowTextField, string>;
    for (const t of FLOW_TEXT_FIELDS) {
      const where = `${w} ${FLOW_TEXT_LABELS[t]}`;
      texts[t] = c.text(f, t, FLOW_TEXT_LABELS[t], w);
      if (texts[t] === "") continue;
      checkFlowText(c, where, t, texts[t], o);
      if (copied(texts[t], grams)) c.add(where, `재료 문장을 ${COPY_WORDS}단어 이상 그대로 옮겼다`);
    }
    const nums = c.arr(f, "units", "units", w);
    const units: NumberedUnit[] = [];
    const community: NumberedCommunity[] = [];
    for (const n of nums) {
      const x = typeof n === "number" ? comByN.get(n) : undefined;
      if (x !== undefined) {
        if (community.includes(x)) c.add(`${w} units`, "같은 번호를 두 번 썼다");
        else if (used.has(x.n)) c.add(`${w} units`, "다른 흐름이 쓴 번호다");
        else community.push(x);
        continue;
      }
      const u = typeof n === "number" ? byN.get(n) : undefined;
      if (u === undefined) c.add(`${w} units`, "없는 단위 번호다");
      else if (units.includes(u)) c.add(`${w} units`, "같은 번호를 두 번 썼다");
      else if (used.has(u.n)) c.add(`${w} units`, "다른 흐름이 쓴 번호다");
      else if (excluded.has(u.n)) c.add(`${w} units`, "제외 칸에 적은 번호다");
      else units.push(u);
    }
    for (const u of [...units, ...community]) used.add(u.n);
    const groups = new Set(units.map((u) => u.group));
    // S1: 공식 묶음이 꼭 있고, 둘 이상이거나 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 있어야 한다
    if (groups.size === 0) c.add(`${w} units`, "공식 묶음이 없다(커뮤니티 단위만으로는 흐름이 아니다)");
    for (const x of community) {
      if (!x.rising) c.add(`${w} units`, x.concentrated ? "한 곳 쏠림인 커뮤니티 단위다" : "오르지 않은 커뮤니티 단위다");
      if (!units.some((u) => u.n === x.officialN)) c.add(`${w} units`, "검색어의 공식 단위가 흐름 근거에 없는 커뮤니티 단위다");
    }
    if (groups.size === 1 && !community.some((x) => x.rising && units.some((u) => u.n === x.officialN))) c.add(`${w} units`, "공식 묶음이 하나뿐인데 그 공식 단위를 검색어로 한 오른 커뮤니티 단위가 없다");
    if ((FLOW_CATEGORIES as readonly unknown[]).includes(f.category) && !units.some((u) => CATEGORY_GROUPS[category].includes(u.group))) c.add(`${w} category`, "근거 묶음과 맞지 않는 갈래다");
    const aux: string[] = [];
    const auxRaw = f.aux === undefined || f.aux === null ? [] : c.arr(f, "aux", "aux", w);
    for (const n of auxRaw) {
      const a = typeof n === "number" ? auxByN.get(n) : undefined;
      if (a === undefined) c.add(`${w} aux`, "없는 보조 근거 번호다");
      else if (!aux.includes(a.label)) aux.push(a.label);
    }
    let issue: number | null = null;
    if (f.issue !== undefined && f.issue !== null) {
      if (typeof f.issue !== "number" || !d.issues.some((x) => x.id === f.issue)) c.add(`${w} issue`, "관련 이슈 후보에 없다");
      else issue = f.issue;
    }
    let continues: string | null = null;
    if (f.continues !== undefined && f.continues !== null) {
      const ref = typeof f.continues === "string" ? d.recent.find((r) => r.flowId === f.continues) : undefined;
      if (ref === undefined) c.add(`${w} continues`, "없는 흐름 id다");
      else if (ref.field !== field || !ref.unitKeys.some((k) => units.some((u) => u.key === k))) c.add(`${w} continues`, "기계가 겹침을 찾지 못한 이어짐이다(분야가 같고 근거 단위가 겹쳐야 한다)");
      else continues = ref.flowId;
    }
    flows.push({ category, field, texts, units, community, aux, issue, continues });
  });
  if (c.violations.length > 0) return { ok: false, violations: c.violations.map(quiet) };
  return { ok: true, flows, excludedKeys: [...excluded].map((n) => byN.get(n)!.key) };
}

/** 흐름 글 칸 하나의 검사(4.2-2). 정정도 쓴다(4.4-4) */
export function checkFlowText(c: Checker, where: string, field: FlowTextField, text: string, o: FlowCheckOptions): void {
  checkPublicText(c, where, text, FLOW_LIMITS[field], o.home, o.secrets);
  if (hasNumber(text)) c.add(where, "글 칸에 수를 쓰지 않는다(숫자는 근거 줄에 기계가 싣는다)");
  if (bannedWord(text)) c.add(where, "단정·과장어를 쓰지 않는다");
}

// ---- 근거 수준(S6) ----

const KIND_OF = new Map(officialSources().map((s) => [s.id, s.kind]));
const floorOf = (source: string) => UNIT_RULES[(KIND_OF.get(source) ?? "dart") as OfficialKind].floor;

/** 근거 커뮤니티 단위(수준에 쓰는 칸만) */
export type LevelCommunity = Pick<NumberedCommunity, "group" | "recent">;

/**
 * S6: 약 → 강 → 중 순서로 먼저 맞는 것. 9.98 S1: 공식 묶음이 하나이고 커뮤니티 단위가 있으면 '중'이 최고이고,
 * 그 공식 묶음이나 근거 커뮤니티 단위 중 어느 것이든 하한의 두 배 미만이면 '약'이다. 공식 묶음이 둘 이상이면 커뮤니티는 수준을 바꾸지 않는다
 */
export function flowLevel(units: readonly NumberedUnit[], community: readonly LevelCommunity[] = []): FlowLevel {
  const byGroup = new Map<OfficialGroup, NumberedUnit[]>();
  for (const u of units) byGroup.set(u.group, [...(byGroup.get(u.group) ?? []), u]);
  const weak = [...byGroup.values()].some((us) => {
    const bySource = new Map<string, number>();
    for (const u of us) bySource.set(u.source, (bySource.get(u.source) ?? 0) + u.recent);
    return ![...bySource].some(([s, sum]) => sum >= 2 * floorOf(s));
  });
  if (weak) return "weak";
  if (isCommunityConfirmed(units, community)) return community.some((x) => x.recent < 2 * COMMUNITY_RULES[x.group].floor) ? "weak" : "medium";
  if (byGroup.size >= 3) return "strong";
  const lasting = [...byGroup.values()].every((us) => {
    // 판정 문서는 날마다 값이 없는 소스를 뺀다고 정하지만, 국회도 날마다 차이로 세어 지금은 해당 소스가 없다
    if (us.length < 2) return false;
    const mean = us.reduce((n, u) => n + u.baseDailyMean, 0);
    // 소스마다 창 끝이 다를 수 있어 날짜로 맞춘다. 묶음의 모든 단위에 값이 있는 날만 센다
    const byDate = us.map((u) => new Map(u.recentDaily.map((v, k) => [addDays(u.window.recentFrom, k), v] as const)));
    let days = 0;
    for (const d of byDate[0]!.keys()) {
      const vals = byDate.map((m) => m.get(d) ?? null);
      if (vals.some((v) => v === null)) continue;
      if (vals.reduce<number>((n, v) => n + (v ?? 0), 0) > mean) days++;
    }
    return days >= 4;
  });
  return byGroup.size === 2 && lasting ? "strong" : "medium";
}

// ---- 꺾임(9.98 S7) ----

export interface TurningUnit {
  group: string;
  window: { recentFrom: string; baseFrom: string };
  recentDaily: readonly (number | null)[];
  baseDaily?: readonly (number | null)[];
}

/** 날마다 값이 있는 묶음(S7). 지금은 공식 묶음 모두다(9.97 코드처럼). 커뮤니티 건수는 창 합계라 들지 않는다 */
export const isDailyGroup = (g: string): boolean => (OFFICIAL_GROUPS as readonly string[]).includes(g);

const mean = (xs: readonly number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

/**
 * 꺾임(S7): 날마다 값이 있는 근거 묶음 모두에서, 그날 값을 앞 창의 같은 요일 평균으로 나눈 비로 최근 창 마지막 3일의 평균이 앞 4일의 평균보다 낮으면 참이다.
 * 묶음의 날 값은 그 묶음 근거 단위의 합이고, 어느 단위든 값이 없는 날(자료 없음)은 뺀다. 같은 요일 평균이 0인 날도 뺀다.
 * 날마다 값이 있는 묶음이 없거나, 비를 낼 날이 앞 4일이나 마지막 3일 중 한쪽이라도 없는 묶음이 있으면 거짓이다
 */
export function turningOf(units: readonly TurningUnit[], isDaily: (group: string) => boolean = isDailyGroup): boolean {
  const byGroup = Map.groupBy(
    units.filter((u) => isDaily(u.group)),
    (u) => u.group,
  );
  if (byGroup.size === 0) return false;
  for (const us of byGroup.values()) {
    const maps = us.map((u) => {
      const m = new Map<string, number | null>();
      (u.baseDaily ?? []).forEach((v, k) => m.set(addDays(u.window.baseFrom, k), v));
      u.recentDaily.forEach((v, k) => m.set(addDays(u.window.recentFrom, k), v));
      return m;
    });
    const value = (d: string): number | null => {
      let sum = 0;
      for (const m of maps) {
        const v = m.get(d);
        if (v === undefined || v === null) return null;
        sum += v;
      }
      return sum;
    };
    const first = us[0]!;
    const ratios = first.recentDaily.map((_, k) => {
      const d = addDays(first.window.recentFrom, k);
      const v = value(d);
      if (v === null) return null;
      const same = [1, 2, 3, 4].map((w) => value(addDays(d, -7 * w))).filter((x): x is number => x !== null);
      if (same.length === 0) return null;
      const m = mean(same);
      return m === 0 ? null : v / m;
    });
    const cut = ratios.length - 3;
    const head = ratios.slice(0, cut).filter((x): x is number => x !== null);
    const tail = ratios.slice(cut).filter((x): x is number => x !== null);
    if (cut < 1 || head.length === 0 || tail.length === 0) return false;
    if (!(mean(tail) < mean(head))) return false;
  }
  return true;
}

// ---- 적용할 계획(4.2-3) ----

export type DropReason = "다시 센 값이 다름" | "같은 흐름이 강해지지 않음" | "같은 날 같은 흐름" | "3건 밖";

export interface FlowPlan {
  flows: NewFlow[];
  /** 자르기 전 인정된 건수 */
  recognized: number;
  dropped: Partial<Record<DropReason, number>>;
}

const toFlowUnit = (u: NumberedUnit): FlowUnit => ({ group: u.group, source: u.source, unitKey: u.key, unitName: u.name, recent: u.recent, base: u.base, isNew: u.isNew, recentFrom: u.window.recentFrom, recentTo: u.window.recentTo, baseFrom: u.window.baseFrom, baseTo: u.window.baseTo, recentDays: u.window.recentDays, baseDays: u.window.baseDays });

const toFlowCommunity = (c: NumberedCommunity, units: readonly NumberedUnit[]): FlowCommunityUnit => ({ group: c.group, source: c.source, unitKey: c.key, officialKey: c.officialKey, unitName: units.find((u) => u.n === c.officialN)?.name ?? "", recent: c.recent, base: c.base, isNew: c.isNew, recentFrom: c.window.recentFrom, recentTo: c.window.recentTo, baseFrom: c.window.baseFrom, baseTo: c.window.baseTo });

/**
 * 통과한 흐름에 기계 칸을 채운다. recount는 전용 DB에서 다시 센 소스별 결과다. 다시 센 값이 다르면 그 흐름을 버리고(4.2-3),
 * 같은 흐름(S8)은 새 묶음이 더해졌거나 수준이 올랐을 때만 같은 id로 싣는다. 그 뒤 4건 이상이면 수준 순으로 3건만 남긴다(S6)
 */
export function planFlows(checked: CheckedFlow[], recount: readonly SourceUnits[], recentItems: readonly Flow[], recent: FlowCandidates["recent"], communityRecount: readonly CommunityUnit[] = []): FlowPlan {
  const fresh = new Map(recount.flatMap((s) => s.rising.map((u) => [u.key, u] as const)));
  const freshCommunity = new Map(communityRecount.map((x) => [x.key, x] as const));
  const dropped: FlowPlan["dropped"] = {};
  const drop = (r: DropReason) => (dropped[r] = (dropped[r] ?? 0) + 1);
  const kept: { flow: NewFlow; order: number }[] = [];
  /** 이 날 이미 이어 받은 앞 흐름 id. 같은 흐름을 한 날에 두 번 싣지 않는다(수준이 높은 것, 같으면 앞서 쓴 것이 잇는다) */
  const claimed = new Set<string>();
  const byLevel = checked.map((f, order) => ({ f, order, rank: levelRank(flowLevel(f.units, f.community)) })).sort((a, b) => a.rank - b.rank || a.order - b.order);
  byLevel.forEach(({ f, order }) => {
    const community = f.community ?? [];
    const same = f.units.every((u) => {
      const x = fresh.get(u.key);
      return x !== undefined && x.recent === u.recent && x.base === u.base && x.window.recentTo === u.window.recentTo && x.window.recentDays === u.window.recentDays;
    });
    // 커뮤니티 숫자도 전용 DB에서 다시 센 값과 같아야 한다(4.3-3)
    const sameCommunity = community.every((c) => {
      const x = freshCommunity.get(c.key);
      return x !== undefined && x.recent === c.recent && x.baseCount === c.baseCount && x.judgement.rising === c.rising && x.window.recentFrom === c.window.recentFrom && x.window.recentTo === c.window.recentTo && x.window.baseFrom === c.window.baseFrom && x.window.baseTo === c.window.baseTo;
    });
    if (!same || !sameCommunity) return drop("다시 센 값이 다름");
    const level = flowLevel(f.units, community);
    const groups = new Set(f.units.map((u) => u.group));
    const ref = overlapOf(f.field, f.units.map((u) => u.key), recent);
    let flowId = "";
    let continues: number | null = null;
    if (ref !== null) {
      const ofFlow = recentItems.filter((x) => x.flowId === ref.flowId);
      const prev = [...ofFlow].sort((a, b) => b.date.localeCompare(a.date) || b.position - a.position)[0];
      if (prev !== undefined) {
        const prevGroups = new Set(prev.units.map((u) => u.group));
        // 커뮤니티 소스는 그 흐름 id의 최근 14일 항목 어디에도 없던 것만 새 묶음으로 친다(S1)
        const communityAdded = [...new Set(community.map((c) => c.source))].some((s) => !ofFlow.some((x) => (x.community ?? []).some((y) => y.source === s)));
        const added = [...groups].some((g) => !prevGroups.has(g)) || communityAdded;
        if (!added && levelRank(level) >= levelRank(prev.level)) return drop("같은 흐름이 강해지지 않음");
        if (claimed.has(prev.flowId)) return drop("같은 날 같은 흐름");
        claimed.add(prev.flowId);
        flowId = prev.flowId;
        continues = prev.id;
      }
    }
    const sorted = [...f.units].sort((a, b) => OFFICIAL_GROUPS.indexOf(a.group) - OFFICIAL_GROUPS.indexOf(b.group) || a.n - b.n);
    const communitySorted = [...community].sort((a, b) => COMMUNITY_GROUPS.indexOf(a.group) - COMMUNITY_GROUPS.indexOf(b.group) || a.n - b.n);
    const turning = turningOf(f.units.map((u) => fresh.get(u.key)!));
    kept.push({ order, flow: { flowId, category: f.category, field: f.field, ...f.texts, level, aux: f.aux, issue: f.issue, continues, units: sorted.map(toFlowUnit), community: communitySorted.map((c) => toFlowCommunity(c, f.units)), turning } });
  });
  const recognized = kept.length;
  kept.sort((a, b) => levelRank(a.flow.level) - levelRank(b.flow.level) || a.order - b.order);
  const shown = kept.slice(0, FLOW_MAX_SHOWN);
  if (recognized > FLOW_MAX_SHOWN) dropped["3건 밖"] = recognized - FLOW_MAX_SHOWN;
  return { flows: shown.map((x) => x.flow), recognized, dropped };
}
