'use client';

/**
 * Weitere Abschnitte der Admin-Einstellungen: Regeln (Fair-Use, Laufzeit), Minecraft-Versionen, Links & Kontakt,
 * Newsletter, Hinweisleiste, Sperrliste und SEO/KI. Alles, was früher fest im Code stand, ist hier einstellbar.
 */
import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { defaultBrand, defaultRules, DISPOSABLE_EMAIL_DOMAINS, serverTypesOf, type SiteSettings } from '@chfree/shared';
import { Button } from '@/components/ui/button';
import { LogoSettings } from './admin-logo';
import { Labeled, NumberInput, Section, Toggle } from './admin-settings';
import { SoftwareCatalog } from './admin-software';

type Update = (fn: (prev: SiteSettings) => SiteSettings) => void;

/** Liste als Text (Komma oder Zeilenumbruch getrennt) – behält die Eingabe, solange getippt wird */
function ListArea({ value, onChange, rows = 4, placeholder, mono = true }: { value: string[]; onChange: (v: string[]) => void; rows?: number; placeholder?: string; mono?: boolean }) {
  const [text, setText] = useState(value.join('\n'));
  return (
    <textarea
      className={`input h-auto py-2.5 ${mono ? 'font-mono text-[13px]' : ''}`}
      rows={rows}
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(
          e.target.value
            .split(/[\n,;]+/)
            .map((x) => x.trim())
            .filter(Boolean),
        );
      }}
    />
  );
}

