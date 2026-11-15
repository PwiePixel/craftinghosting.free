import Link from 'next/link';
import { localePath, type PublicSiteDTO } from '@chfree/shared';

function CookieTable({ head, rows }: { head: [string, string, string]; rows: [string, string, string][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-surface-2 text-gray-300">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line bg-surface">
          {rows.map(([name, purpose, duration]) => (
            <tr key={name}>
              <td className="px-4 py-3 font-mono text-gray-100">{name}</td>
              <td className="px-4 py-3">{purpose}</td>
              <td className="px-4 py-3">{duration}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Wie lange die Anmeldung hält – aus der tatsächlichen Konfiguration des Servers */
function sessionDuration(site: PublicSiteDTO, lang: 'de' | 'en'): string {
  const { idleMinutes, maxHours, persistent } = site.session;
  if (lang === 'de') {
    return `${persistent ? 'bleibt nach dem Schließen des Browsers erhalten' : 'bis zum Schließen des Browsers'}, spätestens ${idleMinutes} Minuten nach der letzten Aktivität bzw. ${maxHours} Stunden nach der Anmeldung`;
  }
  return `${persistent ? 'kept after you close the browser' : 'until you close the browser'}, at the latest ${idleMinutes} minutes after your last activity or ${maxHours} hours after signing in`;
}

export function CookiesDe({ site }: { site: PublicSiteDTO }) {
  return (
    <>
      <section>
        <h2>Kurz gesagt</h2>
        <p>
          CraftingHosting.free verwendet ausschließlich technisch notwendige Cookies – genau die drei, die unten stehen. Es gibt kein Tracking, keine Analyse- und keine
          Marketing-Cookies und keine Cookies von Drittanbietern. Eine Einwilligung ist dafür nicht erforderlich (§ 25 Abs. 2 Nr. 2 TDDDG). Sollten wir jemals
          Analyse-Werkzeuge einsetzen, fragen wir vorher ausdrücklich nach deiner Einwilligung.
        </p>
      </section>
      <section>
        <h2>Cookies, die diese Website setzt</h2>
        <CookieTable
          head={['Name', 'Zweck', 'Speicherdauer']}
          rows={[
            [
              site.session.cookieName,
              'Anmeldung: enthält eine zufällige Kennung deiner Sitzung, damit du nach der Eingabe des Codes aus der E-Mail angemeldet bleibst. Nicht per JavaScript auslesbar (HttpOnly), nur über HTTPS (Secure), SameSite=Lax. Wird erst beim Anmelden gesetzt.',
              sessionDuration(site, 'de'),
            ],
            ['chf_lang', 'Merkt sich deine Sprachwahl (de/en). Wird nur gesetzt, wenn du die Sprache umschaltest.', '12 Monate'],
            ['chf_consent', 'Merkt sich, dass du den Cookie-Hinweis bestätigt hast, damit er nicht erneut erscheint.', '12 Monate'],
            ...(site.chat
              ? ([['chf_chat', 'Support-Chat: ordnet deine laufende Unterhaltung diesem Browser zu, damit sie beim Seitenwechsel und nach der Verbindung mit Discord weitergeht. Nicht per JavaScript auslesbar (HttpOnly). Wird erst gesetzt, wenn du im Chat eine Nachricht sendest.', 'bis zum Schließen des Browsers']] as [string, string, string][])
              : []),
          ]}
        />
        <p>
          Alle Cookies gelten nur für die Adresse, unter der du die Website aufrufst. Auf der Beta-Version der Website (falls du dafür freigeschaltet bist) werden
          dieselben Cookies getrennt gesetzt.
        </p>
      </section>
      <section>
        <h2>Was wir dazu auf dem Server speichern</h2>
        <p>Zu den Cookies gehören Einträge in unserer Datenbank. Die Datenbank ist insgesamt verschlüsselt; IP-Adressen und Browser-Kennungen werden zusätzlich einzeln verschlüsselt (AES-256-GCM).</p>
        <ul>
          <li>
            <strong>Sitzung ({site.session.cookieName}):</strong> ein Prüfwert der Sitzungskennung (nicht die Kennung selbst), Beginn, letzte Aktivität und Ablauf sowie –
            verschlüsselt – IP-Adresse und Browser-Kennung. Wird beim Abmelden bzw. nach Ablauf gelöscht.
          </li>
          <li>
            <strong>Cookie-Hinweis (chf_consent):</strong> beim Bestätigen protokollieren wir Zeitpunkt, verschlüsselte IP-Adresse und verschlüsselte Browser-Kennung als
            Nachweis. Löschung nach 90 Tagen.
          </li>
          <li>
            <strong>Anmeldung und Registrierung:</strong> die IP-Adresse bei der Registrierung und bei der letzten Anmeldung (verschlüsselt, bis zur Löschung des Kontos)
            sowie ein Sicherheitsprotokoll wichtiger Aktionen mit verschlüsselter IP-Adresse (90 Tage).
          </li>
          <li>
            <strong>Sprache (chf_lang):</strong> nur im Cookie. Bist du angemeldet, speichern wir die zuletzt verwendete Sprache zusätzlich in deinem Konto, damit E-Mails
            in der richtigen Sprache kommen.
          </li>
        </ul>
        <p>
          Zweck ist der Schutz des Angebots vor Missbrauch (z. B. Mehrfachkonten, Angriffe). Einzelheiten und Rechtsgrundlagen stehen in der{' '}
          <Link href={localePath('de', 'privacy')}>Datenschutzerklärung</Link>.
        </p>
      </section>
      <section>
        <h2>Lokaler Speicher und Drittanbieter</h2>
        <p>
          Die Website speichert nichts im LocalStorage oder SessionStorage deines Browsers. Schriftarten und Skripte werden von unserem eigenen Server geladen – es werden
          keine Inhalte von Drittanbietern eingebunden, die eigene Cookies setzen könnten. Erst wenn du einen Link nach außen anklickst (z. B. zum Panel, zu Discord oder
          zur Spendenseite von SumUp), gelten die Cookie-Regeln der jeweiligen Seite.
        </p>
        {site.discord.available && (
          <p>
            Das gilt auch für die Discord-Verknüpfung: Dafür wirst du zu discord.com weitergeleitet und kommst danach zurück. Unsere Website setzt dabei kein zusätzliches
            Cookie; in deinem Account speichern wir deine Discord-Nutzer-ID und deinen Discord-Benutzernamen (siehe Datenschutzerklärung).
          </p>
        )}
      </section>
      <section>
        <h2>Cookies löschen</h2>
        <p>
          Du kannst die Cookies jederzeit in den Einstellungen deines Browsers löschen. Ohne das Anmelde-Cookie musst du dich erneut mit einem Code per E-Mail anmelden; ohne
          chf_consent erscheint der Hinweis wieder.
        </p>
      </section>
    </>
  );
}

export function CookiesEn({ site }: { site: PublicSiteDTO }) {
  return (
    <>
      <section>
        <h2>In short</h2>
        <p>
          CraftingHosting.free only uses technically necessary cookies – exactly the three listed below. There is no tracking, there are no analytics or marketing cookies
          and no third-party cookies. Consent is not required for this (§ 25 (2) no. 2 TDDDG). Should we ever use analytics tools, we will explicitly ask for your consent
          first.
        </p>
      </section>
      <section>
        <h2>Cookies set by this website</h2>
        <CookieTable
          head={['Name', 'Purpose', 'Duration']}
          rows={[
            [
              site.session.cookieName,
              'Sign-in: contains a random identifier of your session so that you stay signed in after entering the code from the email. Not readable by JavaScript (HttpOnly), HTTPS only (Secure), SameSite=Lax. Only set when you sign in.',
              sessionDuration(site, 'en'),
            ],
            ['chf_lang', 'Remembers your language choice (de/en). Only set when you switch the language.', '12 months'],
            ['chf_consent', 'Remembers that you confirmed the cookie notice so that it does not appear again.', '12 months'],
            ...(site.chat
              ? ([['chf_chat', 'Support chat: links your current conversation to this browser so that it continues when you change pages and after connecting with Discord. Not readable by JavaScript (HttpOnly). Only set when you send a message in the chat.', 'until you close the browser']] as [string, string, string][])
              : []),
          ]}
        />
        <p>
          All cookies only apply to the address under which you open the website. On the beta version of the website (if you have been approved for it), the same
          cookies are set separately.
        </p>
      </section>
      <section>
        <h2>What we store on the server alongside them</h2>
        <p>The cookies correspond to entries in our database. The database is encrypted as a whole; IP addresses and browser identifiers are additionally encrypted individually (AES-256-GCM).</p>
        <ul>
          <li>
            <strong>Session ({site.session.cookieName}):</strong> a hash of the session identifier (not the identifier itself), start, last activity and expiry as well
            as – encrypted – IP address and browser identifier. Deleted when you sign out or when it expires.
          </li>
          <li>
            <strong>Cookie notice (chf_consent):</strong> when you confirm it, we log the time, the encrypted IP address and the encrypted browser identifier as proof.
            Deleted after 90 days.
          </li>
          <li>
            <strong>Sign-in and registration:</strong> the IP address at registration and at the last sign-in (encrypted, until the account is deleted) and a security log
            of important actions with the encrypted IP address (90 days).
          </li>
          <li>
            <strong>Language (chf_lang):</strong> only in the cookie. If you are signed in, we additionally store the language you last used in your account so that emails
            arrive in the right language.
          </li>
        </ul>
        <p>
          The purpose is to protect the service against abuse (e.g. multiple accounts, attacks). Details and legal bases are set out in the{' '}
          <Link href={localePath('en', 'privacy')}>privacy policy</Link>.
        </p>
      </section>
      <section>
        <h2>Local storage and third parties</h2>
        <p>
          The website does not store anything in your browser’s localStorage or sessionStorage. Fonts and scripts are loaded from our own server – no third-party content
          that could set its own cookies is embedded. Only when you click a link to another site (e.g. to the panel, to Discord or to SumUp’s donation page) do that
          site’s cookie rules apply.
        </p>
        {site.discord.available && (
          <p>
            This also applies to Discord linking: you are redirected to discord.com and return afterwards. Our website does not set an additional cookie for this; in your
            account we store your Discord user ID and Discord username (see the privacy policy).
          </p>
        )}
      </section>
      <section>
        <h2>Deleting cookies</h2>
        <p>
          You can delete the cookies at any time in your browser settings. Without the sign-in cookie you have to sign in again with a code sent by email; without chf_consent the
          notice appears again.
        </p>
      </section>
    </>
  );
}
