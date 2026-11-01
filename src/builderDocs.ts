import { createHash } from "node:crypto";
import { decodeXmlText } from "./feeds.ts";
import { addDays, isValidDate } from "./kst.ts";

// 9.8단계 B7, B10: 문서의 표 행 뽑기와 지원 종료 판정. 공급사별 파서를 두지 않고 표 모양으로 읽는다.
// 문서 글은 데이터다(실행하거나 경로로 쓰지 않는다).

/** 비교하는 행 글의 최대 길이. 링크를 벗기고 공백을 줄인 행 글 자체에 적용한다(B10) */
export const ROW_MAX = 200;

export interface DocRow {
  /** 가장 가까운 제목 경로와 `<Tab title>` */
  path: string;
  /** 표 머리행(없으면 빈 글) */
  header: string;
  row: string;
}

export interface ParsedDoc {
  rows: DocRow[];
  /** 숫자 없는 행, 긴 행의 수(비교에서 빠진다) */
  noNumber: number;
  tooLong: number;
}

/** 이보다 긴 줄은 표 행이 될 수 없다고 보고 정규식에 넣지 않는다. 받은 글의 길이에 제곱으로 느려지는 것을 막는다 */
const RAW_LINE_MAX = 10_000;
const CELL_JOIN = " | ";
const isSeparator = (line: string) => /^[\s:|-]+$/.test(line) && line.includes("-");

/** 표의 한 줄을 칸으로 나눈다. `\|`는 칸 구분이 아니다 */
function splitCells(line: string): string[] {
  const body = line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "");
  return body.split(/(?<!\\)\|/).map((c) => c.replaceAll("\\|", "|"));
}

/** 칸 글을 정규화한다: 이미지와 링크, 태그, 굵은 글씨 표시를 벗기고 공백을 줄인다 */
function normalizeCell(raw: string): string {
  const text = raw
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, " ")
    .replace(/\*\*|__/g, "");
  return decodeXmlText(text).replace(/\s+/g, " ").trim();
}

const rowText = (line: string) => splitCells(line).map(normalizeCell).join(CELL_JOIN);

interface PathEntry {
  level: number;
  text: string;
  tab: boolean;
}

/** 표 줄 묶음에서 머리행과 본문 행을 가른다 */
function readBlock(block: string[]): { header: string; lines: string[] } {
  if (isSeparator(block[0]!.trim())) return { header: "", lines: block.slice(1) };
  if (block.length > 1 && isSeparator(block[1]!.trim())) return { header: rowText(block[0]!), lines: block.slice(2) };
  return { header: "", lines: block };
}

/**
 * 문서의 표 행을 뽑는다. 들여쓴 표, 머리행 없는 표도 읽고, 코드 울타리 안은 건너뛴다.
 * 숫자가 든 200자 이하 행만 남기고 나머지는 수만 센다. 머리행은 행으로 세지 않는다.
 */
export function parseDocRows(text: string): ParsedDoc {
  const out: ParsedDoc = { rows: [], noNumber: 0, tooLong: 0 };
  const seen = new Set<string>();
  const stack: PathEntry[] = [];
  const lines = text.split(/\r?\n/);
  let fence = false;
  const flush = (block: string[]) => {
    if (block.length === 0) return;
    const { header, lines: body } = readBlock(block);
    const path = stack.map((e) => e.text).join(" > ");
    for (const line of body) {
      if (isSeparator(line.trim())) continue;
      const row = rowText(line);
      if (row.replaceAll("|", "").trim() === "") continue;
      if ([...row].length > ROW_MAX) out.tooLong++;
      else if (!/\d/.test(row)) out.noNumber++;
      else {
        const k = `${path}\n${header}\n${row}`;
        if (!seen.has(k)) out.rows.push({ path, header, row });
        seen.add(k);
      }
    }
  };
  let block: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length > RAW_LINE_MAX) {
      if (line.startsWith("|")) out.tooLong++;
      else {
        flush(block);
        block = [];
      }
      continue;
    }
    if (line.startsWith("```") || line.startsWith("~~~")) {
      fence = !fence;
      flush(block);
      block = [];
      continue;
    }
    if (fence) continue;
    if (line.startsWith("|")) {
      block.push(line);
      continue;
    }
    flush(block);
    block = [];
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop();
      stack.push({ level, text: normalizeCell(heading[2]!), tab: false });
      continue;
    }
    const tab = /<Tab\s[^>]*title\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(line);
    if (tab) {
      while (stack.at(-1)?.tab) stack.pop();
      stack.push({ level: (stack.at(-1)?.level ?? 0) + 0.5, text: normalizeCell(tab[1] ?? tab[2] ?? ""), tab: true });
      continue;
    }
    if (/<\/Tab>/i.test(line)) {
      const at = stack.findLastIndex((e) => e.tab);
      if (at >= 0) stack.length = at;
    }
  }
  flush(block);
  return out;
}

