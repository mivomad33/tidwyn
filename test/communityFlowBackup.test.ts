import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, test } from "node:test";
import { buildBackup, restoreBackup } from "../src/backup.ts";
import { checkFlowCorrection } from "../src/corrections.ts";
import { MIGRATIONS, openDb, schemaVersion } from "../src/db.ts";
import { runFlowStep } from "../src/demandFlowRun.ts";
import { allFlowDates, allFlows, flowsOfDate, saveFlows, type FlowCommunityUnit, type NewFlow } from "../src/demandFlowStore.ts";
import { COMMUNITY_INFO, FIELD_IDS, GROUP_INFO, SOURCE_PAGES } from "../src/demandFlowTypes.ts";
import { buildDemandSiteData } from "../src/demandSite.ts";
import { demandSearchRecords } from "../src/siteTypes.ts";
import { addBrief } from "./builderFixtures.ts";
import { RESP_TEXTS, communityDump, fakeCommunity, runOn, virtualTime } from "./communityFixtures.ts";
import { TARGET, TODAY, candidatesOf, fakeWriter, firstOf, flowOf, seeded } from "./flowFixtures.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

// 9.98단계 4.5-1(사이트 데이터), 4.5-3(검색·정정), 4.6-1(공개 백업·복원·9.97 버전 열기), 4.6-2(원문이 나가지 않음). 데이터는 모두 지어낸 값이다

after(cleanupTemp);

const DAY = "2026-11-03";
const PREV = "2026-11-01";

const unit = (over: Partial<NewFlow["units"][number]> = {}): NewFlow["units"][number] => ({
  group: "wikimedia",
  source: "wikimedia:en",
  unitKey: "wikimedia:en:가짜문서키",
  unitName: "가짜 위키 문서",
  recent: 350_000,
  base: 70_000,
  isNew: false,
  recentFrom: "2026-10-27",
  recentTo: "2026-11-02",
  baseFrom: "2026-09-29",
  baseTo: "2026-10-26",
  recentDays: 7,
  baseDays: 28,
  ...over,
});

const comLine = (over: Partial<FlowCommunityUnit> = {}): FlowCommunityUnit => ({
  group: "github",
  source: "github:issues",
  unitKey: "github:issues:wikimedia:en:가짜문서키",
  officialKey: "wikimedia:en:가짜문서키",
  unitName: "가짜 위키 문서",
  recent: 50,
  base: 10,
  isNew: false,
  recentFrom: "2026-10-27",
  recentTo: "2026-11-02",
  baseFrom: "2026-09-29",
  baseTo: "2026-10-26",
  ...over,
});

const flow = (over: Partial<NewFlow> = {}): NewFlow => ({ flowId: "", category: "interest", field: FIELD_IDS[0]!, title: "가짜 흐름 제목", summary: "가짜 흐름 요지다.", reason: "가짜 잇는 이유다.", level: "medium", aux: [], issue: null, continues: null, units: [unit()], ...over });

/** 커뮤니티 확인 흐름(꺾임), 공식 둘 + 커뮤니티 흐름, 9.97과 같은 흐름, 빠진 커뮤니티 소스가 든 날짜 상태 */
function seedCommunityFlows(db: DatabaseSync): void {
  saveFlows(db, PREV, [flow({ units: [unit(), unit({ group: "dart", source: "dart:list", unitKey: "dart:list:가짜종류", unitName: "가짜 공시 종류", recent: 49, base: 7 })] })], { date: PREV, status: "checked", missing: ["sec"] });
  saveFlows(
    db,
    DAY,
    [
      flow({ community: [comLine(), comLine({ group: "bluesky", source: "bluesky:posts", unitKey: "bluesky:posts:wikimedia:en:가짜문서키", recent: 60, isNew: true, base: 0 })], turning: true }),
      flow({ category: "money", field: FIELD_IDS[1]!, units: [unit({ group: "dart", source: "dart:list", unitKey: "dart:list:가짜종류", unitName: "가짜 공시 종류", recent: 49, base: 7 }), unit({ group: "sec", source: "sec:formd", unitKey: "sec:formd:가짜업종", unitName: "가짜 업종", recent: 21, base: 7 })], community: [comLine({ group: "bluesky", source: "bluesky:posts", unitKey: "bluesky:posts:dart:list:가짜종류", officialKey: "dart:list:가짜종류", unitName: "가짜 공시 종류" })] }),
    ],
    { date: DAY, status: "checked", missing: ["acrc"], communityMissing: [{ source: "github:issues", group: "github", reason: "blocked" }] },
  );
}

