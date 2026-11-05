# 9.98단계 커뮤니티 소스 약관 판정 기록

- 조사일: 2026-11-05. 서브에이전트 네 갈래가 약관·robots·문서 원문을 읽고, 키 없는 작은 요청으로 칸 이름·건수·날짜 범위·상태 코드만 봤다(글 제목·본문·작성자는 옮기지 않았다).
- 판정 기준은 [`docs/demand-sources.md`](../../demand-sources.md)의 "판정 기준 (D16)"이다: 저장, AI 입력, 요약 게시, 공개 백업 네 가지를 보고, 확인하지 못했거나 애매하면 넣지 않는다. robots는 `*`나 Anthropic 계열 봇이 받는 경로를 막으면 막힌 것으로 본다.
- 인용은 15단어 이하로 줄였다. 법률 자문이 아니다.

## 요약

| 후보 | 저장 | AI 입력 | 요약 게시 | 공개 백업 | 지난 기간 | 결론 |
|---|---|---|---|---|---|---|
| GitHub Issues(REST 검색) | 됨 | 됨 | 됨 | 안 함 | 됨(`created:` 날짜 범위) | 통과 |
| Bluesky(`api.bsky.app`) | 됨(삭제 반영) | 됨 | 됨 | 안 함 | 됨(`since`/`until`, 첫 쪽 100건) | 통과(조건부) |
| Hacker News(Firebase API·Algolia) | 애매 | 애매 | 됨 | 안 됨 | 됨(Algolia 날짜 범위) | 사용자 판단(계획 3.18) |
| Hugging Face(모델·스페이스 인기) | 됨 | 됨 | 됨 | 애매 | 안 됨(오늘 순위만) | 약관은 통과, 불만 신호가 아님 |
| Mastodon 트렌드(9.95) | 됨 | 됨 | 됨 | 안 함 | 안 됨(9.95가 매일 쌓음) | 9.95 판정을 따른다 |
| Lemmy lemmy.world·lemmy.ml | 애매 | 애매 | 애매 | 안 됨 | 날짜 조회 없음 | 빠짐(약관 본문을 읽지 못함) |
| Lemmy sh.itjust.works | 안 됨 | 안 됨 | 안 됨 | 안 됨 | — | 빠짐(robots가 Claude 계열을 막음) |
| Lemmy programming.dev | 애매 | 애매 | 애매 | 안 됨 | — | 빠짐(약관·robots 403) |
| dev.to(Forem API) | 애매 | 애매 | 애매 | 안 됨 | 날짜 조회 없음 | 빠짐(약관이 비상업 열람만 허용, 미러 금지) |
| Discourse meta.discourse.org | 안 됨 | 안 됨 | 안 됨 | 안 됨 | — | 빠짐(약관이 자동 접근 금지) |
| Discourse community.openai.com | 애매 | 애매 | 애매 | 안 됨 | — | 빠짐(포럼 약관 미확인) |
| Substack RSS | 안 됨 | 안 됨 | 안 됨 | 안 됨 | — | 빠짐(약관이 수집·저장 금지) |
| Product Hunt 댓글 | 애매 | 애매 | 애매 | 안 됨 | — | 빠짐(댓글 칸을 공식 스키마로 확인 못 함, 9.9 N3 범위 밖) |

## GitHub Issues

- [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) 7장: "Scraping does not refer to the collection of information through our API." 금지되는 쓰임은 스팸과 개인정보 판매다.
- [이용 약관 H장(API Terms)](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service): 과도한 요청은 정지될 수 있고, 토큰을 나눠 한도를 넘지 말고, 스팸 목적으로 받지 말라고 한다. D.3 "You own Your Content."(이슈 글의 권리는 작성자에게 있다) → 원문 재배포(공개 백업)는 하지 않는다.
- robots: `api.github.com/robots.txt`는 404(규칙 없음). `github.com` robots는 웹 페이지 대상이고 API를 쓰므로 해당하지 않는다.
- 동작(키 없이 확인): 비인증 검색 분당 10회(IP 기준, 9.9 뜨는 저장소 검색 약 130회와 나눠 쓴다). 결과는 1000번째 항목까지만, `total_count`는 그 이상도 센다. `created:YYYY-MM-DD..YYYY-MM-DD`로 지난 날짜를 받는다(`incomplete_results` false). 항목에 `reactions`(+1 등), `labels`, `comments`, `body`, `user`, `author_association`가 온다(`user`·`body`는 받을 때 버리거나 격리 재료로만 둔다).
- 규모: `is:issue label:enhancement` 하루 약 2.5만 건, 제목에 "feature request" 하루 약 600건(2026-10-04).
- Discussions: 토큰 없이 저장소별 REST(`/repos/{o}/{r}/discussions`, core 시간당 60회)와 검색 `is:discussion`이 된다. 검색 건수가 전체를 대표하는지는 확인하지 못했다.
- 확인하지 못한 것: AUP 7장 허용 이유 목록 전문, `sort=reactions-+1` 동작.

## Bluesky

