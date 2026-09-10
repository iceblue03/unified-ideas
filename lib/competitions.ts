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
      "우수상격/동상·장려상 전시관 목록은 페이지 내부 AJAX 호출로 채워지며 해당 API를 아직 특정하지 못했다. " +
      "현재는 연도별 페이지를 열람해 대통령상 수상작만 신뢰성 있게 자동 추출 가능한 상태 — " +
      "data/manual/student-invention.json에 수동으로 추가·보완이 필요하다.",
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
      "대회를 주최하는 개별 대학 공학교육혁신센터 공지사항에 단편적으로 수상 내역이 올라오는 정도라 " +
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
