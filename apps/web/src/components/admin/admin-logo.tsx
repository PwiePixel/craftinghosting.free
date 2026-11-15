'use client';

/**
 * Admin → Einstellungen → Logo: eigenes Logo hochladen, ansehen, entfernen.
 * Das Bild wird sofort gespeichert (nicht erst mit „Speichern“) und erscheint in Kopf- und Fußzeile der Website.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { PublicSiteDTO } from '@chfree/shared';
import { CubeMark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';
import { Labeled, Section } from './admin-settings';

const MAX_BYTES = 512 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;,]*;base64,/, ''));
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    reader.readAsDataURL(file);
  });
}

export function LogoSettings({ mode, onMode }: { mode: 'icon' | 'full'; onMode: (m: 'icon' | 'full') => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [logo, setLogo] = useState<PublicSiteDTO['logo']>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api<{ site: PublicSiteDTO }>('/site');
      setLogo(res.site.logo);
    } catch {
      /* Vorschau bleibt, wie sie ist */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setNote(null);
    if (file.size > MAX_BYTES) {
      setNote({ ok: false, text: `Die Datei ist zu groß (${Math.round(file.size / 1024)} KB) – höchstens 512 KB.` });
      return;
    }
    setBusy(true);
    try {
      await api('/admin/logo', { body: { data: await readAsBase64(file) } });
      setNote({ ok: true, text: 'Logo gespeichert – es erscheint in wenigen Sekunden auf der Website.' });
      await load();
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof ApiClientError ? err.message : 'Upload fehlgeschlagen.' });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  async function remove() {
    if (!window.confirm('Logo entfernen? Die Website zeigt dann wieder den Würfel.')) return;
    setBusy(true);
    setNote(null);
    try {
      await api('/admin/logo/delete', { body: {} });
      setLogo(null);
      setNote({ ok: true, text: 'Logo entfernt.' });
      router.refresh();
    } catch (err) {
      setNote({ ok: false, text: err instanceof ApiClientError ? err.message : 'Entfernen fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title="Logo"
      description="Eigenes Logo für Kopf- und Fußzeile der Website. Erlaubt sind PNG, JPG, WebP und SVG bis 512 KB – am besten mit transparentem Hintergrund (die Website ist dunkel). Ohne eigenes Logo zeigt die Website den Würfel."
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex h-20 w-full max-w-xs items-center justify-center rounded-lg border border-line bg-background px-5">
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- Vorschau aus der eigenen API
            <img src={logo.url} alt="Aktuelles Logo" className="max-h-12 w-auto max-w-full object-contain" />
          ) : (
            <span className="flex items-center gap-2.5 text-sm text-muted">
              <CubeMark /> Standard-Bildmarke
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            aria-label="Logo-Datei auswählen"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          <Button type="button" icon={<Upload />} loading={busy} onClick={() => input.current?.click()}>
            {logo ? 'Anderes Logo hochladen' : 'Logo hochladen'}
          </Button>
          {logo && (
            <Button type="button" variant="ghost" icon={<Trash2 />} disabled={busy} onClick={() => void remove()}>
              Entfernen
            </Button>
          )}
        </div>
      </div>
      {note && <p className={note.ok ? 'text-sm text-emerald-300' : 'text-sm text-red-300'}>{note.text}</p>}
      <Labeled label="Darstellung" hint="Diese Auswahl wird mit „Speichern“ unten übernommen.">
        <select className="input max-w-md" value={mode} onChange={(e) => onMode(e.target.value as 'icon' | 'full')}>
          <option value="icon">Bildmarke: Logo ersetzt den Würfel, der Schriftzug „Crafting Hosting“ bleibt</option>
          <option value="full">Vollständiges Logo: ersetzt Würfel und Schriftzug</option>
        </select>
      </Labeled>
    </Section>
  );
}
