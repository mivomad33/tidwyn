# Tidwyn

[English](README.en.md)

AI가 매일 한국·세계·IT·AI 뉴스를 모아 쉬운 말로 바꿔 쓰고, 뉴스를 이슈로 엮어 흐름까지 보여 주는 개인 뉴스 아카이브입니다.

- 사이트: <https://tidwyn.vercel.app>

<img src="docs/images/site-home.jpg" alt="Tidwyn 첫 화면(폰 폭)" width="320">

## 무엇을 하나요

- **날짜별 브리프:** 매일 한국, 세계, IT·AI 세 섹션의 주요 뉴스와 짧은 소식을 정리합니다. 뉴스마다 한 줄 요약, 왜 중요한가, 배경, 핵심, 전망, 출처가 있습니다.
- **이어지는 이야기:** 뉴스를 이슈로 엮어 이전 전개, 이슈 요약, 타임라인, 관련 이슈를 보여 줍니다.
- **찾아보기:** 대분류 필터, 날짜 목록, 이슈 목록, 사이트 안 검색을 폰에서 쓸 수 있습니다.

## 작동 방식

1. 로컬 Claude Code에서 `/brief` 스킬을 실행하면 전날 뉴스를 조사해 정해진 형식으로 씁니다.
2. 스크립트가 검사한 뒤 로컬 SQLite DB에 저장하고, 뉴스를 이슈에 연결합니다. DB가 원본입니다.
3. DB 전체를 월별 JSON으로 내보내 `data` 브랜치에 백업 커밋하고 push합니다.
4. DB로 정적 사이트를 빌드해 Vercel에 배포합니다.


## 쓰는 기술

- 수집·저장: TypeScript(Node 24, 내장 `node:sqlite`), Claude Code 스킬
- 사이트: Vite, React, Pagefind(검색), Vercel(호스팅, Web Analytics)
- 테스트: `node:test`

## 실행 방법

```bash
pnpm install
```

```bash
pnpm verify
```

- 매일 수집은 Claude Code에서 `/brief`를 실행합니다. 시험 실행은 `/brief test`입니다.
- 지어낸 데이터로 사이트를 띄워 보려면 `pnpm site:dev`를 실행합니다.
- 실행 조건, 손으로 배포하기, 되돌리기, 실패했을 때 할 일은 [운영 문서](docs/operations.md)에 있습니다.
- 프로젝트의 목표와 단계는 [진행 계획](docs/plan.md)에 있습니다.

## 라이선스와 저작권

- 코드는 [MIT 라이선스](LICENSE)입니다.
- 브리프와 이슈 글(`data` 브랜치의 백업 데이터와 사이트 내용)의 저작권은 mivomad33에게 있으며, 재사용을 허락하지 않습니다.
- 원문 기사와 이미지의 저작권은 각 매체에 있습니다. 사이트는 원문 문장을 바꿔 쓰고, 이미지는 원문 주소로만 연결합니다.
- 글은 AI가 쓴 것이라 틀릴 수 있습니다. 중요한 내용은 원문을 확인해 주세요.
