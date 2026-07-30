/**
 * 직렬 감사 자료 생성 — 3단
 *
 *   node scripts/audit-chain.mjs 1     유형 정합성
 *   node scripts/audit-chain.mjs 2     귀속 정합성
 *   node scripts/audit-chain.mjs 3     상태 판정 + 종합
 *
 * 각 단계는 앞 단계의 결과 파일(work/audit/chain<N>.result.json)을 읽어
 * 이어받는다. 직렬이어야 뒤 단계가 앞의 발견을 전제로 더 깊이 볼 수 있다.
 *
 * 절대 규칙
 *  - 감사관에게 우리 판정과 원자료를 함께 준다. 우리 판정만 주면 추인이 된다.
 *  - 증거가 비면 파일을 쓰지 않는다(audit-prepare 와 같은 게이트).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = process.argv[2] || "1";
const D = JSON.parse(readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"));
const CP = JSON.parse(readFileSync(join(ROOT, "docs/data/compare.json"), "utf8"));
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));
mkdirSync(join(ROOT, "work/audit"), { recursive: true });

const prior = n => {
  const p = join(ROOT, `work/audit/chain${n}.result.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
};
const TARGET = "경상남도 양산시";
const write = (name, obj) => {
  const p = join(ROOT, `work/audit/${name}.json`);
  writeFileSync(p, JSON.stringify(obj, null, 1), "utf8");
  console.log(`  ${name}.json — 항목 ${obj.items?.length ?? 0}건`);
};

/* ═══════════ 1단 — 유형 정합성 ═══════════ */
if (stage === "1") {
  const mine = new Set(CP.orgTypes[TARGET] || []);
  const gaps = CP.types.filter(t => !mine.has(t.k));
  const myPolicies = (D.byOrg[TARGET] || []).map(i => ({
    정책명: D.pol[i].n, 유형서명: null, 상태: D.pol[i].ov === 1 ? "마감" : "진행",
    기관: D.pol[i].i, 신청기간: D.pol[i].ap || null, 사업종료: D.pol[i].pe || null,
  }));
  /* 서명을 정책명과 짝지어 준다 — 감사관이 대조할 수 있어야 한다 */
  const sigs = CP.orgTypes[TARGET] || [];

  write("chain1", {
    stage: 1, id: "유형정합성",
    question: `앱은 「${TARGET}에 없는 사업 유형」 ${gaps.length}종을 제시한다. 각각이 진짜 없는 것인가, 표기 차이로 갈라진 오탐인가?`,
    배경: [
      "유형은 정책명에서 지자체명·연도·괄호·공통어를 제거하고 남은 토큰을 정렬해 만든 '서명'이다.",
      "서명이 정확히 일치할 때만 같은 유형으로 본다. 그래서 토큰 하나만 달라도 다른 유형이 된다.",
      "브랜드명(예: 「청년날개 FIT」, 「드림옷장」)이 서명에 섞이는 것이 확인됐다.",
    ],
    criteria: [
      `아래 '${TARGET}_보유_유형서명' 과 '${TARGET}_자체정책_목록' 을 먼저 읽어라.`,
      "없는 유형 하나하나에 대해, 우리가 이미 같은 성격의 사업을 갖고 있는지 판단하라.",
      "이미 갖고 있으면 판정 `오탐`. 진짜 없으면 `진짜없음`. 판단이 어려우면 `불명`.",
      "성격이 같다는 것은 '지원 수단이 같다'는 뜻이다. 면접정장 대여와 면접비 현금 지원은 다른 사업이다 — 혼동하지 마라.",
      "여러 없는 유형이 서로 같은 사업을 가리키면(예: 월세 계열 3종) 그 사실도 적어라.",
    ],
    [`${TARGET}_보유_유형서명`]: sigs,
    [`${TARGET}_자체정책_목록`]: myPolicies,
    없는_유형_목록: gaps.map(t => ({
      유형서명: t.k, 채택_지자체수: t.n, 대표사례_정책명: t.label,
      채택_지자체: t.orgs.slice(0, 8),
    })),
    items: gaps.map(t => ({ 유형서명: t.k })),
    출력형식: `{"stage":1,"results":[{"유형서명":"...","판정":"오탐|진짜없음|불명","근거":"우리 시의 어떤 정책과 같은지 또는 왜 다른지","중복유형":["같은 사업을 가리키는 다른 서명"]}],"요약":"...","오탐율":"n/16"}`,
  });
}

