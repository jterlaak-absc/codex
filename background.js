/**
 * Rapid Response Alerter - service worker (v3.0)
 *
 * Design notes:
 *  - No API guessing. The deep link comes from the wallboard row itself
 *    (GUID or href). If a row has neither, we fall back to the portal URL you
 *    configure in Options, with {id} substituted.
 *  - Notifications carry their own state in storage (notificationId -> ticket),
 *    so click handling no longer depends on regexing the notification title.
 *  - Escalating deadline alerts (default 30 / 15 / 5 minutes + breach) instead
 *    of a single 15-minute warning.
 *  - Storage is not wiped on update. On a fresh install the first wallboard
 *    payload is seeded silently so you don't get a burst of "new ticket"
 *    notifications for tickets that were already on the board.
 */

importScripts("work-hours.js");
importScripts("teams.js");

const DEFAULTS = {
  synergyBase: "https://servicenext.absc.nl",
  requestUrlTemplate: "{base}/docs/WflRequest.aspx?Mode=1&ID={guid}&BCAction=1",
  fallbackUrlTemplate: "{base}/docs/PortalSN.aspx",
  warnMinutes: [30, 15, 5],
  alertOnNew: true,
  alertOnBreach: true,
  soundEnabled: true,
  soundVolume: 0.7,
  stickyDeadline: true,
  stickyNew: false,
  snoozeMinutes: 5,
  workStart: "08:30",
  workEnd: "17:00"
};

const ALARM = "rra-tick";
const STALE_AFTER_MS = 60000; // Never alert from an outdated wallboard observation.

const teamsDispatcher = RRATeams.createDispatcher({
  storage: chrome.storage.local,
  permissions: chrome.permissions,
  getAlertSettings: getSettings,
  buildUrl,
  remaining: (deadline, now, settings) => RRAWorkHours.remaining(deadline, now, settings)
});
function teamsError() { console.warn("[RRA Teams] Bewerking mislukt; controleer de Teams-instellingen."); }

// ---------------------------------------------------------------- utilities

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const merged = { ...DEFAULTS, ...settings };
  merged.warnMinutes = [...new Set(merged.warnMinutes)].sort((a, b) => b - a);
  return RRAWorkHours.normalize(merged);
}

function buildUrl(ticket, settings) {
  if (ticket.href) return ticket.href;
  if (ticket.guid) {
    return settings.requestUrlTemplate
      .replace("{base}", settings.synergyBase.replace(/\/+$/, ""))
      .replace("{guid}", `{${ticket.guid}}`)
      .replace("{rawguid}", ticket.guid)
      .replace("{id}", encodeURIComponent(ticket.id));
  }
  return settings.fallbackUrlTemplate
    .replace("{base}", settings.synergyBase.replace(/\/+$/, ""))
    .replace("{id}", encodeURIComponent(ticket.id));
}

function formatClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatRemaining(ms) {
  if (ms <= 0) return "overdue";
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins} min left`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m left`;
}

// ------------------------------------------------------------ notifications

async function rememberNotification(notificationId, data) {
  const { notifMap = {} } = await chrome.storage.local.get("notifMap");
  notifMap[notificationId] = { ...data, createdAt: Date.now() };
  await chrome.storage.local.set({ notifMap });
}

async function forgetNotification(notificationId) {
  const { notifMap = {} } = await chrome.storage.local.get("notifMap");
  const entry = notifMap[notificationId];
  delete notifMap[notificationId];
  await chrome.storage.local.set({ notifMap });
  return entry;
}

async function notify({ id, title, message, ticket, url, sticky, sound }) {
  const settings = await getSettings();

  await rememberNotification(id, { ticketId: ticket.id, url, kind: sound });

  chrome.notifications.create(id, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("images/icon-128.png"),
    title,
    message,
    contextMessage: ticket.customer || undefined,
    priority: 2,
    requireInteraction: !!sticky,
    buttons: [
      { title: "Open ticket" },
      { title: `Snooze ${settings.snoozeMinutes} min` }
    ]
  });

  if (settings.soundEnabled) playSound(sound, settings.soundVolume);
}

// -------------------------------------------------------------- sound (offscreen)

let offscreenReady = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  if (offscreenReady) return offscreenReady;

  offscreenReady = chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Play an audible alert when a ticket deadline is close."
    })
    .catch((e) => {
      if (!String(e).includes("Only a single offscreen")) console.warn("Offscreen:", e);
    })
    .finally(() => {
      offscreenReady = null;
    });

  return offscreenReady;
}

