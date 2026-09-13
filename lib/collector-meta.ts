import type { CompetitionMeta } from "./types";

/**
 * collector 모듈(scripts/collectors/*.ts)은 cheerio/playwright/exceljs 같은
 * 무거운(그리고 Vercel 서버리스 환경에 안 맞는) 패키지를 top-level import한다.
 * Next.js 앱(lib/competitions.ts, lib/dataset.ts)이 그 모듈을 직접 import하면
 * 배포 번들에 playwright까지 딸려 들어가므로, 메타데이터만 이 파일에 따로 둔다.
 * collector 쪽에서도 이 파일의 상수를 그대로 export해서 값이 두 곳에서 갈라지지
 * 않게 한다.
 */

export const ESW_CONTEST_META: CompetitionMeta = {
  slug: "esw-contest",
  name: "임베디드 소프트웨어 경진대회",
  homepage: "https://www.eswcontest.or.kr/data/award.php?code=award",
  tier: "auto",
  method:
    "eswcontest.or.kr의 역대수상작 게시판(/data/award.php?page=N&code=award)을 페이지가 빌 때까지 순차적으로 HTML 파싱. " +
    "각 항목의 상세페이지(ptype=view)까지 한 번 더 열어보는데, 실제 작품 설명(\"작품개요\"/\"특징\")은 " +
    "텍스트가 아니라 JPG 한 장으로만 게시되어 있어 텍스트 summary는 뽑을 수 없고, 대신 원본 이미지 " +
    "URL을 attachments로 보존한다(브라우저로 직접 확인, 2026년 기준 전 항목 동일 형식).",
};

export const PUBLIC_DATA_STARTUP_META: CompetitionMeta = {
  slug: "public-data-startup",
  name: "범정부 공공데이터 활용 창업경진대회",
  homepage: "https://data.seoul.go.kr/dataList/OA-22583/S/1/datasetView.do",
  tier: "auto",
  method:
    "서울 열린데이터광장(data.seoul.go.kr)이 매년 갱신해 올리는 공식 수상작 원본 파일(OA-22583, OA-22582)을 헤드리스 브라우저로 내려받아 xlsx 파싱",
};

export const YOUTH_STARTUP_META: CompetitionMeta = {
  slug: "youth-startup",
  name: "대한민국 청소년 창업경진대회",
  homepage: "https://yeep.go.kr/cpthb/contestCaseList.do",
  tier: "auto",
  method:
    "온라인창업체험교육 플랫폼 YEEP의 '우수 동아리 소개' 게시판(POST /cpthb/contestCaseList.do)을 페이지가 빌 때까지 순회하며 '대한민국 청소년 창업경진대회' 항목만 추출. " +
    "목록 카드의 '아이템 개요'는 한 줄 슬로건 수준이라, 카드마다 있는 상세페이지(POST /cpthb/contestCaseDetail.do)를 " +
    "한 번 더 열어 '동아리소개'/'아이디어 개요'/'창업전략' 카드뉴스 이미지의 alt 텍스트(OCR 없이도 평문으로 들어있음)를 summary에 합친다.",
};

export const CAPSTONE_DESIGN_META: CompetitionMeta = {
  slug: "capstone-design",
  name: "창의적종합설계경진대회",
  homepage: "https://e2festa.kr/",
  tier: "auto",
  method:
    "행사 사이트(e2festa.kr) 공지사항에서 그 해 '출품작 온라인 디렉토리북' PDF 공지를 찾아 첨부 PDF를 내려받는다. " +
    "이 PDF는 한글 본문이 CID 폰트라 pdf-parse 같은 텍스트 추출 라이브러리로는 한글이 통째로 누락된다(확인함) — " +
    "대신 Playwright(Chromium)로 pdf.js를 브라우저 안에서 직접 돌려 페이지를 <canvas>에 렌더링한 뒤(node-canvas " +
    "조합은 버전 호환성 문제로 렌더링이 깨져서 포기함, lib/pdf-render.ts 참고), 좌(본문)/우(학교·팀 정보) " +
    "컬럼을 나눠 각각 OCR(tesseract.js, lib/ocr.ts)한다 — 한 이미지를 통째로 OCR하면 두 컬럼 텍스트가 줄 " +
    "단위로 뒤섞여서 컬럼별로 잘라야 한다. 팀명/팀원은 '팀명'/'팀원' 라벨을 앵커로, 제목은 원문에 함께 실린 " +
    "영문 부제(OCR 정확도가 더 높음)를 우선 사용한다. 이 도록은 '수상작'이 아니라 그 해 전체 참가팀(출품작) " +
    "목록이라 award는 비워둔다. 사진/그래픽이 겹치는 영역은 OCR 노이즈가 섞일 수 있음. (origin 브랜치는 이 " +
    "대회를 robots.txt 크롤링 제한을 이유로 '대한민국발명특허대전'으로 대체했었는데, 여기서는 위 OCR 경로로 " +
    "원래 대회를 직접 자동화하면서 KIPA_INVENTION_PATENT_META도 별도 대회로 함께 유지한다.)",
};

