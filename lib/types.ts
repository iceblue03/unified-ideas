export interface Attachment {
  url: string;
  kind: "image" | "file";
  /** 사람이 읽을 수 있는 설명, e.g. "작품 설명 이미지" */
  label: string | null;
}

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
  /**
   * summary만으로 담기 어려운 원본 자료(포스터 이미지, 첨부파일 등).
   * 일부 대회는 작품 설명이 텍스트가 아니라 이미지로만 게시되어(예: esw-contest
   * 상세페이지, code-fair 결과 공지) summary를 뽑아낼 수 없는데, 이런 경우에도
   * 원본 링크는 여기 보존해 사람이나 (선택적으로) AI가 나중에 읽을 수 있게 한다.
   */
  attachments?: Attachment[];
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
