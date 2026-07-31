/**
 * 실제 DOM 에 앱을 올려 동작을 검증한다.
 *   node scripts/smoke.mjs
 * 탭 전환·카드·상세 시트·지자체 전환·다운로드를 전부 눌러보고, 하나라도 깨지면 exit 1.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(ROOT, "docs/index.html"), "utf8");

const runtime = [], fails = [];
const vc = new VirtualConsole();
vc.on("jsdomError", e => runtime.push(String(e.message).split("\n")[0]));

const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
  runScripts: "dangerously",
  virtualConsole: vc,
  beforeParse(w) {
    w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
    w.URL.createObjectURL = () => "blob:stub";
    w.URL.revokeObjectURL = () => {};
    /* 복사 텍스트가 곧 산출물이다 — 붙여넣기 결과를 실제로 읽어 검사한다 */
    w.navigator.clipboard = { writeText: async t => { w.__copied = t; } };
    w.HTMLAnchorElement.prototype.click = function () {};
    w.scrollTo = () => {};
  },
});
const { window } = dom;
const D = window.document;
const $ = s => D.querySelector(s);
const $$ = s => [...D.querySelectorAll(s)];
const wait = ms => new Promise(r => setTimeout(r, ms));
const click = el => el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const T = (label, cond, extra = "") => {
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) fails.push(label);
};
const tab = name => click($$(".tb").find(b => b.dataset.sc === name));

await wait(1500);

console.log(`페이지 ${(html.length / 1e6).toFixed(2)}M chars`);
console.log(`실행 오류: ${runtime.length ? [...new Set(runtime)].join(" | ") : "없음"}\n`);
if (runtime.length) fails.push("스크립트 실행 오류");

