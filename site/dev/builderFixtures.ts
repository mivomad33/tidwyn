// 9.8단계: 지어낸 빌더 사이트 데이터(로컬 화면 확인·테스트용). 내용은 모두 가짜다. fixtures.ts가 부른다.
// 실제 빌드(src/builderSite.ts)와 같은 모양의 파일을 만든다. 기본은 날짜마다 화면 상태 하나(4건, 1건, 긴 글, 0건 세 상태, 안내가 붙는 날, 다시 알림),
// full이면 모든 날짜에 칸별 상한 길이의 10건(도구 변화 4, 새 제품 3, 뜨는 저장소 3)이다(크기 측정용).
// 9.9단계: 앞의 10개 날짜는 9.9 이전 날짜(새 종류 상태 없음)로 두고, 그 뒤 날짜에 새 종류의 화면 상태를 하나씩 둔다.
import { BUILDER_FIELDS, builderItemKey, discoveryItemKey, type BuilderField, type BuilderStatus, type DiscoverKind, type KindStatus } from "../../src/builderTypes.ts";
import { compareSchedules, dayBuilderOf, scheduleRefChunkOf, siteFiles, type BuilderMonth, type DayBuilder, type IssueRef, type ScheduleIndex, type ScheduleItem, type ScheduleMonth, type ScheduleRefChunk, type SiteBuilderItem, type SiteDiscoveryItem } from "../../src/siteTypes.ts";
import { addDays, rng } from "./random.ts";

/** 날짜마다 화면 상태 하나를 둔 지어낸 빌더 데이터의 자리. 지어낸 날짜 수가 모자라면 null이다 */
export interface BuilderFixtureInfo {
  four: string | null;
  one: string | null;
  long: string | null;
  none: string | null;
  partial: string | null;
  failed: string | null;
  partialItems: string | null;
  failedItems: string | null;
  origin: string | null;
  /** 빌더 기록이 없는 날 */
  noRecord: string | null;
  /** 근거 뉴스와 이슈가 없고 빌더 항목에만 이어진 일정 */
  schedule: { id: number; name: string; due: string; date: string; key: string } | null;
  /** 세 종류 3건씩(정정됨, 라이선스 없음·판별 안 됨, 릴리스 세 상태, 관련 이슈) */
  three: string | null;
  /** 새 제품 한 종류만(도구 변화 기록 없음, 저장소 꺼짐) */
  onlyProduct: string | null;
  /** 세 종류 모두 칸별 상한 길이, 긴 `owner/name` */
  longKinds: string | null;
  /** 세 묶음 모두 확인함 0건 */
  allNone: string | null;
  /** 세 묶음 모두 받지 못함 0건 */
  allFailed: string | null;
  /** 도구 변화 0건, 새 제품 받지 못함·항목 있음, 저장소 기준값 쌓는 중 */
  mixed: string | null;
  /** 두 종류 모두 꺼짐이고 도구 변화 기록이 없다(탭 없음) */
  offOnly: string | null;
}

export interface BuilderFixtures {
  byDate: Map<string, DayBuilder>;
  months: BuilderMonth[];
  /** 일정 파일에 더할 빌더 일정 */
  schedule: ScheduleItem | null;
  info: BuilderFixtureInfo;
}

const SCHEDULE_ID = 900_000;
const SOURCE = "https://builder.example.com";
const NOISE_SYLLABLES = 100;

interface ItemInput extends Partial<SiteBuilderItem> {
  field: BuilderField;
  title: string;
}

interface Day {
  status: BuilderStatus | null;
  items: SiteBuilderItem[];
  discoveries?: SiteDiscoveryItem[];
  kinds?: Partial<Record<DiscoverKind, KindStatus>>;
}

const repoFacts = (over: Partial<NonNullable<SiteDiscoveryItem["repo"]>> = {}): NonNullable<SiteDiscoveryItem["repo"]> => ({ license: "MIT", pushedOn: "2026-10-20", release: { state: "found", date: "2026-09-01" }, stars: 12345, growth: 678.5, ...over });

function product(position: number, name: string, over: Partial<SiteDiscoveryItem> = {}): SiteDiscoveryItem {
  return { key: discoveryItemKey("product", position), kind: "product", name, url: `https://www.producthunt.com/products/fake-${position}`, purpose: "가짜 회의록을 정리하는 앱이다.", difference: "가짜메모와 달리 음성을 기기 안에서만 처리한다.", reason: "회의가 많은 개발자가 바로 써 볼 수 있어 골랐다.", issue: null, ...over };
}

