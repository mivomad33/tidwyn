import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { scanText } from "./precheck.ts";
import type { DayVideoItem, DayVideos } from "./siteTypes.ts";
import { storedDates } from "./store.ts";

// B2단계: 사용자의 다른 프로젝트 youtube-insight가 모으고 거른 유튜브 영상 중 분야별 하루 평균 조회수 상위를 브리프 날짜에 싣는다(명세서 4.1, 4.2).
// 원천 DB는 읽기 전용 연결 하나, 읽기 트랜잭션 하나로 짧게 읽고 바로 닫는다(youtube-insight의 쓰기는 잠금을 60초까지만 기다린다).
// 판정 이유와 고르지 않은 영상은 읽지도 저장하지도 않는다. 표 이름에 `video` 앞머리를 쓰지 않는다(R1의 옛 표 이름, 명세서 3.4).

/** 원천 DB 경로를 바꾸는 환경 변수(4.0) */
export const SOURCE_ENV = "TIDWYN_YOUTUBE_DB";
/** 기본 원천 DB 경로: Tidwyn 저장소 폴더 기준 */
export const DEFAULT_SOURCE_REL = "../youtube-insight/data/youtube.sqlite";
/** 업로드 범위: 기준 시각으로부터 이만큼 앞(경계 포함, V9) */
export const UPLOAD_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** 분야마다 싣는 최대 수(V3) */
export const MAX_PER_CATEGORY = 10;
/** 원천 DB 잠금을 기다리는 시간(4.1-1: youtube-insight 쓰기의 60초보다 훨씬 짧게) */
export const SOURCE_BUSY_MS = 3000;
/** 분야 순서(2.2). 그 밖의 분야는 뒤에 이름순 */
export const CATEGORY_ORDER = ["교양/지식", "심리·삶", "육아·교육", "자기계발", "AI/테크", "경제", "사회"] as const;

export type VideoDayStatus = DayVideos["status"];

/** 상태 이름(출력용) */
export const VIDEO_STATUS_LABEL: Record<VideoDayStatus, string> = { shown: "실음", none: "새 영상 없음", failed: "받지 못함" };

export type VideoItem = DayVideoItem;

export interface VideoDay {
  date: string;
  status: VideoDayStatus;
  /** 분야 순서, 분야 안 순위 순 */
  items: VideoItem[];
}

export function sourcePath(repoDir: string, env: NodeJS.ProcessEnv): string {
  const v = env[SOURCE_ENV];
  return v !== undefined && v !== "" ? path.resolve(v) : path.resolve(repoDir, DEFAULT_SOURCE_REL);
}

/** 분야 비교: 정해진 일곱 순서가 앞, 그 밖은 뒤에 이름순 */
export function compareCategory(a: string, b: string): number {
  const ia = (CATEGORY_ORDER as readonly string[]).indexOf(a);
  const ib = (CATEGORY_ORDER as readonly string[]).indexOf(b);
  if (ia !== ib) return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib);
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---- 원천 읽기(4.1-1, 4.1-3) ----

/** Tidwyn이 기대는 원천 DB 모양(2.2, youtube-insight 스키마 v5). 버전 숫자는 보지 않고 쓰는 칸만 본다(V2).
 * 통과 여부는 current_passed로, 분야는 videos.category로 본다(youtube-insight 문서의 바깥 읽기 약속) */
export const SOURCE_COLUMNS: Record<string, readonly string[]> = {
  current_passed: ["video_id"],
  videos: ["video_id", "category", "title", "channel", "duration", "was_live", "upload_at", "upload_precision"],
  snapshots: ["video_id", "collect_date", "view_count", "observed_at"],
};

/** 통과한 영상 하나와 그 분야, 가장 늦은 스냅샷 */
export interface SourceRow {
  videoId: string;
  category: string;
  title: string;
  channel: string;
  duration: number;
  wasLive: boolean;
  uploadAt: string;
  /** 업로드 시각 정밀도(초) */
  uploadPrecision: number;
  views: number;
  observedAt: string;
}

