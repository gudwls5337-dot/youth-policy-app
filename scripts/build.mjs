/** 템플릿 + 데이터 → work/mock-dashboard.html, docs/index.html */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tpl = readFileSync(join(ROOT, "work/dashboard.template.html"), "utf8");
const out = tpl
  .replace("/*__BOARD__*/null", readFileSync(join(ROOT, "docs/data/board.json"), "utf8"))
  .replace("/*__POLICIES__*/null", readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"))
  .replace("/*__COMPARE__*/null", readFileSync(join(ROOT, "docs/data/compare.json"), "utf8"))
  .replace("/*__GOVCOMPARE__*/null", readFileSync(join(ROOT, "docs/data/gov-compare.json"), "utf8"))
  /* 양산 전용 축 — 시 공식 채널(청년가까e)이라 「현황」을 주장할 수 있는 유일한 소스 */
  .replace("/*__YANGSAN__*/null", readFileSync(join(ROOT, "docs/data/yangsan.json"), "utf8"));

for (const t of ["__BOARD__", "__POLICIES__", "__COMPARE__", "__GOVCOMPARE__", "__YANGSAN__"])
  if (out.includes(t)) { console.error(`데이터 주입 실패 — ${t}`); process.exit(1); }
for (const p of ["work/mock-dashboard.html", "docs/index.html"]) writeFileSync(join(ROOT, p), out, "utf8");
console.log(`빌드 완료 ${(statSync(join(ROOT, "docs/index.html")).size / 1024 / 1024).toFixed(2)}MB`);
