/**
 * Channel-mix instrumentation (MM-ARC-002 §5.5, required from Phase 7): a
 * counter metric per channel per send outcome. No-ops safely when no
 * OTel SDK is started (the meter provider defaults to a no-op
 * implementation), matching the tracing setup in kernel/otel.ts.
 *
 * Phase 10 (ADR-0026) adds the booking-funnel counters and the DB-derived
 * outbox gauges backing the launch dashboards. Metrics, not events:
 * events are integration contracts (§3.3) and none is minted for a
 * dashboard (MM-DES-002 §5 precedent).
 */
import { metrics } from "@opentelemetry/api";
import { domainEvents, sql, type Db } from "@mesomed/db";

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

// ── Booking funnel (ADR-0026) ────────────────────────────────────────────

const bookingMeter = metrics.getMeter("mesomed.booking");

const bookingCreated = bookingMeter.createCounter("mesomed.booking.created", {
  description: "Appointments created, by booking channel",
});

const bookingTransitions = bookingMeter.createCounter("mesomed.booking.transitions", {
  description: "Appointment lifecycle transitions, by action",
});

export function recordBookingCreated(kind: string): void {
  bookingCreated.add(1, { kind });
}

export function recordBookingTransition(action: string): void {
  bookingTransitions.add(1, { action });
}

// ── Outbox health (ADR-0026) ─────────────────────────────────────────────

/**
 * DB-derived on purpose (MM-DES-003 §5): a push-style metric from the
 * dispatcher goes silent exactly when the dispatcher dies; this callback
 * keeps reporting as long as the API process and its DB connection live.
 * The metric reader's export interval is the poll timer — no new infra.
 * With no OTel SDK started the callback is never invoked, so no queries.
 */
export function registerOutboxMetrics(db: Db): void {
  const kernelMeter = metrics.getMeter("mesomed.kernel");

  const outboxLag = kernelMeter.createObservableGauge("mesomed.outbox.lag_seconds", {
    description: "Age of the oldest pending outbox row (0 when none pending)",
    unit: "s",
  });
  const outboxPending = kernelMeter.createObservableGauge("mesomed.outbox.pending", {
    description: "Outbox rows waiting to be published",
  });
  const outboxDead = kernelMeter.createObservableGauge("mesomed.outbox.dead", {
    description: "Dead-lettered outbox rows (exhausted retries)",
  });

  kernelMeter.addBatchObservableCallback(
    async (result) => {
      const { rows } = await db.execute<{ lag: string; pending: string; dead: string }>(sql`
        select
          coalesce(extract(epoch from (now() -
            min(${domainEvents.occurredAt}) filter (where ${domainEvents.status} = 'pending'))), 0) as lag,
          count(*) filter (where ${domainEvents.status} = 'pending') as pending,
          count(*) filter (where ${domainEvents.status} = 'dead') as dead
        from ${domainEvents}
      `);
      const row = rows[0];
      if (!row) return;
      result.observe(outboxLag, Number(row.lag));
      result.observe(outboxPending, Number(row.pending));
      result.observe(outboxDead, Number(row.dead));
    },
    [outboxLag, outboxPending, outboxDead],
  );
}

// ── Search revisit triggers (MM-QA-004 F-25, ADR-0049) ──────────────────

const searchMeter = metrics.getMeter("mesomed.search");

/**
 * Per-procedure latency for search.listings — the ADR-0030 revisit
 * trigger is "search p95 > 100 ms", and the HTTP histogram cannot see
 * individual tRPC procedures (they share one Fastify route), so the
 * query handler records its own histogram.
 */
const searchListingsDuration = searchMeter.createHistogram("mesomed.search.listings.duration", {
  description: "search.listings query duration",
  unit: "ms",
});

export function recordSearchListing(durationMs: number): void {
  searchListingsDuration.record(durationMs);
}

/**
 * Corpus size backing the other ADR-0030 revisit trigger
 * ("search_documents > ~50k rows"). DB-derived like the outbox gauges:
 * reports as long as the process + DB connection live; count(*) on a
 * launch-scale corpus is cheap, and by the time it isn't, the alert has
 * long since fired.
 */
export function registerSearchMetrics(db: Db): void {
  const documents = searchMeter.createObservableGauge("mesomed.search.documents", {
    description: "Rows in the search_documents read model",
  });
  documents.addCallback(async (result) => {
    const { rows } = await db.execute<{ count: string }>(
      sql`select count(*) as count from search_documents`,
    );
    const row = rows[0];
    if (!row) return;
    result.observe(Number(row.count));
  });
}
