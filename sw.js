/* 3NDING service worker.
   Bump VERSION on every deploy so clients pick up the new shell.
   Book downloads live in an UNVERSIONED cache so a deploy never deletes them. */
const VERSION = "v4";
const SHELL = `3nding-shell-${VERSION}`;
const BOOKS = "3nding-books"; // must match Offline.CACHE in js/app.js
const LEGACY_BOOKS = "archive-books"; // pre-rebrand name; copied into BOOKS once
const COVERS = "3nding-covers";
const FONTS = "3nding-fonts";
const KEEP = [SHELL, BOOKS, COVERS, FONTS];
const MAX_COVERS = 80;

const SHELL_FILES = [
  "./",
  "index.html",
  "favorites.html",
  "reader.html",
  "css/style.css",
  "js/app.js",
  "js/home.js",
  "js/favorites.js",
  "js/reader.js",
  "js/stats.js",
  "books.json",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
  "icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // allSettled: one missing file must not break the whole install
      await Promise.allSettled(
        SHELL_FILES.map((f) => cache.add(new Request(f, { cache: "reload" }))),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      // Keep readers' downloaded books across the rename from "Archive"
      if (names.includes(LEGACY_BOOKS)) {
        try {
          const from = await caches.open(LEGACY_BOOKS);
          const to = await caches.open(BOOKS);
          for (const req of await from.keys()) {
            if (!(await to.match(req))) {
              const res = await from.match(req);
              if (res) await to.put(req, res);
            }
          }
        } catch {
          /* best effort: the book can simply be downloaded again */
        }
      }
      await Promise.all(
        names.filter((n) => !KEEP.includes(n)).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/* Cached copy first, refreshed in the background. */
async function staleWhileRevalidate(event, request, cacheName, key = request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

/* Network first; on a slow or dead connection fall back to the saved copy. */
async function networkFirst(event, request, cacheName, patienceMs = 3500) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (!cached) return network.catch(() => Response.error());
  event.waitUntil(network.catch(() => {}));
  return Promise.race([
    // a 404/500 from the server shouldn't hide a good saved copy
    network.then((res) => (res.ok ? res : cached)).catch(() => cached),
    new Promise((resolve) => setTimeout(() => resolve(cached), patienceMs)),
  ]);
}

/* Books and fonts don't change under the same URL: download once, reuse. */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

/* reader.html?id=3 and reader.html?id=5 share one cached page */
async function page(event, request) {
  const url = new URL(request.url);
  url.search = "";
  const res = await staleWhileRevalidate(event, request, SHELL, url.href);
  if (res && res.type !== "error") return res;
  return (await caches.match("index.html")) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/books.json")) {
      return event.respondWith(networkFirst(event, request, SHELL));
    }
    if (url.pathname.endsWith(".zip")) {
      return event.respondWith(cacheFirst(request, BOOKS));
    }
    if (request.mode === "navigate") {
      return event.respondWith(page(event, request));
    }
    return event.respondWith(staleWhileRevalidate(event, request, SHELL));
  }

  // Google Fonts: the stylesheet changes occasionally, the font files never do
  if (url.hostname === "fonts.googleapis.com") {
    return event.respondWith(staleWhileRevalidate(event, request, FONTS));
  }
  if (url.hostname === "fonts.gstatic.com") {
    return event.respondWith(cacheFirst(request, FONTS));
  }

  // Cross-origin cover images: keep the ones that have been seen
  if (request.destination === "image") {
    event.respondWith(
      staleWhileRevalidate(event, request, COVERS).then((res) => {
        event.waitUntil(trimCache(COVERS, MAX_COVERS));
        return res;
      }),
    );
  }
});
