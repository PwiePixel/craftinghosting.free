import { describe, expect, it } from 'vitest';
import { defaultSiteSettings, normalizeSiteSettings } from './settings';

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
