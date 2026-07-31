/**
 * 지난 수집 대비 무엇이 바뀌었나 — 주간 알림의 재료
 *
 *   node scripts/whats-new.mjs
 *   node scripts/whats-new.mjs --slack     Slack 용 평문만 출력
 *
 * 출력  work/whats-new.json  ·  표준출력에 사람이 읽을 요약
 *
 * ── 절대 규칙 ────────────────────────────────────────────────
 * **이전 스냅샷이 없으면 신설·폐지를 판정하지 않는다.** 첫 수집은 기준선일 뿐이다.
 * 이걸 어기면 매주 「신규 94건!」 이라는 거짓 알림이 나간다.
 *
 * 「사라졌다」는 **폐지가 아니다.** 사이트에서 내렸을 수도, 우리가 못 받았을 수도
 * 있다. 그래서 「목록에서 빠짐」이라고만 쓴다(원칙 5).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SLACK_ONLY = process.argv.includes("--slack");
const SLACK_JSON = process.argv.includes("--slack-json");
const snaps = re => readdirSync(join(ROOT, "data")).filter(f => re.test(f)).sort();
const load = f => JSON.parse(readFileSync(join(ROOT, "data", f), "utf8").replace(/^﻿/, ""));

/* ── 양산 (청년가까e) ── */
const ysFiles = snaps(/수집_양산청년정책_전수\.json$/);
const ys = { baseline: ysFiles.length < 2, added: [], stateChanged: [], gone: [] };
if (!ys.baseline) {
  const prev = load(ysFiles[ysFiles.length - 2]), cur = load(ysFiles[ysFiles.length - 1]);
  const pm = new Map(prev.policies.filter(p => p.origin === "self").map(p => [p.id, p]));
  const cm = new Map(cur.policies.filter(p => p.origin === "self").map(p => [p.id, p]));
  for (const [id, p] of cm) {
    const o = pm.get(id);
    if (!o) { ys.added.push({ id, nm: p.nm, field: p.field, state: p.apply?.state || p.state || null }); continue; }
    const a = o.apply?.state || o.state, b = p.apply?.state || p.state;
    /* 「접수마감 → 접수중」은 새 회차가 열렸다는 뜻이라 신규만큼 중요하다 */
    if (a !== b && b) ys.stateChanged.push({ id, nm: p.nm, from: a || "미상", to: b });
  }
  for (const [id, p] of pm) if (!cm.has(id)) ys.gone.push({ id, nm: p.nm });
  ys.prevDate = prev.date; ys.curDate = cur.date;
}

/* ── 온통청년 (경남 시군 · 타시도 소재) ── */
const opFiles = snaps(/수집_청년정책_전수\.json$/);
const op = { baseline: opFiles.length < 2, added: [] };
if (!op.baseline) {
  const key = r => `${r.plcyNo || r.bizId || ""}|${r.plcyNm || ""}`;
  const rowsOf = d => (d.rows || d.list || d.policies || []);
  const prev = new Set(rowsOf(load(opFiles[opFiles.length - 2])).map(key));
  for (const r of rowsOf(load(opFiles[opFiles.length - 1]))) {
    if (prev.has(key(r))) continue;
    const org = [r.sprvsnInstCdNm, r.operInstCdNm].filter(Boolean).join(" ");
    if (!/경상남도|경남/.test(org)) continue;          // 알림은 경남만 — 전국은 앱에서 본다
    op.added.push({ nm: r.plcyNm, org, kw: r.plcyKywdNm || null });
  }
}

const out = { at: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC", ys, op };
mkdirSync(join(ROOT, "work"), { recursive: true });
writeFileSync(join(ROOT, "work/whats-new.json"), JSON.stringify(out, null, 2), "utf8");

/* ── 사람이 읽는 요약 ── */
const L = [];
const push = (...x) => L.push(...x);
if (ys.baseline) push("양산 청년가까e — 이전 스냅샷이 없어 *변화 판정 안 함* (기준선)");
else {
  push(`*양산 청년가까e* (${ys.prevDate} → ${ys.curDate})`);
  if (ys.added.length) {
    push(`• 새 정책 *${ys.added.length}건*`);
    ys.added.slice(0, 8).forEach(a => push(`   · ${a.nm}${a.state ? ` [${a.state}]` : ""}`));
    if (ys.added.length > 8) push(`   · 외 ${ys.added.length - 8}건`);
  }
  const opened = ys.stateChanged.filter(c => c.to === "접수중" || c.to === "접수예정");
  if (opened.length) {
    push(`• *접수가 열린 것 ${opened.length}건*`);
    opened.slice(0, 8).forEach(c => push(`   · ${c.nm} (${c.from} → ${c.to})`));
  }
  const closed = ys.stateChanged.filter(c => c.to === "접수마감");
  if (closed.length) push(`• 마감된 것 ${closed.length}건`);
  if (ys.gone.length) push(`• 목록에서 빠짐 ${ys.gone.length}건 — *폐지로 단정하지 마십시오*`);
  if (!ys.added.length && !ys.stateChanged.length && !ys.gone.length) push("• 변화 없음");
}
push("");
if (op.baseline) push("온통청년(경남) — 이전 스냅샷이 없어 판정 안 함");
else if (op.added.length) {
  push(`*온통청년 · 경남 신규 등록 ${op.added.length}건*`);
  op.added.slice(0, 6).forEach(a => push(`   · ${a.nm} — ${a.org}`));
  if (op.added.length > 6) push(`   · 외 ${op.added.length - 6}건`);
} else push("온통청년(경남) — 신규 등록 없음");

const text = L.join("\n");
if (SLACK_JSON) {
  /* Slack Incoming Webhook 페이로드. 셸에서 문자열을 조립하면 따옴표·줄바꿈이
     깨진다 — JSON.stringify 로 만들어 curl 이 파일째 보내게 한다(원칙 6). */
  const date = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  process.stdout.write(JSON.stringify({
    text: `*청년정책 상황판 주간 갱신 — ${date}*\n\n${text}\n\n` +
      "<https://gudwls5337-dot.github.io/youth-policy-app/?city=경상남도 양산시|앱에서 보기>",
  }));
  process.exit(0);
}
if (SLACK_ONLY) { process.stdout.write(text); process.exit(0); }
console.log(`무엇이 바뀌었나 — ${out.at}\n`);
console.log(text);
console.log(`\n  → work/whats-new.json`);
