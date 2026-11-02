// 9.8단계 사이트: 공개 칸만 내보내기, 정적 HTML·RSS·검색 색인, sitemap, 파일 이름, 읽음·탭·일정 링크 규칙, 5년치 크기. 데이터는 모두 지어낸 것이다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildSite } from "../site/build.ts";
import { generateFixtures, writeFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { RSS_FILE } from "../site/feeds.ts";
import { FIRST_SCREEN_BUDGET, measureBuilderScreens, measureOutput } from "../site/size.ts";
import { BUILDER_TAB, briefTabs, parseBriefTab, stateForHash } from "../site/src/lib/brief.ts";
import { dataUrl } from "../site/src/lib/paths.ts";
import { createReadStore } from "../site/src/lib/readMarks.ts";
import { nameLink } from "../site/src/lib/schedules.ts";
import { matchBuilderItems, parseHit } from "../site/src/lib/search.ts";
import { addEmitted, insertBuilderItem, linkItemSchedule, setBuilderStatus } from "../src/builderStore.ts";
import { builderItemKey } from "../src/builderTypes.ts";
import { BACKUP_NAME_RE } from "../src/precheck.ts";
import { createSchedule } from "../src/schedules.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { buildSearchRecords, buildSiteData } from "../src/siteData.ts";
import { BUILDER_ITEMS_FILE_RE, siteFiles, type BuilderMonth, type DayList, type MonthList, type ScheduleMonth } from "../src/siteTypes.ts";
import { TARGET, env, type Env } from "./builderFixtures.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

after(cleanupTemp);

const TITLE = "가짜도구 공개지어낸제목QZX";
const WHAT = "지어낸변경내용QZW가 올라왔다";
const KEY = "eol:가짜키QZK:1";

const dataFile = (name: string) => `site-data/${name}`;

function filled(): { e: Env; id: number } {
  const e = env(TARGET);
  setBuilderStatus(e.db, TARGET, "partial");
  const id = insertBuilderItem(e.db, TARGET, { field: "모델", title: TITLE, whatChanged: WHAT, who: "개발자", action: "없음", why: "이유", due: { date: "2027-01-14", state: "confirmed" }, sources: [{ name: "가짜 문서", url: "https://builder.example.com/a" }], issue: null, reminderOf: null, keys: [KEY] });
  addEmitted(e.db, "row:가짜행QZR", TARGET);
  return { e, id };
}

describe("4.6 사이트 데이터", () => {
  test("항목은 달 파일에 공개 칸만 있고, 달 목록에는 수와 상태만 있다", () => {
    const { e } = filled();
    const files = buildSiteData(e.db);
    const text = files.get(dataFile(siteFiles.builderItems(TARGET.slice(0, 7))))!;
    const month = JSON.parse(text) as BuilderMonth;
    const [x] = month.days[TARGET]!;
    assert.deepEqual(Object.keys(x!).sort(), ["action", "due", "field", "issue", "key", "reminderOf", "schedule", "sources", "title", "whatChanged", "who", "why"]);
    assert.equal(x!.key, builderItemKey(1));
    const list = JSON.parse(files.get(dataFile(siteFiles.list(TARGET.slice(0, 7))))!) as MonthList;
    const day = list.days.find((d) => d.date === TARGET)!;
    assert.deepEqual(day.builder, { count: 1, status: "partial" });
    assert.ok(!files.get(dataFile(siteFiles.list(TARGET.slice(0, 7))))!.includes(TITLE), "달 목록에 항목 글이 없다");
    for (const [n, c] of files) {
      for (const s of [KEY, "가짜키QZK", "가짜행QZR"]) assert.ok(!c.includes(s), `${n}: ${s}`);
    }
  });

  test("기록이 없는 날은 builder 칸이 없고, 빌더가 전혀 없으면 파일도 없다", () => {
    const e = env(TARGET);
    const files = buildSiteData(e.db);
    assert.ok(![...files.keys()].some((k) => BUILDER_ITEMS_FILE_RE.test(path.basename(k))));
    assert.ok(!files.get(dataFile(siteFiles.list(TARGET.slice(0, 7))))!.includes('"builder"'));
  });

  test("확인함·0건 날은 수 0과 상태만 있고 항목 파일이 없다", () => {
    const e = env(TARGET);
    setBuilderStatus(e.db, TARGET, "checked");
    const files = buildSiteData(e.db);
    const list = JSON.parse(files.get(dataFile(siteFiles.list(TARGET.slice(0, 7))))!) as MonthList;
    assert.deepEqual(list.days.find((d) => d.date === TARGET)!.builder, { count: 0, status: "checked" });
    assert.ok(![...files.keys()].some((k) => BUILDER_ITEMS_FILE_RE.test(path.basename(k))));
  });

  test("확정 기한의 일정은 이어지고, 다시 알림은 원래 날짜와 키를 가리키며, 검색 레코드는 달마다 하나이고 빌더 탭 주소로 풀린다", () => {
    const { e, id } = filled();
    const s = createSchedule(e.db, { name: "가짜 종료", due: "2027-01-14", major: "IT·AI" });
    linkItemSchedule(e.db, id, s);
    insertBuilderItem(e.db, "2026-10-28", { field: "모델", title: "다시 알림", whatChanged: "x", who: "y", action: "없음", why: "z", due: { date: "2027-01-14", state: "confirmed" }, sources: [{ name: "a", url: "https://builder.example.com/b" }], issue: null, reminderOf: id, keys: [] });
    const month = JSON.parse(buildSiteData(e.db).get(dataFile(siteFiles.builderItems("2026-10")))!) as BuilderMonth;
    assert.equal(month.days[TARGET]![0]!.schedule, s);
    assert.deepEqual(month.days["2026-10-28"]![0]!.reminderOf, { date: TARGET, key: builderItemKey(1) });
    const records = buildSearchRecords(e.db).filter((r) => r.meta?.kind === "builder");
    assert.equal(records.length, 1);
    assert.ok(records[0]!.content.includes(WHAT));
    assert.deepEqual(parseHit(records[0]!.url, records[0]!.meta), { kind: "builder", month: "2026-10" });
    assert.ok(!records[0]!.content.includes("가짜키QZK"));
  });
});

describe("4.6 화면 규칙", () => {
  const dayWith = { date: TARGET, sections: [{ name: "한국", stories: [] }], builder: { count: 0, status: "checked" } } as unknown as DayList;

  test("탭: 기록이 있으면 끝에, 없으면 없다. 해시와 기억 값을 읽는다", () => {
    assert.equal(briefTabs(dayWith, TARGET).tabs.at(-1), BUILDER_TAB);
    assert.ok(!briefTabs({ ...dayWith, builder: undefined } as DayList, TARGET).tabs.includes(BUILDER_TAB));
    assert.equal(parseBriefTab(BUILDER_TAB), BUILDER_TAB);
    const state = { section: "한국", major: null, expanded: null } as Parameters<typeof stateForHash>[2];
    assert.equal(stateForHash(dayWith, "builder", state).section, BUILDER_TAB);
    assert.equal(stateForHash(dayWith, "builder-2", state).section, BUILDER_TAB);
  });

  test("빌더 항목의 읽음은 날짜별 읽은 수에 세지 않는다", () => {
    const store = createReadStore(null, TARGET);
    store.setRead(TARGET, "builder-1", true);
    store.setRead(TARGET, "한국-top-1", true);
    assert.equal(store.isRead(TARGET, "builder-1"), true);
    assert.equal(store.readCount(TARGET), 1);
  });

  test("일정 이름 링크: 뉴스가 먼저고, 뉴스가 없으면 빌더 항목이다", () => {
    const news = { date: "2026-10-01", key: "한국-top-1" };
    const item = { date: TARGET, key: "builder-1" };
    assert.equal(nameLink({ first: null, builder: item }), `/${TARGET}#builder-1`);
    assert.equal(nameLink({ first: news, builder: item }), `/2026-10-01#${encodeURIComponent(news.key)}`);
    assert.equal(nameLink({ first: null }), null);
  });

  test("검색: 달 파일에서 맞는 항목을 고른다", () => {
    const file = { month: "2026-10", days: { [TARGET]: [{ key: "builder-1", field: "모델", title: "가짜호스팅 요금", whatChanged: "x", who: "y", action: "없음", why: "z" }, { key: "builder-2", field: "보안", title: "다른 항목", whatChanged: "x", who: "y", action: "없음", why: "z" }] } } as unknown as BuilderMonth;
    assert.deepEqual(matchBuilderItems(file, ["가짜호스팅"]).map((x) => x.item.key), ["builder-1"]);
  });

  test("화면이 받는 주소와 빌드가 쓰는 파일 이름이 같고, 백업 이름과 겹치지 않는다", () => {
    const name = siteFiles.builderItems("2026-10");
    assert.ok(dataUrl.builderItems("2026-10").endsWith(`/${name}`));
    assert.ok(BUILDER_ITEMS_FILE_RE.test(name));
    assert.ok(!BACKUP_NAME_RE.test(name));
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

describe("4.6-4 정적 HTML·RSS·검색", () => {
  const options = { end: "2026-10-27", days: 18, contiguous: true, schedules: 12 };
  let out = "";
  let plain = "";
  let fx: Fixture;
  const read = (rel: string) => fs.readFileSync(path.join(out, rel), "utf8");
  const items = (date: string) => (JSON.parse(fx.files.get(`site-data/${siteFiles.builderItems(date.slice(0, 7))}`)!) as BuilderMonth).days[date]!;
  const locs = (dir: string) => [...fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8").matchAll(/<loc>/g)].length;

  before(async () => {
    fx = generateFixtures({ ...options, builder: true });
    out = await build(fx, tempDir());
    plain = await build(generateFixtures(options), tempDir());
  });

  test("브리프 정적 HTML 본문에 항목의 제목과 내용, 정해진 칸, 항목 주소가 있다", () => {
    const b = fx.info.builder!;
    const html = read(`${b.four}.html`);
    for (const x of items(b.four!)) {
      assert.ok(html.includes(`id="${x.key}"`), x.key);
      for (const s of [x.title, x.whatChanged, x.who, x.why]) assert.ok(html.includes(s), s);
    }
    assert.ok(html.includes(">빌더<"));
    assert.ok(html.includes("정정됨"));
    assert.ok(html.includes(`href="/schedules/${b.schedule!.id}"`));
    assert.ok(read(`${b.none}.html`).includes("이날은 실을 만한 도구 변화가 없다."));
    assert.ok(read(`${b.partial}.html`).includes("일부 소스를 받지 못해"));
    assert.ok(read(`${b.failed}.html`).includes("이날의 도구 변화를 받지 못했다."));
    assert.ok(read(`${b.one}.html`).includes("다시 알림"));
    assert.ok(!read(`${b.noRecord}.html`).includes('id="builder"'));
  });

  test("RSS 브리프 항목에 빌더 제목이 들어간다", () => {
    const b = fx.info.builder!;
    const rss = read(RSS_FILE);
    for (const x of items(b.four!)) assert.ok(rss.includes(`빌더: ${x.title}`), x.title);
  });

  test("검색 색인을 풀면 지어낸 문자열이 빌더 달 레코드로 찾아진다", async () => {
    const hits = await searchOutput(out, "가짜호스팅이");
    const b = hits.find((h) => h.meta.kind === "builder");
    assert.ok(b, JSON.stringify(hits));
    assert.equal(b.meta.month, fx.info.builder!.four!.slice(0, 7));
  });

  test("빌더 항목을 넣어도 sitemap 주소 수가 같고 전용 페이지가 없다", () => {
    assert.equal(locs(out), locs(plain));
    assert.ok(!fs.existsSync(path.join(out, "builder")));
    assert.ok(!fs.existsSync(path.join(out, "builder.html")));
    assert.ok(!fs.readFileSync(path.join(out, "sitemap.xml"), "utf8").includes("builder"));
  });

  test("결과물 검사를 지나고 사이트 데이터 파일이 백업 이름에 걸리지 않는다", () => {
    assert.deepEqual(checkOutput(out, null).findings, []);
    const names = fs.readdirSync(path.join(out, "site-data")).filter((n) => n.startsWith("builder"));
    assert.ok(names.length > 0);
    assert.ok(names.every((n) => BUILDER_ITEMS_FILE_RE.test(n) && !BACKUP_NAME_RE.test(n)));
  });

  const found = (date: string) => (JSON.parse(fx.files.get(`site-data/${siteFiles.builderItems(date.slice(0, 7))}`)!) as BuilderMonth).discoveries![date]!;

  test("9.9 4.5-4: 브리프 정적 HTML에 묶음과 새 항목의 칸이 있고, 라이선스 없음과 상태 문구가 그대로다", () => {
    const b = fx.info.builder!;
    const html = read(`${b.three}.html`);
    for (const name of ["도구 변화", "새 제품", "뜨는 저장소"]) assert.ok(html.includes(`>${name}<`), name);
    for (const x of found(b.three!)) {
      assert.ok(html.includes(`id="${x.key}"`), x.key);
      for (const s of [x.name, x.purpose, x.difference, x.reason, x.url]) assert.ok(html.includes(s), s);
    }
    assert.ok(html.includes("판별되지 않음") && html.includes("최근 릴리스 없음") && html.includes("최근 릴리스 확인 못 함"));
    assert.ok(html.includes("정정됨"));
    assert.ok(read(`${b.allNone}.html`).includes("이날은 실을 만한 뜨는 저장소가 없다."));
    assert.ok(read(`${b.allFailed}.html`).includes("이날의 새 제품을 받지 못했다."));
    assert.ok(read(`${b.mixed}.html`).includes("다음 날부터"));
    assert.ok(!read(`${b.onlyProduct}.html`).includes(">도구 변화<"));
    assert.ok(!read(`${b.noRecord}.html`).includes(">새 제품<"));
    assert.ok(!read(`${b.four}.html`).includes(">새 제품<"), "9.9 이전 날짜");
    assert.ok(!read(`${b.offOnly}.html`).includes('id="builder"'), "꺼짐만 있는 날");
  });

  test("9.9 4.5-4: RSS 브리프 항목에 새 항목의 이름이 들어간다", () => {
    const rss = read(RSS_FILE);
    for (const x of found(fx.info.builder!.three!)) assert.ok(rss.includes(`빌더: ${x.name}`), x.name);
  });

  test("9.9 4.5-4: 검색 색인을 풀면 새 항목의 글이 빌더 달 레코드로 찾아진다", async () => {
    const hits = await searchOutput(out, "가짜회의록지어낸용도는");
    assert.ok(hits.some((h) => h.meta.kind === "builder"), JSON.stringify(hits));
  });

  test("일정 출처 문구: 일정 정적 페이지의 두 곳이 '뉴스와 공식 문서'다", () => {
    const b = fx.info.builder!;
    const page = read("schedules.html");
    assert.equal([...page.matchAll(/뉴스와 공식 문서/g)].length >= 2, true, "설명과 본문 안내");
    assert.ok(!page.includes("뉴스에서 모은"));
    const month = JSON.parse(read(`site-data/${siteFiles.scheduleMonth(b.schedule!.due.slice(0, 7))}`)) as ScheduleMonth;
    const s = month.items.find((x) => x.id === b.schedule!.id)!;
    assert.deepEqual([s.first, s.issue, s.builder], [null, null, { date: b.schedule!.date, key: b.schedule!.key }]);
  });
});

describe("4.6-5 크기", () => {
  test("5년, 하루 10건, 칸별 상한 길이에서 첫 화면과 빌더 탭이 gzip 300KB 이하이고 빌더 파일이 2,000개 이하다", { timeout: 600_000 }, async () => {
    const work = tempDir("tidwyn-site98-");
    const dataDir = path.join(work, "data");
    const out = path.join(work, "out");
    writeFixtures(dataDir, { end: "2026-10-31", days: 1826, top: 6, short: 8, issues: 15000, contiguous: true, entities: 15000, terms: 5000, schedules: 15000, indicators: 5, indicatorsAll: true, videosFull: true, builderFull: true });
    const res = await buildSite({ dataDir, outDir: out });
    const latest = JSON.parse(fs.readFileSync(path.join(out, "site-data", siteFiles.builderItems("2026-10")), "utf8")) as BuilderMonth;
    const day = latest.days["2026-10-31"]!;
    assert.equal(day.length, 4);
    assert.ok(day.every((x) => x.title.length === 60 && x.whatChanged.length === 300 && x.who.length === 100 && x.action.length === 150 && x.why.length === 100));
    const found = latest.discoveries!["2026-10-31"]!;
    assert.equal(found.length, 6);
    assert.ok(found.every((x) => x.purpose.length === 200 && x.difference.length === 200 && x.reason.length === 100));
    assert.ok(new Set(Object.values(latest.days).flat().map((x) => x.whatChanged)).size > 100, "날마다 글이 달라야 압축에 속지 않는다");
    const size = measureOutput(out);
    assert.ok(size.firstScreen.gzip <= FIRST_SCREEN_BUDGET, `브리프 첫 화면 gzip ${size.firstScreen.gzip}B`);
    const { screens, files } = measureBuilderScreens(out);
    assert.equal(screens.length, 1);
    assert.ok(screens[0]!.gzip > 0 && screens[0]!.gzip <= FIRST_SCREEN_BUDGET, `빌더 탭 gzip ${screens[0]!.gzip}B`);
    assert.ok(files > 0 && files <= 2000, `빌더 파일 ${files}개`);
    console.log(`# 4.6-5 결과물 ${res.files.length}개, 전체 ${(res.bytes / 1024 / 1024).toFixed(2)}MB, 빌더 파일 ${files}개, 브리프 첫 화면 gzip ${(size.firstScreen.gzip / 1024).toFixed(1)}KB, 빌더 탭 gzip ${(screens[0]!.gzip / 1024).toFixed(1)}KB`);
  });
});