- [이용 약관](https://bsky.social/about/support/tos)(2025-08-14): 자동 수집·AI·제3자 상업 이용을 직접 다루는 문장이 없다. 삭제는 다른 서비스에 알린다고 한다.
- [개발자 가이드라인](https://docs.bsky.app/docs/support/developer-guidelines) 3항: "All services must have a method for deleting content a user has requested". 기한은 없다. 연합(federate)하는 앱 대상이라 읽기 전용 소비자에 해당하는지는 불분명하지만 따르는 쪽으로 본다.
- robots: `api.bsky.app`, `public.api.bsky.app` 모두 `User-agent: *` `Allow: /`, 주석 "Crawling the public parts of the API is allowed". Anthropic 계열을 막는 줄이 없다.
- 동작: `public.api.bsky.app`의 `searchPosts`는 403. `api.bsky.app`의 `searchPosts`는 200(칸 `posts`, `cursor`, `hitsTotal`)이지만 둘째 쪽(cursor)은 403이라 한 요청에 100건까지다. `since`/`until`이 동작해 지난 날짜도 받는다. `hitsTotal`은 10,000에서 잘린다. 트렌드(`getTrendingTopics`·`getTrends`)는 200이고 지난 날짜가 없다.
- 삭제 반영: `app.bsky.feed.getPosts`로 at:// URI를 다시 조회하면 지운 글이 빠진다(키 없이 200). 하루 한 번 다시 조회해 빠진 것을 지우는 방식을 가이드라인 3항을 따르는 방법으로 본다. 계정 삭제·정지가 빠지는지는 확인하지 못했다. 글 식별자에는 작성자 DID가 들어 있어 로컬에만 둔다(계획 3.18의 D16 삭제 예외).
- 규모(2026-10-01 하루 `hitsTotal`): 영어 "I wish" 약 6,600건, "why is there no" 약 300건, 한국어 "불편" 52건.
- 판정: 저장 됨(삭제 반영 조건), AI 입력 됨(AI 문구 없음, 학습하지 않음), 요약 게시 됨, 공개 백업 안 함(삭제 요구와 지울 수 없는 git 이력이 부딪친다).

## Hacker News

- [Y Combinator 이용 약관](https://www.ycombinator.com/legal/)(2026-09 개정): "you will not engage in or use any data mining, robots, scraping" 와 "Except as expressly authorized by Y Combinator, you agree not to … scrape". 약관 본문에 API를 다루는 문장이 없다.
- [공식 API 저장소](https://github.com/HackerNews/API): "making the public Hacker News data available in near real time", "There is currently no rate limit." 이용 조건 문장은 없다. 공식 API 공개가 '명시적 허용'인지는 약관도 README도 말하지 않는다(계획 3.18이 명세서에서 정하라고 한 해석).
- [Algolia HN Search](https://hn.algolia.com/api): IP당 시간 1만 회. 별도 이용 조건을 찾지 못했다.
- robots: `hacker-news.firebaseio.com`은 `.json` 경로만 허용, `hn.algolia.com`은 404, `news.ycombinator.com`은 `Crawl-delay: 30`과 동작 경로만 막는다. Anthropic 계열을 따로 막지 않는다.
- 동작: Algolia `search_by_date`에 `numericFilters=created_at_i>…`로 날짜 범위를 받고, 한 질의는 1000건까지라 하루 창으로 나눈다. Ask HN 하루 약 16건, 전체 글 하루 약 500건, 댓글 하루 약 4,800건.
- 삭제: 약관에 수집자의 삭제 반영 의무는 없다. API가 `deleted`·`dead` 표시를 준다.
- 판정: 저장 애매, AI 입력 애매, 요약 게시 됨(위험 낮음), 공개 백업 안 됨. Product Hunt(9.9 N3)는 API 문서가 비상업 사용을 허용하는 문장이 있었지만, HN은 그런 문장이 없다는 점이 다르다.

## Hugging Face

- [이용 약관](https://huggingface.co/terms-of-service): 수집·API 한도 조항이 없다. robots는 `User-agent: *` `Allow: /`.
- 동작: `/api/models?sort=trendingScore`, `/api/spaces?sort=trendingScore` 키 없이 200(5분 500회). 지난 날짜 순위는 받을 수 없다(오늘 순위만).
- 판정: 저장·AI 입력·요약 게시 됨, 공개 백업 애매. 불만·요구가 아니라 인기 신호다.

## 빠진 후보의 근거

- Lemmy: [sh.itjust.works robots](https://sh.itjust.works/robots.txt)가 ClaudeBot·anthropic-ai·Claude-User 등을 `Disallow: /`. lemmy.world 약관(legal.lemmy.world)은 자바스크립트라 읽지 못했고(목차에 "Bot Usage and Guidelines"), lemmy.ml 약관은 비어 있고, programming.dev는 403. 날짜 범위 조회가 없다.
- dev.to: [약관](https://dev.to/terms) 2장이 "personal, non-commercial transitory viewing only"와 미러를 막는다. 자동 수집·API·AI 조항이 없다.
- Discourse: [meta.discourse.org 약관](https://meta.discourse.org/tos) "You may not automate access to the forum"(검색엔진 색인만 예외). community.openai.com은 포럼 약관을 찾지 못했다.
- Substack: [약관](https://substack.com/tos)이 "'Crawls,' 'scrapes,' or 'spiders' any page"와 상당 부분의 복사·저장을 막는다.
- Product Hunt 댓글: [API 문서](https://api.producthunt.com/v2/docs) "must not be used for commercial purposes". 사이트 약관은 403, 댓글 칸은 공식 스키마로 확인하지 못했다. 9.9 N3이 소개된 제품만 보기로 정했다.
