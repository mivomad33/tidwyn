import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { cleanMaterial, cleanName, fetchDiscoveries, offKinds, repoGrowths, MATERIAL_CHARS, MAX_PRODUCT_CANDIDATES, MAX_REPO_DETAILS, RAW_MATERIAL_CHARS, type DiscoverOptions } from "../src/builderDiscover.ts";
import { sourceState } from "../src/builderStore.ts";
import { buildBuilderBackup } from "../src/builderStore.ts";
import { insertDiscovery, snapshotRowCount, undoneKinds, setKindStatus, kindStatusOf, publishedProductKeys, recentRepoKeys, type NewDiscovery } from "../src/discoverStore.ts";
import { DISCOVER_WORK_NAMES, discoverWorkFile, readDiscoverWork, renderDiscoverList, writeDiscoverWork } from "../src/discoverWork.ts";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { addDays } from "../src/kst.ts";
import { KEY_NAMES, secretValues } from "../src/keys.ts";
import { precheck, nameKinds } from "../src/precheck.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { readRun } from "../src/run.ts";
import { recordFirstCollectionDate } from "../src/store.ts";
import { HOUR, NOW, TARGET, addBrief, env, fakeHttp, rss, type Env } from "./builderFixtures.ts";
import { cleanupTemp, gitIn, makeCtx, tempDir, tempRepo } from "./helpers.ts";
import { discoverHttp, fakeClock, postsReply, queryOf, seedSnapshot, variablesOf, type DiscoverHttp, type FakePost, type FakeRepo, type Route } from "./discoverFixtures.ts";

after(cleanupTemp);

const FAKE_TOKEN = "fake-product-token-000";
const y = addDays(TARGET, -1);

const repoItem = (key: string, date: string): NewDiscovery => ({ date, kind: "repo", key, name: key.slice(5), url: `https://github.com/${key.slice(5)}`, purpose: "용도", difference: "차이", reason: "이유", issue: null, license: "MIT", pushedOn: date, release: null, stars: 1, growth: 1 });
const productItem = (key: string, date: string): NewDiscovery => ({ date, kind: "product", key, name: key.slice(3), url: `https://www.producthunt.com/products/${key.slice(3)}`, purpose: "용도", difference: "차이", reason: "이유", issue: null, license: null, pushedOn: null, release: null, stars: null, growth: null });

function discover(e: Env, h: DiscoverHttp, o: Partial<DiscoverOptions> = {}) {
  return fetchDiscoveries({ db: e.db, http: h.http, now: NOW, target: TARGET, home: null, token: null, ...o });
}

/** 어제와 오늘 스냅샷: 이름 → 늘어난 별 */
function grown(e: Env, grow: Record<string, number>, base = 5000): void {
  const names = Object.keys(grow);
  seedSnapshot(e.db, y, names.map((name) => ({ name, stars: base })));
  seedSnapshot(e.db, TARGET, names.map((name) => ({ name, stars: base + grow[name]! })));
}

describe("4.1-3 증가량", () => {
  test("1일 간격과 3일 빈 간격의 하루 평균", () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -3), [{ name: "fake/three", stars: 1000 }]);
    seedSnapshot(e.db, y, [{ name: "fake/one", stars: 2000 }]);
    seedSnapshot(e.db, TARGET, [{ name: "fake/one", stars: 2030 }, { name: "fake/three", stars: 1090 }]);
    const g = new Map(repoGrowths(e.db, TARGET)!.map((r) => [r.repo, r.growth]));
    assert.equal(g.get("fake/one"), 30);
    assert.equal(g.get("fake/three"), 30, "전날 없고 사흘 전 값이면 3일로 나눈다");
  });

  test("완성되지 않은 스냅샷과 8일 넘은 값은 비교에 쓰지 않는다", () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -9), [{ name: "fake/old", stars: 1000 }]);
    seedSnapshot(e.db, addDays(TARGET, -8), [{ name: "fake/eight", stars: 1000 }]);
    seedSnapshot(e.db, y, [{ name: "fake/half", stars: 1000 }], false);
    seedSnapshot(e.db, TARGET, [{ name: "fake/old", stars: 1900 }, { name: "fake/eight", stars: 1800 }, { name: "fake/half", stars: 1100 }]);
    assert.deepEqual(repoGrowths(e.db, TARGET)!.map((r) => r.repo), ["fake/eight"]);
  });

  test("N2: 값이 없을 때 생성 14일 이내만 지금 별 수를 날 수로 나눈다", () => {
    const e = env();
    seedSnapshot(e.db, y, [{ name: "fake/other", stars: 9000 }]);
    seedSnapshot(e.db, TARGET, [
      { name: "fake/other", stars: 9000 },
      { name: "fake/edge", stars: 1400, created: "2026-10-13T01:00:00Z" },
      { name: "fake/over", stars: 1500, created: "2026-10-12T01:00:00Z" },
      { name: "fake/today", stars: 900, created: "2026-10-27T01:00:00Z" },
      { name: "fake/oldnew", stars: 3000 },
    ]);
    const g = new Map(repoGrowths(e.db, TARGET)!.map((r) => [r.repo, r.growth]));
    assert.equal(g.get("fake/edge"), 100, "14일 경계");
    assert.equal(g.get("fake/today"), 900, "날 수 최소 1");
    assert.equal(g.has("fake/over"), false, "15일이면 후보가 아니다");
    assert.equal(g.has("fake/oldnew"), false, "오래된 저장소가 처음 들면 값만 저장한다");
  });

  test("N2: 전날 없고 사흘 전 있으면 생성일이 가까워도 사흘 전 값과 비교한다", () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -3), [{ name: "fake/new", stars: 1000, created: "2026-10-22T01:00:00Z" }]);
    seedSnapshot(e.db, TARGET, [{ name: "fake/new", stars: 1300, created: "2026-10-22T01:00:00Z" }]);
    assert.equal(repoGrowths(e.db, TARGET)![0]!.growth, 100);
  });

  test("지난 완성 스냅샷이 없으면 null이다(첫날은 생성 14일 이내도 후보가 아니다)", () => {
    const e = env();
    seedSnapshot(e.db, TARGET, [{ name: "fake/new", stars: 1300, created: "2026-10-26T01:00:00Z" }]);
    assert.equal(repoGrowths(e.db, TARGET), null);
  });
});

