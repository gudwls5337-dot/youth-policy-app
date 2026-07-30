/**
 * 비교 데이터 생성 — "우리 시에 없는 정책"
 *
 *   node scripts/build-compare.mjs
 *
 * 유형화는 `lib/policy-types.mjs` 의 핵심어 사전으로 한다.
 * 정책명 토큰 서명을 정확 일치로 비교하던 이전 판은 브랜드명 때문에 같은 사업을
 * 갈라 오탐 3/16 을 냈다(2026-07-30 1단 감사). 사전 방식은 브랜드명을 자동 배제한다.
 *
 * 절대 규칙
 *  - 채택 지자체 수를 항상 함께 낸다. "몇 곳이 하는가" 없이 "없다"만 말하면 근거가 아니다.
 *  - 채택 지자체의 정책이 전부 마감이면 그 유형은 「종료 사업」으로 표시한다.
 *    살아 있지도 않은 사업을 근거로 공백을 주장하면 회의에서 반박당한다.
 *  - 대표사례는 진행 중 정책에서 뽑는다. 작년 사업명이 노출되면 자료가 낡아 보인다.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { typeSig, typeLabel, CORE_TYPES } from "./lib/policy-types.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = JSON.parse(readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"));
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));
const orgs = B.rows.map(r => r.o);

const MIN_ADOPT = 3;

/* ── 기초 정책만 대상 (중앙은 전국 공통, 광역은 도 단위) ── */
const typeMap = new Map();     // 서명 → { orgs:Set, live:Set, ex:idx, exLive:idx }
const coverMap = new Map();
const orgTypes = {}, orgCover = {};
let unsigned = 0, signed = 0;

for (const [org, ids] of Object.entries(D.byOrg)) {
  orgTypes[org] = new Set();
  orgCover[org] = new Set();
  for (const i of ids) {
    const p = D.pol[i];
    const k = typeSig(p.n);
    if (k) {
      signed++;
      if (!typeMap.has(k)) typeMap.set(k, { orgs: new Set(), live: new Set(), ex: i, exLive: null });
      const t = typeMap.get(k);
      t.orgs.add(org);
      if (p.ov !== 1) { t.live.add(org); if (t.exLive == null) t.exLive = i; }
      orgTypes[org].add(k);
    } else unsigned++;
    const c = `${p.f}/${p.s || "기타"}`;
    if (!coverMap.has(c)) coverMap.set(c, new Set());
    coverMap.get(c).add(org);
    orgCover[org].add(c);
  }
}

const types = [...typeMap.entries()]
  .filter(([, v]) => v.orgs.size >= MIN_ADOPT)
  .sort((a, b) => b[1].orgs.size - a[1].orgs.size)
  .map(([k, v]) => {
    const ex = v.exLive ?? v.ex;                    // 대표사례는 진행 중 우선
    return {
      k, label: typeLabel(k),
      n: v.orgs.size,
      nLive: v.live.size,                            // 지금 신청 가능한 곳
      dead: v.live.size === 0 ? 1 : 0,               // 채택지 전부 마감 = 종료 사업
      ex, exName: D.pol[ex].n,
      orgs: [...v.orgs].sort((a, b) => a.localeCompare(b, "ko")),
      liveOrgs: [...v.live].sort((a, b) => a.localeCompare(b, "ko")),
    };
  });

const cover = [...coverMap.entries()].sort((a, b) => b[1].size - a[1].size)
  .map(([k, v]) => ({ k, n: v.size }));

const outPath = join(ROOT, "docs/data/compare.json");
writeFileSync(outPath, JSON.stringify({
  date: D.date, minAdopt: MIN_ADOPT,
  basicTotal: Object.values(D.byOrg).flat().length,
  orgsWithBasic: Object.values(D.byOrg).filter(v => v.length).length,
  typeCoverage: { signed, unsigned, dict: CORE_TYPES.length },
  types, cover,
  orgTypes: Object.fromEntries(Object.entries(orgTypes).map(([o, s]) => [o, [...s]])),
  orgCover: Object.fromEntries(Object.entries(orgCover).map(([o, s]) => [o, [...s]])),
}), "utf8");

const ys = "경상남도 양산시";
const mine = new Set(orgTypes[ys] || []);
const gap = types.filter(t => !mine.has(t.k));
console.log(`비교 데이터 생성`);
console.log(`  사전 ${CORE_TYPES.length}종 · 유형 붙은 정책 ${signed} / 미매칭 ${unsigned} (비교 제외)`);
console.log(`  ${MIN_ADOPT}곳 이상 채택 ${types.length}종 · 그중 채택지 전부 마감 ${types.filter(t => t.dead).length}종`);
console.log(`\n  ${ys}: 보유 ${mine.size}종 · 없는 유형 ${gap.length}종`);
console.log(`  보유: ${[...mine].join(" / ")}`);
gap.slice(0, 8).forEach(t => console.log(`    ${String(t.n).padStart(2)}곳(진행 ${t.nLive})  ${t.label}${t.dead ? "  ※전부 마감" : ""}`));
console.log(`  ${(statSync(outPath).size / 1024).toFixed(0)}KB → docs/data/compare.json`);
