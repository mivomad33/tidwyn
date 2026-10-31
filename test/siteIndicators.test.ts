import assert from "node:assert/strict";
import path from "node:path";
import { after, describe, test } from "node:test";
import fs from "node:fs";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { siteFiles, type DayList, type IndicatorCard, type IndicatorChip, type IndicatorList, type IndicatorPoint, type IndicatorSeries, type IssueChunk, type MonthList } from "../src/siteTypes.ts";
import { buildSite } from "../site/build.ts";
import { generateFixtures, writeFixtures } from "../site/dev/fixtures.ts";
import { resolveStatic } from "../site/hosting.ts";
import { pageFile } from "../src/publicSite.ts";
import { FIRST_SCREEN_BUDGET, measureIndicatorScreens, measureOutput } from "../site/size.ts";
import { BriefBox } from "../site/src/components/briefBox.ts";
import { ChangeText, FredNotice, IndicatorCardView, LineChart, SourceNote } from "../site/src/components/indicatorView.ts";
import type { LinkLikeProps } from "../site/src/components/termView.ts";
import {
  BOX_TAB_KEY,
  FRED_AGREEMENT,
  FRED_NOTICE,
  FRED_TERMS_URL,
  RELATED_FIRST,
  asOfLine,
  boxValuesDate,
  briefBoxModel,
  changeLabel,
  chartGeometry,
  chartSummary,
  chipDateNote,
  collapsedParts,
  creditsOf,
  dotIndexes,
  formatValue,
  groupCards,
  issueGraphPoints,
  moveIndex,
  nearestIndex,
  parseBoxTab,
  periodPoints,
  periodStart,
  readingValueText,
  relatedShown,
  visibleCards,
} from "../site/src/lib/indicators.ts";
import { dataUrl } from "../site/src/lib/paths.ts";
import { focusTargetId, indicatorPath, indicatorsPath, parseRoute, selfScrolls } from "../site/src/lib/routes.ts";
import { createRemembered } from "../site/src/lib/storage.ts";
import type { StorageLike } from "../site/src/lib/readMarks.ts";
import { WEEK_BOX_KEY, parseWeekCollapsed } from "../site/src/lib/schedules.ts";
import { DARK, LIGHT, contrast, iconPairs, textPairs } from "../site/src/lib/theme.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// 6단계 지표 화면(4.7)의 DOM 없는 로직과 그리기(react-dom/server), 지어낸 데이터의 지표, 5년치 크기(4.6-2). 값은 모두 지어낸 것이다.

after(cleanupTemp);

const Link = ({ to, className, children }: LinkLikeProps) => h("a", { href: to, className }, children);

const usdkrw = { id: "usdkrw", name: "가짜 원/달러", unit: "원", decimals: 1, kind: "abs" as const };
function chip(over: Partial<IndicatorChip> = {}): IndicatorChip {
  return { ...usdkrw, date: "2026-10-27", value: 1392.5, change: 3.1, ...over };
}
function card(over: Partial<IndicatorCard> = {}): IndicatorCard {
  return {
    id: "usdkrw",
    name: "가짜 원/달러",
    group: "한국",
    unit: "원",
    freq: "day",
    decimals: 1,
    change: "abs",
    yoy: false,
    credit: "자료: 한국은행 ECOS(작성기관: 한국은행)",
    last: { date: "2026-10-27", value: 1392.5, change: 3.1 },
    spark: [
      ["2026-10-26", 1389.4],
      ["2026-10-27", 1392.5],
    ],
    issues: [],
    ...over,
  };
}

