// 9.7단계 영상별 페이지의 주소, 호스팅, 시각 링크, 있는 영상 판단, 정적 결과물에 없음을 본다. 데이터는 모두 지어낸 것이다.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { resolveStatic } from "../site/hosting.ts";
import { parseRoute, videoPath } from "../site/src/lib/routes.ts";
import { durationClock, sectionVideo, videoAtUrl } from "../site/src/lib/videos.ts";
import type { DayVideos, SiteVideo } from "../src/siteTypes.ts";

const ID = "abcDEF_12-x";
const video = (over: Partial<SiteVideo> = {}): SiteVideo =>
  ({
    id: ID,
    title: "지어낸 영상",
    channel: "지어낸 채널",
    seconds: 600,
    thumb: "",
    reason: "지어낸 이유",
    bundle: "kr",
    fetchedOn: "2026-10-30",
    hasSections: true,
    ...over,
  }) as SiteVideo;
const file = (...videos: SiteVideo[]) => ({ date: "2026-10-30", videos }) as DayVideos;

describe("4.4-1 주소", () => {
  test("모양이 맞으면 영상 페이지이고, 다른 모양은 영상 페이지가 아니다", () => {
    assert.deepEqual(parseRoute(videoPath("2026-10-30", ID)), { name: "video", date: "2026-10-30", id: ID });
    for (const p of ["/videos", "/videos/2026-10-30", `/videos/2026-1-30/${ID}`, "/videos/2026-10-30/a.b", `/videos/2026-10-30/${"a".repeat(33)}`, `/videos/2026-10-30/${ID}/x`]) {
      assert.notEqual(parseRoute(p).name, "video", p);
    }
  });

  test("호스팅은 그 모양을 앱 틀로, 다른 모양은 404로 보낸다", () => {
    const exists = (p: string) => p === "app.html";
    assert.deepEqual(resolveStatic(`/videos/2026-99-99/${ID}`, exists), { kind: "file", path: "app.html" });
    const missing = { kind: "notFound", path: "404.html" };
    for (const p of ["/videos/2026-10-30", "/videos/2026-10-30/a.b", `/videos/2026-10-30/${ID}/x`, `/videos/2026-1-30/${ID}`]) assert.deepEqual(resolveStatic(p, exists), missing, p);
  });
});

describe("4.4-3 시각 링크", () => {
  for (const [s, clock] of [[0, "0:00"], [59, "0:59"], [3599, "59:59"], [3600, "1:00:00"]] as const) {
    test(`${s}초는 ${clock}이고 그 시각의 주소를 만든다`, () => {
      assert.equal(videoAtUrl(ID, s), `https://www.youtube.com/watch?v=${ID}&t=${s}s`);
      assert.equal(durationClock(s), clock);
    });
  }
});

describe("4.4-4 페이지에 보일 영상", () => {
  test("구간이 있고 30일이 지나지 않은 영상만 보인다", () => {
    assert.equal(sectionVideo(file(video()), ID, "2026-11-01")?.id, ID);
    assert.equal(sectionVideo(file(video()), "없는ID", "2026-11-01"), null);
    assert.equal(sectionVideo(file(video({ hasSections: undefined })), ID, "2026-11-01"), null);
    assert.equal(sectionVideo(file(video()), ID, "2026-11-29"), null);
  });
});