function restoredFrom(files: Map<string, string>): DatabaseSync {
  const file = path.join(tempDir(), "r.db");
  restoreBackup(files, file);
  return openDb(file);
}

const TABLES = ["demand_flows", "demand_flow_units", "demand_flow_community", "demand_flow_dates", "demand_flow_corrections"];
const dumpTables = (db: DatabaseSync) => TABLES.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all());

describe("4.6-1 공개 백업과 복원", () => {
  test("커뮤니티 근거 줄·꺾임·빠진 커뮤니티 소스가 백업에 들고, 백업 → 빈 DB 복원 → 다시 백업이 같다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    seedCommunityFlows(db);
    const files = buildBackup(db);
    const f = JSON.parse(files.get("demand.json")!) as { formatVersion: number; flows: { community: unknown[]; turning: boolean }[]; flowDates: { communityMissing: unknown[] }[] };
    assert.equal(f.formatVersion, 10);
    assert.deepEqual(
      f.flows.map((x) => [x.community.length, x.turning]),
      [
        [0, false],
        [2, true],
        [1, false],
      ],
    );
    assert.deepEqual(f.flowDates.find((d) => d.communityMissing.length > 0)?.communityMissing, [{ source: "github:issues", group: "github", reason: "blocked" }]);
    const back = restoredFrom(files);
    const again = buildBackup(back);
    assert.deepEqual([...again.keys()].sort(), [...files.keys()].sort());
    for (const [name, text] of files) assert.equal(again.get(name), text, name);
    assert.deepEqual(dumpTables(back), dumpTables(db));
  });

  test("9.97 형식(9) 백업이 새 코드로 복원되고, 커뮤니티 근거 줄은 비고 꺾임 표시가 없다", () => {
    const db = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(db, DAY);
    saveFlows(db, PREV, [flow()], { date: PREV, status: "checked", missing: ["sec"] });
    saveFlows(db, DAY, [], { date: DAY, status: "short", missing: [] });
    const files = buildBackup(db);
    const old = new Map<string, string>();
    for (const [name, text] of files) {
      const v = JSON.parse(text.replaceAll('"formatVersion": 10', '"formatVersion": 9')) as Record<string, unknown>;
      if (name === "demand.json") {
        for (const x of v.flows as Record<string, unknown>[]) {
          delete x.community;
          delete x.turning;
        }
        for (const x of v.flowDates as Record<string, unknown>[]) delete x.communityMissing;
      }
      old.set(name, JSON.stringify(v, null, 2) + "\n");
    }
    assert.ok(!old.get("demand.json")!.includes("community") && !old.get("demand.json")!.includes("turning"), "9.97 형식이다");
    const back = restoredFrom(old);
    assert.deepEqual(allFlows(back), allFlows(db));
    assert.deepEqual(allFlows(back).map((x) => [x.community, x.turning]), [[[], false]]);
    assert.deepEqual(allFlowDates(back), allFlowDates(db));
  });

  test("9.97 버전 본 DB(흐름 항목 있음)를 새 코드로 열면 항목·id·날짜 상태가 그대로이고 커뮤니티 근거 줄은 비고 꺾임 표시가 없다", () => {
    const file = path.join(tempDir(), "old.db");
    const old = openDb(file, MIGRATIONS.filter((m) => m.version <= 13));
    assert.equal(schemaVersion(old), 13);
    addBrief(old, DAY);
    old.prepare("INSERT INTO demand_flows (id, target_date, position, flow_id, category, field, title, summary, reason, level, aux, issue_id, continues_id) VALUES (7, ?, 1, ?, 'interest', ?, '가짜 옛 흐름', '가짜 옛 요지다.', '가짜 옛 이유다.', 'medium', '[]', NULL, NULL)").run(PREV, `${PREV}-1`, FIELD_IDS[0]!);
    old.prepare("INSERT INTO demand_flow_units (item_id, position, grp, source, unit_key, unit_name, recent, base, is_new, recent_from, recent_to, base_from, base_to, recent_days, base_days) VALUES (7, 1, 'wikimedia', 'wikimedia:en', 'wikimedia:en:k', '가짜 문서', 350000, 70000, 0, '2026-10-25', '2026-10-31', '2026-09-27', '2026-10-24', 7, 28)").run();
    old.prepare("INSERT INTO demand_flow_dates (target_date, status, missing) VALUES (?, 'checked', '[\"sec\"]'), (?, 'short', '[]')").run(PREV, DAY);
    old.close();
    const db = openDb(file);
    assert.equal(schemaVersion(db), 14);
    const [x] = allFlows(db);
    assert.deepEqual([x!.id, x!.flowId, x!.title, x!.units.length, x!.community, x!.turning], [7, `${PREV}-1`, "가짜 옛 흐름", 1, [], false]);
    assert.deepEqual(allFlowDates(db), [
      { date: PREV, status: "checked", missing: ["sec"], communityMissing: [] },
      { date: DAY, status: "short", missing: [], communityMissing: [] },
    ]);
  });
});

