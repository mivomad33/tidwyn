// 7단계: 지어낸 추천 영상의 사이트 데이터(로컬 화면 확인·/browser-check·E2E·크기 측정용). 제목·채널·추천 이유는 모두 지어낸 것이고
// YouTube에서 옮겨 오지 않는다. fixtures.ts가 부른다. 받은 날은 끝 날짜(end)를 기준으로 만든다: 끝 날짜까지 30일 안(0~29일 전)의
// 브리프 날짜와, 있으면 꼭 30일 전 날짜(끝 날짜를 오늘로 보면 화면이 숨기는 영상)에 영상을 붙인다(받은 날 = 그 브리프 날짜).
// 썸네일은 외부를 부르지 않는다: 묶음마다 색이 다른 작은 SVG(data: 주소)이고, 한 영상은 결과물에 없는 로컬 주소(불러오기 실패)다.
// 보통은 날짜마다 묶음을 섞는다(한국 3·미국 2·AI 4, 미국 0개, 한국만, 영상 없음, AI 영어 0개를 돌아가며). full이면 날마다 최대 16개
// (한국 5·미국 5·AI 한국어 3·AI 영어 3), 추천 이유 150자, 관련 이슈 2개다(4.6-3 크기 측정).
import { VIDEO_BUNDLES, type IssueVideo, type SiteVideo, type VideoBundle } from "../../src/siteTypes.ts";

export interface VideoFixtureInfo {
  /** 영상이 있는 브리프 날짜(최근 순, 30일 지난 날짜 포함) */
  dates: string[];
  /** 30일 안의 날짜인데 영상이 없는 날짜 */
  noVideoDate: string | null;
  /** 한 묶음(한국)만 있는 날짜 */
  oneBundleDate: string | null;
  /** 미국 묶음이 0개인 날짜 */
  zeroBundleDate: string | null;
  /** 썸네일을 불러오지 못하는 영상 */
  broken: { date: string; id: string } | null;
  /** 끝 날짜에 30일이 지나 화면이 숨기는 영상이 붙은 날짜(그런 브리프 날짜가 있을 때만) */
  stale: string | null;
  /** 흡수된 이슈에 붙은 영상과 그 이슈, 남는 이슈 */
  absorbed: { id: string; issue: number; into: number } | null;
  /** 영상이 6개 이상인 이슈 */
  many: number | null;
  /** 영상이 1개인 이슈 */
  one: number | null;
}

export interface VideoFixtures {
  byDate: Map<string, SiteVideo[]>;
  byIssue: Map<number, IssueVideo[]>;
  info: VideoFixtureInfo;
}

/** 묶음마다 하루 고르는 수(보통 데이터의 돌림 순서). [한국, 미국, AI 한국어, AI 영어] */
const PATTERNS: [number, number, number, number][] = [
  [3, 2, 2, 2],
  [2, 0, 1, 1],
  [2, 0, 0, 0],
  [0, 0, 0, 0],
  [1, 1, 1, 0],
];
const FULL: [number, number, number, number] = [5, 5, 3, 3];

const KO_TOPICS = ["가짜시 재난 대응", "가짜국 세금 개편", "가상 반도체 공급망", "모의 우주 발사체", "허구 도시의 물가", "가짜 기후 협약", "예시 백신 개발사", "가짜 왕조의 역사"];
const EN_TOPICS = ["fictional chip export rules", "a made-up central bank", "an imaginary fusion lab", "a pretend shipping crisis", "a sample rover mission", "an invented energy grid"];
const AI_KO = ["가짜 AI 에이전트가 회사 업무를 맡으면", "예시 언어 모델의 비용 구조", "가상 AI 연구소의 새 모델 살펴보기"];
const AI_EN = ["How a fictional LLM cut inference costs", "Inside an imaginary AI agent benchmark", "What a made-up model release means"];
const CHANNEL: Record<VideoBundle, string[]> = {
  kr: ["예시 탐사 채널", "가짜 다큐 연구소", "모의 경제 해설"],
  us: ["Example Channel", "Sample Science Hour", "Pretend Policy Lab"],
  "ai-ko": ["가상 AI 이야기", "예시 기술 채널"],
  "ai-en": ["Example Lab", "Fictional AI Weekly"],
};
const REASONS = [
  "공개 기록을 시간 순서로 정리해 사건의 흐름과 빈틈을 짚는다.",
  "여러 사례를 나란히 놓고 비용과 실패 원인을 구체적으로 비교한다.",
  "배경 자료와 현장 취재로 숫자 뒤의 사정을 쉽게 풀어 준다.",
  "용어부터 차근차근 설명해 처음 보는 사람도 따라가기 쉽다.",
];
/** full의 추천 이유 길이(4.3-2의 상한) */
const REASON_MAX = 150;
const THUMB_COLOR: Record<VideoBundle, string> = { kr: "#8a9bb0", us: "#a08f7a", "ai-ko": "#7aa08c", "ai-en": "#9c86a8" };
/** 결과물에 없는 로컬 주소(썸네일 불러오기 실패). assets/ 아래는 대체 경로가 없어 404다 */
export const BROKEN_THUMB = "/assets/fixture-missing-thumb.jpg";

