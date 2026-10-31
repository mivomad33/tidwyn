import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { MIGRATIONS, migrate, openDb, schemaVersion, type Migration } from "../src/db.ts";
import { validateBrief } from "../src/validate.ts";
import { AlreadyStoredError, loadBrief, saveBrief, storedDates } from "../src/store.ts";
import { cleanupTemp, clone, sampleBrief, tempDir } from "./helpers.ts";
import type { Brief } from "../src/brief.ts";

after(cleanupTemp);

function canonical(b: Brief): Brief {
  const r = validateBrief(b, b.targetDate);
  assert.ok(r.ok, JSON.stringify(!r.ok && r.violations));
  return r.brief;
}

function rowCounts(db: ReturnType<typeof openDb>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ["briefs", "sections", "stories", "sources"]) out[t] = (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
}

describe("4.3-2 저장과 다시 읽기", () => {
  test("저장했다가 다시 읽으면 처음 것과 같다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    const brief = canonical(sampleBrief());
    saveBrief(db, { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    assert.deepEqual(loadBrief(db, "2026-10-27"), { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    db.close();
  });
  test("늦게 수집 표시와 새 소분류 표시도 저장된다(4.2-4)", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    const b = clone(sampleBrief());
    b.sections[0]!.topStories[0]!.category = { major: "경제", minor: "보안" };
    const brief = canonical(b);
    saveBrief(db, { brief, collectedAt: "2026-10-30T09:00:00+09:00", late: true });
    const loaded = loadBrief(db, "2026-10-27");
    assert.equal(loaded?.late, true);
    assert.deepEqual(loaded?.brief.sections[0]!.topStories[0]!.category, { major: "경제", minor: "보안", isNewMinor: true });
    assert.equal(loaded?.brief.sections[0]!.topStories[1]!.category.isNewMinor, undefined);
    db.close();
  });
});

describe("4.1-5 날짜 단위 저장", () => {
  test("저장 도중 오류가 나면 그 날짜의 데이터가 하나도 없고, 다시 저장하면 한 벌만 있다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    const brief = canonical(sampleBrief());
    let n = 0;
    assert.throws(() =>
      saveBrief(db, { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false }, {
        afterStory: () => {
          if (++n === 7) throw new Error("끊김");
        },
      }),
    /끊김/);
    assert.deepEqual(rowCounts(db), { briefs: 0, sections: 0, stories: 0, sources: 0 });
    saveBrief(db, { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    const once = rowCounts(db);
    assert.equal(once.briefs, 1);
    assert.throws(() => saveBrief(db, { brief, collectedAt: "2026-10-28T10:00:00+09:00", late: false }), AlreadyStoredError);
    assert.deepEqual(rowCounts(db), once);
    assert.deepEqual(storedDates(db), ["2026-10-27"]);
    db.close();
  });
});

describe("4.3-3 마이그레이션", () => {
  const v2: Migration = {
    version: 1000,
    up: (db) => db.exec("ALTER TABLE briefs ADD COLUMN note TEXT NOT NULL DEFAULT ''"),
  };
  test("이전 버전 DB에 테스트용 마이그레이션을 적용하면 데이터가 남고 버전이 오른다", () => {
    const file = path.join(tempDir(), "t.db");
    const db1 = openDb(file);
    const brief = canonical(sampleBrief());
    saveBrief(db1, { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    assert.equal(schemaVersion(db1), 8);
    db1.close();

    const db2 = openDb(file, [...MIGRATIONS, v2]);
    assert.equal(schemaVersion(db2), 1000);
    assert.deepEqual(loadBrief(db2, "2026-10-27")?.brief, brief);
    assert.equal((db2.prepare("SELECT note FROM briefs").get() as { note: string }).note, "");
    assert.deepEqual(migrate(db2, [...MIGRATIONS, v2]), [], "이미 최신이면 아무것도 바꾸지 않는다");
    db2.close();
  });
  test("새 DB는 최신 버전으로 만들어지고, 실패한 마이그레이션은 되돌려진다", () => {
    const file = path.join(tempDir(), "t.db");
    const db = openDb(file);
    assert.equal(schemaVersion(db), Math.max(...MIGRATIONS.map((m) => m.version)));
    const bad: Migration = { version: 1000, up: (d) => d.exec("ALTER TABLE briefs ADD COLUMN x TEXT; SELECT * FROM no_such_table;") };
    assert.throws(() => migrate(db, [...MIGRATIONS, bad]));
    assert.equal(schemaVersion(db), 8);
    assert.throws(() => db.prepare("SELECT x FROM briefs").get());
    db.close();
    assert.ok(fs.existsSync(file));
  });
});

describe("1.5단계 4.3-1 발행일 추정 표시 저장", () => {
  test("추정 표시가 있는 브리프를 저장·읽기하면 표시가 남는다", () => {
    const db = openDb(path.join(tempDir(), "t.db"));
    const b = sampleBrief();
    b.sections[0]!.topStories[0]!.sources[1]!.publishedAtEstimated = true;
    const brief = canonical(b);
    saveBrief(db, { brief, collectedAt: "2026-10-28T09:00:00+09:00", late: false });
    const loaded = loadBrief(db, "2026-10-27")!;
    assert.deepEqual(loaded.brief, brief);
    assert.equal(loaded.brief.sections[0]!.topStories[0]!.sources[1]!.publishedAtEstimated, true);
    assert.equal(loaded.brief.sections[0]!.topStories[0]!.sources[0]!.publishedAtEstimated, undefined);
    db.close();
  });
  test("1단계 스키마(버전 1) DB를 새 코드로 열면 마이그레이션되고 기존 브리프를 그대로 읽는다", () => {
    const file = path.join(tempDir(), "t.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version === 1));
    assert.equal(schemaVersion(old), 1);
    const brief = canonical(sampleBrief());
    // 1단계 코드와 같은 열만 넣는다
    const ins = (sql: string, ...args: (string | number | null)[]) => old.prepare(sql).run(...args).lastInsertRowid;
    ins("INSERT INTO briefs (target_date, headline, keywords, collected_at, late) VALUES (?, ?, ?, ?, ?)", brief.targetDate, brief.headline, JSON.stringify(brief.keywords), "2026-10-28T09:00:00+09:00", 0);
    brief.sections.forEach((sec, si) => {
      const sid = ins("INSERT INTO sections (target_date, position, name, flow, unverified) VALUES (?, ?, ?, ?, ?)", brief.targetDate, si, sec.name, sec.flow, sec.unverified ?? null);
      const addSources = (id: number | bigint, list: typeof sec.topStories[0]["sources"]) =>
        list.forEach((s, i) => old.prepare("INSERT INTO sources (story_id, position, name, url, published_at, image_url, is_primary) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, i, s.name, s.url, s.publishedAt, s.imageUrl ?? null, s.primary ? 1 : 0));
      for (const t of sec.topStories) {
        const id = old.prepare(`INSERT INTO stories (section_id, kind, position, title, summary, why_it_matters, background, key_facts, analogy, outlook, confidence, dev_checkpoint, major, minor, is_new_minor)
          VALUES (?, 'top', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(sid, t.rank, t.title, t.summary, t.whyItMatters, t.background, JSON.stringify(t.keyFacts), t.analogy ?? null, t.outlook, t.confidence, t.devCheckpoint ?? null, t.category.major, t.category.minor, t.category.isNewMinor ? 1 : 0).lastInsertRowid;
        addSources(id, t.sources);
      }
      sec.shortNews.forEach((n, ni) => {
        const id = old.prepare(`INSERT INTO stories (section_id, kind, position, summary, major, minor, is_new_minor) VALUES (?, 'short', ?, ?, ?, ?, ?)`).run(sid, ni + 1, n.summary, n.category.major, n.category.minor, n.category.isNewMinor ? 1 : 0).lastInsertRowid;
        addSources(id, n.sources);
      });
    });
    old.close();

    const db = openDb(file);
    assert.equal(schemaVersion(db), 8);
    assert.deepEqual(loadBrief(db, "2026-10-27")?.brief, brief);
    assert.equal((db.prepare("SELECT count(*) AS n FROM sources WHERE published_at_estimated <> 0").get() as { n: number }).n, 0);
    db.close();
  });
});
