# Wissensdatei für Crafting AI (Support-Chat)

Diese Datei ist das Grundwissen des Support-Chats. Die KI beantwortet Fragen ausschließlich mit dem, was hier steht,
mit den aktuellen Werten aus dem Admin-Bereich (Pakete, Regeln, Links – werden automatisch ergänzt) und mit dem
Zusatzwissen aus Admin → Chat. Änderungen an dieser Datei wirken nach dem nächsten `chfree update` bzw. Neustart der API.

Hier steht nur, was jeder Besucher wissen darf. Keine Zugangsdaten, keine internen Abläufe, keine Namen von Kunden.

## Was ist CraftingHosting.free?

CraftingHosting.free ist das kostenlose Hosting-Angebot von Crafting Hosting (crafting.host). Es gibt kostenlose
Minecraft-Server und kostenloses Hosting für Discord-Bots (Python oder Node.js). Es werden keine Zahlungsdaten verlangt,
es gibt keine Testphase und keine versteckten Kosten. Wer mehr Leistung oder weniger Einschränkungen braucht, findet
bezahlte Pakete bei Crafting Hosting.

Die Server werden auf dieser Website angefordert und danach im Pterodactyl-Panel verwaltet. Die Website selbst zeigt
unter „Meine Server“ nur den Zustand und erlaubt Reaktivieren und Löschen.

## Registrieren und Server oder Bot erstellen

1. Auf der Website auf „Server erstellen“ klicken (oder direkt auf ein Paket). Wer noch kein Konto hat, kommt zuerst
   zur Seite „Registrieren“: E-Mail-Adresse und Passwort eingeben, AGB akzeptieren, „Konto erstellen“.
2. Danach geht es automatisch zu „Server erstellen“: Angebot wählen (Minecraft-Server oder Discord-Bot), Paket, Typ
   bzw. Programmiersprache, Version und einen Namen.
3. Discord-Konto verbinden. Dabei tritt das Konto unserem Discord-Server bei. Das ist Pflicht: Kostenlose Server gibt
   es nur für Mitglieder unseres Discord-Servers – ohne diesen Schritt bleibt der Server eine offene Anfrage.
4. Benutzername und Passwort für das Pterodactyl-Panel festlegen. Danach wird der Server automatisch erstellt und
   installiert (dauert meist ein bis zwei Minuten).

Die E-Mail-Adresse muss nicht bestätigt werden. Wir schicken trotzdem einen sechsstelligen Code; wer ihn unter
„Meine Server“ eingibt, hat eine bestätigte Adresse – das ist die Voraussetzung, um Partner zu werden. Unter
„Meine Server“ lässt sich die Adresse auch ändern und ein neuer Code anfordern.

Sind gerade alle Plätze belegt oder läuft eine Warteliste, zeigt die Website das an. Dann gibt es einen Platz auf der
Warteliste und eine E-Mail, sobald der Server freigeschaltet ist.

## Anmelden

- Auf der Anmeldeseite mit E-Mail-Adresse und Passwort anmelden. Wer sein Discord-Konto verbunden hat, kann auch
  „Mit Discord anmelden“ wählen.
- Wer ein Passwort festgelegt hat, meldet sich mit E-Mail-Adresse und Passwort an. Passwort vergessen: mit Discord oder
  einem Code per E-Mail anmelden und unter „Meine Server“ → Konto ein neues Passwort festlegen.
- Wer nicht ständig neu angemeldet werden möchte, schaltet unter „Meine Server“ → Konto „Angemeldet bleiben“ ein.
- Ältere Konten ohne Discord können sich weiter mit ihrer E-Mail-Adresse anmelden:
- Unter „Meine Server“ die E-Mail-Adresse eingeben. Es kommt ein sechsstelliger Code per E-Mail, der auf der Website
  eingetippt wird. Ein Passwort ist dafür nicht nötig.
- Der Code gilt nur kurz und nur einmal. Nach fünf falschen Eingaben muss ein neuer Code angefordert werden.
- Kommt keine E-Mail an: Spam-Ordner prüfen, Schreibweise der Adresse prüfen, nach einer Minute „Code erneut senden“.
  Wichtige Hinweise schickt unser Bot zusätzlich als Discord-Direktnachricht. Lehnt der Mailserver eine Adresse
  mehrfach ab, schreiben wir nichts mehr dorthin – dann bitte die Adresse unter „Meine Server“ ändern.
- Freiwillig lässt sich unter „Meine Server“ → „Sicherheit“ eine zweite Stufe einschalten: ein eigenes Passwort oder eine
  Authenticator-App. Beim Einschalten gibt es Wiederherstellungscodes für den Notfall.
- Passwort der zweiten Stufe vergessen oder Handy verloren: einen Wiederherstellungscode verwenden. Sind auch die weg,
  kann nur das Support-Team die zweite Stufe zurücksetzen.

Das Panel hat ein eigenes Passwort (das beim Erstellen festgelegte). Wer es vergessen hat, nutzt auf der Anmeldeseite des
Panels „Passwort vergessen“.

