import type { DatabaseSync } from "node:sqlite";
import { ITEM_LABELS, checkConfirmedRange, checkItemText, checkPublicText, isDueFormat, type ItemTextField } from "./builderCheck.ts";
import { recomputeReminder } from "./builderSchedule.ts";
import { builderItemByKey, isBuilderItemKey, isBuilderSchedule, itemsOfSchedule, type BuilderItem } from "./builderStore.ts";
import { isDiscoveryItemKey } from "./builderTypes.ts";
import { DISCOVERY_LABELS, DISCOVERY_LIMITS, DISCOVERY_TEXT_FIELDS, type DiscoveryTextField } from "./discoverCheck.ts";
import { discoveryByItemKey, type Discovery } from "./discoverStore.ts";
import { ADDRESS_RE, scanText } from "./precheck.ts";
import { getSchedule, isLiveSchedule, updateSchedule } from "./schedules.ts";
import { fullKey, inTransaction, storyByFullKey, storyKey, type StoryRef } from "./issues.ts";
import { Checker, checkQuotes, type Obj, type Violation } from "./validate.ts";

// 뉴스 정정(9.5단계 4.7). 운영자가 저장된 뉴스 글을 고치고 날짜와 사유를 남긴다. 고치기 전 글은 DB에 두지 않는다(백업 이력에 남는다).

/** 사유는 '정정됨' 표시와 함께 공개된다. 긴 글을 쓸 자리가 아니다 */
export const REASON_MAX = 120;

export const CORRECTION_FIELDS = ["title", "summary", "whyItMatters", "background", "keyFacts", "analogy", "outlook", "devCheckpoint"] as const;
export type CorrectionField = (typeof CORRECTION_FIELDS)[number];

const COLUMNS: Record<CorrectionField, string> = {
  title: "title",
  summary: "summary",
  whyItMatters: "why_it_matters",
  background: "background",
  keyFacts: "key_facts",
  analogy: "analogy",
  outlook: "outlook",
  devCheckpoint: "dev_checkpoint",
};

const LABELS: Record<CorrectionField, string> = {
  title: "제목",
  summary: "한 줄 요약",
  whyItMatters: "왜 중요한가",
  background: "배경",
  keyFacts: "핵심 사실",
  analogy: "비유",
  outlook: "앞으로 볼 것",
  devCheckpoint: "개발자 체크 포인트",
};

/** 사유에 쓰면 안 되는 모양. 공개 이력에서 지울 수 없으므로 제보자를 찾을 수 있는 값을 막는다 */
const REASON_BANS: { why: string; re: RegExp }[] = [
  { why: "주소", re: ADDRESS_RE },
  { why: "전화번호 모양", re: /(?<!\d)(?:\+?\d{1,3}[-.\s]?)?\d{2,4}[-.\s]\d{3,4}[-.\s]\d{4}(?!\d)|(?<!\d)01\d{8,9}(?!\d)/ },
];

export interface CorrectionRecord {
  /** 고친 날(KST) */
  on: string;
  reason: string;
  /** 바뀐 항목 이름(CORRECTION_FIELDS) */
  fields: CorrectionField[];
}

export interface CorrectionInput {
  date: string;
  key: string;
  reason: string;
  fields: Partial<Record<CorrectionField, string | string[]>>;
}

export type CorrectionCheck = { ok: true; input: CorrectionInput; story: StoryRef; changed: CorrectionField[] } | { ok: false; violations: Violation[] };

function storeValue(field: CorrectionField, value: string | string[]): string {
  return field === "keyFacts" ? JSON.stringify(value) : (value as string);
}

function checkReason(c: Checker, reason: string, home: string | null, secrets: readonly string[]): void {
  const w = "사유";
  if (reason.length > REASON_MAX) c.add(w, `${reason.length}자다(${REASON_MAX}자 이하여야 한다)`);
  if (/[\r\n]/.test(reason)) c.add(w, "한 줄이어야 한다");
  if (reason.includes("@")) c.add(w, "메일 주소를 쓸 수 없다");
  for (const b of REASON_BANS) if (b.re.test(reason)) c.add(w, `${b.why}를 쓸 수 없다`);
  for (const kind of scanText(reason, home, secrets).keys()) c.add(w, kind);
}

