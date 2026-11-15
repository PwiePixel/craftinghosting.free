import { describe, expect, it } from 'vitest';
import { normalizeSiteSettings } from './settings';
import { defaultStatusSettings, normalizeStatusSettings, rangeStateFor, statusCategory } from './status-settings';

describe('Statusseite – Einstellungen', () => {
  it('liefert ohne Angaben die eingebauten Gruppen und Komponenten', () => {
    const s = normalizeStatusSettings(undefined);
    expect(s).toEqual(defaultStatusSettings());
    expect(s.components.map((c) => c.id)).toEqual(['freehosting', 'website', 'api', 'pterodactyl', 'nodes']);
    expect(s.page.days).toBe(90);
    expect(normalizeSiteSettings({}).status).toEqual(s);
  });

  it('übernimmt alte Einstellungen, die nur einen festen Status kannten', () => {
    const s = normalizeStatusSettings({ overrides: { nodes: 'maintenance', gibtsnicht: 'degraded', api: 'auto' } });
    expect(s.overrides).toEqual({ nodes: 'maintenance' });
    expect(s.components).toHaveLength(5);
  });

  it('prüft eigene Gruppen und Komponenten', () => {
    const s = normalizeStatusSettings({
      page: { days: 500, colors: { operational: '#00FF00', outage: 'rot' }, labels: { operational: { de: 'Läuft', en: '' } } },
      groups: [{ name: { de: 'Netzwerk', en: 'Network' }, icon: 'network' }, { name: { de: '' } }],
      components: [
        { name: { de: 'DDoS Protection' }, group: 'netzwerk', source: 'manual', operationalLabel: { de: 'Aktiv', en: 'Active' } },
        { name: { de: 'DDoS Protection' }, group: 'unbekannt', source: 'node', target: 7 },
        { id: 'overall', name: { de: 'Gesamt' }, source: 'http', target: 'javascript:alert(1)' },
        { name: { de: 'Panel' }, source: 'http', target: 'https://panel.example.com/health' },
        { name: { de: '' } },
      ],
    });
    expect(s.page.days).toBe(90);
    expect(s.page.colors.operational).toBe('#00ff00');
    expect(s.page.colors.outage).toBe(defaultStatusSettings().page.colors.outage);
    expect(s.page.labels.operational).toEqual({ de: 'Läuft', en: 'Operational' });
    expect(s.groups).toEqual([{ id: 'netzwerk', name: { de: 'Netzwerk', en: 'Network' }, icon: 'network' }]);
    expect(s.components.map((c) => [c.id, c.group, c.source, c.target])).toEqual([
      ['ddos-protection', 'netzwerk', 'manual', ''],
      ['ddos-protection-2', 'netzwerk', 'node', '7'],
      ['overall-1', 'netzwerk', 'http', ''],
      ['panel', 'netzwerk', 'http', 'https://panel.example.com/health'],
    ]);
    expect(s.components[0]!.operationalLabel).toEqual({ de: 'Aktiv', en: 'Active' });
  });

  it('erlaubt eine leere Komponentenliste, aber nie eine Seite ohne Gruppe', () => {
    const s = normalizeStatusSettings({ groups: [], components: [] });
    expect(s.components).toEqual([]);
    expect(s.groups).toEqual(defaultStatusSettings().groups);
  });

  it('behält nur gültige Korrekturen am Verlauf', () => {
    const now = Date.parse('2026-06-30T12:00:00Z');
    const s = normalizeStatusSettings(
      { history: { api: { '2026-06-29': 'outage', '2025-01-01': 'outage', heute: 'degraded', '2026-06-28': 'kaputt' }, fremd: { '2026-06-29': 'outage' } } },
      now,
    );
    expect(s.history).toEqual({ api: { '2026-06-29': 'outage' } });
  });

  it('ordnet jeden Status einer Kategorie der Legende zu', () => {
    expect(statusCategory('operational')).toBe('operational');
    expect(statusCategory('partial_outage')).toBe('outage');
    expect(statusCategory('major_outage')).toBe('outage');
    expect(statusCategory('maintenance')).toBe('maintenance');
    expect(statusCategory('unknown')).toBe('none');
  });
});

describe('Statusseite – Zeiträume nachtragen', () => {
  const now = Date.parse('2026-06-30T12:00:00Z');

  it('prüft Zeiträume und dreht vertauschte Daten um', () => {
    const s = normalizeStatusSettings(
      {
        ranges: [
          { component: '*', from: '2026-05-01', to: '2026-06-10', state: 'operational' },
          { component: 'api', from: '2026-06-20', to: '2026-06-15', state: 'maintenance', onlyEmpty: false },
          { component: 'gibtsnicht', from: '2026-06-01', to: '2026-06-02', state: 'operational' },
          { component: '*', from: '2026-02-30', to: '2026-06-02', state: 'operational' },
          { component: '*', from: '2025-01-01', to: '2025-02-01', state: 'operational' },
          { component: '*', from: '2026-06-01', to: '2026-06-02', state: 'kaputt' },
        ],
      },
      now,
    );
    expect(s.ranges).toEqual([
      { component: '*', from: '2026-05-01', to: '2026-06-10', state: 'operational', onlyEmpty: true },
      { component: 'api', from: '2026-06-15', to: '2026-06-20', state: 'maintenance', onlyEmpty: false },
    ]);
  });

  it('füllt nur Tage ohne Messdaten, wenn so eingestellt – spätere Einträge gewinnen', () => {
    const ranges = normalizeStatusSettings(
      {
        ranges: [
          { component: '*', from: '2026-06-01', to: '2026-06-10', state: 'operational', onlyEmpty: true },
          { component: 'api', from: '2026-06-05', to: '2026-06-06', state: 'maintenance', onlyEmpty: false },
        ],
      },
      now,
    ).ranges;
    expect(rangeStateFor(ranges, 'website', '2026-06-03', false)).toBe('operational');
    expect(rangeStateFor(ranges, 'website', '2026-06-03', true)).toBeNull();
    expect(rangeStateFor(ranges, 'website', '2026-06-11', false)).toBeNull();
    expect(rangeStateFor(ranges, 'api', '2026-06-05', true)).toBe('maintenance');
    expect(rangeStateFor(ranges, 'api', '2026-06-04', false)).toBe('operational');
  });
});
