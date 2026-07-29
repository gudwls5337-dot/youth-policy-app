/**
 * 데이터 무결성 검증 — 결정론적 계층 (LLM 없음)
 *
 *   node scripts/validate.mjs             불변식 검사만 (수 초)
 *   node scripts/validate.mjs --resample  법제처에서 표본을 다시 받아 대조 (기본 25건)
 *   node scripts/validate.mjs --resample=60
 *   node scripts/validate.mjs --loop=3600 지정 초 간격으로 무한 반복
 *
 * 하나라도 깨지면 exit 1. 통과 기록은 work/validation-log.jsonl 에 append.
 *
 * 검증 철학
 *  - 추론하지 않는다. 저장된 값이 원문에 문자 그대로 있는지만 본다.
 *  - `미상`은 오류가 아니다. `미상인데 값이 있는 것`이 오류다.
 *  - 표본 재수집은 파싱 버그와 상류 변경을 동시에 잡는다.
 */

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { normTel, parseAge, TEL_RE } from "./lib/normalize.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = n => process.argv.find(a => a.startsWith("--" + n));
const argVal = (n, d) => { const a = arg(n); if (!a) return null; const v = a.split("=")[1]; return v ? +v : d; };

const J = p => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ── 결과 수집 ── */
let checks = 0;
const fails = [];
const warns = [];
function ok(label, cond, detail = "") {
  checks++;
  if (!cond) fails.push(detail ? `${label} — ${detail}` : label);
}
function warn(label, cond, detail = "") {
  checks++;
  if (!cond) warns.push(detail ? `${label} — ${detail}` : label);
}
/** 다수 레코드를 한 번에 검사하고, 위반 건만 모아 하나의 실패로 보고 */
function every(label, rows, pred, describe = r => r.o ?? r.n ?? "?") {
  checks++;
  const bad = rows.filter(r => !pred(r));
  if (bad.length) fails.push(`${label} — ${bad.length}건: ${bad.slice(0, 4).map(describe).join(", ")}${bad.length > 4 ? " …" : ""}`);
  return bad;
}

/* ═══════════ 1. 조례 ═══════════ */
function validateOrdinances() {
  console.log("── 조례 (board.json) ──");
  const B = J("docs/data/board.json");
  const R = B.rows;

  ok("행 존재", R.length > 200, `${R.length}행`);
  ok("지자체명 중복 없음", new Set(R.map(r => r.o)).size === R.length,
    `고유 ${new Set(R.map(r => r.o)).size} / 전체 ${R.length}`);
  every("(구) 접두 기관 없음", R, r => !r.o.startsWith("(구)"));
  every("교육청 제외", R, r => !r.o.includes("교육청"));
  every("MST 숫자", R, r => /^\d+$/.test(String(r.m)));
  every("조례명 있음", R, r => typeof r.n === "string" && r.n.length > 3);
  every("공포일 8자리", R, r => /^\d{8}$/.test(String(r.p)));
  every("공포일 실재 범위", R, r => r.p >= "19900101" && r.p <= "20301231");

  const withAge = R.filter(r => r.a != null || r.b != null);
  every("연령 하한 범위", withAge, r => r.a >= 10 && r.a <= 30);
  every("연령 상한 범위", withAge, r => r.b >= 25 && r.b <= 60);
  every("하한 < 상한", withAge, r => r.a < r.b);
  every("연령은 짝으로만 존재", R, r => (r.a == null) === (r.b == null));

  /* 핵심: 저장된 숫자가 인용문에 문자 그대로 있는가 */
  every("하한이 원문에 있음", withAge.filter(r => r.q), r => r.q.includes(String(r.a)));
  every("상한이 원문에 있음", withAge.filter(r => r.q), r => r.q.includes(String(r.b)));
  every("인용문이 청년을 정의", R.filter(r => r.q), r => /청년/.test(r.q));
  /* 파생어만 정의하고 청년 본항을 놓친 경우를 잡는다 */
  warn("인용문이 파생어 정의가 아님",
    R.filter(r => r.q && /^청년(정책|단체|활동|공간|센터)/.test(r.q)).length === 0,
    R.filter(r => r.q && /^청년(정책|단체|활동|공간|센터)/.test(r.q)).map(r => r.o).slice(0, 5).join(", "));

  /* 0XX-XXX-XXXX / 0XX-XXXX-XXXX / 0XX-120(지자체 민원 대표번호) */
  every("전화 형식", R.filter(r => r.t), r => /^0\d{1,2}-(?:\d{3,4}-\d{4}|1\d{2})$/.test(r.t),
    r => `${r.o}:${r.t}`);
  warn("지역번호 추론 불가 없음", R.filter(r => r.tf).length === 0,
    R.filter(r => r.tf).map(r => r.o).join(", "));
  every("조문 형식", R.filter(r => r.c), r => /^제\d+조$/.test(r.c));
  every("신뢰도 코드", R, r => r.k === 1 || r.k === 2);
  /* 신뢰도 '보통'이 전부 1로 뭉개진 적이 있다(필드명 충돌). 존재 자체를 감시한다. */
  ok("신뢰도 보통 플래그 살아 있음", R.filter(r => r.k === 2).length > 0,
    "전부 '높음'으로 뭉개졌다 — 원본 후보 판정과 조인이 끊겼는지 확인할 것");

  ok("분포 합계 = 연령 추출 건수",
    Object.values(B.hi).reduce((a, b) => a + b, 0) === withAge.length,
    `분포 ${Object.values(B.hi).reduce((a, b) => a + b, 0)} vs 추출 ${withAge.length}`);
  ok("parsed 필드 일치", B.parsed === withAge.length, `${B.parsed} vs ${withAge.length}`);
  ok("orgs 필드 일치", B.orgs === R.length, `${B.orgs} vs ${R.length}`);

  console.log(`  ${R.length}곳 · 연령 ${withAge.length} · 전화 ${R.filter(r => r.t).length}`);
  return B;
}

