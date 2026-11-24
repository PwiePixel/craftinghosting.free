import Link from 'next/link';
import { localePath, type PublicSiteDTO } from '@chfree/shared';
import { operator as o } from './operator';

/**
 * Bedingungen für kostenpflichtige Extras samt Widerrufsbelehrung.
 *
 * WICHTIG: Dieser Text ist eine sorgfältige Vorlage, ersetzt aber keine Rechtsberatung. Vor dem Einschalten der
 * Extras (Admin → Extras) bitte anwaltlich prüfen lassen – vor allem Widerrufsbelehrung, Preisangaben (Umsatzsteuer)
 * und den Umgang mit Minderjährigen.
 */

function Address() {
  return (
    <p>
      {o.company}
      <br />
      Inhaber: {o.owner}
      <br />
      {o.street}
      <br />
      {o.zipCity}
      <br />
      E-Mail: <a href={`mailto:${o.email}`}>{o.email}</a>
      <br />
      Telefon: {o.phone}
    </p>
  );
}

export function ExtrasTermsDe({ site }: { site: PublicSiteDTO }) {
  const priceNote = site.addons.priceNote.de;
  const { pendingDays, remindDaysBefore } = site.addons;
  // Die Abo-Regeln stehen immer da, sobald online bezahlt werden kann – auch wenn gerade kein Extra als Abo angeboten wird, können Abos noch laufen
  const subscriptions = site.addons.online || site.addons.subscriptions;
  return (
    <>
      <section>
        <h2>§ 1 Worum es geht</h2>
        <p>
          Das Hosting bei CraftingHosting.free ist und bleibt kostenlos. Zusätzlich bieten wir freiwillige, kostenpflichtige Extras für einzelne Server an („Extras“) – zum
          Beispiel den Betrieb ohne Pausen („24/7“), eine eigene IPv4-Adresse oder schnellere Hardware. Diese Bedingungen gelten für alle Extras und ergänzen die{' '}
          <Link href={localePath('de', 'terms')}>Allgemeinen Geschäftsbedingungen</Link> sowie die Nutzungsbedingungen (
          <Link href={localePath('de', 'rules')}>Minecraft-Server</Link>, <Link href={localePath('de', 'discordTerms')}>Discord-Bots</Link>). Bei Widersprüchen gehen
          diese Bedingungen für die Extras vor.
        </p>
        <p>Vertragspartner ist:</p>
        <Address />
      </section>

      <section>
        <h2>§ 2 Bestellung und Vertragsschluss</h2>
        <p>
          Extras bestellst du in deinem Konto unter „Meine Server“ → Verwalten → Extras, jeweils für einen bestimmten Server. Die Darstellung der Extras auf der Website ist
          noch kein verbindliches Angebot. Vor dem Absenden siehst du eine Zusammenfassung mit Extra, Server, Preis und Laufzeit und kannst die Bestellung abbrechen. Mit
          dem Klick auf „Zahlungspflichtig bestellen“ gibst du ein verbindliches Angebot ab.
        </p>
        <p>
          Der Vertrag kommt zustande, sobald wir das Extra freischalten oder dir den Zahlungseingang per E-Mail bestätigen – je nachdem, was zuerst geschieht. Geht innerhalb
          von {pendingDays} Tagen nach der Bestellung keine Zahlung ein, verfällt die Bestellung, ohne dass dir Kosten entstehen. Eine offene, noch nicht bezahlte Bestellung
          kannst du jederzeit selbst stornieren.
        </p>
        <p>
          Vertragssprache ist Deutsch. Wir speichern die Bestellung (Extra, Server, Preis, Laufzeit, Zeitpunkt); du findest sie jederzeit in deinem Konto bei dem jeweiligen
          Server.
        </p>
      </section>

      <section>
        <h2>§ 3 Preise und Bezahlung</h2>
        <p>
          Es gilt der Preis, der bei der Bestellung angezeigt wird. Alle Preise sind Endpreise in Euro.{priceNote ? ` ${priceNote}` : ''} Bezahlt wird im Voraus über unseren
          Zahlungsdienstleister Mollie (Mollie B.V., Keizersgracht 126, 1015 CW Amsterdam, Niederlande) oder über den auf der Bestellseite genannten Zahlungsweg.
          Deine Zahlungsdaten (z. B. Kartennummer, Bankverbindung) gibst du ausschließlich beim Zahlungsdienstleister ein; wir erhalten sie nicht. Wird eine Zahlung
          von deiner Bank zurückgeholt (Rücklastschrift, Rückbuchung), endet das Extra; dadurch entstehende Bankgebühren trägst du, soweit du die Rückbuchung zu
          vertreten hast.
        </p>
      </section>

      <section>
        <h2>§ 4 Laufzeit – einmalig oder als Abo</h2>
        <h3>Einmalige Buchung</h3>
        <p>
          Jedes Extra wird für die bei der Bestellung genannte Laufzeit gebucht (zum Beispiel 30 Tage). Die Laufzeit beginnt mit der Freischaltung. Bei der einmaligen
          Buchung endet sie von selbst – eine Kündigung ist nicht nötig, und es wird nichts automatisch verlängert oder abgebucht.
          {remindDaysBefore > 0 ? ' Vor dem Ende erinnern wir dich in der Regel per E-Mail.' : ''} Möchtest du das Extra weiter nutzen, buchst du in deinem Konto eine
          weitere Laufzeit; sie schließt an die laufende an. Zum Zeitpunkt der Verlängerung gilt der dann angezeigte Preis.
        </p>
        {subscriptions && (
          <>
            <h3>Abo</h3>
            <p>
              Einige Extras lassen sich auf Wunsch als Abo buchen. Das wählst du bei der Bestellung ausdrücklich aus. Ein Abo läuft auf unbestimmte Zeit: Es verlängert
              sich jeweils um die bei der Bestellung genannte Laufzeit, und der dafür genannte Preis wird wenige Tage vor dem Ende der bezahlten Laufzeit über das von
              dir bei der ersten Zahlung genutzte Zahlungsmittel abgebucht (z. B. Kreditkarte oder SEPA-Lastschrift). Vor jeder Abbuchung kündigen wir sie dir per E-Mail
              an; du bist einverstanden, dass diese Ankündigung auch kurzfristig – mindestens einen Tag vorher – erfolgen kann.
            </p>
            <p>
              <strong>Kündigung:</strong> Du kannst ein Abo jederzeit ohne Frist zum Ende der bereits bezahlten Laufzeit kündigen – in deinem Konto bei dem jeweiligen
              Server („Abo kündigen“) oder ohne Anmeldung über <Link href={localePath('de', 'cancelSubscription')}>„Verträge hier kündigen“</Link>. Wir bestätigen dir
              die Kündigung per E-Mail. Danach wird nichts mehr abgebucht; das Extra läuft bis zum Ende der bezahlten Laufzeit weiter.
            </p>
            <p>
              Für ein laufendes Abo gilt der Preis, zu dem du es abgeschlossen hast. Eine Preiserhöhung kündigen wir dir mindestens 30 Tage vorher per E-Mail an; sie
              gilt erst für Laufzeiten, die danach beginnen, und du kannst vorher kündigen. Schlägt eine Abbuchung fehl, können wir ein Extra für diesen Server nicht
              mehr bereitstellen oder stellen wir es ein, endet das Abo, ohne dass weitere Kosten entstehen; das Extra läuft bis zum Ende der bezahlten Laufzeit. Wir
              können ein Abo unsererseits mit einer Frist von 14 Tagen zum Ende einer Laufzeit kündigen.
            </p>
          </>
        )}
        <p>
          Extras, die als „einmalig“ ausgewiesen sind, gelten, solange es den Server gibt, für den sie gebucht wurden.
        </p>
        <p>Endet ein Extra, läuft dein Server ganz normal zu den Bedingungen des kostenlosen Angebots weiter.</p>
      </section>

      <section>
        <h2>§ 5 Was die Extras leisten</h2>
        <p>
          Den genauen Umfang beschreibt die Seite des jeweiligen Extras zum Zeitpunkt der Bestellung. Allgemein gilt:
        </p>
        <ul>
          <li>
            <strong>24/7:</strong> Solange das Extra aktiv ist, gelten für den Server weder das Laufzeitlimit und die Offline-Zeiten des Fair-Use-Systems noch der
            wiederkehrende Zyklus mit Ruhezeit. Alle übrigen Regeln gelten weiter – insbesondere die erlaubte Nutzung, der Schutz vor Überlastung (z. B. bei dauerhaft
            sehr hoher CPU-Last) und die Folgen von Verstößen.
          </li>
          <li>
            <strong>Extras, die unser Team einrichtet</strong> (z. B. eigene IPv4-Adresse, Umzug auf andere Hardware): Wir richten sie nach Zahlungseingang ein, in der
            Regel innerhalb von zwei Werktagen. Die Laufzeit läuft ab der Freischaltung; verzögert sich die Einrichtung aus Gründen, die bei uns liegen, schreiben wir die
            Zeit gut. Für einen Umzug kann ein kurzer Neustart des Servers nötig sein.
          </li>
        </ul>
        <p>
          Extras ändern nichts daran, dass sich kostenlose Server die Hardware teilen und wir keine bestimmte Verfügbarkeit zusagen. Wartungsarbeiten und Störungen können
          auch Server mit Extras betreffen. Fällt ein Extra aus Gründen, die bei uns liegen, zusammenhängend länger als 24 Stunden aus, schreiben wir dir die ausgefallene
          Zeit auf Anfrage gut.
        </p>
      </section>

      <section>
        <h2>§ 6 Bindung an den Server, Löschung und Sperrung</h2>
        <ul>
          <li>Ein Extra gilt nur für den Server, für den es gebucht wurde. Es lässt sich nicht auf andere Server oder Personen übertragen.</li>
          <li>Löschst du den Server oder dein Konto, endet das Extra. Eine Erstattung für die restliche Laufzeit gibt es in diesem Fall nicht; dein Widerrufsrecht bleibt unberührt.</li>
          <li>
            Wird der Server wegen eines Verstoßes gegen die AGB oder die Nutzungsbedingungen gesperrt oder gelöscht, läuft die Laufzeit des Extras weiter; eine Erstattung
            gibt es nicht.
          </li>
          <li>
            Stellen wir ein Extra oder das Angebot insgesamt ein oder können wir ein Extra nicht (mehr) erbringen, erstatten wir dir den Preis anteilig für die nicht
            genutzte Laufzeit.
          </li>
        </ul>
      </section>

      <section>
        <h2>§ 7 Minderjährige</h2>
        <p>
          Wer noch nicht 18 Jahre alt ist, darf Extras nur mit Zustimmung der Erziehungsberechtigten bestellen. Fehlt die Zustimmung, können die Erziehungsberechtigten die
          Erstattung verlangen; das Extra endet dann.
        </p>
      </section>

      <section id="widerruf" className="scroll-mt-24">
        <h2>§ 8 Widerrufsbelehrung</h2>
        <p>Verbraucherinnen und Verbraucher haben das folgende Widerrufsrecht.</p>
        <h3>Widerrufsrecht</h3>
        <p>
          Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des
          Vertragsabschlusses.
        </p>
        <p>
          Um dein Widerrufsrecht auszuüben, musst du uns ({o.company}, {o.street}, {o.zipCity}, E-Mail: <a href={`mailto:${o.email}`}>{o.email}</a>, Telefon: {o.phone})
          mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du
          kannst dafür das unten stehende Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.
        </p>
        <p>Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.</p>
        <h3>Folgen des Widerrufs</h3>
        <p>
          Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag
          zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel,
          das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden dir wegen
          dieser Rückzahlung Entgelte berechnet.
        </p>
        <p>
          Hast du verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen soll, so hast du uns einen angemessenen Betrag zu zahlen, der dem Anteil der bis
          zu dem Zeitpunkt, zu dem du uns von der Ausübung des Widerrufsrechts hinsichtlich dieses Vertrags unterrichtest, bereits erbrachten Dienstleistungen im Vergleich
          zum Gesamtumfang der im Vertrag vorgesehenen Dienstleistungen entspricht.
        </p>
        <h3>Vorzeitiges Erlöschen des Widerrufsrechts</h3>
        <p>
          Das Widerrufsrecht erlischt vorzeitig, wenn wir die Dienstleistung vollständig erbracht haben und mit der Ausführung erst begonnen haben, nachdem du dazu deine
          ausdrückliche Zustimmung gegeben und gleichzeitig deine Kenntnis davon bestätigt hast, dass du dein Widerrufsrecht bei vollständiger Vertragserfüllung durch uns
          verlierst.
        </p>
        <h3>Muster-Widerrufsformular</h3>
        <p>Wenn du den Vertrag widerrufen willst, kannst du diesen Text ausfüllen und an uns senden:</p>
        <p>
          An {o.company}, {o.street}, {o.zipCity}, E-Mail: {o.email}
          <br />
          – Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über die Erbringung der folgenden Dienstleistung (*)
          <br />
          – Bestellt am (*) / Verwendungszweck der Bestellung (z. B. CH-…)
          <br />
          – Name der Verbraucherin/des Verbrauchers
          <br />
          – E-Mail-Adresse des Kontos
          <br />
          – Datum
          <br />
          (*) Unzutreffendes streichen.
        </p>
      </section>

      <section>
        <h2>§ 9 Mängel und Haftung</h2>
        <p>
          Es gelten die gesetzlichen Rechte bei Mängeln. Für bezahlte Extras haften wir unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Schäden aus der Verletzung
          des Lebens, des Körpers oder der Gesundheit sowie nach dem Produkthaftungsgesetz. Bei leichter Fahrlässigkeit haften wir nur, wenn eine wesentliche
          Vertragspflicht verletzt wurde – also eine Pflicht, deren Erfüllung den Vertrag überhaupt erst möglich macht und auf deren Einhaltung du regelmäßig vertrauen
          darfst –, und dann begrenzt auf den vertragstypischen, vorhersehbaren Schaden. Für den Verlust von Daten haften wir nur in dem Umfang, in dem der Schaden auch
          bei ordnungsgemäßer Datensicherung durch dich eingetreten wäre. Für die kostenlosen Leistungen bleibt es bei § 6 der{' '}
          <Link href={localePath('de', 'terms')}>Allgemeinen Geschäftsbedingungen</Link>.
        </p>
      </section>

      <section>
        <h2>§ 10 Schlussbestimmungen</h2>
        <p>
          Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts; zwingende Verbraucherschutzvorschriften des Staates, in dem du deinen
          gewöhnlichen Aufenthalt hast, bleiben unberührt. Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen. Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.
        </p>
      </section>
    </>
  );
}

