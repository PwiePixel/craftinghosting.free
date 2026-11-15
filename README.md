# CraftingHosting.free

**Free Minecraft & Discord Bot Hosting – A CraftingHosting Service.**

Die Website ist bewusst schlank: Sie erstellt kostenlose **Minecraft-Server** und **Discord-Bot-Server** (Python / Node.js) und kümmert sich im Hintergrund um alles Automatische (Fair-Use, 30-Tage-Laufzeit, Suspendierung). **Gespielt und verwaltet wird ausschließlich im Pterodactyl-Panel** von Crafting Hosting – Konsole, Dateien, Plugins, Backups, Start/Stopp. AriX Theme und Addons bleiben unberührt, weil nur die offizielle API genutzt wird.

Die Seite ist **zweisprachig**: Englisch ist Standard unter `craftinghosting.free/…` (z. B. `/my-servers`), Deutsch liegt unter `craftinghosting.free/de/…` mit deutschen Pfaden (z. B. `/de/meine-server`) und ist über den Sprachumschalter erreichbar; die Wahl wird gemerkt. Alte Links (`/en/…`, deutsche Pfade ohne `/de`) werden dauerhaft weitergeleitet. E-Mails, Chat-Hinweise und die Serverbeschreibung im Panel kommen in der Sprache, die der Nutzer zuletzt auf der Website verwendet hat. Standorte und Hardware-Angaben (Standard: Deutschland, Dual Intel Xeon Gold 6230) pflegst du im Admin-Bereich, das Panel liegt unter `panel.craftinghosting.free`.

Screenshots (Mock-Modus): [`docs/screenshots/`](docs/screenshots/)

---

## Installation in einem Befehl

```bash
git clone https://github.com/PwiePixel/craftinghosting.free.git && cd craftinghosting.free && sudo bash install.sh
```

Das Skript fragt nur Domain, Panel-Adresse, die zwei Pterodactyl-API-Keys und die Admin-E-Mail ab – Details in [`docs/DEBIAN-13.md`](docs/DEBIAN-13.md). Die Website läuft auf einem eigenen Server und spricht per API mit dem Panel-Server.

## Auf `main` veröffentlichen

Die Entwicklung liegt auf dem Branch `claude/adoring-mendel-nrzvan`. So wird daraus `main`:

```bash
git fetch origin
```

```bash
git push origin origin/claude/adoring-mendel-nrzvan:refs/heads/main
```

Danach auf GitHub unter *Settings → General → Default branch* `main` auswählen. Der Installer und `chfree update` nutzen dann automatisch `main`. Gibt es `main` schon mit eigenem Inhalt, stattdessen auf GitHub einen Pull Request vom Branch nach `main` öffnen und zusammenführen.

## Beta-Instanz

Eine zweite Website unter `beta.<domain>` zum Testen neuer Versionen – **mit derselben Datenbank** wie die Hauptseite:

```bash
sudo bash install.sh --beta
```

| | |
| --- | --- |
| **Wer kommt hinein?** | Nur Nutzer mit Beta-Zugang: Admin → *Nutzer* → „Beta-Zugang geben“ (Admins immer). Die Freigabe steht in der Datenbank (`users.beta`). |
| **Alle anderen** | sehen auf der Beta bei **jeder** Adresse „Du bist nicht im Beta-Programm“ (Status 403). Anmelden oder Registrieren geht dort nicht; die Beta-API beantwortet ihre Anfragen mit 403. |
| **Der Weg hinein** | Auf der Hauptseite anmelden → „Meine Server“ → Karte „Beta-Programm“ → bestätigen. Die API prüft die Freigabe und stellt ein Einmal-Ticket aus (signiert, 2 Minuten gültig); die Beta-Instanz prüft Ticket **und Freigabe erneut** und legt erst dann eine eigene Sitzung an. |
| **Entzug** | wirkt sofort – die Beta prüft die Freigabe bei jeder Anfrage. |
| **Technik** | Eigener Ordner (`/opt/craftinghosting-free-beta`), eigene Dienste `chfree-beta-api` / `chfree-beta-web` (Ports 4100/3100), kein Worker – Jobs laufen nur auf der Hauptseite. Nie in Suchmaschinen. |
| **Andere Version testen** | Im Checkout mit der neuen Version `sudo bash install.sh update --beta` ausführen. Braucht sie neue Tabellen: `--migrate` anhängen (Backup vorher; die Änderung gilt wegen der gemeinsamen Datenbank auch für die Hauptseite). |
| **Entfernen** | `sudo bash install.sh uninstall --beta` – Datenbank und Hauptseite bleiben unberührt. |

Weil Beta und Hauptseite dieselben Daten nutzen, sind Änderungen der Tester echt (Server erstellen, löschen …).

## Logo

Admin → *Einstellungen* → **Logo**: PNG, JPG, WebP oder SVG bis 512 KB hochladen. Es ersetzt wahlweise nur den Würfel (Schriftzug bleibt) oder Würfel und Schriftzug, und erscheint in Kopf- und Fußzeile – auch auf der Beta-Instanz. Die Datei liegt in der verschlüsselten Datenbank; SVGs mit Skripten werden abgelehnt.

## Domains und HTTPS