describe("4.7-2 값·변화 표기", () => {
  test("단위와 소수 자리, 천 단위 쉼표", () => {
    assert.equal(formatValue({ unit: "원", decimals: 1 }, 1392.5), "1,392.5원");
    assert.equal(formatValue({ unit: "%", decimals: 2 }, 4.2), "4.20%");
    assert.equal(formatValue({ unit: "", decimals: 2 }, 2614.2), "2,614.20");
    assert.equal(formatValue({ unit: "달러", decimals: 2 }, 73.4), "73.40달러");
    assert.equal(formatValue({ unit: "%", decimals: 3 }, 2.6105), "2.611%");
  });

  test("abs·pct 방식은 차이와 퍼센트, pp 방식은 %p. 칩(좁은 곳)은 퍼센트나 %p만", () => {
    assert.deepEqual(changeLabel({ change: "abs", decimals: 1 }, 1392.5, 3.1, false), { dir: "up", text: "▲3.1 (0.22%)", spoken: "3.1 올라(0.22%)" });
    assert.equal(changeLabel({ change: "abs", decimals: 1 }, 1392.5, 3.1, true)!.text, "▲0.22%");
    // pct: 앞 값 2,635.2 → 2,614.2(약 -0.80%)
    assert.deepEqual(changeLabel({ change: "pct", decimals: 2 }, 2614.2, -0.7969, false), { dir: "down", text: "▼21.00 (0.80%)", spoken: "21.00 내려(0.80%)" });
    assert.equal(changeLabel({ change: "pct", decimals: 2 }, 2614.2, -0.7969, true)!.text, "▼0.80%");
    assert.equal(changeLabel({ change: "pp", decimals: 2 }, 4.21, 0.03, false)!.text, "▲0.03%p");
    assert.equal(changeLabel({ change: "pp", decimals: 2 }, 4.21, 0.03, true)!.text, "▲0.03%p");
    assert.equal(changeLabel({ change: "pp", decimals: 3 }, 2.61, -0.02, false)!.text, "▼0.020%p");
  });

  test("변동 없음과 앞 값 없음", () => {
    assert.deepEqual(changeLabel({ change: "pp", decimals: 2 }, 2.5, 0, false), { dir: "flat", text: "변동 없음", spoken: "변동 없음" });
    assert.equal(changeLabel({ change: "abs", decimals: 1 }, 1392.5, null, false), null);
    assert.equal(renderToStaticMarkup(h(ChangeText, { label: null })), "");
    assert.equal(
      renderToStaticMarkup(h(ChangeText, { label: changeLabel({ change: "abs", decimals: 1 }, 1392.5, -3.1, false) })),
      '<span class="chg down"><span aria-hidden="true">▼3.1 (0.22%)</span><span class="sr-only">3.1 내려(0.22%)</span></span>',
    );
  });

  test("월별 물가는 '9월 2.1%'와 '전달 대비'", () => {
    const cpi = card({ id: "krcpi", name: "가짜 물가", unit: "%", freq: "month", change: "pp", yoy: true, last: { date: "2026-09", value: 2.1, change: 0.1 } });
    assert.equal(readingValueText(cpi, cpi.last!), "9월 2.1%");
    const html = renderToStaticMarkup(h(IndicatorCardView, { card: cpi, Link }));
    assert.match(html, /<b class="v">9월 2\.1%<\/b>/);
    assert.match(html, /<span class="chg up"><span class="chg-p">전달 대비 <\/span><span aria-hidden="true">▲0\.1%p<\/span>/);
  });

  test("카드: 이름, 값, 변화(색과 ▲▼), 작은 그래프, 지표 하나의 페이지로 가는 링크", () => {
    const html = renderToStaticMarkup(h(IndicatorCardView, { card: card(), Link }));
    assert.match(html, /^<li><a href="\/indicators\/usdkrw" class="icard"><span class="n">가짜 원\/달러<\/span><b class="v">1,392\.5원<\/b>/);
    assert.match(html, /<span class="chg up">/);
    assert.match(html, /<svg class="spark"[^>]*aria-hidden="true"/);
    const flat = renderToStaticMarkup(h(IndicatorCardView, { card: card({ last: { date: "2026-10-27", value: 1392.5, change: 0 } }), Link }));
    assert.match(flat, /<span class="chg flat"><span aria-hidden="true">변동 없음<\/span>/);
  });

  test("카드 순서는 한국 → 미국·국제 묶음, 묶음 안은 데이터(정의) 순서. 값이 없는 지표는 빠진다", () => {
    const list: IndicatorList = {
      asOf: "2026-10-28",
      indicators: [card({ id: "a" }), card({ id: "b", last: null, spark: [] }), card({ id: "c", group: "미국·국제" }), card({ id: "d" })],
    };
    const groups = groupCards(visibleCards(list));
    assert.deepEqual(
      groups.map((g) => [g.group, g.cards.map((c) => c.id)]),
      [
        ["한국", ["a", "d"]],
        ["미국·국제", ["c"]],
      ],
    );
    assert.deepEqual(groupCards([]), []);
    assert.equal(asOfLine(list), "10월 28일까지의 값 · 공식 출처(한국은행 ECOS, FRED)");
    assert.equal(asOfLine({ asOf: null, indicators: [] }), "공식 출처(한국은행 ECOS, FRED)");
  });
});

