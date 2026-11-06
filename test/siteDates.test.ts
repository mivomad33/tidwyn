import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSite, listFilesRecursive } from "../site/build.ts";
import { writeFixtures } from "../site/dev/fixtures.ts";
import { BriefBox } from "../site/src/components/briefBox.ts";
import { IndicatorCardView } from "../site/src/components/indicatorView.ts";
import type { LinkLikeProps } from "../site/src/components/termView.ts";
import { builderDueText } from "../site/src/lib/builder.ts";
import { entityListLine, entityMetaLine } from "../site/src/lib/entities.ts";
import { axisDates, dateText, dateTextWeekday, dayOrMonthText, shortDate } from "../site/src/lib/format.ts";
import { changeLabel, chipDateNote, collapsedParts } from "../site/src/lib/indicators.ts";
import { issueListLine, issueMetaLine } from "../site/src/lib/issues.ts";
import { latestYear } from "../site/src/lib/format.ts";
import { chipDue, dayHeading, dueLabel, issueRowDate, weekRowDate } from "../site/src/lib/schedules.ts";
import type { IndicatorCard, IndicatorChip } from "../src/siteTypes.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// U1 4.3 날짜 표기: 날짜 글(4.3-1), 지표 변화의 같은 단위(4.3-2), 정적 HTML 본문에 'YYYY-MM-DD'가 없음(4.3-3). 지어낸 데이터만 쓴다.

after(cleanupTemp);

const ROOT = path.join(import.meta.dirname, "..");
/** 주석을 뺀 코드(주석 속 설명 글이 검사에 걸리지 않게) */
const code = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, "");
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;

