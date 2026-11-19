# CraftingHosting.free – Partner-API

Mit der Partner-API bindet ein Partner (z. B. ein Minecraft-Launcher) unser Hosting in sein Programm ein:
Spieler erstellen im Launcher einen Server, der nicht auf ihrem PC läuft, sondern bei uns.

- **Basis-Adresse:** `https://<deine-domain>/api/v1/partner`
- **Zugang:** Kopfzeile `Authorization: Bearer <API-Key>` (alternativ `X-API-Key: <API-Key>`)
- **Format:** JSON (`Content-Type: application/json`). Zeiten sind ISO-8601 in UTC.
- **Den API-Key gibt es im Admin-Bereich** unter *Partner-API*. Er wird nur einmal angezeigt.

> **Wichtig:** Der API-Key gehört auf den **Server des Partners**. In einem Programm, das an Spieler verteilt wird,
> lässt er sich auslesen. Der Launcher spricht also mit dem Server des Partners, und der mit dieser API.

## So funktioniert es

1. **Spieler:** Der Partner schickt seine eigene Nutzerkennung mit (`player.externalId`). Wir legen dazu automatisch
   eine kurze **Spieler-ID** an (z. B. `P7KXGQXL`). Sie steht im Servernamen (`Meine Welt #P7KXGQXL`) – so ist jeder
   Server immer einem Spieler zuzuordnen. Alle Server laufen unter dem Konto des Partners.
