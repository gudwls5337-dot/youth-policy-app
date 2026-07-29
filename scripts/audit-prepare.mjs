/**
 * 검증 에이전트용 감사 과제 생성
 *
 *   node scripts/audit-prepare.mjs [슬라이스당건수]
 *
 * 기계가 판정할 수 없는 것만 고른다. 나머지는 validate.mjs 가 이미 본다.
 *
 *   A  연령 미상 5곳          — 정말로 조례에 연령이 없는가, 아니면 놓친 것인가
 *   B  신뢰도 보통 33곳       — 이게 정말 그 지자체의 '청년 기본 조례'인가
 *   C  연령 추출 표본         — 인용문이 '청년'을 정의하는가, 파생어를 정의하는가
 *   D  미분류 정책 표본       — 주관기관만 보고 지역을 특정할 수 있는가
 *
 * 각 과제에는 **법제처 원문을 새로 받아서** 넣는다. 우리가 저장한 값과
 * 독립된 근거를 줘야 감사가 성립한다.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const N = +(process.argv[2] || 12);
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));
const P = JSON.parse(readFileSync(join(ROOT, "docs/data/policies-by-org.json"), "utf8"));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cd = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const get = (x, t) => { const m = x.match(new RegExp(`<${t}>([\\s\\S]*?)</${t}>`)); return m ? cd(m[1]) : ""; };

/** 조례 정의 조문 전문을 새로 받아온다 */
async function fetchDefArticle(mst) {
  try {
    const res = await fetch(`https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${mst}&type=XML`,
      { signal: AbortSignal.timeout(25000) });
    const x = await res.text();
    if (!x.includes("<LawService>")) return null;
    const arts = [...x.matchAll(/<조\s[^>]*>([\s\S]*?)<\/조>/g)].map(([, b]) => ({
      no: get(b, "조문번호"), title: get(b, "조제목"), body: get(b, "조내용"),
    }));
    /* 연령이 적힌 조는 조례마다 다르다 — 「정의」일 수도, 「적용대상」일 수도 있다.
       추출기와 같은 우선순위로 고르지 않으면 감사관이 엉뚱한 조문을 보고
       멀쩡한 값을 불일치로 판정한다. (2026-07-29 E 슬라이스에서 발견) */
    const hasAge = a => /\d{1,2}\s*세\s*이상/.test(a.body);
    const def =
      arts.find(a => /정의|용어/.test(a.title) && hasAge(a)) ||
      arts.find(a => /적용\s*(대상|범위)/.test(a.title) && hasAge(a)) ||
      arts.find(a => /청년/.test(a.body) && hasAge(a)) ||
      arts.find(a => /정의|용어/.test(a.title)) ||
      arts.find(a => /청년.{0,3}(이란|이라 함은)/.test(a.body.replace(/\s+/g, " ")));

    /* 연령이 등장하는 조문은 전부 넘긴다 — 입주자격 같은 다른 조문과
       원칙 조항을 감사관이 스스로 구분할 수 있게 한다 */
    const ageArticles = arts.filter(hasAge).map(a => ({
      조: a.no ? `제${parseInt(a.no.slice(0, 4), 10)}조` : null,
      제목: a.title,
      내용: a.body.replace(/\s+/g, " ").slice(0, 700),
    }));

    return {
      lawName: get(x, "자치법규명"),
      dept: get(x, "담당부서명"),
      tel: get(x, "전화번호"),
      promulgated: get(x, "공포일자"),
      articleTitle: def?.title ?? null,
      articleNo: def?.no ? `제${parseInt(def.no.slice(0, 4), 10)}조` : null,
      articleText: (def?.body ?? "").replace(/\s+/g, " ").slice(0, 1600),
      연령이_등장하는_모든_조문: ageArticles,
      allArticleTitles: arts.map(a => a.title).filter(Boolean).slice(0, 24),
    };
  } catch { return null; }
}

const pickEvenly = (arr, n) => {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
};

