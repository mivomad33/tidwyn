# 결과 보고서: U1 사이트 전체 정리

명세서: [spec.md](spec.md) · 진행 기록: [progress.md](progress.md) · 작업 브랜치 `spec/stageU1-site-cleanup`(worktree `../tidwyn-stageU1`, push하지 않음)

## 사용자가 할 일

1. **글자 크기와 부품 모양 확인:** 아래 "스크린샷"의 전·후(브리프 375·1280, 펼친 카드, 일정, 이슈 페이지, 영상 페이지)를 보고 그대로 둘지 정한다. 원본은 `screenshots/`(git이 무시, 이 폴더에만 있음)에 있다.
2. **실제 폰 확인(머지 뒤, 머지 승인의 조건 아님):** 배포된 사이트에서 지난 날짜 브리프 → 펼친 카드의 '이어지는 이야기' → 이슈 페이지 → '‹ M월 D일 브리프'를 눌러 같은 날짜·탭·펼친 카드·스크롤로 돌아오는지, 이어서 폰의 뒤로 밀기가 이슈 페이지를 다시 열지 않는지 본다.
3. **머지 승인:** 직접 머지하지 않는다. 보고서 맨 위의 사용자 확인 항목이 끝나면 새 세션에서 `/review-done`으로 이 보고서를 검토하고, 통과와 머지를 승인하면 `review-done`이 머지하고 `docs/specs/README.md`의 상태를 '완료'로 바꾼다. 머지하면: 예약 실행과 겹치지 않는 때(명세서 7장: 00:00~05:49, 또는 그날 `/brief`가 `data` push 뒤 공식 수요 받기를 마친 뒤)에 메인 폴더에서 main에 squash merge → `node src/cli.ts precheck` → `git push origin main` → worktree와 브랜치 삭제. CI는 없다. 사이트는 다음 `/brief`가 빌드·배포할 때 바뀐다.
4. **정함(디자인 점검, U2로 넘김):** 일정 화면(목록·달력)의 일정 이름은 그 일정을 처음 실은 브리프 뉴스로 가고, 브리프 '이번 주 일정' 상자의 같은 이름은 일정 화면의 그 일정으로 간다(design.md C3 '같은 이름은 어느 자리에서나 같은 동작'과 다름). 60aab61부터의 동작이지만 U1에서 일정 이름에 제목 자리 밑줄이 생겨 더 눈에 띈다. 과제 수행 2('이번 주 일정 하나를 찾아 관련 뉴스를 연다')는 성공했지만 이 링크로 예상 밖 날짜의 브리프로 가 잘못 누름으로 세어졌다(명세서 4.5-3의 '잘못 누름 없이'를 다 채우지 못함). 권하는 안: 일정 이름은 링크로 두지 않거나 어디서나 일정 화면의 그 일정으로 보내고, 출처 뉴스는 '출처 뉴스 ›' 글 링크로 따로 둔다(이 브랜치에서 고칠지, U2로 넘길지).
- 보류: 없음. 승인할 제안: 아래 "제안"(모두 범위 밖, 지금 할 일 아님).

## 만든 것

- 글자 크기를 토큰 여섯 단계(22/19/17/16/14/12px, `--fs-*`)로 합쳤다. 모든 화면이 6종 이하다.
- 같은 역할 부품을 하나로: 다른 화면으로 가는 알약 칩과 제자리에서 여는 용어 칩(▾), 면 없는 줄 안 표시(배지 '어제에 이어'만 예외), 닫힌 뉴스 줄의 이슈 이름 제거, 공통 고르기 부품 `Segmented`(일정 보기·구분, 지표 기간, 브리프 위 상자 탭), 흐린 글자 + 밑줄의 글 링크, 같은 모양의 구역 제목, 공통 빈 상태 `Empty`와 '이 날', 앱 밖 링크의 ↗, '/'로 가는 링크 이름 '최근 브리프'.
- 날짜: 'M월 D일', 해가 다르면 'YYYY년 M월 D일', 좁은 자리 'MM-DD'(해가 다르면 `'25 12-30`). 화면 글에 'YYYY-MM-DD'가 없다. 지표 변화는 어느 자리든 값 변화와 %.
- 되돌아가기: '‹ 브리프'가 들어온 브리프로 간다. 바로 앞 기록이 그 브리프면 기록을 되돌려 탭·펼친 카드·칩·스크롤이 돌아온다. 지난 날짜면 '‹ M월 D일 브리프'. 이슈 페이지는 브리프에서 왔으면 '‹ 브리프' 계열, 아니면 '‹ 이슈'. 주소로 연 탭도 기억한다. 저장은 `history.state`뿐이다(새 저장 키 없음).
- `docs/design.md`에 위 규칙과 U2에서 풀 알려진 예외를 적었다.

## 전·후 값(4.1-2·4.1-3·4.5-4)

