/**
 * 양산 청년정책 화면 데이터 — 청년가까e + 양산 조례 전문을 합친다.
 *
 *   node scripts/build-yangsan.mjs
 *
 * 출력  docs/data/yangsan.json
 *
 * ── 상태 4분류 (요구 3) ────────────────────────────────────────────
 * 근거를 **우선순위대로** 쓰고, 무엇으로 판정했는지 `src` 에 남긴다(원칙 4).
 *
 *   ① 온라인신청 목록의 상태   실제로 접수를 받는 시스템이다. 최우선.
 *   ② 정책 목록의 상태 배지    같은 사이트지만 마감일 당일을 이미 마감으로 친다.
 *   ③ 신청기간 날짜범위        전용 필드다. 자유텍스트가 아니라 파싱해도 된다.
 *   ④ 사업기간만 있고 신청기간이 비었으면  → 상시·수시
 *   ⑤ 아무것도 없으면 미상. **추정하지 않는다**(원칙 5).
 *
 * ①과 ②가 충돌하면 ①을 택한다. 2026-07-31 실측에서 면접비 3차와 활동포인트제
 * 7월이 목록에선 「접수마감」인데 신청 시스템은 「접수중」이었고 신청자가 실제로
 * 차 있었다(51/180, 44/500). 마감일 당일을 마감으로 표시하면 **오늘 신청할 수
 * 있는 사업을 못 하는 것처럼 보여준다.**
 *
 * ── 온통청년 미러 (중요) ──────────────────────────────────────────
 * 청년가까e 목록 118건 중 24건은 id 가 `R2024092626731` 꼴이다 — 온통청년에서
 * 끌어온 것이고 상태·기간이 비어 있다. 시가 직접 등록한 94건과 성질이 다르므로
 * **현황 숫자에서 분리한다.** 섞으면 「등록이 없다」를 또 「없다」로 읽게 된다.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const latest = re => readdirSync(join(ROOT, "data")).filter(f => re.test(f)).sort().pop();
const load = f => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8"));

const PF = latest(/수집_양산청년정책_전수\.json$/);
const OF = latest(/수집_양산조례_조문\.json$/);
if (!PF || !OF) { console.error("수집 파일이 없습니다. collect:yangsan / collect:yangsan-ord 를 먼저 돌리세요."); process.exit(1); }
const POL = load(PF), ORD = load(OF);
const TODAY = POL.date;

/* ── 기간 파싱 ── */
const D_RE = /(\d{4})[-.\s]+(\d{1,2})[-.\s]+(\d{1,2})/g;
const pad = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** 「2026-08-01 ~ 2026-08-31」 → {from,to}. 날짜가 없으면 null. */
function range(s) {
  if (!s) return null;
  const ms = [...String(s).matchAll(D_RE)].map(m => pad(m[1], m[2], m[3]));
  if (!ms.length) return null;
  return { from: ms[0], to: ms[1] ?? null };
}

/** 원문이 **계속 시행**을 말하는가. 사업기간 칸이 올해로 끝나 있어도
 *  본문에 「매년 추진」·「2028. 2.까지」·「연중」이 적혀 있으면 종료가 아니다.
 *  감사에서 3건 확인됐다 — 군복무 상해보험(매년 추진), 대학일자리플러스센터
 *  (지원기간 2022.3~2028.2), 국토부 청년월세(2024.2~2026.12). 원칙 2 —
 *  「저기 있다」보다 **「우리는 없다」가 위험하다.** 종료를 함부로 단정하지 않는다. */
const CONT_RE = /매년\s*(사업\s*)?(추진|시행)|연중\s*(상시|운영|시행)?|계속\s*사업|최대\s*\d+\s*년|(지원|사업)\s*기간\s*:?\s*20\d\d[.\s]*\d{1,2}[.\s]*~\s*20(2[7-9]|[3-9]\d)/;
const contOf = p => {
  const t = `${p.detail?.["지원내용"] || ""} ${p.detail?.["신청안내"] || ""} ${p.detail?.["사업기간"] || ""}`;
  const m = t.match(CONT_RE);
  if (!m) return null;
  const i = Math.max(0, m.index - 40);
  return t.slice(i, i + 130).replace(/\s+/g, " ").trim();
};