/** 합친 글: 문서 제목 경로, 머리행, 행. 공개 검사와 후보 재료에 쓴다 */
export function mergedRowText(r: DocRow): string {
  return [r.path, r.header, r.row].filter((x) => x !== "").join(" · ");
}

/** 행 식별 해시. 같은 행 글도 제목이 다르면 다르다(B10) */
export function rowHash(doc: string, r: DocRow): string {
  return createHash("sha256").update(`${doc}\n${r.path}\n${r.header}\n${r.row}`).digest("hex").slice(0, 16);
}

export function docHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

// ---- 날짜 읽기(B7, 4.3-2) ----

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const ORD = "(?:st|nd|rd|th)?";
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const MONTH_DAY_YEAR_RE = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORD},?\\s+(\\d{4})\\b`, "gi");
const DAY_MONTH_YEAR_RE = new RegExp(`\\b(\\d{1,2})${ORD}\\s+${MONTH},?\\s+(\\d{4})\\b`, "gi");
const MONTH_YEAR_RE = new RegExp(`\\b${MONTH}\\s+(\\d{4})\\b`, "gi");
const MONTH_DAY_RE = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})${ORD}\\b(?!,?\\s+\\d{4})`, "gi");
const MONTH_VALUE_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const pad = (n: number) => String(n).padStart(2, "0");
const monthNo = (m: string) => MONTH_NAMES.indexOf(m.slice(0, 3).toLowerCase()) + 1;

export interface ReadDate {
  value: string;
  at: number;
}

/**
 * 글에서 날짜를 읽는다: `January 14, 2027`, `Apr 1, 2027`, `2026-10-14`, `July 2026`, 서수 `March 31st, 2026`.
 * U+2011 하이픈은 먼저 바꾸고, 연도 없는 `November 1st`는 발행일 이후 처음 오는 날짜로 푼다(발행일이 없으면 읽지 않는다).
 * 일 단위는 `YYYY-MM-DD`, 달 단위는 `YYYY-MM`이고 글에 나온 순서다.
 */
export function readDates(raw: string, published: string | null = null): ReadDate[] {
  const text = raw.replace(/[\u2010\u2011]/g, "-").replace(/\u00a0/g, " ");
  const out: ReadDate[] = [];
  const put = (value: string, at: number) => {
    if (value.length === 10 ? isValidDate(value) : MONTH_VALUE_RE.test(value)) out.push({ value, at });
  };
  const taken: [number, number][] = [];
  const free = (m: RegExpMatchArray) => !taken.some(([a, b]) => m.index! < b && a < m.index! + m[0].length);
  const scan = (re: RegExp, value: (m: RegExpMatchArray) => string | null) => {
    for (const m of text.matchAll(re)) {
      if (!free(m)) continue;
      const v = value(m);
      if (v === null) continue;
      taken.push([m.index, m.index + m[0].length]);
      put(v, m.index);
    }
  };
  scan(ISO_DATE_RE, (m) => `${m[1]}-${m[2]}-${m[3]}`);
  scan(MONTH_DAY_YEAR_RE, (m) => `${m[3]}-${pad(monthNo(m[1]!))}-${pad(Number(m[2]))}`);
  scan(DAY_MONTH_YEAR_RE, (m) => `${m[3]}-${pad(monthNo(m[2]!))}-${pad(Number(m[1]))}`);
  scan(MONTH_YEAR_RE, (m) => `${m[2]}-${pad(monthNo(m[1]!))}`);
  if (published !== null) {
    const day = published.slice(0, 10);
    scan(MONTH_DAY_RE, (m) => {
      const md = `${pad(monthNo(m[1]!))}-${pad(Number(m[2]))}`;
      const y = Number(day.slice(0, 4));
      return `${y}-${md}` >= day ? `${y}-${md}` : `${y + 1}-${md}`;
    });
  }
  return out.sort((a, b) => a.at - b.at);
}

