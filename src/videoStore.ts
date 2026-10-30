import type { DatabaseSync } from "node:sqlite";
import { addDays } from "./kst.ts";
import { VIDEO_BUNDLES, VIDEO_KEEP_DAYS, type VideoBundle } from "./siteTypes.ts";

// 7단계 4.1: 영상 기록, 영상-이슈 연결, 날짜별 영상 고르기 끝남. 영상 기록은 YouTube 데이터라 받은 날부터 30일이 지나면 지운다(V1).

/** 하루 묶음별 최대 개수(V5) */
export const BUNDLE_MAX: Record<VideoBundle, number> = { kr: 5, us: 5, "ai-ko": 3, "ai-en": 3 };
/** 영상마다 관련 이슈 최대 개수(V11) */
export const MAX_VIDEO_ISSUES = 2;

export function isBundle(v: unknown): v is VideoBundle {
  return typeof v === "string" && (VIDEO_BUNDLES as readonly string[]).includes(v);
}

/** 이 날짜 이하로 받은 영상은 지운다(today - 30일) */
export function expiredOnOrBefore(today: string): string {
  return addDays(today, -VIDEO_KEEP_DAYS);
}

export function isExpired(fetchedOn: string, today: string): boolean {
  return fetchedOn <= expiredOnOrBefore(today);
}

/** 7단계 표가 있는 DB인지(옛 버전 DB와 실행 전 사본을 건드리지 않기 위해서다) */
export function hasVideoTables(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'videos'").get() !== undefined;
}

export interface VideoRecord {
  videoId: string;
  bundle: VideoBundle;
  /** 받은 곳 표시(예: `KR 차트 25`, `한국어 검색 경제·금융`) */
  sources: string[];
  briefDate: string;
  fetchedOn: string;
  title: string;
  channel: string;
  seconds: number;
  thumb: string;
  publishedAt: string;
  reason: string;
  /** 묶음 안 순서(1부터) */
  position: number;
  /** 관련 이슈 식별자(고른 순서) */
  issues: number[];
}

interface VideoRow {
  id: number;
  video_id: string;
  bundle: VideoBundle;
  sources: string;
  brief_date: string;
  fetched_on: string;
  title: string;
  channel: string;
  seconds: number;
  thumb: string;
  published_at: string;
  reason: string;
  position: number;
}

const bundleOrder = (b: VideoBundle) => VIDEO_BUNDLES.indexOf(b);

function toRecord(db: DatabaseSync, r: VideoRow): VideoRecord {
  const issues = (db.prepare("SELECT issue_id FROM video_issues WHERE video = ? ORDER BY position").all(r.id) as { issue_id: number }[]).map((x) => x.issue_id);
  return {
    videoId: r.video_id,
    bundle: r.bundle,
    sources: JSON.parse(r.sources) as string[],
    briefDate: r.brief_date,
    fetchedOn: r.fetched_on,
    title: r.title,
    channel: r.channel,
    seconds: r.seconds,
    thumb: r.thumb,
    publishedAt: r.published_at,
    reason: r.reason,
    position: r.position,
    issues,
  };
}

/** 모든 영상 기록: 브리프 날짜 순, 묶음 순(kr → us → ai-ko → ai-en), 묶음 안 순서 */
export function allVideos(db: DatabaseSync): VideoRecord[] {
  if (!hasVideoTables(db)) return [];
  const rows = db.prepare("SELECT * FROM videos ORDER BY brief_date, position").all() as unknown as VideoRow[];
  return rows
    .map((r) => toRecord(db, r))
    .sort((a, b) => a.briefDate.localeCompare(b.briefDate) || bundleOrder(a.bundle) - bundleOrder(b.bundle) || a.position - b.position);
}

export function videosOfDate(db: DatabaseSync, date: string): VideoRecord[] {
  return allVideos(db).filter((v) => v.briefDate === date);
}

