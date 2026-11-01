# 소스 이용 조건 확인 (2026-11-01)

법률 자문이 아니다. 대부분 도구 요약을 거친 판정이고, robots.txt는 원문을 받았다.

| 소스 | 판정 | 근거 요지 | 주소 |
|---|---|---|---|
| GitHub `releases.atom` | 쓰지 않음 | robots가 `/*.atom$` 금지 | https://github.com/robots.txt |
| GitHub REST 릴리스 | 사용 | AUP의 스크래핑 정의가 API 수집을 제외 | https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies |
| GitHub Changelog 피드 | 사용(조건부) | robots 허용, 전용 약관 못 찾음 | https://github.blog/robots.txt |
| GHSA | 사용 | CC BY 4.0, 레코드 링크로 표기 | https://raw.githubusercontent.com/github/advisory-database/main/LICENSE.md |
| Cursor | 쓰지 않음 | 약관 §1.5가 데이터 수집·스크래핑 금지, 서비스에 웹사이트 포함 | https://cursor.com/terms-of-service |
| Aikido | 쓰지 않음 | 약관이 봇·스크레이퍼 금지 | https://www.aikido.dev/terms-of-use |
| Claude 문서·피드 | 사용(조건부) | robots 허용. 스크래핑 조항의 문서 적용 불명 | https://www.anthropic.com/legal/commercial-terms |
| OpenAI 문서 | 사용(조건부) | robots 허용, `.md` 공식 제공. 약관 원문 확인 불가(403), 사용자 확인 | https://openai.com/policies/row-terms-of-use/ |
| Gemini 문서 | 사용 | CC BY 4.0 | https://developers.google.com/terms/site-terms |
| CISA KEV | 사용 | CC0, 로고·보증 암시 불가 | https://raw.githubusercontent.com/cisagov/kev-data/develop/LICENSE |
| npm 다운로드 수 | 사용 | 공개 API 사용 허용, 월 500만 요청은 과하다고 명시(하루 수십 회라 한참 아래). 보안 데이터는 개인·내부 용도라 쓰지 않음 | https://docs.npmjs.com/policies/open-source-terms |
| Socket | 사용(조건부) | robots 허용. 약관 원문 확인 불가(403), 사용자 확인 | https://socket.dev/terms |
| Next.js | 사용 | robots 없음, 저장소 MIT | https://raw.githubusercontent.com/vercel/next.js/canary/license.md |
| React | 사용 | 문서 CC BY 4.0 | https://raw.githubusercontent.com/reactjs/react.dev/main/LICENSE-DOCS.md |
| Node.js 블로그 | 사용 | CC BY 4.0. `/dist/`는 robots 금지 | https://nodejs.org/robots.txt |
| TypeScript 블로그 | 사용(조건부) | robots 허용, 지연 10초. MS 약관은 개인·무수정 전제 | https://www.microsoft.com/en-us/legal/terms-of-use |
| Vite 블로그 | 사용 | robots 없음, 저장소 MIT | https://raw.githubusercontent.com/vitejs/vite/main/LICENSE |
| endoflife.date | 사용 | MIT | https://endoflife.date/docs/api/v1/openapi.yml |
| Vercel | 사용(조건부) | robots 허용, AUP는 이용자 대상으로 보임 | https://vercel.com/legal/acceptable-use-policy |
| Supabase | 사용 | `ai-input=yes` | https://supabase.com/robots.txt |
| Cloudflare 문서 | 사용 | `ai-input=yes`, 문서 CC BY 4.0 | https://developers.cloudflare.com/robots.txt |
