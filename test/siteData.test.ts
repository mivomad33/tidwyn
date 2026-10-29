import assert from "node:assert/strict";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import type { Brief } from "../src/brief.ts";
import { openDb } from "../src/db.ts";
import { briefIssues } from "../src/issueMarkdown.ts";
import { addRelation, createIssue, linkStory, storiesOfDate } from "../src/issues.ts";
import { renderMarkdown } from "../src/markdown.ts";
import { applyMerges, unmerge } from "../src/merge.ts";
import { buildSearchRecords, buildSiteData, continuesLabel } from "../src/siteData.ts";
import type { IssueChunk, MonthDetail, MonthList, SiteDates, SiteIssueList } from "../src/siteTypes.ts";
import { loadBrief, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { cleanupTemp, sampleBrief, tempDir } from "./helpers.ts";

after(cleanupTemp);

// 지어낸 DB(3단계 4.1-1): 날짜 4개(10월 1·2·4일, 11월 1일), 이슈 여럿, 합쳐진 이슈(사슬 포함), 이미지 주소가 있는 출처 1개.
const DATES = ["2026-10-01", "2026-10-02", "2026-10-04", "2026-11-01"];
const IMAGE = "https://img.example.com/fake-photo.jpg";

/** 이미지 주소는 10월 2일 한국-1 대표 출처 하나에만 둔다. 10월 2일 한국-2는 대표 출처가 두 번째이고 발행일 추정 출처가 있다 */
function brief(date: string): Brief {
  const b = sampleBrief(date);
  for (const sec of b.sections) for (const x of [...sec.topStories, ...sec.shortNews]) for (const s of x.sources) delete s.imageUrl;
  b.headline = `${date}의 흐름을 한 문장으로 정리했다.`;
  if (date === "2026-10-02") {
    const kr = b.sections[0]!;
    kr.topStories[0]!.sources[0]!.imageUrl = IMAGE;
    const second = kr.topStories[1]!;
    second.sources = [
      { name: "예시일보", url: `https://daily.example.org/${date}/second`, publishedAt: date, publishedAtEstimated: true },
      { name: "가짜통신", url: `https://news.example.com/${date}/second`, publishedAt: date, primary: true },
    ];
    kr.topStories[2]!.keyFacts = ["반도체가 수출을 끌어올렸다", "주체: 가짜 기관", `날짜: ${date}`];
  }
  return b;
}

function story(db: DatabaseSync, date: string, key: string) {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date}/${key}`);
  return s;
}

const cat = { major: "경제", minor: "금융·증시" } as const;

function exampleDb() {
  const db = openDb(path.join(tempDir(), "t.db"));
  for (const d of DATES) {
    const r = validateBrief(brief(d), d);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
  }
  const a = createIssue(db, { name: "가짜 금리 갈등", aliases: ["Fake Rate Dispute"], category: cat, summary: "가짜 기관 사이의 금리 갈등이다." });
  const b = createIssue(db, { name: "가짜 무역 협상", aliases: [], category: { major: "국제", minor: "미국" }, summary: "가짜 나라 사이 무역 협상이다.", status: "종료" });
  const e = createIssue(db, { name: "가짜 항만 파업", aliases: ["항만 멈춤"], category: { major: "국제", minor: "미국" }, summary: "가짜 항만의 파업이다." });
  const c = createIssue(db, { name: "가짜 물류 대란", aliases: [], category: { major: "국제", minor: "미국" }, summary: "가짜 물류가 막혔다." });
  const d = createIssue(db, { name: "가짜 공급망 위기", aliases: [], category: { major: "국제", minor: "미국" }, summary: "가짜 공급망이 흔들린다." });
  const f = createIssue(db, { name: "가짜 학교 개편", aliases: [], category: { major: "사회", minor: "교육" }, summary: "가짜 학교 제도 개편이다." });
  // 묶음 1(식별자 100 이상)에 이슈 하나
  db.prepare("UPDATE sqlite_sequence SET seq = 149 WHERE name = 'issues'").run();
  const g = createIssue(db, { name: "가짜 우주 발사", aliases: ["Fake Launch"], category: { major: "과학·건강", minor: "우주" }, summary: "가짜 로켓 발사 계획이다." });
  assert.equal(g, 150);

  for (const date of DATES) linkStory(db, story(db, date, "한국-1").id, a, true);
  linkStory(db, story(db, "2026-10-04", "한국-1").id, b, false);
  linkStory(db, story(db, "2026-10-01", "세계-1").id, b, true);
  linkStory(db, story(db, "2026-10-04", "세계-1").id, b, true);
  linkStory(db, story(db, "2026-10-01", "세계-2").id, e, true);
  linkStory(db, story(db, "2026-10-02", "세계-2").id, c, true);
  linkStory(db, story(db, "2026-10-04", "세계-2").id, d, true);
  linkStory(db, story(db, "2026-10-01", "한국-s1").id, f, true);
  linkStory(db, story(db, "2026-11-01", "IT·AI-1").id, g, true);
  addRelation(db, a, c);
  addRelation(db, f, g);
  // 사슬: e → c(10월 3일), c → d(10월 5일)
  applyMerges(db, [{ survivor: c, absorbed: e, reason: "같은 이야기다", summary: "가짜 물류가 막혔다." }], "2026-10-03");
  const [cd] = applyMerges(db, [{ survivor: d, absorbed: c, reason: "같은 이야기다", summary: "가짜 공급망이 흔들린다." }], "2026-10-05");
  return { db, a, b, c, d, e, f, g, cd: cd! };
}

function parse<T>(files: Map<string, string>, name: string): T {
  const text = files.get(`site-data/${name}`);
  assert.ok(text !== undefined, `site-data/${name}이 없다`);
  return JSON.parse(text) as T;
}

describe("3단계 4.1-1 사이트 데이터", () => {
  test("파일 목록과 날짜 목록", () => {
    const { db } = exampleDb();
    const files = buildSiteData(db);
    assert.deepEqual([...files.keys()].sort(), [
      "site-data/dates.json",
      "site-data/detail-2026-10.json",
      "site-data/detail-2026-11.json",
      "site-data/entity-list-all-0.json",
      "site-data/entity-list-country-0.json",
      "site-data/entity-list-org-0.json",
      "site-data/entity-list-person-0.json",
      "site-data/issue-0.json",
      "site-data/issue-1.json",
      "site-data/issue-list.json",
      "site-data/list-2026-10.json",
      "site-data/list-2026-11.json",
      "site-data/term-index.json",
    ]);
    assert.deepEqual(parse<SiteDates>(files, "dates.json"), {
      version: 1,
      latestDate: "2026-11-01",
      dates: ["2026-11-01", "2026-10-04", "2026-10-02", "2026-10-01"],
      months: ["2026-11", "2026-10"],
      storyCounts: DATES.map((d) => storiesOfDate(db, d).length).reverse(),
    });
    db.close();
  });

  test("목록: 브리프의 헤드라인·키워드·섹션과 뉴스마다 섹션·순위·키·제목·분류·주 이슈·새 이슈·어제에 이어", () => {
    const { db, a, b, d, f } = exampleDb();
    const oct = parse<MonthList>(buildSiteData(db), "list-2026-10.json");
    assert.equal(oct.month, "2026-10");
    assert.deepEqual(oct.days.map((x) => x.date), ["2026-10-01", "2026-10-02", "2026-10-04"]);
    const day = oct.days[0]!;
    assert.equal(day.headline, "2026-10-01의 흐름을 한 문장으로 정리했다.");
    assert.deepEqual(day.keywords, ["금리", "AI", "선거"]);
    assert.deepEqual(day.sections.map((s) => s.name), ["한국", "세계", "IT·AI"]);
    assert.equal(day.sections[0]!.flow, "한국 섹션의 그날 흐름을 한 줄로 적었다.");
    assert.equal(day.sections[0]!.unverified, "일부 수치는 한 매체만 보도해 확인되지 않았다.");
    assert.equal("unverified" in day.sections[1]!, false);
    assert.deepEqual(
      day.sections[0]!.stories.map((s) => s.key),
      ["한국-1", "한국-2", "한국-3", "한국-4", "한국-5", "한국-s1", "한국-s2"],
    );
    const top = day.sections[0]!.stories[0]!;
    assert.deepEqual(top, {
      key: "한국-1",
      section: "한국",
      kind: "top",
      position: 1,
      title: "한국 뉴스 1의 핵심을 담은 제목",
      category: { major: "경제", minor: "금융·증시" },
      issue: { id: a, name: "가짜 금리 갈등" },
      newIssue: true,
      continues: null,
    });
    const short = day.sections[0]!.stories[5]!;
    assert.deepEqual(short, {
      key: "한국-s1",
      section: "한국",
      kind: "short",
      position: 1,
      title: "한국 짧은 소식 1을 한 줄로 적었다.",
      category: { major: "사회", minor: "교육" },
      issue: { id: f, name: "가짜 학교 개편" },
      newIssue: true,
      continues: null,
    });
    // 이슈가 없는 뉴스
    assert.deepEqual(day.sections[0]!.stories[1]!.issue, null);
    assert.equal(day.sections[0]!.stories[1]!.newIssue, false);
    // 10월 4일 세계-1: 이슈 b의 이전 전개(10월 1일)가 있어 새 이슈가 아니다
    const w1 = oct.days[2]!.sections[1]!.stories[0]!;
    assert.deepEqual(w1.issue, { id: b, name: "가짜 무역 협상" });
    assert.equal(w1.newIssue, false);
    // 흡수된 이슈의 뉴스는 남는 이슈로 나온다
    assert.deepEqual(oct.days[0]!.sections[1]!.stories[1]!.issue, { id: d, name: "가짜 공급망 위기" });
    db.close();
  });

  test("펼친 카드: 주요 뉴스만, 본문 항목·출처(대표 먼저, 이미지·발행일 추정은 있을 때만)·추가 이슈·이전 전개", () => {
    const { db, a, b } = exampleDb();
    const files = buildSiteData(db);
    const oct = parse<MonthDetail>(files, "detail-2026-10.json");
    assert.deepEqual(Object.keys(oct.days), ["2026-10-01", "2026-10-02", "2026-10-04"]);
    const d2 = oct.days["2026-10-02"]!;
    assert.deepEqual(Object.keys(d2), ["한국-1", "한국-2", "한국-3", "한국-4", "한국-5", "세계-1", "세계-2", "세계-3", "세계-4", "세계-5", "IT·AI-1", "IT·AI-2", "IT·AI-3", "IT·AI-4", "IT·AI-5"]);
    const k1 = d2["한국-1"]!;
    assert.deepEqual(k1, {
      key: "한국-1",
      summary: "한국 뉴스 1을 한 줄로 요약했다.",
      whyItMatters: "많은 사람의 생활에 영향을 준다.",
      background: "처음 보는 사람도 이해할 수 있게 배경을 적었다.",
      keyFacts: ["숫자 1: 3.5%", "주체: 가짜 기관", "날짜: 2026-10-02"],
      outlook: "다음 주 발표가 예정되어 있다.",
      confidence: "여러 출처 확인",
      sources: [
        { name: "가짜통신", url: "https://news.example-kr-1.com/2026-10-02/kr-1", publishedAt: "2026-10-02", imageUrl: IMAGE, primary: true },
        { name: "예시일보", url: "https://daily.example.org/kr-1", publishedAt: "2026-10-02" },
      ],
      analogy: "큰 배가 방향을 트는 데 시간이 걸리는 것과 같다.",
      extras: [],
      previous: [{ date: "2026-10-01", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" }],
    });
    assert.deepEqual(d2["한국-2"]!.sources, [
      { name: "가짜통신", url: "https://news.example.com/2026-10-02/second", publishedAt: "2026-10-02", primary: true },
      { name: "예시일보", url: "https://daily.example.org/2026-10-02/second", publishedAt: "2026-10-02", publishedAtEstimated: true },
    ]);
    assert.equal("analogy" in d2["한국-2"]!, false);
    assert.deepEqual(d2["한국-2"]!.previous, []);
    // 4.4-3: 이미지 주소는 그 출처 하나에만 있다
    const images = [...files.values()].join("").match(/imageUrl/g) ?? [];
    assert.equal(images.length, 1);
    assert.deepEqual(oct.days["2026-10-04"]!["한국-1"]!.extras, [{ id: b, name: "가짜 무역 협상" }]);
    // 11월: 이전 전개는 가까운 것부터 최대 3건
    const nov = parse<MonthDetail>(files, "detail-2026-11.json");
    assert.deepEqual(nov.days["2026-11-01"]!["한국-1"]!.previous, [
      { date: "2026-10-04", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
      { date: "2026-10-02", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
      { date: "2026-10-01", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
    ]);
    assert.ok(a > 0);
    db.close();
  });

  test("이전 전개가 2단계 브리프 마크다운이 보이는 이전 전개와 같다", () => {
    const { db } = exampleDb();
    const files = buildSiteData(db);
    let compared = 0;
    for (const date of DATES) {
      const detail = parse<MonthDetail>(files, `detail-${date.slice(0, 7)}.json`).days[date]!;
      const issues = briefIssues(db, date);
      const md = renderMarkdown(loadBrief(db, date)!, issues);
      for (const [key, d] of Object.entries(detail)) {
        const info = issues.get(key);
        assert.deepEqual(d.previous, info ? info.previous : [], `${date}/${key}`);
        if (!info) continue;
        // 마크다운의 그 뉴스 블록에 나온 이전 전개(날짜, 제목)
        const [section, rank] = key.split("-");
        const start = md.indexOf(`\n### ${rank}. `, md.indexOf(`\n## ${section}\n`));
        const block = md.slice(start, md.indexOf("- **분류:**", start));
        const shown = [...block.matchAll(/^ {2}- \[(\d{4}-\d{2}-\d{2})\]\(\1\.md\) (.+)$/gm)].map((m) => ({ date: m[1], title: m[2] }));
        assert.deepEqual(
          d.previous.map((p) => ({ date: p.date, title: p.title })),
          shown,
          `${date}/${key}`,
        );
        if (d.previous.length === 0) assert.match(block, /- \*\*이전 전개:\*\* 새 이슈/);
        compared++;
      }
    }
    assert.ok(compared >= 8, `비교한 뉴스 ${compared}건`);
    db.close();
  });

  test("이슈 목록: 흡수되지 않은 이슈를 최근 업데이트일 순으로, 흡수된 이슈는 사슬 끝 남는 이슈와 합친 날짜로", () => {
    const { db, a, b, c, d, e, f, g } = exampleDb();
    const list = parse<SiteIssueList>(buildSiteData(db), "issue-list.json");
    assert.deepEqual(
      list.issues.map((i) => i.id),
      [a, g, b, d, f],
    );
    assert.deepEqual(list.issues[0], {
      id: a,
      name: "가짜 금리 갈등",
      category: cat,
      status: "진행 중",
      startDate: "2026-10-01",
      latestDate: "2026-11-01",
      count: 4,
    });
    assert.equal(list.issues.find((i) => i.id === b)!.status, "종료");
    assert.deepEqual(list.merged, { [String(e)]: { into: d, on: "2026-10-03" }, [String(c)]: { into: d, on: "2026-10-05" } });
    db.close();
  });

  test("이슈 상세: 묶음 파일에 별칭·요약·모든 전개(최근 순)·관련 이슈(남는 이슈로)", () => {
    const { db, a, b, d, f, g } = exampleDb();
    const files = buildSiteData(db);
    const chunk0 = parse<IssueChunk>(files, "issue-0.json");
    assert.deepEqual(Object.keys(chunk0.issues), [a, b, d, f].map(String));
    const ia = chunk0.issues[String(a)]!;
    assert.deepEqual(ia.aliases, ["Fake Rate Dispute"]);
    assert.equal(ia.summary, "가짜 기관 사이의 금리 갈등이다.");
    assert.deepEqual(ia.timeline, [
      { date: "2026-11-01", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
      { date: "2026-10-04", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
      { date: "2026-10-02", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
      { date: "2026-10-01", key: "한국-1", title: "한국 뉴스 1의 핵심을 담은 제목" },
    ]);
    assert.deepEqual(ia.related, [{ id: d, name: "가짜 공급망 위기" }]);
    // 추가 이슈로 붙은 뉴스도 전개에 들어간다
    assert.deepEqual(chunk0.issues[String(b)]!.timeline.map((t) => `${t.date}/${t.key}`), ["2026-10-04/세계-1", "2026-10-04/한국-1", "2026-10-01/세계-1"]);
    // 합친 이슈의 전개와 별칭
    const id = chunk0.issues[String(d)]!;
    assert.deepEqual(id.timeline.map((t) => t.date), ["2026-10-04", "2026-10-02", "2026-10-01"]);
    assert.deepEqual(id.aliases, ["가짜 물류 대란", "가짜 항만 파업", "항만 멈춤"]);
    assert.equal(id.count, 3);
    const chunk1 = parse<IssueChunk>(files, "issue-1.json");
    assert.deepEqual(Object.keys(chunk1.issues), [String(g)]);
    assert.deepEqual(chunk1.issues[String(g)]!.related, [{ id: f, name: "가짜 학교 개편" }]);
    db.close();
  });

  test("4.3-2 합치기를 되돌린 DB로 다시 만들면 되살아난 이슈가 목록과 상세에 나온다", () => {
    const { db, c, d, e, cd } = exampleDb();
    const r = unmerge(db, cd, "2026-10-06");
    assert.ok(r.ok);
    const files = buildSiteData(db);
    const list = parse<SiteIssueList>(files, "issue-list.json");
    assert.deepEqual(list.merged, { [String(e)]: { into: c, on: "2026-10-03" } });
    assert.ok(list.issues.some((i) => i.id === c));
    const chunk0 = parse<IssueChunk>(files, "issue-0.json");
    assert.deepEqual(chunk0.issues[String(c)]!.timeline.map((t) => t.date), ["2026-10-02", "2026-10-01"]);
    assert.deepEqual(chunk0.issues[String(d)]!.timeline.map((t) => t.date), ["2026-10-04"]);
    db.close();
  });
});

describe("4.5단계 4.5-2 날짜별 뉴스 수", () => {
  test("dates.json의 날짜별 수가 DB에 저장된 그날 뉴스 수(주요 뉴스 + 짧은 소식)와 같다", () => {
    const db = openDb(path.join(tempDir(), "counts.db"));
    for (const d of DATES) {
      const b = brief(d);
      // 날짜마다 수가 다르게: 10월 4일은 짧은 소식 하나, 11월 1일은 짧은 소식 둘을 뺀다
      if (d === "2026-10-04") b.sections[0]!.shortNews.pop();
      if (d === "2026-11-01") b.sections[1]!.shortNews.splice(0, 2);
      const r = validateBrief(b, d);
      assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
      saveBrief(db, { brief: r.brief, collectedAt: `${d}T23:00:00+09:00`, late: false });
    }
    const dates = parse<SiteDates>(buildSiteData(db), "dates.json");
    const expected = dates.dates.map((d) => {
      const stored = loadBrief(db, d)!.brief;
      return stored.sections.reduce((n, s) => n + s.topStories.length + s.shortNews.length, 0);
    });
    assert.deepEqual(dates.storyCounts, expected);
    assert.deepEqual(dates.storyCounts, dates.dates.map((d) => storiesOfDate(db, d).length));
    assert.equal(new Set(dates.storyCounts).size > 1, true, "날짜마다 수가 달라야 이 확인이 뜻이 있다");
    db.close();
  });
});

describe("3단계 4.1-2 같은 DB, 같은 결과", () => {
  test("두 번 만들면 사이트 데이터와 검색 레코드가 바이트 단위로 같다", () => {
    const { db } = exampleDb();
    const first = buildSiteData(db);
    const second = buildSiteData(db);
    assert.deepEqual([...second.keys()], [...first.keys()]);
    for (const [k, v] of first) assert.equal(second.get(k), v, k);
    assert.equal(JSON.stringify(buildSearchRecords(db)), JSON.stringify(buildSearchRecords(db)));
    db.close();
  });
});

describe("3단계 4.2-3 어제에 이어", () => {
  test("글: 하루 전이면 어제에 이어, 그보다 앞이면 M월 D일에 이어(0 없이)", () => {
    assert.equal(continuesLabel("2026-10-31", "2026-11-01"), "어제에 이어");
    assert.equal(continuesLabel("2026-10-02", "2026-10-04"), "10월 2일에 이어");
    assert.equal(continuesLabel("2026-09-05", "2026-10-04"), "9월 5일에 이어");
  });

  test("앞 저장일이 하루 전·이틀 이상 전·그 이슈 뉴스가 없음·첫 저장일·이슈 없음", () => {
    const { db } = exampleDb();
    const files = buildSiteData(db);
    const oct = parse<MonthList>(files, "list-2026-10.json");
    const nov = parse<MonthList>(files, "list-2026-11.json");
    const at = (list: MonthList, date: string, key: string) => {
      const s = list.days.find((x) => x.date === date)!.sections.flatMap((x) => x.stories).find((x) => x.key === key);
      assert.ok(s, `${date}/${key}`);
      return s;
    };
    // 첫 저장일
    assert.equal(at(oct, "2026-10-01", "한국-1").continues, null);
    // 하루 전
    assert.deepEqual(at(oct, "2026-10-02", "한국-1").continues, { date: "2026-10-01", label: "어제에 이어" });
    // 앞 저장일(10월 2일)이 이틀 전
    assert.deepEqual(at(oct, "2026-10-04", "한국-1").continues, { date: "2026-10-02", label: "10월 2일에 이어" });
    // 달이 바뀌어도 앞 저장일을 본다
    assert.deepEqual(at(nov, "2026-11-01", "한국-1").continues, { date: "2026-10-04", label: "10월 4일에 이어" });
    // 앞 저장일(10월 2일)에 이슈 b의 뉴스가 없다(10월 1일에는 있다)
    assert.equal(at(oct, "2026-10-04", "세계-1").continues, null);
    // 흡수된 이슈의 뉴스는 남는 이슈로 비교한다(10월 2일 세계-2는 c였다가 d로 합쳐졌다)
    assert.deepEqual(at(oct, "2026-10-04", "세계-2").continues, { date: "2026-10-02", label: "10월 2일에 이어" });
    // 이슈 없는 뉴스
    assert.equal(at(oct, "2026-10-02", "한국-2").continues, null);
    db.close();
  });
});

describe("3단계 4.1-3 검색 레코드", () => {
  test("날짜마다 뉴스 레코드 하나, 이슈 묶음마다 이슈 레코드 하나", () => {
    const { db, c, e, g } = exampleDb();
    const records = buildSearchRecords(db);
    assert.deepEqual(
      records.map((r) => [r.url, r.meta]),
      [
        ["/2026-10-01", { kind: "news", date: "2026-10-01" }],
        ["/2026-10-02", { kind: "news", date: "2026-10-02" }],
        ["/2026-10-04", { kind: "news", date: "2026-10-04" }],
        ["/2026-11-01", { kind: "news", date: "2026-11-01" }],
        ["/issues/chunk/0", { kind: "issues", chunk: "0" }],
        ["/issues/chunk/1", { kind: "issues", chunk: "1" }],
      ],
    );
    assert.ok(records.every((r) => r.language === "ko"));
    const news = records[1]!.content.split("\n");
    for (const s of ["한국 뉴스 1의 핵심을 담은 제목", "한국 뉴스 1을 한 줄로 요약했다.", "많은 사람의 생활에 영향을 준다.", "반도체가 수출을 끌어올렸다", "큰 배가 방향을 트는 데 시간이 걸리는 것과 같다.", "다음 주 발표가 예정되어 있다.", "세계 짧은 소식 1을 한 줄로 적었다."]) {
      assert.ok(news.includes(s), s);
    }
    const issues0 = records[4]!.content.split("\n");
    for (const s of ["가짜 금리 갈등", "Fake Rate Dispute", "가짜 기관 사이의 금리 갈등이다.", "항만 멈춤"]) assert.ok(issues0.includes(s), s);
    // 흡수된 이슈의 요약은 따로 들어가지 않는다(이름은 남는 이슈의 별칭으로 들어간다)
    assert.ok(!issues0.includes("가짜 항만의 파업이다."));
    assert.ok(c > 0 && e > 0);
    assert.ok(records[5]!.content.split("\n").includes("Fake Launch"), String(g));
    db.close();
  });
});
