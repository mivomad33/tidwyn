import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { MAX_BODY_CHARS } from "../src/builderFetch.ts";
import { capDrafts, buildWorkData, renderBuilderList, SHORT_MAX_CANDIDATES } from "../src/builderWork.ts";
import { urlKey, type Draft } from "../src/builderFetch.ts";
import { BUILDER_SOURCES, ghsaUrl } from "../src/builderSources.ts";
import { addEmitted, emittedKeys, insertBuilderItem, isBuilderDone, liveRows, sourceState, type NewBuilderItem } from "../src/builderStore.ts";
import { HOUR, NOW, TARGET, advisory, apply, atom, env, fakeHttp, nextDay, release, rss, run } from "./builderFixtures.ts";
import { cleanupTemp } from "./helpers.ts";

after(cleanupTemp);

const iso = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toISOString();
const utc = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * HOUR).toUTCString();
const titles = (r: { drafts: Draft[] }) => r.drafts.map((d) => d.title);

function plainItem(keys: string[], title = "가짜 항목 제목"): NewBuilderItem {
  return { field: "보안", title, whatChanged: "바뀐 내용", who: "개발자", action: "없음", why: "이유", due: null, sources: [{ name: "가짜", url: "https://github.com/advisories/x" }], issue: null, reminderOf: null, keys };
}

