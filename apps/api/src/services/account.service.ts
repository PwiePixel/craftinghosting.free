/**
 * Konto löschen – von Nutzern selbst („Meine Server“) oder aus dem Admin-Bereich.
 * Gelöscht werden das Website-Konto und alle kostenlosen Server (im Panel inkl. Welt und Backups).
 * Das Pterodactyl-Konto bleibt bestehen: Es kann auch bezahlte Server von Crafting Hosting enthalten.
 */
import { releaseDiscordFor } from '../discord/service';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { servers, users, type User } from '../db/schema';
import { audit } from './audit.service';
import { removeSubscriberByEmail } from './newsletter.service';
import { hardDeleteServer } from './server.service';
import { invalidatePublicSite } from './settings.service';
import { carryWarnings } from './warnings.service';

export async function deleteAccount(user: Pick<User, 'id' | 'email'>, by: { admin?: Pick<User, 'email'> }, ip?: string): Promise<{ servers: number }> {
  const owned = await db.select().from(servers).where(eq(servers.userId, user.id));
  // Verwarnungs-System: Aktive Verwarnungen bleiben als Fingerabdruck bestehen und gehen auf ein neues Konto derselben
  // Person über (vor dem Lösen der Discord-Verknüpfung – der Fingerabdruck des Discord-Kontos gehört dazu)
  const [full] = await db.select({ id: users.id, email: users.email, discordId: users.discordId }).from(users).where(eq(users.id, user.id)).limit(1);
  if (full) await carryWarnings(full);
  await releaseDiscordFor(user.id);
  let deletedServers = 0;
  for (const server of owned) {
    if (server.status === 'deleted') continue;
    await hardDeleteServer(server); // wirft, wenn das Panel nicht erreichbar ist → Konto bleibt bestehen
    deletedServers++;
  }
  await audit({
    userId: user.id,
    actor: by.admin ? 'admin' : 'user',
    action: 'account.deleted',
    message: by.admin
      ? `Konto ${user.email} gelöscht (${deletedServers} ${deletedServers === 1 ? 'Server' : 'Server'}) (durch ${by.admin.email})`
      : 'Account gelöscht',
    ip,
  });
  // Sessions, Tokens, Benachrichtigungen und Server-Einträge hängen per ON DELETE CASCADE am Konto
  await db.delete(users).where(eq(users.id, user.id));
  await removeSubscriberByEmail(user.email);
  invalidatePublicSite();
  return { servers: deletedServers };
}
