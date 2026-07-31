/**
 * PWA 자산 생성 — 매니페스트 · 서비스워커 · 아이콘
 *
 *   node scripts/make-pwa.mjs
 *
 * 아이콘은 외부 라이브러리 없이 PNG 를 직접 인코딩한다(zlib 은 node 내장).
 * 이미지 도구를 새로 들이지 않으려는 것이고, 단색+막대 도형이면 충분하다.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS = join(ROOT, "docs");
mkdirSync(join(DOCS, "icons"), { recursive: true });

/* ── PNG 인코더 ── */
const CRC_T = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC_T[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(w, h, paint) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    const off = y * (w * 4 + 1);
    raw[off] = 0;                                  // 필터 없음
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = paint(x, y, w, h);
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ── 아이콘: 청록 바탕 + 흰 분포 막대 3개 ── */
const TEAL = [0, 137, 122];
function icon(x, y, w, h) {
  const u = w / 24;                                 // 24 단위 그리드
  const gx = x / u, gy = y / u;
  /* 막대 3개 — 길이가 다른 것은 분포를 뜻한다 */
  const bars = [[5, 6.5, 14], [5, 10.8, 10], [5, 15.1, 16]];
  for (const [bx, by, bw] of bars) {
    if (gy >= by && gy <= by + 2.6 && gx >= bx && gx <= bx + bw) return [255, 255, 255, 255];
  }
  return [...TEAL, 255];
}
/* maskable 은 안전영역(80%) 안에 도형이 들어가야 해서 여백을 더 준다 */
function iconMaskable(x, y, w, h) {
  const pad = w * 0.1;
  const inner = w - pad * 2;
  if (x < pad || y < pad || x >= w - pad || y >= h - pad) return [...TEAL, 255];
  return icon(x - pad, y - pad, inner, inner);
}

for (const [name, size, fn] of [
  ["icon-192.png", 192, icon], ["icon-512.png", 512, icon],
  ["icon-maskable-512.png", 512, iconMaskable], ["apple-touch-icon.png", 180, iconMaskable],
]) {
  writeFileSync(join(DOCS, "icons", name), png(size, size, fn));
}

/* ── 매니페스트 ── */
writeFileSync(join(DOCS, "manifest.webmanifest"), JSON.stringify({
  name: "청년정책 상황판",
  short_name: "청년정책",
  description: "전국 지자체 청년정책과 조례를 한 화면에. 우리 시 기준으로 신청 가능·신설·종료를 구분해 보여줍니다.",
  start_url: "./",
  scope: "./",
  display: "standalone",
  orientation: "portrait",
  background_color: "#EEF1F2",
  theme_color: "#00897A",
  lang: "ko",
  categories: ["government", "utilities"],
  icons: [
    { src: "icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2), "utf8");

/* ── 서비스워커 ──
   데이터가 3MB 라 한 번 열면 통째로 캐시한다. 이후에는 오프라인에서도 뜬다.
   갱신은 network-first 로 받아 조용히 교체한다. */
writeFileSync(join(DOCS, "sw.js"), `/* 청년정책 상황판 — 오프라인 캐시 */
const V = "yom-__VERSION__";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  /* 문서(HTML)는 **반드시 서버에 물어본다.** GitHub Pages 가 max-age=600 을 주므로
     그냥 fetch 하면 브라우저 HTTP 캐시가 최대 10분치 옛 화면을 돌려준다.
     network-first 로 짜 놓고도 옛 빌드가 계속 보이던 원인이다(2026-07-31). */
  /* 정규식을 쓰면 템플릿 리터럴에서 백슬래시가 먹힌다(원칙 6). 문자열 검사로 한다. */
  const path = new URL(e.request.url).pathname;
  const isDoc = e.request.mode === "navigate" ||
    e.request.destination === "document" ||
    path.endsWith("/") || path.endsWith("/index.html");
  const req = isDoc ? new Request(e.request, { cache: "no-cache" }) : e.request;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(V).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html")))
  );
});
`.replace("__VERSION__", new Date().toISOString().slice(0, 10).replace(/-/g, "")), "utf8");

console.log("PWA 자산 생성");
console.log("  docs/manifest.webmanifest");
console.log("  docs/sw.js");
console.log("  docs/icons/ (192 · 512 · maskable · apple-touch)");
