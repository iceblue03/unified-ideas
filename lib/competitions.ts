import type { CompetitionMeta } from "./types";
import {
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  CODE_FAIR_META,
} from "./collector-meta";

/**
 * 자동/반자동 수집기가 있는 대회는 각 collector 모듈의 meta를 그대로 쓰고,
 * 아직 안정적으로 긁을 공개 아카이브를 못 찾은 대회는 여기에 "manual"로
 * 등록해둔다. manual 항목도 검색 화면에는 노출되며, data/manual/<slug>.json에
 * 사람이 직접 채워 넣은 항목이 있으면 그대로 검색 대상에 포함된다.
 */
export const MANUAL_COMPETITIONS: CompetitionMeta[] = [
  {
    slug: "student-invention",
    name: "대한민국학생발명전시회",
    homepage: "https://www.ip-edu.net/home/kor/award/festival2024/exhibition/index.do",
    tier: "manual",
    method:
      "발명교육포털(ip-edu.net)의 수상작 e-전시관에서 대통령상 전시관은 서버 렌더링되지만, " +
      "우수상격/동상·장려상 전시관 목록은 AJAX가 아니라 폼 POST(hidden input tabPos2 + #cmmnForm)로 " +
      "탭을 전환하는 구조라 매 해 페이지에 존재 여부가 다르다(2024년판에는 해당 탭 자체가 없음, 브라우저로 확인). " +
      "대신 '발명교육콘텐츠 > 수상작품집'(/home/kor/education/material/work/index.do)에 회차별 전체 수상작 " +
      "PDF 도록이 공개되어 있고(예: 제39회(2026년) 파일은 POST https://www.ip-edu.net/fileDownload.do " +
      "body={filename, downname} 로 받을 수 있음, 32MB), 여기엔 대통령상 이하 전체 등급이 실려 있을 가능성이 높다. " +
      "다만 이 PDF가 텍스트 선택 가능한 포맷인지, 스캔 이미지인지 확인 및 파서 구현이 아직 안 되어 있어 " +
      "현재는 대통령상 수상작만 자동 추출 가능한 상태 — data/manual/student-invention.json에 수동으로 추가·보완이 필요하다.",
  },
  {
    slug: "k-startup",
    name: "도전! K-스타트업",
    homepage: "https://www.k-startup.go.kr",
    tier: "manual",
    method:
      "k-startup.go.kr / challengek.org에는 연도별 '왕중왕전' 최종 수상팀을 모아둔 공개 게시판·API가 없고, " +
      "결과는 창업진흥원 보도자료·뉴스 기사로만 흩어져 공개된다. " +
      "data/manual/k-startup.json에 보도자료 기반으로 연도별 수상팀명/아이템을 수동 정리해 축적한다.",
  },
  {
    slug: "capstone-design",
    name: "창의적종합설계경진대회",
    homepage: "http://e2festa.kr/",
    tier: "manual",
    method:
      "공학교육혁신연구정보센터(ricee.or.kr)의 수상작 게시판은 회원가입 후에만 열람 가능해 무인증 자동 수집이 불가능하다. " +
      "대신 매년 행사(e2festa.kr) 공지사항에 그 해 출품작 전체를 담은 '온라인 디렉토리북' PDF가 공개된다 " +
      "(예: 2025년판 http://www.e2festa.kr/doc/directorybook_2025.pdf, 155개 팀, 26MB, 로그인 불필요). " +
      "다운로드해 pdf-parse로 텍스트를 뽑아보면 영문 프로젝트 제목·해시태그는 정상 추출되지만, 한글 본문은 " +
      "CID 폰트 인코딩 문제로 텍스트가 통째로 누락된다(확인함) — 팀명/학교/한글 요약까지 얻으려면 페이지를 " +
      "이미지로 렌더링해 OCR(또는 비전 모델)을 거치는 별도 파서가 필요해 아직 자동화하지 않았다. " +
      "그 전까지는 개별 대학 공학교육혁신센터 공지사항에 단편적으로 올라오는 수상 내역을 참고해 " +
      "data/manual/capstone-design.json에 확인되는 대로 수동 보강한다.",
  },
  {
    slug: "chungjuyung-startup",
    name: "정주영 창업경진대회",
    homepage: "https://startup.asan-nanum.org/",
    tier: "manual",
    method:
      "아산나눔재단은 선발팀 전체 명단을 표/파일로 공개하지 않고 보도자료(asan-nanum.org/press)와 " +
      "네이버 블로그에 기수별로 소개 글을 올리는 방식이라 구조화된 자동 수집원이 없다. " +
      "data/manual/chungjuyung-startup.json에 보도자료 기반으로 기수별 선발팀을 수동 정리해 축적한다.",
  },
];

export const AUTO_COMPETITIONS: CompetitionMeta[] = [
  CODE_FAIR_META,
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
];

export const ALL_COMPETITIONS: CompetitionMeta[] = [...AUTO_COMPETITIONS, ...MANUAL_COMPETITIONS];
