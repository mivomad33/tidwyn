// U1 4.4: 방문 기록(history.state)에 담는 화면 이동 정보와 되돌아가기 '‹ 브리프'의 글·도착(S1·S2·S8·S12). DOM 없는 로직이다.
// 들어온 브리프는 history.state에만 둔다(브라우저 탭마다 따로, 새로고침 뒤 남음). 로컬·세션 스토리지에 새 키를 두지 않는다(S8).
//
// history.state 모양: { ...화면이 정한 값(mergedFrom 등), nav: NavMeta, brief?: BriefMark }
// - nav: 기록마다 붙는 식별자, 이 기록을 밀어 넣은 바로 앞 기록(식별자·경로), 들어온 브리프, 떠날 때의 스크롤
// - brief: 브리프 기록만 가진다. 그 브리프의 날짜·탭·그때의 최근 날짜·고른 칩. 브리프 화면이 바뀔 때마다 고쳐 쓴다

import { dateText, yearOf } from "./format.ts";
import { briefPath, briefVideosPath, isValidDate } from "./routes.ts";

/** 들어온 브리프: 떠날 때의 날짜·탭과 그때의 최근 날짜, 그 브리프 기록의 식별자 */
export interface EnteredBrief {
  date: string;
  tab: string;
  latestDate: string;
  entry: string;
}

export interface NavMeta {
  id: string;
  /** 이 기록을 밀어 넣은 기록. pushState는 앞쪽 기록을 지우므로 뒤로 가면 늘 이 기록이다 */
  prev: { id: string; path: string } | null;
  entered: EnteredBrief | null;
  /** 이 기록을 떠날 때의 세로 스크롤 */
  scroll?: number;
}

/** 브리프 기록의 화면 상태(S12). 되돌아가기가 새 기록으로 갈 때는 tab만 담는다 */
export interface BriefMark {
  date?: string;
  tab?: string;
  latestDate?: string;
  /** 영상 묶음 칩(그 날짜의 것) */
  chip?: string | null;
  /** 대분류 칩 */
  major?: string | null;
}

type StateObject = Record<string, unknown>;

