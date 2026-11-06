# 기준선

## 화면 목록

라우트(`site/src/lib/routes.ts`)와 메뉴(`site/src/lib/menu.ts`)에서 뽑았다. 같은 템플릿은 한 묶음이다.

| 묶음 | 라우트 | 대표 | 주요 |
|---|---|---|---|
| G1 브리프 | `/`, `/:date` | `/` (가장 최근 날짜) | 시작 화면 |
| G2 날짜 목록 | `/dates` | 같음 | |
| G3 이슈 목록 | `/issues` | 같음 | |
| G4 이슈 페이지 | `/issues/:id` | 전개가 가장 많은 이슈 | 주요 |
| G5 인물·기관·국가 목록 | `/entities` | 같음 | |
| G6 인물·기관·국가 페이지 | `/entities/:id` | 연결 뉴스가 가장 많은 것 | |
| G7 용어 사전 | `/terms`, `/terms/:id` | `/terms` | |
| G8 일정 | `/schedules`, `/schedules/:id` | `/schedules` | 주요 |
| G9 지표 목록 | `/indicators` | 같음 | |
| G10 지표 페이지 | `/indicators/:id` | `/indicators/kospi` (테스트 데이터의 고정 식별자) | |
| G11 영상 페이지 | `/videos/:date/:id` | 가장 최근 날짜에서 구간이 가장 많은 영상 | 주요 |
| G12 검색 | `/search?q=` | `q=가짜` (테스트 데이터의 공통 낱말) | 주요 |
| G13 소개 | `/about` | 같음 | |
| G14 개인정보 처리방침 | `/privacy`(`PRIVACY_PATH`) | 같음 | |
| G15 없는 페이지 | 그 밖 | `/no-such-page` | |

## 상태와 만드는 법

모든 묶음의 정상 상태를 375·1280 × 라이트·다크로 찍는다. 나머지 상태는 라이트만 찍는다. 서버 네 벌은 `report.md` 실행 조건에 있다.

| 상태 | 만드는 법 | 묶음 |
|---|---|---|
| 정상 | 정상 서버(4401)에서 주소만 | 전체 |
| 브리프 영상·빌더·수요 탭 | 주소 해시 `#videos`, `#builder`, `#demand` | G1 |
| 브리프 펼친 카드 | `setup-open.mjs`: 첫 `.list .item-btn`을 누른다 | G1 |
| 브리프 일정 상자 접힘 | 해당 없음(정상 상태에 펼친 상자가 보인다) | |
| 많은 데이터 | 많은 데이터 서버(4403) | G1, G3, G4, G5, G8, G12 |
| 빈 상태 | 빈 서버(4402) | G1, G3, G8, G12(`q=` 없는 낱말: `q=없는낱말xyz`는 정상 서버) |
| 오류 | 오류 서버(4404)의 `/` | G1 |
| 대기(로딩) | `setup-loading.mjs`: `site-data/` 요청을 30초 미루고 다시 읽는다 | G1, G4 |
| 긴 텍스트 | 정상 데이터에 긴 제목·긴 글 상태가 섞여 있다(수요 탭의 긴 글 날 등). 따로 찍지 않는다 | |
| 다크 | 같은 주소, `colorScheme: dark` | 정상 상태 전체 |

## 첫눈 정답 목록

| 화면 | 1순위 | 맞음으로 볼 영역 |
|---|---|---|
| 브리프 | 뉴스 목록의 첫 제목들 | 대분류 줄 아래 굵은 뉴스 제목(첫 항목 제목), 뉴스 목록 |
| 이슈 페이지 | 지금까지 요약 | 이슈 이름(`h1`) 아래의 요약 문단(`.summary`) |
| 영상 페이지 | 구간 목록 | 시각 링크와 구간 제목이 있는 줄들 |
| 일정 | 가까운 일정 목록 | 날짜와 일정 이름 줄 |
| 검색 | 결과 목록 | 결과 묶음 제목(인물·기관·국가, 용어, 이슈, 뉴스)과 그 아래 줄 |

## 첫눈 사진 대응표

