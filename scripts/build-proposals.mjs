/**
 * 반려사유 사례집 화면 데이터
 *
 *   node scripts/build-proposals.mjs
 *
 * 출력  docs/data/proposals.json
 *
 * ── 왜 별도 탭이 아니라 제안서에 붙이는가 ──────────────────────────
 * 사례집을 따로 두면 아무도 안 본다. 값어치는 **같은 유형을 다시 제안할 때
 * 자동으로 뜨는 것**에 있다. 그래서 정책 유형(typeSig)을 붙여 둔다 —
 * 「월세」 제안서를 열면 과거 월세 관련 반려 사유가 같이 나오게.
 *
 * 사유 유형(cause)은 **원문 문구로만** 판정한다. 못 맞추면 null (원칙 5).
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CORE_TYPES } from "./lib/policy-types.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const f = readdirSync(join(ROOT, "data")).filter(x => x.includes("정책제안처리의견")).sort().pop();
if (!f) { console.error("수집 파일이 없습니다. collect:proposals 를 먼저 돌리세요."); process.exit(1); }
const D = JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));

/** 제안이 걸리는 유형들. **결합 서명이 아니라 배열**이다.
 *  typeSigOf 처럼 `면접비+면접정장` 으로 이어 붙이면 단일 유형과 절대 안 맞는다 —
 *  둘러보기가 「면접비」를 보여줄 때 과거 면접 관련 제안이 안 붙는 이유였다.
 *  제안명뿐 아니라 검토의견까지 본다. 제안명은 「청년 면접 스타일링」처럼
 *  사업명 사전과 어휘가 달라서 이름만으로는 4/83 밖에 안 걸린다. */
const typesOf = (name, reason) => {
  const hay = `${name || ""} ${String(reason || "").slice(0, 300)}`;
  return CORE_TYPES.filter(([, re]) => re.test(hay)).map(([k]) => k);
};

/* 반려 사유의 갈래. 문구가 곧 근거이므로 정규식을 원문 표현에 맞춘다.
   순서가 우선순위다 — 「유사사업 중복」이 「예산」보다 먼저다. 중복이면
   예산 얘기를 해도 안 통하기 때문이다. */
const CAUSES = [
  ["유사사업 중복", /유사\s*(한\s*)?(사업|목적|형태)|중복\s*(지원|사업|투자|신청)|이미\s*(시행|운영|추진|하고)|기\s*시행|기시행|운영\s*(하고\s*)?있(음|으며)|추진\s*(하고\s*)?있(음|으며)|중앙정부\s*차원|정식\s*개통|구축\s*완료/],
  ["소관 아님", /소관\s*(부서|기관|사항)|우리\s*(과|시|부서).{0,10}(소관|업무).{0,6}(아님|아니)|타\s*부서|도\s*조례\s*소관|국가\s*사무|바람직할\s*것으로\s*사료/],
  ["법령 위배·근거 부족", /법적\s*근거|근거\s*(가\s*)?(없|부족|미비)|조례\s*(개정|제정)\s*필요|해당된다\s*보기\s*어려|상충|위배|「[^」]*법」\s*제\d/],
  ["예산 부담", /예산.{0,14}(소요|부담|과다|확보\s*어려|편성\s*곤란)|재정\s*부담|지속적인\s*재원|많은\s*예산/],
  ["실행 곤란", /현실(성|적).{0,12}(없|어려|곤란)|구성.{0,10}어려움|집행.{0,8}어려|증빙.{0,8}어려|관리.{0,8}어려|피상적/],
  ["효과 불확실·수요 불명", /수요\s*(가\s*)?(없|불명|파악|조사)|구인\s*신청\s*건수\s*0|실효성|효과.{0,10}(제한적|미미|없|낮|불확실)|유명무실|한계가\s*있/],
  ["민원·갈등 우려", /민원|분쟁|찬성측과\s*반대측|불만이\s*있을\s*수|갈등/],
  ["형평성", /형평성|특정\s*(연령|계층|대상|집단).{0,24}(제한|한정|특정하여)|역차별/],
  ["시기상조", /장기\s*검토|추후\s*검토|재검토|안정화\s*(이후|후)|여건\s*조성|우선\s*확인\s*후/],
];
/* 「기시행중」은 사유를 따질 것 없이 이미 하고 있다는 뜻이다. */
const causeOf = (t, group) => group === "기시행"
  ? "이미 하고 있음"
  : (CAUSES.find(([, re]) => re.test(String(t || "")))?.[0] || null);

