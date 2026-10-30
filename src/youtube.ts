import { maskSecrets } from "./keys.ts";
import type { VideoBundle } from "./siteTypes.ts";

// 7단계 4.2: 영상 받기. YouTube Data API v3만 부른다. 키는 x-goog-api-key 헤더로 보내고 주소에 넣지 않는다(4.8-1).
// 한 실행이 쓰는 양에 상한을 둔다(검색 90번, 그 밖의 호출 2,000단위). 오류 글에는 주소(영상 ID가 든다)와 키를 넣지 않는다(4.8-1, 4.8-3).

export const YOUTUBE_BASE = "https://www.googleapis.com/youtube/v3/";
export const YOUTUBE_KEY_HEADER = "x-goog-api-key";
export const CHART_REGIONS = ["KR", "US"] as const;
/** 차트를 받는 카테고리: 정보성(뉴스·정치 25, 교육 27, 과학·기술 28, 비영리·사회운동 29)과, 지식 채널이 자주 고르는 엔터테인먼트 24·코미디 23. 그 밖의 카테고리와 전체 차트는 받지 않는다(2026-10-30 사용자 결정, V3을 고침) */
export const CHART_CATEGORIES: ReadonlySet<string> = new Set(["25", "27", "28", "29", "24", "23"]);
export type Region = (typeof CHART_REGIONS)[number];
/** 한 실행의 상한(4.2-2). 하루 한도는 검색 100번, 그 밖의 호출 10,000단위 */
export const DEFAULT_LIMITS = { searches: 90, units: 2000 };
/** 4분(240초) 미만은 숏폼으로 뺀다 */
export const MIN_SECONDS = 240;
/** 검색 기간: 실행한 시각 48시간 전 이후 */
export const SEARCH_HOURS = 48;
/** 후보 목록에 넣는 설명 앞부분 길이 */
export const DESCRIPTION_CHARS = 120;
/** 검색 한 번에 받는 결과 수. 관련도 순 앞쪽만 본다(50개씩 받으면 거른 뒤 후보가 2,700개를 넘었다. 2026-10-30 시험 실행) */
export const SEARCH_RESULTS = 20;

export interface YoutubeResponse {
  status: number;
  body: string;
}
/** YouTube 요청(주소와 헤더). 테스트가 가짜로 바꾼다 */
export type YoutubeHttp = (url: string, headers: Record<string, string>) => Promise<YoutubeResponse>;

const TIMEOUT_MS = 30_000;

export const fetchYoutube: YoutubeHttp = async (url, headers) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json", ...headers } });
  return { status: r.status, body: await r.text() };
};

// ---- 주제·AI 검색 키워드(V4). 분야는 11개로 고정하고 빼거나 합치지 않는다. 키워드는 `|`로 묶어 한 번에 검색한다 ----

export type SearchLang = "ko" | "en";

export interface SearchTopic {
  /** 분야 이름(V4의 이름 그대로, AI는 "AI") */
  name: string;
  /** AI 검색이면 true(묶음 ai-ko·ai-en) */
  ai: boolean;
  keywords: Record<SearchLang, string[]>;
}

/** V4의 11개 분야 이름(순서 그대로) */
export const SEARCH_FIELDS = ["경제·금융", "산업·기업", "국제 정세", "과학", "우주", "의학·건강", "기술", "역사", "사회·다큐", "기후·환경·에너지", "인문·교양"] as const;

