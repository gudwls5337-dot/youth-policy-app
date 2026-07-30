/**
 * 조례 거버넌스 조문 추출 — 「우리 조례에 없는 조문」 비교의 원자료
 *
 *   node scripts/extract-governance.mjs            전수 (약 2분)
 *   node scripts/extract-governance.mjs --peek 3   구조만 3건 확인
 *
 * 왜 정책이 아니라 조례인가
 *   온통청년 정책 데이터는 지자체 자발 등록이고 갱신 인센티브가 없다.
 *   112/235곳만 등록돼 있고 48곳은 최종 마감일이 작년 이전이라
 *   「없다」와 「등록이 없다」를 구분할 수 없다(2026-07-30).
 *   조례는 법적 효력이 있어 개정하면 즉시 반영되고, 개정 안 했으면 그게 현행이다.
 *   즉 노후 개념이 없다. 비교의 근거로 쓸 수 있는 유일한 축이다.
 *
 * 추출 지표 — 정책단이 실제로 제안할 수 있는 것만 고른다
 *   ① 참여기구 설치      「둔다」(의무) / 「둘 수 있다」(임의) / 없음
 *   ② 위원회 정기회 횟수  연 N회 이상
 *   ③ 위원 정원          N명 이내
 *   ④ 청년 위원 하한      위원의 N 이상을 청년으로
 *   ⑤ 기본계획 주기      N년마다 수립하여야 한다(의무) / 수립할 수 있다
 *
 * 절대 규칙
 *  - 판정마다 **원문 인용을 함께 저장**한다. 점수만 있으면 검증이 불가능하다.
 *  - 못 찾으면 `null`. 없는 것과 못 찾은 것을 구분한다.
 *  - 조문 번호를 고정하지 않는다. 지자체마다 배치가 다르다.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const B = JSON.parse(readFileSync(join(ROOT, "docs/data/board.json"), "utf8"));
const PEEK = process.argv.includes("--peek") ? +(process.argv[process.argv.indexOf("--peek") + 1] || 3) : 0;
const SNAPSHOT_DATE = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const cdata = s => s.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
const pick = (xml, tag) => {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? cdata(m[1]) : "";
};
/* 조례는 가운뎃점을 `·` 와 `ㆍ` 두 글자로 섞어 쓴다. 정규식이 한쪽만 보면 놓친다. */
const flat = s => String(s || "").replace(/ㆍ/g, "·").replace(/\s+/g, " ").trim();

async function fetchBody(mst) {
  for (let a = 1; a <= 3; a++) {
    try {
      const res = await fetch(`https://www.law.go.kr/DRF/lawService.do?OC=test&target=ordin&MST=${mst}&type=XML`,
        { signal: AbortSignal.timeout(30000) });
      const x = await res.text();
      if (!x.includes("<LawService>")) throw new Error("비정상 응답");
      return x;
    } catch (e) { if (a === 3) return null; await sleep(900 * a); }
  }
}

function articles(xml) {
  return [...xml.matchAll(/<조\s[^>]*>([\s\S]*?)<\/조>/g)].map(([, b]) => ({
    no: pick(b, "조문번호"),
    title: pick(b, "조제목"),
    body: flat(pick(b, "조내용")),
  /* 조문번호는 6자리다: 앞 4자리 조번호 + 뒤 2자리 가지번호.
     철원군 `000902` = 제9조의2. 8자리로 가정하면 가지번호를 통째로 놓친다.
     조문번호를 인용하는 자료이므로 「제9조」와 「제9조의2」를 섞으면 안 된다. */
  })).map(a => {
    const main = a.no ? parseInt(a.no.slice(0, 4), 10) : null;
    const sub = a.no && a.no.length >= 6 ? parseInt(a.no.slice(4, 6), 10) : 0;
    return { ...a, num: main, sub, label: main ? `제${main}조${sub ? `의${sub}` : ""}` : null };
  });
}

/** 인용문 — 근거 문장만 잘라낸다. 판정과 함께 저장해야 검증이 된다. */
const quoteAround = (text, re, span = 130) => {
  const m = text.match(re);
  if (!m) return null;
  const i = Math.max(0, m.index - 30);
  return text.slice(i, i + span).trim();
};

