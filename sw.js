/* 3NDING service worker.
   Bump VERSION on every deploy so clients pick up the new shell.
   Caches that must outlive a deploy are UNVERSIONED (BOOKS) or small and self-trimming.

   BOOKS   books the reader explicitly saved for offline (never trimmed here)
   RECENT  books merely opened while online: last few only, so reloading a
           reader page offline still works without growing forever
   COVERS  same-origin cover images, capped
   PAGES   visited book/ and library/ pages, capped
   SHELL   app files (versioned)  FONTS  Google Fonts */
const VERSION = "v1";
const SHELL = `3nding-shell-${VERSION}`;
const BOOKS = "3nding-books"; 
const RECENT = "3nding-recent";
const LEGACY_BOOKS = "archive-books"; 
const COVERS = "3nding-covers";
const PAGES = "3nding-pages";
const FONTS = "3nding-fonts";
const KEEP = [SHELL, BOOKS, RECENT, COVERS, PAGES, FONTS];
const MAX_RECENT = 6;
const MAX_COVERS = 150;
const MAX_PAGES = 60;

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

/* Keep only the newest `max` entries (Cache keys are in insertion order). */
async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(
  event,
  request,
  cacheName,
  key = request,
  allowOpaque = false,
) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const refresh = fetch(request)
    .then((res) => {
      if (res.ok || (allowOpaque && res.type === "opaque"))
        cache.put(key, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  return (await refresh) || Response.error();
}

/* Network first; on a slow or dead connection fall back to the saved copy.
   Redirected responses are never cached (a cached redirect breaks navigations). */
async function networkFirst(
  event,
  request,
  cacheName,
  patienceMs = 3500,
  key = request,
) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const network = fetch(request).then((res) => {
    if (res.ok && !res.redirected) cache.put(key, res.clone());
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

/* Font files never change under the same URL: download once, reuse. */
async function cacheFirst(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) event.waitUntil(cache.put(request, res.clone()).catch(() => {}));
  return res;
}

async function bookZip(event, request) {
  const hit = await caches.match(request); // BOOKS or RECENT
  if (hit) return hit;
  const res = await fetch(request);
  if (res.status === 200) {
    const copy = res.clone();
    event.waitUntil(
      (async () => {
        try {
          const cache = await caches.open(RECENT);
          await cache.put(request, copy);
          await trimCache(RECENT, MAX_RECENT);
        } catch {
          /* quota or private mode: reading still works online */
        }
      })(),
    );
  }
  return res;
}

async function page(event, request) {
  const url = new URL(request.url);
  url.search = "";
  const deep = /\/(book|library)\//.test(url.pathname);
  const res = await networkFirst(
    event,
    request,
    deep ? PAGES : SHELL,
    3500,
    url.href,
  );
  if (deep) event.waitUntil(trimCache(PAGES, MAX_PAGES));
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
      return event.respondWith(bookZip(event, request));
    }
    if (request.mode === "navigate") {
      return event.respondWith(page(event, request));
    }
    // Self-hosted covers: revalidated in the background, capped
    if (request.destination === "image" && url.pathname.includes("/covers/")) {
      return event.respondWith(
        staleWhileRevalidate(event, request, COVERS).then((res) => {
          event.waitUntil(trimCache(COVERS, MAX_COVERS));
          return res;
        }),
      );
    }
    return event.respondWith(networkFirst(event, request, SHELL));
  }

  // Google Fonts: the stylesheet changes occasionally, the font files never do
  if (url.hostname === "fonts.googleapis.com") {
    return event.respondWith(
      staleWhileRevalidate(event, request, FONTS, request, true),
    );
  }
  if (url.hostname === "fonts.gstatic.com") {
    return event.respondWith(cacheFirst(event, request, FONTS));
  }
  // Other cross-origin requests (e.g. remote cover images): leave to the browser
});
