/**
 * Minimal ops read (MM-PLAN-001 §5 Phase 7): status/channel/template only
 * — deliberately excludes `destination` and `paramsJson` (PII) so this
 * feed is safe for general ops tooling, not just support-access-gated code.
 */
import { desc, notificationLog, type DbExecutor } from "@mesomed/db/modules/communication";
import type {
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
} from "@mesomed/contracts/communication";

export interface NotificationFeedEntry {
  id: string;
  template: NotificationTemplate;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  createdAt: string;
}

export async function listRecentNotifications(
  db: DbExecutor,
  options: { limit?: number } = {},
): Promise<NotificationFeedEntry[]> {
  const limit = options.limit ?? 50;
  const rows = await db
    .select({
      id: notificationLog.id,
      template: notificationLog.template,
      channel: notificationLog.channel,
      status: notificationLog.status,
      attempts: notificationLog.attempts,
      createdAt: notificationLog.createdAt,
    })
    .from(notificationLog)
    .orderBy(desc(notificationLog.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
  })) as NotificationFeedEntry[];
}
