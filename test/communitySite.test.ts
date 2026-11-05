// 9.98단계 사이트(4.5-1, 4.5-2, 4.7-4): 커뮤니티 근거 줄·수준 문구·꺾임의 글자, 탭 머리 문장, 빠진 커뮤니티 소스 안내,
// 소개의 커뮤니티 소스 목록·표본 설명·사각지대 표, 정적 HTML의 칸과 출처 링크. 데이터는 모두 지어낸 것이다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildSite } from "../site/build.ts";
import { generateFixtures, type Fixture } from "../site/dev/fixtures.ts";
import { AboutDemand, DemandCoverage } from "../site/src/components/demandView.ts";
import { DEMAND_ABOUT_HASH, DEMAND_INTRO, demandMissingText, flowCommunityHead, flowCommunityNumbers, flowLevelText, flowUnitPeriod } from "../site/src/lib/demand.ts";
import { COVERAGE_COLUMNS, FIELD_COVERAGE } from "../src/demandCoverage.ts";
import { COMMUNITY_GROUPS, COMMUNITY_INFO, COMMUNITY_LEVEL_MEANINGS, COMMUNITY_MISSING_MEANINGS, COMMUNITY_MISSING_NAMES, COMMUNITY_MISSING_REASONS, FLOW_AI_NOTE, FLOW_AI_NOTE_COMMUNITY, FLOW_CAVEAT, SOURCE_STATE_NAMES, FLOW_TURNING_TEXT, GROUP_INFO, LEVEL_MEANINGS, SOURCE_PAGES, fieldLabel } from "../src/demandFlowTypes.ts";
import { communitySources } from "../src/demandSources.ts";
import { siteFiles, type DemandMonth, type SiteFlowCommunityUnit, type SiteFlowItem } from "../src/siteTypes.ts";
import { cleanupTemp, tempDir } from "./helpers.ts";

after(cleanupTemp);

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const unesc = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const text = (html: string) => unesc(html.replace(/<[^>]*>/g, ""));

const c = (over: Partial<SiteFlowCommunityUnit> = {}): SiteFlowCommunityUnit => ({
  group: "github",
  source: COMMUNITY_INFO.github.label,
  sample: COMMUNITY_INFO.github.sample,
  name: "가짜 문서",
  recent: 84,
  base: 21.3,
  isNew: false,
  recentFrom: "2026-10-20",
  recentTo: "2026-10-26",
  baseFrom: "2026-09-22",
  baseTo: "2026-10-19",
  unit: "건",
  ...over,
});

describe("4.5-1 글자", () => {
  test("커뮤니티 근거 줄: 소스 · 표본 설명, 두 창 숫자, 짧은 창의 날 수, 새로 나타남, 창 기간", () => {
    assert.equal(flowCommunityHead(c()), `GitHub Issues · ${COMMUNITY_INFO.github.sample}`);
    assert.equal(flowCommunityHead(c({ group: "bluesky", source: COMMUNITY_INFO.bluesky.label, sample: COMMUNITY_INFO.bluesky.sample })), `Bluesky · ${COMMUNITY_INFO.bluesky.sample}`);
    assert.equal(flowCommunityNumbers(c()), "최근 7일 84건 · 앞 28일의 7일 평균 21.3건");
    assert.equal(flowCommunityNumbers(c({ recent: 1320, base: 0, isNew: true })), "최근 7일 1,320건 · 앞 28일의 7일 평균 0건 · 앞 28일에는 없었다");
    assert.equal(flowCommunityNumbers(c({ recentFrom: "2026-10-22", baseFrom: "2026-09-29" })), "최근 5일 84건 · 앞 21일의 5일 평균 21.3건");
    assert.equal(flowUnitPeriod(c()), "최근 10월 20일~26일 · 앞 9월 22일~10월 19일");
  });

  test("근거 수준 줄: 커뮤니티 확인 흐름은 뜻 문구가 다르고(코드 한 곳), 공식 둘 이상 흐름은 그대로다", () => {
    assert.equal(flowLevelText("medium", true), `근거 중 · ${COMMUNITY_LEVEL_MEANINGS.medium}`);
    assert.equal(flowLevelText("weak", true), `근거 약 · ${COMMUNITY_LEVEL_MEANINGS.weak}`);
    assert.equal(flowLevelText("medium", true), "근거 중 · 공식 소스 한 곳에서 오르고 커뮤니티 검색에서도 늘었다");
    assert.equal(flowLevelText("medium"), `근거 중 · ${LEVEL_MEANINGS.medium}`);
    assert.equal(flowLevelText("strong", true), `근거 강 · ${LEVEL_MEANINGS.strong}`, "커뮤니티 확인 흐름은 강이 없지만 들어오면 공식 뜻을 쓴다");
  });

  test("탭 머리 문장이 9.98 인정 규칙이고 커뮤니티 표본 안내가 있다", () => {
    assert.ok(DEMAND_INTRO.startsWith("서로 다른 공식 소스 두 곳 이상, 또는 공식 소스 한 곳과 커뮤니티 검색에서 함께 오른"), DEMAND_INTRO);
    assert.ok(DEMAND_INTRO.includes("커뮤니티 건수는") && DEMAND_INTRO.includes("치우친 표본"), DEMAND_INTRO);
  });

  test("빠진 소스 안내: 공식 묶음 다음에 커뮤니티 소스와 사유", () => {
    assert.equal(
      demandMissingText(["assembly"], [{ group: "bluesky", reason: "failed" }, { group: "github", reason: "robots" }]),
      `이날 비교에 넣지 못한 소스: 국회 청원, Bluesky(${COMMUNITY_MISSING_NAMES.failed}), GitHub Issues(${COMMUNITY_MISSING_NAMES.robots})`,
    );
    assert.equal(demandMissingText(undefined, [{ group: "github", reason: "off" }]), "이날 비교에 넣지 못한 소스: GitHub Issues(꺼짐)");
    assert.equal(demandMissingText(undefined, []), null);
  });
});