| 사진 | 화면 | 상태 | 폭 |
|---|---|---|---|
| look-01 | 브리프 | 정상(첫 화면, 라이트) | 375 |
| look-02 | 브리프 | 정상(첫 화면, 라이트) | 1280 |
| look-03 | 이슈 페이지 | 정상(첫 화면, 라이트) | 375 |
| look-04 | 이슈 페이지 | 정상(첫 화면, 라이트) | 1280 |
| look-05 | 영상 페이지 | 정상(첫 화면, 라이트) | 375 |
| look-06 | 영상 페이지 | 정상(첫 화면, 라이트) | 1280 |
| look-07 | 일정 | 정상(첫 화면, 라이트) | 375 |
| look-08 | 일정 | 정상(첫 화면, 라이트) | 1280 |
| look-09 | 검색 | 정상(첫 화면, 라이트) | 375 |
| look-10 | 검색 | 정상(첫 화면, 라이트) | 1280 |

## 과제 (P3)

1. (S1, 가장 자주 하는 일) 오늘 올라온 뉴스 중 IT·AI 소식 하나를 골라 내용을 읽는다.
2. (S2) 개발 도구 변화 중 기한이 정해진 것에 대해, 언제까지 무엇을 해야 하는지 알아낸다.
3. (S3, 처음 하는 일) 한 뉴스가 이어지는 큰 이야기의 지금까지 흐름을 보고, 보던 날짜의 브리프로 돌아온다.
4. (S3·S4) 이번 주에 예정된 일정 하나를 찾아, 그 일정과 관련된 뉴스를 연다.
5. (반복 사용, L2) 이미 읽은 뉴스는 빼고, 아직 읽지 않은 뉴스만 훑어본다(먼저 맨 위 뉴스 둘을 읽었다고 표시한 뒤).

## 화면 묶음별 레퍼런스

사용자 확인(2026-11-06, "후보대로"). 이름과 주소만 둔다.

| 묶음 | 레퍼런스 |
|---|---|
| G1 브리프 | Kagi News `https://kite.kagi.com`, Techmeme `https://www.techmeme.com/` (기준 문서 결정 기록) |
| G4 이슈 페이지 | Kagi News 이야기 펼침(같은 주소), Wikipedia 현재 사건 문서 `https://en.wikipedia.org/wiki/Portal:Current_events` |
| G11 영상 페이지 | YouTube 챕터가 있는 영상 설명 `https://www.youtube.com/`, Snipd 공개 페이지 `https://share.snipd.com/` |
| G8 일정 | Investing.com 경제 캘린더 `https://www.investing.com/economic-calendar/` |
| G12 검색 | 없음(측정·과제 근거만) |

## 결정 출처 목록

**확정 결정(부딪치면 뒤집기로만)**
- `docs/design.md` 전체(방향, 토큰, 컴포넌트 규칙, 하지 말 것). 특히: 강조색은 한 화면 한 역할, 상자를 늘리지 않음, 정정 표시는 글자 하나, 빌더·수요 칸 순서 고정과 늘 펼침, 영상 줄의 끝 표시로 동작 구분
- `docs/memory.md` 2026-11-01: 9.5 지적 중 앱 상단 44px·R11·정정 건수 입구·펼침 표시·긴 칩·`.ev` 폭·정적 메뉴 순서는 그대로 둔다(앱 상단 44px은 "다음 디자인 작업에서 줄 높이와 함께")
- `docs/memory.md` 2026-11-01: 영상 페이지 시각 안내는 구간 목록 앞 두 줄, 영상 페이지에서 돌아올 때 칩·펼침·스크롤이 풀리는 것은 그대로
- `docs/memory.md` 2026-11-01: 영상 구간 글 300~500자, 한 줄 요지 + 불릿 3~5개(C11)
- `docs/memory.md` 2026-11-02: 9.8 결과 검토의 칩·기한 색·정정 머리말은 그대로
- `docs/memory.md` 2026-11-02: 9.9 디자인 점검 경미 지적 11건은 그대로
- `docs/memory.md` 2026-10-29: 모바일 앱·PWA 하지 않음(다시 제안하지 않음 아님, 지금은 안 함)
- 9.97 명세 S7(원래 숫자 그대로), S12(칸 이름), 9.97 4.4-1(칸 순서)
- 약관·정책상 화면 요소: 출처 표시·원문 링크(뉴스·빌더·수요), YouTube 약관·처리방침 링크와 영상 제목 원문(7·8단계, YouTube API 정책 III.A·III.I), 정정·제보 통로(9.5 R1·R2), 커뮤니티 소스 표본 설명(9.98 `source-terms.md`)

