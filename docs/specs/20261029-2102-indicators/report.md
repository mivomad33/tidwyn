# 6단계 결과 보고서: 주요 지표

## 사용자가 할 일

1. **폰에서 미리보기 보기:** https://tidwyn-b86v0271u-mivomad33.vercel.app 을 연다(Vercel에 `mivomad33`로 로그인해야 열린다). 실제 DB 복사본에 실제 지표 값을 받아 만든 결과물이다. 다음이 쓸 만한지 본다.
   - 브리프 위 '이번 주 일정 | 지표' 상자: 탭 바꾸기, ▴로 접기(접으면 "이번 주 일정 N · 원/달러 …" 한 줄)
   - 지표 페이지: 메뉴의 '지표'(`/indicators`). 한국 / 미국·국제 카드
   - 지표 하나의 페이지: 카드를 누른다(`/indicators/<식별자>`). 기간 1개월·1년·5년 바꾸기, 그래프 누르기
   - 이슈 페이지의 '관련 지표' 그래프: 예를 들어 이슈 38([스크린샷](screenshots/real/375-light-issue-38-indicators.png))
2. **고른 지표 검토:** `.test-data/stage6-trial/indicator-review.md`(git이 무시하는 시험 폴더 안)를 연다. 이슈 53개 중 4개에 지표가 붙었다. 관계가 분명한 것만 붙었는지, 빠진 중요한 연결이 없는지 본다(X4, X11). 고칠 것이 있으면 알려 준다(기준을 고쳐 다시 구현한다).
   - 머지 뒤 첫 실제 `/brief`는 실제 DB의 모든 이슈를 다시 판단해 검토 없이 운영에 올린다. 그 실행 뒤 운영 사이트의 이슈 페이지를 몇 개 다시 본다(아래 "머지 뒤 첫 실제 `/brief`").
3. **시안 비교:** 화면이 확정 시안(`design/site.html`)과 같은 느낌인지 본다. 스크린샷은 아래 "스크린샷"에 있다.
4. **기준 보완 제안 승인:** 아래 "기준 보완 제안"을 보고 승인할지 정한다.
5. **머지 승인:** 직접 머지하지 않는다. 보고서 맨 위의 사용자 확인 항목이 끝나면 새 세션에서 `/review-done`으로 이 보고서를 검토하고, 통과와 머지를 승인하면 `review-done`이 머지하고 `docs/specs/README.md`의 상태를 '완료'로 바꾼다.
   - 머지하면: main에 squash merge → 작업 브랜치 삭제 → 공개 전 점검(`node src/cli.ts precheck`) → 통과하면 `git push origin main`(CLAUDE.md). 운영 사이트는 머지 뒤 첫 실제 `/brief`가 바꾼다.

보류한 것은 없다.

## 만든 것

- **지표 저장(마이그레이션 6):** 지표 12개의 값(`indicator_values`), 이슈-지표 연결(`issue_indicators`), 판단 여부(`indicator_judged`), 합치기의 지표 기록(`indicator_merges`). 지표 정의는 `src/indicators.ts`.
- **지표 받기:** ECOS·FRED에서 값을 받는다(`src/indicatorFetch.ts`). 일별은 마지막 값 60일 전부터, 월별 물가는 매번 처음부터 받아 통째로 바꾼다. 실패한 지표는 그대로 두고 나머지를 계속한다.
- **이슈 지표 판단:** 파일 하나에 이슈 40개씩 후보 목록을 쓰고, Claude가 이슈마다 0~3개를 고른 판단 파일을 검사·적용한다(`src/indicatorJudge.ts`). 합치기·되돌리기가 지표를 함께 다룬다.
- **키:** 환경 변수나 메인 폴더의 `.env.local`에서 `ECOS_API_KEY`·`FRED_API_KEY`를 읽는다(`src/keys.ts`). 실패 이유·출력·기록에서 키를 가리고, `site`·`deploy`·`push`·`precheck` 전에 결과물과 커밋에서 키 값을 찾는다.
- **백업 형식 5:** `indicators.json`(코스피·코스닥 값은 넣지 않는다, X3). 형식 1~5를 읽는다(`src/backup.ts`).
- **사이트:**
  - 브리프 위 '이번 주 일정 | 지표' 상자(`site/src/components/briefBox.ts`)
  - 지표 페이지 `/indicators`, 지표 하나의 페이지 `/indicators/<식별자>`(`site/src/pages/IndicatorsPage.tsx`, `IndicatorPage.tsx`)
  - 이슈 페이지의 '관련 지표'(`site/src/components/IssueIndicators.tsx`), 메뉴의 '지표', 사이트 소개의 FRED 고지
  - 사이트 데이터는 `src/indicatorSite.ts`
