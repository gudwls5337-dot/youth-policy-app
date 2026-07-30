/**
 * 정규화 규칙 단일 출처.
 * 빌드(build-board.mjs)와 검증(validate.mjs)이 반드시 같은 함수를 써야 한다.
 * 서로 다른 사본을 두면 "정규화한 값 ≠ 원본" 이라는 가짜 불일치가 난다.
 */

/* 시도별 지역번호 */
export const AREA = {
  "서울특별시": "02", "부산광역시": "051", "대구광역시": "053", "인천광역시": "032",
  "광주광역시": "062", "대전광역시": "042", "울산광역시": "052", "세종특별자치시": "044",
  "경기도": "031", "강원특별자치도": "033", "충청북도": "043", "충청남도": "041",
  "전북특별자치도": "063", "전라남도": "061", "경상북도": "054", "경상남도": "055",
  "제주특별자치도": "064",
};

/** 전남광주통합특별시는 062(광주)/061(전남)이 섞여 있다.
 *  광주는 자치구만, 전남은 시·군만 있으므로 접미사로 갈린다. */
export function areaFor(org) {
  const sido = String(org).split(" ")[0];
  if (AREA[sido]) return AREA[sido];
  if (sido === "전남광주통합특별시") {
    const sub = String(org).split(" ").slice(1).join(" ");
    if (/구$/.test(sub)) return "062";
    if (/(시|군)$/.test(sub)) return "061";
  }
  return null;
}

export const TEL_RE = /^0\d{1,2}-(?:\d{3,4}-\d{4}|1\d{2})$/;

/** 전화번호 정규화. 반환 [번호, 완전여부] */
export function normTel(raw, org) {
  const t = String(raw ?? "").trim();
  if (!t || t === "-") return ["", false];

  let s = t.replace(/[)\s]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

  if (/^\d{9,11}$/.test(s)) {                      // 0546796186 → 054-679-6186
    const m = s.match(/^(0\d{1,2})(\d{3,4})(\d{4})$/);
    if (m) s = `${m[1]}-${m[2]}-${m[3]}`;
  }
  s = s.replace(/~.*$/, "");                       // 530-2072~2075 → 530-2072

  if (TEL_RE.test(s)) return [s, true];

  if (/^1\d{2}$/.test(s)) {                        // 120 = 지자체 민원 대표번호
    const a = areaFor(org);
    return a ? [`${a}-${s}`, true] : [s, false];
  }
  if (/^\d{3,4}-\d{4}$/.test(s)) {                 // 국번만 있음
    const a = areaFor(org);
    return a ? [`${a}-${s}`, true] : [s, false];
  }
  return [s, false];
}

/** 조례 본문에서 연령 범위 추출. 실패 시 null — 추정하지 않는다. */
export const AGE_PATTERNS = [
  /만?\s*(\d{1,2})\s*세\s*이상\s*(?:부터\s*)?만?\s*(\d{1,2})\s*세\s*이하/,
  /(\d{1,2})\s*세\s*이상\s*(\d{1,2})\s*세\s*이하의?\s*사람/,
  /만?\s*(\d{1,2})\s*세\s*이상\s*만?\s*(\d{1,2})\s*세\s*미만/,
  /(\d{1,2})\s*세\s*부터\s*(\d{1,2})\s*세\s*까지/,
  /(\d{1,2})\s*세\s*~\s*(\d{1,2})\s*세/,
];
export function parseAge(text) {
  for (const re of AGE_PATTERNS) {
    const m = String(text ?? "").match(re);
    if (!m) continue;
    let [, lo, hi] = m.map(Number);
    if (re.source.includes("미만")) hi -= 1;
    if (lo >= 10 && lo <= 30 && hi >= lo && hi <= 60) return { min: lo, max: hi };
  }
  return null;
}


/* ═══════════ 온통청년 코드값 ═══════════
   원본이 상태를 코드로 알려주는데 앱은 자유텍스트(bizPrdEtcCn "연중")를 읽고 있었다.
   그 결과 516건을 거짓으로 「신청 가능」으로 표시했다(2026-07-30 3단 감사).

   aplyPrdSeCd  신청기간 구분
     0057001 특정기간 — aplyYmd 에 날짜범위가 있다
     0057002 상시     — aplyYmd 공백, 과거 사업종료일 0건으로 검증됨
     0057003 마감     — aplyYmd 공백, 86%가 이미 과거

   bizPrdSeCd   사업기간 구분
     0056001 기간확정 — bizPrdEtcCn 전건 공백
     0056002 기타서술 — 여기만 "연중·상시·계속" 이 들어간다 (사업기간 전용)
*/
export const APLY = { PERIOD: "0057001", ALWAYS: "0057002", CLOSED: "0057003" };
export const BIZ  = { FIXED: "0056001", FREEFORM: "0056002" };

/** 신청 상태 판정 — 자유텍스트를 보지 않는다.
 *  @returns { st: "always"|"open"|"closed", cl: 마감일|"", cr: 사유 }  */
export function applyStatus(p, todayYmd) {
  const cd = String(p?.aplyPrdSeCd ?? "").trim();
  const ae = (String(p?.aplyYmd ?? "").match(/(\d{8})\s*~\s*(\d{8})/) || [])[2] || "";
  const pe = /^\d{8}$/.test(String(p?.bizPrdEndYmd ?? "").trim()) ? String(p.bizPrdEndYmd).trim() : "";

  if (cd === APLY.CLOSED) {
    /* 원본이 마감이라 했으면 사업기간이 미래여도 마감이다 */
    const cl = ae || pe || "";
    return { st: "closed", cl, cr: cl ? (ae ? "신청마감" : "사업종료") : "접수마감" };
  }
  if (cd === APLY.ALWAYS) return { st: "always", cl: "", cr: "" };

  /* 0057001 또는 코드 미상 — 날짜로 판정 */
  const closes = [ae, pe].filter(Boolean).sort()[0] || "";
  if (closes && closes < todayYmd) return { st: "closed", cl: closes, cr: ae === closes ? "신청마감" : "사업종료" };
  return { st: "open", cl: closes, cr: closes ? (ae === closes ? "신청마감" : "사업종료") : "" };
}
