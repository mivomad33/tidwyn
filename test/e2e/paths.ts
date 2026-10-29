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
