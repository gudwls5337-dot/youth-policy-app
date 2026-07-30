/**
 * 조례 조문 비교 — 「우리 조례에 없는 조문」
 *
 *   node scripts/build-gov-compare.mjs
 *
 * 왜 정책이 아니라 조문인가
 *   정책(온통청년)은 자발 등록이라 「없다」와 「등록이 없다」를 구분할 수 없다.
 *   조문은 법적 효력이 있어 개정하면 즉시 반영되고, 개정 안 했으면 그게 현행이다.
 *   즉 「없다」를 말할 수 있는 유일한 축이다(2026-07-30 범위 축소 결정).
 *
 * 지표는 정책단이 실제로 제안할 수 있는 것만 고른다.
 * 각 지표에 **원문 인용과 조문 번호**를 함께 담아 회의에서 바로 인용할 수 있게 한다.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const G = JSON.parse(readFileSync(join(ROOT, "docs/data/governance.json"), "utf8"));
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));
const rows = G.rows.filter(r => !r.err);
const byOrg = new Map(rows.map(r => [r.o, r]));

/* ── 지표 정의 ──
   have(r)   우리가 그 조문을 갖고 있는가
   better(r) 그 지자체가 우리보다 나은가 (비교 분모)
   why       왜 이게 중요한가 — 제안서에 그대로 쓸 문장 */
const METRICS = [
  {
    id: "netMandatory", label: "참여기구 설치 의무화",
    ask: "청년 참여기구를 「둘 수 있다」가 아니라 「둔다」로 규정",
    why: "임의 규정이면 규모·소속·존폐를 집행부가 정할 수 있습니다. 의무 규정이면 조례가 기구를 보호합니다.",
    have: r => r.net?.kind === "의무",
    pool: r => r.net?.kind === "의무",
    mine: r => `현재 ${r.net?.kind ?? "미상"}${r.net?.article ? ` (${r.net.article} ${r.net.title || ""})` : ""}`,
  },
  {
    id: "regular2", label: "위원회 정기회 연 2회 이상",
    ask: "정기회를 연 2회 이상으로 규정",
    why: "연 1회면 예산 편성 주기를 한 번밖에 못 탑니다. 2회면 본예산과 추경에 각각 의견을 낼 수 있습니다.",
    have: r => (r.regular?.n ?? 0) >= 2,
    pool: r => (r.regular?.n ?? 0) >= 2,
    mine: r => r.regular?.n ? `현재 연 ${r.regular.n}회` : "현재 규정 없음",
  },
  {
    id: "youthQuota", label: "청년 위원 비율 하한",
    ask: "위원 중 청년을 일정 비율 이상 포함하도록 규정",
    why: "비율 규정이 없으면 청년정책위원회에 청년이 몇 명이든 조례 위반이 아닙니다.",
    have: r => r.youthQuota?.pct != null,
    pool: r => r.youthQuota?.pct != null,
    mine: r => r.youthQuota?.pct != null
      ? `현재 ${r.youthQuota.pct}%${r.youthQuota.binding === 0 ? " (노력 조항)" : ""}`
      : "현재 규정 없음",
  },
  {
    id: "youthQuotaBinding", label: "청년 위원 비율 — 강제 규정",
    ask: "「노력하여야 한다」가 아니라 「포함하여야 한다」로 규정",
    why: "노력 조항은 위반해도 문제가 되지 않습니다. 「조례에 있습니다」라고 말했다가 「노력 조항입니다」로 반박당하는 지점입니다.",
    have: r => r.youthQuota?.binding === 1,
    pool: r => r.youthQuota?.binding === 1,
    mine: r => r.youthQuota?.pct == null ? "현재 규정 없음"
      : r.youthQuota.binding === 1 ? "이미 강제 규정" : "현재 노력 조항",
  },
  {
    id: "planMandatory", label: "기본계획 수립 의무",
    ask: "기본계획을 「수립하여야 한다」로 규정 (주기 명시)",
    why: "의무 규정이면 계획을 세우지 않은 것 자체가 미이행입니다. 시행계획이 기본계획에 종속되므로 연쇄로 걸립니다.",
    have: r => r.plan?.kind === "의무",
    pool: r => r.plan?.kind === "의무",
    mine: r => `현재 ${r.plan?.kind ?? "미상"}${r.plan?.cycle ? ` · ${r.plan.cycle}년마다` : ""}${r.plan?.article ? ` (${r.plan.article})` : ""}`,
  },
];

/* ── 지표별 채택 지자체 ── */
const metrics = METRICS.map(m => {
  const adopters = rows.filter(m.pool).map(r => r.o);
  /* 인용할 만한 대표 사례 — 원문 인용이 있는 곳 우선 */
  const exRow = rows.filter(m.pool).find(r => {
    const q = m.id.startsWith("youth") ? r.youthQuota?.quote
      : m.id === "regular2" ? r.regular?.quote
      : m.id === "planMandatory" ? r.plan?.quote : r.net?.quote;
    return q && q.length > 30;
  });
  return {
    id: m.id, label: m.label, ask: m.ask, why: m.why,
    n: adopters.length, total: rows.length,
    adopters: adopters.slice(0, 40),
    ex: exRow ? { o: exRow.o,
      article: m.id === "planMandatory" ? exRow.plan?.article
        : m.id.startsWith("youth") ? (exRow.cmte?.article || null)
        : m.id === "regular2" ? (exRow.cmte?.article || null) : exRow.net?.article,
      quote: m.id.startsWith("youth") ? exRow.youthQuota?.quote
        : m.id === "regular2" ? exRow.regular?.quote
        : m.id === "planMandatory" ? exRow.plan?.quote : exRow.net?.quote } : null,
  };
});

/* ── 지자체별 보유/미보유 ── */
const orgState = {};
for (const r of rows) {
  orgState[r.o] = {
    has: METRICS.filter(m => m.have(r)).map(m => m.id),
    mine: Object.fromEntries(METRICS.map(m => [m.id, m.mine(r)])),
    cmte: r.cmte, net: r.net, regular: r.regular, seats: r.seats,
    youthQuota: r.youthQuota, plan: r.plan,
    dept: r.dept, tel: r.tel,
  };
}

const outPath = join(ROOT, "docs/data/gov-compare.json");
writeFileSync(outPath, JSON.stringify({
  date: G.snapshotDate, orgs: rows.length, metrics, orgState,
}), "utf8");

const ys = "경상남도 양산시";
const mine = new Set(orgState[ys]?.has || []);
console.log(`조례 조문 비교 — ${rows.length}곳`);
metrics.forEach(m => console.log(`  ${String(m.n).padStart(3)}/${m.total}곳  ${m.label}`));
console.log(`\n  ${ys}: 보유 ${mine.size}/${metrics.length}종`);
metrics.filter(m => !mine.has(m.id)).forEach(m =>
  console.log(`    없음 — ${m.label} (${m.n}곳 보유) · ${orgState[ys].mine[m.id]}`));
console.log(`  ${(statSync(outPath).size / 1024).toFixed(0)}KB → docs/data/gov-compare.json`);