describe("4.1-2 상태 판정", () => {
  test("끄기 값이 먼저이고 호출이 0이며 스냅샷 행이 그대로다", async () => {
    const e = env();
    seedSnapshot(e.db, TARGET, [{ name: "fake/a", stars: 3000 }]);
    const h = discoverHttp();
    const d = await discover(e, h, { off: { sources: ["github-repos", "product-hunt"], vendors: [] }, token: FAKE_TOKEN });
    assert.equal(d.kinds.repo.status, "off");
    assert.equal(d.kinds.product.status, "off");
    assert.equal(h.calls.length, 0);
    assert.equal(snapshotRowCount(e.db, TARGET), 1);
  });

  test("시험 모드만 꺼짐이고 제품은 시험 모드에서도 받는다", async () => {
    const e = env();
    const h = discoverHttp({ product: postsReply([{ slug: "fake" }]) });
    const d = await discover(e, h, { repoTestMode: true, token: FAKE_TOKEN });
    assert.equal(d.kinds.repo.status, "off");
    assert.equal(d.kinds.product.status, "checked");
    assert.equal(d.products.length, 1);
  });

  test("완성 스냅샷이 없으면 첫날도 받지 못함이다(기준값보다 먼저)", async () => {
    const e = env();
    const h = discoverHttp();
    assert.equal((await discover(e, h)).kinds.repo.status, "failed");
    assert.equal(sourceState(e.db, "github-repos").failDays, 1);
    const unfinished = env();
    seedSnapshot(unfinished.db, TARGET, [{ name: "fake/a", stars: 3000 }], false);
    assert.equal((await discover(unfinished, h)).kinds.repo.status, "failed");
    assert.equal(h.calls.length, 0);
  });

  test("지난 스냅샷이 없으면 기준값 쌓는 중이고 후보와 호출이 없다", async () => {
    const e = env();
    seedSnapshot(e.db, TARGET, [{ name: "fake/a", stars: 3000 }]);
    const h = discoverHttp();
    const d = await discover(e, h);
    assert.equal(d.kinds.repo.status, "baseline");
    assert.deepEqual(d.repos, []);
    assert.equal(h.calls.length, 0);
    assert.equal(sourceState(e.db, "github-repos").failDays, 0);
  });

  test("전날 스냅샷이 실패한 다음 날은 사흘 전 완성 값과 비교해 정상 계산한다", async () => {
    const e = env();
    seedSnapshot(e.db, addDays(TARGET, -3), [{ name: "fake/a", stars: 1000 }]);
    seedSnapshot(e.db, addDays(TARGET, -1), [{ name: "fake/a", stars: 9999 }], false);
    seedSnapshot(e.db, TARGET, [{ name: "fake/a", stars: 1300 }]);
    const d = await discover(e, discoverHttp());
    assert.equal(d.repos[0]!.growth, 100);
  });

  test("끝난 종류는 다시 받지 않는다", async () => {
    const e = env();
    setKindStatus(e.db, TARGET, "product", "checked");
    setKindStatus(e.db, TARGET, "repo", "baseline");
    const h = discoverHttp();
    const d = await discover(e, h, { token: FAKE_TOKEN });
    assert.equal(d.kinds.product.status, "done");
    assert.equal(d.kinds.repo.status, "done");
    assert.equal(h.calls.length, 0);
    assert.deepEqual(undoneKinds(e.db, TARGET), []);
    setKindStatus(e.db, TARGET, "repo", "failed");
    assert.deepEqual(undoneKinds(e.db, TARGET), ["repo"]);
    setKindStatus(e.db, TARGET, "product", "off");
    assert.equal(kindStatusOf(e.db, TARGET, "product"), "off");
  });
});