async function buildOrdinanceTask(rows, id, question, criteria) {
  const items = [];
  for (const r of rows) {
    process.stdout.write(`\r  ${id}: ${items.length + 1}/${rows.length}   `);
    const src = await fetchDefArticle(r.m);
    items.push({
      지자체: r.o,
      우리가_저장한_값: {
        조례명: r.n, 근거조문: r.c || null,
        청년_하한: r.a ?? null, 청년_상한: r.b ?? null,
        담당부서: r.d || null, 전화: r.t || null,
        화면에_보이는_인용문: r.q || null,
        자동판정_신뢰도: r.k === 2 ? "보통" : "높음",
      },
      법제처_원문: src,
      원문주소: `https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${r.m}&type=HTML`,
    });
    await sleep(230);
  }
  console.log("");
  return { id, question, criteria, count: items.length, items };
}

async function main() {
  mkdirSync(join(ROOT, "work/audit"), { recursive: true });
  const tasks = [];

  /* A. 연령 미상 */
  const unknown = B.rows.filter(r => r.a == null);
  tasks.push(await buildOrdinanceTask(unknown, "A_연령미상",
    "이 조례들은 자동 추출에서 청년 연령을 못 찾아 `미상`으로 남겼다. 정말로 조례가 연령을 명시하지 않았는가?",
    [
      "법제처_원문.articleText 에서 「청년」을 정의하는 항을 직접 찾아라. 「청년정책」·「청년단체」 같은 파생어 정의와 혼동하지 마라.",
      "연령이 숫자로 적혀 있으면 → 판정 `누락`(우리가 놓쳤다). 하한·상한을 정확히 적어라.",
      "「청년기본법 제3조에 따른」처럼 상위법을 참조만 하고 숫자가 없으면 → 판정 `정당한_미상`.",
      "원문이 null 이면 → 판정 `확인불가`.",
    ]));

  /* B. 신뢰도 보통 */
  const medium = pickEvenly(B.rows.filter(r => r.k === 2), N);
  tasks.push(await buildOrdinanceTask(medium, "B_신뢰도보통",
    "조례명이 「○○ 청년 기본 조례」가 아니어서 자동 판정 신뢰도를 낮춰 잡은 건들이다. 이것이 그 지자체의 청년 기본 조례가 맞는가?",
    [
      "조례명과 정의 조문 내용을 보고, 청년정책 일반을 규율하는 기본 조례인지 판단하라.",
      "특정 사업만 다루는 조례(면접정장 대여·창업자금 등)라면 → 판정 `기본조례_아님`.",
      "청년 일반을 규율하면 이름이 달라도 → 판정 `기본조례_맞음`.",
      "allArticleTitles 에 기본계획·위원회·실태조사 같은 조문이 있으면 기본 조례일 가능성이 높다.",
    ]));

  /* C. 연령 추출 표본 */
  const sample = pickEvenly(B.rows.filter(r => r.a != null && r.k === 1), N);
  tasks.push(await buildOrdinanceTask(sample, "C_연령정확도",
    "자동 추출한 청년 연령이 원문과 일치하는가? 그리고 화면에 보이는 인용문이 「청년」을 정의하는 문장이 맞는가?",
    [
      "articleText 에서 「청년」 정의 항을 찾아 하한·상한을 직접 읽어라.",
      "우리 값과 다르면 → 판정 `불일치`, 원문 값을 적어라.",
      "값은 맞는데 화면 인용문이 엉뚱한 절이면 → 판정 `인용문_오류`.",
      "둘 다 맞으면 → 판정 `정확`.",
      "「다만 개별 사업에서 달리 정할 수 있다」 같은 단서는 오류가 아니다. 원칙 연령만 본다.",
    ]));

  /* E. 직전 감사에서 고친 건 재검증 — 고쳤다는 말을 믿지 않는다.
       `--recheck 지자체명,지자체명` 으로 지정한다. */
  const recheckArg = process.argv.find(a => a.startsWith("--recheck="));
  if (recheckArg) {
    const names = recheckArg.split("=")[1].split(",").map(s => s.trim()).filter(Boolean);
    const rows = names.map(n => B.rows.find(r => r.o === n)).filter(Boolean);
    if (rows.length !== names.length) {
      console.error(`  --recheck: 못 찾은 지자체 ${names.length - rows.length}개`);
    }
    tasks.push(await buildOrdinanceTask(rows, "E_수정건재검증",
      "직전 감사에서 결함으로 지적돼 파서를 고치고 재추출한 건들이다. 수정이 맞는지 독립 검증하라. 고쳤다는 말을 믿지 마라.",
      [
        "법제처_원문.articleText 에서 「청년」의 연령 범위를 정하는 문장을 직접 찾아라.",
        "articleTitle 이 「정의」가 아니라 「적용대상」일 수 있다. allArticleTitles 를 함께 보라.",
        "우리가_저장한_값.근거조문 이 실제로 그 연령이 적힌 조문 번호인지 확인하라.",
        "값·조문 모두 맞으면 `정확`, 값만 맞으면 `조문번호_오류`, 값이 틀리면 `불일치`.",
      ]));
  }

  /* D. 미분류 정책 */
  const un = P.pol.map((p, i) => ({ ...p, i })).filter(p => p.lv === "미분류");
  const dItems = pickEvenly(un, N).map(p => ({
    정책명: p.n, 분야: p.f, 주관기관: p.i,
    지원내용: (p.v || "").slice(0, 200),
    신청방법: (p.h || "").slice(0, 200),
    우리_판정: "미분류(지역 특정 실패)",
  }));
  tasks.push({
    id: "D_미분류정책",
    question: "주관기관 이름에 지역이 없어 지역을 특정하지 못한 정책들이다. 다른 필드로 지역을 특정할 수 있는가?",
    criteria: [
      "주관기관·지원내용·신청방법에 지역 단서(시·군·구 이름, 지역 누리집 주소)가 있는지 보라.",
      "특정되면 → 판정 `특정가능`, 시도명과 시군구명을 표준 형식으로 적어라(예: 경상남도 양산시).",
      "중앙부처·공공기관 사업이면 → 판정 `중앙`.",
      "근거가 없으면 → 판정 `특정불가`. 추측하지 마라. 이게 정답인 경우가 많다.",
    ],
    count: dItems.length, items: dItems,
  });

  /* ── 증거 보증 ──
     증거가 빈 감사파일은 감사를 못 하게 만들 뿐 아니라, 감사관이 그걸 눈치채지
     못하면 **틀린 데이터에 합격 도장을 찍는다.** 없는 감사보다 나쁘다.
     2026-07-29 E 슬라이스에서 실제로 발생(정규식 이스케이프 파손으로 전 조문 공백).
     그래서 여기서 막는다 — 증거가 비면 파일을 쓰지 않는다. */
  let blocked = 0;
  for (const t of tasks) {
    const bad = t.items.filter(it => {
      const src = it.법제처_원문;
      if (src === undefined) return false;              // 정책 슬라이스는 원문이 없다
      if (src === null) return false;                   // 재수집 실패는 명시적 null — 허용
      return !src.articleText || src.articleText.length < 20;
    });
    if (bad.length) {
      blocked++;
      console.error(`  ${t.id}: 증거 결손 ${bad.length}/${t.items.length}건 — 파일을 쓰지 않습니다.`);
      console.error(`     ${bad.slice(0, 3).map(b => b.지자체).join(", ")}`);
      continue;
    }
    const p = join(ROOT, `work/audit/${t.id}.json`);
    writeFileSync(p, JSON.stringify(t, null, 1), "utf8");
    console.log(`  ${t.id.padEnd(14)} ${String(t.count).padStart(3)}건 → work/audit/${t.id}.json`);
  }
  if (blocked) { console.error(`\n${blocked}개 슬라이스가 증거 결손으로 차단됐습니다.`); process.exit(1); }
}

main().catch(e => { console.error("실패:", e); process.exit(1); });
