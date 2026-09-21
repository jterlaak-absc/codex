/* Optional Teams distribution. The wallboard remains the only ticket source. */
(function (root) {
  "use strict";
  const DEFAULTS = { enabled: false, webhookUrl: "", timing: "", singleSender: false };
  const FRESH_MS = 60000;
  const RETRYABLE = new Set(["uncertain", "rejected"]);

  function endpoint(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error("Vul de volledige Teams Workflows-link in."); }
    const hostOK = url.hostname.endsWith(".environment.api.powerplatform.com") ||
      url.hostname.endsWith(".logic.azure.com");
    if (url.protocol !== "https:" || !hostOK || url.username || url.password || url.hash ||
        (url.port && url.port !== "443") || !url.pathname.includes("/workflows/") ||
        !url.pathname.endsWith("/invoke")) {
      throw new Error("Gebruik de HTTPS-triggerlink uit Teams Workflows.");
    }
    return { url: url.href, origin: url.origin + "/*" };
  }

  function validate(settings, forTest = false) {
    const destination = endpoint(settings.webhookUrl);
    if (!forTest && !["immediate", "warning"].includes(settings.timing)) {
      throw new Error("Kies wanneer requests in de supportchat worden aangeboden.");
    }
    if (!forTest && !settings.singleSender) {
      throw new Error("Wijs één browser aan voor de Teams-verzending.");
    }
    return destination;
  }

  // Escape card Markdown from wallboard text; never interpret it as markup.
  function plain(value, limit = 500) {
    return String(value || "").slice(0, limit).replace(/[\u0000-\u001f]/g, " ")
      .replace(/[\\*_\[\]()<>`#~]/g, "\\$&");
  }

  function makePayload(ticket, ticketUrl, eventId, isTest = false) {
    const deadline = plain(ticket.deadlineRaw, 40) || new Date(ticket.deadlineMs).toLocaleString("nl-NL");
    const claim = { type: "Action.Submit", title: "Pak op", data: {
      action: "claim", ticketId: String(ticket.id), eventId, isTest
    } };
    const card = {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard", version: "1.2", msteams: { width: "Full" },
      body: [
        { type: "ColumnSet", spacing: "None", columns: [
          { type: "Column", width: "stretch", verticalContentAlignment: "Center", items: [
            { type: "ColumnSet", spacing: "None", columns: [
              { type: "Column", width: "96px", items: [
                { type: "TextBlock", text: plain(ticket.id, 100), weight: "Bolder", wrap: true, spacing: "None" }
              ] },
              { type: "Column", width: "stretch", spacing: "None", items: [
                { type: "TextBlock", text: `| ${plain(ticket.customer, 100) || "Onbekend"}`, weight: "Bolder", wrap: true, spacing: "None" }
              ] },
              { type: "Column", width: "138px", spacing: "None", items: [
                { type: "TextBlock", text: `| ${deadline}`, weight: "Bolder", wrap: true, spacing: "None" }
              ] }
            ] }
          ] },
          { type: "Column", width: "auto", verticalContentAlignment: "Center", spacing: "Small", items: [
            { type: "ActionSet", spacing: "None", actions: [claim] }
          ] }
        ] },
        // Kept at body[1] for the existing Power Automate company expression.
        { type: "FactSet", isVisible: false, facts: [
          { title: "Request", value: plain(ticket.id, 100) },
          { title: "Klant", value: plain(ticket.customer, 100) || "Onbekend" },
          { title: "Eerste reactie vóór", value: deadline }
        ] }
      ],
      actions: []
    };
    // A real row link stays available without adding another visible button.
    try {
      const url = new URL(ticketUrl);
      if ((ticket.guid || ticket.href) && url.protocol === "https:" && !url.username && !url.password && url.href.length <= 2000) {
        card.body[0].columns[0].selectAction = { type: "Action.OpenUrl", url: url.href };
      }
    } catch { /* A missing link does not make the compact card taller. */ }
    return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }] };
  }

  function eligible(ticket, observation, settings, alertSettings, now, remaining) {
    if (!ticket || typeof ticket.id !== "string" || !ticket.id.trim() ||
        !Number.isFinite(ticket.deadlineMs) || String(ticket.assignee || "").trim()) return false;
    if (!observation || !Array.isArray(observation.ids) || !observation.ids.includes(ticket.id) ||
        now < observation.at || now - observation.at > FRESH_MS ||
        !Number.isFinite(ticket.lastSeen) || now - ticket.lastSeen > FRESH_MS) return false;
    if (settings.timing === "immediate") return true;
    const thresholds = (alertSettings.warnMinutes || []).filter(n => Number.isFinite(n) && n > 0);
    return settings.timing === "warning" && thresholds.length > 0 &&
      remaining(ticket.deadlineMs, now, alertSettings) <= Math.max(...thresholds) * 60000;
  }

  function createDispatcher({ storage, permissions, getAlertSettings, buildUrl,
    fetcher = (...args) => fetch(...args), now = Date.now,
    uuid = () => crypto.randomUUID(), logger = console, timeoutMs = 10000,
    remaining = (deadline, current) => deadline - current }) {
    let tail = Promise.resolve();
    let pendingRun = null;
    function enqueue(fn) {
      const result = tail.then(fn);
      tail = result.catch(() => {});
      return result;
    }
    async function saveIssue(message) {
      await storage.set({ teamsIssue: message });
      if (message) logger.warn("[RRA Teams]", message);
    }
    async function post(destination, payload) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetcher(destination.url, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload), signal: controller.signal,
          credentials: "omit", redirect: "error", referrerPolicy: "no-referrer"
        });
        // An HTTP acknowledgement is not proof that the downstream Teams action succeeded.
        if (response.ok) return { status: "accepted", detail: "Aangeboden aan workflow" };
        if (response.status >= 400 && response.status < 500 && response.status !== 408) {
          return { status: "rejected", detail: `Workflow weigerde de aanvraag (HTTP ${response.status}).` };
        }
        return { status: "uncertain", detail: `Ontvangst onzeker (HTTP ${response.status}). Controleer Teams en de workflow.` };
      } catch {
        // Never log fetch errors: they can contain the signed webhook URL.
        return { status: "uncertain", detail: "Ontvangst onzeker door een netwerkfout of timeout. Controleer Teams en de workflow." };
      } finally { clearTimeout(timeout); }
    }

    async function runCore(retryId) {
      const saved = await storage.get(["teamsSettings", "teamsDispatch", "teamsObservation", "knownTickets"]);
      const settings = { ...DEFAULTS, ...saved.teamsSettings };
      const entries = saved.teamsDispatch || {};
      // A worker restart may follow a successful POST but precede the acknowledgement write.
      let recovered = false;
      for (const entry of Object.values(entries)) {
        if (entry.status === "sending") {
          entry.status = "uncertain";
          entry.detail = "Verzending onderbroken. Controleer Teams vóór opnieuw aanbieden.";
          recovered = true;
        }
      }
      if (recovered) await storage.set({ teamsDispatch: entries });
      if (!settings.enabled) {
        if (retryId) throw new Error("Teams-verzending staat uit.");
        return;
      }
      let destination;
      try {
        destination = validate(settings);
        if (!await permissions.contains({ origins: [destination.origin] })) {
          throw new Error("Sla de Teams-instellingen op om toegang tot de workflow toe te staan.");
        }
      } catch (error) { await saveIssue(error.message); return; }
      const alertSettings = await getAlertSettings();
      const tickets = Object.values(saved.knownTickets || {}).filter(ticket =>
        eligible(ticket, saved.teamsObservation, settings, alertSettings, now(), remaining));
      let ticket;
      if (retryId) {
        ticket = tickets.find(t => t.id === retryId);
        if (!ticket || !RETRYABLE.has(entries[retryId]?.status)) {
          throw new Error("Dit request is niet meer beschikbaar voor opnieuw aanbieden.");
        }
      } else {
        ticket = tickets.filter(t => !Object.hasOwn(entries, t.id))
          .sort((a, b) => a.deadlineMs - b.deadlineMs)[0];
      }
      if (!ticket) return;
      const eventId = uuid();
      const previous = entries[ticket.id];
      const ticketId = ticket.id;
      // Durable intent before any network side effect. State contains no customer data or URL.
      Object.defineProperty(entries, ticket.id, { value: {
        status: "sending", eventId, at: now(), detail: "Wordt aangeboden"
      }, enumerable: true, configurable: true, writable: true });
      await storage.set({ teamsDispatch: entries });
      // Respect a pause or destination edit made while storage/permissions were pending.
      const latestData = await storage.get(["teamsSettings", "knownTickets", "teamsObservation"]);
      const latest = latestData.teamsSettings || {};
      ticket = latestData.knownTickets?.[ticketId];
      if (!latest.enabled || !latest.singleSender || latest.webhookUrl !== settings.webhookUrl || latest.timing !== settings.timing ||
          !eligible(ticket, latestData.teamsObservation, latest, alertSettings, now(), remaining)) {
        if (previous) entries[ticketId] = previous;
        else delete entries[ticketId];
        await storage.set({ teamsDispatch: entries });
        return;
      }
      const payload = makePayload(ticket, buildUrl(ticket, alertSettings), eventId);
      const result = await post(destination, payload);
      entries[ticket.id] = { ...entries[ticket.id], ...result, at: now() };
      await storage.set({ teamsDispatch: entries });
      await saveIssue("");
      logger.log("[RRA Teams]", result.status);
      return result;
    }

    return {
      async observe(incoming) {
        await storage.set({ teamsObservation: { at: now(), ids: incoming
          .filter(t => t && typeof t.id === "string").map(t => t.id) } });
      },
      run() {
        if (!pendingRun) pendingRun = enqueue(() => runCore()).finally(() => { pendingRun = null; });
        return pendingRun;
      },
      retry(ticketId) { return enqueue(() => runCore(ticketId)); },
      test() {
        return enqueue(async () => {
          const { teamsSettings = {} } = await storage.get("teamsSettings");
          const destination = validate(teamsSettings, true);
          if (!await permissions.contains({ origins: [destination.origin] })) throw new Error("Sla eerst de Teams-link op.");
          return post(destination, makePayload({ id: "TEST", customer: "Voorbeeldklant",
            deadlineRaw: "Test — geen echte deadline", deadlineMs: now() }, "", uuid(), true));
        });
      }
    };
  }
  const api = { DEFAULTS, endpoint, validate, makePayload, eligible, createDispatcher };
  root.RRATeams = api;
  if (typeof module !== "undefined") module.exports = api;
})(globalThis);
