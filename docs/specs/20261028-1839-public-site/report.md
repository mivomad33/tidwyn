# 결과 보고서: 3단계 공개 사이트

- 작성일: 2026-10-29
- 작업 브랜치: `spec/stage3-site` (push하지 않음)
- 보류: 없음

## 사용자가 할 일

### 1. 폰에서 사이트 확인과 기존 예약 브리프 끄기

- 폰에서 <https://tidwyn.vercel.app>을 연다. 다음이 쓸 만한지 본다.
  - 가장 최근 브리프(지금은 2026-10-27 하루뿐이다)가 보이는지
  - 뉴스를 눌러 펼친 카드와 이어지는 이야기, 이슈 페이지(타임라인·관련 이슈)
  - 대분류 필터, 아래쪽 섹션 탭, 검색(오른쪽 위 돋보기)
  - 다크 모드(폰 설정에서 다크 모드로 바꿔서)
- 괜찮으면 기존 예약 브리프를 끈다(D10).
  - 위치: claude.ai의 Claude Code **Routines(루틴)** 목록에 있는 **"Daily news brief"**(매일 03:45 KST, 지금 켜져 있음). 읽기 전용으로 루틴 목록을 조회해 찾았다. 이 컴퓨터의 데스크톱 예약 작업에는 없다.
  - 끄는 방법: claude.ai → Code → Routines에서 "Daily news brief"를 열어 끈다(일시 중지). 지우지 않고 끄기만 해도 된다. 원하면 Claude에게 "Daily news brief 루틴을 꺼 줘"라고 해도 된다.

### 2. 화면이 시안 A와 같은 느낌인지

- [design/](design/)의 확정 시안 A와 아래 스크린샷(또는 폰 화면)을 비교한다. 고칠 곳이 있으면 알려 준다.

### 3. README·LICENSE 공개 검토

- 작업 브랜치의 [README.md](../../../README.md), [README.en.md](../../../README.en.md), [LICENSE](../../../LICENSE)를 읽고 공개해도 괜찮은지 본다. **머지를 승인하면 원본 저장소가 공개된다.**

### 4. 방문 통계

- 폰으로 사이트를 연 뒤 몇 분 지나서 Vercel 대시보드 → 팀 `mivomad33` → 프로젝트 `tidwyn` → Analytics에 방문이 잡히는지 본다. (구현 중 운영 주소에서 통계 요청 `/view`가 나가는 것은 확인했다.)

### 5. 승인할 제안

- 아래 "기준 보완 제안"을 `criteria.md`에 반영할지 정한다.

### 6. 머지 승인

- 위 확인이 끝나면 `spec/stage3-site`를 main에 squash merge할지 승인한다. **머지를 승인하면 원본 저장소(`mivomad33/tidwyn`)가 공개된다.** 머지한 세션이 공개 전 점검 → main push → 공개 전환 → `curl` 200 확인을 한다(CLAUDE.md, `docs/operations.md` "머지 뒤 할 일").
- 보고서 맨 위의 사용자 확인 항목과 머지가 모두 끝났을 때, 그 일을 맡은 세션에 이 보고서 경로를 주면 `docs/specs/README.md`의 상태를 '완료'로 바꾼다.

## 만든 것과 사용법

- **사이트:** <https://tidwyn.vercel.app> (Vite + React SPA, Pagefind 검색, Vercel 호스팅, Vercel Web Analytics)
- **화면별 주소**
  - `/`: 가장 최근 날짜의 브리프
  - `/YYYY-MM-DD`: 그날 브리프. `#<섹션>-<순위>`(예: `/2026-10-27#세계-3`)는 그 뉴스 카드를 펼친다
  - `/dates`: 날짜 목록
  - `/issues`: 이슈 목록, `/issues/<번호>`: 이슈 페이지(흡수된 이슈는 남는 이슈로 간다)
  - `/search?q=<검색어>`: 검색
  - `/about`: 사이트 소개
  - 그 밖의 주소: 없는 페이지