2026-11-06, 측정 데이터(지어낸 18일치)로 60aab61과 이 브랜치를 같은 조건으로 쟀다(측정 도구 `shoot.mjs`, 누를 곳은 자르지 않고 셈). 왼쪽이 60aab61, 오른쪽이 이 브랜치다.

| 화면 | 글자 크기 종류 | typeCombos | axe 위반 | 가로 스크롤 | 잘린 글 |
|---|---|---|---|---|---|
| about-1280 | 8→5 | 12→7 | 0→0 | False→False | 0→0 |
| about-375 | 8→5 | 12→7 | 0→0 | False→False | 0→0 |
| brief-1280 | 14→5 | 29→22 | 0→0 | False→False | 0→0 |
| brief-375 | 14→5 | 29→22 | 0→0 | False→False | 0→0 |
| brief-builder-1280 | 15→5 | 24→17 | 0→0 | False→False | 0→0 |
| brief-builder-375 | 15→5 | 24→17 | 0→0 | False→False | 0→0 |
| brief-demand-1280 | 14→5 | 21→17 | 0→0 | False→False | 0→0 |
| brief-demand-375 | 14→5 | 21→17 | 0→0 | False→False | 0→0 |
| brief-videos-1280 | 13→5 | 23→16 | 0→0 | False→False | 0→0 |
| brief-videos-375 | 13→5 | 23→16 | 0→0 | False→False | 0→0 |
| dates-1280 | 6→4 | 5→5 | 0→0 | False→False | 0→0 |
| dates-375 | 6→4 | 5→5 | 0→0 | False→False | 0→0 |
| entities-1280 | 6→4 | 6→6 | 0→0 | False→False | 0→0 |
| entities-375 | 6→4 | 6→6 | 0→0 | False→False | 0→0 |
| entity-1280 | 10→4 | 9→7 | 0→0 | False→False | 0→0 |
| entity-375 | 10→4 | 9→7 | 0→0 | False→False | 0→0 |
| indicator-1280 | 10→4 | 11→9 | 0→0 | False→False | 0→0 |
| indicator-375 | 10→4 | 11→9 | 0→0 | False→False | 0→0 |
| indicators-1280 | 8→5 | 9→7 | 0→0 | False→False | 0→0 |
| indicators-375 | 8→5 | 9→7 | 0→0 | False→False | 0→0 |
| issue-1280 | 10→4 | 10→7 | 0→0 | False→False | 0→0 |
| issue-375 | 10→4 | 10→7 | 0→0 | False→False | 0→0 |
| issues-1280 | 7→5 | 12→12 | 0→0 | False→False | 0→0 |
| issues-375 | 7→5 | 12→12 | 0→0 | False→False | 0→0 |
| notfound-1280 | 6→5 | 7→7 | 0→0 | False→False | 0→0 |
| notfound-375 | 6→5 | 7→7 | 0→0 | False→False | 0→0 |
| privacy-1280 | 6→4 | 7→6 | 0→0 | False→False | 0→0 |
| privacy-375 | 6→4 | 7→6 | 0→0 | False→False | 0→0 |
| schedules-1280 | 9→4 | 16→12 | 0→0 | False→False | 0→0 |
| schedules-375 | 9→4 | 16→12 | 0→0 | False→False | 0→0 |
| search-1280 | 8→5 | 16→16 | 0→0 | False→False | 0→0 |
| search-375 | 8→5 | 16→16 | 0→0 | False→False | 0→0 |
| terms-1280 | 7→4 | 9→7 | 0→0 | False→False | 0→0 |
| terms-375 | 7→4 | 9→7 | 0→0 | False→False | 0→0 |
| video-1280 | 9→4 | 12→9 | 0→0 | False→False | 0→0 |
| video-375 | 9→4 | 12→9 | 0→0 | False→False | 0→0 |

| 375 주소 | 44px 미만 | 24px 미만 |
|---|---|---|
| / | 14→14 | 0→0 |
| /#videos | 10→10 | 1→1 |
| /#builder | 5→5 | 0→0 |
| /#demand | 5→5 | 0→0 |
| /dates | 0→0 | 0→0 |
| /issues | 11→11 | 0→0 |
| /issues/28 | 13→12 | 0→0 |
| /entities | 4→4 | 0→0 |
| /entities/1 | 20→20 | 0→0 |
| /terms | 43→43 | 0→0 |
| /schedules | 28→28 | 17→17 |
| /indicators | 1→1 | 0→0 |
| /indicators/kospi | 4→4 | 0→0 |
| /videos/2026-11-06/Fx000000008 | 1→1 | 1→1 |
| /search?q=%EA%B0%80%EC%A7%9C | 0→0 | 0→0 |
| /about | 14→12 | 10→0 |
| /privacy | 5→4 | 5→0 |
| /no-such-page | 0→0 | 0→0 |

