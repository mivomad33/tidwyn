// 7단계 이슈 페이지의 '관련 영상'(4.7-2): '관련 지표' 아래(없으면 타임라인 아래)·'일정' 위. 붙은 브리프 날짜 최근 순으로 처음 5개와 '더 보기',
// 줄은 브리프 영상 탭과 같은 영상 줄(components/videoView.ts)에 "M월 D일 추천"을 붙인다. 아래 끝에 출처 줄.
// 30일 지난 영상은 숨기고(V14), 보이는 영상이 없으면 그리지 않는다.
import { useState } from "react";
import { issueVideoRows } from "../lib/videos.ts";
import type { IssueVideo } from "../../../src/siteTypes.ts";
import { Link } from "../router.tsx";
import { useFocusNewRow } from "./common.tsx";
import { VideoList, VideoSource } from "./videoView.ts";

export function IssueVideos({ videos, today }: { videos: IssueVideo[] | undefined; today: string }) {
  const [expanded, setExpanded] = useState(false);
  const more = useFocusNewRow<HTMLDivElement>("li.vrow");
  const { rows, more: rest } = issueVideoRows(videos, today, expanded);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="iss-vid">
      <h2 id="iss-vid" className="h">
        관련 영상
      </h2>
      <div ref={more.ref}>
        <VideoList videos={rows} mode="issue" Link={Link} />
        {rest > 0 && (
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
      <VideoSource />
    </section>
  );
}
