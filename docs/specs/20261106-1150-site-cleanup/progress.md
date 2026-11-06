# 진행 기록

## run-stage 기록

- 2026-11-06 11:48 시작. 명세서가 없어 `write-spec`부터 했다.
- 2026-11-06 11:50 첫 질문 답: 걱정·함정 없음. worktree `../tidwyn-stageU1`, 브랜치 `spec/stageU1-site-cleanup` 만들기 승인(만들고 `pnpm install` 끝).
- 2026-11-06: 화면이 있는 단계다. browser-check·design-check 실행 정보는 `docs/memory.md`(2026-10-29)와 `docs/operations.md`에 있어 묻지 않는다. 지어낸 데이터만 쓰므로 점검 중 테스트 데이터를 다시 만들어도 실제 데이터에 닿지 않는다. Chrome은 쓰지 않는다. 권한 확인에 막힐 명령은 없다(권한 건너뛰기 모드, 구현 중 배포 없음).
- 2026-11-06 기준선 다시 재기(감사 값과 같음, 일정 누를 곳만 감사가 15개에서 잘린 값), 코드 조사, 넓혀 보기 두 갈래를 서브에이전트로 돌렸다. 둘째 질문 답: S1(바로 앞 기록이면 되돌리기, 영상 포함), S2(되돌아가기 글에 날짜), S3(배지 그대로) 모두 추천안 승인. 진행 규칙 승인. 큰 결정 검토는 대상이 없어 하지 않았다(되돌리기 쉬운 화면 변경). write-spec 끝. 이어서 `review-spec`.
- 2026-11-06 review-spec 6회차에서 깨끗한 회차로 통과(사용자에게 두 번 물음: 1회차 S6 글 링크 색, 4회차 S10 알약 예외·S12 칩 복원). 1회차에 고친 아이콘 예외가 2회차에 다시 지적됐으나 방향이 아니라 결정 기록 누락이라 S9로 문서만 고쳤다(마지막 보고에 알린다). 이어서 `implement-spec`.

- 2026-11-06 implement-spec 끝(마지막 검증 2회: 처음 + 고친 커밋 다시 대조). 상태 '사용자 확인 대기'. 이어서 `browser-check`.
- 2026-11-06 browser-check 끝: 29항목 중 통과 28, 사용자 판단 1(지표 화면 날짜 글, 5장에서 묻는다). 고친 것 없음. 이어서 `design-check`.
- 2026-11-06 design-check 끝: 2회차(전체 1, 확인 1)에서 깨끗한 회차. 고친 것 b5c2223, 시각 회귀 d5b66f4. 사용자 판단 1(일정 이름 링크 목적지, 과제 2의 잘못 누름 원인, 5장에서 묻는다). 이어서 `review-done`.
- 2026-11-06 review-done: result-auditor(opus, 60aab61 기준 브랜치 전체 중 리뷰 뒤 코드)와 코드 리뷰(dfd7258..8af67ef) 지적 중 사용자 판단이 필요 없는 것을 고쳤다(fca55b9, f8ef5a1, 3516b4e, ba6a665). 다시 검증 1회(result-auditor opus 8af67ef..3516b4e, 코드 리뷰 fca55b9..3516b4e). 남은 지적은 기록 누락뿐이라 문서만 채웠다. 정기 회고는 기준점(dcb66c8) 뒤 완료 명세서가 5개가 안 돼 하지 않는다.
- 2026-11-06 16:30 마지막 질문 답: 통과하고 머지, 일정 이름 링크는 U2로 넘김, 남은 경미 지적은 'AI가 고칠 것과 둘 것을 판단'. 판단대로 573f525를 고치고 다시 검증 2회째(result-auditor opus f603cc3..573f525, 코드 리뷰는 메인)를 했다. plan 3.20·memory.md에 기록.

