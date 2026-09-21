(() => {
  "use strict";
  const el = id => document.getElementById(id);
  const labels = { accepted: "Aangeboden aan workflow", sending: "Wordt aangeboden",
    uncertain: "Ontvangst onzeker", rejected: "Geweigerd door workflow" };
  function feedback(text, error = false) {
    el("teams-feedback").textContent = text;
    el("teams-feedback").classList.toggle("error", error);
  }
  async function message(type, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...extra });
    if (!response?.ok) throw new Error(response?.error || "De extensie reageert niet. Herlaad de extensie.");
    return response.result;
  }
  async function load() {
    const { teamsSettings = {} } = await chrome.storage.local.get("teamsSettings");
    const s = { ...RRATeams.DEFAULTS, ...teamsSettings };
    el("teams-url").value = s.webhookUrl;
    el("teams-timing").value = s.timing;
    el("teams-single").checked = s.singleSender;
    el("teams-enabled").checked = s.enabled;
    await status();
  }
  async function status() {
    const { teamsDispatch = {}, teamsSettings = {}, teamsIssue = "", teamsObservation } =
      await chrome.storage.local.get(["teamsDispatch", "teamsSettings", "teamsIssue", "teamsObservation"]);
    const entries = Object.entries(teamsDispatch).sort((a, b) => b[1].at - a[1].at);
    const count = entries.filter(([, e]) => e.status === "accepted").length;
    const stale = !teamsObservation || Date.now() - teamsObservation.at > 60000;
    el("teams-status").textContent = (teamsSettings.enabled ? "Automatisch aanbieden staat aan." : "Automatisch aanbieden staat uit.") +
      `\n${count} request(s) aangeboden aan de workflow. Controleer de ontvangst en wie ze oppakt in Teams.` +
      (stale ? "\nGeen recente wallboardgegevens; er worden nu geen requests verstuurd." : "") +
      (teamsIssue ? "\n" + teamsIssue : "");
    const history = el("teams-history");
    history.replaceChildren();
    const problems = entries.filter(([, e]) => ["uncertain", "rejected"].includes(e.status));
    if (problems.length) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "Controleer bij ontvangst onzeker eerst de chat en de uitvoeringsgeschiedenis van de workflow. Opnieuw aanbieden kan anders een dubbele kaart maken.";
      history.appendChild(note);
    }
    for (const [id, entry] of problems.slice(0, 20)) {
      const row = document.createElement("div");
      row.className = "teams-entry";
      const text = document.createElement("div");
      text.textContent = `${id}: ${labels[entry.status] || entry.status}. ${entry.detail || ""}`;
      row.appendChild(text);
      const button = document.createElement("button");
      button.className = "ghost";
      button.textContent = "Na controle opnieuw aanbieden";
      button.disabled = !teamsSettings.enabled;
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const result = await message("TEAMS_RETRY", { ticketId: id });
          feedback(result?.detail || "Controleer de Teams-instellingen.", result?.status !== "accepted");
        } catch (error) { feedback(error.message, true); }
        finally { await status(); }
      });
      row.appendChild(button);
      history.appendChild(row);
    }
  }

  el("teams-save").addEventListener("click", async () => {
    const settings = { enabled: el("teams-enabled").checked, webhookUrl: el("teams-url").value.trim(),
      timing: el("teams-timing").value, singleSender: el("teams-single").checked };
    try {
      // Ask only for the selected workflow origin, directly from the user's click.
      if (settings.enabled) RRATeams.validate(settings);
      if (settings.webhookUrl) {
        const destination = RRATeams.endpoint(settings.webhookUrl);
        if (!await chrome.permissions.request({ origins: [destination.origin] })) {
          throw new Error("Geen toegang verleend tot de workflow. Instellingen zijn niet opgeslagen.");
        }
      }
      await chrome.storage.local.set({ teamsSettings: settings, teamsIssue: "" });
      feedback(settings.enabled ? "Opgeslagen. Beschikbare requests worden aangeboden volgens het gekozen moment." : "Opgeslagen. Automatisch aanbieden staat uit.");
      await message("TEAMS_SETTINGS_CHANGED");
      await status();
    } catch (error) { feedback(error.message, true); }
  });

  el("teams-test").addEventListener("click", async () => {
    const button = el("teams-test");
    button.disabled = true;
    try {
      const { teamsSettings = {} } = await chrome.storage.local.get("teamsSettings");
      if (teamsSettings.webhookUrl !== el("teams-url").value.trim()) throw new Error("Sla eerst de nieuwe Teams-link op.");
      feedback("Test wordt aangeboden…");
      const result = await message("TEAMS_TEST");
      feedback(result?.status === "accepted"
        ? "Test aangeboden aan de workflow. Controleer de kaart in de chat en klik op ‘Ik pak deze op’."
        : result?.detail || "Test mislukt.", result?.status !== "accepted");
    } catch (error) { feedback(error.message, true); }
    finally { button.disabled = false; }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && ["teamsDispatch", "teamsSettings", "teamsIssue", "teamsObservation"].some(k => changes[k])) {
      status().catch(() => feedback("Status kon niet worden gelezen.", true));
    }
  });
  load().catch(() => feedback("Instellingen konden niet worden gelezen.", true));
})();
