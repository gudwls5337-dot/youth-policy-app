/**
 * 청년 조례 스냅샷 수집기
 *
 * 법제처 Open API(/DRF/)로 이름에 "청년"이 들어간 자치법규를 전수 수집한다.
 * OC=test 로 인증 없이 열리고 정적이라 키가 필요 없다.
 *
 *   node scripts/snapshot-ordinances.mjs
 *
 * 출력
 *   data/YYYYMMDD수집_청년자치법규_전수.json   원응답 정규화본 (append-only, 덮어쓰지 않음)
 *   work/YYYYMMDD_기본조례_후보.json           지자체별 "청년 기본 조례" 판정 결과
 *
 * 절대 규칙(CLAUDE.md §4): 매칭 실패는 누락 처리하지 않고 `미상`으로 남긴다.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://www.law.go.kr/DRF/lawSearch.do";
const PAGE_SIZE = 100;
const SNAPSHOT_DATE = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const STAMP = SNAPSHOT_DATE.replace(/-/g, "");

/* ── XML 파싱: 응답 구조가 단순 평면이라 정규식으로 충분하다 ── */
const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${tag}>`));
  return m ? m[1].trim() : "";
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(page) {
  const url = `${BASE}?OC=test&target=ordin&query=${encodeURIComponent("청년")}&type=XML&display=${PAGE_SIZE}&page=${page}`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      if (!xml.includes("<OrdinSearch>")) throw new Error("unexpected body");
      return xml;
    } catch (e) {
      if (attempt === 4) throw e;
      console.warn(`  page ${page} 재시도 ${attempt} — ${e.message}`);
      await sleep(1200 * attempt);
    }
  }
}

function parse(xml) {
  return [...xml.matchAll(/<law id="\d+">([\s\S]*?)<\/law>/g)].map(([, b]) => ({
    mst:      pick(b, "자치법규일련번호"),
    name:     pick(b, "자치법규명"),
    lawId:    pick(b, "자치법규ID"),
    org:      pick(b, "지자체기관명"),
    kind:     pick(b, "자치법규종류"),
    promulgated: pick(b, "공포일자"),
    effective:   pick(b, "시행일자"),
    revision:    pick(b, "제개정구분명"),
    category:    pick(b, "자치법규분야명"),
  }));
}

/* ── "청년 기본 조례" 판정 ──
   조례명이 통일돼 있지 않다. 「가평군 청년기본소득 지급 조례」와
   「가평군 청년정책 및 지원에 관한 기본 조례」가 같은 검색어에 걸린다.        */
const EXCLUDE = /기본소득|배당|수당|적금|통장|공제|장려금|바우처|주택|임대|창업|농(업|어)(인|업)|일자리|취업|문화의\s*집|센터|재단|기금|축제|위원회\s*설치|아카데미|몰\b/;
const STRONG  = /청년\s*기본\s*조례$/;
const MEDIUM  = /청년(정책)?.*(기본\s*조례|지원.*기본|육성.*기본)/;
const WEAK    = /청년.*(정책|지원|육성).*조례$/;

function classify(name) {
  if (EXCLUDE.test(name)) return 0;
  if (STRONG.test(name)) return 3;
  if (MEDIUM.test(name)) return 2;
  if (WEAK.test(name)) return 1;
  return 0;
}

async function main() {
  console.log(`청년 자치법규 전수 수집 — 기준일 ${SNAPSHOT_DATE}`);

  const first = await fetchPage(1);
  const total = +(first.match(/<totalCnt>(\d+)<\/totalCnt>/)?.[1] ?? 0);
  const pages = Math.ceil(total / PAGE_SIZE);
  console.log(`총 ${total}건 · ${pages}페이지`);

  const rows = parse(first);
  for (let p = 2; p <= pages; p++) {
    process.stdout.write(`\r  수집 ${p}/${pages}`);
    rows.push(...parse(await fetchPage(p)));
    await sleep(250); // 공공 API 예의
  }
  console.log(`\r  수집 완료 — ${rows.length}건 파싱`);

  /* 지자체별 기본 조례 후보 판정 */
  const byOrg = new Map();
  for (const r of rows) {
    if (r.kind !== "조례" || !r.org) continue;
    const score = classify(r.name);
    if (!score) continue;
    const cur = byOrg.get(r.org);
    // 점수 우선, 동점이면 최근 공포 우선
    if (!cur || score > cur.score || (score === cur.score && r.promulgated > cur.row.promulgated)) {
      byOrg.set(r.org, { score, row: r });
    }
  }

  const candidates = [...byOrg.entries()]
    .map(([org, { score, row }]) => ({
      org,
      confidence: { 3: "높음", 2: "보통", 1: "낮음" }[score],
      name: row.name,
      mst: row.mst,
      promulgated: row.promulgated,
      effective: row.effective,
      revision: row.revision,
      sourceUrl: `https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${row.mst}&type=HTML`,
    }))
    .sort((a, b) => a.org.localeCompare(b.org, "ko"));

  mkdirSync(join(ROOT, "data"), { recursive: true });
  mkdirSync(join(ROOT, "work"), { recursive: true });

  const rawPath = join(ROOT, "data", `${STAMP}수집_청년자치법규_전수.json`);
  writeFileSync(rawPath, JSON.stringify({
    snapshotDate: SNAPSHOT_DATE,
    source: "법제처 Open API /DRF/lawSearch.do (target=ordin, query=청년)",
    totalCount: total,
    fetched: rows.length,
    rows,
  }, null, 2), "utf8");

  const candPath = join(ROOT, "work", `${STAMP}_기본조례_후보.json`);
  writeFileSync(candPath, JSON.stringify({
    snapshotDate: SNAPSHOT_DATE,
    note: "지자체별 '청년 기본 조례' 자동 판정. confidence=낮음 은 반드시 사람이 원문 대조할 것.",
    orgCount: candidates.length,
    candidates,
  }, null, 2), "utf8");

  /* 요약 */
  const conf = candidates.reduce((a, c) => (a[c.confidence] = (a[c.confidence] || 0) + 1, a), {});
  const LAW = "20200805"; // 청년기본법 시행
  const stale = candidates.filter((c) => c.promulgated && c.promulgated < LAW);

  console.log(`\n지자체 ${candidates.length}곳 판정`);
  console.log(`  신뢰도  높음 ${conf["높음"] || 0} · 보통 ${conf["보통"] || 0} · 낮음 ${conf["낮음"] || 0}`);
  console.log(`  청년기본법(2020-08-05) 이후 공포 이력 없음: ${stale.length}곳`);
  console.log(`\n  ${rawPath}`);
  console.log(`  ${candPath}`);
}

main().catch((e) => { console.error("실패:", e); process.exit(1); });
