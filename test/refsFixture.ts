// 4단계 사이트 데이터 테스트용 지어낸 DB(4.6-1): 날짜 3개, 대상 여럿(합친 것 1, 지운 것 1), 용어 여럿(합친 것 1), 합친 이슈 1.
// 이름은 모두 지어낸 것이다. 지운 대상의 이름("이가짜")은 뉴스 글에 넣지 않는다.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { openDb } from "../src/db.ts";
import { createIssue, inTransaction, linkStory, storiesOfDate } from "../src/issues.ts";
import { applyMerges } from "../src/merge.ts";
import { applyRefMerges, deleteRef } from "../src/refMerge.ts";
import { createEntity, createTerm, ensureNameKey, linkEntity, linkTerm } from "../src/refs.ts";
import { recordFirstCollectionDate, saveBrief } from "../src/store.ts";
import { validateBrief } from "../src/validate.ts";
import { sampleBrief, tempDir } from "./helpers.ts";

export const REF_DATES = ["2026-10-26", "2026-10-27", "2026-10-28"] as const;
export const REF_TODAY = "2026-10-29";
/** 지운 대상의 이름·별칭·설명과 합치기 이유에 넣은 글자 */
export const DELETED_TEXTS = ["이가짜", "Lee Gajja", "가짜 동네 주민"];

export interface RefSiteDb {
  db: DatabaseSync;
  dir: string;
  ids: {
    kim: number;
    dup: number;
    ge: number;
    del: number;
    qe: number;
    qe2: number;
    repo: number;
    abc: number;
    i1: number;
    i2: number;
    /** 대상 dup → kim 합치기 기록 */
    entityMerge: number;
  };
}

function storyId(db: DatabaseSync, date: string, key: string): number {
  const s = storiesOfDate(db, date).find((x) => x.key === key);
  assert.ok(s, `${date} ${key}`);
  return s.id;
}

export function refSiteDb(): RefSiteDb {
  const dir = tempDir();
  fs.mkdirSync(dir, { recursive: true });
  const db = openDb(path.join(dir, "tidwyn.db"));
  recordFirstCollectionDate(db, REF_DATES[0]);
  for (const date of REF_DATES) {
    const b = sampleBrief(date);
    const kr = b.sections[0]!.topStories[0]!;
    kr.summary = "가짜국 재무장관이 기준금리를 동결했다.";
    kr.background = "가짜 중앙은행은 지난해 양적완화를 끝냈다.";
    b.sections[1]!.topStories[0]!.summary = "가짜전자가 새 칩을 공개했다.";
    const r = validateBrief(b, date);
    assert.ok(r.ok, r.ok ? "" : JSON.stringify(r.violations));
    saveBrief(db, { brief: r.brief, collectedAt: `${date}T23:00:00+09:00`, late: false });
  }
  const [d1, d2, d3] = REF_DATES;
  const sid = (date: string, key: string) => storyId(db, date, key);

  // 이슈: i2(10-26 한국-1)는 i1(10-27·10-28 한국-1)에 흡수된다
  const issue = (name: string) => createIssue(db, { name, aliases: [], category: { major: "경제", minor: "금융·증시" }, summary: `${name}의 요약이다.` });
  const i1 = issue("가짜 금리 이야기");
  const i2 = issue("가짜 금리 논쟁");
  linkStory(db, sid(d1, "한국-1"), i2, true);
  linkStory(db, sid(d2, "한국-1"), i1, true);
  linkStory(db, sid(d3, "한국-1"), i1, true);
  applyMerges(db, [{ survivor: i1, absorbed: i2, reason: "같은 금리 이야기다", summary: "합친 뒤 요약이다." }], REF_TODAY);

  const entity = (kind: "인물" | "기관" | "국가", name: string, aliases: string[], description: string) => createEntity(db, { kind, name, aliases, description, describedOn: null, describedStory: null });
  const kim = entity("인물", "김가짜", ["Kim Gajja"], "가짜국 재무장관");
  const dup = entity("인물", "김가짜 장관", [], "가짜국 재무장관");
  const ge = entity("기관", "가짜전자", ["Gajja Electronics"], "가짜국 전자 회사");
  const del = entity("인물", DELETED_TEXTS[0]!, [DELETED_TEXTS[1]!], DELETED_TEXTS[2]!);
  for (const d of REF_DATES) linkEntity(db, sid(d, "한국-1"), kim);
  linkEntity(db, sid(d1, "한국-2"), dup);
  linkEntity(db, sid(d3, "세계-1"), ge);
  linkEntity(db, sid(d2, "한국-2"), del);

  const term = (name: string, aliases: string[], description: string) => createTerm(db, { name, aliases, description });
  const qe = term("양적완화", ["QE"], "중앙은행이 채권을 사들여 돈을 푸는 정책이다.");
  const qe2 = term("양적 완화 정책", [], "중앙은행이 돈을 푸는 정책이다.");
  const repo = term("역레포", [], "중앙은행이 채권을 팔고 나중에 되사는 거래다.");
  const abc = term("ABC지수", [], "지어낸 지수다.");
  // 10-28을 먼저 연결하고 10-26을 나중에 연결해도 처음 나온 뉴스는 10-26이다
  linkTerm(db, sid(d3, "한국-1"), qe, "양적완화");
  linkTerm(db, sid(d1, "한국-1"), qe, "양적완화");
  linkTerm(db, sid(d3, "한국-2"), qe2, null);
  linkTerm(db, sid(d2, "한국-1"), repo, null);
  linkTerm(db, sid(d3, "한국-1"), abc, null);

  const [entityMerge] = inTransaction(db, () =>
    applyRefMerges(
      db,
      [
        { item: "entity", survivor: kim, absorbed: dup, reason: "같은 장관이다" },
        { item: "term", survivor: qe, absorbed: qe2, reason: "같은 정책이다" },
      ],
      REF_TODAY,
    ),
  );
  // 지울 대상이 든 합치기: 이유에 지울 이름을 넣는다
  const helper = entity("인물", "이 가짜 (옛 표기)", [], "가짜 표기");
  linkEntity(db, sid(d2, "한국-3"), helper);
  inTransaction(db, () => applyRefMerges(db, [{ item: "entity", survivor: del, absorbed: helper, reason: `${DELETED_TEXTS[0]}와 같다` }], REF_TODAY));
  assert.ok(deleteRef(db, "entity", del, ensureNameKey(dir), REF_TODAY).ok);
  return { db, dir, ids: { kim, dup, ge, del, qe, qe2, repo, abc, i1, i2, entityMerge: entityMerge! } };
}