/** 정정 파일을 검사한다. 어긴 것이 있으면 아무것도 바꾸지 않는다. 지금 글과 같은 항목은 changed에서 뺀다 */
export function checkCorrection(db: DatabaseSync, raw: unknown, home: string | null, secrets: readonly string[] = []): CorrectionCheck {
  const c = new Checker();
  const o = c.obj(raw, "정정 파일");
  if (o === null) return { ok: false, violations: c.violations };
  c.keys(o, ["date", "key", "reason", "fields"], "정정 파일");
  const date = c.text(o, "date", "날짜", "정정 파일");
  const key = c.text(o, "key", "뉴스 키", "정정 파일");
  const reason = c.text(o, "reason", "사유", "정정 파일");
  if (reason !== "") checkReason(c, reason, home, secrets);
  const fieldsObj = c.obj(o.fields, "고칠 항목");
  const story = date !== "" && key !== "" ? storyByFullKey(db, fullKey({ date, key })) : null;
  if (date !== "" && key !== "" && story === null) c.add("뉴스", `${date} ${key} 뉴스가 없다`);
  if (fieldsObj === null || story === null) return { ok: false, violations: c.violations };

  const names = Object.keys(fieldsObj);
  if (names.length === 0) c.add("고칠 항목", "하나 이상이어야 한다");
  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(story.id) as Record<string, string | number | null>;
  const allowed: readonly string[] = story.kind === "top" ? CORRECTION_FIELDS : ["summary"];
  const fields: CorrectionInput["fields"] = {};
  const changed: CorrectionField[] = [];
  for (const name of names) {
    if (!allowed.includes(name)) {
      c.add("고칠 항목", `"${name}"은(는) 고칠 수 없다(고칠 수 있는 항목: ${allowed.join(", ")})`);
      continue;
    }
    const field = name as CorrectionField;
    const label = LABELS[field];
    const now = row[COLUMNS[field]] ?? null;
    if (now === null) {
      c.add(label, "값이 비어 있는 선택 항목은 새로 채우지 않는다");
      continue;
    }
    const value = checkValue(c, fieldsObj, field, label, home, secrets);
    if (value === null) continue;
    fields[field] = value;
    if (storeValue(field, value) !== now) changed.push(field);
  }
  if (c.violations.length > 0) return { ok: false, violations: c.violations };
  return { ok: true, input: { date, key, reason, fields }, story, changed };
}

/** 저장 때의 글 항목 검사(비지 않음, 인용 길이, 핵심 사실 수)와 공개 검사(scanText) */
function checkValue(c: Checker, o: Obj, field: CorrectionField, label: string, home: string | null, secrets: readonly string[]): string | string[] | null {
  const before = c.violations.length;
  let value: string | string[];
  if (field === "keyFacts") {
    const facts = c.arr(o, field, label, label);
    c.count(facts.length, 3, 5, label);
    value = facts.map((f, i) => {
      if (typeof f !== "string" || f.trim() === "") c.add(`${label} ${i + 1}`, "비어 있으면 안 된다");
      return typeof f === "string" ? f : "";
    });
    value.forEach((f, i) => checkQuotes(c, f, `${label} ${i + 1}`));
  } else {
    value = c.text(o, field, label, "고칠 항목");
    checkQuotes(c, value, label);
  }
  for (const text of Array.isArray(value) ? value : [value]) for (const kind of scanText(text, home, secrets).keys()) c.add(label, kind);
  return c.violations.length > before ? null : value;
}

