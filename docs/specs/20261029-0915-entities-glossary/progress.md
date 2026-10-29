# 진행 기록

## 시작 시 기록 (2026-10-29)

- 시작 전 점검: 통과(미확정 표시 없음, Vercel CLI `mivomad33-8917` 로그인, 운영 inspect 읽기 성공).
- `data/tidwyn.db` sha256: `66d0f06f59d21f4ddee475800d8b4f23faed9257345cb301309d2a7b65ac7329`
- `refs/heads/data`: `36c1d7ce79400d34ffdeac88bd1c3983fd9f2c9d`
- 운영 배포 ID(`vercel inspect tidwyn.vercel.app --scope mivomad33`): `dpl_3c4zbz3TQCXtPfWjid7pZKv3aR1a`
- `data/runs/` 최신: `20261029-084524.json`

## 요구사항 체크리스트

| 항목 | 상태 | 근거 |
|---|---|---|
| 4.1-1~5 데이터·마이그레이션 | 만족 | test/refs.test.ts(데이터 모델, 첫 뉴스, 멱등, v3 마이그레이션), 1~3단계 테스트 통과 |
| 4.2-1 실행 순서 | 만족 | SKILL.md 7-1·12-1·5장, test/skillDoc.test.ts 명령·순서 테스트, 시험 실행 |
| 4.2-2 후보 목록·검색 | 만족 | test/refs.test.ts(대상 3,000개, 지운 이름 검색) |
| 4.2-3 뽑기 파일 검사 | 만족 | test/refs.test.ts 거부 경우·이름 바꾸기 |
| 4.2-4 뽑기 기준 | 사용자 확인 | SKILL.md 5장(읽어서 확인), 검토 파일은 시험 폴더 |
| 4.2-5 실패·재시도 | 만족 | test/refs.test.ts CLI 실패·재시도, 시험 모드 |
| 4.3-1~4 합치기·되돌리기·지우기 | 만족 | test/refs.test.ts 합치기 후보·적용·거부·되돌리기·지우기 흔적 없음·S12 거부 |
| 4.4-1~2 백업·공개 데이터 검사 | 만족 | test/refs.test.ts 왕복·최대 식별자·형식 2, test/backup.test.ts, 시험 결과물 검사 통과 |
| 4.5-1~2 start·요약 | 만족 | test/refs.test.ts 요약 줄·경고 줄 |
| 4.6-1, 4.6-3, 4.6-4 사이트 데이터·같은 결과·검색 | 만족 | test/siteEntities.test.ts, test/siteBuild.test.ts |
| 4.6-2 파일 수·크기 | 만족 | 5년치 2,852개·194.71MB, 첫 화면 117.6KB, 대상 목록 2.9~3.6KB, 뉴스 10,971건 대상 81.0KB(--hub 131.6KB), 용어 사전 22.6KB |
| 4.7-1~8 화면 | 만족 | test/siteEntities.test.ts, test/e2e/stage4.spec.ts, screenshots/ |
| 4.7-9 화면 상태·대비 | 만족 | screenshots/ 26장, 대비 라이트 최저 4.76·다크 최저 5.66 |
| 4.8-1 미리보기 배포 | 만족 | test/preview.test.ts, 실제 미리보기 Ready·curl 302(로그인)·운영 ID 같음 |
| 4.8-2, 4.9-1~4 문서 | 만족 | SKILL.md, docs/operations.md, README 두 파일. plan.md는 4.5단계 추가만(사용자 지시) |
| 4.10-1 기존 테스트 | 만족 | pnpm verify 367개 통과, 기존 줄 변경은 버전 숫자 줄뿐(보고서에 목록) |
| 4.10-2 시험 실행 | 만족 | .test-data/trial-20261029-112114, 복원 비교 같음 |
| 4.10-3 실제 데이터 보호 | 만족 | 끝날 때 DB 해시·data ref 같음 |
| E2E(사용자 결정) | 만족 | pnpm e2e 75개 통과, 일부러 망가뜨리면 실패함을 확인 |
| 5장 dependencies 비어 있음 | 만족 | package.json에 dependencies 없음 |
| 5장 precheck | 만족 | 작업 브랜치에서 통과 |
| 5장 운영 배포 같음 | 만족 | dpl_3c4zbz3TQCXtPfWjid7pZKv3aR1a 그대로 |
| 5장 report.md | 만족 | report.md |

## 작업 계획

