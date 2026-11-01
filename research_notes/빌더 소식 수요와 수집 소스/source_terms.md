# 빌더 소식 소스의 접근 규칙과 약관 (확인일 2026-11-01)

법률 자문이 아니다. 약관 해석은 비전문가의 판단이고, 불확실한 곳은 그렇게 적었다.

읽는 법:
- 전제: Tidwyn은 무료·공개·현재 비상업, 하루 1회 로컬 수집, AI가 한국어로 다시 쓰고 정적 사이트로 게시, 이미지는 링크만, 막힌 페이지는 우회하지 않는다.
- 확인 수준: **직접** = 공식 페이지를 WebFetch로 읽음 / **검색** = 도구가 막혀 검색 요약·2차 자료로만 봄(미확인). WebFetch는 요약 모델을 거치므로, 구현 전에 핵심 조항 원문을 사람이 다시 볼 것.
- 인용: 저작물 재현 제한 때문에 조항은 직접 인용 대신 풀어 썼고, 직접 인용은 Product Hunt 한 곳뿐이다. 근거 주소는 항목마다 달았다.
- 우회 안 함: `redditinc.com`, `reddit.com`, `stackoverflow.com`, `api.stackexchange.com`, `developer.x.com`, `support.reddithelp.com`, `crunchbase.com`, `indiehackers.com/terms`는 도구가 거부했다(403/402/차단). curl이나 브라우저로 다시 시도하지 않았다.

## 소스별 표: 어떤 소스를 쓸 수 있는가

### Takeaway
비용 없이 하루 1회 공개 게시에 가장 깨끗한 소스는 OpenRouter Data API(CC BY 4.0), npm, PyPI, Hugging Face, GitHub REST다. GeekNews, Product Hunt API, HN, dev.to, Bluesky는 조건부이고 본문보다 "제목·링크·수치 신호"로 쓰는 편이 안전하다. Reddit, X, Lobsters, Indie Hackers, Disquiet, Crunchbase, Artificial Analysis 무료 등급, Stack Overflow는 피한다.

### Cited Findings

표 1. 개발자 지표·데이터

