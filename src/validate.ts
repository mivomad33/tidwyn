import type { Brief, Category, Section, ShortNews, Source, TopStory } from "./brief.ts";
import { CONFIDENCE_LEVELS, SECTIONS, isMajor, isNewMinor, type Confidence, type SectionName } from "./categories.ts";
import { isValidDate } from "./kst.ts";
import { findSkew, hostOf, primaryUrls } from "./outlets.ts";
import { longQuotes } from "./quotes.ts";

// 브리프 데이터 검사(4.2). 어긴 항목마다 위치와 이유를 돌려준다.

export interface Violation {
  /** 위치(섹션, 순위, 항목 이름) */
  where: string;
  why: string;
}

export type ValidateResult = { ok: true; brief: Brief } | { ok: false; violations: Violation[] };

export type Obj = Record<string, unknown>;

export class Checker {
  readonly violations: Violation[] = [];
  add(where: string, why: string): void {
    this.violations.push({ where, why });
  }
  obj(v: unknown, where: string): Obj | null {
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Obj;
    this.add(where, "객체여야 한다");
    return null;
  }
  keys(o: Obj, allowed: string[], where: string): void {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) this.add(where, `알 수 없는 항목 "${k}" (쓸 수 있는 항목: ${allowed.join(", ")})`);
  }
  text(o: Obj, key: string, label: string, where: string): string {
    const v = o[key];
    if (typeof v !== "string" || v.trim() === "") {
      this.add(`${where} ${label}`, "비어 있으면 안 된다");
      return "";
    }
    return v;
  }
  optText(o: Obj, key: string, label: string, where: string): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string" || v.trim() === "") {
      this.add(`${where} ${label}`, "있으면 비어 있지 않은 글이어야 한다(없으면 항목을 빼거나 null)");
      return undefined;
    }
    return v;
  }
  arr(o: Obj, key: string, label: string, where: string): unknown[] {
    const v = o[key];
    if (!Array.isArray(v)) {
      this.add(`${where} ${label}`, "목록이어야 한다");
      return [];
    }
    return v;
  }
  count(n: number, min: number, max: number, where: string): void {
    if (n < min || n > max) this.add(where, `${n}개 (${min}~${max}개여야 한다)`);
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 구글 뉴스 같은 중간 주소인지(1.5단계 R4) */
function isRedirectUrl(v: string): boolean {
  const host = hostOf(v);
  return host !== null && (host === "news.google.com" || host.endsWith(".news.google.com"));
}

const REDIRECT_WHY = "구글 뉴스 중간 주소는 쓸 수 없다. 매체 원문 주소를 웹 검색으로 찾아 넣거나, 못 찾으면 그 출처를 뺀다";

export function checkQuotes(c: Checker, text: string | undefined, where: string): void {
  if (text === undefined) return;
  for (const q of longQuotes(text)) {
    const head = q.quote.length > 30 ? `${q.quote.slice(0, 30)}…` : q.quote;
    c.add(where, `직접 인용이 ${q.words}단어다(15단어 미만이어야 한다, D6): "${head}"`);
  }
}

export function parseCategory(c: Checker, v: unknown, where: string): Category {
  const w = `${where} 분류`;
  const o = c.obj(v, w);
  if (o === null) return { major: "사회", minor: "" };
  c.keys(o, ["major", "minor", "isNewMinor"], w);
  const major = typeof o.major === "string" ? o.major : "";
  const minor = c.text(o, "minor", "소분류", w);
  if (!isMajor(major)) {
    c.add(`${w} 대분류`, `"${major}"은(는) 7개 대분류(정치, 경제, 사회, 국제, IT·AI, 과학·건강, 문화·스포츠) 중 하나가 아니다`);
    return { major: "사회", minor };
  }
  const cat: Category = { major, minor };
  if (minor !== "" && isNewMinor(major, minor)) cat.isNewMinor = true;
  return cat;
}

function parseSources(c: Checker, o: Obj, where: string, needPrimary: boolean): Source[] {
  const list = c.arr(o, "sources", "출처", where);
  if (list.length === 0) c.add(`${where} 출처`, "1개 이상이어야 한다");
  const sources: Source[] = [];
  list.forEach((raw, i) => {
    const w = `${where} 출처 ${i + 1}`;
    const s = c.obj(raw, w);
    if (s === null) return;
    c.keys(s, ["name", "url", "publishedAt", "publishedAtEstimated", "imageUrl", "primary"], w);
    const src: Source = {
      name: c.text(s, "name", "매체명", w),
      url: c.text(s, "url", "원문 링크", w),
      publishedAt: c.text(s, "publishedAt", "발행일", w),
    };
    if (src.url !== "" && !isHttpUrl(src.url)) c.add(`${w} 원문 링크`, `http/https 주소가 아니다: ${src.url}`);
    else if (isRedirectUrl(src.url)) c.add(`${w} 원문 링크`, `${REDIRECT_WHY}: ${src.url}`);
    if (src.publishedAt !== "" && !isValidDate(src.publishedAt)) c.add(`${w} 발행일`, `YYYY-MM-DD 형식의 날짜가 아니다: ${src.publishedAt}`);
    const image = c.optText(s, "imageUrl", "이미지 주소", w);
    if (image !== undefined) {
      if (!isHttpUrl(image)) c.add(`${w} 이미지 주소`, `http/https 주소가 아니다: ${image}`);
      else if (isRedirectUrl(image)) c.add(`${w} 이미지 주소`, `${REDIRECT_WHY}: ${image}`);
      src.imageUrl = image;
    }
    if (s.primary !== undefined && s.primary !== null && typeof s.primary !== "boolean") c.add(`${w} 대표 출처`, "true/false여야 한다");
    if (s.primary === true) src.primary = true;
    if (s.publishedAtEstimated !== undefined && s.publishedAtEstimated !== null) {
      if (s.publishedAtEstimated !== true) c.add(`${w} 발행일 추정`, "있으면 true여야 한다(추정이 아니면 항목을 뺀다)");
      else src.publishedAtEstimated = true;
    }
    sources.push(src);
  });
  if (needPrimary) {
    const primaries = sources.filter((s) => s.primary === true).length;
    if (primaries !== 1) c.add(`${where} 대표 출처`, `${primaries}개 (정확히 1개여야 한다)`);
  }
  return sources;
}

function parseTopStory(c: Checker, raw: unknown, section: SectionName, index: number): TopStory | null {
  const o = c.obj(raw, `${section} 섹션 주요 뉴스 ${index + 1}번째`);
  if (o === null) return null;
  const rank = typeof o.rank === "number" ? o.rank : NaN;
  const w = Number.isInteger(rank) ? `${section} 섹션 ${rank}위` : `${section} 섹션 주요 뉴스 ${index + 1}번째`;
  c.keys(o, ["rank", "title", "summary", "whyItMatters", "background", "keyFacts", "analogy", "outlook", "confidence", "devCheckpoint", "category", "sources"], w);
  const facts = c.arr(o, "keyFacts", "핵심 사실", w);
  c.count(facts.length, 3, 5, `${w} 핵심 사실`);
  const keyFacts = facts.map((f, i) => {
    if (typeof f !== "string" || f.trim() === "") c.add(`${w} 핵심 사실 ${i + 1}`, "비어 있으면 안 된다");
    return typeof f === "string" ? f : "";
  });
  const confidence = o.confidence;
  if (typeof confidence !== "string" || !(CONFIDENCE_LEVELS as readonly string[]).includes(confidence)) {
    c.add(`${w} 확인 수준`, `"여러 출처 확인" 또는 "보도에 따르면"이어야 한다`);
  }
  const story: TopStory = {
    rank,
    title: c.text(o, "title", "제목", w),
    summary: c.text(o, "summary", "한 줄 요약", w),
    whyItMatters: c.text(o, "whyItMatters", "왜 중요한가", w),
    background: c.text(o, "background", "배경", w),
    keyFacts,
    outlook: c.text(o, "outlook", "앞으로 볼 것", w),
    confidence: (typeof confidence === "string" ? confidence : "보도에 따르면") as Confidence,
    category: parseCategory(c, o.category, w),
    sources: parseSources(c, o, w, true),
  };
  const analogy = c.optText(o, "analogy", "비유", w);
  if (analogy !== undefined) story.analogy = analogy;
  const dev = c.optText(o, "devCheckpoint", "개발자 체크 포인트", w);
  if (dev !== undefined) {
    if (section !== "IT·AI") c.add(`${w} 개발자 체크 포인트`, "IT·AI 섹션에서만 쓸 수 있다");
    story.devCheckpoint = dev;
  }
  if (story.confidence === "여러 출처 확인" && story.sources.length < 2) {
    c.add(`${w} 확인 수준`, `"여러 출처 확인"인데 출처가 ${story.sources.length}개다(2개 이상이어야 한다)`);
  }
  for (const [label, text] of [
    ["제목", story.title],
    ["한 줄 요약", story.summary],
    ["왜 중요한가", story.whyItMatters],
    ["배경", story.background],
    ["비유", story.analogy],
    ["앞으로 볼 것", story.outlook],
    ["개발자 체크 포인트", story.devCheckpoint],
  ] as const) {
    checkQuotes(c, text, `${w} ${label}`);
  }
  keyFacts.forEach((f, i) => checkQuotes(c, f, `${w} 핵심 사실 ${i + 1}`));
  return story;
}

function parseShortNews(c: Checker, raw: unknown, section: SectionName, index: number): ShortNews | null {
  const w = `${section} 섹션 짧은 소식 ${index + 1}`;
  const o = c.obj(raw, w);
  if (o === null) return null;
  c.keys(o, ["summary", "category", "sources"], w);
  const item: ShortNews = {
    summary: c.text(o, "summary", "한 줄 요약", w),
    category: parseCategory(c, o.category, w),
    sources: parseSources(c, o, w, false),
  };
  checkQuotes(c, item.summary, `${w} 한 줄 요약`);
  return item;
}

function parseSection(c: Checker, raw: unknown, index: number): Section | null {
  const o = c.obj(raw, `섹션 ${index + 1}번째`);
  if (o === null) return null;
  const expected = SECTIONS[index];
  const name = o.name;
  if (name !== expected) {
    c.add(`섹션 ${index + 1}번째`, `"${String(name)}"이다. 섹션은 한국, 세계, IT·AI 순서여야 한다`);
  }
  const sname = (typeof name === "string" && (SECTIONS as readonly string[]).includes(name) ? name : (expected ?? "한국")) as SectionName;
  const w = `${sname} 섹션`;
  c.keys(o, ["name", "flow", "topStories", "shortNews", "unverified"], w);
  const flow = c.text(o, "flow", "흐름 한 줄", w);
  checkQuotes(c, flow, `${w} 흐름 한 줄`);

  const topRaw = c.arr(o, "topStories", "주요 뉴스", w);
  c.count(topRaw.length, 5, 10, `${w} 주요 뉴스`);
  const topStories = topRaw.map((s, i) => parseTopStory(c, s, sname, i)).filter((s): s is TopStory => s !== null);
  const ranks = topStories.map((s) => s.rank);
  const expectedRanks = topStories.map((_, i) => i + 1);
  if (ranks.join(",") !== expectedRanks.join(",")) {
    c.add(`${w} 주요 뉴스 순위`, `[${ranks.join(", ")}]이다. 1부터 빠짐없이 차례로 이어져야 한다`);
  }

  const shortRaw = o.shortNews === undefined ? [] : c.arr(o, "shortNews", "짧은 소식", w);
  c.count(shortRaw.length, 0, 5, `${w} 짧은 소식`);
  const shortNews = shortRaw.map((s, i) => parseShortNews(c, s, sname, i)).filter((s): s is ShortNews => s !== null);

  const section: Section = { name: sname, flow, topStories, shortNews };
  const unverified = c.optText(o, "unverified", "확인되지 않은 내용", w);
  if (unverified !== undefined) {
    checkQuotes(c, unverified, `${w} 확인되지 않은 내용`);
    section.unverified = unverified;
  }
  return section;
}

/** 브리프 데이터를 검사한다. expectedDate는 지금 처리 중인 대상일이다. */
export function validateBrief(input: unknown, expectedDate: string): ValidateResult {
  const c = new Checker();
  const o = c.obj(input, "브리프 전체");
  if (o === null) return { ok: false, violations: c.violations };
  const w = "브리프 전체";
  c.keys(o, ["targetDate", "headline", "keywords", "sections"], w);
  const targetDate = c.text(o, "targetDate", "대상일", w);
  if (targetDate !== "" && targetDate !== expectedDate) c.add(`${w} 대상일`, `${targetDate}이다. 처리 중인 대상일 ${expectedDate}와 같아야 한다`);
  const headline = c.text(o, "headline", "오늘의 한 문장", w);
  checkQuotes(c, headline, `${w} 오늘의 한 문장`);
  const kw = c.arr(o, "keywords", "키워드", w);
  c.count(kw.length, 3, 5, `${w} 키워드`);
  const keywords = kw.map((k, i) => {
    if (typeof k !== "string" || k.trim() === "") c.add(`${w} 키워드 ${i + 1}`, "비어 있으면 안 된다");
    const s = typeof k === "string" ? k : "";
    checkQuotes(c, s, `${w} 키워드 ${i + 1}`);
    return s;
  });
  const secRaw = c.arr(o, "sections", "섹션", w);
  if (secRaw.length !== SECTIONS.length) c.add(`${w} 섹션`, `${secRaw.length}개다. 한국, 세계, IT·AI 세 개가 이 순서로 있어야 한다`);
  const sections = secRaw.map((s, i) => parseSection(c, s, i)).filter((s): s is Section => s !== null);

  // 같은 날짜에서 두 주요 뉴스의 대표 출처 링크가 같으면 같은 사건을 두 번 둔 것으로 본다(4.2-7)
  const seen = new Map<string, string>();
  for (const sec of sections) {
    for (const story of sec.topStories) {
      const primary = story.sources.find((s) => s.primary === true);
      if (!primary || primary.url === "") continue;
      const here = `${sec.name} 섹션 ${story.rank}위`;
      const prev = seen.get(primary.url);
      if (prev !== undefined) c.add(`${here} 대표 출처`, `${prev}와 대표 출처 링크가 같다(같은 사건은 주요 뉴스로 한 번만 둔다): ${primary.url}`);
      else seen.set(primary.url, here);
    }
  }

  // 한 매체가 주요 뉴스 대표 출처의 절반을 넘으면 거부한다(1.5단계 R2)
  const brief: Brief = { targetDate, headline, keywords, sections };
  const skew = findSkew(primaryUrls(brief).filter(isHttpUrl));
  if (skew !== null) {
    c.add(`${w} 대표 출처`, `한 매체(${skew.outlet})가 주요 뉴스 대표 출처 ${skew.total}건 중 ${skew.count}건이다(절반 이하여야 한다). 다른 매체의 기사로 대표 출처를 바꾼다`);
  }

  if (c.violations.length > 0) return { ok: false, violations: c.violations };
  return { ok: true, brief };
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `- ${v.where}: ${v.why}`).join("\n");
}