/* ═══════════ 2. 정책 ═══════════ */
function validatePolicies(B) {
  console.log("── 정책 (policies-by-org.json) ──");
  const P = J("docs/data/policies-by-org.json");
  const pol = P.pol;
  const FIELDS = new Set(["일자리", "주거", "교육", "복지·문화", "참여·권리", "기타"]);
  const LEVELS = new Set(["중앙", "광역", "기초", "미분류"]);

  ok("정책 수 일치", pol.length === P.total, `${pol.length} vs ${P.total}`);
  every("정책명 있음", pol, p => typeof p.n === "string" && p.n.trim().length > 1, p => p.n || "(빈 이름)");
  every("분야 허용값", pol, p => FIELDS.has(p.f), p => `${p.n}:${p.f}`);
  every("수준 허용값", pol, p => LEVELS.has(p.lv), p => `${p.n}:${p.lv}`);
  every("사업종료일 형식", pol.filter(p => p.pe), p => /^\d{8}$/.test(p.pe), p => p.n);
  every("최초등록일 형식", pol.filter(p => p.r), p => /^\d{4}-\d{2}-\d{2}$/.test(p.r), p => p.n);
  every("연령 숫자형", pol.filter(p => p.a != null && p.a !== ""), p => /^\d{1,3}$/.test(String(p.a)), p => p.n);

  /* 신설·종료 플래그가 날짜와 모순되지 않는가 */
  const YEAR = String(P.date).slice(0, 4);
  every("신설 플래그 = 올해 등록", pol.filter(p => p.nw), p => String(p.r).startsWith(YEAR), p => `${p.n}(${p.r})`);
  every("신설 아님 = 올해 아님", pol.filter(p => !p.nw && p.r), p => !String(p.r).startsWith(YEAR), p => `${p.n}(${p.r})`);
  /* 종료 판정은 신청마감(ae)과 사업종료(pe) 중 **먼저 닫히는 쪽**(cl)을 본다.
     사업기간만 보던 이전 기준은 신청이 이미 끝난 962건을 진행 중으로 표시했다. */
  const TODAY = String(P.date).replace(/-/g, "");
  every("cl = ae·pe 중 이른 날짜", pol.filter(p => p.cl),
    p => p.cl === [p.ae, p.pe].filter(Boolean).sort()[0], p => `${p.n}(${p.cl})`);
  every("종료 플래그 = 마감일 지남", pol.filter(p => p.ov === 1),
    p => p.cl && p.cl < TODAY && !p.al, p => `${p.n}(${p.cl})`);
  every("임박 플래그 = 아직 안 지남", pol.filter(p => p.ov === 2),
    p => p.cl && p.cl >= TODAY, p => `${p.n}(${p.cl})`);
  /* 진행 중인데 마감일이 과거인 경우가 있으면 안 된다 — 단 상시·수시는 예외 */
  every("진행 플래그 = 마감 안 지남 또는 상시", pol.filter(p => !p.ov),
    p => p.al || !p.cl || p.cl >= TODAY, p => `${p.n}(${p.cl})`);
  every("상시는 종료로 안 잡힘", pol.filter(p => p.al), p => p.ov === 0, p => p.n);
  /* 종료 사유가 실제 날짜와 맞는가 */
  every("종료 사유 정합", pol.filter(p => p.cr === "신청마감"), p => p.ae === p.cl, p => p.n);
  every("사업종료 사유 정합", pol.filter(p => p.cr === "사업종료"), p => p.pe === p.cl, p => p.n);

  /* 인덱스 무결성 */
  const all = [...P.central, ...Object.values(P.bySido).flat(), ...Object.values(P.byOrg).flat()];
  every("인덱스 범위", all.map(i => ({ i })), x => Number.isInteger(x.i) && x.i >= 0 && x.i < pol.length, x => String(x.i));
  ok("중앙 인덱스 중복 없음", new Set(P.central).size === P.central.length);
  const orgNames = new Set(B.rows.map(r => r.o));
  every("byOrg 키가 조례 지자체", Object.keys(P.byOrg).map(o => ({ o })), x => orgNames.has(x.o));
  const sidoNames = new Set(B.rows.map(r => r.o.split(" ")[0]));
  every("bySido 키가 광역", Object.keys(P.bySido).map(o => ({ o })), x => sidoNames.has(x.o));

  /* 모든 지자체가 최소 1건은 보이는가 (빈 화면 방지) */
  const per = o => (P.byOrg[o]?.length || 0) + (P.bySido[o.split(" ")[0]]?.length || 0) + P.central.length;
  every("지자체별 정책 1건 이상", B.rows, r => per(r.o) > 0);

  const lv = pol.reduce((a, p) => (a[p.lv] = (a[p.lv] || 0) + 1, a), {});
  console.log(`  ${pol.length}건 · ${JSON.stringify(lv)}`);
  warn("미분류 비율 10% 미만", (lv["미분류"] || 0) / pol.length < 0.10,
    `${((lv["미분류"] || 0) / pol.length * 100).toFixed(1)}%`);
  return P;
}

