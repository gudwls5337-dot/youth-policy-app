/**
 * 정책제안 처리의견 수집 — 「왜 반려됐는가」의 원자료
 *
 *   node scripts/collect-proposals.mjs
 *   node scripts/collect-proposals.mjs --dir "D:/경로/제안서"
 *
 * ── 왜 이 데이터인가 ──────────────────────────────────────────────
 * 온통청년·법제처는 누구나 받을 수 있다. **「양산시가 이 제안을 왜 반려했는가」는
 * 정책단만 가진 정보**이고, 기수가 바뀌면 사라진다. 4기가 3기의 반려 사유를
 * 모르면 같은 제안을 같은 이유로 또 반려당한다.
 *
 * 2024년 17건 중 4건 통과(23.5%) → 2025년 66건 중 1건(1.5%).
 * 2-1「취(창)업청년 웰컴페이」는 2년 연속 반려됐는데 **부서도 사유도 서로 달랐다**
 * (2024 공동주택과 "1회성 지원은 효과 없다" / 2025 토지정보과 "경남도 조례 소관").
 *
 * ── 원자료 ────────────────────────────────────────────────────
 * 양산시 공문 PDF 2건. 저장소 밖에 둔다(공문 원본이라 배포하지 않는다).
 *   ★ 2024년 양산시 청년정책단 정책제안 검토 및 처리의견-1.pdf
 *   ★ 정책제안서 검토 및 처리의견(붙임).pdf                        ← 2025년분
 *
 * pdftotext(poppler) 가 필요하다. 없으면 중단한다 — 추측으로 채우지 않는다.
 *
 * ── 어느 쪽이 정본인가 ────────────────────────────────────────
 * 공문은 「붙임1 총괄표」와 「붙임2 부서검토 의견」 두 벌로 결과를 적는다.
 * **붙임2(상세)를 따른다.** 이유 둘.
 *   ① 총괄표는 표 레이아웃이라 pdftotext 에서 행이 밀린다(1-10·1-11 실측).
 *   ② 상세는 검토부서·검토결과가 한 줄에 있고 **사유가 붙어 있다**.
 * 다만 **3건은 공문 자체가 서로 다르다** — 3-14·3-20 은 총괄 시행불가/상세 장기검토,
 * 3-30 은 총괄 기시행중/상세 수정보완. 파싱 오류가 아니라 원문 불일치다.
 *
 * ── 구조 ─────────────────────────────────────────────────────
 *   {분과} {연번}  {제안명}
 *   사업대상 / 사업내용 / 기대효과 …
 *   검토부서 {부서}  검토결과 {결과}
 *   {사유 본문}                       ← 다음 레코드 머리까지
 *
 * 출력  data/YYYYMMDD수집_정책제안처리의견.json
 *
 * 절대 규칙
 *  - 사유는 **원문 그대로** 담는다. 요약하지 않는다(원칙 4).
 *  - 결과 라벨은 공문 표기를 그대로 쓴다. 「시행불가」를 「반려」로 바꾸지 않는다.
 *  - 못 읽으면 null. 빈 문자열로 채우지 않는다(원칙 5).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATE = new Date().toISOString().slice(0, 10);
const STAMP = DATE.replace(/-/g, "");

const argDir = process.argv.includes("--dir") ? process.argv[process.argv.indexOf("--dir") + 1] : null;
const SRC = argDir || join(ROOT, "..", "정책단projects", "yangsan-policy", "sources", "제안서");
if (!existsSync(SRC)) { console.error(`원자료 폴더가 없습니다: ${SRC}\n--dir 로 지정하십시오.`); process.exit(1); }

/* pdftotext 는 Git for Windows 에 딸려 오는데 그 경로(mingw64/bin)가 Windows PATH 에
   없어서 Node 가 못 찾는다. Git Bash 에선 되고 npm 스크립트에선 안 되는 이유다. */
