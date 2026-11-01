// 결과물 크기 재기: node site/size.ts <결과물 폴더> [일정 화면을 여는 날 YYYY-MM-DD]
// 파일 수와 전체 크기(4.1-3), 첫 화면 전송 크기(4.3-7: 가장 최근 날짜의 펼치지 않은 목록에 필요한
// HTML·JS·CSS·사이트 데이터의 gzip 크기 합, 글꼴·이미지 제외)를 잰다.
// 4단계(4.6-2): 새 화면이 처음 받는 사이트 데이터의 gzip 크기도 잰다(각각 FIRST_SCREEN_BUDGET 이하):
// 대상 목록의 거르기마다 0쪽, 뉴스가 가장 많은 대상의 페이지(그 상세 묶음), 용어 사전 첫 화면(색인과 처음 받는 묶음).
// 5단계(4.6-2): 일정 화면이 처음 받는 사이트 데이터(색인, 목록의 다가오는 일정 첫 묶음, 달력의 이번 달)도 잰다.
// 브리프 첫 화면의 '이번 주 일정'은 달 목록 파일(list-*.json)에 들어 있어 첫 화면 크기에 이미 들어간다.
// 6단계(4.6-2): 지표 페이지(지표 목록)와 지표 하나의 페이지(지표 목록 + 그 지표의 5년 값, 가장 큰 지표로)가 처음 받는 사이트 데이터도 잰다.
// 브리프 위 상자의 지표 칩도 달 목록 파일에 들어 있어 첫 화면 크기에 들어간다.
// 9.8단계(4.6-5): 빌더 탭이 처음 받는 파일(가장 큰 달 파일)과 달별 파일 수도 잰다. 달 목록에는 수와 상태만 들어 첫 화면에 포함된다.
// 9.6단계(4.3-2): 영상 탭(가장 큰 날짜 파일), 이슈 페이지 본문(issue-list와 관련 영상이 가장 많은 이슈의 묶음), 관련 영상이 처음 받는 파일도 잰다.
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { BUILDER_ITEMS_FILE_RE, ENTITY_FILTERS, VIDEO_DAY_FILE_RE, VIDEO_SECTIONS_FILE_RE, entityChunkOf, siteFiles, type EntityChunk, type IssueChunk, type IssueVideoRef, type ScheduleIndex, type TermIndex } from "../src/siteTypes.ts";
import { listFilesRecursive } from "./build.ts";
import { firstLoadMonths } from "./src/lib/schedules.ts";
import { initialTermGroups } from "./src/lib/terms.ts";
import { ISSUE_VIDEO_FIRST, refDates } from "./src/lib/videos.ts";

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

/** 5단계: 일정 화면을 today(KST 날짜)에 처음 열 때 받는 사이트 데이터(화면 틀·JS는 첫 화면과 같아 빼고 잰다) */
export function measureScheduleScreen(outDir: string, today: string): ScreenData {
  const index = JSON.parse(fs.readFileSync(path.join(outDir, "site-data", siteFiles.scheduleIndex), "utf8")) as ScheduleIndex;
  return screen(outDir, `일정 화면(${today})`, [`site-data/${siteFiles.scheduleIndex}`, ...firstLoadMonths(index, today).map((m) => `site-data/${siteFiles.scheduleMonth(m)}`)]);
}

/** 6단계: 지표 페이지와 지표 하나의 페이지(5년 값 파일이 가장 큰 지표)가 처음 받는 사이트 데이터 */
export function measureIndicatorScreens(outDir: string): ScreenData[] {
  const data = path.join(outDir, "site-data");
  const list = `site-data/${siteFiles.indicatorList}`;
  const series = fs
    .readdirSync(data)
    .filter((n) => /^indicator-[a-z0-9]+\.json$/.test(n) && n !== siteFiles.indicatorList)
    .map((n) => ({ n, size: fs.statSync(path.join(data, n)).size }))
    .sort((a, b) => b.size - a.size || a.n.localeCompare(b.n));
  const out = [screen(outDir, "지표 페이지", [list])];
  const biggest = series[0];
  if (biggest) out.push(screen(outDir, `지표 하나의 페이지(${biggest.n.slice("indicator-".length, -".json".length)})`, [list, `site-data/${biggest.n}`]));
  return out;
}

