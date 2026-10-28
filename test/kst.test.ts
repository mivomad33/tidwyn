import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { PROJECT_ROOT } from "./helpers.ts";

// 4.1-4: 시스템 시간대와 관계없이 KST로 계산한다. 시간대마다 새 프로세스로 확인한다.
const script = `
import { kstDate, kstYesterday } from "./src/kst.ts";
const cases = ["2026-10-27T14:59:59Z", "2026-10-27T15:00:00Z"];
console.log(JSON.stringify(cases.map((c) => [kstDate(new Date(c)), kstYesterday(new Date(c))])));
`;

function runIn(tz: string): unknown {
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: PROJECT_ROOT, env: { ...process.env, TZ: tz }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

test("KST 자정 직전·직후의 대상일이 시간대와 관계없이 같다", () => {
  const expected = [
    ["2026-10-27", "2026-10-26"],
    ["2026-10-28", "2026-10-27"],
  ];
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Seoul"]) assert.deepEqual(runIn(tz), expected, tz);
});
