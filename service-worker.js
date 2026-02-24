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

/* ===============================
   PWA: MANUAL UPDATE CHECK
================================ */

let __swRegistration = null;

// If you already have SW registration code, just add the line:
// __swRegistration = reg;
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("./service-worker.js");
      __swRegistration = reg;

      // If there's already a waiting worker, show banner immediately
      if (reg.waiting) showUpdateBanner(reg);

      reg.addEventListener("updatefound", () => {
        const newWorker = reg.installing;
        if (!newWorker) return;

        newWorker.addEventListener("statechange", () => {
          if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(reg);
          }
        });
      });

      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });

    } catch (err) {
      console.error("Service worker registration failed:", err);
    }
  });
}

function setUpdateStatus(msg) {
  const el = document.getElementById("updateStatus");
  if (el) el.textContent = msg;
}

async function checkForUpdates() {
  if (!("serviceWorker" in navigator)) {
    alert("Service workers aren’t supported in this browser.");
    return;
  }

  // Prefer cached reg if we have it, else fetch it
  const reg = __swRegistration || await navigator.serviceWorker.getRegistration();
  if (!reg) {
    alert("No service worker registered yet.");
    return;
  }

  setUpdateStatus("Checking for updates…");

  // If already waiting, we already have an update
  if (reg.waiting) {
    setUpdateStatus("Update available. Tap Refresh to install it.");
    showUpdateBanner(reg);
    return;
  }

  // Wait for updatefound or timeout
  let resolved = false;

  const done = (text) => {
    if (resolved) return;
    resolved = true;
    setUpdateStatus(text);
  };

  const onUpdateFound = () => {
    const nw = reg.installing;
    if (!nw) return;

    nw.addEventListener("statechange", () => {
      if (nw.state === "installed") {
        // If controller exists, it's an update; otherwise first install
        if (navigator.serviceWorker.controller) {
          done("Update available. Tap Refresh to install it.");
          showUpdateBanner(reg);
        } else {
          done("Offline support enabled.");
        }
      }
    });
  };

  reg.addEventListener("updatefound", onUpdateFound, { once: true });

  try {
    await reg.update();
  } catch (e) {
    done("Couldn’t check for updates (are you offline?).");
    return;
  }

  // If nothing happens after a short wait, assume no update
  setTimeout(() => {
    if (!resolved) done("You’re up to date.");
  }, 2500);
}