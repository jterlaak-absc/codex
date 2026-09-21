const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const scanEl = document.getElementById("scan");

const COLORS = { calm: "#1f7a68", amber: "#b87400", scarlet: "#c8102e" };

// A ticket's drain bar is measured against this window, so a 4-hour SLA and a
// 30-minute SLA both read the same at a glance.
const DRAIN_WINDOW_MS = 60 * 60 * 1000;

function stateColor(remaining) {
  if (remaining <= 0) return COLORS.scarlet;
  if (remaining <= 15 * 60000) return COLORS.scarlet;
  if (remaining <= 30 * 60000) return COLORS.amber;
  return COLORS.calm;
}

function countdown(remaining) {
  const overdue = remaining < 0;
  const total = Math.floor(Math.abs(remaining) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const body = h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
  return overdue ? `-${body}` : body;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

let tickets = [];
let lastBoardScan = 0;
let workSettings = RRAWorkHours.normalize({});

async function load() {
  const { knownTickets = {}, lastScan = 0, settings = {} } = await chrome.storage.local.get([
    "knownTickets",
    "lastScan",
    "settings"
  ]);
  workSettings = RRAWorkHours.normalize(settings);
  lastBoardScan = lastScan;
  tickets = Object.values(knownTickets).sort((a, b) => a.deadlineMs - b.deadlineMs);

  scanEl.textContent = lastScan
    ? `Wallboard read at ${clock(lastScan)}`
    : "Open the wallboard tab to start";

  render();
}

function render() {
  const now = Date.now();

  if (!lastBoardScan || now - lastBoardScan > 60000) {
    statusEl.textContent = "Niet actueel";
    listEl.innerHTML = '<div class="empty"><strong>Geen actuele wallboardgegevens</strong>Open of vernieuw het wallboard om de huidige requests te zien.</div>';
    return;
  }

  if (!tickets.length) {
    statusEl.textContent = "0";
    listEl.innerHTML =
      '<div class="empty"><strong>Queue is clear</strong>Nothing is waiting on a first response.</div>';
    return;
  }

  const urgent = tickets.filter((t) => RRAWorkHours.remaining(t.deadlineMs, now, workSettings) <= 30 * 60000).length;
  statusEl.textContent = `${tickets.length} open / ${urgent} urgent`;

  listEl.innerHTML = "";

  for (const t of tickets) {
    const remaining = RRAWorkHours.remaining(t.deadlineMs, now, workSettings);
    const color = stateColor(remaining);
    const pct = Math.max(0, Math.min(100, (remaining / DRAIN_WINDOW_MS) * 100));

    const card = document.createElement("div");
    card.className = "ticket";
    card.tabIndex = 0;
    card.style.setProperty("--state", color);
    card.dataset.id = t.id;

    card.innerHTML = `
      <div class="top">
        <span class="id"></span>
        <span class="countdown" data-deadline="${t.deadlineMs}">${countdown(remaining)}</span>
      </div>
      <div class="customer"></div>
      <div class="meta">Due ${clock(t.deadlineMs)}${t.guid ? "" : " - no direct link on the board"}</div>
      <div class="drain"><span style="width:${pct}%"></span></div>
    `;

    card.querySelector(".id").textContent = t.id;
    card.querySelector(".customer").textContent = t.customer || "Unknown customer";

    const open = () => chrome.runtime.sendMessage({ type: "OPEN_TICKET", ticketId: t.id });
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    listEl.appendChild(card);
  }
}

function tick() {
  const now = Date.now();
  if (!lastBoardScan || now - lastBoardScan > 60000) {
    render();
    return;
  }
  for (const el of document.querySelectorAll(".countdown")) {
    const remaining = RRAWorkHours.remaining(Number(el.dataset.deadline), now, workSettings);
    el.textContent = countdown(remaining);
    const card = el.closest(".ticket");
    const color = stateColor(remaining);
    card.style.setProperty("--state", color);
    const bar = card.querySelector(".drain span");
    bar.style.width = `${Math.max(0, Math.min(100, (remaining / DRAIN_WINDOW_MS) * 100))}%`;
  }
}

document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

chrome.storage.onChanged.addListener((changes) => {
  if (changes.knownTickets || changes.lastScan || changes.settings) load();
});

load();
setInterval(tick, 1000);
