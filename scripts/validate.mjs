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
  /* 신설 = 올해 등록 AND 원본 마감코드 아님. 올해 등록이지만 마감인 건은 신설이 아니다. */
  every("신설 플래그 = 마감 아님", pol.filter(p => p.nw), p => p.ac !== "3", p => `${p.n}(코드 ${p.ac})`);
  every("올해 등록·마감 아님 = 신설", pol.filter(p => String(p.r).startsWith(YEAR) && p.ac !== "3"),
    p => p.nw === 1, p => `${p.n}(${p.r})`);
  /* 종료 판정은 신청마감(ae)과 사업종료(pe) 중 **먼저 닫히는 쪽**(cl)을 본다.
     사업기간만 보던 이전 기준은 신청이 이미 끝난 962건을 진행 중으로 표시했다. */
  const TODAY = String(P.date).replace(/-/g, "");
  every("cl = ae·pe 중 이른 날짜", pol.filter(p => p.cl),
    p => p.cl === [p.ae, p.pe].filter(Boolean).sort()[0], p => `${p.n}(${p.cl})`);
  /* 마감 근거는 둘 중 하나여야 한다 — 날짜가 지났거나, 원본이 마감이라고 했거나.
     원본 마감코드(0057003)는 날짜가 아예 없는 건이 많다(접수기간 미표기). */
  every("종료 근거 있음", pol.filter(p => p.ov === 1),
    p => (p.cl && p.cl < TODAY) || p.ac === "3", p => `${p.n}(cl=${p.cl} 코드=${p.ac})`);
  every("종료는 상시가 아님", pol.filter(p => p.ov === 1), p => !p.al, p => p.n);
  every("임박 플래그 = 아직 안 지남", pol.filter(p => p.ov === 2),
    p => p.cl && p.cl >= TODAY, p => `${p.n}(${p.cl})`);
  /* 진행 중인데 마감일이 과거인 경우가 있으면 안 된다 — 단 상시·수시는 예외 */
  every("진행 플래그 = 마감 안 지남 또는 상시", pol.filter(p => !p.ov),
    p => p.al || !p.cl || p.cl >= TODAY, p => `${p.n}(${p.cl})`);
  every("상시는 종료로 안 잡힘", pol.filter(p => p.al), p => p.ov === 0, p => p.n);
  /* 종료 사유가 실제 날짜와 맞는가 */
  every("종료 사유 정합", pol.filter(p => p.cr === "신청마감"), p => p.ae === p.cl, p => p.n);
  every("사업종료 사유 정합", pol.filter(p => p.cr === "사업종료"), p => p.pe === p.cl, p => p.n);

  /* ── 원본 코드값 회귀 검사 (2026-07-30 3단 감사) ──
     자유텍스트("연중")를 읽어 516건을 거짓으로 열어놨던 회귀를 다시는 못 내게 막는다.
     ac 는 aplyPrdSeCd 끝자리: 1=특정기간 2=상시 3=마감 */
  every("원본 마감(0057003)은 반드시 마감", pol.filter(p => p.ac === "3"), p => p.ov === 1,
    p => `${p.n}(ov=${p.ov})`);
  every("원본 상시(0057002)는 마감 아님", pol.filter(p => p.ac === "2"), p => p.ov !== 1,
    p => `${p.n}(ov=${p.ov})`);
  every("원본 특정기간(0057001)은 날짜 있음", pol.filter(p => p.ac === "1"), p => !!(p.ae || p.pe), p => p.n);
  ok("코드값 보존", pol.filter(p => p.ac).length > pol.length * 0.9,
    `${pol.filter(p => p.ac).length}/${pol.length}`);
  /* 상시 플래그는 원본 상시 코드와만 일치해야 한다 */
  every("상시 플래그 = 원본 상시", pol.filter(p => p.al), p => p.ac === "2", p => `${p.n}(코드 ${p.ac})`);

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

