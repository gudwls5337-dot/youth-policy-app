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

/** 조례 안에서 정책과 맞는 조문. 본문에 주제어가 있는 조를 고른다. */
const ART_KEYS = [
  [/면접|정장|자격증|응시료|취업|구직|일경험|인턴/, /취업|일자리|구직|자격|교육훈련|능력개발|고용/],
  [/창업/, /창업/],
  [/주거|월세|임대|보증금|주택/, /주거|주택/],
  [/포인트|활동|참여|서포터즈|동아리|봉사|정책단/, /참여|활동|청년단체|정책단/],
  [/센터|공간|청담|청년몰/, /시설|센터|공간/],
  [/통장|자산|저축|적금/, /자산|금융|경제|복지/],
];
/* 「목적」「정의」「적용범위」「다른 조례와의 관계」는 **근거 조문이 아니다.**
   제1조 목적에는 취업·일자리 같은 말이 다 들어 있어서 아무 정책에나 걸린다.
   실제로 이 제외를 안 했을 때 116건 중 대부분이 「제1조 목적」으로 붙었다. */
const NOT_BASIS = /^(목적|정의|적용\s*범위|다른\s*조례와의\s*관계|기본이념|명칭)/;
const usable = a => a.title && !NOT_BASIS.test(a.title.trim());

function matchArticle(p, ord) {
  if (!ord?.arts?.length) return null;
  const arts = ord.arts.filter(usable);
  if (!arts.length) return null;
  const hay = `${p.nm} ${p.detail?.["지원내용"] || ""}`;
  for (const [pol, art] of ART_KEYS) {
    if (!pol.test(hay)) continue;
    /* 조제목 우선 — 본문은 다른 조를 인용하느라 주제어가 섞여 든다 */
    const byTitle = arts.find(a => art.test(a.title));
    if (byTitle) return byTitle;
    const byBody = arts.find(a => art.test(a.body || ""));
    if (byBody) return byBody;
  }
  /* 주제어로 못 좁히면 사업 지원 근거로 흔히 쓰이는 조. 그것도 없으면 null(원칙 5) */
  return arts.find(a => /지원|시행계획|사업/.test(a.title)) || null;
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
  const art = matchArticle(p, ord);
  const a = range(p.detail?.["신청기간"]);
  const b = range(p.detail?.["사업기간"]) || range(p.period);
  return {
    id: p.id, origin: p.origin, nm: p.nm, field: p.field,
    st: c.st, stSrc: c.src, kind: c.kind,
    /* 사이트가 말한 원본 라벨. 우리 판정과 다르면 화면에서 둘 다 보여준다. */
    raw: p.apply?.state || p.state || null,
    from: a?.from || null, to: a?.to || null,
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
    art: art ? { label: art.label, title: art.title, body: (art.body || "").slice(0, 400) } : null,
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
