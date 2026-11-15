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
const perPerson = (max: number) => (max === 1 ? 'ist ein kostenloser Server' : `sind ${max} kostenlose Server`);

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
      ['E-Mail bestätigen', 'Link anklicken und dein Passwort für das Panel festlegen. Der Server wird automatisch angelegt.'],
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
        `${cycle.days} Tage Laufzeit, kostenlos verlängerbar`,
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
        [`${cycle.days} Tage`, 'Laufzeit', `Wie bei Minecraft: danach kostenlos verlängern${hasRest ? ` (${afterRest})` : ''}.`],
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
    hasServerText: (max: number) =>
      `Pro Person ${perPerson(max)} je Angebot möglich (Minecraft-Server und Discord-Bot). Verwalte ${max === 1 ? 'ihn' : 'sie'} im Panel oder sieh dir die Angebote von Crafting Hosting an.`,
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
      `: ${fairUseOn ? `max. ${fairUse.maxSessionHours} h am Stück, ${fairUse.weeklyOfflineHours} h pro Woche offline, ` : ''}Verlängerung nach ${cycle.days} Tagen${hasRest ? ` und ${rest}` : ''}, Fair-Use-System für Bots (keine CPU-Dauerlast, aktive Nutzung), keine Selfbots, kein Spam. Hinweise zum `,
    fairTitleBot: 'Laufzeit, kurz erklärt',
    fairTextBot: (fairUseOn: boolean) =>
      `${fairUseOn ? `Max. ${fairUse.maxSessionHours} h am Stück, mind. ${fairUse.weeklyOfflineHours} h pro Woche offline. ` : 'Dein Bot darf durchgehend online sein. Fair bleibt es durch zwei Regeln: keine CPU-Dauerlast und kein tagelanger Leerlauf – Details in den Nutzungsbedingungen für Discord-Bots. '}Nach ${cycle.days} Tagen ${hasRest ? `und ${rest.replace(/^1 /, 'einem ')} ` : ''}verlängerst du mit einem Klick – wir erinnern dich vorher per E-Mail.`,
    fairTitle: 'Fair-Use, kurz erklärt',
    fairText: `Max. ${fairUse.maxSessionHours} h am Stück, mind. ${fairUse.weeklyOfflineHours} h pro Woche offline, nach ${cycle.days} Tagen ${hasRest ? `und ${rest.replace(/^1 /, 'einem ')} ` : ''}mit einem Klick verlängern. Alles automatisch – mit Hinweis im Chat, bevor etwas passiert.`,

    stepPlan: 'Paket',
    stepSoftware: 'Software',
    stepName: 'Servername',
    stepAccount: 'Konto',
    stepEmail: 'Deine E-Mail-Adresse',
    planSpecs: (ram: string, disk: string, cpu: number) => `${ram} RAM · ${disk} NVMe · bis ${cpu} % CPU`,
    soldOut: 'Aktuell ausgebucht',
    soon: 'bald',
    soonTitle: 'Bald verfügbar',
    typeGroup: 'Servertyp',
    version: 'Version',
    nameLabel: 'Name',
    nameHint: 'So heißt dein Server im Panel, z. B. „Survival mit Freunden“.',
    loggedInAs: 'Angemeldet als',
    loggedInHint: 'Der Server wird deinem Panel-Konto hinzugefügt.',
    emailLabel: 'E-Mail',
    emailHint: 'Hierhin schicken wir den Bestätigungslink. Mit dieser Adresse meldest du dich auch im Panel an.',
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
    sentBefore: 'Wir haben einen Bestätigungslink an ',
    sentAfter: (name: string) => ` geschickt. Nach dem Klick legst du dein Passwort für das Panel fest – danach wird „${name}“ automatisch erstellt.`,
    sentValid: 'Der Link ist 24 Stunden gültig.',
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
    requestNew: 'Neuen Link anfordern',
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
    metaDescription: 'Per E-Mail-Link bei CraftingHosting.free anmelden.',
    title: 'Anmelden',
    intro: 'Wir schicken dir einen Anmeldelink – ohne Passwort. Deinen Server selbst verwaltest du im Pterodactyl-Panel.',
    email: 'E-Mail-Adresse',
    submit: 'Anmeldelink senden',
    sentTitle: 'Prüfe dein Postfach',
    sentBefore: 'Falls es ein Konto mit ',
    sentAfter: ' gibt, haben wir dir einen Anmeldelink geschickt. Er ist 30 Minuten gültig.',
    otherEmail: 'Andere E-Mail-Adresse',
    noServer: 'Noch keinen Server?',
    createFree: 'Kostenlos erstellen',
    manage: 'Zum Spielen und Verwalten:',
    openPanel: 'Pterodactyl-Panel öffnen',
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
      locked: 'Gesperrt',
      installing: 'Installation läuft',
      paused: 'Fair-Use-Pause',
      online: 'Online',
      offline: 'Offline',
    },
    days: (n: number) => `${n} Tage`,
    expiredText: `Die ${cycle.days} Tage sind abgelaufen, der Server ist suspendiert. Deine Welt und Dateien sind gespeichert.`,
    restBefore: `${afterRest.charAt(0).toUpperCase()}${afterRest.slice(1)} kannst du ihn ab `,
    restAfter: ' reaktivieren – wir schicken dir dann eine E-Mail.',
    deleteAt: (dt: string) => `Ohne Reaktivierung wird der Server am ${dt} automatisch gelöscht.`,
    lockedText: 'Dieser Server wurde vom Team gesperrt. Bitte wende dich an den Support.',
    pendingText: 'Sobald dein Panel-Zugang eingerichtet ist, wird dieser Server automatisch erstellt.',
    expiringText: 'Der Server wird gerade gestoppt und suspendiert – danach kannst du ihn hier reaktivieren.',
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
    logout: 'Abmelden',
    deleteAccount: 'Konto löschen',
    deleteAccountText: 'Löscht dein Konto hier und alle Free-Server endgültig. Zur Bestätigung deine E-Mail-Adresse eingeben:',
    confirmEmail: 'E-Mail bestätigen',
  },

  faq: {
    metaTitle: 'FAQ – Häufige Fragen',
    metaDescription: 'Antworten zu CraftingHosting.free: Kosten, Panel-Zugang, Minecraft-Versionen, Discord-Bots, RAM, Fair-Use-System, 30 Tage Laufzeit und Reaktivierung.',
    title: 'Häufige Fragen',
    intro: 'Alles Wichtige zum kostenlosen Minecraft- und Discord-Bot-Hosting von Crafting Hosting.',
    moreTitle: 'Deine Frage ist nicht dabei?',
    moreText: 'Community und Team helfen dir im Discord weiter.',
    openDiscord: 'Discord öffnen',
    items: (max: number, ctx: FaqContext) => [
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
      ...(ctx.discordRam
        ? [
            {
              q: 'Kann ich auch einen Discord-Bot hosten?',
              a: `Ja. Neben Minecraft-Servern hosten wir kostenlos Discord-Bots in ${botTypes.map((t) => t.name).join(' oder ')} – je nach Paket mit ${ctx.discordRam} RAM. Du lädst deinen Code im Pterodactyl-Panel hoch (Dateimanager oder SFTP), trägst die Startdatei ein und startest den Bot. Die Bots laufen auf einer eigenen Node, getrennt von den Minecraft-Servern.`,
            },
            {
              q: 'Läuft mein Discord-Bot rund um die Uhr?',
              a: ctx.discordFairUse
                ? `Für Discord-Bots gilt dasselbe Fair-Use-System wie für Minecraft-Server: höchstens ${fairUse.maxSessionHours} Stunden am Stück und ${fairUse.weeklyOfflineHours} Stunden Offline-Zeit pro Woche. Nach ${cycle.days} Tagen verlängerst du kostenlos.`
                : `Ja – Discord-Bots dürfen durchgehend online sein, es gibt kein Laufzeitlimit und keine Pflicht-Pausen. Stattdessen gilt ein eigenes Fair-Use-System für Bots: keine CPU-Dauerlast (bei anhaltender Volllast wird der Bot nach einer Vorwarnung kurz pausiert) und aktive Nutzung (ein Bot, der tagelang offline ist, gibt seinen Platz frei). Dazu kommt die Laufzeit von ${cycle.days} Tagen, die du kostenlos verlängerst. Die genauen Werte stehen in den Nutzungsbedingungen für Discord-Bots.`,
            },
            {
              q: 'Was ist bei Discord-Bots nicht erlaubt?',
              a: 'Selfbots, Spam-, Raid- und Nuke-Bots, Token-Logger, Massen-DMs sowie alles, was gegen die Nutzungsbedingungen und die Developer Policy von Discord verstößt. Ebenso tabu: Mining, Proxys und andere Software als dein Bot. Die Details stehen in den Nutzungsbedingungen für Discord-Bots.',
            },
          ]
        : []),
      {
        q: 'Wie viele kostenlose Server kann ich haben?',
        a: `Pro Person ${perPerson(max)} möglich${ctx.discordRam ? ' – jeweils als Minecraft-Server und als Discord-Bot' : ''}. So bleibt genug Platz für alle.`,
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
    metaDescription: 'CraftingHosting Network Status: FreeHosting, Pterodactyl, API, Minecraft Nodes und Website.',
    title: 'CraftingHosting Network Status',
    intro: 'Aktueller Zustand aller Systeme hinter CraftingHosting.free.',
    allServices: 'Status aller CraftingHosting-Dienste:',
    refresh: 'Aktualisieren',
    updatedAt: (time: string) => `Stand: ${time} Uhr`,
    loadError: 'Der Status konnte gerade nicht geladen werden. Bitte versuche es gleich erneut.',
    uptime: (p: string) => `${p} % Uptime`,
    uptimeHint: 'Verfügbarkeit der letzten 30 Tage',
    uptimeNone: 'Uptime wird erfasst',
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
    components: {
      freehosting: { name: 'FreeHosting', description: 'Registrierung, Server-Erstellung und Fair-Use-System' },
      pterodactyl: { name: 'Pterodactyl Panel', description: 'Server-Management-Panel' },
      api: { name: 'API', description: 'CraftingHosting.free API und Datenbank' },
      nodes: { name: 'Minecraft Nodes', description: 'Game-Server-Nodes in Deutschland und den Niederlanden' },
      website: { name: 'Website', description: 'craftinghosting.free' },
    } as Record<string, { name: string; description: string }>,
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
      description: `Nutzungsbedingungen für das kostenlose Discord-Bot-Hosting von CraftingHosting.free: Pakete, ${cycle.days}-Tage-Zyklus, erlaubte und unzulässige Nutzung.`,
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
  early: {
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
    sentAfter: (name: string) => ` geschickt. Mit dem Klick ist dein Platz für „${name}“ gesichert – wir schreiben dir, sobald er freigeschaltet ist.`,
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
