import { formatMb, freeHostingConfig, localePath, locationNames, restPeriodText, type PublicSiteDTO } from '@chfree/shared';
import Link from 'next/link';

const { fairUse, cycle, serverTypes } = freeHostingConfig;
const hasRest = cycle.reactivationCooldownMinutes > 0;
const delH = cycle.deleteAfterRestHours;
/** Laufzeiten für Bots, z. B. „Python“ und „Node.js“ */
const runtimes = serverTypes.filter((t) => t.kind === 'discord').map((t) => t.name);

export function DiscordTermsDe({ site }: { site: PublicSiteDTO }) {
  const max = site.registration.maxServersPerUser;
  const { plans, fairUse: fairUseEnabled } = site.products.discord;
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
        <p>
          Für Minecraft-Server gelten die gesonderten <Link href={localePath('de', 'rules')}>Nutzungsbedingungen & Fair-Use</Link>.
        </p>
      </section>

      <section>
        <h2>2. Pakete und Ressourcen</h2>
        <p>
          Pro Person {max === 1 ? 'ist derzeit ein kostenloser Server' : `sind derzeit ${max} kostenlose Server`} erlaubt; das Limit gilt je Angebot, ein
          Discord-Bot ist also zusätzlich zu einem Minecraft-Server möglich. {plans.length > 0 ? 'Verfügbare Pakete für Discord-Bots:' : 'Derzeit sind keine Pakete für Discord-Bots verfügbar.'}
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
        <h2>3. Laufzeit und {cycle.days}-Tage-Zyklus</h2>
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
            Discord-Bots dürfen durchgehend laufen: Es gibt keine Begrenzung der Laufzeit am Stück und keine wöchentliche Offline-Zeit. Es gilt ausschließlich der{' '}
            {cycle.days}-Tage-Zyklus.
          </p>
        )}
        <ul>
          <li>Jeder Bot hat einen Zyklus von {cycle.days} Tagen ab Erstellung bzw. letzter Reaktivierung.</li>
          <li>Nach Ablauf wird der Bot offline genommen, der Nutzer informiert und der Server anschließend suspendiert.</li>
          {hasRest && (
            <li>
              Nach der Suspendierung gilt eine Ruhezeit von {restPeriodText(cycle.reactivationCooldownMinutes, 'de')}. Erst danach kann der Bot reaktiviert werden; der Nutzer
              wird per E-Mail informiert.
            </li>
          )}
          <li>
            Über „Reaktivieren“ unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> beginnt ein neuer Zyklus. Daten bleiben während der Suspendierung erhalten.
          </li>
          {delH > 0 && (
            <li>
              Wird der Bot nicht innerhalb von {delH} Stunden nach dem Ende der Ruhezeit reaktiviert, wird er einschließlich aller Dateien und Datenbanken automatisch gelöscht.{' '}
              {cycle.deleteReminderHours} Stunden vorher erhält der Nutzer eine Erinnerung per E-Mail. Während Wartungsarbeiten und 24 Stunden danach finden keine
              automatischen Löschungen statt.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Erlaubte Nutzung</h2>
        <p>
          Der Server darf ausschließlich für den Betrieb von Discord-Bots genutzt werden – einschließlich direkt dazugehöriger Hilfsprozesse, z. B. einer kleinen Datenbank
          oder eines Webhook-Empfängers für den Bot.
        </p>
      </section>

      <section>
        <h2>5. Unzulässige Nutzung</h2>
        <ul>
          <li>Self-Bots und jede Automatisierung von Nutzerkonten</li>
          <li>Token-Logger, Token-Grabber und andere Software zum Ausspähen von Zugangsdaten</li>
          <li>Raid-, Nuke-, Spam- und Massen-DM-Bots</li>
          <li>Phishing- und Scam-Bots</li>
          <li>Scraping und Datensammlung entgegen den Bedingungen von Discord</li>
          <li>Kryptomining, Proxy-/VPN-Dienste und Tunnel</li>
          <li>Angriffe auf andere Systeme, Portscans und DDoS-Werkzeuge</li>
          <li>Betrieb von Websites, Game-Servern oder Dateispeichern ohne Bezug zum Bot</li>
          <li>Speichern oder Verbreiten von Schadsoftware sowie rechtswidrige Inhalte</li>
          <li>Weitergabe, Verkauf oder Vermietung des kostenlosen Platzes an Dritte</li>
          <li>Mehrere Konten pro Person (Multi-Accounting)</li>
          <li>Übermäßige Belastung der geteilten Ressourcen</li>
        </ul>
      </section>

      <section>
        <h2>6. Verantwortung der Nutzer</h2>
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
        <h2>7. Maßnahmen bei Verstößen</h2>
        <p>
          Bei Verstößen kann der Bot ohne Vorankündigung gesperrt oder gelöscht werden. Gesperrte Server lassen sich nicht selbst reaktivieren. Zur Aufklärung von Missbrauch
          dürfen wir die Dateien des betroffenen Servers einsehen.
        </p>
      </section>

      <section>
        <h2>8. Verfügbarkeit und Haftung</h2>
        <p>
          Das Angebot ist kostenlos. Ein Anspruch auf eine bestimmte Verfügbarkeit oder Leistung besteht nicht; Wartungsarbeiten und Ausfälle sind möglich. Die Haftung richtet
          sich nach den <Link href={localePath('de', 'terms')}>Allgemeinen Geschäftsbedingungen</Link> – darüber hinaus haften wir nicht.
        </p>
      </section>

      <section>
        <h2>9. Upgrade</h2>
        <p>Wer mehr Leistung und weniger Einschränkungen benötigt, kann jederzeit zu einem kostenpflichtigen Angebot von CraftingHosting wechseln.</p>
      </section>
    </>
  );
}