| Weg | Wann | Was du tust |
| --- | --- | --- |
| **Direkt (DNS)** | Domain bei beliebigem Anbieter | Admin → *Domains* → Domain hinzufügen, beim Anbieter einen A-Eintrag auf die Server-IP setzen (wird dort angezeigt). Caddy holt das Zertifikat beim ersten Aufruf und verlängert es selbst. Caddy fragt vorher die API, ob die Domain eingetragen ist (`/api/v1/internal/tls-check`) – fremde Domains bekommen kein Zertifikat. |
| **Cloudflare Tunnel** | Domain liegt bei Cloudflare, keine offenen Ports gewünscht | Einmal `sudo bash install.sh tunnel` (installiert `cloudflared` + Dienst). Dann Admin → *Domains* → „Link zum Freigeben erzeugen“, Link öffnen, Domain auswählen, „Tunnel einrichten“. Tunnel, DNS-Eintrag und Zertifikat entstehen automatisch. |

Weitere Domains leiten standardmäßig auf die Hauptdomain weiter (gut für Suchmaschinen). Die Hauptdomain selbst änderst du mit `chfree reconfigure`. Der Tunnel-Weg gilt für die Installation mit `install.sh` (nicht für Docker).

## Was neu ist

| Bereich | Kurz erklärt |
| --- | --- |
| **Eigene Pakete** | Admin → Einstellungen → *Produkte & Pakete*: Pakete anlegen, ändern, sortieren, deaktivieren (Minecraft bis 12, Discord-Bots bis 4). RAM, CPU, Speicher, Backups, Datenbanken, Ports, Plätze je Paket. „bis X GB RAM“ auf der Startseite richtet sich automatisch nach dem größten aktiven Paket. |
| **Kapazität** | Je Produkt eine Obergrenze (Standard: 500 Minecraft-Server + 200 Discord-Bots), zusätzlich optional je Paket. Die Website zeigt „Noch 412 von 500 Plätzen frei“. |
| **Discord-Bot-Hosting** | Zweites Produkt mit eigenen Paketen, Laufzeit **Python** oder **Node.js**, eigene Node, eigene Nutzungsbedingungen unter `/discord-bot/terms-of-use` · `/de/discord-bot/nutzungsbedingungen`. Pro Person gilt das Server-Limit je Produkt (z. B. ein Minecraft-Server und ein Bot). |
| **Pterodactyl automatisch** | Admin → *Pterodactyl* liest Nodes (mit freien Ports) und alle Eggs aus dem Panel. Dort wählst du die Nodes für Minecraft, die Node für Discord-Bots und die Eggs je Servertyp (Vorschläge per Klick). Discord-Bots werden **nur** auf ihrer Node erstellt, Minecraft-Server nie darauf. |
| **Fair-Use für Discord-Bots** | Bots laufen durchgehend. Stattdessen: CPU-Dauerlast-Regel (Vorwarnung → Stopp + Pause), Verwarnungen (→ Sperre) und Freigabe inaktiver Plätze. Alle Werte im Admin einstellbar, die Nutzungsbedingungen übernehmen sie automatisch. |
| **Alle Server auf einmal** | Admin → *Server* → „Alle Server …“: alle sperren, Sperren aufheben oder alle löschen – wahlweise nur ein Produkt. Admin-Konten sind immer ausgenommen, weitere Konten per E-Mail-Liste. Mit Vorschau und Bestätigungswort. |
| **Standorte & Hardware** | Admin → Einstellungen → *Hardware & Standorte*: erscheint auf der Startseite, in FAQ und Rechtstexten. |
| **Spenden** | Admin → Einstellungen → *Spenden*: SumUp-Zahlungslink eintragen → Seite `/donate` · `/de/spenden` und Link „Spenden“ im Header. |
| **Verschlüsselung** | Datenbank ist eine verschlüsselte SQLite-Datei; IP-Adressen und Browser-Kennungen sind darin zusätzlich einzeln verschlüsselt (AES-256-GCM). |
| **Cookie-Hinweis** | Kurzer Hinweis mit „Verstanden“; die Bestätigung wird mit Zeitpunkt und verschlüsselter IP protokolliert (90 Tage). |
| **Domains** | Admin → *Domains*: weitere Domains eintragen (mit Weiterleitung auf die Hauptdomain oder als eigene Adresse). HTTPS kommt automatisch – per DNS-Eintrag (Caddy holt das Zertifikat beim ersten Aufruf) oder per **Cloudflare Tunnel** (Link zum Freigeben der Domain, Tunnel + DNS entstehen von selbst). |
| **Newsletter** | Anmeldung mit Bestätigungslink (Formular im Footer, Seite `/newsletter`, Häkchen im Bestellformular), Abmeldung per Link. Admin → *Newsletter*: Ausgaben schreiben (DE/EN), Testmail, Versand mit Fortschritt, Abonnenten verwalten, CSV-Export. Auch betriebliche Hinweise an alle Konten. |
| **Alles einstellbar** | Admin → *Einstellungen*: Fair-Use-Werte und Laufzeit (früher fest im Code), Minecraft-Versionen, Links & Kontakt, Hinweisleiste, Sperrliste für E-Mail-Adressen/-Domains (inkl. Wegwerf-Anbieter), Titel/Beschreibung für Suchmaschinen. Texte, Nutzungsbedingungen, E-Mails und Jobs übernehmen die Werte sofort. |
| **Suchmaschinen & KI** | `/llms.txt` beschreibt das Angebot sachlich für KI-Assistenten – erzeugt aus denselben Einstellungen wie die Website (Pakete, Plätze, Regeln, Standorte), dazu strukturierte Daten (schema.org) und eine `robots.txt`, die KI-Crawler ausdrücklich zulässt. So gibt es keine widersprüchlichen Angaben. |
| **CSV-Export** | Nutzer, Server und Newsletter-Abonnenten als CSV (Admin → *Nutzer* / *Server* / *Newsletter*). |