describe("4.6-2 원문이 나가지 않음", () => {
  test("지어낸 커뮤니티 응답에 심은 글이 본 DB·백업·사이트 데이터에 없고, 받은 건수 행도 백업에 없다", async () => {
    const e = seeded(["wikimedia"]);
    const d = e.demand();
    const vt = virtualTime();
    await runOn(d, fakeCommunity(vt.clock).http, vt);
    const raw = communityDump(d);
    d.close();
    for (const t of RESP_TEXTS) assert.ok(!raw.includes(t), `전용 DB: ${t}`);
    const fake = fakeWriter(() => {
      const c = candidatesOf(e.dataDir);
      return { targetDate: c.target, flows: [flowOf([firstOf(c, "wikimedia"), c.community!.find((x) => x.source === "github:issues")!.n])], excluded: [] };
    });
    let prev;
    for (let i = 0; i < 3; i++) {
      const r = runFlowStep({ db: e.db, dataDir: e.dataDir, target: TARGET, today: TODAY, prev, off: false, env: {}, run: fake.run, clock: () => 0, home: null, secrets: [] });
      prev = r.state;
      if (r.state.status !== "again") break;
    }
    assert.equal(flowsOfDate(e.db, TARGET)[0]?.community?.length, 1);
    const files = buildBackup(e.db);
    const site = buildDemandSiteData(e.db);
    const mainDump = JSON.stringify(e.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => e.db.prepare(`SELECT * FROM "${(t as { name: string }).name}"`).all()));
    const texts = { main: mainDump, backup: [...files.values()].join("\n"), site: JSON.stringify([...site.months, ...site.byDate]) };
    for (const [where, text] of Object.entries(texts)) for (const t of RESP_TEXTS) assert.ok(!text.includes(t), `${where}: ${t}`);
    for (const k of ["baseCount", "capHit", "cap_hit", "top_share", "share", "fetchedAt", "community_counts", "community_terms"]) assert.ok(!texts.backup.includes(k), `백업: ${k}`);
  });
});