export const CODE_FAIR_META: CompetitionMeta = {
  slug: "code-fair",
  name: "코드페어 (SW공모전·해커톤)",
  homepage: "https://www.kcf.or.kr/84",
  tier: "semi-auto",
  method:
    "kcf.or.kr 공지사항 게시판(/84)을 페이지 끝까지 순회해 '수상작/수상팀/결과 발표' 키워드가 든 공지를 찾아 본문 전체(.board_txt_area)를 저장. " +
    "공식 사이트가 매 시즌 과거 아카이브를 지우기 때문에, 이 수집기가 실행될 때마다 발견한 공지를 우리 저장소에 축적해 자체 히스토리를 만든다. " +
    "추가로 예전에 존재했다가 라이브 사이트에서 지워진 '역대 수상작(히스토리)' 게시판(kcf.or.kr/history)을 " +
    "Wayback Machine(web.archive.org) CDX API로 찾아 2021~2024년 부문별 수상 게시글을 한 번 더 백필한다 " +
    "(게시글 본문이 이미지 캡처라 팀명까지는 못 긁고 연도/회차/부문 단위 항목만 확보 가능). " +
    "이 게시판은 결과를 표/이미지(JPG)나 첨부파일로만 올리는 경우가 흔한데(2026년 시즌 '1차 서면심사 결과' 공지에서 확인), " +
    "그런 이미지에는 보통 '팀명'만 있고 '작품명' 컬럼이 없다 — 그래서 이미지·첨부파일은 attachments로만 보존하고, " +
    "그 안의 텍스트를 title/team으로 추측해 넣지 않는다(팀명을 작품명으로 오인하는 사고 방지). " +
    "(향후 개선 과제: 최종 수상작 발표 공지에 '작품명' 컬럼이 있는 표/PDF가 붙으면 팀 단위로 더 잘게 파싱)",
};

export const KIPA_INVENTION_PATENT_META: CompetitionMeta = {
  slug: "kipa-invention-patent",
  name: "대한민국발명특허대전",
  homepage: "https://www.kipa.org/kinpex/",
  tier: "auto",
  method:
    "한국발명진흥회(KIPA)가 공개하는 연도별 수상현황 정적 페이지(kipa.org/kinpex/prize_history_{연도}.jsp, " +
    "2006~2025년 각각 존재)를 순회하며 표(table.prize_table)를 HTML 파싱. 창의적종합설계경진대회와는 별개의 " +
    "대회로, 두 대회를 모두 자동 수집 대상에 포함한다.",
};

export const MAFRA_PUBLIC_DATA_STARTUP_META: CompetitionMeta = {
  slug: "mafra-public-data-startup",
  name: "농림축산식품부 공공데이터 활용 창업경진대회",
  homepage: "https://data.mafra.go.kr/contest/winnerListNew.do",
  tier: "auto",
  method:
    "농림축산식품부 공공데이터포털의 역대 수상작 게시판(data.mafra.go.kr/contest/winnerListNew.do)을 " +
    "페이지네이션 순회하며 HTML 파싱. 정주영 창업경진대회는 아산나눔재단이 선발팀 명단을 구조화된 형태로 " +
    "전혀 공개하지 않아(현재 사이트는 모집 안내 페이지뿐) 여전히 수동 정리 대상이며, 이 대회는 그와 별개로 " +
    "구조화된 공개 아카이브가 있어 추가로 자동 수집 대상에 포함한다.",
};

export const STUDENT_INVENTION_META: CompetitionMeta = {
  slug: "student-invention",
  name: "대한민국학생발명전시회",
  homepage: "https://www.ip-edu.net/home/kor/award/festival2024/exhibition/index.do",
  tier: "auto",
  method:
    "발명교육포털(ip-edu.net)의 연도별(2021~) 전시관을 수집. 대통령상은 index.do가 서버 렌더링하고, " +
    "우수상격/동상 및 장려상/전국교원발명경진대회 수상작은 내부 AJAX 엔드포인트(POST .../exhibition/inc/list.ajax, " +
    "menuPos/tabPos/tabPos2/searchValue1(연도)/pageIndex 폼 필드)를 페이지가 빌 때까지 순회해 확보하고, " +
    "각 항목의 상세(학교/수상자/발명동기 등)는 edit.do?idx=N GET으로 보강한다. (이전에는 그 해 PDF 수상작품집을 " +
    "OCR로 읽는 방식을 썼으나, 최신 연도 1개년치만 커버하고 OCR 오차도 있어 이 구조화된 방식으로 교체했다 — " +
    "2021년부터 전 연도, 1,180건.)",
};

export const K_STARTUP_META: CompetitionMeta = {
  slug: "k-startup",
  name: "도전! K-스타트업",
  homepage: "https://www.challengek.org",
  tier: "auto",
  method:
    "k-startup.go.kr 자체는 구조화된 역대 수상팀 아카이브가 없어, 같은 운영기관(창업진흥원)이 만든 " +
    "'역대수상기업' 페이지(challengek.org/{연도별 slug})를 대신 수집한다. 각 페이지는 Wix 사이트지만 " +
    "<script id=\"wix-warmup-data\">에 수상 데이터 전체가 순수 JSON으로 내장되어 있어 헤드리스 브라우저 없이 " +
    "정적 HTML만 받아 파싱 가능. 2016~2022, 2024~2025년 자료가 있으며 2023년은 원본 사이트에도 별도 아카이브가 " +
    "없다(2022 페이지로 리다이렉트됨).",
};
