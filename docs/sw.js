/* 청년정책 상황판 — 오프라인 캐시 */
const V = "yom-20260731";
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