- **매일 실행:** `/brief`가 끝에 이미지 채우기(14) → 백업(15) → 사이트 빌드(16) → 배포(17) → `data` push(18) → 요약(19)을 한다. 시험 모드와 데이터 폴더 지정 실행은 빌드만 한다.
- **새 명령**
  - 이미지 채우기: `node src/cli.ts images --run <실행 기록>`
  - 빌드: `node src/cli.ts site --run <실행 기록>` 또는 `node src/cli.ts site --data-dir <데이터 폴더>`
  - 배포: `node src/cli.ts deploy --run <실행 기록>`(실제 실행만), 손으로: `node src/cli.ts deploy --dir data/site --db data/tidwyn.db`
  - `data` push: `node src/cli.ts push --run <실행 기록>`
  - 공개 전 점검: `node src/cli.ts precheck [--refs main,data]`
  - 로컬 보기: `pnpm site:preview <결과물 폴더>`, 지어낸 데이터로 개발: `pnpm site:dev`
  - 결과물 크기 재기: `node site/size.ts <결과물 폴더>`
- 운영 방법(되돌리기, 한도, 실패 처리)은 [docs/operations.md](../../operations.md)의 "공개 사이트", "원본 저장소", "실패했을 때 할 일"에 있다.

## 이 단계의 보고 내용

### 시험 실행(4.9-2)

- 시험 폴더: `.test-data/stage3-trial/` (실제 `data/tidwyn.db`를 읽기만 해서 복사)
- 데이터 폴더 지정(`TIDWYN_DATA_DIR`) 흐름으로 이미지 채우기와 빌드를 돌렸다.
  - 채운 이미지: 5건(2026-10-27 한국-5, 세계-2, 세계-3, IT·AI-4 등의 BBC·연합뉴스 출처)
  - 빌드: 날짜 1개, 이슈 26개, 파일 17개, 523KB
- 손으로 하는 배포(`deploy --dir`)로 운영에 올렸다. 배포 주소 <https://tidwyn.vercel.app>. 배포 뒤 점검: "배포 뒤 점검 통과(최근 날짜 2026-10-27)".
  - 첫 배포는 별칭이 새 배포로 바뀌기 전에 `dates.json`을 읽어 404로 실패했다. 점검에 재시도(5초 간격 6번)를 더하고 다시 배포해 통과했다.
- 운영 확인(4.6-2·4.6-4): 화면 주소는 모두 200과 화면 틀, `site-data/`·`pagefind/`·`assets/`의 없는 파일은 404, `/package.json`·`/src/cli.ts`·`/data/tidwyn.db`·`/.git/HEAD`는 저장소 내용이 아니라 화면 틀을 준다. 
- 배포 확인(4.6-1, 읽기 전용 명령):
  - `vercel deploy .test-data/stage3-trial/site --scope mivomad33 --project tidwyn --prod --dry --json`의 파일 목록 17개가 결과물 폴더의 파일 목록과 정확히 같다(`ignored` 0).
  - `vercel api /v9/projects/tidwyn --scope mivomad33`에 `link` 키가 없다(Git 연결 없음).
  - `vercel project ls --scope mivomad33`: tidwyn, senseful, wonbook뿐이다(senseful·wonbook은 전부터 있던 것). 새 프로젝트는 생기지 않았다. 저장소에 `.vercel/`이 생기지 않았다.
- 방문 통계(4.6-4): 운영 주소에서 앱 안 이동(검색 화면 → 날짜 목록) 두 번에 `/_vercel/insights/view` 요청이 하나씩, 모두 두 번 나갔다. 본문은 `{"o":"https://tidwyn.vercel.app/search",…}`와 `{"o":"https://tidwyn.vercel.app/dates",…}`로 검색어 `q`가 없다. 로컬 미리 보기(`localhost:4180`)에서는 화면을 옮겨도 통계 스크립트와 요청이 0개다.

### 스크린샷(운영 주소, 폰 폭 375px)

