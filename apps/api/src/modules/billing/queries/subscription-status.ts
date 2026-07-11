/**
 * Published subscription reads (§3.1). `getSubscriptionForDoctor` is the
 * cross-module read surface; the router's `mySubscription` binds it to the
 * session's own doctor profile (§3.6 layer b).
 */
import { eq, subscriptions, type DbExecutor } from "@mesomed/db";

export interface SubscriptionState {
  subscriptionId: string;
  doctorProfileId: string;
  status: "active" | "grace_period" | "inactive";
  paidUntil: string | null;
}

export async function getSubscriptionForDoctor(
  db: DbExecutor,
  doctorProfileId: string,
): Promise<SubscriptionState | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.doctorProfileId, doctorProfileId))
    .limit(1);
  if (!row) return null;
  return {
    subscriptionId: row.id,
    doctorProfileId: row.doctorProfileId,
    status: row.status,
    paidUntil: row.paidUntil?.toISOString() ?? null,
  };
}
