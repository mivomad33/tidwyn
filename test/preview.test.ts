import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { mainAsync, type Context } from "../src/cli.ts";
import type { VercelRunner } from "../src/publish.ts";
import { cleanupTemp, makeCtx, tempDir, tempRepo, type TestCtx, writeFakePublicFiles } from "./helpers.ts";

after(cleanupTemp);

// 4단계 4.8-1 미리보기 배포. vercel은 가짜다(네트워크 없음).
// 걸리는 값은 이 파일도 공개 전 점검 대상이라 실행할 때 조립한다.

const LEAK_EMAIL = ["reader", "private-box.test"].join("@");
const PREVIEW_URL = "https://tidwyn-p1a2b3-mivomad33.vercel.app";

function outDir(plant?: string): string {
  const dir = path.join(tempDir(), "site");
  fs.mkdirSync(path.join(dir, "site-data"), { recursive: true });
  writeFakePublicFiles(dir);
  fs.writeFileSync(path.join(dir, "site-data", "dates.json"), JSON.stringify({ version: 1, latestDate: null, dates: [], months: [] }));
  if (plant !== undefined) fs.writeFileSync(path.join(dir, "site-data", "leak.json"), JSON.stringify({ note: plant }));
  return dir;
}

async function deploy(argv: string[]): Promise<{ code: number; text: string; calls: string[][] }> {
  const calls: string[][] = [];
  const runVercel: VercelRunner = (args) => {
    calls.push(args);
    return { status: 0, stdout: `${PREVIEW_URL}\n`, stderr: "Preview: deployed\n" };
  };
  const ctx: TestCtx & Partial<Context> = makeCtx(tempRepo(), { HOME: tempDir() });
  const code = await mainAsync(argv, Object.assign(ctx, { runVercel }));
  return { code, text: ctx.text(), calls };
}

describe("4단계 4.8-1 미리보기 배포", () => {
  test("deploy --dir --preview는 --prod 없이 같은 범위·프로젝트로 올리고 미리보기 주소를 알린다", async () => {
    const dir = outDir();
    const r = await deploy(["deploy", "--dir", dir, "--preview"]);
    assert.equal(r.code, 0, r.text);
    assert.equal(r.calls.length, 1);
    assert.deepEqual(r.calls[0], ["deploy", dir, "--scope", "mivomad33", "--project", "tidwyn", "--yes"]);
    assert.ok(!r.calls[0]!.includes("--prod"));
    assert.match(r.text, new RegExp(`미리보기 배포함: ${PREVIEW_URL.replace(/[.]/g, "\\.")}`));
    assert.match(r.text, /운영 주소\(https:\/\/tidwyn\.vercel\.app\)는 바뀌지 않았다/);
  });
  test("결과물 검사에 걸리면 올리지 않는다", async () => {
    const r = await deploy(["deploy", "--dir", outDir(LEAK_EMAIL), "--preview"]);
    assert.equal(r.code, 1, r.text);
    assert.equal(r.calls.length, 0);
    assert.match(r.text, /결과물 검사에 걸려 올리지 않았다/);
  });
  test("--preview는 --run·--db와 함께 쓰지 않는다", async () => {
    const r = await deploy(["deploy", "--dir", outDir(), "--preview", "--db", "x.db"]);
    assert.equal(r.code, 2, r.text);
    assert.equal(r.calls.length, 0);
  });
});
