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
`session_limit` (Laufzeit-Grenze) · `admin`

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
| 429 | `rate_limited` | Zu viele Anfragen – die Grenzen gelten je API-Key |
| 503 | `maintenance`, `unavailable`, `panel_unavailable` | Wartung bzw. vorübergehend nicht möglich – später erneut versuchen |

Sprache der Fehlermeldungen: Kopfzeile `Accept-Language: de` oder `en`.
