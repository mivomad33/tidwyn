// E2E 테스트가 쓰는 폴더와 서버 주소(준비 스크립트·설정·테스트가 함께 쓴다)
import path from "node:path";

export const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");
/** 시험 데이터 폴더(git·eslint가 무시한다) */
export const E2E_ROOT = path.join(PROJECT_ROOT, ".test-data", "e2e");
export const E2E_DATA_DIR = path.join(E2E_ROOT, "data");
export const E2E_OUT_DIR = path.join(E2E_ROOT, "out");
export const E2E_INFO_FILE = path.join(E2E_ROOT, "info.json");
/** 로컬 미리 보기 서버(127.0.0.1만 쓴다) */
export const E2E_PORT = 4319;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
/** 5단계: 일정이 있는 지어낸 데이터(stage5.spec.ts가 사이트 데이터 요청을 이 폴더의 파일로 바꿔 준다). 위 데이터는 일정 없이 그대로 둔다 */
export const E2E_SCHEDULE_DATA_DIR = path.join(E2E_ROOT, "schedule-data");
export const E2E_SCHEDULE_INFO_FILE = path.join(E2E_ROOT, "schedule-info.json");
/** 6단계: 일정과 지표가 있는 지어낸 데이터(stage6.spec.ts가 사이트 데이터 요청을 이 폴더의 파일로 바꿔 준다) */
export const E2E_INDICATOR_DATA_DIR = path.join(E2E_ROOT, "indicator-data");
export const E2E_INDICATOR_INFO_FILE = path.join(E2E_ROOT, "indicator-info.json");
/** 9.6단계: 30일보다 앞선 브리프 날짜에 새로 받은 영상이 있는 지어낸 데이터(stage96.spec.ts가 사이트 데이터 요청을 이 폴더의 파일로 바꿔 준다) */
export const E2E_VIDEO_DATA_DIR = path.join(E2E_ROOT, "video-data");
export const E2E_VIDEO_INFO_FILE = path.join(E2E_ROOT, "video-info.json");
/** 9.8단계: 빌더가 있는 지어낸 데이터. 정적 HTML과 검색 색인까지 봐야 해서 따로 빌드해 다른 포트로 띄운다(위 사이트의 데이터와 기준 이미지를 그대로 두기 위해서다) */
export const E2E_BUILDER_DATA_DIR = path.join(E2E_ROOT, "builder-data");
export const E2E_BUILDER_OUT_DIR = path.join(E2E_ROOT, "builder-out");
export const E2E_BUILDER_INFO_FILE = path.join(E2E_ROOT, "builder-info.json");
export const E2E_BUILDER_PORT = 4320;
export const E2E_BUILDER_BASE_URL = `http://127.0.0.1:${E2E_BUILDER_PORT}`;
/** 9.97단계: 수요 흐름(빌더·영상과 함께)이 있는 지어낸 데이터. 빌더 사이트의 기준 이미지를 그대로 두려고 따로 빌드해 다른 포트로 띄운다 */
export const E2E_DEMAND_DATA_DIR = path.join(E2E_ROOT, "demand-data");
export const E2E_DEMAND_OUT_DIR = path.join(E2E_ROOT, "demand-out");
export const E2E_DEMAND_INFO_FILE = path.join(E2E_ROOT, "demand-info.json");
export const E2E_DEMAND_PORT = 4321;
export const E2E_DEMAND_BASE_URL = `http://127.0.0.1:${E2E_DEMAND_PORT}`;
/** U1단계: 측정 데이터(감사·명세서의 정상 데이터, 2026-11-06까지 18일)로 빌드한 사이트. 화면 18곳을 감사와 같은 데이터로 보려고 따로 빌드해 다른 포트로 띄운다(명세서 용어 '측정 데이터 E2E') */
export const E2E_U1_DATA_DIR = path.join(E2E_ROOT, "u1-data");
export const E2E_U1_OUT_DIR = path.join(E2E_ROOT, "u1-out");
export const E2E_U1_PORT = 4322;
/** 옛 코드(기능이 없을 때)의 결과물로 같은 테스트를 돌려 실패를 볼 때만 바꾼다(`E2E_U1_BASE_URL=http://127.0.0.1:<포트> pnpm e2e test/e2e/stageU1.spec.ts`) */
export const E2E_U1_BASE_URL = process.env.E2E_U1_BASE_URL ?? `http://127.0.0.1:${E2E_U1_PORT}`;
