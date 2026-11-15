import { ArrowRight } from 'lucide-react';
import { tr, type Locale, type PublicSiteDTO } from '@chfree/shared';
import { cn } from '@/lib/utils';

const tones = {
  info: 'border-blue-500/25 bg-blue-500/[0.09] text-blue-100',
  success: 'border-emerald-400/25 bg-emerald-400/[0.09] text-emerald-100',
  warning: 'border-amber-400/30 bg-amber-400/[0.1] text-amber-100',
};

/** Hinweisleiste oben auf jeder Seite – Text, Farbe und Link kommen aus dem Admin-Bereich. */
export function AnnouncementBar({ announcement, lang }: { announcement: PublicSiteDTO['announcement']; lang: Locale }) {
  if (!announcement) return null;
  const text = tr(announcement.text, lang) || announcement.text.de || announcement.text.en;
  if (!text) return null;
  const label = tr(announcement.linkLabel, lang) || announcement.linkLabel.de || announcement.linkLabel.en;
  return (
    <div className={cn('border-b text-sm', tones[announcement.tone])} role="status">
      <div className="container-page flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-2.5 text-center">
        <span>{text}</span>
        {announcement.linkUrl && (
          <a href={announcement.linkUrl} className="inline-flex items-center gap-1 font-medium text-white underline underline-offset-4 hover:no-underline">
            {label || announcement.linkUrl.replace(/^https?:\/\//, '')} <ArrowRight className="size-3.5" aria-hidden />
          </a>
        )}
      </div>
    </div>
  );
}
