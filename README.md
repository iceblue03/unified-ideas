# 아이디어 중복 체크

국내 SW·창업 경진대회 역대 수상작 데이터베이스와 내 아이디어를 비교해, 이미 비슷한 시도가
있었는지 확인하는 서비스입니다. Vercel 무료 플랜으로 호스팅하고, GitHub Actions로 매달 자동
수집하며, 기본 검색 경로는 유료 AI API를 전혀 쓰지 않도록 설계했습니다.

## 왜 AI API를 거의 안 쓰는가

- 기본 검색(`app/api/search`)은 문자 bigram Dice 계수([`lib/similarity.ts`](lib/similarity.ts))로
  동작합니다. 임베딩 모델이나 LLM 호출이 전혀 없어 완전히 무료이고, 한국어 형태소 분석기 없이도
  띄어쓰기 차이에 꽤 강합니다.
- "✨ AI 정밀 분석" 버튼을 눌렀을 때만, 이미 1차로 걸러진 상위 5개 후보에 한해 Claude Haiku를
  호출합니다([`app/api/ai-review`](app/api/ai-review/route.ts)). `ANTHROPIC_API_KEY`를 설정하지
  않으면 이 기능은 자동으로 꺼집니다(501 응답 → UI에서 안내 메시지만 표시).

## 대회별 수집 방법과 상태

| 대회 | 상태 | 수집 방법 |
|---|---|---|
| 임베디드 소프트웨어 경진대회 | ✅ 자동 | eswcontest.or.kr 역대수상작 게시판 HTML 파싱 (페이지네이션) |
| 범정부 공공데이터 활용 창업경진대회 | ✅ 자동 | 서울 열린데이터광장(data.seoul.go.kr)이 매년 올리는 공식 xlsx 원본 파일을 헤드리스 브라우저로 다운로드 후 파싱 |
| 대한민국 청소년 창업경진대회 | ✅ 자동 | YEEP(yeep.go.kr) 우수 동아리 소개 게시판을 POST 요청으로 순회, 대회명으로 필터링 |
| 코드페어 (SW공모전·해커톤) | ⚠️ 반자동 | kcf.or.kr 공지사항 게시판에서 "수상작/수상팀/결과 발표" 키워드 공지를 찾아 저장. **공식 사이트가 매 시즌 과거 아카이브를 통째로 지우는 것을 확인**했기 때문에(2026년 9월 기준, 예전 히스토리 페이지 전부 소실), 이 수집기가 실행될 때마다 발견한 공지를 저장소에 누적시켜 우리만의 히스토리를 만드는 방식입니다. 지금 당장은 이번 시즌 결과 발표 전이라 0건입니다. |
| 대한민국학생발명전시회 | 📝 수동 | 발명교육포털(ip-edu.net)의 대통령상 전시관만 서버 렌더링되고, 나머지(우수상격/동상·장려상)는 아직 특정하지 못한 내부 AJAX API로 채워짐. `data/manual/student-invention.json`에 수동 보강 필요 |
| 도전! K-스타트업 | 📝 수동 | k-startup.go.kr / challengek.org에 연도별 전체 수상팀 아카이브가 없고 보도자료로만 공개됨. `data/manual/k-startup.json`에 수동 정리 |
| 창의적종합설계경진대회 | 📝 수동 | 수상작 게시판(ricee.or.kr)이 회원가입 후에만 열람 가능. `data/manual/capstone-design.json`에 수동 정리 |
| 정주영 창업경진대회 | 📝 수동 | 아산나눔재단이 선발팀 전체 명단을 구조화된 파일로 공개하지 않고 보도자료/블로그로만 소개. `data/manual/chungjuyung-startup.json`에 수동 정리 |

> 참고: 사용자가 제시한 10개 항목 중 "창업경진대회"(정주영/청소년/K-스타트업과 별개로 적힌 항목)는
> 어떤 대회를 가리키는지 특정할 수 없어 제외하고 9개 대회로 진행했습니다.

수동(📝) 대회도 검색 대상에는 포함됩니다 — 해당 JSON 파일에 항목을 채워 넣으면 다음 배포부터
바로 검색에 반영됩니다. 형식은 [`lib/types.ts`](lib/types.ts)의 `Idea`를 참고하세요.

모든 자동/반자동 수집기는 **기존에 모은 데이터와 항상 합집합으로 병합**합니다
([`scripts/collect-all.ts`](scripts/collect-all.ts)) — 원본 사이트가 나중에 옛날 글을 지우더라도
우리 저장소에는 한 번 수집한 데이터가 계속 남습니다.

## 로컬에서 실행하기

```bash
npm install
npx playwright install --with-deps chromium   # public-data-startup 수집기에 필요
npm run collect     # data/auto/*.json, data/manifest.json 생성·갱신
npm run dev          # http://localhost:3000
```

## 배포하기 (Vercel 무료 플랜)

1. 이 저장소를 GitHub에 올린다.
2. [vercel.com](https://vercel.com)에서 "New Project" → 이 GitHub 저장소를 선택 → Framework는
   Next.js로 자동 인식됨 → Deploy. (선택) AI 정밀 분석을 쓰려면 Vercel 프로젝트의 Environment
   Variables에 `ANTHROPIC_API_KEY`를 추가.
3. 그 이후로는 `main` 브랜치에 push될 때마다 Vercel이 자동 재배포한다.

## 매달 자동 수집되는 구조

[`.github/workflows/monthly-collect.yml`](.github/workflows/monthly-collect.yml)이 매달 1일
(KST 11시)에 GitHub Actions에서 `npm run collect`를 실행하고, 데이터가 바뀌었으면
`data/` 디렉터리를 커밋·푸시합니다. 그 push가 Vercel의 자동 배포를 트리거해서, 사람이 아무것도
안 해도 사이트의 데이터가 매달 갱신됩니다. GitHub Actions 탭에서 언제든 "Run workflow"로 수동
실행도 가능합니다.

Vercel 서버리스 함수 자체는 매달 대회 사이트를 크롤링하지 않습니다 — 무거운 헤드리스 브라우저
작업(Playwright)은 전부 GitHub Actions에서 끝내고, Vercel은 이미 만들어진 JSON을 읽어 검색만
수행하므로 무료 플랜의 함수 실행 시간 제한에 걸릴 일이 없습니다.
