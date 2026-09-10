import { getAllIdeas } from "../lib/dataset";
import { buildIndex, search, getDocs } from "../lib/similarity";

const ideas = getAllIdeas();
const index = buildIndex(
  ideas.map((item) => ({
    item,
    title: item.title,
    body: [item.summary, item.category].filter(Boolean).join(" "),
  })),
);
const docs = getDocs(index);

const query = process.argv[2] ?? "시각장애인 키오스크";
const results = search(index, query, docs, 10);

console.log(`query: "${query}"  (총 ${ideas.length}건 중)`);
for (const r of results) {
  console.log(
    `${(r.score * 100).toFixed(1)}%  [${r.item.competitionName}] ${r.item.title}` +
      (r.item.summary ? `  — ${r.item.summary.slice(0, 60)}` : ""),
  );
}
