// 9.98단계 S6: 분야(9.97 S3)마다 어느 소스 묶음(공식 묶음, 커뮤니티 소스)이 그 분야를 볼 수 있는지의 대응을 이 파일 한 곳에 둔다.
// 소개의 사각지대 표는 이 값으로 만들고, 판정 문서(docs/demand-sources.md "분야와 소스 대응")의 표시 안 목록과 테스트가 대조한다.
// '볼 수 있다'는 그 묶음의 단위(공식) 또는 검색 건수(커뮤니티)가 그 분야의 이야기를 담을 수 있다는 뜻이다. 근거는 판정 문서에 있다.

import { COMMUNITY_GROUPS, COMMUNITY_INFO, FLOW_FIELDS, GROUP_INFO, OFFICIAL_GROUPS, type CommunityGroup, type OfficialGroup } from "./demandFlowTypes.ts";

export type CoverageGroup = OfficialGroup | CommunityGroup;
export type FieldId = (typeof FLOW_FIELDS)[number]["id"];

export interface CoverageColumn {
  id: CoverageGroup;
  /** 표의 칸 이름 */
  label: string;
  kind: "official" | "community";
}

/** 표의 칸 순서: 공식 묶음(OFFICIAL_GROUPS 순서), 그다음 커뮤니티 소스 */
export const COVERAGE_COLUMNS: readonly CoverageColumn[] = [
  ...OFFICIAL_GROUPS.map((id): CoverageColumn => ({ id, label: GROUP_INFO[id].label, kind: "official" })),
  ...COMMUNITY_GROUPS.map((id): CoverageColumn => ({ id, label: COMMUNITY_INFO[id].label, kind: "community" })),
];

/** 분야마다 그 분야를 볼 수 있는 묶음(FLOW_FIELDS 순서, 칸 순서) */
export const FIELD_COVERAGE: readonly { field: FieldId; groups: readonly CoverageGroup[] }[] = [
  { field: "housing", groups: ["assembly", "acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "finance", groups: ["assembly", "acrc", "ftc1372", "dart", "sec", "wikimedia", "github", "bluesky"] },
  { field: "health", groups: ["assembly", "acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "education", groups: ["assembly", "acrc", "ftc1372", "wikimedia", "bluesky"] },
  { field: "transport", groups: ["assembly", "acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "food", groups: ["assembly", "acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "travel", groups: ["acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "jobs", groups: ["assembly", "acrc", "wikimedia", "bluesky"] },
  { field: "software", groups: ["sec", "wikimedia", "github", "bluesky"] },
  { field: "devices", groups: ["ftc1372", "sec", "wikimedia", "github", "bluesky"] },
  { field: "entertainment", groups: ["assembly", "ftc1372", "wikimedia", "github", "bluesky"] },
  { field: "media", groups: ["assembly", "wikimedia", "bluesky"] },
  { field: "sports", groups: ["ftc1372", "wikimedia", "bluesky"] },
  { field: "retail", groups: ["acrc", "ftc1372", "sec", "wikimedia", "bluesky"] },
  { field: "energy", groups: ["assembly", "acrc", "sec", "wikimedia", "bluesky"] },
  { field: "welfare", groups: ["assembly", "acrc", "wikimedia"] },
  { field: "safety", groups: ["assembly", "acrc", "ftc1372", "wikimedia", "bluesky"] },
  { field: "public", groups: ["assembly", "acrc", "wikimedia"] },
  { field: "industry", groups: ["dart", "sec", "wikimedia"] },
  { field: "investment", groups: ["dart", "sec", "wikimedia", "bluesky"] },
  { field: "science", groups: ["wikimedia", "github", "bluesky"] },
];

