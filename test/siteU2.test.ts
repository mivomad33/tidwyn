// U2단계(브리프 위계와 누를 곳) 단위 확인
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures } from "../site/dev/fixtures.ts";
import { sourceLink } from "../site/src/lib/schedules.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

after(cleanupTemp);

describe("4.5 일정 화면의 출처 링크", () => {
  test("근거 뉴스가 있으면 '출처 뉴스', 없고 빌더 항목이면 '빌더 항목', 둘 다 없으면 없다", () => {
    const news = { date: "2026-10-01", key: "한국-top-1" };
    const item = { date: "2026-10-27", key: "builder-1" };
    assert.deepEqual(sourceLink({ first: news, builder: item }), { text: "출처 뉴스", to: `/2026-10-01#${encodeURIComponent(news.key)}` });
    assert.deepEqual(sourceLink({ first: null, builder: item }), { text: "빌더 항목", to: "/2026-10-27#builder-1" });
    assert.equal(sourceLink({ first: null }), null);
  });

  describe("정적 HTML 일정 목록", () => {
    let html: string;
    before(async () => {
      const work = tempDir("tidwyn-u2-");
      const dataDir = path.join(work, "data");
      const out = path.join(work, "out");
      writeFixtures(dataDir, { days: 12, schedules: 24, builder: true });
      await buildSite({ dataDir, outDir: out });
      const file = listFilesRecursive(out).find((f) => /^schedules(\/index)?\.html$/.test(f));
      assert.ok(file, "정적 일정 목록이 있다");
      html = fs.readFileSync(path.join(out, file), "utf8");
    });

    test("일정 이름은 링크가 아니고, 줄마다 출처 링크가 따로 있다", () => {
      const rows = [...html.matchAll(/<li class="ev">([\s\S]*?)<\/li>/g)].map((m) => m[1]!);
      assert.ok(rows.length > 5, "일정 줄을 본다");
      for (const r of rows) {
        assert.match(r, /<span class="t">[^<]+<\/span>/, r);
        assert.doesNotMatch(r, /<a [^>]*class="t"/, r);
      }
      const links = rows.flatMap((r) => [...r.matchAll(/<a href="(\/[^"]*#[^"]+)" class="text-link">(출처 뉴스|빌더 항목)<span class="mark" aria-hidden="true"> ›<\/span><\/a>/g)].map((m) => ({ to: m[1]!, text: m[2]! })));
      assert.ok(links.some((l) => l.text === "출처 뉴스"), "출처 뉴스 링크가 있다");
      for (const l of links) if (l.text === "빌더 항목") assert.match(l.to, /#builder-\d+$/);
    });
  });
});