describe("4.7-1 브리프 위 '이번 주 일정 | 지표' 상자", () => {
  const week = { total: 3, items: [{ id: 1, name: "가짜 일정", due: "2026-10-29", outcome: { status: "pending" as const } }] };
  const chips = [chip(), chip({ id: "kospi", name: "가짜 지수", unit: "", decimals: 2, kind: "pct", value: 2614.2, change: -0.7969 })];

  test("탭 규칙: 둘 다 있으면 두 탭(처음엔 일정), 일정이 없으면 지표만, 칩이 없으면 일정만, 둘 다 없으면 상자가 없다", () => {
    assert.deepEqual(briefBoxModel({ week, indicators: chips }, null), { tabs: ["week", "indicators"], tab: "week", label: "이번 주 일정과 지표", chips });
    assert.equal(briefBoxModel({ week, indicators: chips }, "indicators")!.tab, "indicators");
    assert.deepEqual(briefBoxModel({ indicators: chips }, "week"), { tabs: ["indicators"], tab: "indicators", label: "지표", chips });
    assert.deepEqual(briefBoxModel({ week, indicators: [] }, "indicators"), { tabs: ["week"], tab: "week", label: "이번 주 일정", chips: [] });
    assert.equal(briefBoxModel({}, null), null);
    const none = renderToStaticMarkup(h(BriefBox, { day: { date: "2026-10-27" }, tab: null, collapsed: false, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link }));
    assert.equal(none, "");
    assert.equal(renderToStaticMarkup(h(BriefBox, { day: { date: "2026-10-27" }, tab: null, collapsed: true, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link })), "", "접은 줄도 없다");
  });

  test("지표 탭: 칩마다 이름·값·변화, 지표 하나의 페이지로. 기준값 날짜가 다르면 그 날짜를 작게, 아래 줄에 'MM월 DD일 값 · 지표 전체 ›'", () => {
    const day = { date: "2026-10-27", week, indicators: [chip(), chip({ id: "wti", name: "가짜 유가", unit: "달러", decimals: 2, kind: "pct", date: "2026-10-26", value: 73.4, change: 1.9 })] };
    const html = renderToStaticMarkup(h(BriefBox, { day, tab: "indicators", collapsed: false, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link }));
    assert.match(html, /role="tablist"/);
    assert.match(html, /role="tab" id="brief-box-tab-week" aria-selected="false"[^>]*tabindex="-1">이번 주 일정 3<\/button>/);
    assert.match(html, /role="tab" id="brief-box-tab-indicators" class="on" aria-selected="true"[^>]*tabindex="0">지표<\/button>/);
    assert.match(html, /<a href="\/indicators\/usdkrw" class="ichip"><span class="n">가짜 원\/달러<\/span><b>1,392\.5원<\/b><span class="chg up"><span aria-hidden="true">▲0\.22%<\/span>/);
    assert.match(html, /<a href="\/indicators\/wti" class="ichip">.*?<small>10-26<span class="sr-only"> 값<\/span><\/small><\/a>/);
    assert.doesNotMatch(html.split('href="/indicators/wti"')[0]!, /<small>/, "브리프 날짜의 값에는 날짜를 붙이지 않는다");
    assert.match(html, /<p class="box-foot">10월 27일 값 · <a href="\/indicators">지표 전체<span aria-hidden="true"> ›<\/span><\/a><\/p>/);
    assert.match(html, /aria-expanded="true" aria-controls="brief-box-panel" aria-label="상자 접기"/);
    assert.equal(chipDateNote({ date: "2025-12-31" }, "2026-01-02"), "2025-12-31");
    assert.equal(boxValuesDate("2026-10-07"), "10월 7일 값");
  });

  test("일정 탭: 일정 줄과 아래 줄 '일정 전체 ›'", () => {
    const html = renderToStaticMarkup(h(BriefBox, { day: { date: "2026-10-27", week, indicators: chips }, tab: null, collapsed: false, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link }));
    assert.match(html, /<ul id="week-list"><li><a href="\/schedules\/1" class="wrow">/);
    assert.match(html, /<p class="box-foot"><a href="\/schedules\?view=list">일정 전체/);
    assert.doesNotMatch(html, /class="ichip"/);
  });

  test("접은 줄: '이번 주 일정 N · 원/달러 <값> <전날 대비> ▾'. 없는 쪽은 빠지고, 원/달러가 없으면 칩 순서의 첫 지표", () => {
    const both = renderToStaticMarkup(h(BriefBox, { day: { date: "2026-10-27", week, indicators: chips }, tab: null, collapsed: true, onTab: () => {}, onToggle: () => {}, today: "2026-10-28", Link }));
    assert.match(both, /^<section class="week closed" aria-label="이번 주 일정과 지표"><div class="week-h"><button type="button" class="box-toggle week-toggle" aria-expanded="false">이번 주 일정 3<span class="dot-sep" aria-hidden="true"> · <\/span><span class="fold-chip">가짜 원\/달러 1,392\.5원 <span class="chg up"><span aria-hidden="true">▲0\.22%<\/span>/);
    assert.match(both, /<span aria-hidden="true"> ▾<\/span><\/button><\/div><\/section>$/);
    assert.deepEqual(collapsedParts({ week }).chip, null);
    assert.equal(collapsedParts({ indicators: chips.slice(1) }).week, null);
    assert.equal(collapsedParts({ indicators: chips.slice(1) }).chip!.text, "가짜 지수 2,614.20");
  });

  test("기억: 고른 탭은 새 키 하나(tidwyn.briefBoxTab), 접기는 5단계 키 그대로. 깨진 값·저장할 수 없음은 기본값", () => {
    assert.equal(BOX_TAB_KEY, "tidwyn.briefBoxTab");
    assert.equal(WEEK_BOX_KEY, "tidwyn.weekBox");
    assert.equal(parseBoxTab("indicators"), "indicators");
    assert.equal(parseBoxTab("week"), "week");
    assert.equal(parseBoxTab("깨짐"), null);
    assert.equal(parseBoxTab(null), null);
    assert.equal(parseWeekCollapsed("closed"), true);
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("막힘");
      },
      setItem: () => {
        throw new Error("막힘");
      },
      removeItem: () => {},
      key: () => null,
      length: 0,
    } as unknown as StorageLike;
    const r = createRemembered(broken, BOX_TAB_KEY, parseBoxTab, (v) => v ?? "");
    assert.equal(r.get(), null);
    r.set("indicators");
    assert.equal(r.get(), "indicators", "저장하지 못해도 이 탭에서는 고른 값");
  });
});

