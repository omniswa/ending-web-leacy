"use strict";

/* Reading week card on the home page: streak, today's goal,
   minutes per day for the last 7 days, and a short summary. */
(() => {
  const host = $("#streak-section");
  if (!host) return;

  const minutes = (sec) => Math.floor(sec / 60);
  const duration = (sec) => {
    const m = Math.round(sec / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} m`;
  };
  function versusLastWeek(total, prev) {
    if (!prev) return total ? "First week" : "Start today";
    const pct = Math.round(((total - prev) / prev) * 100);
    return pct === 0 ? "Same as last week" : `${pct > 0 ? "+" : ""}${pct}% vs last week`;
  }

  function render() {
    const keepGoalFocus = document.activeElement?.id === "goal";
    const streak = Streak.current();
    const best = Streak.longest();
    const s = Streak.summary();
    const today = Streak.seconds();
    const pct = Math.min(100, Math.round((today / s.goalSec) * 100));
    const doneToday = today >= s.goalSec;
    const left = Math.max(1, Math.ceil((s.goalSec - today) / 60));

    let message;
    if (doneToday) message = "Goal reached. Come back tomorrow to keep it going.";
    else if (streak) message = `${left} min left today to keep your streak.`;
    else message = `Read ${s.goal} minutes today to start a streak.`;

    const scale = s.maxSec || 1;
    const bars = s.days
      .map(
        (d) => `
        <div class="wk-day ${d.met ? "met" : ""} ${d.seconds ? "" : "zero"}"
          title="${escapeHTML(d.name)}: ${minutes(d.seconds)} min">
          <i class="wk-bar" style="--h:${((d.seconds / scale) * 100).toFixed(1)}%"></i>
        </div>`,
      )
      .join("");
    const labels = s.days
      .map(
        (d) =>
          `<li class="${d.today ? "today" : ""}">${escapeHTML(d.label)}</li>`,
      )
      .join("");
    const chartLabel = `Minutes read each day, last 7 days: ${s.days
      .map((d) => `${d.name} ${minutes(d.seconds)}`)
      .join(", ")}. Daily goal ${s.goal} minutes.`;

    const canInstall = !!Install.event;
    const iosHint = Install.ios && !Install.standalone && !canInstall;

    host.innerHTML = `
      <h2 class="section-title" id="streak-title">Your reading week</h2>
      <div class="streak-card">
        <div class="sc-main">
          <div class="streak-head">
            <div class="streak-flame ${streak ? "on" : ""}">${icon("flame", 28)}</div>
            <div>
              <p class="streak-num"><strong>${streak}</strong> day${streak === 1 ? "" : "s"}</p>
              <p class="streak-msg">${escapeHTML(message)}</p>
            </div>
          </div>
          <div class="progress ${doneToday ? "done" : ""}" style="--p:${pct}%" role="progressbar"
            aria-valuemin="0" aria-valuemax="${s.goal}" aria-valuenow="${Math.min(minutes(today), s.goal)}"
            aria-label="Minutes read today"><i></i></div>
          <p class="streak-sub">${minutes(today)} of ${s.goal} min today</p>
        </div>

        <div class="sc-week">
          <figure class="wk" role="img" aria-label="${escapeHTML(chartLabel)}">
            <div class="wk-head" aria-hidden="true">
              <strong>Last 7 days</strong>
              <span class="wk-key">${s.goal} min goal</span>
            </div>
            <div class="wk-plot" aria-hidden="true">
              <span class="wk-goal" style="--g:${((s.goalSec / scale) * 100).toFixed(1)}%"></span>
              ${bars}
            </div>
            <ol class="wk-labels" aria-hidden="true">${labels}</ol>
          </figure>
          <dl class="stats">
            <div class="stat"><dt>This week</dt><dd>${duration(s.total)}</dd><small>${escapeHTML(versusLastWeek(s.total, s.prev))}</small></div>
            <div class="stat"><dt>Goal days</dt><dd>${s.goalDays} of 7</dd><small>Best streak ${best}</small></div>
            <div class="stat"><dt>Finished</dt><dd>${s.finished}</dd><small>${s.finished === 1 ? "book" : "books"} this week</small></div>
          </dl>
        </div>

        <div class="sc-foot">
          <p>${Streak.totalMinutes()} min read in total</p>
          <label class="goal-pick">Daily goal
            <select id="goal">
              ${Streak.GOALS.map((g) => `<option value="${g}" ${g === s.goal ? "selected" : ""}>${g} min</option>`).join("")}
            </select>
          </label>
        </div>
        ${
          canInstall
            ? `<button class="btn btn-primary install" id="install" type="button">${icon("download", 16)}Install app for offline reading</button>`
            : iosHint
              ? `<p class="install-hint">Install: tap Share, then “Add to Home Screen”, to read offline.</p>`
              : ""
        }
      </div>`;

    if (keepGoalFocus) $("#goal")?.focus();
  }

  host.addEventListener("change", (e) => {
    if (e.target.id !== "goal") return;
    Streak.setGoal(Number(e.target.value));
    render();
  });
  host.addEventListener("click", (e) => {
    if (e.target.closest("#install")) Install.run();
  });

  render();
  window.addEventListener("storage", render);
  window.addEventListener("pageshow", (e) => e.persisted && render());
  document.addEventListener("installchange", render);
  // The day rolls over while the page is open
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") render();
  });
})();
