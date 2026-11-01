// 7단계 이슈 페이지의 '관련 영상'(4.7-2): '관련 지표' 아래(없으면 타임라인 아래)·'일정' 위. 붙은 브리프 날짜 최근 순으로 처음 5개와 '더 보기',
// 줄은 브리프 영상 탭과 같은 영상 줄(components/videoView.ts)에 "M월 D일 추천"을 붙인다. 아래 끝에 출처 줄.
// 30일 지난 영상은 숨기고(V14), 보이는 영상이 없으면 그리지 않는다.
// 9.6단계: 이슈 묶음에는 위치만 있고 본문은 날짜별 영상 파일에 있어, 보일 줄의 날짜 파일만 받는다. 이슈 뉴스는 이 파일을 기다리지 않는다.
import { useState } from "react";
import { retry, useResources } from "../data.ts";
import { dataUrl } from "../lib/paths.ts";
import { issueVideoRows, issueVideosFrom, refDates } from "../lib/videos.ts";
import type { DayVideos, IssueVideoRef } from "../../../src/siteTypes.ts";
import { Link } from "../router.tsx";
import { ErrorState, useFocusNewRow, VideoLoading, VIDEO_LOAD_ERROR } from "./common.tsx";
import { VideoList, VideoSource } from "./videoView.ts";

export function IssueVideos({ refs, today }: { refs: IssueVideoRef[] | undefined; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const more = useFocusNewRow<HTMLDivElement>("li.vrow");
  const { rows: shown, more: rest } = issueVideoRows(refs, today, expanded);
  const dates = refDates(shown);
  const urls = dates.map(dataUrl.videoDay);
  const res = useResources<DayVideos>(urls);
  if (!shown.length) return null;
  const files = new Map(dates.flatMap((d, i) => {
    const r = res[i]!;
    return r.status === "ok" ? [[d, r.data] as const] : [];
  }));
  const rows = issueVideosFrom(shown, files);
  const failed = res.some((r) => r.status === "error");
  const loading = !failed && files.size < dates.length;
  return (
    <section aria-labelledby="iss-vid">
      <h2 id="iss-vid" className="h">
        관련 영상
      </h2>
      <div ref={more.ref}>
        {rows.length > 0 && <VideoList videos={rows} mode="issue" Link={Link} />}
        {loading && <VideoLoading rows={shown.length - rows.length} />}
        {failed && <ErrorState message={VIDEO_LOAD_ERROR} onRetry={() => retry(urls)} />}
        {rest > 0 && !loading && !failed && (
          <div className="more tight">
            <button
              type="button"
              className="retry"
              onClick={() => {
                more.mark();
                setExpanded(true);
              }}
            >
              더 보기 ({rest})
            </button>
          </div>
        )}
      </div>
      {rows.length > 0 && <VideoSource />}
    </section>
  );
}