export type SourceRead = { ok: true; rows: SourceRow[] } | { ok: false; reason: string };

/** 업로드 하한을 SQL에서 넉넉히 거르는 여유(정확한 7일 경계는 pickVideos가 잰다. 문자열 비교라 시간대 차이를 덮는다) */
const SQL_UPLOAD_MARGIN_MS = 2 * 86_400_000;

const READ_SQL = `
WITH cand AS (
  SELECT DISTINCT p.video_id FROM current_passed AS p JOIN videos AS v ON v.video_id = p.video_id
  WHERE v.was_live = 0 AND v.upload_at >= :since
),
latest AS (
  SELECT s.video_id, s.view_count, s.observed_at,
         ROW_NUMBER() OVER (PARTITION BY s.video_id ORDER BY s.collect_date DESC, s.observed_at DESC) AS rn
  FROM snapshots AS s JOIN cand AS c ON c.video_id = s.video_id
)
SELECT v.video_id AS videoId, v.category AS category, v.title AS title, v.channel AS channel, v.duration AS duration,
       v.was_live AS wasLive, v.upload_at AS uploadAt, v.upload_precision AS uploadPrecision, l.view_count AS views, l.observed_at AS observedAt
FROM cand AS c
JOIN videos AS v ON v.video_id = c.video_id
JOIN latest AS l ON l.video_id = c.video_id AND l.rn = 1`;

function missingColumns(db: DatabaseSync): string[] {
  const missing: string[] = [];
  for (const [table, cols] of Object.entries(SOURCE_COLUMNS)) {
    const have = new Set((db.prepare(`PRAGMA table_xinfo(${table})`).all() as { name: string }[]).map((r) => r.name));
    if (have.size === 0) missing.push(table);
    else for (const c of cols) if (!have.has(c)) missing.push(`${table}.${c}`);
  }
  return missing;
}

/**
 * 원천 DB를 읽기 전용으로 열어 통과한 영상과 가장 늦은 스냅샷을 읽는다. 연결 하나, 읽기 트랜잭션 하나이고 끝나면 바로 닫는다.
 * 실패는 이유와 함께 돌려준다(예외를 던지지 않는다). 파일이 없으면 열지 않는다(읽기 전용 연결은 새 파일을 만들지 않지만 미리 본다)
 */
export function readSource(file: string, at: Date, busyMs = SOURCE_BUSY_MS): SourceRead {
  if (!fs.existsSync(file)) return { ok: false, reason: `원천 DB가 없다(${file})` };
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: busyMs });
  } catch (e) {
    return { ok: false, reason: `원천 DB를 열 수 없다: ${(e as Error).message}` };
  }
  try {
    db.exec("BEGIN");
    try {
      const missing = missingColumns(db);
      if (missing.length > 0) return { ok: false, reason: `원천 DB 구조가 다르다(없는 것: ${missing.join(", ")})` };
      const since = new Date(at.getTime() - UPLOAD_WINDOW_MS - SQL_UPLOAD_MARGIN_MS).toISOString().slice(0, 10);
      const raw = db.prepare(READ_SQL).all({ since }) as Record<string, unknown>[];
      const rows: SourceRow[] = raw.map((r) => ({
        videoId: String(r.videoId),
        category: String(r.category),
        title: String(r.title),
        channel: String(r.channel),
        duration: Number(r.duration),
        wasLive: Number(r.wasLive) !== 0,
        uploadAt: String(r.uploadAt),
        uploadPrecision: Number(r.uploadPrecision),
        views: Number(r.views),
        observedAt: String(r.observedAt),
      }));
      return { ok: true, rows };
    } finally {
      try {
        db.exec("COMMIT");
      } catch {
        // 트랜잭션을 시작하지 못했으면 끝낼 것도 없다
      }
    }
  } catch (e) {
    return { ok: false, reason: `원천 DB를 읽을 수 없다: ${(e as Error).message}` };
  } finally {
    db.close();
  }
}

