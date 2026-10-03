import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExternalQueryPrompt, guardShoppingQueries } from "./ai-query-gen";
import { itemSupportsIdea } from "./ai-rank";
import { getAllIdeas } from "./dataset";
import { filterProductsByIdeaOverlap, planShoppingQueries } from "./ebay-shopping";
import { patentIsRelevant, planKiprisAttempts, selectPatentAttempt, type PatentAttemptOutcome } from "./kipris";
import { groundKiprisTerms } from "./relevance";
import { buildIndex, getDocs, search } from "./similarity";
import type { Idea, PatentItem, ShoppingProduct, UnifiedResultItem } from "./types";

const LEGO_IDEA = "레고를 분리해주는 채";

function product(title: string): ShoppingProduct {
  return {
    id: title,
    title,
    link: "https://example.test",
    image: null,
    lprice: null,
    hprice: null,
    currency: "USD",
    mallName: "eBay",
    brand: null,
    maker: null,
    category: null,
  };
}

function patent(title: string, summary: string | null = null): PatentItem {
  return {
    id: title,
    title,
    summary,
    applicationNumber: null,
    applicantName: null,
    applicationDate: null,
    registrationStatus: null,
    ipcNumber: null,
    sourceUrl: null,
  };
}

function outcome(partial: Pick<PatentAttemptOutcome, "index" | "keywords" | "relevant"> & { ok?: boolean }): PatentAttemptOutcome {
  return {
    index: partial.index,
    keywords: partial.keywords,
    readableQuery: partial.keywords.join("*"),
    ok: partial.ok ?? true,
    relevant: partial.relevant,
  };
}

describe("shopping query guard", () => {
  it("strips cane queries when the idea is not a cane", () => {
    const guarded = guardShoppingQueries(LEGO_IDEA, [
      "smart cane for visually impaired",
      "electronic white cane",
      "blind walking stick",
    ]);
    assert.ok(guarded.length > 0);
    for (const query of guarded) {
      assert.doesNotMatch(query, /cane|blind|visually impaired/i);
    }
  });

  it("keeps a non-cane query and drops only the cane ones", () => {
    assert.deepEqual(guardShoppingQueries(LEGO_IDEA, ["lego brick separator", "white cane"]), ["lego brick separator"]);
  });

  it("keeps cane queries when the idea itself is a white cane", () => {
    const queries = ["smart cane for visually impaired", "electronic white cane"];
    assert.deepEqual(guardShoppingQueries("시각장애인을 위한 흰지팡이", queries), queries);
  });

  it("does not force cane into every idea in the prompt", () => {
    const prompt = buildExternalQueryPrompt(LEGO_IDEA);
    assert.equal(prompt.includes("첫 검색어에는 반드시 cane"), false);
    assert.equal(prompt.includes("smart cane for visually impaired"), false);
    assert.match(prompt, /때만/);
    assert.match(prompt, /레고분리도구/);
  });

  it("drops blindness and mobility-guide queries for a festival idea", () => {
    const idea = "축제 대기줄을 예약하는 서비스";
    const guarded = guardShoppingQueries(idea, ["electronic mobility guide", "blindness guide device"]);
    for (const query of guarded) {
      assert.doesNotMatch(query, /cane|blind|mobility guide|guide device/i);
    }
  });
});

describe("kipris term grounding", () => {
  it("replaces an English compound the idea never used", () => {
    const idea = "반려동물 사료를 시간에 맞춰 자동으로 주는 급식기";
    const grounded = groundKiprisTerms(idea, ["petfeeder"], ["automaticpetfeeder"]);
    assert.equal(grounded.kiprisKeywords.includes("petfeeder"), false);
    assert.equal(grounded.kiprisAltKeywords.includes("automaticpetfeeder"), false);
    assert.ok(grounded.kiprisKeywords.some((keyword) => keyword === "급식기" || keyword === "사료"));
  });

  it("drops a guide keyword that was copied onto a queue idea", () => {
    const grounded = groundKiprisTerms("축제 대기줄을 예약하는 서비스", ["guide"], ["mobilityaid"]);
    assert.equal(grounded.kiprisKeywords.includes("guide"), false);
    assert.equal(grounded.kiprisAltKeywords.length, 0);
    assert.ok(grounded.kiprisKeywords.includes("대기줄"));
  });
});