- **문서:** 스킬 문서(`.claude/skills/brief/SKILL.md`)의 지표 단계, 운영 문서(`docs/operations.md`)의 "지표" 절과 "키 문제일 때 할 일", README 두 언어.

## 사용법

`/brief`가 차례로 부른다. 손으로 부를 일은 없다. `--run`은 그 실행의 실행 기록 파일이다.

| 명령 | 하는 일 |
|---|---|
| `node src/cli.ts indicator-list --run <실행 기록>` | 판단 안 한 이슈를 40개씩 나눠 후보 목록(`work/indicators.candidates-<번호>.md`)을 쓴다 |
| `node src/cli.ts indicator-check --run <실행 기록> --file <번호>` | 판단 파일(`work/indicators.judge-<번호>.json`)을 검사만 한다 |
| `node src/cli.ts indicator-apply --run <실행 기록> --file <번호>` | 검사를 통과한 판단 파일을 적용한다. 실패하면 아무것도 적용하지 않는다 |
| `node src/cli.ts indicator-fetch --run <실행 기록>` | 지표 12개를 받아 저장한다 |

- **새 화면 주소:** `/indicators`, `/indicators/<식별자>`(예: `/indicators/usdkrw`).
- **공개 끄기:** 작업 브랜치에서 `src/indicators.ts`의 그 지표의 `public`을 `false`로 바꿔 main에 머지한다. 다음 `/brief`부터 그 지표가 사이트 어디에도 없고 그 주소는 없는 페이지가 된다. 받기와 판단은 계속한다(`docs/operations.md` "공개 끄기").
- **키 문제:** 요약에 "키 확인 필요"가 나오면 `docs/operations.md`의 "키 문제일 때 할 일"을 본다.

## 이 명세서만의 보고 내용

### 시험 실행(4.10-2)

- **폴더:** `.test-data/stage6-trial/`(실제 DB를 복사, 2026-10-29). 실행 기록은 `runs/20261029-222300.json`.
- **`start`:** 버전 4에서 6으로 마이그레이션했다. "지표 판단 안 한 이슈: 53개", "키: ECOS 있음, FRED 있음"이 나왔다.
- **지표 판단:** 이슈 53개(파일 2개, 40개와 13개), 지표를 고른 이슈 4개, 실패와 고친 횟수 0. 검토 파일은 `.test-data/stage6-trial/indicator-review.md`.
- **지표 받기 1회차**(8.7초): 12개 모두 성공했다.

  | 지표 | 받은 값 | 첫 날짜 ~ 마지막 날짜 |
  |---|---|---|
  | brent | 1264 | 2021-10-27 ~ 2026-10-27 |
  | kosdaq | 1224 | 2021-10-27 ~ 2026-10-28 |
  | kospi | 1224 | 2021-10-27 ~ 2026-10-28 |
  | kr3y | 1230 | 2021-10-27 ~ 2026-10-29 |
  | krbase | 1827 | 2021-10-27 ~ 2026-10-27 |
  | krcpi | 72 | 2020-10 ~ 2026-09 |
  | us10y | 1249 | 2021-10-27 ~ 2026-10-27 |
  | uscpi | 71 | 2020-10 ~ 2026-09 |
  | usdindex | 1248 | 2021-10-27 ~ 2026-10-23 |
  | usdkrw | 1231 | 2021-10-27 ~ 2026-10-29 |
  | usfed | 1829 | 2021-10-27 ~ 2026-10-29 |
  | wti | 1248 | 2021-10-27 ~ 2026-10-27 |

