// 결과물 로컬 미리 보기: node site/dev/serve.ts <결과물 폴더> [--port 4173]
// Vercel과 같은 규칙(hosting.ts)으로 주소를 파일로 풀고, 없는 주소는 404.html을 404로 준다.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { resolveStatic } from "../hosting.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".pagefind": "application/wasm",
};

export function createStaticServer(root: string): http.Server {
  const dir = path.resolve(root);
  const isFile = (rel: string) => fs.statSync(path.join(dir, rel), { throwIfNoEntry: false })?.isFile() ?? false;
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const r = resolveStatic(url.pathname, isFile);
    const type = TYPES[path.extname(r.path)] ?? "application/octet-stream";
    res.writeHead(r.kind === "file" ? 200 : 404, { "content-type": type, "cache-control": "no-cache" });
    fs.createReadStream(path.join(dir, r.path)).pipe(res);
  });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--port");
  const portArg = args.indexOf("--port");
  const port = portArg >= 0 ? Number(args[portArg + 1]) : 4173;
  if (!root || !fs.existsSync(path.join(root, "index.html"))) {
    console.error("사용법: node site/dev/serve.ts <결과물 폴더> [--port 4173]");
    process.exit(1);
  }
  createStaticServer(root).listen(port, "127.0.0.1", () => console.log(`미리 보기: http://localhost:${port}/`));
}