describe("4.5-2 소개", () => {
  const html = renderToStaticMarkup(h(AboutDemand));

  test("인정 문장이 9.98 규칙이고, 커뮤니티 소스 이름과 표본 설명이 코드와 같다", () => {
    const body = text(html);
    assert.ok(body.includes("서로 다른 공식 소스 두 곳 이상에서, 또는 공식 소스 한 곳과 커뮤니티 검색에서 같은 이야기가 함께 올랐을 때만 싣는다."));
    assert.ok(!body.includes("서로 다른 공식 소스 두 곳 이상에서 같은 이야기가 함께 올랐을 때만 싣는다"), "9.97 문장이 남지 않는다");
    const list = html.match(/<ul class="p dlines demand-community">([\s\S]*?)<\/ul>/)![1]!;
    const lines = [...list.matchAll(/<li>([^<]*)<\/li>/g)].map((m) => unesc(m[1]!));
    assert.deepEqual(lines, communitySources().map((s) => `${s.label} · ${COMMUNITY_INFO[s.group].sample}`));
    assert.deepEqual(lines, COMMUNITY_GROUPS.map((g) => `${COMMUNITY_INFO[g].label} · ${COMMUNITY_INFO[g].sample}`));
    for (const s of [COMMUNITY_LEVEL_MEANINGS.medium, COMMUNITY_LEVEL_MEANINGS.weak, FLOW_TURNING_TEXT, "근거 중이 가장 높다", "저장하지 않는다", "한 저장소나 한 계정", "같은 요일"]) assert.ok(body.includes(s), s);
  });

  test("사각지대 표: 칸이 코드의 분야×소스 대응과 같고, 머리 칸과 줄 머리가 있다", () => {
    const table = renderToStaticMarkup(h(DemandCoverage));
    assert.ok(table.includes(`<section id="${DEMAND_ABOUT_HASH}">`));
    assert.ok(html.includes(`<section id="${DEMAND_ABOUT_HASH}">`), "소개의 수요 절 안에 있다");
    assert.ok(table.includes(`aria-labelledby="${DEMAND_ABOUT_HASH}-h"`) && table.includes(`id="${DEMAND_ABOUT_HASH}-h"`));
    assert.deepEqual([...table.matchAll(/<th scope="col">([^<]*)<\/th>/g)].map((m) => m[1]), ["분야", "공식 소스", "커뮤니티 검색"]);
    const rows = [...table.matchAll(/<tr><th scope="row">([^<]*)<\/th><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/g)].map((m) => [unesc(m[1]!), text(m[2]!), text(m[3]!)]);
    const names = (kind: "official" | "community", groups: readonly string[]) => COVERAGE_COLUMNS.filter((col) => col.kind === kind && groups.includes(col.id)).map((col) => col.label).join(", ") || "없음";
    assert.deepEqual(
      rows,
      FIELD_COVERAGE.map((r) => [fieldLabel(r.field), names("official", r.groups), names("community", r.groups)]),
    );
    assert.equal(rows.length, 21);
    // 표의 이름에서 거꾸로 묶음을 되찾아도 대응과 같다(이름이 겹치지 않는다)
    const byLabel = new Map(COVERAGE_COLUMNS.map((col) => [col.label, col.id]));
    for (const [i, r] of FIELD_COVERAGE.entries()) {
      const back = [rows[i]![1], rows[i]![2]].flatMap((cell) => (cell === undefined || cell === "없음" ? [] : cell.split(", "))).map((n) => byLabel.get(n));
      assert.deepEqual(back, COVERAGE_COLUMNS.map((col) => col.id).filter((id) => r.groups.includes(id)), r.field);
    }
  });
});