describe("4.7-3 지표 하나의 페이지: 기간, 그래프, 요약, 관련 이슈", () => {
  // 2021-10-28부터 2026-10-27까지 매일(지어낸 값)
  const daily: IndicatorPoint[] = [];
  for (let t = Date.parse("2021-10-28T00:00:00Z"), i = 0; t <= Date.parse("2026-10-27T00:00:00Z"); t += 86400000, i++) daily.push([new Date(t).toISOString().slice(0, 10), 1000 + (i % 50)]);

  test("기간마다 마지막 값 기준 범위: 1개월·1년·5년(시작일 다음 날부터)", () => {
    assert.equal(periodStart("2026-10-27", "month"), "2026-09-27");
    assert.equal(periodStart("2026-10-27", "year"), "2025-10-27");
    assert.equal(periodStart("2026-10-27", "five"), "2021-10-27");
    assert.equal(periodStart("2026-01-15", "month"), "2025-12-15");
    assert.equal(periodStart("2026-09", "year"), "2025-09");
    const m = periodPoints(daily, "month");
    assert.equal(m[0]![0], "2026-09-28");
    assert.equal(m.at(-1)![0], "2026-10-27");
    const y = periodPoints(daily, "year");
    assert.equal(y[0]![0], "2025-10-28");
    assert.equal(periodPoints(daily, "five").length, daily.length);
    assert.deepEqual(periodPoints([], "year"), []);
    // 월별: 1개월은 값 하나뿐
    const monthly: IndicatorPoint[] = [
      ["2026-07", 2],
      ["2026-08", 2.2],
      ["2026-09", 2.1],
    ];
    assert.deepEqual(periodPoints(monthly, "month"), [["2026-09", 2.1]]);
  });

  test("요약 글: 기간, 처음·마지막 값, 최고·최저(날짜). 값 하나·없음", () => {
    const meta = { name: "가짜 지수", unit: "", decimals: 2 };
    const pts: IndicatorPoint[] = [
      ["2026-10-20", 10],
      ["2026-10-21", 14.5],
      ["2026-10-22", 9.25],
      ["2026-10-23", 11],
    ];
    assert.equal(chartSummary(meta, pts), "가짜 지수: 2026년 10월 20일부터 2026년 10월 23일까지. 처음 10.00, 마지막 11.00, 최고 14.50(2026년 10월 21일), 최저 9.25(2026년 10월 22일).");
    assert.equal(chartSummary({ ...meta, unit: "%" }, [["2026-09", 2.1]]), "가짜 지수: 2026년 9월 값 하나, 2.10%.");
    assert.equal(chartSummary(meta, []), "가짜 지수: 이 기간에 값이 없다.");
  });

  test("그래프: 축의 처음·끝 날짜, 가로 눈금선, 보조 기술용 슬라이더와 요약", () => {
    const pts: IndicatorPoint[] = [
      ["2026-10-20", 10],
      ["2026-10-21", 14.5],
      ["2026-10-23", 11],
    ];
    const html = renderToStaticMarkup(h(LineChart, { meta: { name: "가짜 지수", unit: "", decimals: 2 }, points: pts, height: 200, grid: true }));
    assert.match(html, /role="slider" tabindex="0" aria-label="가짜 지수 그래프, 날짜 고르기" aria-valuemin="0" aria-valuemax="2" aria-valuenow="2" aria-valuetext="2026년 10월 23일 11.00"/);
    assert.match(html, />2026\.10\.20<\/text>/);
    assert.match(html, />2026\.10\.23<\/text>/);
    assert.equal(html.match(/<line /g)?.length, 4, "가로 눈금선 4개");
    assert.match(html, /<p id="[^"]+" class="sr-only">가짜 지수: 2026년 10월 20일부터/);
    const g = chartGeometry(pts, { width: 300, height: 200, padX: 4, padTop: 14, padBottom: 18 });
    assert.equal(g.xs[0], 4);
    assert.equal(g.xs[2], 296);
    assert.equal(g.ys[1], 14, "최고는 위 끝");
    assert.equal(g.ys[0], 182, "최저는 아래 끝");
    assert.equal(nearestIndex(150, 3, { width: 300, height: 200, padX: 4, padTop: 14, padBottom: 18 }), 1);
    assert.equal(nearestIndex(-20, 3, { width: 300, height: 200, padX: 4, padTop: 14, padBottom: 18 }), 0);
    // 같은 값뿐이어도 그린다
    assert.ok(chartGeometry([["a", 2], ["b", 2]], { width: 100, height: 50, padX: 0, padTop: 0, padBottom: 0 }).ys.every((y) => y === 25));
    // 값이 하나뿐이면 눈금 숫자가 모두 같아지므로 한 번만 쓴다
    const one = renderToStaticMarkup(h(LineChart, { meta: { name: "가짜 지수", unit: "%", decimals: 1 }, points: [["2026-09", 1.5]], height: 200, grid: true }));
    assert.equal(one.match(/class="ax">1\.5</g)?.length, 1, "같은 눈금 숫자는 한 번");
  });

  test("키보드로 날짜 옮기기: 처음엔 마지막 값, ←→ 하루, Home·End, PageUp·PageDown", () => {
    assert.equal(moveIndex(null, "ArrowLeft", 100), 99);
    assert.equal(moveIndex(50, "ArrowLeft", 100), 49);
    assert.equal(moveIndex(99, "ArrowRight", 100), 99);
    assert.equal(moveIndex(50, "Home", 100), 0);
    assert.equal(moveIndex(50, "End", 100), 99);
    assert.equal(moveIndex(50, "PageDown", 100), 40);
    assert.equal(moveIndex(95, "PageUp", 100), 99);
    assert.equal(moveIndex(5, "a", 100), 5);
    assert.equal(moveIndex(null, "ArrowLeft", 0), null);
  });

  test(`관련 이슈가 많으면 처음 ${RELATED_FIRST}개만, 더 보기로 나머지`, () => {
    const issues = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `가짜 이슈 ${i + 1}` }));
    assert.deepEqual(relatedShown(issues, false), { shown: issues.slice(0, RELATED_FIRST), more: 3 });
    assert.deepEqual(relatedShown(issues, true), { shown: issues, more: 0 });
    assert.deepEqual(relatedShown(issues.slice(0, 5), false), { shown: issues.slice(0, 5), more: 0 });
  });
});

