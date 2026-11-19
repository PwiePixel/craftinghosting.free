import { describe, expect, it } from 'vitest';
import { defaultSiteSettings, normalizeSiteSettings, normalizeSoftware, softwareTypes } from './settings';
import { DIRECTORY_NOT_GAME_SERVERS } from './config/freehosting.config';

describe('Private Nodes', () => {
  it('gibt es standardmäßig nicht', () => {
    expect(defaultSiteSettings().privateNodeIds).toEqual([]);
    expect(normalizeSiteSettings({}).privateNodeIds).toEqual([]);
  });

  it('werden geprüft und aus der Zuweisung der Angebote entfernt', () => {
    const s = normalizeSiteSettings({
      privateNodeIds: [2, '4', 2, 0, -1, 'x'],
      products: { minecraft: { nodeIds: [1, 2] }, discord: { nodeIds: [3, 4] } },
    });
    expect(s.privateNodeIds).toEqual([2, 4]);
    // Privat gewinnt: Eine private Node kann keinem Angebot zugewiesen sein
    expect(s.products.minecraft.nodeIds).toEqual([1]);
    expect(s.products.discord.nodeIds).toEqual([3]);
  });
});

describe('Software-Katalog: Bedrock und Proxys', () => {
  const EGG_ONLY = ['bedrock', 'pocketmine', 'nukkit', 'velocity', 'bungeecord'];
  const tampered = () => {
    const base = normalizeSoftware(undefined);
    return [
      // Mitgelieferte Einträge: Partner-API, Verzeichnis und Installationsart von Hand „freigeschaltet“
      ...base.map((x) => ({ ...x, partner: true, website: true, install: 'directory', directory: 'VELOCITY', eggOnly: false, edition: 'java' })),
      // Eigene Einträge, die sich als Proxy bzw. Bedrock über das Verzeichnis ausgeben
      { id: 'mein-proxy', name: 'Mein Proxy', description: { de: 'x', en: 'x' }, edition: 'java', directory: 'VELOCITY', install: 'directory', website: true, partner: true, custom: true, eggOnly: false },
      { id: 'mein-bungee', name: 'Bungee', description: { de: 'x', en: 'x' }, edition: 'java', directory: 'BUNGEECORD', install: 'auto', website: true, partner: true, custom: true },
      { id: 'mein-bedrock', name: 'Bedrock 2', description: { de: 'x', en: 'x' }, edition: 'bedrock', directory: 'PAPER', install: 'directory', website: true, partner: true, custom: true },
      { id: 'eigenes-egg', name: 'Nur Egg', description: { de: 'x', en: 'x' }, edition: 'java', directory: '', install: 'auto', website: true, partner: true, custom: true },
      { id: 'mohist', name: 'Mohist', description: { de: 'x', en: 'x' }, edition: 'java', directory: 'MOHIST', install: 'auto', website: true, partner: true, custom: true },
    ];
  };

  it('mitgelieferte Bedrock- und Proxy-Einträge sind nie über die Partner-API oder das Verzeichnis wählbar', () => {
    const out = normalizeSoftware(tampered());
    for (const id of EGG_ONLY) {
      const item = out.find((x) => x.id === id)!;
      expect(item, id).toBeDefined();
      expect(item.partner, id).toBe(false);
      expect(item.eggOnly, id).toBe(true);
      expect(item.install, id).toBe('egg');
      expect(item.directory, id).toBe('');
    }
    expect(out.find((x) => x.id === 'bedrock')!.edition).toBe('bedrock');
  });

  it('eigene Einträge: Proxys, Bedrock und alles ohne Verzeichnis laufen nur über ein Egg und nie über die Partner-API', () => {
    const out = normalizeSoftware(tampered());
    for (const id of ['mein-proxy', 'mein-bungee', 'mein-bedrock', 'eigenes-egg']) {
      const item = out.find((x) => x.id === id)!;
      expect(item, id).toBeDefined();
      expect(item.partner, id).toBe(false);
      expect(item.eggOnly, id).toBe(true);
      expect(item.install, id).toBe('egg');
      expect(item.directory, id).toBe('');
    }
    // Ein echter Java-Spielserver aus dem Verzeichnis darf für Partner freigegeben werden
    const mohist = out.find((x) => x.id === 'mohist')!;
    expect(mohist.partner).toBe(true);
    expect(mohist.eggOnly).toBe(false);
    expect(mohist.directory).toBe('MOHIST');
  });

  it('als Servertypen: kein für Partner freigegebener Typ ist Bedrock, ein Proxy oder nur über ein Egg installierbar', () => {
    for (const type of softwareTypes(normalizeSoftware(tampered())).filter((t) => t.partner)) {
      expect(type.edition, type.id).toBe('java');
      expect(type.eggOnly, type.id).toBeFalsy();
      expect(type.directory, type.id).toBeTruthy();
      expect(DIRECTORY_NOT_GAME_SERVERS, type.id).not.toContain(type.directory);
    }
  });
});
