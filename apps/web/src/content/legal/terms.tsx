import Link from 'next/link';
import { freeHostingConfig, localePath, locationNames, type PublicSiteDTO } from '@chfree/shared';
import { operator as o } from './operator';

const { cycle } = freeHostingConfig;

export function TermsDe({ site }: { site: PublicSiteDTO }) {
  const location = locationNames(site.hardware.locations, 'de') || 'Deutschland';
  return (
    <>
      <section>
        <h2>§ 1 Geltungsbereich</h2>
        <p>
          Diese Allgemeinen Geschäftsbedingungen gelten für die Nutzung des kostenlosen Hosting-Angebots CraftingHosting.free (craftinghosting.free) von {o.company}, Inhaber{' '}
          {o.owner}, {o.street}, {o.zipCity} („Anbieter“). Das Angebot umfasst kostenlose Minecraft-Server und kostenloses Discord-Bot-Hosting. Ergänzend gelten für
          Minecraft-Server die <Link href={localePath('de', 'rules')}>Nutzungsbedingungen & Fair-Use</Link> und für Discord-Bots die{' '}
          <Link href={localePath('de', 'discordTerms')}>Nutzungsbedingungen für Discord-Bot-Hosting</Link> (zusammen „Nutzungsbedingungen“). Kostenpflichtige Angebote von
          CraftingHosting unterliegen gesonderten Bedingungen.
        </p>
      </section>

      <section>
        <h2>§ 2 Leistungen</h2>
        <p>
          Der Anbieter stellt unentgeltlich Ressourcen zum Betrieb eines Minecraft-Servers oder eines Discord-Bots bereit, die über das Pterodactyl-Panel des Anbieters
          verwaltet werden. Die Ressourcen werden zwischen allen kostenlosen Servern eines Nodes geteilt; die angegebenen Werte sind Obergrenzen. Die Server stehen derzeit in{' '}
          {location}. Ein Anspruch auf eine bestimmte Verfügbarkeit, Leistung, Hardware oder einen bestimmten Standort besteht nicht. Der Anbieter darf Server aus technischen
          Gründen auf andere Nodes verschieben und Wartungsarbeiten durchführen.
        </p>
        <p>
          In der ersten Startphase (Early Access) werden Server über eine Warteliste der Reihe nach freigeschaltet. Ein Platz auf der Warteliste begründet keinen Anspruch auf
          einen Server zu einem bestimmten Zeitpunkt. Der Anbieter kann den Umfang des Angebots, insbesondere die Anzahl kostenloser Server pro Person, jederzeit für neue
          Server anpassen.
        </p>
        <p>
          Spenden an den Anbieter sind freiwillig. Sie sind keine Gegenleistung und begründen keinen Anspruch auf eine Leistung, ein Upgrade, eine bevorzugte Freischaltung
          oder den Fortbestand des kostenlosen Angebots.
        </p>
      </section>

      <section>
        <h2>§ 3 Registrierung und Mindestalter</h2>
        <p>
          Die Nutzung setzt ein Nutzerkonto mit bestätigter E-Mail-Adresse voraus. Pro Person ist ein Konto zulässig. Die Nutzung ist ab 16 Jahren gestattet; Personen unter 18
          Jahren benötigen die Zustimmung ihrer Erziehungsberechtigten. Ein Vertrag kommt mit der Bestätigung der E-Mail-Adresse zustande, ein Anspruch auf Abschluss besteht
          nicht.
        </p>
      </section>

      <section>
        <h2>§ 4 Fair-Use, Laufzeit und Löschung</h2>
        <p>
          Es gilt das jeweilige Fair-Use-System gemäß den Nutzungsbedingungen (<Link href={localePath('de', 'rules')}>Minecraft-Server</Link>,{' '}
          <Link href={localePath('de', 'discordTerms')}>Discord-Bots</Link>). Für Minecraft-Server gilt zusätzlich der {cycle.days}-Tage-Zyklus: Nach Ablauf eines Zyklus
          wird der Server suspendiert und kann nach der Ruhezeit reaktiviert werden. Wird er nicht innerhalb von {cycle.deleteAfterRestHours} Stunden nach dem Ende der
          Ruhezeit reaktiviert, wird er einschließlich Welt, Dateien und Backups gelöscht. Discord-Bots haben keinen solchen Zyklus und keine Ruhezeit; sie laufen ohne
          Ablaufdatum und werden nur nach längerer Inaktivität oder bei Verstößen suspendiert (siehe Nutzungsbedingungen für Discord-Bots).
        </p>
      </section>

      <section>
        <h2>§ 5 Pflichten der Nutzer</h2>
        <ul>
          <li>Nutzer halten ihre Zugangsdaten (Panel-Passwort, Zugriff auf das E-Mail-Postfach) geheim und informieren den Anbieter bei Missbrauch unverzüglich.</li>
          <li>Nutzer sind für alle Inhalte, Plugins, Mods und Einstellungen auf ihrem Server selbst verantwortlich und stellen sicher, dass sie die nötigen Rechte daran besitzen.</li>
          <li>
            Der Server darf nur für den jeweils vorgesehenen Zweck genutzt werden – den Betrieb eines Minecraft-Servers bzw. eines Discord-Bots. Unzulässige Nutzungen sind in
            den jeweiligen Nutzungsbedingungen aufgeführt.
          </li>
          <li>
            Nutzer beachten die Minecraft-Nutzungsbedingungen (EULA) von Mojang/Microsoft bzw. bei Discord-Bots die Nutzungsbedingungen und die Developer Policy von Discord
            sowie geltendes Recht.
          </li>
        </ul>
      </section>

      <section>
        <h2>§ 6 Haftung</h2>
        <p>
          Da die Leistungen unentgeltlich erbracht werden, haftet der Anbieter nur für Vorsatz und grobe Fahrlässigkeit. Diese Beschränkung gilt nicht für Schäden aus der
          Verletzung des Lebens, des Körpers oder der Gesundheit, bei arglistig verschwiegenen Mängeln sowie für die Haftung nach dem Produkthaftungsgesetz. Für den Verlust von
          Daten haftet der Anbieter nur in dem Umfang, in dem der Schaden auch bei ordnungsgemäßer Datensicherung durch den Nutzer eingetreten wäre.
        </p>
      </section>

      <section>
        <h2>§ 7 Datensicherung</h2>
        <p>
          Automatische Backups werden ohne Gewähr für Vollständigkeit und Wiederherstellbarkeit bereitgestellt. Nutzer sind für die Sicherung ihrer Daten selbst verantwortlich
          und können Welten und Dateien jederzeit über das Panel herunterladen.
        </p>
      </section>

      <section>
        <h2>§ 8 Laufzeit, Kündigung und Sperrung</h2>
        <p>
          Der Vertrag läuft auf unbestimmte Zeit. Nutzer können ihn jederzeit ohne Frist beenden, indem sie ihr Konto unter „Meine Server“ löschen. Der Anbieter kann den
          Vertrag mit einer Frist von 14 Tagen per E-Mail kündigen oder das kostenlose Angebot mit dieser Frist einstellen. Das Recht zur fristlosen Kündigung aus wichtigem
          Grund bleibt unberührt; ein wichtiger Grund liegt insbesondere bei schweren oder wiederholten Verstößen gegen diese AGB oder die Nutzungsbedingungen vor. Bei
          Verstößen kann der Anbieter Server auch vorübergehend sperren.
        </p>
      </section>

      <section>
        <h2>§ 9 Änderungen</h2>
        <p>
          Der Anbieter kann diese Bedingungen mit Wirkung für die Zukunft ändern, wenn dies aus sachlichem Grund (z. B. Gesetzesänderung, technische Weiterentwicklung,
          Anpassung des kostenlosen Angebots) erforderlich ist. Nutzer werden mindestens 14 Tage vor Inkrafttreten per E-Mail informiert. Widersprechen sie nicht bis zum
          Inkrafttreten, gelten die Änderungen als angenommen; auf diese Folge weist der Anbieter in der E-Mail hin. Im Fall eines Widerspruchs kann jede Seite den Vertrag
          beenden.
        </p>
      </section>

      <section>
        <h2>§ 10 Schlussbestimmungen</h2>
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Bei Verbrauchern gilt diese Rechtswahl nur, soweit dadurch nicht der Schutz
          zwingender Bestimmungen des Staates entzogen wird, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat. Ist der Nutzer Kaufmann, juristische Person des
          öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen, ist Gerichtsstand der Sitz des Anbieters. Sollten einzelne Bestimmungen unwirksam sein, bleibt die
          Wirksamkeit der übrigen Bestimmungen unberührt.
        </p>
      </section>
    </>
  );
}

