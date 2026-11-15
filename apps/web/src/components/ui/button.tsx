import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400/70 disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0';

const variants: Record<Variant, string> = {
  primary: 'bg-blue-600 text-white hover:bg-blue-500',
  secondary: 'border border-line-strong bg-white/[0.03] text-white hover:bg-white/[0.07]',
  ghost: 'text-muted hover:text-white',
  danger: 'border border-red-400/30 text-red-300 hover:bg-red-400/10',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm [&_svg]:size-4',
  md: 'h-11 px-5 text-[15px] [&_svg]:size-4',
  lg: 'h-12 px-6 text-base [&_svg]:size-[18px]',
};

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

interface ButtonProps extends ComponentProps<'button'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', loading, icon, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button className={buttonClasses(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

interface ButtonLinkProps extends Omit<ComponentProps<typeof Link>, 'className'> {
  variant?: Variant;
  size?: Size;
  className?: string;
  external?: boolean;
}

export function ButtonLink({ variant = 'primary', size = 'md', className, external, href, children, ...props }: ButtonLinkProps) {
  if (external) {
    return (
      <a href={String(href)} target="_blank" rel="noopener noreferrer" className={buttonClasses(variant, size, className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClasses(variant, size, className)} {...props}>
      {children}
    </Link>
  );
}
