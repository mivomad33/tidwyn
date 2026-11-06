import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

// 글자 크기 토큰(U1 4.1-1): 모든 font-size가 여섯 단계 토큰(--fs-*)만 쓰는지 본다.

const CSS_PATH = path.join(import.meta.dirname, "..", "site", "src", "styles.css");
const EXPECTED_TOKENS = [22, 19, 17, 16, 14, 12];
const KEYWORDS = new Set(["inherit", "initial", "unset", "revert", "revert-layer"]);

/** 주석을 뺀 CSS에서 토큰 정의(--fs-*: Npx)를 읽는다 */
function fontTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of stripComments(css).matchAll(/(--fs-[\w-]+)\s*:\s*([^;}]+)/g)) {
    tokens.set(m[1] ?? "", (m[2] ?? "").trim());
  }
  return tokens;
}

/** 토큰이나 값을 정하지 않는 키워드가 아닌 font-size 선언을 돌려준다 */
function fontSizeViolations(css: string): string[] {
  const bad: string[] = [];
  for (const m of stripComments(css).matchAll(/(?<![\w-])font-size\s*:\s*([^;}]+)/g)) {
    const value = (m[1] ?? "").replace(/\s*!important\s*$/, "").trim();
    if (/^var\(--fs-[\w-]+\)$/.test(value) || KEYWORDS.has(value)) continue;
    bad.push(value);
  }
  return bad;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("글자 크기 토큰 검사기", () => {
  test("단계 밖 px 값과 토큰이 아닌 값을 잡는다", () => {
    assert.deepEqual(fontSizeViolations(".a { font-size: 15px; }"), ["15px"]);
    assert.deepEqual(fontSizeViolations(".a{font-size:1.2em}.b{font-size: var(--x)}"), ["1.2em", "var(--x)"]);
  });
  test("토큰, 값을 정하지 않는 키워드, 주석 안의 값은 통과시킨다", () => {
    const css = ".a { font-size: var(--fs-sm); } .b { font-size: inherit !important; } /* font-size: 15px */";
    assert.deepEqual(fontSizeViolations(css), []);
  });
});

describe("site/src/styles.css", () => {
  const css = fs.readFileSync(CSS_PATH, "utf8");

  test("토큰은 여섯 단계 22/19/17/16/14/12px이다", () => {
    const values = [...fontTokens(css).values()];
    assert.equal(values.length, EXPECTED_TOKENS.length, `토큰 정의: ${values.join(", ")}`);
    assert.deepEqual([...values].sort(), EXPECTED_TOKENS.map((n) => `${n}px`).sort());
  });

  test("모든 font-size 선언이 토큰을 쓴다", () => {
    const tokens = fontTokens(css);
    assert.deepEqual(fontSizeViolations(css), []);
    for (const m of css.matchAll(/var\((--fs-[\w-]+)\)/g)) {
      assert.ok(tokens.has(m[1] ?? ""), `정의되지 않은 토큰: ${m[1]}`);
    }
  });
});
