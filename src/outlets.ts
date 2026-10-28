import type { Brief } from "./brief.ts";

// 우선 출처 목록과 매체 묶기(1.5단계 R5, 명세서 2.3). 출처 링크의 도메인으로 판별한다.
// 도메인은 하위 도메인을 포함한다. 한 매체에 도메인이 여럿이면 같은 매체로 묶는다.

export interface Outlet {
  name: string;
  domains: string[];
}

export const PRIORITY_OUTLETS: Outlet[] = [
  // 통신사
  { name: "연합뉴스", domains: ["yna.co.kr"] },
  { name: "뉴시스", domains: ["newsis.com"] },
  { name: "뉴스1", domains: ["news1.kr"] },
  { name: "Reuters", domains: ["reuters.com"] },
  { name: "AP", domains: ["apnews.com"] },
  { name: "AFP", domains: ["afp.com"] },
  { name: "Bloomberg", domains: ["bloomberg.com"] },
  { name: "교도통신", domains: ["kyodonews.net"] },
  // 국내 일간지
  { name: "조선일보", domains: ["chosun.com"] },
  { name: "중앙일보", domains: ["joongang.co.kr"] },
  { name: "동아일보", domains: ["donga.com"] },
  { name: "한겨레", domains: ["hani.co.kr"] },
  { name: "경향신문", domains: ["khan.co.kr"] },
  { name: "한국일보", domains: ["hankookilbo.com"] },
  { name: "국민일보", domains: ["kmib.co.kr"] },
  { name: "서울신문", domains: ["seoul.co.kr"] },
  { name: "매일경제", domains: ["mk.co.kr"] },
  { name: "한국경제", domains: ["hankyung.com"] },
  // 국내 방송
  { name: "KBS", domains: ["kbs.co.kr"] },
  { name: "MBC", domains: ["imbc.com"] },
  { name: "SBS", domains: ["sbs.co.kr"] },
  { name: "YTN", domains: ["ytn.co.kr"] },
  { name: "JTBC", domains: ["jtbc.co.kr"] },
  { name: "연합뉴스TV", domains: ["yonhapnewstv.co.kr"] },
  // 해외 일간지·방송
  { name: "New York Times", domains: ["nytimes.com"] },
  { name: "Washington Post", domains: ["washingtonpost.com"] },
  { name: "Wall Street Journal", domains: ["wsj.com"] },
  { name: "Financial Times", domains: ["ft.com"] },
  { name: "Guardian", domains: ["theguardian.com"] },
  { name: "Economist", domains: ["economist.com"] },
  { name: "BBC", domains: ["bbc.com", "bbc.co.uk"] },
  { name: "CNN", domains: ["cnn.com"] },
  { name: "NPR", domains: ["npr.org"] },
  { name: "NHK", domains: ["nhk.or.jp"] },
  { name: "Al Jazeera", domains: ["aljazeera.com"] },
  { name: "DW", domains: ["dw.com"] },
  { name: "France 24", domains: ["france24.com"] },
  { name: "Nikkei", domains: ["nikkei.com"] },
  { name: "SCMP", domains: ["scmp.com"] },
  // IT 전문매체
  { name: "The Verge", domains: ["theverge.com"] },
  { name: "TechCrunch", domains: ["techcrunch.com"] },
  { name: "Ars Technica", domains: ["arstechnica.com"] },
  { name: "Wired", domains: ["wired.com"] },
  { name: "전자신문", domains: ["etnews.com"] },
  { name: "지디넷코리아", domains: ["zdnet.co.kr"] },
  // IT 기업 공식 발표
  { name: "OpenAI", domains: ["openai.com"] },
  { name: "Anthropic", domains: ["anthropic.com"] },
  { name: "Google", domains: ["blog.google", "deepmind.google"] },
  { name: "Microsoft", domains: ["microsoft.com"] },
  { name: "Apple", domains: ["apple.com"] },
  { name: "NVIDIA", domains: ["nvidia.com"] },
  { name: "Meta", domains: ["about.fb.com", "meta.com"] },
  { name: "Samsung", domains: ["samsung.com"] },
  { name: "GitHub", domains: ["github.blog"] },
  { name: "Amazon", domains: ["aboutamazon.com"] },
];

/** 정부·국제기구 도메인. 접미사가 맞으면 우선 출처지만, 매체 묶음은 등록 도메인 단위다(예외) */
export const GOVERNMENT_DOMAINS = ["go.kr", "korea.kr", "gov", "gov.uk", "europa.eu", "un.org", "who.int", "imf.org"];

// 나라 도메인 아래 2단계 접미사(co.kr, go.kr, co.uk, or.jp 등). 등록 도메인을 셋째 이름까지로 본다.
const SECOND_LEVEL = new Set(["co", "go", "or", "ne", "ac", "re", "pe", "com", "net", "org", "gov", "edu", "mil"]);

/** 링크의 호스트(소문자, 앞의 www. 제거). 주소가 아니면 null */
export function hostOf(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return null;
  }
}

function under(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** 등록 도메인: 대개 마지막 두 이름, 나라 도메인 2단계 접미사면 마지막 세 이름 */
export function registrableDomain(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2) return host;
  const tld = labels.at(-1)!;
  const second = labels.at(-2)!;
  const take = tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function outletOf(host: string): Outlet | undefined {
  return PRIORITY_OUTLETS.find((o) => o.domains.some((d) => under(host, d)));
}

/** 우선 출처 링크인지(R5) */
export function isPriorityUrl(url: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  return outletOf(host) !== undefined || GOVERNMENT_DOMAINS.some((d) => under(host, d));
}

/** 같은 매체를 묶는 열쇠: 목록의 매체면 매체 이름, 아니면 등록 도메인(R2, R5) */
export function outletKey(url: string): string | null {
  const host = hostOf(url);
  if (host === null) return null;
  return outletOf(host)?.name ?? registrableDomain(host);
}

export interface Skew {
  outlet: string;
  count: number;
  total: number;
}

/** 대표 출처 링크 중 한 매체가 절반을 넘으면 그 매체를 돌려준다(정확히 절반은 통과, R2) */
export function findSkew(urls: string[]): Skew | null {
  const counts = new Map<string, number>();
  let total = 0;
  for (const url of urls) {
    const key = outletKey(url);
    if (key === null) continue;
    total++;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  for (const [outlet, count] of counts) if (count * 2 > total) return { outlet, count, total };
  return null;
}

/** 브리프의 주요 뉴스 대표 출처 링크(섹션 순서대로) */
export function primaryUrls(brief: Brief): string[] {
  const urls: string[] = [];
  for (const sec of brief.sections) {
    for (const story of sec.topStories) {
      const primary = story.sources.find((s) => s.primary === true);
      if (primary && primary.url !== "") urls.push(primary.url);
    }
  }
  return urls;
}

/** 주요 뉴스 대표 출처 중 우선 출처 수(R6) */
export function priorityRatio(brief: Brief): { priority: number; total: number } {
  const urls = primaryUrls(brief);
  return { priority: urls.filter(isPriorityUrl).length, total: urls.length };
}
