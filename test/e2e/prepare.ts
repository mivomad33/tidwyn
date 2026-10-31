// E2E 준비: 지어낸 데이터로 사이트를 빌드하고, 테스트가 쓸 정보(info.json)를 남긴다.
// node test/e2e/prepare.ts   (playwright.config.ts의 webServer가 서버를 띄우기 전에 부른다)
// 실제 데이터 폴더(data/)는 읽지 않는다. 결과는 .test-data/e2e/ 아래에만 쓴다.
import fs from "node:fs";
import path from "node:path";
import { buildSite } from "../../site/build.ts";
import { writeFixtures } from "../../site/dev/fixtures.ts";
import type { E2eInfo } from "./info.ts";
import { E2E_DATA_DIR, E2E_INDICATOR_DATA_DIR, E2E_INDICATOR_INFO_FILE, E2E_INFO_FILE, E2E_OUT_DIR, E2E_ROOT, E2E_SCHEDULE_DATA_DIR, E2E_SCHEDULE_INFO_FILE } from "./paths.ts";
import type { DayList, EntityChunk, EntityListPage, EntityNewsChunk, IssueChunk, MonthDetail, MonthList, SiteIssueList, StoryDetail, TermGroupFile, TermIndex } from "../../src/siteTypes.ts";

/** 고정 날짜(같은 데이터로 매번 같은 결과가 나오게) */
const END = "2026-10-27";

function readJson<T>(rel: string): T {
  return JSON.parse(fs.readFileSync(path.join(E2E_DATA_DIR, "site-data", rel), "utf8")) as T;
}

