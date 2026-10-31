// 사이트 빌드: node site/build.ts --data <폴더> --out <폴더>
// <data>에는 site-data/*.json과 search-records.json이 있다. 결과물(--out)을 비우고 다시 만든다(4.1-2):
//   화면(Vite) + site-data/ 복사 + 페이지별 정적 HTML·수집기용 파일 + 아이콘·공유 이미지 + 검색 색인(pagefind/) + 호스팅 설정(vercel.json).
// search-records.json과 그 밖의 파일은 결과물에 넣지 않는다(4.1-4).
import fs from "node:fs";
import path from "node:path";
import * as pagefind from "pagefind";
import { build } from "vite";
import { HOSTING_CONFIG_FILE, vercelConfig } from "./hosting.ts";
import { writeStaticSite } from "./staticSite.ts";
import { SITE_DIR, siteViteConfig } from "./viteConfig.ts";

export const SEARCH_RECORDS_FILE = "search-records.json";
export const SITE_DATA_DIR = "site-data";
export const PAGEFIND_DIR = "pagefind";

/** 아이콘과 공유 이미지 원본. 결과물 맨 위로 복사한다(`docs/design.md`) */
const BRAND_DIR = path.join(SITE_DIR, "brand");

/** Pagefind가 쓰는 파일 중 화면이 쓰지 않는 기본 검색 UI 파일. 결과물에서 뺀다 */
const PAGEFIND_UNUSED = /^pagefind-(ui|modular-ui|component-ui|highlight)\.(js|css)$/;

export interface SearchRecordInput {
  url: string;
  content: string;
  language: string;
  meta?: Record<string, string>;
  filters?: Record<string, string[]>;
}

export interface BuildResult {
  outDir: string;
  files: string[];
  bytes: number;
}

function fail(message: string): never {
  throw new Error(message);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/** 지워도 되는 결과물 폴더인지: 데이터 폴더·사이트 코드·저장소 맨 위·홈 폴더를 지우지 않는다 */
function checkOutDir(outDir: string, dataDir: string): void {
  const repoRoot = path.resolve(SITE_DIR, "..");
  const home = process.env.HOME ? path.resolve(process.env.HOME) : null;
  if (outDir === path.parse(outDir).root) fail(`결과물 폴더로 맨 위 폴더를 쓸 수 없다: ${outDir}`);
  if (isInside(dataDir, outDir)) fail("결과물 폴더가 데이터 폴더와 같거나 그것을 품고 있다");
  if (isInside(SITE_DIR, outDir) || outDir === repoRoot || (home && outDir === home)) fail(`결과물 폴더로 쓸 수 없는 곳이다: ${outDir}`);
  if (isInside(outDir, SITE_DIR)) fail("결과물 폴더를 site/ 안에 둘 수 없다");
}

export function listFilesRecursive(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true, withFileTypes: true }) as fs.Dirent[])
    .filter((d) => d.isFile())
    .map((d) => path.relative(dir, path.join(d.parentPath, d.name)).split(path.sep).join("/"))
    .sort();
}

function readRecords(file: string): SearchRecordInput[] {
  const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(raw)) fail(`${SEARCH_RECORDS_FILE}는 배열이어야 한다`);
  return raw.map((r: unknown, i) => {
    const rec = r as Partial<SearchRecordInput>;
    if (typeof rec?.url !== "string" || typeof rec.content !== "string" || typeof rec.language !== "string") fail(`검색 레코드 ${i}의 모양이 틀렸다`);
    return rec as SearchRecordInput;
  });
}

async function buildSearchIndex(records: SearchRecordInput[], outputPath: string): Promise<void> {
  const { index, errors } = await pagefind.createIndex({});
  if (!index) fail(`검색 색인을 만들지 못했다: ${errors.join("; ")}`);
  try {
    for (const rec of records) {
      const res = await index.addCustomRecord({ url: rec.url, content: rec.content, language: rec.language, meta: rec.meta, filters: rec.filters });
      if (res.errors.length) fail(`검색 레코드(${rec.url})를 넣지 못했다: ${res.errors.join("; ")}`);
    }
    // writeFiles는 응답 뒤에도 파일 쓰기가 끝나지 않을 때가 있어(close가 서비스를 끝내면 빈 파일이 남는다)
    // 파일 내용을 받아 직접 쓴다
    const got = await index.getFiles();
    if (got.errors.length) fail(`검색 색인을 만들지 못했다: ${got.errors.join("; ")}`);
    fs.mkdirSync(outputPath, { recursive: true });
    for (const file of got.files) {
      const rel = file.path.split(/[\\/]/).join("/");
      if (rel.split("/").some((part) => part === ".." || part === "") || PAGEFIND_UNUSED.test(rel)) continue;
      const dest = path.join(outputPath, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, file.content);
    }
  } finally {
    await pagefind.close();
  }
}

export async function buildSite(opts: { dataDir: string; outDir: string }): Promise<BuildResult> {
  const dataDir = path.resolve(opts.dataDir);
  const outDir = path.resolve(opts.outDir);
  const siteData = path.join(dataDir, SITE_DATA_DIR);
  const recordsFile = path.join(dataDir, SEARCH_RECORDS_FILE);
  if (!fs.statSync(siteData, { throwIfNoEntry: false })?.isDirectory()) fail(`${siteData} 폴더가 없다`);
  if (!fs.existsSync(recordsFile)) fail(`${recordsFile} 파일이 없다`);
  const records = readRecords(recordsFile);
  checkOutDir(outDir, dataDir);

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  await build(siteViteConfig(outDir));

  const dataOut = path.join(outDir, SITE_DATA_DIR);
  fs.mkdirSync(dataOut);
  for (const name of fs.readdirSync(siteData).sort()) {
    const src = path.join(siteData, name);
    if (name.endsWith(".json") && fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(dataOut, name));
  }

  writeStaticSite(outDir);
  for (const name of fs.readdirSync(BRAND_DIR).filter((n) => !n.startsWith("."))) fs.copyFileSync(path.join(BRAND_DIR, name), path.join(outDir, name));

  await buildSearchIndex(records, path.join(outDir, PAGEFIND_DIR));

  fs.writeFileSync(path.join(outDir, HOSTING_CONFIG_FILE), JSON.stringify(vercelConfig(), null, 2) + "\n");

  if (fs.existsSync(path.join(outDir, "public"))) fail("결과물 맨 위에 public/ 폴더가 생겼다");
  const files = listFilesRecursive(outDir);
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  return { outDir, files, bytes };
}

function parseCli(argv: string[]): { dataDir: string; outDir: string } {
  let dataDir: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--data") dataDir = argv[++i];
    else if (a === "--out") outDir = argv[++i];
    else fail(`모르는 인자: ${a}`);
  }
  if (!dataDir || !outDir) fail("사용법: node site/build.ts --data <폴더> --out <폴더>");
  return { dataDir, outDir };
}

if (import.meta.main) {
  try {
    const result = await buildSite(parseCli(process.argv.slice(2)));
    console.log(`사이트 빌드 완료: ${result.outDir} (파일 ${result.files.length}개, ${(result.bytes / 1024 / 1024).toFixed(2)}MB)`);
  } catch (err) {
    console.error(`사이트 빌드 실패: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
