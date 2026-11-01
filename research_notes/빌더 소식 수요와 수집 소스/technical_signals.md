# 빌더가 추적해야 할 기술 변화 신호와 자동 수집 방법

조사일: 2026-11-01. 표시 규칙:
- **[실측]**: 이날 `curl`(일부는 User-Agent 지정)로 직접 요청해 응답·내용을 확인했다. 해당 주소 자체를 출처로 단다.
- 건수는 조사일 시점 값이다. 피드 길이에 잘린 값은 그렇게 적었다.
- 피드 제목·날짜는 데이터로 읽었고, 판단은 제 추론이면 Inferences에 적었다.

## 공통 질문: 어떤 것이 공식 피드/API이고, 어떤 것이 스크래핑이며, 어떤 것이 AI 판단 전에 기계적으로 뽑히는가?

### Takeaway
대부분 HTML 스크래핑 없이 수집할 수 있다. 공식 RSS/Atom/JSON이 없는 곳도 2026년 기준 문서 사이트가 마크다운 원본(`.md`, `.md.txt`)을 내주는 경우가 많아, 날짜 머리글 파싱이나 어제 사본과의 비교로 충분하다. 진짜 HTML이 필요한 곳은 Google Play 정책 마감일, 클라우드 요금제 페이지, AWS 사후 분석 목록, Meta 등 소수다.

### Cited Findings
아래 표는 전부 [실측]이다(HTTP 200 + 조사일 기준 최근 항목 확인. "최신일"이 비어 있으면 존재만 확인).

**A. 공식 피드 있음 (RSS/Atom)**

| 대상 | 주소 | 최신일 |
|---|---|---|
| Claude Platform 릴리스 노트 | https://platform.claude.com/docs/en/release-notes/feed.xml (페이지 소스의 링크로 발견) | 10월 15건 |
| OpenAI 뉴스 / 개발자 | https://openai.com/news/rss.xml , https://developers.openai.com/rss.xml | 10-30 |
| Google 개발자 도구 블로그 | https://blog.google/innovation-and-ai/technology/developers-tools/rss/ | 10-28 |
| Hugging Face 블로그 | https://huggingface.co/blog/feed.xml | |
| Claude Code | https://github.com/anthropics/claude-code/releases.atom | 10-31 |
| Cursor | https://cursor.com/changelog/rss.xml | 10-20 |
| Copilot | https://github.blog/changelog/label/copilot/feed/ , https://github.com/github/copilot-cli/releases.atom | 10-28 |
| Codex | https://github.com/openai/codex/releases.atom | 10-30 |
| VS Code | https://code.visualstudio.com/feed.xml | |
| Gemini CLI / Qwen Code | https://github.com/google-gemini/gemini-cli/releases.atom , https://github.com/QwenLM/qwen-code/releases.atom | 11-01 |
| MCP 명세·블로그·레지스트리 | https://github.com/modelcontextprotocol/modelcontextprotocol/releases.atom , https://blog.modelcontextprotocol.io/index.xml , https://github.com/modelcontextprotocol/registry/releases.atom | |
| Next.js / React | https://nextjs.org/feed.xml , https://react.dev/rss.xml | 10-28 / 10-27 |
| Node | https://nodejs.org/en/feed/releases.xml , https://nodejs.org/en/feed/blog.xml | 10-29 |
| TypeScript | https://devblogs.microsoft.com/typescript/feed/ (`devblog.typescriptlang.org`는 응답 없음) | 10-20 |
| Python | https://blog.python.org/feeds/posts/default , https://www.python.org/downloads/feed.rss | 10-26 |
| Rust / Bun | https://blog.rust-lang.org/feed.xml , https://bun.com/rss.xml | 10-27 / 10-31 |
| CISA 공지 | https://www.cisa.gov/cybersecurity-advisories/all.xml | 10-30 |
| 공급망 보안 벤더 | https://socket.dev/api/blog/feed.atom , https://www.aikido.dev/blog/rss.xml | 10-30 |
| GitHub npm·공급망 변경 | https://github.blog/changelog/label/npm/feed/ , https://github.blog/changelog/label/supply-chain-security/feed/ | 라벨 npm은 10월 0건 |
| 상태 페이지(Atom) | https://www.vercel-status.com/history.atom , https://www.cloudflarestatus.com/history.atom , https://status.supabase.com/history.atom , https://status.claude.com/history.atom , https://status.openai.com/history.atom , https://www.githubstatus.com/history.atom , https://status.cloud.google.com/feed.atom , https://status.aws.amazon.com/rss/all.rss | 11-01 |
| 플랫폼 변경 | https://aws.amazon.com/about-aws/whats-new/recent/feed/ , https://vercel.com/atom , https://developers.cloudflare.com/changelog/rss/index.xml , https://supabase.com/changelog/rss.xml | 10-30~11-01 |
| 사후 분석 | https://blog.cloudflare.com/tag/post-mortem/rss/ | 05-01 |
| Apple | https://developer.apple.com/news/rss/news.rss , https://developer.apple.com/news/releases/rss/releases.rss | 10-30 |
| Android | https://android-developers.googleblog.com/feeds/posts/default | 10-29 |
| PyPI | https://pypi.org/rss/project/{이름}/releases.xml | |
| arXiv | https://rss.arxiv.org/rss/cs.AI | |

**B. 공식 JSON/CSV API 있음**

