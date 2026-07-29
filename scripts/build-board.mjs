/**
 * definitions.json → docs/data/board.json  (대시보드용 압축본)
 *
 *   node scripts/build-board.mjs
 *
 * 여기서 두 가지를 바로잡는다.
 *
 * 1) 인용문
 *    이전 판은 "말한다 / 한다." 를 만나면 잘랐다. 그런데 조례에 흔한
 *    「순창군(이하“군”이라 한다.)에 주소를 두고 …」 같은 삽입구 때문에
 *    연령이 나오기도 전에 잘리는 사례가 있었다(전북 순창군).
 *    → 규칙을 뒤집는다. **인용문은 반드시 저장된 연령 두 숫자를 포함해야 한다.**
 *      포함할 때까지 늘리고, 끝내 못 담으면 원문 앞부분을 그대로 둔다.
 *
 * 2) 전화번호
 *    조례 메타데이터에 지역번호 없이 국번만 적힌 곳이 44곳 있다("650-1562").
 *    tel: 링크가 연결되지 않으므로 시도별 지역번호를 붙인다.
 *    단 광주·전남 통합 기관은 062/061 이 갈려 추론이 불가능하므로 손대지 않고
 *    `tf`(전화 불완전) 플래그만 세운다. 추측해서 잘못된 번호를 만들지 않는다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normTel, TEL_RE } from "./lib/normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const D = JSON.parse(readFileSync(join(ROOT, "docs/data/definitions.json"), "utf8"));

/* 신뢰도는 후보 판정 단계에만 있다. definitions.json 에서는 `c` 필드가
   조문번호로 덮어써지면서 유실됐다 — 원본에서 다시 붙인다.
   (2026-07-29 검증에서 발견. 조용히 사라지는 종류의 결손이라 검사도 추가했다.) */
const CAND = JSON.parse(readFileSync(join(ROOT, "work/20260729_기본조례_후보.json"), "utf8"));
const confOf = new Map(CAND.candidates.map(c => [c.org, c.confidence]));

/** 인용문: 반드시 min·max 두 숫자를 포함하도록 잘라낸다 */
function makeQuote(raw, min, max) {
  const flat = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  if (min == null) return flat.slice(0, 130);

  const a = String(min), b = String(max);
  const start = Math.max(0, flat.search(/["“']?청년["”']?\s*(?:이란|이라 함은|의 범위는)/));
  const body = flat.slice(start);

  /* 두 숫자를 모두 담는 최소 길이를 찾는다 (최대 260자) */
  for (const len of [130, 170, 210, 260]) {
    const cut = body.slice(0, len);
    if (cut.includes(a) && cut.includes(b)) {
      /* 문장 경계에서 다듬되, 숫자를 잃지 않는 선에서만 */
      const trimmed = cut.replace(/\s*\d+\s*\.\s*["“']?청년(정책|단체|활동|시설|공간)[\s\S]*$/, "");
      return (trimmed.includes(a) && trimmed.includes(b) ? trimmed : cut).trim();
    }
  }
  return body.slice(0, 260).trim();
}

const rows = D.rows.map(r => {
  const [tel, telOk] = normTel(r.tel, r.o);
  const row = {
    o: r.o, n: r.n, p: r.p, m: r.m,
    a: r.min, b: r.max,
    c: r.article || "",
    d: r.dept || "",
    t: tel,
    q: makeQuote(r.quote, r.min, r.max),
    k: confOf.get(r.o) === "보통" ? 2 : 1,
  };
  if (!telOk && tel) row.tf = 1;           // 지역번호 미상 — 화면에서 안내
  return row;
});

const hi = {}, lo = {};
rows.forEach(r => { if (r.b) { hi[r.b] = (hi[r.b] || 0) + 1; lo[r.a] = (lo[r.a] || 0) + 1; } });

writeFileSync(join(ROOT, "docs/data/board.json"), JSON.stringify({
  date: D.snapshotDate, total: 1419, orgs: rows.length,
  parsed: rows.filter(r => r.b).length, hi, lo, rows,
}), "utf8");

/* 자체 점검 */
const withAge = rows.filter(r => r.a != null);
const badQuote = withAge.filter(r => r.q && !(r.q.includes(String(r.a)) && r.q.includes(String(r.b))));
const badTel = rows.filter(r => r.t && !/^0\d{1,2}-(?:\d{3,4}-\d{4}|1\d{2})$/.test(r.t));
console.log(`board.json — ${rows.length}곳 · 연령 ${withAge.length} · 전화 ${rows.filter(r => r.t).length}`);
console.log(`  인용문에 연령 누락: ${badQuote.length}건${badQuote.length ? " → " + badQuote.map(r => r.o).slice(0, 5).join(", ") : ""}`);
console.log(`  전화 형식 미준수: ${badTel.length}건${badTel.length ? " → " + badTel.map(r => r.o + ":" + r.t).slice(0, 5).join(", ") : ""}`);
console.log(`  지역번호 추론 불가(tf): ${rows.filter(r => r.tf).length}건`);
