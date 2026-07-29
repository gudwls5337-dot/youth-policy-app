/**
 * 비교 데이터 생성 — "우리 시에 없는 정책" 계산
 *
 *   node scripts/build-compare.mjs
 *
 * 두 축을 함께 쓴다. 하나만으로는 부족하다.
 *
 *  ① 커버리지 축 (분야/중분류 25종)
 *     온통청년 API 가 직접 붙인 분류라 파싱 위험이 없다. 안정적이지만 거칠다.
 *     "우리 시는 「주거/주택 및 거주지」 유형을 아예 안 한다" 를 말할 수 있다.
 *
 *  ② 사업 유형 축 (정책명 토큰 서명)
 *     구체적이라 제안서에 바로 쓸 수 있다. 다만 기초 정책이 834건뿐이라
 *     3곳 이상 채택된 유형은 13종밖에 안 나온다 — 표본이 얇다는 것을 숨기지 않는다.
 *
 * 절대 규칙
 *  - 채택 지자체 수를 항상 함께 낸다. "몇 곳이 하는가" 없이 "없다"만 말하면 근거가 아니다.
 *  - 중앙 정책은 비교에서 제외한다. 전국 공통이라 차이를 만들지 않는다.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = JSON.parse(readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"));
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));

const orgs = B.rows.map(r => r.o);
const basics = orgs.filter(o => o.split(" ").length > 1).map(o => o.split(" ").slice(1).join(" "));
const sidos = [...new Set(orgs.map(o => o.split(" ")[0]))];
const STRIP = [...basics, ...sidos, ...sidos.map(s => s.replace(/(특별자치)?(광역시|특별시|자치시|자치도|시|도)$/, ""))]
  .filter(w => w.length >= 2).sort((a, b) => b.length - a.length);

const STOP = new Set(["청년", "시", "군", "구", "도", "우리", "및", "등", "위한", "관련", "대상", "해당",
  "일반", "특별", "신규", "기존", "추가", "제공", "확대", "강화", "개선", "실시", "시행", "지역", "센터운영"]);

/* 표기가 갈린 같은 사업을 하나로 모은다. 실측으로 확인한 것만 넣는다. */
const SYN = [
  [/자격증?\s*시험|자격\s*시험|자격증/g, "자격"],
  [/응시\s*료|수수료|시험료/g, "응시료"],
  [/임차\s*보증금|전세\s*보증금|보증금/g, "보증금"],
  [/월세|임대료/g, "월세"],
  [/이자\s*지원|대출\s*이자|이차\s*보전|이자/g, "이자"],
  [/어학\s*시험|어학/g, "어학"],
  [/면접\s*복장|면접\s*정장|정장/g, "면접정장"],
  [/교통\s*비|교통\s*카드/g, "교통비"],
  [/문화\s*이용권|문화\s*누리|문화\s*패스/g, "문화이용권"],
  [/마음\s*건강|심리\s*상담|정신\s*건강/g, "마음건강"],
  [/이사\s*비|이주\s*비/g, "이사비"],
  [/창업\s*자금|창업\s*지원금/g, "창업자금"],
  [/네트워크|협의체|숙의단|정책단/g, "참여기구"],
];

function sig(name) {
  let s = String(name || "")
    .replace(/[「」『』\[\]（）()<>《》]/g, " ")
    .replace(/20\d\d\s*년?/g, " ").replace(/(상|하)반기/g, " ").replace(/제?\s*\d+\s*(차|기|회)/g, " ");
  for (const w of STRIP) s = s.split(w).join(" ");
  for (const [re, to] of SYN) s = s.replace(re, to);
  s = s.replace(/지원\s*사업|사업비|사업|운영|모집|안내|신청|추진|프로그램|지원금|지원/g, " ");
  s = s.replace(/[^가-힣A-Za-z]/g, " ");
  const t = [...new Set(s.split(/\s+/).filter(w => w.length >= 2 && !STOP.has(w)))].sort();
  return t.length ? t.join("·") : "";
}

/* ── 기초 정책만 대상 (중앙은 전국 공통, 광역은 도 단위라 시군 비교에 부적합) ── */
const typeMap = new Map();     // 서명 → { orgs:Set, ex:idx, label }
const coverMap = new Map();    // "분야/중분류" → Set(org)
const orgTypes = {};           // org → [서명]
const orgCover = {};           // org → ["분야/중분류"]

for (const [org, ids] of Object.entries(D.byOrg)) {
  orgTypes[org] = new Set();
  orgCover[org] = new Set();
  for (const i of ids) {
    const p = D.pol[i];
    const k = sig(p.n);
    if (k) {
      if (!typeMap.has(k)) typeMap.set(k, { orgs: new Set(), ex: i });
      typeMap.get(k).orgs.add(org);
      orgTypes[org].add(k);
    }
    const c = `${p.f}/${p.s || "기타"}`;
    if (!coverMap.has(c)) coverMap.set(c, new Set());
    coverMap.get(c).add(org);
    orgCover[org].add(c);
  }
}

/* 3곳 이상이 하는 유형만 "보편"으로 본다. 1~2곳은 특수 사례라 제안 근거가 약하다. */
const MIN_ADOPT = 3;
const types = [...typeMap.entries()]
  .filter(([, v]) => v.orgs.size >= MIN_ADOPT)
  .sort((a, b) => b[1].orgs.size - a[1].orgs.size)
  .map(([k, v]) => ({
    k, n: v.orgs.size,
    label: D.pol[v.ex].n,          // 대표 사례 이름 — 사람이 읽을 이름이 필요하다
    ex: v.ex,
    orgs: [...v.orgs].sort((a, b) => a.localeCompare(b, "ko")),
  }));

/* coverMap 의 값은 Set(org) 자체다 — typeMap 처럼 객체가 아니다 */
const cover = [...coverMap.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .map(([k, v]) => ({ k, n: v.size }));

writeFileSync(join(ROOT, "docs/data/compare.json"), JSON.stringify({
  date: D.date, minAdopt: MIN_ADOPT,
  basicTotal: Object.values(D.byOrg).flat().length,
  orgsWithBasic: Object.values(D.byOrg).filter(v => v.length).length,
  types, cover,
  orgTypes: Object.fromEntries(Object.entries(orgTypes).map(([o, s]) => [o, [...s]])),
  orgCover: Object.fromEntries(Object.entries(orgCover).map(([o, s]) => [o, [...s]])),
}), "utf8");

const ys = "경상남도 양산시";
const mine = new Set(orgTypes[ys] || []);
const gap = types.filter(t => !mine.has(t.k));
const mineC = new Set(orgCover[ys] || []);
const gapC = cover.filter(c => !mineC.has(c.k) && c.n >= 5);

console.log(`비교 데이터 생성`);
console.log(`  기초 정책 ${Object.values(D.byOrg).flat().length}건 · 기초 정책 있는 지자체 ${Object.values(D.byOrg).filter(v => v.length).length}/235`);
console.log(`  사업 유형 ${typeMap.size}종 → ${MIN_ADOPT}곳 이상 채택 ${types.length}종`);
console.log(`  커버리지 유형 ${cover.length}종`);
console.log(`\n  ${ys}: 보유 ${mine.size}종 · 없는 보편 유형 ${gap.length}종 · 없는 커버리지 ${gapC.length}종`);
gap.slice(0, 5).forEach(t => console.log(`    ${String(t.n).padStart(2)}곳  ${t.k}  ← ${t.label.slice(0, 34)}`));
console.log(`  ${(statSync(join(ROOT, "docs/data/compare.json")).size / 1024).toFixed(0)}KB → docs/data/compare.json`);