| 대상 | 주소 | 비고 |
|---|---|---|
| CISA KEV | https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json | 키 불필요 |
| GitHub Advisory | `GET https://api.github.com/advisories` | [문서](https://docs.github.com/en/rest/security-advisories/global-advisories). 비인증 시간당 60회, 인증 5,000회([문서](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)) |
| OSV | https://storage.googleapis.com/osv-vulnerabilities/npm/modified_id.csv | 약 8.7MB. 전체 CSV는 약 157MB |
| EPSS | https://api.first.org/data/v1/epss?cve=... | |
| NVD | https://services.nvd.nist.gov/rest/json/cves/2.0 | |
| endoflife.date | https://endoflife.date/api/v1/products/{제품} , 달력 https://endoflife.date/calendar/nodejs.ics | 제품 487개. [Beta라 깨질 수 있음](https://github.com/endoflife-date/endoflife.date/) |
| Node 릴리스 | https://nodejs.org/dist/index.json , https://raw.githubusercontent.com/nodejs/Release/main/schedule.json | `security`·`lts` 불린 포함 |
| OpenRouter 모델 | https://openrouter.ai/api/v1/models | 키 불필요. 452개, `pricing`, `created`, `expiration_date` 포함 |
| OpenRouter 순위 | `/api/v1/datasets/rankings-daily`, `/app-rankings`, `/benchmarks` | [문서](https://openrouter.ai/docs/cookbook/administration/data-api): API 키 필요, 분당 30·일 500회, CC BY 4.0 |
| models.dev | https://models.dev/api.json | 공급사별 모델·`release_date`. 비공식 커뮤니티 집계 |
| LiteLLM 가격표 | https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json | 비공식 |
| Artificial Analysis | `GET /api/v2/language/models/free` | [API 문서](https://artificialanalysis.ai/data-api/docs). 키 없이는 401 |
| Arena(옛 LMArena) | https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset | CC-BY-4.0, 조사일 기준 마지막 수정 2026-10-30 |
| Hugging Face | `https://huggingface.co/api/models?sort=trendingScore&expand[]=trendingScore&expand[]=createdAt` , `https://huggingface.co/api/models?author=Qwen&sort=createdAt` , `https://huggingface.co/api/daily_papers` , `https://huggingface.co/api/papers?sort=trending` , `https://huggingface.co/api/trending` | 키 불필요 |
| MCP 공식 레지스트리 | https://registry.modelcontextprotocol.io/v0.1/servers | `publishedAt`, `status` 포함 |
| npm | https://api.npmjs.org/downloads/point/last-week/{이름} (쉼표로 여러 개), `/downloads/range/last-month/{이름}` , https://registry.npmjs.org/{이름}/latest | |
| PyPI | https://pypistats.org/api/packages/{이름}/recent , https://pypi.org/pypi/{이름}/json | |
| arXiv | https://export.arxiv.org/api/query | |
| HN | https://hn.algolia.com/api/v1/search | 관심도 교차 확인용 |
| 상태 페이지 JSON | `{상태 도메인}/api/v2/incidents.json` | Vercel·Cloudflare·Supabase·GitHub·Claude·OpenAI 공통(Statuspage 또는 호환 형식). `impact` 필드 포함 |
| Google Cloud 장애 | https://status.cloud.google.com/incidents.json | |
| AWS 공개 장애 | https://health.aws.amazon.com/public/events | JSON이지만 **UTF-16** 인코딩 |

**C. 피드는 없지만 마크다운 원본 있음 (날짜 머리글 파싱 또는 어제 사본과 비교)**

| 대상 | 주소 |
|---|---|
| OpenAI 변경 기록·지원 종료·가격 | https://developers.openai.com/api/docs/changelog.md , https://developers.openai.com/api/docs/deprecations.md , https://developers.openai.com/api/docs/pricing.md |
| Anthropic 지원 종료·가격·요청 한도 | https://platform.claude.com/docs/en/about-claude/model-deprecations.md , https://platform.claude.com/docs/en/about-claude/pricing.md , https://platform.claude.com/docs/en/api/rate-limits.md |
| Gemini 변경 기록·지원 종료·가격·요청 한도 | https://ai.google.dev/gemini-api/docs/changelog.md.txt , https://ai.google.dev/gemini-api/docs/deprecations.md.txt , https://ai.google.dev/gemini-api/docs/pricing.md.txt , https://ai.google.dev/gemini-api/docs/rate-limits.md.txt |
| Mistral | https://docs.mistral.ai/resources/changelogs.md (옛 주소는 이리로 이동) |
| DeepSeek | https://api-docs.deepseek.com/updates.md (최신 항목 2026-10-17) |
| Windsurf | https://docs.devin.ai/desktop/changelog.md |
| Claude Code / Copilot CLI 전체 기록 | https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md , https://raw.githubusercontent.com/github/copilot-cli/main/changelog.md |

**D. HTML을 읽어야 하거나 사실상 수집 불가**

- [Google Play 정책 마감일](https://support.google.com/googleplay/android-developer/answer/9934569): 마감일·공고일·설명이 구조화된 HTML이고 피드 언급이 없다. 최신 공고일 2026-10-29, 가장 먼 마감일 2027-08-25.
- Vercel·Supabase 등 [요금제 페이지](https://vercel.com/pricing): 피드 없음. 1.2MB HTML이라 본문 추출 뒤 비교해야 한다.
- [AWS 사후 분석 목록](https://aws.amazon.com/premiumsupport/technology/pes/): HTML. 피드는 찾지 못했다.
- [Anthropic 뉴스](https://www.anthropic.com/news): RSS 링크 없음, `/rss.xml` 404. https://mistral.ai/news/rss.xml 도 404. 개발자에게 필요한 내용은 위 릴리스 노트로 대체된다.
- https://arena.ai/leaderboard , https://lmarena.ai/leaderboard : 일반 요청에 403. 데이터셋을 써야 한다.
- 알아 둘 함정: `developers.openai.com/changelog/rss.xml`, `cursor.com/rss.xml`(200을 주지만 HTML), `developers.cloudflare.com/changelog/index.xml`, `kiro.dev/changelog/feed.xml`은 피드가 아니다.

### Inferences
- 수집기는 네 종류면 된다: ①피드 읽기(`feeds` 명령 재사용), ②JSON 읽기, ③마크다운/JSON 스냅샷 저장과 어제 대비 비교, ④드문 HTML 추출. 가격·한도·지원 종료는 ③이 핵심이므로 **어제 사본을 저장하는 것이 필수 설계 요소**다. 피드를 읽는 것만으로는 조용히 바뀐 내용을 잡지 못한다.
- AI 판단 전에 숫자로 걸러지는 신호: KEV 신규, GHSA 심각도+주간 다운로드, 상태 페이지 `impact`, 지원 종료 날짜 임박(D-30 등), 가격 숫자 변화, 신규 모델 ID, Node `security:true`, semver 메이저/마이너, 다운로드 증가율. AI가 필요한 것: "내 코드에 무엇을 해야 하나" 요약, 호환성 파괴 여부 판단, 같은 사건 묶기, 한국어 설명.
- OpenRouter 순위, Artificial Analysis는 무료지만 키가 필요하므로 키 관리 부담이 추가된다. 처음에는 키 없는 소스만으로 시작할 수 있다.

### Gaps
- 각 사이트의 `.md` 제공이 공식 약속인지는 확인하지 못했다. OpenAI 문서는 머리말에서 마크다운 버전과 `llms.txt`를 안내하지만 나머지는 응답으로만 확인했다. 언제든 사라질 수 있으므로 실패 알림이 필요하다.
- 각 약관(스크래핑·재게시 허용)은 OpenRouter, Arena를 빼면 확인하지 않았다.

## AI 모델: 출시, 가격, 지원 종료, 요청 한도, 벤치마크

### Takeaway
가장 값진 것은 지원 종료 날짜와 가격 변화이고, 이 둘은 AI 없이 스냅샷 비교로 뽑을 수 있다. 벤치마크·순위는 매일 싣기엔 소음이 많아 "주요 공급사 신규 모델이 상위권에 진입" 같은 사건일 때만 싣는 편이 맞다.

### Cited Findings
- 무엇이 실제로 올라오는가: OpenAI 지원 종료 문서는 `### 2026-10-14: GPT-4 series model deprecations`, `### 2026-10-01: GPT-5.3-Codex, GPT-5.1, GPT-5.4-Nano`처럼 날짜 머리글을 쓴다. 파싱이 쉽다 — [OpenAI Deprecations](https://developers.openai.com/api/docs/deprecations.md)
- Anthropic은 지원 종료를 이메일과 문서로 알린다고 명시한다 — [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations.md)
- Gemini는 stable·preview 모델과 관리형 에이전트의 지원 종료 일정을 한 페이지에 둔다 — [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations.md.txt)
- OpenRouter 모델 목록의 `expiration_date`가 실제로 값을 가진다(예: `z-ai/glm-4.7` 2026-12-31, `bytedance-seed/seed-1.6` 2026-11-11). 주요 공급사 밖 모델의 종료까지 잡을 수 있다 — [실측 openrouter models](https://openrouter.ai/api/v1/models)
- rankings-daily는 하루 상위 50개 공개 모델의 토큰 사용량을 주며, OpenRouter를 지나는 트래픽만 반영하고 공급사별 토크나이저 차이로 비교가 근사치다. 숫자가 다시 계산될 수 있어 `meta`를 기록하라고 안내한다 — [OpenRouter Data API](https://openrouter.ai/docs/cookbook/administration/data-api)
- `/api/v1/benchmarks`가 Artificial Analysis, Design Arena, OpenRouter 자체 평가 점수를 모아 준다 — [같은 문서](https://openrouter.ai/docs/cookbook/administration/data-api.md)
- Artificial Analysis 무료 API는 모든 이용에 출처 표시를 요구한다. 일 1,000회라는 수치는 검색 결과의 [접근 안내 페이지](https://artificialanalysis.ai/api-access-preview) 스니펫에서 나왔는데, 조사일에 그 페이지를 직접 열면 404였다. 무료 엔드포인트 이름은 [API 문서](https://artificialanalysis.ai/data-api/docs)에서 확인했다.
- Arena는 리더보드 전체 이력을 HF 데이터셋으로 공개한다. 14개 subset, 각각 `latest`와 `full` split — [Arena 공지](https://arena.ai/blog/arena-leaderboard-dataset/). 공식 REST API는 찾지 못했다. LMArena→Arena 개명(2026-01-28)은 제3자 글에만 있다 — [benchlm](https://benchlm.ai/alternatives/lmarena)
- HF 트렌딩 상위는 조사일에 `Nanbeige/Nanbeige4.3-33B`, `deepseek-ai/DeepSeek-V4.1-Flash-1017`로 점수·다운로드·생성일이 함께 온다 — [실측](https://huggingface.co/api/models?sort=trendingScore&limit=3)
- 요청 한도 변경은 공식 피드에서 잘 보이지 않을 수 있다. Anthropic의 2026년 7월 API 한도 상향은 ClaudeDevs X 계정 공지로 전해졌다는 제3자 보도가 있다(원문 미확인) — [aicatchup](https://aicatchup.com/news/claude-platform-api-rate-limits-tier-simplification)
- 공개 가중치 공급사: Qwen은 `github.com/QwenLM/Qwen/releases.atom`이 항목 0개라 쓸모없고, 대신 HF `author=Qwen`이 동작한다. DeepSeek·Mistral·meta-llama도 동일 — [실측 Qwen](https://huggingface.co/api/models?author=Qwen&sort=createdAt&limit=3)

### Inferences
| 신호 | 실을 것 | 잡음 거르기 | 소스 |
|---|---|---|---|
| 모델 출시 | 주요 7개 공급사의 새 세대·새 등급, API 이용 가능 시점 | 날짜 스냅샷 변형, 파인튜닝, 양자화 제외. OpenRouter/models.dev에 새 ID 등장 + 공식 변경 기록 언급을 함께 요구 | 공식 변경 기록 + HF author + models.dev |
| 가격 | 입력·출력 단가 변화, 캐시·배치 조건 변화 | 숫자가 바뀐 경우만. 신규 모델 가격은 출시 항목에 합침 | pricing.md 비교, LiteLLM·OpenRouter 교차 확인 |
| 지원 종료 | 새 공지(1회)와 마감 D-30, D-7(재알림) | 이미 실은 공지는 날짜 임박 때만 재등장 | deprecations.md 4곳 |
| 요청 한도 | 등급별 숫자 변화 | 숫자 변화만 | rate-limits.md 비교 |
| 벤치마크 | 추적 공급사 신규 모델이 코딩·종합 상위 N에 진입 | 순위 변동만으로는 싣지 않음. 지표 하나로 단정하지 않음 | Arena 데이터셋, AA, OpenRouter benchmarks |
| 사용량 순위 | 주 1회 급상승만 | 전주 대비 큰 변화 | rankings-daily |

- 가격 교차 확인이 필요한 이유: 비공식 집계(LiteLLM, models.dev)는 늦거나 틀릴 수 있어 단독 근거로 쓰면 안 된다.

### Gaps
- OpenAI의 요청 한도 공식 문서 주소는 마크다운으로 확인하지 못했다.
- Meta는 공식 변경 피드를 찾지 못했다. `meta-llama/llama-models` releases.atom은 존재하지만 최신일을 보지 않았고, [ai.meta.com/blog](https://ai.meta.com/blog/)는 HTML이다.
- HF `sort=trendingScore`, `/api/trending`, `/api/papers`가 공식 문서에 있는지 확인하지 못했다(동작은 확인).
- Qwen 공식 변경 기록 페이지는 찾지 못했다.

## AI 코딩 도구 변경 기록과 MCP

### Takeaway
공식 피드는 대부분 있으나 양이 문제다. Claude Code, Codex는 거의 매일 릴리스를 내므로 릴리스 단위로 싣지 말고, 주간 묶음 또는 "기본 동작·요금·모델 변경"만 싣는다.

### Cited Findings
- Claude Code: 피드의 10개 항목이 전부 10월 20일 이후이고 최신은 v2.1.316(10-31). 약 2주에 10건 이상 — [실측](https://github.com/anthropics/claude-code/releases.atom)
- Codex: `rust-v0.167.0-alpha.1`, `0.166.0`처럼 알파가 섞여 온다. 프리릴리스 제외가 필요하다 — [실측](https://github.com/openai/codex/releases.atom)
- Cursor: 10월에 4건(최신 10-20 "Agent SDK")으로 양이 적당하고 제목이 기능 단위다 — [실측](https://cursor.com/changelog/rss.xml)
- Windsurf: `windsurf.com/changelog`는 `docs.devin.ai/desktop/changelog`로 넘어간다. `windsurf.com/feed.xml`은 아직 살아 있으나 제목이 "Codeium Blog Posts"이고 실제 최신 글이 2026-05-12이므로 추적용으로 부적합하다 — [실측 피드](https://windsurf.com/feed.xml), [변경 기록](https://docs.devin.ai/desktop/changelog.md)
- Copilot: GitHub Changelog 피드는 항목이 10개뿐이고 전부 10월 28일로, 공지가 몰린 날에는 놓칠 수 있다. 하루 1회 수집으로는 아슬아슬하다 — [실측](https://github.blog/changelog/label/copilot/feed/)
- MCP 공식 레지스트리는 공개 JSON API이며 등록이 곧 품질을 뜻하지는 않는다(첫 항목이 임의의 서드파티 서버였다) — [실측](https://registry.modelcontextprotocol.io/v0.1/servers?limit=1)

### Inferences
- 실을 것: 기본 모델 변경, 요금·사용량 구조 변경, 자동 실행·권한 동작 변경, 설정/명령 호환성 파괴, 새 워크플로(백그라운드 에이전트, SDK 공개 등).
- 거를 것: 버그 수정만 있는 패치, alpha/nightly, UI 다듬기. 기계 필터는 프리릴리스 제외와 `breaking|deprecat|removed|default|pricing|model` 본문 키워드까지이고, 남은 것은 AI가 고른다.
- MCP 서버는 신규 서버를 매일 싣는 것이 소음이다. 실을 것은 명세 릴리스, 레지스트리 정책 변경, 공식 벤더 서버 출시 정도이고, MCP 관련 보안 사고는 보안 분류로 보낸다.
- 다른 도구 카테고리의 Kiro, Zed, Aider는 핵심에서 뺄 수 있다. Zed와 Aider는 HTML 페이지 존재만 확인했다.

### Gaps
- MCP 레지스트리의 전체 건수와 일일 등록량은 재지 않았다.
- 어떤 키워드 조합이 실제로 정밀도가 좋은지는 몇 주치 데이터로 시험이 필요하다.

## 프레임워크·런타임·언어

### Takeaway
공식 피드가 모두 있어 수집은 쉽다. 핵심 필터는 semver와 "유지보수 일정 변경"이다. 패치는 보안 수정이 아니면 버린다. 지원 종료는 endoflife.date로 날짜 계산이 된다.

### Cited Findings
- endoflife.date v1은 릴리스별로 `isLts`, `ltsFrom`, `eolFrom`, `eoasFrom`, `isMaintained`, `latest`를 준다. Node 26은 2026-10-28에 LTS가 됐고 EOL은 2029-04-30이다 — [실측](https://endoflife.date/api/v1/products/nodejs). API는 Beta라 파괴적 변경이 있을 수 있다 — [저장소](https://github.com/endoflife-date/endoflife.date/). 엔드포인트 목록은 [OpenAPI](https://endoflife.date/docs/api/v1/openapi.yml)에 있고, 변경분만 주는 엔드포인트는 없다.
- `nodejs.org/dist/index.json`의 `security:true`로 보안 릴리스를 기계적으로 고를 수 있다. 최근 값: v26.12.1(10-21), v26.5.1(07-28), v26.3.1(06-17) — [실측](https://nodejs.org/dist/index.json)
- Node 피드에는 `27.0.0-alpha`도 섞여 온다 — [실측](https://nodejs.org/en/feed/releases.xml)
- 보안 사전 공지가 피드에 온다. Next.js 피드에 "Upcoming Next.js November Security Release"가 올라와 있다 — [실측](https://nextjs.org/feed.xml). 직전 10월 14일 긴급 릴리스는 치명적 RCE 2건(`use cache`, 이미지 최적화)을 고쳤고 — [Next.js](https://nextjs.org/blog/nextjs-security-update-october-14-2026), `use cache` 건은 우회책이 없어 업그레이드만이 해결책이다.
- Python은 한 글에 여러 버전이 묶여 온다("3.15.2, 3.14.10, 3.13.18, 3.12.16 and 3.11.18 are out") — [실측](https://blog.python.org/feeds/posts/default)
- 조사일 최근 항목: React 19.3(10-27), TypeScript 7.1 Beta(10-20), Bun v1.4.4(10-31) — [React](https://react.dev/rss.xml), [TS](https://devblogs.microsoft.com/typescript/feed/), [Bun](https://bun.com/rss.xml)

### Inferences
- 실을 것: 메이저, 호환성 파괴가 있는 마이너, 베타→정식 전환, 보안 릴리스, LTS 전환, EOL D-90/D-30.
- 추적 목록은 웹 개발자 기준으로 작게 유지한다: Node, TypeScript, React, Next.js, Vite, Python, Bun, Rust 정도. Bun은 잦은 마이너 릴리스가 많아 마이너 기준을 주요 버전으로 올리는 편이 낫다.
- 버전 판정은 정규식으로 끝난다. "호환성 파괴가 있는가"만 AI가 본문을 읽고 판단한다.
- "npm trends"는 서비스 이름일 뿐 API는 npm 공식 다운로드 API를 쓰면 된다.

### Gaps
- Vite, pnpm, Deno, Go 등은 이번에 확인하지 않았다. GitHub `releases.atom`이 범용 대안이다.
- 사전 공지된 Next.js 11월 보안 릴리스는 조사일 현재 내용이 공개되지 않았다.

## 보안: KEV, GHSA, npm 공급망, 주요 CVE

### Takeaway
"심각도 critical"만으로는 부족하다. npm만 10월에 56건이다. 쓰는 사람이 많은 패키지(주간 다운로드)와 실제 악용(KEV) 조건을 더하면 하루 0~1건으로 줄일 수 있다. 공급망 공격은 CVE 체계로 늦게 잡히므로 벤더 블로그가 주 경로다.

### Cited Findings
- KEV: 총 1,766건, 2026년 추가 282건, 최근 90일 110건(하루 약 1.2건), 최신 추가 10-30. 필드에 `vendorProject`, `product`, `dateAdded`, `dueDate`, `knownRansomwareCampaignUse`가 있다 — [실측](https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json)
- 최근 90일 KEV에 AI·개발 도구가 실제로 있다: BerriAI, MLflow, Ray-Project, Langflow, JFrog, Gitea, GitLab, JetBrains — [실측, 같은 주소]. Langflow는 5~8월에 4건 추가됐다.
- GHSA `GET /advisories`: `type`은 reviewed(기본)·malware·unreviewed이고 **악성코드는 `type=malware`를 줘야 나온다**. `ecosystem`, `severity`, `published`, `modified`, `sort=epss_percentile` 지원 — [GitHub 문서](https://docs.github.com/en/rest/security-advisories/global-advisories)
- 필터 시험(직접 측정, 2026-10-01 이후 npm): critical 56건 + high는 100건에서 잘림. 합계 156건 중 패키지 주간 다운로드 100만 이상이 29건, 10만 이상이 34건. critical이면서 100만 이상이 28건(패키지 중복 포함). 상위는 proxy-addr, shell-quote, dompurify, next, tinypool, handlebars, seroval이다 — [실측](https://api.github.com/advisories?per_page=100&ecosystem=npm&severity=critical&published=%3E=2026-10-01)
- EPSS는 신규 공지 다수에서 값이 없고(next RCE도 None), 값이 있어도 낮았다. 신규 공지 필터로는 쓸 수 없다 — [실측 동일 응답]
- `type=malware`는 npm에서 7일(10-25 이후)에 100건 상한에 닿았다. 이름은 대개 무명 패키지다(`@mamans2973/maman`) — [실측](https://api.github.com/advisories?per_page=2&ecosystem=npm&type=malware)
- 2026년 공급망 사건: 5월 Mini Shai-Hulud(TanStack, Mistral AI, UiPath), 유효한 증명이 붙은 악성 패키지 — [AgentGuard](https://agentguard.gopluslabs.io/advisor/AGS-2026-0001), CVE-2026-45321 — [CERT.ug](https://cert.ug/node/301); 8월 Shai-Hulud 재발(Keyv, Cacheable). 규모는 444~868개 패키지로 집계가 갈린다 — [Nopal Cyber](https://www.nopalcyber.com/threat-hunting-advisory/august-6th%2C-2026)
- 코딩 도구도 표적이다: 5월 공격은 Claude Code와 VS Code에 지속 장치를 심었고 — [AgentGuard](https://agentguard.gopluslabs.io/advisor/AGS-2026-0001), 조사일 Socket 피드 최신 글은 "Cursor Removes Malicious Claude Code 2.1.313 Extension From Its Marketplace"다 — [실측](https://socket.dev/api/blog/feed.atom)
- 오픈소스 악성 패키지 DB가 있다 — [ossf/malicious-packages](https://github.com/ossf/malicious-packages). OSV 일괄 CSV는 [실측](https://storage.googleapis.com/osv-vulnerabilities/npm/modified_id.csv)으로 확인.
- `npmjs.com/advisories`는 일반 요청에 403이다 — [실측](https://www.npmjs.com/advisories)

### Inferences
- 제안 규칙(자동, AI 전):
  1. KEV 신규 중 개발 도구·프레임워크·AI 인프라 벤더 허용 목록 일치.
  2. GHSA critical이고 주간 다운로드 ≥100만, 또는 추적 프레임워크(next, react, vite 등)면 high부터.
  3. malware 공지 중 주간 다운로드 ≥10만, 또는 정상 패키지의 특정 버전이 감염된 경우. 무명 패키지 악성코드는 버린다.
  4. Socket·Aikido 글 제목에 공격·침해 어휘 + 패키지명이 있으면 AI 후보로 보낸다.
- 28건이면 여전히 하루 1건꼴이므로 "RCE/인증 우회/비밀 유출이고 기본 설정에서 도달 가능" 판단은 AI가 해야 한다. proxy-addr이 다운로드 1위인 것처럼 전이 의존성은 다운로드가 커도 체감 영향이 다르다.
- 독자 행동 문구가 가치의 핵심이다: 영향 버전, 고친 버전, lockfile 확인, 토큰 회전 필요 여부. GHSA에 `vulnerabilities[].first_patched_version` 류 필드가 있어 앞의 두 가지는 추출로 된다(필드명은 구현 때 확인).
- 공급망 사고는 벤더 집계가 엇갈리므로 건수를 단정하지 말고 범위나 출처를 표기한다.

### Gaps
- GHSA 필터 수치는 한 달치·high 절단 표본이다. 실제 일일 건수는 페이지를 넘겨 재야 한다.
- NVD의 최근 정책·적체 상태는 확인하지 못했다. 공지 페이지가 이전되어 있었다.
- 2026년 8월 이후 공급망 대형 사건은 검색에서 찾지 못했다(없다는 뜻은 아니다).
- 시스템 위협 등 AI 스택 전용 취약점 DB는 조사하지 않았다.

## 클라우드·플랫폼: 가격, 무료 한도, 장애, 스토어 정책

### Takeaway
장애는 JSON으로 쉽게 잡히지만 실을 가치가 있는 것은 극소수다. 무료 한도·가격 인하/인상은 공식 피드 제목에 일부만 잡히므로 요금 페이지 스냅샷 비교가 필요하다. Apple은 공식 RSS로, Google Play는 HTML로 잡는다.

### Cited Findings
- 10월 상태 페이지 사건 수(impact별, 최근 25~50건 범위): Vercel 5(major 3), Cloudflare 49(critical 1, major 6), Supabase 17(major 3), GitHub 25(critical 8, major 2), Claude 17(critical 1, major 10), OpenAI 25(major 4) — [실측 Vercel](https://www.vercel-status.com/api/v2/incidents.json), [Cloudflare](https://www.cloudflarestatus.com/api/v2/incidents.json), [Supabase](https://status.supabase.com/api/v2/incidents.json), [GitHub](https://www.githubstatus.com/api/v2/incidents.json), [Claude](https://status.claude.com/api/v2/incidents.json), [OpenAI](https://status.openai.com/api/v2/incidents.json)
- 위 목록에서 `postmortem_body`가 채워진 사건은 0건이었다. 사후 분석은 이 API로 얻을 수 없다고 봐야 한다(같은 실측).
- AWS RSS 최신 항목은 9월 15일이고 앞선 항목은 4월 30일이라 RSS는 드물게 움직인다. 공개 이벤트 JSON에는 시작·종료 시각과 상세 로그가 있다 — [RSS](https://status.aws.amazon.com/rss/all.rss), [이벤트](https://health.aws.amazon.com/public/events)
- 양: AWS What's New는 100건이 약 12일(10-20~11-01)치로 하루 약 8건, Cloudflare 변경 기록은 10월 140건, Vercel은 10월 119건, Supabase는 13건 — [AWS](https://aws.amazon.com/about-aws/whats-new/recent/feed/), [Cloudflare](https://developers.cloudflare.com/changelog/rss/index.xml), [Vercel](https://vercel.com/atom), [Supabase](https://supabase.com/changelog/rss.xml)
- Vercel 피드 제목 키워드(pricing, billing, deprecat 등)만으로 10월에 4건이 걸렸다: "Mistral Large 4 updated weights and lower pricing on AI Gateway", "Deployment Storage billing begins for existing Pro teams", "Speed Insights deprecates First Input Delay on November 1st", "Deleted deployments are permanently removed sooner". Supabase는 "Framework adapters in @supabase/server are deprecated" 1건 — 같은 피드 실측. 같은 키워드가 다른 피드에서는 제목으로 0건이었으므로 본문 검사가 필요하다.
- `vercel.com/atom`은 블로그와 변경 기록이 섞인 4.6MB 전체 이력이다(`/changelog/rss`도 같은 크기). 조건부 요청이나 앞부분만 읽기가 유리하다 — [실측](https://vercel.com/atom)
- Cloudflare 사후 분석 RSS 최신은 2026-05-01이다. 10월 critical 1건이 있었음에도 이 태그에는 신규가 없다 — [실측](https://blog.cloudflare.com/tag/post-mortem/rss/)
- Apple 개발자 뉴스는 규정 변경이 제목에 드러난다: "Updated App Review Guidelines are now available"(10-16), "Updated Apple Developer Program License Agreement now available"(10-13, 08-18, 06-18), "Updates to age ratings for the Republic of Korea"(08-12) — [실측](https://developer.apple.com/news/rss/news.rss)
- Google Play 정책은 마감일 페이지에서 공고일·마감일을 얻을 수 있다 — [Policy Deadlines](https://support.google.com/googleplay/android-developer/answer/9934569)
- 무료 한도 변경은 제3자 추적 사이트가 있다: Supabase 비활성 프로젝트 일시 중지 기간 단축(2026-02-01)을 전하나 공식 확인은 못 했다 — [agentdeals](https://agentdeals.dev/vendor/supabase), [costbench](https://costbench.com/changelog/supabase-plan-added-2026-02/)

### Inferences
- 장애 필터: `impact`가 major/critical이고 **지속 시간 2시간 이상** 또는 **여러 핵심 구성요소 영향**인 것. GitHub·Claude는 그래도 잦아서 "대형"은 시간 기준을 더 높이거나, 사후 분석이 나왔을 때만 싣는 편이 낫다. 커넥터 등 주변 기능 장애는 뺀다. 빌더에게 더 쓸모 있는 것은 실시간 알림이 아니라(다음 날 브리핑은 이미 늦다) **사후 분석에서 얻는 교훈**이다.
- 가격·무료 한도: 추적 대상 몇 개의 요금 페이지 본문을 저장해 비교하고, 변화가 있으면 AI가 무엇이 바뀌었는지 해석한다. 페이지 재배치에 따른 거짓 경보가 있으므로 숫자 추출 비교가 낫다. 제3자 추적 사이트는 근거로 쓰지 않는다.
- AWS What's New는 그대로 쓰기엔 많다. Lambda, S3, Bedrock 등 웹 개발자 관련 서비스와 가격 인상·지원 종료 키워드로 좁힌다.
- 스토어 정책: 정책 변화 뉴스는 주 0~1건 수준이라 그대로 후보로 보내도 된다. 다만 8년차 웹 개발자에게 앱 스토어 관련성은 낮으므로 AI 플랫폼 수수료·에이전트 앱 규정 같은 큰 건만 싣는 것을 검토한다.

### Gaps
- 상태 페이지 수치는 API가 주는 최근 25~50건 범위라 Cloudflare 등은 10월 전체가 아닐 수 있다.
- Azure, Netlify, Railway, Fly.io는 조사하지 않았다.
- Vercel의 2026년 무료 한도 축소 여부는 공식 출처로 확인하지 못했다.
- Vercel·Supabase·Cloudflare의 요금 페이지가 정적 추출로 숫자를 얻을 수 있는지는 시험하지 않았다.

## 패키지 다운로드 추세와 논문: arXiv, Papers with Code 후속

### Takeaway
Papers with Code는 끝났고 주소는 HF Trending Papers로 넘어간다. 다운로드 추세는 계산이 쉬우나 CI·전이 의존성 영향이 커서 매일 실을 신호는 아니며, 주간 급상승 후보 발굴 정도가 적당하다. 논문은 이 섹션의 독자에게는 코드가 붙고 화제가 된 것만 드물게 싣는다.

### Cited Findings
- `paperswithcode.com/`과 `paperswithcode.com/api/v1/papers/` 모두 `huggingface.co/papers/trending`으로 이동한다. 즉 옛 API는 죽었다 — [실측](https://paperswithcode.com/)
- 2025년 7월 Meta가 종료했고 HF가 Trending Papers를 후속으로 내놓았다 — [hyper.ai](https://hyper.ai/en/news/42900). 벤치마크 추적까지 대체하지는 않는다는 평가가 있다 — [Codesota](https://www.codesota.com/papers-with-code)(자사 제품 홍보 성격 있음)
- HF `daily_papers`는 `upvotes`, `githubRepo`, `githubStars`, `ai_summary`, `ai_keywords`를 준다. `https://huggingface.co/api/papers?sort=trending`도 응답한다 — [실측](https://huggingface.co/api/daily_papers?limit=2)
- arXiv cs.AI RSS는 조사일 하루 605개 항목이었다. 그대로는 쓸 수 없다 — [실측](https://rss.arxiv.org/rss/cs.AI)
- Semantic Scholar 무인증 요청은 429를 받았다. [OpenAlex](https://api.openalex.org/works?per-page=1)는 응답한다. alphaXiv는 사이트만 살아 있고 공개 API는 확인하지 못했다 — [실측](https://alphaxiv.org/)
- npm API는 주간 수치를 쉼표로 묶어 받을 수 있다(next 약 9,062만, react 2.45억, vite 2.52억/주) — [실측](https://api.npmjs.org/downloads/point/last-week/next,react,vite). 집계 끝이 조사일보다 며칠 전(10-29)이므로 지연을 감안해야 한다.
- 범위 조회는 약 18개월로 잘리고 경고가 없다 — [TanStack](https://tanstack.com/blog/npm-stats-the-right-way). 패키지 단위 API라 "전체 중 급상승 목록"은 없다.
- `pypistats`는 일/주/월 합계를 준다 — [실측](https://pypistats.org/api/packages/fastapi/recent)
- Best of JS 추정 주소 `bestofjs-static-api.vercel.app/projects.json`은 응답하지만 날짜가 2024-08-10이라 오래됐다 — [실측](https://bestofjs-static-api.vercel.app/projects.json). 사이트 자체는 살아 있다 — [bestofjs.org](https://bestofjs.org/)

### Inferences
- 추세 계산: 후보 패키지 목록(프레임워크, AI SDK, MCP SDK, 공급사 SDK)을 매일 저장하고 주간 합계 전주 대비 ≥30%, 절대 증가량 하한(CI 잡음 제거)을 적용한다. 저장소에 시계열을 쌓는 방식이다. 후보 목록을 넘는 발견은 HN, GitHub 트렌딩, HF 트렌딩에서 온다.
- 다운로드는 "쓰인다"의 증거가 약하다. 주간 묶음 항목으로 두고, 단독 기사 사유로 쓰지 않는 편이 맞다.
- 논문 필터: HF upvotes 상위 + `githubRepo` 있음 + 주요 연구소 또는 HN 화제. 주 1~2건이면 충분하다.

### Gaps
- GitHub 트렌딩의 공식 API는 없는 것으로 알지만 이번에 확인하지 않았다.
- HF 논문 API의 호출 한도와 문서화 여부는 확인하지 못했다.
- npm의 다운로드 집계 지연의 공식 설명은 확인하지 않았다.

## 하루 소량 유지를 위한 기본 구성

### Takeaway
매일 2~4건은 "지금 조치"(보안, 지원 종료 마감, 호환성 파괴)와 "알아 둘 변화"(모델·가격·도구)의 기계 필터 통과분으로 채우고, 추세·벤치마크·논문은 주간으로 돌리는 구성이 현실적이다.

### Cited Findings
- 근거 수치는 위 각 절의 실측이다: KEV 하루 약 1.2건, npm critical 고다운로드 하루 약 1건, 도구 변경 기록은 거의 매일, 장애는 공급사별 월 수~수십 건.

### Inferences
- 수집 단계 우선순위: ①보안(KEV+GHSA+Socket), ②모델 지원 종료·가격 스냅샷, ③코딩 도구 변경 기록, ④프레임워크 릴리스, ⑤장애·사후 분석, ⑥추세·논문.
- 공통 처리: 이미 실은 항목 기억(같은 CVE·패키지·모델 중복 방지), 기계 필터 통과 이유를 항목에 남겨 AI 판단을 검증 가능하게 하기, 소스별 실패 감지(피드 주소 변경이 잦다: `windsurf`, `mistral`, OpenAI 문서 이전 사례).
- GitHub 비인증 한도는 시간당 60회라 `releases.atom`은 괜찮지만 Advisory API를 패키지별로 많이 부르려면 토큰이 필요하다.

### Gaps
- 이 필터가 실제로 하루 2~4건을 만드는지는 2~4주치 과거 데이터로 재현해 봐야 한다. 이번에는 단면만 쟀다.