describe("4.1-3 저장소 후보", () => {
  test("증가량 상위 15개만 별 이력, README, 릴리스 순서로 받는다", async () => {
    const e = env();
    grown(e, Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`fake/r${i}`, 100 + i])));
    const h = discoverHttp();
    const d = await discover(e, h);
    assert.equal(d.repos.length, MAX_REPO_DETAILS);
    assert.equal(MAX_REPO_DETAILS, 15);
    assert.equal(d.repos[0]!.name, "fake/r19");
    assert.equal(h.calls.length, 45);
    assert.deepEqual(h.calls.slice(0, 3).map((c) => c.url.split("/").slice(6).join("/")), ["stargazers/history", "readme", "releases/latest"]);
  });

  test("90일 안 키는 빠지고 91일째는 후보다, 상위 15에는 키를 뺀 뒤 든다", async () => {
    const e = env();
    grown(e, { "fake/day90": 300, "fake/day91": 200, "Fake/Upper": 100 });
    insertDiscovery(e.db, repoItem("repo:fake/day90", addDays(TARGET, -90)));
    insertDiscovery(e.db, repoItem("repo:fake/day91", addDays(TARGET, -91)));
    const d = await discover(e, discoverHttp());
    assert.deepEqual(d.repos.map((r) => r.key), ["repo:fake/day91", "repo:fake/upper"], "키는 소문자다");
    assert.deepEqual([...recentRepoKeys(e.db, TARGET)], ["repo:fake/day90"]);
    assert.equal(d.kinds.repo.droppedByKey, 1);
  });

  test("x-ratelimit-remaining이 5 이하면 호출을 멈추고 받은 값까지 쓰고 경고한다", async () => {
    const e = env();
    grown(e, { "fake/a": 300, "fake/b": 200, "fake/c": 100 });
    let n = 0;
    const low = (text: string) => () => {
      n++;
      return { status: 200, text, headers: { "x-ratelimit-remaining": n >= 3 ? "5" : "50" } };
    };
    const h = discoverHttp({ "history:fake/a": low("[]"), "readme:fake/a": low("# a\n\nbody a"), "release:fake/a": { status: 404, text: "{}" }, "history:fake/b": low("[]") });
    const d = await discover(e, h);
    assert.equal(h.calls.length, 4, "남은 한도 5를 본 뒤 호출하지 않는다");
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/a"]);
    assert.equal(d.kinds.repo.status, "checked");
    assert.equal(d.kinds.repo.missing, 2);
    assert.ok(d.kinds.repo.warnings.some((w) => /한도|시간/.test(w)));
  });

  test("9.8 소스가 남긴 한도 값도 첫 상세 호출 전에 본다", async () => {
    const e = env();
    grown(e, { "fake/a": 300 });
    const h = discoverHttp();
    const d = await discover(e, h, { rateRemaining: 3 });
    assert.equal(h.calls.length, 0);
    assert.equal(d.kinds.repo.status, "failed", "상세 대상이 있었는데 재료를 갖춘 후보가 0개다");
  });

  test("시간 상한에 닿으면 멈춘다", async () => {
    const e = env();
    grown(e, { "fake/a": 300, "fake/b": 200 });
    const c = fakeClock();
    const h = discoverHttp({ "history:fake/a": () => { c.tick(20_000); return { status: 200, text: "[]" }; }, "readme:fake/a": () => { c.tick(20_000); return { status: 200, text: "body" }; } });
    const d = await discover(e, h, { clock: c.clock, deadlineAt: c.clock() + 30_000 });
    assert.equal(h.calls.length, 2);
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/a"]);
    assert.equal(d.repos[0]!.release.state, "unknown");
  });

  test("README를 받지 못한 후보는 없고, 일부면 확인함에 경고다", async () => {
    const e = env();
    grown(e, { "fake/a": 300, "fake/b": 200 });
    const d = await discover(e, discoverHttp({ "readme:fake/a": { status: 500, text: "x" } }));
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/b"]);
    assert.equal(d.kinds.repo.status, "checked");
    assert.equal(d.kinds.repo.missing, 1);
    assert.equal(d.kinds.repo.warnings.length, 1);
  });

  test("상세 대상이 있었는데 재료 후보가 0개면 받지 못함이다", async () => {
    const e = env();
    grown(e, { "fake/a": 300 });
    const d = await discover(e, discoverHttp({ "readme:fake/a": { status: 403, text: "x" } }));
    assert.equal(d.kinds.repo.status, "failed");
    assert.deepEqual(d.repos, []);
  });

  test("키나 공개 검사로만 후보가 0개면 확인함이고 빠짐이 0이다", async () => {
    const f = env();
    grown(f, { "fake/a": 300 });
    insertDiscovery(f.db, repoItem("repo:fake/a", y));
    const h = discoverHttp();
    const g = await discover(f, h);
    assert.equal(g.kinds.repo.status, "checked");
    assert.equal(g.kinds.repo.missing, 0);
    assert.equal(h.calls.length, 0);
  });

  test("별 이력을 받지 못한 후보는 배수 없이 남고, 받으면 28일 일평균 대비 배수가 붙는다", async () => {
    const e = env();
    grown(e, { "fake/a": 300, "fake/b": 200 });
    const d = await discover(e, discoverHttp({ "history:fake/a": { status: 500, text: "x" } }));
    assert.equal(d.repos[0]!.ratio, null);
    assert.equal(d.repos[1]!.ratio, 20, "하루 200 / 28일 평균 10");
  });

  test("별 이력이 200이고 짧거나 증가가 없으면 받지 못한 후보로 세지 않는다", async () => {
    const e = env();
    grown(e, { "fake/short": 300, "fake/zero": 200, "fake/broken": 100 });
    const zero = Array.from({ length: 5 }, () => ({ days: [0, 0, 0, 0, 0, 0, 0] }));
    const d = await discover(e, discoverHttp({ "history:fake/short": { status: 200, text: "[]" }, "history:fake/zero": { status: 200, text: JSON.stringify(zero) } }));
    assert.deepEqual(d.repos.map((r) => r.ratio), [null, null, 100 / 10]);
    assert.deepEqual(d.kinds.repo.warnings, []);
    const f = env();
    grown(f, { "fake/bad": 300, "fake/fail": 200 });
    const g = await discover(f, discoverHttp({ "history:fake/bad": { status: 200, text: "<html>" }, "history:fake/fail": { status: 500, text: "x" } }));
    assert.deepEqual(g.kinds.repo.warnings, ["별 이력을 받지 못한 후보 2개는 배수가 없다"]);
  });

  test("정리 뒤 빈 README는 받지 못함이 아니다: 후보에서 빠지지만 빠짐으로 세지 않는다", async () => {
    const e = env();
    grown(e, { "fake/empty": 300, "fake/b": 200 });
    const h = discoverHttp({ "readme:fake/empty": { status: 200, text: "<!-- only a comment -->\n![logo](x.png)" } });
    const d = await discover(e, h);
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/b"]);
    assert.equal(d.kinds.repo.status, "checked");
    assert.equal(d.kinds.repo.missing, 0);
    assert.ok(!d.kinds.repo.warnings.some((w) => /받지 못한/.test(w)), JSON.stringify(d.kinds.repo.warnings));
    assert.equal(h.calls.filter((c) => c.url.includes("/fake/empty/")).length, 2, "릴리스는 받지 않는다");
  });

  test("상세 대상의 README가 모두 200이고 비어 있으면 확인함 0건이다", async () => {
    const e = env();
    grown(e, { "fake/empty": 300 });
    const d = await discover(e, discoverHttp({ "readme:fake/empty": { status: 200, text: "<!-- x -->" } }));
    assert.equal(d.kinds.repo.status, "checked");
    assert.equal(d.kinds.repo.missing, 0);
    assert.deepEqual(d.repos, []);
  });

  test("릴리스 없음과 확인 못 함을 구별한다", async () => {
    const e = env();
    grown(e, { "fake/none": 300, "fake/fail": 200, "fake/found": 100 });
    const d = await discover(e, discoverHttp({ "release:fake/none": { status: 404, text: "{}" }, "release:fake/fail": { status: 500, text: "x" } }));
    assert.deepEqual(d.repos.map((r) => r.release), [{ state: "none" }, { state: "unknown" }, { state: "found", date: "2026-10-20" }]);
  });

  test("이름이나 설명이 공개 검사나 결과물 검사에 걸리면 뺀다, 주소 모양은 검사하지 않는다", async () => {
    const e = env();
    const repos: FakeRepo[] = [
      { name: "fake/plain", stars: 3300, description: "Works with Cal.com and example.io" },
      { name: "someone@example.com/x", stars: 3200 },
      { name: "fake/mail", stars: 3100, description: "Contact hello@example.org" },
      { name: "fake/video", stars: 3000, description: "see youtube.com/watch?v=abc" },
      { name: "fake/home", stars: 2900, description: "Installed at /Users/fake-home/x" },
    ];
    seedSnapshot(e.db, y, repos.map((r) => ({ ...r, stars: 2000 })));
    seedSnapshot(e.db, TARGET, repos);
    const d = await discover(e, discoverHttp(), { home: "/Users/fake-home" });
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/plain"]);
    assert.equal(d.kinds.repo.droppedByScan, 4);
  });

  test("재료의 칸과 출처가 명세대로다", async () => {
    const e = env();
    grown(e, { "Fake-Owner/Tool.js": 300 });
    const d = await discover(e, discoverHttp());
    const r = d.repos[0]!;
    assert.equal(r.url, "https://github.com/Fake-Owner/Tool.js");
    assert.equal(r.key, "repo:fake-owner/tool.js");
    assert.equal(r.license, "MIT");
    assert.equal(r.pushedOn, "2026-10-26");
    assert.equal(r.stars, 5300);
    assert.equal(r.growth, 300);
    assert.equal(r.forks, 10);
    assert.equal(r.createdOn, "2024-01-01");
  });

  test("라이선스 없음과 판별되지 않음을 쓰고 빼지 않는다", async () => {
    const e = env();
    const repos: FakeRepo[] = [{ name: "fake/none", stars: 3000, license: null }, { name: "fake/other", stars: 2900, license: "NOASSERTION" }];
    seedSnapshot(e.db, y, repos.map((r) => ({ ...r, stars: 2000 })));
    seedSnapshot(e.db, TARGET, repos);
    const d = await discover(e, discoverHttp());
    assert.deepEqual(d.repos.map((r) => r.license), ["없음", "판별되지 않음"]);
  });
});

