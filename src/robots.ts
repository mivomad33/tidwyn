// 9.95단계 4.2-2(D16): robots.txt가 `*`나 Anthropic 계열 봇이 받는 경로를 막는지 본다. 다른 회사 봇만 막는 것은 막은 것이 아니다.
// RFC 9309대로 읽는다: User-agent 줄이 이어지면 한 그룹이고, 봇 이름의 그룹이 있으면 `*` 그룹 대신 그것을 쓰며(같은 이름의 그룹은 합친다),
// 가장 긴 규칙이 이기고 길이가 같으면 Allow가 이긴다. `*`는 아무 글자, 끝의 `$`는 경로의 끝이다.

const D16_AGENTS: readonly string[] = ["*", "claudebot", "claude-user", "claude-searchbot", "anthropic-ai", "claude-web"];

interface Group {
  agents: string[];
  rules: { allow: boolean; pattern: string }[];
}

/** 형식을 읽을 수 없는 robots(HTML 페이지 등) */
class RobotsFormatError extends Error {}

function parseRobots(text: string): Group[] {
  if (/^\s*(?:<!doctype|<html)/i.test(text) || text.includes("\0")) throw new RobotsFormatError("robots 형식 오류");
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (key === "user-agent") {
      if (!lastWasAgent || cur === null) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (cur !== null && (key === "allow" || key === "disallow")) cur.rules.push({ allow: key === "allow", pattern: value });
  }
  return groups;
}

function patternRe(pattern: string): RegExp {
  const end = pattern.endsWith("$");
  const body = (end ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`);
}

/** 그 봇이 경로를 받아도 되는지 */
function robotsAllows(groups: Group[], agent: string, pathAndQuery: string): boolean {
  const own = groups.filter((g) => g.agents.includes(agent));
  const rules = (own.length > 0 ? own : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: { allow: boolean; pattern: string } | null = null;
  for (const r of rules) {
    if (r.pattern === "" || !patternRe(r.pattern).test(pathAndQuery)) continue;
    if (best === null || r.pattern.length > best.pattern.length || (r.pattern.length === best.pattern.length && r.allow && !best.allow)) best = r;
  }
  return best === null || best.allow;
}

/** D16 기준으로 경로 가운데 하나라도 막혔는지 */
export function robotsBlocks(text: string, paths: readonly string[]): boolean {
  const groups = parseRobots(text);
  return D16_AGENTS.some((a) => paths.some((p) => !robotsAllows(groups, a, p)));
}
