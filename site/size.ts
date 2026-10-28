// 결과물 크기 재기: node site/size.ts <결과물 폴더>
// 파일 수와 전체 크기(4.1-3), 첫 화면 전송 크기(4.3-7: 가장 최근 날짜의 펼치지 않은 목록에 필요한
// HTML·JS·CSS·사이트 데이터의 gzip 크기 합, 글꼴·이미지 제외)를 잰다.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { listFilesRecursive } from "./build.ts";

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
}
