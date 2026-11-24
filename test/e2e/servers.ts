// E2E 서버 띄우기(playwright.config.ts의 webServer가 부른다): 준비를 마친 뒤 결과물 서버들을 한 프로세스에서 띄운다.
// 셸의 `&`로 여럿을 띄우면 윈도우 cmd에서는 차례로 실행되어 첫 서버만 뜨므로, 운영체제와 관계없이 Node 하나로 띄운다.
import { createStaticServer } from "../../site/dev/serve.ts";
import { E2E_OUT_DIR, E2E_PORT, E2E_U1_OUT_DIR, E2E_U1_PORT } from "./paths.ts";

const SERVERS: [string, number][] = [
  [E2E_U1_OUT_DIR, E2E_U1_PORT],
  // 기본 사이트는 맨 끝에 띄운다(webServer는 이 주소가 열리면 준비가 끝난 것으로 본다)
  [E2E_OUT_DIR, E2E_PORT],
];

for (const [dir, port] of SERVERS) {
  await new Promise<void>((resolve) => createStaticServer(dir).listen(port, "127.0.0.1", resolve));
}
console.log(`E2E 서버: ${SERVERS.map(([, p]) => p).join(", ")}`);