describe("U1 4.3-1 날짜 표기 함수(앱·정적 공통, site/src/lib/format.ts)", () => {
  test("날짜 글: 같은 해 'M월 D일', 다른 해 'YYYY년 M월 D일'. 기준 해가 없으면 같은 해로 본다", () => {
    assert.equal(dateText("2026-10-27", "2026"), "10월 27일");
    assert.equal(dateText("2025-12-30", "2026"), "2025년 12월 30일");
    assert.equal(dateText("2026-01-02"), "1월 2일");
    assert.equal(dateTextWeekday("2026-10-27", "2026"), "10월 27일 (화)");
    assert.equal(dateTextWeekday("2025-12-30", "2026"), "2025년 12월 30일 (화)");
    assert.equal(dayOrMonthText("2026-09", "2026"), "9월");
    assert.equal(dayOrMonthText("2027-01", "2026"), "2027년 1월");
    assert.equal(dayOrMonthText("2027-01-04", "2026"), "2027년 1월 4일");
  });

  test("좁은 자리: 같은 해 'MM-DD', 다른 해는 해를 붙이되 'YYYY-MM-DD'는 아니다", () => {
    assert.equal(shortDate("2026-10-21", "2026"), "10-21");
    assert.equal(shortDate("2025-12-30", "2026"), "'25 12-30");
    assert.doesNotMatch(shortDate("2025-12-30", "2026"), ISO_DATE);
    assert.equal(chipDateNote({ date: "2025-12-31" }, "2026-01-02"), "'25 12-31");
    assert.equal(chipDateNote({ date: "2026-10-26" }, "2026-10-27"), "10-26");
  });

  test("그래프 축: 해를 넘지 않으면 'MM-DD'(월별 'N월'), 해를 넘으면 두 끝 모두 해를 붙인다", () => {
    assert.deepEqual(axisDates("2026-01-05", "2026-10-28"), ["01-05", "10-28"]);
    assert.deepEqual(axisDates("2025-10-28", "2026-10-28"), ["'25 10-28", "'26 10-28"]);
    assert.deepEqual(axisDates("2026-01", "2026-09"), ["1월", "9월"]);
    assert.deepEqual(axisDates("2021-10", "2026-09"), ["'21 10월", "'26 9월"]);
  });

  test("일정 날짜: 화면마다 기준 해와 다르면 해를 쓰고 'YYYY-MM-DD'는 없다", () => {
    const today = "2026-12-30";
    assert.equal(dayHeading("2027-01-02", today), "2027년 1월 2일 (토)");
    assert.equal(dueLabel("2027-01-02", today), "2027년 1월 2일");
    assert.equal(issueRowDate("2027-01-02", today), "'27 01-02 (토)");
    assert.equal(weekRowDate("2027-01-02", "2026"), "'27 01-02 토");
    assert.equal(weekRowDate("2026-12-31", "2026"), "12-31 목");
    assert.equal(chipDue("2027-01-02", "2026"), "'27 01-02");
    assert.equal(chipDue("2027-01", "2026"), "2027년 1월 중");
    assert.equal(chipDue("2026-11", "2026"), "11월 중");
    assert.equal(builderDueText({ date: "2027-01-02", state: "confirmed" }, "2026"), "2027년 1월 2일 · 확정");
    assert.equal(builderDueText({ date: "2026-11", state: "tentative" }, "2026"), "11월 · 잠정");
  });

  test("브리프 화면의 '이번 주 일정' 줄은 펼친 카드의 일정 칩처럼 브리프 날짜의 해가 기준이다(오늘의 해가 아니다)", () => {
    const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);
    const week = { total: 1, items: [{ id: 1, name: "가짜 연말 일정", due: "2025-12-31", outcome: { status: "pending" } as const }] };
    const html = renderToStaticMarkup(h(BriefBox, { day: { date: "2025-12-30", week }, tab: "week", collapsed: false, onTab: () => {}, onToggle: () => {}, today: "2026-01-05", Link }));
    assert.match(html, /<b>12-31 수<\/b>/);
    assert.equal(chipDue("2025-12-31", "2025"), "12-31");
  });

  test("이슈·대상의 날짜 줄: '최근 …', '… 시작 · 최근 …'은 날짜 글이다", () => {
    const issue = { status: "진행 중" as const, startDate: "2025-12-19", latestDate: "2026-01-03", count: 8 };
    assert.equal(issueMetaLine(issue), "2025년 12월 19일 시작 · 최근 1월 3일 · 전개 8건");
    assert.equal(issueMetaLine({ ...issue, startDate: "2026-01-01" }), "1월 1일 시작 · 최근 1월 3일 · 전개 8건");
    assert.equal(issueListLine(issue, "2026"), "진행 중 · 최근 1월 3일 · 전개 8건");
    assert.equal(issueListLine({ ...issue, latestDate: "2025-12-30" }, "2026"), "진행 중 · 최근 2025년 12월 30일 · 전개 8건");
    assert.equal(issueListLine({ ...issue, latestDate: null }, "2026"), "진행 중 · 전개 8건");
    assert.equal(latestYear(["2025-12-30", null, "2026-01-03"]), "2026");
    assert.equal(latestYear([null]), undefined);
    const entity = { kind: "인물" as const, aliases: [], firstDate: "2025-12-01", latestDate: "2026-01-03", count: 1200 };
    assert.equal(entityMetaLine(entity), "처음 2025년 12월 1일 · 최근 1월 3일 · 뉴스 1,200건");
    assert.equal(entityListLine(entity, "2026"), "인물 · 최근 1월 3일 · 뉴스 1,200건");
  });

  test("같은 데이터는 화면마다 같은 함수를 거친다(이슈의 최근 날짜, 대상 날짜, 일정 날짜)", () => {
    const app = { list: code("site/src/pages/IssuesPage.tsx"), page: code("site/src/pages/IssuePage.tsx"), entities: code("site/src/pages/EntitiesPage.tsx"), entity: code("site/src/pages/EntityPage.tsx") };
    const stat = code("site/staticSite.ts");
    assert.match(app.list, /issueListLine\(i, refYear\)/, "앱 이슈 목록");
    assert.match(stat, /issueListLine\(i, refYear\)/, "정적 이슈 목록");
    assert.match(app.page, /issueMetaLine\(issue\)/, "앱 이슈 페이지");
    assert.match(stat, /issueMetaLine\(issue\)/, "정적 이슈 페이지");
    assert.match(app.entities, /entityListLine\(e, year\)/);
    assert.match(stat, /entityListLine\(e, year\)/);
    assert.match(app.entity, /entityMetaLine\(entity\)/);
    assert.match(stat, /entityMetaLine\(entity\)/);
    // 날짜 필드를 글자에 그대로 넣지 않는다
    for (const [name, src] of [...Object.entries(app), ["staticSite", stat]] as const) assert.doesNotMatch(src, /\$\{[\w.?!]*(latestDate|startDate|firstDate)\}/, `${name}: 날짜를 그대로 쓰지 않는다`);
    // 일정 날짜는 lib/schedules.ts의 함수를 거치고, 그 함수들은 format.ts의 공통 함수로 쓴다
    const lib = code("site/src/lib/schedules.ts");
    assert.match(lib, /import \{ [^}]*shortDate[^}]* \} from "\.\/format\.ts";/);
    assert.doesNotMatch(lib, /\.slice\(5\)/, "날짜를 직접 자르지 않는다");
    assert.match(code("site/src/components/scheduleView.ts"), /chipDue\(s\.due, refYear\)[\s\S]*weekRowDate\(x\.due, refYear \?\? yearOf\(today\)\)[\s\S]*issueRowDate\(line\.due, today\)/);
    assert.match(code("site/src/pages/SchedulesPage.tsx"), /dayHeading\(g\.date, today\)/);
    assert.match(stat, /chipDue\(item\.due\)/);
    // 좁은 자리의 날짜도 같은 함수
    assert.doesNotMatch(code("site/src/lib/indicators.ts"), /date\.slice\(5\)|: chip\.date;/);
  });
});

