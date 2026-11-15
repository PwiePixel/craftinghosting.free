import { freeHostingConfig, type Locale } from '@chfree/shared';

const { brand } = freeHostingConfig;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

interface LayoutInput {
  locale: Locale;
  preheader: string;
  heading: string;
  paragraphs: string[];
  /** true = Absätze dürfen **fett** und Links enthalten (Newsletter) */
  rich?: boolean;
  cta?: { label: string; url: string };
  footnote?: string;
  /** Zusätzliche Zeile im Fuß mit Link (z. B. Newsletter abbestellen) */
  footerLink?: { text: string; label: string; url: string };
}

/** Sicherer Mini-Formatierer für Newsletter-Texte: erst alles maskieren, dann **fett** und https-Links erlauben */
function richHtml(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="color:#ffffff">$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#60a5fa">$1</a>')
    .replace(/\n/g, '<br>');
}

export interface MailContent {
  subject: string;
  html: string;
  text: string;
}

const chrome = {
  de: {
    buttonHint: 'Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:',
    auto: (support: string) => `Diese E-Mail wurde automatisch versendet. Bei Fragen erreichst du uns unter ${support}.`,
  },
  en: {
    buttonHint: 'If the button does not work, copy this link into your browser:',
    auto: (support: string) => `This email was sent automatically. If you have any questions, contact us at ${support}.`,
  },
} satisfies Record<Locale, unknown>;

