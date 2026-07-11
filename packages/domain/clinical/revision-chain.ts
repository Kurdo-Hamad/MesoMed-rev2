/**
 * Prescription revision-chain assembly (clinical extension, ADR-0010).
 * Revisions link backwards: each amendment carries the id of the revision
 * it supersedes. A chain is the original followed by its amendments in
 * supersession order; the DB's unique partial index on
 * supersedes_prescription_id guarantees linearity, so assembly is pure
 * link-following. Rows whose supersession target is absent from the input
 * start their own chain (tolerant of scoped reads) rather than being
 * dropped — clinical history must never silently lose a revision.
 */

export interface RevisionLink {
  id: string;
  /** Null on an original revision. */
  supersedesPrescriptionId: string | null;
}

export interface RevisionChain<T extends RevisionLink> {
  /** Original first, latest revision last. */
  revisions: T[];
}

/**
 * Group revisions into chains. Within a chain: original → latest. Chains
 * are ordered by their head's position in the input, so callers control
 * overall ordering by pre-sorting rows (e.g. issued_at descending).
 */
export function buildPrescriptionRevisionChains<T extends RevisionLink>(
  rows: readonly T[],
): RevisionChain<T>[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const bySupersedes = new Map<string, T>();
  for (const row of rows) {
    if (row.supersedesPrescriptionId !== null) {
      bySupersedes.set(row.supersedesPrescriptionId, row);
    }
  }

  const chains: RevisionChain<T>[] = [];
  const placed = new Set<string>();
  const follow = (head: T): void => {
    const revisions: T[] = [];
    for (
      let cursor: T | undefined = head;
      cursor !== undefined && !placed.has(cursor.id);
      cursor = bySupersedes.get(cursor.id)
    ) {
      placed.add(cursor.id);
      revisions.push(cursor);
    }
    if (revisions.length > 0) chains.push({ revisions });
  };

  for (const row of rows) {
    // A chain head is an original, or a revision whose target is not in
    // the input set (orphan head under a scoped read).
    if (row.supersedesPrescriptionId === null || !byId.has(row.supersedesPrescriptionId)) {
      follow(row);
    }
  }
  // Cyclic links (impossible under the DB constraints) leave rows with no
  // head; sweep them so hostile input still terminates with every row placed.
  for (const row of rows) {
    if (!placed.has(row.id)) follow(row);
  }
  return chains;
}
