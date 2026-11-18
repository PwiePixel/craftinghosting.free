/**
 * Partner-Dokumentation (/docs/partner-api) – wird nur an Partner-Konten und Admins ausgeliefert.
 * Platzhalter: {api} = Basis-Adresse der Partner-API.
 */
import type { DocPage } from './types';

export const partnerDoc: DocPage = {
  slug: 'partner-api',
  title: { de: 'Partner-API', en: 'Partner API' },
  summary: {
    de: 'Unser Hosting in dein Programm einbinden: Server für deine Nutzer erstellen und steuern – zum Beispiel aus einem Minecraft-Launcher.',
    en: 'Integrate our hosting into your software: create and control servers for your users – for example from a Minecraft launcher.',
  },
  sections: [
    {
      heading: { de: 'Zugang', en: 'Access' },
      blocks: [
        {
          ul: [
            { de: 'Basis-Adresse: {api}', en: 'Base URL: {api}' },
            { de: 'Kopfzeile: „Authorization: Bearer <API-Key>“ (alternativ „X-API-Key: <API-Key>“)', en: 'Header: “Authorization: Bearer <API key>” (alternatively “X-API-Key: <API key>”)' },
            { de: 'Format: JSON. Zeiten sind ISO-8601 in UTC. Sprache der Fehlermeldungen über „Accept-Language: de“ oder „en“.', en: 'Format: JSON. Times are ISO 8601 in UTC. Language of error messages via “Accept-Language: de” or “en”.' },
            { de: 'Den API-Key bekommst du von uns. Er wird nur einmal angezeigt; bei Verlust stellen wir einen neuen aus.', en: 'You receive the API key from us. It is shown only once; if it is lost we issue a new one.' },
          ],
        },
        { note: { de: 'Der API-Key gehört auf deinen Server – nicht in ein Programm, das an Nutzer verteilt wird. Dein Launcher spricht mit deinem Server, und der mit dieser API.', en: 'The API key belongs on your server – not in software that is distributed to users. Your launcher talks to your server, and your server talks to this API.' } },
      ],
    },
    {
      heading: { de: 'So funktioniert es', en: 'How it works' },
      blocks: [
        {
          ol: [
            { de: 'Spieler: Du schickst deine eigene Nutzerkennung mit (player.externalId). Wir legen dazu automatisch eine kurze Spieler-ID an (z. B. P7KXGQXL). Sie steht im Servernamen („Meine Welt #P7KXGQXL“). Alle Server laufen unter deinem Partner-Konto.', en: 'Players: you send your own user id (player.externalId). We automatically create a short player id for it (e.g. P7KXGQXL). It is part of the server name (“My World #P7KXGQXL”). All servers run under your partner account.' },
            { de: 'Erstellen: Der Server wird bei uns installiert (ein bis zwei Minuten, state: installing).', en: 'Create: the server is installed on our side (one to two minutes, state: installing).' },
            { de: 'Starten: „start“ fährt den Server hoch. Beim ersten Start muss der Spieler die Minecraft-EULA akzeptiert haben ("acceptEula": true).', en: 'Start: “start” boots the server. On the first start the player must have accepted the Minecraft EULA ("acceptEula": true).' },
            { de: 'Lebenszeichen: Solange der Launcher des Hosts offen ist, schickt er regelmäßig „heartbeat“ (empfohlen alle 30–60 Sekunden). Bleibt es länger als heartbeatTimeoutSeconds aus, fährt der Server herunter – die Welt bleibt gespeichert.', en: 'Heartbeat: while the host’s launcher is open it regularly sends “heartbeat” (recommended every 30–60 seconds). If it is missing for longer than heartbeatTimeoutSeconds the server shuts down – the world stays saved.' },
            { de: 'Stoppen: Schließt der Spieler den Launcher, schickt dieser „stop“. Beim nächsten „start“ geht es weiter.', en: 'Stop: when the player closes the launcher it sends “stop”. The next “start” continues where they left off.' },
            { de: 'Laufzeit-Regel: Nach sessionMaxHours Stunden Laufzeit (Standard 24) wird der Server gestoppt und hat cooldownHours Stunden Pause (Standard 2). Danach muss er mit „start“ neu gestartet werden. Unterbrechungen, die kürzer als die Pause sind, setzen die Laufzeit nicht zurück. Zehn Minuten und eine Minute vorher gibt es einen Hinweis im Spiel.', en: 'Runtime rule: after sessionMaxHours hours of runtime (default 24) the server is stopped and pauses for cooldownHours hours (default 2). After that it must be started again with “start”. Interruptions shorter than the pause do not reset the runtime. There is an in-game notice ten minutes and one minute before.' },
            { de: 'Aufräumen: Server, die deleteAfterIdleDays Tage nicht gestartet wurden, werden samt Daten gelöscht.', en: 'Clean-up: servers that have not been started for deleteAfterIdleDays days are deleted including their data.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Endpunkte', en: 'Endpoints' },
      blocks: [
        {
          table: {
            head: [{ de: 'Methode', en: 'Method' }, { de: 'Pfad', en: 'Path' }, { de: 'Zweck', en: 'Purpose' }],
            rows: [
              ['GET', '/me', { de: 'Paket, Servertypen mit Versionen, Grenzen, Auslastung', en: 'Plan, server types with versions, limits, usage' }],
              ['POST', '/players', { de: 'Spieler anlegen bzw. abrufen → Spieler-ID', en: 'Create or fetch a player → player id' }],
              ['GET', '/players/{externalId | Spieler-ID}', { de: 'Spieler mit seinen Servern', en: 'Player with their servers' }],
              ['GET', '/servers?player={externalId}&limit=&offset=', { de: 'Server auflisten', en: 'List servers' }],
              ['POST', '/servers', { de: 'Server für einen Spieler erstellen', en: 'Create a server for a player' }],
              ['GET', '/servers/{id}', { de: 'Stand eines Servers', en: 'State of a server' }],
              ['POST', '/servers/{id}/start', { de: 'Starten bzw. nach der Pause reaktivieren', en: 'Start or reactivate after the pause' }],
              ['POST', '/servers/{id}/heartbeat', { de: 'Lebenszeichen des Hosts', en: 'Heartbeat of the host' }],
              ['POST', '/heartbeat', { de: 'Lebenszeichen für bis zu 500 Server: {"servers":["…"]}', en: 'Heartbeat for up to 500 servers: {"servers":["…"]}' }],
              ['POST', '/servers/{id}/stop', { de: 'Herunterfahren (Daten bleiben). Mit {"whenEmpty":true}: erst, wenn keine Spieler mehr da sind (falls für dich freigeschaltet)', en: 'Shut down (data is kept). With {"whenEmpty":true}: only once no players are left (if enabled for you)' }],
              ['PATCH', '/servers/{id}', { de: 'Umbenennen: {"name":"…"}', en: 'Rename: {"name":"…"}' }],
              ['GET', '/servers/{id}/stats', { de: 'Live-Werte: CPU, Arbeitsspeicher, Speicherplatz, Netzwerk, Spielerzahl', en: 'Live values: CPU, memory, disk, network, player count' }],
              ['GET', '/servers/{id}/logs?lines=100', { de: 'Die letzten Zeilen der Konsole (höchstens 1000)', en: 'The last console lines (at most 1000)' }],
              ['GET / PATCH', '/servers/{id}/settings', { de: 'Servereinstellungen (server.properties) lesen und setzen', en: 'Read and set server settings (server.properties)' }],
              ['GET', '/servers/{id}/files?dir=/mods', { de: 'Dateien und Ordner auflisten', en: 'List files and directories' }],
              ['GET / PUT', '/servers/{id}/files/content?path=…', { de: 'Textdatei lesen bzw. Datei schreiben (Inhalt als Körper der Anfrage, bis 10 MB)', en: 'Read a text file or write a file (content as request body, up to 10 MB)' }],
              ['POST', '/servers/{id}/files/upload-url', { de: 'Adresse für den direkten Upload großer Dateien: {"directory":"/"}', en: 'URL for uploading large files directly: {"directory":"/"}' }],
              ['GET', '/servers/{id}/files/download-url?path=…', { de: 'Adresse zum Herunterladen einer Datei', en: 'URL for downloading a file' }],
              ['POST', '/servers/{id}/files/delete', { de: 'Löschen: {"paths":["/mods/alt.jar"]}', en: 'Delete: {"paths":["/mods/old.jar"]}' }],
              ['POST', '/servers/{id}/files/folder', { de: 'Ordner anlegen: {"path":"/config/neu"}', en: 'Create a directory: {"path":"/config/new"}' }],
              ['POST', '/servers/{id}/files/decompress', { de: 'Archiv entpacken (zip, tar.gz): {"path":"/welt.zip"}', en: 'Extract an archive (zip, tar.gz): {"path":"/world.zip"}' }],
              ['POST', '/servers/{id}/files/pull', { de: 'Datei von einer https-Adresse laden: {"url":"…","directory":"/mods"}', en: 'Fetch a file from an https URL: {"url":"…","directory":"/mods"}' }],
              ['POST', '/servers/{id}/mods', { de: 'Mod oder Plugin von Modrinth installieren: {"project":"sodium"}', en: 'Install a mod or plugin from Modrinth: {"project":"sodium"}' }],
              ['POST', '/servers/{id}/command', { de: 'Konsolenbefehl, z. B. {"command":"op Steve"}', en: 'Console command, e.g. {"command":"op Steve"}' }],
              ['DELETE', '/servers/{id}', { de: 'Server samt Daten löschen (auch POST …/delete)', en: 'Delete the server including data (also POST …/delete)' }],
            ],
          },
        },
      ],
    },
    {
      heading: { de: 'Server erstellen', en: 'Creating a server' },
      blocks: [
        {
          code: `curl -X POST {api}/servers \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '{"player":{"externalId":"launcher-user-4711","name":"Steve"},"name":"Meine Welt","serverType":"paper","version":"latest"}'`,
        },
        {
          ul: [
            { de: 'player.externalId: Kennung des Nutzers bei dir (1–80 Zeichen: Buchstaben, Ziffern, . _ : @ -)', en: 'player.externalId: your id for the user (1–80 characters: letters, digits, . _ : @ -)' },
            { de: 'name: 3–22 Zeichen (Buchstaben, Ziffern, Leerzeichen, . _ \' -)', en: 'name: 3–22 characters (letters, digits, spaces, . _ \' -)' },
            { de: 'serverType und version: Werte aus GET /me', en: 'serverType and version: values from GET /me' },
          ],
        },
        { p: { de: 'Antwort (201):', en: 'Response (201):' } },
        {
          code: `{
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
}`,
        },
        {
          ul: [
            { de: 'state: installing · offline · starting · running · stopping · failed · suspended', en: 'state: installing · offline · starting · running · stopping · failed · suspended' },
            { de: 'session.lastStopReason: host_stopped (Launcher hat gestoppt) · host_timeout (kein Lebenszeichen) · session_limit (Laufzeit-Grenze) · admin', en: 'session.lastStopReason: host_stopped (launcher stopped it) · host_timeout (no heartbeat) · session_limit (runtime limit) · admin' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Starten, Lebenszeichen, Stoppen', en: 'Start, heartbeat, stop' },
      blocks: [
        {
          code: `curl -X POST {api}/servers/$ID/start -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" -d '{"acceptEula":true}'
curl -X POST {api}/servers/$ID/heartbeat -H "Authorization: Bearer $API_KEY"
curl -X POST {api}/servers/$ID/stop -H "Authorization: Bearer $API_KEY"`,
        },
        {
          ol: [
            { de: '„start“ aufrufen, danach GET /servers/{id} abfragen, bis state = running ist; dann „address“ zum Verbinden anzeigen.', en: 'Call “start”, then poll GET /servers/{id} until state = running; then show “address” for connecting.' },
            { de: 'Solange der Launcher offen ist: alle 30–60 Sekunden „heartbeat“. Die Antwort enthält session.remainingSeconds.', en: 'While the launcher is open: “heartbeat” every 30–60 seconds. The response contains session.remainingSeconds.' },
            { de: 'Beim Schließen: „stop“.', en: 'When closing: “stop”.' },
            { de: 'Antwortet „heartbeat“ mit not_running, ist die Sitzung beendet (Grund in fields.reason) – dem Spieler Bescheid sagen und ggf. „start“ anbieten.', en: 'If “heartbeat” answers not_running the session has ended (reason in fields.reason) – tell the player and offer “start” if appropriate.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Dateien, Mods und Welten', en: 'Files, mods and worlds' },
      blocks: [
        { p: { de: 'Alle Pfade gelten ab dem Hauptordner des Servers (z. B. /mods, /plugins, /config, /world). Der Server muss fertig installiert sein. Änderungen an Mods, Plugins und Einstellungen wirken nach dem nächsten Start.', en: 'All paths are relative to the server root (e.g. /mods, /plugins, /config, /world). The server must be fully installed. Changes to mods, plugins and settings take effect after the next start.' } },
        {
          ul: [
            { de: 'Kleine Dateien (bis 10 MB): PUT /servers/{id}/files/content?path=/mods/mein-mod.jar – der Inhalt der Datei ist der Körper der Anfrage.', en: 'Small files (up to 10 MB): PUT /servers/{id}/files/content?path=/mods/my-mod.jar – the file content is the request body.' },
            { de: 'Große Dateien (z. B. eine Welt als ZIP): POST …/files/upload-url liefert eine Adresse, die zehn Minuten gilt. Dorthin die Datei als multipart/form-data mit dem Feld „files“ schicken. Danach mit …/files/decompress entpacken.', en: 'Large files (e.g. a world as ZIP): POST …/files/upload-url returns a URL valid for ten minutes. Send the file there as multipart/form-data with the field “files”. Then extract it with …/files/decompress.' },
            { de: 'Modrinth: POST …/mods mit {"project":"<Kurzname oder ID>"} wählt die neueste Version, die zu Lader und Minecraft-Version des Servers passt, und lädt sie nach /mods (Fabric, Forge) bzw. /plugins (Paper, Purpur). Pflicht-Abhängigkeiten werden mit installiert ("dependencies": false schaltet das ab). Eine bestimmte Version: {"version":"<Versions-ID>"}.', en: 'Modrinth: POST …/mods with {"project":"<slug or id>"} picks the newest version matching the server’s loader and Minecraft version and loads it into /mods (Fabric, Forge) or /plugins (Paper, Purpur). Required dependencies are installed too ("dependencies": false turns that off). A specific version: {"version":"<version id>"}.' },
            { de: 'Eigene Dateien von deinem Server: POST …/files/pull mit einer https-Adresse.', en: 'Your own files from your server: POST …/files/pull with an https URL.' },
          ],
        },
        {
          code: `# Mod-Datei hochladen
curl -X PUT "{api}/servers/$ID/files/content?path=/mods/mein-mod.jar" \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/java-archive" --data-binary @mein-mod.jar

# Welt als ZIP: Adresse holen, hochladen, entpacken
URL=$(curl -s -X POST {api}/servers/$ID/files/upload-url -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" -d '{"directory":"/"}' | jq -r .url)
curl -X POST "$URL" -F "files=@welt.zip"
curl -X POST {api}/servers/$ID/files/decompress -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" -d '{"path":"/welt.zip"}'

# Mod von Modrinth
curl -X POST {api}/servers/$ID/mods -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" -d '{"project":"sodium"}'`,
        },
      ],
    },
    {
      heading: { de: 'Servereinstellungen', en: 'Server settings' },
      blocks: [
        { p: { de: 'PATCH /servers/{id}/settings setzt Werte in der server.properties – auch schon vor dem ersten Start. Es müssen nur die Werte mitgeschickt werden, die sich ändern sollen. „seed“ und „levelType“ wirken nur auf eine neu erzeugte Welt.', en: 'PATCH /servers/{id}/settings sets values in server.properties – even before the first start. Only send the values you want to change. “seed” and “levelType” only apply to a newly generated world.' } },
        {
          table: {
            head: [{ de: 'Feld', en: 'Field' }, { de: 'Werte', en: 'Values' }],
            rows: [
              ['motd', { de: 'Text, höchstens 120 Zeichen', en: 'Text, at most 120 characters' }],
              ['maxPlayers', '1–100'],
              ['gamemode', 'survival · creative · adventure · spectator'],
              ['difficulty', 'peaceful · easy · normal · hard'],
              ['hardcore, pvp, whitelist, allowFlight', 'true · false'],
              ['seed', { de: 'Text, höchstens 64 Zeichen', en: 'Text, at most 64 characters' }],
              ['levelType', 'normal · flat · large_biomes · amplified'],
              ['spawnProtection', '0–64'],
              ['viewDistance, simulationDistance', '3–16'],
            ],
          },
        },
        { code: `curl -X PATCH {api}/servers/$ID/settings -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"motd":"Mein Server","maxPlayers":8,"gamemode":"survival","difficulty":"normal","whitelist":true}'` },
      ],
    },
    {
      heading: { de: 'Konsole und Live-Werte', en: 'Console and live values' },
      blocks: [
        {
          ul: [
            { de: 'GET /servers/{id}/logs?lines=100 liefert die letzten Zeilen der Konsole (aus logs/latest.log; das Protokoll beginnt bei jedem Start neu). Für eine laufende Anzeige alle paar Sekunden abfragen.', en: 'GET /servers/{id}/logs?lines=100 returns the last console lines (from logs/latest.log; the log starts anew on every start). For a live view poll every few seconds.' },
            { de: 'GET /servers/{id}/stats liefert CPU (Prozent), Arbeitsspeicher und Speicherplatz (Bytes, jeweils mit Grenze), Netzwerk, Laufzeit und „players“ ({online, max} – null, solange der Server nicht antwortet).', en: 'GET /servers/{id}/stats returns CPU (percent), memory and disk (bytes, each with its limit), network, uptime and “players” ({online, max} – null while the server does not answer).' },
            { de: 'POST /servers/{id}/command schickt einen Befehl an die Konsole.', en: 'POST /servers/{id}/command sends a command to the console.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Adresse, Löschdatum und Anfrage-Limit', en: 'Address, deletion date and rate limit' },
      blocks: [
        {
          ul: [
            { de: 'Feste Adresse: „host“ und „port“ eines Servers bleiben gleich, solange es den Server gibt – ein eigener SRV-Eintrag ist also möglich. Ausnahme: Wir verlegen den Server auf andere Hardware; dann ändert sich die Adresse.', en: 'Fixed address: a server’s “host” and “port” stay the same as long as the server exists – so your own SRV record is possible. Exception: we move the server to other hardware; then the address changes.' },
            { de: '„deleteAt“ in jeder Server-Antwort: Wird der Server bis dahin nicht gestartet, wird er samt Daten gelöscht. Jeder Start verschiebt das Datum.', en: '“deleteAt” in every server response: if the server is not started by then it is deleted including its data. Every start pushes the date back.' },
            { de: '„session.hostPresent“: false bedeutet, der Launcher des Hosts meldet sich nicht mehr und der Server läuft nur noch, weil Spieler darauf sind.', en: '“session.hostPresent”: false means the host’s launcher no longer reports in and the server only keeps running because players are on it.' },
            { de: 'Anfrage-Limit: je API-Key und Minute, je nach Endpunkt 300 bis 12 000 Anfragen. Jede Antwort enthält X-RateLimit-Limit, X-RateLimit-Remaining und X-RateLimit-Reset (Sekunden bis zum Zurücksetzen). Bei Überschreitung: 429 mit Retry-After.', en: 'Rate limit: per API key and minute, 300 to 12,000 requests depending on the endpoint. Every response carries X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (seconds until reset). When exceeded: 429 with Retry-After.' },
          ],
        },
        {
          table: {
            head: [{ de: 'Endpunkte', en: 'Endpoints' }, { de: 'Anfragen je Minute', en: 'Requests per minute' }],
            rows: [
              ['POST /servers/{id}/heartbeat', '12 000'],
              ['GET /servers/{id}, GET /servers/{id}/stats', '6 000'],
              [{ de: 'Lesen, start, stop, command, logs, settings (GET), files (GET), POST /heartbeat', en: 'Reads, start, stop, command, logs, settings (GET), files (GET), POST /heartbeat' }, '1 200'],
              [{ de: 'Schreiben: Dateien, Mods, Einstellungen, Umbenennen, Löschen, GET /me', en: 'Writes: files, mods, settings, rename, delete, GET /me' }, '600'],
              ['POST /servers, POST /files/decompress', '300'],
            ],
          },
        },
      ],
    },
    {
      heading: { de: 'Fehler', en: 'Errors' },
      blocks: [
        { p: { de: 'Fehler kommen mit passendem HTTP-Status und diesem Aufbau:', en: 'Errors come with a matching HTTP status and this shape:' } },
        { code: `{ "error": { "code": "cooldown", "message": "…", "fields": { "cooldownUntil": "2026-11-18T17:59:37.077Z" } } }` },
        {
          table: {
            head: [{ de: 'Status', en: 'Status' }, { de: 'code', en: 'code' }, { de: 'Bedeutung', en: 'Meaning' }],
            rows: [
              ['401', 'invalid_api_key', { de: 'Key fehlt, ist falsch oder der Zugang ist deaktiviert', en: 'Key missing, wrong or access disabled' }],
              ['400', 'validation_error, invalid_name, invalid_player, server_type_unavailable, version_unavailable, invalid_json', { de: 'Angaben prüfen (Details in fields)', en: 'Check your input (details in fields)' }],
              ['404', 'not_found', { de: 'Server bzw. Spieler gibt es nicht (oder gehört nicht zu dir)', en: 'Server or player does not exist (or is not yours)' }],
              ['409', 'player_limit_reached', { de: 'Der Spieler hat schon die Höchstzahl an Servern', en: 'The player already has the maximum number of servers' }],
              ['409', 'partner_limit_reached', { de: 'Deine Höchstzahl an Servern ist erreicht', en: 'Your maximum number of servers has been reached' }],
              ['409', 'server_installing', { de: 'Der Server wird noch eingerichtet – gleich noch einmal versuchen', en: 'The server is still being set up – try again shortly' }],
              ['409', 'eula_required', { de: 'Erster Start: Der Spieler muss die Minecraft-EULA akzeptieren ("acceptEula": true)', en: 'First start: the player must accept the Minecraft EULA ("acceptEula": true)' }],
              ['409', 'cooldown', { de: 'Pflichtpause läuft noch (fields.cooldownUntil)', en: 'The mandatory pause is still running (fields.cooldownUntil)' }],
              ['409', 'not_running', { de: 'Keine laufende Sitzung (bei heartbeat und command)', en: 'No running session (for heartbeat and command)' }],
              ['409', 'server_failed, server_suspended', { de: 'Einrichtung fehlgeschlagen bzw. Server gesperrt', en: 'Setup failed or server suspended' }],
              ['400', 'invalid_path, invalid_url, file_rejected', { de: 'Pfad bzw. Adresse ungültig oder vom Server abgelehnt', en: 'Path or URL invalid or rejected by the server' }],
              ['404', 'file_not_found, mod_not_found', { de: 'Datei gibt es nicht bzw. bei Modrinth keine passende Version', en: 'File does not exist or no matching version on Modrinth' }],
              ['409', 'mods_unsupported, log_too_large', { de: 'Servertyp ohne Mods/Plugins bzw. Protokoll zu groß zum Abrufen', en: 'Server type without mods/plugins or log too large to fetch' }],
              ['429', 'rate_limited', { de: 'Zu viele Anfragen – die Grenzen gelten je API-Key', en: 'Too many requests – limits apply per API key' }],
              ['503', 'maintenance, unavailable, panel_unavailable', { de: 'Wartung bzw. vorübergehend nicht möglich – später erneut versuchen', en: 'Maintenance or temporarily unavailable – try again later' }],
            ],
          },
        },
      ],
    },
  ],
};
