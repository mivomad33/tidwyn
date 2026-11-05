// 9.97단계 사이트(4.4-1~4.4-3, 4.4-4의 표시와 lastmod, 4.5-2의 사이트 쪽): 공개 칸만 내보내기, 탭·해시·읽음 규칙, 글자, 소개의 출처 목록,
// 정적 HTML·RSS·검색 색인, sitemap, 결과물 검사. 데이터는 모두 지어낸 것이다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSite, SEARCH_RECORDS_FILE } from "../site/build.ts";
import { generateFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { RSS_FILE } from "../site/feeds.ts";
import { AboutDemand } from "../site/src/components/demandView.ts";
import { DEMAND_TAB, briefTabs, parseBriefTab, stateForHash } from "../site/src/lib/brief.ts";
import { BUILDER_TAB } from "../site/src/lib/builder.ts";
import { TOP_LIST_NOTE, demandMissingText, demandTabLabel, demandZeroText, flowLevelText, flowPeriod, flowUnitHead, flowUnitNumbers, flowUnitPeriod } from "../site/src/lib/demand.ts";
import { dataUrl } from "../site/src/lib/paths.ts";
import { createReadStore } from "../site/src/lib/readMarks.ts";
import { matchDemandItems, parseHit } from "../site/src/lib/search.ts";
import { MAJORS } from "../src/categories.ts";
import { correctFlow, flowsOfDate, saveFlows, setFlowDate, type NewFlow } from "../src/demandFlowStore.ts";
import { AUX_GROUPS, FLOW_CAVEAT, GROUP_INFO, OFFICIAL_GROUPS, flowItemKey, flowKeyPosition, isFlowItemKey } from "../src/demandFlowTypes.ts";
import { BACKUP_NAME_RE } from "../src/precheck.ts";
import { checkBuiltSite, checkOutput } from "../src/siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { DEMAND_ITEMS_FILE_RE, siteFiles, type DayList, type DemandMonth, type MonthList, type SiteFlowItem, type SiteFlowUnit } from "../src/siteTypes.ts";
import { env } from "./builderFixtures.ts";
import { FAKE_ACCOUNT, FAKE_AUTHOR, FAKE_LINK_TITLE, FAKE_TAG, FAKE_TERM } from "./demandFixtures.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";
import { TEXTS as OFFICIAL_TEXTS } from "./officialFixtures.ts";

after(cleanupTemp);

const DAY = "2026-10-27";
const PREV = "2026-10-25";
const EMPTY = "2026-10-26";
const TITLE = "가짜 흐름 공개지어낸제목QDT";
const SUMMARY = "가짜 흐름 지어낸요지QDS가 함께 보였다.";
const REASON = "가짜 잇는 이유QDR다.";
const KEY_TEXT = "가짜단위키QDK";
const dataFile = (name: string) => `site-data/${name}`;

const unit = (over: Partial<NewFlow["units"][number]> = {}): NewFlow["units"][number] => ({
  group: "wikimedia",
  source: "wikimedia:ko",
  unitKey: `wikimedia:ko:${KEY_TEXT}`,
  unitName: "가짜 위키 문서",
  recent: 1200,
  base: 300.5,
  isNew: false,
  recentFrom: "2026-10-20",
  recentTo: "2026-10-26",
  baseFrom: "2026-09-22",
  baseTo: "2026-10-19",
  recentDays: 7,
  baseDays: 28,
  ...over,
});

const flow = (over: Partial<NewFlow> = {}): NewFlow => ({
  flowId: "",
  category: "interest",
  field: "health",
  title: TITLE,
  summary: SUMMARY,
  reason: REASON,
  level: "medium",
  aux: [],
  issue: null,
  continues: null,
  units: [unit(), unit({ group: "ftc1372", source: "ftc1372:consult", unitKey: "ftc1372:consult:x", unitName: "의약품 > 가짜약", recent: 60, base: 20, recentFrom: "2026-10-05", recentTo: "2026-10-11", baseFrom: "2026-09-07", baseTo: "2026-10-04" })],
  ...over,
});

/** 흡수된 이슈 하나, 앞 날짜 흐름 하나, 대상 날짜 흐름 둘(하나는 앞 흐름을 잇고 외부인 글 소스와 보조 근거를 쓴다), 0건 날짜, 정정 하나 */
function seeded() {
  const e = env(PREV, EMPTY, DAY);
  e.db.prepare("INSERT INTO issues (id, name, aliases, major, minor, is_new_minor, status, summary) VALUES (1, '가짜 남는 이슈', '[]', ?, '가짜', 1, '진행 중', '가짜 요약')").run(MAJORS[0]!);
  e.db.prepare("INSERT INTO issues (id, name, aliases, major, minor, is_new_minor, status, summary, merged_into) VALUES (2, '가짜 흡수된 이슈', '[]', ?, '가짜', 1, '진행 중', '가짜 요약', 1)").run(MAJORS[0]!);
  saveFlows(e.db, PREV, [flow({ title: "가짜 앞 흐름" })], { date: PREV, status: "checked", missing: [] });
  const prev = flowsOfDate(e.db, PREV)[0]!;
  setFlowDate(e.db, { date: EMPTY, status: "checked", missing: [] });
  saveFlows(
    e.db,
    DAY,
    [
      flow({ flowId: prev.flowId, continues: prev.id, level: "strong", issue: 2, aux: ["Google Trends KR", "Mastodon mastodon.example"], units: [unit(), unit({ group: "acrc", source: "acrc:qna", unitKey: "acrc:qna:y", unitName: null, recent: 9, base: 2 })] }),
      flow({ category: "money", field: "investment", title: "가짜 돈의 흐름", units: [unit({ group: "dart", source: "dart:list", unitKey: "dart:list:z", unitName: "가짜 공시 종류", recent: 30, base: 10 }), unit({ group: "sec", source: "sec:formd", unitKey: "sec:formd:w", unitName: "Fake Industry", recent: 40, base: 12 })] }),
    ],
    { date: DAY, status: "checked", missing: ["assembly"] },
  );
  return e;
}

const monthOf = (files: Map<string, string>, month: string) => JSON.parse(files.get(dataFile(siteFiles.demandItems(month)))!) as DemandMonth;
const dayOf = (files: Map<string, string>, date: string) => (JSON.parse(files.get(dataFile(siteFiles.list(date.slice(0, 7))))!) as MonthList).days.find((d) => d.date === date)!;

describe("4.4-1 사이트 데이터", () => {
  test("항목은 달 파일에 공개 칸만 있고, 달 목록에는 수·상태·빠진 묶음만 있으며 단위 키와 영구 id는 어디에도 없다", () => {
    const e = seeded();
    const files = buildSiteData(e.db);
    const [x, y] = monthOf(files, "2026-10").days[DAY]!;
    assert.deepEqual(Object.keys(x!).sort(), ["aux", "category", "continues", "field", "issue", "key", "level", "reason", "sources", "summary", "title", "units"]);
    assert.equal(x!.key, flowItemKey(1));
    assert.equal(y!.key, flowItemKey(2));
    assert.deepEqual(Object.keys(x!.units[0]!).sort(), ["base", "baseDays", "baseFrom", "baseTo", "group", "isNew", "name", "recent", "recentDays", "recentFrom", "recentTo", "source", "topList", "unit"]);
    assert.deepEqual(dayOf(files, DAY).demand, { count: 2, status: "checked", missing: ["assembly"] });
    assert.deepEqual(dayOf(files, EMPTY).demand, { count: 0, status: "checked" });
    const listText = files.get(dataFile(siteFiles.list("2026-10")))!;
    assert.ok(!listText.includes(TITLE), "달 목록에 항목 글이 없다");
    for (const [n, c] of files) for (const s of [KEY_TEXT, "acrc:qna:y", `${PREV}-1`]) assert.ok(!c.includes(s), `${n}: ${s}`);
  });

  test("이어짐은 앞 항목의 날짜와 키, 관련 이슈는 남는 이슈, 외부인 글 소스는 이름 없음, 위키는 상위 목록 표시, 출처는 공식 공개 페이지와 보조 근거의 출처다", () => {
    const e = seeded();
    const [x] = monthOf(buildSiteData(e.db), "2026-10").days[DAY]!;
    assert.deepEqual(x!.continues, { date: PREV, key: "demand-1" });
    assert.deepEqual(x!.issue, { id: 1, name: "가짜 남는 이슈" });
    assert.equal(x!.units[1]!.name, null);
    assert.equal(x!.units[1]!.source, "민원정책 질의응답");
    assert.equal(x!.units[0]!.topList, true);
    assert.equal(x!.units[0]!.unit, "회 조회");
    assert.deepEqual(x!.sources, [
      { name: "Wikimedia ko.wikipedia", url: "https://ko.wikipedia.org/" },
      { name: "국민권익위원회 민원정책 질의응답", url: "https://www.data.go.kr/data/15074671/openapi.do" },
      { name: "Google Trends", url: GROUP_INFO.google.url },
      { name: "Mastodon", url: GROUP_INFO.mastodon.url },
    ]);
    assert.deepEqual(x!.aux, ["Google Trends KR", "Mastodon mastodon.example"]);
  });

  test("소스가 하나뿐인 묶음의 출처 칩은 기관 이름이고, 묶음 이름이 기관 이름으로 시작하지 않으면 묶음 이름을 붙여 근거 줄과 이어진다", () => {
    const e = seeded();
    const [, y] = monthOf(buildSiteData(e.db), "2026-10").days[DAY]!;
    assert.deepEqual(y!.sources.map((s) => s.name), ["DART", "SEC EDGAR"]);
    const [z] = monthOf(buildSiteData(e.db), "2026-10").days[PREV]!;
    assert.equal(z!.sources[1]!.name, "공정거래위원회 1372 소비자상담");
  });

  test("기록이 없는 날과 꺼짐만 있는 날은 demand 칸이 없고, 흐름이 전혀 없으면 파일도 없다. 기준 부족·받지 못함은 수 0과 상태다", () => {
    const e = env("2026-10-24", "2026-10-25", "2026-10-26", DAY);
    setFlowDate(e.db, { date: "2026-10-25", status: "off", missing: [] });
    setFlowDate(e.db, { date: "2026-10-26", status: "short", missing: ["sec"] });
    setFlowDate(e.db, { date: DAY, status: "failed", missing: [] });
    const files = buildSiteData(e.db);
    assert.ok(![...files.keys()].some((k) => DEMAND_ITEMS_FILE_RE.test(path.basename(k))));
    assert.equal(dayOf(files, "2026-10-24").demand, undefined);
    assert.equal(dayOf(files, "2026-10-25").demand, undefined);
    assert.deepEqual(dayOf(files, "2026-10-26").demand, { count: 0, status: "short" });
    assert.deepEqual(dayOf(files, DAY).demand, { count: 0, status: "failed" });
  });

  test("정정은 날짜와 사유만 최신순으로 나간다", () => {
    const e = seeded();
    const id = flowsOfDate(e.db, DAY)[1]!.id;
    correctFlow(e.db, id, { title: "가짜 고친 제목" }, ["title"], "제목을 바로잡았다.", "2026-10-28");
    correctFlow(e.db, id, { summary: "가짜 고친 요지다." }, ["summary"], "요지를 바로잡았다.", "2026-10-29");
    const y = monthOf(buildSiteData(e.db), "2026-10").days[DAY]![1]!;
    assert.equal(y.title, "가짜 고친 제목");
    assert.deepEqual(y.corrections, [
      { on: "2026-10-29", reason: "요지를 바로잡았다." },
      { on: "2026-10-28", reason: "제목을 바로잡았다." },
    ]);
  });

  test("검색 레코드는 달마다 하나이고 제목·요지·분야·소스 이름이 있으며 잇는 이유와 단위 키는 없고 수요 달 레코드로 풀린다", () => {
    const e = seeded();
    const records = buildSearchRecords(e.db).filter((r) => r.meta?.kind === "demand");
    assert.equal(records.length, 1);
    const c = records[0]!.content;
    for (const s of [TITLE, SUMMARY, "의료·건강", "Wikimedia 인기 문서 · ko.wikipedia", "권익위 민원 · 민원정책 질의응답", "1372 소비자상담"]) assert.ok(c.includes(s), s);
    for (const s of [REASON, KEY_TEXT]) assert.ok(!c.includes(s), s);
    assert.deepEqual(parseHit(records[0]!.url, records[0]!.meta), { kind: "demand", month: "2026-10" });
    assert.deepEqual(parseHit("/demand/month/2026-10", undefined), { kind: "demand", month: "2026-10" });
  });

  test("4.5-2: 전용 DB 원문, 작업 파일 글, 외부인 글, 급상승어·태그가 사이트 데이터·검색 레코드·결과물에 없다(흐름이 외부인 글 소스와 보조 근거를 쓴 경우)", async () => {
    const e = seeded();
    const raw = [FAKE_TERM, FAKE_TAG, FAKE_LINK_TITLE, FAKE_AUTHOR, FAKE_ACCOUNT, ...OFFICIAL_TEXTS];
    fs.writeFileSync(path.join(e.dataDir, "demand.db"), raw.join("\n"));
    fs.mkdirSync(path.join(e.dataDir, "work"), { recursive: true });
    fs.writeFileSync(path.join(e.dataDir, "work", "demand.flow.candidates.json"), JSON.stringify(raw));
    const input = tempDir();
    for (const [rel, content] of buildSiteData(e.db)) {
      fs.mkdirSync(path.dirname(path.join(input, rel)), { recursive: true });
      fs.writeFileSync(path.join(input, rel), content);
    }
    fs.writeFileSync(path.join(input, SEARCH_RECORDS_FILE), JSON.stringify(buildSearchRecords(e.db)));
    const out = tempDir();
    await buildSite({ dataDir: input, outDir: out });
    const texts: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else texts.push(fs.readFileSync(p, "latin1") + fs.readFileSync(p, "utf8"));
      }
    };
    walk(input);
    walk(out);
    assert.ok(texts.some((t) => t.includes(TITLE)), "흐름 글은 실린다");
    for (const s of raw) assert.ok(!texts.some((t) => t.includes(s)), s);
  });
});