describe("4.7-4 이슈 페이지의 그래프", () => {
  const pts: IndicatorPoint[] = [
    ["2026-09-25", 70],
    ["2026-09-28", 71],
    ["2026-09-29", 72],
    ["2026-10-02", 73],
  ];
  test("그래프 기간 안의 값만, 점은 뉴스 날(휴장일이면 앞의 가장 가까운 값), 첫 값보다 앞의 날은 빠지고 같은 위치는 하나", () => {
    assert.deepEqual(issueGraphPoints(pts, "2026-09-28", "2026-10-02").map((p) => p[0]), ["2026-09-28", "2026-09-29", "2026-10-02"]);
    // 09-27(일), 09-26(토)은 09-25 위치, 10-01은 09-29 위치, 09-01은 첫 값 앞
    assert.deepEqual(dotIndexes(pts, ["2026-09-01", "2026-09-26", "2026-09-27", "2026-09-29", "2026-10-01", "2026-10-02"]), [0, 2, 3]);
    assert.deepEqual(dotIndexes(pts, ["2026-09-01", "2026-09-24"]), [], "첫 값 앞의 날만 있으면 점이 없다(첫 값 위치에 찍지 않는다)");
    // 월별: 그 달 값(그 달 날짜 이하)
    const monthly: IndicatorPoint[] = [
      ["2026-08", 2],
      ["2026-09", 2.1],
    ];
    assert.deepEqual(dotIndexes(monthly, ["2026-09-14", "2026-10-20", "2026-08-01"]), [0, 1]);
  });
});

