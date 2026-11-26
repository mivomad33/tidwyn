// B2 영상 탭의 지어낸 영상 기록(지어낸 데이터 전용). 영상 ID·제목·채널은 모두 지어낸 것이고 실제 영상이 아니다.
// 난수를 쓰지 않아 다른 지어낸 값이 그대로다.
import { CATEGORY_ORDER } from "../../src/weeklyVideos.ts";
import { videoPartOf, videoRecordContent, videoRecordUrl, siteFiles, type DayVideoItem, type DayVideos, type VideoPartFile, type SearchRecord } from "../../src/siteTypes.ts";

export interface VideoFixtureInfo {
  /** 실음(빌더도 있는 날) */
  shown: string | null;
  /** 새 영상 없음(빌더도 있는 날) */
  none: string | null;
  /** 받지 못함(빌더도 있는 날) */
  failed: string | null;
  /** 영상만 있는 날(실음, 빌더 기록 없음) */
  only: string | null;
  /** 영상·빌더 기록이 모두 없는 날 */
  absent: string | null;
  /** 지어낸 받지 못한 이유. 사이트 데이터에는 이유를 싣지 않으므로 결과물 어디에도 없어야 한다 */
  reason: string;
}

export const FIXTURE_VIDEO_REASON = "ZZfakeVideoFailReason-원천없음-5521";

/** 지어낸 ID(11자, 유튜브 영상 ID 모양) */
function fakeId(n: number): string {
  return `fakeVid${String(n).padStart(4, "0")}`;
}

/** 정확히 n자인 지어낸 제목 */
function longTitle(seed: string, n: number): string {
  let t = seed;
  while (Array.from(t).length < n) t += " 아주 긴 제목이 좁은 화면에서 줄을 바꾸는지 보려고 지어낸 영상 제목입니다";
  return Array.from(t).slice(0, n).join("");
}

/** 실음 날의 영상: 분야 셋, 분야 안 순위 순. 조회수(그대로·만·억)와 길이(분:초·시:분:초), 100자 제목, 긴 채널 이름을 담는다 */
function shownItems(start: number): DayVideoItem[] {
  const rows: [string, string, string, number, number][] = [
    [CATEGORY_ORDER[0], "가짜과학교실 물이 끓는 온도의 비밀", "가짜지식채널", 234_567_890, 754],
    [CATEGORY_ORDER[0], longTitle("가짜역사강의 옛 지도에 남은 길의 흔적", 100), "가짜역사연구소", 1_234_567, 3725],
    [CATEGORY_ORDER[0], "가짜우주이야기 별빛이 늦게 오는 까닭", "가짜천문대", 45_678, 612],
    [CATEGORY_ORDER[1], "가짜마음연습 하루 십 분 걷기의 힘", "아주긴이름을가진가짜심리상담채널입니다정말로긴채널이름이에요", 98_765, 905],
    [CATEGORY_ORDER[1], "가짜수면공부 잠이 모자라면 생기는 일", "가짜잠연구", 5_432, 1830],
    [CATEGORY_ORDER[5], "가짜경제노트 금리가 오르면 바뀌는 것들", "가짜경제학교", 3_456_789, 1499],
    [CATEGORY_ORDER[5], "가짜시장읽기 물가 지표 쉽게 보기", "가짜숫자방", 12_000, 4210],
  ];
  return rows.map(([category, title, channel, views, duration], i) => ({
    uploadAt: `2026-10-${String(26 - (i % 6)).padStart(2, "0")}T03:00:00.000Z`,
    uploadPrecision: 86400,
    id: fakeId(start + i),
    category,
    // 분야 안 순위(1부터)
    rank: rows.slice(0, i).filter((r) => r[0] === category).length + 1,
    title,
    channel,
    duration,
    views,
    // 분야 안 순위와 맞게 조회수가 많을수록 크다. '모든 분야'에서는 분야가 섞인다
    dailyViews: Math.round(views / 2),
  }));
}

/** 크기 측정용 지어낸 글: 정해진 씨앗으로 고른 한글 음절과 띄어쓰기(되풀이가 적어 실제 제목처럼 덜 압축된다) */
function syllables(seed: number, n: number): string {
  let x = seed * 2654435761 % 4294967296 || 1;
  let out = "";
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    out += i > 0 && x % 5 === 0 ? " " : String.fromCodePoint(0xac00 + (x % 11172));
  }
  return out;
}

/** 크기 측정용: 모든 분야 10개씩(하루 70개), 제목 100자, 채널 이름 12자 */
function worstItems(dayIndex: number): DayVideoItem[] {
  return CATEGORY_ORDER.flatMap((category, ci) =>
    Array.from({ length: 10 }, (_, r) => ({
      id: `w${String(dayIndex).padStart(5, "0")}${ci}${String(r).padStart(4, "0")}`.slice(0, 11),
      category,
      rank: r + 1,
      title: syllables(dayIndex * 100 + ci * 10 + r + 1, 100),
      channel: syllables(ci * 10 + r + 7, 12),
      duration: 600 + r * 37,
      views: 1_000_000 - r * 1000,
      uploadAt: "2026-10-26T03:00:00.000Z",
      uploadPrecision: 86400,
      dailyViews: 500_000 - r * 500,
    })),
  );
}

/**
 * 날짜별 영상 기록과 반달 영상 파일·검색 레코드. true면 최근 날짜부터 실음·새 영상 없음·받지 못함·영상만(실음)을 두고 그 앞 날짜는 기록이 없다.
 * "worst"는 모든 날짜에 하루 70개·제목 100자(크기 측정용).
 */
export function fixtureVideos(datesDesc: string[], mode: true | "worst"): { byDate: Map<string, DayVideos>; files: Map<string, string>; records: SearchRecord[]; info: VideoFixtureInfo } {
  const byDate = new Map<string, DayVideos>();
  let info: VideoFixtureInfo;
  if (mode === "worst") {
    for (const [i, date] of datesDesc.entries()) byDate.set(date, { status: "shown", items: worstItems(i) });
    info = { shown: datesDesc[0] ?? null, none: null, failed: null, only: null, absent: null, reason: FIXTURE_VIDEO_REASON };
  } else {
    const [shown, none, failed, only, absent] = datesDesc;
    if (shown) byDate.set(shown, { status: "shown", items: shownItems(1) });
    if (none) byDate.set(none, { status: "none", items: [] });
    if (failed) byDate.set(failed, { status: "failed", items: [] });
    // 영상만 있는 날은 제목·채널이 실음 날과 겹치지 않게 다른 지어낸 글을 쓴다(검색 결과가 날짜 하나로 정해지게)
    if (only) byDate.set(only, { status: "shown", items: shownItems(101).slice(0, 2).map((v, i) => ({ ...v, title: `가짜요리노트 ${i + 1}편 국물 맛을 내는 순서`, channel: "가짜부엌" })) });
    info = { shown: shown ?? null, none: none ?? null, failed: failed ?? null, only: only ?? null, absent: absent ?? null, reason: FIXTURE_VIDEO_REASON };
  }
  const parts = new Map<string, VideoPartFile>();
  const records: SearchRecord[] = [];
  for (const [date, v] of [...byDate].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const part = videoPartOf(date);
    let m = parts.get(part);
    if (!m) parts.set(part, (m = { part, days: {} }));
    m.days[date] = v;
    if (v.status === "shown") records.push({ url: videoRecordUrl(date), content: videoRecordContent(v.items), language: "ko", meta: { kind: "videos", date } });
  }
  const files = new Map([...parts].map(([part, m]) => [siteFiles.watch(part), JSON.stringify(m)]));
  return { byDate, files, records, info };
}