/* ═══════════ 3. 빌드 산출물 ═══════════ */
function validateBuild() {
  console.log("── 빌드 (docs/index.html) ──");
  const p = join(ROOT, "docs/index.html");
  ok("index.html 존재", existsSync(p));
  if (!existsSync(p)) return;
  const h = readFileSync(p, "utf8");
  ok("데이터 주입됨", !h.includes("__BOARD__") && !h.includes("__POLICIES__"));
  ok("치환 잔재 없음", !h.includes("/*__"));
  ok("CSS hex 정상", !/#[0-9A-Fa-f]{2,6}\s+[0-9A-Fa-f]{1,4}\s*;/.test(h));
  const js = h.slice(h.lastIndexOf("<script>") + 8, h.lastIndexOf("</script>"));
  let syntaxOk = true;
  try { new Function(js); } catch (e) { syntaxOk = false; warns.push("JS 문법: " + e.message); }
  ok("JS 문법", syntaxOk);
  console.log(`  ${(h.length / 1e6).toFixed(2)}M chars`);
}

/* ═══════════ 4. 표본 재수집 대조 ═══════════ */
async function resample(B, n) {
  console.log(`── 표본 재수집 ${n}건 (법제처 재호출) ──`);
  const pool = B.rows.filter(r => r.a != null);
  const pick = [];
  const step = Math.max(1, Math.floor(pool.length / n));   // 결정론적 균등 표집
  for (let i = 0; i < pool.length && pick.length < n; i += step) pick.push(pool[i]);

  const cdata = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
  const get = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? cdata(m[1]) : ""; };

  let matched = 0;
  const diffs = [];
  const unreachable = [];
  for (const r of pick) {
    /* 재수집 실패는 데이터 오류가 아니다 — 별도로 센다.
       둘을 섞으면 일시적 API 장애로 늑대를 외치게 되고, 결국 아무도 안 본다.
       (2026-07-29 법제처 호출 폭주 후 6건이 이 사유로 실패로 잡혔다.) */
    let xml = null;
    for (let a = 1; a <= 3 && !xml; a++) {
      try {
        const res = await fetch(`https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${r.m}&type=XML`,
          { signal: AbortSignal.timeout(25000) });
        const t = await res.text();
        if (!t.includes("<LawService>")) throw new Error(`비정상 응답 HTTP ${res.status}`);
        xml = t;
      } catch (e) {
        if (a === 3) unreachable.push(`${r.o}: ${e.message}`);
        else await sleep(1500 * a);
      }
    }
    if (!xml) continue;

    const flat = xml.replace(/\s+/g, " ");
    /* 저장된 연령이 원문 어딘가에 실제로 표기돼 있는가 */
    const found = parseAge(flat);
    /* 상류 원본도 우리와 같은 규칙으로 정규화한 뒤 비교한다 */
    const [tel] = normTel(get(xml, "전화번호"), r.o);
    const dept = get(xml, "담당부서명"), prom = get(xml, "공포일자");
    const problems = [];
    if (!found) problems.push("원문에서 연령 패턴 못 찾음");
    else if (found.min !== r.a || found.max !== r.b) problems.push(`연령 ${r.a}~${r.b} ≠ 원문 ${found.min}~${found.max}`);
    if (r.t && tel && r.t !== tel) problems.push(`전화 ${r.t} ≠ ${tel}`);
    if (r.d && dept && r.d !== dept) problems.push(`부서 ${r.d} ≠ ${dept}`);
    if (r.p && prom && r.p !== prom) problems.push(`공포일 ${r.p} ≠ ${prom} (상류 개정 가능)`);

    if (problems.length) diffs.push(`${r.o}: ${problems.join(" / ")}`);
    else matched++;
    await sleep(220);
  }
  checks++;
  const reached = pick.length - unreachable.length;
  console.log(`  대조 ${matched}/${reached} 일치${unreachable.length ? ` · 재수집 실패 ${unreachable.length}건(대조 제외)` : ""}`);

  /* 데이터 불일치 = 실패 */
  if (diffs.length) fails.push(`표본 재수집 불일치 ${diffs.length}건:\n      ${diffs.join("\n      ")}`);

  /* 재수집 실패 = 경고. 단 절반 이상 실패면 API 계약이 바뀐 것이므로 실패로 올린다 */
  if (unreachable.length) {
    const msg = `법제처 재수집 실패 ${unreachable.length}/${pick.length}건 — ${unreachable.slice(0, 3).join(" / ")}`;
    if (unreachable.length > pick.length / 2) fails.push(msg + " (절반 초과 — API 계약 변경 의심)");
    else warns.push(msg + " (일시적 장애로 보임. 대조에서 제외했다)");
  }
  /* 대조에 성공한 표본이 너무 적으면 검증이 성립하지 않는다 */
  if (reached < Math.max(5, pick.length * 0.4))
    fails.push(`유효 표본 부족 — ${reached}/${pick.length}건만 대조. 재실행 필요`);

  return { sampled: pick.length, reached, matched, diffs: diffs.length, unreachable: unreachable.length };
}

