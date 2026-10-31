# 진행 기록

## 디자인 점검에서 더한 테스트의 실패 확인

- `test/siteStatic.test.ts`의 제보·구역 이동, 앱 틀 안내, 검색 입구 없음, `test/e2e/stage95.spec.ts`의 건너뛰기 링크, 메뉴 닫기, 하단 탭 포커스: 고치기 전에 실패를 봤다.
- 머리글 포커스: `styles.css`를 잠시 되돌려 실패를 봤다. 포커스 때 페이지가 튀는 회귀 테스트와 지표 안내 테스트는 고치기 전 실패를 봤다(지표 안내는 문구를 지우면 실패한다).
- `test/e2e/visual.spec.ts`: 기준 이미지 비교라 기능 없이 실패를 볼 수 없다. 두 번 돌려 안정을 봤다.

## run-stage 기록

- 2026-10-31 18:40 write-spec 시작. 시작 질문 답: 연락은 공개 메일만(`mivomad33@gmail.com`, gcloud 전용 설정의 계정으로 주소 확인), 정정 명령과 표시 포함, 표시는 design-direction 탐색.
- 2026-10-31 예약 `/brief`를 막지 않도록 worktree `../tidwyn-stage95`에서 진행한다(R8). design-direction 탐색 run `wf_427ae0c4-c5c`.
- 2026-11-01 review-spec 통과(5회차, 깨끗한 회차). 사용자 결정: R13(300KB 넘으면 상한 재설정), R5 파일 수 위험 감수. 시작 전 점검 막힘 0회.
- 2026-11-01 05:30 implement-spec 끝. browser-check로 넘어감.

## 시작 기준값 (2026-11-01 04:23)

- 실제 DB 해시 앞부분 225e001823370b8e, `refs/heads/data` fa6e4f99c32f, 운영 배포 tidwyn-5cptbvbha, 메인 폴더 main·변경 없음.

## 작업 계획

1. 정정 저장: 마이그레이션 9, `store` 정정, `correct` 명령, 백업(4.7-1~4). 끝나면 커밋.
2. 사이트 데이터 정정 필드와 검색·마크다운 파생(4.7-5).
3. 공통 문구·제목·메일(4.2-1, 4.6): `policy.ts`, `format.ts`, 처리방침, 소개, 없는 페이지.
4. 정적 HTML 생성기, 호스팅, 404, robots, sitemap, RSS, 아이콘(4.1~4.5). 첫 화면 크기(4.1-6).
5. 앱 연결(숨김/복원, 4.1-4)과 정정 표시·제보 링크·CSS(4.6, 4.7-6).
6. 검사와 배포 뒤 점검(4.8-1·2), 허용 메일(4.6-3).
7. 문서(4.9), 한도 계산(4.8-3), 빌드 시간(4.8-4).
8. 시험 실행(4.10-2), 마지막 검증, 보고서.

## 요구사항 체크리스트

근거의 `siteStatic`은 `test/siteStatic.test.ts`, `stage95`는 `test/e2e/stage95.spec.ts`다. 실패 확인: 정적 생성을 끄면 siteStatic이, `checkPublicPages`를 끄면 검사 테스트가, 숨김 규칙을 끄면 stage95의 4.1-4가 실패하는 것을 봤다(2026-11-01). 정정 저장 테스트는 1단계에서 기능 전에 썼다. 마지막 검증에서 기능을 잠시 끄고 실패를 봤다: 사유 검사(corrections 10개), RSS 상한(1개), sitemap 나누기(2개), 파일 수 늘리기(siteStatic 8개), 정정 표시(4.7-6 1개), 제보 링크(4.6-1 1개), 404 상태(4.3 2개).

| 요구사항 | 상태 | 근거 |
| --- | --- | --- |
| 4.1-1 만들기 | 만족 | siteStatic(색인 파일, 빈 데이터), siteBuild의 두 번 빌드 해시 비교 |
| 4.1-2 본문 | 만족 | siteStatic 4.1-2 묶음 |
| 4.1-3 탐색 링크 | 만족 | siteStatic 링크 따라가기 |
| 4.1-4 켠 방문자 | 만족 | stage95, 앞 단계 E2E |
| 4.1-5 끈 방문자 | 만족 | stage95. 누를 곳 44px는 design-check |
| 4.1-6 크기 | 만족 | 5년치 측정 최대 289.1KB(HTML 포함), 상한을 올리지 않음 |
| 4.2-1~5 | 만족 | siteStatic, stage95 제목 비교 |
| 4.3-1·2 | 만족 | siteStatic |
| 4.3-3·4 | 만족 | siteLib, siteStatic, stage95, 미리보기 주소표 |
| 4.3-5 | 만족 | siteLib, 운영 응답은 4.8-2가 본다 |
| 4.4-1 | 만족 | siteStatic, 미리보기 share.png 200 |
| 4.4-2 | 대기 | design-check |
| 4.5-1 | 만족 | siteStatic |
| 4.6-1~3 | 만족 | siteStatic, siteVideos, stage95 |
| 4.7-1~4 | 만족 | test/corrections.test.ts |
| 4.7-5 | 만족 | siteStatic 4.7-5 |
| 4.7-6 | 만족(디자인은 design-check) | stage95 |
| 4.8-1·2 | 만족 | siteStatic, test/publish.test.ts |
| 4.8-3 | 만족 | docs/operations.md 한도 절 |
| 4.8-4 | 만족 | 5년치 빌드 약 42초 |
| 4.9-1~5 | 만족 | skillDoc, README 비교 테스트, 읽어서 확인. plan은 보고서 제안으로 |
| 4.10-1 | 만족 | verify 682개, e2e 195개 |
| 4.10-2 | 만족 | 시험 실행, 미리보기 tidwyn-i4hivent4(1번째). Claude in Chrome은 로그인되지 않아 앱 안 브라우저로 봄 |
| 4.10-3 | 끝에 다시 본다 | 시작 기준값은 위 기록 |

