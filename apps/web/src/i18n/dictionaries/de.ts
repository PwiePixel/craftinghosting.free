/**
 * Deutsche Texte der Website. Werte aus der zentralen Konfiguration
 * (Stunden, Tage, RAM …) werden eingesetzt und bleiben so automatisch aktuell.
 * Die englische Fassung (en.ts) muss dieselbe Struktur haben – TypeScript prüft das.
 */
import { formatMb, freeHostingConfig, restPeriodAfterText, restPeriodText } from '@chfree/shared';

/** Werte aus dem Admin-Bereich (Pakete, Standorte, Hardware), die in Texten vorkommen */
export interface FaqContext {
  /** z. B. „4 GB oder 6 GB“ */
  minecraftRam: string;
  /** z. B. „256 MB bis 2 GB“ – null, wenn keine Discord-Bots angeboten werden */
  discordRam: string | null;
  /** Gilt das Fair-Use-System auch für Discord-Bots? */
  discordFairUse: boolean;
  /** Ist die Mitgliedschaft auf dem Discord-Server Pflicht? */
  discordRequired: boolean;
  /** z. B. „Deutschland“ */
  locations: string;
  /** z. B. „Dual Intel Xeon Gold 6230“ */
  cpus: string;
}

/**
 * Baut die deutschen Texte mit den AKTUELLEN Regeln (Fair-Use, Laufzeit). Die Werte sind im Admin-Bereich
 * einstellbar – deshalb eine Funktion statt fester Konstanten. Aufruf über getDict()/useDict() (mit Zwischenspeicher).
 */