function thumbOf(bundle: VideoBundle): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 9"><rect width="16" height="9" fill="${THUMB_COLOR[bundle]}"/></svg>`)}`;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

const SUMMARY_MAX = 350;
const SUMMARY_WORDS = "가상 탐사 궤도 예시 기록 실험 표본 지도 항구 농장 공장 시장 금리 환율 수출 물가 고용 임금 주택 전력 배터리 반도체 위성 망원경 화석 빙하 해류 태풍 지진 산불 도시 철도 교량 항만 도서관 박물관 병원 학교 연구진 기자 교수 기술자 주민 상인 농부 선원 조종사 설계 비용 효과 원인 결과 근거 사례 통계 추세 변화 위험 대안 장점 한계 배경 역사 전망 조건 절차 규칙 제도 예산 계획 시험 측정 분석 비교 검증".split(" ");
const SUMMARY_ENDS = ["을 살핀다", "의 과정을 짚는다", "을 숫자로 비교한다", "의 이유를 설명한다", "을 사례로 보여 준다", "의 한계를 따져 본다"];

/** 영상마다 다른 지어낸 요약. 반복으로 늘리면 gzip이 없애 크기 측정이 거짓으로 통과한다(8단계 4.6-4) */
function fixtureSummary(serial: number, length: number): string {
  let x = (serial * 2654435761) >>> 0;
  const next = (n: number) => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return (x >>> 8) % n;
  };
  let out = "";
  while ([...out].length < length) out += `${SUMMARY_WORDS[next(SUMMARY_WORDS.length)]} ${SUMMARY_WORDS[next(SUMMARY_WORDS.length)]} ${SUMMARY_WORDS[next(SUMMARY_WORDS.length)]}${SUMMARY_ENDS[next(SUMMARY_ENDS.length)]}. `;
  const body = [...out].slice(0, length - 1);
  if (body.at(-1) === " ") body[length - 2] = "다";
  return `${body.join("")}.`;
}

