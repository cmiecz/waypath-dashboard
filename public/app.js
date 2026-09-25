const STAGE_ORDER = [
  ["reported", "Reported"],
  ["being_built", "Being built"],
  ["ready_to_test", "Ready to test"],
  ["needs_fix", "Needs fix"],
  ["qa_passed", "QA passed"],
  ["ready_to_merge", "Ready to merge"],
];

const TZ = "America/New_York";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEtClock(iso) {
  const d = new Date(iso);
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " ET"
  );
}

function formatEtDateTime(iso) {
  const d = new Date(iso);
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d) + " ET"
  );
}

function relativeTime(iso, now = Date.now()) {
  const d = new Date(iso);
  const sec = Math.round((now - d.getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day} day${day === 1 ? "" : "s"} ago`;
  return formatEtDateTime(d);
}

function durationInStage(iso, now = Date.now()) {
  if (!iso) return "—";
  const min = Math.floor(Math.max(0, now - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  const hr = Math.floor(min / 60);
  const rem = min % 60;
  if (hr < 48) return rem ? `${hr}h ${rem}m` : `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function renderCounts(counts) {
  const items = [
    ["Open", counts.open],
    ["Reported", counts.reported],
    ["Building", counts.being_built],
    ["QA", counts.ready_to_test],
    ["Needs fix", counts.needs_fix],
    ["QA passed", counts.qa_passed],
    ["Merge", counts.ready_to_merge],
    ["Needs Cass", counts.needsCass, true],
  ];
  return items
    .map(
      ([label, n, special]) =>
        `<span class="count-chip${special ? " needs-cass" : ""}"><strong>${esc(n)}</strong> ${esc(label)}</span>`,
    )
    .join("");
}

function renderCard(card) {
  const qa =
    card.qaResult === "pass"
      ? `<span class="badge pass">QA PASS</span>`
      : card.qaResult === "fail"
        ? `<span class="badge fail">QA FAIL</span>`
        : "";
  const live = card.workingNow
    ? `<span class="badge live">Working</span>`
    : "";
  const links = [];
  if (card.reviewUrl) {
    links.push(
      `<a href="${esc(card.reviewUrl)}" target="_blank" rel="noopener">Review the fix</a>`,
    );
  }
  if (card.previewUrl) {
    links.push(
      `<a href="${esc(card.previewUrl)}" target="_blank" rel="noopener">Test it here</a>`,
    );
  }
  return `<article class="request${card.workingNow ? " working" : ""}">
    <p class="request-id"><a href="${esc(card.htmlUrl)}" target="_blank" rel="noopener">${esc(card.displayId)}</a></p>
    <div class="meta-row">
      <span>With ${esc(card.owner)}</span>
      <span>·</span>
      <span>${esc(durationInStage(card.stageEnteredAt))} in stage</span>
      ${qa}${live}
    </div>
    ${
      card.latestActivity
        ? `<p class="activity-line">${esc(card.latestActivity)}${
            card.latestActivityAt
              ? ` <span class="muted">(${esc(relativeTime(card.latestActivityAt))})</span>`
              : ""
          }</p>`
        : ""
    }
    ${links.length ? `<div class="links">${links.join("")}</div>` : ""}
  </article>`;
}

function renderBoard(columns) {
  return STAGE_ORDER.map(([id, label]) => {
    const cards = columns[id] || [];
    return `<div class="column" data-stage="${esc(id)}">
      <div class="column-head"><h3>${esc(label)}</h3><span class="n">${cards.length}</span></div>
      ${
        cards.length
          ? cards.map(renderCard).join("")
          : `<p class="empty">None</p>`
      }
    </div>`;
  }).join("");
}

function renderWorking(items) {
  if (!items.length) return `<p class="empty">No bots actively working right now.</p>`;
  return items
    .map(
      (w) => `<div class="working-item">
        <span class="pulse" aria-hidden="true"></span>
        <strong>${esc(w.bot)}</strong>
        <span>is working on <a href="${w.url ? esc(w.url) : "#"}">${esc(w.displayId)}</a></span>
        <span class="muted">started ${esc(formatEtClock(w.startedAt))} (${esc(relativeTime(w.startedAt))})</span>
      </div>`,
    )
    .join("");
}

function renderActivity(items) {
  if (!items.length) return `<li class="empty">No recent activity.</li>`;
  return items
    .map(
      (a) => `<li>
      <span class="when">${esc(formatEtDateTime(a.at))} · ${esc(relativeTime(a.at))}</span>
      <span class="actor">${esc(a.actor)}</span>
      ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.summary)}</a>` : esc(a.summary)}
      ${a.displayId && !a.summary.includes(a.displayId) ? ` <span class="muted">${esc(a.displayId)}</span>` : ""}
    </li>`,
    )
    .join("");
}

function renderShipped(items) {
  if (!items.length) return `<li class="empty">Nothing shipped in the last 14 days.</li>`;
  return items
    .map(
      (s) => `<li>
      <span class="when">Merged ${esc(formatEtDateTime(s.mergedAt || s.closedAt))} · ${esc(relativeTime(s.mergedAt || s.closedAt))}</span>
      <a href="${esc(s.htmlUrl)}" target="_blank" rel="noopener">${esc(s.displayId)}</a>
      ${
        s.reviewUrl
          ? ` · <a href="${esc(s.reviewUrl)}" target="_blank" rel="noopener">Review the fix</a>`
          : ""
      }
    </li>`,
    )
    .join("");
}

function renderCursor(agents, error) {
  const section = document.getElementById("cursor-section");
  const list = document.getElementById("cursor-agents");
  const errEl = document.getElementById("cursor-error");
  if (!agents && !error) {
    section.classList.add("hidden");
    return;
  }
  section.classList.remove("hidden");
  if (error) {
    errEl.textContent = error;
    errEl.classList.remove("hidden");
  } else {
    errEl.classList.add("hidden");
  }
  if (!agents || !agents.length) {
    list.innerHTML = `<li class="empty">No recent Cursor agents for this repo.</li>`;
    return;
  }
  list.innerHTML = agents
    .map(
      (a) => `<li>
      <span class="when">${esc(a.status)}${a.latestRunStatus ? ` · run ${esc(a.latestRunStatus)}` : ""} · ${esc(relativeTime(a.updatedAt))}</span>
      <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.name)}</a>
      ${a.branch ? `<span class="muted"> · ${esc(a.branch)}</span>` : ""}
      ${
        a.prUrl
          ? ` · <a href="${esc(a.prUrl)}" target="_blank" rel="noopener">Review the fix</a>`
          : ""
      }
    </li>`,
    )
    .join("");
}

function render(snap) {
  const banner = document.getElementById("demo-banner");
  if (snap.demoMode) banner.classList.remove("hidden");
  else banner.classList.add("hidden");

  document.getElementById("counts").innerHTML = renderCounts(snap.counts);
  document.getElementById("updated").textContent =
    `Updated ${relativeTime(snap.generatedAt)}`;
  document.getElementById("working-now").innerHTML = renderWorking(
    snap.workingNow || [],
  );
  document.getElementById("board").innerHTML = renderBoard(snap.columns || {});
  document.getElementById("activity").innerHTML = renderActivity(
    snap.activity || [],
  );
  document.getElementById("shipped").innerHTML = renderShipped(
    snap.shipped || [],
  );
  renderCursor(snap.cursorAgents, snap.cursorAgentsError);
}

async function loadDashboard() {
  const res = await fetch("/api/dashboard", { credentials: "same-origin" });
  if (res.status === 401) {
    window.location.href = "/login";
    return null;
  }
  if (!res.ok) throw new Error(`dashboard ${res.status}`);
  return res.json();
}

async function loadMe() {
  try {
    const res = await fetch("/auth/me", { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    const label = document.getElementById("user-label");
    if (data.demoMode) label.textContent = "Demo viewer";
    else if (data.user?.login) label.textContent = `@${data.user.login}`;
  } catch {
    // ignore
  }
}

function connectSSE(onPing) {
  const status = document.getElementById("live-status");
  let source;
  try {
    source = new EventSource("/api/stream");
  } catch {
    status.textContent = "Live updates unavailable — polling";
    return null;
  }
  source.addEventListener("dashboard", () => {
    status.textContent = "Live";
    onPing();
  });
  source.onopen = () => {
    status.textContent = "Live";
  };
  source.onerror = () => {
    status.textContent = "Reconnecting…";
  };
  return source;
}

async function boot() {
  await loadMe();
  const refresh = async () => {
    try {
      const snap = await loadDashboard();
      if (snap) render(snap);
    } catch (err) {
      console.error(err);
      document.getElementById("live-status").textContent = "Refresh failed";
    }
  };
  await refresh();
  connectSSE(() => {
    void refresh();
  });
  // Fallback short polling every 45s
  setInterval(() => {
    void refresh();
  }, 45_000);
}

boot();