/** 분야와 키워드 목록(코드의 한 곳, 4.2-4) */
export const SEARCH_TOPICS: readonly SearchTopic[] = [
  { name: "경제·금융", ai: false, keywords: { ko: ["경제 다큐", "경제사", "경제학 강의", "경제 원리"], en: ["economics explained", "economic history", "how the economy works"] } },
  { name: "산업·기업", ai: false, keywords: { ko: ["기업 다큐", "산업 다큐", "기업의 역사", "산업 해설"], en: ["business documentary", "company history", "industry explained"] } },
  { name: "국제 정세", ai: false, keywords: { ko: ["국제 정세 해설", "지정학", "세계 정세 분석", "국제관계"], en: ["geopolitics explained", "geopolitics documentary", "international relations"] } },
  { name: "과학", ai: false, keywords: { ko: ["과학 다큐", "과학 이야기", "과학 강연"], en: ["science documentary", "science explained"] } },
  { name: "우주", ai: false, keywords: { ko: ["우주 다큐", "천문학", "우주 이야기"], en: ["space documentary", "astronomy explained", "space exploration"] } },
  { name: "의학·건강", ai: false, keywords: { ko: ["의학 다큐", "건강 다큐", "뇌과학", "의학 강연"], en: ["medicine explained", "health science", "neuroscience", "medical documentary"] } },
  { name: "기술", ai: false, keywords: { ko: ["기술 다큐", "공학 원리", "기술 해설", "과학기술 이야기"], en: ["technology explained", "how it works engineering", "tech documentary"] } },
  { name: "역사", ai: false, keywords: { ko: ["역사 다큐", "역사 이야기", "역사스페셜", "한국사 강의"], en: ["history documentary", "history explained"] } },
  { name: "사회·다큐", ai: false, keywords: { ko: ["다큐", "다큐멘터리", "시사기획", "추적"], en: ["documentary", "investigative documentary", "social issues documentary"] } },
  { name: "기후·환경·에너지", ai: false, keywords: { ko: ["기후 다큐", "환경 다큐멘터리", "에너지 다큐", "기후위기"], en: ["climate change explained", "energy transition", "environment documentary"] } },
  { name: "인문·교양", ai: false, keywords: { ko: ["인문학 강의", "철학 강의", "심리학 강연", "인문학 이야기"], en: ["philosophy", "psychology explained", "history of ideas", "lecture"] } },
  { name: "AI", ai: true, keywords: { ko: ["AI", "인공지능", "LLM", "AI 에이전트", "챗GPT", "클로드", "제미나이"], en: ["AI", "LLM", "AI agent", "OpenAI", "Anthropic", "Claude", "Gemini"] } },
];

/** 4분 이상을 둘로 나눠 검색한다(medium 4~20분, long 20분 넘음) */
export const SEARCH_DURATIONS = ["medium", "long"] as const;
const LANG_REGION: Record<SearchLang, Region> = { ko: "KR", en: "US" };

export interface SearchSpec {
  topic: string;
  lang: SearchLang;
  duration: (typeof SEARCH_DURATIONS)[number];
  bundle: VideoBundle;
  q: string;
}

/** 한 실행의 검색 목록(분야 × 언어 × 길이 구간) */
export function searchSpecs(topics: readonly SearchTopic[] = SEARCH_TOPICS): SearchSpec[] {
  const out: SearchSpec[] = [];
  for (const t of topics) {
    for (const lang of ["ko", "en"] as const) {
      const bundle: VideoBundle = t.ai ? (lang === "ko" ? "ai-ko" : "ai-en") : lang === "ko" ? "kr" : "us";
      for (const duration of SEARCH_DURATIONS) out.push({ topic: t.name, lang, duration, bundle, q: t.keywords[lang].join("|") });
    }
  }
  return out;
}

export function searchUrl(s: SearchSpec, publishedAfter: string): string {
  const p = new URLSearchParams({
    part: "snippet",
    type: "video",
    q: s.q,
    order: "relevance",
    relevanceLanguage: s.lang,
    regionCode: LANG_REGION[s.lang],
    videoDuration: s.duration,
    publishedAfter,
    maxResults: String(SEARCH_RESULTS),
  });
  return `${YOUTUBE_BASE}search?${p.toString()}`;
}

// ---- 요청과 오류 ----

export type ErrorKind = "quota" | "auth" | "notFound" | "retry" | "other";