| 소스 | 공식 API/RSS | 인증 | 한도 | 비용 | 상업·재배포 제한 | AI 사용·요약 제한 | robots.txt | 판정 |
|---|---|---|---|---|---|---|---|---|
| GitHub REST/Search | 있음 | 토큰 권장 | 비인증 60/시간, 인증 5,000/시간. 검색 인증 30/분, 비인증 10/분, 검색당 1,000건 | 무료 | 정보 이용 조항이 연구·보관 목적을 예시, 스팸·채용 판매 금지. 개인정보는 사용자가 허락한 목적으로만 | AI 금지 조항 못 찾음 | API 해당 없음 | OK(조건부): 저장소 메타데이터 위주, 개인정보 최소화 |
| GitHub Trending 페이지 | 공식 API 없음 | 없음 | 없음 | 무료 | AUP가 자동 추출을 스크래핑으로 정의 | 위와 같음 | `/trending` 금지 없음. 다만 파일 머리에 크롤링은 문의하고 API를 쓰라고 안내 | 피함 쪽 조건부: 검색 API로 대체 |
| GH Archive | 시간별 파일, BigQuery | 다운로드 없음, BigQuery는 자기 프로젝트 | 명시 없음 | 다운로드 비용 언급 없음, BigQuery 월 1TB 무료 | 라이선스 명시 못 찾음 | 언급 없음 | 미확인 | OK(조건부): 집계 수치만, GitHub 약관도 같이 적용된다고 볼 것 |
| OSS Insight | v1beta 공개 API | 없음 | IP당 600/시간, 전역 1,000/분 | 명시 없음 | 약관·라이선스 명시 없음. 코드 저장소는 Apache-2.0(데이터까지 덮는지 불명) | 언급 없음 | 사이트는 `/api/` 금지, AI 봇은 주요 페이지 허용. API 호스트의 파일은 미확인 | OK(조건부): 베타라 끊겨도 되게, 출처 표기 |
| Hugging Face Hub | 있음 | 토큰 선택 | 5분 창 익명 500, 무료 1,000 | 무료 | 공개 저장소는 다른 사용자에게 라이선스 부여. 모델·데이터 카드는 저장소별 라이선스 | 약관에 스크래핑·AI 재사용 금지 못 찾음(보조 약관 미확인) | 미확인(받은 내용이 robots 파일이 아니었음) | OK |
| npm registry·downloads | 공개 API | 없음 | 월 500만 요청이 넘으면 비합리적 사용. 크롤러 초당 1회 이하. 벌크 128패키지·365일 | 무료 | 공개 API로 복제 허용, 웹사이트 자동 크롤링 금지. 보안 데이터는 개인·내부 용도만 | AI 언급 없음 | 미확인 | OK: 다운로드 수는 사용, 취약점 데이터는 게시 금지 |
| PyPI·pypistats | JSON API, RSS, pypistats API | 없음 | PyPI 엣지 제한 없음(무책임하면 차단). pypistats는 IP 제한(수치 없음), 180일 보관, 하루 1회면 충분 | 무료 | 스팸·개인정보 판매 금지 | AI 언급 없음 | 페이지 크롤러용으로 JSON 경로 금지. API 문서는 사용을 안내 | OK: 고유 User-Agent, ETag 사용 |
| OpenRouter 순위 | Data API `rankings-daily`, `app-rankings` | API 키 필수 | 30/분, 500/일 | 명시 없음 | CC BY 4.0, 상업 재사용 가능. 경쟁 무료 API로 재제공은 의도 밖. 사이트 스크래핑은 금지 | 금지 없음 | 전체 허용(`/seo/` 제외) | OK: 정해진 출처 문구와 as_of 표기, 페이지 말고 API |
| Artificial Analysis | 있음 | API 키 | 1,000/일과 100/창으로 문서가 엇갈림 | 무료 등급 있음 | 무료 등급 내부 용도, 재배포 불가(검색 요약). 재배포는 상업 라이선스 | 언급 못 찾음 | 전체 허용 | 피함: 공개 게시는 허가 후. 무료 등급 재배포 문구는 공개 사이트와 충돌 |
| Google Trends | API는 알파(신청제). 인기 급상승 RSS 있음 | 알파 신청 | 쿼터 미공개 | 미공개 | 인용 표시하면 재사용 가능. 구글 약관 적용 | 약관이 robots 규칙 위반 자동 접근 금지. 구글 AI 산출물로 모델 개발 금지(본 건과 무관) | `/explore?` 금지 | OK(조건부): RSS만, 출처 표시. pytrends류 금지. RSS의 뉴스 스니펫은 쓰지 않음 |
| Crunchbase | 유료 API(영업 문의) | 키 | Enterprise 200/분, 동시 3 | 공개 무료 없음(Basic 종료는 2차 자료) | 스크래핑·자동 수집 금지, 제3자 배포 금지, 표기 링크 필수 | 생성 AI 학습 금지. 논평용 발췌는 표기 시 허용 | 미확인 | 피함 |

표 2. 커뮤니티·SNS·제품 발견

