/**
 * 양산시 청년 관련 조례 **전문** 수집
 *
 *   node scripts/collect-yangsan-ordinances.mjs
 *
 * 왜 따로 받는가
 *   기존 governance.json 은 5지표(위원회·참여기구·정기회·정원·청년비율·기본계획)만
 *   뽑아 두고 조문 본문은 버린다. 「정책을 눌렀을 때 근거 조문을 보여준다」(요구 4)는
 *   조제목만으로는 못 한다 — 본문이 있어야 인용할 수 있다(원칙 4).
 *   대상이 양산 8건뿐이라 전문을 통째로 캐시해도 부담이 없다.
 *
 * 출력  data/YYYYMMDD수집_양산조례_조문.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchBody, articles, pick } from "./lib/law.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATE = new Date().toISOString().slice(0, 10);
const STAMP = DATE.replace(/-/g, "");
const sleep = ms => new Promise(r => setTimeout(r, ms));

const RAW = JSON.parse(readFileSync(join(ROOT, "data/20260729수집_청년자치법규_전수.json"), "utf8"));
const rows = (Array.isArray(RAW) ? RAW : RAW.rows || RAW.list || Object.values(RAW)[0]) || [];
const mine = rows.filter(r => String(r.org || "").includes("양산") || String(r.name || "").startsWith("양산시"));

console.log(`양산 청년 조례 ${mine.length}건 전문 수집 — ${DATE}`);
if (!mine.length) { console.error("대상 조례를 못 찾았습니다."); process.exit(1); }

const out = [];
for (const r of mine) {
  await sleep(500);
  const xml = await fetchBody(r.mst);
  if (!xml) { console.warn(`  실패 ${r.name}`); out.push({ ...r, arts: null, dept: null, tel: null }); continue; }
  const arts = articles(xml).filter(a => a.label);
  out.push({
    mst: r.mst, lawId: r.lawId, name: r.name, kind: r.kind,
    promulgated: r.promulgated, effective: r.effective, revision: r.revision,
    dept: pick(xml, "담당부서명") || null,
    tel: pick(xml, "전화번호") || null,
    /* 조문은 번호·제목·본문을 전부 남긴다. 인용 없는 판정은 검증이 안 된다(원칙 4). */
    arts: arts.map(a => ({ label: a.label, title: a.title || null, body: a.body || null })),
  });
  console.log(`  ${r.name} — 조문 ${arts.length}개 · ${pick(xml, "담당부서명") || "부서 미상"}`);
}

const doc = {
  source: "법제처 국가법령정보센터 (target=ordin)",
  city: "경상남도 양산시",
  date: DATE,
  count: out.length,
  ordinances: out,
};
mkdirSync(join(ROOT, "data"), { recursive: true });
const file = join(ROOT, "data", `${STAMP}수집_양산조례_조문.json`);
writeFileSync(file, JSON.stringify(doc, null, 0), "utf8");
console.log(`\n  조문 합계 ${out.reduce((n, o) => n + (o.arts?.length || 0), 0)}개`);
console.log(`  ${(Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0)}KB → data/${STAMP}수집_양산조례_조문.json`);
