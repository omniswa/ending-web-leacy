"use strict";

(() => {
  /* Books per page. 12 divides evenly into 2, 3, 4 and 6 columns. */
  const PAGE_SIZE = 12;

  const surname = (a) => a.trim().split(/\s+/).pop();
  const byAuthor = (a, b) =>
    surname(a.author).localeCompare(surname(b.author)) ||
    a.title.localeCompare(b.title);

  const SORTS = {
    newest: (a, b) => new Date(b.added) - new Date(a.added) || b.id - a.id,
    oldest: (a, b) => new Date(a.added) - new Date(b.added) || a.id - b.id,
    "title-asc": (a, b) => a.title.localeCompare(b.title),
    "title-desc": (a, b) => b.title.localeCompare(a.title),
    "author-asc": byAuthor,
    "author-desc": (a, b) => byAuthor(b, a),
  };

  const grid = $("#grid");
  const status = $("#status");
  const pager = $("#pager");
  const state = {
    books: [],
    query: "",
    sort: Store.get("home.sort", "newest"),
    // Page lives in the URL so Back from the reader returns to the same page
    page: Math.max(
      1,
      parseInt(new URLSearchParams(location.search).get("page")) || 1,
    ),
  };
  if (!SORTS[state.sort]) state.sort = "newest";

  const cardHTML = (b) => {
    const pct = Progress.percent(b.id);
    const fav = Favs.has(b.id);
    const done = Favs.isFinished(b.id);
    const href = `reader.html?id=${b.id}${done ? "&restart=1" : ""}`;
    const label = done ? "Read again" : pct ? "Continue" : "Open";
    return `
      <li class="card${Offline.has(b.zip) ? " saved" : ""}" data-id="${b.id}">
        <div class="cover-wrap">
          <a class="cover" href="${href}" tabindex="-1" aria-hidden="true">
            ${coverImg(b)}
            ${pct ? `<div class="progress" style="--p:${pct}%"><i></i></div>` : ""}
          </a>
          <button class="chip chip-fav ${fav ? "on" : ""}" type="button" data-action="fav" aria-pressed="${fav}"
            aria-label="${fav ? "Remove from favorites" : "Add to favorites"}: ${escapeHTML(b.title)}">${icon("heart")}</button>
          ${Offline.btn(b, "chip chip-off")}
        </div>
        <div>
          <h3 title="${escapeHTML(b.title)}">${escapeHTML(b.title)}</h3>
          <p class="meta">${escapeHTML(b.author)}</p>
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="${href}">${icon("book", 16)}${label}</a>
          <button class="icon-btn" type="button" data-action="share" aria-label="Share ${escapeHTML(b.title)}">${icon("share")}</button>
        </div>
      </li>`;
  };

  /* 1 … 4 5 6 … 12 — always first, last, and the neighbours of the current page */
  function pageItems(cur, total) {
    const keep = new Set([1, total, cur - 1, cur, cur + 1]);
    if (cur <= 3) [2, 3, 4].forEach((n) => keep.add(n));
    if (cur >= total - 2)
      [total - 1, total - 2, total - 3].forEach((n) => keep.add(n));
    const nums = [...keep]
      .filter((n) => n >= 1 && n <= total)
      .sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i && n - nums[i - 1] > 1) out.push("gap");
      out.push(n);
    });
    return out;
  }

  function renderPager(total, count, from, to) {
    pager.hidden = total <= 1;
    if (total <= 1) return (pager.innerHTML = "");
    const cur = state.page;
    pager.innerHTML = `
      <button type="button" class="pg pg-nav" data-page="${cur - 1}" ${cur === 1 ? "disabled" : ""}>${icon("left", 16)}<span>Previous</span></button>
      ${pageItems(cur, total)
        .map((it) =>
          it === "gap"
            ? '<span class="gap" aria-hidden="true">…</span>'
            : `<button type="button" class="pg pg-num" data-page="${it}" ${it === cur ? 'aria-current="page"' : ""} aria-label="Page ${it}">${it}</button>`,
        )
        .join("")}
      <span class="pg-info">Page ${cur} of ${total}</span>
      <button type="button" class="pg pg-nav" data-page="${cur + 1}" ${cur === total ? "disabled" : ""}><span>Next</span>${icon("right", 16)}</button>
      <p class="pager-count">Showing ${from}–${to} of ${count} books</p>`;
  }

  function syncURL() {
    const url = new URL(location.href);
    if (state.page > 1) url.searchParams.set("page", state.page);
    else url.searchParams.delete("page");
    history.replaceState(null, "", url);
  }

  function renderGrid() {
    const q = state.query.trim().toLowerCase();
    const list = state.books
      .filter(
        (b) =>
          !q ||
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q),
      )
      .sort(SORTS[state.sort]);

    const total = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), total);
    const start = (state.page - 1) * PAGE_SIZE;
    const visible = list.slice(start, start + PAGE_SIZE);

    grid.innerHTML = visible.map(cardHTML).join("");
    status.textContent = list.length
      ? ""
      : `No books match “${state.query}”. Try a different title or author.`;
    status.hidden = !!list.length;
    renderPager(total, list.length, start + 1, start + visible.length);
    syncURL();
  }

  function renderRecent() {
    const recent = Progress.recent(state.books);
    $("#recent-section").hidden = !recent.length;
    $("#recent").innerHTML = recent
      .map((b) => {
        const pct = Progress.percent(b.id);
        const ch = Progress.get(b.id).chapter + 1;
        return `
        <li class="rail-item">
          <a class="cover" href="reader.html?id=${b.id}" tabindex="-1" aria-hidden="true">${coverImg(b)}</a>
          <div>
            <h3>${escapeHTML(b.title)}</h3>
            <p>${escapeHTML(b.author)}</p>
            <div class="progress" style="--p:${pct}%"><i></i></div>
            <small>${pct}% read · Chapter ${ch}</small>
            <a class="btn btn-primary" href="reader.html?id=${b.id}">Continue reading</a>
          </div>
        </li>`;
      })
      .join("");
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const book = state.books.find(
      (b) => b.id === Number(btn.closest(".card").dataset.id),
    );
    if (btn.dataset.action === "share") return shareBook(book);
    const on = Favs.toggle(book.id);
    btn.classList.toggle("on", on);
    btn.setAttribute("aria-pressed", on);
    btn.setAttribute(
      "aria-label",
      `${on ? "Remove from favorites" : "Add to favorites"}: ${book.title}`,
    );
    toast(on ? "Added to favorites" : "Removed from favorites");
  });

  pager.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-page]");
    if (!btn || btn.disabled) return;
    state.page = Number(btn.dataset.page);
    renderGrid();
    const heading = $("#all-title");
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    heading.scrollIntoView({
      behavior: calm ? "auto" : "smooth",
      block: "start",
    });
    heading.focus({ preventScroll: true });
  });

  $("#search-icon").innerHTML = icon("search");
  $("#sort").value = state.sort;
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    state.page = 1;
    renderGrid();
  });
  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    state.page = 1;
    Store.set("home.sort", state.sort);
    renderGrid();
  });

  const refresh = () => {
    if (!state.books.length) return;
    renderRecent();
    renderGrid();
  };
  // Refresh progress when returning via the back button (bfcache) or from another tab
  window.addEventListener("pageshow", (e) => e.persisted && refresh());
  window.addEventListener("storage", refresh);

  loadBooks()
    .then((books) => {
      state.books = books;
      refresh();
    })
    .catch((err) => {
      status.hidden = false;
      status.textContent = `${err.message}. Serve this folder over HTTP and reload.`;
    });
})();