describe("4.1-3 재료 정리", () => {
  test("HTML 주석, 태그, 배지, 링크만 있는 줄을 지우고 본문이 남는다", () => {
    const body = "Fake body sentence stays here.";
    const raw = [
      "<!-- hidden note -->",
      '<p align="center"><img src="https://x.test/logo.png"></p>',
      "[![Build](https://x.test/badge.svg)](https://x.test/ci) [![License](https://x.test/l.svg)](https://x.test/l)",
      "![Logo](https://x.test/logo.png)",
      "[Docs](https://x.test/docs) | [Discord](https://x.test/d)",
      "https://x.test/plain",
      "[ref]: https://x.test/ref",
      "# Title",
      "",
      body,
    ].join("\n");
    const out = cleanMaterial(raw);
    assert.ok(out.includes(body));
    assert.ok(out.includes("# Title"));
    for (const w of ["hidden note", "<img", "badge.svg", "logo.png", "Discord", "x.test"]) assert.ok(!out.includes(w), w);
  });

  test("닫히지 않은 주석 뒤는 모두 지운다", () => {
    assert.equal(cleanMaterial("keep\n<!-- never closed\nsecret text"), "keep");
  });

  test("여러 겹 태그와 글 사이 태그를 지우고 부등호 글은 둔다", () => {
    assert.equal(cleanMaterial("a <b>bold</b> word"), "a bold word");
    assert.equal(cleanMaterial("<<b>script>x"), "x");
    assert.equal(cleanMaterial("1 < 2 and 3 > 2"), "1 < 2 and 3 > 2");
  });

  test("제어 문자와 서식 문자를 먼저 지워 숨긴 주석도 지운다", () => {
    assert.equal(cleanMaterial("a​b‮c\u0007d﻿"), "abcd");
    assert.equal(cleanMaterial("x\u{E0041}\u{E0042}y"), "xy", "유니코드 태그 문자");
    assert.equal(cleanMaterial("keep<​!-- hide -->"), "keep");
    assert.equal(cleanMaterial("one\r\ntwo\tthree"), "one\ntwo\tthree");
  });

  test("정리한 뒤 2000자로 자른다", () => {
    const out = cleanMaterial(`<!-- ${"x".repeat(5000)} -->\n${"가".repeat(3000)}`);
    assert.equal(out, "가".repeat(2000));
    assert.ok(!/[\uD800-\uDBFF]$/.test(cleanMaterial("가".repeat(1999) + "😀")), "서로게이트를 반으로 자르지 않는다");
  });

  test("README 재료는 정리된 값이고 비면 후보에서 빠지되 빠짐으로 세지 않는다", async () => {
    const e = env();
    grown(e, { "fake/a": 300, "fake/badge": 200 });
    const d = await discover(e, discoverHttp({ "readme:fake/a": { status: 200, text: `<!-- note --># Real\n\n${"나".repeat(3000)}` }, "readme:fake/badge": { status: 200, text: "![x](https://x.test/y.svg)" } }));
    assert.deepEqual(d.repos.map((r) => r.name), ["fake/a"]);
    assert.equal(d.repos[0]!.readme.length, 2000);
    assert.ok(!d.repos[0]!.readme.includes("note"));
    assert.equal(d.kinds.repo.missing, 0);
  });

  test("설명도 같이 정리한다", async () => {
    const e = env();
    const repos: FakeRepo[] = [{ name: "fake/a", stars: 3000, description: "Good<!-- x --> tool​" }];
    seedSnapshot(e.db, y, repos.map((r) => ({ ...r, stars: 2000 })));
    seedSnapshot(e.db, TARGET, repos);
    assert.equal((await discover(e, discoverHttp())).repos[0]!.description, "Good tool");
  });

  test("이름은 제어·서식 문자만 지우고 글자를 바꾸지 않는다", () => {
    assert.equal(cleanName("Cal​.com <b>"), "Cal.com <b>");
  });
});

describe("정리 전 길이 상한", () => {
  test("상한은 재료 상한의 20배다(조작한 입력의 제곱 시간을 막는다)", () => {
    assert.equal(RAW_MATERIAL_CHARS, MATERIAL_CHARS * 20);
    assert.equal(cleanMaterial(`<!-- ${"x".repeat(RAW_MATERIAL_CHARS)} -->뒤 글`), "", "상한 뒤는 다루지 않는다");
  });

  test("앞부분 재료는 그대로 쓴다: 상한 안의 긴 머리 표시를 지운 본문이 앞에서부터 남는다", () => {
    const head = "![badge](https://example.org/b.svg)\n".repeat(700);
    const body = "본문 글자 ".repeat(1000);
    assert.ok(head.length < RAW_MATERIAL_CHARS);
    assert.equal(cleanMaterial(head + body), body.trim().slice(0, MATERIAL_CHARS));
  });
});