- **2회차:** 12개 모두 바뀐 값 0, 더해진 값 0.
- **일정 뽑기**(7-2단계, 2일): 2026-10-27 새 일정 1개, 2026-10-28 새 일정 6개와 결과 연결 1개. 검사를 한 번에 통과했다.
- **합치기:** 다음 점검일이 2026-11-04라 하지 않았다.
- **백업:** 형식 5. 지표 10개의 값, 연결 8개, 판단 53개가 들었다. 코스피·코스닥 값은 백업 어디에도 없다.
- **복원 비교:** 복원한 폴더로 만든 사이트 데이터 42개 파일에서 코스피·코스닥 항목을 걸러 내고 비교했다. 다른 파일은 0개다. 복원한 폴더에서 다시 받으면 코스피·코스닥이 1224개씩 원래와 같다.
- **빌드:** 브리프 날짜 2개, 이슈 53개, 공개 지표 12개, 결과물 1.3MB, 파일 73개. 결과물 검사를 통과했다.
- **미리보기:** https://tidwyn-b86v0271u-mivomad33.vercel.app
  - `vercel inspect` 결과 Ready(target preview)
  - 로그인 없이 열면 302(Vercel 로그인으로 보낸다)
  - 운영 배포는 바뀌지 않았다(아래 "운영 배포")

### 파일 수와 크기(4.6-2)

5단계 측정 조건(1,826일, 하루 42건, 이슈·대상 15,000개, 용어 5,000개, 일정 15,000개)에 지표 12개 × 5년, 지표를 고른 이슈 2할을 더해 쟀다.

단위는 1KB = 1,024바이트, 1MB = 1,024KB다(5단계 보고서와 같은 기준). 괄호 안은 5단계에서 잰 값이다.

- 결과물 2,944개(5단계 2,931개, 한도 10,000개), 전체 214.63MB(5단계 211.39MB)
- 지표 파일 13개, 686KB(이 값만 측정 때 단위를 남기지 않아 1,000 기준인지 1,024 기준인지 알 수 없다. 어느 쪽이든 1MB 아래다)
- 처음 받는 데이터(gzip, 한도 300KB = 307,200바이트): 브리프 첫 화면 141.2KB(5단계 130.0KB), 지표 페이지 47.0KB, 지표 하나의 페이지(코스피) 54.5KB

**1년 뒤 예상:** 지표 데이터는 늘 "마지막 값 기준 최근 5년"이라 파일 13개, 약 0.7MB에서 거의 늘지 않는다. 결과물 전체는 브리프가 쌓이는 만큼 늘어난다(측정 조건 기준 1년에 약 45MB). 그래서 Vercel 무료 플랜의 CLI 업로드 한도(100MB)에 닿는 시점은 지표가 아니라 브리프 양이 정한다. 측정 조건 기준으로 약 2년 뒤다(`docs/memory.md` 2026-10-28 결정: 한도에 가까워지면 Pro로 올리거나 옮긴다). 지금 실제 결과물은 1.3MB다.

### 출처 표시와 약관(4.7-6)

- 확인한 약관 주소: https://fred.stlouisfed.org/docs/api/terms_of_use.html (2026-10-29 확인)
- 실은 문구
  - 고지(사이트 소개, 지표 페이지 바닥): "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis." + 약관 링크
  - 동의 한 줄(사이트 소개): "이 사이트를 이용하면 FRED® API 이용 약관을 따르는 것으로 본다."
  - ECOS 지표: "자료: 한국은행 ECOS(작성기관: 한국은행 / 한국거래소 / 국가데이터처)"
  - FRED 지표: "<원 기관> via FRED"(예: "미국 연방준비제도이사회 via FRED", "미국 에너지정보청 via FRED")