/* ═══════════ 2-B. 조례 조문 비교 ═══════════ */
function validateGovernance() {
  console.log("── 조례 조문 (gov-compare.json) ──");
  if (!existsSync(join(ROOT, "docs/data/gov-compare.json"))) { fails.push("gov-compare.json 없음"); return; }
  const G = J("docs/data/gov-compare.json");
  const st = Object.entries(G.orgState).map(([o, v]) => ({ o, ...v }));

  ok("지표 5종", G.metrics.length === 5, `${G.metrics.length}종`);
  ok("지자체 수", st.length > 200, `${st.length}곳`);
  every("지표 id 중복 없음", [{ x: new Set(G.metrics.map(m => m.id)).size === G.metrics.length }], v => v.x);
  every("채택 수가 전체 이하", G.metrics, m => m.n <= m.total, m => `${m.label} ${m.n}/${m.total}`);
  every("채택 수 > 0", G.metrics, m => m.n > 0, m => m.label);
  every("제안 문구 있음", G.metrics, m => m.ask && m.why, m => m.label);

  /* 판정과 원문 인용이 함께 있어야 검증이 성립한다 */
  every("참여기구 판정값", st, v => ["의무", "임의", "없음", "미상"].includes(v.net?.kind), v => `${v.o}:${v.net?.kind}`);
  every("위원회 판정값", st, v => ["의무", "임의", "없음", "미상"].includes(v.cmte?.kind), v => `${v.o}:${v.cmte?.kind}`);
  every("판정 있으면 인용도 있음", st.filter(v => v.net?.kind === "의무" || v.net?.kind === "임의"),
    v => !!v.net?.quote, v => v.o);
  every("정기회 범위", st.filter(v => v.regular?.n != null), v => v.regular.n >= 1 && v.regular.n <= 12, v => `${v.o}:${v.regular.n}`);
  every("정원 범위", st.filter(v => v.seats?.n != null), v => v.seats.n >= 3 && v.seats.n <= 100, v => `${v.o}:${v.seats.n}`);
  every("청년비율 범위", st.filter(v => v.youthQuota?.pct != null), v => v.youthQuota.pct > 0 && v.youthQuota.pct <= 100, v => `${v.o}:${v.youthQuota.pct}`);
  /* 문언 강도 3등급 — 0 노력조항 · 1 강제 · 2 지향(「되도록 한다」)
     「조례에 있습니다」가 반박당하는 지점이라 뭉개면 안 된다. */
  every("청년비율 강제여부 표기", st.filter(v => v.youthQuota?.pct != null),
    v => [0, 1, 2].includes(v.youthQuota.binding), v => `${v.o}:${v.youthQuota.binding}`);
  ok("노력조항이 별도로 잡힘", st.filter(v => v.youthQuota?.binding === 0).length > 0,
    "전부 강제로 뭉개졌는지 확인 필요");
  ok("지향 문구가 별도로 잡힘", st.filter(v => v.youthQuota?.binding === 2).length > 0,
    "「되도록 한다」를 강제로 뭉개면 반박당한다");
  /* 절대 인원 하한도 잡혔는가 — 양산 「청년을 5명 이상」을 놓쳐 오탐을 냈던 지점 */
  ok("절대 인원 하한 인식", st.filter(v => v.youthQuota?.heads != null).length > 0,
    "비율(%)만 찾고 「N명 이상」을 놓치면 우리 시 조례에서 반박당한다");
  every("기본계획 판정값", st, v => ["의무", "임의", "없음", "미상"].includes(v.plan?.kind), v => `${v.o}:${v.plan?.kind}`);
  every("기본계획 주기 범위", st.filter(v => v.plan?.cycle != null), v => v.plan.cycle >= 1 && v.plan.cycle <= 10, v => `${v.o}:${v.plan.cycle}`);

  console.log(`  ${st.length}곳 · 지표 ${G.metrics.length}종 · ${G.metrics.map(m => m.n).join("/")}`);
}

/* ═══════════ 3. 빌드 산출물 ═══════════ */
/** 양산 청년가까e — 「현황」을 주장하는 유일한 축이라 검사를 더 엄하게 건다.
 *  여기가 틀리면 화면이 「우리 시는 이걸 안 한다」는 거짓을 말하게 된다. */