### Fair-Use-System für Discord-Bots

| Regel | Standard | Was passiert |
| --- | --- | --- |
| CPU-Dauerlast | über 90 % des Paket-Limits für 30 min am Stück | nach 15 min Vorwarnung per E-Mail, nach 30 min Stopp und 30 min Pause (Starts in der Pause werden rückgängig gemacht) |
| Verwarnungen | 3 Stopps in 7 Tagen | Bot wird gesperrt (Grund „abuse“), Entsperren im Admin unter *Server* |
| Inaktivität | 7 Tage am Stück offline | Erinnerung 2 Tage vorher, dann endet die Laufzeit vorzeitig (suspendiert, reaktivierbar wie nach 30 Tagen) |
| Laufzeit | 30 Tage | wie bei Minecraft: verlängern unter „Meine Server“ |

Geprüft wird jede Minute im Job `sync-power-states` (`apps/api/src/services/bot-fair-use.ts`). Das klassische Fair-Use-System (24 h am Stück, Wochen-Offline-Zeit) gilt für Minecraft und lässt sich für Bots zusätzlich einschalten.

---

## So funktioniert es für Nutzer

1. **craftinghosting.free/start** – Minecraft-Server oder Discord-Bot wählen, dann Paket, Servertyp bzw. Laufzeit, Servername und E-Mail angeben (im Early-Access-Modus: „Platz sichern“ → Warteliste, siehe unten)
2. **E-Mail-Link klicken** – bestätigt die Adresse und meldet an (die Website hat keine eigenen Passwörter)
3. **Panel-Zugang festlegen** – Benutzername + Passwort werden direkt an Pterodactyl übergeben (nicht gespeichert). Bestehende Crafting-Hosting-Kunden mit gleicher E-Mail werden automatisch mit ihrem vorhandenen Panel-Konto verknüpft.
4. **Server wird automatisch angelegt** → E-Mail „Server bereit“ mit Link ins Panel
5. **Im Panel spielen** – alles Weitere läuft automatisch
6. Nach 30 Tagen + 1 Ruhetag: **Meine Server** (Anmeldung per E-Mail-Link) → „Reaktivieren“. Ohne Reaktivierung wird der Server 48 h nach dem Ruhetag gelöscht (Erinnerung 24 h vorher).

## Was automatisch passiert (sichtbar im Panel)

| Ereignis | Was der Nutzer sieht |
| --- | --- |
| 30, 10, 1 Minute vor einem automatischen Stopp | Hinweis im Minecraft-Chat/Konsole (`say [CraftingHosting.free] …`) |
| 24 h am Stück erreicht | Stopp + 60 min Pause, Serverbeschreibung im Panel: „Fair-Use-Pause bis …“ |
| Start im Panel während einer Pause | wird erkannt und automatisch wieder gestoppt (mit Chat-Hinweis) |
| Wöchentliche Offline-Zeit wird knapp | rechtzeitiger Stopp bis Wochenende, E-Mail + Beschreibung im Panel |
| 3 Tage / 1 Tag vor Ablauf der 30 Tage | E-Mail-Erinnerung |
| 60, 10, 1 Minute vor Ablauf | Chat-Hinweis mit Link zum Verlängern |
| Ablauf | Stopp → Info-E-Mail → Suspendierung im Panel, Beschreibung „30 Tage abgelaufen · 1 Ruhetag – reaktivierbar ab …“ |
| Ruhetag vorbei (24 h nach Suspendierung) | E-Mail „kann wieder reaktiviert werden“ mit Löschtermin, Beschreibung „reaktivieren bis … – sonst gelöscht“ |
| 24 h vor der Löschung | E-Mail-Erinnerung |
| 48 h nach dem Ruhetag ohne Reaktivierung | Server samt Welt und Backups gelöscht, Info-E-Mail (pausiert während der Wartung und 24 h danach) |
| Normalbetrieb | Beschreibung im Panel: „CraftingHosting.free · aktiv bis 29.10.2026 · max. 24 h am Stück …“ |

---

## Admin-Bereich

Liegt unter **`/admin`** (deutsch `/de/admin`) – nirgends verlinkt, nicht in `robots.txt` oder der Sitemap, per `X-Robots-Tag` und Meta-Tag auf `noindex`. **Erreichbar ist er nur für angemeldete Admins** (Rolle im Backend bzw. `ADMIN_EMAILS`). Alle anderen – auch nicht angemeldete Besucher und angemeldete Nutzer ohne Admin-Rechte – bekommen dieselbe 404-Seite wie bei jeder unbekannten Adresse; es gibt keinen Login-Hinweis und keine Weiterleitung. Geprüft wird das schon vor dem Rendern (in `apps/web/src/proxy.ts`) und zusätzlich in der API (alle `/admin/*`-Endpunkte antworten für Nicht-Admins mit 404). Optional lässt sich über `ADMIN_PATH` ein zusätzlicher eigener Pfad festlegen.