## Server verwalten (Pterodactyl-Panel)

Starten, Stoppen, Konsole, Dateimanager, SFTP, Backups, Datenbanken und Starteinstellungen gibt es im Panel. Den Link
zum Panel zeigt „Meine Server“. Die Anmeldung dort erfolgt mit der E-Mail-Adresse und dem Panel-Passwort.

Bei Minecraft-Servern steht die Adresse zum Verbinden unter „Meine Server“ und im Panel.

## Regeln für Minecraft-Server (Fair-Use)

Die Hardware wird geteilt, deshalb gibt es feste Regeln. Die aktuellen Zahlen stehen unten bei „Aktuelle Werte“.

- Ein Server läuft nur eine begrenzte Zeit am Stück und wird dann automatisch gestoppt. Nach einer kurzen Pause kann er
  wieder gestartet werden.
- Pro Woche muss ein Server eine bestimmte Zeit offline sein.
- Jeder Minecraft-Server hat einen Zyklus von einigen Wochen. Danach wird er gestoppt und suspendiert; Welt und Dateien
  bleiben erhalten. Nach einer Ruhezeit lässt er sich unter „Meine Server“ kostenlos reaktivieren – beliebig oft.
- Wird er nach der Ruhezeit nicht rechtzeitig reaktiviert, wird er samt Welt gelöscht. Vorher kommt eine Erinnerung per
  E-Mail.
- Vor einem automatischen Stopp erscheinen Hinweise im Minecraft-Chat und in der Serverbeschreibung im Panel.

Wird ein Server während einer Pause von Hand gestartet, stoppt ihn das System wieder. Wann ein Start wieder möglich ist,
steht unter „Meine Server“.

## Regeln für Discord-Bots

- Discord-Bots dürfen durchgehend online sein. Für sie gibt es keinen Zyklus mit Ablaufdatum und keinen Ruhetag; sie
  müssen nie verlängert werden.
- Stattdessen gilt ein eigenes Fair-Use-System: keine dauerhafte CPU-Volllast und aktive Nutzung.
- Läuft ein Bot längere Zeit am Stück an seinem CPU-Limit, wird er nach einer Vorwarnung gestoppt und kurz pausiert.
  Mehrere solche Stopps in kurzer Zeit führen zu einer Sperre.
- Ist ein Bot mehrere Tage am Stück offline, wird sein Platz freigegeben: Der Bot wird suspendiert, die Dateien bleiben
  vorerst erhalten, und er lässt sich unter „Meine Server“ sofort wieder reaktivieren. Ohne Reaktivierung wird er nach
  einigen Tagen gelöscht.
- Selfbots, Spam und Bots, die gegen die Regeln von Discord verstoßen, sind nicht erlaubt.
- Websites sind auf Bot-Servern nicht erlaubt: Es sind Discord-Bot-Server, keine Webserver. Einzige Ausnahme ist ein
  Dashboard für den eigenen Bot – mit Anmeldung (z. B. Login mit Discord), Impressum nach § 5 DDG, soweit nötig, und
  unter Beachtung des Rechts im eigenen Land. Auch ein erlaubtes Dashboard kann vom System auffallen; dann kann der
  Server vorsorglich gesperrt werden, bis im Support-Ticket geklärt ist, dass es zum Bot gehört.

## Abuse (Regelverstöße)

- Erkennt das System oder das Team einen möglichen Verstoß (z. B. eine Website auf dem Server, Krypto-Mining, Angriffe),
  wird ein Abuse-Verfahren eingeleitet und von einer weiteren Stelle im Team geprüft.
- Wird der Verstoß bestätigt, wird der Server gesperrt und unter „Meine Server“ rot als „Abuse“ markiert; dazu kommt
  eine E-Mail mit dem Grund.
- Klären lässt sich das nur über ein Ticket auf unserem Discord-Server. Der Chat kann eine Sperre oder Markierung
  nicht aufheben.
- Auch auf Minecraft-Servern sind Websites nicht erlaubt. Ausgenommen sind Web-Oberflächen, die direkt zum
  Minecraft-Server gehören, z. B. eine Live-Karte.

## Discord

- Unter „Meine Server“ lässt sich das Discord-Konto verbinden („Mit Discord verbinden“). Dabei fragt Discord nach der
  Zustimmung; das Konto tritt automatisch unserem Discord-Server bei.
- Jedes Discord-Konto kann nur mit einem Account verbunden werden.
- Ist die Discord-Mitgliedschaft Pflicht, werden Server erst erstellt oder reaktiviert, wenn das Konto verbunden und
  Mitglied unseres Discord-Servers ist. Nur über den Einladungslink beizutreten genügt nicht – erst die Verbindung zeigt,
  welches Discord-Konto zu welchem Account gehört.
- Wer einen Server oder Bot hat und verbunden ist, bekommt auf Discord automatisch die Customer-Rolle.
- Auf Discord gibt es ein Ticket-System für den Support. Im Ticket werden Account-ID und Server-ID automatisch
  eingetragen.