/* ── 상태 판정 ── */
const CLS = { "접수중": "진행", "접수예정": "예정", "접수마감": "종료" };
function classify(p) {
  const ap = p.apply?.state && CLS[p.apply.state];
  if (ap) return { st: ap, src: "온라인신청 시스템", kind: "기간" };
  const bd = p.state && CLS[p.state];
  if (bd) return { st: bd, src: "청년가까e 상태 표시", kind: "기간" };

  const a = range(p.detail?.["신청기간"]);
  if (a?.from) {
    const st = a.from > TODAY ? "예정" : (a.to && a.to < TODAY) ? "종료" : "진행";
    return { st, src: "신청기간", kind: "기간" };
  }
  /* 신청기간이 비었는데 사업기간이 오늘을 품으면 상시·수시로 본다.
     「청년날개 FIT」이 이 경우다 — 온통청년엔 마감인데 실제로는 연중 운영. */
  const b = range(p.detail?.["사업기간"]) || range(p.period);
  if (b?.from) {
    if (b.to && b.to < TODAY) return { st: "종료", src: "사업기간", kind: "기간" };
    if (b.from > TODAY) return { st: "예정", src: "사업기간", kind: "기간" };
    return { st: "진행", src: "사업기간", kind: "상시" };
  }
  return { st: "미상", src: null, kind: null };
}

/* ── 조례 매칭 (요구 4) ──
   정책명·지원내용을 조례 주제어에 맞춘다. 못 맞추면 기본 조례로 폴백하되
   「직접 근거 조문 아님」을 명시한다. 억지로 조문을 붙이면 틀린 근거가 된다. */
/* 순서가 곧 우선순위다. 주거·자산처럼 **양산에 전담 조례가 없는 주제**를 먼저
   기본 조례로 보내지 않으면, 지원내용에 섞인 「취업」 한 단어 때문에
   「청년주택 임차보증금 이자지원」이 일자리 조례로 붙는다(2026-07-31 실측). */
const ORD_KEYS = [
  [/농업|영농|농촌|농업인/, "청년농업인"],
  [/고립|은둔/, "고립·은둔"],
  [/가족돌봄|영케어러|돌봄청년/, "가족돌봄"],
  [/자립준비|보호종료|보호대상아동/, "자립준비"],
  [/군복무|상해보험|제대군인/, "군복무"],
  [/청년친화도시/, "청년친화도시"],
  [/주거|주택|임차|임대|보증금|월세|기숙사/, null],   // 전담 조례 없음 → 기본
  [/통장|자산형성|저축|적금/, null],                   // 전담 조례 없음 → 기본
  [/일자리|취업|면접|자격증|창업|일경험|인턴|채용|구직|Pre-?Job/i, "청년일자리"],
];
const ordBy = frag => ORD.ordinances.find(o => o.name.includes(frag));
const BASE = ordBy("청년 기본");

/* ── 조문 고르기 ── (2026-07-31 감사 후 전면 재작성)
   이전 규칙은 표본 38건 중 8건(21%)만 근거로 쓸 수 있었다. 원인 셋.
     ① 계획수립 조항이 116건 중 67건을 차지했다. 「기본계획을 수립하여야 한다」는
        시장에게 계획을 명하는 절차 조항이지 개별 사업의 지출 근거가 아니다.
        기본 조례 제7조는 전문이 한 문장뿐이라 어떤 사업의 근거도 될 수 없다.
     ② 정답 조문을 통째로 안 썼다. 기본 조례 제14조(청년정책사업지원)는 7개 호가
        앱 분야와 1:1 대응하는 **유일한 지출 근거 조문**인데 0건 쓰였다. 폴백이
        조번호 순으로 먼저 걸리는 제7조를 집었다 — 순수한 정렬 사고다.
     ③ 대응 조문이 없는 정책(출산·보육·1인가구·장학)에도 억지로 붙였다.

   그래서 **허용 목록(whitelist)** 으로 뒤집는다. 조례마다 「사업 근거 조문」이
   하나씩 있고 그게 기본값이다. 더 정확한 조가 있을 때만 그리로 간다.
   대응이 없으면 null — 억지로 붙이면 그게 반증거리가 된다. */

/** 조제목이 이러면 **절대 근거가 아니다.** 계획·책무·정의·절차 조항. */
const NOT_BASIS = /^(목적|기본이념|정의|적용\s*범위|다른\s*조례와의\s*관계|명칭|.*책무|.*기본계획|.*계획의?\s*수립|시행계획.*|.*실태조사|.*정책\s*연구|정책연구.*|.*위원회.*|위원.*|.*포상|시행규칙|준용|.*홍보.*|.*협력체계.*|전문가\s*활용|.*발굴|신청\s*및\s*선정|.*조성\s*원칙)/;

