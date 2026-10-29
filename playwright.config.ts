// E2E 설정(pnpm e2e). 지어낸 데이터로 빌드한 사이트를 로컬 미리 보기 서버(127.0.0.1)로 띄워 Chromium으로 본다.
// 준비(test/e2e/prepare.ts)는 서버를 띄우기 전에 돌고, 실제 데이터 폴더(data/)는 쓰지 않는다.
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_OUT_DIR, E2E_PORT } from "./test/e2e/paths.ts";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "**/*.spec.ts",
  outputDir: ".test-data/e2e/results",
  fullyParallel: true,
  forbidOnly: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: E2E_BASE_URL,
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `node test/e2e/prepare.ts && node site/dev/serve.ts ${JSON.stringify(E2E_OUT_DIR)} --port ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/`,
    // 지난번 결과물로 돌지 않게 매번 새로 빌드해 띄운다
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
  },
});
