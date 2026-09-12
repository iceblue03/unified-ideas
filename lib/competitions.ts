import type { CompetitionMeta } from "./types";
import {
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  CODE_FAIR_META,
  KIPA_INVENTION_PATENT_META,
  MAFRA_PUBLIC_DATA_STARTUP_META,
  STUDENT_INVENTION_META,
  K_STARTUP_META,
} from "./collector-meta";

/**
 * 안정적으로 긁을 수 있는 공개 아카이브를 못 찾은 대회를 등록해두는 자리.
 * manual 항목도 검색 화면에는 노출되며, data/manual/<slug>.json에 사람이 직접
 * 채워 넣은 항목이 있으면 그대로 검색 대상에 포함된다. 현재는 9개 대상 대회 모두
 * 자동/반자동 수집기를 확보해 비어 있다 — 새로 추가하는 대회 중 자동 수집원을
 * 못 찾은 게 있으면 여기에 등록한다.
 */
export const MANUAL_COMPETITIONS: CompetitionMeta[] = [];

export const AUTO_COMPETITIONS: CompetitionMeta[] = [
  CODE_FAIR_META,
  ESW_CONTEST_META,
  PUBLIC_DATA_STARTUP_META,
  YOUTH_STARTUP_META,
  KIPA_INVENTION_PATENT_META,
  MAFRA_PUBLIC_DATA_STARTUP_META,
  STUDENT_INVENTION_META,
  K_STARTUP_META,
];

export const ALL_COMPETITIONS: CompetitionMeta[] = [...AUTO_COMPETITIONS, ...MANUAL_COMPETITIONS];
