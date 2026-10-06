"use strict";

const $ = (s, r = document) => r.querySelector(s);

/* ---------- Icons (Feather-style inline SVG) ---------- */
const ICONS = {
  heart:
    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  sliders:
    '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  expand:
    '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>',
  flame:
    '<path d="M12 2c.6 3.2 5 5.4 5 10.5a5 5 0 0 1-10 0c0-2 1-3.3 2.2-4.4.1 1.8.9 2.9 2 3.2-.9-3.4-.3-6.2.8-9.3z"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/>',
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------- Local storage ---------- */
const Store = {
  cache: new Map(),
  get(key, fallback) {
    if (!Store.cache.has(key)) {
      let value = null;
      try {
        value = JSON.parse(localStorage.getItem("lib." + key));
      } catch {
        /* storage unavailable or corrupted: behave as if empty */
      }
      Store.cache.set(key, value);
    }
    return Store.cache.get(key) ?? fallback;
  },
  set(key, value) {
    Store.cache.set(key, value);
    try {
      localStorage.setItem("lib." + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key) {
    Store.cache.delete(key);
    try {
      localStorage.removeItem("lib." + key);
    } catch {
      /* storage unavailable */
    }
  },
  invalidate() {
    Store.cache.clear();
  },
};
/* Registered first, so it runs before every other storage/pageshow listener */
window.addEventListener("storage", Store.invalidate);
window.addEventListener("pageshow", (e) => e.persisted && Store.invalidate());

/* ---------- Book ids ---------- */
const LEGACY_IDS = {
  1: "cartographers-daughter",
  2: "letter-to-a-young-botanist",
  3: "of-silent-things",
  4: "year-of-long-afternoons",
  5: "anatomy-of-quiet-room",
  6: "last-lighthouse-keeper",
  7: "field-notes-from-the-edge",
  8: "glasshouse-years",
  9: "slow-waters",
  10: "pocket-book-of-hours",
  "fiels-notes-from-the-edge": "field-notes-from-the-edge",
};
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const resolveId = (id) =>
  id != null && hasOwn(LEGACY_IDS, id) ? LEGACY_IDS[id] : id;
const readerUrl = (book, restart = false) =>
  `reader.html?id=${encodeURIComponent(book.id)}${restart ? "&restart=1" : ""}`;

function migrateLegacyIds() {
  for (const key of ["favs", "progress"]) {
    const data = Store.get(key, null);
    if (!data || typeof data !== "object") continue;
    if (!Object.keys(data).some((k) => hasOwn(LEGACY_IDS, k))) continue;
    const stamp = (v) => (v && (v.updated || v.addedAt)) || 0;
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const id = resolveId(k);
      if (!hasOwn(out, id) || stamp(v) >= stamp(out[id])) out[id] = v;
    }
    Store.set(key, out);
  }
}

const Favs = {
  all: () => Store.get("favs", {}),
  has: (id) => hasOwn(Favs.all(), id),
  isFinished: (id) =>
    !!(Favs.all()[id]?.finished || Progress.all()[id]?.finished),
  toggle(id) {
    const favs = { ...Favs.all() };
    const on = !hasOwn(favs, id);
    if (on) favs[id] = { finished: false, addedAt: Date.now() };
    else delete favs[id];
    Store.set("favs", favs);
    updateFavCount();
    return on;
  },
  setFinished(id, finished) {
    if (Favs.has(id)) {
      Store.set("favs", {
        ...Favs.all(),
        [id]: { ...Favs.all()[id], finished },
      });
    }
    const all = { ...Progress.all() };
    if (finished) {
      all[id] = {
        ...all[id],
        finished: true,
        finishedAt: Date.now(),
        updated: Date.now(),
      };
    } else if (all[id]) {
      const { finished: _f, finishedAt: _t, ...rest } = all[id];
      if (rest.total === undefined) delete all[id];
      else all[id] = rest;
    }
    Store.set("progress", all);
  },
};

const Progress = {
  all: () => Store.get("progress", {}),
  get: (id) => Progress.all()[id] || null,
  set(id, patch) {
    const all = { ...Progress.all() };
    all[id] = { ...all[id], ...patch, updated: Date.now() };
    Store.set("progress", all);
  },
  percent(id) {
    if (Favs.isFinished(id)) return 100;
    const p = Progress.get(id);
    if (!p || !p.total) return 0;
    return Math.min(100, Math.round(((p.chapter + p.scroll) / p.total) * 100));
  },
  recent(books) {
    const all = Progress.all();
    return books
      .filter((b) => all[b.id]?.total && !Favs.isFinished(b.id))
      .sort((a, b) => all[b.id].updated - all[a.id].updated);
  },
};

migrateLegacyIds();

/* ---------- Data ---------- */
async function loadBooks() {
  const res = await fetch("books.json");
  if (!res.ok) throw new Error(`Could not load books.json (${res.status})`);
  const raw = await res.json();
  if (!Array.isArray(raw)) throw new Error("books.json must be a list");
  const seen = new Set();
  const books = [];
  for (const b of raw) {
    const valid =
      b &&
      typeof b.id === "string" &&
      /^[\w-]+$/.test(b.id) &&
      !seen.has(b.id) &&
      b.title &&
      b.zip;
    if (!valid) {
      console.warn("Skipping invalid or duplicate book in books.json:", b);
      continue;
    }
    seen.add(b.id);
    books.push({ ...b, order: books.length });
  }
  loadBooks.ids = seen;
  updateFavCount();
  return books;
}

/* ---------- UI helpers ---------- */
function updateFavCount() {
  const el = $("#fav-count");
  if (!el) return;
  const ids = Object.keys(Favs.all()).filter(
    (id) => !loadBooks.ids || loadBooks.ids.has(id),
  );
  const n = ids.length;
  el.textContent = n || "";
  el.hidden = !n;
}

function toast(message) {
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove("show"), 2200);
}

async function shareBook(book) {
  const url = new URL(readerUrl(book), location.href).href;
  try {
    if (navigator.share) {
      await navigator.share({
        title: book.title,
        text: `${book.title} by ${book.author}`,
        url,
      });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast("Link copied");
  } catch (err) {
    if (err.name !== "AbortError") toast("Could not share this book");
  }
}

const escapeHTML = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const coverImg = (b, eager = false) =>
  `<img src="${escapeHTML(b.cover)}" alt="Cover of ${escapeHTML(b.title)}" loading="${eager ? "eager" : "lazy"}" width="600" height="800">`;

document.addEventListener("DOMContentLoaded", updateFavCount);
window.addEventListener("storage", updateFavCount);
window.addEventListener("pageshow", updateFavCount);
document.addEventListener(
  "error",
  (e) => {
    if (e.target.tagName === "IMG") e.target.classList.add("broken");
  },
  true,
);

/* ---------- Streaks: a day counts once you read the daily goal ---------- */
const Streak = {
  GOALS: [5, 10, 15, 20, 30], // minutes
  data() {
    const d = Store.get("streak", {});
    return {
      goal: Streak.GOALS.includes(d.goal) ? d.goal : 10,
      days: d.days && typeof d.days === "object" ? { ...d.days } : {},
    };
  },
  dayKey(date = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
  },
  seconds(key = Streak.dayKey()) {
    return Streak.data().days[key] || 0;
  },
  met(d, key) {
    return (d.days[key] || 0) >= d.goal * 60;
  },
  add(sec) {
    if (!(sec > 0)) return false;
    const d = Streak.data();
    const key = Streak.dayKey();
    const before = d.days[key] || 0;
    d.days[key] = before + Math.round(sec);
    const keys = Object.keys(d.days).sort();
    if (keys.length > 400)
      keys.slice(0, keys.length - 400).forEach((k) => delete d.days[k]);
    Store.set("streak", d);
    updateStreakChip();
    return before < d.goal * 60 && d.days[key] >= d.goal * 60;
  },
  setGoal(minutes) {
    if (!Streak.GOALS.includes(minutes)) return;
    const d = Streak.data();
    d.goal = minutes;
    Store.set("streak", d);
    updateStreakChip();
  },
  current() {
    const d = Streak.data();
    const day = new Date();
    if (!Streak.met(d, Streak.dayKey(day))) day.setDate(day.getDate() - 1);
    let n = 0;
    while (Streak.met(d, Streak.dayKey(day))) {
      n++;
      day.setDate(day.getDate() - 1);
    }
    return n;
  },
  longest() {
    const d = Streak.data();
    const keys = Object.keys(d.days)
      .filter((k) => Streak.met(d, k))
      .sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const k of keys) {
      const t = new Date(k + "T12:00:00");
      run = prev && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
      prev = t;
      best = Math.max(best, run);
    }
    return best;
  },
  week() {
    const d = Streak.data();
    const out = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date();
      day.setDate(day.getDate() - i);
      const key = Streak.dayKey(day);
      out.push({
        key,
        label: day.toLocaleDateString(undefined, { weekday: "short" }),
        name: day.toLocaleDateString(undefined, { weekday: "long" }),
        seconds: d.days[key] || 0,
        met: Streak.met(d, key),
        today: i === 0,
      });
    }
    return out;
  },
  totalMinutes() {
    const d = Streak.data();
    return Math.floor(
      Object.values(d.days).reduce((a, b) => a + (Number(b) || 0), 0) / 60,
    );
  },
  summary() {
    const d = Streak.data();
    const sum = (from, to) => {
      let s = 0;
      for (let i = from; i <= to; i++) {
        const day = new Date();
        day.setDate(day.getDate() - i);
        s += d.days[Streak.dayKey(day)] || 0;
      }
      return s;
    };
    const days = Streak.week();
    const goalSec = d.goal * 60;
    return {
      days,
      goal: d.goal,
      goalSec,
      total: sum(0, 6),
      prev: sum(7, 13),
      goalDays: days.filter((x) => x.met).length,
      maxSec: Math.max(goalSec, ...days.map((x) => x.seconds)),
      finished: finishedThisWeek(),
    };
  },
};

