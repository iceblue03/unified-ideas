import type { CompetitionMeta } from "./types";
import {
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  CODE_FAIR_META,
  CAPSTONE_DESIGN_META,
  KIPA_INVENTION_PATENT_META,
  MAFRA_PUBLIC_DATA_STARTUP_META,
  STUDENT_INVENTION_META,
  K_STARTUP_META,
} from "./collector-meta";

/**
 * 안정적으로 긁을 수 있는 공개 아카이브를 못 찾은 대회를 등록해두는 자리.
 * manual 항목도 검색 화면에는 노출되며, data/manual/<slug>.json에 사람이 직접
 * 채워 넣은 항목이 있으면 그대로 검색 대상에 포함된다. k-startup은 자동
 * 수집기(K_STARTUP_META)를 확보해 여기서 빠졌다 — 남은 건 정주영뿐이다.
 */
export const MANUAL_COMPETITIONS: CompetitionMeta[] = [
  {
    slug: "chungjuyung-startup",
    name: "정주영 창업경진대회",
    homepage: "https://startup.asan-nanum.org/",
    tier: "manual",
    method:
      "아산나눔재단은 선발팀 전체 명단을 표/파일로 공개하지 않고 보도자료(asan-nanum.org/press)와 " +
      "네이버 블로그에 기수별로 소개 글을 올리는 방식이라 구조화된 자동 수집원이 없다. " +
      "data/manual/chungjuyung-startup.json에 보도자료 기반으로 기수별 선발팀을 수동 정리해 축적한다. " +
      "농림축산식품부 공공데이터 활용 창업경진대회(MAFRA_PUBLIC_DATA_STARTUP_META)를 별개의 자동 수집 " +
      "대회로 추가해뒀지만, 정주영 자체는 대체하지 않고 계속 수동으로 유지한다.",
  },
];

export const AUTO_COMPETITIONS: CompetitionMeta[] = [
  CODE_FAIR_META,
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  CAPSTONE_DESIGN_META,
  KIPA_INVENTION_PATENT_META,
  MAFRA_PUBLIC_DATA_STARTUP_META,
  STUDENT_INVENTION_META,
  K_STARTUP_META,
];

export const ALL_COMPETITIONS: CompetitionMeta[] = [...AUTO_COMPETITIONS, ...MANUAL_COMPETITIONS];