/** 그 조례의 **사업 근거 조문**. 열거형 지출 근거를 가진 조다. */
const anchorOf = ord => (ord?.arts || []).find(a =>
  /^(청년정책사업지원|지원사업|추진.{0,2}지원\s*사업|지원)$/.test((a.title || "").trim()));

/** 주제별 특례 — 사업 근거 조문보다 더 정확한 조가 있는 경우만. */
const ART_SPECIAL = [
  [/청년센터|청담|청년\s*공간|커뮤니티\s*공간/, /청년센터\s*설치|청년시설의?\s*설치/],
  [/청년정책단|참여기구|정책\s*참여|서포터즈|기획단/, /청년정책단|청년의\s*참여\s*확대/],
  [/제대군인|군\s*의무복무|복무기간/, /의무복무\s*제대군인/],
  [/대학|학교\s*연계|산학/, /교육기관의?\s*활용/],
  [/위탁\s*운영|수탁/, /업무의?\s*위탁|사무의?\s*위탁/],
  [/상해보험|보험금/, /가입대상|보험계약/],
];

/** 이 정책이 **다른 조례** 를 자기 근거로 밝히고 있는가.
 *  그러면 우리가 붙일 청년 조례는 근거가 아니다 — 화면에 띄우면 자백이 된다. */
const CITES_OTHER = /「([^」]{4,40}(조례|법))」\s*제\s*\d+\s*조/;
/** 청년정책이 아닌 게 섞여 있다. 출산·보육·다자녀·1인가구·장학 계열. */
const NOT_YOUTH = /출산|산후|임신|다둥이|보육|1인\s*가구|일인가구|장학|아침밥|신혼부부/;

function matchArticle(p, ord, frag) {
  if (!ord?.arts?.length) return null;
  const hay = `${p.nm} ${p.detail?.["지원내용"] || ""}`;
  const cited = hay.match(CITES_OTHER);
  /* 본문이 다른 조례를 근거로 명시했는데 그게 우리가 고른 조례가 아니면 손 뗀다 */
  if (cited && !ord.name.includes(cited[1].replace(/^양산시\s*/, "").slice(0, 6))) return null;
  /* 전담 조례를 못 찾았고(기본 조례 폴백) 청년정책도 아니면 붙일 게 없다 */
  if (!frag && NOT_YOUTH.test(hay)) return null;

  const arts = ord.arts.filter(a => a.title && !NOT_BASIS.test(a.title.trim()));
  if (!arts.length) return null;

  for (const [pol, art] of ART_SPECIAL) {
    if (!pol.test(hay)) continue;
    const hit = arts.find(a => art.test(a.title));
    if (hit) return hit;
  }
  return anchorOf(ord) || null;
}

/** 화면에 띄울 인용문. **원문 그대로**여야 한다.
 *  - 문자를 바꾸지 않는다(가운뎃점 치환 금지) → raw 를 쓴다
 *  - 개정 이력 꼬리표는 조문이 아니다
 *  - 자를 때는 **문장 경계**에서 자른다. 어절 중간에서 끊으면 인용으로 못 쓴다 */
function quoteOf(a, max = 420) {
  let t = (a.raw || a.body || "").replace(/\s*\[[^\]]*(이동|신설|개정)[^\]]*\]\s*$/g, "").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf("다."), cut.lastIndexOf("한다"), cut.lastIndexOf(". "));
  return (end > max * 0.5 ? cut.slice(0, end + 2) : cut.replace(/\S*$/, "")).trim() + " …";
}

/* ── 전화 정규화 ── */
const TEL = s => {
  const m = String(s || "").match(/(\d{2,4})[-)]\s?(\d{3,4})-(\d{4})/) || String(s || "").match(/(\d{3,4})-(\d{4})/);
  if (!m) return null;
  return m.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `055-${m[1]}-${m[2]}`;
};
const DEPT = s => String(s || "").replace(/\(☎[^)]*\)/g, "").replace(/\s*\(.*?\d.*?\)\s*/g, "").trim() || null;

