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

const TEXT_FIELDS = ["synergyBase", "requestUrlTemplate", "fallbackUrlTemplate", "workStart", "workEnd"];
const CHECKBOXES = ["alertOnNew", "alertOnBreach", "soundEnabled", "stickyDeadline", "stickyNew"];
const NUMBERS = ["soundVolume", "snoozeMinutes"];

const el = (id) => document.getElementById(id);

async function load() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...settings };

  TEXT_FIELDS.forEach((k) => (el(k).value = s[k]));
  CHECKBOXES.forEach((k) => (el(k).checked = !!s[k]));
  NUMBERS.forEach((k) => (el(k).value = s[k]));
  el("warnMinutes").value = s.warnMinutes.join(", ");
}

async function save() {
  const warnMinutes = el("warnMinutes")
    .value.split(/[,\s;]+/)
    .map((n) => parseInt(n, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  const settings = { warnMinutes: warnMinutes.length ? warnMinutes : DEFAULTS.warnMinutes };

  TEXT_FIELDS.forEach((k) => (settings[k] = el(k).value.trim() || DEFAULTS[k]));
  const clockMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  if (clockMinutes(settings.workEnd) <= clockMinutes(settings.workStart)) {
    settings.workStart = DEFAULTS.workStart;
    settings.workEnd = DEFAULTS.workEnd;
  }
  CHECKBOXES.forEach((k) => (settings[k] = el(k).checked));
  settings.soundVolume = Math.min(1, Math.max(0, parseFloat(el("soundVolume").value) || 0));
  settings.snoozeMinutes = Math.max(1, parseInt(el("snoozeMinutes").value, 10) || 5);

  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage({ type: "SETTINGS_CHANGED" }, () => void chrome.runtime.lastError);

  el("saved").classList.add("show");
  setTimeout(() => el("saved").classList.remove("show"), 1600);
  load();
}

el("save").addEventListener("click", save);

el("reset").addEventListener("click", async () => {
  await chrome.storage.local.set({ settings: { ...DEFAULTS } });
  load();
});

el("test").addEventListener("click", async () => {
  await save();
  chrome.runtime.sendMessage({ type: "TEST_SOUND", kind: "urgent" }, () => void chrome.runtime.lastError);
  chrome.notifications.create(`rra:test:${Date.now()}`, {
    type: "basic",
    iconUrl: chrome.runtime.getURL("images/icon-128.png"),
    title: "Test alert",
    message: "This is what a deadline warning looks and sounds like.",
    priority: 2
  });
});

load();
