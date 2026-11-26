/** 지금 쓰는 백업 파일 이름. 백업·복원(backup.ts)과 공개 전 점검·결과물 검사(precheck.ts)가 함께 쓴다 */
export const META_FILE = "meta.json";
export const ISSUES_FILE = "issues.json";
export const REFS_FILE = "refs.json";
export const SCHEDULES_FILE = "schedules.json";
export const INDICATORS_FILE = "indicators.json";
export const CORRECTIONS_FILE = "corrections.json";
/** B1: 저장소 기록. 옛 빌더 파일 이름(builder.json)은 옛 형식으로 읽히므로 쓰지 않는다 */
export const REPOS_FILE = "repos.json";
/** B2: 영상 기록. R1이 막는 옛 영상 파일 이름(videos-)을 쓰지 않는다 */
export const WATCH_FILE = "watch.json";
/** 월별 브리프 파일(YYYY-MM.json) */
export const MONTH_RE = /^\d{4}-\d{2}\.json$/;

const CURRENT_FILES: ReadonlySet<string> = new Set([META_FILE, ISSUES_FILE, REFS_FILE, SCHEDULES_FILE, INDICATORS_FILE, CORRECTIONS_FILE, REPOS_FILE, WATCH_FILE]);

/** 지금 쓰는 백업 파일 이름인지(월별 파일 포함). 지운 기능(R1)의 옛 파일은 들지 않는다 */
export function isCurrentBackupName(name: string): boolean {
  return CURRENT_FILES.has(name) || MONTH_RE.test(name);
}