function validateYangsan() {
  console.log("── 양산 (청년가까e) ──");
  const p = "docs/data/yangsan.json";
  ok("yangsan.json 존재", existsSync(join(ROOT, p)));
  if (!existsSync(join(ROOT, p))) return;
  const Y = J(p);
  const P = Y.policies;
  console.log(`  ${P.length}건 · 시 등록 ${Y.counts.self} · 미러 ${Y.counts.mirror} · 조례 ${Y.ordinances.length}건`);

  ok("정책 존재", P.length > 50, `${P.length}건`);
  ok("counts 합 일치", Y.counts.self + Y.counts.mirror === P.length,
    `${Y.counts.self}+${Y.counts.mirror} vs ${P.length}`);
  ok("id 중복 없음", new Set(P.map(x => x.id)).size === P.length);
  every("id 존재", P, x => !!x.id, x => x.nm);
  /* 숫자 id = 시 직접 등록, `R…` = 온통청년 미러. 이 구분이 무너지면 현황 숫자가 오염된다. */
  every("origin 판정이 id 형식과 일치", P,
    x => x.origin === (/^\d+$/.test(x.id) ? "self" : "ontong"), x => `${x.id}/${x.origin}`);

  const self = P.filter(x => x.origin === "self");
  every("상태값이 4종 안에 있음", P, x => ["진행", "예정", "종료", "미상"].includes(x.st), x => `${x.id}:${x.st}`);
  /* 원칙 4 — 판정에는 근거가 따라와야 한다. 근거 없는 상태는 추정이다. */
  every("판정에 근거가 붙어 있음", P.filter(x => x.st !== "미상"), x => !!x.stSrc, x => `${x.id} ${x.nm?.slice(0, 20)}`);
  every("미상은 근거가 없어야", P.filter(x => x.st === "미상"), x => !x.stSrc, x => x.id);
  every("상시는 진행일 때만", P, x => x.kind !== "상시" || x.st === "진행", x => `${x.id}:${x.st}/${x.kind}`);

  /* 이 앱의 존재 이유 — 온통청년이 「전부 마감」이라 말하는 걸 반증하는 자리다.
     0이 되면 데이터가 상해서 그런 건지 진짜 없는 건지 사람이 봐야 한다. */
  const live = self.filter(x => x.st === "진행" || x.st === "예정").length;
  warn("시 등록분에 진행·예정이 있음", live > 0, `${live}건`);

  every("기간 형식", P.filter(x => x.from), x => /^\d{4}-\d{2}-\d{2}$/.test(x.from), x => `${x.id}:${x.from}`);
  every("종료일이 시작일 이후", P.filter(x => x.from && x.to), x => x.to >= x.from, x => `${x.id}:${x.from}~${x.to}`);
  every("신청현황은 양수", P.filter(x => x.capacity != null), x => x.capacity > 0 && x.applied >= 0,
    x => `${x.id}:${x.applied}/${x.capacity}`);
  /* `456 / 50,000` 을 콤마 못 넘어 `50` 으로 읽어 화면에 「한도 도달」 거짓이 떴다.
     분모가 신청자보다 터무니없이 작으면 파싱 사고다(2026-07-31 감사). */
  every("분모가 콤마로 잘리지 않음", P.filter(x => x.capacity != null),
    x => x.applied <= x.capacity * 3, x => `${x.id}:${x.applied}/${x.capacity}`);
  every("전화 형식", P.filter(x => x.tel), x => TEL_RE.test(x.tel), x => `${x.id}:${x.tel}`);

  /* 요구 4 — 조문을 붙였으면 인용이 있어야 한다. 번호만 있으면 검증이 안 된다. */
  every("조문에 인용문 동반", P.filter(x => x.art), x => !!x.art.body && x.art.body.length > 10,
    x => `${x.id}:${x.art?.label}`);
  /* 2026-07-31 감사: 계획수립 조항이 116건 중 67건을 차지했고 그중 하나(기본 제7조)는
     전문이 한 문장뿐이라 어떤 사업의 근거도 될 수 없었다. 계획·책무 조항은 근거가 아니다. */
  every("조문이 계획·책무·정의 조항이 아님", P.filter(x => x.art),
    x => !/(목적|정의|적용\s*범위|기본이념|책무|기본계획|시행계획|계획의?\s*수립|실태조사|위원회)/.test((x.art.title || "").trim()),
    x => `${x.id}:${x.art?.title}`);
  /* 조례마다 「지원사업」 계열 조가 사업의 지출 근거다. 그게 다수여야 정상이다. */
  const basis = P.filter(x => x.art && /지원사업|추진.{0,2}지원\s*사업|청년정책사업지원|^지원$|가입대상|보험계약|교육기관|청년센터|청년시설|청년정책단|참여\s*확대|제대군인/.test(x.art.title || "")).length;
  ok("조문이 지출 근거 계열", basis >= P.filter(x => x.art).length * 0.9,
    `${basis}/${P.filter(x => x.art).length}`);
  /* 조문 전문은 「…필요하다고 인정하는 사업」처럼 호 열거로 끝날 수 있다 — 정상이다.
     문제는 **잘린 것**이 어절 중간에서 끊기는 경우다. 잘린 것만 본다. */
  every("잘린 인용문이 어절 중간에서 안 끊김", P.filter(x => x.art && /…$/.test(x.art.body || "")),
    x => /(다\.|다|음|함|임)\s*…$/.test((x.art.body || "").trim()), x => `${x.id}:…${(x.art.body||"").slice(-16)}`);
  every("조례 연결에 mst 있음", P.filter(x => x.ord), x => !!x.ord.mst, x => x.id);
  const names = new Set(Y.ordinances.map(o => o.name));
  every("연결된 조례가 수집 목록 안에 있음", P.filter(x => x.ord), x => names.has(x.ord.name), x => x.ord?.name);
  ok("조례 전부 양산 것", Y.ordinances.every(o => o.name.startsWith("양산시")));
  ok("조문 수집됨", Y.ordinances.every(o => o.arts > 0), Y.ordinances.filter(o => !o.arts).map(o => o.name).join(","));

  /* 공고문 게시판은 robots.txt 차단이라 본문을 담으면 안 된다. URL 만 있어야 정상. */
  every("공고문은 링크만", P.filter(x => x.link), x => /^https?:\/\/[^\s]+$/.test(x.link), x => x.id);

  /* 「신청하러 가기」가 갈 곳. 공고문 링크가 없는 사업이 대부분이라, 신청 직링크가
     없으면 홈으로만 보내게 된다 — 그러면 버튼이 사실상 죽는다. */
  every("신청 직링크 형식", P.filter(x => x.applyUrl),
    x => /^https:\/\/www\.yangsan\.go\.kr\/youth\/plcyPrgrm\/\w+\/view\.do\?mngSn=\d+$/.test(x.applyUrl),
    x => `${x.id}:${x.applyUrl}`);
  every("신청 직링크는 신청현황이 있을 때만", P,
    x => !x.applyUrl || x.capacity != null, x => x.id);
  const liveNow = P.filter(x => x.origin === "self" && (x.st === "진행" || x.st === "예정"));
  warn("시행중·예정에 나갈 링크가 있음", liveNow.every(x => x.applyUrl || x.link),
    `${liveNow.filter(x => !x.applyUrl && !x.link).length}건은 청년가까e 홈으로만 간다`);
}

