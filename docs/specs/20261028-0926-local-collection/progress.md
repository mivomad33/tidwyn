# 1단계 진행 기록

- 시작: 2026-10-28
- 작업 브랜치: `spec/stage1-local-collection`

## 요구사항 체크리스트

| 항목 | 상태 | 확인 근거 |
| --- | --- | --- |
| 4.1-1 실행 순서 | 만족 | SKILL.md "1. 실행 순서" 표에 12단계와 명령이 있다. 4.1-7 실제 실행에서 start → validate → save → backup → summary 순서로 진행했다 |
| 4.1-2 실행 조건과 의존성 | 만족 · 사용자 확인 | `test/condition.test.ts` "4.1-2 실행 조건"(다른 브랜치, 추적 파일 수정, 추적 안 된 새 파일, worktree, main·변경 없음 통과, 환경 변수·상대 경로·심볼릭 링크, data 브랜치 있고 DB 없음, 설치 실패, node_modules 없는 클론). 깨끗한 클론에서 `pnpm install --frozen-lockfile` 뒤 `git status`가 깨끗했다(명령). 실제 거부 모습은 사용자가 확인한다 |
| 4.1-3 대상 날짜 | 만족 | `test/targets.test.ts` |
| 4.1-4 KST | 만족 | `test/kst.test.ts`(TZ=UTC, America/Los_Angeles, Asia/Seoul) |
| 4.1-5 날짜 단위 저장 | 만족 | `test/store.test.ts` "4.1-5" |
| 4.1-6 실패한 날짜 | 만족 | `test/flow.test.ts` "4.1-6"(가운데 날짜 실패, 백업 커밋 실패, 날짜 없을 때 백업). SKILL.md 7~12단계 |
| 4.1-7 실제 실행 | 만족 · 사용자 확인 | 2026-10-28 시험 모드 `start test 2026-10-26`. 대상일 10-26, 10-27을 서브에이전트가 웹 조사로 작성했다. 10-26은 한 번에 검사 통과, 10-27은 "왜 중요한가" 빈칸 7개를 한 번 고친 뒤 통과했다. 두 날짜 모두 저장·마크다운이 됐다. 커밋 없음, 실행 전후 `git status` 같음(둘 다 비어 있음), 프로젝트에 `data` 브랜치 없음. 이어서 `TIDWYN_DATA_DIR`·`TIDWYN_BACKUP_REPO`로 임시 저장소에 백업 커밋(파일: 2026-10.json, meta.json), 그 저장소에서 복원도 됐다(날짜 2개). 내용 품질은 사용자가 확인한다 |
| 4.1-8 시험 모드와 설정 표시 | 만족 · 사용자 확인 | `test/condition.test.ts` "4.1-8", `test/flow.test.ts` "4.1-8". SKILL.md 인자 규칙과 설정 표시 단계 |
| 4.1-9 스킬 문서 | 만족 | `.claude/skills/brief/SKILL.md` 하나 |
| 4.2 위치·이유, 고쳐서 다시 검사 | 만족 | `test/validate.test.ts` "4.2 위치와 이유". SKILL.md 7~10단계 4번(최대 2번) |
| 4.2-1 ~ 4.2-8 검사 규칙 | 만족 | `test/validate.test.ts` 항목별 describe. 4.2-4 저장 뒤 표시는 `test/store.test.ts` |
| 4.2-9 조사·작성 기준 | 만족 | SKILL.md "3. 조사·작성 기준"에 날짜, 조사, 순위, 출처 우선순위, 정치, 분류(S14, 예시, S3 소분류 우선), 섹션 간 중복, 문체, 저작권, 표시를 하나씩 대조했다 |
| 4.3-1 데이터 폴더 | 만족 | `test/condition.test.ts` "4.3-1". `git check-ignore data/x` 무시됨(명령) |
| 4.3-2 저장과 다시 읽기 | 만족 | `test/store.test.ts` "4.3-2" |
| 4.3-3 마이그레이션 | 만족 | `test/store.test.ts` "4.3-3" |
| 4.3-4 실행 전 사본 | 만족 | `test/snapshot.test.ts`, `test/flow.test.ts` "4.3-4"(마지막 검증에서 더함) |
| 4.3-5 테스트는 실제 DB 안 씀 | 만족 | `data/`가 없는 상태에서 `pnpm verify` 뒤에도 `data/`가 없다(명령). 테스트는 `tempDir`·`tempRepo`(os.tmpdir)만 쓴다(`test/helpers.ts`) |
| 4.4-1 마크다운 | 만족 | `test/markdown.test.ts`(기대 파일 `test/fixtures/brief-2026-10-27.md`, 이모지 없음, 순서) |
| 4.4-2 대화창 출력 | 만족 · 사용자 확인 | SKILL.md 12단계. 4.1-7에서 summary 출력에 저장 날짜, 백업 결과, 다른 날짜 경로, 10-27 마크다운 전체가 나왔다 |
| 4.4-3 마크다운 다시 만들기 | 만족 | `test/markdown.test.ts` "4.4-3" |
| 4.5-1 월별 JSON 내보내기 | 만족 | `test/backup.test.ts` "4.5-1" |
| 4.5-2 `data` 브랜치 커밋 | 만족 | `test/backup.test.ts` "4.5-2" |
| 4.5-3 복원 | 만족 | `test/backup.test.ts` "4.5-3". 복원 명령은 런타임 의존성이 없어 설치 없이 돈다(`test/condition.test.ts`의 import 검사) |
| 4.5-4 백업 저장소 지정 | 만족 | `test/condition.test.ts` "4.5-4", `test/backup.test.ts` "4.5-4" |
| 4.6-1 무인 실행 | 만족 · 사용자 확인 | SKILL.md에 사용자 입력을 기다리는 단계가 없다. 운영 문서 "전제". `.claude/settings.json` 없음(명령) |
| 4.6-2 지시 주입·실행 중 금지 | 만족 | SKILL.md 0장(네 규칙, 실행 중 금지, 멈추면 그대로 끝내기, 서브에이전트 프롬프트 규칙). Claude가 직접 실행하는 git 명령은 없다. stash·clean·checkout·reset은 금지 목록에만 나온다 |
| 4.6-3 비밀 값·로컬 경로 | 만족 | `git ls-files`에 `.db`·`.env`·사본 없음, `git check-ignore`로 무시 확인(명령). `test/backup.test.ts` "4.6-3". `git grep "$HOME"` 결과 없음(명령). 4.1-7 백업 JSON에 홈 경로·사용자 이름 없음 |
| 4.7-1 검증 명령 | 만족 | `pnpm verify` 종료 코드 0. 깨끗한 클론에서 타입 오류 파일을 넣으면 종료 코드 2 |
| 4.7-2 Node 고정·설치·무시 | 만족 | `.node-version` 24, `package.json` engines·packageManager. 깨끗한 클론에서 `pnpm install --frozen-lockfile`과 `pnpm verify` 통과. `git check-ignore`로 각 경로 확인 |
| 4.7-3 운영 문서 | 만족 | `docs/operations.md` |
| 완료: 검증 명령이 마지막 커밋에서 통과 | 만족 | 657e3bc에서 `pnpm verify` 통과(107개) |
| 완료: `data/`·실제 `data` 브랜치 없음, 시험 데이터 폴더 지움 | 만족 | `.test-data/` 지움, `data/` 없음, `git branch -a`에 data 없음 |

