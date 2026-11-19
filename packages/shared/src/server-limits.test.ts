import { describe, expect, it } from 'vitest';
import { applyLimitOverrides, defaultServerLimits, extraAllowances, describeServerLimits, kindExhausted, normalizeServerLimits, serverLimitBlock, takenPlanIds, type OwnedServerRef } from './server-limits';

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

describe('Zusatzpakete und Grenzen je Nutzer', () => {
  const limits = { ...defaultServerLimits(1), total: 2 };
  const plans = [
    { id: 'free-4gb', perUser: null, audience: 'all' as const },
    { id: 'bedrock', perUser: 1, audience: 'all' as const },
    { id: 'proxy', perUser: null, audience: 'granted' as const },
  ];

  it('Zusatzpaket zählt nicht gegen die Grenze des Angebots und nicht gegen die Gesamtgrenze', () => {
    const extra = extraAllowances(plans);
    expect(extra).toEqual({ bedrock: 1, proxy: 0 });
    const owned = [{ kind: 'minecraft' as const, planId: 'free-4gb' }, { kind: 'discord' as const, planId: 'bot' }];
    // Java-Grenze (1) und Gesamtgrenze (2) erreicht – der Bedrock-Server geht trotzdem
    expect(serverLimitBlock(limits, owned, 'minecraft', 'free-4gb', [], extra)).toBe('kind');
    expect(serverLimitBlock(limits, owned, 'minecraft', 'bedrock', [], extra)).toBeNull();
    // Ein zweiter Bedrock-Server nicht
    expect(serverLimitBlock(limits, [...owned, { kind: 'minecraft', planId: 'bedrock' }], 'minecraft', 'bedrock', [], extra)).toBe('plan');
  });

  it('Zusatzpaket-Server belegen keinen normalen Platz', () => {
    const extra = extraAllowances(plans);
    expect(serverLimitBlock(limits, [{ kind: 'minecraft', planId: 'bedrock' }], 'minecraft', 'free-4gb', [], extra)).toBeNull();
  });

  it('Nur freigeschaltete Pakete: ohne Freischaltung gesperrt, mit Freischaltung so oft wie freigegeben', () => {
    expect(serverLimitBlock(limits, [], 'minecraft', 'proxy', [], extraAllowances(plans))).toBe('plan');
    const granted = extraAllowances(plans, { plans: { proxy: 2 } });
    expect(serverLimitBlock(limits, [{ kind: 'minecraft', planId: 'proxy' }], 'minecraft', 'proxy', [], granted)).toBeNull();
    expect(serverLimitBlock(limits, [{ kind: 'minecraft', planId: 'proxy' }, { kind: 'minecraft', planId: 'proxy' }], 'minecraft', 'proxy', [], granted)).toBe('plan');
  });

  it('Abweichende Grenzen je Nutzer', () => {
    const mine = applyLimitOverrides(limits, { minecraft: 2, discord: null, total: 4 });
    expect(mine).toMatchObject({ minecraft: 2, discord: 1, total: 4 });
    expect(serverLimitBlock(mine, [{ kind: 'minecraft', planId: 'free-4gb' }], 'minecraft', 'free-4gb')).toBeNull();
    // Zusatzpaket je Nutzer abschaltbar
    expect(serverLimitBlock(limits, [], 'minecraft', 'bedrock', [], extraAllowances(plans, { plans: { bedrock: 0 } }))).toBe('plan');
  });

  it('Konstruktor-Kennung liest nichts aus Object.prototype', () => {
    expect(serverLimitBlock(limits, [], 'minecraft', 'constructor', [], {})).toBeNull();
  });
});

describe('Zusatzpakete: mehr Server als erlaubt', () => {
  it('überzählige Server eines Zusatzpakets zählen wieder gegen die normale Grenze', () => {
    const limits = defaultServerLimits(2);
    const extra = { small: 1 };
    // Zwei Server im Zusatzpaket „small“, erlaubt ist einer → der zweite belegt einen normalen Platz
    expect(serverLimitBlock(limits, [{ kind: 'minecraft', planId: 'small' }, { kind: 'minecraft', planId: 'small' }, { kind: 'minecraft', planId: 'a' }], 'minecraft', 'a', [], extra)).toBe('kind');
    // Freischaltung zurückgenommen (0): der Server zählt normal
    expect(serverLimitBlock(defaultServerLimits(1), [{ kind: 'minecraft', planId: 'bedrock' }], 'minecraft', 'a', [], { bedrock: 0 })).toBe('kind');
  });
});
