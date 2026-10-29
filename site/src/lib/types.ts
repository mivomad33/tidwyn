// 사이트 데이터 형식은 src/siteTypes.ts가 정한다. 화면 코드는 형식만 가져온다(값은 가져오지 않는다).
export type {
  Continues,
  DayList,
  EntityChunk,
  EntityDetail,
  EntityFilter,
  EntityKind,
  EntityListItem,
  EntityListPage,
  EntityNews,
  EntityNewsChunk,
  EntityRef,
  IssueEntity,
  MergedMap,
  TermGroupFile,
  TermIndex,
  TermItem,
  TermRef,
  IssueChunk,
  IssueDetail,
  IssueListItem,
  IssueRef,
  ListSection,
  ListStory,
  MonthDetail,
  MonthList,
  SearchRecord,
  SiteDates,
  SiteIssueList,
  SiteSource,
  StoryDetail,
  ScheduleChip,
  ScheduleIndex,
  ScheduleItem,
  ScheduleLine,
  ScheduleMonth,
  ScheduleNews,
  ScheduleOutcomeView,
  ScheduleRefChunk,
  WeekSchedules,
} from "../../../src/siteTypes.ts";
export type { Major, SectionName } from "../../../src/categories.ts";

export interface SourceLike {
  primary?: boolean;
  imageUrl?: string;
}
