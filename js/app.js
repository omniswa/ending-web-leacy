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
};
const icon = (name, size = 18) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

/* ---------- Local storage ---------- */
const Store = {
  get(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem("lib." + key)) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem("lib." + key, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
  remove(key) {
    try {
      localStorage.removeItem("lib." + key);
    } catch {
      /* storage unavailable */
    }
  },
};

const Favs = {
  all: () => Store.get("favs", {}),
  has: (id) => String(id) in Favs.all(),
  /* FIX: "finished" now also lives in Progress, so books that were never
     favorited can be finished too (and stop showing in "Continue reading"). */
  isFinished: (id) =>
    !!(Favs.all()[id]?.finished || Progress.all()[id]?.finished),
  toggle(id) {
    const favs = Favs.all();
    if (id in favs) delete favs[id];
    else favs[id] = { finished: false, addedAt: Date.now() };
    Store.set("favs", favs);
    updateFavCount();
    return id in favs;
  },
  setFinished(id, finished) {
    const favs = Favs.all();
    if (favs[id]) {
      favs[id].finished = finished;
      Store.set("favs", favs);
    }
    const all = Progress.all();
    if (finished) {
      all[id] = { ...all[id], finished: true, updated: Date.now() };
    } else if (all[id]) {
      delete all[id].finished;
      // An entry that was created only by "mark finished" carries no reading data
      if (all[id].total === undefined) delete all[id];
    }
    Store.set("progress", all);
  },
};

const Progress = {
  all: () => Store.get("progress", {}),
  get: (id) => Progress.all()[id] || null,
  set(id, patch) {
    const all = Progress.all();
    all[id] = { ...all[id], ...patch, updated: Date.now() };
    Store.set("progress", all);
  },
  percent(id) {
    if (Favs.isFinished(id)) return 100;
    const p = Progress.get(id);
    if (!p || !p.total) return 0;
    return Math.min(100, Math.round(((p.chapter + p.scroll) / p.total) * 100));
  },
  /** Books started and not finished, most recently read first. */
  recent(books) {
    const all = Progress.all();
    return books
      .filter((b) => all[b.id]?.total && !Favs.isFinished(b.id))
      .sort((a, b) => all[b.id].updated - all[a.id].updated);
  },
};

/* ---------- Data ---------- */
async function loadBooks() {
  const res = await fetch("books.json");
  if (!res.ok) throw new Error(`Could not load books.json (${res.status})`);
  return res.json();
}

/* ---------- UI helpers ---------- */
function updateFavCount() {
  const el = $("#fav-count");
  if (!el) return;
  const n = Object.keys(Favs.all()).length;
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
  const url = new URL(`reader.html?id=${book.id}`, location.href).href;
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

const coverImg = (b) =>
  `<img src="${escapeHTML(b.cover)}" alt="Cover of ${escapeHTML(b.title)}" loading="lazy" width="600" height="800">`;

document.addEventListener("DOMContentLoaded", updateFavCount);
/* Keep the favorites badge in sync (other tabs, back/forward cache) */
window.addEventListener("storage", updateFavCount);
window.addEventListener("pageshow", updateFavCount);
/* Broken cover images fall back to the gradient background */
document.addEventListener(
  "error",
  (e) => {
    if (e.target.tagName === "IMG") e.target.classList.add("broken");
  },
  true,
);

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
      const key = [...entries.keys()].find(
        (k) => k === name || k.endsWith("/" + name),
      );
      if (!key) throw new Error(`"${name}" not found in archive`);
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
