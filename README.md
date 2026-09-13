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
- 검색창 옆의 "AI 검색" 토글(기본 ON)을 켠 채로 검색하면, 검색 진행 단계(대회 검색 → 검색어 생성 →
  특허/제품 검색 → AI 분석)를 실시간 스트리밍으로 보여주면서 한 번의 검색으로 로컬 TF-IDF(대회) +
  KIPRIS 특허 검색([`lib/kipris.ts`](lib/kipris.ts)) + eBay 상품 검색
  ([`lib/ebay-shopping.ts`](lib/ebay-shopping.ts) — 네이버쇼핑 검색 API가 서비스 종료되어 대체)을
  함께 조회하고, OpenRouter의 무료 모델(`nex-agi/nex-n2.5-mini:free`, 지연시간/장애 시
  `nex-n2.5-pro:free`로 자동 폴백 — 두 모델 모두 프롬프트를 학습에 쓰지 않음이 명시된 데이터
  정책을 가짐, [`lib/openrouter.ts`](lib/openrouter.ts))이 (1) 아이디어의 핵심 기술을 KIPRIS
  키워드 배열로, 실제 유사 제품이 나올 법한 쇼핑 검색어로 각각 변환한 뒤
  ([`lib/ai-query-gen.ts`](lib/ai-query-gen.ts)), (2) 대회·제품·특허 결과 전체를 특허 심사관처럼
  엄격한 기준(핵심 기술/작동 방식이 실질적으로 겹칠 때만 "관련 있음"으로 판단, 단순 키워드·분야
  일치는 배제)으로 재평가해 "이미 존재함 / 일부 겹침 / 블루오션" 진단과 관련도 0.6 이상인
  것만 최대 3건 구조화된 리포트로 만듭니다([`lib/ai-rank.ts`](lib/ai-rank.ts),
  [`app/api/search`](app/api/search/route.ts)). 토글을 끄면 기존과 동일하게 로컬 TF-IDF만 즉시
  동작합니다. `openrouter_key`/`EBAY_CLIENT_ID`+`EBAY_CLIENT_SECRET`/`KIPRIS_SERVICE_KEY` 중
  설정되지 않은 게 있으면 해당 기능만 조용히 꺼지고(대회 탭은 항상 정상 동작), 관련 안내가
  리포트 아래 경고 문구로 표시됩니다. KIPRIS 키워드는 특허청 검색식(AND 연산자 `*`)으로 직접
  조립하고, 응답이 와도 실제로 키워드를 포함하지 않는 항목은 걸러냅니다(간혹 KIPRIS가 무관한
  결과를 정상 응답처럼 돌려주는 경우가 있어 방어적으로 검증합니다).
- 검색 자체는 익명으로도 항상 동작하지만, 모든 검색은 (설정돼 있다면) 운영자의 구글 시트에
  질의·결과 요약이 기록됩니다([`lib/sheets-log.ts`](lib/sheets-log.ts), 응답을 막지 않는
  `next/server`의 `after()`로 실행). 구글 로그인은 완전히 선택 사항이며([`lib/session.ts`](lib/session.ts),
  [`lib/google-auth.ts`](lib/google-auth.ts)) 로그인하지 않아도 검색은 익명 쿠키로 그대로 기록됩니다.
- 일부 대회는 작품 설명이 텍스트가 아니라 이미지나 PDF(스캔·CID 폰트)로만 게시됩니다. 이 경우
  [tesseract.js](lib/ocr.ts)로 로컬에서 OCR을 돌려 텍스트를 뽑아냅니다 — 완전히 오프라인·무료로
  동작하는 오픈소스 OCR이라 위 "AI API를 안 쓴다"는 원칙에 어긋나지 않습니다. PDF는
  poppler 같은 외부 프로그램 없이 Playwright(Chromium) 안에서 pdf.js를 직접 돌려 페이지를
  이미지로 렌더링한 뒤 OCR합니다([`lib/pdf-render.ts`](lib/pdf-render.ts)).

## 대회별 수집 방법과 상태

10개 대상 대회 중 9개가 자동/반자동 수집기를 확보했고, **정주영 창업경진대회만 여전히 수동**입니다.
창의적종합설계경진대회는 원본 대회 자체를 OCR로 직접 자동화했고, 그와 별개로 원래 이 두 대회를
대체하려 했던 대회(대한민국발명특허대전, 농림축산식품부 공공데이터 활용 창업경진대회)도 자체 가치가
있어 대체가 아니라 추가로 자동 수집 대상에 포함했습니다.

