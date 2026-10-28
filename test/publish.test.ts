import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { main, mainAsync, type Context } from "../src/cli.ts";
import { REPO_NOREPLY } from "../src/precheck.ts";
import { PRODUCTION_URL, WARN_BYTES, WARN_FILES, gitRemote, postDeployCheck, type HttpGet, type RemoteGit, type SiteBuilder, type VercelRunner } from "../src/publish.ts";
import { readRun, workFile, writeRun, type RunState } from "../src/run.ts";
import { checkOutput } from "../src/siteCheck.ts";
import { NOW, cleanupTemp, gitIn, listFiles, makeCtx, sampleBrief, tempDir, tempRepo, type TestCtx } from "./helpers.ts";

after(cleanupTemp);

// 사이트 빌드 → 배포 → push 흐름(3단계 4.5, 4.6, 4.1-4). 사이트 빌더, vercel, HTTP는 가짜다. 원격은 로컬 bare 저장소다(네트워크 없음).
// 걸리는 값(허용 목록 밖 메일 등)은 이 파일도 공개 전 점검 대상이라 실행할 때 조립한다.

const LEAK_EMAIL = ["reader", "private-box.test"].join("@");
const DEPLOY_URL = "https://tidwyn-abc123-mivomad33.vercel.app";

interface Fakes {
  builds: string[];
  vercelCalls: string[][];
  httpCalls: string[];
  remoteCalls: string[];
  buildSite: SiteBuilder;
  runVercel: VercelRunner;
  httpGet: HttpGet;
  remote: RemoteGit;
}

/** 사이트 데이터를 그대로 복사하고 화면 틀과 호스팅 설정을 쓰는 가짜 빌더 */
function fakeBuilder(builds: string[], plant?: (outDir: string) => void): SiteBuilder {
  return ({ inputDir, outDir }) => {
    builds.push(outDir);
    assert.ok(fs.existsSync(path.join(inputDir, "search-records.json")), "검색 레코드를 빌더에 넘긴다");
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(path.join(inputDir, "site-data"), path.join(outDir, "site-data"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "index.html"), '<!doctype html><html lang="ko"><body><div id="root"></div></body></html>\n');
    fs.mkdirSync(path.join(outDir, "assets"));
    fs.writeFileSync(path.join(outDir, "assets", "app.js"), "console.log('tidwyn');\n");
    fs.writeFileSync(path.join(outDir, "vercel.json"), JSON.stringify({ rewrites: [{ source: "/(.*)", destination: "/index.html" }] }));
    plant?.(outDir);
    return { ok: true };
  };
}

/** 운영 주소가 latest()를 최근 날짜로 돌려주는 가짜 HTTP */
function fakeHttp(calls: string[], latest: () => string | null): HttpGet {
  return async (url) => {
    calls.push(url);
    if (url === `${PRODUCTION_URL}/`) return { status: 200, contentType: "text/html; charset=utf-8", body: "<!doctype html>" };
    if (url === `${PRODUCTION_URL}/site-data/dates.json`) return { status: 200, contentType: "application/json", body: JSON.stringify({ version: 1, latestDate: latest(), dates: [], months: [] }) };
    return { status: 404, contentType: "text/plain", body: "" };
  };
}

function fakes(opts: { plant?: (outDir: string) => void; buildFails?: boolean; vercelStatus?: number; latest?: () => string | null } = {}): Fakes {
  const f = { builds: [] as string[], vercelCalls: [] as string[][], httpCalls: [] as string[], remoteCalls: [] as string[] } as Fakes;
  f.buildSite = opts.buildFails ? (a) => (f.builds.push(a.outDir), { ok: false, message: "가짜 빌더가 실패했다" }) : fakeBuilder(f.builds, opts.plant);
  f.runVercel = (args) => {
    f.vercelCalls.push(args);
    return opts.vercelStatus === undefined || opts.vercelStatus === 0
      ? { status: 0, stdout: `${DEPLOY_URL}\n`, stderr: "Production: deployed\n" }
      : { status: opts.vercelStatus, stdout: "", stderr: "Error: 가짜 배포 실패\n" };
  };
  f.httpGet = fakeHttp(f.httpCalls, opts.latest ?? (() => "2026-10-27"));
  f.remote = {
    remoteDataHead: (repo) => (f.remoteCalls.push("ls-remote"), gitRemote.remoteDataHead(repo)),
    fetchData: (repo) => (f.remoteCalls.push("fetch"), gitRemote.fetchData(repo)),
    pushData: (repo) => (f.remoteCalls.push("push"), gitRemote.pushData(repo)),
  };
  return f;
}