1. 사이트 데이터 형식(siteTypes) — 끝
2. DB·데이터 계층(db v4, refs, extract, refMerge, merge 공통화, backup v3, precheck·siteCheck, siteData, publish) — 끝
3. CLI 명령(refs, ref-search, ref-check, ref-apply, ref-unmerge, ref-delete, deploy --preview)과 start·요약 줄 — 끝
4. 백엔드 테스트(test/refs.test.ts, test/preview.test.ts) — 끝
5. 스킬 문서·운영 문서·README
6. 화면(서브에이전트) 검토·합치기
7. Playwright E2E(4단계 화면 + 3단계 화면 전체 회귀, `pnpm e2e`)
8. 5년 규모 측정
9. 시험 실행·미리보기 배포·스크린샷
10. 마지막 검증, 보고서

## 재량 결정

- 2026-10-29 · 사용자 결정(리뷰 세션 전달): 화면 동작은 Playwright E2E로 확인한다. 4단계 화면과 3단계 화면 전체(회귀)를 넣는다. `pnpm verify`와 따로 `pnpm e2e`로 두고 통과를 요구한다. 지어낸 데이터(`site:dev` 픽스처)와 로컬 보기 서버로만 돌린다(네트워크·실제 data/ 없음). 명세서 7장 "테스트 도구와 층"을 사용자가 정한 것이다.
- 지운 대상·용어는 행을 남기고 이름·별칭·설명을 비운다(묘비 행). 백업에도 `{id, deleted:true}`로 남겨 복원 뒤에도 식별자를 다시 쓰지 않는다(AUTOINCREMENT 순번이 가장 큰 식별자를 따른다).
- 흡수된 것을 지울 때 함께 지운 것은 `merged_into`를 비워 옛 주소가 없는 페이지가 되게 한다.
- 합치기·이름 바꾸기에서 별칭을 더할 때 정규화하면 이미 있는 이름·별칭과 같은 표기(띄어쓰기만 다른 것 등)는 겹쳐 넣지 않는다.
- 대상·용어 합치기는 2단계 합치기 파일에 `entityMerges`·`termMerges`로 넣고, 이슈 합치기와 한 트랜잭션으로 적용한다(전부 통과해야 적용하고 점검일을 바꾼다). 되돌리기는 새 명령 `ref-unmerge`로 둔다. 비슷한 쌍 찾기(바이그램)는 2단계 코드(`similarPairs`)를 공통으로 쓴다.
- 지운 이름 키 파일은 데이터 폴더 바로 아래 `deleted-names.key`(64자 16진수, 권한 0600). 공개 전 점검이 이 이름을 걸러 낸다.
- 지운 이름 기록을 풀어 주는 명령은 두지 않는다(운영 문서에 사본 복원으로 안내).
- 사이트 빌드 줄의 대상·용어 수는 기존 줄 끝에 붙인다(기존 요약 테스트의 정규식을 바꾸지 않으려고).
- 스크린샷은 Playwright Chromium(헤드리스, 375×812·1440, 라이트·다크)으로 찍었다(26장, 스크립트는 `.test-data/shots/`). 상태를 고르기(오류·빈 상태는 요청 가로채기) 쉬워서다. 배율 1로 찍어 저장소 크기를 줄였다.
- 2026-10-29 · 사용자 지시: plan.md에 4.5단계(읽은 뉴스 표시)를 이 브랜치에서 더한다. 4.9-4의 예외다. review-plan은 돌리지 않는다.
- `playwright.config.ts`를 tsconfig `include`에 더해 타입 검사를 받게 했다.
- 마지막 검토 1회차 지적: 빌드와 화면 쪽의 목록·사전 코드가 따로 있었다 → `src/siteTypes.ts`로 합쳤다. DB로 만든 사이트 데이터 테스트(`test/refsSite.test.ts`), 조사 검색, 점검일 명령 테스트, 작은 거부 경우를 더했다.

## 보류

## 명세서가 놓친 점

- 4.10-1은 버전 숫자 줄 변경을 허용하는데, `test/store.test.ts`의 테스트용 마이그레이션이 버전 4를 쓰고 있어 실제 v4와 부딪혔다. 버전 숫자 줄이라 5로 올렸다(허용 범위로 해석).
- Playwright E2E는 명세서 작성 뒤 사용자가 더한 범위다(리뷰 세션 전달).
- "화면 확인"은 내장 브라우저로 본다고 적혀 있으나, 상태를 많이 만들어야 해 헤드리스 Chromium으로 찍었다. 내장 브라우저로 직접 보는 점검은 `/browser-check`로 넘긴다.
- 화면 확인 스크린샷이 실제 복사본으로 찍혀 실제 기사 사진과 공인 이름이 들어간다. 공개 main에 들어가므로 사용자 확인 2번에서 함께 보게 한다.

보고서: [report.md](report.md)