### 색 대비(4.7-9)

`site/src/lib/theme.ts`의 대비 검사에 더했다. 글자는 4.5:1, 선·점은 3:1이 기준이다.

| | 오름/배경 | 오름/상자 | 내림/배경 | 내림/상자 | 그래프 선/배경 | 점(강조색)/배경 |
|---|---|---|---|---|---|---|
| 라이트 | 5.62 | 5.16 | 6.70 | 6.15 | 16.83 | 5.18 |
| 다크 | 6.53 | 5.73 | 7.57 | 6.64 | 15.32 | 7.98 |

### 기존 테스트에서 바꾼 줄(4.10-1)

`git diff main -- test/`에서 기존 줄을 바꾼 곳은 모두 이 단계가 정한 동작 때문이다.

- 스키마 버전 5 → 6, 백업 형식 4 → 5 숫자: `test/store.test.ts`, `test/backup.test.ts`, `test/issueFlow.test.ts`, `test/refs.test.ts`, `test/schedules.test.ts`
- 사이트 데이터 파일 목록에 지표 파일 13개 추가: `test/siteData.test.ts`(추가만)
- '이번 주 일정' 상자가 '이번 주 일정 | 지표' 상자로 바뀜(X7): `test/siteSchedules.test.ts`, `test/e2e/stage5.spec.ts`
- 메뉴에 '지표' 추가, 사이트 소개의 바깥 링크 2개 → 3개(FRED 약관): `test/e2e/stage3.spec.ts`
- E2E 준비에 지표 데이터 추가: `test/e2e/prepare.ts`, `test/e2e/paths.ts`

### 실제 데이터(4.10-3)

시작할 때와 끝날 때(2026-10-30) 값이 같다.

- `data/tidwyn.db` sha256: `ea048f5057ff26921e6a330b7e2f439292f8577996c72c55cfcb99eeffdeb533`
- `refs/heads/data`: `0304eb6cc63231c7673b375de7ee6343f5a589e5`

### 운영 배포

`vercel inspect tidwyn.vercel.app --scope mivomad33`의 배포 ID가 시작할 때와 끝날 때(2026-10-30) 같다: `dpl_6PNiqhGTuxzJuEs6b2x8otz1EYWx`.

### 머지 뒤 첫 실제 `/brief`

1. **마이그레이션:** 실제 DB가 버전 4에서 6이 된다(5단계 일정 표와 6단계 지표 표). 기존 데이터는 그대로다.
2. **5년치 받기:** 지표 12개를 처음부터 받는다. 시험 실행에서 8.7초 걸렸다.
3. **모든 이슈 판단:** 실제 DB의 이슈를 모두 판단한다(시험 때 53개, 파일 2개). Claude가 후보 목록을 읽고 판단 파일을 쓰므로 평소 `/brief`보다 몇 분 더 걸린다고 본다(파일 하나에 몇 분).
4. **운영에 올리기:** 검토 없이 운영 사이트에 올라간다. 그 실행 뒤 운영 사이트의 이슈 페이지를 몇 개 열어, 붙은 지표가 맞는지 다시 본다. 틀린 연결이 보이면 알려 준다.

## 요구사항별 상태