describe("4.7-6 출처 표시와 FRED 고지", () => {
  test("FRED 약관 고지·약관 주소·동의 한 줄", () => {
    assert.equal(FRED_NOTICE, "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis.");
    assert.equal(FRED_TERMS_URL, "https://fred.stlouisfed.org/docs/api/terms_of_use.html");
    assert.equal(FRED_AGREEMENT, "이 사이트를 이용하면 FRED® API 이용 약관을 따르는 것으로 본다.");
    const html = renderToStaticMarkup(h(FredNotice));
    assert.ok(html.includes(FRED_NOTICE));
    assert.match(html, /<a href="https:\/\/fred\.stlouisfed\.org\/docs\/api\/terms_of_use\.html" class="text-link" target="_blank" rel="noopener noreferrer"/);
  });

  test("출처는 겹치지 않게, 하나면 한 줄, 여럿이면 출처마다 지표 이름", () => {
    const metas = [
      { name: "가", credit: "자료: 한국은행 ECOS(작성기관: 한국은행)" },
      { name: "나", credit: "미국 에너지정보청 via FRED" },
      { name: "다", credit: "자료: 한국은행 ECOS(작성기관: 한국은행)" },
    ];
    assert.deepEqual(creditsOf(metas), [
      { credit: "자료: 한국은행 ECOS(작성기관: 한국은행)", names: ["가", "다"] },
      { credit: "미국 에너지정보청 via FRED", names: ["나"] },
    ]);
    assert.equal(renderToStaticMarkup(h(SourceNote, { metas: [metas[1]!] })), '<p class="isrc">미국 에너지정보청 via FRED</p>');
    assert.match(renderToStaticMarkup(h(SourceNote, { metas })), /<li>자료: 한국은행 ECOS\(작성기관: 한국은행\): 가, 다<\/li>/);
    assert.equal(renderToStaticMarkup(h(SourceNote, { metas: [] })), "");
  });
});

describe("4.7-7 지표 주소", () => {
  test("깔끔한 경로, 식별자는 짧은 영어 소문자·숫자, 그 밖은 없는 페이지", () => {
    assert.deepEqual(parseRoute("/indicators"), { name: "indicators" });
    assert.deepEqual(parseRoute("/indicators/"), { name: "indicators" });
    assert.deepEqual(parseRoute("/indicators/usdkrw"), { name: "indicator", id: "usdkrw" });
    assert.deepEqual(parseRoute("/indicators/us10y"), { name: "indicator", id: "us10y" });
    assert.deepEqual(parseRoute("/indicators/USDKRW"), { name: "notFound" });
    assert.deepEqual(parseRoute("/indicators/usd-krw"), { name: "notFound" });
    assert.deepEqual(parseRoute("/indicators/a/b"), { name: "notFound" });
    assert.equal(indicatorsPath(), "/indicators");
    assert.equal(indicatorPath("wti"), "/indicators/wti");
    assert.equal(focusTargetId({ name: "indicator", id: "wti" }), "main");
    assert.equal(selfScrolls({ name: "indicators" }), false);
  });

  test("직접 열거나 새로 고쳐도 화면 틀(대체 경로), 데이터 파일 주소는 사이트 데이터 이름과 같다", () => {
    const exists = (p: string) => p === "indicators.html" || p === "indicators/usdkrw.html";
    assert.deepEqual(resolveStatic("/indicators", exists), { kind: "file", path: "indicators.html" });
    assert.deepEqual(resolveStatic("/indicators/usdkrw", exists), { kind: "file", path: "indicators/usdkrw.html" });
    assert.deepEqual(resolveStatic("/site-data/indicator-none.json", exists), { kind: "notFound", path: "404.html" });
    assert.equal(dataUrl.indicatorList(), `/site-data/${siteFiles.indicatorList}`);
    assert.equal(dataUrl.indicatorSeries("wti"), `/site-data/${siteFiles.indicatorSeries("wti")}`);
  });
});