| 소스 | 공식 API/RSS | 인증 | 한도 | 비용 | 상업·재배포 제한 | AI 사용·요약 제한 | robots.txt | 판정 |
|---|---|---|---|---|---|---|---|---|
| Product Hunt | GraphQL v2, 공개 Atom `/feed` | 토큰 | 공정 사용 범위에서 제한 가능. 수치 문서 못 찾음 | 무료 | API 상업 금지. 약관은 크롤링·상당량 복제 금지(2014년 판) | 언급 없음 | AI 규칙 없음, 일반 경로 소수 금지 | OK(조건부): 비상업 동안 API만, 링크 표기. 광고 전 허가 |
| HN Firebase | 있음 | 없음 | 현재 제한 없음 | 무료 | YC 약관이 무단 크롤링·상업적 복제 제한. 저장소는 MIT | AI 조항 없음. 생성 글 금지 지침은 HN에 올리는 글 대상 | 사이트 지연 30초, 쓰기 경로 금지 | OK(조건부): 제목·점수·링크만, 댓글 재게시 금지 |
| HN Algolia | 있음 | 없음 | 공식 수치 확인 못 함 | 무료 | 별도 약관 못 찾음 | 언급 못 찾음 | 파일 없음(404) | OK(조건부): 위와 같음. 있으면 Firebase 우선 |
| Reddit | 있음 | OAuth, 사전 승인 | 100 QPM로 알려짐(2차) | 비상업 무료로 알려짐 | 상업은 서면 승인(2차) | 권리자 허락 없는 학습 불가(2차) | 확인 불가 | 피함 |
| Lobsters | 공개 RSS | 없음 | 지연 1초 | 무료 | 콘텐츠 라이선스 명시 없음 | `Content-Signal: ai-input=no, ai-train=no` | 알려진 검색봇 외 전면 금지 | 피함 |
| dev.to | Forem API v1, 읽기는 키 없이 일부 | 일부 키 | 읽은 범위에 명시 없음 | 무료 | 약관이 개인·비상업 일시 열람으로 한정, 복제·수정·공개 표시 금지 | AI 언급 없음 | AI 규칙 없음, `/api` 금지 없음 | OK(조건부): 제목·링크·태그만. 본문 재작성은 하지 않음 |
| GeekNews | RSS(`/rss/news`, FeedBurner로 이동), Atom 50건, 발췌 | 없음 | 과부하 자동 접근 금지 | 무료 | 재사용 규정 없음, 저작권 귀속 명시 없음 | 학습 금지 신호, 입력은 허용 신호 | `ai-train=no`, `ai-input=yes`, `search=yes`. `/api/` 금지 | OK(조건부): RSS로 발견만, 원문을 근거로 쓰고 "GeekNews 경유" 표기. GN⁺ 요약은 옮기지 않음 |
| Disquiet | 공개 API·RSS 못 찾음 | - | - | - | 사전 허락 없는 자동 수집 금지(2026-07-01 시행 통합 약관). 글 저작권은 회원 | AI 학습 조항 없음 | 전체 허용 | 피함: 운영사(픽셀릭코리아) 허락 후. robots 허용이 약관 금지를 없애지 않음 |
| X | 유료 API | 키 | 월 300만 포스트 읽기 상한 | 포스트당 $0.005, 무료 등급 언급 없음 | 원문 약관 확인 불가(402) | 학습 금지(2025-06 보도) | 일반 에이전트 전면 금지, AI 학습 토큰 금지 | 피함 |
| Bluesky | 공개 AppView API(`public.api.bsky.app`) | 공개 읽기 없음 | 호스팅 PDS IP당 3,000/5분(검색) | 무료 | 약관에 제3자 재사용 조항 없음, 글 권리는 작성자 | 약관에 AI·스크래핑 조항 없음. 개발자 지침 미확인 | `/intent/compose` 외 허용, 대량은 API를 안내 | OK(조건부): 링크와 소수 공개 글 위주, 삭제 글 재게시 안 함 |
| Stack Overflow | API 있음(미확인) | 미확인 | 미확인 | 미확인 | 사용자 글 CC BY-SA(표기 필요, 2차) | 생성 AI 목적 수집은 사전 서면 동의라는 2차 자료 | 확인 불가 | 피함: 약관 원문 확인 전까지 |
| Indie Hackers | 공식 RSS·API 못 찾음 | - | - | - | 약관 403으로 미확인 | ClaudeBot 등 AI 봇 전면 차단 | 일반 허용, 명명 AI 봇 전면 금지 | 피함 |
| 뉴스레터 RSS | 매체별 | - | - | 무료 | 아래 참고 | 아래 참고 | 아래 참고 | 매체별 |

