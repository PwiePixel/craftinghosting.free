import { describe, expect, it } from 'vitest';
import { defaultDiscordSettings, fillDiscordTemplate, normalizeDiscordSettings, ordinalEn, snowflakeDate } from './discord-settings';
import { normalizeSiteSettings } from './settings';

describe('Discord-Einstellungen', () => {
  it('liefert ohne Angaben die Standardwerte (ausgeschaltet, keine Pflicht)', () => {
    const d = normalizeDiscordSettings(undefined);
    expect(d).toEqual(defaultDiscordSettings());
    expect(d.enabled).toBe(false);
    expect(d.required).toBe(false);
    expect(d.rolePanels.map((p) => p.id)).toEqual(['roles', 'hosting']);
    expect(normalizeSiteSettings({}).discord).toEqual(d);
  });

  it('nimmt nur gültige Discord-IDs an', () => {
    const d = normalizeDiscordSettings({
      enabled: true,
      clientId: ' 123456789012345678 ',
      guildId: 'abc',
      customerRoleId: '12',
      autoRoleIds: ['123456789012345678', 'x', '123456789012345678', '223456789012345678'],
      welcome: { color: 'rot', fallbackImageUrl: 'http://unsicher.example/bild.png' },
      rolePanels: [{ title: 'Roles', buttons: [{ label: 'News', emoji: '📢', roleId: '323456789012345678' }, { label: '', roleId: '1' }, { label: 'Kaputt', roleId: 'nope' }] }, { title: '' }],
    });
    expect(d.clientId).toBe('123456789012345678');
    expect(d.guildId).toBe('');
    expect(d.customerRoleId).toBe('');
    expect(d.autoRoleIds).toEqual(['123456789012345678', '223456789012345678']);
    expect(d.welcome.color).toBe(defaultDiscordSettings().welcome.color);
    expect(d.welcome.fallbackImageUrl).toBe('');
    expect(d.rolePanels).toHaveLength(1);
    expect(d.rolePanels[0]!.buttons).toEqual([
      { label: 'News', emoji: '📢', roleId: '323456789012345678' },
      { label: 'Kaputt', emoji: '', roleId: '' },
    ]);
  });

  it('prüft die Angaben zu den Status-Meldungen', () => {
    expect(normalizeDiscordSettings(undefined).statusFeed).toEqual({ channelId: '', pingRoleId: '', announceAuto: true });
    expect(normalizeDiscordSettings({ statusFeed: { channelId: ' 423456789012345678 ', pingRoleId: 'keine-id', announceAuto: false } }).statusFeed).toEqual({
      channelId: '423456789012345678',
      pingRoleId: '',
      announceAuto: false,
    });
  });

  it('füllt die Platzhalter der Willkommensnachricht', () => {
    expect(fillDiscordTemplate('Welcome to **{server}**, {user}! {unbekannt}', { server: 'CraftingHosting', user: 'nick' })).toBe('Welcome to **CraftingHosting**, nick! {unbekannt}');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111, 166].map(ordinalEn)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th', '166th']);
  });

  it('liest das Erstellungsdatum eines Discord-Kontos aus der ID', () => {
    expect(snowflakeDate('175928847299117063').toISOString()).toBe('2016-04-30T11:18:25.796Z');
  });
});