/** 검사를 통과한 정정을 트랜잭션 하나로 적용한다 */
export function applyCorrection(db: DatabaseSync, checked: Extract<CorrectionCheck, { ok: true }>, today: string): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const field of checked.changed) db.prepare(`UPDATE stories SET ${COLUMNS[field]} = ? WHERE id = ?`).run(storeValue(field, checked.input.fields[field]!), checked.story.id);
    db.prepare("INSERT INTO story_corrections (story_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(checked.story.id, today, checked.input.reason, JSON.stringify(checked.changed));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 그 뉴스가 붙은 이슈 번호(같은 오류를 함께 보게 한다) */
export function issuesOfStory(db: DatabaseSync, storyId: number): number[] {
  return (db.prepare("SELECT issue_id FROM story_issues WHERE story_id = ? ORDER BY is_primary DESC, issue_id").all(storyId) as { issue_id: number }[]).map((r) => r.issue_id);
}

export interface StoredCorrection extends CorrectionRecord {
  /** 전역 뉴스 키(`날짜/키`) */
  story: string;
}

/** 모든 정정 기록. 뉴스 키 순, 같은 뉴스는 적용한 순서다 */
export function allCorrections(db: DatabaseSync): StoredCorrection[] {
  const rows = db
    .prepare(`SELECT c.corrected_on, c.reason, c.fields, se.target_date, se.name, st.kind, st.position
      FROM story_corrections c JOIN stories st ON st.id = c.story_id JOIN sections se ON se.id = st.section_id
      ORDER BY se.target_date, se.position, st.kind DESC, st.position, c.id`)
    .all() as unknown as { corrected_on: string; reason: string; fields: string; target_date: string; name: string; kind: "top" | "short"; position: number }[];
  return rows.map((r) => ({ story: fullKey({ date: r.target_date, key: storyKey(r.name, r.kind, r.position) }), on: r.corrected_on, reason: r.reason, fields: JSON.parse(r.fields) as CorrectionField[] }));
}

// ---- 빌더 항목 정정(9.8단계 4.5-2, B8) ----

export const BUILDER_CORRECTION_FIELDS = ["title", "whatChanged", "who", "action", "why", "dueDate"] as const;
export type BuilderCorrectionField = (typeof BUILDER_CORRECTION_FIELDS)[number];

const BUILDER_COLUMNS: Record<BuilderCorrectionField, string> = { title: "title", whatChanged: "what_changed", who: "who", action: "action", why: "why", dueDate: "due_date" };

export interface BuilderCorrectionInput {
  date: string;
  key: string;
  reason: string;
  fields: Partial<Record<BuilderCorrectionField, string>>;
}

export type BuilderCorrectionCheck = { ok: true; input: BuilderCorrectionInput; item: BuilderItem; changed: BuilderCorrectionField[] } | { ok: false; violations: Violation[] };

/** 정정 파일이 빌더 항목을 가리키는지 */
export function isBuilderCorrection(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && isBuilderItemKey((raw as Obj).key);
}

/** 빌더·새 종류 정정 파일의 공통 칸. 파일이 객체가 아니면 null */
function correctionHead(c: Checker, raw: unknown, home: string | null, secrets: readonly string[]): { date: string; key: string; reason: string; fieldsObj: Obj | null } | null {
  const o = c.obj(raw, "정정 파일");
  if (o === null) return null;
  c.keys(o, ["date", "key", "reason", "fields"], "정정 파일");
  const date = c.text(o, "date", "날짜", "정정 파일");
  const key = c.text(o, "key", "항목 키", "정정 파일");
  const reason = c.text(o, "reason", "사유", "정정 파일");
  if (reason !== "") checkReason(c, reason, home, secrets);
  return { date, key, reason, fieldsObj: c.obj(o.fields, "고칠 항목") };
}

/** 빌더 항목 정정 파일을 검사한다. 출처와 확정 여부는 고칠 수 없다 */
export function checkBuilderCorrection(db: DatabaseSync, raw: unknown, today: string, home: string | null, secrets: readonly string[] = []): BuilderCorrectionCheck {
  const c = new Checker();
  const head = correctionHead(c, raw, home, secrets);
  if (head === null) return { ok: false, violations: c.violations };
  const { date, key, reason, fieldsObj } = head;
  const item = date !== "" && key !== "" ? builderItemByKey(db, date, key) : null;
  if (date !== "" && key !== "" && item === null) c.add("빌더 항목", `${date} ${key} 항목이 없다`);
  if (fieldsObj === null || item === null) return { ok: false, violations: c.violations };
  const names = Object.keys(fieldsObj);
  if (names.length === 0) c.add("고칠 항목", "하나 이상이어야 한다");
  const fields: BuilderCorrectionInput["fields"] = {};
  const changed: BuilderCorrectionField[] = [];
  for (const name of names) {
    if (!(BUILDER_CORRECTION_FIELDS as readonly string[]).includes(name)) {
      c.add("고칠 항목", `"${name}"은(는) 고칠 수 없다(고칠 수 있는 항목: ${BUILDER_CORRECTION_FIELDS.join(", ")})`);
      continue;
    }
    if (name === "dueDate") {
      const value = fieldsObj.dueDate;
      if (item.due === null) c.add("기한", "기한이 없는 항목이다");
      else if (!isDueFormat(value)) c.add("기한", `"${String(value)}"은(는) YYYY-MM-DD나 YYYY-MM이어야 한다`);
      else {
        if (item.due.state === "confirmed") {
          if (value.length === 7) c.add("기한", "확정 기한은 일 단위여야 한다");
          else checkConfirmedRange(c, "기한", value, today);
        }
        fields.dueDate = value;
        if (value !== item.due.date) changed.push("dueDate");
      }
      continue;
    }
    const field = name as ItemTextField;
    const value = c.text(fieldsObj, field, ITEM_LABELS[field], "고칠 항목");
    if (value === "") continue;
    checkItemText(c, ITEM_LABELS[field], field, value, home, secrets);
    fields[field] = value;
    if (value !== item[field]) changed.push(field);
  }
  if (c.violations.length > 0) return { ok: false, violations: c.violations };
  return { ok: true, input: { date, key, reason, fields }, item, changed };
}

export interface BuilderCorrectionResult {
  /** 예정일을 함께 고친 빌더 일정 */
  moved: number[];
  /** 뉴스 근거가 있어 그대로 둔 일정 */
  newsKept: number[];
  /** 같은 일정에 이어진 다른 항목의 식별자 */
  others: number[];
}

/** 검사를 통과한 빌더 정정을 한 트랜잭션으로 적용한다. 기한이 바뀌면 이어진 빌더 일정의 예정일과 다시 알림을 고친다 */
export function applyBuilderCorrection(db: DatabaseSync, checked: Extract<BuilderCorrectionCheck, { ok: true }>, today: string): BuilderCorrectionResult {
  const { item, changed, input } = checked;
  const out: BuilderCorrectionResult = { moved: [], newsKept: [], others: [] };
  return inTransaction(db, () => {
    for (const field of changed) db.prepare(`UPDATE builder_items SET ${BUILDER_COLUMNS[field]} = ? WHERE id = ?`).run(input.fields[field]!, item.id);
    db.prepare("INSERT INTO builder_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(item.id, today, input.reason, JSON.stringify(changed));
    if (changed.includes("dueDate")) {
      for (const id of item.schedules) {
        const s = getSchedule(db, id);
        if (s === null || !isLiveSchedule(s)) continue;
        if (!isBuilderSchedule(db, id)) {
          out.newsKept.push(id);
          continue;
        }
        updateSchedule(db, id, { due: input.fields.dueDate! });
        recomputeReminder(db, id, today);
        out.moved.push(id);
        out.others.push(...itemsOfSchedule(db, id).filter((x) => x !== item.id));
      }
    }
    return out;
  });
}

// ---- 새 제품·뜨는 저장소 정정(9.9단계 4.4-2) ----

export interface DiscoveryCorrectionInput {
  date: string;
  key: string;
  reason: string;
  fields: Partial<Record<DiscoveryTextField, string>>;
}

export type DiscoveryCorrectionCheck = { ok: true; input: DiscoveryCorrectionInput; item: Discovery; changed: DiscoveryTextField[] } | { ok: false; violations: Violation[] };

/** 정정 파일이 새 제품이나 뜨는 저장소 항목을 가리키는지 */
export function isDiscoveryCorrection(raw: unknown): boolean {
  return typeof raw === "object" && raw !== null && isDiscoveryItemKey((raw as Obj).key);
}

/** 글 칸만 고친다. 이름, 출처, 라이선스, 관리 상태, 별 수, 증가량은 후보 값이라 고칠 수 없다 */
export function checkDiscoveryCorrection(db: DatabaseSync, raw: unknown, home: string | null, secrets: readonly string[] = []): DiscoveryCorrectionCheck {
  const c = new Checker();
  const head = correctionHead(c, raw, home, secrets);
  if (head === null) return { ok: false, violations: c.violations };
  const { date, key, reason, fieldsObj } = head;
  const item = date !== "" && key !== "" ? discoveryByItemKey(db, date, key) : null;
  if (date !== "" && key !== "" && item === null) c.add("빌더 항목", `${date} ${key} 항목이 없다`);
  if (fieldsObj === null || item === null) return { ok: false, violations: c.violations };
  const names = Object.keys(fieldsObj);
  if (names.length === 0) c.add("고칠 항목", "하나 이상이어야 한다");
  const fields: DiscoveryCorrectionInput["fields"] = {};
  const changed: DiscoveryTextField[] = [];
  for (const name of names) {
    if (!(DISCOVERY_TEXT_FIELDS as string[]).includes(name)) {
      c.add("고칠 항목", `"${name}"은(는) 고칠 수 없다(고칠 수 있는 항목: ${DISCOVERY_TEXT_FIELDS.join(", ")})`);
      continue;
    }
    const field = name as DiscoveryTextField;
    const value = c.text(fieldsObj, field, DISCOVERY_LABELS[field], "고칠 항목");
    if (value === "") continue;
    checkPublicText(c, DISCOVERY_LABELS[field], value, DISCOVERY_LIMITS[field], home, secrets);
    fields[field] = value;
    if (value !== item[field]) changed.push(field);
  }
  if (c.violations.length > 0) return { ok: false, violations: c.violations };
  return { ok: true, input: { date, key, reason, fields }, item, changed };
}

export function applyDiscoveryCorrection(db: DatabaseSync, checked: Extract<DiscoveryCorrectionCheck, { ok: true }>, today: string): void {
  const { item, changed, input } = checked;
  inTransaction(db, () => {
    for (const field of changed) db.prepare(`UPDATE builder_discoveries SET ${field} = ? WHERE id = ?`).run(input.fields[field]!, item.id);
    db.prepare("INSERT INTO builder_discovery_corrections (item_id, corrected_on, reason, fields) VALUES (?, ?, ?, ?)").run(item.id, today, input.reason, JSON.stringify(changed));
  });
}

export function hasCorrections(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM story_corrections LIMIT 1").get() !== undefined;
}

/** 전역 뉴스 키 → 정정 기록(적용한 순서) */
export function correctionsByStory(db: DatabaseSync): Map<string, CorrectionRecord[]> {
  const out = new Map<string, CorrectionRecord[]>();
  for (const { story, ...rec } of allCorrections(db)) out.set(story, [...(out.get(story) ?? []), rec]);
  return out;
}

export const CORRECTION_GUIDE = "사유는 '무엇을 무엇으로 바로잡았다'로 무엇을 어떻게 고쳤는지만 쓴다. 제보자와 제보 내용은 쓰지 않는다(사유는 공개되고 공개 이력에서 지울 수 없다).";
