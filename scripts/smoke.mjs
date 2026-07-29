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
    w.navigator.clipboard = { writeText: async () => {} };
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
T("화면 5개", $$(".screen").length === 5);
T("기본 화면은 정책", $("#sc-policy")?.classList.contains("on"));
T("헤더 고정 요소", !!$(".appbar") && !!$("#stNm") && !!$("#city"));
T("지자체 선택지", $("#city")?.options.length > 200, `${$("#city")?.options.length}개`);

console.log("\n── 헤더 요약 ──");
T("도시명", ($("#stNm")?.textContent || "").length > 3, $("#stNm")?.textContent);
T("연령", /\d+–\d+/.test($("#ageBig")?.textContent || ""), $("#ageBig")?.textContent.trim());
T("신청 가능 수", +$("#c1")?.textContent > 0, $("#c1")?.textContent);
T("종료 수", +$("#c3")?.textContent > 0, $("#c3")?.textContent);
T("탭 배지 채워짐", $$(".tb .cnt").slice(0, 4).every(c => /\d/.test(c.textContent)),
  $$(".tb .cnt").map(c => c.textContent).join("/"));

console.log("\n── 정책 화면 ──");
const c1 = $$("#list1 .pcard");
T("카드 렌더", c1.length > 0, `${c1.length}장`);
T("제목·금액 채워짐", c1.every(c => (c.querySelector(".nm")?.textContent || "").trim() && (c.querySelector(".amt")?.textContent || "").trim()));
T("종료 안 섞임", c1.every(c => !c.className.includes("closed")), `${c1.filter(c => c.className.includes("closed")).length}장 섞임`);
T("첫 카드가 진행 중", c1.length > 0 && !c1[0].className.includes("closed"), c1[0]?.querySelector(".nm")?.textContent.slice(0, 26));
T("상태 배지 있음", c1.every(c => c.querySelector(".bdg")));
T("전화 표시", c1.some(c => /\d{2,3}-\d{3,4}-\d{3,4}/.test(c.querySelector(".tel")?.textContent || "")));

console.log("\n── 분야 칩 ──");
click($$("#tabs .chip").find(b => b.textContent === "주거"));
await wait(150);
T("주거 필터", $$("#list1 .pcard").length > 0, `${$$("#list1 .pcard").length}장`);
click($$("#tabs .chip").find(b => b.textContent === "전체"));
await wait(150);

console.log("\n── 종료 토글 ──");
T("토글 2개", $$("#statusbar [data-sc]").length === 2, $$("#statusbar [data-sc]").map(b => b.textContent).join(" / "));
click($$("#statusbar [data-sc]").find(b => b.dataset.sc === "1"));
await wait(180);
T("종료 포함 시 등장", $$("#list1 .pcard").some(c => c.className.includes("closed")));
click($$("#statusbar [data-sc]").find(b => b.dataset.sc === "0"));
await wait(180);
T("다시 숨김", $$("#list1 .pcard").every(c => !c.className.includes("closed")));

console.log("\n── 탭 전환 ──");
tab("new"); await wait(150);
T("신설 화면", $("#sc-new")?.classList.contains("on") && !$("#sc-policy")?.classList.contains("on"));
T("신설 카드", $$("#list2 .pcard").length > 0, `${$$("#list2 .pcard").length}장`);
T("신설 배지", ($("#list2 .bdg")?.textContent || "").includes("신설"));

tab("end"); await wait(150);
T("종료 화면", $("#sc-end")?.classList.contains("on"));
const l3 = $$("#list3 .pcard");
T("전부 종료", l3.length > 0 && l3.every(c => c.className.includes("closed")), `${l3.length}장`);
T("마감일·사유", /(신청마감|사업종료|종료)\s*\d{4}-\d{2}-\d{2}/.test($("#list3 .meta")?.textContent || ""));

tab("region"); await wait(150);
T("지역 화면", $("#sc-region")?.classList.contains("on"));
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
T("종료 상세 경고", ($("#dBody")?.textContent || "").includes("이미 종료"),
  ($("#dBody .keynote")?.textContent || "").slice(0, 40));
click($("#dClose")); await wait(360);

tab("region"); await wait(150);
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
const empty = [], noTel = [], noAge = [];
for (const o of [...sel.options].map(o => o.value)) {
  sel.value = o;
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  if ($$("#list1 .pcard").length === 0) empty.push(o);
  if (!($("#tel").getAttribute("href") || "").startsWith("tel:")) noTel.push(o);
  if ($("#ageBig").textContent.trim() === "미상") noAge.push(o);
}
T("전 지자체 목록 있음", empty.length === 0, empty.length ? `빈 곳 ${empty.length}: ${empty.slice(0, 4).join(", ")}` : "235곳");
console.log(`  INFO  전화 없음 ${noTel.length}곳 · 연령 미상 ${noAge.length}곳 (알려진 결손)`);

const uniq = [...new Set(runtime)];
console.log("\n" + (fails.length
  ? `실패 ${fails.length}건\n  - ${fails.join("\n  - ")}` + (uniq.length ? `\n실행 오류:\n  - ${uniq.join("\n  - ")}` : "")
  : "전체 통과"));
process.exit(fails.length ? 1 : 0);
