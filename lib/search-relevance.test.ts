import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExternalQueryPrompt, guardShoppingQueries } from "./ai-query-gen";
import { filterProductsByIdeaOverlap, planShoppingQueries } from "./ebay-shopping";
import { patentIsRelevant, planKiprisAttempts, selectPatentAttempt, type PatentAttemptOutcome } from "./kipris";
import type { PatentItem, ShoppingProduct } from "./types";

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
    assert.match(prompt, /때만/);
    assert.match(prompt, /레고분리도구/);
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
});
