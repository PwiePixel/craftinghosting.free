import { describeServerLimits, formatMb, freeHostingConfig, localePath, locationNames, productKinds, type PublicSiteDTO } from '@chfree/shared';
import Link from 'next/link';

const { fairUse, cycle, serverTypes } = freeHostingConfig;
// Als Funktionen: Die Werte sind im Admin-Bereich einstellbar und können sich zur Laufzeit ändern
/** Stunden bis zur automatischen Löschung nach einer Suspendierung (0 = keine Löschung) */
const delHFn = () => (cycle.deleteAfterRestHours > 0 ? Math.round(cycle.reactivationCooldownMinutes / 60) + cycle.deleteAfterRestHours : 0);
/** Laufzeiten für Bots, z. B. „Python“ und „Node.js“ */
const runtimes = serverTypes.filter((t) => t.kind === 'discord').map((t) => t.name);

export function DiscordTermsDe({ site }: { site: PublicSiteDTO }) {
  const offeredKinds = productKinds.filter((k) => site.products[k].enabled);
  const { plans, fairUse: fairUseEnabled } = site.products.discord;
  const bf = site.botFairUse;
  const location = locationNames(site.hardware.locations, 'de') || 'Deutschland';
  return (
    <>
      <section>
        <h2>1. Geltungsbereich</h2>
        <p>
          Diese Nutzungsbedingungen gelten für das kostenlose Hosting von Discord-Bots bei CraftingHosting.free. Ein Bot läuft als {runtimes.join('- oder ')}-Anwendung, wird über
          das Pterodactyl-Panel von CraftingHosting verwaltet und auf einer eigenen Bot-Node in {location} betrieben. Ergänzend gelten die{' '}
          <Link href={localePath('de', 'terms')}>Allgemeinen Geschäftsbedingungen</Link>.
        </p>
        {site.discord.required && (
          <p>
            Voraussetzung für kostenlose Server ist ein verknüpftes Discord-Konto und die Mitgliedschaft auf unserem Discord-Server. Jedes Discord-Konto kann nur mit einem
            Account verknüpft werden. Ohne Mitgliedschaft werden keine Server erstellt oder reaktiviert.
          </p>
        )}
        <p>
          Für Minecraft-Server gelten die gesonderten <Link href={localePath('de', 'rules')}>Nutzungsbedingungen & Fair-Use</Link>.
        </p>
      </section>

      <section>
        <h2>2. Pakete und Ressourcen</h2>
        <p>
          {describeServerLimits(site.registration.limits, 'de', offeredKinds)}{' '}
          {plans.length > 0 ? 'Verfügbare Pakete für Discord-Bots:' : 'Derzeit sind keine Pakete für Discord-Bots verfügbar.'}
        </p>
        {plans.length > 0 && (
          <ul>
            {plans.map((p) => (
              <li key={p.id}>
                {p.name}: {formatMb(p.memoryMb, 'de')} RAM, {formatMb(p.diskMb, 'de')} Speicherplatz, {p.cpuPercent} % CPU
              </li>
            ))}
          </ul>
        )}
        <p>
          Alle Ressourcen werden zwischen den Bots der Node geteilt. Die Angaben sind Obergrenzen und keine garantierte Dauerleistung. Pakete und Anzahl der Plätze können für
          neue Bots jederzeit angepasst werden.
        </p>
      </section>

      <section>
        <h2>3. Laufzeit: Dauerbetrieb ohne Ablaufdatum</h2>
        {fairUseEnabled ? (
          <ul>
            <li>Ein Bot darf höchstens {fairUse.maxSessionHours} Stunden am Stück laufen und wird danach automatisch gestoppt.</li>
            <li>Nach einem automatischen Stopp ist ein erneuter Start nach {fairUse.cooldownMinutes} Minuten möglich.</li>
            <li>
              Pro Kalenderwoche (Montag 00:00 bis Sonntag 24:00 Uhr, Zeitzone {fairUse.timezone}) muss ein Bot insgesamt mindestens {fairUse.weeklyOfflineHours} Stunden offline
              sein. Reicht die verbleibende Woche dafür nicht mehr aus, wird der Bot automatisch gestoppt und kann bis zum Wochenende nicht erneut gestartet werden.
            </li>
            <li>Starts während einer Pause – auch direkt im Pterodactyl-Panel – werden automatisch rückgängig gemacht.</li>
          </ul>
        ) : (
          <p>
            Discord-Bots dürfen durchgehend laufen: Es gibt keine Begrenzung der Laufzeit am Stück und keine wöchentliche Offline-Zeit. Stattdessen gilt das
            Fair-Use-System für Discord-Bots (Ziffer 4).
          </p>
        )}
        <ul>
          <li>
            Für Discord-Bots gibt es keinen {cycle.days}-Tage-Zyklus und keinen Ruhetag: Ein Bot läuft ohne Ablaufdatum und muss nicht verlängert werden.
          </li>
          <li>
            Suspendiert wird ein Bot nur, wenn das Fair-Use-System seinen Platz wegen Inaktivität freigibt oder eine Sperre ausgesprochen wird (Ziffer 4), sowie bei
            Verstößen gegen diese Bedingungen.
          </li>
          <li>
            Nach einer Freigabe wegen Inaktivität kann der Bot sofort über „Reaktivieren“ unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> wieder
            gestartet werden. Daten bleiben während der Suspendierung erhalten.
          </li>
          {delHFn() > 0 && (
            <li>
              Wird der Bot nicht innerhalb von {delHFn()} Stunden nach der Suspendierung reaktiviert, wird er einschließlich aller Dateien und Datenbanken automatisch
              gelöscht. {cycle.deleteReminderHours} Stunden vorher erhält der Nutzer eine Erinnerung per E-Mail. Während Wartungsarbeiten und 24 Stunden danach finden keine
              automatischen Löschungen statt.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Fair-Use-System für Discord-Bots</h2>
        {bf.enabled ? (
          <>
            <p>
              Alle kostenlosen Bots teilen sich die Hardware einer Node. Damit jeder Bot durchgehend online bleiben kann, überwacht ein automatisches System die faire Nutzung.
              Es greift nicht in die Laufzeit ein, solange die folgenden Regeln eingehalten werden:
            </p>
            <ul>
              <li>
                <strong>Keine CPU-Dauerlast:</strong> Kurzzeitige Lastspitzen sind in Ordnung. Liegt die CPU-Auslastung eines Bots jedoch länger als {bf.cpuWindowMinutes}{' '}
                Minuten ununterbrochen über {bf.cpuThresholdPercent} % des CPU-Limits seines Pakets, erhält der Nutzer nach der Hälfte dieser Zeit eine Vorwarnung per E-Mail.
                Hält die Last an, wird der Bot automatisch gestoppt und kann erst nach einer Pause von {bf.cooldownMinutes} Minuten wieder gestartet werden. Starts während
                der Pause – auch direkt im Pterodactyl-Panel – werden automatisch rückgängig gemacht.
              </li>
              {bf.maxStrikes > 0 && (
                <li>
                  <strong>Verwarnungen:</strong> Jeder automatische Stopp wegen CPU-Dauerlast zählt als Verwarnung. Bei {bf.maxStrikes} Verwarnungen innerhalb von{' '}
                  {bf.strikeWindowDays} Tagen wird der Bot gesperrt. Die Dateien bleiben erhalten; die Sperre kann nur der Support aufheben.
                </li>
              )}
              {bf.inactiveDays > 0 && (
                <li>
                  <strong>Aktive Nutzung:</strong> Kostenlose Plätze sind für Bots gedacht, die tatsächlich laufen. Ist ein Bot {bf.inactiveDays} Tage am Stück offline, wird sein
                  Platz freigegeben: Der Bot wird gestoppt und suspendiert (Ziffer 3).
                  {bf.inactiveWarningDays > 0 && <> {bf.inactiveWarningDays === 1 ? 'Einen Tag' : `${bf.inactiveWarningDays} Tage`} vorher erhält der Nutzer eine Erinnerung per E-Mail.</>}{' '}
                  Der Bot kann anschließend unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> sofort reaktiviert werden.
                </li>
              )}
              <li>
                <strong>Arbeitsspeicher und Speicherplatz:</strong> Die Obergrenzen des Pakets werden technisch durchgesetzt. Überschreitet ein Bot seinen Arbeitsspeicher, wird
                der Prozess vom System beendet.
              </li>
            </ul>
            <p>Über alle Maßnahmen des Fair-Use-Systems wird der Nutzer per E-Mail informiert; der aktuelle Status steht zusätzlich in der Serverbeschreibung im Panel.</p>
          </>
        ) : (
          <p>
            Alle kostenlosen Bots teilen sich die Hardware einer Node. Die Obergrenzen des Pakets (CPU, Arbeitsspeicher, Speicherplatz) werden technisch durchgesetzt; eine
            dauerhafte Volllast ist zu vermeiden.
          </p>
        )}
      </section>

      <section>
        <h2>5. Erlaubte Nutzung, Websites und Dashboards</h2>
        <p>
          Der Server darf ausschließlich für den Betrieb von Discord-Bots genutzt werden – einschließlich direkt dazugehöriger Hilfsprozesse, z. B. einer kleinen Datenbank
          oder eines Webhook-Empfängers für den Bot.
        </p>
        <p>
          <strong>Keine Websites.</strong> Der Server ist ein Discord-Bot-Server, kein Webserver. Das Hosten von Websites ist nicht erlaubt – weder zusätzlich zum Bot noch
          anstelle eines Bots. Das gilt für jede Art von Website, z. B. Homepage, Landingpage, Blog, Shop, Portfolio, Linkseite oder Dateidownloads.
        </p>
        <p>
          <strong>Einzige Ausnahme: ein Dashboard für den eigenen Bot.</strong> Eine Web-Oberfläche ist zulässig, wenn sie ausschließlich der Einrichtung und Verwaltung des
          auf diesem Server betriebenen Bots dient und alle folgenden Voraussetzungen erfüllt:
        </p>
        <ul>
          <li>
            <strong>Anmeldung:</strong> Die Funktionen des Dashboards sind erst nach einer Anmeldung nutzbar (z. B. Login mit Discord). Öffentlich sichtbar sein dürfen nur
            die Anmeldeseite und die gesetzlich vorgeschriebenen Angaben.
          </li>
          <li>
            <strong>Anbieterkennzeichnung:</strong> Das Dashboard enthält ein Impressum, das den Anforderungen des § 5 DDG (Digitale-Dienste-Gesetz) entspricht, soweit eine
            solche Pflicht besteht.
          </li>
          <li>
            <strong>Geltendes Recht:</strong> Der Betreiber hält die rechtlichen Vorgaben des Landes ein, in dem er ansässig ist, und der Länder, an die sich das Dashboard
            richtet – insbesondere zum Datenschutz (z. B. Datenschutzerklärung nach DSGVO) und zum Schutz von Minderjährigen.
          </li>
          <li>
            <strong>Verantwortung:</strong> Anbieter des Dashboards ist allein der Nutzer, nicht CraftingHosting. Er trifft die nötigen Vorkehrungen selbst und stellt uns von
            Ansprüchen Dritter frei, die aus dem Betrieb des Dashboards entstehen.
          </li>
          <li>
            <strong>Umfang:</strong> Das Dashboard bleibt eine Nebenfunktion des Bots und belastet die geteilten Ressourcen nicht übermäßig.
          </li>
        </ul>
        <p>
          <strong>Erkennung und Freigabe.</strong> Wir dürfen automatisiert und durch unser Team prüfen, ob auf einem Server Websites oder andere Webdienste betrieben werden.
          Dabei kann auch ein zulässiges Dashboard auffallen. In diesem Fall können wir den Server vorsorglich sperren, bis über ein Support-Ticket geklärt ist, dass es sich
          um ein Dashboard für den eigenen Bot handelt und die Voraussetzungen oben erfüllt sind. Erst danach geben wir den Server wieder frei. Ein Anspruch darauf, ein
          Dashboard zu betreiben, besteht nicht.
        </p>
      </section>

      <section>
        <h2>6. Unzulässige Nutzung</h2>
        <ul>
          <li>Self-Bots und jede Automatisierung von Nutzerkonten</li>
          <li>Token-Logger, Token-Grabber und andere Software zum Ausspähen von Zugangsdaten</li>
          <li>Raid-, Nuke-, Spam- und Massen-DM-Bots</li>
          <li>Phishing- und Scam-Bots</li>
          <li>Scraping und Datensammlung entgegen den Bedingungen von Discord</li>
          <li>Kryptomining, Proxy-/VPN-Dienste und Tunnel</li>
          <li>Angriffe auf andere Systeme, Portscans und DDoS-Werkzeuge</li>
          <li>Betrieb von Websites jeder Art – ausgenommen ein Dashboard für den eigenen Bot unter den Voraussetzungen aus Ziffer 5</li>
          <li>Betrieb von Game-Servern, Dateispeichern oder anderer Software ohne Bezug zum Bot</li>
          <li>Speichern oder Verbreiten von Schadsoftware sowie rechtswidrige Inhalte</li>
          <li>Weitergabe, Verkauf oder Vermietung des kostenlosen Platzes an Dritte</li>
          <li>Mehrere Konten pro Person (Multi-Accounting)</li>
          <li>Übermäßige Belastung der geteilten Ressourcen</li>
        </ul>
      </section>

      <section>
        <h2>7. Verantwortung der Nutzer</h2>
        <ul>
          <li>
            Nutzer halten die <a href="https://discord.com/terms">Nutzungsbedingungen</a> und die{' '}
            <a href="https://discord.com/developers/docs/policies-and-agreements/developer-policy">Developer Policy</a> von Discord ein.
          </li>
          <li>Der Bot-Token ist geheim zu halten. Wird er bekannt, ist er unverzüglich bei Discord zurückzusetzen.</li>
          <li>
            Nutzer sind für die Inhalte ihres Bots und die von ihm verarbeiteten Daten selbst verantwortlich – auch datenschutzrechtlich (DSGVO) gegenüber den Nutzern ihres
            Bots.
          </li>
          <li>Nutzer sichern ihre Daten selbst. Dateien lassen sich jederzeit über das Panel herunterladen.</li>
        </ul>
      </section>

      <section>
        <h2>8. Maßnahmen bei Verstößen</h2>
        <p>
          Bei Verstößen kann der Bot ohne Vorankündigung gesperrt oder gelöscht werden. Gesperrte Server lassen sich nicht selbst reaktivieren. Zur Aufklärung von Missbrauch
          dürfen wir die Dateien des betroffenen Servers einsehen.
        </p>
        <p>
          <strong>Abuse-Verfahren.</strong> Erkennt unser System einen möglichen Verstoß oder fällt er einem Teammitglied auf – etwa eine Website auf einem Bot-Server –,
          dürfen wir jederzeit ein Abuse-Verfahren einleiten. Der Fall wird dann von einer weiteren, übergeordneten Stelle in unserem Team geprüft. Bestätigt sie den
          Verstoß, wird der Server gesperrt und unter „Meine Server“ als „Abuse“ markiert; der Nutzer wird per E-Mail informiert. Eine Freigabe ist nur über ein
          Support-Ticket auf unserem Discord-Server möglich. Wird der Verstoß nicht bestätigt, bleibt der Server in Betrieb bzw. wird wieder freigegeben. Zum Schutz unserer
          Systeme und Dritter dürfen wir einen Server schon während der Prüfung vorsorglich sperren.
        </p>
      </section>

      <section>
        <h2>9. Verfügbarkeit und Haftung</h2>
        <p>
          Das Angebot ist kostenlos. Ein Anspruch auf eine bestimmte Verfügbarkeit oder Leistung besteht nicht; Wartungsarbeiten und Ausfälle sind möglich. Die Haftung richtet
          sich nach den <Link href={localePath('de', 'terms')}>Allgemeinen Geschäftsbedingungen</Link> – darüber hinaus haften wir nicht.
        </p>
      </section>

      <section>
        <h2>10. Upgrade</h2>
        <p>Wer mehr Leistung und weniger Einschränkungen benötigt, kann jederzeit zu einem kostenpflichtigen Angebot von CraftingHosting wechseln.</p>
      </section>
    </>
  );
}

export function DiscordTermsEn({ site }: { site: PublicSiteDTO }) {
  const offeredKinds = productKinds.filter((k) => site.products[k].enabled);
  const { plans, fairUse: fairUseEnabled } = site.products.discord;
  const bf = site.botFairUse;
  const location = locationNames(site.hardware.locations, 'en') || 'Germany';
  return (
    <>
      <section>
        <h2>1. Scope</h2>
        <p>
          These terms of use apply to the free hosting of Discord bots at CraftingHosting.free. A bot runs as a {runtimes.join(' or ')} application, is managed via the
          CraftingHosting Pterodactyl panel and runs on a dedicated bot node in {location}. The <Link href={localePath('en', 'terms')}>terms and conditions</Link> apply in
          addition.
        </p>
        {site.discord.required && (
          <p>
            Free servers require a linked Discord account and membership of our Discord server. Each Discord account can only be linked to one account. Without membership no
            servers are created or reactivated.
          </p>
        )}
        <p>
          For Minecraft servers the separate <Link href={localePath('en', 'rules')}>terms of use & fair use</Link> apply.
        </p>
      </section>

      <section>
        <h2>2. Plans and resources</h2>
        <p>
          {describeServerLimits(site.registration.limits, 'en', offeredKinds)}{' '}
          {plans.length > 0 ? 'Available plans for Discord bots:' : 'There are currently no plans available for Discord bots.'}
        </p>
        {plans.length > 0 && (
          <ul>
            {plans.map((p) => (
              <li key={p.id}>
                {p.name}: {formatMb(p.memoryMb, 'en')} RAM, {formatMb(p.diskMb, 'en')} disk space, {p.cpuPercent}% CPU
              </li>
            ))}
          </ul>
        )}
        <p>
          All resources are shared between the bots on the node. The values stated are upper limits, not guaranteed sustained performance. Plans and the number of slots may be
          adjusted for new bots at any time.
        </p>
      </section>

      <section>
        <h2>3. Runtime: continuous operation without an expiry date</h2>
        {fairUseEnabled ? (
          <ul>
            <li>A bot may run for at most {fairUse.maxSessionHours} hours in a row and is then stopped automatically.</li>
            <li>After an automatic stop, it can be started again after {fairUse.cooldownMinutes} minutes.</li>
            <li>
              In every calendar week (Monday 00:00 to Sunday 24:00, time zone {fairUse.timezone}) a bot has to be offline for at least {fairUse.weeklyOfflineHours} hours in
              total. If the rest of the week is no longer sufficient for this, the bot is stopped automatically and cannot be started again until the end of the week.
            </li>
            <li>Starts during a break – including directly in the Pterodactyl panel – are undone automatically.</li>
          </ul>
        ) : (
          <p>
            Discord bots may run continuously: there is no limit on the runtime in a row and no weekly offline time. Instead, the fair-use system for Discord
            bots (section 4) applies.
          </p>
        )}
        <ul>
          <li>
            There is no {cycle.days}-day cycle and no rest day for Discord bots: a bot runs without an expiry date and does not need to be renewed.
          </li>
          <li>
            A bot is only suspended if the fair-use system releases its slot because of inactivity or imposes a suspension (section 4), and in the event of
            violations of these terms.
          </li>
          <li>
            After a release because of inactivity the bot can be started again right away by clicking “Reactivate” under{' '}
            <Link href={localePath('en', 'myServers')}>“My servers”</Link>. Data is kept during the suspension.
          </li>
          {delHFn() > 0 && (
            <li>
              If the bot is not reactivated within {delHFn()} hours after the suspension, it is deleted automatically including all files and databases. The user receives
              an email reminder {cycle.deleteReminderHours} hours beforehand. No automatic deletions take place during maintenance and for 24 hours afterwards.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Fair-use system for Discord bots</h2>
        {bf.enabled ? (
          <>
            <p>
              All free bots share the hardware of one node. So that every bot can stay online around the clock, an automatic system monitors fair use. It does not touch the
              runtime as long as the following rules are observed:
            </p>
            <ul>
              <li>
                <strong>No sustained CPU load:</strong> short load peaks are fine. However, if a bot’s CPU usage stays above {bf.cpuThresholdPercent} % of its plan’s CPU limit
                for more than {bf.cpuWindowMinutes} minutes without interruption, the user receives an advance warning by email after half of that time. If the load
                continues, the bot is stopped automatically and can only be started again after a break of {bf.cooldownMinutes} minutes. Starts during the break – including
                directly in the Pterodactyl panel – are undone automatically.
              </li>
              {bf.maxStrikes > 0 && (
                <li>
                  <strong>Warnings:</strong> every automatic stop due to sustained CPU load counts as a warning. With {bf.maxStrikes} warnings within {bf.strikeWindowDays}{' '}
                  days the bot is suspended. Files are kept; only support can lift the suspension.
                </li>
              )}
              {bf.inactiveDays > 0 && (
                <li>
                  <strong>Active use:</strong> free slots are meant for bots that are actually running. If a bot is offline for {bf.inactiveDays} days in a row, its slot is
                  released: the bot is stopped and suspended (section 3).
                  {bf.inactiveWarningDays > 0 && <> The user receives an email reminder {bf.inactiveWarningDays === 1 ? 'one day' : `${bf.inactiveWarningDays} days`} beforehand.</>}{' '}
                  The bot can then be reactivated right away under <Link href={localePath('en', 'myServers')}>“My servers”</Link>.
                </li>
              )}
              <li>
                <strong>Memory and storage:</strong> the plan’s upper limits are enforced technically. If a bot exceeds its memory, the process is terminated by the system.
              </li>
            </ul>
            <p>The user is informed by email about all measures of the fair-use system; the current status is also shown in the server description in the panel.</p>
          </>
        ) : (
          <p>
            All free bots share the hardware of one node. The plan’s upper limits (CPU, memory, storage) are enforced technically; permanent full load must be avoided.
          </p>
        )}
      </section>

      <section>
        <h2>5. Allowed use, websites and dashboards</h2>
        <p>
          The server may only be used to run Discord bots – including directly related helper processes, e.g. a small database or a webhook listener for the bot.
        </p>
        <p>
          <strong>No websites.</strong> The server is a Discord bot server, not a web server. Hosting websites is not allowed – neither in addition to the bot nor instead of
          a bot. This applies to every kind of website, e.g. homepage, landing page, blog, shop, portfolio, link page or file downloads.
        </p>
        <p>
          <strong>The only exception: a dashboard for your own bot.</strong> A web interface is permitted if it serves exclusively to set up and manage the bot running on
          this server and meets all of the following requirements:
        </p>
        <ul>
          <li>
            <strong>Login:</strong> The functions of the dashboard can only be used after signing in (e.g. login with Discord). Only the login page and the legally required
            information may be publicly visible.
          </li>
          <li>
            <strong>Provider identification:</strong> The dashboard contains a legal notice that meets the requirements of section 5 of the German Digital Services Act
            (§ 5 DDG), where such an obligation exists.
          </li>
          <li>
            <strong>Applicable law:</strong> The operator complies with the legal requirements of the country in which they are based and of the countries the dashboard is
            aimed at – in particular regarding data protection (e.g. a privacy policy under the GDPR) and the protection of minors.
          </li>
          <li>
            <strong>Responsibility:</strong> The provider of the dashboard is solely the user, not CraftingHosting. Users take the necessary precautions themselves and
            indemnify us against third-party claims arising from the operation of the dashboard.
          </li>
          <li>
            <strong>Scope:</strong> The dashboard remains a secondary function of the bot and does not put excessive load on the shared resources.
          </li>
        </ul>
        <p>
          <strong>Detection and approval.</strong> We may check, automatically and through our team, whether websites or other web services are being run on a server. A
          permitted dashboard may be picked up in the process. In that case we may suspend the server as a precaution until it has been clarified via a support ticket that
          it is a dashboard for your own bot and that the requirements above are met. Only then do we release the server again. There is no entitlement to run a dashboard.
        </p>
      </section>

      <section>
        <h2>6. Prohibited use</h2>
        <ul>
          <li>Self-bots and any automation of user accounts</li>
          <li>Token loggers, token grabbers and other software for stealing credentials</li>
          <li>Raid, nuke, spam and mass-DM bots</li>
          <li>Phishing and scam bots</li>
          <li>Scraping and data collection in violation of Discord’s terms</li>
          <li>Crypto mining, proxy/VPN services and tunnels</li>
          <li>Attacks on other systems, port scans and DDoS tools</li>
          <li>Hosting websites of any kind – except a dashboard for your own bot under the requirements of section 5</li>
          <li>Running game servers, file storage or other software unrelated to the bot</li>
          <li>Storing or distributing malware, and illegal content</li>
          <li>Passing on, selling or renting the free slot to third parties</li>
          <li>Multiple accounts per person (multi-accounting)</li>
          <li>Excessive load on the shared resources</li>
        </ul>
      </section>

      <section>
        <h2>7. Your responsibilities</h2>
        <ul>
          <li>
            Users comply with Discord’s <a href="https://discord.com/terms">Terms of Service</a> and{' '}
            <a href="https://discord.com/developers/docs/policies-and-agreements/developer-policy">Developer Policy</a>.
          </li>
          <li>The bot token must be kept secret. If it becomes known, it must be reset at Discord immediately.</li>
          <li>
            Users are responsible for their bot’s content and the data it processes – including under data protection law (GDPR) toward the users of their bot.
          </li>
          <li>Users make their own backups. Files can be downloaded via the panel at any time.</li>
        </ul>
      </section>

      <section>
        <h2>8. Enforcement</h2>
        <p>
          In case of violations, the bot may be suspended or deleted without prior notice. Servers suspended by the team cannot be reactivated by the user. To investigate
          abuse, we may inspect the files of the server concerned.
        </p>
        <p>
          <strong>Abuse procedure.</strong> If our system detects a possible violation or a team member notices one – for example a website on a bot server – we may open an
          abuse procedure at any time. The case is then reviewed by a further, senior instance within our team. If it confirms the violation, the server is suspended and
          marked as “Abuse” under “My servers”; the user is informed by email. The server can only be released via a support ticket on our Discord server. If the violation
          is not confirmed, the server stays in operation or is released again. To protect our systems and third parties, we may suspend a server as a precaution while the
          review is still in progress.
        </p>
      </section>

      <section>
        <h2>9. Availability and liability</h2>
        <p>
          The offer is free of charge. There is no entitlement to a particular availability or performance; maintenance and outages are possible. Liability is governed by the{' '}
          <Link href={localePath('en', 'terms')}>terms and conditions</Link> – we accept no liability beyond that.
        </p>
      </section>

      <section>
        <h2>10. Upgrade</h2>
        <p>Anyone who needs more performance and fewer restrictions can switch to a paid CraftingHosting plan at any time.</p>
      </section>
    </>
  );
}
