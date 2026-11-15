# Installation auf Debian 12/13 und Ubuntu 22.04/24.04

Die Website läuft auf einem **eigenen Server** und spricht über die API mit deinem Pterodactyl-Panel – das Panel
kann (und sollte) auf einem anderen Server liegen. Du brauchst nur:

- einen frischen Server (root), dessen DNS-Eintrag (A/AAAA) auf ihn zeigt, Ports 80 + 443 offen
- die Adresse des Panels, z. B. `https://panel.craftinghosting.free`
- einen **Application-API-Key** (`ptla_…`, Panel → Admin → Application API: Users R/W, Servers R/W, Nests R, Nodes R,
  Locations R, Allocations R)
- einen **Client-API-Key** eines Admin-Kontos (`ptlc_…`, Panel → Account → API Credentials)

## Schnellweg: `install.sh`

```bash
git clone https://github.com/PwiePixel/craftinghosting.free.git
cd craftinghosting.free
sudo bash install.sh
```

Das Skript fragt Domain, Panel-Adresse, die beiden API-Keys, die Admin-E-Mail und (optional) SMTP ab, prüft die
Verbindung zum Panel und erledigt den Rest:

1. Node.js 22, Caddy und Hilfspakete installieren
2. Programm nach `/opt/craftinghosting-free` kopieren, bauen
3. `.env` schreiben (inkl. zufälligem `DATABASE_ENCRYPTION_KEY` und geheimem `ADMIN_PATH`)
4. verschlüsselte Datenbank unter `/var/lib/chfree/chfree.db` anlegen
5. systemd-Dienste `chfree-api`, `chfree-worker`, `chfree-web` einrichten und starten
6. Caddy mit automatischem HTTPS einrichten

Am Ende zeigt es die Adresse des geheimen Admin-Bereichs. Danach im Admin-Bereich:

- **Pterodactyl:** Nodes zuweisen (Minecraft-Nodes, eigene Node für Discord-Bots) und Eggs wählen
  (Python, Node.js – werden automatisch erkannt, „Alle Vorschläge übernehmen“)
- **Einstellungen:** Pakete, Kapazität, Fair-Use für Discord-Bots, Standorte, Spendenlink

Ohne Rückfragen (z. B. für Automatisierung):

```bash
sudo CHF_DOMAIN=craftinghosting.free CHF_PANEL_URL=https://panel.craftinghosting.free \
     CHF_PTERO_APP_KEY=ptla_… CHF_PTERO_CLIENT_KEY=ptlc_… CHF_ADMIN_EMAIL=du@example.com \
     bash install.sh --yes
```

Alle Optionen: `bash install.sh --help` · Probelauf ohne Änderungen: `bash install.sh --dry-run`

## Weitere Domains und Cloudflare Tunnel

Weitere Domains trägst du im Admin-Bereich unter **Domains** ein – ohne Neustart:

- **Direkt:** A-Eintrag der Domain auf die IP dieses Servers setzen (die Seite zeigt sie an). Das Zertifikat holt Caddy
  beim ersten Aufruf automatisch.
- **Cloudflare Tunnel** (Domain liegt bei Cloudflare, keine offenen Ports nötig):

```bash
sudo bash install.sh tunnel
```

  Danach im Admin unter *Domains → Cloudflare Tunnel*: „Link zum Freigeben erzeugen“, Link öffnen, Domain auswählen,
  „Tunnel einrichten“. Logs: `chfree logs tunnel`.

Nutzt du ein eigenes Caddyfile mit anderen Seiten, richtet der Installer die automatischen Zertifikate für weitere
Domains nicht ein (er fasst fremde Einstellungen nicht an) – nimm dann den Tunnel oder trage die Domain selbst ein.

## Betrieb

```bash
chfree status
```

```bash
chfree logs api
```

```bash
chfree update
```

```bash
chfree reconfigure
```

```bash
chfree backup
```