describe("planKiprisAttempts", () => {
  it("plans an idea word when the model invented a compound", () => {
    const words = planKiprisAttempts(["레고분리도구"], [], LEGO_IDEA).map((attempt) => attempt[0]);
    assert.ok(words.includes("레고"));
    assert.notEqual(words[0], "레고분리도구");
  });

  it("puts a specific word ahead of a broad word", () => {
    const words = planKiprisAttempts(["공공데이터", "귀가"], [], "공공데이터를 활용한 안전 귀가 경로").map((attempt) => attempt[0]);
    assert.equal(words[0], "귀가");
    assert.ok(words.includes("공공데이터"));
  });
});

describe("patent relevance", () => {
  it("accepts a long compound when its idea pieces are in the title", () => {
    const hit = patent("레고 블록 분리 기구");
    assert.equal(patentIsRelevant(hit, ["레고분리도구"], LEGO_IDEA), true);
  });

  it("rejects a hit that only matches a broad word", () => {
    const hit = patent("공공데이터 기반 행정 서비스");
    assert.equal(patentIsRelevant(hit, ["레고분리도구"], LEGO_IDEA), false);
  });

  it("rejects a drug name that only shares the syllable 레고", () => {
    assert.equal(patentIsRelevant(patent("레고라페닙을 함유하는 코팅된 제약 조성물"), ["레고"], LEGO_IDEA), false);
    assert.equal(patentIsRelevant(patent("오리나무속 식물 유래 오레고닌"), ["레고"], LEGO_IDEA), false);
  });

  it("rejects a lego-shaped object that is not a separator", () => {
    assert.equal(
      patentIsRelevant(patent("방수 및 방진기능을 구비하는 레고형 캠핑용 하우징 모듈의 결합구조"), ["레고"], LEGO_IDEA),
      false,
    );
  });

  it("prefers a specific non-empty attempt over a broad one", () => {
    const selected = selectPatentAttempt([
      outcome({ index: 0, keywords: ["공공데이터"], relevant: [patent("공공데이터 포털")] }),
      outcome({ index: 1, keywords: ["레고"], relevant: [patent("레고 블록")] }),
    ]);
    assert.equal(selected.chosen?.readableQuery, "레고");
  });

  it("does not keep broad hits when a specific attempt returned empty", () => {
    const selected = selectPatentAttempt([
      outcome({ index: 0, keywords: ["공공데이터"], relevant: [patent("공공데이터 포털")] }),
      outcome({ index: 1, keywords: ["레고"], relevant: [] }),
    ]);
    assert.equal(selected.chosen, null);
    assert.equal(selected.error, null);
  });
});

describe("shopping planner", () => {
  it("dedupes and caps queries deterministically", () => {
    assert.deepEqual(planShoppingQueries(["Foo Bar", "foo bar", "Baz Qux", "Third Item", "Fourth Item"]), [
      "Foo Bar",
      "Baz Qux",
      "Third Item",
    ]);
  });

  it("drops cane listings that do not overlap the idea and keeps a real product", () => {
    const kept = filterProductsByIdeaOverlap(
      [product("White cane for the blind"), product("LEGO brick separator tool")],
      LEGO_IDEA,
      ["smart cane for visually impaired", "lego brick separator"],
    );
    assert.deepEqual(kept.map((item) => item.title), ["LEGO brick separator tool"]);
  });

  it("keeps an English title that overlaps an English idea", () => {
    const kept = filterProductsByIdeaOverlap(
      [product("Safety route navigator")],
      "safety walking route",
      ["safety route device"],
    );
    assert.equal(kept.length, 1);
  });

  it("drops a blindness guide device that the festival query should not have fetched", () => {
    const kept = filterProductsByIdeaOverlap(
      [product("Blind Dog Bumper Halo Harness Guide Device Anti-Collision Ring")],
      "축제 대기줄을 예약하는 서비스",
      ["electronic mobility guide", "blindness guide device"],
    );
    assert.deepEqual(kept, []);
  });
});