describe("4.4-1 화면 규칙", () => {
  const day = { date: DAY, sections: [{ name: "한국", stories: [] }], builder: { count: 0, status: "checked" }, demand: { count: 0, status: "checked" } } as unknown as DayList;

  test("탭: 기록이 있으면 빌더 다음 끝에, 없으면 없다. 해시와 기억 값을 읽는다", () => {
    assert.deepEqual(briefTabs(day, DAY).tabs.slice(-2), [BUILDER_TAB, DEMAND_TAB]);
    assert.ok(!briefTabs({ ...day, demand: undefined } as DayList, DAY).tabs.includes(DEMAND_TAB));
    assert.equal(parseBriefTab(DEMAND_TAB), DEMAND_TAB);
    assert.equal(demandTabLabel(0), "수요 0");
    const state = { section: "한국", major: null, expanded: null } as Parameters<typeof stateForHash>[2];
    assert.equal(stateForHash(day, "demand", state).section, DEMAND_TAB);
    assert.equal(stateForHash(day, "demand-2", state).section, DEMAND_TAB);
    assert.equal(stateForHash(day, "demand-0", state).section, "한국");
  });

  test("항목 키 규칙이 맞고, 수요 항목의 읽음은 날짜별 읽은 수에 세지 않는다", () => {
    for (const k of ["demand-1", "demand-12"]) assert.equal(isFlowItemKey(k), true, k);
    for (const k of ["demand-0", "demand-", "builder-1", "demand-1a", 3]) assert.equal(isFlowItemKey(k), false, String(k));
    assert.ok(isFlowItemKey(flowItemKey(3)));
    assert.equal(flowKeyPosition(flowItemKey(12)), 12);
    const store = createReadStore(null, DAY);
    store.setRead(DAY, "demand-1", true);
    store.setRead(DAY, "한국-top-1", true);
    assert.equal(store.isRead(DAY, "demand-1"), true);
    assert.equal(store.readCount(DAY), 1);
  });

  test("날짜 상태 문구와 빠진 묶음 안내", () => {
    assert.equal(demandZeroText("checked"), "이날은 서로 다른 소스 두 곳 이상에서 함께 보인 흐름이 없다.");
    assert.equal(demandZeroText("short"), "비교할 기록이 아직 모자라 흐름을 정리하지 않았다.");
    assert.equal(demandZeroText("failed"), "이날의 수요 흐름을 정리하지 못했다.");
    assert.equal(demandMissingText(["assembly", "sec"]), "이날 비교에 넣지 못한 소스: 국회 청원, SEC Form D");
    assert.equal(demandMissingText(undefined), null);
  });

  const u = (over: Partial<SiteFlowUnit> = {}): SiteFlowUnit => ({ group: "wikimedia", source: "ko.wikipedia", name: "가짜 문서", recent: 412345, base: 98765.4, isNew: false, recentFrom: "2026-10-20", recentTo: "2026-10-26", baseFrom: "2026-09-22", baseTo: "2026-10-19", recentDays: 7, baseDays: 28, unit: "회 조회", ...over });

  test("근거 줄: 이름, 원래 숫자 두 개, 자료 없음 날의 날 수, 창 기간, 외부인 글 소스의 이름 없음", () => {
    assert.equal(flowUnitHead(u()), "Wikimedia 인기 문서 · ko.wikipedia · 가짜 문서");
    assert.equal(flowUnitHead(u({ group: "assembly", source: "국민동의청원 접수목록(22대)", name: null })), "국회 청원 · 국민동의청원 접수목록(22대)");
    assert.equal(flowUnitHead(u({ group: "ftc1372", source: "", name: "여행 > 항공" })), "1372 소비자상담 · 여행 > 항공");
    assert.equal(flowUnitNumbers(u()), "최근 7일 412,345회 조회 · 앞 28일의 7일 평균 98,765.4회 조회");
    assert.equal(flowUnitNumbers(u({ recentDays: 6, baseDays: 26, recent: 10, base: 2, unit: "건" })), "최근 7일 중 자료 있는 6일 10건 · 앞 28일 중 자료 있는 26일의 6일 평균 2건");
    assert.equal(flowUnitNumbers(u({ recent: 5, base: 0, isNew: true, unit: "건" })), "최근 7일 5건 · 앞 28일의 7일 평균 0건 · 앞 28일에는 없었다");
    assert.equal(flowUnitPeriod(u()), "최근 10월 20일~26일 · 앞 9월 22일~10월 19일");
    assert.ok(TOP_LIST_NOTE.includes("목록에 든 날의 합"));
  });

  test("근거 수준 줄과 항목 끝 창 기간(가장 이른 시작~가장 늦은 끝)", () => {
    assert.equal(flowLevelText("medium"), "근거 중 · 서로 다른 공식 소스 두 곳에서 함께 올랐다");
    assert.equal(flowPeriod([u({ group: "ftc1372", baseFrom: "2026-09-01", recentTo: "2026-10-05" }), u({ baseFrom: "2026-09-22", recentTo: "2026-10-26" })]), "9월 1일~10월 26일");
  });

  test("검색: 달 파일에서 맞는 항목을 고른다", () => {
    const item = (key: string, title: string) => ({ key, title, summary: "x", field: "health", units: [] }) as unknown as SiteFlowItem;
    const file: DemandMonth = { month: "2026-10", days: { [DAY]: [item("demand-1", "가짜감기 흐름"), item("demand-2", "다른 흐름")] } };
    assert.deepEqual(matchDemandItems(file, ["가짜감기"]).map((x) => x.item.key), ["demand-1"]);
  });

  test("화면이 받는 주소와 빌드가 쓰는 파일 이름이 같고, 백업 이름과 겹치지 않는다", () => {
    const name = siteFiles.demandItems("2026-10");
    assert.ok(dataUrl.demandItems("2026-10").endsWith(`/${name}`));
    assert.ok(DEMAND_ITEMS_FILE_RE.test(name));
    assert.ok(!BACKUP_NAME_RE.test(name));
  });
});