/** Books finished in the last 7 days. */
function finishedThisWeek() {
  const since = Date.now() - 7 * 864e5;
  return Object.values(Progress.all()).filter(
    // finishedAt: later scrolling in a finished book must not renew "this week"
    (p) => p.finished && (p.finishedAt ?? p.updated) >= since,
  ).length;
}

/* Flame chip in the site header (library pages only) */
function updateStreakChip() {
  const nav = $(".site-header nav");
  if (!nav) return;
  let chip = $("#streak-chip");
  if (!chip) {
    chip = document.createElement("a");
    chip.id = "streak-chip";
    chip.className = "streak-chip";
    chip.href = "index.html#streak-section";
    nav.prepend(chip);
  }
  const n = Streak.current();
  chip.classList.toggle("idle", !n);
  chip.innerHTML = `<span class="ico">${icon("flame", 22)}</span><span class="num">${n}</span><span class="lbl">Streak</span>`;
  chip.setAttribute(
    "aria-label",
    n ? `${n}-day reading streak` : "No reading streak yet",
  );
}
function decorateNav() {
  document.querySelectorAll(".site-header nav a[data-icon]").forEach((a) => {
    if (a.querySelector(".ico")) return;
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.innerHTML = icon(a.dataset.icon, 22);
    a.prepend(ico);
  });
}
document.addEventListener("DOMContentLoaded", () => {
  const y = $("#year");
  if (y) y.textContent = new Date().getFullYear();
});
document.addEventListener("DOMContentLoaded", decorateNav);
document.addEventListener("DOMContentLoaded", updateStreakChip);
window.addEventListener("storage", updateStreakChip);
window.addEventListener("pageshow", updateStreakChip);