describe("4.2-1 제품 받기", () => {
  const product = (e: Env, posts: FakePost[], o: Partial<DiscoverOptions> = {}) => {
    const h = discoverHttp({ product: postsReply(posts) });
    return { h, run: discover(e, h, { token: FAKE_TOKEN, repoTestMode: true, ...o }) };
  };

  test("POST로 Bearer 토큰과 featured, VOTES, 기간을 보내고 메이커를 묻지 않는다", async () => {
    const e = env();
    const { h, run } = product(e, []);
    await run;
    const c = h.calls[0]!;
    assert.equal(c.url, "https://api.producthunt.com/v2/api/graphql");
    assert.equal(c.init?.method, "POST");
    assert.equal(c.init?.headers?.authorization, `Bearer ${FAKE_TOKEN}`);
    assert.equal(variablesOf(c).featured, true);
    assert.match(queryOf(c), /featured:\s*\$featured/);
    assert.match(queryOf(c), /order:\s*VOTES/);
    assert.ok(!/makers|user|comments|thumbnail|media|website/i.test(queryOf(c)));
  });

  test("첫 실행은 24시간이고, 다음은 지난번 받은 시각부터이며, 14일로 자른다", async () => {
    const e = env();
    let r = product(e, []);
    await r.run;
    assert.equal(variablesOf(r.h.calls[0]!).postedAfter, new Date(NOW.getTime() - 24 * HOUR).toISOString());
    const f = env();
    const at = new Date(NOW.getTime() - 3 * 24 * HOUR).toISOString();
    f.db.prepare("INSERT INTO builder_sources (source, fetched_at) VALUES ('product-hunt', ?)").run(at);
    r = product(f, []);
    await r.run;
    assert.equal(variablesOf(r.h.calls[0]!).postedAfter, at);
    const g = env();
    g.db.prepare("INSERT INTO builder_sources (source, fetched_at) VALUES ('product-hunt', ?)").run(new Date(NOW.getTime() - 20 * 24 * HOUR).toISOString());
    r = product(g, []);
    const d = await r.run;
    assert.equal(variablesOf(r.h.calls[0]!).postedAfter, new Date(NOW.getTime() - 14 * 24 * HOUR).toISOString());
    assert.ok(d.kinds.product.warnings.some((w) => w.includes("14일")));
  });

  test("받기는 시각을 앞당기지 않고 적용이 쓸 값만 낸다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "fake" }]).run;
    assert.equal(sourceState(e.db, "product-hunt").fetchedAt, null);
    assert.deepEqual(d.advance, ["product-hunt"]);
    assert.equal(d.fetchedAt, NOW.toISOString());
  });

  test("후보는 20개까지이고 번호가 저장소와 겹치지 않는다", async () => {
    const e = env();
    grown(e, { "fake/a": 300 });
    const d = await product(e, Array.from({ length: 25 }, (_, i) => ({ slug: `p-${i}` })), { repoTestMode: false }).run;
    assert.equal(MAX_PRODUCT_CANDIDATES, 20);
    assert.equal(d.products.length, 20);
    assert.deepEqual(d.products.map((p) => p.n), Array.from({ length: 20 }, (_, i) => i + 1));
    assert.equal(d.repos[0]!.n, 21);
  });

  test("주소의 쿼리를 떼고 호스트 밖 주소를 뺀다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "good" }, { slug: "bad", url: "https://evil.test/products/bad" }, { slug: "plain", url: "http://www.producthunt.com/products/plain" }]).run;
    assert.deepEqual(d.products.map((p) => p.url), ["https://www.producthunt.com/products/good"]);
    assert.equal(d.kinds.product.droppedByHost, 2);
  });

  test("한 번 실린 키는 날짜와 상관없이 뺀다", async () => {
    const e = env();
    insertDiscovery(e.db, productItem("ph:old", "2020-01-01"));
    assert.deepEqual([...publishedProductKeys(e.db)], ["ph:old"]);
    const d = await product(e, [{ slug: "old" }, { slug: "new" }]).run;
    assert.deepEqual(d.products.map((p) => p.key), ["ph:new"]);
    assert.equal(d.kinds.product.droppedByKey, 1);
  });

  test("메일 모양 이름은 빠지고 Cal.com은 지나며 원래 이름 그대로다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "cal", name: "Cal.com" }, { slug: "mail", name: "hello@example.org" }, { slug: "desc", description: "write to a@example.org" }, { slug: "tag", tagline: "youtu.be/abc" }]).run;
    assert.deepEqual(d.products.map((p) => p.name), ["Cal.com"]);
    assert.equal(d.kinds.product.droppedByScan, 3);
  });

  test("서식 문자를 지운 뒤의 이름으로 공개 검사를 한다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "z", name: "hello\u200b@example.org" }]).run;
    assert.deepEqual(d.products, []);
    assert.equal(d.kinds.product.droppedByScan, 1);
  });

  test("소개의 주석과 제로폭 문자를 지우고 이름은 서식 문자만 지운다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "x", name: "Fa​ke <One>", tagline: "Tag<!-- no -->line", description: "Real​ text<!-- ignore -->" }]).run;
    assert.equal(d.products[0]!.name, "Fake <One>");
    assert.equal(d.products[0]!.tagline, "Tagline");
    assert.equal(d.products[0]!.description, "Real text");
  });

  test("재료 칸: 주제와 투표 수와 시각이 있고 slug가 키다", async () => {
    const e = env();
    const d = await product(e, [{ slug: "tool", votes: 321, topics: ["AI", "Dev"], description: null }]).run;
    const p = d.products[0]!;
    assert.equal(p.key, "ph:tool");
    assert.deepEqual(p.topics, ["AI", "Dev"]);
    assert.equal(p.votes, 321);
    assert.equal(p.createdAt, "2026-10-27T08:00:00Z");
    assert.equal(p.description, "");
  });
});