/** "이미 추천한 영상" 거르기에 쓰는 영상 ID(DB에 남은 최근 30일 기록) */
export function recentVideoIds(db: DatabaseSync, today: string): Set<string> {
  const rows = db.prepare("SELECT video_id FROM videos WHERE fetched_on > ?").all(expiredOnOrBefore(today)) as { video_id: string }[];
  return new Set(rows.map((r) => r.video_id));
}

export function isPicked(db: DatabaseSync, date: string): boolean {
  return db.prepare("SELECT 1 FROM video_picked WHERE target_date = ?").get(date) !== undefined;
}

/** V9의 대상 날짜: DB의 가장 늦은 브리프 날짜. 브리프가 없으면 null */
export function videoTargetDate(db: DatabaseSync): string | null {
  return (db.prepare("SELECT MAX(target_date) AS d FROM briefs").get() as { d: string | null }).d;
}

export type NewVideo = Omit<VideoRecord, "briefDate" | "fetchedOn">;

/**
 * 고르기를 한 번에 적용한다(4.3-3): 그 날짜의 영상 기록을 고른 것으로 바꾸고 "고르기 끝남"으로 둔다.
 * 같은 것을 두 번 적용해도 영상 기록은 한 번씩이다. 트랜잭션 하나로 돌아 도중에 실패하면 아무것도 바뀌지 않는다.
 */
export function applyVideoPick(db: DatabaseSync, date: string, fetchedOn: string, videos: NewVideo[]): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM videos WHERE brief_date = ?").run(date);
    const put = db.prepare(
      "INSERT INTO videos (video_id, bundle, sources, brief_date, fetched_on, title, channel, seconds, thumb, published_at, reason, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const link = db.prepare("INSERT INTO video_issues (video, issue_id, position) VALUES (?, ?, ?)");
    for (const v of videos) {
      const r = put.run(v.videoId, v.bundle, JSON.stringify(v.sources), date, fetchedOn, v.title, v.channel, v.seconds, v.thumb, v.publishedAt, v.reason, v.position);
      const id = Number(r.lastInsertRowid);
      v.issues.forEach((issue, i) => link.run(id, issue, i + 1));
    }
    db.prepare("INSERT OR IGNORE INTO video_picked (target_date) VALUES (?)").run(date);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 영상 ID가 이 DB 파일에 바이트로 남지 않게 지운다. 지운 영상 기록 수(DB를 열어 둔 채로 부른다) */
export function purgeExpiredRows(db: DatabaseSync, today: string): number {
  if (!hasVideoTables(db)) return 0;
  const limit = expiredOnOrBefore(today);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM videos WHERE fetched_on <= ?").get(limit) as { n: number }).n;
  if (n === 0) return 0;
  // 지운 칸을 0으로 덮고(secure_delete), 다시 써서(VACUUM) 빈 공간에도 남지 않게 한다(4.1-2)
  db.exec("PRAGMA secure_delete = ON");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM video_issues WHERE video IN (SELECT id FROM videos WHERE fetched_on <= ?)").run(limit);
    db.prepare("DELETE FROM videos WHERE fetched_on <= ?").run(limit);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.exec("VACUUM");
  return n;
}

export interface IssueCandidate {
  id: number;
  name: string;
  major: string;
  minor: string;
}

/** 관련 이슈 후보(V11): 대상 날짜까지 14일(대상 날짜 포함) 안에 뉴스가 붙은 흡수되지 않은 이슈. 식별자 순 */
export const ISSUE_WINDOW_DAYS = 14;

export function issueCandidates(db: DatabaseSync, target: string): IssueCandidate[] {
  const from = addDays(target, -(ISSUE_WINDOW_DAYS - 1));
  return (db
    .prepare(
      `SELECT DISTINCT i.id, i.name, i.major, i.minor FROM issues i
       JOIN story_issues si ON si.issue_id = i.id JOIN stories st ON st.id = si.story_id JOIN sections se ON se.id = st.section_id
       WHERE i.merged_into IS NULL AND se.target_date >= ? AND se.target_date <= ? ORDER BY i.id`,
    )
    .all(from, target) as unknown as IssueCandidate[]).map((r) => ({ id: r.id, name: r.name, major: r.major, minor: r.minor }));
}