describe("4.7-9 색 대비(오름·내림 글자 4.5:1, 그래프 선·점 3:1)", () => {
  for (const [name, p] of [
    ["라이트", LIGHT],
    ["다크", DARK],
  ] as const) {
    test(name, () => {
      const text = textPairs(p).filter((x) => x.name.startsWith("오름") || x.name.startsWith("내림"));
      assert.equal(text.length, 4);
      for (const pair of text) assert.ok(contrast(pair.fg, pair.bg) >= 4.5, `${pair.name} ${contrast(pair.fg, pair.bg).toFixed(2)}`);
      const icons = iconPairs(p).filter((x) => x.name.startsWith("그래프"));
      assert.equal(icons.length, 2);
      for (const pair of icons) assert.ok(contrast(pair.fg, pair.bg) >= 3, `${pair.name} ${contrast(pair.fg, pair.bg).toFixed(2)}`);
    });
  }
});

describe("4.7-9 지어낸 데이터의 지표", () => {
  const fx = generateFixtures({ end: "2026-10-27", days: 30, schedules: 60, indicators: 5 });
  const json = <T>(name: string) => JSON.parse(fx.files.get(`site-data/${name}`)!) as T;
  const list = json<IndicatorList>(siteFiles.indicatorList);
  const ind = fx.info.indicators!;
  const days = [...fx.files.keys()].filter((k) => k.startsWith("site-data/list-")).flatMap((k) => (JSON.parse(fx.files.get(k)!) as MonthList).days);
  const issues = Object.values(json<IssueChunk>("issue-0.json").issues);

  test("12개 정의 중 공개를 끈 지표는 어디에도 없고, 값 없는 공개 지표는 카드·칩·이슈 그래프에 없다", () => {
    assert.equal(ind.off, "brent");
    assert.equal(ind.empty, "kosdaq");
    assert.equal(list.indicators.length, 11);
    for (const [name, content] of fx.files) assert.ok(!content.includes(`"${ind.off}"`) && !name.includes(ind.off!), `${name}에 공개를 끈 지표`);
    const empty = list.indicators.find((c) => c.id === ind.empty)!;
    assert.equal(empty.last, null);
    assert.ok(!visibleCards(list).some((c) => c.id === ind.empty));
    assert.ok(days.every((d) => !d.indicators?.some((c) => c.id === ind.empty)));
    assert.ok(issues.every((i) => !i.indicators?.some((x) => x.id === ind.empty)));
    assert.deepEqual(json<IndicatorSeries>(siteFiles.indicatorSeries(ind.empty!)).points, []);
  });

  test("5년, 휴장일, 관련 이슈 여러 개(더 보기)와 없는 지표, 그래프 1개·3개인 이슈, 고른 지표가 없는 이슈", () => {
    const usd = json<IndicatorSeries>(siteFiles.indicatorSeries("usdkrw")).points;
    assert.ok(usd[0]![0] > "2021-10-27" && usd[0]![0] < "2021-11-05", usd[0]![0]);
    assert.ok(!usd.some(([d]) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())), "주말 값이 없다");
    assert.ok(ind.mostRelated.count > RELATED_FIRST);
    assert.ok(ind.noRelated !== null);
    assert.ok(ind.issueOne !== null && ind.issueThree !== null);
    assert.ok(issues.some((i) => !i.indicators));
    assert.ok(ind.krHoliday !== null);
    const hol = days.find((d) => d.date === ind.krHoliday)!;
    assert.ok(hol.indicators!.find((c) => c.id === "usdkrw")!.date < ind.krHoliday!, "휴장일에는 앞 날짜 값");
  });

  test("상자의 칩은 그 브리프 날짜 이하의 가장 최근 값과 바로 앞 값 대비, 순서는 원/달러·코스피·미국채 10년·WTI부터", () => {
    for (const d of days) {
      const row = d.indicators!;
      assert.deepEqual(row.slice(0, 4).map((c) => c.id), ["usdkrw", "kospi", "us10y", "wti"]);
      for (const c of row) {
        const pts = json<IndicatorSeries>(siteFiles.indicatorSeries(c.id)).points;
        const i = pts.findLastIndex(([date]) => date <= d.date);
        assert.equal(c.date, pts[i]![0]);
        assert.equal(c.value, pts[i]![1]);
        assert.ok(c.change !== null);
      }
    }
  });

  test("이슈의 점은 타임라인(흡수된 이슈의 전개가 합쳐진 것)의 날짜이고, 그래프는 이슈 시작일 30일 전부터다", () => {
    const merged = fx.info.merged!;
    const survivor = issues.find((i) => i.id === merged.into)!;
    assert.ok(survivor.indicators?.length, "남는 이슈가 지표를 골랐다");
    const ii = survivor.indicators![0]!;
    const pts = issueGraphPoints(json<IndicatorSeries>(siteFiles.indicatorSeries(ii.id)).points, ii.from, ii.to);
    assert.equal(ii.from, new Date(Date.parse(`${survivor.startDate}T00:00:00Z`) - 30 * 86400000).toISOString().slice(0, 10));
    assert.equal(pts[0]![0] >= ii.from, true);
    assert.equal(pts.at(-1)![0], ii.to);
    assert.equal(dotIndexes(pts, survivor.timeline.map((t) => t.date)).length > 0, true);
  });
});