// ---- 지원 종료 판정(B7) ----

export interface Deprecation {
  models: string[];
  /** 종료일 열의 날짜. 읽지 못하면 null */
  due: string | null;
  tentative: boolean;
}

const DUE_COLUMN_RE = /retire|shut\s?down|sunset|end of (?:life|support)|discontinu/i;
const MODEL_COLUMN_RE = /model|system|api name|^name$|endpoint/i;
const NOT_MODEL_RE = /replacement|recommend|date/i;
const TENTATIVE_COLUMN_RE = /tentative|earliest/i;
const TENTATIVE_CELL_RE = /not sooner than|earliest|no earlier than|on or after|expected/i;

/** 키에 쓰는 모델 이름: 소문자, 구분 글자와 메일 모양이 될 `@`를 바꾼다(B9) */
export function modelKey(name: string): string {
  return name.trim().toLowerCase().replace(/[:\s@]+/g, "-");
}

function modelsOf(cell: string): string[] {
  const ticks = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
  const names = ticks.length > 0 ? ticks : cell.split(/,|\band\b/).map((x) => x.trim());
  return [...new Set(names.map(modelKey).filter((x) => x !== ""))];
}

/** 표 행 하나의 모델·종료일·잠정 여부. 날짜는 B7이 정한 종료일 열로만 읽는다 */
export function deprecationOf(spec: { alwaysTentative?: boolean }, r: DocRow): Deprecation {
  const heads = r.header === "" ? [] : r.header.split(CELL_JOIN);
  const cells = r.row.split(CELL_JOIN);
  const dueAt = heads.findIndex((h) => DUE_COLUMN_RE.test(h));
  const modelAt = heads.findIndex((h, i) => i !== dueAt && MODEL_COLUMN_RE.test(h) && !NOT_MODEL_RE.test(h));
  const modelCell = cells[modelAt >= 0 ? modelAt : dueAt === 0 ? 1 : 0] ?? "";
  const dueCell = dueAt >= 0 ? (cells[dueAt] ?? "") : "";
  const read = readDates(dueCell).map((d) => d.value);
  const due = read.find((d) => d.length === 10) ?? read[0] ?? null;
  const tentative = spec.alwaysTentative === true || (dueAt >= 0 && TENTATIVE_COLUMN_RE.test(heads[dueAt]!)) || TENTATIVE_CELL_RE.test(dueCell) || (due !== null && due.length === 7);
  return { models: modelsOf(modelCell), due, tentative };
}

export function deprecationKey(model: string, due: string, tentative: boolean): string {
  return `deprecation:${model}:${due}:${tentative ? "잠정" : "확정"}`;
}

/** 키의 모델 이름. `deprecation:` 키가 아니면 null */
export function deprecationKeyModel(key: string): string | null {
  return key.startsWith("deprecation:") ? (key.split(":")[1] ?? null) : null;
}

export interface KeyedRow<R extends DocRow> {
  key: string;
  model: string;
  due: string;
  tentative: boolean;
  row: R;
}

/** 행들을 키로 푼다. 같은 모델·날짜에 잠정과 확정이 함께 있으면 확정으로 본다(B7). 날짜가 없는 행은 뺀다 */
export function keyedDeprecations<R extends DocRow>(spec: { alwaysTentative?: boolean }, rows: R[]): KeyedRow<R>[] {
  const infos = rows.map((row) => ({ row, info: deprecationOf(spec, row) }));
  const confirmed = new Set<string>();
  for (const { info } of infos) if (!info.tentative && info.due !== null) for (const m of info.models) confirmed.add(`${m}\n${info.due}`);
  const out: KeyedRow<R>[] = [];
  for (const { row, info } of infos) {
    if (info.due === null) continue;
    for (const model of info.models) {
      const tentative = info.tentative && !confirmed.has(`${model}\n${info.due}`);
      out.push({ key: deprecationKey(model, info.due, tentative), model, due: info.due, tentative, row });
    }
  }
  return out;
}

/** 날짜가 대상 날짜의 다음 날부터 days일 안인지 */
export function withinDays(date: string, target: string, days: number): boolean {
  return date > target && date <= addDays(target, days);
}
