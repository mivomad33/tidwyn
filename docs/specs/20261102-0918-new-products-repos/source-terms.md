# 소스 이용 조건 확인 (2026-11-02)

법률 자문이 아니다. robots.txt와 YC 약관의 해당 문장은 원문을 받았고, 나머지는 도구로 읽은 판정이다. 받기 전에 약관부터 봤다(9.8단계 회고).

| 소스 | 판정 | 근거 요지 | 주소 |
|---|---|---|---|
| GitHub Search API | 사용 | 공식 API. AUP의 스크래핑 정의가 API 수집을 제외한다. 저장소 메타데이터만 쓴다. 토큰 없이 분당 10회, 쿼리당 1,000건 | https://docs.github.com/en/rest/search/search |
| GitHub 별 이력 API | 사용 | 2026-09-04 공개된 공식 API. 별을 누른 사람을 드러내지 않고 일별 증가량만 준다 | https://github.blog/changelog/2026-09-04-new-api-endpoint-provides-privacy-safe-star-history-data/ |
| GitHub README API | 사용(조건부) | 공식 API. 글의 권리는 저장소마다 달라 사실만 재서술하고 링크한다 | https://docs.github.com/en/rest/repos/contents |
| Product Hunt API | 사용(조건부) | 문서가 상업 사용을 금지하고 출처 표기를 요청한다. 토큰 필요. 광고 없는 비상업 사이트로 쓴다. 공식 확인은 없다. 광고를 달기 전에 다시 본다 | https://api.producthunt.com/v2/docs |
| Product Hunt 사이트 | 쓰지 않음 | 2014년판 약관이 수동·자동 수집과 콘텐츠 상당 부분의 복사를 금지한다. 페이지와 피드를 받지 않는다 | https://www.producthunt.com/legal#terms |
| GitHub Trending 페이지 | 쓰지 않음 | D15. 공식 API가 없고 AUP가 자동 추출을 제한한다 | https://github.com/robots.txt |
| 제3자 Trending 기록 (`bonfy/github-trending`, `mshibanami/GitHubTrendingRSS`) | 쓰지 않음 | 페이지를 긁은 결과다. 제품에 쓰면 D15를 돌아가는 것이다. 명세서 전 비교에만 한 번 받았다 | https://github.com/bonfy/github-trending |
| OSS Insight 트렌드 API | 쓰지 않음 | 2026-03-01부터 이벤트 수집이 기준의 약 0.3%로 줄어 빈 결과를 준다고 응답이 밝힌다 | https://ossinsight.io/docs/data-quality |
| GH Archive | 쓰지 않음 | 시간별 파일이 약 4,700건으로 줄었다(2026-11-01 12시 1개 실측). 데이터 라이선스 명시도 없다 | https://www.gharchive.org/ |
| Hacker News API, Algolia | 쓰지 않음 | YC 약관이 로봇, 스크래핑 등 자동 추출과 파생물 제작을 금지한다. 공식 API는 있으나 데이터 재사용 조건이 없다. D15의 금지 소스에 해당한다고 본다 | https://www.ycombinator.com/legal/ |
| BetaList | 쓰지 않음 | 개인·비상업 일시 열람으로 한정하고 복사를 금지한다 | https://betalist.com/terms |
| GeekNews | 쓰지 않음 | 약관이 자동화 접근 일부와 재가공 글을 제한하고, robots가 ClaudeBot을 막는다. 재사용 허락 조항이 없다 | https://news.hada.io/terms |
| Disquiet | 쓰지 않음 | 조사 보고서: 사전 허락 없는 자동 수집 금지 | https://www.relate.kr/terms |