function repo(position: number, name: string, over: Partial<SiteDiscoveryItem> = {}): SiteDiscoveryItem {
  return { key: discoveryItemKey("repo", position), kind: "repo", name, url: `https://github.com/${name}`, purpose: "터미널에서 가짜 코딩 에이전트의 작업을 나눠 돌리는 도구다.", difference: "가짜에이전트와 달리 작업마다 격리된 폴더를 쓴다.", reason: "별이 빠르게 늘고 있고 쓰임새가 분명해 골랐다.", issue: null, repo: repoFacts(), ...over };
}

function item(position: number, x: ItemInput): SiteBuilderItem {
  return {
    key: builderItemKey(position),
    whatChanged: `${x.title}. 가짜 공식 문서에 바뀐 내용이 올라왔다.`,
    who: "가짜 도구를 쓰는 개발자",
    action: "없음",
    why: "기본 설정에서 바로 영향이 있어 골랐다.",
    due: null,
    schedule: null,
    issue: null,
    sources: [{ name: "가짜 공식 문서", url: `${SOURCE}/${position}` }],
    reminderOf: null,
    ...x,
  };
}

const FILLER = ["가짜 도구의 기본 설정이 달라져 빌드 결과가 바뀔 수 있다", "지원 종료일 전에 가짜 모델 이름을 새 이름으로 옮겨야 한다", "가짜 패키지의 영향 버전을 쓰면 고친 버전으로 올려야 한다", "한도 계산 방식이 달라져 같은 호출에도 요금이 다를 수 있다", "새 권한 확인이 켜져 자동 실행 흐름이 멈출 수 있다"];

/** 정확히 n자가 되도록 지어낸 글을 잇는다 */
function fill(n: number, rand: () => number): string {
  let s = "";
  while (s.length < n) s += `${FILLER[Math.floor(rand() * FILLER.length)]} ${Math.floor(rand() * 1000)}. `;
  return s.slice(0, n - 1).trimEnd().padEnd(n - 1, "다") + ".";
}

/** 크기 측정용: 정확히 n자의 무작위 음절 글. 같은 문장이 되풀이되지 않아 실제 글(gzip 글자당 약 0.7B)보다 덜 압축된다 */
function noise(n: number, rand: () => number): string {
  let s = "";
  while (s.length < n) s += s.length % 5 === 4 ? " " : String.fromCharCode(0xac00 + Math.floor(rand() * NOISE_SYLLABLES) * 28);
  return s.slice(0, n - 1) + ".";
}

type Text = (n: number, rand: () => number) => string;

function fullItem(position: number, date: string, rand: () => number, text: Text): SiteBuilderItem {
  return item(position, {
    field: BUILDER_FIELDS[Math.floor(rand() * BUILDER_FIELDS.length)]!,
    title: text(60, rand),
    whatChanged: text(300, rand),
    who: text(100, rand),
    action: text(150, rand),
    why: text(100, rand),
    due: { date: addDays(date, 30 + position), state: position % 2 ? "confirmed" : "tentative" },
    sources: [1, 2].map((n) => ({ name: `가짜 공식 문서 ${n}`, url: `${SOURCE}/docs/${date}/${position}/${n}/${"x".repeat(40)}` })),
  });
}

function fullDay(date: string, rand: () => number, text: Text): Day {
  return { status: "checked", items: [1, 2, 3, 4].map((p) => fullItem(p, date, rand, text)), discoveries: [...[1, 2, 3].map((p) => fullProduct(p, date, rand, text)), ...[1, 2, 3].map((p) => fullRepo(p, date, rand, text))], kinds: { product: "checked", repo: "checked" } };
}

function fullProduct(position: number, date: string, rand: () => number, text: Text): SiteDiscoveryItem {
  return product(position, text(60, rand), { url: `https://www.producthunt.com/products/fake-${date}-${position}-${"x".repeat(40)}`, purpose: text(200, rand), difference: text(200, rand), reason: text(100, rand) });
}

function fullRepo(position: number, date: string, rand: () => number, text: Text): SiteDiscoveryItem {
  // GitHub의 owner 39자, name 100자가 상한이다
  const name = `fake-owner-${date}-${position}`.padEnd(39, "o") + "/" + `fake-repository-with-a-very-long-name-${Math.floor(rand() * 1e6)}`.padEnd(100, "n");
  return repo(position, name, { purpose: text(200, rand), difference: text(200, rand), reason: text(100, rand), repo: repoFacts({ license: "BSD-3-Clause-Attribution", stars: 123456, growth: 12345.5 }) });
}