function ctxWith(repo: string, f: Fakes, env: NodeJS.ProcessEnv = {}, now = NOW): TestCtx {
  const ctx: TestCtx & Partial<Context> = makeCtx(repo, env, now);
  return Object.assign(ctx, { buildSite: f.buildSite, runVercel: f.runVercel, httpGet: f.httpGet, remote: f.remote, checkRetry: { attempts: 1, sleep: async () => {} } });
}

async function run(repo: string, argv: string[], f: Fakes, env: NodeJS.ProcessEnv = {}, now = NOW): Promise<{ code: number; text: string }> {
  const ctx = ctxWith(repo, f, env, now);
  const code = await mainAsync(argv, ctx);
  return { code, text: ctx.text() };
}

/** start → 대상 날짜 저장 → backup. 실행 기록 경로 */
async function collect(repo: string, f: Fakes, args: string[] = [], env: NodeJS.ProcessEnv = {}, now = NOW, edit?: (b: ReturnType<typeof sampleBrief>) => void): Promise<string> {
  const s = await run(repo, ["start", ...args], f, env, now);
  assert.equal(s.code, 0, s.text);
  const runFile = /실행 기록: (.+)/.exec(s.text)![1]!;
  for (const date of readRun(runFile).targetDates) {
    const brief = sampleBrief(date);
    edit?.(brief);
    const file = workFile(readRun(runFile).dataDir, date);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(brief));
    const saved = await run(repo, ["save", "--run", runFile, "--date", date], f, env, now);
    assert.equal(saved.code, 0, saved.text);
  }
  const b = await run(repo, ["backup", "--run", runFile], f, env, now);
  assert.equal(b.code, 0, b.text);
  return runFile;
}

/** 실제 실행으로 판정되는 임시 저장소(백업 커밋이 noreply 주소로 만들어진다) */
function realRepo(): string {
  const repo = tempRepo();
  gitIn(repo, "config", "user.email", REPO_NOREPLY);
  return repo;
}

function addOrigin(repo: string): string {
  const bare = path.join(tempDir("tidwyn-origin-"), "origin.git");
  gitIn(path.dirname(bare), "init", "-q", "--bare", bare);
  gitIn(repo, "remote", "add", "origin", bare);
  return bare;
}

function remoteCount(bare: string): number {
  const r = gitIn(bare, "for-each-ref", "refs/heads/data");
  return r.trim() === "" ? 0 : Number(gitIn(bare, "rev-list", "--count", "refs/heads/data").trim());
}

/** /brief의 16~19단계 */
async function publishSteps(repo: string, runFile: string, f: Fakes, env: NodeJS.ProcessEnv = {}) {
  const site = await run(repo, ["site", "--run", runFile], f, env);
  const deploy = await run(repo, ["deploy", "--run", runFile], f, env);
  const push = await run(repo, ["push", "--run", runFile], f, env);
  const summary = await run(repo, ["summary", "--run", runFile], f, env);
  return { site, deploy, push, summary };
}