| 화면 | 파일 |
| --- | --- |
| 첫 화면(라이트) | [01-home-light.jpg](screenshots/01-home-light.jpg) |
| 펼친 카드 | [02-card-expanded.jpg](screenshots/02-card-expanded.jpg) |
| 이슈 페이지 | [03-issue-page.jpg](screenshots/03-issue-page.jpg) |
| 검색 | [04-search.jpg](screenshots/04-search.jpg) |
| 이슈 목록 | [05-issues-list.jpg](screenshots/05-issues-list.jpg) |
| 날짜 목록 | [06-dates.jpg](screenshots/06-dates.jpg) |
| 없는 페이지 | [07-not-found.jpg](screenshots/07-not-found.jpg) |
| 사이트 소개 | [08-about.jpg](screenshots/08-about.jpg) |
| 원문 이미지 카드(다크) | [09-image-card-dark.jpg](screenshots/09-image-card-dark.jpg) |
| 첫 화면(다크) | [10-home-dark.jpg](screenshots/10-home-dark.jpg) |
| 넓은 화면(1440px) | [11-wide.jpg](screenshots/11-wide.jpg) |
| 필터 결과 없음 | [12-filter-empty.jpg](screenshots/12-filter-empty.jpg) |
| 데이터 불러오기 실패(요청을 막아 재현) | [13-error.jpg](screenshots/13-error.jpg) |
| 브리프 필터 뒤(경제) | [14-brief-filter.jpg](screenshots/14-brief-filter.jpg) |
| 브리프 필터 결과 없음(문화·스포츠) | [15-brief-filter-empty.jpg](screenshots/15-brief-filter-empty.jpg) |
| 검색 결과 없음 | [16-search-empty.jpg](screenshots/16-search-empty.jpg) |
| 깨진 이미지 주소의 카드(로컬, 지어낸 데이터): 이미지 없이 보인다 | [17-broken-image-local.jpg](screenshots/17-broken-image-local.jpg) |

### 파일 수·크기(4.1-3)와 첫 화면 크기(4.3-7)

| 데이터 | 파일 수 | 전체 크기 | 첫 화면 gzip |
| --- | --- | --- | --- |
| 지어낸 5년치(1,826일, 하루 42건, 이슈 15,000개) | 2,262개(한도 10,000) | 105.6MB | 112.7KB |
| 지어낸 한 달 가득(31일 × 42건, 테스트) | - | - | 300KB 이하(테스트 통과) |
| 실제 데이터 복사본(1일, 이슈 26개) | 17개 | 523KB | 83.2KB |

- 5년치를 다시 재는 명령(저장소 최상위에서):

```bash
node site/dev/fixtures.ts --out .test-data/scale5y --end 2026-10-31 --days 1826 --top 6 --short 8 --issues 15000 --contiguous
```

```bash
node site/build.ts --data .test-data/scale5y --out .test-data/scale5y-out
```

```bash
node site/size.ts .test-data/scale5y-out
```

- 5년치의 내역: `site-data/` 272개·97MB, `pagefind/` 1,986개·14MB, 화면 파일 등 4개·1MB 미만.
- 1년 뒤 예상: 실제 하루 데이터가 약 42KB(목록 11KB + 본문 31KB)이고 이슈·색인을 더하면 1년에 약 20MB, 파일 약 500개다. 지어낸 5년치도 1년 약 21MB다.
- 첫 화면은 화면 JS(76.7KB)가 대부분이고, 달 목록 파일은 가득 찬 달도 29KB다.

### 이력 다시 쓰기(4.7-2)와 공개 전 점검(4.7-3)

- 번들: `../tidwyn-history-backup-20261029.bundle`(다시 쓰기 전 모든 브랜치: main, data, spec/stage3-site). `git bundle verify` 통과.
- `git filter-branch --env-filter`로 세 브랜치의 작성자·커미터 이메일을 noreply 주소로 바꿨다. 다른 로컬 브랜치와 태그는 없었다.
- 비교: 브랜치마다 커밋을 차례로 `%T %at %ad %ct %cd|%an|%cn|%B`로 뽑아 다시 쓰기 전과 뒤를 `cmp`했다.
  - main: 트리·날짜·이름·메시지 같음(12개)
  - data: 트리·날짜·이름·메시지 같음(2개)
  - spec/stage3-site: 트리·날짜·이름·메시지 같음(29개)
