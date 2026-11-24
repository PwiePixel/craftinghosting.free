/**
 * Öffentliche Dokumentation für Nutzer (/docs). Kurz und in der Reihenfolge, in der man die Dinge braucht.
 * Platzhalter: {panel} = Adresse des Panels, {days} = Länge des Zyklus in Tagen.
 */
import type { DocPage } from './types';

export const userDocs: DocPage[] = [
  {
    slug: 'getting-started',
    title: { de: 'Erste Schritte', en: 'Getting started' },
    summary: { de: 'Konto anlegen, Server wählen, Discord verbinden – in wenigen Minuten zum eigenen Server.', en: 'Create an account, choose a server, connect Discord – your own server in a few minutes.' },
    sections: [
      {
        heading: { de: 'So kommst du zu deinem Server', en: 'How to get your server' },
        blocks: [
          {
            ol: [
              { de: 'Registrieren: E-Mail-Adresse und Passwort eingeben, AGB akzeptieren. Du bist danach sofort angemeldet.', en: 'Sign up: enter your email address and a password and accept the terms. You are signed in right away.' },
              { de: 'Server erstellen: Angebot wählen (Minecraft-Server oder Discord-Bot), Paket, Typ bzw. Programmiersprache, Version und einen Namen.', en: 'Create a server: choose the offer (Minecraft server or Discord bot), plan, type or programming language, version and a name.' },
              { de: 'Discord verbinden: Dabei trittst du unserem Discord-Server bei. Kostenlose Server gibt es nur für Mitglieder unseres Discord-Servers.', en: 'Connect Discord: you join our Discord server while doing so. Free servers are only available to members of our Discord server.' },
              { de: 'Panel-Zugang festlegen: Benutzername und Passwort für das Panel. Danach wird dein Server automatisch installiert (meist ein bis zwei Minuten).', en: 'Set up panel access: a username and password for the panel. After that your server is installed automatically (usually one to two minutes).' },
            ],
          },
          { note: { de: 'Solange Discord nicht verbunden ist, bleibt dein Server eine offene Anfrage. Du findest den offenen Schritt jederzeit unter „Server erstellen“ oder „Meine Server“.', en: 'Until Discord is connected your server stays an open request. You can find the open step at any time under “Create server” or “My servers”.' } },
        ],
      },
      {
        heading: { de: 'Wo verwalte ich was?', en: 'Where do I manage what?' },
        blocks: [
          {
            ul: [
              { de: '„Meine Server“ auf dieser Website: Übersicht, Adresse zum Verbinden, Laufzeit, Verlängern, Konto-Einstellungen.', en: '“My servers” on this website: overview, address to connect, runtime, renewing, account settings.' },
              { de: 'Das Panel ({panel}): Starten und Stoppen, Konsole, Dateien, Backups, Einstellungen des Servers.', en: 'The panel ({panel}): start and stop, console, files, backups, server settings.' },
              { de: 'Unser Discord-Server: Hilfe, Ankündigungen, Tickets und Befehle an den Bot.', en: 'Our Discord server: help, announcements, tickets and bot commands.' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'minecraft',
    title: { de: 'Minecraft-Server', en: 'Minecraft servers' },
    summary: { de: 'Verbinden, EULA, Plugins und Mods, Welten und Backups.', en: 'Connecting, EULA, plugins and mods, worlds and backups.' },
    sections: [
      {
        heading: { de: 'Starten und verbinden', en: 'Starting and connecting' },
        blocks: [
          {
            ol: [
              { de: 'Öffne deinen Server im Panel und klicke auf „Start“.', en: 'Open your server in the panel and click “Start”.' },
              { de: 'Beim allerersten Start fragt Minecraft nach der EULA. Lies sie unter minecraft.net/eula und bestätige sie im Panel (oder über den Discord-Bot).', en: 'On the very first start Minecraft asks for the EULA. Read it at minecraft.net/eula and confirm it in the panel (or through the Discord bot).' },
              { de: 'Die Adresse zum Verbinden steht unter „Meine Server“ und im Panel. Trage sie in Minecraft unter „Mehrspieler → Server hinzufügen“ ein.', en: 'The address to connect is shown under “My servers” and in the panel. Enter it in Minecraft under “Multiplayer → Add server”.' },
            ],
          },
          { note: { de: 'Die Minecraft-Version im Spiel muss zur Version deines Servers passen. Die Version wählst du beim Erstellen.', en: 'The Minecraft version of your game must match the version of your server. You choose the version when creating it.' } },
        ],
      },
      {
        heading: { de: 'Plugins, Mods und Dateien', en: 'Plugins, mods and files' },
        blocks: [
          {
            ul: [
              { de: 'Plugins (Paper, Purpur): im Panel unter „Files“ in den Ordner „plugins“ hochladen, dann den Server neu starten.', en: 'Plugins (Paper, Purpur): upload them to the “plugins” folder under “Files” in the panel, then restart the server.' },
              { de: 'Mods (Forge, Fabric): in den Ordner „mods“ hochladen. Alle Mitspieler brauchen dieselben Mods.', en: 'Mods (Forge, Fabric): upload them to the “mods” folder. All players need the same mods.' },
              { de: 'Eigene Welt: den Weltordner hochladen und in der Datei „server.properties“ bei „level-name“ eintragen.', en: 'Your own world: upload the world folder and set its name as “level-name” in “server.properties”.' },
              { de: 'Operator-Rechte: in der Konsole „op DeinName“ eingeben.', en: 'Operator rights: enter “op YourName” in the console.' },
            ],
          },
        ],
      },
      {
        heading: { de: 'Backups', en: 'Backups' },
        blocks: [{ p: { de: 'Je nach Paket gibt es Backup-Plätze. Backups legst du im Panel unter „Backups“ an und spielst sie dort auch wieder ein. Lade wichtige Welten zusätzlich auf deinen PC herunter.', en: 'Depending on your plan you have backup slots. You create and restore backups in the panel under “Backups”. Also download important worlds to your PC.' } }],
      },
    ],
  },
  {
    slug: 'discord-bots',
    title: { de: 'Discord-Bots', en: 'Discord bots' },
    summary: { de: 'Eigenen Bot in Python oder Node.js hochladen und dauerhaft laufen lassen.', en: 'Upload your own bot in Python or Node.js and keep it running.' },
    sections: [
      {
        heading: { de: 'Bot einrichten', en: 'Setting up your bot' },
        blocks: [
          {
            ol: [
              { de: 'Beim Erstellen „Discord-Bot“ und die Programmiersprache wählen (Python oder Node.js).', en: 'When creating, choose “Discord bot” and the programming language (Python or Node.js).' },
              { de: 'Im Panel unter „Files“ deine Dateien hochladen – auch „requirements.txt“ (Python) bzw. „package.json“ (Node.js).', en: 'Upload your files under “Files” in the panel – including “requirements.txt” (Python) or “package.json” (Node.js).' },
              { de: 'Unter „Startup“ die Startdatei eintragen (z. B. „bot.py“ oder „index.js“).', en: 'Enter the start file under “Startup” (for example “bot.py” or “index.js”).' },
              { de: 'Den Bot-Token nie in öffentliche Dateien schreiben – nutze eine „.env“-Datei oder die Startvariablen.', en: 'Never put your bot token in public files – use an “.env” file or the startup variables.' },
              { de: 'Im Panel auf „Start“ klicken. Fehler stehen in der Konsole.', en: 'Click “Start” in the panel. Errors are shown in the console.' },
            ],
          },
        ],
      },
      {
        heading: { de: 'Was erlaubt ist', en: 'What is allowed' },
        blocks: [
          {
            ul: [
              { de: 'Der Server ist für deinen Discord-Bot gedacht – keine anderen Programme, kein Mining, keine Angriffe.', en: 'The server is meant for your Discord bot – no other software, no mining, no attacks.' },
              { de: 'Websites sind nicht erlaubt – Ausnahme: ein Dashboard für deinen eigenen Bot mit klarer Anmeldung und Impressum.', en: 'Websites are not allowed – exception: a dashboard for your own bot with a clear sign-in and legal notice.' },
              { de: 'Strengstens verboten: Lavalink, NodeLink und jede vergleichbare Audio-Software sowie Musik- und Audio-Streaming über den Server.', en: 'Strictly prohibited: Lavalink, NodeLink and any comparable audio software, as well as music and audio streaming through the server.' },
              { de: 'Bots laufen durchgehend. Dauerhaft sehr hohe CPU-Last führt zu einem automatischen Stopp.', en: 'Bots run continuously. Permanently very high CPU load leads to an automatic stop.' },
            ],
          },
          { p: { de: 'Die vollständigen Regeln stehen in den Nutzungsbedingungen für Discord-Bots.', en: 'The complete rules are in the terms of use for Discord bots.' } },
        ],
      },
    ],
  },
  {
    slug: 'runtime',
    title: { de: 'Laufzeit, Verlängern und Fair-Use', en: 'Runtime, renewing and fair use' },
    summary: { de: 'Warum Server ablaufen, wie du sie verlängerst und was Fair-Use bedeutet.', en: 'Why servers expire, how to renew them and what fair use means.' },
    sections: [
      {
        heading: { de: 'Der {days}-Tage-Zyklus (Minecraft)', en: 'The {days}-day cycle (Minecraft)' },
        blocks: [
          { p: { de: 'Ein kostenloser Minecraft-Server läuft {days} Tage. Danach wird er gestoppt und gesperrt – deine Daten bleiben erhalten. Unter „Meine Server“ verlängerst du ihn kostenlos um weitere {days} Tage.', en: 'A free Minecraft server runs for {days} days. After that it is stopped and suspended – your data is kept. Under “My servers” you renew it for free for another {days} days.' } },
          {
            ul: [
              { de: 'Vor dem Ablauf bekommst du eine Erinnerung (E-Mail und Discord-Direktnachricht).', en: 'Before it expires you receive a reminder (email and Discord direct message).' },
              { de: 'Nach dem Ablauf gibt es eine kurze Ruhezeit, bevor du verlängern kannst.', en: 'After it expires there is a short rest period before you can renew.' },
              { de: 'Wird ein abgelaufener Server längere Zeit nicht verlängert, wird er gelöscht. Das Datum steht unter „Meine Server“.', en: 'If an expired server is not renewed for a longer time it is deleted. The date is shown under “My servers”.' },
            ],
          },
          { note: { de: 'Discord-Bots haben keinen Zyklus – sie laufen ohne Ablaufdatum.', en: 'Discord bots have no cycle – they run without an end date.' } },
        ],
      },
      {
        heading: { de: 'Fair-Use', en: 'Fair use' },
        blocks: [
          { p: { de: 'Damit alle etwas von den kostenlosen Servern haben, gibt es Grenzen für die Laufzeit am Stück und eine wöchentliche Offline-Zeit. Die aktuellen Werte und der Stand deines Servers stehen unter „Meine Server“. Vor einer Pause gibt es einen Hinweis im Spiel.', en: 'So that everyone benefits from the free servers there are limits on continuous runtime and a weekly offline time. The current values and the state of your server are shown under “My servers”. Before a pause there is a notice in the game.' } },
        ],
      },
      {
        heading: { de: 'Regelverstöße (Abuse)', en: 'Rule violations (abuse)' },
        blocks: [
          { p: { de: 'Stellt unser System oder unser Team einen Verstoß fest, wird der Server unter „Meine Server“ rot als „Abuse“ markiert und kann gesperrt werden. Dort steht auch, ob das System oder das Team den Verstoß festgestellt hat. Öffne in diesem Fall ein Ticket auf unserem Discord-Server, damit wir das klären können.', en: 'If our system or our team detects a violation, the server is marked red as “Abuse” under “My servers” and may be suspended. It also says whether the system or the team detected it. In that case open a ticket on our Discord server so that we can sort it out.' } },
        ],
      },
      {
        heading: { de: 'Verwarnungen', en: 'Warnings' },
        blocks: [
          { p: { de: 'Jede Abuse-Nachricht von uns zählt als eine Verwarnung. Wie viele du hast, steht unter „Meine Server“.', en: 'Every abuse notice from us counts as one warning. How many you have is shown under “My servers”.' } },
          {
            ul: [
              { de: '1. Verwarnung: noch keine Folge – bitte stelle den Verstoß ab.', en: '1st warning: no consequence yet – please stop the violation.' },
              { de: '2. und 3. Verwarnung: Alle deine Dienste sind jeweils 48 Stunden offline. Danach kannst du sie wieder starten.', en: '2nd and 3rd warning: all your services are offline for 48 hours each time. After that you can start them again.' },
              { de: '4. Verwarnung: Dein Konto wird dauerhaft gesperrt. Deine Server werden gesperrt und nach 14 Tagen samt Daten gelöscht. E-Mail-Adresse und Discord-Konto bleiben gesperrt.', en: '4th warning: your account is banned permanently. Your servers are suspended and deleted including their data after 14 days. Email address and Discord account stay banned.' },
              { de: 'Eine Verwarnung verfällt nach 180 Tagen. Hältst du eine für unberechtigt, öffne bitte ein Ticket auf unserem Discord-Server – wir können sie zurücknehmen.', en: 'A warning expires after 180 days. If you think one is unjustified, please open a ticket on our Discord server – we can revoke it.' },
              { de: 'Solange zu einem Server eine Abuse-Meldung offen ist, lässt er sich nicht löschen; auch dein Konto lässt sich so lange nicht löschen. Das wird wieder möglich, sobald der Fall per Ticket geklärt ist.', en: 'While an abuse report is open for a server, it cannot be deleted; your account cannot be deleted during that time either. This becomes possible again once the case has been resolved via a ticket.' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'discord',
    title: { de: 'Discord: Verbinden, Bot-Befehle, Tickets', en: 'Discord: connecting, bot commands, tickets' },
    summary: { de: 'Warum Discord Pflicht ist und was unser Bot für dich tun kann.', en: 'Why Discord is required and what our bot can do for you.' },
    sections: [
      {
        heading: { de: 'Discord-Konto verbinden', en: 'Connecting your Discord account' },
        blocks: [
          { p: { de: 'Kostenlose Server gibt es nur für Mitglieder unseres Discord-Servers. Klicke unter „Meine Server“ oder beim Erstellen auf „Mit Discord verbinden“ und bestätige bei Discord – dabei trittst du unserem Server automatisch bei. Nur über einen Einladungslink beizutreten genügt nicht.', en: 'Free servers are only available to members of our Discord server. Click “Connect with Discord” under “My servers” or while creating and confirm on Discord – you join our server automatically while doing so. Joining only through an invite link is not enough.' } },
          { note: { de: 'Jedes Discord-Konto lässt sich nur mit einem Account verbinden. Verlässt du unseren Discord-Server, können deine Server nicht mehr verlängert werden.', en: 'Each Discord account can only be connected to one account. If you leave our Discord server your servers can no longer be renewed.' } },
        ],
      },
      {
        heading: { de: 'Befehle per Direktnachricht an den Bot', en: 'Commands by direct message to the bot' },
        blocks: [
          {
            table: {
              head: [{ de: 'Befehl', en: 'Command' }, { de: 'Was passiert', en: 'What happens' }],
              rows: [
                ['!start', { de: 'Startet einen deiner Server (Auswahl per Button).', en: 'Starts one of your servers (choose with a button).' }],
                ['!stop', { de: 'Stoppt einen Server.', en: 'Stops a server.' }],
                ['!restart', { de: 'Startet einen Server neu.', en: 'Restarts a server.' }],
                ['!rewards', { de: 'Zeigt deine Einladungen, Boosts und Belohnungen.', en: 'Shows your invites, boosts and rewards.' }],
              ],
            },
          },
        ],
      },
      {
        heading: { de: 'Hilfe bekommen', en: 'Getting help' },
        blocks: [
          {
            ul: [
              { de: 'Support-Chat unten rechts auf dieser Website – bei Bedarf wird an das Team übergeben.', en: 'Support chat at the bottom right of this website – it hands over to the team when needed.' },
              { de: 'Ticket auf unserem Discord-Server öffnen.', en: 'Open a ticket on our Discord server.' },
              { de: 'Die Statusseite zeigt, ob gerade Störungen oder Wartungsarbeiten laufen.', en: 'The status page shows whether there are incidents or maintenance at the moment.' },
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'account',
    title: { de: 'Konto und Anmeldung', en: 'Account and sign-in' },
    summary: { de: 'Anmelden, Passwort, „Angemeldet bleiben“, E-Mail-Adresse und Konto löschen.', en: 'Signing in, password, “Stay signed in”, email address and deleting your account.' },
    sections: [
      {
        heading: { de: 'Anmelden', en: 'Signing in' },
        blocks: [
          {
            ul: [
              { de: 'Mit E-Mail-Adresse und Passwort.', en: 'With your email address and password.' },
              { de: 'Mit deinem verbundenen Discord-Konto („Mit Discord anmelden“).', en: 'With your connected Discord account (“Sign in with Discord”).' },
              { de: 'Mit einem Code per E-Mail („Stattdessen Code per E-Mail senden“).', en: 'With a code by email (“Send a code by email instead”).' },
            ],
          },
          { p: { de: 'Passwort vergessen? Melde dich mit Discord oder einem Code per E-Mail an und lege unter „Meine Server“ → Konto ein neues Passwort fest.', en: 'Forgot your password? Sign in with Discord or a code by email and set a new password under “My servers” → Account.' } },
        ],
      },
      {
        heading: { de: 'Einstellungen unter „Meine Server“ → Konto', en: 'Settings under “My servers” → Account' },
        blocks: [
          {
            ul: [
              { de: '„Angemeldet bleiben“: Eingeschaltet wirst du nicht mehr nach kurzer Zeit abgemeldet. Nicht auf fremden Geräten einschalten.', en: '“Stay signed in”: when enabled you are no longer signed out after a short time. Do not enable it on devices that are not yours.' },
              { de: 'Passwort ändern oder entfernen. Beim Ändern werden andere Geräte abgemeldet.', en: 'Change or remove your password. Changing it signs out other devices.' },
              { de: 'Zweite Stufe der Anmeldung (Authenticator-App) unter „Sicherheit“.', en: 'Second sign-in step (authenticator app) under “Security”.' },
              { de: 'Konto löschen: entfernt dein Konto und alle kostenlosen Server endgültig.', en: 'Delete account: permanently removes your account and all free servers.' },
            ],
          },
        ],
      },
      {
        heading: { de: 'E-Mail-Adresse', en: 'Email address' },
        blocks: [
          { p: { de: 'Die Bestätigung deiner E-Mail-Adresse ist freiwillig – dein Server läuft auch ohne. Unter „Meine Server“ kannst du den Code eingeben, einen neuen anfordern oder die Adresse ändern. Eine bestätigte Adresse ist die Voraussetzung, um Partner zu werden.', en: 'Confirming your email address is optional – your server runs without it. Under “My servers” you can enter the code, request a new one or change the address. A confirmed address is required to become a partner.' } },
          { note: { de: 'Kommt keine E-Mail an? Prüfe den Spam-Ordner und die Schreibweise. Wichtige Hinweise schickt unser Bot zusätzlich als Discord-Direktnachricht.', en: 'No email arriving? Check your spam folder and the spelling. Our bot also sends important notices as a Discord direct message.' } },
        ],
      },
    ],
  },
];