const PDFTOTEXT = (() => {
  const cands = ["pdftotext",
    "C:/Program Files/Git/mingw64/bin/pdftotext.exe",
    "C:/Program Files (x86)/Git/mingw64/bin/pdftotext.exe",
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Programs/Git/mingw64/bin/pdftotext.exe` : null,
  ].filter(Boolean);
  /* `-v` 로 살아 있는지 보면 안 된다 — xpdf 판(version 4.00)은 -v 에 0이 아닌 코드를
     돌려줘서 멀쩡한 실행파일을 없다고 판정한다. 파일 존재로만 확인한다. */
  for (const c of cands) {
    if (c !== "pdftotext" && existsSync(c)) return c;
    if (c === "pdftotext") {
      try { execFileSync(c, ["-v"], { stdio: "ignore" }); return c; }
      catch (e) { if (e.code !== "ENOENT") return c; }   // 실행은 됐다 = 있다
    }
  }
  return null;
})();
if (!PDFTOTEXT) {
  console.error("pdftotext(poppler) 를 못 찾았습니다. Git for Windows 에 포함돼 있습니다.");
  process.exit(1);
}

const pdfText = f => {
  const out = join(ROOT, "work", "_pdf.txt");
  execFileSync(PDFTOTEXT, ["-layout", "-enc", "UTF-8", f, out]);
  return readFileSync(out, "utf8");
};

/* 연번 앞자리가 분과다. 공문 표(붙임1)의 분과 칸은 레이아웃이 깨져 부서명과 섞인다. */
const DIV = { "1": "일자리", "2": "생활안정", "3": "문화예술" };
/** 공문이 쓰는 결과 라벨. 표기 흔들림(기 시행중 / 기시행)을 하나로 모은다. */
/** 가운뎃점이 **네 종류** 섞여 나온다. CLAUDE.md 에 `·`(U+00B7)와 `ㆍ`(U+318D)를
 *  적어 뒀는데 공문에는 `․`(U+2024 ONE DOT LEADER)와 `‧`(U+2027)도 있다.
 *  「수정․보완 시행가능」이 이것 때문에 「수용」으로 잘못 분류됐다(2025 1-6). */
const dots = s => String(s || "").replace(/[·ㆍ․‧•]/g, "·");

const RESULTS = [
  [/수정\s*·?\s*보완.*시행\s*가능|수정\s*·?\s*보완/, "수정보완 후 시행"],
  [/시행\s*가능|수용/, "수용"],
  [/기\s*시행/, "기시행중"],
  [/장기\s*검토/, "장기검토"],
  /* 「시생불가」는 공문 원문의 오타다(2025 1-17). 원표기는 rawResult 에 남긴다. */
  [/시행\s*불가|시생\s*불가/, "시행불가"],
];

/** 2025년분 공문은 「붙임」만 있어 본문·메타데이터 어디에도 연도가 없다.
 *  파일명으로 지정한다. 추측이 아니라 확인된 사실이다 — 정책단 자체 분석
 *  (제안분석_2024-2025.md)의 건수 66건과 파싱 결과가 일치한다. */
const YEAR_BY_FILE = [[/2024/, "2024"], [/검토 및 처리의견\(붙임\)/, "2025"]];
const normResult = s => RESULTS.find(([re]) => re.test(dots(s)))?.[1] || null;

/** 페이지 번호·머리글 같은 잡음 제거.
 *  pdftotext 는 페이지가 바뀌는 자리에 **폼피드(\f)** 를 줄 맨 앞에 붙인다.
 *  이걸 안 지우면 레코드 머리 정규식이 68줄 중 6줄만 잡는다(2026-07-31). */
const clean = t => t
  .replace(/\f/g, "")
  .split(/\r?\n/)
  .filter(l => !/^\s*-\s*\d+\s*-\s*$/.test(l))
  .filter(l => !/^\s*(붙임\s*\d|\d\s+(추진개요|검토결과 총괄|제안별 검토의견))/.test(l))
  .join("\n");

const HEAD = /^[ \t]*(일자리|생활안정|문화예술)[ \t]+(\d+-\d+)[ \t]*(.*)$/;

function parse(txt, year) {
  const lines = clean(txt).split(/\r?\n/);
  /* 상세 구간만 본다. 그 앞의 총괄표는 레이아웃이 깨져 신뢰할 수 없다. */
  let start = lines.findIndex(l => /제안별 검토의견|부서검토 의견/.test(l));
  if (start < 0) start = 0;

  const recs = [];
  let cur = null;
  for (const raw of lines.slice(start)) {
    const m = raw.match(HEAD);
    if (m) {
      /* 쪽이 넘어가면 같은 머리줄이 한 번 더 찍힌다(3-3·3-30). 새 레코드로 세면
         66건이 68건이 된다. 같은 연번이 이어지면 이어붙인다. */
      if (cur && cur.no === m[2]) { cur.name ||= (m[3] || "").trim() || null; continue; }
      if (cur) recs.push(cur);
      cur = { year, no: m[2], div: DIV[m[2].split("-")[0]] || null, name: (m[3] || "").trim() || null, body: [] };
      continue;
    }
    if (cur) cur.body.push(raw);
  }
  if (cur) recs.push(cur);

  return recs.map(r => {
    const text = r.body.join("\n");
    /* 「검토부서 X 검토결과 Y」 한 줄. 부서가 두 줄로 이어지는 공문이 있다. */
    const dm = text.match(/검토부서\s+(.+?)\s{2,}검토결과\s+(.+?)\s*$/m);
    const idx = dm ? text.indexOf(dm[0]) + dm[0].length : -1;
    let dept = dm ? dm[1].replace(/\s+/g, "") : null;
    const result = dm ? normResult(dm[2]) : null;
    const rawResult = dm ? dm[2].replace(/\s+/g, " ").trim() : null;

    let after = idx >= 0 ? text.slice(idx) : text;
    /* 부서가 다음 줄로 넘어간 경우(민생경제과 / 기업지원과) 이어 붙인다 */
    const cont = after.match(/^\s*\n\s{6,}([가-힣]+과)\s*$/m);
    if (cont && dept) { dept += "·" + cont[1]; after = after.replace(cont[0], "\n"); }

    const reason = after
      .replace(/검토의견/g, "")
      .split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      .join("\n")
      .replace(/\n(?=[^○□▹\-])/g, " ")     // 줄바꿈으로 끊긴 문장을 잇는다
      .replace(/\s{2,}/g, " ")
      .trim();

    /* 제안명이 머리줄에 없으면(2024 형식) 본문 첫 줄이 이름인 경우가 있다 */
    let name = r.name;
    if (!name) {
      const first = r.body.find(l => l.trim() && !/^사업|^기대|^○|^▹/.test(l.trim()));
      name = first ? first.trim() : null;
    }
    return {
      year: r.year, no: r.no, div: r.div, name: name || null,
      dept: dept || null, result, rawResult,
      reason: reason.length > 15 ? reason : null,
    };
  }).filter(r => r.result || r.reason);
}

/** 공문 총괄표(붙임1)와 상세(붙임2)의 결과가 **원문에서 서로 다른** 건.
 *  손으로 원문을 확인했다. 상세를 따르되 화면에 둘 다 밝힌다(원칙 4·5). */
const TABLE_CONFLICT = {
  "2025|3-14": "시행불가",
  "2025|3-20": "시행불가",
  "2025|3-30": "기시행중",
};

const files = readdirSync(SRC).filter(f => /\.pdf$/i.test(f));
console.log(`정책제안 처리의견 수집 — ${DATE}`);
console.log(`  원자료 ${SRC}`);

const all = [];
for (const f of files) {
  const txt = pdfText(join(SRC, f));
  const y = YEAR_BY_FILE.find(([re]) => re.test(f))?.[1]
    || (txt.match(/(20\d{2})년[^\n]{0,20}청년정책단/) || [])[1] || "미상";
  if (y === "미상") console.warn(`  ⚠ 연도를 못 정했습니다: ${f}`);
  const recs = parse(txt, y);
  for (const r of recs) {
    const t = TABLE_CONFLICT[`${r.year}|${r.no}`];
    if (t && t !== r.result) r.tableResult = t;      // 총괄표는 이렇게 적혀 있다
  }
  console.log(`  ${f}\n    → ${y}년 ${recs.length}건`);
  all.push(...recs);
}

const tally = all.reduce((a, r) => (a[r.result || "미상"] = (a[r.result || "미상"] || 0) + 1, a), {});
const byYear = all.reduce((a, r) => (a[r.year] = (a[r.year] || 0) + 1, a), {});
console.log(`\n  합계 ${all.length}건 · 연도별 ${JSON.stringify(byYear)}`);
console.log(`  결과별 ${JSON.stringify(tally)}`);
console.log(`  부서 확보 ${all.filter(r => r.dept).length} · 사유 확보 ${all.filter(r => r.reason).length}`);

mkdirSync(join(ROOT, "data"), { recursive: true });
const doc = {
  source: "양산시 정책제안 검토 및 처리의견 (공문)",
  note: "사유는 공문 원문 그대로. 결과 라벨도 공문 표기를 따른다.",
  date: DATE, count: all.length, byYear, tally,
  proposals: all,
};
writeFileSync(join(ROOT, "data", `${STAMP}수집_정책제안처리의견.json`), JSON.stringify(doc, null, 0), "utf8");
console.log(`  ${(Buffer.byteLength(JSON.stringify(doc)) / 1024).toFixed(0)}KB → data/${STAMP}수집_정책제안처리의견.json`);
