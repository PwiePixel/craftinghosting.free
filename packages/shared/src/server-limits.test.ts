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

  it('rechnet Bonus-Slots an (Belohnungen)', () => {
    const limits = defaultServerLimits(); // 1 Minecraft-Server, 1 Bot
    // Ohne Bonus ist beim zweiten Bot Schluss
    expect(serverLimitBlock(limits, [bot('bot-512mb')], 'discord', 'bot-512mb')).toBe('kind');
    // Freier Bonus-Slot für Bots: ein weiterer Bot mit beliebigem Paket
    expect(serverLimitBlock(limits, [bot('bot-512mb')], 'discord', 'bot-1gb', [{ kind: 'discord', planId: null }])).toBeNull();
    expect(serverLimitBlock(limits, [bot('bot-512mb'), bot('bot-1gb')], 'discord', 'bot-1gb', [{ kind: 'discord', planId: null }])).toBe('kind');
    // Der Bot-Slot hilft nicht bei Minecraft
    expect(serverLimitBlock(limits, [mc('free-4gb')], 'minecraft', 'free-6gb', [{ kind: 'discord', planId: null }])).toBe('kind');
    // Paketgebundener Slot: nur das kleinste Bot-Paket ist zusätzlich möglich
    const bound = [{ kind: 'discord' as const, planId: 'bot-256mb' }];
    expect(serverLimitBlock(limits, [bot('bot-512mb')], 'discord', 'bot-256mb', bound)).toBeNull();
    expect(serverLimitBlock(limits, [bot('bot-512mb')], 'discord', 'bot-1gb', bound)).toBe('kind');
    // … und nur einmal
    expect(serverLimitBlock(limits, [bot('bot-512mb'), bot('bot-256mb')], 'discord', 'bot-256mb', bound)).toBe('kind');
    // Der gedeckte Server belegt keinen normalen Platz
    expect(serverLimitBlock(limits, [bot('bot-256mb')], 'discord', 'bot-512mb', bound)).toBeNull();
    // Das Angebot ist nicht ausgeschöpft, solange der gebundene Slot frei ist
    expect(kindExhausted(limits, [bot('bot-512mb')], 'discord', ['bot-256mb', 'bot-512mb'], bound)).toBe(false);
    expect(kindExhausted(limits, [bot('bot-512mb'), bot('bot-256mb')], 'discord', ['bot-256mb', 'bot-512mb'], bound)).toBe(true);
    // Gesamtgrenze wächst mit freien Bonus-Slots
    const total = { ...limits, discord: 2, total: 2 };
    expect(serverLimitBlock(total, [mc('free-4gb'), bot('bot-512mb')], 'discord', 'bot-1gb')).toBe('total');
    expect(serverLimitBlock(total, [mc('free-4gb'), bot('bot-512mb')], 'discord', 'bot-1gb', [{ kind: 'discord', planId: null }])).toBeNull();
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
