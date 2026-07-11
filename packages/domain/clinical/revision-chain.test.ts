import { describe, expect, it } from "vitest";
import { buildPrescriptionRevisionChains } from "./revision-chain.js";

const link = (id: string, supersedesPrescriptionId: string | null) => ({
  id,
  supersedesPrescriptionId,
});

describe("buildPrescriptionRevisionChains", () => {
  it("a single original is its own chain", () => {
    expect(buildPrescriptionRevisionChains([link("a", null)])).toEqual([
      { revisions: [link("a", null)] },
    ]);
  });

  it("orders a multi-revision chain original → latest regardless of input order", () => {
    const rows = [link("c", "b"), link("a", null), link("b", "a")];
    const chains = buildPrescriptionRevisionChains(rows);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.revisions.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("separates independent chains and preserves head input order", () => {
    const rows = [link("y", null), link("a", null), link("b", "a"), link("z", "y")];
    const chains = buildPrescriptionRevisionChains(rows);
    expect(chains.map((chain) => chain.revisions.map((r) => r.id))).toEqual([
      ["y", "z"],
      ["a", "b"],
    ]);
  });

  it("a revision whose supersession target is absent heads its own chain (never dropped)", () => {
    const rows = [link("b", "missing"), link("c", "b")];
    const chains = buildPrescriptionRevisionChains(rows);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.revisions.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("every input row appears in exactly one chain", () => {
    const rows = [
      link("a", null),
      link("b", "a"),
      link("c", "b"),
      link("x", null),
      link("orphan", "gone"),
    ];
    const placed = buildPrescriptionRevisionChains(rows)
      .flatMap((chain) => chain.revisions.map((r) => r.id))
      .sort();
    expect(placed).toEqual(["a", "b", "c", "orphan", "x"]);
  });

  it("defends against cyclic links instead of looping forever", () => {
    // Impossible under the DB's unique + no-self-supersede constraints,
    // but the pure function must still terminate on hostile input.
    const rows = [link("a", "b"), link("b", "a")];
    const chains = buildPrescriptionRevisionChains(rows);
    const placed = chains.flatMap((chain) => chain.revisions.map((r) => r.id)).sort();
    expect(placed).toEqual(["a", "b"]);
  });
});
