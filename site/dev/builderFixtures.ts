// 9.8단계: 지어낸 빌더 사이트 데이터(로컬 화면 확인·테스트용). 내용은 모두 가짜다. fixtures.ts가 부른다.
// 실제 빌드(src/builderSite.ts)와 같은 모양의 파일을 만든다. 기본은 날짜마다 화면 상태 하나(4건, 1건, 긴 글, 0건 세 상태, 안내가 붙는 날, 다시 알림),
// full이면 모든 날짜에 칸별 상한 길이의 4건이다(크기 측정용).
import { BUILDER_FIELDS, builderItemKey, type BuilderField } from "../../src/builderTypes.ts";
import { compareSchedules, scheduleRefChunkOf, siteFiles, type BuilderMonth, type DayBuilder, type IssueRef, type ScheduleIndex, type ScheduleItem, type ScheduleMonth, type ScheduleRefChunk, type SiteBuilderItem } from "../../src/siteTypes.ts";
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

interface ItemInput extends Partial<SiteBuilderItem> {
  field: BuilderField;
  title: string;
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

function fullItem(position: number, date: string, rand: () => number): SiteBuilderItem {
  return item(position, {
    field: BUILDER_FIELDS[Math.floor(rand() * BUILDER_FIELDS.length)]!,
    title: fill(60, rand),
    whatChanged: fill(300, rand),
    who: fill(100, rand),
    action: fill(150, rand),
    why: fill(100, rand),
    due: { date: addDays(date, 30 + position), state: position % 2 ? "confirmed" : "tentative" },
    sources: [1, 2].map((n) => ({ name: `가짜 공식 문서 ${n}`, url: `${SOURCE}/docs/${date}/${position}/${n}/${"x".repeat(40)}` })),
  });
}

export function fixtureBuilder(opts: { datesDesc: string[]; end: string; issue: IssueRef; full?: boolean }): BuilderFixtures {
  const { datesDesc, end, issue } = opts;
  const days = new Map<string, { status: DayBuilder["status"]; items: SiteBuilderItem[] }>();
  const empty: BuilderFixtureInfo = { four: null, one: null, long: null, none: null, partial: null, failed: null, partialItems: null, failedItems: null, origin: null, noRecord: null, schedule: null };
  let info = empty;
  let schedule: ScheduleItem | null = null;
  if (opts.full) {
    const rand = rng(20261101);
    for (const date of datesDesc) days.set(date, { status: "checked", items: [1, 2, 3, 4].map((p) => fullItem(p, date, rand)) });
  } else {
    const rand = rng(20261101);
    const [four, one, long, none, partial, failed, partialItems, failedItems, origin, noRecord] = datesDesc;
    info = { four: four ?? null, one: one ?? null, long: long ?? null, none: none ?? null, partial: partial ?? null, failed: failed ?? null, partialItems: partialItems ?? null, failedItems: failedItems ?? null, origin: origin ?? null, noRecord: noRecord ?? null, schedule: null };
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
    if (long) days.set(long, { status: "checked", items: [1, 2, 3, 4].map((p) => fullItem(p, long, rand)) });
    if (none) days.set(none, { status: "checked", items: [] });
    if (partial) days.set(partial, { status: "partial", items: [] });
    if (failed) days.set(failed, { status: "failed", items: [] });
    if (partialItems) days.set(partialItems, { status: "partial", items: [item(1, { field: "프레임워크", title: "가짜프레임워크 3 정식판이 나왔다" })] });
    if (failedItems) days.set(failedItems, { status: "failed", items: [item(1, { field: "모델", title: "가짜 다시 알림만 실린 날", reminderOf: origin ? { date: origin, key: builderItemKey(1) } : null })] });
    if (origin) days.set(origin, { status: "checked", items: [item(1, { field: "모델", title: "가짜모델 0 종료 공지" })] });
  }
  const byDate = new Map<string, DayBuilder>();
  const months = new Map<string, BuilderMonth>();
  for (const date of [...days.keys()].sort()) {
    const d = days.get(date)!;
    byDate.set(date, { count: d.items.length, status: d.status });
    if (d.items.length === 0) continue;
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, days: {} });
    months.get(month)!.days[date] = d.items;
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