describe("4.5-1 정적 HTML", () => {
  let out = "";
  let fx: Fixture;
  const read = (rel: string) => fs.readFileSync(path.join(out, rel), "utf8");
  const items = (date: string): SiteFlowItem[] => (JSON.parse(fx.files.get(`site-data/${siteFiles.demandItems(date.slice(0, 7))}`)!) as DemandMonth).days[date]!;
  /** 항목 하나의 HTML(그 항목의 li 안) */
  const block = (html: string, key: string) => {
    const from = html.indexOf(`id="${key}"`);
    return html.slice(from, html.indexOf("틀린 내용 알리기", from));
  };
  /** 공식 소스·커뮤니티 소스의 고정 주소 목록(코드) */
  const allowed = new Set([...Object.values(GROUP_INFO).map((g) => g.url), ...Object.values(SOURCE_PAGES), ...COMMUNITY_GROUPS.map((g) => COMMUNITY_INFO[g].url)]);
  const isAllowed = (url: string) => allowed.has(url) || /^https:\/\/[a-z-]+\.wikipedia\.org\/$/.test(url);

  before(async () => {
    fx = generateFixtures({ end: "2026-10-27", days: 18, contiguous: true, builder: true, videos: true, demand: true });
    const work = tempDir();
    const dataDir = path.join(work, "data");
    out = path.join(work, "out");
    for (const [rel, content] of fx.files) {
      fs.mkdirSync(path.dirname(path.join(dataDir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dataDir, rel), content);
    }
    await buildSite({ dataDir, outDir: out });
  });

  test("지어낸 데이터에 4.7-4의 상태가 모두 있다", () => {
    const d = fx.info.demand!;
    const xs = items(d.community!);
    assert.ok(xs.some((x) => x.communityConfirmed && x.level === "medium" && x.turning), "커뮤니티 확인 '중'과 꺾임");
    assert.ok(xs.some((x) => !x.communityConfirmed && x.community?.length && new Set(x.units.map((u) => u.group)).size >= 2), "공식 둘 + 커뮤니티");
    assert.ok(xs.some((x) => x.communityConfirmed && x.level === "weak" && x.community!.some((cu) => cu.name.length > 60)), "긴 검색어");
    assert.ok(items(d.communityMissing!).length > 0);
  });

  test("커뮤니티 근거 줄이 공식 근거 뒤에 있고, 수준 문구와 꺾임 표시가 근거 수준 바로 아래에 있다", () => {
    const d = fx.info.demand!;
    const html = read(`${d.community}.html`);
    for (const x of items(d.community!)) {
      const b = block(html, x.key);
      const heads = [...b.matchAll(/<h4 class="h">([^<]*)<\/h4>/g)].map((m) => m[1]);
      assert.deepEqual(heads, ["요지", "잇는 이유", "근거", "커뮤니티", "근거 수준", ...(x.aux.length ? ["보조 근거"] : []), ...(x.issue ? ["관련 이슈"] : []), "비교 기간", "출처"], x.key);
      const comm = b.slice(b.indexOf('<h4 class="h">커뮤니티</h4>'), b.indexOf('<h4 class="h">근거 수준</h4>'));
      const lines = [...comm.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => [...m[1]!.matchAll(/<span class="([^"]*)">([^<]*)<\/span>/g)].map((s) => [s[1], unesc(s[2]!)]));
      assert.deepEqual(
        lines,
        x.community!.map((cu) => [["dsrc", flowCommunityHead(cu)], ["dhead", cu.name], ["dnum", flowCommunityNumbers(cu)], ["dwin", flowUnitPeriod(cu)]]),
        x.key,
      );
      const level = `<h4 class="h">근거 수준</h4><p class="p">${esc(flowLevelText(x.level, x.communityConfirmed === true))}</p>`;
      assert.ok(b.includes(level), `${x.key} 수준 문구`);
      assert.equal(b.includes(`${level}<p class="dnote dturn">${FLOW_TURNING_TEXT}</p>`), x.turning === true, `${x.key} 꺾임`);
      if (x.communityConfirmed) assert.ok(b.includes(COMMUNITY_LEVEL_MEANINGS[x.level as "medium" | "weak"]));
    }
  });

  test("출처 링크가 모두 코드의 고정 주소 목록 안에 있고, 커뮤니티 근거가 있으면 그 소스의 고정 주소가 있으며 검색어가 주소에 없다", () => {
    const d = fx.info.demand!;
    for (const date of [d.three!, d.community!, d.communityMissing!, d.long!]) {
      const html = read(`${date}.html`);
      for (const x of items(date)) {
        const b = block(html, x.key);
        const src = b.slice(b.indexOf('<h4 class="h">출처</h4>'));
        const hrefs = [...src.matchAll(/href="([^"]*)"/g)].map((m) => unesc(m[1]!)).filter((u) => !u.startsWith("mailto:"));
        assert.ok(hrefs.length > 0, x.key);
        for (const u of hrefs) assert.ok(isAllowed(u), `${x.key} ${u}`);
        for (const g of COMMUNITY_GROUPS) assert.equal(hrefs.includes(COMMUNITY_INFO[g].url), (x.community ?? []).some((cu) => cu.group === g), `${x.key} ${g}`);
        for (const cu of x.community ?? []) for (const u of hrefs) assert.ok(!u.includes(encodeURIComponent(cu.name)) && !u.includes(cu.name), `${x.key} 검색어가 주소에`);
      }
    }
  });

  test("탭 머리 문장이 새 규칙 문구이고 소개 링크가 사각지대 표로 간다. 커뮤니티를 받지 못한 날은 목록 끝에 사유와 함께 있다", () => {
    const d = fx.info.demand!;
    const html = read(`${d.community}.html`);
    assert.ok(html.includes(`<p class="flow note">${DEMAND_INTRO} ${FLOW_CAVEAT} <a href="/about#${DEMAND_ABOUT_HASH}"`), "탭 머리");
    assert.ok(!html.includes("서로 다른 공식 소스 두 곳 이상에서 함께 오른"), "9.97 탭 머리 문장");
    assert.equal(html.split(FLOW_AI_NOTE_COMMUNITY).length - 1, items(d.community!).filter((x) => x.community?.length).length, "커뮤니티 흐름의 숫자 안내");
    const plain = read(`${d.three}.html`);
    assert.equal(plain.split(`<p class="dnote">${FLOW_AI_NOTE}</p>`).length - 1, items(d.three!).length, "일반 흐름의 숫자 안내");
    assert.ok(!plain.includes(FLOW_AI_NOTE_COMMUNITY));
    assert.ok(read(`${d.communityMissing}.html`).includes(`<p class="flow note">이날 비교에 넣지 못한 소스: 국회 청원, Bluesky(받지 못함), GitHub Issues(robots 막힘)</p>`));
    assert.ok(!html.includes("이날 비교에 넣지 못한 소스"));
  });

  test("정적 소개에 사각지대 표가 있다", () => {
    const html = read("about.html");
    assert.ok(html.includes(`<section id="${DEMAND_ABOUT_HASH}">`));
    assert.equal([...html.matchAll(/<th scope="row">/g)].length, FIELD_COVERAGE.length);
    assert.ok(html.includes("는 그날 비교에서 빠진 소스다"), "빠진 소스 줄 설명");
    for (const r of COMMUNITY_MISSING_REASONS) assert.ok(html.includes(`${COMMUNITY_MISSING_NAMES[r]}: ${COMMUNITY_MISSING_MEANINGS[r]}.`), `사유 ${r}`);
    for (const [k, name] of Object.entries(SOURCE_STATE_NAMES)) assert.equal(html.includes(`${name},`) || html.includes(`${name}이다`), k !== "ok", `공식 상태 ${k}`);
  });
});
