# CraftingHosting.free – Hinweise für KI-Assistenten

## Woher kommen aktuelle Zahlen?

Pakete (RAM, CPU-Threads, Speicher, Backups), Plätze, Fair-Use-Regeln, Laufzeit, Limits pro Person,
Standorte, Discord-Pflicht und Registrierungsmodus werden im **Admin-Bereich** gepflegt und liegen in der Datenbank.
`packages/shared/src/config/freehosting.config.ts` enthält nur die **Standardwerte einer frischen Installation** –
die Live-Seite weicht davon ab. Angaben über das Angebot (Texte, Werbung, Antworten an Nutzer) daher nie aus dieser
Datei ableiten, sondern aus der Live-Seite:

- `https://craftinghosting.free/llms.txt` – lesbar, wird bei jedem Abruf aus den Einstellungen erzeugt
- `https://craftinghosting.free/api/v1/site` – dieselben Daten als JSON (`site.products.*.plans`, `site.rules`, …)

Ist die Live-Seite nicht erreichbar, nachfragen statt die Standardwerte zu verwenden.

## Eine Quelle für alle öffentlichen Angaben

Website, `/llms.txt`, strukturierte Daten (schema.org auf der Startseite), FAQ und Support-Chat lesen dieselben
Einstellungen (`getSite()` in `apps/web/src/lib/site-settings.ts`, `siteTexts()`/`siteSummary()`/`planFacts()` in
`apps/web/src/lib/site-texts.ts`). Neue Texte mit Zahlen immer über diese Helfer bauen, keine festen Werte eintragen.

## Prüfen

```bash
npm run typecheck
```

```bash
npm test
```