| 항목 | 상태 | 근거 |
|---|---|---|
| 4.1-1~5 데이터와 저장 | 만족 | `test/indicators.test.ts` 4.1, 시험 실행(v4→v6, 12개 받기), 1~5단계 테스트 통과 |
| 4.2-1~4 지표 받기 | 만족 | 4.2 테스트(받는 범위, 월별 통째 바꾸기와 실패 조건, 가짜 응답 5종, 실행 조건), 시험 실행 |
| 4.3-1~6 지표 판단 | 만족(4.3-4 판단이 적절한지는 사용자 확인) | 4.3 테스트, 흐름 테스트, 시험 실행 53개 |
| 4.4-1~2 백업·복원 | 만족 | 4.4 테스트, 시험 백업·복원 비교 |
| 4.5-1~2 `start`·요약 | 만족 | 4.5 흐름 테스트 |
| 4.6-1~3 사이트 데이터 | 만족 | 4.6 테스트, 크기 테스트(위 "파일 수와 크기") |
| 4.7-1~9 화면 | 만족(쓸 만한지는 사용자 확인) | `test/siteIndicators.test.ts` 28개, `test/e2e/stage6.spec.ts` 18개, 스크린샷 47장(결과 검토 뒤 기준) |
| 4.8-1~2 키 | 만족 | 흐름 테스트(가짜 키가 출력·실행 기록·작업 파일에 없음), 인코딩된 키 가리기 테스트, 4.8-2 테스트 |
| 4.9 문서 | 만족 | 읽어서 확인, 스킬 문서 테스트, README 비교 테스트 |
| 4.10-1~3 기존 기능·시험 실행·실제 데이터 | 만족 | 위 "이 명세서만의 보고 내용" |
| 완료 정의: `pnpm verify`·`pnpm e2e` | 만족 | 502개, 153개 통과(브라우저 점검 뒤) |
| 완료 정의: `dependencies` 비어 있음 | 만족 | `package.json`에 `dependencies` 없음 |
| 완료 정의: 공개 전 점검 | 만족 | 작업 브랜치에서 통과(커밋 39개, 출처 API 키 값 검색 포함) |
| 완료 정의: 운영 배포 같음 | 만족 | 위 "운영 배포" |

새 테스트가 기능 없이 실패하는지는 코드를 일부러 망가뜨려 봤다. 백엔드는 변이 16개, 사이트는 변이 6개를 써 봤고 자세한 것은 `progress.md`에 있다. 사이트 쪽에서 "첫 값 앞의 날에는 점을 찍지 않는다"는 처음에 아무 테스트에도 걸리지 않아 테스트를 더했다.

## 마지막 검증

- **1회:** `result-auditor`(sonnet)가 `main..d40708d`(`d40708d6d1f7e5d7bdf0304b533e603a64ed28e2`)를 대조했다. 보고서 항목을 빼고 모두 만족이었다(4.3-4는 사용자 확인). 빠진 보고서 항목은 이 보고서에 담았다.
- **2회(고친 범위):** `result-auditor`(sonnet)가 `4b36237`을 대조했다. 건드린 요구사항(4.2-4, 4.3-2·3·5, 4.5-2, 4.8-1·2)이 모두 만족이고 새 문제가 없었다.
- **3회(고친 범위):** `result-auditor`(sonnet)가 `ea48d18`, `c58d11f`를 대조했다. 4.3-2·3·5, 4.5-2, 4.7-4가 만족이었다.
- 마지막 커밋 기준으로 `pnpm verify` 502개, `pnpm e2e` 152개가 통과했다(브라우저 점검에서 E2E 1개가 더해져 153개가 됐다).

## 코드 리뷰

- **`/code-review`(high), `main...d40708d`:** 지적 8개가 나왔다.
  - 고친 것 5개(`4b36237`)
    - `indicator-list`를 다시 돌리면 앞 목록의 결과가 번호만 같은 새 파일에 붙었다
    - `.env.local` 값 뒤의 줄 끝 주석이 키에 들어갔다
    - 실패 이유에서 주소 인코딩된 키를 가리지 않았다
    - 월별 검사가 받는 범위 밖의 행까지 셌다
    - `site` 명령이 키를 두 번 읽었다
  - 고치지 않은 것 3개는 정리 성격이라 "제안"으로 넘겼다
- **`/code-review`(high), `d40708d..ea48d18`(고친 커밋):** 지적 2개가 나왔다.
  - 고친 것: 다시 나눈 뒤 후보 목록 제목의 번호가 파일 번호와 달랐다(`c58d11f`)
  - 고치지 않은 것: 앞 목록이 만든 더 큰 번호의 후보·판단 파일이 작업 폴더에 남는다. 실행 기록에 없는 번호는 검사·적용 명령이 거부하므로 적용될 수 없고, 결과물에도 들어가지 않는다
