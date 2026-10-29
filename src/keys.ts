import fs from "node:fs";
import path from "node:path";

// 6단계 4.8: 출처 API 키. 키는 환경 변수가 있으면 그것을, 없으면 메인 작업 폴더의 `.env.local`에서 읽는다(4.2-2).
// 키 값은 출력·기록하지 않는다. 하위 프로세스 환경에도 넣지 않는다(process.env를 바꾸지 않는다, 4.8-1).

export const KEY_NAMES = ["ECOS_API_KEY", "FRED_API_KEY"] as const;
export type KeyName = (typeof KEY_NAMES)[number];
export const ENV_LOCAL_FILE = ".env.local";
/** 이보다 짧은 값은 키로 보지 않는다(모든 글에 걸리므로, precheck의 짧은 홈 값 건너뛰기와 같은 방식) */
const MIN_KEY_LENGTH = 8;

export type Keys = Record<KeyName, string | null>;

/** `.env.local`의 `이름=값` 줄을 읽는다(따옴표는 벗긴다). 파일이 없으면 빈 것 */
function readEnvFile(file: string): Map<string, string> {
  const out = new Map<string, string>();
  if (!fs.existsSync(file)) return out;
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    // 따옴표로 감싼 값은 따옴표 안만, 아니면 줄 끝 주석(공백 뒤 #)을 뺀 값을 쓴다
    const v = m[2]!.trim();
    const quoted = /^(["'])(.*?)\1(?:\s+#.*)?$/.exec(v);
    out.set(m[1]!, quoted ? quoted[2]! : v.replace(/\s+#.*$/, ""));
  }
  return out;
}

function usable(v: string | undefined): string | null {
  const t = v?.trim() ?? "";
  return t.length >= MIN_KEY_LENGTH ? t : null;
}

/** 키를 읽는다. keyDir은 `.env.local`이 있는 폴더(메인 작업 폴더) */
export function readKeys(env: NodeJS.ProcessEnv, keyDir: string): Keys {
  const file = readEnvFile(path.join(keyDir, ENV_LOCAL_FILE));
  const keys = {} as Keys;
  for (const name of KEY_NAMES) keys[name] = usable(env[name]) ?? usable(file.get(name));
  return keys;
}

/** 검사에 쓸 키 값 전부(환경 변수와 `.env.local` 둘 다, 4.8-2) */
export function secretValues(env: NodeJS.ProcessEnv, keyDir: string): string[] {
  const file = readEnvFile(path.join(keyDir, ENV_LOCAL_FILE));
  const out = new Set<string>();
  for (const name of KEY_NAMES) {
    for (const v of [usable(env[name]), usable(file.get(name))]) if (v !== null) out.add(v);
  }
  return [...out];
}

/** 글 속 키 값을 가린다 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of secrets) if (s.length > 0) out = out.split(s).join("***");
  return out;
}
