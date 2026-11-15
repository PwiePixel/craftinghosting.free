import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const map = {
    info: { cls: 'border-blue-500/25 bg-blue-500/[0.07]', icon: Info, iconCls: 'text-blue-400' },
    success: { cls: 'border-emerald-400/25 bg-emerald-400/[0.07]', icon: CircleCheck, iconCls: 'text-emerald-400' },
    warning: { cls: 'border-amber-400/25 bg-amber-400/[0.07]', icon: TriangleAlert, iconCls: 'text-amber-400' },
    error: { cls: 'border-red-400/25 bg-red-400/[0.07]', icon: CircleAlert, iconCls: 'text-red-400' },
  }[tone];
  const Icon = map.icon;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', map.cls, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', map.iconCls)} aria-hidden />
      <div className="leading-relaxed text-muted">
        {title && <p className="font-medium text-white">{title}</p>}
        {children}
      </div>
    </div>
  );
}

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-gray-200">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1.5 text-sm text-red-400">{error}</p> : hint ? <p className="mt-1.5 text-[13px] text-subtle">{hint}</p> : null}
    </div>
  );
}

export function StatusDot({ tone }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' }) {
  const c = { green: 'bg-emerald-400', amber: 'bg-amber-400', red: 'bg-red-400', blue: 'bg-blue-400', gray: 'bg-gray-500' }[tone];
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', c)} aria-hidden />;
}

export function SectionHead({ label, title, children, className }: { label: string; title: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="label">{label}</p>
      <h2 className="h2 mt-3">{title}</h2>
      {children && <p className="lead mt-4">{children}</p>}
    </div>
  );
}