- `refs/original/*`을 지우고 reflog를 정리한 뒤 `git log --all --format='%ae %ce'`에 noreply 주소만 나온다.
- 공개 전 점검: push 전 "커밋 31개(data, main, spec/stage3-site), 커밋 속 파일 212개, 지금 파일 129개를 봤다. 통과." 문서 커밋 뒤와 보고서 작성 직전에도 통과했다(아래 마지막 검증).
- push(4.7-4): main을 먼저, 그다음 `data`를 push했다. `gh repo view`: `PRIVATE`, 기본 브랜치 `main`, 설명·홈페이지(`https://tidwyn.vercel.app`)·주제 8개. `git ls-remote origin`의 main·data가 로컬과 같다.

### 실제 데이터 확인(4.9-3)

- `data/tidwyn.db` 해시가 시작(`993cb0e8…5a73`)과 끝이 같다. 실제 `data/`에는 쓰지 않았다.
- `refs/heads/data`는 이력 다시 쓰기로만 바뀌었고 트리는 같다(위 비교).

### 남은 한계

- **Vercel 무료 한도:** 파일 수(15,000)보다 총 크기(100MB)가 먼저 닿는다. 1년 약 20MB로 보면 4~5년 뒤다. 요약이 80MB에서 경고한다. 그때 Pro로 올리거나 옮긴다(`docs/operations.md`).
- **plan과 다른 값:** `docs/plan.md` 2.2의 "1년 약 100MB 예상"은 실제로 재 보면 약 20MB다. 3단계 끝난 상태 문구(Vercel 배포, 원본 저장소 공개)는 머지 뒤 공개까지 하면 실제와 맞다. 둘 다 고치지 않았다.
- **방문 통계 한도:** 월 50,000 이벤트를 넘으면 그달 수집이 멈춘다(청구 없음).
- 지금 사이트에는 실제 날짜가 하루(2026-10-27)뿐이다. 다음 실제 `/brief`부터 쌓인다.

## 요구사항별 상태

모든 요구사항이 만족이다. 확인 근거는 [progress.md](progress.md)의 체크리스트에 있다.

| 묶음 | 상태 | 주요 근거 |
| --- | --- | --- |
| 4.1 사이트 데이터·빌드 | 만족 | `test/siteData.test.ts`, `test/siteBuild.test.ts`, 5년치 빌드 측정 |
| 4.2 브리프 화면 | 만족 | `test/siteLib.test.ts`, 스크린샷 01·02·06·09·11·14·15 |
| 4.3 이슈·검색·공통 화면 | 만족 | `test/siteLib.test.ts`, `test/siteBuild.test.ts`(Pagefind 실제 검색), 스크린샷 03~08·10~13·16, 글자 대비 라이트 최저 4.69:1·다크 최저 5.66:1 |
| 4.4 원문 이미지 | 만족 | `test/images.test.ts`, 시험 실행 5건, 스크린샷 09(정상)·17(깨진 주소) |
| 4.5 `/brief` 연결 | 만족 | `test/publish.test.ts`, `test/skillDoc.test.ts` |
| 4.6 배포 | 만족 | `test/publish.test.ts`, 운영 배포·점검, 운영 curl, dry-run 파일 목록, Git 연결 없음, 통계 요청 기록 |
| 4.7 이메일·점검·push | 만족 | `test/precheck.test.ts`, 위 이력 비교, `gh repo view` |
| 4.8 문서 | 만족 | `test/readme.test.ts`, README 두 언어, LICENSE, `docs/operations.md`, CLAUDE.md |
| 4.9 기존 기능·시험 실행 | 만족 | `pnpm verify` 291개 통과, `git diff main -- test/`에 지운 줄 없음, DB 해시 |

## 마지막 검증