2. **Erstellen:** Der Server wird bei uns installiert (dauert etwa ein bis zwei Minuten, `state: installing`).
3. **Starten:** `start` fährt den Server hoch. Beim ersten Start muss der Spieler die
   [Minecraft-EULA](https://www.minecraft.net/eula) akzeptiert haben (`"acceptEula": true`).
4. **Lebenszeichen:** Solange der Launcher des Hosts offen ist, schickt er regelmäßig `heartbeat`
   (empfohlen: alle 30–60 Sekunden). Bleibt es länger als `heartbeatTimeoutSeconds` aus, **fährt der Server
   herunter** – die Welt bleibt gespeichert.
5. **Stoppen:** Schließt der Spieler den Launcher, schickt dieser `stop`. Beim nächsten `start` geht es weiter.
6. **Laufzeit-Regel:** Nach `sessionMaxHours` Stunden Laufzeit (Standard 24) wird der Server gestoppt und hat
   `cooldownHours` Stunden Pause (Standard 2). Danach muss er mit `start` neu gestartet werden. Unterbrechungen, die
   kürzer als die Pause sind, setzen die Laufzeit nicht zurück. Zehn Minuten und eine Minute vorher gibt es einen
   Hinweis im Spiel.
7. **Aufräumen:** Server, die `deleteAfterIdleDays` Tage nicht gestartet wurden, werden samt Daten gelöscht.

## Endpunkte

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `GET` | `/me` | Paket, Servertypen mit Versionen, Grenzen, Auslastung |
| `POST` | `/players` | Spieler anlegen bzw. abrufen → Spieler-ID |
| `GET` | `/players/{externalId oder Spieler-ID}` | Spieler mit seinen Servern |
| `GET` | `/servers?player={externalId}&limit=&offset=` | Server auflisten |
| `POST` | `/servers` | Server für einen Spieler erstellen |
| `GET` | `/servers/{id}` | Stand eines Servers |
| `POST` | `/servers/{id}/start` | Starten bzw. nach der Pause reaktivieren |
| `POST` | `/servers/{id}/heartbeat` | Lebenszeichen des Hosts |
| `POST` | `/heartbeat` | Lebenszeichen für bis zu 500 Server auf einmal: `{"servers":["…","…"]}` |
| `POST` | `/servers/{id}/stop` | Herunterfahren (Daten bleiben) |
| `POST` | `/servers/{id}/command` | Konsolenbefehl, z. B. `{"command":"op Steve"}` |
| `DELETE` | `/servers/{id}` | Server samt Daten löschen (auch `POST /servers/{id}/delete`) |

### Weitere Endpunkte (Dateien, Mods, Konsole, Einstellungen, Live-Werte)

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `PATCH` | `/servers/{id}` | Umbenennen: `{"name":"…"}` (die Spieler-ID im Namen bleibt) · Typ/Version wechseln und neu installieren: `{"serverType":"fabric","version":"1.21.1"}` (Server muss aus sein) |
| `POST` | `/servers/{id}/reinstall` | Neu installieren, ohne etwas zu ändern (Server muss aus sein; höchstens 3 je Stunde und Server) |
| `GET` | `/servers/{id}/console/stream` | Konsole live als Server-Sent Events (`line`, `status`, `info`, `end`); nur lesend, höchstens 15 Minuten je Verbindung, 3 je Server, 50 je Partner; zählt nicht als Lebenszeichen |
| `GET` / `POST` | `/servers/{id}/backups` | Backups auflisten (`limit` = Höchstzahl laut Paket) bzw. anlegen (`{"name":"…"}`) |
| `GET` | `/servers/{id}/backups/{backup}/download-url` | Adresse zum Herunterladen |
| `POST` | `/servers/{id}/backups/{backup}/restore` | Einspielen (`{"truncate":false}`), nur wenn der Server aus ist |
| `DELETE` | `/servers/{id}/backups/{backup}` | Backup löschen |
| `GET` / `PUT` / `DELETE` | `/webhook` | Webhook für Statuswechsel lesen, setzen (`{"url":"https://…"}` → Antwort enthält einmalig `secret`), entfernen |
| `POST` | `/webhook/test` | Test-Ereignis schicken |
| `GET` | `/servers/{id}/stats` | CPU, Arbeitsspeicher, Speicherplatz, Netzwerk, Laufzeit, `players` (`{online,max}` oder `null`) |
| `GET` | `/servers/{id}/logs?lines=100` | Die letzten Zeilen der Konsole (aus `logs/latest.log`, höchstens 1000) |
| `GET` / `PATCH` | `/servers/{id}/settings` | `server.properties` lesen/setzen: `motd`, `maxPlayers` (1–100), `gamemode`, `difficulty`, `hardcore`, `pvp`, `whitelist`, `allowFlight`, `seed`, `levelType` (`normal`/`flat`/`large_biomes`/`amplified`), `spawnProtection` (0–64), `viewDistance`, `simulationDistance` (3–16) |
| `GET` | `/servers/{id}/files?dir=/mods` | Dateien und Ordner auflisten |
| `GET` / `PUT` | `/servers/{id}/files/content?path=…` | Textdatei lesen bzw. Datei schreiben (Inhalt = Körper der Anfrage, bis 10 MB) |
| `POST` | `/servers/{id}/files/upload-url` | Adresse für den direkten Upload großer Dateien (`multipart/form-data`, Feld `files`, gilt 10 Minuten) |
| `GET` | `/servers/{id}/files/download-url?path=…` | Adresse zum Herunterladen |
| `POST` | `/servers/{id}/files/delete` | `{"paths":["/mods/alt.jar"]}` |
| `POST` | `/servers/{id}/files/folder` | `{"path":"/config/neu"}` |
| `POST` | `/servers/{id}/files/decompress` | Archiv entpacken: `{"path":"/welt.zip"}` |
| `POST` | `/servers/{id}/files/pull` | Datei von einer https-Adresse laden: `{"url":"…","directory":"/mods"}` |
| `POST` | `/servers/{id}/mods` | Modrinth: `{"project":"sodium"}` oder `{"version":"<Versions-ID>"}`; Pflicht-Abhängigkeiten kommen mit (`"dependencies":false` schaltet das ab) |

Hinweise:

- Dateien und Einstellungen lassen sich ändern, sobald der Server installiert ist – auch vor dem ersten Start. Wirksam
  werden sie beim nächsten Start; `seed` und `levelType` nur für eine neu erzeugte Welt.
- `POST /servers/{id}/stop` mit `{"whenEmpty":true}`: Ist für den Partner „Weiterlaufen, solange Spieler online sind“
  eingeschaltet, läuft der Server weiter, bis niemand mehr darauf ist (`session.hostPresent` ist dann `false`).
- Jede Server-Antwort enthält `host`, `port` (bleiben gleich, solange es den Server gibt – außer wir verlegen ihn auf
  andere Hardware) und `deleteAt` (Löschung, wenn bis dahin nicht gestartet wird).
- **Anfrage-Limit** je Partner und Minute: `heartbeat` 12 000 · `GET /servers/{id}` und `stats` 6 000 · übrige
  Lese-Endpunkte, `start`, `stop`, `command` 1 200 · Schreiben (Dateien, Mods, Einstellungen, Löschen) und
  `GET /me` 600 · `POST /servers`, `PATCH /servers/{id}`, `decompress`, Konsolen-Stream 300 · Backup anlegen/einspielen
  und `reinstall` 60 · Webhook setzen/löschen/testen 30. Jede Antwort enthält `X-RateLimit-Limit`,
  `X-RateLimit-Remaining` und `X-RateLimit-Reset`; bei Überschreitung `429` mit `Retry-After`. Anfragen mit einem
  ungültigen Key zählen je IP-Adresse (höchstens 30 je Minute und Endpunkt).
- **Panel-Kontingent:** Anfragen, die wir an das Panel weiterreichen, sind zusätzlich begrenzt
  (`PARTNER_PANEL_CALLS_PER_MINUTE`, Standard 300 für alle Partner zusammen, ein einzelner höchstens 80 % davon).
  Ist es aufgebraucht: `429 panel_busy`. So kann kein Partner das Kontingent aufbrauchen, das unsere eigenen
  Stopp-Befehle brauchen. `stats` und der Zustand in `GET /servers/{id}` sind 5 Sekunden zwischengespeichert; die
  Liste `GET /servers` zeigt den zuletzt bekannten Zustand ohne Panel-Aufruf.
- Die vollständige Beschreibung mit Beispielen steht für Partner-Konten unter `/docs/partner-api`.

### Server erstellen

```bash
curl -X POST https://<deine-domain>/api/v1/partner/servers \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"player":{"externalId":"launcher-user-4711","name":"Steve"},"name":"Meine Welt","serverType":"paper","version":"latest"}'
```

- `player.externalId`: Kennung des Nutzers beim Partner (1–80 Zeichen: Buchstaben, Ziffern, `. _ : @ -`)
- `name`: 3–22 Zeichen (Buchstaben, Ziffern, Leerzeichen, `. _ ' -`)
- `serverType` und `version`: Werte aus `GET /me`

Antwort (`201`):

```json
{
  "server": {
    "id": "0b6f6c0e-…",
    "name": "Meine Welt #P7KXGQXL",
    "player": { "id": "P7KXGQXL", "externalId": "launcher-user-4711", "name": "Steve" },
    "state": "installing",
    "address": "node1.example.com:25568",
    "serverType": "paper",
    "version": "latest",
    "resources": { "memoryMb": 4096, "cpuPercent": 100, "diskMb": 10240 },
    "eulaAccepted": false,
    "session": {
      "active": false,
      "startedAt": null,
      "lastHeartbeatAt": null,
      "heartbeatTimeoutSeconds": 180,
      "runSeconds": 0,
      "maxRunSeconds": 86400,
      "remainingSeconds": 86400,
      "cooldownUntil": null,
      "lastStopReason": null
    },
    "createdAt": "2026-11-18T15:59:20.000Z",
    "lastStartAt": null
  }
}
```

`state`: `installing` · `offline` · `starting` · `running` · `stopping` · `failed` · `suspended`
`session.lastStopReason`: `host_stopped` (Launcher hat gestoppt) · `host_timeout` (kein Lebenszeichen) ·
`session_limit` (Laufzeit-Grenze) · `settings_limit` (Einstellungen über den Grenzen) · `admin`

### Starten, Lebenszeichen, Stoppen

```bash
curl -X POST …/servers/$ID/start -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"acceptEula":true}'
curl -X POST …/servers/$ID/heartbeat -H "Authorization: Bearer $API_KEY"
curl -X POST …/servers/$ID/stop -H "Authorization: Bearer $API_KEY"
```

Ablauf im Launcher:

1. `start` aufrufen, danach `GET /servers/{id}` abfragen, bis `state` = `running` ist; dann `address` zum Verbinden anzeigen.
2. Solange der Launcher offen ist: alle 30–60 Sekunden `heartbeat`. Die Antwort enthält `session.remainingSeconds`.
3. Beim Schließen: `stop`.
4. Antwortet `heartbeat` mit `not_running`, ist die Sitzung beendet (Grund steht in `fields.reason`) – dem Spieler
   Bescheid sagen und ggf. `start` anbieten.

## Servertypen und Versionen (Software-Einrichtung)

Standardmäßig angeboten werden `paper`, `purpur`, `vanilla`, `fabric`, `forge`, `neoforge` und `quilt`; welche Typen
tatsächlich wählbar sind, legt der Betreiber im Admin-Bereich fest (Einstellungen → „Server-Software“, Schalter „Über
die Partner-API anbieten“) – die gültige Liste samt Versionen liefert `GET /partner/me` (`serverTypes`). Über die Partner-API gibt es nur Java-Spielserver;
Bedrock und Proxys (Velocity, BungeeCord) sind dort nicht wählbar. Im Panel braucht nicht jeder Typ ein eigenes Egg:
Hat ein Typ **kein eigenes Egg** (oder ist „über MCJars“ eingestellt), legt das Panel den Server mit der eingestellten
Grundlage an (ein Java-Egg, ohne Auswahl das Paper-Egg) und die API richtet die gewünschte Software danach selbst ein –
so wie es sonst der Version-Changer im Panel tut:

1. Typ und Version werden im Verzeichnis **MCJars** nachgeschlagen (`MCJARS_API_URL`, Standard `https://mcjars.app/api/v2`).
2. Der Job `partner-software` (alle 5 s) führt die dort genannten Schritte aus: Dateien über den Node direkt auf den
   Server laden, entpacken, alte Dateien entfernen.
3. Das Java-Image wird passend zur Minecraft-Version aus den Images der Grundlage gewählt (genau diese Version, sonst
   die nächsthöhere), die Startdatei auf `server.jar` gesetzt. Ressourcen, Node und Ports bleiben unverändert.

**Versionen:** Angeboten werden je Typ alle veröffentlichten Versionen aus dem Verzeichnis (keine Vorabversionen),
die neueste zuerst – auf der Website und in `GET /me`. Der Stand wird 10 Minuten gemerkt; ist das Verzeichnis nicht
erreichbar, gilt der letzte bekannte Stand bzw. unsere fest hinterlegte Liste. Eine im Admin-Bereich gepflegte eigene
Liste (Einstellungen → Minecraft-Versionen) gilt immer genau so und ersetzt die automatische.

So lange ist `state` = `installing` und `install` in der Server-Antwort zeigt den Fortschritt; bei einem Fehlschlag
`state` = `failed` mit `install.error` (erneut versuchen: `POST /servers/{id}/reinstall`). Hat ein Typ ein **eigenes
Egg**, läuft alles wie bisher über dieses Egg (Wechsel = Egg umstellen und im Panel neu installieren).

Grenzen der Einrichtung: höchstens 10 gleichzeitig je Partner (`429 too_many_installs`), Abfragen beim Panel mit
wachsendem Abstand (5 bis 30 s), Gesamtfrist 60 Minuten. Bietet das Paper-Egg kein Java-Image, das für die Version
reicht, schlägt die Einrichtung mit einem klaren Hinweis fehl (statt mit falschem Java zu starten) – dann das Image im
Egg ergänzen.

Voraussetzungen: Der API-Server erreicht `mcjars.app`; die Nodes erreichen die Download-Adressen (u. a.
`*.mcjars.app`, `piston-data.mojang.com`, `fill-data.papermc.io`, `api.purpurmc.org`). Typ und Version kommen immer aus
unserer festen Auswahl; Adressen und Dateinamen der Schritte kommen aus dem Verzeichnis, nie vom Partner, und werden vor
dem Ausführen geprüft (nur einfache relative Pfade, nur https).

## Webhooks

Je Partner eine Adresse (`PUT /webhook`). Ereignisse: `server.installed`, `server.install_failed`, `server.running`, `server.stopped`
(`reason`: `host_stopped`, `host_timeout`, `session_limit`, `settings_limit`, `admin`; `cooldownUntil`),
`server.cooldown_ended`, `server.deletion_soon` (`deleteAt`), `server.deleted`, `webhook.test`.

```
POST <eure Adresse>
X-CHF-Event: server.stopped
X-CHF-Delivery: <ID des Ereignisses, bei Wiederholungen gleich>
X-CHF-Timestamp: 1795025048
X-CHF-Signature: sha256=<HMAC-SHA256 über "<Timestamp>.<Körper>" mit dem Geheimnis whsec_…>

{"id":"…","type":"server.stopped","createdAt":"…","data":{"serverId":"…","name":"…","playerId":"…","reason":"host_timeout","cooldownUntil":null}}
```

- Nur `https` auf Port 443, öffentlich erreichbar, keine Zugangsdaten in der Adresse. Der Host wird bei jeder
  Zustellung neu geprüft und es wird genau an die geprüfte IP zugestellt; Weiterleitungen werden nicht verfolgt.
  Unsere eigenen Hosts (Website, Panel) sind als Ziel gesperrt.
- Erwartet wird ein 2xx-Status innerhalb von 5 Sekunden. Wiederholungen nach 30 s, 2 min, 10 min, 1 h, 6 h.
- Zugestellt wird je Partner getrennt (höchstens 25 Ereignisse je Lauf); antwortet ein Empfänger nicht, warten nur
  dessen eigene Ereignisse.
- Das Geheimnis liegt verschlüsselt in der Datenbank und wird nur beim Setzen einmal ausgegeben.
- Webhooks sind reine Benachrichtigungen – die Antwort des Empfängers ändert nichts am Server.

## Regeln, die sich über die API nicht umgehen lassen

| Regel | Wie sie durchgesetzt wird |
| --- | --- |
| Höchstzahl Server (gesamt / je Spieler) | Prüfen und Anlegen in einer Schreib-Transaktion – gleichzeitige Anfragen können die Grenze nicht überschreiten |
| Laufzeit-Grenze und Pflichtpause | Stand wird beim Löschen auf den Spieler übertragen und beim neu Erstellen übernommen. Gelöschte Server anderer Spieler mit offener Pause/Laufzeit belegen ihren Platz weiter (neue Spieler-Kennung hilft also nicht). Ein neuer Start geht erst, wenn der Server wirklich aus ist (`server_stopping`); ein fehlgeschlagener Start setzt nichts zurück |
| „Server läuft nur mit Sitzung“ | Der Job `partner-sessions` (alle 30 s) stoppt jeden Partner-Server ohne Sitzung und beendet ihn nach 2 Minuten hart (`kill`), falls er den Stopp ignoriert. Die Zeit bis dahin zählt als Laufzeit; wird dabei die Laufzeit-Grenze erreicht, folgt sofort `kill` und die Pflichtpause |
| Lebenszeichen | Konsolen-Stream, Webhooks, Backups zählen nicht als Lebenszeichen; „Weiterlaufen mit Spielern“ höchstens 2 Stunden |
| Nur Java-Spielserver | Bedrock (Bedrock, PocketMine-MP, Nukkit), Proxys (Velocity, BungeeCord, Waterfall …) und jede Software, die nur über ein eigenes Egg läuft, lassen sich über die API weder erstellen noch per Typwechsel erreichen (`server_type_unavailable`). Das ist eine feste Regel im Code – der Schalter „Über die Partner-API anbieten“ lässt sich für diese Einträge im Admin-Bereich nicht einschalten, und selbst ein von Hand geänderter Katalog ändert daran nichts |
| Paket-Ressourcen, Servertypen, Versionen | Typ-/Versionswechsel nimmt Egg, Image und Startbefehl nur aus unserer Konfiguration; Ressourcen werden nie geändert |
| Grenzen der Einstellungen | Vor jedem Start: Die begrenzten Werte der `server.properties` stehen in einem eigenen Block am Dateiende (der letzte Eintrag gilt – unabhängig davon, wie die Datei darüber geschrieben ist); bei Paper/Purpur wird zusätzlich die Sichtweite in der `spigot.yml` gekappt. Beim Speichern über die API werden beide Dateien sofort begrenzt. Nachprüfung eine Minute nach dem Start: Stehen dann Werte über den Grenzen in der Datei (ausgetauscht zwischen Prüfung und Hochfahren), Stopp mit `settings_limit`; spätere Änderungen bei laufendem Server werden nur korrigiert |
| Backups | Höchstzahl laut Paket (von uns und vom Panel geprüft), ein Vorgang zugleich je Server, werden mit dem Server gelöscht |
| Anfragebegrenzung | je Partner (nicht je Key – ein neuer oder erfundener Key bringt kein neues Kontingent), dazu das Panel-Kontingent |
| Daemon-Zugang | Die Live-Konsole wird von unserer API gelesen und weitergereicht; Adresse und Token des Daemons verlassen den Server nie |

Was sich technisch **nicht** verhindern lässt: Ein Partner kann beliebige Plugins/Mods und auch eine andere Server-JAR
hochladen. Damit lassen sich Dinge *im Spiel* verändern (z. B. die angezeigte Spielerzahl oder die Sichtweite je Welt).
Arbeitsspeicher, CPU, Speicherplatz und Ports begrenzt aber der Container des Panels – daran kommt kein Plugin vorbei.

## Fehler

Fehler kommen mit passendem HTTP-Status und diesem Aufbau:

```json
{ "error": { "code": "cooldown", "message": "…", "fields": { "cooldownUntil": "2026-11-18T17:59:37.077Z" } } }
```

| Status | `code` | Bedeutung |
| --- | --- | --- |
| 401 | `invalid_api_key` | Key fehlt, ist falsch oder der Partner ist deaktiviert |
| 400 | `validation_error`, `invalid_name`, `invalid_player`, `server_type_unavailable`, `version_unavailable`, `invalid_json` | Angaben prüfen (Details in `fields`) |
| 404 | `not_found` | Server bzw. Spieler gibt es nicht (oder gehört nicht zu diesem Partner) |
| 409 | `player_limit_reached` | Der Spieler hat schon die Höchstzahl an Servern |
| 409 | `partner_limit_reached` | Die Höchstzahl an Servern des Partners ist erreicht |
| 409 | `server_installing` | Der Server wird noch eingerichtet – gleich noch einmal versuchen |
| 409 | `eula_required` | Erster Start: Der Spieler muss die Minecraft-EULA akzeptieren (`"acceptEula": true`) |
| 409 | `cooldown` | Pflichtpause läuft noch (`fields.cooldownUntil`) |
| 409 | `not_running` | Keine laufende Sitzung (bei `heartbeat` und `command`) |
| 409 | `server_failed`, `server_suspended` | Einrichtung fehlgeschlagen bzw. Server gesperrt |
| 409 | `server_stopping` | Der Server fährt aus der vorigen Sitzung noch herunter – in ein paar Sekunden erneut starten |
| 409 | `server_running` | Dafür muss der Server aus sein (Backup einspielen, Typ/Version wechseln, neu installieren) |
| 409 | `state_changed` | Der Stand hat sich im selben Moment geändert – noch einmal versuchen |
| 409 / 404 | `backup_limit`, `backup_busy`, `backup_rejected`, `backup_not_found` | Höchstzahl erreicht, Vorgang läuft schon, vom Panel abgelehnt bzw. Backup gibt es nicht |
| 429 | `rate_limited` | Zu viele Anfragen – die Grenzen gelten je Partner |
| 429 | `panel_busy`, `too_often`, `too_many_streams` | Panel-Kontingent aufgebraucht, zu viele Backups/Neuinstallationen in kurzer Zeit bzw. zu viele offene Konsolen-Streams |
| 503 | `maintenance`, `unavailable`, `panel_unavailable` | Wartung bzw. vorübergehend nicht möglich – später erneut versuchen |

Sprache der Fehlermeldungen: Kopfzeile `Accept-Language: de` oder `en`.