| 1280 주소 | 24px 미만 |
|---|---|
| / | 0→0 |
| /#videos | 1→1 |
| /#builder | 0→0 |
| /#demand | 0→0 |
| /dates | 0→0 |
| /issues | 0→0 |
| /issues/28 | 0→0 |
| /entities | 0→0 |
| /entities/1 | 0→0 |
| /terms | 28→28 |
| /schedules | 18→18 |
| /indicators | 1→1 |
| /indicators/kospi | 0→0 |
| /videos/2026-11-06/Fx000000008 | 1→1 |
| /search?q=%EA%B0%80%EC%A7%9C | 0→0 |
| /about | 13→1 |
| /privacy | 5→0 |
| /no-such-page | 0→0 |

## 스크린샷

| 화면 | 전(60aab61) | 후 |
|---|---|---|
| 브리프 375 | ![전](screenshots/brief-375-before.png) | ![후](screenshots/brief-375-after.png) |
| 브리프 1280 | ![전](screenshots/brief-1280-before.png) | ![후](screenshots/brief-1280-after.png) |
| 펼친 카드 375 | ![전](screenshots/card-375-before.png) | ![후](screenshots/card-375-after.png) |
| 일정 375 | ![전](screenshots/schedules-375-before.png) | ![후](screenshots/schedules-375-after.png) |
| 이슈 페이지 375 | ![전](screenshots/issue-375-before.png) | ![후](screenshots/issue-375-after.png) |
| 영상 페이지 375 | ![전](screenshots/video-375-before.png) | ![후](screenshots/video-375-after.png) |

## 요구사항별 상태와 근거

| 항목 | 상태 | 근거 |
|---|---|---|
| 4.1-1 토큰 | 만족 | `test/siteFontTokens.test.ts`(토큰 여섯 값, 모든 font-size가 토큰). 검사기 테스트가 `font-size: 15px`를 넣은 CSS를 잡는 것을 단언한다(기능 없이 실패: 옛 styles.css로 돌리면 '모든 font-size 선언' 실패). |
| 4.1-2 관문 6종 | 만족 | `test/e2e/stageU1.spec.ts` '4.1-2' 두 테스트(앱 18곳+펼친 카드, 정적 HTML). 측정 도구 전·후: 모든 화면 6종 이하(브리프 14→5, 빌더 15→5, 이슈 10→4, 영상 9→4, 일정 9→4), 보고서 표. 옛 빌드(E2E_U1_BASE_URL)에서 실패 확인. |
| 4.1-3 typeCombos | 만족 | 측정 도구: 브리프 375 29→22, 이슈 10→7, 영상 12→9(보고서 표). |
| 4.1-4 긴 글 | 만족 | 측정 도구 객관 관문: 36장 모두 가로 스크롤 없음·잘린 글 0. design-check 깨끗한 회차는 뒤 단계. |
| 4.2-1 알약 칩 | 만족 | `test/e2e/stageU1.spec.ts` '4.2-1' 다섯 테스트(S10 포함). |
| 4.2-2 사각 표시 | 만족 | `test/e2e/stageU1.spec.ts` '4.2-2' 두 테스트. |
| 4.2-3 닫힌 뉴스 줄 | 만족 | `test/e2e/stageU1.spec.ts` '4.2-3'. |
| 4.2-4 Segmented | 만족 | `test/siteSegmented.test.ts`(네 곳 공통 부품, 역할, 키보드), `test/e2e/stageU1.spec.ts` '4.2-4'. |
| 4.2-5 글 링크 | 만족 | `test/e2e/stageU1.spec.ts` '4.2-5·4.2-6' 글 링크 조합 1종·흐린 글자 + 밑줄, a.t 밑줄. |
| 4.2-6 구역 제목 | 만족 | `test/e2e/stageU1.spec.ts` '구역 제목의 (크기, 굵기, 색) 조합이 1종'. |
| 4.2-7 빈 상태 | 만족 | `test/siteCleanup.test.ts`('이날' 없음, 정적·앱 같은 Empty), `test/e2e/stageU1.spec.ts` '4.2-7' 두 테스트. |
| 4.2-8 앱 밖 ↗ | 만족 | `test/siteCleanup.test.ts` 4.2-8, `test/e2e/stageU1.spec.ts` '4.2-8'. |
| 4.2-9 같은 도착 이름 | 만족 | `test/siteCleanup.test.ts` 4.2-9, `test/e2e/stageU1.spec.ts` '4.2-9' 네 테스트. |
| 4.3-1 날짜 글 | 만족 | `test/siteDates.test.ts` 4.3-1 여섯 테스트, `test/siteNavState.test.ts` '해가 다르면'. 지표 화면(그래프 읽기 줄·요약, 지표 머리·카드·이슈 그래프의 값 날짜, 정적 지표)은 브라우저 점검이 짚은 것을 결과 검토에서 고쳤다: `test/siteIndicators.test.ts` '지표 화면의 날짜 글(4.3-1)'·'요약 글'·'그래프'. |
| 4.3-2 지표 변화 | 만족 | `test/siteDates.test.ts` 4.3-2, `test/e2e/stageU1.spec.ts` '4.3-2'. |
| 4.3-3 YYYY-MM-DD 없음 | 만족 | `test/siteDates.test.ts` 4.3-3(정적 HTML), `test/e2e/stageU1.spec.ts` '4.3-3'(앱 18곳). `dateText`가 일부러 'YYYY-MM-DD'를 내게 바꾸자 단위 4.3-3 두 테스트와 E2E 4.3-3이 실패했다(a4adfff 기준, 되돌림). |
| 4.4-1 '‹ 브리프' 도착 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-1' (a)~(e) 여섯 테스트, `test/siteNavState.test.ts`. |
| 4.4-2 이슈 페이지 되돌아가기 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-2·4.4-3' 두 테스트. |
| 4.4-3 되돌아가기 글 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-2·4.4-3', `test/siteNavState.test.ts` S2. 320·375 머리글 잘림은 browser-check·design-check에서 본다. |
| 4.4-4 탭 기억 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-4' 세 테스트, `test/siteNavState.test.ts` '저장 키'. |
| 4.4-5 기존 동작 유지 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-5' 세 테스트. |
| 4.5-1 design.md | 만족 | d70a5e7. result-auditor가 항목별로 대조한다. |
| 4.5-2 기존 기능 유지 | 만족 | `pnpm verify` 1495 통과, `pnpm e2e` 471 통과(c831cbd). 고친 기존 테스트와 이유는 아래 '고친 기존 테스트'. 스냅샷 113개는 바뀐 화면을 본 뒤 다시 찍었다. |
| 4.5-3 화면 확인 | 사용자 판단 | browser-check 29항목 중 통과 28(남은 1건 지표 날짜는 결과 검토에서 고침), design-check 2회차 깨끗한 회차, 과제 3/3 성공. 과제 2의 잘못 누름 2 중 하나가 일정 이름 링크의 목적지(맨 위 4)라 '잘못 누름 없이'는 그 결정에 달렸다. |
| 4.5-4 누를 곳 | 만족 | 측정 도구(자르지 않은 셈) 전·후 375 18곳 모두 늘지 않음(`/issues/28` 13→12, `/about` 14→12·10→0, `/privacy` 5→4·5→0, 나머지 같음), 1280 24px 미만도 늘지 않음. 보고서 표. |
| 4.5-5 공개 점검 | 만족 | 커밋마다 worktree에서 `node src/cli.ts precheck` 통과(마지막 c831cbd). 지어낸 데이터는 '가짜' 이름만. |
| 완료: 보고서 전·후 값·스크린샷 | 만족 | 이 보고서의 "전·후 값" 표와 "스크린샷"(원본은 git이 무시하는 `screenshots/`). |
| 완료: 새 패키지 없음 | 만족 | `git diff 60aab61 -- package.json pnpm-lock.yaml` 변화 없음. |
| 완료: 메인 폴더·data 그대로 | 만족 | 메인 폴더는 main·깨끗함, worktree만 고침. 실제 data/는 열지 않았다. |

