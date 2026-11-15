/**
 * Gründe für Abuse-Mails und die Abuse-Markierung eines Servers.
 * Eigenes Modul, weil sowohl der Admin-Bereich (Mail) als auch die Anzeige unter „Meine Server“ sie brauchen.
 */
import type { Localized } from '@chfree/shared';

/** Gründe für eine Abuse-Mail – Text in beiden Sprachen, der Empfänger bekommt seine Sprache */
export const ABUSE_REASONS: { id: string; label: string; title: Localized; text: Localized }[] = [
  {
    id: 'resources',
    label: 'Übermäßige Auslastung (CPU, RAM, Netzwerk)',
    title: { de: 'Hinweis: Dein Server belastet unsere Systeme zu stark', en: 'Notice: your server puts too much load on our systems' },
    text: {
      de: 'Uns ist aufgefallen, dass dein Server unsere Systeme dauerhaft über das faire Maß hinaus belastet. Die Ressourcen werden zwischen allen Nutzern geteilt.',
      en: 'We noticed that your server permanently puts more load on our systems than is fair. Resources are shared between all users.',
    },
  },
  {
    id: 'mining',
    label: 'Krypto-Mining',
    title: { de: 'Verstoß gegen die Regeln: Krypto-Mining', en: 'Rule violation: crypto mining' },
    text: { de: 'Auf deinem Server wurde Krypto-Mining festgestellt. Das ist auf CraftingHosting.free nicht erlaubt.', en: 'Crypto mining was detected on your server. This is not allowed on CraftingHosting.free.' },
  },
  {
    id: 'attacks',
    label: 'Angriffe, Spam, Portscans',
    title: { de: 'Verstoß gegen die Regeln: Angriffe oder Spam', en: 'Rule violation: attacks or spam' },
    text: {
      de: 'Von deinem Server gingen Angriffe, Spam oder Portscans aus. Das ist auf CraftingHosting.free nicht erlaubt.',
      en: 'Attacks, spam or port scans originated from your server. This is not allowed on CraftingHosting.free.',
    },
  },
  {
    id: 'content',
    label: 'Verbotene Inhalte',
    title: { de: 'Verstoß gegen die Regeln: unzulässige Inhalte', en: 'Rule violation: prohibited content' },
    text: { de: 'Auf deinem Server liegen Inhalte, die nach unseren Regeln nicht erlaubt sind.', en: 'Your server hosts content that is not allowed under our rules.' },
  },
  {
    id: 'multi',
    label: 'Mehrfach-Accounts',
    title: { de: 'Verstoß gegen die Regeln: mehrere Accounts', en: 'Rule violation: multiple accounts' },
    text: { de: 'Wir haben Hinweise darauf, dass du mehrere Accounts nutzt, um die Grenzen des kostenlosen Angebots zu umgehen.', en: 'We have indications that you use several accounts to get around the limits of the free offer.' },
  },
  {
    id: 'other',
    label: 'Sonstiger Verstoß (eigener Text)',
    title: { de: 'Hinweis zu einem Verstoß gegen unsere Regeln', en: 'Notice about a violation of our rules' },
    text: { de: '', en: '' },
  },
];

/** Überschrift eines Grundes für die Anzeige (unbekannte IDs → allgemeiner Text) */
export function abuseReasonTitle(id: string | null): Localized {
  return ABUSE_REASONS.find((r) => r.id === id)?.title ?? { de: 'Verstoß gegen unsere Regeln', en: 'Violation of our rules' };
}

export const abuseReasonLabel = (id: string | null): string => ABUSE_REASONS.find((r) => r.id === id)?.label ?? 'Regelverstoß';
