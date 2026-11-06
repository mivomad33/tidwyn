// U1 4.4 되돌아가기와 돌아올 때의 상태(S1·S2·S5·S8·S12)의 DOM 없는 로직: history.state에 담는 기록 정보와 '‹ 브리프'의 글·도착.
// 브라우저의 방문 기록을 작은 흉내로 돌려, 앱 안 이동(push·replace)이 남기는 state로 판단이 맞는지 본다. 날짜는 모두 지어낸 것이다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { adoptState, briefBackLabel, briefMarkOf, enteredFrom, navOf, prevPathOf, pushStateOf, replaceStateOf, resolveBriefBack, withScroll } from "../site/src/lib/navState.ts";

const LATEST = "2026-11-06";

/** 방문 기록 흉내. pushState는 앞쪽 기록을 지우고, back은 하나 되돌린다 */
class FakeHistory {
  entries: { path: string; state: unknown }[];
  index = 0;
  private n = 0;
  constructor(path: string) {
    this.entries = [{ path, state: adoptState(null, this.id(), null) }];
  }
  private id(): string {
    this.n++;
    return `e${this.n}`;
  }
  get current() {
    return this.entries[this.index]!;
  }
  push(path: string, extra?: unknown) {
    const state = pushStateOf(this.current.state, this.current.path, this.id(), extra);
    this.entries = this.entries.slice(0, this.index + 1);
    this.entries.push({ path, state });
    this.index++;
  }
  replace(path: string, extra?: unknown) {
    this.current.state = replaceStateOf(this.current.state, path === this.current.path, extra);
    this.current.path = path;
  }
  /** 브리프 화면이 자기 기록에 남기는 상태 */
  markBrief(date: string, tab: string, more: { chip?: string | null; major?: string | null } = {}) {
    this.current.state = { ...(this.current.state as object), brief: { date, tab, latestDate: LATEST, chip: more.chip ?? null, major: more.major ?? null } };
  }
  back() {
    this.index--;
  }
}

describe("들어온 브리프 기억(S8)", () => {
  test("브리프에서 다른 화면으로 가면 새 기록이 그 브리프의 날짜·탭·최근 날짜와 브리프 기록의 식별자를 갖고, 이어지는 이동에도 이어진다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    const briefId = navOf(h.current.state)!.id;
    h.push("/issues/7");
    assert.deepEqual(navOf(h.current.state)!.entered, { date: "2026-11-03", tab: "세계", latestDate: LATEST, entry: briefId });
    assert.deepEqual(navOf(h.current.state)!.prev, { id: briefId, path: "/2026-11-03" });
    h.push("/issues/8");
    h.push("/about");
    assert.equal(navOf(h.current.state)!.entered!.date, "2026-11-03");
    assert.equal(navOf(h.current.state)!.entered!.entry, briefId);
  });

  test("다른 브리프를 거치면 그 브리프가 새 들어온 브리프다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    h.push("/issues/7");
    h.push("/2026-11-05");
    h.markBrief("2026-11-05", "영상", { chip: "ai" });
    h.push("/videos/2026-11-05/abc");
    assert.equal(navOf(h.current.state)!.entered!.date, "2026-11-05");
    assert.equal(navOf(h.current.state)!.entered!.tab, "영상");
  });

  test("같은 기록을 바꾸면(합쳐진 이슈 주소 바꾸기, 카드 펼침) nav는 그대로이고, 같은 경로일 때만 브리프 상태도 남는다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계", { major: "경제" });
    const id = navOf(h.current.state)!.id;
    h.replace("/2026-11-03", undefined);
    assert.equal(navOf(h.current.state)!.id, id);
    assert.deepEqual(briefMarkOf(h.current.state), { date: "2026-11-03", tab: "세계", latestDate: LATEST, chip: null, major: "경제" });
    h.push("/issues/9");
    const entered = navOf(h.current.state)!.entered;
    h.replace("/issues/3", { mergedFrom: { id: 9, on: null } });
    assert.deepEqual(navOf(h.current.state)!.entered, entered);
    assert.deepEqual((h.current.state as { mergedFrom: unknown }).mergedFrom, { id: 9, on: null });
    assert.equal(briefMarkOf(replaceStateOf({ nav: { id: "x" }, brief: { tab: "한국" } }, false, null)), null);
  });

  test("떠날 때의 스크롤을 남기고, 주소창에서 바꾼 `#` 기록은 직전 기록을 바로 앞으로 잇는다", () => {
    const s = withScroll(adoptState(null, "a", null), 812);
    assert.equal(navOf(s)!.scroll, 812);
    const brief = { ...adoptState(null, "b", null), brief: { date: "2026-11-03", tab: "한국", latestDate: LATEST } };
    const typed = adoptState(null, "c", { state: brief, path: "/2026-11-03" });
    assert.deepEqual(navOf(typed)!.prev, { id: "b", path: "/2026-11-03" });
    assert.equal(navOf(typed)!.entered!.entry, "b");
  });

  test("깨진 state는 모르는 것으로 본다", () => {
    for (const bad of [null, 3, "x", [], { nav: 1 }, { nav: { id: 2 } }]) {
      assert.equal(navOf(bad), null);
      assert.equal(enteredFrom(bad), null);
      assert.deepEqual(resolveBriefBack({ state: bad }), { label: "브리프", to: "/", back: false, tab: null });
    }
    assert.equal(navOf({ nav: { id: "a", entered: { date: "nope", tab: "한국", latestDate: LATEST, entry: "z" } } })!.entered, null);
  });
});