function TextInput({ value, onChange, placeholder, maxLength = 500, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; type?: string }) {
  return <input type={type} className="input" value={value} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

function Bilingual({
  value,
  onChange,
  rows,
  maxLength,
  placeholder,
}: {
  value: { de: string; en: string };
  onChange: (v: { de: string; en: string }) => void;
  rows?: number;
  maxLength: number;
  placeholder?: { de: string; en: string };
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {(['de', 'en'] as const).map((l) => (
        <div key={l}>
          <span className="mb-1 block text-[12px] text-subtle">{l === 'de' ? 'Deutsch' : 'Englisch'}</span>
          {rows ? (
            <textarea
              className="input h-auto py-2.5"
              rows={rows}
              value={value[l]}
              maxLength={maxLength}
              placeholder={placeholder?.[l]}
              onChange={(e) => onChange({ ...value, [l]: e.target.value })}
            />
          ) : (
            <input className="input" value={value[l]} maxLength={maxLength} placeholder={placeholder?.[l]} onChange={(e) => onChange({ ...value, [l]: e.target.value })} />
          )}
        </div>
      ))}
    </div>
  );
}

export function MoreSettings({ s, update }: { s: SiteSettings; update: Update }) {
  const f = s.rules.fairUse;
  const c = s.rules.cycle;
  const setFair = (v: Partial<typeof f>) => update((p) => ({ ...p, rules: { ...p.rules, fairUse: { ...p.rules.fairUse, ...v } } }));
  const setCycle = (v: Partial<typeof c>) => update((p) => ({ ...p, rules: { ...p.rules, cycle: { ...p.rules.cycle, ...v } } }));
  const brandDefaults = defaultBrand();
  const setBrand = (v: Partial<SiteSettings['brand']>) => update((p) => ({ ...p, brand: { ...p.brand, ...v } }));

  return (
    <>
      <LogoSettings mode={s.branding.logoMode} onMode={(logoMode) => update((p) => ({ ...p, branding: { ...p.branding, logoMode } }))} />

      <Section
        title="Regeln: Fair-Use (Minecraft) & Laufzeit"
        description="Diese Werte standen früher fest im Code. Sie gelten sofort für die automatischen Abläufe (Stopps, Pausen, Erinnerungen, Löschungen) und erscheinen überall auf der Website, in den Nutzungsbedingungen, E-Mails und Chat-Hinweisen. Bestehende Server behalten ihr aktuelles Ablaufdatum; eine neue Laufzeit gilt ab der nächsten Verlängerung."
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Labeled label="Laufzeit am Stück (Stunden)" hint="Danach stoppt der Server automatisch.">
            <NumberInput value={f.maxSessionHours} min={1} max={167} onChange={(v) => setFair({ maxSessionHours: v })} />
          </Labeled>
          <Labeled label="Pause danach (Minuten)" hint="So lange lässt er sich nicht wieder starten.">
            <NumberInput value={f.cooldownMinutes} min={0} max={1440} onChange={(v) => setFair({ cooldownMinutes: v })} />
          </Labeled>
          <Labeled label="Offline pro Woche (Stunden)" hint="0 = keine Pflicht-Offline-Zeit.">
            <NumberInput value={f.weeklyOfflineHours} min={0} max={160} onChange={(v) => setFair({ weeklyOfflineHours: v })} />
          </Labeled>
          <Labeled label="Vorwarnung Laufzeit (Minuten)" hint="E-Mail so lange vor dem automatischen Stopp.">
            <NumberInput value={f.sessionWarningMinutes} min={5} max={720} onChange={(v) => setFair({ sessionWarningMinutes: v })} />
          </Labeled>
          <Labeled label="Vorwarnung Wochenregel (Stunden)" hint="E-Mail, bevor die Offline-Zeit knapp wird.">
            <NumberInput value={f.weeklyOfflineWarningHours} min={1} max={72} onChange={(v) => setFair({ weeklyOfflineWarningHours: v })} />
          </Labeled>
          <div />
          <Labeled label="Laufzeit eines Servers (Tage)" hint="Danach wird er suspendiert und kann verlängert werden.">
            <NumberInput value={c.days} min={1} max={365} onChange={(v) => setCycle({ days: v })} />
          </Labeled>
          <Labeled label="Erinnerungen (Tage vor Ablauf)" hint="Mit Komma getrennt, z. B. 3, 1">
            <input
              className="input max-w-[200px]"
              defaultValue={c.reminderDaysBefore.join(', ')}
              onChange={(e) =>
                setCycle({
                  reminderDaysBefore: e.target.value
                    .split(/[,\s]+/)
                    .map(Number)
                    .filter((n) => Number.isInteger(n) && n > 0),
                })
              }
            />
          </Labeled>
          <Labeled label="Ruhezeit nach Ablauf (Stunden)" hint="24 = ein Ruhetag · 0 = sofort verlängerbar.">
            <NumberInput value={Math.round(c.reactivationCooldownMinutes / 60)} min={0} max={720} onChange={(v) => setCycle({ reactivationCooldownMinutes: v * 60 })} />
          </Labeled>
          <Labeled label="Löschung nach der Ruhezeit (Stunden)" hint="Ohne Verlängerung wird der Server danach gelöscht. 0 = nie löschen.">
            <NumberInput value={c.deleteAfterRestHours} min={0} max={8760} onChange={(v) => setCycle({ deleteAfterRestHours: v })} />
          </Labeled>
          <Labeled label="Erinnerung vor der Löschung (Stunden)">
            <NumberInput value={c.deleteReminderHours} min={1} max={720} onChange={(v) => setCycle({ deleteReminderHours: v })} />
          </Labeled>
        </div>
        <Button type="button" variant="secondary" size="sm" icon={<RotateCcw />} onClick={() => update((p) => ({ ...p, rules: defaultRules() }))}>
          Standardwerte wiederherstellen
        </Button>
      </Section>

      <SoftwareCatalog s={s} update={update} />

      <Section
        title="Minecraft-Versionen"
        description="Welche Versionen im Bestellformular wählbar sind – je Servertyp, eine Version pro Zeile (oder mit Komma getrennt). „latest“ steht für die neueste Version des Eggs. Die erste Zeile ist die Vorauswahl, wenn die Standardversion nicht in der Liste steht. Leer = Standardliste."
      >
        <div className="grid gap-5 md:grid-cols-2">
          {s.software.map((item) => {
            // Fest hinterlegte Liste (nur als Rückfall) – eigene Einträge haben keine
            const t = { id: item.id, name: item.name, versions: serverTypesOf('minecraft').find((x) => x.id === item.id)?.versions ?? ['latest'] };
            const custom = s.versions[t.id];
            return (
              <Labeled key={t.id} label={t.name} hint={custom ? `${custom.length} eigene Versionen – genau diese werden angeboten` : 'Automatisch: alle veröffentlichten Versionen (die Liste hier ist nur der Rückfall, falls das Verzeichnis nicht erreichbar ist)'}>
                <ListArea
                  key={`${t.id}-${custom ? 'custom' : 'default'}`}
                  value={custom ?? t.versions}
                  rows={5}
                  onChange={(v) =>
                    update((p) => {
                      const versions = { ...p.versions };
                      if (v.length) versions[t.id] = v;
                      else delete versions[t.id];
                      return { ...p, versions };
                    })
                  }
                />
              </Labeled>
            );
          })}
        </div>
        <Button type="button" variant="secondary" size="sm" icon={<RotateCcw />} onClick={() => update((p) => ({ ...p, versions: {} }))}>
          Alle Standardlisten wiederherstellen
        </Button>
      </Section>

      <Section
        title="Links & Kontakt"
        description="Discord-Einladung, Support-Adresse und die Links zur Hauptmarke – erscheinen auf der Website, in E-Mails und in den strukturierten Daten für Suchmaschinen. Leer = Standardwert (grau angezeigt)."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Labeled label="Discord-Einladung">
            <TextInput type="url" value={s.brand.discordUrl} placeholder={brandDefaults.discordUrl} onChange={(v) => setBrand({ discordUrl: v })} />
          </Labeled>
          <Labeled label="Support-E-Mail">
            <TextInput type="email" value={s.brand.supportEmail} maxLength={254} placeholder={brandDefaults.supportEmail} onChange={(v) => setBrand({ supportEmail: v })} />
          </Labeled>
          <Labeled label="Website der Hauptmarke">
            <TextInput type="url" value={s.brand.parentUrl} placeholder={brandDefaults.parentUrl} onChange={(v) => setBrand({ parentUrl: v })} />
          </Labeled>
          <Labeled label="Preisseite (Premium-Angebote)">
            <TextInput type="url" value={s.brand.parentPricingUrl} placeholder={brandDefaults.parentPricingUrl} onChange={(v) => setBrand({ parentPricingUrl: v })} />
          </Labeled>
          <Labeled label="Externe Statusseite" hint="Nur als Link – die eingebaute Statusseite bleibt unter /status.">
            <TextInput type="url" value={s.brand.statusUrl} placeholder={brandDefaults.statusUrl} onChange={(v) => setBrand({ statusUrl: v })} />
          </Labeled>
        </div>
        <p className="text-[13px] text-subtle">Links müssen mit http:// oder https:// beginnen – ungültige Eingaben werden beim Speichern verworfen.</p>
      </Section>

      <Section
        title="Newsletter"
        description="Anmeldung mit Bestätigungslink (Double-Opt-in), Abmeldung per Link in jeder E-Mail. Ausgaben schreibst und versendest du im Tab „Newsletter“."
      >
        <Toggle checked={s.newsletter.enabled} onChange={(v) => update((p) => ({ ...p, newsletter: { ...p.newsletter, enabled: v } }))} label="Newsletter aktiv" hint="Aus = keine neuen Anmeldungen; die Seite /newsletter zeigt einen Hinweis." />
        <Toggle checked={s.newsletter.footerForm} onChange={(v) => update((p) => ({ ...p, newsletter: { ...p.newsletter, footerForm: v } }))} label="Anmeldeformular im Footer jeder Seite" />
        <Toggle
          checked={s.newsletter.signupCheckbox}
          onChange={(v) => update((p) => ({ ...p, newsletter: { ...p.newsletter, signupCheckbox: v } }))}
          label="Häkchen „Newsletter abonnieren“ beim Erstellen eines Servers"
          hint="Freiwillig und nie vorangekreuzt. Die Anmeldung wird mit der Bestätigung der E-Mail-Adresse aktiv."
        />
        <Labeled label="Versandgeschwindigkeit (E-Mails pro Minute)" hint="Richtet sich nach deinem Mailserver. 60 ist für die meisten Postfächer unkritisch.">
          <NumberInput value={s.newsletter.ratePerMinute} min={1} max={600} onChange={(v) => update((p) => ({ ...p, newsletter: { ...p.newsletter, ratePerMinute: v } }))} />
        </Labeled>
      </Section>

      <Section title="Hinweisleiste" description="Schmale Leiste ganz oben auf jeder Seite – für Ankündigungen wie neue Pakete, Wartungen oder Aktionen.">
        <Toggle checked={s.announcement.enabled} onChange={(v) => update((p) => ({ ...p, announcement: { ...p.announcement, enabled: v } }))} label="Hinweisleiste anzeigen" />
        <Labeled label="Text" hint="Fehlt eine Sprache, wird die andere angezeigt.">
          <Bilingual
            value={s.announcement.text}
            maxLength={300}
            placeholder={{ de: 'z. B. Neu: Discord-Bot-Hosting ist da!', en: 'e.g. New: Discord bot hosting is here!' }}
            onChange={(text) => update((p) => ({ ...p, announcement: { ...p.announcement, text } }))}
          />
        </Labeled>
        <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
          <Labeled label="Link (optional)">
            <TextInput type="url" value={s.announcement.linkUrl} placeholder="https://…" onChange={(v) => update((p) => ({ ...p, announcement: { ...p.announcement, linkUrl: v } }))} />
          </Labeled>
          <Labeled label="Farbe">
            <select
              className="input"
              value={s.announcement.tone}
              onChange={(e) => update((p) => ({ ...p, announcement: { ...p.announcement, tone: e.target.value as SiteSettings['announcement']['tone'] } }))}
            >
              <option value="info">Blau (Info)</option>
              <option value="success">Grün (gute Nachricht)</option>
              <option value="warning">Gelb (Achtung)</option>
            </select>
          </Labeled>
        </div>
        <Labeled label="Beschriftung des Links (optional)">
          <Bilingual value={s.announcement.linkLabel} maxLength={60} placeholder={{ de: 'Mehr erfahren', en: 'Learn more' }} onChange={(linkLabel) => update((p) => ({ ...p, announcement: { ...p.announcement, linkLabel } }))} />
        </Labeled>
      </Section>

      <Section
        title="Sperrliste"
        description="E-Mail-Adressen und -Domains, die sich nicht registrieren und keinen Newsletter abonnieren können. Bestehende Konten bleiben unberührt – die sperrst du unter „Nutzer“."
      >
        <Toggle
          checked={s.blocklist.disposable}
          onChange={(v) => update((p) => ({ ...p, blocklist: { ...p.blocklist, disposable: v } }))}
          label="Wegwerf-Adressen ablehnen"
          hint={`Eingebaute Liste mit ${DISPOSABLE_EMAIL_DOMAINS.length} bekannten Anbietern (z. B. mailinator.com, yopmail.com). Weitere trägst du unten ein.`}
        />
        <div className="grid gap-5 md:grid-cols-2">
          <Labeled label="Gesperrte Domains" hint="Eine pro Zeile, z. B. example.org – Subdomains sind mit gesperrt.">
            <ListArea value={s.blocklist.emailDomains} placeholder="example.org" onChange={(v) => update((p) => ({ ...p, blocklist: { ...p.blocklist, emailDomains: v.map((x) => x.toLowerCase()) } }))} />
          </Labeled>
          <Labeled label="Gesperrte E-Mail-Adressen" hint="Eine pro Zeile.">
            <ListArea value={s.blocklist.emails} placeholder="jemand@example.org" onChange={(v) => update((p) => ({ ...p, blocklist: { ...p.blocklist, emails: v.map((x) => x.toLowerCase()) } }))} />
          </Labeled>
        </div>
      </Section>

      <Section
        title="Suchmaschinen & KI-Assistenten"
        description={
          <>
            Titel und Beschreibung der Startseite für Google & Co. sowie die Kurzbeschreibung, die KI-Assistenten (ChatGPT, Claude, Perplexity …) unter{' '}
            <a href="/llms.txt" target="_blank" rel="noopener" className="text-blue-400 hover:text-blue-300">
              /llms.txt
            </a>{' '}
            lesen. Pakete, Plätze, Regeln und Standorte werden dort automatisch aus deinen Einstellungen ergänzt – so widersprechen sich die Angaben nie. Leer = Standardtexte.
          </>
        }
      >
        <Toggle
          checked={s.seo.indexing}
          onChange={(v) => update((p) => ({ ...p, seo: { ...p.seo, indexing: v } }))}
          label="Website für Suchmaschinen und KI-Crawler freigeben"
          hint="Aus = noindex auf allen Seiten und Sperre in der robots.txt (z. B. solange die Seite noch nicht fertig ist)."
        />
        <Labeled label="Seitentitel der Startseite" hint="Höchstens ca. 60 Zeichen werden in Suchergebnissen angezeigt.">
          <Bilingual value={s.seo.title} maxLength={90} onChange={(title) => update((p) => ({ ...p, seo: { ...p.seo, title } }))} />
        </Labeled>
        <Labeled label="Beschreibung (Meta-Description)" hint="Ein bis zwei Sätze, ca. 150 Zeichen.">
          <Bilingual value={s.seo.description} rows={3} maxLength={220} onChange={(description) => update((p) => ({ ...p, seo: { ...p.seo, description } }))} />
        </Labeled>
        <Labeled label="Kurzbeschreibung für KI-Assistenten" hint="Was ist CraftingHosting.free – in deinen Worten. Sachlich bleiben: Was hier steht, geben Assistenten als Antwort weiter.">
          <Bilingual value={s.seo.summary} rows={5} maxLength={1200} onChange={(summary) => update((p) => ({ ...p, seo: { ...p.seo, summary } }))} />
        </Labeled>
      </Section>
    </>
  );
}
