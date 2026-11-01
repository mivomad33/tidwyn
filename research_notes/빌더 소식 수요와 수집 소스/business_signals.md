# 빌더가 보는 비즈니스·기회 신호와 수집 방법 (기준일 2026-11-01)

조사 방법 메모
- "직접 확인"은 2026-11-01에 브라우저 User-Agent를 넣은 curl로 해당 주소를 요청한 결과다. 200이면 응답 형식, 항목 수, 최신 항목 날짜까지 봤다. 403은 "자동 요청이 막혔다"는 뜻이지 "서비스가 죽었다"는 뜻이 아니다.
- 프로젝트 규칙상(`docs/memory.md` 2026-10-28) 막힌 페이지를 우회해 읽지 않는다. 403인 곳은 그 규칙을 그대로 적용해야 한다.
- 검색 도구의 요약을 거친 내용이 많다. 원문을 직접 읽지 못한 항목은 따로 표시했다.

## 범주별 평가: 쓸모와 수집 가능성

### Takeaway
매일 넣을 만한 범주는 "독자가 바로 행동을 바꿔야 하는 변화"인 플랫폼·정책·가격·서비스 종료·라이선스다. 투자·인디 매출·채용·수요 신호는 주간 또는 월간 묶음이 맞다. 수집은 대부분 RSS로 되지만, 수요 신호의 핵심인 Reddit이 2026-11-13에 RSS를 끝낸다.

### Cited Findings

요약표(판정은 이 조사의 판단이며, 수집 가능 여부는 아래 "API/RSS" 절의 직접 확인 결과에 근거한다)

| 범주 | 주기 제안 | 쓸모(한국 웹 개발자·사이드 프로덕트) | 수집 | 신뢰성 |
|---|---|---|---|---|
| 투자·인수 | 주간 | 중: 대형 딜 위주라 개인 빌더와 거리가 있다 | 좋음 | 높음(금액은 집계 기관마다 다름) |
| YC 배치·런치 | 주간 | 중상: 어떤 문제에 돈이 붙는지 보는 신호 | 좋음(비공식) | 중: 자기 소개 글 |
| 인디 매출 | 주간 | 상: 독자와 규모가 맞다 | 중 | 낮음~중 |
| 미충족 수요 | 주간/월간 | 상: 다만 잡음이 많다 | 나빠지는 중 | 낮음 |
| 종료·가격 변경 | 수시(사건이 있을 때 매일) | 상: 대체재 기회와 이전 수요 | 중: 흩어져 있음 | 높음(공지 원문 기준) |
| 유통·SEO·앱스토어 정책 | 수시 | 상 | 좋음 | 높음(공식 공지 기준) |
| 채용·해고 | 월간 | 중 | 중 | 중 |
| 한국 지원사업 | 주간 | 중상: 마감이 있어 놓치면 손해 | 좋음(API 키 필요) | 높음 |
| 한국 규제 | 수시 | 상: 해야 할 일이 생긴다 | 중 | 높음(공식 기준) |
| 한국 커뮤니티 | 소스로만 | 간접: 범주가 아니라 수집 경로 | GeekNews·요즘IT만 좋음 | 혼재 |
| 오픈소스 사업 | 수시(월 몇 건 수준) | 중상 | 중 | 높음 |

