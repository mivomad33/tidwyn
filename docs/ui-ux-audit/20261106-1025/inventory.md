# 조사 결과 합본

4.4에서 메인이 조사별 `result.md`를 합쳤다. 경로의 `A`는 이 감사 폴더(`docs/ui-ux-audit/20261106-1025`)이고, `A/raw/`와 `A/shots/`는 커밋하지 않는다. 데이터는 모두 지어낸 테스트 데이터다.

## 첫눈 맞춤 (P3 첫눈 셋 × 주요 화면)

정답 목록은 `baseline.md`. 본문 첫째로 1순위를 꼽은 모델 수 / 3.

| 화면 | 폭 | 첫째로 꼽은 것(모델 1·2·3) | 1순위 맞음 | 판정 |
|---|---|---|---|---|
| 브리프 | 375 | 요약 문단·칩 / 요약 문단·칩 / 요약 문단·칩 | 0/3 | 틀림 |
| 브리프 | 1280 | 요약 문단 / 요약 문단 / 기사 제목 목록 | 1/3 | 틀림 |
| 이슈 페이지 | 375·1280 | 이슈 이름(h1) ×3, 둘째가 요약 상자 ×3 | 0/3 | 틀림(둘째로는 모두 요약) |
| 영상 페이지 | 375·1280 | 썸네일 ×3 | 0/3 | 틀림 |
| 일정 | 375·1280 | 화면 제목과 목록/달력 전환 ×3 | 0/3 | 틀림 |
| 검색 | 375·1280 | 화면 제목과 입력칸 ×3 | 0/3 | 틀림 |

- 이슈·영상·일정·검색의 첫째는 모두 화면 제목·썸네일·입력칸이다. 정답 목록이 화면 제목을 빼지 않아 틀림이 되었고, 브리프만 제목이 아닌 다른 덩어리(요약 문단·일정 상자)가 첫째를 차지했다. 4.5에서 이 차이를 본다.
- 브리프 375에서 셋 모두 눈에 든 둘째가 이번 주 일정 상자다.
- 누를 곳 예측과 P1의 실제 동작
  - 브리프: 빈 동그라미 = 읽음(2 맞음, 1 확실하지 않음, 맞음으로 봄). 기사 제목 = "상세나 원문"(모델 1)·"펼치거나 연다"(모델 2), 실제 제자리 펼침(P1-20) → 어긋난 모델 1(1개라 첫눈 실패 아님).
  - 이슈 페이지: 위쪽 분야 글자를 두 모델이 "분야 목록으로 갈지도, 링크인지 확실하지 않다"고 했다. 실제는 링크가 아니다(`CategoryLine`, P1-31). 확신 없는 예측이라 애매로 보고 맞음으로 셈.
  - 일정: 이슈 링크, '결과 ›', 목록/달력, 지난 일정 모두 맞음(P1-15·16·29·34).
  - 검색 1280: 두 모델이 분류 줄의 '스포츠'에만 있는 밑줄을 링크로 읽었다. DOM에는 밑줄·링크가 없다(메인이 계산된 스타일로 확인, `A/raw/main/u.mjs`). 촬영 브라우저가 그린 표시로 보고 근거에서 뺀다.
  - 영상: 제목·썸네일 = YouTube, 시각 = 그 장면 모두 맞음(P1-33·37).

결과: 화면 묶음별 첫눈 1순위 맞음/틀림은 위 표, 누를 곳 예측은 모두 맞음(첫눈 실패 아님).

## P1 패턴 인벤토리

# P1 패턴 인벤토리

`A/raw/P1` = A/raw/P1, `site/src` = site/src. 사진은 모두 같은 기본 상태(누르기 전, 정상 데이터 4401, 라이트, 375 터치)의 요소 `clip`이다. 펼친 카드 안 부품처럼 펼쳐야 보이는 것은 그 줄에 "준비:"로 적었다. 동작은 Playwright로 375(터치)와 1280에서 실제로 눌러 본 결과다.

## 방법

- P1-01 수집: `inventory.mjs`가 37개 화면 상태 × 375·1280에서 누를 수 있는 요소, 칩처럼 보이는 요소(짧은 글 + 면·테두리, `::before` 테두리 포함), 제목의 계산된 스타일을 모았고(`inventory.json`), `analyze.py`가 font-size·weight·color·background·테두리(위·아래·왼쪽)·radius·padding·밑줄·그림자로 묶었다(375 서명 77종 `sig375.txt`, 1280 78종 `sig1280.txt`). 누르기는 `behave.mjs`(사례 110개 중 요소가 있던 100개, `behave.json`·`behave-part.json`, 사진 `clips/`), 상태 유지는 `retain.mjs`(`retain-1.txt`, `retain-2.txt`, `retain-3.txt`), 행 안 스타일·빈 상태는 `inner.mjs`(`inner.json`), 추가 부품은 `extra.mjs`(`extra.json`), 읽음은 `readmark.mjs`(`readmark.txt`), 날짜 표기는 `dates.txt`. 근거: A/raw/P1/inventory.mjs, A/raw/P1/analyze.py, A/raw/P1/behave.mjs, A/raw/P1/retain.mjs
- P1-02 폭 차이: 같은 요소의 서명이 375와 1280에서 다른 것은 하단 섹션 탭 버튼 padding(`12px 3px`→`12px`)과 바닥글 링크 padding(`0 12px`→`4px 0`) 두 가지다. 눌러 본 사례 100개 모두 두 폭에서 결과가 같고 스크롤 양만 다르다(앱 밖 링크는 두 폭 모두 누르지 않음). 하단 탭은 두 폭 모두 `position: sticky; bottom: 0`이다. 근거: A/raw/P1/sig375.txt, A/raw/P1/sig1280.txt, A/raw/P1/behave.json, site/src/styles.css:872
- P1-03 테스트 데이터에 없어 보지 못한 부품: 새 제품·뜨는 저장소 이름(`a.bname-l`, 날짜 6개 빌더 탭에 0건), 이슈 페이지 '일정 전체 ›'(`.ev-more`, 일정 5개 초과일 때만), 일정 화면 '더 보기'(4403 첫 화면에 없음), 인물 목록 '더 보기'(4403 첫 화면에 없음), 일정 이름이 링크가 아닌 줄(`span.t`). 빈 서버(4402)의 이슈 목록은 정상 서버와 같은 64개 요소로 빈 상태가 아니다. 근거: A/raw/P1/scan.mjs, A/raw/P1/behave.json, A/raw/P1/inventory.json

## 1. 목적별 부품: 모양 종류와 동작 종류

### 화면 이동(주 내비게이션)

- P1-04 머리글 왼쪽: 모양 2종. 상표 `a.brand` 'Tidwyn'(19px 800 글자색, TopBar 기본값, 브리프·없는 페이지)과 되돌아가기 `a.datebtn.back` '‹ 이름'(14px 400 흐린색, padding 6px 0, 공통 `BackLink`, 나머지 13개 화면). 동작 모두 이동. 근거: site/src/components/common.tsx:93, site/src/components/common.tsx:163, A/raw/P1/clips/back-issues.png, A/raw/P1/inventory.json
- P1-05 머리글 가운데(브리프만): 날짜 이동 `DateNav`(BriefPage 안에서 만든 것). '‹'·'›' `a.arrow` 18px 400 흐린색, 날짜 글자 `a.date-link` 13px 400 흐린색. '‹'는 이전 날짜로, 날짜 글자는 `/dates`로 이동(aria-label "…, 날짜 목록 보기"). 끝 날짜 쪽 화살표는 `span.arrow.off`(누를 수 없음). 근거: site/src/pages/BriefPage.tsx:457, A/raw/P1/clips/icon-date-prev.png, A/raw/P1/clips/icon-date-link.png, A/raw/P1/behave.json(icon-date-prev, icon-date-link)
- P1-06 머리글 오른쪽: 아이콘 버튼 1종(`.icon-btn`, 16px 흐린색, radius 8px, 44×44, 공통 TopBar). 검색은 `a`(→`/search` 이동), 메뉴는 `button`(제자리에서 메뉴 열림, aria-expanded). 근거: site/src/components/common.tsx:138, A/raw/P1/clips/icon-search.png, A/raw/P1/clips/icon-menu.png, A/raw/P1/behave.json(icon-search, icon-menu)
- P1-07 메뉴: `#site-menu a` 1종(15px 400 글자색, padding 12px 18px, 10항목, `lib/menu.ts` MENU). 누르면 이동하고 메뉴가 닫힌다. 근거: site/src/lib/menu.ts:10, A/raw/P1/clips/link-menu.png, A/raw/P1/behave.json(link-menu)
- P1-08 바닥글: `footer a` 1종(12px 400 흐린색 밑줄, 9항목, `policyView.ts` FooterView). 메뉴와 순서·항목이 다르다: 메뉴는 '최근 브리프, 날짜 목록, 이슈 목록, 일정, 지표, 인물·기관·국가, 용어 사전, 검색, 사이트 소개, 오류 정정과 연락', 바닥글은 '사이트 소개, 오류 정정과 연락, 이슈 목록, 일정, 지표, 인물·기관·국가, 용어 사전, 날짜 목록, 개인정보 처리방침'(최근 브리프·검색 없음, 개인정보 처리방침은 바닥글에만). 근거: site/src/components/policyView.ts, A/raw/P1/inventory.json(brief-menu@375), A/raw/P1/clips/link-footer.png
- P1-09 정적 HTML(자바스크립트 없음)의 머리글은 메뉴 앞 5개(최근 브리프~지표)를 한 줄로 두고, 브리프는 하단 탭 대신 본문 위 구역 이동 링크(한국, 세계, IT·AI, 빌더, 수요)를 둔다(기준의 '정적 페이지' 변형). 근거: A/raw/P1/inner.json(static), docs/design.md:257

### 목록 거르기·보기 바꾸기(칩·탭)

- P1-10 이 목적의 모양 7종, 동작 2종(제자리에서 목록 바꿈 / 주소를 바꾸며 목록 바꿈). 근거: 아래 P1-11~P1-17
- P1-11 (모양 A) 거르기 칩 `.chips button`: 12px 400 흐린색, 테두리 1px 선색, radius 999px, padding 4px 10px, 선택(`.on`, aria-pressed) = 글자색 면·바탕색 글자. 공통 `ChipFilter`·`ToggleChip`을 쓰는 곳: 브리프 대분류(+구분선 뒤 '안 읽은 것만'), 브리프 영상 묶음('한국 3'처럼 건수), 이슈 목록 대분류·상태(칩 줄 2개), 일정 대분류. 모두 제자리에서 목록이 바뀌고 저장하지 않는다. 근거: site/src/components/common.tsx:281, A/raw/P1/clips/chip-filter-major.png, A/raw/P1/clips/chip-filter-unread.png, A/raw/P1/clips/chip-filter-video.png, A/raw/P1/clips/chip-filter-issues.png, A/raw/P1/clips/chip-filter-schedules.png, A/raw/P1/behave.json
- P1-12 (모양 A 자리별 변형) 인물·기관·국가 목록의 종류 칩은 같은 `.chips` 모양이지만 그 화면에서 만든 것이고(`EntitiesPage.tsx:19`), 누르면 주소가 `/entities?kind=person`으로 바뀐다. 다른 칩 줄은 주소를 바꾸지 않는다. 근거: site/src/pages/EntitiesPage.tsx:19, A/raw/P1/clips/chip-filter-entities.png, A/raw/P1/behave.json(chip-filter-entities)
- P1-13 (모양 B) 하단 섹션 탭 `nav.tabs button`: 15px 400 흐린색, 선택 = 700 글자색 + `::after` 밑줄, 브리프에만, BriefPage 안에서 만든 것. 누르면 제자리에서 섹션이 바뀌고 맨 위로 가며 `tidwyn.briefTab`에 저장. 항목 '전체, 한국, 세계, IT·AI, 영상 N, 빌더 N, 수요 N'. 근거: site/src/pages/BriefPage.tsx:438, A/raw/P1/clips/tab-bottom.png, A/raw/P1/behave.json(tab-bottom)
- P1-14 (모양 C) 상자 탭 `.box-tabs [role=tab]`: 12.5px 700 흐린색, 선택 = 글자색 + 아래 테두리 2px 글자색, `role=tab`·화살표 키 이동(`briefBox.ts`). 누르면 제자리에서 상자 안이 바뀌고 `tidwyn.briefBoxTab`에 저장. 오른쪽 접기 '▴'와 한 줄. 근거: site/src/components/briefBox.ts:111, A/raw/P1/clips/tab-box.png, A/raw/P1/behave.json(tab-box)
- P1-15 (모양 D) 일정 보기 `.view button` '목록 | 달력': 12.5px 400, 선택 = 글자색 면 + 흰 글자, 테두리 있는 radius 8px 묶음 안. 제자리에서 바뀌고 `tidwyn.scheduleView`에 저장. 근거: site/src/pages/SchedulesPage.tsx:95, A/raw/P1/clips/tab-view.png, A/raw/P1/behave.json(tab-view)
- P1-16 (모양 E) 구분 `.seg button`: 13px 400 흐린색, 선택 = 700 글자색 + 상자 바탕, 테두리 있는 radius 8px 묶음 안. 쓰는 곳 2: 일정 '다가오는 일정 | 지난 일정'(SchedulesPage.tsx:208), 지표 기간 '1개월 | 1년 | 5년'(IndicatorPage, `.seg.ind-seg`). 둘 다 그 화면에서 만든 것이고 저장하지 않는다. D와 E는 같은 화면(일정)에 함께 있고 선택 표시가 다르다(D 어두운 면, E 옅은 면 + 굵게). 근거: site/src/pages/SchedulesPage.tsx:208, site/src/pages/IndicatorPage.tsx, A/raw/P1/clips/tab-seg-sched.png, A/raw/P1/clips/tab-seg-ind.png, A/raw/P1/clips/tab-view.png
- P1-17 (모양 F·G) 달력: 날짜 `button.d`(13px, radius 8px, 고름 `.sel` = 어두운 면 흰 글자, 오늘 `.tod` = 강조색 700)와 달 이동 '‹ ›'(20px 400 흐린색, radius 8px). 둘 다 제자리에서 아래 목록을 바꾼다. 근거: site/src/pages/SchedulesPage.tsx:304, A/raw/P1/clips/tab-cal-day.png, A/raw/P1/clips/icon-cal-prev.png, A/raw/P1/behave.json(tab-cal-day, icon-cal-prev)

### 더 보기

- P1-18 모양 3종, 동작 2종. (1) `button.retry` 14px 400 글자색, 상자 바탕, 테두리 1px, radius 8px, padding 8px 16px, 글 '더 보기'(이슈 목록, 검색, 인물 페이지 뉴스) 또는 '이슈 더 보기'(인물 페이지 이슈 칩). 제자리에서 줄이 늘어난다(이슈 100→199줄). 각 화면에서 만든 것이다(IssuesPage:66, EntitiesPage:87, EntityPage:114, SearchPage:261, SchedulesPage:244). (2) 상자 아래 끝 표시 링크 '일정 전체 ›'·'지표 전체 ›'(12px 400 강조색, 밑줄 없음, padding 6px 0, `WeekAllLink`·briefBox.ts) → 다른 화면으로 이동. (3) 이슈 페이지 '일정 전체 ›'는 `.text-link`(14px 강조색 밑줄, 코드 `IssueSchedules`; 테스트 데이터에 없음). 근거: A/raw/P1/clips/more-issues.png, A/raw/P1/clips/more-search.png, A/raw/P1/clips/more-entity-issues.png, A/raw/P1/clips/more-week-all.png, A/raw/P1/clips/more-ind-all.png, site/src/components/scheduleView.ts:107, A/raw/P1/behave.json
- P1-19 같은 '더 보기' 버튼 모양(`button.retry`)을 다른 일에도 쓴다: 검색 '찾기'(제출, 주소 `?q=`로 이동), 소개 '읽은 기록 지우기'(브라우저 확인 창 "읽은 기록을 모두 지운다. 지운 기록은 되돌릴 수 없다." 뒤 지움, 수락 전에는 변화 없음), 오류 '다시 시도'(ErrorState). 즉 한 모양 4가지 동작(더 받기, 검색 제출, 기록 지우기, 다시 받기). 근거: A/raw/P1/clips/btn-search-submit.png, A/raw/P1/clips/btn-about-clear.png, A/raw/P1/clear.txt, site/src/components/common.tsx:223, A/raw/P1/behave.json(btn-search-submit, btn-about-clear)

### 제자리 펼치기

- P1-20 모양 6종, 동작 1종(제자리 펼침)에 끝 표시가 있는 것 2종(▾▴), 없는 것 4종. (1) 뉴스 줄 전체 `button.item-btn`(표시 없음, aria-expanded, 주소에 `#<키>`를 쓰고 읽음이 된다). (2) 상자 접기 '▴' `.box-fold`(15px 700 흐린색)과 접힌 줄 '이번 주 일정 2 · 원/달러 환율 … ▾' `.week-toggle`(12.5px 700 글자색), `tidwyn.weekBox`에 저장. (3) 영상 '요약 보기 ▾'/'요약 접기 ▴' `.vsumbtn`(13px 600 강조색). (4) 본문 밑줄 용어 `button.term`(아래 테두리 1.5px 점선 강조색) → 설명 상자. (5) 용어 칩 `.rel button`(P1-27의 알약 모양) → 같은 설명 상자. (6) 메뉴 아이콘 → 메뉴. 근거: A/raw/P1/clips/row-brief-top.png, A/raw/P1/clips/icon-box-fold.png, A/raw/P1/clips/icon-box-unfold.png, A/raw/P1/clips/icon-vsum.png, A/raw/P1/clips/icon-term-inline.png, A/raw/P1/clips/chip-rel-term.png, A/raw/P1/behave.json
- P1-21 기준이 정한 변형: 영상 줄의 '요약 보기 ▾'(제자리)와 '구간별로 보기 ›'(이동)는 색·굵기(13px 600 강조색)가 같고 끝 표시로 동작을 가른다(`docs/design.md` 구간 목록). 뉴스 줄에 펼침 표시를 두지 않는 것도 기준의 결정이다(정정 표시 절, "모든 줄이 펼쳐지므로"). 근거: docs/design.md:194, docs/design.md:172, A/raw/P1/clips/icon-vsum.png, A/raw/P1/clips/link-vseclink.png

### 뒤로 가기

- P1-22 '‹ 이름' 되돌아가기는 공통 `BackLink` 한 모양이고, 글과 도착이 화면마다 다르다: '‹ 브리프'(날짜 목록·이슈 목록·인물 목록·용어 사전·일정·지표 목록·검색·소개·처리방침 → `/` 가장 최근 날짜; 영상 페이지 → `/<그 날짜>#videos`), '‹ 이슈'(이슈 페이지 → `/issues`), '‹ 인물·기관·국가'(인물 페이지 → `/entities`), '‹ 지표'(지표 페이지 → `/indicators`). 같은 '‹ 브리프'가 영상 페이지에서는 보던 날짜로, 다른 화면에서는 최근 날짜로 간다. 브리프·없는 페이지에는 되돌아가기가 없다(상표). 근거: A/raw/P1/behave.json(back-*), A/raw/P1/clips/back-issues.png, A/raw/P1/clips/back-issue.png, A/raw/P1/clips/back-entity.png, A/raw/P1/clips/back-indicator.png, A/raw/P1/clips/back-video.png, A/raw/P1/clips/back-schedules.png
- P1-23 '‹' 글자는 세 동작에 쓰인다: 되돌아가기(14px, 이동), 브리프 이전 날짜(18px, 이동), 달력 이전 달(20px radius 8px, 제자리). '›'(공통 `MoreMark`, 주석 "다른 페이지로 간다는 끝 표시")는 이동 링크 끝에 붙고, 일정 결과 '연기 → 12월 17일 ›'(`a.res`)는 같은 일정 화면 안의 `/schedules/43`(목록에서 그 일정 강조)로 간다. 근거: site/src/components/moreMark.ts, A/raw/P1/behave.json(tag-res-link, icon-cal-prev, icon-date-prev), A/raw/P1/clips/tag-res-link.png

### 읽음 표시

- P1-24 모양 4종. (1) 브리프의 읽음 버튼 `ReadToggle` `.rd-btn`(누름 44px, 보이는 동그라미 `i` 테두리 1px 회색 → 누르면 파랑 `rgb(59,127,208)` 면 흰 ✓, aria-pressed 토글, 다시 누르면 취소). 뉴스·짧은 소식·빌더·수요 줄 오른쪽. (2) 제목 굵기 `NewsTitle`(안 읽음 700 → 읽음 400, 같은 색). (3) 브리프 밖 목록 끝 '✓'(`ReadCheck` `.read-mk`, 12px 파랑, 화면 읽기 '읽음') — 검색 결과·이슈 전개·인물 뉴스·펼친 카드 이전 전개. (4) 날짜 목록 줄 끝 '2/30 읽음'(`.read-prog`, DatesPage 안에서 만든 것). 근거: A/raw/P1/readmark.txt, A/raw/P1/clips/read-before.png, A/raw/P1/clips/read-after.png, A/raw/P1/clips/read-search.png, A/raw/P1/clips/read-dates.png, site/src/components/common.tsx:300, site/src/pages/DatesPage.tsx:54
- P1-25 읽음이 되는 동작: 읽음 버튼, 뉴스 줄 펼침, 짧은 소식 글 누름(`button.short-text`, 다른 변화 없이 굵기만 바뀜), `#<키>` 주소로 들어오기(다른 화면의 뉴스 줄·일정 이름·결과 문구를 눌러 온 경우 포함). 근거: A/raw/P1/behave.json(row-brief-short, row-issue-tl, row-sched-name, tag-res-ok), A/raw/P1/readmark.txt

### 빈 상태·오류·없는 페이지

- P1-26 빈 상태 모양 3종: (1) 공통 `Empty` `.state.empty`(가운데, 14px 흐린색, padding 32px 18px) — '아직 저장된 브리프가 없다.', '아직 모은 일정이 없다.', '"xyzqq"에 맞는 결과가 없다.' 등. (2) 빌더 묶음 안 `zeroState`(같은 `.state.empty`이나 왼쪽 정렬, padding 10px 18px 14px, 기준의 변형) — '이날은 실을 만한 도구 변화가 없다.'. (3) 달력의 날 `p.p.muted.day-empty`(왼쪽, padding 6px 0) — '이 날에는 일정이 없다.'. 오류 모양 2종: 공통 `ErrorState` `.state.error`(가운데 + '다시 시도' 버튼)와 버튼 없는 `zeroState` 오류(수요 탭 '이날의 수요 흐름을 정리하지 못했다.', 가운데). 없는 페이지 제목 2종: '이 주소에는 페이지가 없다'(NotFoundPage, 없는 이슈 포함), '이 주소에는 영상이 없다'(VideoPage). 근거: A/raw/P1/inner.json(states), site/src/components/common.tsx:235, site/src/components/builderView.ts, docs/design.md:244

## 2. 한 모양 여러 동작(글이 동작을 말해 주지 않는 부품)

- P1-27 알약 칩 `.rel a / .rel button`(13px 400 글자색, 테두리 1px 선색, radius 999px, padding 5px 10px; 빌더·수요 `.brel a`는 같은 값을 `::before` 테두리로 그리고 누름 높이 44px) 한 모양에 동작 3가지. 이동: 펼친 카드 인물·기관·국가(→`/entities/1`, termView.ts `EntityChips`), 일정(→`/schedules/12`, scheduleView.ts `ScheduleChips` `.evc`, 준비: `/2026-11-06#IT·AI-2`), 함께 엮인 이슈(→`/issues/4`, BriefPage.tsx:664 그 자리에서 만든 것), 이슈 페이지 등장 인물(→`/entities/1`, `IssueEntityChips`), 인물 페이지 이슈(→`/issues/28`, EntityPage 그 자리), 빌더·수요 관련 이슈(→`/issues/1`, builderView.ts `IssueField`). 제자리 펼침: 펼친 카드 용어 칩(설명 상자 열림, termView.ts `TermChips`, 선택 = 글자색 면). 같은 화면 스크롤: 용어 사전 색인 'ㄱ'(`#g-0`, 스크롤 0→210, GlossaryPage 그 자리). 근거: A/raw/P1/clips/chip-rel-entity.png, A/raw/P1/clips/x-chip-rel-schedule.png, A/raw/P1/clips/chip-rel-extra.png, A/raw/P1/clips/chip-rel-issue-entity.png, A/raw/P1/clips/chip-rel-entity-page.png, A/raw/P1/clips/chip-brel.png, A/raw/P1/clips/chip-rel-term.png, A/raw/P1/clips/chip-rel-terms-page.png, A/raw/P1/extra.json, A/raw/P1/behave.json
- P1-28 거르기 칩(P1-11, 12px 흐린색 테두리 알약)과 P1-27 알약은 글자 크기 1px(거의 같음)·글자색(흐린색 vs 글자색)·padding 1px이 다르다. 브리프 위 키워드 `.kw span`(12px 글자색, 상자 바탕, radius 999px, padding 3px 8px, 테두리 없음)은 알약 모양이고 누르면 아무 일도 없다(커서 auto). 근거: A/raw/P1/clips/chip-kw.png, A/raw/P1/clips/chip-filter-major.png, A/raw/P1/behave.json(chip-kw), site/src/pages/BriefPage.tsx:369
- P1-29 작은 사각 표시(radius 4px, 강조색 글자 + 옅은 강조 바탕) 한 모양 "거의 같음"에 동작 3가지: '어제에 이어' `.badge`(11px 600, padding 2px 7px; 뉴스 줄 버튼 안이라 누르면 그 줄이 펼쳐짐, 펼친 카드·짧은 소식 안에서는 누를 수 없음), 일정 결과 '결과: …' `a.res.ok`(12px 600, padding 2px 7px; → 근거 뉴스 `/2026-11-02#세계-s3`로 이동), 영상 묶음 표시 `.tag`(10.5px 700, padding 1px 6px; 눌러도 아무 일 없음). `.tag`는 굵기만 700으로 다르다. 회색 바탕 `.res`(12px 400 글자색, 상자 바탕) '취소'는 누를 수 없고 '연기 → 12월 17일 ›'는 같은 모양에 '›'가 붙은 링크다. 근거: A/raw/P1/clips/tag-badge.png, A/raw/P1/clips/tag-res-ok.png, A/raw/P1/clips/tag-video.png, A/raw/P1/clips/tag-res-span.png, A/raw/P1/clips/tag-res-link.png, site/src/components/scheduleView.ts:14, A/raw/P1/behave.json
- P1-30 섹션 칩 `.sec`('전체' 탭의 '한국'·'세계'·'IT·AI', 10.5px 600 흐린색, 테두리 1px, radius 4px)은 뉴스 줄 버튼 안이라 누르면 그 줄이 펼쳐지고(커서 pointer), 짧은 소식 메타 줄 안에서는 누를 수 없다. 글은 하단 섹션 탭 이름과 같다. 근거: A/raw/P1/clips/chip-sec.png, A/raw/P1/behave.json(chip-sec), site/src/components/common.tsx:253
- P1-31 목록 행(대분류 줄 11.5px 600 + 제목 `.title` 17px 700, 구분선, 카드 없음) 한 모양에 동작 3가지: 브리프 뉴스(`button.item-btn`, 제자리 펼침), 이슈 목록·검색 이슈 결과·검색 뉴스 결과(`a.item-btn`, 이동; 검색 뉴스는 브리프로 가서 그 카드가 펼쳐짐), 빌더·수요 항목(`div.item-btn`, 대분류 줄이 흐린색 `.muted-cat`, 칸이 늘 펼쳐져 있어 제목을 눌러도 아무 일 없음). 대분류 줄 색은 브리프·이슈 = 대분류 색, 빌더·수요·인물 목록·검색 뉴스 = 흐린색. 인물 목록은 제목이 `.title.small`(15px 600). 오른쪽 읽음 버튼은 브리프·빌더·수요에만 있다. 근거: A/raw/P1/inner.json, A/raw/P1/clips/row-brief-top.png, A/raw/P1/clips/row-issues.png, A/raw/P1/clips/row-search-issue.png, A/raw/P1/clips/row-search-news.png, A/raw/P1/clips/row-builder.png, A/raw/P1/clips/row-demand.png, A/raw/P1/clips/row-entities.png, A/raw/P1/behave.json
- P1-32 날짜 + 제목 줄(`a.nrow`, MM-DD 앞 + 제목 14.5px 600)은 이슈 전개·인물 뉴스·펼친 카드 이전 전개(13px 흐린색)에서 모두 브리프의 그 뉴스로 이동(펼친 카드 안에서는 다른 날짜로 바뀌며 그 카드가 펼쳐짐). 이번 주 일정 줄 `a.wrow`와 이슈 페이지 일정 줄 `a.ev-link`는 일정 화면으로 이동. 지표 페이지 관련 줄 `a.ev-link`는 같은 클래스로 이슈 페이지(`/issues/6`)로 이동. 근거: A/raw/P1/clips/row-issue-tl.png, A/raw/P1/clips/row-entity-news.png, A/raw/P1/clips/row-card-prev.png, A/raw/P1/clips/row-week.png, A/raw/P1/clips/x-row-issue-sched.png, A/raw/P1/clips/row-indicator-sched.png, A/raw/P1/behave.json
- P1-33 제목 글자: 영상 페이지 구간 제목 `h3.vsectitle`(14px 700)은 링크가 아니지만, 시각 링크 `a.vsectime`의 `::after`(position absolute, inset 0)가 줄을 덮어 누르면 새 탭(YouTube 그 시각)이 열린다(기준의 구간 목록 규칙). 영상 페이지 `h1` 제목은 YouTube로 가는 밑줄 링크(22px 800)이고, 이슈·인물·용어·일정 날짜 머리·빌더 묶음 제목(`h2.bgroup-h` 22px 800, h1과 같은 크기)·빌더 항목 제목·브리프 위 요약은 눌러도 아무 일 없다. 근거: A/raw/P1/behave.json(title-*), A/raw/P1/hit.mjs, A/raw/P1/clips/title-vsec.png, A/raw/P1/clips/title-video-h1.png, A/raw/P1/clips/title-bgroup.png, A/raw/P1/clips/title-issue-h1.png
- P1-34 아이콘 버튼 한 모양(P1-06)에 이동(검색)과 제자리 열기(메뉴). 일정 이름 `a.t`(15px 600 글자색, 밑줄 없음)는 일정 화면에 있지만 일정 상세가 아니라 처음 근거 뉴스(`/2026-11-04#한국-s1`, 브리프에서 펼침)로 간다. 근거: A/raw/P1/clips/icon-search.png, A/raw/P1/clips/icon-menu.png, A/raw/P1/clips/row-sched-name.png, site/src/components/scheduleView.ts:27, A/raw/P1/behave.json(row-sched-name)
- P1-35 닫힌 뉴스 줄의 '이어지는 이야기: <이슈>'(`.cont`, 12px 흐린색 글자)는 줄 버튼 안이라 누르면 그 줄이 펼쳐지고, 펼친 카드의 '이어지는 이야기 · <이슈> ›'(`.story b a`, 12px 700 강조색)는 이슈 페이지로 간다. 짧은 소식의 이슈 이름(`.short-meta a`, 12px 흐린색 밑줄)도 이슈 페이지로 간다. 같은 대상이 자리마다 글자·동작이 다르다. 근거: A/raw/P1/clips/link-cont-issue.png, A/raw/P1/clips/link-story-issue.png, A/raw/P1/clips/link-short-issue.png, A/raw/P1/extra.json, A/raw/P1/behave.json

## 3. 글 링크·출처·제보 모양(본문·목록 항목 안)

- P1-36 이동 글 링크 모양 6종: `.text-link` 14px 강조색 밑줄(소개·처리방침·빌더 기한), `.text-link` 11.5px(영상·지표 출처 줄의 약관 링크), `.quiet` 15px 흐린색 밑줄(없는 페이지), 12px 흐린색 밑줄(짧은 소식 이슈, 빌더 다시 알림 `.breminder` 누름 44px, 이슈 영상 'M월 D일 추천' `.vrec` 11.5px, 용어 사전 '처음 나온 뉴스' `.gl a`), 13.5px 흐린색 밑줄(`.bintro-l` '빌더 탭 소개'·'수요 탭 소개와 분야별 소스'), 강조색 밑줄 없는 끝 표시 링크(12px '일정 전체 ›'·'지표 전체 ›'·'용어 사전에서 보기 ›', 12px 700 '이어지는 이야기 · … ›', 13px 600 '구간별로 보기 ›'). 주 버튼 `.btn`(강조 면, 없는 페이지 하나). 근거: A/raw/P1/sig375.txt, A/raw/P1/extra.json, A/raw/P1/clips/link-text-privacy.png, A/raw/P1/clips/link-notfound-quiet.png, A/raw/P1/clips/link-notfound-btn.png, A/raw/P1/clips/x-link-reminder.png, A/raw/P1/clips/x-link-vrec.png, A/raw/P1/clips/link-bintro.png, A/raw/P1/clips/link-tbox.png
- P1-37 앱 밖 링크(누르지 않음, href 도메인만): 출처 칩 `.src a`(12px, `::before` 테두리 radius 6px, '↗', news.example.com 등, 새 탭), 영상 줄 `a.vlink`·영상 제목·구간 시각(www.youtube.com, 새 탭), 약관 링크(새 탭), 제보 `a.report`(14px 흐린색, mailto), 소개 메일 상자 `a.mailbar`(상자 전체 링크, mailto). 출처 칩만 '↗' 표시가 보이고 영상 줄·제목·약관 링크는 보이는 표시 없이 화면 읽기에만 '(새 탭)'이다. 근거: A/raw/P1/behave.json(ext-*, row-video, row-vsectime, title-video-h1), A/raw/P1/clips/ext-src.png, A/raw/P1/clips/row-video.png, A/raw/P1/clips/ext-report.png, A/raw/P1/clips/ext-mailbar.png

## 4. 문구

- P1-38 같은 도착 `/`의 이름 5가지: 메뉴 '최근 브리프', 되돌아가기 '‹ 브리프', 상표 'Tidwyn', 없는 페이지 버튼 '최근 뉴스 브리프 보기', 문서 제목 'Tidwyn · 최신 뉴스 브리프'. 근거: A/raw/P1/inventory.json, A/raw/P1/behave.json(back-issues, link-notfound-btn)
- P1-39 같은 도착의 다른 이름: `/issues`는 메뉴·바닥글·없는 페이지 '이슈 목록', 이슈 페이지 되돌아가기 '‹ 이슈'. `/schedules`는 메뉴 '일정', 상자 '일정 전체 ›'(`?view=list`), 상자 탭 '이번 주 일정 N'. `/indicators`는 메뉴 '지표', 상자 '지표 전체 ›', 되돌아가기 '‹ 지표'. `/about#corrections`는 '오류 정정과 연락'. 근거: A/raw/P1/inventory.json(brief-menu@375), A/raw/P1/behave.json
- P1-40 같은 이름이 다른 일을 가리키는 곳: '전체'는 하단 섹션 탭(모든 섹션)과 같은 화면 대분류 칩(모든 대분류), 영상 묶음 칩(모든 묶음)에 함께 쓰이고, 이슈 목록에는 칩 줄 두 개(대분류·상태)에 '전체'가 둘 있다. '이번 주 일정'(상자 탭, 그 주 최대 5개)과 '일정'(화면). 섹션 칩 '한국'(줄 안 표시, 누르면 줄 펼침)과 하단 탭 '한국'(섹션 고르기), 영상 묶음 칩 '한국 3'(영상 묶음 거르기)과 영상 줄 표시 '한국'(묶음 표시). '요약'은 브리프 위 문단(`.headline`), 영상 '요약 보기', 영상 페이지 '요약' 절. 근거: A/raw/P1/inventory.json, A/raw/P1/behave.json(tab-bottom, chip-filter-major, chip-sec, tag-video)
- P1-41 링크 글이 도착과 다른 대상을 가리키는 곳: 일정 화면의 일정 이름(→ 근거 뉴스), 일정 결과 '결과: …'(→ 근거 뉴스), 이슈 영상 '11월 6일 추천'(→ 그 날짜 브리프 영상 탭), 머리 날짜 '11월 6일 (금)'(→ 날짜 목록), '‹ 브리프'(→ 보던 날짜가 아닌 최근 날짜, 영상 페이지만 그 날짜), 이슈 페이지 '‹ 이슈'(→ '이슈 목록'). 근거: A/raw/P1/behave.json(row-sched-name, tag-res-ok, x-link-vrec, icon-date-link, back-*)
- P1-42 같은 뜻의 다른 표기: 빈 상태 '이날은 실을 만한 도구 변화가 없다.'·'이날의 수요 흐름을 정리하지 못했다.'(붙여 씀)와 '이 날에는 일정이 없다.'(띄어 씀). 근거: A/raw/P1/inner.json(states)
- P1-43 제목 표기: 문서 제목이 브리프는 'Tidwyn · 최신 뉴스 브리프'(최근)·'Tidwyn · 11월 6일 브리프'(날짜 주소, 카드를 펼쳐 주소가 바뀌면 이것으로 바뀜)로 이름이 앞이고, 나머지는 '<화면> · Tidwyn'. 검색은 '"가짜" 검색 · Tidwyn'이고 h1은 '검색'. 영상 페이지 h1은 '<영상 제목> (새 탭)'(화면 읽기 글 포함). 보이는 h1이 없는 화면은 브리프(sr-only '11월 6일 (금) 브리프'). h1 22px 800은 클래스가 4가지(`page-title pad`, `page-title`, `name`, 없음)다. 근거: A/raw/P1/inventory.json, A/raw/P1/behave.json(row-brief-top)
- P1-44 구역 제목 모양 6종: `.h` 12.5px 700 흐린색(펼친 카드 h4, 이슈·인물·지표 h2, 일정 '달 중' h3, 짧은 소식·검색 묶음 `list-h`), 같은 `.h`가 소개·처리방침에서는 14px 700 글자색, 영상 페이지에서는 15px 700 글자색, 일정 날짜 머리 `h3.dh` 13px 700, 용어 사전 색인 `h2.idx` 12px 700 강조색, 빌더 묶음 `h2.bgroup-h` 22px 800. 근거: A/raw/P1/inventory.json, A/raw/P1/sig375.txt

## 5. 날짜·숫자 표기

