/**
 * 양산시 청년가까e 전수 수집
 *
 *   node scripts/collect-yangsan.mjs           전체 수집
 *   node scripts/collect-yangsan.mjs --probe   1페이지만 (구조 진단)
 *
 * ── 왜 이 소스인가 ────────────────────────────────────────────────
 * 온통청년의 양산 자체 등록은 9건이고 **전부 마감**이다(2025-11 일괄 등록 후 방치).
 * 같은 시점 청년가까e 에는 118건이 있고 실제로 접수중인 사업이 있다.
 * 즉 온통청년 데이터는 「양산 현황」이라는 주장에 대해 이미 반증됐다.
 *
 *   양산 현황  → 청년가까e (이 파일)      「없다」 주장 가능 — 시 공식 채널
 *   법적 근거  → 법제처 조례              가능
 *   타시도 소재 → 온통청년                 불가 — 자발 등록
 *
 * ── 엔드포인트 (2026-07-31 실측) ───────────────────────────────────
 *   목록  POST /youth/plcyPrgrm/search/list.do?mid=0201000000   body: page=N
 *         → div.bod_cardList li  ·  총건수는 p.page_num
 *   상세  POST /youth/plcyPrgrm/search/detail.do?mid=0201000000 body: plcyId=N
 *         → table.tbl.detail 의 th/td 쌍
 *   신청  GET  /youth/plcyPrgrm/list.do?mid=0202000000          body: page=N
 *         → 접수기간 + 신청현황(신청자/정원). 온통청년에 **없는 축**이다.
 *
 * ── robots.txt (2026-07-31 확인) ──────────────────────────────────
 *   /youth/plcyPrgrm/  허용   ← 여기만 긁는다
 *   /youth/board/post  차단   ← 공고문 본문. URL 만 저장하고 **가져오지 않는다**
 *
 * 출력  data/YYYYMMDD수집_양산청년정책_전수.json  (append-only, 덮어쓰지 않음)
 *
 * 절대 규칙
 *  - 상태는 `data-state` 원본 값만 쓴다. 날짜를 읽어 추론하지 않는다(원칙 3).
 *  - 못 찾은 값은 null. 빈 문자열로 채우지 않는다(원칙 5).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "https://www.yangsan.go.kr";
const LIST = `${HOST}/youth/plcyPrgrm/search/list.do?mid=0201000000`;
const DETAIL = `${HOST}/youth/plcyPrgrm/search/detail.do?mid=0201000000`;
const APPLY = `${HOST}/youth/plcyPrgrm/list.do?mid=0202000000`;
const DELAY = 400;
const PROBE = process.argv.includes("--probe");
const DATE = new Date().toISOString().slice(0, 10);
const STAMP = DATE.replace(/-/g, "");

const sleep = ms => new Promise(r => setTimeout(r, ms));
const txt = el => (el?.textContent || "").replace(/ /g, " ").trim();
/** <br> 를 줄바꿈으로 살린 본문. innerHTML 을 거쳐야 단락이 안 뭉개진다. */
const rich = el => {
  if (!el) return null;
  const s = el.innerHTML
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/ /g, " ");
  const d = new JSDOM(`<!doctype html><body>${s.replace(/&/g, "&amp;").replace(/&amp;(#?\w+);/g, "&$1;")}</body>`);
  return txt(d.window.document.body).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") || null;
};

let reqs = 0;
async function post(url, body) {
  reqs++;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      /* 헤더는 ByteString 이라 한글을 넣으면 fetch 가 던진다 — ASCII 만 */
      "User-Agent": "youth-ordinance-map/1.0 (Yangsan youth policy council; data collection)",
      "Referer": LIST,
    },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return new JSDOM(await res.text()).window.document;
}