describe("3단계 4.5 사이트 빌드 → 배포 → push", () => {
  test("실제 실행: 결과물 폴더만 정한 인자로 배포하고, 배포 뒤 점검을 통과하고, data를 push하며 요약에 나온다", async () => {
    const repo = realRepo();
    const bare = addOrigin(repo);
    const f = fakes();
    const runFile = await collect(repo, f);
    const r = await publishSteps(repo, runFile, f);
    assert.equal(r.site.code, 0, r.site.text);
    const outDir = path.join(repo, "data", "site");
    assert.deepEqual(f.builds, [outDir], "결과물은 데이터 폴더의 site/에 만든다");
    assert.equal(r.deploy.code, 0, r.deploy.text);
    assert.deepEqual(f.vercelCalls, [["deploy", outDir, "--scope", "mivomad33", "--project", "tidwyn", "--prod", "--yes"]]);
    assert.deepEqual(f.httpCalls, [`${PRODUCTION_URL}/`, `${PRODUCTION_URL}/site-data/dates.json`]);
    assert.equal(r.push.code, 0, r.push.text);
    assert.equal(remoteCount(bare), 1);
    assert.equal(gitIn(bare, "rev-parse", "refs/heads/data").trim(), gitIn(repo, "rev-parse", "refs/heads/data").trim());
    const s = r.summary.text;
    assert.match(s, /- 사이트 빌드: 브리프 날짜 1개, 이슈 0개, 결과물 0\.\d+MB, 파일 \d+개/);
    assert.match(s, /- 배포: https:\/\/tidwyn\.vercel\.app에 운영 배포함 \(배포 주소 https:\/\/tidwyn-abc123-mivomad33\.vercel\.app\), 배포 뒤 점검 통과\(최근 날짜 2026-10-27\)/);
    assert.match(s, /- data 브랜치 push: 커밋 1개를 origin에 push함/);
    assert.doesNotMatch(s, /로컬에서 보기/, "실제 실행은 로컬 보기 명령을 보이지 않는다");
    assert.ok(s.indexOf("- 백업:") < s.indexOf("- 사이트 빌드:"));
    assert.equal(gitIn(repo, "status", "--porcelain"), "", "결과물과 빌드 입력은 git이 무시하는 데이터 폴더 안에 있다");
  });

  test("같은 DB로 두 번 빌드하면 결과물 파일 목록과 내용이 같다(빌드마다 비우고 다시 만든다)", async () => {
    const repo = tempRepo();
    const f = fakes();
    const runFile = await collect(repo, f, ["test"]);
    const outDir = path.join(readRun(runFile).dataDir, "site");
    const snapshot = () => new Map(listFiles(outDir).filter((p) => fs.statSync(path.join(outDir, p)).isFile()).map((p) => [p, fs.readFileSync(path.join(outDir, p), "utf8")]));
    assert.equal((await run(repo, ["site", "--run", runFile], f)).code, 0);
    const first = snapshot();
    fs.writeFileSync(path.join(outDir, "stale.txt"), "old");
    assert.equal((await run(repo, ["site", "--run", runFile], f)).code, 0);
    assert.deepEqual(snapshot(), first);
    assert.ok(first.has("site-data/dates.json"));
  });

  test("빌드가 실패하면 배포하지 않고, push는 계속하며, 요약에 실패가 나온다", async () => {
    const repo = realRepo();
    const bare = addOrigin(repo);
    const f = fakes({ buildFails: true });
    const runFile = await collect(repo, f);
    const r = await publishSteps(repo, runFile, f);
    assert.equal(r.site.code, 1);
    assert.equal(r.deploy.code, 0);
    assert.deepEqual(f.vercelCalls, [], "빌드가 실패하면 vercel을 부르지 않는다");
    assert.equal(r.push.code, 0, r.push.text);
    assert.equal(remoteCount(bare), 1);
    assert.match(r.summary.text, /- 사이트 빌드: 실패\(배포하지 않는다, 다음 실행이 다시 빌드한다\): 가짜 빌더가 실패했다/);
    assert.match(r.summary.text, /- 배포: 건너뜀 \(사이트 빌드가 실패해 배포하지 않았다\)/);
    assert.match(r.summary.text, /- data 브랜치 push: 커밋 1개를 origin에 push함/);
  });

  test("배포가 실패하면(가짜 vercel 종료 코드 1) 기록하고 push는 계속한다", async () => {
    const repo = realRepo();
    const bare = addOrigin(repo);
    const f = fakes({ vercelStatus: 1 });
    const runFile = await collect(repo, f);
    const r = await publishSteps(repo, runFile, f);
    assert.equal(r.deploy.code, 1);
    assert.equal(f.vercelCalls.length, 1);
    assert.deepEqual(f.httpCalls, [], "배포가 실패하면 배포 뒤 점검을 하지 않는다");
    assert.equal(readRun(runFile).deploy?.status, "failed");
    assert.equal(r.push.code, 0);
    assert.equal(remoteCount(bare), 1);
    assert.match(r.summary.text, /- 배포: 실패\(다음 실행이 다시 배포한다\): vercel deploy가 실패했다\(종료 코드 1\): Error: 가짜 배포 실패/);
  });

  test("원격이 없으면 push 실패를 기록하고, 다음 실행이 앞선 커밋 두 개를 함께 push한다", async () => {
    const repo = realRepo();
    const f = fakes();
    const run1 = await collect(repo, f);
    const r1 = await publishSteps(repo, run1, f);
    assert.equal(r1.push.code, 1);
    assert.match(r1.summary.text, /- data 브랜치 push: 실패\(다음 실행이 밀린 커밋을 다시 점검하고 push한다\): 원격 저장소\(origin\)가 없다/);
    assert.match(r1.summary.text, /배포 뒤 점검 통과/, "push 실패와 상관없이 앞 단계 결과가 나온다");

    const next = new Date("2026-10-29T09:00:00+09:00");
    const f2 = fakes({ latest: () => "2026-10-28" });
    const run2 = await collect(repo, f2, [], {}, next);
    assert.deepEqual(readRun(run2).targetDates, ["2026-10-28"]);
    const bare = addOrigin(repo);
    const r2 = await publishSteps(repo, run2, f2);
    assert.equal(r2.push.code, 0, r2.push.text);
    assert.match(r2.summary.text, /커밋 2개를 origin에 push함/);
    assert.equal(remoteCount(bare), 2);
    assert.deepEqual(f2.remoteCalls, ["ls-remote", "push"], "원격 data가 없으면 받지 않고 이력 전체를 push한다");

    const again = await run(repo, ["push", "--run", run2], f2);
    assert.match(again.text, /원격과 같아 push할 것이 없다/);
  });

  test("push 전 공개 전 점검에 걸리면(허용 목록 밖 메일이 든 백업 커밋) push하지 않고 가린 내용만 알린다", async () => {
    const repo = realRepo();
    const bare = addOrigin(repo);
    const f = fakes();
    const runFile = await collect(repo, f, [], {}, NOW, (b) => {
      b.sections[0]!.topStories[0]!.background = `제보는 ${LEAK_EMAIL}로 받았다고 한다.`;
    });
    const p = await run(repo, ["push", "--run", runFile], f);
    assert.equal(p.code, 1);
    assert.equal(remoteCount(bare), 0);
    assert.deepEqual(f.remoteCalls, ["ls-remote"], "push를 부르지 않는다");
    const s = (await run(repo, ["summary", "--run", runFile], f)).text;
    assert.match(s, /- data 브랜치 push: 실패.*공개 전 점검에 걸려 push하지 않았다\(커밋 1개, 1건\)/);
    assert.match(s, /커밋 [0-9a-f]{7} 2026-10\.json \(줄 \d+\): 허용 목록 밖 메일 주소/);
    assert.ok(!p.text.includes(LEAK_EMAIL) && !s.slice(0, s.indexOf("---")).includes(LEAK_EMAIL), "값은 출력하지 않는다");
  });

  test("시험 모드와 데이터 폴더 지정 실행은 빌드만 하고 배포·push를 부르지 않는다", async () => {
    const repo = realRepo();
    addOrigin(repo);
    const f = fakes();
    const runFile = await collect(repo, f, ["test"]);
    const r = await publishSteps(repo, runFile, f);
    const dataDir = readRun(runFile).dataDir;
    assert.ok(dataDir.startsWith(path.join(repo, ".test-data")));
    assert.deepEqual(f.builds, [path.join(dataDir, "site")]);
    assert.ok(fs.existsSync(path.join(dataDir, "site", "index.html")));
    assert.deepEqual(f.vercelCalls, []);
    assert.deepEqual(f.remoteCalls, []);
    assert.deepEqual([r.deploy.code, r.push.code], [0, 0]);
    assert.match(r.summary.text, /- 배포: 건너뜀 \(시험 모드·데이터 폴더 지정 실행은 배포하지 않는다\)/);
    assert.match(r.summary.text, /- data 브랜치 push: 건너뜀 \(시험 모드·데이터 폴더 지정 실행은 push하지 않는다\)/);
    assert.ok(r.summary.text.includes(`  - 결과물: ${path.join(dataDir, "site")}`));
    assert.ok(r.summary.text.includes(`  - 로컬에서 보기: pnpm site:preview ${JSON.stringify(path.join(dataDir, "site"))}`));
    assert.equal(gitIn(repo, "status", "--porcelain"), "");

    const custom = tempDir();
    const f2 = fakes();
    const run2 = await collect(repo, f2, [], { TIDWYN_DATA_DIR: custom });
    await publishSteps(repo, run2, f2, { TIDWYN_DATA_DIR: custom });
    assert.deepEqual(f2.builds, [path.join(custom, "site")]);
    assert.deepEqual([f2.vercelCalls, f2.remoteCalls], [[], []]);
  });

  test("site --data-dir는 실행 기록 없이 그 폴더의 DB로 빌드한다", async () => {
    const repo = tempRepo();
    const f = fakes();
    const runFile = await collect(repo, f, ["test"]);
    const dataDir = readRun(runFile).dataDir;
    const f2 = fakes();
    const r = await run(repo, ["site", "--data-dir", dataDir], f2);
    assert.equal(r.code, 0, r.text);
    assert.match(r.text, /사이트 빌드: 브리프 날짜 1개/);
    assert.deepEqual(f2.builds, [path.join(dataDir, "site")]);
    assert.equal((await run(repo, ["site"], f2)).code, 2, "--run이나 --data-dir 중 하나가 필요하다");
  });
});

