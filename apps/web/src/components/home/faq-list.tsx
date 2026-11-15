import { Plus } from 'lucide-react';

export interface FaqItem {
  q: string;
  a: string;
}

/** Akkordeon ohne JavaScript (details/summary) – barrierearm und gut für SEO. */
export function FaqList({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.q} className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-6 py-5 text-left">
            <h3 className="text-[15px] font-medium text-white sm:text-base">{item.q}</h3>
            <Plus className="size-4 shrink-0 text-subtle transition-transform duration-200 group-open:rotate-45" aria-hidden />
          </summary>
          <p className="-mt-1 pb-5 text-[15px] leading-relaxed text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