`chfree update` holt den neuesten Stand (git pull), baut neu, wendet Migrationen an und startet die Dienste neu.
`chfree reconfigure` stellt die Fragen erneut (Domain, Keys, SMTP) – Schlüssel und Admin-Pfad bleiben erhalten.

## Backup und Wiederherstellung

Die Datenbank ist eine **verschlüsselte SQLite-Datei**. Zum Wiederherstellen brauchst du **beides**:

- `/var/lib/chfree/chfree.db` (plus ggf. `chfree.db-wal`)
- `DATABASE_ENCRYPTION_KEY` aus `/opt/craftinghosting-free/.env`

`chfree backup` hält die Dienste kurz an und legt beides als `tar.gz` unter `/var/backups/chfree/` ab – kopiere die
Datei regelmäßig auf einen anderen Rechner. Wiederherstellen: Dienste stoppen (`systemctl stop 'chfree-*'`), Dateien
zurückspielen, Dienste starten.

Ohne den Schlüssel lässt sich die Datenbank nicht mehr öffnen. Das `sqlite3`-Kommandozeilenprogramm kann die Datei
nicht lesen – das ist Absicht.

## Fehlersuche

| Problem | Ursache / Lösung |
| --- | --- |
| Installer meldet HTTP 401/403 beim Panel | Key falsch oder ohne Rechte; Application-Key muss mit `ptla_`, Client-Key mit `ptlc_` beginnen |
| Installer erreicht das Panel nicht | Firewall/Cloudflare blockt den Server – dessen IP im Panel-Server bzw. bei Cloudflare freigeben |
| Kein HTTPS-Zertifikat | DNS zeigt noch nicht auf den Server oder Port 80/443 zu – `journalctl -u caddy -n 50` |
| Keine E-Mails | SMTP nicht eingerichtet → Links stehen im Log (`chfree logs api`); testen mit `chfree cli mail-test du@example.com` |
| „file is not a database“ | `DATABASE_ENCRYPTION_KEY` fehlt oder passt nicht zur Datei |
| Discord-Bots stehen auf „bald“ | Im Admin unter *Pterodactyl* ist noch keine Node oder kein Egg für Python/Node.js zugewiesen |
| Server wird nicht erstellt („Keine freie Allokation“) | Auf der Node im Panel weitere Ports (Allokationen) anlegen |
| Website hängt / lädt endlos | In der Unit `chfree-web` darf `HOSTNAME` nicht auf `127.0.0.1` stehen (siehe Kommentar in der Unit) |

## Von Hand (ohne Skript)

```bash
cp .env.example .env
```

In der `.env` mindestens setzen: `NODE_ENV=production`, `APP_URL`, `NEXT_PUBLIC_SITE_URL`, `DATABASE_PATH`,
`DATABASE_ENCRYPTION_KEY` (`openssl rand -hex 32`), `PTERODACTYL_MODE=live` + URL + Keys, `ADMIN_EMAILS`, `ADMIN_PATH`,
`RUN_JOBS_IN_API=false`. Dann:

```bash
npm ci && npm run build && (cd apps/api && node dist/migrate.js)
```

Anschließend die Units aus `deploy/systemd/` nach `/etc/systemd/system/` kopieren (Pfade anpassen) und einen Reverse
Proxy davor setzen: `/api/*` → `127.0.0.1:4000`, alles andere → `127.0.0.1:3000` (Beispiele: `deploy/Caddyfile`,
`deploy/nginx.example.conf`).

## Docker (Alternative)

```bash
cp .env.example .env
```

`DATABASE_ENCRYPTION_KEY`, `SITE_DOMAIN`, `APP_URL`, Pterodactyl-Werte und `ADMIN_*` eintragen, dann:

```bash
docker compose up -d --build
```

Die Datenbank liegt im Volume `chfree-data` (API und Worker teilen es sich).

## Umzug von der alten Version (MariaDB)

Die neue Version startet mit einer **leeren** Datenbank; Daten aus MariaDB werden nicht automatisch übernommen.
Bestehende Vormerkungen lassen sich im Admin unter *Warteliste → Personen hinzufügen* als E-Mail-Liste einspielen.
