import fs from "node:fs";
import path from "node:path";
import { contentFindings, nameKinds, type Finding } from "./precheck.ts";

// 결과물 검사(3단계 4.1-4). 빌드 뒤와 배포 전에 돌린다. 걸린 값은 출력하지 않는다(경로와 종류만).

/** 글자 모양 검사를 하는 텍스트 파일 확장자. 나머지(Pagefind 색인 조각, wasm, 글꼴, 이미지)는 건너뛴다 */
const TEXT_EXTENSIONS = new Set([".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json", ".txt", ".xml", ".svg", ".map", ".webmanifest"]);
/** 백업 파일 이름(backup.ts의 월별 JSON, issues.json, refs.json, schedules.json, meta.json). 사이트 데이터 이름은 이것과 겹치지 않는다 */
const BACKUP_NAME_RE = /^(?:\d{4}-\d{2}\.json|issues\.json|refs\.json|schedules\.json|meta\.json)$/;
/**
 * 실행 기록(`runs/<YYYYMMDD-HHMMSS>.json`), 작업 파일·후보 목록(`work/<날짜>.json`, `.candidates.*`, `.issues.md`, `.links.json`,
 * `.refs.md`, `.refs.json`, `.schedules.md`, `.schedules.json`, `merges.*`)
 */
const RUN_FILE_RES = [
  /^\d{8}-\d{6}\.json$/,
  /^\d{4}-\d{2}-\d{2}\.(?:json|candidates\.json|candidates\.md|issues\.md|links\.json|refs\.md|refs\.json|schedules\.md|schedules\.json)$/,
  /^merges\.(?:json|candidates\.md)$/,
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
export function checkOutput(outDir: string, home: string | null): OutputCheck {
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
    findings.push(...contentFindings(rel, rel, fs.readFileSync(abs), home, textScan));
  }
  return { findings, files: files.length, bytes };
}
