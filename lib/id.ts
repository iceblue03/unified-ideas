import { createHash } from "node:crypto";

export function makeId(parts: Array<string | number | null | undefined>): string {
  const key = parts.map((p) => (p ?? "").toString().trim().toLowerCase()).join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}