투자·인수
- TechCrunch 스타트업 피드 20건 중 제목에 투자·인수 신호가 있는 항목이 7건쯤이었고, Salesforce의 Rune 인수 보도($375M), Guidewire의 Hyperexponential 인수($1.7B), Re:Build $2.1B 같은 대형 건이 중심이었다. 같은 피드에 행사 홍보 글도 섞여 있다 — [TechCrunch Startups RSS](https://techcrunch.com/category/startups/feed/), [Venture RSS](https://techcrunch.com/category/venture/feed/)
- 스타트업레시피 피드에 주간 연재 `[이번주투자]`, `[이번주글로벌]`, `[이번주생태계]`가 있다(2026-11-01 기준 "퓨리오사 8천억대 시리즈D 마감" 등). 한국 투자 주간 요약으로 바로 쓸 수 있는 형식이다 — [스타트업레시피 RSS](https://www.startuprecipe.co.kr/feed)
- 한국 투자 수치는 집계 기관마다 다르다. 2026 상반기가 더브이씨 기준 7조8,005억 원, 스타트업레시피 기준 7.0조 원이고, 건수는 스타트업레시피 697건, 혁신의 숲 551건이다. 5월도 혁신의 숲 1조740억 원, 스타트업레시피 약 2조7,341억 원으로 크게 다르다 — [브런치 venture-digest](https://brunch.co.kr/@venture-digest/188), [스타트업레시피 상반기 리포트](https://startuprecipe.co.kr/wp-content/uploads/2026/07/260725_startuprecipe_investment_report_H1_00001.pdf), [혁신의 숲 5월 결산](https://www.innoforest.co.kr/report/491/-2026%EB%85%84-5%EC%9B%94-%EC%8A%A4%ED%83%80%ED%8A%B8%EC%97%85-%ED%88%AC%EC%9E%90%EA%B2%B0%EC%82%B0-%EB%94%A5%ED%85%8C%ED%81%AC%EB%A1%9C%EB%B3%B4%ED%8B%B1%EC%8A%A4%EA%B0%80-%EB%81%8C%EA%B3%A0-K%EC%BD%98%ED%85%90%EC%B8%A0-1%EC%A1%B0-%ED%81%B4%EB%9F%BD-%EB%8D%94%EB%B8%94%EB%9E%99%EB%A0%88%EC%9D%B4%EB%B8%94%EC%9D%B4-%EA%B0%80%EC%84%B8) (검색 요약 기준)
- 더브이씨 집계로 상반기 한국 투자금의 93%가 100억 원 이상 대형 딜이고, 금액이 두 배로 늘 때 건수는 5.4% 줄었다 — [브런치 venture-digest](https://brunch.co.kr/@venture-digest/188) (검색 요약 기준)
- 와우테일은 2026년 3분기 투자액을 10조1,880억 원으로 전했다(제목만 확인) — [와우테일](https://wowtale.net/2026/10/01/265622/)

YC
- YC 런치 주소는 브라우저 없이도 JSON을 돌려주며, 제목·한 줄 소개·회사·배치·태그·작성 시각이 들어 있다. 최신 항목은 2026-10-31의 Fall 2026 배치 회사였다. 공식 공개 API라고 문서화된 것은 찾지 못했다 — [YC Launches](https://www.ycombinator.com/launches) (직접 확인)
- 비공식 `yc-oss/api`는 2026-11-01에 갱신됐고 회사 6,361곳을 담고 있다 — [yc-oss meta.json](https://yc-oss.github.io/api/meta.json), [저장소](https://github.com/yc-oss/api) (직접 확인)

인디 매출
- TrustMRR은 살아 있고 결제사 연동으로 매출을 시간 단위로 확인한다고 밝힌다. 첫 화면 기준 지원 결제사는 Stripe, RevenueCat, Superwall, App Store, Creem이다. 2차 자료들은 LemonSqueezy, Polar, Paddle을 말해 목록이 엇갈린다. 판매 중 표시와 매물 페이지도 있다 — [TrustMRR](https://trustmrr.com/), [Apify 소개](https://apify.com/zerobreak/trustmrr-startup-scraper), [ExitBid 리뷰](https://exitbid.io/blog/trustmrr-review-2026)
- 2026-09-04 기준 등록 제품 10,150개 중 MRR 약 $8,333(ARR $10만) 이상은 272개(약 2.68%)였다. MRR $5,000 초과로 보인 390건 중 37건은 만료됐거나 30일 넘게 동기화되지 않았다. 스스로 연결한 창업자만 포함되므로 전체 인디 해커를 대표하지 않는다 — [Tech Startups](https://techstartups.com/?p=138900) (검색 요약 기준)
- Indie Hackers는 curl에 403이다. 응답 내용으로 볼 때 서비스 종료가 아니라 자동 요청 차단으로 보이며, 검색 결과에는 2026년 글이 계속 나온다 — [Indie Hackers](https://www.indiehackers.com/) (직접 확인), [IH 글](https://www.indiehackers.com/post/how-much-money-do-indie-hackers-products-make-74db9631f0)
- Starter Story는 살아 있으나 `/feed`는 404다 — [Starter Story](https://starterstory.com/) (직접 확인)
- Acquire.com, Flippa, Microns는 응답하지만 피드는 없거나 확인되지 않았다. 매물 호가는 체결가가 아니다. 소액 SaaS 호가 평균이 매출 약 2.6배라는 수치는 업체 가이드의 추정이며 Acquire.com 공식 자료가 아니다 — [Acquire.com](https://acquire.com/), [Flippa](https://flippa.com/), [Microns](https://microns.io/), [Beancount 가이드](https://beancount.io/ko/blog/2026/07/11/bootstrapped-saas-valuation-multiples-2026-acquire-com-indie-founders-guide)

미충족 수요
- r/SomebodyMakeThis RSS 최신 글을 표본으로 보니 프로필 사진 요청, 설문 모집, 자기 프로젝트 홍보가 섞여 있어 쓸 만한 아이디어 밀도가 낮았다 — [r/SomebodyMakeThis RSS](https://www.reddit.com/r/SomebodyMakeThis/.rss) (직접 확인)
- Google 트렌드 RSS는 KR·US 모두 살아 있고 2026-10-31 항목이 있다. 다만 일반 급상승어(한 지역당 10건)라서 빌더 수요 신호로는 거의 잡음일 가능성이 크다 — [Trending RSS KR](https://trends.google.com/trending/rss?geo=KR) (직접 확인)
- 공식 Google Trends API는 2025-07-24 알파로 시작했고, 2026년 8월 기준으로도 알파 신청 단계라고 2차 자료들이 전한다. 일반 공개와 가격 일정은 찾지 못했다. 비공식 pytrends는 "죽었다"는 글이 있다 — [Google 공식 블로그](https://developers.google.cn/search/blog/2025/07/trends-api), [Konabayev 비교](https://konabayev.com/blog/google-trends-api-landscape-2026/), [DEV 글](https://dev.to/esteban_ortega/pytrends-is-dead-heres-how-to-get-google-trends-data-in-2026-1a18)
- App Store 순위는 Apple의 RSS 생성기 JSON으로 한국 무료 앱 상위권을 받을 수 있다 — [Apple 순위 JSON(KR)](https://rss.applemarketingtools.com/api/v2/kr/apps/top-free/10/apps.json) (직접 확인)

종료·가격 변경
- HN 검색 피드(`shutting down`, 20점 이상)에 BioWare 같은 무관한 글과 함께 "Mozilla shutting down Solo", "Pulley is shutting down in December", "Flowise is shutting down", "Mechanical Turk shutting down September 30" 같은 빌더 관련 제목이 있었다. 제목만 본 것이며 사실 확인은 안 했다 — [hnrss 검색](https://hnrss.org/newest?q=shutting+down&points=20) (직접 확인)
- 2026년 종료 사례: Productiv(8-02 공지, 8-06 종료, 사유 미공개), Sendamatic(10-01), Smithery MCP Proxy(10-31), Delighted(6-30), Recapped(7-31), CleanMyMac Business(7-14) — [1Password 글](https://1password.com/blog/productiv-shutdown-switch-to-1password-for-durable-ai-and-saas-management), [Sendamatic](https://www.sendamatic.net/blog/sendamatic-is-shutting-down), [Smithery](https://smithery.ai/future), [Delighted FAQ](https://help.delighted.com/article/840-delighted-sunset-faq), [PricingSaaS 주간 변경](https://pricingsaas.com/companies/recapped/diffs/2026W29), [MacPaw](https://macpaw.com/support/cleanmymac-business/knowledgebase/sunset)
- 가격 변경 전문 추적: PricingSaaS(주간 뉴스레터, Pro $25/월, 2025년 변경 1,800건 정리), SaaS Price Pulse(분기 보고서. 1분기 271개 중 218개 페이지 변경, 2분기 146개 도구에서 "실제 움직임" 6건), PulseSignal. 페이지 변경과 실질 가격 변경의 차이가 크다는 점이 두 보고서 수치에서 보인다 — [PricingSaaS](https://pricingsaas.com/companies/pricingsaas), [Q1 보고서](https://www.saaspricepulse.com/reports/saas-pricing-q1-2026), [Q2 보고서](https://www.saaspricepulse.com/blog/state-of-saas-pricing-q2-2026)
- killedbygoogle.com과 Failory는 응답하지만 RSS는 확인하지 못했다 — [Killed by Google](https://killedbygoogle.com/), [Failory](https://www.failory.com/) (직접 확인)

유통·SEO·앱스토어
- Apple Developer News RSS에 2026-10-29까지의 항목이 있고, 심사 지침 갱신, 개발자 계약 갱신, 대만 스토어 조정이 들어 있다 — [Apple Developer News RSS](https://developer.apple.com/news/rss/news.rss) (직접 확인)
- 실제로 굵직한 정책 변화가 2026년에 계속 나왔다. Google Play는 서비스 수수료와 결제 수수료를 분리했고 2026-06-30부터 EEA·영국·미국에 적용했으며, 첫 $100만 수익에 10%를 말하는 보도가 있다(다른 자료는 15%를 말해 조건 확인 필요). 미국 외부 결제 프로그램 보고는 10-01부터다 — [Neowin](https://www.neowin.net/amp/google-begins-rolling-out-its-post-epic-play-store-billing-model-next-week/), [TechRepublic](https://www.techrepublic.com/article/news-google-play-store-fees-third-party-payments/), [PocketGamer](https://www.pocketgamer.biz/google-play-expands-billing-options-and-lowers-fees-for-developers/)
- Apple의 EU 새 조건은 2026-10-01 시행이고 Core Technology Fee를 5% 수수료로 바꾼다. 표준 수수료 수치는 26%와 20%로 자료가 엇갈린다(조건이 다른 수치일 수 있다) — [GameWorldObserver](https://gameworldobserver.com/2026/08/19/apple-will-reduce-the-app-store-commission-in-the-eu-to-resolve-disagreements-with-the-european-commission), [Appshunter](https://appshunter.io/blog/apple-app-store-eu-fees-2026.md)
- 검색 쪽: Google은 2026-10-16 AI 검색에서 링크를 더 잘 보이게 하겠다고 했다. Ahrefs는 AI Overviews가 상위 페이지 클릭률 58% 감소와 연관된다고 했고, Chartbeat는 2025년 Google 유입 33% 감소를 말한다. 측정 대상이 달라 직접 비교는 안 된다 — [EWN](https://www.ewn.co.za/2026/10/16/google-boosts-news-and-link-visibility-in-ai-mode), [Northeast Times](https://northeasttimes.com/2026/10/25/google-ai-summaries-squeeze-the-websites-that-depend-on-search-traffic/) (2차 자료)
- 공식 Search Central 블로그와 Search Status 대시보드 피드가 살아 있다. 대시보드 Atom 피드 최신 갱신은 2026-10-08이다 — [Search Central RSS](https://developers.google.com/search/blog/feed.xml), [Search Status Atom](https://status.search.google.com/feed.atom), [SE Roundtable RSS](https://www.seroundtable.com/index.xml) (직접 확인)

채용·해고
- HN의 Who is hiring은 매월 1일 올라온다. 2026년 10월 글은 댓글 390개, Who wants to be hired는 699개, 9월 Who is hiring은 389개였다 — [HN Algolia API](https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3) (직접 확인)
- layoffs.fyi는 살아 있지만 표가 Airtable 임베드이고 초기 HTML에는 숫자가 없다. RSS나 공개 API는 찾지 못했다 — [layoffs.fyi](https://layoffs.fyi/) (직접 확인)
- 한국: 잡코리아가 2026-07-28 공개한 리포트에서 주니어 응답자 76.4%가 공고 감소를 체감했다고 한다(블로그 인용). "IT 신입 공고 73% 급감" 기사는 제목만 확인해 기간과 기준을 모른다. 월별 공식 통계 피드는 찾지 못했다 — [Youngju 블로그](https://www.youngju.dev/split/2026-07-12-dev-job-market-2026), [다음 뉴스](https://v.daum.net/v/PPvRLmmjh7), [잡플래닛](https://www.jobplanet.co.kr/contents/news-8452)

한국 지원사업
- 기업마당 RSS 주소는 살아 있으나 인증키 없이는 "인증키를 입력해주세요"를 돌려준다 — [bizinfoApi](https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do) (직접 확인)
- K-Startup은 공공데이터포털 15125364(`kisedKstartupService01`)로 사업공고를 제공하며 무료·자동 승인이라는 설명이 있다. 다만 일부 사업만 노출되고 중기부·지자체 단독 공고는 빠질 수 있다고 한다. 이는 제3자 문서이며 공식 페이지는 확인 못 했다 — [k-skill 문서](https://raw.githubusercontent.com/NomaDamas/k-skill/main/docs/features/kstartup-search.md)
- 벤처스퀘어는 `venturesquare.net/announcement/…` 아래에 지원사업 공고도 싣는다 — [공고 예시](https://www.venturesquare.net/announcement/1093926)
- 중기부 보도자료 RSS가 동작한다 — [중기부 RSS](https://www.mss.go.kr/rss/smba/board/86.do) (직접 확인)

한국 규제
- 개인정보보호법 개정안이 2026-09-11 시행됐다. 반복·대규모 위반 등에 전체 매출 최대 10% 과징금, 사전 투자·신속 대응 시 감경 구조다. ISMS-P 의무화는 2027-07-01 시행 예정이다 — [머니투데이](https://www.mt.co.kr/tech/2026/09/10/2026091008562069877), [MTN](https://news.mtn.co.kr/news-detail/2026091013005252100), [뉴시스](https://www.newsis.com/view/NISX20260309_0003540588) (검색 요약 기준)
- AI 기본법은 2026-01-22 시행됐다. 과태료 계도기간은 "최소 1년 이상"이라는 보도가 다수이나, 다른 해설은 일부 내용의 6개월 유예를 말한다. 표시 의무 주체는 사업자이고, 해외 사업자도 국내 이용자 대상이면 포함된다는 해설이 있다 — [뉴시스](https://mobile.newsis.com/view/NISX20260121_0003484769), [Twig24](https://www.twig24.com/news/2026/01/23/20260123030002), [SK AX](https://www.skax.co.kr/insight/trend/3666)
- 시행령 개정안 입법예고(2026-05)와 7월 후속 시행 보도가 있어 2026년 하반기에 내용이 계속 바뀌고 있다 — [다음 뉴스](https://v.daum.net/v/20260521120222884), [법률신문](https://www.lawtimes.co.kr/news/articleView.html?idxno=223727)

한국 결제·플랫폼
- 포트원의 2026년 비교 글은 토스페이먼츠 카드 수수료 3.4%, 연 관리비 11만 원을 적었다. 업체 자료이고 "매년 변동"이라고 스스로 밝힌다 — [포트원 블로그](https://blog.portone.io/opi_pg-comparison2026/)
- Stripe 블로그 RSS는 살아 있다. 토스 피드 주소로 시도한 `tossfeed/rss`는 HTML을 돌려줘 RSS가 아니었다. 우아한형제들 기술블로그는 RSS가 있다 — [Stripe RSS](https://stripe.com/blog/feed.rss), [우아한형제들 RSS](https://techblog.woowahan.com/feed/) (직접 확인)

한국 커뮤니티
- GeekNews RSS는 50건, 최신 항목은 수집 당일이다. 키워드로 거르면 이번 표본에서 빌더 비즈니스 관련은 "OpenAI, 최근 투자 라운드에서 목표액의 절반도 조달하지 못해" 정도였다. 기술 글 비중이 높다 — [GeekNews RSS](https://news.hada.io/rss/news) (직접 확인)
- 요즘IT는 RSS가 있으나(30건) 날짜 태그가 표준 pubDate로 잡히지 않았다 — [요즘IT 피드](https://yozm.wishket.com/magazine/feed/) (직접 확인)
- Disquiet, EO(eopla.net), OKKY는 살아 있지만 `/rss`가 404다. 다른 경로가 있는지는 확인 못 했다 — [Disquiet](https://disquiet.io/), [EO](https://eopla.net/), [OKKY](https://okky.kr/) (직접 확인)

오픈소스 사업
- HN `relicense` 피드의 최신 항목이 2026-08-21이고, 최근 18건 안에 오래된 글이 섞여 있어 사건 빈도가 낮다. "license change" 검색도 표본 대부분이 Redis·HashiCorp·CockroachDB 같은 과거 사례였다 — [hnrss relicense](https://hnrss.org/newest?q=relicense), [hnrss license change](https://hnrss.org/newest?q=license+change&points=10) (직접 확인)
- 2026년 콘텐츠도 대부분 Redis→Valkey, Elastic→OpenSearch, Terraform→OpenTofu 재론이었고, 검색에서는 새 2026년 라이선스 변경 사건을 찾지 못했다. Bitnami 이미지 유료화 문제가 언급된다 — [The New Stack](https://thenewstack.io/what-happens-to-relicensed-open-source-projects-and-their-forks/), [SCALE 2026 발표](https://fastwonderblog.com/wp-content/uploads/2026/03/Power-Dynamics-Rug-Pulls-Other-Impact-on-Sustainability-SCALE-2026.pdf)
- HN 표본에 "Can coding agents relicense open source through a 'clean room' implementation?"이 있었다. AI가 새 쟁점을 만들고 있다는 단서다 — [hnrss relicense](https://hnrss.org/newest?q=relicense)
- CHAOSS 연구는 라이선스 변경의 기여자 영향이 사례마다 다르다고 했다 — [CHAOSS](https://chaoss.community/?p=6080)
- OSI 블로그 피드는 살아 있다 — [OSI RSS](https://opensource.org/feed) (직접 확인)

### Inferences
- '빌더' 섹션의 차별점은 투자 뉴스가 아니라 "이번 주 내가 고쳐야 하거나 잡을 수 있는 것"이다. 대형 딜은 일반 AI 브리프에도 이미 들어가므로 한 줄 묶음이면 충분하다.
- 범주별 고정 칸은 비추천이다. 종료·정책·라이선스는 없는 날이 많아, 매일 칸을 채우면 질이 떨어진다. 사건이 있을 때만 싣는 방식이 맞다.
- 한국 규제는 한국 독자에게만 값이 있어, 해외 빌더 소식지와 겹치지 않는 차별점이다. 다만 법률 조언처럼 쓰면 안 되고 공식 자료 링크와 "시행일·대상"만 전달해야 한다.

### Gaps
- Disquiet·EO·OKKY의 숨은 피드나 비공개 API 유무는 확인하지 못했다.
- 범주별 실제 하루 건수는 며칠치 표본을 모아야 알 수 있다. 이번은 하루 표본이다.
- 인앱결제법 등 한국 결제 규제의 2026년 변화는 찾지 못했다.

## 어떤 범주가 정말 시간에 민감한가

### Takeaway
시행일·마감일·종료일이 있는 것만 진짜 시간에 민감하다. 매일: 플랫폼 정책, 종료 공지, 규제 시행, 라이선스 변경. 주간: 지원사업 마감, 투자, YC, 인디 매출. 월간: 채용, 수요·순위 추세.

### Cited Findings
- 날짜가 박힌 실제 사례: Reddit RSS 종료 2026-11-13, 이전 보상 등록 마감 11-30, 2027-01-12 미등록 앱 차단 시작 — [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/); Google Play 외부 결제 보고 2026-10-01 — [Neowin](https://www.neowin.net/amp/google-begins-rolling-out-its-post-epic-play-store-billing-model-next-week/); 개인정보보호법 2026-09-11 — [MTN](https://news.mtn.co.kr/news-detail/2026091013005252100); Productiv는 공지 후 4일 만에 종료 — [1Password](https://1password.com/blog/productiv-shutdown-switch-to-1password-for-durable-ai-and-saas-management)
- Who is hiring은 월 1회 올라온다 — [HN Algolia](https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3)
- 한국 투자 매체도 자체적으로 주간 연재(`[이번주투자]`)로 묶는다 — [스타트업레시피 RSS](https://www.startuprecipe.co.kr/feed)
- 가격 보고서는 분기 단위이고 "실제 움직임"은 2분기 146개 도구에서 6건이었다 — [Q2 보고서](https://www.saaspricepulse.com/blog/state-of-saas-pricing-q2-2026)

### Inferences
- 판단 기준 제안: "그 날짜를 놓치면 독자가 손해를 보는가". 그렇다면 매일, 아니면 주간 이하.
- 인기 SaaS의 가격 변경은 드물어서 추적기를 따로 구독할 값은 낮다. GeekNews·HN에 떠오른 것만 잡아도 된다.
- MRR 순위는 매시간 바뀌어도 뉴스가 아니다. 주간 변화의 이야기만 값이 있다.

### Gaps
- 독자가 실제로 어떤 주기를 원하는지에 대한 근거는 없다. 사용자 판단이 필요하다.

## 어떤 소스가 API/RSS를 갖췄고 어떤 곳이 아닌가

### Takeaway
공식 RSS가 튼튼한 쪽은 기술 매체, 한국 스타트업 매체, 플랫폼 공식 공지다. 약한 쪽은 Reddit(곧 종료), Indie Hackers(403), layoffs.fyi, THE VC, 한국 커뮤니티 대부분이다.

### Cited Findings
직접 확인한 결과(2026-11-01):

RSS 정상
- 글로벌 스타트업: [TechCrunch Startups](https://techcrunch.com/category/startups/feed/), [TechCrunch Venture](https://techcrunch.com/category/venture/feed/), [Crunchbase News](https://news.crunchbase.com/feed/)(10-30), [SaaStr](https://www.saastr.com/feed/), [Lenny's Newsletter](https://www.lennysnewsletter.com/feed)
- 한국 스타트업: [플래텀](https://platum.kr/feed), [벤처스퀘어](https://www.venturesquare.net/feed), [와우테일](https://www.wowtale.net/feed/), [스타트업레시피](https://www.startuprecipe.co.kr/feed), [바이라인네트워크](https://byline.network/feed/), [블로터](https://www.bloter.net/rss/allArticle.xml)
- 커뮤니티: [GeekNews](https://news.hada.io/rss/news), [요즘IT](https://yozm.wishket.com/magazine/feed/), [hnrss](https://hnrss.org/show)(`/newest?q=`로 키워드 피드 가능, [Who is hiring](https://hnrss.org/whoishiring)), [Product Hunt](https://www.producthunt.com/feed)(Atom 50건, 다만 일간 순위 페이지는 403)
- 플랫폼·정책: [Apple Developer News](https://developer.apple.com/news/rss/news.rss), [Android Developers](https://android-developers.googleblog.com/feeds/posts/default), [Search Central](https://developers.google.com/search/blog/feed.xml), [Search Status](https://status.search.google.com/feed.atom), [SE Roundtable](https://www.seroundtable.com/index.xml), [Stripe](https://stripe.com/blog/feed.rss), [OSI](https://opensource.org/feed), [중기부 보도자료](https://www.mss.go.kr/rss/smba/board/86.do)

API/JSON
- [YC Launches JSON](https://www.ycombinator.com/launches), [yc-oss](https://yc-oss.github.io/api/meta.json), [HN Algolia](https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=3), [Apple 순위 JSON](https://rss.applemarketingtools.com/api/v2/kr/apps/top-free/10/apps.json), [Google Trending RSS](https://trends.google.com/trending/rss?geo=KR)
- TrustMRR API: Bearer 키, `GET /startups`와 `GET /startups/{slug}`, 표준 분당 10회·프리미엄 60회. 이용 정책이 "bulk republication"과 승인 없는 공개 SEO 페이지를 금지하며, 위반 시 영구 차단이다. 공개 사이트에 표로 옮겨 싣는 용도는 위험하다 — [TrustMRR API 문서](https://trustmrr.com/docs/api)
- 기업마당·K-Startup: 인증키 필요 — [bizinfoApi](https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do), [k-skill 문서](https://raw.githubusercontent.com/NomaDamas/k-skill/main/docs/features/kstartup-search.md)

곧 사라지는 것
- Reddit: 지금은 RSS가 응답하지만(r/SomebodyMakeThis 200, r/SaaS top은 429) 2026-11-13에 RSS가 끝나고, 새 공개 API 신청은 2026-10-31에 닫혔다. 공개 API는 2027년 3월 종료, 상업 이용은 계약 필요다. 관리자 커뮤니티 밖의 대체 피드는 없다고 한다. 여러 매체 보도가 일치하지만 Reddit 원문 글은 직접 읽지 못했다 — [PPC Land](https://ppc.land/reddit-to-halt-public-data-api-access-in-march-2027-as-14-000-apps-register/), [TechRepublic](https://www.techrepublic.com/article/news-reddit-rss-public-api-shutdown/), [Decrypt](https://decrypt.co/379892/reddit-killing-rss-feeds-and-public-api-access-to-fight-ai-scrapers), [Michael Tsai](https://mjtsai.com/blog/2026/10/06/reddit-to-remove-rss/)

피드 없음·막힘
- 403: [Indie Hackers](https://www.indiehackers.com/), [Search Engine Land 피드](https://searchengineland.com/feed), [G2](https://www.g2.com/)
- 응답은 하나 피드 없음 또는 미확인: [layoffs.fyi](https://layoffs.fyi/), [Starter Story](https://starterstory.com/), [Acquire.com](https://acquire.com/), [Flippa](https://flippa.com/), [Disquiet](https://disquiet.io/), [EO](https://eopla.net/), [OKKY](https://okky.kr/), [Failory](https://www.failory.com/), [원티드](https://www.wanted.co.kr/), [사람인](https://www.saramin.co.kr/), [개인정보위](https://www.pipc.go.kr/), [과기정통부 게시판](https://www.msit.go.kr/bbs/list.do?sCode=user&mId=113&mPid=112)
- 실패: `korea.kr/rss/dept_*.xml` 형식 추정 주소는 404였다(추정 주소이므로 정책브리핑 RSS 자체가 없다는 뜻은 아니다). [blog.acquire.com 피드](https://blog.acquire.com/feed/)는 응답 없음.
- THE VC: 사이트는 살아 있으나 API·RSS를 확인하지 못했고 요금제 페이지는 WebFetch에서 403이었다. 페이지 고지에 무단 사용·DB화 시 민형사상 책임 가능성이 적혀 있고, 포트폴리오 세부 항목은 대부분 잠겨 있다고 검색 요약이 전한다 — [THE VC](https://thevc.kr/), [THE VC pricing](https://thevc.kr/pricing)

### Inferences
- 기존 `feeds` 명령 구조에 RSS만 추가해도 범주 대부분을 덮을 수 있다. 새 크롤러는 거의 필요 없다. 예외는 기업마당·K-Startup API 키, YC JSON이다.
- Reddit은 신규 소스로 넣지 않는 편이 낫다. 11월 13일 뒤 끊긴다. 대체 경로로는 Claude의 웹 검색이 Reddit 글을 얼마나 찾는지 시험해 봐야 하고, 없으면 HN `Ask HN`, GeekNews 같은 다른 곳으로 옮긴다.
- 한국 투자는 THE VC를 직접 수집하지 말고 스타트업레시피 주간 연재를 쓰는 것이 약관 위험이 낮다. THE VC는 링크만 건다.
- 정부 부처 공지는 RSS가 고르지 않아 Claude 웹 검색이나 중기부 RSS로 채운다.
- 이미 쓰는 방식(`docs/memory.md` 2026-10-28)대로 RSS의 제목·요약을 근거로 삼고, 막힌 페이지는 curl로 읽지 않는다는 원칙이 여기서도 그대로 맞는다.

### Gaps
- Reddit 공지 원문은 직접 읽지 못했다.
- K-Startup 데이터셋 공식 페이지의 호출 한도와 응답 형식은 미확인이다.
- YC Launches JSON의 이용 조건, Product Hunt 피드의 이용 조건은 확인하지 않았다.
- 원티드·사람인의 공개 API는 조사하지 못했다.

## 어떤 범주가 과장이거나 자기 신고라 검증할 수 없는가

### Takeaway
가장 약한 것은 자기 신고 MRR과 '성공담' 콘텐츠다. 결제사 연동은 이를 개선하지만 독립 감사가 아니다. 투자 금액은 사실성은 높아도 집계 차이가 크고, 호가는 체결가가 아니며, 설문·체감 통계는 공고 수 실측이 아니다.

### Cited Findings
- 가짜 MRR 차트 생성기가 공개적으로 팔리고 있고, 제작자가 "fake stripe dashboard" 검색 유입이 들어온다고 말했다 — [Tom's Guide](https://www.tomsguide.com/ai/if-this-22-year-old-made-usd400-000-over-the-weekend-why-cant-i-inside-the-fake-ai-entrepreneur-boom)
- TrustMRR은 결제사 연동으로 이를 줄이려 하지만, 창업자가 스스로 연결한 표본이다. 불리한 곳은 안 나타나고, 오래 동기화되지 않은 기록도 있다(390건 중 37건) — [Tech Startups](https://techstartups.com/?p=138900)
- TrustMRR의 조작 사례나 결함을 다룬 독립 보도는 찾지 못했다. 다만 검색에 나온 것은 대부분 홍보성 글이라, 문제가 없다는 증거도 아니다. 어떤 Stripe 계정을 연결했는지, 일회성·관계사 매출을 어떻게 거르는지도 확인하지 못했다 — [TrustMRR FAQ](https://www.trustmrr.com/faq), [Makerstack 리뷰](https://makerstack.co/reviews/trustmrr-review/)
- Stripe 대시보드만으로는 실제 입금과 다를 수 있어 인수자는 은행 입금 대조를 기대한다는 가이드가 있다(업체 글) — [Beancount 가이드](https://beancount.io/ko/blog/2026/07/11/bootstrapped-saas-valuation-multiples-2026-acquire-com-indie-founders-guide)
- 한국 투자 집계는 같은 기간이 기관에 따라 건수 697 대 551, 월 금액 약 2.5배 차이가 난다 — [스타트업레시피 리포트](https://startuprecipe.co.kr/wp-content/uploads/2026/07/260725_startuprecipe_investment_report_H1_00001.pdf), [혁신의 숲](https://www.innoforest.co.kr/report/491/-2026%EB%85%84-5%EC%9B%94-%EC%8A%A4%ED%83%80%ED%8A%B8%EC%97%85-%ED%88%AC%EC%9E%90%EA%B2%B0%EC%82%B0-%EB%94%A5%ED%85%8C%ED%81%AC%EB%A1%9C%EB%B3%B4%ED%8B%B1%EC%8A%A4%EA%B0%80-%EB%81%8C%EA%B3%A0-K%EC%BD%98%ED%85%90%EC%B8%A0-1%EC%A1%B0-%ED%81%B4%EB%9F%BD-%EB%8D%94%EB%B8%94%EB%9E%99%EB%A0%88%EC%9D%B4%EB%B8%94%EC%9D%B4-%EA%B0%80%EC%84%B8)
- SaaS 가격 "변경" 수치는 기준에 따라 극단적으로 다르다(1분기 80%가 페이지 변경, 2분기 146개 중 실제 움직임 6건, 같은 회사 보고서) — [Q1](https://www.saaspricepulse.com/reports/saas-pricing-q1-2026), [Q2](https://www.saaspricepulse.com/blog/state-of-saas-pricing-q2-2026)
- AI 검색 유입 감소 수치는 지표가 서로 달라(유입, 클릭률, 전체 검색 트래픽) 나란히 놓으면 오해를 부른다 — [Northeast Times](https://northeasttimes.com/2026/10/25/google-ai-summaries-squeeze-the-websites-that-depend-on-search-traffic/)
- 한국 개발자 채용 76.4%는 체감 설문이고 복수 응답이다 — [Youngju 블로그](https://www.youngju.dev/split/2026-07-12-dev-job-market-2026)
- 2026년 '인디 통계'류 글은 AI 생성풍 재가공이 많아 출처 사슬을 확인해야 한다(이번 검색에서 mean.ceo, beancount.io 다국어 복제 등이 다수 나왔다) — [mean.ceo](https://blog.mean.ceo/?p=11175), [Beancount](https://beancount.io/blog/2026/07/11/bootstrapped-saas-valuation-multiples-2026-acquire-com-indie-founders-guide)

신뢰도 등급 제안(판단)
- 높음: 플랫폼·정부 공식 공지, 서비스 자체 종료 공지, 라이선스 파일 변경 커밋.
- 중: 언론의 투자 보도(금액은 회사 발표 기반), 집계 기관 통계(기준 명시 필요), YC 런치 글.
- 낮음: 결제사 연동 없는 MRR, 스타터스토리류 성공담, 체감 설문, X의 수익 인증.
- 신호로만: Reddit 불만글, Google 트렌드 급상승어, 앱 리뷰.

### Inferences
- MRR 표기 규칙 제안: "자기 신고"와 "결제사 연동 확인(TrustMRR)"을 문구로 구분하고, 후자도 "독립 감사 아님"으로 둔다. 이미 사이트에 있는 출처 표기 규칙과 맞춘다.
- TrustMRR은 상위 순위 나열보다 개별 사례 소개에 쓰는 편이 API 정책에도 맞고 내용도 낫다.
- 금액을 쓸 때는 집계 기관 이름을 함께 쓰고, 기관 간 합산이나 비교는 하지 않는다.
- 이 섹션의 위험은 "돈 벌었다" 콘텐츠가 사이트의 신뢰를 낮추는 것이다. 성공담보다 실패·종료·정책 변화 비중을 높이는 쪽이 사실 확인도 쉽고 독자에게도 쓸모가 크다.

### Gaps
- 자기 신고 MRR의 허위 비율을 잰 독립 연구는 찾지 못했다.
- TrustMRR 운영자(Marc Lou)가 자기 제품도 순위에 올리는 이해 상충이 있는지, 지금의 등록 수는 얼마인지 공식 수치를 확인하지 못했다. 2026 블로그의 "840+ 스타트업"과 위 10,150개 수치는 시점이나 기준이 달라 일치하지 않는다 — [DEV 글](https://dev.to/jason_01kk/i-integrated-trustmrrs-api-into-our-listing-flow-heres-the-verified-revenue-ecosystem-in-2026-57c3), [Tech Startups](https://techstartups.com/?p=138900)
- AI 기본법 계도기간의 확정 내용은 과기정통부 원문으로 확인하지 못했다.
