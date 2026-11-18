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
              ['PATCH', '/servers/{id}', { de: 'Umbenennen: {"name":"…"} · Typ/Version wechseln: {"serverType":"…","version":"…"}', en: 'Rename: {"name":"…"} · change type/version: {"serverType":"…","version":"…"}' }],
              ['POST', '/servers/{id}/reinstall', { de: 'Neu installieren (Server muss aus sein)', en: 'Reinstall (server must be off)' }],
              ['GET', '/servers/{id}/console/stream', { de: 'Konsole live (Server-Sent Events)', en: 'Live console (server-sent events)' }],
              ['GET / POST', '/servers/{id}/backups', { de: 'Backups auflisten bzw. anlegen', en: 'List or create backups' }],
              ['GET / PUT / DELETE', '/webhook', { de: 'Webhook für Statuswechsel', en: 'Webhook for status changes' }],
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
            { de: 'session.lastStopReason: host_stopped (Launcher hat gestoppt) · host_timeout (kein Lebenszeichen) · session_limit (Laufzeit-Grenze) · settings_limit (Einstellungen über den Grenzen) · admin', en: 'session.lastStopReason: host_stopped (launcher stopped it) · host_timeout (no heartbeat) · session_limit (runtime limit) · settings_limit (settings above the limits) · admin' },
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
            { de: 'GET /servers/{id}/console/stream liefert die Konsole live als Server-Sent Events (text/event-stream) – ohne ständiges Abfragen.', en: 'GET /servers/{id}/console/stream delivers the console live as server-sent events (text/event-stream) – no polling needed.' },
          ],
        },
        {
          table: {
            head: [{ de: 'Ereignis', en: 'Event' }, { de: 'Inhalt (data, immer JSON)', en: 'Content (data, always JSON)' }],
            rows: [
              ['line', { de: 'Eine Zeile der Konsole als JSON-Text, z. B. "[12:00:01] Done (4.2s)!"', en: 'One console line as a JSON string, e.g. "[12:00:01] Done (4.2s)!"' }],
              ['status', { de: '{"state":"running"} – Wechsel des Zustands', en: '{"state":"running"} – state change' }],
              ['info', { de: '{"source":"live"} oder {"source":"log"} – woher die Zeilen kommen', en: '{"source":"live"} or {"source":"log"} – where the lines come from' }],
              ['end', { de: '{"reason":"max_duration"} – Verbindung beendet; bei Bedarf neu verbinden', en: '{"reason":"max_duration"} – connection ended; reconnect if needed' }],
            ],
          },
        },
        { code: `curl -N {api}/servers/$ID/console/stream -H "Authorization: Bearer $API_KEY"

event: info
data: {"source":"live"}

event: line
data: "[12:00:01] [Server thread/INFO]: Done (4.2s)!"` },
        {
          ul: [
            { de: 'Der Stream ist nur lesend. Befehle gehen weiter über POST /servers/{id}/command.', en: 'The stream is read-only. Commands still go through POST /servers/{id}/command.' },
            { de: 'Eine Verbindung läuft höchstens 15 Minuten (danach „end“ – einfach neu verbinden). Gleichzeitig offen: höchstens 3 je Server und 50 insgesamt, sonst 429 too_many_streams.', en: 'A connection lasts at most 15 minutes (then “end” – simply reconnect). Open at the same time: at most 3 per server and 50 in total, otherwise 429 too_many_streams.' },
            { de: 'Ein offener Stream ist kein Lebenszeichen: POST /servers/{id}/heartbeat muss weiter kommen.', en: 'An open stream is not a heartbeat: POST /servers/{id}/heartbeat must keep coming.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Backups', en: 'Backups' },
      blocks: [
        { p: { de: 'Wie viele Backups ein Server haben darf, legt euer Paket fest („limit“ in der Liste). Ist die Zahl erreicht, zuerst ein älteres löschen.', en: 'How many backups a server may have is set by your plan (“limit” in the list). Once reached, delete an older one first.' } },
        {
          table: {
            head: [{ de: 'Methode', en: 'Method' }, { de: 'Pfad', en: 'Path' }, { de: 'Zweck', en: 'Purpose' }],
            rows: [
              ['GET', '/servers/{id}/backups', { de: 'Liste mit „limit“ und Zustand je Backup (creating, ready, failed)', en: 'List with “limit” and the state of each backup (creating, ready, failed)' }],
              ['POST', '/servers/{id}/backups', { de: 'Backup anlegen: {"name":"Vor dem Update"} (Name freiwillig)', en: 'Create a backup: {"name":"Before the update"} (name optional)' }],
              ['GET', '/servers/{id}/backups/{backup}/download-url', { de: 'Adresse zum Herunterladen (kurz gültig)', en: 'Download URL (valid briefly)' }],
              ['POST', '/servers/{id}/backups/{backup}/restore', { de: 'Einspielen: {"truncate":false} – mit true werden vorher alle Dateien gelöscht', en: 'Restore: {"truncate":false} – true deletes all files first' }],
              ['DELETE', '/servers/{id}/backups/{backup}', { de: 'Backup löschen', en: 'Delete the backup' }],
            ],
          },
        },
        {
          ul: [
            { de: 'Einspielen geht nur, wenn der Server aus ist und keine Sitzung läuft (sonst 409 server_running). Danach warten, bis der Zustand wieder „offline“ ist, und normal starten.', en: 'Restoring only works while the server is off and no session is running (otherwise 409 server_running). Then wait until the state is “offline” again and start normally.' },
            { de: 'Je Server: höchstens 2 neue Backups und 2 Einspielungen in 10 Minuten (429 too_often), und immer nur ein Backup-Vorgang zugleich (409 backup_busy).', en: 'Per server: at most 2 new backups and 2 restores per 10 minutes (429 too_often), and only one backup operation at a time (409 backup_busy).' },
            { de: 'Ein Backup ändert nichts an Laufzeit, Pause oder Löschdatum. Wird ein Server gelöscht, werden seine Backups mit gelöscht.', en: 'A backup changes nothing about runtime, pause or deletion date. When a server is deleted, its backups are deleted with it.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Servertyp und Version', en: 'Server type and version' },
      blocks: [
        { p: { de: 'Angeboten werden Paper, Purpur, Vanilla, Fabric, Forge, NeoForge und Quilt – welche Typen und Versionen für euch freigeschaltet sind, steht in GET /me („serverTypes“). Beim Erstellen gebt ihr „serverType“ und „version“ an; „latest“ ist die neueste veröffentlichte Version.', en: 'Paper, Purpur, Vanilla, Fabric, Forge, NeoForge and Quilt are offered – which types and versions are enabled for you is listed in GET /me (“serverTypes”). When creating you pass “serverType” and “version”; “latest” is the newest released version.' } },
        { p: { de: 'Die Server-Software wird nach der Grundinstallation automatisch eingerichtet (inklusive passender Java-Version). So lange ist der Zustand „installing“, und „install“ in der Server-Antwort zeigt den Fortschritt. Erst wenn der Zustand „offline“ ist, lässt sich der Server starten.', en: 'The server software is set up automatically after the base installation (including the matching Java version). Meanwhile the state is “installing” and “install” in the server response shows the progress. Only once the state is “offline” can the server be started.' } },
        { code: `"state": "installing",
"install": { "status": "installing", "serverType": "fabric", "version": "1.21.11", "build": "0.20.1", "step": 1, "steps": 1, "error": null }` },
        { p: { de: 'PATCH /servers/{id} mit „serverType“ und/oder „version“ stellt einen vorhandenen Server um – ohne ihn zu löschen. POST /servers/{id}/reinstall richtet die aktuelle Software noch einmal ein.', en: 'PATCH /servers/{id} with “serverType” and/or “version” switches an existing server – without deleting it. POST /servers/{id}/reinstall sets up the current software once more.' } },
        { code: `curl -X PATCH {api}/servers/$ID -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"serverType":"fabric","version":"1.21.1"}'` },
        {
          ul: [
            { de: 'Der Server muss aus sein und darf keine laufende Sitzung haben (sonst 409 server_running).', en: 'The server must be off with no running session (otherwise 409 server_running).' },
            { de: 'Während der Einrichtung antworten Starten und Dateizugriffe mit 409 server_installing. Mit einem Webhook kommt „server.installed“, sobald alles fertig ist – oder „server.install_failed“.', en: 'During setup, starting and file access answer 409 server_installing. With a webhook you get “server.installed” once everything is done – or “server.install_failed”.' },
            { de: 'Schlägt die Einrichtung fehl, ist der Zustand „failed“ und „install.error“ nennt den Grund. Starten antwortet dann mit 409 server_failed; mit POST /reinstall oder einem erneuten PATCH wird es noch einmal versucht.', en: 'If setup fails, the state is “failed” and “install.error” gives the reason. Starting then answers 409 server_failed; POST /reinstall or another PATCH tries again.' },
            { de: 'Welt, Mods/Plugins und übrige Dateien bleiben beim Wechsel erhalten; ersetzt wird die Server-Software. Mods eines anderen Laders räumt ihr selbst auf (Fabric-Mods laufen nicht unter Forge). Eine Welt aus einer neueren Version lässt sich nicht mit einer älteren öffnen.', en: 'World, mods/plugins and other files are kept when switching; the server software is replaced. Clean up mods of another loader yourselves (Fabric mods do not run under Forge). A world from a newer version cannot be opened with an older one.' },
            { de: 'Paket, Arbeitsspeicher, Adresse, Laufzeit-Stand, Pflichtpause und EULA-Zustimmung bleiben unverändert. Startbefehl, Image oder Ressourcen lassen sich nicht mitgeben.', en: 'Plan, memory, address, runtime counter, mandatory pause and EULA acceptance stay unchanged. Startup command, image or resources cannot be passed.' },
            { de: 'Je Server höchstens 3 Wechsel bzw. Neuinstallationen pro Stunde (429 too_often).', en: 'At most 3 switches or reinstalls per server per hour (429 too_often).' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Webhooks', en: 'Webhooks' },
      blocks: [
        { p: { de: 'Statt ständig abzufragen, könnt ihr euch Statuswechsel schicken lassen. Je Zugang gibt es eine Adresse. Beim Setzen bekommt ihr einmalig ein Geheimnis (whsec_…), mit dem ihr jede Zustellung prüft.', en: 'Instead of polling you can have status changes sent to you. There is one URL per access. When setting it you receive a secret once (whsec_…) with which you verify every delivery.' } },
        {
          table: {
            head: [{ de: 'Methode', en: 'Method' }, { de: 'Pfad', en: 'Path' }, { de: 'Zweck', en: 'Purpose' }],
            rows: [
              ['PUT', '/webhook', { de: '{"url":"https://…"} setzen oder ändern – Antwort enthält „secret“ (nur dieses eine Mal)', en: 'Set or change {"url":"https://…"} – the response contains “secret” (this one time only)' }],
              ['GET', '/webhook', { de: 'Adresse, wartende Ereignisse und die letzten Zustellungen', en: 'URL, pending events and the latest deliveries' }],
              ['POST', '/webhook/test', { de: 'Test-Ereignis „webhook.test“ schicken', en: 'Send the test event “webhook.test”' }],
              ['DELETE', '/webhook', { de: 'Webhook entfernen', en: 'Remove the webhook' }],
            ],
          },
        },
        {
          table: {
            head: [{ de: 'Ereignis', en: 'Event' }, { de: 'Wann', en: 'When' }, { de: 'Zusätzlich in data', en: 'Additionally in data' }],
            rows: [
              ['server.installed', { de: 'Installation bzw. Einrichtung der Server-Software fertig', en: 'Installation or software setup finished' }, 'address'],
              ['server.install_failed', { de: 'Einrichtung der Server-Software fehlgeschlagen', en: 'Setting up the server software failed' }, 'serverType, version, error'],
              ['server.running', { de: 'Server ist hochgefahren und erreichbar', en: 'Server is up and reachable' }, 'address'],
              ['server.stopped', { de: 'Sitzung beendet', en: 'Session ended' }, 'reason (host_stopped · host_timeout · session_limit · settings_limit · admin), cooldownUntil'],
              ['server.cooldown_ended', { de: 'Pflichtpause vorbei – Start wieder möglich', en: 'Mandatory pause over – start possible again' }, '–'],
              ['server.deletion_soon', { de: 'Server wird bald wegen Nichtnutzung gelöscht', en: 'Server will soon be deleted for inactivity' }, 'deleteAt'],
              ['server.deleted', { de: 'Server wegen Nichtnutzung gelöscht', en: 'Server deleted for inactivity' }, 'reason'],
            ],
          },
        },
        { p: { de: 'Jede Zustellung ist ein POST mit JSON. „data“ enthält immer serverId, name und playerId.', en: 'Every delivery is a POST with JSON. “data” always contains serverId, name and playerId.' } },
        { code: `POST https://euer-backend.example/chf-webhook
X-CHF-Event: server.stopped
X-CHF-Delivery: 5b0c…            (ID des Ereignisses – bei Wiederholungen gleich)
X-CHF-Timestamp: 1795025048
X-CHF-Signature: sha256=<HMAC-SHA256 über "<Timestamp>.<Körper>" mit eurem Geheimnis>

{"id":"5b0c…","type":"server.stopped","createdAt":"2026-11-18T18:04:08.000Z",
 "data":{"serverId":"…","name":"Meine Welt #PAB12CD3","playerId":"PAB12CD3","reason":"host_timeout","cooldownUntil":null}}` },
        { code: `// Prüfen der Signatur (Node.js) – immer über den unveränderten Körper der Anfrage
import { createHmac, timingSafeEqual } from 'node:crypto';

function verify(rawBody, headers, secret) {
  const ts = headers['x-chf-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // älter als 5 Minuten: ablehnen
  const expected = 'sha256=' + createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex');
  const got = String(headers['x-chf-signature'] ?? '');
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}` },
        {
          ul: [
            { de: 'Die Adresse muss https auf dem Standard-Port sein und öffentlich erreichbar; Weiterleitungen folgen wir nicht.', en: 'The URL must be https on the default port and publicly reachable; we do not follow redirects.' },
            { de: 'Antwortet mit einem 2xx-Status innerhalb von 5 Sekunden. Sonst versuchen wir es erneut: nach 30 Sekunden, 2 Minuten, 10 Minuten, 1 Stunde und 6 Stunden – danach gilt die Zustellung als fehlgeschlagen.', en: 'Answer with a 2xx status within 5 seconds. Otherwise we retry: after 30 seconds, 2 minutes, 10 minutes, 1 hour and 6 hours – after that the delivery counts as failed.' },
            { de: 'Ereignisse können doppelt oder in anderer Reihenfolge ankommen. Merkt euch die „id“ und fragt im Zweifel den Stand mit GET /servers/{id} ab.', en: 'Events may arrive twice or out of order. Remember the “id” and when in doubt fetch the state with GET /servers/{id}.' },
            { de: 'Webhooks sind reine Benachrichtigungen: Eure Antwort ändert nichts am Server. Gestartet wird weiterhin nur über POST /servers/{id}/start.', en: 'Webhooks are notifications only: your response changes nothing on the server. Starting still only happens through POST /servers/{id}/start.' },
          ],
        },
      ],
    },
    {
      heading: { de: 'Regeln, die immer gelten', en: 'Rules that always apply' },
      blocks: [
        { p: { de: 'Damit die Integration nicht an unerwarteten Stellen hängen bleibt: Diese Regeln setzt unser System fest durch – unabhängig davon, über welchen Endpunkt etwas geändert wurde.', en: 'So your integration does not get stuck in unexpected places: our system enforces these rules firmly – regardless of which endpoint was used to change something.' } },
        {
          ul: [
            { de: 'Laufzeit und Pflichtpause gehören zum Spieler: Wird ein Server gelöscht und neu erstellt, gelten die bereits gelaufene Zeit und eine laufende Pause weiter.', en: 'Runtime and mandatory pause belong to the player: if a server is deleted and recreated, the time already run and a running pause continue to apply.' },
            { de: 'Gelöschte Server geben ihren Platz erst frei, wenn ihre Pause vorbei ist: Ein Server in der Pflichtpause (oder mit Laufzeit aus den letzten Stunden) zählt nach dem Löschen so lange weiter zu eurer Höchstzahl – außer derselbe Spieler erstellt einen neuen, der den Stand übernimmt.', en: 'Deleted servers only free their slot once their break is over: a server in its mandatory pause (or with runtime from the last hours) keeps counting towards your maximum after deletion for that long – unless the same player creates a new one, which takes over the state.' },
            { de: 'Ein neuer Start geht erst, wenn der Server aus der vorigen Sitzung wirklich aus ist (bis dahin 409 server_stopping – nach ein paar Sekunden erneut versuchen).', en: 'A new start only works once the server from the previous session is really off (until then 409 server_stopping – retry after a few seconds).' },
            { de: 'Ohne laufende Sitzung ist ein Server aus. Reagiert er nicht auf den Stopp-Befehl, wird er nach 2 Minuten hart beendet (nicht gespeicherte Änderungen können dann fehlen).', en: 'Without a running session a server is off. If it does not react to the stop command, it is killed after 2 minutes (unsaved changes may then be missing).' },
            { de: 'Die Grenzen der Servereinstellungen (z. B. maxPlayers 1–100, viewDistance 3–16) gelten auch für eine hochgeladene server.properties: Vor jedem Start werden zu hohe Werte zurückgesetzt. Bei Paper und Purpur gilt das auch für die Sichtweite in der spigot.yml. Läuft ein Server trotzdem mit Werten über den Grenzen, wird er gestoppt und bekommt eine Pflichtpause (reason: settings_limit).', en: 'The limits of the server settings (e.g. maxPlayers 1–100, viewDistance 3–16) also apply to an uploaded server.properties: before every start, values that are too high are reset. For Paper and Purpur this also applies to the view distance in spigot.yml. If a server still runs with values above the limits, it is stopped and gets a mandatory pause (reason: settings_limit).' },
            { de: '„Weiterlaufen, solange Spieler online sind“ gilt höchstens 2 Stunden ohne Lebenszeichen des Hosts.', en: '“Keep running while players are online” applies for at most 2 hours without a heartbeat from the host.' },
            { de: 'Ein Server lässt sich nicht löschen, solange er noch eingerichtet wird (409 server_installing) oder von uns gesperrt ist (409 server_suspended).', en: 'A server cannot be deleted while it is still being set up (409 server_installing) or suspended by us (409 server_suspended).' },
            { de: 'Während einer Wartung sind Erstellen, Starten, Löschen, Neuinstallieren und Backups gesperrt (503 maintenance). Lesen geht weiter.', en: 'During maintenance, creating, starting, deleting, reinstalling and backups are blocked (503 maintenance). Reading still works.' },
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
            { de: 'Anfrage-Limit: je Zugang und Minute, je nach Endpunkt 30 bis 12 000 Anfragen. Jede Antwort enthält X-RateLimit-Limit, X-RateLimit-Remaining und X-RateLimit-Reset (Sekunden bis zum Zurücksetzen). Bei Überschreitung: 429 mit Retry-After. Ein neuer API-Key setzt die Zähler nicht zurück.', en: 'Rate limit: per access and minute, 30 to 12,000 requests depending on the endpoint. Every response contains X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (seconds until reset). When exceeded: 429 with Retry-After. A new API key does not reset the counters.' },
            { de: 'Zusätzlich gibt es eine Obergrenze für Anfragen, die wir an die Server-Verwaltung weiterreichen müssen (Dateien, Einstellungen, Backups, Zustand). Wer sehr dicht abfragt, bekommt 429 panel_busy – dann seltener abfragen. GET /servers/{id}/stats und der Zustand in GET /servers/{id} sind 5 Sekunden zwischengespeichert; die Liste GET /servers zeigt den zuletzt bekannten Zustand (höchstens eine Minute alt). Für Statuswechsel sind Webhooks der bessere Weg.', en: 'In addition there is a cap on requests we have to pass on to the server management (files, settings, backups, state). If you poll very densely you get 429 panel_busy – then poll less often. GET /servers/{id}/stats and the state in GET /servers/{id} are cached for 5 seconds; the list GET /servers shows the last known state (at most one minute old). For status changes, webhooks are the better way.' },
          ],
        },
        {
          table: {
            head: [{ de: 'Endpunkte', en: 'Endpoints' }, { de: 'Anfragen je Minute', en: 'Requests per minute' }],
            rows: [
              ['POST /servers/{id}/heartbeat', '12 000'],
              ['GET /servers/{id}, GET /servers/{id}/stats', '6 000'],
              [{ de: 'Lesen, start, stop, command, logs, settings (GET), files (GET), Backups (GET), POST /heartbeat', en: 'Reads, start, stop, command, logs, settings (GET), files (GET), backups (GET), POST /heartbeat' }, '1 200'],
              [{ de: 'Schreiben: Dateien, Mods, Einstellungen, Löschen, GET /me, GET /webhook, Backup-Download', en: 'Writes: files, mods, settings, delete, GET /me, GET /webhook, backup download' }, '600'],
              [{ de: 'POST /servers, POST /files/decompress, PATCH /servers/{id}, DELETE Backup, GET /console/stream', en: 'POST /servers, POST /files/decompress, PATCH /servers/{id}, DELETE backup, GET /console/stream' }, '300'],
              [{ de: 'Backup anlegen/einspielen, POST /reinstall', en: 'Create/restore backup, POST /reinstall' }, '60'],
              [{ de: 'Webhook setzen, löschen, testen', en: 'Set, delete, test webhook' }, '30'],
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
              ['409', 'server_failed, server_suspended', { de: 'Einrichtung fehlgeschlagen (Details in „install.error“; POST /reinstall versucht es erneut) bzw. Server gesperrt', en: 'Setup failed (details in “install.error”; POST /reinstall retries) or server suspended' }],
              ['400', 'invalid_path, invalid_url, file_rejected', { de: 'Pfad bzw. Adresse ungültig oder vom Server abgelehnt', en: 'Path or URL invalid or rejected by the server' }],
              ['404', 'file_not_found, mod_not_found', { de: 'Datei gibt es nicht bzw. bei Modrinth keine passende Version', en: 'File does not exist or no matching version on Modrinth' }],
              ['409', 'mods_unsupported, log_too_large', { de: 'Servertyp ohne Mods/Plugins bzw. Protokoll zu groß zum Abrufen', en: 'Server type without mods/plugins or log too large to fetch' }],
              ['409', 'server_stopping', { de: 'Der Server fährt aus der vorigen Sitzung noch herunter – in ein paar Sekunden erneut starten', en: 'The server is still shutting down from the previous session – start again in a few seconds' }],
              ['409', 'server_running', { de: 'Dafür muss der Server aus sein (Backup einspielen, Typ/Version wechseln, neu installieren)', en: 'The server must be off for this (restore backup, change type/version, reinstall)' }],
              ['409', 'state_changed', { de: 'Der Stand hat sich gerade geändert (z. B. Laufzeit-Grenze im selben Moment erreicht) – noch einmal versuchen', en: 'The state has just changed (e.g. runtime limit reached at the same moment) – try again' }],
              ['409 / 404', 'backup_limit, backup_busy, backup_rejected, backup_not_found', { de: 'Höchstzahl erreicht, Vorgang läuft schon, vom Server abgelehnt bzw. Backup gibt es nicht', en: 'Maximum reached, operation already running, rejected by the server or backup does not exist' }],
              ['409', 'no_webhook', { de: 'Es ist kein Webhook eingerichtet', en: 'No webhook is configured' }],
              ['429', 'rate_limited', { de: 'Zu viele Anfragen – die Grenzen gelten je Zugang', en: 'Too many requests – limits apply per access' }],
              ['429', 'panel_busy, too_often, too_many_streams, backup_rate_limited', { de: 'Zu dicht abgefragt, zu viele Backups/Neuinstallationen in kurzer Zeit bzw. zu viele offene Konsolen-Streams', en: 'Polled too densely, too many backups/reinstalls in a short time or too many open console streams' }],
              ['400', 'version_unavailable', { de: 'Die Version gibt es für diesen Servertyp (gerade) nicht', en: 'The version is (currently) not available for this server type' }],
              ['503', 'maintenance, unavailable, panel_unavailable', { de: 'Wartung bzw. vorübergehend nicht möglich – später erneut versuchen', en: 'Maintenance or temporarily unavailable – try again later' }],
            ],
          },
        },
      ],
    },
  ],
};
