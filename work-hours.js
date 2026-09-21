/* Business-time calculations in the browser's local timezone. */
(function (root) {
  "use strict";
  const DEFAULTS = { workStart: "08:30", workEnd: "17:00" };

  function minutes(value, fallback) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
    if (!match) return fallback;
    const result = Number(match[1]) * 60 + Number(match[2]);
    return Number(match[1]) < 24 && Number(match[2]) < 60 ? result : fallback;
  }

  function normalize(settings = {}) {
    const start = minutes(settings.workStart, 8 * 60 + 30);
    const end = minutes(settings.workEnd, 17 * 60);
    if (end <= start) return { ...settings, ...DEFAULTS };
    const format = value => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    return { ...settings, workStart: format(start), workEnd: format(end) };
  }

  function forward(fromMs, toMs, settings) {
    const s = normalize(settings);
    const startMinutes = minutes(s.workStart, 510);
    const endMinutes = minutes(s.workEnd, 1020);
    let cursor = new Date(fromMs);
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    let total = 0;
    // A corrupt deadline must not create an unbounded loop.
    for (let day = 0; cursor.getTime() < toMs && day < 3700; day++) {
      if (cursor.getDay() >= 1 && cursor.getDay() <= 5) {
        const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.floor(startMinutes / 60), startMinutes % 60).getTime();
        const end = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), Math.floor(endMinutes / 60), endMinutes % 60).getTime();
        total += Math.max(0, Math.min(toMs, end) - Math.max(fromMs, start));
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return total;
  }

  function remaining(deadlineMs, nowMs = Date.now(), settings = {}) {
    if (!Number.isFinite(deadlineMs) || !Number.isFinite(nowMs)) return NaN;
    if (deadlineMs === nowMs) return 0;
    const future = deadlineMs > nowMs;
    const value = future ? forward(nowMs, deadlineMs, settings) : forward(deadlineMs, nowMs, settings);
    // Preserve direction when the interval lies entirely outside working hours.
    return future ? Math.max(1, value) : -Math.max(1, value);
  }

  const api = { DEFAULTS, normalize, remaining };
  root.RRAWorkHours = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
