# 9.96단계 소스 판정 근거

법률 자문이 아니다. 2026-11-04 명세서 작성 중 약관·이용허락 원문, robots.txt, 실제 응답(키를 넣은 단발 호출. 칸 이름, 건수, 날짜 범위만 봤다)을 보고 판정했다. 판정 기준은 [docs/demand-sources.md](../../demand-sources.md)의 "판정 기준 (D16)"과 같다. 공개 백업은 모두 하지 않는다(명세서 S3). 아래 '공개 백업'은 재배포가 허용되는지에 대한 판정만 적는다.

## 쓰는 곳

### 열린국회정보 (open.assembly.go.kr)

- 받는 것: 국민동의청원 접수목록(`PTTRCP`, 22대), 청원 계류현황(`nvqbafvaajdiqhehi`), 청원 처리현황(`ncryefyuaflxnqbqo`, `AGE=22`). 키 `ASSEMBLY_API_KEY`.
- 실제 응답: 접수목록 22대 359건(21대 194건). 칸은 `CITZN_AGM_CNT`(동의 수), `ERACO`, `INTD_ASBLM_NM`(소개의원), `LINK_URL`, `PTTR_NM`(청원인), `PTT_ID`, `PTT_KIND`, `PTT_NM`(제목), `PTT_NO`, `RCP_DT`. 계류현황 340건, 칸 `AGE`, `APPROVER`(소개의원), `BILL_ID`, `BILL_NAME`, `BILL_NO`, `COMMITTEE_DT`, `CURR_COMMITTEE(_ID)`, `LINK_URL`, `PROPOSER`(청원인), `PROPOSE_DT`. 처리현황은 `AGE`가 있어야 하고 22대 19건, 처리결과 칸(`PROC_RESULT_CD`)이 있다. 날짜 조건이 없어 목록 전체를 그날 상태로 받는다.
- 약관: [이용약관](https://open.assembly.go.kr/portal/policy/openUserAgreementPage.do)과 [저작권 정책](https://open.assembly.go.kr/portal/policy/copyRightPage.do). Open API로 받은 정보는 '열린국회정보에서 제공된 정보'라고 출처를 밝히고 쓸 수 있다. 계류현황은 공공누리 1유형(출처표시)이다. 저장·AI 입력·자동 호출을 막는 조항이 없다.
- robots: `open.assembly.go.kr`는 `User-agent: *`에 `Disallow: /admin/`만 둔다. `petitions.assembly.go.kr`은 `*`를 막아 받지 않는다.
- 판정: 저장 됨, AI 입력 됨(제목은 청원인이 쓴 글이라 격리 프로세스만 읽는다), 요약 게시 됨(출처 '열린국회정보'), 공개 백업은 계류·처리현황의 숫자·코드만 보면 됨이나 제목이 외부인 글이라 D16에 따라 하지 않는다.
- 버리는 칸: `PTTR_NM`, `PROPOSER`(청원인 이름). 소개의원(`INTD_ASBLM_NM`, `APPROVER`)은 공직자라 둔다.

### 공공데이터포털 (apis.data.go.kr)

포털 [이용약관](https://www.data.go.kr/ugs/selectPortalPolicyView.do)은 회원의 금지 행위로 계정 공유, 허위 정보, 범죄, 권리 침해, 해킹·운영 방해 등을 둔다. 저장·가공·AI 입력·자동 호출을 막지 않고, 데이터마다 이용허락 범위를 따르게 한다. 오픈 API는 이용 형태가 제공 기관의 업무에 지장을 주면 제한될 수 있다(하루 호출 한도를 지킨다). robots: `apis.data.go.kr/robots.txt`는 robots 파일이 아니라 400과 오픈 API 오류 XML('해당 오픈API 서비스가 없거나 폐기됨')을 준다. robots 파일이 없는 것으로 본다(RFC 9309의 4xx). 포털 본 사이트(`www.data.go.kr`)의 robots는 Googlebot의 몇 경로만 막는다. 키 `DATA_GO_KR_KEY`(개발계정, 2026-11-04 활용신청 승인).

| 데이터 | 번호 | 이용허락 | 하루 한도(개발계정) | 실제 응답 | 판정 |
|---|---|---|---|---|---|
| 국민권익위 민원정책 질의응답 | 15074671 | 제한 없음 | 10,000 | 목록 `PolicyQnaList`(`regFrom`, `regTo`, 하루 단위로 됨). 5주 542건. 칸 `ancCode`, `ancName`, `dutySctnNm`, `faqNo`, `regDate`, `title`. 상세 `PolicyQnaItem`(`faqNo`)에 질문·답변 본문, 부서, 관련 법령. 2026-06은 되고 2024-01은 E03(자료 없음) | 저장·AI 입력·요약 게시 됨. 질문은 민원인이 쓴 글이라 격리 프로세스만 읽는다 |
| 국민권익위 공개제안 | 15059423 | 제한 없음 | 10,000 | 목록 `OpenProposalList`(`regFrom`, `regTo`, 최대 1년). 5주 2,779건. 칸 `ancName`, `petiNo`, `regDate`, `statusCode`, `statusName`, `title`. 상세 `OpenProposalItem`(`petiNo`)에 신청인명 `peterName` | 저장·AI 입력·요약 게시 됨. 제안 글은 외부인 글이라 격리 프로세스만 읽는다. `peterName`은 버린다 |
| 공정거래위원회 1372 소비자상담 접수 | 15127091 | 제한 없음 | 10,000 | `getDscsnDetailSttus_2`(`rcptYm` 필수, `numOfRows` 1000 됨, `resultType=json`). 202609 49,539건, 202610 49,829건(입력일이 10-21까지), 202611 0건. 한 건 약 740바이트(한 달 약 37MB). 코드값 칸만 있고 이름 칸이 없다 | 저장·AI 입력·요약 게시 됨. 공공기관 수치라 재배포도 되지만 크기 때문에 공개 백업하지 않는다(S3) |
| 국민권익위 민원빅데이터 분석정보 | 15101903 | 공공누리 2유형(출처표시, 상업적 이용금지) | 100 | `minAnalsInfoView5/`의 오퍼레이션(`minTodayTopicInfo5`(`searchDate`), `minTopNKeyword5`(`dateFrom`, `dateTo`), `minRisingKeyword5`(`analysisTime`) 등), `target=pttn,dfpt,saeol`. 2026-11-03과 2026-09-28을 받았다(지난 날짜 됨). 같은 키로 연달아 부르면 '요청 사이에 약 2분 간격'을 요구하는 제한 응답을 준다(다른 데이터의 호출에는 나오지 않았다) | 저장·AI 입력·요약 게시 됨(출처 '국민권익위원회'). 광고 없는 비상업 사이트라 됨이고, 광고를 달기 전에 다시 본다(D16) |

### OpenDART (opendart.fss.or.kr)

- 받는 것: 공시검색 `list.json`(회사를 정하지 않고 날짜 하루, 100건씩 페이지). 키 `DART_API_KEY`.
- 실제 응답: 하루 약 518~553건(100건 6페이지). 회사를 정하지 않으면 기간이 3개월로 제한된다. 칸 `corp_cls`, `corp_code`, `corp_name`, `flr_nm`(공시 제출인), `rcept_dt`, `rcept_no`, `report_nm`, `rm`, `stock_code`.
- 약관: [이용약관](https://opendart.fss.or.kr/intro/terms.do)은 회원 가입, 키 관리, 호출 한도(하루 20,000회), 금지 행위(부정 사용, 서비스 방해)를 다룬다. 받은 정보의 저장·가공·AI 입력을 막는 조항이 없다. 재배포에 대한 조항이 없어 공개 백업은 애매하다(하지 않는다).
- robots: `opendart.fss.or.kr/robots.txt`는 `/error.html`(200 HTML)로 가는 302다. robots 파일이 없는 것으로 본다. 공시 원문 뷰어(`dart.fss.or.kr`)는 robots가 막아 받지 않는다.
- 판정: 저장 됨, AI 입력 됨(공시 제목·회사 이름은 글 칸이라 다른 소스와 같이 격리 프로세스만 읽는다), 요약 게시 됨(출처 'DART'), 공개 백업 안 함.
- 버리는 칸: `flr_nm`.

### SEC EDGAR Form D (www.sec.gov)

- 받는 것: 일별 인덱스 `https://www.sec.gov/Archives/edgar/daily-index/YYYY/QTRn/form.YYYYMMDD.idx`에서 `D`와 `D/A` 줄(하루 약 300건)을 골라, 각 신고의 `primary_doc.xml`(약 7.6KB)을 받는다. 인덱스의 다른 양식 줄(Form 3·4·144 등 내부자 개인 이름이 있는 줄)은 저장하지 않는다. 인덱스가 없는 날(주말, 아직 안 올라온 날)은 403 `AccessDenied`를 주고, 분기 목록 `daily-index/YYYY/QTRn/index.json`은 있는 인덱스를 나열한다(2026-11-04 확인).
- 약관: [Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)는 초당 10회 이하와 연락처가 든 User-Agent('이름 메일')를 요구한다. [웹사이트 정책](https://www.sec.gov/privacy)은 사이트 정보가 공개 정보이고 복사·재배포할 수 있으며 SEC를 출처로 밝히라고 한다.
- robots: `User-agent: *`에 `/Archives/edgar/`를 막지 않는다(`/Archives/bin`, `/Archives/etc`, `/Archives/usr`, `/cgi-bin` 등만 막는다). 연락처 없는 User-Agent로는 403이다. 전문 검색(`efts.sec.gov`)은 robots가 403이라 애매해 쓰지 않는다.
- 판정: 저장 됨, AI 입력 됨, 요약 게시 됨(출처 'SEC EDGAR'), 재배포는 되지만 공개 백업하지 않는다(S3).
- 버리는 칸: `relatedPersonsList`, `signatureBlock` 안의 `signatureName`·`nameOfSigner`·`signatureTitle`, `salesCompensationList`, `issuerPhoneNumber`, 주소의 `street1`·`street2`·`zipCode`(사람과 연락처). 회사 이름, 도시·주, 업종, 금액, 날짜는 둔다.

### Wikimedia 인기 문서 (wikimedia.org)

- 받는 것: `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/<프로젝트>/all-access/YYYY/MM/DD`. 하루 999개 문서와 조회 수, 위키 하나에 약 52~56KB. 2015-07부터 있다.
- 약관: 조회 수 데이터는 CC0다([Analytics API 접근 정책](https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/documentation/access-policy.html)). [API 사용 지침](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_API_Usage_Guidelines)과 [User-Agent 정책](https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy)은 연락처가 든 User-Agent와 적당한 호출 속도를 요구한다. [이용 약관](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use)은 서비스 방해를 막는다.
- robots: `wikimedia.org/robots.txt`는 `www.wikimedia.org//robots.txt`로 가는 302이고 그곳은 404다. robots 파일이 없는 것으로 본다. `en.wikipedia.org`의 robots는 `/api/`를 막아 그 호스트로 받지 않는다.
- 판정: 저장 됨, AI 입력 됨, 요약 게시 됨(출처 'Wikimedia'), 재배포 됨(CC0). 공개 백업은 S3에 따라 하지 않는다. 문서 제목은 위키 문서 이름이고 사용자 글이 아니다. 주 문서가 아닌 것(특수 문서, 대문 등)은 저장할 때 거르지 않는다(원문 그대로, 뒤 단계가 거른다).

## 쓰지 않는 곳

| 소스 | 이유 |
|---|---|
| 네이버 데이터랩(API HUB) | [API HUB 약관](https://xv-ncloud.pstatic.net/images/provision/NAVER_API_%C3%AC%C2%84%C2%9C%C3%AB%C2%B9%C2%84%C3%AC%C2%8A%C2%A4_%C3%AC%C2%9D%C2%B4%C3%AC%C2%9A%C2%A9%C3%AC%C2%95%C2%BD%C3%AA%C2%B4%C2%80_APIHUB_%C3%AC%C2%B5%C2%9C%C3%AC%C2%A2%C2%85_260624_KR_clean_1782291589723.pdf) 일반조건 7.3③이 '허용 범위'를 넘는 저장·가공을 막는데 그 범위가 어디에도 정해져 있지 않다. 매일 저장이 걸리는지 애매하다(D16). 개발자센터(`openapi.naver.com`)는 robots가 `*`를 막는다 |
| 한국소비자원 소비자 위해정보(15142643) | 날짜 조건이 없고, 2026-11-04 기준 22,862건이 모두 2026-07~08 접수분이다(1·2·20페이지 확인, 깊은 페이지는 시간 초과). 비교 기간(최근 5주)을 채울 수 없다. 이용허락은 제한 없음이다. 개발계정 신청은 승인되어 있어 최근 데이터가 올라오면 뒤 단계에서 다시 본다 |
| 국민동의청원 사이트(`petitions.assembly.go.kr`) | robots가 `*`를 막는다 |
| SEC 전문 검색(`efts.sec.gov`) | robots가 403이라 애매하다 |
| DART 공시 원문(`dart.fss.or.kr`) | robots가 막는다 |
| GDELT | 단발 확인에서 429를 줬다. 막힐 위험이 크다 |
| Pew, KOSIS, World Bank, OECD, Stack Overflow 설문 | 연·월 단위 보조 통계라 7일 비교의 재료가 아니고, 이번에 약관을 읽지 않았다. 9.97에서 배경 자료가 필요하면 그때 판정한다 |
| K-Startup, 크라우드펀딩 | 투자·지원사업 개별 사건은 10.5가 싣고, 돈의 흐름은 DART와 SEC Form D로 시작한다. 판정하지 않았다 |
| 서울 불편신고 | 한 지역 자료라 이번에 넣지 않았다. 판정하지 않았다 |