export function fixtureBuilder(opts: { datesDesc: string[]; end: string; issue: IssueRef; full?: boolean }): BuilderFixtures {
  const { datesDesc, end, issue } = opts;
  const days = new Map<string, Day>();
  const empty: BuilderFixtureInfo = { four: null, one: null, long: null, none: null, partial: null, failed: null, partialItems: null, failedItems: null, origin: null, noRecord: null, schedule: null, three: null, onlyProduct: null, longKinds: null, allNone: null, allFailed: null, mixed: null, offOnly: null };
  let info = empty;
  let schedule: ScheduleItem | null = null;
  if (opts.full) {
    const rand = rng(20261101);
    for (const date of datesDesc) days.set(date, fullDay(date, rand, noise));
  } else {
    const rand = rng(20261101);
    const [four, one, long, none, partial, failed, partialItems, failedItems, origin, noRecord, three, onlyProduct, longKinds, allNone, allFailed, mixed, offOnly] = datesDesc;
    info = { four: four ?? null, one: one ?? null, long: long ?? null, none: none ?? null, partial: partial ?? null, failed: failed ?? null, partialItems: partialItems ?? null, failedItems: failedItems ?? null, origin: origin ?? null, noRecord: noRecord ?? null, schedule: null, three: three ?? null, onlyProduct: onlyProduct ?? null, longKinds: longKinds ?? null, allNone: allNone ?? null, allFailed: allFailed ?? null, mixed: mixed ?? null, offOnly: offOnly ?? null };
    if (four) {
      const due = addDays(end, 30);
      const name = "가짜모델 1 지원 종료";
      schedule = { id: SCHEDULE_ID, name, due, outcome: { status: "pending" }, major: "IT·AI", issue: null, issues: [], knownOn: four, first: null, builder: { date: four, key: builderItemKey(1) } };
      info.schedule = { id: SCHEDULE_ID, name, due, date: four, key: builderItemKey(1) };
      days.set(four, {
        status: "checked",
        items: [
          item(1, { field: "모델", title: "가짜모델 1의 지원 종료일이 확정됐다", action: "가짜모델 1을 호출하는 코드를 가짜모델 2로 옮긴다.", due: { date: due, state: "confirmed" }, schedule: SCHEDULE_ID, issue, sources: [{ name: "가짜 모델 문서", url: `${SOURCE}/models` }, { name: "가짜 공지", url: `${SOURCE}/notice` }] }),
          item(2, { field: "코딩 도구", title: "가짜코드 CLI가 가장 이른 종료일을 공지했다", action: "지금은 일정만 살펴본다.", due: { date: addDays(end, 90), state: "tentative" } }),
          item(3, { field: "보안", title: "가짜패키지 공지가 정정 뒤 다시 나왔다", action: "가짜패키지를 고친 버전으로 올린다.", corrections: [{ on: end, reason: "영향 버전을 1.2에서 1.3으로 바로잡았다." }] }),
          item(4, { field: "플랫폼", title: "가짜호스팅이 요금 계산 방식을 바꾼다", due: { date: addDays(end, 60).slice(0, 7), state: "tentative" } }),
        ],
      });
    }
    if (one) days.set(one, { status: "checked", items: [item(1, { field: "프레임워크", title: "가짜프레임워크 다시 알림 항목", due: { date: addDays(end, 5), state: "confirmed" }, action: "가짜프레임워크 3으로 올린다.", reminderOf: partialItems ? { date: partialItems, key: builderItemKey(1) } : null })] });
    if (long) days.set(long, { status: "checked", items: [1, 2, 3, 4].map((p) => fullItem(p, long, rand, fill)) });
    if (none) days.set(none, { status: "checked", items: [] });
    if (partial) days.set(partial, { status: "partial", items: [] });
    if (failed) days.set(failed, { status: "failed", items: [] });
    if (partialItems) days.set(partialItems, { status: "partial", items: [item(1, { field: "프레임워크", title: "가짜프레임워크 3 정식판이 나왔다" })] });
    if (failedItems) days.set(failedItems, { status: "failed", items: [item(1, { field: "모델", title: "가짜 다시 알림만 실린 날", reminderOf: origin ? { date: origin, key: builderItemKey(1) } : null })] });
    if (origin) days.set(origin, { status: "checked", items: [item(1, { field: "모델", title: "가짜모델 0 종료 공지" })] });
    if (three) {
      days.set(three, {
        status: "checked",
        items: [1, 2, 3].map((p) => item(p, { field: "코딩 도구", title: `가짜도구 ${p}의 설정이 바뀌었다` })),
        discoveries: [
          product(1, "가짜회의록", { issue, purpose: "가짜회의록지어낸용도는 회의를 받아 적어 요약하는 앱이다." }),
          product(2, "Cal.example", { corrections: [{ on: end, reason: "용도 설명을 바로잡았다." }] }),
          product(3, "가짜일정앱"),
          repo(1, "fake-owner/agent-splitter", { corrections: [{ on: end, reason: "차이 설명을 바로잡았다." }] }),
          repo(2, "fake-owner/no-license-tool", { repo: repoFacts({ license: "없음", release: { state: "none" }, growth: 40 }) }),
          repo(3, "fake-owner/unknown-license-tool", { repo: repoFacts({ license: "판별되지 않음", release: { state: "unknown" } }) }),
        ],
        kinds: { product: "checked", repo: "checked" },
      });
    }
    if (onlyProduct) days.set(onlyProduct, { status: null, items: [], discoveries: [product(1, "가짜단독제품")], kinds: { product: "checked", repo: "off" } });
    if (longKinds) days.set(longKinds, fullDay(longKinds, rand, fill));
    if (allNone) days.set(allNone, { status: "checked", items: [], kinds: { product: "checked", repo: "checked" } });
    if (allFailed) days.set(allFailed, { status: "failed", items: [], kinds: { product: "failed", repo: "failed" } });
    if (mixed) days.set(mixed, { status: "checked", items: [], discoveries: [product(1, "가짜남은제품")], kinds: { product: "failed", repo: "baseline" } });
    if (offOnly) days.set(offOnly, { status: null, items: [], kinds: { product: "off", repo: "off" } });
  }
  const byDate = new Map<string, DayBuilder>();
  const months = new Map<string, BuilderMonth>();
  for (const date of [...days.keys()].sort()) {
    const d = days.get(date)!;
    const found = d.discoveries ?? [];
    const kind = (k: DiscoverKind) => ({ count: found.filter((x) => x.kind === k).length, status: d.kinds?.[k] ?? null });
    const summary = dayBuilderOf({ count: d.items.length, status: d.status }, { product: kind("product"), repo: kind("repo") });
    if (summary) byDate.set(date, summary);
    if (d.items.length + found.length === 0) continue;
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, days: {} });
    const file = months.get(month)!;
    if (d.items.length > 0) file.days[date] = d.items;
    if (found.length > 0) (file.discoveries ??= {})[date] = found;
  }
  return { byDate, months: [...months.values()], schedule, info };
}

