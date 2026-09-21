# Compacte bevestiging in Teams

Voor een subtiel groene variant van de bevestiging, zie [BEVESTIGING-SUBTIEL-GROEN.md](BEVESTIGING-SUBTIEL-GROEN.md) en de bijbehorende JSON.

Versie 3.1.1 verkort de tekst van de aangeboden kaart. De standaardafsluiting van Power Automate wordt in de workflow gemaakt, niet door de extensie.

Gewenst eindresultaat: één kaart met `✓ Request TEST · Joost ter Laak`, zonder een tweede bevestigingsbericht.

Voeg binnen For each na de wachtactie **Adaptieve kaart bijwerken in chat of kanaal** toe.
Gebruik Flow-bot, Groepschat en dezelfde #Supportteam-chat. Kies de bericht-ID van de **wachtactie**, niet die van een andere plaatsingsactie.
Als alleen Hoofdtekst beschikbaar is, controleer in een geslaagde uitvoering de output van die wachtactie op `messageId` voordat je dat veld met een expressie invult.

Geef de updateactie een eigen Adaptive Card, met één TextBlock en zonder acties. Gebruik voor de tekst:

```
concat('✓ Request ', outputs('Requestnummer'), ' · ', body('Adaptieve_kaart_posten_en_wachten_op_een_antwoord')?['responder']?['displayName'])
```

Laat de bestaande bevestiging staan tot een test heeft aangetoond dat de juiste kaart wordt bijgewerkt, de naam klopt en de ongewenste standaardvoetregel verdwijnt. Verwijder daarna de aparte actie **Bericht posten in chat of kanaal** om dubbele bevestigingen te voorkomen.

Dit is nog niet in de live workflow uitgevoerd. Microsoft-documentatie bevestigt kaartbijwerking, maar garandeert niet expliciet het verdwijnen van de voetregel in alle Teams-clients. Controleer dat met een testkaart.

Bron: https://learn.microsoft.com/en-us/connectors/teams/#update-an-adaptive-card-in-a-chat-or-channel
