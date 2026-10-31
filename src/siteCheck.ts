import fs from "node:fs";
import path from "node:path";
import { BACKUP_NAME_RE, contentFindings, nameKinds, type Finding } from "./precheck.ts";
import { ROBOTS_DISALLOW, ROBOTS_FILE, SITEMAP_FILE, SITE_URL, pageFile } from "./publicSite.ts";

// 결과물 검사(3단계 4.1-4). 빌드 뒤와 배포 전에 돌린다. 걸린 값은 출력하지 않는다(경로와 종류만).

/** 글자 모양 검사를 하는 텍스트 파일 확장자. 나머지(Pagefind 색인 조각, wasm, 글꼴, 이미지)는 건너뛴다 */
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json", ".txt", ".xml", ".svg", ".map", ".webmanifest"]);
/**
 * 실행 기록(`runs/<YYYYMMDD-HHMMSS>.json`), 작업 파일·후보 목록(`work/<날짜>.json`, `.candidates.*`, `.issues.md`, `.links.json`,
 * `.refs.md`, `.refs.json`, `.schedules.md`, `.schedules.json`, `merges.*`, 6단계 지표 판단 `indicators.candidates-<번호>.md`, `indicators.judge-<번호>.json`,
 * 7단계 영상 후보 목록·상세·고르기 파일 `videos.candidates.json`, `videos.candidates.md`, `videos.details.md`, `videos.pick.json`, 8단계 확인 후보·메모 파일 `videos.check.json`, `videos.notes.json`, `videos.notes.tmp.json`)
 */
const RUN_FILE_RES = [
  /^\d{8}-\d{6}\.json$/,
  /^\d{4}-\d{2}-\d{2}\.(?:json|candidates\.json|candidates\.md|issues\.md|links\.json|refs\.md|refs\.json|schedules\.md|schedules\.json)$/,
  /^merges\.(?:json|candidates\.md)$/,
  /^indicators\.(?:candidates-\d+\.md|judge-\d+\.json)$/,
  /^videos\.(?:candidates\.json|candidates\.md|details\.md|pick\.json|check\.json|notes\.json|notes\.tmp\.json)$/,
];
/** 데이터 폴더의 작업 폴더 이름. 결과물 안에 이런 폴더가 있으면 데이터 폴더가 섞인 것이다 */
const DATA_DIRS = new Set(["runs", "work", "snapshots", "backup", "site-input"]);

export interface OutputCheck {
  findings: Finding[];
  files: number;
  bytes: number;
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel === "" ? e.name : `${rel}/${e.name}`;
    if (e.isDirectory()) walk(dir, r, out);
    else out.push(r);
  }
}

/** 결과물 폴더를 검사하고 파일 수와 전체 크기를 센다 */
export function checkOutput(outDir: string, home: string | null, secrets: readonly string[] = []): OutputCheck {
  const files: string[] = [];
  walk(outDir, "", files);
  files.sort();
  const findings: Finding[] = [];
  let bytes = 0;
  for (const rel of files) {
    const abs = path.join(outDir, rel);
    const st = fs.lstatSync(abs);
    bytes += st.size;
    for (const kind of nameKinds(rel)) findings.push({ where: rel, kind });
    const base = path.posix.basename(rel);
    if (BACKUP_NAME_RE.test(base)) findings.push({ where: rel, kind: "백업 파일 이름" });
    if (RUN_FILE_RES.some((re) => re.test(base)) || rel.split("/").slice(0, -1).some((d) => DATA_DIRS.has(d))) findings.push({ where: rel, kind: "실행 기록·작업 파일" });
    if (!st.isFile()) continue;
    const textScan = TEXT_EXTENSIONS.has(path.posix.extname(base).toLowerCase());
    findings.push(...contentFindings(rel, rel, fs.readFileSync(abs), home, textScan, secrets));
  }
  return { findings, files: files.length, bytes };
}

// ---- 공개 페이지 검사(9.5단계 4.8-1) ----

/** HTML에 들어가면 안 되는 영상 데이터(R7): 영상 파일 이름, 영상 필드, 영상·썸네일 주소 */
const VIDEO_IN_HTML_RES = [/\bvideos(?:-[\w-]+)?\.json\b/, /"(?:thumb|fetchedOn|videoSummary)"\s*:/, /youtube\.com\/watch|youtu\.be\/|ytimg\.com/];
/** 뉴스 출처 목록. 출처가 YouTube일 수 있어 영상 검사에서 뺀다 */
const SOURCE_LIST_RE = /<div class="src">[\s\S]*?<\/div>/g;

function tagAttr(html: string, tag: RegExp, attr: string): string | null {
  const found = html.match(tag)?.[0];
  return found?.match(new RegExp(`\\s${attr}="([^"]*)"`))?.[1] ?? null;
}

