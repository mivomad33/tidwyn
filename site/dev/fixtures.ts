// 지어낸 사이트 데이터와 검색 레코드(로컬 화면 확인·테스트용). 내용은 모두 가짜다.
// node site/dev/fixtures.ts --out <폴더> [--end 2026-10-27] [--days 7] [--top 5] [--short 5] [--issues 40]
//   [--entities 30] [--terms 24] [--hub]   (4단계: 인물·기관·국가와 용어. --hub는 대상 1을 모든 뉴스에 붙인다(5년치 측정용))
//   [--schedules 0]   (5단계: 일정 수. 0이면 빈 일정 색인만 만든다)
//   [--indicators 0] [--indicators-all]   (6단계: 지표 값의 햇수. 0이면 지표 파일을 만들지 않는다. --indicators-all은 12개 모두 공개·값 있음(크기 측정용))
// <폴더>/site-data/*.json과 <폴더>/search-records.json을 만든다. 같은 인자면 같은 결과다.
import fs from "node:fs";
import path from "node:path";
import { CONFIDENCE_LEVELS, MINORS_BY_MAJOR, SECTIONS, type Major, type SectionName } from "../../src/categories.ts";
import { ENTITY_FILTERS, ENTITY_FIRST_NEWS, byCount, dayStoryCount, entityChunkOf, issueEntityChips, entityRecordUrl, termRecordUrl, type EntityKind } from "../../src/siteTypes.ts";
import { addDays, rng } from "./random.ts";
import { fixtureIndicators, type IndicatorFixtureInfo } from "./indicatorFixtures.ts";
import { fixtureSchedules, type FixtureStory, type ScheduleFixtureInfo } from "./scheduleFixtures.ts";
import { entityListPages } from "../src/lib/entities.ts";
import { buildTermFiles } from "../src/lib/terms.ts";
import type {
  DayList,
  EntityChunk,
  EntityDetail,
  EntityListItem,
  EntityNews,
  EntityNewsChunk,
  EntityRef,
  IssueEntity,
  TermItem,
  TermRef,
  IssueChunk,
  IssueDetail,
  IssueListItem,
  ListSection,
  ListStory,
  MonthDetail,
  MonthList,
  SearchRecord,
  SiteDates,
  SiteIssueList,
  SiteSource,
  StoryDetail,
} from "../../src/siteTypes.ts";

export interface FixtureOptions {
  /** 가장 최근 날짜 */
  end?: string;
  /** 날짜 수(하루 간격, 3일마다 하루 빠짐: "M월 D일에 이어"를 만들기 위해) */
  days?: number;
  /** 섹션마다 주요 뉴스 수 */
  top?: number;
  /** 섹션마다 짧은 소식 수 */
  short?: number;
  /** 이슈 수 */
  issues?: number;
  /** 날짜를 빠짐없이 둔다 */
  contiguous?: boolean;
  /** 4단계: 대상(인물·기관·국가) 수. 6개 이상이면 마지막 것은 대상 2에 흡수되고, 그 앞의 것은 지운 것이다 */
  entities?: number;
  /** 4단계: 용어 수. 6개 이상이면 마지막 것은 용어 1에 흡수되고, 그 앞의 것은 지운 것이다 */
  terms?: number;
  /** 대상 1을 모든 뉴스에 붙인다(뉴스가 아주 많은 대상의 페이지 크기 측정용). 없으면 한국 섹션 주요 뉴스에만 붙인다 */
  hub?: boolean;
  /** 5단계: 일정 수(흡수된 것 하나와 지운 것 하나 포함, 20개 이상일 때). 없거나 0이면 빈 일정 색인만 만들고 다른 파일은 그대로다 */
  schedules?: number;
  /** 6단계: 지표 값의 햇수(지표 12개, 휴장일, 이슈의 2할이 지표 1~3개). 없거나 0이면 지표 파일을 만들지 않고 다른 파일은 그대로다 */
  indicators?: number;
  /** 6단계: 지표 12개 모두 공개하고 값을 둔다. 아니면 브렌트유는 공개를 끈 지표, 코스닥은 값이 하나도 없는 공개 지표다 */
  indicatorsAll?: boolean;
}

export interface Fixture {
  /** 상대 경로 → 내용 */
  files: Map<string, string>;
  dates: string[];
  /** 검증용: 이미지가 있는 뉴스 키(날짜#키), 흡수된 이슈, 대상·용어 */
  info: {
    imageStory: string | null;
    merged: { id: number; into: number; on: string } | null;
    entities: { merged: { id: number; into: number; on: string } | null; deleted: { id: number; name: string } | null; most: number | null };
    terms: {
      merged: { id: number; into: number; on: string } | null;
      deleted: number | null;
      /** 본문에 표기가 두 번 나오는 용어와 그 뉴스 */
      twice: { date: string; key: string; termId: number } | null;
      /** 본문 표기가 없는 용어 */
      noSurface: number | null;
    };
    /** 5단계: 일정을 만들었을 때만 */
    schedules: ScheduleFixtureInfo | null;
    /** 6단계: 지표를 만들었을 때만 */
    indicators: IndicatorFixtureInfo | null;
  };
}