describe("4.1-1 기간과 출처", () => {
  test("기간 안 항목만 후보가 되고 첫 실행은 24시간이다", async () => {
    const e = env();
    const http = fakeHttp({ "claude-code": JSON.stringify([release("v1.2.3", iso(2), "- now by default"), release("v1.2.2", iso(30), "- now by default")]) });
    const r = await run(e, http);
    assert.deepEqual(titles(r), ["Claude Code 릴리스 v1.2.3"]);
    assert.deepEqual(r.drafts[0]!.keys, ["npm:@anthropic-ai/claude-code:1.2.3"]);
  });

  test("소스별 시각이 따로 앞당겨지고, 14일로 잘리며 잘린 기간이 보고된다", async () => {
    const e = env();
    const http = fakeHttp({ "codex": { status: 500, text: "x" } });
    const r = await run(e, http);
    apply(e, r);
    assert.equal(sourceState(e.db, "claude-code").fetchedAt, NOW.toISOString());
    assert.equal(sourceState(e.db, "codex").fetchedAt, null, "실패한 소스의 시각은 그대로다");
    const later = new Date(NOW.getTime() + 20 * 24 * HOUR);
    const http2 = fakeHttp({ "claude-code": JSON.stringify([release("v2.0.1", new Date(later.getTime() - 15 * 24 * HOUR).toISOString(), "- breaking"), release("v2.0.2", new Date(later.getTime() - 13 * 24 * HOUR).toISOString(), "- breaking")]) });
    const r2 = await run(e, http2, { now: later, target: "2026-11-16" });
    assert.deepEqual(titles(r2), ["Claude Code 릴리스 v2.0.2"]);
    assert.ok(r2.sources.find((s) => s.id === "claude-code")!.clampedFrom, "잘린 소스가 보고된다");
  });

  test("날짜만 있는 항목과 00:00:00 항목은 다음 실행에서 후보가 된다(기간 시작 전날까지)", async () => {
    const e = env();
    apply(e, await run(e, fakeHttp()));
    const later = new Date(NOW.getTime() + 24 * HOUR);
    const feed = rss([
      { title: "Fake date only", link: "https://platform.claude.com/docs/a", date: "Tue, 27 Oct 2026" },
      { title: "Fake midnight", link: "https://platform.claude.com/docs/b", date: "Tue, 27 Oct 2026 00:00:00 GMT" },
      { title: "Fake too old", link: "https://platform.claude.com/docs/c", date: "Mon, 26 Oct 2026 00:00:00 GMT" },
    ]);
    const r = await run(e, fakeHttp({ "claude-notes": feed }), { now: later, target: "2026-10-28" });
    assert.deepEqual(titles(r), ["Fake date only", "Fake midnight"]);
  });

  test("호스트 밖 주소와 http 주소의 후보는 빠진다", async () => {
    const e = env();
    const feed = rss([
      { title: "Fake ok", link: "https://platform.claude.com/docs/a", date: utc(1) },
      { title: "Fake other", link: "https://example.com/a", date: utc(1) },
      { title: "Fake http", link: "http://platform.claude.com/docs/b", date: utc(1) },
    ]);
    const r = await run(e, fakeHttp({ "claude-notes": feed }));
    assert.deepEqual(titles(r), ["Fake ok"]);
    assert.equal(r.droppedByHost, 2);
  });

  test("GHSA는 검토 시각으로 비교하고 철회 공지와 검토 없는 공지는 빠진다", async () => {
    const e = env();
    const http = fakeHttp({
      "ghsa:critical": JSON.stringify([
        advisory("GHSA-aaaa-aaaa-aaaa", "next", "critical", iso(2), { published_at: iso(800) }),
        advisory("GHSA-bbbb-bbbb-bbbb", "react", "critical", iso(800), { published_at: iso(2) }),
        advisory("GHSA-cccc-cccc-cccc", "vite", "critical", iso(2), { withdrawn_at: iso(1) }),
        advisory("GHSA-dddd-dddd-dddd", "typescript", "critical", null),
      ]),
    });
    const r = await run(e, http);
    assert.deepEqual(r.drafts.map((d) => d.keys), [["ghsa:GHSA-aaaa-aaaa-aaaa"]]);
  });

  test("문서 소스와 KEV 후보의 출처 주소가 2.4대로다", async () => {
    const e = env();
    await run(e, fakeHttp());
    const kev = JSON.stringify({ vulnerabilities: [{ cveID: "CVE-2026-0001", vendorProject: "Vercel", product: "Next.js", vulnerabilityName: "Fake flaw", dateAdded: "2026-10-27", shortDescription: "Fake", dueDate: "2026-11-30" }] });
    const http = fakeHttp({ kev, "openai-pricing": "| Model | Price |\n|---|---|\n| fake-1 | $9 |\n| fake-2 | $2 |\n", "gemini-pricing": "| Model | Price |\n|---|---|\n| fake-1 | $9 |\n| fake-2 | $2 |\n" });
    const r = await run(e, http);
    assert.equal(r.drafts.find((d) => d.source === "kev")!.url, "https://www.cisa.gov/known-exploited-vulnerabilities-catalog");
    assert.equal(r.drafts.find((d) => d.source === "openai-pricing")!.url, "https://developers.openai.com/api/docs/pricing");
    assert.equal(r.drafts.find((d) => d.source === "gemini-pricing")!.url, "https://ai.google.dev/gemini-api/docs/pricing");
    assert.ok(!r.drafts.find((d) => d.source === "kev")!.material.includes("2026-11-30"), "KEV dueDate는 재료에 없다");
  });

  test("코드의 주소 목록에 금지 주소가 없다", () => {
    const urls = [...BUILDER_SOURCES.flatMap((s) => [s.url, "page" in s ? s.page : ""]), ghsaUrl("critical", "2026-10-27")].join("\n");
    for (const banned of ["releases.atom", "nodejs.org/dist", "aikido.dev", "cursor.com", "endoflife.date/api/v1/products/vite"]) assert.ok(!urls.includes(banned), banned);
    const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "builderSources.ts"), "utf8");
    for (const banned of ["releases.atom", "nodejs.org/dist", "aikido.dev", "cursor.com", "products/vite"]) assert.ok(!source.includes(banned), banned);
  });
});