function asObject(state: unknown): StateObject {
  return state && typeof state === "object" && !Array.isArray(state) ? (state as StateObject) : {};
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function parseEntered(v: unknown): EnteredBrief | null {
  const o = asObject(v);
  return isStr(o.date) && isValidDate(o.date) && isStr(o.tab) && isStr(o.latestDate) && isStr(o.entry) ? { date: o.date, tab: o.tab, latestDate: o.latestDate, entry: o.entry } : null;
}

/** 기록의 nav. 없거나 깨졌으면 null */
export function navOf(state: unknown): NavMeta | null {
  const o = asObject(asObject(state).nav);
  if (!isStr(o.id)) return null;
  const p = asObject(o.prev);
  const prev = isStr(p.id) && isStr(p.path) ? { id: p.id, path: p.path } : null;
  const nav: NavMeta = { id: o.id, prev, entered: parseEntered(o.entered) };
  if (typeof o.scroll === "number" && Number.isFinite(o.scroll)) nav.scroll = o.scroll;
  return nav;
}

/** 기록의 브리프 상태. 없으면 null */
export function briefMarkOf(state: unknown): BriefMark | null {
  const raw = asObject(state).brief;
  if (!raw || typeof raw !== "object") return null;
  const o = asObject(raw);
  const mark: BriefMark = {};
  if (isStr(o.date) && isValidDate(o.date)) mark.date = o.date;
  if (isStr(o.tab)) mark.tab = o.tab;
  if (isStr(o.latestDate)) mark.latestDate = o.latestDate;
  if (isStr(o.chip) || o.chip === null) mark.chip = o.chip;
  if (isStr(o.major) || o.major === null) mark.major = o.major;
  return mark;
}

/** 지금 기록에서 다른 화면으로 갈 때 이어 갈 들어온 브리프: 브리프 기록이면 그 브리프, 아니면 지금 기록이 이어받은 것 */
export function enteredFrom(state: unknown): EnteredBrief | null {
  const nav = navOf(state);
  const mark = briefMarkOf(state);
  if (nav && mark?.date && mark.tab && mark.latestDate) return { date: mark.date, tab: mark.tab, latestDate: mark.latestDate, entry: nav.id };
  return nav?.entered ?? null;
}

/** nav가 없는 기록(첫 방문, 주소창에서 바꾼 `#`)에 붙일 state. from은 그 직전에 보던 기록의 state와 경로다(모르면 null) */
export function adoptState(state: unknown, id: string, from: { state: unknown; path: string } | null): StateObject {
  return pushStateOf(from?.state, from?.path ?? "", id, state);
}

/** 새 기록의 state. 화면이 정한 값에 새 nav를 붙인다(화면 값의 nav는 쓰지 않는다) */
export function pushStateOf(current: unknown, currentPath: string, id: string, extra: unknown): StateObject {
  const cur = navOf(current);
  const nav: NavMeta = { id, prev: cur ? { id: cur.id, path: currentPath } : null, entered: enteredFrom(current) };
  return { ...asObject(extra), nav };
}

/** 같은 기록을 바꿀 때의 state. nav는 그대로 두고, 같은 경로면 브리프 상태도 그대로 둔다(카드 펼침 등) */
export function replaceStateOf(current: unknown, samePath: boolean, extra: unknown): StateObject {
  const cur = asObject(current);
  const next: StateObject = { ...asObject(extra) };
  if (cur.nav) next.nav = cur.nav;
  if (samePath && cur.brief) next.brief = cur.brief;
  return next;
}

/** 브리프 기록에 남기는 날짜·탭·칩만 바꾼 state(S8·S12) */
export function withBriefMark(current: unknown, mark: BriefMark): StateObject {
  return { ...asObject(current), brief: mark };
}

/** 스크롤만 바꾼 state */
export function withScroll(current: unknown, scroll: number): StateObject {
  const cur = asObject(current);
  const nav = navOf(current);
  return nav ? { ...cur, nav: { ...asObject(cur.nav), scroll } } : cur;
}

// ---- 되돌아가기 '‹ 브리프'(4.4-1·3) ----

/** 되돌아가기 글('‹ ' 뒤). 도착 날짜가 최근 날짜가 아니면 'M월 D일 브리프'(해가 다르면 'YYYY년 M월 D일 브리프'), 최근 날짜거나 모르면 '브리프' */
export function briefBackLabel(date: string | null, latestDate: string | null): string {
  if (!date || date === latestDate) return "브리프";
  return `${dateText(date, latestDate ? yearOf(latestDate) : undefined)} 브리프`;
}

export interface BriefBackInput {
  /** 지금 기록의 state */
  state: unknown;
  /** 들어온 브리프를 모를 때 갈 날짜(영상 페이지: 그 영상 날짜의 영상 탭). latestDate는 최근 날짜(아직 모르면 null) */
  fallback?: { date: string; latestDate: string | null };
}

export interface BriefBack {
  /** '‹ ' 뒤의 글 */
  label: string;
  /** 도착 주소(링크의 href. back이면 되돌릴 기록의 주소와 같은 화면) */
  to: string;
  /** true면 기록을 되돌린다(history.back). 바로 앞 기록이 들어온 그 브리프일 때다 */
  back: boolean;
  /** 새 기록으로 갈 때 열 탭(없으면 기억한 탭·주소의 `#`를 따른다) */
  tab: string | null;
}

/** '‹ 브리프'의 글과 도착(S1·S2). 바로 앞 기록이 들어온 브리프면 되돌리고, 아니면 들어온 날짜·탭, 모르면 fallback, 그것도 없으면 최근 브리프다 */
export function resolveBriefBack({ state, fallback }: BriefBackInput): BriefBack {
  const nav = navOf(state);
  const entered = nav?.entered ?? null;
  if (entered) {
    const latest = entered.date === entered.latestDate;
    return { label: briefBackLabel(entered.date, entered.latestDate), to: latest ? "/" : briefPath(entered.date), back: nav?.prev?.id === entered.entry, tab: entered.tab };
  }
  if (fallback) return { label: briefBackLabel(fallback.date, fallback.latestDate), to: briefVideosPath(fallback.date), back: false, tab: null };
  return { label: "브리프", to: "/", back: false, tab: null };
}

/** 바로 앞 화면의 경로(이슈 페이지가 브리프에서 왔는지 본다, 4.4-2). 모르면 null */
export function prevPathOf(state: unknown): string | null {
  return navOf(state)?.prev?.path ?? null;
}