## 작업 계획

1. 개발 기반: package.json, tsconfig, 린트, 테스트 도구, `.gitignore`, Node 고정 (끝)
2. 설정 계산, 인자, 실행 조건, KST 날짜, 대상 날짜 (끝)
3. 검사(4.2), 저장·마이그레이션·사본(4.3), 마크다운(4.4) (끝)
4. 백업·복원(4.5) (끝)
5. CLI 명령 묶기(check / start / validate / save / fail / backup / summary / render / restore) (끝)
6. 스킬 문서, 운영 문서 (끝)
7. 4.1-7 실제 실행 (끝)
8. 마지막 검증, 결과 보고서 (끝. 독립 대조에서 나온 두 건(대소문자 경로 우회, start 사본 통합 테스트)을 고치고 다시 검증)

## 재량 결정

- 런타임 의존성 없음: SQLite는 Node 24 내장 `node:sqlite`를 쓰고, TypeScript는 Node의 타입 제거 실행으로 빌드 없이 돈다. 그래서 실행 조건 확인과 복원 명령을 포함한 실행 경로 전체가 의존성 설치 없이 돈다(4.1-2, 4.5-3). 개발 의존성(typescript, eslint)만 pnpm으로 설치한다.
- 패키지 관리자 pnpm(준비물에 있음), 테스트는 Node 내장 `node:test`.
- TypeScript는 6.0으로 고정했다. 최신 7.0은 typescript-eslint 8의 지원 범위(6.1 미만) 밖이다.
- 명령은 `node src/cli.ts <명령>` 하나의 진입점. `start`가 인자 확인부터 대상 날짜까지(4.1-1의 1~6단계)를 순서대로 한다. 각 단계는 함수로 나눠 테스트한다. 의존성 설치는 주입한다(`Context.install`).
- 스킬과 스크립트 사이의 데이터: Claude가 `<데이터 폴더>/work/<날짜>.json`에 브리프 데이터를 쓰고, 실행 기록 `<데이터 폴더>/runs/<시각>.json`이 날짜별 결과와 백업 결과를 모은다.
- 브리프 데이터 JSON은 영어 항목 이름(`whyItMatters` 등)을 쓰고, 모르는 항목은 거부한다(오타로 항목이 조용히 빠지는 것을 막는다).
- 데이터 폴더 구성: `tidwyn.db`, `snapshots/`, `briefs/<날짜>.md`, `backup/`, `work/`, `runs/`. 시험 데이터 폴더는 지금 작업 트리의 `.test-data/<KST 시각>/`.
- 백업 커밋은 worktree 없이 임시 인덱스와 git 저수준 명령(`hash-object`, `update-index`, `write-tree`, `commit-tree`, `update-ref`)으로 한다. 작업 트리·HEAD를 건드리지 않고, 남은 작업 폴더나 worktree 문제가 생기지 않는다.
- 백업 형식: `meta.json`(형식 버전, 첫 수집일)과 `YYYY-MM.json`(형식 버전, 달, 저장된 브리프 목록). 복원은 임시 파일에 다 만든 뒤 옮긴다.
- 환경 변수 이름: `TIDWYN_DATA_DIR`, `TIDWYN_BACKUP_REPO`.
- 발행일은 `YYYY-MM-DD` 형식으로 받는다.
- 시험 모드에도 첫 수집일을 기록한다(시작일). 시험 데이터 폴더 안에서만 쓰인다.
- 4.1-7 뒤 SKILL.md에 "4위 이하도 항목을 비우지 않는다"를 더했다. 서브에이전트가 "4위 이하는 짧게"를 항목 생략으로 읽었기 때문이다.