## 재량 결정

- 정적 본문 숨김: `#root` 안의 `.static-page`를 head의 `html.app` 규칙이 숨기고 앱의 첫 렌더가 지운다. head의 window error 처리(캡처 단계)가 `app`을 지운다. 처음의 모듈 스크립트 onerror는 시작 중 예외를 잡지 못해 코드 리뷰 지적으로 바꿨다. 하이드레이션보다 앱 코드를 안 건드린다.
- 파일 배치: `<경로>.html`, 앱 전용 `app.html`, 흡수 주소는 작은 파일. Vercel `cleanUrls`로 받는다.
- 정적 본문은 공용 뷰를 `renderToStaticMarkup`으로 그린다. `.tsx`는 Node로 못 돌려 공용 뷰를 `.ts`로 옮겼다.
- 공개 주소·메일 값은 `src/publicSite.ts`에 두고 `policy.ts`가 다시 내보낸다.
- 이름이 겹치는 이슈·대상 제목: `이름 (이슈 12)`, `이름 (대상 3)`.
- lastmod: 내용 날짜와 정정일 중 늦은 쪽. 코스피·코스닥 페이지는 lastmod를 뺀다.
- 결과물 검사: 부분 파일을 쓰는 기존 테스트를 두려고 `checkOutput`과 `checkPublicPages`를 나누고 배포 쪽은 `checkBuiltSite`를 쓴다.
- 결과물 검사의 영상 주소 검사는 뉴스 출처 목록(`.src`)을 뺀다. 출처가 YouTube인 글이 배포를 막지 않게 하려는 것이다. `.src` 안의 글은 출처 이름과 날짜뿐이다.
- 부풀린 첫 4일 표본이라 한도 계산은 평균과 느린 쪽 두 값으로 적었다.

## 고친 기존 테스트 줄(4.10-1)

- `test/backup.test.ts`, `test/videos.test.ts`: 백업 형식·스키마 버전.
- `test/siteBuild.test.ts`: 결과물 목록, `.txt` 금지에서 robots.txt만 제외, 외부 주소 금지를 자원 태그로 좁혀 모든 HTML에 적용, rewrites 수, 주소 판정, 파일 수 단언을 값 출력으로.
- `test/siteIndicators`, `siteEntities`, `siteSchedules`, `siteLib`: 주소 판정 결과와 호스팅 규칙.
- `test/siteVideos.test.ts`: GitHub 이슈 → 메일, 처리방침 날짜, 바닥글 링크 수, 소개 코드 위치.
- `test/publish`, `preview`, `indicators`, `schedules`, `videoNotes`, `videos`: 가짜 빌더가 공용 `writeFakePublicFiles`를 쓴다. `publish`의 가짜 응답을 넓혔다.
- E2E: 없는 페이지 제목과 링크 문구, `/` 제목, 메뉴 항목, 외부 링크 수(4→3), 직접 요청 기대값.
- `eslint.config.js`: 무시하는 탐색 폴더를 린트에서 뺐다(옮긴 뒤 메인 폴더에서도 걸린다).

## 놓친 점
- [명세서] 명세가 "`policy.ts` 한 곳"이라 했으나 `src/`는 `site/`를 가져올 수 없어 `src/publicSite.ts`에 뒀다.
- [명세서] 4.10-2가 Claude in Chrome을 정했으나 연결된 브라우저에 Vercel 로그인이 없었고, 앱 안 브라우저가 로그인되어 있어 그쪽으로 봤다.
- [명세서] R5의 한도 어림(1년 100MB)이 실측(하루 약 1MB)과 달랐다. 시기가 3~9개월로 당겨졌다.
- [프로세스] 입력을 기다리는 명령(`cat >`, `sqlite3`)을 두 번 그대로 실행해 멈췄다.
- [프로세스] `verify` 결과를 보지 않고 커밋이 이어지게 명령을 묶어 실패 상태로 한 번 커밋했다. 다음 커밋에서 고쳤다.
- [명세서] 미리보기 tidwyn-i4hivent4는 단순화·리뷰 수정 전 커밋으로 만들었다. 뒤 커밋의 화면 변화는 시작 오류 처리와 불러오는 동안의 제목뿐이라 다시 배포하지 않았다.
- [프로세스] 시험 메일 값이 공개 전 점검에 걸려 작업 브랜치 이력을 고쳤다.
- [프로세스] 디자인 점검의 목록 파일을 2회차 전에야 만들어, 맥락 요약 뒤 `check.js` 인자를 대화 기록에서 복구했다.
- [프로세스] 디자인 비교판을 파일만 보내 그림이 안 보였고 사용자가 알려 주었다. 오래 도는 워크플로우를 말없이 기다려 사용자가 두 번 이유를 물었다.
- [프로세스] 회고 판정자를 후보마다 셋이 아니라 역할마다 한 명이 후보 전체를 맡았다.

보고서: `report.md`
- 2026-11-01: design-check 3회차로 끝남. review-done으로 넘어감.
- 2026-11-01: review-done 수정의 다시 검증 1번째(96efcb5, 0ae21c3). 미리보기 2번째 tidwyn-p8yiwn8zg(0ae21c3).
- 2026-11-01: 프로세스 회고 끝남(스킬 저장소 커밋 3개). 마지막 질문으로 넘어감.
