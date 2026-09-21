# Update 3.1.9 — verdwenen requests verwijderen

1. Pak de zip uit en kopieer de bestanden over de bestaande uitgepakte extensiemap.
2. Open `chrome://extensions` en klik bij Rapid Response Alerter op **Opnieuw laden**.
3. Ververs daarna het wallboard met **F5**. Dat verbindt de uitlezing opnieuw met de bijgewerkte extensie.
4. Open de extensie: alleen requests uit de laatste geslaagde scan horen daar te staan.

Een verdwenen request wordt bij de volgende geslaagde scan verwijderd; de oude wachttijd van 90 seconden is weg. Wijzigingen worden normaal na ongeveer 1,2 seconde verwerkt, met een periodieke scan om de 20 seconden als vangnet. Als het wallboard niet wordt uitgelezen, meldt de extensie na één minuut dat de gegevens niet actueel zijn. Dit is geen melding dat het wallboard leeg is.

Power Automate hoeft voor deze update niet te worden aangepast. Bestaande Teams-berichten worden door deze reparatie niet verwijderd.
