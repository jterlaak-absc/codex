# Rapid Response Alerter 3.1 — verdelen via de supportchat

De aangeleverde v3.0-extensie is uitgebreid met een optionele Teams Workflows-koppeling.
De Teams-flow moet nog in de eigen Microsoft 365-omgeving worden aangemaakt en getest.
Open `TEAMS-INSTALLATIE.html` voor de volledige installatie.

## Vastgesteld in het bestaande project

| Onderdeel | Bestaande werking / hergebruik |
| --- | --- |
| Project | Chrome Manifest V3, losse JavaScriptbestanden, geen buildproces of externe pakketten |
| Detectie | `content.js`: tabel op het bestaande wallboard, MutationObserver en 20-secondencontrole |
| Modellen | Gewone ticketobjecten: `id`, `customer`, `subject`, `assignee`, `deadlineRaw`, `deadlineMs`, `guid`, `href` |
| Aanvoer | `TICKET_DATA` naar `background.js`; geen afzonderlijke ClearVox-API-client |
| Opslag | `chrome.storage.local`: `settings`, `knownTickets`, `seeded`, `lastScan`, `notifMap` |
| Verrijking | `firstSeen`, `lastSeen`, `alerted`, `snoozeUntil` in de bestaande ticketopslag |
| Alerts | Nieuwe tickets, ingestelde waarschuwingen en overschrijding; badge, meldingsknoppen, snooze en offscreen-geluid |
| Links | Bestaande `buildUrl()` gebruikt rijlink/GUID of de ingestelde fallback |
| Logging | `console.log/warn/error`, onder meer met `[RRA]`; geen logservice of database |
| Integraties | Geen Teams-, Graph-, webhook-, bot-, OAuth- of toewijzingsservice gevonden in de aangeleverde code |

De wallboardparser bevat geen afzonderlijke open/gesloten-status of veld voor een reeds uitgevoerde eerste reactie.
De bot kan dus alleen handelen op basis van de door die parser gevonden requests.
De prioriteitskolom uit de screenshot wordt door het bestaande model niet aangeleverd en is niet toegevoegd.

## Gedrag en expliciete keuzes

- Bevestigd: aanbieden aan iedereen in dezelfde supportgroepschat; vrijwillig oppakken.
- Implementatiekeuze: één kaart per request met **Ik pak deze op**, met de eerste Teams-inzending als claim.
  Een gewone tekstreactie of emoji wordt niet automatisch als claim beschouwd.
- Alleen recent waargenomen requests zonder ingevulde `assignee` worden aangeboden.
  Een ontbrekende behandelaarskolom levert in het bestaande model een lege waarde op; dat bewijst niet dat ServiceNext geen behandelaar heeft.
- Het nog niet gespecificeerde verzendmoment heeft **geen actieve standaard**.
  De gebruiker kiest direct bij detectie of vanaf de grootste bestaande `warnMinutes`-waarde.
  Dat laatste leest de bestaande deadline, ook bij een overschrijding, en berekent geen nieuwe SLA.
- Inschakelen omvat ook de huidige in aanmerking komende requests. Eén request per scan/alarmevent,
  met de vroegste bestaande deadline eerst. Er is geen round-robin-, aanwezigheids- of capaciteitsverdeling.
- Teams staat standaard uit. Automatische verzending vereist een workflowlink, verzendmoment,
  expliciete keuze voor één verzendende browser en toegang tot die workflowhost.
- Er is geen toewijzings-API in het project. De Teams-claim wordt daarom uitsluitend in Teams bevestigd;
  ServiceNext en bestaande alerts worden daardoor niet gewijzigd.

## Codewijzigingen

- Nieuw: `teams.js` voor kaarten, validatie en verzending; `teams-options.js` voor Teams-instellingen/status.
- `background.js`: laadt de module, geeft na ticketopslag de waargenomen ID's door,
  triggert de aparte verzender bij scans en het bestaande alarm, en handelt bedieningsacties vanuit de instellingen af.
- `options.html`: aparte Teams-sectie. De bestaande `options.js` en alertinstellingen zijn ongewijzigd.
- `manifest.json`: versie 3.1.0 en optionele Microsoft-workflowhostrechten. Er worden geen Graph-rechten aangevraagd.
- Ongewijzigd: `content.js`, `popup.js/html`, `offscreen.js/html`, iconen en de implementaties van
  `checkDeadlines()`, `notify()`, `buildUrl()` en de bestaande meldings-/snoozeafhandeling.

Nieuwe opslag gebruikt dezelfde `chrome.storage.local`, met eigen sleutels:

| Sleutel | Inhoud |
| --- | --- |
| `teamsSettings` | In-/uitschakelen, geheime webhooklink, verzendmoment en keuze voor één verzender |
| `teamsObservation` | Tijdstip en ID's van de laatste echte parseraanvoer; voorkomt gebruik van alleen de 90-secondenbewaarlijst |
| `teamsDispatch` | Per requestnummer gebeurtenis-ID, tijdstip en verzendstatus; geen extra klant-/onderwerpgegevens |
| `teamsIssue` | Leesbare configuratiefout, zonder geheime link |

## Afhandeling van fouten en grenzen

Een verzendpoging wordt vóór de netwerkactie duurzaam opgeslagen. Overlappende lokale pogingen worden
geserialiseerd. Bij een herstart tijdens het versturen, netwerkfout of timeout wordt de ontvangst onzeker;
er volgt geen automatische herhaling. Ook een afwijzing wordt zichtbaar en vraagt een handmatige herhaalactie.
Dat voorkomt automatische dubbele kaarten maar betekent dat mislukte afleveringen aandacht vereisen.

Een HTTP 2xx betekent **aangeboden aan de workflow**, geen bewijs van kaartplaatsing of acceptatie door een medewerker.
De Teams-flow verzorgt de eerste claim en zichtbare bevestiging. De extensie ontvangt die claim niet terug.
De knop werkt pas nadat de flow met de actie **Post adaptive card and wait for a response** is ingericht.

Er is geen gedeelde database tussen browserinstallaties. Gebruik één verzender. Een requestnummer wordt
blijvend onthouden, ook na verdwijnen, heropenen of wijzigen van de workflowlink. Het wissen van extensieopslag
of overstappen naar een andere installatie verliest die deduplicatie. De resetknop voor bestaande alerts wist
de aparte Teams-instellingen/historie niet.

Een reeds geplaatste kaart wordt niet bijgewerkt of ingetrokken bij een latere wallboardwijziging.
Geen vrije-tekstinterpretatie, automatische herverdeling, herinneringsbeleid of terugschrijven naar ServiceNext
is geïmplementeerd; hiervoor ontbreken nog expliciete regels en/of een bestaande service.

## Verificatie

Voer vanuit deze map uit: `node --test tests/teams.test.cjs` (Node.js 22 of nieuwer).
De tests gebruiken uitsluitend lokale mocks en sturen geen berichten naar Teams.
Ze controleren onder andere deduplicatie, herstart, gelijktijdige scans, versheid, behandelaarfilter,
deadline-instellingen, handmatig herhalen, ontbrekende rechten, fouten, timeout, geheimen en behoud van alerts.

De live Teams-keten kan pas worden geverifieerd met een ingerichte workflow in de eigen tenant.
Gebruik eerst de fictieve TEST-kaart, inclusief tweede inzending en bevestiging met de respondernaam,
voordat automatisch aanbieden wordt ingeschakeld.