뉴스레터별:
- Stratechery: 제한 콘텐츠 RSS는 리더 전용, 자동 수집 금지, 재배포 금지 → **피함**.
- Substack 계열(Lenny's 등): 공개 `/feed`는 robots 허용이고 피드가 전문을 담기도 한다. 그러나 약관이 크롤링과 상당량 복제를 금지한다 → **조건부**(공개 피드 제목·링크만, 유료 글 제외).
- Simon Willison: 공식 Atom 다수, 재사용 조건 표시 못 찾음 → **조건부**(요약+원문 링크).
- AINews(smol.ai): RSS 동작, 전문 포함, 권리 표시 없음 → **조건부**. 자체가 요약물이라 원문을 근거로 삼는다.
- TLDR: 약관에 RSS·재배포·AI 조항 없음, 공식 RSS 미확인 → **미정**.

근거:
- Product Hunt API: "The Product Hunt API must not be used for commercial purposes."([문서](https://api.producthunt.com/v2/docs)). 사업 용도는 Product Hunt에 메일로 문의(주소는 문서 참조), 링크 표기를 요청, 토큰 필요. 약관의 크롤링·상당량 복제 금지와 시행일 2014-08-17은 [legal](https://www.producthunt.com/legal). robots는 [파일](https://www.producthunt.com/robots.txt), Atom은 [feed](https://www.producthunt.com/feed)(이번 응답은 특정 카테고리 피드였음).
- GitHub: 한도는 [REST](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [Search](https://docs.github.com/en/rest/search/search). 스크래핑 정의, 정보 이용, 개인정보는 [AUP](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) 7·8절. API 남용 판단은 [약관 H절](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service). robots는 [파일](https://github.com/robots.txt).
- GH Archive: [공식 페이지](https://www.gharchive.org/). OSS Insight: [문서](https://ossinsight.io/docs/api/), [LICENSE](https://raw.githubusercontent.com/pingcap/ossinsight/main/LICENSE), [robots](https://ossinsight.io/robots.txt).
- HN: [Firebase API](https://github.com/HackerNews/API), [YC 약관](https://www.ycombinator.com/legal/), [지침](https://news.ycombinator.com/newsguidelines.html), [robots](https://news.ycombinator.com/robots.txt). Algolia 공식 페이지는 본문을 못 읽었고 [hn.algolia.com/api](https://hn.algolia.com/api), 흔히 도는 시간당 1만은 [제3자 코드 주석](https://glama.ai/mcp/servers/@sam3690/Hackernews_mcp/blob/7abf5075868b29341b93741cba0c893637e4bb36/src/lib/rate-limiter.ts)뿐이다.
- Reddit(전부 검색, 미확인): 사전 승인과 2025-11 셀프서비스 종료는 [r/redditdev 미러](https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/nocca6t), 학습 제한은 [the-decoder](https://the-decoder.com/?p=4180), 상업 승인은 [Medianama](https://www.medianama.com/2024/05/223-reddit-openai-deal-ai-integration-advertising/), 100 QPM은 [경쟁사 블로그](https://www.redditapis.com/reddit-responsible-builder-policy). "신규 접근 요청 2026-10-31 종료" 주장은 한 곳뿐이라 믿지 않는다.
- Lobsters: [about](https://lobste.rs/about)은 RSS 공개라고 하지만 [robots](https://lobste.rs/robots.txt)는 등록 봇 외 전면 금지이고 신호가 AI 입력 불가다. 두 문서가 엇갈리면 더 엄격한 쪽으로 판단했다.
- dev.to: [Forem API](https://developers.forem.com/api/v1), [약관](https://dev.to/terms) 2절, [robots](https://dev.to/robots.txt).
- GeekNews: [about](https://news.hada.io/about), [약관](https://news.hada.io/terms) 5·6절, [robots](https://news.hada.io/robots.txt), [피드](https://feeds.feedburner.com/geeknews-feed). 약관 6절의 AI 요약 대량 게시 금지는 GeekNews에 올리는 글 대상이다.
- Disquiet: [통합 약관](https://www.relate.kr/terms) 12조 1항 7호, 23조. [robots](https://disquiet.io/robots.txt).
- Hugging Face: [한도](https://huggingface.co/docs/hub/rate-limits)(2025-09 기준 표), [약관](https://huggingface.co/terms-of-service).
- npm: [Open Source Terms](https://docs.npmjs.com/policies/open-source-terms), [크롤러 정책](https://docs.npmjs.com/policies/crawlers), [download counts](https://github.com/npm/registry/blob/main/docs/download-counts.md).
- PyPI: [API 문서](https://docs.pypi.org/api/), [약관](https://policies.python.org/pypi.org/Terms-of-Service/), [robots](https://pypi.org/robots.txt), [pypistats](https://pypistats.org/api/).
- OpenRouter: [Data API](https://openrouter.ai/docs/cookbook/administration/data-api), [rankings-daily](https://openrouter.ai/docs/api/api-reference/datasets/get-rankings-daily), [약관](https://openrouter.ai/terms) 7절, [robots](https://openrouter.ai/robots.txt).
- Artificial Analysis: 1,000/일과 표기 필수는 [API 레퍼런스](https://artificialanalysis.ai/api-reference), 100/창과 등급은 [Data API 문서](https://artificialanalysis.ai/data-api/docs), 무료 등급 재배포 불가는 [Data API 페이지 검색 요약](https://artificialanalysis.ai/data-api), 구 엔드포인트 2026-11-04 종료는 [이전 안내](https://artificialanalysis.ai/data-api/migrate-v2-data). [robots](https://artificialanalysis.ai/robots.txt).
- Google Trends: [API 알파](https://developers.google.com/search/apis/trends), [출처 표기](https://support.google.com/trends/answer/4365538), [구글 약관](https://policies.google.com/terms), [robots](https://trends.google.com/robots.txt), [RSS](https://trends.google.com/trending/rss?geo=KR).
- Crunchbase: [약관](https://about.crunchbase.com/docs/terms-of-service), [API 안내](https://data.crunchbase.com/docs/using-the-api), Basic 종료는 [2차 자료](https://pipeline.zoominfo.com/sales/crunchbase-api).
- X: [가격](https://docs.x.com/x-api/getting-started/pricing), [robots](https://x.com/robots.txt), 학습 금지는 [TechCrunch](https://techcrunch.com/2025/06/05/x-changes-its-terms-to-bar-training-of-ai-models-using-its-content).
- Bluesky: [약관](https://bsky.social/about/support/tos), [robots](https://bsky.app/robots.txt), [한도(검색 결과로 확인)](https://docs.bsky.app/docs/advanced-guides/rate-limits).
- Stack Overflow: [정책 목록](https://policies.stackoverflow.co/company), [AUP 추적 사본](https://tostracker.app/document/stackoverflow-acceptable-use), 덤프의 LLM 제한은 [DevClass](https://devclass.com/2024/07/30/stack-exchange-restricts-access-to-dump-of-user-contributed-data-as-critics-complain-license-permits-reuse-for-any-purpose).
- Indie Hackers: [robots](https://www.indiehackers.com/robots.txt), 공식 RSS 없음은 [Feeder 안내](https://feeder.co/discover/5a957d40f0/indiehackers-com) 등 2차 자료.
- 뉴스레터: [Stratechery](https://stratechery.com/terms-of-service/), [Substack 약관](https://substack.com/tos), [Lenny's robots](https://www.lennysnewsletter.com/robots.txt), [Lenny's 피드](https://www.lennysnewsletter.com/feed), [Simon Willison](https://simonwillison.net/about/), [AINews](https://news.smol.ai/rss.xml), [TLDR](https://tldr.tech/terms).

### Inferences
- GitHub AUP 7절의 허용 예시는 연구·보관이고 뉴스 게시는 명시되지 않았다. 다만 금지 대상이 스팸·개인정보 판매 중심이고 공개 저장소 접근 제한을 두지 않으므로 위험은 낮다고 본다.
- HN은 공식 API를 내놓았으므로 API 수집 자체는 허락으로 보는 것이 합리적이나, 약관에 API 콘텐츠의 재사용 허락이 명시된 것은 아니다.
- 약관이 없는 소스(OSS Insight, GH Archive, Algolia)는 "허용"이 아니라 "조건이 불명"이다.
- 사실·수치(순위, 다운로드 수)와 원문 문장은 위험이 다르다. 수치 위주 소스가 커뮤니티 글 소스보다 안전하다. 이는 일반론이고 국내외 판례를 확인한 것은 아니다.

### Gaps
- Reddit Data API Terms, Developer Terms, X Developer Agreement, Stack Exchange API 약관·쿼터, Indie Hackers 약관은 원문 미확인.
- Product Hunt GraphQL의 수치 한도, Forem API 한도, HN Algolia 한도, OpenRouter API 키 발급·Data API 무료 여부 공식 문구.
- Artificial Analysis Data Platform Terms 본문과 한도 수치 충돌의 최신값.
- Hugging Face robots.txt, Bluesky 개발자 지침(문서가 `bsky.network`로 옮겨 빈 내용), GH Archive 데이터 라이선스(LICENSE 경로 404), Reddit·Stack Overflow robots.txt.

## 하루 1회 수집을 비용 없이 할 수 있는 소스는 무엇인가

### Takeaway
공개 게시까지 무료로 되는 소스는 많다. X와 Crunchbase만 비용 벽이 있고, 나머지 장벽은 비용이 아니라 약관이다. 모든 공식 API의 한도는 하루 1회에 충분하다.

### Cited Findings
- 무료·키 없음: HN Firebase, npm, PyPI, pypistats, OSS Insight, GeekNews RSS — 각 근거는 위 표.
- 무료·키 필요: GitHub, Product Hunt, Hugging Face(선택), OpenRouter(키 필요, 무료 여부 명시 없음) — [OpenRouter](https://openrouter.ai/docs/cookbook/administration/data-api).
- BigQuery로 GH Archive를 쓰면 월 1TB까지 무료 — [GH Archive](https://www.gharchive.org/).
- X는 포스트 읽기당 $0.005 — [X 가격](https://docs.x.com/x-api/getting-started/pricing).

### Inferences
- X에서 하루 100건을 읽으면 하루 $0.50, 월 약 $15다(단순 계산). 금액보다 약관 미확인과 robots 전면 금지가 탈락 이유다.

### Gaps
- OpenRouter 키 발급에 결제 등록이 필요한지 확인 못 했다.

## 어떤 출처 표기가 필요한가

### Takeaway
강제 표기는 OpenRouter, Google Trends, Crunchbase, Artificial Analysis에 명시되어 있고 Product Hunt는 요청 수준이다. CC BY-SA 콘텐츠는 라이선스상 표기가 필요하다.

### Cited Findings
- OpenRouter: 순위 데이터는 OpenRouter와 rankings 주소, as_of 날짜를 표기하고, 데이터 자체를 재게시하면 CC BY 4.0 표기도 더한다. 숫자가 나중에 바뀔 수 있으니 meta 블록을 함께 기록한다 — [Data API](https://openrouter.ai/docs/cookbook/administration/data-api).
- Google Trends: 구글을 출처로 표시하고 Google Ads 데이터와 함께 인용하지 않는다 — [도움말](https://support.google.com/trends/answer/4365538).
- Artificial Analysis: 모든 등급 표기 필수, 보이는 바이라인이나 푸터 링크면 된다 — [Data API 문서](https://artificialanalysis.ai/data-api/docs).
- Crunchbase: 데이터 근처의 보이는 링크, nofollow 금지 — [API 안내](https://data.crunchbase.com/docs/using-the-api).
- Product Hunt: Product Hunt로 연결되는 링크 표기를 요청 — [문서](https://api.producthunt.com/v2/docs).

### Inferences
- 나머지 소스는 의무가 없어도 항목마다 출처명과 원문 링크를 다는 공통 규칙이면 전부 충족된다. 이미 "이미지는 링크, 문장은 재작성" 규칙이 있어 추가 비용이 작다.

### Gaps
- GeekNews, Bluesky, HN의 표기 의무는 명시 문구를 찾지 못했다.

## 어떤 소스가 AI 파생 콘텐츠를 금지하는가

### Takeaway
"AI 요약·재작성 게시"를 명시적으로 금지한 약관은 찾지 못했다. 대부분 AI 학습 금지이며, Tidwyn의 사용은 학습이 아니라 입력이다. 입력까지 막는 것이 확인된 곳은 Lobsters(신호)와 Indie Hackers(봇 차단)다.

### Cited Findings
- Lobsters: `ai-input=no`, `ai-train=no` — [robots](https://lobste.rs/robots.txt).
- Indie Hackers: ClaudeBot 등 명명 AI 봇 전면 차단 — [robots](https://www.indiehackers.com/robots.txt).
- GeekNews: 학습은 불가, AI 입력은 허용 신호 — [robots](https://news.hada.io/robots.txt).
- Crunchbase: 생성 AI 모델 학습 금지 — [약관](https://about.crunchbase.com/docs/terms-of-service).
- X: 모델 학습·미세조정 금지(보도) — [TechCrunch](https://techcrunch.com/2025/06/05/x-changes-its-terms-to-bar-training-of-ai-models-using-its-content).
- Reddit: 권리자 허락 없는 학습 불가(2차) — [the-decoder](https://the-decoder.com/?p=4180).
- dev.to: 수정과 공개 표시 금지가 일반 조항으로 있어 재작성에 걸릴 수 있다 — [약관](https://dev.to/terms).
- Stratechery: 자동 수집 금지 — [약관](https://stratechery.com/terms-of-service/).

### Inferences
- Tidwyn의 수집기는 Claude이므로 AI 봇 차단 소스는 "자동화 일반"보다 직접적인 거부로 다뤄야 한다. 프로젝트의 우회 금지 규칙과도 맞다.
- 학습 금지 조항은 모델 공급사의 입력 데이터 처리와 얽힐 수 있다. 영향 범위는 판단하지 못했다.

### Gaps
- AI 요약의 저작권 적법성(국내법, 공정이용)은 범위 밖이라 확인하지 않았다. 필요하면 전문가 확인이 맞다.

## 나중에 광고를 달면 무엇이 문제가 되는가

### Takeaway
가장 분명한 문제는 Product Hunt API다. HN, dev.to, Reddit, Artificial Analysis도 재검토가 필요하다. OpenRouter는 CC BY 4.0이라 안전하고, npm·PyPI·Hugging Face·GitHub에서는 광고에 직접 걸리는 조항을 찾지 못했다.

### Cited Findings
- Product Hunt: 상업 목적 금지, 사업 용도는 문의 — [문서](https://api.producthunt.com/v2/docs). "상업"의 정의는 문서에 없다.
- HN/YC: 상업 목적의 표시·배포·복제를 제한 — [YC 약관](https://www.ycombinator.com/legal/).
- dev.to: 상업 목적 사용 금지 — [약관](https://dev.to/terms).
- Reddit: 상업 사용은 승인 필요(2차), 수익 제품에 들어가면 상업으로 본다는 해석(2차) — [Medianama](https://www.medianama.com/2024/05/223-reddit-openai-deal-ai-integration-advertising/), [경쟁사 블로그](https://www.redditapis.com/reddit-responsible-builder-policy).
- OpenRouter: 상업 재사용 허용, 표기 필요 — [Data API](https://openrouter.ai/docs/cookbook/administration/data-api).
- Disquiet: 사전 동의 없는 영업·광고 활동 금지 — [약관](https://www.relate.kr/terms) 12조 1항 5호. 서비스 안 활동 대상으로 읽히지만 자동 수집은 이미 별도 금지다.
- Artificial Analysis: 광고 사용 언급 없음, 문의 필요 — [Data API 문서](https://artificialanalysis.ai/data-api/docs).

### Inferences
- 광고를 켜기 전에 Product Hunt에 서면 허가를 받거나 이 소스를 뺄 수 있게 소스별 스위치를 두는 것이 좋다.
- 후원 링크나 유료 구독도 "상업"으로 해석될 수 있다. 각 약관이 정의하지 않아 불확실하다.

### Gaps
- 광고 없는 무료 공개 사이트 자체가 Product Hunt의 "상업 목적"에 해당하지 않는다는 공식 확인은 없다. 현재 비상업이라는 판단은 이 메모의 해석이다.
