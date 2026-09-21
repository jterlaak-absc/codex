# Git voor de extensie

Deze map bevat de broncode van Rapid Response Alerter v3.1.9.
De lokale hoofdbranch heet main. Er is nog geen GitHub-repository gekoppeld.

## Wijzigingen bewaren

Open deze map als project in Codex. Bekijk de wijzigingen en maak een commit met een korte beschrijving.
Via een terminal kan dat ook:

```powershell
git status
git diff
git add .
git commit -m "Beschrijf de wijziging"
```

Een commit bewaart een lokale versie. Een push naar een gekoppelde GitHub-repository maakt ook een externe kopie.

Bewaar echte Teams-webhooklinks alleen in de extensie-instellingen, nooit in broncode of commits.
Controleer bestanden voor iedere commit; .gitignore herkent geen geheimen in broncode.

Deze repository bevat extensiecode, geen export van de live Power Automate-flow.

De map staat in OneDrive. Vermijd gelijktijdige Git-bewerkingen op meerdere computers; gebruik GitHub voor het uitwisselen van commits tussen computers.
