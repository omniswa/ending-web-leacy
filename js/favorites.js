"use strict";

(() => {
  const list = $("#list");
  const empty = $("#empty");
  const state = { books: [], filter: "all" };

  const favBooks = () => {
    const favs = Favs.all();
    return state.books
      .filter((b) => favs[b.id])
      .sort((a, b) => favs[b.id].addedAt - favs[a.id].addedAt);
  };

  const cardHTML = (b) => {
    const done = Favs.isFinished(b.id);
    const pct = Progress.percent(b.id);
    const started = !!Progress.get(b.id);
    const href = `reader.html?id=${b.id}${done ? "&restart=1" : ""}`;
    const label = done
      ? "Read again"
      : started
        ? "Continue reading"
        : "Start reading";
    return `
      <li class="fav-card${Offline.has(b.zip) ? " saved" : ""}" data-id="${b.id}">
        <a class="cover" href="${href}" tabindex="-1" aria-hidden="true">${coverImg(b)}</a>
        <div>
          <h3>${escapeHTML(b.title)}</h3>
          <p class="meta">${escapeHTML(b.author)}</p>
          <div class="progress ${done ? "done" : ""}" style="--p:${pct}%" role="progressbar"
            aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Reading progress"><i></i></div>
          <div class="status">
            <span>${done ? '<span class="badge">Finished</span>' : started ? "In progress" : "Not started"}</span>
            <span>${pct}%</span>
          </div>
          <div class="row">
            <a class="btn btn-primary" href="${href}">${icon("book", 16)}${label}</a>
            <button class="btn" data-action="finish">${icon(done ? "undo" : "check", 16)}${done ? "Mark unfinished" : "Mark finished"}</button>
            <button class="icon-btn" data-action="remove" aria-label="Remove ${escapeHTML(b.title)} from favorites">${icon("x")}</button>
          </div>
        </div>
        ${Offline.btn(b, "icon-btn")}
      </li>`;
  };

  function render() {
    const all = favBooks();
    const shown = all.filter((b) => {
      const done = Favs.isFinished(b.id);
      return (
        state.filter === "all" || (state.filter === "finished" ? done : !done)
      );
    });
    const finished = all.filter((b) => Favs.isFinished(b.id)).length;

    $("#summary").textContent = all.length
      ? `${all.length} saved · ${finished} finished`
      : "Books you favorite will be saved here, with your progress.";
    list.innerHTML = shown.map(cardHTML).join("");
    empty.hidden = !!shown.length;

    if (!shown.length) {
      const none = !all.length;
      empty.innerHTML = `
        <h2>${none ? "No favorites yet" : `Nothing ${state.filter === "finished" ? "finished" : "unfinished"}`}</h2>
        <p>${none ? "Tap the heart on any book to save it here." : "Try a different filter."}</p>
        ${none ? '<a class="btn btn-primary" href="index.html">Browse the library</a>' : ""}`;
    }
  }

  list.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const id = Number(btn.closest(".fav-card").dataset.id);
    const action = btn.dataset.action;
    if (action === "remove") {
      Favs.toggle(id);
      toast("Removed from favorites");
    } else {
      const done = !Favs.isFinished(id);
      Favs.setFinished(id, done);
      toast(done ? "Marked as finished" : "Marked as unfinished");
    }
    render();
    // Re-rendering drops focus; put it back where the user was
    const again = list.querySelector(
      `[data-id="${id}"] [data-action="${action}"]`,
    );
    (again || document.querySelector('.tabs [aria-pressed="true"]'))?.focus();
  });

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-filter]");
    if (!btn) return;
    state.filter = btn.dataset.filter;
    document
      .querySelectorAll(".tabs button")
      .forEach((b) => b.setAttribute("aria-pressed", b === btn));
    render();
  });

  const refresh = () => state.books.length && render();
  window.addEventListener("pageshow", (e) => e.persisted && refresh());
  window.addEventListener("storage", refresh);

  loadBooks()
    .then((books) => {
      state.books = books;
      render();
    })
    .catch((err) => {
      empty.hidden = false;
      empty.innerHTML = `<h2>Couldn’t load your books</h2><p>${escapeHTML(err.message)}. Serve this folder over HTTP and reload.</p>`;
    });
})();
