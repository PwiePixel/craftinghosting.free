'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Lässt den Inhalt der Maus folgen: Die Karte neigt sich leicht in Richtung des Zeigers
 * und ein Lichtschein wandert mit. Nur mit Maus/Trackpad und nur, wenn der Nutzer
 * Bewegungen nicht reduziert hat – auf Touch-Geräten bleibt alles ruhig.
 */
export function Tilt({ children, className, max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = outer.current;
    const card = inner.current;
    if (!el || !card) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    const apply = (rx: number, ry: number, gx: number, gy: number, active: boolean) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        card.style.transform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(0)`;
        card.style.setProperty('--tilt-x', `${gx.toFixed(1)}%`);
        card.style.setProperty('--tilt-y', `${gy.toFixed(1)}%`);
        card.style.setProperty('--tilt-glow', active ? '1' : '0');
      });
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      card.style.transition = 'transform 90ms ease-out';
      apply((0.5 - py) * 2 * max, (px - 0.5) * 2 * max, px * 100, py * 100, true);
    };
    const onLeave = () => {
      card.style.transition = 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1)';
      apply(0, 0, 50, 50, false);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [max]);

  return (
    <div ref={outer} className={cn('[perspective:1100px]', className)}>
      <div ref={inner} className="relative will-change-transform [transform-style:preserve-3d]">
        {children}
        {/* Lichtschein unter dem Zeiger */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-xl opacity-[var(--tilt-glow,0)] transition-opacity duration-300"
          style={{ background: 'radial-gradient(420px circle at var(--tilt-x, 50%) var(--tilt-y, 50%), rgba(96, 165, 250, 0.14), transparent 60%)' }}
        />
      </div>
    </div>
  );
}