describe("4.6-2 지표를 더한 5년치", () => {
  test("브리프 첫 화면(새 상자 포함)·지표 페이지·지표 하나의 페이지가 처음 받는 데이터가 각각 gzip 300KB 이하다", async () => {
    // 5단계 측정 조건(1,826일, 하루 42건, 이슈·대상 15,000개, 용어 5,000개, 일정 15,000개)에 지표 12개 × 5년, 이슈의 2할이 지표 1~3개
    const work = tempDir("tidwyn-site6y-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    writeFixtures(dataDir, { end: "2026-10-31", days: 1826, top: 6, short: 8, issues: 15000, contiguous: true, entities: 15000, terms: 5000, schedules: 15000, indicators: 5, indicatorsAll: true });
    const res = await buildSite({ dataDir, outDir: out });
    console.log(`5년치 결과물 ${res.files.length}개, ${(res.bytes / 1024 / 1024).toFixed(1)}MB`);
    const list = JSON.parse(fs.readFileSync(path.join(out, "site-data", siteFiles.indicatorList), "utf8")) as IndicatorList;
    assert.equal(visibleCards(list).length, 12);
    assert.match(fs.readFileSync(path.join(out, pageFile("/indicators")), "utf8"), /값은 이 화면에 싣지 않는다/, "값을 싣지 않는 줄에 까닭을 적는다");
    const issueChunk = JSON.parse(fs.readFileSync(path.join(out, "site-data", "issue-0.json"), "utf8")) as IssueChunk;
    const withInd = Object.values(issueChunk.issues).filter((i) => i.indicators?.length).length;
    assert.ok(withInd >= 15 && withInd <= 25, `이슈 100개 중 지표가 있는 것 ${withInd}개(약 2할)`);
    const latest = (JSON.parse(fs.readFileSync(path.join(out, "site-data", "list-2026-10.json"), "utf8")) as MonthList).days.at(-1)! as DayList;
    assert.ok(latest.indicators && latest.indicators.length >= 10 && latest.week, "가장 최근 날짜에 일정과 지표 칩이 있다");
    const size = measureOutput(out);
    assert.ok(size.firstScreen.gzip <= FIRST_SCREEN_BUDGET, `브리프 첫 화면 gzip ${size.firstScreen.gzip}B`);
    const screens = measureIndicatorScreens(out);
    assert.equal(screens.length, 2);
    assert.equal(screens[1]!.files.length, 2);
    for (const sc of screens) assert.ok(sc.gzip <= FIRST_SCREEN_BUDGET, `${sc.name} gzip ${sc.gzip}B`);
  });
});
