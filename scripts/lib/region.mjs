/**
 * 지역 판정 — zipCd(행정구역 코드) 기반
 *
 * 처음엔 기관명 텍스트만 봤다. 그래서 「청년정책과」처럼 부서명만 있는 건이
 * 미분류로 빠졌다(170건, 충남에 83건 집중).
 * zipCd 는 API 가 직접 붙인 코드라 텍스트 표기에 흔들리지 않는다.
 *
 * 코드북은 별도 파일을 들이지 않고 **데이터에서 역추출**한다.
 * 기관명으로 확실히 판정된 건들의 (단일 zipCd ↔ 지자체명) 쌍을 모으면
 * 코드북이 만들어지고, 그 자체가 검증된다.
 */

/** zipCd 앞 2자리 → 시도. 실측으로 확인한 값만 넣는다(2026-07-30). */
export const SIDO_BY_CODE = {
  11: "서울특별시", 12: "전남광주통합특별시", 26: "부산광역시", 27: "대구광역시",
  28: "인천광역시", 29: "전남광주통합특별시", 30: "대전광역시", 31: "울산광역시",
  36: "세종특별자치시", 41: "경기도", 43: "충청북도", 44: "충청남도",
  45: "전북특별자치도", 46: "전남광주통합특별시", 47: "경상북도", 48: "경상남도",
  50: "제주특별자치도", 51: "강원특별자치도", 52: "전북특별자치도",
};

/** 전국 사업 판정 — 코드가 이보다 많으면 특정 지역 사업이 아니다 */
export const NATIONWIDE_MIN = 150;

export const codes = r => String(r?.zipCd ?? "").split(",").map(s => s.trim()).filter(Boolean);

/** 단일 시도를 가리키면 그 시도명, 아니면 null */
export function sidoOf(r) {
  const cs = codes(r);
  if (!cs.length || cs.length > NATIONWIDE_MIN) return null;
  const set = new Set(cs.map(c => SIDO_BY_CODE[+String(c).slice(0, 2)]).filter(Boolean));
  return set.size === 1 ? [...set][0] : null;
}

export const isNationwide = r => codes(r).length > NATIONWIDE_MIN;

/**
 * 기관명으로 확실히 판정된 건에서 (5자리 코드 → 지자체 풀네임) 코드북을 만든다.
 * @param rows 원본 레코드
 * @param resolve (row) => "경상남도 양산시" | null   기관명 기반 1차 판정 결과
 */
export function buildCodebook(rows, resolve, resolveWide) {
  const votes = new Map();                 // code → Map(org → 표수)
  for (const r of rows) {
    const cs = codes(r);
    if (cs.length !== 1) continue;          // 코드가 하나일 때만 신뢰한다
    /* 1차는 기관명. 그것만으로는 충남 시군(아산·공주·천안·부여)이 코드북에서
       통째로 빠졌다 — 기관명이 부서명뿐이라 표가 안 잡혔다(2026-07-30 2단 감사).
       그래서 정책명·URL 까지 본 넓은 단서를 2차로 쓴다. 다수결이라 오탐이 걸러진다. */
    const org = resolve(r) || (resolveWide ? resolveWide(r) : null);
    if (!org || org.split(" ").length < 2) continue;
    const c = cs[0];
    if (!votes.has(c)) votes.set(c, new Map());
    const m = votes.get(c);
    m.set(org, (m.get(org) || 0) + 1);
  }
  const book = {};
  const conflicts = [];
  for (const [c, m] of votes) {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const [top, n] = sorted[0];
    const total = sorted.reduce((a, [, v]) => a + v, 0);
    /* 과반이 아니면 채택하지 않는다. 추측으로 코드북을 오염시키지 않는다. */
    if (n / total >= 0.6) book[c] = top;
    else conflicts.push({ c, cands: sorted.slice(0, 3) });
  }
  return { book, conflicts };
}

/**
 * 코드북으로 기초 지자체 판정. **모든** 코드가 같은 한 지자체를 가리켜야 인정한다.
 *
 * 모르는 코드를 filter(Boolean) 으로 버리던 이전 판은 광역 전역 사업을 기초 사업으로
 * 만들었다. 「울산청년지원센터 운영」은 zipCd 가 울산 5개 구·군인데 코드북에 동구
 * (31170) 만 있어서 **울산광역시 정책 132건이 울산 동구 자체 정책**이 됐다
 * (2026-07-30 4단 감사). 그 버킷은 전국에서 두 번째로 큰 기초 버킷이었다.
 *
 * 기초 사업은 코드가 하나다. 코드가 여럿이면 광역 단위이거나 판정 불가다 — 둘 다 null.
 */
export function basicOf(r, book) {
  const cs = codes(r);
  if (!cs.length || cs.length > 6) return null;   // 6곳 넘으면 광역 단위 사업
  const mapped = cs.map(c => book[c]);
  if (mapped.some(o => !o)) return null;          // 모르는 코드가 섞이면 판정하지 않는다
  const set = new Set(mapped);
  return set.size === 1 ? [...set][0] : null;
}
