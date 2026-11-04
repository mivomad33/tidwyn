# 소스 이용 조건 판정 (2026-11-04)

법률 자문이 아니다. robots.txt와 Mastodon 인스턴스의 약관·규칙·소개·개인정보 문서는 원문을 받아 읽었고(API `terms_of_service`, `rules`, `extended_description`, `privacy_policy`), 외부 약관 페이지(Google, Vivaldi, Hachyderm, Fosstodon, gamedev.place, ML Collective, Piaille)는 웹 읽기 도구로 읽었다. 뒤 단계(9.97, 9.98)는 이 판정을 따른다.

## 판정 기준 (D16)

- 네 가지를 본다: **저장**(로컬 DB에 둔다), **AI 입력**(9.97의 격리 프로세스가 읽는다), **요약 게시**(AI가 정리한 흐름만 사이트에 싣는다. 원본은 싣지 않는다), **공개 백업**(재배포).
- robots는 `*`나 Anthropic 계열 봇(ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, Claude-Web)이 받는 경로를 막으면 막힌 것으로 본다. 다른 회사 봇만 막는 것은 막힌 것으로 보지 않는다.
- 소스 전용 약관이 없으면 그 회사의 일반 약관과 robots로 본다. Mastodon 인스턴스에 이용 약관이 없으면 서버 규칙과 소개·개인정보 문서로 본다.
- 확인하지 못했거나 해석이 애매하면 넣지 않는다.
- 'AI 학습'만 막는 문장은 AI 입력을 막는 것으로 보지 않는다. 이 프로젝트는 받은 값으로 모델을 학습하지 않고, 정리할 때 입력으로만 쓴다(2026-11-04 사용자 결정).
- 공개 백업은 모두 넣지 않는다. D16이 급상승어·트렌드를 로컬에만 두게 했고, 아래 어느 곳도 사용자 글의 재배포를 허락하지 않는다.

## 판정

| 소스 | 주소 | 저장 | AI 입력 | 요약 게시 | 공개 백업 | 근거 |
|---|---|---|---|---|---|---|
| Google Trends 급상승 RSS | `https://trends.google.com/trending/rss?geo=<국가>`. 나라: KR, US, JP, TW, HK, IN, ID, VN, TH, PH, MY, SG, AU, CA, GB, DE, FR, IT, ES, NL, PL, TR, RU, UA, BR, MX, AR, SA, NG, ZA(명세서 S2) | 됨 | 됨 | 됨(출처 'Google Trends' 표기) | 안 함 | robots는 `/explore?`만 막는다. [Trends 도움말](https://support.google.com/trends/answer/4365538)이 Trends의 정보를 쓸 수 있고 출처를 밝히라고 한다(Google 약관을 따른다는 조건). [Google 약관](https://policies.google.com/terms)은 robots를 어긴 자동 접근과 AI 생성물로 모델을 만드는 것을 막는다. 둘 다 해당하지 않는다. RSS는 [Trending now 도움말](https://support.google.com/trends/answer/3076011)이 내보내기 방법으로 안내한다. 문서 없는 피드라 언제든 바뀔 수 있다 |
| uri.life (한국) | `/api/v1/trends/tags`, `/api/v1/trends/links` | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 규칙은 게시 행동만 다룬다. robots는 막지 않는다 |
| qdon.space (한국) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음(소개가 `/privacy-policy`를 가리킨다). 소개에 'AI 학습에 쓰는 스크래퍼는 차단한다'가 있다. 학습만 다룬다. robots는 GPTBot만 막는다 |
| planet.moe (한국) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 소개에 '저작자 동의 없이 AI 학습에 쓸 수 없다', 'API 요청이 너무 많으면 차단'이 있다. 학습만 다루고 하루 몇 번의 호출은 해당하지 않는다. robots는 GPTBot만 막는다 |
| mastodon.world | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 규칙은 게시 행동만 다룬다 |
| fosstodon.org | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. [행동 강령](https://hub.fosstodon.org/coc)이 학습에 게시자 동의를 요구한다. 학습만 다룬다. robots는 GPTBot만 막는다 |
| mastodon.uno (이탈리아) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 규칙의 AI 문장은 AI가 운영하는 계정 금지다. robots는 GPTBot만 막는다 |
| troet.cafe (독일어) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 규칙은 게시와 봇 계정 행동만 다룬다 |
| piaille.fr (프랑스) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 규칙과 봇 정책 글은 봇 계정의 게시 횟수만 다룬다 |
| mastodon.nl (네덜란드) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음(API 404). 규칙은 게시 행동만 다룬다 |
| social.vivaldi.net | 같음 | 됨 | 됨 | 됨 | 안 함 | [Vivaldi 커뮤니티 약관](https://vivaldi.com/privacy/community-terms-of-use/)은 사용자를 속이는 방식의 자동화와 자동 가입만 막는다. 규칙의 AI 문장은 AI 홍보 금지다 |
| sigmoid.social (AI 분야) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 행동 강령은 괴롭힘 목적의 기록만 막는다 |
| mastodon.gamedev.place (게임 개발) | 같음 | 됨 | 됨 | 됨 | 안 함 | 약관 없음. 행동 강령과 안내에 수집·AI 조항이 없다 |

## 쓰지 않는 곳

| 소스 | 이유 |
|---|---|
| Google Trends 공식 API | 알파 단계, 승인제(조사 보고서) |
| Mastodon 트렌드 글(`/api/v1/trends/statuses`) | 사용자 글 원문과 작성자 계정이 통째로 오고, 계획이 태그·링크만 정했다 |
| infosec.exchange, mstdn.social | 약관이 스파이더, 스크레이퍼, 데이터 마이닝 등 자동 수단으로 인스턴스에 접근하는 것을 막는다 |
| hachyderm.io | 약관은 없지만 봇 정책이 데이터를 다루는 봇에 동의(opt-in)를 요구한다. 계정 없는 읽기에도 해당하는지 애매하다 |
| mstdn.jp | 소개가 가리키는 이용 규약(`media.mstdn.jp/terms/`)이 접속 거부로 열리지 않아 확인하지 못했다 |
| mastodon.social, mastodon.online, mas.to, techhub.social, mastodon.art, mastodon.scot, aus.social | robots가 ClaudeBot이나 anthropic-ai를 막는다 |
| madost.one | 트렌드 API가 404다 |
| toot.community | 서버가 닫혔다(410) |

## 뒤 단계가 지킬 조건

- Google Trends 급상승어를 근거로 쓴 흐름 항목에는 출처를 'Google Trends'로 밝힌다.
- 매 실행에서 robots를 다시 보고, 막히면 그 소스를 그날 받지 않는다(이 명세서 4장).
- 약관이 바뀐 것을 알게 되면 이 표를 고치고 판정을 다시 한다. 비상업 조건 소스는 없다.