**다시 보기로 미룬 판단(안건)**
- 항목 위계, 탭 위 요약, 칸 접기, 묶음 이동(2026-11-02, "첫 실행 일주일 뒤")
- 앱 상단 44px, 줄 높이(2026-11-01, "다음 디자인 작업")
- 글자 크기 단계 합치기 R11, 모든 뉴스 줄 펼침 표시(`docs/design.md` 사람이 정할 일)
- 9.8 사용자 판단 1~5(위계, 탭 위 요약 접기, '안 읽은 것만' 칩, 기한 강조색, 정정 머리말)
- 9.97 사용자 판단: 근거 수준 줄 위치, 늘 펼침, 섹션 탭 키보드(검증된 탭 패턴), 소개의 혼자 놓인 링크
- 9.98 사용자 판단: 소개 목록 링크 누를 곳, 커뮤니티 근거 줄 무게, 소개 수요 절 소제목, `--ring` 대비
- 9.6 사용자 판단: 브리프 칩 28px·이슈 칩 29px
- 9.8 제안: '‹ 브리프'가 보던 날짜를 잃음, 일정 상자 탭·접기·전체 링크 44px 미만, 하단 탭이 문서 끝

**지난 감사의 가설**: 없음(첫 감사)

## 객관 관문 실패 목록

`A/raw/gate/result.md`의 G-ID별 종류·화면·상태·폭이다(요소 글은 옮기지 않는다).

