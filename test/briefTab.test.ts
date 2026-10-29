import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALL_TAB, DEFAULT_TAB, parseBriefTab, sectionView, stateForHash } from "../site/src/lib/brief.ts";
import type { DayList, ListStory } from "../src/siteTypes.ts";

// 4.5단계 브리프 '전체' 탭(사용자 결정 2026-10-29)의 DOM 없는 로직. 값은 모두 지어낸 것이다.

function story(key: string, major: ListStory["category"]["major"] = "경제"): ListStory {
  const [section, pos] = key.split("-") as [ListStory["section"], string];
  return { key, section, kind: pos.startsWith("s") ? "short" : "top", position: Number(pos.replace("s", "")), title: `가짜 ${key}`, category: { major, minor: "가짜" }, issue: null, newIssue: false, continues: null };
}

// 섹션 순서를 일부러 섞어 둔다(전체 탭은 한국 → 세계 → IT·AI로 다시 맞춘다)
const DAY: DayList = {
  date: "2026-10-27",
  headline: "가짜 헤드라인",
  keywords: [],
  sections: [
    { name: "IT·AI", flow: "가짜 흐름", stories: [story("IT·AI-s1"), story("IT·AI-1", "IT·AI")] },
    { name: "한국", flow: "가짜 흐름", stories: [story("한국-2", "정치"), story("한국-s1"), story("한국-1")] },
    { name: "세계", flow: "가짜 흐름", stories: [story("세계-1", "국제"), story("세계-s2", "정치"), story("세계-s1")] },
  ],
};

describe("전체 탭", () => {
  test("주요 뉴스는 한국 → 세계 → IT·AI(섹션 안은 순위 순), 그 아래 짧은 소식도 같은 순서이고 섹션 정보는 없다", () => {
    const v = sectionView(DAY, ALL_TAB, null);
    assert.equal(v.section, null);
    assert.deepEqual(v.top.map((s) => s.key), ["한국-1", "한국-2", "세계-1", "IT·AI-1"]);
    assert.deepEqual(v.short.map((s) => s.key), ["한국-s1", "세계-s1", "세계-s2", "IT·AI-s1"]);
  });

  test("카테고리 거르기는 전체 목록에 그대로 걸린다", () => {
    const v = sectionView(DAY, ALL_TAB, "정치");
    assert.deepEqual([...v.top, ...v.short].map((s) => s.key), ["한국-2", "세계-s2"]);
  });

  test("전체 탭에서 '#'으로 들어오면 전체에 머문 채 그 뉴스를 펼친다", () => {
    assert.deepEqual(stateForHash(DAY, "세계-1", { section: ALL_TAB, major: null, expanded: null }), { section: ALL_TAB, major: null, expanded: "세계-1" });
    assert.deepEqual(stateForHash(DAY, "세계-s1", { section: ALL_TAB, major: "IT·AI", expanded: null }), { section: ALL_TAB, major: null, expanded: null });
    // 섹션 탭이면 지금처럼 그 뉴스의 섹션으로 옮긴다
    assert.deepEqual(stateForHash(DAY, "세계-1", { section: "한국", major: null, expanded: null }), { section: "세계", major: null, expanded: "세계-1" });
  });

  test("기억한 탭: 아는 값만 쓰고 없거나 모르는 값이면 한국", () => {
    assert.equal(DEFAULT_TAB, "한국");
    assert.equal(parseBriefTab(null), "한국");
    assert.equal(parseBriefTab("전체"), "전체");
    assert.equal(parseBriefTab("IT·AI"), "IT·AI");
    assert.equal(parseBriefTab("스포츠"), "한국");
  });
});