- `pnpm verify`: 테스트 291개 모두 통과(타입 검사, 린트 포함).
- 공개 전 점검(보고서 작성 직전): "커밋 33개(data, main, spec/stage3-site), 커밋 속 파일 221개, 지금 파일 139개를 봤다. 통과."
- 구현에 참여하지 않은 서브에이전트가 명세서와 구현을 대조했다. 코드 결함과 개인 정보·비밀 값 유출은 없었다. 증거가 없던 확인 다섯 가지(Vercel dry-run·Git 연결, 통계 요청 수와 로컬, 깨진 이미지, 브리프 필터 뒤·빈 상태, 검색 빈 상태)를 위처럼 채웠다.

## 재량으로 정한 것

- 사이트 데이터: 결과물의 `site-data/`에 `dates.json`, 달마다 `list-YYYY-MM.json`(목록)과 `detail-YYYY-MM.json`(펼친 카드 본문), `issue-list.json`, 이슈 상세는 식별자 100개씩 `issue-<n>.json`. 첫 화면 크기와 파일 수 한도를 함께 지키기 위해서다.
- 코드 위치: 사이트 화면·빌드는 `site/`(실행 경로 `src/`는 Node 내장만 쓴다는 기존 규칙 때문), DB에서 사이트 데이터를 만드는 코드는 `src/`(2단계 계산 코드를 그대로 쓰기 위해서).
- 검색 레코드: 뉴스는 날짜 하나, 이슈는 100개 묶음 하나 단위. 화면이 그 날짜·묶음 데이터를 불러 개별 뉴스·이슈를 낱말 앞부분 일치로 다시 거른다.
- "어제에 이어"는 바로 앞 저장일에 주 이슈가 같은(합친 이슈는 따라가서) 뉴스가 있을 때만 붙인다.
- 원문 주소 비교: http/https, `www.`/`m.`, 끝 `/`, `#`, 추적 질의 값을 무시하고 `bbc.co.uk`=`bbc.com`. 작업 파일의 `imageUrl`은 `save`에서 버린다.
- 토큰 모양 검사는 접두사 뒤에 충분히 긴 영숫자가 붙을 때만 잡는다(검사 코드·문서 자신이 걸리지 않게). 메일 모양 검사에서 끝이 파일 확장자인 글(`logo@2x.png`)은 메일로 보지 않는다.
- 배포 뒤 점검은 별칭 전환을 기다려 5초 간격으로 6번까지 확인한다.
- 로컬 보기는 Vercel과 같은 주소 규칙을 쓰는 `pnpm site:preview`(`site/dev/serve.ts`).
- 글꼴은 시스템 글꼴로 대신했다(외부 CDN 없음, 파일 수 늘지 않음).
- 저장소 설명: "AI가 매일 모아 쉬운 말로 바꿔 쓴 뉴스 브리프 아카이브 (Daily Korean news briefs rewritten by AI)", 주제: news, news-archive, korean, claude-code, react, vite, pagefind, vercel.
- README 스크린샷은 운영 첫 화면을 `docs/images/site-home.jpg`로 복사해 쓴다.

## 보류한 것과 풀 방법

없음.

## 쓴 비용

없음(Vercel Hobby 무료, GitHub 무료).

## 제안(범위 밖이라 하지 않은 것)

- 실제 날짜가 쌓이면 1년 뒤 실제 크기를 다시 재서 `docs/plan.md` 2.2의 "1년 약 100MB 예상"을 고친다(`review-done`에서 판단).
- 화면 JS(76.7KB gzip)가 첫 화면의 대부분이다. 필요해지면 검색·이슈 화면을 나눠 불러 더 줄일 수 있다.

## 기준 보완 제안

- **`criteria.md` 4장 "규모와 성능"에 한 문장 더하기:** "쓰는 서비스의 한도가 여러 가지(파일 수, 총 크기, 요청 수 등)면 각각을 확인에 넣는다. 하나만 확인하면 다른 한도가 먼저 닿는 것을 놓친다." 이번 명세서는 파일 수만 확인하게 해서, 총 크기(100MB)가 먼저 닿는다는 것을 구현 끝에야 알았다.
- 메일 모양 검사가 빌드 산출물의 파일 이름(`name@2x.png`)에 걸린 것은 이 프로젝트의 검사 규칙에만 해당한다. 기준이 아니라 이미 코드와 진행 기록에 남겼다.