describe("4.2-2 토큰과 실패", () => {
  const failing = async (reply: Route) => {
    const e = env();
    const d = await discover(e, discoverHttp({ product: reply }), { token: FAKE_TOKEN, repoTestMode: true, secrets: [FAKE_TOKEN] });
    return { e, d };
  };

  test("토큰이 없으면 꺼짐이고 호출이 없다", async () => {
    const e = env();
    const h = discoverHttp();
    const d = await discover(e, h, { repoTestMode: true });
    assert.equal(d.kinds.product.status, "off");
    assert.equal(h.calls.length, 0);
    assert.equal(sourceState(e.db, "product-hunt").failDays, 0);
  });

  test("401은 키를 확인하라고 알린다", async () => {
    const { e, d } = await failing({ status: 401, text: "bad token" });
    assert.equal(d.kinds.product.status, "failed");
    assert.match(d.kinds.product.reason!, /키를 확인/);
    assert.equal(d.kinds.product.failDays, 1);
    assert.deepEqual(d.advance, []);
    assert.equal(sourceState(e.db, "product-hunt").fetchedAt, null);
  });

  test("429, 시간 초과, 형식 오류는 받지 못함이고 시각을 앞당기지 않는다", async () => {
    const timeout = () => {
      const err = new Error("t");
      err.name = "TimeoutError";
      throw err;
    };
    for (const [reply, reason] of [[{ status: 429, text: "x" }, /429/], [timeout, /시간 초과/], [{ status: 200, text: "<html>" }, /HTML/], [{ status: 200, text: '{"data":{}}' }, /형식/], [{ status: 200, text: '{"errors":[{"message":"x"}]}' }, /형식/]] as const) {
      const { d } = await failing(reply);
      assert.equal(d.kinds.product.status, "failed");
      assert.match(d.kinds.product.reason!, reason);
      assert.deepEqual(d.advance, []);
    }
  });

  test("토큰 없는 제품, 끄기 값, 시험 모드 저장소가 꺼진 종류다", () => {
    assert.deepEqual(offKinds(undefined, FAKE_TOKEN, false), []);
    assert.deepEqual(offKinds(undefined, null, false), ["product"]);
    assert.deepEqual(offKinds(undefined, FAKE_TOKEN, true), ["repo"]);
    assert.deepEqual(offKinds({ sources: ["github-repos", "product-hunt"], vendors: [] }, FAKE_TOKEN, false), ["product", "repo"]);
  });

  test("연속 실패 일수를 하루에 한 번 센다", async () => {
    const e = env();
    const h = discoverHttp({ product: { status: 500, text: "x" } });
    await discover(e, h, { token: FAKE_TOKEN, repoTestMode: true });
    await discover(e, h, { token: FAKE_TOKEN, repoTestMode: true });
    const d = await discover(e, h, { token: FAKE_TOKEN, repoTestMode: true, now: new Date(NOW.getTime() + 24 * HOUR), target: "2026-10-28" });
    assert.equal(d.kinds.product.failDays, 2);
    await discover(e, discoverHttp(), { token: FAKE_TOKEN, repoTestMode: true, now: new Date(NOW.getTime() + 48 * HOUR), target: "2026-10-29" });
    assert.equal(sourceState(e.db, "product-hunt").failDays, 2, "받기가 성공해도 적용 전에는 그대로다(쓰기가 실패할 수 있다)");
  });

  test("토큰이 키 값 목록에 있어 결과물 검사와 공개 전 점검에 걸린다", () => {
    assert.ok(KEY_NAMES.includes("PRODUCT_HUNT_TOKEN"));
    const dir = tempDir();
    const secrets = secretValues({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN }, dir);
    assert.deepEqual(secrets, [FAKE_TOKEN]);
    fs.writeFileSync(path.join(dir, "page.html"), `<p>${FAKE_TOKEN}</p>`);
    assert.ok(checkOutput(dir, null, secrets).findings.some((f) => f.kind === "키 값이 들어 있음"));
    const repo = tempRepo();
    fs.writeFileSync(path.join(repo, "leak.txt"), FAKE_TOKEN);
    gitIn(repo, "add", "leak.txt");
    const tracked = precheck({ repo, commits: [], trackedFiles: true, home: null, secrets }).findings;
    assert.ok(tracked.some((f) => f.kind === "키 값이 들어 있음"), JSON.stringify(tracked));
  });
});

// ---- 명령 ----

function setup(env2: Record<string, string> = {}) {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, TARGET);
  addBrief(db, TARGET);
  db.close();
  const environment: NodeJS.ProcessEnv = { TIDWYN_DATA_DIR: dataDir, HOME: "/Users/fake-home", ...env2 };
  return { repo, dataDir, dbFile, environment };
}

type S = ReturnType<typeof setup>;

function start(s: S): string {
  const ctx = makeCtx(s.repo, s.environment);
  assert.equal(main(["start"], ctx), 0, ctx.text());
  return /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
}

async function fetchCmd(s: S, runFile: string, h: DiscoverHttp, over: Record<string, unknown> = {}) {
  const ctx = { ...makeCtx(s.repo, s.environment), builderHttp: h.http, ...over };
  const code = await mainAsync(["builder-fetch", "--run", runFile], ctx);
  return { code, text: ctx.text() };
}

const withDb = <T>(s: S, f: (db: ReturnType<typeof openDb>) => T): T => {
  const db = openDb(s.dbFile);
  try {
    return f(db);
  } finally {
    db.close();
  }
};

function seed(s: S, grow: Record<string, number>): void {
  withDb(s, (db) => {
    const names = Object.keys(grow);
    seedSnapshot(db, y, names.map((name) => ({ name, stars: 5000 })));
    seedSnapshot(db, TARGET, names.map((name) => ({ name, stars: 5000 + grow[name]! })));
  });
}

const FAKE_README = "지어낸리드미글자열QZX";
const FAKE_NAME = "fake/secret-tool-qzw";
const FAKE_PRODUCT = "지어낸제품이름QZV";

