// 9.7단계 C5: 영상 설명에서 제작자 챕터를 읽는다. YouTube의 챕터 규칙과 같게 본다.
// 맞지 않는 시각 목록(곡 목록, 참고 링크)을 챕터로 잘못 읽지 않게, 시각이 있는 줄을 모두 모아 전체가 조건을 채울 때만 챕터로 본다.

export interface Chapter {
  /** 시작 시각(초) */
  start: number;
  title: string;
}

/** 챕터로 인정하는 최소 수와 최소 간격(C5) */
export const CHAPTER_MIN = 3;
export const CHAPTER_GAP_SECONDS = 10;

const CLOCK = String.raw`(?:\d{1,2}:)?\d{1,2}:\d{2}(?!\d)`;
const FRONT_RE = new RegExp(String.raw`^[\s\-–—•·*|>\[(]*(${CLOCK})[\])]?[\s\-–—:|.)\]]*(.*)$`);
const BACK_RE = new RegExp(String.raw`^(.*?)[\s\-–—:|\[(]+(${CLOCK})[\])]?\s*$`);
const EDGE_RE = /^[\s\-–—•·*|:]+|[\s\-–—•·*|:]+$/g;

/** `분:초`나 `시:분:초`를 초로. 분·초가 60을 넘으면 null */
export function clockSeconds(text: string): number | null {
  const parts = text.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const [sec, min] = [parts.at(-1)!, parts.at(-2)!];
  if (sec >= 60 || (parts.length === 3 && min >= 60)) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}

function readLine(line: string): Chapter | null {
  const front = FRONT_RE.exec(line);
  const back = front ? null : BACK_RE.exec(line);
  const clock = front?.[1] ?? back?.[2];
  const title = (front?.[2] ?? back?.[1] ?? "").replace(EDGE_RE, "");
  if (clock === undefined || title === "") return null;
  const start = clockSeconds(clock);
  return start === null ? null : { start, title };
}

/** 설명 전체에서 챕터를 읽는다. 조건(C5)을 채우지 못하면 빈 목록이다 */
export function parseChapters(description: string, seconds: number | null): Chapter[] {
  if (seconds === null) return [];
  const list = description.split(/\r?\n/).flatMap((line) => readLine(line) ?? []);
  if (list.length < CHAPTER_MIN || list[0]!.start !== 0) return [];
  const ok = list.every((c, i) => c.start < seconds && (i === 0 || c.start - list[i - 1]!.start >= CHAPTER_GAP_SECONDS));
  return ok ? list : [];
}
