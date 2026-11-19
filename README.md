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
| **Pterodactyl automatisch** | Admin → *Pterodactyl* liest Nodes (mit freien Ports) und alle Eggs aus dem Panel. Dort wählst du die Nodes für Minecraft, die Node für Discord-Bots und die Eggs je Servertyp (Vorschläge per Klick). Discord-Bots werden **nur** auf ihrer Node erstellt, Minecraft-Server nie darauf. **Private Nodes:** Mit dem Häkchen „Privat“ wird eine Node nie für kostenlose Server verwendet – weder für Minecraft noch für Discord-Bots, auch nicht ersatzweise. Sind die übrigen Nodes voll, schlägt die Erstellung fehl (Grund steht unter Admin → *Server*), statt auf eine private Node auszuweichen. Bei automatischer Verteilung prüft das System dafür selbst, ob eine Node laut Panel noch Arbeitsspeicher und Speicherplatz frei hat. |
| **Upgrade & Umzug einzelner Server** | Admin → *Server* → „Upgrade / Umzug“: einem Kunden-Server ein anderes Paket geben (auch ein nicht öffentliches – so lässt sich ein eigenes Upgrade-Paket anlegen) und ihn auf eine bestimmte Node umziehen, auch auf eine **private**. Das Paket wird sofort im Panel gesetzt (Daten und Port bleiben). Auf Wunsch wird der Server als **Upgrade** gekennzeichnet (grüner Hinweis unter „Meine Server“, optional mit Text vom Team) und der Kunde per E-Mail und Discord-Direktnachricht informiert. **Umzug:** Er startet sofort und automatisch. Pelican bietet dafür eine Schnittstelle. Das klassische Pterodactyl nicht – dort meldet sich das System mit einem Panel-Admin-Konto im Admin-Bereich des Panels an und startet den Umzug selbst (Zugang einmalig unter Admin → *Pterodactyl* → „Automatischer Umzug“ hinterlegen und testen; verschlüsselt gespeichert). Voraussetzungen: Das Konto ist Panel-Admin, reCAPTCHA ist im Panel ausgeschaltet (Settings → Advanced), bei Zwei-Faktor-Anmeldung wird der geheime Schlüssel hinterlegt. Ohne Zugang wird der Umzug nur vorgemerkt und du verschiebst den Server im Panel. **Ports:** Mit „Alle Ports mitnehmen“ behält der Server alle Portnummern, die auf der Ziel-Node frei sind; für belegte bekommt er gleich viele andere freie Ports (sind zu wenige frei, startet der Umzug nicht). In allen Fällen prüft ein Job jede Minute, ob der Server auf der neuen Node liegt, übernimmt die neue Adresse und schickt dem Kunden eine zweite Nachricht. „Jetzt abgleichen“ und „Umzug abbrechen“ stehen im Dialog. |
| **Server-Software (Katalog)** | Admin → *Einstellungen* → „Server-Software“: Hier legst du fest, was beim Erstellen eines Minecraft-Servers zur Wahl steht (je Software getrennt für die Website und die Partner-API) und **wie** es installiert wird. **Über MCJars:** Für alles, was es im Software-Verzeichnis MCJars gibt (Paper, Purpur, Fabric, Forge, NeoForge, Quilt, Spigot, Folia, Leaf und eigene Einträge wie Mohist), ist kein eigenes Egg nötig – das Panel legt den Server mit der **Grundlage** an (ein Nest/Egg, das du im selben Abschnitt auswählst; ohne Auswahl das Egg, das Paper zugeordnet ist), danach richtet der Job `partner-software` die gewählte Software in der gewählten Version ein und setzt die passende Java-Version aus den Images der Grundlage. Der Server ist erst danach startbar (Anzeige „wird eingerichtet“); schlägt die Einrichtung fehl, wird sie bis zu fünfmal automatisch wiederholt, danach hilft Admin → *Server* → „Software neu einrichten“. **Über ein eigenes Egg:** je Software einstellbar („Automatisch“ nimmt ein zugeordnetes eigenes Egg, sonst MCJars). **Nur mit eigenem Egg** laufen Bedrock (Bedrock, PocketMine-MP, Nukkit) und Proxys (Velocity, BungeeCord): Für sie lässt sich MCJars nicht wählen, und ohne zugeordnetes Egg werden sie nirgends angeboten – so kann kein Server mit falscher Grundlage entstehen. Die Grundlage sollte ein einfaches Java-Egg sein (Startbefehl `java … -jar server.jar`, Images für mehrere Java-Versionen), z. B. das Paper-Egg. Eigene Einträge lassen sich hinzufügen und wieder entfernen; die Versionslisten darunter gelten je Eintrag. |
| **Verwarnungs-System** | Jede Abuse-Mail aus dem Admin-Bereich zählt als eine Verwarnung (im Formular abwählbar: „nur ein Hinweis“); unter Admin → *Abuse* → „Verwarnungen“ lassen sich Verwarnungen auch ohne Abuse-Mail vergeben und wieder zurücknehmen. Automatische Fair-Use-Meldungen zählen nicht. **Folgen:** ab der 2. aktiven Verwarnung sind alle Dienste des Nutzers 48 Stunden offline (Server werden gesperrt und danach automatisch wieder freigegeben, Job `user-sanctions`), bei der 4. wird das Konto dauerhaft gesperrt: Server gesperrt und nach 14 Tagen gelöscht, E-Mail-Adresse und Discord-Konto kommen als Fingerabdruck auf eine Sperrliste, die auch nach dem Löschen des Kontos gilt (keine Neuanmeldung). Verwarnungen verfallen nach 180 Tagen. Auszeit vorzeitig beenden und Ban aufheben: Knöpfe beim Nutzer in der Verwarnungs-Liste („Entsperren“ unter *Nutzer* hebt einen Ban ebenfalls vollständig auf). Admins und Konten von API-Partnern werden nie automatisch gesperrt. **Löschsperre:** Ein Server mit Abuse-Markierung (oder Sperre wegen Abuse/Verwarnung) lässt sich vom Nutzer nicht löschen, das eigene Konto in der Zeit ebenfalls nicht – erst wieder, wenn die Markierung im Admin-Bereich aufgehoben ist. Solange eine Verwarnung aktiv ist oder ein Abuse-Fall offen ist, lassen sich außerdem E-Mail-Adresse und Discord-Verknüpfung nicht ändern; markierte Server und Server gesperrter Nutzer löscht auch der 30-Tage-Zyklus nicht (die Frist beginnt nach dem Aufheben neu). Die Sperrliste erkennt bei E-Mail-Adressen auch `+Zusatz` und bei Gmail die Punkt-Schreibweise. Die Zahlen stehen in `packages/shared/src/rules/warnings.ts`. |
| **Partner-API (z. B. Minecraft-Launcher)** | Admin → *Partner-API*: Partner anlegen – dabei entstehen automatisch ein Konto mit dem Namen des Partners, ein Panel-Konto und ein API-Key (nur einmal sichtbar, gespeichert wird ein Fingerabdruck). Über die API (`/api/v1/partner/…`, Beschreibung in [`docs/partner-api.md`](docs/partner-api.md)) erstellt und steuert der Partner Server für seine Nutzer. Jeder Nutzer bekommt automatisch eine Spieler-ID, die im Servernamen steht; alle Server laufen unter dem Konto des Partners. **Laufzeit:** Ein Server läuft nur, solange der Launcher des Hosts ein Lebenszeichen schickt – bleibt es aus oder kommt „Stopp“, fährt er herunter, die Daten bleiben. Nach der eingestellten Laufzeit (Standard 24 h; kurze Unterbrechungen setzen sie nicht zurück) folgt eine Pause (Standard 2 h), danach muss der Server über die API neu gestartet werden. Je Partner einstellbar: Paket (auch nicht öffentliche), Server insgesamt und je Spieler, Laufzeit, Pause, Zeit bis zum Stopp ohne Lebenszeichen, Löschung ungenutzter Server, feste Nodes (auch private). Partner-Server haben keinen 30-Tage-Zyklus, kein Fair-Use der Website, zählen nicht gegen die Plätze der Website und lösen keine Benachrichtigungen aus. Ohne Panel-Zugang steuert der Partner über die API auch **Dateien** (auflisten, lesen, schreiben, große Uploads über eine kurzlebige Adresse, entpacken, löschen, von einer Adresse laden), **Mods und Plugins von Modrinth** (passend zu Lader und Version, samt Pflicht-Abhängigkeiten), die **Konsolen-Ausgabe** (letzte Zeilen), **Servereinstellungen** (`server.properties`, feste Auswahl an Werten), **Live-Werte** (CPU, RAM, Speicher, Spielerzahl) und das **Umbenennen**. Je Partner einstellbar: „Weiterlaufen, solange Spieler online sind“ (Standard aus). **Servertypen ohne eigenes Egg** (Fabric, Forge, NeoForge, Quilt …, also alles, was im Panel sonst der Version-Changer erledigt): Die API legt den Server mit dem Paper-Egg an und richtet die gewünschte Software danach selbst ein – Dateien laut Verzeichnis MCJars (`MCJARS_API_URL`) auf den Server laden, entpacken, passende Java-Version aus den Images des Eggs setzen (Job `partner-software`, alle 5 s; Fortschritt in `install` der Server-Antwort). Typen mit eigenem Egg laufen weiter über dieses. **Versionsauswahl** (Website und Partner-API): je Typ alle veröffentlichten Versionen aus dem Verzeichnis, automatisch aktuell; eine im Admin-Bereich gepflegte eigene Liste ersetzt die automatische. Dazu: **Webhooks** (signierte Meldungen bei Statuswechsel; nur https, Ziel wird bei jeder Zustellung geprüft, Zustellung im Job `partner-webhooks`), **Live-Konsole** als Server-Sent Events (nur lesend – der Zugang zum Daemon verlässt die API nie), **Backups** (Höchstzahl laut Paket) sowie **Servertyp/Version wechseln und neu installieren**. Der Job `partner-sessions` (alle 30 s) setzt die Regeln durch: Er stoppt Partner-Server, die ohne Sitzung laufen, und beendet sie nach 2 Minuten hart, falls sie den Stopp ignorieren. **Nicht umgehbar gebaut:** Server-Höchstzahlen werden in einer Transaktion geprüft; Laufzeit und Pause überstehen Löschen und neu Erstellen; die Grenzen der `server.properties` gelten auch für hochgeladene Dateien (Prüfung vor jedem Start und im laufenden Betrieb); die Anfragebegrenzung zählt je Partner, und Panel-Aufrufe aus Partner-Anfragen haben ein eigenes Kontingent (`PARTNER_PANEL_CALLS_PER_MINUTE`, Standard 300), damit unsere eigenen Stopp-Befehle immer durchkommen. Details: Abschnitt „Regeln, die sich über die API nicht umgehen lassen“ in [`docs/partner-api.md`](docs/partner-api.md). |
| **Dokumentation (`/docs`)** | Öffentliche Anleitungen für Nutzer in Deutsch und Englisch: Erste Schritte, Minecraft-Server, Discord-Bots, Laufzeit und Fair-Use, Discord, Konto. Inhalte liegen in `apps/web/src/content/docs/user.ts`. **Partner-Dokumentation (`/docs/partner-api`)**: Beschreibung der Partner-API – ausgeliefert nur an **Partner-Konten** und Admins. Partner wird ein Konto über Admin → *Nutzer* → „Zum Partner machen“ (nur mit bestätigter E-Mail-Adresse). Ohne Anmeldung führt die Seite zur Anmeldung; angemeldete Konten ohne Partner-Status sehen nur den Hinweis „Nur für Partner“, der Inhalt wird nicht mitgeschickt. In der Übersicht erscheint der Eintrag nur für Partner; Suchmaschinen sind ausgeschlossen. |
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

