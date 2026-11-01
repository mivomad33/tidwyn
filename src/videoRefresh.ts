import type { DatabaseSync } from "node:sqlite";
import { parseChapters } from "./chapters.ts";
import { addDays } from "./kst.ts";
import { VIDEO_KEEP_DAYS, type VideoSection } from "./siteTypes.ts";
import type { VideoRefreshState } from "./run.ts";
import { DETAILS_BATCH, LimitReached, YoutubeError, detailsUrl, toRawVideo, type RawVideo, type VideoItem, type YoutubeClient } from "./youtube.ts";

// 9.6단계 4.1: 영상 기록 새로 받기. 받은 지 7일이 된 기록부터 videos.list로 다시 받아 YouTube 데이터와 받은 날만 바꾼다(L2, L7).
// 응답에 없는 영상은 지우되, 응답이 이상한 호출은 적용하지 않는다(L5). 키가 없거나 호출이 실패하면 멈추고 다음 실행이 다시 한다(L4).

/** YouTube 시정 통지가 오면 true로 바꿔 머지한다. 새로 받지 않고 30일 지우기대로 지운다(docs/operations.md "추천 영상", L1) */
export const VIDEO_REFRESH_STOPPED = false;
/** 받은 날이 이 날 수 이상 앞인 기록을 새로 받는다(L2) */
export const REFRESH_AFTER_DAYS = 7;
/** 한 실행의 상한(4.1-1). 넘는 기록은 다음 실행이 한다 */
export const REFRESH_UNITS = 500;
/** 한 호출에서 없는 영상이 이 수 이상이고 물은 영상의 절반을 넘으면 그 호출은 적용하지 않는다(L5) */
export const SUSPECT_MISSING = 5;
/** 받은 날이 이 날 수 이상 앞인 기록이 실행 끝에 남으면 요약에 경고한다(4.2-5) */
export const BACKLOG_DAYS = 23;

/** 새로 받을 영상 ID: 받은 날이 가장 앞선 것부터. 같은 영상이 여러 날짜에 있어도 한 번이다 */
export function dueVideoIds(db: DatabaseSync, today: string): string[] {
  const rows = db.prepare("SELECT video_id FROM videos GROUP BY video_id HAVING MIN(fetched_on) <= ? ORDER BY MIN(fetched_on), video_id").all(addDays(today, -REFRESH_AFTER_DAYS)) as { video_id: string }[];
  return rows.map((r) => r.video_id);
}

export type RefreshReport = Omit<VideoRefreshState, "status" | "targets" | "units" | "rewrite">;

const EMPTY_REPORT: RefreshReport = { changed: 0, removed: 0, suspectCalls: 0, suspectVideos: 0, unreadable: 0, sectionsRemoved: 0, limited: false, keyProblem: false, quota: false, failure: null };

/** 실행 기록에 남기는 결과. 호출하지 않은 경우(대상 없음, 멈춤, 키 없음)에도 쓴다 */
export function refreshState(status: VideoRefreshState["status"], targets: number, r: Partial<RefreshReport> = {}, units = 0): VideoRefreshState {
  return { status, targets, units, ...EMPTY_REPORT, ...r };
}

/** 저장할 수 있는 응답 항목인지. 필드가 없거나 깨졌으면 null */
function readable(item: VideoItem): RawVideo | null {
  const r = toRawVideo(item);
  if (r === null || r.title === "" || r.channel === "" || r.publishedAt === "" || r.thumb === "" || r.seconds === null) return null;
  return r;
}

interface CallResult {
  fresh: RawVideo[];
  missing: string[];
  unreadable: number;
}

/** 응답을 호출 하나의 결과로 읽는다. 모양이 맞지 않으면(items가 배열이 아니거나 ID 없는 항목) 호출 실패다 */
function readCall(body: unknown, ids: string[]): CallResult {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) throw new YoutubeError("other", "응답에 영상 목록이 없다");
  const asked = new Set(ids);
  const answered = new Set<string>();
  const fresh: RawVideo[] = [];
  let unreadable = 0;
  for (const item of items as VideoItem[]) {
    const id = typeof item?.id === "string" ? item.id : "";
    if (id === "") throw new YoutubeError("other", "응답에 ID를 읽을 수 없는 항목이 있다");
    if (!asked.has(id) || answered.has(id)) continue;
    answered.add(id);
    const r = readable(item);
    if (r === null) unreadable++;
    else fresh.push(r);
  }
  return { fresh, missing: [...asked].filter((id) => !answered.has(id)), unreadable };
}

