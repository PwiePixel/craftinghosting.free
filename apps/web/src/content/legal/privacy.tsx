import Link from 'next/link';
import { freeHostingConfig, localePath } from '@chfree/shared';
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

export function PrivacyDe() {
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
          Website, API, Datenbank, Pterodactyl-Panel und die Minecraft-Server betreibt CraftingHosting selbst auf eigener Infrastruktur in Rechenzentren in Deutschland und den
          Niederlanden (EU). Es ist kein externer Hosting-Dienstleister mit Zugriff auf deine Daten beteiligt.
        </p>
        <p>
          Beim Aufruf der Website wird deine IP-Adresse technisch verarbeitet, um die Seiten auszuliefern. Zum Schutz vor Missbrauch (Begrenzung der Anfragen pro IP-Adresse)
          wird sie für höchstens 15 Minuten im Arbeitsspeicher gehalten. Wir speichern keine Zugriffsprotokolle (Access-Logs). Technische Fehlerprotokolle enthalten keine
          IP-Adressen und werden automatisch überschrieben. Rechtsgrundlage ist unser berechtigtes Interesse an einem sicheren und stabilen Betrieb (Art. 6 Abs. 1 lit. f DSGVO).
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
          die Vertragserfüllung bzw. die Durchführung vorvertraglicher Maßnahmen (Art. 6 Abs. 1 lit. b DSGVO).
        </p>
        <p>
          Nicht bestätigte Anfragen werden nach 3 Tagen automatisch gelöscht, offene Anfragen ohne eingerichteten Panel-Zugang nach 14 Tagen. Deinen Wartelisten-Platz und dein
          Konto kannst du jederzeit unter „Meine Server“ selbst löschen.
        </p>
      </section>

      <section>
        <h2>4. Bereitstellung der Minecraft-Server (Pterodactyl)</h2>
        <p>
          Zur Erstellung deines Servers legen wir in unserem Pterodactyl-Panel ein Benutzerkonto mit deiner E-Mail-Adresse, dem gewählten Benutzernamen und Passwort an. Das
          Passwort wird nur an das Panel übergeben und von der Website nicht gespeichert. Besteht bereits ein Panel-Konto mit dieser E-Mail-Adresse, wird der Server diesem
          Konto zugeordnet. Außerdem verarbeiten wir Betriebsdaten deines Servers (Status, Laufzeiten, Ressourcennutzung), um das Fair-Use-System und den{' '}
          {`${cycle.days}-Tage-Zyklus`} umzusetzen (Art. 6 Abs. 1 lit. b DSGVO). Wird ein Server nicht reaktiviert, wird er {cycle.deleteAfterRestHours} Stunden nach dem Ende der Ruhezeit samt
          Welt, Dateien und Backups gelöscht.
        </p>
      </section>

      <section>
        <h2>5. E-Mail-Versand</h2>
        <p>
          Wir versenden E-Mails zur Bestätigung deiner Adresse, mit Anmeldelinks und zu wichtigen Ereignissen deines Servers (z. B. Server bereit, Freischaltung von der
          Warteliste, bevorstehendes Ende der {cycle.days} Tage, bevorstehende Löschung). Die E-Mails werden über den eigenen Mailserver von CraftingHosting versendet; ein externer
          Versanddienstleister wird nicht eingesetzt. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Werbe-E-Mails versenden wir nicht.
        </p>
      </section>

      <section>
        <h2>6. Sicherheits- und Aktivitätsprotokolle</h2>
        <p>
          Zum Schutz vor Missbrauch protokollieren wir sicherheitsrelevante Aktionen (z. B. Anmeldungen, Server-Aktionen) inklusive IP-Adresse (Art. 6 Abs. 1 lit. f DSGVO). Diese
          Protokolle werden nach spätestens 365 Tagen automatisch gelöscht, Laufzeitdaten der Server nach 90 Tagen und Benachrichtigungen nach 180 Tagen. Die Statusseite
          speichert ausschließlich technische Messwerte ohne Personenbezug.
        </p>
      </section>

      <section>
        <h2>7. Cookies</h2>
        <p>
          Wir verwenden ausschließlich technisch notwendige Cookies: ein Session-Cookie für die Anmeldung und – nur wenn du die Sprache umschaltest – ein Cookie, das deine
          Sprachwahl speichert. Tracking- oder Marketing-Cookies setzen wir nicht. Details findest du in den <Link href={localePath('de', 'cookies')}>Cookie-Hinweisen</Link>.
        </p>
      </section>

      <section>
        <h2>8. Schriftarten und externe Inhalte</h2>
        <p>
          Schriftarten werden lokal von unserem Server geladen – es findet keine Verbindung zu Google Fonts oder anderen Drittanbietern statt. Links zu Discord oder zur Hauptseite
          von CraftingHosting öffnen externe Angebote mit eigener Datenschutzerklärung; Daten werden erst übertragen, wenn du einen solchen Link anklickst.
        </p>
      </section>

      <section>
        <h2>9. Empfänger, Drittländer und automatisierte Entscheidungen</h2>
        <p>
          Wir geben deine Daten nicht an Dritte weiter, außer wir sind gesetzlich dazu verpflichtet. Eine Übermittlung in Länder außerhalb der EU findet nicht statt. Das
          Fair-Use-System stoppt Server automatisch nach festen, für alle gleichen Regeln; eine automatisierte Entscheidung mit rechtlicher Wirkung im Sinne von Art. 22 DSGVO
          findet nicht statt.
        </p>
      </section>

      <section>
        <h2>10. Deine Rechte</h2>
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

export function PrivacyEn() {
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
          CraftingHosting runs the website, API, database, Pterodactyl panel and the Minecraft servers itself on its own infrastructure in data centers in Germany and the
          Netherlands (EU). No external hosting provider with access to your data is involved.
        </p>
        <p>
          When you visit the website, your IP address is processed technically to deliver the pages. To prevent abuse (limiting requests per IP address), it is kept in memory
          for at most 15 minutes. We do not store access logs. Technical error logs do not contain IP addresses and are overwritten automatically. The legal basis is our
          legitimate interest in secure and stable operation (Art. 6 (1) (f) GDPR).
        </p>
      </section>

      <section>
        <h2>3. Server request, waitlist and user account</h2>
        <p>
          To provide the service we store your email address, your server configuration (plan, server type, version, name), the time you accepted the terms of use and the
          language in which you use the website (for emails and notices). During the first launch phase (early access) we also store your spot on the waitlist and the time you
          joined. If you had already registered with CraftingHosting for the free offer before (e.g. in the previous system or via Discord), we carry this registration over
          to the waitlist with your email address and inform you by email; you can delete the spot at any time. The website does not use passwords – you sign in with an email link. The legal basis is the performance of a contract or pre-contractual measures (Art. 6 (1)
          (b) GDPR).
        </p>
        <p>
          Unconfirmed requests are deleted automatically after 3 days, open requests without panel access after 14 days. You can delete your waitlist spot and your account
          yourself at any time under “My servers”.
        </p>
      </section>

      <section>
        <h2>4. Provision of the Minecraft servers (Pterodactyl)</h2>
        <p>
          To create your server, we create a user account in our Pterodactyl panel with your email address and the username and password you chose. The password is only passed
          to the panel and is not stored by the website. If a panel account with this email address already exists, the server is assigned to that account. We also process
          operating data of your server (status, runtimes, resource usage) to implement the fair-use system and the {cycle.days}-day cycle (Art. 6 (1) (b) GDPR). If a server is
          not reactivated, it is deleted including world, files and backups {cycle.deleteAfterRestHours} hours after the rest period ends.
        </p>
      </section>

      <section>
        <h2>5. Emails</h2>
        <p>
          We send emails to confirm your address, with sign-in links and about important events of your server (e.g. server ready, unlocked from the waitlist, end of the{' '}
          {cycle.days} days approaching, upcoming deletion). The emails are sent via CraftingHosting’s own mail server; no external email service provider is used. The legal
          basis is Art. 6 (1) (b) GDPR. We do not send advertising emails.
        </p>
      </section>

      <section>
        <h2>6. Security and activity logs</h2>
        <p>
          To prevent abuse, we log security-relevant actions (e.g. sign-ins, server actions) including the IP address (Art. 6 (1) (f) GDPR). These logs are deleted
          automatically after 365 days at the latest, server runtime data after 90 days and notifications after 180 days. The status page only stores technical measurements
          without any personal reference.
        </p>
      </section>

      <section>
        <h2>7. Cookies</h2>
        <p>
          We only use technically necessary cookies: a session cookie for signing in and – only if you switch the language – a cookie that stores your language choice. We do
          not use tracking or marketing cookies. See the <Link href={localePath('en', 'cookies')}>cookie notice</Link> for details.
        </p>
      </section>

      <section>
        <h2>8. Fonts and external content</h2>
        <p>
          Fonts are loaded locally from our server – there is no connection to Google Fonts or other third parties. Links to Discord or to the CraftingHosting main website open
          external services with their own privacy policies; data is only transmitted when you click such a link.
        </p>
      </section>

      <section>
        <h2>9. Recipients, third countries and automated decisions</h2>
        <p>
          We do not pass on your data to third parties unless we are legally obliged to do so. There is no transfer to countries outside the EU. The fair-use system stops
          servers automatically according to fixed rules that are the same for everyone; there is no automated decision with legal effect within the meaning of Art. 22 GDPR.
        </p>
      </section>

      <section>
        <h2>10. Your rights</h2>
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
