/**
 * 수집한 청년정책을 지자체별로 귀속시키고 신설·마감을 판정한다.
 *
 *   node scripts/build-policies.mjs
 *
 * 저장 구조 — 본문은 한 번만 담고 지자체는 인덱스만 가진다
 *   pol  전체 정책 · central 전국 인덱스 · bySido 광역 인덱스 · byOrg 기초 인덱스
 *
 * 귀속 (2026-07-30 전면 교체)
 *   기관명 텍스트만 보던 이전 판은 「청년정책과」처럼 부서명만 있는 건을 놓쳐
 *   170건이 미분류였다(충남에 83건 집중). zipCd(행정구역 코드)를 함께 쓰니 6건으로 줄었다.
 *   코드북은 외부 파일 없이 **데이터에서 역추출**한다 — 기관명으로 확실히 판정된
 *   건의 (단일 코드 ↔ 지자체) 쌍을 모으는 방식이고, board.json 과 100% 일치해 자기 검증된다.
 *
 * 마감 판정
 *   신청 마감(aplyYmd)과 사업 종료(bizPrdEndYmd) 중 **먼저 닫히는 쪽**을 본다.
 *   사업기간만 보던 이전 판은 신청이 이미 끝난 962건을 진행 중으로 표시했다.
 *
 * 절대 규칙
 *  - 등록률을 함께 낸다. 서울 59건·경기 108건은 **정책이 없는 게 아니라 온통청년
 *    등록분이 적은 것**이다(자체 포털 운영). "없다"고 말하면 거짓이 된다.
 *  - 원본에 없는 것을 추정하지 않는다. 미분류는 미분류로 남긴다.
 */

import { readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCodebook, basicOf, sidoOf, isNationwide, codes } from "./lib/region.mjs";
import { applyStatus, APLY } from "./lib/normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POL = JSON.parse(readFileSync(join(ROOT, "data/20260729수집_청년정책_전수.json"), "utf8"));
const ORD = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));

const TODAY = (POL.snapshotDate || "2026-07-29").replace(/-/g, "");
const SOON = String(+TODAY + 200);
const THIS_YEAR = TODAY.slice(0, 4);

const FIELD_MAP = [[/일자리/, "일자리"], [/주거/, "주거"], [/교육|직업훈련/, "교육"],
  [/복지|문화|금융/, "복지·문화"], [/참여|권리|기반/, "참여·권리"]];
const normField = raw => {
  const s = String(raw || "").split(",")[0].trim();
  for (const [re, out] of FIELD_MAP) if (re.test(s)) return out;
  return "기타";
};
const CENTRAL = /고용노동부|한국고용정보원|보건복지부|국토교통부|중소벤처기업부|여성가족부|교육부|국무조정실|금융위원회|기획재정부|과학기술정보통신부|행정안전부|문화체육관광부|농림축산식품부|해양수산부|산업통상자원부|병무청|국가보훈부|법무부|환경부|통일부|산림청|외교부|금융감독원|한국국제교류재단|한국장학재단|근로복지공단|신용보증기금|기술보증기금|소상공인시장진흥공단|한국주택금융공사|주택도시보증공사|한국토지주택공사|중소벤처기업진흥공단|서민금융진흥원|KOICA|해양경찰청/;