/* ═══════════ 실행 ═══════════ */
async function run() {
  checks = 0; fails.length = 0; warns.length = 0;
  const t0 = Date.now();
  console.log(`\n검증 시작 ${new Date().toISOString().slice(0, 19).replace("T", " ")}\n`);

  const B = validateOrdinances();
  const P = validatePolicies(B);
  validateBuild();

  let sample = null;
  if (arg("resample")) sample = await resample(B, argVal("resample", 25) ?? 25);

  const passed = fails.length === 0;
  console.log(`\n검사 ${checks}항목 · ${((Date.now() - t0) / 1000).toFixed(1)}초`);
  if (warns.length) console.log(`경고 ${warns.length}건\n  ! ${warns.join("\n  ! ")}`);
  console.log(passed ? "\n통과" : `\n실패 ${fails.length}건\n  x ${fails.join("\n  x ")}`);

  appendFileSync(join(ROOT, "work/validation-log.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), passed, checks, fails, warns, sample }) + "\n", "utf8");

  return passed;
}

const loop = argVal("loop", 3600);
if (arg("loop")) {
  for (;;) {
    const okRun = await run();
    console.log(`\n다음 검증까지 ${loop}초 대기…${okRun ? "" : "  (직전 실패)"}\n${"─".repeat(60)}`);
    await sleep(loop * 1000);
  }
} else {
  process.exit((await run()) ? 0 : 1);
}