export function buildDe() {
const { fairUse, cycle, hardware, serverTypes } = freeHostingConfig;
const minecraftTypes = serverTypes.filter((t) => t.kind === 'minecraft');
const botTypes = serverTypes.filter((t) => t.kind === 'discord');

const hasRest = cycle.reactivationCooldownMinutes > 0;
const rest = restPeriodText(cycle.reactivationCooldownMinutes, 'de');
const afterRest = restPeriodAfterText(cycle.reactivationCooldownMinutes, 'de');
const reminders = cycle.reminderDaysBefore.map((d) => (d === 1 ? '1 Tag' : `${d} Tage`)).join(' und ');
/** Automatische Löschung X Stunden nach der Ruhezeit (0 = aus) */
const delH = cycle.deleteAfterRestHours;
const epyc = hardware.cpus.find((c) => /epyc/i.test(c)) ?? 'AMD EPYC';
const xeon = hardware.cpus.find((c) => /xeon/i.test(c)) ?? 'Intel Xeon';
/** „ein kostenloser Server“ / „2 kostenlose Server“ – Anzahl kommt aus den Admin-Einstellungen */

return {
  meta: {
    title: 'CraftingHosting.free – Kostenlose Minecraft-Server & Discord-Bots von CraftingHosting',
    shortTitle: 'CraftingHosting.free – Kostenlose Minecraft-Server & Discord-Bots',
    description:
      'Kostenloser Minecraft-Server oder Discord-Bot (Python, Node.js) von Crafting Hosting: hier erstellen, im Pterodactyl-Panel verwalten. Moderne Hardware, NVMe-Speicher – ohne monatliche Kosten.',
    keywords: [
      'kostenloser Minecraft Server',
      'Minecraft Server kostenlos',
      'Free Minecraft Hosting',
      'Minecraft Hosting Deutschland',
      'Discord Bot Hosting kostenlos',
      'Discord Bot hosten',
      'Python Discord Bot Hosting',
      'Node.js Discord Bot Hosting',
      'CraftingHosting',
      'Pterodactyl',
      'Paper Server',
      'Fabric Server',
      'Forge Server',
    ],
    ogLocale: 'de_DE',
    ogImageAlt: 'CraftingHosting.free – Kostenlose Minecraft-Server & Discord-Bots von CraftingHosting',
    ogTagline: 'Kostenlose Minecraft-Server & Discord-Bots. Ohne versteckte Kosten.',
    ogChips: ['0 € / Monat', 'Minecraft', 'Discord-Bots', 'NVMe', 'Pterodactyl'],
    manifestDescription: 'Kostenloses Minecraft- und Discord-Bot-Hosting von CraftingHosting',
  },

  common: {
    skipToContent: 'Zum Inhalt springen',
    startFree: 'Kostenlos starten',
    signIn: 'Anmelden',
    createServer: 'Server erstellen',
    myServers: 'Meine Server',
    openPanel: 'Im Panel öffnen',
    toPanel: 'Zum Panel',
    discord: 'Discord',
    perMonth: '/ Monat',
    latestVersion: 'Neueste Version',
    latestShort: '(neueste)',
    unexpectedError: 'Es ist ein unerwarteter Fehler aufgetreten.',
    networkError: 'Keine Verbindung zum Server. Bitte prüfe deine Internetverbindung.',
    genericError: 'Es ist ein Fehler aufgetreten. Bitte versuche es erneut.',
    apiUnavailable: 'Die API ist aktuell nicht erreichbar. Bitte versuche es in einem Moment erneut.',
  },

  nav: {
    plans: 'Pakete',
    how: 'Ablauf',
    rules: 'Regeln',
    discord: 'Discord-Bots',
    faq: 'FAQ',
    status: 'Status',
    donate: 'Spenden',
    main: 'Hauptnavigation',
    mobile: 'Mobile Navigation',
    openMenu: 'Menü öffnen',
    closeMenu: 'Menü schließen',
    language: 'Sprache',
    switchLabel: 'English',
    switchTitle: 'Switch to English',
  },

  footer: {
    aboutBefore: 'CraftingHosting.free ist das kostenlose Minecraft- und Discord-Bot-Hosting von ',
    aboutAfter: '.',
    contact: 'Kontakt',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    terms: 'AGB',
    rules: 'Nutzungsbedingungen',
    discordTerms: 'Nutzungsbedingungen Discord-Bots',
    cookies: 'Cookies',
    newsletter: 'Newsletter',
    donate: 'Spenden',
    label: 'Footer',
  },

  home: {
    kicker: 'Das kostenlose Angebot von Crafting Hosting',
    heroLine1: 'Minecraft‑Server',
    heroLine1b: '& Discord‑Bots.',
    heroLine2: 'Kostenlos.',
    /** `locations` z. B. „Deutschland“ – kommt aus dem Admin-Bereich */
    heroText: (locations: string) =>
      `Ohne versteckte Kosten und ohne Zahlungsdaten: Minecraft-Server oder Discord-Bot hier erstellen, im Pterodactyl-Panel von Crafting Hosting verwalten. Moderne Hardware in ${locations}.`,
    howLink: 'So funktioniert’s',
    /** `maxRam` = größtes Paket, `locationCodes` z. B. „DE“ – beides aus dem Admin-Bereich */
    facts: (maxRam: string, locationCodes: string, locationCount: number): [string, string][] => [
      ['0 €', 'pro Monat'],
      [`bis ${maxRam}`, 'RAM'],
      ['NVMe', 'SSD-Speicher'],
      [locationCodes, locationCount === 1 ? 'Standort' : 'Standorte'],
    ],
    datacenters: (locations: string, count: number) => `${count === 1 ? 'Rechenzentrum' : 'Rechenzentren'} in ${locations}`,
    slotsLeft: (left: string, total: string) => `Noch ${left} von ${total} Plätzen frei`,
    slotsFull: 'Aktuell alle Plätze belegt',

    howLabel: 'Ablauf',
    howTitle: 'In drei Schritten zum eigenen Server.',
    howText: 'Die Website erstellt deinen Server. Gespielt und verwaltet wird er im Pterodactyl-Panel – mit Konsole, Dateimanager, Plugins und Backups.',
    steps: (panelHost: string): [string, string][] => [
      ['Server konfigurieren', 'Paket, Servertyp, Version und Namen wählen. Keine Zahlungsdaten, kein Abo.'],
      ['E-Mail bestätigen', 'Sechsstelligen Code aus der E-Mail eingeben und dein Passwort für das Panel festlegen. Der Server wird automatisch angelegt.'],
      ['Im Panel loslegen', `Unter ${panelHost} anmelden, Server starten und spielen. Alles Weitere läuft automatisch.`],
    ],

    plansLabel: 'Minecraft-Pakete',
    plansTitle: (n: number) => (n === 1 ? 'Ein Paket. Kostenlos.' : n === 2 ? 'Zwei Pakete. Beide kostenlos.' : `${n} Pakete. Alle kostenlos.`),
    plansText: 'Kostenlose Server teilen sich die Hardware eines Nodes fair. Die Werte sind Obergrenzen, keine garantierte Dauerleistung.',
    morePower: 'Mehr Leistung',
    planRows: {
      ram: 'Arbeitsspeicher',
      cpu: 'CPU',
      cpuValue: (threads: string, one: boolean) => `bis ${threads} ${one ? 'Thread' : 'Threads'} · geteilt`,
      disk: 'NVMe-Speicher',
      backups: 'Backups',
      databases: 'Datenbanken',
      ports: 'Ports',
      backupsValue: (n: number) => `${n}, täglich automatisch`,
      manage: 'Verwaltung',
      manageValue: 'Pterodactyl-Panel',
    },
    createPlan: (name: string) => `${name} erstellen`,

    discord: {
      label: 'Discord-Bots',
      title: 'Dein Discord-Bot. Rund um die Uhr online.',
      text: 'Hoste deinen eigenen Discord-Bot kostenlos – in Python oder Node.js. Code hochladen, Startdatei wählen, starten. Die Bots laufen auf einer eigenen Node, getrennt von den Minecraft-Servern.',
      runtimes: 'Sprache wählbar',
      points: (fairUseOn: boolean) => [
        `${botTypes.map((t) => t.name).join(' oder ')} – discord.py, discord.js & Co.`,
        'Pterodactyl-Panel: Konsole, Dateimanager, SFTP, Startparameter',
        fairUseOn ? `Fair-Use wie bei Minecraft: max. ${fairUse.maxSessionHours} h am Stück` : 'Durchgehend online: kein Laufzeitlimit, keine Pflicht-Pausen',
        'Fair-Use für Bots: keine CPU-Dauerlast, Platz für aktive Bots',
        `Kein ${cycle.days}-Tage-Zyklus, kein Ruhetag – läuft ohne Ablaufdatum`,
      ],
      rows: { ram: 'Arbeitsspeicher', cpu: 'CPU', disk: 'NVMe-Speicher', runtime: 'Sprache', runtimeValue: botTypes.map((t) => t.name).join(' / ') },
      create: (name: string) => `${name} erstellen`,
      termsLink: 'Nutzungsbedingungen für Discord-Bots',
      soon: 'Discord-Bot-Hosting startet in Kürze.',
      /** Fair-Use-System für Bots – Werte kommen aus dem Admin-Bereich */
      rulesLabel: 'Fair-Use für Discord-Bots',
      rulesTitle: 'Durchgehend online – und trotzdem fair.',
      rulesText:
        'Bots brauchen keine Pausen. Damit die gemeinsame Node für alle schnell bleibt, achtet ein automatisches System auf die Auslastung statt auf die Laufzeit – und warnt per E-Mail, bevor etwas passiert.',
      rules: (r: { cpuThresholdPercent: number; cpuWindowMinutes: number; cooldownMinutes: number; maxStrikes: number; strikeWindowDays: number; inactiveDays: number }): [string, string, string][] => [
        ['24/7', 'durchgehend online', 'Kein Laufzeitlimit, keine Pflicht-Offline-Zeit. Dein Bot läuft, solange du ihn laufen lässt.'],
        [
          `${r.cpuThresholdPercent} %`,
          'CPU – keine Dauerlast',
          `Lastspitzen sind okay. Bleibt die CPU ${r.cpuWindowMinutes} Minuten am Stück über ${r.cpuThresholdPercent} % des Limits, wird der Bot nach einer Vorwarnung gestoppt und pausiert ${r.cooldownMinutes} Minuten.${r.maxStrikes > 0 ? ` ${r.maxStrikes} Stopps in ${r.strikeWindowDays} Tagen führen zur Sperre.` : ''}`,
        ],
        ...(r.inactiveDays > 0
          ? ([[`${r.inactiveDays} Tage`, 'offline = Platz frei', 'Plätze sind für aktive Bots. Wer so lange am Stück offline ist, gibt seinen Platz frei – reaktivieren geht mit einem Klick.']] as [string, string, string][])
          : []),
        ['∞', 'kein Ablaufdatum', `Anders als bei Minecraft gibt es keinen ${cycle.days}-Tage-Zyklus und keinen Ruhetag. Dein Bot muss nie verlängert werden.`],
      ],
    },
    planLeft: (left: string, total: string) => `Noch ${left} von ${total} Plätzen frei`,
    planFull: 'Aktuell ausgebucht',
    premiumTitle: 'Mehr Leistung?',
    premiumSub: 'Crafting Hosting Premium',
    premiumText: 'Für Communities, große Modpacks und Server mit mehr Spielern: kostenpflichtige Pakete mit mehr Ressourcen und weniger Einschränkungen.',
    premiumPoints: ['Mehr RAM & CPU', 'Weniger Einschränkungen', 'Direkt bei Crafting Hosting'],
    premiumCta: 'Angebote ansehen',

    rulesLabel: 'Fair-Use für Minecraft-Server',
    rulesTitle: 'Fair für alle – und vollautomatisch.',
    rulesText:
      'Damit kostenloses Hosting dauerhaft für viele funktioniert, gelten drei Regeln. Unser System kümmert sich selbst darum und warnt vorher – im Minecraft-Chat, im Panel und per E-Mail.',
    rules: [
      [
        `${fairUse.maxSessionHours} h`,
        'am Stück online',
        `Danach stoppt der Server automatisch und kann nach ${fairUse.cooldownMinutes} Minuten Pause wieder gestartet werden.`,
      ],
      [`${fairUse.weeklyOfflineHours} h`, 'offline pro Woche', 'Kommt meist nebenbei zusammen, z. B. nachts. Wird es knapp, stoppt das System rechtzeitig.'],
      [
        `${cycle.days} Tage`,
        'Laufzeit',
        `Danach wird der Server suspendiert. Deine Welt bleibt erhalten – ${hasRest ? `${afterRest} ` : ''}reaktivieren mit einem Klick.${delH > 0 ? ` Ohne Reaktivierung wird er ${delH} Stunden später gelöscht.` : ''}`,
      ],
    ] as [string, string, string][],
    automation: [
      'Warnungen 30, 10 und 1 Minute vor jedem automatischen Stopp im Chat',
      'Status direkt in der Serverbeschreibung im Panel',
      'Starts während einer Pause werden automatisch rückgängig gemacht',
      `Erinnerung per E-Mail ${reminders} vor Ablauf${delH > 0 ? ' – und bevor ein nicht reaktivierter Server gelöscht wird' : ` der ${cycle.days} Tage`}`,
    ],

    stats: {
      label: 'CraftingHosting.free in Zahlen',
      users: 'Registrierte Nutzer',
      servers: 'Aktive Server',
      uptime: 'Uptime (30 Tage)',
    },

    faqTitle: 'Häufige Fragen',
    faqMoreBefore: 'Noch etwas unklar? ',
    faqMoreAll: 'Alle Fragen',
    faqMoreMiddle: ' oder direkt im ',
    faqMoreAfter: '.',
    ctaText: 'Das ist Crafting Hosting – nur kostenlos. Dein Server ist in wenigen Minuten bereit.',
    jsonLdService: 'CraftingHosting.free – Kostenloses Minecraft- und Discord-Bot-Hosting',
  },

  panelPreview: {
    serverName: 'Survival mit Freunden',
    description: `CraftingHosting.free · noch 29 Tage aktiv · max. ${fairUse.maxSessionHours} h am Stück`,
    online: 'Online',
    console: `[Server] [CraftingHosting.free] Automatischer Stopp in 10 Minuten (Fair-Use: max. ${fairUse.maxSessionHours} Stunden am Stück).`,
  },

  start: {
    metaTitle: 'Kostenlosen Minecraft-Server oder Discord-Bot erstellen',
    metaDescription: 'Minecraft-Server oder Discord-Bot wählen, Paket aussuchen, E-Mail bestätigen, im Pterodactyl-Panel loslegen – kostenlos bei CraftingHosting.free.',
    title: 'Server erstellen',
    intro: 'Wähle Paket und Software. Nach der E-Mail-Bestätigung wird dein Server automatisch im Pterodactyl-Panel angelegt.',
    hasServerTitle: 'Du hast bereits einen kostenlosen Server',
    hasServerTitleMany: 'Du hast bereits die maximale Anzahl kostenloser Server',
    hasServerText: (limits: string) => `${limits} Verwalte deine Server im Panel oder sieh dir die Angebote von Crafting Hosting an.`,
    closedTitle: 'Registrierung pausiert',
    closedText: 'Gerade können keine neuen Server angefordert werden. Bestehende Server laufen normal weiter. Schau bald wieder vorbei – Neuigkeiten gibt es im Discord.',
    premiumOffers: 'Premium-Angebote',
    asideTitle: 'Das bekommst du',
    /** `cpus` und `locations` kommen aus dem Admin-Bereich */
    asidePoints: (cpus: string, locations: string, locationCount: number) => [
      'Eigener Minecraft-Server oder Discord-Bot, 0 € im Monat',
      'Pterodactyl-Panel: Konsole, Dateien, Plugins, Backups',
      `${cpus}, NVMe`,
      `${locationCount === 1 ? 'Standort' : 'Standorte'}: ${locations}`,
    ],
    stepProduct: 'Was möchtest du hosten?',
    products: {
      minecraft: { name: 'Minecraft-Server', text: 'Paper, Vanilla, Fabric, Forge …' },
      discord: { name: 'Discord-Bot', text: 'Python oder Node.js' },
    },
    productUnavailable: 'aktuell nicht verfügbar',
    stepRuntime: 'Programmiersprache',
    runtimeGroup: 'Programmiersprache',
    runtimeHint: 'Die genaue Version (z. B. Python 3.12 oder Node.js 22) stellst du später im Panel unter „Startup“ ein.',
    nameHintBot: 'So heißt dein Bot-Server im Panel, z. B. „Mein Musik-Bot“.',
    noPlans: 'Für dieses Angebot gibt es gerade keine Pakete.',
    acceptRulesBot: 'Nutzungsbedingungen für Discord-Bots',
    acceptSummaryBot: (fairUseOn: boolean) =>
      `: ${fairUseOn ? `max. ${fairUse.maxSessionHours} h am Stück, ${fairUse.weeklyOfflineHours} h pro Woche offline, ` : ''}kein ${cycle.days}-Tage-Zyklus und kein Ruhetag, Fair-Use-System für Bots (keine CPU-Dauerlast, aktive Nutzung), keine Selfbots, kein Spam. Hinweise zum `,
    fairTitleBot: 'Laufzeit, kurz erklärt',
    fairTextBot: (fairUseOn: boolean) =>
      `${fairUseOn ? `Max. ${fairUse.maxSessionHours} h am Stück, mind. ${fairUse.weeklyOfflineHours} h pro Woche offline. ` : 'Dein Bot darf durchgehend online sein. Fair bleibt es durch zwei Regeln: keine CPU-Dauerlast und kein tagelanger Leerlauf – Details in den Nutzungsbedingungen für Discord-Bots. '}Es gibt kein Ablaufdatum: Dein Bot muss nicht verlängert werden und hat keinen Ruhetag.`,
    fairTitle: 'Fair-Use, kurz erklärt',
    fairText: `Max. ${fairUse.maxSessionHours} h am Stück, mind. ${fairUse.weeklyOfflineHours} h pro Woche offline, nach ${cycle.days} Tagen ${hasRest ? `und ${rest.replace(/^1 /, 'einem ')} ` : ''}mit einem Klick verlängern. Alles automatisch – mit Hinweis im Chat, bevor etwas passiert.`,

    stepPlan: 'Paket',
    stepSoftware: 'Software',
    stepName: 'Servername',
    stepAccount: 'Konto',
    stepEmail: 'Deine E-Mail-Adresse',
    planSpecs: (ram: string, disk: string, cpu: number) => `${ram} RAM · ${disk} NVMe · bis ${(cpu / 100).toLocaleString('de-DE')} ${cpu === 100 ? 'Thread' : 'Threads'}`,
    soldOut: 'Aktuell ausgebucht',
    planTaken: 'Dieses Paket hast du bereits',
    planLocked: 'Mit deinen freien Slots nicht wählbar',
    bonusSlots: (n: number) => (n === 1 ? 'Du hast 1 zusätzlichen Slot aus Belohnungen.' : `Du hast ${n} zusätzliche Slots aus Belohnungen.`),
    soon: 'bald',
    soonTitle: 'Bald verfügbar',
    typeGroup: 'Servertyp',
    version: 'Version',
    nameLabel: 'Name',
    nameHint: 'So heißt dein Server im Panel, z. B. „Survival mit Freunden“.',
    loggedInAs: 'Angemeldet als',
    loggedInHint: 'Der Server wird deinem Panel-Konto hinzugefügt.',
    emailLabel: 'E-Mail',
    emailHint: 'Hierhin schicken wir den Bestätigungscode. Mit dieser Adresse meldest du dich auch im Panel an.',
    acceptBefore: 'Ich akzeptiere die ',
    acceptTerms: 'AGB',
    acceptAnd: ' und ',
    acceptRules: 'Nutzungsbedingungen',
    acceptSummary: `: max. ${fairUse.maxSessionHours} h am Stück, ${fairUse.weeklyOfflineHours} h pro Woche offline, Verlängerung nach ${cycle.days} Tagen${hasRest ? ` und ${rest}` : ''}. Hinweise zum `,
    acceptPrivacy: 'Datenschutz',
    acceptAfter: '.',
    submitLoggedIn: (plan: string) => `${plan} erstellen`,
    submit: 'Weiter – E-Mail bestätigen',

    sentTitle: 'Prüfe dein Postfach',
    sentBefore: 'Wir haben einen sechsstelligen Code an ',
    sentAfter: (name: string) => ` geschickt. Gib ihn hier ein – danach legst du dein Passwort für das Panel fest und „${name}“ wird automatisch erstellt.`,
    sentValid: 'Der Code ist 30 Minuten gültig.',
    sentSpam: 'Keine E-Mail? Schau im Spam-Ordner nach oder sende sie in einer Minute erneut.',
    resend: 'Erneut senden',
    changeDetails: 'Angaben ändern',
  },

  verify: {
    metaTitle: 'E-Mail bestätigen',
    incomplete: 'Der Link ist unvollständig.',
    failed: 'Die Bestätigung ist fehlgeschlagen.',
    checking: 'Link wird geprüft …',
    invalidTitle: 'Link ungültig',
    requestNew: 'Neu anmelden',
    confirmed: 'E-Mail bestätigt',
    setupTitle: 'Zugang zum Panel festlegen',
    setupText: 'Deinen Server verwaltest du im Pterodactyl-Panel von Crafting Hosting. Lege dafür jetzt Benutzername und Passwort fest.',
    doneTitle: 'Dein Server wird erstellt',
    doneText: 'Alles erledigt – ab jetzt geht es im Panel weiter.',
    doneSteps: (existing: boolean) => ['E-Mail bestätigt', existing ? 'Bestehendes Panel-Konto verknüpft' : 'Panel-Zugang angelegt', 'Server wird installiert (ca. 1–2 Minuten)'],
    loginTitle: 'So meldest du dich im Panel an',
    loginPanel: 'Panel',
    loginEmail: 'E-Mail',
    loginPassword: 'Passwort',
    passwordExisting: 'dein bisheriges Panel-Passwort',
    passwordNew: 'das eben festgelegte',
    doneHint: 'Sobald die Installation fertig ist, bekommst du eine E-Mail. Starten und Verwalten passiert im Panel.',
    problems: 'Probleme?',
    problemsAfter: ' oder Support im Discord.',
  },

  panelSetup: {
    email: 'E-Mail (Login im Panel)',
    username: 'Benutzername im Panel',
    usernameHint: 'Kleinbuchstaben, Zahlen, Punkt, Unterstrich, Bindestrich.',
    password: 'Passwort für das Panel',
    passwordHint: 'Mindestens 10 Zeichen mit Buchstaben und Zahlen.',
    showPassword: 'Passwort anzeigen',
    hidePassword: 'Passwort verbergen',
    confirm: 'Passwort wiederholen',
    mismatch: 'Die Passwörter stimmen nicht überein.',
    note: 'Das Passwort wird direkt an das Pterodactyl-Panel übergeben und von dieser Website nicht gespeichert.',
    submit: 'Zugang anlegen & Server erstellen',
  },

  login: {
    maintenanceNote: 'Gerade laufen Wartungsarbeiten. Anmelden und deine Server ansehen geht trotzdem – neue Server können erst danach wieder angefordert werden.',
    metaTitle: 'Anmelden',
    metaDescription: 'Mit einem Code per E-Mail bei CraftingHosting.free anmelden.',
    title: 'Anmelden',
    intro: 'Wir schicken dir einen sechsstelligen Code per E-Mail. Deinen Server selbst verwaltest du im Pterodactyl-Panel.',
    email: 'E-Mail-Adresse',
    submit: 'Code senden',
    sentTitle: 'Prüfe dein Postfach',
    sentBefore: 'Falls es ein Konto mit ',
    sentAfter: ' gibt, haben wir dir einen sechsstelligen Code geschickt. Er ist 15 Minuten gültig.',
    otherEmail: 'Andere E-Mail-Adresse',
    noServer: 'Noch keinen Server?',
    createFree: 'Kostenlos erstellen',
    manage: 'Zum Spielen und Verwalten:',
    openPanel: 'Pterodactyl-Panel öffnen',
  },

  /** Anmeldung per Code aus der E-Mail und die freiwillige zweite Stufe */
  auth: {
    codeTitle: 'Code eingeben',
    codeTextBefore: 'Wir haben einen sechsstelligen Code an ',
    codeTextAfter: ' geschickt. Gib ihn hier ein.',
    codeTextNoEmail: 'Gib deine E-Mail-Adresse und den sechsstelligen Code aus unserer E-Mail ein.',
    codeLabel: 'Code aus der E-Mail',
    codeHint: 'Sechs Ziffern. Der Code gilt nur kurze Zeit und nur einmal.',
    codeSubmit: 'Bestätigen',
    codeSpam: 'Keine E-Mail? Schau im Spam-Ordner nach.',
    resend: 'Code erneut senden',
    resendIn: (seconds: number) => `Erneut senden in ${seconds} s`,
    resent: 'Wir haben dir einen neuen Code geschickt. Es gilt nur der neueste.',
    otherEmail: 'Andere E-Mail-Adresse',
    twoFactorTitle: 'Zweite Stufe',
    passwordText: 'Für diesen Account ist zusätzlich ein Passwort eingerichtet.',
    passwordLabel: 'Dein Passwort',
    totpText: 'Für diesen Account ist eine Authenticator-App eingerichtet. Gib den aktuellen Code aus der App ein.',
    totpLabel: 'Code aus der App',
    recoveryLabel: 'Wiederherstellungscode',
    useRecovery: 'Wiederherstellungscode verwenden',
    useNormal: 'Zurück zur normalen Eingabe',
    recoveryHint: 'Einer der Codes, die du beim Einschalten bekommen hast. Jeder gilt nur einmal.',
    twoFactorSubmit: 'Anmelden',
    lostAccess: 'Kein Zugriff mehr? Der Support kann die zweite Stufe zurücksetzen.',
  },

  /** „Meine Server“ → Sicherheit */
  security: {
    title: 'Sicherheit',
    off: 'Du meldest dich mit einem Code an, den wir dir per E-Mail schicken. Für mehr Schutz kannst du eine zweite Stufe einschalten – dann reicht der Zugriff auf dein Postfach allein nicht mehr.',
    onPassword: 'Zweite Stufe aktiv: Passwort. Nach dem Code aus der E-Mail fragen wir zusätzlich dein Passwort ab.',
    onTotp: 'Zweite Stufe aktiv: Authenticator-App. Nach dem Code aus der E-Mail fragen wir zusätzlich den Code aus deiner App ab.',
    recoveryLeft: (n: number) => `${n} Wiederherstellungscodes übrig`,
    choosePassword: 'Passwort einrichten',
    chooseTotp: 'Authenticator-App einrichten',
    passwordTitle: 'Eigenes Passwort',
    passwordText: 'Mindestens 10 Zeichen mit Buchstaben und Ziffern. Nimm nicht dein Panel-Passwort.',
    passwordLabel: 'Neues Passwort',
    passwordRepeat: 'Passwort wiederholen',
    passwordMismatch: 'Die beiden Passwörter stimmen nicht überein.',
    totpTitle: 'Authenticator-App',
    totpStep1: 'Scanne den QR-Code mit einer Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, Aegis, 1Password).',
    totpOpenApp: 'Auf diesem Gerät in der App öffnen',
    totpManual: 'Oder gib diesen Schlüssel von Hand ein:',
    totpStep2: 'Gib zur Bestätigung den sechsstelligen Code ein, den die App anzeigt.',
    totpCode: 'Code aus der App',
    enable: 'Einschalten',
    cancel: 'Abbrechen',
    recoveryTitle: 'Deine Wiederherstellungscodes',
    recoveryText: 'Bewahre diese Codes sicher auf – sie werden nur jetzt angezeigt. Mit jedem kommst du einmal in deinen Account, falls du dein Passwort vergisst oder dein Handy verlierst.',
    recoveryDone: 'Ich habe die Codes gespeichert',
    copy: 'Kopieren',
    copied: 'Kopiert',
    disable: 'Zweite Stufe ausschalten',
    disableText: 'Zum Ausschalten bestätige bitte noch einmal mit deinem Passwort bzw. dem Code aus der App (oder einem Wiederherstellungscode).',
    disableConfirm: 'Ausschalten',
    failed: 'Das hat nicht geklappt. Bitte versuche es erneut.',
  },

  my: {
    maintenanceTitle: 'Wartungsarbeiten',
    maintenanceText:
      'Du kannst deine Server hier ansehen und wie gewohnt im Panel verwalten. Erstellen, Reaktivieren und Löschen sind während der Wartung pausiert. Automatische Löschungen finden währenddessen und 24 Stunden danach nicht statt.',
    metaTitle: 'Meine Server',
    title: 'Meine Server',
    panelUser: 'Panel-Benutzer',
    status: {
      waitlist: 'Warteliste',
      pending: 'Wartet auf Panel-Zugang',
      provisioning: 'Wird eingerichtet',
      expiring: 'Wird suspendiert',
      expired: `${cycle.days} Tage abgelaufen`,
      released: 'Platz freigegeben',
      locked: 'Gesperrt',
      installing: 'Installation läuft',
      paused: 'Fair-Use-Pause',
      online: 'Online',
      offline: 'Offline',
    },
    days: (n: number) => `${n} Tage`,
    expiredText: `Die ${cycle.days} Tage sind abgelaufen, der Server ist suspendiert. Deine Welt und Dateien sind gespeichert.`,
    releasedText: 'Der Bot war längere Zeit offline, deshalb wurde sein Platz freigegeben und er ist suspendiert. Deine Dateien sind gespeichert – du kannst ihn sofort reaktivieren.',
    restBefore: `${afterRest.charAt(0).toUpperCase()}${afterRest.slice(1)} kannst du ihn ab `,
    restAfter: ' reaktivieren – wir schicken dir dann eine E-Mail.',
    deleteAt: (dt: string) => `Ohne Reaktivierung wird der Server am ${dt} automatisch gelöscht.`,
    lockedText: 'Dieser Server wurde vom Team gesperrt. Bitte wende dich an den Support.',
    abuseBadge: 'Abuse',
    abuseText: (date: string) => `Auf diesem Server haben wir am ${date} einen Verstoß gegen unsere Regeln festgestellt. Bitte öffne ein Ticket auf unserem Discord-Server, damit wir das gemeinsam klären können. Bis dahin bleibt der Server markiert.`,
    abuseTicket: 'Ticket auf Discord öffnen',
    pendingText: 'Sobald dein Panel-Zugang eingerichtet ist, wird dieser Server automatisch erstellt.',
    expiringText: 'Der Server wird gerade gestoppt und suspendiert – danach kannst du ihn hier reaktivieren.',
    noEnd: 'Läuft ohne Ablaufdatum',
    noEndHint: `Kein ${cycle.days}-Tage-Zyklus, kein Ruhetag – dein Bot muss nicht verlängert werden.`,
    provisioningText: 'Der Server wird im Panel angelegt. Das dauert meist nur wenige Sekunden.',
    runtime: 'Laufzeit',
    activeUntil: (date: string, left: string) => `Aktiv bis ${date} · noch ${left}`,
    fairUse: 'Fair-Use',
    alwaysOn: 'Durchgehend online – kein Laufzeitlimit',
    alwaysOnHint: 'Fair-Use für Bots: keine CPU-Dauerlast, nicht tagelang offline.',
    cpuPause: (dt: string) => `Pause bis ${dt} (CPU-Dauerlast)`,
    pausedUntil: (dt: string) => `Pause bis ${dt}`,
    autoStop: (dt: string) => `Automatischer Stopp ${dt}`,
    weeklyDone: 'Offline-Zeit diese Woche erfüllt',
    weeklyLeft: (d: string) => `Noch ${d} offline nötig diese Woche`,
    rulesShort: `Max. ${fairUse.maxSessionHours} h am Stück · ${fairUse.weeklyOfflineHours} h/Woche offline`,
    createdTitle: 'Server wird erstellt',
    createdText: 'In wenigen Minuten ist er im Panel startbereit – wir schicken dir eine E-Mail.',
    loadError: 'Deine Server konnten gerade nicht geladen werden. Bitte versuche es gleich erneut.',
    emptyTitle: 'Noch kein Server',
    emptyText: 'Erstelle deinen kostenlosen Minecraft-Server – in wenigen Minuten bereit.',
    helpTitle: 'Starten, stoppen, Konsole, Dateien, Backups?',
    helpText: `Das alles machst du im Pterodactyl-Panel. Pausen und die ${cycle.days}-Tage-Laufzeit regelt unser System automatisch – Hinweise erscheinen vorher im Minecraft-Chat und in der Serverbeschreibung.`,
    copyAddress: 'Adresse kopieren',
    reactivate: `Reaktivieren – weitere ${cycle.days} Tage`,
    reactivateBot: 'Bot reaktivieren',
    reactivateFailed: 'Reaktivierung fehlgeschlagen.',
    discardRequest: 'Anfrage verwerfen',
    deleteServer: 'Server löschen',
    deleteText: 'Löscht den Server inklusive Welt, Dateien und Backups endgültig. Zur Bestätigung ',
    deleteTextAfter: ' eingeben:',
    confirmName: 'Servername bestätigen',
    deleteFinal: 'Endgültig löschen',
    cancel: 'Abbrechen',
    deleteFailed: 'Löschen fehlgeschlagen.',
    setupTitle: 'Noch ein Schritt: Zugang zum Panel',
    setupText: 'Lege Benutzername und Passwort für das Pterodactyl-Panel fest. Danach wird dein angefragter Server sofort erstellt.',
    accountTitle: 'Konto',
    signedInAs: 'Angemeldet als',
    deleteAccountHint: 'Löscht dein Konto und alle Free-Server endgültig. Das lässt sich nicht rückgängig machen.',
    deleteAccountConfirm: 'Endgültig löschen',
    deleteAccountCancel: 'Abbrechen',
    logout: 'Abmelden',
    deleteAccount: 'Konto löschen',
    deleteAccountText: 'Gib zur Bestätigung deine E-Mail-Adresse ein:',
    confirmEmail: 'E-Mail bestätigen',
  },

  faq: {
    metaTitle: 'FAQ – Häufige Fragen',
    metaDescription: 'Antworten zu CraftingHosting.free: Kosten, Panel-Zugang, Minecraft-Versionen, Discord-Bots, RAM, Fair-Use-System, Laufzeit und Reaktivierung.',
    title: 'Häufige Fragen',
    intro: 'Alles Wichtige zum kostenlosen Minecraft- und Discord-Bot-Hosting von Crafting Hosting.',
    moreTitle: 'Deine Frage ist nicht dabei?',
    moreText: 'Community und Team helfen dir im Discord weiter.',
    openDiscord: 'Discord öffnen',
    items: (limits: string, ctx: FaqContext) => [
      {
        q: 'Ist CraftingHosting.free wirklich kostenlos?',
        a: `Ja. Kein monatlicher Preis, keine Testphase, keine Zahlungsdaten. Damit das dauerhaft funktioniert, gelten ein Fair-Use-System und eine Laufzeit von ${cycle.days} Tagen, die du kostenlos verlängern kannst.`,
      },
      {
        q: 'Wie verwalte ich meinen Server?',
        a: `Komplett im Pterodactyl-Panel von Crafting Hosting: starten und stoppen, Konsole, Dateimanager, Plugins, Backups, Zeitpläne und Startparameter. Die Website brauchst du nur zum Erstellen und zum Verlängern nach ${cycle.days} Tagen.`,
      },
      {
        q: 'Wie melde ich mich im Panel an?',
        a: 'Mit deiner E-Mail-Adresse und dem Passwort, das du nach der E-Mail-Bestätigung festlegst. Hast du bereits ein Konto bei Crafting Hosting, wird der Server einfach deinem bestehenden Konto hinzugefügt.',
      },
      {
        q: 'Welche Minecraft-Versionen werden unterstützt?',
        a: `Du wählst zwischen ${minecraftTypes.map((t) => t.name).join(', ')} – von aktuellen Versionen bis zu Klassikern wie 1.8.8, 1.12.2 und 1.16.5. Version und Servertyp kannst du später im Panel über die Startparameter anpassen.`,
      },
      {
        q: 'Wie viel RAM bekomme ich?',
        a: `Je nach Paket ${ctx.minecraftRam} RAM${ctx.discordRam ? ` für Minecraft-Server und ${ctx.discordRam} für Discord-Bots` : ''}. Alle kostenlosen Server teilen sich die Hardware eines Nodes fair – die Werte sind Obergrenzen, keine dauerhaft garantierte Leistung.`,
      },
      {
        q: 'Wie funktioniert das Fair-Use-System?',
        a: `Ein Server darf bis zu ${fairUse.maxSessionHours} Stunden am Stück laufen, danach stoppt er automatisch und pausiert ${fairUse.cooldownMinutes} Minuten. Pro Woche muss er außerdem mindestens ${fairUse.weeklyOfflineHours} Stunden offline sein. Vor jedem automatischen Stopp erscheint 30, 10 und 1 Minute vorher ein Hinweis im Minecraft-Chat; den aktuellen Status siehst du in der Serverbeschreibung im Panel.`,
      },
      {
        q: 'Warum muss mein Server regelmäßig offline sein?',
        a: 'Kostenlose Server teilen sich Hardware. Wenn Server nicht dauerhaft laufen, bleiben CPU und Arbeitsspeicher für alle aktiven Spieler schnell – und wir können viele kostenlose Server anbieten, statt Plätze künstlich zu begrenzen.',
      },
      {
        q: `Was passiert nach ${cycle.days} Tagen?`,
        a: `Wir erinnern dich ${reminders} vorher per E-Mail. Nach Ablauf wird der Server gestoppt und im Panel suspendiert. Deine Welt und Dateien bleiben vorerst erhalten.${hasRest ? ` Danach gilt ${rest} – sobald er vorbei ist, bekommst du eine E-Mail.` : ''}${delH > 0 ? ` Reaktivierst du den Server nicht innerhalb von ${delH} Stunden${hasRest ? ' nach dem Ende der Ruhezeit' : ''}, wird er samt Welt und Backups automatisch gelöscht – ${cycle.deleteReminderHours} Stunden vorher bekommst du eine Erinnerung.` : ''}`,
      },
      {
        q: 'Kann ich meinen Server reaktivieren?',
        a: `Ja. ${hasRest ? `${afterRest.charAt(0).toUpperCase()}${afterRest.slice(1)} ` : ''}unter „Meine Server“ auf dieser Website mit einem Klick auf „Reaktivieren“ – danach läuft er wieder ${cycle.days} Tage.${delH > 0 ? ` Dafür hast du ${delH} Stunden Zeit, danach wird der Server gelöscht.` : ''} Anmelden kannst du dich dort per E-Mail-Link, ganz ohne Passwort.`,
      },
      {
        q: 'Kann ich später auf ein kostenpflichtiges CraftingHosting-Angebot wechseln?',
        a: 'Ja. CraftingHosting.free gehört zu Crafting Hosting. Wenn du mehr Ressourcen und weniger Einschränkungen brauchst, kannst du jederzeit auf ein kostenpflichtiges Paket umsteigen – sprich uns einfach im Discord oder beim Support an.',
      },
      {
        q: 'Wo stehen die Server und auf welcher Hardware laufen sie?',
        a: `Die Nodes stehen in ${ctx.locations} und laufen auf ${ctx.cpus} mit ${hardware.storage} und ${hardware.network}.`,
      },
      ...(ctx.discordRequired
        ? [
            {
              q: 'Warum muss ich auf eurem Discord-Server sein?',
              a: 'Unsere kostenlosen Server gibt es nur für Mitglieder unseres Discord-Servers. Du verbindest dafür unter „Meine Server“ dein Discord-Konto und trittst dabei automatisch bei. Das schützt das Angebot vor Mehrfach-Anmeldungen und automatisierten Registrierungen – jedes Discord-Konto lässt sich nur mit einem Account verknüpfen. Außerdem bekommst du dort die Customer-Rolle, Ankündigungen und Support per Ticket.',
            },
          ]
        : []),
      ...(ctx.discordRam
        ? [
            {
              q: 'Kann ich auch einen Discord-Bot hosten?',
              a: `Ja. Neben Minecraft-Servern hosten wir kostenlos Discord-Bots in ${botTypes.map((t) => t.name).join(' oder ')} – je nach Paket mit ${ctx.discordRam} RAM. Du lädst deinen Code im Pterodactyl-Panel hoch (Dateimanager oder SFTP), trägst die Startdatei ein und startest den Bot. Die Bots laufen auf einer eigenen Node, getrennt von den Minecraft-Servern.`,
            },
            {
              q: 'Läuft mein Discord-Bot rund um die Uhr?',
              a: ctx.discordFairUse
                ? `Für Discord-Bots gilt dasselbe Fair-Use-System wie für Minecraft-Server: höchstens ${fairUse.maxSessionHours} Stunden am Stück und ${fairUse.weeklyOfflineHours} Stunden Offline-Zeit pro Woche. Einen ${cycle.days}-Tage-Zyklus mit Ruhetag gibt es für Bots nicht.`
                : `Ja – Discord-Bots dürfen durchgehend online sein, es gibt kein Laufzeitlimit und keine Pflicht-Pausen. Stattdessen gilt ein eigenes Fair-Use-System für Bots: keine CPU-Dauerlast (bei anhaltender Volllast wird der Bot nach einer Vorwarnung kurz pausiert) und aktive Nutzung (ein Bot, der tagelang offline ist, gibt seinen Platz frei). Den ${cycle.days}-Tage-Zyklus mit Ruhetag gibt es für Bots nicht – sie laufen ohne Ablaufdatum. Die genauen Werte stehen in den Nutzungsbedingungen für Discord-Bots.`,
            },
            {
              q: 'Was ist bei Discord-Bots nicht erlaubt?',
              a: 'Selfbots, Spam-, Raid- und Nuke-Bots, Token-Logger, Massen-DMs sowie alles, was gegen die Nutzungsbedingungen und die Developer Policy von Discord verstößt. Ebenso tabu: Mining, Proxys und andere Software als dein Bot. Die Details stehen in den Nutzungsbedingungen für Discord-Bots.',
            },
          ]
        : []),
      {
        q: 'Wie viele kostenlose Server kann ich haben?',
        a: `${limits} So bleibt genug Platz für alle.`,
      },
    ],
    /** `twoTiers` = es gibt EPYC-Plätze (Admin-Einstellung) – sonst läuft alles auf einer Hardware-Stufe */
    earlyItem: (twoTiers: boolean) => ({
      q: 'Was ist die erste Startphase (Early Access)?',
      a: `Zum Start haben wir nur begrenzt Platz. Deshalb sicherst du dir zuerst einen Platz auf der Warteliste, und wir schalten die Server der Reihe nach frei.${twoTiers ? ` Die ersten Plätze bekommen einen Server auf ${epyc}, danach geht es auf ${xeon} weiter.` : ''} Sobald dein Platz freigeschaltet ist, bekommst du eine E-Mail. Läuft alles stabil, sind nach dieser Phase auch mehrere kostenlose Server pro Person möglich.`,
    }),
  },

  status: {
    metaTitle: 'Status',
    metaDescription: 'CraftingHosting Network Status: aktueller Zustand, Verlauf der letzten Wochen und geplante Wartungen aller Dienste.',
    title: 'CraftingHosting Network Status',
    intro: 'Aktueller Zustand aller Systeme hinter CraftingHosting.free.',
    allServices: 'Status aller CraftingHosting-Dienste:',
    refresh: 'Aktualisieren',
    updatedAt: (time: string) => `Stand: ${time} Uhr`,
    loadError: 'Der Status konnte gerade nicht geladen werden. Bitte versuche es gleich erneut.',
    days: (n: number) => `${n} Tage`,
    daysAgo: (n: number) => `vor ${n} Tagen`,
    today: 'heute',
    uptimeHint: (n: number) => `Verfügbarkeit der letzten ${n} Tage`,
    hours: (n: number) => `${n} Stunden`,
    hoursAgo: (n: number) => `vor ${n} Stunden`,
    now: 'jetzt',
    uptimeHintHours: (n: number) => `Verfügbarkeit der letzten ${n} Stunden`,
    historyLabelHours: (n: number) => `Verlauf der letzten ${n} Stunden`,
    uptimeNone: 'Uptime wird erfasst',
    noData: 'Keine Messdaten',
    dayUptime: (p: string) => `${p} % verfügbar`,
    historyLabel: (n: number) => `Verlauf der letzten ${n} Tage`,
    empty: 'Aktuell sind keine Dienste eingetragen.',
    activeTitle: 'Aktuelle Meldungen',
    scheduledTitle: 'Geplante Wartungen',
    pastTitle: 'Vergangene Meldungen',
    pastHint: 'Letzte 14 Tage',
    noPast: 'Keine Meldungen in den letzten 14 Tagen.',
    kinds: { incident: 'Störung', maintenance: 'Wartung', notice: 'Hinweis' },
    since: (dt: string) => `Seit ${dt}`,
    from: (dt: string) => `Ab ${dt}`,
    until: (dt: string) => `bis ${dt}`,
    resolved: (dt: string) => `Beendet ${dt}`,
    affects: 'Betrifft',
    states: {
      operational: { label: 'Operational', banner: 'Alle Systeme laufen normal' },
      degraded: { label: 'Eingeschränkt', banner: 'Einige Systeme sind eingeschränkt' },
      partial_outage: { label: 'Teilausfall', banner: 'Teilweiser Ausfall' },
      major_outage: { label: 'Störung', banner: 'Es liegt eine Störung vor' },
      maintenance: { label: 'Wartung', banner: 'Geplante Wartungsarbeiten' },
      unknown: { label: 'Unbekannt', banner: 'Status wird ermittelt' },
    },
  },

  legal: {
    updated: 'Stand',
    translationNote: '',
    imprint: { title: 'Impressum', description: 'Impressum von CraftingHosting.free – ein Service von Crafting Hosting.' },
    privacy: { title: 'Datenschutzerklärung', description: 'Datenschutzerklärung von CraftingHosting.free.' },
    terms: { title: 'Allgemeine Geschäftsbedingungen', short: 'AGB', description: 'Allgemeine Geschäftsbedingungen von CraftingHosting.free.' },
    rules: {
      title: 'Nutzungsbedingungen & Fair-Use',
      short: 'Nutzungsbedingungen',
      description: `Nutzungsbedingungen, Fair-Use-System und ${cycle.days}-Tage-Zyklus von CraftingHosting.free.`,
    },
    cookies: { title: 'Cookie- & Privacy-Hinweise', short: 'Cookie-Hinweise', description: 'Welche Cookies CraftingHosting.free verwendet.' },
    discordTerms: {
      title: 'Nutzungsbedingungen für Discord-Bot-Hosting',
      short: 'Nutzungsbedingungen Discord-Bots',
      description: `Nutzungsbedingungen für das kostenlose Discord-Bot-Hosting von CraftingHosting.free: Pakete, Dauerbetrieb ohne Ablaufdatum, Fair-Use-System, erlaubte und unzulässige Nutzung.`,
    },
  },

  /** Spenden-Seite (Zahlungslink von SumUp) */
  donate: {
    metaTitle: 'Spenden',
    metaDescription: 'Unterstütze CraftingHosting.free mit einer freiwilligen Spende – für Server-Hardware, Strom und mehr kostenlose Plätze.',
    label: 'Spenden',
    title: 'Damit kostenloses Hosting kostenlos bleibt.',
    intro:
      'CraftingHosting.free kostet dich nichts – uns schon: Hardware, Strom und Anbindung laufen rund um die Uhr. Wenn dir das Angebot gefällt, kannst du es mit einer freiwilligen Spende unterstützen. Jeder Betrag hilft.',
    button: 'Über SumUp spenden',
    redirectNote: 'Du wirst zu SumUp weitergeleitet, unserem Zahlungsdienstleister. Deine Kartendaten sehen wir nie.',
    closedTitle: 'Spenden sind noch nicht möglich',
    closedText: 'Wir richten die Spendenmöglichkeit gerade ein. Folge uns auf Discord – dort sagen wir Bescheid, sobald es losgeht.',
    whyLabel: 'Wofür',
    whyTitle: 'Warum spenden?',
    whyIntro: 'Spenden fließen in den Betrieb und den Ausbau des kostenlosen Angebots.',
    reasons: [
      { title: 'Server-Hardware & Strom', text: 'Die Server laufen rund um die Uhr im Rechenzentrum. Spenden helfen, Hardware, Strom und Netzwerk zu bezahlen.' },
      { title: 'Mehr Plätze', text: 'Mehr Kapazität bedeutet mehr kostenlose Plätze für Minecraft-Server und Discord-Bots – und kürzere Wartezeiten.' },
      { title: 'Bessere Hardware', text: 'Mit mehr Budget können wir künftig aufrüsten: zum Beispiel mehr RAM, schnellere CPUs oder weitere Standorte.' },
      { title: 'Werbefrei & ohne Datenverkauf', text: 'Wir zeigen keine Werbung und verkaufen keine Daten. Spenden helfen, dass das so bleibt.' },
    ],
    knowTitle: 'Was du wissen solltest',
    know: [
      'Spenden sind freiwillig. Das kostenlose Angebot kannst du genauso nutzen, wenn du nichts spendest.',
      'Eine Spende ist kein Kauf: Du erhältst dafür keine Leistung, kein Upgrade, keinen Vorrang auf der Warteliste und keinen Anspruch auf einen Server.',
      'Wir können keine Spendenquittung für die Steuer ausstellen – Crafting Hosting ist ein Unternehmen und keine gemeinnützige Organisation.',
    ],
    refundBefore: 'Versehentlich oder zu viel gespendet? Schreib uns an ',
    refundAfter: ' – wir erstatten die Spende auf Anfrage.',
    closing: 'Danke, dass du das kostenlose Hosting möglich machst. Fragen oder Ideen? Schreib uns auf Discord.',
    discord: 'Zum Discord',
  },

  /** Cookie-Hinweis (nur technisch notwendige Cookies – eine Bestätigung, keine Auswahl) */
  cookieBanner: {
    label: 'Cookie-Hinweis',
    text: 'Wir verwenden nur technisch notwendige Cookies (Anmeldung, Sprache, diese Auswahl). Zum Schutz des Dienstes speichern wir deine IP-Adresse verschlüsselt.',
    more: 'Cookie-Hinweise',
    ok: 'Verstanden',
  },

  /** Vorregistrierung / Early Access (erste Startphase) */
  newsletter: {
    metaTitle: 'Newsletter',
    metaDescription: 'Neuigkeiten, neue Pakete und Angebote von CraftingHosting.free per E-Mail – wenige Male im Jahr, jederzeit abbestellbar.',
    label: 'Newsletter',
    title: 'Neuigkeiten direkt ins Postfach.',
    intro: 'Neue Pakete, freie Plätze, Wartungen und Angebote von Crafting Hosting – wenige Male im Jahr, kein Spam.',
    points: ['Neue Pakete und freie Plätze zuerst erfahren', 'Angebote von Crafting Hosting', 'Mit einem Klick wieder abmelden'],
    emailLabel: 'E-Mail-Adresse',
    placeholder: 'du@example.com',
    submit: 'Abonnieren',
    privacyBefore: 'Wir schicken dir zuerst einen Bestätigungslink. Abmelden geht jederzeit über den Link in jeder E-Mail. Mehr im ',
    privacyLink: 'Datenschutz',
    privacyAfter: '.',
    sentTitle: 'Fast geschafft – prüfe dein Postfach',
    sentText: (email: string) => `Wir haben einen Bestätigungslink an ${email} geschickt. Erst mit dem Klick ist die Anmeldung aktiv.`,
    working: 'Einen Moment …',
    confirmedTitle: 'Anmeldung bestätigt',
    confirmedText: (email: string) => `${email} bekommt ab jetzt unseren Newsletter. Danke!`,
    unsubscribedTitle: 'Du bist abgemeldet',
    unsubscribedText: (email: string) => `${email} bekommt keinen Newsletter mehr. Du kannst dich jederzeit wieder anmelden.`,
    invalidTitle: 'Link ungültig',
    invalidText: 'Dieser Link ist ungültig oder abgelaufen. Melde dich einfach erneut an.',
    disabled: 'Der Newsletter ist derzeit nicht verfügbar.',
    footerTitle: 'Newsletter',
    footerText: 'Neuigkeiten und Angebote – wenige Male im Jahr.',
    checkbox: 'Newsletter abonnieren: Neuigkeiten und Angebote von CraftingHosting.free per E-Mail (freiwillig, jederzeit abbestellbar).',
    backHome: 'Zur Startseite',
  },

  /** Support-Chat „Crafting AI“ */
  chat: {
    open: '{name} – Support-Chat öffnen',
    close: 'Chat schließen',
    dismiss: 'Hinweis ausblenden',
    badgeAi: 'KI-Assistent',
    badgeAuto: 'Assistent',
    subtitle: 'Hilfe zu Servern, Bots und Konto',
    noticeAi: 'Du schreibst mit einer KI, nicht mit einem Menschen – sie kann sich irren. Bitte gib keine Passwörter, Codes oder Tokens ein. Nachrichten werden gespeichert und zur Beantwortung an den KI-Dienst Claude (Anthropic) übermittelt.',
    noticeAuto: 'Du schreibst mit einem automatischen Assistenten, nicht mit einem Menschen. Bitte gib keine Passwörter, Codes oder Tokens ein. Nachrichten werden gespeichert.',
    privacy: 'Datenschutz',
    placeholder: 'Deine Frage …',
    send: 'Senden',
    typing: '{name} schreibt …',
    human: 'Mit einem Mitarbeiter sprechen',
    connectDiscord: 'Mit Discord verbinden',
    openTicket: 'Ticket auf Discord öffnen',
    sourceAi: 'KI-Antwort',
    sourceCanned: 'Automatische Antwort',
    reset: 'Neue Unterhaltung',
    limit: 'Diese Unterhaltung hat die maximale Länge erreicht. Starte eine neue oder sprich mit einem Mitarbeiter.',
    handedOff: 'Dein Anliegen liegt beim Team – bitte schreib im Ticket auf Discord weiter.',
    waitingDiscord: 'Verbinde dein Discord-Konto über den Button oben, damit wir dich an einen Mitarbeiter weitergeben können.',
    error: 'Die Nachricht konnte nicht gesendet werden. Bitte versuche es erneut.',
  },

  discord: {
    cardTitle: 'Discord',
    requiredTitle: 'Discord-Mitgliedschaft erforderlich',
    requiredText:
      'Unsere kostenlosen Server gibt es nur für Mitglieder unseres Discord-Servers. Verbinde dein Discord-Konto – dabei trittst du dem Server automatisch bei. So schützen wir das Angebot vor Mehrfach-Anmeldungen und automatisierten Registrierungen.',
    optionalText: 'Verbinde dein Discord-Konto: Auf unserem Discord-Server bekommst du automatisch die Customer-Rolle, und der Support erkennt deine Server im Ticket sofort.',
    connect: 'Mit Discord verbinden',
    connectedAs: (name: string) => `Verbunden als ${name}`,
    connectedText: 'Du bist Mitglied auf unserem Discord-Server.',
    notMemberTitle: 'Du bist nicht auf unserem Discord-Server',
    notMemberText: 'Dein Discord-Konto ist verknüpft, aber kein Mitglied unseres Servers. Tritt bei und klicke danach auf „Erneut prüfen“.',
    unavailableText: 'Die Mitgliedschaft lässt sich gerade nicht prüfen. Bitte versuche es gleich noch einmal.',
    join: 'Discord-Server beitreten',
    recheck: 'Erneut prüfen',
    recheckOk: 'Alles in Ordnung – du bist Mitglied.',
    recheckFail: 'Wir finden dich noch nicht auf dem Discord-Server.',
    unlink: 'Verknüpfung lösen',
    failed: 'Das hat nicht geklappt. Bitte versuche es erneut.',
    pendingStatus: 'Wartet auf Discord',
    pendingBlocked: 'Dein Server wird eingerichtet, sobald dein Discord-Konto verbunden und du Mitglied auf unserem Discord-Server bist.',
    pendingDeadline: (date: string) => `Verbinde dein Discord-Konto bis zum ${date} – sonst wird diese Anfrage automatisch gelöscht.`,
    /** Kurzer Hinweis auf Startseite und beim Erstellen */
    noteTitle: 'Voraussetzung: Mitglied auf unserem Discord-Server',
    noteText:
      'Um unsere kostenlosen Dienste zu nutzen, musst du auf unserem Discord-Server sein. Nach der Anmeldung verbindest du dein Discord-Konto und trittst dabei automatisch bei – erst dann wird dein Server eingerichtet.',
    noteButton: 'Zum Discord-Server',
    /** So läuft die Prüfung ab – der Einladungslink allein genügt nicht */
    noteSteps: [
      'Server anfordern und E-Mail-Adresse bestätigen.',
      'Unter „Meine Server“ auf „Mit Discord verbinden“ klicken. Discord fragt nach deiner Zustimmung – dabei trittst du unserem Server automatisch bei.',
      'Wir prüfen deine Mitgliedschaft automatisch und richten deinen Server ein.',
    ],
    noteInviteOnly: 'Wichtig: Nur über den Einladungslink beizutreten genügt nicht. Erst die Verknüpfung zeigt uns, welches Discord-Konto zu deinem Account gehört.',
    noteLinked: (name: string) => `Dein Discord-Konto ist verbunden (${name}).`,
    results: {
      linked: { ok: true, title: 'Discord verbunden', text: 'Dein Discord-Konto ist verknüpft und du bist Mitglied auf unserem Server.' },
      linked_not_member: { ok: false, title: 'Verknüpft – aber noch kein Mitglied', text: 'Dein Discord-Konto ist verknüpft. Tritt jetzt unserem Discord-Server bei und klicke auf „Erneut prüfen“.' },
      taken: { ok: false, title: 'Dieses Discord-Konto ist schon vergeben', text: 'Das Discord-Konto ist bereits mit einem anderen Account verknüpft. Jedes Discord-Konto kann nur einmal verwendet werden.' },
      too_new: { ok: false, title: 'Discord-Konto ist zu neu', text: 'Zum Schutz vor Missbrauch muss dein Discord-Konto schon etwas länger bestehen. Bitte versuche es später erneut oder wende dich an den Support.' },
      bot_account: { ok: false, title: 'Bot-Konten können nicht verknüpft werden', text: 'Bitte verbinde dein persönliches Discord-Konto.' },
      denied: { ok: false, title: 'Verknüpfung abgebrochen', text: 'Du hast die Anfrage bei Discord abgelehnt. Ohne Verknüpfung können wir deine Mitgliedschaft nicht prüfen.' },
      state: { ok: false, title: 'Verknüpfung abgelaufen', text: 'Bitte starte die Verknüpfung noch einmal.' },
      unavailable: { ok: false, title: 'Discord ist gerade nicht verfügbar', text: 'Die Discord-Verknüpfung ist im Moment nicht eingerichtet. Bitte versuche es später erneut.' },
      failed: { ok: false, title: 'Verknüpfung fehlgeschlagen', text: 'Discord hat die Anfrage nicht bestätigt. Bitte versuche es erneut.' },
    } as Record<string, { ok: boolean; title: string; text: string }>,
  },
  beta: {
    badge: 'Beta',
    /** Hinweis für alle ohne Beta-Zugang (auf der Beta-Instanz, bei jeder Adresse) */
    gateMetaTitle: 'Beta-Programm',
    gateTitle: 'Du bist nicht im Beta-Programm.',
    gateText: 'Das hier ist die Beta-Version von CraftingHosting.free – sie ist nur für freigeschaltete Tester gedacht. Anmelden oder registrieren kannst du dich hier nicht.',
    gateHow: 'Du hast Beta-Zugang bekommen? Dann melde dich auf der Hauptseite an und öffne die Beta unter „Meine Server“.',
    toMain: 'Zur Hauptseite',
    /** Ticket einlösen (auf der Beta-Instanz) */
    checking: 'Dein Beta-Zugang wird geprüft …',
    expiredTitle: 'Der Link ist abgelaufen',
    expiredText: 'Bitte öffne die Beta noch einmal über „Meine Server“ auf der Hauptseite.',
    /** Bestätigungsseite auf der Hauptseite */
    confirmMetaTitle: 'Beta öffnen',
    confirmTitle: 'Beta-Seite öffnen?',
    confirmText: 'Du wechselst auf die Beta-Version von CraftingHosting.free. Dort testest du neue Funktionen, bevor sie für alle erscheinen.',
    confirmPoints: [
      'Die Beta arbeitet mit deinen echten Daten – Änderungen an deinen Servern gelten wirklich.',
      'Es kann Fehler geben. Melde sie uns bitte im Discord.',
      'Dein Zugang wird beim Wechsel noch einmal geprüft.',
    ],
    confirmButton: 'Ja, Beta-Seite öffnen',
    back: 'Zurück zu „Meine Server“',
    /** Karte unter „Meine Server“ */
    cardTitle: 'Beta-Programm',
    cardText: 'Du hast Beta-Zugang: Teste neue Funktionen vor allen anderen.',
    cardButton: 'Beta öffnen',
    /** Leiste auf der Beta-Instanz */
    bar: 'Beta-Version – du arbeitest mit echten Daten.',
    barLink: 'Zur Hauptseite',
  },

  early: {
    onePerPerson: 'In der Early-Access-Phase ist ein Platz pro Person möglich.',
    badge: 'Early Access',
    kicker: 'Early Access · Erste Startphase',
    heroText: (twoTiers: boolean) =>
      `Wir starten mit einer ersten Phase und begrenzten Plätzen. Sichere dir jetzt deinen Platz${twoTiers ? `: Die ersten Plätze bekommen einen Server auf ${epyc}, danach geht es auf ${xeon} weiter` : ' – wir schalten die Server der Reihe nach frei'}. Kostenlos und ohne Zahlungsdaten.`,
    cta: 'Platz sichern',
    securePlan: (name: string) => `${name} – Platz sichern`,
    waitlistCount: (n: string) => `${n} auf der Warteliste`,
    epycLeft: (left: string, total: string) => `Noch ${left} von ${total} Plätzen auf ${epyc}`,
    epycFull: `${epyc}-Plätze vergeben – neue Plätze auf ${xeon}`,
    steps: (panelHost: string, twoTiers: boolean): [string, string][] => [
      ['Platz sichern', 'Paket, Servertyp und Namen wählen, E-Mail bestätigen. Damit steht dein Platz auf der Warteliste fest.'],
      ['Freischaltung', `Wir schalten die Plätze der Reihe nach frei${twoTiers ? ` – zuerst auf ${epyc}, danach auf ${xeon}` : ''}. Du bekommst eine E-Mail.`],
      ['Im Panel loslegen', `Panel-Zugang festlegen, unter ${panelHost} anmelden und spielen. Alles Weitere läuft automatisch.`],
    ],
    ctaText: 'Die erste Startphase hat begrenzte Plätze. Sichere dir jetzt deinen – kostenlos.',
    tiers: { epyc, xeon },
    tierNote: {
      epyc: `Du gehörst zu den ersten Plätzen – dein Server läuft auf ${epyc}.`,
      xeon: `Dein Server läuft auf ${xeon}. Verlässt jemand vor dir die Warteliste, rückst du nach.`,
    },

    startTitle: 'Platz sichern',
    startIntro: 'Early Access: In der ersten Startphase schalten wir die kostenlosen Server der Reihe nach frei. Wähle Paket und Software und bestätige deine E-Mail – damit ist dein Platz gesichert.',
    submit: 'Weiter – Platz per E-Mail bestätigen',
    submitLoggedIn: 'Platz sichern',
    loggedInHint: 'Dein Platz wird sofort vergeben. Sobald er freigeschaltet ist, wird der Server deinem Panel-Konto hinzugefügt.',
    sentAfter: (name: string) => ` geschickt. Gib ihn hier ein – damit ist dein Platz für „${name}“ gesichert. Wir schreiben dir, sobald er freigeschaltet ist.`,
    onListTitle: 'Du stehst auf der Warteliste',
    onListText: 'Pro Person ist in der ersten Startphase ein Platz möglich. Wir schreiben dir, sobald dein Server freigeschaltet ist.',

    verifyTitle: 'Dein Platz ist gesichert',
    verifyText: 'Wir schalten die Plätze der ersten Startphase der Reihe nach frei. Sobald deiner dran ist, bekommst du eine E-Mail – dann legst du deinen Panel-Zugang fest und dein Server wird sofort erstellt.',
    positionLabel: 'Dein Platz',
    hardwareLabel: 'Hardware',

    myText: 'Du stehst auf der Warteliste der ersten Startphase. Sobald dein Platz freigeschaltet ist, bekommst du eine E-Mail und dein Server wird erstellt.',
    leave: 'Warteliste verlassen',
    leaveText: 'Gibt deinen Platz auf der Warteliste frei. Zur Bestätigung ',
    createdTitle: 'Platz gesichert',
    createdText: 'Du stehst auf der Warteliste. Wir schreiben dir, sobald dein Server freigeschaltet ist.',
  },

  /** Registrierung geschlossen */
  closed: {
    kicker: 'Registrierung pausiert',
    text: 'Gerade können keine neuen Server angefordert werden. Bestehende Server laufen normal weiter – schau bald wieder vorbei.',
  },

  maintenance: {
    metaTitle: 'Wartungsarbeiten',
    label: 'Wartung',
    title: 'Wir sind gleich zurück.',
    text: 'CraftingHosting.free wird gerade gewartet. Deine Server, Welten und Daten sind sicher – bestehende Server laufen in der Regel normal weiter.',
    until: (dt: string) => `Voraussichtlich bis ${dt}`,
    status: 'Statusseite',
    discord: 'Neuigkeiten im Discord',
    autoRefresh: 'Diese Seite lädt automatisch neu, sobald wir wieder da sind.',
    noDeletion: 'Während der Wartung und 24 Stunden danach werden keine Server automatisch gelöscht.',
  },

  notFound: {
    title: 'Diese Seite gibt es nicht.',
    text: 'Vielleicht wurde sie verschoben – oder der Block wurde abgebaut.',
    home: 'Zur Startseite',
  },

  error: {
    title: 'Da ist etwas schiefgelaufen.',
    text: 'Bitte versuche es in einem Moment erneut.',
    retry: 'Erneut versuchen',
  },
};
}

export type Dictionary = ReturnType<typeof buildDe>;
