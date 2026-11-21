'use client';

/**
 * Code in der Dokumentation: Kopfzeile mit Art (curl, JSON, SSE …), Kopier-Knopf und dezenter Hervorhebung
 * (Kommentare, Zeichenketten, Variablen, Adressen, HTTP-Methoden). Lange Zeilen scrollen waagerecht.
 */
import { useState, type ReactNode } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Art des Beispiels aus dem Inhalt ableiten */
export function codeKind(code: string): string {
  const t = code.trimStart();
  if (/^(curl|URL=|#)/m.test(t) && /curl /.test(t)) return 'curl';
  if (/^event: /m.test(t)) return 'SSE';
  if (/^(POST|GET|PUT|PATCH|DELETE) (\/|https?:\/\/)/.test(t)) return 'HTTP';
  if (t.startsWith('{') || t.startsWith('[') || /^"[^"]+"\s*:/.test(t)) return 'JSON';
  if (/^(\/\/|import |const |function )/m.test(t)) return 'JS';
  return 'Text';
}

const TOKEN = /("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\$\{?[A-Z_][A-Z0-9_]*\}?)|(https?:\/\/[^\s"'\\]+)|(-X\s+(?:GET|POST|PUT|PATCH|DELETE)\b)|(\b(?:true|false|null)\b)|(\b\d+(?:\.\d+)?\b)/g;

function highlightLine(line: string, kind: string, key: number): ReactNode {
  if (/^\s*#/.test(line) || (kind === 'JS' && /^\s*\/\//.test(line)))
    return (
      <span key={key} className="text-gray-500">
        {line}
      </span>
    );
  // Kommentar am Zeilenende (JavaScript): abtrennen und grau darstellen
  if (kind === 'JS') {
    const at = line.search(/\s\/\/\s/);
    if (at > 0 && !/["'`]/.test(line.slice(at))) {
      return (
        <span key={key}>
          {highlightLine(line.slice(0, at), kind, 0)}
          <span className="text-gray-500">{line.slice(at)}</span>
        </span>
      );
    }
  }
  // Server-Sent Events – auch innerhalb eines curl-Beispiels
  if (/^(event|data|id|retry):/.test(line)) {
    const [head, ...rest] = line.split(':');
    return (
      <span key={key}>
        <span className="text-violet-300">{head}:</span>
        {highlightLine(rest.join(':'), 'JSON', 0)}
      </span>
    );
  }
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) out.push(line.slice(last, i));
    const [all, str, variable, url, method, literal, num] = m;
    // In JSON sind Zeichenketten vor einem Doppelpunkt Schlüssel
    const isKey = str && str.startsWith('"') && /^\s*:/.test(line.slice(i + all.length));
    const cls = str ? (isKey ? 'text-sky-300' : 'text-amber-200') : variable ? 'text-violet-300' : url ? 'text-emerald-300' : method ? 'text-blue-300' : literal ? 'text-rose-300' : num && (kind === 'JSON' || kind === 'HTTP') ? 'text-orange-300' : '';
    out.push(
      cls ? (
        <span key={i} className={cls}>
          {all}
        </span>
      ) : (
        all
      ),
    );
    last = i + all.length;
  }
  if (last < line.length) out.push(line.slice(last));
  return <span key={key}>{out}</span>;
}

export function CopyButton({ value, label, className }: { value: string; label: { copy: string; copied: string }; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-subtle transition-colors hover:bg-white/[0.06] hover:text-white', className)}
      aria-label={done ? label.copied : label.copy}
    >
      {done ? <Check className="size-3.5 text-emerald-300" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {done ? label.copied : label.copy}
    </button>
  );
}

export function CodeBlock({ code, title, labels }: { code: string; title?: string; labels: { copy: string; copied: string } }) {
  const kind = codeKind(code);
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#070910]">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-white/[0.02] px-3.5 py-1.5">
        <span className="flex min-w-0 items-center gap-2 text-[12px]">
          <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] tracking-wide text-gray-300 uppercase">{kind}</span>
          {title && <span className="truncate text-subtle">{title}</span>}
        </span>
        <CopyButton value={code} label={labels} />
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed text-gray-200">
        <code>
          {code.split('\n').map((line, i, all) => (
            <span key={i}>
              {highlightLine(line, kind, i)}
              {i < all.length - 1 ? '\n' : ''}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