Anmeldung wie gewohnt per E-Mail-Link (`/login`), danach `/admin` aufrufen. Zugriff haben Konten mit Adresse in `ADMIN_EMAILS` oder nach `node dist/cli.js make-admin du@example.com`.

- **Übersicht:** Website-Zustand (Wartung, Registrierungsmodus, Warteliste) mit Wartungs-Schnellschalter, Nutzer, Server nach Status, Pakete, E-Mail-Warteschlange, Pterodactyl-/SMTP-Einstellungen, Zustand aller Jobs (mit „Jetzt ausführen“) – Warnung, wenn der Worker nicht läuft
- **Einstellungen:** Wartungsmodus (Hinweis DE/EN, voraussichtliches Ende), Registrierung *Offen / Vorregistrierung / Geschlossen*, kostenlose Server pro Person, **Kapazität je Paket** (maximale Plätze + außerhalb belegte Plätze → auf der Website „Noch 12 von 100 Plätzen frei“ bzw. „Ausgebucht“), EPYC-Plätze gesamt und davon außerhalb belegt, Anmeldungen außerhalb der Website, Zahlen auf der Startseite (automatisch + Zusatz oder fester Wert). Wirkt nach wenigen Sekunden – kein Neustart nötig.
- **Warteliste:** Plätze mit Rang und Hardware (EPYC/Xeon), 50 pro Seite mit Blättern, „Die nächsten N freischalten“, Auswahl freischalten, Einträge entfernen, **Personen hinzufügen** (E-Mail-Liste von Vormerkungen aus dem alten System/Discord – auf Wunsch vor allen anderen eingereiht, mit Info-Mail) und **Vormerkungen als Anzahl** mit „+ / −“ (siehe unten)
- **Statusseite:** Meldungen anlegen (Störung, Wartung, Hinweis; DE/EN; Beginn/Ende – in der Zukunft = geplante Wartung), bearbeiten, beenden, löschen. Darunter **„Statusseite gestalten“** – alles, was die Statusseite zeigt, ist einstellbar:
  - *Darstellung:* Überschrift, Einleitung, Zeitraum des Verlaufs (7–90 Tage), Banner, Tagesbalken, Prozentzahl, Legende, Antwortzeit, vergangene Meldungen, Link zur Statusseite des Hauptanbieters
  - *Zustände:* Text, Banner-Text und Farbe für Betriebsbereit / Eingeschränkt / Geplante Wartung / Ausfall (DE/EN) sowie die Farbe für Tage ohne Messdaten
  - *Gruppen:* beliebige Karten (z. B. „Netzwerk“, „Game-Nodes“) mit Name, Symbol und Reihenfolge
  - *Komponenten:* Name, Unterzeile, Gruppe, Reihenfolge, Sichtbarkeit, eigener Text für „Betriebsbereit“ (z. B. „Aktiv“) und die **Prüfung**: FreeHosting gesamt, Website, API & Datenbank, Pterodactyl Panel, alle Nodes, ein bestimmter Node (Wartungsmodus aus dem Panel + direkter Ping auf Wings), eigene Adresse (HTTP-Check) oder manuell. Ein fester Status (Automatisch / Betriebsbereit / Eingeschränkt / Teilausfall / Ausfall / Wartung) hat immer Vorrang
  - *Verlauf korrigieren:* einzelne Tage je Komponente von Hand festlegen (Fehlalarm ausbessern, Ausfall nachtragen)
- **Server:** 50 pro Seite mit Blättern, Suche/Filter, Link ins Pterodactyl-Admin, Aktionen: +30 Tage, Pause aufheben, Sperren/Entsperren, Einrichtung erneut versuchen, Löschen
- **Nutzer:** 50 pro Seite, Suche und Filter (E-Mail unbestätigt, ohne Server, auf der Warteliste, gesperrt, Admins), Panel-Konto, Sperren/Entsperren, Admin-Rechte und **Konten löschen**: einzeln, per Häkchen (Umschalt + Klick für ganze Bereiche, „alle auf dieser Seite“), **alle Treffer** von Suche/Filter über alle Seiten (Bestätigung mit „LÖSCHEN“, Fortschrittsanzeige) oder per eingefügter E-Mail-Liste. Gelöscht werden das Website-Konto und die kostenlosen Server; das Pterodactyl-Konto bleibt (dort können bezahlte Server liegen). Admins und das eigene Konto werden nie gelöscht.
- **Protokoll:** komplettes Audit-Log (Nutzer, System, Admin), 50 pro Seite
- **E-Mails:** Testmail senden, fehlgeschlagene/ausstehende Mails mit Fehlergrund

## Wartungsmodus

Im Admin unter *Einstellungen* oder mit dem Schnellschalter in der Übersicht. Besucher sehen dann eine eigene Wartungsseite (EN/DE, eigener Hinweis, voraussichtliches Ende, Discord-Button, „Anmelden“ im Header, lädt sich selbst neu, sobald die Wartung vorbei ist). **Anmelden bleibt möglich**: Login, E-Mail-Link und „Meine Server“ funktionieren (mit Hinweis auf die Wartung), ebenso Statusseite und Rechtstexte – gesperrt ist nur das Registrieren bzw. Anfordern neuer Server (Startseite, FAQ und `/start` zeigen die Wartungsseite). **Admins sehen die Website normal**. Die API lehnt Registrieren, Erstellen, Reaktivieren und Löschen durch Nutzer ab. Automatische Löschungen pausieren während der Wartung und 24 h danach. Die Statusseite zeigt „Wartung“ für alle Komponenten mit der Prüfung „FreeHosting gesamt“ oder „Website“.