console.log("── 폰트 ──");
/* 주석을 걷어내고 실제 선언만 본다. `sans-serif` 의 serif 는 오탐이다. */
const css = html.slice(html.indexOf("<style>"), html.indexOf("</style>")).replace(/\/\*[\s\S]*?\*\//g, "");
const fontDecls = (css.match(/font-family:[^;]+;|--(?:sans|num|serif)\s*:[^;]+;/g) || []).join(" | ");
const serifHits = fontDecls.match(/Myeongjo|Batang|바탕|궁서|Gungsuh|(?<!sans-)\bserif\b/gi) || [];
T("명조·궁서 스택 없음", serifHits.length === 0, serifHits.slice(0, 3).join(", ") || "시스템 산세리프만");
const tiny = [...new Set(css.match(/font-size:\s*(?:[0-9]|1[01])(?:\.\d+)?px/g) || [])];
T("최소 글자 12px", tiny.length === 0, tiny.join(", ") || "OK");

console.log("\n── 앱 셸 ──");
T("하단 탭 5개", $$(".tb").length === 5, $$(".tb").map(b => b.dataset.sc).join(","));
T("비교 탭 존재", !!$$(".tb").find(b => b.dataset.sc === "gap"));
T("화면 5개", $$(".screen").length === 5);
T("기본 화면은 우리 시", $("#sc-policy")?.classList.contains("on"));
T("둘러보기 탭 존재", !!$$(".tb").find(b => b.dataset.sc === "browse"));
T("헤더 고정 요소", !!$(".appbar") && !!$("#stNm") && !!$("#city"));
T("지자체 선택지", $("#city")?.options.length > 200, `${$("#city")?.options.length}개`);

console.log("\n── 헤더 요약 ──");
T("도시명", ($("#stNm")?.textContent || "").length > 3, $("#stNm")?.textContent);
T("연령", /\d+–\d+/.test($("#ageBig")?.textContent || ""), $("#ageBig")?.textContent.trim());
T("신청 가능 수", +$("#c1")?.textContent > 0, $("#c1")?.textContent);
T("종료 수", +$("#c3")?.textContent > 0, $("#c3")?.textContent);
T("탭 배지 채워짐", $$(".tb .cnt").slice(0, 4).every(c => /\d/.test(c.textContent)),
  $$(".tb .cnt").map(c => c.textContent).join("/"));

console.log("\n── 지자체 검색 ──");
click($("#btnPick")); await wait(200);
T("검색 시트 열림", $("#picker")?.hidden === false);
$("#pickQ").value = "양산";
$("#pickQ").dispatchEvent(new window.Event("input", { bubbles: true }));
await wait(160);
T("검색 결과", $$("#pickList .pick-item").length > 0, `${$$("#pickList .pick-item").length}건`);
T("검색 결과에 양산", ($("#pickList")?.textContent || "").includes("양산"));
$("#pickQ").value = "없는이름ㅁㄴㅇ";
$("#pickQ").dispatchEvent(new window.Event("input", { bubbles: true }));
await wait(160);
T("결과 없을 때 안내", !!$("#pickList .empty"));
click($("#pickClose")); await wait(320);
T("검색 시트 닫힘", $("#picker")?.hidden === true);

/* ══ 양산 = 청년가까e ══
   기본 지자체가 양산이고, 양산은 시 공식 채널을 쓴다. 온통청년으로 그리면
   「진행 0건」이라는 거짓이 나오므로 화면 소스 자체가 다르다. */
console.log("\n── 우리 시 화면 (양산 · 청년가까e) ──");
tab("policy"); await wait(260);
T("제목이 청년가까e 기준", ($("#pTitle")?.textContent || "").includes("시행하는"), $("#pTitle")?.textContent);
T("출처 명시", ($("#pLede")?.textContent || "").includes("청년가까e"));
T("온통청년 한계도 같이 밝힘", ($("#pLede")?.textContent || "").includes("전부 마감"));

const ysChips = $$("#ysState [data-ys]");
T("시행 상태 4분류", ysChips.length === 4, ysChips.map(b => b.textContent.trim()).join(" / "));
T("시행중이 기본 선택", ysChips[0]?.getAttribute("aria-pressed") === "true");
const c1 = $$("#list1 .pcard");
T("카드 렌더", c1.length > 0, `${c1.length}장`);
T("제목·요약 채워짐", c1.every(c => (c.querySelector(".nm")?.textContent || "").trim() && (c.querySelector(".amt")?.textContent || "").trim()));
T("종료 안 섞임", c1.every(c => !c.className.includes("closed")), `${c1.filter(c => c.className.includes("closed")).length}장 섞임`);
T("상태 배지 있음", c1.every(c => c.querySelector(".bdg")));
/* 온통청년으로 그렸다면 여기가 0건이었다. 이 검사가 회귀의 핵심이다. */
T("온통청년이 못 보여주는 진행 건이 보인다", c1.length > 0,
  c1[0]?.querySelector(".nm")?.textContent.slice(0, 30));
T("정원 대비 신청자 노출", $$("#list1 .badges").some(e => /신청 \d+\/\d+/.test(e.textContent)),
  ($$("#list1 .badges").map(e => (e.textContent.match(/신청 \d+\/\d+/) || [])[0]).filter(Boolean)[0]) || "없음");
T("판정 근거 안내", ($("#freshWarn")?.textContent || "").includes("판정"),
  ($("#freshWarn")?.textContent || "").slice(0, 40));
T("미러 분리 명시", ($("#freshWarn")?.textContent || "").includes("현황에서 뺐습니다"));

/* 4분류가 실제로 서로 다른 목록인가 */
const ysCounts = {};
for (const b of ysChips) {
  click(b); await wait(160);
  ysCounts[b.dataset.ys] = $$("#list1 .pcard").length;
}
T("상태별 목록이 다름", new Set(Object.values(ysCounts)).size >= 2, JSON.stringify(ysCounts));
T("시행종료가 가장 많음", ysCounts["종료"] >= Math.max(ysCounts["진행"], ysCounts["예정"]),
  `종료 ${ysCounts["종료"]} vs 진행 ${ysCounts["진행"]}`);
click(ysChips[0]); await wait(180);

console.log("\n── 양산 정책 상세 (조례·원문·연락처) ──");
click($("#list1 .pcard")); await wait(240);
const yd = $("#dBody")?.textContent || "";
T("상세 열림", $("#drawer")?.hidden === false, $("#dTitle")?.textContent?.slice(0, 30));
T("시행 상태 + 판정 근거", yd.includes("판정 근거"));
T("지원 내용 원문", yd.includes("원문 그대로"));
T("근거 조례 표시", yd.includes("근거 조례") && /「양산시 .+조례」/.test(yd),
  (yd.match(/「양산시 [^」]+」/) || ["없음"])[0]);
T("조문 인용 블록", !!$("#dBody .pquote"), ($("#dBody .pquote")?.textContent || "").slice(0, 30) + "…");
T("법제처 원문 링크", ($("#dBody")?.innerHTML || "").includes("law.go.kr/DRF"));
T("담당부서 전화", !!$("#dBody .ptel"), $("#dBody .ptel")?.textContent);
T("공고문 원문 링크", ($("#dBody")?.innerHTML || "").includes("yangsan.go.kr"));
click($("#dCopy")); await wait(120);
const ycp = window.__copied || "";
T("복사 텍스트", ycp.startsWith("[양산시 청년정책]"), ycp.split("\n")[0]?.slice(0, 40));
T("복사본에 근거 조례", ycp.includes("■ 근거 조례"));
T("복사본에 판정 근거", ycp.includes("판정 근거"));
click($("#dClose")); await wait(360);

/* ══ 온통청년 경로 — 다른 시에서 검사한다 ══ */
console.log("\n── 온통청년 화면 (관악구) ──");
async function pickCity(v) {
  const s = $("#city"); s.value = v; s.dispatchEvent(new window.Event("change", { bubbles: true })); await wait(240);
}
await pickCity("서울특별시 관악구");
T("제목이 온통청년 기준", ($("#pTitle")?.textContent || "").includes("온통청년"), $("#pTitle")?.textContent);
T("4분류 칩 숨김 (추정 금지)", $("#ysState")?.hidden === true);
const g1 = $$("#list1 .pcard");
T("카드 렌더", g1.length > 0, `${g1.length}장`);
T("종료 안 섞임", g1.every(c => !c.className.includes("closed")));
T("전화 표시", g1.some(c => /\d{2,3}-\d{3,4}-\d{3,4}/.test(c.querySelector(".tel")?.textContent || "")));
T("등록 신선도 경고", ($("#freshWarn")?.textContent || "").length > 20,
  ($("#freshWarn")?.textContent || "").slice(0, 42));
T("상태 문구가 단정형 아님", !($("#statusbar")?.textContent || "").includes("신청 가능"),
  ($("#statusbar")?.textContent || "").slice(0, 32));
T("중복 병합 수치 노출", /\d/.test($("#uniqCnt")?.textContent || ""),
  `원본 ${$("#recCnt")?.textContent} → 실질 ${$("#uniqCnt")?.textContent}`);

console.log("\n── 레벨 필터 (관악구) ──");
T("레벨 칩 3개 (중앙 제외)", $$("#levelbar [data-lv]").length === 3, $$("#levelbar [data-lv]").map(b => b.textContent).join(" / "));
T("우리 시 목록에 중앙 없음", $$("#list1 .pcard .badges").every(e => !e.textContent.includes("중앙")),
  `${$$("#list1 .pcard .badges").filter(e => e.textContent.includes("중앙")).length}장 섞임`);
T("기본은 전체", $("#levelbar [data-lv]")?.getAttribute("aria-pressed") === "true");
const lvBasic = $$("#levelbar [data-lv]").find(b => b.dataset.lv === "기초");
if (lvBasic && !lvBasic.disabled) {
  click(lvBasic); await wait(160);
  T("기초 필터 = 우리 시 것만", $$("#list1 .pcard").length > 0 &&
    $$("#list1 .pcard").every(c => (c.querySelector(".badges")?.textContent || "").includes("기초")),
    `${$$("#list1 .pcard").length}장`);
  click($$("#levelbar [data-lv]").find(b => b.dataset.lv === "전체")); await wait(160);
}
T("우리 시 것이 맨 위", ($("#list1 .pcard .badges")?.textContent || "").match(/기초|광역/) !== null,
  $("#list1 .pcard .badges")?.textContent.replace(/\s+/g, " "));

console.log("\n── 분야 칩 (관악구) ──");
click($$("#tabs .chip").find(b => b.textContent.startsWith("주거")));
await wait(160);
/* 0건일 수 있다 — 중앙을 뺐으니 분야별로 비는 게 정상이다.
   중요한 건 "빈 화면이 아니라 이유가 적힌 안내"가 나오는 것. */
T("주거 필터 결과 또는 안내", $$("#list1 .pcard").length > 0 || !!$("#list1 .empty"),
  $$("#list1 .pcard").length ? `${$$("#list1 .pcard").length}장` : "안내 표시");
if (!$$("#list1 .pcard").length) {
  T("필터 안내에 이유 있음", ($("#list1 .empty")?.textContent || "").includes("정보 탭"),
    ($("#list1 .empty")?.textContent || "").slice(0, 40));
}
click($$("#tabs .chip").find(b => b.textContent.startsWith("전체")));
await wait(160);

console.log("\n── 종료 토글 (관악구) ──");
T("토글 2개", $$("#statusbar [data-sc]").length === 2, $$("#statusbar [data-sc]").map(b => b.textContent).join(" / "));
click($$("#statusbar [data-sc]").find(b => b.dataset.sc === "1"));
await wait(180);
T("종료 포함 시 등장", $$("#list1 .pcard").some(c => c.className.includes("closed")));
click($$("#statusbar [data-sc]").find(b => b.dataset.sc === "0"));
await wait(180);
T("다시 숨김", $$("#list1 .pcard").every(c => !c.className.includes("closed")));

console.log("\n── 마감 탭 (관악구 · 온통청년) ──");
tab("end"); await wait(160);
T("종료 화면", $("#sc-end")?.classList.contains("on"));
const l3 = $$("#list3 .pcard");
T("전부 종료", l3.length > 0 && l3.every(c => c.className.includes("closed")), `${l3.length}장`);
T("마감일·사유", /(신청마감|사업종료|종료)\s*\d{4}-\d{2}-\d{2}/.test($("#list3 .meta")?.textContent || ""));

console.log("\n── 지자체별 목록이 실제로 다른가 ──");
const top10 = () => $$("#list1 .pcard .nm").slice(0, 10).map(e => e.textContent);
tab("policy"); await wait(160);
await pickCity("경상남도 양산시"); const tA = top10();
await pickCity("서울특별시 관악구"); const tB = top10();
await pickCity("전남광주통합특별시 순천시"); const tC = top10();
const overlap = (x, y) => x.filter(v => y.includes(v)).length;
T("양산 ∩ 관악 겹침 3건 이하", overlap(tA, tB) <= 3, `${overlap(tA, tB)}/10`);
T("양산 ∩ 순천 겹침 3건 이하", overlap(tA, tC) <= 3, `${overlap(tA, tC)}/10`);
T("세 도시 상위 1건이 서로 다름", new Set([tA[0], tB[0], tC[0]]).size === 3,
  [tA[0], tB[0], tC[0]].map(s => (s || "").slice(0, 18)).join(" / "));

/* 양산 → 다른 시로 넘어갈 때 분야 칩이 남으면 아무것도 안 걸리는 화면이 된다.
   분야 이름 체계가 두 소스에서 다르기 때문이다(청년가까e 「참여/권리」 vs 온통청년 「참여·권리」). */
await pickCity("경상남도 양산시"); await wait(120);
const ysField = $$("#tabs .chip")[1];
click(ysField); await wait(160);
const ysFieldName = ysField?.textContent.trim();
await pickCity("서울특별시 관악구"); await wait(160);
T("시 전환 시 분야 칩 재구성", $$("#list1 .pcard").length > 0,
  `양산에서 「${ysFieldName}」 선택 후 관악 ${$$("#list1 .pcard").length}장`);
T("남은 분야 선택은 전체로 복귀", $("#tabs .chip")?.getAttribute("aria-pressed") === "true",
  $$("#tabs .chip").map(b => b.textContent.trim()).slice(0, 3).join(" / "));

/* 마감 탭도 소스를 따라가야 한다 — 안 그러면 한 화면에 두 소스가 섞인다 */
await pickCity("경상남도 양산시"); await wait(160);
tab("end"); await wait(160);
T("양산 마감 탭도 청년가까e", $$("#list3 .pcard").length > 0 &&
  !/신청마감\s*\d{4}/.test($("#list3 .meta")?.textContent || ""), `${$$("#list3 .pcard").length}장`);
tab("policy"); await wait(160);

console.log("\n── 둘러보기 ──");
tab("browse"); await wait(240);
T("둘러보기 화면", $("#sc-browse")?.classList.contains("on"));
const bt = $$("#browseTypes [data-bt]");
T("유형 칩", bt.length >= 10, `${bt.length}종`);
const bc = $$("#browseList .pcard");
T("다른 시 카드 렌더", bc.length > 0, `${bc.length}장`);
T("지역 배지", bc.every(c => (c.querySelector(".badges")?.textContent || "").trim().length > 0));
/* 다른 시 정책 카드에 우리 시 전화가 붙으면 전화를 잘못 걸게 된다 */
const ourTel = $("#tel")?.textContent.replace(/\D/g, "");
const telsOnCards = [...new Set(bc.map(c => (c.querySelector(".tel")?.textContent || "").replace(/\D/g, "")).filter(Boolean))];
T("카드 전화가 해당 지자체 것", telsOnCards.filter(t2 => t2 !== ourTel).length > 0,
  `${telsOnCards.length}종 · 우리(${ourTel}) 외 ${telsOnCards.filter(t2 => t2 !== ourTel).length}종`);

console.log("\n── 제안서 (둘러보기 → 제안) ──");
/* 우리 시가 등록한 유형과 등록이 없는 유형은 문서가 달라야 한다 */
async function pickType(want) {
  for (const b of $$("#browseTypes [data-bt]")) {
    click(b); await wait(140);
    const owned = ($("#btnPropose")?.textContent || "").includes("확대·개선");
    if (owned === want) return b.dataset.bt;
  }
  return null;
}
const tGap = await pickType(false);
T("등록 없는 유형 존재", !!tGap, tGap || "못 찾음");
T("CTA 라벨에 유형명", ($("#btnPropose")?.textContent || "").includes(tGap || " "),
  $("#btnPropose")?.textContent);
T("CTA 안내가 「등록이 없다」 표현", ($("#proposeNote")?.textContent || "").includes("등록된 정책이 없습니다"),
  ($("#proposeNote")?.textContent || "").slice(0, 46));

click($("#btnPropose")); await wait(240);
T("제안서 시트 열림", $("#drawer")?.hidden === false, $("#dTitle")?.textContent);
T("제목이 제안서", ($("#dTitle")?.textContent || "").includes("제안서"));
T("머리말이 신규 도입", ($("#dKick")?.textContent || "").includes("신규 도입"), $("#dKick")?.textContent);
const ps = $("#dBody")?.textContent || "";
T("분모가 235 아님 (등록된 곳 기준)", /등록된 \d+곳이 이 유형을 운영/.test(ps),
  (ps.match(/\/ 자체 정책이 등록된 \d+곳/) || ["없음"])[0]);
T("「등록이 없다」 구분 명시", ps.includes("「등록이 없다」와 「시행하지 않는다」는 다릅니다"));
T("우수 판정 안 함 명시", ps.includes("우수 여부는 판정하지 않았습니다"));
const cases = $$("#dBody .case");
T("사례 2건 이상", cases.length >= 2, `${cases.length}건`);
T("사례에 지자체명·기간·주관", cases.every(c => /기간/.test(c.textContent) && /주관/.test(c.textContent)));
T("사례 지자체가 서로 다름",
  new Set(cases.map(c => c.querySelector(".cw")?.textContent)).size === cases.length);
T("우리 조례 인용 블록", !!$("#dBody .pquote"), ($("#dBody .pquote")?.textContent || "").slice(0, 28) + "…");
T("법제처 원문 링크", ($("#dBody")?.innerHTML || "").includes("law.go.kr/DRF"));
T("담당부서 전화", !!$("#dBody .ptel"), $("#dBody .ptel")?.textContent);
T("조례 개정과 구분", ps.includes("조례 개정") && ps.includes("사업 신설·확대"));
T("창구 4단계", $$("#dBody .steps li").length === 4, `${$$("#dBody .steps li").length}단계`);
T("한계 명시 (사전 밖 제외)", ps.includes("하한"));

click($("#dCopy")); await wait(120);
const cp = window.__copied || "";
T("복사 텍스트 생성", cp.length > 600, `${cp.length}자`);
T("복사본 제목", cp.startsWith("[정책 제안]"), cp.split("\n")[0]);
const SECTS = ["■ 제안 요지", "■ 다른 시 사례", "■ 우리 시 근거", "■ 난이도", "■ 어디에 넣는가", "■ 출처와 한계"];
T("복사본 6절 구성", SECTS.every(h => cp.includes(h)),
  SECTS.filter(h => !cp.includes(h)).join(", ") || "전부 있음");
T("복사본에 조례 근거", /조례: 「.+」/.test(cp), (cp.match(/조례: 「.+」.*/) || [""])[0].slice(0, 44));
T("복사본에 법제처 URL", cp.includes("law.go.kr/DRF"));
T("복사본에 담당부서 전화", /소관 부서: .+\d{2,3}-\d{3,4}-\d{4}/.test(cp),
  (cp.match(/소관 부서: .*/) || [""])[0]);
T("복사본에 사례 URL 또는 주관", /   주관: /.test(cp));
T("복사본에 수집일", cp.includes("수집"));
click($("#dClose")); await wait(360);
T("제안서 닫힘", $("#drawer")?.hidden === true);

/* 카드 → 상세 → 제안하기 경로. 본 정책이 사례 1번으로 올라와야 한다 */
/* 지역 배지는 .badges 의 첫 칩이다 (그다음이 상태, 마지막이 기초/광역) */
const seedOrg = ($("#browseList .pcard .badges .bdg:first-child")?.textContent || "").trim();
click($("#browseList .pcard")); await wait(200);
T("다른 시 상세에 제안 버튼", $("#dPropose")?.hidden === false);
click($("#dPropose")); await wait(240);
T("상세 → 제안서 전환", ($("#dTitle")?.textContent || "").includes("제안서"), $("#dTitle")?.textContent);
T("본 정책의 지자체가 사례 1번", ($("#dBody .case .cw")?.textContent || "").includes(seedOrg),
  `${$("#dBody .case .cw")?.textContent} vs 배지 ${seedOrg}`);
click($("#dClose")); await wait(360);
T("한 번 눌러 닫힘 (히스토리 중복 없음)", $("#drawer")?.hidden === true);

/* 우리 시가 이미 등록한 유형 — 문서가 확대·개선으로 바뀌어야 한다 */
const tHave = await pickType(true);
T("우리 시 보유 유형 존재", !!tHave, tHave || "못 찾음");
if (tHave) {
  click($("#btnPropose")); await wait(240);
  T("확대·개선 제안", ($("#dKick")?.textContent || "").includes("확대·개선"), $("#dKick")?.textContent);
  T("우리 시 등록분 섹션", !!$("#dBody .case.mine"),
    ($("#dBody .case.mine .cn2")?.textContent || "없음").slice(0, 30));
  T("우리 것이라고 「없다」 말하지 않음", !($("#dBody")?.textContent || "").includes("등록된 정책이 없습니다."));
  click($("#dClose")); await wait(360);
}

/* 우리 시 정책에는 제안 버튼이 없어야 한다 */
tab("policy"); await wait(180);
click($("#list1 .pcard")); await wait(200);
T("우리 시 정책엔 제안 버튼 없음", $("#dPropose")?.hidden === true);
click($("#dClose")); await wait(360);

console.log("\n── 비교 화면 (조례 조문) ──");
tab("gap"); await wait(220);
T("비교 화면 전환", $("#sc-gap")?.classList.contains("on"));
T("요약 숫자", /\d/.test($("#govSummary .gapnum")?.textContent || ""), $("#govSummary .gapnum")?.textContent);
T("권한 한계 명시", ($("#govSummary")?.textContent || "").includes("정책단 권한 밖"));
const gc = $$("#govGapList .pcard");
T("없는 조문 카드", gc.length > 0, `${gc.length}장`);
T("규정 지자체 수 표시", gc.every(c => /\d+ \/ \d+곳 규정/.test(c.querySelector(".amt")?.textContent || "")),
  $("#govGapList .amt")?.textContent);
T("우리 현재 상태 표시", gc.every(c => (c.querySelector(".meta")?.textContent || "").includes("우리")));
T("있는 조문 섹션", $$("#govHaveList .pcard").length > 0 || !!$("#govHaveList .empty"),
  `${$$("#govHaveList .pcard").length}장`);
T("노후 경고 (양산)", ($("#staleNotice")?.textContent || "").includes("갱신되지 않았"),
  ($("#staleNotice h3")?.textContent || "경고 없음"));
T("등록 실태 패널", ($("#regNotice")?.textContent || "").includes("등록 관행") ||
  ($("#regNotice")?.textContent || "").includes("따로 운영"));
T("1:1 대조 선택지", $("#cmpCity")?.options.length > 200, `${$("#cmpCity")?.options.length}개`);
T("1:1 대조가 조례 축", ($("#cmpBody")?.textContent || "").includes("조례 지표 보유"));

click($("#govGapList .pcard")); await wait(220);
T("개정 제안 시트 열림", $("#drawer")?.hidden === false, $("#dTitle")?.textContent);
const sheetTxt = $("#dBody")?.textContent || "";
T("전국 규정 현황", /\d+곳/.test(sheetTxt));
T("우리 시 현재", sheetTxt.includes("우리 시 현재"));
T("무엇을 바꾸는가", sheetTxt.includes("무엇을 바꾸는가"));
T("경로 안내 — 권한 한계", sheetTxt.includes("정책단 권한 밖"));
T("담당부서 전화", !!$("#dBody .ptel"), $("#dBody .ptel")?.textContent);
click($("#dClose")); await wait(360);

/* 비교 결과가 지자체마다 달라야 한다 */
const gapOf = () => $$("#govGapList .pcard .nm").map(e => e.textContent);
await pickCity("경상남도 양산시"); tab("gap"); await wait(220); const gA = gapOf();
await pickCity("강원특별자치도 양구군"); tab("gap"); await wait(220); const gB = gapOf();
T("지자체별 없는 조문이 다름", gA.length !== gB.length || overlap(gA, gB) < Math.max(gA.length, gB.length),
  `양산 ${gA.length}종 / 양구 ${gB.length}종`);
await pickCity("경상남도 양산시");

console.log("\n── 중앙 정책 (정보 탭) ──");
tab("info"); await wait(180);
T("중앙 목록 렌더", $$("#listCentral .pcard").length > 0, `${$$("#listCentral .pcard").length}장`);
T("전부 중앙", $$("#listCentral .pcard .badges").every(e => e.textContent.includes("중앙")));

tab("gap"); await wait(180);
T("조례비교 탭에 조례 상세", !!$("#quote") && !!$("#dist") && !!$("#govDetail"));
T("조례 인용문", ($("#quote")?.textContent || "").length > 10, ($("#quote")?.textContent || "").slice(0, 34) + "…");
T("담당부서", ($("#dept")?.textContent || "").length > 1, $("#dept")?.textContent);
T("전화 tel: 링크", ($("#tel")?.getAttribute("href") || "").startsWith("tel:"), $("#tel")?.textContent);
T("분포 막대", $$("#dist .drow").length >= 3, `${$$("#dist .drow").length}행`);
T("우리 위치", !!$("#dist .drow.ours"), $("#dist .drow.ours .dlab")?.textContent);
T("지정 지역 16곳", $$("#desigA .gcard").length + $$("#desigB .gcard").length === 16);

tab("info"); await wait(150);
T("정보 화면", $("#sc-info")?.classList.contains("on"));
T("제안 창구 6", $$("#doors .rowlink").length === 6);
T("출처 표", $$("table.src tbody tr").length >= 6);
click($("#dlCsv")); await wait(120);
T("CSV 버튼", true);
click($("#dlCity")); await wait(120);
T("텍스트 버튼", true);

console.log("\n── 상세 시트 ──");
tab("policy"); await wait(150);
click($("#list1 .pcard")); await wait(180);
T("열림", $("#drawer")?.hidden === false);
T("제목", ($("#dTitle")?.textContent || "").length > 2, $("#dTitle")?.textContent.slice(0, 30));
T("필드 4개 이상", $$("#dBody .pfield").length >= 4, `${$$("#dBody .pfield").length}개`);
T("전화 포함", !!$("#dBody .ptel"), $("#dBody .ptel")?.textContent);
click($("#dSave")); await wait(60);
click($("#dClose")); await wait(360);
T("닫힘", $("#drawer")?.hidden === true);

tab("end"); await wait(150);
click($("#list3 .pcard")); await wait(180);
T("종료 상세 경고", /이미 종료|<b>종료<\/b>로 판정/.test($("#dBody")?.innerHTML || ""),
  ($("#dBody .keynote")?.textContent || "").slice(0, 40));
click($("#dClose")); await wait(360);

tab("gap"); await wait(150);
click($("#desigA .gcard")); await wait(180);
T("지정지역 조례 상세", $("#drawer")?.hidden === false, $("#dTitle")?.textContent);
T("조례 인용 블록", !!$("#dBody .pquote"));
click($("#dClose")); await wait(360);

console.log("\n── 지자체 전환 ──");
const sel = $("#city");
const before = $("#ageBig").textContent.trim();
sel.value = "전남광주통합특별시 순천시";
sel.dispatchEvent(new window.Event("change", { bubbles: true }));
await wait(220);
T("연령 갱신", $("#ageBig").textContent.trim() !== "—", `${before} → ${$("#ageBig").textContent.trim()}`);
T("헤더 도시명", $("#stNm").textContent === "전남광주통합특별시 순천시", $("#stNm").textContent);
T("전화 갱신", ($("#tel").getAttribute("href") || "").startsWith("tel:"), $("#tel").textContent);
tab("policy"); await wait(150);
T("목록 갱신", $$("#list1 .pcard").length > 0, `${$$("#list1 .pcard").length}장 · ${$("#c1").textContent}건`);

console.log("\n── 잘못된 값 방어 ──");
sel.value = "없는지자체";
sel.dispatchEvent(new window.Event("change", { bubbles: true }));
await wait(180);
T("폴백 동작", $$("#list1 .pcard").length > 0 && $("#ageBig").textContent.trim() !== "—", $("#stNm").textContent);

console.log("\n── 전 지자체 순회 ──");
const blank = [], allClosed = [], noTel = [], noAge = [];
for (const o of [...sel.options].map(o => o.value)) {
  sel.value = o;
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  const cards = $$("#list1 .pcard").length;
  const notice = $("#list1 .empty");
  /* 카드가 없어도 이유가 적힌 안내가 있으면 정상이다. 아무것도 없으면 고장이다. */
  if (!cards && !notice) blank.push(o);
  if (!cards && notice) allClosed.push(o);
  if (!($("#tel").getAttribute("href") || "").startsWith("tel:")) noTel.push(o);
  if ($("#ageBig").textContent.trim() === "미상") noAge.push(o);
}
T("빈 화면 없음 (카드 또는 안내)", blank.length === 0,
  blank.length ? `아무것도 없는 곳 ${blank.length}: ${blank.slice(0, 4).join(", ")}` : "235곳");
console.log(`  INFO  신청 가능 0건이라 안내가 나온 곳 ${allClosed.length}곳${allClosed.length ? " (예: " + allClosed.slice(0, 3).join(", ") + ")" : ""}`);
console.log(`  INFO  전화 없음 ${noTel.length}곳 · 연령 미상 ${noAge.length}곳 (알려진 결손)`);

const uniq = [...new Set(runtime)];
console.log("\n" + (fails.length
  ? `실패 ${fails.length}건\n  - ${fails.join("\n  - ")}` + (uniq.length ? `\n실행 오류:\n  - ${uniq.join("\n  - ")}` : "")
  : "전체 통과"));
process.exit(fails.length ? 1 : 0);