- Wer dem Bot „Crafting System“ per Direktnachricht `!start` schreibt, bekommt seine Server als Buttons und kann sie
  damit starten.

## Häufige Probleme

**Der Server startet nicht.** Im Panel die Konsole öffnen – dort steht die Fehlermeldung. Häufige Ursachen bei
Minecraft: ein fehlerhaftes Plugin oder eine Mod, eine unpassende Version, zu wenig Arbeitsspeicher für die gewählten
Mods, oder die EULA wurde nicht akzeptiert. Bei Discord-Bots: Fehler im eigenen Code, fehlende Pakete
(`requirements.txt` bzw. `package.json`), falsche Startdatei oder ein ungültiger Bot-Token. Unter „Meine Server“ steht
außerdem, ob gerade eine Fair-Use-Pause läuft.

**Ich kann mich nicht mit dem Minecraft-Server verbinden.** Prüfen, ob der Server im Panel als „läuft“ angezeigt wird,
ob die Adresse genau stimmt und ob die Version des Spiels zur Version des Servers passt.

**Der Server ist langsam.** Die Ressourcen sind geteilt und begrenzt. Hilfreich sind weniger Plugins/Mods, eine
kleinere Sichtweite und regelmäßige Neustarts. Mehr Leistung gibt es nur mit einem größeren oder bezahlten Paket.

**Der Server ist suspendiert.** Unter „Meine Server“ steht der Grund. Nach dem Ende des Zyklus (Minecraft) bzw. nach
einer Freigabe wegen Inaktivität (Discord-Bot) lässt er sich dort reaktivieren. Wurde er vom Team gesperrt, hilft nur
der Support.

**Mein Server oder meine Welt ist weg.** Wird ein suspendierter Server nicht rechtzeitig reaktiviert, wird er
automatisch gelöscht; davor gibt es E-Mails. Gelöschte Server können nicht wiederhergestellt werden. Es lohnt sich,
regelmäßig ein Backup im Panel zu erstellen und herunterzuladen.

**Ich möchte meinen Server oder mein Konto löschen.** Beides geht unter „Meine Server“. Das Löschen ist endgültig.

**Ich möchte ein anderes Paket.** Den alten Server unter „Meine Server“ löschen und einen neuen mit dem gewünschten
Paket erstellen. Vorher die eigenen Dateien im Panel sichern.

## Weitere Seiten

- Statusseite: zeigt, ob alle Dienste laufen, den Verlauf der letzten Wochen und geplante Wartungen.
- FAQ und Regeln/Nutzungsbedingungen: stehen im Menü und im Fuß der Website.
- Newsletter: Anmeldung im Fuß der Website, Abmeldung über den Link in jeder E-Mail.
- Spenden: Wenn die Spenden-Seite eingeschaltet ist, steht sie im Menü. Spenden sind freiwillig und bringen keine
  Vorteile beim Hosting.
- Kostenpflichtige Extras: Nur wenn sie unten bei „Aktuelle Werte“ mit Preis aufgeführt sind, gibt es sie. Sie sind
  freiwillig und gelten je Server. Gebucht wird unter „Meine Server“ → Verwalten → Extras. Bezahlt wird im Voraus für
  eine Laufzeit. Standard ist die einmalige Buchung: Sie endet von selbst, nichts verlängert sich, nichts ist zu
  kündigen – danach läuft der Server kostenlos weiter. Manche Extras gibt es auf Wunsch als Abo: Es verlängert sich
  automatisch, vor jeder Abbuchung kommt eine E-Mail, und es ist jederzeit zum Ende der bezahlten Laufzeit kündbar –
  beim Server unter „Extras“ („Abo kündigen“) oder ohne Anmeldung über „Verträge hier kündigen“ im Footer.
  Das Extra „24/7“ hebt Fair-Use-Pausen und den Zyklus mit Ruhetag auf, solange es aktiv ist; alle anderen Regeln
  gelten weiter. Extras wie eine eigene IPv4-Adresse richtet das Team nach der Zahlung ein. Nenne nur Preise, die bei
  „Aktuelle Werte“ stehen. Fragen zu einer Zahlung, Erstattung oder zum Widerruf klärt das Team (Ticket auf Discord
  oder E-Mail).

## Wobei nur das Team helfen kann

Der Chat-Assistent hat keinen Zugriff auf Konten, Server, Protokolle oder interne Systeme. Für diese Fälle ist das
Support-Team zuständig (Übergabe per Ticket auf Discord):

- gesperrte Konten oder vom Team gesperrte Server
- Fehler auf der Website oder im Panel, die sich nicht durch die Schritte oben lösen lassen
- zweite Stufe der Anmeldung zurücksetzen
- Fragen zu einem bestimmten Server, die einen Blick in dessen Daten brauchen
- Beschwerden, Missbrauchsmeldungen, Anfragen zum Datenschutz