describe("'‹ 브리프'의 도착과 글(S1·S2, 4.4-1·3)", () => {
  test("바로 앞 기록이 들어온 그 브리프면 기록을 되돌린다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    h.push("/issues/7");
    assert.deepEqual(resolveBriefBack({ state: h.current.state }), { label: "11월 3일 브리프", to: "/2026-11-03", back: true, tab: "세계" });
  });

  test("바로 앞 기록이 그 브리프가 아니면 들어온 날짜·탭으로 새 기록을 만든다(이슈 목록을 거친 경우)", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    h.push("/issues");
    assert.equal(resolveBriefBack({ state: h.current.state }).back, true);
    h.push("/issues/7");
    h.back();
    assert.deepEqual(resolveBriefBack({ state: h.current.state }), { label: "11월 3일 브리프", to: "/2026-11-03", back: true, tab: "세계" });
    h.push("/about");
    h.push("/privacy");
    assert.deepEqual(resolveBriefBack({ state: h.current.state }), { label: "11월 3일 브리프", to: "/2026-11-03", back: false, tab: "세계" });
  });

  test("뒤로 갔다가 다른 화면으로 가 기록이 바뀌면 바로 앞 기록도 그에 맞다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    h.push("/issues");
    h.push("/search");
    h.back();
    h.back();
    h.push("/schedules");
    assert.equal(resolveBriefBack({ state: h.current.state }).back, true);
  });

  test("들어온 브리프가 최근 날짜면 '브리프'이고 최근 브리프로 간다", () => {
    const h = new FakeHistory("/");
    h.markBrief(LATEST, "빌더");
    h.push("/about");
    h.push("/privacy");
    assert.deepEqual(resolveBriefBack({ state: h.current.state }), { label: "브리프", to: "/", back: false, tab: "빌더" });
  });

  test("들어온 브리프를 모르면(주소로 바로 연 경우) '브리프'이고 최근 브리프로 간다", () => {
    const h = new FakeHistory("/schedules");
    assert.deepEqual(resolveBriefBack({ state: h.current.state }), { label: "브리프", to: "/", back: false, tab: null });
  });

  test("영상 페이지: 들어온 브리프를 모르면 영상 날짜의 영상 탭이고 글도 영상 날짜로 정한다", () => {
    const h = new FakeHistory("/videos/2026-11-05/abc");
    assert.deepEqual(resolveBriefBack({ state: h.current.state, fallback: { date: "2026-11-05", latestDate: LATEST } }), { label: "11월 5일 브리프", to: "/2026-11-05#videos", back: false, tab: null });
    assert.equal(resolveBriefBack({ state: h.current.state, fallback: { date: LATEST, latestDate: LATEST } }).label, "브리프");
  });

  test("영상 페이지도 들어온 브리프를 알면 그 브리프를 따른다", () => {
    const h = new FakeHistory("/2026-11-05");
    h.markBrief("2026-11-05", "영상", { chip: "kr" });
    h.push("/videos/2026-11-05/abc");
    assert.deepEqual(resolveBriefBack({ state: h.current.state, fallback: { date: "2026-11-05", latestDate: LATEST } }), { label: "11월 5일 브리프", to: "/2026-11-05", back: true, tab: "영상" });
  });

  test("해가 다르면 'YYYY년 M월 D일 브리프'(4.3-1)", () => {
    assert.equal(briefBackLabel("2025-12-31", LATEST), "2025년 12월 31일 브리프");
    assert.equal(briefBackLabel("2026-01-02", LATEST), "1월 2일 브리프");
    assert.equal(briefBackLabel(null, LATEST), "브리프");
  });
});

describe("브리프 기록의 칩(S12)", () => {
  test("고른 칩과 탭이 그 기록에 남아, 되돌아오면 읽을 수 있다", () => {
    const h = new FakeHistory("/2026-11-05");
    h.markBrief("2026-11-05", "영상", { chip: "ai" });
    h.push("/videos/2026-11-05/abc");
    h.back();
    assert.deepEqual(briefMarkOf(h.current.state), { date: "2026-11-05", tab: "영상", latestDate: LATEST, chip: "ai", major: null });
  });
});

describe("이슈 페이지의 바로 앞 화면(4.4-2)", () => {
  test("브리프에서 왔으면 바로 앞 경로가 브리프이고, 이슈 목록·다른 이슈·주소로 바로 연 경우는 아니다", () => {
    const h = new FakeHistory("/2026-11-03");
    h.markBrief("2026-11-03", "세계");
    h.push("/issues/7");
    assert.equal(prevPathOf(h.current.state), "/2026-11-03");
    h.push("/issues/8");
    assert.equal(prevPathOf(h.current.state), "/issues/7");
    assert.equal(prevPathOf(new FakeHistory("/issues/7").current.state), null);
  });
});

describe("저장 키(S8, 4.4-4)", () => {
  test("사이트 코드는 sessionStorage를 쓰지 않는다", () => {
    const root = path.join(import.meta.dirname, "../site/src");
    const files = (fs.readdirSync(root, { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f));
    assert.ok(files.length > 10);
    for (const f of files) assert.ok(!fs.readFileSync(path.join(root, f), "utf8").includes("sessionStorage"), f);
  });
});
