/**
 * /llms.txt – maschinenlesbare, sachliche Beschreibung des Angebots für KI-Assistenten (ChatGPT, Claude, Perplexity …).
 *
 * Alle Angaben (Pakete, Plätze, Regeln, Standorte, Links) werden bei jedem Abruf aus den Einstellungen im
 * Admin-Bereich erzeugt – dieselbe Quelle wie die Website. So gibt es keine widersprüchlichen Zahlen.
 */
import { formatMb, localePath, serverTypesOf, type PublicPlanDTO } from '@chfree/shared';
import { getDict } from '@/i18n';
import { site } from '@/lib/site';
import { getSite } from '@/lib/site-settings';
import { siteSummary, siteTexts } from '@/lib/site-texts';

export const dynamic = 'force-dynamic';

const planLine = (p: PublicPlanDTO) =>
  `- ${p.name}: ${formatMb(p.memoryMb, 'en')} RAM, up to ${p.cpuPercent / 100} CPU thread${p.cpuPercent === 100 ? '' : 's'} (shared), ${formatMb(p.diskMb, 'en')} NVMe storage, €0 per month`;

export async function GET() {
  const s = await getSite();
  // Die Beta-Instanz beschreibt sich nicht selbst – maßgeblich ist die Hauptseite
  if (s.beta.instance) return new Response('Not found\n', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const x = siteTexts(s, 'en');
  const t = getDict('en');
  const url = (key: Parameters<typeof localePath>[1]) => `${site.url}${localePath('en', key)}`;
  const mc = s.products.minecraft;
  const bot = s.products.discord;
  const mcOn = mc.enabled && mc.plans.length > 0;
  const botOn = bot.enabled && bot.plans.length > 0;
  const r = s.rules;
  const bf = s.botFairUse;
  const max = s.registration.maxServersPerUser;
  const slots = (p: typeof mc) => (p.capacity === null ? 'no fixed limit' : `${p.capacity} slots in total, ${p.remaining ?? 0} currently free`);
  const restDays = r.cycle.reactivationCooldownMinutes / 1440;

  const lines: string[] = [
    '# CraftingHosting.free',
    '',
    `> ${siteSummary(s, 'en')}`,
    '',
    '## Key facts',
    '',
    `- Name: CraftingHosting.free (domain: ${site.domain}). It is the free offer of the hosting company Crafting Hosting (${site.parentUrl}).`,
    `- Price: free of charge (€0 per month). No payment details, no trial period, no ads. Voluntary donations are possible${s.donate.enabled ? ` (${url('donate')})` : ''}.`,
    `- Products: ${[mcOn && 'free Minecraft servers', botOn && 'free Discord bot hosting (Python or Node.js)'].filter(Boolean).join(' and ')}.`,
    `- Management: servers are created on the website and managed in the Pterodactyl panel (${site.panelUrl}).`,
    `- Location: ${x.locationNames}. Hardware: ${x.cpus}, ${s.hardware.storage}, ${s.hardware.network}.`,
    `- Limit: ${max} free server${max === 1 ? '' : 's'} per person and product${mcOn && botOn ? ' (for example one Minecraft server and one Discord bot)' : ''}.`,
    `- Registration: ${s.registration.mode === 'open' ? 'open' : s.registration.mode === 'preregistration' ? 'early access – users join a waitlist and are unlocked in order' : 'currently paused'}.`,
    `- Languages: English and German.`,
    '',
  ];

  if (mcOn) {
    lines.push(
      '## Free Minecraft servers',
      '',
      `Server software: ${serverTypesOf('minecraft')
        .map((st) => st.name)
        .join(', ')}. Capacity: ${slots(mc)}.`,
      '',
      'Plans:',
      ...mc.plans.map(planLine),
      '',
      'Fair-use rules for Minecraft servers (enforced automatically, with warnings in chat, in the panel and by email):',
      `- A server may run for at most ${r.fairUse.maxSessionHours} hours in a row; it is then stopped and can be started again after ${r.fairUse.cooldownMinutes} minutes.`,
      ...(r.fairUse.weeklyOfflineHours > 0 ? [`- A server has to be offline for at least ${r.fairUse.weeklyOfflineHours} hours per week in total.`] : []),
      '',
    );
  }
  if (botOn) {
    lines.push(
      '## Free Discord bot hosting',
      '',
      `Runtimes: ${serverTypesOf('discord')
        .map((st) => st.name)
        .join(' or ')}. Bots run on a dedicated node, separate from the Minecraft servers. Capacity: ${slots(bot)}.`,
      '',
      'Plans:',
      ...bot.plans.map(planLine),
      '',
      bot.fairUse
        ? `Discord bots follow the same fair-use rules as Minecraft servers (max. ${r.fairUse.maxSessionHours} hours in a row).`
        : `Discord bots may stay online around the clock – there is no runtime limit, there are no forced breaks, and there is no ${r.cycle.days}-day cycle or rest day.`,
      ...(bf.enabled && !bot.fairUse
        ? [
            'Instead, a separate fair-use system for bots applies:',
            `- No sustained CPU load: above ${bf.cpuThresholdPercent} % of the plan's CPU limit for ${bf.cpuWindowMinutes} minutes in a row leads to an email warning and then an automatic stop with a ${bf.cooldownMinutes}-minute break.`,
            ...(bf.maxStrikes > 0 ? [`- ${bf.maxStrikes} such stops within ${bf.strikeWindowDays} days lead to a suspension.`] : []),
            ...(bf.inactiveDays > 0 ? [`- A bot that is offline for ${bf.inactiveDays} days in a row releases its slot (the runtime ends early; it can be reactivated).`] : []),
          ]
        : []),
      'Not allowed: self-bots, spam/raid/nuke bots, token loggers, mass DMs, crypto mining, proxies.',
      '',
    );
  }

  lines.push(
    '## Runtime and renewal',
    '',
    `- Every Minecraft server has a runtime of ${r.cycle.days} days from creation or the last renewal. Email reminders are sent beforehand.`,
    `- After that the server is stopped and suspended; data is kept.${restDays > 0 ? ` After a rest period of ${restDays === 1 ? '1 day' : `${restDays} days`} it can be reactivated for free under "My servers" – as often as you like.` : ' It can be reactivated for free under "My servers" – as often as you like.'}`,
    ...(r.cycle.deleteAfterRestHours > 0
      ? [`- If it is not reactivated within ${r.cycle.deleteAfterRestHours} hours after the rest period, it is deleted automatically (reminder ${r.cycle.deleteReminderHours} hours before).`]
      : []),
    ...(botOn
      ? [
          `- Discord bots are different: they have no ${r.cycle.days}-day cycle and no rest day. A bot runs without an expiry date and never needs to be renewed.${bf.enabled && bf.inactiveDays > 0 ? ` Only a bot that stays offline for ${bf.inactiveDays} days in a row releases its slot; it can be reactivated right away.` : ''}`,
        ]
      : []),
    ...(s.discord.required
      ? [
          '',
          '## Requirement: Discord membership',
          '',
          `- Free servers are only available to members of the CraftingHosting Discord server${s.discord.inviteUrl ? ` (${s.discord.inviteUrl})` : ''}.`,
          '- After signing up, users connect their Discord account under "My servers"; they join the Discord server automatically in the process. Only then is the server set up.',
          '- Each Discord account can be linked to one account only. This protects the offer against multiple sign-ups and automated registrations.',
        ]
      : []),
    '',
    '## How it works',
    '',
    '1. Choose a product, plan and name on the website and enter an email address.',
    '2. Confirm the email address via the link and set a username and password for the panel.',
    '3. The server is created automatically. Start it, upload files and manage it in the Pterodactyl panel.',
    '',
    '## Frequently asked questions',
    '',
    ...t.faq.items(max, x.faq).flatMap((item) => [`### ${item.q}`, '', item.a, '']),
    '## Pages',
    '',
    `- [Home](${url('home')})`,
    `- [Create a server](${url('start')})`,
    `- [FAQ](${url('faq')})`,
    `- [Terms of use for Minecraft servers](${url('rules')})`,
    `- [Terms of use for Discord bots](${url('discordTerms')})`,
    `- [Terms and conditions](${url('terms')})`,
    `- [Privacy policy](${url('privacy')})`,
    `- [Network status](${url('status')})`,
    `- [Imprint / legal notice](${url('imprint')})`,
    `- German version: ${site.url}${localePath('de', 'home')}`,
    '',
    '## Contact',
    '',
    `- Support: ${site.supportEmail}`,
    `- Discord: ${site.discordUrl}`,
    `- Operator: Crafting Hosting – ${site.parentUrl}`,
    '',
    '## Kurzfassung (Deutsch)',
    '',
    siteSummary(s, 'de'),
    '',
    `Stand: ${new Date().toISOString().slice(0, 10)} – diese Datei wird automatisch aus den aktuellen Einstellungen der Website erzeugt.`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  });
}
