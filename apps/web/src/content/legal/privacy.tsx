import Link from 'next/link';
import { freeHostingConfig, localePath, locationNames, type PublicSiteDTO } from '@chfree/shared';
import { operator as o } from './operator';

const { cycle } = freeHostingConfig;

/** Zuständige Aufsichtsbehörde (Sitz des Anbieters in Nordrhein-Westfalen) */
const authority = {
  name: {
    de: 'Landesbeauftragte für Datenschutz und Informationsfreiheit Nordrhein-Westfalen (LDI NRW)',
    en: 'State Commissioner for Data Protection and Freedom of Information North Rhine-Westphalia (LDI NRW)',
  },
  address: 'Kavalleriestraße 2–4, 40213 Düsseldorf',
  url: 'https://www.ldi.nrw.de',
};

function Controller({ country }: { country: string }) {
  return (
    <p>
      {o.company}
      <br />
      {o.owner}
      <br />
      {o.street}
      <br />
      {o.zipCity}
      <br />
      {country}
      <br />
      <a href={`mailto:${o.email}`}>{o.email}</a> · {o.phone}
    </p>
  );
}

export function PrivacyDe({ site }: { site: PublicSiteDTO }) {
  const location = locationNames(site.hardware.locations, 'de') || 'Deutschland';
  return (
    <>
      <section>
        <h2>1. Verantwortlicher</h2>
        <Controller country={o.country.de} />
        <p>
          Siehe auch <Link href={localePath('de', 'imprint')}>Impressum</Link>. Für alle Fragen zum Datenschutz und zur Ausübung deiner Rechte erreichst du uns unter der oben
          genannten E-Mail-Adresse.
        </p>
      </section>

      <section>
        <h2>2. Hosting und Zugriffsdaten</h2>
        <p>
          Website, API, Datenbank, Pterodactyl-Panel, die Minecraft-Server und die Discord-Bots betreibt CraftingHosting selbst auf eigener Infrastruktur in Rechenzentren in{' '}
          {location} (EU). Es ist kein externer Hosting-Dienstleister mit Zugriff auf deine Daten beteiligt. Die Datenbank der Website ist eine verschlüsselte SQLite-Datenbank
          auf unserem eigenen Server in Deutschland.
        </p>
        <p>
          Beim Aufruf der Website wird deine IP-Adresse technisch verarbeitet, um die Seiten auszuliefern. Zum Schutz vor Missbrauch (Begrenzung der Anfragen pro IP-Adresse)
          wird sie für höchstens 15 Minuten im Arbeitsspeicher gehalten. Ein allgemeines Zugriffsprotokoll (Access-Log) über jeden Seitenaufruf führen wir nicht; technische
          Fehlerprotokolle enthalten keine IP-Adressen und werden automatisch überschrieben. In welchen Fällen wir deine IP-Adresse speichern, steht in Abschnitt 6.
          Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
        </p>
      </section>

      <section>
        <h2>3. Server-Anfrage, Warteliste und Nutzerkonto</h2>
        <p>
          Für die Nutzung speichern wir deine E-Mail-Adresse, deine Server-Konfiguration (Paket, Servertyp, Version, Name), den Zeitpunkt der Zustimmung zu den
          Nutzungsbedingungen und die Sprache, in der du die Website verwendest (für E-Mails und Hinweise). In der ersten Startphase (Early Access) speichern wir zusätzlich
          deinen Platz auf der Warteliste und den Zeitpunkt der Eintragung. Hast du dich schon vorher bei CraftingHosting für das kostenlose Angebot vorgemerkt (z. B. im bisherigen
          System oder über Discord), übernehmen wir diese Vormerkung mit deiner E-Mail-Adresse auf die Warteliste und informieren dich per E-Mail; du kannst den Platz jederzeit
          löschen. Die Website verwendet keine Passwörter – die Anmeldung erfolgt per E-Mail-Link. Rechtsgrundlage ist
          die Vertragserfüllung bzw. die Durchführung vorvertraglicher Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO). Zusätzlich speichern wir die IP-Adresse bei der Registrierung
          und bei der letzten Anmeldung (siehe Abschnitt 6).
        </p>
        <p>
          Nicht bestätigte Anfragen werden nach 3 Tagen automatisch gelöscht, offene Anfragen ohne eingerichteten Panel-Zugang nach 14 Tagen. Deinen Wartelisten-Platz und dein
          Konto kannst du jederzeit unter „Meine Server“ selbst löschen.
        </p>
              {site.discord.available && (
          <p>
            <strong>Discord-Verknüpfung:</strong> Wenn du dein Discord-Konto verknüpfst, leitet dich die Website zu Discord weiter (Discord Netherlands B.V. bzw. Discord Inc.,
            USA). Nach deiner Zustimmung erhalten wir von Discord deine Discord-Nutzer-ID und deinen Benutzernamen; beides speichern wir zusammen mit dem Zeitpunkt der
            Verknüpfung in deinem Account. Mit der Berechtigung „Servern beitreten“ fügt unser Bot dein Konto unserem Discord-Server hinzu. Über die Schnittstelle von Discord
            prüfen wir, ob du Mitglied unseres Servers bist, und vergeben dort Rollen (z. B. „Customer“). Öffnest du auf Discord ein Support-Ticket, schreibt der Bot deine
            Account-ID und die ID des gewählten Servers in den Ticket-Kanal, den nur du und das Support-Team sehen. Zugriffstoken von Discord speichern wir nicht.
            Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Bereitstellung des kostenlosen Angebots) und lit. f DSGVO (Schutz vor Missbrauch und Mehrfach-Anmeldungen). Die
            Verknüpfung kannst du unter „Meine Server“ lösen, solange du keinen Server bei uns hast; mit dem Löschen deines Accounts wird sie entfernt. Für die Nutzung von
            Discord selbst gelten die Datenschutzbestimmungen von Discord.
          </p>
        )}
      </section>

      <section>
        <h2>4. Bereitstellung der Minecraft-Server und Discord-Bots (Pterodactyl)</h2>
        <p>
          Zur Erstellung deines Servers legen wir in unserem Pterodactyl-Panel ein Benutzerkonto mit deiner E-Mail-Adresse, dem gewählten Benutzernamen und Passwort an. Das
          Passwort wird nur an das Panel übergeben und von der Website nicht gespeichert. Besteht bereits ein Panel-Konto mit dieser E-Mail-Adresse, wird der Server diesem
          Konto zugeordnet. Außerdem verarbeiten wir Betriebsdaten deines Servers (Status, Laufzeiten, Ressourcennutzung), um das Fair-Use-System und den{' '}
          {`${cycle.days}-Tage-Zyklus`} umzusetzen (Art. 6 Abs. 1 lit. b DSGVO). Wird ein Server nicht reaktiviert, wird er {cycle.deleteAfterRestHours} Stunden nach dem Ende der Ruhezeit samt
          Welt, Dateien und Backups gelöscht.
        </p>
        <p>
          Für das Discord-Bot-Hosting verarbeiten wir dieselben Konto-, Panel- und Betriebsdaten wie für Minecraft-Server. Die Daten deines Bots (Programmcode, Dateien,
          Datenbanken) und der Bot-Token liegen ausschließlich auf dem Server deines Bots im Panel. Wir greifen darauf nicht zu – außer wenn es zur Aufklärung von Missbrauch
          erforderlich ist. Für die Daten, die dein Bot über Discord verarbeitet, bist du selbst verantwortlich.
        </p>
      </section>

      <section>
        <h2>5. E-Mail-Versand</h2>
        <p>
          Wir versenden E-Mails zur Bestätigung deiner Adresse, mit Anmeldelinks und zu wichtigen Ereignissen deines Servers (z. B. Server bereit, Freischaltung von der
          Warteliste, bevorstehendes Ende der {cycle.days} Tage, bevorstehende Löschung). Die E-Mails werden über den eigenen Mailserver von CraftingHosting versendet; ein externer
          Versanddienstleister wird nicht eingesetzt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Werbe-E-Mails versenden wir nicht.
        </p>
        <p>
          <strong>Newsletter:</strong> Wenn du den Newsletter abonnierst (Formular auf der Website oder Häkchen beim Erstellen eines Servers), verwenden wir deine
          E-Mail-Adresse, um dir Neuigkeiten und Angebote von CraftingHosting.free und Crafting Hosting zu schicken. Die Anmeldung wird erst wirksam, wenn du sie über
          einen Bestätigungslink bestätigst (Double-Opt-in) bzw. – beim Häkchen im Bestellformular – deine E-Mail-Adresse bestätigst. Als Nachweis speichern wir Zeitpunkt
          der Anmeldung und der Bestätigung, die gewählte Sprache und die IP-Adresse bei der Anmeldung (verschlüsselt). Rechtsgrundlage ist deine Einwilligung (Art. 6
          Abs. 1 lit. a DSGVO, § 7 Abs. 2 Nr. 2 UWG). Du kannst sie jederzeit widerrufen – über den Abmeldelink am Ende jeder Ausgabe oder per Nachricht an uns. Nach der
          Abmeldung erhältst du keinen Newsletter mehr; mit dem Löschen deines Kontos wird auch der Newsletter-Eintrag gelöscht. Der Versand erfolgt über unseren eigenen
          Mailserver, ohne Öffnungs- oder Klick-Tracking.
        </p>
        <p>
          Betriebliche Hinweise (z. B. zu Wartungen, Umzügen oder geänderten Bedingungen) schicken wir unabhängig vom Newsletter an die E-Mail-Adresse deines Kontos,
          soweit das für die Bereitstellung des Dienstes erforderlich ist (Art. 6 Abs. 1 lit. b DSGVO).
        </p>
      </section>

      <section>
        <h2>6. IP-Adressen, Sicherheits- und Aktivitätsprotokolle</h2>
        <p>Zum Schutz vor Missbrauch (z. B. Mehrfachkonten, Angriffe) speichern wir deine IP-Adresse in folgenden Fällen:</p>
        <ul>
          <li>bei der Registrierung und bei der letzten Anmeldung – im Nutzerkonto, bis das Konto gelöscht wird;</li>
          <li>
            bei jeder Anmeldung zusammen mit der Browser-Kennung (User-Agent) in den Sitzungsdaten – bis die Sitzung endet; abgelaufene Sitzungen werden automatisch bereinigt;
          </li>
          <li>bei der Bestätigung des Cookie-Hinweises zusammen mit Zeitpunkt und Browser-Kennung – 90 Tage;</li>
          <li>bei sicherheitsrelevanten Aktionen (z. B. Anmeldungen, Server-Aktionen) im Aktivitätsprotokoll – 90 Tage.</li>
        </ul>
        <p>
          IP-Adressen und Browser-Kennungen werden verschlüsselt gespeichert (AES-256-GCM), zusätzlich ist die gesamte Datenbank verschlüsselt. Einsehen können sie nur
          Administratoren von CraftingHosting zur Aufklärung von Missbrauch. Rechtsgrundlage ist unser berechtigtes Interesse an der Verhinderung von Missbrauch und an
          einem sicheren Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
        </p>
        <p>
          Laufzeitdaten der Server werden nach 90 Tagen und Benachrichtigungen nach 180 Tagen automatisch gelöscht. Die Statusseite speichert ausschließlich technische
          Messwerte ohne Personenbezug.
        </p>
      </section>

      <section>
        <h2>7. Spenden</h2>
        <p>
          Spenden werden über einen Zahlungslink von SumUp abgewickelt (SumUp Limited, Block 8, Harcourt Centre, Charlotte Way, Dublin 2, Irland). Mit dem Klick auf den
          Spenden-Button verlässt du unsere Website; SumUp verarbeitet deine Zahlungsdaten als eigenständiger Verantwortlicher nach seiner eigenen Datenschutzerklärung. Wir
          erhalten von SumUp die Zahlungsbestätigung, den Betrag und den Namen des Zahlers, wie SumUp ihn übermittelt – keine Kartendaten. Diese Angaben verwenden wir zur
          Abwicklung der Spende, für die Buchführung und für Erstattungen (Art. 6 Abs. 1 lit. b und f DSGVO) und bewahren sie im Rahmen der gesetzlichen Aufbewahrungsfristen
          auf.
        </p>
      </section>

      <section>
        <h2>8. Cookies</h2>
        <p>
          Wir verwenden ausschließlich technisch notwendige Cookies: ein Session-Cookie für die Anmeldung, ein Cookie, das sich die Bestätigung des Cookie-Hinweises merkt, und
          – nur wenn du die Sprache umschaltest – ein Cookie, das deine Sprachwahl speichert. Tracking- oder Marketing-Cookies setzen wir nicht. Details findest du in den{' '}
          <Link href={localePath('de', 'cookies')}>Cookie-Hinweisen</Link>.
        </p>
      </section>

      <section>
        <h2>9. Schriftarten und externe Inhalte</h2>
        <p>
          Schriftarten werden lokal von unserem Server geladen – es findet keine Verbindung zu Google Fonts oder anderen Drittanbietern statt. Links zu Discord oder zur Hauptseite
          von CraftingHosting öffnen externe Angebote mit eigener Datenschutzerklärung; Daten werden erst übertragen, wenn du einen solchen Link anklickst.
        </p>
      </section>

      <section>
        <h2>10. Empfänger, Drittländer und automatisierte Entscheidungen</h2>
        <p>
          Wir geben deine Daten nicht an Dritte weiter, außer wir sind gesetzlich dazu verpflichtet. Eine Übermittlung in Länder außerhalb der EU findet nicht statt. Bei
          Spenden verarbeitet SumUp deine Zahlungsdaten in eigener Verantwortung (Abschnitt 7). Das
          Fair-Use-System stoppt Server automatisch nach festen, für alle gleichen Regeln; eine automatisierte Entscheidung mit rechtlicher Wirkung im Sinne von Art. 22 DSGVO
          findet nicht statt.
        </p>
      </section>

      <section>
        <h2>11. Deine Rechte</h2>
        <ul>
          <li>Auskunft (Art. 15 DSGVO)</li>
          <li>Berichtigung (Art. 16 DSGVO)</li>
          <li>Löschung (Art. 17 DSGVO)</li>
          <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
          <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
          <li>Widerspruch gegen Verarbeitungen auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO (Art. 21 DSGVO)</li>
          <li>Beschwerde bei einer Aufsichtsbehörde (Art. 77 DSGVO)</li>
        </ul>
        <p>
          Für uns zuständig ist die {authority.name.de}, {authority.address}, <a href={authority.url}>{authority.url.replace('https://', '')}</a>. Du kannst dich auch an die
          Aufsichtsbehörde deines Wohnorts wenden.
        </p>
      </section>
    </>
  );
}

