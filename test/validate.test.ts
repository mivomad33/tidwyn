import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Brief } from "../src/brief.ts";
import { extractQuotes } from "../src/quotes.ts";
import { validateBrief, type Violation } from "../src/validate.ts";
import { clone, sampleBrief } from "./helpers.ts";

const DATE = "2026-10-27";

function check(mutate: (b: Brief & Record<string, unknown>) => void, date = DATE): Violation[] {
  const b = clone(sampleBrief()) as Brief & Record<string, unknown>;
  mutate(b);
  const r = validateBrief(b, date);
  return r.ok ? [] : r.violations;
}

function rejects(mutate: (b: Brief & Record<string, unknown>) => void, wherePart: string, whyPart = ""): void {
  const v = check(mutate);
  assert.ok(
    v.some((x) => x.where.includes(wherePart) && x.why.includes(whyPart)),
    `"${wherePart}"/"${whyPart}" 위반을 기대했다. 실제: ${JSON.stringify(v)}`,
  );
}

function passes(mutate: (b: Brief & Record<string, unknown>) => void): void {
  assert.deepEqual(check(mutate), []);
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i + 1}`).join(" ");
const sec = (b: Brief, i: number) => b.sections[i]!;
const top = (b: Brief, s: number, r: number) => sec(b, s).topStories[r]!;

describe("4.2 위치와 이유", () => {
  test("예시 브리프는 통과한다", () => passes(() => {}));
  test("위반에 섹션·순위·항목 이름과 이유가 들어 있다", () => {
    const v = check((b) => (top(b, 1, 2).keyFacts = ["a", "b"]));
    assert.deepEqual(v, [{ where: "세계 섹션 3위 핵심 사실", why: "2개 (3~5개여야 한다)" }]);
  });
  test("모르는 항목 이름(오타)은 거부된다", () => rejects((b) => ((top(b, 0, 0) as unknown as Record<string, unknown>).analog = "x"), "한국 섹션 1위", "알 수 없는 항목"));
});

describe("4.2-1 브리프 전체", () => {
  test("키워드 2개·6개는 거부된다", () => {
    rejects((b) => (b.keywords = ["a", "b"]), "브리프 전체 키워드", "2개");
    rejects((b) => (b.keywords = ["a", "b", "c", "d", "e", "f"]), "브리프 전체 키워드", "6개");
  });
  test("키워드 3개·5개는 통과한다", () => {
    passes((b) => (b.keywords = ["a", "b", "c"]));
    passes((b) => (b.keywords = ["a", "b", "c", "d", "e"]));
  });
  test("오늘의 한 문장이 비면 거부된다", () => rejects((b) => (b.headline = " "), "오늘의 한 문장"));
  test("섹션이 빠지면 거부된다", () => rejects((b) => b.sections.pop(), "브리프 전체 섹션", "2개"));
  test("섹션 순서가 바뀌면 거부된다", () => rejects((b) => b.sections.reverse(), "섹션 1번째", "순서"));
  test("처리 중인 날짜와 다른 대상일은 거부된다", () => rejects((b) => (b.targetDate = "2026-10-26"), "대상일", "2026-10-27"));
});

describe("4.2-2 섹션", () => {
  test("주요 뉴스 4개·11개는 거부된다", () => {
    rejects((b) => sec(b, 0).topStories.pop(), "한국 섹션 주요 뉴스", "4개");
    rejects((b) => {
      const s = sec(b, 0);
      for (let r = 6; r <= 11; r++) s.topStories.push({ ...clone(s.topStories[4]!), rank: r, sources: s.topStories[4]!.sources.map((x) => ({ ...x, url: `${x.url}-${r}` })) });
    }, "한국 섹션 주요 뉴스", "11개");
  });
  test("주요 뉴스 10개는 통과한다", () =>
    passes((b) => {
      const s = sec(b, 0);
      for (let r = 6; r <= 10; r++) s.topStories.push({ ...clone(s.topStories[4]!), rank: r, sources: s.topStories[4]!.sources.map((x) => ({ ...x, url: `${x.url}-${r}` })) });
    }));
  test("순위 건너뜀·중복은 거부된다", () => {
    rejects((b) => (top(b, 0, 4).rank = 6), "한국 섹션 주요 뉴스 순위");
    rejects((b) => (top(b, 0, 4).rank = 4), "한국 섹션 주요 뉴스 순위");
  });
  test("짧은 소식 6개는 거부된다", () =>
    rejects((b) => {
      const s = sec(b, 0);
      while (s.shortNews.length < 6) s.shortNews.push(clone(s.shortNews[0]!));
    }, "한국 섹션 짧은 소식", "6개"));
  test("짧은 소식 요약이 비면 거부된다", () => rejects((b) => (sec(b, 0).shortNews[0]!.summary = ""), "한국 섹션 짧은 소식 1 한 줄 요약"));
  test("흐름 한 줄이 비면 거부된다", () => rejects((b) => (sec(b, 2).flow = ""), "IT·AI 섹션 흐름 한 줄"));
  test("확인되지 않은 내용은 없어도 된다", () => passes((b) => delete sec(b, 0).unverified));
});

describe("4.2-3 주요 뉴스 항목", () => {
  for (const key of ["title", "summary", "whyItMatters", "background", "outlook"] as const) {
    test(`${key}가 비면 거부된다`, () => rejects((b) => (top(b, 0, 0)[key] = ""), "한국 섹션 1위", "비어"));
  }
  test("확인 수준이 없거나 두 값 밖이면 거부된다", () => {
    rejects((b) => delete (top(b, 0, 0) as Partial<Brief["sections"][0]["topStories"][0]>).confidence, "1위 확인 수준");
    rejects((b) => ((top(b, 0, 0) as unknown as Record<string, unknown>).confidence = "확실함"), "1위 확인 수준");
  });
  test("핵심 사실 2개·6개는 거부된다", () => {
    rejects((b) => (top(b, 0, 0).keyFacts = ["a", "b"]), "한국 섹션 1위 핵심 사실", "2개");
    rejects((b) => (top(b, 0, 0).keyFacts = ["a", "b", "c", "d", "e", "f"]), "한국 섹션 1위 핵심 사실", "6개");
  });
  test("한국 섹션에 개발자 체크 포인트가 있으면 거부된다", () => rejects((b) => (top(b, 0, 1).devCheckpoint = "패치"), "한국 섹션 2위 개발자 체크 포인트", "IT·AI"));
  test("IT·AI 섹션의 개발자 체크 포인트는 통과한다", () => passes((b) => (top(b, 2, 3).devCheckpoint = "패치")));
  test("비유가 없으면 통과한다", () => passes((b) => delete top(b, 0, 0).analogy));
});

describe("4.2-4 분류", () => {
  test("목록 밖 대분류는 거부된다", () => rejects((b) => ((top(b, 0, 0).category as unknown as Record<string, unknown>).major = "연예"), "1위 분류 대분류"));
  test("빈 소분류는 거부된다", () => rejects((b) => (top(b, 0, 0).category.minor = ""), "1위 분류 소분류"));
  test("목록 밖 소분류와 다른 대분류의 소분류는 통과하고 새 소분류로 표시된다", () => {
    const b = clone(sampleBrief());
    top(b, 0, 0).category = { major: "경제", minor: "가상자산" };
    top(b, 0, 1).category = { major: "경제", minor: "보안" };
    top(b, 0, 2).category = { major: "경제", minor: "금융·증시", isNewMinor: true };
    const r = validateBrief(b, DATE);
    assert.ok(r.ok);
    assert.equal(top(r.brief, 0, 0).category.isNewMinor, true);
    assert.equal(top(r.brief, 0, 1).category.isNewMinor, true);
    assert.equal(top(r.brief, 0, 2).category.isNewMinor, undefined, "입력의 표시는 무시하고 다시 계산한다");
  });
});

describe("4.2-5 출처", () => {
  test("출처 없음은 거부된다", () => {
    rejects((b) => (top(b, 0, 0).sources = []), "한국 섹션 1위 출처", "1개 이상");
    rejects((b) => (sec(b, 0).shortNews[0]!.sources = []), "한국 섹션 짧은 소식 1 출처", "1개 이상");
  });
  test("링크 형식이 틀리면 거부된다", () => {
    rejects((b) => (top(b, 0, 0).sources[1]!.url = "ftp://x.example.com/a"), "1위 출처 2 원문 링크", "http/https");
    rejects((b) => (top(b, 0, 0).sources[1]!.url = "news.example.com/a"), "1위 출처 2 원문 링크", "http/https");
    rejects((b) => (top(b, 0, 0).sources[0]!.imageUrl = "javascript:alert(1)"), "1위 출처 1 이미지 주소", "http/https");
  });
  test("발행일이 없거나 형식이 틀리면 거부된다", () => {
    rejects((b) => delete (top(b, 0, 0).sources[1] as Partial<Brief["sections"][0]["topStories"][0]["sources"][0]>).publishedAt, "1위 출처 2 발행일");
    rejects((b) => (top(b, 0, 0).sources[1]!.publishedAt = "10월 27일"), "1위 출처 2 발행일", "YYYY-MM-DD");
  });
  test("매체명이 비면 거부된다", () => rejects((b) => (top(b, 0, 0).sources[0]!.name = ""), "1위 출처 1 매체명"));
  test("대표 출처 0개·2개는 거부된다", () => {
    rejects((b) => delete top(b, 0, 0).sources[0]!.primary, "한국 섹션 1위 대표 출처", "0개");
    rejects((b) => (top(b, 0, 0).sources[1]!.primary = true), "한국 섹션 1위 대표 출처", "2개");
  });
  test("이미지 주소는 없어도 된다", () => passes((b) => delete top(b, 0, 0).sources[0]!.imageUrl));
});

describe("4.2-6 확인 수준과 출처 수", () => {
  test("출처 1개에 '여러 출처 확인'은 거부된다", () => rejects((b) => top(b, 0, 0).sources.pop(), "1위 확인 수준", "출처가 1개"));
  test("출처 1개에 '보도에 따르면'은 통과한다", () =>
    passes((b) => {
      top(b, 0, 0).sources.pop();
      top(b, 0, 0).confidence = "보도에 따르면";
    }));
});

describe("4.2-7 대표 출처 링크 중복", () => {
  test("서로 다른 섹션에 같은 대표 출처 링크가 있으면 거부된다", () =>
    rejects((b) => (top(b, 1, 0).sources[0]!.url = top(b, 0, 0).sources[0]!.url), "세계 섹션 1위 대표 출처", "한국 섹션 1위"));
});

describe("4.2-8 인용 길이", () => {
  test("14단어 인용은 통과하고 15단어 인용은 거부된다", () => {
    passes((b) => (top(b, 0, 0).summary = `장관은 "${words(14)}"라고 말했다.`));
    rejects((b) => (top(b, 0, 0).summary = `장관은 "${words(15)}"라고 말했다.`), "한국 섹션 1위 한 줄 요약", "15단어");
    rejects((b) => (top(b, 0, 0).summary = `장관은 “${words(15)}”라고 말했다.`), "한국 섹션 1위 한 줄 요약", "15단어");
  });
  test("‘ ’ 안에 it’s가 들어간 15단어 인용이 거부된다", () => {
    const quote = `it’s ${words(14)}`;
    rejects((b) => (top(b, 2, 0).whyItMatters = `CEO는 ‘${quote}’라고 했다.`), "IT·AI 섹션 1위 왜 중요한가", "15단어");
  });
  test("조사가 붙은 짧은 강조 여러 개는 통과하고, 조사가 붙은 15단어 인용은 거부된다", () => {
    passes((b) => (top(b, 0, 0).summary = "정부는 ‘반도체’를 ‘국가 전략 기술’로 지정하고 ‘AI’와 ‘배터리’도 검토했다."));
    rejects((b) => (top(b, 0, 0).summary = `총리는 ‘${words(15)}’를 강조했다.`), "1위 한 줄 요약", "15단어");
  });
  test("닫히지 않은 따옴표 뒤로 15단어 이상이면 거부된다", () => {
    rejects((b) => (top(b, 0, 0).outlook = `그는 "${words(15)}`), "1위 앞으로 볼 것", "15단어");
    passes((b) => (top(b, 0, 0).outlook = `그는 "${words(5)}`));
  });
  test("배경과 짧은 소식 요약의 15단어 인용이 각각 거부된다", () => {
    rejects((b) => (top(b, 1, 3).background = `발표문은 "${words(15)}"였다.`), "세계 섹션 4위 배경", "15단어");
    rejects((b) => (sec(b, 1).shortNews[0]!.summary = `“${words(16)}”`), "세계 섹션 짧은 소식 1 한 줄 요약", "16단어");
  });
  test("나머지 글 항목도 검사한다", () => {
    const long = `"${words(15)}"`;
    rejects((b) => (b.headline = long), "오늘의 한 문장", "15단어");
    rejects((b) => (b.keywords[0] = long), "키워드 1", "15단어");
    rejects((b) => (sec(b, 0).flow = long), "한국 섹션 흐름 한 줄", "15단어");
    rejects((b) => (top(b, 0, 0).title = long), "1위 제목", "15단어");
    rejects((b) => (top(b, 0, 0).keyFacts[0] = long), "1위 핵심 사실 1", "15단어");
    rejects((b) => (top(b, 0, 0).analogy = long), "1위 비유", "15단어");
    rejects((b) => (top(b, 2, 1).devCheckpoint = long), "IT·AI 섹션 2위 개발자 체크 포인트", "15단어");
    rejects((b) => (sec(b, 0).unverified = long), "한국 섹션 확인되지 않은 내용", "15단어");
  });
  test("출처 항목(매체명)의 따옴표는 검사하지 않는다", () => passes((b) => (top(b, 0, 0).sources[1]!.name = `"${words(20)}"`)));
  test("곧은 작은따옴표는 세지 않는다", () => passes((b) => (top(b, 0, 0).summary = `He said 'don't ${words(20)}' today.`)));
  test("인용 추출", () => {
    assert.deepEqual(extractQuotes("‘반도체’를 ‘국가 전략 기술’로"), ["반도체", "국가 전략 기술"]);
    assert.deepEqual(extractQuotes("‘it’s fine’이라고"), ["it’s fine"]);
    assert.deepEqual(extractQuotes("a ” b ’ c"), []);
  });
});