- **`/security-review`, `main...d40708d`:** 확신도 높은 취약점이 없었다. 키가 가는 곳, 가리기, 키 값 검사, SQL 매개변수, 판단 파일 경로, API 응답 처리, 사이트의 XSS 위험 지점, 코드에 박힌 비밀 값을 봤다.

## 재량으로 정한 것

자세한 것은 `progress.md`의 "재량 결정"에 있다. 큰 것만 옮긴다.

- 판단 여부는 별도 표(`indicator_judged`)에 둔다. 옛 형식 백업을 복원하면 모든 이슈가 "판단 안 함"이 된다(4.4-1).
- 합치기의 지표 기록은 새 표(`indicator_merges`)에 둔다. 기존 `merges` 표를 바꾸지 않아 1~5단계 동작이 그대로다.
- 키는 전역 상태가 아니라 매개변수로 검사 함수에 넘긴다. 하위 프로세스 환경에 넣지 않는다.
- 판단 파일 하나에 이슈 40개, 후보 목록의 최근 뉴스 제목 5건.
- 다시 시도는 2번(2초, 4초 간격), 요청 제한 시간 30초, 지표 사이 0.3초.
- 월별 응답 실패 기준: 범위 안의 행이 없거나, 첫 달이 저장 값보다 늦거나, 행 수가 저장 값의 90% 미만.
- 키로 볼 최소 길이 8자.
- 값이 하나도 없는 공개 지표는 목록에 `last: null`로 남기고 화면에서 뺀다. 지표 하나의 페이지가 "아직 값이 없다"를 보여야 해서다.
- `indicator-list`를 다시 돌리면 적용한 파일과 결과는 남기고, 새 파일은 그 뒤 번호로 매긴다(코드 리뷰 뒤 정함).

## 보류한 것과 풀 방법

없다.

## 쓴 비용

없다(ECOS·FRED 무료 API, Vercel 미리보기 배포 1회).

## 제안

범위 밖이라 하지 않은 개선이다.

- **칩에 쓸 짧은 이름:** 지금 칩은 지표 이름을 그대로 쓴다. 지표 정의에 짧은 이름 칸을 두면 폰에서 칩이 더 좁아진다.
- **기간을 주소에:** 지표 하나의 페이지에서 고른 기간(1개월·1년·5년)이 주소에 남지 않는다. 주소로 공유하려면 주소에 넣는다.
- **겹치는 출처 줄:** 같은 작성기관의 지표가 여럿이면 출처 줄을 묶어 보이지만, 이슈 페이지에서 그래프가 하나일 때도 같은 모양이라 조금 길다.
- **합치기 되돌리기의 판단 상태(결과 검토에서 나옴):** 합치기 m1 뒤에 판단하지 않은 이슈를 합친 m2가 있을 때 m1을 되돌리면, 남는 이슈가 m1 전 상태("판단함")로 돌아간다(`src/indicatorStore.ts:186`). 판단하지 않은 이슈가 아직 합쳐져 있는데도 그렇다. 명세 문구("판단 여부를 합치기 전으로")에는 맞지만, 다음 명세서에서 이 경우를 정해 둘 만하다.
- **`docs/plan.md` 반영:** 이 단계에서 바뀐 결정(X3 코스피·코스닥은 백업하지 않음, X7 '이번 주 일정' 상자를 '이번 주 일정 | 지표' 상자로 바꿈)을 plan에 맞춘다. X3은 D1(백업은 DB 전체를 복원)의 예외다. 6단계 끝난 상태 문구("지표 페이지와 이슈 페이지에 그래프가 있다")에는 브리프 위 상자가 없어 실제 결과와 다르다.
- **코드 정리 3개**(코드 리뷰 지적)
  - `src/indicatorStore.ts`의 `hasIndicatorTables`: 옛 스키마로 합치기를 하는 기존 테스트 때문에 운영 코드에 둔 검사다. 그 테스트가 마이그레이션한 DB를 쓰게 바꾸면 뺄 수 있다.
  - `src/indicatorStore.ts`의 `inTx`가 `src/issues.ts`의 `inTransaction`과 같다. 하나로 합친다.
  - `site/src/lib/indicators.ts`의 `monthsBefore`·`lastIndexAtOrBefore`가 `src/indicatorSite.ts`와 겹친다. 사이트와 데이터가 함께 쓰는 모듈로 옮긴다.

