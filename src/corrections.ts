import type { DatabaseSync } from "node:sqlite";
import { scanText } from "./precheck.ts";
import { fullKey, storyByFullKey, storyKey, type StoryRef } from "./issues.ts";
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
  { why: "주소", re: /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|kr|io|co|ai|dev|app)\b/i },
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
