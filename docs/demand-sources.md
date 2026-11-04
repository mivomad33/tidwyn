# 수요 소스 판정

수요 신호 단계(9.95~9.98)가 받는 소스와 이용 조건 판정을 한곳에 둔다. 코드의 소스 목록은 [`src/demandSources.ts`](../src/demandSources.ts)에 있고, 테스트가 이 문서의 목록과 같은지 본다. 소스를 더하거나 끄면 이 문서와 코드를 함께 고친다. 끈 소스는 지우지 않고 '끔'(날짜, 이유)을 적는다. 받는 흐름과 운영은 [operations.md](operations.md)의 "수요 스냅샷" 절에 있다.

법률 자문이 아니다. 9.95단계 판정(2026-11-04)은 robots.txt와 Mastodon 인스턴스의 약관·규칙·소개·개인정보 문서 원문(API `terms_of_service`, `rules`, `extended_description`, `privacy_policy`)과 외부 약관 페이지(Google, Vivaldi, Hachyderm, Fosstodon, gamedev.place, ML Collective, Piaille)를 읽고 했다. 근거 기록은 [9.95단계 명세서 폴더](specs/20261104-1511-demand-snapshots/source-terms.md)에 있다.

## 판정 기준 (D16)

- 네 가지를 본다: **저장**(로컬 DB에 둔다), **AI 입력**(9.97의 격리 프로세스가 읽는다), **요약 게시**(AI가 정리한 흐름만 사이트에 싣는다. 원본은 싣지 않는다), **공개 백업**(재배포).
- robots는 `*`나 Anthropic 계열 봇(ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, Claude-Web)이 받는 경로를 막으면 막힌 것으로 본다. 다른 회사 봇만 막는 것은 막힌 것으로 보지 않는다.
- 소스 전용 약관이 없으면 그 회사의 일반 약관과 robots로 본다. Mastodon 인스턴스에 이용 약관이 없으면 서버 규칙과 소개·개인정보 문서로 본다.
- 확인하지 못했거나 해석이 애매하면 넣지 않는다.
- 'AI 학습'만 막는 문장은 AI 입력을 막는 것으로 보지 않는다. 이 프로젝트는 받은 값으로 모델을 학습하지 않고, 정리할 때 입력으로만 쓴다(2026-11-04 사용자 결정).
- 공개 백업은 모두 넣지 않는다. D16이 급상승어·트렌드를 로컬에만 두게 했고, 아래 어느 곳도 사용자 글의 재배포를 허락하지 않는다.

## Google Trends 급상승 RSS

