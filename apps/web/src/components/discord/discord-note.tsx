import { ArrowUpRight } from 'lucide-react';
import type { Locale, PublicSiteDTO } from '@chfree/shared';
import { getDict } from '@/i18n';
import { cn } from '@/lib/utils';

/** Discord-Logo (einfarbig) */
export function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M20.32 4.37A19.8 19.8 0 0 0 15.43 2.86a.07.07 0 0 0-.08.04c-.21.37-.44.86-.6 1.25a18.3 18.3 0 0 0-5.5 0 12.6 12.6 0 0 0-.61-1.25.08.08 0 0 0-.08-.04 19.74 19.74 0 0 0-4.89 1.51.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.05 19.9 19.9 0 0 0 6 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-2a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1-.01-.12c.13-.1.25-.2.37-.29a.07.07 0 0 1 .08-.01c3.93 1.79 8.18 1.79 12.06 0a.07.07 0 0 1 .08.01c.12.1.25.2.37.3a.08.08 0 0 1 0 .12c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.77 1.37 1.22 2a.08.08 0 0 0 .09.03 19.84 19.84 0 0 0 6-3.03.08.08 0 0 0 .03-.05c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42Zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.22 0 2.18 1.1 2.16 2.42 0 1.34-.94 2.42-2.16 2.42Z" />
    </svg>
  );
}

/** Hinweis „Mitglied auf unserem Discord-Server“ – erscheint nur, wenn die Pflicht eingeschaltet ist */
export function DiscordRequiredNote({ site, lang, className }: { site: PublicSiteDTO; lang: Locale; className?: string }) {
  if (!site.discord.required) return null;
  const t = getDict(lang).discord;
  const text = site.discord.note[lang] || site.discord.note[lang === 'de' ? 'en' : 'de'] || t.noteText;
  const invite = site.discord.inviteUrl ?? site.brand.discordUrl;
  return (
    <div className={cn('flex flex-col gap-4 rounded-xl border border-[#5865f2]/35 bg-[#5865f2]/[0.08] p-5 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="flex gap-3.5">
        <DiscordIcon className="mt-0.5 size-6 shrink-0 text-[#8b93ff]" />
        <div>
          <p className="text-[15px] font-semibold text-white">{t.noteTitle}</p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{text}</p>
        </div>
      </div>
      {invite && (
        <a href={invite} target="_blank" rel="noopener" className="inline-flex h-9 shrink-0 items-center gap-1.5 self-start rounded-lg border border-line-strong bg-white/[0.03] px-3.5 text-sm font-medium text-white hover:bg-white/[0.07] sm:self-auto">
          {t.noteButton} <ArrowUpRight className="size-4" aria-hidden />
        </a>
      )}
    </div>
  );
}