### 새 테스트가 기능 없이 실패하는 것을 본 방법

- E2E `test/e2e/stageU1.spec.ts`: 60aab61로 같은 측정 데이터를 빌드해 띄우고(`E2E_U1_BASE_URL=http://127.0.0.1:4411 pnpm e2e test/e2e/stageU1.spec.ts`) 돌리면 37개 중 30개가 실패한다(a4adfff 기준 다시 확인). 통과한 7개는 이미 있던 동작이나 '모를 때'의 동작을 지키는 짝 테스트다: 4.2-1의 일정 '목록|달력', 인물 종류 칩 `?kind=`(S10), 거르기 칩 aria-pressed / 4.2-7 브리프·일정·이슈 목록·검색의 빈 상태(이미 공통 Empty, '이날'은 빌더·수요 쪽 짝 테스트가 실패) / 4.4-1 (d) 주소로 바로 연 일정 화면 / 4.4-2·4.4-3 이슈 목록·검색·주소에서 온 이슈 페이지의 '‹ 이슈' / 4.4-4 새 탭의 일정 화면 '‹ 브리프'. 각 요구사항에는 옛 빌드에서 실패하는 테스트가 함께 있다.
- 단위: `siteFontTokens`는 옛 styles.css로 실패, `siteSegmented`·`siteCleanup`·`siteDates`·`siteNavState`는 새 공통 부품·함수·문구를 import하거나 단언해 옛 코드에서는 실패한다(없는 모듈, '이날' 문구, 옛 날짜 모양). 4.3-3은 위 표대로 일부러 넣은 날짜로 실패를 봤다. '이번 주 일정' 기준 해 테스트는 고치기 전 코드로 실패를 봤다.