describe("3단계 4.1-4 결과물 검사", () => {
  test("들어가면 안 되는 파일과 글을 찾고, 바이너리 파일의 글자는 건너뛴다", () => {
    const out = tempDir();
    const home = "/Users/fake-owner-k2";
    const put = (rel: string, content: string | Buffer) => {
      fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
      fs.writeFileSync(path.join(out, rel), content);
    };
    put("index.html", "<!doctype html><p>user@example.com logo@2x.png</p>");
    put("site-data/list-2026-10.json", "{}");
    put("tidwyn.db", "x");
    put("assets/data.bin", Buffer.concat([Buffer.from("SQLite format 3\0", "latin1"), Buffer.alloc(10)]));
    put("2026-10.json", "{}");
    put("deep/issues.json", "{}");
    put("deep/er/meta.json", "{}");
    put("runs/20261028-090000.json", "{}");
    put("2026-10-27.candidates.json", "{}");
    put("snapshots/tidwyn-20261028-090000.db", "x");
    put("assets/app.js", `const a = "${home}/x";\nconst b = "${LEAK_EMAIL}";\nconst c = "${["gh", "o_"].join("") + "k".repeat(36)}";\n`);
    put("assets/key.txt", `${"-".repeat(5)}BEGIN PRIVATE KEY${"-".repeat(5)}\n`);
    put("pagefind/fragment/x.pf_fragment", `${LEAK_EMAIL}`);
    put("fonts/a.woff2", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(LEAK_EMAIL)]));
    put(".env", "A=1\n");
    const r = checkOutput(out, home);
    const got = r.findings.map((x) => `${x.where} ${x.kind}`).sort();
    assert.deepEqual(got, [
      ".env .env 파일",
      "2026-10-27.candidates.json 실행 기록·작업 파일",
      "2026-10.json 백업 파일 이름",
      "assets/app.js GitHub 토큰 모양",
      "assets/app.js 허용 목록 밖 메일 주소",
      "assets/app.js 홈 폴더 절대 경로",
      "assets/data.bin SQLite 파일",
      "assets/key.txt 개인 키 머리",
      "deep/er/meta.json 백업 파일 이름",
      "deep/issues.json 백업 파일 이름",
      "runs/20261028-090000.json 실행 기록·작업 파일",
      "snapshots/tidwyn-20261028-090000.db 실행 기록·작업 파일",
      "snapshots/tidwyn-20261028-090000.db 실행 전 사본",
      "tidwyn.db SQLite 파일",
    ]);
    assert.equal(r.files, 15);
    assert.ok(r.bytes > 0);
  });

  test("빌드 결과물이 검사에 걸리면 빌드 실패로 기록하고, 손으로 하는 배포도 올리지 않는다", async () => {
    const repo = realRepo();
    const f = fakes({ plant: (out) => fs.writeFileSync(path.join(out, "meta.json"), "{}") });
    const runFile = await collect(repo, f);
    const r = await publishSteps(repo, runFile, f);
    assert.equal(r.site.code, 1);
    assert.match(r.summary.text, /- 사이트 빌드: 실패\(배포하지 않는다, 다음 실행이 다시 빌드한다\): 결과물 검사에 걸렸다\(1건\)\n\s+- meta\.json: 백업 파일 이름/);
    assert.deepEqual(f.vercelCalls, []);

    const outDir = readRun(runFile).site!.outDir;
    fs.rmSync(path.join(outDir, "meta.json"));
    fs.writeFileSync(path.join(outDir, "assets", "extra.js"), `// ${LEAK_EMAIL}\n`);
    const d = await run(repo, ["deploy", "--dir", outDir, "--db", readRun(runFile).dbPath], f);
    assert.equal(d.code, 1);
    assert.match(d.text, /배포: 실패\(다음 실행이 다시 배포한다\): 결과물 검사에 걸려 올리지 않았다\(1건\)\n\s+- assets\/extra\.js \(줄 1\): 허용 목록 밖 메일 주소/);
    assert.deepEqual(f.vercelCalls, [], "검사에 걸리면 vercel을 부르지 않는다");

    fs.rmSync(path.join(outDir, "assets", "extra.js"));
    const ok = await run(repo, ["deploy", "--dir", outDir, "--db", readRun(runFile).dbPath], f);
    assert.equal(ok.code, 0, ok.text);
    assert.deepEqual(f.vercelCalls, [["deploy", outDir, "--scope", "mivomad33", "--project", "tidwyn", "--prod", "--yes"]], "손으로 하는 배포도 결과물 폴더만 올린다");
  });
});

