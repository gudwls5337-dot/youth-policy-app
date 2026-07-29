/**
 * 수집한 청년정책을 지자체별로 귀속시키고 신설·종료를 판정한다.
 *
 *   node scripts/build-policies.mjs
 *
 * 저장 구조 — 본문은 한 번만 담고 지자체는 인덱스만 가진다 (중복 제거로 용량 1/30)
 *   pol  전체 정책 · central 중앙 인덱스 · bySido 광역 인덱스 · byOrg 기초 인덱스
 *
 * 실측 확인한 필드 (2026-07-29)
 *   frstRegDt      최초등록일  → 「올해 새로 나온 정책」
 *   bizPrdEndYmd   사업 종료일 → 「사라지는 정책」
 *   aplyYmd        "20260728 ~ 20260930" 형식 신청기간
 *   plcyAplyMthdCn 신청방법 · sbmsnDcmntCn 구비서류 · srngMthdCn 심사방법
 *   addAplyQlfcCndCn 추가 자격요건 · etcMttrCn 기타
 *
 * 절대 규칙
 *  - 「사라지는 정책」은 사업 종료일이 지났거나 임박한 것만 센다. 폐지 사유는 추측하지 않는다.
 *  - 진짜 폐지(목록에서 사라짐) 판정은 다음 스냅샷부터 가능하다. 그전까지는 그렇게 표기한다.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POL = JSON.parse(readFileSync(join(ROOT, "data/20260729수집_청년정책_전수.json"), "utf8"));
const ORD = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));

const TODAY = (POL.snapshotDate || "2026-07-29").replace(/-/g, "");
const SOON = String(+TODAY + 200);           // 대략 2개월 뒤
const THIS_YEAR = TODAY.slice(0, 4);

const FIELD_MAP = [[/일자리/, "일자리"], [/주거/, "주거"], [/교육|직업훈련/, "교육"],
  [/복지|문화|금융/, "복지·문화"], [/참여|권리|기반/, "참여·권리"]];
const normField = raw => {
  const s = String(raw || "").split(",")[0].trim();
  for (const [re, out] of FIELD_MAP) if (re.test(s)) return out;
  return "기타";
};
const CENTRAL = /고용노동부|한국고용정보원|보건복지부|국토교통부|중소벤처기업부|여성가족부|교육부|국무조정실|금융위원회|기획재정부|과학기술정보통신부|행정안전부|문화체육관광부|농림축산식품부|해양수산부|산업통상자원부|병무청|국가보훈부|법무부|환경부|통일부|산림청|한국장학재단|근로복지공단|신용보증기금|기술보증기금|소상공인시장진흥공단|한국주택금융공사|주택도시보증공사|한국토지주택공사|중소벤처기업진흥공단|서민금융진흥원/;

const clip = (s, n) => { const t = String(s ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const ymd = s => { const t = String(s ?? "").trim(); return /^\d{8}$/.test(t) ? t : ""; };

/** aplyYmd 는 "20260728 ~ 20260930" 형식. 신청 마감일만 뽑는다.
 *  사업기간(bizPrdEndYmd)만 보면 신청이 이미 끝난 정책 438건을 놓친다.
 *  (2026-07-29 지적으로 발견) */
const aplyEnd = s => { const m = String(s ?? "").match(/(\d{8})\s*~\s*(\d{8})/); return m ? m[2] : ""; };
/** 상시·수시·연중은 마감이 없다 — 종료로 보면 안 된다 */
const isAlways = p => /상시|수시|연중|기간\s*없음/.test(`${p.aplyYmd ?? ""} ${p.bizPrdEtcCn ?? ""}`);

const orgs = ORD.rows.map(r => r.o);
const SIDO = [...new Set(orgs.map(o => o.split(" ")[0]))];
const BASIC = orgs.filter(o => o.split(" ").length > 1)
  .map(o => ({ full: o, sido: o.split(" ")[0], nm: o.split(" ").slice(1).join(" ") }));
const dupNames = new Set(Object.entries(BASIC.reduce((a, b) => (a[b.nm] = (a[b.nm] || 0) + 1, a), {}))
  .filter(([, n]) => n > 1).map(([k]) => k));
const sidoShort = s => s.replace(/(특별자치)?(광역시|특별시|자치시|자치도|시|도)$/, "");

const pol = [];
const central = [], bySido = Object.fromEntries(SIDO.map(s => [s, []])), byOrg = Object.fromEntries(orgs.map(o => [o, []]));
let unmatched = 0;