function extract(xml) {
  const arts = articles(xml);
  const out = {
    dept: pick(xml, "담당부서명"), tel: pick(xml, "전화번호"),
    articles: arts.length,
    titles: arts.map(a => a.title).filter(Boolean),
  };
  /* 조제목으로만 조문을 고른다. 본문까지 보면 「청년공간의 설치·운영」이 참여기구로
     잡히는 오탐이 났다(2026-07-30 미리보기). 제목은 지자체 간 표기가 비교적 고르다. */
  const byTitle = re => arts.filter(a => re.test(a.title));
  const first = re => byTitle(re)[0] || null;

  /* ① 참여기구 — 심의기구(위원회) 와 참여기구(네트워크·협의체) 를 나눠 본다
     함정: 삼척시는 「청년지원협의체」가 심의기구다(「심의하기 위하여 … 둔다」).
     조제목만 보면 참여기구로 오인해 의무/임의가 뒤집힌다(2026-07-30 4단 감사).
     → 본문 목적어로 갈라낸다. 「심의·의결」이면 위원회다. */
  const isDeliberative = a => a && /심의|의결|자문에 응하기|조정하기/.test(a.body);
  const cmteCands = [...byTitle(/위원회|심의|조정/), ...arts.filter(isDeliberative)];
  const cmte = cmteCands[0] || null;
  const netCands = byTitle(/네트워크|협의체|참여기구|정책단|청년참여/).filter(a => !isDeliberative(a));
  const net = netCands[0] || null;
  /* 어미가 「있다」로만 끝나지 않는다. 춘천시는 「운영할 수 있으며」로 이어 쓴다.
     이걸 놓치면 임의가 의무로 뒤집힌다(2026-07-30 4단 감사).
     그리고 임의 판정은 **제1항**을 우선한다 — 뒤 항의 「분과를 둘 수 있다」에 끌려가면 안 된다. */
  const MAY = /(둘|설치할|구성할|운영할)\s*수\s*있(다|으며|으나|고)/;
  const MUST = /(둔다|설치한다|구성한다|운영한다|두어야\s*한다|설치하여야\s*한다|구성하여\s*운영한다)/;
  const kindOf = b => {
    if (!b) return "없음";
    const head = b.split(/[②③④⑤⑥⑦⑧⑨]/)[0] || b;   // 제1항
    if (MAY.test(head)) return "임의";
    if (MUST.test(head)) return "의무";
    if (MAY.test(b)) return "임의";
    if (MUST.test(b)) return "의무";
    return "미상";
  };
  const pack = (a, kind) => a ? {
    kind, article: a.label, title: a.title || null,
    /* 인용은 제1항에서 뽑는다. 뒤 항을 인용하면 판정과 근거가 어긋난다(춘천 실측). */
    quote: quoteAround(a.body.split(/[②③④⑤⑥⑦⑧⑨]/)[0] || a.body,
      /(둔다|둘\s*수\s*있|설치한다|설치할\s*수\s*있|구성한다|구성할\s*수\s*있|운영한다|운영할\s*수\s*있)/, 170)
      || (a.body.split(/[②③④⑤⑥⑦⑧⑨]/)[0] || a.body).slice(0, 170),
  } : { kind: "없음", article: null, title: null, quote: null };

  out.cmte = pack(cmte, kindOf(cmte?.body));
  out.net = pack(net, kindOf(net?.body));

  /* ② 정기회 · ③ 정원 · ④ 청년 비율 — 위원회 관련 조문 안에서 찾는다.
     삼척시는 「청년지원협의체의 설치」 한 조에 구성·회의를 몰아 써서, 조제목 필터만으로는
     통째로 놓쳤다(2026-07-30 4단 감사). 그래서 위원회로 판정된 조문을 범위에 반드시 넣는다. */
  const scopeArts = [...new Set([
    ...byTitle(/위원회|심의|조정|구성|회의|운영/),
    ...(cmte ? [cmte] : []),
  ])];
  const scope = scopeArts.map(a => a.body).join(" ") || arts.map(a => a.body).join(" ");
  const RG_MAP = { 일: 1, 이: 2, 삼: 3, 사: 4, 반기: 2, 분기: 4 };
  const RG_RE = /정기회(?:의)?[^.]{0,50}?(?:연|매년)\s*(\d+|[일이삼사]|반기|분기)\s*회|(?:연|매년)\s*(\d+|[일이삼사]|반기|분기)\s*회[^.]{0,20}?정기/;
  const rg = scope.match(RG_RE);
  const rgv = rg ? (rg[1] ?? rg[2]) : null;
  out.regular = { n: rgv ? (/^\d+$/.test(rgv) ? +rgv : RG_MAP[rgv] ?? null) : null,
    quote: rg ? quoteAround(scope, RG_RE) : null };

  const CAP_RE = /위원(?:회)?(?:는|은)?[^.]{0,40}?(\d{1,3})\s*명\s*(?:이내|이하|내외)/;
  const cap = scope.match(CAP_RE);
  out.seats = { n: cap ? +cap[1] : null, quote: cap ? quoteAround(scope, CAP_RE) : null };

  /* 청년 위원 하한 — 표기가 네 갈래다. 하나라도 빠지면 「없다」로 오표시된다.
     실측 누락 사례(2026-07-30 4단 감사):
       춘천 「1/2 이상」        아라비아 분수
       평창 「100분의 30 이상」  큰 분모
       홍천·양산 「5명 이상」    비율이 아니라 절대 인원  ← 양산 본인 조례를 놓쳤다 */
  const PCT_RE  = /청년[^.]{0,60}?(\d{1,3})\s*(?:퍼센트|%)\s*이상|위원[^.]{0,50}?(\d{1,3})\s*(?:퍼센트|%)\s*이상[^.]{0,30}?청년/;
  /* 「100분의 30의 범위 이상으로」처럼 분수와 「이상」 사이에 말이 끼는 경우가 있다(평창군). */
  const FRAC_RE = /청년[^.]{0,60}?(\d{1,3})\s*분의\s*(\d{1,3})[^.]{0,12}?이상|위원[^.]{0,50}?(\d{1,3})\s*분의\s*(\d{1,3})[^.]{0,12}?이상[^.]{0,30}?청년/;
  const SLASH_RE= /청년[^.]{0,60}?(\d{1,3})\s*\/\s*(\d{1,3})\s*이상|위원[^.]{0,50}?(\d{1,3})\s*\/\s*(\d{1,3})\s*이상[^.]{0,30}?청년/;
  const HEAD_RE = /청년[^.]{0,40}?(\d{1,3})\s*명\s*이상[^.]{0,20}?(?:포함|위촉|되도록)|청년\s*위원[^.]{0,30}?(\d{1,3})\s*명\s*이상/;

  let pct = null, heads = null, q = null;
  const pm = scope.match(PCT_RE), fm = scope.match(FRAC_RE), sm = scope.match(SLASH_RE), hm = scope.match(HEAD_RE);
  if (pm)      { pct = +(pm[1] ?? pm[2]); q = quoteAround(scope, PCT_RE, 190); }
  else if (fm) { const d = +(fm[1] ?? fm[3]), n = +(fm[2] ?? fm[4]); if (d > 0) pct = Math.round(n / d * 100); q = quoteAround(scope, FRAC_RE, 190); }
  else if (sm) { const n = +(sm[1] ?? sm[3]), d = +(sm[2] ?? sm[4]); if (d > 0) pct = Math.round(n / d * 100); q = quoteAround(scope, SLASH_RE, 190); }
  else if (hm) { heads = +(hm[1] ?? hm[2]); q = quoteAround(scope, HEAD_RE, 190);
                 /* 정원이 있으면 실질 비율로 환산해 비교 가능하게 한다 */
                 if (out.seats?.n) pct = Math.round(heads / out.seats.n * 100); }

  /* 문언 강도 3등급 — 「포함하여야 한다」(강제) / 「되도록 한다」(지향) / 「노력하여야 한다」(노력)
     회의에서 "조례에 있습니다" 라고 말했다가 "노력 조항입니다" 로 반박당하는 지점이다.
     철원군 「되도록 한다」는 둘 중 어느 쪽도 아니어서 별도 등급으로 뺀다. */
  let binding = null;
  if (q) {
    if (/노력(하여야|해야|한다)/.test(q)) binding = 0;            // 노력조항
    else if (/되도록\s*한다/.test(q)) binding = 2;                 // 지향 문구
    else binding = 1;                                              // 강제
  }
  out.youthQuota = { pct, heads, binding: (pct == null && heads == null) ? null : binding, quote: q };

  /* ⑤ 기본계획 — 의무 표현이 다양하다: 수립하여야/수립해야/수립하고 … 시행하여야 */
  const plan = first(/기본\s*계획/);
  if (plan) {
    const b = plan.body;
    /* 주된 의무는 제1항에 있다. 조문 전체를 보면 「변경할 수 있다」 같은 뒤 항 때문에
       의무 조항이 임의로 떨어진다(고성군 실측, 2026-07-30). */
    const head = (b.split(/[②③④⑤⑥]/)[0] || b);
    const cyc = head.match(/(\d+)\s*년\s*마다/) || b.match(/(\d+)\s*년\s*마다/);
    /* 의무 어미가 매우 다양하다. 아래는 실측으로 확인한 변형(2026-07-30 4단 감사).
         「수립하여야 한다」 「수립해야 한다」 「수립·시행하여야 한다」 「수립·시행해야 한다」
         「수립하고 이를 시행하여야 한다」 「수립하고 이를 시행한다」
         「수립·시행하도록 하여야 한다」 「수립하고 시행하여야 한다」
       공통점은 「할 수 있다」가 아니라는 것이다. 그래서 임의를 먼저 배제하고 나머지를 의무로 본다. */
    const may = /수립할\s*수\s*있다|수립·?\s*시행할\s*수\s*있다|수립하거나/.test(head);
    const must = !may && /수립(하여야|해야|한다|하고|·?\s*시행)/.test(head);
    out.plan = {
      cycle: cyc ? +cyc[1] : null,
      kind: must ? "의무" : may ? "임의" : "미상",
      article: plan.label,
      quote: quoteAround(head, /(\d+\s*년\s*마다|수립하여야|수립해야|수립할\s*수\s*있다|수립한다)/, 170) || head.slice(0, 170),
    };
  } else out.plan = { cycle: null, kind: "없음", article: null, quote: null };

  return out;
}