### 고친 기존 테스트

모두 이 명세서가 정한 동작을 단언하던 곳만 새 동작으로 바꿨다(4.5-2).

- '이날' → '이 날'(4.2-7, S11): builderSite, communitySite, demandSite, discoverSite, stage997, stage998.
- 날짜 글에서 같은 해는 해를 빼기(4.3-1): discoverSite(`repoUpkeepText`에 기준 해), stage98(`builderDueText`에 기준 해), siteEntities, siteSchedules, siteVideos.
- 지표 변화는 어느 자리든 값 변화와 %(4.3-2): siteIndicators.
- '/'로 가는 링크 이름 '최근 브리프'(4.2-9): stage3, stage4, stage95(메뉴의 같은 이름 링크가 있어 main 안으로 좁힘).
- 이슈 영상 링크 'M월 D일 브리프 영상'(4.2-9): stage7. 새로고침하면 칩이 '전체'로 돌아가는 기존 단언(stage7:76)은 그대로 두고 구현을 고쳤다(S12는 기록 이동만).
- 지표 화면의 날짜 글(4.3-1, 결과 검토에서 고침): siteIndicators(`chartSummary`·`LineChart` 기대 글을 기준 해와 같으면 해 없는 모양으로, 다른 해 경우를 더함), stage6 184·283행(읽기 줄 정규식: 1개월 값은 해 없음, 1년 값은 기준 해 2026이 아닐 때만 해. 1년 그래프는 고른 점이 지난해일 수 있어서다, 573f525).
- 끝 표시 HTML을 단언하던 siteSchedules·siteIndicators·siteVideos에 `class="mark"`를 더했다(끝 표시 공백 규칙을 `.mark` 클래스로 바꿈, 573f525).
- 펼친 카드 시각 회귀의 펼칠 단추 선택자를 뉴스 줄 단추(`button.item-btn`)로 좁혔다(visualU1, 코드 리뷰 지적).
- 앱 밖 링크의 ↗(4.2-8): stage7, stage97, stage98, stage99.
- 용어 칩 끝 ▾(4.2-1, S10): siteLib, stage4.
- `.bgroup-h` 15→16px(4.1-1): stage98.
- 시각 회귀 스냅샷 113개: 글자 크기·칩·링크 모양이 바뀐 화면. 바뀐 화면(브리프 375·1280, 펼친 카드, 일정, 이슈, 영상, 빌더, 정적 브리프, 빌더 다크)을 본 뒤 다시 찍었다.

## 마지막 검증

- 빌드·타입·린트·단위 테스트: `pnpm verify` 1496 통과. E2E: `pnpm e2e` 471 통과(a4adfff). 공개 전 점검: 커밋마다 worktree에서 통과.
- result-auditor: 1회차 sonnet, dfd7258(+ 커밋 전 수정 a4adfff 내용). 만족 4.1-1·4.1-2·4.2-1~9·4.3-1·4.3-2·4.4-1·4.4-2·4.4-4·4.4-5·4.5-1·4.5-2, 확인 불가 4.1-3·4.5-4(측정 값이 저장소 밖, 진행 기록 안에서는 일치), 대기 4.1-4·4.4-3의 머리글 잘림·4.5-3(browser-check·design-check 단계). 미흡 둘(커밋하지 않은 수정, 기능 없이 실패한 기록 부족)은 a4adfff·5b9550f로 채웠다. 2회차(고친 커밋 a4adfff만, sonnet, HEAD 5b9550f75f6795ece2133a53a83c731a0327af20): 4.3-1·4.4-1~5 유지 만족, `pnpm verify` 1496·`pnpm e2e` 471 통과, 진행 기록의 새 절이 코드·테스트와 일치. 지적한 JSDoc 중복은 다음 커밋에서 합쳤다.
- CI: 해당 없음(CI 없음).

### 재사용과 단순화

`/simplify`를 돌렸다(dfd7258).

- 고침: 기준 해는 `yearOf`로만 구한다(남은 `slice(0, 4)` 8곳), `latestYear`를 `format.ts`로 옮기고 정렬 없이 한 번 훑는다, 달 글(`monthName`, `chipDue`, `axisDates`)은 `dayOrMonthText`·`monthOnly`로, 브리프 기록 표시는 `navState.withBriefMark`로, `adoptState`는 `pushStateOf`로, BriefPage의 같은 계산(`restoredView`·`navOf`·`stateForHash`)은 한 번만, `BriefBackLink`는 `BackLink` 마크업을 쓴다(`Link`는 onClick이 `preventDefault`하면 다시 옮기지 않는다), 구간 시각 링크의 ↗는 `NewTabMark({ spoken: false })`, 상자 안 고르기 바탕은 `--segmented-on` 변수로.
- 하지 않음: 엔티티 목록의 기준 해를 `latestYear`로 바꾸기(목록이 날짜순이 아니라 동작이 바뀐다), 누를 곳 44px을 `.text-link`·`a.nrow` 기본 규칙으로 올리기(C7, U2 범위), `.seg` 버튼 채우기를 Segmented 변형으로 올리기와 기준 해를 Context로 내리기(바꾼 범위 밖까지 번짐, 보고서 제안), E2E 화면 순회를 한 번으로 모으기(테스트 구조 변경이 커서 제안), router의 `changed` 플래그 정리(첫 기록 판단이 얽혀 동작을 바꿀 위험).

