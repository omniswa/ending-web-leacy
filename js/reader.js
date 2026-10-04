"use strict";

(() => {
  const DEFAULTS = { font: "serif", theme: "paper", size: 19, align: "left" };
  const THEME_COLORS = {
    paper: "#fbfbf8",
    sepia: "#f0e4cb",
    dark: "#1c2027",
    oled: "#000000",
  };

  const root = document.documentElement;
  const textEl = $("#text");
  const bookId = Number(new URLSearchParams(location.search).get("id"));
  const restart = new URLSearchParams(location.search).get("restart") === "1";

  let settings = { ...DEFAULTS, ...Store.get("settings", {}) };
  let book = null;
  let zip = null;
  let chapters = [];
  let current = 0;
  let saveTimer = 0;

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

  /* ---------- Settings ---------- */
  function applySettings(save = true) {
    root.dataset.theme = settings.theme;
    root.dataset.font = settings.font;
    root.dataset.align = settings.align;
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
  function openPanel(id) {
    closePanels();
    $(id).classList.add("open");
    scrim.classList.add("show");
    $(id).querySelector("button, [href]")?.focus();
  }
  function closePanels() {
    document
      .querySelectorAll(".panel.open")
      .forEach((p) => p.classList.remove("open"));
    scrim.classList.remove("show");
  }
  $("#btn-toc").addEventListener("click", () => openPanel("#toc"));
  $("#btn-settings").addEventListener("click", () => openPanel("#settings"));
  document
    .querySelectorAll("[data-close]")
    .forEach((b) => b.addEventListener("click", closePanels));
  scrim.addEventListener("click", closePanels);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanels();
  });

  /* ---------- Full screen (Fullscreen API where available, immersive mode everywhere) ---------- */
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

  function saveProgress() {
    if (!book || !chapters.length) return;
    const scroll = scrollFraction();
    Progress.set(book.id, { chapter: current, scroll, total: chapters.length });
    $("#bar").style.width = `${((current + scroll) / chapters.length) * 100}%`;
  }

  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveProgress, 250);
    },
    { passive: true },
  );
  window.addEventListener("pagehide", saveProgress);

  /* ---------- Chapters ---------- */
  async function showChapter(index, scroll = 0) {
    current = Math.min(Math.max(index, 0), chapters.length - 1);
    const ch = chapters[current];
    textEl.innerHTML = '<p class="r-state">Loading chapter…</p>';
    try {
      if (ch.text === undefined) ch.text = await zip.text(ch.file);
    } catch (err) {
      textEl.innerHTML = `<p class="r-state">Couldn’t load this chapter. ${escapeHTML(err.message)}</p>`;
      return;
    }
    const paragraphs = ch.text
      .trim()
      .split(/\n\s*\n/)
      .map((p) => `<p>${escapeHTML(p.trim())}</p>`)
      .join("");
    textEl.innerHTML = `<h1>${escapeHTML(ch.title)}</h1>${paragraphs}`;
    $("#chapter-title").textContent = ch.title;
    $("#pos").textContent = `Chapter ${current + 1} of ${chapters.length}`;
    $("#prev").disabled = current === 0;
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
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo(0, scroll * Math.max(0, max));
      saveProgress();
    });
  }

  $("#prev").addEventListener("click", () => showChapter(current - 1));
  $("#next").addEventListener("click", () => {
    if (current < chapters.length - 1) return showChapter(current + 1);
    if (Favs.has(book.id)) {
      Favs.setFinished(book.id, true);
      toast("Marked as finished");
    } else toast("You’ve reached the end");
  });
  $("#toc-list").addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    closePanels();
    showChapter(Number(btn.dataset.index));
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
      document.title = `${book.title} — Archive`;
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
            `<li><button type="button" data-index="${i}"><em>${i + 1}</em>${escapeHTML(c.title)}</button></li>`,
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
      }
      await showChapter(
        saved ? Math.min(saved.chapter, chapters.length - 1) : 0,
        saved?.scroll ?? 0,
      );
    } catch (err) {
      fail(err.message || "The book could not be opened.");
    }
  }

  init();
})();
