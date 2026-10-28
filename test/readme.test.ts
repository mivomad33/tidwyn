import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { PROJECT_ROOT } from "./helpers.ts";

// README 두 언어(4.8-1): 제목 구조, 링크, 명령, 이미지가 같고 저장소 안 링크가 깨지지 않는다

const FILES = ["README.md", "README.en.md"] as const;

interface Outline {
  headings: number[];
  links: string[];
  code: string[];
  images: string[];
}

function outline(text: string): Outline {
  const code = [...text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const prose = text.replace(/```[\s\S]*?```/g, "");
  const headings = [...prose.matchAll(/^(#+) /gm)].map((m) => m[1]!.length);
  const links = [...prose.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)|<(https?:[^>]+)>/g)].map((m) => m[1] ?? m[2]!);
  const images = [...prose.matchAll(/<img [^>]*src="([^"]+)"|!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1] ?? m[2]!);
  return { headings, links, code, images };
}

const read = (f: string) => fs.readFileSync(path.join(PROJECT_ROOT, f), "utf8");

describe("README", () => {
  const [ko, en] = FILES.map((f) => outline(read(f))) as [Outline, Outline];

  test("두 언어의 제목 구조, 명령, 이미지가 같다", () => {
    assert.deepEqual(ko.headings, en.headings);
    assert.deepEqual(ko.code, en.code);
    assert.deepEqual(ko.images, en.images);
    assert.ok(ko.images.length >= 1, "화면 스크린샷이 하나 있다");
  });

  test("링크는 서로 가리키는 언어 링크만 다르고 나머지는 같다", () => {
    const swap = (l: string) => (FILES.includes(l as (typeof FILES)[number]) ? "<lang>" : l);
    assert.deepEqual(ko.links.map(swap), en.links.map(swap));
    assert.ok(ko.links.includes("README.en.md") && en.links.includes("README.md"));
  });

  test("저장소 안 링크와 이미지가 실제 파일을 가리킨다", () => {
    for (const o of [ko, en]) {
      for (const l of [...o.links, ...o.images]) {
        if (/^https?:/.test(l)) continue;
        assert.ok(fs.existsSync(path.join(PROJECT_ROOT, l.split("#")[0]!)), `깨진 링크: ${l}`);
      }
    }
  });
});
