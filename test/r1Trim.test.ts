import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";
import { COMMAND_NAMES, main, mainAsync } from "../src/cli.ts";
import { openDb } from "../src/db.ts";
import { RETIRED_KEY_NAMES } from "../src/keys.ts";
import { REPO_NOREPLY } from "../src/precheck.ts";
import type { SiteBuilder } from "../src/publish.ts";
import { readRun, workFile } from "../src/run.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { PROJECT_ROOT, cleanupTemp, gitIn, listFiles, makeCtx, sampleBrief, tempDir, tempRepo, writeFakePublicFiles } from "./helpers.ts";

// R1(기능 줄이기) 4.1 스킬·CLI·키, 4.2-4 정정, 4.2-5 데이터 경로. 임시 폴더와 임시 git 저장소만 쓴다. 값은 모두 가짜다.
// 걸리는 키 값은 이 파일도 공개 전 점검 대상이라 실행할 때 조립한다.

after(cleanupTemp);

const SKILL_FILE = path.join(PROJECT_ROOT, ".claude/skills/brief/SKILL.md");

// ---- 지운 기능 낱말(명세 4.0) ----

/** 지운 기능 낱말. 대소문자를 가리지 않고, '수요일'은 '수요'에 걸리지 않는다. flow·흐름은 뉴스 흐름에도 쓰여 넣지 않는다 */
const RETIRED_WORDS: readonly [string, RegExp][] = [
  ["video", /video/i],
  ["youtube", /youtube/i],
  ["gemini", /gemini/i],
  ["builder", /builder/i],
  ["discover", /discover/i],
  ["product hunt", /product ?hunt/i],
  ["repo snapshot", /repo[ _-]?snapshot/i],
  ["demand", /demand/i],
  ["community", /community/i],
  // "영상"은 B2(2026-11-26)가 영상 탭 이름으로 다시 쓴다(B2 명세서 3.4)
  // "빌더"는 B1(2026-11-25)이 저장소 탭 이름으로 다시 쓴다(B1 명세서 3.4)
  ["수요", /수요(?!일)/],
  ["새 제품", /새 제품/],
  ["뜨는 저장소", /뜨는 저장소/],
  ["커뮤니티", /커뮤니티/],
  ["흐름 항목", /흐름 항목/],
];

/** B2(명세서 3.4)가 다시 쓰는 이름. 이것만 지우고 낱말을 본다(옛 명령 video-fetch, YouTube Data API 등은 그대로 걸린다) */
const REUSED_NAMES = /video-pick|youtube-insight|TIDWYN_YOUTUBE_DB/gi;

/** 글 속 지운 기능 낱말의 자리(줄 번호와 낱말) */
function retiredWordHits(text: string): string[] {
  const hits: string[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.replace(REUSED_NAMES, "");
    for (const [name, re] of RETIRED_WORDS) if (re.test(line)) hits.push(`${i + 1}행 ${name}: ${raw.trim().slice(0, 80)}`);
  });
  return hits;
}

// ---- 스킬 문서의 실행 순서 표와 본문 절(4.1-1) ----

interface Row {
  step: string;
  command: string;
}

/** "## 1. 실행 순서"의 표 줄 */
function orderRows(skill: string): Row[] {
  const start = skill.indexOf("\n## 1. 실행 순서");
  assert.ok(start >= 0, "실행 순서 절이 없다");
  const end = skill.indexOf("\n## ", start + 1);
  const rows: Row[] = [];
  for (const line of skill.slice(start, end < 0 ? undefined : end).split("\n")) {
    const m = /^\| (\d+(?:-\d+)?) \| [^|]+ \| (.+) \|$/.exec(line);
    if (m) rows.push({ step: m[1]!, command: m[2]! });
  }
  return rows;
}

/** 단계 번호를 견줄 수 있게 [주 번호, 하위 번호]로 */
function stepKey(step: string): [number, number] {
  const [a, b] = step.split("-");
  return [Number(a), b === undefined ? 0 : Number(b)];
}

