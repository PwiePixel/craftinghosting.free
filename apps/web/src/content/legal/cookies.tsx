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

export function CookiesDe() {
  return (
    <>
      <section>
        <h2>Kurz gesagt</h2>
        <p>
          CraftingHosting.free verwendet ausschließlich technisch notwendige Cookies. Es gibt kein Tracking, keine Analyse- und keine Marketing-Cookies. Deshalb zeigen wir kein
          Cookie-Banner (§ 25 Abs. 2 Nr. 2 TDDDG). Sollten wir jemals Analyse-Werkzeuge einsetzen, fragen wir vorher ausdrücklich nach deiner Einwilligung.
        </p>
      </section>
      <section>
        <h2>Verwendete Cookies</h2>
        <CookieTable
          head={['Name', 'Zweck', 'Speicherdauer']}
          rows={[
            ['chf_session', 'Hält dich nach dem Login angemeldet (HttpOnly, Secure, SameSite=Lax)', 'bis zum Schließen des Browsers, spätestens 30 Minuten nach der letzten Aktivität bzw. 12 Stunden nach der Anmeldung'],
            ['chf_lang', 'Speichert deine Sprachwahl – wird nur gesetzt, wenn du die Sprache umschaltest', '12 Monate'],
          ]}
        />
      </section>
      <section>
        <h2>Lokaler Speicher</h2>
        <p>Die Website speichert keine Daten im LocalStorage oder SessionStorage deines Browsers.</p>
      </section>
    </>
  );
}

export function CookiesEn() {
  return (
    <>
      <section>
        <h2>In short</h2>
        <p>
          CraftingHosting.free only uses technically necessary cookies. There is no tracking and there are no analytics or marketing cookies. That is why we do not show a
          cookie banner (§ 25 (2) no. 2 TDDDG). Should we ever use analytics tools, we will explicitly ask for your consent first.
        </p>
      </section>
      <section>
        <h2>Cookies used</h2>
        <CookieTable
          head={['Name', 'Purpose', 'Duration']}
          rows={[
            ['chf_session', 'Keeps you signed in after login (HttpOnly, Secure, SameSite=Lax)', 'until you close the browser, at the latest 30 minutes after your last activity or 12 hours after signing in'],
            ['chf_lang', 'Stores your language choice – only set when you switch the language', '12 months'],
          ]}
        />
      </section>
      <section>
        <h2>Local storage</h2>
        <p>The website does not store any data in your browser’s localStorage or sessionStorage.</p>
      </section>
    </>
  );
}