describe("4.4-2 소개", () => {
  test("수요 절의 출처 이름 목록이 코드의 묶음 목록과 같고, 고정 문구와 공공누리 2유형 표시가 있다", () => {
    const html = renderToStaticMarkup(h(AboutDemand));
    assert.ok(html.includes('id="demand"'));
    const credits = html.match(/<p class="p demand-credits">([\s\S]*?)<\/p>/)![1]!;
    const names = [...credits.matchAll(/<span class="credit">([^<]*)<\/span>/g)].map((m) => m[1]);
    assert.deepEqual(names, [...OFFICIAL_GROUPS, ...AUX_GROUPS].map((g) => GROUP_INFO[g].credit));
    assert.ok(html.includes(FLOW_CAVEAT));
    assert.ok(html.includes("공공누리 제2유형"));
    for (const s of ["두 곳 이상", "최근 7일", "28일", "AI 판단", "기계가", "하루 이틀 늦", "일부 사람", "원본"]) assert.ok(html.includes(s), s);
  });
});

/** 결과물의 Pagefind를 Node에서 불러 검색한다(file: 주소는 디스크에서 읽는다) */
async function searchOutput(outDir: string, query: string): Promise<{ url: string; meta: Record<string, string> }[]> {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith("file:")) throw new Error(`네트워크 요청 금지: ${url}`);
    return new Response(fs.readFileSync(fileURLToPath(url.split("?")[0]!)));
  }) as typeof fetch;
  try {
    const pf = (await import(pathToFileURL(path.join(outDir, "pagefind", "pagefind.js")).href)) as {
      options: (o: object) => Promise<void>;
      init: () => Promise<void>;
      search: (q: string) => Promise<{ results: { data: () => Promise<{ url: string; meta: Record<string, string> }> }[] }>;
    };
    await pf.options({});
    await pf.init();
    return await Promise.all((await pf.search(query)).results.map((r) => r.data()));
  } finally {
    globalThis.fetch = realFetch;
  }
}