## 기준 보완 제안

대기 목록(`~/.claude/skills/write-spec/proposals.md`)에 올렸다(스킬 저장소 `360f08d`, push하지 않음).

- **P18. 되돌리기가 있으면 순서가 다른 되돌리기를 정한다**(4장 빠뜨리기 쉬운 것): 앞 합치기를 먼저 되돌리면 흡수된 지표가 되살아나는 버그를 테스트가 잡았다. 명세서는 순서가 다른 되돌리기를 말하지 않았다.
- **P19. "같다"로 비교하는 확인은 빈 값과 없음을 정한다**(원칙 8): 복원 비교에서 걸러 낸 뒤 빈 목록과 항목 없음을 같게 볼지 짐작했다.

기존 테스트의 버전 숫자와 파일 목록을 고친 일은 명세서 4.10-1이 이미 "허용 범위"로 다뤘으므로 제안하지 않는다.

## 스크린샷

- **실제 데이터**(`screenshots/real/`, 로컬에만 있고 git에 넣지 않음)
  - 지표 페이지: [375 라이트](screenshots/real/375-light-indicators.png), [375 다크](screenshots/real/375-dark-indicators.png), [1440 라이트](screenshots/real/1440-light-indicators.png)
  - 지표 하나의 페이지: [원/달러 5년](screenshots/real/375-light-indicator-usdkrw-5y.png), [물가 1년](screenshots/real/375-light-indicator-krcpi-1y.png), [1440 원/달러 5년](screenshots/real/1440-light-indicator-usdkrw-5y.png)
  - 브리프 상자: [라이트](screenshots/real/375-light-brief-box-indicators.png), [다크](screenshots/real/375-dark-brief-box-indicators.png)
  - 지표 하나의 페이지 다크: [원/달러 5년](screenshots/real/375-dark-indicator-usdkrw-5y.png), [물가 1년](screenshots/real/375-dark-indicator-krcpi-1y.png), [1440 물가 1년](screenshots/real/1440-light-indicator-krcpi-1y.png)
  - 이슈 페이지: [이슈 38 라이트](screenshots/real/375-light-issue-38-indicators.png), [다크](screenshots/real/375-dark-issue-38-indicators.png)