function competitionItem(title: string, summary: string | null = null): UnifiedResultItem {
  const idea: Idea = {
    id: title,
    competition: "t",
    competitionName: "대회",
    year: null,
    round: null,
    award: null,
    category: null,
    title,
    team: null,
    org: null,
    summary,
    sourceUrl: null,
  };
  return { type: "competition", score: 0.5, idea };
}

describe("displayed competition relevance", () => {
  const ideas = getAllIdeas();
  const index = buildIndex(
    ideas.map((item) => ({
      item,
      title: item.title,
      body: [item.summary, item.category].filter(Boolean).join(" "),
    })),
  );
  const docs = getDocs(index);

  function titles(query: string): string[] {
    return search(index, query, docs, 10).map((match) => match.item.title);
  }

  it("keeps the safe-walk navigation and drops unrelated public-data hits", () => {
    const found = titles("공공데이터를 활용한 안전 귀가 경로 추천 서비스");
    assert.ok(found.some((title) => title.includes("안전 귀가")));
    assert.equal(found.some((title) => title.includes("중소 제조")), false);
  });

  it("does not fill a lego separator with other kinds of separation", () => {
    const found = titles(LEGO_IDEA);
    assert.equal(found.some((title) => title.includes("입자 분리")), false);
    assert.equal(found.some((title) => title.includes("파일 연결")), false);
  });

  it("keeps a braille cane and drops other visual-impairment projects", () => {
    const found = titles("시각장애인을 위한 AI 점자 안내 지팡이");
    assert.ok(found.some((title) => title.includes("점자지팡이") || title.includes("점자 지팡이") || title.includes("지팡이")));
    assert.equal(found.some((title) => title.includes("임신")), false);
  });

  it("does not treat a used-car platform as a textbook exchange", () => {
    const found = titles("중고 교재를 학생끼리 교환하는 플랫폼");
    assert.equal(found.some((title) => title.includes("중고차")), false);
  });

  it("keeps the indoor air-quality winner", () => {
    const found = titles("실내 공기질을 측정하고 환기를 권하는 센서");
    assert.ok(found.some((title) => title.includes("실내공기질") || title.includes("실내 공기질")));
    assert.equal(found.some((title) => title.includes("Mood Lamp")), false);
  });

  it("does not show a bus tour as a handwriting font", () => {
    const found = titles("손글씨를 입력하면 폰트로 바꿔 주는 서비스");
    assert.equal(found.some((title) => title.includes("버스 타고 욜로")), false);
    assert.equal(found.some((title) => title.includes("입력하면")), false);
  });

  it("keeps a food-waste grinder and drops an unrelated broom", () => {
    const found = titles("음식물 쓰레기를 건조하고 분쇄하는 장치");
    assert.ok(found.some((title) => title.includes("음식물") && title.includes("분쇄")));
    assert.equal(found.some((title) => title.includes("체육관")), false);
  });

  it("keeps fall detection and drops a generic wearable", () => {
    const found = titles("노인의 낙상을 감지하는 웨어러블");
    assert.ok(found.some((title) => title.includes("낙상") && title.includes("감지")));
    assert.equal(found.some((title) => title.includes("바른 걸음걸이")), false);
  });

  it("does not show a tourism app or a soccer booking app as a queue reservation", () => {
    const found = titles("축제 대기줄을 예약하는 서비스");
    assert.equal(found.some((title) => title.includes("오슈")), false);
    assert.equal(found.some((title) => title.includes("바로매치")), false);
  });
});

describe("report evidence", () => {
  it("does not treat a bus tour as support for a handwriting font", () => {
    const idea = "손글씨를 입력하면 폰트로 바꿔 주는 서비스";
    assert.equal(itemSupportsIdea(idea, competitionItem("“버스 타고 욜로!” 시내버스 여행코스")), false);
  });

  it("does not treat a camping module as support for a lego separator", () => {
    assert.equal(
      itemSupportsIdea(LEGO_IDEA, competitionItem("방수 및 방진기능을 구비하는 레고형 캠핑용 하우징 모듈의 결합구조")),
      false,
    );
  });
});