const clip = (s, n) => { const t = String(s ?? "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
const ymd = s => { const t = String(s ?? "").trim(); return /^\d{8}$/.test(t) ? t : ""; };
const aplyEnd = s => { const m = String(s ?? "").match(/(\d{8})\s*~\s*(\d{8})/); return m ? m[2] : ""; };

/* ── 지자체 목록 ── */
const orgs = ORD.rows.map(r => r.o);
const SIDO = [...new Set(orgs.map(o => o.split(" ")[0]))];
const BASIC = orgs.filter(o => o.split(" ").length > 1)
  .map(o => ({ full: o, sido: o.split(" ")[0], nm: o.split(" ").slice(1).join(" ") }));
const dupNames = new Set(Object.entries(BASIC.reduce((a, b) => (a[b.nm] = (a[b.nm] || 0) + 1, a), {}))
  .filter(([, n]) => n > 1).map(([k]) => k));
const sidoShort = s => s.replace(/(특별자치)?(광역시|특별시|자치시|자치도|시|도)$/, "");
const hayOf = r => [r.sprvsnInstCdNm, r.operInstCdNm, r.rgtrInstCdNm].filter(Boolean).join(" | ");

/** 기관명이 **명시적으로 가리키는** 시도들 */
const sidosIn = hay => SIDO.filter(s => hay.includes(s) || hay.includes(sidoShort(s)));
/**
 * 기관명이 다른 시도를 명시했으면 그 시도의 기초만 후보다.
 *
 * 「광주시청」(=광주광역시청)이 경기도 **광주시** 로 붙어 광주광역시 정책
 * 199건이 통째로 경기도 광주시에 귀속됐다(2026-07-30 4단 감사).
 * 그 200건짜리 가짜 버킷이 「기초 정책이 가장 많은 곳」이라 1:1 대조의 기본
 * 비교 대상이기도 했다. 동명 검사(dupNames)로는 못 잡는다 — 광주광역시는
 * 이 데이터셋에서 시도이고 기초 목록에 없어서 「광주시」가 유일 후보가 된다.
 */
const sidoConsistent = (hay, full) => {
  const m = sidosIn(hay);
  return m.length === 0 || m.includes(full.split(" ")[0]);
};

/** 기관명으로 기초 지자체를 확실히 특정할 수 있으면 그 이름 */
function basicByName(r) {
  const hay = hayOf(r);
  const hit = BASIC.filter(b => hay.includes(b.nm) && (!dupNames.has(b.nm) || hay.includes(sidoShort(b.sido))))
    .filter(b => sidoConsistent(hay, b.full));
  return hit.length === 1 ? hit[0].full : null;
}
/** 코드북 구성용 넓은 단서 — 정책명·URL 까지 본다.
 *  직접 귀속에는 쓰지 않는다(부분문자열 충돌 위험). 코드북은 다수결이라 안전하다. */
const BASIC_LONG = [...BASIC].sort((a, b) => b.nm.length - a.nm.length);
function basicByWide(r) {
  const hay = [r.plcyNm, r.sprvsnInstCdNm, r.operInstCdNm, r.rgtrInstCdNm, r.aplyUrlAddr, r.refUrlAddr1]
    .filter(Boolean).join(" | ");
  for (const b of BASIC_LONG) {
    if (!hay.includes(b.nm)) continue;
    if (dupNames.has(b.nm) && !hay.includes(sidoShort(b.sido))) continue;   // 동명은 시도명 동반 필수
    if (!sidoConsistent(hay, b.full)) continue;                             // 다른 시도를 명시했으면 후보 아님
    return b.full;
  }
  return null;
}

function sidoByName(r) {
  const hay = hayOf(r);
  const hit = SIDO.filter(s => hay.includes(s) || hay.includes(sidoShort(s)));
  return hit.length === 1 ? hit[0] : null;
}

/* ── 코드북 역추출 ── */
const { book, conflicts } = buildCodebook(POL.rows, basicByName, basicByWide);
const badBook = Object.values(book).filter(o => !orgs.includes(o));

/* ── 정규화 + 귀속 ── */
const pol = [];
const central = [], bySido = Object.fromEntries(SIDO.map(s => [s, []])), byOrg = Object.fromEntries(orgs.map(o => [o, []]));
let unmatched = 0;
const unmatchedSample = [];
/** 등록 실태 통계 — zipCd 가 가리키는 실제 지역 기준 */
const regStat = {};

POL.rows.forEach(p => {
  const i = pol.length;
  const reg = String(p.frstRegDt || "").slice(0, 10);
  const end = ymd(p.bizPrdEndYmd);
  const ae = aplyEnd(p.aplyYmd);

  /* 상태는 원본 코드(aplyPrdSeCd)로 판정한다. 자유텍스트("연중")를 읽던 이전 판은
     516건을 거짓으로 「신청 가능」으로 표시했다(2026-07-30 3단 감사). */
  const S = applyStatus(p, TODAY);
  const always = S.st === "always";
  const closes = S.cl;
  const reason = S.cr;
  const ov = S.st === "closed" ? 1 : (closes && closes <= SOON ? 2 : 0);

  /* 지원 규모 — 이미 받아놓고 안 쓰던 필드 (2026-07-30 반영) */
  const scale = /^\d+$/.test(String(p.sprtSclCnt ?? "").trim()) ? +p.sprtSclCnt : null;
  const limited = String(p.sprtSclLmtYn ?? "").trim() === "Y";

  pol.push({
    n: p.plcyNm, f: normField(p.lclsfNm), s: p.mclsfNm || "", kw: p.plcyKywdNm || "",
    v: clip(p.plcySprtCn, 480), e: clip(p.plcyExplnCn, 200),
    h: clip(p.plcyAplyMthdCn, 380), d: clip(p.sbmsnDcmntCn, 240),
    q: clip(p.addAplyQlfcCndCn, 200), j: clip(p.srngMthdCn, 200), x: clip(p.etcMttrCn, 200),
    a: p.sprtTrgtMinAge, b: p.sprtTrgtMaxAge,
    ap: String(p.aplyYmd || "").trim(), pe: end, ae, cl: closes, cr: reason,
    pc: clip(p.bizPrdEtcCn, 40), al: always ? 1 : 0,
    sc: scale, lm: limited ? 1 : 0,
    u: p.aplyUrlAddr || p.refUrlAddr1 || "",
    pic: clip(p.sprvsnInstPicNm || p.operInstPicNm, 24),
    i: clip(p.sprvsnInstCdNm || p.operInstCdNm || p.rgtrInstCdNm, 40),
    r: reg,
    /* 신설 = 올해 등록 AND 원본이 마감이 아님. 스냅샷 차집합이 가능해질 때까지 보수적으로 본다. */
    nw: (reg.startsWith(THIS_YEAR) && String(p.aplyPrdSeCd ?? "").trim() !== APLY.CLOSED) ? 1 : 0,
    ov,
    /* 원본 코드 — 검증에서 회귀를 잡기 위해 보관한다 */
    ac: String(p.aplyPrdSeCd ?? "").trim().slice(-1),
  });

  /* 등록 실태 — 전국 사업은 제외하고 지역 귀속분만 센다 */
  const zs = sidoOf(p);
  if (zs) { regStat[zs] = (regStat[zs] || 0) + 1; }

  /* 귀속 — 확실한 단서부터 */
  const b1 = basicByName(p);
  if (b1) { byOrg[b1].push(i); pol[i].lv = "기초"; return; }

  if (isNationwide(p)) {
    if (CENTRAL.test(hayOf(p)) || !sidoByName(p)) { central.push(i); pol[i].lv = "중앙"; return; }
  }
  const b2 = basicOf(p, book);
  if (b2 && byOrg[b2]) { byOrg[b2].push(i); pol[i].lv = "기초"; pol[i].w = 1; return; }

  const s1 = sidoByName(p);
  if (s1) { bySido[s1].push(i); pol[i].lv = "광역"; return; }
  const s2 = sidoOf(p);
  if (s2 && bySido[s2]) { bySido[s2].push(i); pol[i].lv = "광역"; pol[i].w = 1; return; }

  if (CENTRAL.test(hayOf(p))) { central.push(i); pol[i].lv = "중앙"; return; }

  unmatched++; pol[i].lv = "미분류";
  if (unmatchedSample.length < 8) unmatchedSample.push(`${p.sprvsnInstCdNm || "?"} / ${p.plcyNm.slice(0, 24)}`);
});

/* ── 중복 레코드 병합 ──
   동일 정책이 여러 레코드로 올라와 있다. 「청년내일저축계좌 지원」은 4건(2025년분 잔존),
   쌍의 두 레코드가 서로 다른 aplyPrdSeCd 를 갖는 경우도 있다(하나는 마감, 하나는 특정기간).
   총건수를 근거로 쓰면 정정 대상이 되므로 병합한다.

   키: 정책명 + 귀속 지자체. 최종수정일이 늦은 것을 채택하고,
   상태 코드가 상충하면 **보수적으로 마감 쪽**을 택한다(열어놓는 오류가 더 위험하다). */
const ownerOf = i => {
  for (const [o, ids] of Object.entries(byOrg)) if (ids.includes(i)) return o;
  for (const [s, ids] of Object.entries(bySido)) if (ids.includes(i)) return s;
  return central.includes(i) ? "중앙" : "미분류";
};
const dupKey = new Map();
POL.rows.forEach((raw, i) => {
  const k = `${pol[i].n} ${ownerOf(i)}`;
  const cur = dupKey.get(k);
  const mod = String(raw.lastMdfcnDt || "");
  if (!cur) { dupKey.set(k, { keep: i, mod, all: [i] }); return; }
  cur.all.push(i);
  if (mod > cur.mod) { cur.keep = i; cur.mod = mod; }
});
let merged = 0, conflictState = 0;
const dropped = new Set();
for (const [, g] of dupKey) {
  if (g.all.length < 2) continue;
  merged += g.all.length - 1;
  /* 상태 상충 시 마감 우선 */
  const codes = new Set(g.all.map(i => pol[i].ac));
  if (codes.size > 1) {
    conflictState++;
    const closed = g.all.find(i => pol[i].ac === "3");
    if (closed != null) g.keep = closed;
    pol[g.keep].dupConflict = 1;
  }
  pol[g.keep].dup = g.all.length;
  g.all.filter(i => i !== g.keep).forEach(i => dropped.add(i));
}
/* 인덱스에서 중복분 제거 */
const prune = arr => arr.filter(i => !dropped.has(i));
for (const o of Object.keys(byOrg)) byOrg[o] = prune(byOrg[o]);
for (const s of Object.keys(bySido)) bySido[s] = prune(bySido[s]);
const centralPruned = prune(central);
central.length = 0; central.push(...centralPruned);

/* ── 등록률 — "없다" 와 "등록이 없다" 를 구분하기 위한 근거 ── */
const SELF_PORTAL = {
  "서울특별시": "청년몽땅정보통(youth.seoul.go.kr)",
  "경기도": "경기청년포털",
};
const registry = SIDO.map(s => ({
  s, n: regStat[s] || 0,
  own: (bySido[s] || []).length + BASIC.filter(b => b.sido === s).reduce((a, b) => a + (byOrg[b.full] || []).length, 0),
  portal: SELF_PORTAL[s] || null,
})).sort((a, b) => b.n - a.n);

/* ── 등록 노후도 ──
   양산 자체 9건이 전부 2024~2025년 신청기간이고 2026년 회차 등록이 없다.
   원본 기준으로는 「마감」이 맞지만 시청 공고로는 운영 중이다(청년날개 FIT).
   즉 "마감"이라 말하는 것도 거짓이 된다 — 갱신 안 됨을 드러내는 수밖에 없다. */
const staleness = {};
for (const o of orgs) {
  const ids = byOrg[o] || [];
  if (!ids.length) continue;
  const regs = ids.map(i => pol[i].r).filter(Boolean).sort();
  const aplys = ids.map(i => pol[i].ae || pol[i].pe).filter(Boolean).sort();
  const live = ids.filter(i => pol[i].ov !== 1).length;
  staleness[o] = {
    n: ids.length, live,
    lastReg: regs[regs.length - 1] || null,        // 최근 등록일
    lastApply: aplys[aplys.length - 1] || null,     // 가장 늦은 마감일
  };
}

const outPath = join(ROOT, "docs/data/policies-by-org.json");
writeFileSync(outPath, JSON.stringify({
  date: POL.snapshotDate, total: POL.rows.length, baseline: true,
  counts: { central: central.length, unmatched, codebook: Object.keys(book).length,
    records: POL.rows.length, unique: POL.rows.length - merged, merged, conflictState },
  registry, staleness,
  pol, central, bySido, byOrg,
}), "utf8");

const per = o => (byOrg[o]?.length || 0) + (bySido[o.split(" ")[0]]?.length || 0);
const ys = "경상남도 양산시";
console.log(`정책 원본 ${POL.rows.length}건 → 중복 병합 ${merged}건 제거 → 실질 ${POL.rows.length - merged}건`);
console.log(`  상태코드 상충 중복 ${conflictState}쌍 — 마감 쪽 채택`);
console.log(`  코드북 ${Object.keys(book).length}개 코드 역추출 (충돌 미채택 ${conflicts.length} · board 불일치 ${badBook.length})`);
console.log(`  중앙 ${central.length} · 광역 ${Object.values(bySido).flat().length} · 기초 ${Object.values(byOrg).flat().length} · 미분류 ${unmatched}`);
if (unmatched) console.log(`    미분류 예: ${unmatchedSample.slice(0, 3).join(" | ")}`);
console.log(`  자체 정책 있는 지자체 ${Object.values(byOrg).filter(v => v.length).length}/235`);
console.log(`  지원규모 확보 ${pol.filter(p => p.sc != null).length}건 · 선착순 표기 ${pol.filter(p => p.lm).length}건 · 담당자명 ${pol.filter(p => p.pic).length}건`);
console.log(`  ${ys} ${per(ys)}건 (자체 ${(byOrg[ys] || []).length})`);
console.log(`  ${(statSync(outPath).size / 1024 / 1024).toFixed(2)}MB → docs/data/policies-by-org.json`);
