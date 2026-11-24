// KST(Asia/Seoul)는 서머타임이 없어 항상 UTC+9다. 시스템 시간대와 관계없이 이 오프셋으로 계산한다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 시각의 KST 날짜(YYYY-MM-DD) */
export function kstDate(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 시각을 KST 오프셋이 붙은 ISO 문자열로 */
export function kstIso(now: Date): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 19) + "+09:00";
}

/** 시각을 파일 이름에 쓸 KST 문자열로(YYYYMMDD-HHMMSS) */
export function kstStamp(now: Date): string {
  const iso = new Date(now.getTime() + KST_OFFSET_MS).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;
}

/** 실제로 있는 날짜인지(YYYY-MM-DD) */
export function isValidDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** KST 어제 */
export function kstYesterday(now: Date): string {
  return addDays(kstDate(now), -1);
}

/** from부터 to까지(둘 다 포함) 날짜 목록 */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