// ---- 고르기(4.1-2, V3·V5·V8·V9) ----

/** 하루 평균 조회수: 조회수 ÷ max(1, 관측 − 업로드의 날 수). 날 수는 소수다 */
export function dailyAverage(views: number, uploadAt: string, observedAt: string): number {
  const days = (Date.parse(observedAt) - Date.parse(uploadAt)) / 86_400_000;
  return views / Math.max(1, days);
}

export interface PickOptions {
  /** 기준 시각(V9) */
  at: Date;
  /** 전에 실린 영상 ID(모든 날짜, V3) */
  shown: ReadonlySet<string>;
  home: string | null;
  secrets?: readonly string[];
}

export interface PickResult {
  items: VideoItem[];
  /** 결과물 검사에 걸려 건너뛴 영상 수(제목·채널은 싣지 않는다) */
  skipped: number;
}

/** 통과 영상에서 분야마다 하루 평균 순 최대 10개를 고른다. 두 분야에 든 영상은 순위가 높은 분야 하나에만 둔다(같으면 분야 순서) */
export function pickVideos(rows: readonly SourceRow[], o: PickOptions): PickResult {
  const from = o.at.getTime() - UPLOAD_WINDOW_MS;
  let skipped = 0;
  const badText = new Map<string, boolean>();
  const unsafe = (r: SourceRow) => {
    let bad = badText.get(r.videoId);
    if (bad === undefined) {
      bad = scanText(r.title, o.home, o.secrets ?? []).size > 0 || scanText(r.channel, o.home, o.secrets ?? []).size > 0;
      badText.set(r.videoId, bad);
      if (bad) skipped++;
    }
    return bad;
  };
  const byCategory = new Map<string, { row: SourceRow; avg: number }[]>();
  for (const r of rows) {
    const up = Date.parse(r.uploadAt);
    if (Number.isNaN(up) || up < from) continue;
    if (r.wasLive || o.shown.has(r.videoId)) continue;
    if (!Number.isFinite(r.views) || Number.isNaN(Date.parse(r.observedAt))) continue;
    if (unsafe(r)) continue;
    let list = byCategory.get(r.category);
    if (!list) byCategory.set(r.category, (list = []));
    list.push({ row: r, avg: dailyAverage(r.views, r.uploadAt, r.observedAt) });
  }
  const categories = [...byCategory.keys()].sort(compareCategory);
  /** 영상이 실릴 분야: 분야 안 순위가 가장 높은 곳, 같으면 분야 순서가 앞인 곳(분야를 그 순서로 돌아 먼저 본 것이 남는다) */
  const home = new Map<string, { category: string; rank: number }>();
  for (const c of categories) {
    const list = byCategory.get(c)!;
    list.sort((a, b) => b.avg - a.avg || (a.row.videoId < b.row.videoId ? -1 : a.row.videoId > b.row.videoId ? 1 : 0));
    list.forEach((x, i) => {
      const b = home.get(x.row.videoId);
      if (!b || i < b.rank) home.set(x.row.videoId, { category: c, rank: i });
    });
  }
  const items: VideoItem[] = [];
  for (const c of categories) {
    const kept = byCategory.get(c)!.filter((x) => home.get(x.row.videoId)!.category === c).slice(0, MAX_PER_CATEGORY);
    kept.forEach((x, i) =>
      items.push({ id: x.row.videoId, category: c, rank: i + 1, title: x.row.title, channel: x.row.channel, duration: x.row.duration, views: x.row.views, uploadAt: new Date(x.row.uploadAt).toISOString(), uploadPrecision: x.row.uploadPrecision, dailyViews: Math.round(x.avg) }),
    );
  }
  return { items, skipped };
}

// ---- DB ----

export function videoDayStatus(db: DatabaseSync, date: string): VideoDayStatus | null {
  const row = db.prepare("SELECT status FROM watch_days WHERE date = ?").get(date) as { status: VideoDayStatus } | undefined;
  return row?.status ?? null;
}