export function DiscordTermsEn({ site }: { site: PublicSiteDTO }) {
  const max = site.registration.maxServersPerUser;
  const { plans, fairUse: fairUseEnabled } = site.products.discord;
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
        <p>
          For Minecraft servers the separate <Link href={localePath('en', 'rules')}>terms of use & fair use</Link> apply.
        </p>
      </section>

      <section>
        <h2>2. Plans and resources</h2>
        <p>
          {max === 1 ? 'One free server is' : `${max} free servers are`} currently allowed per person; the limit applies per offer, so a Discord bot is possible in addition to a Minecraft server.{' '}
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
        <h2>3. Runtime and {cycle.days}-day cycle</h2>
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
            Discord bots may run continuously: there is no limit on the runtime in a row and no weekly offline time. Only the {cycle.days}-day cycle applies.
          </p>
        )}
        <ul>
          <li>Every bot has a cycle of {cycle.days} days from creation or the last reactivation.</li>
          <li>When it ends, the bot is taken offline, the user is informed and the server is then suspended.</li>
          {hasRest && (
            <li>
              After the suspension a rest period of {restPeriodText(cycle.reactivationCooldownMinutes, 'en')} applies. Only then can the bot be reactivated; the user is
              informed by email.
            </li>
          )}
          <li>
            Clicking “Reactivate” under <Link href={localePath('en', 'myServers')}>“My servers”</Link> starts a new cycle. Data is kept during the suspension.
          </li>
          {delH > 0 && (
            <li>
              If the bot is not reactivated within {delH} hours after the rest period ends, it is deleted automatically including all files and databases. The user receives
              an email reminder {cycle.deleteReminderHours} hours beforehand. No automatic deletions take place during maintenance and for 24 hours afterwards.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Allowed use</h2>
        <p>
          The server may only be used to run Discord bots – including directly related helper processes, e.g. a small database or a webhook listener for the bot.
        </p>
      </section>

      <section>
        <h2>5. Prohibited use</h2>
        <ul>
          <li>Self-bots and any automation of user accounts</li>
          <li>Token loggers, token grabbers and other software for stealing credentials</li>
          <li>Raid, nuke, spam and mass-DM bots</li>
          <li>Phishing and scam bots</li>
          <li>Scraping and data collection in violation of Discord’s terms</li>
          <li>Crypto mining, proxy/VPN services and tunnels</li>
          <li>Attacks on other systems, port scans and DDoS tools</li>
          <li>Hosting websites, game servers or file storage unrelated to the bot</li>
          <li>Storing or distributing malware, and illegal content</li>
          <li>Passing on, selling or renting the free slot to third parties</li>
          <li>Multiple accounts per person (multi-accounting)</li>
          <li>Excessive load on the shared resources</li>
        </ul>
      </section>

      <section>
        <h2>6. Your responsibilities</h2>
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
        <h2>7. Enforcement</h2>
        <p>
          In case of violations, the bot may be suspended or deleted without prior notice. Servers suspended by the team cannot be reactivated by the user. To investigate
          abuse, we may inspect the files of the server concerned.
        </p>
      </section>

      <section>
        <h2>8. Availability and liability</h2>
        <p>
          The offer is free of charge. There is no entitlement to a particular availability or performance; maintenance and outages are possible. Liability is governed by the{' '}
          <Link href={localePath('en', 'terms')}>terms and conditions</Link> – we accept no liability beyond that.
        </p>
      </section>

      <section>
        <h2>9. Upgrade</h2>
        <p>Anyone who needs more performance and fewer restrictions can switch to a paid CraftingHosting plan at any time.</p>
      </section>
    </>
  );
}