## 보류

없음.

## 명세서가 놓친 점

- 명세서는 `spec/stage1-local-collection` 브랜치에서 이어 구현하라고 했지만, 검토 통과 뒤 그 브랜치를 main에 squash merge하고 지웠다. 같은 이름으로 main에서 다시 만들어 진행했다.
- 브리프 형식의 "4위 이하는 배경과 핵심 사실을 짧게"를 조사 서브에이전트가 "왜 중요한가를 비워도 된다"로 읽었다. 검사가 잡아 한 번 고쳐 통과했고, 스킬 문서 문장을 분명히 했다.
- 4.1-7에서 웹 페이지 읽기 도구가 Reuters·AP를 읽지 못했다(차단·403). 서브에이전트가 같은 기사를 실은 다른 매체나 검색 결과로 확인했고, 일부 발행일은 검색 맥락으로 추정했다. 명세서의 출처 우선순위(통신사 우선)가 도구 제약 때문에 다 지켜지지 않을 수 있다.
- 마지막 검증의 독립 대조에서, macOS에서 `TIDWYN_DATA_DIR=DATA`처럼 대소문자만 다른 경로로 실행 조건을 피할 수 있었다. 명세서의 "실제 경로를 풀어서 비교"만으로는 대소문자를 구분하지 않는 파일 시스템이 드러나지 않았다. 대소문자를 무시하고 비교하도록 고쳤다(더 엄격한 쪽).

결과 보고서: [report.md](report.md)