/* 화면에서 「됐다/안 됐다」로 묶는다. 공문 라벨은 그대로 두고 묶음만 만든다. */
const PASSED = new Set(["수용", "수정보완 후 시행"]);
const groupOf = r =>
  PASSED.has(r.result) ? "통과" :
  r.result === "기시행중" ? "기시행" :
  r.result === "장기검토" ? "보류" : "반려";

const rows = D.proposals.map(r => {
  const group = groupOf(r);
  return { ...r, ks: typesOf(r.name, r.reason), cause: group === "통과" ? null : causeOf(r.reason, group), group };
});

const byYear = {};
for (const r of rows) {
  byYear[r.year] ??= { n: 0, 통과: 0, 기시행: 0, 보류: 0, 반려: 0 };
  byYear[r.year].n++; byYear[r.year][r.group]++;
}
const byDiv = {};
for (const r of rows) {
  byDiv[r.div] ??= { n: 0, 통과: 0 };
  byDiv[r.div].n++; if (r.group === "통과") byDiv[r.div].통과++;
}
const causeTally = rows.filter(r => r.cause).reduce((a, r) => (a[r.cause] = (a[r.cause] || 0) + 1, a), {});

/* 2년 연속 같은 취지로 안 된 건 — 이게 이 데이터의 가장 뾰족한 산출물이다.
   **유형(ks)으로 짝지으면 안 된다.** 「청년배움 매칭 플랫폼」과 「관공서 유휴공간
   청년센터」가 같은 유형에 걸려 같은 제안으로 묶였다. 이름이 실제로 겹쳐야 한다. */
const norm = s => String(s || "").replace(/[\s·ㆍ․‧()（）「」<>]/g, "");
/* 어느 제안서에나 나오는 말은 겹쳐도 뜻이 없다 */
const STOP = new Set(["청년", "양산", "양산시", "지원", "사업", "지원사업", "운영", "프로그램", "구축", "조성", "활성화"]);
const words = s => [...new Set(String(s || "").split(/[^가-힣A-Za-z0-9]+/)
  .filter(w => w.length >= 2 && !STOP.has(w)))];

const repeats = [];
for (const a of rows.filter(r => r.year === "2024" && r.group !== "통과")) {
  for (const b of rows.filter(r => r.year === "2025" && r.group !== "통과")) {
    const na = norm(a.name), nb = norm(b.name);
    if (!na || !nb || na.length < 4) continue;
    const wa = words(a.name), wb = words(b.name);
    const shared = wa.filter(w => wb.includes(w));
    /* 이름이 통째로 같거나, 뜻 있는 낱말이 둘 이상 겹칠 때만 같은 제안으로 본다 */
    /* 긴 낱말은 하나만 겹쳐도 특정된다 — 「해외지사」가 그 경우다 */
    if (na === nb || shared.length >= 2 || (shared.length === 1 && shared[0].length >= 4))
      repeats.push({ shared, a: { ...a, body: undefined }, b: { ...b, body: undefined } });
  }
}
/* 같은 2025 건이 여러 2024 건에 걸리면 첫 짝만 남긴다 */
const seen = new Set();
const repeat2 = repeats.filter(r => !seen.has(r.b.no) && seen.add(r.b.no));

const doc = {
  source: D.source, note: D.note, date: D.date,
  count: rows.length, byYear, byDiv, causeTally,
  repeats: repeat2,
  proposals: rows,
};
writeFileSync(join(ROOT, "docs/data/proposals.json"), JSON.stringify(doc, null, 0), "utf8");

console.log(`정책제안 처리의견 — ${rows.length}건`);
for (const [y, t] of Object.entries(byYear))
  console.log(`  ${y}년 ${t.n}건 · 통과 ${t.통과} (${(t.통과 / t.n * 100).toFixed(1)}%) · 기시행 ${t.기시행} · 보류 ${t.보류} · 반려 ${t.반려}`);
console.log(`  분과별 통과율: ${Object.entries(byDiv).map(([d, t]) => `${d} ${t.통과}/${t.n}`).join(" · ")}`);
console.log(`  사유 갈래: ${JSON.stringify(causeTally)}`);
console.log(`  사유 미분류 ${rows.filter(r => r.group !== "통과" && !r.cause).length}건`);
console.log(`  유형 붙은 제안 ${rows.filter(r => r.ks.length).length}/${rows.length}`);
console.log(`  2년 연속 안 된 건 ${repeat2.length}건`);
repeat2.forEach(r => console.log(`    ${r.a.no} 「${(r.a.name || "").slice(0, 24)}」 → ${r.b.no} 「${(r.b.name || "").slice(0, 24)}」`));
console.log(`  ${(Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0)}KB → docs/data/proposals.json`);
