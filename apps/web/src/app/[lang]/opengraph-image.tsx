import { ImageResponse } from 'next/og';
import { isLocale, locales } from '@chfree/shared';
import { getDict } from '@/i18n';

export const alt = 'CraftingHosting.free';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export default async function OpengraphImage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  const t = getDict(isLocale(lang) ? lang : 'de').meta;
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px',
          background: 'linear-gradient(135deg, #0b0d14 0%, #111a33 55%, #1b1a45 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <path d="M16 2.5 28 9.25 16 16 4 9.25Z" fill="#7fb4fb" />
            <path d="M4 9.25 16 16v13.5L4 22.75Z" fill="#2f6fed" />
            <path d="M28 9.25 16 16v13.5l12-6.75Z" fill="#1d4ed8" />
          </svg>
          <div style={{ display: 'flex', fontSize: 34, color: '#9ca3af' }}>A CraftingHosting Service</div>
        </div>
        <div style={{ display: 'flex', marginTop: 40, fontSize: 92, fontWeight: 800, letterSpacing: -2 }}>
          craftinghosting<span style={{ color: '#60a5fa' }}>.free</span>
        </div>
        <div style={{ display: 'flex', marginTop: 24, fontSize: 44, color: '#d1d5db' }}>{t.ogTagline}</div>
        <div style={{ display: 'flex', gap: 16, marginTop: 48 }}>
          {t.ogChips.map((chip) => (
            <div key={chip} style={{ display: 'flex', padding: '10px 22px', borderRadius: 999, border: '2px solid rgba(96,165,250,0.4)', color: '#bfdbfe', fontSize: 26 }}>
              {chip}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