- P1-45 날짜 형식 11가지(정상 데이터 375 본문 글): 'M월 D일 (요일)'(머리 날짜, 날짜 목록, 일정 날짜 머리, 검색 뉴스 줄), 'M월 D일'(정정됨, 상자 '11월 6일 값', 다시 알림, 'M월 D일 추천', 일정 연기), 'YYYY년 M월 D일'(빌더 기한, 다음 해 연기, 지표 기간, 처리방침), 'YYYY년 M월'(날짜 목록 달, 달력, 잠정 기한), 'M월 중 (날짜 미정)'(일정), 'YYYY-MM-DD'(이슈 목록 '최근 2026-11-06', 이슈 페이지 '2026-10-20 시작'), 'MM-DD'(이슈 페이지 '최근 11-06', 전개 줄, 인물 '처음 10-20', 용어 '처음 나온 뉴스: 10-20', 출처 칩, 상자 지표 날짜, 일정 칩 '12-02'), 'MM-DD 요일'(이번 주 일정 '11-09 월'), 'MM-DD (요일)'(이슈 페이지 일정 '10-26 (월)'), 'YYYY.MM.DD'(지표 그래프 축), 상대 표현('어제에 이어'). 근거: A/raw/P1/dates.txt, A/raw/P1/extra.json
- P1-46 같은 데이터의 다른 표기: 이슈의 최근 날짜가 이슈 목록 'YYYY-MM-DD', 이슈 페이지 'MM-DD'이고, 이슈 페이지 한 줄 '2026-10-20 시작 · 최근 11-06'에 두 형식이 함께 있다. 같은 주의 일정 날짜가 상자 '11-09 월', 일정 화면 '11월 9일 (월)', 이슈 페이지 '10-26 (월)', 카드 칩 '12-02'. 근거: A/raw/P1/dates.txt, A/raw/P1/extra.json
- P1-47 지표 변화: 상자 지표 칸(compact)은 코스피 '▼0.87%'(퍼센트), 지표 목록 카드와 지표 페이지는 '▼23.37'(절대값). 변화 없음은 '변동 없음'. '올라/내려'는 화면 읽기 글이다. 건수 표기는 '전개 12건', '뉴스 540건', '28개'이고, 이슈 페이지 인물 칩은 '가짜 중앙은행 15'(숫자만 보이고 '회'는 화면 읽기)이다. 근거: A/raw/P1/inventory.json(brief-box-ind, indicators, indicator), site/src/lib/indicators.ts:57, site/src/components/termView.ts:84

## 6. 화면 사이 이동 뒤 상태 유지

(양쪽 폭 같음, 다른 점만 적는다. '탭'은 하단 섹션 탭, '칩'은 거르기 칩.)

- P1-48 G1 브리프 → 펼친 카드 '함께 엮인 이슈'/'이어지는 이야기' → 이슈 페이지 → 브라우저 뒤로: 보던 날짜·탭(세계)·펼친 카드는 남고, 대분류 칩은 '전체'로 풀리고 스크롤이 바뀐다(300→501). '‹ 이슈'→'‹ 브리프'나 메뉴 '최근 브리프'로 오면 날짜가 최근(11월 6일)으로, 펼침·칩·스크롤이 풀린다. 근거: A/raw/P1/retain-1.txt(brief-to-issue), A/raw/P1/retain.mjs
- P1-49 G1 '안 읽은 것만'을 켜고 짧은 소식 이슈 링크로 갔다 브라우저 뒤로: '안 읽은 것만'이 꺼진다. 근거: A/raw/P1/retain-1.txt(brief-short-to-issue)
- P1-50 G1 → 머리 날짜 → 날짜 목록 → 브라우저 뒤로: 모두 같음(탭 '전체', 스크롤). '‹ 브리프'로 오면 최근 날짜, 맨 위. 근거: A/raw/P1/retain-1.txt(brief-to-dates)
- P1-51 G1 카드를 펼치고 상자의 이번 주 일정 줄 → 일정 화면 → 브라우저 뒤로: 펼침은 남고 스크롤이 0→406(그 카드 위치로). '‹ 브리프'는 최근 날짜, 펼침 풀림. 근거: A/raw/P1/retain-1.txt(brief-box-to-schedule)
- P1-52 G1 영상 탭에서 묶음 칩('미국 2')을 고르고 요약을 펼친 뒤 '구간별로 보기' → 영상 페이지 → 브라우저 뒤로나 '‹ 브리프': 날짜·영상 탭은 남고 칩은 '전체', 요약은 접힘('‹ 브리프'는 스크롤도 0). 근거: A/raw/P1/retain-2.txt(brief-video-to-page), docs/memory.md
- P1-53 G1 빌더 탭(`#builder`)에서 기한 링크 → 일정 → 브라우저 뒤로: 모두 같음. '‹ 브리프'로 오면 `/`의 탭이 '한국'(주소로 연 빌더 탭은 `tidwyn.briefTab`에 저장되지 않음), 스크롤 0. 수요 탭 → 관련 이슈 → 뒤로: 모두 같음. 근거: A/raw/P1/retain-2.txt(brief-builder-to-schedule, brief-demand-to-issue)
- P1-54 G2 날짜 목록 스크롤 → 날짜 → 브라우저 뒤로: 375 스크롤 400→0(1280은 같음). 근거: A/raw/P1/retain-2.txt(dates-to-brief)
- P1-55 G3 이슈 목록(4403) 대분류 칩 '정치' → 이슈 → 브라우저 뒤로: 칩 '전체'로 풀리고 줄 27→100(첫 쪽), 스크롤 1500→981(375)/937(1280). '‹ 이슈'는 칩 풀림, 스크롤 0. 근거: A/raw/P1/retain-2.txt(issues-to-issue)
- P1-56 G4 이슈 페이지 스크롤 600 → 전개 줄 → 브리프 → 브라우저 뒤로: 스크롤 108(375)/0(1280). 이슈 페이지에서 브리프로 돌아가는 '‹' 링크는 없다(이슈 목록으로 감). 근거: A/raw/P1/retain-2.txt(issue-to-brief)
- P1-57 G5 인물 목록(4403) 종류 칩 '인물'(주소 `?kind=person`) → 인물 → 브라우저 뒤로: 칩은 남고(주소) 스크롤 1500→743(375)/699(1280). '‹ 인물·기관·국가'는 `/entities`로 가서 칩 '전체', 줄 119→298, 스크롤 0. 근거: A/raw/P1/retain-2.txt(entities-to-entity)
- P1-58 G6 인물 페이지 '더 보기' 뒤 뉴스 → 브리프 → 브라우저 뒤로: 375 모두 같음, 1280 스크롤 700→0. G7 용어 사전 스크롤 1200 → 처음 나온 뉴스 → 뒤로: 스크롤 0. 근거: A/raw/P1/retain-2.txt(entity-to-brief, terms-to-entity)
- P1-59 G8 일정 달력 보기에서 다음 달·날짜 고름 → 일정 이름 → 브리프 → 브라우저 뒤로 또는 메뉴 '일정': 달력 보기는 남고(저장), 달은 '2026년 12월'→'2026년 11월', 고른 날 10→9로 처음 값이 된다. 근거: A/raw/P1/retain-2.txt(schedules-cal-to-news)
- P1-60 G10 지표 페이지 기간 '1개월' → 관련 이슈 → 브라우저 뒤로: 기간이 '1년'(처음 값)으로 돌아간다. G9 지표 목록 → 카드 → 뒤로: 375 스크롤 400→0, 1280 같음. '‹ 지표'는 스크롤 0. 근거: A/raw/P1/retain-2.txt(indicators-to-indicator, indicators-list)
- P1-61 G8 일정 목록 보기에서 '지난 일정'과 대분류 칩 '경제' → 일정 이름 → 브리프 → 브라우저 뒤로 또는 메뉴 '일정': 목록 보기는 남고, 구분은 '다가오는 일정', 칩은 '전체'로 돌아간다. 근거: A/raw/P1/retain-3.txt
- P1-62 G12 검색(4403) '더 보기' 뒤 스크롤 1500 → 이슈 결과 → 브라우저 뒤로: 검색어는 남고(주소 `?q=`) 더 보기로 늘린 결과가 첫 묶음으로 돌아가며(2089→1039줄) 스크롤 0. 근거: A/raw/P1/retain-2.txt(search-to-result)
- P1-63 G13·G14 소개 스크롤 800 → '개인정보 처리방침' → 브라우저 뒤로: 375 스크롤 1533(다른 위치), 1280 같음. 처리방침의 '‹ 브리프'는 최근 브리프로 간다(소개가 아님). G15 없는 페이지는 되돌아가기가 없다. 근거: A/raw/P1/retain-2.txt(about-to-privacy), A/raw/P1/behave.json(link-notfound-btn)
- P1-64 화면 상태가 남는 곳 정리: 브라우저 저장소 `tidwyn.briefTab`(하단 탭을 눌렀을 때만), `tidwyn.briefBoxTab`, `tidwyn.weekBox`, `tidwyn.scheduleView`, `tidwyn.read`. 주소: 펼친 카드(`#<키>`), 영상·빌더·수요 탭(`#videos` 등), 인물 종류(`?kind=`), 검색어(`?q=`), 일정 강조(`/schedules/:id`). 어디에도 남지 않아 돌아오면 처음 값이 되는 것: 거르기 칩(인물 종류 제외), '안 읽은 것만', 일정 구분, 지표 기간, 달력 달·날, 영상 요약 펼침, 더 보기로 늘린 목록. 근거: A/raw/P1/behave.json, A/raw/P1/retain-1.txt, A/raw/P1/retain-2.txt, site/src/storage.ts
완료


## P2 정보 지도

# P2 정보 지도 결과 (2026-11-06)

경로: A=A, P=A/raw/P2.
근거 약어: R-brief=P/roles-brief.txt, R-tabs=P/roles-tabs.txt, R-rest=P/roles-rest.txt (모두 요소 위치를 Playwright로 읽은 덤프, 정상 서버 4401). RK=P/rank.json (1순위 측정). NAV1=P/nav-log-1.txt, NAV2=P/nav-log-2.txt, NAV3=P/nav-log-3.txt. SH=A/shots/<화면>-<상태>-<폭>.png.json.
높이는 px, "첫화면%"는 요소가 차지하는 세로 범위 / 첫 화면 높이(375는 812, 1280은 900). 1280에서도 본문 열은 폭 640px 한 줄이다(main x=320 w=640, P/w.mjs). 정상 서버 첫 화면 기본 섹션 탭은 '한국'이다.

## 1. 공통 틀 (모든 화면)

