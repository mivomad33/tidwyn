import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_SOURCE_REL, SOURCE_ENV } from "../src/weeklyVideos.ts";
import { PROJECT_ROOT } from "./helpers.ts";

// B2 테스트용 지어낸 원천 DB(youtube-insight 모양). 표·보기·트리거는 youtube-insight `src/ytinsight/db.py`의 v5(2026-11-26, 영상 하나에 분야 하나)가
// 만든 최종 모양을 따르고(분야 CHECK 제약과 Tidwyn이 읽지 않는 표는 뺐다) 값은 모두 지어낸 것이다.
// 자동 테스트는 늘 이 파일을 가리키고 실제 원천 DB(기본 경로)를 가리키면 실패한다(명세서 4.1-5).

/** 영상의 분야를 주지 않을 때 쓰는 분야 */
export const DEFAULT_CATEGORY = "교양/지식";

const SCHEMA = `
CREATE TABLE videos (
  video_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  channel TEXT NOT NULL,
  channel_id TEXT,
  duration INTEGER NOT NULL,
  description TEXT,
  thumbnail TEXT,
  was_live INTEGER NOT NULL,
  upload_at TEXT NOT NULL,
  upload_precision INTEGER NOT NULL,
  upload_text TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  category TEXT NOT NULL
);
CREATE INDEX videos_category ON videos(category);
CREATE TABLE snapshots (
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  collect_date TEXT NOT NULL,
  view_count INTEGER NOT NULL,
  view_text TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (video_id, collect_date)
);
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  collect_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ytdlp_version TEXT NOT NULL,
  result TEXT,
  full_scope INTEGER NOT NULL,
  scope TEXT NOT NULL
);
CREATE TABLE judgments (
  id INTEGER PRIMARY KEY,
  video_id TEXT NOT NULL REFERENCES videos(video_id),
  category TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reason TEXT NOT NULL,
  criteria_version INTEGER NOT NULL,
  model TEXT NOT NULL,
  judged_at TEXT NOT NULL,
  rejudge INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'judged',
  move_to TEXT,
  origin_id INTEGER REFERENCES judgments(id),
  origin_category TEXT,
  current INTEGER NOT NULL DEFAULT 0 CHECK (current IN (0, 1))
);
CREATE INDEX judgments_pair ON judgments(video_id, category, id);
CREATE UNIQUE INDEX judgments_current ON judgments(video_id) WHERE current = 1;
CREATE VIEW current_judgments AS SELECT * FROM judgments WHERE current = 1;
CREATE VIEW current_passed AS
  SELECT video_id, category, reason, judged_at FROM judgments WHERE current = 1 AND passed = 1;
CREATE TRIGGER judgments_current_insert BEFORE INSERT ON judgments
  WHEN NEW.current = 1 AND NEW.category IS NOT (SELECT category FROM videos WHERE video_id = NEW.video_id)
  BEGIN SELECT RAISE(ABORT, 'current judgment category differs from the video category'); END;
CREATE TRIGGER judgments_current_update BEFORE UPDATE OF current, category, video_id ON judgments
  WHEN NEW.current = 1 AND NEW.category IS NOT (SELECT category FROM videos WHERE video_id = NEW.video_id)
  BEGIN SELECT RAISE(ABORT, 'current judgment category differs from the video category'); END;
CREATE TRIGGER videos_category_update BEFORE UPDATE OF category, video_id ON videos
  WHEN EXISTS (SELECT 1 FROM judgments WHERE video_id = OLD.video_id AND current = 1
               AND (category IS NOT NEW.category OR video_id IS NOT NEW.video_id))
  BEGIN SELECT RAISE(ABORT, 'the video has a current judgment of another category'); END;
PRAGMA user_version = 5;
`;

export interface FakeVideo {
  id: string;
  title?: string;
  channel?: string;
  duration?: number;
  live?: boolean;
  /** ISO UTC */
  uploadAt: string;
  /** 영상의 분야(기본 DEFAULT_CATEGORY) */
  category?: string;
}

