/**
 * Kleine Abfragen zur Partner-API, die auch Module brauchen, von denen partner.service selbst abhängt
 * (Provisionierung, Benachrichtigungen) – ausgelagert, damit kein Import-Kreis entsteht.
 */
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { partners } from '../db/schema';

/** Feste Nodes des Partners, zu dem ein Server gehört (leer = keine Vorgabe) */
export async function partnerNodeIds(partnerId: string): Promise<number[]> {
  const [p] = await db.select({ nodeIds: partners.nodeIds }).from(partners).where(eq(partners.id, partnerId)).limit(1);
  return p?.nodeIds ?? [];
}

/** Ist dieses Konto das Konto eines Partners? Es bekommt keine Benachrichtigungen. */
export async function isPartnerAccount(userId: string): Promise<boolean> {
  const [p] = await db.select({ id: partners.id }).from(partners).where(eq(partners.userId, userId)).limit(1);
  return !!p;
}