export class YoutubeError extends Error {
  readonly kind: ErrorKind;
  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** 상한에 닿아 부르지 않았다 */
class LimitReached extends Error {}

const AUTH_REASONS = new Set(["keyInvalid", "keyExpired", "accessNotConfigured", "ipRefererBlocked", "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "authError", "unauthorized"]);

/** 할당량 관련 사유 모두(4.2-2): quotaExceeded, dailyLimitExceeded, rateLimitExceeded, userRateLimitExceeded 등 */
export function isQuotaReason(reason: string): boolean {
  return /quota|limitexceeded|ratelimit/i.test(reason);
}

interface ApiErrorBody {
  error?: { code?: number; message?: string; errors?: { reason?: string; message?: string }[]; details?: { reason?: string }[]; status?: string };
}

/** 오류 응답을 종류로 나눈다. 글에는 상태와 사유만 넣는다(메시지에 주소·키가 들어갈 수 있다) */
export function classifyError(status: number, body: string): YoutubeError {
  let j: ApiErrorBody = {};
  try {
    j = JSON.parse(body) as ApiErrorBody;
  } catch {
    // 형식이 맞지 않는 오류 응답
  }
  const reasons = [...(j.error?.errors ?? []).map((e) => e.reason ?? ""), ...(j.error?.details ?? []).map((d) => d.reason ?? "")].filter((r) => r !== "");
  const label = `HTTP ${status}${reasons.length > 0 ? ` ${[...new Set(reasons)].join(", ")}` : ""}`;
  if (status === 429 || reasons.some(isQuotaReason)) return new YoutubeError("quota", `할당량 초과(${label})`);
  if (status === 401 || reasons.some((r) => AUTH_REASONS.has(r)) || /api key/i.test(j.error?.message ?? "")) return new YoutubeError("auth", `키 확인 필요(${label})`);
  if (reasons.some((r) => r === "videoChartNotFound" || r === "notFound")) return new YoutubeError("notFound", label);
  if (status >= 500) return new YoutubeError("retry", label);
  return new YoutubeError("other", label);
}

export interface Usage {
  searches: number;
  units: number;
}

export interface ClientOptions {
  http: YoutubeHttp;
  key: string;
  limits?: Usage;
  /** 다시 시도 횟수(처음 빼고) */
  retries?: number;
  retryGapMs?: number;
}

/** 쓴 양을 세며 부르는 클라이언트. 시도마다 한 번으로 센다(다시 시도도 할당량을 쓴다) */
export class YoutubeClient {
  readonly used: Usage = { searches: 0, units: 0 };
  private readonly o: ClientOptions;
  private readonly limits: Usage;
  constructor(o: ClientOptions) {
    this.o = o;
    this.limits = o.limits ?? DEFAULT_LIMITS;
  }

  /** search면 검색 한 번, 아니면 1단위 */
  async get(url: string, kind: "search" | "unit"): Promise<unknown> {
    const retries = this.o.retries ?? 2;
    for (let attempt = 0; ; attempt++) {
      if (kind === "search" ? this.used.searches >= this.limits.searches : this.used.units >= this.limits.units) throw new LimitReached();
      if (kind === "search") this.used.searches++;
      else this.used.units++;
      try {
        return await this.once(url);
      } catch (e) {
        const retryable = e instanceof YoutubeError ? e.kind === "retry" : !(e instanceof LimitReached);
        if (!retryable || attempt >= retries) throw this.clean(e);
        await new Promise((res) => setTimeout(res, (this.o.retryGapMs ?? 2000) * (attempt + 1)));
      }
    }
  }

  private async once(url: string): Promise<unknown> {
    const r = await this.o.http(url, { [YOUTUBE_KEY_HEADER]: this.o.key });
    if (r.status !== 200) throw classifyError(r.status, r.body);
    try {
      return JSON.parse(r.body) as unknown;
    } catch {
      throw new YoutubeError("retry", `응답이 JSON이 아니다(HTTP ${r.status})`);
    }
  }

  /** 오류 글에서 주소와 키를 뺀다 */
  private clean(e: unknown): Error {
    if (e instanceof YoutubeError || e instanceof LimitReached) return e;
    const err = e as Error;
    const why = err.name === "TimeoutError" ? "시간 초과" : `네트워크 오류(${err.message.replace(/https?:\/\/\S+/g, "<주소>")})`;
    return new YoutubeError("other", maskSecrets(why, [this.o.key, encodeURIComponent(this.o.key)]));
  }
}

// ---- 받은 영상 ----

export interface RawVideo {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
  description: string;
  categoryId: string | null;
  language: string | null;
  seconds: number | null;
  thumb: string;
  liveBroadcastContent: string;
  liveRecord: boolean;
  vertical: boolean;
}

interface VideoItem {
  id?: string | { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    description?: string;
    categoryId?: string;
    defaultAudioLanguage?: string;
    defaultLanguage?: string;
    liveBroadcastContent?: string;
    thumbnails?: Record<string, { url?: string; width?: number; height?: number }>;
  };
  contentDetails?: { duration?: string };
  liveStreamingDetails?: { actualStartTime?: string; scheduledStartTime?: string };
  player?: { embedWidth?: string | number; embedHeight?: string | number };
}

/** ISO 8601 길이(PT1H2M3S, P1DT2H)를 초로. 모르는 모양이면 null */
export function parseDuration(d: string | undefined): number | null {
  if (d === undefined) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(d);
  if (!m) return null;
  const [, days, h, mi, s] = m;
  return Number(days ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 + Math.floor(Number(s ?? 0));
}

function thumbOf(sn: VideoItem["snippet"]): string {
  const t = sn?.thumbnails ?? {};
  return t.medium?.url ?? t.high?.url ?? t.default?.url ?? t.standard?.url ?? t.maxres?.url ?? "";
}

/** videos.list 항목 하나. 세로 영상은 player의 embedWidth·embedHeight(maxWidth를 주면 영상 비율을 따른다)로 판별한다 */
export function toRawVideo(item: VideoItem): RawVideo | null {
  const id = typeof item.id === "string" ? item.id : item.id?.videoId;
  const sn = item.snippet;
  if (typeof id !== "string" || id === "" || sn === undefined) return null;
  const w = Number(item.player?.embedWidth);
  const h = Number(item.player?.embedHeight);
  const live = sn.liveBroadcastContent ?? "none";
  return {
    videoId: id,
    title: sn.title ?? "",
    channel: sn.channelTitle ?? "",
    publishedAt: sn.publishedAt ?? "",
    description: sn.description ?? "",
    categoryId: sn.categoryId ?? null,
    language: sn.defaultAudioLanguage ?? sn.defaultLanguage ?? null,
    seconds: parseDuration(item.contentDetails?.duration),
    thumb: thumbOf(sn),
    liveBroadcastContent: live,
    liveRecord: item.liveStreamingDetails !== undefined && live === "none",
    vertical: Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > w,
  };
}

/** 상세에 쓰는 part와 세로 판별용 maxWidth */
const VIDEO_PARTS = "snippet,contentDetails,liveStreamingDetails,player";
const PLAYER_WIDTH = "1000";

export function chartUrl(region: Region, category: string, pageToken: string | null): string {
  const p = new URLSearchParams({ part: VIDEO_PARTS, chart: "mostPopular", regionCode: region, videoCategoryId: category, maxResults: "50", maxWidth: PLAYER_WIDTH });
  if (pageToken !== null) p.set("pageToken", pageToken);
  return `${YOUTUBE_BASE}videos?${p.toString()}`;
}

export function categoriesUrl(region: Region): string {
  return `${YOUTUBE_BASE}videoCategories?${new URLSearchParams({ part: "snippet", regionCode: region }).toString()}`;
}

export function detailsUrl(ids: string[]): string {
  return `${YOUTUBE_BASE}videos?${new URLSearchParams({ part: VIDEO_PARTS, id: ids.join(","), maxResults: "50", maxWidth: PLAYER_WIDTH }).toString()}`;
}

// ---- 받기 전체(4.2-3~4.2-5) ----

export type ExcludeReason = "already" | "live" | "short" | "vertical" | "unavailable";
export const EXCLUDE_LABELS: Record<ExcludeReason, string> = {
  already: "이미 추천함(최근 30일)",
  live: "생방송 중·예정",
  short: "4분 미만",
  vertical: "세로 영상",
  unavailable: "상세 없음",
};

export interface FetchedVideo extends RawVideo {
  bundles: VideoBundle[];
  sources: string[];
}

export interface ChartReport {
  region: Region;
  /** 받은 차트 수(한 페이지라도 받은 카테고리 차트) */
  fetched: number;
  /** 차트가 없어 건너뛴 카테고리 ID(숫자) */
  skipped: string[];
}

export interface FetchReport {
  status: "ok" | "partial" | "failed";
  /** 실패나 일부 실패의 이유(지역과 카테고리 ID, 분야 이름만. 영상 정보 없음) */
  failures: string[];
  /** 상한에 닿아 받지 못한 것 */
  missed: string[];
  keyProblem: boolean;
  quota: boolean;
  charts: ChartReport[];
  /** 분야·언어마다 받은 검색 결과 수(키: `분야 ko|en`) */
  searchResults: Record<string, number>;
  usage: Usage;
  /** 거르기 전(중복을 뺀) 영상 수와 이유별로 뺀 수 */
  before: number;
  excluded: Record<ExcludeReason, number>;
  videos: FetchedVideo[];
}

export interface FetchVideosInput {
  client: YoutubeClient;
  now: Date;
  /** DB에 남은 최근 30일 영상 ID */
  recent: Set<string>;
  topics?: readonly SearchTopic[];
}

interface Collected {
  raw: RawVideo | null;
  bundles: Set<VideoBundle>;
  sources: string[];
}

const LANG_LABEL: Record<SearchLang, string> = { ko: "한국어", en: "영어" };

/** 차트와 검색을 받고, 상세를 받아 거른다. 할당량·인증 오류가 나면 바로 멈추고 실패로 둔다 */
export async function fetchVideos(input: FetchVideosInput): Promise<FetchReport> {
  const { client } = input;
  const report: FetchReport = {
    status: "ok",
    failures: [],
    missed: [],
    keyProblem: false,
    quota: false,
    charts: [],
    searchResults: {},
    usage: client.used,
    before: 0,
    excluded: { already: 0, live: 0, short: 0, vertical: 0, unavailable: 0 },
    videos: [],
  };
  const found = new Map<string, Collected>();
  let succeeded = 0;
  let stopped = false;
  const add = (id: string, raw: RawVideo | null, bundle: VideoBundle, source: string) => {
    let c = found.get(id);
    if (!c) found.set(id, (c = { raw: null, bundles: new Set(), sources: [] }));
    if (raw !== null && c.raw === null) c.raw = raw;
    c.bundles.add(bundle);
    if (!c.sources.includes(source)) c.sources.push(source);
  };
  /** 오류를 기록한다. 멈춰야 하면(할당량, 키) true */
  const fail = (e: unknown, what: string, missedLabel: string): boolean => {
    if (e instanceof LimitReached) {
      report.missed.push(missedLabel);
      return false;
    }
    const err = e instanceof YoutubeError ? e : new YoutubeError("other", (e as Error).message);
    report.failures.push(`${what}: ${err.message}`);
    if (err.kind === "quota") report.quota = true;
    if (err.kind === "auth") report.keyProblem = true;
    return err.kind === "quota" || err.kind === "auth";
  };

  // ① 차트: 지역마다 카테고리 목록 중 CHART_CATEGORIES에 든 것만, 끝 페이지까지
  for (const region of CHART_REGIONS) {
    if (stopped) break;
    const chart: ChartReport = { region, fetched: 0, skipped: [] };
    report.charts.push(chart);
    const bundle: VideoBundle = region === "KR" ? "kr" : "us";
    let categories: string[] = [];
    try {
      const j = (await client.get(categoriesUrl(region), "unit")) as { items?: { id?: string }[] };
      categories = (j.items ?? []).map((x) => String(x.id ?? "")).filter((x) => CHART_CATEGORIES.has(x));
      succeeded++;
    } catch (e) {
      if (fail(e, `${region} 카테고리 목록`, `${region} 카테고리 목록`)) stopped = true;
    }
    for (const category of categories) {
      if (stopped) break;
      const label = `${region} ${category}`;
      let token: string | null = null;
      let pages = 0;
      for (;;) {
        try {
          const j = (await client.get(chartUrl(region, category, token), "unit")) as { items?: VideoItem[]; nextPageToken?: string };
          pages++;
          succeeded++;
          for (const item of j.items ?? []) {
            const raw = toRawVideo(item);
            if (raw !== null) add(raw.videoId, raw, bundle, `${region} 차트 ${category}`);
          }
          token = j.nextPageToken ?? null;
          if (token === null) break;
        } catch (e) {
          if (e instanceof YoutubeError && e.kind === "notFound") {
            if (pages === 0) chart.skipped.push(category);
            else report.failures.push(`${label} 차트: ${e.message}`);
          } else if (fail(e, `${label} 차트`, `${label} 차트`)) stopped = true;
          break;
        }
      }
      if (pages > 0) chart.fetched++;
    }
  }

  // ② 주제·AI 검색
  const publishedAfter = new Date(input.now.getTime() - SEARCH_HOURS * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const s of searchSpecs(input.topics)) {
    if (stopped) break;
    const key = `${s.topic} ${s.lang}`;
    report.searchResults[key] ??= 0;
    const label = `${LANG_LABEL[s.lang]} 검색 ${s.topic}(${s.duration})`;
    try {
      const j = (await client.get(searchUrl(s, publishedAfter), "search")) as { items?: VideoItem[] };
      succeeded++;
      for (const item of j.items ?? []) {
        const id = typeof item.id === "object" ? item.id?.videoId : undefined;
        if (typeof id !== "string" || id === "") continue;
        report.searchResults[key]++;
        add(id, null, s.bundle, `${LANG_LABEL[s.lang]} 검색 ${s.topic}`);
      }
    } catch (e) {
      if (fail(e, label, label)) stopped = true;
    }
  }

  report.before = found.size;
  // ③ 이미 추천한 영상은 상세를 받기 전에 뺀다
  for (const id of [...found.keys()]) {
    if (input.recent.has(id)) {
      found.delete(id);
      report.excluded.already++;
    }
  }
  // 상세: 검색으로만 받은 영상(차트 영상은 이미 상세가 있다)
  const need = [...found].filter(([, c]) => c.raw === null).map(([id]) => id);
  let detailCalls = 0;
  let detailFailed = 0;
  for (let i = 0; i < need.length && !stopped; i += 50) {
    const batch = need.slice(i, i + 50);
    detailCalls++;
    try {
      const j = (await client.get(detailsUrl(batch), "unit")) as { items?: VideoItem[] };
      for (const item of j.items ?? []) {
        const raw = toRawVideo(item);
        const c = raw === null ? undefined : found.get(raw.videoId);
        if (raw !== null && c) c.raw = raw;
      }
    } catch (e) {
      detailFailed++;
      if (fail(e, `상세 ${i / 50 + 1}번째 묶음`, `상세 ${i / 50 + 1}번째 묶음`)) stopped = true;
    }
  }

  for (const [, c] of found) {
    const r = c.raw;
    let why: ExcludeReason | null = null;
    if (r === null || r.seconds === null) why = "unavailable";
    else if (r.liveBroadcastContent === "live" || r.liveBroadcastContent === "upcoming") why = "live";
    else if (r.seconds < MIN_SECONDS) why = "short";
    else if (r.vertical) why = "vertical";
    if (why !== null) {
      report.excluded[why]++;
      continue;
    }
    report.videos.push({ ...r!, bundles: [...c.bundles], sources: c.sources });
  }

  const nothing = succeeded === 0 || (detailCalls > 0 && detailFailed === detailCalls && report.videos.length === 0);
  if (report.quota || report.keyProblem || nothing) {
    report.status = "failed";
    if (nothing && report.failures.length === 0) report.failures.push("받은 것이 없다");
    report.videos = [];
  } else if (report.failures.length > 0 || report.missed.length > 0) report.status = "partial";
  return report;
}
