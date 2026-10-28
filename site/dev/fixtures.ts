// 지어낸 사이트 데이터와 검색 레코드(로컬 화면 확인·테스트용). 내용은 모두 가짜다.
// node site/dev/fixtures.ts --out <폴더> [--end 2026-10-27] [--days 7] [--top 5] [--short 5] [--issues 40]
// <폴더>/site-data/*.json과 <폴더>/search-records.json을 만든다. 같은 인자면 같은 결과다.
import fs from "node:fs";
import path from "node:path";
import { CONFIDENCE_LEVELS, MINORS_BY_MAJOR, SECTIONS, type Major, type SectionName } from "../../src/categories.ts";
import type {
  DayList,
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
}

export interface Fixture {
  /** 상대 경로 → 내용 */
  files: Map<string, string>;
  dates: string[];
  /** 검증용: 이미지가 있는 뉴스 키(날짜#키), 흡수된 이슈 */
  info: { imageStory: string | null; merged: { id: number; into: number; on: string } | null };
}

/** 고정 씨앗 난수(mulberry32) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

  const lists = new Map<string, MonthList>();
  const details = new Map<string, MonthDetail>();
  const newsRecords: SearchRecord[] = [];
  let imageStory: string | null = null;
  let storyCount = 0;
  /** 날짜 → 그날 뉴스가 있는 이슈 */
  const issuesByDate = new Map<string, Set<number>>();

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
          dayDetails[key] = detail;
          text.push(title, detail.summary, detail.whyItMatters, detail.background, ...detail.keyFacts, detail.analogy ?? "", detail.outlook);
        } else {
          text.push(title);
        }
        const category = { major, minor, ...(storyCount % 17 === 0 ? { isNewMinor: true } : {}) };
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

  const chunks = new Map<number, IssueChunk>();
  for (const i of activeIssues) {
    const related = activeIssues.filter((o) => o.id !== i.id && o.major === i.major).slice(0, 2).map((o) => ({ id: o.id, name: o.name }));
    const detail: IssueDetail = { ...toItem(i), aliases: i.aliases, summary: i.summary, timeline: [...i.timeline].reverse(), related };
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

  const datesDesc = [...datesAsc].reverse();
  const dates: SiteDates = { version: 1, latestDate: datesDesc[0] ?? null, dates: datesDesc, months: [...new Set(datesDesc.map((x) => x.slice(0, 7)))] };

  const files = new Map<string, string>();
  const json = (v: unknown) => JSON.stringify(v);
  files.set("site-data/dates.json", json(dates));
  for (const [m, l] of lists) files.set(`site-data/list-${m}.json`, json(l));
  for (const [m, dt] of details) files.set(`site-data/detail-${m}.json`, json(dt));
  files.set("site-data/issue-list.json", json(issueList));
  for (const [c, chunk] of chunks) files.set(`site-data/issue-${c}.json`, json(chunk));
  files.set("search-records.json", json([...newsRecords, ...issueRecords]));
  return { files, dates: datesDesc, info: { imageStory, merged: { id: mergedId, into: mergedInto, on: mergedOn } } };
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
    console.error("사용법: node site/dev/fixtures.ts --out <폴더> [--end YYYY-MM-DD] [--days N] [--top N] [--short N] [--issues N] [--contiguous]");
    process.exit(1);
  }
  const num = (name: string) => (get(name) ? Number(get(name)) : undefined);
  const fx = writeFixtures(out, { end: get("--end"), days: num("--days"), top: num("--top"), short: num("--short"), issues: num("--issues"), contiguous: args.includes("--contiguous") });
  console.log(`가짜 사이트 데이터: ${out} (날짜 ${fx.dates.length}개, 파일 ${fx.files.size}개)`);
}