## 요구사항 체크리스트

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
| 4.3-1 날짜 글 | 만족 | `test/siteDates.test.ts` 4.3-1 여섯 테스트, `test/siteNavState.test.ts` '해가 다르면'. |
| 4.3-2 지표 변화 | 만족 | `test/siteDates.test.ts` 4.3-2, `test/e2e/stageU1.spec.ts` '4.3-2'. |
| 4.3-3 YYYY-MM-DD 없음 | 만족 | `test/siteDates.test.ts` 4.3-3(정적 HTML), `test/e2e/stageU1.spec.ts` '4.3-3'(앱 18곳). `dateText`가 일부러 'YYYY-MM-DD'를 내게 바꾸자 단위 4.3-3 두 테스트와 E2E 4.3-3이 실패했다(a4adfff 기준, 되돌림). |
| 4.4-1 '‹ 브리프' 도착 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-1' (a)~(e) 여섯 테스트, `test/siteNavState.test.ts`. |
| 4.4-2 이슈 페이지 되돌아가기 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-2·4.4-3' 두 테스트. |
| 4.4-3 되돌아가기 글 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-2·4.4-3', `test/siteNavState.test.ts` S2. 320·375 머리글 잘림은 browser-check·design-check에서 본다. |
| 4.4-4 탭 기억 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-4' 세 테스트, `test/siteNavState.test.ts` '저장 키'. |
| 4.4-5 기존 동작 유지 | 만족 | `test/e2e/stageU1.spec.ts` '4.4-5' 세 테스트. |
| 4.5-1 design.md | 만족 | d70a5e7. result-auditor가 항목별로 대조한다. |
| 4.5-2 기존 기능 유지 | 만족 | `pnpm verify` 1495 통과, `pnpm e2e` 471 통과(c831cbd). 고친 기존 테스트와 이유는 아래 '고친 기존 테스트'. 스냅샷 113개는 바뀐 화면을 본 뒤 다시 찍었다. |
| 4.5-3 화면 확인 | 진행 | browser-check·design-check 단계에서 확인. |
| 4.5-4 누를 곳 | 만족 | 측정 도구(자르지 않은 셈) 전·후 375 18곳 모두 늘지 않음(`/issues/28` 13→12, `/about` 14→12·10→0, `/privacy` 5→4·5→0, 나머지 같음), 1280 24px 미만도 늘지 않음. 보고서 표. |
| 4.5-5 공개 점검 | 만족 | 커밋마다 worktree에서 `node src/cli.ts precheck` 통과(마지막 c831cbd). 지어낸 데이터는 '가짜' 이름만. |
| 완료: 보고서 전·후 값·스크린샷 | 진행 | 보고서 작성 때. |
| 완료: 새 패키지 없음 | 만족 | `git diff 60aab61 -- package.json pnpm-lock.yaml` 변화 없음. |
| 완료: 메인 폴더·data 그대로 | 만족 | 메인 폴더는 main·깨끗함, worktree만 고침. 실제 data/는 열지 않았다. |

## 전 값

- 2026-11-06 60aab61(`.test-data/u1-base/main`을 `git archive`로 꺼내 빌드한 `main-out`)에서 감사와 같은 조건으로 쟀다(명세서 작성 때, 같은 날). 값은 명세서 1장·4.5-4와 같다. 결과 원본은 세션 임시 폴더. 후 값도 같은 날 재고, 날이 바뀌면 다시 잰다.

## 작업 계획

1. 글자 크기 토큰과 단위 테스트(4.1-1)
2. 같은 역할 부품: 칩·표시·닫힌 줄, Segmented, 글 링크, 구역 제목, Empty·'이날', ↗, 이름(4.2)
3. 날짜 표기와 지표 변화(4.3-1·2), 정적 HTML 날짜 검사(4.3-3 단위)
4. 되돌아가기와 상태(4.4, S1·S2·S8·S12)
5. 측정 데이터 E2E 묶음(4.1-2, 4.2, 4.3-3, 4.4)
6. design.md·operations.md(4.5-1), 시각 회귀 스냅샷
7. 후 값 측정, 마지막 검증, 보고서

## 재량 결정

