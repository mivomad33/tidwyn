// 9.7단계 영상별 페이지(4.4). 앱 전용 주소이고 날짜별 영상 파일과 구간 파일만 받는다. 구간이 없거나 파일이 없거나 30일 지난 영상은 없는 영상 안내를 보인다.
import { useMemo, type ReactNode } from "react";
import { kstDate } from "../../../src/kst.ts";
import type { DaySections, DayVideos, SiteVideo, VideoSection } from "../../../src/siteTypes.ts";
import type { SiteDates } from "../lib/types.ts";
import { BriefBackLink, ErrorState, Layout, Loading, VIDEO_LOAD_ERROR, useTitle } from "../components/common.tsx";
import { NotFoundView } from "../components/notFoundView.ts";
import { VideoDetail } from "../components/videoView.ts";
import { retry, useResource } from "../data.ts";
import { dataUrl } from "../lib/paths.ts";
import { isValidDate } from "../lib/routes.ts";
import { sectionVideo } from "../lib/videos.ts";
import { Link } from "../router.tsx";

function Missing({ back }: { back?: ReactNode }) {
  useTitle("없는 영상");
  return (
    <Layout left={back}>
      <NotFoundView Link={Link} heading="이 주소에는 영상이 없다" message="구간 정리가 없는 영상이거나, 주소가 잘못되었거나, 기간이 지나 지워진 영상일 수 있다." />
    </Layout>
  );
}

function Detail({ back, video, sections }: { back: ReactNode; video: SiteVideo; sections: VideoSection[] }) {
  useTitle(video.title);
  return (
    <Layout left={back}>
      <VideoDetail video={video} sections={sections} />
    </Layout>
  );
}

export function VideoPage({ date, id }: { date: string; id: string }) {
  const url = isValidDate(date) ? dataUrl.videoDay(date) : null;
  const res = useResource<DayVideos>(url);
  const today = useMemo(() => kstDate(new Date()), []);
  const video = res.status === "ok" ? sectionVideo(res.data, id, today) : null;
  const sectionsUrl = video ? dataUrl.videoSections(date) : null;
  const sectionsRes = useResource<DaySections>(sectionsUrl);
  // 들어온 브리프를 모르면 그 영상 날짜의 영상 탭으로 가고, 글도 영상 날짜로 정한다(U1 4.4-1)
  const datesRes = useResource<SiteDates>(dataUrl.dates());
  const back = <BriefBackLink fallback={{ date, latestDate: datesRes.status === "ok" ? datesRes.data.latestDate : null }} />;
  if (url === null || (res.status === "error" && res.notFound)) return <Missing />;
  const failed = res.status === "error" ? url : sectionsRes.status === "error" && !sectionsRes.notFound ? sectionsUrl : null;
  if (failed !== null) {
    return (
      <Layout left={back}>
        <ErrorState message={VIDEO_LOAD_ERROR} onRetry={() => retry([failed])} />
      </Layout>
    );
  }
  if (res.status !== "ok" || (video && sectionsRes.status === "loading")) {
    return (
      <Layout left={back}>
        <Loading />
      </Layout>
    );
  }
  const sections = sectionsRes.status === "ok" ? sectionsRes.data.videoSections[id] : undefined;
  return video && sections ? <Detail back={back} video={video} sections={sections} /> : <Missing back={back} />;
}