- P2-01 머리글(header.bar, 고정 sticky): 높이 55 (375 첫화면 7%, 1280 6%). 브리프는 [Tidwyn 로고 | ‹ 날짜 › | 검색 아이콘 | 메뉴 아이콘], 그 밖의 화면은 [‹ 뒤로 링크 | 검색 | 메뉴]. 근거 R-brief, P/back.mjs.
- P2-02 뒤로 링크의 글: 이슈 목록·인물·용어·일정·지표 목록·검색·소개·개인정보·날짜 목록 = '‹ 브리프'(href /), 이슈 페이지 = '‹ 이슈'(/issues), 인물 페이지 = '‹ 인물·기관·국가'(/entities), 지표 페이지 = '‹ 지표'(/indicators), 영상 페이지 = '‹ 브리프'(href /<영상 날짜>#videos), 없는 페이지는 뒤로 링크 없이 로고만. 근거 P/back.mjs 출력.
- P2-03 브리프 헤더 날짜 칸: 이전 날짜 ‹ (44x44) · 날짜 글 '11월 3일 (화)'(날짜 목록으로 감) · 다음 날짜 › (44x44). 근거 P/sub.mjs 덤프(/2026-11-03 header).
- P2-04 메뉴(메뉴 아이콘 누르면 375에서 폭 375 높이 449 패널): 링크 10개 = 최근 브리프, 날짜 목록, 이슈 목록, 일정, 지표, 인물·기관·국가, 용어 사전, 검색, 사이트 소개, 오류 정정과 연락. 근거 P/dup.mjs 출력.
- P2-05 꼬리말(footer) 안내 링크 9개(사이트 소개, 오류 정정과 연락, 이슈 목록, 일정, 지표, 인물·기관·국가, 용어 사전, 날짜 목록, 개인정보 처리방침). 높이 375 203 / 1280 120. 메뉴 링크 10개 중 8개가 꼬리말에 다시 나온다(같은 정보가 두 곳: 메뉴 패널과 모든 화면 끝). 근거 R-brief 꼬리말 줄, P/dup.mjs.
- P2-06 꼬리말 문장 둘이 모든 화면에 반복: 'Tidwyn · AI가 매일 모아 쉬운 말로 바꿔 쓴 뉴스 요약'(1줄), '이 사이트를 이용하면 개인정보 처리방침과 YouTube 이용약관에 동의하는 것으로 본다.'(375 2줄, 1280 1줄). 근거 R-brief.
- P2-07 브리프에만 하단 고정 섹션 탭(nav.tabs, sticky): 높이 48, 탭 7개(전체 47, 한국 47, 세계 47, IT·AI 51, 영상 9 61, 빌더 4 61, 수요 3 61 폭). 375 첫화면 y=764~812(6%), 1280 y=852~900(5%). 근거 P/cells.mjs, R-brief.
- P2-08 날짜에 따라 탭 구성이 바뀐다: 11-06 = 영상 9 · 빌더 4 · 수요 3, 11-05 = 영상 4 · 빌더 1 · 수요 0, 11-03 = 영상 탭 없음 · 빌더 0 · 수요 0, 10-20 = 영상 2 뿐. 근거 P/t.mjs 출력.

## 2. G1 브리프 (/ , 한국 탭 기본) 요소 나열

375, 위에서부터 (R-brief):
- P2-10 그날 요약 문단(div.headline): 1개, 높이 127(안에 키워드 줄 25 포함), 첫화면 16%, 글 14px. 키워드 칩 줄(span 2개 '예산안' '수출', 높이 25, 3%).
- P2-11 이번 주 일정|지표 상자(section.week): 1개, 높이 153, 첫화면 19%. 안: 탭 줄 32(탭 '이번 주 일정 2' '지표' + 접기 ▴ 32x32), 일정 줄 2개(높이 46과 30), '일정 전체 ›' 줄 28.
- P2-12 대분류 칩 줄(div.chips): 1개, 높이 49, 칩 9개(전체, 정치, 경제, 사회, 국제, IT·AI, 과학·건강, 문화·스포츠, 구분선, '안 읽은 것만'), 첫화면 6%. 일부 칩은 화면 밖으로 가로 스크롤(SH brief-normal-375.png.json layout.offscreen: 과학·건강, 문화·스포츠, 구분선, 안 읽은 것만).
- P2-13 섹션 요약(p.flow): 1개, 높이 68, 첫화면 8%, 글 13.5px.
- P2-14 뉴스 줄(ul.list > li.item) ×5: 합계 높이 593, 줄 하나 119, 첫화면 43%. 첫화면(탭 막대 y=764 앞)에서 완전히 보이는 줄 2개, 셋째 줄은 y=703에서 시작해 탭 막대에 일부 가려짐. 줄 하나 = 분류 줄(14) + 제목(48, 2줄) + 이어지는 이야기 줄(18, 있는 줄만) + 오른쪽 읽음 버튼(44x44).
- P2-15 짧은 소식(section): 제목 16 + 줄 ×5(높이 123/94/96/94/96, 합계 501) + 제보 링크 줄 50. 첫화면 0%.
- P2-16 꼬리말 203, 첫화면 0%. 하단 섹션 탭 48, 첫화면 6%.
- P2-17 첫화면 높이 배분(375, 812): 머리글 55(7%) · 요약+키워드 127(16%) · 일정|지표 상자 153(19%) · 칩 줄 49(6%) · 섹션 요약 68(8%) · 뉴스 줄(탭 막대 앞까지) 298(37%) · 탭 막대 48(6%). 뉴스 제목 첫 줄은 이 중 y=499에서 시작한다. 근거 R-brief.
1280 (R-brief 하단):
- P2-18 같은 순서와 개수. 요약 문단 105(12%) · 상자 153(17%) · 칩 49(5%) · 섹션 요약 47(5%) · 뉴스 줄 ×5 합계 474, 줄 하나 95(첫화면 53%, 완전히 보이는 줄 4개) · 짧은 소식 454(첫화면 0%) · 꼬리말 120 · 탭 막대 y=852(5%). 페이지 높이 375=1903, 1280=1541(SH brief-normal-*.json layout.pageHeight).
- P2-19 펼친 뉴스 줄(첫 줄 누름, 375): 줄 높이 119 → 1320 (머리 134 + 펼침 영역 1173). 펼침 안 칸: 이어지는 이야기 상자(제목 링크+배지+전개 3줄), 요약 문단(p.sum 77), 정정 안내 둘(p.fix), 소제목 칸 6개(왜 중요한가, 배경, 핵심, 전망, 확인 정도, 출처)와 인물·기관·국가 칸, 용어 칸, 제보 링크. 제목 글이 17px/700에서 21px/400으로 바뀐다. 근거 P/sub.mjs 덤프(open).
- P2-20 펼침은 한 번에 하나만 열린다: 첫 줄을 연 뒤 둘째 줄을 열면 `.detail` 개수가 1로 유지(1280). 근거 P/acc.mjs.
- P2-21 한 정보가 두 번 나오는 곳(브리프): (1) 펼친 줄의 요약 문단 p.sum이 줄 제목 글로 시작한다(title==sum.startsWith 검사 true, 1280 P/dup2.mjs). (2) '어제에 이어' 배지와 이어지는 이슈 이름이 닫힌 줄의 이어지는 이야기 줄과 펼침 안 이어지는 이야기 상자에 모두 나온다. (3) 정정됨 표시(분류 줄 오른쪽 '정정됨 · 11월 8일')와 펼침 안 정정 안내 p.fix의 날짜가 같다. (4) 분류('정치 · 사법·검찰')가 칩 줄(대분류)과 모든 뉴스 줄에 반복된다. (5) 같은 낱말 IT·AI가 하단 섹션 탭과 대분류 칩 둘 다에 있다(뜻이 다름). (6) '일정 전체 ›' 링크와 메뉴 '일정'이 같은 /schedules로 간다(일정 상자 href /schedules?view=list). 근거 R-brief, P/hrefs.mjs.
- P2-22 제보 링크(mailto) '틀린 내용 알리기 · <공개 제보 메일>'이 짧은 소식 아래 1개 + 펼친 줄마다 1개(44px 높이). 누르지 않았다.

## 3. 브리프 영상·빌더·수요 탭

- P2-30 영상 탭(#videos, 375): 일정|지표 상자 153 + 칩 줄 49(전체, 한국 3, 미국 2, AI 4) + 영상 줄 ×9(ul.vlist 합계 1592, 줄 179/198/154/198/154/198/154/198/159) + 출처 줄 43. 첫화면: 영상 목록 51%. 1280: 줄 ×9 합계 1279(줄 147/150/133…), 첫화면 58%. 근거 R-tabs.
- P2-31 영상 줄 하나의 칸: 썸네일(375 128x72, 1280 200x112, 길이 표시 포함) · 제목(14px/600, 375 76px 높이 4줄 안팎) · 태그+분 줄(19) · '추천 이유' 문단(13px, 375 53) · 9줄 중 2줄(11-06)에만 '구간별로 보기' 링크(84x44). 줄 전체 링크(a.vlink)는 YouTube(새 탭)로 간다. 근거 P/sub.mjs 덤프(vrow), P/v.mjs.
- P2-32 영상 페이지로 가는 길은 '구간별로 보기'가 있는 줄뿐이다: 11-06 9줄 중 2줄(Fx000000004, Fx000000008), 11-05 4줄 중 1줄, 11-04 0/2, 11-02 1/3, 11-01 2/9, 10-31 1/4. 근거 P/v.mjs 출력.
- P2-33 빌더 탭(#builder, 375): 일정|지표 상자 153 + 안내 문단(p.flow.note, 67, 링크 '빌더 탭 소개') + 묶음 제목 '도구 변화'(h2 22px, 28) + 항목 ×4. 첫화면: 첫 항목이 y=468부터 42%. 묶음은 1개뿐('도구 변화'). 근거 R-tabs, P/cells.mjs.
- P2-34 빌더 항목 하나: 머리 70(분류 14 + 제목 h3 24, 오른쪽 읽음 버튼 44) + 늘 펼친 칸. 칸 이름(항목 1) 7개 = 무엇이 바뀌었나 / 누가 영향받나 / 지금 할 일 / 기한 / 고른 이유 / 관련 이슈 / 출처 (항목 2~4는 '관련 이슈'가 없어 6칸) + 제보 링크 1개. 항목 높이 375: 560/496/535/495, 1280: 537/473/512/472. 접기 없음(항상 펼침). 근거 P/cells.mjs, R-tabs.
- P2-35 수요 탭(#demand, 375): 일정|지표 상자 153 + 안내 문단 132(p.flow.note, 링크 '수요 탭 소개와 분야별 소스') + 항목 ×3, 첫화면: 첫 항목 y=481부터 41%. 근거 R-tabs.
- P2-36 수요 항목 하나: 머리 70(분류 14 + 제목 24 + 읽음 버튼) + 늘 펼친 칸. 칸 이름(항목 1) 8개 = 요지 / 잇는 이유 / 근거(3줄) / 근거 수준 / 보조 근거 / 관련 이슈 / 비교 기간 / 출처 (항목 2·3은 보조 근거·관련 이슈가 없어 6칸) + 소스 안내 한 줄(p.dnote 12px) + 제보 링크 1개. 항목 높이 375: 1040/636/733, 1280: 860/613/632. 출처 링크 5개/2개/2개. 근거 P/cells.mjs, R-tabs.
- P2-37 세 탭 모두 같은 위쪽 틀(요약 문단 127 + 키워드 + 일정|지표 상자 153)을 위에 두고, 탭 안에 칩 줄은 영상 탭만 있다(빌더·수요는 없음). 첫화면에서 새 내용이 시작하는 y: 영상 칩 y=349, 빌더 안내 y=349, 수요 안내 y=349 (375). 근거 R-tabs.
- P2-38 브리프 페이지 높이(375): 한국 탭 1903 · 영상 2300 · 빌더 2815 · 수요 3150 (SH brief-normal/videos/builder/demand-375.png.json layout.pageHeight). 1280: 1541 / 1863 / 2596 / 2698.

## 4. 다른 화면 묶음 (정상 상태)

각 줄 형식: 위에서부터 요소(개수, 높이, 첫화면%). 근거는 모두 R-rest의 해당 `### 화면 폭` 구간.
- P2-40 G2 날짜 목록(/dates): 제목 h1 22px 49(6%) · 월 제목 2개(16) · 날짜 줄 6개(2026년 11월, 목록 높이 282) + 12개(2026년 10월, 564). 목록 영역 첫화면 375 85%, 1280 87%. 페이지 높이 963.
- P2-41 G3 이슈 목록(/issues): 제목 49(6%) · 칩 줄 2개(대분류 9칩 49 + 상태 3칩 '전체 진행 중 종료' 49, 합 98, 12%) · 개수 줄 26('39개') · 이슈 줄 ×39(줄 93, 합 3619, 첫화면 72%/1280 75%). 페이지 높이 4050(375)/3967(1280) (SH issues-normal-*.png.json layout.pageHeight).
- P2-42 G4 이슈 페이지(/issues/28, 전개 15건): 분류 줄 14 · 이슈명 h1 22px 29 · 다른 이름 17 · 메타 줄 16 · 지금까지 요약(div.summary) 375 143 / 1280 95 · '타임라인' 소제목 16 · 타임라인 ol 15줄(줄 48, 합 986/1280 692) · '등장 인물·기관·국가' 소제목 + 칩 10개(99/64) · '관련 이슈' 칩 2개 29. 첫화면 비율: 요약 375 18%·1280 11%, 타임라인 57%/66%. 페이지 높이 1753/1293.
- P2-43 G5 인물·기관·국가 목록(/entities): 제목 49 · '최근 등장 순' 줄 26 · 칩 4개 49 · '28개' 26 · 줄 ×28(약 90, 합 2520, 첫화면 75%/77%).
- P2-44 G6 인물 페이지(/entities/1): 분류 14 · 이름 29 · 메타 32 · '등장한 이슈' 소제목 + 이슈 칩(375 449 / 1280 239, 첫화면 55%/27%) · '이슈 더 보기' 68 · '등장한 뉴스' 소제목 + 뉴스 줄(1484/1147). 페이지 높이 2442/1812.
- P2-45 G7 용어 사전(/terms): 제목 29 · 메타 16 · 초성 이동 줄(14칸, 64) · 초성 묶음 ×15(합 3791 / 1280 3166, 첫화면 74%/77%). 용어 28개. /terms/1도 같은 화면(높이 같음).
- P2-46 G8 일정(/schedules): 제목+보기 바꾸기(목록|달력) 86 · 구간 버튼 2개(다가오는/지난 일정) 35 · 칩 줄 6칩 49 · 날짜 묶음 9개(날짜 소제목 17 + 일정 줄, 일정 줄 하나 55~99, 합 1088/1071). 일정 줄 하나 = 분류 14 + 제목(15px/600) + 이슈 링크(12px) + 취소 등 상태 표시. 첫화면 일정 영역 70%(375)/73%(1280). /schedules/11도 같은 화면(높이 같음).
- P2-47 G9 지표 목록(/indicators): 제목 29 · 메타 19 · 지표 카드 ×2(365/364, 1280 248) · 출처 목록 208/153. 첫화면 카드 영역 83%/57%.
- P2-48 G10 지표 페이지(/indicators/kospi): 제목 · 값 줄(43/24) · 기간 버튼 3개(1개월 1년 5년) 35 · 그래프 240 · 관련 이슈 62 · 출처 18. 페이지 높이 812/900 안에 다 들어감.
- P2-49 G11 영상 페이지(/videos/2026-11-06/Fx000000008): 썸네일 72(1280 112) · 제목 h1 22px 57/29 · 채널·길이 줄 17 · 추천 이유 53/34 · '요약' 소제목 + 요약 139/69 · '구간별 정리' 소제목 + 안내 문단 69/46 · 구간 ol ×8(줄 234, 합 2912/1869) · 출처 줄 43. 구간 하나 = 시각 링크(44) + 제목(14px/700) + 한 줄 요지(46) + 불릿 3개(216). 첫화면: 구간 목록 24%(375)/42%(1280). 페이지 높이 3803/2558.
- P2-50 G12 검색(/search?q=가짜): 제목 49 · 검색 칸+찾기 65 · 결과 묶음 2개(이슈 39건 합 2781 + 뉴스 24658 / 1280 18758) · 더 보기 76. 결과 항목 309개(P/nav2 S6 items=309). 페이지 높이 27915/21931. 첫화면 결과 영역 77%/80%. 결과 줄 하나 = 분류 14 + 제목 17px/700 24, 줄 71.
- P2-51 G13 소개(/about): h1 + 소제목(h2 14px) 11개 + 문단 약 25개 + 하위 절(오류 정정 376, 빌더 탭 4621/3174). 페이지 높이 7524/5399 (SH about-normal-*.png.json).
- P2-52 G14 개인정보 처리방침(/privacy): h1 + 소제목 11개 + 문단. 페이지 높이 2217/1603.
- P2-53 G15 없는 페이지: h1 29 + 문단 23 + 요청 주소 줄 21 + 이동 버튼 3개('최근 뉴스 브리프 보기' '이슈 목록' '검색') 104. 첫화면 28%.

## 5. 위계 단계 수 (styles.typeCombos = 글자 크기·굵기·색 조합 수, 화면 전체, 라이트)

SH = A/shots/<이름>.png.json의 styles.typeCombos 키 수. 괄호는 글자 크기 종류 수.
- P2-60 브리프: 정상 29 (11종) · 영상 탭 23 (11/10) · 빌더 탭 24 (12) · 수요 탭 21 (11) · 펼친 줄 36(1280)/37(375) (13) · 많은 데이터 31 (11) · 빈 3 (3) · 로딩 3 · 오류 서버 29.
- P2-61 이슈 목록 12(정상)·13(많은 데이터)·12(빈) (5종). 이슈 페이지 10 (8종). 인물 목록 6 (5종). 인물 페이지 9 (8종). 날짜 목록 5 (5종).
- P2-62 용어 9 (6종). 일정 정상 16 (7종) · 많은 데이터 19 · 빈 5. 지표 목록 9 (6종). 지표 페이지 11 (9종).
- P2-63 영상 페이지 12 (8종). 검색: 정상 16 (8종) · 많은 데이터 16 · 입력만 6 · 결과 없음 5.
- P2-64 소개 12 (6종). 개인정보 7 (4종). 없는 페이지 7 (5종). 이슈 로딩 2.
- P2-65 첫화면(375/1280, 보이는 글자 요소만, P/fs.mjs) 조합 수: 브리프 24/24 (글자 크기 11종/11) · 영상 탭 23/23 · 빌더 탭 20/21 · 수요 탭 20/20 · 이슈 페이지 8/8 (7종) · 영상 페이지 10/10 (7종) · 일정 16/16 (7종) · 검색 11/11 (5종).
- P2-66 브리프 정상 상태 전체 조합 29개 중 위쪽 항목: '12px 400 회색(107,107,112)' 25개 요소, '11px 400 투명' 10개(읽음 ✓ 글자), '11px 600 주황(194,65,12)' 7개, '15px 400 회색' 6개, '17px 700 검정(29,29,31)' 5개(뉴스 제목), '15px 600 검정' 5개(짧은 소식 제목). 글자 크기 11종: 11, 11.5, 12, 12.5, 13, 13.5, 14, 15, 17, 18, 19px. 근거 SH brief-normal-375.png.json styles.

## 6. 의도한 1순위 측정 (RK = P/rank.json, 첫 화면에 걸친 글자 요소 기준, 스크롤 0)

(a) 글자 크기 순위: 1순위 요소의 글자 크기가 첫 화면 글자 크기 종류 중 몇 번째인지(큰 것이 1번째)와 더 큰 글자 요소 수. '본문' 값은 머리글·하단 탭·꼬리말 제외, '전체'는 포함. (b) 세로 위치 순위: 본문 글자 요소를 위에서부터 셌을 때 1순위 요소의 번째 / 본문 글자 요소 수. (c) 1순위 요소 첫 줄의 윗선이 화면 위에서 몇 px인지.

- P2-70 브리프 1순위 = 첫 뉴스 제목(.list .item .title, 17px/700): (a) 본문 1번째 큰 크기(8종 중), 더 큰 요소 0. 전체로는 3번째(머리글 로고 19px, ‹ › 18px 3개가 더 큼). (b) 본문 27번째 / 40개(375), 27번째 / 50개(1280). 위에 있는 요소 26개: 요약 문단 1, 키워드 2, 일정 상자 10, 칩 9, 섹션 요약 1, 첫 줄의 정정 표시·분류 글·읽음 표시 3. (c) 첫 줄 윗선 y=499(375), y=456(1280). 근거 RK brief.
- P2-71 이슈 1순위 = 지금까지 요약(.summary, 14px): (a) 본문 3번째 큰 크기(7종 중), 더 큰 요소 8개(375: h1 22px 1개 + 타임라인 제목 14.5px 7개) / 14개(1280: 14.5px 타임라인 제목 13개). (b) 본문 5번째 / 20개(375), 5번째 / 32개(1280); 위 4개 = 분류 줄, 이슈명 h1, 다른 이름, 메타 줄. (c) 첫 줄 y=188(상자 윗선 y=173). 근거 RK issue.
- P2-72 영상 1순위 = 구간 목록 첫 줄(ol.vsecs 첫 li, 시각 링크 '0:00' 14px/600): (a) 본문 3번째 큰 크기(7종 중), 더 큰 요소 3개(제목 h1 22px, '요약' 15px, '구간별 정리' 15px). (b) 본문 11번째 / 14개(375), 11번째 / 21개(1280); 위 10개 = 썸네일 길이, 제목, 채널, 분, 추천 이유 2개, '요약' 소제목, 요약 문단, '구간별 정리' 소제목, 안내 문단. (c) 첫 줄 y=637(375), y=537(1280). 구간 제목(h3 14px/700) 첫 줄은 y=674(375, P/sub.mjs 덤프). 근거 RK video.
- P2-73 일정 1순위 = 가까운 일정 첫 줄: 일정 제목(a.t, 15px/600) (a) 본문 2번째 큰 크기(6종 중), 더 큰 요소 1개(제목 '일정' 22px). 날짜 소제목 '11월 9일 (월)'(13px/700)은 3번째 큰 크기. (b) 제목 본문 15번째 / 38개(375), 15번째 / 42개(1280); 날짜 소제목 13번째. (c) 날짜 소제목 첫 줄 y=245, 일정 제목 첫 줄 y=290(375·1280 같음). 근거 RK schedule, schedule-date.
- P2-74 검색 1순위 = 결과 첫 줄: 첫 결과 제목(17px/700) (a) 본문 2번째 큰 크기(5종 중), 더 큰 요소 1개('검색' 22px). 첫 결과 줄의 분류 글(11.5px)로 보면 5종 중 5번째, 더 큰 요소 12개(375)/13개(1280). (b) 제목 본문 5번째 / 21개(375), 5번째 / 23개(1280); 위 4개 = 제목 '검색', 찾기 버튼 글, 결과 묶음 제목 '이슈', 첫 결과 분류 글. (c) 첫 결과 줄 윗선(분류 글 첫 줄) y=217, 제목 첫 줄 y=236(375·1280 같음). 근거 RK search, search-firstrow.
- P2-75 브리프의 본문 요소 블록 순서(위에서부터 5번째 블록이 뉴스 목록): 요약 문단(1) → 일정|지표 상자(2) → 대분류 칩 줄(3) → 섹션 요약(4) → 뉴스 목록(5). 근거 R-brief.

## 7. 화면 사이 이동과 돌아올 때 상태 (NAV1, NAV2, NAV3; 375 모바일 컨텍스트와 1280 둘 다 같은 결과)

(전제) 새 컨텍스트에서 시작. '한국' 탭이 기본. 브라우저 뒤로 = `history.back()`, 화면 뒤로 = 머리글의 '‹ …' 링크.
- P2-80 브리프 오늘(/)에서 탭 '세계' 선택 → 대분류 칩 '경제'(항목 5→2) → 스크롤 → 둘째 줄 펼침(주소가 /2026-11-06#세계-2로 바뀜, scrollY 420) → 펼침 안 이어지는 이슈 링크(/issues/17) 누름. 근거 NAV1 S1.
- P2-81 (a) 브라우저 뒤로: 주소 /2026-11-06#세계-2, 탭 '세계' 유지, 펼침 1개 유지, 날짜 11월 6일 유지, 읽음 표시 유지, 대분류 칩은 '경제' → '전체'로 풀림(항목 2→5), 스크롤 420 → 523(375)/456(1280)(펼친 줄 위치로 맞춤). 근거 NAV1 S1 (a).
- P2-82 (b) 화면 뒤로 링크: 이슈 페이지의 링크는 '‹ 이슈'(/issues)라서 브리프가 아니라 이슈 목록(칩 전체|전체, 스크롤 0, 39개)으로 간다. 거기서 '‹ 브리프'(/)를 누르면 브리프 최신 날짜(11월 6일), 탭 '세계'(유지), 칩 '전체', 펼침 0개, 스크롤 0. 근거 NAV1 S1 (b), (b2).
- P2-83 지난 날짜(/2026-11-03)에서 같은 순서(탭 '세계', 칩 '경제'(항목 3), 펼침 /2026-11-03#세계-3, 이슈 /issues/7): (a) 브라우저 뒤로는 /2026-11-03#세계-3, 날짜 11월 3일 유지, 탭·펼침 유지, 칩 '전체'로 풀림, 스크롤 420 → 576(375)/485(1280). 근거 NAV1 S2 (a).
- P2-84 지난 날짜에서 (b) 화면 뒤로 링크: '‹ 이슈' → /issues → '‹ 브리프' → '/' = 날짜가 11월 6일(최신)로 바뀐다(보던 11월 3일을 잃음), 탭 '세계'는 유지, 펼침·칩·스크롤 풀림. 375·1280 같음. 근거 NAV1 S2 (b2).
- P2-85 영상 탭(오늘 /, 탭 '영상 9', 스크롤 250) → 영상 줄의 '구간별로 보기'(/videos/2026-11-06/Fx000000004, 84x44) → 영상 페이지의 '‹ 브리프'(href /2026-11-06#videos) → 도착 /2026-11-06#videos, 날짜 11월 6일 유지, 탭 '영상 9' 유지, 칩 '전체', 스크롤 0(250이 풀림). 근거 NAV2 S4.
- P2-86 지난 날짜 영상(/2026-11-05, 탭 '영상 4', 칩 'AI 2', 스크롤 150, 구간 링크 1개 Fx00000000c): 영상 페이지 '‹ 브리프' href /2026-11-05#videos. (a) 브라우저 뒤로 = /2026-11-05, 날짜·탭 '영상 4' 유지, 스크롤 150 유지, 칩 'AI 2' → '전체'로 풀림. (b) '‹ 브리프' = /2026-11-05#videos, 날짜 유지(11월 5일), 탭 유지, 칩 풀림, 스크롤 0. 11-01도 같은 결과(href /2026-11-01#videos, 날짜 11월 1일 유지). 근거 NAV3.
- P2-87 영상 줄 본체(a.vlink)는 YouTube(새 탭)로 간다: href=https://www.youtube.com/watch?v=Fx00000000a, target=_blank. 누르지 않았다(href만 읽음). 근거 P/v.mjs, NAV2 S3.
- P2-88 일정(/schedules): '지난 일정' 선택 + 칩 '경제' + 스크롤 → 일정 줄의 이슈 링크(/issues/24) → (a) 브라우저 뒤로: 구간이 '다가오는 일정'으로, 칩이 '전체'로 풀림(375 스크롤 74 유지, 1280은 스크롤 0). (b) 화면 뒤로 링크 '‹ 이슈' → 이슈 목록(/issues). 근거 NAV2 S5.
- P2-89 일정 제목(a.t) 누름 → 브리프 /2026-11-04#한국-s1 (11월 4일 브리프의 짧은 소식, 탭 '한국', 스크롤 1029(375)/610(1280)). 브라우저 뒤로 → /schedules, 구간 '다가오는 일정', 칩 '전체', 스크롤 0. 근거 NAV2 S5b.
- P2-90 검색(/search?q=가짜): 스크롤 1500(결과 309개) → 20번째 결과(/issues/7) → (a) 브라우저 뒤로: 주소와 검색어 '가짜' 유지, 결과 309개 다시 표시, 스크롤 1500 → 0으로 풀림. (b) 화면 뒤로 링크 '‹ 이슈' → 이슈 목록. 검색 화면 자체의 '‹ 브리프'는 /(최신 날짜)로 간다. 근거 NAV2 S6, P/back.mjs.
- P2-91 브리프 일정 상자의 일정 줄(a.wrow, /schedules/11) 누름 → 일정 화면(구간 '다가오는 일정', 칩 '전체'). (a) 브라우저 뒤로 / (b) 화면 '‹ 브리프'(/) 모두 / 도착, 탭 'IT·AI'(고른 탭) 유지, 스크롤 0. 근거 NAV2 S7.
- P2-92 이슈 페이지에서 브리프로 돌아가는 링크가 둘이다: 화면 뒤로 링크 '‹ 이슈'(이슈 목록으로), 타임라인 줄 링크(/2026-11-06#세계-s4처럼 그 뉴스의 날짜·줄 주소). 근거 P/hrefs.mjs(/issues/28 링크 목록).
- P2-93 탭 선택은 브리프를 다시 열어도 유지되고(예: '세계' 선택 후 이슈 목록을 거쳐 / 로 와도 '세계'), 대분류 칩·일정 구간 버튼·검색 스크롤은 유지되지 않는다. 근거 NAV1 S1 (b2), NAV2 S5.

## 8. 기타 사실

- P2-95 앱 밖 링크 도메인(href만 읽음, 누르지 않음): www.youtube.com(영상 줄, 영상 페이지 시각·썸네일·약관 링크 /t/terms), builder.example.com(빌더 출처), mailto: <공개 제보 메일>(제보). 근거 P/hrefs.mjs.
- P2-96 모든 측정은 라이트 테마·정상 서버(4401). 스크립트: P/roles.mjs, P/sub.mjs, P/rank.mjs, P/fs.mjs, P/navtest.mjs, P/nav2.mjs, P/nav3.mjs, P/acc.mjs, P/cells.mjs, P/dup.mjs, P/dup2.mjs, P/back.mjs, P/hrefs.mjs, P/v.mjs, P/t.mjs, P/w.mjs.

완료


## P5 시각 측정

# P5 시각 측정 결과 (2026-11-06)

경로 약어: A = A , 코드 = site/src , site = site

측정 방식: 이미 찍은 A/shots/*.png.json 의 `styles`(전체 페이지 기준, 보이는 요소만). 글자 속성은 글자가 있는 요소만, 색(color)은 부모와 다른 요소만, 배경은 부모 불투명 배경과 다른 요소만 센다. "상자 수" = 테두리·그림자·배경색 중 하나라도 있는 요소 수(json `boxes`). 강조색 수는 같은 job(`A/raw/job/job-all.json`)을 `A/raw/P5/accent.mjs`로 다시 열어 센 값(결과 `A/raw/P5/accent.json`): accent 글자 = 계산된 color가 accent이고 부모와 다르며 style 속성에 `--cat-`이 없는 요소, 대분류 색 = style 속성에 `--cat-`이 있는 요소(별도 수).

이 파일의 줄은 `ID | 사실 | 근거` 형식이다. 파일 이름 `<화면>-<상태>-<폭>[-dark]`는 모두 `A/shots/<이름>.png.json` 을 뜻한다.

## 1. 화면 묶음별 개수 (정상 상태 라이트·다크, 375·1280, 그 밖 상태)

열: 요소 수 / 글자 크기 종류 / 굵기 종류 / 글자색 종류 / 배경색 종류 / 테두리 종류 / 모서리 종류 / 그림자 종류 / padding 종류 / margin 종류 / gap 종류 / 상자 수 / accent 글자 / accentbg 배경 / accent 테두리 / accent svg / 강조 그림자·윤곽 / 대분류 색 글자

P5-01 | about-normal-1280-dark: 요소 312 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 13 / gap 3 / 상자 67 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/about-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-02 | about-normal-1280: 요소 312 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 13 / gap 3 / 상자 67 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/about-normal-1280.png.json ; A/raw/P5/accent.json
P5-03 | about-normal-375-dark: 요소 312 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 14 / gap 2 / 상자 67 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/about-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-04 | about-normal-375: 요소 312 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 14 / gap 2 / 상자 67 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/about-normal-375.png.json ; A/raw/P5/accent.json
P5-05 | brief-big-1280: 요소 419 / 글자크기 11 / 굵기 4 / 글자색 9 / 배경색 4 / 테두리 4 / 모서리 5 / 그림자 0 / padding 22 / margin 17 / gap 6 / 상자 108 / accent글자 19 / accentbg 17 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/brief-big-1280.png.json ; A/raw/P5/accent.json
P5-06 | brief-big-375: 요소 416 / 글자크기 11 / 굵기 4 / 글자색 9 / 배경색 3 / 테두리 4 / 모서리 5 / 그림자 0 / padding 23 / margin 17 / gap 5 / 상자 105 / accent글자 19 / accentbg 17 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/brief-big-375.png.json ; A/raw/P5/accent.json
P5-07 | brief-builder-1280: 요소 184 / 글자크기 12 / 굵기 4 / 글자색 4 / 배경색 1 / 테두리 4 / 모서리 5 / 그림자 0 / padding 21 / margin 22 / gap 7 / 상자 16 / accent글자 3 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-builder-1280.png.json ; A/raw/P5/accent.json
P5-08 | brief-builder-375: 요소 184 / 글자크기 12 / 굵기 4 / 글자색 4 / 배경색 1 / 테두리 4 / 모서리 5 / 그림자 0 / padding 22 / margin 23 / gap 6 / 상자 16 / accent글자 3 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-builder-375.png.json ; A/raw/P5/accent.json
P5-09 | brief-demand-1280: 요소 196 / 글자크기 11 / 굵기 4 / 글자색 4 / 배경색 1 / 테두리 4 / 모서리 5 / 그림자 0 / padding 20 / margin 20 / gap 6 / 상자 14 / accent글자 2 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-demand-1280.png.json ; A/raw/P5/accent.json
P5-10 | brief-demand-375: 요소 196 / 글자크기 11 / 굵기 4 / 글자색 4 / 배경색 1 / 테두리 4 / 모서리 5 / 그림자 0 / padding 20 / margin 21 / gap 5 / 상자 14 / accent글자 2 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-demand-375.png.json ; A/raw/P5/accent.json
P5-11 | brief-empty-1280: 요소 28 / 글자크기 3 / 굵기 2 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 4 / margin 4 / gap 2 / 상자 2 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-empty-1280.png.json ; A/raw/P5/accent.json
P5-12 | brief-empty-375: 요소 28 / 글자크기 3 / 굵기 2 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 4 / margin 5 / gap 1 / 상자 2 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-empty-375.png.json ; A/raw/P5/accent.json
P5-13 | brief-error-1280: 요소 187 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 4 / 테두리 5 / 모서리 5 / 그림자 0 / padding 22 / margin 17 / gap 7 / 상자 48 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-error-1280.png.json ; A/raw/P5/accent.json
P5-14 | brief-error-375: 요소 184 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 3 / 테두리 5 / 모서리 5 / 그림자 0 / padding 23 / margin 17 / gap 6 / 상자 45 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-error-375.png.json ; A/raw/P5/accent.json
P5-15 | brief-loading-1280: 요소 29 / 글자크기 3 / 굵기 2 / 글자색 1 / 배경색 0 / 테두리 3 / 모서리 2 / 그림자 0 / padding 4 / margin 5 / gap 2 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-loading-1280.png.json ; A/raw/P5/accent.json
P5-16 | brief-loading-375: 요소 29 / 글자크기 3 / 굵기 2 / 글자색 1 / 배경색 0 / 테두리 3 / 모서리 2 / 그림자 0 / padding 4 / margin 6 / gap 1 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-loading-375.png.json ; A/raw/P5/accent.json
P5-17 | brief-normal-1280-dark: 요소 187 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 4 / 테두리 5 / 모서리 5 / 그림자 0 / padding 22 / margin 17 / gap 7 / 상자 48 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-18 | brief-normal-1280: 요소 187 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 4 / 테두리 5 / 모서리 5 / 그림자 0 / padding 22 / margin 17 / gap 7 / 상자 48 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-normal-1280.png.json ; A/raw/P5/accent.json
P5-19 | brief-normal-375-dark: 요소 184 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 3 / 테두리 5 / 모서리 5 / 그림자 0 / padding 23 / margin 17 / gap 6 / 상자 45 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-20 | brief-normal-375: 요소 184 / 글자크기 11 / 굵기 4 / 글자색 8 / 배경색 3 / 테두리 5 / 모서리 5 / 그림자 0 / padding 23 / margin 17 / gap 6 / 상자 45 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-normal-375.png.json ; A/raw/P5/accent.json
P5-21 | brief-open-1280: 요소 246 / 글자크기 13 / 굵기 4 / 글자색 8 / 배경색 5 / 테두리 6 / 모서리 6 / 그림자 0 / padding 26 / margin 26 / gap 7 / 상자 53 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-open-1280.png.json ; A/raw/P5/accent.json
P5-22 | brief-open-375: 요소 244 / 글자크기 13 / 굵기 4 / 글자색 8 / 배경색 5 / 테두리 6 / 모서리 6 / 그림자 0 / padding 29 / margin 26 / gap 6 / 상자 51 / accent글자 9 / accentbg 7 / accent테두리 0 / accent색면 1 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-open-375.png.json ; A/raw/P5/accent.json
P5-23 | brief-videos-1280: 요소 190 / 글자크기 11 / 굵기 4 / 글자색 4 / 배경색 4 / 테두리 4 / 모서리 6 / 그림자 0 / padding 21 / margin 14 / gap 8 / 상자 59 / accent글자 27 / accentbg 9 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-videos-1280.png.json ; A/raw/P5/accent.json
P5-24 | brief-videos-375: 요소 190 / 글자크기 10 / 굵기 4 / 글자색 4 / 배경색 4 / 테두리 4 / 모서리 6 / 그림자 0 / padding 21 / margin 15 / gap 7 / 상자 59 / accent글자 27 / accentbg 9 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/brief-videos-375.png.json ; A/raw/P5/accent.json
P5-25 | dates-normal-1280-dark: 요소 89 / 글자크기 5 / 굵기 3 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 5 / gap 3 / 상자 20 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/dates-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-26 | dates-normal-1280: 요소 89 / 글자크기 5 / 굵기 3 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 5 / gap 3 / 상자 20 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/dates-normal-1280.png.json ; A/raw/P5/accent.json
P5-27 | dates-normal-375-dark: 요소 89 / 글자크기 5 / 굵기 3 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 6 / gap 2 / 상자 20 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/dates-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-28 | dates-normal-375: 요소 89 / 글자크기 5 / 굵기 3 / 글자색 1 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 6 / gap 2 / 상자 20 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/dates-normal-375.png.json ; A/raw/P5/accent.json
P5-29 | entities-big-1280: 요소 1528 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 305 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-big-1280.png.json ; A/raw/P5/accent.json
P5-30 | entities-big-375: 요소 1528 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 305 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-big-375.png.json ; A/raw/P5/accent.json
P5-31 | entities-normal-1280-dark: 요소 178 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 35 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-32 | entities-normal-1280: 요소 178 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 35 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-normal-1280.png.json ; A/raw/P5/accent.json
P5-33 | entities-normal-375-dark: 요소 178 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 35 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-34 | entities-normal-375: 요소 178 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 35 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entities-normal-375.png.json ; A/raw/P5/accent.json
P5-35 | entity-normal-1280-dark: 요소 181 / 글자크기 8 / 굵기 4 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 10 / gap 4 / 상자 44 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entity-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-36 | entity-normal-1280: 요소 181 / 글자크기 8 / 굵기 4 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 10 / gap 4 / 상자 44 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entity-normal-1280.png.json ; A/raw/P5/accent.json
P5-37 | entity-normal-375-dark: 요소 181 / 글자크기 8 / 굵기 4 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 11 / gap 3 / 상자 44 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entity-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-38 | entity-normal-375: 요소 181 / 글자크기 8 / 굵기 4 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 9 / margin 11 / gap 3 / 상자 44 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/entity-normal-375.png.json ; A/raw/P5/accent.json
P5-39 | indicator-normal-1280-dark: 요소 58 / 글자크기 9 / 굵기 4 / 글자색 3 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 11 / gap 3 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicator-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-40 | indicator-normal-1280: 요소 58 / 글자크기 9 / 굵기 4 / 글자색 3 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 11 / gap 3 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicator-normal-1280.png.json ; A/raw/P5/accent.json
P5-41 | indicator-normal-375-dark: 요소 58 / 글자크기 9 / 굵기 4 / 글자색 3 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 12 / gap 2 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicator-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-42 | indicator-normal-375: 요소 58 / 글자크기 9 / 굵기 4 / 글자색 3 / 배경색 1 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 12 / gap 2 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicator-normal-375.png.json ; A/raw/P5/accent.json
P5-43 | indicators-normal-1280-dark: 요소 137 / 글자크기 6 / 굵기 3 / 글자색 4 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 6 / margin 10 / gap 3 / 상자 12 / accent글자 1 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicators-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-44 | indicators-normal-1280: 요소 137 / 글자크기 6 / 굵기 3 / 글자색 4 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 6 / margin 10 / gap 3 / 상자 12 / accent글자 1 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicators-normal-1280.png.json ; A/raw/P5/accent.json
P5-45 | indicators-normal-375-dark: 요소 137 / 글자크기 6 / 굵기 3 / 글자색 4 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 6 / margin 11 / gap 2 / 상자 12 / accent글자 1 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicators-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-46 | indicators-normal-375: 요소 137 / 글자크기 6 / 굵기 3 / 글자색 4 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 6 / margin 11 / gap 2 / 상자 12 / accent글자 1 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/indicators-normal-375.png.json ; A/raw/P5/accent.json
P5-47 | issue-loading-1280: 요소 30 / 글자크기 2 / 굵기 1 / 글자색 1 / 배경색 0 / 테두리 3 / 모서리 2 / 그림자 0 / padding 5 / margin 5 / gap 3 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-loading-1280.png.json ; A/raw/P5/accent.json
P5-48 | issue-loading-375: 요소 30 / 글자크기 2 / 굵기 1 / 글자색 1 / 배경색 0 / 테두리 3 / 모서리 2 / 그림자 0 / padding 5 / margin 6 / gap 2 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-loading-375.png.json ; A/raw/P5/accent.json
P5-49 | issue-normal-1280-dark: 요소 137 / 글자크기 8 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 3 / 그림자 0 / padding 9 / margin 11 / gap 4 / 상자 15 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-50 | issue-normal-1280: 요소 137 / 글자크기 8 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 3 / 그림자 0 / padding 9 / margin 11 / gap 4 / 상자 15 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-normal-1280.png.json ; A/raw/P5/accent.json
P5-51 | issue-normal-375-dark: 요소 137 / 글자크기 8 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 3 / 그림자 0 / padding 9 / margin 12 / gap 3 / 상자 15 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-52 | issue-normal-375: 요소 137 / 글자크기 8 / 굵기 4 / 글자색 2 / 배경색 1 / 테두리 2 / 모서리 3 / 그림자 0 / padding 9 / margin 12 / gap 3 / 상자 15 / accent글자 0 / accentbg 0 / accent테두리 1 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/issue-normal-375.png.json ; A/raw/P5/accent.json
P5-53 | issues-big-1280: 요소 546 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 2 / 테두리 2 / 모서리 2 / 그림자 0 / padding 11 / margin 6 / gap 4 / 상자 116 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 17 | 근거: A/shots/issues-big-1280.png.json ; A/raw/P5/accent.json
P5-54 | issues-big-375: 요소 545 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 2 / 테두리 2 / 모서리 2 / 그림자 0 / padding 11 / margin 7 / gap 3 / 상자 115 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 17 | 근거: A/shots/issues-big-375.png.json ; A/raw/P5/accent.json
P5-55 | issues-empty-1280: 요소 239 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 54 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-empty-1280.png.json ; A/raw/P5/accent.json
P5-56 | issues-empty-375: 요소 238 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 53 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-empty-375.png.json ; A/raw/P5/accent.json
P5-57 | issues-normal-1280-dark: 요소 239 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 54 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-58 | issues-normal-1280: 요소 239 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 6 / gap 4 / 상자 54 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-normal-1280.png.json ; A/raw/P5/accent.json
P5-59 | issues-normal-375-dark: 요소 238 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 53 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-60 | issues-normal-375: 요소 238 / 글자크기 5 / 굵기 4 / 글자색 9 / 배경색 1 / 테두리 2 / 모서리 2 / 그림자 0 / padding 9 / margin 7 / gap 3 / 상자 53 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/issues-normal-375.png.json ; A/raw/P5/accent.json
P5-61 | notfound-normal-1280-dark: 요소 37 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 7 / gap 3 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 1 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/notfound-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-62 | notfound-normal-1280: 요소 37 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 7 / gap 3 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 1 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/notfound-normal-1280.png.json ; A/raw/P5/accent.json
P5-63 | notfound-normal-375-dark: 요소 37 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 8 / gap 2 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 1 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/notfound-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-64 | notfound-normal-375: 요소 37 / 글자크기 5 / 굵기 3 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 8 / gap 2 / 상자 3 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 1 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/notfound-normal-375.png.json ; A/raw/P5/accent.json
P5-65 | privacy-normal-1280-dark: 요소 68 / 글자크기 4 / 굵기 3 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 7 / gap 3 / 상자 2 / accent글자 5 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/privacy-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-66 | privacy-normal-1280: 요소 68 / 글자크기 4 / 굵기 3 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 7 / gap 3 / 상자 2 / accent글자 5 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/privacy-normal-1280.png.json ; A/raw/P5/accent.json
P5-67 | privacy-normal-375-dark: 요소 68 / 글자크기 4 / 굵기 3 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 8 / gap 2 / 상자 2 / accent글자 5 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/privacy-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-68 | privacy-normal-375: 요소 68 / 글자크기 4 / 굵기 3 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 1 / 그림자 0 / padding 6 / margin 8 / gap 2 / 상자 2 / accent글자 5 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/privacy-normal-375.png.json ; A/raw/P5/accent.json
P5-69 | schedules-big-1280: 요소 231 / 글자크기 7 / 굵기 4 / 글자색 9 / 배경색 4 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 11 / gap 5 / 상자 43 / accent글자 4 / accentbg 4 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 3 | 근거: A/shots/schedules-big-1280.png.json ; A/raw/P5/accent.json
P5-70 | schedules-big-375: 요소 230 / 글자크기 7 / 굵기 4 / 글자색 9 / 배경색 4 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 12 / gap 4 / 상자 42 / accent글자 4 / accentbg 4 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 3 | 근거: A/shots/schedules-big-375.png.json ; A/raw/P5/accent.json
P5-71 | schedules-empty-1280: 요소 36 / 글자크기 4 / 굵기 2 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 5 / gap 4 / 상자 4 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-empty-1280.png.json ; A/raw/P5/accent.json
P5-72 | schedules-empty-375: 요소 36 / 글자크기 4 / 굵기 2 / 글자색 2 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 7 / margin 6 / gap 3 / 상자 4 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-empty-375.png.json ; A/raw/P5/accent.json
P5-73 | schedules-normal-1280-dark: 요소 125 / 글자크기 7 / 굵기 4 / 글자색 7 / 배경색 3 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 11 / gap 5 / 상자 26 / accent글자 1 / accentbg 1 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-74 | schedules-normal-1280: 요소 125 / 글자크기 7 / 굵기 4 / 글자색 7 / 배경색 3 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 11 / gap 5 / 상자 26 / accent글자 1 / accentbg 1 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-normal-1280.png.json ; A/raw/P5/accent.json
P5-75 | schedules-normal-375-dark: 요소 125 / 글자크기 7 / 굵기 4 / 글자색 7 / 배경색 3 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 12 / gap 4 / 상자 26 / accent글자 1 / accentbg 1 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-76 | schedules-normal-375: 요소 125 / 글자크기 7 / 굵기 4 / 글자색 7 / 배경색 3 / 테두리 2 / 모서리 4 / 그림자 0 / padding 13 / margin 12 / gap 4 / 상자 26 / accent글자 1 / accentbg 1 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/schedules-normal-375.png.json ; A/raw/P5/accent.json
P5-77 | search-big-1280: 요소 5037 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 6 / gap 3 / 상자 1045 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 33 | 근거: A/shots/search-big-1280.png.json ; A/raw/P5/accent.json
P5-78 | search-big-375: 요소 5037 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 7 / gap 2 / 상자 1045 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 33 | 근거: A/shots/search-big-375.png.json ; A/raw/P5/accent.json
P5-79 | search-blank-1280: 요소 33 / 글자크기 5 / 굵기 2 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 9 / margin 4 / gap 3 / 상자 6 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 1 / 대분류색 0 | 근거: A/shots/search-blank-1280.png.json ; A/raw/P5/accent.json
P5-80 | search-blank-375: 요소 33 / 글자크기 5 / 굵기 2 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 9 / margin 5 / gap 2 / 상자 6 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 1 / 대분류색 0 | 근거: A/shots/search-blank-375.png.json ; A/raw/P5/accent.json
P5-81 | search-empty-1280: 요소 33 / 글자크기 4 / 굵기 2 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 9 / margin 4 / gap 3 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/search-empty-1280.png.json ; A/raw/P5/accent.json
P5-82 | search-empty-375: 요소 33 / 글자크기 4 / 굵기 2 / 글자색 1 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 9 / margin 5 / gap 2 / 상자 5 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/search-empty-375.png.json ; A/raw/P5/accent.json
P5-83 | search-normal-1280-dark: 요소 1547 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 6 / gap 3 / 상자 315 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/search-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-84 | search-normal-1280: 요소 1547 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 6 / gap 3 / 상자 315 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/search-normal-1280.png.json ; A/raw/P5/accent.json
P5-85 | search-normal-375-dark: 요소 1547 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 7 / gap 2 / 상자 315 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/search-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-86 | search-normal-375: 요소 1547 / 글자크기 8 / 굵기 4 / 글자색 8 / 배경색 1 / 테두리 1 / 모서리 1 / 그림자 0 / padding 11 / margin 7 / gap 2 / 상자 315 / accent글자 0 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 5 | 근거: A/shots/search-normal-375.png.json ; A/raw/P5/accent.json
P5-87 | terms-normal-1280-dark: 요소 266 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 8 / gap 4 / 상자 45 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/terms-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-88 | terms-normal-1280: 요소 266 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 8 / gap 4 / 상자 45 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/terms-normal-1280.png.json ; A/raw/P5/accent.json
P5-89 | terms-normal-375-dark: 요소 266 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 9 / gap 3 / 상자 45 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/terms-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-90 | terms-normal-375: 요소 266 / 글자크기 6 / 굵기 4 / 글자색 2 / 배경색 0 / 테두리 1 / 모서리 2 / 그림자 0 / padding 7 / margin 9 / gap 3 / 상자 45 / accent글자 15 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/terms-normal-375.png.json ; A/raw/P5/accent.json
P5-91 | video-normal-1280-dark: 요소 118 / 글자크기 8 / 굵기 4 / 글자색 3 / 배경색 3 / 테두리 1 / 모서리 3 / 그림자 0 / padding 11 / margin 13 / gap 4 / 상자 13 / accent글자 10 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/video-normal-1280-dark.png.json ; A/raw/P5/accent.json
P5-92 | video-normal-1280: 요소 118 / 글자크기 8 / 굵기 4 / 글자색 3 / 배경색 3 / 테두리 1 / 모서리 3 / 그림자 0 / padding 11 / margin 13 / gap 4 / 상자 13 / accent글자 10 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/video-normal-1280.png.json ; A/raw/P5/accent.json
P5-93 | video-normal-375-dark: 요소 118 / 글자크기 8 / 굵기 4 / 글자색 3 / 배경색 3 / 테두리 1 / 모서리 3 / 그림자 0 / padding 11 / margin 14 / gap 3 / 상자 13 / accent글자 10 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/video-normal-375-dark.png.json ; A/raw/P5/accent.json
P5-94 | video-normal-375: 요소 118 / 글자크기 8 / 굵기 4 / 글자색 3 / 배경색 3 / 테두리 1 / 모서리 3 / 그림자 0 / padding 11 / margin 14 / gap 3 / 상자 13 / accent글자 10 / accentbg 0 / accent테두리 0 / accent색면 0 / accent svg 0 / 강조그림자·윤곽 0 / 대분류색 0 | 근거: A/shots/video-normal-375.png.json ; A/raw/P5/accent.json

## 2. 값 목록 (값×개수)

글자 크기·굵기·모서리·gap·테두리·색은 모든 촬영별로 적는다. 다크 촬영은 같은 라이트 촬영과 글자 크기·굵기·padding·margin·gap·모서리·테두리 폭 값과 개수가 같은지 비교하고(아래 줄), 색·테두리 색만 따로 적는다.

P5-95 | about-normal-1280-dark: 라이트(about-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/about-normal-1280-dark.png.json ; A/shots/about-normal-1280.png.json
P5-96 | about-normal-375-dark: 라이트(about-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/about-normal-375-dark.png.json ; A/shots/about-normal-375.png.json
P5-97 | brief-normal-1280-dark: 라이트(brief-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/brief-normal-1280-dark.png.json ; A/shots/brief-normal-1280.png.json
P5-98 | brief-normal-375-dark: 라이트(brief-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/brief-normal-375-dark.png.json ; A/shots/brief-normal-375.png.json
P5-99 | dates-normal-1280-dark: 라이트(dates-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/dates-normal-1280-dark.png.json ; A/shots/dates-normal-1280.png.json
P5-100 | dates-normal-375-dark: 라이트(dates-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/dates-normal-375-dark.png.json ; A/shots/dates-normal-375.png.json
P5-101 | entities-normal-1280-dark: 라이트(entities-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/entities-normal-1280-dark.png.json ; A/shots/entities-normal-1280.png.json
P5-102 | entities-normal-375-dark: 라이트(entities-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/entities-normal-375-dark.png.json ; A/shots/entities-normal-375.png.json
P5-103 | entity-normal-1280-dark: 라이트(entity-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/entity-normal-1280-dark.png.json ; A/shots/entity-normal-1280.png.json
P5-104 | entity-normal-375-dark: 라이트(entity-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/entity-normal-375-dark.png.json ; A/shots/entity-normal-375.png.json
P5-105 | indicator-normal-1280-dark: 라이트(indicator-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/indicator-normal-1280-dark.png.json ; A/shots/indicator-normal-1280.png.json
P5-106 | indicator-normal-375-dark: 라이트(indicator-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/indicator-normal-375-dark.png.json ; A/shots/indicator-normal-375.png.json
P5-107 | indicators-normal-1280-dark: 라이트(indicators-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/indicators-normal-1280-dark.png.json ; A/shots/indicators-normal-1280.png.json
P5-108 | indicators-normal-375-dark: 라이트(indicators-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/indicators-normal-375-dark.png.json ; A/shots/indicators-normal-375.png.json
P5-109 | issue-normal-1280-dark: 라이트(issue-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/issue-normal-1280-dark.png.json ; A/shots/issue-normal-1280.png.json
P5-110 | issue-normal-375-dark: 라이트(issue-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/issue-normal-375-dark.png.json ; A/shots/issue-normal-375.png.json
P5-111 | issues-normal-1280-dark: 라이트(issues-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/issues-normal-1280-dark.png.json ; A/shots/issues-normal-1280.png.json
P5-112 | issues-normal-375-dark: 라이트(issues-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/issues-normal-375-dark.png.json ; A/shots/issues-normal-375.png.json
P5-113 | notfound-normal-1280-dark: 라이트(notfound-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/notfound-normal-1280-dark.png.json ; A/shots/notfound-normal-1280.png.json
P5-114 | notfound-normal-375-dark: 라이트(notfound-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/notfound-normal-375-dark.png.json ; A/shots/notfound-normal-375.png.json
P5-115 | privacy-normal-1280-dark: 라이트(privacy-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/privacy-normal-1280-dark.png.json ; A/shots/privacy-normal-1280.png.json
P5-116 | privacy-normal-375-dark: 라이트(privacy-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/privacy-normal-375-dark.png.json ; A/shots/privacy-normal-375.png.json
P5-117 | schedules-normal-1280-dark: 라이트(schedules-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/schedules-normal-1280-dark.png.json ; A/shots/schedules-normal-1280.png.json
P5-118 | schedules-normal-375-dark: 라이트(schedules-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/schedules-normal-375-dark.png.json ; A/shots/schedules-normal-375.png.json
P5-119 | search-normal-1280-dark: 라이트(search-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/search-normal-1280-dark.png.json ; A/shots/search-normal-1280.png.json
P5-120 | search-normal-375-dark: 라이트(search-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/search-normal-375-dark.png.json ; A/shots/search-normal-375.png.json
P5-121 | terms-normal-1280-dark: 라이트(terms-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/terms-normal-1280-dark.png.json ; A/shots/terms-normal-1280.png.json
P5-122 | terms-normal-375-dark: 라이트(terms-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/terms-normal-375-dark.png.json ; A/shots/terms-normal-375.png.json
P5-123 | video-normal-1280-dark: 라이트(video-normal-1280)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/video-normal-1280-dark.png.json ; A/shots/video-normal-1280.png.json
P5-124 | video-normal-375-dark: 라이트(video-normal-375)와 다른 항목 = 없음(요소 수·글자 크기·굵기·padding·margin·gap·모서리·그림자·상자 수 같음) | 근거: A/shots/video-normal-375-dark.png.json ; A/shots/video-normal-375.png.json
P5-125 | about-normal-1280-dark 글자색: #fb923c=accent+cat경제×15, #9a9aa0=muted×8 | 근거: A/shots/about-normal-1280-dark.png.json
P5-126 | about-normal-1280-dark 배경색: #222226=chip×2 | 근거: A/shots/about-normal-1280-dark.png.json
P5-127 | about-normal-1280-dark 테두리: 1px solid #2a2a2e=line×69 | 근거: A/shots/about-normal-1280-dark.png.json
P5-128 | about-normal-1280 글자 크기: 14px×230, 12px×14, 11.5px×2, 22px×1, 17px×1, 12.5px×1 ; 굵기: 400×211, 600×21, 700×16, 800×1 | 근거: A/shots/about-normal-1280.png.json
P5-129 | about-normal-1280 모서리: 8px×3, 10px×1 ; gap(행 열): 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/about-normal-1280.png.json
P5-130 | about-normal-1280 padding(위 오른 아래 왼): 8px 8px 8px 0px×44, 8px 0px×22, 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 12px×1, 8px 16px×1, 20px 18px 24px 18px×1 | 근거: A/shots/about-normal-1280.png.json
P5-131 | about-normal-1280 margin: 16px 0px 0px 0px×36, 30px 0px 4px 0px×11, 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 8px 0px 16px 0px×1, 0px 0px 4px 0px×1, 6px 0px 0px 0px×1, 4px 0px 0px 0px×1, 20px 0px 4px 0px×1, 8px 0px 0px 0px×1, 10px 0px 0px 0px×1 | 근거: A/shots/about-normal-1280.png.json
P5-132 | about-normal-1280 글자색: #c2410c=accent+cat경제×15, #6b6b70=muted×8 | 근거: A/shots/about-normal-1280.png.json
P5-133 | about-normal-1280 배경색: #f5f5f7=chip×2 | 근거: A/shots/about-normal-1280.png.json
P5-134 | about-normal-1280 테두리: 1px solid #ececee=line×69 | 근거: A/shots/about-normal-1280.png.json
P5-135 | about-normal-375-dark 글자색: #fb923c=accent+cat경제×15, #9a9aa0=muted×8 | 근거: A/shots/about-normal-375-dark.png.json
P5-136 | about-normal-375-dark 배경색: #222226=chip×2 | 근거: A/shots/about-normal-375-dark.png.json
P5-137 | about-normal-375-dark 테두리: 1px solid #2a2a2e=line×69 | 근거: A/shots/about-normal-375-dark.png.json
P5-138 | about-normal-375 글자 크기: 14px×230, 12px×14, 11.5px×2, 22px×1, 17px×1, 12.5px×1 ; 굵기: 400×211, 600×21, 700×16, 800×1 | 근거: A/shots/about-normal-375.png.json
P5-139 | about-normal-375 모서리: 8px×3, 10px×1 ; gap(행 열): 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/about-normal-375.png.json
P5-140 | about-normal-375 padding(위 오른 아래 왼): 8px 8px 8px 0px×44, 8px 0px×22, 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 12px×1, 8px 16px×1, 20px 18px 24px 18px×1 | 근거: A/shots/about-normal-375.png.json
P5-141 | about-normal-375 margin: 16px 0px 0px 0px×36, 30px 0px 4px 0px×11, 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 8px 0px 16px 0px×1, 0px 0px 4px 0px×1, 6px 0px 0px 0px×1, 4px 0px 0px 0px×1, 20px 0px 4px 0px×1, 8px 0px 0px 0px×1, 10px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/about-normal-375.png.json
P5-142 | about-normal-375 글자색: #c2410c=accent+cat경제×15, #6b6b70=muted×8 | 근거: A/shots/about-normal-375.png.json
P5-143 | about-normal-375 배경색: #f5f5f7=chip×2 | 근거: A/shots/about-normal-375.png.json
P5-144 | about-normal-375 테두리: 1px solid #ececee=line×69 | 근거: A/shots/about-normal-375.png.json
P5-145 | brief-big-1280 글자 크기: 12px×76, 11px×52, 15px×27, 11.5px×16, 17px×15, 14px×8, 12.5px×6, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×109, 600×76, 700×19, 800×1 | 근거: A/shots/brief-big-1280.png.json
P5-146 | brief-big-1280 모서리: 50%×70, 4px×17, 999px×12, 8px×2, 10px×1 ; gap(행 열): 8px 8px×21, 6px 6px×16, 10px 10px×4, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-big-1280.png.json
P5-147 | brief-big-1280 padding(위 오른 아래 왼): 12px 0px 12px 18px×20, 11px 0px×20, 2px 7px×17, 14px 0px 14px 18px×15, 4px 10px×9, 4px 0px×9, 12px×6, 5px 0px×4, 1px 0px 0px 0px×4, 3px 8px×3, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-big-1280.png.json
P5-148 | brief-big-1280 margin: 6px 0px 0px 0px×35, 6px 4px 0px 0px×35, -11px 0px×21, -14px 0px×17, 0px 0px 4px 0px×15, -6px 0px -7px 0px×6, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 4px 2px×1, 14px 0px 4px 0px×1 | 근거: A/shots/brief-big-1280.png.json
P5-149 | brief-big-1280 글자색: #6b6b70=muted×56, transparent×35, #c2410c=accent+cat경제×24, #7c3aed=cat정치×10, #0f766e=cat사회×8, #15803d=cat과학건강×8, #1d1d1f=fg+plot+durBg×5, #be185d=cat문화스포츠×4, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-big-1280.png.json
P5-150 | brief-big-1280 배경색: #fff1e8=accentbg×17, #f5f5f7=chip×4, #1d1d1f=fg+plot+durBg×1, #ececee=line×1 | 근거: A/shots/brief-big-1280.png.json
P5-151 | brief-big-1280 테두리: 1px solid #d1d1d6=ring×140, 1px solid #ececee=line×73, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/brief-big-1280.png.json
P5-152 | brief-big-375 글자 크기: 12px×74, 11px×52, 15px×27, 11.5px×16, 17px×15, 14px×8, 12.5px×6, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×107, 600×76, 700×19, 800×1 | 근거: A/shots/brief-big-375.png.json
P5-153 | brief-big-375 모서리: 50%×70, 4px×17, 999px×10, 8px×2, 10px×1 ; gap(행 열): 8px 8px×21, 6px 6px×16, 10px 10px×4, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-big-375.png.json
P5-154 | brief-big-375 padding(위 오른 아래 왼): 12px 0px 12px 18px×20, 11px 0px×20, 0px 12px 0px 0px×20, 2px 7px×17, 14px 0px 14px 18px×15, 0px 12px×9, 4px 10px×7, 12px×6, 5px 0px×4, 1px 0px 0px 0px×4, 3px 8px×3, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-big-375.png.json
P5-155 | brief-big-375 margin: 6px 0px 0px 0px×35, 6px 4px 0px 0px×35, -11px 0px×21, -14px 0px×17, 0px 0px 4px 0px×15, -6px 0px -7px 0px×6, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 14px 0px 4px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-big-375.png.json
P5-156 | brief-big-375 글자색: #6b6b70=muted×54, transparent×35, #c2410c=accent+cat경제×24, #7c3aed=cat정치×10, #0f766e=cat사회×8, #15803d=cat과학건강×8, #1d1d1f=fg+plot+durBg×5, #be185d=cat문화스포츠×4, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-big-375.png.json
P5-157 | brief-big-375 배경색: #fff1e8=accentbg×17, #f5f5f7=chip×4, #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/brief-big-375.png.json
P5-158 | brief-big-375 테두리: 1px solid #d1d1d6=ring×140, 1px solid #ececee=line×65, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/brief-big-375.png.json
P5-159 | brief-builder-1280 글자 크기: 14px×37, 12.5px×29, 12px×26, 15px×8, 11.5px×5, 17px×4, 11px×4, 18px×2, 13px×2, 13.5px×2, 19px×1, 22px×1 ; 굵기: 400×78, 700×35, 600×6, 800×2 | 근거: A/shots/brief-builder-1280.png.json
P5-160 | brief-builder-1280 모서리: 50%×8, 6px×5, 999px×3, 8px×2, 10px×1 ; gap(행 열): 6px 6px×6, 10px 10px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1, 6px 8px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-builder-1280.png.json
P5-161 | brief-builder-1280 padding(위 오른 아래 왼): 4px 0px×9, 12px×7, 0px 8px×5, 14px 0px 14px 18px×4, 0px 18px 16px 18px×4, 12px 0px×4, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 12px 18px×1, 14px 0px×1, 0px 18px×1, 0px 10px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-builder-1280.png.json
P5-162 | brief-builder-1280 margin: 14px 0px 4px 0px×21, 0px 0px 4px 0px×8, -6px 0px -7px 0px×7, -9px 0px×5, 6px 4px 0px 0px×4, 6px 0px 0px 0px×4, 9px 0px 0px 0px×4, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, -14px 0px×1, 24px 0px 0px 0px×1, -13px 0px×1, -7px 0px×1, 16px 0px 0px 0px×1 | 근거: A/shots/brief-builder-1280.png.json
P5-163 | brief-builder-1280 글자색: #6b6b70=muted×43, #1d1d1f=fg+plot+durBg×4, transparent×4, #c2410c=accent+cat경제×3 | 근거: A/shots/brief-builder-1280.png.json
P5-164 | brief-builder-1280 배경색: #f5f5f7=chip×3 | 근거: A/shots/brief-builder-1280.png.json
P5-165 | brief-builder-1280 테두리: 1px solid #d1d1d6=ring×16, 1px solid #ececee=line×7, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-builder-1280.png.json
P5-166 | brief-builder-375 글자 크기: 14px×37, 12.5px×29, 12px×26, 15px×8, 11.5px×5, 17px×4, 11px×4, 18px×2, 13px×2, 13.5px×2, 19px×1, 22px×1 ; 굵기: 400×78, 700×35, 600×6, 800×2 | 근거: A/shots/brief-builder-375.png.json
P5-167 | brief-builder-375 모서리: 50%×8, 6px×5, 999px×3, 8px×2, 10px×1 ; gap(행 열): 6px 6px×6, 10px 10px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1, 6px 8px×1 ; 그림자: 없음 | 근거: A/shots/brief-builder-375.png.json
P5-168 | brief-builder-375 padding(위 오른 아래 왼): 0px 12px×9, 12px 3px×7, 0px 8px×5, 14px 0px 14px 18px×4, 0px 18px 16px 18px×4, 12px 0px×4, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 12px 18px×1, 14px 0px×1, 0px 18px×1, 0px 10px×1, 0px 12px 0px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-builder-375.png.json
P5-169 | brief-builder-375 margin: 14px 0px 4px 0px×21, 0px 0px 4px 0px×8, -6px 0px -7px 0px×7, -9px 0px×5, 6px 4px 0px 0px×4, 6px 0px 0px 0px×4, 9px 0px 0px 0px×4, -6px×2, 0px 0px 0px auto×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 2px 0px×1, -14px 0px×1, 24px 0px 0px 0px×1, -13px 0px×1, -7px 0px×1, 16px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-builder-375.png.json
P5-170 | brief-builder-375 글자색: #6b6b70=muted×43, #1d1d1f=fg+plot+durBg×4, transparent×4, #c2410c=accent+cat경제×3 | 근거: A/shots/brief-builder-375.png.json
P5-171 | brief-builder-375 배경색: #f5f5f7=chip×3 | 근거: A/shots/brief-builder-375.png.json
P5-172 | brief-builder-375 테두리: 1px solid #d1d1d6=ring×16, 1px solid #ececee=line×7, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-builder-375.png.json
P5-173 | brief-demand-1280 글자 크기: 12px×45, 14px×39, 12.5px×24, 15px×8, 11.5px×4, 17px×3, 11px×3, 18px×2, 13px×2, 13.5px×2, 19px×1 ; 굵기: 400×93, 700×27, 600×12, 800×1 | 근거: A/shots/brief-demand-1280.png.json
P5-174 | brief-demand-1280 모서리: 6px×9, 50%×6, 999px×3, 8px×2, 10px×1 ; gap(행 열): 6px 6px×5, 10px 10px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-demand-1280.png.json
P5-175 | brief-demand-1280 padding(위 오른 아래 왼): 0px 8px×9, 4px 0px×9, 12px×7, 14px 0px 14px 18px×3, 0px 18px 16px 18px×3, 12px 0px×3, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 12px 18px×1, 14px 0px×1, 0px 10px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-demand-1280.png.json
P5-176 | brief-demand-1280 margin: 14px 0px 4px 0px×17, -9px 0px×9, -6px 0px -7px 0px×7, 0px 0px 4px 0px×6, 8px 0px 0px 0px×5, 6px 4px 0px 0px×3, 4px 0px 0px 0px×3, 6px 0px 0px 0px×3, 9px 0px 0px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, -14px 0px×1, -7px 0px×1 | 근거: A/shots/brief-demand-1280.png.json
P5-177 | brief-demand-1280 글자색: #6b6b70=muted×48, #1d1d1f=fg+plot+durBg×4, transparent×3, #c2410c=accent+cat경제×2 | 근거: A/shots/brief-demand-1280.png.json
P5-178 | brief-demand-1280 배경색: #f5f5f7=chip×3 | 근거: A/shots/brief-demand-1280.png.json
P5-179 | brief-demand-1280 테두리: 1px solid #d1d1d6=ring×12, 1px solid #ececee=line×6, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-demand-1280.png.json
P5-180 | brief-demand-375 글자 크기: 12px×45, 14px×39, 12.5px×24, 15px×8, 11.5px×4, 17px×3, 11px×3, 18px×2, 13px×2, 13.5px×2, 19px×1 ; 굵기: 400×93, 700×27, 600×12, 800×1 | 근거: A/shots/brief-demand-375.png.json
P5-181 | brief-demand-375 모서리: 6px×9, 50%×6, 999px×3, 8px×2, 10px×1 ; gap(행 열): 6px 6px×5, 10px 10px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-demand-375.png.json
P5-182 | brief-demand-375 padding(위 오른 아래 왼): 0px 8px×9, 0px 12px×9, 12px 3px×7, 14px 0px 14px 18px×3, 0px 18px 16px 18px×3, 12px 0px×3, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 12px 18px×1, 14px 0px×1, 0px 10px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-demand-375.png.json
P5-183 | brief-demand-375 margin: 14px 0px 4px 0px×17, -9px 0px×9, -6px 0px -7px 0px×7, 0px 0px 4px 0px×6, 8px 0px 0px 0px×5, 6px 4px 0px 0px×3, 4px 0px 0px 0px×3, 6px 0px 0px 0px×3, 9px 0px 0px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, -14px 0px×1, -7px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-demand-375.png.json
P5-184 | brief-demand-375 글자색: #6b6b70=muted×48, #1d1d1f=fg+plot+durBg×4, transparent×3, #c2410c=accent+cat경제×2 | 근거: A/shots/brief-demand-375.png.json
P5-185 | brief-demand-375 배경색: #f5f5f7=chip×3 | 근거: A/shots/brief-demand-375.png.json
P5-186 | brief-demand-375 테두리: 1px solid #d1d1d6=ring×12, 1px solid #ececee=line×6, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-demand-375.png.json
P5-187 | brief-empty-1280 글자 크기: 12px×11, 19px×1, 14px×1 ; 굵기: 400×12, 800×1 | 근거: A/shots/brief-empty-1280.png.json
P5-188 | brief-empty-1280 모서리: 8px×2 ; gap(행 열): 8px 8px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-empty-1280.png.json
P5-189 | brief-empty-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/brief-empty-1280.png.json
P5-190 | brief-empty-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/brief-empty-1280.png.json
P5-191 | brief-empty-1280 글자색: #6b6b70=muted×3 | 근거: A/shots/brief-empty-1280.png.json
P5-192 | brief-empty-1280 배경색: 없음 | 근거: A/shots/brief-empty-1280.png.json
P5-193 | brief-empty-1280 테두리: 1px solid #ececee=line×2 | 근거: A/shots/brief-empty-1280.png.json
P5-194 | brief-empty-375 글자 크기: 12px×11, 19px×1, 14px×1 ; 굵기: 400×12, 800×1 | 근거: A/shots/brief-empty-375.png.json
P5-195 | brief-empty-375 모서리: 8px×2 ; gap(행 열): 8px 8px×1 ; 그림자: 없음 | 근거: A/shots/brief-empty-375.png.json
P5-196 | brief-empty-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/brief-empty-375.png.json
P5-197 | brief-empty-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-empty-375.png.json
P5-198 | brief-empty-375 글자색: #6b6b70=muted×3 | 근거: A/shots/brief-empty-375.png.json
P5-199 | brief-empty-375 배경색: 없음 | 근거: A/shots/brief-empty-375.png.json
P5-200 | brief-empty-375 테두리: 1px solid #ececee=line×2 | 근거: A/shots/brief-empty-375.png.json
P5-201 | brief-error-1280 글자 크기: 12px×40, 11px×17, 15px×13, 14px×8, 11.5px×6, 12.5px×5, 17px×5, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×60, 600×24, 700×14, 800×1 | 근거: A/shots/brief-error-1280.png.json
P5-202 | brief-error-1280 모서리: 50%×20, 999px×11, 4px×7, 8px×2, 10px×1 ; gap(행 열): 6px 6px×7, 8px 8px×6, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-error-1280.png.json
P5-203 | brief-error-1280 padding(위 오른 아래 왼): 4px 10px×9, 4px 0px×9, 2px 7px×7, 12px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-error-1280.png.json
P5-204 | brief-error-1280 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×5, -14px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 4px 2px×1, 14px 0px 4px 0px×1 | 근거: A/shots/brief-error-1280.png.json
P5-205 | brief-error-1280 글자색: #6b6b70=muted×31, transparent×10, #c2410c=accent+cat경제×9, #1d1d1f=fg+plot+durBg×6, #7c3aed=cat정치×5, #15803d=cat과학건강×3, #0f766e=cat사회×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-error-1280.png.json
P5-206 | brief-error-1280 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×3, #1d1d1f=fg+plot+durBg×1, #ececee=line×1 | 근거: A/shots/brief-error-1280.png.json
P5-207 | brief-error-1280 테두리: 1px solid #ececee=line×48, 1px solid #d1d1d6=ring×40, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-error-1280.png.json
P5-208 | brief-error-375 글자 크기: 12px×38, 11px×17, 15px×13, 14px×8, 11.5px×6, 12.5px×5, 17px×5, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×58, 600×24, 700×14, 800×1 | 근거: A/shots/brief-error-375.png.json
P5-209 | brief-error-375 모서리: 50%×20, 999px×9, 4px×7, 8px×2, 10px×1 ; gap(행 열): 6px 6px×7, 8px 8px×6, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-error-375.png.json
P5-210 | brief-error-375 padding(위 오른 아래 왼): 0px 12px×9, 4px 10px×7, 0px 12px 0px 0px×7, 2px 7px×7, 12px 3px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-error-375.png.json
P5-211 | brief-error-375 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×5, 0px 0px 0px auto×4, -14px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 2px 0px×1, 14px 0px 4px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-error-375.png.json
P5-212 | brief-error-375 글자색: #6b6b70=muted×29, transparent×10, #c2410c=accent+cat경제×9, #1d1d1f=fg+plot+durBg×6, #7c3aed=cat정치×5, #15803d=cat과학건강×3, #0f766e=cat사회×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-error-375.png.json
P5-213 | brief-error-375 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×3, #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/brief-error-375.png.json
P5-214 | brief-error-375 테두리: 1px solid #ececee=line×40, 1px solid #d1d1d6=ring×40, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-error-375.png.json
P5-215 | brief-loading-1280 글자 크기: 12px×11, 19px×1, 14px×1 ; 굵기: 400×12, 800×1 | 근거: A/shots/brief-loading-1280.png.json
P5-216 | brief-loading-1280 모서리: 8px×2, 50%×1 ; gap(행 열): 8px 8px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-loading-1280.png.json
P5-217 | brief-loading-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/brief-loading-1280.png.json
P5-218 | brief-loading-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1, 0px 8px 0px 0px×1 | 근거: A/shots/brief-loading-1280.png.json
P5-219 | brief-loading-1280 글자색: #6b6b70=muted×3 | 근거: A/shots/brief-loading-1280.png.json
P5-220 | brief-loading-1280 배경색: 없음 | 근거: A/shots/brief-loading-1280.png.json
P5-221 | brief-loading-1280 테두리: 2px solid #ececee=line×3, 1px solid #ececee=line×2, 2px solid #c2410c=accent+cat경제×1 | 근거: A/shots/brief-loading-1280.png.json
P5-222 | brief-loading-375 글자 크기: 12px×11, 19px×1, 14px×1 ; 굵기: 400×12, 800×1 | 근거: A/shots/brief-loading-375.png.json
P5-223 | brief-loading-375 모서리: 8px×2, 50%×1 ; gap(행 열): 8px 8px×1 ; 그림자: 없음 | 근거: A/shots/brief-loading-375.png.json
P5-224 | brief-loading-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/brief-loading-375.png.json
P5-225 | brief-loading-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1, 0px 8px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-loading-375.png.json
P5-226 | brief-loading-375 글자색: #6b6b70=muted×3 | 근거: A/shots/brief-loading-375.png.json
P5-227 | brief-loading-375 배경색: 없음 | 근거: A/shots/brief-loading-375.png.json
P5-228 | brief-loading-375 테두리: 2px solid #ececee=line×3, 1px solid #ececee=line×2, 2px solid #c2410c=accent+cat경제×1 | 근거: A/shots/brief-loading-375.png.json
P5-229 | brief-normal-1280-dark 글자색: #9a9aa0=muted×31, transparent×10, #fb923c=accent+cat경제×9, #ececee=fg+plot×6, #a78bfa=cat정치×5, #4ade80=cat과학건강×3, #2dd4bf=cat사회×2, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/brief-normal-1280-dark.png.json
P5-230 | brief-normal-1280-dark 배경색: #3a2414=accentbg×7, #222226=chip×3, #ececee=fg+plot×1, #2a2a2e=line×1 | 근거: A/shots/brief-normal-1280-dark.png.json
P5-231 | brief-normal-1280-dark 테두리: 1px solid #2a2a2e=line×48, 1px solid #3a3a3f=ring×40, 1px solid #ececee=fg+plot×4, 2px solid #ececee=fg+plot×1, 2px solid transparent×1 | 근거: A/shots/brief-normal-1280-dark.png.json
P5-232 | brief-normal-1280 글자 크기: 12px×40, 11px×17, 15px×13, 14px×8, 11.5px×6, 12.5px×5, 17px×5, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×60, 600×24, 700×14, 800×1 | 근거: A/shots/brief-normal-1280.png.json
P5-233 | brief-normal-1280 모서리: 50%×20, 999px×11, 4px×7, 8px×2, 10px×1 ; gap(행 열): 6px 6px×7, 8px 8px×6, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-normal-1280.png.json
P5-234 | brief-normal-1280 padding(위 오른 아래 왼): 4px 10px×9, 4px 0px×9, 2px 7px×7, 12px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-normal-1280.png.json
P5-235 | brief-normal-1280 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×5, -14px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 4px 2px×1, 14px 0px 4px 0px×1 | 근거: A/shots/brief-normal-1280.png.json
P5-236 | brief-normal-1280 글자색: #6b6b70=muted×31, transparent×10, #c2410c=accent+cat경제×9, #1d1d1f=fg+plot+durBg×6, #7c3aed=cat정치×5, #15803d=cat과학건강×3, #0f766e=cat사회×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-normal-1280.png.json
P5-237 | brief-normal-1280 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×3, #1d1d1f=fg+plot+durBg×1, #ececee=line×1 | 근거: A/shots/brief-normal-1280.png.json
P5-238 | brief-normal-1280 테두리: 1px solid #ececee=line×48, 1px solid #d1d1d6=ring×40, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-normal-1280.png.json
P5-239 | brief-normal-375-dark 글자색: #9a9aa0=muted×29, transparent×10, #fb923c=accent+cat경제×9, #ececee=fg+plot×6, #a78bfa=cat정치×5, #4ade80=cat과학건강×3, #2dd4bf=cat사회×2, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/brief-normal-375-dark.png.json
P5-240 | brief-normal-375-dark 배경색: #3a2414=accentbg×7, #222226=chip×3, #ececee=fg+plot×1 | 근거: A/shots/brief-normal-375-dark.png.json
P5-241 | brief-normal-375-dark 테두리: 1px solid #2a2a2e=line×40, 1px solid #3a3a3f=ring×40, 1px solid #ececee=fg+plot×4, 2px solid #ececee=fg+plot×1, 2px solid transparent×1 | 근거: A/shots/brief-normal-375-dark.png.json
P5-242 | brief-normal-375 글자 크기: 12px×38, 11px×17, 15px×13, 14px×8, 11.5px×6, 12.5px×5, 17px×5, 18px×2, 19px×1, 13px×1, 13.5px×1 ; 굵기: 400×58, 600×24, 700×14, 800×1 | 근거: A/shots/brief-normal-375.png.json
P5-243 | brief-normal-375 모서리: 50%×20, 999px×9, 4px×7, 8px×2, 10px×1 ; gap(행 열): 6px 6px×7, 8px 8px×6, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-normal-375.png.json
P5-244 | brief-normal-375 padding(위 오른 아래 왼): 0px 12px×9, 4px 10px×7, 0px 12px 0px 0px×7, 2px 7px×7, 12px 3px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 12px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-normal-375.png.json
P5-245 | brief-normal-375 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×5, 0px 0px 0px auto×4, -14px 0px×3, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 8px 0px 0px 0px×1, 10px 18px 4px 18px×1, 2px 0px×1, 14px 0px 4px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-normal-375.png.json
P5-246 | brief-normal-375 글자색: #6b6b70=muted×29, transparent×10, #c2410c=accent+cat경제×9, #1d1d1f=fg+plot+durBg×6, #7c3aed=cat정치×5, #15803d=cat과학건강×3, #0f766e=cat사회×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/brief-normal-375.png.json
P5-247 | brief-normal-375 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×3, #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/brief-normal-375.png.json
P5-248 | brief-normal-375 테두리: 1px solid #ececee=line×40, 1px solid #d1d1d6=ring×40, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-normal-375.png.json
P5-249 | brief-open-1280 글자 크기: 12px×45, 14px×24, 11px×20, 12.5px×13, 15px×13, 13px×11, 11.5px×6, 17px×4, 18px×2, 19px×1, 13.5px×1, 21px×1, 15.5px×1 ; 굵기: 400×87, 600×27, 700×27, 800×1 | 근거: A/shots/brief-open-1280.png.json
P5-250 | brief-open-1280 모서리: 50%×20, 999px×15, 4px×7, 8px×2, 10px×2, 6px×2 ; gap(행 열): 6px 6px×10, 8px 8px×9, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-open-1280.png.json
P5-251 | brief-open-1280 padding(위 오른 아래 왼): 4px 10px×9, 4px 0px×9, 12px×8, 2px 7px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 5px 10px×4, 3px 0px×3, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 8px×2, 12px 0px×2, 0px 18px×2, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 0px 18px 16px 18px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-open-1280.png.json
P5-252 | brief-open-1280 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, 14px 0px 4px 0px×9, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×6, 4px 0px 0px 0px×3, -2px 0px×3, 0px 6px 0px 0px×3, -14px 0px×3, -6px×2, 8px 0px 0px 0px×2, -9px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 4px 2px×1, 12px 0px×1, -13px 0px×1, 16px 0px 0px 0px×1, 0px 0px 0px 4px×1, 9px 0px 0px 0px×1 | 근거: A/shots/brief-open-1280.png.json
P5-253 | brief-open-1280 글자색: #6b6b70=muted×45, #1d1d1f=fg+plot+durBg×9, #c2410c=accent+cat경제×9, transparent×9, #7c3aed=cat정치×5, #15803d=cat과학건강×3, #ffffff=bg+checkInk+onAccent+durFg×2, #0f766e=cat사회×2 | 근거: A/shots/brief-open-1280.png.json
P5-254 | brief-open-1280 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×4, #1d1d1f=fg+plot+durBg×1, #ececee=line×1, #3b7fd0=check×1 | 근거: A/shots/brief-open-1280.png.json
P5-255 | brief-open-1280 테두리: 1px solid #ececee=line×64, 1px solid #d1d1d6=ring×36, 1px solid #1d1d1f=fg+plot+durBg×4, 1px solid #3b7fd0=check×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-open-1280.png.json
P5-256 | brief-open-375 글자 크기: 12px×43, 14px×24, 11px×20, 15px×14, 12.5px×13, 13px×11, 11.5px×6, 17px×4, 18px×2, 19px×1, 13.5px×1, 21px×1, 15.5px×1 ; 굵기: 400×85, 700×28, 600×27, 800×1 | 근거: A/shots/brief-open-375.png.json
P5-257 | brief-open-375 모서리: 50%×20, 999px×13, 4px×7, 8px×3, 10px×2, 6px×2 ; gap(행 열): 6px 6px×10, 8px 8px×9, 10px 10px×2, 6px 8px×2, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-open-375.png.json
P5-258 | brief-open-375 padding(위 오른 아래 왼): 0px 12px×9, 4px 10px×7, 0px 12px 0px 0px×7, 2px 7px×7, 12px 3px×7, 14px 0px 14px 18px×5, 12px 0px 12px 18px×5, 11px 0px×5, 5px 10px×4, 3px 0px×3, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 0px 8px×2, 12px 0px×2, 0px 18px×2, 12px 16px×1, 10px 12px 6px 18px×1, 0px 2px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 12px 18px×1, 0px 18px 16px 18px×1, 12px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-open-375.png.json
P5-259 | brief-open-375 margin: 6px 0px 0px 0px×12, 6px 4px 0px 0px×10, 14px 0px 4px 0px×9, -6px 0px -7px 0px×7, -11px 0px×6, 0px 0px 4px 0px×6, 0px 0px 0px auto×4, 4px 0px 0px 0px×3, -2px 0px×3, 0px 6px 0px 0px×3, -14px 0px×3, -6px×2, 8px 0px 0px 0px×2, -9px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 2px 0px×1, 12px 0px×1, -13px 0px×1, 16px 0px 0px 0px×1, 0px 0px 0px 4px×1, 9px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-open-375.png.json
P5-260 | brief-open-375 글자색: #6b6b70=muted×43, #1d1d1f=fg+plot+durBg×9, #c2410c=accent+cat경제×9, transparent×9, #7c3aed=cat정치×5, #ffffff=bg+checkInk+onAccent+durFg×3, #15803d=cat과학건강×3, #0f766e=cat사회×2 | 근거: A/shots/brief-open-375.png.json
P5-261 | brief-open-375 배경색: #fff1e8=accentbg×7, #f5f5f7=chip×4, #c2410c=accent+cat경제×1, #1d1d1f=fg+plot+durBg×1, #3b7fd0=check×1 | 근거: A/shots/brief-open-375.png.json
P5-262 | brief-open-375 테두리: 1px solid #ececee=line×56, 1px solid #d1d1d6=ring×36, 1px solid #1d1d1f=fg+plot+durBg×4, 1px solid #3b7fd0=check×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-open-375.png.json
P5-263 | brief-videos-1280 글자 크기: 13px×22, 11.5px×21, 12px×19, 10.5px×18, 16px×9, 11px×9, 15px×8, 12.5px×4, 14px×3, 18px×2, 19px×1 ; 굵기: 400×70, 600×23, 700×22, 800×1 | 근거: A/shots/brief-videos-1280.png.json
P5-264 | brief-videos-1280 모서리: 8px×11, 6px×9, 3px×9, 4px×9, 999px×6, 10px×1 ; gap(행 열): normal 14px×9, 6px 6px×2, 10px 10px×2, normal 16px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-videos-1280.png.json
P5-265 | brief-videos-1280 padding(위 오른 아래 왼): 10px 0px×9, 0px 4px×9, 1px 6px×9, 7px 10px×9, 4px 0px×9, 0px 2px×7, 12px×7, 4px 10px×4, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 0px 18px×1, 0px 0px 6px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-videos-1280.png.json
P5-266 | brief-videos-1280 margin: 8px 0px 0px 0px×11, 3px 0px 0px 0px×9, 0px 4px 0px 0px×9, 0px 6px 0px 0px×9, -6px 0px -7px 0px×7, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1 | 근거: A/shots/brief-videos-1280.png.json
P5-267 | brief-videos-1280 글자색: #c2410c=accent+cat경제×27, #6b6b70=muted×22, #ffffff=bg+checkInk+onAccent+durFg×10, #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/brief-videos-1280.png.json
P5-268 | brief-videos-1280 배경색: #f5f5f7=chip×12, #1d1d1f=fg+plot+durBg×10, #d9d9de=thumb×9, #fff1e8=accentbg×9 | 근거: A/shots/brief-videos-1280.png.json
P5-269 | brief-videos-1280 테두리: 1px solid #ececee=line×26, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-videos-1280.png.json
P5-270 | brief-videos-375 글자 크기: 13px×22, 11.5px×21, 12px×19, 10.5px×18, 14px×12, 11px×9, 15px×8, 12.5px×4, 18px×2, 19px×1 ; 굵기: 400×70, 600×23, 700×22, 800×1 | 근거: A/shots/brief-videos-375.png.json
P5-271 | brief-videos-375 모서리: 8px×11, 6px×9, 3px×9, 4px×9, 999px×6, 10px×1 ; gap(행 열): normal 10px×9, 6px 6px×2, 10px 10px×2, normal 16px×2, 8px 8px×1, 4px 4px×1, 14px 14px×1 ; 그림자: 없음 | 근거: A/shots/brief-videos-375.png.json
P5-272 | brief-videos-375 padding(위 오른 아래 왼): 10px 0px×9, 0px 4px×9, 1px 6px×9, 7px 10px×9, 0px 12px×9, 0px 2px×7, 12px 3px×7, 4px 10px×4, 3px 8px×2, 5px 0px×2, 1px 0px 0px 0px×2, 10px 12px 6px 18px×1, 0px 0px 8px 0px×1, 14px 18px×1, 8px 12px 6px 12px×1, 6px 0px×1, 10px 18px×1, 0px 18px×1, 0px 0px 6px 0px×1, 20px 18px 24px 18px×1, 6px 0px 10px 0px×1 | 근거: A/shots/brief-videos-375.png.json
P5-273 | brief-videos-375 margin: 8px 0px 0px 0px×11, 3px 0px 0px 0px×9, 0px 4px 0px 0px×9, 0px 6px 0px 0px×9, -6px 0px -7px 0px×7, -6px×2, 0px 0px 8px 0px×2, 0px auto×1, -11px 0px×1, -8px 0px×1, -3px -3px -3px -7px×1, 10px 18px 4px 18px×1, 0px 0px 0px auto×1, 2px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/brief-videos-375.png.json
P5-274 | brief-videos-375 글자색: #c2410c=accent+cat경제×27, #6b6b70=muted×22, #ffffff=bg+checkInk+onAccent+durFg×10, #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/brief-videos-375.png.json
P5-275 | brief-videos-375 배경색: #f5f5f7=chip×12, #1d1d1f=fg+plot+durBg×10, #d9d9de=thumb×9, #fff1e8=accentbg×9 | 근거: A/shots/brief-videos-375.png.json
P5-276 | brief-videos-375 테두리: 1px solid #ececee=line×26, 1px solid #1d1d1f=fg+plot+durBg×4, 2px solid #1d1d1f=fg+plot+durBg×1, 2px solid transparent×1 | 근거: A/shots/brief-videos-375.png.json
P5-277 | dates-normal-1280-dark 글자색: #9a9aa0=muted×5 | 근거: A/shots/dates-normal-1280-dark.png.json
P5-278 | dates-normal-1280-dark 배경색: 없음 | 근거: A/shots/dates-normal-1280-dark.png.json
P5-279 | dates-normal-1280-dark 테두리: 1px solid #2a2a2e=line×20 | 근거: A/shots/dates-normal-1280-dark.png.json
P5-280 | dates-normal-1280 글자 크기: 16px×18, 12px×11, 14px×2, 12.5px×2, 22px×1 ; 굵기: 400×31, 700×2, 800×1 | 근거: A/shots/dates-normal-1280.png.json
P5-281 | dates-normal-1280 모서리: 8px×2 ; gap(행 열): 8px 8px×19, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/dates-normal-1280.png.json
P5-282 | dates-normal-1280 padding(위 오른 아래 왼): 13px 18px×18, 4px 0px×9, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/dates-normal-1280.png.json
P5-283 | dates-normal-1280 margin: 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/dates-normal-1280.png.json
P5-284 | dates-normal-1280 글자색: #6b6b70=muted×5 | 근거: A/shots/dates-normal-1280.png.json
P5-285 | dates-normal-1280 배경색: 없음 | 근거: A/shots/dates-normal-1280.png.json
P5-286 | dates-normal-1280 테두리: 1px solid #ececee=line×20 | 근거: A/shots/dates-normal-1280.png.json
P5-287 | dates-normal-375-dark 글자색: #9a9aa0=muted×5 | 근거: A/shots/dates-normal-375-dark.png.json
P5-288 | dates-normal-375-dark 배경색: 없음 | 근거: A/shots/dates-normal-375-dark.png.json
P5-289 | dates-normal-375-dark 테두리: 1px solid #2a2a2e=line×20 | 근거: A/shots/dates-normal-375-dark.png.json
P5-290 | dates-normal-375 글자 크기: 16px×18, 12px×11, 14px×2, 12.5px×2, 22px×1 ; 굵기: 400×31, 700×2, 800×1 | 근거: A/shots/dates-normal-375.png.json
P5-291 | dates-normal-375 모서리: 8px×2 ; gap(행 열): 8px 8px×19, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/dates-normal-375.png.json
P5-292 | dates-normal-375 padding(위 오른 아래 왼): 13px 18px×18, 0px 12px×9, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/dates-normal-375.png.json
P5-293 | dates-normal-375 margin: 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/dates-normal-375.png.json
P5-294 | dates-normal-375 글자색: #6b6b70=muted×5 | 근거: A/shots/dates-normal-375.png.json
P5-295 | dates-normal-375 배경색: 없음 | 근거: A/shots/dates-normal-375.png.json
P5-296 | dates-normal-375 테두리: 1px solid #ececee=line×20 | 근거: A/shots/dates-normal-375.png.json
P5-297 | entities-big-1280 글자 크기: 12px×315, 11.5px×298, 15px×298, 14px×2, 22px×1 ; 굵기: 600×596, 400×317, 800×1 | 근거: A/shots/entities-big-1280.png.json
P5-298 | entities-big-1280 모서리: 999px×4, 8px×2 ; gap(행 열): 6px 6px×299, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/entities-big-1280.png.json
P5-299 | entities-big-1280 padding(위 오른 아래 왼): 14px 18px×298, 4px 0px×9, 4px 10px×4, 10px 18px 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entities-big-1280.png.json
P5-300 | entities-big-1280 margin: 0px 0px 4px 0px×298, 6px 0px 0px 0px×298, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/entities-big-1280.png.json
P5-301 | entities-big-1280 글자색: #6b6b70=muted×604, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/entities-big-1280.png.json
P5-302 | entities-big-1280 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/entities-big-1280.png.json
P5-303 | entities-big-1280 테두리: 1px solid #ececee=line×313, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/entities-big-1280.png.json
P5-304 | entities-big-375 글자 크기: 12px×315, 11.5px×298, 15px×298, 14px×2, 22px×1 ; 굵기: 600×596, 400×317, 800×1 | 근거: A/shots/entities-big-375.png.json
P5-305 | entities-big-375 모서리: 999px×4, 8px×2 ; gap(행 열): 6px 6px×299, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/entities-big-375.png.json
P5-306 | entities-big-375 padding(위 오른 아래 왼): 14px 18px×298, 0px 12px×9, 4px 10px×4, 10px 18px 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entities-big-375.png.json
P5-307 | entities-big-375 margin: 0px 0px 4px 0px×298, 6px 0px 0px 0px×298, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/entities-big-375.png.json
P5-308 | entities-big-375 글자색: #6b6b70=muted×604, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/entities-big-375.png.json
P5-309 | entities-big-375 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/entities-big-375.png.json
P5-310 | entities-big-375 테두리: 1px solid #ececee=line×313, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/entities-big-375.png.json
P5-311 | entities-normal-1280-dark 글자색: #9a9aa0=muted×64, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/entities-normal-1280-dark.png.json
P5-312 | entities-normal-1280-dark 배경색: #ececee=fg+plot×1 | 근거: A/shots/entities-normal-1280-dark.png.json
P5-313 | entities-normal-1280-dark 테두리: 1px solid #2a2a2e=line×43, 1px solid #ececee=fg+plot×4 | 근거: A/shots/entities-normal-1280-dark.png.json
P5-314 | entities-normal-1280 글자 크기: 12px×45, 11.5px×28, 15px×28, 14px×2, 22px×1 ; 굵기: 600×56, 400×47, 800×1 | 근거: A/shots/entities-normal-1280.png.json
P5-315 | entities-normal-1280 모서리: 999px×4, 8px×2 ; gap(행 열): 6px 6px×29, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/entities-normal-1280.png.json
P5-316 | entities-normal-1280 padding(위 오른 아래 왼): 14px 18px×28, 4px 0px×9, 4px 10px×4, 10px 18px 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entities-normal-1280.png.json
P5-317 | entities-normal-1280 margin: 0px 0px 4px 0px×28, 6px 0px 0px 0px×28, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/entities-normal-1280.png.json
P5-318 | entities-normal-1280 글자색: #6b6b70=muted×64, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/entities-normal-1280.png.json
P5-319 | entities-normal-1280 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/entities-normal-1280.png.json
P5-320 | entities-normal-1280 테두리: 1px solid #ececee=line×43, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/entities-normal-1280.png.json
P5-321 | entities-normal-375-dark 글자색: #9a9aa0=muted×64, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/entities-normal-375-dark.png.json
P5-322 | entities-normal-375-dark 배경색: #ececee=fg+plot×1 | 근거: A/shots/entities-normal-375-dark.png.json
P5-323 | entities-normal-375-dark 테두리: 1px solid #2a2a2e=line×43, 1px solid #ececee=fg+plot×4 | 근거: A/shots/entities-normal-375-dark.png.json
P5-324 | entities-normal-375 글자 크기: 12px×45, 11.5px×28, 15px×28, 14px×2, 22px×1 ; 굵기: 600×56, 400×47, 800×1 | 근거: A/shots/entities-normal-375.png.json
P5-325 | entities-normal-375 모서리: 999px×4, 8px×2 ; gap(행 열): 6px 6px×29, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/entities-normal-375.png.json
P5-326 | entities-normal-375 padding(위 오른 아래 왼): 14px 18px×28, 0px 12px×9, 4px 10px×4, 10px 18px 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entities-normal-375.png.json
P5-327 | entities-normal-375 margin: 0px 0px 4px 0px×28, 6px 0px 0px 0px×28, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/entities-normal-375.png.json
P5-328 | entities-normal-375 글자색: #6b6b70=muted×64, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/entities-normal-375.png.json
P5-329 | entities-normal-375 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/entities-normal-375.png.json
P5-330 | entities-normal-375 테두리: 1px solid #ececee=line×43, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/entities-normal-375.png.json
P5-331 | entity-normal-1280-dark 글자색: #9a9aa0=muted×47 | 근거: A/shots/entity-normal-1280-dark.png.json
P5-332 | entity-normal-1280-dark 배경색: #222226=chip×2 | 근거: A/shots/entity-normal-1280-dark.png.json
P5-333 | entity-normal-1280-dark 테두리: 1px solid #2a2a2e=line×110 | 근거: A/shots/entity-normal-1280-dark.png.json
P5-334 | entity-normal-1280 글자 크기: 12px×32, 13px×20, 11px×20, 14.5px×20, 14px×4, 12.5px×2, 11.5px×1, 22px×1 ; 굵기: 400×76, 600×21, 700×2, 800×1 | 근거: A/shots/entity-normal-1280.png.json
P5-335 | entity-normal-1280 모서리: 999px×20, 8px×4 ; gap(행 열): 8px 8px×21, 4px 4px×1, 6px 6px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/entity-normal-1280.png.json
P5-336 | entity-normal-1280 padding(위 오른 아래 왼): 5px 10px×20, 10px 0px×20, 4px 0px×9, 12px 0px×2, 8px 16px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entity-normal-1280.png.json
P5-337 | entity-normal-1280 margin: 0px 0px 0px 4px×20, -2px 0px×20, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 4px 0px×1, 6px 0px 12px 0px×1, 4px 0px 0px 0px×1 | 근거: A/shots/entity-normal-1280.png.json
P5-338 | entity-normal-1280 글자색: #6b6b70=muted×47 | 근거: A/shots/entity-normal-1280.png.json
P5-339 | entity-normal-1280 배경색: #f5f5f7=chip×2 | 근거: A/shots/entity-normal-1280.png.json
P5-340 | entity-normal-1280 테두리: 1px solid #ececee=line×110 | 근거: A/shots/entity-normal-1280.png.json
P5-341 | entity-normal-375-dark 글자색: #9a9aa0=muted×47 | 근거: A/shots/entity-normal-375-dark.png.json
P5-342 | entity-normal-375-dark 배경색: #222226=chip×2 | 근거: A/shots/entity-normal-375-dark.png.json
P5-343 | entity-normal-375-dark 테두리: 1px solid #2a2a2e=line×110 | 근거: A/shots/entity-normal-375-dark.png.json
P5-344 | entity-normal-375 글자 크기: 12px×32, 13px×20, 11px×20, 14.5px×20, 14px×4, 12.5px×2, 11.5px×1, 22px×1 ; 굵기: 400×76, 600×21, 700×2, 800×1 | 근거: A/shots/entity-normal-375.png.json
P5-345 | entity-normal-375 모서리: 999px×20, 8px×4 ; gap(행 열): 8px 8px×21, 4px 4px×1, 6px 6px×1 ; 그림자: 없음 | 근거: A/shots/entity-normal-375.png.json
P5-346 | entity-normal-375 padding(위 오른 아래 왼): 5px 10px×20, 10px 0px×20, 0px 12px×9, 12px 0px×2, 8px 16px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/entity-normal-375.png.json
P5-347 | entity-normal-375 margin: 0px 0px 0px 4px×20, -2px 0px×20, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 4px 0px×1, 6px 0px 12px 0px×1, 4px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/entity-normal-375.png.json
P5-348 | entity-normal-375 글자색: #6b6b70=muted×47 | 근거: A/shots/entity-normal-375.png.json
P5-349 | entity-normal-375 배경색: #f5f5f7=chip×2 | 근거: A/shots/entity-normal-375.png.json
P5-350 | entity-normal-375 테두리: 1px solid #ececee=line×110 | 근거: A/shots/entity-normal-375.png.json
P5-351 | indicator-normal-1280-dark 글자색: #9a9aa0=muted×9, #ececee=fg+plot×1, #7aa7ff=down×1 | 근거: A/shots/indicator-normal-1280-dark.png.json
P5-352 | indicator-normal-1280-dark 배경색: #222226=chip×1 | 근거: A/shots/indicator-normal-1280-dark.png.json
P5-353 | indicator-normal-1280-dark 테두리: 1px solid #2a2a2e=line×7 | 근거: A/shots/indicator-normal-1280-dark.png.json
P5-354 | indicator-normal-1280 글자 크기: 12px×14, 10px×6, 13px×3, 14px×2, 22px×1, 15px×1, 12.5px×1, 14.5px×1, 11.5px×1 ; 굵기: 400×25, 700×3, 600×1, 800×1 | 근거: A/shots/indicator-normal-1280.png.json
P5-355 | indicator-normal-1280 모서리: 8px×3, 4px×1 ; gap(행 열): 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/indicator-normal-1280.png.json
P5-356 | indicator-normal-1280 padding(위 오른 아래 왼): 4px 0px×9, 8px 0px×3, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 10px 0px×1, 20px 18px 24px 18px×1 | 근거: A/shots/indicator-normal-1280.png.json
P5-357 | indicator-normal-1280 margin: 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 6px 0px×1, 10px 0px 6px 0px×1, 4px 0px×1, 0px 0px 2px 0px×1, 14px 0px 4px 0px×1, 18px 0px 0px 0px×1, 6px 0px 0px 0px×1 | 근거: A/shots/indicator-normal-1280.png.json
P5-358 | indicator-normal-1280 글자색: #6b6b70=muted×9, #1d1d1f=fg+plot+durBg×1, #1d4ed8=down+catITAI×1 | 근거: A/shots/indicator-normal-1280.png.json
P5-359 | indicator-normal-1280 배경색: #f5f5f7=chip×1 | 근거: A/shots/indicator-normal-1280.png.json
P5-360 | indicator-normal-1280 테두리: 1px solid #ececee=line×7 | 근거: A/shots/indicator-normal-1280.png.json
P5-361 | indicator-normal-375-dark 글자색: #9a9aa0=muted×9, #ececee=fg+plot×1, #7aa7ff=down×1 | 근거: A/shots/indicator-normal-375-dark.png.json
P5-362 | indicator-normal-375-dark 배경색: #222226=chip×1 | 근거: A/shots/indicator-normal-375-dark.png.json
P5-363 | indicator-normal-375-dark 테두리: 1px solid #2a2a2e=line×7 | 근거: A/shots/indicator-normal-375-dark.png.json
P5-364 | indicator-normal-375 글자 크기: 12px×14, 10px×6, 13px×3, 14px×2, 22px×1, 15px×1, 12.5px×1, 14.5px×1, 11.5px×1 ; 굵기: 400×25, 700×3, 600×1, 800×1 | 근거: A/shots/indicator-normal-375.png.json
P5-365 | indicator-normal-375 모서리: 8px×3, 4px×1 ; gap(행 열): 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/indicator-normal-375.png.json
P5-366 | indicator-normal-375 padding(위 오른 아래 왼): 0px 12px×9, 8px 0px×3, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 10px 0px×1, 20px 18px 24px 18px×1 | 근거: A/shots/indicator-normal-375.png.json
P5-367 | indicator-normal-375 margin: 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 6px 0px×1, 10px 0px 6px 0px×1, 4px 0px×1, 0px 0px 2px 0px×1, 14px 0px 4px 0px×1, 18px 0px 0px 0px×1, 6px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/indicator-normal-375.png.json
P5-368 | indicator-normal-375 글자색: #6b6b70=muted×9, #1d1d1f=fg+plot+durBg×1, #1d4ed8=down+catITAI×1 | 근거: A/shots/indicator-normal-375.png.json
P5-369 | indicator-normal-375 배경색: #f5f5f7=chip×1 | 근거: A/shots/indicator-normal-375.png.json
P5-370 | indicator-normal-375 테두리: 1px solid #ececee=line×7 | 근거: A/shots/indicator-normal-375.png.json
P5-371 | indicators-normal-1280-dark 글자색: #9a9aa0=muted×23, #7aa7ff=down×4, #f87171=up+cat국제×3, #fb923c=accent+cat경제×1 | 근거: A/shots/indicators-normal-1280-dark.png.json
P5-372 | indicators-normal-1280-dark 배경색: 없음 | 근거: A/shots/indicators-normal-1280-dark.png.json
P5-373 | indicators-normal-1280-dark 테두리: 1px solid #2a2a2e=line×42 | 근거: A/shots/indicators-normal-1280-dark.png.json
P5-374 | indicators-normal-1280 글자 크기: 12px×22, 11.5px×20, 17px×10, 14px×2, 12.5px×2, 22px×1 ; 굵기: 400×44, 700×12, 800×1 | 근거: A/shots/indicators-normal-1280.png.json
P5-375 | indicators-normal-1280 모서리: 10px×10, 8px×2 ; gap(행 열): 8px 8px×3, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/indicators-normal-1280.png.json
P5-376 | indicators-normal-1280 padding(위 오른 아래 왼): 10px 10px 6px 10px×10, 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/indicators-normal-1280.png.json
P5-377 | indicators-normal-1280 margin: 1px 0px 0px 0px×10, 4px 0px 0px 0px×10, 0px 0px 8px 0px×3, 14px 0px 4px 0px×2, 6px 0px 0px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 6px 0px×1, 18px 0px 0px 0px×1 | 근거: A/shots/indicators-normal-1280.png.json
P5-378 | indicators-normal-1280 글자색: #6b6b70=muted×23, #1d4ed8=down+catITAI×4, #c62828=up×3, #c2410c=accent+cat경제×1 | 근거: A/shots/indicators-normal-1280.png.json
P5-379 | indicators-normal-1280 배경색: 없음 | 근거: A/shots/indicators-normal-1280.png.json
P5-380 | indicators-normal-1280 테두리: 1px solid #ececee=line×42 | 근거: A/shots/indicators-normal-1280.png.json
P5-381 | indicators-normal-375-dark 글자색: #9a9aa0=muted×23, #7aa7ff=down×4, #f87171=up+cat국제×3, #fb923c=accent+cat경제×1 | 근거: A/shots/indicators-normal-375-dark.png.json
P5-382 | indicators-normal-375-dark 배경색: 없음 | 근거: A/shots/indicators-normal-375-dark.png.json
P5-383 | indicators-normal-375-dark 테두리: 1px solid #2a2a2e=line×42 | 근거: A/shots/indicators-normal-375-dark.png.json
P5-384 | indicators-normal-375 글자 크기: 12px×22, 11.5px×20, 17px×10, 14px×2, 12.5px×2, 22px×1 ; 굵기: 400×44, 700×12, 800×1 | 근거: A/shots/indicators-normal-375.png.json
P5-385 | indicators-normal-375 모서리: 10px×10, 8px×2 ; gap(행 열): 8px 8px×3, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/indicators-normal-375.png.json
P5-386 | indicators-normal-375 padding(위 오른 아래 왼): 10px 10px 6px 10px×10, 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/indicators-normal-375.png.json
P5-387 | indicators-normal-375 margin: 1px 0px 0px 0px×10, 4px 0px 0px 0px×10, 0px 0px 8px 0px×3, 14px 0px 4px 0px×2, 6px 0px 0px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 6px 0px×1, 18px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/indicators-normal-375.png.json
P5-388 | indicators-normal-375 글자색: #6b6b70=muted×23, #1d4ed8=down+catITAI×4, #c62828=up×3, #c2410c=accent+cat경제×1 | 근거: A/shots/indicators-normal-375.png.json
P5-389 | indicators-normal-375 배경색: 없음 | 근거: A/shots/indicators-normal-375.png.json
P5-390 | indicators-normal-375 테두리: 1px solid #ececee=line×42 | 근거: A/shots/indicators-normal-375.png.json
P5-391 | issue-loading-1280 글자 크기: 12px×11, 14px×3 ; 굵기: 400×14 | 근거: A/shots/issue-loading-1280.png.json
P5-392 | issue-loading-1280 모서리: 8px×2, 50%×1 ; gap(행 열): 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/issue-loading-1280.png.json
P5-393 | issue-loading-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issue-loading-1280.png.json
P5-394 | issue-loading-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 8px 0px 0px×1 | 근거: A/shots/issue-loading-1280.png.json
P5-395 | issue-loading-1280 글자색: #6b6b70=muted×4 | 근거: A/shots/issue-loading-1280.png.json
P5-396 | issue-loading-1280 배경색: 없음 | 근거: A/shots/issue-loading-1280.png.json
P5-397 | issue-loading-1280 테두리: 2px solid #ececee=line×3, 1px solid #ececee=line×2, 2px solid #c2410c=accent+cat경제×1 | 근거: A/shots/issue-loading-1280.png.json
P5-398 | issue-loading-375 글자 크기: 12px×11, 14px×3 ; 굵기: 400×14 | 근거: A/shots/issue-loading-375.png.json
P5-399 | issue-loading-375 모서리: 8px×2, 50%×1 ; gap(행 열): 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/issue-loading-375.png.json
P5-400 | issue-loading-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issue-loading-375.png.json
P5-401 | issue-loading-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 8px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/issue-loading-375.png.json
P5-402 | issue-loading-375 글자색: #6b6b70=muted×4 | 근거: A/shots/issue-loading-375.png.json
P5-403 | issue-loading-375 배경색: 없음 | 근거: A/shots/issue-loading-375.png.json
P5-404 | issue-loading-375 테두리: 2px solid #ececee=line×3, 1px solid #ececee=line×2, 2px solid #c2410c=accent+cat경제×1 | 근거: A/shots/issue-loading-375.png.json
P5-405 | issue-normal-1280-dark 글자색: #9a9aa0=muted×33, #4ade80=cat과학건강×1 | 근거: A/shots/issue-normal-1280-dark.png.json
P5-406 | issue-normal-1280-dark 배경색: #222226=chip×1 | 근거: A/shots/issue-normal-1280-dark.png.json
P5-407 | issue-normal-1280-dark 테두리: 1px solid #2a2a2e=line×50, 3px solid #fb923c=accent+cat경제×1 | 근거: A/shots/issue-normal-1280-dark.png.json
P5-408 | issue-normal-1280 글자 크기: 12px×27, 14.5px×15, 13px×13, 11px×10, 14px×3, 12.5px×3, 11.5px×1, 22px×1 ; 굵기: 400×53, 600×16, 700×3, 800×1 | 근거: A/shots/issue-normal-1280.png.json
P5-409 | issue-normal-1280 모서리: 999px×12, 8px×2, 0px 8px 8px 0px×1 ; gap(행 열): 8px 8px×16, 6px 6px×2, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/issue-normal-1280.png.json
P5-410 | issue-normal-1280 padding(위 오른 아래 왼): 0px 0px 14px 0px×15, 5px 10px×12, 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 12px 14px×1, 0px 0px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issue-normal-1280.png.json
P5-411 | issue-normal-1280 margin: -2px 0px×15, 0px 0px 0px 4px×10, 4px 0px 0px 0px×3, 14px 0px 4px 0px×3, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 4px 0px×1, 6px 0px 12px 0px×1, 8px 0px 0px 0px×1 | 근거: A/shots/issue-normal-1280.png.json
P5-412 | issue-normal-1280 글자색: #6b6b70=muted×33, #15803d=cat과학건강×1 | 근거: A/shots/issue-normal-1280.png.json
P5-413 | issue-normal-1280 배경색: #f5f5f7=chip×1 | 근거: A/shots/issue-normal-1280.png.json
P5-414 | issue-normal-1280 테두리: 1px solid #ececee=line×50, 3px solid #c2410c=accent+cat경제×1 | 근거: A/shots/issue-normal-1280.png.json
P5-415 | issue-normal-375-dark 글자색: #9a9aa0=muted×33, #4ade80=cat과학건강×1 | 근거: A/shots/issue-normal-375-dark.png.json
P5-416 | issue-normal-375-dark 배경색: #222226=chip×1 | 근거: A/shots/issue-normal-375-dark.png.json
P5-417 | issue-normal-375-dark 테두리: 1px solid #2a2a2e=line×50, 3px solid #fb923c=accent+cat경제×1 | 근거: A/shots/issue-normal-375-dark.png.json
P5-418 | issue-normal-375 글자 크기: 12px×27, 14.5px×15, 13px×13, 11px×10, 14px×3, 12.5px×3, 11.5px×1, 22px×1 ; 굵기: 400×53, 600×16, 700×3, 800×1 | 근거: A/shots/issue-normal-375.png.json
P5-419 | issue-normal-375 모서리: 999px×12, 8px×2, 0px 8px 8px 0px×1 ; gap(행 열): 8px 8px×16, 6px 6px×2, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/issue-normal-375.png.json
P5-420 | issue-normal-375 padding(위 오른 아래 왼): 0px 0px 14px 0px×15, 5px 10px×12, 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 12px 14px×1, 0px 0px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issue-normal-375.png.json
P5-421 | issue-normal-375 margin: -2px 0px×15, 0px 0px 0px 4px×10, 4px 0px 0px 0px×3, 14px 0px 4px 0px×3, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 4px 0px×1, 6px 0px 12px 0px×1, 8px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/issue-normal-375.png.json
P5-422 | issue-normal-375 글자색: #6b6b70=muted×33, #15803d=cat과학건강×1 | 근거: A/shots/issue-normal-375.png.json
P5-423 | issue-normal-375 배경색: #f5f5f7=chip×1 | 근거: A/shots/issue-normal-375.png.json
P5-424 | issue-normal-375 테두리: 1px solid #ececee=line×50, 3px solid #c2410c=accent+cat경제×1 | 근거: A/shots/issue-normal-375.png.json
P5-425 | issues-big-1280 글자 크기: 12px×123, 11.5px×100, 17px×100, 14px×3, 22px×1 ; 굵기: 400×126, 600×100, 700×100, 800×1 | 근거: A/shots/issues-big-1280.png.json
P5-426 | issues-big-1280 모서리: 999px×11, 8px×3 ; gap(행 열): 6px 6px×102, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/issues-big-1280.png.json
P5-427 | issues-big-1280 padding(위 오른 아래 왼): 14px 18px×100, 4px 10px×11, 4px 0px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 16px 18px×1, 8px 16px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-big-1280.png.json
P5-428 | issues-big-1280 margin: 0px 0px 4px 0px×100, 6px 0px 0px 0px×100, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/issues-big-1280.png.json
P5-429 | issues-big-1280 글자색: #6b6b70=muted×113, #0f766e=cat사회×19, #1d4ed8=down+catITAI×17, #c2410c=accent+cat경제×17, #b91c1c=cat국제×13, #15803d=cat과학건강×12, #7c3aed=cat정치×12, #be185d=cat문화스포츠×10, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-big-1280.png.json
P5-430 | issues-big-1280 배경색: #1d1d1f=fg+plot+durBg×2, #f5f5f7=chip×1 | 근거: A/shots/issues-big-1280.png.json
P5-431 | issues-big-1280 테두리: 1px solid #ececee=line×144, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-big-1280.png.json
P5-432 | issues-big-375 글자 크기: 12px×122, 11.5px×100, 17px×100, 14px×3, 22px×1 ; 굵기: 400×125, 600×100, 700×100, 800×1 | 근거: A/shots/issues-big-375.png.json
P5-433 | issues-big-375 모서리: 999px×10, 8px×3 ; gap(행 열): 6px 6px×102, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/issues-big-375.png.json
P5-434 | issues-big-375 padding(위 오른 아래 왼): 14px 18px×100, 4px 10px×10, 0px 12px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 16px 18px×1, 8px 16px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-big-375.png.json
P5-435 | issues-big-375 margin: 0px 0px 4px 0px×100, 6px 0px 0px 0px×100, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/issues-big-375.png.json
P5-436 | issues-big-375 글자색: #6b6b70=muted×112, #0f766e=cat사회×19, #1d4ed8=down+catITAI×17, #c2410c=accent+cat경제×17, #b91c1c=cat국제×13, #15803d=cat과학건강×12, #7c3aed=cat정치×12, #be185d=cat문화스포츠×10, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-big-375.png.json
P5-437 | issues-big-375 배경색: #1d1d1f=fg+plot+durBg×2, #f5f5f7=chip×1 | 근거: A/shots/issues-big-375.png.json
P5-438 | issues-big-375 테두리: 1px solid #ececee=line×140, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-big-375.png.json
P5-439 | issues-empty-1280 글자 크기: 12px×62, 11.5px×39, 17px×39, 14px×2, 22px×1 ; 굵기: 400×64, 600×39, 700×39, 800×1 | 근거: A/shots/issues-empty-1280.png.json
P5-440 | issues-empty-1280 모서리: 999px×11, 8px×2 ; gap(행 열): 6px 6px×41, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/issues-empty-1280.png.json
P5-441 | issues-empty-1280 padding(위 오른 아래 왼): 14px 18px×39, 4px 10px×11, 4px 0px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-empty-1280.png.json
P5-442 | issues-empty-1280 margin: 0px 0px 4px 0px×39, 6px 0px 0px 0px×39, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/issues-empty-1280.png.json
P5-443 | issues-empty-1280 글자색: #6b6b70=muted×52, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-empty-1280.png.json
P5-444 | issues-empty-1280 배경색: #1d1d1f=fg+plot+durBg×2 | 근거: A/shots/issues-empty-1280.png.json
P5-445 | issues-empty-1280 테두리: 1px solid #ececee=line×79, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-empty-1280.png.json
P5-446 | issues-empty-375 글자 크기: 12px×61, 11.5px×39, 17px×39, 14px×2, 22px×1 ; 굵기: 400×63, 600×39, 700×39, 800×1 | 근거: A/shots/issues-empty-375.png.json
P5-447 | issues-empty-375 모서리: 999px×10, 8px×2 ; gap(행 열): 6px 6px×41, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/issues-empty-375.png.json
P5-448 | issues-empty-375 padding(위 오른 아래 왼): 14px 18px×39, 4px 10px×10, 0px 12px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-empty-375.png.json
P5-449 | issues-empty-375 margin: 0px 0px 4px 0px×39, 6px 0px 0px 0px×39, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/issues-empty-375.png.json
P5-450 | issues-empty-375 글자색: #6b6b70=muted×51, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-empty-375.png.json
P5-451 | issues-empty-375 배경색: #1d1d1f=fg+plot+durBg×2 | 근거: A/shots/issues-empty-375.png.json
P5-452 | issues-empty-375 테두리: 1px solid #ececee=line×75, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-empty-375.png.json
P5-453 | issues-normal-1280-dark 글자색: #9a9aa0=muted×52, #2dd4bf=cat사회×8, #f472b6=cat문화스포츠×7, #60a5fa=catITAI×7, #fb923c=accent+cat경제×5, #4ade80=cat과학건강×5, #a78bfa=cat정치×4, #f87171=up+cat국제×3, #161618=bg+checkInk+onAccent×2 | 근거: A/shots/issues-normal-1280-dark.png.json
P5-454 | issues-normal-1280-dark 배경색: #ececee=fg+plot×2 | 근거: A/shots/issues-normal-1280-dark.png.json
P5-455 | issues-normal-1280-dark 테두리: 1px solid #2a2a2e=line×79, 1px solid #ececee=fg+plot×8 | 근거: A/shots/issues-normal-1280-dark.png.json
P5-456 | issues-normal-1280 글자 크기: 12px×62, 11.5px×39, 17px×39, 14px×2, 22px×1 ; 굵기: 400×64, 600×39, 700×39, 800×1 | 근거: A/shots/issues-normal-1280.png.json
P5-457 | issues-normal-1280 모서리: 999px×11, 8px×2 ; gap(행 열): 6px 6px×41, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/issues-normal-1280.png.json
P5-458 | issues-normal-1280 padding(위 오른 아래 왼): 14px 18px×39, 4px 10px×11, 4px 0px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-normal-1280.png.json
P5-459 | issues-normal-1280 margin: 0px 0px 4px 0px×39, 6px 0px 0px 0px×39, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/issues-normal-1280.png.json
P5-460 | issues-normal-1280 글자색: #6b6b70=muted×52, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-normal-1280.png.json
P5-461 | issues-normal-1280 배경색: #1d1d1f=fg+plot+durBg×2 | 근거: A/shots/issues-normal-1280.png.json
P5-462 | issues-normal-1280 테두리: 1px solid #ececee=line×79, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-normal-1280.png.json
P5-463 | issues-normal-375-dark 글자색: #9a9aa0=muted×51, #2dd4bf=cat사회×8, #f472b6=cat문화스포츠×7, #60a5fa=catITAI×7, #fb923c=accent+cat경제×5, #4ade80=cat과학건강×5, #a78bfa=cat정치×4, #f87171=up+cat국제×3, #161618=bg+checkInk+onAccent×2 | 근거: A/shots/issues-normal-375-dark.png.json
P5-464 | issues-normal-375-dark 배경색: #ececee=fg+plot×2 | 근거: A/shots/issues-normal-375-dark.png.json
P5-465 | issues-normal-375-dark 테두리: 1px solid #2a2a2e=line×75, 1px solid #ececee=fg+plot×8 | 근거: A/shots/issues-normal-375-dark.png.json
P5-466 | issues-normal-375 글자 크기: 12px×61, 11.5px×39, 17px×39, 14px×2, 22px×1 ; 굵기: 400×63, 600×39, 700×39, 800×1 | 근거: A/shots/issues-normal-375.png.json
P5-467 | issues-normal-375 모서리: 999px×10, 8px×2 ; gap(행 열): 6px 6px×41, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/issues-normal-375.png.json
P5-468 | issues-normal-375 padding(위 오른 아래 왼): 14px 18px×39, 4px 10px×10, 0px 12px×9, 10px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 10px 18px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/issues-normal-375.png.json
P5-469 | issues-normal-375 margin: 0px 0px 4px 0px×39, 6px 0px 0px 0px×39, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/issues-normal-375.png.json
P5-470 | issues-normal-375 글자색: #6b6b70=muted×51, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3, #ffffff=bg+checkInk+onAccent+durFg×2 | 근거: A/shots/issues-normal-375.png.json
P5-471 | issues-normal-375 배경색: #1d1d1f=fg+plot+durBg×2 | 근거: A/shots/issues-normal-375.png.json
P5-472 | issues-normal-375 테두리: 1px solid #ececee=line×75, 1px solid #1d1d1f=fg+plot+durBg×8 | 근거: A/shots/issues-normal-375.png.json
P5-473 | notfound-normal-1280-dark 글자색: #9a9aa0=muted×5, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/notfound-normal-1280-dark.png.json
P5-474 | notfound-normal-1280-dark 배경색: #fb923c=accent+cat경제×1 | 근거: A/shots/notfound-normal-1280-dark.png.json
P5-475 | notfound-normal-1280-dark 테두리: 1px solid #2a2a2e=line×2 | 근거: A/shots/notfound-normal-1280-dark.png.json
P5-476 | notfound-normal-1280 글자 크기: 12px×11, 14px×3, 15px×3, 19px×1, 22px×1 ; 굵기: 400×16, 800×2, 700×1 | 근거: A/shots/notfound-normal-1280.png.json
P5-477 | notfound-normal-1280 모서리: 8px×3 ; gap(행 열): 8px 8px×1, 4px 16px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/notfound-normal-1280.png.json
P5-478 | notfound-normal-1280 padding(위 오른 아래 왼): 4px 0px×9, 0px 10px×2, 10px 12px 6px 18px×1, 16px 18px×1, 0px 24px×1, 20px 18px 24px 18px×1 | 근거: A/shots/notfound-normal-1280.png.json
P5-479 | notfound-normal-1280 margin: 0px 0px 8px 0px×3, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1, 12px 0px 0px 0px×1, 24px 0px 0px 0px×1, 12px 0px 0px -10px×1 | 근거: A/shots/notfound-normal-1280.png.json
P5-480 | notfound-normal-1280 글자색: #6b6b70=muted×5, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/notfound-normal-1280.png.json
P5-481 | notfound-normal-1280 배경색: #c2410c=accent+cat경제×1 | 근거: A/shots/notfound-normal-1280.png.json
P5-482 | notfound-normal-1280 테두리: 1px solid #ececee=line×2 | 근거: A/shots/notfound-normal-1280.png.json
P5-483 | notfound-normal-375-dark 글자색: #9a9aa0=muted×5, #161618=bg+checkInk+onAccent×1 | 근거: A/shots/notfound-normal-375-dark.png.json
P5-484 | notfound-normal-375-dark 배경색: #fb923c=accent+cat경제×1 | 근거: A/shots/notfound-normal-375-dark.png.json
P5-485 | notfound-normal-375-dark 테두리: 1px solid #2a2a2e=line×2 | 근거: A/shots/notfound-normal-375-dark.png.json
P5-486 | notfound-normal-375 글자 크기: 12px×11, 14px×3, 15px×3, 19px×1, 22px×1 ; 굵기: 400×16, 800×2, 700×1 | 근거: A/shots/notfound-normal-375.png.json
P5-487 | notfound-normal-375 모서리: 8px×3 ; gap(행 열): 8px 8px×1, 4px 16px×1 ; 그림자: 없음 | 근거: A/shots/notfound-normal-375.png.json
P5-488 | notfound-normal-375 padding(위 오른 아래 왼): 0px 12px×9, 0px 10px×2, 10px 12px 6px 18px×1, 16px 18px×1, 0px 24px×1, 20px 18px 24px 18px×1 | 근거: A/shots/notfound-normal-375.png.json
P5-489 | notfound-normal-375 margin: 0px 0px 8px 0px×3, 0px auto×1, -11px 0px×1, -3px -3px -3px -7px×1, 12px 0px 0px 0px×1, 24px 0px 0px 0px×1, 12px 0px 0px -10px×1, 0px 0px 0px -12px×1 | 근거: A/shots/notfound-normal-375.png.json
P5-490 | notfound-normal-375 글자색: #6b6b70=muted×5, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/notfound-normal-375.png.json
P5-491 | notfound-normal-375 배경색: #c2410c=accent+cat경제×1 | 근거: A/shots/notfound-normal-375.png.json
P5-492 | notfound-normal-375 테두리: 1px solid #ececee=line×2 | 근거: A/shots/notfound-normal-375.png.json
P5-493 | privacy-normal-1280-dark 글자색: #fb923c=accent+cat경제×5, #9a9aa0=muted×3 | 근거: A/shots/privacy-normal-1280-dark.png.json
P5-494 | privacy-normal-1280-dark 배경색: 없음 | 근거: A/shots/privacy-normal-1280-dark.png.json
P5-495 | privacy-normal-1280-dark 테두리: 1px solid #2a2a2e=line×2 | 근거: A/shots/privacy-normal-1280-dark.png.json
P5-496 | privacy-normal-1280 글자 크기: 14px×34, 12px×11, 12.5px×5, 22px×1 ; 굵기: 400×41, 700×9, 800×1 | 근거: A/shots/privacy-normal-1280.png.json
P5-497 | privacy-normal-1280 모서리: 8px×2 ; gap(행 열): 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/privacy-normal-1280.png.json
P5-498 | privacy-normal-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 0px 0px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/privacy-normal-1280.png.json
P5-499 | privacy-normal-1280 margin: 30px 0px 4px 0px×9, 16px 0px 0px 0px×4, 4px 0px 0px 0px×4, 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/privacy-normal-1280.png.json
P5-500 | privacy-normal-1280 글자색: #c2410c=accent+cat경제×5, #6b6b70=muted×3 | 근거: A/shots/privacy-normal-1280.png.json
P5-501 | privacy-normal-1280 배경색: 없음 | 근거: A/shots/privacy-normal-1280.png.json
P5-502 | privacy-normal-1280 테두리: 1px solid #ececee=line×2 | 근거: A/shots/privacy-normal-1280.png.json
P5-503 | privacy-normal-375-dark 글자색: #fb923c=accent+cat경제×5, #9a9aa0=muted×3 | 근거: A/shots/privacy-normal-375-dark.png.json
P5-504 | privacy-normal-375-dark 배경색: 없음 | 근거: A/shots/privacy-normal-375-dark.png.json
P5-505 | privacy-normal-375-dark 테두리: 1px solid #2a2a2e=line×2 | 근거: A/shots/privacy-normal-375-dark.png.json
P5-506 | privacy-normal-375 글자 크기: 14px×34, 12px×11, 12.5px×5, 22px×1 ; 굵기: 400×41, 700×9, 800×1 | 근거: A/shots/privacy-normal-375.png.json
P5-507 | privacy-normal-375 모서리: 8px×2 ; gap(행 열): 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/privacy-normal-375.png.json
P5-508 | privacy-normal-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 0px 0px 0px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/privacy-normal-375.png.json
P5-509 | privacy-normal-375 margin: 30px 0px 4px 0px×9, 16px 0px 0px 0px×4, 4px 0px 0px 0px×4, 0px 0px 8px 0px×3, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/privacy-normal-375.png.json
P5-510 | privacy-normal-375 글자색: #c2410c=accent+cat경제×5, #6b6b70=muted×3 | 근거: A/shots/privacy-normal-375.png.json
P5-511 | privacy-normal-375 배경색: 없음 | 근거: A/shots/privacy-normal-375.png.json
P5-512 | privacy-normal-375 테두리: 1px solid #ececee=line×2 | 근거: A/shots/privacy-normal-375.png.json
P5-513 | schedules-big-1280 글자 크기: 12px×67, 11.5px×26, 15px×26, 13px×17, 12.5px×4, 14px×2, 22px×1 ; 굵기: 400×64, 600×60, 700×18, 800×1 | 근거: A/shots/schedules-big-1280.png.json
P5-514 | schedules-big-1280 모서리: 6px×26, 999px×8, 4px×7, 8px×6 ; gap(행 열): 4px 4px×8, 8px 8px×1, 12px 12px×1, 6px 6px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/schedules-big-1280.png.json
P5-515 | schedules-big-1280 padding(위 오른 아래 왼): 9px 0px×19, 4px 0px×9, 6px 0px×8, 4px 10px×8, 2px 7px×7, 6px 12px×2, 8px 0px×2, 10px 12px×2, 10px 12px 6px 18px×1, 16px 18px 4px 18px×1, 10px 18px×1, 0px 18px 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-big-1280.png.json
P5-516 | schedules-big-1280 margin: 0px 0px 2px 0px×28, 2px 0px 0px 0px×17, 16px 0px 2px 0px×15, 4px 0px 0px 0px×7, 14px 0px 0px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1, 0px 18px 4px 18px×1 | 근거: A/shots/schedules-big-1280.png.json
P5-517 | schedules-big-1280 글자색: #6b6b70=muted×32, #1d4ed8=down+catITAI×9, #c2410c=accent+cat경제×7, #15803d=cat과학건강×5, #b91c1c=cat국제×4, #be185d=cat문화스포츠×3, #ffffff=bg+checkInk+onAccent+durFg×2, #0f766e=cat사회×1, #7c3aed=cat정치×1 | 근거: A/shots/schedules-big-1280.png.json
P5-518 | schedules-big-1280 배경색: #f5f5f7=chip×5, #fff1e8=accentbg×4, #1d1d1f=fg+plot+durBg×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/schedules-big-1280.png.json
P5-519 | schedules-big-1280 테두리: 1px solid #ececee=line×58, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/schedules-big-1280.png.json
P5-520 | schedules-big-375 글자 크기: 12px×66, 11.5px×26, 15px×26, 13px×17, 12.5px×4, 14px×2, 22px×1 ; 굵기: 400×63, 600×60, 700×18, 800×1 | 근거: A/shots/schedules-big-375.png.json
P5-521 | schedules-big-375 모서리: 6px×26, 999px×7, 4px×7, 8px×6 ; gap(행 열): 4px 4px×8, 8px 8px×1, 12px 12px×1, 6px 6px×1 ; 그림자: 없음 | 근거: A/shots/schedules-big-375.png.json
P5-522 | schedules-big-375 padding(위 오른 아래 왼): 9px 0px×19, 0px 12px×9, 6px 0px×8, 4px 10px×7, 2px 7px×7, 6px 12px×2, 8px 0px×2, 10px 12px×2, 10px 12px 6px 18px×1, 16px 18px 4px 18px×1, 10px 18px×1, 0px 18px 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-big-375.png.json
P5-523 | schedules-big-375 margin: 0px 0px 2px 0px×28, 2px 0px 0px 0px×17, 16px 0px 2px 0px×15, 4px 0px 0px 0px×7, 14px 0px 0px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1, 0px 18px 4px 18px×1, 0px 0px 0px -12px×1 | 근거: A/shots/schedules-big-375.png.json
P5-524 | schedules-big-375 글자색: #6b6b70=muted×31, #1d4ed8=down+catITAI×9, #c2410c=accent+cat경제×7, #15803d=cat과학건강×5, #b91c1c=cat국제×4, #be185d=cat문화스포츠×3, #ffffff=bg+checkInk+onAccent+durFg×2, #0f766e=cat사회×1, #7c3aed=cat정치×1 | 근거: A/shots/schedules-big-375.png.json
P5-525 | schedules-big-375 배경색: #f5f5f7=chip×5, #fff1e8=accentbg×4, #1d1d1f=fg+plot+durBg×2, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/schedules-big-375.png.json
P5-526 | schedules-big-375 테두리: 1px solid #ececee=line×54, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/schedules-big-375.png.json
P5-527 | schedules-empty-1280 글자 크기: 12px×12, 14px×3, 12.5px×2, 22px×1 ; 굵기: 400×17, 800×1 | 근거: A/shots/schedules-empty-1280.png.json
P5-528 | schedules-empty-1280 모서리: 8px×3 ; gap(행 열): 8px 8px×1, 4px 4px×1, 12px 12px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/schedules-empty-1280.png.json
P5-529 | schedules-empty-1280 padding(위 오른 아래 왼): 4px 0px×9, 6px 12px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-empty-1280.png.json
P5-530 | schedules-empty-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1 | 근거: A/shots/schedules-empty-1280.png.json
P5-531 | schedules-empty-1280 글자색: #6b6b70=muted×6, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/schedules-empty-1280.png.json
P5-532 | schedules-empty-1280 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/schedules-empty-1280.png.json
P5-533 | schedules-empty-1280 테두리: 1px solid #ececee=line×6 | 근거: A/shots/schedules-empty-1280.png.json
P5-534 | schedules-empty-375 글자 크기: 12px×12, 14px×3, 12.5px×2, 22px×1 ; 굵기: 400×17, 800×1 | 근거: A/shots/schedules-empty-375.png.json
P5-535 | schedules-empty-375 모서리: 8px×3 ; gap(행 열): 8px 8px×1, 4px 4px×1, 12px 12px×1 ; 그림자: 없음 | 근거: A/shots/schedules-empty-375.png.json
P5-536 | schedules-empty-375 padding(위 오른 아래 왼): 0px 12px×9, 6px 12px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-empty-375.png.json
P5-537 | schedules-empty-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/schedules-empty-375.png.json
P5-538 | schedules-empty-375 글자색: #6b6b70=muted×6, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/schedules-empty-375.png.json
P5-539 | schedules-empty-375 배경색: #1d1d1f=fg+plot+durBg×1 | 근거: A/shots/schedules-empty-375.png.json
P5-540 | schedules-empty-375 테두리: 1px solid #ececee=line×6 | 근거: A/shots/schedules-empty-375.png.json
P5-541 | schedules-normal-1280-dark 글자색: #9a9aa0=muted×20, #60a5fa=catITAI×4, #161618=bg+checkInk+onAccent×2, #a78bfa=cat정치×2, #4ade80=cat과학건강×2, #f87171=up+cat국제×1, #fb923c=accent+cat경제×1 | 근거: A/shots/schedules-normal-1280-dark.png.json
P5-542 | schedules-normal-1280-dark 배경색: #222226=chip×5, #ececee=fg+plot×2, #3a2414=accentbg×1 | 근거: A/shots/schedules-normal-1280-dark.png.json
P5-543 | schedules-normal-1280-dark 테두리: 1px solid #2a2a2e=line×39, 1px solid #ececee=fg+plot×4 | 근거: A/shots/schedules-normal-1280-dark.png.json
P5-544 | schedules-normal-1280 글자 크기: 12px×39, 13px×10, 11.5px×9, 15px×9, 12.5px×3, 14px×2, 22px×1 ; 굵기: 400×42, 600×20, 700×10, 800×1 | 근거: A/shots/schedules-normal-1280.png.json
P5-545 | schedules-normal-1280 모서리: 6px×9, 999px×6, 8px×5, 4px×4 ; gap(행 열): 4px 4px×5, 8px 8px×1, 12px 12px×1, 6px 6px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/schedules-normal-1280.png.json
P5-546 | schedules-normal-1280 padding(위 오른 아래 왼): 4px 0px×9, 9px 0px×8, 4px 10px×6, 2px 7px×4, 6px 0px×2, 6px 12px×2, 8px 0px×2, 10px 12px 6px 18px×1, 16px 18px 4px 18px×1, 10px 18px×1, 0px 18px 16px 18px×1, 10px 12px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-normal-1280.png.json
P5-547 | schedules-normal-1280 margin: 0px 0px 2px 0px×10, 16px 0px 2px 0px×8, 2px 0px 0px 0px×8, 4px 0px 0px 0px×4, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1, 0px 18px 4px 18px×1, 14px 0px 0px 0px×1 | 근거: A/shots/schedules-normal-1280.png.json
P5-548 | schedules-normal-1280 글자색: #6b6b70=muted×20, #1d4ed8=down+catITAI×4, #ffffff=bg+checkInk+onAccent+durFg×2, #7c3aed=cat정치×2, #15803d=cat과학건강×2, #b91c1c=cat국제×1, #c2410c=accent+cat경제×1 | 근거: A/shots/schedules-normal-1280.png.json
P5-549 | schedules-normal-1280 배경색: #f5f5f7=chip×5, #1d1d1f=fg+plot+durBg×2, #fff1e8=accentbg×1 | 근거: A/shots/schedules-normal-1280.png.json
P5-550 | schedules-normal-1280 테두리: 1px solid #ececee=line×39, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/schedules-normal-1280.png.json
P5-551 | schedules-normal-375-dark 글자색: #9a9aa0=muted×20, #60a5fa=catITAI×4, #161618=bg+checkInk+onAccent×2, #a78bfa=cat정치×2, #4ade80=cat과학건강×2, #f87171=up+cat국제×1, #fb923c=accent+cat경제×1 | 근거: A/shots/schedules-normal-375-dark.png.json
P5-552 | schedules-normal-375-dark 배경색: #222226=chip×5, #ececee=fg+plot×2, #3a2414=accentbg×1 | 근거: A/shots/schedules-normal-375-dark.png.json
P5-553 | schedules-normal-375-dark 테두리: 1px solid #2a2a2e=line×39, 1px solid #ececee=fg+plot×4 | 근거: A/shots/schedules-normal-375-dark.png.json
P5-554 | schedules-normal-375 글자 크기: 12px×39, 13px×10, 11.5px×9, 15px×9, 12.5px×3, 14px×2, 22px×1 ; 굵기: 400×42, 600×20, 700×10, 800×1 | 근거: A/shots/schedules-normal-375.png.json
P5-555 | schedules-normal-375 모서리: 6px×9, 999px×6, 8px×5, 4px×4 ; gap(행 열): 4px 4px×5, 8px 8px×1, 12px 12px×1, 6px 6px×1 ; 그림자: 없음 | 근거: A/shots/schedules-normal-375.png.json
P5-556 | schedules-normal-375 padding(위 오른 아래 왼): 0px 12px×9, 9px 0px×8, 4px 10px×6, 2px 7px×4, 6px 0px×2, 6px 12px×2, 8px 0px×2, 10px 12px 6px 18px×1, 16px 18px 4px 18px×1, 10px 18px×1, 0px 18px 16px 18px×1, 10px 12px×1, 20px 18px 24px 18px×1 | 근거: A/shots/schedules-normal-375.png.json
P5-557 | schedules-normal-375 margin: 0px 0px 2px 0px×10, 16px 0px 2px 0px×8, 2px 0px 0px 0px×8, 4px 0px 0px 0px×4, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 4px 0px 10px 0px×1, 0px 18px 4px 18px×1, 14px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/schedules-normal-375.png.json
P5-558 | schedules-normal-375 글자색: #6b6b70=muted×20, #1d4ed8=down+catITAI×4, #ffffff=bg+checkInk+onAccent+durFg×2, #7c3aed=cat정치×2, #15803d=cat과학건강×2, #b91c1c=cat국제×1, #c2410c=accent+cat경제×1 | 근거: A/shots/schedules-normal-375.png.json
P5-559 | schedules-normal-375 배경색: #f5f5f7=chip×5, #1d1d1f=fg+plot+durBg×2, #fff1e8=accentbg×1 | 근거: A/shots/schedules-normal-375.png.json
P5-560 | schedules-normal-375 테두리: 1px solid #ececee=line×39, 1px solid #1d1d1f=fg+plot+durBg×4 | 근거: A/shots/schedules-normal-375.png.json
P5-561 | search-big-1280 글자 크기: 11.5px×1039, 17px×559, 15px×480, 12px×11, 14px×4, 12.5px×2, 22px×1, 16px×1 ; 굵기: 600×1519, 700×561, 400×16, 800×1 | 근거: A/shots/search-big-1280.png.json
P5-562 | search-big-1280 모서리: 8px×5 ; gap(행 열): 8px 8px×842, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/search-big-1280.png.json
P5-563 | search-big-1280 padding(위 오른 아래 왼): 14px 18px×1039, 4px 0px×9, 8px 16px×2, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-big-1280.png.json
P5-564 | search-big-1280 margin: 0px 0px 4px 0px×1039, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/search-big-1280.png.json
P5-565 | search-big-1280 글자색: #6b6b70=muted×845, #c2410c=accent+cat경제×33, #0f766e=cat사회×33, #15803d=cat과학건강×28, #be185d=cat문화스포츠×28, #7c3aed=cat정치×27, #1d4ed8=down+catITAI×25, #b91c1c=cat국제×25 | 근거: A/shots/search-big-1280.png.json
P5-566 | search-big-1280 배경색: #f5f5f7=chip×3 | 근거: A/shots/search-big-1280.png.json
P5-567 | search-big-1280 테두리: 1px solid #ececee=line×1054 | 근거: A/shots/search-big-1280.png.json
P5-568 | search-big-375 글자 크기: 11.5px×1039, 17px×559, 15px×480, 12px×11, 14px×4, 12.5px×2, 22px×1, 16px×1 ; 굵기: 600×1519, 700×561, 400×16, 800×1 | 근거: A/shots/search-big-375.png.json
P5-569 | search-big-375 모서리: 8px×5 ; gap(행 열): 8px 8px×842, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/search-big-375.png.json
P5-570 | search-big-375 padding(위 오른 아래 왼): 14px 18px×1039, 0px 12px×9, 8px 16px×2, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-big-375.png.json
P5-571 | search-big-375 margin: 0px 0px 4px 0px×1039, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/search-big-375.png.json
P5-572 | search-big-375 글자색: #6b6b70=muted×845, #c2410c=accent+cat경제×33, #0f766e=cat사회×33, #15803d=cat과학건강×28, #be185d=cat문화스포츠×28, #7c3aed=cat정치×27, #1d4ed8=down+catITAI×25, #b91c1c=cat국제×25 | 근거: A/shots/search-big-375.png.json
P5-573 | search-big-375 배경색: #f5f5f7=chip×3 | 근거: A/shots/search-big-375.png.json
P5-574 | search-big-375 테두리: 1px solid #ececee=line×1054 | 근거: A/shots/search-big-375.png.json
P5-575 | search-blank-1280 글자 크기: 12px×11, 14px×3, 22px×1, 16px×1, 13.5px×1 ; 굵기: 400×16, 800×1 | 근거: A/shots/search-blank-1280.png.json
P5-576 | search-blank-1280 모서리: 8px×4 ; gap(행 열): 8px 8px×2, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/search-blank-1280.png.json
P5-577 | search-blank-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 8px 16px×1, 12px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-blank-1280.png.json
P5-578 | search-blank-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/search-blank-1280.png.json
P5-579 | search-blank-1280 글자색: #6b6b70=muted×4 | 근거: A/shots/search-blank-1280.png.json
P5-580 | search-blank-1280 배경색: #f5f5f7=chip×2 | 근거: A/shots/search-blank-1280.png.json
P5-581 | search-blank-1280 테두리: 1px solid #ececee=line×12 | 근거: A/shots/search-blank-1280.png.json
P5-582 | search-blank-375 글자 크기: 12px×11, 14px×3, 22px×1, 16px×1, 13.5px×1 ; 굵기: 400×16, 800×1 | 근거: A/shots/search-blank-375.png.json
P5-583 | search-blank-375 모서리: 8px×4 ; gap(행 열): 8px 8px×2, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/search-blank-375.png.json
P5-584 | search-blank-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 8px 16px×1, 12px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-blank-375.png.json
P5-585 | search-blank-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/search-blank-375.png.json
P5-586 | search-blank-375 글자색: #6b6b70=muted×4 | 근거: A/shots/search-blank-375.png.json
P5-587 | search-blank-375 배경색: #f5f5f7=chip×2 | 근거: A/shots/search-blank-375.png.json
P5-588 | search-blank-375 테두리: 1px solid #ececee=line×12 | 근거: A/shots/search-blank-375.png.json
P5-589 | search-empty-1280 글자 크기: 12px×11, 14px×4, 22px×1, 16px×1 ; 굵기: 400×16, 800×1 | 근거: A/shots/search-empty-1280.png.json
P5-590 | search-empty-1280 모서리: 8px×4 ; gap(행 열): 8px 8px×2, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/search-empty-1280.png.json
P5-591 | search-empty-1280 padding(위 오른 아래 왼): 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 8px 16px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-empty-1280.png.json
P5-592 | search-empty-1280 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/search-empty-1280.png.json
P5-593 | search-empty-1280 글자색: #6b6b70=muted×4 | 근거: A/shots/search-empty-1280.png.json
P5-594 | search-empty-1280 배경색: #f5f5f7=chip×2 | 근거: A/shots/search-empty-1280.png.json
P5-595 | search-empty-1280 테두리: 1px solid #ececee=line×11 | 근거: A/shots/search-empty-1280.png.json
P5-596 | search-empty-375 글자 크기: 12px×11, 14px×4, 22px×1, 16px×1 ; 굵기: 400×16, 800×1 | 근거: A/shots/search-empty-375.png.json
P5-597 | search-empty-375 모서리: 8px×4 ; gap(행 열): 8px 8px×2, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/search-empty-375.png.json
P5-598 | search-empty-375 padding(위 오른 아래 왼): 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 8px 16px×1, 32px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-empty-375.png.json
P5-599 | search-empty-375 margin: 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/search-empty-375.png.json
P5-600 | search-empty-375 글자색: #6b6b70=muted×4 | 근거: A/shots/search-empty-375.png.json
P5-601 | search-empty-375 배경색: #f5f5f7=chip×2 | 근거: A/shots/search-empty-375.png.json
P5-602 | search-empty-375 테두리: 1px solid #ececee=line×11 | 근거: A/shots/search-empty-375.png.json
P5-603 | search-normal-1280-dark 글자색: #9a9aa0=muted×275, #2dd4bf=cat사회×8, #f472b6=cat문화스포츠×7, #60a5fa=catITAI×7, #fb923c=accent+cat경제×5, #4ade80=cat과학건강×5, #a78bfa=cat정치×4, #f87171=up+cat국제×3 | 근거: A/shots/search-normal-1280-dark.png.json
P5-604 | search-normal-1280-dark 배경색: #222226=chip×3 | 근거: A/shots/search-normal-1280-dark.png.json
P5-605 | search-normal-1280-dark 테두리: 1px solid #2a2a2e=line×324 | 근거: A/shots/search-normal-1280-dark.png.json
P5-606 | search-normal-1280 글자 크기: 11.5px×309, 17px×174, 15px×135, 12px×11, 14px×4, 12.5px×2, 22px×1, 16px×1 ; 굵기: 600×444, 700×176, 400×16, 800×1 | 근거: A/shots/search-normal-1280.png.json
P5-607 | search-normal-1280 모서리: 8px×5 ; gap(행 열): 8px 8px×272, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/search-normal-1280.png.json
P5-608 | search-normal-1280 padding(위 오른 아래 왼): 14px 18px×309, 4px 0px×9, 8px 16px×2, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-normal-1280.png.json
P5-609 | search-normal-1280 margin: 0px 0px 4px 0px×309, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1 | 근거: A/shots/search-normal-1280.png.json
P5-610 | search-normal-1280 글자색: #6b6b70=muted×275, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3 | 근거: A/shots/search-normal-1280.png.json
P5-611 | search-normal-1280 배경색: #f5f5f7=chip×3 | 근거: A/shots/search-normal-1280.png.json
P5-612 | search-normal-1280 테두리: 1px solid #ececee=line×324 | 근거: A/shots/search-normal-1280.png.json
P5-613 | search-normal-375-dark 글자색: #9a9aa0=muted×275, #2dd4bf=cat사회×8, #f472b6=cat문화스포츠×7, #60a5fa=catITAI×7, #fb923c=accent+cat경제×5, #4ade80=cat과학건강×5, #a78bfa=cat정치×4, #f87171=up+cat국제×3 | 근거: A/shots/search-normal-375-dark.png.json
P5-614 | search-normal-375-dark 배경색: #222226=chip×3 | 근거: A/shots/search-normal-375-dark.png.json
P5-615 | search-normal-375-dark 테두리: 1px solid #2a2a2e=line×324 | 근거: A/shots/search-normal-375-dark.png.json
P5-616 | search-normal-375 글자 크기: 11.5px×309, 17px×174, 15px×135, 12px×11, 14px×4, 12.5px×2, 22px×1, 16px×1 ; 굵기: 600×444, 700×176, 400×16, 800×1 | 근거: A/shots/search-normal-375.png.json
P5-617 | search-normal-375 모서리: 8px×5 ; gap(행 열): 8px 8px×272, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/search-normal-375.png.json
P5-618 | search-normal-375 padding(위 오른 아래 왼): 14px 18px×309, 0px 12px×9, 8px 16px×2, 0px 18px×2, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px 4px 18px×1, 8px 18px 12px 18px×1, 8px 12px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/search-normal-375.png.json
P5-619 | search-normal-375 margin: 0px 0px 4px 0px×309, 14px 0px 4px 0px×2, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 0px -12px×1 | 근거: A/shots/search-normal-375.png.json
P5-620 | search-normal-375 글자색: #6b6b70=muted×275, #0f766e=cat사회×8, #be185d=cat문화스포츠×7, #1d4ed8=down+catITAI×7, #c2410c=accent+cat경제×5, #15803d=cat과학건강×5, #7c3aed=cat정치×4, #b91c1c=cat국제×3 | 근거: A/shots/search-normal-375.png.json
P5-621 | search-normal-375 배경색: #f5f5f7=chip×3 | 근거: A/shots/search-normal-375.png.json
P5-622 | search-normal-375 테두리: 1px solid #ececee=line×324 | 근거: A/shots/search-normal-375.png.json
P5-623 | terms-normal-1280-dark 글자색: #9a9aa0=muted×38, #fb923c=accent+cat경제×15 | 근거: A/shots/terms-normal-1280-dark.png.json
P5-624 | terms-normal-1280-dark 배경색: 없음 | 근거: A/shots/terms-normal-1280-dark.png.json
P5-625 | terms-normal-1280-dark 테두리: 1px solid #2a2a2e=line×90 | 근거: A/shots/terms-normal-1280-dark.png.json
P5-626 | terms-normal-1280 글자 크기: 12px×111, 15px×28, 13.5px×28, 13px×21, 14px×2, 22px×1 ; 굵기: 400×119, 700×43, 600×28, 800×1 | 근거: A/shots/terms-normal-1280.png.json
P5-627 | terms-normal-1280 모서리: 999px×15, 8px×2 ; gap(행 열): 8px 8px×1, 4px 4px×1, 6px 6px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/terms-normal-1280.png.json
P5-628 | terms-normal-1280 padding(위 오른 아래 왼): 12px 0px×28, 5px 10px×15, 4px 0px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/terms-normal-1280.png.json
P5-629 | terms-normal-1280 margin: 4px 0px 0px 0px×35, 0px 0px 2px 0px×28, 12px 0px 0px 0px×15, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 6px 0px 12px 0px×1 | 근거: A/shots/terms-normal-1280.png.json
P5-630 | terms-normal-1280 글자색: #6b6b70=muted×38, #c2410c=accent+cat경제×15 | 근거: A/shots/terms-normal-1280.png.json
P5-631 | terms-normal-1280 배경색: 없음 | 근거: A/shots/terms-normal-1280.png.json
P5-632 | terms-normal-1280 테두리: 1px solid #ececee=line×90 | 근거: A/shots/terms-normal-1280.png.json
P5-633 | terms-normal-375-dark 글자색: #9a9aa0=muted×38, #fb923c=accent+cat경제×15 | 근거: A/shots/terms-normal-375-dark.png.json
P5-634 | terms-normal-375-dark 배경색: 없음 | 근거: A/shots/terms-normal-375-dark.png.json
P5-635 | terms-normal-375-dark 테두리: 1px solid #2a2a2e=line×90 | 근거: A/shots/terms-normal-375-dark.png.json
P5-636 | terms-normal-375 글자 크기: 12px×111, 15px×28, 13.5px×28, 13px×21, 14px×2, 22px×1 ; 굵기: 400×119, 700×43, 600×28, 800×1 | 근거: A/shots/terms-normal-375.png.json
P5-637 | terms-normal-375 모서리: 999px×15, 8px×2 ; gap(행 열): 8px 8px×1, 4px 4px×1, 6px 6px×1 ; 그림자: 없음 | 근거: A/shots/terms-normal-375.png.json
P5-638 | terms-normal-375 padding(위 오른 아래 왼): 12px 0px×28, 5px 10px×15, 0px 12px×9, 10px 12px 6px 18px×1, 6px 0px×1, 16px 18px×1, 20px 18px 24px 18px×1 | 근거: A/shots/terms-normal-375.png.json
P5-639 | terms-normal-375 margin: 4px 0px 0px 0px×35, 0px 0px 2px 0px×28, 12px 0px 0px 0px×15, 0px 0px 8px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 6px 0px 12px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/terms-normal-375.png.json
P5-640 | terms-normal-375 글자색: #6b6b70=muted×38, #c2410c=accent+cat경제×15 | 근거: A/shots/terms-normal-375.png.json
P5-641 | terms-normal-375 배경색: 없음 | 근거: A/shots/terms-normal-375.png.json
P5-642 | terms-normal-375 테두리: 1px solid #ececee=line×90 | 근거: A/shots/terms-normal-375.png.json
P5-643 | video-normal-1280-dark 글자색: #fb923c=accent+cat경제×10, #9a9aa0=muted×6, #ffffff=durFg×1 | 근거: A/shots/video-normal-1280-dark.png.json
P5-644 | video-normal-1280-dark 배경색: #34343a=thumb×1, #000000=durBg×1, #222226=chip×1 | 근거: A/shots/video-normal-1280-dark.png.json
P5-645 | video-normal-1280-dark 테두리: 1px solid #2a2a2e=line×10 | 근거: A/shots/video-normal-1280-dark.png.json
P5-646 | video-normal-1280 글자 크기: 14px×52, 12px×11, 11.5px×4, 15px×2, 10.5px×1, 22px×1, 13px×1, 11px×1 ; 굵기: 400×53, 700×11, 600×8, 800×1 | 근거: A/shots/video-normal-1280.png.json
P5-647 | video-normal-1280 모서리: 8px×3, 6px×1, 3px×1 ; gap(행 열): normal 8px×8, 8px 8px×1, 4px 4px×1, 4px 14px×1 ; 그림자: 없음 | 근거: A/shots/video-normal-1280.png.json
P5-648 | video-normal-1280 padding(위 오른 아래 왼): 6px 0px×9, 4px 0px×9, 11px 0px 0px 0px×8, 10px 0px×8, 0px 0px 0px 18px×8, 10px 12px 6px 18px×1, 16px 18px×1, 0px 4px×1, 7px 10px×1, 0px 0px 6px 0px×1, 20px 18px 24px 18px×1 | 근거: A/shots/video-normal-1280.png.json
P5-649 | video-normal-1280 margin: 4px 0px 0px 0px×24, 6px 0px 0px 0px×8, 0px 0px 8px 0px×3, 30px 0px 4px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 12px 0px×1, 3px 0px 0px 0px×1, 10px 0px 0px 0px×1, 0px 6px 0px 0px×1, 0px 0px 4px 0px×1, 8px 0px 0px 0px×1 | 근거: A/shots/video-normal-1280.png.json
P5-650 | video-normal-1280 글자색: #c2410c=accent+cat경제×10, #6b6b70=muted×6, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/video-normal-1280.png.json
P5-651 | video-normal-1280 배경색: #d9d9de=thumb×1, #1d1d1f=fg+plot+durBg×1, #f5f5f7=chip×1 | 근거: A/shots/video-normal-1280.png.json
P5-652 | video-normal-1280 테두리: 1px solid #ececee=line×10 | 근거: A/shots/video-normal-1280.png.json
P5-653 | video-normal-375-dark 글자색: #fb923c=accent+cat경제×10, #9a9aa0=muted×6, #ffffff=durFg×1 | 근거: A/shots/video-normal-375-dark.png.json
P5-654 | video-normal-375-dark 배경색: #34343a=thumb×1, #000000=durBg×1, #222226=chip×1 | 근거: A/shots/video-normal-375-dark.png.json
P5-655 | video-normal-375-dark 테두리: 1px solid #2a2a2e=line×10 | 근거: A/shots/video-normal-375-dark.png.json
P5-656 | video-normal-375 글자 크기: 14px×52, 12px×11, 11.5px×4, 15px×2, 10.5px×1, 22px×1, 13px×1, 11px×1 ; 굵기: 400×53, 700×11, 600×8, 800×1 | 근거: A/shots/video-normal-375.png.json
P5-657 | video-normal-375 모서리: 8px×3, 6px×1, 3px×1 ; gap(행 열): normal 8px×8, 8px 8px×1, 4px 4px×1 ; 그림자: 없음 | 근거: A/shots/video-normal-375.png.json
P5-658 | video-normal-375 padding(위 오른 아래 왼): 6px 0px×9, 0px 12px×9, 11px 0px 0px 0px×8, 4px 0px 10px 0px×8, 0px 0px 0px 18px×8, 10px 12px 6px 18px×1, 16px 18px×1, 0px 4px×1, 7px 10px×1, 0px 0px 6px 0px×1, 20px 18px 24px 18px×1 | 근거: A/shots/video-normal-375.png.json
P5-659 | video-normal-375 margin: 4px 0px 0px 0px×24, 6px 0px 0px 0px×8, 0px 0px 8px 0px×3, 30px 0px 4px 0px×2, 0px auto×1, -7px 0px×1, -3px -3px -3px -7px×1, 0px 0px 12px 0px×1, 3px 0px 0px 0px×1, 10px 0px 0px 0px×1, 0px 6px 0px 0px×1, 0px 0px 4px 0px×1, 8px 0px 0px 0px×1, 0px 0px 0px -12px×1 | 근거: A/shots/video-normal-375.png.json
P5-660 | video-normal-375 글자색: #c2410c=accent+cat경제×10, #6b6b70=muted×6, #ffffff=bg+checkInk+onAccent+durFg×1 | 근거: A/shots/video-normal-375.png.json
P5-661 | video-normal-375 배경색: #d9d9de=thumb×1, #1d1d1f=fg+plot+durBg×1, #f5f5f7=chip×1 | 근거: A/shots/video-normal-375.png.json
P5-662 | video-normal-375 테두리: 1px solid #ececee=line×10 | 근거: A/shots/video-normal-375.png.json

## 3. 토큰(design.md)과 대조

기준: 글자 크기 단계 22/17/15/14/12 + 머리글 19(design.md "글자 크기"). 모서리 4/6/8/10/50%/999(design.md "모서리"). 그림자는 쓰지 않고 예외 하나(`0 0 0 6px accentbg`). 색은 theme.ts의 LIGHT·DARK(지표·영상 색과 대분류 색 포함). 간격은 design.md "간격" 표(18, 14·12, 6~12, 16, 24, 30). 테두리 폭은 "선 1px".

P5-663 | 촬영 전체(라이트 52개 촬영 합산)에서 쓰인 글자 크기 종류 = 18개: 11.5px×3960, 12px×2702, 15px×2201, 17px×1916, 14px×1007, 11px×306, 13px×250, 12.5px×230, 13.5px×74, 14.5px×72, 16px×53, 22px×46, 10.5px×38, 18px×28, 19px×20, 10px×12, 21px×2, 15.5px×2 (요소 수 합). | 근거: A/shots/*.png.json
P5-664 | 기준 단계에 있는 값(12·14·15·17·19·22) 중 실제 쓰인 값: 12px, 14px, 15px, 17px, 19px, 22px ; 기준 단계 중 촬영에서 안 쓰인 값: 없음 | 근거: A/shots/*.png.json
P5-665 | 기준 단계에 없는 값: 10px(요소 12, 나오는 촬영 2개); 10.5px(요소 38, 나오는 촬영 4개); 11px(요소 306, 나오는 촬영 20개); 11.5px(요소 3960, 나오는 촬영 44개); 12.5px(요소 230, 나오는 촬영 38개); 13px(요소 250, 나오는 촬영 28개); 13.5px(요소 74, 나오는 촬영 16개); 14.5px(요소 72, 나오는 촬영 6개); 15.5px(요소 2, 나오는 촬영 2개); 16px(요소 53, 나오는 촬영 11개); 18px(요소 28, 나오는 촬영 14개); 21px(요소 2, 나오는 촬영 2개) | 근거: A/shots/*.png.json
P5-666 | 거의 같은 글자 크기 쌍(1px 이하 차이, 전체): 10-10.5, 10-11, 10.5-11, 10.5-11.5, 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 13.5-14.5, 14-14.5, 14-15, 14.5-15, 14.5-15.5, 15-15.5, 15-16, 15.5-16, 16-17, 17-18, 18-19, 21-22 | 근거: A/shots/*.png.json
P5-667 | about-normal-1280: 기준 단계 밖 글자 크기 2종(11.5px×2, 12.5px×1), 기준 단계 밖 요소 3/249; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5 | 근거: A/shots/about-normal-1280.png.json
P5-668 | about-normal-375: 기준 단계 밖 글자 크기 2종(11.5px×2, 12.5px×1), 기준 단계 밖 요소 3/249; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5 | 근거: A/shots/about-normal-375.png.json
P5-669 | brief-big-1280: 기준 단계 밖 글자 크기 6종(11px×52, 11.5px×16, 12.5px×6, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 78/205; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-big-1280.png.json
P5-670 | brief-big-375: 기준 단계 밖 글자 크기 6종(11px×52, 11.5px×16, 12.5px×6, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 78/203; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-big-375.png.json
P5-671 | brief-builder-1280: 기준 단계 밖 글자 크기 6종(12.5px×29, 11.5px×5, 11px×4, 18px×2, 13px×2, 13.5px×2), 기준 단계 밖 요소 44/121; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-builder-1280.png.json
P5-672 | brief-builder-375: 기준 단계 밖 글자 크기 6종(12.5px×29, 11.5px×5, 11px×4, 18px×2, 13px×2, 13.5px×2), 기준 단계 밖 요소 44/121; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-builder-375.png.json
P5-673 | brief-demand-1280: 기준 단계 밖 글자 크기 6종(12.5px×24, 11.5px×4, 11px×3, 18px×2, 13px×2, 13.5px×2), 기준 단계 밖 요소 37/133; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-demand-1280.png.json
P5-674 | brief-demand-375: 기준 단계 밖 글자 크기 6종(12.5px×24, 11.5px×4, 11px×3, 18px×2, 13px×2, 13.5px×2), 기준 단계 밖 요소 37/133; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-demand-375.png.json
P5-675 | brief-empty-1280: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/13; 거의 같은 쌍 없음 | 근거: A/shots/brief-empty-1280.png.json
P5-676 | brief-empty-375: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/13; 거의 같은 쌍 없음 | 근거: A/shots/brief-empty-375.png.json
P5-677 | brief-error-1280: 기준 단계 밖 글자 크기 6종(11px×17, 11.5px×6, 12.5px×5, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 32/99; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-error-1280.png.json
P5-678 | brief-error-375: 기준 단계 밖 글자 크기 6종(11px×17, 11.5px×6, 12.5px×5, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 32/97; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-error-375.png.json
P5-679 | brief-loading-1280: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/13; 거의 같은 쌍 없음 | 근거: A/shots/brief-loading-1280.png.json
P5-680 | brief-loading-375: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/13; 거의 같은 쌍 없음 | 근거: A/shots/brief-loading-375.png.json
P5-681 | brief-normal-1280: 기준 단계 밖 글자 크기 6종(11px×17, 11.5px×6, 12.5px×5, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 32/99; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-normal-1280.png.json
P5-682 | brief-normal-375: 기준 단계 밖 글자 크기 6종(11px×17, 11.5px×6, 12.5px×5, 18px×2, 13px×1, 13.5px×1), 기준 단계 밖 요소 32/97; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 17-18, 18-19 | 근거: A/shots/brief-normal-375.png.json
P5-683 | brief-open-1280: 기준 단계 밖 글자 크기 8종(11px×20, 12.5px×13, 13px×11, 11.5px×6, 18px×2, 13.5px×1, 21px×1, 15.5px×1), 기준 단계 밖 요소 55/142; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 15-15.5, 17-18, 18-19 | 근거: A/shots/brief-open-1280.png.json
P5-684 | brief-open-375: 기준 단계 밖 글자 크기 8종(11px×20, 12.5px×13, 13px×11, 11.5px×6, 18px×2, 13.5px×1, 21px×1, 15.5px×1), 기준 단계 밖 요소 55/141; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 12.5-13.5, 13-13.5, 13-14, 13.5-14, 14-15, 15-15.5, 17-18, 18-19 | 근거: A/shots/brief-open-375.png.json
P5-685 | brief-videos-1280: 기준 단계 밖 글자 크기 7종(13px×22, 11.5px×21, 10.5px×18, 16px×9, 11px×9, 12.5px×4, 18px×2), 기준 단계 밖 요소 85/116; 거의 같은 쌍 10.5-11, 10.5-11.5, 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15, 15-16, 18-19 | 근거: A/shots/brief-videos-1280.png.json
P5-686 | brief-videos-375: 기준 단계 밖 글자 크기 6종(13px×22, 11.5px×21, 10.5px×18, 11px×9, 12.5px×4, 18px×2), 기준 단계 밖 요소 76/116; 거의 같은 쌍 10.5-11, 10.5-11.5, 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15, 18-19 | 근거: A/shots/brief-videos-375.png.json
P5-687 | dates-normal-1280: 기준 단계 밖 글자 크기 2종(16px×18, 12.5px×2), 기준 단계 밖 요소 20/34; 거의 같은 쌍 12-12.5 | 근거: A/shots/dates-normal-1280.png.json
P5-688 | dates-normal-375: 기준 단계 밖 글자 크기 2종(16px×18, 12.5px×2), 기준 단계 밖 요소 20/34; 거의 같은 쌍 12-12.5 | 근거: A/shots/dates-normal-375.png.json
P5-689 | entities-big-1280: 기준 단계 밖 글자 크기 1종(11.5px×298), 기준 단계 밖 요소 298/914; 거의 같은 쌍 11.5-12, 14-15 | 근거: A/shots/entities-big-1280.png.json
P5-690 | entities-big-375: 기준 단계 밖 글자 크기 1종(11.5px×298), 기준 단계 밖 요소 298/914; 거의 같은 쌍 11.5-12, 14-15 | 근거: A/shots/entities-big-375.png.json
P5-691 | entities-normal-1280: 기준 단계 밖 글자 크기 1종(11.5px×28), 기준 단계 밖 요소 28/104; 거의 같은 쌍 11.5-12, 14-15 | 근거: A/shots/entities-normal-1280.png.json
P5-692 | entities-normal-375: 기준 단계 밖 글자 크기 1종(11.5px×28), 기준 단계 밖 요소 28/104; 거의 같은 쌍 11.5-12, 14-15 | 근거: A/shots/entities-normal-375.png.json
P5-693 | entity-normal-1280: 기준 단계 밖 글자 크기 5종(13px×20, 11px×20, 14.5px×20, 12.5px×2, 11.5px×1), 기준 단계 밖 요소 63/100; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5 | 근거: A/shots/entity-normal-1280.png.json
P5-694 | entity-normal-375: 기준 단계 밖 글자 크기 5종(13px×20, 11px×20, 14.5px×20, 12.5px×2, 11.5px×1), 기준 단계 밖 요소 63/100; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5 | 근거: A/shots/entity-normal-375.png.json
P5-695 | indicator-normal-1280: 기준 단계 밖 글자 크기 5종(10px×6, 13px×3, 12.5px×1, 14.5px×1, 11.5px×1), 기준 단계 밖 요소 12/30; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5, 14-15, 14.5-15 | 근거: A/shots/indicator-normal-1280.png.json
P5-696 | indicator-normal-375: 기준 단계 밖 글자 크기 5종(10px×6, 13px×3, 12.5px×1, 14.5px×1, 11.5px×1), 기준 단계 밖 요소 12/30; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5, 14-15, 14.5-15 | 근거: A/shots/indicator-normal-375.png.json
P5-697 | indicators-normal-1280: 기준 단계 밖 글자 크기 2종(11.5px×20, 12.5px×2), 기준 단계 밖 요소 22/57; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5 | 근거: A/shots/indicators-normal-1280.png.json
P5-698 | indicators-normal-375: 기준 단계 밖 글자 크기 2종(11.5px×20, 12.5px×2), 기준 단계 밖 요소 22/57; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5 | 근거: A/shots/indicators-normal-375.png.json
P5-699 | issue-loading-1280: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/14; 거의 같은 쌍 없음 | 근거: A/shots/issue-loading-1280.png.json
P5-700 | issue-loading-375: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/14; 거의 같은 쌍 없음 | 근거: A/shots/issue-loading-375.png.json
P5-701 | issue-normal-1280: 기준 단계 밖 글자 크기 5종(14.5px×15, 13px×13, 11px×10, 12.5px×3, 11.5px×1), 기준 단계 밖 요소 42/73; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5 | 근거: A/shots/issue-normal-1280.png.json
P5-702 | issue-normal-375: 기준 단계 밖 글자 크기 5종(14.5px×15, 13px×13, 11px×10, 12.5px×3, 11.5px×1), 기준 단계 밖 요소 42/73; 거의 같은 쌍 11-11.5, 11-12, 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-14.5 | 근거: A/shots/issue-normal-375.png.json
P5-703 | issues-big-1280: 기준 단계 밖 글자 크기 1종(11.5px×100), 기준 단계 밖 요소 100/327; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-big-1280.png.json
P5-704 | issues-big-375: 기준 단계 밖 글자 크기 1종(11.5px×100), 기준 단계 밖 요소 100/326; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-big-375.png.json
P5-705 | issues-empty-1280: 기준 단계 밖 글자 크기 1종(11.5px×39), 기준 단계 밖 요소 39/143; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-empty-1280.png.json
P5-706 | issues-empty-375: 기준 단계 밖 글자 크기 1종(11.5px×39), 기준 단계 밖 요소 39/142; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-empty-375.png.json
P5-707 | issues-normal-1280: 기준 단계 밖 글자 크기 1종(11.5px×39), 기준 단계 밖 요소 39/143; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-normal-1280.png.json
P5-708 | issues-normal-375: 기준 단계 밖 글자 크기 1종(11.5px×39), 기준 단계 밖 요소 39/142; 거의 같은 쌍 11.5-12 | 근거: A/shots/issues-normal-375.png.json
P5-709 | notfound-normal-1280: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/19; 거의 같은 쌍 14-15 | 근거: A/shots/notfound-normal-1280.png.json
P5-710 | notfound-normal-375: 기준 단계 밖 글자 크기 0종(없음), 기준 단계 밖 요소 0/19; 거의 같은 쌍 14-15 | 근거: A/shots/notfound-normal-375.png.json
P5-711 | privacy-normal-1280: 기준 단계 밖 글자 크기 1종(12.5px×5), 기준 단계 밖 요소 5/51; 거의 같은 쌍 12-12.5 | 근거: A/shots/privacy-normal-1280.png.json
P5-712 | privacy-normal-375: 기준 단계 밖 글자 크기 1종(12.5px×5), 기준 단계 밖 요소 5/51; 거의 같은 쌍 12-12.5 | 근거: A/shots/privacy-normal-375.png.json
P5-713 | schedules-big-1280: 기준 단계 밖 글자 크기 3종(11.5px×26, 13px×17, 12.5px×4), 기준 단계 밖 요소 47/143; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15 | 근거: A/shots/schedules-big-1280.png.json
P5-714 | schedules-big-375: 기준 단계 밖 글자 크기 3종(11.5px×26, 13px×17, 12.5px×4), 기준 단계 밖 요소 47/142; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15 | 근거: A/shots/schedules-big-375.png.json
P5-715 | schedules-empty-1280: 기준 단계 밖 글자 크기 1종(12.5px×2), 기준 단계 밖 요소 2/18; 거의 같은 쌍 12-12.5 | 근거: A/shots/schedules-empty-1280.png.json
P5-716 | schedules-empty-375: 기준 단계 밖 글자 크기 1종(12.5px×2), 기준 단계 밖 요소 2/18; 거의 같은 쌍 12-12.5 | 근거: A/shots/schedules-empty-375.png.json
P5-717 | schedules-normal-1280: 기준 단계 밖 글자 크기 3종(13px×10, 11.5px×9, 12.5px×3), 기준 단계 밖 요소 22/73; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15 | 근거: A/shots/schedules-normal-1280.png.json
P5-718 | schedules-normal-375: 기준 단계 밖 글자 크기 3종(13px×10, 11.5px×9, 12.5px×3), 기준 단계 밖 요소 22/73; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 12-13, 12.5-13, 13-14, 14-15 | 근거: A/shots/schedules-normal-375.png.json
P5-719 | search-big-1280: 기준 단계 밖 글자 크기 3종(11.5px×1039, 12.5px×2, 16px×1), 기준 단계 밖 요소 1042/2097; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 14-15, 15-16, 16-17 | 근거: A/shots/search-big-1280.png.json
P5-720 | search-big-375: 기준 단계 밖 글자 크기 3종(11.5px×1039, 12.5px×2, 16px×1), 기준 단계 밖 요소 1042/2097; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 14-15, 15-16, 16-17 | 근거: A/shots/search-big-375.png.json
P5-721 | search-blank-1280: 기준 단계 밖 글자 크기 2종(16px×1, 13.5px×1), 기준 단계 밖 요소 2/17; 거의 같은 쌍 13.5-14 | 근거: A/shots/search-blank-1280.png.json
P5-722 | search-blank-375: 기준 단계 밖 글자 크기 2종(16px×1, 13.5px×1), 기준 단계 밖 요소 2/17; 거의 같은 쌍 13.5-14 | 근거: A/shots/search-blank-375.png.json
P5-723 | search-empty-1280: 기준 단계 밖 글자 크기 1종(16px×1), 기준 단계 밖 요소 1/17; 거의 같은 쌍 없음 | 근거: A/shots/search-empty-1280.png.json
P5-724 | search-empty-375: 기준 단계 밖 글자 크기 1종(16px×1), 기준 단계 밖 요소 1/17; 거의 같은 쌍 없음 | 근거: A/shots/search-empty-375.png.json
P5-725 | search-normal-1280: 기준 단계 밖 글자 크기 3종(11.5px×309, 12.5px×2, 16px×1), 기준 단계 밖 요소 312/637; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 14-15, 15-16, 16-17 | 근거: A/shots/search-normal-1280.png.json
P5-726 | search-normal-375: 기준 단계 밖 글자 크기 3종(11.5px×309, 12.5px×2, 16px×1), 기준 단계 밖 요소 312/637; 거의 같은 쌍 11.5-12, 11.5-12.5, 12-12.5, 14-15, 15-16, 16-17 | 근거: A/shots/search-normal-375.png.json
P5-727 | terms-normal-1280: 기준 단계 밖 글자 크기 2종(13.5px×28, 13px×21), 기준 단계 밖 요소 49/191; 거의 같은 쌍 12-13, 13-13.5, 13-14, 13.5-14, 14-15 | 근거: A/shots/terms-normal-1280.png.json
P5-728 | terms-normal-375: 기준 단계 밖 글자 크기 2종(13.5px×28, 13px×21), 기준 단계 밖 요소 49/191; 거의 같은 쌍 12-13, 13-13.5, 13-14, 13.5-14, 14-15 | 근거: A/shots/terms-normal-375.png.json
P5-729 | video-normal-1280: 기준 단계 밖 글자 크기 4종(11.5px×4, 10.5px×1, 13px×1, 11px×1), 기준 단계 밖 요소 7/73; 거의 같은 쌍 10.5-11, 10.5-11.5, 11-11.5, 11-12, 11.5-12, 12-13, 13-14, 14-15 | 근거: A/shots/video-normal-1280.png.json
P5-730 | video-normal-375: 기준 단계 밖 글자 크기 4종(11.5px×4, 10.5px×1, 13px×1, 11px×1), 기준 단계 밖 요소 7/73; 거의 같은 쌍 10.5-11, 10.5-11.5, 11-11.5, 11-12, 11.5-12, 12-13, 13-14, 14-15 | 근거: A/shots/video-normal-375.png.json
P5-731 | 글자 크기×굵기 조합(라이트 전 촬영 합, 글자색 제외): 11.5px 600×3852, 12px 400×2496, 15px 600×2022, 17px 700×1916, 14px 400×854, 11px 400×210, 12.5px 700×176, 13px 400×168, 12px 600×146, 11.5px 400×108, 15px 700×93, 15px 400×86, 14px 600×81, 11px 600×76, 13.5px 400×74, 14px 700×72, 14.5px 600×72, 12px 700×60, 13px 700×52, 22px 800×46, 16px 400×44, 12.5px 600×32, 13px 600×30, 18px 400×28, 12.5px 400×22, 19px 800×20, 10.5px 400×20, 11px 700×20, 10.5px 700×18, 10px 400×12, 16px 600×9, 21px 400×2, 15.5px 400×2 | 근거: A/shots/*.png.json (typeCombos)
P5-732 | 굵기 종류(라이트 합): 600×6320, 400×4126, 700×2407, 800×66 (design.md 표에 나오는 굵기: 400·600·700·800) | 근거: A/shots/*.png.json
P5-733 | 모서리 값(라이트 합): 999px×314, 50%×292, 8px×197, 6px×122, 4px×118, 10px×38, 3px×20, 0px 8px 8px 0px×2 ; 기준(4/6/8/10/50%/999) 밖: 3px, 0px 8px 8px 0px | 근거: A/shots/*.png.json
P5-734 | 모서리 값별 나오는 촬영 수: 8px→64, 10px→18, 50%→16, 4px→16, 999px→34, 6px→14, 3px→4, 0px 8px 8px 0px→2 | 근거: A/shots/*.png.json
P5-735 | 거의 같은 모서리 쌍: 3-4 | 근거: A/shots/*.png.json
P5-736 | 그림자가 측정된 촬영: 없음(전 촬영 box-shadow 없음). 일정 주소 강조 상태(0 0 0 6px accentbg)는 촬영에 없음 | 근거: A/shots/*.png.json
P5-737 | 테두리 폭·스타일(라이트 합, 변 단위): 1px solid×6332, 2px solid×42, 3px solid×2 | 근거: A/shots/*.png.json
P5-738 | 라이트 촬영 전체에서 쓰인 색 종류 18개(글자·배경·테두리 합집합): #6b6b70=muted, #7c3aed=cat정치, #0f766e=cat사회, #b91c1c=cat국제, #be185d=cat문화스포츠, #c2410c=accent+cat경제, #c62828=up, #d1d1d6=ring, #15803d=cat과학건강, #d9d9de=thumb, #ececee=line, #f5f5f7=chip, #fff1e8=accentbg, #ffffff=bg+checkInk+onAccent+durFg, #1d1d1f=fg+plot+durBg, #1d4ed8=down+catITAI, #3b7fd0=check, transparent | 근거: A/shots/*.png.json
P5-739 | 라이트 토큰 표에 없는 색(투명 제외): 없음 | 근거: A/shots/*.png.json
P5-740 | 라이트 거의 같은 색 쌍(채널 8 이하, 알파 0.05 이하): #d1d1d6=ring ~ #d9d9de=thumb | 근거: A/shots/*.png.json
P5-741 | 다크 촬영 전체에서 쓰인 색 종류 19개(글자·배경·테두리 합집합): #000000=durBg, #7aa7ff=down, #9a9aa0=muted, #a78bfa=cat정치, #161618=bg+checkInk+onAccent, #ececee=fg+plot, #f472b6=cat문화스포츠, #f87171=up+cat국제, #fb923c=accent+cat경제, #ffffff=durFg, #222226=chip, #2a2a2e=line, #2dd4bf=cat사회, #34343a=thumb, #3a2414=accentbg, #3a3a3f=ring, #4ade80=cat과학건강, #60a5fa=catITAI, transparent | 근거: A/shots/*.png.json
P5-742 | 다크 토큰 표에 없는 색(투명 제외): 없음 | 근거: A/shots/*.png.json
P5-743 | 다크 거의 같은 색 쌍(채널 8 이하, 알파 0.05 이하): #222226=chip ~ #2a2a2e=line, #34343a=thumb ~ #3a3a3f=ring | 근거: A/shots/*.png.json
P5-744 | about-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/about-normal-1280-dark.png.json
P5-745 | about-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/about-normal-375-dark.png.json
P5-746 | brief-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/brief-normal-1280-dark.png.json
P5-747 | brief-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/brief-normal-375-dark.png.json
P5-748 | entity-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/entity-normal-1280-dark.png.json
P5-749 | entity-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/entity-normal-375-dark.png.json
P5-750 | indicator-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/indicator-normal-1280-dark.png.json
P5-751 | indicator-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/indicator-normal-375-dark.png.json
P5-752 | issue-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/issue-normal-1280-dark.png.json
P5-753 | issue-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/issue-normal-375-dark.png.json
P5-754 | schedules-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/schedules-normal-1280-dark.png.json
P5-755 | schedules-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/schedules-normal-375-dark.png.json
P5-756 | search-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/search-normal-1280-dark.png.json
P5-757 | search-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/search-normal-375-dark.png.json
P5-758 | video-normal-1280-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/video-normal-1280-dark.png.json
P5-759 | video-normal-375-dark: 이 화면 안에서 거의 같은 색 쌍 = #222226=chip ~ #2a2a2e=line | 근거: A/shots/video-normal-375-dark.png.json
P5-760 | padding 한 변 값의 크기(절댓값, 라이트 합, 변 단위): 18px×8220, 14px×7626, 0px×3108, 12px×1428, 4px×1006, 10px×984, 8px×596, 6px×356, 5px×268, 2px×248, 7px×236, 3px×156, 11px×156, 16px×136, 9px×108, 13px×72, 1px×68, 24px×68, 20px×64, 32px×20 | 근거: A/shots/*.png.json
P5-761 | padding에서 design.md 간격 표(0, 6~12 정수, 14, 16, 18, 24, 30)에 없는 한 변 값: 1px(변 68, 촬영 14개), 2px(변 248, 촬영 18개), 3px(변 156, 촬영 14개), 4px(변 1006, 촬영 51개), 5px(변 268, 촬영 20개), 13px(변 72, 촬영 2개), 20px(변 64, 촬영 64개), 32px(변 20, 촬영 10개) | 근거: A/shots/*.png.json
P5-762 | padding 값 쌍 중 모든 변이 1px 이하 차이인 거의 같은 값 12쌍: 10px 0px ~ 11px 0px; 10px 0px ~ 9px 0px; 11px 0px ~ 12px 0px; 12px 18px ~ 13px 18px; 13px 18px ~ 14px 18px; 1px 6px ~ 2px 7px; 2px 7px ~ 3px 8px; 3px 0px ~ 4px 0px; 4px 0px ~ 5px 0px; 4px 10px ~ 5px 10px; 5px 0px ~ 6px 0px; 8px 0px ~ 9px 0px | 근거: A/shots/*.png.json
P5-763 | margin 한 변 값의 크기(절댓값, 라이트 합, 변 단위): 0px×19512, 4px×4426, 6px×1578, 2px×418, 7px×256, 14px×246, 8px×224, 3px×212, 11px×180, 16px×132, 9px×80, 12px×78, 30px×44, 18px×40, 10px×28, 1px×20, 13px×8, 24px×4, 20px×2 | 근거: A/shots/*.png.json
P5-764 | margin에서 design.md 간격 표(0, 6~12 정수, 14, 16, 18, 24, 30)에 없는 한 변 값: 1px(변 20, 촬영 2개), 2px(변 418, 촬영 26개), 3px(변 212, 촬영 64개), 4px(변 4426, 촬영 52개), 13px(변 8, 촬영 4개), 20px(변 2, 촬영 2개) | 근거: A/shots/*.png.json
P5-765 | margin 값 쌍 중 모든 변이 1px 이하 차이인 거의 같은 값 9쌍: -13px 0px ~ -14px 0px; -6px 0px -7px 0px ~ -7px 0px; -7px 0px ~ -8px 0px; -8px 0px ~ -9px 0px; 10px 0px 0px 0px ~ 9px 0px 0px 0px; 1px 0px 0px 0px ~ 2px 0px 0px 0px; 2px 0px 0px 0px ~ 3px 0px 0px 0px; 3px 0px 0px 0px ~ 4px 0px 0px 0px; 8px 0px 0px 0px ~ 9px 0px 0px 0px | 근거: A/shots/*.png.json
P5-766 | gap 값(라이트 합): 8px×2478, 6px×1142, 4px×80, 4px 14px×32, 10px×32, normal 8px×16, 14px×14, 6px 8px×14, normal 14px×9, normal 10px×9, 12px×6, normal 16px×4, 4px 16px×2 | 근거: A/shots/*.png.json
P5-767 | 거의 같은 gap 쌍: 없음 | 근거: A/shots/*.png.json

## 4. 강조색(accent #c2410c / 다크 #fb923c, accentbg #fff1e8 / #3a2414) 사용처

요소 단위 개수와 요소 종류(태그.클래스)다. 대분류 색(경제 #c2410c / 다크 #fb923c 포함)은 style 속성의 `--cat-`로 가려 따로 센다. 강조색 테두리는 변 단위.

P5-768 | brief-normal-375: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-769 | brief-normal-375-dark: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-770 | brief-normal-1280: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-771 | brief-normal-1280-dark: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-772 | dates-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-773 | dates-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-774 | dates-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-775 | dates-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-776 | issues-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-777 | issues-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-778 | issues-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-779 | issues-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-780 | issue-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-781 | issue-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-782 | issue-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-783 | issue-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-784 | entities-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-785 | entities-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-786 | entities-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-787 | entities-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-788 | entity-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-789 | entity-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-790 | entity-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-791 | entity-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-792 | terms-normal-375: accent 글자 h2.idx×15 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-793 | terms-normal-375-dark: accent 글자 h2.idx×15 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-794 | terms-normal-1280: accent 글자 h2.idx×15 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-795 | terms-normal-1280-dark: accent 글자 h2.idx×15 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-796 | schedules-normal-375: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-797 | schedules-normal-375-dark: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-798 | schedules-normal-1280: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-799 | schedules-normal-1280-dark: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-800 | indicators-normal-375: accent 글자 a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-801 | indicators-normal-375-dark: accent 글자 a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-802 | indicators-normal-1280: accent 글자 a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-803 | indicators-normal-1280-dark: accent 글자 a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-804 | indicator-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-805 | indicator-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-806 | indicator-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-807 | indicator-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-808 | video-normal-375: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-809 | video-normal-375-dark: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-810 | video-normal-1280: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-811 | video-normal-1280-dark: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-812 | search-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-813 | search-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-814 | search-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-815 | search-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-816 | about-normal-375: accent 글자 a.text-link×14, span.addr×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-817 | about-normal-375-dark: accent 글자 a.text-link×14, span.addr×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-818 | about-normal-1280: accent 글자 a.text-link×14, span.addr×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-819 | about-normal-1280-dark: accent 글자 a.text-link×14, span.addr×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-820 | privacy-normal-375: accent 글자 a.text-link×5 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-821 | privacy-normal-375-dark: accent 글자 a.text-link×5 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-822 | privacy-normal-1280: accent 글자 a.text-link×5 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-823 | privacy-normal-1280-dark: accent 글자 a.text-link×5 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-824 | notfound-normal-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) a.btn×1 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-825 | notfound-normal-375-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) a.btn×1 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-826 | notfound-normal-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) a.btn×1 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-827 | notfound-normal-1280-dark: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) a.btn×1 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-828 | brief-videos-375: accent 글자 span.tag×9, b×9, button.vsumbtn×4, a.vseclink×2, small×1, a×1, a.text-link×1 ; accentbg 배경 span.tag×9 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-829 | brief-videos-1280: accent 글자 span.tag×9, b×9, button.vsumbtn×4, a.vseclink×2, small×1, a×1, a.text-link×1 ; accentbg 배경 span.tag×9 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-830 | brief-builder-375: accent 글자 small×1, a×1, a.text-link.bdue×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-831 | brief-builder-1280: accent 글자 small×1, a×1, a.text-link.bdue×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-832 | brief-demand-375: accent 글자 small×1, a×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-833 | brief-demand-1280: accent 글자 small×1, a×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-834 | brief-big-375: accent 글자 span.badge×17, small×1, a×1 ; accentbg 배경 span.badge×17 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-835 | brief-big-1280: accent 글자 span.badge×17, small×1, a×1 ; accentbg 배경 span.badge×17 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-836 | brief-empty-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-837 | brief-empty-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-838 | brief-error-375: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-839 | brief-error-1280: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-840 | issues-big-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 17 | 근거: A/raw/P5/accent.json
P5-841 | issues-big-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 17 | 근거: A/raw/P5/accent.json
P5-842 | issues-empty-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-843 | issues-empty-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-844 | entities-big-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-845 | entities-big-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-846 | schedules-big-375: accent 글자 a.res.ok×4 ; accentbg 배경 a.res.ok×4 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 3 | 근거: A/raw/P5/accent.json
P5-847 | schedules-big-1280: accent 글자 a.res.ok×4 ; accentbg 배경 a.res.ok×4 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 3 | 근거: A/raw/P5/accent.json
P5-848 | schedules-empty-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-849 | schedules-empty-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-850 | search-big-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 33 | 근거: A/raw/P5/accent.json
P5-851 | search-big-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 33 | 근거: A/raw/P5/accent.json
P5-852 | search-empty-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-853 | search-empty-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-854 | search-blank-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 input:outline×1 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-855 | search-blank-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 input:outline×1 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-856 | brief-open-375: accent 글자 span.badge×6, small×1, a×1, b(글자없음)×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) a.skip×1 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-857 | brief-loading-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 span.spinner:Top×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-858 | issue-loading-375: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 span.spinner:Top×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-859 | brief-open-1280: accent 글자 span.badge×6, small×1, a×1, b(글자없음)×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-860 | brief-loading-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 span.spinner:Top×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-861 | issue-loading-1280: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 span.spinner:Top×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-862 | look-01: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-863 | look-02: accent 글자 span.badge×7, small×1, a×1 ; accentbg 배경 span.badge×7 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-864 | look-03: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-865 | look-04: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 div.summary:Left×1 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-866 | look-05: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-867 | look-06: accent 글자 a.vsectime×8, b×1, a.text-link×1 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-868 | look-07: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-869 | look-08: accent 글자 a.res.ok×1 ; accentbg 배경 a.res.ok×1 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 0 | 근거: A/raw/P5/accent.json
P5-870 | look-09: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-871 | look-10: accent 글자 없음 ; accentbg 배경 없음 ; accent 색 면(배경이 accent) 없음 ; accent 테두리 없음 ; svg 없음 ; 그림자·윤곽 없음 ; 대분류 색 글자 5 | 근거: A/raw/P5/accent.json
P5-872 | 강조색을 쓰는 요소 종류 전체(라이트 촬영, 종류: 나오는 촬영 수): accbg:a.btn→2; accbg:a.skip→1; bg:a.res.ok→6; bg:span.badge→10; bg:span.tag→2; border:div.summary:Left→4; border:span.spinner:Top→4; color:a→16; color:a.res.ok→6; color:a.text-link→12; color:a.text-link.bdue→2; color:a.vseclink→2; color:a.vsectime→4; color:b→6; color:b(글자없음)→2; color:button.vsumbtn→2; color:h2.idx→2; color:small→16; color:span.addr→2; color:span.badge→10; color:span.tag→2; shadow:input:outline→2 | 근거: A/raw/P5/accent.json

## 5. 코드에서 토큰 없이 직접 넣은 값

P5-873 | styles.css 에서 var(--accent) 를 쓰는 선언 28건: 61(:focus-visible; outline), 347(.badge; color), 417(.story b; color), 541(.term; border-bottom), 569(.tbox a; color), 616(.idx; color), 692(.iss .summary; border-left), 737(.tl li::before; border), 808(.spinner; border-top-color), 842(.text-link; color), 902(.tabs button.on::after; border-bottom), 1238(.res.ok; color), 1326(.cal .d.tod; color), 1339(.cal .d i; background), 1386(.week-h a; color), 1421(.wrow small; color), 1427(.rel a.evc small; color), 1517(.box-foot a; color), 1738(.legend i; background), 1827(.vm .tag; color), 1880(.why b; color), 1896(.vsumbtn; color), 1924(.vseclink; color), 1975(.vsectime; color), 2079(.vlink:focus-visible .vthumb; outline), 2155(.btn; 인라인 규칙), 2171(.mailbar .addr; 인라인 규칙), 2241(.skip; 인라인 규칙) | 근거: 코드/styles.css
P5-874 | styles.css 에서 var(--accentbg) 를 쓰는 선언 8건: 346(.badge; background), 546(.term.open; background), 702(.notice; background), 1186(.ev.hl; background), 1187(.ev.hl; box-shadow), 1237(.res.ok; background), 1267(.mon .res.ok; background), 1828(.vm .tag; background) | 근거: 코드/styles.css
P5-875 | styles.css 에서 var(--on-accent) 를 쓰는 선언 2건: 2155(.btn; 인라인 규칙), 2241(.skip; 인라인 규칙) | 근거: 코드/styles.css
P5-876 | styles.css 의 font-size 선언은 전부 px 직접 값이다(var() 사용 0건). 선언 137건, 종류 19개. | 근거: 코드/styles.css
P5-877 | font-size 10px [단계 밖] 1건: 1691(.chart .ax) | 근거: styles.css:1691
P5-878 | font-size 10.5px [단계 밖] 3건: 1075(.sec), 1796(.vdur), 1825(.vm .tag) | 근거: styles.css:1075,1796,1825
P5-879 | font-size 11px [단계 밖] 8건: 343(.badge), 500(.src small), 520(.rel small), 973(.rd-btn i), 1306(.cal .w), 1564(.ichip small), 1729(.legend), 1879(.why b) | 근거: styles.css:343,500,520,973,1306,1564,1729,1879
P5-880 | font-size 11.5px [단계 밖] 7건: 306(.cat), 1420(.wrow small), 1560(.ichip .chg), 1624(.icard .c), 1650(.isrc), 1818(.vm), 2047(.vsrc) | 근거: styles.css:306,1420,1560,1624,1650,1818,2047
P5-881 | font-size 12px 31건: 224(.kw span), 245(.chips button), 277(.count), 334(.cont), 374(.short-meta), 416(.story b), 492(.src a), 568(.tbox a), 594(.rows small), 614(.idx), 643(.gl .aliases), 650(.gl small), 683(.iss .meta), 746(.tl small), 850(.footer), 926(.read-mk), 1068(.rows .read-mk span), 1132(.sch-head .meta), 1209(.ev small), 1228(.res), 1443(.ev-link small), 1512(.box-foot), 1574(.ind-meta), 1610(.icard .n), 1641(.ind-note), 1670(.chart-read), 1723(.igh small), 2127(.fix-mark), 2270(.dwin), 2271(.dnote), 2281(.dcover thead th) | 근거: styles.css:224,245,277,334,374,416,492,568,594,614,643,650,683,746,850,926,1068,1132,1209,1228,1443,1512,1574,1610,1641,1670,1723,2127,2270,2271,2281
P5-882 | font-size 12.5px [단계 밖] 8건: 454(.h), 1031(.read-prog), 1117(.view), 1251(.mon-h), 1373(.week-h), 1407(.wrow b), 1549(.ichip), 2117(.plain .keys code) | 근거: styles.css:454,1031,1117,1251,1373,1407,1549,2117
P5-883 | font-size 13px [단계 밖] 16건: 120(.datebtn), 407(.story), 512(.rel button), 555(.tbox), 561(.tbox b), 677(.iss .aliases), 700(.notice), 1049(.plain .done), 1148(.seg button), 1164(.dh), 1301(.cal), 1456(.ev-more), 1712(.igh), 1871(.why), 1898(.vsumbtn), 1925(.vseclink) | 근거: styles.css:120,407,512,555,561,677,700,1049,1148,1164,1301,1456,1712,1871,1898,1925
P5-884 | font-size 13.5px [단계 밖] 3건: 264(.flow), 623(.gl), 1905(.vsumtext) | 근거: styles.css:264,623,1905
P5-885 | font-size 14px 23건: 145(.back), 210(.headline), 461(.p), 689(.iss .summary), 791(.state), 827(.retry), 1400(.wrow), 1808(.vt), 1950(.vpagesum), 1976(.vsectime), 2009(.vsectitle), 2019(.vsecpoints), 2039(.vsecnote), 2137(.fix), 2142(.short-fix), 2149(.report), 2163(.nf .req), 2166(.about h2.h, .plain h2.h), 2170(.mailbar .lbl), 2215(.static-menu ul), 2223(.static-terms dd), 2278(.dcover), 2292(.tabs:has(button:nth-child(7))) | 근거: styles.css:145,210,461,689,791,827,1400,1808,1950,1976,2009,2019,2039,2137,2142,2149,2163,2166,2170,2215,2223,2278,2292
P5-886 | font-size 14.5px [단계 밖] 3건: 599(.rows span), 751(.tl span), 1449(.ev-link .t) | 근거: styles.css:599,751,1449
P5-887 | font-size 15px 17건: 179(.menu a), 324(.title.small), 364(.short-text), 634(.gl h3), 881(.tabs), 1202(.ev .t), 1279(.monthnav h2), 1498(.box-fold), 1581(.ind-meta .ind-v), 2155(.btn), 2161(.nf-act .more), 2167(.vpage h2.h), 2222(.static-terms dt), 2224(.static-more), 2228(.static-brief .bgroup-h), 2233(.term-jump a), 2241(.skip) | 근거: styles.css:179,324,364,634,881,1202,1279,1498,1581,2155,2161,2167,2222,2224,2228,2233,2241
P5-888 | font-size 15.5px [단계 밖] 1건: 448(.sum) | 근거: styles.css:448
P5-889 | font-size 16px [단계 밖] 3건: 764(.row-link), 779(.search-form input), 2089(.vt) | 근거: styles.css:764,779,2089
P5-890 | font-size 17px 5건: 317(.title), 1616(.icard .v), 2171(.mailbar .addr), 2227(.static-brief .brief-section > h2.list-h), 2232(.term-h) | 근거: styles.css:317,1616,2171,2227,2232
P5-891 | font-size 18px [단계 밖] 1건: 133(.datebtn .arrow) | 근거: styles.css:133
P5-892 | font-size 19px 1건: 116(.brand) | 근거: styles.css:116
P5-893 | font-size 20px [단계 밖] 1건: 1287(.monthnav button) | 근거: styles.css:1287
P5-894 | font-size 21px [단계 밖] 1건: 329(.item.open .title) | 근거: styles.css:329
P5-895 | font-size 22px 4건: 192(.page-title), 669(.iss .name), 1104(.ptitle h1), 2251(.bgroup-h) | 근거: styles.css:192,669,1104,2251
P5-896 | `font:` 줄임 선언: 52: font: inherit;, 537: font: inherit;, 778: font: inherit;, 1897: font: inherit;, 2249: .btitle { margin: 0; font: inherit; } | 근거: styles.css
P5-897 | line-height 값(직접 값, 줄 수): 1.5×8, 1.65×8, 1.6×7, 1.4×6, 1.55×4, 1.45×4, 1.3×3, inherit×1, 1.7×1, 1×1, 1.35×1, 14px×1, 20px×1 | 근거: styles.css
P5-898 | styles.css 안의 hex/rgb/hsl 색 직접 값: 0건 | 근거: 코드/styles.css
P5-899 | styles.css 의 색 키워드(transparent 등) 직접 값: 975(.rd-btn i): color: transparent;; 1486(.box-tabs button): border-bottom: 2px solid transparent; | 근거: styles.css:975,1486
P5-900 | var() 없이 색을 정하는 선언 전부: 47(a): color: inherit;; 53(button): color: inherit;; 54(button): background: none;; 975(.rd-btn i): color: transparent;; 1364(.week.closed): background: none;; 1895(.vsumbtn): background: none;; 1938(.vpage .page-title a): color: inherit; | 근거: styles.css:47,53,54,975,1364,1895,1938
P5-901 | border/outline 줄임 선언 중 색이 var()가 아닌 것: 1486(.box-tabs button): border-bottom: 2px solid transparent; | 근거: styles.css
P5-902 | border/outline 폭 직접 값: 2px→6건(61,737,807,902,1486,2079); 1px→27건(89,166,213,237,249,267,294,355,494,515,584,622,758,772,782,830,852,878,1081,1114,1141,1178,1433,1602,1701,1762,1966); 1.5px→2건(541,968); 3px→1건(692) | 근거: styles.css
P5-903 | border-radius 0 [기준 표 밖] 2건: 542(.term), 2234(.static-page .ev) | 근거: styles.css:542,2234
P5-904 | border-radius 0 8px 8px 0 [기준 표 밖] 1건: 694(.iss .summary) | 근거: styles.css:694
P5-905 | border-radius 10px 5건: 405(.story), 1359(.week), 1603(.icard), 1702(.igraph), 2168(.mailbar) | 근거: styles.css:405,1359,1603,1702,2168
P5-906 | border-radius 12px [기준 표 밖] 1건: 397(.hero) | 근거: styles.css:397
P5-907 | border-radius 3px [기준 표 밖] 2건: 547(.term.open), 1799(.vdur) | 근거: styles.css:547,1799
P5-908 | border-radius 4px 6건: 63(:focus-visible), 345(.badge), 1080(.sec), 1231(.res), 1683(.chart-plot), 1830(.vm .tag) | 근거: styles.css:63,345,1080,1231,1683,1830
P5-909 | border-radius 50% 6건: 735(.tl li::before), 809(.spinner), 961(.rd-btn), 967(.rd-btn i), 1338(.cal .d i), 1737(.legend i) | 근거: styles.css:735,809,961,967,1338,1737
P5-910 | border-radius 6px 4건: 495(.src a), 1180(.ev), 1780(.vthumb), 2186(.src a::before) | 근거: styles.css:495,1180,1780,2186
P5-911 | border-radius 8px 14건: 162(.icon-btn), 553(.tbox), 701(.notice), 781(.search-form input), 829(.retry), 1115(.view), 1142(.seg), 1246(.mon), 1289(.monthnav button), 1317(.cal .d), 1874(.why), 1908(.vsumtext), 2155(.btn), 2241(.skip) | 근거: styles.css:162,553,701,781,829,1115,1142,1246,1289,1317,1874,1908,2155,2241
P5-912 | border-radius 999px 4건: 226(.kw span), 248(.chips button), 514(.rel button), 2238(.static-page .rel a::before, .) | 근거: styles.css:226,248,514,2238
P5-913 | box-shadow/text-shadow 선언: 1181(.ev): transition: background-color 0.6s, box-shadow 0.6s;; 1187(.ev.hl): box-shadow: 0 0 0 6px var(--accentbg); | 근거: styles.css
P5-914 | styles.css padding 계열 px 값 종류 19개(직접 값, 변수 없음): 1px×2, 2px×5, 3px×2, 4px×10, 5px×3, 6px×16, 7px×3, 8px×10, 9px×1, 10px×18, 11px×1, 12px×23, 13px×1, 14px×4, 16px×9, 18px×27, 20px×1, 24px×1, 32px×1 | 근거: styles.css
P5-915 | styles.css padding 계열에서 design.md 간격 표 밖의 값: 1px 2건(줄 1410,1829); 2px 5건(줄 141,344,1230,1893,1923); 3px 2건(줄 225,428); 4px 10건(줄 173,200,246,493,866,1093,1308,1365,1717,1798); 5px 3건(줄 513,1316,1399); 13px 1건(줄 763); 20px 1건(줄 849); 32px 1건(줄 789) | 근거: styles.css
P5-916 | styles.css margin 계열 px 값 종류 18개(직접 값, 변수 없음): -1px×1, 1px×1, 2px×15, -2px×1, 3px×2, 4px×26, 6px×14, -6px×2, -7px×1, 8px×11, 10px×7, 12px×6, -12px×1, 14px×3, 16px×2, 18px×5, -18px×1, -26px×1 | 근거: styles.css
P5-917 | styles.css margin 계열에서 design.md 간격 표 밖의 값: -1px 1건(줄 76); 1px 1건(줄 1618); 2px 15건(줄 289,562,635,1020,1166,1197,1211,1254,1366,1511,1511,1527,1668,1728,1904); -2px 1건(줄 940); 3px 2건(줄 1340,1817); 4px 26건(줄 309,398,418,422,457,507,521,567,651,679,957,1020,1135,1140,1223,1357,1366,1426,1632,1663,1739,1831,2024,2034,2038,2113); -26px 1건(줄 1852) | 근거: styles.css
P5-918 | styles.css gap 계열 px 값 종류 9개(직접 값, 변수 없음): 2px×2, 4px×4, 5px×1, 6px×6, 8px×7, 10px×2, 12px×1, 14px×3, 16px×1 | 근거: styles.css
P5-919 | styles.css gap 계열에서 design.md 간격 표 밖의 값: 2px 2건(줄 151,1302); 4px 4건(줄 123,861,1035,1222); 5px 1건(줄 1547) | 근거: styles.css
P5-920 | max-width 값: 100%×3, 640px×1, 34em×1 | 근거: styles.css
P5-921 | opacity 선언: 0.35: 줄 137,1293,1322 | 근거: styles.css
P5-922 | transition/animation 선언: 810: animation: spin 0.8s linear infinite;; 821: animation: none;; 1181: transition: background-color 0.6s, box-shadow 0.6s;; 1192: transition: none; | 근거: styles.css
P5-923 | components/indicatorView.ts:50 인라인 값: g.path ? h("path", { d: g.path, fill: "none", stroke: "var(--plot)", strokeWidth: 1.3, strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" }) : null, | 근거: 코드/components/indicatorView.ts:50
P5-924 | components/indicatorView.ts:174 인라인 값: parts.push(h("line", { key: `g${k}`, x1: 0, x2: width, y1: line.y, y2: line.y, stroke: "var(--line)", strokeWidth: 1 })); | 근거: 코드/components/indicatorView.ts:174
P5-925 | components/indicatorView.ts:180 인라인 값: if (g.path) parts.push(h("path", { key: "line", d: g.path, fill: "none", stroke: "var(--plot)", strokeWidth: 1.5, strokeLinejoin: "round" })); | 근거: 코드/components/indicatorView.ts:180
P5-926 | components/indicatorView.ts:181 인라인 값: if (n === 1) parts.push(h("circle", { key: "one", cx: g.xs[0], cy: g.ys[0], r: 3, fill: "var(--plot)" })); | 근거: 코드/components/indicatorView.ts:181
P5-927 | components/indicatorView.ts:182 인라인 값: for (const i of dots) if (i < n) parts.push(h("circle", { key: `d${i}`, className: "dot", cx: g.xs[i], cy: g.ys[i], r: 3.5, fill: "var(--accent)" })); | 근거: 코드/components/indicatorView.ts:182
P5-928 | components/indicatorView.ts:184 인라인 값: parts.push(h("line", { key: "sel-l", x1: g.xs[cur], x2: g.xs[cur], y1: box.padTop - 6, y2: height - box.padBottom, stroke: "var(--muted)", strokeWidth: 1, strokeDasharray: "3 3" })); | 근거: 코드/components/indicatorView.ts:184
P5-929 | components/indicatorView.ts:185 인라인 값: parts.push(h("circle", { key: "sel-c", cx: g.xs[cur], cy: g.ys[cur], r: 4.5, fill: "var(--accent)", stroke: "var(--bg)", strokeWidth: 2 })); | 근거: 코드/components/indicatorView.ts:185
P5-930 | components/scheduleView.ts:33 인라인 값: h("div", { className: "cat", style: { color: categoryVar(item.major) } }, item.major), | 근거: 코드/components/scheduleView.ts:33
P5-931 | components/common.tsx:71 인라인 값: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"> | 근거: 코드/components/common.tsx:71
P5-932 | components/common.tsx:80 인라인 값: <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"> | 근거: 코드/components/common.tsx:80
P5-933 | components/common.tsx:218 인라인 값: <div className="vwait" style={{ "--rows": rows } as CSSProperties}> | 근거: 코드/components/common.tsx:218
P5-934 | components/common.tsx:263 인라인 값: <div className="cat" style={{ color: categoryVar(major) }}> | 근거: 코드/components/common.tsx:263
P5-935 | pages/BriefPage.tsx:710 인라인 값: <span className="cat-inline" style={{ color: categoryVar(story.category.major) }}> | 근거: 코드/pages/BriefPage.tsx:710
P5-936 | pages/GlossaryPage.tsx:141 인라인 값: <div className="gl-wait" style={{ minHeight: count * TERM_ROW_ESTIMATE }}> | 근거: 코드/pages/GlossaryPage.tsx:141
P5-937 | pages/SearchPage.tsx:217 인라인 값: <span className="cat" style={{ color: categoryVar(i.category.major) }}> | 근거: 코드/pages/SearchPage.tsx:217
P5-938 | site/src 의 *.ts·*.tsx 에서 theme.ts 밖의 hex/rgb/hsl 색 직접 값: 0건 | 근거: 코드
P5-939 | site/ 바로 아래 *.ts·index.html 의 hex/rgb 색: 0건 | 근거: site
P5-940 | theme.ts 의 hex 값은 모두 LIGHT·DARK 객체 안(토큰 정의)이며 정의 줄은 제외했다. 변수 이름 목록: bg fg muted line chip accent accentbg check check-ink ring up down plot on-accent thumb dur-fg dur-bg cat-0..6(총 17+7개). 글자 크기·간격·모서리용 CSS 변수는 없다(styles.css 에 `--` 정의는 `--bar-clear` 하나, 줄 12·2205). | 근거: 코드/lib/theme.ts:93-105 ; styles.css:12

완료


## P4 레퍼런스 대비

# P4 레퍼런스 대비 (2026-11-06)

약어: A = A, P = A/raw/P4.
촬영 job: P/job-1.json, P/job-2.json, P/job-3.json(setup은 P/scripts/). 위치·개수 측정: P/scripts/measure-pos.mjs → P/pos.json, P/scripts/measure-yt.mjs → P/pos-yt.json.
값 정의: 위계 단계 = `styles.typeCombos` 종류 수, 상자 = `styles.boxes`, 1순위 위치 = 첫 1순위 항목의 문서 기준 top(CSS px), 첫 화면 1순위 개수 = 화면 안에 일부라도 보이는 1순위 항목 수(P/pos.json의 `inView`). 강조 쓴 곳은 사진을 보고 눈으로 센 값이다(표시: 눈). 앱 1순위 위치·개수는 P/pos.json(같은 주소, setup 없이 다시 연 값)이라 look 사진과 몇 px 다를 수 있다.

## 레퍼런스 열기 결과

- P4-01 Kagi News: https://kite.kagi.com 은 https://news.kagi.com/world/latest 로 넘어가 열림. 쿠키 배너 없음. 근거: P/refs/kagi-375.png, P/refs/kagi-1280.png, P/pos.json
- P4-02 Kagi News 이야기 펼침: 첫 이야기 제목 단추를 눌러 열림(주소가 news.kagi.com/world/2026110511/... 로 바뀜). 근거: P/refs/kagi-open-375.png, P/refs/kagi-open-1280.png, P/scripts/setup-kagi-open.mjs
- P4-03 Techmeme: 열림. 375에서 반응형이 아니라 가로 스크롤 있음(`layout.horizontalScroll: true`). 근거: P/refs/techmeme-375.png, P/refs/techmeme-375.png.json
- P4-04 Wikipedia Portal:Current_events: 열림. 375에서도 데스크톱 화면이고 가로 스크롤 있음. 근거: P/refs/wiki-current-375.png, P/refs/wiki-current-375.png.json
- P4-05 YouTube: 공개 영상 https://www.youtube.com/watch?v=vif8NQcjVf0 (챕터 33개 있는 영상) 열림. 로그인·동의 창 없음. 첫 화면(기본 상태)과 설명 펼친 뒤 챕터 위치까지 내린 화면(1280만)을 찍었다. 375는 가로 스크롤 있음. 근거: P/refs/youtube-375.png, P/refs/youtube-1280.png, P/refs/youtube-chapters-1280.png, P/scripts/setup-yt-chapters.mjs
- P4-06 Snipd: 공개 에피소드 https://share.snipd.com/episode/f9975ea3-96d3-4f2d-9d5d-7a0533e2e0f6 열림(웹 검색으로 찾음, share.snipd.com 첫 주소는 snipd.com 소개로 넘어감). 열면 '앱 받기' 창이 떠서 'Stay in browser'로 닫고 찍었다. 기본 탭(AI Snips)과 Chapters 탭 두 상태. 근거: P/refs/snipd-375.png, P/refs/snipd-chapters-375.png, P/refs/snipd-1280.png, P/refs/snipd-chapters-1280.png, P/scripts/setup-snipd.mjs
- P4-07 Investing.com 경제 캘린더: 375·1280 모두 본문이 "403"뿐(봇 차단으로 봄). 열 수 없음. 그래서 일정 묶음은 비교 대상이 없어 '레퍼런스 대비 차이'를 적지 않는다. 근거: P/refs/investing-cal-375.png, P/refs/investing-cal-1280.png

## 브리프 (앱 look-01·02 / Kagi kagi-375·1280 / Techmeme techmeme-375·1280)

- P4-08 위계 단계: 앱 24·24, Kagi 8·9, Techmeme 11·17 (375·1280). 근거: A/raw/look/look-01.png.json, A/raw/look/look-02.png.json, P/refs/kagi-375.png.json, P/refs/kagi-1280.png.json, P/refs/techmeme-375.png.json, P/refs/techmeme-1280.png.json
- P4-09 상자 수: 앱 26·35, Kagi 15·20, Techmeme 5·13. 근거: 위와 같은 .json
- P4-10 첫 1순위 항목(기사 항목) 위치: 앱 466·423px(`li.item`), Kagi 100·146px(`button.text-xl`), Techmeme 245·203px(`a.ourh`). 근거: P/pos.json
- P4-11 첫 화면 1순위 개수(일부라도 보임/온전히 보임): 앱 3/2·5/5, Kagi 6/5·8/8, Techmeme 5/3·6/5. 근거: P/pos.json
- P4-12 강조 쓴 곳(눈): 앱 375 9곳(취소 1, 일정 전체 1, 분야 색 글자 3, '어제에 이어' 배지 2, 검은 채움 칩 '전체' 1, 하단 탭 밑줄 1), 1280 13곳(분야 색 글자 5, 배지 4, 그 밖 같음). Kagi 375 6곳(분야 색 글자 5, 탭 밑줄 1), 1280 10곳(분야 색 글자 9, 탭 밑줄 1). Techmeme 375 약 9곳(청록 제목 1, 초록 라벨 More·X·LinkedIn·Bluesky·Forums 5, 노란 뉴스레터 안내 1, HOME 선택 1, 로고 1), 1280 20곳 넘음(청록 제목, 초록 라벨, 광고 상자, 노란 안내 등). 자동 값(`typeCombos` 중 굵기 600 이상이고 채도 있는 색): 앱 4·4, Kagi 0·0, Techmeme 2·6. 근거: A/raw/look/look-01.png, A/raw/look/look-02.png, P/refs/kagi-375.png, P/refs/kagi-1280.png, P/refs/techmeme-375.png, P/refs/techmeme-1280.png
- P4-13 첫 화면 정보 구역(눈, 참고): 앱 375 8구역(상단 바·날짜 이동, 하루 요약 문단, 키워드 칩, 이번 주 일정 상자, 분야 칩 줄, 탭 한 줄 요약, 기사 목록, 하단 탭). Kagi 375 3구역(상단 아이콘 바, 기사 목록, 하단 분류 탭). Techmeme 375 5구역(상단 링크 줄, 로고·날짜, 메뉴 바, Top News·뉴스레터 안내, 기사 묶음(출처·제목·요약·More·X·LinkedIn·Bluesky·Forums)). 근거: A/raw/look/look-01.png, P/refs/kagi-375.png, P/refs/techmeme-375.png
- P4-14 기사 한 항목의 정보(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-15 상태 보이기(참고): 앱은 선택 탭(한국, 주황 밑줄·굵게), 선택 칩(전체, 검은 채움), 일정 상자 선택 탭(밑줄)이 보임. Kagi는 선택 분류(World, 주황 밑줄), Techmeme은 선택 메뉴(HOME, 밝은 채움)가 보임. 빈·오류·로딩은 레퍼런스에서 볼 수 없었다. 근거: A/raw/look/look-01.png, P/refs/kagi-375.png, P/refs/techmeme-1280.png
- P4-16 문구(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-17 레퍼런스 대비 차이: 브리프의 위계 단계(앱 24·24)가 Kagi(8·9)와 Techmeme(11·17) 모두보다 많다. 근거: P4-08의 .json
- P4-18 레퍼런스 대비 차이: 브리프의 상자 수(앱 26·35)가 Kagi(15·20)와 Techmeme(5·13) 모두보다 많다. 근거: P4-09의 .json
- P4-19 레퍼런스 대비 차이: 브리프의 첫 기사 항목 위치(앱 466·423px)가 Kagi(100·146px)와 Techmeme(245·203px) 모두보다 아래다. 근거: P/pos.json
- P4-20 레퍼런스 대비 차이: 브리프 첫 화면의 기사 항목 수(앱 3·5개)가 Kagi(6·8개)와 Techmeme(5·6개) 모두보다 적다. 근거: P/pos.json
- P4-21 강조 쓴 곳(눈 값)은 375에서 앱 9 > Kagi 6이지만 Techmeme 약 9와 같고, 1280에서는 Techmeme이 더 많아 모두보다 나쁘지 않다(차이 아님). 근거: P4-12

## 이슈 페이지 (앱 look-03·04 / Kagi 이야기 펼침 kagi-open-375·1280 / Wikipedia wiki-current-375·1280)

- P4-22 위계 단계: 앱 8·8, Kagi 펼침 8·8, Wikipedia 10·27. 근거: A/raw/look/look-03.png.json, A/raw/look/look-04.png.json, P/refs/kagi-open-375.png.json, P/refs/kagi-open-1280.png.json, P/refs/wiki-current-375.png.json, P/refs/wiki-current-1280.png.json
- P4-23 상자 수: 앱 2·2, Kagi 펼침 9·12, Wikipedia 18·42. 근거: 위와 같은 .json
- P4-24 첫 1순위(요약 문단) 위치: 앱 173·173px(`.summary`), Kagi 펼침 396·306px(본문 첫 `p`), Wikipedia 313·313px('Topics in the news' 첫 항목). 근거: P/pos.json
- P4-25 사건 항목(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-26 강조 쓴 곳(눈): 앱 375 9곳(초록 메타 줄 1, 요약 상자 주황 왼쪽 막대 1, 타임라인 주황 원 7), 1280 15곳(원 13). Kagi 펼침 2곳(초록 주제 라벨, 파란 체크). Wikipedia는 파란 링크가 수십 곳, 초록 날짜 머리 상자, 파란 머리 상자. 근거: A/raw/look/look-03.png, A/raw/look/look-04.png, P/refs/kagi-open-375.png, P/refs/wiki-current-1280.png
- P4-27 문구(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-28 상태 보이기(참고): 앱 이슈 페이지에는 선택 탭·필터가 없고 상단에 '‹ 이슈'만 있다. Kagi 펼침은 분류 탭(World 밑줄)과 읽음 체크(파랗게 바뀜)가 보인다. 근거: A/raw/look/look-03.png, P/refs/kagi-open-375.png
- P4-29 이슈 페이지에서 앱이 레퍼런스 모두보다 나쁜 값은 없다(위계 단계 8은 Kagi 8과 같음, 상자·1순위 위치는 더 적고 위, 강조는 Wikipedia가 더 많음). 근거: P4-22~P4-26

## 영상 페이지 (앱 look-05·06 / YouTube youtube-375·1280·youtube-chapters-1280 / Snipd snipd·snipd-chapters 375·1280)

- P4-30 위계 단계: 앱 10·10, YouTube 첫 화면 12·19(챕터 화면 1280 13), Snipd 기본 18·19, Snipd Chapters 탭 16·16. 근거: A/raw/look/look-05.png.json, A/raw/look/look-06.png.json, P/refs/youtube-375.png.json, P/refs/youtube-1280.png.json, P/refs/youtube-chapters-1280.png.json, P/refs/snipd-375.png.json, P/refs/snipd-1280.png.json, P/refs/snipd-chapters-375.png.json, P/refs/snipd-chapters-1280.png.json
- P4-31 상자 수: 앱 5·6, YouTube 40·52(챕터 화면 30), Snipd 9·9(Chapters 7·7). 근거: 위와 같은 .json
- P4-32 첫 1순위(구간·챕터 항목) 위치: 앱 620·520px(`li.vsecrow`), Snipd Chapters 탭을 누른 뒤 745·716px, YouTube는 기본 상태에서 챕터 목록이 그려지지 않고(설명 '더보기'를 눌러야 나옴) 펼친 뒤 1280에서 2339px. 근거: P/pos.json, P/pos-yt.json, P/refs/youtube-1280.png, P/refs/youtube-chapters-1280.png
- P4-33 첫 화면 1순위 개수: 앱 1·2, Snipd Chapters 탭 2·3(기본 탭은 0, AI Snips 카드가 보임), YouTube 0·0(플레이어 안 'Introduction ›' 현재 챕터 이름만 보임). 근거: P/pos.json, P/refs/snipd-chapters-375.png, P/refs/youtube-1280.png
- P4-34 강조 쓴 곳(눈): 앱 375 3곳(주황 '추천 이유', 주황 밑줄 시각 '0:00', 밑줄 제목), 1280 4곳(시각 2). YouTube 1280 약 5곳(빨간 로고, 파란 '#494', 검은 '구독' 단추, 파란 설명 링크, 플레이어 진행 막대). Snipd 1280 약 6곳(초록 'Get the app', 초록 불꽃 'snips' 배지, 초록 Ask 아이콘, 흰 'Play' 단추, 노란 'INSIGHT', 흰 선택 탭). 근거: A/raw/look/look-05.png, A/raw/look/look-06.png, P/refs/youtube-1280.png, P/refs/snipd-1280.png
- P4-35 구간 항목의 정보(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-36 문구(참고): (레퍼런스의 글이 들어 있어 원본 `A/raw/P4/result.md`에만 둔다)
- P4-37 상태 보이기(참고): 앱 영상 페이지에는 탭·필터가 없다. Snipd는 선택 탭(흰 글자, 나머지 회색)이 보이고, YouTube는 플레이어 안 현재 챕터 이름이 보인다. 근거: A/raw/look/look-06.png, P/refs/snipd-chapters-1280.png, P/refs/youtube-1280.png
- P4-38 영상 페이지에서 앱이 레퍼런스 모두보다 나쁜 값은 없다(위계 단계·상자·강조는 더 적고, 1순위 위치는 더 위, 첫 화면 1순위 개수 1은 YouTube 0보다 많음). 근거: P4-30~P4-34

## 일정 (앱 look-07·08 / Investing.com 열 수 없음)

- P4-39 앱 값(참고, 비교 대상 없음): 위계 단계 16·16, 상자 19·21, 첫 일정 항목 264·264px(`li.ev`), 첫 화면 일정 항목 5·6개, 강조(눈) 375 약 8곳(검은 '목록' 단추, '다가오는 일정' 회색 채움, 검은 칩 '전체', 분야 색 글자 4, 주황 '결과:' 줄 1). 선택 상태(목록, 다가오는 일정, 전체)가 보임. 근거: A/raw/look/look-07.png, A/raw/look/look-07.png.json, A/raw/look/look-08.png.json, P/pos.json
- P4-40 Investing.com은 403이라 일정 묶음의 '레퍼런스 대비 차이'는 없음(판정 불가). 근거: P/refs/investing-cal-1280.png

## 검색

- P4-41 레퍼런스 없음으로 건너뜀(지시대로).

## 그 밖

- P4-42 가로 스크롤(참고): 앱 look-01~10 모두 없음. 레퍼런스 중 Techmeme·Wikipedia·YouTube의 375 촬영에 있음. 근거: A/raw/look/look-01.png.json, P/refs/techmeme-375.png.json, P/refs/wiki-current-375.png.json, P/refs/youtube-375.png.json
- P4-43 앱 브리프의 `typeCombos` 24개 중 '11px 400 rgba(0, 0, 0, 0)'(투명 글자 3개)도 한 종류로 들어 있다. 이를 빼도 23으로 레퍼런스보다 많다. 근거: A/raw/look/look-01.png.json

완료

## P3 첫눈 1

# P3 첫눈 1 (기본 모델 opus, 눈가림)
P3-look-1-01 look-01 브리프 375: ① 맨 위 요약 문단과 칩(예산안·수출) ② 이번 주 일정 상자('취소' 빨간 글씨) ③ 첫 기사의 굵은 제목과 '어제에 이어' 배지. 누를 곳: 기사 제목(상세나 원문), 빈 동그라미(읽음 표시일 것, 확실하지 않음), '일정 전체 ›'(일정 페이지)
P3-look-1-02 look-02 브리프 1280: ① 요약 문단 ② 회색 일정 상자 ③ 분야 칩 줄('안 읽은 것만' 포함), 그다음 기사 목록. 누를 곳: 분야 칩(거르기), '안 읽은 것만'(읽은 기사 숨김), 아래 탭 영상·빌더·수요(묶음 화면으로 바뀜)
P3-look-1-03 look-03 이슈 375: ① 큰 제목 ② 왼쪽 주황 선 회색 요약 상자 ③ 주황 동그라미 타임라인. 누를 곳: 타임라인 제목(그날 기사), '‹ 이슈'(목록), 위쪽 분야 글씨(같은 분야 목록, 링크인지 확실하지 않음)
P3-look-1-04 look-04 이슈 1280: ① 제목 ② 요약 상자 ③ 타임라인. 누를 곳: 타임라인 제목, '‹ 이슈', 검색 아이콘
P3-look-1-05 look-05 영상 375: ① 보라 썸네일 ② 밑줄 큰 영문 제목 ③ '추천 이유' 상자, 그다음 요약. 누를 곳: 제목(YouTube), 썸네일(재생이나 YouTube), '0:00'(그 장면)
P3-look-1-06 look-06 영상 1280: ① 썸네일 ② 밑줄 제목 ③ '추천 이유'. 누를 곳: 제목·썸네일(YouTube), 시각(그 장면), '‹ 브리프'
P3-look-1-07 look-07 일정 375: ① '일정' 제목과 목록/달력 ② 다가오는/지난 일정 전환과 분야 칩 ③ '11월 중(날짜 미정)' 회색 상자 안 주황 '결과:' 줄. 누를 곳: '달력', '지난 일정', 이슈 이름·'결과: … ›'
P3-look-1-08 look-08 일정 1280: ① 제목·목록/달력 ② 다가오는/지난 전환 막대 ③ 회색 날짜 미정 상자와 주황 결과 줄. 누를 곳: '달력', 분야 칩, '이슈: …'
P3-look-1-09 look-09 검색 375: ① '검색' 제목 ② 검색창과 '찾기' ③ 굵은 이슈 제목 목록. 누를 곳: 이슈 제목, '찾기', 검색창
P3-look-1-10 look-10 검색 1280: ① 제목과 검색창 ② '이슈' 소제목 아래 이슈 제목 ③ 색 분류 줄. 분류 줄 일부에서 '스포츠'에만 밑줄이 있고 이유를 알 수 없다. 누를 곳: 이슈 제목, '찾기', 밑줄 '스포츠'(분야 페이지, 링크인지 헷갈림)
완료


## P3 첫눈 2

# P3 첫눈 2 (sonnet, 눈가림)
P3-look-2-01 look-01 브리프 375: 눈에 든 순서 ① 맨 위 요약 문단·키워드 칩 ② 이번 주 일정 회색 상자 ③ 굵은 기사 제목 목록. 누를 곳: 분야 칩(거르기), '일정 전체 ›'(일정 화면), 빈 원(읽음 표시일 것 같다, 아니면 기사 열기, 확실하지 않음)
P3-look-2-02 look-02 브리프 1280: ① 요약 문단 ② 일정 상자 ③ 기사 제목 목록. 누를 곳: 분야 칩(거르기), '안 읽은 것만'(안 읽은 것만 남김), 기사 제목(펼치거나 연다)
P3-look-2-03 look-03 이슈 375: ① 큰 제목 ② 주황 줄이 있는 회색 요약 상자 ③ 타임라인. 누를 곳: '‹ 이슈'(목록으로), 타임라인 항목(그날 기사나 상세로), 돋보기(검색)
P3-look-2-04 look-04 이슈 1280: ① 제목 ② 요약 상자 ③ 타임라인. 누를 곳: '‹ 이슈', 타임라인 항목(기사로 이동), 돋보기·메뉴
P3-look-2-05 look-05 영상 375: ① 보라 썸네일 ② 밑줄 큰 영어 제목 ③ '요약' 문단과 '구간별 정리'. 누를 곳: 제목·썸네일(YouTube), '0:00'(그 시각 YouTube), '‹ 브리프'
P3-look-2-06 look-06 영상 1280: ① 썸네일·제목 ② 요약 문단 ③ 시각이 붙은 구간별 정리. 누를 곳: 시각 링크, 제목·썸네일, '‹ 브리프'
P3-look-2-07 look-07 일정 375: ① '일정' 제목과 목록/달력 전환 ② 날짜 머리글과 일정 제목 ③ '11월 중 (날짜 미정)' 회색 상자 안 주황 '결과:' 띠. 누를 곳: 목록/달력, 다가오는/지난 일정 탭, 이슈 밑줄 링크·'결과 ›'
P3-look-2-08 look-08 일정 1280: ① 제목·목록/달력 ② 다가오는 일정 탭과 분야 칩 ③ 날짜별 일정 목록. 누를 곳: 목록/달력, 지난 일정 탭, 이슈 링크
P3-look-2-09 look-09 검색 375: ① '검색' 제목과 입력창 ② 분야 색 줄과 굵은 이슈 제목 ③ 같은 모양의 결과 목록. 누를 곳: '찾기', 결과 항목(이슈 상세), '‹ 브리프'
P3-look-2-10 look-10 검색 1280: ① 제목과 입력창 ② '이슈' 소제목 아래 결과 ③ 분야 줄과 굵은 제목 반복. 누를 곳: '찾기', 결과 항목, '‹ 브리프'·돋보기·메뉴
완료


## P3 첫눈 3

# P3 첫눈 3 (opus, 눈가림)
P3-look-3-01 look-01 브리프 375: ① 회색 요약 두 줄과 칩 ② 회색 상자 '이번 주 일정 2'(빨간 '취소') ③ 분야 칩 줄 아래 굵은 기사 제목 목록. 누를 곳: 동그라미(읽음), '일정 전체 ›'(일정 페이지), 아래 탭(묶음 목록으로)
P3-look-3-02 look-02 브리프 1280: ① 굵은 기사 제목 목록 ② 회색 일정 상자 ③ 분야 칩 줄과 '안 읽은 것만'. 누를 곳: '안 읽은 것만', 분야 칩, 날짜 옆 ‹ ›(앞뒤 날짜)
P3-look-3-03 look-03 이슈 375: ① 큰 제목 ② 주황 선 회색 요약 상자 ③ 타임라인. 누를 곳: 타임라인 제목(그날 기사나 브리프), '‹ 이슈', 위쪽 분야 글자(누르는 곳인지 분명하지 않음)
P3-look-3-04 look-04 이슈 1280: ① 제목 ② 요약 상자 ③ 타임라인. 누를 곳: 타임라인 항목, '‹ 이슈', 돋보기
P3-look-3-05 look-05 영상 375: ① 보라 썸네일 ② 밑줄 큰 영어 제목 ③ '추천 이유' 상자, 다음 요약. 누를 곳: 제목·썸네일(YouTube), '0:00'(그 장면), '‹ 브리프'
P3-look-3-06 look-06 영상 1280: ① 썸네일·밑줄 제목 ② 굵은 소제목 '요약'·'구간별 정리' ③ 왼쪽 주황 시각과 구간 제목. 누를 곳: 시각(그 시점), 구간 제목(같은 일), 썸네일·제목(영상 처음)
P3-look-3-07 look-07 일정 375: ① '일정'과 목록/달력 ② 다가오는/지난 탭과 분야 칩 ③ 날짜 머리와 일정 제목, 그중 회색 날짜 미정 상자와 주황 '결과:' 줄. 누를 곳: '달력', '지난 일정', 이슈 링크·'결과 ›'
P3-look-3-08 look-08 일정 1280: ① 제목·목록/달력 ② 날짜별 일정 제목 목록 ③ 회색 날짜 미정 상자와 주황 결과 줄. 누를 곳: 분야 칩, 이슈 이름, '결과: … ›'
P3-look-3-09 look-09 검색 375: ① '검색'과 입력칸 ② '이슈' 묶음 머리 ③ 분야 줄이 붙은 굵은 이슈 이름 목록. 누를 곳: '찾기', 이슈 이름, 입력칸
P3-look-3-10 look-10 검색 1280: ① 입력칸과 '찾기' ② '이슈' 머리 ③ 굵은 이슈 이름 목록. '스포츠'에만 밑줄이 있다. 누를 곳: 이슈 행, 밑줄 '스포츠'(헷갈림), '찾기'
완료


## P3 과제 1

# P3-t1 과제 수행: 오늘 올라온 IT·AI 소식 하나 골라 읽기 (폭 1280)

- P3-t1-01: 시작 주소 / 는 11월 6일(금) 브리프이고, 아래 탭은 '한국'이 선택된 상태로 열렸다. 같은 화면에 'IT·AI'가 두 곳 있다: 목록 위 분류 칩 줄(전체·정치·경제·사회·국제·IT·AI·과학·건강·문화·스포츠·안 읽은 것만)과 화면 아래 고정 탭 줄(전체·한국·세계·IT·AI·영상 9·빌더 4·수요 3). 근거 A/raw/P3-t1/step-01.png, A/raw/P3-t1/task-01.mjs
- P3-t1-02: 먼저 눈에 가까운 분류 칩 'IT·AI'를 눌렀다. 아래 탭은 '한국' 그대로이고, 목록 자리에 "이 분류의 뉴스가 없다."만 나왔다(잘못 누른 곳). 근거 A/raw/P3-t1/step-02.png, A/raw/P3-t1/task-02.mjs
- P3-t1-03: 아래 탭 'IT·AI'를 누르자 IT·AI 탭 목록이 나왔다. 칩 'IT·AI'는 켜진 채로 남았고, 기사 5개(분류 'IT·AI · 플랫폼·인터넷/개발 도구/AI 모델·연구')와 아래에 '짧은 소식' 묶음 제목이 보였다. 근거 A/raw/P3-t1/step-03.png, A/raw/P3-t1/task-03.mjs
- P3-t1-04: 첫 기사 제목 '가짜대학 전세 사기와 결론을 미뤘다…'를 누르자 같은 자리에서 펼쳐졌다(주소 /2026-11-06#IT%C2%B7AI-1). 오른쪽 동그라미가 파란 체크로 바뀌었다(누르지 않았는데 읽음 표시로 바뀜). 펼친 첫 부분은 '이어지는 이야기' 상자(날짜 3줄), 요약, '왜 중요한가', '배경' 순서다. 근거 A/raw/P3-t1/step-04.png, A/raw/P3-t1/task-04.mjs
- P3-t1-05: 아래로 스크롤하면 '핵심'(불릿 3개), '전망', '인물·기관·국가'(칩 6개), '용어'(칩 1개), '확인 정도'('여러 출처 확인'), '함께 엮인 이슈'(칩 1개), '출처'(앱 밖 링크 1개 '가짜경제 · 11-06↗', 누르지 않음), '틀린 내용 알리기 · <공개 제보 메일>'(누르지 않음) 순서로 이어졌다. 근거 A/raw/P3-t1/step-05.png, A/raw/P3-t1/task-05.mjs
- P3-t1-06: 걸음 수 5(첫 화면 보기 포함), 잘못 누른 곳 1(분류 칩 IT·AI), 되돌아간 곳 0(칩을 끄지 않고 아래 탭으로 바로 옮김), 헤맨 곳 1(같은 이름 'IT·AI'가 칩과 아래 탭 두 곳에 있어 어느 쪽인지 정해야 했음). 근거 A/raw/P3-t1/step-01.png, A/raw/P3-t1/step-02.png

TASK: {"task": "오늘 올라온 뉴스 중 IT·AI 소식 하나를 골라 내용을 읽는다", "success": true, "steps": 5, "wrongClicks": ["'한국' 탭에서 분류 칩 'IT·AI'를 눌러 '이 분류의 뉴스가 없다.'가 나옴"], "stuck": ["'IT·AI'가 분류 칩 줄과 아래 탭 줄 두 곳에 있어 어느 것을 눌러야 할지 정해야 했음"]}

완료


## P3 과제 2

# P3-t2 개발 도구 변화 중 기한 있는 것 (375px, 정상 데이터)
- P3-t2-01 시작 화면(2026-11-06 브리프 한국 탭)에는 '개발 도구 변화'가 보이지 않고, 아래 탭줄에 '빌더 4'가 있다. 근거 A/raw/P3-t2/task-1.png
- P3-t2-02 '빌더 4' 탭을 눌러 열었다(걸음 2). 첫 화면에 소개 문장과 '도구 변화' 제목, 첫 항목(모델)의 '기한' 줄 첫 글자가 화면 아래 끝에 걸려 있다. 근거 A/raw/P3-t2/task-2.png
- P3-t2-03 빌더 탭의 도구 변화는 4개(모델, 코딩 도구, 보안, 플랫폼)이고 항목마다 '기한' 줄이 있다. 기한 값: 모델 '2026년 12월 6일 · 확정', 코딩 도구 '2027년 2월 4일 · 잠정', 보안 '없음', 플랫폼 '2027년 1월 · 잠정'. 근거 A/raw/P3-t2/task-3.png, A/raw/P3-t2/task-4.png, A/raw/P3-t2/task-5.png
- P3-t2-04 '지금 할 일' 줄: 모델 '가짜모델 1을 호출하는 코드를 가짜모델 2로 옮긴다', 코딩 도구 '지금은 일정만 살펴본다', 플랫폼 '없음'. 언제까지 무엇을 해야 하는지가 함께 있는 항목은 모델 하나다(12월 6일까지 모델 2로 옮기기). 근거 A/raw/P3-t2/task-3.png, A/raw/P3-t2/task-4.png, A/raw/P3-t2/task-5.png
- P3-t2-05 모델 항목의 기한 글자만 주황색 밑줄로 보인다(링크처럼 보임, 누르지 않음). 다른 항목의 기한은 검정 일반 글자. 근거 A/raw/P3-t2/task-3.png
- P3-t2-06 훑어 내려간 길이: 빌더 탭 상단 기준 약 740px에서 첫 '기한'이 나오고, 4개 항목 전부 확인까지 약 1800px 스크롤(총 높이 2815px). 걸음 3·4·5는 스크롤.
- P3-t2-07 잘못 누른 곳 0, 되돌아간 곳 0. 헤맨 곳: 시작 화면에서 개발 도구 변화가 '빌더' 탭에 있음을 탭 이름만으로 짐작해야 했다(탭 이름 '빌더', 소개문에 '코딩 도구, 모델, 보안, 플랫폼'이 있어 확인됨). 근거 A/raw/P3-t2/task-1.png, A/raw/P3-t2/task-2.png
- P3-t2-08 답: 확정 기한은 2026-12-06(가짜모델 1 지원 종료, 모델 2로 코드 옮기기). 잠정 기한은 2027-02-04(코딩 도구, 지금은 일정만 살핌)와 2027-01(플랫폼, 할 일 없음). 걸음 수 5.
TASK: {"task": "개발 도구 변화 중 기한 있는 것의 언제까지 무엇을 할지 찾기", "success": true, "steps": 5, "wrongClicks": [], "stuck": ["시작 화면에서 '개발 도구 변화'가 어느 탭에 있는지 탭 이름(빌더)로 짐작함", "모델 항목 기한만 링크처럼 밑줄 주황색으로 보여 눌러도 되는지 헷갈림(누르지 않음)"]}
완료


## P3 과제 3

# P3-t3 과제 결과: 11월 3일 브리프에서 이어지는 이야기 보고 돌아오기 (폭 1280×900)

- P3-t3-01: 시작 화면 /2026-11-03 은 아래 탭이 '한국'에 선택된 채 열렸고, 날짜 머리에 '11월 3일 (화)'가 보였다. 근거: A/raw/P3-t3/step-01.png, A/raw/P3-t3/task-01.mjs
- P3-t3-02: 접힌 항목 두 개 아래에 '이어지는 이야기: 가짜국 AI 모델 흐름 22', '이어지는 이야기: 가짜은행 기준금리 흐름 3' 줄이 회색 글자로 보였고, 링크 모양(색·밑줄·화살표)은 없었다. 근거: A/raw/P3-t3/step-01.png
- P3-t3-03: '이어지는 이야기: 가짜국 AI 모델 흐름 22' 글자를 누르자 이야기 페이지로 가지 않고 그 항목('가짜당 전세 사기가 다시 논의한다…')이 펼쳐졌다. 주소는 /2026-11-03#한국-2 로 바뀌었다. 근거: A/raw/P3-t3/step-02.png, A/raw/P3-t3/task-02.mjs
- P3-t3-04: 같은 누름으로 항목 오른쪽 읽음 원이 파란 체크로 바뀌었다(펼치면 읽음 표시됨). 근거: A/raw/P3-t3/step-01.png, A/raw/P3-t3/step-02.png
- P3-t3-05: 펼친 항목 안에 회색 상자 '이어지는 이야기 · 가짜국 AI 모델 흐름 22›'(주황 글자, › 표시)와 이전 날짜 3건(11-01, 10-31, 10-30)이 보였다. 근거: A/raw/P3-t3/step-02.png
- P3-t3-06: 상자 제목 '이어지는 이야기 · 가짜국 AI 모델 흐름 22›'를 누르자 /issues/22 로 갔다. 근거: A/raw/P3-t3/step-03.png, A/raw/P3-t3/task-03.mjs
- P3-t3-07: 이슈 페이지에는 왼쪽 위 '‹ 이슈', 분류 '문화·스포츠 · 문화·예술 · 진행 중', 제목, '2026-10-22 시작 · 최근 11-04 · 전개 12건', 요약 상자, 타임라인 12건(11-04~10-22), '등장 인물·기관·국가' 칩이 보였다. 날짜 이동 머리와 아래 탭은 없었다. 근거: A/raw/P3-t3/step-03.png
- P3-t3-08: 브리프 항목의 분류는 '과학·건강 · 기후·환경', 이슈 페이지의 분류는 '문화·스포츠 · 문화·예술'로 서로 달랐다. 근거: A/raw/P3-t3/step-02.png, A/raw/P3-t3/step-03.png
- P3-t3-09: 타임라인 11-03 줄만 오른쪽에 파란 체크(✓)가 있고 글자가 굵지 않았다(다른 줄은 굵은 글자). 근거: A/raw/P3-t3/step-03.png
- P3-t3-10: 화면에 '11월 3일 브리프로 돌아가기' 같은 이름의 버튼은 없었다. 왼쪽 위 '‹ 이슈'는 이름상 이슈 목록으로 가는 것으로 보여 누르지 않고, 타임라인 11-03 줄을 눌렀다. 근거: A/raw/P3-t3/step-03.png
- P3-t3-11: 타임라인 11-03 줄을 누르자 /2026-11-03#한국-2 로 돌아왔다. 날짜 머리는 '11월 3일 (화)', 아래 탭은 '한국' 선택, 그 항목은 펼친 채이고 화면 맨 위로 스크롤되어(scrollY 390) 보였다. 이야기 상자와 읽음 체크도 그대로였다. 근거: A/raw/P3-t3/step-04.png, A/raw/P3-t3/task-04.mjs
- P3-t3-12: 위 분류 칩 줄은 시작 때 '전체'였고, 돌아온 뒤 화면 위쪽이 스크롤되어 칩 줄은 사진에 보이지 않아 확인하지 못했다. 근거: A/raw/P3-t3/step-04.png
- P3-t3-13: 걸음 수 4(첫 화면 1 + 누름 3). 예상과 다르게 동작한 누름 1회(이어지는 이야기 글자가 링크가 아니고 펼침이었음). 막혀 되돌아간 곳 없음. 돌아갈 곳을 고를 때 '‹ 이슈'와 타임라인 줄 중 망설임 1회. 근거: A/raw/P3-t3/task-01.mjs ~ A/raw/P3-t3/task-04.mjs

TASK: {"task": "11월 3일 브리프의 뉴스에서 이어지는 이야기 흐름을 보고 화면 안의 것으로 11월 3일 브리프로 돌아오기", "success": true, "steps": 4, "wrongClicks": ["접힌 항목의 '이어지는 이야기: 가짜국 AI 모델 흐름 22' 글자를 눌렀는데 이야기 페이지가 아니라 항목 펼침(읽음 표시 포함)이 됨"], "stuck": ["이슈 페이지에서 브리프로 돌아갈 버튼이 없어 '‹ 이슈'와 타임라인 11-03 줄 중 무엇을 누를지 망설임"]}

완료


## P3 과제 4

# P3-t4 과제 수행: 이번 주 일정 하나를 찾아 관련 뉴스 열기 (폭 375, 모바일 터치)

- P3-t4-01: 시작 화면(/, 11월 6일 브리프) 첫 화면에 '이번 주 일정 2' 상자가 보이고 일정 2개(11-09 월 '가짜 중앙은행 대통령 선거 선고' + 빨간 '취소', 11-11 수 '가짜시 항소심 출시')와 '일정 전체 ›' 링크가 있다. 근거: A/raw/P3-t4/step-01.png, A/raw/P3-t4/task-01.mjs
- P3-t4-02: 브리프 일정 상자의 두 번째 줄 링크 높이는 30px, '일정 전체 ›' 링크는 54x28px, 탭 '지표' 버튼은 24x32px이다. 근거: A/raw/P3-t4/task-01.mjs 출력(요소 목록), A/raw/P3-t4/step-01.png
- P3-t4-03: 첫 일정은 취소 표시가 있어 고르지 않고 두 번째 일정 '가짜시 항소심 출시'(11-11)를 눌렀다(걸음 2). 근거: A/raw/P3-t4/step-01.png
- P3-t4-04: 일정 줄을 누르자 일정 상세 화면이 아니라 일정 목록 화면(/schedules/3, '다가오는 일정' 목록)으로 가고, 누른 일정 카드가 주황 배경으로 강조된다. 근거: A/raw/P3-t4/step-02.png, A/raw/P3-t4/task-02.mjs
- P3-t4-05: 일정 목록 카드에는 '관련 뉴스' 같은 글 표시가 없다. 일정 제목 자체가 링크(/2026-10-23#IT·AI-s1)이고, 그 아래 '이슈: 가짜은행 기준금리 흐름 33' 링크(/issues/33)가 따로 있다. 제목이 링크라는 것은 밑줄 없이 굵은 글씨로만 보인다. 근거: A/raw/P3-t4/step-02.png, A/raw/P3-t4/task-02.mjs 출력
- P3-t4-06: 일정 제목 링크 높이는 21px, 이슈 링크 높이는 15px이다. 근거: A/raw/P3-t4/task-02.mjs 출력
- P3-t4-07: 일정 제목을 누르자(걸음 3) 10월 23일 브리프의 IT·AI 탭으로 이동해 '짧은 소식' 중 '가짜연구소 기준금리를 결론을 미뤘다, 관계자들은 다음 달 발표를 지켜봐' 항목이 화면 맨 위로 스크롤되고 회색 배경으로 강조된다(scrollY 940). 그 항목의 이슈 링크가 일정 카드와 같은 '가짜은행 기준금리 흐름 33'이다. 근거: A/raw/P3-t4/step-03.png, A/raw/P3-t4/task-03.mjs
- P3-t4-08: 이동한 날짜는 10월 23일로, 일정 날짜(11-11)·시작 날짜(11-06)와 다르다. 화면 위 날짜 표시는 '10월 23일 (금)'로 바뀌었다. 근거: A/raw/P3-t4/step-03.png
- P3-t4-09: 도착한 뉴스 항목의 읽음 버튼이 누르지 않았는데 켜진 상태(파란 체크, aria-pressed="true")다. 근거: A/raw/P3-t4/step-03.png, A/raw/P3-t4/task-04-check.mjs 출력
- P3-t4-10: 걸음 4에서 강조된 뉴스 항목(버튼, class short-text)을 눌러 더 열리는지 봤으나 화면이 바뀌지 않았다(펼침 속성 없음, 내용 같음). 짧은 소식은 제목·분야·이슈 줄 외에 열 내용이 없었다. 근거: A/raw/P3-t4/step-04.png, A/raw/P3-t4/task-04.mjs, A/raw/P3-t4/task-04-check.mjs
- P3-t4-11: 걸음 3 화면에는 '짧은 소식 틀린 내용 알리기 · <공개 제보 메일>' mailto 링크가 있고 누르지 않았다. 앱 밖 링크는 누르지 않았다. 근거: A/raw/P3-t4/task-03.mjs 출력
- P3-t4-12: 걸음 수 4(첫 화면 보기 1, 누르기 3), 스크롤 0. 과제는 걸음 3에서 관련 뉴스 항목에 도착해 끝났고, 걸음 4는 변화가 없는 누르기였다. 근거: A/raw/P3-t4/step-01.png ~ A/raw/P3-t4/step-04.png

TASK: {"task": "이번 주에 예정된 일정 하나를 찾아, 그 일정과 관련된 뉴스를 연다", "success": true, "steps": 4, "wrongClicks": ["걸음 4: 도착한 짧은 소식 항목을 눌렀으나 아무 변화 없음(더 열 내용 없음)"], "stuck": ["걸음 2: 일정 줄을 누르면 상세가 아니라 일정 목록으로 가고, 카드에 '관련 뉴스' 표시가 없어 제목 링크가 뉴스로 가는지 눌러 봐야 알았다"]}

완료


## P3 과제 5

# P3-t5 읽음 표시 후 안 읽은 것만 보기 (폭 1280)
- P3-t5-01 시작 화면(/)은 11월 6일 브리프의 '한국' 탭이 열려 있고, 뉴스마다 오른쪽 끝에 빈 동그라미(읽음 버튼)가 있다. 근거 A/raw/P3-t5/s1.png, A/raw/P3-t5/task-1.mjs
- P3-t5-02 맨 위 두 뉴스(우주 발사체와 다시 논의한다 / 지방선거는 줄었다)의 동그라미를 누르니 파란 체크로 바뀌고 제목 글씨가 가늘어졌다. 2걸음. 근거 A/raw/P3-t5/s2b.png, A/raw/P3-t5/task-2.mjs
- P3-t5-03 '안 읽은 것만' 칩(글 목록 위, 구분선 오른쪽)을 누르니 칩이 검게 채워지고 읽은 두 뉴스가 사라져 세 번째 뉴스부터 나온다(짧은 소식 포함 안 읽은 것만 남음). 근거 A/raw/P3-t5/s3.png, A/raw/P3-t5/task-3.mjs
- P3-t5-04 하단 탭 '세계'로 옮겨도 '안 읽은 것만' 칩은 켜진 채 유지되고 세계 탭의 안 읽은 뉴스가 보인다. 근거 A/raw/P3-t5/s3b.png
- P3-t5-05 필터 적용 뒤 목록에 '읽은 N건 숨김' 같은 안내는 보이지 않았다. 근거 A/raw/P3-t5/s3.png
- P3-t5-06 헤맨 곳·잘못 누른 곳 없음. 읽음 버튼은 동그라미 모양이라 처음엔 라벨 없이 아이콘만 보였으나 누르니 체크로 바뀌어 이해됨.
TASK: {"task": "맨 위 뉴스 두 개를 읽음 표시한 뒤 안 읽은 것만 훑어보기", "success": true, "steps": 3, "wrongClicks": [], "stuck": []}
완료