export function TermsEn({ site }: { site: PublicSiteDTO }) {
  const location = locationNames(site.hardware.locations, 'en') || 'Germany';
  return (
    <>
      <section>
        <h2>§ 1 Scope</h2>
        <p>
          These terms and conditions apply to the use of the free hosting offer CraftingHosting.free (craftinghosting.free) by {o.company}, owner {o.owner}, {o.street},{' '}
          {o.zipCity}, Germany (“provider”). The offer comprises free Minecraft servers and free Discord bot hosting. In addition, the{' '}
          <Link href={localePath('en', 'rules')}>terms of use & fair use</Link> apply to Minecraft servers and the{' '}
          <Link href={localePath('en', 'discordTerms')}>terms of use for Discord bot hosting</Link> apply to Discord bots (together “terms of use”). Paid CraftingHosting plans
          are subject to separate terms.
        </p>
      </section>

      <section>
        <h2>§ 2 Services</h2>
        <p>
          The provider makes resources available free of charge for running a Minecraft server or a Discord bot, managed via the provider’s Pterodactyl panel. The resources
          are shared between all free servers on a node; the values stated are upper limits. The servers are currently located in {location}. There is no entitlement to a
          particular availability, performance, hardware or location. The provider may move servers to other nodes for technical reasons and carry out maintenance.
        </p>
        <p>
          During the first launch phase (early access), servers are unlocked one after another via a waitlist. A spot on the waitlist does not entitle you to a server at a
          particular time. The provider may adjust the scope of the offer for new servers at any time, in particular the number of free servers per person.
        </p>
        <p>
          Donations to the provider are voluntary. They are not consideration for a service and do not create any entitlement to a service, an upgrade, priority unlocking or
          the continuation of the free offer.
        </p>
      </section>

      <section>
        <h2>§ 3 Registration and minimum age</h2>
        <p>
          Use requires a user account with a confirmed email address. One account per person is permitted. Use is permitted from the age of 16; persons under 18 need the
          consent of their legal guardians. A contract is concluded when the email address is confirmed; there is no entitlement to conclude a contract.
        </p>
      </section>

      <section>
        <h2>§ 4 Fair use, runtime and deletion</h2>
        <p>
          The respective fair-use system applies as described in the terms of use (<Link href={localePath('en', 'rules')}>Minecraft servers</Link>,{' '}
          <Link href={localePath('en', 'discordTerms')}>Discord bots</Link>). Minecraft servers are additionally subject to the {cycle.days}-day cycle: when a cycle ends,
          the server is suspended and can be reactivated after the rest period. If it is not reactivated within {cycle.deleteAfterRestHours} hours after the rest period
          ends, it is deleted including world, files and backups. Discord bots have no such cycle and no rest period; they run without an expiry date and are only
          suspended after prolonged inactivity or in the event of violations (see the terms of use for Discord bots).
        </p>
      </section>

      <section>
        <h2>§ 5 Obligations of users</h2>
        <ul>
          <li>Users keep their access data (panel password, access to their email inbox) secret and inform the provider immediately in case of misuse.</li>
          <li>Users are responsible for all content, plugins, mods and settings on their server and ensure that they hold the necessary rights.</li>
          <li>
            The server may only be used for its intended purpose – running a Minecraft server or a Discord bot respectively. Prohibited uses are listed in the respective
            terms of use.
          </li>
          <li>
            Users comply with the Minecraft end user license agreement (EULA) of Mojang/Microsoft or, for Discord bots, Discord’s Terms of Service and Developer Policy, as
            well as applicable law.
          </li>
        </ul>
      </section>

      <section>
        <h2>§ 6 Liability</h2>
        <p>
          As the services are provided free of charge, the provider is only liable for intent and gross negligence. This limitation does not apply to damage resulting from
          injury to life, body or health, to fraudulently concealed defects or to liability under the German Product Liability Act. For loss of data, the provider is only liable
          to the extent that the damage would also have occurred if the user had backed up their data properly.
        </p>
      </section>

      <section>
        <h2>§ 7 Backups</h2>
        <p>
          Automatic backups are provided without any guarantee of completeness or recoverability. Users are responsible for backing up their own data and can download worlds
          and files via the panel at any time.
        </p>
      </section>

      <section>
        <h2>§ 8 Term, termination and suspension</h2>
        <p>
          The contract runs for an indefinite period. Users can end it at any time without notice by deleting their account under “My servers”. The provider may terminate the
          contract by email with 14 days’ notice or discontinue the free offer with this notice period. The right to terminate without notice for good cause remains unaffected;
          good cause exists in particular in the case of serious or repeated violations of these terms or the terms of use. In case of violations, the provider may also
          suspend servers temporarily.
        </p>
      </section>

      <section>
        <h2>§ 9 Changes</h2>
        <p>
          The provider may change these terms with effect for the future if this is necessary for an objective reason (e.g. changes in the law, technical development,
          adjustment of the free offer). Users will be informed by email at least 14 days before the changes take effect. If they do not object by then, the changes are deemed
          accepted; the provider points out this consequence in the email. In the event of an objection, either party may end the contract.
        </p>
      </section>

      <section>
        <h2>§ 10 Final provisions</h2>
        <p>
          The law of the Federal Republic of Germany applies, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers, this choice of law
          only applies insofar as it does not deprive them of the protection of mandatory provisions of the country in which they have their habitual residence. If the user is
          a merchant, a legal entity under public law or a special fund under public law, the place of jurisdiction is the provider’s registered office. Should individual
          provisions be invalid, the validity of the remaining provisions remains unaffected.
        </p>
      </section>
    </>
  );
}