export const titleText = (html: string) => html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const descriptionText = (html: string) => tagAttr(html, /<meta [^>]*name="description"[^>]*>/, "content") ?? "";
const canonicalUrl = (html: string) => tagAttr(html, /<link [^>]*rel="canonical"[^>]*>/, "href");
const isNoindex = (html: string) => /<meta [^>]*name="robots"[^>]*content="[^"]*noindex/.test(html);

/** 사이트맵(나뉘어 있으면 조각까지)의 주소들. 조각 파일이 없으면 지적에 넣는다 */
function sitemapUrls(outDir: string, findings: Finding[]): string[] {
  const read = (rel: string) => fs.readFileSync(path.join(outDir, rel), "utf8");
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
  if (!fs.existsSync(path.join(outDir, SITEMAP_FILE))) {
    findings.push({ where: SITEMAP_FILE, kind: "사이트맵 없음" });
    return [];
  }
  const root = read(SITEMAP_FILE);
  if (!root.includes("<sitemapindex")) return locs(root);
  return locs(root).flatMap((url) => {
    const rel = url.startsWith(`${SITE_URL}/`) ? url.slice(SITE_URL.length + 1) : "";
    if (rel !== "" && fs.existsSync(path.join(outDir, rel))) return locs(read(rel));
    findings.push({ where: SITEMAP_FILE, kind: "사이트맵 주소에 파일이 없음" });
    return [];
  });
}

function checkRobots(outDir: string, findings: Finding[]): void {
  const file = path.join(outDir, ROBOTS_FILE);
  if (!fs.existsSync(file)) {
    findings.push({ where: ROBOTS_FILE, kind: "robots.txt 없음" });
    return;
  }
  const lines = fs.readFileSync(file, "utf8").split("\n").map((l) => l.trim());
  const blocked = lines.filter((l) => /^disallow\s*:/i.test(l)).map((l) => l.replace(/^disallow\s*:\s*/i, ""));
  if (blocked.some((p) => p !== "" && p !== ROBOTS_DISALLOW)) findings.push({ where: ROBOTS_FILE, kind: "robots.txt가 수집을 막음" });
  if (!lines.some((l) => /^sitemap\s*:/i.test(l))) findings.push({ where: ROBOTS_FILE, kind: "robots.txt에 사이트맵 줄 없음" });
}

/** 색인 페이지와 수집 파일을 본다. 파일 하나만 보는 checkOutput과 달리 완성된 결과물이어야 한다 */
export function checkPublicPages(outDir: string): Finding[] {
  const findings: Finding[] = [];
  checkRobots(outDir, findings);
  const files: string[] = [];
  walk(outDir, "", files);
  const fileSet = new Set(files);
  const urlsOf = new Map<string, string[]>();
  for (const url of sitemapUrls(outDir, findings)) {
    const pathname = url.startsWith(SITE_URL) ? url.slice(SITE_URL.length) : "";
    const rel = pathname === "" ? "" : pageFile(pathname);
    if (fileSet.has(rel)) urlsOf.set(rel, [...(urlsOf.get(rel) ?? []), url]);
    else findings.push({ where: SITEMAP_FILE, kind: "사이트맵 주소에 파일이 없음" });
  }
  if (!urlsOf.has("index.html")) findings.push({ where: SITEMAP_FILE, kind: "사이트맵에 첫 화면 없음" });
  for (const rel of files.filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(outDir, rel), "utf8");
    const withoutSources = html.replace(SOURCE_LIST_RE, "");
    if (VIDEO_IN_HTML_RES.some((re) => re.test(withoutSources))) findings.push({ where: rel, kind: "HTML에 영상 데이터" });
    const urls = urlsOf.get(rel);
    if (urls === undefined) {
      // 사이트맵 밖의 HTML은 수집되지 않거나(noindex) 남는 주소를 가리켜야 한다
      if (!isNoindex(html) && canonicalUrl(html) === null) findings.push({ where: rel, kind: "사이트맵 밖 페이지에 noindex나 canonical이 없음" });
      continue;
    }
    if (titleText(html).trim() === "") findings.push({ where: rel, kind: "제목 없음" });
    if (descriptionText(html).trim() === "") findings.push({ where: rel, kind: "설명 없음" });
    if (urls.some((url) => canonicalUrl(html) !== url)) findings.push({ where: rel, kind: "canonical이 주소와 다름" });
    if (isNoindex(html)) findings.push({ where: rel, kind: "색인 페이지에 noindex" });
  }
  return findings;
}

/** 배포 전 검사: 파일 검사와 공개 페이지 검사 */
export function checkBuiltSite(outDir: string, home: string | null, secrets: readonly string[] = []): OutputCheck {
  const check = checkOutput(outDir, home, secrets);
  return { ...check, findings: [...check.findings, ...checkPublicPages(outDir)] };
}
