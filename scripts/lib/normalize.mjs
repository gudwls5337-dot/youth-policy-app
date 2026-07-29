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