## Vorregistrierung (Early Access)

> Standard seit dem Umstieg auf nur eine Hardware (Intel Xeon): **0 EPYC-Plätze**. Dann gibt es eine einzige Warteschlange und öffentlich wird nichts zu EPYC angezeigt. Die EPYC/Xeon-Stufen unten gelten nur, wenn du im Admin wieder EPYC-Plätze einträgst.

Für die erste Startphase: Registrierung auf *Vorregistrierung* stellen. Nutzer sichern sich über `/start` einen Platz (ein Platz pro Person); mit der E-Mail-Bestätigung bekommen sie ihre fortlaufende Nummer. Die ersten *N* Plätze (Admin → „Plätze auf AMD EPYC“) laufen auf dem EPYC, alle weiteren auf den Xeons – die Zuordnung zu Pterodactyl-Locations erfolgt über `PTERODACTYL_LOCATION_IDS_EPYC` / `_XEON`. Verlässt jemand die Warteliste, rücken die anderen nach.

Wer sich schon vorher eingetragen hat (altes System, Discord …), wird im Admin unter *Warteliste → Personen hinzufügen* übernommen: eine E-Mail-Adresse pro Zeile (optional `, Servername`), Paket/Servertyp wählen, optional „Vor allen bisherigen Einträgen einreihen“. Fehlende Konten werden angelegt, die Personen bekommen eine E-Mail mit ihrem reservierten Platz und melden sich später einfach per E-Mail-Link an. Wer schon einen Server oder Platz hat, wird übersprungen.

Freischalten im Admin (*Warteliste*) beachtet die Paket-Kapazität – ist ein Paket voll, bleiben die Einträge auf der Warteliste. Nutzer mit Panel-Zugang bekommen den Server sofort, alle anderen eine E-Mail und legen den Zugang unter „Meine Server“ fest (danach wird der Server sofort erstellt). Die 30 Tage beginnen mit der Freischaltung. Startseite, Start-Seite, FAQ und Rechtstexte passen sich automatisch an (Hinweis „… auf der Warteliste“, freie EPYC-Plätze, Early-Access-Frage in den FAQ).

Nach der Phase: Modus auf *Offen* und z. B. „Kostenlose Server pro Person“ auf 2 stellen.

**Vormerkungen als Anzahl („+ / −“):** Wer nur als Zahl vorliegt (z. B. 890 Kunden im alten System), wird im Admin unter *Warteliste* mit „+“ als **Block** hinten an die Warteschlange gehängt. Der Block belegt echte Plätze (auch EPYC-Plätze): Bei 23 bisherigen Anmeldungen und +890 bekommt die nächste Anmeldung Platz **#914**. Ein weiteres „+50“ hängt wieder hinten an, wer danach kommt, reiht sich dahinter ein. „−“ nimmt die zuletzt hinzugefügten Plätze zurück, alle Nachfolgenden rücken auf. Frühere Anmeldungen behalten ihren Platz. In der Admin-Liste stehen die Blöcke an ihrer Stelle, z. B. „#24 – #913 · 890 Vormerkungen“.

**Zahlen auf der Startseite und Warteliste:** Alle Zahlen kommen aus der Datenbank. Für echte Nutzer, Server und Vormerkungen, die (noch) nicht über diese Website laufen – z. B. Kunden aus dem alten System, die nicht alles neu anlegen sollen, oder Anmeldungen per Discord – gibt es im Admin jeweils einen **Zusatz**. Er ist für echte Zahlen gedacht: Frei erfundene Nutzer- oder Wartelistenzahlen wären irreführende Werbung gegenüber Verbrauchern (UWG) und würden die Warteliste bei jedem Freischalten unglaubwürdig machen.

## Architektur

```
 Browser ──► craftinghosting.free (Caddy/nginx, HTTPS)
               ├── /            ──► apps/web   Next.js 16 · Tailwind 4
               │                    Landingpage, /start, /verify, /login, /meine-server
               └── /api/v1/*    ──► apps/api   Fastify 5 · Drizzle ORM · SQLite (verschlüsselt, libSQL)
                                        └──► Pterodactyl Application- & Client-API (nur serverseitig)

               apps/api worker ──► Jobs: Power-Sync, Fair-Use, 30-Tage-Zyklus, Panel-Status,
                                   Provisionierung, E-Mail-Outbox, Aufräumen

 packages/shared ──► zentrale Konfiguration, Fair-Use-Regeln (reine, getestete Funktionen), Schemas
```

