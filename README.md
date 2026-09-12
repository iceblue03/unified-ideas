# 아이디어 중복 체크

국내 SW·창업 경진대회 역대 수상작 데이터베이스와 내 아이디어를 비교해, 이미 비슷한 시도가
있었는지 확인하는 서비스입니다. Vercel 무료 플랜으로 호스팅하고, GitHub Actions로 매달 자동
수집하며, 기본 검색 경로는 유료 AI API를 전혀 쓰지 않도록 설계했습니다.

## 왜 AI API를 거의 안 쓰는가

- 기본 검색(`app/api/search`)은 단어 단위 TF-IDF(BM25 스타일) 가중치 기반 유사도
  ([`lib/similarity.ts`](lib/similarity.ts))로 동작합니다. 제목과 요약/분류(내용) 텍스트를 함께
  토큰화해서, 코퍼스 전체에서 자주 등장하는 흔한 단어("시스템", "서비스" 등)는 자동으로 덜
  중요하게, 드물고 구별력 있는 단어는 더 중요하게 반영합니다. 제목에는 더 큰 가중치를 주고,
  한국어 특유의 띄어쓰기 없는 복합명사("시각장애인" 안의 "장애인" 등)는 부분 문자열 매칭으로
  보완하며, 문자 bigram 유사도를 아주 작은 비중으로 안전망 삼아 섞습니다. 임베딩 모델이나 LLM
  호출이 전혀 없어 완전히 무료입니다.
- "AI 정밀 분석" 버튼을 눌렀을 때만, 이미 1차로 걸러진 상위 5개 후보에 한해 OpenRouter의
  무료 모델(`nex-n2.5-pro:free`)을 호출합니다([`app/api/ai-review`](app/api/ai-review/route.ts)).
  환경변수 `openrouter_key`를 설정하지 않으면 이 기능은 자동으로 꺼집니다(501 응답 → UI에서
  안내 메시지만 표시). 모델 응답은 자유 서술형 텍스트가 아니라 고정 JSON 스키마(`AiReviewResult`)로
  강제해서, 참신도 평가와 키워드를 칩으로, 그리고 가장 유사한 후보 하나는 공유하는 핵심 아이디어를
  강조하고 유사점/차이점을 구조화된 카드로 렌더링합니다([`app/page.tsx`](app/page.tsx)).

## 대회별 수집 방법과 상태

현재 8개 대회 전부 자동/반자동 수집기를 확보해서, **수동으로 채워야 하는 대회는 하나도 없습니다**
(전체 6,600여 건 누적). 두 대회(창의적종합설계경진대회, 정주영 창업경진대회)는 구조화된 공개
아카이브를 도저히 찾지 못해, 같은 개수를 유지하면서 수집하기 쉬운 다른 대회로 대체했습니다.

| 대회 | 상태 | 수집 방법 |
|---|---|---|
| 임베디드 소프트웨어 경진대회 | ✅ 자동 | eswcontest.or.kr 역대수상작 게시판 HTML 파싱 (페이지네이션) |
| 범정부 공공데이터 활용 창업경진대회 | ✅ 자동 | 서울 열린데이터광장(data.seoul.go.kr)이 매년 올리는 공식 xlsx 원본 파일을 헤드리스 브라우저로 다운로드 후 파싱 |
| 대한민국 청소년 창업경진대회 | ✅ 자동 | YEEP(yeep.go.kr) 우수 동아리 소개 게시판을 POST 요청으로 순회, 대회명으로 필터링 |
| 코드페어 (SW공모전·해커톤) | ⚠️ 반자동 | kcf.or.kr 공지사항 게시판(`/84`)을 매달 훑어 "수상작/수상팀/결과 발표" 공지를 누적 저장하는 것에 더해, **라이브 사이트가 지워버린 옛 "역대 수상작(히스토리)" 게시판을 Wayback Machine에서 되살려** 2022~2024년 부문별 수상 게시글 14건을 백필했습니다(게시글 본문이 스크린샷 이미지라 팀명까지는 못 긁습니다). |
| 대한민국학생발명전시회 | ✅ 자동 | 발명교육포털(ip-edu.net)의 내부 AJAX 엔드포인트(`.../exhibition/inc/list.ajax`)를 연도(2021~2026)·부문별로 순회해 수집, 상세 페이지(`edit.do`)에서 학교/수상자/발명동기 등을 보강. 1,180건. |
| 도전! K-스타트업 | ✅ 자동 | k-startup.go.kr엔 구조화된 아카이브가 없어, 같은 운영기관(창업진흥원)의 challengek.org "역대수상기업" 페이지를 대신 수집(페이지에 내장된 Wix 데이터 JSON 파싱). 2016~2025년, 150건. |
| 대한민국발명특허대전 | ✅ 자동 (대체 대회) | 한국발명진흥회(KIPA)가 공개하는 연도별 수상현황 페이지(kipa.org/kinpex, 2006~2025년)를 HTML 파싱. 원래 목표였던 **창의적종합설계경진대회**는 수상작 게시판(ricee.or.kr)의 robots.txt가 크롤링을 명시적으로 금지(`Disallow: /`)하고 있어 자동 수집 대상에서 제외하고, robots.txt상 문제없고 20개년치를 공개하는 이 대회로 대체했습니다. 2,093건. |
| 농림축산식품부 공공데이터 활용 창업경진대회 | ✅ 자동 (대체 대회) | data.mafra.go.kr의 수상작 JSON API를 파싱. 원래 목표였던 **정주영 창업경진대회**는 아산나눔재단이 선발팀 명단을 구조화된 형태로 전혀 공개하지 않아(현재 사이트는 모집 안내뿐, 보도자료로만 흩어져 공개) 자동 수집이 불가능해, 구조화된 공개 아카이브가 있는 이 대회로 대체했습니다. 129건. |

각 대회로 대체/수집하게 된 자세한 근거(실제로 확인한 URL, robots.txt, 실패한 시도 등)는
[`lib/collector-meta.ts`](lib/collector-meta.ts)의 각 `method` 필드에 정리되어 있습니다.

모든 자동/반자동 수집기는 **기존에 모은 데이터와 항상 합집합으로 병합**합니다
([`scripts/collect-all.ts`](scripts/collect-all.ts)) — 원본 사이트가 나중에 옛날 글을 지우더라도
우리 저장소에는 한 번 수집한 데이터가 계속 남습니다. 대회를 하나 더 늘리고 싶다면
[`lib/types.ts`](lib/types.ts)의 `Idea`를 반환하는 `Collector`를 `scripts/collectors/`에 새로 만들고
`scripts/collect-all.ts`의 `COLLECTORS` 배열과 `lib/competitions.ts`의 `AUTO_COMPETITIONS`에 등록하면
됩니다. 정말 구조화된 공개 아카이브를 못 찾은 대회가 생기면 `lib/competitions.ts`의
`MANUAL_COMPETITIONS`에 등록하고 `data/manual/<slug>.json`에 수동으로 채워 넣는 경로도 여전히
지원합니다.

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
   Variables에 [OpenRouter](https://openrouter.ai) API 키를 `openrouter_key`라는 이름으로 추가.
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
