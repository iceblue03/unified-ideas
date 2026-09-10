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
    "eswcontest.or.kr의 역대수상작 게시판(/data/award.php?page=N&code=award)을 페이지가 빌 때까지 순차적으로 HTML 파싱",
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
    "온라인창업체험교육 플랫폼 YEEP의 '우수 동아리 소개' 게시판(POST /cpthb/contestCaseList.do)을 페이지가 빌 때까지 순회하며 '대한민국 청소년 창업경진대회' 항목만 추출",
};

export const CODE_FAIR_META: CompetitionMeta = {
  slug: "code-fair",
  name: "코드페어 (SW공모전·해커톤)",
  homepage: "https://www.kcf.or.kr/84",
  tier: "semi-auto",
  method:
    "kcf.or.kr 공지사항 게시판(/84)을 페이지 끝까지 순회해 '수상작/수상팀/결과 발표' 키워드가 든 공지를 찾아 본문을 통째로 저장. " +
    "공식 사이트가 매 시즌 과거 아카이브를 지우기 때문에, 이 수집기가 실행될 때마다 발견한 공지를 우리 저장소에 축적해 자체 히스토리를 만든다. " +
    "(향후 개선 과제: 최종 수상작 발표 공지에 표/PDF가 붙는 경우 팀 단위로 더 잘게 파싱)",
};