| Ordner/Datei | Inhalt |
| --- | --- |
| `packages/shared/src/config/freehosting.config.ts` | Grundkonfiguration: **Standard**-Pakete, Fair-Use, 30 Tage, Limits, Servertypen, Branding (Pakete, Kapazität, Standorte ändert man im Admin-Bereich) |
| `packages/shared/src/settings.ts` | Einstellungen aus dem Admin-Bereich: Prüfung und Standardwerte (Pakete, Produkte, Hardware, Spenden, Bot-Fair-Use) |
| `apps/api/src/services/bot-fair-use.ts` | Fair-Use-System für Discord-Bots |
| `install.sh` | Installer/Updater für Debian und Ubuntu |
| `packages/shared/src/rules/` | Fair-Use- & Zyklus-Logik (inkl. Sommerzeit-Tests) |
| `apps/api/src/config/pterodactyl.config.ts` | Egg-Zuordnung, Backup-Zeitplan |
| `apps/api/src/services/panel.ts` | Status-Text im Panel + Chat-Hinweise |
| `apps/api/src/jobs/` | Idempotente Worker-Jobs mit Lease-Locks |
| `packages/shared/src/i18n.ts` | Sprachen, Pfade je Sprache (`/my-servers` ↔ `/de/meine-server`), Validierungsmeldungen |
| `apps/web/src/i18n/dictionaries/` | Alle Website-Texte: `de.ts` und `en.ts` (TypeScript prüft, dass beide vollständig sind) |
| `apps/web/src/content/legal/` | Rechtstexte DE/EN, Anbieterangaben für Impressum/Datenschutz in `operator.ts` |
| `apps/web/src/app/[lang]/(site)/` | Seiten der Website (intern `de`/`en`, `src/proxy.ts` übersetzt die öffentlichen Pfade) |
| `apps/web/src/app/globals.css` | Design-Tokens (Farbwelt von crafting.host) |
| `deploy/` | Caddyfile, nginx-Beispiel, systemd-Units |

---

## Schnellstart (lokal, ohne Panel)

Voraussetzungen: Node.js ≥ 20.9 – keine Datenbank nötig (SQLite-Datei unter `data/chfree.db`).

```bash
cp .env.example .env              # PTERODACTYL_MODE=mock, Jobs laufen im API-Prozess
npm install
npm run db:migrate
npm run dev                       # Web: http://localhost:3000 · API: http://localhost:4000
```

Im Mock-Modus gibt es drei simulierte Nodes und Eggs für Paper, Vanilla, Forge, Purpur, Fabric, Python und Node.js – damit lässt sich Admin → *Pterodactyl* ohne echtes Panel ausprobieren.

Ohne `SMTP_HOST` erscheinen E-Mails (inkl. Bestätigungslink) in der Konsole der API. Im Mock-Modus wird Pterodactyl simuliert; Chat-Hinweise und Panel-Beschreibungen landen in `apps/api/.pterodactyl-mock.json`.

```bash
npm test                                   # Unit-Tests der Fair-Use-/Zyklus-Regeln
npm run typecheck
npm run cli -w @chfree/api -- jobs         # Jobs auflisten
npm run cli -w @chfree/api -- run all      # alle Jobs einmalig ausführen
```

---

## Konfiguration

**Produktregeln** – `packages/shared/src/config/freehosting.config.ts`: Pakete (RAM, CPU, Disk, Backups, Kapazität), Fair-Use (24 h am Stück, Pause, 2 h/Woche offline, Warnungen, Zeitzone), 30-Tage-Zyklus (Erinnerungen, Ruhetag vor der Reaktivierung, max. Reaktivierungen), Limits, Servertypen & Versionen, Hardware, Links. Website, FAQ, Nutzungsbedingungen, Chat-Texte und Panel-Beschreibungen übernehmen die Werte automatisch.

**Umgebung** – `.env` (siehe kommentierte `.env.example`). Secrets (DB, Pterodactyl-Keys, SMTP) liest nur API/Worker. Wichtig: `APP_URL` (erscheint in Chat-Hinweisen und E-Mails), `PTERODACTYL_PUBLIC_URL` und `NEXT_PUBLIC_PANEL_URL` (Panel-Links).

---

## Pterodactyl anbinden

1. **Application-API-Key** (`ptla_…`): Users R/W, Servers R/W, Nests R, Nodes R, Locations R, Allocations R → `PTERODACTYL_APP_KEY`
2. **Client-API-Key** eines Admin-Accounts (`ptlc_…`) – für Stopps, Ressourcen, Chat-Hinweise (`/command`), Backup-Zeitplan → `PTERODACTYL_CLIENT_KEY`
3. **Nodes** im Admin unter *Pterodactyl* zuweisen: Nodes für Minecraft und die eigene Node für Discord-Bots (Nodes brauchen freie Allokationen). `PTERODACTYL_LOCATION_IDS` ist nur noch ein optionaler Rückfall.
4. **Eggs** im Admin unter *Pterodactyl* wählen – alle Eggs des Panels werden erkannt, passende vorgeschlagen. Für Discord-Bots ein Python- und ein Node.js-Egg importieren (z. B. „generic python“ / „generic nodejs“ aus github.com/pelican-eggs). Ohne Egg zeigt die Website „bald“. Die `.env`-Variablen `PTERODACTYL_EGG_*` bleiben als Alternative.
5. `PTERODACTYL_MODE=live`, `PTERODACTYL_URL`, `PTERODACTYL_PUBLIC_URL` setzen

Panel-Konten bekommen `external_id = chf-user-<id>`, Server `chf-server-<id>` – dadurch entstehen bei Wiederholungen keine Duplikate. Die Serverbeschreibung wird über `PATCH /servers/{id}/details` gesetzt (Name und Besitzer bleiben unverändert, auch wenn der Nutzer den Server im Panel umbenennt).

