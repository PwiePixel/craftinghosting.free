import Link from 'next/link';
import { localePath } from '@chfree/shared';
import { operator as o } from './operator';

function Address({ country }: { country: string }) {
  return (
    <>
      {o.owner}
      <br />
      {o.street}
      <br />
      {o.zipCity}
      <br />
      {country}
    </>
  );
}

function Contact({ phone, email }: { phone: string; email: string }) {
  return (
    <p>
      {phone}: {o.phone}
      <br />
      {email}: <a href={`mailto:${o.email}`}>{o.email}</a>
    </p>
  );
}

export function ImprintDe() {
  return (
    <>
      <section>
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>
          <strong className="text-white">{o.company}</strong>
          <br />
          <Address country={o.country.de} />
        </p>
      </section>

      <section>
        <h2>Kontakt</h2>
        <Contact phone="Telefon" email="E-Mail" />
      </section>

      <section>
        <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
        <p>
          <Address country={o.country.de} />
        </p>
      </section>

      <section>
        <h2>Haftung für Inhalte</h2>
        <p>
          Als Diensteanbieter ist CraftingHosting gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG ist
          CraftingHosting jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
          Tätigkeit hinweisen. Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt.
        </p>
      </section>

      <section>
        <h2>Haftung für Links</h2>
        <p>
          Trotz sorgfältiger inhaltlicher Kontrolle übernimmt CraftingHosting keine Haftung für die Inhalte externer Links. Für den Inhalt der verlinkten Seiten sind
          ausschließlich deren Betreiber verantwortlich.
        </p>
      </section>

      <section>
        <h2>Urheberrecht</h2>
        <p>
          Die durch CraftingHosting erstellten Inhalte und Werke auf dieser Website unterliegen dem deutschen Urheberrecht. Beiträge Dritter sind als solche gekennzeichnet. Die
          Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der vorherigen schriftlichen Zustimmung des
          jeweiligen Autors bzw. Erstellers.
        </p>
      </section>

      <section>
        <h2>Verbraucherstreitbeilegung</h2>
        <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
      </section>

      <section>
        <h2>Datenschutz</h2>
        <p>
          Beim Besuch dieser Website werden personenbezogene Daten verarbeitet. Alle Details findest du in unserer <Link href={localePath('de', 'privacy')}>Datenschutzerklärung</Link>.
        </p>
      </section>

      <section>
        <h2>Hinweis zum Angebot</h2>
        <p>
          Crafting Hosting bietet Minecraft-Hosting mit kostenlosen und kostenpflichtigen Paketen an. CraftingHosting.free (craftinghosting.free) ist das kostenlose Angebot von
          Crafting Hosting; Leistungen und Grenzen stehen in den <Link href={localePath('de', 'rules')}>Nutzungsbedingungen</Link>. Die Nutzung unterliegt diesen Bedingungen und
          dem geltenden Recht.
        </p>
      </section>
    </>
  );
}

export function ImprintEn() {
  return (
    <>
      <section>
        <h2>Information in accordance with § 5 DDG (German Digital Services Act)</h2>
        <p>
          <strong className="text-white">{o.company}</strong>
          <br />
          <Address country={o.country.en} />
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <Contact phone="Phone" email="Email" />
      </section>

      <section>
        <h2>Responsible for content according to § 18 (2) MStV (German Interstate Media Treaty)</h2>
        <p>
          <Address country={o.country.en} />
        </p>
      </section>

      <section>
        <h2>Liability for content</h2>
        <p>
          As a service provider, CraftingHosting is responsible for its own content on these pages according to § 7 para. 1 DDG under general laws. However, according to §§ 8 to
          10 DDG, CraftingHosting is not obligated to monitor transmitted or stored third-party information or to investigate circumstances indicating illegal activity.
          Obligations to remove or block the use of information under general laws remain unaffected.
        </p>
      </section>

      <section>
        <h2>Liability for links</h2>
        <p>
          Despite careful content control, CraftingHosting assumes no liability for the content of external links. The content of linked pages is the sole responsibility of
          their respective operators.
        </p>
      </section>

      <section>
        <h2>Copyright</h2>
        <p>
          The content and works created by CraftingHosting on this website are subject to German copyright law. Contributions from third parties are marked. Duplication,
          processing, distribution, or any form of commercialization beyond the limits of copyright law requires the prior written consent of the respective author or creator.
        </p>
      </section>

      <section>
        <h2>Consumer dispute resolution</h2>
        <p>We are neither willing nor obliged to participate in dispute resolution proceedings before a consumer arbitration board.</p>
      </section>

      <section>
        <h2>Privacy</h2>
        <p>
          Personal data is processed when you visit this website. For full details, please see our <Link href={localePath('en', 'privacy')}>privacy policy</Link>.
        </p>
      </section>

      <section>
        <h2>About this offer</h2>
        <p>
          Crafting Hosting provides Minecraft hosting with both free and paid plans. CraftingHosting.free (craftinghosting.free) is the free offer of Crafting Hosting; features
          and limits are listed in the <Link href={localePath('en', 'rules')}>terms of use</Link>. Use is subject to these terms and applicable law.
        </p>
      </section>
    </>
  );
}
