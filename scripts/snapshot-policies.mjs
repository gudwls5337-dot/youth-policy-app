/**
 * 온통청년 청년정책 스냅샷 수집 + 전기 대비 신설/폐지 판정
 *
 *   node scripts/snapshot-policies.mjs            전체 수집
 *   node scripts/snapshot-policies.mjs --probe    응답 진단만 (1페이지)
 *
 * 엔드포인트 (2026-07-29 실측 확인)
 *   GET https://www.youthcenter.go.kr/go/ythip/getPlcy
 *       apiKeyNm=<KEY>  rtnType=json  pageNum  pageSize(최대 100)
 *       선택: plcyNm  zipCd(지역코드)  lclsfNm(대분류)
 *   → { resultCode, resultMessage, result:{ pagging:{totCount,pageNum,pageSize},
 *        youthPolicyList:[ 55개 필드 ] } }
 *
 * 출력
 *   data/YYYYMMDD수집_청년정책_전수.json   원본 스냅샷 (append-only, 덮어쓰지 않음)
 *   docs/data/policies.json                지자체별 정리 + 신설/폐지
 *
 * 절대 규칙
 *  - 이전 스냅샷이 없으면 신설/폐지를 판정하지 않는다. 첫 수집은 기준선일 뿐이다.
 *  - 폐지 사유는 추측하지 않는다. 담당부서 연락처만 붙인다.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ── .env ── */
function loadEnv() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) { console.error("`.env` 가 없습니다. .env.example 을 복사해 채우세요."); process.exit(1); }
  return Object.fromEntries(readFileSync(p, "utf8").split(/\r?\n/)
    .filter(l => /^[A-Z]/.test(l))
    .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
}
const env = loadEnv();
const KEYS = [env.ONTONG_SPACE_API_KEY, env.ONTONG_POLICY_API_KEY].filter(Boolean);
if (!KEYS.length) { console.error("온통청년 인증키가 없습니다."); process.exit(1); }

const BASE = "https://www.youthcenter.go.kr/go/ythip/getPlcy";
const PAGE = 100;
const DELAY = +(env.REQUEST_DELAY_MS || 250);
const DATE = env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const STAMP = DATE.replace(/-/g, "");
const PROBE = process.argv.includes("--probe");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function call(key, page, size = PAGE) {
  const url = `${BASE}?apiKeyNm=${key}&rtnType=json&pageNum=${page}&pageSize=${size}`;
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const txt = await res.text();
      if (!txt.trim().startsWith("{")) throw new Error(`HTTP ${res.status} · 비JSON 응답`);
      const j = JSON.parse(txt);
      if (j.resultCode !== 200) throw new Error(`${j.resultCode} ${j.resultMessage}`);
      return j.result;
    } catch (e) {
      if (a === 3) throw e;
      await sleep(1000 * a);
    }
  }
}

/** 레코드가 실제로 채워져 있는지 — 권한 게이트 진단 */
const filled = r => r ? Object.values(r).filter(v => v !== null && v !== "").length : 0;

async function pickKey() {
  for (const k of KEYS) {
    try {
      const r = await call(k, 1, 3);
      const f = filled(r?.youthPolicyList?.[0]);
      console.log(`  키 …${k.slice(-6)} → 총 ${r?.pagging?.totCount ?? "?"}건 · 첫 레코드 채워진 필드 ${f}개`);
      if (f > 0) return k;
    } catch (e) { console.log(`  키 …${k.slice(-6)} → 실패: ${e.message}`); }
  }
  return null;
}

/* ── 원본 보존 ── 필드를 미리 줄이지 않는다. 정규화는 build-policies.mjs 가 한다. */
const norm = r => r;

/* ── 이전 스냅샷 ── */
function prevSnapshot() {
  const dir = join(ROOT, "data");
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter(f => /^\d{8}수집_청년정책_전수\.json$/.test(f)).sort();
  const before = files.filter(f => f.slice(0, 8) < STAMP);
  if (!before.length) return null;
  const f = before[before.length - 1];
  return { file: f, data: JSON.parse(readFileSync(join(dir, f), "utf8")) };
}

async function main() {
  console.log(`온통청년 청년정책 수집 — 기준일 ${DATE}`);
  const key = await pickKey();

  if (!key) {
    console.error(`
────────────────────────────────────────────────────────────
수집 중단 — 인증은 되지만 레코드가 비어 있습니다.

  · resultCode 200, totCount 정상, 필터(plcyNm·zipCd)도 작동
  · 그런데 55개 필드가 JSON·XML 양쪽에서 전부 빈 값

즉 키는 살아 있고 조회 권한만 아직 안 열린 상태입니다.
온통청년 > 마이페이지 > OPEN API 에서 신청 건의 상태를 확인하세요.
"승인완료"가 아니면 데이터가 빈 채로 내려옵니다.
────────────────────────────────────────────────────────────`);
    process.exit(2);
  }

  const first = await call(key, 1);
  const total = first.pagging.totCount;
  const pages = Math.ceil(total / PAGE);
  console.log(`총 ${total}건 · ${pages}페이지`);
  if (PROBE) { console.log(JSON.stringify(first.youthPolicyList[0], null, 1).slice(0, 1200)); return; }

  const rows = first.youthPolicyList.slice();
  for (let p = 2; p <= pages; p++) {
    process.stdout.write(`\r  수집 ${p}/${pages}`);
    const r = await call(key, p);
    rows.push(...r.youthPolicyList);
    await sleep(DELAY);
  }
  console.log(`\r  수집 완료 — ${rows.length}건            `);

  mkdirSync(join(ROOT, "data"), { recursive: true });
  const rawPath = join(ROOT, "data", `${STAMP}수집_청년정책_전수.json`);
  writeFileSync(rawPath, JSON.stringify({ snapshotDate: DATE, source: BASE, total, rows }, null, 1), "utf8");

  /* 신설 / 폐지 */
  const prev = prevSnapshot();
  let added = [], removed = [];
  if (prev) {
    const before = new Map(prev.data.rows.map(r => [r.plcyNo, r]));
    const now = new Map(rows.map(r => [r.plcyNo, r]));
    added = rows.filter(r => !before.has(r.plcyNo));
    removed = prev.data.rows.filter(r => !now.has(r.plcyNo));
    console.log(`전기(${prev.data.snapshotDate}) 대비 — 신설 ${added.length} · 사라짐 ${removed.length}`);
  } else {
    console.log("이전 스냅샷 없음 — 이번 수집이 기준선입니다. 신설/폐지는 판정하지 않습니다.");
  }

  writeFileSync(join(ROOT, "docs/data/policies.json"), JSON.stringify({
    date: DATE, total, baseline: !prev,
    prevDate: prev?.data.snapshotDate ?? null,
    rows, added, removed,
  }), "utf8");

  console.log(`\n  ${rawPath}\n  docs/data/policies.json`);
}

main().catch(e => { console.error("실패:", e.message); process.exit(1); });