POL.rows.forEach(p => {
  const hay = [p.sprvsnInstCdNm, p.operInstCdNm, p.rgtrInstCdNm].filter(Boolean).join(" | ");
  const i = pol.length;
  const reg = String(p.frstRegDt || "").slice(0, 10);
  const end = ymd(p.bizPrdEndYmd);
  const ae = aplyEnd(p.aplyYmd);
  const always = isAlways(p);

  /* 종료 판정 — 신청 마감과 사업 종료 중 **먼저 닫히는 쪽**을 기준으로 한다.
     이용자가 실제로 막히는 지점이 그곳이기 때문이다. */
  const closes = [ae, end].filter(Boolean).sort()[0] || "";
  const ov = always ? 0 : (closes && closes < TODAY ? 1 : (closes && closes <= SOON ? 2 : 0));
  const reason = !closes ? "" : (ae && ae === closes ? "신청마감" : "사업종료");

  pol.push({
    n: p.plcyNm, f: normField(p.lclsfNm), s: p.mclsfNm || "", kw: p.plcyKywdNm || "",
    v: clip(p.plcySprtCn, 480),          // 지원 내용
    e: clip(p.plcyExplnCn, 200),         // 설명
    h: clip(p.plcyAplyMthdCn, 380),      // 신청 방법
    d: clip(p.sbmsnDcmntCn, 240),        // 구비 서류
    q: clip(p.addAplyQlfcCndCn, 200),    // 추가 자격요건
    j: clip(p.srngMthdCn, 200),          // 심사 방법
    x: clip(p.etcMttrCn, 200),           // 기타
    a: p.sprtTrgtMinAge, b: p.sprtTrgtMaxAge,
    ap: String(p.aplyYmd || "").trim(),  // 신청기간 원문
    pe: end,                             // 사업 종료일
    ae,                                  // 신청 마감일
    cl: closes,                          // 먼저 닫히는 날짜
    cr: reason,                          // 닫히는 사유 (신청마감 | 사업종료)
    pc: clip(p.bizPrdEtcCn, 40),         // "연중" 등
    al: always ? 1 : 0,                  // 상시·수시
    u: p.aplyUrlAddr || p.refUrlAddr1 || "",
    i: clip(p.sprvsnInstCdNm || p.operInstCdNm || p.rgtrInstCdNm, 40),
    r: reg,                              // 최초등록일
    nw: reg.startsWith(THIS_YEAR) ? 1 : 0,
    ov,                                  // 0 진행 · 1 종료 · 2 임박
  });

  const hitBasic = BASIC.filter(b => hay.includes(b.nm) && (!dupNames.has(b.nm) || hay.includes(sidoShort(b.sido))));
  if (hitBasic.length) { hitBasic.forEach(b => byOrg[b.full].push(i)); pol[i].lv = "기초"; return; }
  const hitSido = SIDO.filter(s => hay.includes(s) || hay.includes(sidoShort(s)));
  if (hitSido.length) { hitSido.forEach(s => bySido[s].push(i)); pol[i].lv = "광역"; return; }
  if (CENTRAL.test(hay)) { central.push(i); pol[i].lv = "중앙"; return; }

  /* 여기까지 못 걸린 건에 한해 정책명·지원내용·신청방법을 2차 단서로 본다.
     (2026-07-29 감사 지적: 「아산시 청년 생활물품 대여」처럼 지역이 정책명에만
      있는 사례가 있었다. 오탐을 막기 위해 1차 판정 실패분에만 적용한다.) */
  const hay2 = [p.plcyNm, p.plcySprtCn, p.plcyAplyMthdCn].filter(Boolean).join(" | ");
  const b2 = BASIC.filter(b => hay2.includes(b.nm) && (!dupNames.has(b.nm) || hay2.includes(sidoShort(b.sido))));
  if (b2.length === 1) { byOrg[b2[0].full].push(i); pol[i].lv = "기초"; pol[i].w = 1; return; }
  const s2 = SIDO.filter(s => hay2.includes(s));
  if (s2.length === 1) { bySido[s2[0]].push(i); pol[i].lv = "광역"; pol[i].w = 1; return; }

  unmatched++; pol[i].lv = "미분류";
});

const outPath = join(ROOT, "docs/data/policies-by-org.json");
writeFileSync(outPath, JSON.stringify({
  date: POL.snapshotDate, total: POL.rows.length, baseline: true,
  counts: { central: central.length, unmatched },
  pol, central, bySido, byOrg,
}), "utf8");

const per = o => (byOrg[o]?.length || 0) + (bySido[o.split(" ")[0]]?.length || 0) + central.length;
const sizes = orgs.map(per).sort((a, b) => a - b);
const ys = "경상남도 양산시";
const yIdx = [...byOrg[ys], ...bySido["경상남도"], ...central];
console.log(`정책 ${POL.rows.length}건 귀속`);
console.log(`  중앙 ${central.length} · 광역 ${Object.values(bySido).flat().length} · 기초 ${Object.values(byOrg).flat().length} · 미분류 ${unmatched}`);
console.log(`  지자체당 중앙값 ${sizes[Math.floor(sizes.length / 2)]}건`);
console.log(`  ${ys} ${yIdx.length}건 — 진행 ${yIdx.filter(i => !pol[i].ov).length} · 임박 ${yIdx.filter(i => pol[i].ov === 2).length} · 종료 ${yIdx.filter(i => pol[i].ov === 1).length}`);
console.log(`  전체 — 올해 신설 ${pol.filter(p => p.nw).length} · 종료됨 ${pol.filter(p => p.ov === 1).length} · 임박 ${pol.filter(p => p.ov === 2).length}`);
console.log(`  ${(statSync(outPath).size / 1024 / 1024).toFixed(2)}MB → docs/data/policies-by-org.json`);