export function PrivacyEn({ site }: { site: PublicSiteDTO }) {
  const location = locationNames(site.hardware.locations, 'en') || 'Germany';
  return (
    <>
      <section>
        <h2>1. Controller</h2>
        <Controller country={o.country.en} />
        <p>
          See also <Link href={localePath('en', 'imprint')}>imprint</Link>. For any questions about data protection and to exercise your rights, contact us at the email address
          above.
        </p>
      </section>

      <section>
        <h2>2. Hosting and access data</h2>
        <p>
          CraftingHosting runs the website, API, database, Pterodactyl panel, the Minecraft servers and the Discord bots itself on its own infrastructure in data centers in{' '}
          {location} (EU). No external hosting provider with access to your data is involved. The website’s database is an encrypted SQLite database on our own server in
          Germany.
        </p>
        <p>
          When you visit the website, your IP address is processed technically to deliver the pages. To prevent abuse (limiting requests per IP address), it is kept in memory
          for at most 15 minutes. We do not keep a general access log of every page view; technical error logs do not contain IP addresses and are overwritten automatically.
          Section 6 describes the cases in which we store your IP address. The legal basis is our legitimate interest in secure and stable operation (Art. 6 (1) (f) GDPR).
        </p>
      </section>

      <section>
        <h2>3. Server request, waitlist and user account</h2>
        <p>
          To provide the service we store your email address, your server configuration (plan, server type, version, name), the time you accepted the terms of use and the
          language in which you use the website (for emails and notices). During the first launch phase (early access) we also store your spot on the waitlist and the time you
          joined. If you had already registered with CraftingHosting for the free offer before (e.g. in the previous system or via Discord), we carry this registration over
          to the waitlist with your email address and inform you by email; you can delete the spot at any time. The website does not use passwords – you sign in with an email link. The legal basis is the performance of a contract or pre-contractual measures (Art. 6 (1)
          (b) GDPR). In addition, we store the IP address used when registering and when last signing in (see section 6).
        </p>
        <p>
          Unconfirmed requests are deleted automatically after 3 days, open requests without panel access after 14 days. You can delete your waitlist spot and your account
          yourself at any time under “My servers”.
        </p>
              {site.discord.available && (
          <p>
            <strong>Discord linking:</strong> When you link your Discord account, the website redirects you to Discord (Discord Netherlands B.V. or Discord Inc., USA). After
            your consent we receive your Discord user ID and username from Discord; we store both in your account together with the time of linking. With the permission “Join
            servers” our bot adds your account to our Discord server. Via Discord’s interface we check whether you are a member of our server and assign roles there (for
            example “Customer”). If you open a support ticket on Discord, the bot posts your account ID and the ID of the selected server in the ticket channel, which only
            you and the support team can see. We do not store access tokens from Discord. The legal basis is Art. 6(1)(b) GDPR (providing the free offer) and Art. 6(1)(f)
            GDPR (protection against abuse and multiple sign-ups). You can remove the link under “My servers” as long as you have no server with us; it is removed when you
            delete your account. Discord’s own privacy policy applies to your use of Discord.
          </p>
        )}
      </section>

      <section>
        <h2>4. Provision of the Minecraft servers and Discord bots (Pterodactyl)</h2>
        <p>
          To create your server, we create a user account in our Pterodactyl panel with your email address and the username and password you chose. The password is only passed
          to the panel and is not stored by the website. If a panel account with this email address already exists, the server is assigned to that account. We also process
          operating data of your server (status, runtimes, resource usage) to implement the fair-use system and the {cycle.days}-day cycle (Art. 6 (1) (b) GDPR). If a server is
          not reactivated, it is deleted including world, files and backups {cycle.deleteAfterRestHours} hours after the rest period ends.
        </p>
        <p>
          For Discord bot hosting we process the same account, panel and operating data as for Minecraft servers. Your bot’s own data (code, files, databases) and the bot
          token live only on your bot’s server in the panel. We do not access them – except where this is necessary to investigate abuse. You are responsible yourself for
          the data your bot processes via Discord.
        </p>
      </section>

      <section>
        <h2>5. Emails</h2>
        <p>
          We send emails to confirm your address, with sign-in links and about important events of your server (e.g. server ready, unlocked from the waitlist, end of the{' '}
          {cycle.days} days approaching, upcoming deletion). The emails are sent via CraftingHosting’s own mail server; no external email service provider is used. The legal
          basis is Art. 6 (1) (b) GDPR. We do not send advertising emails.
        </p>
        <p>
          <strong>Newsletter:</strong> if you subscribe to the newsletter (form on the website or checkbox when creating a server), we use your email address to send
          you news and offers from CraftingHosting.free and Crafting Hosting. The subscription only becomes effective once you confirm it via a confirmation link
          (double opt-in) or – for the checkbox in the order form – confirm your email address. As proof we store the time of the subscription and of the confirmation,
          the chosen language and the IP address at the time of subscription (encrypted). The legal basis is your consent (Art. 6(1)(a) GDPR). You can withdraw it at any
          time – via the unsubscribe link at the end of every issue or by sending us a message. After unsubscribing you will no longer receive the newsletter; when you
          delete your account, the newsletter entry is deleted as well. Emails are sent via our own mail server, without open or click tracking.
        </p>
        <p>
          Operational notices (e.g. about maintenance, migrations or changed terms) are sent to your account’s email address independently of the newsletter, as far as
          this is necessary to provide the service (Art. 6(1)(b) GDPR).
        </p>
      </section>

      <section>
        <h2>6. IP addresses, security and activity logs</h2>
        <p>To prevent abuse (e.g. multiple accounts, attacks), we store your IP address in the following cases:</p>
        <ul>
          <li>when you register and when you last signed in – in your user account, until the account is deleted;</li>
          <li>
            each time you sign in, together with the browser identifier (user agent), in the session data – until the session ends; expired sessions are cleaned up
            automatically;
          </li>
          <li>when you confirm the cookie notice, together with the time and browser identifier – 90 days;</li>
          <li>for security-relevant actions (e.g. sign-ins, server actions) in the activity log – 90 days.</li>
        </ul>
        <p>
          IP addresses and browser identifiers are stored in encrypted form (AES-256-GCM); in addition, the entire database is encrypted. Only CraftingHosting
          administrators can view them in order to investigate abuse. The legal basis is our legitimate interest in preventing abuse and in secure operation (Art. 6 (1) (f)
          GDPR).
        </p>
        <p>
          Server runtime data is deleted automatically after 90 days and notifications after 180 days. The status page only stores technical measurements without any personal
          reference.
        </p>
      </section>

      <section>
        <h2>7. Donations</h2>
        <p>
          Donations are processed via a SumUp payment link (SumUp Limited, Block 8, Harcourt Centre, Charlotte Way, Dublin 2, Ireland). When you click the donate button you
          leave our website; SumUp processes your payment data as an independent controller under its own privacy policy. We receive from SumUp the payment confirmation, the
          amount and the payer’s name as provided by SumUp – no card data. We use this information to process the donation, for bookkeeping and for refunds (Art. 6 (1) (b)
          and (f) GDPR) and keep it for the statutory retention periods.
        </p>
      </section>

      <section>
        <h2>8. Cookies</h2>
        <p>
          We only use technically necessary cookies: a session cookie for signing in, a cookie that remembers that you confirmed the cookie notice and – only if you switch the
          language – a cookie that stores your language choice. We do not use tracking or marketing cookies. See the{' '}
          <Link href={localePath('en', 'cookies')}>cookie notice</Link> for details.
        </p>
      </section>

      <section>
        <h2>9. Fonts and external content</h2>
        <p>
          Fonts are loaded locally from our server – there is no connection to Google Fonts or other third parties. Links to Discord or to the CraftingHosting main website open
          external services with their own privacy policies; data is only transmitted when you click such a link.
        </p>
      </section>

      <section>
        <h2>10. Recipients, third countries and automated decisions</h2>
        <p>
          We do not pass on your data to third parties unless we are legally obliged to do so. There is no transfer to countries outside the EU. For donations, SumUp
          processes your payment data under its own responsibility (section 7). The fair-use system stops
          servers automatically according to fixed rules that are the same for everyone; there is no automated decision with legal effect within the meaning of Art. 22 GDPR.
        </p>
      </section>

      <section>
        <h2>11. Your rights</h2>
        <ul>
          <li>Access (Art. 15 GDPR)</li>
          <li>Rectification (Art. 16 GDPR)</li>
          <li>Erasure (Art. 17 GDPR)</li>
          <li>Restriction of processing (Art. 18 GDPR)</li>
          <li>Data portability (Art. 20 GDPR)</li>
          <li>Objection to processing based on Art. 6 (1) (f) GDPR (Art. 21 GDPR)</li>
          <li>Complaint to a supervisory authority (Art. 77 GDPR)</li>
        </ul>
        <p>
          The authority responsible for us is the {authority.name.en}, {authority.address}, Germany, <a href={authority.url}>{authority.url.replace('https://', '')}</a>. You
          can also contact the supervisory authority where you live.
        </p>
      </section>
    </>
  );
}
