/**
 * Rapid Response Alerter - content script (v3.0)
 *
 * Runs on the wallboard page. Reads the "Customers data" table and pushes
 * ticket rows to the service worker.
 *
 * Changes vs v2.2:
 *  - Reacts to DOM changes (MutationObserver) instead of only polling every 30s.
 *  - Captures the ticket's link / GUID straight out of the row, so the service
 *    worker never has to guess an API endpoint to build a deep link.
 *  - Timezone-safe deadline parsing: builds a local Date from parts and sends
 *    epoch milliseconds, not an ambiguous string.
 *  - Tolerates Dutch column headers, extra columns, and reordered columns.
 *  - Survives extension reloads without throwing "context invalidated" spam.
 */

(() => {
  if (window.__rraContentLoaded) return;
  window.__rraContentLoaded = true;

  const TAG = "[RRA]";
  const POLL_MS = 20000;
  const DEBOUNCE_MS = 1200;

  const SECTION_TITLES = ["customers data", "customer data", "klantgegevens", "klanten data"];

  const COLUMNS = {
    request: ["request", "requestnumber", "request number", "verzoek", "ticket", "nummer", "number"],
    customer: ["customer", "klant", "account", "relatie", "debiteur"],
    firstResponse: [
      "firstresponse", "first response", "eerste reactie", "eerstereactie",
      "responsedeadline", "response deadline", "reactietijd", "deadline"
    ],
    subject: ["subject", "onderwerp", "description", "omschrijving"],
    assignee: ["assignee", "owner", "medewerker", "behandelaar", "toegewezen aan"]
  };

  const GUID_RE = /\{?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\}?/i;

  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  const squash = (s) => norm(s).replace(/[\s._-]/g, "");

  function matchColumn(headers, candidates) {
    // exact match first, then contains
    for (let i = 0; i < headers.length; i++) {
      if (candidates.some((c) => squash(headers[i]) === squash(c))) return i;
    }
    for (let i = 0; i < headers.length; i++) {
      if (candidates.some((c) => squash(headers[i]).includes(squash(c)))) return i;
    }
    return -1;
  }

  /** Find the ticket table, with several fallbacks. */
  function findTable() {
    const headings = Array.from(
      document.querySelectorAll("h1, h2, h3, h4, .title, .header, [class*='title'], [class*='header']")
    );

    for (const h of headings) {
      if (!SECTION_TITLES.includes(norm(h.textContent))) continue;

      let el = h.nextElementSibling;
      let hops = 0;
      while (el && hops < 6) {
        if (el.tagName === "TABLE") return el;
        const nested = el.querySelector && el.querySelector("table");
        if (nested) return nested;
        el = el.nextElementSibling;
        hops++;
      }

      const sibling = h.parentElement && h.parentElement.querySelector("table");
      if (sibling) return sibling;
    }

    // Fallback: any table on the page whose headers look like ours.
    for (const table of document.querySelectorAll("table")) {
      const headers = readHeaders(table);
      if (!headers.length) continue;
      if (matchColumn(headers, COLUMNS.request) >= 0 && matchColumn(headers, COLUMNS.firstResponse) >= 0) {
        return table;
      }
    }

    return null;
  }

  function readHeaders(table) {
    let cells = Array.from(table.querySelectorAll("thead th, thead td"));
    if (!cells.length) cells = Array.from(table.querySelectorAll("th"));
    if (!cells.length) {
      const firstRow = table.querySelector("tr");
      if (firstRow) cells = Array.from(firstRow.children);
    }
    return cells.map((c) => c.textContent);
  }

  /**
   * Parse a wallboard timestamp into epoch ms, using local time explicitly so
   * the browser never reinterprets it as UTC.
   * Handles: DD-MM-YYYY HH:MM, DD/MM/YYYY HH:MM, YYYY-MM-DD HH:MM, and HH:MM.
   */
  function parseDeadline(raw) {
    const text = (raw || "").replace(/\s+/g, " ").trim();
    if (!text) return null;

    const full = text.match(
      /(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/
    );

    if (full) {
      let [, p1, p2, p3, hh, mm, ss] = full;
      let year, month, day;
      if (p1.length === 4) {
        year = +p1; month = +p2; day = +p3;          // YYYY-MM-DD
      } else {
        day = +p1; month = +p2; year = +p3;          // DD-MM-YYYY
        if (year < 100) year += 2000;
      }
      const d = new Date(year, month - 1, day, +hh, +mm, ss ? +ss : 0, 0);
      return isNaN(d.getTime()) ? null : d.getTime();
    }

    // Time only ("13:25") - assume today, roll to tomorrow if long past.
    const timeOnly = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (timeOnly) {
      const now = new Date();
      const d = new Date(
        now.getFullYear(), now.getMonth(), now.getDate(),
        +timeOnly[1], +timeOnly[2], timeOnly[3] ? +timeOnly[3] : 0, 0
      );
      if (d.getTime() < now.getTime() - 12 * 3600 * 1000) d.setDate(d.getDate() + 1);
      return d.getTime();
    }

    return null;
  }

  /** Pull a request GUID and/or an absolute Synergy URL out of a row. */
  function extractLink(row) {
    const haystack = [];

    row.querySelectorAll("a[href]").forEach((a) => haystack.push(a.getAttribute("href")));
    for (const attr of row.attributes) haystack.push(attr.value);
    row.querySelectorAll("*").forEach((el) => {
      for (const attr of el.attributes) {
        if (/^(data-|href|onclick|id|value)/i.test(attr.name)) haystack.push(attr.value);
      }
    });

    let guid = null;
    let href = null;

    for (const candidate of haystack) {
      const value = String(candidate || "");
      if (!guid) {
        const m = value.match(GUID_RE);
        if (m) guid = m[1].toUpperCase();
      }
      if (!href && /servicenext|WflRequest/i.test(value) && /^https?:\/\//i.test(value)) {
        href = value;
      }
      if (guid && href) break;
    }

    return { guid, href };
  }

  function parseTickets() {
    const table = findTable();
    if (!table) return { found: false, tickets: [] };

    const headers = readHeaders(table);
    const idxRequest = matchColumn(headers, COLUMNS.request);
    const idxCustomer = matchColumn(headers, COLUMNS.customer);
    const idxDeadline = matchColumn(headers, COLUMNS.firstResponse);
    const idxSubject = matchColumn(headers, COLUMNS.subject);
    const idxAssignee = matchColumn(headers, COLUMNS.assignee);

    if (idxRequest === -1 || idxDeadline === -1) {
      console.warn(TAG, "Table found but required columns are missing.", headers);
      return { found: false, tickets: [] };
    }

    const rows = Array.from(table.querySelectorAll("tbody tr"));
    const bodyRows = rows.length ? rows : Array.from(table.querySelectorAll("tr")).slice(1);
    const tickets = [];

    for (const row of bodyRows) {
      if (row.querySelector("th")) continue;
      const cells = row.querySelectorAll("td");
      if (!cells.length) continue;

      const cellText = (i) => (i >= 0 && cells[i] ? cells[i].textContent.replace(/\s+/g, " ").trim() : "");

      const id = cellText(idxRequest);
      const deadlineRaw = cellText(idxDeadline);
      if (!id || !deadlineRaw) continue;

      const deadlineMs = parseDeadline(deadlineRaw);
      if (!deadlineMs) {
        console.warn(TAG, `Could not parse deadline "${deadlineRaw}" for ticket ${id}`);
        continue;
      }

      const { guid, href } = extractLink(row);

      tickets.push({
        id,
        customer: cellText(idxCustomer),
        subject: cellText(idxSubject),
        assignee: cellText(idxAssignee),
        deadlineRaw,
        deadlineMs,
        guid,
        href
      });
    }

    return { found: true, tickets };
  }

  let lastPayload = "";

  function scan(force = false) {
    let result;
    try {
      result = parseTickets();
    } catch (e) {
      console.error(TAG, "Parse error:", e);
      return;
    }

    // If the table isn't rendered yet, stay silent rather than reporting
    // "no tickets" and letting the service worker forget everything.
    if (!result.found) return;

    const payload = JSON.stringify(result.tickets);
    if (!force && payload === lastPayload) return;
    lastPayload = payload;

    try {
      chrome.runtime.sendMessage(
        { type: "TICKET_DATA", payload: result.tickets, source: location.href },
        () => void chrome.runtime.lastError // swallow "receiving end does not exist"
      );
    } catch (e) {
      // Extension was reloaded; stop making noise.
      console.warn(TAG, "Could not reach the extension:", e.message);
    }
  }

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => scan(false), DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  setInterval(() => scan(true), POLL_MS);
  scan(true);

  console.log(TAG, "Wallboard watcher active.");
})();