### 코드 리뷰

- `/code-review high`(60aab61..dfd7258) 7건. 고침(a4adfff): 브리프 화면 '이번 주 일정' 줄의 기준 해를 브리프 날짜의 해로(펼친 카드 일정 칩과 같게, 새 단위 테스트), `Link`의 중복 검사. 고치지 않음: 인물 목록 기준 해가 첫 항목의 해인 것(전부터의 동작이고 명세서가 '그 화면이 정한다'로 둔 것), 영상 페이지 되돌아가기 글이 날짜 파일을 받은 뒤 바뀔 수 있는 것(받기 전에는 최근 날짜를 알 수 없다), `adoptState`·`goBack` 얇은 래퍼, E2E 화면 순회 중복(제안).
- 보안 리뷰(general-purpose 서브에이전트, 60aab61..dfd7258): 문제 없음. `security-review` 스킬이 메인 폴더 기준으로 빈 diff를 모아, 같은 기준으로 worktree diff를 직접 봤다(XSS, history.state로 만든 주소, 새 탭 링크, 비밀 값).

## 재량으로 정한 것

- 글자 크기 토큰 이름 `--fs-xl/lg/md/base/sm/xs`. 20px→19, 10~11.5px→12. 브라우저 기본 크기가 남는 요소(h1~h6, small, code, 폼 요소)에 토큰·inherit 기본 규칙을 둠(보이는 요소는 바뀌지 않고 sr-only 제목만 32·24→16px).
- 단계 1~4 커밋은 `pnpm verify` 통과로 커밋하고, 바뀐 동작 때문에 깨지는 E2E·시각 스냅샷은 6단계에서 한꺼번에 고친다(스냅샷은 화면을 본 뒤 다시 찍어야 해서 단계마다 찍으면 같은 일을 되풀이한다).
- 머리 날짜 링크의 이동 표시는 끝 › 대신 밑줄(바로 옆 다음 날짜 ›와 겹치지 않게).
- 영상 묶음 표시 `.tag`는 묶음 이름에 '·'가 들어 있어 700 글자색과 여백으로 구분.
- 넓은 화면의 구간 시각 칸 64→84px(↗가 들어가게).
- 이슈 페이지 타임라인 줄은 제목이 한 줄로 끝나면 35px이 되어(글자 크기 정리로 한 줄에 들어가는 제목이 생김) 4.5-4의 60aab61보다 늘었다. `.tl a.nrow`에 최소 높이 44px을 둬 13→12로 줄였다.
- 문장 안 글 링크(`.p a.text-link`)에 위아래 안쪽 여백 4px을 둬 줄은 그대로 두고 누르는 자리만 넓혔다. 60aab61에서 두 줄로 나뉘던 'CC BY 4.0'이 ↗가 붙어 한 줄이 되면서 `/about` 24px 미만이 10→11로 세어졌기 때문이다(4.5-4를 개수 그대로 읽는 엄격한 쪽). 결과 `/about` 375 10→0, 1280 13→1, `/privacy` 375 5→0, 1280 5→0.
- 출처 칩은 공통 `StorySources`(`site/src/components/sourceView.ts`), 빈 상태는 공통 `Empty`(`emptyView.ts`, `inline` 변형), 새 탭 표시는 `NewTabMark`.

## 보류한 것

없음.

## 쓴 비용

없음(외부 서비스를 부르지 않았다).

## 제안(범위 밖)

- U2에서: 누를 곳 44px을 `.text-link`·`a.nrow` 기본 규칙으로 올리기(지금은 자리마다 맞춤), `.seg` 버튼 채우기를 `Segmented` 변형으로 올리기, 기준 해를 화면 단위 하나(Context 등)로 내려 매개변수 전달 줄이기.
- 인물 목록의 기준 해를 목록 중 가장 최근 날짜의 해로 바꿀지(지금은 첫 항목의 해).
- E2E `stageU1`의 화면 18곳 순회를 화면당 한 번으로 모으기(묶음 시간 단축).
- U2 뒤 README의 첫 화면 이미지를 새 화면으로 바꾸기, 개인정보 처리방침에 `tidwyn.briefTab`(기억한 탭) 설명이 맞는지 다시 보기.

## 놓친 점

