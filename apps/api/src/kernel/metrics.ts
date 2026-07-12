/**
 * Channel-mix instrumentation (MM-ARC-002 §5.5, required from Phase 7): a
 * counter metric per channel per send outcome. No-ops safely when no
 * OTel SDK is started (the meter provider defaults to a no-op
 * implementation), matching the tracing setup in kernel/otel.ts.
 */
import { metrics } from "@opentelemetry/api";

const meter = metrics.getMeter("mesomed.communication");

const notificationsSent = meter.createCounter("mesomed.notifications.sent", {
  description: "Notification send attempts by channel and outcome",
});

export function recordNotificationSend(
  channel: string,
  status: "sent" | "failed" | "denied",
): void {
  notificationsSent.add(1, { channel, status });
}
