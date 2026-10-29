// 결과물 크기 재기: node site/size.ts <결과물 폴더>
// 파일 수와 전체 크기(4.1-3), 첫 화면 전송 크기(4.3-7: 가장 최근 날짜의 펼치지 않은 목록에 필요한
// HTML·JS·CSS·사이트 데이터의 gzip 크기 합, 글꼴·이미지 제외)를 잰다.
// 4단계(4.6-2): 새 화면이 처음 받는 사이트 데이터의 gzip 크기도 잰다(각각 FIRST_SCREEN_BUDGET 이하):
// 대상 목록의 거르기마다 0쪽, 뉴스가 가장 많은 대상의 페이지(그 상세 묶음), 용어 사전 첫 화면(색인과 처음 받는 묶음).
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { ENTITY_FILTERS, entityChunkOf, type EntityChunk, type TermIndex } from "../src/siteTypes.ts";
import { listFilesRecursive } from "./build.ts";
import { initialTermGroups } from "./src/lib/terms.ts";

export const FIRST_SCREEN_BUDGET = 300 * 1024;

export interface OutputSize {
  files: number;
  bytes: number;
  firstScreen: { files: { path: string; gzip: number }[]; gzip: number };
}

function gzipSize(file: string): number {
  return gzipSync(fs.readFileSync(file), { level: 9 }).length;
}

/** 화면 틀이 처음에 불러오는 JS·CSS(모듈 미리 불러오기 포함) */
export function entryAssets(indexHtml: string): string[] {
  const refs = new Set<string>();
  for (const m of indexHtml.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)) refs.add(m[1]!);
  return [...refs].sort();
}

export function measureOutput(outDir: string): OutputSize {
  const all = listFilesRecursive(outDir);
  const bytes = all.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
  const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
  const first = ["index.html", ...entryAssets(html), "site-data/dates.json"];
  const dates = JSON.parse(fs.readFileSync(path.join(outDir, "site-data/dates.json"), "utf8")) as { latestDate: string | null };
  if (dates.latestDate) first.push(`site-data/list-${dates.latestDate.slice(0, 7)}.json`);
  const files = first.map((p) => ({ path: p, gzip: gzipSize(path.join(outDir, p)) }));
  return { files: all.length, bytes, firstScreen: { files, gzip: files.reduce((n, f) => n + f.gzip, 0) } };
}

export interface ScreenData {
  name: string;
  files: { path: string; gzip: number }[];
  gzip: number;
}

function screen(outDir: string, name: string, paths: string[]): ScreenData {
  const files = paths.map((p) => ({ path: p, gzip: gzipSize(path.join(outDir, p)) }));
  return { name, files, gzip: files.reduce((n, f) => n + f.gzip, 0) };
}

/** 4단계 새 화면이 처음 받는 사이트 데이터(화면 틀·JS는 첫 화면과 같아 빼고 잰다) */
export function measureScreens(outDir: string): ScreenData[] {
  const data = path.join(outDir, "site-data");
  const read = <T>(name: string) => JSON.parse(fs.readFileSync(path.join(data, name), "utf8")) as T;
  const out: ScreenData[] = [];
  for (const f of ENTITY_FILTERS) out.push(screen(outDir, `대상 목록(${f})`, [`site-data/entity-list-${f}-0.json`]));
  let most: { id: number; count: number } | null = null;
  for (const name of fs.readdirSync(data)) {
    if (!/^entity-\d+\.json$/.test(name)) continue;
    for (const e of Object.values(read<EntityChunk>(name).entities)) if (!most || e.count > most.count) most = { id: e.id, count: e.count };
  }
  if (most) out.push(screen(outDir, `뉴스가 가장 많은 대상(${most.id}, 뉴스 ${most.count}건)`, [`site-data/entity-${entityChunkOf(most.id)}.json`]));
  const index = read<TermIndex>("term-index.json");
  out.push(screen(outDir, "용어 사전", ["site-data/term-index.json", ...initialTermGroups(index).map((g) => `site-data/term-group-${g}.json`)]));
  return out;
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("사용법: node site/size.ts <결과물 폴더>");
    process.exit(1);
  }
  const s = measureOutput(dir);
  console.log(`파일 ${s.files}개, 전체 ${(s.bytes / 1024).toFixed(1)}KB`);
  for (const f of s.firstScreen.files) console.log(`  첫 화면 ${f.path}: gzip ${(f.gzip / 1024).toFixed(1)}KB`);
  console.log(`첫 화면 합계: gzip ${(s.firstScreen.gzip / 1024).toFixed(1)}KB (한도 ${FIRST_SCREEN_BUDGET / 1024}KB)`);
  if (fs.existsSync(path.join(dir, "site-data", "term-index.json"))) {
    for (const sc of measureScreens(dir)) {
      console.log(`${sc.name}: gzip ${(sc.gzip / 1024).toFixed(1)}KB (한도 ${FIRST_SCREEN_BUDGET / 1024}KB)${sc.gzip > FIRST_SCREEN_BUDGET ? " 넘음" : ""}`);
      for (const f of sc.files) console.log(`  ${f.path}: gzip ${(f.gzip / 1024).toFixed(1)}KB`);
    }
  }
}
