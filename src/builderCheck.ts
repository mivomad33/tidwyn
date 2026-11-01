import type { DatabaseSync } from "node:sqlite";
import { readDates } from "./builderDocs.ts";
import { BUILDER_DUE_MAX_DAYS, dueChanges, placeOnCalendar } from "./builderSchedule.ts";
import {
  BUILDER_FIELDS,
  MAX_EMITS,
  MAX_ITEMS_PER_DAY,
  addEmitted,
  advanceSource,
  builderItemsOfDate,
  bumpPending,
  deletePending,
  getPending,
  insertBuilderItem,
  isBuilderDone,
  linkItemSchedule,
  setBuilderStatus,
  setReminder,
  type BuilderDue,
  type BuilderDueState,
  type BuilderField,
  type BuilderItem,
  type BuilderItemSource,
  type NewBuilderItem,
} from "./builderStore.ts";
import type { BuilderWorkData, WorkCandidate, WorkReminder } from "./builderWork.ts";
import { getIssue, inTransaction } from "./issues.ts";
import { addDays, isValidDate } from "./kst.ts";
import { ADDRESS_RE, failsPublicScan, hasEmail, scanText } from "./precheck.ts";
import { checkScheduleName } from "./scheduleExtract.ts";
import { hasVideoData } from "./siteCheck.ts";
import { Checker, checkQuotes, type Violation } from "./validate.ts";

// 9.8단계 4.3-2, 4.3-4: 빌더 항목 파일 검사와 적용. 후보 글은 데이터이고, 공개 글과 키는 저장 전에 공개 검사를 지난다.

/** 칸별 글자 수 상한(4.3-2) */
export const ITEM_LIMITS = { title: 60, whatChanged: 300, who: 100, action: 150, why: 100 } as const;
export type ItemTextField = keyof typeof ITEM_LIMITS;
export const ITEM_LABELS: Record<ItemTextField, string> = { title: "제목", whatChanged: "무엇이 바뀌었나", who: "누가 영향받나", action: "지금 할 일", why: "고른 이유" };
/** 재료를 이만큼 이어서 옮기면 복사다 */
const COPY_WORDS = 12;

/** 패키지 범위(`@scope/name`)가 아닌 `@계정` 모양 */
const ACCOUNT_RE = /(?<![\w./-])@[A-Za-z0-9][\w-]*(?![\w-])(?!\/[\w.-])/;
/** 빈 틀 문구(공백과 문장 부호를 뺀 소문자). `지금 할 일`의 "없음"은 허용한다 */
const BLANK_PHRASES = new Set(["없음", "해당없음", "na", "tbd", "todo", "미정", "미상", "모름", "알수없음", "내용없음", "추후공지", "추후안내", "확인필요", "추가예정"]);

const charCount = (s: string) => [...s].length;
const squeeze = (s: string) => s.toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, "");

/** 글 칸 하나의 검사(상한, 빈 틀, 인용, 주소, 메일, `@계정`, 결과물 검사 거부 글, 공개 검사). 정정도 쓴다 */
export function checkItemText(c: Checker, where: string, field: ItemTextField, text: string, home: string | null, secrets: readonly string[]): void {
  const max = ITEM_LIMITS[field];
  if (charCount(text) > max) c.add(where, `${charCount(text)}자다(${max}자 이하여야 한다)`);
  const blank = squeeze(text);
  if (BLANK_PHRASES.has(blank) && !(field === "action" && blank === "없음")) c.add(where, "빈 틀 문구다");
  checkQuotes(c, text, where);
  if (ADDRESS_RE.test(text)) c.add(where, "주소를 넣지 않는다");
  if (hasEmail(text)) c.add(where, "메일 주소를 넣지 않는다");
  if (ACCOUNT_RE.test(text)) c.add(where, "`@계정` 모양을 넣지 않는다(패키지 범위는 된다)");
  if (hasVideoData(text)) c.add(where, "결과물 검사가 거부하는 글이다");
  for (const kind of scanText(text, home, secrets).keys()) c.add(where, kind);
}