async function main() {
  const rows = PEEK ? B.rows.slice(0, PEEK) : B.rows;
  console.log(`거버넌스 조문 추출 — ${rows.length}건${PEEK ? " (미리보기)" : ""}`);
  const out = [];
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!PEEK) process.stdout.write(`\r  ${i + 1}/${rows.length}  실패 ${failed}   `);
    const xml = await fetchBody(r.m);
    if (!xml) { failed++; out.push({ o: r.o, m: r.m, err: "fetch" }); await sleep(200); continue; }
    const e = extract(xml);
    out.push({ o: r.o, n: r.n, m: r.m, ...e });
    if (PEEK) {
      console.log(`\n══ ${r.o} · 조문 ${e.articles}개`);
      console.log(`  위원회   ${e.cmte.kind}${e.cmte.article ? ` (${e.cmte.article} ${e.cmte.title})` : ""}`);
      console.log(`  참여기구 ${e.net.kind}${e.net.article ? ` (${e.net.article} ${e.net.title})` : ""}`);
      if (e.net.quote) console.log(`     "${e.net.quote.slice(0, 110)}"`);
      console.log(`  정기회   ${e.regular.n ?? "미상"}회`);
      console.log(`  정원     ${e.seats.n ?? "미상"}명`);
      console.log(`  청년비율 ${e.youthQuota.pct ?? "미상"}%${e.youthQuota.quote ? `  "${e.youthQuota.quote.slice(0, 80)}"` : ""}`);
      console.log(`  기본계획 ${e.plan.kind}${e.plan.cycle ? ` ${e.plan.cycle}년마다` : ""}${e.plan.article ? ` (${e.plan.article})` : ""}`);
    }
    await sleep(220);
  }
  if (!PEEK) console.log("");

  if (PEEK) return;
  const path = join(ROOT, "docs/data/governance.json");
  writeFileSync(path, JSON.stringify({ snapshotDate: SNAPSHOT_DATE, source: "법제처 Open API", rows: out }), "utf8");

  const c = k => out.filter(k).length;
  const dist = f => ["의무", "임의", "없음", "미상"].map(k => `${k} ${c(r => f(r) === k)}`).join(" · ");
  console.log(`\n위원회    ${dist(r => r.cmte?.kind)}`);
  console.log(`참여기구  ${dist(r => r.net?.kind)}`);
  console.log(`정기회    확보 ${c(r => r.regular?.n)} / ${out.length}   연2회 이상 ${c(r => r.regular?.n >= 2)}곳`);
  console.log(`정원      확보 ${c(r => r.seats?.n)}`);
  console.log(`청년비율  확보 ${c(r => r.youthQuota?.pct)}   그중 강제 ${c(r => r.youthQuota?.binding === 1)} · 노력조항 ${c(r => r.youthQuota?.binding === 0)}`);
  console.log(`기본계획  ${dist(r => r.plan?.kind)}`);
  console.log(`수집 실패 ${failed}건`);
  console.log(`\n  ${path}`);
}

main().catch(e => { console.error("실패:", e); process.exit(1); });
