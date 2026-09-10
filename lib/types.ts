export interface Idea {
  /** stable id: sha1(competition|year|title|team) */
  id: string;
  /** competition slug, e.g. "esw-contest" */
  competition: string;
  /** human-readable competition name in Korean */
  competitionName: string;
  year: number | null;
  /** 회차 표기, e.g. "22회" */
  round: string | null;
  /** 수상 등급, e.g. "대상", "금상" */
  award: string | null;
  /** 부문/분야, e.g. "자동차/모빌리티" */
  category: string | null;
  title: string;
  /** 팀명/개인명 */
  team: string | null;
  /** 소속 학교/기관 */
  org: string | null;
  summary: string | null;
  sourceUrl: string | null;
}

export interface CompetitionMeta {
  slug: string;
  name: string;
  homepage: string;
  /** how automated the monthly collection is for this source */
  tier: "auto" | "semi-auto" | "manual";
  method: string;
}

export interface Collector {
  meta: CompetitionMeta;
  collect(): Promise<Idea[]>;
}