function layout(subject: string, input: LayoutInput): MailContent {
  const c = chrome[input.locale];
  const paragraphs = input.paragraphs
    .map((p) => `<p style="margin:0 0 16px;color:#d1d5db;font-size:15px;line-height:1.6">${input.rich ? richHtml(p) : escapeHtml(p)}</p>`)
    .join('');
  const cta = input.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 24px"><tr><td style="border-radius:8px;background:#2563eb">
        <a href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;border-radius:8px">${escapeHtml(input.cta.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 16px;color:#9ca3af;font-size:12px;line-height:1.5">${escapeHtml(c.buttonHint)}<br><span style="color:#60a5fa;word-break:break-all">${escapeHtml(input.cta.url)}</span></p>`
    : '';
  const html = `<!doctype html><html lang="${input.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#0b0d14;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(input.preheader)}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0d14;padding:32px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
    <tr><td style="padding:0 4px 20px;font-size:17px;font-weight:700;color:#ffffff">Crafting Hosting <span style="display:inline-block;margin-left:4px;padding:2px 8px;border-radius:999px;background:#1e3a8a;color:#bfdbfe;font-size:11px;font-weight:700;letter-spacing:.06em">FREE</span></td></tr>
    <tr><td style="background:#111522;border:1px solid #1f2937;border-radius:12px;padding:32px 28px">
      <h1 style="margin:0 0 16px;color:#ffffff;font-size:22px;line-height:1.3">${escapeHtml(input.heading)}</h1>
      ${paragraphs}${cta}
      ${input.footnote ? `<p style="margin:0;color:#6b7280;font-size:12px;line-height:1.5">${escapeHtml(input.footnote)}</p>` : ''}
    </td></tr>
    <tr><td style="padding:20px 4px;color:#6b7280;font-size:12px;line-height:1.5">
      ${escapeHtml(brand.productName)} · ${escapeHtml(brand.poweredBy)}<br>
      ${escapeHtml(c.auto(brand.supportEmail))}${
        input.footerLink
          ? `<br><br>${escapeHtml(input.footerLink.text)} <a href="${escapeHtml(input.footerLink.url)}" style="color:#9ca3af">${escapeHtml(input.footerLink.label)}</a>`
          : ''
      }
    </td></tr>
  </table>
</td></tr></table></body></html>`;
  const text = [
    input.heading,
    '',
    ...input.paragraphs.flatMap((p) => [p, '']),
    input.cta ? `${input.cta.label}: ${input.cta.url}\n` : '',
    input.footnote ?? '',
    '',
    `— ${brand.productName} · ${brand.poweredBy}`,
    input.footerLink ? `\n${input.footerLink.text} ${input.footerLink.url}` : '',
  ].join('\n');
  return { subject, html, text };
}

export function verifyServerMail(serverName: string, url: string, locale: Locale): MailContent {
  if (locale === 'en') {
    return layout('Confirm your email – your server is waiting', {
      locale,
      preheader: `One click and we will create “${serverName}”.`,
      heading: 'Almost there!',
      paragraphs: [
        `Confirm your email address – then set your password for the Pterodactyl panel and we will create your Minecraft server “${serverName}” automatically.`,
      ],
      cta: { label: 'Confirm email & create server', url },
      footnote: 'This link is valid for 24 hours. If you did not request a server, simply ignore this email – nothing will happen.',
    });
  }
  return layout('Bestätige deine E-Mail – dein Server wartet', {
    locale,
    preheader: `Ein Klick, dann erstellen wir „${serverName}“.`,
    heading: 'Fast geschafft!',
    paragraphs: [
      `Bestätige deine E-Mail-Adresse – danach legst du dein Passwort für das Pterodactyl-Panel fest und wir erstellen deinen Minecraft-Server „${serverName}“ automatisch.`,
    ],
    cta: { label: 'E-Mail bestätigen & Server erstellen', url },
    footnote: 'Der Link ist 24 Stunden gültig. Wenn du keinen Server angefordert hast, ignoriere diese E-Mail einfach – es passiert nichts.',
  });
}

export function verifyWaitlistMail(serverName: string, url: string, locale: Locale): MailContent {
  if (locale === 'en') {
    return layout('Confirm your email – secure your early-access spot', {
      locale,
      preheader: 'One click and your spot on the waitlist is yours.',
      heading: 'Secure your spot',
      paragraphs: [
        `Confirm your email address to get your place on the waitlist for the first free start phase of CraftingHosting.free. The first spots get a server on our AMD EPYC, the following ones on our Intel Xeon.`,
        `As soon as it's your turn, we'll create “${serverName}” and send you an email.`,
      ],
      cta: { label: 'Confirm email & secure spot', url },
      footnote: 'This link is valid for 24 hours. If you did not sign up, simply ignore this email.',
    });
  }
  return layout('Bestätige deine E-Mail – sichere dir deinen Platz', {
    locale,
    preheader: 'Ein Klick und dein Platz auf der Warteliste gehört dir.',
    heading: 'Sichere dir deinen Platz',
    paragraphs: [
      'Bestätige deine E-Mail-Adresse, um deinen Platz auf der Warteliste für die erste kostenlose Startphase von CraftingHosting.free zu bekommen. Die ersten Plätze bekommen einen Server auf unserem AMD EPYC, die folgenden auf unseren Intel Xeon.',
      `Sobald du an der Reihe bist, erstellen wir „${serverName}“ und schicken dir eine E-Mail.`,
    ],
    cta: { label: 'E-Mail bestätigen & Platz sichern', url },
    footnote: 'Der Link ist 24 Stunden gültig. Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail einfach.',
  });
}

export function loginMail(url: string, locale: Locale): MailContent {
  if (locale === 'en') {
    return layout('Your sign-in link for CraftingHosting.free', {
      locale,
      preheader: 'Signed in with one click – no password.',
      heading: 'Sign in',
      paragraphs: ['Click the button to sign in to CraftingHosting.free. There you can see the status of your server and reactivate it.'],
      cta: { label: 'Sign in now', url },
      footnote: 'This link is valid for 30 minutes and can only be used once. If this was not you, ignore this email.',
    });
  }
  return layout('Dein Anmeldelink für CraftingHosting.free', {
    locale,
    preheader: 'Mit einem Klick angemeldet – ohne Passwort.',
    heading: 'Anmelden',
    paragraphs: ['Klicke auf den Button, um dich bei CraftingHosting.free anzumelden. Dort siehst du den Status deines Servers und kannst ihn reaktivieren.'],
    cta: { label: 'Jetzt anmelden', url },
    footnote: 'Der Link ist 30 Minuten gültig und kann nur einmal verwendet werden. Wenn du das nicht warst, ignoriere diese E-Mail.',
  });
}

export function notificationMail(title: string, body: string, cta: { label: string; url: string }, locale: Locale): MailContent {
  return layout(title, {
    locale,
    preheader: body.slice(0, 120),
    heading: title,
    paragraphs: body.split('\n').filter(Boolean),
    cta,
  });
}

/** Bestätigung der Newsletter-Anmeldung (Double-Opt-in) */
export function newsletterConfirmMail(url: string, locale: Locale): MailContent {
  if (locale === 'en') {
    return layout('Please confirm your newsletter subscription', {
      locale,
      preheader: 'One click and you will get news and offers from CraftingHosting.free.',
      heading: 'Confirm your subscription',
      paragraphs: [
        'You (or someone using your email address) signed up for the CraftingHosting.free newsletter: news, new plans and offers – a few times a year, no spam.',
        'Please confirm with the button below. If you did not sign up, simply ignore this email – you will not receive anything.',
      ],
      cta: { label: 'Confirm subscription', url },
      footnote: 'You can unsubscribe at any time via the link at the end of every newsletter.',
    });
  }
  return layout('Bitte bestätige deine Newsletter-Anmeldung', {
    locale,
    preheader: 'Ein Klick und du bekommst Neuigkeiten und Angebote von CraftingHosting.free.',
    heading: 'Anmeldung bestätigen',
    paragraphs: [
      'Du (oder jemand mit deiner E-Mail-Adresse) hast dich für den Newsletter von CraftingHosting.free angemeldet: Neuigkeiten, neue Pakete und Angebote – wenige Male im Jahr, kein Spam.',
      'Bitte bestätige die Anmeldung mit dem Button. Falls du dich nicht angemeldet hast, ignoriere diese E-Mail einfach – du bekommst dann nichts.',
    ],
    cta: { label: 'Anmeldung bestätigen', url },
    footnote: 'Abmelden kannst du dich jederzeit über den Link am Ende jedes Newsletters.',
  });
}

/** Eine Newsletter-Ausgabe bzw. ein betrieblicher Hinweis an alle Konten */
export function campaignMail(
  input: { subject: string; body: string; cta?: { label: string; url: string }; unsubscribeUrl?: string },
  locale: Locale,
): MailContent {
  const paragraphs = input.body
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const en = locale === 'en';
  return layout(input.subject, {
    locale,
    preheader: paragraphs[0]?.slice(0, 120) ?? input.subject,
    heading: input.subject,
    paragraphs,
    rich: true,
    cta: input.cta,
    footnote: input.unsubscribeUrl
      ? undefined
      : en
        ? 'You are receiving this notice because you have an account at CraftingHosting.free. It concerns the operation of your free server.'
        : 'Du erhältst diesen Hinweis, weil du ein Konto bei CraftingHosting.free hast. Er betrifft den Betrieb deines kostenlosen Servers.',
    footerLink: input.unsubscribeUrl
      ? {
          text: en ? 'You are receiving this email because you subscribed to the newsletter.' : 'Du bekommst diese E-Mail, weil du den Newsletter abonniert hast.',
          label: en ? 'Unsubscribe' : 'Abmelden',
          url: input.unsubscribeUrl,
        }
      : undefined,
  });
}
