"use strict";

(() => {
  const SORTS = {
    newest: (a, b) => new Date(b.added) - new Date(a.added) || b.id - a.id,
    oldest: (a, b) => new Date(a.added) - new Date(b.added) || a.id - b.id,
    "title-asc": (a, b) => a.title.localeCompare(b.title),
    "title-desc": (a, b) => b.title.localeCompare(a.title),
    "author-asc": (a, b) => a.author.localeCompare(b.author),
    "author-desc": (a, b) => b.author.localeCompare(a.author),
  };

  const grid = $("#grid");
  const status = $("#status");
  const state = {
    books: [],
    query: "",
    sort: Store.get("home.sort", "newest"),
  };

  const cardHTML = (b) => {
    const pct = Progress.percent(b.id);
    const fav = Favs.has(b.id);
    return `
      <li class="card" data-id="${b.id}">
        <a class="cover" href="reader.html?id=${b.id}" tabindex="-1" aria-hidden="true">
          ${coverImg(b)}
          ${pct ? `<div class="progress" style="--p:${pct}%"><i></i></div>` : ""}
        </a>
        <div>
          <h3>${escapeHTML(b.title)}</h3>
          <p class="meta">${escapeHTML(b.author)}</p>
        </div>
        <div class="actions">
          <a class="btn btn-primary" href="reader.html?id=${b.id}">${icon("book", 16)}${pct ? "Continue" : "Open"}</a>
          <button class="icon-btn ${fav ? "on" : ""}" data-action="fav" aria-pressed="${fav}"
            aria-label="${fav ? "Remove from favorites" : "Add to favorites"}: ${escapeHTML(b.title)}">${icon("heart")}</button>
          <button class="icon-btn" data-action="share" aria-label="Share ${escapeHTML(b.title)}">${icon("share")}</button>
        </div>
      </li>`;
  };

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
    grid.innerHTML = list.map(cardHTML).join("");
    status.textContent = list.length
      ? ""
      : `No books match “${state.query}”. Try a different title or author.`;
    status.hidden = !!list.length;
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

  $("#search-icon").innerHTML = icon("search");
  $("#sort").value = state.sort;
  $("#search").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderGrid();
  });
  $("#sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    Store.set("home.sort", state.sort);
    renderGrid();
  });
  // Refresh progress when returning via the back button (bfcache)
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && state.books.length) {
      renderRecent();
      renderGrid();
    }
  });

  loadBooks()
    .then((books) => {
      state.books = books;
      renderRecent();
      renderGrid();
    })
    .catch((err) => {
      status.hidden = false;
      status.textContent = `${err.message}. Serve this folder over HTTP and reload.`;
    });
})();
