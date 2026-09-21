# codex
applicaties voor support

# Rapid Response Alerter v3.1.9 — Teams supportchat

Removed requests now disappear on the next successful wallboard scan, including when the board becomes empty. The old 90-second retention is removed. Scans and deadline checks are serialized to prevent old checks from restoring removed rows. After one minute without a successful scan, the popup shows that the board data is no longer current and stale tickets no longer trigger deadline alerts.

The incoming Teams card again uses the normal text size and requests the full available Teams card width. In a group chat Teams still caps it at the chat bubble width; long names can wrap. The Power Automate expressions and claim button data are unchanged from v3.1.7.

The incoming Teams card now uses aligned columns for request, customer and deadline. Long customer names may wrap. The claim button and workflow data stay in the same place as v3.1.6. The confirmation-card template also reads the ticket number directly and removes the dot after the check mark; apply that template separately in Power Automate.

The incoming Teams claim card now shows the full ticket line in bold.

The Teams request card now places **Pak op** to the right of the compact ticket line. Before sending with this version, update the Power Automate **Requestnummer** Compose expression as described in [KNOP-NAAST-TEKST.md](KNOP-NAAST-TEKST.md). The customer lookup in the flow stays unchanged. Existing cards in Teams keep their earlier layout.

The countdown, badge and deadline warnings count only Monday through Friday during the configured working hours. The default is 08:30–17:00; change it in Settings. Public holidays are not excluded automatically.

Optional shared-chat distribution is described in [VERDEELBOT.md](VERDEELBOT.md).
Open [TEAMS-INSTALLATIE.html](TEAMS-INSTALLATIE.html) to configure the required Teams workflow.
Teams sending is off by default. The original v3.0 documentation follows below.

Watches the ABSC support wallboard and alerts on new tickets and first-response
deadlines that are about to expire.

## Install

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
2. Open the wallboard URL and leave the tab open (pin it). The content script only
   runs while that page is loaded.
3. Open the extension options and confirm the Synergy base URL.
4. Windows: Settings → System → Notifications → make sure Chrome is allowed and
   Focus Assist isn't suppressing it. Chrome must also be running for alarms to fire.

## What changed from v2.3

| Area | v2.3 | v3.0 |
|---|---|---|
| Deep link | Guessed an OData endpoint that returns nothing | Reads the link/GUID out of the wallboard row |
| Deadline warnings | One shot at 15 min | Escalating steps (default 30 / 15 / 5) plus an overdue alert |
| Click handling | Regex against the notification title | Notification → ticket map in storage |
| Notification actions | Click only | Open ticket / Snooze buttons |
| Date parsing | `new Date("YYYY-MM-DDTHH:MM:SS")` string | Explicit local `Date` from parts, epoch ms |
| Change detection | 30 s poll | MutationObserver (~1.2 s) plus a 20 s backstop |
| Sound | None | Distinct synthesised tone per alert level |
| Storage on reload | Wiped every install/update | Preserved; first payload seeded silently |
| Board scan | Tickets dropped, re-alerted as new | Latest successful scan controls the queue; missing table is shown as stale after 60 s |
| Overview | None | Toolbar badge + popup with live countdowns |

## Why the API approach in v2.3 failed

`/api/odata/v1/Requests` is Exact **Online** shaped. Synergy Enterprise exposes its
web services under `/services/`, not `/api/odata/v1/`, and the request-workflow
service is POST-based with a required `DataServiceVersion: 3.0` header — not a GET
you can filter by request number. Guessing entity and field names against the wrong
base path will return empty forever.

You do not need any of it: the wallboard row almost certainly already contains the
GUID. `content.js` scrapes `href`, `onclick`, and `data-*` attributes for a GUID and
hands it to the service worker.

## If a row has no GUID

Check first — it takes two minutes:

1. Open the wallboard, F12 → Elements.
2. Inspect a Request cell. Look for an `<a href>`, an `onclick`, or a `data-id`
   containing a GUID.
3. If there is one, you are done — v3.0 picks it up automatically.
4. If there is not, open a ticket normally in ServiceNext with the Network tab
   recording, filter on the request number, and copy the request that resolves it.
   Whatever URL that is, put it in Options → *Fallback URL* with `{id}` where the
   number goes. That is a real observed endpoint rather than a guess.

Until then the fallback just opens the portal, and the popup marks those tickets
"no direct link on the board".

## Files

- `manifest.json` — MV3 manifest
- `content.js` — wallboard parser
- `background.js` — state, deadline logic, notifications
- `offscreen.html` / `offscreen.js` — alert tones (Web Audio, no binary assets)
- `popup.html` / `popup.js` — live queue with countdowns
- `options.html` / `options.js` — settings

## Known limits

- The wallboard tab must stay open. Chrome does not run content scripts on
  closed tabs, and the wallboard is JS-rendered so the service worker cannot
  usefully fetch it headlessly.
- `chrome.alarms` clamps to roughly 30 s minimum, so a deadline can be reported
  up to ~30 s late. Incoming wallboard payloads also trigger a check immediately.
- Notification buttons are not shown on every Windows notification style; clicking
  the body still opens the ticket.
