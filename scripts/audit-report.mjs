/**
 * 검증 에이전트 결과 집계
 *
 *   node scripts/audit-report.mjs
 *
 * 에이전트가 `work/audit/<슬라이스>.result.json` 에 남긴 판정을 모아
 * 오류율을 내고, 임계치를 넘으면 exit 1 로 파이프라인을 세운다.
 *
 * 임계치 근거
 *  - 연령은 이 데이터의 핵심 주장이다. 표본에서 단 1건이라도 불일치면 전수 재검이다.
 *  - 미분류는 원래 판정 불가가 정상이므로 실패로 보지 않는다. 다만 `특정가능`이
 *    많이 나오면 귀속 규칙을 고쳐야 하므로 경고한다.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "work/audit");

/** 슬라이스별: [치명적 판정값, 허용 건수, 설명] */
const RULES = {
  A_연령미상: [["누락"], 0, "미상으로 둔 곳에 실제로는 연령이 적혀 있음"],
  B_신뢰도보통: [["기본조례_아님"], 2, "기본 조례가 아닌 것을 대표 조례로 잡음"],
  C_연령정확도: [["불일치", "인용문_오류"], 0, "연령 또는 인용문이 원문과 다름"],
  D_미분류정책: [[], 0, "미분류는 판정 불가가 정상 — 실패로 보지 않음"],
};

let hardFail = 0;
const lines = [];

if (!existsSync(DIR)) { console.error("work/audit 없음. audit-prepare 를 먼저 실행하세요."); process.exit(1); }

for (const f of readdirSync(DIR).filter(f => f.endsWith(".result.json")).sort()) {
  const slice = f.replace(".result.json", "");
  let R;
  try { R = JSON.parse(readFileSync(join(DIR, f), "utf8")); }
  catch (e) { lines.push(`  ${slice}: 결과 파싱 실패 — ${e.message}`); hardFail++; continue; }

  const results = R.results || [];
  const tally = results.reduce((a, r) => (a[r.판정] = (a[r.판정] || 0) + 1, a), {});
  const [bad, allow, why] = RULES[slice] || [[], 0, ""];
  const hits = results.filter(r => bad.includes(r.판정));

  lines.push(`  ${slice.padEnd(14)} ${String(results.length).padStart(3)}건  ${JSON.stringify(tally)}`);
  if (hits.length > allow) {
    hardFail++;
    lines.push(`     실패 — ${why} (${hits.length}건, 허용 ${allow})`);
    hits.slice(0, 6).forEach(h => lines.push(
      `       · ${h.지자체 || h.정책명}: ${h.판정}${h.원문값 ? ` (우리 ${h.우리값} / 원문 ${h.원문값})` : ""}${h.비고 ? " — " + h.비고 : ""}`));
  }
  if (slice === "D_미분류정책") {
    const fixable = results.filter(r => r.판정 === "특정가능");
    if (fixable.length) lines.push(`     경고 — 규칙 개선 여지 ${fixable.length}건: ${fixable.slice(0, 4).map(r => r.추정지역).join(", ")}`);
  }
  if (R.요약) lines.push(`     "${R.요약}"`);
}

if (!lines.length) {
  console.log("집계할 결과가 없습니다. 에이전트 응답을 work/audit/<슬라이스>.result.json 으로 저장하세요.");
  process.exit(0);
}
console.log("── 감사 결과 ──");
console.log(lines.join("\n"));
console.log(hardFail ? `\n치명 실패 ${hardFail}종 — 해당 슬라이스는 전수 재검이 필요합니다.` : "\n감사 통과");
process.exit(hardFail ? 1 : 0);
