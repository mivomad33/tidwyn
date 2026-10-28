// 따옴표 안 인용의 단어 수 검사(4.2-8, D6)

export const MAX_QUOTE_WORDS = 14;

const LATIN = /[A-Za-z]/;

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

/** ’가 앞뒤 모두 영문자 사이(it’s 등)면 닫는 따옴표가 아니다 */
function isApostrophe(text: string, i: number): boolean {
  return LATIN.test(text[i - 1] ?? "") && LATIN.test(text[i + 1] ?? "");
}

/**
 * 따옴표(" ", “ ”, ‘ ’) 안의 인용을 모두 뽑는다. 곧은 작은따옴표(')는 세지 않는다.
 * 닫히지 않은 따옴표는 그 지점부터 끝까지를 인용으로 본다.
 */
export function extractQuotes(text: string): string[] {
  const quotes: string[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let close: number;
    if (ch === '"') {
      close = text.indexOf('"', i + 1);
    } else if (ch === "“") {
      close = text.indexOf("”", i + 1);
    } else if (ch === "‘") {
      close = -1;
      for (let j = i + 1; j < text.length; j++) {
        if (text[j] === "’" && !isApostrophe(text, j)) {
          close = j;
          break;
        }
      }
    } else {
      i++;
      continue;
    }
    if (close === -1) {
      quotes.push(text.slice(i + 1));
      break;
    }
    quotes.push(text.slice(i + 1, close));
    i = close + 1;
  }
  return quotes;
}

/** 15단어 이상인 인용들 */
export function longQuotes(text: string): { quote: string; words: number }[] {
  return extractQuotes(text)
    .map((quote) => ({ quote, words: countWords(quote) }))
    .filter((q) => q.words > MAX_QUOTE_WORDS);
}
