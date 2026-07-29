/** 템플릿 + 데이터 → work/mock-dashboard.html, docs/index.html */
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tpl = readFileSync(join(ROOT, "work/dashboard.template.html"), "utf8");
const out = tpl
  .replace("/*__BOARD__*/null", readFileSync(join(ROOT, "docs/data/board.json"), "utf8"))
  .replace("/*__POLICIES__*/null", readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"));

if (out.includes("__BOARD__") || out.includes("__POLICIES__")) { console.error("데이터 주입 실패"); process.exit(1); }
for (const p of ["work/mock-dashboard.html", "docs/index.html"]) writeFileSync(join(ROOT, p), out, "utf8");
console.log(`빌드 완료 ${(statSync(join(ROOT, "docs/index.html")).size / 1024 / 1024).toFixed(2)}MB`);