const SUBJECTS = ["가짜시", "가짜당", "가짜국", "가짜은행", "가짜전자", "가짜구", "가짜연구소", "가짜항공", "가짜대학", "가짜그룹"];
const TOPICS = ["반도체", "예산안", "휴전", "기준금리", "수출", "주상복합 화재", "지방선거", "AI 모델", "데이터센터", "배터리", "전세 사기", "연금 개혁", "우주 발사체", "백신", "야구 리그"];
const PARTICLES = ["가", "를", "에", "의", "와", "는"];
const PREDICATES = ["끌어올렸다", "발표했다", "예고했다", "크게 늘었다", "줄었다", "합의했다", "다시 논의한다", "결론을 미뤘다"];
const FILLER = [
  "관계자들은 다음 달 발표를 지켜봐야 한다고 말했다",
  "시장은 이번 결정이 연말까지 영향을 줄 것으로 본다",
  "전문가들은 속도보다 방향이 중요하다고 지적했다",
  "정부는 관련 대책을 이번 주 안에 내놓겠다고 밝혔다",
  "지역 주민들은 설명회를 다시 열어 달라고 요구했다",
  "업계는 비용 부담이 커질 수 있다며 우려했다",
];
const OUTLETS = ["가짜일보", "가짜경제", "가짜방송", "가짜통신", "가짜테크"];
const MAJOR_BY_SECTION: Record<SectionName, Major[]> = {
  "한국": ["정치", "경제", "사회", "과학·건강", "문화·스포츠"],
  "세계": ["국제", "경제", "과학·건강"],
  "IT·AI": ["IT·AI"],
};

// 4단계: 지어낸 인물·기관·국가와 용어
const SURNAMES: [string, string][] = [["김", "Kim"], ["이", "Lee"], ["박", "Park"], ["최", "Choi"], ["정", "Jung"], ["강", "Kang"], ["조", "Cho"], ["윤", "Yoon"]];
const GIVEN: [string, string][] = [["가짜", "Gajja"], ["가상", "Gasang"], ["모의", "Moui"], ["허구", "Heogu"], ["예시", "Yesi"]];
const ROLES = ["가짜 중앙은행 총재", "가짜당 대표", "가짜전자 회장", "가짜국 대통령", "가짜시 시장", "가짜연구소 소장", "모의국 외교장관", "가짜대학 교수"];
const ORGS: [string, string, string][] = [
  ["가짜 중앙은행", "Gajja Central Bank", "가짜국의 중앙은행"],
  ["가짜전자", "Gajja Electronics", "가짜국의 반도체·전자 기업"],
  ["가짜당", "Gajja Party", "가짜국의 여당"],
  ["가짜연구소", "Gajja Institute", "가짜국의 AI 연구 기관"],
  ["가짜항공", "Gajja Air", "가짜국의 항공사"],
  ["가짜그룹", "Gajja Group", "여러 계열사를 둔 가짜 대기업"],
  ["모의 위원회", "Moui Commission", "가짜국의 금융 감독 기구"],
  ["가짜 국제기구", "Gajja International", "여러 가짜 나라가 모인 국제기구"],
];
const COUNTRIES: [string, string, string][] = [
  ["가짜국", "Gajjaland", "가짜 대륙 동쪽의 공화국"],
  ["모의국", "Mouiland", "가짜 대륙 서쪽의 왕국"],
  ["상상국", "Sangsangland", "섬으로 이루어진 가짜 나라"],
  ["허구국", "Heoguland", "가짜 대륙 북쪽의 연방 국가"],
];
/** 대상 종류 순환(1번은 기관 "가짜 중앙은행") */
const KIND_CYCLE: EntityKind[] = ["기관", "인물", "국가", "인물", "기관"];
/** [용어, 별칭, 설명]. 본문 표기는 용어 이름(별칭이 있으면 셋에 하나는 별칭)이다 */
const TERM_BASES: [string, string[], string][] = [
  ["기준금리", [], "중앙은행이 정하는 정책 금리로, 은행 대출·예금 금리의 기준이 된다."],
  ["양적긴축", ["QT"], "중앙은행이 사들였던 채권을 팔거나 만기 때 다시 사지 않아 시중의 돈을 줄이는 정책이다."],
  ["유상증자", [], "회사가 새 주식을 발행해 투자자에게 돈을 받고 파는 것이다."],
  ["테이퍼링", [], "중앙은행이 채권을 사들이는 양을 조금씩 줄여 가는 것이다."],
  ["HBM", ["고대역폭 메모리"], "메모리 칩을 여러 층으로 쌓아 데이터를 빠르게 주고받게 만든 반도체다."],
  ["농업 보조금", [], "나라가 농가의 소득이나 생산을 돕기 위해 주는 돈이다."],
  ["디레버리징", [], "빚을 줄여 재무 부담을 낮추는 것이다."],
  ["리쇼어링", [], "해외로 나갔던 공장을 다시 자기 나라로 들여오는 것이다."],
  ["매파", [], "물가를 잡기 위해 금리를 올리자는 쪽의 입장이다."],
  ["비둘기파", [], "경기를 살리기 위해 금리를 낮추자는 쪽의 입장이다."],
  ["상계관세", [], "다른 나라가 보조금을 준 수입품에 그만큼 더 매기는 관세다."],
  ["인플레이션", [], "물건값이 전반적으로 계속 오르는 현상이다."],
  ["자사주 매입", [], "회사가 자기 회사 주식을 시장에서 사들이는 것이다."],
  ["추가경정예산", ["추경"], "이미 정한 나라 예산에 더하거나 고쳐서 다시 짜는 예산이다."],
  ["코스피", [], "가짜국 대표 주식 시장의 전체 주가 흐름을 나타내는 지수다."],
  ["파운드리", [], "다른 회사가 설계한 반도체를 대신 만들어 주는 사업이다."],
  ["희토류", [], "첨단 제품에 꼭 필요하지만 구하기 어려운 금속 원소들이다."],
  ["거부권", [], "결정된 안건을 혼자서 막을 수 있는 권한이다."],
  ["5G", [], "이전 세대보다 빠르고 지연이 적은 이동 통신 기술이다."],
  ["ETF", ["상장지수펀드"], "주식처럼 거래소에서 사고팔 수 있게 만든 펀드다."],
  ["채무불이행", ["디폴트"], "빌린 돈을 약속한 때에 갚지 못하는 것이다."],
  ["환율", [], "다른 나라 돈과 바꿀 때의 비율이다."],
  ["스태그플레이션", [], "경기는 나쁜데 물가는 오르는 상태다."],
  ["대체거래소", [], "기존 거래소 말고 주식을 사고팔 수 있게 한 다른 거래 시장이다."],
];
const TERM_PARTS = ["summary", "whyItMatters", "background", "outlook"] as const;