/** 지어낸 일정 파일에 빌더 일정 하나를 더한다(달 파일, 색인, 식별자 묶음) */
export function addBuilderSchedule(files: Map<string, string>, s: ScheduleItem): void {
  const month = s.due.slice(0, 7);
  const name = siteFiles.scheduleMonth(month);
  const file: ScheduleMonth = files.has(name) ? (JSON.parse(files.get(name)!) as ScheduleMonth) : { month, items: [] };
  file.items = [...file.items, s].sort(compareSchedules);
  files.set(name, JSON.stringify(file));
  const index = JSON.parse(files.get(siteFiles.scheduleIndex)!) as ScheduleIndex;
  index.total++;
  const entry = index.months.find((m) => m.month === month);
  if (entry) {
    entry.count++;
    entry.majors[s.major] = (entry.majors[s.major] ?? 0) + 1;
  } else {
    index.months.push({ month, count: 1, majors: { [s.major]: 1 } });
    index.months.sort((a, b) => a.month.localeCompare(b.month));
  }
  if (!index.majors.includes(s.major)) index.majors.push(s.major);
  files.set(siteFiles.scheduleIndex, JSON.stringify(index));
  const ref = siteFiles.scheduleRef(scheduleRefChunkOf(s.id));
  const chunk: ScheduleRefChunk = files.has(ref) ? (JSON.parse(files.get(ref)!) as ScheduleRefChunk) : { months: {}, merged: {} };
  chunk.months[String(s.id)] = month;
  files.set(ref, JSON.stringify(chunk));
}
