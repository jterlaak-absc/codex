# Subtiel groene bevestiging

Voor de Power Automate-stap **Adaptieve kaart bijwerken in chat of kanaal**. Laat **Bericht-id**, **Groepschat** en de plaatsingsinstellingen staan. Vervang alleen de inhoud van **Adaptieve kaart** door de JSON uit `BEVESTIGING-SUBTIEL-GROEN.json`.

Het resultaat blijft één compacte regel:

`✓ 02.967.790 · DZB Leiden · Opgepakt door Joost ter Laak`

De JSON leest het requestnummer rechtstreeks uit de binnengekomen kaart. In de getoonde bevestiging ontbrak het nummer (`✓ · Berg Hortimotive...`); controleer na het vervangen met een testrequest dat het nummer nu zichtbaar is. Als de flow niet binnen **For each** staat, moet de verwijzing `item()` aan de plaats van de kaart in jouw flow worden aangepast.

De tekst krijgt de themakleur **Good** met **isSubtle**. Teams kiest daardoor zelf de passende lichte of donkere variant. De voorbeeldkleur uit de afbeelding wordt niet als vaste hexkleur ingesteld; dat zou in een ander Teams-thema slecht leesbaar kunnen zijn.

Controleer met een testrequest dat Power Automate de `@{...}`-expressie omzet in echte waarden. Als de expressie letterlijk op de kaart verschijnt, voeg haar in het veld van de `TextRun` toe via het **fx-expressievenster** in plaats van de JSON als platte tekst te plakken. Sla de stroom daarna op en test opnieuw.

De kleur is alleen zichtbaar op **nieuwe of opnieuw bijgewerkte kaarten**. Een oudere bevestigingskaart wordt niet achteraf aangepast door een wijziging aan de stroom.