describe("4.1-2 필터", () => {
  const one = async (id: string, body: string) => titles(await run(env(), fakeHttp({ [id]: body })));

  test("코딩 도구: 프리릴리스 제외, 메이저와 키워드 통과, 키워드 없는 패치 제외, 맞은 줄만 후보에 든다", async () => {
    const e = env();
    const r = await run(
      e,
      fakeHttp({
        codex: JSON.stringify([
          release("v3.0.0-beta.1", iso(1), "- breaking"),
          release("v3.0.0", iso(1), "Plain headline text"),
          release("v2.9.1", iso(1), "- fix typo\n- now runs in sandbox\n- other note"),
          release("v2.9.0", iso(1), "- fix typo"),
        ]),
      }),
    );
    assert.deepEqual(titles(r), ["Codex 릴리스 v3.0.0", "Codex 릴리스 v2.9.1"]);
    assert.equal(r.drafts[0]!.material, "Plain headline text", "맞은 줄 없는 메이저의 재료");
    assert.equal(r.drafts[0]!.reason, "메이저 버전");
    assert.equal(r.drafts[1]!.material, "- now runs in sandbox", "맞은 줄만 후보에 든다");
  });

  test("GHSA: 다운로드 경계값, 추적 패키지 high, 같은 패키지 묶기, credits 없음", async () => {
    const e = env();
    const r = await run(
      e,
      fakeHttp({
        "ghsa:critical": JSON.stringify([
          advisory("GHSA-1111-1111-1111", "fake-under", "critical", iso(1)),
          advisory("GHSA-2222-2222-2222", "fake-over", "critical", iso(1), { credits: [{ login: "지어낸제보자문자열" }] }),
          advisory("GHSA-3333-3333-3333", "fake-over", "critical", iso(1)),
        ]),
        "ghsa:high": JSON.stringify([advisory("GHSA-4444-4444-4444", "next", "high", iso(1)), advisory("GHSA-5555-5555-5555", "fake-high", "high", iso(1))]),
        "npm:fake-under": '{"downloads":999999}',
        "npm:fake-over": '{"downloads":1000000}',
      }),
    );
    assert.deepEqual(r.drafts.map((d) => d.keys), [["ghsa:GHSA-2222-2222-2222", "ghsa:GHSA-3333-3333-3333"], ["ghsa:GHSA-4444-4444-4444"]]);
    assert.ok(!JSON.stringify(buildWorkData(e.db, r)).includes("지어낸제보자문자열"));
  });

  test("끈 소스는 호출하지 않고 실패로 세지 않는다", async () => {
    const e = env();
    const http = fakeHttp();
    const r = await run(e, http, { off: { sources: ["socket"], vendors: [] } });
    assert.ok(!http.calls.some((c) => c.includes("socket.dev")));
    assert.equal(r.sources.find((s) => s.id === "socket")!.status, "off");
    assert.equal(r.status, "checked");
  });

  test("공급사 하나를 끄면 그 문서가 모두 호출되지 않고 저장된 숫자 행이 남고 날짜 상태가 확인함이다", async () => {
    const e = env();
    await run(e, fakeHttp());
    const rows = liveRows(e.db, "openai-pricing").length;
    assert.ok(rows > 0);
    const http = fakeHttp();
    const r = await run(e, http, { off: { sources: [], vendors: ["openai"] } });
    assert.ok(!http.calls.some((c) => c.includes("developers.openai.com") || c.includes("openai/codex")));
    assert.equal(liveRows(e.db, "openai-pricing").length, rows);
    assert.equal(r.status, "checked");
  });

  test("분야별 통과 1건과 제외 1건", async () => {
    assert.deepEqual(await one("claude-notes", rss([{ title: "Fake notes", link: "https://platform.claude.com/docs/a", date: utc(1) }])), ["Fake notes"]);
    const socket = atom([{ title: "Fake package compromised", link: "https://socket.dev/blog/a", date: iso(1) }, { title: "Fake company news", link: "https://socket.dev/blog/b", date: iso(1) }]);
    assert.deepEqual(await one("socket", socket), ["Fake package compromised"]);
    const next = rss([{ title: "Next.js 17", link: "https://nextjs.org/blog/a", date: utc(1) }, { title: "Next.js 17 Beta", link: "https://nextjs.org/blog/b", date: utc(1) }, { title: "Next.js 16.2", link: "https://nextjs.org/blog/c", date: utc(1) }, { title: "Fake security release", link: "https://nextjs.org/blog/d", date: utc(1) }]);
    assert.deepEqual(await one("nextjs", next), ["Next.js 17", "Fake security release"]);
    const cf = rss([{ title: "New pricing for fake", link: "https://developers.cloudflare.com/changelog/a", date: utc(1) }, { title: "New dashboard", link: "https://developers.cloudflare.com/changelog/b", date: utc(1) }]);
    assert.deepEqual(await one("cloudflare", cf), ["New pricing for fake"]);
    const kev = JSON.stringify({ vulnerabilities: [{ cveID: "CVE-2026-0002", vendorProject: "Fake", product: "Router", dateAdded: TARGET }, { cveID: "CVE-2026-0003", vendorProject: "Meta", product: "React", dateAdded: TARGET }] });
    assert.deepEqual((await run(env(), fakeHttp({ kev }))).drafts.map((d) => d.keys[0]), ["kev:CVE-2026-0003"]);
  });

  test("지원 종료 90일 경계", async () => {
    const body = (name: string, eolFrom: string) => ({ name, eolFrom });
    const eol = JSON.stringify({ result: { releases: [body("90", "2027-01-25"), body("91", "2027-01-26"), body("0", TARGET)] } });
    const r = await run(env(), fakeHttp({ "eol-nodejs": eol }));
    assert.deepEqual(r.drafts.map((d) => d.keys[0]), ["eol:nodejs:90"]);
    assert.equal(r.drafts[0]!.tentative, true, "endoflife.date는 잠정이다");
  });

  test("상한을 넘으면 지원 종료·숫자·보안이 먼저 남고 분야별로 고르게 잘리며 잘린 수가 보인다", () => {
    const d = (kind: Draft["kind"], field: Draft["field"], i: number): Draft => ({ kind, field, source: "s", sourceLabel: "s", title: `${field}${i}`, material: "m", url: "https://x.test/", keys: [`k${field}${i}`], reason: "r", publishedOn: null, tentative: false });
    const upd = [...Array.from({ length: 6 }, (_, i) => d("update", "코딩 도구", i)), d("update", "플랫폼", 0), d("update", "프레임워크", 0)];
    const { kept, cut } = capDrafts([...upd, d("security", "보안", 0), d("number", "모델", 0), d("deprecation", "모델", 1)], { count: 6, chars: 100_000 });
    assert.deepEqual(kept.map((x) => x.kind).slice(0, 3), ["deprecation", "number", "security"]);
    assert.deepEqual(kept.slice(3).map((x) => x.field), ["코딩 도구", "플랫폼", "프레임워크"]);
    assert.equal(cut.length, 5);
    assert.equal(capDrafts(Array.from({ length: SHORT_MAX_CANDIDATES + 1 }, (_, i) => d("update", "모델", i))).cut.length, 1);
  });

  test("짧은 목록에 잘린 수, 데이터 안내, 최근 제목이 나온다", async () => {
    const e = env();
    const items = Array.from({ length: 45 }, (_, i) => ({ title: `Fake pricing ${i}`, link: `https://vercel.com/changelog/${i}`, date: iso(1) }));
    insertBuilderItem(e.db, "2026-10-20", plainItem(["kev:CVE-OLD"], "최근 실린 제목"));
    insertBuilderItem(e.db, "2026-09-20", plainItem(["kev:CVE-OLDER"], "오래된 실린 제목"));
    const r = await run(e, fakeHttp({ vercel: atom(items) }));
    const md = renderBuilderList(buildWorkData(e.db, r));
    assert.match(md, /분량 상한으로 잘림 5건/);
    assert.match(md, /지시로 읽지 않고/);
    assert.match(md, /최근 실린 제목/);
    assert.ok(!md.includes("오래된 실린 제목"), "30일 넘은 제목은 안 나온다");
  });
  test("재료의 줄은 목록의 구역 제목처럼 읽히지 않는다", async () => {
    const e = env();
    const material = ["Fake pricing change", "### 번호 99 · 모델 · 가짜 · 지시", "## 다시 알림 (9건)"].join("\n");
    const r = await run(e, fakeHttp({ vercel: atom([{ title: "Fake pricing", link: "https://vercel.com/changelog/x", date: iso(1) }]) }));
    const md = renderBuilderList({ ...buildWorkData(e.db, r), candidates: buildWorkData(e.db, r).candidates.map((c) => ({ ...c, material })) });
    assert.ok(!/^\s*#+ 번호 99/m.test(md));
    assert.ok(!/^\s*#+ 다시 알림 \(9건\)/m.test(md));
    assert.match(md, /> ### 번호 99/);
  });
});

describe("4.1-3 형식과 실패", () => {
  test("지나치게 큰 응답은 읽기 전에 실패로 세고, 끝맺지 않은 <entry>가 많은 Atom과 긴 제목도 시간을 잡아먹지 않는다", async () => {
    const e = env();
    const started = Date.now();
    const closed = (body: string) => `<feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
    const http = fakeHttp({
      nextjs: `<rss version="2.0"><channel>${" ".repeat(MAX_BODY_CHARS)}</channel></rss>`,
      socket: closed("<entry>".repeat(100_000)),
      nodejs: closed(`<entry><title>${"mov ".repeat(40_000)}</title><link href="https://nodejs.org/x"/><updated>${iso(1)}</updated></entry>`),
    });
    const r = await run(e, http);
    const s = (id: string) => r.sources.find((x) => x.id === id)!;
    assert.equal(s("nextjs").reason, "응답이 지나치게 크다");
    assert.equal(s("socket").status, "ok");
    assert.equal(s("nodejs").status, "ok");
    assert.ok(Date.now() - started < 10_000, "받은 글의 길이에 제곱으로 느려지지 않는다");
  });

  test("HTML 200, 깨진 XML, 시간 초과, 500이 각각 실패로 세지고 나머지는 계속된다", async () => {
    const e = env();
    const timeout = async () => {
      const err = new Error("timed out");
      err.name = "TimeoutError";
      throw err;
    };
    const http = fakeHttp({
      nextjs: "<!doctype html><html></html>",
      react: '<rss version="2.0"><channel><item>',
      vite: timeout,
      typescript: { status: 500, text: "boom" },
      "claude-notes": rss([{ title: "Fake ok", link: "https://platform.claude.com/docs/a", date: utc(1) }]),
    });
    const r = await run(e, http);
    const s = (id: string) => r.sources.find((x) => x.id === id)!;
    assert.equal(s("nextjs").reason, "HTML 페이지가 왔다");
    assert.equal(s("react").reason, "피드가 깨졌다");
    assert.equal(s("vite").reason, "시간 초과");
    assert.equal(s("typescript").reason, "HTTP 500");
    assert.equal(s("nextjs").failDays, 1);
    assert.equal(r.status, "partial");
    assert.deepEqual(titles(r), ["Fake ok"]);
  });

  test("연속 실패 일수가 쌓이고 같은 날은 한 번이며 성공하면 지워진다", async () => {
    const e = env();
    const bad = () => fakeHttp({ nextjs: { status: 500, text: "x" } });
    await run(e, bad());
    await run(e, bad());
    assert.equal(sourceState(e.db, "nextjs").failDays, 1);
    await run(e, bad(), nextDay(1));
    assert.equal(sourceState(e.db, "nextjs").failDays, 2);
    await run(e, fakeHttp(), nextDay(2));
    assert.equal(sourceState(e.db, "nextjs").failDays, 0);
  });

  test("실패한 소스의 항목이 다음 실행에서 후보가 된다", async () => {
    const e = env();
    apply(e, await run(e, fakeHttp()));
    const d1 = nextDay(1);
    const failed = await run(e, fakeHttp({ nextjs: { status: 500, text: "x" } }), d1);
    apply(e, failed);
    const d2 = nextDay(2);
    const r = await run(e, fakeHttp({ nextjs: rss([{ title: "Next.js 17", link: "https://nextjs.org/blog/a", date: new Date(d1.now.getTime() - HOUR).toUTCString() }]) }), d2);
    assert.deepEqual(titles(r), ["Next.js 17"]);
  });

  test("npm 500이면 GHSA 시각이 그대로이고 다음 실행에 그 공지가 후보가 되며, npm 404는 실패가 아니다", async () => {
    const e = env();
    const ghsa = JSON.stringify([advisory("GHSA-6666-6666-6666", "fake-pkg", "critical", iso(1))]);
    const r = await run(e, fakeHttp({ "ghsa:critical": ghsa, "npm:fake-pkg": { status: 500, text: "x" } }));
    assert.equal(r.sources.find((s) => s.id === "ghsa")!.status, "failed");
    apply(e, r);
    assert.equal(sourceState(e.db, "ghsa").fetchedAt, null);
    const r2 = await run(e, fakeHttp({ "ghsa:critical": ghsa, "npm:fake-pkg": '{"downloads":2000000}' }), { now: new Date(NOW.getTime() + HOUR) });
    assert.deepEqual(r2.drafts.map((d) => d.keys[0]), ["ghsa:GHSA-6666-6666-6666"]);
    const r3 = await run(env(), fakeHttp({ "ghsa:critical": ghsa, "npm:fake-pkg": { status: 404, text: "{}" } }));
    assert.equal(r3.sources.find((s) => s.id === "ghsa")!.status, "ok");
    assert.equal(r3.drafts.length, 0);
  });

  test("명령 전체 상한을 넘으면 남은 소스가 실패로 세진다", async () => {
    const e = env();
    let t = 0;
    const http = fakeHttp();
    const r = await run(e, http, { clock: () => (t += 10), deadlineMs: 35 });
    assert.ok(r.sources.filter((s) => s.reason === "명령 전체 시간 상한을 넘었다").length > 10);
    assert.ok(http.calls.length < 5);
    assert.equal(r.status, "partial");
  });

  test("피드 한도 경고가 나오고 <br />로 시작하는 문서는 성공이다", async () => {
    const e = env();
    const items = Array.from({ length: 10 }, (_, i) => ({ title: `Fake ${i}`, link: `https://github.blog/changelog/${i}`, date: iso(1) }));
    const r = await run(e, fakeHttp({ copilot: atom(items), "openai-pricing": "<br />\n| Model | Price |\n|---|---|\n| fake-1 | $1 |\n" }));
    assert.ok(r.warnings.some((w) => w.includes("Copilot") && w.includes("10건")));
    assert.equal(r.sources.find((s) => s.id === "openai-pricing")!.status, "ok");
  });
});

describe("4.1-4 중복", () => {
  const ghsaBody = (ids: string[]) => JSON.stringify(ids.map((id) => advisory(id, "next", "critical", iso(1))));

  test("실린 키의 후보가 빠지고 새 키가 하나라도 있는 후보는 남는다", async () => {
    const e = env();
    insertBuilderItem(e.db, "2026-10-20", plainItem(["ghsa:GHSA-7777-7777-7777"]));
    const r1 = await run(e, fakeHttp({ "ghsa:critical": ghsaBody(["GHSA-7777-7777-7777"]) }));
    assert.equal(r1.drafts.length, 0);
    assert.equal(r1.droppedByKey, 1);
    const r2 = await run(e, fakeHttp({ "ghsa:critical": ghsaBody(["GHSA-7777-7777-7777", "GHSA-8888-8888-8888"]) }));
    assert.equal(r2.drafts.length, 1);
  });

  test("같은 패키지의 다른 버전과 같은 CVE의 KEV 등재는 후보로 남는다", async () => {
    const e = env();
    insertBuilderItem(e.db, "2026-10-20", plainItem(["npm:@anthropic-ai/claude-code:1.0.0", "ghsa:GHSA-9999-9999-9999"]));
    const kev = JSON.stringify({ vulnerabilities: [{ cveID: "CVE-2026-0004", vendorProject: "Vercel", product: "Next.js", dateAdded: TARGET }] });
    const r = await run(e, fakeHttp({ "claude-code": JSON.stringify([release("v1.0.1", iso(1), "- breaking")]), kev }));
    assert.equal(r.drafts.length, 2);
  });

  test("90일 안에 처음 든 버전은 한 번 후보가 되고, 고르지 않아도 적용이 성공하면 나오지 않으며, 적용이 실패하면 다시 나온다", async () => {
    const e = env();
    const eol = JSON.stringify({ result: { releases: [{ name: "20", eolFrom: "2026-12-01" }] } });
    const r1 = await run(e, fakeHttp({ "eol-nodejs": eol }));
    assert.equal(r1.drafts.length, 1);
    const r1b = await run(e, fakeHttp({ "eol-nodejs": eol }));
    assert.equal(r1b.drafts.length, 1, "적용 전이면 다시 나온다");
    apply(e, r1b);
    assert.ok(emittedKeys(e.db).has("eol:nodejs:20"));
    const r2 = await run(e, fakeHttp({ "eol-nodejs": eol }), nextDay(1));
    assert.equal(r2.drafts.length, 0);
  });

  test("낸 키가 전부인 후보도 빠진다", async () => {
    const e = env();
    addEmitted(e.db, "eol:nextjs:15", "2026-10-01");
    const eol = JSON.stringify({ result: { releases: [{ name: "15", eolFrom: "2026-12-01" }] } });
    assert.equal((await run(e, fakeHttp({ "eol-nextjs": eol }))).drafts.length, 0);
  });

  test("주소 키는 정규화되고 메일 모양이 되지 않는다", () => {
    assert.equal(urlKey("https://GitHub.blog/a/?utm=1"), "https://github.blog/a");
    assert.ok(!/\w@\w/.test(urlKey("https://github.blog/fake@1.0.0")));
  });
});

describe("4.1-5 다시 부르기", () => {
  const doc = (price: string) => `| Model | Price |\n|---|---|\n| fake-1 | ${price} |\n| fake-2 | $2 |\n`;

  test("검사 실패 뒤 다음 실행에 같은 기간의 후보와 숫자 변경 후보가 나오고, 적용 성공 뒤에는 나오지 않으며, 숫자 행은 중복 저장되지 않는다", async () => {
    const e = env();
    apply(e, await run(e, fakeHttp({ "openai-pricing": doc("$1") })));
    const d = nextDay(1);
    const feed = rss([{ title: "Fake notes", link: "https://platform.claude.com/docs/a", date: new Date(d.now.getTime() - HOUR).toUTCString() }]);
    const replies = { "openai-pricing": doc("$5"), "claude-notes": feed };
    const r1 = await run(e, fakeHttp(replies), d);
    assert.equal(r1.drafts.length, 2);
    assert.equal(isBuilderDone(e.db, d.target), false);
    const rows = liveRows(e.db, "openai-pricing").length;
    const later = { ...d, now: new Date(d.now.getTime() + HOUR) };
    const r2 = await run(e, fakeHttp(replies), later);
    assert.deepEqual(titles(r2).sort(), titles(r1).sort(), "적용 전이면 같은 후보가 나온다");
    assert.equal(liveRows(e.db, "openai-pricing").length, rows);
    apply(e, r2);
    assert.equal(isBuilderDone(e.db, d.target), true);
    const r3 = await run(e, fakeHttp(replies), { ...later, now: new Date(later.now.getTime() + HOUR) });
    assert.equal(r3.drafts.length, 0);
  });
});