| G-ID | 종류 | 화면-상태-폭[-테마] |
|---|---|---|
| G-01 | 누를 곳 24px 미만 | about-normal-1280-dark |
| G-02 | 글자 크기 종류 6종 초과 | about-normal-1280-dark |
| G-03 | 누를 곳 24px 미만 | about-normal-1280 |
| G-04 | 글자 크기 종류 6종 초과 | about-normal-1280 |
| G-05 | 누를 곳 24px 미만 | about-normal-375-dark |
| G-06 | 모바일 누를 곳 44px 미만 | about-normal-375-dark |
| G-07 | 글자 크기 종류 6종 초과 | about-normal-375-dark |
| G-08 | 누를 곳 24px 미만 | about-normal-375 |
| G-09 | 모바일 누를 곳 44px 미만 | about-normal-375 |
| G-10 | 글자 크기 종류 6종 초과 | about-normal-375 |
| G-11 | axe target-size(serious) | brief-big-1280 |
| G-12 | 글자 크기 종류 6종 초과 | brief-big-1280 |
| G-13 | axe target-size(serious) | brief-big-375 |
| G-14 | 모바일 누를 곳 44px 미만 | brief-big-375 |
| G-15 | 글자 크기 종류 6종 초과 | brief-big-375 |
| G-16 | 글자 크기 종류 6종 초과 | brief-builder-1280 |
| G-17 | 모바일 누를 곳 44px 미만 | brief-builder-375 |
| G-18 | 글자 크기 종류 6종 초과 | brief-builder-375 |
| G-19 | 글자 크기 종류 6종 초과 | brief-demand-1280 |
| G-20 | 모바일 누를 곳 44px 미만 | brief-demand-375 |
| G-21 | 글자 크기 종류 6종 초과 | brief-demand-375 |
| G-22 | 글자 크기 종류 6종 초과 | brief-error-1280 |
| G-23 | 모바일 누를 곳 44px 미만 | brief-error-375 |
| G-24 | 글자 크기 종류 6종 초과 | brief-error-375 |
| G-25 | 글자 크기 종류 6종 초과 | brief-normal-1280-dark |
| G-26 | 글자 크기 종류 6종 초과 | brief-normal-1280 |
| G-27 | 모바일 누를 곳 44px 미만 | brief-normal-375-dark |
| G-28 | 글자 크기 종류 6종 초과 | brief-normal-375-dark |
| G-29 | 모바일 누를 곳 44px 미만 | brief-normal-375 |
| G-30 | 글자 크기 종류 6종 초과 | brief-normal-375 |
| G-31 | 글자 크기 종류 6종 초과 | brief-open-1280 |
| G-32 | 모바일 누를 곳 44px 미만 | brief-open-375 |
| G-33 | 글자 크기 종류 6종 초과 | brief-open-375 |
| G-34 | 누를 곳 24px 미만 | brief-videos-1280 |
| G-35 | 글자 크기 종류 6종 초과 | brief-videos-1280 |
| G-36 | 콘솔 오류(404 응답) | brief-videos-1280 |
| G-37 | 누를 곳 24px 미만 | brief-videos-375 |
| G-38 | 모바일 누를 곳 44px 미만 | brief-videos-375 |
| G-39 | 글자 크기 종류 6종 초과 | brief-videos-375 |
| G-40 | 콘솔 오류(404 응답) | brief-videos-375 |
| G-41 | 모바일 누를 곳 44px 미만 | entities-big-375 |
| G-42 | 모바일 누를 곳 44px 미만 | entities-normal-375-dark |
| G-43 | 모바일 누를 곳 44px 미만 | entities-normal-375 |
| G-44 | 글자 크기 종류 6종 초과 | entity-normal-1280-dark |
| G-45 | 글자 크기 종류 6종 초과 | entity-normal-1280 |
| G-46 | 모바일 누를 곳 44px 미만 | entity-normal-375-dark |
| G-47 | 글자 크기 종류 6종 초과 | entity-normal-375-dark |
| G-48 | 모바일 누를 곳 44px 미만 | entity-normal-375 |
| G-49 | 글자 크기 종류 6종 초과 | entity-normal-375 |
| G-50 | 글자 크기 종류 6종 초과 | indicator-normal-1280-dark |
| G-51 | 글자 크기 종류 6종 초과 | indicator-normal-1280 |
| G-52 | 모바일 누를 곳 44px 미만 | indicator-normal-375-dark |
| G-53 | 글자 크기 종류 6종 초과 | indicator-normal-375-dark |
| G-54 | 모바일 누를 곳 44px 미만 | indicator-normal-375 |
| G-55 | 글자 크기 종류 6종 초과 | indicator-normal-375 |
| G-56 | 누를 곳 24px 미만 | indicators-normal-1280-dark |
| G-57 | 글자 크기 종류 6종 초과 | indicators-normal-1280-dark |
| G-58 | 누를 곳 24px 미만 | indicators-normal-1280 |
| G-59 | 글자 크기 종류 6종 초과 | indicators-normal-1280 |
| G-60 | 모바일 누를 곳 44px 미만 | indicators-normal-375-dark |
| G-61 | 글자 크기 종류 6종 초과 | indicators-normal-375-dark |
| G-62 | 모바일 누를 곳 44px 미만 | indicators-normal-375 |
| G-63 | 글자 크기 종류 6종 초과 | indicators-normal-375 |
| G-64 | 글자 크기 종류 6종 초과 | issue-normal-1280-dark |
| G-65 | 글자 크기 종류 6종 초과 | issue-normal-1280 |
| G-66 | 모바일 누를 곳 44px 미만 | issue-normal-375-dark |
| G-67 | 글자 크기 종류 6종 초과 | issue-normal-375-dark |
| G-68 | 모바일 누를 곳 44px 미만 | issue-normal-375 |
| G-69 | 글자 크기 종류 6종 초과 | issue-normal-375 |
| G-70 | 글자 크기 종류 6종 초과 | issues-big-1280 |
| G-71 | 모바일 누를 곳 44px 미만 | issues-big-375 |
| G-72 | 글자 크기 종류 6종 초과 | issues-big-375 |
| G-73 | 글자 크기 종류 6종 초과 | issues-empty-1280 |
| G-74 | 모바일 누를 곳 44px 미만 | issues-empty-375 |
| G-75 | 글자 크기 종류 6종 초과 | issues-empty-375 |
| G-76 | 글자 크기 종류 6종 초과 | issues-normal-1280-dark |
| G-77 | 글자 크기 종류 6종 초과 | issues-normal-1280 |
| G-78 | 모바일 누를 곳 44px 미만 | issues-normal-375-dark |
| G-79 | 글자 크기 종류 6종 초과 | issues-normal-375-dark |
| G-80 | 모바일 누를 곳 44px 미만 | issues-normal-375 |
| G-81 | 글자 크기 종류 6종 초과 | issues-normal-375 |
| G-82 | 콘솔 오류(404 응답) | notfound-normal-1280-dark |
| G-83 | 콘솔 오류(404 응답) | notfound-normal-1280 |
| G-84 | 콘솔 오류(404 응답) | notfound-normal-375-dark |
| G-85 | 콘솔 오류(404 응답) | notfound-normal-375 |
| G-86 | 누를 곳 24px 미만 | privacy-normal-1280-dark |
| G-87 | 누를 곳 24px 미만 | privacy-normal-1280 |
| G-88 | 누를 곳 24px 미만 | privacy-normal-375-dark |
| G-89 | 모바일 누를 곳 44px 미만 | privacy-normal-375-dark |
| G-90 | 누를 곳 24px 미만 | privacy-normal-375 |
| G-91 | 모바일 누를 곳 44px 미만 | privacy-normal-375 |
| G-92 | 누를 곳 24px 미만 | schedules-big-1280 |
| G-93 | 글자 크기 종류 6종 초과 | schedules-big-1280 |
| G-94 | 누를 곳 24px 미만 | schedules-big-375 |
| G-95 | 모바일 누를 곳 44px 미만 | schedules-big-375 |
| G-96 | 글자 크기 종류 6종 초과 | schedules-big-375 |
| G-97 | 모바일 누를 곳 44px 미만 | schedules-empty-375 |
| G-98 | 누를 곳 24px 미만 | schedules-normal-1280-dark |
| G-99 | 글자 크기 종류 6종 초과 | schedules-normal-1280-dark |
| G-100 | 누를 곳 24px 미만 | schedules-normal-1280 |
| G-101 | 글자 크기 종류 6종 초과 | schedules-normal-1280 |
| G-102 | 누를 곳 24px 미만 | schedules-normal-375-dark |
| G-103 | 모바일 누를 곳 44px 미만 | schedules-normal-375-dark |
| G-104 | 글자 크기 종류 6종 초과 | schedules-normal-375-dark |
| G-105 | 누를 곳 24px 미만 | schedules-normal-375 |
| G-106 | 모바일 누를 곳 44px 미만 | schedules-normal-375 |
| G-107 | 글자 크기 종류 6종 초과 | schedules-normal-375 |
| G-108 | 글자 크기 종류 6종 초과 | search-big-1280 |
| G-109 | 글자 크기 종류 6종 초과 | search-big-375 |
| G-110 | 글자 크기 종류 6종 초과 | search-normal-1280-dark |
| G-111 | 글자 크기 종류 6종 초과 | search-normal-1280 |
| G-112 | 글자 크기 종류 6종 초과 | search-normal-375-dark |
| G-113 | 글자 크기 종류 6종 초과 | search-normal-375 |
| G-114 | 누를 곳 24px 미만 | terms-normal-1280-dark |
| G-115 | 글자 크기 종류 6종 초과 | terms-normal-1280-dark |
| G-116 | 누를 곳 24px 미만 | terms-normal-1280 |
| G-117 | 글자 크기 종류 6종 초과 | terms-normal-1280 |
| G-118 | 모바일 누를 곳 44px 미만 | terms-normal-375-dark |
| G-119 | 글자 크기 종류 6종 초과 | terms-normal-375-dark |
| G-120 | 모바일 누를 곳 44px 미만 | terms-normal-375 |
| G-121 | 글자 크기 종류 6종 초과 | terms-normal-375 |
| G-122 | 누를 곳 24px 미만 | video-normal-1280-dark |
| G-123 | 글자 크기 종류 6종 초과 | video-normal-1280-dark |
| G-124 | 누를 곳 24px 미만 | video-normal-1280 |
| G-125 | 글자 크기 종류 6종 초과 | video-normal-1280 |
| G-126 | 누를 곳 24px 미만 | video-normal-375-dark |
| G-127 | 모바일 누를 곳 44px 미만 | video-normal-375-dark |
| G-128 | 글자 크기 종류 6종 초과 | video-normal-375-dark |
| G-129 | 누를 곳 24px 미만 | video-normal-375 |
| G-130 | 모바일 누를 곳 44px 미만 | video-normal-375 |
| G-131 | 글자 크기 종류 6종 초과 | video-normal-375 |

