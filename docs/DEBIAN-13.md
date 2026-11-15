# Installation auf Debian 13 (Trixie)

Alles läuft in Docker: MariaDB, Migration, API, Worker, Website und Caddy (HTTPS automatisch über Let's Encrypt).
Befehle als `root` (sonst `sudo` davor).

## 0. Voraussetzungen

- Debian 13 VPS/KVM, empfohlen mind. 2 GB RAM (der Next.js-Build braucht kurzzeitig Speicher)
- DNS: A-Record (und ggf. AAAA) für `craftinghosting.free` **und** `www.craftinghosting.free` → IP des Servers
- Ports 80 und 443 frei – kein anderer Webserver (Apache/nginx) auf dem System:
  `ss -ltnp | grep -E ':(80|443) '` muss leer sein, sonst `systemctl disable --now apache2 nginx`
- Pterodactyl-Panel über HTTPS vom Server aus erreichbar

## 1. System + Docker

```bash
apt update && apt full-upgrade -y
apt install -y ca-certificates curl unzip openssl

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

docker compose version   # Kontrolle
```

## 2. Projekt hochladen

Unter Windows (PowerShell, im Ordner mit der ZIP):

```powershell
scp .\craftinghosting-free.zip root@SERVER-IP:/opt/
```

Auf dem Server:

```bash
cd /opt && unzip craftinghosting-free.zip && cd craftinghosting-free
```

## 3. `.env` anlegen

```bash
cp .env.example .env && chmod 600 .env
openssl rand -hex 24   # zweimal ausführen → DB_PASSWORD und DB_ROOT_PASSWORD
nano .env
```

Ändern (alles andere kann bleiben – `DATABASE_URL`, `API_INTERNAL_URL`, `WEB_INTERNAL_URL`, `RUN_JOBS_IN_API` setzt Docker selbst):

| Variable | Wert |
| --- | --- |
| `NODE_ENV` | `production` |
| `SITE_DOMAIN` | `craftinghosting.free` |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | die zwei `openssl`-Werte (nur hex – Sonderzeichen wie `/ @ :` brechen die DB-URL) |
| `APP_URL`, `NEXT_PUBLIC_SITE_URL` | `https://craftinghosting.free` |
| `NEXT_PUBLIC_PANEL_URL`, `PTERODACTYL_PUBLIC_URL` | `https://panel.craftinghosting.free` |
| `PTERODACTYL_MODE` | `live` |
| `PTERODACTYL_URL` | Panel-Adresse, die der Server erreicht (meist dieselbe) |
| `PTERODACTYL_APP_KEY` | `ptla_…` – Panel → Admin → Application API: Users R/W, Servers R/W, Nests/Nodes/Locations/Allocations R |
| `PTERODACTYL_CLIENT_KEY` | `ptlc_…` – als **Admin** eingeloggt → Konto → API-Zugangsdaten |
| `PTERODACTYL_LOCATION_IDS` | ID(s) der Free-Location (Admin → Locations) |
| `PTERODACTYL_LOCATION_IDS_EPYC`, `_XEON` | optional: Locations für Early Access – die ersten Wartelisten-Plätze auf EPYC, der Rest auf Xeon (leer = `PTERODACTYL_LOCATION_IDS`) |
| `PTERODACTYL_EGG_PAPER` usw. | `nestId:eggId` (Admin → Nests → Egg), Zeilen einkommentieren |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Mailserver – ohne SMTP stehen die Mails nur im Log. `MAIL_FROM` leer lassen (dann ist das Postfach der Absender) |
| `ADMIN_EMAILS` | deine E-Mail-Adresse(n) für den Admin-Bereich |
| `ADMIN_PATH` | geheimer Pfad des Admin-Bereichs, z. B. Ausgabe von `echo "/team-$(openssl rand -hex 4)"` – nirgends verlinkt, für alle anderen 404 |

`NEXT_PUBLIC_*` wird beim Build fest eingebaut → nach Änderungen immer mit `--build` starten.

Produktregeln (Pakete, Fair-Use-Stunden, 30 Tage, Wartezeit vor Reaktivierung) stehen in
`packages/shared/src/config/freehosting.config.ts` – vor dem ersten Build prüfen.

## 4. Starten

```bash
docker compose up -d --build     # erster Build dauert einige Minuten
docker compose ps                # migrate = "Exited (0)" ist richtig, Rest "Up"
docker compose logs -f           # Strg+C beendet nur die Anzeige
```

Prüfen:

- `https://craftinghosting.free` lädt mit gültigem Zertifikat (Englisch; Deutsch unter `/de`)
- `curl https://craftinghosting.free/api/v1/health` → `{"ok":true,"db":1,"pterodactylMode":"live"}`
- `https://craftinghosting.free/status` → Pterodactyl „Operational“
- Einmal selbst einen Server mit eigener E-Mail erstellen und im Panel prüfen

## 5. Firewall (empfohlen)

```bash
apt install -y ufw
ufw allow 22/tcp          # SSH-Port anpassen, falls geändert – sonst sperrst du dich aus
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw enable
```

Die Datenbank ist nicht nach außen veröffentlicht, nur Caddy (80/443).

## 6. Betrieb

```bash
cd /opt/craftinghosting-free

docker compose logs -f api worker                     # Logs
docker compose up -d                                  # nach .env-Änderung – erstellt API/Worker mit den neuen Werten neu
                                                      # (docker compose restart liest die .env NICHT neu ein!)
docker compose run --rm api node dist/cli.js mail-test du@example.com   # E-Mail-Versand prüfen
docker compose up -d --build                          # nach Update oder NEXT_PUBLIC_*-Änderung
docker compose run --rm api node dist/cli.js run all  # alle Jobs einmal manuell

# Datenbank-Backup
docker compose exec -T mariadb sh -c 'mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction "$MARIADB_DATABASE"' > /root/chfree-$(date +%F).sql
```

**Update:** neue ZIP hochladen, `unzip -o craftinghosting-free.zip -d /opt` (die `.env` ist nicht in der ZIP und bleibt erhalten), dann `docker compose up -d --build`. Neue Datenbank-Migrationen (z. B. Einstellungen, Warteliste, Statusmeldungen) laufen dabei automatisch. Neue Variablen aus `.env.example` (zuletzt `ADMIN_PATH`, `PTERODACTYL_LOCATION_IDS_EPYC/_XEON`, `SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, `SESSION_PERSISTENT`) bei Bedarf in die eigene `.env` übernehmen; `SESSION_TTL_DAYS` wird nicht mehr verwendet und kann raus.

Nach einem Neustart des Servers startet alles von selbst (`restart: unless-stopped`).

## Admin-Bereich

1. In der `.env` `ADMIN_EMAILS=deine@adresse.de` und einen eigenen `ADMIN_PATH` (z. B. `/team-7f3k9`) eintragen, dann `docker compose up -d`.
2. Unter `https://craftinghosting.free/login` per E-Mail-Link anmelden.
3. `https://craftinghosting.free/team-7f3k9` (dein `ADMIN_PATH`) aufrufen – am besten als Lesezeichen.

Alternativ für ein bestehendes Konto: `docker compose run --rm api node dist/cli.js make-admin deine@adresse.de`. Der Pfad ist nirgends verlinkt und nicht indexierbar; ohne Admin-Rechte zeigt er eine normale 404-Seite.

Im Admin-Bereich stellst du ohne Neustart ein:

- **Wartungsmodus** (Übersicht → „Wartungsmodus starten“ oder Einstellungen) – Besucher sehen die Wartungsseite, du selbst die normale Website. Anmelden und „Meine Server“ funktionieren weiterhin, nur Registrieren ist gesperrt
- **Registrierung:** Offen · Vorregistrierung (Early Access mit Warteliste EPYC → Xeon) · Geschlossen, dazu Server pro Person
- **Warteliste:** Plätze freischalten (die nächsten N oder ausgewählte), Personen per E-Mail-Liste übernehmen, Vormerkungen als Anzahl mit „+ / −“ hinten anhängen (z. B. 23 Anmeldungen + 890 → nächster Platz #914); alle Listen zeigen 50 Einträge pro Seite mit Pfeilen zum Blättern
- **Nutzer löschen:** einzeln, per Häkchen (Umschalt + Klick für Bereiche), alle Treffer eines Filters (z. B. „E-Mail unbestätigt“) oder per E-Mail-Liste – inkl. ihrer kostenlosen Server
- **Statusseite:** Status je Dienst und Meldungen (Störung, Wartung, Hinweis)
- **Zahlen auf der Startseite:** registrierte Nutzer, aktive Server, Uptime – automatisch (+ Zusatz für Nutzer aus dem alten System) oder fester Wert
- **Kapazität je Paket:** maximale Plätze und außerhalb belegte Plätze („Noch X von Y frei“ / „Ausgebucht“), ebenso EPYC-Plätze gesamt und davon belegt

**Anmeldung:** Sitzungen enden beim Schließen des Browsers, nach 30 Minuten ohne Aktivität und spätestens nach 12 Stunden – danach meldet man sich (auch als Admin) neu per E-Mail-Link an. Mit dem Update werden alle bisherigen Anmeldungen einmalig beendet.

## Mock-Modus

`PTERODACTYL_MODE=mock` simuliert das Panel – gut, um den Ablauf auf dem Server zu testen. Es werden **keine echten Server** angelegt. Für den Betrieb `PTERODACTYL_MODE=live` mit echten Keys setzen und `docker compose up -d` ausführen.

## Fehlersuche

| Problem | Ursache / Lösung |
| --- | --- |
| Kein HTTPS-Zertifikat | DNS zeigt noch nicht auf den Server oder Port 80 blockiert → `docker compose logs caddy` |
| API startet nicht, „Ungültige Umgebungsvariablen“ | fehlender Wert in `.env` (im Live-Modus: URL, beide Keys, Location-ID) |
| Server-Erstellung schlägt fehl | Keys/Rechte, Egg- oder Location-ID falsch, keine freien Allokationen → `docker compose logs worker` |
| Keine E-Mails | `docker compose run --rm api node dist/cli.js mail-test du@example.com` – zeigt die Einstellungen, testet andere Ports und nennt die Ursache. Nach Änderungen an der `.env`: `docker compose up -d` |
| „Ein interner Fehler“ beim Panel-Zugang | `docker compose logs api` – meist Panel nicht erreichbar oder API-Key/Rechte falsch |
| Port 80/443 belegt | anderer Webserver läuft → `systemctl disable --now apache2 nginx` |
| Build bricht ohne Meldung ab, `docker compose ps` ist leer | meist zu wenig RAM → `dmesg \| grep -i "killed process"`; Swap anlegen (unten) und nacheinander bauen: `docker compose build migrate && docker compose build web && docker compose up -d` |

**Swap anlegen (4 GB):**

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```