/** 표 번호가 1부터 빠짐없이 이어지는지(하위 번호는 주 번호 바로 뒤에 1부터) */
function numberingProblems(rows: Row[]): string[] {
  const problems: string[] = [];
  let prev: [number, number] = [0, 0];
  for (const r of rows) {
    const k = stepKey(r.step);
    const nextMain = k[0] === prev[0] + 1 && k[1] === 0;
    const nextSub = k[0] === prev[0] && k[1] === prev[1] + 1;
    if (!nextMain && !nextSub) problems.push(`${prev.join("-")} 다음이 ${r.step}이다`);
    prev = k;
  }
  return problems;
}

/** 표의 명령 칸에 적힌 CLI 명령 이름(`node src/cli.ts X`와 백틱 안의 낱말 하나) */
function rowCommands(rows: Row[]): string[] {
  const names = new Set<string>();
  for (const r of rows) {
    for (const m of r.command.matchAll(/node src\/cli\.ts ([a-z][a-z-]*)/g)) names.add(m[1]!);
    for (const m of r.command.matchAll(/`([a-z][a-z-]*)`/g)) names.add(m[1]!);
  }
  return [...names];
}

interface Heading {
  from: string;
  to: string;
  line: string;
}

/** "### N단계…" 또는 "### N단계~M단계…" 절 제목 */
function stepHeadings(skill: string): Heading[] {
  const out: Heading[] = [];
  for (const line of skill.split("\n")) {
    const m = /^### (\d+(?:-\d+)?)단계(?:~(\d+(?:-\d+)?)단계)?:/.exec(line);
    if (m) out.push({ from: m[1]!, to: m[2] ?? m[1]!, line });
  }
  return out;
}

const cmp = (a: string, b: string) => {
  const [x, y] = [stepKey(a), stepKey(b)];
  return x[0] - y[0] || x[1] - y[1];
};

/** 표와 본문 절 제목이 맞지 않는 곳 */
function headingProblems(skill: string, rows: Row[]): string[] {
  const problems: string[] = [];
  const steps = new Set(rows.map((r) => r.step));
  const heads = stepHeadings(skill);
  for (const h of heads) for (const s of [h.from, h.to]) if (!steps.has(s)) problems.push(`절 "${h.line}"의 ${s}단계가 표에 없다`);
  for (let i = 1; i < heads.length; i++) if (cmp(heads[i - 1]!.to, heads[i]!.from) >= 0) problems.push(`절 순서가 표와 다르다: "${heads[i - 1]!.line}" 뒤 "${heads[i]!.line}"`);
  // 주 번호 단계는 절 하나(범위 포함)에 든다. 하위 단계는 제 절이 있거나 본문에서 "N-M단계"로 다룬다
  for (const r of rows) {
    const k = stepKey(r.step);
    const own = heads.some((h) => h.from === r.step || h.to === r.step);
    if (k[1] === 0) {
      const covered = heads.some((h) => cmp(h.from, r.step) <= 0 && cmp(r.step, h.to) <= 0);
      if (!covered) problems.push(`${r.step}단계를 다루는 절이 없다`);
    } else if (!own && !skill.includes(`${r.step}단계`)) problems.push(`${r.step}단계를 본문이 다루지 않는다`);
  }
  return problems;
}

/** 본문의 "N단계"·"N-M단계"가 표에 없는 단계를 가리키는 곳(앞 단계가 실패해도 넘어갈 단계 등) */
function danglingStepRefs(skill: string, rows: Row[]): string[] {
  const steps = new Set(rows.map((r) => r.step));
  const out: string[] = [];
  for (const m of skill.matchAll(/(?<![\d.-])(\d+(?:-\d+)?)단계/g)) if (!steps.has(m[1]!)) out.push(`${m[1]}단계`);
  return [...new Set(out)];
}