종류별 수: 글자 크기 종류 6종 초과 64, 모바일 누를 곳 44px 미만 35, 누를 곳 24px 미만 24, 콘솔 오류(404 응답) 6, axe target-size(serious) 2

- 가로 스크롤, 잘린 글, 모바일 입력 글자는 실패 0이다.
- 콘솔 오류 중 없는 페이지 4건은 그 페이지 자체가 404로 오는 것이고, 영상 탭 2건은 지어낸 데이터의 썸네일 주소가 없는 것이다(테스트 데이터 탓으로 보고 원인으로 쓰지 않는다).
- 글자 크기 종류는 `docs/design.md`의 알려진 예외(R11)다. 정상 상태 라이트 기준 화면별 종류 수: 브리프 14, 이슈·인물·지표 페이지 10, 영상 9, 일정 9, 소개·지표 목록·검색 8, 이슈 목록·용어 7, 그 밖 6.

촬영 완료(104장)

## 조사 모델

| 조사 | 모델 |
|---|---|
| P1 패턴 인벤토리 | 기본(메인과 같은 Opus) |
| P2 정보 지도 | sonnet |
| P4 레퍼런스 대비 | opus |
| P5 시각 측정 | sonnet |
| P3 첫눈 1·2·3 | 기본 · sonnet · opus |
| P3 과제 1~5 | 기본(1280) · sonnet(375) · opus(1280) · 기본(375) · sonnet(1280) |

