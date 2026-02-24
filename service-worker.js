// sw.js
const VERSION = "v1.0.1"; // bump this when you release
const CACHE_NAME = `hgv-work-log-${VERSION}`;

// Keep this list to your “app shell”
const APP_SHELL = [
  "./",
  "./index.html",       
  "./enter-shift.html",
  "./summary.html",
  "./shifts.html",
  "./companies.html",
  "./vehicles.html",
  "./settings.html",
  "./styles.css",
  "./app.js",
  // fonts (add the ones you actually have)
  "./fonts/Inter-Regular.woff2",
  "./fonts/Inter-SemiBold.woff2",
  "./fonts/Inter-Bold.woff2",
  // icons if/when you add them
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./manifest.webmanifest"
];

// Install: cache app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Note: we do NOT skipWaiting here. We want “Update available” UX.
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map((k) => (k.startsWith("hgv-work-log-") && k !== CACHE_NAME) ? caches.delete(k) : null)
    );
    await self.clients.claim();
  })());
});

// Fetch strategy:
// - For navigation/doc requests: network-first (fresh HTML), fallback to cache offline
// - For assets: cache-first
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Ignore non-GET
  if (req.method !== "GET") return;

  // Only handle same-origin
  if (url.origin !== self.location.origin) return;

  // HTML pages: Network-first
  const isHTML =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");

  if (isHTML) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        return cached || caches.match("./index.html");
      }
    })());
    return;
  }

  // Assets: Cache-first
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;

    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  })());
});

// Listen for “skip waiting” message (we call this when user hits Refresh)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});