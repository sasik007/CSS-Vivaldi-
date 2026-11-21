// Minimalny service worker — wymagany, by Android pozwolił zainstalować aplikację.
const CACHE = "mf-v1";
const SHELL = ["/", "/static/style.css", "/static/app.js", "/static/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname === "/share") return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