/** 9.6단계: 영상을 나눈 화면이 처음 받는 사이트 데이터와 날짜별 영상 파일 수. 영상이 없으면 screens가 비어 있다 */
export function measureVideoScreens(outDir: string): { screens: ScreenData[]; files: number } {
  const data = path.join(outDir, "site-data");
  const names = fs.readdirSync(data);
  const dayFiles = names.filter((n) => VIDEO_DAY_FILE_RE.test(n));
  if (dayFiles.length === 0) return { screens: [], files: 0 };
  const biggestOf = (files: string[]) => files.map((n) => ({ n, size: fs.statSync(path.join(data, n)).size })).sort((a, b) => b.size - a.size || a.n.localeCompare(b.n))[0];
  const biggest = biggestOf(dayFiles)!;
  const screens = [screen(outDir, "영상 탭", [`site-data/${biggest.n}`])];
  let pile: { chunk: string; id: string; refs: IssueVideoRef[] } | null = null;
  for (const name of names.filter((n) => /^issue-\d+\.json$/.test(n))) {
    const chunk = JSON.parse(fs.readFileSync(path.join(data, name), "utf8")) as IssueChunk;
    for (const [id, issue] of Object.entries(chunk.issues)) {
      const refs = issue.videoRefs ?? [];
      if (refs.length > (pile?.refs.length ?? 0)) pile = { chunk: name, id, refs };
    }
  }
  if (pile) {
    screens.push(screen(outDir, `이슈 페이지 본문(이슈 ${pile.id}, 관련 영상 ${pile.refs.length}개)`, [`site-data/${siteFiles.issueList}`, `site-data/${pile.chunk}`]));
    screens.push(screen(outDir, "관련 영상", refDates(pile.refs.slice(0, ISSUE_VIDEO_FIRST)).map((d) => `site-data/${siteFiles.videoDay(d)}`)));
  }
  // 9.7단계 영상별 페이지는 그 날짜의 영상 파일과 구간 파일을 받는다(C12)
  const sectionFiles = names.filter((n) => VIDEO_SECTIONS_FILE_RE.test(n));
  const pageFile = biggestOf(sectionFiles);
  if (pageFile) screens.push(screen(outDir, "영상 페이지", [`site-data/${pageFile.n.replace("video-sections-", "videos-")}`, `site-data/${pageFile.n}`]));
  return { screens, files: dayFiles.length + sectionFiles.length };
}

/** 9.8단계: 빌더 탭이 처음 받는 사이트 데이터(가장 큰 달 파일)와 빌더 파일 수. 항목이 없으면 screens가 비어 있다 */
export function measureBuilderScreens(outDir: string): { screens: ScreenData[]; files: number } {
  const data = path.join(outDir, "site-data");
  const names = fs.readdirSync(data).filter((n) => BUILDER_ITEMS_FILE_RE.test(n));
  const biggest = names.map((n) => ({ n, size: fs.statSync(path.join(data, n)).size })).sort((a, b) => b.size - a.size || a.n.localeCompare(b.n))[0];
  return { screens: biggest ? [screen(outDir, "빌더 탭", [`site-data/${biggest.n}`])] : [], files: names.length };
}

function printScreen(sc: ScreenData): void {
  console.log(`${sc.name}: gzip ${(sc.gzip / 1024).toFixed(1)}KB (한도 ${FIRST_SCREEN_BUDGET / 1024}KB)${sc.gzip > FIRST_SCREEN_BUDGET ? " 넘음" : ""}`);
  for (const f of sc.files) console.log(`  ${f.path}: gzip ${(f.gzip / 1024).toFixed(1)}KB`);
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
      printScreen(sc);
    }
  }
  if (fs.existsSync(path.join(dir, "site-data", siteFiles.scheduleIndex))) {
    // 일정 화면은 가장 최근 날짜의 다음 날(그 날짜 브리프를 처음 보는 날)에 연다고 보고 잰다
    const dates = JSON.parse(fs.readFileSync(path.join(dir, "site-data/dates.json"), "utf8")) as { latestDate: string | null };
    const today = process.argv[3] ?? (dates.latestDate ? new Date(Date.parse(`${dates.latestDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
    const sc = measureScheduleScreen(dir, today);
    printScreen(sc);
  }
  const videoScreens = measureVideoScreens(dir);
  if (videoScreens.files > 0) console.log(`날짜별 영상 파일: ${videoScreens.files}개`);
  for (const sc of videoScreens.screens) {
    printScreen(sc);
  }
  const builderScreens = measureBuilderScreens(dir);
  if (builderScreens.files > 0) console.log(`달별 빌더 파일: ${builderScreens.files}개`);
  for (const sc of builderScreens.screens) {
    printScreen(sc);
  }
  if (fs.existsSync(path.join(dir, "site-data", siteFiles.indicatorList))) {
    for (const sc of measureIndicatorScreens(dir)) {
      printScreen(sc);
    }
  }
}