- 글자 크기 토큰 이름 `--fs-xl/lg/md/base/sm/xs`. 20px→19, 10~11.5px→12. 브라우저 기본 크기가 남는 요소(h1~h6, small, code, 폼 요소)에 토큰·inherit 기본 규칙을 둠(보이는 요소는 바뀌지 않고 sr-only 제목만 32·24→16px).
- 단계 1~4 커밋은 `pnpm verify` 통과로 커밋하고, 바뀐 동작 때문에 깨지는 E2E·시각 스냅샷은 6단계에서 한꺼번에 고친다(스냅샷은 화면을 본 뒤 다시 찍어야 해서 단계마다 찍으면 같은 일을 되풀이한다).
- 머리 날짜 링크의 이동 표시는 끝 › 대신 밑줄(바로 옆 다음 날짜 ›와 겹치지 않게).
- 영상 묶음 표시 `.tag`는 묶음 이름에 '·'가 들어 있어 700 글자색과 여백으로 구분.
- 넓은 화면의 구간 시각 칸 64→84px(↗가 들어가게).
- 이슈 페이지 타임라인 줄은 제목이 한 줄로 끝나면 35px이 되어(글자 크기 정리로 한 줄에 들어가는 제목이 생김) 4.5-4의 60aab61보다 늘었다. `.tl a.nrow`에 최소 높이 44px을 둬 13→12로 줄였다.
- 문장 안 글 링크(`.p a.text-link`)에 위아래 안쪽 여백 4px을 둬 줄은 그대로 두고 누르는 자리만 넓혔다. 60aab61에서 두 줄로 나뉘던 'CC BY 4.0'이 ↗가 붙어 한 줄이 되면서 `/about` 24px 미만이 10→11로 세어졌기 때문이다(4.5-4를 개수 그대로 읽는 엄격한 쪽). 결과 `/about` 375 10→0, 1280 13→1, `/privacy` 375 5→0, 1280 5→0.
- 출처 칩은 공통 `StorySources`(`site/src/components/sourceView.ts`), 빈 상태는 공통 `Empty`(`emptyView.ts`, `inline` 변형), 새 탭 표시는 `NewTabMark`.

## 고친 기존 테스트

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

## 재사용과 단순화(/simplify)

- 고침: 기준 해는 `yearOf`로만 구한다(남은 `slice(0, 4)` 8곳), `latestYear`를 `format.ts`로 옮기고 정렬 없이 한 번 훑는다, 달 글(`monthName`, `chipDue`, `axisDates`)은 `dayOrMonthText`·`monthOnly`로, 브리프 기록 표시는 `navState.withBriefMark`로, `adoptState`는 `pushStateOf`로, BriefPage의 같은 계산(`restoredView`·`navOf`·`stateForHash`)은 한 번만, `BriefBackLink`는 `BackLink` 마크업을 쓴다(`Link`는 onClick이 `preventDefault`하면 다시 옮기지 않는다), 구간 시각 링크의 ↗는 `NewTabMark({ spoken: false })`, 상자 안 고르기 바탕은 `--segmented-on` 변수로.
- 하지 않음: 엔티티 목록의 기준 해를 `latestYear`로 바꾸기(목록이 날짜순이 아니라 동작이 바뀐다), 누를 곳 44px을 `.text-link`·`a.nrow` 기본 규칙으로 올리기(C7, U2 범위), `.seg` 버튼 채우기를 Segmented 변형으로 올리기와 기준 해를 Context로 내리기(바꾼 범위 밖까지 번짐, 보고서 제안), E2E 화면 순회를 한 번으로 모으기(테스트 구조 변경이 커서 제안), router의 `changed` 플래그 정리(첫 기록 판단이 얽혀 동작을 바꿀 위험).

## 새 테스트가 기능 없이 실패하는 것을 본 방법

- E2E `test/e2e/stageU1.spec.ts`: 60aab61로 같은 측정 데이터를 빌드해 띄우고(`E2E_U1_BASE_URL=http://127.0.0.1:4411 pnpm e2e test/e2e/stageU1.spec.ts`) 돌리면 37개 중 30개가 실패한다(a4adfff 기준 다시 확인). 통과한 7개는 이미 있던 동작이나 '모를 때'의 동작을 지키는 짝 테스트다: 4.2-1의 일정 '목록|달력', 인물 종류 칩 `?kind=`(S10), 거르기 칩 aria-pressed / 4.2-7 브리프·일정·이슈 목록·검색의 빈 상태(이미 공통 Empty, '이날'은 빌더·수요 쪽 짝 테스트가 실패) / 4.4-1 (d) 주소로 바로 연 일정 화면 / 4.4-2·4.4-3 이슈 목록·검색·주소에서 온 이슈 페이지의 '‹ 이슈' / 4.4-4 새 탭의 일정 화면 '‹ 브리프'. 각 요구사항에는 옛 빌드에서 실패하는 테스트가 함께 있다.
- 단위: `siteFontTokens`는 옛 styles.css로 실패, `siteSegmented`·`siteCleanup`·`siteDates`·`siteNavState`는 새 공통 부품·함수·문구를 import하거나 단언해 옛 코드에서는 실패한다(없는 모듈, '이날' 문구, 옛 날짜 모양). 4.3-3은 위 표대로 일부러 넣은 날짜로 실패를 봤다. '이번 주 일정' 기준 해 테스트는 고치기 전 코드로 실패를 봤다.