## P3 결과

| 과제 | success | 걸음 | 잘못 누름 | 헤맨 곳 |
|---|---|---|---|---|
| 1 IT·AI 소식 읽기 | 참 | 5 | 1: '한국' 탭에서 대분류 칩 'IT·AI'를 눌러 빈 목록 | 'IT·AI'가 대분류 칩 줄과 하단 섹션 탭 두 곳에 있음 |
| 2 도구 변화 기한과 할 일 | 참 | 5 | 0 | '개발 도구 변화'가 어느 탭인지 '빌더' 이름으로 짐작, 확정 기한만 강조색 밑줄이라 눌러도 되는지 헷갈림, 첫 기한까지 약 740px·네 항목 약 1800px 스크롤 |
| 3 이슈 흐름 보고 보던 날짜로 돌아오기 | 참 | 4 | 1: 닫힌 줄의 '이어지는 이야기: …' 글자를 눌렀더니 이슈로 가지 않고 줄이 펼쳐짐 | 이슈 페이지에서 브리프로 돌아가는 링크가 없어 '‹ 이슈'와 타임라인 줄 사이에서 망설임 |
| 4 이번 주 일정의 관련 뉴스 열기(375) | 참 | 4 | 1: 도착한 짧은 소식을 눌렀으나 변화 없음 | 일정 줄을 누르면 상세가 아닌 일정 목록으로 가고, 일정 제목이 밑줄 없는 굵은 글자라 링크인지 눌러 봐야 앎. 누를 곳 높이 15~30px |
| 5 안 읽은 것만 훑기(반복 사용) | 참 | 3 | 0 | 없음 |

첫눈 맞춤 결과는 `inventory.md` 첫 절에 있다.