/** 기한 날짜 형식(일 단위나 달 단위). 맞으면 true */
export function isDueFormat(v: unknown): v is string {
  return typeof v === "string" && (isValidDate(v) || /^\d{4}-(0[1-9]|1[0-2])$/.test(v));
}

/** 확정 기한의 범위(4.4-1). 어기면 위반을 더한다 */
export function checkConfirmedRange(c: Checker, where: string, date: string, base: string): void {
  const min = addDays(base, 1);
  const max = addDays(base, BUILDER_DUE_MAX_DAYS);
  if (date < min || date > max) c.add(where, `확정 기한 ${date}은(는) ${min}부터 ${max}까지여야 한다`);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s\p{P}\p{S}]+/u)
    .filter((w) => w !== "");
}

function copyGrams(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const w = words(t);
    for (let i = 0; i + COPY_WORDS <= w.length; i++) out.add(w.slice(i, i + COPY_WORDS).join(" "));
  }
  return out;
}

function copied(text: string, grams: Set<string>): boolean {
  const w = words(text);
  for (let i = 0; i + COPY_WORDS <= w.length; i++) if (grams.has(w.slice(i, i + COPY_WORDS).join(" "))) return true;
  return false;
}

export interface PlannedItem extends NewBuilderItem {
  scheduleName: string | null;
  /** 다시 알림이면 기존 일정 */
  reminderSchedule: number | null;
}

export interface BuilderPlan {
  target: string;
  items: PlannedItem[];
}

export type BuilderCheck = { ok: true; plan: BuilderPlan } | { ok: false; violations: Violation[] };

export interface CheckOptions {
  home: string | null;
  secrets?: readonly string[];
}

/** 이미 저장된 항목인지(같은 날의 같은 다시 알림, 또는 키가 모두 있는 항목) */
function alreadyStored(existing: BuilderItem[], x: { reminderOf: number | null; keys: string[] }): boolean {
  if (x.reminderOf !== null) return existing.some((e) => e.reminderOf === x.reminderOf);
  return x.keys.length > 0 && existing.some((e) => x.keys.every((k) => e.keys.includes(k)));
}

interface ItemDue {
  due: BuilderDue | null;
  scheduleName: string | null;
}

/** 항목의 기한 칸을 읽는다. 형식이 틀리면 위반을 더하고 null */
function parseDue(c: Checker, raw: unknown, w: string): ItemDue | null {
  if (raw === null || raw === undefined) return { due: null, scheduleName: null };
  const o = c.obj(raw, `${w} 기한`);
  if (o === null) return null;
  c.keys(o, ["date", "state", "schedule"], `${w} 기한`);
  const state = o.state;
  if (state !== "confirmed" && state !== "tentative") {
    c.add(`${w} 기한 state`, "confirmed나 tentative여야 한다");
    return null;
  }
  if (!isDueFormat(o.date)) {
    c.add(`${w} 기한 date`, `"${String(o.date)}"은(는) YYYY-MM-DD나 YYYY-MM이어야 한다`);
    return null;
  }
  const scheduleName = state === "confirmed" && o.schedule !== undefined && o.schedule !== null ? String(o.schedule) : null;
  return { due: { date: o.date, state: state as BuilderDueState }, scheduleName };
}