/* ---------- Offline books: save a zip into the Cache API ---------- */
const Offline = {
  CACHE: "3nding-books",
  supported:
    "caches" in window &&
    "serviceWorker" in navigator &&
    window.isSecureContext,
  saved: new Set(),
  busy: new Map(), 
  abs: (zip) => new URL(zip, location.href).href,
  has: (zip) => Offline.saved.has(Offline.abs(zip)),
  state(zip) {
    if (Offline.busy.has(zip)) return "busy";
    return Offline.has(zip) ? "saved" : "idle";
  },
  inner(zip) {
    const s = Offline.state(zip);
    if (s === "saved") return icon("check", 18);
    if (s === "busy") {
      const p = Offline.busy.get(zip);
      const known = p >= 0;
      const off = known ? 88 * (1 - p) : 66;
      return `<svg class="ring ${known ? "" : "spin"}" viewBox="0 0 36 36" aria-hidden="true"><circle class="trk" cx="18" cy="18" r="14"/><circle class="val" cx="18" cy="18" r="14" style="stroke-dashoffset:${off}"/></svg>`;
    }
    return icon("download", 18);
  },
  tip: (s) =>
    s === "saved"
      ? "Saved for offline reading. Tap to remove."
      : s === "busy"
        ? "Downloading…"
        : "Save for offline reading",
  btn(book, cls) {
    if (!Offline.supported) return "";
    const s = Offline.state(book.zip);
    return `<button type="button" class="${cls} offline-btn" data-offline data-zip="${escapeHTML(book.zip)}" data-title="${escapeHTML(book.title)}"
      aria-pressed="${s === "saved"}" aria-busy="${s === "busy"}" aria-label="${s === "saved" ? "Remove offline copy" : "Save offline"}: ${escapeHTML(book.title)}" title="${Offline.tip(s)}">${Offline.inner(book.zip)}</button>`;
  },
  paint(zip) {
    const s = Offline.state(zip);
    document.querySelectorAll("[data-offline]").forEach((b) => {
      if (b.dataset.zip !== zip) return;
      b.innerHTML = Offline.inner(zip);
      b.setAttribute("aria-pressed", s === "saved");
      b.setAttribute("aria-busy", s === "busy");
      b.title = Offline.tip(s);
      b.setAttribute(
        "aria-label",
        `${s === "saved" ? "Remove offline copy" : "Save offline"}: ${b.dataset.title}`,
      );
      b.closest(".card, .fav-card")?.classList.toggle("saved", s === "saved");
    });
  },
  paintAll() {
    new Set(
      [...document.querySelectorAll("[data-offline]")].map(
        (b) => b.dataset.zip,
      ),
    ).forEach(Offline.paint);
  },
  async refresh() {
    if (!Offline.supported) return;
    try {
      const cache = await caches.open(Offline.CACHE);
      Offline.saved = new Set((await cache.keys()).map((r) => r.url));
    } catch {
      /* private mode etc. */
    }
    Offline.paintAll();
  },
  async toggle(zip, title) {
    const state = Offline.state(zip);
    if (state === "busy") return;
    const url = Offline.abs(zip);
    try {
      const cache = await caches.open(Offline.CACHE);
      if (state === "saved") {
        await cache.delete(url);
        Offline.saved.delete(url);
        Offline.paint(zip);
        return toast("Removed the offline copy");
      }
      Offline.busy.set(zip, 0);
      Offline.paint(zip);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || 0;
      const reader = res.clone().body?.getReader();
      const stored = cache.put(url, res);
      stored.catch(() => {});
      if (reader) {
        let got = 0;
        let last = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          got += value.length;
          const p = total ? Math.min(0.97, got / total) : -1;
          if (Date.now() - last > 80) {
            last = Date.now();
            Offline.busy.set(zip, p);
            Offline.paint(zip);
          }
        }
      }
      await stored;
      Offline.saved.add(url);
      Offline.busy.delete(zip);
      Offline.paint(zip);
      toast(`Saved “${title}” for offline reading`);
      navigator.storage?.persist?.().catch?.(() => {});
    } catch (err) {
      Offline.busy.delete(zip);
      Offline.paint(zip);
      toast(
        err?.name === "QuotaExceededError"
          ? "Not enough storage space on this device"
          : "Couldn’t download this book. Try again.",
      );
    }
  },
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-offline]");
  if (b) {
    e.preventDefault();
    return Offline.toggle(b.dataset.zip, b.dataset.title);
  }
  const link = e.target.closest('a[href^="reader.html"]');
  if (link && navigator.onLine === false) {
    const card = link.closest(".card, .fav-card");
    if (card && !card.classList.contains("saved")) {
      e.preventDefault();
      toast("Save this book for offline reading while you’re online");
    }
  }
});
window.addEventListener("pageshow", Offline.refresh);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") Offline.refresh();
});
const syncOnline = () =>
  document.body.classList.toggle("is-offline", navigator.onLine === false);
