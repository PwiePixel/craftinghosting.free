import { describe, expect, it } from 'vitest';
import { defaultServerLimits, describeServerLimits, kindExhausted, normalizeServerLimits, serverLimitBlock, takenPlanIds, type OwnedServerRef } from './server-limits';

const mc = (planId: string): OwnedServerRef => ({ kind: 'minecraft', planId });
const bot = (planId: string): OwnedServerRef => ({ kind: 'discord', planId });

describe('Server-Grenzen je Person', () => {
  it('übernimmt die frühere Einstellung „Server pro Person“ für beide Angebote', () => {
    expect(normalizeServerLimits(undefined, undefined)).toEqual(defaultServerLimits());
    expect(normalizeServerLimits(undefined, 2)).toEqual({ minecraft: 2, discord: 2, total: 0, uniquePlan: { minecraft: false, discord: false } });
    // Gespeicherte getrennte Grenzen haben Vorrang
    expect(normalizeServerLimits({ minecraft: 1, discord: '3', total: 99, uniquePlan: { minecraft: true, discord: 'ja' } }, 2)).toEqual({
      minecraft: 1,
      discord: 3,
      total: 20,
      uniquePlan: { minecraft: true, discord: false },
    });
    expect(normalizeServerLimits({ minecraft: -4, discord: 50 }, undefined)).toMatchObject({ minecraft: 0, discord: 10 });
  });

  it('zählt Minecraft-Server und Discord-Bots getrennt', () => {
    const limits = { ...defaultServerLimits(), minecraft: 1, discord: 2 };
    expect(serverLimitBlock(limits, [], 'minecraft', 'free-4gb')).toBeNull();
    expect(serverLimitBlock(limits, [mc('free-4gb')], 'minecraft', 'free-6gb')).toBe('kind');
    expect(serverLimitBlock(limits, [mc('free-4gb'), bot('bot-512mb')], 'discord', 'bot-512mb')).toBeNull();
    expect(serverLimitBlock(limits, [bot('bot-512mb'), bot('bot-512mb')], 'discord')).toBe('kind');
  });

  it('beachtet die Gesamtgrenze: ein Minecraft-Server ODER zwei Bots ODER je einer', () => {
    const limits = { ...defaultServerLimits(), minecraft: 1, discord: 2, total: 2 };
    expect(serverLimitBlock(limits, [mc('free-4gb')], 'discord')).toBeNull();
    expect(serverLimitBlock(limits, [mc('free-4gb'), bot('bot-512mb')], 'discord')).toBe('total');
    expect(serverLimitBlock(limits, [bot('bot-512mb'), bot('bot-512mb')], 'minecraft')).toBe('total');
  });

  it('lässt jedes Paket nur einmal zu, wenn das eingestellt ist', () => {
    const limits = { ...defaultServerLimits(), minecraft: 2, uniquePlan: { minecraft: true, discord: false } };
    expect(serverLimitBlock(limits, [mc('free-4gb')], 'minecraft', 'free-4gb')).toBe('plan');
    expect(serverLimitBlock(limits, [mc('free-4gb')], 'minecraft', 'free-6gb')).toBeNull();
    expect(takenPlanIds(limits, [mc('free-4gb'), bot('bot-512mb')], 'minecraft')).toEqual(['free-4gb']);
    expect(takenPlanIds(limits, [bot('bot-512mb')], 'discord')).toEqual([]);
    // Nur ein Paket im Angebot und das hat die Person schon → Angebot ausgeschöpft, obwohl die Zahl noch reichen würde
    expect(kindExhausted(limits, [mc('free-4gb')], 'minecraft', ['free-4gb'])).toBe(true);
    expect(kindExhausted(limits, [mc('free-4gb')], 'minecraft', ['free-4gb', 'free-6gb'])).toBe(false);
  });

  it('beschreibt die Grenzen in beiden Sprachen', () => {
    expect(describeServerLimits(defaultServerLimits(), 'de')).toBe('Pro Person sind derzeit bis zu 1 Minecraft-Server und 1 Discord-Bot möglich.');
    expect(describeServerLimits(defaultServerLimits(), 'en', ['minecraft'])).toBe('Per person, 1 Minecraft server is currently possible.');
    const limits = { minecraft: 2, discord: 2, total: 2, uniquePlan: { minecraft: true, discord: false } };
    expect(describeServerLimits(limits, 'de')).toBe('Pro Person sind derzeit bis zu 2 Minecraft-Server und 2 Discord-Bots möglich – zusammen höchstens 2 Server. Jedes Minecraft-Paket ist dabei nur einmal möglich.');
    expect(describeServerLimits(limits, 'en')).toBe('Per person, up to 2 Minecraft servers and 2 Discord bots are currently possible – at most 2 servers in total. Each Minecraft plan can only be used once.');
    expect(describeServerLimits({ ...limits, minecraft: 0, discord: 0 }, 'de')).toBe('Derzeit können keine kostenlosen Server angelegt werden.');
  });
});
