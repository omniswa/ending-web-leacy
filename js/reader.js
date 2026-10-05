"use strict";

(() => {
  const DEFAULTS = {
    font: "serif",
    theme: "paper",
    size: 18,
    align: "left",
    spacing: "normal",
    width: "normal",
  };
  const THEME_COLORS = {
    paper: "#fbfbf8",
    sepia: "#f0e4cb",
    dark: "#1c2027",
    oled: "#000000",
  };
  /* FIX: validate saved settings so corrupted storage can't break the theme */
  const VALID = {
    font: ["serif", "sans", "mono"],
    theme: Object.keys(THEME_COLORS),
    align: ["left", "justify"],
    spacing: ["compact", "normal", "relaxed"],
    width: ["narrow", "normal", "wide"],
  };
  function cleanSettings(s) {
    const out = { ...DEFAULTS, ...s };
    for (const k of Object.keys(VALID))
      if (!VALID[k].includes(out[k])) out[k] = DEFAULTS[k];
    const size = Number(out.size);
    out.size = size >= 14 && size <= 32 ? size : DEFAULTS.size;
    return out;
  }

  const root = document.documentElement;
  const textEl = $("#text");
  const params = new URLSearchParams(location.search);
  const bookId = Number(params.get("id"));
  const restart = params.get("restart") === "1";

  let settings = cleanSettings(Store.get("settings", {}));
  let book = null;
  let zip = null;
  let chapters = [];
  let current = 0;
  let saveTimer = 0;
  let loading = false;
  let loadId = 0; // FIX: guards against overlapping chapter loads
  let lastTrigger = null;
  let finishedNow = false; // the Finish button has been pressed on the last chapter

  /* ---------- Static icons ---------- */
  $("#back").innerHTML = icon("left", 20);
  $("#btn-toc").innerHTML = icon("list", 20);
  $("#btn-settings").innerHTML = icon("sliders", 20);
  $("#btn-fs").innerHTML = icon("expand", 20);
  $("#exit-fs").innerHTML = icon("x", 20);
  $("#reset").innerHTML = `${icon("undo", 16)} Reset to defaults`;
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => (b.innerHTML = icon("x", 20)));

  /* FIX: "Back" returns to the exact library page/sort the reader came from */
  $("#back").addEventListener("click", (e) => {
    if (history.length > 1 && document.referrer.startsWith(location.origin)) {
      e.preventDefault();
      history.back();
    }
  });

  /* ---------- Settings ---------- */
  function applySettings(save = true) {
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    root.dataset.align = settings.align;
    root.dataset.spacing = settings.spacing;
    root.dataset.width = settings.width;
    document.body.style.setProperty("--fs", `${settings.size}px`);
    $('meta[name="theme-color"]').content = THEME_COLORS[settings.theme];
    $("#size").value = settings.size;
    $("#size-out").textContent = `${settings.size}px`;
    document
      .querySelectorAll(".seg")
      .forEach((seg) =>
        seg
          .querySelectorAll("button")
          .forEach((b) =>
            b.setAttribute(
              "aria-pressed",
              b.dataset.val === String(settings[seg.dataset.key]),
            ),
          ),
      );
    if (save) Store.set("settings", settings);
  }

  document.querySelectorAll(".seg").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      settings[seg.dataset.key] = btn.dataset.val;
      applySettings();
    }),
  );
  $("#size").addEventListener("input", (e) => {
    settings.size = Number(e.target.value);
    applySettings();
  });
  $("#reset").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    Store.remove("settings");
    applySettings(false);
    toast("Settings reset");
  });

  /* ---------- Panels ---------- */
  const scrim = $("#scrim");
  const panelOpen = () => !!document.querySelector(".panel.open");

  function openPanel(id) {
    closePanels(false);
    lastTrigger = document.activeElement;
    $(id).classList.add("open");
    scrim.classList.add("show");
    document.body.classList.add("panel-open");
    $(id).querySelector("button, [href]")?.focus();
    document
      .querySelectorAll("[aria-controls]")
      .forEach((b) =>
        b.setAttribute(
          "aria-expanded",
          String(b.getAttribute("aria-controls") === id.slice(1)),
        ),
      );
  }
  function closePanels(restoreFocus = true) {
    document
      .querySelectorAll(".panel.open")
      .forEach((p) => p.classList.remove("open"));
    scrim.classList.remove("show");
    document.body.classList.remove("panel-open");
    document
      .querySelectorAll("[aria-controls]")
      .forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (restoreFocus) {
      lastTrigger?.focus?.();
      lastTrigger = null;
    }
  }
  $("#btn-toc").addEventListener("click", () => openPanel("#toc"));
  $("#btn-settings").addEventListener("click", () => openPanel("#settings"));
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", () => closePanels()));
  scrim.addEventListener("click", () => closePanels());

  /* ---------- Full screen ---------- */
  function setImmersive(on) {
    document.body.classList.toggle("immersive", on);
    if (on) root.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement)
      document.exitFullscreen().catch(() => {});
  }
  $("#btn-fs").addEventListener("click", () => setImmersive(true));
  $("#exit-fs").addEventListener("click", () => setImmersive(false));
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement)
      document.body.classList.remove("immersive");
  });

  /* ---------- Progress ---------- */
  const scrollFraction = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, scrollY / max)) : 1;
  };

  /* The top progress bar follows the scroll position live */
  function paintProgress() {
    if (loading || !book || !chapters.length) return;
    const scroll = scrollFraction();
    $("#bar").style.width = `${((current + scroll) / chapters.length) * 100}%`;
  }

  function saveProgress() {
    if (loading || !book || !chapters.length) return;
    Progress.set(book.id, {
      chapter: current,
      scroll: scrollFraction(),
      total: chapters.length,
    });
    paintProgress();
  }

  let paintTick = false;
  window.addEventListener(
    "scroll",
    () => {
      if (paintTick) return;
      paintTick = true;
      requestAnimationFrame(() => {
        paintTick = false;
        paintProgress();
      });
    },
    { passive: true },
  );

  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveProgress, 250);
    },
    { passive: true },
  );
  window.addEventListener("pagehide", saveProgress);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveProgress();
  });

  /* ---------- Chapters ---------- */
  const chapterTitle = (ch, i) => ch.title || `Chapter ${i + 1}`;

  async function showChapter(index, scroll = 0) {
    const target = Math.min(Math.max(index, 0), chapters.length - 1);
    const myLoad = ++loadId;
    loading = true;
    clearTimeout(saveTimer);
    const ch = chapters[target];
    textEl.innerHTML = '<p class="r-state">Loading chapter…</p>';
    try {
      if (ch.text === undefined) ch.text = await zip.text(ch.file);
    } catch (err) {
      if (myLoad !== loadId) return; // a newer load took over
      loading = false;
      textEl.innerHTML = `<p class="r-state">Couldn’t load this chapter. ${escapeHTML(err.message)}<br><br><button class="btn" type="button" data-retry="${target}">Try again</button></p>`;
      return;
    }
    if (myLoad !== loadId) return; // FIX: stale load, ignore
    current = target;
    const paragraphs = ch.text
      .trim()
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHTML(p.trim())}</p>`)
      .join("");
    const title = chapterTitle(ch, current);
    const eyebrow = ch.title
      ? `<p class="r-eyebrow">Chapter ${current + 1}</p>`
      : "";
    textEl.innerHTML = `${eyebrow}<h1>${escapeHTML(title)}</h1>${paragraphs}`;
    $("#chapter-title").textContent = title;
    $("#pos").textContent = `Chapter ${current + 1} of ${chapters.length}`;
    $("#prev").disabled = current === 0;
    finishedNow = false;
    $("#next").textContent =
      current === chapters.length - 1 ? "Finish" : "Next";
    document
      .querySelectorAll("#toc-list button")
      .forEach((b, i) =>
        i === current
          ? b.setAttribute("aria-current", "true")
          : b.removeAttribute("aria-current"),
      );

    requestAnimationFrame(() => {
      if (myLoad !== loadId) return;
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo(0, scroll * Math.max(0, max));
      loading = false;
      saveProgress();
    });

    // Warm up the next chapter so "Next" feels instant
    const upcoming = chapters[current + 1];
    if (upcoming && upcoming.text === undefined)
      zip
        .text(upcoming.file)
        .then((t) => (upcoming.text ??= t))
        .catch(() => {});
  }

  function go(delta) {
    const target = current + delta;
    if (loading || target < 0 || target >= chapters.length) return;
    showChapter(target);
    textEl.focus({ preventScroll: true }); // keep keyboard navigation going
  }

  $("#prev").addEventListener("click", () => go(-1));
  $("#next").addEventListener("click", () => {
    if (loading) return;
    if (current < chapters.length - 1) return go(1);
    if (finishedNow) return $("#back").click(); // second press: back to the library
    /* FIX: finishing works for every book, not only favorited ones */
    Favs.setFinished(book.id, true);
    finishedNow = true;
    $("#next").textContent = "Library";
    toast("Finished — marked as read");
  });
  textEl.addEventListener("click", (e) => {
    const retry = e.target.closest("[data-retry]");
    if (retry) showChapter(Number(retry.dataset.retry));
  });
  $("#toc-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    closePanels(false);
    showChapter(Number(btn.dataset.index));
    textEl.focus({ preventScroll: true }); // focus would otherwise be lost
  });

  /* ---------- Keyboard navigation ---------- */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (panelOpen()) closePanels();
      else if (document.body.classList.contains("immersive"))
        setImmersive(false);
      return;
    }
    if (e.key === "Tab" && panelOpen()) {
      // keep keyboard focus inside the open panel
      const items = [
        ...document
          .querySelector(".panel.open")
          .querySelectorAll("button, input, [href]"),
      ].filter((el) => !el.disabled);
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
      return;
    }
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (panelOpen() || !chapters.length) return;
    if (e.target.closest?.("input, select, textarea, [contenteditable]"))
      return;
    if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
  });

  /* ---------- Swipe navigation ---------- */
  let touch = null;
  textEl.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 1) return (touch = null);
      const t = e.touches[0];
      touch = { x: t.clientX, y: t.clientY, time: Date.now() };
    },
    { passive: true },
  );
  textEl.addEventListener(
    "touchend",
    (e) => {
      if (!touch || panelOpen()) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      const dy = t.clientY - touch.y;
      const fast = Date.now() - touch.time < 600;
      touch = null;
      if (!fast || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.8)
        return;
      if (String(getSelection())) return;
      go(dx < 0 ? 1 : -1);
    },
    { passive: true },
  );
  textEl.addEventListener("touchcancel", () => (touch = null), {
    passive: true,
  });

  /* ---------- Touch devices: tap the page to hide or show the bars ---------- */
  const touchUI = matchMedia("(max-width: 560px), (pointer: coarse)");
  document.addEventListener("click", (e) => {
    if (!touchUI.matches || panelOpen()) return;
    if (String(getSelection())) return; // finishing a text selection, not a tap
    if (
      e.target.closest(
        ".r-bar, .r-foot, .panel, .scrim, #exit-fs, a, button, input, select, label",
      )
    )
      return;
    document.body.classList.toggle("bar-hidden");
  });

  /* ---------- Reading time → daily streak ----------
     Counts a second only while the page is visible and you've scrolled,
     tapped or pressed a key in the last minute, so a book left open
     overnight doesn't earn a streak. */
  const IDLE_MS = 60000;
  let lastActive = Date.now();
  let pendingSeconds = 0;
  const bump = () => (lastActive = Date.now());
  ["scroll", "wheel", "pointerdown", "touchstart", "keydown"].forEach((ev) =>
    addEventListener(ev, bump, { passive: true }),
  );

  function flushReadingTime() {
    if (!pendingSeconds) return;
    const seconds = pendingSeconds;
    pendingSeconds = 0;
    if (Streak.add(seconds)) {
      const n = Streak.current();
      toast(`Daily goal reached — ${n}-day streak`);
    }
  }
  setInterval(() => {
    if (document.visibilityState !== "visible" || loading || !book) return;
    if (Date.now() - lastActive > IDLE_MS) return;
    if (++pendingSeconds >= 15) flushReadingTime();
  }, 1000);
  window.addEventListener("pagehide", flushReadingTime);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushReadingTime();
  });

  /* ---------- Init ---------- */
  function fail(message) {
    $("#book-title").textContent = "Something went wrong";
    textEl.innerHTML = `<p class="r-state">${escapeHTML(message)}<br><br><a class="btn" href="index.html">Back to library</a></p>`;
  }

  async function init() {
    applySettings(false);
    try {
      const books = await loadBooks();
      book = books.find((b) => b.id === bookId);
      if (!book) return fail("That book isn’t in the library.");
      document.title = `${book.title} — 3NDING`;
      $("#book-title").textContent = book.title;

      const res = await fetch(book.zip);
      if (!res.ok)
        throw new Error(`Could not download the book (${res.status}).`);
      zip = await unzip(await res.arrayBuffer());
      const manifest = JSON.parse(await zip.text("manifest.json"));
      chapters = manifest.chapters;
      if (!chapters?.length) throw new Error("This book has no chapters.");

      $("#toc-list").innerHTML = chapters
        .map(
          (c, i) =>
            `<li><button type="button" data-index="${i}"><em>${i + 1}</em>${escapeHTML(chapterTitle(c, i))}</button></li>`,
        )
        .join("");

      const saved = restart ? null : Progress.get(book.id);
      if (restart) {
        Favs.setFinished(book.id, false);
        Progress.set(book.id, {
          chapter: 0,
          scroll: 0,
          total: chapters.length,
        });
        history.replaceState(null, "", `reader.html?id=${book.id}`);
      }
      await showChapter(
        saved?.total ? Math.min(saved.chapter, chapters.length - 1) : 0,
        saved?.total ? saved.scroll : 0,
      );
      // Ask the browser not to evict downloaded books and progress when space is tight
      navigator.storage?.persist?.().catch?.(() => {});
    } catch (err) {
      fail(err.message || "The book could not be opened.");
    }
  }

  init();
})();
