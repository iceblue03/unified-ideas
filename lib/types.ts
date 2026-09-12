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

// --- 검색 결과 카테고리 (대회 / 제품 / 특허) ---

export type ResultCategory = "competition" | "product" | "patent";

export const CATEGORY_LABEL: Record<ResultCategory, string> = {
  competition: "대회",
  product: "제품",
  patent: "특허",
};

export interface ShoppingProduct {
  /** 네이버쇼핑 productId */
  id: string;
  /** HTML 태그(<b> 등)가 제거된 상품명 */
  title: string;
  link: string;
  image: string | null;
  lprice: number | null;
  hprice: number | null;
  mallName: string | null;
  brand: string | null;
  maker: string | null;
  /** category1..4를 " > "로 이어붙인 값 */
  category: string | null;
}

export interface PatentItem {
  /** 출원번호를 id로 사용 */
  id: string;
  /** 발명의명칭 */
  title: string;
  applicationNumber: string | null;
  applicantName: string | null;
  /** yyyyMMdd 원문 */
  applicationDate: string | null;
  publicationNumber: string | null;
  registrationStatus: string | null;
  sourceUrl: string | null;
}

interface BaseResultFields {
  /** 출처별 원점수: 대회=TF-IDF 점수, 제품/특허=순번 기반 pseudo-score */
  score: number;
  /** AI 랭킹 호출이 성공했을 때만 채워지는 0~1 관련도 점수 */
  aiScore?: number;
  /** 해당 항목에 대한 AI의 한 줄 근거 */
  aiReason?: string;
}

export interface CompetitionResultItem extends BaseResultFields {
  type: "competition";
  idea: Idea;
}

export interface ProductResultItem extends BaseResultFields {
  type: "product";
  product: ShoppingProduct;
}

export interface PatentResultItem extends BaseResultFields {
  type: "patent";
  patent: PatentItem;
}

export type UnifiedResultItem = CompetitionResultItem | ProductResultItem | PatentResultItem;

// --- AI 진단 리포트 ---

/** exists=이미 비슷한 사례 있음, partial=일부 겹침, blue_ocean=뚜렷한 유사 사례 없음 */
export type Verdict = "exists" | "partial" | "blue_ocean";

export interface AiTopMatchCard {
  type: ResultCategory;
  title: string;
  /** 예: "임베디드 SW 경진대회 · 2023 · 대상" / "쿠팡 · 29,000원" */
  meta: string;
  /** 왜 유사/관련 있는지 한 줄 */
  reason: string;
  /** 0~1, 카드에 %로 표시 */
  similarity: number;
  sourceUrl: string | null;
}

export interface AiReport {
  verdict: Verdict;
  /** 진단 근거 서술 (1~3문장) */
  summary: string;
  /** 핵심 키워드 3~5개 */
  tags: string[];
  /** 대회/제품/특허 구분 없이 관련도 상위 최대 3개 */
  topMatches: AiTopMatchCard[];
  /** 구조화 파싱이 완전히 실패했을 때만 채워지는 폴백 */
  rawText?: string;
}

export interface AiMeta {
  used: boolean;
  /** NAVER_CLIENT_ID/SECRET 설정 여부 */
  shoppingAvailable: boolean;
  /** KIPRIS_SERVICE_KEY 설정 여부 */
  patentAvailable: boolean;
  kiprisQuery: string | null;
  shoppingQuery: string | null;
  report: AiReport | null;
  /** 실패한 단계별 한글 경고 (전체 검색 실패로 이어지지 않음) */
  warnings: string[];
}
