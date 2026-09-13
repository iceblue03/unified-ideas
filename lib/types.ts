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

// --- 검색 결과 카테고리 (대회 / 제품 / 특허) ---

export type ResultCategory = "competition" | "product" | "patent";

export const CATEGORY_LABEL: Record<ResultCategory, string> = {
  competition: "대회",
  product: "제품",
  patent: "특허",
};

export interface ShoppingProduct {
  /** eBay itemId */
  id: string;
  /** HTML 태그가 제거된 상품명 */
  title: string;
  link: string;
  image: string | null;
  lprice: number | null;
  hprice: number | null;
  /** 통화 코드, 예: "USD", "KRW". null이면 KRW로 취급(원화 표시) */
  currency: string | null;
  mallName: string | null;
  brand: string | null;
  maker: string | null;
  category: string | null;
}

/** lprice/hprice를 currency에 맞게 사람이 읽을 문자열로 변환 (KRW면 "12,000원", 그 외는 통화 기호) */
export function formatMoney(amount: number, currency: string | null): string {
  if (!currency || currency === "KRW") return `${amount.toLocaleString()}원`;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount.toLocaleString()} ${currency}`;
  }
}

export interface PatentItem {
  /** 출원번호를 id로 사용 */
  id: string;
  /** 발명의명칭 */
  title: string;
  /** 초록(astrtCont) — AI가 실제 기술 내용을 비교하는 데 쓰는 핵심 필드 */
  summary: string | null;
  applicationNumber: string | null;
  applicantName: string | null;
  /** yyyyMMdd 원문 */
  applicationDate: string | null;
  /** 공개/등록/거절/취하 등 (registerStatus) */
  registrationStatus: string | null;
  /** IPC 특허분류코드, "|"로 구분된 원문 그대로 */
  ipcNumber: string | null;
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
  /** EBAY_CLIENT_ID/SECRET 설정 여부 */
  shoppingAvailable: boolean;
  /** KIPRIS_SERVICE_KEY 설정 여부 */
  patentAvailable: boolean;
  kiprisQuery: string | null;
  shoppingQuery: string | null;
  report: AiReport | null;
  /** 실패한 단계별 한글 경고 (전체 검색 실패로 이어지지 않음) */
  warnings: string[];
}