/** 지난 제안 처리결과 — 공문에서 뽑은 것이라 **원문 대조가 곧 검증**이다. */
function validateProposals() {
  console.log("── 지난 제안 (처리의견 공문) ──");
  const p = "docs/data/proposals.json";
  ok("proposals.json 존재", existsSync(join(ROOT, p)));
  if (!existsSync(join(ROOT, p))) return;
  const P = J(p);
  const R = P.proposals;
  console.log(`  ${R.length}건 · ${Object.entries(P.byYear).map(([y, t]) => `${y} ${t.n}`).join(" · ")}`);

  /* 공문 총괄표가 밝힌 건수다. 파싱이 흔들리면 여기서 걸린다. */
  ok("2024년 17건", P.byYear["2024"]?.n === 17, `${P.byYear["2024"]?.n}`);
  ok("2025년 66건", P.byYear["2025"]?.n === 66, `${P.byYear["2025"]?.n}`);
  ok("연번 중복 없음", new Set(R.map(r => `${r.year}|${r.no}`)).size === R.length);
  every("결과 라벨이 공문 표기", R,
    r => ["수용", "수정보완 후 시행", "기시행중", "장기검토", "시행불가"].includes(r.result),
    r => `${r.year} ${r.no}:${r.result}`);
  every("묶음이 결과와 맞음", R,
    r => (r.group === "통과") === ["수용", "수정보완 후 시행"].includes(r.result), r => `${r.no}:${r.group}`);
  /* 원칙 4 — 사유 원문이 없으면 이 데이터는 쓸모가 없다 */
  every("사유 원문 있음", R, r => !!r.reason && r.reason.length > 15, r => `${r.year} ${r.no}`);
  every("검토 부서 있음", R, r => !!r.dept, r => `${r.year} ${r.no}`);
  every("분과가 연번과 맞음", R,
    r => r.div === ({ "1": "일자리", "2": "생활안정", "3": "문화예술" })[r.no.split("-")[0]], r => `${r.no}:${r.div}`);
  /* 요약하지 않는다 — 원문을 잘라 넣으면 인용이 아니게 된다 */
  every("사유를 요약하지 않음", R, r => !/^\s*(요약|정리)/.test(r.reason), r => r.no);
  every("유형은 배열", R, r => Array.isArray(r.ks), r => r.no);
  ok("유형 붙은 제안 있음", R.filter(r => r.ks.length).length > 10, `${R.filter(r => r.ks.length).length}건`);
  /* 통과 건에 반려 사유를 달면 화면이 거짓말을 한다 */
  every("통과 건엔 사유 갈래 없음", R.filter(r => r.group === "통과"), r => !r.cause, r => r.no);
  warn("사유 미분류 절반 미만",
    R.filter(r => r.group !== "통과" && !r.cause).length < R.filter(r => r.group !== "통과").length / 2,
    `${R.filter(r => r.group !== "통과" && !r.cause).length}건`);
  /* 공문 총괄표와 상세가 다른 3건. 숨기면 나중에 들킨다 */
  ok("총괄표 불일치 건 표시됨", R.filter(r => r.tableResult).length === 3,
    R.filter(r => r.tableResult).map(r => r.no).join(",") || "없음");
  every("2년 연속 짝이 서로 다른 해", P.repeats || [],
    x => x.a.year !== x.b.year, x => `${x.a.no}/${x.b.no}`);
  every("2년 연속 짝은 둘 다 미통과", P.repeats || [],
    x => x.a.group !== "통과" && x.b.group !== "통과", x => `${x.a.no}/${x.b.no}`);
}

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
  validateGovernance();
  validateYangsan();
  validateProposals();
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