/** 챕터 출처 구간 중 시각이 설명의 챕터에 없는 행(C6). 3.8 Flash로 찾은 시각과 Tidwyn이 쓴 글은 그대로 둔다(L7) */
function staleSections(db: DatabaseSync, v: RawVideo): number[] {
  const rows = db.prepare("SELECT id, video_sections FROM videos WHERE video_id = ? AND video_sections_source = 'chapter'").all(v.videoId) as { id: number; video_sections: string }[];
  if (rows.length === 0) return [];
  const times = new Set(parseChapters(v.description, v.seconds).map((c) => c.start));
  return rows.filter((r) => (JSON.parse(r.video_sections) as VideoSection[]).some((s) => !times.has(s.start))).map((r) => r.id);
}

/** 적용하고 구간을 지운 영상 기록 수를 돌려준다 */
function applyCall(db: DatabaseSync, call: CallResult, today: string): number {
  const put = db.prepare("UPDATE videos SET title = ?, channel = ?, seconds = ?, thumb = ?, published_at = ?, fetched_on = ? WHERE video_id = ?");
  // 이슈 연결은 외래 키로 함께 지워진다
  const drop = db.prepare("DELETE FROM videos WHERE video_id = ?");
  const clear = db.prepare("UPDATE videos SET video_sections = NULL, video_sections_source = NULL WHERE id = ?");
  let cleared = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const v of call.fresh) {
      put.run(v.title, v.channel, v.seconds, v.thumb, v.publishedAt, today, v.videoId);
      for (const id of staleSections(db, v)) {
        clear.run(id);
        cleared++;
      }
    }
    for (const id of call.missing) drop.run(id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return cleared;
}

/**
 * 영상 ID들을 새로 받는다. 호출마다 따로 판정해 적용하고, 실패하거나 상한에 닿으면 남은 호출을 하지 않는다.
 * 던지지 않고 결과에 남긴다(L4). 옛 값이 파일에 남지 않게 부르는 쪽이 VACUUM을 한다(4.1-2).
 */
export async function refreshVideos(db: DatabaseSync, client: YoutubeClient, ids: string[], today: string): Promise<RefreshReport> {
  const report = { ...EMPTY_REPORT };
  db.exec("PRAGMA secure_delete = ON");
  for (let i = 0; i < ids.length; i += DETAILS_BATCH) {
    const batch = ids.slice(i, i + DETAILS_BATCH);
    try {
      const call = readCall(await client.get(detailsUrl(batch), "unit"), batch);
      if (call.missing.length >= SUSPECT_MISSING && call.missing.length * 2 > batch.length) {
        report.suspectCalls++;
        report.suspectVideos += batch.length;
        continue;
      }
      report.sectionsRemoved += applyCall(db, call, today);
      report.changed += call.fresh.length;
      report.removed += call.missing.length;
      report.unreadable += call.unreadable;
    } catch (e) {
      if (e instanceof LimitReached) report.limited = true;
      else {
        report.failure = (e as Error).message;
        report.keyProblem = e instanceof YoutubeError && e.kind === "auth";
        report.quota = e instanceof YoutubeError && e.kind === "quota";
      }
      break;
    }
  }
  return report;
}

export interface RefreshBacklog {
  count: number;
  /** 가장 오래된 기록이 지워지기까지 남은 날 */
  days: number;
}

/** 실행 끝에 받은 날이 BACKLOG_DAYS 이상 앞인 기록(4.2-5). 없으면 null */
export function refreshBacklog(db: DatabaseSync, today: string): RefreshBacklog | null {
  const r = db.prepare("SELECT COUNT(*) AS n, MIN(fetched_on) AS d FROM videos WHERE fetched_on <= ?").get(addDays(today, -BACKLOG_DAYS)) as { n: number; d: string | null };
  if (r.d === null) return null;
  const expires = addDays(r.d, VIDEO_KEEP_DAYS);
  return { count: r.n, days: Math.max(0, Math.round((Date.parse(expires) - Date.parse(today)) / 86_400_000)) };
}