/** 지어낸 판정 이유(백업·사이트에 새지 않는지 보는 표시) */
export const FAKE_REASON = "ZZfakeJudgeReason-분야와 맞음-7731";

export class FakeSource {
  readonly db: DatabaseSync;
  readonly file: string;
  private nextRun = 1;
  constructor(file: string, opts: { drop?: string; extraColumn?: boolean } = {}) {
    this.file = file;
    this.db = new DatabaseSync(file);
    let sql = SCHEMA;
    if (opts.drop) sql = sql.replace(new RegExp(`\\n\\s*${opts.drop} [^\\n]*,`), "");
    this.db.exec(sql);
    if (opts.extraColumn) this.db.exec("ALTER TABLE videos ADD COLUMN made_up_extra TEXT");
  }

  video(v: FakeVideo): this {
    this.db
      .prepare("INSERT INTO videos (video_id, title, channel, channel_id, duration, description, thumbnail, was_live, upload_at, upload_precision, upload_text, first_seen, last_seen, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(v.id, v.title ?? `지어낸 영상 ${v.id}`, v.channel ?? `지어낸 채널 ${v.id}`, null, v.duration ?? 754, "지어낸 설명", `https://img.example.com/${v.id}.jpg?sig=fake`, v.live ? 1 : 0, v.uploadAt, 86400, "1일 전", "2026-10-27", "2026-10-27", v.category ?? DEFAULT_CATEGORY);
    return this;
  }

  snap(id: string, collectDate: string, views: number, observedAt: string): this {
    this.db.prepare("INSERT INTO snapshots (video_id, collect_date, view_count, view_text, observed_at) VALUES (?, ?, ?, ?, ?)").run(id, collectDate, views, `조회수 ${views}회`, observedAt);
    return this;
  }

  /** 영상의 분야로 판정 하나를 더하고 그것을 지금 판정으로 삼는다(v5: 영상마다 지금 판정은 하나) */
  judge(id: string, passed: boolean, kind: "judged" | "added" | "cancelled" = "judged"): this {
    this.db.prepare("UPDATE judgments SET current = 0 WHERE video_id = ? AND current = 1").run(id);
    this.db
      .prepare("INSERT INTO judgments (video_id, category, passed, reason, criteria_version, model, judged_at, kind, current) SELECT video_id, category, ?, ?, ?, ?, ?, ?, 1 FROM videos WHERE video_id = ?")
      .run(passed ? 1 : 0, FAKE_REASON, 2, "fake-model", "2026-10-27T20:00:00+00:00", kind, id);
    return this;
  }

  run(collectDate: string, result = "completed"): this {
    this.db.prepare("INSERT INTO runs (id, collect_date, started_at, ended_at, ytdlp_version, result, full_scope, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(this.nextRun++, collectDate, `${collectDate}T12:00:00+00:00`, `${collectDate}T18:00:00+00:00`, "0.0.0", result, 1, "{}");
    return this;
  }

  /** 영상 하나를 만들고 스냅샷 하나와 통과 판정을 단다 */
  passed(v: FakeVideo & { views: number; observedAt: string }): this {
    return this.video(v).snap(v.id, "2026-10-27", v.views, v.observedAt).judge(v.id, true);
  }

  close(): void {
    this.db.close();
  }
}

/** 영상 명령을 부를 때의 환경 변수. 지어낸 원천 DB만 받는다(실제 원천 DB 기본 경로를 주면 실패한다, 4.1-5) */
export function sourceEnv(file: string, env: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const real = path.resolve(PROJECT_ROOT, DEFAULT_SOURCE_REL);
  assert.notEqual(path.resolve(file).toLowerCase(), real.toLowerCase(), "자동 테스트는 실제 원천 DB를 가리키면 안 된다");
  return { ...env, [SOURCE_ENV]: file };
}