export function fixtureVideos(opts: { end: string; dates: string[]; issues: number[]; merged: { id: number; into: number }; full?: boolean }): VideoFixtures {
  const byDate = new Map<string, SiteVideo[]>();
  const links: { video: SiteVideo; date: string; issues: number[] }[] = [];
  const info: VideoFixtureInfo = { dates: [], noVideoDate: null, oneBundleDate: null, zeroBundleDate: null, broken: null, stale: null, absorbed: null, many: null, one: null };
  const recent = [...opts.dates].filter((d) => d <= opts.end && daysBetween(d, opts.end) <= 30).sort().reverse();
  let serial = 0;
  for (const [k, date] of recent.entries()) {
    const age = daysBetween(date, opts.end);
    const counts = opts.full ? FULL : PATTERNS[k % PATTERNS.length]!;
    if (!opts.full && age < 30) {
      if (counts.every((c) => c === 0)) info.noVideoDate ??= date;
      if (counts[0] > 0 && counts.slice(1).every((c) => c === 0)) info.oneBundleDate ??= date;
      if (counts[1] === 0 && counts.some((c) => c > 0)) info.zeroBundleDate ??= date;
    }
    const day: SiteVideo[] = [];
    for (const [b, bundle] of VIDEO_BUNDLES.entries()) {
      for (let n = 0; n < counts[b]!; n++) {
        serial++;
        const topic = bundle === "kr" ? KO_TOPICS[serial % KO_TOPICS.length]! : bundle === "us" ? EN_TOPICS[serial % EN_TOPICS.length]! : bundle === "ai-ko" ? AI_KO[serial % AI_KO.length]! : AI_EN[serial % AI_EN.length]!;
        const title = bundle === "kr" ? `[예시] ${topic}, 기록으로 다시 보기 ${serial}` : bundle === "us" ? `Example: why ${topic} matters ${serial}` : `${topic} ${serial}`;
        const reasonBase = REASONS[serial % REASONS.length]!;
        const reason = opts.full ? (reasonBase.repeat(Math.ceil(REASON_MAX / reasonBase.length))).slice(0, REASON_MAX) : reasonBase;
        const video: SiteVideo = {
          id: `Fx${serial.toString(36).padStart(9, "0")}`,
          bundle,
          // 첫 영상은 두 줄 넘게 감기는 긴 제목
          title: serial === 1 ? `${title} — 예시 기록과 지어낸 인터뷰로 길게 짚어 보는 가짜 다큐멘터리 전편` : title,
          channel: CHANNEL[bundle][serial % CHANNEL[bundle].length]!,
          // 4분~1시간 30분 사이, 셋에 하나는 한 시간이 넘는다
          seconds: serial % 3 === 0 ? 3600 + ((serial * 377) % 1800) : 240 + ((serial * 613) % 3000),
          thumb: thumbOf(bundle),
          reason,
          fetchedOn: date,
        };
        // 요약: full은 모두 350자, 보통은 둘에 하나만 있고 둘째 영상은 긴 요약이다
        if (opts.full) video.videoSummary = fixtureSummary(serial, SUMMARY_MAX);
        else if (serial % 2 === 0) video.videoSummary = fixtureSummary(serial, serial === 2 ? SUMMARY_MAX : 180);
        if (!opts.full && k === 0 && bundle === "kr" && n === 1) {
          video.thumb = BROKEN_THUMB;
          info.broken = { date, id: video.id };
        }
        day.push(video);
        // 관련 이슈: full은 둘, 보통은 셋에 하나는 없음·하나·둘
        const pickIssue = (i: number) => opts.issues[(serial * 7 + i * 3) % opts.issues.length]!;
        const issues = opts.full ? [pickIssue(0), pickIssue(1)] : serial % 3 === 0 ? [] : serial % 3 === 1 ? [pickIssue(0)] : [pickIssue(0), pickIssue(1)];
        links.push({ video, date, issues: [...new Set(issues)] });
      }
    }
    if (day.length) {
      byDate.set(date, day);
      info.dates.push(date);
      if (age >= 30) info.stale ??= date;
    }
  }

  // 보통 데이터: 가장 최근 날짜의 영상은 모두 이슈 2에 붙여 영상이 6개 이상인 이슈를 만들고, 그 날짜 첫 영상은 흡수된 이슈에도 붙인다.
  // 영상이 하나뿐인 이슈도 하나 둔다(다른 영상 연결에서 뺀다)
  if (!opts.full && links.length) {
    const many = opts.issues.includes(2) ? 2 : opts.issues[0]!;
    const one = opts.issues.find((i) => i !== many && i !== opts.merged.into) ?? null;
    for (const l of links) {
      if (one !== null) l.issues = l.issues.filter((i) => i !== one);
      if (l.date === info.dates[0] && !l.issues.includes(many)) l.issues = [many, ...l.issues].slice(0, 2);
    }
    const first = links[0]!;
    first.issues = [many, opts.merged.id];
    info.absorbed = { id: first.video.id, issue: opts.merged.id, into: opts.merged.into };
    const lone = links.find((l) => l.date === info.dates.find((d) => daysBetween(d, opts.end) < 30 && d !== info.dates[0]) && l.issues.length === 0);
    if (one !== null && lone) {
      lone.issues = [one];
      info.one = one;
    }
    info.many = many;
  }

  // 이슈마다 관련 영상(흡수된 이슈의 영상은 남는 이슈로, 같은 영상은 한 번), 붙은 브리프 날짜 최근 순
  const byIssue = new Map<number, IssueVideo[]>();
  for (const l of links) {
    for (const raw of l.issues) {
      const issue = raw === opts.merged.id ? opts.merged.into : raw;
      if (!byIssue.has(issue)) byIssue.set(issue, []);
      const list = byIssue.get(issue)!;
      if (!list.some((v) => v.id === l.video.id)) list.push({ ...l.video, date: l.date });
    }
  }
  for (const list of byIssue.values()) list.sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : 0));
  return { byDate, byIssue, info };
}