- **지어낸 데이터**(`screenshots/`, 로컬에만 있음)
  - 브리프 상자: [일정 탭](screenshots/375-light-brief-box-week.png), [지표 탭](screenshots/375-light-brief-box-indicators.png), [접은 상태](screenshots/375-light-brief-box-collapsed.png), [휴장일 칩 날짜](screenshots/375-light-brief-box-holiday-chip-date.png), [일정 없음](screenshots/375-light-brief-box-no-schedules.png)
  - 지표 페이지: [375](screenshots/375-light-indicators.png), [1440](screenshots/1440-light-indicators.png), [1440 다크](screenshots/1440-dark-indicators.png)
  - 지표 하나의 페이지: [1년](screenshots/375-light-indicator-1y.png), [5년](screenshots/375-light-indicator-5y.png), [값 누름](screenshots/375-light-indicator-5y-value-pressed.png)
  - 이슈 페이지: [그래프 3개](screenshots/375-light-issue-3-indicators.png), [그래프 1개](screenshots/375-light-issue-1-indicator.png)
  - 빈 상태·오류: [값 없음](screenshots/375-light-empty-indicator-no-values.png), [공개 지표 없음](screenshots/375-light-empty-no-public-indicators.png), [관련 이슈 없음](screenshots/375-light-empty-no-related-issues.png), [기간에 값 하나](screenshots/375-light-empty-one-value-in-period.png), [불러오기 오류](screenshots/375-light-error-indicators.png), [대기](screenshots/375-light-loading-indicator.png), [공개 끈 지표](screenshots/375-light-indicator-public-off-not-found.png)
  - 그 밖: [사이트 소개 FRED](screenshots/375-light-about-fred.png), [메뉴](screenshots/375-light-menu-open.png)
  - 다크: [브리프 상자 일정 탭](screenshots/375-dark-brief-box-week.png), [지표 탭](screenshots/375-dark-brief-box-indicators.png), [접은 상태](screenshots/375-dark-brief-box-collapsed.png), [휴장일 칩 날짜](screenshots/375-dark-brief-box-holiday-chip-date.png), [일정 없음](screenshots/375-dark-brief-box-no-schedules.png), [지표 페이지 375](screenshots/375-dark-indicators.png), [지표 하나 1년](screenshots/375-dark-indicator-1y.png), [5년](screenshots/375-dark-indicator-5y.png), [값 누름](screenshots/375-dark-indicator-5y-value-pressed.png), [이슈 그래프 3개](screenshots/375-dark-issue-3-indicators.png), [1440 지표 하나 1년](screenshots/1440-dark-indicator-1y.png)
  - 1440 라이트 지표 하나 1년: [보기](screenshots/1440-light-indicator-1y.png)

## 브라우저 점검

- 날짜: 2026-10-30. 지어낸 데이터(지표 12개 중 공개 끈 1개·값 없는 1개, 휴장일, 일정 없는 데이터, 오류 데이터)로 앱 안 브라우저에서 눌러 봤다.
- 결과: 항목 30개 중 통과 27, 고침 1, 보류 2, 사용자 판단 0.
- 고친 것: 값이 하나뿐이거나 모두 같은 그래프(예: 물가 1개월, 기준금리 1개월)에서 눈금 글자가 맨 위 선에 붙어 실제 값(가운데)과 어긋났다. 그 값 높이에 눈금 하나만 두게 고쳤다(`9c1e420`, E2E "값이 하나뿐이거나 모두 같은 그래프").
- 보류
  - '읽은 기록 지우기' 뒤 상자 상태: 확인 창을 앱 안 브라우저가 자동으로 취소해 볼 수 없었다. E2E는 통과한다.
  - 지표 하나의 페이지 대기 표시: 느린 응답을 만들 방법이 프로젝트 문서에 없다. E2E는 통과한다.
- 제안: 5년 그래프에서 오른쪽 눈금 글자 위로 선이 지나가 글자가 가려진다. 글자 뒤에 배경을 깔거나 글자를 그래프 밖에 둔다.

## 결과 검토

- **통과:** 2026-10-30(사용자 승인, `run-stage`의 마지막 질문)
- **범위:** `result-auditor`(opus)가 `main..d6fca89` 전체를 대조했다. 마지막 검증의 대조 모델(sonnet)과 다른 모델이다. 브라우저 점검 뒤 코드 커밋(`9c1e420`)이 있어 리뷰하지 않은 커밋 `ea48d18..d6fca89`는 `/code-review`(high)로 따로 리뷰했다.
- **확인된 문제:** 만족하지 않은 요구사항 0개, 기능 결함 0개.
  - 확인이 명세 문구보다 약한 테스트 3개(4.1-4에 대상·용어·일정이 없음, 4.8-1에 ECOS 실패가 없음, 4.3-5·4.2-3 흐름에 백업·빌드가 없음)와 E2E 도우미 문제 2개(고정 좌표, 못 찾으면 `undefined`)를 `afecaf0`에서 고쳤다.
  - 보고서에 빠졌거나 어긋난 6개(5단계 크기 비교, 단위, 일정 뽑기 결과, 끝난 상태 문구 차이, 링크 안 된 스크린샷, 테스트 수)를 고쳤다.
- **사용자 지적으로 `implement-spec`을 다시 부른 횟수:** 0