/** 기한의 내용 검사. 다시 알림은 일정의 지금 예정일을 쓰고, 새 기한은 후보 재료에 있어야 한다(4.3-2) */
function checkDue(c: Checker, w: string, { due, scheduleName }: ItemDue, reminder: WorkReminder | null, candidates: WorkCandidate[], target: string, home: string | null, secrets: readonly string[]): void {
  if (reminder !== null) {
    if (due?.date !== reminder.due || due.state !== "confirmed") c.add(`${w} 기한`, `다시 알림의 기한은 일정의 지금 예정일 ${reminder.due}(확정)이어야 한다`);
    return;
  }
  if (due === null) return;
  const known = new Set(candidates.flatMap((x) => readDates(x.material, x.publishedOn).map((d) => d.value)));
  if (!known.has(due.date)) c.add(`${w} 기한`, `날짜 ${due.date}이(가) 후보의 재료 글에 없다`);
  if (due.state !== "confirmed") return;
  if (due.date.length === 7) c.add(`${w} 기한`, "달 단위 기한은 확정으로 쓰지 않는다");
  else checkConfirmedRange(c, `${w} 기한`, due.date, target);
  if (candidates.some((x) => x.tentative)) c.add(`${w} 기한`, "잠정 표시 후보의 기한을 확정으로 쓸 수 없다");
  if (scheduleName === null) {
    c.add(`${w} 기한`, "확정 기한에는 일정 이름(schedule)이 필요하다");
    return;
  }
  checkScheduleName(c, scheduleName, `${w} 일정 이름`);
  for (const kind of scanText(scheduleName, home, secrets).keys()) c.add(`${w} 일정 이름`, kind);
  if (hasEmail(scheduleName)) c.add(`${w} 일정 이름`, "메일 주소를 넣지 않는다");
}