- [명세서] 4.5-4의 '누를 곳 개수가 60aab61보다 늘지 않는다'는 감싸는 상자 크기로 세서, 두 줄로 나뉘던 글 안 링크가 한 줄이 되면 실제로 작아지지 않아도 개수가 는다. 엄격한 쪽(개수)으로 읽고 문장 안 링크의 누르는 자리를 넓혀 맞췄다.
- [프로세스] `security-review` 스킬은 세션의 작업 폴더(메인 폴더, main)에서 diff를 모아 worktree 브랜치를 보지 못하고 빈 결과를 냈다. 서브에이전트가 같은 기준으로 worktree diff를 직접 봤다.
- [프로세스] 측정 도구 `shoot.mjs`의 누를 곳 목록이 15개에서 잘려, 4.5-4의 전·후 셈은 따로 쓴 스크립트(자르지 않고 셈)로 했다.
- [명세서] 4.3-3의 '일부러 YYYY-MM-DD를 내 실패를 본다'를 처음에는 기록하지 않아 result-auditor가 미흡으로 짚었다. 마지막 검증에서 `dateText`를 바꿔 실패를 보고 기록했다.

## 브라우저 점검

- 날짜: 2026-11-06. 지어낸 데이터로 빌드한 사이트를 앱 안 브라우저로 점검했다(점검 목록은 git이 무시하는 `.test-data/browser-check/`에 있다).
- 결과: 29항목 중 통과 28, 사용자 판단 1(지표 화면의 날짜 글. 결과 검토에서 4.3-1 결함으로 보고 고쳤다, 아래 "결과 검토 중 고친 것").
- 고친 것: 없음(더한 테스트 없음).
- 보류: 없음. 다른 수단으로 확인한 것: 읽은 기록 지우기의 확인 수락은 앱 안 브라우저가 확인 대화상자를 수락하지 못해 기존 E2E(`stage45.spec.ts` 4.6-2)로, 해가 다른 날짜 글은 지어낸 데이터가 한 해 안이라 단위 테스트로 확인했다.
- 마지막 자동 테스트: 4fae3e3에서 `pnpm verify` 1496 통과, `pnpm e2e` 471 통과(시작과 같음, 나빠진 것 없음)

## 디자인 점검

- 날짜: 2026-11-06. 지어낸 데이터(브라우저 점검과 같은 빌드)를 헤드리스로 찍어 `docs/design.md` 기준으로 봤다. 시안 없음. 폭 375·1280, 대표 화면은 다크도. 화면 24곳과 빈 데이터 3곳, 과제는 명세서 4.5-3의 셋.
- 회차: 2회(전체 1, 확인 1). 1회차 메인 확인 뒤 차단 0, 중요 3(고침 2: 포커스 윤곽·일정 줄 강조색, 사용자 판단 1), 경미 17(그중 공백 사라짐 1건을 고침). 2회차 확인 회차에서 고친 곳의 새 문제 0, 관문은 알려진 예외(U2의 누를 곳)와 원래 404인 화면의 콘솔 오류뿐으로 깨끗한 회차다. 과제 3/3 성공(과제 2에 잘못 누름 2: 하나는 위 '사용자가 할 일' 4, 하나는 기준대로인 목록 줄 링크).
- U2 예외 맞대기: 같은 데이터를 60aab61 코드로 빌드해 같은 장면(24곳 × 375·1280)을 쟀다. axe `target-size` 0/0이고 모바일 44px·24px 미만이 늘어난 곳은 없다(`/about`·`/privacy`는 줄었다). 고친 뒤 다시 재도 같았다.
- 고친 것(b5c2223): 공통 고르기 부품(Segmented)의 포커스 윤곽이 상자에 잘리던 것(U1 회귀), 브리프 '이번 주 일정' 줄의 결과 글이 강조색이던 것(뉴스 목록 화면은 강조색을 쓰지 않는다, 일정 화면과 같은 글자색으로), inline-flex 링크 안에서 ' ›'·' ↗'·'‹ '·출처 날짜 앞 공백이 사라지던 것. 기존 시각 회귀 80장을 이 공백 변경으로 다시 찍었다(바뀐 픽셀이 그 자리와 그 때문에 줄이 넘어간 아래쪽뿐인 것을 확인. 예: 수요 이어짐 375는 높이 1578→1610px).
- 시각 회귀(d5b66f4): `test/e2e/visualU1.spec.ts`에 펼친 카드·일정 달력·일정 목록·이슈 목록·이슈·용어·인물 목록·인물·지표 목록·지표(375·1280)와 다크 펼친 카드·일정 달력 24장을 더했다. 두 번 돌려 통과.
- 사용자 판단: 일정 이름 링크의 목적지(맨 위 4).
- 반영하지 않은 지적(경미): 섹션 탭이 Tab 순서의 맨 끝(60aab61부터, 키보드 조작), 지표 그래프 축 글과 선의 겹침(기준대로 12px, 바탕색 테두리가 이미 있음), 이슈 일정 줄·용어 '처음 나온 뉴스'의 'MM-DD'(줄 머리 날짜로 구현하고 U1 단위 테스트가 단언), 그 밖에 60aab61부터 있던 것과 범위 밖 다듬기.
- 보류: 없음. 만들 수 없던 상태: 대기(로컬 정적 파일이라 순간이다. 앞 단계 E2E가 다룬다).
- 마지막 자동 테스트: d5b66f4에서 `pnpm verify` 1496 통과, `pnpm e2e` 495 통과(더한 24 포함).
- 대표 화면(로컬에만 있다): [브리프 375](screenshots/design-check-brief-375.png), [브리프 1280](screenshots/design-check-brief-1280.png), [일정 달력 375](screenshots/design-check-schedules-375.png).