/* ═══════════ 2단 — 귀속 정합성 ═══════════ */
if (stage === "2") {
  const p1 = prior(1);
  /* 기관명에 시군구가 들어 있는데 광역으로 분류된 건 = 오분류 의심 */
  const orgs = B.rows.map(r => r.o);
  const basics = orgs.filter(o => o.split(" ").length > 1).map(o => o.split(" ").slice(1).join(" "));
  const suspects = [];
  D.pol.forEach((p, i) => {
    const hay = `${p.n} | ${p.i}`;
    const hit = basics.filter(nm => nm.length >= 2 && hay.includes(nm));
    if (p.lv === "광역" && hit.length === 1) suspects.push({ 정책명: p.n, 기관: p.i, 우리판정: p.lv, 이름단서: hit[0], zip추정: p.w ? "zipCd 사용" : "기관명" });
    if (p.lv === "중앙" && hit.length === 1) suspects.push({ 정책명: p.n, 기관: p.i, 우리판정: p.lv, 이름단서: hit[0], zip추정: p.w ? "zipCd 사용" : "기관명" });
  });
  const sample = suspects.slice(0, 30);

  write("chain2", {
    stage: 2, id: "귀속정합성",
    question: "정책이 기초·광역·중앙 중 어디에 귀속됐는지 판정이 맞는가? 아래는 정책명이나 기관명에 시·군·구 이름이 있는데도 광역/중앙으로 분류된 건들이다.",
    앞단계_결과: p1 ? { 요약: p1.요약, 오탐율: p1.오탐율 } : "1단 결과 없음",
    배경: [
      "귀속은 ①기관명에 시군구명 → 기초 ②zipCd 코드북 → 기초 ③기관명에 시도명 → 광역 ④zipCd 시도 → 광역 순으로 판정한다.",
      "정책명은 단서로 쓰지 않는다. 이전 판에는 정책명 2차 단서가 있었는데 zipCd 로 교체하면서 빠졌다.",
      "귀속이 틀리면 「우리 시 정책」 목록과 「없는 정책」 비교가 함께 틀린다.",
    ],
    criteria: [
      "각 건이 실제로 어느 수준의 정책인지 정책명·기관명으로 판단하라.",
      "「아산시 청년정장 대여사업」처럼 정책명에 시명이 있으면 기초 정책일 가능성이 높다.",
      "다만 광역이 시군을 대행하거나 광역 사업을 시군이 집행하는 경우도 있다 — 단정하지 마라.",
      "판정: `기초여야함` / `광역맞음` / `중앙맞음` / `불명`.",
      "정책명을 귀속 단서로 되살려야 한다고 보면 그 근거와 위험(오탐 가능성)을 함께 적어라.",
    ],
    의심건: sample,
    items: sample.map(s => ({ 정책명: s.정책명 })),
    출력형식: `{"stage":2,"results":[{"정책명":"...","판정":"기초여야함|광역맞음|중앙맞음|불명","추정지자체":"충청남도 아산시 또는 null","근거":"..."}],"요약":"...","정책명_단서_복원_권고":"필요|불필요","위험":"..."}`,
  });
}

/* ═══════════ 3단 — 상태 판정 + 종합 ═══════════ */
if (stage === "3") {
  const p1 = prior(1), p2 = prior(2);
  /* 상시 플래그가 신청 마감을 덮은 건 */
  const TODAY = String(D.date).replace(/-/g, "");
  const conflict = D.pol
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.al && p.cl && p.cl < TODAY)
    .map(({ p }) => ({
      정책명: p.n, 기관: p.i, 우리표시: p.ov === 0 ? "신청 가능" : "마감",
      상시플래그: p.al ? "Y" : "N", 신청기간: p.ap || null, 사업종료: p.pe || null,
      계산된_마감일: p.cl, 마감사유: p.cr, 기간비고: p.pc || null,
    }));
  const sample = conflict.slice(0, 24);

  write("chain3", {
    stage: 3, id: "상태판정",
    question: `앱은 이 정책들을 「신청 가능」으로 표시한다. 그런데 신청기간이나 사업기간이 기준일(${D.date})보다 이전에 끝났다. 표시가 맞는가?`,
    앞단계_결과: {
      "1단_유형정합성": p1 ? { 요약: p1.요약, 오탐율: p1.오탐율 } : "없음",
      "2단_귀속정합성": p2 ? { 요약: p2.요약, 권고: p2.정책명_단서_복원_권고 } : "없음",
    },
    배경: [
      "마감 판정은 신청 마감(aplyYmd 끝날)과 사업 종료(bizPrdEndYmd) 중 먼저 닫히는 쪽을 본다.",
      "단 기간 비고(bizPrdEtcCn)나 신청기간에 '상시·수시·연중' 이 있으면 마감 없음으로 보고 진행 중으로 표시한다.",
      "그래서 '연중' 이라고 적혀 있으면서 2025년 신청기간이 명시된 정책이 지금도 신청 가능으로 나온다.",
    ],
    criteria: [
      "각 건에서 '상시·연중' 표기와 명시된 신청기간 중 무엇을 우선해야 하는지 판단하라.",
      "'연중'은 사업 운영이 연중이라는 뜻이고 신청 접수가 연중이라는 뜻이 아닐 수 있다 — 구분하라.",
      "판정: `마감으로_봐야함` / `진행_맞음` / `불명`.",
      "규칙을 어떻게 고쳐야 하는지 한 문장으로 제안하라(예: 명시된 신청 마감일이 있으면 상시 플래그를 무시).",
    ],
    상시_마감_충돌건: sample,
    items: sample.map(s => ({ 정책명: s.정책명 })),
    종합_질문: "1~3단 결과를 합쳐, 이 앱이 지금 사용자에게 사실과 다르게 말하는 지점을 심각도 순으로 정리하라. 정책단원이 회의에서 이 자료를 쓰다가 반박당할 수 있는 지점을 우선하라.",
    출력형식: `{"stage":3,"results":[{"정책명":"...","판정":"마감으로_봐야함|진행_맞음|불명","근거":"..."}],"규칙_수정_제안":"...","요약":"...","종합_심각도순":[{"문제":"...","심각도":"치명|높음|중간","영향":"...","조치":"..."}]}`,
  });
}

console.log("생성 완료");