/** 이미 실린 영상 ID(모든 날짜, V3) */
export function shownVideoIds(db: DatabaseSync): Set<string> {
  return new Set((db.prepare("SELECT video_id FROM watch_items").all() as { video_id: string }[]).map((r) => r.video_id));
}

/** 항목을 분야 순서, 분야 안 순위 순으로 */
export function sortVideoItems(items: VideoItem[]): VideoItem[] {
  return items.sort((a, b) => compareCategory(a.category, b.category) || a.rank - b.rank);
}

export function allVideoDays(db: DatabaseSync): VideoDay[] {
  const days = (db.prepare("SELECT date, status FROM watch_days ORDER BY date").all() as { date: string; status: VideoDayStatus }[]).map((d): VideoDay => ({ date: d.date, status: d.status, items: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const rows = db.prepare("SELECT date, category, rank, video_id, title, channel, duration, views, upload_at, upload_precision, daily_views FROM watch_items").all() as {
    date: string;
    category: string;
    rank: number;
    video_id: string;
    title: string;
    channel: string;
    duration: number;
    views: number;
    upload_at: string;
    upload_precision: number;
    daily_views: number;
  }[];
  for (const r of rows) byDate.get(r.date)?.items.push({ id: r.video_id, category: r.category, rank: r.rank, title: r.title, channel: r.channel, duration: r.duration, views: r.views, uploadAt: r.upload_at, uploadPrecision: r.upload_precision, dailyViews: r.daily_views });
  for (const d of days) sortVideoItems(d.items);
  return days;
}

function insertVideoItems(db: DatabaseSync, date: string, items: readonly VideoItem[]): void {
  const ins = db.prepare("INSERT INTO watch_items (date, category, rank, video_id, title, channel, duration, views, upload_at, upload_precision, daily_views) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const i of items) ins.run(date, i.category, i.rank, i.id, i.title, i.channel, i.duration, i.views, i.uploadAt, i.uploadPrecision, i.dailyViews);
}

/** 그 날짜의 기록을 한 트랜잭션으로 쓴다. 이미 '실음'이나 '새 영상 없음'이면 쓰지 않고 false */
export function saveVideoDay(db: DatabaseSync, date: string, status: VideoDayStatus, items: readonly VideoItem[]): boolean {
  db.exec("BEGIN");
  try {
    const now = videoDayStatus(db, date);
    if (now === "shown" || now === "none") {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("INSERT INTO watch_days (date, status) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET status = excluded.status").run(date, status);
    insertVideoItems(db, date, items);
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** 대상 날짜(V11): 가장 늦은 저장된 브리프 날짜 */
export function videoTargetDate(db: DatabaseSync): string | null {
  return storedDates(db).at(-1) ?? null;
}

/** 분야별 실은 수(분야 순서) */
export function countByCategory(items: readonly VideoItem[]): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const i of items) m.set(i.category, (m.get(i.category) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => compareCategory(a[0], b[0])).map(([category, count]) => ({ category, count }));
}

// ---- 백업(4.2-1) ----

export interface VideosBackup {
  formatVersion: number;
  /** 날짜 순. 받지 못한 이유는 넣지 않는다 */
  days: VideoDay[];
}

export function hasVideoData(db: DatabaseSync): boolean {
  return db.prepare("SELECT 1 FROM watch_days LIMIT 1").get() !== undefined;
}

export function buildVideosBackup(db: DatabaseSync, formatVersion: number): VideosBackup {
  return { formatVersion, days: allVideoDays(db) };
}

export function restoreVideosBackup(db: DatabaseSync, f: VideosBackup): void {
  const day = db.prepare("INSERT INTO watch_days (date, status) VALUES (?, ?)");
  for (const d of f.days) {
    day.run(d.date, d.status);
    insertVideoItems(db, d.date, d.items);
  }
}