describe("받기 명령과 N9", () => {
  test("9.8 소스를 다 받은 뒤에 새 종류를 부른다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    seed(s, { "fake/a": 300 });
    const h = discoverHttp({ product: postsReply([{ slug: "p" }]) });
    const f = await fetchCmd(s, start(s), h);
    assert.equal(f.code, 0, f.text);
    const urls = h.calls.map((c) => c.url);
    const firstNew = urls.findIndex((u) => u.includes("producthunt") || u.includes("/repos/fake/"));
    const lastOld = urls.findLastIndex((u) => !u.includes("producthunt") && !u.includes("/repos/fake/"));
    assert.ok(firstNew > lastOld, `${firstNew} ${lastOld}`);
  });

  test("도구 변화 후보가 밀려나지 않고 파일이 나뉘며 메인 출력과 기록에 이름과 글이 없다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    seed(s, { [FAKE_NAME]: 300, "fake/b": 200 });
    const runFile = start(s);
    const tool = rss([{ title: "Fake change", link: "https://platform.claude.com/docs/a", date: new Date(NOW.getTime() - HOUR).toUTCString(), text: "tool text" }]);
    const h = discoverHttp({ product: postsReply(Array.from({ length: 25 }, (_, i) => ({ slug: `p${i}`, name: `${FAKE_PRODUCT}${i}`, description: FAKE_README }))), [`readme:${FAKE_NAME}`]: { status: 200, text: `# Head\n\n${FAKE_README}` } }, fakeHttp({ "claude-notes": tool }));
    const f = await fetchCmd(s, runFile, h);
    assert.equal(f.code, 0, f.text);
    const secrets = [FAKE_README, FAKE_NAME, FAKE_PRODUCT];
    const list = fs.readFileSync(path.join(s.dataDir, "work", "builder.candidates.md"), "utf8");
    const json = fs.readFileSync(path.join(s.dataDir, "work", "builder.candidates.json"), "utf8");
    for (const w of secrets) {
      assert.ok(!f.text.includes(w), `출력 ${w}`);
      assert.ok(!list.includes(w), `목록 ${w}`);
      assert.ok(!json.includes(w), `후보 ${w}`);
      assert.ok(!JSON.stringify(readRun(runFile)).includes(w), `기록 ${w}`);
    }
    assert.match(list, /Fake change/);
    const raw = fs.readFileSync(discoverWorkFile(s.dataDir, "candidates"), "utf8");
    assert.ok(raw.includes(FAKE_NAME) && raw.includes(FAKE_README));
    assert.ok(fs.readFileSync(discoverWorkFile(s.dataDir, "list"), "utf8").includes(FAKE_README));
    assert.match(f.text, /새 제품: 확인함, 후보 20건/);
    assert.match(f.text, /뜨는 저장소: 확인함, 후보 2건/);
    const sum = makeCtx(s.repo, s.environment);
    main(["summary", "--run", runFile], sum);
    assert.match(sum.text(), /새 제품: 확인함/);
    for (const w of secrets) assert.ok(!sum.text().includes(w), `요약 ${w}`);
    const backup = JSON.stringify(withDb(s, (db) => buildBuilderBackup(db, 7)));
    for (const w of secrets) assert.ok(!backup.includes(w), `백업 ${w}`);
    assert.ok(!backup.includes("repo_snapshots"));
  });

  test("도구 변화가 끝난 날 끝나지 않은 종류만 받고 9.8 소스, 다시 알림, 도구 변화 파일을 내지 않는다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    withDb(s, (db) => db.prepare("INSERT INTO builder_dates (target_date, status) VALUES (?, 'checked')").run(TARGET));
    const runFile = start(s);
    const h = discoverHttp({ product: postsReply([{ slug: "only" }]) });
    const f = await fetchCmd(s, runFile, h);
    assert.equal(f.code, 0, f.text);
    assert.deepEqual(h.tools.calls, [], "9.8 소스를 부르지 않는다");
    assert.deepEqual(h.calls.map((c) => c.url), ["https://api.producthunt.com/v2/api/graphql"]);
    assert.ok(!fs.existsSync(path.join(s.dataDir, "work", "builder.candidates.json")));
    assert.ok(!fs.existsSync(path.join(s.dataDir, "work", "builder.candidates.md")));
    assert.equal(readRun(runFile).builderFetch?.status, "kindsOnly");
    assert.match(f.text, /도구 변화는 이미 끝남/);
    assert.match(f.text, /새 제품: 확인함, 후보 1건/);
    assert.match(f.text, /뜨는 저장소: 받지 못함/);
    const again = await fetchCmd(s, runFile, h);
    assert.match(again.text, /이미 받았다/);
    assert.equal(h.calls.length, 1);
  });

  test("이미 끝남은 새 종류까지 끝났을 때만 쓴다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    withDb(s, (db) => {
      db.prepare("INSERT INTO builder_dates (target_date, status) VALUES (?, 'partial')").run(TARGET);
      setKindStatus(db, TARGET, "product", "checked");
      setKindStatus(db, TARGET, "repo", "off");
    });
    const runFile = start(s);
    const h = discoverHttp();
    const f = await fetchCmd(s, runFile, h);
    assert.match(f.text, /빌더: 2026-10-27 이미 끝남/);
    assert.equal(h.calls.length, 0);
    assert.equal(readRun(runFile).builderFetch?.status, "alreadyDone");
  });

  test("받기가 멈춰도 이미 끝난 종류는 끝난 상태로 두고 요약에 받지 못함으로 쓰지 않는다", async () => {
    const s = setup();
    withDb(s, (db) => setKindStatus(db, TARGET, "product", "checked"));
    const runFile = start(s);
    fs.mkdirSync(discoverWorkFile(s.dataDir, "candidates"), { recursive: true });
    const f = await fetchCmd(s, runFile, discoverHttp());
    assert.equal(readRun(runFile).builderKinds?.product.status, "done");
    assert.equal(readRun(runFile).builderKinds?.repo.status, "failed");
    assert.match(f.text, /새 제품: 이미 끝남/);
    assert.equal(main(["builder-fail", "--run", runFile], makeCtx(s.repo, s.environment)), 0);
    const sum = makeCtx(s.repo, s.environment);
    main(["summary", "--run", runFile], sum);
    assert.match(sum.text(), /새 제품: 이미 끝남/);
    assert.match(sum.text(), /뜨는 저장소: 받지 못함/);
  });

  test("9.8 받기가 멈춰도 새 종류는 받는다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    const runFile = start(s);
    const h = discoverHttp({ product: postsReply([{ slug: "still" }]) });
    let n = 0;
    const clock = () => {
      n++;
      if (n === 2) throw new Error("가짜 멈춤");
      return 1000;
    };
    const f = await fetchCmd(s, runFile, h, { builderClock: clock });
    assert.equal(f.code, 1);
    assert.equal(readRun(runFile).builderFetch?.status, "crashed");
    assert.equal(readRun(runFile).builderKinds?.product.status, "checked");
    assert.equal(readDiscoverWork(s.dataDir).ok, true);
  });

  test("새 종류 쪽이 멈춰도 도구 변화는 성공으로 끝나고 종류별로 받지 못함이 된다", async () => {
    const s = setup();
    const runFile = start(s);
    fs.mkdirSync(discoverWorkFile(s.dataDir, "candidates"), { recursive: true });
    const f = await fetchCmd(s, runFile, discoverHttp());
    assert.equal(f.code, 0, f.text);
    assert.equal(readRun(runFile).builderFetch?.status, "checked");
    assert.ok(fs.existsSync(path.join(s.dataDir, "work", "builder.candidates.json")));
    assert.equal(readRun(runFile).builderKinds?.product.status, "failed");
    assert.equal(readRun(runFile).builderKinds?.repo.status, "failed");
    assert.match(f.text, /새 제품: 받지 못함/);
  });

  test("실패 사유, 기록, 후보 파일에 토큰이 없다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    const runFile = start(s);
    const h = discoverHttp({ product: { status: 401, text: `{"error":"bad token ${FAKE_TOKEN}"}` } });
    const f = await fetchCmd(s, runFile, h);
    assert.equal(f.code, 0);
    assert.match(f.text, /키를 확인/);
    assert.ok(!f.text.includes(FAKE_TOKEN));
    assert.ok(!fs.readFileSync(runFile, "utf8").includes(FAKE_TOKEN));
    assert.ok(!fs.readFileSync(discoverWorkFile(s.dataDir, "candidates"), "utf8").includes(FAKE_TOKEN));
    assert.ok(!fs.readFileSync(discoverWorkFile(s.dataDir, "list"), "utf8").includes(FAKE_TOKEN));
    const sum = makeCtx(s.repo, s.environment);
    main(["summary", "--run", runFile], sum);
    assert.match(sum.text(), /새 제품: 받지 못함 1일째\(HTTP 401: 키를 확인하라\)/);
  });

  test("끄기 값으로 둘 다 끄면 호출이 없고 꺼짐으로 나온다", async () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    seed(s, { "fake/a": 300 });
    const h = discoverHttp();
    const f = await fetchCmd(s, start(s), h, { builderOff: { sources: ["github-repos", "product-hunt"], vendors: [] } });
    assert.match(f.text, /새 제품: 꺼짐/);
    assert.match(f.text, /뜨는 저장소: 꺼짐/);
    assert.ok(!h.calls.some((c) => c.url.includes("producthunt") || c.url.includes("/repos/fake/")));
  });

  test("시험 모드의 받기는 저장소를 끄고 지정 모드는 켠다", async () => {
    const s = setup();
    const ctx = makeCtx(s.repo, s.environment);
    assert.equal(main(["start", "test"], ctx), 0, ctx.text());
    const runFile = /실행 기록: (.+)/.exec(ctx.text())![1]!.trim();
    const db = openDb(readRun(runFile).dbPath);
    addBrief(db, TARGET);
    seedSnapshot(db, y, [{ name: "fake/a", stars: 1000 }]);
    seedSnapshot(db, TARGET, [{ name: "fake/a", stars: 1100 }]);
    db.close();
    const h = discoverHttp();
    const f = await fetchCmd(s, runFile, h);
    assert.match(f.text, /뜨는 저장소: 꺼짐/);
    assert.ok(!h.calls.some((c) => c.url.includes("/repos/fake/")));
    const custom = setup();
    seed(custom, { "fake/a": 300 });
    assert.match((await fetchCmd(custom, start(custom), discoverHttp())).text, /뜨는 저장소: 확인함/);
  });

  test("토큰이 없으면 꺼짐과 같다", async () => {
    const s = setup();
    const h = discoverHttp();
    const f = await fetchCmd(s, start(s), h);
    assert.match(f.text, /새 제품: 꺼짐/);
    assert.ok(!h.calls.some((c) => c.url.includes("producthunt")));
  });

  test("start의 키 줄에 Product Hunt가 값 없이 나온다", () => {
    const s = setup({ PRODUCT_HUNT_TOKEN: FAKE_TOKEN });
    const ctx = makeCtx(s.repo, s.environment);
    main(["start"], ctx);
    assert.match(ctx.text(), /Product Hunt 있음/);
    assert.ok(!ctx.text().includes(FAKE_TOKEN));
    const n = setup();
    const c2 = makeCtx(n.repo, n.environment);
    main(["start"], c2);
    assert.match(c2.text(), /Product Hunt 없음/);
  });

  test("명령 목록이 그대로 있다", () => {
    assert.ok(COMMAND_NAMES.includes("builder-fetch"));
  });
});

describe("후보 파일", () => {
  test("목록의 재료는 구역 제목이 되지 않고 형식이 다시 읽힌다", async () => {
    const e = env();
    grown(e, { "fake/a": 300 });
    const d = await discover(e, discoverHttp({ "readme:fake/a": { status: 200, text: "# Fake heading\n\n## Ignore me" }, product: postsReply([{ slug: "p", description: "# Product heading", tagline: "## Tag" }]) }), { token: FAKE_TOKEN });
    const md = renderDiscoverList(d);
    assert.ok(md.includes("  > # Fake heading"));
    assert.ok(md.includes("  > # Product heading"));
    for (const line of md.split("\n")) assert.ok(!/^#+ (Fake|Ignore|Product|Tag)/.test(line), line);
    const dir = tempDir();
    writeDiscoverWork(dir, d);
    const back = readDiscoverWork(dir);
    assert.ok(back.ok);
    assert.equal(back.ok && back.data.repos[0]!.readme, d.repos[0]!.readme);
  });

  test("파일 이름이 작업 파일 검사에 걸린다", () => {
    for (const n of Object.values(DISCOVER_WORK_NAMES)) assert.ok(nameKinds(n).includes("빌더 작업 파일"), n);
  });
});