## 마지막 검증

- `/simplify`: dfd7258(위 '재사용과 단순화').
- result-auditor(sonnet, dfd7258 + 커밋 전 수정): 4.1-1·4.1-2·4.2·4.3-1·4.3-2·4.4-1·4.4-2·4.4-4·4.4-5·4.5-1·4.5-2 만족, 4.1-3·4.5-4 확인 불가(측정 값이 저장소 밖), 4.1-4·4.4-3 일부·4.5-3 대기(뒤 단계). 미흡 둘: 커밋하지 않은 수정(a4adfff로 커밋), 기능 없이 실패한 기록 부족(위 절로 채움, 4.3-3은 일부러 넣은 날짜로 확인).
- `/code-review high`(60aab61..dfd7258): 7건. 고침: 브리프 화면 '이번 주 일정' 줄의 기준 해를 오늘 대신 브리프 날짜의 해로(펼친 카드 일정 칩과 같게, a4adfff), `Link`의 중복 `defaultPrevented` 검사(a4adfff). 고치지 않음: 인물 목록 기준 해가 첫 항목의 해인 것(전부터의 동작이고 '그 화면이 정한다'에 든다, 바꾸면 표기가 바뀜), 영상 페이지 되돌아가기 글이 날짜 파일을 받기 전후로 바뀌는 것(받기 전에는 최근 날짜를 알 수 없음, 파일은 다른 화면과 함께 캐시됨), `adoptState`·`goBack` 얇은 래퍼(이름이 뜻을 말하고 테스트가 씀), E2E 화면 순회 중복(제안).
- 보안 리뷰(general-purpose 서브에이전트, 60aab61..dfd7258): 문제 없음. `security-review` 스킬은 메인 폴더 기준으로 빈 diff를 모아 같은 기준으로 worktree diff를 직접 봤다.

## 보류

## 놓친 점

- [명세서] 4.5-4의 '누를 곳 개수가 60aab61보다 늘지 않는다'는 감싸는 상자 크기로 세서, 두 줄로 나뉘던 글 안 링크가 한 줄이 되면 실제로 작아지지 않아도 개수가 는다. 엄격한 쪽(개수)으로 읽고 문장 안 링크의 누르는 자리를 넓혀 맞췄다.
- [프로세스] `security-review` 스킬은 세션의 작업 폴더(메인 폴더, main)에서 diff를 모아 worktree 브랜치를 보지 못하고 빈 결과를 냈다. 서브에이전트가 같은 기준으로 worktree diff를 직접 봤다.
- [프로세스] 측정 도구 `shoot.mjs`의 누를 곳 목록이 15개에서 잘려, 4.5-4의 전·후 셈은 따로 쓴 스크립트(자르지 않고 셈)로 했다.
- [명세서] 4.3-3의 '일부러 YYYY-MM-DD를 내 실패를 본다'를 처음에는 기록하지 않아 result-auditor가 미흡으로 짚었다. 마지막 검증에서 `dateText`를 바꿔 실패를 보고 기록했다.
- [프로세스] 4.3-1(화면 글의 날짜 전체)에 어긋난 지표 화면의 날짜 글을 implement-spec 마지막 검증이 놓쳤고, browser-check는 찾았지만 '명세의 고칠 곳에 지표 화면이 따로 없고 기존 테스트가 지금 모양을 단언한다'며 사용자 판단으로 넘겼다. review-done의 result-auditor가 결함으로 짚어 결과 검토에서 고쳤다.
- [명세서] 4.3-1은 '화면 글의 날짜'로 넓게 썼지만 1장의 고칠 곳 목록에 지표 화면이 없어, 지표 날짜가 범위인지 두 가지로 읽혔다.

결과 보고서: [report.md](report.md)