describe("R1 4.1-1 브리프 스킬 문서", () => {
  const skill = fs.readFileSync(SKILL_FILE, "utf8");
  const rows = orderRows(skill);

  test("스킬 문서(설명 포함)에 지운 기능 낱말이 없다", () => {
    assert.match(skill, /^description: /m, "설명 줄을 함께 본다");
    assert.deepEqual(retiredWordHits(skill), []);
  });

  test("낱말 검사는 일부러 넣은 낱말을 잡고, '수요일'과 뉴스 흐름은 잡지 않는다", () => {
    const planted = `${skill}\n- 12-5단계: 영상 받기(\`video-fetch\`)\n`;
    assert.deepEqual(retiredWordHits(planted).map((h) => h.replace(/^\d+행 /, "").split(":")[0]), ["video"]);
    // B2가 다시 쓰는 이름과 '영상'은 잡지 않고, 옛 YouTube API 이름은 잡는다
    assert.deepEqual(retiredWordHits("12-6단계 영상: `video-pick`이 youtube-insight DB(`TIDWYN_YOUTUBE_DB`)를 읽는다"), []);
    assert.equal(retiredWordHits("YouTube Data API 키").length, 1);
    for (const [word, text] of [["Demand", "Demand flow"], ["수요", "수요 흐름"], ["새 제품", "새 제품 소개"], ["뜨는 저장소", "뜨는 저장소 목록"], ["커뮤니티", "커뮤니티 신호"], ["흐름 항목", "흐름 항목 정정"], ["builder", "BuilderItem"], ["product hunt", "ProductHunt"], ["repo snapshot", "repoSnapshot"], ["gemini", "GEMINI_API_KEY"]] as const) {
      assert.equal(retiredWordHits(text).length, 1, `${word}: ${text}`);
    }
    assert.deepEqual(retiredWordHits("매주 수요일 발표. 섹션 흐름 문단과 이슈의 흐름."), []);
  });

  test("실행 순서 표의 명령은 모두 CLI에 있는 명령이다", () => {
    const names = rowCommands(rows);
    assert.ok(names.length >= 25, `표에서 찾은 명령이 너무 적다: ${names.join(", ")}`);
    assert.deepEqual(names.filter((n) => !COMMAND_NAMES.includes(n)), [], "표에 있는데 CLI에 없는 명령");
    // 일부러 넣은 지운 명령은 잡는다
    const planted = rowCommands([...rows, { step: "12-5", command: "`node src/cli.ts video-fetch --run <실행 기록>`" }]);
    assert.deepEqual(planted.filter((n) => !COMMAND_NAMES.includes(n)), ["video-fetch"]);
  });

  test("표의 단계 번호가 빠짐없이 이어지고 본문 절 제목과 맞으며, 본문이 표에 없는 단계를 가리키지 않는다", () => {
    assert.ok(rows.length >= 19, `표 줄이 너무 적다: ${rows.length}`);
    assert.deepEqual(numberingProblems(rows), []);
    assert.deepEqual(headingProblems(skill, rows), []);
    assert.deepEqual(danglingStepRefs(skill, rows), []);
  });

  test("번호·절 검사는 일부러 어긋나게 한 문서를 잡는다", () => {
    // 하위 단계를 건너뛴 표
    assert.notDeepEqual(numberingProblems(rows.filter((r) => r.step !== "12-1")), []);
    // 지운 단계를 가리키는 "넘어간다"
    const dangling = `${skill}\n앞 명령이 실패해도 멈추지 않고 다음 명령과 18-1단계로 넘어간다.\n`;
    assert.deepEqual(danglingStepRefs(dangling, rows), ["18-1단계"]);
    // 표에 없는 단계의 절
    const extraHeading = skill.replace("### 13단계: 합치기", "### 12-9단계: 영상 고르기\n\n### 13단계: 합치기");
    assert.notDeepEqual(headingProblems(extraHeading, rows), []);
    // 다루는 절이 없는 주 단계
    const noHeading = skill.replace(/^### 14단계: .*$/m, "### 지난 날짜 이미지 채우기");
    assert.ok(headingProblems(noHeading, rows).includes("14단계를 다루는 절이 없다"));
  });
});

// ---- CLI(4.1-2) ----

const REMOVED_COMMANDS = ["video-fetch", "builder-write", "demand-flow", "demand-official"];

describe("R1 4.1-2 지운 명령과 남은 명령", () => {
  test("지운 명령 이름은 알 수 없는 명령과 같은 사용법 안내·종료 코드로 끝나고, 아무 파일도 쓰지 않는다", async () => {
    const repo = tempRepo();
    const unknown = makeCtx(repo);
    const unknownCode = await mainAsync(["no-such-cmd", "--run", "x.json"], unknown);
    assert.equal(unknownCode, 2);
    assert.match(unknown.text(), /^명령:/);
    const before = listFiles(repo);
    for (const name of REMOVED_COMMANDS) {
      assert.ok(!COMMAND_NAMES.includes(name), `${name}이(가) 명령 목록에 있다`);
      const ctx = makeCtx(repo);
      assert.equal(await mainAsync([name, "--run", "x.json"], ctx), unknownCode, name);
      assert.equal(ctx.text(), unknown.text(), `${name}의 안내가 알 수 없는 명령과 다르다`);
      const sync = makeCtx(repo);
      assert.equal(main([name], sync), unknownCode, name);
      assert.equal(sync.text(), unknown.text());
    }
    assert.deepEqual(listFiles(repo), before, "파일이 생기거나 없어졌다");
    assert.equal(gitIn(repo, "status", "--porcelain"), "");
  });

  test("남은 명령(feeds, validate, indicator-fetch, backup)은 명령 목록과 사용법 안내에 그대로 있다", () => {
    const ctx = makeCtx(tempDir());
    main(["no-such-cmd"], ctx);
    const usage = ctx.text();
    for (const name of ["feeds", "validate", "indicator-fetch", "backup"]) {
      assert.ok(COMMAND_NAMES.includes(name), name);
      assert.match(usage, new RegExp(`^\\s+${name} `, "m"), `사용법에 ${name}이(가) 없다`);
    }
    assert.deepEqual(retiredWordHits(usage), [], "사용법 안내에 지운 기능이 없다");
  });
});

// ---- start·summary 출력(4.1-3), 데이터 경로(4.2-5) ----

/** 사이트 데이터를 그대로 복사하고 공개 페이지 파일을 쓰는 가짜 빌더(publish.test.ts와 같은 방식). plant로 결과물에 파일을 더한다 */
function fakeBuilder(plant?: (outDir: string) => void): SiteBuilder {
  return ({ inputDir, outDir }) => {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    fs.cpSync(path.join(inputDir, "site-data"), path.join(outDir, "site-data"), { recursive: true });
    writeFakePublicFiles(outDir);
    fs.mkdirSync(path.join(outDir, "assets"));
    fs.writeFileSync(path.join(outDir, "assets", "app.js"), "console.log('tidwyn');\n");
    plant?.(outDir);
    return { ok: true };
  };
}

interface TestRun {
  repo: string;
  runFile: string;
  dataDir: string;
  start: string;
  outputs: string[];
}

/** 시험 모드로 start → 저장 → 백업 → 사이트(가짜 빌더) → 배포·push(건너뜀)까지 돌린다. summary는 부르는 쪽이 본다 */
async function testRun(env: NodeJS.ProcessEnv = {}, repo = tempRepo()): Promise<TestRun> {
  const s = makeCtx(repo, env);
  assert.equal(main(["start", "test"], s), 0, s.text());
  const runFile = /실행 기록: (.+)/.exec(s.text())![1]!;
  const dataDir = readRun(runFile).dataDir;
  const work = workFile(dataDir, "2026-10-27");
  fs.mkdirSync(path.dirname(work), { recursive: true });
  fs.writeFileSync(work, JSON.stringify(sampleBrief("2026-10-27")));
  const outputs: string[] = [];
  const step = async (argv: string[], extra: Partial<ReturnType<typeof makeCtx>> = {}) => {
    const ctx = { ...makeCtx(repo, env), ...extra };
    const code = await mainAsync(argv, ctx);
    outputs.push(ctx.output.join("\n"));
    return { code, text: ctx.output.join("\n") };
  };
  for (const argv of [["validate"], ["save"]]) {
    const r = await step([...argv, "--run", runFile, "--date", "2026-10-27"]);
    assert.equal(r.code, 0, r.text);
  }
  for (const cmd of ["backup", "site", "deploy", "push"]) {
    const r = await step([cmd, "--run", runFile], { buildSite: fakeBuilder() });
    assert.equal(r.code, 0, `${cmd}: ${r.text}`);
  }
  return { repo, runFile, dataDir, start: s.text(), outputs };
}

describe("R1 4.1-3 start와 summary의 출력", () => {
  test("start test와 summary 출력에 지운 기능 낱말이 없고, 키 줄은 ECOS·FRED만 보인다", async () => {
    const t = await testRun();
    assert.deepEqual(retiredWordHits(t.start), [], "start 출력");
    assert.match(t.start, /^- 키: ECOS 없음, FRED 없음$/m);
    const keyLines = t.start.split("\n").filter((l) => /키/.test(l));
    assert.deepEqual(keyLines, ["- 키: ECOS 없음, FRED 없음"], "키 줄은 ECOS·FRED 한 줄뿐이다");
    const ctx = makeCtx(t.repo);
    assert.equal(main(["summary", "--run", t.runFile], ctx), 0, ctx.text());
    const summary = ctx.text();
    assert.match(summary, /저장한 날짜: 2026-10-27/, "저장까지 돈 실행의 요약이다");
    assert.match(summary, /사이트 빌드: /);
    assert.deepEqual(retiredWordHits(summary), [], "summary 출력");
    for (const out of t.outputs) assert.deepEqual(retiredWordHits(out), [], `명령 출력: ${out.slice(0, 60)}`);
  });

  test("키가 있으면 ECOS·FRED 있음으로 보이고, 지운 기능의 키는 .env.local에 있어도 줄이 생기지 않는다", () => {
    const repo = tempRepo();
    const fake = (name: string) => `${name.split("_")[0]}-${"fake".repeat(3)}-0000`;
    fs.writeFileSync(path.join(repo, ".env.local"), [...["ECOS_API_KEY", "FRED_API_KEY"], ...RETIRED_KEY_NAMES].map((n) => `${n}=${fake(n)}`).join("\n") + "\n");
    const ctx = makeCtx(repo);
    assert.equal(main(["start", "test"], ctx), 0, ctx.text());
    assert.deepEqual(ctx.text().split("\n").filter((l) => /키/.test(l)), ["- 키: ECOS 있음, FRED 있음"]);
    assert.deepEqual(retiredWordHits(ctx.text()), []);
  });
});

/** 데이터 폴더 안 지운 기능의 경로(4.2-5) */
function retiredDataPaths(dataDir: string): string[] {
  return listFiles(dataDir).filter((f) => {
    const name = f.split("/").at(-1)!;
    return f === "demand.db" || /^demand\.db/.test(name) || /(^|\/)demand-copies(\/|$)/.test(f) || /(^|\/)builder-raw(\/|$)/.test(f) || /video|builder|demand|community|discover|repo[-_.]?snapshot|product/i.test(name);
  });
}

describe("R1 4.2-5 지운 기능의 데이터 경로", () => {
  test("start test부터 site까지 돌린 데이터 폴더에 demand.db, demand-copies/, builder-raw/, 영상·빌더·수요 작업 파일이 없다", async () => {
    const t = await testRun();
    const files = listFiles(t.dataDir);
    assert.ok(files.includes("tidwyn.db") && files.some((f) => f.startsWith("backup/")) && files.some((f) => f.startsWith("site/")) && files.some((f) => f.startsWith("work/")), "남은 명령이 모두 돌았다");
    assert.deepEqual(retiredDataPaths(t.dataDir), []);
    assert.deepEqual(listFiles(path.join(t.repo, ".test-data")).filter((f) => /demand|builder|video/i.test(f)), []);
  });

  test("경로 검사는 일부러 만든 지운 기능의 파일을 잡는다", () => {
    const dir = tempDir();
    for (const f of ["demand.db", "demand-copies/x.db", "builder-raw/a.html", "work/2026-10-27.videos.json", "work/2026-10-27.builder.json", "work/demand-flow.json", "work/2026-10-27.json"]) {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.writeFileSync(path.join(dir, f), "x");
    }
    assert.deepEqual(retiredDataPaths(dir), ["builder-raw", "builder-raw/a.html", "demand-copies", "demand-copies/x.db", "demand.db", "work/2026-10-27.builder.json", "work/2026-10-27.videos.json", "work/demand-flow.json"]);
  });
});

// ---- 비밀 값 검사의 지운 키(4.1-5) ----

/** 커밋 이메일이 공개 전 점검을 통과하는 임시 저장소(키 값 말고는 걸리는 것이 없게) */
function noreplyRepo(): string {
  const repo = tempRepo();
  gitIn(repo, "config", "user.email", REPO_NOREPLY);
  gitIn(repo, "commit", "-q", "--amend", "--reset-author", "--no-edit");
  return repo;
}

/** 지운 기능의 키마다 가짜 값(실행할 때 조립한다) */
function retiredFakeValues(): Map<string, string> {
  return new Map(RETIRED_KEY_NAMES.map((n, i) => [n, ["R1", "retired", n.toLowerCase().replaceAll("_", ""), String(1000 + i)].join("-")]));
}

describe("R1 4.1-5 지운 기능의 키 값도 비밀 값 검사가 찾는다", () => {
  const values = retiredFakeValues();
  const envLocal = [...values].map(([n, v]) => `${n}=${v}`).join("\n") + "\n";

  test("키 이름은 지운 기능의 키 여섯이다", () => {
    assert.deepEqual([...RETIRED_KEY_NAMES].sort(), ["ASSEMBLY_API_KEY", "DART_API_KEY", "DATA_GO_KR_KEY", "GEMINI_API_KEY", "PRODUCT_HUNT_TOKEN", "YOUTUBE_API_KEY"]);
  });

  for (const [name, value] of values) {
    test(`${name}: 그 값이 든 사이트 결과물은 site 검사에서 실패하고, 없으면 통과한다`, () => {
      const repo = tempRepo();
      fs.writeFileSync(path.join(repo, ".env.local"), envLocal);
      const s = makeCtx(repo);
      assert.equal(main(["start", "test"], s), 0, s.text());
      const runFile = /실행 기록: (.+)/.exec(s.text())![1]!;
      const leak = { ...makeCtx(repo), buildSite: fakeBuilder((out) => fs.writeFileSync(path.join(out, "assets", "leak.js"), `const k="${value}";`)) };
      assert.equal(main(["site", "--run", runFile], leak), 1, leak.text());
      assert.match(leak.text(), /assets\/leak\.js.*키 값이 들어 있음/);
      assert.ok(!leak.text().includes(value), "값은 출력하지 않는다");
      const clean = { ...makeCtx(repo), buildSite: fakeBuilder() };
      assert.equal(main(["site", "--run", runFile], clean), 0, clean.text());
    });

    test(`${name}: 그 값이 든 추적 파일이 있으면 precheck가 실패하고, 지우면 통과한다`, () => {
      const repo = noreplyRepo();
      fs.writeFileSync(path.join(repo, ".env.local"), envLocal);
      fs.writeFileSync(path.join(repo, "notes.md"), `설정: ${value}\n`);
      gitIn(repo, "add", "notes.md");
      const bad = makeCtx(repo);
      assert.equal(main(["precheck"], bad), 1, bad.text());
      assert.match(bad.text(), /걸림 1건/);
      assert.match(bad.text(), /notes\.md.*키 값이 들어 있음/);
      assert.match(bad.text(), /출처 API 키 값도 찾았다/);
      assert.ok(!bad.text().includes(value));
      gitIn(repo, "rm", "-q", "-f", "notes.md");
      const ok = makeCtx(repo);
      assert.equal(main(["precheck"], ok), 0, ok.text());
    });
  }

  test("환경 변수로만 준 지운 키 값도 찾는다(precheck)", () => {
    const repo = noreplyRepo();
    const value = values.get("GEMINI_API_KEY")!;
    fs.writeFileSync(path.join(repo, "notes.md"), `설정: ${value}\n`);
    gitIn(repo, "add", "notes.md");
    const ctx = makeCtx(repo, { GEMINI_API_KEY: value });
    assert.equal(main(["precheck"], ctx), 1, ctx.text());
    assert.match(ctx.text(), /걸림 1건[\s\S]*notes\.md.*키 값이 들어 있음/);
    const none = makeCtx(repo);
    assert.equal(main(["precheck"], none), 0, none.text());
  });

  test("정정 사유에 지운 키 값이 있으면 정정 검사가 거부한다", () => {
    const { repo, env } = correctionSetup();
    fs.writeFileSync(path.join(repo, ".env.local"), envLocal);
    const value = values.get("YOUTUBE_API_KEY")!;
    const r = correct(repo, env, { date: DATE, key: "한국-1", reason: `설정 ${value} 을 고쳤다.`, fields: { summary: "고친 요약이다." } });
    assert.equal(r.code, 1, r.text);
    assert.match(r.text, /키 값/);
    assert.ok(!r.text.includes(value));
  });
});

// ---- 정정(4.2-4) ----

const DATE = "2026-10-27";

function correctionSetup(): { repo: string; dbFile: string; env: NodeJS.ProcessEnv } {
  const repo = tempRepo();
  const dataDir = tempDir();
  const dbFile = path.join(dataDir, "tidwyn.db");
  const db = openDb(dbFile);
  recordFirstCollectionDate(db, DATE);
  const r = validateBrief(sampleBrief(DATE), DATE);
  assert.ok(r.ok);
  saveBrief(db, { brief: r.brief, collectedAt: `${DATE}T23:00:00+09:00`, late: false });
  db.close();
  return { repo, dbFile, env: { TIDWYN_DATA_DIR: dataDir } };
}

function correct(repo: string, env: NodeJS.ProcessEnv, input: unknown): { code: number; text: string } {
  const file = path.join(tempDir(), "fix.json");
  fs.writeFileSync(file, JSON.stringify(input));
  const ctx = makeCtx(repo, env);
  return { code: main(["correct", "--file", file], ctx), text: ctx.text() };
}

describe("R1 4.2-4 정정은 뉴스만 받는다", () => {
  for (const key of ["demand-1", "builder-1", "product-1", "repo-1"]) {
    test(`지운 종류의 키 ${key}를 가리키는 정정은 그 종류를 받지 않는다는 위반으로 거부되고 DB가 그대로다`, () => {
      const { repo, dbFile, env } = correctionSetup();
      const before = fs.readFileSync(dbFile);
      const r = correct(repo, env, { date: DATE, key, reason: "제목의 숫자를 바로잡았다.", fields: { title: "고친 제목" } });
      assert.equal(r.code, 1, r.text);
      assert.match(r.text, new RegExp(`"${key}"은\\(는\\) 뉴스 키가 아니다\\. 정정은 뉴스만 받는다`));
      assert.doesNotMatch(r.text, /뉴스가 없다/, "없는 뉴스가 아니라 받지 않는 종류로 거부한다");
      assert.deepEqual(fs.readFileSync(dbFile), before);
    });
  }

  test("뉴스 정정은 지금처럼 통과한다(주요 뉴스와 짧은 소식)", () => {
    const { repo, env } = correctionSetup();
    const top = correct(repo, env, { date: DATE, key: "한국-1", reason: "금리 인상 폭을 바로잡았다.", fields: { summary: "고친 요약이다." } });
    assert.equal(top.code, 0, top.text);
    const short = correct(repo, env, { date: DATE, key: "세계-s1", reason: "숫자를 바로잡았다.", fields: { summary: "고친 짧은 소식이다." } });
    assert.equal(short.code, 0, short.text);
  });
});
