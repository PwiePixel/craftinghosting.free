import { formatMb, freeHostingConfig, localePath, locationNames, restPeriodText, type PublicSiteDTO } from '@chfree/shared';
import Link from 'next/link';

const { fairUse, cycle, serverTypes } = freeHostingConfig;
// Als Funktionen: Die Werte sind im Admin-Bereich einstellbar und können sich zur Laufzeit ändern
const hasRestFn = () => cycle.reactivationCooldownMinutes > 0;
const delHFn = () => cycle.deleteAfterRestHours;
/** Laufzeiten für Bots, z. B. „Python“ und „Node.js“ */
const runtimes = serverTypes.filter((t) => t.kind === 'discord').map((t) => t.name);

export function DiscordTermsDe({ site }: { site: PublicSiteDTO }) {
  const max = site.registration.maxServersPerUser;
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
            Discord-Bots dürfen durchgehend laufen: Es gibt keine Begrenzung der Laufzeit am Stück und keine wöchentliche Offline-Zeit. Stattdessen gelten der{' '}
            {cycle.days}-Tage-Zyklus und das Fair-Use-System für Discord-Bots (Ziffer 4).
          </p>
        )}
        <ul>
          <li>Jeder Bot hat einen Zyklus von {cycle.days} Tagen ab Erstellung bzw. letzter Reaktivierung.</li>
          <li>Nach Ablauf wird der Bot offline genommen, der Nutzer informiert und der Server anschließend suspendiert.</li>
          {hasRestFn() && (
            <li>
              Nach der Suspendierung gilt eine Ruhezeit von {restPeriodText(cycle.reactivationCooldownMinutes, 'de')}. Erst danach kann der Bot reaktiviert werden; der Nutzer
              wird per E-Mail informiert.
            </li>
          )}
          <li>
            Über „Reaktivieren“ unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> beginnt ein neuer Zyklus. Daten bleiben während der Suspendierung erhalten.
          </li>
          {delHFn() > 0 && (
            <li>
              Wird der Bot nicht innerhalb von {delHFn()} Stunden nach dem Ende der Ruhezeit reaktiviert, wird er einschließlich aller Dateien und Datenbanken automatisch gelöscht.{' '}
              {cycle.deleteReminderHours} Stunden vorher erhält der Nutzer eine Erinnerung per E-Mail. Während Wartungsarbeiten und 24 Stunden danach finden keine
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
                  Platz freigegeben: Die Laufzeit endet vorzeitig und der Server wird wie nach Ablauf des {cycle.days}-Tage-Zyklus suspendiert (Ziffer 3).
                  {bf.inactiveWarningDays > 0 && <> {bf.inactiveWarningDays === 1 ? 'Einen Tag' : `${bf.inactiveWarningDays} Tage`} vorher erhält der Nutzer eine Erinnerung per E-Mail.</>}{' '}
                  Der Bot kann anschließend unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> reaktiviert werden.
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
        <h2>5. Erlaubte Nutzung</h2>
        <p>
          Der Server darf ausschließlich für den Betrieb von Discord-Bots genutzt werden – einschließlich direkt dazugehöriger Hilfsprozesse, z. B. einer kleinen Datenbank
          oder eines Webhook-Empfängers für den Bot.
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
          <li>Betrieb von Websites, Game-Servern oder Dateispeichern ohne Bezug zum Bot</li>
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
  const max = site.registration.maxServersPerUser;
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
            Discord bots may run continuously: there is no limit on the runtime in a row and no weekly offline time. Instead, the {cycle.days}-day cycle and the
            fair-use system for Discord bots (section 4) apply.
          </p>
        )}
        <ul>
          <li>Every bot has a cycle of {cycle.days} days from creation or the last reactivation.</li>
          <li>When it ends, the bot is taken offline, the user is informed and the server is then suspended.</li>
          {hasRestFn() && (
            <li>
              After the suspension a rest period of {restPeriodText(cycle.reactivationCooldownMinutes, 'en')} applies. Only then can the bot be reactivated; the user is
              informed by email.
            </li>
          )}
          <li>
            Clicking “Reactivate” under <Link href={localePath('en', 'myServers')}>“My servers”</Link> starts a new cycle. Data is kept during the suspension.
          </li>
          {delHFn() > 0 && (
            <li>
              If the bot is not reactivated within {delHFn()} hours after the rest period ends, it is deleted automatically including all files and databases. The user receives
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
                  released: the runtime ends early and the server is suspended as after the end of the {cycle.days}-day cycle (section 3).
                  {bf.inactiveWarningDays > 0 && <> The user receives an email reminder {bf.inactiveWarningDays === 1 ? 'one day' : `${bf.inactiveWarningDays} days`} beforehand.</>}{' '}
                  The bot can then be reactivated under <Link href={localePath('en', 'myServers')}>“My servers”</Link>.
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
        <h2>5. Allowed use</h2>
        <p>
          The server may only be used to run Discord bots – including directly related helper processes, e.g. a small database or a webhook listener for the bot.
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
          <li>Hosting websites, game servers or file storage unrelated to the bot</li>
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