async function main(): Promise<void> {
  fs.rmSync(E2E_ROOT, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });
  // 7단계: 추천 영상도 둔다(받은 날은 END 기준. 브라우저 시계는 base.ts가 END에 고정한다)
  const fx = writeFixtures(E2E_DATA_DIR, { end: END, days: 7, entities: 30, terms: 24, videos: true, corrections: true });
  await buildSite({ dataDir: E2E_DATA_DIR, outDir: E2E_OUT_DIR });

  const { twice } = fx.info.terms;
  if (!twice || fx.info.terms.noSurface === null) throw new Error("용어가 두 번 나오는 뉴스·본문 표기 없는 용어가 지어낸 데이터에 없다");
  const month = (d: string) => d.slice(0, 7);
  const list = readJson<MonthList>(`list-${month(twice.date)}.json`);
  const detail = readJson<MonthDetail>(`detail-${month(twice.date)}.json`);
  const day = list.days.find((d) => d.date === twice.date)!;
  const story = day.sections.flatMap((s) => s.stories).find((s) => s.key === twice.key)!;
  const body: StoryDetail = detail.days[twice.date]![twice.key]!;

  // 최근 날짜의 첫 섹션과 다른 섹션의 첫 주요 뉴스
  const latest = fx.dates[0]!;
  const latestDay: DayList = readJson<MonthList>(`list-${month(latest)}.json`).days.find((d) => d.date === latest)!;
  const otherSection = latestDay.sections.find((s) => s.name !== latestDay.sections[0]!.name && s.stories.some((x) => x.kind === "top"))!;

  // 종류별 첫 대상(전체 목록 0쪽에서)
  const all = readJson<EntityListPage>("entity-list-all-0.json");
  const firstOf = (kind: string) => all.items.find((e) => e.kind === kind)!;

  // 가장 뉴스가 많은 대상(더 보기)
  const mostId = fx.info.entities.most!;
  const chunk = readJson<EntityChunk>("entity-0.json");
  const most = chunk.entities[String(mostId)]!;
  const rest = most.moreNews > 0 ? readJson<EntityNewsChunk>("entity-news-0.json").news[String(mostId)]! : [];

  // 등장 대상이 있는 이슈
  const issueList = readJson<SiteIssueList>("issue-list.json");
  const issueChunk = readJson<IssueChunk>("issue-0.json");
  const issueWithEntities = issueList.issues.map((i) => issueChunk.issues[String(i.id)]!).find((i) => (i.entities?.length ?? 0) > 0)!;

  const v = fx.info.videos;
  if (!v?.broken || !v.noVideoDate || !v.oneBundleDate || !v.zeroBundleDate || !v.absorbed || v.many === null || v.one === null) throw new Error("영상 상태(썸네일 실패, 영상 없는 날짜, 한 묶음·0개 묶음 날짜, 흡수된 이슈의 영상, 6개 이상·1개인 이슈)가 지어낸 데이터에 없다");
  const merged = fx.info.merged!;
  const survivor = issueChunk.issues[String(merged.into)]!;
  const entityMerged = fx.info.entities.merged!;
  const termMerged = fx.info.terms.merged!;

  // 용어 사전 맨 끝 묶음의 마지막 용어(그 위치로 스크롤해야 보인다)
  const termIndex = readJson<TermIndex>("term-index.json");
  const lastGroup = termIndex.groups.filter((g) => g.count > 0).at(-1)!;
  const farTerm = readJson<TermGroupFile>(`term-group-${lastGroup.group}.json`).terms.at(-1)!;

  const info: E2eInfo = {
    dates: fx.dates,
    latest: { date: latest, firstSection: latestDay.sections[0]!.name, otherSection: otherSection.name, otherTopTitle: otherSection.stories.find((x) => x.kind === "top")!.title },
    termCard: {
      date: twice.date,
      key: twice.key,
      section: story.section,
      title: story.title,
      underlineTerm: body.terms!.find((t) => t.id === twice.termId)!,
      chipOnlyTerm: body.terms!.find((t) => t.id === fx.info.terms.noSurface)!,
      entities: body.entities ?? [],
    },
    entities: {
      person: firstOf("인물"),
      org: firstOf("기관"),
      country: firstOf("국가"),
      most: { id: most.id, name: most.name, shown: most.news.length, moreNews: most.moreNews, firstNews: most.news[0]!.title, nextNews: rest[0]?.title ?? null },
      merged: { id: entityMerged.id, into: entityMerged.into, intoName: chunk.entities[String(entityMerged.into)]!.name },
      deleted: fx.info.entities.deleted!,
    },
    terms: { merged: termMerged, deleted: fx.info.terms.deleted!, far: { id: farTerm.id, name: farTerm.name, group: lastGroup.group } },
    issues: {
      withEntities: { id: issueWithEntities.id, name: issueWithEntities.name, entities: issueWithEntities.entities! },
      merged: { id: merged.id, into: merged.into, intoName: survivor.name },
      first: issueList.issues[0]!,
    },
    videos: fx.info.videos!,
  };
  fs.writeFileSync(E2E_INFO_FILE, JSON.stringify(info, null, 2) + "\n");

  // 5단계: 일정이 있는 데이터(날짜를 늘려 지난 달 일정도 둔다). 화면 파일은 같으므로 빌드하지 않고 사이트 데이터만 만든다
  const sfx = writeFixtures(E2E_SCHEDULE_DATA_DIR, { end: END, days: 45, entities: 30, terms: 24, schedules: 120 });
  if (!sfx.info.schedules?.merged || sfx.info.schedules.deleted === null) throw new Error("흡수된 일정·지운 일정이 지어낸 데이터에 없다");
  fs.writeFileSync(E2E_SCHEDULE_INFO_FILE, JSON.stringify({ dates: sfx.dates, ...sfx.info.schedules }, null, 2) + "\n");

  // 6단계: 일정과 지표(12개 정의, 5년, 공개 끈 지표, 값 없는 지표)가 있는 데이터. 화면 파일은 같으므로 사이트 데이터만 만든다
  const ifx = writeFixtures(E2E_INDICATOR_DATA_DIR, { end: END, days: 45, entities: 30, terms: 24, schedules: 120, indicators: 5 });
  const ii = ifx.info.indicators;
  if (!ii?.off || !ii.empty || ii.issueOne === null || ii.issueThree === null || ii.noRelated === null || ii.krHoliday === null) throw new Error("지표 상태(공개 끔, 값 없음, 그래프 1·3개 이슈, 관련 이슈 없음, 휴장일)가 지어낸 데이터에 없다");
  fs.writeFileSync(E2E_INDICATOR_INFO_FILE, JSON.stringify({ dates: ifx.dates, merged: ifx.info.merged, ...ii }, null, 2) + "\n");
  console.log(`E2E 준비 완료: ${E2E_OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(`E2E 준비 실패: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
});