---

## Automatisierte Jobs

Worker: `node dist/worker.js` (Produktion) bzw. `RUN_JOBS_IN_API=true` (Entwicklung).

| Job | Intervall | Aufgabe |
| --- | --- | --- |
| `sync-power-states` | 60 s | Zustand aus dem Panel lesen, Laufzeit-Sessions führen, Suspendierung abgleichen, Nacharbeiten nach Installation, **Fair-Use für Discord-Bots** (CPU-Dauerlast, Inaktivität) |
| `enforce-fair-use` | 60 s | Chat-Warnungen, 24-h-Limit, Wochen-Offline-Zeit, Pausen-Verstöße |
| `cycle-lifecycle` | 60 s | Erinnerungen, Chat-Hinweise, Ablauf → Stopp → Info → Suspendierung → Löschung 48 h nach dem Ruhetag |
| `status-history` | 5 min | Status aller Komponenten speichern (Grundlage für die Tagesbalken und die Uptime der Statusseite) |
| `sync-panel` | 2 min | Status-Text in der Serverbeschreibung aktuell halten |
| `provisioning-retry` | 2 min | fehlgeschlagene Anlagen mit Backoff wiederholen |
| `notification-emails` | 30 s | E-Mail-Outbox mit Wiederholungen |
| `newsletter-send` | 30 s | Newsletter-Ausgaben in Portionen versenden (Höchstzahl pro Minute im Admin einstellbar) |
| `cleanup` | 1 h | abgelaufene Sessions/Links, nie bestätigte Anfragen (nach 3 Tagen), offene Anfragen ohne Panel-Zugang (14 Tage), alte Protokolle und Status-Verlauf (90 Tage) |

**Idempotenz:** Lease-Locks pro Job (mehrere Worker möglich), bedingte UPDATEs für jeden Zustandswechsel, Dedupe-Keys für E-Mails und Chat-Hinweise (jeder Hinweis genau einmal), Laufzeiten werden aus Fakten berechnet statt hochgezählt, `external_id` bei Pterodactyl. Die Datenbank ist die Quelle der Wahrheit – Abweichungen im Panel (z. B. manuelles Entsperren) werden automatisch korrigiert.

---

## API

Basis `/api/v1`. Zustandsändernde Anfragen brauchen den Header `X-CHF-Client: web`.

| Methode | Pfad | Zweck |
| --- | --- | --- |
| POST | `/start` | Server anfordern (E-Mail + Konfiguration) → Bestätigungslink |
| POST | `/auth/login-link` | Anmeldelink anfordern (Antwort immer gleich) |
| POST | `/auth/verify` | E-Mail-Link einlösen → Session + nächster Schritt |
| POST | `/panel/setup` | Panel-Konto anlegen, wartende Server erstellen |
| GET | `/auth/me` · POST `/auth/logout` · POST `/account/delete` | Konto |
| GET/POST | `/servers` | eigene Server / weiteren Server (angemeldet) |
| POST | `/servers/:id/reactivate` · `/servers/:id/delete` | Reaktivieren / Löschen |
| GET | `/meta` · `/site` · `/status` · `/health` | Pakete & Verfügbarkeit, öffentliche Einstellungen + Zahlen, Netzwerkstatus (inkl. Meldungen und Uptime), Liveness |
| GET | `/admin/overview` · `/admin/servers` · `/admin/users` · `/admin/audit` · `/admin/mails` | Admin: Übersicht und Listen (nur Admins, sonst 404) |
| POST | `/admin/servers/:id/{extend,clear-pause,suspend,unsuspend,retry,delete}` · `/admin/users/:id/{lock,unlock,make-admin,remove-admin}` · `/admin/jobs/:name/run` · `/admin/mail-test` | Admin-Aktionen (alle im Audit-Log) |
| GET/POST | `/admin/settings` | Einstellungen (Wartung, Registrierung, Produkte & Pakete, Hardware, Spenden, Bot-Fair-Use, Warteliste, Zahlen, Statusseite: Gruppen, Komponenten, Texte, Farben, Verlauf) |
| GET | `/admin/panel` | Pterodactyl: Verbindung, Nodes mit freien Ports, alle Eggs, Vorschläge je Servertyp |
| POST | `/admin/servers/bulk` | Alle Server sperren / entsperren / löschen (in Runden, mit `dryRun`-Vorschau und Ausnahmen) |
| POST | `/consent` | Bestätigung des Cookie-Hinweises protokollieren |
| POST | `/newsletter/subscribe` · `/newsletter/confirm` · `/newsletter/unsubscribe` | Newsletter: anmelden (Double-Opt-in), bestätigen, abmelden |
| GET/POST | `/admin/newsletter` · `/admin/newsletter/subscribers` · `/admin/newsletter/campaigns[/:id[/{test,send,cancel,delete}]]` | Newsletter im Admin: Übersicht, Abonnenten, Ausgaben |
| GET/POST | `/admin/domains` · `/admin/domains/{update,remove}` | Weitere Domains mit DNS-/HTTPS-Prüfung |
| GET/POST | `/admin/tunnel` · `/admin/tunnel/{login,setup,restart,disconnect}` | Cloudflare Tunnel: Freigabe-Link, Einrichten, Neustart, Trennen |
| GET | `/admin/export/{users,servers,subscribers}` | CSV-Export |
| GET | `/internal/tls-check?domain=…` | Für Caddy: darf für diese Domain ein Zertifikat geholt werden? |
| POST | `/beta/enter` (Hauptseite) · `/beta/session` (Beta-Instanz) | Beta-Programm: Einmal-Ticket ausstellen bzw. einlösen (Freigabe wird beide Male geprüft) |
| POST | `/admin/users/:id/{grant-beta,revoke-beta}` | Beta-Zugang vergeben / entziehen |
| POST · GET | `/admin/logo` · `/admin/logo/delete` · `/brand/logo` | Logo hochladen, entfernen, ausliefern |
| GET/POST | `/admin/waitlist` · `/admin/waitlist/release` · `/admin/waitlist/:id/remove` | Warteliste |
| GET/POST | `/admin/incidents` · `/admin/incidents/:id` · `/admin/incidents/:id/{resolve,delete}` | Meldungen der Statusseite |