describe("3단계 4.6-3 배포 뒤 점검", () => {
  const http = (home: { status: number; type: string } | Error, dates: { status: number; body: string } | Error): HttpGet => async (url) => {
    const r = url.endsWith("/dates.json") ? dates : home;
    if (r instanceof Error) throw r;
    return "type" in r ? { status: r.status, contentType: r.type, body: "" } : { status: r.status, contentType: "application/json", body: r.body };
  };
  const okHome = { status: 200, type: "text/html" };
  const dates = (d: string | null) => ({ status: 200, body: JSON.stringify({ latestDate: d }) });

  test("최근 날짜가 DB와 같으면 통과", async () => {
    assert.deepEqual(await postDeployCheck(http(okHome, dates("2026-10-27")), "2026-10-27"), { status: "passed", latestDate: "2026-10-27" });
  });
  test("운영 주소가 아직 이전 배포를 가리키면 정해진 횟수 안에서 다시 보고, 새 날짜가 보이면 통과", async () => {
    let n = 0;
    let slept = 0;
    const get: HttpGet = async (url) =>
      url.endsWith("/") ? { status: 200, contentType: "text/html", body: "" } : n++ < 2 ? { status: 404, contentType: "text/plain", body: "" } : { status: 200, contentType: "application/json", body: JSON.stringify({ latestDate: "2026-10-27" }) };
    const r = await postDeployCheck(get, "2026-10-27", { attempts: 6, sleep: async () => void slept++ });
    assert.deepEqual(r, { status: "passed", latestDate: "2026-10-27" });
    assert.equal(slept, 2);
    const fail = await postDeployCheck(http(okHome, dates("2026-10-26")), "2026-10-27", { attempts: 3, sleep: async () => {} });
    assert.equal(fail.status, "failed");
    assert.match(fail.status === "failed" ? fail.reason : "", /\(3번 확인\)$/);
  });
  test("날짜가 다르면 실패", async () => {
    const r = await postDeployCheck(http(okHome, dates("2026-10-26")), "2026-10-27");
    assert.deepEqual(r, { status: "failed", reason: "운영 사이트의 최근 날짜(2026-10-26)가 DB의 최근 저장일(2026-10-27)과 다르다" });
  });
  test("받지 못하면 실패(첫 화면 네트워크 오류, 첫 화면 404, HTML 아님, 사이트 데이터 오류)", async () => {
    const cases: [HttpGet, RegExp][] = [
      [http(new Error("ECONNRESET"), dates("2026-10-27")), /첫 화면을 받지 못했다: ECONNRESET/],
      [http({ status: 404, type: "text/html" }, dates("2026-10-27")), /첫 화면이 404이다/],
      [http({ status: 200, type: "application/json" }, dates("2026-10-27")), /첫 화면이 HTML이 아니다/],
      [http(okHome, new Error("timeout")), /dates\.json\)를 받지 못했다: timeout/],
      [http(okHome, { status: 200, body: "<html>" }), /dates\.json\)를 받지 못했다/],
      [http(okHome, { status: 404, body: "" }), /dates\.json\)가 404이다/],
    ];
    for (const [get, re] of cases) {
      const r = await postDeployCheck(get, "2026-10-27");
      assert.equal(r.status, "failed");
      assert.match(r.status === "failed" ? r.reason : "", re);
    }
  });
  test("배포 뒤 점검이 실패하면 배포는 기록되고 종료 코드 1, 요약에 실패가 나온다(되돌리지 않는다)", async () => {
    const repo = realRepo();
    addOrigin(repo);
    const f = fakes({ latest: () => "2026-10-20" });
    const runFile = await collect(repo, f);
    const r = await publishSteps(repo, runFile, f);
    assert.equal(r.deploy.code, 1);
    assert.equal(f.vercelCalls.length, 1, "한 번만 배포하고 이전 배포로 되돌리지 않는다");
    assert.match(r.summary.text, /배포 뒤 점검 실패: 운영 사이트의 최근 날짜\(2026-10-20\)가 DB의 최근 저장일\(2026-10-27\)과 다르다 \(자동으로 되돌리지 않았다/);
    assert.equal(r.push.code, 0);
  });
});

