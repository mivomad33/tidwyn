// B2 E2E·시각 회귀용 썸네일: i.ytimg.com 요청을 가로채 테스트용 로컬 이미지(지어 만든 단색 PNG)로 답한다. 밖으로 나가지 않는다.
import zlib from "node:zlib";
import type { Page } from "@playwright/test";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 320×180 단색 PNG(위 절반 회청색, 아래 절반 진한 회청색) */
function makePng(w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const [r, g, b] = y < h / 2 ? [120, 140, 160] : [70, 85, 100];
    for (let x = 0; x < w; x++) raw.set([r, g, b], y * (w * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export const TEST_THUMB_PNG = makePng(320, 180);

/** 없는 영상에 YouTube가 실패 대신 돌려주는 120×90 대체 그림을 흉내 낸 PNG */
export const TEST_MISSING_THUMB_PNG = makePng(120, 90);

/** 썸네일 요청을 로컬 이미지로 답한다 */
export async function routeThumbs(page: Page): Promise<void> {
  await page.route("https://i.ytimg.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: TEST_THUMB_PNG }));
}
