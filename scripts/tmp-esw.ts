import * as esw from "./collectors/esw-contest";

async function main() {
  const items = await esw.collect();
  console.log("count", items.length);
  console.log(items.slice(0, 3).map((i) => `${i.year} ${i.award} ${i.title}`));
}

main();