/* ── 목록 ── */
function parseRows(doc) {
  return [...doc.querySelectorAll(".bod_cardList li .item")].map(it => {
    const btn = it.querySelector("[onclick^='customSearch.detail']");
    /* id 는 두 종류다. 숫자(190)는 시가 직접 등록한 것, `R2024092626731` 은
       **온통청년에서 끌어온 미러**다. 숫자만 받는 정규식이 후자를 통째로 버렸다.
       미러는 상태 배지도 정책기간도 비어 있어 「양산 현황」의 근거가 못 된다 —
       버리지 말고 구분해서 담는다. */
    const id = (btn?.getAttribute("onclick") || "").match(/detail\('([^']+)'\)/)?.[1] || null;
    const stEl = it.querySelector(".state");
    const info = {};
    for (const li of it.querySelectorAll(".info li")) {
      const k = txt(li.querySelector("strong"));
      const v = txt(li.querySelector("span"));
      if (k) info[k] = v || null;
    }
    return {
      id,
      /* self  = 시가 직접 등록 (상태·정원 확보 가능)
         ontong = 온통청년 미러 (상태 없음 — 현황 근거로 쓰면 안 된다) */
      origin: id ? (/^\d+$/.test(id) ? "self" : "ontong") : null,
      nm: txt(it.querySelector(".subj")) || null,
      /* 원본 권위 필드 — 화면 문구(신청예정)와 코드값(접수예정)이 다르다. 둘 다 남긴다. */
      state: stEl?.getAttribute("data-state") || null,
      stateLabel: txt(stEl) || null,
      field: it.querySelector(".badge")?.getAttribute("data-item") || null,
      period: info["정책기간"] ?? null,
      org: info["운영기관"] ?? null,
    };
  });
}
/**
 * 총건수·총페이지. **두 목록의 문구 형식이 다르다.**
 *   정책 목록  「총 <em>118</em>건의 게시물이 있습니다. (<em>1</em> / 14 페이지)」
 *   신청 목록  「현재 페이지 <em>1</em> / 전체 페이지 4」          ← 건수가 없다
 * 앞 형식만 보던 판은 신청 목록을 1페이지로 읽어 6건에서 멈췄다.
 */
const totalOf = doc => {
  const s = txt(doc.querySelector(".page_num"));
  const pages = +(s.match(/\/\s*(\d+)\s*페이지/) || s.match(/전체\s*페이지\s*(\d+)/) || [])[1] || 1;
  return { count: +(s.match(/총\s*([\d,]+)\s*건/) || [])[1]?.replace(/,/g, "") || 0, pages };
};

/* ── 상세 ── */
const DETAIL_KEYS = ["지원내용", "사업기간", "신청기간", "신청안내", "운영기관", "주관기관", "신청사이트"];
async function fetchDetail(id) {
  const doc = await post(DETAIL, `plcyId=${encodeURIComponent(id)}`);
  const tbl = doc.querySelector("table.tbl.detail");
  if (!tbl) return null;
  const out = {};
  for (const tr of tbl.querySelectorAll("tr")) {
    const k = txt(tr.querySelector("th"));
    const td = tr.querySelector("td");
    if (!k) continue;
    out[k] = k === "신청사이트" ? (td?.querySelector("a")?.getAttribute("href") || null) : rich(td);
  }
  for (const k of DETAIL_KEYS) if (!(k in out)) out[k] = null;
  return out;
}