| 대회 | 상태 | 수집 방법 |
|---|---|---|
| 임베디드 소프트웨어 경진대회 | ✅ 자동 | eswcontest.or.kr 역대수상작 게시판 HTML 파싱 (페이지네이션) + 항목별 상세페이지까지 열어 원본 이미지(작품 설명은 텍스트가 아니라 JPG로만 게시됨)를 attachments로 보존 |
| 범정부 공공데이터 활용 창업경진대회 | ✅ 자동 | 서울 열린데이터광장(data.seoul.go.kr)이 매년 올리는 공식 xlsx 원본 파일을 헤드리스 브라우저로 다운로드 후 파싱 |
| 대한민국 청소년 창업경진대회 | ✅ 자동 | YEEP(yeep.go.kr) 우수 동아리 소개 게시판을 POST 요청으로 순회, 대회명으로 필터링 + 카드별 상세페이지를 한 번 더 열어 "동아리소개/아이디어 개요/창업전략" 이미지의 alt 텍스트(평문)로 요약을 보강 |
| 코드페어 (SW공모전·해커톤) | ⚠️ 반자동 | kcf.or.kr 공지사항 게시판에서 "수상작/수상팀/결과 발표" 키워드 공지를 찾아 본문 전체와 첨부 이미지·파일을 저장하고, **라이브 사이트가 지워버린 옛 "역대 수상작(히스토리)" 게시판을 Wayback Machine에서 되살려** 과거 부문별 수상 게시글도 백필합니다. 결과를 팀명만 적힌 이미지 표로 올리는 경우가 흔해(2026 시즌 서면심사 결과에서 확인), 이미지·첨부파일은 attachments로만 보존하고 그 안 텍스트를 title/team으로 추측해 넣지 않습니다(팀명↔작품명 오인 방지). |
| 대한민국학생발명전시회 | ✅ 자동 | 발명교육포털(ip-edu.net)의 내부 AJAX 엔드포인트(`.../exhibition/inc/list.ajax`)를 연도(2021~)·부문별로 순회해 수집, 상세 페이지(`edit.do`)에서 학교/수상자/발명동기 등을 보강. OCR 없이 구조화된 데이터로 1,180건 확보(이전엔 그 해 PDF 수상작품집을 OCR로 읽었으나 최신 1개년치만 커버되고 오차도 있어 이 방식으로 교체). |
| 창의적종합설계경진대회 | ✅ 자동 | 행사 사이트(e2festa.kr)에서 그 해 "출품작 온라인 디렉토리북" PDF를 찾아 다운로드합니다. 한글 본문이 CID 폰트라 텍스트 추출이 안 되어([`lib/pdf-render.ts`](lib/pdf-render.ts) 참고), Playwright로 pdf.js를 브라우저 안에서 직접 돌려 페이지를 렌더링하고, 좌(본문)/우(학교·팀 정보) 컬럼을 나눠 각각 OCR합니다. 이 도록은 수상작이 아니라 그 해 전체 참가작 목록이라 `award`는 비워둡니다. |
| 대한민국발명특허대전 | ✅ 자동 | 한국발명진흥회(KIPA)가 공개하는 연도별 수상현황 페이지(kipa.org/kinpex, 2006~2025년)를 HTML 파싱. 창의적종합설계경진대회와는 별개 대회로, 둘 다 자동 수집 대상에 포함합니다. |
| 도전! K-스타트업 | ✅ 자동 | k-startup.go.kr엔 구조화된 아카이브가 없어, 같은 운영기관(창업진흥원)의 challengek.org "역대수상기업" 페이지를 대신 수집(페이지에 내장된 Wix 데이터 JSON 파싱). 2016~2025년. |
| 농림축산식품부 공공데이터 활용 창업경진대회 | ✅ 자동 | data.mafra.go.kr의 수상작 JSON API를 파싱. 정주영 창업경진대회와는 별개 대회로 추가했습니다. |
| 정주영 창업경진대회 | 📝 수동 | 아산나눔재단이 선발팀 전체 명단을 구조화된 파일로 공개하지 않고 보도자료/블로그로만 소개. `data/manual/chungjuyung-startup.json`에 수동 정리 |

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
   Next.js로 자동 인식됨 → Deploy. (선택) AI 검색을 쓰려면 Vercel 프로젝트의 Environment
   Variables에 [OpenRouter](https://openrouter.ai) API 키를 `openrouter_key`라는 이름으로, 제품/특허
   검증까지 쓰려면 [eBay 개발자센터](https://developer.ebay.com) 키를 `EBAY_CLIENT_ID`/
   `EBAY_CLIENT_SECRET`으로, [KIPRIS](https://www.data.go.kr/data/15058788/openapi.do) 키를
   `KIPRIS_SERVICE_KEY`로 추가 (자세한 설명은 [`.env.example`](.env.example) 참고).
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
