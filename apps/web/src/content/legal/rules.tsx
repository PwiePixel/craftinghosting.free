import { formatMb, freeHostingConfig, localePath, restPeriodText, type PublicSiteDTO } from '@chfree/shared';
import Link from 'next/link';

const { fairUse, cycle } = freeHostingConfig;
const hasRest = cycle.reactivationCooldownMinutes > 0;
const delH = cycle.deleteAfterRestHours;

export function RulesDe({ site }: { site: PublicSiteDTO }) {
  const max = site.registration.maxServersPerUser;
  const { plans } = site.products.minecraft;
  // Zwei Hardware-Stufen gibt es nur, solange EPYC-Plätze vergeben werden
  const twoTiers = site.waitlist.epycSlots > 0;
  const epyc = site.hardware.cpus.find((c) => /epyc/i.test(c)) ?? 'AMD EPYC';
  const xeon = site.hardware.cpus.find((c) => /xeon/i.test(c)) ?? 'Intel Xeon';
  return (
    <>
      <section>
        <h2>1. Kostenlose Server</h2>
        <p>
          Pro Person {max === 1 ? 'ist derzeit ein kostenloser Server' : `sind derzeit ${max} kostenlose Server`} erlaubt. Verfügbare Pakete:{' '}
          {plans.map((p) => `${p.name} (${formatMb(p.memoryMb, 'de')} RAM, ${formatMb(p.diskMb, 'de')} NVMe)`).join(', ')}. Alle Ressourcen werden fair geteilt; die Angaben sind
          Obergrenzen und keine garantierte Dauerleistung.
        </p>
        <p>
          In der ersten Startphase (Early Access) sichern sich Nutzer zunächst einen Platz auf der Warteliste (ein Platz pro Person). Die Plätze werden der Reihe nach
          freigeschaltet{twoTiers ? `; die ersten Plätze erhalten einen Server auf ${epyc}, alle weiteren auf ${xeon}` : ''}. Verlässt jemand die Warteliste, rücken die
          folgenden Plätze nach. Der {cycle.days}-Tage-Zyklus beginnt mit der Freischaltung.
        </p>
      </section>

      <section>
        <h2>2. Fair-Use-System</h2>
        <ul>
          <li>Ein Server darf höchstens {fairUse.maxSessionHours} Stunden am Stück laufen und wird danach automatisch gestoppt.</li>
          <li>Nach einem automatischen Stopp ist ein erneuter Start nach {fairUse.cooldownMinutes} Minuten möglich.</li>
          <li>
            Pro Kalenderwoche (Montag 00:00 bis Sonntag 24:00 Uhr, Zeitzone {fairUse.timezone}) muss ein Server insgesamt mindestens {fairUse.weeklyOfflineHours} Stunden offline
            sein. Reicht die verbleibende Woche dafür nicht mehr aus, wird der Server automatisch gestoppt und kann bis zum Wochenende nicht erneut gestartet werden.
          </li>
          <li>Starts während einer Pause – auch direkt im Pterodactyl-Panel – werden automatisch rückgängig gemacht.</li>
          <li>Vor automatischen Stopps erscheinen Hinweise im Minecraft-Chat und in der Serverbeschreibung im Panel; wichtige Ereignisse zusätzlich per E-Mail.</li>
        </ul>
      </section>

      <section>
        <h2>3. {cycle.days}-Tage-Zyklus</h2>
        <ul>
          <li>Jeder Server hat einen Zyklus von {cycle.days} Tagen ab Erstellung bzw. letzter Reaktivierung.</li>
          <li>Nach Ablauf wird der Server offline genommen, der Nutzer informiert und der Server anschließend suspendiert.</li>
          {hasRest && (
            <li>
              Nach der Suspendierung gilt eine Ruhezeit von {restPeriodText(cycle.reactivationCooldownMinutes, 'de')}. Erst danach kann der Server reaktiviert werden; der
              Nutzer wird per E-Mail informiert.
            </li>
          )}
          <li>
            Über „Reaktivieren“ unter <Link href={localePath('de', 'myServers')}>„Meine Server“</Link> beginnt ein neuer Zyklus. Daten bleiben während der Suspendierung erhalten.
          </li>
          {delH > 0 && (
            <li>
              Wird der Server nicht innerhalb von {delH} Stunden nach dem Ende der Ruhezeit reaktiviert, wird er einschließlich Welt, Dateien und Backups automatisch gelöscht.{' '}
              {cycle.deleteReminderHours} Stunden vorher erhält der Nutzer eine Erinnerung per E-Mail. Während Wartungsarbeiten und 24 Stunden danach finden keine
              automatischen Löschungen statt.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Unzulässige Nutzung</h2>
        <ul>
          <li>Kryptomining, Proxy-/VPN-Dienste, Angriffe auf andere Systeme (z. B. DDoS) oder Portscans</li>
          <li>Rechtswidrige Inhalte sowie Verletzung von Urheber- oder Markenrechten</li>
          <li>Umgehung des Fair-Use-Systems, z. B. durch mehrere Konten</li>
          <li>Übermäßige Belastung der geteilten Ressourcen (z. B. absichtliche Lag-Maschinen)</li>
          <li>Speichern oder Verbreiten von Schadsoftware, Phishing-Inhalten oder Inhalten, die Minderjährige gefährden</li>
          <li>Nutzung als reiner Datei-, Backup- oder Webspeicher sowie der Betrieb anderer Software als eines Minecraft-Servers</li>
          <li>Weitergabe, Verkauf oder Vermietung kostenloser Server bzw. Wartelisten-Plätze an Dritte</li>
          <li>Verstöße gegen die Minecraft-EULA von Mojang/Microsoft, z. B. unzulässige Bezahl-Vorteile</li>
        </ul>
        <p>
          Für Discord-Bots gibt es ein eigenes Angebot mit eigenen Paketen – dafür gelten die{' '}
          <Link href={localePath('de', 'discordTerms')}>Nutzungsbedingungen für Discord-Bot-Hosting</Link>.
        </p>
        <p>Bei Verstößen kann der Server ohne Vorankündigung gesperrt werden. Gesperrte Server lassen sich nicht selbst reaktivieren.</p>
      </section>

      <section>
        <h2>5. Upgrade</h2>
        <p>Wer mehr Leistung und weniger Einschränkungen benötigt, kann jederzeit zu einem kostenpflichtigen Angebot von CraftingHosting wechseln.</p>
      </section>
    </>
  );
}

export function RulesEn({ site }: { site: PublicSiteDTO }) {
  const max = site.registration.maxServersPerUser;
  const { plans } = site.products.minecraft;
  // Zwei Hardware-Stufen gibt es nur, solange EPYC-Plätze vergeben werden
  const twoTiers = site.waitlist.epycSlots > 0;
  const epyc = site.hardware.cpus.find((c) => /epyc/i.test(c)) ?? 'AMD EPYC';
  const xeon = site.hardware.cpus.find((c) => /xeon/i.test(c)) ?? 'Intel Xeon';
  return (
    <>
      <section>
        <h2>1. Free servers</h2>
        <p>
          {max === 1 ? 'One free server is' : `${max} free servers are`} currently allowed per person. Available plans:{' '}
          {plans.map((p) => `${p.name} (${formatMb(p.memoryMb, 'en')} RAM, ${formatMb(p.diskMb, 'en')} NVMe)`).join(', ')}. All resources are shared fairly; the values stated
          are upper limits, not guaranteed sustained performance.
        </p>
        <p>
          During the first launch phase (early access), users first secure a spot on the waitlist (one spot per person). The spots are unlocked one after another
          {twoTiers ? `; the first spots get a server on ${epyc}, all further spots on ${xeon}` : ''}. If someone leaves the waitlist, the following spots move up. The{' '}
          {cycle.days}-day cycle starts when the spot is unlocked.
        </p>
      </section>

      <section>
        <h2>2. Fair-use system</h2>
        <ul>
          <li>A server may run for at most {fairUse.maxSessionHours} hours in a row and is then stopped automatically.</li>
          <li>After an automatic stop, it can be started again after {fairUse.cooldownMinutes} minutes.</li>
          <li>
            In every calendar week (Monday 00:00 to Sunday 24:00, time zone {fairUse.timezone}) a server has to be offline for at least {fairUse.weeklyOfflineHours} hours in
            total. If the rest of the week is no longer sufficient for this, the server is stopped automatically and cannot be started again until the end of the week.
          </li>
          <li>Starts during a break – including directly in the Pterodactyl panel – are undone automatically.</li>
          <li>Before automatic stops, notices appear in the Minecraft chat and in the server description in the panel; important events are also sent by email.</li>
        </ul>
      </section>

      <section>
        <h2>3. {cycle.days}-day cycle</h2>
        <ul>
          <li>Every server has a cycle of {cycle.days} days from creation or the last reactivation.</li>
          <li>When it ends, the server is taken offline, the user is informed and the server is then suspended.</li>
          {hasRest && (
            <li>
              After the suspension a rest period of {restPeriodText(cycle.reactivationCooldownMinutes, 'en')} applies. Only then can the server be reactivated; the user is
              informed by email.
            </li>
          )}
          <li>
            Clicking “Reactivate” under <Link href={localePath('en', 'myServers')}>“My servers”</Link> starts a new cycle. Data is kept during the suspension.
          </li>
          {delH > 0 && (
            <li>
              If the server is not reactivated within {delH} hours after the rest period ends, it is deleted automatically including world, files and backups. The user
              receives an email reminder {cycle.deleteReminderHours} hours beforehand. No automatic deletions take place during maintenance and for 24 hours afterwards.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2>4. Prohibited use</h2>
        <ul>
          <li>Crypto mining, proxy/VPN services, attacks on other systems (e.g. DDoS) or port scans</li>
          <li>Illegal content and infringement of copyrights or trademarks</li>
          <li>Circumventing the fair-use system, e.g. with multiple accounts</li>
          <li>Excessive load on the shared resources (e.g. deliberate lag machines)</li>
          <li>Storing or distributing malware, phishing content or content that endangers minors</li>
          <li>Use as pure file, backup or web storage, or running software other than a Minecraft server</li>
          <li>Passing on, selling or renting free servers or waitlist spots to third parties</li>
          <li>Violations of the Minecraft EULA of Mojang/Microsoft, e.g. prohibited pay-to-win advantages</li>
        </ul>
        <p>
          Discord bots have their own offer with their own plans – the <Link href={localePath('en', 'discordTerms')}>terms of use for Discord bot hosting</Link> apply to
          them.
        </p>
        <p>In case of violations, the server may be suspended without prior notice. Servers suspended by the team cannot be reactivated by the user.</p>
      </section>

      <section>
        <h2>5. Upgrade</h2>
        <p>Anyone who needs more performance and fewer restrictions can switch to a paid CraftingHosting plan at any time.</p>
      </section>
    </>
  );
}