export function generateFixtures(opts: FixtureOptions = {}): Fixture {
  const end = opts.end ?? "2026-10-27";
  const nDays = opts.days ?? 7;
  const nTop = opts.top ?? 5;
  const nShort = opts.short ?? 5;
  const nIssues = Math.max(4, opts.issues ?? 40);
  const rand = rng(20261027);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const sentence = () => `${pick(SUBJECTS)} ${pick(TOPICS)}${pick(PARTICLES)} ${pick(FILLER)}.`;

  // 날짜(오래된 순). 3일마다 하루를 빼서 저장일 사이가 이틀인 경우를 만든다
  const datesAsc: string[] = [];
  let d = end;
  for (let i = 0; datesAsc.length < nDays; i++) {
    if (opts.contiguous || i % 3 !== 2 || i === 0) datesAsc.unshift(d);
    d = addDays(d, -1);
  }

  // 이슈. 마지막 이슈는 첫 이슈에 흡수된다
  interface IssueWork {
    id: number;
    name: string;
    aliases: string[];
    major: Major;
    minor: string;
    summary: string;
    timeline: { date: string; key: string; title: string }[];
  }
  const issues: IssueWork[] = [];
  for (let id = 1; id <= nIssues; id++) {
    const major = pick(Object.keys(MINORS_BY_MAJOR) as Major[]);
    const topic = TOPICS[id % TOPICS.length]!;
    issues.push({
      id,
      name: `${SUBJECTS[id % SUBJECTS.length]} ${topic} 흐름 ${id}`,
      aliases: id % 4 === 0 ? [`가짜별칭${id}`, `${topic} 논쟁 ${id}`] : [],
      major,
      minor: pick(MINORS_BY_MAJOR[major]),
      summary: `${sentence()} ${sentence()} ${sentence()}`,
      timeline: [],
    });
  }
  const mergedId = nIssues;
  const mergedInto = 1;
  const activeIssues = issues.filter((i) => i.id !== mergedId);

  // 4단계: 대상과 용어. 기존 내용과 같은 결과를 내도록 따로 씨앗을 둔 난수를 쓴다
  const erand = rng(20261029);
  const epick = <T>(arr: readonly T[]): T => arr[Math.floor(erand() * arr.length)]!;
  interface Link {
    date: string;
    key: string;
    kind: "top" | "short";
    title: string;
    issueId: number | null;
    seq: number;
  }
  interface EntityWork {
    id: number;
    name: string;
    kind: EntityKind;
    description: string;
    aliases: string[];
    links: Link[];
  }
  const nEntities = Math.max(0, opts.entities ?? 30);
  const entities: EntityWork[] = [];
  const kindCount: Record<EntityKind, number> = { 인물: 0, 기관: 0, 국가: 0 };
  for (let id = 1; id <= nEntities; id++) {
    const kind = KIND_CYCLE[(id - 1) % KIND_CYCLE.length]!;
    const n = kindCount[kind]++;
    let name: string;
    let alias: string;
    let description: string;
    if (kind === "인물") {
      const [sk, se] = SURNAMES[n % SURNAMES.length]!;
      const [gk, ge] = GIVEN[Math.floor(n / SURNAMES.length) % GIVEN.length]!;
      const round = Math.floor(n / (SURNAMES.length * GIVEN.length));
      name = `${sk}${gk}${round ? round + 1 : ""}`;
      alias = `${se} ${ge}${round ? ` ${round + 1}` : ""}`;
      description = ROLES[n % ROLES.length]!;
    } else {
      const table = kind === "기관" ? ORGS : COUNTRIES;
      const [k, e, d] = table[n % table.length]!;
      const round = Math.floor(n / table.length);
      name = round ? `${k} ${round + 1}` : k;
      alias = round ? `${e} ${round + 1}` : e;
      description = d;
    }
    entities.push({ id, name, kind, description, aliases: [alias], links: [] });
  }
  const entityMergedId = nEntities >= 6 ? nEntities : null;
  const entityDeletedId = nEntities >= 6 ? nEntities - 1 : null;
  const entityInto = 2;
  const activeEntities = entities.filter((e) => e.id !== entityMergedId && e.id !== entityDeletedId);
  const entityById = new Map(activeEntities.map((e) => [e.id, e]));

  interface TermWork {
    id: number;
    name: string;
    aliases: string[];
    description: string;
    surface: string | null;
    links: Link[];
  }
  const nTerms = Math.max(0, opts.terms ?? 24);
  const termsW: TermWork[] = [];
  for (let id = 1; id <= nTerms; id++) {
    const [base, aliases, description] = TERM_BASES[(id - 1) % TERM_BASES.length]!;
    const round = Math.floor((id - 1) / TERM_BASES.length);
    const name = round ? `${base} ${round + 1}` : base;
    // 5번째마다 본문 표기가 없는 용어(칩으로만 연다). 별칭이 있으면 가끔 별칭이 본문 표기다
    const surface = id % 5 === 4 ? null : aliases.length && id % 3 === 0 ? aliases[0]! : name;
    termsW.push({ id, name, aliases, description, surface, links: [] });
  }
  const termMergedId = nTerms >= 6 ? nTerms : null;
  const termDeletedId = nTerms >= 6 ? nTerms - 1 : null;
  const termInto = 1;
  const activeTerms = termsW.filter((t) => t.id !== termMergedId && t.id !== termDeletedId);
  const noSurfaceTerm = activeTerms.find((t) => t.surface === null) ?? null;
  let twice: Fixture["info"]["terms"]["twice"] = null;
  /** 날짜#키 → 그 뉴스의 대상 식별자(이슈의 등장 대상을 세기 위해) */
  const storyEntities = new Map<string, number[]>();

  const lists = new Map<string, MonthList>();
  const details = new Map<string, MonthDetail>();
  const newsRecords: SearchRecord[] = [];
  let imageStory: string | null = null;
  let storyCount = 0;
  /** 날짜 → 그날 뉴스가 있는 이슈 */
  const issuesByDate = new Map<string, Set<number>>();
  /** 5단계: 일정의 근거·결과로 쓸 뉴스(만든 순서). 난수를 쓰지 않고 모으기만 한다 */
  const storyLog: FixtureStory[] = [];

  for (const [di, date] of datesAsc.entries()) {
    const prevDate = di > 0 ? datesAsc[di - 1]! : null;
    const month = date.slice(0, 7);
    const sections: ListSection[] = [];
    const dayDetails: Record<string, StoryDetail> = {};
    const todays = new Set<number>();
    const text: string[] = [];
    for (const section of SECTIONS) {
      const stories: ListStory[] = [];
      const makeStory = (kind: "top" | "short", position: number): ListStory => {
        storyCount++;
        const key = kind === "top" ? `${section}-${position}` : `${section}-s${position}`;
        const major = pick(MAJOR_BY_SECTION[section]);
        const minor = pick(MINORS_BY_MAJOR[major]);
        const title =
          storyCount === 1
            ? "가짜시 3분기 성장률 1.2%, 반도체가 수출을 끌어올렸다"
            : `${pick(SUBJECTS)} ${pick(TOPICS)}${pick(PARTICLES)} ${pick(PREDICATES)}, ${pick(FILLER).slice(0, 18)}`;
        const free = activeIssues.filter((i) => !todays.has(i.id));
        const issueW = free.length && rand() < 0.8 ? pick(free) : null;
        let issue = null as ListStory["issue"];
        let newIssue = false;
        let continues = null as ListStory["continues"];
        let previous: StoryDetail["previous"] = [];
        if (issueW) {
          todays.add(issueW.id);
          issue = { id: issueW.id, name: issueW.name };
          previous = issueW.timeline.slice(-3).reverse();
          newIssue = previous.length === 0;
          if (prevDate && issuesByDate.get(prevDate)?.has(issueW.id)) {
            const gap = (Date.parse(date) - Date.parse(prevDate)) / 86400000;
            const [, m, dd] = prevDate.split("-").map(Number);
            continues = { date: prevDate, label: gap === 1 ? "어제에 이어" : `${m}월 ${dd}일에 이어` };
          }
          issueW.timeline.push({ date, key, title });
        }
        if (kind === "top") {
          const nSources = 1 + (storyCount % 3);
          const sources: SiteSource[] = [];
          for (let s = 0; s < nSources; s++) {
            const src: SiteSource = {
              name: OUTLETS[(storyCount + s) % OUTLETS.length]!,
              url: `https://news.example.com/${date}/${encodeURIComponent(key)}/${s}`,
              publishedAt: s === 2 ? addDays(date, -1) : date,
            };
            if (s === 0) src.primary = true;
            if (s === 1 && storyCount % 5 === 0) src.publishedAtEstimated = true;
            if (s === 0 && storyCount % 9 === 2) {
              src.imageUrl = `https://img.example.com/fake-${storyCount}.jpg`;
              imageStory ??= `${date}#${key}`;
            }
            sources.push(src);
          }
          const extras = rand() < 0.3 ? [pick(activeIssues)].filter((x) => x.id !== issueW?.id).map((x) => ({ id: x.id, name: x.name })) : [];
          const detail: StoryDetail = {
            key,
            summary: `${title}. ${sentence()}`,
            whyItMatters: `${sentence()} ${sentence()}`,
            background: `${sentence()} ${sentence()}`,
            keyFacts: [sentence(), sentence(), sentence()],
            outlook: sentence(),
            confidence: pick(CONFIDENCE_LEVELS),
            sources,
            extras,
            previous,
          };
          if (storyCount % 4 === 0) detail.analogy = `마치 ${sentence()}`;
          // 용어: 주요 뉴스마다 평균 하나. 본문 표기가 있는 용어는 그 표기를 본문에 넣는다
          const chosen = new Map<number, TermWork>();
          if (activeTerms.length) {
            if (!twice && activeTerms[0]!.surface) {
              const t = activeTerms[0]!;
              chosen.set(t.id, t);
              detail.summary = `${detail.summary} ${t.surface}가 쟁점이다.`;
              detail.background = `${detail.background} ${t.surface} 논의는 지난해에도 있었다.`;
              twice = { date, key, termId: t.id };
              if (noSurfaceTerm) chosen.set(noSurfaceTerm.id, noSurfaceTerm);
            } else {
              const r = erand();
              const n = r < 0.75 ? 1 : r < 0.875 ? 0 : 2;
              for (let k = 0; k < n; k++) {
                const t = epick(activeTerms);
                if (chosen.has(t.id)) continue;
                chosen.set(t.id, t);
                if (t.surface) {
                  const part = epick(TERM_PARTS);
                  detail[part] = `${detail[part]} ${t.surface} 문제도 함께 거론됐다.`;
                }
              }
            }
          }
          if (chosen.size) {
            const refs: TermRef[] = [];
            for (const t of [...chosen.values()].sort((a, b) => a.id - b.id)) {
              t.links.push({ date, key, kind, title, issueId: issueW?.id ?? null, seq: storyCount });
              const ref: TermRef = { id: t.id, name: t.name, description: t.description };
              if (t.surface) ref.surface = t.surface;
              refs.push(ref);
            }
            detail.terms = refs;
          }
          dayDetails[key] = detail;
          text.push(title, detail.summary, detail.whyItMatters, detail.background, ...detail.keyFacts, detail.analogy ?? "", detail.outlook);
        } else {
          text.push(title);
        }
        // 대상: 뉴스마다 평균 셋
        if (activeEntities.length) {
          const ids = new Set<number>();
          if (opts.hub || (section === "한국" && kind === "top")) ids.add(activeEntities[0]!.id);
          const n = 1 + Math.floor(erand() * 5);
          for (let k = 0; k < n; k++) ids.add(epick(activeEntities).id);
          const picked = [...ids].sort((a, b) => a - b).map((id) => entityById.get(id)!);
          for (const e of picked) e.links.push({ date, key, kind, title, issueId: issueW?.id ?? null, seq: storyCount });
          storyEntities.set(`${date}#${key}`, picked.map((e) => e.id));
          if (kind === "top") dayDetails[key]!.entities = picked.map((e): EntityRef => ({ id: e.id, name: e.name, kind: e.kind, description: e.description }));
        }
        const category = { major, minor, ...(storyCount % 17 === 0 ? { isNewMinor: true } : {}) };
        storyLog.push({ date, key, kind, major, issueId: issueW?.id ?? null, title });
        return { key, section, kind, position, title, category, issue, newIssue, continues };
      };
      for (let r = 1; r <= nTop; r++) stories.push(makeStory("top", r));
      for (let p = 1; p <= nShort; p++) stories.push(makeStory("short", p));
      const sec: ListSection = { name: section, flow: `${section}: ${sentence()}`, stories };
      if (section === "세계" && di % 2 === 0) sec.unverified = "가짜국 국경 지역 피해 규모는 아직 확인되지 않았다.";
      sections.push(sec);
    }
    issuesByDate.set(date, todays);
    const day: DayList = { date, headline: `${sentence()} ${sentence()}`, keywords: [pick(TOPICS), pick(TOPICS), pick(TOPICS)].filter((k, i, a) => a.indexOf(k) === i), sections };
    if (!lists.has(month)) lists.set(month, { month, days: [] });
    lists.get(month)!.days.push(day);
    if (!details.has(month)) details.set(month, { month, days: {} });
    details.get(month)!.days[date] = dayDetails;
    newsRecords.push({ url: `/${date}`, content: [day.headline, ...day.keywords, ...text].filter(Boolean).join("\n"), language: "ko", meta: { kind: "news", date } });
  }

  // 흡수된 이슈의 전개는 남는 이슈로 옮긴다
  const merged = issues.find((i) => i.id === mergedId)!;
  const survivor = issues.find((i) => i.id === mergedInto)!;
  survivor.timeline.push(...merged.timeline);
  survivor.timeline.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  const mergedOn = datesAsc.at(-1)!;

  const toItem = (i: IssueWork): IssueListItem => ({
    id: i.id,
    name: i.name,
    category: { major: i.major, minor: i.minor },
    status: i.id % 5 === 0 ? "종료" : "진행 중",
    startDate: i.timeline[0]?.date ?? null,
    latestDate: i.timeline.at(-1)?.date ?? null,
    count: i.timeline.length,
  });
  const items = activeIssues.map(toItem).sort((a, b) => ((a.latestDate ?? "") < (b.latestDate ?? "") ? 1 : (a.latestDate ?? "") > (b.latestDate ?? "") ? -1 : b.id - a.id));
  const issueList: SiteIssueList = { issues: items, merged: { [String(mergedId)]: { into: mergedInto, on: mergedOn } } };

  // 5단계: 일정. 따로 씨앗을 둔 난수를 쓰고, 일정이 없으면 다른 파일을 바꾸지 않는다
  const issueNameById = new Map(issues.map((x) => [x.id, x.name]));
  const sched = fixtureSchedules({
    count: opts.schedules ?? 0,
    dates: datesAsc,
    stories: storyLog,
    issueOf: (id) => (id === mergedId ? mergedInto : id),
    issueName: (id) => issueNameById.get(id) ?? "",
  });
  for (const l of lists.values()) for (const day of l.days) {
    const week = sched.weeks.get(day.date);
    if (week) day.week = week;
  }
  for (const dt of details.values()) for (const [date, cards] of Object.entries(dt.days)) for (const [key, card] of Object.entries(cards)) {
    const chips = sched.chips.get(`${date}/${key}`);
    if (chips) card.schedules = chips;
  }

  // 6단계: 지표. 난수는 따로 두고, 지표가 없으면 다른 파일을 바꾸지 않는다
  const ind = opts.indicators
    ? fixtureIndicators({ dates: datesAsc, issues: activeIssues.map((i) => ({ id: i.id, name: i.name, startDate: i.timeline[0]?.date ?? null, latestDate: i.timeline.at(-1)?.date ?? null })), years: opts.indicators, all: opts.indicatorsAll })
    : null;
  if (ind) for (const l of lists.values()) for (const day of l.days) {
    const chips = ind.chips.get(day.date);
    if (chips) day.indicators = chips;
  }

  const chunks = new Map<number, IssueChunk>();
  for (const i of activeIssues) {
    const related = activeIssues.filter((o) => o.id !== i.id && o.major === i.major).slice(0, 2).map((o) => ({ id: o.id, name: o.name }));
    const detail: IssueDetail = { ...toItem(i), aliases: i.aliases, summary: i.summary, timeline: [...i.timeline].reverse(), related };
    // 등장 대상: 이 이슈 뉴스(흡수된 이슈의 뉴스 포함)에 나온 횟수 순, 최대 10개
    const counts = new Map<number, number>();
    for (const t of i.timeline) for (const eid of storyEntities.get(`${t.date}#${t.key}`) ?? []) counts.set(eid, (counts.get(eid) ?? 0) + 1);
    const issueEntities: IssueEntity[] = issueEntityChips([...counts].map(([eid, count]) => ({ id: eid, name: entityById.get(eid)!.name, count })));
    if (issueEntities.length) detail.entities = issueEntities;
    const issueSchedules = sched.byIssue.get(i.id);
    if (issueSchedules) detail.schedules = issueSchedules;
    const issueIndicators = ind?.byIssue.get(i.id);
    if (issueIndicators) detail.indicators = issueIndicators;
    const c = Math.floor(i.id / 100);
    if (!chunks.has(c)) chunks.set(c, { issues: {} });
    chunks.get(c)!.issues[String(i.id)] = detail;
  }
  const issueRecords: SearchRecord[] = [...chunks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([c, chunk]) => ({
      url: `/issues/chunk/${c}`,
      content: Object.values(chunk.issues)
        .flatMap((i) => [i.name, ...i.aliases, i.summary])
        .join("\n"),
      language: "ko",
      meta: { kind: "issues", chunk: String(c) },
    }));

  // 4단계: 대상 목록·상세 묶음·나머지 뉴스 묶음
  const issueNames = new Map(issues.map((x) => [x.id, x.name]));
  const issueName = (id: number | null): string | null => (id === null ? null : (issueNames.get(id === mergedId ? mergedInto : id) ?? null));
  const issueOf = (id: number | null): number | null => (id === mergedId ? mergedInto : id);
  const entityDetails: EntityDetail[] = [];
  const entityRest = new Map<number, EntityNews[]>();
  const byRecent = (a: Link, b: Link) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.seq - a.seq);
  for (const e of activeEntities) {
    if (!e.links.length) continue;
    const links = [...e.links].sort(byRecent);
    const news = links.map((l): EntityNews => ({ date: l.date, key: l.key, kind: l.kind, title: l.title, issue: issueName(l.issueId) }));
    const issueCounts = new Map<number, number>();
    for (const l of links) {
      const iid = issueOf(l.issueId);
      if (iid !== null) issueCounts.set(iid, (issueCounts.get(iid) ?? 0) + 1);
    }
    const entityIssues: IssueEntity[] = byCount([...issueCounts].map(([id, count]) => ({ id, name: issueName(id)!, count })));
    entityDetails.push({
      id: e.id,
      name: e.name,
      kind: e.kind,
      description: e.description,
      latestDate: links[0]!.date,
      count: links.length,
      aliases: e.aliases,
      firstDate: links.at(-1)!.date,
      issues: entityIssues,
      news: news.slice(0, ENTITY_FIRST_NEWS),
      moreNews: Math.max(0, news.length - ENTITY_FIRST_NEWS),
    });
    if (news.length > ENTITY_FIRST_NEWS) entityRest.set(e.id, news.slice(ENTITY_FIRST_NEWS));
  }
  const entityChunks = new Map<number, EntityChunk>();
  const chunkFor = (id: number) => {
    const c = entityChunkOf(id);
    if (!entityChunks.has(c)) entityChunks.set(c, { entities: {}, merged: {} });
    return entityChunks.get(c)!;
  };
  for (const e of entityDetails) chunkFor(e.id).entities[String(e.id)] = e;
  const entityMerged = entityMergedId !== null && entityDetails.some((e) => e.id === entityInto) ? { id: entityMergedId, into: entityInto, on: mergedOn } : null;
  if (entityMerged) chunkFor(entityMerged.id).merged[String(entityMerged.id)] = { into: entityMerged.into, on: entityMerged.on };
  const entityNewsChunks = new Map<number, EntityNewsChunk>();
  for (const [id, rest] of entityRest) {
    const c = entityChunkOf(id);
    if (!entityNewsChunks.has(c)) entityNewsChunks.set(c, { news: {} });
    entityNewsChunks.get(c)!.news[String(id)] = rest;
  }
  const listItems: EntityListItem[] = entityDetails.map((e) => ({ id: e.id, name: e.name, kind: e.kind, description: e.description, latestDate: e.latestDate, count: e.count }));
  const entityRecords: SearchRecord[] = [...entityChunks.entries()]
    .filter(([, chunk]) => Object.keys(chunk.entities).length > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([c, chunk]) => ({
      url: entityRecordUrl(c),
      content: Object.values(chunk.entities)
        .flatMap((e) => [e.name, ...e.aliases, e.description])
        .join("\n"),
      language: "ko",
      meta: { kind: "entities", chunk: String(c) },
    }));

  // 4단계: 용어 사전 색인과 첫 자음 묶음
  const termItems: TermItem[] = [];
  for (const t of activeTerms) {
    if (!t.links.length) continue;
    const first = [...t.links].sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.seq - b.seq))[0]!;
    termItems.push({ id: t.id, name: t.name, aliases: t.aliases, description: t.description, first: { date: first.date, key: first.key, title: first.title }, count: t.links.length });
  }
  const termMerged = termMergedId !== null && termItems.some((t) => t.id === termInto) ? { id: termMergedId, into: termInto, on: mergedOn } : null;
  const termFiles = buildTermFiles(termItems, termMerged ? { [String(termMerged.id)]: { into: termMerged.into, on: termMerged.on } } : {});
  const termRecords: SearchRecord[] = [...termFiles.groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([g, ts]) => ({ url: termRecordUrl(g), content: ts.flatMap((t) => [t.name, ...t.aliases, t.description]).join("\n"), language: "ko", meta: { kind: "terms", group: String(g) } }));

  const datesDesc = [...datesAsc].reverse();
  const dayCounts = new Map([...lists.values()].flatMap((l) => l.days.map((d) => [d.date, dayStoryCount(d)] as const)));
  const dates: SiteDates = { version: 1, latestDate: datesDesc[0] ?? null, dates: datesDesc, months: [...new Set(datesDesc.map((x) => x.slice(0, 7)))], storyCounts: datesDesc.map((d) => dayCounts.get(d) ?? 0) };

  const files = new Map<string, string>();
  const json = (v: unknown) => JSON.stringify(v);
  files.set("site-data/dates.json", json(dates));
  for (const [m, l] of lists) files.set(`site-data/list-${m}.json`, json(l));
  for (const [m, dt] of details) files.set(`site-data/detail-${m}.json`, json(dt));
  files.set("site-data/issue-list.json", json(issueList));
  for (const [c, chunk] of chunks) files.set(`site-data/issue-${c}.json`, json(chunk));
  for (const filter of ENTITY_FILTERS) for (const page of entityListPages(listItems, filter)) files.set(`site-data/entity-list-${filter}-${page.page}.json`, json(page));
  for (const [c, chunk] of [...entityChunks].sort((a, b) => a[0] - b[0])) files.set(`site-data/entity-${c}.json`, json(chunk));
  for (const [c, chunk] of [...entityNewsChunks].sort((a, b) => a[0] - b[0])) files.set(`site-data/entity-news-${c}.json`, json(chunk));
  files.set("site-data/term-index.json", json(termFiles.index));
  for (const [g, terms] of [...termFiles.groups].sort((a, b) => a[0] - b[0])) files.set(`site-data/term-group-${g}.json`, json({ group: g, terms }));
  for (const [name, content] of sched.files) files.set(`site-data/${name}`, content);
  for (const [name, content] of ind?.files ?? []) files.set(`site-data/${name}`, content);
  files.set("search-records.json", json([...newsRecords, ...issueRecords, ...entityRecords, ...termRecords]));
  const most = entityDetails.reduce<EntityDetail | null>((m, e) => (!m || e.count > m.count ? e : m), null);
  return {
    files,
    dates: datesDesc,
    info: {
      imageStory,
      merged: { id: mergedId, into: mergedInto, on: mergedOn },
      entities: { merged: entityMerged, deleted: entityDeletedId === null ? null : { id: entityDeletedId, name: entities[entityDeletedId - 1]!.name }, most: most?.id ?? null },
      terms: { merged: termMerged, deleted: termDeletedId, twice, noSurface: noSurfaceTerm?.id ?? null },
      schedules: sched.info,
      indicators: ind?.info ?? null,
    },
  };
}