describe("U1 4.3-2 지표 변화는 어느 자리든 같은 단위", () => {
  const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);
  const chip: IndicatorChip = { id: "usdkrw", name: "가짜 원/달러", unit: "원", decimals: 1, kind: "abs", date: "2026-10-27", value: 1392.5, change: 3.1 };
  const card: IndicatorCard = {
    id: "usdkrw",
    name: "가짜 원/달러",
    group: "한국",
    unit: "원",
    freq: "day",
    decimals: 1,
    change: "abs",
    yoy: false,
    credit: "가짜 출처",
    last: { date: "2026-10-27", value: 1392.5, change: 3.1 },
    spark: [],
    issues: [],
  };
  const changeOf = (html: string) => html.match(/<span class="chg [a-z]+">(?:<span class="chg-p">[^<]*<\/span>)?<span aria-hidden="true">([^<]*)<\/span>/)?.[1];

  test("좁은 자리(상자 칩·접은 줄)와 넓은 자리(카드)가 같은 글: 값 변화와 %", () => {
    const wide = changeOf(renderToStaticMarkup(h(IndicatorCardView, { card, Link })));
    const box = changeOf(renderToStaticMarkup(h(BriefBox, { day: { date: "2026-10-27", indicators: [chip] }, tab: "indicators", collapsed: false, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link })));
    const folded = collapsedParts({ indicators: [chip] }).chip!.change!.text;
    assert.equal(wide, "▲3.1 (0.22%)");
    assert.equal(box, wide);
    assert.equal(folded, wide);
  });

  test("퍼센트를 낼 수 없으면(앞 값 0) 값 변화만, %p 지표는 %p", () => {
    assert.equal(changeLabel({ change: "abs", decimals: 1 }, 2, 2)!.text, "▲2.0");
    assert.equal(collapsedParts({ indicators: [{ ...chip, value: 2, change: 2 }] }).chip!.change!.text, "▲2.0");
    assert.equal(collapsedParts({ indicators: [{ ...chip, kind: "pp", unit: "%", decimals: 2, value: 4.21, change: 0.03 }] }).chip!.change!.text, "▲0.03%p");
  });
});

describe("U1 4.3-3 정적 HTML 본문에 'YYYY-MM-DD'가 없다", () => {
  let out = "";
  let dataStrings: string[] = [];
  before(async () => {
    const work = tempDir("tidwyn-dates-");
    const dataDir = path.join(work, "data");
    out = path.join(work, "out");
    // 해를 넘는 날짜(앞 해와 새해가 섞임)로 다른 해의 표기까지 덮는다
    writeFixtures(dataDir, { end: "2026-01-03", days: 20, contiguous: true, entities: 12, terms: 8, schedules: 24, indicators: 1, indicatorsAll: true, videos: true, corrections: true, builder: true, demand: true });
    await buildSite({ dataDir, outDir: out });
    // 데이터에서 온 이름·제목(저장소 이름 등)에 든 날짜 모양은 사이트가 쓴 글이 아니라 뺀다: 날짜만인 값이 아닌, 날짜 모양을 품은 데이터 글자
    const seen = new Set<string>();
    const walk = (v: unknown) => {
      if (typeof v === "string") {
        if (ISO_DATE.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) seen.add(v);
      } else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    for (const dir of [dataDir, path.join(out, "site-data")]) for (const f of listFilesRecursive(dir).filter((f) => f.endsWith(".json"))) walk(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    dataStrings = [...seen].sort((a, b) => b.length - a.length);
  });

  /** 본문의 보이는 글: head·script·style과 태그(속성 포함)를 지우고, 데이터에서 온 글자를 뺀다 */
  function bodyText(page: string): string {
    let text = (page.match(/<body[\s\S]*<\/body>/)?.[0] ?? page)
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]*>/g, "\n")
      .replaceAll("&amp;", "&")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&quot;", '"')
      .replaceAll("&#x27;", "'")
      .replaceAll("&#39;", "'");
    for (const s of dataStrings) text = text.replaceAll(s, "");
    return text;
  }

  test("모든 정적 페이지의 본문 글(주소·datetime 속성·메타 태그·데이터의 이름과 제목 제외)", () => {
    const pages = listFilesRecursive(out).filter((f) => f.endsWith(".html") && !f.startsWith("pagefind"));
    assert.ok(pages.length > 40, `페이지 ${pages.length}개`);
    const bad: string[] = [];
    for (const f of pages) {
      const text = bodyText(fs.readFileSync(path.join(out, f), "utf8"));
      for (const line of text.split("\n")) if (ISO_DATE.test(line)) bad.push(`${f}: ${line.trim()}`);
    }
    assert.deepEqual(bad, []);
  });

  test("검사가 날짜 표기 자리를 덮는다: 다른 해의 날짜 글과 좁은 자리 날짜가 본문에 있다", () => {
    const all = listFilesRecursive(out)
      .filter((f) => f.endsWith(".html"))
      .map((f) => bodyText(fs.readFileSync(path.join(out, f), "utf8")))
      .join("\n");
    assert.match(all, /2025년 12월 \d+일 시작 · 최근 1월 3일/, "이슈 페이지의 시작·최근");
    assert.match(all, /최근 1월 3일 · 전개/, "이슈 목록의 최근");
    assert.match(all, /'25 12-\d\d/, "좁은 자리의 앞 해 날짜");
    assert.match(all, /정정됨 · /, "정정 표시");
  });
});