export function ExtrasTermsEn({ site }: { site: PublicSiteDTO }) {
  const priceNote = site.addons.priceNote.en;
  const { pendingDays, remindDaysBefore } = site.addons;
  // Die Abo-Regeln stehen immer da, sobald online bezahlt werden kann – auch wenn gerade kein Extra als Abo angeboten wird, können Abos noch laufen
  const subscriptions = site.addons.online || site.addons.subscriptions;
  return (
    <>
      <section>
        <h2>§ 1 What this is about</h2>
        <p>
          Hosting at CraftingHosting.free is and stays free. In addition we offer optional paid extras for individual servers (“extras”) – for example running without
          breaks (“24/7”), a dedicated IPv4 address or faster hardware. These terms apply to all extras and supplement the{' '}
          <Link href={localePath('en', 'terms')}>General Terms and Conditions</Link> and the terms of use (<Link href={localePath('en', 'rules')}>Minecraft servers</Link>,{' '}
          <Link href={localePath('en', 'discordTerms')}>Discord bots</Link>). In case of conflict, these terms prevail for the extras.
        </p>
        <p>Your contracting partner is:</p>
        <Address />
      </section>

      <section>
        <h2>§ 2 Ordering and conclusion of contract</h2>
        <p>
          You order extras in your account under “My servers” → Manage → Extras, always for one specific server. Showing extras on the website is not yet a binding offer.
          Before you submit, you see a summary with the extra, server, price and term and can cancel. By clicking “Order with obligation to pay” you make a binding offer.
        </p>
        <p>
          The contract is concluded as soon as we activate the extra or confirm receipt of your payment by email – whichever happens first. If no payment arrives within
          {pendingDays} days of ordering, the order lapses at no cost to you. You can cancel an open, unpaid order yourself at any time.
        </p>
        <p>
          The contract language is German. We store the order (extra, server, price, term, time); you can find it in your account with the respective server at any time.
        </p>
      </section>

      <section>
        <h2>§ 3 Prices and payment</h2>
        <p>
          The price shown when ordering applies. All prices are final prices in euros.{priceNote ? ` ${priceNote}` : ''} Payment is made in advance via our payment
          provider Mollie (Mollie B.V., Keizersgracht 126, 1015 CW Amsterdam, Netherlands) or via the payment method named on the order page. You enter your payment
          details (e.g. card number, bank account) only with the payment provider; we do not receive them. If a payment is reversed by your bank (returned direct
          debit, chargeback), the extra ends; you bear any resulting bank fees to the extent that you are responsible for the reversal.
        </p>
      </section>

      <section>
        <h2>§ 4 Term – one-time or as a subscription</h2>
        <h3>One-time booking</h3>
        <p>
          Each extra is booked for the term stated when ordering (for example 30 days). The term starts with activation. With a one-time booking it ends by itself – you
          do not need to cancel, and nothing is renewed or charged automatically.{remindDaysBefore > 0 ? ' We usually remind you by email before it ends.' : ''} If you
          want to keep the extra, you book another term in your account; it follows on from the current one. The price shown at the time of renewal applies.
        </p>
        {subscriptions && (
          <>
            <h3>Subscription</h3>
            <p>
              Some extras can be booked as a subscription if you wish. You choose this explicitly when ordering. A subscription runs for an indefinite period: it renews
              by the term stated when ordering, and the price stated for it is charged a few days before the end of the paid term to the payment method you used for the
              first payment (e.g. credit card or SEPA direct debit). We announce each charge by email beforehand; you agree that this announcement may be made at short
              notice – at least one day in advance.
            </p>
            <p>
              <strong>Cancellation:</strong> you can cancel a subscription at any time without notice to the end of the term already paid for – in your account with the
              respective server (“Cancel subscription”) or without signing in via <Link href={localePath('en', 'cancelSubscription')}>“Cancel contracts here”</Link>. We
              confirm the cancellation by email. After that nothing more is charged; the extra keeps running until the end of the paid term.
            </p>
            <p>
              A running subscription keeps the price at which you concluded it. We announce a price increase by email at least 30 days in advance; it only applies to
              terms that begin after that, and you can cancel beforehand. If a charge fails, if we can no longer provide an extra for this server or if we discontinue
              it, the subscription ends without any further cost; the extra runs until the end of the paid term. We may cancel a subscription ourselves with 14 days’
              notice to the end of a term.
            </p>
          </>
        )}
        <p>Extras marked as “one-time” apply for as long as the server they were booked for exists.</p>
        <p>When an extra ends, your server simply continues under the conditions of the free offer.</p>
      </section>

      <section>
        <h2>§ 5 What the extras provide</h2>
        <p>The exact scope is described on the page of the respective extra at the time of ordering. In general:</p>
        <ul>
          <li>
            <strong>24/7:</strong> While the extra is active, neither the runtime limit and offline periods of the fair-use system nor the recurring cycle with its rest
            period apply to the server. All other rules continue to apply – in particular permitted use, protection against overload (e.g. permanently very high CPU load)
            and the consequences of violations.
          </li>
          <li>
            <strong>Extras set up by our team</strong> (e.g. dedicated IPv4 address, move to other hardware): we set them up after payment has been received, usually
            within two working days. The term runs from activation; if setup is delayed for reasons on our side, we credit the time. A move may require a short restart
            of the server.
          </li>
        </ul>
        <p>
          Extras do not change the fact that free servers share hardware and that we do not promise any particular availability. Maintenance and outages can also affect
          servers with extras. If an extra is unavailable for more than 24 consecutive hours for reasons on our side, we credit the lost time on request.
        </p>
      </section>

      <section>
        <h2>§ 6 Tied to the server, deletion and suspension</h2>
        <ul>
          <li>An extra only applies to the server it was booked for. It cannot be transferred to other servers or people.</li>
          <li>If you delete the server or your account, the extra ends. There is no refund for the remaining term in that case; your right of withdrawal remains unaffected.</li>
          <li>If the server is suspended or deleted because of a violation of the terms, the term of the extra keeps running; there is no refund.</li>
          <li>If we discontinue an extra or the service as a whole, or can no longer provide an extra, we refund the price pro rata for the unused term.</li>
        </ul>
      </section>

      <section>
        <h2>§ 7 Minors</h2>
        <p>
          Anyone under 18 may only order extras with the consent of their parents or guardians. Without consent, the parents or guardians can demand a refund; the extra
          then ends.
        </p>
      </section>

      <section id="widerruf" className="scroll-mt-24">
        <h2>§ 8 Right of withdrawal</h2>
        <p>Consumers have the following right of withdrawal.</p>
        <h3>Right of withdrawal</h3>
        <p>You have the right to withdraw from this contract within fourteen days without giving any reason. The withdrawal period is fourteen days from the day the contract is concluded.</p>
        <p>
          To exercise your right of withdrawal, you must inform us ({o.company}, {o.street}, {o.zipCity}, Germany, email: <a href={`mailto:${o.email}`}>{o.email}</a>,
          phone: {o.phone}) of your decision to withdraw from this contract by means of a clear statement (e.g. a letter sent by post or an email). You may use the model
          withdrawal form below, but this is not mandatory.
        </p>
        <p>To meet the withdrawal deadline, it is sufficient for you to send your notice of withdrawal before the withdrawal period has expired.</p>
        <h3>Effects of withdrawal</h3>
        <p>
          If you withdraw from this contract, we shall reimburse all payments received from you without undue delay and at the latest within fourteen days of the day on
          which we received notice of your withdrawal. We will use the same means of payment that you used for the original transaction, unless expressly agreed otherwise
          with you; in no case will you be charged any fees for this reimbursement.
        </p>
        <p>
          If you requested that the service begin during the withdrawal period, you shall pay us a reasonable amount corresponding to the proportion of the services
          already provided up to the time you inform us of the withdrawal, compared with the total scope of the services provided for in the contract.
        </p>
        <h3>Early expiry of the right of withdrawal</h3>
        <p>
          The right of withdrawal expires early if we have fully performed the service and only began performing it after you gave your express consent and at the same
          time confirmed your knowledge that you lose your right of withdrawal once we have fully performed the contract.
        </p>
        <h3>Model withdrawal form</h3>
        <p>If you want to withdraw from the contract, you can fill in this text and send it to us:</p>
        <p>
          To {o.company}, {o.street}, {o.zipCity}, Germany, email: {o.email}
          <br />
          – I/We (*) hereby withdraw from the contract concluded by me/us (*) for the provision of the following service (*)
          <br />
          – Ordered on (*) / payment reference of the order (e.g. CH-…)
          <br />
          – Name of consumer(s)
          <br />
          – Email address of the account
          <br />
          – Date
          <br />
          (*) Delete as applicable.
        </p>
      </section>

      <section>
        <h2>§ 9 Defects and liability</h2>
        <p>
          Statutory rights in the event of defects apply. For paid extras we are liable without limitation for intent and gross negligence, for damage resulting from
          injury to life, body or health, and under the Product Liability Act. In cases of slight negligence we are only liable if an essential contractual obligation
          was breached – an obligation whose fulfilment makes the contract possible in the first place and on which you may regularly rely – and then limited to the
          foreseeable damage typical for the contract. We are liable for loss of data only to the extent that the damage would also have occurred if you had backed up
          your data properly. For the free services, § 6 of the <Link href={localePath('en', 'terms')}>General Terms and Conditions</Link> continues to apply.
        </p>
      </section>

      <section>
        <h2>§ 10 Final provisions</h2>
        <p>
          The law of the Federal Republic of Germany applies, excluding the UN Convention on Contracts for the International Sale of Goods; mandatory consumer protection
          provisions of the country in which you have your habitual residence remain unaffected. We are neither willing nor obliged to participate in dispute resolution
          proceedings before a consumer arbitration board. Should individual provisions be invalid, the validity of the remaining provisions remains unaffected.
        </p>
      </section>
    </>
  );
}
