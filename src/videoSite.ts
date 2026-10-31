import type { DatabaseSync } from "node:sqlite";
import { resolveIssue } from "./issues.ts";
import type { IssueVideo, SiteVideo } from "./siteTypes.ts";
import { allVideos, type VideoRecord } from "./videoStore.ts";

// 7단계 4.6-1: 영상 사이트 데이터. DB에 남은 영상 기록(30일 지우기 뒤의 것)을 그대로 쓴다. 빌드한 날의 시계를 쓰지 않는다(4.6-2).
// 설명과 통계는 넣지 않는다. 30일 숨김과 개수 제한은 화면이 한다(V14, 4.7-2).

export interface VideoSiteData {
  /** 브리프 날짜 → 영상(묶음 순 kr → us → ai-ko → ai-en, 묶음 안은 고른 순서) */
  byDate: Map<string, SiteVideo[]>;
  /** 흡수되지 않은 이슈 → 관련 영상(그 이슈와 흡수된 이슈의 영상, 붙은 브리프 날짜 최근 순, 같은 영상은 한 번) */
  byIssue: Map<number, IssueVideo[]>;
  /** 영상 수와 영상이 있는 브리프 날짜 수 */
  videos: number;
  dates: number;
}

function siteVideo(v: VideoRecord): SiteVideo {
  const out: SiteVideo = { id: v.videoId, bundle: v.bundle, title: v.title, channel: v.channel, seconds: v.seconds, thumb: v.thumb, reason: v.reason, fetchedOn: v.fetchedOn };
  if (v.summary !== null) out.videoSummary = v.summary;
  return out;
}

export function buildVideoSiteData(db: DatabaseSync): VideoSiteData {
  const all = allVideos(db);
  const byDate = new Map<string, SiteVideo[]>();
  for (const v of all) {
    let list = byDate.get(v.briefDate);
    if (!list) byDate.set(v.briefDate, (list = []));
    list.push(siteVideo(v));
  }
  const byIssue = new Map<number, IssueVideo[]>();
  const seen = new Map<number, Set<string>>();
  // 최근 브리프 날짜부터(같은 날짜 안은 묶음·순서대로)
  const recentFirst = [...all].sort((a, b) => b.briefDate.localeCompare(a.briefDate));
  for (const v of recentFirst) {
    for (const issue of new Set(v.issues.map((i) => resolveIssue(db, i)))) {
      let ids = seen.get(issue);
      if (!ids) seen.set(issue, (ids = new Set()));
      if (ids.has(v.videoId)) continue;
      ids.add(v.videoId);
      let list = byIssue.get(issue);
      if (!list) byIssue.set(issue, (list = []));
      list.push({ ...siteVideo(v), date: v.briefDate });
    }
  }
  return { byDate, byIssue, videos: all.length, dates: byDate.size };
}