syncOnline();
window.addEventListener("online", syncOnline);
window.addEventListener("offline", syncOnline);

/* ---------- PWA: service worker, install prompt, offline notices ---------- */
const Install = {
  event: null,
  standalone:
    matchMedia("(display-mode: standalone)").matches ||
    navigator.standalone === true,
  ios:
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  async run() {
    if (!Install.event) return;
    Install.event.prompt();
    await Install.event.userChoice.catch(() => {});
    Install.event = null;
    document.dispatchEvent(new Event("installchange"));
  },
};
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  Install.event = e;
  document.dispatchEvent(new Event("installchange"));
});
window.addEventListener("appinstalled", () => {
  Install.event = null;
  Install.standalone = true;
  document.dispatchEvent(new Event("installchange"));
  toast("3NDING installed");
});

if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    ["localhost", "127.0.0.1"].includes(location.hostname))
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("sw.js")
      .then((reg) => {
        reg.addEventListener("updatefound", () => {
          const worker = reg.installing;
          worker?.addEventListener("statechange", () => {
            if (
              worker.state === "installed" &&
              navigator.serviceWorker.controller
            )
              toast("Update ready — reload to get it");
          });
        });
      })
      .catch(() => {
        /* offline support is optional */
      });
  });
}
window.addEventListener("offline", () =>
  toast("You’re offline — books you’ve opened still work"),
);
window.addEventListener("online", () => toast("Back online"));

/* ---------- Minimal ZIP reader (stored + deflate via DecompressionStream) ---------- */
async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const utf8 = new TextDecoder();

  let eocd = buffer.byteLength - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Not a valid zip file");

  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const entries = new Map();

  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50)
      throw new Error("This book file is damaged");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = utf8.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    const start =
      offset +
      30 +
      view.getUint16(offset + 26, true) +
      view.getUint16(offset + 28, true);
    entries.set(name, { method, data: bytes.subarray(start, start + size) });
  }

  return {
    async text(name) {
      const key = entries.has(name)
        ? name
        : [...entries.keys()].find((k) => k.endsWith("/" + name));
      if (!key) throw new Error(`"${name}" not found in this book file`);
      const { method, data } = entries.get(key);
      if (method === 0) return utf8.decode(data);
      if (method !== 8) throw new Error("Unsupported zip compression");
      if (typeof DecompressionStream === "undefined")
        throw new Error("This browser is too old to open books");
      const stream = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).text();
    },
  };
}