---

## Deployment auf der KVM / VPS

Schritt-für-Schritt für Debian 13: [`docs/DEBIAN-13.md`](docs/DEBIAN-13.md)

Empfohlen: `sudo bash install.sh` (siehe oben). Alternativ mit Docker:

```bash
cp .env.example .env     # NODE_ENV=production, APP_URL=https://craftinghosting.free, DATABASE_ENCRYPTION_KEY,
                         # PTERODACTYL_MODE=live + Keys, SMTP_*, NEXT_PUBLIC_PANEL_URL
docker compose up -d --build
```

Startet Migration, API, Worker, Website und Caddy (automatisches HTTPS); die verschlüsselte Datenbank liegt im Volume `chfree-data`. **Datenbank-Datei und `DATABASE_ENCRYPTION_KEY` gemeinsam sichern** – ohne Schlüssel ist die Datei wertlos. Daten aus der früheren MariaDB-Version werden nicht automatisch übernommen.

---

## Sicherheit

- Keine Pterodactyl-Keys im Browser; alle privilegierten Aufrufe serverseitig
- Website ohne Passwörter (E-Mail-Links, einmalig, befristet, nur als SHA-256-Hash gespeichert); das Panel-Passwort wird nur an Pterodactyl durchgereicht
- Panel-Zugang erst **nach** E-Mail-Bestätigung – niemand kann für fremde Adressen ein Panel-Konto mit eigenem Passwort anlegen
- Kurze Anmeldung: Session-Cookie ohne Ablaufdatum (endet mit dem Schließen des Browsers), Abmeldung nach 30 min Inaktivität, spätestens nach 12 h – danach neu per E-Mail-Link anmelden (`SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, `SESSION_PERSISTENT`)
- Session-Cookie HttpOnly/Secure/SameSite=Lax, CSRF-Header + Origin-Prüfung, Rate-Limits, zod-Validierung, Server-Limit per Zeilensperre
- Antworten verraten nicht, ob eine E-Mail-Adresse existiert
- Admin-Bereich unter geheimem Pfad, 404 für alle anderen, `noindex`
- Datenbank im Ruhezustand verschlüsselt (SQLite über libSQL, Schlüssel `DATABASE_ENCRYPTION_KEY`)
- IP-Adressen werden gespeichert (Registrierung, Anmeldung, Sitzungen, Audit-Log, Cookie-Hinweis) – ausschließlich verschlüsselt (AES-256-GCM) und nur im Admin-Bereich lesbar; Audit- und Einwilligungs-Protokoll werden nach 90 Tagen gelöscht
- Keine allgemeinen Zugriffsprotokolle (API ohne Request-Logging, Caddy ohne Access-Log, Docker-Logs rotiert)

---

## Vor dem Livegang

- [ ] Rechtstexte sind vollständig ausgefüllt (Impressum, Datenschutz, AGB, Nutzungsbedingungen, Cookies – ohne Platzhalter); vor dem Livegang juristisch gegenlesen lassen
- [ ] Admin-Konto prüfen: `ADMIN_EMAILS` in der `.env` bzw. `chfree cli make-admin du@example.com` – `/admin` ist nur für diese Konten erreichbar
- [ ] Englische Rechtstexte gegenlesen lassen (die deutsche Fassung ist maßgeblich)
- [ ] DNS für `panel.craftinghosting.free` + im Panel `APP_URL` und bei Wings die Panel-Adresse anpassen
- [ ] Offizielles Logo einbinden (`apps/web/src/components/brand/logo.tsx`)
- [ ] API-Keys eintragen; im Admin unter *Pterodactyl* Nodes und Eggs zuweisen (Discord-Bot-Node, Python-/Node.js-Egg); Versionsliste an die Eggs anpassen
- [ ] Pakete, Kapazität und Fair-Use-Werte für Discord-Bots im Admin prüfen
- [ ] SumUp-Zahlungslink eintragen, falls Spenden gewünscht sind
- [ ] Backup von Datenbank **und** `DATABASE_ENCRYPTION_KEY` einrichten (`chfree backup`)
- [ ] SMTP mit SPF/DKIM für die Absenderdomain
- [ ] Fair-Use-Werte final festlegen
- [ ] Optional: Captcha (z. B. Cloudflare Turnstile) für `/start`