/** 항목 파일을 검사한다(4.3-2). 위반마다 위치와 이유 */
export function checkBuilderFile(db: DatabaseSync, data: unknown, work: BuilderWorkData, o: CheckOptions): BuilderCheck {
  const { home } = o;
  const secrets = o.secrets ?? [];
  const c = new Checker();
  const root = c.obj(data, "빌더 항목 파일");
  if (root === null) return { ok: false, violations: c.violations };
  c.keys(root, ["targetDate", "items"], "빌더 항목 파일");
  const target = work.target;
  if (root.targetDate !== target) c.add("빌더 항목 파일 targetDate", `대상 날짜 ${target}와 같아야 한다(지금: ${String(root.targetDate)})`);
  const rawItems = c.arr(root, "items", "items", "빌더 항목 파일");
  if (rawItems.length > MAX_ITEMS_PER_DAY) c.add("items", `${rawItems.length}개다(${MAX_ITEMS_PER_DAY}개 이하여야 한다)`);
  const existing = builderItemsOfDate(db, target);
  const byN = new Map<number, WorkCandidate | WorkReminder>([...work.candidates.map((x): [number, WorkCandidate] => [x.n, x]), ...work.reminders.map((x): [number, WorkReminder] => [x.n, x])]);
  const isReminder = (x: WorkCandidate | WorkReminder): x is WorkReminder => "schedule" in x;
  const used = new Set<number>();
  const items: PlannedItem[] = [];
  rawItems.forEach((raw, idx) => {
    const w = `항목 ${idx + 1}`;
    const it = c.obj(raw, w);
    if (it === null) return;
    c.keys(it, ["field", "title", "whatChanged", "who", "action", "why", "due", "sources", "candidates", "issue"], w);
    const field = it.field as BuilderField;
    if (!(BUILDER_FIELDS as readonly unknown[]).includes(field)) c.add(`${w} 분야`, `"${String(it.field)}"은(는) 분야(${BUILDER_FIELDS.join(", ")})가 아니다`);
    const texts = {} as Record<ItemTextField, string>;
    for (const f of Object.keys(ITEM_LIMITS) as ItemTextField[]) {
      texts[f] = c.text(it, f, ITEM_LABELS[f], w);
      if (texts[f] !== "") checkItemText(c, `${w} ${ITEM_LABELS[f]}`, f, texts[f], home, secrets);
    }
    const numbers = c.arr(it, "candidates", "후보 번호", w);
    if (numbers.length === 0) c.add(`${w} 후보 번호`, "1개 이상이어야 한다");
    const picked: (WorkCandidate | WorkReminder)[] = [];
    for (const n of numbers) {
      const found = typeof n === "number" ? byN.get(n) : undefined;
      if (found === undefined) c.add(`${w} 후보 번호`, `${String(n)}번 후보가 없다`);
      else if (used.has(found.n)) c.add(`${w} 후보 번호`, `${found.n}번을 두 항목이 쓴다`);
      else {
        used.add(found.n);
        picked.push(found);
      }
    }
    const reminder = picked.find(isReminder) ?? null;
    if (reminder !== null && picked.length > 1) c.add(`${w} 후보 번호`, "다시 알림은 다른 후보와 함께 쓰지 않는다");
    const candidates = picked.filter((x): x is WorkCandidate => !isReminder(x));
    const allowed = new Map<string, string>();
    for (const x of candidates) allowed.set(x.url, x.sourceLabel);
    if (reminder !== null) for (const s of reminder.sources) allowed.set(s.url, s.name);
    const sourceList = c.arr(it, "sources", "출처", w);
    if (sourceList.length === 0) c.add(`${w} 출처`, "1개 이상이어야 한다");
    const sources: BuilderItemSource[] = [];
    for (const u of sourceList) {
      const url = typeof u === "string" ? u : "";
      const name = allowed.get(url);
      if (name === undefined) c.add(`${w} 출처`, `후보의 출처 주소가 아니다: ${url}`);
      else if (!sources.some((s) => s.url === url)) sources.push({ name, url });
      for (const kind of scanText(url, home, secrets).keys()) c.add(`${w} 출처`, kind);
    }
    const keys = [...new Set(candidates.flatMap((x) => x.keys))];
    for (const k of keys) {
      if (hasEmail(k)) c.add(`${w} 키`, "메일 모양 키는 저장하지 않는다");
      for (const kind of scanText(k, home, secrets).keys()) c.add(`${w} 키`, kind);
    }
    const parsed = parseDue(c, it.due, w);
    if (parsed !== null) checkDue(c, w, parsed, reminder, candidates, target, home, secrets);
    if (reminder === null) {
      const grams = copyGrams(candidates.map((x) => `${x.title}\n${x.material}`));
      for (const f of Object.keys(ITEM_LIMITS) as ItemTextField[]) if (copied(texts[f], grams)) c.add(`${w} ${ITEM_LABELS[f]}`, `재료 문장을 ${COPY_WORDS}단어 이상 그대로 옮겼다`);
    }
    let issue: number | null = null;
    if (it.issue !== undefined && it.issue !== null) {
      if (typeof it.issue !== "number" || getIssue(db, it.issue) === null) c.add(`${w} 이슈`, `이슈 ${String(it.issue)}이(가) 없다`);
      else issue = it.issue;
    }
    items.push({
      field,
      title: texts.title,
      whatChanged: texts.whatChanged,
      who: texts.who,
      action: texts.action,
      why: texts.why,
      due: parsed?.due ?? null,
      sources,
      issue,
      reminderOf: reminder?.itemId ?? null,
      keys,
      scheduleName: parsed?.scheduleName ?? null,
      reminderSchedule: reminder?.schedule ?? null,
    });
  });
  const fresh = items.filter((x) => !alreadyStored(existing, x));
  if (existing.length + fresh.length > MAX_ITEMS_PER_DAY) c.add("items", `이미 실린 ${existing.length}건을 더해 그날 ${existing.length + fresh.length}건이다(${MAX_ITEMS_PER_DAY}건 이하여야 한다)`);
  // D-7 대상을 뺀 것. 같은 파일의 새 항목이 그 일정의 종료일을 바꾸면 빼도 된다(4.3-2)
  const moved = new Set(items.filter((x) => x.reminderOf === null).flatMap((x) => dueChanges(db, x.keys, x.due, target).builder.map((s) => s.id)));
  const written = new Set(items.map((x) => x.reminderSchedule));
  const required = work.reminders.filter((r) => !moved.has(r.schedule)).slice(0, Math.max(0, MAX_ITEMS_PER_DAY - existing.length));
  for (const r of required) if (!written.has(r.schedule)) c.add("다시 알림", `일정 ${r.schedule}(${r.scheduleName})의 다시 알림 ${r.n}번이 빠졌다`);
  return c.violations.length > 0 ? { ok: false, violations: c.violations } : { ok: true, plan: { target, items: fresh } };
}