/* ── 온라인신청 목록 — 정원 대비 신청자. 온통청년에 없는 축이다. ── */
async function fetchApply() {
  const rows = [];
  let page = 1, pages = 1;
  do {
    const doc = await post(APPLY, `page=${page}`);
    ({ pages } = totalOf(doc));
    /* 신청 목록은 컨테이너가 .bod_cardThumb 다 (정책 목록은 .bod_cardList).
       자식 li 로 한정하지 않으면 카드 안 .info li 까지 잡혀 3배로 부푼다. */
    for (const li of doc.querySelectorAll(".bod_cardThumb > ul > li")) {
      const id = (li.getAttribute("onclick") || "").match(/view\((\d+)/)?.[1] || null;
      const info = {};
      for (const x of li.querySelectorAll(".info li")) info[txt(x.querySelector("strong"))] = txt(x.querySelector("span"));
      const cap = (info["신청현황"] || "").match(/(\d+)\s*\/\s*(\d+)/);
      const per = (info["접수기간"] || "").match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
      rows.push({
        id,
        nm: txt(li.querySelector(".subj")) || null,
        state: li.querySelector(".state")?.getAttribute("data-state") || null,
        from: per?.[1] || null,
        to: per?.[2] || null,
        applied: cap ? +cap[1] : null,
        capacity: cap ? +cap[2] : null,
      });
    }
    page++;
    if (PROBE) break;
    if (page <= pages) await sleep(DELAY);
  } while (page <= pages);
  return rows;
}

/* ── main ── */
console.log(`양산시 청년가까e 수집 — ${DATE}`);

const first = await post(LIST, "page=1");
const { count, pages } = totalOf(first);
console.log(`  목록 ${count}건 · ${pages}페이지`);

const rows = parseRows(first);
if (!PROBE) {
  for (let p = 2; p <= pages; p++) {
    await sleep(DELAY);
    rows.push(...parseRows(await post(LIST, `page=${p}`)));
    process.stdout.write(`\r  목록 수집 ${rows.length}/${count}`);
  }
  process.stdout.write("\n");
}
if (!rows.length) { console.error("목록을 한 건도 못 읽었습니다 — 사이트 구조가 바뀌었을 수 있습니다."); process.exit(1); }

const ids = [...new Set(rows.map(r => r.id).filter(Boolean))];
console.log(`  상세 ${ids.length}건 수집`);
const details = {};
for (const [n, id] of ids.entries()) {
  await sleep(DELAY);
  try { details[id] = await fetchDetail(id); }
  catch (e) { details[id] = null; console.warn(`\n  상세 실패 ${id}: ${e.message}`); }
  process.stdout.write(`\r  상세 ${n + 1}/${ids.length}`);
  if (PROBE && n >= 2) break;
}
process.stdout.write("\n");

console.log("  온라인신청 현황 수집");
const apply = await fetchApply();
console.log(`  신청 ${apply.length}건 · 정원 확보 ${apply.filter(a => a.capacity != null).length}건`);

const byId = Object.fromEntries(apply.filter(a => a.id).map(a => [a.id, a]));
const policies = rows.map(r => ({ ...r, detail: details[r.id] ?? null, apply: byId[r.id] ?? null }));

const stTally = policies.reduce((a, p) => (a[p.state || "미상"] = (a[p.state || "미상"] || 0) + 1, a), {});
console.log(`\n  상태: ${JSON.stringify(stTally)}`);
console.log(`  상세 확보 ${policies.filter(p => p.detail).length}/${policies.length}`);
console.log(`  신청현황 연결 ${policies.filter(p => p.apply).length}건`);

const out = {
  source: "양산시 청년가까e",
  home: `${HOST}/youth/main.do`,
  collectedAt: new Date().toISOString(),
  date: DATE,
  total: count,
  pages,
  requests: reqs,
  note: "상태는 사이트의 data-state 원본값. 공고문 본문은 robots.txt 차단이라 URL 만 보관한다.",
  policies,
  apply,
};

mkdirSync(join(ROOT, "data"), { recursive: true });
const file = join(ROOT, "data", `${STAMP}수집_양산청년정책_전수.json`);
if (existsSync(file) && !PROBE) console.log(`  기존 스냅샷 덮어씀: ${file}`);
writeFileSync(file, JSON.stringify(out, null, PROBE ? 2 : 0), "utf8");
console.log(`\n  ${(Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0)}KB → ${file.replace(ROOT + "\\", "").replace(ROOT + "/", "")}`);
if (PROBE) console.log(JSON.stringify(policies.slice(0, 2), null, 2));