/* ── 조립 ── */
const out = POL.policies.map(p => {
  const c = classify(p);
  const hit = ORD_KEYS.find(([re]) => re.test(`${p.nm} ${p.detail?.["지원내용"] || ""}`));
  const frag = hit?.[1] ?? null;                  // null 이면 전담 조례가 없다는 뜻
  const ord = (frag && ordBy(frag)) || BASE;
  const art = matchArticle(p, ord, frag);
  const a = range(p.detail?.["신청기간"]);
  const b = range(p.detail?.["사업기간"]) || range(p.period);
  return {
    id: p.id, origin: p.origin, nm: p.nm, field: p.field,
    st: c.st, stSrc: c.src, kind: c.kind,
    /* 사이트가 말한 원본 라벨. 우리 판정과 다르면 화면에서 둘 다 보여준다. */
    raw: p.apply?.state || p.state || null,
    from: a?.from || null, to: a?.to || null,
    /* 종료로 판정했지만 원문이 계속 시행을 말하는 경우. 화면에서 배지를
       「등록상 종료」로 낮추고 이 인용을 띄운다. */
    contHint: c.st === "종료" && c.src === "사업기간" ? contOf(p) : null,
    bizFrom: b?.from || null, bizTo: b?.to || null,
    applied: p.apply?.applied ?? null, capacity: p.apply?.capacity ?? null,
    /* 그 사업의 신청 페이지 직링크. 공고문 링크가 없는 사업이 68/94 라서,
       이게 있으면 「신청하러 가기」가 진짜 신청 화면으로 간다. */
    applyUrl: p.apply?.tbl && p.apply?.id
      ? `https://www.yangsan.go.kr/youth/plcyPrgrm/${p.apply.tbl}/view.do?mngSn=${p.apply.id}` : null,
    body: p.detail?.["지원내용"] || null,
    howto: p.detail?.["신청안내"] || null,
    link: p.detail?.["신청사이트"] || null,
    org: p.org || null,
    dept: DEPT(p.org), tel: TEL(p.org),
    /* 사업 담당 전화가 없으면(94건 중 대부분) 조례 소관부서 번호를 대신 쓴다.
       단 **같은 번호가 아니다**. 어디 번호인지 화면에 밝히지 않으면
       "이 사업 담당 아닌데요" 소리를 듣는다 — telSrc 로 구분한다. */
    telSrc: TEL(p.org) ? "사업" : (ord?.tel ? "조례소관" : null),
    telFallback: TEL(p.org) ? null : (ord?.tel || null),
    ord: ord ? { name: ord.name, mst: ord.mst, dept: ord.dept, tel: ord.tel } : null,
    art: art ? { label: art.label, title: art.title, body: quoteOf(art) } : null,
    /* true = 그 주제 전담 조례를 찾음. false = 전담 조례가 없어 기본 조례로 갔다. */
    exact: !!frag,
  };
});

const self = out.filter(p => p.origin === "self");
const mirror = out.filter(p => p.origin === "ontong");
const tally = list => list.reduce((a, p) => {
  const k = p.st === "진행" ? (p.kind === "상시" ? "진행_상시" : "진행_기간") : p.st;
  return (a[k] = (a[k] || 0) + 1, a);
}, {});

const doc = {
  city: "경상남도 양산시",
  date: POL.date,
  ordDate: ORD.date,
  source: { policy: POL.source, home: POL.home, ord: ORD.source },
  counts: { total: out.length, self: self.length, mirror: mirror.length, ...tally(self) },
  ordinances: ORD.ordinances.map(o => ({
    name: o.name, mst: o.mst, dept: o.dept, tel: o.tel, arts: o.arts?.length || 0,
    revision: o.revision, effective: o.effective,
  })),
  policies: out,
};

writeFileSync(join(ROOT, "docs/data/yangsan.json"), JSON.stringify(doc, null, 0), "utf8");

console.log(`양산 화면 데이터 — 기준 ${POL.date}`);
console.log(`  전체 ${out.length} = 시 등록 ${self.length} + 온통청년 미러 ${mirror.length}`);
console.log(`  시 등록 상태: ${JSON.stringify(tally(self))}`);
console.log(`  판정 근거: ${JSON.stringify(self.reduce((a, p) => (a[p.stSrc || "없음"] = (a[p.stSrc || "없음"] || 0) + 1, a), {}))}`);
console.log(`  조례 연결: 주제 일치 ${out.filter(p => p.exact).length} · 기본조례 폴백 ${out.filter(p => !p.exact).length}`);
console.log(`  조문 인용 확보 ${out.filter(p => p.art).length}/${out.length}`);
console.log(`  정원 확보 ${out.filter(p => p.capacity != null).length}건 · 부서 전화 ${out.filter(p => p.tel).length}건`);
console.log(`  ${(Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0)}KB → docs/data/yangsan.json`);