export interface BuilderApplied {
  status: "applied" | "nothing";
  items: number;
  reminders: number;
  newSchedules: number;
  linked: number;
  postponed: number;
  moved: number;
  /** 종료일 변경인데 뉴스 근거가 있어 그대로 둔 일정 */
  newsKept: number[];
}

function emptyApplied(status: BuilderApplied["status"]): BuilderApplied {
  return { status, items: 0, reminders: 0, newSchedules: 0, linked: 0, postponed: 0, moved: 0, newsKept: [] };
}

/** 끝남이 되는 적용의 뒷일: 받은 시각, 미적용 변경, 낸 횟수, 낸 키(B15, B16) */
function finishRun(db: DatabaseSync, work: BuilderWorkData, chosen: Set<string>, safe: (key: string) => boolean): void {
  for (const source of work.advance) advanceSource(db, source, work.fetchedAt);
  for (const c of work.candidates) {
    for (const key of c.keys) {
      if (key.startsWith("eol:")) {
        if (!chosen.has(key) && safe(key)) addEmitted(db, key, work.target);
        continue;
      }
      const p = getPending(db, key);
      if (p === null) continue;
      if (p.kind !== "deprecation" || chosen.has(key)) {
        deletePending(db, key);
        continue;
      }
      if (c.cut) continue;
      if (p.emits + 1 >= MAX_EMITS) {
        addEmitted(db, key, work.target);
        deletePending(db, key);
      } else bumpPending(db, key);
    }
  }
}

/**
 * 검사를 통과한 항목을 한 트랜잭션으로 저장한다(4.3-4). 끝난 날짜면 아무것도 하지 않는다.
 * 파일의 상태가 받지 못함이면 항목과 상태만 저장하고 시각과 미적용 변경은 그대로 둔다(4.3-5).
 */
export function applyBuilderPlan(db: DatabaseSync, plan: BuilderPlan, work: BuilderWorkData, o: CheckOptions): BuilderApplied {
  if (isBuilderDone(db, plan.target)) return emptyApplied("nothing");
  const secrets = o.secrets ?? [];
  const out = emptyApplied("applied");
  return inTransaction(db, () => {
    const existing = builderItemsOfDate(db, plan.target);
    const chosen = new Set<string>();
    for (const x of plan.items) {
      if (alreadyStored(existing, x)) continue;
      const { scheduleName, reminderSchedule, ...item } = x;
      const id = insertBuilderItem(db, plan.target, item);
      for (const k of x.keys) chosen.add(k);
      out.items++;
      if (reminderSchedule !== null) {
        linkItemSchedule(db, id, reminderSchedule);
        setReminder(db, reminderSchedule, "sent", plan.target);
        out.reminders++;
        continue;
      }
      const placed = placeOnCalendar(db, id, { keys: x.keys, due: x.due, scheduleName }, plan.target);
      if (placed.created) out.newSchedules++;
      if (placed.schedule !== null) out.linked++;
      out.postponed += placed.postponed;
      out.moved += placed.moved;
      out.newsKept.push(...placed.newsKept);
    }
    setBuilderStatus(db, plan.target, work.status);
    if (work.status !== "failed") {
      finishRun(db, work, chosen, (k) => !failsPublicScan(k, o.home, secrets));
    }
    return out;
  });
}

/** 받지 못함을 저장한다(4.3-1). 끝난 날짜는 바꾸지 않고, 저장된 항목과 시각은 그대로 둔다 */
export function markBuilderFailed(db: DatabaseSync, date: string): boolean {
  if (isBuilderDone(db, date)) return false;
  setBuilderStatus(db, date, "failed");
  return true;
}
