/**
 * Discord-Karte (Konto-Seite; auf „Meine Server“ nur, wenn etwas zu tun ist): verbinden, Mitgliedschaft prüfen,
 * Verknüpfung lösen
 */
import { ArrowUpRight } from 'lucide-react';
import type { DiscordMeDTO, Locale } from '@chfree/shared';
import { DiscordIcon } from '@/components/discord/discord-note';
import { DiscordRecheck, DiscordUnlink } from '@/components/my/client-bits';
import { buttonClasses } from '@/components/ui/button';
import { getDict } from '@/i18n';

export function DiscordCard({ me, lang, inviteUrl, autoJoin, note, waiting, back = 'myServers' }: { me: DiscordMeDTO; lang: Locale; inviteUrl: string | null; autoJoin: boolean; note: string; waiting: boolean; back?: 'myServers' | 'account' }) {
  const t = getDict(lang).discord;
  // Nach Discord zurück auf die Seite, von der aus verbunden wurde
  const connectHref = `/api/v1/discord/connect?lang=${lang}${back === 'account' ? '&back=account' : ''}`;
  const attention = me.blocked !== null;
  const title = !me.linked ? (me.required ? t.requiredTitle : t.cardTitle) : me.blocked === 'not_member' ? t.notMemberTitle : t.connectedAs(me.linked.username);
  const text = !me.linked
    ? me.required
      ? note || t.requiredText
      : t.optionalText
    : me.blocked === 'not_member'
      ? t.notMemberText
      : me.blocked === 'unavailable'
        ? t.unavailableText
        : t.connectedText;
  return (
    <div className={`surface p-5 ${attention ? 'border-[#5865f2]/50' : ''}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3.5">
          <DiscordIcon className="mt-0.5 size-5 shrink-0 text-[#8b93ff]" />
          <div>
            <p className="text-[15px] font-semibold text-white">{title}</p>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted">{text}</p>
            {waiting && attention && <p className="mt-2 text-sm text-amber-300">{t.pendingBlocked}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!me.linked ? (
            // Normaler Link: Die API leitet zu Discord weiter
            <a href={connectHref} className={buttonClasses('primary', 'sm')}>
              {t.connect}
            </a>
          ) : me.blocked ? (
            <>
              {/* Kein Mitglied (mehr): Neu verbinden tritt automatisch bei – der Einladungslink nur, wenn das ausgeschaltet ist */}
              {me.blocked === 'not_member' && autoJoin && (
                <a href={connectHref} className={buttonClasses('primary', 'sm')}>
                  {t.connect}
                </a>
              )}
              {me.blocked === 'not_member' && !autoJoin && inviteUrl && (
                <a href={inviteUrl} target="_blank" rel="noopener" className={buttonClasses('primary', 'sm')}>
                  {t.join} <ArrowUpRight aria-hidden />
                </a>
              )}
              <DiscordRecheck />
            </>
          ) : (
            <DiscordUnlink />
          )}
        </div>
      </div>
    </div>
  );
}