async function playSound(kind, volume) {
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: "offscreen", type: "PLAY", kind, volume }, () => {
      void chrome.runtime.lastError;
    });
  } catch (e) {
    console.warn("Could not play alert sound:", e);
  }
}

// ------------------------------------------------------------------- badge

async function updateBadge() {
  const { knownTickets = {} } = await chrome.storage.local.get("knownTickets");
  const settings = await getSettings();
  const horizon = Math.max(...settings.warnMinutes, 0) * 60000;
  const now = Date.now();

  let atRisk = 0;
  let breached = 0;

  for (const t of Object.values(knownTickets)) {
    if (now - (t.lastSeen || 0) > STALE_AFTER_MS) continue;
    const remaining = RRAWorkHours.remaining(t.deadlineMs, now, settings);
    if (remaining <= 0) breached++;
    else if (remaining <= horizon) atRisk++;
  }

  const total = atRisk + breached;
  await chrome.action.setBadgeText({ text: total ? String(total) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: breached ? "#B00020" : "#E8642A" });
  await chrome.action.setTitle({
    title: total
      ? `Rapid Response Alerter - ${breached} overdue, ${atRisk} approaching`
      : "Rapid Response Alerter - nothing urgent"
  });
}

// ---------------------------------------------------------- ticket ingestion

// Serialize scans and alarm checks so an older check cannot restore removed rows.
let ticketWork = Promise.resolve();
function queueTicketWork(operation) {
  const result = ticketWork.then(operation);
  ticketWork = result.catch(() => {});
  return result;
}
function processTicketData(incoming) {
  return queueTicketWork(() => ingestTicketData(incoming));
}
async function ingestTicketData(incoming) {
  const settings = await getSettings();
  const { knownTickets = {}, seeded = false } = await chrome.storage.local.get([
    "knownTickets",
    "seeded"
  ]);

  const now = Date.now();
  const next = {};

  for (const ticket of incoming) {
    const prev = knownTickets[ticket.id];

    next[ticket.id] = {
      ...(prev || {}),
      ...ticket,
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      alerted: prev?.alerted ?? {},
      snoozeUntil: prev?.snoozeUntil ?? 0
    };

    if (!prev && seeded && settings.alertOnNew) {
      const t = next[ticket.id];
      await notify({
        id: `rra:new:${ticket.id}`,
        title: `New ticket ${ticket.id}`,
        message: `${ticket.customer || "Unknown customer"}\nFirst response by ${formatClock(
          ticket.deadlineMs
        )} (${formatRemaining(RRAWorkHours.remaining(ticket.deadlineMs, now, settings))})`,
        ticket: t,
        url: buildUrl(t, settings),
        sticky: settings.stickyNew,
        sound: "new"
      });
      t.alerted.new = true;
    }
  }

  // A successful scan is the current board, including a valid empty table.
  for (const [id, t] of Object.entries(knownTickets)) {
    if (next[id]) continue;
      console.log(`Ticket ${id} left the board.`);
      chrome.notifications.clear(`rra:new:${id}`);
      for (const th of settings.warnMinutes) chrome.notifications.clear(`rra:warn:${id}:${th}`);
      chrome.notifications.clear(`rra:breach:${id}`);
  }

  await chrome.storage.local.set({ knownTickets: next, seeded: true, lastScan: now });
  // Separate state and failures: Teams must never suppress the existing deadline checks.
  try {
    await teamsDispatcher.observe(incoming);
    teamsDispatcher.run().catch(teamsError);
  } catch { teamsError(); }
  await checkDeadlinesNow();
}

// ---------------------------------------------------------- deadline checks

