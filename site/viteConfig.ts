// 사이트 Vite 설정. build.ts가 쓴다(설정 파일을 따로 두지 않는다).
import react from "@vitejs/plugin-react";
import path from "node:path";
import type { InlineConfig, Plugin } from "vite";
import { themeCss } from "./src/lib/theme.ts";

export const SITE_DIR = import.meta.dirname;

/** 색 변수를 화면 틀(head)에 넣는다. 자바스크립트가 돌기 전에도 바탕색이 맞다 */
function themePlugin(): Plugin {
  return {
    name: "tidwyn-theme",
    transformIndexHtml: () => [{ tag: "style", children: themeCss(), injectTo: "head" }],
  };
}

export function siteViteConfig(outDir: string): InlineConfig {
  return {
    configFile: false,
    root: SITE_DIR,
    base: "/",
    // 결과물 맨 위에 public/ 폴더를 두지 않는다(4.6-1). 정적 파일 폴더를 쓰지 않는다.
    publicDir: false,
    logLevel: "warn",
    clearScreen: false,
    plugins: [react(), themePlugin()],
    build: {
      outDir: path.resolve(outDir),
      emptyOutDir: false,
      assetsDir: "assets",
      sourcemap: false,
      target: "es2022",
      reportCompressedSize: false,
      modulePreload: { polyfill: false },
    },
  };
}
