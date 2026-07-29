/**
 * 조례 본문에서 청년 연령 정의 · 담당부서 · 전화번호 추출
 *
 *   node scripts/extract-definitions.mjs
 *
 * 입력  docs/data/ordinances.json  (snapshot-ordinances.mjs 산출)
 * 출력  docs/data/definitions.json
 *
 * 절대 규칙(CLAUDE.md §4)
 *  - 정의 조문 번호를 고정하지 않는다. 양산시는 제3조, 다수는 제2조다.
 *  - 파싱 실패는 0이나 추정치로 채우지 않고 min/max=null 로 남긴다.
 *  - 추출한 원문 문장을 그대로 보관한다. 사람이 대조할 수 있어야 한다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DATE = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdata = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? cdata(m[1]) : "";
};

/* 연령 표기 변형 — 실측 기반. 새 변형이 나오면 여기에만 추가한다. */
const AGE_PATTERNS = [
  /만?\s*(\d{1,2})\s*세\s*이상\s*(?:부터\s*)?만?\s*(\d{1,2})\s*세\s*이하/,
  /(\d{1,2})\s*세\s*이상\s*(\d{1,2})\s*세\s*이하의?\s*사람/,
  /만?\s*(\d{1,2})\s*세\s*이상\s*만?\s*(\d{1,2})\s*세\s*미만/,
  /(\d{1,2})\s*세\s*부터\s*(\d{1,2})\s*세\s*까지/,
  /(\d{1,2})\s*세\s*~\s*(\d{1,2})\s*세/,
  /(\d{1,2})\s*세\s*이상\s*(\d{1,2})\s*세\s*이하/,
];

function parseAge(text) {
  for (const re of AGE_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    let [, lo, hi] = m.map(Number);
    if (re.source.includes("미만")) hi -= 1;      // "40세 미만" → 39세 이하
    if (lo >= 10 && lo <= 30 && hi >= lo && hi <= 60) return { min: lo, max: hi };
  }
  return null;
}

/* 정의 조문에서 "청년"을 정의하는 문장만 잘라낸다 */
function youthSentence(body) {
  const flat = body.replace(/\s+/g, " ");
  /* 「적용대상」 조처럼 '청년이란' 표현이 없는 경우 — 연령이 있는 문장을 그대로 쓴다 */
  if (!/["“']?청년["”']?\s*(?:이란|이라 함은|의 범위는)/.test(flat)) {
    const m = flat.match(/[^.]{0,80}\d{1,2}\s*세\s*이상[^.]{0,120}/);
    if (m) return m[0].trim();
  }
  /* "청년정책"·"청년단체" 같은 파생어가 앞에 오는 조례가 많다.
     정확히 「청년」만 정의하는 호를 찾는다 — 뒤에 다른 글자가 붙으면 안 된다. */
  const exact = flat.match(/["“']청년["”']\s*(?:이란|이라 함은|의 범위는|은)[^]{0,160}/);
  if (exact) return exact[0].trim();
  const loose = flat.match(/청년\s*(?:이란|이라 함은|의 범위는)[^]{0,160}/);
  if (loose) return loose[0].trim();
  return flat.slice(0, 300);
}

async function fetchBody(mst) {
  const url = `https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${mst}&type=XML`;
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const x = await res.text();
      if (!x.includes("<LawService>")) throw new Error("unexpected body");
      return x;
    } catch (e) {
      if (a === 3) return null;
      await sleep(900 * a);
    }
  }
}

function extract(xml) {
  const dept = pick(xml, "담당부서명");
  const tel = pick(xml, "전화번호");

  /* 조문 순회 — 조제목이 '정의'인 조를 우선, 없으면 '청년'을 정의하는 조를 찾는다 */
  const arts = [...xml.matchAll(/<조\s[^>]*>([\s\S]*?)<\/조>/g)].map(([, b]) => ({
    no: pick(b, "조문번호"),
    title: pick(b, "조제목"),
    body: pick(b, "조내용"),
  }));

  /* 연령이 어디 적혀 있는지는 조례마다 다르다. 우선순위대로 훑는다.
     (2026-07-29 감사에서 발견: 대전 동구·서구, 서울 구로구, 광주 동구는
      「청년」 정의항이 아예 없고 연령이 「적용대상」 조에 있었다.
      정의 조만 보던 이전 판은 이 패턴을 통째로 놓쳤다.) */
  const hasAge = a => parseAge(youthSentence(a.body)) || parseAge(a.body);
  const near = a => {                       // 청년과 연령표기가 같은 문맥에 있는가
    const f = a.body.replace(/\s+/g, " ");
    return /청년[^]{0,60}\d{1,2}\s*세\s*이상/.test(f) || /\d{1,2}\s*세\s*이상[^]{0,60}청년/.test(f);
  };

  const candidates = [
    ...arts.filter(a => /정의|용어/.test(a.title)),
    ...arts.filter(a => /적용\s*(대상|범위)|대상/.test(a.title)),
    ...arts.filter(a => /"?청년"?\s*(이란|이라 함은)/.test(a.body.replace(/\s+/g, " "))),
    ...arts.filter(near),
  ];

  let art = null, age = null;
  for (const a of candidates) {
    const got = hasAge(a);
    if (got) { art = a; age = got; break; }
  }
  /* 연령을 못 찾았으면 인용문만이라도 정의 조에서 뽑아 둔다 */
  if (!art) art = arts.find(a => /정의|용어/.test(a.title)) || arts[0];
  if (!art) return { dept, tel, min: null, max: null, article: null, quote: null };

  const sentence = youthSentence(art.body);
  const artNo = art.no ? `제${parseInt(art.no.slice(0, 4), 10)}조` : null;

  return {
    dept, tel,
    min: age?.min ?? null,
    max: age?.max ?? null,
    article: artNo,
    quote: sentence,
  };
}

async function main() {
  const snap = JSON.parse(readFileSync(join(ROOT, "docs/data/ordinances.json"), "utf8"));
  const rows = snap.rows;
  console.log(`조례 본문 추출 — ${rows.length}건`);

  const out = [];
  let ok = 0, noAge = 0, failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    process.stdout.write(`\r  ${i + 1}/${rows.length}  성공 ${ok} · 연령미상 ${noAge} · 실패 ${failed}   `);
    const xml = await fetchBody(r.m);
    if (!xml) { failed++; out.push({ ...r, min: null, max: null, err: "fetch" }); await sleep(200); continue; }
    const e = extract(xml);
    if (e.min == null) noAge++; else ok++;
    out.push({ ...r, ...e });
    await sleep(220);
  }
  console.log("");

  const path = join(ROOT, "docs/data/definitions.json");
  writeFileSync(path, JSON.stringify({
    snapshotDate: SNAPSHOT_DATE,
    source: "법제처 Open API /DRF/lawService.do (target=ordin)",
    note: "min/max=null 은 자동 추출 실패. 추정치로 채우지 않았다. quote 는 원문 대조용.",
    counts: { total: rows.length, parsed: ok, ageUnknown: noAge, fetchFailed: failed },
    rows: out,
  }), "utf8");

  /* 요약 */
  const dist = {};
  out.filter((r) => r.max).forEach((r) => { dist[r.max] = (dist[r.max] || 0) + 1; });
  const withTel = out.filter((r) => r.tel).length;

  console.log(`\n연령 추출 성공 ${ok} / ${rows.length}  (${(ok / rows.length * 100).toFixed(1)}%)`);
  console.log(`전화번호 확보 ${withTel}곳`);
  console.log("상한 분포:", Object.entries(dist).sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}세 ${v}곳`).join(" · "));
  console.log(`\n  ${path}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