describe("3단계 4.5-4 요약의 한도 경고", () => {
  function summaryFor(site: { bytes: number; files: number }): string {
    const repo = tempRepo();
    const dataDir = tempDir();
    const state: RunState = {
      startedAt: "2026-10-28T09:00:00+09:00",
      mode: "real",
      dataDir,
      dbPath: path.join(dataDir, "tidwyn.db"),
      backupRepo: null,
      noCommitReason: "x",
      targetDates: [],
      results: {},
      backup: null,
      site: { status: "built", outDir: path.join(dataDir, "site"), dates: 400, issues: 900, ...site },
      deploy: null,
      push: null,
    };
    const file = path.join(dataDir, "runs", "r.json");
    writeRun(file, state);
    const ctx = makeCtx(repo);
    assert.equal(main(["summary", "--run", file], ctx), 0);
    return ctx.text();
  }
  test("80MB와 12,000개는 문턱이고, 넘으면 경고한다", () => {
    assert.equal(WARN_BYTES, 80_000_000);
    assert.equal(WARN_FILES, 12_000);
    const at = summaryFor({ bytes: WARN_BYTES, files: WARN_FILES });
    assert.match(at, /- 사이트 빌드: 브리프 날짜 400개, 이슈 900개, 결과물 80\.0MB, 파일 12000개/);
    assert.doesNotMatch(at, /경고: Vercel/);
    assert.match(summaryFor({ bytes: WARN_BYTES + 1, files: WARN_FILES }), /경고: Vercel 무료 한도\(100MB, 파일 15,000개\)에 가깝다/);
    assert.match(summaryFor({ bytes: 1000, files: WARN_FILES + 1 }), /경고: Vercel 무료 한도/);
    assert.match(at, /- 배포: 실행하지 않았다/);
    assert.match(at, /- data 브랜치 push: 실행하지 않았다/);
  });
  test("사이트 단계가 없는 앞 단계 실행 기록에는 사이트 줄을 붙이지 않는다", () => {
    const repo = tempRepo();
    const dataDir = tempDir();
    const file = path.join(dataDir, "r.json");
    writeRun(file, { startedAt: "x", mode: "test", dataDir, dbPath: path.join(dataDir, "tidwyn.db"), backupRepo: null, noCommitReason: "x", targetDates: [], results: {}, backup: null });
    const ctx = makeCtx(repo);
    assert.equal(main(["summary", "--run", file], ctx), 0);
    assert.doesNotMatch(ctx.text(), /사이트 빌드|배포:|push:/);
  });
});