- 주소: `https://trends.google.com/trending/rss?geo=<나라>`
- 판정: 저장 됨, AI 입력 됨, 요약 게시 됨(출처 'Google Trends' 표기), 공개 백업 안 함.
- 근거: robots는 `/explore?`만 막는다. [Trends 도움말](https://support.google.com/trends/answer/4365538)이 Trends의 정보를 쓸 수 있고 출처를 밝히라고 한다(Google 약관을 따른다는 조건). [Google 약관](https://policies.google.com/terms)은 robots를 어긴 자동 접근과 AI 생성물로 모델을 만드는 것을 막는다. 둘 다 해당하지 않는다. RSS는 [Trending now 도움말](https://support.google.com/trends/answer/3076011)이 내보내기 방법으로 안내한다. 문서 없는 피드라 언제든 바뀔 수 있다.
- 나라(30개, 9.95단계 명세서 S2. 지원 국가 전부는 막힘 위험이 커서 고른 것이다):

<!-- demand:google-geos -->
`KR`, `US`, `JP`, `TW`, `HK`, `IN`, `ID`, `VN`, `TH`, `PH`, `MY`, `SG`, `AU`, `CA`, `GB`, `DE`, `FR`, `IT`, `ES`, `NL`, `PL`, `TR`, `RU`, `UA`, `BR`, `MX`, `AR`, `SA`, `NG`, `ZA`
<!-- /demand:google-geos -->

끈 나라: 없음. 나라 하나를 끄려면 `DEMAND_SOURCES_OFF`에 `google:<나라>`를 넣고 아래 끈 소스 표에 적는다. Google 묶음 전체는 `DEMAND_GROUPS_OFF`에 `google`을 넣는다.

## Mastodon 트렌드

받는 것: 트렌드 태그(`/api/v1/trends/tags`), 트렌드 링크(`/api/v1/trends/links`). 트렌드 글(`/api/v1/trends/statuses`)은 받지 않는다. 모든 인스턴스의 판정은 저장 됨, AI 입력 됨, 요약 게시 됨, 공개 백업 안 함이다.

<!-- demand:mastodon -->
| 인스턴스 | 끔 | 근거 |
|---|---|---|
| uri.life | | 한국. 약관 없음. 규칙은 게시 행동만 다룬다. robots는 막지 않는다 |
| qdon.space | | 한국. 약관 없음(소개가 `/privacy-policy`를 가리킨다). 소개에 'AI 학습에 쓰는 스크래퍼는 차단한다'가 있다. 학습만 다룬다. robots는 GPTBot만 막는다 |
| planet.moe | | 한국. 약관 없음. 소개에 '저작자 동의 없이 AI 학습에 쓸 수 없다', 'API 요청이 너무 많으면 차단'이 있다. 학습만 다루고 하루 몇 번의 호출은 해당하지 않는다. robots는 GPTBot만 막는다 |
| mastodon.world | | 약관 없음. 규칙은 게시 행동만 다룬다 |
| fosstodon.org | | 약관 없음. [행동 강령](https://hub.fosstodon.org/coc)이 학습에 게시자 동의를 요구한다. 학습만 다룬다. robots는 GPTBot만 막는다 |
| mastodon.uno | | 이탈리아. 약관 없음. 규칙의 AI 문장은 AI가 운영하는 계정 금지다. robots는 GPTBot만 막는다 |
| troet.cafe | | 독일어. 약관 없음. 규칙은 게시와 봇 계정 행동만 다룬다 |
| piaille.fr | | 프랑스. 약관 없음. 규칙과 봇 정책 글은 봇 계정의 게시 횟수만 다룬다 |
| mastodon.nl | | 네덜란드. 약관 없음(API 404). 규칙은 게시 행동만 다룬다 |
| social.vivaldi.net | | [Vivaldi 커뮤니티 약관](https://vivaldi.com/privacy/community-terms-of-use/)은 사용자를 속이는 방식의 자동화와 자동 가입만 막는다. 규칙의 AI 문장은 AI 홍보 금지다 |
| sigmoid.social | | AI 분야. 약관 없음. 행동 강령은 괴롭힘 목적의 기록만 막는다 |
| mastodon.gamedev.place | | 게임 개발. 약관 없음. 행동 강령과 안내에 수집·AI 조항이 없다 |
<!-- /demand:mastodon -->

인스턴스 하나를 끄려면 `DEMAND_SOURCES_OFF`에 `mastodon:<인스턴스>`를 넣고 위 표의 '끔' 칸에 `끔(YYYY-MM-DD, 이유)`를 적는다. 묶음 전체는 `DEMAND_GROUPS_OFF`에 `mastodon`을 넣는다.

## 끈 소스와 묶음

<!-- demand:off -->
| 소스 또는 묶음 | 끔 |
|---|---|
<!-- /demand:off -->

## 쓰지 않는 곳

| 소스 | 이유 |
|---|---|
| Google Trends 공식 API | 알파 단계, 승인제 |
| Mastodon 트렌드 글(`/api/v1/trends/statuses`) | 사용자 글 원문과 작성자 계정이 통째로 오고, 계획이 태그·링크만 정했다 |
| infosec.exchange, mstdn.social | 약관이 스파이더, 스크레이퍼, 데이터 마이닝 등 자동 수단으로 인스턴스에 접근하는 것을 막는다 |
| hachyderm.io | 약관은 없지만 봇 정책이 데이터를 다루는 봇에 동의(opt-in)를 요구한다. 계정 없는 읽기에도 해당하는지 애매하다 |
| mstdn.jp | 소개가 가리키는 이용 규약이 접속 거부로 열리지 않아 확인하지 못했다 |
| mastodon.social, mastodon.online, mas.to, techhub.social, mastodon.art, mastodon.scot, aus.social | robots가 ClaudeBot이나 anthropic-ai를 막는다 |
| madost.one | 트렌드 API가 404다 |
| toot.community | 서버가 닫혔다(410) |

## 뒤 단계가 지킬 조건

- Google Trends 급상승어를 근거로 쓴 흐름 항목에는 출처를 'Google Trends'로 밝힌다.
- 급상승 RSS는 받기 직전 한 시간 안팎의 10건쯤만 주고 단독으로 흐름을 만들지 못하며, '서로 다른 소스 두 곳'에 세지 않는다(plan 3.15).
- 매 실행에서 robots를 다시 보고, 막히면 그 소스를 그날 받지 않는다(`demand-fetch`가 한다).
- 약관이 바뀐 것을 알게 되면 이 문서를 고치고 판정을 다시 한다. 비상업 조건 소스는 없다.