## 결과 검토 중 고친 것

같은 세션의 결과 검토(run-stage)에서 확인된 결함과 기록 누락을 이 브랜치에서 고쳤다.

- 지표 화면의 날짜 글(f8ef5a1, ba6a665): 브라우저 점검이 사용자 판단으로 넘긴 것을 4.3-1('화면 글의 날짜')에 어긋난 결함으로 보고 고쳤다. 기준 해는 지표 목록의 기준일(`asOf`, 없으면 가장 최근 값)의 해(`indicatorRefYear`)이고, 그래프 읽기 줄·화면 읽기용 요약·지표 페이지 머리·지표 카드·이슈 그래프·정적 지표 페이지가 공통 `dayOrMonthText`를 거친다. 새 단위 테스트 '지표 화면의 날짜 글(4.3-1)'은 옛 코드(fca55b9의 site/)로 돌리면 실패한다(`indicatorRefYear`가 없고, 옛 `readingDateText`는 다른 해에도 해를 붙이지 않았다).
- E2E 도우미 `useIndicatorData`를 `test/e2e/base.ts`로 옮겨 stage6·visualU1이 함께 쓰고, 펼칠 단추 선택자를 좁혔다(fca55b9, 코드 리뷰 지적).
- 보고서의 어긋남(요구사항 표의 '진행' 둘, 디자인 점검의 중요·경미 구분, 다시 찍은 스냅샷의 줄 넘김)과 `docs/design.md`의 `Segmented` 포커스 예외(3516b4e).
- 다시 검증(1회): result-auditor(opus)가 8af67ef..3516b4e를 대조해 4.3-1·4.3-3·4.5-1 만족, 4.5-2는 고친 테스트 기록 누락으로 미흡이라 이 절과 '고친 기존 테스트'에 채웠다. 코드 리뷰(high)는 결함 없음, 정적 빌드의 기준 해 반복 계산 1건을 ba6a665에서 고쳤다.
- 마지막 자동 테스트: ba6a665에서 `pnpm verify` 1497 통과, `pnpm e2e` 495 통과(3516b4e), 공개 전 점검 통과.
- 남은 경미 지적(사용자가 판단을 맡김, 573f525): 끝 표시의 공백 규칙을 `aria-hidden` 선택자에서 공통 부품(`MoreMark`·`NewTabMark`·새 `BackMark`)이 붙이는 `.mark` 클래스로 바꾸고, 공통 부품을 쓰지 않던 이슈 그래프 제목의 ' ›'를 `MoreMark`로 바꿨다(시각 회귀 그대로). 지표 E2E(stage6 184·283행)는 1개월 값은 해 없음, 1년 값은 기준 해(2026)가 아닐 때만 해로 좁혔다(옛 코드의 '2026년 …'이면 실패한다). 끝 표시 HTML을 단언하던 단위 테스트 3곳(siteSchedules, siteIndicators, siteVideos)은 `class="mark"`를 더했다. 섹션 탭 Tab 순서는 U2로 넘겼고(plan 3.20), 지표 축 글 겹침·이슈 일정 줄의 'MM-DD'·이슈 페이지의 지표 기준 해는 그대로 둔다. 573f525에서 `pnpm verify` 1497, `pnpm e2e` 495 통과, 공개 전 점검 통과.

## 결과 검토

- 통과: 2026-11-06(같은 세션의 run-stage 결과 검토).
- 확인된 문제: 9건(만족하지 않은 요구사항 1: 4.3-1 지표 화면 날짜, 결함·누락 8: 보고서 불일치, design.md 포커스 예외, E2E 도우미 중복, 펼칠 단추 선택자, 정적 빌드의 반복 계산, 고친 테스트 기록 누락, 끝 표시 공백 규칙의 선택자, 느슨한 E2E 정규식). 모두 이 브랜치에서 고쳤다. 일정 이름 링크(맨 위 4)는 U2로 넘겼다.
- 사용자 지적으로 `implement-spec`을 다시 부른 횟수: 0.