### Discord-Anbindung (Admin → *Discord*)

Schutz vor Mehrfach-Anmeldungen und Bindung an den eigenen Discord-Server. Alles wird im Admin-Bereich eingerichtet – in der `.env` steht dazu nichts.

| Funktion | Was passiert |
| --- | --- |
| **Registrieren, anmelden, Server erstellen** | **Registrieren** (`/register` bzw. `/de/registrieren`): Konto mit E-Mail-Adresse und Passwort – mehr braucht es nicht. **Server erstellen** (`/start`) ist für angemeldete Nutzer: Wer nicht angemeldet ist (z. B. nach dem Klick auf ein Paket), landet auf der Registrierung und danach automatisch wieder bei „Server erstellen“ mit dem gewählten Paket. **Discord ist der zweite Schritt:** Nach dem Anfragen des Servers folgt „Discord-Konto verbinden“ (inklusive Beitritt zum Discord-Server), dann der Panel-Zugang – erst dann wird der Server wirklich erstellt. Bis dahin ist eine offene Anfrage möglich; in Admin → *Server* steht sie als „wartet auf Discord-Verbindung“ und lässt sich per Erinnerungsmail anschreiben. **Anmelden:** E-Mail-Adresse und Passwort, über ein verknüpftes Discord-Konto oder mit Code per E-Mail. **E-Mail-Bestätigung ist freiwillig:** Der Code wird bei der Registrierung verschickt und lässt sich unter „Meine Server“ eingeben oder neu anfordern; dort kann man die Adresse auch ändern (das Panel-Konto bekommt sie mit). Eine bestätigte Adresse ist Voraussetzung, um Partner zu werden. Ein schon vorhandenes Panel-Konto mit derselben Adresse wird nur nach bestätigter E-Mail verknüpft. Unbestätigte Konten ohne Discord werden 30 Tage nach der letzten Anmeldung automatisch entfernt. |
| **Passwort und Schutzregeln** | Damit Server nur an Discord-Mitglieder gehen, muss unter Admin → *Discord* „Discord-Mitgliedschaft ist Pflicht“ eingeschaltet sein – sonst bekämen Konten mit bestätigter E-Mail-Adresse auch ohne Discord einen Server. Nach fünf falschen Passwörtern ist die Passwort-Anmeldung 15 Minuten gesperrt. Unter „Meine Server“ → Konto lässt sich das Passwort ändern (meldet andere Geräte ab) und entfernen. Passwort vergessen: mit Discord oder Code per E-Mail anmelden und ein neues festlegen. Wird die E-Mail-Adresse eines Kontos ohne Discord erstmals per Code bestätigt, gilt ein vorher gesetztes Passwort nicht mehr (es könnte von jemandem stammen, der die Adresse nur angegeben hat). An unbestätigte Adressen von Discord-Konten geht kein Anmeldecode. |
| **Angemeldet bleiben** | Schalter unter „Meine Server“ → Konto. Eingeschaltet halten die Sitzungen des Accounts `SESSION_STAY_DAYS` Tage ohne Besuch (Standard 30, höchstens das Dreifache insgesamt), und das Cookie überlebt das Schließen des Browsers. Gilt sofort für alle angemeldeten Geräte und für jede neue Anmeldung. Ausgeschaltet gelten die kurzen Standardwerte (`SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`). |
| **E-Mails, die nicht ankommen** | Alles, was per E-Mail rausgeht (Server bereit, läuft ab, Upgrade …), schickt der Bot zusätzlich als Discord-Direktnachricht (abschaltbar unter Admin → *Discord* → Pflicht-Mitgliedschaft). Lehnt der Mailserver eine Adresse zweimal hintereinander ab, gilt sie als nicht erreichbar: Es geht nichts mehr dorthin, alle Adressen aus `ADMIN_EMAILS` bekommen eine Mail („E-Mail-Adresse nicht erreichbar: …“), der Nutzer einen Hinweis per Direktnachricht, und in Admin → *Nutzer* steht „Mail nicht erreichbar“. Die Sperre endet, sobald der Nutzer seine Adresse ändert. Nicht erkennbar ist, wenn ein fremder Mailserver eine Mail annimmt und dann still verwirft oder in den Spam legt – dagegen helfen SPF, DKIM und DMARC für die Absender-Domain. Fehler auf der eigenen Seite (Mailserver nicht erreichbar, Anmeldung abgelehnt) zählen nicht als Fehlversuch der Adresse. |
| **„Erneut versuchen“ im Admin-Bereich** | Führt die Erstellung sofort aus (statt auf den nächsten Lauf des Jobs zu warten) und zeigt das Ergebnis direkt an – bei einem Fehler die neue Fehlermeldung. |
| **Konto verknüpfen** | Nutzer verbinden unter „Meine Server“ ihr Discord-Konto (OAuth). Mit der Berechtigung `guilds.join` treten sie dabei automatisch dem Server bei. Jedes Discord-Konto gehört zu höchstens einem Account; optional gilt ein Mindestalter des Discord-Kontos. |
| **Pflicht-Mitgliedschaft** | Eingeschaltet werden Server erst erstellt bzw. reaktiviert, wenn das Konto verknüpft und der Nutzer Mitglied ist. Offene Anfragen warten so lange. Startseite, „Server erstellen“, FAQ, Regeln und `/llms.txt` weisen darauf hin. |
| **Einladungslink** | Der Bot erstellt eine dauerhafte Einladung und ersetzt sie, falls sie gelöscht wird. Die Website verwendet sie überall als Discord-Link. |
| **Customer-Rolle** | Wer einen Server oder Bot hat, bekommt die Rolle (Rollen-ID im Admin); wer keinen mehr hat, verliert sie. Abgleich alle 2 Minuten (Job `discord-sync`) und auf Knopfdruck. |
| **Auto-Rollen** | Bis zu 20 Rollen, die jedes neue Mitglied beim Betreten bekommt. |
| **Willkommensnachricht** | Embed mit Profilbild und Profil-Banner, Einlader, Beitrittsdatum und Mitgliederzahl. Texte, Farbe, Kanal und Ersatzbild sind einstellbar. |
| **Rollen-Panels** | Nachrichten mit Buttons zum Selbst-Zuweisen von Rollen (z. B. News/Giveaway/Status oder Free Hosting/Paid Hosting). Senden aus dem Admin-Bereich oder mit `/rollenpanel`. |
| **Tickets** | Ticket-Panel (`/ticketpanel` oder aus dem Admin). Der Bot erkennt die Server des Nutzers, lässt das Produkt auswählen und schreibt Account-ID und Server-ID ins Ticket. Schließen durch Ersteller oder Team, Löschen durch das Team. |
| **`!start`, `!stop`, `!restart` per Direktnachricht** | Mitglieder schreiben dem Bot privat `!start`, `!stop` oder `!restart`. Er antwortet auf Deutsch und Englisch mit einem Button je Server und führt die Aktion über die Pterodactyl-API aus. Läuft der Server schon (bzw. ist er schon aus), sagt er das; kommt er nicht hoch, verweist er auf die Konsole im Panel. **Minecraft-EULA:** Ist sie noch nicht akzeptiert (`eula=false` in `eula.txt`, auch direkt nach dem allerersten Start), sagt der Bot das und zeigt den Button „Ja, ich akzeptiere die Minecraft-EULA. Ich habe sie gelesen.“ (DE/EN). Nach dem Klick trägt er `eula=true` ein, protokolliert die Zustimmung und startet den Server sauber. Fair-Use-Pausen gelten weiter. Abschaltbar im Admin. |
| **Status-Meldungen** | Kanal-ID (und optional eine Rolle zum Erwähnen) eintragen: Der Bot postet jede Änderung der Statusseite als gelbes Embed auf Deutsch (🇩🇪) und Englisch (🇬🇧) – neue Störungen und Hinweise, **angekündigte Wartungsarbeiten**, ihren **Beginn** (automatisch zum Startzeitpunkt), Aktualisierungen, das Ende sowie den Wartungsmodus der Website. Von Hand gesetzte Zustände erscheinen sofort, automatisch gemessene erst nach zwei gleichen Messungen (keine Fehlalarme). Beim Einschalten wird nichts Altes nachgemeldet. Mit „Testnachricht senden“ prüfbar. |
| **Belohnungen für Einladungen** | Der Bot merkt sich, über wessen Einladungslink jemand beigetreten ist. Eine Einladung zählt, wenn die eingeladene Person noch Mitglied ist, ihr Discord-Konto mit einem Website-Account verknüpft hat und ihr Server in den letzten N Tagen online war. Stufen frei einstellbar (Standard: 10 → Slot nach Wahl, 15 → Discord-Bot im kleinsten Paket). Bei einer erreichten Stufe schreibt der Bot eine Direktnachricht mit Button zum Einlösen; sind Direktnachrichten deaktiviert, erwähnt er die Person im Ersatz-Kanal. Eingelöst ergibt das einen zusätzlichen Slot für den Account. |
| **Belohnungen für Server-Boosts** | Solange jemand boostet, bekommt der Account zusätzliche Server (Standard: 1 Boost → kleinstes Minecraft-Paket, 2 → größtes, 3 → größtes + kleinstes, 4+ → zweimal das größte; es gilt die höchste erreichte Stufe). Beim Aufstieg wird ein vorhandener Server im kleineren Paket automatisch hochgestuft. Endet der Boost, laufen die Server bis zum Ende ihrer Laufzeit und lassen sich danach nicht mehr verlängern. Discord nennt Bots keine Boost-Anzahl: Gezählt werden die Boost-Meldungen im Systemkanal (dort müssen „Boost-Nachrichten“ an sein); die Anzahl lässt sich im Admin-Bereich von Hand setzen. |
| **`!rewards` per Direktnachricht** | Zeigt Einladungen, Boosts, alle Stufen und Buttons zum Einlösen. Im Admin-Bereich: „Ankündigung senden“ postet das Belohnungssystem mit Rollen-Erwähnung in einen Kanal; dazu Rangliste der Einladenden und Liste der Booster. |
| **Honeypot-Kanal** | Ein für alle sichtbarer Kanal mit rotem Warnhinweis (DE/EN). Wer dort schreibt, wird automatisch gebannt, seine Nachrichten der letzten Stunde werden gelöscht. Ausgenommen: Bots, Besitzer, Administratoren. Der Bot braucht „Mitglieder bannen“. |
| **Social Ping (neue Videos)** | Konten per Link hinterlegen – YouTube-Kanäle (z. B. `youtube.com/@name`, ohne API-Schlüssel über den öffentlichen Feed des Kanals), TikTok-Profile (`tiktok.com/@name`) oder beliebige RSS-/Atom-Feeds. TikTok bietet keinen offiziellen Feed: gelesen wird die öffentliche Einbettungs-Seite des Profils (die letzten zehn Videos, nur öffentliche Konten). Das kann ausfallen, wenn TikTok die Seite ändert oder Abrufe vom Server blockiert – der Fehler steht dann beim Konto, verpasste Videos werden nachgeholt, solange sie noch unter den letzten zehn sind. Der Bot prüft alle 5 Minuten und postet neue Videos mit Link (Discord zeigt die Vorschau mit Player) in den eingestellten Kanal, optional mit Rollen-Erwähnung und eigenem Text (`{name}`, `{title}`, `{url}`). Beim Hinzufügen werden vorhandene Videos nur gemerkt; höchstens drei Meldungen je Konto und Lauf; Ausfälle von Feed oder Kanal werden nachgeholt. „Testen“ postet das neueste Video, „Jetzt prüfen“ startet sofort einen Lauf. |
| **`/rolle`** | `geben`/`nehmen` für ein Mitglied, `alle` für alle Mitglieder (ohne Bots). |
| **`/wartung`** | `an`: sichert die Berechtigungen aller Kanäle, sperrt sie für alle außer Administratoren, legt Rolle „Wartung“ und einen Hinweis-Kanal an. `aus`: stellt alles wieder her. |

