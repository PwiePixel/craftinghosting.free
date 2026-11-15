/**
 * Slash-Befehle des Bots. Alle Befehle sind nur für Mitglieder mit Administrator-Recht sichtbar
 * (default_member_permissions) – der Bot prüft das Recht bei jedem Aufruf zusätzlich selbst.
 */
import type { DiscordSettings } from '@chfree/shared';

const SUB = 1;
const STRING = 3;
const USER = 6;
const ROLE = 8;
const ADMIN = '8';

export interface CommandDefinition {
  name: string;
  description: string;
  default_member_permissions: string;
  dm_permission: boolean;
  options?: unknown[];
}

export function buildCommands(settings: DiscordSettings): CommandDefinition[] {
  const panels = settings.rolePanels.filter((p) => p.buttons.some((b) => b.roleId));
  return [
    {
      name: 'rolle',
      description: 'Rolle einem Mitglied oder allen Mitgliedern geben bzw. nehmen',
      default_member_permissions: ADMIN,
      dm_permission: false,
      options: [
        {
          type: SUB,
          name: 'geben',
          description: 'Einem Mitglied eine Rolle geben',
          options: [
            { type: USER, name: 'nutzer', description: 'Wer die Rolle bekommt', required: true },
            { type: ROLE, name: 'rolle', description: 'Welche Rolle', required: true },
          ],
        },
        {
          type: SUB,
          name: 'nehmen',
          description: 'Einem Mitglied eine Rolle wegnehmen',
          options: [
            { type: USER, name: 'nutzer', description: 'Wem die Rolle genommen wird', required: true },
            { type: ROLE, name: 'rolle', description: 'Welche Rolle', required: true },
          ],
        },
        {
          type: SUB,
          name: 'alle',
          description: 'Allen Mitgliedern eine Rolle geben (Bots ausgenommen)',
          options: [{ type: ROLE, name: 'rolle', description: 'Welche Rolle', required: true }],
        },
      ],
    },
    {
      name: 'wartung',
      description: 'Wartungsmodus des Discord-Servers: alle Kanäle sperren bzw. wieder freigeben',
      default_member_permissions: ADMIN,
      dm_permission: false,
      options: [
        {
          type: SUB,
          name: 'an',
          description: 'Wartung starten: Rolle „Wartung“ für alle, Kanäle nur noch für Administratoren sichtbar',
          options: [{ type: STRING, name: 'grund', description: 'Hinweis für die Mitglieder (optional)', required: false, max_length: 300 }],
        },
        { type: SUB, name: 'aus', description: 'Wartung beenden: Berechtigungen wiederherstellen, Rolle „Wartung“ entfernen' },
        { type: SUB, name: 'status', description: 'Zeigt, ob gerade eine Wartung läuft' },
      ],
    },
    {
      name: 'ticketpanel',
      description: 'Postet das Ticket-Panel in diesen Kanal',
      default_member_permissions: ADMIN,
      dm_permission: false,
    },
    {
      name: 'rollenpanel',
      description: 'Postet ein Rollen-Panel (Rollen per Button) in diesen Kanal',
      default_member_permissions: ADMIN,
      dm_permission: false,
      options: [
        {
          type: STRING,
          name: 'panel',
          description: 'Welches Panel',
          required: true,
          choices: (panels.length ? panels : settings.rolePanels).slice(0, 25).map((p) => ({ name: p.title.slice(0, 100), value: p.id })),
        },
      ],
    },
  ];
}