async function build(fx: Fixture, work: string): Promise<string> {
  const dataDir = path.join(work, "data");
  const out = path.join(work, "out");
  for (const [rel, content] of fx.files) {
    fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dataDir, rel), content);
  }
  await buildSite({ dataDir, outDir: out });
  return out;
}

describe("4.4-3 정적 HTML·RSS·검색", () => {
  const options = { end: "2026-10-27", days: 18, contiguous: true, builder: true, videos: true };
  let out = "";
  let plain = "";
  let fx: Fixture;
  const read = (rel: string) => fs.readFileSync(path.join(out, rel), "utf8");
  const items = (date: string) => (JSON.parse(fx.files.get(`site-data/${siteFiles.demandItems(date.slice(0, 7))}`)!) as DemandMonth).days[date]!;
  const locs = (dir: string) => [...fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
  const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

  before(async () => {
    fx = generateFixtures({ ...options, demand: true });
    out = await build(fx, tempDir());
    plain = await build(generateFixtures(options), tempDir());
  });

  test("브리프 정적 HTML에 수요 구역과 항목의 칸이 정해진 순서로 있고, 상태 문구와 안내, 이어짐·정정 표시가 있다", () => {
    const d = fx.info.demand!;
    const html = read(`${d.three}.html`);
    assert.ok(html.includes('id="demand"') && html.includes(">수요<"));
    assert.ok(html.includes(FLOW_CAVEAT));
    assert.ok(html.includes('href="#demand"'), "구역으로 가기");
    for (const x of items(d.three!)) {
      assert.ok(html.includes(`id="${x.key}"`), x.key);
      for (const s of [x.title, x.summary, x.reason, flowLevelText(x.level), ...x.units.map((u) => esc(flowUnitHead(u))), ...x.units.map(flowUnitNumbers)]) assert.ok(html.includes(s), s);
      const block = html.slice(html.indexOf(`id="${x.key}"`));
      const heads = [...block.slice(0, block.indexOf("틀린 내용 알리기")).matchAll(/<h4 class="h">([^<]*)<\/h4>/g)].map((m) => m[1]);
      const want = ["요지", "잇는 이유", "근거", "근거 수준", ...(x.aux.length ? ["보조 근거"] : []), ...(x.continues ? ["이어짐"] : []), ...(x.issue ? ["관련 이슈"] : []), "비교 기간", "출처"];
      assert.deepEqual(heads, want, x.key);
    }
    assert.ok(html.includes("소스를 잇는 것은 AI 판단"));
    assert.ok(read(`${d.zero}.html`).includes(demandZeroText("checked")));
    assert.ok(read(`${d.short}.html`).includes(demandZeroText("short")));
    assert.ok(read(`${d.failed}.html`).includes(`<div class="state error"><p>${demandZeroText("failed")}</p></div>`));
    assert.ok(read(`${d.missing}.html`).includes("이날 비교에 넣지 못한 소스: 국회 청원, SEC Form D"));
    assert.ok(read(`${d.continues}.html`).includes(`href="/${d.origin}#demand-1"`));
    assert.ok(read(`${d.corrected}.html`).includes("정정됨"));
    assert.ok(!read(`${d.noRecord}.html`).includes('id="demand"'));
    assert.ok(!read(`${d.offOnly}.html`).includes('id="demand"'), "꺼짐만 있는 날");
  });

  test("RSS 브리프 항목에 '수요: <제목>' 줄이 들어간다", () => {
    const rss = read(RSS_FILE);
    for (const x of items(fx.info.demand!.three!)) assert.ok(rss.includes(`수요: ${x.title}`), x.title);
  });

  test("검색 색인을 풀면 지어낸 문자열이 수요 달 레코드로 찾아진다", async () => {
    const hits = await searchOutput(out, "가짜보상지어낸요지는");
    const d = hits.find((x) => x.meta.kind === "demand");
    assert.ok(d, JSON.stringify(hits));
    assert.equal(d.meta.month, fx.info.demand!.three!.slice(0, 7));
  });

  test("수요 항목을 넣어도 sitemap 주소가 같고 전용 페이지가 없으며, 정정된 날의 브리프 lastmod는 정정 날짜다", () => {
    assert.deepEqual(locs(out), locs(plain));
    assert.ok(!fs.existsSync(path.join(out, "demand")));
    assert.ok(!fs.existsSync(path.join(out, "demand.html")));
    const xml = fs.readFileSync(path.join(out, "sitemap.xml"), "utf8");
    assert.ok(!xml.includes("/demand"));
    const d = fx.info.demand!;
    const entry = xml.match(new RegExp(`<loc>[^<]*/${d.corrected}</loc>\\s*<lastmod>([^<]*)</lastmod>`));
    assert.equal(entry?.[1], "2026-10-27");
    const plainEntry = fs.readFileSync(path.join(plain, "sitemap.xml"), "utf8").match(new RegExp(`<loc>[^<]*/${d.corrected}</loc>\\s*<lastmod>([^<]*)</lastmod>`));
    assert.equal(plainEntry?.[1], d.corrected, "정정이 없으면 브리프 날짜");
  });

  test("결과물 검사와 공개 페이지 검사를 지나고, 수요 데이터 파일에 메일·홈 경로·키 값을 심으면 그 파일에서 걸린다", () => {
    assert.deepEqual(checkBuiltSite(out, "/Users/fake-home").findings, []);
    const names = fs.readdirSync(path.join(out, "site-data")).filter((n) => n.startsWith("demand"));
    assert.ok(names.length > 0 && names.every((n) => DEMAND_ITEMS_FILE_RE.test(n) && !BACKUP_NAME_RE.test(n)));
    const bad = tempDir();
    fs.cpSync(out, bad, { recursive: true });
    const file = path.join(bad, "site-data", names[0]!);
    const m = JSON.parse(fs.readFileSync(file, "utf8")) as DemandMonth;
    const first = Object.values(m.days)[0]![0]!;
    // 걸리는 메일 값은 이 파일도 공개 전 점검 대상이라 실행할 때 조립한다
    first.summary = `가짜 제보는 ${["fake.person", "gmail.com"].join("@")}로, 원본은 /Users/fake-home/data/demand.db에, 키는 FAKE-SECRET-DEMAND-0001이다.`;
    fs.writeFileSync(file, JSON.stringify(m));
    const kinds = checkOutput(bad, "/Users/fake-home", ["FAKE-SECRET-DEMAND-0001"]).findings.filter((f) => f.where === `site-data/${names[0]}`).map((f) => f.kind);
    for (const k of ["허용 목록 밖 메일 주소", "홈 폴더 절대 경로", "키 값이 들어 있음"]) assert.ok(kinds.includes(k as never), `${k}: ${kinds.join(",")}`);
  });
});
