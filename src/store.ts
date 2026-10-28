import type { DatabaseSync } from "node:sqlite";
import type { Brief, Category, Section, ShortNews, Source, StoredBrief, TopStory } from "./brief.ts";
import type { Confidence, Major, SectionName } from "./categories.ts";

// 브리프 저장과 다시 읽기(4.3-2). 날짜 하나의 저장은 트랜잭션 하나다(4.1-5).

const FIRST_DATE_KEY = "first_collection_date";

export function getFirstCollectionDate(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(FIRST_DATE_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

/** 첫 수집일을 기록한다. 이미 있으면 바꾸지 않는다 */
export function recordFirstCollectionDate(db: DatabaseSync, date: string): void {
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)").run(FIRST_DATE_KEY, date);
}

export function storedDates(db: DatabaseSync): string[] {
  return (db.prepare("SELECT target_date FROM briefs ORDER BY target_date").all() as { target_date: string }[]).map((r) => r.target_date);
}

export function hasBrief(db: DatabaseSync, date: string): boolean {
  return db.prepare("SELECT 1 FROM briefs WHERE target_date = ?").get(date) !== undefined;
}

export class AlreadyStoredError extends Error {
  constructor(date: string) {
    super(`${date}은(는) 이미 저장되어 있다`);
  }
}

export interface SaveHooks {
  /** 주요 뉴스·짧은 소식 하나를 넣은 뒤 불린다(중간에 끊기는 경우를 확인하는 데 쓴다) */
  afterStory?: () => void;
}

/** 브리프 하나를 저장한다. 전부 되거나 전혀 안 된다. 같은 대상일이 이미 있으면 AlreadyStoredError */
export function saveBrief(db: DatabaseSync, stored: StoredBrief, hooks: SaveHooks = {}): void {
  const { brief } = stored;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (hasBrief(db, brief.targetDate)) throw new AlreadyStoredError(brief.targetDate);
    db.prepare("INSERT INTO briefs (target_date, headline, keywords, collected_at, late) VALUES (?, ?, ?, ?, ?)").run(
      brief.targetDate,
      brief.headline,
      JSON.stringify(brief.keywords),
      stored.collectedAt,
      stored.late ? 1 : 0,
    );
    const insSection = db.prepare("INSERT INTO sections (target_date, position, name, flow, unverified) VALUES (?, ?, ?, ?, ?)");
    const insStory = db.prepare(`INSERT INTO stories (section_id, kind, position, title, summary, why_it_matters, background, key_facts,
      analogy, outlook, confidence, dev_checkpoint, major, minor, is_new_minor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insSource = db.prepare("INSERT INTO sources (story_id, position, name, url, published_at, image_url, is_primary, published_at_estimated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    const addSources = (storyId: number | bigint, sources: Source[]) => {
      sources.forEach((s, i) => insSource.run(storyId, i, s.name, s.url, s.publishedAt, s.imageUrl ?? null, s.primary === true ? 1 : 0, s.publishedAtEstimated === true ? 1 : 0));
    };
    brief.sections.forEach((sec, si) => {
      const sectionId = insSection.run(brief.targetDate, si, sec.name, sec.flow, sec.unverified ?? null).lastInsertRowid;
      for (const t of sec.topStories) {
        const id = insStory.run(sectionId, "top", t.rank, t.title, t.summary, t.whyItMatters, t.background, JSON.stringify(t.keyFacts),
          t.analogy ?? null, t.outlook, t.confidence, t.devCheckpoint ?? null, t.category.major, t.category.minor, t.category.isNewMinor ? 1 : 0).lastInsertRowid;
        addSources(id, t.sources);
        hooks.afterStory?.();
      }
      sec.shortNews.forEach((n, ni) => {
        const id = insStory.run(sectionId, "short", ni + 1, null, n.summary, null, null, null, null, null, null, null,
          n.category.major, n.category.minor, n.category.isNewMinor ? 1 : 0).lastInsertRowid;
        addSources(id, n.sources);
        hooks.afterStory?.();
      });
    });
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

interface StoryRow {
  id: number;
  kind: "top" | "short";
  position: number;
  title: string | null;
  summary: string;
  why_it_matters: string | null;
  background: string | null;
  key_facts: string | null;
  analogy: string | null;
  outlook: string | null;
  confidence: string | null;
  dev_checkpoint: string | null;
  major: string;
  minor: string;
  is_new_minor: number;
}

interface SourceRow {
  name: string;
  url: string;
  published_at: string;
  image_url: string | null;
  is_primary: number;
  published_at_estimated: number;
}

/** 저장한 브리프를 브리프 데이터로 다시 읽는다. 없으면 null */
export function loadBrief(db: DatabaseSync, date: string): StoredBrief | null {
  const b = db.prepare("SELECT * FROM briefs WHERE target_date = ?").get(date) as
    | { target_date: string; headline: string; keywords: string; collected_at: string; late: number }
    | undefined;
  if (!b) return null;
  const sourcesOf = db.prepare("SELECT * FROM sources WHERE story_id = ? ORDER BY position");
  const readSources = (storyId: number): Source[] =>
    (sourcesOf.all(storyId) as unknown as SourceRow[]).map((r) => {
      const s: Source = { name: r.name, url: r.url, publishedAt: r.published_at };
      if (r.image_url !== null) s.imageUrl = r.image_url;
      if (r.is_primary === 1) s.primary = true;
      if (r.published_at_estimated === 1) s.publishedAtEstimated = true;
      return s;
    });
  const category = (r: StoryRow): Category => {
    const c: Category = { major: r.major as Major, minor: r.minor };
    if (r.is_new_minor === 1) c.isNewMinor = true;
    return c;
  };
  const sectionRows = db.prepare("SELECT * FROM sections WHERE target_date = ? ORDER BY position").all(date) as unknown as {
    id: number;
    name: string;
    flow: string;
    unverified: string | null;
  }[];
  const storiesOf = db.prepare("SELECT * FROM stories WHERE section_id = ? AND kind = ? ORDER BY position");
  const sections: Section[] = sectionRows.map((sr) => {
    const topStories = (storiesOf.all(sr.id, "top") as unknown as StoryRow[]).map((r) => {
      const t: TopStory = {
        rank: r.position,
        title: r.title ?? "",
        summary: r.summary,
        whyItMatters: r.why_it_matters ?? "",
        background: r.background ?? "",
        keyFacts: JSON.parse(r.key_facts ?? "[]") as string[],
        outlook: r.outlook ?? "",
        confidence: r.confidence as Confidence,
        category: category(r),
        sources: readSources(r.id),
      };
      if (r.analogy !== null) t.analogy = r.analogy;
      if (r.dev_checkpoint !== null) t.devCheckpoint = r.dev_checkpoint;
      return t;
    });
    const shortNews = (storiesOf.all(sr.id, "short") as unknown as StoryRow[]).map(
      (r): ShortNews => ({ summary: r.summary, category: category(r), sources: readSources(r.id) }),
    );
    const sec: Section = { name: sr.name as SectionName, flow: sr.flow, topStories, shortNews };
    if (sr.unverified !== null) sec.unverified = sr.unverified;
    return sec;
  });
  const brief: Brief = { targetDate: b.target_date, headline: b.headline, keywords: JSON.parse(b.keywords) as string[], sections };
  return { brief, collectedAt: b.collected_at, late: b.late === 1 };
}
