import type { CompetitionMeta } from "./types";
import {
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  CODE_FAIR_META,
  CAPSTONE_DESIGN_META,
  STUDENT_INVENTION_META,
} from "./collector-meta";

/**
 * 자동/반자동 수집기가 있는 대회는 각 collector 모듈의 meta를 그대로 쓰고,
 * 아직 안정적으로 긁을 공개 아카이브를 못 찾은 대회는 여기에 "manual"로
 * 등록해둔다. manual 항목도 검색 화면에는 노출되며, data/manual/<slug>.json에
 * 사람이 직접 채워 넣은 항목이 있으면 그대로 검색 대상에 포함된다.
 */
export const MANUAL_COMPETITIONS: CompetitionMeta[] = [
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
  CAPSTONE_DESIGN_META,
  STUDENT_INVENTION_META,
];

export const ALL_COMPETITIONS: CompetitionMeta[] = [...AUTO_COMPETITIONS, ...MANUAL_COMPETITIONS];