export function writeFixtures(dir: string, opts: FixtureOptions = {}): Fixture {
  const fx = generateFixtures(opts);
  fs.rmSync(path.join(dir, "site-data"), { recursive: true, force: true });
  for (const [rel, content] of fx.files) {
    const file = path.join(dir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return fx;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const out = get("--out");
  if (!out) {
    console.error("사용법: node site/dev/fixtures.ts --out <폴더> [--end YYYY-MM-DD] [--days N] [--top N] [--short N] [--issues N] [--contiguous] [--entities N] [--terms N] [--hub] [--schedules N] [--indicators N] [--indicators-all]");
    process.exit(1);
  }
  const num = (name: string) => (get(name) ? Number(get(name)) : undefined);
  const fx = writeFixtures(out, {
    end: get("--end"),
    days: num("--days"),
    top: num("--top"),
    short: num("--short"),
    issues: num("--issues"),
    contiguous: args.includes("--contiguous"),
    entities: num("--entities"),
    terms: num("--terms"),
    hub: args.includes("--hub"),
    schedules: num("--schedules"),
    indicators: num("--indicators"),
    indicatorsAll: args.includes("--indicators-all"),
  });
  console.log(`가짜 사이트 데이터: ${out} (날짜 ${fx.dates.length}개, 파일 ${fx.files.size}개)`);
}