describe("4.5-1·4.5-3 사이트 데이터, 검색, 정정", () => {
  function db(): DatabaseSync {
    const x = openDb(path.join(tempDir(), "tidwyn.db"));
    addBrief(x, DAY);
    seedCommunityFlows(x);
    return x;
  }

  test("커뮤니티 근거 줄(소스 이름·표본 설명·단위 이름·두 창 숫자·창), 커뮤니티 확인·꺾임 표시, 빠진 커뮤니티 소스가 사이트 데이터에 들고 단위 키는 없다", () => {
    const s = buildDemandSiteData(db());
    const [a, b] = s.months.find((m) => m.month === "2026-11")!.days[DAY]!;
    assert.deepEqual(a!.community, [
      { group: "github", source: "GitHub Issues", sample: COMMUNITY_INFO.github.sample, name: "가짜 위키 문서", recent: 50, base: 10, isNew: false, recentFrom: "2026-10-27", recentTo: "2026-11-02", baseFrom: "2026-09-29", baseTo: "2026-10-26", unit: "건" },
      { group: "bluesky", source: "Bluesky", sample: COMMUNITY_INFO.bluesky.sample, name: "가짜 위키 문서", recent: 60, base: 0, isNew: true, recentFrom: "2026-10-27", recentTo: "2026-11-02", baseFrom: "2026-09-29", baseTo: "2026-10-26", unit: "건" },
    ]);
    assert.deepEqual([a!.communityConfirmed, a!.turning], [true, true]);
    assert.deepEqual([b!.communityConfirmed, b!.turning, b!.community!.length], [undefined, undefined, 1], "공식 둘 + 커뮤니티는 커뮤니티 확인 흐름이 아니다");
    const old = s.months.find((m) => m.month === "2026-11")!.days[PREV]![0]!;
    assert.deepEqual(["community" in old, "communityConfirmed" in old, "turning" in old], [false, false, false], "9.97과 같은 항목은 새 칸이 없다");
    assert.deepEqual(s.byDate.get(DAY), { count: 2, status: "checked", missing: ["acrc"], communityMissing: [{ group: "github", reason: "blocked" }] });
    assert.ok(!JSON.stringify(s.months).includes("github:issues:"), "커뮤니티 단위 키가 나가지 않는다");
  });

  test("출처 칸에 GitHub·Bluesky가 들고, 모든 출처 주소가 코드에 정한 공식 주소 목록 안에 있다", () => {
    const s = buildDemandSiteData(db());
    const items = s.months.flatMap((m) => Object.values(m.days).flat());
    const allowed = new Set([...Object.values(GROUP_INFO).map((g) => g.url), ...Object.values(SOURCE_PAGES), ...Object.values(COMMUNITY_INFO).map((g) => g.url), "https://en.wikipedia.org/"]);
    for (const x of items) for (const src of x.sources) assert.ok(allowed.has(src.url), src.url);
    assert.deepEqual(items[1]!.sources.map((x) => x.name).slice(1), ["GitHub", "Bluesky"], "공식 출처 뒤에 커뮤니티 출처 표시가 든다");
    assert.deepEqual(items[0]!.sources.map((x) => x.name).filter((n) => n === "GitHub" || n === "Bluesky"), [], "커뮤니티 근거가 없으면 없다");
    for (const g of Object.values(COMMUNITY_INFO)) assert.ok(!g.url.includes("?") && !g.url.includes("q="), "검색어를 넣지 않은 고정 주소다");
  });

  test("검색 레코드의 소스 이름에 커뮤니티 소스가 든다", () => {
    const s = buildDemandSiteData(db());
    const [r] = demandSearchRecords(s.months);
    assert.match(r!.content, /GitHub Issues/);
    assert.match(r!.content, /Bluesky/);
  });

  test("정정은 커뮤니티 근거 줄(숫자·단위 이름)을 고칠 수 없다", () => {
    const x = db();
    const before = allFlows(x);
    for (const fields of [{ community: [] }, { unitName: "고친 이름" }, { turning: false }, { recent: 1 }]) {
      const r = checkFlowCorrection(x, { date: DAY, key: "demand-1", reason: "근거를 고쳤다.", fields }, null);
      assert.equal(r.ok, false, JSON.stringify(fields));
      if (!r.ok) assert.ok(r.violations.some((v) => /고칠 수 없다/.test(v.why)), JSON.stringify(r.violations));
    }
    assert.deepEqual(allFlows(x), before);
  });
});
