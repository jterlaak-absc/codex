# Compacte Teams-kaart, versie 3.1.8

Een nieuw request verschijnt in vaste kolommen met vette tekst op normale grootte: **02.967.856 | Berg Hortimotive B.V. | 17-09-2026 10:16**, met **Pak op** rechts ervan. De verticale lijnen staan daardoor op dezelfde positie bij nieuwe kaarten. De kaart vraagt Teams om de volle beschikbare breedte, maar een groepschat blijft begrensd door de chatballon. Bij een smal venster of lange klantnaam kan de tekst alsnog over twee regels lopen.

## Eenmalige wijziging in Power Automate

Sinds versie 3.1.5 staat de knop naast de tekst. Als je die versie al gebruikt en **Requestnummer** al hebt aangepast, hoef je in Power Automate niets meer te wijzigen. Kom je van versie 3.1.4 of ouder, dan moet **Requestnummer** voortaan zijn waarde uit de verborgen kaartgegevens lezen. Open de flow **Verzond webhookwaarschuwingen naar#Supportteam** en kies binnen **For each** de paarse stap **Requestnummer**. Verwijder de oude expressie uit **Inputs** en voeg via **fx / Expressie** deze nieuwe toe:

```text
item()?['content']?['body']?[1]?['facts']?[0]?['value']
```

Als **Requestnummer** buiten **For each** staat, gebruik dan:

```text
first(triggerBody()?['attachments'])?['content']?['body']?[1]?['facts']?[0]?['value']
```

Sla de flow op. De expressie voor de klantnaam hoeft niet te veranderen: de verborgen `facts[1]` staat nog op dezelfde plaats.

## Extensie bijwerken

Pak `rapid-response-alerter-teams-v3.1.8.zip` uit. Kopieer de inhoud over de oude uitgepakte extensiemap, of laad de nieuwe map via `chrome://extensions` met **Uitgepakte extensie laden**. Klik bij de extensie op **Opnieuw laden**. Laat het wallboard open en stuur eerst de fictieve TEST-kaart vanuit de extensie-instellingen. Controleer of de grotere tekst leesbaar blijft, de kolommen uitgelijnd zijn, de knop rechts staat en de claim werkt. Deze versie vereist geen nieuwe wijziging in Power Automate als de flow voor v3.1.7 al is bijgewerkt.

Voor de groene bevestiging zonder punt na het vinkje: vervang in Power Automate, bij **Adaptieve kaart bijwerken in chat of kanaal**, de inhoud van **Adaptieve kaart** door [BEVESTIGING-SUBTIEL-GROEN.json](BEVESTIGING-SUBTIEL-GROEN.json). De extensie kan deze Power Automate-instelling niet zelf wijzigen. Controleer met een test dat ook het requestnummer weer wordt getoond.

Kaarten die al in Teams staan veranderen niet achteraf.
