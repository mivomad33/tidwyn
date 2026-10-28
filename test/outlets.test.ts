import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { findSkew, isPriorityUrl, outletKey, registrableDomain } from "../src/outlets.ts";

describe("1.5단계 R5 우선 출처와 매체 묶기", () => {
  test("목록의 도메인과 하위 도메인은 우선 출처다", () => {
    assert.ok(isPriorityUrl("https://www.yna.co.kr/view/AKR1"));
    assert.ok(isPriorityUrl("https://en.yna.co.kr/view/AEN1"));
    assert.ok(isPriorityUrl("https://www.reuters.com/world/x"));
    assert.ok(isPriorityUrl("https://www.bbc.co.uk/news/x"));
    assert.ok(isPriorityUrl("https://about.fb.com/news/x"));
    assert.ok(isPriorityUrl("https://blog.google/technology/x"));
    assert.ok(!isPriorityUrl("https://www.euronews.com/x"));
    assert.ok(!isPriorityUrl("https://notyna.co.kr/x"));
    assert.ok(!isPriorityUrl("not a url"));
  });
  test("정부·국제기구 도메인은 접미사가 맞으면 우선 출처다", () => {
    assert.ok(isPriorityUrl("https://www.moef.go.kr/x"));
    assert.ok(isPriorityUrl("https://www.korea.kr/news/x"));
    assert.ok(isPriorityUrl("https://www.whitehouse.gov/x"));
    assert.ok(isPriorityUrl("https://www.gov.uk/government/x"));
    assert.ok(isPriorityUrl("https://ec.europa.eu/x"));
    assert.ok(isPriorityUrl("https://www.who.int/x"));
  });
  test("별칭 도메인은 한 매체, 정부와 목록 밖은 등록 도메인 단위", () => {
    assert.equal(outletKey("https://www.bbc.com/a"), outletKey("https://www.bbc.co.uk/b"));
    assert.equal(outletKey("https://www.yna.co.kr/a"), outletKey("https://en.yna.co.kr/b"));
    assert.notEqual(outletKey("https://www.whitehouse.gov/a"), outletKey("https://www.state.gov/b"));
    assert.notEqual(outletKey("https://www.korea.kr/a"), outletKey("https://www.moef.go.kr/b"));
    assert.equal(outletKey("https://a.example.co.kr/x"), outletKey("https://b.example.co.kr/y"));
    assert.equal(registrableDomain("news.example.com"), "example.com");
    assert.equal(registrableDomain("a.b.example.co.kr"), "example.co.kr");
    assert.equal(registrableDomain("gov.uk"), "gov.uk");
  });
  test("쏠림 판정: 10건 중 6건이 연합뉴스면 걸리고 5건이면 통과한다", () => {
    const urls = (yna: number) =>
      Array.from({ length: 10 }, (_, i) => (i < yna ? `https://${i % 2 === 0 ? "www" : "en"}.yna.co.kr/view/${i}` : `https://news.example-${i}.com/${i}`));
    assert.deepEqual(findSkew(urls(6)), { outlet: "연합뉴스", count: 6, total: 10 });
    assert.equal(findSkew(urls(5)), null);
    assert.deepEqual(findSkew(["https://www.bbc.com/1", "https://www.bbc.co.uk/2", "https://x.example.com/3"]), { outlet: "BBC", count: 2, total: 3 });
  });
});