**Einrichten:** Anwendung im [Discord Developer Portal](https://discord.com/developers/applications) anlegen → unter *Bot* Token erzeugen und den **Server Members Intent** einschalten → unter *OAuth2* die Redirect-Adresse `https://DEINE-DOMAIN/api/v1/discord/callback` eintragen → im Admin-Bereich Client-ID, Client-Secret, Bot-Token und Server-ID speichern → Bot über den angezeigten Link einladen (Recht „Administrator“, Bot-Rolle über die zu vergebenden Rollen ziehen) → „Verbindung prüfen & einrichten“.

**Technik:** Der Bot läuft im Worker (`chfree-worker`) und hält eine Gateway-Verbindung zu Discord; Änderungen im Admin-Bereich übernimmt er nach ca. 20 Sekunden ohne Neustart. Bot-Token und Client-Secret liegen zusätzlich feldverschlüsselt in der Datenbank und werden nie an den Browser übertragen. Code: `apps/api/src/discord/`.

### Support-Chat „Crafting AI“ (Admin → *Chat*)

Chat-Symbol unten rechts auf der Website, mit einer Sprechblase, die einmal je Besuch kurz aufpoppt. Der Chat zeigt euer Logo (Einstellungen → Logo), ist klar als KI gekennzeichnet und antwortet auf Deutsch und Englisch.

| Baustein | Was er tut |
| --- | --- |
| **Vorgefertigte Antworten** | Kommen sofort und ohne Kosten, wenn ein Besucher einen Vorschlag anklickt oder eine kurze Frage ein Stichwort enthält. Im Admin-Bereich bearbeitbar (Frage, Antwort, Stichwörter – je DE/EN). |
| **KI-Antworten** | Alles andere beantwortet Claude über die offizielle Anthropic-API. Es wird **immer das günstigste Modell** verwendet (`claude-haiku-5-5`), mit niedrigem Aufwand, begrenzter Antwortlänge und zwischengespeichertem Wissen. Der API-Schlüssel wird im Admin-Bereich hinterlegt, feldverschlüsselt gespeichert und nie wieder angezeigt. |
| **Kostenbremse** | Monatsbudget in US-Dollar (Standard 50 $). Ist es erreicht, antwortet bis zum Monatswechsel nur noch der vorgefertigte Teil. Dazu: Höchstzahl an Nachrichten je Unterhaltung und Limit je IP-Adresse. Der Verbrauch steht im Admin-Bereich (Schätzung – maßgeblich ist die Abrechnung bei Anthropic). |
| **Nur Support** | Die KI beantwortet ausschließlich Fragen zu CraftingHosting.free. Sie kennt nur öffentliches Wissen: die Datei `apps/api/knowledge/support.md`, die aktuellen Pakete/Regeln/Links aus den Einstellungen und das „Zusatzwissen“ aus dem Admin-Bereich. Sie hat **keinen** Zugriff auf Konten, Server, Protokolle, Einstellungen oder Schlüssel. |
| **Weitergabe an Mitarbeiter** | Kann die KI nicht helfen (oder möchte der Besucher einen Menschen), schickt der Chat den **Verbindungslink** zu Discord (nicht den Einladungslink). Nach der Zustimmung tritt der Besucher automatisch eurem Discord-Server bei; der Chat bestätigt das, der Bot eröffnet ein Ticket mit dem Hinweis der KI und dem bisherigen Verlauf und meldet es per Embed im eingestellten Team-Kanal. Wer bereits angemeldet und verknüpft ist, bekommt das Ticket sofort. |

**Einrichten:** Admin → *Chat* → „Chat auf der Website anzeigen“ einschalten → API-Schlüssel von [console.anthropic.com](https://console.anthropic.com/settings/keys) eintragen → „Schlüssel prüfen“ → Monatsbudget festlegen → optional Kanal-ID für die Meldung an das Team. Für die Weitergabe muss die Discord-Anbindung (inkl. Ticketsystem) eingerichtet sein. Ohne Schlüssel arbeitet der Chat nur mit vorgefertigten Antworten.

**Wissen pflegen:** `apps/api/knowledge/support.md` bearbeiten (wird innerhalb einer Minute neu gelesen) oder im Admin-Bereich „Zusatzwissen“ eintragen. Dort gehört nur hinein, was Besucher wissen dürfen.

**Datenschutz:** Unterhaltungen werden gespeichert (IP-Adresse verschlüsselt) und nach der eingestellten Frist (Standard 30 Tage) gelöscht; die Datenschutzerklärung und die Cookie-Hinweise der Website nennen den Chat und den KI-Dienst automatisch, sobald er eingeschaltet ist. Code: `apps/api/src/chat/`, `apps/web/src/components/chat/`.

### Fair-Use-System für Discord-Bots

| Regel | Standard | Was passiert |
| --- | --- | --- |
| CPU-Dauerlast | über 90 % des Paket-Limits für 30 min am Stück | nach 15 min Vorwarnung per E-Mail, nach 30 min Stopp und 30 min Pause (Starts in der Pause werden rückgängig gemacht) |
| Verwarnungen | 3 Stopps in 7 Tagen | Bot wird gesperrt (Grund „abuse“), Entsperren im Admin unter *Server* |
| Inaktivität | 7 Tage am Stück offline | Erinnerung 2 Tage vorher, dann wird der Platz freigegeben: Bot suspendiert, **sofort** reaktivierbar unter „Meine Server“, ohne Reaktivierung nach 72 h gelöscht |
| Laufzeit | kein Ablaufdatum | Discord-Bots haben **keinen** 30-Tage-Zyklus und **keinen** Ruhetag – sie laufen durchgehend und müssen nie verlängert werden |

Geprüft wird jede Minute im Job `sync-power-states` (`apps/api/src/services/bot-fair-use.ts`). Das klassische Fair-Use-System (24 h am Stück, Wochen-Offline-Zeit) gilt für Minecraft und lässt sich für Bots zusätzlich einschalten.

---

## So funktioniert es für Nutzer

1. **craftinghosting.free/start** – Minecraft-Server oder Discord-Bot wählen, dann Paket, Servertyp bzw. Laufzeit, Servername und E-Mail angeben (im Early-Access-Modus: „Platz sichern“ → Warteliste, siehe unten)
2. **Sechsstelligen Code aus der E-Mail eingeben** – bestätigt die Adresse und meldet an (ein Passwort ist nicht nötig)
3. **Panel-Zugang festlegen** – Benutzername + Passwort werden direkt an Pterodactyl übergeben (nicht gespeichert). Bestehende Crafting-Hosting-Kunden mit gleicher E-Mail werden automatisch mit ihrem vorhandenen Panel-Konto verknüpft.
4. **Server wird automatisch angelegt** → E-Mail „Server bereit“ mit Link ins Panel
5. **Im Panel spielen** – alles Weitere läuft automatisch
6. Nach 30 Tagen + 1 Ruhetag: **Meine Server** (Anmeldung mit Code per E-Mail) → „Reaktivieren“. Ohne Reaktivierung wird der Server 48 h nach dem Ruhetag gelöscht (Erinnerung 24 h vorher).

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

Anmeldung wie gewohnt mit Code per E-Mail (`/login`), danach `/admin` aufrufen. Zugriff haben Konten mit Adresse in `ADMIN_EMAILS` oder nach `node dist/cli.js make-admin du@example.com`.

- **Übersicht:** Website-Zustand (Wartung, Registrierungsmodus, Warteliste) mit Wartungs-Schnellschalter, Nutzer, Server nach Status, Pakete, E-Mail-Warteschlange, Pterodactyl-/SMTP-Einstellungen, Zustand aller Jobs (mit „Jetzt ausführen“) – Warnung, wenn der Worker nicht läuft
- **Einstellungen:** Wartungsmodus (Hinweis DE/EN, voraussichtliches Ende), Registrierung *Offen / Vorregistrierung / Geschlossen*, **kostenlose Server pro Person getrennt einstellbar** (Minecraft-Server, Discord-Bots, optionale Gesamtgrenze, „jedes Paket nur einmal“ je Angebot – Website, Regeln und FAQ übernehmen den Satz automatisch), **Kapazität je Paket** (maximale Plätze + außerhalb belegte Plätze → auf der Website „Noch 12 von 100 Plätzen frei“ bzw. „Ausgebucht“), EPYC-Plätze gesamt und davon außerhalb belegt, Anmeldungen außerhalb der Website, Zahlen auf der Startseite (automatisch + Zusatz oder fester Wert). Wirkt nach wenigen Sekunden – kein Neustart nötig.
- **Warteliste:** Plätze mit Rang und Hardware (EPYC/Xeon), 50 pro Seite mit Blättern, „Die nächsten N freischalten“, Auswahl freischalten, Einträge entfernen, **Personen hinzufügen** (E-Mail-Liste von Vormerkungen aus dem alten System/Discord – auf Wunsch vor allen anderen eingereiht, mit Info-Mail) und **Vormerkungen als Anzahl** mit „+ / −“ (siehe unten)
- **Statusseite:** Meldungen anlegen (Störung, Wartung, Hinweis; DE/EN; Beginn/Ende – in der Zukunft = geplante Wartung), bearbeiten, beenden, löschen. Darunter **„Statusseite gestalten“** – alles, was die Statusseite zeigt, ist einstellbar:
  - *Darstellung:* Überschrift, Einleitung, **Balken je Stunde oder je Tag** (Standard: 90 Balken = die letzten 90 Stunden, der Verlauf rückt stündlich weiter; alternativ 7–90 Tage) – die Prozentzahl wird über genau diesen Zeitraum berechnet, Banner, Tagesbalken, Prozentzahl, Legende, Antwortzeit, vergangene Meldungen, Link zur Statusseite des Hauptanbieters
  - *Zustände:* Text, Banner-Text und Farbe für Betriebsbereit / Eingeschränkt / Geplante Wartung / Ausfall (DE/EN) sowie die Farbe für Tage ohne Messdaten
  - *Gruppen:* beliebige Karten (z. B. „Netzwerk“, „Game-Nodes“) mit Name, Symbol und Reihenfolge
  - *Komponenten:* Name, Unterzeile, Gruppe, Reihenfolge, Sichtbarkeit, eigener Text für „Betriebsbereit“ (z. B. „Aktiv“) und die **Prüfung**: FreeHosting gesamt, Website, API & Datenbank, Pterodactyl Panel, alle Nodes, ein bestimmter Node (Wartungsmodus aus dem Panel + direkter Ping auf Wings), eigene Adresse (HTTP-Check) oder manuell. Ein fester Status (Automatisch / Betriebsbereit / Eingeschränkt / Teilausfall / Ausfall / Wartung) hat immer Vorrang
  - *Verlauf nachtragen:* einen ganzen Zeitraum (von – bis) für eine oder alle Komponenten eintragen, z. B. die Zeit vor Beginn der Messung als „Betriebsbereit“ – wahlweise nur für Tage ohne Messdaten, damit gemessene Ausfälle erhalten bleiben
  - *Verlauf korrigieren:* einzelne Tage je Komponente von Hand festlegen (Fehlalarm ausbessern, Ausfall nachtragen)
- **Pakete (unter Einstellungen):** je Paket Name, RAM, CPU, Speicher, Plätze – und die **Slots im Panel**: Backup-Slots (0–20), Datenbank-Slots (0–20) und Netzwerk-Slots/Ports (1–10). Neue Server bekommen die Werte sofort; mit „Slots auf bestehende Server übertragen“ gelten sie auch für alle vorhandenen Server des Pakets (RAM, CPU und Speicher bleiben dabei unverändert). Die Website zeigt Backups, Datenbanken und zusätzliche Ports in den Paketkarten. Zusätzliche Ports setzen im Panel „Automatic Allocation Creation“ voraus, Datenbanken einen Datenbank-Host.
- **Chat:** Support-Chat „Crafting AI“ ein/aus, API-Schlüssel für Claude (prüfen, löschen), Monatsbudget und Verbrauch, vorgefertigte Antworten, Zusatzwissen, Weitergabe an Mitarbeiter, die letzten Unterhaltungen mit Verlauf
- **Server:** 50 pro Seite mit Blättern, Suche/Filter, Link ins Pterodactyl-Admin. Offene Anfragen zeigen, **worauf sie wirklich warten** (E-Mail-Bestätigung, Panel-Zugang, Discord-Verbindung, Discord-Beitritt) oder „Fehler: nicht erstellt“ – mit „Erneut versuchen“ prüft das System sofort noch einmal und erstellt den Server; zusätzlich holt ein Job offene Anfragen von Accounts mit Panel-Konto alle paar Minuten automatisch nach. Aktionen: +30 Tage, Pause aufheben, Sperren/Entsperren, Einrichtung erneut versuchen, Löschen
- **Nutzer:** 50 pro Seite, Suche und Filter (E-Mail unbestätigt, ohne Server, auf der Warteliste, gesperrt, Admins), Panel-Konto, Sperren/Entsperren, Admin-Rechte und **Konten löschen**: einzeln, per Häkchen (Umschalt + Klick für ganze Bereiche, „alle auf dieser Seite“), **alle Treffer** von Suche/Filter über alle Seiten (Bestätigung mit „LÖSCHEN“, Fortschrittsanzeige) oder per eingefügter E-Mail-Liste. Gelöscht werden das Website-Konto und die kostenlosen Server; das Pterodactyl-Konto bleibt (dort können bezahlte Server liegen). Admins und das eigene Konto werden nie gelöscht.
- **Protokoll:** komplettes Audit-Log (Nutzer, System, Admin), 50 pro Seite
- **E-Mails:** Testmail senden, fehlgeschlagene/ausstehende Mails mit Fehlergrund. **Erinnerung „Discord-Konto verbinden“** per Knopfdruck an alle, deren Server nur noch auf die Discord-Verbindung wartet – mit Frist (Standard 7 Tage, steht mit Datum in der Mail und unter „Meine Server“); danach löscht das System die Anfrage automatisch und informiert den Nutzer. **E-Mail an bestimmte Nutzer:** Adressen einfügen, Betreff und Text (DE/EN) – unbekannte Adressen werden gemeldet.
- **Abuse:** Abuse-Mail von Hand senden: E-Mail-Adresse eingeben, **betroffenen Server auswählen**, Grund wählen (Auslastung, Krypto-Mining, Angriffe/Spam, verbotene Inhalte, Mehrfach-Accounts oder eigener Text) – daneben zeigt eine **Vorschau genau den Mailtext** in Deutsch und Englisch. Der ausgewählte Server wird beim Nutzer unter „Meine Server“ **rot als „Abuse“ markiert**, mit dem Hinweis, ein Ticket auf Discord zu öffnen; auf Wunsch wird er gleich gesperrt. Dazu die Liste der markierten Server (Markierung aufheben, sobald das Ticket geklärt ist) und die letzten 200 Abuse-Mails – von Hand verschickte und die automatischen des Fair-Use-Systems, mit Empfänger, Text und Zustellstatus.

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

Ohne `SMTP_HOST` erscheinen E-Mails (inkl. Anmeldecode) in der Konsole der API. Im Mock-Modus wird Pterodactyl simuliert; Chat-Hinweise und Panel-Beschreibungen landen in `apps/api/.pterodactyl-mock.json`.

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
2. **Client-API-Key** eines Admin-Accounts (`ptlc_…`) – für Starts/Stopps, Ressourcen, Chat-Hinweise (`/command`), Backup-Zeitplan und das Lesen/Schreiben von `eula.txt` (EULA-Bestätigung über den Discord-Bot) → `PTERODACTYL_CLIENT_KEY`
3. **Nodes** im Admin unter *Pterodactyl* zuweisen: Nodes für Minecraft und die eigene Node für Discord-Bots (Nodes brauchen freie Allokationen). `PTERODACTYL_LOCATION_IDS` ist nur noch ein optionaler Rückfall.
4. **Eggs** im Admin unter *Pterodactyl* wählen – alle Eggs des Panels werden erkannt, passende vorgeschlagen. Für Minecraft genügt **ein** Java-Egg (z. B. Paper): Alle weiteren Java-Servertypen richtet das System über MCJars darauf ein (Admin → *Einstellungen* → „Server-Software“). Nur Bedrock und Proxys brauchen ein eigenes Egg. Für Discord-Bots ein Python- und ein Node.js-Egg importieren (z. B. „generic python“ / „generic nodejs“ aus github.com/pelican-eggs). Ohne Egg zeigt die Website „bald“. Die `.env`-Variablen `PTERODACTYL_EGG_*` bleiben als Alternative.
5. `PTERODACTYL_MODE=live`, `PTERODACTYL_URL`, `PTERODACTYL_PUBLIC_URL` setzen

Panel-Konten bekommen `external_id = chf-user-<id>`, Server `chf-server-<id>` – dadurch entstehen bei Wiederholungen keine Duplikate. Die Serverbeschreibung wird über `PATCH /servers/{id}/details` gesetzt (Name und Besitzer bleiben unverändert, auch wenn der Nutzer den Server im Panel umbenennt).

---

## Automatisierte Jobs

Worker: `node dist/worker.js` (Produktion) bzw. `RUN_JOBS_IN_API=true` (Entwicklung).

| Job | Intervall | Aufgabe |
| --- | --- | --- |
| `sync-power-states` | 60 s | Zustand aus dem Panel lesen, Laufzeit-Sessions führen, Suspendierung abgleichen, Nacharbeiten nach Installation, **Fair-Use für Discord-Bots** (CPU-Dauerlast, Inaktivität) |
| `enforce-fair-use` | 60 s | Chat-Warnungen, 24-h-Limit, Wochen-Offline-Zeit, Pausen-Verstöße |
| `cycle-lifecycle` | 60 s | 30-Tage-Zyklus der Minecraft-Server: Erinnerungen, Chat-Hinweise, Ablauf → Stopp → Info → Suspendierung → Löschung 48 h nach dem Ruhetag. Discord-Bots haben keinen Zyklus; der Job suspendiert sie nur nach einer Freigabe wegen Inaktivität |
| `status-history` | 5 min | Status aller Komponenten speichern (Grundlage für die Tagesbalken und die Uptime der Statusseite) |
| `discord-sync` | 2 min | Customer-Rolle auf dem Discord-Server abgleichen, Einladungslink stündlich prüfen |
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
| POST | `/start` | Server anfordern (E-Mail + Konfiguration) → sechsstelliger Code per E-Mail |
| POST | `/auth/login-code` | Anmeldecode anfordern (Antwort immer gleich) |
| POST | `/auth/verify` | Code aus der E-Mail einlösen → Session + nächster Schritt – oder Ticket für die zweite Stufe |
| POST | `/auth/two-factor` | Zweite Stufe: Passwort, Code aus der Authenticator-App oder Wiederherstellungscode → Session |
| GET/POST | `/account/security` · `/account/two-factor/{password,totp/setup,totp/confirm,disable}` | Zweite Stufe ein- und ausschalten |
| POST | `/panel/setup` | Panel-Konto anlegen, wartende Server erstellen |
| GET | `/auth/me` · POST `/auth/logout` · POST `/account/delete` | Konto |
| GET/POST | `/servers` | eigene Server / weiteren Server (angemeldet) |
| POST | `/servers/:id/reactivate` · `/servers/:id/delete` | Reaktivieren / Löschen |
| GET | `/meta` · `/site` · `/status` · `/health` | Pakete & Verfügbarkeit, öffentliche Einstellungen + Zahlen, Netzwerkstatus (inkl. Meldungen und Uptime), Liveness |
| GET | `/admin/overview` · `/admin/servers` · `/admin/users` · `/admin/audit` · `/admin/mails` | Admin: Übersicht und Listen (nur Admins, sonst 404) |
| POST | `/admin/servers/:id/{extend,clear-pause,suspend,unsuspend,retry,reinstall-software,delete}` · `/admin/users/:id/{lock,unlock,make-admin,remove-admin}` · `/admin/jobs/:name/run` · `/admin/mail-test` | Admin-Aktionen (alle im Audit-Log) |
| GET/POST | `/admin/settings` | Einstellungen (Wartung, Registrierung, Produkte & Pakete, Hardware, Spenden, Bot-Fair-Use, Warteliste, Zahlen, Statusseite: Gruppen, Komponenten, Texte, Farben, Verlauf) |
| GET | `/admin/panel` | Pterodactyl: Verbindung, Nodes mit freien Ports, alle Eggs, Vorschläge je Servertyp |
| GET | `/admin/software` | Server-Software: Liste des Verzeichnisses MCJars, Eggs des Panels, aktuelle Grundlage und je Software, wie sie installiert würde |
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
| GET | `/discord/connect` · `/discord/callback` | Discord-Konto verknüpfen (Weiterleitung zu Discord und zurück) |
| GET/POST | `/discord/me` · `/discord/check` · `/discord/unlink` | Stand der Verknüpfung, Mitgliedschaft erneut prüfen, Verknüpfung lösen |
| GET/POST | `/admin/discord` · `/admin/discord/{secrets,setup,sync-roles,send-panel}` | Discord-Anbindung: Zugangsdaten, Einrichtung, Rollen-Abgleich, Panels posten |

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
- Anmeldung mit sechsstelligem Code per E-Mail: einmalig, 15 bzw. 30 Minuten gültig, nach fünf Fehlversuchen verbraucht, nur als Hash mit Schlüssel gespeichert; das Panel-Passwort wird nur an Pterodactyl durchgereicht
- Freiwillige zweite Stufe (Meine Server → Sicherheit): eigenes Passwort (scrypt-Hash) oder Authenticator-App (TOTP, Schlüssel verschlüsselt, Code nicht wiederverwendbar), acht Wiederherstellungscodes, Sperre nach fünf Fehlversuchen; Zurücksetzen im Admin unter *Nutzer*
- Panel-Zugang erst **nach** E-Mail-Bestätigung – niemand kann für fremde Adressen ein Panel-Konto mit eigenem Passwort anlegen
- Kurze Anmeldung: Session-Cookie ohne Ablaufdatum (endet mit dem Schließen des Browsers), Abmeldung nach 30 min Inaktivität, spätestens nach 12 h – danach neu mit Code per E-Mail anmelden (`SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS`, `SESSION_PERSISTENT`)
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