function checkDeadlines() {
  return queueTicketWork(checkDeadlinesNow);
}
async function checkDeadlinesNow() {
  const settings = await getSettings();
  const { knownTickets = {} } = await chrome.storage.local.get("knownTickets");
  const now = Date.now();
  let changed = false;

  for (const ticket of Object.values(knownTickets)) {
    if (!ticket.deadlineMs) continue;
    if (now - (ticket.lastSeen || 0) > STALE_AFTER_MS) continue;
    if (ticket.snoozeUntil && now < ticket.snoozeUntil) continue;

    ticket.alerted = ticket.alerted || {};
    const remaining = RRAWorkHours.remaining(ticket.deadlineMs, now, settings);
    const url = buildUrl(ticket, settings);

    if (remaining <= 0) {
      if (settings.alertOnBreach && !ticket.alerted.breach) {
        await notify({
          id: `rra:breach:${ticket.id}`,
          title: `OVERDUE ${ticket.id}`,
          message: `${ticket.customer || "Unknown customer"}\nFirst response was due at ${formatClock(
            ticket.deadlineMs
          )}`,
          ticket,
          url,
          sticky: true,
          sound: "breach"
        });
        ticket.alerted.breach = true;
        for (const th of settings.warnMinutes) ticket.alerted[th] = true;
        changed = true;
      }
      continue;
    }

    const minutesLeft = remaining / 60000;
    for (const threshold of settings.warnMinutes) {
      if (minutesLeft > threshold || ticket.alerted[threshold]) continue;

      await notify({
        id: `rra:warn:${ticket.id}:${threshold}`,
        title: `${Math.ceil(minutesLeft)} min left - ${ticket.id}`,
        message: `${ticket.customer || "Unknown customer"}\nFirst response due at ${formatClock(
          ticket.deadlineMs
        )}`,
        ticket,
        url,
        sticky: settings.stickyDeadline,
        sound: threshold <= 5 ? "urgent" : "warn"
      });

      // Mark this and every larger threshold, so a ticket that appears at
      // 14 minutes fires once, not three times in a row.
      for (const th of settings.warnMinutes) {
        if (th >= threshold) ticket.alerted[th] = true;
      }
      changed = true;
      break;
    }
  }

  if (changed) await chrome.storage.local.set({ knownTickets });
  await updateBadge();
}

// ------------------------------------------------------------------ events

chrome.runtime.onInstalled.addListener(async (details) => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...DEFAULTS, ...settings } });

  if (details.reason === "install") {
    await chrome.storage.local.set({ knownTickets: {}, notifMap: {}, seeded: false });
  }
  console.log("Rapid Response Alerter ready.");
  updateBadge();
});

chrome.runtime.onStartup.addListener(() => updateBadge());

chrome.alarms.create(ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) {
    checkDeadlines();
    teamsDispatcher.run().catch(teamsError);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return;

  if (["TEAMS_TEST", "TEAMS_RETRY", "TEAMS_SETTINGS_CHANGED"].includes(message?.type)) {
    if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("options.html")) return;
    const operation = message.type === "TEAMS_TEST" ? teamsDispatcher.test()
      : message.type === "TEAMS_RETRY" ? teamsDispatcher.retry(message.ticketId) : teamsDispatcher.run();
    operation.then(result => sendResponse({ ok: true, result }))
      .catch(() => sendResponse({ ok: false, error: "Bewerking mislukt. Controleer de instellingen en of het request nog openstaat." }));
    return true;
  }

  if (message?.type === "TICKET_DATA") {
    processTicketData(message.payload || []);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "OPEN_TICKET") {
    (async () => {
      const settings = await getSettings();
      const { knownTickets = {} } = await chrome.storage.local.get("knownTickets");
      const ticket = knownTickets[message.ticketId];
      if (ticket) chrome.tabs.create({ url: buildUrl(ticket, settings) });
      sendResponse({ ok: !!ticket });
    })();
    return true;
  }

  if (message?.type === "TEST_SOUND") {
    (async () => {
      const settings = await getSettings();
      await playSound(message.kind || "warn", settings.soundVolume);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message?.type === "SETTINGS_CHANGED") {
    checkDeadlines();
    sendResponse({ ok: true });
    return true;
  }
});

chrome.notifications.onClicked.addListener(async (notificationId) => {
  const entry = await forgetNotification(notificationId);
  chrome.notifications.clear(notificationId);
  if (entry?.url) chrome.tabs.create({ url: entry.url });
});

chrome.notifications.onButtonClicked.addListener(async (notificationId, buttonIndex) => {
  const entry = await forgetNotification(notificationId);
  chrome.notifications.clear(notificationId);
  if (!entry) return;

  if (buttonIndex === 0) {
    if (entry.url) chrome.tabs.create({ url: entry.url });
    return;
  }

  // Snooze: mute this ticket briefly, then let the next threshold fire again.
  const settings = await getSettings();
  const { knownTickets = {} } = await chrome.storage.local.get("knownTickets");
  const ticket = knownTickets[entry.ticketId];
  if (!ticket) return;

  ticket.snoozeUntil = Date.now() + settings.snoozeMinutes * 60000;
  ticket.alerted = ticket.alerted || {};
  delete ticket.alerted.breach;
  await chrome.storage.local.set({ knownTickets });
});

chrome.notifications.onClosed.addListener((notificationId) => {
  forgetNotification(notificationId);
});
